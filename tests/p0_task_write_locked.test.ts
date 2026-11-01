/**
 * task 写端必须与别人共用同一把乐观锁（第二轮外审：「**修了半边**」）。
 *
 * ## 病（2026-11-01，上一笔 P0 修复的残留）
 * `saveDesignSheet` 退化成 `saveDSL` 的别名后，**rev 会推进**（于是别人拿着旧 rev 写会被拦）；
 * 但别名当时传的是 `base_dsl_rev = undefined` ⇒ `saveDSL` 的校验**整段跳过**
 * ⇒ 方向反转成「别人写能被拦、**task 操作覆盖别人仍然静默**」。
 *
 * 修法：别名把**读进来的那个 rev**（`dsl._dsl_rev`）当 base 传下去。
 * 本用例守三件（每条都证过红：把 base 改回 `undefined` ⇒ ② 当场红）：
 *   ① 正常路径：读册 → 改 → `saveDesignSheet` ⇒ rev 前进（不因新校验误伤）；
 *   ② ★ 并发路径：读册后**别人先写了** ⇒ 我这笔 `saveDesignSheet` **必须抛 DSL 冲突**，且磁盘保持别人那一版；
 *   ③ 落点一致：两个写端落在同一个册文件上。
 *
 * ## 夹具隔离（踩过的坑，别重踩）
 * `currentDslRev()` → `readDSLRaw(feature)` **不接 `baseDir`**，只在数据仓里找册。
 * 给 `saveDesignSheet` 传显式 `baseDir` ⇒ 写落一处、rev 读另一处 = 测两条不相干的路（假绿）。
 * ⇒ 只钉 `AGENT_IO_HOME`（临时数据仓） + 独立 feature 名 + finally 点名删。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { getDesignSheet, saveDSL, saveDesignSheet } from '../src/infrastructure/storage.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const FEATURE = `__lockprobe_${process.pid}`;

/** 六边形的最小合法册（只带判据用得到的那几个字段） */
const sheet = (marker: string) =>
  ({
    feature: FEATURE,
    source_root: process.cwd(),
    geometry: {
      nodes: [{ id: 'n1', label: marker, path: 'src/a.ts', layer: 'main', type: 'module' }],
      edges: [],
    },
  }) as never;

function inSandbox(fn: () => void): void {
  const prev = process.env.AGENT_IO_HOME;
  const home = makeTempHome();
  process.env.AGENT_IO_HOME = home;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
}

const revOf = (): number | undefined => (getDesignSheet(FEATURE) as never as { _dsl_rev?: number })?._dsl_rev;

test('① task 写端正常路径：rev 前进，不因新校验误伤', () =>
  inSandbox(() => {
    saveDSL(sheet('first'), 'test');
    assert.equal(revOf(), 1, '首次落盘后 rev 应为 1');

    const read = getDesignSheet(FEATURE);
    assert.ok(read, '刚写过的册必须读得到');
    saveDesignSheet(read); // 「读 → 改 → 落盘」，正是 task_ops 的形态
    assert.equal(revOf(), 2, 'task 写端走 saveDesignSheet 后 rev 必须继续前进');
  }));

test('② ★ 并发路径：读到旧 rev 再写 ⇒ 必须抛冲突，且不覆盖别人那一版', () =>
  inSandbox(() => {
    saveDSL(sheet('v1'), 'test'); // rev 1
    const mine = getDesignSheet(FEATURE); // 我读到 rev=1
    assert.ok(mine);

    saveDSL(sheet('B-version'), 'other'); // 别人先写 ⇒ rev 2

    assert.throws(
      () => saveDesignSheet(mine),
      /DSL 冲突/,
      'task 写端拿旧 rev 落盘必须抛 DSL 冲突 —— 否则就是「别人写能被拦、task 覆盖别人静默」',
    );
    const disk = getDesignSheet(FEATURE) as never as { geometry: { nodes: { label: string }[] } };
    assert.equal(disk.geometry.nodes[0].label, 'B-version', '磁盘必须保持别人那一版，我这次不许覆盖');
  }));

test('③ 落点一致：两个写端落在同一个册文件上', () =>
  inSandbox(() => {
    const a = saveDSL(sheet('x'), 'test');
    const read = getDesignSheet(FEATURE);
    assert.ok(read);
    const b = saveDesignSheet(read);
    assert.equal(a, b, '两个写端必须落在同一个册文件上（否则又是「两个写端」）');
    assert.equal(fs.existsSync(b), true);
  }));
