// ★★ T170b：只为**类型级断言**（防"字段清单与 interface 漂移"）而 import type —— **不产生运行期依赖**。
import type { AddNodeInput, UpdateNodeInput } from './node_ops.js';
import type { AddFileInput, UpdateFileInput } from './file_ops.js';
import type { AddEdgeInput } from './edge_ops.js';
// ★★ T198：`approval.review` 的 `data.decision` 值域 —— ★ **值导入**（不是 type）：
//   描述里要把它**渲染出来**，而渲染就必须读值。★ 值域**唯一住处**在该实现里，这里只是**引用**它
//   （★ 这正是本表"判据一处"的做法：不手抄第二份，改了实现描述自动跟）。
import { APPROVAL_DECISIONS } from '../../observe/reconcile/approval.js';

/**
 * `edit_dsl` 各 `type`/`op` 的 **data 契约表**（唯一判据）。
 *
 * ## 为什么要有它（★ 2026-10-11 T170 —— 有【代价读数】的缺口）
 * 黑盒实验（一个**不许读源码**的子代理走完整工作流）实测：
 * **24 次调用里 8 次失败/被拒（33%）**，而它们**全是"试形状"** ——
 * 它原话：*"我按 describe 猜…… → 空参试跑被回执一句 `insert 需要 code（新代码）` 直接点名。
 * **也是回执救的场。**"*
 * ⇒ 根因：**"某个 `type`/`op` 需要哪些 `data` 字段"此前只以【散落的命令式 throw】存在**
 *   （`update_feature.ts` 里 19 处 `if (!op.data?.X) throw`）⇒ ★ **LLM 看不见**，
 *   只能**故意发一个残缺请求、读报错**来发现字段 —— 每次一个字段，一次调用。
 *
 * ## 判据一处（照本仓头号纪律）
 * 本表是**唯一来源**，两个出口都从它派生：
 *   1. **`checkOpSpec(op)`** —— `applyOperation` 的入口校验（**CLI 面也走这里**，见 `plumbing` 的说明：
 *      "CLI 不做 zod 校验" ⇒ 所以守卫必须在 [B]，不能只放在 zod schema 里）；
 *   2. **`renderOpSpecs()`** —— 渲染进 `edit_dsl` 的 `description`（**LLM 一定会看到的地方**）。
 * ★ **不许**再在别处写"某 type 需要某字段"的第二份清单（那正是本仓头号病根）。
 *
 * ## 范围（★ 说清不做什么，免得读端以为"全在这"）
 * · 本表管**形状**（该给哪些键、哪个键必须非空）——
 *   ★ **不管语义**（"这个 node_id 存在吗" / "这个 status 值合法吗" 仍在各自的 `[B]` 里）。
 * · ★★ **不管"可选字段字典"**：`node.add` 的领域字段（`label`/`type`/`status`/`decision`/`shapes`…）
 *   大多**可选** ⇒ 它们的问题不是"必需"而是"**有哪些**" ⇒ ★ 那一半**本表没覆盖**，
 *   记为下一笔（见 `docs/todo.md` T170）。本表在 `note` 里给出**指路**。
 */

/** 一条 `(type, op)` 的 data 契约。 */
export interface OpSpec {
  /** `operations[].type` */
  type: string;
  /** 该 type **合法**的 `op` 全集（★ 一处；替代原先散落的 `if (op.op !== 'x') throw`） */
  ops: string[];
  /** 是否必须给 `operations[].id` */
  idRequired: boolean;
  /**
   * ★ `id` **到底填什么**（只在该 type 特殊时写）。
   * ★★ 为什么要它（T171 实测）：「`id` 是节点 id 还是路径」**各 type 不一样** ——
   *   我一度在报错里写死成「文件节点 id **或**仓库相对路径」，而那是照 `decision` 的说明抄的通用句
   *   ⇒ **`api` 并不吃路径** ⇒ 黑盒实验里 agent 照它填了路径 ⇒ `文件 "src/mathutil.ts" 不存在` ✗
   *   ⇒ 现在**按 type 各自声明**，报错文案**从本字段派生**（仍是判据一处）。
   */
  idNote?: string;
  /**
   * ★★★ **只有这几个 op 要 `operations[].id`**（2026-10-21）—— 用于 `idRequired:false` 而**部分 op 仍需 id** 的 type
   * （目前只有 `todo`：`add` 不用 id（自动从 summary 生成），而 `link`/`update`/`retire`/`delete` 都要）。
   *
   * ★ 为什么要这个字段（而不是留在 handler 里 `if (!op.id) throw`）：
   *   ① 那是**第二份判据**（本表是「哪些键必须给」的唯一住处）；
   *   ② 报错文案在表里 ⇒ 也**渲染进 `edit_dsl` 的描述**（提前看得见，而不是发一次残缺请求才知道）。
   * ★ 与 `idRequired:true` 的区别：那个是「**每个** op 都要 id」（node/edge/file/task…）。
   */
  opsRequiringId?: readonly string[];
  /** 【按 op 细分】的必需 data 键：`op → 键名清单`（未列出的 op ⇒ 无必需键） */
  required: Record<string, string[]>;
  /** 【按 op 细分】的"至少给一组"：`op → 若干组，每组内全部要给` */
  anyOf?: Record<string, string[][]>;
  /** 人读补充（进描述；★ 只写本表管不了的那部分，别写成第二份判据） */
  note?: string;
}

/**
 * ★ **唯一判据表**。改这里 = 改判据（校验与描述同时跟着变）。
 * 每条的 `required` 逐条对照过改动前的 `if (!op.data?.X) throw`（见提交信息里的对照表）。
 */
export const OP_SPECS: readonly OpSpec[] = [
  {
    type: 'node',
    ops: ['add', 'update', 'delete', 'move'],
    idRequired: true,
    required: { move: [] },
    // ★★★ 2026-10-11（T170b）：**这里原先写的是「见 `add_node` 的字段表」—— 而 `add_node` 根本不是工具**
    //   （66 个工具里没有）⇒ ★ **那句"指路"是【死路】**：读它的人去找 `add_node`，找不到。
    //   ⇒ 现在**把字段真列出来**（★ 机械提取自 `AddNodeInput` / `UpdateNodeInput` 的 interface，非手抄）。
    //   ★ 防漂移：下面 `NODE_DATA_KEYS` 有**类型级断言** —— interface 改了而这里没跟 ⇒ **`tsc` 会红**。
    note:
      '★ `data` 的**领域字段**（★ **全部可选** —— 一个都不给也能建/改，只是信息少）。' +
      '★ `feature` / `node_id` **不要放 data**（前者走顶层，后者走 `operations[].id`）：\n' +
      '        · 文字与样式：`label` `description` `type` `status` `bg` `color` `border` `borderRadius` ' +
      '`shape`(rect|rounded|circle|diamond|freeform) `shadow` `opacity`\n' +
      '        · 几何：`x` `y` `width` `height`\n' +
      '        · 结构与内容：`layer` `host`(宿主节点 id) `swimlane` `shapes` `content` `sub_dsl`(子图 DSL) ' +
      '`attributes`(Record<string,string|number|boolean>) `path`(文件指针=仓库相对路径，校验见 `node_ops.ts`)\n' +
      '        · 语义：`decision`（决策卡对象，**字段形状同下面 `decision` 那张表**）· ' +
      '`decision_note`（**update 专有**）· `author`（**update 专有**，`human`｜`llm`）',
  },
  { type: 'edge', ops: ['add', 'update', 'delete'], idRequired: true, required: { add: ['from', 'to'] } },
  {
    type: 'file',
    ops: ['add', 'update', 'delete'],
    idRequired: true,
    required: { add: ['path', 'responsibility'] },
    // ★★★ T181：「**设计侧先标记待删**」三步流程的第一步**只能从这里进** ——
    //   而此前 `lifecycle` **一个字的说明都没有**（`FILE_DATA_KEYS` 里有、描述里没有）
    //   ⇒ ★ **能力被藏在 MCP 面之外**（本仓已为此记过账：`bricks/signal_review` 同族）。
    //   ⇒ 这里补一句**指路**；★ 真正的判据仍只有一处 = `semantic.ts` 的 `assertLifecycle`
    //     （本 note 只说"有这条路 + 它是什么轴"，**不重述合法值/必填字段**，避免第二份判据）。
    note:
      '`data.lifecycle` = **文件生命周期轴**（与 `data.status` 的「实现进度」轴 `draft|in_progress|done` **不是一回事**）：\n' +
      '        ★ **标记待删** ⇒ `data.lifecycle = {status:"deprecated", retire_reason:"为什么该删"}`（`retire_reason` 必填）；\n' +
      '        ★ 撤回标记 ⇒ `{status:"active"}`；★ **根本没有 `archived` 这个值** —— 归档 = 走 `archive` 工具' +
      '（把文件**移出 DSL** + 写**归档库**）⇒ 已归档的文件**不在设计 DSL 里**，没有 status 可写（T183）。\n' +
      '        ★ 写入是**合并**（只给 `retire_reason` 不会把 `status` 弄丢）。合法值/必填字段由 `assertLifecycle` 一处判定。',
  },
  {
    type: 'api',
    ops: ['add', 'update', 'delete'],
    idRequired: true,
    idNote: '所属 `file` 节点的 id（★ **不是路径** —— 实测填路径会报「文件不存在」）',
    required: { add: ['signature'], delete: ['signature'] },
    anyOf: { update: [['expected_apis'], ['signature']] },
    note: '`update` 二选一：① **整块重写** `data.expected_apis=[{signature,notes?},…]`（**推荐**，不看旧串）；② 单条改 `data.signature`=**原签名串逐字**',
  },
  { type: 'binding', ops: ['update'], idRequired: true, required: { update: ['file_id'] } },
  {
    type: 'status',
    ops: ['update'],
    idRequired: true,
    required: { update: ['status'] },
    // ★★★ T334（2026-10-15）：**置 `done` 的证据怎么传，此前在这张表里【一个字都没有】** ——
    //   而写端 `updateStatus`（`status_tools.ts:82`）**有闸**：`status==='done'` 且无 `evidence` ⇒ 抛。
    //   ⇒ 调用方**只能**从本段知道"要传什么"。★ 之前没有这段 ⇒ 能力**在 MCP 面之外**（同族：T181 `lifecycle`）。
    //   ★ 这里是**渲染**（不新增判据）：真正的判据只有一把尺 = `domain/overlay.ts#validateProgressEvidence`
    //     （三档形状逐字定义在 `ProgressEvidence`）。
    note:
      '★ `data.evidence`（**T334：`op=update` 时可选、`data.status="done"` 时【必须给】** —— 否则被拒，' +
      '理由见回执）：**置"完成"必须带一条能被复核的证据**（"不许默默勾上"）。★ 形状**三档择一**（按 `kind` 判别）：' +
      '① `{kind:"expectations", all_green:true, unsupported:0}` —— **机器判**（expectations 全绿；`unsupported` 必须为 0 —— **"没判"≠"通过"**）；' +
      '② `{kind:"reading", command, observed, at}` —— **一条可复跑的读数**（跑什么 / 看到什么 / 什么时候跑的）；' +
      '③ `{kind:"attestation", by:"human"|"llm", at, why}` —— **显式人工确认**（署名）。' +
      '★ `draft` / `in_progress` **不需要** evidence。★ 判据唯一住处 = `domain/overlay.ts#validateProgressEvidence`。',
  },
  {
    type: 'annotation',
    ops: ['add', 'resolve'],
    idRequired: false,
    required: { add: ['text'], resolve: ['annotation_id'] },
  },
  {
    type: 'approval',
    ops: ['submit', 'review'],
    idRequired: false,
    required: { submit: ['annotation_id'], review: ['annotation_id', 'decision', 'reviewer'] },
    // ★★ 2026-10-12 T198：值域此前**不在任何 MCP 描述里** ⇒ 读者只能试错
    //   （实测：`data.decision="approved"` ⇒ `未知决策: approved`）。
    //   ★ 这里把【动作词】的合法值写清；★★ 值域**唯一住处** = `observe/reconcile/approval.ts` 的
    //   `APPROVAL_DECISIONS` —— 下面这句是它的**渲染**（不是第二份判据）⇒ 改了实现，描述自动跟。
    note:
      '★ `data.decision`（op=review 必填）= **动作词**（★ **不是状态词** —— 填 `approved`/`rejected` 会被拒，' +
      '报「未知决策」）。合法值恰为 ' +
      APPROVAL_DECISIONS.length +
      ' 个：`' +
      APPROVAL_DECISIONS.join('` / `') +
      '`（★ 值域唯一住处 = `observe/reconcile/approval.ts` 的 `APPROVAL_DECISIONS`）。' +
      '另 `data.reviewer`（op=review 必填，审批人名称）· `data.comment`（可选，审批意见）。' +
      '★ op=submit 另可选 `data.assignee` / `data.submitter`。',
  },
  {
    type: 'snapshot',
    ops: ['save', 'rollback', 'delete'],
    idRequired: false,
    required: { save: ['label'], rollback: ['snapshot_id'], delete: ['snapshot_id'] },
  },
  {
    type: 'layout',
    ops: ['apply'],
    idRequired: false,
    required: {},
    note: '`data.algo` 可选（dag | force | grid，缺省 dag）；另有 direction / h_gap / v_gap 可选',
  },
  { type: 'simulation', ops: ['reset'], idRequired: false, required: {} },
  {
    type: 'tag',
    ops: ['add', 'delete'],
    idRequired: false,
    required: { add: ['tag'], delete: ['tag'] },
    // ★ T175：`data.files` 此前**只在描述的另一段里说过**（那段被收进本表时差点漏掉）——
    //   逐项核对后补进来：★ **删重复之前必须确认"新家有没有"**，否则就是信息消失。
    note: '`data.files` = **成员文件**（仓库相对路径 **或** 文件 id）—— 省略 ⇒ 只动这个 tag 自身；给了 ⇒ 把这些文件挂到这个功能标记下',
  },
  {
    type: 'decision',
    ops: ['update', 'expectation.add', 'expectation.remove'],
    idRequired: true,
    idNote: '文件/文档节点 id **或**仓库相对路径（`resolveDecisionTarget` 两种都认）',
    required: { update: ['summary'] },
    note:
      '★ **`data` 各字段的形状（2026-10-11 T174 从实现逐个读出 —— 照填）**：' +
      '`rationale` / `consequences` / **`acceptance`** / `thread` = **字符串**（★ **不是数组**）· ' +
      '`votes` = 数字 · `evidence_source` / `tags` = **字符串数组** · ' +
      '`status` = `active`｜`draft`（★ 原 `superseded` 已退场，见 `NodeDecision.status` 注释） · `author` = `human`｜`llm` · ' +
      '`note` = **字符串**（修订说明）· ' +
      '`dissent` = 数组，每项 `{option: 字符串(必填), votes?: 数字, evidence_source?: 字符串数组}`（★ **未决分歧**放这，待对拍）· ' +
      '`alternatives` = 数组，每项 `{option, rejected_because}` 两个都要（★ **已被排除的方案**放这，缺 `rejected_because` 会被拒）',
  },
  {
    // ★★★ 2026-10-17（T11 · `.agent-io/design/task-system-plan.dsl.json#task_home`）：
    //   **任务格的唯一写端**。`id` = 任务格所在的**节点 id**（任务与节点同居）——
    //   ★ 不是顶层 `tasks[]`，也不是 overlay 锚点。
    type: 'todo',
    // ★★★ 2026-10-21：加 `follows`（**跑环继任链**：把这张卡接到另一张卡下面 / 摘成链根）。
    //   ★ 为什么是独立 op 而不是塞进 `update`：update 回答「这张卡**要做什么**变了吗」（旧值压 history），
    //     follows 回答「它在**哪条链**上」—— 内容变更与结构变更是两件事。
    //   ★ 也是**唯一能造出环**的入口（add 只加叶子）⇒ 「链必须无环」那条判据真正被考到的地方。
    ops: ['add', 'link', 'update', 'follows', 'retire', 'delete'],
    idRequired: false,
    opsRequiringId: ['link', 'update', 'follows', 'retire', 'delete'],
    // ★★★ 2026-10-21：**三个新 op 的必填键**（规则：**增删改查四个动作都要配齐**）。
    //   · update：summary（改成什么）+ reason（**为什么改** —— 无理由 = 悄悄改判据）
    //   · retire：reason（为什么作废；★ 必须点名**被谁取代**，否则考古不了）
    //   · delete：reason（为什么物理删；★ 只给「从未生效的误建」用）
    //   ★ 这里是**唯一判据**：handler 里不再判一遍（`checkOpSpec` 在 `applyOperation` 入口跑）。
    required: {
      add: ['summary'],
      link: ['node_id'],
      update: ['summary', 'reason'],
      // ★ 2026-10-21：`follows` 只把 **reason** 钉成必填 —— `data.follows` 本身**不进 required**，
      //   因为它的合法值里有一个 `null`（= 摘成链根），而 required 的判据把 null 当"缺"。
      //   ⇒ 「给了这个键吗」由 handler 判（`'follows' in data`）：**没给键**与**给了 null** 是两种意图，
      //     不能混（前者是忘记填，后者是明确摘链）。
      follows: ['reason'],
      retire: ['reason'],
      delete: ['reason'],
    },
    note:
      '★ **无节点任务**（2026-10-18 Q5）：和 task **同一套状态机/同一套 claim/complete/void 语义**，' +
      '区别只在"挂在哪"（task 挂 geometry.nodes[].task，todo 挂顶层 todos[]）。' +
      '★ add 只需 data.summary（可选 data.decision: creator/source/handoff；data.id 可指定）。' +
      `★ 它**没有 expectations**（不是代码，判不了）⇒ 完成只收 attestation 证据。
      ★ **update** = 改内容，★ **必留旧值**：{op:"update", id:"todo_x", data:{summary:"新说法", reason:"为什么改"}}
           ⇒ 旧 summary 压进 history[]（{at, from, to, reason}，**不是覆盖** —— 「旧的怎么样、新的怎么样」都能查）；
           ★ id 改不了（身份不变，data.id 会被拒）；★ 只允许活卡（state=candidate|claimed）—— done/void 是了结的卡，改它就是改写历史。
      ★ **retire** = 作废（**卡留在册里**）：{op:"retire", id:"todo_x", data:{reason:"被 todo_yyy 取代"}}
           ⇒ state 置 void + 落 retire_reason / retired_at（照 §6.7 的退役流：作废≠删掉，理由要能考古）；
           ★ 之后就不在待办里了（get_dsl query=todo 默认只列活卡），但仍能被 query=todo state=void 查到。
      ★ **delete** = **物理删**，★ 只给「**从未生效**的误建」用：{op:"delete", id:"todo_x", data:{reason:"误建，从未生效"}}
           ⇒ 出册 + 落墓碑（<feature>.journal.jsonl，含被删卡全文）⇒ 可追溯，不是无声消失。
      ★ **retire 还是 delete？**（判据是机器判的，不是自觉）：retire = 这条**曾经有效**、被新的取代了（历史有价值）；
           delete = 这条**从未生效**、纯粹误操作 ⇒ delete 只放行「candidate 且从未被 claim 过、一条证据都没有」的卡，
           其余一律**拒**并指路 retire（★ 别用 delete 清历史）。
      ★★ **follows = 跑环继任链**（2026-10-21）：完成一环、发现还有新的 ⇒ **在它下面登记下一环**。
           {op:"add", data:{summary:"二环：…", follows:"todo_一环"}} —— follows = **上一环的 todo id**，形成 一环→二环→三环。
           · **一条链**（单指针）：上一环唯一 ⇒ 「第几环」唯一；★ 但一个父**可以**有多个子环（"做完一环发现两个新问题"），
             展示时「**主链 = 每一环取册上最早登记的子环**」，其余标「支环」（派生值，不落盘）；
           · 接错了 ⇒ {op:"follows", id:"todo_x", data:{follows:"todo_y", reason:"为什么重接"}}；
             data.follows=null = **摘成链根**（自己当第一环）—— ★ 给空串不算摘，那是忘记填；
           · ★ **拒**：自指 / 悬挂（父 id 不在册上）/ 接在**作废（void）**的卡下面 / **成环**（A→B→C→A 会让「第几环」永远算不出来）；
           · ★ **不级联作废**：上一环 retire 后子环**仍在册、仍然有效**，只在展示里标「上一环已作废」；
           · 看链：get_dsl query=todo（每张卡带「环 2/3」）· query=todo chain=true（按链分组）· state=all（连已了结的一起看）。`,
  },
  {
    type: 'task',
    // ★ 2026-10-20：加 relaunch（void → candidate，重新立卡；判据由 publish 重给）
    ops: ['publish', 'claim', 'release', 'complete', 'void', 'reopen', 'relaunch'],
    idRequired: true,
    idNote: '任务格所在节点的 id（`geometry.nodes[].task`；★ 任务与节点同居）',
    required: {
      claim: ['owner'],
      release: ['reason'],
      complete: ['evidence'],
      void: ['reason'],
      reopen: ['owner', 'reason'],
      relaunch: ['reason'],
    },
    note:
      '★ **任务态唯一写端**（四态 `candidate|claimed|done|void`；★ superseded 已退场）；`node.status` 只是它的**派生值**（`task_schema.ts#progressOf`），不许直接改。' +
      'publish:**立卡=翻该节点的决策卡**：有后态判据⇒**L2**（summary+expectations 逐字搬）；' +
      '无 decision/太粗⇒**L1 建构卡**（**0 条期望**，验收=DSL 建构完整）；' +
      '★不收 data（**唯一例外**：`state=claimed` 的卡带 `data.reason` ⇒ **原地换判据**：只换 summary+expectations，' +
      'state/owner/evidence 全保留）· ' +
      'claim:`data.owner`（L2 须可领＝cardStanding，L1 看建构缺口）· ' +
      '★★ **`data.read_set`**（claim 可选，但**强烈建议**）：`{symbols:[{file,name}],files:[path]}` = ' +
      '「这张卡这一轮**要碰**的符号/文件」。claim 时会**现算读集**并与其它 `state=claimed` 的卡比交，' +
      '相交（符号或文件）⇒ **拒领**（★ 强制，不是提醒；报文点名“和哪张卡、撞在哪个符号”）· ' +
      '不声明 ⇒ 兜底 = 卡上判据点名的符号（symbol-exists / signature-matches / call-exists）+ 节点自己的文件 · ' +
      '★ 可选 `data.intent`：`work`（缺省，来补红）/ `modify`（判据可以全过，来改文件取**写权** —— 已完成 / 已满足的文件仍要能被下一个任务承载；回执写明"本次是修改不是补红"）· ' +
      '★★ **`state=done` 的卡也能 claim**（2026-10-20）：内部 = `t_reopen` + `t_claim`（一步对外，两步对内）—— ' +
      '① `data.reason` **必填**（为什么又开）；② `intent=modify` 不判判据（取写权），`intent=work` 仍判（没红可修 ⇒ 拒）；' +
      '③ owner **换手**，原 owner 记进 `reopened_from`、理由记进 `reopen_reason`；④ `evidence[]` 逐条保留（上一轮干过什么）。' +
      '★ `state=void` 不走 claim（这活已被宣布**弃做**，判据仍在 decision）⇒ 先 `relaunch`（`data.reason` 必填）回 candidate；判据仍全绿时 claim 要带 `intent:modify`，要重给判据则改 decision 再 `publish` · ' +
      'release:`data.reason`（by 走顶层 `agent`）· ' +
      'complete:`data.evidence`（同一把证据尺；L2 须 isSatisfied，L1 须建构完整）· ' +
      'reopen:`data.owner`+`data.reason`（done→claimed「接手」，**判据不变**，原卡继续；落 `reopen_reason` / `reopened_from`）· ' +
      'relaunch:`data.reason`（void→candidate「重新立卡」，reason 必填；★ 判据不随卡走（仍在 decision，relaunch **不改也不清**）、summary/evidence 保留 —— 与 reopen 不是一回事）· ' +
      '★ 三条出口别混：`done`=**干完了**（收口）· `release`=**放回去**（claimed→candidate，活还在）· `void`=**不做了**（candidate→void，弃做）—— ★ **不许用 void 收尾**。',
  },
];

const BY_TYPE = new Map(OP_SPECS.map((s) => [s.type, s]));


/**
 * ★★★ **`node.add` / `node.update` 的领域字段（唯一清单）**（2026-10-11 T170b）。
 *
 * ★ 为什么需要它：这两类 op 把 `data` **整体展开**传给 `addNode` / `updateNode`
 *   （`{ feature, node_id: id, ...data }`）⇒ ★ **键集合住在下游 interface 里，运行期没法枚举**
 *   （TS 类型不能反射）⇒ 只能**静态维护一份**。
 * ⇒ ★★ 而"静态维护"就有**漂移风险** ⇒ 用**下面两个类型级断言**把它按死：
 *   interface 改了而本清单没跟（漏 / 多）⇒ **`tsc` 直接红**，不是"以后有人发现"。
 */
export const NODE_DATA_KEYS = [
  'label',
  'description',
  'type',
  'status',
  'bg',
  'color',
  'border',
  'borderRadius',
  'shape',
  'shadow',
  'opacity',
  'x',
  'y',
  'width',
  'height',
  'layer',
  'host',
  'swimlane',
  'shapes',
  'content',
  'sub_dsl',
  'attributes',
  // ★★★ 2026-10-17（闸原则 §三「每个环节独立的入口」）：**补 `path`**。
  //   判据典 = `.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.gate_principle.independent_entries`。
  //   此前 data 键集里**没有** `path` ⇒ 经 `edit_dsl {type:'node', op:'add'}` 造 `path` 型节点
  //   会被"不被认的键"拒 ⇒ 写端只能给**老节点**挂卡、不能**新建**指向文件的节点
  //   ⇒ 「接取要 path 型节点」而「造节点要已有节点」= 环。
  //   ★ 判据（非空 / 仓库相对 / kind 合法）住 `node_ops.ts#normalizeNodePath` 一处，本清单只声明"认这个键"。
  'path',
  // ★★★ 2026-10-20（`docs/certs-4-ways.md` 裁决 ③）：**写闸的豁免判据 `gate`**（`'gated' | 'exempt'`）。
  //   ★ 不加这一个键 ⇒ `data` 里写 `gate` 会被「不被认的键」拒 ⇒ **设计侧声明不了豁免**
  //     ⇒ 豁免只剩「写回闸的代码」那一条路（= 禁止的路径前缀）。
  //   ★ 取值域 / 缺省口径的唯一住处 = `domain/geometry.ts#NODE_GATES`（本清单只声明"认这个键"）。
  'gate',
  'decision',
  'decision_note',
  'author',
] as const;

/** ★ `feature` / `node_id` 由顶层入参与 `operations[].id` 提供；`agent` 由顶层 `agent` 提供 ⇒ 不进 data。 */
type NodeNonDataKeys = 'feature' | 'node_id' | 'agent';
type NodeOwnedKeys =
  | Exclude<keyof AddNodeInput, NodeNonDataKeys>
  | Exclude<keyof UpdateNodeInput, NodeNonDataKeys>;

/**
 * ★ 断言一：interface 有、清单没有 ⇒ 报（**漏一个就红**）。
 * ★★ 错误信息**带上差集**（`['★ 漏了这些键…', <键名>]`）—— 否则只能看到
 *   `Type 'true' is not assignable to type 'never'`（★ 那**不指路**，与今天修的第八例同族）。
 */
export type NodeKeysMissingFromList = Exclude<NodeOwnedKeys, (typeof NODE_DATA_KEYS)[number]>;
export const _assertNodeKeysNoMissing: NodeKeysMissingFromList extends never
  ? true
  : ['★ `NODE_DATA_KEYS` 漏了这些键（interface 有、清单没有）⇒ 补进 `op_data_spec.ts` 的 `NODE_DATA_KEYS`：', NodeKeysMissingFromList] = true;
/** ★ 断言二：清单有、interface 没有 ⇒ 报（**多写一个也红**）；错误信息同样带差集。 */
export type NodeKeysExtraInList = Exclude<(typeof NODE_DATA_KEYS)[number], NodeOwnedKeys>;
export const _assertNodeKeysNoExtra: NodeKeysExtraInList extends never
  ? true
  : ['★ `NODE_DATA_KEYS` 多写了这些键（清单有、interface 没有）⇒ 从 `NODE_DATA_KEYS` 里删掉：', NodeKeysExtraInList] = true;

/** ★ `file_id` 由 `operations[].id` 给，`feature` 由顶层给 ⇒ 不进 data。 */
export const FILE_DATA_KEYS = [
  'path', 'responsibility', 'expected_apis', 'expected_deps', 'expected_behavior', 'status',
  // ★ T181：`lifecycle`（标记待删 / 已归档）—— ★ **不加这一项会【编译红】**：
  //   `FileOwnedKeys` 从 `AddFileInput`/`UpdateFileInput` 的键集推导（见下方断言），
  //   而 `updateFile` 已接 `lifecycle` ⇒ 漏在这里 ⇒ `FileKeysMissing` 不是 `never` ⇒ `tsc` 报错。
  //   ★ 那正是 T170b 加那两个断言的意义：**清单与实现漂移会当场红，而不是"以后有人发现"** ✓
  'lifecycle',
] as const;
type FileOwnedKeys =
  | Exclude<keyof AddFileInput, 'feature' | 'file_id'>
  | Exclude<keyof UpdateFileInput, 'feature' | 'file_id'>;
export type FileKeysMissing = Exclude<FileOwnedKeys, (typeof FILE_DATA_KEYS)[number]>;
export const _assertFileNoMissing: FileKeysMissing extends never
  ? true
  : ['★ `FILE_DATA_KEYS` 漏了这些键 ⇒ 补进 `op_data_spec.ts`：', FileKeysMissing] = true;
export type FileKeysExtra = Exclude<(typeof FILE_DATA_KEYS)[number], FileOwnedKeys>;
export const _assertFileNoExtra: FileKeysExtra extends never
  ? true
  : ['★ `FILE_DATA_KEYS` 多写了这些键 ⇒ 删掉：', FileKeysExtra] = true;

/** ★ `edge_id` 由 `operations[].id` 给。 */
export const EDGE_DATA_KEYS = ['from', 'to', 'label', 'edge_type', 'arrow', 'layer'] as const;
type EdgeOwnedKeys = Exclude<keyof AddEdgeInput, 'feature' | 'edge_id'>;
export type EdgeKeysMissing = Exclude<EdgeOwnedKeys, (typeof EDGE_DATA_KEYS)[number]>;
export const _assertEdgeNoMissing: EdgeKeysMissing extends never
  ? true
  : ['★ `EDGE_DATA_KEYS` 漏了这些键 ⇒ 补进 `op_data_spec.ts`：', EdgeKeysMissing] = true;
export type EdgeKeysExtra = Exclude<(typeof EDGE_DATA_KEYS)[number], EdgeOwnedKeys>;
export const _assertEdgeNoExtra: EdgeKeysExtra extends never
  ? true
  : ['★ `EDGE_DATA_KEYS` 多写了这些键 ⇒ 删掉：', EdgeKeysExtra] = true;

/**
 * ★★★ **每个 type 的「已知 `data` 键」全集**（T170c）——
 * 用于把"**键名写错**"从**静默忽略**改成**报**（★ T174 治的是"形状错"，没治"名字错"）。
 *
 * ## 键集是**从实现里读出来的**（不是凭印象；★ 本仓的纪律）
 * · `node` / `file` / `edge` 是**整体展开**（`{…data}` 交给下游 `addXxx`）⇒ 键集在 interface 里
 *   ⇒ 用 `NODE_DATA_KEYS` / `FILE_DATA_KEYS` / `EDGE_DATA_KEYS`（**各自都有类型级断言**防漂移）
 * · 其余 type 在各自 `applyXxxOp` 里**显式读 `data.X`** ⇒ 逐条从实现抄出
 * ★★ 有一条**教训**要记：**机械提取会把【注释里出现的词】也算进去** ——
 *    实测 `applyTagOp` 被误抓出 `alternatives`/`dissent`（那是它的**文案**里写的），
 *    真身只读 `tag`/`files` ⇒ ★ **所以这份键集是【人工逐条核对过】的** ✓
 *
 * ## 为什么"未知键 ⇒ 报"值得做
 * ★ 兜底：★ `data` 是自由袋子 ⇒ 写错一个字母（`labl`）此前**一声不响地丢掉** ✗
 *   ⇒ 实测代价：**decision 的 4 个字段**曾因"形状不对"静默丢弃，害一代代理**回读落盘文件**才发现（T174）。
 */
export const TYPE_KNOWN_KEYS: Record<string, readonly string[]> = {
  node: NODE_DATA_KEYS,
  edge: EDGE_DATA_KEYS,
  file: FILE_DATA_KEYS,
  api: ['signature', 'new_signature', 'notes', 'note', 'expected_apis'],
  binding: ['file_id', 'sync_status'],
  // ★★★ T334（2026-10-15）：**补 `evidence`** —— 写端 `updateStatus` 认它（`ProgressEvidence`），
  //   而本键集此前只有 `status` ⇒ ★ 经工具层传 `data.evidence` 会报「不被认的键」⇒
  //   **"置 done 必带证据"这道闸在真实路径上根本进不去**（传 ⇒ 键不认；不传 ⇒ 闸拒）。
  //   ★ 键集仍**从实现读出**：`update_feature.ts` 的 `case 'status'` 现在读 `op.data.evidence`。
  status: ['status', 'evidence'],
  annotation: ['text', 'annotation_id', 'node_id', 'author', 'resolution_note', 'severity'],
  approval: ['annotation_id', 'assignee', 'comment', 'decision', 'reviewer', 'submitter'],
  snapshot: ['label', 'description', 'snapshot_id'],
  layout: [
    'algo', 'direction', 'h_gap', 'v_gap', 'damping', 'grid_size',
    'iterations', 'node_radius', 'repulsion', 'respect_swimlanes', 'stiffness',
  ],
  simulation: [],
  tag: ['tag', 'files'],
  decision: [
    'summary', 'rationale', 'consequences', 'acceptance', 'thread', 'tags',
    'votes', 'evidence_source', 'note', 'status', 'author', 'alternatives', 'dissent',
    // ★★★ T256（2026-10-14）：补 `expectations`（**可判定的验收**，`domain/geometry.ts:191`）。
    //   ★ 为什么必须补：它是**唯一会被程序判**的决策字段 —— `collectExpectations`（`domain/expectation.ts:130-138`）
    //     读它 → `consistency_check` 的 `judgeExpectations` 判它 ⇒ ★ **决策卡的"当代意义"就靠它**。
    //   ★ 实测（补之前）：从 `decision` op 写它 ⇒ 报「data 里有**不被认的键**：expectations」
    //     ⇒ **从决策卡写入口写不进可判定验收**（而 `node` op 的 `data.decision` 那条路本来就能写
    //     —— 实测加一条 `file-exists` ⇒ 对拍 `checked 2→3 · passed 0→1`）。
    //   ★ 补上之后两条路**同一判据**（判据仍只有这一张表 + `assertValidExpectations`）。
    'expectations',
    // ★★★ T329（2026-10-15）：补 `scope`（**这条决策管哪一片**，`domain/geometry.ts` 的 `NodeDecision.scope`）。
    //   ★ 不补会怎样：从 `decision` op 写它 ⇒ 报「data 里有**不被认的键**：scope」
    //     ⇒ **从决策卡写入口写不进"范围"**（而 `node` op 的 `data.decision` 那条路本来就能写）。
    //   ★ 校验仍只有一把尺：`domain/scope.ts` 的 `parseScope`（由 `applyDecisionWrite` 调用）。
    'scope',
    'expectation', 'index', 'symbol',
  ],
  // ★★★ 2026-10-17（T11）：`task` 的键集 —— **从实现读出**（`task_ops.ts` 的 `applyTaskOp` 只读
  //   `owner` / `reason` / `evidence`；`state` **不在这里**：它只能由 op（claim/release/complete）改，
  //   不是"data 里可以随便给的字段" —— 那会把唯一写端变成"谁都能把 state 塞成 done"）。
  // ★★★ 2026-10-20：补 `intent`（claim 的**意图**：work=补红（缺省）/ modify=判据可全过、来改文件取写权）。
  //   ★ 为什么不是新 op：`claim` 仍是那一步状态迁移（candidate→claimed），只是**来意**多了一维 ——
  //     没有它，`satisfied` 卡永远领不到 ⇒ 写闸不认 ⇒ **文件永久只读**（结构性错误，见 task_machine.ts 文件头）。
  // ★★★ 2026-10-21（并发控制·读集比对）：补 `read_set` —— claim 时**显式声明**「我要碰这些符号/文件」。
  //   ★ 它是读集的**第一判据**（最准：要干活的那个人说的）；缺省 ⇒ 从卡上判据点名 + 节点文件兜底。
  //   ★ 不补会怎样：传了被「不被认的键」拒 ⇒ 调用方**没法把“我确实不碰那个符号”说清楚**
  //     ⇒ 只剩兜底，而兜底要么粗（L1 卡只有文件级）要么空（无节点无判据）。
  //   ★ 形状校验**唯一住处** = `application/claim_conflict.ts#parseDeclaredReadSet`（本表只声明“认这个键”）。
  task: ['owner', 'reason', 'evidence', 'intent', 'read_set'],
  // ★★★ 2026-10-21：补 `reason` —— `todo.update` / `retire` / `delete` 三个新 op 都读它
  //   （update=为什么改 · retire=为什么作废 · delete=为什么物理删）。★ 不补 ⇒ 传了会被「不被认的键」拒。
  //   ★ `history` / `retire_reason` / `retired_at` **不在这里**：它们由写端**自己落**（append 到卡上），
  //     不是「data 里可以随便给的字段」—— 让调用方直接塞 history 就能伪造修订史。
  // ★★★ 2026-10-21（跑环继任链）：补 `follows` —— `todo.add` / `todo.follows` 都读它。
  //   ★ 不补会怎样：传了会被「不被认的键」拒 ⇒ 调用方**没法表达"第二张是第一张的下一步"**，
  //     只能回到在 summary 里手写「取代 xxx」（那正是 2026-10-21 立出三张矛盾卡的原因）。
  //   ★ `depth` / `children` / `total` **不在这里**：它们是**现算**的（`domain/todo_chain.ts`），
  //     让调用方塞 = 手写一份"我在第几环"，必与链的实际情况打架。
  todo: ['summary', 'decision', 'owner', 'id', 'node_id', 'reason', 'follows'],
};
/** ★★ 断言：`TYPE_KNOWN_KEYS` 的键集**必须恰好覆盖 `OP_SPECS` 的全部 type**（多 / 少都红）。 */
export type KnownKeysMissingTypes = Exclude<(typeof OP_SPECS)[number]['type'], keyof typeof TYPE_KNOWN_KEYS>;
export const _assertKnownKeysCoverAll: KnownKeysMissingTypes extends never
  ? true
  : ['★ `TYPE_KNOWN_KEYS` 漏了这些 type ⇒ 补上（键集从实现读）：', KnownKeysMissingTypes] = true;
export type KnownKeysExtraTypes = Exclude<keyof typeof TYPE_KNOWN_KEYS, (typeof OP_SPECS)[number]['type']>;
export const _assertKnownKeysNoExtraType: KnownKeysExtraTypes extends never
  ? true
  : ['★ `TYPE_KNOWN_KEYS` 多写了这些 type（`OP_SPECS` 里没有）⇒ 删掉：', KnownKeysExtraTypes] = true;


/**
 * ★ **校验通过后的 op**（2026-10-11 T170）——
 * 与传入时的唯一区别：**`data` 一定存在**（校验保证了形状 ⇒ 规范化成 `Record`）。
 *
 * ★ 为什么用**泛型**（而不是一个固定 interface）：调用方的 `op` 有**联合类型**（`FeatureOperation['op']`
 *   是 `'add' | 'update' | …`）；固定 interface 会把它们**拉宽成 `string`** ⇒ 调用方拿到它反而**丢类型**。
 *   ⇒ 泛型能**原样保留调用方的形状**，只在上面补一个"`data` 必有" ✓
 *
 * ★ 为什么要这个"必有 data"的类型：原先那些 `if (!op.data?.X) throw` **同时兼任两职** ——
 *   ① 运行时守卫；② **TS 的类型收窄**（`if (!data.signature) throw` 之后 TS 知道它是 `string`）。
 *   把它们收进本表后 ② 就丢了 ⇒ ★ 别在 15 处各写 `as`，而是**让校验函数返回这个窄类型** ✓
 * ★ `id` **不在这里承诺必有**：`idRequired:false` 的 type（annotation / approval / snapshot / layout /
 *   simulation / tag）本来就不用 id ⇒ ★ 声明成必有会是**撒谎**（本仓反对的"过度断言"）。
 */
export type CheckedOperation<T extends FeatureOperationLike> = T & { data: Record<string, unknown> };

/** 只取校验需要的四个字段（避免让 `op_data_spec` 依赖 `FeatureOperation` 的全部形状）。 */
export interface FeatureOperationLike {
  type: string;
  op: string;
  id?: string;
  data?: Record<string, unknown>;
}

/**
 * 校验一条 operation 的 `type`/`op`/`id`/`data` 形状。**不合法就抛**（失败就是失败，不降级）。
 * ★ 报错里**点名该给哪些键**（照黑盒实验里"回执救场"的经验：错误信息就是最好的文档）。
 * ★ 通过 ⇒ 返回 {@link CheckedOperation}（`data` 已规范化成必有；**其余形状原样保留**）。
 */
export function checkOpSpec<T extends FeatureOperationLike>(op: T): CheckedOperation<T> {
  const type = String(op.type ?? '');
  const spec = BY_TYPE.get(type);
  if (!spec) {
    throw new Error(
      `未知操作类型: "${type}"。合法值（${OP_SPECS.length}）: ${OP_SPECS.map((s) => s.type).join(' / ')}`,
    );
  }
  const o = String(op.op ?? '');
  if (!spec.ops.includes(o)) {
    throw new Error(
      `${type} 不支持操作 "${o}" —— 它只支持: ${spec.ops.join(' / ')}` +
        (spec.note ? `\n★ ${type} 补充：${spec.note}` : ''),
    );
  }
  // ★★★ 2026-10-21：`idRequired`（**每个** op 都要）与 `opsRequiringId`（**这几个** op 要）**合读一处**；
  //   后者是给 `idRequired:false` 的 type 用的（`todo` 的 add 不用 id —— 它由 summary 自动生成）。
  //   ★ 不在下面各 case 里写 `if (type === 'todo' && !id)` 的第二份判据。
  const idNeeded = spec.idRequired || (spec.opsRequiringId ?? []).includes(o);
  if (idNeeded && !op.id) {
    throw new Error(`${type}.${o} 需要 id${spec.idNote ? `（${spec.idNote}）` : ''}`);
  }
  const data = (op.data ?? {}) as Record<string, unknown>;
  // ★★★ T170c：**未知键 ⇒ 报**（此前是静默忽略）。★ 只对**表里列了的 type** 校验（`TYPE_KNOWN_KEYS` 覆盖全部，见断言）。
  const known = TYPE_KNOWN_KEYS[type];
  if (known) {
    const unknown = Object.keys(data).filter((k) => !known.includes(k));
    if (unknown.length > 0) {
      throw new Error(
        `${type}.${o} 的 data 里有**不被认的键**：${unknown.join(' / ')}` +
          `（★ 此前它们会被**静默忽略** —— 你以为生效了、其实没有）。\n` +
          `★ ${type} 的已知键（${known.length} 个）：${known.length ? known.join(' / ') : '（无 —— 这个 type 不走 data）'}`,
      );
    }
  }
  const missing = (spec.required[o] ?? []).filter((k) => {
    const v = data[k];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length > 0) {
    throw new Error(`${type}.${o} 需要 data.${missing.join(' 和 data.')}（★ 该 type 的完整字段表见 edit_dsl 描述里的「data 契约」段）`);
  }
  const groups = spec.anyOf?.[o];
  if (groups && !groups.some((g) => g.every((k) => data[k] !== undefined && data[k] !== null))) {
    throw new Error(
      `${type}.${o} 需要**至少给一组**：${groups.map((g) => g.map((k) => `data.${k}`).join(' + ')).join('　或　')}` +
        (spec.note ? `\n★ ${type} 补充：${spec.note}` : ''),
    );
  }
  // ★ 校验通过 ⇒ 交给调用方的 op **`data` 已规范化成必有**（类型也随之收窄，见 CheckedOperation）
  return { ...op, data };
}

/**
 * 把整张表渲染成**给人/LLM 读的一段**（进 `edit_dsl` 的 `description`）——
 * ★ 判据仍是上面那张表（这里只渲染，不新增规则）。
 */
export function renderOpSpecs(): string {
  const lines: string[] = [];
  for (const s of OP_SPECS) {
    const parts = s.ops.map((o) => {
      const req = s.required[o] ?? [];
      const any = s.anyOf?.[o];
      const bits: string[] = [];
      // ★ 2026-10-21：`opsRequiringId` 的 op 也要渲染 id（否则 `todo.update` 看起来「不用 id」，
      //   调用方就会漏 —— 那正是本表存在的理由：**提前看得见**，而不是发一次残缺请求才知道）。
      if (s.idRequired || (s.opsRequiringId ?? []).includes(o)) bits.push('id');
      if (req.length) bits.push(`data.${req.join(' + data.')}`);
      if (any) bits.push(any.map((g) => `data.${g.join(' + data.')}`).join(' 或 '));
      return bits.length ? `${o}（需 ${bits.join('；')}）` : `${o}（无必需字段）`;
    });
    lines.push(`  · ${s.type}: ${parts.join(' ｜ ')}`);
    // ★ `id` 的语义**按 type 说一次**（不在每个 op 里重复 —— 那会把描述撑肿）
    if (s.idRequired && s.idNote) lines.push(`      ★ id = ${s.idNote}`);
    if (s.note) lines.push(`      ★ ${s.note}`);
  }
  return lines.join('\n');
}
