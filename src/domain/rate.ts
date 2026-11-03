/**
 * rate.ts —— 「一个率」的**唯一产出点**（零依赖纯函数）。
 *
 * ## 它治的病（`docs/todo.md` §一 · 2.5「分母口径」）
 * 同一件事在仓里被两处各算一遍、或**分子不是分母的子集** ⇒ 数可以 >100%，而两处都能"看起来正常"。
 * 实测（2026-11-03）：`design_line.ts` 的 ⑥ 用 `covered.size / sourceFiles.length`，而 `covered`
 * （design-db 里**全部** path）里有 3 份不在 `sourceFiles` 里
 * （`docs/VISION.md` · `src/infrastructure/analysis/structure/feature_map.ts` · `src/infrastructure/render/inject_replay.ts`）
 * ⇒ 那个「覆盖率」**恒偏高**，且同一个 ⑥ 里的 `uncovered` 用的是另一把尺。
 *
 * ## 三条不变量（缺一条这个数就不许印出来）
 * ① **每个率必须声明它回答哪个问题**（`question`）—— 没有问题的百分比 = 两个答案共用一个名字；
 * ② **分子必须是分母的子集** —— 越界就**逐项报出差集**（不是只抛一句"不合法"：下一个人要知道是哪几项）；
 * ③ **分子与分母两个数必须同时出现在文本里** —— 只给分子等于没算（AGENTS-RULES 0.12 第 3 条）。
 *
 * ## 为什么住 `domain` 且**零 import**
 * `behavior-cases` 判据的 harness 把目标文件单独转译再 import（`docs/SUBAGENT-HANDBOOK.md` §8）
 * ⇒ 目标必须零依赖。所以「百分比怎么印」的唯一实现 `ratioPercent` 也住这里，
 * `payload_budget.ts` 反过来 import 它 —— **一处权威**，不是两份取整口径。
 */

/**
 * 百分比（一位小数）；★ 分母为 0 ⇒ `—`（没有分母就说没有，不印 0.0 冒充"很小"）。
 *
 * ★★ **为什么它住 `rate.ts` 而不是 `payload_budget.ts`**（下一个想搬走它的人先读这段）：
 *   它是 `rateOf` 的**格式化原语**（"这个率印成什么样"与"这个率回答哪个问题"是同一件事的两半），
 *   而 `rate.ts` **必须零 import** —— 两个硬约束同时要求它在这里：
 *   ① `behavior-cases` 判据的 harness 把目标文件单独转译再 import（`docs/SUBAGENT-HANDBOOK.md` §8）；
 *   ② `scripts/design-node-coverage.mjs` 是 plain node 直跑的 `.mjs`，它 `import '../src/domain/rate.ts'`
 *      ⇒ `rate.ts` 一旦有相对 import，那条命令就解析不到（实测：`ERR_MODULE_NOT_FOUND … rate.js`）。
 *   ⇒ 所以是 `payload_budget.ts` **反向** import 这里，**不是**这里去 import 它。
 *   ★ 别再搬回去：搬一次就有两份 `toFixed(1)`，而"一份印 0.0、一份印 —"两个出口都看起来正常。
 */
export function ratioPercent(part: number, total: number): string {
  if (!(total > 0)) return '—';
  return ((part / total) * 100).toFixed(1);
}

/**
 * 「一个率回答哪个问题」的**闭集** —— 每条 = 一个**产出点**。
 *
 * ★ 不许手写第二份：`tests/rate/rate.test.ts` 用 TypeScript AST 扫全仓 `rateOf({ … question: '<字面量>' })`
 *   的实参，与本表做**双向**比对 —— 多出来的枚举值 = 死枚举；调用点里出现表外值 = 自造问题。
 * ★ 同一条 `id` 被**两个**调用点用 = 「同一问题两个答案」= 2.5 的红线（同一个率不许有两个名字）。
 */
export const RATE_QUESTIONS = [
  { id: 'design-db-covers-source', label: '设计 DB 副本 → 源码文件' },
  { id: 'sheet-nodes-cover-src', label: '设计册节点 → src 文件' },
  // ★ 2026-11-03（M1a）：判据 kind → 投影去向的落地率 —— 唯一调用点 = `gen_design_db.ts#expectationKindCoverage`。
  //   这条问题回答的是「声明要进 design-db 的 kind，实际进了多少」（分子=落地条目，分母=可投影条目）；
  //   声明不投影的 kind 不进这个率（它们按 `EXPECTATION_KIND_PROJECTION` 的载体豁免，条数另行印出）。
  { id: 'expectation-kind-landed', label: '判据 kind 落地 → design-db 条目' },
] as const;

/** 一个率的 `question` 取值（从 `RATE_QUESTIONS` 派生，别再手写一份字面量联合类型）。 */
export type RateQuestion = (typeof RATE_QUESTIONS)[number]['id'];

/** `rateOf` 的入参。 */
export interface RateInput {
  /** 分子：分母的子集里有多少项 */
  n: number;
  /** 分母 */
  d: number;
  /** 这个率回答哪个问题 —— 决定它印什么标签，也决定它只能有一个产出点 */
  question: RateQuestion;
  /**
   * 分子成员（强烈建议给）：给了才能**逐项**报出「哪几项不在分母里」。
   * 不给 ⇒ 只能做 `n > d` 的数字检查，报不出是哪几项（那也必须说出来，不许装作查过）。
   */
  nItems?: readonly string[];
  /** 分母成员（与 `nItems` 成对给） */
  dItems?: readonly string[];
}

/**
 * 把一个率渲染成**自带问题**的文本，并**强制**分子 ⊆ 分母。
 *
 * 返回 `{ text, question }`：`text` 形如 `设计 DB 副本 → 源码文件 = 383/479 = 80.0%`
 * —— 问题、分子、分母、百分比四件同时在场，缺任何一件读端都会把它误认成另一个数。
 *
 * 抛错的三档（都是"这个数不可信"，不是"参数不合法"）：
 * · `question` 不在 `RATE_QUESTIONS` 里 ⇒ 自造问题 = 第二处权威；
 * · 分子有项**不在**分母里 ⇒ 这个率可以 >100%，**逐项列出**差集后抛；
 * · `n` / `d` 与传进来的清单条数对不上 ⇒ 报的数与算的数不是一回事。
 */
export function rateOf(x: RateInput): { text: string; question: RateQuestion } {
  const q = RATE_QUESTIONS.find((r) => r.id === x.question);
  if (!q) {
    throw new Error(
      `rateOf：question「${String(x.question)}」不在 RATE_QUESTIONS 里 —— 自造问题 = 第二处权威` +
        `（合法值：${RATE_QUESTIONS.map((r) => r.id).join(' / ')}）`,
    );
  }
  if (!Number.isInteger(x.n) || !Number.isInteger(x.d) || x.n < 0 || x.d < 0) {
    throw new Error(`rateOf(${x.question})：n/d 必须是非负整数 —— 实测 n=${x.n} d=${x.d}`);
  }
  if (x.nItems && x.dItems) {
    const dSet = new Set(x.dItems);
    const nUniq = [...new Set(x.nItems)];
    const outside = nUniq.filter((k) => !dSet.has(k));
    if (outside.length) {
      throw new Error(
        `rateOf(${x.question})：分子有 ${outside.length} 项**不在分母里** ⇒ 这个率可以 >100%（分子必须是分母的子集）。\n` +
          `  n 不在 d 里：${outside.join(' ; ')}（共 ${outside.length} 个）· n=${x.n} d=${x.d}`,
      );
    }
    if (nUniq.length !== x.n) {
      throw new Error(
        `rateOf(${x.question})：n=${x.n} 与分子清单的去重项数 ${nUniq.length} 对不上 —— 报的数与算的数不是一回事`,
      );
    }
    const dUniq = new Set(x.dItems).size;
    if (dUniq !== x.d) {
      throw new Error(
        `rateOf(${x.question})：d=${x.d} 与分母清单的去重项数 ${dUniq} 对不上 —— 报的数与算的数不是一回事`,
      );
    }
  } else if (x.n > x.d) {
    throw new Error(
      `rateOf(${x.question})：n=${x.n} > d=${x.d} ⇒ 分子不是分母的子集。\n` +
        `  ★ 本次没给 nItems/dItems ⇒ **报不出是哪几项**（只能报这两个数）—— 要逐项点名就传两个清单。`,
    );
  }
  const pct = ratioPercent(x.n, x.d);
  const text =
    pct === '—' ? `${q.label} = ${x.n}/${x.d}（分母为 0 ⇒ 不算率）` : `${q.label} = ${x.n}/${x.d} = ${pct}%`;
  return { text, question: x.question };
}
