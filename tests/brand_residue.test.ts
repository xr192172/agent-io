/**
 * 品牌串残留门 —— DesignCanvas → AgentIO 改名的判据（规划书 §10.5 / §10.8）
 *
 * 口径与 G4 同款**棘轮**：**存量不拦、新增即红**。理由同 G4：
 * 改名是一次跨 ~180 个文件的变更，不可能一次改完；棘轮让"改到一半"也是**安全的中间态**，
 * 而任何**新写回旧名**的地方立刻被抓住。
 *
 * ★ **2026-09-28 改名已完成**：非 `allowFiles` 文件的命中已归 **0** ⇒ 本门自本日起是**零容忍**
 *   （`frozen` 已空；任何一处旧名重现都会红）。
 *
 * ★ 形态与映射（实测清点出的 7 种旧形态 → 新名）：
 *   `design-canvas`→`agent-io` ｜ `.design-canvas`→`.agent-io`（由前者覆盖，**不另设 pattern**）
 *   `DESIGN_CANVAS`→`AGENT_IO` ｜ `design_canvas`→`agent_io` ｜ `DesignCanvas`→`AgentIO`
 *   `DC_`→`AGENT_IO_`（**统一成一个**环境变量前缀；原先是 `DC_` 与 `DESIGN_CANVAS_` 两套）
 *   ⇒ `DC_` 走 `regexPatterns`（必须有**边界**：`SOME_DC_X` 不是品牌串）。
 *   `dc-` **有意不改**：它已不是品牌契约，而是三种内部/外部命名空间（`os.tmpdir()` 前缀、
 *   renderer 的 CSS 类与 localStorage 键、dsh-brain 仓库里的 `probe-dc-*.mjs` 文件名）
 *   —— 改它零功能收益，且会把文档指向不存在的文件。详见登记表 `note`。
 *
 * ★ 扫描范围与"历史允许表"：
 *   本仓既有惯例是**历史决策/核验记录保留旧名 = 正确原貌**（同 `contract_docs_gate` 的 HISTORY_RE）。
 *   例如 `docs/architecture-refactor-plan.md` 里的历史条目写着"design-canvas 3,591 → 574 行" ——
 *   把那里的旧名改掉等于**篡改历史**。故这些文件进 `allowFiles`。
 *
 * ★ 检测的是**文本出现**（字面量子串），不是"代码里引用了品牌" —— 所以注释与文档都算。
 *   这是有意的：改名要覆盖的正是文档与注释。
 *
 * ★★ 一个**改名时才发现的门盲区**（已修，见 `isProbablyText`）：本门原先只扫一张
 *   **扩展名白名单**（`TEXT_EXTS`）⇒ `.gitignore`（无扩展名）、`go-observe/go.mod`、
 *   `go-slim/go.mod`（`.mod` 不在表里）**逃过改名、门也照样绿**。
 *   现已改为**内容嗅探**（前 8KB 无 NUL ⇒ 当文本）。教训：**"手抄的清单"代替"可判定的规则"
 *   就是这个项目的病根，它连门自己都没放过。**
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

/**
 * 已知二进制/非文本扩展名（快路径跳过）。
 * ★ 这里只列**确定是二进制**的；其余一律走 `isProbablyText` 的**内容嗅探**。
 */
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svgz', '.pdf',
  '.zip', '.gz', '.tar', '.tgz', '.7z', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.wav', '.db', '.sqlite', '.exe', '.dll', '.so', '.dylib',
  '.class', '.jar', '.node', '.pyc', '.o', '.a', '.obj',
]);

/**
 * 文本判定：**内容嗅探**（前 8KB 不含 NUL 字节 ⇒ 当文本）。
 *
 * ★ 为什么不用"扩展名白名单"（我上一版就是这么写的，**它漏了三处**）：
 *   实测改名时发现 `.gitignore`（**无扩展名**）与 `go-observe/go.mod`、`go-slim/go.mod`
 *   （`.mod` 不在白名单里）**既没被改名、门也照样绿** —— 门对它们**完全失明**。
 *   ⇒ 白名单是"我以为有哪些文本文件"，嗅探是"按定义判"（文本 = 不含 NUL）。
 *   这也是本项目的老毛病换了件衣服：**一份手抄的清单**代替一个可判定的规则。
 */
export function isProbablyText(abs: string): boolean {
  if (BINARY_EXTS.has(path.extname(abs).toLowerCase())) return false;
  let fd: number | null = null;
  try {
    fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return !buf.subarray(0, n).includes(0);
  } catch {
    return false; // 读不了（权限/目录）⇒ 当非文本，静默跳过
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

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
  /** 要清零的品牌串形态（纯子串匹配） */
  patterns: string[];
  /**
   * 需要**边界**的形态（正则）—— 纯子串会误伤，故单独一条规则而不是塞进 `patterns`。
   * 实测来源：旧环境变量前缀 `DC_` 必须"独立出现"才算（`SOME_DC_X` 不是品牌串）。
   */
  regexPatterns?: string[];
  /** 历史允许表：这些文件保留旧名是**正确原貌** */
  allowFiles: Record<string, string>;
  /** 棘轮基线：文件 → 命中数 */
  frozen: Record<string, number>;
}

/**
 * ★ 构建工具的临时产物：vitest 会把 `vitest.config.ts` 转译成
 * `vitest.config.ts.timestamp-<ms>-<hash>.mjs` 落在**仓库根**，且**不总清理**。
 * 它们不是仓库内容，但正文里含**绝对路径**（`file:///D:/…/design-canvas/node_modules/…`）
 * ⇒ 会命中品牌串、让本门**周期性假红**（2026-09-28 实测：连跑几次测试后门自己就红了）。
 * ⇒ 一律跳过（同时已加进 .gitignore 防误提交）。
 */
export function isToolTempFile(name: string): boolean {
  return /^vitest\.config\.ts\.timestamp-\d+-[0-9a-f]+\.mjs$/.test(name);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(abs, out);
    } else if (e.isFile() && !isToolTempFile(e.name) && isProbablyText(abs)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * 统计一个文件的品牌串命中总数。
 * @param patterns 纯子串形态（各形态互不重叠，直接相加）
 * @param regexPatterns 需要边界的形态（如旧环境变量前缀 `DC_`）；用 `/g` 逐个计数
 */
export function countBrandHits(src: string, patterns: string[], regexPatterns: string[] = []): number {
  let n = 0;
  for (const p of patterns) {
    let i = 0;
    while ((i = src.indexOf(p, i)) >= 0) {
      n += 1;
      i += p.length;
    }
  }
  for (const r of regexPatterns) {
    n += (src.match(new RegExp(r, 'g')) ?? []).length;
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
    const n = countBrandHits(fs.readFileSync(abs, 'utf8'), reg.patterns, reg.regexPatterns ?? []);
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
  it('形态互不重叠：旧形态 `.design-canvas` 由 `design-canvas` 覆盖，**不另设** pattern', () => {
    // 为什么单钉这一条：门里若有人好心再补一个 `.design-canvas` pattern，**同一处会被计两次**，
    // 棘轮基线随之虚高（"多了一份手抄清单"的典型后果）。这里把"不需要第二个 pattern"钉住。
    expect(countBrandHits('const dir = ".design-canvas";', ['design-canvas'])).toBe(1);
    expect(countBrandHits('.design-canvas', ['design-canvas', 'design_canvas'])).toBe(1);
  });
  it('单点常量已经改到新名（改名收尾的回归钉）', () => {
    expect(DATA_DIR_NAME).toBe('.agent-io');
    expect(countBrandHits(DATA_DIR_NAME, ['design-canvas'])).toBe(0);
  });
  it('正则形态带边界：`DC_` 只算独立前缀，不误伤 `SOME_DC_X`', () => {
    const R = ['(?<![A-Za-z0-9_])DC_[A-Za-z0-9_]*'];
    expect(countBrandHits('process.env.DC_PORT', [], R)).toBe(1);
    expect(countBrandHits('MyDC_FOO', [], R)).toBe(0);
    expect(countBrandHits('DC_A + DC_B', [], R)).toBe(2);
  });
  it('★ 文本判定是**内容嗅探**：无扩展名 / `.mod` 这类文件也在扫描范围内', () => {
    // 出生证：这三处正是"扩展名白名单"时代**门完全失明**的文件（实测漏了它们没被改名）
    for (const rel of ['.gitignore', 'go-observe/go.mod', 'go-slim/go.mod']) {
      expect(isProbablyText(path.join(REPO, rel)), `${rel} 应被判定为文本`).toBe(true);
    }
    // 反面：真二进制不该当文本读（否则每次跑门都白读一堆二进制）
    expect(isProbablyText(path.join(REPO, 'package.json'))).toBe(true);
    expect(isProbablyText(path.join(REPO, '不存在的文件.xyz'))).toBe(false);
  });
  it('★ 门的假红防护：构建工具的临时产物必须被跳过', () => {
    // 出生证：vitest 把 config 转译成 `vitest.config.ts.timestamp-<ms>-<hash>.mjs` 落在**仓库根**且不总清理，
    // 其正文含绝对路径（`file:///D:/…/design-canvas/node_modules/…`）⇒ 不跳过就会让门**周期性假红**
    // （2026-09-28 实测：连跑几次测试后门自己就红了，一度被误判为代码改动引起）。
    expect(isToolTempFile('vitest.config.ts.timestamp-1790603891994-01d1d7c1be0a.mjs')).toBe(true);
    // 反面：真配置文件不能被误跳（否则门会漏掉真内容）
    expect(isToolTempFile('vitest.config.ts')).toBe(false);
    expect(isToolTempFile('vitest.config.mjs')).toBe(false);
    expect(isToolTempFile('package.json')).toBe(false);
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
