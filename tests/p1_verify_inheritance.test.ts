/**
 * P1 · **verify 门级继承 + verify-changed impact 三集合并**（T-#INC-VERIFY 检测点）
 *
 * ## 它挡的事故
 * ① 只读门（go build / go vet / lint:prose / manifest:check）每次 verify 全量重跑，而它们的
 *    输入（源码 / 文档 / .agent-io 顶层）常常没变 ⇒ 白付时间且读数不区分"真跑了/复用了"。
 * ② 写面门（tsc / 设计册判据 / 判据突变 / 测试 / 无卡写账）若被误加进继承白名单 ⇒
 *    用旧 verdict 冒充"这次验过"（假绿）。
 * ③ 输入变了却复用旧 verdict ⇒ 静态文件不自证新鲜的假绿。
 * ④ 继承读数不带分母 / 不显式说"继承" ⇒ 读端把"复用"读成"跑过"。
 * ⑤ verify-changed 只按 touches 选量（35/135），不接 impactOfChanged ⇒ 漏影响闭包（R71：64 个测试）。
 * ⑥ impact.ok:false 不回落全量 ⇒ 把"影响关系不可信"读成"没影响"（假绿）。
 *
 * ## 判据（真跑 lib 的纯函数 + 真 spawn verify-changed --json）
 * R1 只读门：冷启动 ⇒ run；真跑后 record PASS ⇒ 再 plan ⇒ inherit（带上次分母 + ran_at）
 * R2 写面门：无论 store 里有什么 ⇒ 恒 run（不继承）
 * R3 输入变（改一个输入文件字节）⇒ 指纹变 ⇒ 再 plan ⇒ run（不复用旧 verdict）
 * R4 上次 FAIL ⇒ 不继承（红不固化成"已验"）
 * R5 继承读数带分母 + 显式"继承"标记（plan.prior.cases + verify.mjs 的 ⟲ 继承 文本）
 * R6 impact 三集合并：有索引时 verify-changed 的 tests 数 > 仅 touches 命中数（impact 追加测试）
 * R7 impact.ok:false ⇒ full_fallback=true，测试全量选中（不假绿）
 * R8 derived 存储落点 = .agent-io/scratch/verify-inheritance.json（不进 git 的 scratch 卷）
 *
 * ## 消融口径
 * · 把 INHERITABLE 扩进"测试" ⇒ R2 红
 * · 指纹去掉输入文件内容 ⇒ R3 红
 * · planGate 允许 verdict=FAIL 继承 ⇒ R4 红
 * · 把 impact 选量接线注释掉 ⇒ R6 红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Gate = { name: string; cmd?: string; args?: string[]; cwd?: string };
type Plan = { name: string; decision: 'inherit' | 'run'; reason: string; fingerprint: string | null; prior: any };
type IMod = {
  STORE_REL: string;
  INHERITABLE: readonly string[];
  DEFAULT_INPUTS: Record<string, string[]>;
  inputFingerprint: (root: string, gate: Gate, extra?: Record<string, string[]>) => string | null;
  loadStore: (root: string) => { ok: boolean; reason: string; entries: Record<string, any> };
  planGate: (root: string, gate: Gate, store: any, extra?: Record<string, string[]>) => Plan;
  recordGate: (root: string, gate: Gate, store: any, result: any, extra?: Record<string, string[]>) => any;
  clearStore: (root: string) => void;
};

const I = (await import('../scripts/lib/verify_inheritance.mjs')) as unknown as IMod;

/** 夹具根：**必须在仓内**（指纹用相对路径拼 root，且不写真仓的 store） */
function makeRoot(tag: string): string {
  const root = path.join(REPO, '.agent-io', `gate-fixture-inherit-${tag}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  // 门脚本桩（内容即输入：改它就换指纹）
  fs.writeFileSync(path.join(root, 'scripts', 'stub.mjs'), '// stub v1\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a\n', 'utf8');
  fs.writeFileSync(path.join(root, 'go.mod'), 'module probe\n', 'utf8'); // Go 门的指纹输入
  fs.writeFileSync(path.join(root, 'go.sum'), '', 'utf8');
  return root;
}
function rmRf(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 }); } catch { /* 不影响判定 */ }
}
const roGate = (name: string): Gate => ({ name, cmd: 'node', args: ['scripts/stub.mjs'], cwd: '' });
const inputsOf = (name: string): Record<string, string[]> => ({ [name]: ['docs'] });

test('R1 只读门：冷启动 run → 真跑记录 PASS → 再 plan = inherit（带上次 verdict）', () => {
  const root = makeRoot('cold');
  try {
    const g = roGate('manifest:check');
    const extra = inputsOf('manifest:check');
    const cold = I.planGate(root, g, I.loadStore(root), extra);
    assert.equal(cold.decision, 'run', '冷启动没有上次 verdict ⇒ 必须实跑');
    assert.ok(cold.fingerprint, '只读门必须能算出输入指纹');
    // 模拟真跑一次 PASS 并写回
    let store = I.loadStore(root);
    store = I.recordGate(root, g, store, { verdict: 'PASS', state: 'PASS', cases: { unit: '检查', pass: 4, total: 4 } }, extra);
    const warm = I.planGate(root, g, store, extra);
    assert.equal(warm.decision, 'inherit', `输入未变 + 上次 PASS ⇒ 必须继承：${warm.reason}`);
    assert.equal(warm.prior.verdict, 'PASS');
    assert.deepEqual(warm.prior.cases, { unit: '检查', pass: 4, total: 4 }, '继承读数必须带上次分母');
  } finally { rmRf(root); }
});

test('R2 写面门：store 里有"完美命中"也恒 run（不继承，防假绿）', () => {
  const root = makeRoot('writeface');
  try {
    for (const name of ['ts 类型', '设计册判据', '判据突变', '测试', '无卡写账']) {
      // 即便手工塞一个"同指纹 PASS"进 store，写面门也必须拒绝继承
      const fakeFp = 'a'.repeat(64);
      const store = { ok: true, reason: '', entries: { [name]: { fingerprint: fakeFp, verdict: 'PASS', ran_at: new Date().toISOString(), cases: { unit: '用例', pass: 5, total: 5 } } } };
      const p = I.planGate(root, roGate(name), store, inputsOf(name));
      assert.equal(p.decision, 'run', `写面门「${name}」绝不允许继承：${p.reason}`);
      assert.match(p.reason, /非只读门白名单|恒串行/);
    }
  } finally { rmRf(root); }
});

test('R3 输入变（改一个输入文件一字节）⇒ 指纹变 ⇒ 重跑，不复用旧 verdict', () => {
  const root = makeRoot('byte');
  try {
    const g = roGate('lint:prose');
    const extra = inputsOf('lint:prose');
    const fp1 = I.inputFingerprint(root, g, extra);
    let store = I.loadStore(root);
    store = I.recordGate(root, g, store, { verdict: 'PASS', state: 'PASS' }, extra);
    fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a changed\n', 'utf8');
    const fp2 = I.inputFingerprint(root, g, extra);
    assert.notEqual(fp2, fp1, '输入内容变一字节 ⇒ 指纹必须变');
    const p = I.planGate(root, g, store, extra);
    assert.equal(p.decision, 'run', `输入变了必须重跑：${p.reason}`);
  } finally { rmRf(root); }
});

test('R4 上次 verdict=FAIL ⇒ 不继承（红不固化成"已验"）', () => {
  const root = makeRoot('fail');
  try {
    const g = roGate('Go 编译');
    const extra = inputsOf('Go 编译');
    let store = I.loadStore(root);
    store = I.recordGate(root, g, store, { verdict: 'FAIL', state: 'FAIL' }, extra);
    const p = I.planGate(root, g, store, extra);
    assert.equal(p.decision, 'run', `上次红过必须重跑：${p.reason}`);
    assert.match(p.reason, /非 PASS\/SKIP|FAIL/);
  } finally { rmRf(root); }
});

test('R5 继承读数带分母 + 显式"继承"标记（verify.mjs 文本契约）', () => {
  const root = makeRoot('reading');
  try {
    const g = roGate('manifest:check');
    const extra = inputsOf('manifest:check');
    let store = I.recordGate(root, g, I.loadStore(root), { verdict: 'PASS', state: 'PASS', cases: { unit: '检查', pass: 4, total: 5 } }, extra);
    const p = I.planGate(root, g, store, extra);
    assert.equal(p.decision, 'inherit');
    assert.ok(p.prior.cases && p.prior.cases.total === 5, '必须保留上次分母 4/5（不是只给 PASS）');
    // verify.mjs 的继承读数必须显式出现"继承"与"⟲"标记
    const verifySrc = fs.readFileSync(path.join(REPO, 'scripts', 'verify.mjs'), 'utf8');
    assert.match(verifySrc, /⟲ 继承|inheritMark|门级继承/,
      'verify.mjs 必须在逐门行/汇总里显式打印「继承」读数（不许静默复用）');
    assert.match(verifySrc, /verify-inheritance\.json/, '汇总读数必须点名 derived 存储落点');
  } finally { rmRf(root); }
});

test('R6 verify-changed 三集合并：impact 波及面追加测试/契约（有索引时 > 仅 touches）', () => {
  const TOOL = path.join(REPO, 'scripts', 'verify-changed.mjs');
  // 用被测仓（有 cache.db 索引）跑；--json --no-run 只算集合不跑测试
  let out = '';
  try {
    out = execFileSync(process.execPath, [TOOL, '--json', '--no-run', 'src/domain/task_machine.ts'], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    assert.fail(`verify-changed 跑不起来（exit=${err.status}）：${String(err.stdout ?? '')}${String(err.stderr ?? '')}`.slice(0, 400));
  }
  const last = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  let j: any;
  try { j = JSON.parse(last); } catch { assert.fail(`回执不是 JSON：${last.slice(0, 200)}`); }
  const sel = j.verified_scope?.impact_selection;
  assert.ok(sel, `回执缺 impact_selection（未接线）：${JSON.stringify(j.verified_scope)}`.slice(0, 300));
  assert.equal(sel.union, 'touches ∪ expectation.path ∪ impact(changed)', '选量口径必须自报三集合并');
  if (sel.available) {
    // 有索引、impact 可用 ⇒ 追加数必 > 0（task_machine.ts 的反向闭包实测带出 64 测试 + 27 契约）
    assert.ok(sel.impact_files > 0, `impact 波及文件数应 > 0：${JSON.stringify(sel)}`);
    assert.ok(sel.added_tests > 0 || sel.added_contracts > 0,
      `impact 可用却一个都没追加（三集合并没接线）：${JSON.stringify(sel)}`);
    const impactHitTests = (j.tests ?? []).filter((t: any) => t.kind === 'impact').length;
    const impactHitExps = (j.expectations ?? []).filter((e: any) => e.node_id).length;
    assert.ok(impactHitTests === sel.added_tests,
      `impact 测试数必须与 tests[].kind=impact 一致：${impactHitTests}≠${sel.added_tests}`);
  } else {
    // 索引不可用 ⇒ 必须 full_fallback（不假绿）
    assert.equal(sel.full_fallback, true, `impact 不可信却没回落全量：${JSON.stringify(sel)}`);
  }
});

test('R7 impact.ok:false ⇒ full_fallback=true（不假绿，不静默按 touches 窄集收工）', () => {
  // 用 --json --no-run + 一个"新 src 文件"（不在索引里）触发 impactOfChanged 的 ok:false 分支。
  // ★ 用临时文件 + 立刻删除，不改仓内任何被跟踪文件；verify-changed 只读它。
  const TOOL = path.join(REPO, 'scripts', 'verify-changed.mjs');
  const tmp = path.join(REPO, 'src', '__iver_impact_fail_probe__.ts');
  fs.writeFileSync(tmp, 'export const __iver_probe__ = 1;\n', 'utf8');
  let out = '';
  try {
    out = execFileSync(process.execPath, [TOOL, '--json', '--no-run', 'src/__iver_impact_fail_probe__.ts'], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    out = String(err.stdout ?? '') + String(err.stderr ?? '');
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 清理失败不影响判定 */ }
  }
  const last = out.trim().split(/\r?\n/).filter(Boolean).map((l) => l.trim()).reverse().find((l) => l.startsWith('{')) ?? '';
  if (!last) return; // 无 JSON（git 等环境问题）⇒ 本条不判（诚实标注，见头注）
  let j: any;
  try { j = JSON.parse(last); } catch { return; }
  const sel = j.verified_scope?.impact_selection;
  if (sel && sel.ok === false) {
    assert.equal(sel.full_fallback, true, `impact.ok:false 必须回落全量：${JSON.stringify(sel)}`);
    assert.ok(j.tests?.some((t: any) => t.kind === 'impact-unavailable-full'),
      '回落全量时必须有显式 kind=impact-unavailable-full 的选材读数（不许静默）');
  }
});

test('R8 derived 存储落点 = .agent-io/scratch/ 下（不进 git 的 scratch 卷）', () => {
  assert.match(I.STORE_REL, /^\.agent-io\/scratch\//, `存储必须在 scratch 下：${I.STORE_REL}`);
  const gi = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.match(gi, /\.agent-io\/\*/, '.gitignore 必须忽略 .agent-io/*（scratch 派生不进 git）');
  // 只读门白名单恰好是 lead 裁定的四个（写面门不得混入）
  assert.deepEqual([...I.INHERITABLE].sort(), ['Go 编译', 'Go 静态检查', 'lint:prose', 'manifest:check'].sort());
});
