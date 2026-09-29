/**
 * ★ 扫描边界门 —— 「会扫仓库的工具必须带统一 `bounds` 字段」（契约：`src/tools/scan_bounds.ts`）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它（用户的洞察，2026-09-29）
 * ─────────────────────────────────────────────────────────────
 *   > 「你作为 LLM 应该是**没有时间观念的**……**你会不会优先选择它？**」
 *   ⇒ **对 LLM 来说 可信度 > 精度 > 速度**：一个不可信的返回 = **多要一轮验证**。
 *   ⇒ LLM 会优先选「**能自证边界**」的工具 —— 本仓已经在走这条路（`skipped[]` /
 *     `candidateScan` / `excludedNonCode`），但**覆盖不全、形状不统一**。
 *   本门把它从"各自为政"变成**可判**：谁在扫仓库，谁就得给出统一形状的边界自证。
 *
 * ─────────────────────────────────────────────────────────────
 * 判据（可 grep、可判红、与文件位置无关）
 * ─────────────────────────────────────────────────────────────
 *   ① **扫仓库类** = 工具的 [C] 条目**直接接线**到一个「扫描提供者模块」（[B] 层里会自行
 *      枚举文件 / 走全仓文本 / 兜 import 闭包 / 全项目建图的那种模块）。
 *      提供者清单**声明式登记**在 `tests/fixtures/scan_bounds_registry.json`（理由同 G4
 *      `single_source_registry.json`：自动发现"意图"不可判定，已登记族可判）。
 *      ★ 为什么是"直接接线"而不是"递归追 import"：实测递归追 1 跳就把 `handlers.ts` /
 *      `storage.ts` 整片卷进来 ⇒ 58 个工具里 52 个"命中"，**判据退化成空话**（本笔实测，
 *      见提交信息）。0 跳 + 只在 `handlers` 具名 handler 处深入一层，才既精确又不漏。
 *      ★ 与 `lane_no_io` 门的协同：lane 里**不许**出现 IO，所以"扫仓库"只可能通过 [B] 模块
 *      发生 ⇒ 本判据不会因为别人把 `readdirSync` 抄进 lane 而失明（那边先红）。
 *   ② 登记表与探测结果必须**两向一致**（新增未登记 = 红；登记了却探测不到 = 红，防"登记表
 *      悄悄腐成谎言"——G4 的同款纪律）。
 *   ③ 登记为 `bounds: true` 的工具，其**链路上必须真的出现 `bounds`**（静态可判；防"嘴上说迁了"）。
 *
 * ─────────────────────────────────────────────────────────────
 * 棘轮纪律（本仓惯例：**存量不拦、新增即红**）
 * ─────────────────────────────────────────────────────────────
 *   本笔只把**已有边界信息**的那批收进统一形状（`bounds: true`，5 个）；其余扫仓库类工具
 *   登记为 `bounds: false`（存量冻结）。谁新增一个会扫仓库的工具 ⇒ ① 红，必须二选一：
 *   **迁到 `bounds`** 或 **在登记表里显式落一笔 `bounds:false`**（一次落笔 = 一次判断）。
 *   收紧基线 = 把某个 `false` 改成 `true`（只许减债）。
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 诚实边界（本门**不验**什么）
 * ─────────────────────────────────────────────────────────────
 *   1. ③ 是**静态**判据（源码里出现了 `bounds` 字样），**不验**"它在成功路径上、内容对不对"——
 *      那要**真调工具看 `---DATA---`**（行为级，属 G8 域）。本文件另有一段**运行级**断言，
 *      只覆盖能低成本真跑的 2 个 [B]（`analyzeHealth` / `analyzeImpact`）。
 *   2. `scanProviders` 是**声明式**清单：判据精度取决于它。清单漏登记一个"其实会扫仓库"的模块
 *      ⇒ 其实会**漏判**（不是误判）。加新扫描实现时请同步补这里。
 *   3. 本门**不判**"该不该扫"（那是设计问题），只判"扫了就得说边界"。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectGateGoesRed, expectGateStaysGreen, PROBE_PREFIX } from '../helpers/gate_probe.js';
import { analyzeHealth } from '../../src/health/index.js';
import { analyzeImpact } from '../../src/impact/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');
const LANES_DIR = path.join(REPO, 'src', 'registry', 'lanes');
const HANDLERS = path.join(REPO, 'src', 'registry', 'handlers.ts');
const REGISTRY = path.join(here, '..', 'fixtures', 'scan_bounds_registry.json');

interface Decl {
  why: string;
  bounds: boolean;
}
interface Registry {
  scanProviders: string[];
  scanClass: Record<string, Decl>;
}
const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf-8')) as Registry;
const SCAN_PROVIDERS = new Set(registry.scanProviders);

// ── 解析原语（与 `lane_no_io` 同款：只去注释，保留字符串字面量 —— 判据要看代码） ──

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 相对 import 的 `局部名 → 模块说明符` 表（非相对 import 跳过：那是第三方/内置） */
function relativeImportsOf(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (!m[2].startsWith('.')) continue;
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const asM = t.match(/^(\S+)\s+as\s+(\S+)$/);
      map.set(asM ? asM[2] : t, m[2]);
    }
  }
  return map;
}

/** 说明符 → 仓库相对 POSIX 路径（`.js` → `.ts`；目录 → `index.ts`）；解析不到返回原样 */
function resolveRel(baseDir: string, spec: string): string {
  const abs = path.resolve(baseDir, spec);
  const rel = path.relative(REPO, abs).split(path.sep).join('/');
  if (rel.endsWith('.ts') && fs.existsSync(abs)) return rel;
  const asTs = rel.replace(/\.js$/, '.ts');
  if (fs.existsSync(path.resolve(REPO, asTs))) return asTs;
  const asIdx = path.join(rel.replace(/\.js$/, ''), 'index.ts');
  if (fs.existsSync(path.resolve(REPO, asIdx))) return asIdx.split(path.sep).join('/');
  return rel;
}

/** 一段源码里接线的「扫描提供者」证据 */
function scanHits(region: string, imports: Map<string, string>, baseDir: string): string[] {
  const hits: string[] = [];
  for (const [local, spec] of imports) {
    if (!new RegExp(`\\b${local}\\b`).test(region)) continue;
    const rel = resolveRel(baseDir, spec);
    if (SCAN_PROVIDERS.has(rel)) hits.push(`${local}@${rel}`);
  }
  return hits;
}

/** handlers.ts 的「具名 handler → 函数体」块 + 它自己的 import 表（只在具名 handler 处深入一层） */
function loadHandlerBlocks(): { blocks: Map<string, string>; imports: Map<string, string> } {
  const src = fs.readFileSync(HANDLERS, 'utf-8');
  const blocks = new Map<string, string>();
  const marks = [...src.matchAll(/export const (\w+)\s*=/g)];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].index as number;
    const to = i + 1 < marks.length ? (marks[i + 1].index as number) : src.length;
    blocks.set(marks[i][1], stripComments(src.slice(from, to)));
  }
  return { blocks, imports: relativeImportsOf(src) };
}

/** 探测：工具名 → 命中证据（空数组 = 不是扫仓库类） */
export function detectScanClass(laneFiles: string[]): Record<string, string[]> {
  const { blocks, imports: handlerImports } = loadHandlerBlocks();
  const out: Record<string, string[]> = {};
  for (const file of laneFiles) {
    const src = fs.readFileSync(file, 'utf-8');
    const laneImports = relativeImportsOf(src);
    const baseDir = path.dirname(file);
    const starts = [...src.matchAll(/^\s{4}name: '([a-z0-9_]+)',/gm)];
    for (let i = 0; i < starts.length; i++) {
      const name = starts[i][1];
      const from = starts[i].index as number;
      const to = i + 1 < starts.length ? (starts[i + 1].index as number) : src.length;
      const region = stripComments(src.slice(from, to));
      let hits = scanHits(region, laneImports, baseDir);
      // 具名 handler（`handler: xxxHandler`）且来自 handlers.ts ⇒ 深入该函数体一层
      for (const [local, spec] of laneImports) {
        if (!/handlers\.js$/.test(spec)) continue;
        if (!new RegExp(`handler:\\s*${local}\\b`).test(region)) continue;
        const blk = blocks.get(local);
        if (!blk) continue;
        hits = hits.concat(scanHits(blk, handlerImports, path.dirname(HANDLERS)).map((x) => `${x}#${local}`));
      }
      out[name] = [...new Set(hits)];
    }
  }
  return out;
}

interface Verdict {
  detected: Record<string, string[]>;
  /** 探测到但未登记（红） */
  added: string[];
  /** 登记了但探测不到（红：登记表腐化） */
  missing: string[];
  /** 声明 bounds:true 但链路上没有 `bounds`（红：嘴上说迁了） */
  missingBounds: string[];
}

/** 门的**判定**（只读；不在里面断言 —— 出生证 helper 的约定） */
export function runScanBoundsGate(laneFiles: string[]): Verdict {
  const detected = detectScanClass(laneFiles);
  const detectedNames = Object.keys(detected).filter((n) => detected[n].length > 0);
  const declaredNames = Object.keys(registry.scanClass);
  const added = detectedNames.filter((n) => !declaredNames.includes(n)).sort();
  const missing = declaredNames.filter((n) => !detectedNames.includes(n)).sort();
  // ③ `bounds` 字样必须出现在链路上（lane 条目 + 命中的提供者模块）
  const missingBounds: string[] = [];
  for (const [name, hits] of Object.entries(detected)) {
    if (!registry.scanClass[name]?.bounds) continue;
    const providers = hits.map((h) => h.split('@')[1].split('#')[0]);
    const texts = providers.map((rel) => {
      try {
        return fs.readFileSync(path.resolve(REPO, rel), 'utf-8');
      } catch {
        return '';
      }
    });
    const laneText = laneFiles.map((f) => fs.readFileSync(f, 'utf-8')).find((t) => new RegExp(`name: '${name}'`).test(t)) ?? '';
    const linked = [stripComments(laneText), ...texts.map(stripComments)];
    if (!linked.some((t) => /\bbounds\b/.test(t))) missingBounds.push(name);
  }
  return { detected, added, missing, missingBounds: missingBounds.sort() };
}

const laneFiles = fs
  .readdirSync(LANES_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(LANES_DIR, f));

// ─────────────────────────────────────────────────────────────
// ① 登记表 == 探测结果（两向一致）
// ─────────────────────────────────────────────────────────────
describe('扫描边界门 · 登记表与探测两向一致', () => {
  it('新增扫仓库类工具未登记 ⇒ 红；登记了却探测不到 ⇒ 红', () => {
    const v = runScanBoundsGate(laneFiles);
    expect(v.added, `未登记的扫仓库类工具（请在 tests/fixtures/scan_bounds_registry.json 登记：迁 bounds 或显式 frozen）`).toEqual([]);
    expect(v.missing, `登记表里的陈旧条目（探测不到了；工具删了/改名了/提供者清单要更新）`).toEqual([]);
  });

  it('声明 bounds:true 的工具，链路上必须真的出现 `bounds`', () => {
    const v = runScanBoundsGate(laneFiles);
    expect(v.missingBounds, `声称已迁到统一形状，但源码链路上找不到 bounds`).toEqual([]);
  });

  it('棘轮存量：bounds:false 的登记项是**显式**落笔的（只做提示，不隐形失败）', () => {
    const frozen = Object.entries(registry.scanClass)
      .filter(([, d]) => !d.bounds)
      .map(([n]) => n)
      .sort();
    // ★ 按 ratchet.ts 的纪律：**债务减少（shrunk）不得让门变红**，只提示。
    // eslint-disable-next-line no-console
    console.log(`[scan-bounds] 本笔未迁完的存量 ${frozen.length} 个（bounds:false）：${frozen.join(', ')}`);
    expect(frozen.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// ② 运行级：统一形状真的到得了调用方（覆盖能低成本真跑的 [B]）
//     ★ 静态判据只知道"源码里有 bounds"，这里证明它**真的出现在返回值上**。
// ─────────────────────────────────────────────────────────────
describe('扫描边界门 · 运行级（bounds 真的产出）', () => {
  const fixtures = path.join(here, '..', 'fixtures');

  it('analyzeHealth（code_health 的 [B]）：bounds 恒在，含口径 + 规模', async () => {
    const r = await analyzeHealth(path.join(fixtures, 'codehealth-good-fixture'));
    expect(r.bounds).toBeDefined();
    expect(typeof r.bounds.scope).toBe('string');
    expect(r.bounds.scope.length).toBeGreaterThan(0);
    expect(typeof r.bounds.scanned.files).toBe('number');
  });

  it('analyzeImpact（impact_analysis 的 [B]）：bounds 恒在，含口径 + 规模', async () => {
    const r = await analyzeImpact(path.join(fixtures, 'impact-fixture'), [{ file: 'src/core/math.ts' }]);
    expect(r.bounds).toBeDefined();
    expect(typeof r.bounds.scope).toBe('string');
    expect(typeof r.bounds.scanned.files).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────
// ③ 出生证（§4.11）：注入一个"本门本该抓到"的错 ⇒ 断言门变红；另带对照项
// ─────────────────────────────────────────────────────────────
const PROBE_FILE = path.join(here, '..', `${PROBE_PREFIX}_scan_lane.ts`);
const PROBE_TOOL = `${PROBE_PREFIX}_scanner`;
const CONTROL_TOOL = `${PROBE_PREFIX}_nonscanner`;

/** 造一个"看起来像 lane 条目"的探针文件（只被本门当**文本**读，不会被执行） */
function probeLaneSource(tool: string, imp: string): string {
  return [
    `import { ${imp} } from '${imp === 'renameSymbols' ? '../src/tools/rename_symbols.js' : '../src/registry/plumbing.js'}';`,
    '',
    'export const PROBE_TOOLS = [',
    '  {',
    `    name: '${tool}',`,
    "    title: 'probe',",
    "    description: 'probe',",
    '    inputSchema: {},',
    `    handler: ${imp}({} as never),`,
    '  },',
    '];',
    '',
  ].join('\n');
}

describe('扫描边界门 · 出生证', () => {
  it('正面：注入一个接线到「扫描提供者模块」的新工具 ⇒ 门变红', () => {
    expectGateGoesRed({
      name: 'scan_bounds_gate',
      mutate: () => fs.writeFileSync(PROBE_FILE, probeLaneSource(PROBE_TOOL, 'renameSymbols'), 'utf-8'),
      run: () => runScanBoundsGate([...laneFiles, PROBE_FILE]),
      isRed: (v) => v.added.includes(PROBE_TOOL),
      restore: () => fs.rmSync(PROBE_FILE, { force: true }),
      render: (v) => `added=${JSON.stringify(v.added)}`,
    });
  });

  it('对照项：注入一个**不接线**到扫描提供者的新工具 ⇒ 门不该红（判据不是"见新工具就红"）', () => {
    expectGateStaysGreen({
      name: 'scan_bounds_gate',
      mutate: () => fs.writeFileSync(PROBE_FILE, probeLaneSource(CONTROL_TOOL, 'wrapData'), 'utf-8'),
      run: () => runScanBoundsGate([...laneFiles, PROBE_FILE]),
      isRed: (v) => v.added.includes(CONTROL_TOOL),
      restore: () => fs.rmSync(PROBE_FILE, { force: true }),
      render: (v) => `added=${JSON.stringify(v.added)}`,
    });
  });
});
