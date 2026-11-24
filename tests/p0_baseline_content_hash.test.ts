/**
 * P0 · 基线 DSL `_sync.content_hash` 读端重算比对（C14 · O6 接线，兑现 B2 读端承诺）。
 *
 * ## 它钉的是什么
 * `saveBaselineFeature` 写基线时用 `dslContentHash(dsl)` 落 `_sync.content_hash`，但读端
 * `getBaselineFeature` 读回不重算，`diffBaselineFiles` 走逐文件 `fileFingerprint` 集合对账，
 * 从不读 content_hash —— 基线被手改 / 快照损坏 / stale 时，集合对账之外的整体指纹失配没有声音。
 *
 * 本文件对纯函数钉住：读时重算 `dslContentHash` 与落账 `content_hash` 比对，不等 ⇒
 * `ok=false` 逐条点名（fail-closed 不静默）；结果经 `diffBaselineFiles` 的 `hash_check` 透出。
 *
 * 夹具在进程内内存态，不写真册 DB / 基线 JSON / git。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dslContentHash,
  verifyBaselineContentHash,
  diffBaselineFiles,
} from '../src/infrastructure/storage.js';
import type { DesignDSL } from '../src/domain/types.js';

function makeDsl(): DesignDSL {
  return {
    id: 'fx',
    type: 'design',
    feature: 'fx',
    version: 1,
    title: '夹具',
    geometry: {
      nodes: [{ id: 'n1', label: 'x.ts', type: 'file', path: 'src/x.ts' }],
      edges: [],
    },
    semantic: {
      files: [{ id: 'n1', path: 'src/x.ts', lines: 1, symbols: [{ name: 'f', line: 1, end_line: 1, signature: 'f(a)' }] }],
    },
  } as unknown as DesignDSL;
}

/** 给一份 DSL 挂上指定落账 content_hash；不传则用重算真值（一致基线）。 */
function withHash(dsl: DesignDSL, recorded?: string): DesignDSL {
  const hash = recorded ?? dslContentHash(dsl);
  return { ...dsl, _sync: { content_hash: hash } } as unknown as DesignDSL;
}

test('无旧基线（首次锚定）⇒ 无可比对象，ok=true 空理由', () => {
  const check = verifyBaselineContentHash(null);
  assert.equal(check.ok, true);
  assert.deepEqual(check.reasons, []);
});

test('落账 content_hash == 重算值 ⇒ ok=true，recorded == recomputed', () => {
  const dsl = withHash(makeDsl());
  const check = verifyBaselineContentHash(dsl);
  assert.equal(check.ok, true, check.reasons.join('；'));
  assert.equal(check.recorded, check.recomputed);
});

test('落账 hash 与重算值不符（手改 / 快照损坏 / stale）⇒ ok=false 点名前后值', () => {
  const dsl = withHash(makeDsl(), 'deadbeefdeadbeefdeadbeefdeadbeef');
  const check = verifyBaselineContentHash(dsl);
  assert.equal(check.ok, false);
  assert.ok(check.reasons.some((x) => x.includes('不符')));
  assert.equal(check.recorded, 'deadbeefdeadbeefdeadbeefdeadbeef');
  assert.ok(check.recomputed && check.recomputed !== check.recorded);
});

test('缺落账 content_hash（B2 未兑现 / 旧格式）⇒ ok=false 点名缺失', () => {
  const dsl = makeDsl();
  const check = verifyBaselineContentHash(dsl);
  assert.equal(check.ok, false);
  assert.ok(check.reasons.some((x) => x.includes('content_hash 缺失')));
});

test('diffBaselineFiles 透出 hash_check：旧基线被改 ⇒ hash_check.ok=false；首次锚定 ⇒ ok=true', () => {
  const next = makeDsl();

  // 旧基线落账 hash 被改坏
  const prevBad = withHash(makeDsl(), '0000000000000000000000000000000000000000');
  const driftBad = diffBaselineFiles(prevBad, next);
  assert.equal(driftBad.hash_check.ok, false);
  assert.ok(driftBad.hash_check.reasons.some((x) => x.includes('不符')));

  // 首次锚定：prev=null
  const driftFirst = diffBaselineFiles(null, next);
  assert.equal(driftFirst.from, null);
  assert.equal(driftFirst.hash_check.ok, true);
  assert.deepEqual(driftFirst.hash_check.reasons, []);

  // 旧基线 hash 一致 ⇒ hash_check.ok=true（逐文件对账另算，互不顶替）
  const prevGood = withHash(makeDsl());
  const driftGood = diffBaselineFiles(prevGood, next);
  assert.equal(driftGood.hash_check.ok, true);
});
