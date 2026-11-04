/**
 * task_gate_basis —— 任务闸「放行支」的**词表 + 分诊表**（唯一住处；`src/application/write_gate.ts` 只转出它）。
 *
 * ## 它治的是哪条病（2026-11-04 · `docs/todo.md` G13 / G17）
 * 「无卡写」那道门原先把「无卡」定义成 `card_id IS NULL` —— 于是**结构上不可能有卡的支**
 * （设计侧声明豁免 / 闸对这批文件是瞎的 / 本项目不用任务系统）和**本来有卡、只是凭证没记下来**的支
 * （covered / authorized）全被算成「无卡写」⇒ 实测 31 条里 29 条是噪音 ⇒ 门被基线关掉（0.16）。
 *
 * ⇒ 分诊只回答**一个问句**：「这一支放行的写，**本来就该有卡吗？凭什么？**」三档，可机械判定：
 *
 * | 档 | 判据（看**支的语义**，不看读数的缺失） | 计数? | 支 |
 * |---|---|---|---|
 * | `card-required` | 放行时**没核过任何卡**，而文件本来可以挂卡 ⇒ 无卡就是欠账 | **计数** | files-not-in-design · first-run-unclaimed |
 * | `card-guaranteed` | 这一支**成立本身**就意味着已经核到一张卡（卡在，凭证可能没记下来） | 不计数，另计「凭证未记」 | covered · authorized |
 * | `card-impossible` | **结构上不可能**有卡 | 跳过 | exempt · unaddressable · no-files · no-feature-for-root |
 *
 * ## ★ 为什么必须是三档（可判：想删掉中间那档会怎样）
 * `covered` / `authorized` 的语义是「支成立 ⇒ 卡已核到」—— `write_gate#evaluateTaskGate` 那两个 return
 * 只在 `claimed` 卡存在时才给。把它们并进 `card-required` ⇒ 「有卡、只是没记凭证」被读成「没有卡」
 * = 0.12 的原病（失败与「没有」不可区分）；并进 `card-impossible` ⇒ 那两支里**真**出现「本没有卡」
 * 就没人数的出来。⇒ 中间那档是**最小完备划分**，不是多余。
 *
 * ## 不变量（三条，都能变红）
 * 1. `BASIS_CARDABILITY` 是 `Record<TaskGateBasis, BasisCardability>` ⇒ **穷尽**：谁往 union 加第 9 个支
 *    而不分类，`tsc --noEmit` 当场报错（不是「记得同步另一个文件」）。
 * 2. 支名不在闭集里 ⇒ 一律 `'unknown'`，**绝不冒充**「不该有卡」（冒充 = 静默跳过）；对账器必须把
 *    `!card_id && unknown` 当**硬红**（0.12：判不了 ≠ 通过）。
 * 3. 本文件**零 value import**（连 `import type` 都不用）：`behavior-cases` 的执行核要单独转译并 load 它
 *    （`E-CRIT-006` / `domain/batch_diff.ts` 头注的实测）。分诊判据住在**load 得起来**的地方才有行为落点
 *    —— 住在 `write_gate.ts`（20+ 个值 import）上就只能退化成文本代理。
 */

/** 任务闸放行的依据分类（★ 唯一取值处；`applicable:false` 只许前两格） */
export type TaskGateBasis =
  | 'no-files' // 没有落在项目根内的文件
  | 'no-feature-for-root' // 没有任何设计册住在本项目根下（storage#isSameProject；= 本项目不用任务系统）
  | 'files-not-in-design' // 有 feature 指到根，但这批文件不在任何一条里（新建 / 未纳入设计 / 未声明排除）
  | 'unaddressable' // 有文件节点**收集失败**（缺 path）⇒ 闸对这批文件是瞎的（放行 + 留痕，不再抛错）
  | 'exempt' // **设计侧声明豁免**：节点 `gate='exempt'`（AND 语义）**或**册级 `excluded` 前缀声明
  | 'authorized' // **按 run 授权**（`authorize`）—— 本批全部落在该 scope 内 ∧ scope 里有你领的 claimed 卡
  | 'first-run-unclaimed' // 首跑模式（`AGENT_IO_FIRST_RUN=1`）下「没挂到已领取任务」只点名不拦
  | 'covered'; // 有覆盖 feature，已逐个判过任务卡

/** 分诊结果（三档；见文件头表格） */
export type BasisCardability = 'card-required' | 'card-guaranteed' | 'card-impossible';

/**
 * ★★★ 支 → 分诊的**唯一分类表**（`Record<TaskGateBasis, …>` = 穷尽：漏一个支编译不过）。
 *
 * ★ 改这张表等于改门的分子分母 ⇒ 每条都要能说出依据：
 * · `files-not-in-design` = **card-required**：这正是「绕开设计线」本身（文件不在册上就写），
 *   所以它是本门唯一保留的牙齿（门红就红在它上面）；
 * · `first-run-unclaimed` = **card-required**：该支**就是**「有册子、但这批文件没挂到已领卡」，
 *   首跑开关只是让它不拦，**不等于**「本该有卡变成不该有卡」（若归 skipped，一个环境变量就能让整扇门失明）；
 * · `covered` / `authorized` = **card-guaranteed**：支成立即已核到卡（见文件头）；
 * · `exempt` = **card-impossible**：设计侧声明「这里是量具 / 测试 / 文档，不立卡」（G17）；
 * · `unaddressable` = **card-impossible**：闸**判不了**这批文件在不在册（缺 path 的节点指不出文件）
 *   ⇒ 报「判不了」而不是「没有卡」（0.12）；它自己的检测点是「缺 path 的 file/doc 节点必须为 0」；
 * · `no-files` / `no-feature-for-root` = **card-impossible**：连文件 / 连任务系统都没有。
 */
export const BASIS_CARDABILITY: Record<TaskGateBasis, BasisCardability> = {
  'no-files': 'card-impossible',
  'no-feature-for-root': 'card-impossible',
  'files-not-in-design': 'card-required',
  unaddressable: 'card-impossible',
  exempt: 'card-impossible',
  authorized: 'card-guaranteed',
  'first-run-unclaimed': 'card-required',
  covered: 'card-guaranteed',
};

/** 分诊 + 一个「判不了」档（支名不在闭集里 —— 不冒充任何一档） */
export type BranchCardability = BasisCardability | 'unknown';

/** 闭集（`BASIS_CARDABILITY` 自己的键；★ 不另列一份清单） */
const KNOWN_BRANCHES: ReadonlySet<string> = new Set(Object.keys(BASIS_CARDABILITY));

/**
 * ★ 写账里的**支名** → 分诊。
 *
 * 键空间比 `TaskGateBasis` 多两类，判据都在这里（读端不许再各写一份）：
 * · `'rollback'` —— 回滚通道（`write_log#writeLogRowOf` 在 `kind='rollback'` 时记的就是这个支名）。
 *   它**本来就不过闸**（回滚不是「一次新的写」）⇒ 无卡是对的 ⇒ `card-impossible`；
 * · 空 / 未知支名 ⇒ `'unknown'`（**不是** `card-impossible`）：判不了就该说判不了（0.12）。
 */
export function cardabilityOfBranch(branch: string | null | undefined): BranchCardability {
  const b = String(branch ?? '')
    .trim()
    .split(':')[0]; // ★ `exempt:by` 这类带附注的写法只取前缀（与对账器同一口径）
  if (!b) return 'unknown';
  if (b === 'rollback') return 'card-impossible';
  return KNOWN_BRANCHES.has(b) ? BASIS_CARDABILITY[b as TaskGateBasis] : 'unknown';
}

/**
 * ★★★ **「这一条算不算无卡写」的唯一判定式**（对账器不许再自己写 `!card_id`）。
 *
 * 判据 = 「该有卡而没卡」（`card-required` ∧ 没有卡凭证）。三条异义分支都能变红：
 * · `covered` / `authorized` 无卡 ⇒ **false**（G13：支名说「已核到卡」，空 card_id 是**凭证没记下来**，
 *   不是「没有卡」—— 把它算进分子就等于把 0.12 的原病请回来）；
 * · `exempt` / `unaddressable` / 不适用 ⇒ false（结构上不可能有卡）；
 * · 未知支名 ⇒ false（**不冒充欠账**；它由对账器另行当硬红处理）。
 */
export function countsAsNoCardWrite(branch: string | null | undefined, cardId: string | null | undefined): boolean {
  if (cardId) return false;
  return cardabilityOfBranch(branch) === 'card-required';
}

/**
 * ★ **「有卡、但凭证没记下来」**（G13 的另一半）：`card-guaranteed` 支却拿不到 `card_id`。
 *
 * ★ 它**不**进「无卡写」的分子（那不是「绕开设计线」），但也**不许被吞掉**：
 * 对账器单独计数并按棘轮判「**新增**即红」（冻结历史 15 条 + 新增恒严）。
 * 判据可判：写端修好之后（A7 拿不到 actor 也照样记卡）这个数**只减不增**。
 */
export function countsAsCredentialMiss(branch: string | null | undefined, cardId: string | null | undefined): boolean {
  if (cardId) return false;
  return cardabilityOfBranch(branch) === 'card-guaranteed';
}
