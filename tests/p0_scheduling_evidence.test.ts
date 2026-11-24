/**
 * ★ P0（DS-1 卡）· 证据帧的**纯判据**：版本对齐、范围、歧义、冲突、坏输入。
 *
 * ## 病（本卡要治的语义，逐条对应交接文档 §8）
 * 把"过期 / 缺失 / 冲突 / 不可判"当成"通过"，是这类诊断能力最常见的假绿形态：
 * · 旧 source hash 的 pass 被当成当前通过（A1）；
 * · 设计册 revision 对不上却静默融合（A2）；
 * · 同路径多候选取第一个（A4）；
 * · 读索引失败被当成空事实（B9）；
 * · 同一对象上 pass 与 fail 只留一边（C14）。
 *
 * ## 本证断言什么（每条都双向）
 * 1. `versionAlignment` 只在两侧都有版本且**相等**时给 `fresh`；缺任一 ⇒ `unavailable`（A1）。
 * 2. `observesAlignment` 只用证据自己声明的观察面；观察面为空 ⇒ `unavailable`，不许拿基线总版本顶替。
 * 3. 同路径不同写法 ⇒ `ambiguous` 且**两个候选都留着**；静默去重会让"取第一个"重新长出来（A4）。
 * 4. 冲突检测把 pass/fail 两边都留；`retired` 与 `pass` 也留（C14 / B6）。
 * 5. 形状坏（缺 scope / verdict 越界 / 无 source_ref）必须**抛**，不许退化成空证据。
 * 6. `buildEvidenceFrame` 用注入端口组装：读不到 ⇒ `unavailable` 缺口（B9），重复组装逐字相同（A5）。
 *
 * ## 消融（★ 本文件必须能红）
 * · 把 `versionAlignment` 的 `produced !== current` 分支改成 `fresh` ⇒ 用例「旧 source 版本」红。
 * · 把 `resolveSubjectCandidates` 改成"同一个 key 只留第一个" ⇒ 用例「同路径多候选」红。
 * · 把 `detectVerdictConflicts` 的 `passFail` 分支去掉 ⇒ 用例「pass 与 fail 两边都留」红。
 * · 把 `versionAlignment` 的 `!isStr(produced)` 早退删掉 ⇒ 用例「缺版本不是新鲜」红。
 *
 * ## 诚实清单
 * · 本文件不碰盘：所有帧都用注入端口构造，所以它证明的是**语义**，不是"真项目上读得对"
 *   （后者在 `p1_shadow_scheduler` 用真仓与夹具证明）。
 *
 * touches: src/domain/scheduling_evidence.ts, src/application/scheduling/evidence_frame.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertEvidenceSignal,
  detectVerdictConflicts,
  frameShapeError,
  identityOf,
  observesAlignment,
  relativeKey,
  resolveSubjectCandidates,
  scopeOfSignal,
  signalShapeError,
  subjectKey,
  testNodeId,
  fileOfTestNodeId,
  versionAlignment,
  type EvidenceFrame,
  type EvidenceSignal,
} from '../src/domain/scheduling_evidence.js';
import { buildEvidenceFrame, type ReadOnlyPorts } from '../src/application/scheduling/evidence_frame.js';
import { contentVersion } from '../src/application/design/verified_snapshot.js';

const sig = (over: Partial<EvidenceSignal> = {}): EvidenceSignal => ({
  id: 's1',
  kind: 'test',
  subject: { path: 'tests/a.test.ts' },
  source_ref: 'unit',
  scope: ['tests/a.test.ts'],
  verdict: 'pass',
  freshness: 'fresh',
  ...over,
});

// ── A1：版本对齐 ────────────────────────────────────────────────────────────

test('① 旧 source 版本 ⇒ stale（不许当当前通过证据）', () => {
  const r = versionAlignment('aaaa1111bbbb2222', 'cccc3333dddd4444');
  assert.equal(r.freshness, 'stale');
  assert.match(r.reason, /version-mismatch/);
});

test('① 反证：同一版本才是 fresh', () => {
  assert.equal(versionAlignment('same', 'same').freshness, 'fresh');
});

test('② 缺版本不是新鲜（两侧任一缺失都判不可判）', () => {
  assert.equal(versionAlignment(undefined, 'cur').freshness, 'unavailable');
  assert.equal(versionAlignment('', 'cur').freshness, 'unavailable');
  assert.equal(versionAlignment('old', undefined).freshness, 'unavailable');
  assert.match(versionAlignment(undefined, 'cur').reason, /version-unknown/);
});

test('② 观察面为空 ⇒ 不可判，不许拿"基线总版本相同"顶替', () => {
  const r = observesAlignment({ observes: [], baselineFiles: { 'a.ts': 'h1' }, currentFiles: { 'a.ts': 'h1' } });
  assert.equal(r.freshness, 'unavailable');
  assert.match(r.reason, /observes-empty/);
});

test('② 反证：观察面变了一个字节 ⇒ stale 且点名那个文件', () => {
  const r = observesAlignment({
    observes: ['src/a.ts', 'src/b.ts'],
    baselineFiles: { 'src/a.ts': 'h1', 'src/b.ts': 'h2' },
    currentFiles: { 'src/a.ts': 'h1', 'src/b.ts': 'h2-changed' },
  });
  assert.equal(r.freshness, 'stale');
  assert.deepEqual(r.drifted, ['src/b.ts']);
});

test('② 观察面里的文件不在基线 ⇒ 不可判（不是"没变"）', () => {
  const r = observesAlignment({ observes: ['src/new.ts'], baselineFiles: {}, currentFiles: { 'src/new.ts': 'h' } });
  assert.equal(r.freshness, 'unavailable');
  assert.match(r.reason, /observes-not-in-baseline/);
});

// ── 形状判据与 scope 口径 ───────────────────────────────────────────────────

test('③ scope 缺失/为空是"未声明"，不是全项目', () => {
  assert.equal(scopeOfSignal({ scope: [] }), 'undeclared');
  assert.equal(scopeOfSignal({ scope: ['src'] }), 'declared');
  assert.match(String(signalShapeError(sig({ scope: undefined as unknown as string[] }))), /scope 不是数组/);
});

test('③ 坏输入必须抛：verdict 越界 / 无来源 / id 空', () => {
  assert.match(String(signalShapeError(sig({ verdict: 'green' as never }))), /verdict 不在词表/);
  assert.match(String(signalShapeError(sig({ source_ref: '' }))), /source_ref 缺失/);
  assert.match(String(signalShapeError(sig({ id: ' ' }))), /id 缺失或为空/);
  assert.throws(() => assertEvidenceSignal(sig({ freshness: 'old' as never })), /证据帧形状不合法/);
  assert.doesNotThrow(() => assertEvidenceSignal(sig()));
});

// ── A4：同路径多候选不取第一个 ──────────────────────────────────────────────

test('④ 同路径多种写法 ⇒ **合并**成同一个对象（DS-1R：旧断言把等价写法当歧义，已证错）', () => {
  const r = resolveSubjectCandidates([{ raw: 'tests/a.test.ts' }, { raw: './tests/a.test.ts' }, { raw: 'src\\b.ts' }]);
  assert.deepEqual(r.ambiguous, [], '仅写法不同不是歧义（旧规则会在这里报 ambiguous）');
  assert.deepEqual(r.resolved.map((x) => x.key).sort(), ['src/b.ts', 'tests/a.test.ts']);
});
test('④ 反证：单一写法的候选正常解析，不进 ambiguous', () => {
  const r = resolveSubjectCandidates([{ raw: 'src/only.ts' }]);
  assert.deepEqual(r.resolved.map((x) => x.key), ['src/only.ts']);
  assert.equal(r.ambiguous.length, 0);
});

// ── C14 / B6：冲突两边都留 ──────────────────────────────────────────────────

test('⑤ pass 与 fail 冲突 ⇒ 两边都留，不投票', () => {
  const conflicts = detectVerdictConflicts([
    sig({ id: 'snap', verdict: 'pass', source_ref: 'snapshot' }),
    sig({ id: 'now', verdict: 'fail', source_ref: 'run' }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].subject, subjectKey({ path: 'tests/a.test.ts' }));
  assert.deepEqual([conflicts[0].left, conflicts[0].right].sort(), ['now', 'snap']);
});

test('⑤ retired + 历史 pass ⇒ **不是**当前冲突（DS-1R：旧断言把正常历史报成冲突）', () => {
  const conflicts = detectVerdictConflicts([
    sig({ id: 'ret', kind: 'design', verdict: 'unsupported', reason: 'retired', source_ref: 'design' }),
    sig({ id: 'old-pass', verdict: 'pass', source_ref: 'snapshot' }),
  ]);
  assert.equal(conflicts.length, 0);
});
test('⑤ 反证：两条 pass 不是冲突', () => {
  assert.equal(detectVerdictConflicts([sig({ id: 'a' }), sig({ id: 'b' })]).length, 0);
});

// ── 帧组装：端口注入、读不到 ≠ 空集、重复组装逐字相同 ─────────────────────────

const BASE_FILES = { 'src/a.mjs': 'h-a', 'tests/a.test.mjs': 'h-a-test' };

function fakePorts(over: Partial<ReadOnlyPorts> = {}): ReadOnlyPorts {
  const files = { ...BASE_FILES };
  return {
    identity: () => identityOf('/tmp/proj', 'linux'),
    content: () => ({ ok: true, value: { version: contentVersion(files), files } }),
    designRevisions: () => ({
      ok: true,
      value: { revisions: [{ feature: 'f', revision: 'f#7', source_ref: 'design-sheet:f' }], missingDir: false },
    }),
    indexFacts: () => ({ state: 'usable', schema_version: 18, stale_files: 0, stale_total: 3, untrusted_refs: 0 }),
    snapshot: () => ({ status: 'missing', reason: '没有基线文件' }),
    testObjects: () => ({ ok: true, value: ['tests/a.test.mjs'] }),
    eligibility: () => ({ eligible: ['tests/a.test.mjs'], excluded: [], unjudgeable: [] }),
    impact: () => ({
      ok: true,
      value: { ok: true, files: new Set(['src/a.mjs', 'tests/a.test.mjs']), symbols: new Set(), calls: 1, non_code: [] },
    }),
    capability: () => ({ runner: 'node-test', tiers: [{ path: 'src/a.mjs', tier: 'call' }] }),
    ...over,
  };
}

test('⑥ 内容版本读不到 ⇒ unavailable 缺口，不是"空指纹"', () => {
  const frame = buildEvidenceFrame({
    root: '/tmp/proj',
    goal: { text: 'g' },
    changed: ['src/a.mjs'],
    ports: fakePorts({ content: () => ({ ok: false, reason: '索引/走查炸了' }) }),
  });
  assert.equal(frame.content.version, null);
  assert.equal(frame.content.files, null, '★ 读不到不许退化成空对象');
  assert.ok(frame.gaps.some((g) => g.id === 'content:unavailable' && g.kind === 'unavailable'));
  assert.ok(frame.limitations.some((l) => /内容版本不可用/.test(l)));
});

test('⑥ 设计册无 _dsl_rev ⇒ revision 为 null 且记缺口（未知不是"最新"）', () => {
  const frame = buildEvidenceFrame({
    root: '/tmp/proj',
    goal: {},
    changed: [],
    ports: fakePorts({
      designRevisions: () => ({
        ok: true,
        value: { revisions: [{ feature: 'f', revision: null, source_ref: 'design-sheet:f' }], missingDir: false },
      }),
    }),
  });
  assert.equal(frame.design_revisions[0].revision, null);
  assert.ok(frame.gaps.some((g) => g.id === 'design:revision-missing:f'));
});

test('⑦ 范围逃逸（绝对路径/..）⇒ out-of-scope，不参与判定', () => {
  const frame = buildEvidenceFrame({
    root: '/tmp/proj',
    goal: { scope: ['D:/other/repo', '../escape'] },
    changed: [],
    ports: fakePorts(),
  });
  const kinds = frame.gaps.filter((g) => g.kind === 'out-of-scope').map((g) => g.id).sort();
  assert.equal(kinds.length, 2, `两个越界范围都要被点名：${kinds.join(',')}`);
});

test('⑧ 同一输入重复组装 ⇒ 逐字相同（A5 的帧侧）', () => {
  const input = { root: '/tmp/proj', goal: { text: 'g', scope: ['src'] }, changed: ['src/a.mjs'], ports: fakePorts() };
  const one = buildEvidenceFrame(input);
  const two = buildEvidenceFrame(input);
  assert.deepEqual(JSON.parse(JSON.stringify(two)), JSON.parse(JSON.stringify(one)));
});

test('⑧ 帧形状坏必须能被 frameShapeError 抓到（不许被策略层当成好帧）', () => {
  const frame = buildEvidenceFrame({ root: '/tmp/proj', goal: {}, changed: [], ports: fakePorts() }) as EvidenceFrame;
  assert.equal(frameShapeError(frame), null);
  const broken = { ...frame, signals: [{ ...sig(), scope: 'all' }] };
  assert.match(String(frameShapeError(broken)), /scope 不是数组/);
});

test('⑨ 相对键归一：反斜杠与 ./ 都归一到同一写法', () => {
  assert.equal(relativeKey('.\\src\\a.ts'), 'src/a.ts');
  assert.equal(relativeKey('src/a.ts'), 'src/a.ts');
});

test('⑩ G4 单一 test id 构造：写端只走 testNodeId，反解只走 fileOfTestNodeId', () => {
  // 仓库相对路径原样进 id，不再各自手拼 `test:tests/` 前缀。
  assert.equal(testNodeId('tests/a.test.ts'), 'test:tests/a.test.ts');
  assert.equal(testNodeId('src/a.ts'), 'test:src/a.ts');
  // 归一化（反斜杠 / ./）同样作用于 id 构造。
  assert.equal(testNodeId('.\\tests\\b.test.ts'), 'test:tests/b.test.ts');

  // 往返一致：构造 → 反解回归一化 file。
  for (const f of ['tests/a.test.ts', 'tests/sub/c.test.ts', 'src/x.ts']) {
    assert.equal(fileOfTestNodeId(testNodeId(f)), relativeKey(f));
  }

  // 非 test 条目反解 ⇒ null（contract / other 不被误当测试）。
  assert.equal(fileOfTestNodeId('contract:src/C.java'), null);
  assert.equal(fileOfTestNodeId('other:1'), null);

  // 单一构造永不产生重复 `tests/tests/` 双前缀。
  assert.ok(!testNodeId('tests/a.test.ts').includes('tests/tests/'));
});
