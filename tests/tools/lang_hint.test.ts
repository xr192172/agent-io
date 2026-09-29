/**
 * lang_hint —— 「缺失语言/能力」提示**可执行性**测试
 *
 * 用户方针：「语言无关……**如果缺失提示下载或自己开发补齐**」。
 * ⇒ 提示必须**可执行**：说清装什么包（含钉版）、照哪份清单补、当前缺口多少。
 *
 * 覆盖三类缺失（各断言**四要件**，不是"非空"就过）：
 *   ① 缺语言（扩展名不在 LANGUAGES 注册表）      → 应说"注册表里还没有它"
 *   ② 语言在注册表但解析包不可用（.css）        → 应给包名 + 钉版/CLI 命令
 *   ③ 包已装但该能力未实现（.ts × spring_mvc_layering）→ 应说"已装" + 指到该能力小节
 *
 * 判据（每条都独立可验，不自我循环）：
 *   · 要件①：输出含扩展名 + 语言名（或"未登记语言"）
 *   · 要件②：输出含 `tree-sitter-<pkg>` / "注册表里还没有它" / "已装"
 *   · 要件③：输出含 `docs/adding-a-language.md` + 对应节名（节名里含 capabilityId）
 *   · 要件④：输出里的"缺口 N 个"== 用 capability_matrix 的 diagnose+aggregate 独立算出的 N
 */
import { describe, it, expect } from 'vitest';
import { missingLanguageHint, capabilityGaps } from '../../src/tools/lang_hint';
import { diagnoseCapabilities, aggregateGaps } from '../../src/tools/capability_matrix';
import { languageCatalog } from '../../src/tools/capability_matrix';
import { findLanguageByExt } from '../../src/tools/ts_kernel/languages';
import { isExtSupported } from '../../src/tools/ts_kernel/probe';

/** 独立重算缺口（不复用 lang_hint 的入口，防"自己重算错了也一致"） */
function gaps() {
  const rows = diagnoseCapabilities(languageCatalog().map((l) => l.name));
  const byCapability = aggregateGaps(rows);
  return { total: Object.values(byCapability).reduce((n, l) => n + l.length, 0), byCapability };
}

/** 四要件通用断言（①扩展名 ②装包 ③清单 ④缺口数） */
function assertFourParts(hint: string, ext: string): void {
  // 一句话四要件，不许拆行
  expect(hint, '提示应是单行（不拆成四行废话）').not.toContain('\n');
  // ① 缺哪个语言
  expect(hint, '要件①：应含扩展名').toContain(ext);
  // ② 装什么包（三种状态之一）
  expect(hint, '要件②：应含装包段').toContain('装包：');
  // ③ 照哪份清单补
  expect(hint, '要件③：应指向补齐清单').toContain('docs/adding-a-language.md');
  expect(hint, '要件③：应指到具体节名').toMatch(/(§1 第 ① 层|§2\.\d+ )/);
  // ④ 当前缺口数（与独立重算一致）
  expect(hint, '要件④：应含缺口数').toContain(`${gaps().total} 个「功能×语言」对`);
}

describe('lang_hint · 缺失语言能力提示', () => {
  it('① 缺语言：扩展名不在注册表 ⇒ 直说"注册表里还没有它"，不编包名', () => {
    const ext = '.xyz';
    expect(findLanguageByExt(ext), '前提：.xyz 确实不在注册表').toBeUndefined();

    const hint = missingLanguageHint(ext);
    assertFourParts(hint, ext);
    expect(hint).toContain('未登记语言');
    expect(hint, '不在注册表就该说不存在，而不是给个假包名').toContain('注册表里还没有它');
    expect(hint).not.toContain('tree-sitter-undefined');
  });

  it('② 语言在注册表但包不可载入（.css）⇒ 给包名 + 安装命令（含钉版信息）', () => {
    const ext = '.css';
    const entry = findLanguageByExt(ext);
    expect(entry, '前提：.css 在注册表').toBeDefined();
    // ★ 前提是「不可载入」，不是「未装」——tree-sitter-css 实际在盘上（scss 的传递依赖），
    //   但老 nan.h 模板 ⇒ 载入必失败。断言用的是"探到的可用性"，与盘上有没有无关。
    expect(isExtSupported(ext), '前提：tree-sitter-css 不可载入（真筛子判不可用）').toBeNull();

    const hint = missingLanguageHint(ext, 'code_health');
    assertFourParts(hint, ext);
    // ★ 2026-09-29 措辞纠正：tree-sitter-css **在盘上**（是 tree-sitter-scss 的传递依赖），
    //   但它是老 nan.h 模板、无可用二进制 ⇒ 载入必失败 ⇒ probe 的「真筛子」判**不可用**。
    //   ∴ 这里的"不可用"而不是"未装"，断言本身不变（isExtSupported 的语义已从"可 resolve"
    //   收紧为"可载入"，见 src/tools/ts_kernel/probe.ts）。
    expect(hint, '要件②：应给 npm 包名').toContain(`tree-sitter-${entry!.pkg}`);
    expect(hint, '要件②：应给装包命令').toContain(`npm run install-package install ${entry!.name}`);
    expect(hint, '要件①：应带上该能力 id').toContain('「code_health」能力');
    expect(hint, '要件③：应指到 code_health 那一节').toContain('§2.11 code_health');
    expect(hint, '要件④：应带该能力缺几门').toContain(
      `code_health 缺 ${gaps().byCapability['code_health'].length} 门`,
    );
  });

  it('③ 包已装但该能力未实现（.ts × spring_mvc_layering）⇒ 说"已装"，指向该能力小节', () => {
    const ext = '.ts';
    expect(isExtSupported(ext), '前提：本机已装 tree-sitter-typescript').not.toBeNull();

    const hint = missingLanguageHint(ext, 'spring_mvc_layering');
    assertFourParts(hint, ext);
    expect(hint, '要件①：应带语言名').toContain('（typescript）');
    expect(hint, '要件②：包已装就该说已装，别让人去装一个已有的包').toContain('tree-sitter-typescript 已装');
    expect(hint).not.toContain('@latest（未登记钉版）');
    expect(hint, '要件③：应指到 spring_mvc_layering 那一节').toContain('§2.12 spring_mvc_layering');
    expect(hint, '要件①：应说清该语言该能力现处哪档').toContain('现为「未实现」');
    expect(hint, '要件④：应带该能力缺几门').toContain(
      `spring_mvc_layering 缺 ${gaps().byCapability['spring_mvc_layering'].length} 门`,
    );
  });

  it('capabilityGaps 与 capability_matrix 独立重算一致（防"自己重算"漂移）', () => {
    const mine = capabilityGaps();
    const theirs = gaps();
    expect(mine.total).toBe(theirs.total);
    expect(mine.total).toBeGreaterThan(0);
    expect(mine.byCapability).toEqual(theirs.byCapability);
  });

  it('扩展名归一化：不带点 / 大写 也认', () => {
    expect(missingLanguageHint('CSS', 'code_health')).toContain('.css（css）');
  });
});
