#!/usr/bin/env node
/**
 * ★★★ cert T353 —— **闸默认是【校验器】，不是【关卡】**（2026-10-17 · `docs/gate-principle.md`）。
 *
 * 用户原话（`gate-principle.md` 开头逐字）：*"每个闸应该是**提醒和校验**，而不是**堵到其他的产生死循环**。"*
 *
 * ## 本笔的**三个新方向**（B.1：每个新方向都要有一条打它的证）
 *   ① **`publish` 两级**（`two_level_tasks` / `publish_rule.corrected`）：
 *      无 decision / 太粗 ⇒ **L1 建构卡**（0 条期望、summary 只拼既有字段）· 有后态判据 ⇒ **L2 实现卡**；
 *   ② **造节点独立入口**：`edit_dsl {type:'node', op:'add', data:{ path }}` 能**新建** `path` 型节点
 *      （此前 `NODE_DATA_KEYS` 没有 `path` ⇒ 只能给老节点挂卡）· 且**乱造被拒**（id 重 / path 空 / 绝对路径 / kind 非法）；
 *   ③ **写闸收集失败 ⇒ 点名 + 放行 + 留痕**（从"抛错"退一步；留痕落 `dsl.annotations`，读端 = `listAnnotations`）。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ①a 无 decision ⇒ publish **成功**且级别 L1（旧行为 = 拒 —— 同一次读数里用旧谓词复刻对照）；
 *   ①b L1 卡上 **0 条期望**（★ **没有编造的实现判据**：逐条看过，数组为空）；
 *   ①c L1 的 summary **只来自既有字段**（semantic.responsibility），且带"待建构"；
 *   ①d 连 semantics 都没有 ⇒ 卡上只有 id，且 `data.missing` **如实报**"需要用户/我手写一句"（不编）；
 *   ①e 有后态判据 ⇒ **L2**，summary/expectations **逐字来自 decision**（与 ①b 形成对照）；
 *   ①f L1 能 claim（判据 = DSL 建构完整）· complete 前拒/后过 · 之后 publish 升 L2（证据不丢）；
 *   ②a 空 feature 里直接 `node add` 出一个 `path` 型节点（不需要任何**已有**节点/卡）；
 *   ②b 定义与消费同一次读数：`collectGateCoverage` 的 `byPath` 里**当场**出现该 path → node_id；
 *   ②c-e 乱造被拒：id 重 / path 空 / 绝对路径 / kind 非法 ⇒ 都点名，且**一个节点都没多**；
 *   ③a 收集失败 ⇒ **放行**（applicable:true · basis=unaddressable），不再抛；
 *   ③b 点名（node_id + "既无 path 也无 description"）；
 *   ③c 留痕**能被读到**：`listAnnotations` 读出该节点上一条 unresolved / severity=warning 的 annotation；
 *   ③d 补上 path 之后 ⇒ **不再**是 unaddressable（警告消失，闸重新看得见节点）。
 *
 * ## ★★ "自己坏"的对照（B.1：证必须能被自己的反面打红）
 *   · ①a：把 publish 退回"无 decision ⇒ 拒" ⇒ `oldReject()` 复刻的那条谓词会在**新代码**上变真 ⇒ ①a 红；
 *   · ①b：让 L1 也"补一条 file-exists" ⇒ ①b（0 条期望）当场红；
 *   · ②a：把 `path` 从 `NODE_DATA_KEYS` 删掉 ⇒ `node add` 会报"不被认的键" ⇒ ②a 红；
 *   · ③a：把收集失败退回"抛" ⇒ ③a 红（gate() 会返回 threw）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不写真仓**：`AGENT_IO_HOME` = 临时 home（`mkdtempSync`，不删旧目录 —— 宿主的删除闸会把它崩成假红）；
 *   · **MCP 传输层 [未核]**：直接 import handler / 函数，不经 server 的 `tools/list` JSON Schema；
 *   · **board 读端（T8）[未核]**：本证只证"卡被写出来 + 内容有出处"，不证榜单显示；
 *   · **`path` 型节点的渲染 [未核]**：只证"能造 + 能被闸认亲"，不证画布画出它。
 *
 * ## 用法
 *   node certs/t353-gate-principle-unblock-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp353-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src/domain'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/domain/exists.ts'), 'export const exists = 1;\n', 'utf-8');
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { assertSourceWriteRegistered, collectGateCoverage } = await import('../dist/src/application/write_gate.js');
const { listAnnotations } = await import('../dist/src/application/design/dsl_ops/annotation_tools.js');
const { postExpectations } = await import('../dist/src/domain/expectation.js');
const { taskLevel } = await import('../dist/src/domain/task_schema.js');

const FEAT = 't353';
const seed = (nodes, files = []) =>
  saveDSL({
    id: `feature_${FEAT}`,
    type: 'feature_diagram',
    feature: FEAT,
    version: '1.0.0',
    title: FEAT,
    source_root: ROOT,
    geometry: { layout: 'free', width: 400, height: 300, nodes, edges: [] },
    semantic: { files },
    layers: {},
    annotations: [],
  });

const edit = (ops, reason) =>
  editDslHandler({ feature: FEAT, weight: 'routine', agent: 'agent-t353', reason, operations: ops });
const run = async (ops, reason) => {
  const r = await edit(ops, reason);
  return { text: String(r?.text ?? ''), isError: r?.isError === true };
};
const nodeOf = (id) => (getDSL(FEAT).geometry?.nodes ?? []).find((n) => n.id === id);
const gate = (rel) => {
  try {
    return { threw: false, out: assertSourceWriteRegistered(ROOT, [rel]) };
  } catch (e) {
    return { threw: true, msg: String(e.message) };
  }
};

// ════════════════════════════════════════════════════════════════════
// 夹具
// ════════════════════════════════════════════════════════════════════
const P_NONE = 'n_no_decision'; // 没有 decision（但有 semantics）⇒ L1
const P_BARE = 'n_bare'; // 连 semantics/description/label 都没有 ⇒ L1 只有 id
const P_L2 = 'n_with_decision'; // 有后态判据 ⇒ L2
const P_GATE = 'n_gate_unaddressable'; // 既无 path 也无 description ⇒ 写闸收集失败

seed(
  [
    { id: P_NONE, type: 'file', label: '配置加载', description: 'src/domain/exists.ts' },
    { id: P_BARE, type: 'file', label: 'n_bare' }, // ★ label 与 id 相同（自动生成）⇒ 不算"内容"
    {
      id: P_L2,
      type: 'file',
      label: '有判据的节点',
      path: 'src/domain/exists.ts',
      decision: {
        summary: 'T353 夹具：这个节点已经有一张可判的决策卡',
        expectations: [{ kind: 'file-exists', path: 'src/domain/exists.ts', why: 'T353 夹具：后态判据（文件在）' }],
      },
    },
    { id: P_GATE, type: 'file', label: '收集失败节点' },
  ],
  [
    { id: P_NONE, path: 'src/domain/exists.ts', responsibility: '配置加载与校验（T353 夹具语义）' },
    { id: P_L2, path: 'src/domain/exists.ts', responsibility: '有判据的节点' },
    // ★ P_GATE **故意不给** semantic.files 条目：若有它，`collectGateCoverage` 的
    //   `semantic.files` 兜底会把这个路径补进 byPath ⇒ 就不再是"收集失败"（那是另一条真实但不同的路）。
  ],
);

/** ★ 旧判据的**逐字复刻**（改前 publish：无 summary / 无 expectations / 无 post ⇒ 拒） */
const oldPublishRejects = (n) =>
  !(typeof n?.decision?.summary === 'string' && n.decision.summary.trim()) ||
  (n?.decision?.expectations ?? []).length === 0 ||
  postExpectations(n?.decision?.expectations ?? []).length === 0;

// ════════════════════════════════════════════════════════════════════
console.log('════ ① publish 两级：无 decision ⇒ L1（旧行为：拒）════');
{
  chk(oldPublishRejects(nodeOf(P_NONE)), '①0 **改前对照**：旧谓词对这个节点给"拒"（无 decision）');
  const r = await run([{ type: 'task', op: 'publish', id: P_NONE }], `给无 decision 的节点立 L1 卡 ${P_NONE}`);
  const card = nodeOf(P_NONE)?.task;
  console.log(`     message = ${r.text.split('\n').slice(0, 2).join(' ｜ ')}`);
  chk(!r.isError && /L1 建构卡/.test(r.text), '①a **改后**：publish 成功，回执点名"L1 建构卡"', r.text.split('\n')[1]?.trim() ?? r.text);
  chk(
    Array.isArray(card?.expectations) && card.expectations.length === 0,
    '①b ★★ 卡上 **0 条期望** —— 没有编造任何实现判据',
    `expectations=${JSON.stringify(card?.expectations)}`,
  );
  chk(
    /待建构/.test(card?.summary ?? '') &&
      /配置加载与校验/.test(card?.summary ?? '') &&
      (card?.summary ?? '').includes(P_NONE),
    '①c summary 带"待建构"且**只来自既有字段**（semantic.responsibility + id）',
    `summary=${JSON.stringify(card?.summary)}`,
  );
  chk(
    card?.discussion?.micro?.includes('responsibility') === true,
    '①d 卡上 `discussion.micro` 记了 summary 的**出处**（可对拍）',
    JSON.stringify(card?.discussion),
  );
  chk(taskLevel(card) === 'L1', `①e 派生级别 taskLevel(card) = ${JSON.stringify(taskLevel(card))}`);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ①\' 连 semantics 都没有 ⇒ 如实报"需要手写一句"，不编 ════');
{
  const r = await run([{ type: 'task', op: 'publish', id: P_BARE }], `给无 semantics 的节点立 L1 卡 ${P_BARE}`);
  const card = nodeOf(P_BARE)?.task;
  chk(!r.isError && card?.expectations?.length === 0, '①\'a 仍然能立 L1（0 条期望）', r.text.split('\n')[1]?.trim() ?? '');
  chk(
    (card?.summary ?? '').includes(P_BARE) && !/配置加载|有判据|收集失败/.test(card?.summary ?? ''),
    '①\'b 卡上**只有 id**（没借别人的语义、没编内容）',
    `summary=${JSON.stringify(card?.summary)}\n     label=${JSON.stringify(nodeOf(P_BARE)?.label)}`,
  );
  chk(
    /需要用户\/我手写一句/.test(r.text),
    '①\'c 回执**如实报**"需要用户/我手写一句『我要实现什么』"',
    r.text.split('\n')[1]?.trim() ?? r.text,
  );
  chk(
    (card?.discussion?.open ?? []).some((s) => /手写一句/.test(s)),
    '①\'d 这条"缺什么"也落进卡的 `discussion.open`（不只打在回执上）',
    JSON.stringify(card?.discussion?.open),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ①\'\' 有可判的后态判据 ⇒ L2（逐字翻 decision）════');
{
  const r = await run([{ type: 'task', op: 'publish', id: P_L2 }], `给有判据的节点立 L2 卡 ${P_L2}`);
  const card = nodeOf(P_L2)?.task;
  const dec = nodeOf(P_L2)?.decision;
  chk(!r.isError && taskLevel(card) === 'L2', '①\'\'a 级别 = L2（★ 与 ①a 的 L1 同一函数判定）', r.text.split('\n')[1]?.trim() ?? '');
  chk(card?.summary === dec?.summary, '①\'\'b summary **逐字等于** decision.summary', JSON.stringify(card?.summary));
  chk(
    JSON.stringify(card?.expectations) === JSON.stringify(dec?.expectations),
    `①\'\'c expectations **深等**（${dec?.expectations?.length} 条，逐字来自 decision）`,
    JSON.stringify(card?.expectations?.map((e) => e.kind)),
  );
  chk(
    (card?.expectations ?? []).length > 0 &&
      (nodeOf(P_NONE)?.task?.expectations ?? []).length === 0,
    '①\'\'d ★ 同一次读数里的对照：L2 有判据 / L1 一条没有（不是"都空"或"都满"）',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ①\'\'\' L1 能领 / 能收口 / 收口后升 L2（证据不丢）════');
{
  const cla = await run([{ type: 'task', op: 'claim', id: P_NONE, data: { owner: 'agent-t353' } }], `领取 L1 建构卡 ${P_NONE}`);
  chk(!cla.isError && nodeOf(P_NONE)?.task?.state === 'claimed', '①\'\'\'a L1 可领（判据 = "DSL 建构完整吗" ⇒ 不完整 ⇒ 有活）', cla.text.split('\n')[1]?.trim() ?? '');
  chk(/DSL 建构完整/.test(cla.text), '①\'\'\'b 回执点名 L1 的判据（不是对拍）');

  const c1 = await run(
    [{ type: 'task', op: 'complete', id: P_NONE, data: { evidence: { kind: 'attestation', by: 'human', at: new Date().toISOString(), why: 'T353 夹具：还没建构完，应当被拒' } } }],
    `在 DSL 没建好时收口 ${P_NONE}`,
  );
  chk(c1.isError && /L1 建构未完成/.test(c1.text), '①\'\'\'c 建构未完成 ⇒ complete **拒**并点名缺什么', c1.text.split('\n')[1]?.trim() ?? '');

  // ★ 建构：给该节点写 decision（summary + 一条 post 判据）
  const w = await run(
    [{ type: 'decision', op: 'update', id: P_NONE, data: { summary: '把配置加载这一段落成设计 DSL', expectations: [{ kind: 'file-exists', path: 'src/domain/exists.ts', why: 'T353 夹具：后态判据（文件在）' }] } }],
    `给 L1 卡对应的节点写决策卡 ${P_NONE}`,
  );
  chk(!w.isError, '①\'\'\'d 写决策卡成功（L1 的"做事"就是补 DSL）', w.text.split('\n')[1]?.trim() ?? '');
  const c2 = await run(
    [{ type: 'task', op: 'complete', id: P_NONE, data: { evidence: { kind: 'attestation', by: 'human', at: new Date().toISOString(), why: 'T353 夹具：decision.summary + 一条 post 判据已就位' } } }],
    `建构完成后收口 ${P_NONE}`,
  );
  chk(!c2.isError && nodeOf(P_NONE)?.task?.state === 'done', '①\'\'\'e 建构完整 ⇒ complete **过**（L1 收口）', c2.text.split('\n')[1]?.trim() ?? '');
  chk(/L1 建构完整/.test(c2.text), '①\'\'\'f 回执点名"L1 建构完整"（判据 = 建构，不是代码跑通）');

  const up = await run([{ type: 'task', op: 'publish', id: P_NONE }], `L1 完成后升 L2 ${P_NONE}`);
  const card = nodeOf(P_NONE)?.task;
  chk(!up.isError && taskLevel(card) === 'L2', '①\'\'\'g L1(done) ⇒ publish **升一级**成 L2', up.text.split('\n')[1]?.trim() ?? '');
  chk(
    (card?.evidence ?? []).length >= 1,
    `①\'\'\'h ★ 旧 L1 卡的 evidence **逐条搬进新卡**（不静默丢证据）：${(card?.evidence ?? []).length} 条`,
    JSON.stringify(card?.evidence),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② 造节点独立入口：edit_dsl node.add 带 path（不需要任何已有节点/卡）════');
const NEW_ID = 'n_created_by_t353';
const NEW_PATH = 'src/domain/t353_created.ts';
{
  const before = (getDSL(FEAT).geometry?.nodes ?? []).length;
  const r = await run(
    [{ type: 'node', op: 'add', id: NEW_ID, data: { label: 'T353 造出来的 path 型节点', type: 'file', path: NEW_PATH } }],
    `造一个 path 型节点 ${NEW_ID}`,
  );
  const n = nodeOf(NEW_ID);
  chk(!r.isError && !!n, '②a **造得出来**（此前 `path` 不在 data 键集里 ⇒ 报"不被认的键"）', r.text.split('\n')[1]?.trim() ?? r.text);
  chk(n?.path === NEW_PATH, `②a\' node.path = ${JSON.stringify(n?.path)}（路径归一成 /）`);
  chk((getDSL(FEAT).geometry?.nodes ?? []).length === before + 1, `②a\'\' 节点数 ${before} → ${before + 1}`);

  // ★★ 定义与消费**同一次读数**：collect 的 byPath 立刻认得它（不是"存在但没人读"）
  const cov = collectGateCoverage(ROOT);
  const byPath = cov.features.find((f) => f.feature === FEAT)?.byPath;
  chk(
    byPath?.get(NEW_PATH) === NEW_ID,
    '②b ★★ 定义与消费同一次读数：`collectGateCoverage` 的 byPath 里当场是 ' + `${NEW_PATH} → ${byPath?.get(NEW_PATH)}`,
    `byPath=${JSON.stringify(byPath ? [...byPath] : null)}`,
  );

  // ── 乱造被拒（入口自己的校验）──
  const dup = await run(
    [{ type: 'node', op: 'add', id: NEW_ID, data: { type: 'file', path: 'src/domain/other.ts' } }],
    `重复 id 造节点 ${NEW_ID}`,
  );
  chk(dup.isError && /已存在/.test(dup.text), '②c id 重复 ⇒ 拒（"建"不能变成"覆盖"）', dup.text.split('\n')[1]?.trim() ?? '');

  const empty = await run(
    [{ type: 'node', op: 'add', id: 'n_empty_path', data: { type: 'file', path: '   ' } }],
    `为节点 n_empty_path（src/domain/empty.ts）造 path`,
  );
  chk(empty.isError && /path 不能为空/.test(empty.text), '②d path 为空 ⇒ 拒', empty.text.split('\n')[1]?.trim() ?? '');

  const abs = await run(
    [{ type: 'node', op: 'add', id: 'n_abs_path', data: { type: 'file', path: 'C:/tmp/x.ts' } }],
    `为节点 n_abs_path（C:/tmp/x.ts）造 path`,
  );
  chk(abs.isError && /仓库相对路径/.test(abs.text), '②d\' 绝对路径 ⇒ 拒（越出 source_root）', abs.text.split('\n')[1]?.trim() ?? '');

  const badKind = await run(
    [{ type: 'node', op: 'add', id: 'n_bad_kind', data: { type: 'service', path: 'src/domain/svc.ts' } }],
    `为节点 n_bad_kind（src/domain/svc.ts）造 path`,
  );
  chk(badKind.isError && /kind 非法/.test(badKind.text), '②e kind 非法（type=service + path）⇒ 拒，并点名合法值', badKind.text.split('\n')[1]?.trim() ?? '');
  chk(
    !nodeOf('n_empty_path') && !nodeOf('n_abs_path') && !nodeOf('n_bad_kind'),
    '②f ★ 三次乱造 ⇒ **一个节点都没多**（拒 = 不落盘）',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ③ 写闸收集失败：点名 + 放行 + 留痕（改前：抛错）════');
{
  // ★ 改前对照（逐字复刻旧行为）：unaddressable 非空 ⇒ 抛
  const oldWouldThrow = (collectGateCoverage(ROOT).unaddressable ?? []).length > 0;
  const g = gate('src/domain/gate.ts');
  chk(oldWouldThrow, '③0 **改前对照**：这个夹具在旧口径下 `unaddressable>0` ⇒ 旧代码会**抛**');
  chk(
    !g.threw && g.out.applicable === true && g.out.basis === 'unaddressable',
    '③a **改后**：**放行**（applicable:true · basis=unaddressable），不再抛',
    g.threw ? g.msg.split('\n')[0] : JSON.stringify({ applicable: g.out.applicable, basis: g.out.basis }),
  );
  chk(
    !g.threw && /既无 path 也无 description/.test(g.out.note) && g.out.note.includes(P_GATE),
    '③b **点名**（"点名"这条没退回静默）',
    g.threw ? '' : g.out.note.split('\n').find((l) => l.includes(P_GATE)) ?? '',
  );
  const anns = listAnnotations({ feature: FEAT, unresolved_only: true }).annotations;
  const hit = anns.find((a) => a.node_id === P_GATE && a.severity === 'warning');
  chk(
    !!hit && hit.type === 'issue' && !hit.resolved,
    '③c ★★ **留痕能被读到**（`listAnnotations` = `query_feature {query:\'annotations\'}` 的同一个读端）',
    JSON.stringify(hit ? { id: hit.id, node_id: hit.node_id, severity: hit.severity, type: hit.type, author: hit.author } : null),
  );
  chk(
    /既无 path 也无 description/.test(hit?.text ?? '') && /不损坏数据/.test(hit?.text ?? ''),
    '③c\' 留痕正文写清"为什么放行"（不是一条空壳警告）',
    (hit?.text ?? '').split('\n')[1] ?? '',
  );
  chk(
    (g.out?.warnings ?? []).length >= 1 && /query_feature/.test(g.out.warnings.join('\n')),
    '③c\'\' 本次读数里也带 `warnings`（并给出**怎么读**），不只依赖落盘',
    JSON.stringify(g.out?.warnings ?? null),
  );

  // ★ 修好它 ⇒ 闸重新"看得见"这个节点（警告不是永久标签）
  const fix = await run(
    [{ type: 'node', op: 'update', id: P_GATE, data: { path: 'src/domain/gate.ts' } }],
    `给收集失败的节点补 path ${P_GATE}`,
  );
  chk(!fix.isError && nodeOf(P_GATE)?.path === 'src/domain/gate.ts', '③d 补上 `path` 成功（走的是 node.update 的同一把尺）', fix.text.split('\n')[1]?.trim() ?? '');
  const g2 = gate('src/domain/gate.ts');
  chk(
    g2.threw && /没有挂到任何已领取的任务上/.test(g2.msg),
    '③d\' 补完后 ⇒ **不再是 unaddressable**，闸回到"未领任务"那条（★ 节点被看见了）',
    g2.threw ? g2.msg.split('\n')[0] : JSON.stringify(g2.out),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
