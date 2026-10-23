#!/usr/bin/env node
/**
 * ★★★ cert T366 —— **增量选量真的走 `evidenceFreshness`**（2026-10-23）。
 *
 * touches: src/application/design/dsl_ops/task_ops.ts, scripts/verify-changed.mjs
 *
 * ## 它挡的那件事
 * `evidenceFreshness`（`src/domain/task_schema.ts:483`）2026-10-21 就能判 `valid` / `stale` /
 * `unverifiable`，但**外部调用者 0 个**（`grep -rn --include=*.ts evidenceFreshness src/ | grep -v task_schema.ts`
 * ⇒ 0 行）⇒ 指纹只是数据、判断力一天没跑过。本证钉住"它现在真的在选量"。
 *
 * ## 判据（每条都对 `dist` 亲手跑，读数见 stdout）
 *   ① **valid ⇒ 不重跑**：`planEvidenceRerun` 把这条证据放 `skip`（且不进 `rerun`）；
 *   ② ★★ **反证（不是恒真）**：把**同一条证据**的 `fingerprint.code` 改成 40 个 0（= 伪造"代码动过"）
 *      ⇒ 立刻从 `skip` 变 `rerun`。一条"永远 skip"的实现过不了这条；
 *   ③ **没指纹 ⇒ `unknown` 且必须重跑**（卡上写死的判据：历史证据不许冒充通过）；
 *   ④ **覆盖集变了 ⇒ `stale`**（两边比的不是同一批文件，比出来的"相同"没有意义）；
 *   ⑤ **L1 卡（无后态判据）⇒ 不复用**：它的"完成"本来就不含判据结论；
 *   ⑥ **没证据的卡不造行**（`skip`/`rerun` 都不该凭空出现一条）；
 *   ⑦ **`unknown ⊆ rerun`**（集合关系，不是两套并列桶）；
 *   ⑧ ★★★ **接线**：`scripts/verify-changed.mjs` 的 `evidence_plan` 非 null、`judged` 与 `skip` 分区、
 *      `judged.length + skipped === 命中契约数`；`--no-reuse` ⇒ `evidence_plan === null`（旧行为可回来）。
 *      ★ 其中 ⑧d（`unknown` 与重判明细里 unverifiable 的条数一致）**今天是空断言**（真仓这些命中里没有
 *      unverifiable）—— 如实标注，别把它当"验过了"；`unverifiable ⇒ rerun` 的真断言在 ③ / ⑦。
 *      ★ ⑧f 是**观察行不计分**：真仓上"今天能不能省一条"是**数据**读数，不是机制判据。
 *      ★ ⑧g 是**静态读法**（判定器实参必须是 `hitsToJudge`）：补 `--no-run` 测不到的"算了没应用"。
 *
 * ## 消融（实测，见回报）
 *   · 把 `planEvidenceRerun` 里 `postExpectations(...).length === 0` 那一支删掉 ⇒ ⑤ 红；
 *   · 把 `indexStaleFor` 那一支删掉 ⇒ ① 仍绿（本证用的路径**不存在**，索引检查天然跳过）⇒
 *     ★ 如实声明：**索引陈旧那一支本证覆盖不到**（[未核]，要造一个"cache.db 旧但磁盘新"的夹具）；
 *   · 把 `verify-changed` 里判定器的实参换回 `expHits` ⇒ ⑧g 立刻红（消融实测）。
 *     ★ `--no-run` 下判定器不跑 ⇒ "plan 算了、judge 仍收全量"在输出里查不出来 ⇒ ⑧g 只能**静态读**
 *     那个表达式（读的是源码文本，如实标注）。
 *
 * ## 明明可以更狠但没做（诚实清单）
 *   · **没往真册子上写任何东西**：本证的 ①-⑦ 用**不存在的路径**造夹具（`indexStaleFor` 对不存在的文件
 *     直接跳过 ⇒ 不依赖 `cache.db`），⑧ 只读真仓；篡改真证据指纹那种反证是**人工跑过**的（见回报），
 *     没放进证里 —— 证不该改用户的设计册。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..').replace(/\\/g, '/');
const TOOL = path.join(REPO, 'scripts/verify-changed.mjs');

const DOM = pathToFileURL(path.join(REPO, 'dist/src/domain/task_schema.js')).href;
const TASK = pathToFileURL(path.join(REPO, 'dist/src/application/design/dsl_ops/task_ops.js')).href;

let D;
let T;
try {
  D = await import(DOM);
  T = await import(TASK);
} catch (e) {
  console.log(`✗ 前置：dist 读不到（${e.message}）⇒ 先 npm run build`);
  console.log('\n汇总：PASS=0 FAIL=1');
  process.exit(1);
}

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ════════════════════════════════════════════════════════════════════
// 夹具：一条**故意不存在**的路径 —— `indexStaleFor` 遇到不存在的文件会 `continue`
// （它管的是"索引与源码是否一致"，文件都没有就没有"不一致"）⇒ 夹具不依赖 cache.db，可复现。
// ════════════════════════════════════════════════════════════════════
const ABSENT = 'src/__t366_absent__.ts';
const POST_EXP = [
  { kind: 'symbol-exists', path: ABSENT, symbol: 'nothingHere366', why: '夹具：只为一件事 —— 让 expectationPaths 给出一个确定的路径' },
];
const PRE_EXP = [
  { kind: 'edge-absent', from: ABSENT, to: ABSENT, why: '夹具：前态判据 ⇒ 这张卡没有后态判据（L1）' },
];

/** 现算指纹（**走写端同一把尺** `fingerprintEvidence`，不在这里另算覆盖集） */
const curOf = (exp, nodeId) => T.fingerprintEvidence(exp, REPO, nodeId, { kind: 'expectations' });

/** 用现算结果造一条"必然 valid"的证据 */
function evidenceFor(exp, nodeId, patch = {}) {
  const cur = curOf(exp, nodeId);
  return {
    kind: 'expectations',
    at: '2026-10-23T00:00:00.000Z',
    verdict: 'pass',
    fingerprint: { what: `judgeExpectations:${nodeId}`, input: cur.input, code: cur.code, covers: cur.covers, ...patch },
  };
}
const one = (exp, rec, id = 't366-node') =>
  T.planEvidenceRerun(REPO, [{ id: `t366-card-${id}`, feature: 't366', node_id: id, expectations: exp, evidence: [rec] }]);
const itemOf = (plan) => [...plan.skip, ...plan.rerun, ...plan.unknown][0] ?? null;

// ── ① valid ⇒ skip ──
{
  const plan = one(POST_EXP, evidenceFor(POST_EXP, 't366-node'));
  const it = itemOf(plan);
  chk(
    !!it && it.freshness === 'valid' && it.bucket === 'skip' && plan.rerun.length === 0 && plan.skip.length === 1,
    '① 代码/判据/覆盖集三样都相同 ⇒ **skip（不重跑）**',
    `freshness=${it?.freshness} bucket=${it?.bucket} skip=${plan.skip.length} rerun=${plan.rerun.length} covers=${JSON.stringify(it?.covers)}`,
  );
}

// ── ② ★★ 反证：改指纹 ⇒ 选量必须跟着变 ──
{
  const tampered = evidenceFor(POST_EXP, 't366-node', { code: '0'.repeat(40) });
  const plan = one(POST_EXP, tampered);
  const it = itemOf(plan);
  chk(
    !!it && it.freshness === 'stale' && it.bucket === 'rerun' && plan.skip.length === 0 && plan.rerun.length === 1,
    '② **反证**：同一条证据、只把 `fingerprint.code` 改成 40 个 0 ⇒ 从 skip **变成** rerun（选量不是恒真）',
    `freshness=${it?.freshness} bucket=${it?.bucket} skip=${plan.skip.length} rerun=${plan.rerun.length}`,
  );
}

// ── ③ 没指纹 ⇒ unknown 且必须重跑 ──
{
  const rec = evidenceFor(POST_EXP, 't366-node', { code: undefined });
  const plan = one(POST_EXP, rec);
  const it = itemOf(plan);
  chk(
    !!it && it.freshness === 'unverifiable' && it.bucket === 'unknown' && plan.rerun.length === 1 && plan.skip.length === 0,
    '③ 没有代码指纹（历史证据）⇒ **unknown 且进 rerun**（★ 不许当"有效"用）',
    `freshness=${it?.freshness} bucket=${it?.bucket} rerun=${plan.rerun.length} unknown=${plan.unknown.length} why=${it?.why}`,
  );
}

// ── ④ 覆盖集变了 ⇒ stale ──
{
  const base = evidenceFor(POST_EXP, 't366-node');
  const rec = { ...base, fingerprint: { ...base.fingerprint, covers: [...base.fingerprint.covers, 'src/__t366_other__.ts'] } };
  const it = itemOf(one(POST_EXP, rec));
  chk(it?.freshness === 'stale' && it?.bucket === 'rerun', '④ 记录里的覆盖集与此刻不是同一批文件 ⇒ **stale**（不是"验了同一件事"）', `freshness=${it?.freshness} covers=${JSON.stringify(it?.covers)}`);
}

// ── ⑤ L1 卡（无后态判据）⇒ 不复用 ──
{
  const plan = one(PRE_EXP, evidenceFor(PRE_EXP, 't366-l1'), 't366-l1');
  const it = itemOf(plan);
  chk(
    !!it && it.freshness === 'valid' && it.bucket === 'rerun' && plan.skip.length === 0,
    '⑤ **L1 卡**（没有后态判据）⇒ 指纹一字不差也**不复用**（收口只判过"建构完整"）',
    `freshness=${it?.freshness} bucket=${it?.bucket} why=${it?.why}`,
  );
}

// ── ⑥ 没证据 ⇒ 不造行 ──
{
  const plan = T.planEvidenceRerun(REPO, [
    { id: 't366-noevidence', feature: 't366', node_id: 't366-noevidence', expectations: POST_EXP, evidence: [] },
  ]);
  chk(
    plan.skip.length === 0 && plan.rerun.length === 0 && plan.unknown.length === 0,
    '⑥ 卡上**没有证据** ⇒ 一行都不造（既不"有效"也不"该重跑"：没有可选的东西）',
    `skip=${plan.skip.length} rerun=${plan.rerun.length} unknown=${plan.unknown.length}`,
  );
}

// ── ⑦ unknown ⊆ rerun ──
{
  const plan = T.planEvidenceRerun(REPO, [
    { id: 'c1', feature: 't366', node_id: 'n1', expectations: POST_EXP, evidence: [evidenceFor(POST_EXP, 'n1', { code: undefined })] },
    { id: 'c2', feature: 't366', node_id: 'n2', expectations: POST_EXP, evidence: [evidenceFor(POST_EXP, 'n2')] },
  ]);
  const rerunIds = new Set(plan.rerun.map((i) => i.node_id));
  chk(
    plan.unknown.length === 1 && plan.unknown.every((u) => rerunIds.has(u.node_id)) && plan.skip.length === 1,
    '⑦ `unknown` 是 `rerun` 的**子集**（一个"不知道"桶，不是第四个"通过"桶）',
    `rerun=${JSON.stringify(plan.rerun.map((i) => i.node_id))} skip=${JSON.stringify(plan.skip.map((i) => i.node_id))} unknown=${JSON.stringify(plan.unknown.map((i) => i.node_id))}`,
  );
}

// ════════════════════════════════════════════════════════════════════
// ⑧ 接线：`scripts/verify-changed.mjs` 真的用了它（不是"库里有、没人调"）
//   ★ 一律 `--no-run`（只算集合）：本证不该顺手跑别的证。
// ════════════════════════════════════════════════════════════════════
function runTool(extra = [], files = ['scripts/hook-task-gate.mjs']) {
  let out = '';
  try {
    out = execFileSync('node', [TOOL, '--json', '--no-run', ...extra, ...files], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  try {
    return JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  } catch {
    return null;
  }
}
{
  const w = runTool();
  const skipIds = new Set((w?.evidence_plan?.skip ?? []).map((i) => i.node_id));
  const judged = w?.judged ?? [];
  const nExp = (w?.expectations ?? []).length;
  chk(
    w?.evidence_plan !== null && w?.evidence_plan !== undefined,
    '⑧a `verify-changed` 输出了 `evidence_plan`（= 它真的调了 `planEvidenceRerun`，不是只有库里有函数）',
    `evidence_plan=${JSON.stringify(w?.evidence_plan && { skipped: w.evidence_plan.skipped, rerun: w.evidence_plan.rerun, unknown: w.evidence_plan.unknown })}`,
  );
  chk(
    nExp > 0 && judged.every((id) => !skipIds.has(id)) && judged.length + skipIds.size === nExp,
    '⑧b **分区**：`judged` 里没有一条被复用；`judged.length + skipped === 命中契约数`',
    `命中契约=${nExp} judged=${judged.length} skipped=${skipIds.size}`,
  );
  chk(
    (w?.evidence_plan?.skip ?? []).every((i) => i.freshness === 'valid'),
    '⑧c 只有 `valid` 才可能进 `skip`（`stale` / `unverifiable` 一条都没有）',
    `skip=${JSON.stringify((w?.evidence_plan?.skip ?? []).map((i) => [i.node_id, i.freshness]))}`,
  );
  // ★ JSON 里 `unknown` 是**计数**、`rerun_items` 是明细 ⇒ 这里比的是"每一个 unverifiable 都出现在重判明细里"
  const rerunItems = w?.evidence_plan?.rerun_items ?? [];
  const unkInRerun = rerunItems.filter((i) => i.freshness === 'unverifiable');
  chk(
    unkInRerun.length === (w?.evidence_plan?.unknown ?? -1),
    '⑧d 接线里 `unverifiable` 也进了重判集（`unknown` 与 `rerun_items` 里 unverifiable 的条数一致）',
    `unknown=${w?.evidence_plan?.unknown} 重判明细里的 unverifiable=${unkInRerun.length}`,
  );
  const off = runTool(['--no-reuse']);
  chk(
    off?.evidence_plan === null && (off?.judged ?? []).length === (off?.expectations ?? []).length,
    '⑧e **摘掉接线 ⇒ 旧行为回来**：`--no-reuse` ⇒ `evidence_plan=null` 且全部命中都进 `judged`',
    `--no-reuse: evidence_plan=${JSON.stringify(off?.evidence_plan)} judged=${(off?.judged ?? []).length} / 命中=${(off?.expectations ?? []).length}`,
  );
  // ── ⑧f **观察行（不计分）**：今天真仓上到底有没有"可复用"的命中 ──
  //   ★ 不计分的理由：它读的是**册子里的证据**（数据），不是机制。数据一变，计分就成了假红。
  const probe = ['scripts/hook-task-gate.mjs', 'scripts/install_mcp.mjs', 'scripts/verify-changed.mjs'];
  const seen = [];
  for (const f of probe) {
    const r = runTool([], [f]);
    seen.push(`${f}⇒skip=${r?.evidence_plan?.skipped ?? '?'}/命中=${(r?.expectations ?? []).length}`);
  }
  console.log(`○ ⑧f 观察（不计分）：${seen.join(' · ')}`);

  // ── ⑧g **静态读法**：判定器的入参必须是 `hitsToJudge`（不是 `expHits`）──
  //   ★ 为什么只能静态读：`--no-run` 下判定器不跑 ⇒ "算了但没应用"（plan 算出来、judge 仍收全量）
  //     在输出里看不出来（`judged` 字段用对、判定实参用错也能全绿）。这条是**补那一格**，
  //     代价是它读源码文本（★ 只钉一个具体表达式，不是"通读一遍觉得没问题"）。
  const src = fs.readFileSync(TOOL, 'utf8');
  const wired = /judge\(ROOT,\s*hitsToJudge\.map\(/.test(src);
  const unwired = /judge\(ROOT,\s*expHits\.map\(/.test(src);
  chk(wired && !unwired, '⑧g **静态**：判定器实参是 `hitsToJudge`（不是 `expHits`）—— 补"算了没应用"那一格', `hitsToJudge=${wired} expHits=${unwired}`);
}

console.log(`\n汇总：PASS=${P} FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
