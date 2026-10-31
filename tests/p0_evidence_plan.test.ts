/**
 * P0 · **增量选量真的走 `evidenceFreshness`**（`valid`/`stale`/`unverifiable` ⇒ skip/rerun/unknown）。
 *
 * ★★★ 2026-10-31：本文件从 `certs/t366-evidence-plan-cert.mjs` **整张迁来**。
 *   它此前是 `npm run verify` 的**第 9 道门**（`scripts/verify.mjs` 的「证据选量」）。
 *   `certs/` 要整目录删 ⇒ 迁进 `tests/`，由**「测试」门**统一收走（0.9 一处权威）。
 *
 * ## 它挡的事故（从 verify.mjs 那道门的 `why` 搬来，别丢）
 *   · 「**建了没接**」再发生一次 —— `evidenceFreshness`（`src/domain/task_schema.ts`）2026-10-21 就能判
 *     `valid` / `stale` / `unverifiable`，但**外部调用者 0 个**（`grep -rn --include=*.ts evidenceFreshness src/`
 *     ⇒ 0 行）⇒ 指纹只是数据、判断力一天没跑过：函数全绿、没人调，而代码读起来完全正常。
 *   · 现在它经 `planEvidenceRerun` 接在 `scripts/verify-changed.mjs` 第 ②.5 步：
 *     "命中了的契约，如果它的证据还作数，就不重判"。
 *   · 原证（verify 门时期）的消融读数（改 `dist` 一行再还原）：
 *     删掉 `planEvidenceRerun` 里 `postExpectations(...).length === 0` 那一支 ⇒ **⑤ 红**；
 *     把 `verify-changed` 里判定器的实参换回 `expHits` ⇒ **⑧g 红**（`judged ∩ skip` 那格只抓输出，
 *     抓不到"算了没应用"）。
 *
 * ## 为什么 ⑧ 必须 spawn 子进程（而不是在本进程里调函数）
 *   `scripts/verify-changed.mjs` 是**接线对象本身** —— 要证的是「这个 CLI 真的调了 `planEvidenceRerun`
 *   并把结果用在判定入参上」。它是个 ESM 顶层直跑的脚本（不是导出的函数），且它 `import('../dist/…')`：
 *   ⇒ 只能 spawn 它读它自己的 `--json` 回执。★ 前提：`dist/` 已 build（与「MCP 工具签名」「设计册判据」
 *   两道门同一前提）；缺 `dist` 时 ⑧ 会**响亮失败**并说明原因，不会静默当绿（0.12）。
 *   ★ 一律 `--no-run`（只算集合）：本文件不该顺手跑别的证。
 *
 * ## 消融（★ 本文件必须能红 —— 2026-10-31 迁移时实测，**两个方向各一次**）
 *   ① **改 `dist`**：`dist/src/application/design/dsl_ops/task_ops.js` 里 `planEvidenceRerun` 的
 *      `return { rerun, skip, unknown };` ⇒ `return undefined;`
 *      **红读数**：`用例 7/8` —— ⑧a 红（`evidence_plan=null` ⇒ CLI 那一侧根本没接上）· exit 1。
 *      还原 dist ⇒ **用例 8/8 全绿** · exit 0。
 *      （⑧ 走的就是 `dist`：⑧ 的对象是 spawn 出来的 `scripts/verify-changed.mjs`，它 `import('../dist/…')`。）
 *   ② **改 `src`**：`src/…/task_ops.ts` 的 `} else if (postExpectations(c.expectations).length === 0) {`
 *      ⇒ `} else if (false) {`（L1 卡不再排除复用）
 *      **红读数**：`用例 7/8` —— ⑤ 红（L1 卡 freshness=valid、bucket=skip）· exit 1。
 *      还原 src 后 `git diff` 为空 ⇒ **用例 8/8 全绿** · exit 0。
 *   ★ 两边都要：①-⑦ 读 `src`，⑧ 读 `dist` ⇒ 只做一边会漏掉另一半的装饰性断言。

 * ## 诚实清单（原证声明，这里照抄）
 *   · ⑧d（`unknown` 与重判明细里 unverifiable 的条数一致）**今天是空断言**（真仓这些命中里没有
 *     unverifiable）—— 如实标注，别把它当"验过了"；`unverifiable ⇒ rerun` 的真断言在 ③ / ⑦。
 *   · ⑧f 是**观察行不计分**（`t.diagnostic`）：真仓上"今天能不能省一条"是**数据**读数，不是机制判据。
 *   · ⑧g 是**静态读法**（判定器实参必须是 `hitsToJudge`）：`--no-run` 测不到"算了没应用"。
 *   · ①②③④⑤⑥⑦ 用的是一条**故意不存在**的路径做夹具（`indexStaleFor` 对不存在的文件直接跳过
 *     ⇒ 不依赖 `cache.db`，可复现）；★ 索引陈旧那一支**本文件覆盖不到**（[未核]，要造一个
 *     "cache.db 旧但磁盘新"的夹具）。
 *   · 本文件**不写仓内任何文件**：只读源码 / `dist` / 真册（`--no-run` 下 `verify-changed` 不落盘）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fingerprintEvidence, planEvidenceRerun } from '../src/application/design/dsl_ops/task_ops.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'scripts/verify-changed.mjs');

type AnyRec = Record<string, any>;

// ════════════════════════════════════════════════════════════════════
// 夹具：一条**故意不存在**的路径 —— `indexStaleFor` 遇到不存在的文件会 `continue`
// （它管的是"索引与源码是否一致"，文件都没有就没有"不一致"）⇒ 夹具不依赖 cache.db，可复现。
// ════════════════════════════════════════════════════════════════════
const ABSENT = 'src/__p0_evidence_absent__.ts';
const POST_EXP: AnyRec[] = [
  { kind: 'symbol-exists', path: ABSENT, symbol: 'nothingHereP0', why: '夹具：只为一件事 —— 让 expectationPaths 给出一个确定的路径' },
];
const PRE_EXP: AnyRec[] = [
  { kind: 'edge-absent', from: ABSENT, to: ABSENT, why: '夹具：前态判据 ⇒ 这张卡没有后态判据（L1）' },
];

/** 现算指纹（**走写端同一把尺** `fingerprintEvidence`，不在这里另算覆盖集） */
const curOf = (exp: AnyRec[], nodeId: string): AnyRec =>
  fingerprintEvidence(exp as any, REPO, nodeId, { kind: 'expectations' });

/** 用现算结果造一条"必然 valid"的证据 */
function evidenceFor(exp: AnyRec[], nodeId: string, patch: AnyRec = {}): AnyRec {
  const cur = curOf(exp, nodeId);
  return {
    kind: 'expectations',
    at: '2026-10-23T00:00:00.000Z',
    verdict: 'pass',
    fingerprint: { what: `judgeExpectations:${nodeId}`, input: cur.input, code: cur.code, covers: cur.covers, ...patch },
  };
}
const one = (exp: AnyRec[], rec: AnyRec, id = 'p0-ev-node') =>
  planEvidenceRerun(REPO, [{ id: `p0-ev-card-${id}`, feature: 'p0evidence', node_id: id, expectations: exp, evidence: [rec] }] as any);
const itemOf = (plan: AnyRec): AnyRec | null => [...plan.skip, ...plan.rerun, ...plan.unknown][0] ?? null;

// ════════════════════════════════════════════════════════════════════
test('① 代码/判据/覆盖集三样都相同 ⇒ skip（不重跑）', () => {
  const plan = one(POST_EXP, evidenceFor(POST_EXP, 'p0-ev-node')) as AnyRec;
  const it = itemOf(plan);
  assert.ok(
    !!it && it.freshness === 'valid' && it.bucket === 'skip' && plan.rerun.length === 0 && plan.skip.length === 1,
    `代码/判据/覆盖集三样都相同 ⇒ **skip**（freshness=${it?.freshness} bucket=${it?.bucket} skip=${plan.skip.length} rerun=${plan.rerun.length} covers=${JSON.stringify(it?.covers)}）`,
  );
});

test('② ★ 反证：同一条证据、只把 fingerprint.code 改成 40 个 0 ⇒ 从 skip 变成 rerun', () => {
  const tampered = evidenceFor(POST_EXP, 'p0-ev-node', { code: '0'.repeat(40) });
  const plan = one(POST_EXP, tampered) as AnyRec;
  const it = itemOf(plan);
  assert.ok(
    !!it && it.freshness === 'stale' && it.bucket === 'rerun' && plan.skip.length === 0 && plan.rerun.length === 1,
    `反证：改指纹 ⇒ 选量必须跟着变（不是恒真）（freshness=${it?.freshness} bucket=${it?.bucket} skip=${plan.skip.length} rerun=${plan.rerun.length}）`,
  );
});

test('③ 没有代码指纹（历史证据）⇒ unknown 且进 rerun（★ 不许当"有效"用）', () => {
  const rec = evidenceFor(POST_EXP, 'p0-ev-node', { code: undefined });
  const plan = one(POST_EXP, rec) as AnyRec;
  const it = itemOf(plan);
  assert.ok(
    !!it && it.freshness === 'unverifiable' && it.bucket === 'unknown' && plan.rerun.length === 1 && plan.skip.length === 0,
    `没指纹 ⇒ unknown + rerun（freshness=${it?.freshness} bucket=${it?.bucket} rerun=${plan.rerun.length} unknown=${plan.unknown.length} why=${it?.why}）`,
  );
});

test('④ 记录里的覆盖集与此刻不是同一批文件 ⇒ stale（不是"验了同一件事"）', () => {
  const base = evidenceFor(POST_EXP, 'p0-ev-node');
  const rec = { ...base, fingerprint: { ...base.fingerprint, covers: [...base.fingerprint.covers, 'src/__p0_evidence_other__.ts'] } };
  const it = itemOf(one(POST_EXP, rec) as AnyRec);
  assert.ok(it?.freshness === 'stale' && it?.bucket === 'rerun',
    `覆盖集变了 ⇒ stale（freshness=${it?.freshness} covers=${JSON.stringify(it?.covers)}）`);
});

test('⑤ L1 卡（没有后态判据）⇒ 指纹一字不差也不复用', () => {
  const plan = one(PRE_EXP, evidenceFor(PRE_EXP, 'p0-ev-l1'), 'p0-ev-l1') as AnyRec;
  const it = itemOf(plan);
  assert.ok(
    !!it && it.freshness === 'valid' && it.bucket === 'rerun' && plan.skip.length === 0,
    `L1 卡 ⇒ 不复用（收口只判过"建构完整"）（freshness=${it?.freshness} bucket=${it?.bucket} why=${it?.why}）`,
  );
});

test('⑥ 卡上没有证据 ⇒ 一行都不造（既不"有效"也不"该重跑"）', () => {
  const plan = planEvidenceRerun(REPO, [
    { id: 'p0-ev-noevidence', feature: 'p0evidence', node_id: 'p0-ev-noevidence', expectations: POST_EXP, evidence: [] },
  ] as any) as AnyRec;
  assert.ok(
    plan.skip.length === 0 && plan.rerun.length === 0 && plan.unknown.length === 0,
    `没证据不造行（skip=${plan.skip.length} rerun=${plan.rerun.length} unknown=${plan.unknown.length}）`,
  );
});

test('⑦ unknown 是 rerun 的子集（一个"不知道"桶，不是第四个"通过"桶）', () => {
  const plan = planEvidenceRerun(REPO, [
    { id: 'c1', feature: 'p0evidence', node_id: 'n1', expectations: POST_EXP, evidence: [evidenceFor(POST_EXP, 'n1', { code: undefined })] },
    { id: 'c2', feature: 'p0evidence', node_id: 'n2', expectations: POST_EXP, evidence: [evidenceFor(POST_EXP, 'n2')] },
  ] as any) as AnyRec;
  const rerunIds = new Set(plan.rerun.map((i: AnyRec) => i.node_id));
  assert.ok(
    plan.unknown.length === 1 && plan.unknown.every((u: AnyRec) => rerunIds.has(u.node_id)) && plan.skip.length === 1,
    `unknown ⊆ rerun（rerun=${JSON.stringify(plan.rerun.map((i: AnyRec) => i.node_id))} skip=${JSON.stringify(plan.skip.map((i: AnyRec) => i.node_id))} unknown=${JSON.stringify(plan.unknown.map((i: AnyRec) => i.node_id))}）`,
  );
});

// ════════════════════════════════════════════════════════════════════
// ⑧ 接线：`scripts/verify-changed.mjs` 真的用了它（不是"库里有、没人调"）
// ════════════════════════════════════════════════════════════════════
function runTool(extra: string[] = [], files: string[] = ['scripts/hook-task-gate.mjs']): AnyRec | null {
  let out = '';
  try {
    out = execFileSync('node', [TOOL, '--json', '--no-run', ...extra, ...files], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e as any).stdout ?? '') + String((e as any).stderr ?? '');
  }
  try {
    return JSON.parse(out.trim().split('\n').filter(Boolean).pop() as string) as AnyRec;
  } catch {
    return null;
  }
}

test('⑧ 接线：verify-changed 真的调了 planEvidenceRerun，且判定器只收未被复用的那些', (t) => {
  // ★ 前提显式检查：⑧ 的对象是对 `dist` 跑的 CLI ⇒ 没 build 必须**响亮失败**（0.12：失败 ≠ 没有）
  const distLib = path.join(REPO, 'dist/src/application/design/dsl_ops/task_ops.js');
  assert.ok(
    fs.existsSync(distLib),
    `⑧ 前置：${distLib} 不存在 ⇒ 先 npm run build（本断言的对象是"对 dist 跑的 CLI"，与「MCP 工具签名」「设计册判据」两道门同一前提）`,
  );

  const w = runTool();
  assert.ok(w, '⑧ 前置：`verify-changed --json --no-run` 必须给出可解析的 JSON 回执（拿不到 = 跑不起来，不许当绿）');

  const skipIds = new Set(((w!.evidence_plan?.skip ?? []) as AnyRec[]).map((i) => i.node_id));
  const judged = (w!.judged ?? []) as string[];
  const nExp = ((w!.expectations ?? []) as AnyRec[]).length;

  assert.ok(
    w!.evidence_plan !== null && w!.evidence_plan !== undefined,
    `⑧a 输出了 evidence_plan（= 它真的调了 planEvidenceRerun，不是只有库里有函数）（evidence_plan=${JSON.stringify(w!.evidence_plan && { skipped: w!.evidence_plan.skipped, rerun: w!.evidence_plan.rerun, unknown: w!.evidence_plan.unknown })}）`,
  );
  assert.ok(
    nExp > 0 && judged.every((id) => !skipIds.has(id)) && judged.length + skipIds.size === nExp,
    `⑧b **分区**：judged 里没有一条被复用；judged.length + skipped === 命中契约数（命中契约=${nExp} judged=${judged.length} skipped=${skipIds.size}）`,
  );
  assert.ok(
    ((w!.evidence_plan?.skip ?? []) as AnyRec[]).every((i) => i.freshness === 'valid'),
    `⑧c 只有 valid 才可能进 skip（stale / unverifiable 一条都没有）（skip=${JSON.stringify(((w!.evidence_plan?.skip ?? []) as AnyRec[]).map((i) => [i.node_id, i.freshness]))}）`,
  );
  // ★ JSON 里 `unknown` 是**计数**、`rerun_items` 是明细 ⇒ 比的是"每一个 unverifiable 都出现在重判明细里"
  //   ★★ 诚实标注：今天真仓这些命中里没有 unverifiable ⇒ 这一条是**空断言**（两侧都是 0）。
  const rerunItems = (w!.evidence_plan?.rerun_items ?? []) as AnyRec[];
  const unkInRerun = rerunItems.filter((i) => i.freshness === 'unverifiable');
  assert.equal(
    unkInRerun.length,
    w!.evidence_plan?.unknown ?? -1,
    `⑧d 接线里 unverifiable 也进了重判集（unknown=${w!.evidence_plan?.unknown} 重判明细里的 unverifiable=${unkInRerun.length}）★ 今天是空断言`,
  );

  const off = runTool(['--no-reuse']);
  assert.ok(
    off?.evidence_plan === null && ((off?.judged ?? []) as string[]).length === ((off?.expectations ?? []) as AnyRec[]).length,
    `⑧e **摘掉接线 ⇒ 旧行为回来**：--no-reuse ⇒ evidence_plan=null 且全部命中都进 judged（evidence_plan=${JSON.stringify(off?.evidence_plan)} judged=${((off?.judged ?? []) as string[]).length} / 命中=${((off?.expectations ?? []) as AnyRec[]).length}）`,
  );

  // ── ⑧f **观察行（不计分）**：今天真仓上到底有没有"可复用"的命中 ──
  const probe = ['scripts/hook-task-gate.mjs', 'scripts/install_mcp.mjs', 'scripts/verify-changed.mjs'];
  const seen: string[] = [];
  for (const f of probe) {
    const r = runTool([], [f]);
    seen.push(`${f}⇒skip=${r?.evidence_plan?.skipped ?? '?'}/命中=${((r?.expectations ?? []) as AnyRec[]).length}`);
  }
  t.diagnostic(`⑧f 观察（不计分）：${seen.join(' · ')}`);

  // ── ⑧g **静态读法**：判定器的入参必须是 `hitsToJudge`（不是 `expHits`）──
  //   为什么只能静态读：`--no-run` 下判定器不跑 ⇒ "算了但没应用"在输出里看不出来
  //   （`judged` 字段用对、判定实参用错也能全绿）。代价是它读源码文本（★ 只钉一个具体表达式）。
  const src = fs.readFileSync(TOOL, 'utf8');
  const wired = /judge\(ROOT,\s*hitsToJudge\.map\(/.test(src);
  const unwired = /judge\(ROOT,\s*expHits\.map\(/.test(src);
  assert.ok(wired && !unwired, `⑧g **静态**：判定器实参是 hitsToJudge（不是 expHits）—— 补"算了没应用"那一格（hitsToJudge=${wired} expHits=${unwired}）`);
});
