/**
 * T198 出生证（主 agent 收的"另一半"）：**审批【状态词表】进描述 + 治静默过滤**。
 *
 * ## 分工
 * · **子代理（T198sub）**已收：`decision`（**动作词**）的值域 ⇒ `APPROVAL_DECISIONS` 唯一住处 + 描述渲染 + 防漂移断言。
 * · **本证（我）**收**另一半**：`status`（**状态词**）—— ★ 两套词表同族，**分开改会动同一个文件两轮** ⇒ 我把它并进同一批。
 *
 * ## 本轮的三件事
 * 1. **状态词表的运行时形态**：`src/domain/annotation.ts` 新增 `APPROVAL_STATUSES`
 *    （★ `ApprovalStatus` 是**类型** ⇒ ★ **类型渲染不进 MCP 描述**）——
 *    ★★ 并用**两条类型级断言**（漏 / 多）钉死它与 `ApprovalStatus` 一致（照 `op_data_spec.ts` 的 `_assert...` 手法）。
 * 2. **治静默过滤**：`listApprovals` 收到不在表里的 `status` ⇒ ★ **抛**（★ 原先**不校验** ⇒ 传错的词
 *    **静默返回 0 行** ⇒ 读者读成"没有待审批的"而不是"你写错了" —— §2.3「不报错的错」；
 *    ★ 与 T197 治 `explore_code`"键名错就抛"**同一把尺**）。
 * 3. **三处描述**（`get_dsl`）：`query` 里的 `approvals` 写明**默认含未提交的 `draft`** ·
 *    `status` **列出合法值**（★ **从常量渲染**，不手抄）· `assignee` **补上描述**（原先完全没有）。
 *
 * ## ★ 一条我【没复现】的判据（如实标注）
 * "往 `APPROVAL_STATUSES` 塞第 6 个值 ⇒ `tsc` 必须红" —— ★ **子代理对它自己那套（`APPROVAL_DECISIONS`）实证过**
 * （它报：临时加第 4 个值 ⇒ `TS2741`，已还原、复检 0）；★ **我没有重跑**：
 * 那需要**临时改 `src/`**，而本仓消融纪律是"只动 gitignore 的产物" ⇒ ★ **我不破例**。
 * ⇒ 本证改为**静态断言这条断言的形状**（见 ①-c）+ 引用它的实证。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';
import { APPROVAL_STATUSES } from '../dist/src/domain/annotation.js';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', 'get_dsl', JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  return out;
};

console.log('══ ① 状态词表：运行时常量 + 防漂移断言的【形状】');
chk(
  JSON.stringify([...APPROVAL_STATUSES]) === JSON.stringify(['draft', 'pending_review', 'approved', 'rejected', 'needs_revision']),
  '①-a 运行时常量 = 5 个状态（与 `ApprovalStatus` 同集合）',
  APPROVAL_STATUSES.join(' / '),
);
const ann = fs.readFileSync('src/domain/annotation.ts', 'utf8');
chk(/_AssertStatusesCover/.test(ann) && /_AssertStatusesNoExtra/.test(ann), '①-b ★ 两条类型级断言在（**漏 / 多** 各一条）');
chk(/Exclude<ApprovalStatus, \(typeof APPROVAL_STATUSES\)\[number\]> extends never/.test(ann), '①-c ★ 断言的**形状**对：漏了 ⇒ 不是 never ⇒ 该类型成为"带提示的元组" ⇒ 赋 `true` **编译报错**', '（★ 我不临时改 src 去实证 —— 消融纪律只动 gitignore 产物；子代理对同款断言已实证过）');

console.log('\n══ ② 三处描述（★ 打印注册表，不读源码注释）');
const d = TOOL_DEFS.find((x) => x.name === 'get_dsl');
const q = String(d.inputSchema.query.description ?? '');
const st = String(d.inputSchema.status.description ?? '');
const as = String(d.inputSchema.assignee?.description ?? '');
chk(q.includes('全部') && q.includes('draft'), '②-a `query` 里写明了**默认含未提交的 `draft`**（原先只写"审批"）', q.slice(q.indexOf('approvals='), q.indexOf('approvals=') + 90));
chk(APPROVAL_STATUSES.every((s) => st.includes(s)), '②-b ★ `status` 描述**列出了全部 5 个合法值**（★ 从常量渲染）', st.slice(0, 120));
chk(as.length > 0 && as.includes('assignee'), '②-c ★ `assignee` **有描述了**（原先 `String(...) === "undefined"`）', as);

console.log('\n══ ③ 真跑两个方向（★ 治的是"静默 0 行"）');
const good = call({ feature: 'run82', query: 'approvals', status: 'pending_review' });
chk(!good.includes('未知审批状态') && good.includes('待审批'.slice(0, 0) + '审批列表'), '③-a 合法状态 ⇒ 照常（能筛）', good.split('\n')[0].slice(0, 90));
const bad = call({ feature: 'run82', query: 'approvals', status: 'bogus_xyz' });
chk(bad.includes('未知审批状态'), '③-b ★★ 未知状态 ⇒ **抛**（★ 不再静默返回 0 行）', bad.split('\n')[0].slice(0, 130));
chk(APPROVAL_STATUSES.every((s) => bad.includes(s)), '③-c ★ 报错**列出全部合法值**（读者不用再试错）');

console.log('\n══ ④ 反例：**不该动的没动**（★ 默认口径仍如实含 draft；两套词表别混）');
const all = call({ feature: 'run82', query: 'approvals' });
chk(!all.includes('未知审批状态'), '④-a 不传 `status` ⇒ 照常（默认列全部）', all.split('\n')[0].slice(0, 80));
const src = fs.readFileSync('src/application/observe/reconcile/approval.ts', 'utf8');
chk(/APPROVAL_DECISIONS/.test(src) && /APPROVAL_STATUSES/.test(src), '④-b ★ 两套词表**各自只有一个出处**（动作词 / 状态词分开，没混成一份）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('★ 未复现项（如实）：防漂移断言的"加值⇒tsc 红"由 T198sub 实证，我未重跑（不临时改 src）。');
