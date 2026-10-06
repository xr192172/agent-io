/**
 * verify_gate —— 提案审批的**验证门**（2026-10-05，P4 步骤 5）
 *
 * 搬迁自 `observe-lang-go/probe/proposal.go` 的 L1 / L3 / L4 三层
 * （`VerifyRuleRegression` :354-370、`verifyLLMCoverage` :271-288、
 *  `finalizeDecls` :391-418、`freeze` :257-267、`mergeLoopDecls` :231-253）。
 * L2（decl 级 LLM 复核）在 `decl_review.ts`（新写，Go 侧无实现可抄 —— 见该文件头）。
 *
 * ## 这个门在守什么
 * 权威 `dsl.json` 是"行为级判定的**权威真相源**"（Go `dsl_store.go:6-7` 自己的话）。
 * 本文件就是**在它被写入之前**的唯一闸门：一条声明进不进权威，由这里决定。
 *
 * ## ★ 与 Go 的三处**有意分歧**（均为 2026-10-05 用户裁定，非技术偏好）
 *
 * ① **LLM 判 `deviation` 的声明 ⇒ 冻结，不再"半放行"**（B 方案）
 *    Go 的真实行为：`finalizeDecls` 的 `llmOK` 只收 `result=="ok"`，而 `verifyLLMCoverage`
 *    **只看"有没有结论"** ⇒ LLM 判 deviation 的声明会带着 `needs-llm-review`/`proposed`
 *    标记**进入权威 `dsl.json`**，提案却整体被批准。
 *    ⚠ 而且 Go 自己的注释（`:388`）把这个语义**写错了**（写"未过 LLM 复核"，
 *      代码实际是"复核给了非 ok 结论"）。
 *    **代价是静默**：不报错，只在字段里留个标记，**没人会去看 `needs-llm-review`**。
 *    ⇒ 本实现改为：复核未给出 `ok` 的声明 **一律 `finalizeDecls` 抛错**，由 `approveGated` 冻结。
 *      权威 `dsl.json` 里**不出现未经复核的声明**。
 *    ⇒ **这会让 TS 与 Go 行为分叉，已显式登记**（分叉要写出来，不靠自觉）。
 *
 * ② **`status:'locked'` 不被降级**（Go 会覆盖）
 *    Go `finalizeDecls` 对有谓词的声明**无条件**写 `status="verified"`，于是种子声明
 *    `silentErrorDiscardDSL()` 自己声明的 `status:'locked'`（`llm_judge.go:118`
 *    注释："种子声明：v1 内建，被视为定稿锁定"）**会被覆盖成 `verified`** ⇒ 锁定语义丢失。
 *    本实现：`locked` 是**终态**，只填 `verified_by`、保留 `status`。
 *    （★ 2026-10-06 核实并**更正此前一句错判**：全仓确实**没有程序消费者**读声明级的 `status`，
 *      但它**不是"声明式的东西不落地"** —— 它与 `verified_by` / `origin` 都是**审计字段**：
 *      Go `llm_judge.go` 原文写「**审计字段（2026-08-15 工程化补全，对齐定稿方案）**」，
 *      `schema/observe_contract.schema.json` 三处的 description 也都标着「（审计）」。
 *      ⇒ 它们的**出口就是权威 `dsl.json` 本身**（人和 agent 直接看文件即可，`verified_by` 就在里面）。
 *      ⇒ Go 时代的 `dsl_cli` 也只打印**提案级**的这两个字段（`已验证: …` / `验证门证据: …`），
 *        从不打印声明级的 ⇒ "声明级无程序消费者"是**设计如此**。
 *      ⇒ 因此**不该为了"让它被用上"去发明一个消费者**；保留语义、不抹掉，就够了。）
 *
 * ③ `verified_by` 的取值三态里**删掉了 `needs-llm-review`**
 *    它在 ① 之后已不可达（能走到 `finalizeDecls` 就意味着每条无谓词声明都拿到了 `ok`）。
 *    保留成一个**显式抛错**而不是静默标记，是 ① 的直接推论。
 *
 * ## ★ 2026-10-06（P5）补：**数据型声明**不受"需 LLM 复核"对待
 *
 * `design:impact-known-spread` 与"无谓词的悬空规则"**不是一回事**：它不是等待某个谓词来判它，
 * 而是**已被另一条规则消费** —— 它是 `design:impact-unplanned-spread` 的**减项**
 * （已承认的耦合从事件的 `unexpected_files` 里扣除，见 `judge.ObserveRuleCtx`）。
 *
 * ⇒ 若仍按"无谓词 ⇒ 需 LLM 复核"处理，后果是**整条链空转**：loop 产出的 known-spread 提案
 *   默认被冻结 ⇒ 声明进不了权威 `dsl.json` ⇒ 那条扣减的输入**恒为空**、功能等于没做
 *   （与搬迁前"有生成无消费者"是同一形态，只是换了位置）。
 * ⇒ 处置：登记进 {@link DATA_DECL_RULES}，与谓词规则一样算"可确定性判定"，
 *   但 `verified_by` 记 `data-consumed` 以标明它属**数据型**（不借用 `rule-regression`）。
 */

import { OBSERVE_RULE_IDS } from './judge.js';
import { KNOWN_SPREAD_RULE, parseKnownSpread, type KnownSpreadConstraint, type SpreadPattern } from './ledger_fold.js';
import type { TSDLDecl } from './contract.js';

// ─────────────────────────────────────────────────────────────
// L1 规则回归门（照搬 Go :345-386）
// ─────────────────────────────────────────────────────────────

/** 规则回归输出：声明集里哪些规则有确定性判定可"秒判"，哪些只能靠 LLM/人工复核。 */
export interface RuleRegression {
  /** 检查的声明总数（★ 不去重 —— Go `:356` 就是 `len(decls)`） */
  checked: number;
  /** 有确定性判定的声明数（有谓词，或属**数据型声明** —— 见 {@link DATA_DECL_RULES}） */
  covered: number;
  /** 无确定性判定、需 LLM/人工复核的 rule（**去重 + 字典序**） */
  uncovered: string[];
}

/**
 * **数据型声明规则**：它们不作为独立谓词进判定链，而是作为**另一条规则的判定输入**。
 *   · `design:impact-known-spread` —— 它是 `design:impact-unplanned-spread` 的**减项**
 *     （已被设计承认的耦合从事件的 `unexpected_files` 里扣除，见 `judge.ObserveRuleCtx`）。
 *
 * ★ 2026-10-06（P5）为什么必须在这里登记：数据型声明同样是**可确定性判定**的
 *   —— 判定发生在**消费它的那条规则**里。若不算它 covered，后果是**整条链空转**：
 *     ① loop 源源不断产出的 known-spread 提案，每次审批都因"无谓词"被判 `uncovered`
 *        ⇒ 默认（无 LLM）**直接冻结**；
 *     ② 声明永远进不了权威 `dsl.json` ⇒ 上面那条扣减的输入**恒为空**，功能等于没做。
 *   ⇒ 登记后它与谓词规则一样"秒判可通过"，`verified_by` 另用 `data-consumed` 标明来历
 *     （它不是"有谓词判它"，而是"被另一条规则消费"—— 不用 `rule-regression` 那个词，
 *      避免"声明与实际不符"）。
 */
const DATA_DECL_RULES: ReadonlySet<string> = new Set([KNOWN_SPREAD_RULE]);

const registeredRules = (): Set<string> => new Set([...OBSERVE_RULE_IDS, ...DATA_DECL_RULES]);

/**
 * 规则可判定性回归（照搬 Go `:354-370`）。
 * ★ 它**自己什么都不拒绝** —— 无谓词声明只进 `uncovered`。拒不拒是 `approveGated` 的事。
 */
export function verifyRuleRegression(decls: TSDLDecl[]): RuleRegression {
  const preds = registeredRules();
  const reg: RuleRegression = { checked: decls.length, covered: 0, uncovered: [] };
  const seen = new Set<string>();
  for (const d of decls) {
    if (preds.has(d.rule)) {
      reg.covered++;
    } else if (!seen.has(d.rule)) {
      seen.add(d.rule);
      reg.uncovered.push(d.rule);
    }
  }
  reg.uncovered.sort();
  return reg;
}

/** 证据串（照搬 Go `:373`）。 */
export function regressionSummary(r: RuleRegression): string {
  return `rule-regression: ${r.covered}/${r.checked} 声明可确定性判定`;
}

/** 详情串（照搬 Go `:378`）。 */
export function regressionDescribe(r: RuleRegression): string {
  return r.uncovered.length === 0
    ? '全部规则有确定性谓词，可规则秒判'
    : `无确定性谓词、需 LLM/人工复核的规则: ${r.uncovered.join('、')}`;
}

/** 提案级证据串（照搬 Go `regressionEvidence` :292-298）。 */
export function regressionEvidence(r: RuleRegression, llmCount: number): string {
  return r.uncovered.length === 0
    ? `${regressionSummary(r)}（无规则需 LLM 复核${llmCount > 0 ? `，已复核 ${llmCount} 条声明` : ''}）`
    : `${regressionSummary(r)}；LLM 复核 ${llmCount} 条`;
}

// ─────────────────────────────────────────────────────────────
// L3 覆盖校验（照搬 Go :271-288）
// ─────────────────────────────────────────────────────────────

/** LLM 对单条声明的复核结论。字段与 Go `llm_judge.go:57-61` 的 `LLMVerdict` 逐字同构。 */
export interface DeclVerdict {
  result: 'ok' | 'deviation';
  rule: string;
  reason: string;
}

/**
 * 无谓词声明的 LLM 覆盖校验（照搬 Go `:271-288`）。
 * ★ 它**只判"有没有结论"，不看结论内容** —— `result:"deviation"` 也算覆盖。
 *   这个"弱"判据本身照搬（它是 Go 的原行为），但**下游的处置已被 ① 改严**
 *   （见 {@link finalizeDecls}）：覆盖到了却不是 `ok` ⇒ 抛错 ⇒ 冻结，不再半放行。
 */
export function verifyLLMCoverage(uncovered: string[], verdicts: DeclVerdict[]): void {
  const covered = new Set(verdicts.filter((v) => v.rule !== '').map((v) => v.rule));
  const missing = uncovered.filter((r) => !covered.has(r));
  if (missing.length > 0) throw new Error(`缺复核: ${missing.join('、')}`);
}

// ─────────────────────────────────────────────────────────────
// L4 定稿：finalizeDecls（★ 三处分歧都在这里）
// ─────────────────────────────────────────────────────────────

/**
 * 逐条补 `verified_by` / `status`（照搬 Go `:391-418` 结构，**按分歧 ①②③ 改严**）。
 *
 * 分歧① LLM 判非 ok ⇒ **抛错**（Go 是打 `needs-llm-review` 标记后照进权威）
 * 分歧② `status:'locked'` 是终态，**不被降级成 `verified`**（Go 会无条件覆盖）
 * 分歧③ `needs-llm-review` 状态已不可达，改为显式抛错
 *
 * @param llmVerdicts 为空表示无 LLM 复核（**仅当全部声明都有谓词时才会发生**）
 * @throws 无谓词声明没有拿到 `ok` 结论时抛错（调用方应冻结，不得定稿）
 */
export function finalizeDecls(decls: TSDLDecl[], reg: RuleRegression, llmVerdicts: DeclVerdict[]): TSDLDecl[] {
  const preds = registeredRules();
  const llmOK = new Set(llmVerdicts.filter((v) => v.rule !== '' && v.result === 'ok').map((v) => v.rule));
  const llmBad = new Set(llmVerdicts.filter((v) => v.rule !== '' && v.result !== 'ok').map((v) => v.rule));

  return decls.map((d) => {
    const out: TSDLDecl = { ...d };
    if (DATA_DECL_RULES.has(d.rule)) {
      // ★ 数据型声明（P5，2026-10-06）：它的判据是"被另一条规则消费"（known-spread 是
      //   unplanned-spread 的减项），不是"它自己有谓词" ⇒ 用 `data-consumed` 标明来历，
      //   不借用 `rule-regression` 那个词（否则声明与实际不符）。
      out.verified_by = 'data-consumed';
      if (out.status !== 'locked') out.status = 'verified';
      return out;
    }
    if (preds.has(d.rule)) {
      out.verified_by = 'rule-regression';
      // ② locked 是终态：只填证据，不降级状态
      if (out.status !== 'locked') out.status = 'verified';
      return out;
    }
    if (llmBad.has(d.rule) && !llmOK.has(d.rule)) {
      // ① 复核判它不可靠 ⇒ 拒绝进权威（Go 会标 needs-llm-review 后放行）
      const why = llmVerdicts.find((v) => v.rule === d.rule && v.result !== 'ok')?.reason ?? '(无理由)';
      throw new Error(`声明被复核判为不可靠，拒绝定稿：rule=${d.rule} — ${why}`);
    }
    if (llmOK.has(d.rule)) {
      out.verified_by = 'llm-review';
      if (out.status !== 'locked') out.status = 'verified';
      return out;
    }
    // ③ 能走到这里说明"无谓词 + 没有对应结论" —— 覆盖校验漏了它，**响亮失败**而非静默标记
    throw new Error(`内部不一致：声明 rule=${d.rule} 既无谓词、又无 LLM 复核结论，却走到了定稿`);
  });
}

/** 复核结论里"判为不可靠"的条数（给冻结文案用；照搬 Go `freeze` :257-267 的载体）。 */
export function rejectedByReview(decls: TSDLDecl[], llmVerdicts: DeclVerdict[]): DeclVerdict[] {
  const preds = registeredRules();
  return llmVerdicts.filter((v) => v.rule !== '' && v.result !== 'ok' && !preds.has(v.rule));
}

// ─────────────────────────────────────────────────────────────
// loop 增量提案的按键合并（照搬 Go :231-253）
// ─────────────────────────────────────────────────────────────

/** 合并键：rule+probe；known-spread 另加 constraint.source（照搬 Go `:233-238`）。 */
function mergeKey(d: TSDLDecl): string {
  const c: KnownSpreadConstraint | null = d.rule === KNOWN_SPREAD_RULE ? parseKnownSpread(d) : null;
  return c ? `${d.rule}|${c.source}` : `${d.rule}|${d.probe ?? ''}`;
}

/**
 * 把 loop 增量提案合并进当前权威集（**不整集替换**）。
 *
 * 人工/LLM 提案的 `decls` 是**完整新声明集** ⇒ 整集替换；
 * 但 loop 增量提案只带**单条**声明 ⇒ 整集替换会 wipe 掉其余全部契约（含种子）
 * ⇒ 故按键合并：**键存在则整条替换**（非字段级 merge），键不存在则追加。
 *
 * ★ 照搬的既有行为（知情即可，不在本笔改）：
 *   · **冲突无告警、无记录** —— 整条替换掉旧的，不留痕
 *   · ⚠ **一个疑似 bug**：`:239-242` 先扫当前集建键索引，若当前集内**同键重复**，
 *     只有**最后一条**进索引 ⇒ **前面那些永远不会被覆盖**。
 *     不修的理由：修它会改变现有 `dsl.json` 的合并结果（属行为变更），
 *     且当前 `dsl.json` 由种子 + 审批生成，同键重复本不该出现。**已在案上登记。**
 */
export function mergeLoopDecls(current: TSDLDecl[], incoming: TSDLDecl[]): TSDLDecl[] {
  const out = current.map((d) => ({ ...d }));
  const idx = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    idx.set(mergeKey(out[i]!), i); // 同键重复：后者覆盖前者索引（与 Go 同）
  }
  for (const d of incoming) {
    const k = mergeKey(d);
    const at = idx.get(k);
    if (at === undefined) {
      idx.set(k, out.length);
      out.push({ ...d });
    } else {
      out[at] = { ...d }; // 整条替换
    }
  }
  return out;
}

/**
 * 整集替换会**丢失多少条既有声明**（2026-10-05 实测撞到后补）。
 *
 * ★ 为什么要显式算这个数：
 *   Go 的定稿分两种来源（`proposal.go:196-208`）：
 *     · `manual` / `llm-revise` 提案 ⇒ **整集替换**（`Decls` 被定义为"完整新声明集"）
 *     · `loop` 增量提案 ⇒ 按键合并（只带单条；整集替换会 wipe 掉其余契约，含种子）
 *   ⇒ 一次 `manual` 审批若只带 1 条声明，**其余全部契约（含种子）会被静默 wipe**。
 *     实测确实如此：manual 提案带 1 条 ⇒ 审批后 `dsl.json` 从 2 条变成 1 条，
 *     **不报错、不留痕、提案本身照样标 approved**。
 *   这是 Go 的原设计（调用方责任：manual 提案必须带全集）。
 *   本实现**照搬不拦** —— 拦它要改行为，且会误伤合法的"故意精简契约"。
 *   但按本仓"不许静默"的既定原则，**把丢失数写进审计证据** ⇒ 事后可查、`git log` 可见。
 *
 * @param current 现有权威集（`null` = 还没有 dsl.json ⇒ 无从丢失）
 * @param incoming 本次要写入的声明集
 */
export function droppedDeclCount(current: TSDLDecl[] | null, incoming: TSDLDecl[]): number {
  if (!current) return 0;
  const key = (d: TSDLDecl): string => `${d.rule}|${d.probe ?? ''}`;
  const before = new Set(current.map(key));
  let dropped = 0;
  for (const k of before) {
    if (!incoming.some((d) => key(d) === k)) dropped++;
  }
  return dropped;
}
