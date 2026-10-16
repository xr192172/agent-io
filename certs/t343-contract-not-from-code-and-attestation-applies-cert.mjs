#!/usr/bin/env node
/**
 * ★★★ cert T343 —— 两条真任务的出生证（2026-10-16）：
 *   ① `opl.ts` 新建 `assertContractNotFromCode`（防"契约与代码同源 ⇒ 恒真"）并被 `oplIntegrate` 真实调用；
 *   ② `overlay.ts` 新建读端 `attestationAppliesTo`（让"节点改名/重挂 ⇒ 旧口供失效"有代码）。
 *
 * ## 本证要钉住什么（不许空壳）
 * 两个函数都**必须有真行为**（不是 `return true` / 空函数体 / 永真断言）：
 *   · ① 的判据 = **看源头**（喂给 LLM 的上下文里不许含**现状签名**），**不做结果比对**；
 *   · ② 的判据 = **口供绑的节点 id === 当前节点 id**（`node.id` 是**路径派生** ⇒ 改名换 id ⇒ 对不上 ⇒ 失效）。
 *
 * ## 判据（每条都亲手跑）
 *   ① a) 传现状签名当上下文 ⇒ **抛**（贴错误原文）；b) 不传 ⇒ **通过**；
 *      c) **对照**：绕过守卫（清掉记录的上下文）⇒ 那条"同源契约"**能被写出来**（`expected_apis` 与现状逐字相同）。
 *   ② a) 同 id ⇒ `true`；b) 改名后（新 id）⇒ `false`；c) **对照**：不调这个函数 ⇒ 旧口供在新节点上**仍被当成有效**。
 *   ★ 走工具层：`edit_dsl`（`editDslHandler`）写决策卡/落 `attestation`；`consistency_check`（`consistencyHandler`）判。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **传输/schema 层 [未核]**：直接 import handler，**没经** MCP server 的 `tools/list` JSON Schema。
 *   · **daemon 转发分支 [未核]**：不起 daemon。
 *   · 夹具住 `certs/.work/tmp343`，`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓 `.agent-io/`**。
 *     ★ 工具层那一段把**真仓的 `opl.ts` / `overlay.ts` 原样拷进夹具代码根**再对拍 ⇒ 判的是**真源文件**，
 *       但**真仓一个字节没动**（`copy ≠ 改`）。
 *   · **真 `self-2026-10-15` 的对拍读数**由**另一条探针**单独跑（报告里贴原文），本证**不重做**那一步。
 *   · `call-exists` 依赖索引：夹具内 `syncFile` 现刷；**Go/Python 面不声称覆盖**。
 *
 * ## 用法
 *   node certs/t343-contract-not-from-code-and-attestation-applies-cert.mjs   # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.work/tmp343');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const dump = (label, text) => {
  console.log(`   ── ${label} ──`);
  for (const line of String(text).split('\n')) console.log(`     ${line}`);
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDSL, getDSL, getStorageRoot } = await import('../dist/src/infrastructure/storage.js');
const { loadOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { editDslHandler, consistencyHandler } = await import('../dist/src/application/design/handlers.js');
const { parseDataBlock } = await import('../dist/src/application/plumbing.js');
const dbmod = await import('../dist/src/infrastructure/index/db.js');
const getProjectCacheDb = dbmod.getProjectCacheDb;
const { syncFile, resolveCrossFileCalls } = await import('../dist/src/infrastructure/index/symbols.js');
const { attestationAppliesTo } = await import('../dist/src/domain/overlay.js');
const { assertContractNotFromCode, oplAdd, oplDeclare, oplImplement, oplCheck, oplIntegrate } =
  await import('../dist/src/application/design/derive/opl.js');

// ════════════════════════════════════════════════════════════════════
// 0. ★ 现实依据：**定义行 + 读处，同一次读数**（硬要求：不许跨读数拼）
// ════════════════════════════════════════════════════════════════════
console.log('════ 0. 两条的"定义 / 调用点"在同一段读数里 ════');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8').split('\n');
{
  const opl = read('src/application/design/derive/opl.ts');
  dump(
    '① 定义 + 调用点（同在 opl.ts 一次读数里）',
    opl.filter((l) => /export function assertContractNotFromCode|apiSignaturesOf\(root|assertContractNotFromCode\(s\.decl_code_context|decl_code_context\?:/.test(l)).join('\n'),
  );
  chk(
    opl.some((l) => /export function assertContractNotFromCode/.test(l)) &&
      opl.some((l) => /assertContractNotFromCode\(s\.decl_code_context/.test(l)) &&
      opl.some((l) => /apiSignaturesOf\(root/.test(l)),
    '① 定义与读处同段：`assertContractNotFromCode` **已定义**，且 **`oplIntegrate` 真的调用它**（`s.decl_code_context`）',
  );

  const ov = read('src/domain/overlay.ts');
  const st = read('src/application/design/dsl_ops/status_tools.ts');
  dump('② 定义 + 读处（同在 overlay.ts 一次读数里）', ov.filter((l) => /export function attestationAppliesTo|source_node_id\?:|att\.source_node_id/.test(l)).join('\n'));
  dump('② 写端（status_tools.ts：source_node_id 由写端自动填）', st.filter((l) => /source_node_id/.test(l)).join('\n'));
  chk(
    ov.some((l) => /export function attestationAppliesTo/.test(l)) && ov.some((l) => /att\.source_node_id/.test(l)),
    '② 定义与读处同段：`attestationAppliesTo` **已定义**，且它**真的读** `att.source_node_id` 做比对',
  );

  // ★★ `node.id` 是不是"路径派生"—— 本证 ② 判据成立的前提，必须给证据
  const ip = read('src/infrastructure/graph/import_project.ts');
  dump('② 前提证据 · node.id 的生成（import_project.ts）', ip.filter((l) => /const sanitize = |const fileNodeId = /.test(l)).join('\n'));
  const geom = fs.readFileSync(path.join(REPO, '.agent-io/features/self-2026-10-15.json'), 'utf-8');
  const sampleId = (geom.match(/"id": "(file_src_application_design_derive_opl_ts)"/) ?? [])[1];
  dump('② 前提证据 · 真仓 DSL 里那个 file 节点 id', `id=${sampleId}（= file_ + src/application/design/derive/opl.ts 去符号）`);
  chk(
    ip.some((l) => /const fileNodeId = \(rel: string\): string => `file_\$\{sanitize\(rel\)\}`/.test(l)) && sampleId === 'file_src_application_design_derive_opl_ts',
    '② 前提：`node.id` = `file_${sanitize(路径)}` **路径派生** ⇒ **改名 = 换 id**',
    `实据：file_src_application_design_derive_opl_ts ← src/application/design/derive/opl.ts`,
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. 夹具：代码根（★ 拷真仓两源文件）+ 索引 + feature DSL
// ════════════════════════════════════════════════════════════════════
const CODE = path.join(TMP, 'code');
const P_OPL = 'src/application/design/derive/opl.ts';
const P_OV = 'src/domain/overlay.ts';
// ★ 拷真仓源文件（判的是真源；真仓不动）
for (const rel of [P_OPL, P_OV]) {
  const abs = path.join(CODE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(path.join(REPO, rel), abs);
}
const db = getProjectCacheDb(CODE);
const FILES = [P_OPL, P_OV];
const syncAll = async () => {
  for (const rel of FILES) await syncFile(db, CODE, path.join(CODE, rel));
  resolveCrossFileCalls(db, CODE, { scopeFiles: FILES });
};
await syncAll();

const FEAT = 't343cc';
const ids = {
  opl: 'file_src_application_design_derive_opl_ts',
  ov: 'file_src_domain_overlay_ts',
};
saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  source_root: CODE,
  geometry: {
    layout: 'free',
    width: 800,
    height: 600,
    nodes: [
      { id: ids.opl, type: 'file', label: 'opl.ts', description: P_OPL, arch_layer: 'core' },
      { id: ids.ov, type: 'file', label: 'overlay.ts', description: P_OV, arch_layer: 'service' },
    ],
    edges: [],
  },
  semantic: {
    files: [
      { id: ids.opl, path: P_OPL, responsibility: 'T343 夹具：opl', layer: 'core' },
      { id: ids.ov, path: P_OV, responsibility: 'T343 夹具：overlay', layer: 'service' },
    ],
  },
});

const callEditDsl = (id, data) =>
  editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: `T343 夹具：经 edit_dsl 给 ${id} 写决策卡（summary=想要的形状，expectations=可机判子集）`,
    operations: [{ type: 'decision', op: 'update', id, data }],
  });

// ════════════════════════════════════════════════════════════════════
// 2. ★ 经【工具层】写"想要的形状"（即 §48 那两条红项的形状）
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 2. 经工具层 edit_dsl 写两条 expectations（= 真仓那两条红项的形状）════');
{
  const w1 = await callEditDsl(ids.opl, {
    summary: '缺口③：写 expected_apis 前必须过"契约不得自源"校验',
    expectations: [
      { kind: 'call-exists', path: P_OPL, symbol: 'oplIntegrate', target: 'assertContractNotFromCode', why: '缺口③：必须有一道守卫且被 oplIntegrate 真实调用' },
    ],
  });
  chk(w1.isError !== true, `expectations 经工具层写入：${ids.opl}`, String(w1.text).split('\n')[0]);
  const w2 = await callEditDsl(ids.ov, {
    summary: '缺口②：attestation 的 source_node_id 必须有一处读端做比对',
    expectations: [{ kind: 'symbol-exists', path: P_OV, symbol: 'attestationAppliesTo', why: '缺口②：必须有读端把"口供绑的节点"与"当前节点"比对' }],
  });
  chk(w2.isError !== true, `expectations 经工具层写入：${ids.ov}`, String(w2.text).split('\n')[0]);
}

// ════════════════════════════════════════════════════════════════════
// 3. ★★ 工具层对拍：接上调用点后两条转 pass；摘掉/改名 ⇒ 必红（两方向）
// ════════════════════════════════════════════════════════════════════
const runCC = async () => {
  const res = await consistencyHandler({ feature: FEAT, scope: 'all' });
  if (res.isError) throw new Error(`consistency_check 抛错：${res.text}`);
  return { text: res.text, data: parseDataBlock(res.text) };
};
const verdictOf = (data, kind) => data.expectation_results.items.find((x) => x.expectation.kind === kind);

console.log('\n════ 3. 方向 1（能绿）：真源文件接上了 ⇒ 两条全 pass ════');
{
  const { text, data } = await runCC();
  const er = data.expectation_results;
  dump('consistency_check 回执（节选）', text.split('\n').filter((l) => /检查项|call-exists|symbol-exists|差异块|没有差异/.test(l)).join('\n'));
  chk(er.checked === 2 && er.passed === 2 && er.failed === 0 && er.unsupported === 0,
    '3-① 两条**全判且全绿**（checked=2 passed=2 failed=0 unsupported=0）⇒ 不是"永远红"',
    `checked=${er.checked} passed=${er.passed} failed=${er.failed} unsupported=${er.unsupported}`);
  const c = verdictOf(data, 'call-exists');
  const s = verdictOf(data, 'symbol-exists');
  chk(c?.verdict === 'pass', '3-① a `call-exists: opl.ts#oplIntegrate → assertContractNotFromCode` **pass**', c?.detail ?? '');
  chk(s?.verdict === 'pass', '3-① b `symbol-exists: overlay.ts#attestationAppliesTo` **pass**', s?.detail ?? '');
}

const deviate = async (label, rel, from, to, kind) => {
  console.log(`\n════ 3. 方向 2（能红）：${label} ════`);
  const abs = path.join(CODE, rel);
  const before = fs.readFileSync(abs, 'utf-8');
  const after = before.split(from).join(to);
  chk(after !== before, `偏离已落进**夹具拷贝**（${rel}，改的是拷贝、不是真仓）`);
  fs.writeFileSync(abs, after, 'utf-8');
  await syncAll();
  const { data } = await runCC();
  const it = verdictOf(data, kind);
  chk(it?.verdict === 'fail', `方向 2：该条必红（verdict=${it?.verdict}）`, it?.detail ?? '');
  fs.writeFileSync(abs, before, 'utf-8');
  await syncAll();
};

await deviate('摘掉 oplIntegrate 里的守卫调用', P_OPL, '  assertContractNotFromCode(s.decl_code_context ?? []);', '  // T343 证伪：守卫调用被摘掉', 'call-exists');
await deviate('把 overlay.ts 的读端改名', P_OV, 'function attestationAppliesTo(', 'function attestationAppliesTo_RENAMED(', 'symbol-exists');

// ════════════════════════════════════════════════════════════════════
// 4. ★★★ ① `assertContractNotFromCode` 的 a/b/c —— 走**真 OPL 函数**端到端
// ════════════════════════════════════════════════════════════════════
const FEAT_OPL = 't343opl';
const SIG = '(a: string) => void'; // 声明契约的签名（= 喂进去的现状签名）
console.log('\n════ 4. ① assertContractNotFromCode：a/b/c ════');
{
  // a) 传现状签名当上下文 ⇒ 抛
  let errA = '';
  try {
    assertContractNotFromCode([SIG]);
  } catch (e) {
    errA = (e && e.message) || String(e);
  }
  chk(!!errA, '① a **传现状签名当上下文 ⇒ 抛**（贴错误原文）', errA ? errA.split('\n').slice(0, 4).join('\n     ') : '★ 没抛！');
  // b) 不传 ⇒ 通过（不误伤）
  let okB = true;
  try {
    assertContractNotFromCode([]);
  } catch {
    okB = false;
  }
  chk(okB, '① b **不传 ⇒ 通过**（不误伤：没有现状签名就不拦）');

  // ── 端到端：真 OPL 函数链 add → declare(带现状签名上下文) → implement → check → integrate ──
  saveDSL({ id: `feature_${FEAT_OPL}`, type: 'feature_diagram', feature: FEAT_OPL, version: '1.0.0', title: FEAT_OPL, source_root: CODE, geometry: { layout: 'free', width: 100, height: 100, nodes: [] }, semantic: { files: [] } });
  const st = oplAdd(FEAT_OPL, 'T343：验证契约不得自源');
  oplDeclare(FEAT_OPL, st.id, {
    files: [{ path: 'x.ts', lang: 'ts', apis: [{ name: 'foo', signature: SIG }] }],
    declCodeContext: [SIG], // ★ 声明时喂进去的**现状签名**
  });
  // 沙箱里写一份与契约**逐字同签名**的实现 ⇒ check 判 accepted
  const implAbs = path.join(getStorageRoot(), 'opl', FEAT_OPL, st.id, 'impl', 'x.ts');
  fs.mkdirSync(path.dirname(implAbs), { recursive: true });
  fs.writeFileSync(implAbs, 'export function foo(a: string): void {\n  return;\n}\n', 'utf-8');
  oplImplement(FEAT_OPL, st.id);
  const checked = oplCheck(FEAT_OPL, st.id);
  chk(checked.live[0]?.state === 'accepted', '4-前提 真 DSL 比较：沙箱实现与契约一致 ⇒ accepted', `live=${JSON.stringify(checked.live)}`);

  // a') 端到端：带"现状签名上下文"的声明 ⇒ integrate 被守卫拦下、DSL 不被写
  let errInteg = '';
  try {
    await oplIntegrate(FEAT_OPL, st.id);
  } catch (e) {
    errInteg = (e && e.message) || String(e);
  }
  const dslAfter = getDSL(FEAT_OPL);
  const wrote = (dslAfter.semantic?.files ?? []).some((f) => f.path === 'x.ts');
  chk(!!errInteg && !wrote, '① a′ 端到端：**声明喂过现状签名 ⇒ `oplIntegrate` 抛，`expected_apis` 一个字都没写**', errInteg ? errInteg.split('\n').slice(0, 3).join('\n     ') : '★ 没抛');
  chk(!wrote, '① a′ b 反证：该契约**没有**出现在 `semantic.files`（`expected_apis` 未被写出）');

  // c) 对照：**绕过守卫**（清掉记录的上下文）⇒ 那条"同源契约"**能**被写出来
  const stateFile = path.join(getStorageRoot(), 'opl', FEAT_OPL, st.id, 'state.json');
  const raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  chk(Array.isArray(raw.decl_code_context) && raw.decl_code_context.length === 1, '① c 前提：state 里**记着**喂进去的现状签名（守卫的判据源头）', JSON.stringify(raw.decl_code_context));
  delete raw.decl_code_context; // ★ 绕过：把判据源头清掉（= 守卫拿不到信号）
  fs.writeFileSync(stateFile, JSON.stringify(raw, null, 2), 'utf-8');
  await oplIntegrate(FEAT_OPL, st.id);
  const dslC = getDSL(FEAT_OPL);
  const f = (dslC.semantic?.files ?? []).find((x) => x.path === 'x.ts');
  const writtenSig = f?.expected_apis?.[0]?.signature;
  chk(!!f, '① c 对照：**绕过守卫后，同源契约被写进 `semantic.files`**（有守卫时写不进去）');
  chk(writtenSig === SIG, '① c 对照：写出来的 `expected_apis` 与**现状签名逐字相同**（恒真契约）', `written=${JSON.stringify(f?.expected_apis)}`);

  // ── c2) 更硬：**把守卫调用从编译产物里整行摘掉**（= 真的"去掉守卫"）⇒ 同一份"有毒上下文"照样写出来 ──
  const st2 = oplAdd(FEAT_OPL, 'T343：去掉守卫的对照');
  oplDeclare(FEAT_OPL, st2.id, {
    files: [{ path: 'y.ts', lang: 'ts', apis: [{ name: 'bar', signature: SIG }] }],
    declCodeContext: [SIG],
  });
  const impl2 = path.join(getStorageRoot(), 'opl', FEAT_OPL, st2.id, 'impl', 'y.ts');
  fs.mkdirSync(path.dirname(impl2), { recursive: true });
  fs.writeFileSync(impl2, 'export function bar(a: string): void {\n  return;\n}\n', 'utf-8');
  oplImplement(FEAT_OPL, st2.id);
  oplCheck(FEAT_OPL, st2.id);
  let errKeep = '';
  try { await oplIntegrate(FEAT_OPL, st2.id); } catch (e) { errKeep = (e && e.message) || String(e); }
  chk(!!errKeep, '① c2 前提：有守卫时，这份带"有毒上下文"的契约仍被拦下', errKeep.split('\n')[0]);
  const srcJs = path.join(REPO, 'dist/src/application/design/derive/opl.js');
  const tmpJs = path.join(REPO, 'dist/src/application/design/derive/__opl_noguard_t343.js');
  try {
    const js = fs.readFileSync(srcJs, 'utf-8');
    const patched = js.split('assertContractNotFromCode(s.decl_code_context ?? []);').join('void 0; // T343：守卫被摘掉');
    chk(patched !== js, '① c2 偏离已落进**编译产物副本**（守卫那一行被摘掉；真 dist 不改）');
    fs.writeFileSync(tmpJs, patched, 'utf-8');
    const { oplIntegrate: oplIntegrateNoGuard } = await import(`file://${tmpJs.replace(/\\/g, '/')}?t=${Date.now()}`);
    await oplIntegrateNoGuard(FEAT_OPL, st2.id);
    const g = (getDSL(FEAT_OPL).semantic?.files ?? []).find((x) => x.path === 'y.ts');
    chk(g?.expected_apis?.[0]?.signature === SIG, '① c2 对照：**去掉守卫 ⇒ 同源契约被写出来**（`expected_apis` 与现状逐字相同）', `written=${JSON.stringify(g?.expected_apis)}`);
  } finally {
    try { fs.rmSync(tmpJs, { force: true }); } catch { /* ignore */ }
  }
}

// ════════════════════════════════════════════════════════════════════
// 5. ★★★ ② `attestationAppliesTo` 的 a/b/c
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 5. ② attestationAppliesTo：a/b/c ════');
{
  const att = { kind: 'attestation', by: 'human', at: '2026-10-16T00:00:00Z', why: 'T343：人签', source_node_id: 'file_src_a_ts' };
  chk(attestationAppliesTo(att, 'file_src_a_ts') === true, '② a **同 id ⇒ true**（口供仍适用于该节点）');
  chk(attestationAppliesTo(att, 'file_src_b_ts') === false, '② b **改名后（新 id）⇒ false**（旧口供失效）', 'source_node_id=file_src_a_ts · currentNodeId=file_src_b_ts');
  chk(attestationAppliesTo({ ...att, source_node_id: undefined }, 'file_src_a_ts') === false, '② b′ 无出处的口供 ⇒ false（说不清给谁作证 ⇒ 不适用）');
  // c) 对照：**不调这个函数**（只看 kind）⇒ 旧口供在新节点上仍被当成有效
  const naive = (e) => e.kind === 'attestation'; // ★ 对照组：忽略 source_node_id 的"假读端"
  chk(naive(att) === true, '② c 对照：**不调这个函数**（只看 kind）⇒ 旧口供在**新节点**上仍被判"有效"（这就是失效逻辑不存在的样子）', `naive(旧口供) on 新节点 = ${naive(att)}；attestationAppliesTo = ${attestationAppliesTo(att, 'file_src_b_ts')}`);
}

// ════════════════════════════════════════════════════════════════════
// 6. ★ 走工具层：edit_dsl 落一条 attestation（写端自动填 source_node_id）⇒ 读端判
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 6. 走工具层：edit_dsl 的 status op 落 attestation ⇒ 读端比对 ════');
{
  const FEAT_ATT = 't343att';
  const NODE = 'file_src_m_ts';
  saveDSL({
    id: `feature_${FEAT_ATT}`, type: 'feature_diagram', feature: FEAT_ATT, version: '1.0.0', title: FEAT_ATT, source_root: CODE,
    geometry: { layout: 'free', width: 100, height: 100, nodes: [{ id: NODE, type: 'file', label: 'm.ts', description: 'src/m.ts', arch_layer: 'core' }] },
    semantic: { files: [{ id: NODE, path: 'src/m.ts', responsibility: 'T343：口供夹具', layer: 'core' }] },
  });
  const res = await editDslHandler({
    feature: FEAT_ATT,
    weight: 'routine',
    reason: 'T343：经 edit_dsl 的 status op 给节点置 done 并落一条 attestation（写端自动填 source_node_id）',
    operations: [{ type: 'status', op: 'update', id: NODE, data: { status: 'done', evidence: { kind: 'attestation', by: 'human', at: '2026-10-16T00:00:00Z', why: 'T343：人工确认' } } }],
  });
  chk(res.isError !== true, '6-① 经工具层 edit_dsl 落 attestation 成功', String(res.text).split('\n')[0]);
  const ev = loadOverlay(FEAT_ATT)?.anchors?.[NODE]?.progress_evidence;
  dump('overlay 里的 evidence 原文', JSON.stringify(ev));
  chk(ev?.kind === 'attestation' && ev.source_node_id === NODE, '6-② 写端自动填了 `source_node_id`（= 它写的那条锚点键）', `source_node_id=${ev?.source_node_id}`);
  chk(attestationAppliesTo(ev, NODE) === true, '6-③ 读端 `attestationAppliesTo(evidence, 该节点)` ⇒ **true**');
  chk(attestationAppliesTo(ev, 'file_src_renamed_ts') === false, '6-④ ★ 读端 `attestationAppliesTo(evidence, 改名后新节点)` ⇒ **false**（旧口供失效）');
}

// ★★ 清理（Windows EBUSY 时响亮报告，不算判红）
try {
  try { dbmod.closeAllProjectCacheDbs?.(); } catch { /* ignore */ }
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 句柄占用，**不是本证的判据**：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
