#!/usr/bin/env node
/**
 * ★★★ cert T335 —— **「把 `acceptance`（人读的一句话）译成 `expectations`（可机判子集）」到底能不能走通、
 * 且译出来的是【意图】而不是【现状】的出生证**（2026-10-15）。
 *
 * ## 本证要钉住什么
 * 设计侧真有一个节点（`run82` 的 `file…rename_file_ts` 决策卡）写了 `acceptance`：
 *   *"目录 ⇒ `ok:false` + `blocked` + ★ **整体未落盘**；回归：对 `src/domain/chain_wiring.ts` 改名 `dry-run`
 *    ⇒ **仍报出真实引用**（`contract_page.ts` / `first_hop_args.ts`）。"*
 * 其中**可机判的那一部分** = 「chain_wiring.ts 真实存在」+「两张文件真的**依赖**它」——
 * 用现有六种 kind 里的 `file-exists` / `edge-exists` 三档即可表达。
 *
 * ## ★★ 本证最核心的一条判据：**证伪"转录现状"**
 * 期望若是**照抄现状** ⇒ 它**恒真**（改坏了也不红）⇒ 是假项。
 * 判据：**不碰 DSL**、只把**受约束文件的真实实现改掉** ⇒ `consistency_check` **必须**报
 * `expectation_failures > 0`、且 `diff_blocks` **真的产出该块**；而**期望文本逐字不变**。
 *   · 偏离 A（`file-exists`）：把夹具里 `src/domain/chain_wiring.ts` 改名 ⇒ 该档必红。
 *   · 偏离 B（`edge-exists`）：把夹具里 `contract_page.ts` 对 chain_wiring 的 import **摘掉**
 *     并**重扫实际**（`syncFile`，即 `import_project` 刷新"实际"那一跳，**不碰设计**) ⇒ 该边必红。
 *     ★ 为什么必须重扫：`edge-exists` 的依赖事实**只能取自索引**（`fileFacts.deps`）——
 *       源文件比索引新时判据会（正确地）转 `unsupported`（"判不了"），那就证不出"必红"。
 *       重扫 = 让索引反映这次实现改动（判据没被绕开，是它设计要求的保鲜动作）。
 *
 * ## ★★ 走工具层（新纪律）
 * 写入用 `edit_dsl` 的 handler（`editDslHandler`），判定用 `consistency_check` 的 handler
 * （`consistencyHandler`）—— **不是**直调 `updateFeature` / `judgeExpectations`。
 * 并自证"确实走了工具层"：塞一个未知键 ⇒ 被 `checkOpSpec` 点名「不被认的键」，且**已知键那段含 `expectations`**。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **传输/schema 层 [未核]**：本证直接 import handler，**没有**经 MCP server 的 `tools/list` JSON Schema。
 *   · **daemon 转发分支 [未核]**：本证不起 daemon。
 *   · **真 `run82` 未写**：本证**只读** `run82` 的设计侧来取 `acceptance` 原文；全部写入都在夹具 feature。
 *   · **六种 kind 只用了 2 种**（`file-exists` / `edge-exists`）：其余四种本节点没用到，本证**不声称**覆盖。
 *
 * ## 用法
 *   node certs/t335-expectation-from-acceptance-cert.mjs
 * ★ 夹具住 `certs/.work/tmp335`；`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓的 `.agent-io/`**。
 * ★ 本证**只读** `dist/`：改了 `src/` 请先 `npm run build`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.work/tmp335');
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

const { saveDSL, getDSL, getFeaturesDir } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler, consistencyHandler } = await import('../dist/src/application/design/handlers.js');
const { parseDataBlock } = await import('../dist/src/application/plumbing.js');
const dbmod = await import('../dist/src/infrastructure/index/db.js');
const getProjectCacheDb = dbmod.getProjectCacheDb;
const { syncFile } = await import('../dist/src/infrastructure/index/symbols.js');

const FEAT = 't335';

// ════════════════════════════════════════════════════════════════════
// 0. 取【设计侧】原文（★ 读数纪律：先读设计侧，别读 live —— run82 的 live 快照里 decision 节点 = 0）
// ════════════════════════════════════════════════════════════════════
console.log('════ 0. 设计侧 acceptance 原文（.agent-io/features/run82.json 的决策卡）════');
/** 节点 258（`geometry.nodes[258]`，label `rename_file.ts · 14 APIs`）的 acceptance */
const ACCEPTANCE_258 =
  '目录 ⇒ `ok:false` + `blocked` + ★ **整体未落盘**；回归：对 `src/domain/chain_wiring.ts` 改名 `dry-run` ' +
  '⇒ **仍报出真实引用**（`contract_page.ts` / `first_hop_args.ts`）。';
{
  const design = JSON.parse(fs.readFileSync(path.join(REPO, '.agent-io/features/run82.json'), 'utf-8'));
  const n = design.geometry.nodes[258];
  const live = JSON.parse(fs.readFileSync(path.join(REPO, '.agent-io/live/run82.dsl.json'), 'utf-8'));
  const liveDecisions = (live.geometry?.nodes ?? []).filter((x) => x.decision).length;
  dump(`run82 设计侧节点 #258（${n.id}）的 decision.acceptance`, n.decision.acceptance);
  console.log(`   ★ live 快照里带 decision 的节点数 = ${liveDecisions}（设计意图按构造不在 live ⇒ 只能在设计侧读）`);
  chk(n.decision.acceptance === ACCEPTANCE_258 && liveDecisions === 0,
    '0 acceptance 原文逐字取到，且确认 live 侧 0 个 decision（读对了地方）',
    n.decision.acceptance === ACCEPTANCE_258 ? '原文逐字一致' : '★ 原文与预期不符');
}

// ════════════════════════════════════════════════════════════════════
// 1. 夹具：代码根（三个受约束文件的**副本**）+ 索引（syncFile，即"刷新实际"那一跳）+ feature DSL
// ════════════════════════════════════════════════════════════════════
const CODE = path.join(TMP, 'code');
const P_CHAIN = 'src/domain/chain_wiring.ts';
const P_CONTRACT = 'src/application/meta/explore/contract_page.ts';
const P_FIRST = 'src/application/meta/explore/first_hop_args.ts';
const rels = [P_CHAIN, P_CONTRACT, P_FIRST];
for (const rel of rels) {
  const dst = path.join(CODE, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO, rel), dst); // ★ 副本，不是真仓源码
}
const db = getProjectCacheDb(CODE);
const syncAll = async () => {
  for (const rel of [P_CHAIN, P_CONTRACT, P_FIRST]) {
    await syncFile(db, CODE, path.join(CODE, rel));
  }
};
await syncAll();

/** 译出的 expectations —— ★ 从 acceptance 的**意图**读出目标形状，不是照抄现状 */
const EXPECTATIONS = [
  {
    kind: 'file-exists',
    path: P_CHAIN,
    why: 'T164 验收把 chain_wiring.ts 当"被改名的目标" ⇒ 它必须真实存在（否则"仍报出真实引用"无从谈起）',
  },
  {
    kind: 'edge-exists',
    from: P_CONTRACT,
    to: P_CHAIN,
    why: 'T164 验收点名 contract_page.ts 是 chain_wiring.ts 的**真实引用方** ⇒ 该依赖必须成立',
  },
  {
    kind: 'edge-exists',
    from: P_FIRST,
    to: P_CHAIN,
    why: 'T164 验收点名 first_hop_args.ts 是 chain_wiring.ts 的**真实引用方** ⇒ 该依赖必须成立',
  },
];

const HOST_ID = 'file_src_application_refactor_rename_rename_file_ts';
saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  // ★ source_root 指到夹具代码根 ⇒ 判定器与对账都读夹具，不读真仓
  source_root: CODE,
  geometry: {
    layout: 'free',
    width: 800,
    height: 600,
    nodes: [{ id: HOST_ID, type: 'file', label: 'rename_file.ts', description: 'src/application/refactor/rename/rename_file.ts' }],
    edges: [],
  },
  semantic: {
    files: [
      { id: 'file_chain', path: P_CHAIN, responsibility: 'T335 夹具：被引用方' },
      { id: 'file_contract', path: P_CONTRACT, responsibility: 'T335 夹具：引用方一' },
      { id: 'file_first', path: P_FIRST, responsibility: 'T335 夹具：引用方二' },
    ],
  },
});

// ════════════════════════════════════════════════════════════════════
// 2. ★ 经【工具层】写入 acceptance + expectations（edit_dsl → editDslHandler）
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 2. 经工具层 edit_dsl 写 decision（acceptance 原文 + 译出的 expectations）════');
const callEditDsl = (data) =>
  editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: `经 edit_dsl 给节点 ${HOST_ID} 写决策卡：acceptance 取自 run82 的设计侧原文，expectations 是其可机判子集（T335 走工具层）`,
    operations: [{ type: 'decision', op: 'update', id: HOST_ID, data }],
  });
const SCOPE = `files:${[P_CHAIN, P_CONTRACT, P_FIRST].join(',')}`;
{
  const res = await callEditDsl({
    summary: 'T164：rename_files 传【目录】一律拒（此前假绿灯）',
    acceptance: ACCEPTANCE_258,
    expectations: EXPECTATIONS,
  });
  chk(res.isError !== true && /expectation|决策|decision|已更新|updated|✅/i.test(res.text),
    '② expectations 经工具层写入**成功**（edit_dsl handler 未拒）',
    res.isError ? `★ 被拒：${res.text.split('\n').slice(-1)[0]}` : `回执首行 = ${res.text.split('\n')[0]}`);
}

/** ★ 期望文本的**逐字快照**（改前）—— 后面每一处偏离之后都要拿它对比 */
const designFile = path.join(getFeaturesDir(), `${FEAT}.json`);
const readDecision = () => {
  const raw = JSON.parse(fs.readFileSync(designFile, 'utf-8'));
  const node = (raw.geometry?.nodes ?? []).find((n) => n.id === HOST_ID);
  return node?.decision ?? {};
};
const EXP_BEFORE = JSON.stringify(readDecision().expectations);
const ACC_BEFORE = JSON.stringify(readDecision().acceptance);
chk(
  readDecision().expectations?.length === 3 && readDecision().acceptance === ACCEPTANCE_258,
  '②-b 落盘【设计侧文件】原文里，3 条 expectations + acceptance 原文都在（不只在内存读侧）',
  `expectations 条数=${readDecision().expectations?.length} · acceptance 前 24 字=${String(readDecision().acceptance).slice(0, 24)}…`,
);
dump('设计侧文件原文 · decision.expectations（改前）', EXP_BEFORE);

// ════════════════════════════════════════════════════════════════════
// 3. 判定：经【工具层】consistency_check（consistencyHandler）
// ════════════════════════════════════════════════════════════════════
const runCC = async () => {
  const res = await consistencyHandler({ feature: FEAT, scope: SCOPE });
  if (res.isError) throw new Error(`consistency_check 抛错：${res.text}`);
  return { text: res.text, data: parseDataBlock(res.text) };
};

console.log('\n════ 3-① 基线：实现**满足**意图 ⇒ failed 必须为 0、无块 ════');
let errs = [];
{
  const { text, data } = await runCC();
  const er = data.expectation_results;
  dump('consistency_check 回执（节选：验收执行 + 差异块）', text.split('\n').filter((l) => /检查项|差异块|块（|\[files:/.test(l)).join('\n') || text.slice(0, 400));
  errs = er.items.filter((x) => x.verdict === 'fail');
  chk(er.checked === 3 && er.failed === 0 && er.unsupported === 0,
    '③-① 基线 3 条全判且全过（failed=0 · unsupported=0）—— ★ 判的是**夹具代码**，不是"没判"',
    `checked=${er.checked} passed=${er.passed} failed=${er.failed} unsupported=${er.unsupported}`);
  chk((data.blocks ?? []).length === 0 && (data.clean_files ?? []).length === 3,
    '③-① b 基线**无差异块**、3 个文件全在 clean_files（"好消息"而不是"没跑"）',
    `blocks=${data.blocks?.length} clean_files=${JSON.stringify(data.clean_files)}`);
}

console.log('\n════ 3-② 偏离 A（file-exists）：把夹具里 chain_wiring.ts **改名** ⇒ 必红 + 必出块 ════');
let regionA = '';
{
  fs.renameSync(path.join(CODE, P_CHAIN), path.join(CODE, `${P_CHAIN}.bak`));
  const { text, data } = await runCC();
  const er = data.expectation_results;
  const fails = er.items.filter((x) => x.verdict === 'fail');
  regionA = data.blocks?.[0]?.region ?? '';
  dump('consistency_check 回执（节选）', text.split('\n').filter((l) => /检查项|不满足|❌ \[|差异块|块（|\[files:/.test(l)).join('\n'));
  chk(er.failed > 0, '③-② expectation_failures > 0（file-exists 档报红）', `failed=${er.failed}`);
  chk(fails.some((x) => x.expectation.kind === 'file-exists'), '③-② b 报红的正是 file-exists 那条', fails.map((x) => x.expectation.kind).join(','));
  chk((data.blocks ?? []).length === 1 && /^files:/.test(regionA) && regionA.includes('chain_wiring.ts'),
    '③-② c diff_blocks **真的产出了该块**（贴块名）',
    `block region = ${regionA} · counts=${JSON.stringify(data.blocks?.[0]?.counts)}`);
  fs.renameSync(path.join(CODE, `${P_CHAIN}.bak`), path.join(CODE, P_CHAIN)); // 复位
}

console.log('\n════ 3-③ 偏离 B（edge-exists）：摘掉 contract_page.ts 对 chain_wiring 的 import + 重扫实际 ⇒ 必红 ════');
{
  const f = path.join(CODE, P_CONTRACT);
  const before = fs.readFileSync(f, 'utf-8');
  const line = `import { CHAIN_EDGES, chainExprOf, evidenceLabel } from '../../../domain/chain_wiring.js';`;
  fs.writeFileSync(f, before.replace(line, `// T335 证伪：把这条 import 摘掉（实现偏离设计意图）`), 'utf-8');
  await syncFile(db, CODE, f); // ★ 重扫"实际"（= import_project 那一跳，**不碰设计 DSL**）
  const { text, data } = await runCC();
  const er = data.expectation_results;
  const fails = er.items.filter((x) => x.verdict === 'fail');
  regionA = data.blocks?.[0]?.region ?? regionA;
  dump('consistency_check 回执（节选）', text.split('\n').filter((l) => /检查项|不满足|❌ \[|差异块|块（|\[files:/.test(l)).join('\n'));
  chk(er.failed > 0 && er.unsupported === 0,
    '③-③ expectation_failures > 0 且 unsupported=0（重扫后是真红，**不是**"判不了"）',
    `failed=${er.failed} unsupported=${er.unsupported}`);
  chk(fails.some((x) => x.expectation.kind === 'edge-exists' && x.expectation.from === P_CONTRACT), '③-③ b 报红的正是 contract_page → chain_wiring 那条 edge-exists', fails.map((x) => `${x.expectation.kind}:${x.expectation.from ?? x.expectation.path}`).join(','));
  chk((data.blocks ?? []).length === 1 && regionA.includes('contract_page.ts'),
    '③-③ c diff_blocks 产出该块（贴块名）', `block region = ${regionA}`);
  fs.writeFileSync(f, before, 'utf-8'); // 复位
  await syncFile(db, CODE, f);
}

// ════════════════════════════════════════════════════════════════════
// 4. ★★★ 核心：期望文本【逐字不变】（改前 == 改后）
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 4. 期望文本未变（改前 / 改后**逐字对比**）════');
{
  const EXP_AFTER = JSON.stringify(readDecision().expectations);
  const ACC_AFTER = JSON.stringify(readDecision().acceptance);
  dump('设计侧文件原文 · decision.expectations（改后）', EXP_AFTER);
  chk(EXP_AFTER === EXP_BEFORE, '4-a expectations **逐字未变**（改动只落在实现侧，DSL 一个字节没动）', EXP_AFTER === EXP_BEFORE ? '两串相等' : '★ 变了！');
  chk(ACC_AFTER === ACC_BEFORE, '4-b acceptance 原文也逐字未变', ACC_AFTER === ACC_BEFORE ? '两串相等' : '★ 变了！');
}

// ════════════════════════════════════════════════════════════════════
// 5. 自证"确实走了工具层"：未知键被 checkOpSpec 点名，且已知键那段含 expectations
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 5. 自证走的是工具层（未知键被 checkOpSpec 点名，已知键含 expectations）════');
{
  const res = await callEditDsl({ summary: 'x', definitely_bogus_key: 1 });
  dump('拒绝原文 · 未知键', res.text);
  const unknownSeg = res.text.split('\n').find((l) => /不被认的键/.test(l)) ?? '';
  const knownSeg = res.text.split('\n').find((l) => /已知键/.test(l)) ?? '';
  chk(
    res.isError === true && /definitely_bogus_key/.test(unknownSeg) && !/expectations/.test(unknownSeg) && /expectations/.test(knownSeg),
    '5 未知键被点名，已知键那段含 expectations（⇒ 本证确实在 checkOpSpec 之后，走的是工具层）',
    `未知键段=${JSON.stringify(unknownSeg)} · 已知键段=${JSON.stringify(knownSeg)}`,
  );
}

// ★★ 清理（只有 1 次删除操作；Windows EBUSY 时响亮报告，不算判红）
try {
  try { dbmod.closeAllProjectCacheDbs?.(); } catch { /* ignore */ }
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主删除闸/句柄占用，**不是本证的判据**：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp335 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
