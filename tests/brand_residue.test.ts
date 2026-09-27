/**
 * 品牌串残留门 —— DesignCanvas → AgentIO 改名的判据（规划书 §10.5）
 *
 * 口径与 G4 同款**棘轮**：**存量不拦、新增即红**。理由同 G4：
 * 改名是一次跨 ~180 个文件的变更，不可能一次改完；棘轮让"改到一半"也是**安全的中间态**，
 * 而任何**新写回旧名**的地方立刻被抓住。
 *
 * ★ 为什么需要它（不是"多此一举的门"）：
 *   品牌串有 **7 种形态**（`design-canvas` / `.design-canvas` / `DESIGN_CANVAS` / `design_canvas` /
 *   `DesignCanvas` / `DC_` / `dc-`），漏一种就是半成品；而且**改完之后一定会有人再写回旧名**
 *   （复制旧文档、抄旧命令）。没有门 ⇒ 改名结果随时间腐化。
 *
 * ★ 扫描范围与"历史允许表"：
 *   本仓既有惯例是**历史决策/核验记录保留旧名 = 正确原貌**（同 `contract_docs_gate` 的 HISTORY_RE）。
 *   例如 `docs/architecture-refactor-plan.md` 里的历史条目写着"design-canvas 3,591 → 574 行" ——
 *   把那里的旧名改掉等于**篡改历史**。故这些文件进 `allowFiles`。
 *
 * ★ 检测的是**文本出现**（字面量子串），不是"代码里引用了品牌" —— 所以注释与文档都算。
 *   这是有意的：改名要覆盖的正是文档与注释。
 *
 * 收紧基线（确认某处已改完）：
 *   UPDATE_BRAND_RESIDUE=1 ./node_modules/.bin/vitest run tests/brand_residue.test.ts
 */

import { DATA_DIR_NAME } from '../src/data_dir.js';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ratchetDiff, ratchetFailureText } from './helpers/ratchet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..');
const REGISTRY = path.join(here, 'fixtures', 'brand_residue_registry.json');

/** 不进扫描的目录（产物 / 依赖 / 工具自己的数据目录 / 非本仓内容） */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'output', 'third_party', DATA_DIR_NAME,
  '.inspect', '.vscode', '.trae', 'coverage', '.venv', 'venv', 'vendor', 'assets',
]);

/** 只扫这些扩展名（文本类；二进制/图片自动排除） */
const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml',
  '.sh', '.cmd', '.ps1', '.toml', '.go', '.py', '.html', '.css', '.vue', '.txt',
]);

/**
 * ★ 门自己的文件必须排除 —— 它**按定义**就要写出那些品牌串（`patterns` 数组、提示语、注释）。
 * 不排除的话基线永远不可能归零，门就自相矛盾了。
 * 刻意用独立的常量而不是塞进 `allowFiles`：`allowFiles` 的语义是"**历史记录**保留旧名是正确的"，
 * 而这里是"**工具自身**必须提及被检测的串"，两件事不同，别混。
 */
const SELF_FILES = new Set([
  'tests/brand_residue.test.ts',
  'tests/fixtures/brand_residue_registry.json',
]);

interface BrandRegistry {
  note: string;
  /** 要清零的品牌串形态（**不含** `DC_`/`dc-`：歧义大，需人审，见规划书 §10.2） */
  patterns: string[];
  /** 历史允许表：这些文件保留旧名是**正确原貌** */
  allowFiles: Record<string, string>;
  /** 棘轮基线：文件 → 命中数 */
  frozen: Record<string, number>;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(abs, out);
    } else if (e.isFile() && TEXT_EXTS.has(path.extname(e.name))) {
      out.push(abs);
    }
  }
  return out;
}

/** 统计一个文件的品牌串命中总数（各形态互不重叠，直接相加） */
export function countBrandHits(src: string, patterns: string[]): number {
  let n = 0;
  for (const p of patterns) {
    let i = 0;
    while ((i = src.indexOf(p, i)) >= 0) {
      n += 1;
      i += p.length;
    }
  }
  return n;
}

function scan(): Record<string, number> {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as BrandRegistry;
  const hits: Record<string, number> = {};
  for (const abs of walk(REPO)) {
    const rel = path.relative(REPO, abs).split(path.sep).join('/');
    if (rel in reg.allowFiles) continue;
    if (SELF_FILES.has(rel)) continue;
    const n = countBrandHits(fs.readFileSync(abs, 'utf8'), reg.patterns);
    if (n > 0) hits[rel] = n;
  }
  return hits;
}

describe('品牌串残留门 · 检测器自身有效（证明它会红）', () => {
  const P = ['design-canvas', 'DESIGN_CANVAS'];
  it('命中计数正确（含多次出现）', () => {
    expect(countBrandHits('const a = "design-canvas"; // design-canvas', P)).toBe(2);
    expect(countBrandHits('DESIGN_CANVAS + design-canvas', P)).toBe(2);
    expect(countBrandHits('no brand here', P)).toBe(0);
  });
  it('形态互不重叠（不会重复计数）', () => {
    // `.design-canvas` 由 `design-canvas` 覆盖，不另设 pattern
    expect(countBrandHits(DATA_DIR_NAME, ['design-canvas'])).toBe(1);
  });
});

describe('品牌串残留门 · 棘轮（存量不拦，新增即红）', () => {
  it('新增旧名出现处 ⇒ 红', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as BrandRegistry;
    const actual = scan();

    if (process.env.UPDATE_BRAND_RESIDUE === '1') {
      const next: BrandRegistry = { ...reg, frozen: actual };
      fs.writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + '\n', 'utf-8');
      // eslint-disable-next-line no-console
      console.log(`[品牌残留] 基线已更新：${Object.keys(actual).length} 个文件`);
      return;
    }

    const total = Object.values(actual).reduce((a, b) => a + b, 0);
    // 目标态是 0 —— 改名完成后本门会变成"零容忍"；现在先把存量冻住
    // eslint-disable-next-line no-console
    console.log(`[品牌残留] 存量：${Object.keys(actual).length} 个文件 / ${total} 处（目标态 0）`);

    const d = ratchetDiff(reg.frozen, actual, (f) => fs.existsSync(path.join(REPO, f)));
    const hint =
      '出现**新的**旧品牌串（design-canvas / DESIGN_CANVAS / design_canvas / DesignCanvas）。\n' +
      '改名进行中时：请改为新名（AgentIO 系）；若确属历史记录，把它加进 tests/fixtures/brand_residue_registry.json 的 allowFiles 并写明理由。';

    // ★ 分别断言：**只有"新增/增长"才是失败**。
    //   把"债务减少（好事，应收紧基线）"混进同一个失败信息里，会让**任何改善都把门打红** ——
    //   那不是棘轮纪律（"只在新增命中上 fail"），是把提示当成了拦阻。本门第一版就踩了这个坑。
    expect(d.added, `[brand-residue] ${hint}\n新增命中：\n  ${d.added.join('\n  ')}`).toEqual([]);
    expect(
      d.grown.map((g) => `${g.file} ${g.was} → ${g.now}`),
      `[brand-residue] ${hint}\n已知处又多了：\n  ${d.grown.map((g) => `${g.file}: ${g.was} → ${g.now}`).join('\n  ')}`,
    ).toEqual([]);

    if (d.shrunk.length > 0 || d.cleared.length > 0) {
      // 债务已减少 ⇒ 只是提示收紧（不让红），与 G4 同款纪律
      // eslint-disable-next-line no-console
      console.log(
        `[品牌残留] 债务已减少，请收紧基线（UPDATE_BRAND_RESIDUE=1）：` +
          [...d.shrunk.map((s) => `${s.file} ${s.was}→${s.now}`), ...d.cleared.map((f) => `${f} 已归零`)].join(', '),
      );
    }
  });

  it('登记表自身健康（patterns 非空 / allowFiles 的文件必须真实存在）', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as BrandRegistry;
    expect(reg.patterns.length).toBeGreaterThan(0);
    expect(reg.note.length).toBeGreaterThan(20);
    const missing = Object.keys(reg.allowFiles).filter((f) => !fs.existsSync(path.join(REPO, f)));
    expect(missing, `allowFiles 引用了不存在的文件：\n  ${missing.join('\n  ')}`).toEqual([]);
    const stale = Object.keys(reg.frozen).filter((f) => !fs.existsSync(path.join(REPO, f)));
    expect(stale, `frozen 引用了不存在的文件（搬迁后请更新基线）：\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
