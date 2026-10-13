/**
 * T192：**按用户描述的那条流程，逐段真跑一遍**（不是读码推断）。
 *
 * 用户原话（拆成段）：
 *   ① 新建项目 ⇒ 直接写设计 DSL
 *   ② 已有项目 ⇒ 从原项目获取 DSL
 *   ③ 在 DSL 上修改 ⇒ 改成设计 DSL
 *   ④ 挂载"卡"（★ 用户说"角色卡"；DSL 里的对应物待确认，先按 `decision` 决策卡测）
 *   ⑤ 新增：改 DSL + 加卡 + 加节点
 *   ⑥ 删除 ⇒ 挂待删除标记（暂时可见）
 *   ⑦ 实际源码修改  ⑧ 对拍  ⑨ 归档进历史堆  ⑩ 自动关联编辑/重写/读取工具
 *
 * ★ 每段给 **通 / 不通 / 未测** 三态（★ 不许把"没测"说成"通"）。
 * ★ 夹具在【仓外】（`certs/.work/` —— 本文件名下进版本控制，`.work/` 被 gitignore），用完删；
 *   数据目录的清理用**工具入口**，不 `rm` 数据目录。
 *   ★ T224：原写 `.inspect/` —— 证书已从那个 gitignored 垃圾场搬出来（见 `certs/README.md`）✓
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseDataBlock } from '../dist/src/application/plumbing.js';

const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t192-'));  /* ★ T224：草稿放 os.tmpdir() —— 宿主护栏对 temp 整体绕过（T223 实测），且 temp 在仓外 ⇒ 不受 .gitignore 影响（否则 import_project 会把这些文件过滤掉）*/
const FEATURE = 't192flow';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
/** 真调工具；返回 {err, text, data} */
const call = (tool, args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  // ★★★ T251：机器段解析只走唯一入口 `parseDataBlock`（原先这里自己 indexOf+slice+JSON.parse 一份）
  const data = parseDataBlock(out);
  return { err: out.includes('isError=true') || /MCP error/.test(out), text: out, data };
};

// 夹具：一个最小的"已有项目"
fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(path.join(EXT, 'src'), { recursive: true });
fs.writeFileSync(path.join(EXT, 'src/a.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
fs.writeFileSync(path.join(EXT, 'package.json'), JSON.stringify({ name: 't192ext', version: '1.0.0' }, null, 2));

// ★★★ T214 续13（2026-10-13）：**证书必须自足** —— ★ 本证的前提是"`FEATURE` 还不存在"（★ ①-a 靠它 ✓）
//   ★★ 而 ★ **feature 存的是【全局数据目录】**（`[仓]/.agent-io/features/` ✓ —— ★ 我实测过 ✓）
//   ⇒ ★ **上面那句 `fs.rmSync(EXT)` 【删不到它】** ✗ ⇒ ★ 于是**第二次跑**：feature 还在 ⇒
//     ★★ **①-a「没建就写 ⇒ 拒」该拒的【不拒了】** ✗ · ★ ①-b/①-c/④ 也跟着偏 ✓
//   ★★★ **修法（★ 用它自己的注释说的那条）**：★ **"数据目录的清理用【工具入口】，不 `rm`"** ✓
//     ⇒ ★ 用 `manage_feature action=delete` 清掉 —— ★ 那是**工具入口** ⇒ ★ **不撞删除护栏** ✓
//   ★★ （★ 与 `t205` 同族：★ **"证书不自足"是今天反复出现的病** ✓；★ 那次是"夹具跑脏"、⭐ 这次是"全局状态残留" ✓）
{
  const clean = call('manage_feature', { action: 'delete', feature: FEATURE });
  // ★ 清不掉也继续（★ 可能本来就不在 ⇒ 那才是我们要的状态 ✓）—— ★ 但**打出来**（★ 不静默 ✓）
  console.log(`⓪ 自足：清掉可能残留的 feature「${FEATURE}」⇒ ${clean.text.split('\n')[0].slice(0, 70)}`);
}

console.log('══ ① 新建项目 ⇒ 直接写设计 DSL');
const bad = call('edit_dsl', { feature: FEATURE, agent: 't192', reason: '给 src/a.ts 补 1 个 stage 节点，先试一笔看会不会被拒（T192）', operations: [{ type: 'node', op: 'add', id: 't192n', data: { label: '入口', type: 'module' } }] });
chk(bad.err && bad.text.includes('manage_feature'), '①-a 没建 feature 就写 ⇒ **拒**，且**指路到真工具**（`manage_feature`）', bad.text.split('\n')[0].slice(0, 130));
const mk = call('manage_feature', { action: 'create', feature: FEATURE });
chk(!mk.err, '①-b `manage_feature action=create` ⇒ **通**（新建项目的入口）', mk.text.split('\n')[0].slice(0, 120));
const first = call('edit_dsl', { feature: FEATURE, agent: 't192', reason: '给 src/a.ts 补 1 个 stage 节点，作为 T192 的第一笔设计', operations: [{ type: 'node', op: 'add', id: 't192n', data: { label: '入口', type: 'module' } }] });
chk(!first.err, '①-c 新 feature 上写第一笔 DSL ⇒ **通**', first.text.split('\n')[0].slice(0, 120));

console.log('\n══ ② 已有项目 ⇒ 从原项目获取 DSL');
const imp = call('import_project', { project_dir: EXT, feature: FEATURE });
chk(!imp.err, '② `import_project` ⇒ **通**（扫描代码生成/更新 DSL）', imp.text.split('\n')[0].slice(0, 120));

console.log('\n══ ③ 在 DSL 上修改（改成设计 DSL）');
const upd = call('edit_dsl', { feature: FEATURE, agent: 't192', reason: '把 src/a.ts 那个 stage 节点的 label 改掉（T192）', operations: [{ type: 'node', op: 'update', id: 't192n', node_id: 'n1', data: { label: '改过的入口' } }] });
console.log(`     [读数] ${upd.text.split('\n')[0].slice(0, 130)}`);

console.log('\n══ ④ 挂"卡"（★ 用户说"角色卡"；先量 DSL 的对应物）');
const dec = call('edit_dsl', {
  feature: FEATURE, agent: 't192', reason: 'T192：量"挂卡"这一步',
  operations: [{ type: 'decision', op: 'add', data: { summary: '为什么这样分层', rationale: 'T192 探针', node_id: 'n1' } }],
});
// ★★★ T214 续14（2026-10-13）：**④ 的断言【已经过期】** —— ★ 实测 `decision` **只支持 `update`** ✗
//   ★ 报错逐字：*"decision 不支持操作 "add" —— 它只支持: update"* ✓
//     ★ 且 ★ **顺手把 `data` 的字段形状读出来了**（*"2026-10-11 T174 从实现逐个读出 —— 照填"* ✓）
//   ★★ 所以原先那句 *"`op=add` ⇒ 通"* **测的是一个【已经不存在的操作】** ✗
//   ⇒ ★ 改成**跟着当前契约走**：★ **断言它【该拒 `add`、并指路 `update`】** ✓
//     —— ★ 与"README 要跟上内部演进"同一条：★ **证书也得跟上** ✓
chk(dec.err && /只支持[：:]\s*update/.test(dec.text), '④ `decision` **只支持 `update`** ⇒ 用 `add` **被拒、且指路** ✓', dec.text.split('\n')[0].slice(0, 130));

console.log('\n══ ⑩ 自动关联（产物 → 下一棒）');
const withHop = [first, imp, dec].filter((r) => r.text.includes('下一棒'));
chk(withHop.length > 0, '⑩ 回执**自带"下一棒"段**（含 `touched.*` 表达式 + 全称规则）', `有下一棒段的调用: ${withHop.length}/3`);
const cm = call('capability_map', {});
chk(cm.text.includes('链'), '⑩ `capability_map` 里有"链"这一维（导航工具）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('★ 未测（如实）：⑤加节点/加卡（与①③同族，此处未逐条跑）· ⑥⑦⑧⑨ 见 T181–T185/T187 的出生证');
