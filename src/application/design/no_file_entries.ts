/**
 * 「**本 feature 的 DSL 里没有任何文件节点**」这件事的**唯一住处**（说明文本）。
 *
 * ## 为什么单独立此文件
 * T93 之后，`semantic.files` **只放文件**（聚合/模块节点已退出该容器）。副作用：
 * **聚合模式**（`import_project` 的 `functional_mode` 功能聚合 / `design_mode` 设计草图）
 * 下 `semantic.files` **本就是空的**（那两种模式**故意**把"文件身份"折叠进模块节点）。
 * 于是**同一判断**（"没有文件级条目"）在 **三处**各自触发：
 *   · `dsl_ops/status_tools.ts`   —— `check_status`
 *   · `intent/consistency.ts`     —— `consistency_check`
 *   · `lifecycle/scaffold.ts`     —— `scaffold`
 * 且旧消息只说「没有 semantic.files，无法……」，**不说为什么** —— 读者会误以为
 * "数据坏了 / 文件丢了"，而真相是**聚合模式有意为之**。
 *
 * ## 分工（本仓分层约定）
 *   · **判据**（有没有文件级条目）= `domain/semantic.ts` 的 `hasFileEntries`（纯领域事实）。
 *   · **说明文本**（为什么 + 出路）= 本文件的 `noFileEntriesMessage`（编排/用户指引 ——
 *     要引用 `import_project` 的**导入模式**入参，是"怎么用"而非"是什么"）。
 * ⇒ 三处**都** `if (!hasFileEntries(dsl.semantic)) throw new Error(noFileEntriesMessage(feature))`，
 *   判据与措辞**各只有一处**，消息对三处**逐字相同**。
 *
 * ★ 消息**刻意枚举全部三种"按文件粒度"的操作**（检查状态 / 设计对拍 / 生成代码骨架），
 *   而不接收一个 `what` 参数 —— 这样三个调用方产出的文本**逐字一致**（便于对账/断言），
 *   且读者一眼看到"这些操作都不适用"，比只说自己那一个更有用。
 */
export function noFileEntriesMessage(feature: string): string {
  return [
    `feature "${feature}" 的 DSL 里**没有任何文件节点**（semantic.files 为空）。`,
    '',
    '★ 这是什么状态：**不是坏数据、也不是"文件丢了"** —— 本 feature 的语义层本来就没有逐文件条目。',
    '★ 为什么（多半）：本 feature 是用**聚合模式**导入的 —— import_project 的 functional_mode（功能聚合）/',
    '  design_mode（设计草图）**故意**把"文件身份"折叠进模块节点，语义层于是只留模块、不留文件。',
    '  （次可能：手工建的 DSL 从未列过文件。）',
    '★ 出路：**按文件粒度**的操作 —— 检查状态 / 设计对拍 / 生成代码骨架 —— 在本 feature 上不适用；',
    '  要按文件粒度操作，请**用默认模式重新 import_project**（不带 functional_mode / design_mode），',
    '  它会把每个文件逐条列进 semantic.files。',
  ].join('\n');
}
