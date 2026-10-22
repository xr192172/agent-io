/**
 * judge_port.ts —— 「判定器」的**端口**（domain 侧唯一的一份契约，2026-10-21 · D-judge-port）。
 *
 * ## 为什么有这个文件（它收归的是什么）
 * 本仓的层级是 `presentation → application → infrastructure → domain`（`structure.domains.json#layers`）。
 * 而 `src/domain/task_machine.ts` 曾经**向上** import `application/design/intent/expectations.ts#judgeExpectations`
 * —— 「domain 不许 import infrastructure」这条被满足了，「**不许向上**」那条被违反了 ⇒ 规则满足一半 = 没满足。
 * ⇒ 把「判定」这件事收成一个**端口**：domain 只声明形状（本文件），实现住 application，由调用方注入。
 *
 * ★ 这**不是**新造第二把尺：判定器仍然只有 `judgeExpectations` 一个实现；本文件只是它的**类型**。
 *
 * ## ★★★ 端口契约（三条，缺一条就会把「判不了」读成「通过」）
 * 1. **四值必须原样穿过**：`Verdict` 是 `pass | fail | unsupported | pending`。
 *    ★ 不许把端口设计成 `Promise<boolean>` —— 那会把 `unsupported` 压成 `false`
 *      ⇒ `cardStanding` 的 `unknowable` 从五值里消失 ⇒ 「判不了」退化成「有活」甚至「没活」。
 * 2. **`checked` 必须 === 提交的 `items.length`**（每条恰好一条 verdict，不许漏判、不许凭空补）。
 *    ★ 这条由 `cardStanding` **亲自核对**（残缺报告 ⇒ `unknowable`）：端口是边界，边界上的承诺要有人验。
 * 3. **`unsupported` 不许混进 `pass`**：判不了就说判不了（扩展名不走解析器 / 依赖事实不完整 /
 *    依赖边只能取自索引且索引陈旧 / `import type` 按设计不建边）—— 实现侧负责识别，本文件只负责**留住这个词**。
 *
 * ## ★★ 已知未决：`pending` 在 domain 侧**还没有处置**
 * `pending` 的语义 = 「这活还没干完，卡在某处」（`run.blocked_by`）。它落在 `checked` 里，
 * 但**既不算 pass 也不算 fail / unsupported** ⇒ 今天一张只有 `pending` 后态判据的卡会被判 `satisfied`。
 * ★ 这是**既有**的洞，**不在端口化这一笔里修**（修它会改现网卡的结论，混进重构会失去「只改了接线」的证明力）。
 * ⇒ 记录在册：pending 必须在 domain 侧有处置，**当前处置 = 未决**（见 todo「pending 假绿」卡）。
 * ★ 端口实现**不许**为了绕过这个洞而把 `pending` 写成 `pass`（那是用假绿换假绿）。
 *
 * ## 四件事的归属（别在本文件里加实现）
 * · **判定**（读盘 / 读索引 / 现解析）⇒ application + infrastructure；
 * · **按 phase 分区 / 派生五值 / 归属分类**⇒ domain（`task_machine.ts#cardStanding`）；
 * · **注入**⇒ application（`claim` / `complete` / patrol 各自把 `judgeExpectations` 传进来）。
 */
import type { Expectation } from './expectation.js';

/**
 * 一条判据的结论 —— ★ **四值，不是两值**。
 *
 * `pending` = **这条债现在判不了 / 修不了，但它是真的在等某件事**（等宿主 / 等外部 / 等前置）。
 * ★ 它和 `unsupported` 的区别：`unsupported` = 「这个判据我判不了」（工具/索引不够）；
 *   `pending` = 「这活还没干完，卡在某处」（而「卡在哪」写在契约的 `blocked_by` 里）。
 */
export type Verdict = 'pass' | 'fail' | 'unsupported' | 'pending';

/** 判定器的一条输入（= 一条期望 + 它挂在哪个节点上，只为人读/归因） */
export interface JudgeItem {
  node_id: string;
  node_label: string;
  expectation: Expectation;
}

/** 一条判定结果 */
export interface ExpectationItem extends JudgeItem {
  verdict: Verdict;
  /** 人话说明（为什么过 / 为什么不过 / 为什么判不了） */
  detail: string;
}

/**
 * 一条**决策间冲突**：同一对象上的两个互斥要求。
 * ★ 只检**可判定的互斥**（同一 `from → to` 的 exists/absent、同一 `path#symbol` 的两种签名）；
 *   语义冲突机器判不了 ⇒ 不假装能判。
 */
export interface ExpectationConflict {
  /** 冲突对象（人读）—— `a → b` 或 `path#symbol` */
  subject: string;
  /** 冲突的两个（或更多）要求，各带**来源节点**（谁提的） */
  sides: Array<{ node_id: string; kind: string; text: string }>;
}

/**
 * 一次批量判定的**报告**（★ domain 类型，不是 application 类型）。
 *
 * ## 判据：谁必须读懂它
 * `cardStanding` 读 `checked / passed / failed / unsupported`（进满足度）+ `items[].verdict`（`fail` 才进归属）
 * + `items[].expectation`（归属判据的输入）⇒ **`Verdict` 的四值是 domain 的词汇表**，
 *   domain 必须逐值给出处置。生产者住在 application 只是实现细节 ⇒ 形状归 domain。
 */
export interface ExpectationsReport {
  checked: number;
  passed: number;
  failed: number;
  unsupported: number;
  /**
   * ★★★ 2026-10-22：**`pending` 的条数**（`Verdict` 四值里此前唯一没人数的那个）。
   *
   * ## 为什么必须单列（这条不是补充说明，是一个假绿现场）
   * `cardStanding` 判 `satisfied` 的条件是 `failed === 0 ∧ violation.failed === 0 ∧ violation.unsupported === 0`。
   * 而 `pending` 既不是 pass 也不是 fail/unsupported ⇒ **它一条都没被数过** ⇒
   * 一张只有 `run{blocked_by:'等 X'}` 后态判据的卡会被判 `satisfied`（**可收口**），
   * 而它其实**还没干完，只是在等前置**。这是本仓最忌的那种绿：**「判不了」被读成「没问题」**。
   *
   * ## 与 `unsupported` 的区别（别混）
   * `unsupported` = 「**这个判据**我判不了」（扩展名不走解析器 / 依赖事实不完整）；
   * `pending` = 「**这活**还没干完，卡在某处」—— 卡在哪写在契约的 `blocked_by` 里，**要能读出来**。
   *
   * ★ 向后兼容：注入式假 judge 不填这个字段时是 `undefined`，判据写成 `> 0` 为假 ⇒ 行为不变
   *   （那是「它声称没有 pending」，是它自己的声明，不是本端口替它编）。
   */
  pending: number;
  items: ExpectationItem[];
  notes: string[];
  /** 决策间冲突（单列，**不混进** pass/fail 计数 —— 谁对是人的裁） */
  conflicts: ExpectationConflict[];
}

/**
 * ★★★ **判定器端口**：domain 发问，上层实现。
 *
 * 形状与 `application/design/intent/expectations.ts#judgeExpectations` **逐字相同**
 * （`(root, items) => Promise<ExpectationsReport>`）⇒ 接线不需要适配器：
 * ```ts
 * cardStanding(card, { root, nodes, judge: judgeExpectations })
 * ```
 * ★ `root` 对 domain 是**不透明字符串**：本层只把它原样转交，不读、不拼路径。
 * ★ **不许**在本层给默认实现（给了就等于 domain 又回头 import application，倒挂原地复活）。
 */
export type Judge = (root: string, items: readonly JudgeItem[]) => Promise<ExpectationsReport>;
