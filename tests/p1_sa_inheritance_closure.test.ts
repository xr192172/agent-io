/**
 * P1 · **S-A / S-4 · 继承缓存闭包把守**：键面闭包化 + 写回原子化 + 并发不丢 + fail-closed。
 *
 * ## 判据（破坏哪一条都会红）
 *
 * ① **键面闭包**：门脚本的本地相对依赖改一字节 ⇒ 指纹变 ⇒ 不得继承（传递依赖未进键面 = 误跳过）。
 * ② **闭包算不清 fail-closed**：脚本引用的本地相对依赖解析不到真实文件 ⇒ 指纹 null ⇒ 实跑，不进跳过集。
 * ③ **并发双写不丢条目**：后一次写回基于陈旧快照时，仍重读最新落盘合并 ⇒ 先写的门条目不被覆盖丢失。
 * ④ **写回原子化**：落盘条目可解析、版本相符（不写半截 JSON）。
 *
 * ## 隔离
 * 每个用例自己的仓内 `.agent-io/` 夹具根，跑完删；不写真册 store。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Gate = { name: string; cmd?: string; args?: string[]; cwd?: string };
type IMod = {
  STORE_VERSION: number;
  inputFingerprint: (root: string, gate: Gate, extra?: Record<string, string[]>) => string | null;
  loadStore: (root: string) => { ok: boolean; reason: string; entries: Record<string, any> };
  planGate: (root: string, gate: Gate, store: any, extra?: Record<string, string[]>) => any;
  recordGate: (root: string, gate: Gate, store: any, result: any, extra?: Record<string, string[]>) => any;
  clearStore: (root: string) => void;
};

const I = (await import('../scripts/lib/verify_inheritance.mjs')) as unknown as IMod;

function makeRoot(tag: string): string {
  const root = path.join(REPO, '.agent-io', `gate-fixture-sa4-${tag}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  return root;
}
function rmRf(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 }); } catch { /* 不影响判定 */ }
}
const roGate = (name: string, script: string): Gate => ({ name, cmd: 'node', args: [script], cwd: '' });
const extra = (): Record<string, string[]> => ({ 'manifest:check': [], 'lint:prose': [] });

// ① 本地相对依赖改一字节 ⇒ 指纹变 ⇒ 不继承。
test('① S-4 键面闭包：脚本本地依赖改动进指纹，未变才允许跳过', () => {
  const root = makeRoot('closure');
  try {
    fs.writeFileSync(path.join(root, 'scripts', 'stub.mjs'), "import './lib/dep.mjs';\n// v1\n", 'utf8');
    fs.writeFileSync(path.join(root, 'scripts', 'lib', 'dep.mjs'), '// dep v1\n', 'utf8');
    const g = roGate('manifest:check', 'scripts/stub.mjs');
    const fp1 = I.inputFingerprint(root, g, extra());
    assert.ok(fp1, '闭包可静态算清 ⇒ 指纹非 null');
    let store = I.recordGate(root, g, I.loadStore(root), { verdict: 'PASS', state: 'PASS' }, extra());
    assert.equal(I.planGate(root, g, store, extra()).decision, 'inherit', '未变 ⇒ 可继承');

    // 改本地依赖一字节（门脚本本体未动）⇒ 指纹必须变。
    fs.writeFileSync(path.join(root, 'scripts', 'lib', 'dep.mjs'), '// dep v2\n', 'utf8');
    const fp2 = I.inputFingerprint(root, g, extra());
    assert.notEqual(fp2, fp1, '本地依赖改动 ⇒ 指纹必须变（传递闭包进键面）');
    assert.equal(I.planGate(root, g, store, extra()).decision, 'run', `依赖变了必须重跑：${I.planGate(root, g, store, extra()).reason}`);
  } finally { rmRf(root); }
});

// ② 本地依赖解析不到 ⇒ 指纹 null（fail-closed 实跑，不进跳过集）。
test('② S-4 fail-closed：闭包算不清（依赖缺失）⇒ 指纹 null ⇒ 实跑', () => {
  const root = makeRoot('missing-dep');
  try {
    fs.writeFileSync(path.join(root, 'scripts', 'stub.mjs'), "import './lib/missing.mjs';\n", 'utf8');
    const g = roGate('lint:prose', 'scripts/stub.mjs');
    const fp = I.inputFingerprint(root, g, extra());
    assert.equal(fp, null, '本地相对依赖解析不到 ⇒ 指纹必须 null（不许继承）');
    const p = I.planGate(root, g, I.loadStore(root), extra());
    assert.equal(p.decision, 'run', '指纹不可算 ⇒ 实跑');
  } finally { rmRf(root); }
});

// ③ 并发双写：后写基于陈旧快照 ⇒ 重读最新落盘合并，先写条目不丢。
test('③ S-4 并发不丢：陈旧快照写回仍合并最新落盘，两条门条目都在', () => {
  const root = makeRoot('concurrent');
  try {
    fs.writeFileSync(path.join(root, 'scripts', 'a.mjs'), '// a\n', 'utf8');
    fs.writeFileSync(path.join(root, 'scripts', 'b.mjs'), '// b\n', 'utf8');
    const ga = roGate('manifest:check', 'scripts/a.mjs');
    const gb = roGate('lint:prose', 'scripts/b.mjs');
    // A 先写回（落盘含 A）。
    I.recordGate(root, ga, I.loadStore(root), { verdict: 'PASS', state: 'PASS' }, extra());
    // B 用一份全新冷快照（陈旧、不含 A）写回 ⇒ 必须重读落盘合并，不能覆盖丢 A。
    I.recordGate(root, gb, { ok: true, reason: '', entries: {} }, { verdict: 'PASS', state: 'PASS' }, extra());
    const store = I.loadStore(root);
    assert.ok(store.ok, '写回后 store 可解析');
    assert.ok(store.entries['manifest:check'], 'A 条目不得被 B 的陈旧快照覆盖丢失');
    assert.ok(store.entries['lint:prose'], 'B 条目必须在');
  } finally { rmRf(root); }
});

// ④ 原子写回：落盘版本相符、条目结构完整（不写半截 JSON）。
test('④ S-4 写回原子化：落盘 version 相符、条目字段齐全', () => {
  const root = makeRoot('atomic');
  try {
    fs.writeFileSync(path.join(root, 'scripts', 'stub.mjs'), '// v1\n', 'utf8');
    const g = roGate('manifest:check', 'scripts/stub.mjs');
    I.recordGate(root, g, I.loadStore(root), { verdict: 'PASS', state: 'PASS', cases: { unit: '检查', pass: 3, total: 3 } }, extra());
    const store = I.loadStore(root);
    assert.equal(store.ok, true);
    assert.equal(store.entries['manifest:check'].fingerprint, I.inputFingerprint(root, g, extra()));
    assert.ok(store.entries['manifest:check'].ran_at, '条目必须带 ran_at');
    assert.deepEqual(store.entries['manifest:check'].cases, { unit: '检查', pass: 3, total: 3 });
  } finally { rmRf(root); }
});
