/**
 * design_line —— 设计链【六步读数】（工具面入口，从 `scripts/design-line.mjs` 收进来）
 *
 * ## 它回答一个问题
 * "这条业务线现在到哪一步了、每步的产物是什么、有多少"
 *
 * ## 业务链（用户 2026-10-19 定义）
 * ```
 * 源码 → 实际 DB → 实际 DSL → 设计 DSL → 设计 DB → 源码（重写）
 *  ①       ②          ③           ④          ⑤         ⑥
 * ```
 *
 * ## ★ ⑥ 为什么不再写"未实现"
 * 旧脚本对 ⑥ 只能打印 `未实现 —— 这是 VISION.md §6 的"接入重构线"`。
 * 那是一句**装饰**：读的人得不到任何读数，也看不出还差多少。
 * 现在它给一条**真读数**：设计 DB 覆盖了多少源码文件、还有多少没覆盖。
 * ★ 这只是**计数级**（不是符号级）：符号级差分归 `rewrite` / `design-diff`。
 *
 * ## 纪律
 * - **只读**：不碰任何文件、不写 DSL、不改源码。
 * - `lineReport` 是纯函数（给 root + feature，返回结构化读数），`designLineHandler` 只做入参适配
 *   ⇒ 判据能单测，不用起 MCP。
 */
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
import { analyzeImpact } from '../../../infrastructure/analysis/impact/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
// ★ 2.5「管辖范围」：`excluded` 的**并集**与**前缀匹配**只住 gen_design_db（那两处是唯一实现）；
//   `loadDesignSheetsForGate` 是「哪些册属于本项目」的唯一读端 ⇒ 本文件不自己数册、不自己写前缀匹配。
import {
  designDbDir,
  excludedNodeConflicts,
  excludedPathsOf,
  isExcludedPath,
  loadDesignSheetsForGate,
  type ExcludedNodeConflicts,
} from '../db/gen_design_db.js';
// ★ 2.5「分母口径」：率的唯一产出点 —— 内部强制分子 ⊆ 分母，且文本自带「回答哪个问题」
import { rateOf } from '../../../domain/rate.js';
// ★★★ 2026-11-04（A4）：职责真填充率的**计数**（判定住 `responsibilityVerdict`；率住 `rateOf`）。
import { responsibilityTally } from '../../../domain/semantic.js';
// ★ slice 2c：卡已搬出册 ⇒ 卡数读数必须问库（getDesignSheet 是唯一读端，含 hydrate）
import { getDesignSheet } from '../../../infrastructure/storage.js';
// ★ 沉默缺口的**分母**只能从盘上取 —— 走索引器自己的走查（`walkFiles` = 「什么算源码」的唯一权威）。
//   不走 `cache.db files`：那是**产物**，新文件在重建索引前不在里面 ⇒ 门看不见它 = 永久假绿。
import { walkFiles } from '../../../infrastructure/graph/import_project.js';

/** 单步读数 */
export interface LineStep {
  /** ①..⑥ */
  id: string;
  /** 这一步叫什么 */
  name: string;
  /** 谁干这活（工具名 / 人） */
  by: string;
  /** ok=有产物 · missing=产物不存在 · pending=还没实现 */
  status: 'ok' | 'missing' | 'pending';
  /** 一句话读数（带数字） */
  reading: string;
}

export interface LineReport {
  feature: string;
  steps: LineStep[];
  /** 六步里 ok / missing / pending 各几个 —— 便于一眼看"断在哪" */
  tally: { ok: number; missing: number; pending: number };
  /**
   * ★★★ 2026-11-05（R12①）：**声明与节点不许共存**的一致性读数（现算、不落盘）。
   *
   * 为什么不单开一个 action（0.25② 入口数不增）：`lineReport` **本来就在读这批册**
   * （⑥ 那格的 `excludedPathsOf(loadDesignSheetsForGate(root).sheets)` 就是全册并集）——
   * 同一个读端、同一份册，只多一个纯函数取值。而 `structure_gap` 读的是盘上
   * `structure.domains.json` + 目录现状，**连设计册都不读** ⇒ 接进去等于给它开第二个读端（0.31 违规）。
   */
  excluded_node_conflicts: ExcludedNodeConflicts;
}

const n = (x: number): string => x.toLocaleString('en-US');

// ───────────────────────────────────────────────────────────────────────────
// 沉默缺口（盘上有 ∧ 册上无 ∧ 未声明排除）—— **唯一实现**
// ───────────────────────────────────────────────────────────────────────────
//
// ★ 为什么它是导出函数、而不是 `lineReport` 里的一段内联代码：
//   同一个判断有**两个消费者**（⑥ 的读数 + `npm run verify` 的「结构意图」门）。内联 ⇒ 门要另写一遍
//   ⇒ 门与读数各按各的口径漂（0.9.1：同一事实只许一处权威）。
//
// ★ 输入都是**数据**（`silentGapOf` 不读盘）⇒ 它是纯函数、`behavior-cases` 判得了；
//   读盘那一层收在 `silentGapsOf`，它只做「取输入」一件事。
//
// ★★★ 2026-11-05（R32）：**四桶互斥穷尽**。改前三档把 `source_files` 分完了，但分得**不诚实** ——
//   `with_node` 只回答「册里有没有节点」，于是"有节点 ∧ 又被册级 `excluded` 声明命中"这件事被它**吞掉**
//   （那批文件既在册上被声明不管、又拿着节点与判据），而结构门把它们全读成"已入册"
//   ⇒ 门对整场冲突**结构性失明**。★ 具体数字**不写在这里**（会漂）：跑
//   `node scripts/structure-gate.mjs --json` 的 `conflicts` 段现取，别抄。
//
// ★★ **不许靠「先判 excluded 后判 nodes」来修**（那是被推翻的第一版提案，理由逐字留在这里）：
//   那会把冲突文件报成"已声明排除" = **换个方向说假话** —— 它们的判据
//   **在 judge 里真的在跑**（判据批用的是**原始册** `collectExpectations(dsl)`，`excluded` **挡不住判据执行**）
//   ⇒ 「已排除」对 judge 侧是假话。缺的是**一档**，不是**判序**。
//
// ★ 闭合不变量有**两条**，都落成可执行断言（不是注释里的等式 —— 注释没有变量，等式写进去也是快照）：
//   ① `source_files === with_node + excluded + conflict + gaps` → `assertSilentGapClosed`
//   ② `册上 === 本门 + 幽灵 + 本门口径外` → `assertConflictUniverseClosed`
//   ★ 两条各有一条**消融**（喂一份坏输入 ⇒ 必抛）：`tests/p0_wire_gates.test.ts` 的 ⑥ 段。

export interface SilentGapInput {
  /** 分母：盘上的源文件（仓库相对、正斜杠） */
  source_files: readonly string[];
  /** 在设计册里有节点的文件（`geometry.nodes[].path` = 结构登记处） */
  node_paths: readonly string[];
  /** 全册 `excluded` 并集（带 reason；前缀匹配） */
  excluded: ReadonlyArray<{ path: string; reason: string }>;
  /**
   * ★★★ 2026-11-05（R32）：**冲突路径** —— 既在设计册里有节点 ∧ 又被册级 `excluded` 声明命中。
   *
   * ★ 由**调用方**从**既有权威**喂入：`excludedNodeConflicts(sheets).conflicts.map((c) => c.path)`
   *   （判定核 = `gen_design_db.ts#excludedNodeConflicts`，`silentGapsOf` 已经把它算好并透传）。
   *   ⇒ 本函数**不自己再算一遍**「既声明又有节点」（0.9.1：同一事实的第二份实现 = 违例）。
   * ★ 缺省 `[]` ⇒ 与"三档时代"逐字同结果（只是多两个 0/空数组字段）；四桶闭合不变量照样成立。
   */
  conflict_paths?: readonly string[];
}

/**
 * 沉默缺口的读数（**四桶互斥穷尽** + 逐个点名的缺口）。
 *
 * ★ `with_node` 的语义在 R32 收窄为「**干净入册**」= 有节点 ∧ **不在** `conflict_paths` 里。
 *   读端**不许**把旧名读回旧义（旧义「有节点」把冲突也数进去了，那正是这场失明的成因）：
 *   打印文案一律写「干净入册」，`conflict` 单列。
 */
export interface SilentGapReading {
  /** 分母：盘上源文件数 */
  source_files: number;
  /** **干净入册**：有节点 ∧ **不在** `conflict_paths` 里（冲突不再计入这一档） */
  with_node: number;
  /** 无节点 ∧ 被声明排除（**沉默**：声明了不管，且确实没管 —— 这是正规形态） */
  excluded: number;
  /** 有节点 ∧ 在 `conflict_paths` 里（**既声明又被建节点**：声明与节点共存，待逐条裁决） */
  conflict: number;
  /** 冲突文件逐个点名（升序；`conflict === conflict_list.length`） */
  conflict_list: string[];
  /** 四档都不是 ⇒ 缺口（逐个点名，升序） */
  gaps: string[];
}

/** 路径归一（正斜杠 + 去空白）；**只做归一，不猜** */
const relKey = (p: unknown): string => String(p ?? '').replace(/\\/g, '/').trim();

/** 沉默缺口的**判定核**（纯函数：无 IO、无缓存、无顺序依赖） */
export function silentGapOf(input: SilentGapInput): SilentGapReading {
  const nodes = new Set(input.node_paths.map(relKey).filter(Boolean));
  const declared = new Set((input.conflict_paths ?? []).map(relKey).filter(Boolean));
  const files = [...new Set(input.source_files.map(relKey).filter(Boolean))].sort();
  let withNode = 0;
  let excludedCount = 0;
  let conflictCount = 0;
  const conflictList: string[] = [];
  const gaps: string[] = [];
  for (const f of files) {
    const hasNode = nodes.has(f);
    const inConflict = declared.has(f);
    // ★ 判序按「有没有节点」先分开，**不是**按"先 excluded" —— 见文件头那段（0.9.1 + 不许换方向说假话）
    if (hasNode && inConflict) {
      conflictCount += 1;
      conflictList.push(f);
      continue;
    }
    if (hasNode) {
      withNode += 1;
      continue;
    }
    if (isExcludedPath(input.excluded, f)) {
      excludedCount += 1;
      continue;
    }
    if (inConflict) {
      // ★ 闭合不变量 ②：`conflict ⊆ with_node ∪ excluded` —— 两边都不在 ⇒ 调用方喂错了（不是缺口）
      throw new Error(
        `silentGapOf：冲突路径 ${f} 既没有节点、也不被 excluded 声明命中 ⇒ conflict_paths 不是 ` +
          'excludedNodeConflicts 的产物（四桶闭合不变量被破坏：冲突项必须至少落在 with_node 或 excluded 里）',
      );
    }
    gaps.push(f);
  }
  // ★ 闭合不变量 ①（四桶和 === source_files）与 ②（conflict_list 与 conflict 同口径）**只住一处**：
  //   `assertSilentGapClosed` —— 抽成导出纯函数是为了让**检查器自身可被消融**
  //   （喂它一份不闭合的读数 ⇒ 它必抛；住在实现体里就没法这样测，等于没有鉴别力）。
  const reading: SilentGapReading = {
    source_files: files.length,
    with_node: withNode,
    excluded: excludedCount,
    conflict: conflictCount,
    conflict_list: conflictList,
    gaps,
  };
  assertSilentGapClosed(reading);
  return reading;
}

/**
 * ★★★ 2026-11-05（R32）：**四桶闭合不变量的唯一实现**（可判、可消融）。
 *
 * 它回答一句话：**这四个数真的是对 `source_files` 的一个分区吗？**
 * · 成立 ⇒ 读端可以把四个数当"同一件事的四个互斥部分"相加/相减；
 * · 不成立 ⇒ 实现有 bug（某类文件被数了两次、或一个都没数到）⇒ **当场抛**，不许悄悄少一条。
 *
 * ★ 为什么它是导出函数而不是 `silentGapOf` 里的一段 if：消融需要**喂它一份坏读数**。
 * ★ **只做事实核对，不做修正**：不"帮忙"补齐差额 —— 补齐就是把 bug 藏起来（0.9.4 第 1 行同族）。
 */
export function assertSilentGapClosed(r: SilentGapReading): void {
  const sum = r.with_node + r.excluded + r.conflict + r.gaps.length;
  if (sum !== r.source_files) {
    throw new Error(
      `silentGapOf：四桶不闭合 —— source_files ${r.source_files} ≠ 干净入册 ${r.with_node} + 已声明排除 ${r.excluded} + ` +
        `冲突 ${r.conflict} + 缺口 ${r.gaps.length} = ${sum}`,
    );
  }
  if (r.conflict !== r.conflict_list.length) {
    throw new Error(
      `silentGapOf：冲突的**数**与**名单**不同口径 —— conflict ${r.conflict} ≠ conflict_list ${r.conflict_list.length}` +
        '（读端会拿这两个数做二选一，不一致就说明有一条冲突既被数了又没被点名）',
    );
  }
}

/** {@link silentGapsOf} 的读数（= 四桶 + 冲突的逐条原样读数） */
export interface SilentGapsReading extends SilentGapReading {
  /**
   * 冲突的逐条**原样读数**（`excludedNodeConflicts` 的输出透传 —— 本文件不重算、不改形）。
   *
   * ★ 为什么透传整份而不是只给个数：结构门（`scripts/structure-gate.mjs`）要
   *   ① **并排印多个口径**（本门 `conflict` / 册上 `conflicts.conflict_files` / 幽灵 / 口径外）——
   *      数不一样时**不许概括成一句**，差的那几个必须逐个点名（0.12③ / 0.9.4）；
   *   ② 给基线逐条登记 `{path, declared, nodes, expectations}`（缺了它们，挂账条目点不出"该裁哪一处"）。
   */
  conflicts: ExcludedNodeConflicts;
  /**
   * ★★★ R32：**册上口径有、本门（`walkFiles` 宇宙）看不到**的冲突路径（升序）。
   *
   * `on_disk=false` ⇒ **幽灵节点**（册里有节点、盘上没这个文件）；`on_disk=true` ⇒ **本门口径外**
   * （盘上有，但 `walkFiles(includeTests=false)` 不收，例如 `tests/` 被整体跳过）。
   *
   * ★ 为什么由本函数算而不是让门自己算：三个口径的**闭合等式**
   *   （册上 = 本门 + 幽灵 + 口径外）必须只有一个住处，否则两个读端各算一次、各按各的口径漂（0.9.1）。
   *   等式在 {@link assertConflictUniverseClosed} 里**现算并断言**（不成立就抛）。
   */
  conflict_outside: Array<{ path: string; on_disk: boolean }>;
}

/**
 * ★★★ 2026-11-05（R32）：**三个口径的闭合不变量**（可执行断言，不是注释里的等式）。
 *
 * 它回答：`excludedNodeConflicts`（册上口径）数出来的冲突，能不能被**本门看得见的**
 * 加上**两类看不见的**（幽灵 / 口径外）**刚好分完**？
 * · 成立 ⇒ 三个数可以并排印，读端知道自己看到的是哪一部分；
 * · 不成立 ⇒ 有人改了计数口径（比如把"文件"改成"节点"、或把 `includeTests` 翻成 true、
 *   或幽灵被清掉却没同步）⇒ **当场抛**，而不是留下一句已经漂掉的注释。
 *
 * ★ 注释里**不写任何数字**（注释没有变量 ⇒ 写进去的等式也是快照，且它自己不会红）。
 *   现取数字：`node scripts/structure-gate.mjs --json` 的 `conflicts.equation`。
 */
export function assertConflictUniverseClosed(u: {
  /** 册上口径：`excludedNodeConflicts().conflict_files`（去重文件数） */
  book_files: number;
  /** 本门口径：`walkFiles` 宇宙里落在冲突桶的文件数（= 四桶里的 `conflict`） */
  gate_conflict: number;
  /** 册上有、盘上**不存在**的冲突路径数（幽灵节点） */
  ghosts: number;
  /** 册上有、盘上存在但被 `walkFiles(includeTests=false)` 跳过的冲突路径数 */
  out_of_scope: number;
}): void {
  const sum = u.gate_conflict + u.ghosts + u.out_of_scope;
  if (sum !== u.book_files) {
    throw new Error(
      `冲突三个口径不闭合 —— 册上 ${u.book_files} ≠ 本门 ${u.gate_conflict} + 幽灵 ${u.ghosts} + ` +
        `本门口径外 ${u.out_of_scope} = ${sum}（口径或计数规则变了 ⇒ 不许当成"数字差了一点"）`,
    );
  }
}

/**
 * 沉默缺口 + 冲突的**读数**：把输入从盘上与册上取来，交给 {@link silentGapOf}。
 *
 * ★ 分母走 `walkFiles`（索引器自己的走查：跳依赖/产物/归档/测试文件，按代码语言后缀取交集）——
 *   **不读 `cache.db`**：索引是产物，新文件在重建索引之前不在里面 ⇒ 门会「看不见新文件」而永久假绿
 *   （AGENTS-RULES 0.12 第 2 条：门的输入不许是环境态）。
 * ★ 册走 `loadDesignSheetsForGate`（「哪几册属于本项目」的唯一读端）+ `excludedPathsOf`（全册并集）。
 * ★★★ R32：冲突走 `excludedNodeConflicts`（**判定核只有那一处**）—— 本函数只做「取来喂进去」，
 *   并在返回前用 {@link assertConflictUniverseClosed} 把三个口径的闭合**断言**掉。
 */
export function silentGapsOf(root: string): SilentGapsReading {
  const sheets = loadDesignSheetsForGate(root).sheets;
  const excludedList = excludedPathsOf(sheets);
  const nodePaths: string[] = [];
  for (const s of sheets) {
    for (const node of s.geometry?.nodes ?? []) {
      const p = relKey((node as { path?: string }).path);
      if (p) nodePaths.push(p);
    }
  }
  const conflicts = excludedNodeConflicts(sheets);
  const sourceFiles = walkFiles(root, false, false, null).map((abs) => relKey(path.relative(root, abs)));
  const reading = silentGapOf({
    source_files: sourceFiles,
    node_paths: nodePaths,
    excluded: excludedList,
    conflict_paths: conflicts.conflicts.map((c) => c.path),
  });
  // ★ 三个口径的闭合：清单只读一次、分区只切一次（`fs.existsSync` 是**目标内容**类合法输入，0.12 第 2 条）
  const inGate = new Set(reading.conflict_list);
  const conflictOutside = [...new Set(conflicts.conflicts.map((c) => c.path))]
    .filter((p) => !inGate.has(p))
    .sort()
    .map((p) => ({ path: p, on_disk: fs.existsSync(path.join(root, p)) }));
  const ghosts = conflictOutside.filter((x) => !x.on_disk).length;
  assertConflictUniverseClosed({
    book_files: conflicts.conflict_files,
    gate_conflict: reading.conflict,
    ghosts,
    out_of_scope: conflictOutside.length - ghosts,
  });
  return { ...reading, conflicts, conflict_outside: conflictOutside };
}

/** 六步读数（纯函数：只读磁盘与 cache.db） */
export function lineReport(root: string, feature: string): LineReport {
  const p = {
    db: path.join(root, '.agent-io', 'cache.db'),
    live: path.join(root, '.agent-io', 'live', `${feature}.dsl.json`),
    design: path.join(root, '.agent-io', 'design', `${feature}.dsl.json`),
    designDb: designDbDir(root),
  };

  // ── ① 源码 → 实际 DB ──
  let dbFiles = 0;
  let dbSymbols = 0;
  let dbCalls = 0;
  const sourceFiles: string[] = [];
  if (fs.existsSync(p.db)) {
    const db = new DatabaseSync(p.db, { readOnly: true });
    try {
      // ★ 与旧脚本同口径：排除 scripts/ 与 dogfood/（它们不是产品面）
      const rows = db
        .prepare("SELECT path FROM files WHERE path NOT LIKE 'scripts/%' AND path NOT LIKE 'dogfood/%'")
        .all() as Array<{ path: string }>;
      for (const r of rows) sourceFiles.push(r.path);
      dbFiles = sourceFiles.length;
      dbSymbols = (db.prepare('SELECT COUNT(*) c FROM nodes WHERE parent IS NULL').get() as { c: number }).c;
      dbCalls = (db.prepare("SELECT COUNT(*) c FROM edges WHERE kind = 'call'").get() as { c: number }).c;
    } finally {
      db.close();
    }
  }

  // ── ② 实际 DB → 实际 DSL ──
  let liveNodes = 0;
  let liveEdges = 0;
  if (fs.existsSync(p.live)) {
    const j = JSON.parse(fs.readFileSync(p.live, 'utf8'));
    liveNodes = j.geometry?.nodes?.length ?? 0;
    liveEdges = j.geometry?.edges?.length ?? 0;
  }

  // ── ③ / ④ 设计 DSL（人写意图）= ③ 的产物 ──
  /**
   * 设计册 `excluded`（排除清单，2026-10-24 裁 A）：显式排除的路径不是沉默缺口，是管辖范围声明。
   *
   * ★★ 2026-11-03（M2a）：**必须按全册并集读** —— 只读本册会让同一次跑给出两种答案。
   * 不变量：排除清单声明的是**整个项目的管辖边界**（`gen_design_db#planDesignDb` 一直按全册并集用），
   * 而一个项目下可以有多册 ⇒ 按"当前 feature 那一册"读，`excluded` 就随调用方是谁而变，
   * 而沉默缺口的分子分母都不随 feature 变 ⇒ 两者不是同一把尺（实测：同一次跑，
   * agent-io 报「显式排除 0 条」、task-system-plan 报「4 条」，而沉默缺口两边都是 97）。
   * ★ 并集只住 `excludedPathsOf`（gen_design_db）—— 本文件不再写第二份。
   */
  // ★★ 2026-11-05（R12①）：册**只读一次** —— 排除清单与"声明∩节点"冲突取自同一份（同一把尺）。
  const sheetsForLine = loadDesignSheetsForGate(root).sheets;
  const excludedList = excludedPathsOf(sheetsForLine);
  /**
   * ★ 一致性读数（R12①）：`excluded ∩ nodes = ∅`。它回答"有多少文件既被声明排除、册里又有节点"，
   * 而那两个受影响的读者（写闸按节点判 / 投影按声明跳过）取的是**相反**结论。
   */
  const conflictsReading = excludedNodeConflicts(sheetsForLine);
  let dNodes = 0;
  let dDecisions = 0;
  let dReqs = 0;
  let dTodos = 0;
  /** ④ 的职责填充读数（A4）：只有设计册读得到 ⇒ 无册时为 null（**不造假 0**，0.12） */
  let dRespTally: ReturnType<typeof responsibilityTally> | null = null;
  if (fs.existsSync(p.design)) {
    const j = JSON.parse(fs.readFileSync(p.design, 'utf8'));
    dNodes = j.geometry?.nodes?.length ?? 0;
    dDecisions = (j.geometry?.nodes ?? []).filter((x: { decision?: unknown }) => x.decision).length;
    dReqs = (j.geometry?.nodes ?? []).reduce(
      (s: number, x: { decision?: { expectations?: unknown[] } }) => s + (x.decision?.expectations?.length ?? 0),
      0,
    );
    dTodos = (j.todos ?? []).length;
    dRespTally = responsibilityTally(
      (j.semantic?.files ?? []) as Array<{ path?: string; responsibility?: string }>,
    );
  }

  // ── ⑤ 设计 DSL → 设计 DB ──
  let dbCount = 0;
  let dbSyms = 0;
  let dbCalls2 = 0;
  let dbReqs = 0;
  /** 设计 DB 覆盖了哪些源码文件（用副本里记的 path，不靠文件名猜） */
  const covered = new Set<string>();
  if (fs.existsSync(p.designDb)) {
    for (const f of fs.readdirSync(p.designDb)) {
      if (!f.endsWith('.calls.json')) continue;
      dbCount += 1;
      const j = JSON.parse(fs.readFileSync(path.join(p.designDb, f), 'utf8'));
      dbSyms += j.symbols?.length ?? 0;
      dbCalls2 += j.calls?.length ?? 0;
      dbReqs += j.requirements_calls?.length ?? 0;
      // ★ 2026-10-19：**优先读 `path` 字段**（副本自报路径，gen-design-db 已输出）。
      //   只有在读旧产物（没有该字段）时才退回解析首行 `//` 注释 —— 那是给人看的，格式一变就断，
      //   不再作为主路径。
      if (typeof j.path === 'string') covered.add(j.path.replace(/\\/g, '/'));
      else {
        const m = String(j['//'] ?? '').match(/——\s*([^\s（(]+)/u);
        if (m) covered.add(m[1].replace(/\\/g, '/'));
      }
    }
  }

  // ── ⑥ 设计 DB → 源码：★ 真读数（覆盖差），不是"未实现" ──
  // ★ 2026-10-24：显式排除（设计册 excluded，path 支持目录前缀）——排除的不是缺口，是管辖范围声明。
  // ★★ 2026-11-03（M2a）：前缀匹配改用 `gen_design_db#isExcludedPath`（唯一实现）——
  //   本文件原先自己写了一份 `p === x.path || p.startsWith(x.path)`，那是同一判据的第二把尺。
  // ★★ 2026-11-03（2.5「分母口径」）：**分子必须与分母取交** —— `covered` 是 design-db 的**全部** path，
  //   它**不保证**是 `sourceFiles` 的子集（实测 3 份不在分母里：`docs/VISION.md` 等）⇒ 直接相除时
  //   「覆盖率」恒偏高、可以 >100%，而错得看不出来。取交后 `coveredInSource ⊆ sourceFiles`，
  //   且 `coveredInSource` 与 `coveredOutOfSource` 加起来才等于分母。
  // ★ 沉默缺口**不在这把尺上**：它回答「盘上源文件在册上有没有归属」（分母 = 盘上源文件，走
  //   `silentGapsOf`），与本步「设计 DB 副本覆盖了索引里多少源码」是两个问题 —— 别把两个数相加。
  const sourceSet = new Set(sourceFiles);
  const coveredInSource = [...covered].filter((p) => sourceSet.has(p));
  // ★ 越界的那几份**不许静默丢**（0.12）：它们不参与覆盖，但必须在读数里被点名 —— 否则
  //   「design-db 有 N 份」与「覆盖 M」之间的差就没人解释。
  const coveredOutOfSource = [...covered].filter((p) => !sourceSet.has(p));
  // ★ 沉默缺口**唯一实现**在 `silentGapsOf`（分母 = 盘上源文件 + 册上节点 path + 全册排除并集）。
  //   改前这里是 `sourceFiles.filter(... !covered.has(s) ...)` —— 那让「缺口」的分母是 cache.db 索引、
  //   而 verify 的门若另写一遍就必然与它分叉（同一件事两把尺）。
  const gapReading = silentGapsOf(root);
  const cover = rateOf({
    n: coveredInSource.length,
    d: sourceFiles.length,
    question: 'design-db-covers-source',
    nItems: coveredInSource,
    dItems: sourceFiles,
  });

  const steps: LineStep[] = [
    {
      id: '①',
      name: '源码 → 实际 DB',
      by: 'import_project（扫描 + 符号 + 调用边）',
      status: dbFiles ? 'ok' : 'missing',
      reading: dbFiles
        ? `cache.db：${n(dbFiles)} 文件 · ${n(dbSymbols)} 符号 · ${n(dbCalls)} 调用边`
        : 'cache.db 不存在',
    },
    {
      id: '②',
      name: '实际 DB → 实际 DSL',
      by: 'renderLiveFromDb（投影）',
      status: liveNodes ? 'ok' : 'missing',
      reading: liveNodes ? `live/：${n(liveNodes)} 节点 · ${n(liveEdges)} 边` : 'live/ 不存在（跑 import_project）',
    },
    {
      id: '③',
      name: '实际 DSL → 设计 DSL',
      by: 'fork（一次性，之后由人写）',
      status: dNodes ? 'ok' : 'missing',
      reading: dNodes
        ? `design/：${n(dNodes)} 节点 · ★ ${dDecisions} 个 decision · ${n(dReqs)} 条 expectations · ${dTodos} 张卡`
        : 'design/ 不存在',
    },
    {
      id: '④',
      name: '在设计 DSL 上写意图',
      by: 'edit_dsl / design_intent（人写）',
      status: dDecisions ? 'ok' : 'pending',
      reading:
        (dDecisions ? `已写：${dDecisions} 个 decision（其中 ${n(dReqs)} 条判据）` : '还没写 decision') +
        (dRespTally
          ? ` · 职责 ${
              rateOf({
                n: dRespTally.ok,
                d: dRespTally.total,
                question: 'responsibility-filled',
                nItems: dRespTally.filledPaths,
                dItems: dRespTally.allPaths,
              }).text
            }（空 ${dRespTally.empty} · 占位 ${dRespTally.filename.length + dRespTally.statistical.length}）`
          : ''),
    },
    {
      id: '⑤',
      name: '设计 DSL → 设计 DB',
      by: 'gen-design-db（全量，与实际 DB 同构）',
      status: dbCount ? 'ok' : 'missing',
      reading: dbCount
        ? `design-db/：${dbCount} 份 · ${n(dbSyms)} 符号 · ${n(dbCalls2)} 调用 · ★ ${dbReqs} 条设计要求`
        : '设计 DB 未生成',
    },
    {
      id: '⑥',
      name: '设计 DB → 源码（重写）',
      by: 'rewrite（结构重写：只改签名，实现永远人写）',
      status: dbCount && sourceFiles.length ? 'ok' : 'missing',
      reading:
        dbCount && sourceFiles.length
          ? `覆盖：${cover.text}；` +
            (coveredOutOfSource.length
              ? `★ 另有 ${coveredOutOfSource.length} 份设计 DB 副本的 path **不在源码集里**（不参与覆盖，逐个点名）：${coveredOutOfSource.join(' ; ')}；`
              : '') +
            `★ 沉默缺口（盘上有 ∧ 册上无 ∧ 未声明排除）：源码 ${n(gapReading.source_files)} 个 · ` +
            // ★ R32：这里印的是**四桶**（`with_node` 已收窄为"干净入册"，冲突单列）—— 读端不许把旧名读回旧义
            `干净入册 ${n(gapReading.with_node)} · 已声明排除 ${n(gapReading.excluded)} · ` +
            `**冲突 ${n(gapReading.conflict)}** · 缺口 ${n(gapReading.gaps.length)} 个（排除**声明** ${excludedList.length} 条）` +
            (gapReading.gaps.length
              ? `：${gapReading.gaps.slice(0, 10).join(' ; ')}${gapReading.gaps.length > 10 ? ' …' : ''}` +
                ` —— 逐个裁「纳入/显式排除」（意图推不出来，不自动建节点；纳入后走 L1 建构卡）`
              : '')
          : '设计 DB 或源码缺失，无法算覆盖',
    },
  ];

  const tally = { ok: 0, missing: 0, pending: 0 };
  for (const s of steps) tally[s.status] += 1;
  return { feature, steps, tally, excluded_node_conflicts: conflictsReading };
}

/** MCP handler（只做入参适配 + 渲染文本） */
export function designLineHandler(input: { project_dir: string; feature: string }): {
  message: string;
  data: LineReport;
} {
  const report = lineReport(input.project_dir, input.feature);
  const icon = (s: LineStep['status']): string => (s === 'ok' ? '✓' : s === 'missing' ? '✗' : '·');
  const lines = [
    `设计链 · ${report.feature}（ok ${report.tally.ok} / missing ${report.tally.missing} / pending ${report.tally.pending}）`,
  ];
  for (const s of report.steps) {
    lines.push(`${s.id} ${s.name}  ${icon(s.status)}`);
    lines.push(`    ${s.by}`);
    lines.push(`    ${s.reading}`);
  }
  // ★★★ 2026-11-05（R12①）：**声明与节点不许共存**的读数（每条点名「文件 · 哪册哪个前缀 · 几条判据」，
  //   并给三个分母）—— 它是一条**一致性不变量**，不是第六步的产物，故单独一行、不混进 steps。
  const exc = report.excluded_node_conflicts;
  lines.push(
    '',
    `★ 一致性（excluded ∩ nodes 必须为空）：冲突 ${exc.conflict_files} 个文件 / ${exc.conflict_nodes} 个节点 / ${exc.expectations} 条判据` +
      `（分母：excluded 声明 ${exc.excluded_decls} 条 · 册里节点 ${exc.total_nodes} 个）`,
  );
  if (exc.conflict_nodes) {
    lines.push(
      '  为什么这是矛盾：投影按 excluded **无条件跳过**（那 ' +
        String(exc.conflict_nodes) +
        ' 个节点与它们的 ' +
        String(exc.expectations) +
        ' 条判据不进 design-db），写闸却按节点判（同一批文件**仍受任务闸**）⇒ 两个读者取相反结论。逐条：',
    );
    for (const c of exc.conflicts.slice(0, 12)) {
      lines.push(`  · ${c.path} ← 声明 ${c.declared}；节点 ${c.node}（${c.feature} 持有，${c.expectations} 条判据）`);
    }
    if (exc.conflict_nodes > 12) lines.push(`  …另有 ${exc.conflict_nodes - 12} 条（data.excluded_node_conflicts.conflicts 全量）`);
    lines.push('  ⇒ 改法二选一：移出该册 excluded（保留节点与判据），或删节点（★ 该节点判据 > 0 时**只许**走前者）。');
  } else {
    lines.push('  ✓ 0 条：声明与节点全不相交。');
  }
  lines.push('★ 只读：不改 DSL、不改源码。');
  return { message: lines.join('\n'), data: report };
}


// ───────────────────────────────────────────────────────────────────────────
// ★「只在设计侧」⇒ `must_have`（该文件/目录**必含哪些符号**）
// ───────────────────────────────────────────────────────────────────────────
//
// ## 为什么需要它
// `action=diff` 原来只报到**节点级**（"这个文件设计了、还没有"），LLM 要写实现
// （`edit_code op=symbol`）时仍得自己从 `scope` / 边去猜"里面该有哪些函数" —— 猜错就白写一轮。
// `must_have` 把这件事直接摆在 diff 结果里。
//
// ## 符号只能从设计侧**已有的记录**里取（不编造）
// 三个来源，按可信度排序：
// 1. `decision.expectations[kind=symbol-exists]` —— 决策卡**明说**"这个文件里必须有这个符号"
//    （带 `why`）。这是唯一"人以判据形式写过"的来源，优先级最高。
// 2. `semantic.files[path].symbols` —— 设计 DSL 自带的符号事实（fork 时从源码带来）。
//    它是**记录**，不是设计意图；所以 `from` 标 `semantic.files`，LLM 自己能分辨。
// 3. 目录节点：先**下钻到文件级**（子文件节点 ∪ `semantic.files` 条目），再取这些文件的符号。
//    目录名本身说不出里面有什么 —— 不下钻就等于没答。
//
// ## 信息不够时必须明说
// 一个节点真的没有符号可列（目录下没有文件、文件没有符号记录、也没有决策卡判据）⇒
// `must_have: []` + `why_empty: '<具体查了什么、缺什么>'`，**不许静默空**。
// ★ 铁律：宁可空着报 why_empty，也不许把"推测"写成 `must_have`。

/** 设计侧说"这个文件里该有的一个符号" */
export interface MustHaveSymbol {
  name: string;
  /** 种类：`symbol-exists`（决策卡明说）/ `type` / `class` / `interface` …（semantic.files 记录） */
  kind: string;
  /** 1-based 行号（**设计侧记录的原行号**，仅供参考，别拿去对源码） */
  line?: number;
  /** 声明首行签名（截断后的原文，来自 semantic.files） */
  signature?: string;
  /** 目录级下钻时：这个符号属于哪个文件 */
  file?: string;
  /** 这条符号从设计侧的哪条事实来（可追溯 ⇒ 不编造） */
  from: 'decision.expectation' | 'semantic.files';
  /** `decision.expectation` 带的 `why` */
  why?: string;
}

/** 一条「只在设计侧」节点的必含符号清单 */
export interface MustHaveReport {
  id: string;
  /** file=文件节点 / dir=目录节点（已下钻到文件级）/ other=两者都不是 */
  kind: 'file' | 'dir' | 'other';
  /** 仓库相对路径（目录节点按 `dir_<rel>` 的既有约定反推，见 import_project.ts:983） */
  path?: string;
  /** 必含符号；**空 ⇒ 必须读 why_empty**（不许静默空） */
  must_have: MustHaveSymbol[];
  /** 为什么列不出来（信息不够时**明说**） */
  why_empty?: string;
  /** 目录节点下钻到的文件（目录级 must_have = 这些文件符号的并集） */
  drilled?: string[];
}

type AnyDesignNode = Record<string, unknown>;

/** 路径归一（只用于对齐，不用于展示）：反斜杠→斜杠、去 `./`、小写 */
const mhNorm = (p: string): string => String(p).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

/** 节点的仓库相对路径：优先 `description`（真路径），其次 `path`；目录节点按 id 约定反推 */
function mhPathOf(node: AnyDesignNode): string | null {
  for (const k of ['description', 'path'] as const) {
    const v = node[k];
    if (typeof v === 'string' && v.includes('/') && !/\s/.test(v)) return v.replace(/\\/g, '/');
  }
  const id = typeof node.id === 'string' ? node.id : '';
  // ★ 既有约定（import_project.ts:983 就是这么反推 dir 的）：`dir_a_b_c` ⇒ `a/b/c`
  if (id.startsWith('dir_')) return id.replace(/^dir_/, '').replace(/_/g, '/');
  return null;
}

/**
 * 「只在设计侧」的节点 ⇒ 每条**必含符号**（纯函数：只读传进来的设计 DSL 对象）。
 *
 * @param design 设计 DSL（`geometry.nodes` + `semantic.files`）
 * @param onlyDesignIds `designDiff` 算出的"只在设计侧"节点 id
 */
export function mustHaveFor(design: unknown, onlyDesignIds: string[]): MustHaveReport[] {
  const dsl = (design ?? {}) as {
    geometry?: { nodes?: AnyDesignNode[] };
    semantic?: { files?: Array<{ path?: string; symbols?: Array<{ name?: string; kind?: string; line?: number; signature?: string }> }> };
  };
  const nodes = dsl.geometry?.nodes ?? [];
  const byId = new Map<string, AnyDesignNode>();
  for (const n of nodes) if (typeof n.id === 'string') byId.set(n.id, n);

  /** 来源 ②：设计 DSL 自带的文件符号事实 */
  const fileSyms = new Map<string, Array<{ name?: string; kind?: string; line?: number; signature?: string }>>();
  for (const f of dsl.semantic?.files ?? []) {
    if (typeof f.path === 'string') fileSyms.set(mhNorm(f.path), f.symbols ?? []);
  }

  /** 来源 ①：决策卡的 `symbol-exists` 判据（按 path 索引；卡片可以挂在任何节点上） */
  const expected = new Map<string, MustHaveSymbol[]>();
  for (const n of nodes) {
    const dec = n.decision as { expectations?: unknown } | undefined;
    if (!dec || !Array.isArray(dec.expectations)) continue;
    for (const raw of dec.expectations) {
      const e = raw as { kind?: string; path?: string; symbol?: string; why?: string };
      if (e.kind !== 'symbol-exists' || typeof e.path !== 'string' || typeof e.symbol !== 'string') continue;
      const key = mhNorm(e.path);
      const list = expected.get(key) ?? [];
      if (!list.some((s) => s.name === e.symbol)) {
        list.push({ name: e.symbol, kind: 'symbol-exists', from: 'decision.expectation', ...(e.why ? { why: e.why } : {}) });
      }
      expected.set(key, list);
    }
  }

  /** 一个文件的必含符号：判据优先，再补 `semantic.files` 的符号记录（同名不重复） */
  const symbolsOfFile = (file: string): MustHaveSymbol[] => {
    const key = mhNorm(file);
    const out: MustHaveSymbol[] = (expected.get(key) ?? []).map((s) => ({ ...s }));
    for (const s of fileSyms.get(key) ?? []) {
      if (!s.name || out.some((x) => x.name === s.name)) continue;
      out.push({
        name: s.name,
        kind: s.kind || 'unknown',
        ...(typeof s.line === 'number' ? { line: s.line } : {}),
        ...(s.signature ? { signature: s.signature } : {}),
        from: 'semantic.files',
      });
    }
    return out;
  };

  const out: MustHaveReport[] = [];
  for (const id of onlyDesignIds) {
    const node = byId.get(id) ?? { id };
    const type = typeof node.type === 'string' ? node.type : '';
    const path = mhPathOf(node);
    const kind: MustHaveReport['kind'] =
      type === 'file' ? 'file' : id.startsWith('dir_') || type === 'module' ? 'dir' : 'other';

    if (kind === 'file') {
      const file = path ?? id;
      const must = symbolsOfFile(file);
      out.push({
        id,
        kind,
        ...(path ? { path } : {}),
        must_have: must,
        ...(must.length
          ? {}
          : {
              why_empty:
                `${file}：设计侧没有 semantic.files 符号记录，也没有任何决策卡写过 symbol-exists 判据 ⇒ ` +
                `设计侧说不出它该含什么（不是"没要求"，是"没写"）。`,
            }),
      });
      continue;
    }

    if (kind === 'dir') {
      const dir = (path ?? '').replace(/\/+$/, '');
      const prefix = dir ? `${mhNorm(dir)}/` : '';
      /** ★ 目录必须**下钻到文件级**：子文件节点 ∪ semantic.files 条目（两份都是设计侧说过的话） */
      const drilled: string[] = [];
      const add = (p: string): void => {
        if (!drilled.some((x) => mhNorm(x) === mhNorm(p))) drilled.push(p.replace(/\\/g, '/'));
      };
      if (prefix) {
        for (const n of nodes) {
          if (n.id === id || n.type !== 'file') continue;
          const p = mhPathOf(n);
          if (p && mhNorm(p).startsWith(prefix)) add(p);
        }
        for (const f of dsl.semantic?.files ?? []) {
          if (typeof f.path === 'string' && mhNorm(f.path).startsWith(prefix)) add(f.path);
        }
      }
      /** 目录级 must_have = 下钻文件符号的并集（每个符号带 `file`，LLM 才知道往哪写） */
      const must: MustHaveSymbol[] = [];
      for (const f of drilled) {
        for (const s of symbolsOfFile(f)) {
          if (must.some((x) => x.name === s.name && x.file === f)) continue;
          must.push({ ...s, file: f });
        }
      }
      out.push({
        id,
        kind,
        ...(path ? { path } : {}),
        must_have: must,
        drilled,
        ...(must.length
          ? {}
          : {
              why_empty:
                `目录 ${dir || id}：设计侧没有它的子文件节点、没有 semantic.files 条目、也没有决策卡（含 scope）指向它 ⇒ ` +
                `设计侧只说"要这个目录"，说不出里面该有什么（信息不够，不编）。`,
            }),
      });
      continue;
    }

    out.push({
      id,
      kind,
      ...(path ? { path } : {}),
      must_have: [],
      why_empty: `节点类型 ${type || '(无)'} 既不是文件也不是目录 ⇒ 设计侧没有"该含哪些符号"的语义。`,
    });
  }
  return out;
}


// ───────────────────────────────────────────────────────────────────────────
// ★★★ action=brief（2026-10-23）：**开工简报** —— 把「设计要什么 / 现在是什么 / 差在哪」拼成一份
// ───────────────────────────────────────────────────────────────────────────
//
// ## 它解决什么（用户原话，2026-10-23）
// 「模型上下文里面应该要同时存在设计 DB 和实际源码应该怎么改」
// ⇒ 现在 Agent 想知道"这个文件该实现什么"要调三次（get_dsl / explore_code / design_line report），
//   而且三次的输出**互相对不上**：设计侧 10KB、实际侧一份符号表、report 只给 76.2% 这种和本文件无关的总数。
//   ★ `must_have` 的注释早就点破过同一个病灶：「LLM 要写实现时仍得自己从 scope / 边去猜
//     里面该有哪些函数 —— **猜错就白写一轮**」。
//
// ## 它不拥有任何判据（★ 这是分界线）
// · 设计侧"该有什么" = `mustHaveFor`（本文件已有，读 decision.expectations + semantic.files）
// · 实际侧"有什么"   = `fileFacts`（infrastructure/index/file_facts.ts，读 cache.db）
// · 差               = 两者相减
// ⇒ 本函数**只做投影与拼接**，一个判据都不新造。要改判据去改那两个源头。
//
// ## 输出形状（给 LLM 读的，不是给人看的报表）
//   design.summary / acceptance / must_have / expectations（**设计要求原文**；★ 本函数不判满没满）
//   live.symbols（只给签名，不贴全文 —— 全文用 explore_code / Read）
//   gap.missing_symbols / gap.unsatisfied_count
export interface BriefSymbol {
  name: string;
  kind?: string;
  line?: number;
  signature?: string;
}

export interface BriefReport {
  target: { node_id?: string; path?: string };
  design: {
    summary?: string;
    acceptance?: string;
    must_have: MustHaveSymbol[];
    /** ★ 设计要求**原文**（decision.expectations）。★ 不是「未满足」—— 本函数不判满没满，别拿它当验收结论 */
    expectations: Array<{ kind: string; [k: string]: unknown }>;
    why_empty?: string;
  };
  /** ★ 设计侧 DB（`design-db/<rel>.calls.json`）—— 与 `live` 同构，可直接对拍 */
  design_db?: { available: boolean; symbols: BriefSymbol[]; imports: number; calls: number };
  live: { symbols: BriefSymbol[]; indexed: boolean };
  /** ★ 第 4 条：改这个文件会波及谁（`analyzeImpact` 的读数，不新造判据） */
  impact?: { total: number; direct: number; high_risk: number; top: string[] };
  gap: { missing_symbols: MustHaveSymbol[]; expectation_count: number };
}

/** 纯组装：入参是已经算好的两侧事实，本函数不做 I/O、不判判据 */
export function briefFrom(dsl: unknown, target: { node_id?: string; path?: string }): BriefReport['design'] & { nodePath?: string } {
  const d = (dsl ?? {}) as {
    geometry?: { nodes?: Array<{ id?: string; path?: string; decision?: unknown }> };
    semantic?: { files?: Array<{ path?: string }> };
  };
  const nodes = d.geometry?.nodes ?? [];
  const node = target.node_id ? nodes.find((n) => n.id === target.node_id) : undefined;
  // ★★★ 2026-10-27（T-#37）：**只认 `path`** —— `Node.description` 已删（T-#35），
  //   下面那条 2026-10-23 的注释（“文件节点的路径住在 description”）**已过期**：
  //   T-#23 起 `import_project` 给每个 file 节点写 `path`，全册 description 也已清零。
  const filePath = target.path ?? (typeof node?.path === 'string' ? node.path : undefined);
  const dec = (node?.decision ?? undefined) as { summary?: string; acceptance?: string; expectations?: unknown } | undefined;
  const exps = Array.isArray(dec?.expectations) ? (dec!.expectations as Array<{ kind?: string }>) : [];
  return {
    ...(dec?.summary ? { summary: dec.summary } : {}),
    ...(dec?.acceptance ? { acceptance: dec.acceptance } : {}),
    must_have: [],
    expectations: exps.map((e) => ({ ...e, kind: String(e.kind ?? '?') })),
    ...(node ? {} : { why_empty: '找不到该节点（node_id 不对？）⇒ 只给路径级信息' }),
    nodePath: filePath,
  };
}


/**
 * `action=brief` 的 I/O 侧：**取两侧事实 → 交给纯组装 → 算差**。
 *
 * ★ 它读三样、一样都不判：
 *   ① `readDesignDsl`（设计侧 decision）
 *   ② `mustHaveFor`（设计侧"该有什么"—— 判据在它那里）
 *   ③ `fileFacts`（实际侧"有什么"—— 事实在 cache.db）
 */
export async function briefReport(
  root: string,
  feature: string,
  target: { node_id?: string; path?: string },
  /**
   * `skip_impact`：不算影响面。
   * ★ 2026-10-23 实测必要性：`analyzeImpact` 每次都会 `buildImpactGraph`（全仓依赖图）。
   *   批量扫 84 张卡时 4 分 56 秒还没跑完 ⇒ 逐卡算影响面是 O(cards × 全仓图)。
   *   只要符号差时应该能跳过它（符号差查 cache.db，毫秒级）。
   */
  opts: { skip_impact?: boolean } = {},
): Promise<BriefReport> {
  // ★ 与 lineReport 同口径：直接读 `.agent-io/design/<f>.dsl.json`（不引入第二套读法）
  const designFile = path.join(root, '.agent-io', 'design', `${feature}.dsl.json`);
  const dsl = (fs.existsSync(designFile) ? JSON.parse(fs.readFileSync(designFile, 'utf-8')) : null) as unknown;
  const base = briefFrom(dsl, target);
  const nodeId = target.node_id;
  const filePath: string | undefined = base.nodePath;

  // 设计侧：必含符号（判据住在 mustHaveFor，不在这里重算）
  let must: MustHaveSymbol[] = [];
  let whyEmpty: string | undefined = base.why_empty;
  if (nodeId || filePath) {
    const rep = mustHaveFor(dsl, nodeId ? [nodeId] : []);
    const hit = rep.find((r) => (nodeId ? r.id === nodeId : filePath && r.path === filePath));
    if (hit) {
      must = hit.must_have;
      whyEmpty = hit.why_empty;
    } else if (!nodeId && filePath) {
      // 路径级：把按 path 索引的判据捞出来（mustHaveFor 只按节点 id 收）
      const all = mustHaveFor(dsl, []);
      must = all.flatMap((r) => (r.path === filePath ? r.must_have : []));
    }
  }

  // 实际侧：该文件现有符号
  // ★★★ 2026-10-23（误报修正第二处）：**不能只用 `fileFacts.apis`** —— 它只收"可调用的顶层 API"
  //   （声明见 file_facts.ts:38 的原话），**没有 type / interface / const**。
  //   实测后果：`TaskState`（type）/ `TASK_STATES`（const）明明在文件里，却被报成"缺"
  //   ⇒ 8 条误报（比不报更坏：Agent 会去"补"一个已经存在的符号）。
  //   ⇒ 用 cache.db 的 `nodes` 表（`kind != 'file'` 的行 = 该文件所有顶层符号）判"在不在"；
  //     `fileFacts` 仍用来补**签名**（它那份情报更细，但覆盖面窄）。
  let live: BriefSymbol[] = [];
  let indexed = false;
  if (filePath) {
    const facts = fileFacts(root, filePath as string, feature);
    const sigByName = new Map<string, string | null>();
    if (facts && facts.apis) for (const a of facts.apis) sigByName.set(a.name, a.signature ?? null);
    const dbFile = path.join(root, '.agent-io', 'cache.db');
    if (fs.existsSync(dbFile)) {
      const db = new DatabaseSync(dbFile);
      try {
        const rows = db
          .prepare(`SELECT name, kind, start_line FROM nodes WHERE file_path = ? AND kind <> 'file'`)
          .all(filePath as string) as Array<{ name: string; kind: string; start_line: number | null }>;
        indexed = rows.length > 0;
        live = rows.map((r) => ({
          name: r.name,
          kind: r.kind,
          ...(typeof r.start_line === 'number' ? { line: r.start_line } : {}),
          ...(sigByName.get(r.name) ? { signature: sigByName.get(r.name) as string } : {}),
        }));
      } finally {
        db.close();
      }
    }
  }

  // 差：必含 - 实有（按名字比；★ 同名不同 kind 也算有 —— 那属于"签名不对"，归 expectations）
  const liveNames = new Set(live.map((l) => l.name));
  const missing = must.filter((m) => !liveNames.has(m.name));

  // 设计侧 DB：`design-db/<rel>.calls.json`（gen-design-db 的产物，与实际 DB 同构）
  // ★ 文件名规则：路径去 `src/` 前缀、`/` 换 `-`，后缀 `.calls.json`（实测 359 份都是这个名字）
  // ★ 读不到就说 available:false，**不伪造空符号表**（空表会被误读成"设计侧什么都没有"）
  let designDb: BriefReport['design_db'];
  if (filePath) {
    // ★ 实测文件名：`src/domain/task_schema.ts` → `design-db/domain-task_schema.calls.json`
    //   （去 `src/` 前缀、**去扩展名**、`/` 换 `-`、后缀 `.calls.json`）
    const rel = String(filePath)
      .replace(/^src\//, '')
      .replace(/\.[A-Za-z0-9]+$/, '')
      .replace(/\//g, '-');
    const f = path.join(root, 'design-db', `${rel}.calls.json`);
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf-8')) as {
        symbols?: Array<{ name?: string; kind?: string; line?: number; signature?: string }>;
        imports?: unknown[];
        calls?: unknown[];
      };
      designDb = {
        available: true,
        symbols: (j.symbols ?? []).map((x) => ({
          name: String(x.name ?? '?'),
          ...(x.kind ? { kind: x.kind } : {}),
          ...(typeof x.line === 'number' ? { line: x.line } : {}),
          ...(x.signature ? { signature: x.signature } : {}),
        })),
        imports: (j.imports ?? []).length,
        calls: (j.calls ?? []).length,
      };
    } else {
      designDb = { available: false, symbols: [], imports: 0, calls: 0 };
    }
  }

  // 影响面：只给"改这个文件会炸谁"的规模 + 前 5 个（★ 不贴整份报告 —— 那是 explore_code action=impact 的活）
  let impact: BriefReport['impact'];
  if (filePath && opts.skip_impact !== true) {
    try {
      const r = await analyzeImpact(root, [{ file: filePath as string }]);
      impact = { total: r.total, direct: r.direct, high_risk: r.high_risk, top: r.files.slice(0, 5).map((f) => f.file) };
    } catch {
      // ★ 影响面算不出来**不阻断简报**（它只是第 4 条信息）；但也不静默 —— 留 undefined，渲染层明说"未算"
      impact = undefined;
    }
  }

  return {
    target: { ...(nodeId ? { node_id: nodeId } : {}), ...(filePath ? { path: filePath as string } : {}) },
    design: {
      ...(base.summary ? { summary: base.summary } : {}),
      ...(base.acceptance ? { acceptance: base.acceptance } : {}),
      must_have: must,
      expectations: base.expectations,
      ...(whyEmpty ? { why_empty: whyEmpty } : {}),
    },
    ...(designDb ? { design_db: designDb } : {}),
    live: { symbols: live, indexed },
    ...(impact ? { impact } : {}),
    gap: { missing_symbols: missing, expectation_count: base.expectations.length },
  };
}

/** MCP handler：只做渲染（首行自足 —— 本仓硬纪律） */
export async function briefHandler(input: { project_dir: string; feature: string; node_id?: string; path?: string }): Promise<{
  message: string;
  data: BriefReport;
}> {
  const r = await briefReport(input.project_dir, input.feature, {
    ...(input.node_id ? { node_id: input.node_id } : {}),
    ...(input.path ? { path: input.path } : {}),
  });
  const where = r.target.path ?? r.target.node_id ?? '（未指定目标）';
  // ★★★ 2026-10-23（用户反馈）：「决策有 · 必含 13 符号 · 缺 1 · 判据 13 条 · 实际 35 符号」这是干什么的？
  //   那是一串**只可计数、不可理解**的密码：说"缺 1"不如说"缺哪个"；说"判据 13 条"也没说满没满（本函数根本没判）。
  //   ⇒ 改成一句能直接读的话，最要紧的（缺什么、叫什么名）放最前。
  const head = (() => {
    if (!r.target.path) return `brief · ${where}（找不到文件路径 ⇒ 只能给节点级信息）`;
    const n = r.gap.missing_symbols.length;
    const names = r.gap.missing_symbols.slice(0, 3).map((m) => m.name).join();
    const more = n === 1 ? '' : n > 3 ? ` 等 ${n} 个` : ` 这 ${n} 个`;
    if (n > 0) return `${where}：设计要 ${r.design.must_have.length} 个符号，源码里缺 ${names}${more}`;
    if (r.design.must_have.length > 0) return `${where}：设计要的 ${r.design.must_have.length} 个符号，源码里都有`;
    return `${where}：设计没给这个文件列必含符号（decision 里没有 symbol-exists 判据）`;
  })();
  const lines = [head];
  if (r.design.summary) lines.push(`  要什么：${r.design.summary}`);
  if (r.design.acceptance) lines.push(`  验收：${r.design.acceptance}`);
  if (r.design.why_empty) lines.push(`  ⚠ ${r.design.why_empty}`);
  if (r.gap.missing_symbols.length > 0) {
    lines.push(`  缺（设计说必须有、源码里没有）：`);
    for (const m of r.gap.missing_symbols.slice(0, 12)) lines.push(`    - ${m.name}${m.why ? `  ← ${m.why}` : ''}`);
    if (r.gap.missing_symbols.length > 12) lines.push(`    … 另 ${r.gap.missing_symbols.length - 12} 个`);
  } else if (r.design.must_have.length > 0) {
    lines.push(`  必含 ${r.design.must_have.length} 个符号【全都在】`);
  }
  if (r.design_db) {
    const d = r.design_db;
    lines.push(
      d.available
        ? `  设计 DB（gen-design-db 的投影）：${d.symbols.length} 符号 · ${d.imports} import · ${d.calls} 调用`
        : `  设计 DB：**没有这份文件的副本**（design-db/ 里找不到）—— 设计侧还没声明它`,
    );
  }
  if (r.impact) {
    const { total, direct, high_risk, top } = r.impact;
    lines.push(`  改它会波及 ${total} 个文件（直接 ${direct} · 高风险 ${high_risk}）${top.length ? `：${top.slice(0, 5).join('、')}${total > 5 ? ' …' : ''}` : ''}`);
  } else if (r.target.path) {
    lines.push(`  ⚠ 影响面未算（analyzeImpact 失败或未建索引）—— 要精确读数用 explore_code action=impact`);
  }
  lines.push(`  ★ 判据原文在 decision.expectations（本简报不复制语义）；源码全文用 explore_code / Read。`);
  return { message: lines.join(String.fromCharCode(10)), data: r };
}
