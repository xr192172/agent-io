/**
 * T197sub 出生证（v2 —— ★ 修掉 v1 的 3 个【探针 bug】后重跑；v1 原文见 t197sub-out-v1.txt）
 *
 * ## v1 的 3 个探针 bug（★ 记下来，免得当成产品缺陷）
 *   · C-7/C-8：我从批注 id `anno_1791793064426_lpysp4` 里用 `[0-9a-f]{8,}` 只抓到了数字段
 *     `1791793064426` ⇒ submit/review 报"标注不存在"。★ 是**我抓错 id**，不是审批卡不通。
 *   · C-6/C-10：我把"坏输入"的 reason 写成了**泛谈**（如"故意缺 decision 做审批裁定"）⇒ 撞在
 *     **更早的 L3 实体绑定门**上，**根本没走到** op-data 校验 ⇒ 测不到"缺必填 key 会不会响"。
 *     ★ 修法：坏输入的 reason 也**必须含实体**，才能把门推到 op-data 那一层。
 *
 * ## v1 的 1 个**真发现**（保留）
 *   · A-3：**先 `create` 再 `import_project` ⇒ `get_dsl query=files` 为空**
 *     （回执：`import_project` 只"刷新实际"，**设计已存在 ⇒ 不 fork**；T193 已记为"非缺陷"）。
 *     ⇒ 于是"让 DSL 里有真文件"这一步**不成立**，决策卡锚到 `src/a.ts` 会失败。
 *     ⇒ v2 用**两条子流程**分别覆盖：
 *       Flow-1（任务书顺序）：create → import → 加节点 → 读回；
 *       Flow-2（**import-就绪**顺序）：delete → import（设计为空 ⇒ fork）→ 有真文件 → 挂决策卡。
 *
 * ★ 铁律：每步都"读回来"；好输入必通、坏输入必响亮拒；★ 不许把预测写成实测。
 * ★ 隔离：feature `t197sub`（别人不碰）· 夹具 `certs/.work/t197sub-ext`（可删）· 收尾走工具入口删 feature。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t197sub-'));
// ★★★ T252（2026-10-13）：**给本证自己的数据根**（`AGENT_IO_HOME`）——
//   起因：全量里本证红 5 条、**单跑 27/0 全绿** ⇒ 元凶是**宿主删除护栏**按 `requestId`
//   （= 一次 tool call）累积条目、阈值 50：整套证跑在**同一个 request** 里 ⇒ 跑到后半程必撞。
//   ★ 护栏**正经的绕过口径**是"路径在 temp 下"（`node-safe-delete-shim.cjs` 的 `isUnderAnyTempDir`，
//     T223 已实测）⇒ ★ 让 feature 数据也落 temp，`manage_feature delete` 删的就是 temp 路径 ⇒ 不撞 ✓
//   ★ 不是关护栏（`CODEBUDDY_SAFE_DELETE_ENABLED=0`）—— 那是**废掉**安全网，不做。
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t197sub-home-'));  /* ★ T224：草稿放 os.tmpdir() —— 宿主护栏对 temp 整体绕过（T223 实测），且 temp 在仓外 ⇒ 不受 .gitignore 影响（否则 import_project 会把这些文件过滤掉）*/
const FEATURE = 't197sub';
const FEAT_FILE = path.join(HOME, '.agent-io', 'features', `${FEATURE}.json`); // ★ T252：随 HOME 走
const LOG = 'certs/.work/t197sub-out.txt';

let P = 0, F = 0;
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };
const chk = (ok, label, extra = '') => {
  say(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (tool, args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO,
      env: { ...process.env, AGENT_IO_HOME: HOME }, // ★ T252：数据落 temp
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  const i = out.indexOf('---DATA---');
  const line = i < 0 ? '' : out.slice(i + 10).trim().split('\n')[0].trim();
  let data = null;
  try { data = line ? JSON.parse(line) : null; } catch { data = null; }
  return { err: out.includes('isError=true') || /MCP error/.test(out), text: out, data, first: out.split('\n')[0] };
};
const body = (r, n = 3) => r.text.split('\n').filter((l) => l && !l.startsWith('[agent-io') && !l.startsWith('(node:') && !l.includes('MCP server') && !l.includes('prewarm')).slice(0, n).join(' ⏎ ');
const readFeat = () => { try { return fs.readFileSync(FEAT_FILE, 'utf8'); } catch { return null; } };

// ── 夹具 ──────────────────────────────────────────────────
fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(path.join(EXT, 'src'), { recursive: true });
fs.writeFileSync(path.join(EXT, 'src/a.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
fs.writeFileSync(path.join(EXT, 'package.json'), JSON.stringify({ name: 't197sub-ext', version: '1.0.0' }, null, 2));

let annFullId = '';
try {
  call('manage_feature', { action: 'delete', feature: FEATURE }); // 预清（可重复跑）

  // ══════ Flow-1：任务书顺序 create → import ══════════════════════
  say('\n══ Flow-1（任务书顺序：先建、再导入）');
  const mk = call('manage_feature', { action: 'create', feature: FEATURE });
  chk(!mk.err, 'F1-a `manage_feature action=create`（扁平入参）⇒ 通', mk.first.slice(0, 110));
  const imp = call('import_project', { project_dir: EXT, feature: FEATURE });
  chk(!imp.err, 'F1-b `import_project` ⇒ 通', body(imp, 2));
  const files1 = call('get_dsl', { feature: FEATURE, query: 'files' });
  const hasFile1 = /src\/a\.ts/.test(files1.text);
  say(`     [读数] create→import 后 query=files 里有 src/a.ts 吗？ → ${hasFile1}（★ 回执: ${body(files1, 1)}）`);
  chk(!hasFile1, 'F1-c ★发现：**先 create 再 import ⇒ 设计未被 fork ⇒ query=files 为空**（T193 同款，非缺陷）');

  // ══════ Flow-2：delete → import（设计为空 ⇒ fork）⇒ 有真文件 ══════
  say('\n══ Flow-2（改成 import-就绪顺序 ⇒ 让 DSL 里有真文件）');
  call('manage_feature', { action: 'delete', feature: FEATURE });
  const imp2 = call('import_project', { project_dir: EXT, feature: FEATURE });
  chk(!imp2.err, 'F2-a `manage_feature delete` + `import_project` ⇒ 通', body(imp2, 2));
  const files2 = call('get_dsl', { feature: FEATURE, query: 'files' });
  const filePath = (files2.text.match(/src\/a\.ts/) ?? [])[0];
  chk(!!filePath, 'F2-b ★`get_dsl query=files` 读回 `src/a.ts`（设计已 fork）', body(files2, 2));

  // ══════ A. ③ 改设计 DSL 的【成功路径】 ══════════════════════
  say('\n══ A. ③ 改设计 DSL 的成功路径（含好坏两方向）');
  const shortReason = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '短',
    operations: [{ type: 'node', op: 'add', id: 'n_t197short', data: { label: 'x' } }],
  });
  chk(shortReason.err && /L1/.test(shortReason.text), 'A-1 ★坏输入：reason 仅 1 字 ⇒ **拒**（L1 有效字符 <6）', body(shortReason, 1));
  const vagueReason = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '优化一下代码结构让它变得更好',
    operations: [{ type: 'node', op: 'add', id: 'n_t197vague', data: { label: 'x' } }],
  });
  chk(vagueReason.err && /L3/.test(vagueReason.text), 'A-2 ★坏输入：reason 泛谈（无实体）⇒ **拒**（L3 实体绑定）', body(vagueReason, 1));
  const okUp = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '为 src/a.ts 新增入口节点 n_t197entry（T197 子代理实测成功路径）',
    operations: [{ type: 'node', op: 'add', id: 'n_t197entry', data: { label: '入口节点(T197)', type: 'module' } }],
  });
  chk(!okUp.err, 'A-3 ★好输入：合法 reason（含实体 src/a.ts + 节点 id）⇒ **通**（成功路径）', body(okUp, 1));
  const nodes1 = call('get_dsl', { feature: FEATURE, query: 'nodes' });
  chk(/n_t197entry/.test(nodes1.text), 'A-4 ★读回(工具面)：`get_dsl query=nodes` 里有 n_t197entry', body(nodes1, 3));
  chk((readFeat() ?? '').includes('n_t197entry'), 'A-5 ★读回(磁盘)：`.agent-io/features/t197sub.json` 里落了该节点', `存在=${!!readFeat()}`);

  // ══════ B. ⑤ 加节点 ═══════════════════════════════════════
  say('\n══ B. ⑤ 加节点（任务书说给 label + kind）');
  const withKind = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '按任务书给 src/a.ts 加节点 n_t197kind（带 kind 字段）',
    operations: [{ type: 'node', op: 'add', id: 'n_t197kind', data: { label: '带kind的节点', kind: 'module' } }],
  });
  chk(withKind.err && /不被认的键/.test(withKind.text) && /kind/.test(withKind.text),
    'B-1 ★`data.kind`（不在 NODE_DATA_KEYS 里）⇒ **被 T170c 拒**且**点名 kind**', body(withKind, 2));
  const withType = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '改给 src/a.ts 加节点 n_t197kind2 用合法键 type 而非 kind',
    operations: [{ type: 'node', op: 'add', id: 'n_t197kind2', data: { label: '模块节点(T197)', type: 'module' } }],
  });
  chk(!withType.err, 'B-2 ★好输入：换成合法键 `type` ⇒ **通**（加节点成功）', body(withType, 1));
  const nodes2 = call('get_dsl', { feature: FEATURE, query: 'nodes' });
  chk(/n_t197kind2/.test(nodes2.text), 'B-3 ★读回：`get_dsl query=nodes` 里有 n_t197kind2', body(nodes2, 4));

  // ══════ C. ⑤ 加卡（三种） ══════════════════════════════════
  say('\n══ C. ⑤ 加卡（required 照 op_data_spec.ts 抄）');

  // C-1 决策卡 decision.update（id=文件路径 src/a.ts；data.summary 必填）
  const dec = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '给 src/a.ts 挂决策卡（T197 实测决策卡能不能挂）',
    operations: [{
      type: 'decision', op: 'update', id: filePath || 'src/a.ts',
      data: { summary: 'T197：add 放在 a.ts 的决策', rationale: '实测挂卡', consequences: '后续对拍带上下文', status: 'active', author: 'llm', tags: ['t197sub'] },
    }],
  });
  chk(!dec.err, 'C-1 决策卡 decision.update（锚 src/a.ts）⇒ **通**', body(dec, 1));
  const decBack = call('get_dsl', { feature: FEATURE, query: 'decisions' });
  chk(/add 放在 a\.ts 的决策/.test(decBack.text), 'C-2 ★读回：`get_dsl query=decisions` 里有这张卡', body(decBack, 3));
  const decBad = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '故意不给 summary 给 src/a.ts 挂决策卡（坏输入测试）',
    operations: [{ type: 'decision', op: 'update', id: filePath || 'src/a.ts', data: { rationale: '没给 summary' } }],
  });
  chk(decBad.err && /summary/.test(decBad.text), 'C-3 ★坏输入：decision 缺 data.summary ⇒ **响亮拒**（点名 summary）', body(decBad, 1));

  // C-2 批注 annotation.add（data.text 必填；id 可省）
  const ann = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '给 src/a.ts 加批注（T197 实测批注卡）',
    operations: [{ type: 'annotation', op: 'add', data: { text: 'T197 批注：这里值得复核一下 a.ts 的实现' } }],
  });
  chk(!ann.err, 'C-4 批注 annotation.add ⇒ **通**', body(ann, 1));
  annFullId = (ann.text.match(/anno_[A-Za-z0-9_]+/) ?? [])[0] ?? '';
  say(`     （本证抓到的**完整**批注 id：${annFullId || '（没抓到）'}）`);
  const annBack = call('get_dsl', { feature: FEATURE, query: 'annotations' });
  chk(/T197 批注/.test(annBack.text), 'C-5 ★读回：`get_dsl query=annotations` 里有这条批注', body(annBack, 3));
  const annBad = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: '为 src/a.ts 加一条空批注以测必填（坏输入测试）',
    operations: [{ type: 'annotation', op: 'add', data: {} }],
  });
  chk(annBad.err && /data\.text/.test(annBad.text), 'C-6 ★坏输入：annotation.add 缺 data.text ⇒ **响亮拒**（点名 text）', body(annBad, 1));

  // ★ 先看：刚加的批注**在没 submit 前**是否已出现在 approvals 列表（疑似"看起来不对"的点）
  const aprPre = call('get_dsl', { feature: FEATURE, query: 'approvals' });
  say(`     [读数] 未 submit 前 query=approvals：${body(aprPre, 2) || '（空）'}`);

  // C-3 审批 approval.submit / review（submit 需 annotation_id；review 需 +decision+reviewer）
  const aprSub = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: `把 src/a.ts 上的批注 ${annFullId} 提交审批（T197 实测审批卡 submit）`,
    operations: [{ type: 'approval', op: 'submit', data: { annotation_id: annFullId } }],
  });
  chk(!aprSub.err, 'C-7 审批 approval.submit（给**完整** annotation_id）⇒ **通**', body(aprSub, 1));
  // ★ 坏输入（值域）：decision='approved'（状态词，非动作词 approve）⇒ 看是否**响亮拒**（此时仍 pending_review）
  const aprRevBad = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: `对 src/a.ts 上批注 ${annFullId} 用错值 approved 试 review`,
    operations: [{ type: 'approval', op: 'review', data: { annotation_id: annFullId, decision: 'approved', reviewer: 't197sub' } }],
  });
  chk(aprRevBad.err && /未知决策/.test(aprRevBad.text), 'C-8 ★坏输入（值域）：decision=`approved` ⇒ **响亮拒**（"未知决策: approved"；合法值是 approve/reject）', body(aprRevBad, 1));
  // ★ 坏输入（缺键）：review 缺 data.decision ⇒ 看是否**响亮拒**（此时仍 pending_review，排除状态机干扰）
  const aprBad = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: `对 src/a.ts 上批注做裁定但故意缺 decision（坏输入测试）`,
    operations: [{ type: 'approval', op: 'review', data: { annotation_id: annFullId, reviewer: 'x' } }],
  });
  chk(aprBad.err && /decision/.test(aprBad.text), 'C-9 ★坏输入（缺键）：approval.review 缺 data.decision ⇒ **响亮拒**', body(aprBad, 1));
  const aprRev = call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: `对批注 ${annFullId} 做审批裁定（T197 实测审批卡 review）`,
    operations: [{ type: 'approval', op: 'review', data: { annotation_id: annFullId, decision: 'approve', reviewer: 't197sub' } }],
  });
  chk(!aprRev.err, 'C-10 审批 approval.review（decision=**approve**）⇒ **通**', body(aprRev, 1));
  const aprBack = call('get_dsl', { feature: FEATURE, query: 'approvals' });
  chk(/approved/.test(aprBack.text) && !aprBack.err, 'C-11 ★读回：`get_dsl query=approvals` 显示 [approved]', body(aprBack, 2));
  const aprHist = call('get_dsl', { feature: FEATURE, query: 'approval_history', annotation_id: annFullId });
  say(`     [读数] approval_history(${annFullId})：${body(aprHist, 3) || '（空）'}`);
  lines.push(`     [读数] approval_history：${body(aprHist, 3) || '（空）'}`);

} finally {
  say('\n══ 收尾');
  const del = call('manage_feature', { action: 'delete', feature: FEATURE });
  chk(!del.err, '收尾-1 `manage_feature action=delete`（工具入口）⇒ 通', body(del, 1));
  chk(!fs.existsSync(FEAT_FILE), '收尾-2 ★断言：`.agent-io/features/t197sub.json` 已不存在', `exists=${fs.existsSync(FEAT_FILE)}`);
  fs.rmSync(EXT, { recursive: true, force: true });
  chk(!fs.existsSync(EXT), '收尾-3 ★断言：临时夹具（os.tmpdir 下）已删', `exists=${fs.existsSync(EXT)}`);
  fs.rmSync(HOME, { recursive: true, force: true });
  chk(!fs.existsSync(HOME), '收尾-4 ★断言：本证的数据根（os.tmpdir 下）已删', `exists=${fs.existsSync(HOME)}`);
}

say(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
fs.writeFileSync(LOG, lines.join('\n'), 'utf8');
say(`（完整日志：${LOG}）`);
