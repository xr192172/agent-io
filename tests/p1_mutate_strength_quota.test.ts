/**
 * P1 · 软判据方向棘轮 + 强制配额（T-#SOFT-KIND-RATCHET，重定基到 T-#MUTATE-DET 之后）
 * MUTATE_MODULE 环境变量选被测模块（真仓缺省 scripts/mutate.mjs；沙箱指向补丁副本）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modPath = process.env.MUTATE_MODULE ?? path.join(ROOT, 'scripts', 'mutate.mjs');
const M = await import(pathToFileURL(modPath).href);

test('① 强度镜像与权威等价（lead Q1 已裁：4 kind；edge-* 归 semantic）', () => {
  const authority = fs.readFileSync(path.join(ROOT, 'src/application/design/db/rewrite_plan.ts'), 'utf8');
  const m = authority.match(/const EXISTENCE_KINDS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(m, '权威 EXISTENCE_KINDS 声明没找到');
  const kinds = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
  assert.deepEqual(kinds, ['file-exists', 'signature-matches', 'source-has', 'symbol-exists']);
  for (const k of kinds) assert.equal(M.isExistenceKind({ kind: k }), true, `镜像漏了 ${k}`);
  assert.equal(M.isExistenceKind({ kind: 'call-exists' }), false, 'call-exists 是 semantic/wiring');
  assert.equal(M.isExistenceKind({ kind: 'edge-exists' }), false, 'Q1：edge-* 归 semantic');
  assert.equal(M.isExistenceKind({ kind: 'behavior-cases' }), false);
});

test('② 配额接到 selectSamples 结构：5 semantic + 1 existence + 1 structural（不抢强判据名额），桶轮转确定', async () => {
  const F = M.listFeatures(ROOT);
  const a = await M.planMutants(ROOT, F, { n: 5, structural: 1 });
  const b = await M.planMutants(ROOT, F, { n: 5, structural: 1 });
  assert.ok(a.existence.length > 0);
  assert.equal(a.quota.requested, 1);
  assert.equal(a.exSamples.length, 1, '默认 N=5 保底 1 条 existence');
  assert.equal(a.plans.filter(p => p.class === 'existence').length, 1);
  assert.equal(a.semSamples.length, 5, '存在类配额是加层覆盖，不许挤占 semantic 的 N=5（p1_determinism ⑤）');
  assert.equal(a.stSamples.length, 1);
  // 轮转形状：semantic → existence → wiring → semantic…
  assert.deepEqual(a.plans.map(p => p.class).slice(0, 3), ['semantic', 'existence', 'structural']);
  const key = p => p.plans.map(x => `${x.class}|${x.feature}|${x.file}|${x.symbol}|${x.kind}|${x.mutation_kinds}`).join('\n');
  assert.equal(key(a), key(b), '两次采样次序不同 ⇒ T-#MUTATE-DET 回归');
});

test('②b 分桶轮转纯函数：空桶跳过、次序确定、不改成员', () => {
  const g = { semantic: ['s1','s2'], existence: ['e1'], wiring: ['w1'] };
  assert.deepEqual(M.rotateByStrength(g), ['s1','e1','w1','s2']);
  assert.deepEqual(M.rotateByStrength({ semantic: ['a'], existence: [] }), ['a']);
  assert.deepEqual(Object.values(g).flat().sort(), ['e1','s1','s2','w1'], '输入未被修改');
});

test('③ 配额消融：关配额 / 无锚点池 ⇒ 如实降级', async () => {
  const off = await M.planMutants(ROOT, M.listFeatures(ROOT), { n: 5, structural: 1, existence: false });
  assert.equal(off.quota.enabled, false);
  assert.equal(off.plans.filter(p => p.class === 'existence').length, 0);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skr-rebase-quota-'));
  fs.mkdirSync(path.join(tmp, '.agent-io', 'design'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'f.ts'), '// phantomAnchor\nexport const other = 1;\n');
  fs.writeFileSync(path.join(tmp, '.agent-io', 'design', 'fx.dsl.json'), JSON.stringify({
    id:'fx', type:'feature_diagram', feature:'fx',
    geometry:{ nodes:[{ id:'n', decision:{ expectations:[{ kind:'symbol-exists', path:'src/f.ts', symbol:'phantomAnchor', why:'x' }] } }] },
    semantic:{ files:[{ id:'n', path:'src/f.ts' }] },
  }));
  const p = await M.planMutants(tmp, ['fx'], { n: 5, structural: 1 });
  assert.equal(p.quota.pool, 1, '存在类候选应进池（src-text/n/a skip 已放行）');
  assert.equal(p.quota.effective, 0, '无锚点 ⇒ 有效样本 0');
  assert.equal(p.quota.degraded, true, '★ 降级必须如实报');
  assert.ok(p.quota.no_anchor >= 1);
});

test('④ 真跑：存在类能 killed，且存在类读数不进 ok（不建免疫系统门）', async () => {
  const rep = await M.runMutate(M.listFeatures(ROOT), ROOT, { n: 5, structural: 1 });
  assert.ok(rep.existence_sampled >= 1);
  assert.equal(rep.existence_survived, 0);
  assert.equal(rep.existence_unsupported, 0);
  assert.ok(rep.existence_killed >= 1, '至少一条存在类判据应被变异抓到');
  const item = rep.items.find(i => i.class === 'existence' && i.verdict === 'killed');
  assert.ok(item);
  const fail = item.attempts.find(a => a.verdict === 'fail');
  assert.ok(fail && /缺 must|没有符号|签名不符/.test(fail.detail));
  // ok 的口径没被存在类污染（原 T-#MUTATE-DET 三态保持）
  assert.equal(rep.ok, rep.survived === 0 && rep.unsupported === 0 && rep.killed > 0);
});

test('⑤ 方向棘轮：掉档红 / 涨档绿 / 持平绿 / 无基线绿且不进退出码', () => {
  const mk = n => ({ existence_killed: n });
  const drop = M.compareExistenceRatchet(mk(3), 2);
  assert.equal(drop.ok, false);
  assert.equal(drop.regressed, true);
  assert.equal(M.compareExistenceRatchet(mk(3), 5).ok, true);
  assert.equal(M.compareExistenceRatchet(mk(3), 3).ok, true);
  const none = M.compareExistenceRatchet(null, 1);
  assert.equal(none.ok, true);
  assert.match(none.note, /无基线/);
  assert.equal(M.EXISTENCE_BASELINE_REL, 'scripts/mutate-existence-baseline.json');
});

test('⑥ T-#MUTATE-DET 兼容：--only 两次同 verdict，账豁免绕过且配额不误报降级', async () => {
  const opts = { n: 1, structural: false, only: 'src/domain/behavior_compare.ts#sameBehaviorRet' };
  const a = await M.runMutate(M.listFeatures(ROOT), ROOT, opts);
  const b = await M.runMutate(M.listFeatures(ROOT), ROOT, opts);
  assert.equal(a.killed, b.killed);
  assert.equal(a.survived, b.survived);
  assert.equal(a.quota.degraded, false, '--only 显式过滤不是配额失败');
  assert.equal(a.baseline_bypassed, true, 'T-#MUTATE-DET 账豁免在 --only 下仍绕过');
});
