/**
 * expectations.ts —— 「**可判定的验收**」的判定器（2026-10-09，`docs/todo.md` T74）。
 * 类型与格式化在 `domain/expectation.ts`（那边不许 import infrastructure，所以判定器住这儿）。
 *
 * ## 四条纪律
 * 1. ★★★ **只看"此刻的代码"，不许拿索引冒充代码**。★ 这条是**出生证当场抓出来的**：
 *    初版用 `fileFacts`（读 `cache.db`）判 `symbol-exists` —— 我把源码里的 `mul` 删掉后，
 *    `consistency_check` 自己（**现解析**）已经报了 `missing: 1`，而我的判定器**仍报"✅ 有 mul"**
 *    ⇒ **拿"索引里的代码"判"此刻的代码" = 假绿**。
 *    ⇒ 修法：`symbol-exists` / `signature-matches` 一律**现读文件 + 现解析**
 *      （`fs.readFileSync` + `parseFile`；与 `intent/consistency.ts` 的 `checkConsistencyReport` 同一套入口）。
 * 2. ★★★ **判不了 ⇒ `unsupported`，既不算过也不算不过**。三类必须显式识别：
 *    · 扩展名不走 TS/JS 解析器 ⇒ 符号事实取不到；
 *    · 依赖边表**按设计只记 `relative` 且非 `type_only`**（`infrastructure/index/symbols.ts:388-390`）
 *      ⇒ 含包导入（Go/Python）的文件，"依赖事实"**不完整**；`import type` 的边**按设计不存在**；
 *    · 依赖边**只能取自索引**（符号能现解析，依赖不能）⇒ 源文件**比索引新**时，事实可能过期。
 *    ★ 三条都是"**没查到 ≠ 不存在**"的形态 —— 判成 fail 是误报，判成 pass 是假绿，所以**单列一类**。
 * 3. ★ **`unsupported` 不许混进"通过"**：那等于用"判不了"冒充"没问题"（本仓最忌的那类绿）。
 * 4. ★ **不新造解析**：符号走 `parseFile`，依赖走 `fileFacts.deps` + `getRawImportsOfFile`，
 *    全是既有入口；本文件只把它们按"五种检查项"编排一遍。
 * 5. ★★★ T-19（2026-11-06）：**`run` 判据的 `facts` 门面问的不是"此刻代码有什么"**。
 *    "此刻代码有什么"必须**现解析**（纪律 1）；`facts` 回答的是另一句话 ——
 *    「**派生把它看见的东西写进册了吗**」：对拍对象是**派生源本身**（`cache.db`），
 *    所以在这里用索引是**语义正确**，不是"拿索引冒充代码"。
 *    ★ 边界（`judge_facts.ts` 头注释写全）：谁若拿 `facts` 去判"符号还在不在"，
 *      就重犯了出生证那个事故 —— 那件事归 `symbol-exists` / `signature-matches` / drift。
 */
import fs from 'node:fs';
import path from 'node:path';
// ★★★ 2026-11-18（maker-checker 首卡）：`run.expect` 的求值域改成**禁代码生成**的 vm 上下文 ——
//   与 `infrastructure/parse/kernel.ts` 求值常量表达式时用的是**同一条路**（本仓先例，不是新发明）。
//   为什么必须换：`new Function` 在宿主 realm 里跑，逃逸面只能靠词表（T4 一行旁路全过）。
import vm from 'node:vm';
// ★★★ 2026-11-18（B1 · worker_threads 隔离判据求值）：`run.expect` 在**带 flag 的 worker 进程**里求值 ——
//   宿主 realm 的 `.constructor` 逃逸（E1/E2/E4）在该进程内也禁代码生成 ⇒ 同死。
//   起不来 ⇒ 回落 vm 路径 + `criteriaPoolDegradedReason()` 显式声明能力降级（不是静默旁路）。
import {
  evaluateInIsolation,
  criteriaPoolDegradedReason,
  clearCriteriaPoolDegraded,
  type RunEvalJob,
} from './criteria_worker_pool.js';
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
import { getProjectCacheDb, projectCacheDbPath } from '../../../infrastructure/index/db.js';
import { getRawImportsOfFile, contentHash } from '../../../infrastructure/index/symbols.js';
import { parseFile, isSupportedFile } from '../../../infrastructure/parse/index.js';
// ★ T79：调用边读取**复用现成那一处**（别在这再写一份 SQL）
import { queryFileCalls } from '../../meta/explore/query_feature.js';
import { normPath, normSignature, type Expectation } from '../../../domain/expectation.js';
// ★ 2026-10-30（subagent:rule-strip）：`source-has` 的**匹配核**住 domain（纯函数）—— 它先剥注释再匹配，
//   本文件只读文件、渲染四态。判据见 `domain/expectation_kinds.ts#matchSourceHas` 的头注释。
import { matchSourceHas } from '../../../domain/expectation_kinds.js';
// ★★★ 2026-11-04（subagent:text-has-fix）：source-has 的**剥注释三件套** ——
//   分派判据 `isCodeText`（domain，零依赖）· AST 注释区间权威 `stripCommentsSync`（infrastructure）·
//   幂等预热 `prewarmKernel`（不预热 ⇒ stripCommentsSync 返回 null ⇒ 判 unsupported）。
//   ★ 为什么这三行能住在这里：application 可以向下引 infrastructure 与 domain —— 这正是当初
//     domain 里那个手写剥注释器消失的理由（它存在只是为了绕过分层，不是为了正确）。
import { isCodeText } from '../../../domain/text_strip.js';
import { stripCommentsSync } from '../../../infrastructure/parse/comments.js';
import { prewarmKernel } from '../../../infrastructure/parse/kernel.js';
// ★ 2026-10-31（B1b）：behavior-cases 的比对核搬进 domain（零依赖纯函数 ⇒ 10 条 behavior-cases 直接跑；
//   容器只许精确 repr 那条假绿守卫从此可判，不再只能写成 source-has）
import { sameBehaviorRet } from '../../../domain/behavior_compare.js';
// ★ 2026-10-24（judge-cache 第一阶）：**一阶文件哈希缓存** —— 「没变的文件不再测」（判据见 judgeExpectations 内注）
// ★★ 2026-10-31（假绿事故）：新鲜度来源改成 `diskFileHash`（**判定时现读磁盘**），索引不再参与
import { loadJudgeCache, saveJudgeCache, judgeCacheKey, diskFileHash } from './judge_cache.js';
// ★ 工作项 L（2026-10-24）：行为契约的执行核 —— 复用 behavior 基建（与 capture/verify 同一条执行路径）
import { runHarness, type BehaviorRun, type BehaviorSpec } from '../../../infrastructure/authoring/behavior/index.js';
// ★★ 2026-11-09（契约形态扩展）：steps / effects / throws / budget 的执行核
import { isCaseProgram, runCaseProgram, type CaseRunResult } from './case_program.js';
// ★★★ 2026-11-17（P0 · judge-all 全量 <30s）：`behavior-cases` 的**执行**（夹具建盘 + 起进程）是唯一的热点
//   （实测 81 条 74.6–94.7s，占全量 104s 的 ~80%；其余 10 种 kind 合计 < 4s），而它整段跑在**主线程**里。
//   ⇒ 把"执行"交给执行池（同一份 `runHarness` / `runCaseProgram`，只是换个线程），**判定仍只在本文件**。
//   ★ 池子不可用（并发度 ≤ 1 / worker 起不来）⇒ 就地串行跑同一个执行核 ⇒ 结论必须逐条相同。
import { submit as submitBehaviorJob, judgeConcurrency } from './behavior_pool.js';
import { runJourneyCase } from './journey_program.js';
// ★ 2026-10-28（T-#OBSERVE-1）：运行时判据要用**同一套**事件判定规则（不另写一份）
import { judgeEvent } from '../../../infrastructure/analysis/observe/judge.js';
// ★ 2026-10-21（D-judge-port）：判定器的**形状**住 domain（端口 = `domain/judge_port.ts`），本文件只实现
//   「怎么判」。★ 这不是第二把尺 —— 除了本文件，全仓没有第二个 `judgeExpectations`。
import type {
  ExpectationConflict,
  ExpectationItem,
  ExpectationsReport,
  EvidenceMark,
  EvidenceTier,
  IndexCoverageReport,
  JudgeItem,
  Verdict,
} from '../../../domain/judge_port.js';
// ★ T257：TS/JS 家族扩展名的**唯一判据**（`infrastructure/parse/source_exts.ts`）—— 不另写一把尺
import { TS_JS_EXTS } from '../../../infrastructure/parse/source_exts.js';
// ★★★ T-19（2026-11-06）：`run` 判据的**只读事实门面** + **只读 fs**
//   · `createJudgeFacts`：能力判据要"实际侧的符号事实"才写得出，见 `judge_facts.ts` 头注释
//   · `READ_ONLY_FS`：把"run 只许读+判"从**文档纪律**变成**结构**（注入的 fs 上没有写函数）
import { createJudgeFacts, READ_ONLY_FS, type JudgeFacts } from './judge_facts.js';

// ★★★ 2026-10-21（D-judge-port）：`Verdict` / `ExpectationItem` / `ExpectationsReport` /
//   `ExpectationConflict` / `JudgeItem` 已搬到 `domain/judge_port.ts` —— **它们是 domain 的词汇表**：
//   `cardStanding` 要读 `checked / passed / failed / unsupported` 与 `items[].verdict / items[].expectation`
//   才能派生五值 ⇒ 「谁必须读懂它」的答案是 domain。
//   ★ 本文件只留**实现**（怎么判）；形状由端口那一处声明 —— 同一事实不住两处。
//   ★ 搬过去时逐字保留了原注释里的判据（四值语义 / 冲突只检可判定的互斥 / 为什么单列不进计数）。

// ★★★ P1（2026-11-17 · 市场吸收首卡）：**kind ⇒ 默认证据等级**（唯一权威，穷尽性由 Record 钉死）。
//   与 `domain/expectation.ts#PHASE_BY_KIND` 同形：往 Expectation 联合加一个 kind 而漏标 ⇒ tsc 报错。
//   ★ 五道自检的"引源/下一步验证"是**写册人**的责任（机器不替人认领二手/假设），
//     这里只给**默认档**：第一手/现读类可直用；纯文本类默认二手；社区惯例与"先前验证过"只能显式标。
export const EVIDENCE_TIER_BY_KIND: Record<Expectation['kind'], EvidenceTier> = {
  'behavior-cases': 'tested',   // 现跑输入→比输出（runHarness / runCaseProgram）
  'journey-cases': 'tested',    // 真投递→比出站帧终态（runJourneyCase）
  'run': 'tested',              // 求值布尔断言（`blocked_by` 命中时 verdict=pending，等级只作标注）
  'runtime': 'measured',        // 读真进程探针事件再 judgeEvent：量到的观测，非受控输入→输出实验
  'file-exists': 'read_directly',
  'symbol-exists': 'read_directly',   // 现读文件 + parseFile（纪律 1，不用索引冒充代码）
  'signature-matches': 'read_directly',
  // ★ D1 裁定：下面四类读的是**索引派生的边**，默认仍 read_directly，但 basis 强制注明来源，
  //   与 `indexStaleFor` 的既有兜底告警同处呈现，不冒充"现解析源码"。
  'call-exists': 'read_directly',
  'edge-exists': 'read_directly',
  'edge-absent': 'read_directly',
  'domain-independent': 'read_directly',
  'source-has': 'documented',   // 只验文本含串、不懂语义（见 kind 注）⇒ 二手，需 cited
};

/** 由弱到强（报告层分布按此序打印；也是自检里 "tier 合法" 的唯一名单） */
export const EVIDENCE_TIERS: readonly EvidenceTier[] = [
  'assumption', 'community_practice', 'documented', 'prior_verified',
  'read_directly', 'measured', 'tested',
];

/**
 * ★★★ P1 五道自检（image-scout 五道序贯的**只读译法**：provenance→签名→量纲→非占位→原子写
 *   ⇒ tier 合法 / 引源 / 下一步验证 / 不改 verdict / 报告可手算）。
 * 任一不过 ⇒ 返回一条可读原因（`judge-all` 响亮点名）；★ **不改 verdict、不写盘、退出码不变**
 *   （lead D2/D4 裁定：首版只警告，只当"下一步验证清单"）。
 */
export function checkEvidenceMark(m: EvidenceMark): string[] {
  const bad: string[] = [];
  if (!EVIDENCE_TIERS.includes(m.tier)) bad.push(`tier 非法：${String(m.tier)}`);
  if ((m.tier === 'documented' || m.tier === 'community_practice') && !m.cited)
    bad.push(`${m.tier} 必须引源（cited 缺失）`);
  if (m.tier === 'assumption' && !m.next_verify)
    bad.push('assumption 必须给下一步验证步骤（next_verify 缺失）');
  if (!m.basis) bad.push('依据 basis 缺失');
  return bad;
}

/**
 * ★★★ T256 缺口②（2026-10-14）：**决策间冲突**的检测 —— ★ **判据只住这一处**。
 *
 * ## 「冲突」的定义（★ 只检**同一对象上的互斥要求**，不猜语义冲突）
 * · 同一 `from → to`：一条要 `edge-exists`、另一条要 `edge-absent`；
 * · 同一 `path#symbol`：两条 `signature-matches` 要求**不同签名**。
 *
 * ★ **为什么只检这两类**：它们是**可判定的互斥**（同一对象上不可能同时成立）。
 *   "语义冲突"（如 A 说该拆、B 说该合）**机器判不了** ⇒ **不假装能判**（那会变成假信号）。
 * ★ **为什么不并进 `verdict`**：冲突是**要求之间的矛盾**，与"代码满没满足"是**两件事**
 *   —— 两条互斥要求里，代码**只能满足一条**，所以至少一条会 fail；但"谁对"是**人的裁**。
 *   ⇒ 单列一段，不混进 pass/fail 计数。
 */
export function findExpectationConflicts(
  items: readonly JudgeItem[],
): ExpectationConflict[] {
  const out: ExpectationConflict[] = [];
  const add = (
    map: Map<string, Array<{ node_id: string; kind: string; text: string }>>,
    k: string,
    v: { node_id: string; kind: string; text: string },
  ): void => {
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(v);
  };

  // ① edge：同一 from→to 上 exists vs absent
  const byEdge = new Map<string, Array<{ node_id: string; kind: string; text: string }>>();
  for (const it of items) {
    const e = it.expectation;
    if (e.kind !== 'edge-exists' && e.kind !== 'edge-absent') continue;
    add(byEdge, `${normPath(e.from)} → ${normPath(e.to)}`, {
      node_id: it.node_id,
      kind: e.kind,
      text: `${e.kind}：${e.from} → ${e.to}`,
    });
  }
  for (const [subject, sides] of byEdge) {
    if (new Set(sides.map((x) => x.kind)).size > 1) out.push({ subject, sides });
  }

  // ② signature：同一 path#symbol 上两条要求不同签名
  const bySig = new Map<string, Array<{ node_id: string; kind: string; text: string }>>();
  for (const it of items) {
    const e = it.expectation;
    if (e.kind !== 'signature-matches') continue;
    add(bySig, `${normPath(e.path)}#${e.symbol}`, { node_id: it.node_id, kind: e.kind, text: e.signature });
  }
  for (const [subject, sides] of bySig) {
    if (new Set(sides.map((x) => normSignature(x.text))).size > 1) out.push({ subject, sides });
  }

  return out;
}

/**
 * 索引是否**与源码一致**。
 *
 * ★★★ 2026-10-09 **判据换过一次，这次是换掉一个错判据** —— 起因是"真跑一遍试用"：
 *   在真夹具上把 `format.ts` 改对之后，`fileFacts('src/format.ts').deps` **已经是 `['src/math.ts']`**
 *   （索引确实更新了、设计确实满足了），而旧判据仍报「**索引比源码旧 ⇒ 判不了**」⇒ **误报**。
 *   根因两条：① 旧判据比的是 **mtime**，而索引库是 **WAL** 模式 ⇒ **写的是 `cache.db-wal`/`-shm`，
 *   主库 `cache.db` 的 mtime 根本不更新**（实测：主库停在 10-08 21:58，而源文件是 10-09 10:55）；
 *   ② 即使不是 WAL，"谁的 mtime 大"也只是**代理**，而 `files.content_hash` 是**事实**。
 *   ⇒ 换成**按内容比对**：读源文件算 `contentHash`（**复用 `index/symbols.ts` 那一份，不另写 sha1**），
 *     与索引里该文件的 `content_hash` 比。**这才叫"索引是否反映此刻的代码"。**
 * ★ 为什么误报也危险：它会让**干对了的人以为没干对** —— 比假绿更难察（假绿是"不该绿却绿"，
 *   误报是"该绿却红"，而人会先把活儿重做一遍再说）。
 * ★ 附：提示里必须给**可执行的修复动作**（下面那句就是）—— 只说"判不了"等于把问题丢回给用户。
 */
export function indexStaleFor(root: string, rels: readonly string[]): string | null {
  const db = getProjectCacheDb(root);
  for (const relInput of rels) {
    const rel = normPath(relInput);
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue; // 文件不存在 ⇒ 由调用方去判"失败"，不是这里的事
    const facts = fileFacts(root, rel);
    const key = facts.matched_path ?? rel;
    const row = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: key }) as { content_hash?: string } | undefined;
    if (!row?.content_hash) {
      return `索引里查不到该文件（\`${key}\`）⇒ 依赖事实取不到，判不了`;
    }
    const now = contentHash(fs.readFileSync(abs, 'utf-8'));
    if (row.content_hash !== now) {
      return (
        `**索引与源码不一致**：\`${rel}\` 的内容已改过，但索引还是旧的 ⇒ 依赖边可能没反映这次改动。` +
        `★ 依赖边只能取自索引（符号能现解析，依赖不能）⇒ **宁可说"判不了"，不拿旧事实说"通过"**。` +
        `\n     修复动作：跑一次 \`import_project\`（**默认只刷新"实际"、不碰设计**）即可保鲜，然后再对拍。`
      );
    }
  }
  return null;
}

/**
 * ★ 参与判据的**文件集合**（只收带 `path` 的 kind —— `edge-*` 是 from/to，不是 `path`）。
 * ★ 两处共用同一份派生：`ensureIndexFreshForJudge`（先修索引）与 `countIndexBehindDisk`（兜底告警）
 *   —— 不许各写一遍（那会让"要修的文件集"与"要告警的文件集"悄悄分歧）。
 */
function judgedFilesOf(items: readonly JudgeItem[]): string[] {
  return [
    ...new Set(
      items
        .map((i) => {
          const p = (i.expectation as { path?: unknown }).path;
          return typeof p === 'string' && p ? normPath(p) : '';
        })
        .filter((p): p is string => !!p),
    ),
  ];
}

/**
 * ★★★ 2026-10-31（用户口径：**兜底告警，不做成门**）：判定开始时若发现 `cache.db` 落后于磁盘，
 * 把这件事**说出来**。
 *
 * 「落后」的判据**不新造**：逐文件调 {@link indexStaleFor}（内容哈希比对，与"先修索引"那条路
 * 同一把尺）⇒ 本函数数出来的 N 就是「`ensureIndexFreshForJudge` 会去救的那批文件」。
 *
 * ★ 为什么只告警、不判红：即便索引落后，**文本类判据（source-has / symbol-exists / signature-matches）
 *   现在也按磁盘现算**（`intent/judge_cache.ts#diskFileHash`）⇒ 结论仍然可信；
 *   落后的唯一后果是**边表类判据**可能退化成 `unsupported`（那已由各自的分支如实报）。
 *   ⇒ 加门只会把"可自愈的落后"变成"整天红"，而本仓明令不许为这事加新门/棘轮。
 * ★ 只打一行 stderr + 汇总里带一句：不加噪声、也不让它静默（"不静默"与"不挡住"不矛盾）。
 */
function countIndexBehindDisk(root: string, rels: readonly string[]): number {
  let n = 0;
  for (const rel of rels) {
    try {
      if (indexStaleFor(root, [rel]) !== null) n++;
    } catch {
      /* 探测本身出错 ⇒ 不计（后面的判据会如实报 unsupported，绝不静默） */
    }
  }
  return n;
}

/**
 * ★★★ 2026-10-27（**D6/D9 假红的根因，用户问"能不能修"**）：
 * `call-exists` / `edge-*` **只能读派生索引**（符号能现解析，依赖边不能）⇒ 索引一陈旧就判 `unsupported`，
 * 而 D6 的判据是"`unsupported === 0`" ⇒ 表现成 **"接线断了"**（实测：改完符号没重扫，gate 直接红，
 * 我一开始还去改对的代码）。
 *
 * ## 为什么"先修索引再判"是安全的
 * 索引是**派生数据**（`derivable: true`），刷新它永远安全且幂等（`ensureFreshIndex` 内部按
 * mtime/size 先筛、再 `content_hash` 二道闸，没变的不重解析）。而"拿旧事实说通过"是不安全的
 * —— 所以顺序必须是 **先刷新、后判**，不是"判不了就放行"。
 *
 * ## 边界（不许无限自愈）
 * · 先做**便宜探测**（`indexStaleFor` 只算目标文件的内容 hash，不扫全仓）：不陈旧就一次都不刷；
 * · 刷新失败 / 仍判不了 ⇒ **保持 `unsupported` 并如实报**（仍然红，但红得有理：说明索引真的修不动）。
 */
/** 事实源是派生边表、整库覆盖与否决定其可信度的判据 kind（未覆盖时 fail-closed）。 */
const EDGE_TABLE_KINDS = ['call-exists', 'edge-exists', 'edge-absent', 'domain-independent'];

async function ensureIndexFreshForJudge(root: string, items: readonly JudgeItem[]): Promise<IndexCoverageReport> {
  // ★ `Expectation` 是联合类型：只有一部分 kind 带 `path`（edge-* 是 from/to）⇒ 只收带 path 的
  const rels = judgedFilesOf(items);
  const backfill = { batches: 0, synced: 0, failed: 0, remaining: 0, total: 0 };
  if (!rels.length) {
    return { covers: true, reason: 'ok', missing: 0, walkCount: 0, filesCount: 0, backfill, covOk: true, error: null };
  }
  let stale = false;
  for (const rel of rels) {
    try {
      if (indexStaleFor(root, [rel]) !== null) {
        stale = true;
        break;
      }
    } catch {
      /* 探测本身出错 ⇒ 当作"不陈旧"，后续判据会如实报 unsupported */
    }
  }
  let phase = 'open-db';
  try {
    const db = getProjectCacheDb(root);
    if (stale) {
      phase = 'fresh-index';
      // ★ 动态 import：`index_freshness` 依赖面很宽，这里只在真的陈旧时用一次
      const { ensureFreshIndex } = await import('../../../infrastructure/index/index_freshness.js');
      await ensureFreshIndex(db, root);
    }
    // ★★ #188 时序根因修：判定前用唯一权威 `indexCoversDiskEx` 复核整库是否覆盖磁盘。
    //   不完整 ⇒ 同步 `backfillChunk` 补齐一轮（复用 backfill 路径，非二次探测 retry 补丁），
    //   再复核；仍不覆盖 / 校验读不出 ⇒ `covers=false`，由判定循环对边表类判据 fail-closed。
    //   #188 补观测：累计 backfill 各批 synced/failed/remaining/total，终态落 walkCount/filesCount/error。
    phase = 'covers-check';
    const { indexCoversDiskEx, indexedRelativeSet, freshnessScope } = await import(
      '../../../infrastructure/index/index_freshness.js'
    );
    const { backfillChunk } = await import('../../../infrastructure/index/index_backfill.js');
    let cov = indexCoversDiskEx(db, root);
    if (!cov.ok || !cov.covers) {
      // 同步补齐到覆盖为止；synced=0 停滞或 20 批护栏后退出，再复核交 fail-closed 判定。
      let guard = 0;
      while ((!cov.ok || !cov.covers) && guard++ < 20) {
        phase = 'backfill';
        const r = await backfillChunk(db, root, { batch: 2000 });
        backfill.batches++;
        backfill.synced += r.synced;
        backfill.failed += r.failed;
        backfill.remaining = r.remaining;
        backfill.total = r.total;
        cov = indexCoversDiskEx(db, root);
        if (r.remaining === 0 || r.synced === 0) break;
      }
    }
    phase = 'coverage-report';
    const scope = freshnessScope(root);
    const walkCount = scope.scope.size;
    const filesCount = indexedRelativeSet(db).size;
    // ★ 三态拆分：走查查不出 / 补齐后仍缺 / 覆盖。异常由外层 catch 兜成 backfill-error，message 不吞。
    if (!cov.ok) {
      return { covers: false, reason: 'uncoverable', missing: -1, walkCount, filesCount, backfill, covOk: false, error: cov.error };
    }
    if (!cov.covers) {
      const missing = [...scope.scope].filter((rel) => !indexedRelativeSet(db).has(rel)).length;
      return { covers: false, reason: 'uncovered', missing, walkCount, filesCount, backfill, covOk: true, error: null };
    }
    return { covers: true, reason: 'ok', missing: 0, walkCount, filesCount, backfill, covOk: true, error: null };
  } catch (e) {
    // ★ 异常 message + 阶段 + 栈首帧不再静默吞：落回执取证，供 CI windows 归因定位抛锁帧。
    const err = e as Error;
    const stack = err && err.stack ? String(err.stack).split('\n').slice(0, 4).join('\n') : null;
    return {
      covers: false,
      reason: 'backfill-error',
      missing: -1,
      walkCount: -1,
      filesCount: -1,
      backfill,
      covOk: false,
      phase,
      error: err && err.message ? err.message : String(e),
      errorStack: stack,
    };
  }
}

/**
 * ★★★ T-19（2026-11-06）：给 `run` 判据造**只读事实门面** —— 先保鲜、后判。
 *
 * ## 为什么 `run` 类判据得自己保鲜（既有的 `ensureIndexFreshForJudge` 管不到它）
 * 那一位救的是「**判据自带 `path` 的文件**」（`judgedFilesOf` 只收带 `path` 的 kind）。
 * `run` 判据没有 `path`（它是个表达式，想看哪个文件只有它自己知道）⇒ 不在这份名单里。
 * 而门面回答的正是「**索引里**这个文件有哪些导出」，索引一旦落后就变成拿旧事实说绿
 * ⇒ 所以这里先 `ensureFreshIndex` 一次（**幂等**：mtime/size 先筛、`content_hash` 二道闸，
 * 没变的不重解析 —— 与 `ensureIndexFreshForJudge` 头注释里那一套是同一个理由）。
 *
 * ## 失败不掩盖
 * 保鲜失败 ⇒ **不抛**：门面随后对每个文件 `staleOf` 现比，仍不一致就返回 `ok:false`
 * ⇒ 判据判 `unsupported`（**判不了 ≠ 通过**）。与「刷新失败 ⇒ 保持 unsupported 并如实报」同一把尺。
 */
async function prepareJudgeFactsForRun(root: string): Promise<JudgeFacts> {
  // ★ 预检：**没有索引就不许造一个**。`getProjectCacheDb` 会在无索引的项目里建空 `cache.db` 并持有句柄 ⇒
  //   Windows 上临时目录的 `rmSync` 直接 EBUSY（`infrastructure/index/db.ts:129-131` 记着这笔账）；
  //   而且"判一下就给项目建了个库"本身就是副作用（`run` 只许读 + 判）。
  if (!fs.existsSync(projectCacheDbPath(root))) {
    return createJudgeFacts(root, {
      db: null,
      staleOf: () =>
        '该项目还没有符号索引（`.agent-io/cache.db` 不存在）⇒ 判不了；修法：跑一次 `import_project`',
    });
  }
  try {
    // ★ 动态 import：`index_freshness` 依赖面很宽，只有在真有 `run` 判据时才碰它
    const { ensureFreshIndex } = await import('../../../infrastructure/index/index_freshness.js');
    await ensureFreshIndex(getProjectCacheDb(root), root);
  } catch {
    /* 保鲜失败不掩盖：门面逐文件报 ok:false ⇒ 判不了（不是"没问题"） */
  }
  return createJudgeFacts(root, {
    db: getProjectCacheDb(root),
    staleOf: (rel) => indexStaleFor(root, [rel]),
  });
}

/**
 * ★★★ 2026-11-18（maker-checker 首卡 · **判据执行禁代码生成**）：`run.expect` 的**求值点**。
 *
 * ## 它是全仓唯一一处"把册里的文本当 JS 跑"的地方（口径不变）
 * `decision.expectations[]` 里 `kind === 'run'` 的 `expect` 是**任意 JS**，本函数是它唯一的执行核
 * （`judgeExpectations` 的 `case 'run'` 调它）。求值域 = `input / root / validateDSL / fs / path / facts`
 * —— 与 T-19 起那一套**逐字相同**，一个名字都没多、一个都没少（多给一个名字 = 多一条逃逸面）。
 * ★ 唯一例外、且是**存量实测逼出来的**：`Buffer`（3 条真判据要用，见函数内注）。
 *
 * ## 为什么从 `new Function` 换成 `vm.runInNewContext`（审计 T4 的实测逃逸）
 * 旧实现在**宿主 realm** 里 `new Function(...)`，防御全靠两张**词表**（`domain/expectation_kinds.ts`）：
 * `ENV_STATE_TOKENS`（7 条，环境态）+ `ESCAPE_TOKENS`（4 条，逃逸面）。T4 用**一行**把两张表一起绕过：
 *
 * ```js
 * (()=>{const F=(function(){}).constructor;const g=F("return this")();
 *   return typeof g["pro"+"cess"]!=="undefined"})()
 * ```
 *
 * · `.constructor` 后面**不跟 `(`** ⇒ 不命中 `.constructor(`、也不命中 `.constructor.constructor`；
 * · `"pro"+"cess"` 是两段字符串相加 ⇒ 不命中 `\bprocess\b`；
 * ⇒ 判据**真的执行了**，`g.process` 就是本进程（实测读到 `v22.18.0`）
 *   ⇒ **`READ_ONLY_FS` 那道结构防御整个白做**：只读白名单管的是"注入的 `fs` 上有没有写函数"，
 *     而它拿到的是 `process`。
 * ★ 定性（与审计一致）：这不是"词表漏了一条"，是**词法路线的结构上限** —— 要挡"先把构造器拼出来、
 *   再调用"必须做数据流分析，那正是本仓自己判定为"最贵的假精确"的东西。⇒ **正解不是加词，是换结构。**
 *
 * ## 结构层的牙在哪（**本仓自己的先例**，不是外部发明）
 * `infrastructure/parse/kernel.ts` 求值"被分析项目源码里的常量表达式"时**早就换过这条路**：
 * `vm.runInNewContext(expr, sandbox, { timeout: 50, contextCodeGeneration: { strings: false, wasm: false } })`
 * （那个函数头注把边界写全了）。四道牙：
 * · `contextCodeGeneration: { strings: false, wasm: false }` ⇒ **该 realm 里 `new Function` / `eval` /
 *   `Function(...)` 一律抛 `EvalError: Code generation from strings disallowed for this context`**
 *   ⇒ 逃逸链在**"从字符串造函数"那一步**就断：判据拿不到 `process`，`READ_ONLY_FS` 才有意义；
 * · **白名单 globals**：沙箱对象上只有那 6 个名字 + `Buffer` ⇒ 没有 `require` / `process` / `module`；
 * · `timeout`（3s，取值凭据见常量注）⇒ 挡住 `while (true)`（旧实现里一条死循环 = `judge-all` 整个挂住）；
 * · **一条判据一个新 realm** ⇒ 判据之间不再共享宿主全局（旧实现里前一条判据能给后一条留后门）。
 *
 * ## 与旧实现的行为差异（逐条，宁少不多）
 * ① 包一层 `(function () { "use strict"; return (…); })()`：`runInNewContext` 跑的是**脚本**，
 *    脚本顶层不许 `return` ⇒ 必须包成函数体。包的是**普通函数 + 普通调用**（不是箭头函数），
 *    严格模式下 `this` 仍是 `undefined`、`arguments` 仍是空 ⇒ 与 `new Function` 的语义**逐字相同**；
 * ② 语法坏 ⇒ 仍抛 `SyntaxError`（编译期抛），调用方照旧判 `unsupported`；
 * ③ 表达式抛的任何错照旧原样冒到 `case 'run'` 的 catch（口径不变：**判不了 ≠ 违反**）；
 * ④ 唯一的**新增**拒绝面：**任何"从字符串生成代码"的写法**（`new Function` / `eval` / `Function(...)`，
 *    含 `constructor.constructor(...)` 这类两级链）从"能跑"变成"抛 EvalError ⇒ unsupported"。
 *    存量 **246 条** `run` 判据（三册实测计数）**一条都没有这种写法** —— `judge-all` 全量读数
 *    逐条不变即证（826 条判过 / 825 pass / 1 unsupported，改前改后同一条同一条报文）。
 *
 * ## 边界（0.17①：这一层管什么、不管什么 —— 不冒充"根治了全部逃逸面"）
 * · **管**：判据 realm 内的代码生成 ⇒ T4 那一族**整类**（不止那条探针）。
 * · **不管**：`vm` 官方明说它**不是安全沙箱**。若判据能拿到**宿主 realm 的对象**
 *   （注入的 `input`、`facts.exportedApisOf(...)` 的返回值、`fs.readFileSync` 抛出的 `Error`），
 *   它们的 `.constructor` 就是**宿主**的 `Function`，那一层不受 `contextCodeGeneration` 约束。
 *   ⇒ 这一档仍由**第一层词表**（`ESCAPE_TOKENS`）兜着（它的价值正是"报错更友好 + 拦常见拼法"）。
 *   要把它也变成结构，得换**独立 realm/进程**边界（`worker_threads` +
 *   `execArgv: ['--disallow-code-generation-from-strings']`，或独立进程 + seccomp）—— **那是另一张卡**。
 *   本条如实记账：**结构层关掉了一整类，边界内剩下的那档有名字、有验证、有下一步。**
 */
export interface RunEvalScope {
  input: unknown;
  root: string;
  validateDSL: unknown;
  fs: unknown;
  path: unknown;
  facts: unknown;
}

/**
 * `run.expect` 的求值超时（ms）。★ **只挡死循环，不是预算**。
 *
 * 取值凭据（沙箱实测，2026-11-18；分母 = 三册 246 条 `run` 判据）：
 * · 最慢的一条**普通**判据 **39ms**（`gate_error` 那条：读文件 + 数数）；
 * · 最慢的一条**跨 realm** 判据 **≈130ms**（`project_actual_fields` 的【派生没漏】：在判据 realm 里
 *   `JSON.parse` 三册 4.8MB + 逐 719 个文件问 `facts` × 3 次连测 118/128/134ms）；
 *   ★ 跨 realm 的代价主要在大字符串拷贝 —— 这条判据改前（宿主 `new Function`）只要 14ms。
 * · 第一版取 **100ms**，当场把上面那条打成 `Script execution timed out after 100ms`
 *   ⇒ `judge-all` 读数从 **825 pass** 掉到 **822 pass**（回归段有读数）。**100ms 是错的**：
 *   它不是"富余"，是把真判据打断。
 * · 现在取 **3s ≈ 最慢那条的 23 倍**。它要挡的是 `while (true)` / 深递归 ——
 *   改前一条死循环能把 `judge-all` 整个挂住（没有超时这回事）。
 * ★ 真需要 >3s 的判据应当换 `behavior-cases`（跑真进程）或拆小 —— 与"读数别进判据"同源。
 * ★ 注：`facts` 的保鲜/开库不在这 3s 里（它发生在求值**之前**，由 `prepareJudgeFactsForRun` 负责）。
 */
export const RUN_EXPECT_TIMEOUT_MS = 3000;

/**
 * 求一条 `run.expect` 的布尔值（**故意不 catch**：语法坏 / 抛错 / 超时 / 想生成代码，全由调用方分四态）。
 * ★ 只做求值，不做判定 —— "true 才算过" 仍由 `case 'run'` 说（一处权威）。
 */
export function evalRunExpect(expect: string, scope: RunEvalScope): unknown {
  const code = `(function () { "use strict"; return (${expect}); })()`;

  // ★★★ B1：**先尝试隔离 worker**（flag 进程，所有 realm 禁代码生成）。
  //   `validateDSL` 依赖 Ajv JIT（new Function），在 flag 进程里 import 即抛 ⇒ 这类判据走 vm 回退
  //   （显式记降级原因，读端可见）。其余判据（含 E1/E2/E4 探针）全在 worker 里跑。
  if (!/\bvalidateDSL\b/.test(expect)) {
    clearCriteriaPoolDegraded();
    const job: RunEvalJob = { code, ctx: { root: scope.root as string, input: scope.input }, timeoutMs: RUN_EXPECT_TIMEOUT_MS };
    const out = evaluateInIsolation([job]);
    if (out && out.degraded) {
      // worker 起不来 ⇒ 回落 vm，并在报告层显式标记（能力降级声明）
      degradedReason = out.degraded;
    } else if (out && out.results.length === 1) {
      const r = out.results[0];
      if (r.ok) return r.value;
      // 把 worker 回传的错误**重建成宿主 Error**（保留 name + message，分类器照旧认）
      const e = new Error(r.error?.message ?? String(r.error));
      e.name = r.error?.name ?? 'Error';
      throw e;
    }
  } else {
    degradedReason = 'validateDSL 依赖 Ajv JIT（new Function），隔离 worker 的 flag 进程禁代码生成 ⇒ 本条走 vm 回退（能力降级）';
  }

  // ★ 回退路径（与 B1 前逐字相同）：vm.runInNewContext + contextCodeGeneration。
  //   沙箱对象 = 求值域：**只有这几个名字**，且用 `Object.create(null)`（连原型链都不给）
  const sandbox: Record<string, unknown> = Object.create(null);
  sandbox.input = scope.input;
  sandbox.root = scope.root;
  sandbox.validateDSL = scope.validateDSL;
  sandbox.fs = scope.fs;
  sandbox.path = scope.path;
  sandbox.facts = scope.facts;
  // ★★ 唯一一个**不在**原 6 名里、但存量判据真的要用的全局：`Buffer`（3 条，全在
  //   `file_src_application_plumbing_ts` 上；`Buffer` 是 Node 全局，**不在** vm realm 的 JS 内建里）。
  //   ⇒ 不给它 = 把三条真判据打成 `Buffer is not defined`（判不了）。给了也不新增一类风险：
  //   `fs` / `path` / `facts` 本来就是宿主对象，"宿主对象可达"这条边界早就写在头注里了。
  //   ★ 存量实测扫过一遍（246 条 `run` 判据 × 30 个 Node 全局名）：除 `Buffer` 外**一个都没用到**。
  sandbox.Buffer = Buffer;
  return vm.runInNewContext(code, sandbox, {
    filename: 'run.expect',
    timeout: RUN_EXPECT_TIMEOUT_MS,
    // ★★★ 这一行就是"牙"：该 realm 内**禁止从字符串生成代码**（`new Function` / `eval` / `Function`）
    contextCodeGeneration: { strings: false, wasm: false },
  });
}

/** 最近一次 `evalRunExpect` 的降级原因（空串 = 没降级）；报告层把它打出来（能力降级声明） */
let degradedReason = '';
export function criteriaEvalDegradedReason(): string {
  return degradedReason || criteriaPoolDegradedReason();
}

/**
 * 这个错误是不是"判据想生成代码，被结构层拒了"？（{@link evalRunExpect} 的 `EvalError` 档）
 *
 * ★ 为什么**鸭子判型**而不是 `instanceof Error`：V8 抛的是**判据 realm** 的 `EvalError`
 *   ⇒ 它与宿主的 `Error` **不是同一个构造器**，`err instanceof Error` 实测为 **false**
 *   （`vm` 跨 realm 的固有形状，不是缺陷）。所以只认 `name + message`，不认构造器身份。
 * ★ 只认**一条**更窄的形态（`strings: false` 的固定报文）⇒ 不会把"判据自己 throw 了一个 EvalError"
 *   也归到这一档（那类应当落到通用"表达式抛错"的报文里）。
 */
export function isCodeGenerationRefused(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null;
  return (
    !!e &&
    e.name === 'EvalError' &&
    typeof e.message === 'string' &&
    /code generation from strings disallowed/i.test(e.message)
  );
}

/** 该文件的**依赖事实是否完整**（不完整 ⇒ 与依赖有关的检查一律判不了） */
function depFactsIncomplete(root: string, relPath: string): string | null {
  const facts = fileFacts(root, relPath);
  if (facts.source === null) return `该文件在本项目的符号索引里读不到（无 cache.db 命中）⇒ 事实取不到，判不了`;
  let raw: Array<{ kind: string; type_only: boolean }> = [];
  try {
    raw = getRawImportsOfFile(getProjectCacheDb(root), relPath);
  } catch (e) {
    return `读原始 import 记录失败（${(e as Error).message}）⇒ 判不了`;
  }
  const pkg = raw.filter((r) => r.kind !== 'relative' && !r.type_only);
  if (pkg.length) {
    // ★★★ T257（2026-10-14）：**TS/JS 的裸导入是【外部包】，不构成"仓内边可能漏记"** ——
    //   本仓（以及 TS/JS 生态）的**仓内引用走 relative 说明符**，而依赖边表记的正是它
    //   （`infrastructure/index/symbols.ts:388`）；裸导入（`node:path` / `@scope/pkg`）
    //   **没有仓内目标** ⇒ 它**不会**让"仓内两个文件之间的边"漏记。
    //   ★ 原实现把**任何**非相对 import 都算"事实不完整"（注释只提"Go/Python 的包导入"），
    //     实测后果（T257）：**真实 TS 文件几乎都有包导入** ⇒ `edge-exists` / `edge-absent`
    //     **恒 unsupported** ⇒ 6 种可判形状里有 **2 种对 TS 仓没有可用面**。
    //   ★ 已知限度（如实声明）：若项目配了 `tsconfig.paths` 别名（`@/x` → `src/x`），裸导入
    //     **可能**指向仓内 ⇒ 那时本判据**偏乐观**。当前本仓**未配 paths**，故不触发。
    const isTsJs = (TS_JS_EXTS as readonly string[]).includes(path.extname(relPath).toLowerCase());
    if (!isTsJs) {
      return (
        `该文件含 **${pkg.length} 条非相对导入**（Go/Python 的包导入等），而依赖边表按设计**只记 relative**` +
        `（\`infrastructure/index/symbols.ts:388\`）⇒ **依赖事实不完整，判不了**（不拿"没查到"冒充"不存在"）`
      );
    }
  }
  return null;
}

/**
 * ★ symbol-exists / signature-matches 的**判定核**（2026-10-24 从 judgeExpectations 原样抽出 ——
 *   缓存通道与直算通道共用同一份逻辑，不许判据住两处）。返回而不 push；详细判据注释见函数体内。
 */
async function judgeSymbolOrSignature(
  root: string,
  e: Extract<Expectation, { kind: 'symbol-exists' | 'signature-matches' }>,
): Promise<{ verdict: Verdict; detail: string }> {
  const p = normPath(e.path);
  const abs = path.join(root, p);
  if (!fs.existsSync(abs)) {
    return { verdict: 'fail', detail: `${p} **不存在**（查的是 ${abs}）` };
  }
  if (!isSupportedFile(p)) {
    return {
      verdict: 'unsupported',
      detail: `${p} 的扩展名不走 TS/JS 解析器 ⇒ **符号事实取不到，判不了**（不拿“取不到”冒充“没有”）`,
    };
  }
  // ★★★ 现读现解析：**不许**用 `fileFacts`（索引）—— 出生证证明过它会假绿。
  //   证据：把源码里的 mul 删掉后，`consistency_check`（现解析）已报 missing:1，
  //   而用 fileFacts 的初版仍报“✅ 有 mul” ⇒ **拿索引冒充代码**。
  const content = fs.readFileSync(abs, 'utf-8');
  const syms = await parseFile(p, content);
  // ★★★ T258（2026-10-14）：**这里原先按 kind 过滤，只认 `function | method`** ——
  //   实测后果：`const` / `type` / `interface` / 接口字段类断言**结构上无法表达**
  //   （`parseFile` 把 `const`/`arrow const` 判成 `const`/`type`，`interface`/`type` 判成
  //   `interface`/`type`）⇒ 取不到 ⇒ 判 **fail**。
  //   ★★ 那是**误报**：把“**我表达不了**”读成“**代码里没有**” —— 比 unsupported 更坏
  //   （unsupported 至少诚实；误报会让人去改没坏的东西）。实测至少 4 张决策卡死于此
  //   （`arc_6` 的 const / `tcc_6` 的接口字段 / `tcc_9` 的 type / `tcc_3` 的类型本体）。
  //   ⇒ 现在**不按 kind 过滤**：问的是“**这个符号在不在**”，就不该替调用方挑 kind。
  const hit = syms.find((s) => s.name === e.symbol || s.qualified_name === e.symbol);
  if (!hit) {
    // ★ 提示也**不再过滤** —— 否则“现取到 N 个”会漏报 const/type，把读者引向错的方向。
    const names = syms.map((s) => s.name);
    return {
      verdict: 'fail',
      detail:
        `${p}（**现解析**）里**没有符号** \`${e.symbol}\`；现取到 ${names.length} 个：` +
        `${names.slice(0, 6).join(', ')}${names.length > 6 ? ' …' : ''}`,
    };
  }
  if (e.kind === 'symbol-exists') {
    return { verdict: 'pass', detail: `${p}（现解析）有 \`${hit.name}\`（L${hit.start_line}-${hit.end_line}）` };
  }
  const got = hit.signature ?? '';
  const ok = normSignature(got) === normSignature(e.signature);
  return {
    verdict: ok ? 'pass' : 'fail',
    detail: ok
      ? `${p} 的 \`${hit.name}\` 签名与期望一致`
      : `${p} 的 \`${hit.name}\` **签名不符**：期望 \`${e.signature}\`，实取 \`${got || '（无签名）'}\``,
  };
}

/**
 * ★★★ 2026-11-05（R5 / subagent:r5-needle）：**`source-has` 到底匹配哪份文本 —— 唯一一处**。
 *
 * ## 为什么必须是一个入口（不是「判据里一段、测试里一段」）
 * 判「这根针有没有鉴别力」的量具（`domain/needle_power.ts`）与它的检测点必须先拿到**判据实际匹配的那份文本**：
 * 拿原文去量，一条只住在**注释**里的针会被数成「实体行」⇒ 量具报 blind:false，而判据根本不看注释 ⇒ **假绿**。
 * 而三档分派本身（`includeComments` / 代码扩展名 / 其它）只有一个住所 —— 这里。抄一份到测试里就等于
 * 「判据看哪份文本」有两处答案（0.9.1）。
 *
 * ## 三档（每一档都要能说清为什么）
 * · `includeComments: true` ⇒ **原文**：断的**就是**注释里的标记（`@authority` 那类），剥了就永远断言不到；
 * · **代码扩展名** ⇒ 按 **AST 注释区间**剥；
 * · **其它**（`.md` / `.json`）⇒ **原文**（它们的 `//source` / `//` 不是注释）。
 *
 * ## `null` 必须是一档可区分的失败（0.9.4 第 1 行）
 * `stripCommentsSync` 的 `null` = **没查成**（parser 未预热 / 该扩展名不支持），**不是**「没有注释」。
 * 沿用原文 = 把「没剥」当「剥过」⇒ 注释里的串照样命中 ⇒ 假绿只是换了一层皮。所以返回 `{ok:false}`，
 * 由调用方（判据执行核 / 量具）各自决定怎么报 —— 但**不许**在这里退回原文。
 */
export type SourceHasTextResult =
  | { ok: true; text: string; mode: string }
  | { ok: false; detail: string };

export async function sourceHasTextOf(
  relPath: string,
  src: string,
  includeComments?: boolean,
): Promise<SourceHasTextResult> {
  const p = normPath(relPath);
  const raw = String(src ?? '');
  if (includeComments === true) return { ok: true, text: raw, mode: '原文（includeComments）' };
  if (!isCodeText(p)) return { ok: true, text: raw, mode: '原文（非代码扩展名）' };
  // ★ 幂等预热：本判据的前提就是「解析器必须就绪」，不预热则下面必然 null（实测 111/121）。
  await prewarmKernel();
  const stripped = stripCommentsSync(p, raw);
  if (stripped === null) {
    return {
      ok: false,
      detail:
        `${p}：取不到 **AST 注释区间**（parser 未就绪 / 该扩展名不支持）⇒ **判不了**。` +
        '★ 不许退回原文：那会把"没剥"当成"剥过"，注释里的串照样命中 ⇒ 假绿（0.9.4 第 1 行）。',
    };
  }
  return { ok: true, text: stripped, mode: '剥注释' };
}

/**
 * ★ source-has 的**判定核**（同上，从 judgeExpectations 原样抽出 —— 2026-10-19 源码文本判据：不装 input）
 *
 * ★★★ 2026-11-04（subagent:text-has-fix）：**剥注释搬到这里**（原来是 `domain/text_strip.ts` 的手写状态机）。
 *
 * ## 为什么必须搬（实测代价）
 * 手写状态机在**带引号的正则字面量**上失步（`detect_dead_imports.ts` 的 `/^import\s+['"]/`：引号在
 * 字符类里，被当成字符串开始）⇒ 67 个代码目标里 **9 个漏剥**（13%）。漏剥的方向是**变宽**
 * （注释里的串也算命中）⇒ **白送绿**，而读数上完全看不出来。
 * ★ 为什么不能留在 domain 修：domain 不许引 infrastructure，而 AST 注释区间权威
 * （`infrastructure/parse/comments.ts`）住在 infrastructure ⇒ 当初"为了不改调用方"才写了第二份手写实现
 * —— 那不是理由，那是 0.9.1（一处权威）的违规现场。现在：**application 剥，domain 只做纯比较**。
 *
 * ## 三档分派（每一档都要能说清为什么）
 * · `includeComments: true` ⇒ **原文**。断的**就是注释里的标记**（`@authority` / `@authority-via` 由
 *   `scan_authorities.ts#parseAuthorityMarks` 逐行扫注释行得到）⇒ 剥了它就永远断言不到；
 *   这是"kind 与对象不匹配"，不是"判据写错"⇒ 用开关如实表达，且 `why` 必须写出理由（写入时硬拒）。
 * · **代码扩展名** ⇒ 按 **AST 注释区间**剥；
 * · **其它**（`.md` / `.json`）⇒ **原文**（它们的 `//source` / `//` 不是注释；统一剥会把文档判据吃掉）。
 *
 * ## 为什么 `null` 必须判 `unsupported`（0.9.4 第 1 行：读取失败必须报错，不许当"没有"）
 * `stripCommentsSync` 的 `null` = **没查成**（parser 未预热 / 该扩展名不支持），**不是**"没有注释"。
 * 沿用原文 = 把"没剥"当"剥过"⇒ 注释里的串照样命中 ⇒ **假绿只是换了一层皮**。
 * ★ 实证：探针第一版没预热 kernel ⇒ 111/121 个文件返回 null；若沿用原文，读数会假装"0 条变红"。
 * ⇒ 所以这里**先 `await prewarmKernel()`**（幂等），剥不掉就**说"判不了"**，绝不退回原文。
 */
async function judgeSourceHas(
  root: string,
  e: Extract<Expectation, { kind: 'source-has' }>,
): Promise<{ verdict: Verdict; detail: string }> {
  const p = normPath(e.path);
  const abs = path.join(root, p);
  if (!fs.existsSync(abs)) {
    return { verdict: 'fail', detail: `${p} **不存在**（查的是 ${abs}）` };
  }
  const src = fs.readFileSync(abs, 'utf-8');
  // ★ 2026-11-05（R5）：三档分派搬进 `sourceHasTextOf`（本文件导出）—— 量具与检测点要拿
  //   「判据实际匹配的那份文本」；抄一份分派就等于让「判据看哪份文本」有两处答案。
  const got = await sourceHasTextOf(p, src, e.includeComments);
  if (!got.ok) return { verdict: 'unsupported', detail: got.detail };
  const text = got.text;
  const mode = got.mode;
  // ★ 唯一匹配核：纯 includes（剥没剥已在上面定死）。不许在这里再写一套（判据一处）
  const { missMust, hitMustNot } = matchSourceHas(text, e.must ?? [], e.mustNot ?? []);
  if (missMust.length || hitMustNot.length) {
    const parts = [];
    if (missMust.length) parts.push(`缺 must：${missMust.map((t) => JSON.stringify(t.slice(0, 40))).join(' / ')}`);
    if (hitMustNot.length) parts.push(`命中 mustNot：${hitMustNot.map((t) => JSON.stringify(t.slice(0, 40))).join(' / ')}`);
    return { verdict: 'fail', detail: `${parts.join('；')}（匹配文本：${mode}）` };
  }
  return {
    verdict: 'pass',
    detail: `${p}：must ${(e.must ?? []).length} 全在 / mustNot ${(e.mustNot ?? []).length} 全无（匹配文本：${mode}）`,
  };
}

/**
 * 运行时判据的**证据门**（`case 'runtime'` 里"有没有证据"的**唯一**判定）。
 *
 * 不变量：**没有 verdict 就没有证据** ⇒ 一律 `unsupported`（判不了 ≠ 通过）。
 * 为什么必须只判一处：`expect='absent'` 与其余 expect 曾各判一次 —— absent 那支把「0 条 verdict」
 * 读成「符合预期：不许出现」，非 absent 支对**同一情形**读成「没跑到 / 没插桩 ⇒ 判不了」
 * ⇒ 同一个问题两种口径，后果是**探针名写错 / 没插桩时 absent 假绿**。
 * ★ 代价（如实写下）：`absent` 从此**不能靠"没有记录"成立** —— 要判它成立，必须有一条
 *   "该规则被评过"的记录；没有记录只能判 unsupported。宁可少一个 pass，也不要一个能由空集冒充的 pass。
 */
function runtimeNoEvidenceDetailOf(
  want: 'ok' | 'deviation' | 'absent',
  verdictCount: number,
  selLabel: string,
): string | null {
  if (verdictCount > 0) return null;
  return (
    `${selLabel} 在这批事件里没有记录 ⇒ 判不了（**没有 verdict ⇒ 没有证据**，不是 "absent 成立"；` +
    `可能是没跑到 / 没插桩 / 探针名写错 —— 空 ≠ 没问题）` +
    (want === 'absent' ? '。★ 要判 absent 成立，必须有一条"这条规则/探针被评过"的记录' : '')
  );
}

/** 逐条判定（★ `async`：符号走**现解析**；不写盘） ★ 见文件头纪律 1 —— 不许用索引冒充代码 */
/**
 * **「预期抛错」的唯一口径**（`expect` 以 `throws:` 开头）。
 *
 * ## 它修的是哪条待办
 * `docs/todo.md#T-#BEHAVIOR-CASES-CANT-EXPRESS-THROW`：修法原文「给 `behavior-cases` 的 `expect`
 * 增加一个**显式的抛出口径**（如 `{throws: {code?, messageIncludes?}}`），并让 harness 区分
 * "预期抛"与"意外抛"」。本函数就是那条修法，口径取 `messageIncludes` 一档。
 *
 * ## 三态（`not-throws` 不在本函数判：那是原有精确比较的地盘）
 * · `match` —— 期望抛错，且错误文本**含**给定子串 ⇒ 这一 case 是**正确行为**；
 * · `mismatch` —— 期望抛错，但文本不含（或子串为空）⇒ 行为不符；
 * · `not-throws` —— 这条 `expect` 不是抛出口径 ⇒ 调用方走原来的精确 repr 比较。
 *
 * ## 为什么空子串必须判 `mismatch`
 * `'throws:'`（冒号后什么都不写）若被当成"只要抛了就算过"，就把"必须抛且说清原因"降级成
 * "必须抛"，**任意抛错都能过** —— 那是把判据放宽成恒绿。
 */
export type ThrowsExpectation =
  | { kind: 'not-throws' }
  | { kind: 'match'; includes: string }
  | { kind: 'mismatch'; includes: string };

const THROWS_PREFIX = 'throws:';

export function classifyThrowsExpectation(expect: unknown, errorText: string): ThrowsExpectation {
  if (typeof expect !== 'string' || !expect.startsWith(THROWS_PREFIX)) return { kind: 'not-throws' };
  const includes = expect.slice(THROWS_PREFIX.length);
  if (includes === '') return { kind: 'mismatch', includes };
  return errorText.includes(includes) ? { kind: 'match', includes } : { kind: 'mismatch', includes };
}

/** `behavior-cases` 一档的**执行结果**（贵的那一半）。判定仍在 `judgeExpectations` 里唯一一处。 */
type BehaviorExec =
  | { kind: 'missing'; abs: string }
  | { kind: 'mixed' }
  | { kind: 'legacy'; run: BehaviorRun }
  | { kind: 'cases'; results: CaseRunResult[] };

/** 池子降级只提示**一次**（0.12：不许静默变慢；也不许每次判据刷一行） */
let poolFallbackWarned = false;
function notePoolFallback(reason: string): void {
  if (poolFallbackWarned) return;
  // ★ 串行度 ≤ 1 是**刻意**的运行模式（消融 / 排障），不是降级 ⇒ 不出声
  if (/并发度 ≤ 1/.test(reason)) return;
  if (/池已关闭/.test(reason)) return;
  poolFallbackWarned = true;
  process.stderr.write(`[judge] behavior-cases 并行执行降级为串行（结论不变，只是慢）：${reason}\n`);
}

/**
 * 跑一条 `behavior-cases` 的**执行侧**：夹具建盘 + 起子进程 + 收 JSON。**不做任何判定**。
 *
 * ## 为什么把它单拎出来（2026-11-17 · P0「全量 <30s」）
 * 判定（四态 / detail 文案 / `throws:` 口径）与执行是两件事，但过去挨在一起 ⇒ 只能一条一条串着跑。
 * 拆开之后，「执行」可以并发铺开（`judgeExpectations` 开头按整册预取），「判定」仍按**原顺序**
 * 在主线程做 ⇒ 回执的**顺序与内容都不变**，变的只有墙钟。
 *
 * ★ 池子不可用时**就地**跑同一个执行核（`runHarness` / `runCaseProgram`）—— 这不是第二条判定路，
 *   是同一个执行核的串行调用（降级要响，但降级不许改结论）。
 */
async function executeBehaviorCases(
  root: string,
  e: Extract<Expectation, { kind: 'behavior-cases' }>,
): Promise<BehaviorExec> {
  const p = normPath(e.path);
  const abs = path.join(root, p);
  if (!fs.existsSync(abs)) return { kind: 'missing', abs };
  // ★★ 2026-11-09（契约形态扩展）：出现 steps / ctor / effects / budget 任一 ⇒ 走 `runCaseProgram`
  //   **旧形态（只有 given/expect）逐字不变**，仍走 `runHarness`。
  //   混用两种形态 ⇒ 明确拒绝（拆成两条契约），不做索引映射的猜测。
  if (e.cases.some((c) => isCaseProgram(c))) {
    if (!e.cases.every((c) => isCaseProgram(c))) return { kind: 'mixed' };
    const viaPool = await submitBehaviorJob({
      kind: 'cases',
      input: { projectRoot: root, file: p, symbol: e.symbol, cases: e.cases as unknown[] },
    });
    if (viaPool.ok) return { kind: 'cases', results: (viaPool.value as { results: CaseRunResult[] }).results };
    notePoolFallback(viaPool.error);
    const results: CaseRunResult[] = [];
    for (const c of e.cases) {
      results.push(await runCaseProgram({ projectRoot: root, file: p, symbol: e.symbol, testCase: c as never }));
    }
    return { kind: 'cases', results };
  }
  const spec: BehaviorSpec = {
    project_dir: root,
    file: p,
    function: e.symbol,
    cases: (e.cases as Array<{ given: unknown[]; expect: string }>).map((c, i) => ({ name: `case-${i + 1}`, args: c.given })),
  };
  const viaPool = await submitBehaviorJob({ kind: 'harness', spec });
  if (viaPool.ok) return { kind: 'legacy', run: (viaPool.value as { run: BehaviorRun }).run };
  notePoolFallback(viaPool.error);
  return { kind: 'legacy', run: runHarness(spec) };
}

/**
 * 把「执行结果」变成**判定**（四态 + 一行原因）。★ 口径逐字沿用 2026-10-24 / 11-07 / 11-09 那三段的原文：
 * 进程级失败 ⇒ `unsupported`（"判不了"不冒充"错"）；比对不过 ⇒ `fail`；全过 ⇒ `pass` 且带分母。
 */
function verdictOfBehaviorExec(
  e: Extract<Expectation, { kind: 'behavior-cases' }>,
  exec: BehaviorExec,
): { verdict: Verdict; detail: string } {
  const p = normPath(e.path);
  if (exec.kind === 'missing') return { verdict: 'fail', detail: `${p} **不存在**（查的是 ${exec.abs}）` };
  if (exec.kind === 'mixed') {
    return { verdict: 'fail', detail: `同一契约里混用了旧形态与 steps/effects 形态（${p}#${e.symbol}）⇒ 拆成两条契约` };
  }
  if (exec.kind === 'cases') {
    const badCases: string[] = [];
    let unsupportedWhy: string | null = null;
    for (let i = 0; i < exec.results.length; i++) {
      const r = exec.results[i];
      if (r.status === 'unsupported') {
        unsupportedWhy = `case-${i + 1}：${r.detail[0] ?? '判不了'}`;
        break;
      }
      if (r.status === 'fail') badCases.push(`case-${i + 1}${r.at ? ' ' + r.at : ''}：${r.detail[0] ?? ''}`);
    }
    if (unsupportedWhy) return { verdict: 'unsupported', detail: `行为基线跑不了 ⇒ 判不了：${unsupportedWhy}` };
    if (badCases.length > 0) {
      return { verdict: 'fail', detail: `行为差异 ${badCases.length}/${e.cases.length}：${badCases[0]}` };
    }
    return {
      verdict: 'pass',
      detail: `${e.cases.length}/${e.cases.length} case 通过（${p} 的 \`${e.symbol}\` 经 steps/effects 执行核现跑）`,
    };
  }
  const run = exec.run;
  if (run.error) {
    // 进程级失败（工具链缺失 / 加载失败 / 顶层函数缺失）⇒ "判不了"不冒充"错"
    return { verdict: 'unsupported', detail: `行为基线跑不了 ⇒ 判不了：${run.error}` };
  }
  // expect 是裸串（"f(a,b)"），harness 的 ret 是规范化 repr（字符串带引号）⇒ 对齐后再比
  const shown = (ret: string): string => {
    try {
      const v: unknown = JSON.parse(ret);
      return typeof v === 'string' ? v : JSON.stringify(v);
    } catch {
      return ret;
    }
  };
  const legacyCases = e.cases as Array<{ given: unknown[]; expect: string }>;
  const bad: string[] = [];
  for (let i = 0; i < legacyCases.length; i++) {
    const c = legacyCases[i];
    const r = run.results.find((x) => x.case === `case-${i + 1}`);
    if (!r) {
      bad.push(`case-${i + 1}（输入 ${JSON.stringify(c.given)}）harness 未产出该 case`);
      continue;
    }
    // ★★ 2026-11-07：`expect` 以 `throws:` 开头 ⇒ **抛错才是正确行为**（口径在 `classifyThrowsExpectation`）。
    //   说好要抛却正常返回 ⇒ 走下面的精确比较 ⇒ 必然 fail（前缀不会让它恒绿）。
    if (!r.ok) {
      const t = classifyThrowsExpectation(c.expect, String(r.error ?? ''));
      if (t.kind === 'match') continue;
      bad.push(
        `case-${i + 1} 输入 ${JSON.stringify(c.given)}：**抛错** ${r.error}` +
          (t.kind === 'mismatch' ? `（期望抛错含 \`${t.includes}\`）` : ''),
      );
      continue;
    }
    if (!sameBehaviorRet(r.ret ?? '', c.expect)) {
      bad.push(`case-${i + 1} 输入 ${JSON.stringify(c.given)}：期望 \`${c.expect}\`，实得 \`${shown(r.ret ?? '')}\``);
    }
  }
  if (bad.length > 0) return { verdict: 'fail', detail: `行为差异 ${bad.length}/${e.cases.length}：${bad[0]}` };
  return {
    verdict: 'pass',
    detail: `${e.cases.length}/${e.cases.length} case 一致（${p} 的 \`${e.symbol}\` 经金丝雀 harness 现跑）`,
  };
}

export async function judgeExpectations(
  root: string,
  items: readonly JudgeItem[],
): Promise<ExpectationsReport> {
  // ★★★ 2026-10-31（兜底告警，**不是门**）：判定开始前先看一眼"索引是不是落后于磁盘"。
  //   ★ 顺序**必须**在 `ensureIndexFreshForJudge` **之前** —— 它会把索引修好，之后再看就永远"不落后"，
  //     告警也就变成了永远不说。
  const judgedFiles = judgedFilesOf(items);
  const indexBehind = countIndexBehindDisk(root, judgedFiles);
  if (indexBehind > 0) {
    process.stderr.write(
      `[judge] 索引落后于磁盘 ⇒ 本次已按磁盘现算（${indexBehind} 个文件）\n`,
    );
  }
  // ★ 先保鲜、后判（判据见 ensureIndexFreshForJudge：索引是派生数据，先修它永远安全）。
  //   #188 时序根因修：返回整库覆盖状态；未覆盖 ⇒ 边表类判据在循环里 fail-closed 拒绝判定。
  const coverage = await ensureIndexFreshForJudge(root, items);
  const indexUncovered = !coverage.covers;
  const out: ExpectationItem[] = [];
  // ★★★ P1：evidence 派生（唯一出口 push 内完成）—— verdict 参数逐字不动，只在 item 上多挂一层标注
  const evidenceOf = (it: JudgeItem): EvidenceMark => {
    // ★ DSL 上的 expectation.evidence 是 cited 的唯一写处；judge item 没显式带时回退读它，
    //   否则 documented/source-has 的 cited 永远不会进入 judge 读数（C1 两条新增判据实测）。
    const ex = it.evidence ?? ((it.expectation as { evidence?: Partial<EvidenceMark> }).evidence ?? {});
    const tier = ex.tier ?? EVIDENCE_TIER_BY_KIND[it.expectation.kind as Expectation['kind']] ?? 'assumption';
    const base: EvidenceMark = {
      tier,
      basis: ex.basis ?? (
        // ★ D1：读索引派生边的四类，basis 注明来源，不冒充"现解析源码"
        ['call-exists', 'edge-exists', 'edge-absent', 'domain-independent'].includes(it.expectation.kind)
          ? `kind 默认映射：${it.expectation.kind}（读索引派生边，新鲜由 indexStaleFor 守）`
          : `kind 默认映射：${it.expectation.kind}`
      ),
      derivedFrom: ex.tier ? 'explicit' : 'kind-default',
    };
    // ★ derivedFrom 由本处说了算，不接受外部传入覆盖（一处权威）
    return { ...base, ...ex, tier, derivedFrom: base.derivedFrom };
  };
  const push = (it: JudgeItem, verdict: Verdict, detail: string): void => {
    out.push({ ...it, verdict, detail, evidence: evidenceOf(it) });
  };

  // ★★ 2026-10-24（judge-cache 第一阶，v3 §4.9）：**一阶文件哈希缓存** —— 「没变的文件不再测」。
  //   · 只缓存 **symbol-exists / signature-matches / source-has** 三类：它们的判定只依赖**目标文件本体**
  //     （key = hash(判据内容 ‖ 目标文件内容哈希)，见 `intent/judge_cache.ts`），一阶即覆盖全部贵判定；
  //   · **不缓存**：file-exists（existsSync 便宜）/ run 与 behavior-cases（必须现跑）/ edge-* 与
  //     call-exists（事实源是**边表** —— 它的新鲜是'整个索引'的函数，不是某个文件哈希能表达的）。
  //   · 纪律 1（现读现解析）**不变**：命中的恰是"文件内容哈希没变"的文件 ⇒
  //     缓存里的判定与"此刻现解析"是同一个事实 —— 不是拿索引冒充代码。
  //
  //   ★★★ 2026-10-31（**假绿事故的修法**）：新鲜度来源 = `diskFileHash`（**判定时现读磁盘现算**），
  //   **不再**读 `cache.db` 的 `files.content_hash`。
  //   病：索引可以落后（docs/*.md 永远不在走查集合里 ⇒ 其 content_hash 永久停在 import 那一刻），
  //   而旧实现拿它当"文件变了没有"的判据 ⇒ 文件内容变了、key 没变 ⇒ **复用旧结论**。
  //   实测：`docs/GUIDE-GATE.md` 的 `**码数合计 70**` 早该红，judge 却报 pass（缓存命中）。
  //   ⇒ 索引只用于**符号解析**（symbol-exists / call-exists 的 AST 事实），
  //     缓存是否新鲜只看磁盘。文件不存在 / 读不出 ⇒ `diskFileHash` 给 null ⇒ **不缓存**，按四态现判。
  const cache = loadJudgeCache(root);
  let cacheHits = 0;
  let cacheMisses = 0;
  // ★★ T-19：`run` 判据的 facts 门面 —— **惰性**构造（第一次遇到 run 判据时才保鲜 + 开库）
  let facts: JudgeFacts | null = null;

  // ★★★ 2026-11-17（P0 · judge-all 全量 <30s）：**按整册预取 `behavior-cases` 的执行**。
  //   为什么必须"整册"而不"逐条"：主循环是 `await` 串行的，逐条并发 = 永远 1 路；
  //     `behavior-cases` 每条约 921ms（实测）且时间几乎全在**夹具建盘 + 起进程**上 ⇒ 只有整册一起铺开才吃得到多核。
  //   为什么这样不改结论：预取只决定"什么时候开始跑"，跑的是**同一份** `runHarness` / `runCaseProgram`；
  //     判定仍在本循环里**按原下标顺序**做（`behPrefetch.get(idx)`）⇒ 回执顺序、四态、detail 全部不变。
  //   注：`blocked_by` 只属于 `run` 一种 kind（进了循环会先判 `pending`）⇒ behavior-cases 没有这种待跑条目。
  const behPrefetch = new Map<number, Promise<BehaviorExec>>();
  if (judgeConcurrency() > 1) {
    for (let i = 0; i < items.length; i++) {
      const ex = items[i].expectation;
      if (ex.kind !== 'behavior-cases') continue;
      behPrefetch.set(i, executeBehaviorCases(root, ex));
    }
  }

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const e = it.expectation;
    // ── 缓存通道（只对三类贵判定；文件不存在/读不出 ⇒ 落到下面 switch 现判）──
    if (e.kind === 'symbol-exists' || e.kind === 'signature-matches' || e.kind === 'source-has') {
      const p = normPath(e.path);
      // ★ 现读磁盘（不看索引）—— 这是"缓存是否新鲜"的唯一来源
      const fileHash = diskFileHash(path.join(root, p));
      if (fileHash) {
        const key = judgeCacheKey(e, fileHash);
        const hit = cache.get(key);
        if (hit) {
          cacheHits++;
          push(it, hit.verdict, `${hit.detail}（缓存命中）`);
          continue;
        }
        cacheMisses++;
        const res = e.kind === 'source-has' ? await judgeSourceHas(root, e) : await judgeSymbolOrSignature(root, e);
        cache.set(key, { verdict: res.verdict, detail: res.detail });
        push(it, res.verdict, res.detail);
        continue;
      }
    }
    // ★★ #188 时序根因修：索引未覆盖磁盘时，边表类判据 fail-closed —— 边表事实可能缺行，
    //   "查无 ≠ 不存在"，不拿缺行边表判 pass/fail，单列 unsupported 明示（比照 V3 untrusted 不得 exit0）。
    if (indexUncovered && EDGE_TABLE_KINDS.includes(e.kind)) {
      // ★ 三态文案区分：真未覆盖 / 走查查不出 / 补齐校验异常，不混一口径、不夸大断言。
      const why =
        coverage.reason === 'uncovered'
          ? `缺 ${coverage.missing} 个文件`
          : coverage.reason === 'uncoverable'
            ? `覆盖校验读不出（${coverage.error ?? '走查范围算不出来'}）`
            : `补齐/校验异常（${coverage.error ?? '未知错误'}）`;
      push(it, 'unsupported', `索引未覆盖磁盘（${why}）⇒ 边表事实不可信，fail-closed 拒绝判定`);
      continue;
    }
    switch (e.kind) {
      case 'file-exists': {
        const p = normPath(e.path);
        const abs = path.join(root, p);
        const ok = fs.existsSync(abs);
        push(it, ok ? 'pass' : 'fail', ok ? `${p} 存在` : `${p} **不存在**（查的是 ${abs}）`);
        break;
      }
      case 'symbol-exists':
      case 'signature-matches': {
        // ★ 2026-10-24（judge-cache）：判定核抽到 judgeSymbolOrSignature —— 缓存通道与直算通道共用同一份逻辑
        const r = await judgeSymbolOrSignature(root, e);
        push(it, r.verdict, r.detail);
        break;
      }
      // ★★★ 2026-10-19：**源码文本判据**（grep 型契约的正式名字）—— 不装 input。
      // ★ 它的边界：只验"文本存在"，不懂语义；★★ 2026-11-04 起**注释默认不算命中**（按 AST 注释区间剥）。
      case 'source-has': {
        // ★ 2026-10-24（judge-cache）：判定核抽到 judgeSourceHas —— 缓存通道与直算通道共用同一份逻辑
        const r = await judgeSourceHas(root, e);
        push(it, r.verdict, r.detail);
        break;
      }
      // ★★★ 2026-10-18：**行为契约** —— 一条 run = 一个自包含的测试（input + expect 表达式）。
      //   ★ 求值域（**注入的只有这几个名字**，不是任意代码执行）：input / root / validateDSL / fs / path / facts。
      //   ★ 不建 fixtures/ 目录：input 就是夹具，内联在契约里。
      //   ★★ T-19（2026-11-06）：`fs` 从此是 **`READ_ONLY_FS`**（写能力从"文档纪律"变"结构"），
      //      `facts` 是只读符号事实门面（见 `judge_facts.ts`）—— 能力判据要写"册 vs 实际"才拿得到事实。
      //   ★★★ 2026-11-18（maker-checker 首卡）：**执行核换成 `evalRunExpect`**（禁代码生成的 vm 上下文）。
      //      旧实现 `new Function` 在宿主 realm 里跑 ⇒ 逃逸面只能靠词表，而 T4 一行就绕过去了。
      //      `READ_ONLY_FS` 是"注入面上没有写函数"，只有**拿不到 `process`** 时它才成立
      //      ⇒ 禁代码生成不是加固，是把 `READ_ONLY_FS` 的前提补上。见 `evalRunExpect` 头注。
      case 'run': {
        // ★★★ 2026-10-18：**blocked_by 优先** —— 声明的"卡在哪"比"跑出来 fail"更准。
        //   ★ 跑只会给一个误导的 fail（"断言不成立"），而真实情况是"这活还没干完"。
        if (e.blocked_by) {
          push(it, 'pending', `进行中 · 卡在：${e.blocked_by}`);
          break;
        }
        try {
          const { validateDSL } = await import('../../../domain/validator.js');
          // ★★★ 2026-10-18：求值域扩到 fs / path —— "读文件 / grep" 类债也能配 run。
          //   ★ 仍不是任意代码执行：注入的是**具体值**（fs = 只读白名单 / path / facts 门面），不是模块加载能力。
          //   ★ 纪律：run 只许【读 + 判】，不许有副作用（写盘 / 调 claimTask 这类会改状态的，别放进来）。
          //     ★ T-19 起这条**有结构兜底**：`READ_ONLY_FS` 上没有写函数 ⇒ 想写也调不到。
          const { default: pathMod } = await import('node:path');
          // ★ facts 惰性构造，且**只在判据真的用到它时**才付"保鲜 + 开库"的钱：
          //   存量 200 条 `run` 判据一条都不提 `facts` ⇒ 它们的行为与 T-19 之前**逐字相同**（不建库、不开库）。
          //   ★ 为什么嗅探是**安全**的（不是代理）：这是 JS，用到注入的名字就必须写出这个名字；
          //     绕写法（`globalThis['fa'+'cts']`）拿不到名字 ⇒ 得到 `undefined/null` ⇒ 判不了（不是放行）。
          //     ★★ 2026-11-18：这句的前提如今**站在结构上**了 —— 沙箱里没有 `process`/`require`，
          //     且**一 realm 一条判据**（前一条判据没法给后一条留后门）。
          if (/\bfacts\b/.test(e.expect)) facts ??= await prepareJudgeFactsForRun(root);
          // ★ 求值只此一处（`evalRunExpect`）；本处只做判定 —— "true 才算过"。
          const ok = Boolean(
            evalRunExpect(e.expect, {
              input: (e as { input?: unknown }).input,
              root,
              validateDSL,
              fs: READ_ONLY_FS,
              path: pathMod,
              facts,
            }),
          );
          // ★ B1：worker 起不来 / validateDSL 回退 ⇒ 报告层显式声明能力降级（不静默旁路）
          const degraded = criteriaEvalDegradedReason();
          const degradeNote = degraded ? ` ⚠【能力降级：${degraded}】` : '';
          push(
            it,
            ok ? 'pass' : 'fail',
            ok ? `断言成立：${e.expect}${degradeNote}` : `断言**不成立**：${e.expect}${degradeNote}`,
          );
        } catch (err) {
          // ★★★ 2026-11-04（subagent:text-has-fix）：**判不了 ≠ 违反**。
          //   `run` 的表达式**抛错**（`expect` 写坏 / 引用了求值域外的名字 / 读文件失败）意味着这条判据
          //   **没有得出任何结论** —— 记成 `fail` 就是"假失败冒充真失败"（与假绿同一种病：结论不携带前提）。
          //   只有"表达式跑出来了、结果是假"才是 `fail`（见上一行）。
          //   ★ 实测代价：改前把一条 `expect` 写成语法错，回执报 fail ⇒ 读端分不出"要求没满足"与"压根没跑起来"。
          //   ★★★ 2026-11-18：**"想生成代码"单列一条报文**（修法自带）—— 它不是"判据写坏了"，
          //     是"这条判据想执行任意代码"，读端必须一眼看出这一档（T4 的那种写法会落到这里）。
          if (isCodeGenerationRefused(err)) {
            push(
              it,
              'unsupported',
              `run 判不了：判据求值域**禁止生成代码**（\`vm\` + \`contextCodeGeneration:{strings:false}\`）` +
                `⇒ \`new Function\` / \`eval\` / \`Function(...)\`（含 \`.constructor.constructor(...)\` 两级链）一律拒绝。` +
                `**这不是"要求没满足"**：这条判据试图把注入的求值域变成任意代码。` +
                `改法：把要判的东西写成直接断言（\`fs.existsSync\` / \`fs.readFileSync\` / \`facts.*\` / \`validateDSL(...)\`）。` +
                `原文：${(err as Error).message}`,
            );
            break;
          }
          push(it, 'unsupported', `run 判不了（表达式抛错，**不是**"要求没满足"）：${(err as Error).message}`);
        }
        break;
      }
      case 'call-exists': {
        // ★★ T79：**调用级**判据 —— 边/符号/签名三档表达不了"必须用哪个符号"，
        //   而"用错符号"恰恰是最常见的偏差（实测：设计说必须用 add，实现换成 mul，边判据照样绿）。
        const p = normPath(e.path);
        const bad = indexStaleFor(root, [p]);
        if (bad) {
          push(it, 'unsupported', bad);
          break;
        }
                let outgoing: Array<{ caller: string; callee: string; line: number }> = [];
        try {
          outgoing = queryFileCalls(getProjectCacheDb(root), p).outgoing;
        } catch (err) {
          push(it, 'unsupported', `读调用边失败（${(err as Error).message}）⇒ 判不了`);
          break;
        }
        // ★★★ 2026-10-09：id 约定**实测定证**（别按 DSL 的节点 id 猜）——
        //   索引 `nodes` / `edges` 里符号 id 是 **`<仓库相对路径>#<符号名>`**
        //   （实测：`src/format.ts#total → src/math.ts#add`），
        //   **不是** DSL 的 `file_src_format_ts#total`。
        //   ★ 我初版按 DSL 的 file id 拼 ⇒ 查不到 ⇒ 把"已实现"判成 fail（**误报**）。
        //   ★★ 顺带修掉了 `get_dsl query=calls`（同一个拼错 id 的根因，见 T80）。
        const callerId = `${p}#${e.symbol}`;
        const mine = outgoing.filter((x) => x.caller === callerId);
        // ★★ 守卫（防**假绿**，但不能变成误报）：只有当**整个索引里一条调用边都没有**时，
        //   才说"判不了"（那时是"调用抽取没产出"，不是"这个符号没调用"）。
        //   ★ 初版守卫写的是"该文件一条出调用都没有 ⇒ 判不了" —— **太保守**：
        //     文件本来就不做任何项目内调用是完全正常的状态（实测夹具里 `total` 只调用 `Array.reduce`），
        //     那应当判 **fail**，判"判不了"等于给一个"没实现"的设计开脱。
        if (mine.length === 0) {
          let totalCalls = 0;
          try {
            const row = getProjectCacheDb(root).prepare("SELECT COUNT(*) AS c FROM edges WHERE kind = 'call'").get() as { c?: number } | undefined;
            totalCalls = row?.c ?? 0;
          } catch {
            totalCalls = 0;
          }
          if (totalCalls === 0) {
            push(it, 'unsupported', `本项目索引里**一条调用边都没有**（该语言的调用抽取没产出）⇒ 判不了`);
            break;
          }
        }
        const shortName = (id: string): string => id.slice(id.lastIndexOf('#') + 1);
        const callees = mine.map((x) => shortName(x.callee));
        const hit = mine.find((x) => shortName(x.callee) === e.target);
        push(
          it,
          hit ? 'pass' : 'fail',
          hit
            ? `${p} 的 \`${e.symbol}()\` **调用了** \`${e.target}()\`（L${hit.line}）`
            : `${p} 的 \`${e.symbol}()\` **没有**调用 \`${e.target}()\`` +
              (callees.length ? `；它实际调用的是：${[...new Set(callees)].join(', ')}` : '（该符号没有任何出调用）'),
        );
        break;
      }

      // ★★★ 2026-10-24（工作项 L 第一步）：**行为契约** —— 给定输入 → 断言输出（契约三层之三：
      //   ① signature-matches 声明契约 ② call-exists 副作用契约 ③ behavior-cases 行为契约）。
      //   ★ 期望输出写在判据里（cases[].expect），**不依赖基线文件**：基线是 capture 时的"实然"，
      //     expect 是设计声明的"应然" —— 判据必须对着应然判（若对着基线判：capture 自坏代码 ⇒ 恒 fail、
      //     capture 自好代码 ⇒ expect 沦为摆设）。执行核复用 `runHarness`（`verifyBaseline` 同一条执行路径）。
      //   ★ I2b（2026-10-25）：`behavior_baseline` **工具注册已并入本判据生态**（observe 线拆注册、执行核不动）
      //     ⇒ 行为基线场景一律用 behavior-cases 判据表达，不再有独立的 capture/verify 工具面。
      case 'behavior-cases': {
        // ★★★ 2026-11-17（P0 · 全量 <30s）：**执行在此消费、判定在 `verdictOfBehaviorExec`**。
        //   预取过的（`behPrefetch`）直接取结果 —— 它可能已经跑完了；没预取（并发度 ≤ 1 / blocked_by 之外
        //   的异常情形）就地跑同一个执行核。两条路的 verdict 必须逐条相同（有测试钉住）。
        const exec = behPrefetch.get(idx) ?? executeBehaviorCases(root, e);
        try {
          const v = verdictOfBehaviorExec(e, await exec);
          push(it, v.verdict, v.detail);
        } catch (err) {
          // ★ 执行核/判定抛错 ⇒ `unsupported`（"判不了"不冒充"违反"）—— 与拆分前的 catch 口径逐字相同
          push(it, 'unsupported', `行为基线判不了：${(err as Error).message}`);
        }
        break;
      }
      // ★★★ 2026-10-28（T-#OBSERVE-1）：**运行时判据（L3）** —— 自动化测试框架的最后一层。
      //   现有判据只到 L2（`behavior-cases` 同进程跑函数）；"真链路 / 静默吞错 / 重试"只存在于探针事件里。
      //   判据：`probe` 必填；`events` 可选（缺省**自动找** `<root>/.agent/observe/events*.jsonl` 取最新）；
      //   `expect`：ok（默认，每条都 ok）/ deviation（至少一条偏差，反例用法）/ absent（一条都不许出现）。
      //   四态：找不到事件文件 / 文件里一条事件都没有 ⇒ `unsupported`（**判不了 ≠ 通过**）。
      case 'runtime': {
        // ① 找事件文件：显式 path 优先，否则自动发现（零配置）
        let eventsFile: string | null = null;
        if (e.events) {
          const p = path.isAbsolute(e.events) ? e.events : path.join(root, normPath(e.events));
          if (fs.existsSync(p)) eventsFile = p;
        } else {
          const dirs = [path.join(root, '.agent', 'observe'), path.join(root, '.agentio-data', 'observe')];
          const cands: Array<{ f: string; m: number }> = [];
          for (const d of dirs) {
            if (!fs.existsSync(d)) continue;
            for (const f of fs.readdirSync(d)) {
              if (!/^events.*\.jsonl$/.test(f)) continue;
              const full = path.join(d, f);
              try {
                cands.push({ f: full, m: fs.statSync(full).mtimeMs });
              } catch {
                /* 读不到就跳过 */
              }
            }
          }
          cands.sort((x, y) => y.m - x.m);
          eventsFile = cands[0]?.f ?? null;
        }
        if (!eventsFile) {
          push(it, 'unsupported', '找不到探针事件文件（`.agent/observe/events*.jsonl`）⇒ 运行时判不了（不是"没问题"）');
          break;
        }
        // ② 读事件（坏行跳过，与 observe 线同口径）
        const evs: Array<Record<string, unknown>> = [];
        try {
          for (const line of fs.readFileSync(eventsFile, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
              const o = JSON.parse(line) as Record<string, unknown>;
              if (typeof o.probe === 'string') evs.push(o);
            } catch {
              /* 坏行跳过 */
            }
          }
        } catch (err) {
          push(it, 'unsupported', `事件文件读不了 ⇒ 判不了：${(err as Error).message}`);
          break;
        }
        if (!evs.length) {
          push(it, 'unsupported', `事件文件 \`${path.basename(eventsFile)}\` 里一条事件都没有 ⇒ 判不了（空 ≠ 没问题）。★ 下一步：npm run observe:collect -- <你要跑的命令>（先采一轮事件；入口见 T-#OBSERVE-8）`);
          break;
        }
        // ③ 选择集：**优先按框架规则 id（设计侧稳定名）**，probe 只作可选过滤（易变名）
        const probeSel = e.probe ? String(e.probe) : '';
        const matchProbe = (p: string): boolean => {
          if (!probeSel) return true;
          if (probeSel.endsWith('*')) return p.startsWith(probeSel.slice(0, -1));
          return p === probeSel;
        };
        const cand = evs.filter((x) => matchProbe(String(x.probe)));
        const verdictsAll = cand.map((ev) => judgeEvent(ev as never));
        const ruleSel = e.rule ? String(e.rule) : '';
        const verdicts = ruleSel ? verdictsAll.filter((v) => v.rule === ruleSel) : verdictsAll;
        const selLabel = ruleSel ? `规则 ${ruleSel}${probeSel ? ` @ ${probeSel}` : ''}` : `probe ${probeSel}`;
        const want = (e.expect ?? 'ok') as 'ok' | 'deviation' | 'absent';

        // ★ 判不了的三态都要说清（"没跑到"最容易被读成"没问题"）：
        //   · 选择集为空 ⇒ 该规则/探针在这批事件里**根本没出现**；
        //   · 只给了 rule 而事件里没这条规则 ⇒ 同上。
        if (!ruleSel && !probeSel) {
          push(it, 'unsupported', 'runtime 判据要给 rule（框架规则 id）或 probe 至少一个 ⇒ 判不了');
          break;
        }
        // ★★★ 2026-11-01（外部审计 P1 · 假绿）：**absent 与其余 expect 从此共用同一道证据门**。
        //   改前 absent 这一支是 `verdicts.length === 0 ? 'pass'`，而紧随其后的非 absent 分支对
        //   **同一情形**判 unsupported ⇒ 同一个问题两条路径两种口径：探针名写错 / 没插桩时
        //   absent 假绿（detail 还写着"符合预期：不许出现"）。★ 不变量：**没有 verdict 就没有证据**。
        const noEvidence = runtimeNoEvidenceDetailOf(want, verdicts.length, selLabel);
        if (noEvidence) {
          push(it, 'unsupported', noEvidence);
          break;
        }
        if (want === 'absent') {
          // 走到这里 = 这条规则/探针在这批事件里**有记录** ⇒ absent 不成立。
          push(
            it,
            'fail',
            `${selLabel} **不该出现**，但出现了 ${verdicts.length} 条（如 ${verdicts[0].reason.slice(0, 110)}）`,
          );
          break;
        }
        // ④ 聚合
        const bad = verdicts.filter((v) => v.result === 'deviation');
        if (want === 'deviation') {
          push(
            it,
            bad.length > 0 ? 'pass' : 'fail',
            bad.length > 0
              ? `${selLabel}：${verdicts.length} 条里有 ${bad.length} 条偏差（符合反例预期），如：${bad[0].reason.slice(0, 120)}`
              : `${selLabel}：${verdicts.length} 条全是 ok ⇒ **反例没成立**（这条判据没在测任何东西）`,
          );
          break;
        }
        push(
          it,
          bad.length === 0 ? 'pass' : 'fail',
          bad.length === 0
            ? `${selLabel}：${verdicts.length} 条运行时事件全 ok`
            : `${selLabel}：${bad.length}/${verdicts.length} 条偏差 —— ${bad[0].rule}：${bad[0].reason.slice(0, 140)}`,
        );
        break;
      }

      // ★★★ 2026-11-10（journey 卡级契约 · 第④项）：**组合证据** —— 子函数各自全绿 ≠ 旅程通。
      //   journey 契约把一条真实消息从投递 → 分发 → 处理 → 多席位出站帧走完，对终态投影断言。
      //   执行核 `runJourneyCase`（journey_program.ts）：假 registry/send + 真 queue/真 protocol，
      //   组装 RouterDeps 直调 routeMessage —— 不需要网络替身（传输层在注入边界外，见 router.ts 头注）。
      case 'journey-cases': {
        const p = normPath(e.path);
        const abs = path.join(root, p);
        if (!fs.existsSync(abs)) {
          push(it, 'fail', `${p} **不存在**（查的是 ${abs}）`);
          break;
        }
        const badScenes: string[] = [];
        let unsupportedWhy: string | null = null;
        for (let i = 0; i < e.cases.length; i++) {
          const r = runJourneyCase({ projectRoot: root, file: p, journeyCase: e.cases[i] as never });
          if (r.status === 'unsupported') {
            unsupportedWhy = `场景-${i + 1}：${r.detail[0] ?? '判不了'}`;
            break;
          }
          if (r.status === 'fail') badScenes.push(`场景-${i + 1}${r.at ? ' ' + r.at : ''}：${r.detail[0] ?? ''}`);
        }
        if (unsupportedWhy) {
          push(it, 'unsupported', `journey 跑不了 ⇒ 判不了：${unsupportedWhy}`);
          break;
        }
        if (badScenes.length > 0) {
          push(it, 'fail', `旅程不符 ${badScenes.length}/${e.cases.length}：${badScenes[0]}`);
        } else {
          push(it, 'pass', `${e.cases.length}/${e.cases.length} 场景通过（${p} 的 \`${e.name}\` journey 现跑：投递→分发→出站帧终态投影全符）`);
        }
        break;
      }


      // ★★★ 2026-10-28（T-#DOMAIN-2）：**域级边界判据** —— 现有 `edge-absent` 是文件对级，
      //   给目录前缀会判 `unsupported`（索引里没有"目录"这个文件）；而本仓有 167 个域对 / 1507 条跨域 import 边
      //   ⇒ 逐文件枚举不现实。本判据**按域对聚合**一次算清。
      //
      //   判据：域 `domain` 的任一文件 → `must_not_import` 里任一域的任一文件存在 import 边 ⇒ fail（给条数 + 样例）。
      //   四态：域表拿不到 / 域 id 不认识 ⇒ `unsupported`（**判不了 ≠ 合格**）。
      case 'domain-independent': {
        const tableFile = path.join(root, 'structure.domains.json');
        if (!fs.existsSync(tableFile)) {
          push(it, 'unsupported', '域表 `structure.domains.json` 不存在 ⇒ 域边界判不了');
          break;
        }
        let doms: Array<{ id: string; dir: string; layer?: string }> = [];
        try {
          const raw = JSON.parse(fs.readFileSync(tableFile, 'utf8')) as {
            domains?: Array<{ id: string; dir: string; layer?: string }>;
          };
          doms = (raw.domains ?? []).map((d) => ({ ...d, dir: normPath(d.dir) }));
        } catch (err) {
          push(it, 'unsupported', `域表解析失败 ⇒ 判不了：${(err as Error).message}`);
          break;
        }
        const mine = doms.find((d) => d.id === e.domain);
        if (!mine) {
          push(it, 'unsupported', `域表里没有域 \`${e.domain}\` ⇒ 判不了（不是"没有依赖"）`);
          break;
        }
        const targetIds = e.must_not_import ?? [];
        const missing = targetIds.filter((id) => !doms.some((d) => d.id === id));
        if (missing.length) {
          push(it, 'unsupported', `must_not_import 里有域表不认识的域：${missing.join(', ')} ⇒ 判不了`);
          break;
        }
        const domOf = (p: string): string | null => {
          const q = normPath(p);
          let best: { id: string; len: number } | null = null;
          for (const d of doms) {
            if (q === d.dir || q.startsWith(d.dir + '/')) {
              if (!best || d.dir.length > best.len) best = { id: d.id, len: d.dir.length };
            }
          }
          return best?.id ?? null;
        };
        let bad = 0;
        const samples: string[] = [];
        try {
          const db = getProjectCacheDb(root);
          const rows = db.prepare("SELECT source, target FROM edges WHERE kind = 'import'").all() as Array<{
            source: string;
            target: string;
          }>;
          for (const r of rows) {
            if (domOf(r.source) !== mine.id) continue;
            const toDom = domOf(r.target);
            if (!toDom || !targetIds.includes(toDom)) continue;
            bad += 1;
            if (samples.length < 3) samples.push(`${r.source} → ${r.target}`);
          }
        } catch (err) {
          push(it, 'unsupported', `索引不可用 ⇒ 域边界判不了：${(err as Error).message}`);
          break;
        }
        push(
          it,
          bad === 0 ? 'pass' : 'fail',
          bad === 0
            ? `域 ${mine.id}（${mine.dir}）**未**依赖 ${targetIds.join(' / ')}（符合预期）`
            : `域 ${mine.id}（${mine.dir}）**不该**依赖 ${targetIds.join(' / ')}，但有 ${bad} 条 import：${samples.join('；')}`,
        );
        break;
      }

      case 'edge-exists':
      case 'edge-absent': {
        const from = normPath(e.from);
        const to = normPath(e.to);
        const bad = depFactsIncomplete(root, from) ?? indexStaleFor(root, [from]);
        if (bad) {
          push(it, 'unsupported', bad);
          break;
        }
        const deps = fileFacts(root, from).deps.map(normPath);
        const has = deps.includes(to);
        // ★ 若"期望存在但没找到"，再排一次 **type-only 的冤案**：
        //   `import type` 运行时擦除 ⇒ 按设计**不建边**（`symbols.ts:390`）⇒ 这是"判不了"，不是"不存在"
        if (e.kind === 'edge-exists' && !has) {
          const raw = getRawImportsOfFile(getProjectCacheDb(root), from);
          // ★★★ T3（G2 修复，2026-10-16；`docs/board.md` T3 / `docs/replan-log-2026-10-15.md` §83.3）：
          //   **按「basename 去扩展名」比较**，不再拿"带扩展名的串"硬比。
          //   · 原实现：`raw.find((r) => to.startsWith(normPath(r.source).replace(/^\.\//, '')) || r.source.includes(to.split('/').pop() ?? ''))`
          //     —— 两个子句**都是死代码**：`to` 是 `.../task_schema.ts`（带 `.ts`），而 raw import 的
          //     `r.source` 是 `'./task_schema.js'`（带 `.js`；**本仓 ESM/NodeNext 约定：源码写 `.js`、
          //     真实文件是 `.ts`**）⇒ `includes('task_schema.ts')` **永不命中**
          //     ⇒ 整段 type-only 冤案排解对本仓是死的 ⇒ 把合法的 `import type` 读成"不存在" ⇒ **误报**
          //     （实测：`edge-exists discussion_log→task_schema` 判 **fail**，而正确判定是"按设计不建边 ⇒ 判不了"）。
          //   · 修法（§83.3 给的补丁）：两侧都取 **basename 并去掉扩展名** 再比 ⇒ `task_schema.ts` ↔ `task_schema.js` 命中。
          //   ★ 已知限度（如实声明）：只比 basename ⇒ 若 `to` 与某条 **type-only 导入同名不同目录**，
          //     会误判成"判不了"（= 假 unsupported；比误报轻，但仍是错）。本分支**只在 `has===false`
          //     且仅用于区分 fail/unsupported**，不判"存在"⇒ 最坏也只是把一条"该红"读成"判不了"。
          const baseNoExt = (s: string): string => {
            const base = normPath(s).split('/').pop() ?? '';
            return base.replace(/\.[^.]*$/, '');
          };
          const rawHit = raw.find((r) => baseNoExt(r.source) === baseNoExt(to));
          if (rawHit?.type_only) {
            push(it, 'unsupported', `${from} 对 ${to} 的导入是 **type-only**（\`import type\`），按设计**不建依赖边** ⇒ 判不了（不是"不存在"）`);
            break;
          }
        }
        if (e.kind === 'edge-exists') {
          push(
            it,
            has ? 'pass' : 'fail',
            has ? `${from} → ${to} 存在` : `${from} **没有**依赖 ${to}（现取到 ${deps.length} 条依赖：${deps.slice(0, 5).join(', ') || '（无）'}${deps.length > 5 ? ' …' : ''}）`,
          );
        } else {
          push(
            it,
            has ? 'fail' : 'pass',
            has
              ? `${from} **不该**依赖 ${to}，但它确实依赖（边界越权）`
              : `${from} 未依赖 ${to}（符合预期：不许依赖）`,
          );
        }
        break;
      }
    }
  }

  // ★ 函数末尾：本轮有现算并入缓存的新条目 ⇒ 落盘（try/catch：落盘失败警告不致命，**不静默吞**）
  if (cacheMisses > 0) {
    try {
      saveJudgeCache(root, cache);
    } catch (err) {
      process.stderr.write(
        `⚠ judge-cache 落盘失败（${(err as Error).message}）—— 不致命：本轮判定已出，只是下次要重算\n`,
      );
    }
  }

  const notes: string[] = [];
  // ★★★ 2026-10-31（兜底告警，**不是门**）：索引落后于磁盘时，汇总里也带一句 ——
  //   光打一行 stderr 会被"回执只读 snippets"的调用方漏掉；这句的作用是让人知道
  //   「本轮文本判据按磁盘现算、边表类判据可能因此变 unsupported」这两件事的原因。
  if (indexBehind > 0) {
    notes.push(
      `[judge] **索引落后于磁盘**（${indexBehind}/${judgedFiles.length} 个参与判据的文件）⇒ ` +
        `本次判定**已按磁盘现算**（source-has / symbol-exists / signature-matches 不看索引）⇒ 结论可信；` +
        `只有边表类判据（edge-* / call-exists / domain-independent）可能因索引旧而降级成 unsupported` +
        `（那已逐条如实报）。要消掉这句：跑一次 \`import_project\`（默认只刷新"实际"、不碰设计）。`,
    );
  }
  const unsupported = out.filter((x) => x.verdict === 'unsupported').length;
  if (unsupported > 0) {
    notes.push(
      `★★ 有 **${unsupported} 条判不了（unsupported）** —— ★ **这不是"通过"**：` +
        `把它们并进"通过"就等于用"判不了"冒充"没问题"。请先把判据补全（多半是索引没建，或该语言不走相对导入）。`,
    );
  }
  // ★★★ P1（只读报告层）：分级分布 + assumption 点名 —— 只数 out，不重判、不改 verdict
  const evidenceTierCounts = Object.fromEntries(EVIDENCE_TIERS.map((k) => [k, 0])) as Record<EvidenceTier, number>;
  const assumptionItems: string[] = [];
  for (const it of out) {
    const tier = it.evidence?.tier ?? 'assumption';
    if (tier in evidenceTierCounts) evidenceTierCounts[tier] += 1;
    else evidenceTierCounts.assumption += 1; // 读不到 ⇒ 按最弱算（0.12：读不到 ≠ 通过）
    if (tier === 'assumption') assumptionItems.push(it.node_id);
  }
  return {
    checked: out.length,
    // ★★★ P1（报告层新增；可选字段不填的假 judge 不影响任何既有消费者）
    evidenceTierCounts,
    assumptionItems,
    passed: out.filter((x) => x.verdict === 'pass').length,
    failed: out.filter((x) => x.verdict === 'fail').length,
    unsupported,
    // ★★★ 2026-10-22：`pending` 单列 —— 此前四值里只有它没人计数 ⇒ 只有 pending 后态判据的卡
    //   会被 `cardStanding` 判 `satisfied`（「还没干完，在等前置」被读成「可收口」）。
    //   计数口径与其他三值一致：**只数 verdict，不重新解释**（怎么处置在 domain 侧）。
    pending: out.filter((x) => x.verdict === 'pending').length,
    // ★ T256 缺口②：决策间冲突（同一对象上的互斥要求）—— 单列，不混进 pass/fail 计数
    conflicts: findExpectationConflicts(items),
    // ★ 2026-10-24（judge-cache）：缓存命中率（读端可看见「没变的文件不再测」兑现了几成）
    cache: { hits: cacheHits, misses: cacheMisses },
    // ★ #188 补观测：判定前索引覆盖校验取证（三态 + backfill 读数），透传到回执供 CI 归因。
    coverage,
    items: out,
    notes,
  };
}
