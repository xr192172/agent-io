/**
 * harvest_decisions —— 把 **三份证据**（代码 / 历史 / 文档与注释）提取成「**这个文件为什么存在**」的决策。
 *
 * ★★★ 决策卡定义（用户 2026-10-10 原话，本工具的最高依据）：
 *   「每一个文件**为什么要存在**这样一个决策，就等于你 git 推送的时候推送的那个**理由**……
 *    这个决策就是给 LLM 读**为什么会出现这个**的原因，也可以给人读。
 *    因为你在 DSL 里面，你不可能去读源文件的注释……等于是**把注释从文件中提取出来变成决策**。
 *    而且是有**历史决策**，历史决策需要主动去翻，我们**只显示最后一次**的决策。」
 *   ⇒ **单位 = 文件**（不是 md 的一节、不是一行）；决策挂在**文件节点**的 `decision` 字段
 *     （reader：`src/application/meta/explore/query_feature.ts` 的 `decisions_own` / `:360`）；
 *     有历史（节点 `decision_history`），默认只显示最新一条；用途 = **省**（读 DSL 就不必翻源码）。
 *
 * ★★★ 三份证据（本轮 = T109 之后的「抽奖」重写，用户裁定）：
 *   用户 2026-10-10：*"根本一个代理和三个代理也没什么区别，就是并行和串行的区别而已。其实就是**三个 loop**。"*
 *   ⇒ **循环是语义，并行是调度。** 旧版「同一个提示词抽 3 次」测的只是**模型稳不稳**（真实数据里三次给的是
 *     `配置加载` / `参数校验` / `默认值合并` 这种**随机抖动**）——它**测不出"这个文件为什么存在"**。
 *   ⇒ 本版把「抽 3 次同一提示词」换成「**三份不同的证据各抽 1 次**」：
 *     ```
 *     for 证据 in [code, history, docs]:   # ← 可枚举的 EVIDENCE_SOURCES
 *         读(证据)  →  判(LLM)  →  写(累进投票)     # ← 三个**具名**阶段，边界清楚、可抽出
 *     ```
 *   ⇒ 三份证据**各自取、各自喂**（**不许三份都用同一份上下文** —— 那会退化成旧版"抽三次"）：
 *     | 证据源     | 取什么 |
 *     | `code`     | 该文件的**符号/导出/依赖/被谁 import**（读 `cache.db` 的 `nodes` / `edges` / `imports`）|
 *     | `history`  | **该文件的 git 提交**（何时出现、改过几次、每次提交的理由 subject，`git log -- <file>`）|
 *     | `docs`     | `docs/` 里**提到它**的地方 + **它自己的文件头注释 / 正文** |
 *
 * ★★ `votes` 语义随之改变（★ 这就是本版的要点）：
 *   - 旧版：`votes` = **同一视角抽三次的稳定性**（结果全 = 1/3，无信息量 —— 见 T109）。
 *   - 本版：`votes` = **有几份证据支持同一个说法**（1..3）⇒ ★ **这才是"置信"的本意（多源印证）**。
 *   - 归一化仍用 {@link normalizeWhy}（**规则一字未改**）；票数 = **支持该说法的证据源个数**。
 *
 * ★★ 新增 `evidence_source`（`code` / `history` / `docs`）—— 每条候选标注它来自哪份证据；
 *   **不收敛**时 `alternatives` 里每项也带 `evidence_source`（★ 于是"分歧"能**归因到证据**，可观察）。
 *
 * ★ 仍只出一条（一个文件最多一条）：票最多者 → `decision`（稳定序破平）；其余桶 → `alternatives`（各带票数 + 证据源）。
 *   ⇒ **分歧不丢**（T109 修正：原来的罪不是"归一化不准"，是 `pickTop` 任取一条、假装它是唯一答案）。
 *
 * ★★ **落点可行性**（2026-10-10）：采集问的是**全集**（该问的都要问），但**每条产出标注
 *   `landing`** = 它的落点在**本 feature** 里**能不能写进去**（判据与写入口 `edit_dsl` 同一份，
 *   见 {@link makeLandable}）。★ **只标注、不过滤**：落点不可用（多半因 `import_project` 的
 *   `max_files` 截断）的候选**照旧产出**，回执里汇总"可落库 X / 落点不在 Y"（判开判关两档都标）。
 *
 * ★★ **「判」可开可关**（用户 2026-10-10 裁定：「本身这个东西是要配 AGNES 的密钥的，那么我们需要把这个功能
 *   作为**可开可关**的功能」）：
 *   · **判开**（有 LLM 密钥 / 入参 `judge:true`）⇒ 产出决策候选（本工具的主体行为）。
 *   · **判关**（入参 `judge:false`，或**没配密钥时的自动档**）⇒ ★ **降级成"只给三份证据"**（`evidence_by_file`），
 *     让调用方自己判；★★ **回执里必须明说"本次没判、只给了证据"** —— 降级可以，**不许静默降级**（本仓铁律）。
 *   · 档位：入参 `judge` **显式优先**；不传则**自动检测**（有配置 ⇒ 判开；无配置 ⇒ 判关，并在回执明示）。
 *   · ★ `judge:true` 却**没密钥** ⇒ **抛**（不回落关键词）；错误里带"怎样配"的提示（见 `llm_agnes.describeAgnesConfigHint`）。
 * ★ 本工具**只产决策线索**（`decision.status = 'draft'`），**不写 DSL**；写 DSL 用 `edit_dsl` 的 `type:'decision'` op
 *   （未决分歧进 `NodeDecision.dissent`，**不是** `alternatives`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitAvailable } from '../../infrastructure/exec_guard.js';
import { ensureProjectIndex } from '../../infrastructure/index/index_freshness.js';
import type { Database } from '../../infrastructure/index/db.js';
import { getRawImportsOfFile, getResolvedImportSources } from '../../infrastructure/index/symbols.js';
import { loadLlmConfig, callChat, loadExplainConfig } from '../../infrastructure/llm_focus.js';
// ★★ 2026-10-10（T106）：「怎样配密钥」的提示**从唯一住处生成**（`AGNES_ENV` + `describeAgnesConfigHint`），
//   本文件**不手抄变量名清单** —— 否则 T108 刚收拢的"上游/key/模型唯一住处"会立刻在这里重新分叉。
import { describeAgnesConfigHint } from '../../infrastructure/llm_agnes.js';
import { withTouched, type Touched, type TouchedProduct } from '../../domain/b_terms.js';
import type { NodeDecision, DecisionHistoryEntry } from '../../domain/geometry.js';
// ★★ 2026-10-10（落点可行性）：采集要**读 feature**，并**复用写入口同一份**"落点认不认"的判据。
//   ★ 为什么复用 `findDecisionTargetNode` 而**不自己拼判断**：本仓头号纪律是"判据同一处"——
//     `edit_dsl`（`type:'decision'`）收不收这个落点，只有它自己说了算；采集侧另写一份 = 立刻分叉。
import { getDSL } from '../../infrastructure/storage.js';
import { findDecisionTargetNode, normRel } from '../design/dsl_ops/update_feature.js';
import type { DesignDSL } from '../../domain/types.js';

/**
 * 目标文件的**种类**（★ 与 {@link EvidenceSource} 是**两个正交的轴**）：
 *   - `source` 说「**目标是什么文件**」：`comment` = 源码文件（.ts/.go/.py…），`doc` = 文档文件（.md）。
 *   - `evidence_source` 说「**靠哪份证据说话**」：code / history / docs（见下）。
 * ★ 与旧版相比：旧版是「三路来源」（comment/doc/gitlog），其中 gitlog 是**提交级**候选；
 *   本版把提交信息**收敛为每个文件的 `history` 证据**（同一份一手材料，从"提交级候选"改成"文件级证据"）。
 */
export type HarvestSource = 'comment' | 'doc';

/**
 * ★★★ **证据源**（本轮核心判据）—— 三份证据，各自取、各自喂、各投一票。
 *   · `code`    ：代码证据（符号 / 导出 / 依赖 / 被谁引用）—— 读 `cache.db`
 *   · `history` ：历史证据（该文件的 git 提交：何时出现、改过几次、每次的理由）—— `git log -- <file>`
 *   · `docs`    ：文档与注释证据（`docs/` 提到它的地方 + 它自己的文件头注释 / 正文）
 */
export type EvidenceSource = 'code' | 'history' | 'docs';

/**
 * ★★ 证据源的**唯一枚举处**（可抽出性的落点之一）：`harvestDecisionsCore` 就 `for (const ev of EVIDENCE_SOURCES)`。
 *   ★ 为什么不写死成三段重复代码：用户明说"以后可能要改成**外部编排**（并行跑三个）"——
 *     枚举成列表 ⇒ 将来把 `read→judge→write` 这三段抽出去并行的成本 = 改这一处调度，不动证据语义。
 */
export const EVIDENCE_SOURCES: readonly EvidenceSource[] = ['code', 'history', 'docs'];

/** 证据源 → 人读标签（进提示词，让 LLM 知道自己读的是哪份证据） */
const EVIDENCE_LABEL: Record<EvidenceSource, string> = {
  code: '代码证据（该文件的符号/导出/依赖/被谁引用）',
  history: '历史证据（该文件的 git 提交：何时出现、改过几次、每次提交的理由）',
  docs: '文档与注释证据（docs/ 提到它的地方 + 它自己的文件头注释/正文）',
};

export interface LifecycleHint {
  type: 'retired' | 'merged' | 'superseded' | 'split';
  detail: string;
}

/**
 * ★★★ **产出契约**（一条决策线索必须**同时**具备三要素）：
 *   ① 结论 `why`    ：这个文件为什么存在（一句话**理由**，不是"做什么"）
 *   ② 出处 `origin` ：证据锚点 —— 代码/文档证据 = `文件:行`；历史证据 = `git:<hash>`（复核依据）
 *   ③ 作用对象 `subject`：该文件（仓库相对路径）
 *
 * ★ 它不是**过滤器**（过滤器先收下再按规则丢弃，规则只会越打越厚）；它是**接口的形状**：
 *   三要素任一为空 ⇒ 这条决策**根本构造不出来**（见 {@link buildLead} 返回 `null`）。
 */
export interface DecisionElements {
  /**
   * ① 结论：这个文件为什么存在 —— ★ **短短语**（≤12 字、不带句号/标点）。
   *   ★ 为什么必须短：投票要按**字面**归一，"同一件事"的多种措辞只有在自由度小时才会自然收敛
   *     （见 {@link normalizeWhy}）。长句/带标点 ⇒ 不同证据永远分进不同桶（旧病）。
   *   ★ 详细理由**不在这里**：走 `rationale`（一句话，**不参与归一**）。
   */
  why: string;
  /** ② 出处：证据锚点 —— `文件:行`（代码/文档证据）/ `git:<hash>`（历史证据） */
  origin: string;
  /** ③ 作用对象：该文件（仓库相对路径） */
  subject: string;
}

/**
 * 一条「未收敛时落选」的结论：归一后票数 < 最高票的其余 `why`，**带票数与支持它的证据源**。
 * （不收敛的定义：三份证据归一后落进**多个**桶。）
 */
export interface AlternativeWhy {
  /** 该措辞的结论短语（首次落进本桶的证据原文） */
  why: string;
  /** 票数 = 支持该说法的**证据源个数**（1..2；<= EVIDENCE_SOURCES.length - 1） */
  votes: number;
  /** ★ 支持该说法的证据源（可归因"这条分歧来自哪份证据"） */
  evidence_source: EvidenceSource[];
}

/** 一条「文件为什么存在」的决策（三要素齐备才产得出；`decision` 可**直接落到文件节点的 `decision` 字段**） */
export interface HarvestCandidate {
  /** 作用对象：该文件（仓库相对路径） */
  file_path: string;
  /** 目标文件种类：comment = 源码文件 · doc = 文档文件 */
  source: HarvestSource;
  /** 出处：证据锚点（`文件:行` 或 `git:<hash>`） */
  ref: string;
  /** 决策本体：可直接落到文件节点的 `decision` 字段（`status` 为 `draft` —— 写回用 `edit_dsl` 的 `type:'decision'` op） */
  decision: NodeDecision;
  /**
   * 历史决策（旧版，默认不显示）。★ 本工具只产**最新一条** ⇒ 此处**恒不填**；
   * 旧版压栈由 `edit_dsl`（`type:'decision'`）写入口在"用新版取代旧版"时完成 —— 本字段仅声明产物**可承载历史**
   * （用户裁定：有历史、默认只显示最后一次）。
   */
  decision_history?: DecisionHistoryEntry[];
  /**
   * 票数 = **支持该说法（归一化后同一条）的证据源个数**（1..3）。
   * ★★ 语义变更（T109 之后）：旧版 = 同一提示词抽三次的**稳定性**（恒 1/3、无信息量）；
   *   本版 = **多源印证** —— 三份证据里有几份得出同一结论 ⇒ 这才是"置信"的本意。
   */
  votes: number;
  /** 本文件**实际取到证据并产出一条 `why`** 的证据源个数（1..3；置信 = votes / samples） */
  samples: number;
  /**
   * ★ 支持本条结论的证据源（长度 = `votes`）：`code` / `history` / `docs`。
   * ★ 为什么是数组：收敛（votes>1）时一条结论由**多份**证据共同支持 ⇒ "它来自哪份证据"不是一个值。
   */
  evidence_source: EvidenceSource[];
  /**
   * ★ 其余分歧结论（**各带票数 + 证据源**）—— 归一后除最高票外的其余桶，按票数降序；**收敛时为空数组**。
   *
   * ★ 为什么挂在 **candidate** 而**不是** `NodeDecision.alternatives`：后者语义是「**被否掉的**替代方案 +
   *   否决原因」——这里的分歧**没被否决**（只是投票没投齐），也没有否决原因；混进去会污染决策卡语义
   *   （既有字段语义不许动）。本字段是**证据投票的置信信息**，不是文件决策内容。
   */
  alternatives: AlternativeWhy[];
  /** 原始证据（三份证据各自的摘要，带证据源标签），供逐条复核 */
  evidence: string;
  /**
   * ★★ 落点可行性（2026-10-10）—— **本候选的 `file_path` 在本 feature 里能否落到文件/文档节点**
   *   （即用 `edit_dsl` 的 `type:'decision'` op 时**能否写进去**）。
   *   · `'ok'`            = 在（写入口会接受）。
   *   · `'not-in-feature'` = 不在（写入口会拒收；通常因 `import_project` 的 `max_files` 截断 ——
   *                          `semantic.files` 只保留确定序前 N 个，本文件落选）。
   * ★★ **只标注、不过滤**：落点不可用的候选**照旧产出**（采集问的是**全集**，该问的都要问；
   *   它们对"看清项目"仍有价值）。判据与写入口**同一份**（{@link makeLandable} ⇒ `findDecisionTargetNode`）。
   */
  landing: 'ok' | 'not-in-feature';
  /** 生命周期提示（下线/合并/取代/拆分），供 diff 与归档参考 */
  lifecycle_hint?: LifecycleHint;
}

export interface HarvestResult {
  message: string;
  feature: string;
  /**
   * ★★ 本次**是否真的用 LLM 判了**。
   * `false` = 降级为"只给三份证据"（`evidence_by_file`）—— ★ **回执（message）里必明说**，
   *           调用方从这一位也**机器可读**地知道"这次没判"（**不许静默降级**）。
   * `true` = 走了 LLM，`candidates` 才有内容。
   */
  judged: boolean;
  /** 决策候选（`judged=false` 时为空数组） */
  candidates: HarvestCandidate[];
  /**
   * ★ `judged=false` 时**逐文件的三份证据原文**（code / history / docs 各一段），供调用方**自己判**。
   * `judged=true` 时不产出（证据已折进各候选的 `evidence`）。
   */
  evidence_by_file?: FileEvidence[];
}

/** 一份证据对一个文件的摘要（`judged=false` 的降级产物） */
export interface EvidenceExcerpt {
  evidence_source: EvidenceSource;
  /** 该证据对该文件的摘要文本（∈ 各 `SignalLine.text`，供人/LLM 读） */
  summary: string;
  /** 该证据里可复核的**出处锚点**（`文件:行` 或 `git:<hash>`） */
  refs: string[];
}

/** `judged=false` 时逐文件的证据包（**未判**，等调用方判） */
export interface FileEvidence {
  /** 作用对象：该文件（仓库相对路径） */
  file_path: string;
  /** 目标文件种类：comment = 源码文件 · doc = 文档文件 */
  source: HarvestSource;
  excerpts: EvidenceExcerpt[];
  /**
   * ★★ 落点可行性（2026-10-10）—— 语义同 {@link HarvestCandidate.landing}：
   *   该文件在本 feature 里能否落到文件/文档节点（写入口 `edit_dsl` 会不会收）。
   * ★ **判关档也标注**：降级只说明"没判"，不代表可以不知道"落点能不能写"。
   */
  landing: 'ok' | 'not-in-feature';
}

export interface HarvestInput {
  /** feature 名（候选挂载目标） */
  feature: string;
  /** 文档目录（扫描 *.md），默认 <cwd>/docs */
  doc_dir?: string;
  /** git 仓库根（读每个文件的提交历史），默认 <cwd> */
  git_root?: string;
  /**
   * ★★ **产出条数上限**（2026-10-10，T-e2e Bug3 修），**可选**。
   *   · **判开**：产出（`candidates`）最多给这么多条；**判关**：降级证据（`evidence_by_file`）最多给这么多条。
   *   · ★ **不传 = 不设上限**（返回全部，行为与改造前一致；回归判据要求"不传 limit 行为不变"）。
   *   · ★ 两档**都生效** —— 此前它只在「取证据」阶段当 `git log -n` 用（每文件历史条数），
   *     而**产出列表一点没被它限制**（实测 `judge:false, limit:4` 出 458 条）⇒ 与入参字面义对不上（同名不同义）。
   *   · ⇒ 现拆开：`limit` = **产出条数上限**（显式才截断）；每文件 git 历史条数改用独立常量 `GIT_LOG_LIMIT`（见下）。
   *   · ★ 截断**不静默**：回执会写明"共取到 N 条、按 limit 只显示前 M 条"。
   */
  limit?: number;
  /**
   * ★★★ **统一的处理范围**（2026-10-10，T119）—— 本次**只处理列出的这些文件**。
   *
   * ★★ **它同时限定【源码目标】与【文档目标】**（= **整个 target 集**），不只是源码那一路。
   *   · 传了 `files` ⇒ 只有这些文件进目标集（源码 + 文档都按它过滤）；**不在列表里的 ⇒ 不产出**。
   *   · 不传 ⇒ 行为与改造前**完全一致**（全部已索引源码 + `doc_dir` 下全部 `*.md`）。
   *
   * ★ 路径口径 = **仓库相对路径**（`/` 分隔），与**写入口** `edit_dsl`（`type:'decision'`）**同一份**
   *   （归一复用 `update_feature.ts` 的 `normRel`，不自己拼 —— 见 {@link normRel}）。
   *
   * ★★ **本入参对外契约的迁移交代写在工具描述里**（`index.ts` 的 tool description）——
   *   它**不是**墓碑：契约变更要说给调用方听。本文件内**不重复**那句（避免两处各写一份）。
   */
  files?: string[];
  /**
   * ★ **「判」的开关**（2026-10-10，用户裁定"可开可关"）：
   *   · `true`  ⇒ 强制判（**没密钥就抛**，错误里带"怎样配"的提示）。
   *   · `false` ⇒ **强制不判**：降级成"只给三份证据"（`evidence_by_file`），回执明说。
   *   · 省略    ⇒ **自动**：有 LLM 配置 ⇒ 判；没配置 ⇒ 降级只给证据（并明示）。
   */
  judge?: boolean;
}

// ──────── 常量 ────────

/** 每批最多文件数，默认 20（控制单次 payload 长度） */
const BATCH_SIZE = 20;
/** 并发批数上限，默认 3 */
const CONCURRENCY = 3;
/** 每份证据每个文件最多喂给 LLM 的线索行数（控制 payload） */
const MAX_SIGNAL_LINES = 40;
/**
 * ★★ 每文件 `git log -n` 的条数上限（2026-10-10，T-e2e Bug3 修）。
 *   ★ **独立常量**、不再借用入参 `limit` —— `limit` 现是**产出条数上限**（见 `HarvestInput.limit` 注释）。
 *     两者曾共用一个值（`ctx.limit`）⇒ 一个入参两个含义（本仓头号病「同名不同义」），现拆开。
 *   口径不变（默认 30，与原默认一致）。
 */
const GIT_LOG_LIMIT = 30;
/** 证据字段截断长度 */
const EVIDENCE_MAX = 240;
/** 源码扩展名（"已索引的源码文件"取这些；md 走 doc 目标，其它忽略） */
const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|go|py)$/i;
/** `docs` 证据里**每个目标**最多取几条"文档提及"行（防止一个核心模块被整仓文档淹没） */
const MAX_DOC_MENTIONS = 3;

const LIFECYCLE_RULES: Array<{ kw: string[]; type: LifecycleHint['type'] }> = [
  { kw: ['弃用', '下线', '废弃', '删除'], type: 'retired' },
  { kw: ['合并', '并入'], type: 'merged' },
  { kw: ['取代', '替代', '替换'], type: 'superseded' },
  { kw: ['拆分', '拆开'], type: 'split' },
];

function lifecycleHint(text: string): LifecycleHint | undefined {
  for (const rule of LIFECYCLE_RULES) {
    for (const kw of rule.kw) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        return { type: rule.type, detail: text.slice(Math.max(0, idx - 20), idx + 30).replace(/\s+/g, ' ').trim() };
      }
    }
  }
  return undefined;
}

// ──────── LLM 配置（★ 没有就抛，绝不回落关键词） ────────

type LlmCfg = NonNullable<ReturnType<typeof loadLlmConfig>>;

/** 把讲解后端配置（ExplainConfig）转成通用 LLM 配置（LlmConfig）。 */
function toLlmCfg(c: ReturnType<typeof loadExplainConfig>): LlmCfg | null {
  return c ? { apiKey: c.apiKey, model: c.model, baseURL: c.baseURL } : null;
}

/**
 * ★★ 取得 LLM 配置（**不抛**）；取不到返回 null（供"自动档"判定）。
 * 判据：通用 llm 段 / DEEPSEEK 环境 / AGNES 环境，三路任一有 key 即算"有配置"。
 */
function loadCfgOrNull(): LlmCfg | null {
  return loadLlmConfig() ?? toLlmCfg(loadExplainConfig());
}

/**
 * ★★ 取得 LLM 配置；**取不到就抛**（只在"判开"档调用）。
 * 判断"这个文件为什么存在"本就属"判断"，没有 LLM 就**没有判据** ⇒ 只能失败。
 * 错误消息说清"需要什么"以及"**怎样配**"（★ 提示文本由 `describeAgnesConfigHint` 从**唯一住处**生成）。
 */
function requireLlmConfig(): LlmCfg {
  const cfg = loadCfgOrNull();
  if (cfg) return cfg;
  throw new Error(
    'harvest_decisions 判开（judge:true / 自动档里有密钥）需要 LLM 配置：判断「这个文件为什么存在」必须用 LLM，没有 LLM 就没有判据。\n' +
      '本工具不回落关键词（本仓铁律：不许兜底，失败就是失败）。\n' +
      `★ 若不想现在配：传 \`judge:false\` ⇒ 降级为"**只给三份证据**"，让调用方自己判（回执会明说"本次没判"）。\n` +
      describeAgnesConfigHint(),
  );
}

// ──────── 产出契约的落点（唯一构造点） ────────

/**
 * ★★★ **产出契约**：三要素齐备才构造得出，缺一即"**产不出**"（返回 `null`）。
 * 解析口（{@link askEvidenceBatch}）**只**把三要素齐备的条目交到这里。
 */
function buildLead(
  el: DecisionElements,
  rest: {
    source: HarvestSource;
    votes: number;
    samples: number;
    evidence_source: EvidenceSource[];
    evidence: string;
    /** 详细理由（一句话，**不参与归一**）—— 落到 `decision.rationale`（NodeDecision 既有字段，语义不变） */
    rationale?: string;
    /** 其余分歧结论（各带票数 + 证据源）；收敛时缺省 ⇒ 落为空数组 */
    alternatives?: AlternativeWhy[];
    lifecycle_hint?: LifecycleHint;
    /** ★★ 落点可行性（见 {@link HarvestCandidate.landing}）—— 由 {@link makeLandable} 判定 */
    landing: HarvestCandidate['landing'];
  },
): HarvestCandidate | null {
  if (!el.subject.trim()) return null; // ③ 作用对象缺 ⇒ 产不出
  if (!el.origin.trim()) return null; // ② 出处缺 ⇒ 产不出
  if (!el.why.trim()) return null; // ① 结论缺 ⇒ 产不出
  const decision: NodeDecision = { summary: el.why.trim(), status: 'draft', author: 'llm' };
  if (rest.rationale?.trim()) decision.rationale = rest.rationale.trim();
  const lead: HarvestCandidate = {
    file_path: el.subject.trim(),
    source: rest.source,
    ref: el.origin.trim(),
    decision,
    votes: rest.votes,
    samples: rest.samples,
    evidence_source: rest.evidence_source,
    alternatives: rest.alternatives ?? [],
    evidence: rest.evidence,
    landing: rest.landing,
  };
  if (rest.lifecycle_hint) lead.lifecycle_hint = rest.lifecycle_hint;
  return lead;
}

// ──────── 落点可行性（★ 与 edit_dsl 写入口**同一份判据**） ────────

/**
 * ★★ 落点可行性的**唯一判据**：给定 feature DSL 与一个仓库相对路径，返回
 *   "这条决策**落得进去**吗"（= `edit_dsl` 的 `type:'decision'` op **会不会接受**它）。
 *
 * ★★ 为什么复用 `findDecisionTargetNode`（写入口的函数）而**不自己拼路径**：
 *   本仓头号纪律是"判据同一处"。写入口（`resolveDecisionTarget`）的收/拒由它自己说了算；
 *   采集侧**再写一份**"在不在 semantic.files 里" = 立刻**分叉**（写入口还认节点 id / 节点 description，
 *   不只有 `semantic.files`）。⇒ 采集侧与写入口**共用**这一个查找函数，收/拒口径**必然一致**。
 * ★ 与写入口的**唯一差别**：写入口把"找不到"与"找到但类型不对"分成两条抛错；
 *   这里两者都归结为 `false`（都写不进去），因为采集侧只关心"落得进 / 落不进"。
 */
function makeLandable(dsl: DesignDSL): (rel: string) => boolean {
  return (rel: string): boolean => {
    const node = findDecisionTargetNode(dsl, rel);
    return !!node && (node.type === 'file' || node.type === 'doc');
  };
}

// ──────── 目标文件（单位 = 文件） ────────

/** 一个待判的目标文件（源码文件 / 文档文件） */
interface TargetFile {
  /** 仓库相对路径（`/` 分隔）—— 也是"作用对象" */
  rel: string;
  /** 绝对路径（读注释/正文用） */
  abs: string;
  kind: 'code' | 'doc';
}

/** 线索行：`ref` = **完整出处锚点**（`文件:行` 或 `git:<hash>`），`text` = 人读文本 */
interface SignalLine {
  ref: string;
  text: string;
}

/** 一份证据（某个文件、某个证据源）：喂给 LLM 的线索 + 截断的原文摘要 */
interface EvidenceSignal {
  rel: string;
  evidence_source: EvidenceSource;
  lines: SignalLine[];
  evidence: string;
}

// ──────── 代码证据（code）：读 cache.db 的 nodes / edges / imports ────────

/**
 * ★ 证据源 `code`（**取**）：该文件的**符号/导出/依赖/被谁引用**。
 *
 * 数据源 = `<projectRoot>/.agent-io/cache.db`（`ensureProjectIndex` 保证已就绪）：
 *   · `nodes`（file_path = 该文件且 kind != 'file'）= 符号（`name` / `kind` / `signature` / `start_line`）
 *   · `imports`（file_path = 该文件）= 它 import 了谁（带行号）
 *   · `edges(kind='import', target = 该文件)` = **谁 import 了它**（入边；文件级，行号不在本文件内）
 * ★ 取不到（无符号 / 无 import 边 / 文件未索引）⇒ 返回 `null` ⇒ 该证据源对这个文件**缺席**
 *   （**不**用别的证据顶替 —— 那正是"三份证据退化成三份同一上下文"的旧病）。
 */
function codeEvidence(target: TargetFile, ctx: EvidenceCtx): EvidenceSignal | null {
  const lines: SignalLine[] = [];
  const syms = ctx.db
    .prepare("SELECT kind, name, signature, start_line FROM nodes WHERE file_path = $p AND kind != 'file' ORDER BY start_line")
    .all({ p: target.rel }) as Array<{ kind: string; name: string; signature: string | null; start_line: number }>;
  for (const s of syms) {
    lines.push({ ref: `${target.rel}:${s.start_line}`, text: `[符号] ${s.kind} ${s.name}${s.signature ? ` ${s.signature}` : ''}` });
    if (lines.length >= MAX_SIGNAL_LINES) break;
  }
  if (lines.length < MAX_SIGNAL_LINES) {
    for (const im of getRawImportsOfFile(ctx.db, target.rel)) {
      lines.push({ ref: `${target.rel}:${im.line}`, text: `[依赖] import ${im.source}` });
      if (lines.length >= MAX_SIGNAL_LINES) break;
    }
  }
  const importers = getResolvedImportSources(ctx.db, target.rel);
  if (importers.length > 0) {
    // ★ 入边的行号不在本文件内 ⇒ 锚在文件首行（文件节点 start_line=1），并**明说**这是"谁引用我"的汇总线索。
    lines.push({ ref: `${target.rel}:1`, text: `[被引用] 本文件被 ${importers.length} 个文件 import：${importers.slice(0, 8).join('、')}` });
  }
  if (lines.length === 0) return null;
  return { rel: target.rel, evidence_source: 'code', lines, evidence: lines.map((l) => l.text).join(' ').slice(0, EVIDENCE_MAX) };
}

// ──────── 历史证据（history）：git log -- <file> ────────

/**
 * ★ 证据源 `history`（**取**）：该文件的 git 提交（何时出现、改过几次、每次提交的理由 subject）。
 *   `git log -n <GIT_LOG_LIMIT> --pretty=format:%h%x09%ad%x09%s --date=short -- <rel>`。
 * ★ 三种"缺席"（返回 `null`，**如实缺席**、不用别的证据顶替）：
 *     ① git 不可用 / 不是 git 仓库（`ctx.gitRepoOk === false`）—— 对本仓**整体**无历史证据；
 *     ② 该文件无提交历史（未被 git 跟踪 / 新文件）；
 *     ③ 取到的提交全是空 subject。
 * ★ 其余 git 报错 ⇒ **抛**（不许静默降级：真的失败就是失败）。
 */
function historyEvidence(target: TargetFile, ctx: EvidenceCtx): EvidenceSignal | null {
  if (!ctx.gitRepoOk) return null; // ① 无 git / 非仓库 ⇒ 本证据源整体缺席
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['log', '-n', String(ctx.gitLogLimit), '--pretty=format:%h%x09%ad%x09%s', '--date=short', '--', target.rel],
      { cwd: ctx.gitRoot, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (e) {
    throw new Error(`harvest_decisions：读 '${target.rel}' 的 git 历史失败（不静默降级）：${(e as Error).message}`);
  }
  const lines: SignalLine[] = [];
  for (const raw of out.split('\n')) {
    if (!raw.trim()) continue;
    const [hash, date, subject] = raw.split('\t');
    if (!hash) continue;
    lines.push({ ref: `git:${hash}`, text: `${date ?? ''} ${subject ?? ''}`.trim() });
    if (lines.length >= MAX_SIGNAL_LINES) break;
  }
  if (lines.length === 0) return null; // ②③ 该文件无提交历史
  return { rel: target.rel, evidence_source: 'history', lines, evidence: lines.map((l) => l.text).join(' ').slice(0, EVIDENCE_MAX) };
}

// ──────── 文档与注释证据（docs）：docs/ 提及 + 自己的注释/正文 ────────

/** 从源码正文抠出块注释（含 JSDoc 文件头），保留**真实行号**。 */
function commentLines(content: string): SignalLine[] {
  const out: SignalLine[] = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const startLine = content.slice(0, m.index).split('\n').length;
    const block = m[0].split('\n');
    for (let i = 0; i < block.length; i++) {
      const text = block[i]
        .replace(/^\s*\/\*+\s?/, '')
        .replace(/^\s*\*+\s?/, '')
        .replace(/\*\/\s*$/, '')
        .trim();
      if (text) out.push({ ref: `${startLine + i}`, text });
    }
  }
  return out;
}

/** 正文非空行（带行号）—— 文档文件的"自己的正文" */
function bodyLines(content: string): SignalLine[] {
  const out: SignalLine[] = [];
  for (const [i, raw] of content.split('\n').entries()) {
    const text = raw.trim();
    if (text) out.push({ ref: `${i + 1}`, text });
  }
  return out;
}

/** 文档语料（每个 md 文件的 rel + 原文），供"docs/ 里提到它"检索 */
interface DocCorpusEntry {
  rel: string;
  text: string;
}

/**
 * ★ 证据源 `docs`（**取**）：`docs/` 里**提到它**的地方 + **它自己的文件头注释 / 正文**。
 *   · 自己的注释/正文：源码文件取块注释（{@link commentLines}），md 文件取正文（{@link bodyLines}）。
 *   · 文档提及：在文档语料里找**该文件的仓库相对路径**或**basename**（长度 ≥ 6，避免 `index.ts` 这类噪声）。
 * ★ 两者皆空 ⇒ 返回 `null`（该证据源缺席）。
 */
function docsEvidence(target: TargetFile, ctx: EvidenceCtx): EvidenceSignal | null {
  const lines: SignalLine[] = [];
  let content: string;
  try {
    content = fs.readFileSync(target.abs, 'utf-8');
  } catch {
    content = ''; // 文件读不到（可能刚被删）：自己的注释/正文缺席，但"文档提及"仍可能取到
  }
  if (content) {
    const own = target.kind === 'code' ? commentLines(content) : bodyLines(content);
    for (const l of own) {
      lines.push({ ref: `${target.rel}:${l.ref}`, text: l.text });
      if (lines.length >= MAX_SIGNAL_LINES) break;
    }
  }
  // 文档提及：别的 md 里写到本文件（按 rel 精确，或按足够长的 basename）
  const base = path.posix.basename(target.rel);
  const key = base.length >= 6 ? base : '';
  let mentions = 0;
  for (const d of ctx.docCorpus) {
    if (d.rel === target.rel) continue;
    const hit = firstMention(d, target.rel, key);
    if (!hit) continue;
    lines.push({ ref: `${d.rel}:${hit.line}`, text: `[文档提及] ${hit.text}` });
    if (++mentions >= MAX_DOC_MENTIONS || lines.length >= MAX_SIGNAL_LINES) break;
  }
  if (lines.length === 0) return null;
  return { rel: target.rel, evidence_source: 'docs', lines, evidence: lines.map((l) => l.text).join(' ').slice(0, EVIDENCE_MAX) };
}

/** 在文档 d 里找第一个提及 `rel`（或 `key`=basename）的行；找不到返回 null。 */
function firstMention(d: DocCorpusEntry, rel: string, key: string): { line: number; text: string } | null {
  const lines = d.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(rel) || (key && lines[i].includes(key))) {
      return { line: i + 1, text: lines[i].trim().slice(0, 120) };
    }
  }
  return null;
}

// ──────── 取证据的调度（★ 可抽出性的落点：每个证据源一个**具名**函数） ────────

interface EvidenceCtx {
  db: Database;
  gitRoot: string;
  /** git 仓库是否可用（一次判定；false ⇒ history 证据整体缺席） */
  gitRepoOk: boolean;
  /** 每文件 `git log -n` 的条数上限（**独立常量** `GIT_LOG_LIMIT`；不再借用入参 `limit`，见其注释） */
  gitLogLimit: number;
  docCorpus: DocCorpusEntry[];
}

/**
 * ★★ 「读证据」阶段的**唯一分发点**：证据源 → 取数函数。
 *   三个取数函数（{@link codeEvidence} / {@link historyEvidence} / {@link docsEvidence}）**互不内联**，
 *   各自读各自的数据源；将来要改成"外部编排并行跑三个"，只需把这一个 `switch` 换成三个并行任务。
 */
function evidenceForSource(ev: EvidenceSource, target: TargetFile, ctx: EvidenceCtx): EvidenceSignal | null {
  switch (ev) {
    case 'code':
      return codeEvidence(target, ctx);
    case 'history':
      return historyEvidence(target, ctx);
    case 'docs':
      return docsEvidence(target, ctx);
  }
}

// ──────── 判（LLM，同一套输出契约） ────────

/** 单个文件在**某一份证据**下的 LLM 原始命中（已过产出契约：三要素齐备才存在） */
interface RawHit {
  key: string;
  /** 结论短语（参与归一投票） */
  why: string;
  /** 详细理由（一句话，**不参与**归一） */
  rationale: string;
  /** 出处锚点（逐字取自这份证据的某个 `ref`） */
  ref: string;
  /** 本命中来自哪份证据 */
  evidence_source: EvidenceSource;
}

/** 从 LLM 文本里抠出 JSON 对象；抠不出 ⇒ **抛**（失败就是失败，不静默当空）。 */
function extractJsonObject(raw: string): Record<string, unknown> {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = fence ? fence[1] : raw;
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`harvest_decisions：LLM 未返回 JSON（原文前 200 字：${raw.slice(0, 200)}）`);
  }
  return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
}

/**
 * 归一化「结论短语」—— 投票归并的**唯一判据**（★ 本规则唯一住处，别处不得再写一份）。
 *
 * 五步（顺序固定）：① 去首尾空白 · ② 去**所有**空白 · ③ 去**标点**（中英，含 `、，。：（）` 等）
 *   · ④ 去**单字连接词** `与/和/及/的` · ⑤ 转小写；此后**完全相等**才判为"同一条"。
 *
 * ★ 它归的是**措辞抖动**，不是语义：`配置加载与校验` 与 `配置加载 校验，` ⇒ 同一条。
 * ★ 但 `配置加载` 与 `参数校验` ⇒ **不同条**（真分歧，必须留在两个桶 ⇒ 进 `alternatives`，不许丢）。
 * ★ 为什么加第 ④ 步：实测抖动**主要落在连接词**上（`与` 的有无、`和/及` 的换用）⇒ 不归它，
 *   几条证据永远几个桶、票恒 1。
 * ★ **导出**（`export`）**只为一件事**：让确定性探针调**同一个函数**来展示"哪些字符串被判成同一条"。
 * ★★ 本版**一字未改**（T109 的三案探针靠它）。
 */
export function normalizeWhy(s: string): string {
  return s
    .trim()
    .replace(/[\s，。、；：！？,.;:!?"'“”‘’（）()【】\[\]{}《》〈〉—－·…~`|/\\@#$%^&*+=_-]/g, '')
    .replace(/[与和及的了]/g, '')
    .toLowerCase();
}

const EVIDENCE_SYSTEM_PROMPT =
  '你是项目结构解读助手。给定若干文件，以及这些文件的**一份特定证据**（代码证据 / 历史证据 / 文档与注释证据之一）。' +
  '每条证据都带**出处**（形如 [文件:行] 或 [git:hash]）。请**只依据给定证据**回答每个文件的唯一问题：' +
  '**这个文件为什么存在**（它要解决什么问题、为什么需要它）。\n' +
  '要求：\n' +
  '1. `reason`（**结论**）= 这个文件为什么存在的**短短语**：★ **≤12 个汉字**、**不带句号/标点/空格**，' +
  '   说「为什么」不是「做什么」。例："配置加载与校验" · "CLI 参数解析入口"（写成"翻译 Go 到 TS"这类"做什么"是错的）。\n' +
  '2. `rationale`（**详细理由**）= 一句话把这个短语说清楚（≤40 个汉字，可含依据）。★ 它**不参与**比对，只供人读。\n' +
  '3. ★ `ref`（**出处**）= 支撑这句话的锚点，必须**逐字**取自给定证据里的某个 `[出处]`。\n' +
  '4. ★★ 这份证据里**看不出**该文件为什么存在 ⇒ **把该文件整个略去**（不要编造，不要给"未知"/"无"）。\n' +
  '只输出 JSON：{"files":[{"path":"...","reason":"...","rationale":"...","ref":"..."}]}，path 必须来自给定清单。';

/**
 * ★★ 「判」阶段：**同一套输出契约**，对**一份证据**的一批文件问 LLM。
 *   三份证据走的是同一个函数、同一个 prompt 形状（只有 `证据源` 标签不同）——这就是"三个 loop 同一个判据"。
 */
async function askEvidenceBatch(cfg: LlmCfg, batch: EvidenceSignal[], ev: EvidenceSource): Promise<RawHit[]> {
  const known = new Set(batch.map((s) => s.rel));
  const listText = batch
    .map((s, i) => `文件 ${i + 1}: ${s.rel}\n${s.lines.map((l) => `  [${l.ref}] ${l.text}`).join('\n')}`)
    .join('\n\n');
  const raw = await callChat(cfg, [
    { role: 'system', content: EVIDENCE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `证据源: ${ev}（${EVIDENCE_LABEL[ev]}）\n\n请判断以下 ${batch.length} 个文件各自的「为什么存在」（只依据上面的证据）：\n\n${listText}`,
    },
  ]);
  const obj = extractJsonObject(raw);
  const files = Array.isArray(obj.files) ? (obj.files as Array<Record<string, unknown>>) : [];
  const hits: RawHit[] = [];
  for (const f of files) {
    const p = typeof f.path === 'string' ? f.path.trim() : '';
    const why = typeof f.reason === 'string' ? f.reason.trim() : '';
    const rationale = typeof f.rationale === 'string' ? f.rationale.trim() : '';
    const ref = typeof f.ref === 'string' ? f.ref.trim() : '';
    // ★ 产出契约在解析口就生效：三要素（已知作用对象 + 结论 + 出处）缺一 ⇒ 这条**产不出**（丢弃，不是"收下再筛"）
    if (known.has(p) && why && ref) hits.push({ key: p, why, rationale, ref, evidence_source: ev });
  }
  return hits;
}

/** 并发跑一批批次的 worker 池（形状照搬 role_title.ts；★ 但**不吞异常**：单批失败即整体失败）。 */
async function runBatches<T>(
  batches: T[][],
  ask: (batch: T[]) => Promise<RawHit[]>,
): Promise<RawHit[]> {
  const out: RawHit[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next++;
      if (idx >= batches.length) return;
      const hits = await ask(batches[idx]);
      out.push(...hits);
    }
  };
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()),
  );
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason; // ★ 不许静默降级：任一批次失败 ⇒ 整体失败
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ──────── 写（累进投票 → 一文件一条） ────────

/** 一个归一化结论的票桶：**同一条** `why` 被**几份证据**投到 */
interface VoteBin {
  /** 该桶的结论短语（取**首次**落进本桶的证据原文） */
  why: string;
  /** 详细理由（**不参与归一**；同样取首次落桶的证据） */
  rationale: string;
  /** 出处锚点（首次落桶的证据；★ 收敛时只保留第一条 —— 其余证据源见 `evidence_source`） */
  ref: string;
  /** 票数 = 支持该说法的**证据源个数** */
  votes: number;
  /** 支持该说法的证据源（各证据源对同一文件最多投一票 ⇒ 长度 = votes） */
  evidence_source: EvidenceSource[];
}

/** 按 key 聚合各证据源的命中：key(rel) → 归一化结论 → 票桶 */
type VoteTable = Map<string, Map<string, VoteBin>>;

/**
 * ★ 「写」阶段之一：把一份证据的命中累进票桶。
 *   ★ 每个证据源对同一个文件**最多贡献一条** `why`（一次调用一次采样）⇒ 同一桶的票数 == 支持它的证据源个数。
 */
function accumulate(table: VoteTable, hits: RawHit[]): void {
  for (const h of hits) {
    let byWhy = table.get(h.key);
    if (!byWhy) {
      byWhy = new Map();
      table.set(h.key, byWhy);
    }
    const norm = normalizeWhy(h.why);
    const cur = byWhy.get(norm);
    if (cur) {
      cur.votes++;
      if (!cur.evidence_source.includes(h.evidence_source)) cur.evidence_source.push(h.evidence_source);
    } else {
      byWhy.set(norm, { why: h.why, rationale: h.rationale, ref: h.ref, votes: 1, evidence_source: [h.evidence_source] });
    }
  }
}

/**
 * 按票数**降序**排出全部桶；**同票保持首次出现顺序**（`[...map.values()]` = 插入序，`sort` 稳定）
 * ⇒ 平局以**稳定序**打破，不靠随机、可复现。
 */
function rankBins(byWhy: Map<string, VoteBin>): VoteBin[] {
  return [...byWhy.values()].sort((a, b) => b.votes - a.votes);
}

/** 目标文件 → 它各份证据的 `evidence` 摘要（供逐条复核） */
type EvidenceByRel = Map<string, EvidenceSignal[]>;

/**
 * ★ 「写」阶段之二：逐目标产出决策（**一个文件最多一条**）。
 *   票最多者 → `decision`；其余桶 → `alternatives`（各带票数 + 证据源）。
 *   返回的每条都已过 {@link buildLead} 的产出契约（三要素齐备）。
 */
function writeCandidates(
  targets: TargetFile[],
  table: VoteTable,
  evidenceByRel: EvidenceByRel,
  landable: (rel: string) => boolean,
): HarvestCandidate[] {
  const leads: HarvestCandidate[] = [];
  for (const t of targets) {
    const byWhy = table.get(t.rel);
    if (!byWhy) continue; // 该文件三份证据都没产出 why ⇒ 产不出
    const ranked = rankBins(byWhy);
    const top = ranked[0];
    // ★★ 不收敛（多个桶）⇒ 其余结论**不丢**，收进 alternatives（各带票数 + 证据源）；**最高票仍只出一条**
    const alternatives: AlternativeWhy[] = ranked
      .slice(1)
      .map((b) => ({ why: b.why, votes: b.votes, evidence_source: b.evidence_source }));
    // samples = 本文件实际产出 why 的证据源个数 = 各桶票数之和（每源对每文件最多一票）
    const samples = ranked.reduce((s, b) => s + b.votes, 0);
    const sigs = evidenceByRel.get(t.rel) ?? [];
    const evidence = sigs.map((s) => `[${s.evidence_source}] ${s.evidence}`).join(' | ').slice(0, EVIDENCE_MAX * 3);
    const lead = buildLead(
      { why: top.why, origin: top.ref, subject: t.rel },
      {
        source: t.kind === 'code' ? 'comment' : 'doc',
        votes: top.votes,
        samples,
        evidence_source: top.evidence_source,
        rationale: top.rationale,
        alternatives,
        evidence,
        lifecycle_hint: lifecycleHint(sigs.map((s) => s.lines.map((l) => l.text).join(' ')).join(' ')),
        // ★★ 落点可行性：**只标注**（这条候选照旧进结果，不因"落不进去"被丢）
        landing: landable(t.rel) ? 'ok' : 'not-in-feature',
      },
    );
    if (lead) leads.push(lead);
  }
  return leads;
}

// ──────── 收集目标文件 ────────

function collectMdFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function relOf(root: string, abs: string): string {
  return (path.relative(root, abs) || abs).split(path.sep).join('/');
}

/** 项目已索引的源码文件（读 cache.db 的 `files` 表） */
function indexedCodeTargets(db: Database, root: string): TargetFile[] {
  const rows = db.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
  const out: TargetFile[] = [];
  for (const r of rows) {
    if (!SOURCE_EXT_RE.test(r.path)) continue;
    out.push({ rel: r.path, abs: path.join(root, r.path), kind: 'code' });
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/** 文档目录下的 md 目标（相对路径 + 绝对路径） */
function docTargets(docDir: string, root: string): TargetFile[] {
  const out: TargetFile[] = [];
  for (const md of collectMdFiles(docDir)) out.push({ rel: relOf(root, md), abs: md, kind: 'doc' });
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/** 读文档语料（供 `docs` 证据检索"谁提到了它"）；★ 读不到的 md **不静默跳过**，会进语料为空串。 */
function readDocCorpus(docDir: string, root: string): DocCorpusEntry[] {
  const out: DocCorpusEntry[] = [];
  for (const md of collectMdFiles(docDir)) {
    let text = '';
    try {
      text = fs.readFileSync(md, 'utf-8');
    } catch {
      text = '';
    }
    out.push({ rel: relOf(root, md), text });
  }
  return out;
}

// ──────── git 仓库判定 ────────

/**
 * git 仓库是否可用（**只判一次**）。`gitAvailable()`=false 或 `git rev-parse` 失败 ⇒ false。
 * ★ 这不是"静默降级"：它明确回答"这一份证据源在本仓是否存在"，`historyEvidence` 据此**如实缺席**
 *   （返回 null ⇒ 该证据源不投票），而不是编造/顶替。
 */
function isGitRepo(gitRoot: string): boolean {
  if (!gitAvailable()) return false;
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: gitRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false; // 非 git 仓库：本证据源整体缺席（不是错误）
  }
}

// ──────── 主入口 ────────

/**
 * ★★ 产出条数上限（2026-10-10，T-e2e Bug3）：判开（`candidates`）与判关（`evidence_by_file`）**共用**。
 *   ★ 单一落点：两档各写一份 `slice` 就是本仓最反对的"判据分叉"。
 *   ★★ **不传 `limit` ⇒ 不设上限**（返回原列表，行为与改造前一致）——
 *     这是回归判据要求的（"judge:false 不传 limit 时行为不变"）：上限是**可选项**，不是默认开。
 *   `limit` 显式给出时才截断；非正数 ⇒ 空列表（不静默当"无限"）。
 */
function applyOutputLimit<T>(xs: T[], limit: number | undefined): T[] {
  return limit === undefined ? xs : xs.slice(0, Math.max(0, limit));
}

async function harvestDecisionsCore(input: HarvestInput): Promise<HarvestResult> {
  const { feature } = input;

  // ★★ 2026-10-10（落点可行性）：采集**必须**读得到本 feature —— 才能逐条判定"这个落点能不能写进去"。
  //   ★ 读不到 ⇒ **抛**（**不许**静默降级成"全标落点不在"：那会把"我没读到 feature"伪装成
  //     "这个 feature 里一个文件都没有" —— 正是本仓最反对的静默降级）。
  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(
      `harvest_decisions：读不到 feature "${feature}" 的 DSL，无法判定各候选的落点可行性（不静默降级为"全标落点不在"）。\n` +
        `请先用 list_features / get_dsl 确认该 feature 存在（或用 import_project 建一个）后重试。`,
    );
  }
  // ★ 落点判据 = 写入口那一份（见 makeLandable / findDecisionTargetNode）
  const landable = makeLandable(dsl);

  // ★★ 「判」的档位（见文件头）：入参**显式优先**；不传则**自动检测**（有密钥 ⇒ 判开）。
  //   ⚠ 判开却无密钥 ⇒ 在 `requireLlmConfig()` 里**抛**（含"怎样配"提示）；判关 ⇒ 降级只给证据（回执明说）。
  const cfgOrNull = loadCfgOrNull();
  let judged: boolean;
  let degradeReason = '';
  if (input.judge === true) {
    judged = true;
  } else if (input.judge === false) {
    judged = false;
    degradeReason = '入参显式 `judge:false`';
  } else if (cfgOrNull) {
    judged = true;
  } else {
    judged = false;
    degradeReason = '未检测到 LLM 密钥（自动档）';
  }
  const cfg = judged ? requireLlmConfig() : null;

  // ★★ 产出条数上限（判开/判关两档都生效；见 HarvestInput.limit）。**不传 = 不设上限**（保留改造前行为）。
  const limit = input.limit;
  // ★ 注释扫描锚定 **进程当前目录**（= 被分析的项目；与 `doc_dir` 默认根 `<cwd>/docs` 同一口径）。
  const projectRoot = path.resolve(process.cwd());
  const gitRoot = path.resolve(input.git_root ?? process.cwd());
  const docDir = input.doc_dir ?? path.join(process.cwd(), 'docs');

  // 目标文件：源码文件（已索引）+ 文档 md
  const { db } = await ensureProjectIndex(projectRoot); // 代码证据需要符号索引（零前置：空库就地冷启）
  const codeAll = indexedCodeTargets(db, projectRoot);
  const docAll = docTargets(docDir, projectRoot);
  // ★★★ 统一的处理范围（`files`，T119）：**同时**过滤源码目标与文档目标（= 整个 target 集）。
  //   ★ 不传 `files` ⇒ `scope=null` ⇒ `codeTargets`/`docT` 逐字等于全部目标（回归判据：行为不变）。
  //   ★ 路径归一复用写入口的 `normRel`（不自己拼口径 ⇒ 与 `edit_dsl` 认的相对路径同一份）。
  const scope = input.files?.length ? new Set(input.files.map(normRel)) : null;
  const codeTargets = scope ? codeAll.filter((t) => scope.has(normRel(t.rel))) : codeAll;
  const docT = scope ? docAll.filter((t) => scope.has(normRel(t.rel))) : docAll;
  const targets: TargetFile[] = [...codeTargets, ...docT];
  // ★★ 限定范围**不静默**：列了却没命中任何目标的路径，逐条出声（本仓"排除必须出声"同款）。
  const scopeMiss = scope
    ? [...scope].filter((p) => !targets.some((t) => normRel(t.rel) === p))
    : [];
  const scopeLine = scope
    ? `  ★ 本次按 files 限定处理范围（同时限源码+文档目标）：给定 ${scope.size} 个路径 ⇒ 命中 源码 ${codeTargets.length} 个 / 文档 ${docT.length} 个` +
      (scopeMiss.length ? `；**未命中任何目标**的路径 ${scopeMiss.length} 个：${scopeMiss.join('、')}` : '')
    : '';

  const ctx: EvidenceCtx = {
    db,
    gitRoot,
    gitRepoOk: isGitRepo(gitRoot),
    // ★ 每文件 git 历史条数 = **独立常量**（与产出上限 `limit` 解耦，见 GIT_LOG_LIMIT）
    gitLogLimit: GIT_LOG_LIMIT,
    docCorpus: readDocCorpus(docDir, projectRoot),
  };

  // ★★★ ① 读：三份证据**各自取**（取不到即缺席；不用别的证据顶替）
  const table: VoteTable = new Map();
  const evidenceByRel: EvidenceByRel = new Map();
  const signalsBySource = new Map<EvidenceSource, EvidenceSignal[]>();
  const perSource: Record<EvidenceSource, { signals: number; chars: number }> = {
    code: { signals: 0, chars: 0 },
    history: { signals: 0, chars: 0 },
    docs: { signals: 0, chars: 0 },
  };
  for (const ev of EVIDENCE_SOURCES) {
    const signals: EvidenceSignal[] = [];
    for (const t of targets) {
      const sig = evidenceForSource(ev, t, ctx);
      if (!sig) continue;
      signals.push(sig);
      const arr = evidenceByRel.get(t.rel) ?? [];
      arr.push(sig);
      evidenceByRel.set(t.rel, arr);
      perSource[ev].signals++;
      perSource[ev].chars += sig.evidence.length;
    }
    signalsBySource.set(ev, signals);
  }
  const evidenceLine =
    `  ★ 三份证据各自取数: code ${perSource.code.signals} 个文件(${perSource.code.chars} 字) · ` +
    `history ${perSource.history.signals} 个(${perSource.history.chars} 字) · docs ${perSource.docs.signals} 个(${perSource.docs.chars} 字)`;
  // ★ 有 `files` 时限范围行在"目标"行**之前**（判开/判关两档共用，单一落点）。
  const targetLine =
    (scopeLine ? `${scopeLine}\n` : '') +
    `  目标: 源码 ${codeTargets.length} 个 / 文档 ${docT.length} 个 · git_root=${gitRoot}（有历史证据: ${ctx.gitRepoOk ? '是' : '否'}）`;

  // ★★★ ② 判 + ③ 写：只有"判开"时才走 LLM；判关 ⇒ 直接降级只给证据（**回执必明说**）
  if (judged && cfg) {
    for (const ev of EVIDENCE_SOURCES) {
      const signals = signalsBySource.get(ev) ?? [];
      if (signals.length === 0) continue; // 本证据源在本仓/本批整体缺席 ⇒ 不投任何票
      const hits = await runBatches(chunk(signals, BATCH_SIZE), (b) => askEvidenceBatch(cfg, b, ev));
      accumulate(table, hits);
    }
    const allCandidates = writeCandidates(targets, table, evidenceByRel, landable);
    // ★★ 产出条数上限（判开档同样生效；见 HarvestInput.limit）。截断**不静默**：回执明写总量。
    const candidates = applyOutputLimit(allCandidates, limit);
    const nOf = (s: HarvestSource) => candidates.filter((c) => c.source === s).length;
    const conv = candidates.filter((c) => c.votes > 1).length;
    // ★★ 落点可行性汇总（★ 对**全部**产出计，不受 limit 截断影响 —— 见下方"排除必须出声"同款）
    const landOk = allCandidates.filter((c) => c.landing === 'ok').length;
    const landOut = allCandidates.length - landOk;
    const lines = [
      `harvest_decisions [${feature}] **判开** ⇒ 产出 ${allCandidates.length} 条决策（三要素齐备：结论 / 出处 / 作用对象）`,
      ...(allCandidates.length > candidates.length
        ? [`  ★ 已按 limit=${limit} 截断：下面只显示前 ${candidates.length} 条（要全部请调大 limit）。`]
        : []),
      // ★★ 落点可行性（本仓"排除必须出声"同款）：落点不可用的**没被丢**，这里如实汇总。
      `  ★★ 落点可用性（判据 = edit_dsl 写入口那一份）: 可落库 ${landOk} 条 · **落点不在本 feature 文件集内 ${landOut} 条**（源码多半因 import_project 的 max_files 截断而落选；文档需 include_docs=true 才成节点）—— 这些条**照旧保留**（对看清项目仍有价值），按需扩大 max_files 后重跑 edit_dsl 即可写入。`,
      targetLine,
      evidenceLine,
      `  ★ votes = 支持该说法的**证据源个数**（1..3，多源印证 = 置信）；多源收敛 ${conv} 条 · 来源: comment ${nOf('comment')} · doc ${nOf('doc')}`,
      '',
      ...candidates.map((c, i) => {
        const lh = c.lifecycle_hint ? `  ⚠ lifecycle:${c.lifecycle_hint.type}` : '';
        const alt = c.alternatives.length
          ? `  未决分歧: ${c.alternatives.map((a) => `${a.why}(${a.votes}票←${a.evidence_source.join('+')})`).join(' · ')}`
          : '';
        // ★ 落点标记（每条候选自带）：可落库 / 落点不在本 feature 文件集内
        const land = c.landing === 'ok' ? '  ✅ 可落库' : '  ★ 落点不在本 feature 文件集内（edit_dsl 会拒收）';
        return (
          `  ${i + 1}. [${c.source}] ${c.decision.summary}  证据 ${c.votes}/${c.samples}${land}${lh}${alt}\n` +
          `      ↳ 作用对象: ${c.file_path}\n` +
          `      ↳ 出处: ${c.ref}\n` +
          `      ↳ 证据源: ${c.evidence_source.join('+')}\n` +
          `      ↳ 证据: ${c.evidence}`
        );
      }),
      '',
      '用法: 逐条核对出处/原文；把候选写回文件节点用 `edit_dsl`（type=decision, data.summary/…, ★ 未决分歧进 data.dissent，不是 data.alternatives）。',
    ];
    return { message: lines.join('\n'), feature, judged: true, candidates };
  }

  // ── 判关：降级成"只给三份证据"（**让调用方自己判**）──
  const allEvidence = buildEvidenceByFile(targets, evidenceByRel, landable);
  // ★★ 产出条数上限（判关档也生效；见 HarvestInput.limit）。截断**不静默**：回执明写总量。
  const evidenceByFile = applyOutputLimit(allEvidence, limit);
  // ★★ 落点可行性汇总（★ 对**全部**证据计，不受 limit 截断影响）
  const evLandOk = allEvidence.filter((f) => f.landing === 'ok').length;
  const evLandOut = allEvidence.length - evLandOk;
  const lines = [
    `harvest_decisions [${feature}] ★★ **本次没判**（${degradeReason}）⇒ 已降级为「**只给三份证据**」`,
    ...(allEvidence.length > evidenceByFile.length
      ? [`  ★ 已按 limit=${limit} 截断：本次共取到 ${allEvidence.length} 个文件的证据，下面只显示前 ${evidenceByFile.length} 个（要全部请调大 limit）。`]
      : []),
    '  ★ 这是**降级**，不是失败：下面给的是**未经 LLM 判断**的原始证据，请调用方**自己判**「每个文件为什么存在」。',
    // ★★ 落点可行性（本仓"排除必须出声"同款）：判关也标，落点不可用的证据**没被丢**。
    `  ★★ 落点可用性（判据 = edit_dsl 写入口那一份）: 可落库 ${evLandOk} 个 · **落点不在本 feature 文件集内 ${evLandOut} 个**（源码多半因 import_project 的 max_files 截断而落选；文档需 include_docs=true 才成节点）—— 这些个**照旧保留**，按需扩大 max_files 后重跑即可写入。`,
    targetLine,
    evidenceLine,
    '',
    ...evidenceByFile.map((f, i) => {
      const ex = f.excerpts.map((e) => `      [${e.evidence_source}] ${e.summary}`).join('\n');
      // ★ 落点标记（每个文件自带）
      const land = f.landing === 'ok' ? '  ✅ 可落库' : '  ★ 落点不在本 feature 文件集内（edit_dsl 会拒收）';
      return `  ${i + 1}. [${f.source}] ${f.file_path}${land}\n${ex}`;
    }),
    '',
    '★ 要"判"：配置密钥后不带 judge 重跑，或显式 judge:true（无密钥时会报错并给配置指引）。',
    describeAgnesConfigHint(),
  ];
  return { message: lines.join('\n'), feature, judged: false, candidates: [], evidence_by_file: evidenceByFile };
}

/**
 * ★ 判关降级产物：逐文件把三份证据（code / history / docs）折成可复核的摘要 + 出处。
 * ★ 判据：只收"该文件**至少取到一份证据**"的（一份都没取到 ⇒ 无从给证据）。
 */
function buildEvidenceByFile(
  targets: TargetFile[],
  evidenceByRel: EvidenceByRel,
  landable: (rel: string) => boolean,
): FileEvidence[] {
  const out: FileEvidence[] = [];
  for (const t of targets) {
    const sigs = evidenceByRel.get(t.rel);
    if (!sigs?.length) continue;
    out.push({
      file_path: t.rel,
      source: t.kind === 'code' ? 'comment' : 'doc',
      excerpts: sigs.map((s) => ({
        evidence_source: s.evidence_source,
        summary: s.evidence,
        refs: s.lines.map((l) => l.ref),
      })),
      // ★★ 落点可行性：**只标注**（这个文件的证据照旧进结果）
      landing: landable(t.rel) ? 'ok' : 'not-in-feature',
    });
  }
  return out;
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 */
function touchedOf(input: HarvestInput): Touched {
  const touched: Touched = {};

  // feature：作用域类，随时可给（入参必填）。★ 产物顶层**也有** `feature`，属"同一事实两个名字"。
  touched.feature = input.feature;

  // ★ 不给 project_dir：入参里**没有** project_dir（只有 `doc_dir` 与 `git_root`）。
  // ★ 不给 written_files：本 [B] 只产出 draft 决策、**不写任何文件/DSL**（写回用 `edit_dsl` 的 `type:'decision'` op）。
  // ★ 不给 symbols / nodes：决策线索里没有符号 / DSL 节点标识可取。

  return touched;
}

export async function harvestDecisions(input: HarvestInput): Promise<TouchedProduct<HarvestResult>> {
  const r = await harvestDecisionsCore(input);
  return withTouched(r, touchedOf(input));
}
