/**
 * T19 · 「根的选择」门 —— 每份数据必须声明它归哪个根，而且**声明必须可执行**
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要这扇门（账本 `docs/data-ledger.md` 的实测结论）
 * ─────────────────────────────────────────────────────────────
 * 账本把"越兜越多"的真正机制查清楚了：**不是数据杂，是"这份数据归哪个根"没人定**。
 * 同一种数据在三处各挑一个根 ——
 *   · 符号索引 `cache.db` → `<projectRoot>/.agent-io/`（跟着被分析项目走）
 *   · DSL 三态           → `<dataHome>/.agent-io/`（包根，与 cwd 无关）
 *   · 健康缓存           → 曾经写死 **`<cwd>`**（⇒ 跨项目串）
 *   · 读侧兜底           → 第三个 `cwd`
 * 最直接的后果是**写读不碰面**：`import_cache_<feature>.db` 写侧用 `cwd`、读侧用包根
 * ⇒ 只要 `cwd ≠ 包根`，就是"一边写、另一边读到空"。
 *
 * ─────────────────────────────────────────────────────────────
 * 判据：**owner 必须是可证伪的**（这是本门与"写一张表"的区别）
 * ─────────────────────────────────────────────────────────────
 * 「根」的口头定义（谁都能说）：这份数据存在哪。
 * 本门把它换成一条**可执行**的判据：
 *
 *   ★★ **一份数据的 `owner`，就是"它的位置随哪个变量变"。**
 *      · `owner: 'project'` ⇒ 位置**必须随 `projectRoot` 变** —— 门拿两个不同的根
 *        去调它的 `resolver`，两次结果**必须不同**，且各自**必须包含自己那个根**。
 *      · `owner: 'dataHome'` ⇒ 位置**不随 `projectRoot` 变**（根来自 `AGENT_IO_HOME`/包根这类
 *        环境），所以**没法用"两个根"去证伪** ⇒ 退一步：只校验它来自**登记的 dataHome 模块白名单**。
 *
 *   ★ 这条判据**真的抓得到 bug**：它正是 `health_cache` 那个 bug 的形状 ——
 *     旧 `cacheDir()` 不收 root、偷用 `process.cwd()` ⇒ 传两个不同的根，返回**同一个值** ⇒ 红。
 *     （出生证里就是这么注入的，见下方「出生证」块。）
 *
 * ─────────────────────────────────────────────────────────────
 * 与 G4「单一实现门」的分工（别混）
 * ─────────────────────────────────────────────────────────────
 *   · G4 管**"同一意图有几份实现"**（字面模式 + 棘轮）。
 *   · 本门管**"一份数据归哪个根"**（登记表 + 行为校验）。
 *   两者都是**声明式登记**，都**不假装能自动发现**新条目 —— 与 G4 同款理由：
 *   自动发现"意图重复"/"这是不是新数据项"不可判定。发现新数据项 ⇒ 往登记表加一行（便宜）。
 *
 * ─────────────────────────────────────────────────────────────
 * 诚实性：`fresh` 的 `none` **必须选边**
 * ─────────────────────────────────────────────────────────────
 * 账本结论一那句话的机制是"数据缺了就往上溯源"；而**没有新鲜判据**的数据是溯源链的断点。
 * 所以本门不允许写含糊的 `fresh: 'none'`，必须选：
 *   · `not-a-cache` —— 本就不是缓存（append-only 流水 / 里程碑 / 每次插桩一份），没有"新鲜度"概念；
 *   · `none-debt`  —— **是缓存却确实缺判据** ⇒ 计入棘轮，**只许减不许增**。
 *
 * ★ 已知限度（如实声明，不装全能）：
 *   1. 登记表要**人写**。门能查"写了的是不是真的"，查不了"有没有漏写的"。
 *   2. `dataHome` 那半边只能用"模块白名单"证伪，强度**弱于** `project` 那半边的行为校验 ——
 *      因为它的根是环境量，不是参数，跑不出"两个根"。这是如实承认，不是偷懒。
 *   3. `owner: 'project'` 的 resolver 必须是**首参为项目根**的纯路径函数；
 *      首参不是根的（如 `getLiveFeatureFile(feature, baseDir?)`）不能当 project 的 resolver
 *      —— 门会把它当成"忽略入参"从而报红（这正是我们要的：把它挡在 project 之外）。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectGateGoesRed,
  expectGateStaysGreen,
  isProbeNeutralized,
  neutralizeProbe,
} from '../helpers/gate_probe.js';

// ─────────────────────────────────────────────────────────────
// 静态模块表：**判据优先用运行时真导出，不用文本正则**（本仓的判据优先级：运行时 > 结构化 API > AST > 正则）。
// 一个 ref 的 file 不在这张表里 ⇒ 门红，提示"把该模块加进来" —— 这是**有意的**摩擦力：
// 它逼你在新增数据项时**显式**确认落点，而不是让登记表悄悄腐成谎言。
// ─────────────────────────────────────────────────────────────
import * as dbMod from '../../src/infrastructure/index/db.js';
import * as symbolsMod from '../../src/infrastructure/index/symbols.js';
import * as projectViewMod from '../../src/infrastructure/parse/project_view.js';
import * as storageMod from '../../src/infrastructure/storage.js';
import * as dogfoodMod from '../../src/infrastructure/dogfood_stats.js';
import * as semanticSearchMod from '../../src/application/meta/semantic_search.js';
import * as importProjectMod from '../../src/infrastructure/graph/import_project.js';
import * as fileSnapshotMod from '../../src/application/refactor/file_snapshot.js';
import * as behaviorMod from '../../src/infrastructure/analysis/behavior/index.js';
import * as healthCacheMod from '../../src/infrastructure/analysis/health_cache.js';
import * as probeMod from '../../src/infrastructure/analysis/observe/probe.js';
import * as watchProjectToolMod from '../../src/infrastructure/index/watch_project_tool.js';
import * as instrumentMod from '../../src/infrastructure/analysis/observe/instrument.js';
import * as observePointsMod from '../../src/application/observe/observe_points.js';
import * as writeGateMod from '../../src/application/observe/write_gate.js';
import * as impactLedgerMod from '../../src/application/meta/impact_ledger_store.js';
import * as artifactRegistryMod from '../../src/infrastructure/index/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');
const REGISTRY = path.join(here, '..', 'fixtures', 'stage_registry.json');

export const OWNERS = ['project', 'dataHome'] as const;
export type Owner = (typeof OWNERS)[number];

export const FRESH_VALUES = [
  'content-hash',
  'mtime',
  'ttl',
  'version',
  'retain-n',
  'not-a-cache',
  'none-debt',
] as const;
export type Fresh = (typeof FRESH_VALUES)[number];

export interface StageDef {
  id: string;
  owner: Owner;
  /** 上游数据项 id（溯源图）；[] = 源工序 */
  inputs: string[];
  fresh: Fresh;
  /** 唯一产者 `src/...#symbol`；★ 必须是**真导出**（私有函数不算"可见的产者"） */
  producer: string;
  /** 位置解析器 `src/...#symbol`；null = 这份数据没有落盘位置（必须写 why） */
  resolver: string | null;
  why?: string;
  /**
   * ★★ 已知的**根冲突**（同一份数据出现在两个不同的根）。非空 ⇒ 计入棘轮（只许减不许增）。
   * 存在的理由：这类冲突**没法用 `owner` 单值表达**（它本来就是两个根），
   * 而"写进 why 里"没人会看见 ⇒ 必须**可以计数**，否则就是又一个"静默的债"。
   */
  rootConflict?: string;
}

export interface Registry {
  note: string;
  debtBaseline: { noneDebt: number; rootConflicts: number; notRegistered: number };
  stages: StageDef[];
  /**
   * ★ **已核实存在、但尚未登记 owner** 的数据项（每项一行，含证据）。
   * 它是本门「限度一」的**实证**：登记表要人写，门查不了"有没有漏写的"。
   * ⇒ 与其让漏写在暗处，不如**列出来并计数**（只许减不许增：每登记一条就删一条）。
   */
  notRegisteredYet?: { note: string; items: string[] };
}

/**
 * dataHome 白名单 —— 这些**解析器**以**环境**（`AGENT_IO_HOME`/包根）为根，不是以入参为根。
 * ★ 只用于 `owner: 'dataHome'` 的证伪（它没法用"两个根"跑）；`owner: 'project'` 一律走行为校验。
 *
 * ★★ 必须精确到 `file#symbol`，**不能只到模块**（2026-10-01 出生证逼出来的真缺陷）：
 *   第一版写的是模块级白名单，于是 `db.ts` 整模块被放行 —— 而 `db.ts` 里**同时**住着
 *   `projectCacheDbPath`（project）与 `featureCacheDbPath`（dataHome）两种根。
 *   ⇒ 出生证注入"dataHome + `db.ts#projectCacheDbPath`"时**照绿 = 假绿**。
 *   ⇒ 教训：白名单的粒度要与**判据的粒度**对齐；判据说的是"这个解析器的根"，名单就必须到解析器。
 */
export const DATA_HOME_RESOLVERS = new Set([
  'src/infrastructure/storage.ts#getLiveDslFile',
  'src/infrastructure/storage.ts#getFeatureFile',
  'src/infrastructure/storage.ts#getLiveFeatureFile',
  'src/infrastructure/storage.ts#getBaselineFeatureFile',
  'src/infrastructure/storage.ts#getArchiveEntryFile',
  'src/infrastructure/dogfood_stats.ts#dogfoodLogDir',
  // import_cache 归 dataHome：<dataHome>/import_cache_<feature>.db（详见登记表里那一行的 why）
  'src/infrastructure/index/db.ts#featureCacheDbPath',
  'src/infrastructure/index/registry.ts#registryFilePath',
]);

const MODULES: Record<string, Record<string, unknown>> = {
  'src/infrastructure/index/db.ts': dbMod,
  'src/infrastructure/index/symbols.ts': symbolsMod,
  'src/infrastructure/parse/project_view.ts': projectViewMod,
  'src/infrastructure/storage.ts': storageMod,
  'src/infrastructure/dogfood_stats.ts': dogfoodMod,
  'src/application/meta/semantic_search.ts': semanticSearchMod,
  'src/infrastructure/graph/import_project.ts': importProjectMod,
  'src/application/refactor/file_snapshot.ts': fileSnapshotMod,
  'src/infrastructure/analysis/behavior/index.ts': behaviorMod,
  'src/infrastructure/analysis/health_cache.ts': healthCacheMod,
  'src/infrastructure/analysis/observe/probe.ts': probeMod,
  'src/infrastructure/index/watch_project_tool.ts': watchProjectToolMod,
  'src/infrastructure/analysis/observe/instrument.ts': instrumentMod,
  'src/application/observe/observe_points.ts': observePointsMod,
  'src/application/observe/write_gate.ts': writeGateMod,
  'src/application/meta/impact_ledger_store.ts': impactLedgerMod,
  'src/infrastructure/index/registry.ts': artifactRegistryMod,
};

/** 两个**互不相同**的探针根 —— 判据的全部力量来自"拿它俩跑一遍，结果必须不同"。 */
export const PROBE_ROOT_A = path.join(os.tmpdir(), 'agentio-root-probe-a');
export const PROBE_ROOT_B = path.join(os.tmpdir(), 'agentio-root-probe-b');

export interface Verdict {
  structure: string[];
  symbols: string[];
  roots: string[];
  debt: string[];
}

export const allProblems = (v: Verdict): string[] => [...v.structure, ...v.symbols, ...v.roots, ...v.debt];

function splitRef(ref: string): { file: string; symbol: string } | null {
  const i = ref.lastIndexOf('#');
  if (i <= 0 || i === ref.length - 1) return null;
  return { file: ref.slice(0, i), symbol: ref.slice(i + 1) };
}

export function readRegistry(file = REGISTRY): Registry {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Registry;
}

/** 判定主体。★ 只读不写、**不在这里断言**（出生证 helper 要求把"门红了"与"门坏了"分开报）。 */
export function judge(reg: Registry = readRegistry()): Verdict {
  const structure: string[] = [];
  const symbols: string[] = [];
  const roots: string[] = [];
  const debt: string[] = [];

  const stages = reg.stages ?? [];
  const ids = new Set<string>();

  for (const s of stages) {
    if (!s.id) structure.push('有条目缺 id');
    else if (ids.has(s.id)) structure.push(`id 重复：${s.id}`);
    else ids.add(s.id);

    if (!OWNERS.includes(s.owner)) structure.push(`${s.id}: owner 非法（${String(s.owner)}）—— 只许 ${OWNERS.join(' / ')}`);
    if (!FRESH_VALUES.includes(s.fresh)) {
      structure.push(
        `${s.id}: fresh 非法（${String(s.fresh)}）—— 只许 ${FRESH_VALUES.join(' / ')}` +
          `（★ 不许写含糊的 'none'：必须选边 not-a-cache（本就不是缓存）或 none-debt（是缓存但缺判据））`,
      );
    }
    if (!Array.isArray(s.inputs)) structure.push(`${s.id}: inputs 必须是数组`);

    // ★ 可见性纪律：产者必须真导出；resolver 为 null 或 fresh 属"无判据"时，必须写清为什么
    if (!s.producer?.trim()) structure.push(`${s.id}: 缺 producer —— 每份数据必须声明**可见的唯一产者**`);
    const freshIsNone = typeof s.fresh === 'string' && (s.fresh === 'none-debt' || s.fresh === 'not-a-cache');
    if ((s.resolver === null || freshIsNone) && (s.why?.trim().length ?? 0) < 10) {
      structure.push(
        `${s.id}: ${s.resolver === null ? 'resolver 为 null' : `fresh='${s.fresh}'`}` +
          ` ⇒ 必须在 why 里写明原因（至少 10 字，别写"暂无"）`,
      );
    }
    if (s.rootConflict !== undefined && s.rootConflict.trim().length < 10) {
      structure.push(
        `${s.id}: 写了 rootConflict 但太短 —— 要么把**两个根分别是什么、谁写谁读**写清（≥10 字），要么别写这个字段。` +
          `（★ 半吊子的 rootConflict 比不写更坏：它让棘轮以为"这条已经记过了"）`,
      );
    }
  }

  // 溯源图：悬空引用 + 成环（"缺了往上溯源"一旦成环就永远溯不完）
  for (const s of stages) {
    for (const up of s.inputs ?? []) {
      if (!ids.has(up)) structure.push(`${s.id}: inputs 引用了不存在的工序 ${up}`);
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const byId = new Map(stages.map((s) => [s.id, s]));
  const cycle = (id: string, trail: string[]): boolean => {
    const c = color.get(id) ?? WHITE;
    if (c === BLACK) return false;
    if (c === GRAY) {
      structure.push(`溯源图成环：${[...trail, id].join(' → ')}（"缺了往上溯源"会永远溯不完）`);
      return true;
    }
    color.set(id, GRAY);
    for (const up of byId.get(id)?.inputs ?? []) {
      if (cycle(up, [...trail, id])) {
        color.set(id, BLACK);
        return true;
      }
    }
    color.set(id, BLACK);
    return false;
  };
  for (const s of stages) cycle(s.id, []);

  for (const s of stages) {
    const refs: Array<[string, string | null]> = [
      ['producer', s.producer],
      ['resolver', s.resolver],
    ];
    for (const [label, ref] of refs) {
      if (!ref) continue;
      const parts = splitRef(ref);
      if (!parts) {
        symbols.push(`${s.id}: ${label} 格式不对（要 'src/....ts#symbol'）：${ref}`);
        continue;
      }
      const mod = MODULES[parts.file];
      if (!mod) {
        symbols.push(
          `${s.id}: ${label} 的模块没进本门的静态模块表：${parts.file}\n` +
            `    ⇒ 请把它加进 tests/registry/root_declaration.test.ts 的 import + MODULES（**有意保留的摩擦力**：` +
            `新增数据项要显式确认落点）`,
        );
        continue;
      }
      if (!(parts.symbol in mod)) {
        symbols.push(
          `${s.id}: ${label} 声明为 ${ref}，但该模块**没有这个运行时导出**` +
            `（要么改名了，要么它是私有函数 —— 私有函数不算"可见的产者/解析器"）`,
        );
      }
    }
  }

  // ★★ 核心判据：owner='project' 的 resolver 必须**真的用**传进来的根
  const probeArgs = [path.join('probe', 'file.ts'), 'probeFn'] as const;
  for (const s of stages) {
    if (s.owner !== 'project' || !s.resolver) continue;
    const parts = splitRef(s.resolver);
    if (!parts) continue;
    const mod = MODULES[parts.file];
    const fn = mod?.[parts.symbol];
    if (typeof fn !== 'function') continue; // 上面 symbols 已经报过
    let rA: unknown;
    let rB: unknown;
    try {
      rA = (fn as (...a: unknown[]) => unknown)(PROBE_ROOT_A, ...probeArgs);
      rB = (fn as (...a: unknown[]) => unknown)(PROBE_ROOT_B, ...probeArgs);
    } catch (e) {
      roots.push(
        `${s.id}: resolver ${s.resolver} 拿一个项目根当首参调用时**抛错** ⇒ 它不接受"项目根"这个入参。\n` +
          `    （首参不是项目根的路径函数不能当 project 的 resolver；若这份数据其实归 dataHome，请改 owner）\n` +
          `    错误：${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const a = String(rA);
    const b = String(rB);
    if (a === b) {
      roots.push(
        `${s.id}: 声明 owner='project'（应随项目根变），但 resolver ${s.resolver} 拿两个不同的根` +
          ` 返回了**同一个值**：${a}\n` +
          `    ⇒ 它根本没在用它收到的根（这正是 health_cache 旧 bug 的形状：写死 cwd、忽略入参）。`,
      );
      continue;
    }
    if (!a.includes(PROBE_ROOT_A) || !b.includes(PROBE_ROOT_B)) {
      roots.push(
        `${s.id}: 声明 owner='project'，但 resolver ${s.resolver} 的结果里**没有自己那个根**：\n` +
          `    A ⇒ ${a}\n    B ⇒ ${b}`,
      );
    }
  }

  // owner='dataHome' 的证伪（弱一档：解析器白名单，因为它的根是环境量、跑不出"两个根"）
  for (const s of stages) {
    if (s.owner !== 'dataHome' || !s.resolver) continue;
    if (!DATA_HOME_RESOLVERS.has(s.resolver)) {
      roots.push(
        `${s.id}: 声明 owner='dataHome'，但 resolver ${s.resolver} 不在 dataHome 白名单里。\n` +
          `    ⇒ 要么它的根其实不是 dataHome（改 owner），要么它确实以 dataHome 为根但尚未登记` +
          `（把**这个解析器**加进 DATA_HOME_RESOLVERS 并写明理由）。`,
      );
    }
  }

  // 债务棘轮：none-debt 只许减不许增
  const noneDebt = stages.filter((s) => s.fresh === 'none-debt').length;
  const baseline = reg.debtBaseline?.noneDebt ?? 0;
  if (noneDebt > baseline) {
    const list = stages.filter((s) => s.fresh === 'none-debt').map((s) => s.id);
    debt.push(
      `fresh='none-debt' 的工序从 ${baseline} 涨到 ${noneDebt}（只许减不许增）。当前：${list.join(', ')}\n` +
        `    ⇒ 要么给它补新鲜判据（TTL / 指纹 / 版本），要么如实说明它其实不是缓存（改 not-a-cache）。`,
    );
  }

  // 债务棘轮：已知根冲突只许减不许增
  const conflicts = stages.filter((s) => (s.rootConflict?.trim().length ?? 0) > 0).map((s) => s.id);
  const cBase = reg.debtBaseline?.rootConflicts ?? 0;
  if (conflicts.length > cBase) {
    debt.push(
      `已知『根冲突』（同一份数据两个根）从 ${cBase} 涨到 ${conflicts.length}（只许减不许增）。当前：${conflicts.join(', ')}\n` +
        `    ⇒ 根冲突要么修掉（写读走同一个 accessor），要么确认它是有意的可覆盖参数并写清"谁保证两边一致"。`,
    );
  }

  // 债务棘轮：未登记清单只许减不许增
  const notReg = reg.notRegisteredYet?.items?.length ?? 0;
  const nBase = reg.debtBaseline?.notRegistered ?? 0;
  if (notReg > nBase) {
    debt.push(
      `『已核实存在、但尚未登记 owner』的数据项从 ${nBase} 涨到 ${notReg}（只许减不许增）。\n` +
        `    ⇒ 新发现的数据项要么**当场登记进 stages**（owner + producer + resolver），要么确认它确实是同一份数据。`,
    );
  }

  return { structure, symbols, roots, debt };
}

// ─────────────────────────────────────────────────────────────
// 门的自身有效性：**判据本身**先被验证（不靠"门绿了"来自证）
// ─────────────────────────────────────────────────────────────
describe('T19 · 根声明门的判据自身有效（防"恒真的空门"）', () => {
  const base = readRegistry();

  it('两个探针根必须不同，否则"结果必须不同"这条判据是恒真的', () => {
    expect(PROBE_ROOT_A).not.toBe(PROBE_ROOT_B);
  });

  it('★ 判据能抓 root-blind 解析器：拿两个根调一个忽略入参的函数 ⇒ 判它红', () => {
    const probe: Registry = {
      ...base,
      stages: [
        ...base.stages,
        {
          id: '__judge_probe_root_blind__',
          owner: 'project',
          inputs: [],
          fresh: 'mtime',
          producer: 'src/infrastructure/storage.ts#saveDSL',
          // getLiveDslFile() 不收参数 ⇒ 两个根返回同一个值 ⇒ 正是 health_cache 旧 bug 的形状
          resolver: 'src/infrastructure/storage.ts#getLiveDslFile',
        },
      ],
    };
    const v = judge(probe);
    expect(v.roots.join('\n')).toContain('同一个值');
  });

  it('对照项：合法的新增 project 工序 ⇒ 不该被判红（证明判据不是"见新条目就红"）', () => {
    const probe: Registry = {
      ...base,
      stages: [
        ...base.stages,
        {
          id: '__judge_probe_ok__',
          owner: 'project',
          inputs: ['source_files'],
          fresh: 'mtime',
          producer: 'src/infrastructure/index/symbols.ts#syncFile',
          resolver: 'src/infrastructure/index/db.ts#projectCacheDbPath',
        },
      ],
    };
    expect(allProblems(judge(probe))).toEqual([]);
  });

  it('对照项：resolver 首参不是项目根（feature 名）⇒ 抛错也算红，且说明要改 owner', () => {
    const probe: Registry = {
      ...base,
      stages: [
        ...base.stages,
        {
          id: '__judge_probe_bad_first_arg__',
          owner: 'project',
          inputs: [],
          fresh: 'mtime',
          producer: 'src/infrastructure/storage.ts#saveDSL',
          resolver: 'src/infrastructure/storage.ts#getFeatureFile',
        },
      ],
    };
    expect(judge(probe).roots.join('\n')).toContain('不接受');
  });
});

describe('T19 · 出生证（真实注入：改登记表 ⇒ 门变红 ⇒ 必定还原）', () => {
  const ORIGINAL = fs.readFileSync(REGISTRY, 'utf8');
  const restore = (): void => {
    try {
      fs.writeFileSync(REGISTRY, ORIGINAL, 'utf-8');
    } catch {
      neutralizeProbe(REGISTRY);
    }
  };
  const withExtra = (stage: Record<string, unknown>): void => {
    const reg = JSON.parse(ORIGINAL) as Registry;
    (reg.stages as unknown[]).push(stage);
    fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n', 'utf-8');
  };
  const run = (): Verdict => judge(readRegistry());
  const isRed = (v: Verdict): boolean => allProblems(v).length > 0;
  const render = (v: Verdict): string => allProblems(v).join(' | ').slice(0, 400);

  it('注入"声明 project 但解析器忽略入参" ⇒ 门会红（跑的是门真正用的 judge）', () => {
    expectGateGoesRed({
      name: 'T19 根声明门（行为判据）',
      mutate: () =>
        withExtra({
          id: '__gate_probe_root_blind__',
          owner: 'project',
          inputs: [],
          fresh: 'mtime',
          producer: 'src/infrastructure/storage.ts#saveDSL',
          resolver: 'src/infrastructure/storage.ts#getLiveDslFile',
        }),
      run,
      isRed,
      render,
      restore,
    });
  });

  it('注入"声明 dataHome 但解析器不在 dataHome 白名单" ⇒ 门会红', () => {
    expectGateGoesRed({
      name: 'T19 根声明门（dataHome 白名单）',
      mutate: () =>
        withExtra({
          id: '__gate_probe_wrong_home__',
          owner: 'dataHome',
          inputs: [],
          fresh: 'mtime',
          producer: 'src/infrastructure/index/symbols.ts#syncFile',
          resolver: 'src/infrastructure/index/db.ts#projectCacheDbPath',
        }),
      run,
      isRed,
      render,
      restore,
    });
  });

  it('注入"悄悄多一条 none-debt"⇒ 债务棘轮红', () => {
    expectGateGoesRed({
      name: 'T19 根声明门（债务棘轮）',
      mutate: () =>
        withExtra({
          id: '__gate_probe_new_debt__',
          owner: 'project',
          inputs: [],
          fresh: 'none-debt',
          producer: 'src/infrastructure/index/symbols.ts#syncFile',
          resolver: 'src/infrastructure/index/db.ts#projectCacheDbPath',
          why: '出生证注入：故意新增一条没有新鲜判据的工序，看棘轮拦不拦。',
        }),
      run,
      isRed,
      render,
      restore,
    });
  });

  it('注入"产者是个私有/不存在的符号"⇒ 符号真实性检查红', () => {    expectGateGoesRed({
      name: 'T19 根声明门（产者必须是真导出）',
      mutate: () =>
        withExtra({
          id: '__gate_probe_ghost_producer__',
          owner: 'project',
          inputs: [],
          fresh: 'mtime',
          producer: 'src/infrastructure/index/db.ts#noSuchExportAtAll',
          resolver: 'src/infrastructure/index/db.ts#projectCacheDbPath',
        }),
      run,
      isRed,
      render,
      restore,
    });
  });

  it('注入"悄悄多一条根冲突"⇒ 根冲突棘轮红', () => {
    expectGateGoesRed({
      name: 'T19 根声明门（根冲突棘轮）',
      mutate: () =>
        withExtra({
          id: '__gate_probe_conflict__',
          owner: 'project',
          inputs: [],
          fresh: 'mtime',
          producer: 'src/infrastructure/index/symbols.ts#syncFile',
          resolver: 'src/infrastructure/index/db.ts#projectCacheDbPath',
          rootConflict: '出生证注入：故意新增一条已知根冲突，看棘轮拦不拦。',
        }),
      run,
      isRed,
      render,
      restore,
    });
  });

  it('对照项：注入一条**完全合规**的新工序 ⇒ 门不该红', () => {
    expectGateStaysGreen({
      name: 'T19 根声明门（对照项）',
      mutate: () =>
        withExtra({
          id: '__gate_probe_ok__',
          owner: 'project',
          inputs: ['source_files'],
          fresh: 'mtime',
          producer: 'src/infrastructure/index/symbols.ts#syncFile',
          resolver: 'src/infrastructure/index/db.ts#projectCacheDbPath',
        }),
      run,
      isRed,
      render,
      restore,
    });
  });

  it('出生证过后登记表仍与原始内容逐字相同（没留下注入物）', () => {
    expect(fs.readFileSync(REGISTRY, 'utf8')).toBe(ORIGINAL);
    expect(isProbeNeutralized(path.join(REPO, 'src', '__gate_probe_never__.ts'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 门本体
// ─────────────────────────────────────────────────────────────
describe('T19 · 根声明门（每份数据声明 owner / inputs / fresh / 唯一产者 / 解析器）', () => {
  const reg = readRegistry();
  const v = judge(reg);

  it('登记表本身健康（id / owner / fresh / producer 齐全，why 写在需要的地方）', () => {
    expect(v.structure, v.structure.join('\n')).toEqual([]);
  });

  it('产者与解析器都必须是**真导出**（私有函数不算"可见的产者"）', () => {
    expect(v.symbols, v.symbols.join('\n')).toEqual([]);
  });

  it('★ 每个 owner=\'project\' 的解析器都**真的在用**传进来的项目根（两个根 ⇒ 结果必须不同）', () => {
    expect(v.roots, v.roots.join('\n')).toEqual([]);
  });

  it('债务棘轮：fresh=\'none-debt\' 的工序数未增长', () => {
    expect(v.debt, v.debt.join('\n')).toEqual([]);
  });

  it('债务棘轮：已知『根冲突』与『未登记清单』都只许减不许增', () => {
    expect(v.debt.filter((m) => m.includes('根冲突') || m.includes('尚未登记'))).toEqual([]);
  });

  it('未登记清单每项都要带证据（路径/文件:行），不是一句口号', () => {
    const items = reg.notRegisteredYet?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.length, `这一项太短、看不出证据：${it}`).toBeGreaterThan(15);
      expect(/[/.]/.test(it), `这一项没有可核对的落点：${it}`).toBe(true);
    }
  });

  it('溯源图是 DAG（"缺了往上溯源"不会绕回来）', () => {
    // 成环的报错走 structure（cycle() 写进去的），这里单独断言一次语义
    expect(v.structure.filter((m) => m.includes('成环'))).toEqual([]);
  });

  it('每份数据都声明了 owner 与唯一产者（登记表非空且覆盖已知工序）', () => {
    expect(reg.stages.length).toBeGreaterThanOrEqual(18);
    for (const s of reg.stages) {
      expect(OWNERS, `${s.id} 的 owner`).toContain(s.owner);
      expect(s.producer, `${s.id} 的 producer`).toBeTruthy();
    }
  });
});
