/**
 * change_set_view.ts —— **ChangeSet 的只读读端**：`changeSetOfCard(root, cardId)`。
 *
 * ## 它是什么（一段话）
 * 按**一张卡**把 §7.1（`docs/PROJECT-DESIGN.md:441-455`）那七行**现组装**出来：
 * 卡（`task` / `todos[]`）· 它挂的节点的 `decision` · 该卡名下的**全部画布行**（`tasks.db#plans`，
 * 一行不跳）· 画布条目判据的**现算**结果 · 实际索引读数 · 卡上存的施工证据 ⇒ 交给纯核
 * `domain/change_set.ts#assembleChangeSet` 组装成 `ChangeSetView`。
 *
 * ## 三条硬约束（本卡的判据就是这三条）
 * ① **按卡聚合**：一张卡跨 N 个文件 ⇒ N 个文件的工作项**都在**（`plansOfCard` 一行不跳地读）；
 * ② **不坍缩**：`entries` 带齐 `kind / detail / judgement_ref / status / depends_on`，
 *    文件级工作项（无 `anchor.symbol`）与 `done` 项一律保留；
 * ③ **不落盘**：只 `DatabaseSync({readOnly:true})` + `existsSync` —— 不建库、不建表、不写任何文件。
 *    （取数全部复用既有只读口：`plansOfCard` / `checkRewriteExit` / `runPlanJudgements`，本文件不新造第二把尺。）
 *
 * ## 两处**故意不做**的事（说清"为什么不做"，比"顺手做了"重要）
 * · **不判"卡的新鲜度"**：证据新鲜度归 `domain/task_schema.ts#evidenceFreshness` 与
 *   `domain/task_machine.ts#cardStanding` 说了算。本视图只搬 `kind / verdict / at`，
 *   **不重算 freshness**（重算 = 第二把尺，两把尺迟早打架）。
 * · **不给 todo 卡"借"第 1 行**：判据只住节点的 `decision`（`domain/task_schema.ts:1055-1070`
 *   的 `expectationsOf`；`TaskSpec` 里**没有** `expectations` 字段）。
 *   todo 卡（`todos[]`）没有自己的节点决策 ⇒ 第 1 行**如实报缺**，**不**去借它 `node_id` 指向的
 *   那个文件节点的决策 —— 借来的"目标"是那个文件的目标，不是这张卡的（借 = 假覆盖）。
 *   ★ 后果照实说：**阶段 A 出口的「完整 ChangeSet」对 `todo_*` 卡今天不成立**（见
 *   `CHANGE_SET_MISSING_CAPABILITIES` 的 C 条）。
 */
import { isSameProject, listDesignSheets } from '../../../infrastructure/storage.js';
import { assembleChangeSet } from '../../../domain/change_set.js';
import type {
  ChangeSetCardInput,
  ChangeSetDecisionInput,
  ChangeSetEvidenceInput,
  ChangeSetIndexFactInput,
  ChangeSetJudgementInput,
  ChangeSetPlanInput,
  ChangeSetView,
} from '../../../domain/change_set.js';
import { cardLivesOf, plansOfCard } from './rewrite_plan.js';
import { runPlanJudgements } from './judgement_run.js';
import { checkRewriteExit } from './plan_exit_check.js';

/**
 * ★★★ **「仍缺的能力」具名清单**（`docs/PROJECT-DESIGN.md:791` 出口第 3 条：「仍缺的能力**具名列出**」）。
 *
 * ## 为什么它是一份常量、而不是一段散文
 * 散文会腐：出口判据要的是「**今天还差哪几件、差在哪里**」，写在 PR 描述或会话里，第二个人复算不了
 * （`docs/PITFALLS.md` P29：会话内读数不算证据）。放进代码 ⇒ `tests/p0_change_set_view.test.ts`
 * 每轮都断言它非空且点名了这几件 —— **删一条会红**。
 *
 * ## 它**不是**本卡要造的东西
 * 本卡只交「读得出完整 ChangeSet」；清单里每一条都是**另一张卡**的活。
 * ★ 逐字保留编号，方便在别处引用（A/B/C…）。
 */
export const CHANGE_SET_MISSING_CAPABILITIES: readonly string[] = [
  'A · 卡 → 变更集的**意图引用**不存在：`IntentLink`（§7.0.2，`docs/PROJECT-DESIGN.md:356-363`）及其 ' +
    '`parentTaskId` / `rootContractRef` / `designDecisionRef` / `changeSetRef` 在 `src/` **全 0 命中** ' +
    '⇒ 今天没有「这张卡服务于哪个上层目标」的引用（`follows` 只表环次，不能冒充父子）。',
  'B · 核销只覆盖了**一个轴**：§7.3 要求 `complete` 的输入含「`checkRewriteExit` 的结构与计划外改动」' +
    '与「每个 `judgement_ref` 的真实判定」，而 `completeTask`（`src/application/design/dsl_ops/task_ops.ts`）' +
    '只吃节点 `decision.expectations` + `isSatisfied` + 证据闸 —— **画布的停止条件没满足，今天不能阻止 complete**。' +
    '⇒ 「陈旧事实与 pending 反例均不能 complete」这个出口**只成立一条半**。',
  'C · **todo 卡读不出完整 ChangeSet**：判据只住节点 `decision`（`TaskSpec` 无 `expectations` 字段），' +
    '`edit_dsl todo.add` 的 `decision` 也不落 ⇒ 第 1 行（目标、理由与验收）对 `todo_*` 卡**没有来源**。' +
    '本视图如实报 `missing`，不借 `node_id` 那个文件节点的决策（借 = 假覆盖）。',
  'D · **「新建整个文件」在坍缩集里消失**：`rewrite_plan.ts#planChangeSet` 跳过 `status===\'done\'` 与' +
    '**没有 `anchor.symbol`** 的 entry ⇒ 领卡读集 / `diff_views` 的 card 圈定 / §7.1 第 6 行的字面口径' +
    '都会漏掉**文件级工作项**。本视图用 `plansOfCard` 绕开了它，但那个坍缩集本身没修。',
  'E · **已消解 / 历史的口径未定**：`aliveOnlyClause` 把 `dissolved_at` 行从「卡的改集」里滤掉，' +
    '今天没有「含历史」的画布读端。本视图按行标 `dissolved_at`、不做取舍；「核销后退出活动范围而保留历史」' +
    '（§7.2）的读端仍缺。',
  'F · **§7.1 七行今天没有任何机器判据**：全仓与 §7.1 相关的判据只有 ' +
    '`.agent-io/design/agent-io.dsl.json:20544` 那条 `source-has mustNot "CREATE TABLE IF NOT EXISTS changesets"`' +
    '（只防「建表」，**不防「七行少一行」**）⇒ 本卡落地后才有「少一行会被看见」。',
];

/** `changeSetOfCard` 的开关（两个都有缺省，缺省值 = "要全"） */
export interface ChangeSetOfCardOptions {
  /**
   * 跑画布条目的判据吗（缺省 **true**）。
   * ★ §7.1 第 7 行写的是「判据执行结果」⇒ 那是**现算不现存**的只读派生；关掉它等于少给一行，
   *   所以关掉时 `baseline_evidence` 会只剩冻结/索引两格（**不假装判过**）。
   */
  with_judgements?: boolean;
  /**
   * 含已软消解的画布行吗（缺省 **true** —— ChangeSet 是「完整」视图，消解只是一层标记）。
   * ★ 与 `planChangeSetOfCard` 的缺省**故意相反**：那个是并发读集（消解的不该再挡人），这里是"这次改了什么"的全账。
   */
  include_dissolved?: boolean;
}

/** 册里的节点（结构型：不 import 具体类型，避免把 domain 的形状抄一遍） */
interface SheetNode {
  id?: string;
  path?: string;
  decision?: {
    summary?: string;
    rationale?: string;
    acceptance?: string;
    expectations?: Array<{ kind?: string }>;
  } | null;
  task?: SheetCard | null;
}

/** 卡（节点上的 `task` 与 `todos[]` 的元素同形；只取本视图要的那几格） */
interface SheetCard {
  id?: string;
  state?: string;
  owner?: string | null;
  claimed_at?: string | null;
  node_id?: string;
  evidence?: Array<{ kind?: string; verdict?: string; at?: string }>;
}

/** 册的形状（只取本视图用到的三处） */
interface SheetShape {
  feature: string;
  source_root?: string;
  geometry?: { nodes?: SheetNode[] };
  todos?: SheetCard[];
}

/** 一张卡的定位结果 */
interface CardHome {
  feature: string;
  node: SheetNode | null;
  todo: SheetCard | null;
}

/**
 * 这张卡住哪本册、挂在哪（节点卡 / todo 卡）。
 *
 * ★ **只认显式归属**：节点 `id === cardId`，或 `todos[]` 里 `id === cardId` —— 不按目录 / 文件名猜
 *   （本仓头号病：路径前缀判据）。★ 读册失败**不吞**：`isSameProject` / `getDesignSheet` 会抛，
 *   本函数让它们抛（"读失败"与"没有这张卡"必须分得开，0.12）。
 */
function findCardHome(projectRoot: string, cardId: string): CardHome | null {
  const sheets = listDesignSheets() as unknown as SheetShape[];
  for (const sheet of sheets) {
    if (!isSameProject(sheet, projectRoot)) continue;
    const nodes = sheet.geometry?.nodes ?? [];
    const todos = sheet.todos ?? [];
    const node = nodes.find((n) => n?.id === cardId) ?? null;
    const todo = todos.find((t) => t?.id === cardId) ?? null;
    // ★ 节点在但没 task = 卡不在（`cardLivesOf` 会给 gone）；只报"找到了这张卡"的两种形态
    const isNodeCard = !!node?.task?.id || !!node?.task?.state;
    if (isNodeCard || todo) return { feature: sheet.feature, node, todo };
  }
  return null;
}

/**
 * ★★★ **按一张卡读出完整 ChangeSet**（只读）。
 *
 * 判据（与 `domain/change_set.ts#changeSetRowGaps` 同一把尺 —— 本函数只**取数**，不判"齐不齐"）：
 * · 卡跨 N 个文件 ⇒ N 个文件的 entry 全在（`plansOfCard` 不跳行）；
 * · 每条 entry 带 `kind / detail / judgement_ref / status / depends_on`（**不坍缩**）；
 * · 判据结果**现算**（`runPlanJudgements`），跑不了 ⇒ `unresolved` + 说清原因（**不假装通过**，P38 同族）；
 * · **一个字节都不落盘**。
 *
 * @param projectRoot 项目根（**绝对路径** —— 相对路径会落到别的库，P37）
 * @param cardId 卡 id（节点卡的 id = 它挂的节点 id；todo 卡 = `todos[].id`）
 */
export async function changeSetOfCard(
  projectRoot: string,
  cardId: string,
  opts: ChangeSetOfCardOptions = {},
): Promise<ChangeSetView> {
  const root = String(projectRoot ?? '');
  const id = String(cardId ?? '').trim();
  const withJudgements = opts.with_judgements !== false;
  const includeDissolved = opts.include_dissolved !== false;

  // ① 卡住哪（空的 cardId ⇒ 不猜、也绝不回落到"整库第一张卡"）
  const home = id ? findCardHome(root, id) : null;
  const life = (() => {
    if (!id) return null;
    try {
      return cardLivesOf(root).lives.get(id) ?? null;
    } catch {
      // 卡的下落判不出（册读失败 / 库锁）⇒ 如实 `null`（**不**降级成 "gone" —— 那是结论，不是不知道）
      return null;
    }
  })();

  const kind: ChangeSetCardInput['kind'] = home
    ? home.todo && !home.node?.task
      ? 'todo'
      : 'node'
    : 'unknown';
  const card: ChangeSetCardInput | null = home
    ? {
        id,
        kind,
        feature: home.feature,
        node_id: kind === 'todo' ? (home.todo?.node_id ?? null) : id,
        state: kind === 'todo' ? (home.todo?.state ?? null) : (home.node?.task?.state ?? null),
        owner: kind === 'todo' ? (home.todo?.owner ?? null) : (home.node?.task?.owner ?? null),
        claimed_at: kind === 'todo' ? (home.todo?.claimed_at ?? null) : (home.node?.task?.claimed_at ?? null),
        life,
      }
    : null;

  /**
   * ② decision：**只从"卡自己挂的那个节点"取**。
   * ★ todo 卡**不借**（见文件头那段）—— 它没有节点决策，这一行就该报缺。
   */
  const decision: ChangeSetDecisionInput | null =
    kind === 'node' && home?.node?.decision
      ? {
          ...(typeof home.node.decision.summary === 'string' ? { summary: home.node.decision.summary } : {}),
          ...(typeof home.node.decision.rationale === 'string' ? { rationale: home.node.decision.rationale } : {}),
          ...(typeof home.node.decision.acceptance === 'string' ? { acceptance: home.node.decision.acceptance } : {}),
          ...(Array.isArray(home.node.decision.expectations) ? { expectations: home.node.decision.expectations } : {}),
        }
      : null;

  // ③ 画布行（★ 不坍缩读端；`card_id` 精确等）
  const rows = id ? plansOfCard(root, id) : [];
  const kept = includeDissolved ? rows : rows.filter((r) => !r.dissolved_at);
  const plans: ChangeSetPlanInput[] = kept.map((r) => {
    const fps = r.plan.fps_at_freeze;
    return {
      file: r.plan.path,
      entries: r.plan.entries as unknown as ChangeSetPlanInput['entries'],
      frozen_at: r.plan.frozen_at ?? null,
      base_content_hash: r.plan.base?.content_hash ?? null,
      symbols_at_freeze: r.plan.symbols_at_freeze ?? null,
      fps_at_freeze_count: fps ? Object.keys(fps).length : null,
      untouched: r.plan.untouched ?? null,
      untouched_default_why: r.plan.untouched_default?.why ?? null,
      dissolved_at: r.dissolved_at,
      dissolve_reason: r.dissolve_reason,
    };
  });

  // ④ 判据现算（不落盘）。跑不了 ⇒ unresolved + 原因（**判不了 ≠ 通过**）
  const judgements: ChangeSetJudgementInput[] = [];
  if (withJudgements) {
    for (const r of kept) {
      const file = r.plan.path;
      if (r.dissolved_at) continue; // 已消解 = 这段已落地，不再重跑（免得把"当时通过"读成"现在还得过"）
      try {
        const vs = await runPlanJudgements(root, r.plan);
        for (const v of vs) {
          judgements.push({
            file,
            symbol: v.symbol === '(缺 anchor)' ? null : v.symbol,
            judgement_ref: v.judgement_ref,
            verdict: v.verdict,
            detail: v.detail,
          });
        }
      } catch (e) {
        judgements.push({
          file,
          symbol: null,
          judgement_ref: '',
          verdict: 'unresolved',
          detail: `判据跑不了（**不等于通过**）：${(e as Error).message}`,
        });
      }
    }
  }

  // ⑤ 实际索引读数（只读；`checkRewriteExit` 自己用 existsSync + 只读连接，不建库，P25 同族）
  const index: ChangeSetIndexFactInput[] = [];
  for (const r of kept) {
    const file = r.plan.path;
    try {
      const exit = checkRewriteExit(root, file);
      const changedFlags = exit.entries.map((e) => e.changed_since_freeze);
      // ★ 口径：有任一 entry 报"自冻结以来变过" ⇒ true；**全部** false 才是 false；其余（没指纹 / 没条目）⇒ null
      const changed: boolean | null = changedFlags.some((x) => x === true)
        ? true
        : changedFlags.length > 0 && changedFlags.every((x) => x === false)
          ? false
          : null;
      index.push({
        file,
        file_exists: exit.file_exists,
        changed_since_freeze: changed,
        changed_unplanned: exit.changed_unplanned,
        error: exit.error ?? null,
      });
    } catch (e) {
      index.push({
        file,
        file_exists: false,
        changed_since_freeze: null,
        changed_unplanned: [],
        error: `出口闭环跑不了（**不等于没变**）：${(e as Error).message}`,
      });
    }
  }

  // ⑥ 卡上存的施工证据（只搬结论；新鲜度归 `evidenceFreshness` / `cardStanding`，本视图不重算）
  const rawEvidence = kind === 'todo' ? (home?.todo?.evidence ?? []) : (home?.node?.task?.evidence ?? []);
  const evidence: ChangeSetEvidenceInput[] = rawEvidence.map((e) => ({
    ...(typeof e?.kind === 'string' ? { kind: e.kind } : { kind: 'unknown' }),
    ...(typeof e?.verdict === 'string' ? { verdict: e.verdict } : {}),
    ...(typeof e?.at === 'string' ? { at: e.at } : {}),
  }));

  return assembleChangeSet({ card, decision, plans, judgements, evidence, index });
}
