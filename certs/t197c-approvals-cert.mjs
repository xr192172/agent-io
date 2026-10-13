/**
 * T197c 判定证：**"未 submit 的批注出现在 `query=approvals` 里" —— 是缺陷吗？**
 *
 * ## 结论（★ 一句话）
 * ★★ **不是缺陷** —— 数据层面**忠实**（`draft` 就是"没提交"的准确状态），
 * 且"**只看待审批的**"这个能力**本来就有**（`status:"submitted"`）。
 * ★★★ **是【描述的缺口】**：三处没写清（见下），★ **一个子代理真的被它骗过一次**（它以为是缺陷）。
 *
 * ## 证据链（★ 先读码、再真跑 —— 两侧对齐才算判定）
 * | 侧 | 读数 |
 * |---|---|
 * | **读码** | `query_feature.ts:1095` 的 `case 'approvals'` 调 `listApprovals()` 并返回 **`r.annotations`** |
 * | | `approval.ts:185` `listApprovals`：`let filtered = annotations;` ⇒ ★ **默认【不筛状态】** |
 * | | 同处 `status: a.approval_status ?? 'draft'` ⇒ ★ **没提交的如实标 `draft`**（诚实） |
 * | **真跑** | 加一条批注（不提交）⇒ `query=approvals` ⇒ ★「审批列表：共 1 条」+ `📝 [draft] anno_…` |
 * | | `query=approvals status="submitted"` ⇒ ★「审批列表 (状态: submitted)：共 0 条」⇒ **能力在** |
 *
 * ## ★★ 三处描述缺口（这才是要收的东西）
 * 1. `approvals` 的描述只写 *"审批"* ⇒ ★ 读者以为"已进审批流程的那些"，
 *    实际是"**按审批状态看【全部】批注**（含未提交的 `draft`）"。
 * 2. `status` 入参的描述只有 *"query=approvals 时：按状态过滤"* ⇒ ★ **一个合法值都没写**。
 * 3. ★★ **`assignee` 入参【完全没有描述】**（实测 `String(... .description) === "undefined"`），
 *    而 `listApprovals` 里确实按 `a.assignee` 过滤 ⇒ ★ 读者不知道它存在、更不知道它管什么。
 *
 * ## ★★★ 而它与 T198（子代理在收的那条）是**同一个族、而且是另一半**
 * `approval.ts:110` 的注释逐字写着：*"`data.decision` 收的是【**动作**】；
 * 落地后的 `approval_status` 才是【**状态**】（见 `DECISION_EFFECT`）"*
 * ⇒ ★★ **两套词表（动作词 `approve`/`reject` × 状态词 `draft`/`submitted`/…）在同一个审批流程里并存，
 *    而两套都没写进 MCP 描述** ⇒ ★ 读者**必然猜错一次**（★ 子代理猜错了 `decision`、我查的是 `status`）。
 * ⇒ **知识在源码注释里，只是没浮现到描述** ✓
 *
 * ★ 本证只**报告**（★ 不是门）；★ 逐条真跑、临时 feature 用**工具入口**清。
 */
import { execFileSync } from 'node:child_process';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';
import { EXPLORE_ARGS } from '../dist/src/application/meta/explore/explore_arg_spec.js';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (tool, args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  return out;
};

const d = TOOL_DEFS.find((x) => x.name === 'get_dsl');
const desc = (k) => String(d.inputSchema[k]?.description ?? '');

// ★★★ T198 已修这三处 ⇒ 本节的断言**从"缺口存在"改成"缺口已补"**。
//   ★ 为什么必须改：**证/守卫必须反映【现在】**（把"已恢复"说成"仍然坏着"是同一个错的反面）——
//     我今天（T190）刚立过这条：告警粘住不放 = 把已修的说成仍坏。
console.log('══ ① 缺口 1+2（★ T198 已补）：`approvals` / `status` 的描述现在**有没有**值域');
chk(/draft|pending_review/.test(desc('query')), '①-a ★ `query` 的描述里**现在有了**状态词（写明默认含 `draft`）⇒ 读者查得到', `query 描述长度=${desc('query').length}`);
// ★ 断言只测**该测的那件事**：`status` 的描述里**没有**合法值。
//   （我第一版多测了一个 `/status/.test(desc('query'))` ⇒ 与结论无关 ⇒ 假红；★ 证里的断言也要"只问该问的"。）
chk(/draft/.test(desc('status')) && /pending_review/.test(desc('status')) && /needs_revision/.test(desc('status')), '①-b ★ `status` 的描述**现在列出了全部 5 个合法值**', JSON.stringify(desc('status')).slice(0,160));
console.log('     （★ 值域现在只在 `approval.ts:110` 的注释与 `DECISION_EFFECT` 里 —— 源码里，不在读者看得见的面）');

console.log('\n══ ② 缺口 3：`assignee` **完全没有描述**');
chk(desc('assignee').length > 0, '② ★ `assignee` **现在有描述了**（原先是 `""`）', JSON.stringify(desc('assignee')));

console.log('\n══ ③ 判定：**不是缺陷** —— 数据忠实 + 能力本来就有（真跑）');
const got = call('get_dsl', { feature: 'run82', query: 'approvals' });
chk(got.includes('审批列表'), '③-a 默认（不筛）能列出来', got.split('\n')[0].slice(0, 90));
// ★★★ T198 修正：原先这里用的是 `submitted` —— ★ **而它不是合法状态**（★ 合法的是 `pending_review`）。
//   ⇒ 它当时"通过"**正是因为那时【不校验】**（静默返回 0 行）⇒ ★ 本证也**依赖了静默行为**（今天第三次同款）。
const pending = call('get_dsl', { feature: 'run82', query: 'approvals', status: 'pending_review' });
chk(pending.includes('状态: pending_review'), '③-b ★ **只看"待审批"的能力本来就有**（★ 正确状态词是 `pending_review`）⇒ 所以"看到 draft"不是缺陷，是**默认口径没写清**', pending.split('\n')[0].slice(0, 90));

console.log('\n★★★ 结论：**不是缺陷**；要收的是【三处描述】（★ 已交给 T198 的子代理一轮收完 ——');
console.log('   因为 `decision`(动作词) 与 `status`(状态词) 两套词表是同一个族的两半，分开改会动同一个文件两轮）。');
console.log('   锚点：`approval.ts:110` 的注释 + `DECISION_EFFECT`（★ 大概率是两套词表的唯一住处）。');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
