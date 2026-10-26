/**
 * 设计一致性检查器
 *
 * 对比 DSL 定义的 expected_apis 与实际代码中的 API 实现，自动检测不一致。
 *
 * 功能：
 *   1. 解析实际代码文件中的函数/方法签名（支持 Go/TypeScript/Python/JavaScript）
 *   2. 对比 DSL 中定义的 expected_apis
 *   3. 生成差异报告：
 *      - ✅ 已实现（green）：expected 与 actual 匹配
 *      - ❌ 缺失（red）：expected 中有，但代码中没有
 *      - ⚠️ 签名不匹配（yellow）：函数存在但参数/返回值不一致
 *      - 「🆕 代码新增（blue）」**已废**（T85/D1b）—— 见下「职责归属」。**别再加回来**。
 *   3′.（T157，2026-10-11）**类型契约**（`interface`/`type`/`class`）走**成员比对**：
 *      `expected_apis[].signature` 写成一行类型声明时，比的是**字段名 + 类型 + 可选性**
 *      （★ 只对"契约声明了的成员"判；**实现多出来的成员不算差异**，但会在报告中列出）。
 *   4. 支持注释标记定位（<!-- agent-io:node_id -->）
 *   5. 验证跨文件不变式（multi_file_invariants）
 *
 * 与 scaffold(action=backfill) 的区别：
 *   - （2026-10-01 起该路径已剔除）：原先的 scaffold(action=backfill) 会把代码提取的 API **镜像回填**进 DSL；
 *     现在事实的唯一权威是解析数据 cache.db（`infrastructure/index/file_facts`）。
 *   - consistency：只读检查，生成报告，不修改 DSL
 *
 * 职责归属（对账语义，与三方对比/基线一致）：
 *   - expected_apis 只由设计侧产生（import_project / scaffold / edit_dsl 决策），
 *     本工具只读不写
 *   - actual 以实际代码为事实源；报告把「预期缺失」（red）与「签名不匹配」（yellow）分开，
 *     LLM 据此裁决：预期缺失 → 补实现（或把契约改对 —— **契约是人指定的**）；
 *     ★ 「实现新增」**不在此列**（T85/D1b 已废）：它是**线 1**（相对**基线**）的事，见下。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DesignDSL, SemanticFile } from '../../../domain/types.js';
import { hasFileEntries } from '../../../domain/semantic.js';
import { noFileEntriesMessage } from '../no_file_entries.js';
// ★★★ P0 保鲜链第 3 环（2026-10-26）：**判据覆盖对账**。
//   W0 实测（council-hub）：5 条决策卡判据指向 7 个测试文件，全不在册 —— 这个缺口此前
//   没有任何检查会报。⇒ 本文件新增 coverage 段：收集全部判据路径（复用 domain/expectation
//   的**唯一提取器**，不新写解析），凡不在 `semantic.files` ⇒ 缺口清单。
import { collectExpectations, expectationPaths, normPath } from '../../../domain/expectation.js';
// ★ AB-double-name 病 B：函数名提取收口成唯一住处（与 scaffold 共用同一份，不再各持一份）
import { extractFuncName } from '../api_signature.js';
import { getDSL, getBaselineFacts } from '../../../infrastructure/storage.js';
// ★ T85/D3：线 1 的"现取事实"入口 —— 与 `import_project` 锚基线事实时**用的是同一个 accessor**（同源）
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
// ★★★ 2026-10-26（T-#11 / 乙方案）：册的 source_root 是不是**项目根**——判据复用这一个上溯原语
import { resolveProjectRoot } from '../../../infrastructure/analysis/project_root/index.js';
// ★ T184b：② 的**第二个输入来源** —— overlay 上的墓碑（`loadOverlay`）。此前它只读 base（`getDSL`）。
import { loadOverlay } from '../../../infrastructure/storage_overlay.js';
import { parseFileSymbols, ParsedSymbol, isSupportedFile } from '../../../infrastructure/parse/ast_parser.js';
// ★ T157（2026-10-11）：**类型契约**（`interface`/`type`/`class`）的成员比对。
//   内核的 `ParsedSymbol.signature` 对类型**退化成 `Name()`** ⇒ 成员提取必须另走 AST；
//   而"从签名串与从真实文件取成员"**共用同一份提取器**（`memberNamesOf`/`typeMembersOf` 的唯一住处），
//   不许在这里再写一份正则（那正是本仓头号病）。
import {
  parseAstRoot,
  findTypeDeclByName,
  typeMembersOf,
  typeDeclFromSignature,
  normalizeMemberType,
  type ParsedTypeMember,
  type SignatureDeclResult,
  type SyntaxNodeLike,
  // ★ v13（2026-10-20）：形参表与 `nodes.params` **同源**（`paramsOf` 唯一住处）
  paramsOf,
  type ParsedParam,
} from '../../../infrastructure/parse/index.js';

/**
 * ★★★ **线 1：代码相对基线的变更**（2026-10-09，T85/D3）。
 *
 * ## 它回答的问题（与线 2 **不同**）
 *   · **线 1（本类型）**：`基线事实`（fork 那一刻） vs `现取事实` ⇒ 「**代码相对基线变了没有**」
 *   · **线 2（`fileResults`）**：`DSL.expected_apis`（**人写的意图**） vs `现取事实` ⇒ 「**设计与实现的差距**」
 * ★ 在此之前**只有线 2，而它的"期望侧"是 fork 时从事实复制来的** ⇒ **自己跟自己比**。
 *   规则：**对拍的期望侧不能取自被比的那份事实本身** —— 否则就是"自己测自己"。
 */
export interface BaselineDrift {
  /** 比了几个文件 */
  compared: number;
  /** 逐文件：现取相对基线**新增/消失**的 API（签名，与 `expected_apis[].signature` 同形） */
  files: Array<{ path: string; added: string[]; removed: string[] }>;
  /** ★ 说明（**不许静默**：没基线 / 索引取不到，都要写在这儿） */
  notes: string[];
}

/**
 * 跑**线 1**：基线事实 vs 现取事实。★ 纯读，不写任何东西。
 * ★ 没有基线事实 ⇒ **明说"这条线判不了"**（老 feature 就是这种）—— 不冒充"没变化"。
 */
export function checkBaselineDrift(feature: string, codeDir: string): BaselineDrift {
  const notes: string[] = [];
  const baseline = getBaselineFacts(feature);
  if (!baseline) {
    return {
      compared: 0,
      files: [],
      notes: [
        '本 feature **没有基线事实**（`baseline/<feature>.facts.json` 不存在 —— 多半是 D2 之前导入的）' +
          '⇒ **线 1（代码相对基线的变更）判不了**。★ 重新 `import_project` 即可锚定（若设计已存在，先删掉该 feature 的 `.facts.json` 才会重建）。',
      ],
    };
  }
  const files: BaselineDrift['files'] = [];
  for (const [rel, base] of Object.entries(baseline.files)) {
    let now: readonly string[];
    try {
      const f = fileFacts(codeDir, rel);
      now = (f.apis ?? []).map((a) => a.signature ?? a.name);
    } catch (e) {
      // ★ 取不到事实**不许静默**：那会让"变化"看起来是"没变化"
      notes.push(`${rel}: 现取事实失败（${(e as Error).message.slice(0, 80)}）⇒ 该文件本轮**没比**`);
      continue;
    }
    const added = now.filter((s) => !base.apis.includes(s));
    const removed = base.apis.filter((s) => !now.includes(s));
    if (added.length || removed.length) files.push({ path: rel, added, removed });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { compared: Object.keys(baseline.files).length, files, notes };
}

/** 渲染线 1 的小节（给 `checkConsistencyReport` 的消息用） */
function renderBaselineDriftSection(d: BaselineDrift): string {
  const L: string[] = [
    '',
    '── 线 1 · 代码相对**基线**的变更（★ 基线 = **fork 那一刻的事实**；★ 与下面"设计 vs 实现"**不是一回事**）──',
  ];
  if (d.compared === 0 && d.files.length === 0) {
    L.push('  （**判不了**）');
  } else {
    const nAdd = d.files.reduce((a, f) => a + f.added.length, 0);
    const nDel = d.files.reduce((a, f) => a + f.removed.length, 0);
    if (nAdd === 0 && nDel === 0) {
      L.push(`  ✓ **相对基线无变化**（比了 ${d.compared} 个文件）—— ★ 源码没动过就是它；**这不是"没跑"**。`);
    } else {
      L.push(`  有变化：${d.files.length} 个文件（新增 API ${nAdd} · 消失 API ${nDel}）`);
      for (const f of d.files.slice(0, 10)) {
        L.push(`    ${f.path}`);
        for (const s of f.added.slice(0, 3)) L.push(`      ＋ ${s}`);
        for (const s of f.removed.slice(0, 3)) L.push(`      － ${s}`);
      }
      if (d.files.length > 10) L.push(`    …另有 ${d.files.length - 10} 个文件`);
    }
  }
  for (const n of d.notes) L.push(`  ★ ${n}`);
  return L.join('\n');
}

/**
 * ★★★ **「对账」的三态术语**（2026-10-10）—— `consistency_check` 与 `detect_drift` **共用这一处**。
 *
 * ## 为什么要单独立它（这不是语义洁癖，是修一个会骗人的读数）
 * 实测（2026-10-10，真跑）：DSL 里 `expected_apis` **共 0 条**时，
 * `consistency_check` 报「0/0/0 + ✓ 线 2 无待办（…签名一致）」、`detect_drift` 报
 * 「状态: clean（对齐）… 无需同步」—— **它什么都没比，却报"好"**。
 * ★ 读者读到"一致 / 无待办"，会以为**检查过了、没问题**；真相是**没有东西可查**。
 * ⇒ 这是「判据恒真 = 装饰」的最纯形态（**沉默会被读成"没问题"**）。
 *
 * ## 三态（**必须分开**；不许把「没得比」塌进「比过且一致」）
 * | 态 | 含义 | 词表纪律 |
 * |---|---|---|
 * | `no_comparison` | **比了 0 条**（`expected_apis=0` / 无对手） | ★★ **不许**说「一致 / clean / 对齐 / 无需同步」；必须**主动说清"没得比 ⇒ 给不出结论"** |
 * | `consistent`   | 真的比了 N>0 条，都对得上 | 可说「比过且一致」 |
 * | `drifted`      | 比了 N>0 条，有对不上的 | 报差异 |
 *
 * ★ 判据**只吃两个数**（`compared` / `drifted`）⇒ 两个工具**同一处判**，不会各推一遍（本仓头号病）。
 */
export type ComparisonState = 'no_comparison' | 'consistent' | 'drifted';

/**
 * 三态的**唯一定义**。`compared` = 真的比了多少条；`drifted` = 其中对不上的条数。
 * ★ 边界在 `compared === 0` —— 那是「没得比」，**不是**「比过且全对」（后者要求 `compared > 0`）。
 */
export function comparisonState(compared: number, drifted: number): ComparisonState {
  if (compared === 0) return 'no_comparison';
  return drifted > 0 ? 'drifted' : 'consistent';
}

/**
 * ★★★ **三步流（退役流程）里的一步**（T184，2026-10-12）—— 规则：
 * 设计侧先标记待删 ⇒ **删除之后对拍**，发现这个地方**确实删完了**
 * ⇒ 才把它**真正扫进历史堆**。
 *
 * ★ 本条对的是**第三根轴**（与线 1 / 线 2 **都不是一件事**，见 `ConsistencyResult` 的说明）：
 *   · **线 1**：`基线事实` vs `现取事实` ⇒ 代码变了没；
 *   · **线 2**：`expected_apis`（人写的契约） vs 现取事实 ⇒ 契约与实现差多少；
 *   · **本轴**：★ **`lifecycle.status==='deprecated'`（设计说该删） vs `exists`（实现还在不在）**
 *     ⇒ 回答「**这具"待删"的判定，实现侧做完了没有**」。
 * ★ 为什么必须单列：线 2 对的是"**契约签名**"，而"该不该删这个文件"**与签名一点关系都没有**
 *   ⇒ ★ 把它塞进线 2 的计数就是**混着比**（T85 的病根：*"自己测自己吗？"*）。
 * ★★ 它也**不依赖 `expected_apis`** —— 一个文件可以**没有任何契约**、却标着 `deprecated`
 *   ⇒ 本轴必须在"`expected_apis` 共 0 条"的报告里**照样出现**（同"跨文件不变式"的地位）。
 */
export interface RetireFlowEntry {
  file_path: string;
  /** 设计侧标记（本轴只会收 `deprecated`；`merged`/`archived` 走归档工具，不在这） */
  design_status: 'deprecated';
  /** 设计侧写的"为什么该删"（★ 三步流的①要求必填 ⇒ 这里应当有值） */
  retire_reason?: string;
  /** 实现里还在不在（现取，非缓存） */
  exists: boolean;
  /**
   * 两步判定（**唯一判据**见 `retireStage`）：
   *   · `awaiting_implementation_delete` = 设计说该删、**实现里还在** ⇒ 待办（②的"还没删完"）
   *   · `ready_to_archive` = 设计说该删、**实现里也没了** ⇒ ★ **可以走③归档了**
   */
  stage: RetireStage;
  /**
   * ★★★ **这条是【从哪儿】看到的**（T184b，2026-10-12）—— 读端必须知道，因为两处的**可查性不同**：
   *   · `base_dsl` —— 它就在 `semantic.files` 里，`get_dsl query=files` 查得到；
   *   · `overlay_tombstone` —— ★ **它已经不在 `semantic.files` 里了**（显式重建把文件换掉了），
   *     只剩 `overlay.anchors` 上那笔标记 ⇒ ★ `get_dsl` **按文件查不到它**。
   * ★ 为什么要这个字段（而不是让它悄悄混在一起）：★ **读端会去 `get_dsl` 核对路径** ——
   *   核不到时，他需要知道"**这不是数据错了，是它只剩墓碑了**"，否则会当成漂移去排查。
   */
  origin: 'base_dsl' | 'overlay_tombstone';
}

/**
 * ★★★ **T184b：把 overlay 上的「墓碑」也捞出来**（2026-10-12）——
 * `checkConsistencyReport` 的**第二个输入来源**，此前**完全没有**。
 *
 * ## 为什么必须有（★ 两态真跑坐实，不是推演）
 * · 「设计侧标记待删」这件事**住在 overlay**（`lifecycle` 在 overlay 锚点上，T182 立的规矩）。
 * · 而 ② 此前**只扫 `dsl.semantic.files`**（= base）。
 * · ⇒ **显式 `rebuild_design=true` 之后**（`import_project.ts:1069` 的 `mergeDesignLayer` 把 base 整个换掉、
 *   那个文件不在新扫描结果里）⇒ ★ **它从 `semantic.files` 里消失，而 overlay 上的标记还在**
 *   ⇒ **② 报 `retireFlow = []`** —— ★ **数据明明在，判据瞎了**（`guard-blindspot-diagnosis` 的
 *   "判据只读了输入的一个来源"）。
 * · 实测（`run82` 真仓）：态 A（未重建）报 `awaiting_implementation_delete` ✓；
 *   态 B（重建后）报 **空**，而 `overlay.anchors[…] .lifecycle` **仍在** ✗
 *
 * ## 判据（★ 一处，没另写一把尺）
 * · 挑谁：overlay 锚点里 `lifecycle.status === 'deprecated'` **且该路径不在 base 的 `semantic.files` 里**
 *   —— ★ 后者是为了**不重复报**：base 里有的那些，上面那半已经报了。
 * · 阶段用**同一个** `retireStage(exists)`；`exists` **现取磁盘**（`fs.existsSync`），
 *   ★ **不假设**"不在 base 就等于不在磁盘"（那是另一件事，靠现取说话）。
 */
function overlayTombstones(
  feature: string,
  basePaths: ReadonlySet<string>,
  existsOf: (relPath: string) => boolean,
): RetireFlowEntry[] {
  const ov = loadOverlay(feature);
  if (!ov) return [];
  const out: RetireFlowEntry[] = [];
  for (const a of Object.values(ov.anchors)) {
    const lc = a.lifecycle;
    if (lc?.status !== 'deprecated') continue;
    const p = a.path;
    if (!p || basePaths.has(p)) continue; // ★ base 里有的，上面那半已经报过 ⇒ 不重复
    const exists = existsOf(p);
    out.push({
      file_path: p,
      design_status: 'deprecated',
      retire_reason: lc.retire_reason,
      exists,
      stage: retireStage(exists),
      origin: 'overlay_tombstone',
    });
  }
  return out.sort((x, y) => x.file_path.localeCompare(y.file_path));
}

export type RetireStage = 'awaiting_implementation_delete' | 'ready_to_archive';

/**
 * ★ **两步流的唯一定义**（判据一处 —— 与 `comparisonState` 同一个位置、同一种写法）。
 * ★ 边界：`exists === true` ⇒ 只能"等实现删"；`false` ⇒ 才"可以归档"。
 *   ★★ **没有第三种**：`deprecated` 是**设计侧的声明**，`exists` 是**实现侧的事实**，
 *     两者的四种组合里只有这两种能同时成立（本函数只被 `deprecated` 的条目调用）。
 */
export function retireStage(exists: boolean): RetireStage {
  return exists ? 'awaiting_implementation_delete' : 'ready_to_archive';
}

/**
 * ★★★ **T187：把「待退役」折进「差异面」** —— `FileDiff.retire` 的**唯一取值来源**。
 *
 * ## 它要解决的事（★ 探针真跑所得，不是推演）
 * 退役流的②→③**接不上**：②（`consistency_check`）给出的 `touched.scope_files` 按 API 差异算，
 * 而一个被标 `deprecated` 的文件**可以一条契约都不缺** ⇒ `scope_files` 是空的
 * ⇒ ③（`archive`，入参 `file_path`）**拿不到该归档的那个文件**。
 *
 * ## 口径（★ 一处）
 * **`retireFlow` 里的每一条都算差异** —— 因为 `retireFlow` 只收
 * `lifecycle.status === 'deprecated'` 的文件，而"设计说该删"本身就是一种"不对"。
 * 两个阶段（`awaiting_implementation_delete` / `ready_to_archive`）**都算** ——
 *   前者是"实现还没删"，后者是"实现删了、该归档"，**两者都要人去动**。
 *
 * ★ 键的取名与 `FileDiff.retire` 对齐（`awaiting_delete` / `ready_to_archive`）：
 *   `RetireStage` 说"这具判定到哪一步"，`FileDiff.retire` 说"这个文件到哪一步" —— **同一件事**。
 */
export function retireMarksOf(entries: readonly RetireFlowEntry[]): Map<string, NonNullable<FileDiffRetire>> {
  const m = new Map<string, NonNullable<FileDiffRetire>>();
  for (const e of entries) {
    m.set(e.file_path, e.stage === 'ready_to_archive' ? 'ready_to_archive' : 'awaiting_delete');
  }
  return m;
}

/** ★ 与 `domain/diff_blocks.ts` 的 `FileDiff.retire` **同型**（这里只是取个名字给上面用）。
 *  ★ 不 import 那个类型是有意的：`consistency.ts` 不该为了一个字段名去依赖 `diff_blocks` 的整张表；
 *    两边靠**这个别名 + 一处投影**保持同轴（改一边 ⇒ 这里会红）。 */
type FileDiffRetire = 'awaiting_delete' | 'ready_to_archive';

export interface ConsistencyResult {
  message: string;
  /**
   * ★★★ 2026-10-26（T-#1）：**本报告实际用的代码基准（绝对路径）** —— 生产者把事实落进结果。
   *
   * 为什么必须回传（病史，写死）：`consistency_check` 曾有两套基准，且**优先级正好相反** ——
   *   · 本文件：`code_dir` 优先，否则 `source_root`；
   *   · `handlers.ts#consistencyHandler` 判 expectations 时：`source_root` **优先**，否则 `code_dir`。
   * ⇒ 调用方传的 `code_dir` 与册的 `source_root` 不同时，会出现
   *   「fileResults 全 ❌ 不存在」与「expectations 全绿」并存，并附一条**误导性的反向信号**
   *   （“实现里已经没了、设计侧没标 deprecated”）—— 会让人去给**在用的文件**打 deprecated。
   * ⇒ 现在：唯一基准 = 本字段；handler 判 expectations 也读它，不再自己按相反优先级猜。
   */
  path_base: string;
  /** `path_base` 的来源（让读者知道它凭什么） */
  path_base_source: 'code_dir' | 'source_root' | 'fallback';
  fileResults: FileConsistency[];
  invariantResults: InvariantResult[];
  /**
   * ★★★ T184：**三步流的②**（见 {@link RetireFlowEntry}）—— 只含**设计侧标了 `deprecated`** 的文件。
   * ★ 空数组 = 没有待删标记（**不是**"删完了"）。
   */
  retireFlow: RetireFlowEntry[];
  /**
   * ★★★ **线 1：代码相对基线的变更**（2026-10-09，T85/D3）—— **与 `fileResults`（线 2）是两件事，绝不许混**：
   *   · **本项（线 1）** = `baseline/<f>.facts.json`（**fork 那一刻的事实**） vs **现取事实**（`fileFacts`）
   *     ⇒ 回答「**代码相对基线变了没有**」。★ **同窗口内（源码未动）应为 0**。
   *   · **`fileResults`（线 2）** = DSL 里的 `expected_apis`（**人写的意图**） vs 现取事实
   *     ⇒ 回答「**设计与实现的差距**」。
   * ★ 规则：**期望侧与被比侧不能同源** —— 否则就是"自己测自己"。
   *   ⇒ 两条线**各有各的对手**，混着比就是假差异（**这就是 T85 的病根**）。
   */
  baselineDrift?: BaselineDrift;
  /**
   * ★★★ P0 保鲜链第 3 环（2026-10-26）：**判据覆盖对账**（见 {@link ExpectationCoverage}）。
   * 缺口 0 ≠ "全对上"——`total_expectations === 0` 时是"没有判据可对"。
   */
  expectation_coverage: ExpectationCoverage;
  summary: {
    total_files: number;
    /**
     * ★★★ **真的"比"了多少条 `expected_apis`**（= matched+missing+mismatched；每条约产生一条 `ApiMatch`）。
     * ★ 它回答「**线 2 到底有没有对手**」；= 0 ⇒ `state='no_comparison'`（**什么都没比，别读成"没问题"**）。
     */
    compared: number;
    matched: number;
    missing: number;
    mismatched: number;
    unexpected: number;
    invariant_passed: number;
    invariant_failed: number;
    /**
     * ★★★ **三态机读值**（唯一判定见 `comparisonState`）：
     *   `no_comparison` = 没得比（compared=0）；`consistent` = 比过且一致；`drifted` = 有漂移。
     * ★ 有了它，调用方**不必**再从"全 0"里猜 —— 全 0 既可能是"没得比"，也可能是"比过且全对"。
     */
    state: ComparisonState;
    /**
     * ★ T184：三步流②的两个计数（**只数 `deprecated` 的文件**，与线 2 的计数不共用口径）。
     *   `retire_pending` = 设计说该删、**实现还在**；`retire_ready` = 设计说该删、**实现也没了**。
     *   ★ 两者之和 = `retireFlow.length`；`0` = 没有任何待删标记（**不是**"都删完了"）。
     */
    retire_pending: number;
    retire_ready: number;
  };
}

export interface FileConsistency {
  file: SemanticFile;
  file_path: string;
  exists: boolean;
  apis: ApiMatch[];
  /**
   * ★ T157（2026-10-11）：本文件层面的**诚实边界**（如"内核解析器不可用 ⇒ 形态判不了"）。
   * ★ 只在真发生时才有 —— **不许静默**（沉默会被读成"判过了、没问题"）。
   */
  notes?: string[];
}

export interface ApiMatch {
  expected_signature: string;
  expected_notes?: string;
  actual_signature?: string;
  actual_location?: string;
  status: 'matched' | 'missing' | 'mismatched' | 'unexpected';
  match_score: number;
  reason?: string;
  /**
   * ★ v13：本条签名比对**形参从哪来** —— `ast` = 两侧都读结构化 `params`（`nodes.params` 同源）；
   *   `regex` = 至少一侧退回文本切分（解析器给不出形参）。回执明写，不许静默降级。
   */
  params_via?: 'ast' | 'regex';
  /**
   * ★ v14：本条签名比对**返回类型从哪来** —— `ast` = 读结构化 `ParsedSymbol.returnType`
   *   （`nodes.return_type` 同源）；`regex` = 退回从签名串拆（该语言没抽到 / 本符号没注解）。
   *   ★ 与 `params_via` 分开：一条比对可以「形参读 AST、返回类型拆串」（如 JS 没返回注解）。
   */
  return_via?: 'ast' | 'regex';
  /**
   * ★ T157（2026-10-11）：**类型契约**（interface/type/class）的成员级明细。
   * ★ 只在"期望侧被解析成类型声明"时填；函数/方法契约**不填**（那是 `reason` 的事）。
   * ★★ `extras` **不算差异**（契约只声明"必需有什么"，实现多出来的成员合法）——
   *   但**必须报出来**：否则"设计侧只声明了一小片"会被读成"完全一致"（本仓反复踩的坑）。
   */
  members?: {
    matched: number;
    /** 契约声明了、实现里没有的成员名 */
    missing: string[];
    /** 两边都有、但**类型或可选性**漂移了的成员 */
    drifted: Array<{ name: string; kind: 'type' | 'optional'; expected: string; actual: string }>;
    /** 实现有、契约**未声明**的成员名（★ 不算差异，仅如实报出） */
    extras: string[];
    /** ★ 判不了的成员（如实现侧没写返回注解 ⇒ 类型无从比）—— 不许静默当成"匹配" */
    unjudged: string[];
  };
}

export interface InvariantResult {
  invariant: string;
  status: 'passed' | 'failed';
  reason?: string;
}

/**
 * ★★★ P0 保鲜链第 3 环（2026-10-26）：**判据覆盖对账**的一条缺口。
 *
 * 判据（决策卡 `decision.expectations`）引用的文件路径**不在** `semantic.files`
 * ⇒ 判据/对账（线 2 逐文件比、闸覆盖、快照意图）**全都覆盖不到它** —— 缺口必须点名。
 * `on_disk` = 现取磁盘存在性（**只报事实、不替读者下结论**：存在 ⇒ 判据够得着一个册外文件；
 * 不存在 ⇒ 判据指向的东西可能连盘上都没有）。
 */
export interface ExpectationCoverageGap {
  path: string;
  /** 哪些决策卡的判据指着它（一条路径可被多张卡引用 ⇒ 去重列出） */
  sources: Array<{ node_id: string; node_label: string }>;
  on_disk: boolean;
}

export interface ExpectationCoverage {
  /** 收集到的判据总条数（0 = 没有判据可对 ⇒ 缺口恒 0，不是"全对上"） */
  total_expectations: number;
  gap_count: number;
  gaps: ExpectationCoverageGap[];
}

/**
 * 判据覆盖对账（**唯一计算处**；渲染在 `checkConsistencyReport` 的消息段）。
 * · 路径提取：`expectationPaths`（主体 + 对端，edge 类两端口径已由 domain 定死）；
 * · 在册集合：`semantic.files[].path`（与 `expectationPaths` 同用 `normPath` 归一口径）；
 * · `run` 判据无路径 ⇒ 天然不参与（`expectationPaths` 已处理）。
 */
function expectationCoverageOf(dsl: DesignDSL, codeDir: string): ExpectationCoverage {
  const entries = collectExpectations(dsl);
  const ledger = new Set((dsl.semantic?.files ?? []).map((f) => normPath(f.path)));
  const byPath = new Map<string, ExpectationCoverageGap>();
  for (const { node_id, node_label, expectation } of entries) {
    for (const p of expectationPaths(expectation)) {
      if (ledger.has(p)) continue;
      let g = byPath.get(p);
      if (!g) {
        g = { path: p, sources: [], on_disk: fs.existsSync(path.join(codeDir, p)) };
        byPath.set(p, g);
      }
      if (!g.sources.some((s) => s.node_id === node_id)) g.sources.push({ node_id, node_label });
    }
  }
  const gaps = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { total_expectations: entries.length, gap_count: gaps.length, gaps };
}

/** 渲染判据覆盖对账段（**只在有缺口时出现**；无缺口不加噪声） */
function renderExpectationCoverageSection(c: ExpectationCoverage): string {
  if (c.gap_count === 0) return '';
  const L: string[] = [
    '',
    `【判据覆盖对账（决策卡判据 vs 在册文件）】`,
    `  判据 ${c.total_expectations} 条，其中指向**册外**路径的缺口 ${c.gap_count} 个：`,
  ];
  for (const g of c.gaps) {
    const who = g.sources.map((s) => `${s.node_label}(${s.node_id})`).join('、');
    L.push(`  - 判据指册外：\`${g.path}\`（来自决策卡 ${who}）——该文件在盘上${g.on_disk ? '**存在**' : '**不存在**'}`);
  }
  L.push('  ★ 后果：判据/对账覆盖不到册外路径（线 2 不比它、闸不认它）。入册：edit_dsl file add 或 import_project 增量。');
  return L.join('\n');
}

export interface ConsistencyInput {
  feature: string;
  /** 代码根目录，默认 <cwd>/scaffold/<feature>/ */
  code_dir?: string;
}

// ─────────────────────────────────────────────────────────────
// 代码解析器（已迁移到 ast_parser.ts，使用 tree-sitter）
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// API 匹配算法
// ─────────────────────────────────────────────────────────────

interface ParsedApi {
  signature: string;
  name: string;
  start_line: number;
  end_line?: number;
  kind: string;
  /** ★ v13：AST 形参表（与 `nodes.params` 同一个提取器）；缺省 = 该语法没给 `parameters` 字段 */
  params?: ParsedParam[];
  /** ★ v14：AST 返回类型原文（与 `nodes.return_type` 同源）；缺省 = 没注解 / 该语法没这个字段 */
  returnType?: string;
}

function normalizeSignature(sig: string): string {
  return sig.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 「函数契约没找到」的**默认原因串** —— 唯一住处。
 * ★ 提取它只为**一处复用**：渲染段靠它判断"这句是不是默认文案"（是则省略，不是则渲染）。
 *   否则同一句话会有两处字面量（本仓头号病：同一件事住两处）。
 * ★ T157：**类型契约**的"没找到"是**另一句**（"没找到类型声明"）—— 它必须被渲染出来。
 */
const MISSING_FUNC_REASON = '代码中未找到该函数';

/**
 * 按顶层逗号切分参数列表（跳过 ()[]{}<> 嵌套）。
 * 避免把对象字面量 {file, symbol?, ...} 或泛型 Record<string, ...> 里的逗号误当成参数分隔符。
 */
function splitTopLevelArgs(argsStr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of argsStr) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 参数名：从 'name: type' / 'name = default' / '?name' / 裸 'name' 中提取标识符 */
function argName(arg: string): string {
  const m = arg.trim().match(/^[?]?\s*([\w$]+)/);
  return m ? m[1] : arg.trim();
}

/**
 * 对象形参判据（**两侧同一把尺**）：`{ … }` / `Record<…>` / `object`。
 * ★ T154 的教训：期望侧用 `: {`、实现侧只认空 `{}` ⇒ “期望对象、实际也是非空对象”被判成不匹配。
 *   现在两侧都走这一个函数，不再各写一条正则。
 */
function isObjectishParamType(t: string | undefined): boolean {
  if (!t) return false;
  return t.includes('{') || /^Record\s*</i.test(t) || /^object$/i.test(t);
}

/** 形参名归一（解构模式折叠空白；无名形参保持空串，仍参与个数比对）。 */
function normalizeParamName(n: string): string {
  return n.replace(/\s+/g, ' ').trim();
}

/** 从设计态签名串解析形参表（**同一个内核解析器**，不是第二把尺）。
 *  返回 null = 解析不了（后缀不支持 / 包没装 / 这串不是函数声明） ⇒ 调用方退回旧文本切分。 */
async function expectedParamsOf(signature: string, filePath: string): Promise<ParsedParam[] | null> {
  const ext = path.extname(filePath).toLowerCase();
  // 去掉设计串里可能带的声明前缀；合成一段**最小可解析源码**，让内核按真实语法出参。
  let sig = signature.trim();
  sig = sig.replace(/^export\s+(?:default\s+)?/, '');
  sig = sig.replace(/^(?:(?:declare|async|public|private|protected|static|abstract|override|readonly|function)\s+)+/, '');
  let src: string;
  if (ext === '.go') src = `package p\nfunc ${sig} {}\n`;
  else if (ext === '.py') src = `def ${sig}:\n  pass\n`;
  else if (ext === '.java') src = `class C { ${sig} {} }\n`;
  else src = `declare function ${sig};\n`;
  const ast = await parseAstRoot(filePath, src);
  if (!ast) return null;
  const decl = findParamsDecl(ast.root);
  return decl ? paramsOf(decl, 'parameters', ast.langName) : null;
}

/** 合成源码里第一颗带 `parameters` 字段的函数/方法节点。 */
function findParamsDecl(root: SyntaxNodeLike): SyntaxNodeLike | null {
  let hit: SyntaxNodeLike | null = null;
  const walk = (n: SyntaxNodeLike): void => {
    if (hit) return;
    if ((n.type.includes('function') || n.type.includes('method')) && n.childForFieldName('parameters')) {
      hit = n;
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(root);
  return hit;
}

/**
 * 返回类型串：取**括号配平**后的 `)` 之后那段（不再用 `split(')')` —— 嵌套对象/函数类型里有 `)`）。
 * ★ 只用于返回类型；形参已改读 AST `params`。
 */
function returnTypeOf(signature: string): string {
  const open = signature.indexOf('(');
  if (open < 0) return '';
  let depth = 0;
  let quote = '';
  for (let i = open; i < signature.length; i++) {
    const c = signature[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return signature.slice(i + 1).trim();
    }
  }
  return '';
}

/**
 * 比对**期望签名**与**实际符号**。
 * ★★★ AB-double-name 病 A 修复：`actual` 的名字**一律取 AST 权威名**（`ParsedSymbol.name`），
 *   以 **`{ name, signature }`** 传入 —— 不再像旧版那样对 `actual.signature` **正则重取**名字。
 *   旧版同一函数体内有**两个名字来源**（`:411` 配对用 `a.name`；`:229` 判等又正则取名 actual），
 *   二者可能自相矛盾 ⇒ 明明按 `a.name` 配上了，却因正则名不同报「函数名不匹配」（假差异）。
 *   `expected` 侧仍从**设计态签名串**推名字（那是**人写的契约**，代码 AST 里没有同一份）。
 */
function compareSignatures(
  expected: string,
  /** ★ v14：`returnType` = AST 原文（`ParsedSymbol.returnType` / `nodes.return_type`）；
   *  缺省 ⇒ 返回类型退回拆签名串（`return_via` 标 `regex`） */
  actual: { name: string; signature: string; params?: ParsedParam[]; returnType?: string },
  /** ★ v13：设计侧形参表（由 `expectedParamsOf` 用**同一个内核解析器**出）；null = 解析不了 */
  expectedParams?: ParsedParam[] | null,
): { score: number; reason?: string; params_via: 'ast' | 'regex'; return_via?: 'ast' | 'regex' } {
  const expectedName = extractFuncName(expected);
  const actualName = actual.name; // ★ AST 权威名（不再对 actual.signature 正则取名）

  if (expectedName !== actualName) {
    return { score: 0, reason: '函数名不匹配', params_via: 'regex' };
  }

  const expectedNorm = normalizeSignature(expected);
  const actualNorm = normalizeSignature(actual.signature);

  if (expectedNorm === actualNorm) {
    return { score: 100, params_via: 'ast' };
  }

  // ── 主路：两侧都有 AST 形参表（v13）────────────────────────────────
  // ★ T154 的根因：原先两侧都 `match(/\(([^)]*)\)/)` **各拆一次同一根字符串**，
  //   再各自用不同正则判对象形参 ⇒ 同一事实两个出处，必然漂移。
  //   现在**形参只从 AST 出一次**（`nodes.params` / `ParsedSymbol.params` 同源），
  //   两侧只是读同一个字段；下面的文本切分**只作兜底**（保留，不删）。
  if (expectedParams != null && actual.params != null) {
    if (expectedParams.length !== actual.params.length) {
      return {
        score: 70,
        reason: `参数数量不匹配：期望 ${expectedParams.length} 个，实际 ${actual.params.length} 个`,
        params_via: 'ast',
      };
    }

    const nameAligned = expectedParams.every(
      (p, i) => normalizeParamName(p.name) === normalizeParamName(actual.params![i].name),
    );
    if (!nameAligned) {
      return {
        score: 90,
        reason:
          `形参名不一致：期望 ${expectedParams.map((p) => p.name || '<无名>').join(', ')}，` +
          `实际 ${actual.params.map((p) => p.name || '<无名>').join(', ')}`,
        params_via: 'ast',
      };
    }

    // 可选性 / 可变性也是契约（与 `compareTypeContractMembers` 的 `optional` 同一判据）
    for (let i = 0; i < expectedParams.length; i++) {
      const e = expectedParams[i];
      const a = actual.params[i];
      if (e.optional !== a.optional) {
        return {
          score: 90,
          reason: `形参可选性不一致：${e.name}（期望 ${e.optional ? '可选(?)' : '必填'} / 实际 ${a.optional ? '可选(?)' : '必填'}）`,
          params_via: 'ast',
        };
      }
      if (e.variadic !== a.variadic) {
        return {
          score: 90,
          reason: `形参可变性不一致：${e.name}（期望 ${e.variadic ? '可变(...)' : '固定'} / 实际 ${a.variadic ? '可变(...)' : '固定'}）`,
          params_via: 'ast',
        };
      }
    }

    // 对象形参契约：两侧**同一个判据函数**（T154 的修法，不再各写一条正则）
    const expHasObj = expectedParams.some((p) => isObjectishParamType(p.type));
    const actHasObj = actual.params.some((p) => isObjectishParamType(p.type));
    if (expHasObj && !actHasObj) {
      const actText = actual.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type ?? '?'}`).join(', ');
      return { score: 80, reason: `形参类型不匹配：期望对象形参，实际 ${actText}`, params_via: 'ast' };
    }

    // 返回类型：★ v14 优先读 **AST**（`ParsedSymbol.returnType` / `nodes.return_type`），
    //   拆签名串只作**兜底**且明标 `return_via`（不再两边各拆一次同一根串）。
    //   判据不变：仅当两侧都是具体类型（不含语义省略号 ...）时才严格比对。
    const expectedRet = returnTypeOf(expected);
    const actualRet = actual.returnType ?? returnTypeOf(actual.signature);
    const returnVia: 'ast' | 'regex' = actual.returnType != null ? 'ast' : 'regex';
    const expConcrete = !!expectedRet && !expectedRet.includes('...');
    const actConcrete = !!actualRet && !actualRet.includes('...');
    const retCompatible =
      !expConcrete ||
      !actConcrete ||
      expectedRet.toLowerCase().includes(actualRet.toLowerCase()) ||
      actualRet.toLowerCase().includes(expectedRet.toLowerCase());
    if (!retCompatible) {
      return { score: 80, reason: `返回类型不匹配：期望 ${expectedRet}，实际 ${actualRet}`, params_via: 'ast', return_via: returnVia };
    }

    return { score: 100, params_via: 'ast', return_via: returnVia };
  }

  // ── 兜底：文本切分（**原逻辑原样保留**；只在 AST 给不出形参时走）──────────
  const expectedArgs = expected.match(/\(([^)]*)\)/)?.[1] || '';
  const actualArgs = actual.signature.match(/\(([^)]*)\)/)?.[1] || '';
  const expectedArgList = splitTopLevelArgs(expectedArgs);
  const actualArgList = splitTopLevelArgs(actualArgs);

  if (expectedArgList.length !== actualArgList.length) {
    return { score: 70, reason: `参数数量不匹配：期望 ${expectedArgList.length} 个，实际 ${actualArgList.length} 个`, params_via: 'regex' };
  }

  // 参数名对齐：语义契约的形参名应与实现一致（如都叫 args）
  const expNames = expectedArgList.map(argName);
  const actNames = actualArgList.map(argName);
  const nameAligned = expNames.every((n, i) => n === actNames[i]);

  if (nameAligned) {
    const expHasObj = /:\s*\{/.test(expectedArgs);
    const actIsObj = /:\s*\{|Record\s*<|\bobject\b/i.test(actualArgs);
    if (expHasObj && !actIsObj) {
      return { score: 80, reason: `形参类型不匹配：期望对象形参，实际 ${actualArgs}`, params_via: 'regex' };
    }

    // 返回类型：★ v14 即使走文本兜底，返回类型**仍先读 AST**（`actual.returnType`）——
    //   “形参拆串”与“返回值拆串”是两件事，别一并降级。
    const expectedRet = returnTypeOf(expected);
    const actualRet = actual.returnType ?? returnTypeOf(actual.signature);
    const returnVia: 'ast' | 'regex' = actual.returnType != null ? 'ast' : 'regex';
    const expConcrete = !!expectedRet && !expectedRet.includes('...');
    const actConcrete = !!actualRet && !actualRet.includes('...');
    const retCompatible =
      !expConcrete ||
      !actConcrete ||
      expectedRet.toLowerCase().includes(actualRet.toLowerCase()) ||
      actualRet.toLowerCase().includes(expectedRet.toLowerCase());
    if (!retCompatible) {
      return { score: 80, reason: `返回类型不匹配：期望 ${expectedRet}，实际 ${actualRet}`, params_via: 'regex', return_via: returnVia };
    }

    return { score: 100, params_via: 'regex', return_via: returnVia };
  }

  return { score: 90, reason: '签名不完全一致', params_via: 'regex' };
}

/**
 * 比对**类型契约**的成员（T157，2026-10-11）。
 *
 * ## 为什么要它（它答的问题此前**无人答**）
 * `expected_apis` 也可以写成一行类型声明（如
 * `export interface Touched { feature?: string; … }`）—— 这是本仓**最核心的契约面**
 * （"统一 [B] 契约形状"）。而在此之前，判定器**只收 `kind==='function'|'method'`** 的符号
 * ⇒ 类型契约**一律报「❌ 缺失」**（**假红**）。★ 而"只按名字配上"的弱匹配又测不出字段漂移（**假绿**）
 * ⇒ 两难。本函数走第三条路：**逐成员比**。
 *
 * ## 判据（三条，都要能证伪）
 * 1. **只对"契约声明了的成员"判**：契约没写的成员，实现多出来 ⇒ **不算差异**
 *    （照 T85/D1b 已立的先例：**契约只声明"必需有什么"**，不是"必须等于代码"）。
 *    ★★ 但**必须报出来**（`extras`）—— 否则"设计侧只声明了一小片"会被读成"完全一致"。
 * 2. **类型**：两侧**都**有类型注解时才比（归一化后逐字比）；**一侧没有 ⇒ `unjudged`**
 *    （★ 不许静默当"匹配" —— 那是"不报错的错"）。
 * 3. **可选性**：`?` 与必填是**不同的契约**（`summary: string` ≠ `summary?: string`）⇒ 也算漂移。
 */
function compareTypeContractMembers(
  expectedMembers: ParsedTypeMember[],
  actualMembers: ParsedTypeMember[],
): NonNullable<ApiMatch['members']> {
  const byName = new Map(actualMembers.map((m) => [m.name, m]));
  const missing: string[] = [];
  const drifted: NonNullable<ApiMatch['members']>['drifted'] = [];
  const unjudged: string[] = [];
  let matched = 0;

  for (const exp of expectedMembers) {
    const act = byName.get(exp.name);
    if (!act) {
      missing.push(exp.name);
      continue;
    }
    if (exp.optional !== act.optional) {
      drifted.push({
        name: exp.name,
        kind: 'optional',
        expected: exp.optional ? '可选(?)' : '必填',
        actual: act.optional ? '可选(?)' : '必填',
      });
      continue;
    }
    const et = normalizeMemberType(exp.type);
    const at = normalizeMemberType(act.type);
    if (et === undefined || at === undefined) {
      unjudged.push(exp.name);
      continue;
    }
    if (et !== at) {
      drifted.push({ name: exp.name, kind: 'type', expected: exp.type ?? '', actual: act.type ?? '' });
      continue;
    }
    matched++;
  }

  const declared = new Set(expectedMembers.map((m) => m.name));
  const extras = actualMembers.filter((m) => !declared.has(m.name)).map((m) => m.name);
  return { matched, missing, drifted, extras, unjudged };
}

/** 把类型契约的比对结果压成一句 `reason`（**只报事实，不替调用方裁决**）。 */
function typeContractReason(m: NonNullable<ApiMatch['members']>): string | undefined {
  const parts: string[] = [];
  if (m.missing.length) parts.push(`实现缺 ${m.missing.length} 个成员：${m.missing.join(', ')}`);
  if (m.drifted.length) {
    parts.push(
      `${m.drifted.length} 个成员漂移：` +
        m.drifted.map((d) => `${d.name}（${d.kind === 'type' ? '类型' : '可选性'} 期望 ${d.expected} / 实际 ${d.actual}）`).join('；'),
    );
  }
  if (m.unjudged.length) parts.push(`${m.unjudged.length} 个成员**判不了**（一侧无类型注解）：${m.unjudged.join(', ')}`);
  return parts.length ? parts.join('｜') : undefined;
}

// ─────────────────────────────────────────────────────────────
// 不变式验证
// ─────────────────────────────────────────────────────────────

function checkInvariants(dsl: DesignDSL, codeDir: string): InvariantResult[] {
  const results: InvariantResult[] = [];
  const invariants = dsl.semantic?.multi_file_invariants || [];

  for (const invariant of invariants) {
    let passed = true;
    let reason: string | undefined;

    const fileRefMatch = invariant.match(/file:([^\s]+)/);
    if (fileRefMatch) {
      const filePath = path.join(codeDir, fileRefMatch[1]);
      if (!fs.existsSync(filePath)) {
        passed = false;
        reason = `文件不存在: ${filePath}`;
      }
    }

    const funcRefMatch = invariant.match(/func:([^\s]+)/);
    if (funcRefMatch && passed) {
      const funcName = funcRefMatch[1];
      let found = false;
      for (const file of dsl.semantic?.files || []) {
        const fullPath = path.join(codeDir, file.path);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes(funcName)) {
            found = true;
            break;
          }
        }
      }
      if (!found) {
        passed = false;
        reason = `函数不存在: ${funcName}`;
      }
    }

    results.push({
      invariant,
      status: passed ? 'passed' : 'failed',
      reason,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────────────────────

export async function checkConsistencyReport(input: ConsistencyInput): Promise<ConsistencyResult> {
  const { feature, code_dir } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在`);
  }

  // ★★★ T97：**这里原先是"没有 semantic.files 就整体拒"—— 已撤（过度拒绝，丢能力）**。
  //   本函数有**两条各自独立的线**（见文件头与本类型注释）：
  //   · **线 1**（`checkBaselineDrift`）= `baseline/<feature>.facts.json` vs 现取事实。
  //     它取"本 feature 有哪些文件"读的是**基线事实文件**（`import_project` 用**扫描出的文件**
  //     锚定，见 `import_project.ts` 的 `scopeRels`）—— **独立于 DSL** ⇒ 聚合模式下**照样可算**。
  //     判据（实测）：`checkBaselineDrift` 只 `Object.entries(baseline.files)`，**从不读 `semantic.files`**。
  //   · **线 2**（下面的 `fileResults`）= DSL 的 `expected_apis` vs 现取事实 ⇒ 它**逐 `semantic.files`** 比
  //     ⇒ 聚合模式下**没有对手**（无逐文件契约）⇒ 如实报「**线 2 无内容**」，**不是错误**。
  //   ⇒ 所以：**照跑线 1**，线 2 空则报告"无内容"。★ 判据住一处（`hasFileEntries`）。
  const fileEntriesPresent = hasFileEntries(dsl.semantic);

  // 摩擦 G 修复：未显式传 code_dir 时，自动用 DSL 记录的 source_root（import_project
  // 已把 project_dir 写入 source_root）作为代码根，外部项目无需每次手传 code_dir；
  // 仍无 source_root（手工建的 DSL）才回退到默认 scaffold/<feature>。
  const codeDir = code_dir
    ? path.resolve(code_dir)
    : dsl.source_root
      ? path.resolve(dsl.source_root)
      : path.join(process.cwd(), 'scaffold', feature);

  const fileResults: FileConsistency[] = [];
  let matchedCount = 0;
  let missingCount = 0;
  let mismatchedCount = 0;
  let unexpectedCount = 0;

  // ★★★ T97：**线 2（逐文件 vs "人指定的契约"）只在"有文件级条目"时才有对手。**
  //   `semantic.files` 为空（手工建的 DSL / 旧产物；2026-10-09 前聚合模式 functional_mode / design_mode
  //   导入的产物，该模式已移除：0 使用 + 有害 T101）⇒ 这里 0 次迭代，
  //   渲染段会用 `noFileEntriesMessage` 如实报「线 2 无内容」（**不是错误、也不是"全过"**）。
  //   ★ 这里**内联**调 `hasFileEntries`（而非复用上面的 `fileEntriesPresent`）：它的返回是**类型谓词**
  //     ⇒ TS 在本 `if` 内把 `dsl.semantic` 收敛为**已定义**，循环内取 `dsl.semantic.files` 无需 `?.` / `?? []`。
  //     （判据仍是同一处 —— 函数本身；下面渲染段的 `fileEntriesPresent` 与本调用**同源**。）
  if (hasFileEntries(dsl.semantic)) {
    for (const file of dsl.semantic.files) {
      const fullPath = path.join(codeDir, file.path);
      const exists = fs.existsSync(fullPath);

      const apiMatches: ApiMatch[] = [];
      const expectedApis = file.expected_apis || [];
      const actualApis: ParsedApi[] = [];
      const fileNotes: string[] = [];
      /** ★ T157 期望侧的**形态判定**（下标 → 结果）：只在"文件存在且扩展名受支持"时填 */
      const declExpectations = new Map<number, SignatureDeclResult>();
      /** ★ v13 期望侧形参（下标 → AST 形参表 / null=解析不了）；与 `nodes.params` 同一个提取器 */
      const paramExpectations = new Map<number, ParsedParam[] | null>();
      /** ★ T157 实际文件的 AST 根 —— **只在真有类型契约时才解析**（不白付代价）。 */
      let typeAst: SyntaxNodeLike | null = null;

      if (exists) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (isSupportedFile(file.path)) {
          const symbols: ParsedSymbol[] = await parseFileSymbols(file.path, content);
          for (const s of symbols) {
            if (s.kind === 'function' || s.kind === 'method') {
              actualApis.push({
                signature: s.signature,
                name: s.name,
                start_line: s.start_line,
                end_line: s.end_line,
                kind: s.kind,
                // ★ v13：形参读 AST（与 `nodes.params` 同一个提取器），不再拆 signature
                params: s.params,
                // ★ v14：返回类型也读 AST（与 `nodes.return_type` 同源）
                returnType: s.returnType,
              });
            }
          }

          // ★ T157：判"这条契约是**类型声明**还是**函数签名**"的依据是**内核解析器**
          //   （`typeDeclFromSignature`）—— **不是正则/关键字匹配**（那会与本处再分叉一把尺）。
          //   `unparsable`（本文件的内核解析器不可用）**如实记进 fileNotes**，不许静默。
          let unparsable = 0;
          for (let i = 0; i < expectedApis.length; i++) {
            const r = await typeDeclFromSignature(expectedApis[i].signature, file.path);
            if (r.kind === 'unparsable') unparsable++;
            declExpectations.set(i, r);
            // ★ v13：函数/方法契约的形参也走**同一个内核解析器**（不是第二把尺）。
            //   解析不了 ⇒ null ⇒ 比对时退回文本切分（兜底保留，回执标 via=regex）。
            if (r.kind !== 'type-decl') {
              paramExpectations.set(i, await expectedParamsOf(expectedApis[i].signature, file.path));
            }
          }
          if (unparsable > 0) {
            fileNotes.push(
              `★ 有 ${unparsable} 条契约的**形态判不了**（本文件的内核解析器不可用）⇒ 那几条退回按**名字**比（可能把"类型契约"误读成"函数契约"）。`,
            );
          }

          const needsTypeAst = [...declExpectations.values()].some((r) => r.kind === 'type-decl');
          if (needsTypeAst) {
            const ast = await parseAstRoot(fullPath, content);
            typeAst = ast ? ast.root : null;
            if (!typeAst) {
              fileNotes.push('★ 实际文件的 **AST 取不到** ⇒ 本文件的类型契约**判不了**（不是"缺失"）。');
            }
          }
        }
      }

      const matchedNames = new Set<string>();

      for (let i = 0; i < expectedApis.length; i++) {
        const expected = expectedApis[i];
        const declExp = declExpectations.get(i);

        // ── 分支 A（T157）：**类型契约** ⇒ 逐成员比（不再是"一律缺失"的假红，也不是"只按名字"的假绿）──
        if (declExp && declExp.kind === 'type-decl') {
          const td = declExp.decl;
          const declNode = typeAst ? findTypeDeclByName(typeAst, td.name) : null;
          matchedNames.add(td.name);
          if (!declNode) {
            apiMatches.push({
              expected_signature: expected.signature,
              expected_notes: expected.notes,
              status: 'missing',
              match_score: 0,
              reason: typeAst
                ? `代码中未找到类型声明 \`${td.name}\`（契约声明了 ${td.members.length} 个成员）`
                : `★ 判不了：实际文件 AST 取不到（**不是**"契约缺失"）`,
            });
            missingCount++;
            continue;
          }
          const members = compareTypeContractMembers(td.members, typeMembersOf(declNode));
          const bad = members.missing.length + members.drifted.length;
          apiMatches.push({
            expected_signature: expected.signature,
            expected_notes: expected.notes,
            actual_signature: `${td.name} { 契约声明 ${td.members.length} 个成员，对齐 ${members.matched} 个 }`,
            actual_location: `${file.path}:${declNode.startPosition.row + 1}`,
            status: bad === 0 ? 'matched' : 'mismatched',
            match_score: bad === 0 ? 100 : 0,
            reason: typeContractReason(members),
            members,
          });
          if (bad === 0) matchedCount++;
          else mismatchedCount++;
          continue;
        }

        // ── 分支 B：函数/方法契约（**原有路径，一字未改**）──
        const expectedName = extractFuncName(expected.signature);
        const actual = actualApis.find(a => a.name === expectedName);

        if (actual) {
          // ★ 病 A：把**整个 actual**（含 AST 权威名 `name`）传进去，判等用 `actual.name`，不再正则重取。
          // ★ v13：设计侧形参也由内核解析（`expectedParamsOf`）；两侧都拿到才走 AST 主路。
          const comparison = compareSignatures(expected.signature, actual, paramExpectations.get(i));
          matchedNames.add(expectedName);

          if (comparison.score >= 90) {
            apiMatches.push({
              expected_signature: expected.signature,
              expected_notes: expected.notes,
              actual_signature: actual.signature,
              actual_location: `${file.path}:${actual.start_line}`,
              status: comparison.score === 100 ? 'matched' : 'mismatched',
              match_score: comparison.score,
              reason: comparison.reason,
              params_via: comparison.params_via,
              // ★ v14：返回类型的判据来源（和形参分开标）
              return_via: comparison.return_via,
            });
            if (comparison.score === 100) {
              matchedCount++;
            } else {
              mismatchedCount++;
            }
          } else {
            apiMatches.push({
              expected_signature: expected.signature,
              expected_notes: expected.notes,
              actual_signature: actual.signature,
              actual_location: `${file.path}:${actual.start_line}`,
              status: 'mismatched',
              match_score: comparison.score,
              reason: comparison.reason,
              params_via: comparison.params_via,
              // ★ v14：返回类型的判据来源（和形参分开标）
              return_via: comparison.return_via,
            });
            mismatchedCount++;
          }
        } else {
          apiMatches.push({
            expected_signature: expected.signature,
            expected_notes: expected.notes,
            status: 'missing',
            match_score: 0,
            reason: MISSING_FUNC_REASON,
          });
          missingCount++;
        }
      }

      // ★★★ 2026-10-09（T85/D1b）：**这里原来会报「代码新增」—— 现已移除，且是不该存在的一类。**
      //   理由（一句话）：**`expected_apis` 是「人指定的契约」，不是「必须等于代码」**
      //   ⇒ "代码里有、契约里没写"是**常态**（没人会为每个内部函数都写契约），**不是差异**。
      //   ★ 而"**代码相对基线新增了什么**"是**另一个问题** ⇒ 归**线 1**（`checkBaselineDrift`）✓
      //     —— 那才是"新增"的正主（它有"基线"这个对手；而本函数没有）。
      //   ★ 记账：这条此前会把"fork 时被 50 上限截掉的 symbol"全报成"代码新增"
      //     （实测 5/6 个真仓：`elv` 44 条、`dsh-brain` 25 条……用户对真项目做的**第一件事**就看到它）。
      //   ★ `unexpectedCount` **保留字段但恒 0**（`ConsistencyResult.summary.unexpected` 有外部读者，
      //     删字段会波及下游；而"恒 0 + 本节说明"语义正确且零破坏）。

      fileResults.push({
        file,
        file_path: fullPath,
        exists,
        apis: apiMatches,
        ...(fileNotes.length ? { notes: fileNotes } : {}),
      });
    }
  }

  const invariantResults = checkInvariants(dsl, codeDir);
  const invariantPassed = invariantResults.filter(r => r.status === 'passed').length;
  const invariantFailed = invariantResults.filter(r => r.status === 'failed').length;

  // ★★★ 2026-10-10：**线 2 到底"比了几条"** + 三态机读值（唯一定义见 `comparisonState`）。
  //   `comparedCount` = 真的比了多少条 `expected_apis`（每条约产生一条 ApiMatch）——
  //   `0` ⇒ **没得比**（`expected_apis=0` 或没有文件级条目）：**不许**把这种"没查"读成"没问题"。
  const comparedCount = matchedCount + missingCount + mismatchedCount;
  const cmpState = comparisonState(comparedCount, missingCount + mismatchedCount);

  // ★★★ T184（2026-10-12）：**三步流的②** —— 设计说该删的，实现侧删完了没有？
  //   ★ 判据住一处：`retireStage(exists)`；本处**只负责挑出 `deprecated` 的条目**并组装。
  //   ★ 与线 2 **不共用口径**（线 2 数的是 `expected_apis` 条数；这里数的是**文件**），
  //     所以它**不参与** `comparedCount` / `cmpState` —— 混进去就会把"没得比"算成"比过"。
  // ★★★ T184b（2026-10-12）：**两个来源合起来** —— 此前只有第一个。
  //   ① base（`semantic.files`）里标着 `deprecated` 的；② **overlay 上的墓碑**（文件已从 base 消失、
  //   只剩标记）—— ★ 少了②，**显式重建之后 ② 就瞎了**（详见 `overlayTombstones` 的注释）。
  const baseRetire: RetireFlowEntry[] = fileResults
    .filter((fr) => fr.file.lifecycle?.status === 'deprecated')
    .map((fr) => ({
      file_path: fr.file.path,
      design_status: 'deprecated' as const,
      // ★ `retire_reason` 在①是**必填**（`assertLifecycle` 拦过）⇒ 这里照搬；万一历史数据没有，就是 undefined（不编一个）
      retire_reason: fr.file.lifecycle?.retire_reason,
      exists: fr.exists,
      stage: retireStage(fr.exists),
      origin: 'base_dsl' as const,
    }));
  const basePaths = new Set((dsl.semantic?.files ?? []).map((f) => f.path));
  const retireFlow: RetireFlowEntry[] = [
    ...baseRetire,
    ...overlayTombstones(feature, basePaths, (rel) => fs.existsSync(path.join(codeDir, rel))),
  ];
  const retirePending = retireFlow.filter((e) => e.stage === 'awaiting_implementation_delete').length;
  const retireReady = retireFlow.filter((e) => e.stage === 'ready_to_archive').length;

  // ★★ 反向的信号：实现里**已经没了**、而设计侧**没标** `deprecated` 的文件。
  //   ★ 为什么值得单列：它是**①的前置状态**（"代码先没了，设计侧还没记账"）。
  //     ★ 也**不作差异**：`exists=false` 可能是"这文件从来就不存在"（DSL 写错/代码换过目录）
  //       ⇒ **只说数、不下结论**（下结论要人看路径）。
  const vanishedUnmarked = fileResults.filter(
    (fr) => !fr.exists && fr.file.lifecycle?.status !== 'deprecated',
  );

  // 构建报告消息
  const lines: string[] = [];
  // ★★ 标题**不含「一致」** —— 否则"没得比"态里 grep「一致」会命中标题，读者/机器分不清
  //   "这是报告名"还是"这是结论"。本工具做的是「设计↔实现**对账**」，报告名照此写。
  lines.push(`=== 设计↔实现 对账报告 - ${feature} ===`);
  lines.push('');
  // ★★★ 2026-10-09（T85/D1b **正名**）：标题说清这是「**线 2**」——
  //   它的对手是「**人指定的契约**（`expected_apis`）」，**不是**「代码相对基线变了没」（那是**线 1**）。
  lines.push('【线 2 · 设计（**人指定的契约** `expected_apis`）vs 实现】');
  if (!fileEntriesPresent) {
    // ★★★ T97：本 feature 语义层没有逐文件条目（手工建的 DSL / 旧产物；2026-10-09 前聚合模式
    //   functional_mode / design_mode 导入的产物，该模式已移除：0 使用 + 有害 T101）
    //   ⇒ **线 2 没有"对手"**（不是"没有差异"）。**这要报告，不是错误。**
    //   ★ 与 `check_status` / `scaffold` 的拒**共用同一条说明**（`noFileEntriesMessage`，唯一住处）。
    lines.push(noFileEntriesMessage(feature));
    lines.push('');
    lines.push('★ 因此 **线 2 没得比** —— 不是"没有差异"，是"**没有对手**"（本 feature 的 DSL 里没有逐文件的 `expected_apis` 契约）⇒ **给不出结论**。');
    if (invariantResults.length > 0) lines.push(`  （跨文件不变式仍有判据：通过 ${invariantPassed}/${invariantResults.length}，见下）`);
    lines.push('');
    lines.push('  ★ 「**代码新增**」不在这里 —— 它是**线 1** 的事（相对**基线**），见下面「线 1 · 代码相对基线的变更」。');
    lines.push('');
  } else if (comparedCount === 0) {
    // ★★★ 2026-10-10：**有文件条目，但 `expected_apis` 共 0 条** ⇒ **没得比**。
    //   ★ 原先落到下面的 else 分支 ⇒ 末尾还说「✓ 线 2 无待办（…签名一致）」——
    //     **什么都没比却报"一致"**（用户读到"检查过了、没问题"，真相是"没有东西可查"）。
    //   ★ 这里**主动说清"没得比 ⇒ 给不出结论"**（不许靠"少说一句话"来回避 —— 沉默会被读成"没问题"）。
    lines.push(`  文件数: ${fileResults.length}`);
    lines.push(`  ★★ **没得比**：这 ${fileResults.length} 个文件里 \`expected_apis\` 共 **0 条** ⇒ 本轮**实际比对了 0 条**。`);
    lines.push('  ★ 没得比 ⇒ **给不出结论**：不能说"没问题"，也不能说"有问题"（**没有对手，就没有对错可言**）。');
    lines.push('  ★ 为什么单独说：报告里若只剩 `0/0/0` + 一句"无待办"，会被读成"查过、没事" —— 而真相是**什么都没查**。');
    lines.push('  ★ 出路：给这些文件写 `expected_apis`（`import_project` 或 `edit_dsl`），下一轮才有东西可对拍。');
    lines.push(`  不变式通过: ${invariantPassed}/${invariantResults.length}（★ 不变式是**另一件事**：它不依赖 \`expected_apis\`）`);
    lines.push('');
    lines.push('  ★ 「**代码新增**」**不在这里** —— 它是**线 1** 的事（相对**基线**），见下面「线 1 · 代码相对基线的变更」。');
    lines.push('');
  } else {
    lines.push(`  文件数: ${fileResults.length}`);
    lines.push(`  ✅ 契约已实现: ${matchedCount}`);
    lines.push(`  ❌ 契约缺失: ${missingCount}`);
    lines.push(`  ⚠️ 签名不匹配: ${mismatchedCount}`);
    // ★ T157：把"其中有多少条是**类型契约**（逐成员比）"说出来 —— 否则读者不知道
    //   `✅ 已实现` 里混着两类完全不同的判据（函数签名 vs 成员集）。
    const typeContractCount = fileResults.reduce(
      (n, fr) => n + fr.apis.filter((a) => a.members !== undefined).length,
      0,
    );
    if (typeContractCount > 0) {
      lines.push(`  · 其中**类型契约**（interface/type/class，逐成员比）：${typeContractCount} 条`);
    }
    // ★ **删掉 `🆕 代码新增` 那一行** —— 那一类**已废**（"代码里有、契约没写"是常态，不是差异）；
    //   而留着一个恒 0 的行更坏：读者会把「没有代码新增」读成「代码没变」（真相要看**线 1**）。
    lines.push(`  不变式通过: ${invariantPassed}/${invariantResults.length}`);
    lines.push('');
    lines.push('  ★ 「**代码新增**」**不在这里** —— 它是**线 1** 的事（相对**基线**），见下面「线 1 · 代码相对基线的变更」。');
    lines.push('');
  }

  for (const fr of fileResults) {
    lines.push(`【文件】${fr.file.path}`);
    lines.push(`  状态: ${fr.exists ? '存在' : '❌ 不存在'}`);
    if (!fr.exists) continue;

    // ★ T157：文件层面的诚实边界（形态判不了 / AST 取不到）——**不许静默**
    for (const n of fr.notes ?? []) lines.push(`  ${n}`);

    const matched = fr.apis.filter(a => a.status === 'matched');
    const missing = fr.apis.filter(a => a.status === 'missing');
    const mismatched = fr.apis.filter(a => a.status === 'mismatched');
    const unexpected = fr.apis.filter(a => a.status === 'unexpected');

    if (matched.length > 0) {
      lines.push(`  ✅ 已实现 (${matched.length}):`);
      for (const a of matched) {
        lines.push(`    - ${a.expected_signature}`);
        // ★ T157：类型契约要**说清它比了什么**，并把"实现多出来的成员"如实报出
        //   —— 否则"设计侧只声明了一小片"会被读成"完全一致"（本仓反复踩的坑）。
        if (a.members) {
          const m = a.members;
          let s = `      · 类型契约：契约声明的 ${m.matched + m.unjudged.length} 个成员都在，其中 ${m.matched} 个逐字对齐`;
          if (m.unjudged.length) s += `｜★ ${m.unjudged.length} 个**判不了**（一侧无类型注解）：${m.unjudged.join(', ')}`;
          if (m.extras.length) s += `｜★ 实现多出 ${m.extras.length} 个契约**未声明**的成员（**不算差异**，但请看）：${m.extras.join(', ')}`;
          lines.push(s);
        }
      }
    }

    if (missing.length > 0) {
      lines.push(`  ❌ 缺失 (${missing.length}):`);
      for (const a of missing) {
        lines.push(`    - ${a.expected_signature}${a.expected_notes ? ' (' + a.expected_notes + ')' : ''}`);
        // ★ T157：类型契约的"缺失"原因与函数**不同**（"没找到类型声明" ≠ "没找到函数"）——
        //   默认那句（`MISSING_FUNC_REASON`）不必重复渲染（它对读者没有新信息）。
        if (a.reason && a.reason !== MISSING_FUNC_REASON) lines.push(`      原因: ${a.reason}`);
      }
    }

    if (mismatched.length > 0) {
      lines.push(`  ⚠️ 签名不匹配 (${mismatched.length}):`);
      for (const a of mismatched) {
        lines.push(`    - 期望: ${a.expected_signature}`);
        lines.push(`      实际: ${a.actual_signature} (${a.actual_location})`);
        if (a.reason) lines.push(`      原因: ${a.reason}`);
        // ★ T157：类型契约**逐成员列出**（哪条缺、哪条漂移、哪条判不了）
        if (a.members) {
          const m = a.members;
          lines.push(`      · 类型契约成员：对齐 ${m.matched}`);
          for (const name of m.missing) lines.push(`        ❌ 契约声明了 \`${name}\`，实现里没有`);
          for (const d of m.drifted) {
            lines.push(`        ⚠️ \`${d.name}\` ${d.kind === 'type' ? '类型' : '可选性'}漂移：期望 ${d.expected} / 实际 ${d.actual}`);
          }
          for (const name of m.unjudged) lines.push(`        ○ \`${name}\` 判不了（一侧无类型注解）`);
          if (m.extras.length) lines.push(`        ★ 实现多出（**不算差异**）：${m.extras.join(', ')}`);
        }
      }
    }

    if (unexpected.length > 0) {
      lines.push(`  🆕 代码新增 (${unexpected.length}):`);
      for (const a of unexpected) {
        lines.push(`    - ${a.actual_signature} (${a.actual_location})`);
      }
    }

    lines.push('');
  }

  if (invariantResults.length > 0) {
    lines.push('【跨文件不变式】');
    for (const ir of invariantResults) {
      lines.push(`  ${ir.status === 'passed' ? '✅' : '❌'} ${ir.invariant}`);
      if (ir.reason) lines.push(`    原因: ${ir.reason}`);
    }
    lines.push('');
  }

  // ★★★ 2026-10-09（T85/D3）：**两条线各自"摘要 + 建议"自成一段** —— 顺序：
  //   **线 2（摘要 + 建议）→ 线 1**。★ 建议**必须紧跟它自己那条线**（隔远了读者就不知道它在说谁）。
  //   线 2 = `DSL.expected_apis`（人写的**契约**）vs 现取事实。见上。
  //   线 1 = `基线事实`（fork 那一刻）vs 现取事实 ⇒ 「**代码相对基线变了没有**」。
  //   ★ 规则：**期望侧与被比侧不能同源** —— 否则就是"自己测自己"。
  //   ★ 两条线**各有各的对手**；混着看就会**分不清"代码变了"还是"设计改了"**（T85 的病根）。
  const advice: string[] = [];
  if (missingCount > 0) advice.push('  - 实现缺失的契约 API（或把契约改对 —— ★ 契约是**人指定的**，代码不必覆盖它）');
  if (mismatchedCount > 0) advice.push('  - 修正签名不匹配的函数（或把契约签名改对，见上）');
  // ★ T85/D1b：原建议「把代码新增的 API 添加到 DSL expected_apis」**已删** —— 那是**把事实塞进意图**
  //   （正是 T20/T85 要根治的）。★ 想看「代码新增了什么」⇒ 看**线 1**（相对基线）。
  // ★★★ T157：把**类型契约**的成员级差异与上面的粗粒度计数**分开说** ——
  //   `❌ 契约缺失` 说"有一条契约没实现"，而这里说"**哪一个字段**没了/漂了"（可执行得多）。
  let memberMissingTotal = 0;
  let memberDriftedTotal = 0;
  let memberUnjudgedTotal = 0;
  let memberExtrasTotal = 0;
  for (const fr of fileResults) {
    for (const a of fr.apis) {
      if (!a.members) continue;
      memberMissingTotal += a.members.missing.length;
      memberDriftedTotal += a.members.drifted.length;
      memberUnjudgedTotal += a.members.unjudged.length;
      memberExtrasTotal += a.members.extras.length;
    }
  }
  if (memberMissingTotal > 0) {
    advice.push(`  - 类型契约里**实现缺 ${memberMissingTotal} 个成员**：补实现，或把契约改对（★ 契约是**人指定的**）`);
  }
  if (memberDriftedTotal > 0) {
    advice.push(`  - 类型契约里**有 ${memberDriftedTotal} 处成员漂移**（类型/可选性）：以哪边为准**要人裁**（契约是意图、代码是事实）`);
  }
  if (memberUnjudgedTotal > 0) {
    advice.push(`  - ★ 有 ${memberUnjudgedTotal} 个成员**判不了**（一侧无类型注解）⇒ **别当成"匹配"**`);
  }
  if (invariantFailed > 0) advice.push('  - 修复失败的不变式');
  if (advice.length) {
    lines.push('【建议（仅针对线 2）】');
    lines.push(...advice);
    lines.push('');
  } else if (cmpState === 'consistent') {
    // ★★ 只在**线 2 真的比过**（`comparedCount > 0`）且**全对得上**时才说这句。
    //   ★ 判据从 `fileEntriesPresent` 改成 `cmpState === 'consistent'`：后者在
    //     `expected_apis=0`（**有文件却没契约**）时也成立 ⇒ 会说出「无待办（…签名一致）」
    //     这种**没比就报好**的话（2026-10-10 实测的真缺陷，本笔修的就是它）。
    lines.push(`  ✓ **线 2 比过且一致**（比了 ${comparedCount} 条契约，全部对得上）—— 这不是"没跑"。`);
    lines.push('');
  }
  // ★ `cmpState === 'no_comparison'`（**没得比**）在此**刻意什么都不说** ——
  //   上面「没得比 ⇒ 给不出结论」那一段已把话说清；这里若再补一句"无待办/一致"就是**没比却报好**。

  // ★★★ T157：**「不算差异、但值得看」单列一段** —— 它**不参与**上面"建议 / 比过且一致"的取舍。
  //   理由：`extras` 不是差异（契约只声明"必需有什么"）⇒ 不该把 `consistent` 顶掉；
  //   但它**是本仓最值钱的信号之一**：代码长出了契约没记得的东西 = **设计侧过期**
  //   （与那张 `tool_faces.ts` 决策卡同族）⇒ 不报出来，"设计侧只声明了一小片"就会被读成"完全一致"。
  if (memberExtrasTotal > 0) {
    lines.push('【★ 不算差异，但值得看（仅针对线 2）】');
    lines.push(`  - 类型契约里，实现**多出 ${memberExtrasTotal} 个契约未声明的成员** ⇒ ★ **不算差异**（契约只声明"必需有什么"），`);
    lines.push('    但多半说明**设计侧过期了**（代码长出了契约没记得的东西）⇒ 值得**回写契约**（回写是**人**的活，不是本工具的）。');
    lines.push('');
  }

  // ★★★ T184：**三步流的②** —— 独立成段，★ **不放在线 2 的 if/else 里**
  //   （理由：本轴**不依赖 `expected_apis`** ⇒ 在"契约 0 条"的报告里也必须照样出现，
  //    地位同"跨文件不变式"）。
  //   ★ 也不叫"线 3"：本仓 `线 1`/`线 2` 已各有明确对手，而这根轴对的是
  //     **"该不该删"**，与"签名/契约"无关 ⇒ 用**它的流程名**（待删）称呼，别蹭编号。
  if (retireFlow.length > 0 || vanishedUnmarked.length > 0) {
    lines.push('【设计侧待删（三步流：①标记 → ②对拍确认 → ③归档）】');
    if (retireFlow.length === 0) {
      lines.push('  （本 feature **没有**任何 `deprecated` 标记 —— ★ 别读成"都删完了"）');
    } else {
      lines.push(`  标记总数: ${retireFlow.length}（★ 设计侧声明"该删"，理由见下）`);
      if (retirePending > 0) {
        lines.push(`  ⏳ **待实现侧删除（${retirePending}）** —— 设计说该删，而**实现里还在** ⇒ ②尚未完成：`);
        for (const e of retireFlow.filter((x) => x.stage === 'awaiting_implementation_delete')) {
          lines.push(`    - ${e.file_path}`);
          lines.push(`        理由: ${e.retire_reason ?? '⚠ **没有理由**（①本应必填 —— 该标记来路不正，请核查）'}`);
          // ★ T184b：**来源必须说出来** —— 否则读端会拿这个路径去 `get_dsl` 核对、核不到，遂当成漂移排查。
          if (e.origin === 'overlay_tombstone') {
            lines.push(
              '        ★ 来源：**overlay 墓碑** —— 它**已不在** `semantic.files` 里（显式重建换掉了 base）' +
                ' ⇒ `get_dsl query=files` **查不到它**（★ 这不是数据错了，是它只剩墓碑了）。',
            );
          }
        }
      }
      if (retireReady > 0) {
        lines.push(`  ✅ **可归档（${retireReady}）** —— 设计说该删，**实现里也确实没了** ⇒ ★ **②已被证明，可以走③归档**：`);
        for (const e of retireFlow.filter((x) => x.stage === 'ready_to_archive')) {
          lines.push(`    - ${e.file_path}`);
          lines.push(`        理由: ${e.retire_reason ?? '⚠ **没有理由**（同上）'}`);
          if (e.origin === 'overlay_tombstone') {
            lines.push(
              '        ★ 来源：**overlay 墓碑**（已不在 `semantic.files` 里；`get_dsl` 查不到它，★ 不是数据错）',
            );
          }
          lines.push('        ★ 归档请用 `archive`（它会**三清**：文件 + 几何节点 + 边，并留下归档快照）—— **不要**用 `deleteFile`（它只删语义侧，会留幽灵节点，见 T180）');
        }
      } else if (retirePending === 0) {
        lines.push('  （标记数 > 0 但两边都不匹配 —— 不该发生，请报异常）');
      }
    }
    if (vanishedUnmarked.length > 0) {
      lines.push(`  ⚠ **反向信号（${vanishedUnmarked.length}）**：实现里**已经没了**、而设计侧**没标** "deprecated" 的文件：`);
      for (const fr of vanishedUnmarked.slice(0, 10)) {
        lines.push(`    - ${fr.file.path}`);
      }
      if (vanishedUnmarked.length > 10) lines.push(`    …另有 ${vanishedUnmarked.length - 10} 个`);
      lines.push('    ★ **只说数、不下结论**：可能是"代码先删了、设计侧没记账"（⇒ 该补①），');
      lines.push('      也可能是"这条设计从来就没有对应实现"（DSL 写错 / 目录换过）⇒ **要人看一眼路径**。');
    }
    lines.push('  ★ 本段**不参与**上面线 2 的 `状态/建议` —— 它问的是「**该不该删**」，与"契约签名"无关。');
    lines.push('');
  }

  // ★ 线 1 排在**线 2 整段（摘要 + 建议）之后** —— 两条线各自自成一段（见上）。
  const baselineDrift = checkBaselineDrift(feature, codeDir);
  // ★★★ P0 保鲜链第 3 环（2026-10-26）：**判据覆盖对账** —— 只要有册外缺口，就必须在本报告里
  //   当场点名（W0 实证：council-hub 的 5 条判据指向 7 个测试文件、全不在册，本检查本该当场报）。
  //   判据唯一住处 = `expectationCoverageOf`；渲染唯一住处 = `renderExpectationCoverageSection`。
  const expectation_coverage = expectationCoverageOf(dsl, codeDir);
  const coverageSection = renderExpectationCoverageSection(expectation_coverage);
  if (coverageSection) lines.push(coverageSection);
  lines.push(renderBaselineDriftSection(baselineDrift));
  lines.push('');
  // ★★★ 2026-10-26（T-#11 / 乙方案）：**册的 `source_root` 必须是项目根**。
  //   Maven 模型：项目根由 marker（`.git` / `package.json` / `go.mod` …）定义 —— **子目录不是根**。
  //   实测两个反例：
  //     · agent-io-toolface → `<agent-io>/src/application/meta/registry`（**子目录**，无 marker）
  //     · task-system-plan  → `D:/project_develop/design-canvas`（**另一个项目**的根）
  //   ⇒ 乙方案下“册随 source_root 走” ⇒ 假 source_root 会把册送到**假的家**
  //     （前者落进源码树，后者落进别人的仓）。
  //   ★ 判据复用 `resolveProjectRoot`（与索引根上溯、`resolveRootFromArgs` 级 2 同一把尺），不新造第二套。
  if (dsl.source_root) {
    const declared = path.resolve(dsl.source_root);
    const real = path.resolve(resolveProjectRoot(declared));
    if (real !== declared) {
      lines.push(
        `⚠ **册的 source_root 不是项目根**：\`${declared}\``,
        `  按 marker（.git / manifest）上溯，真项目根是 \`${real}\`。`,
        `  ⇒ 乙方案下“册随 source_root 走”，这个假根会把册送错地方（落进源码子目录或别人的仓）。`,
        `  修法：把 source_root 改成真根；“只分析这个子目录”用**范围**表达，不要拿 project_dir 兼着。`,
        '',
      );
    }
  }

  return {
    message: lines.join('\n'),
    // ★ 2026-10-26（T-#1）：把「本报告实际用的代码基准」落进结果 —— 消费者不许再自己猜一套
    path_base: codeDir,
    path_base_source: code_dir ? 'code_dir' : dsl.source_root ? 'source_root' : 'fallback',
    fileResults,
    retireFlow,
    baselineDrift,
    expectation_coverage,
    invariantResults,
    summary: {
      total_files: fileResults.length,
      compared: comparedCount,
      matched: matchedCount,
      missing: missingCount,
      mismatched: mismatchedCount,
      unexpected: unexpectedCount,
      invariant_passed: invariantPassed,
      invariant_failed: invariantFailed,
      state: cmpState,
      retire_pending: retirePending,
      retire_ready: retireReady,
    },
  };
}
