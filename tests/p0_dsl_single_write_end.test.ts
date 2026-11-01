/**
 * P0 回归 · **设计册只有一个写端**（2026-11-01 外部审计 P0 的永久守卫）。
 *
 * ## 被守的那个洞（已修，此前无测试守着 = 没收口）
 * `saveDesignSheet` 与 `saveDSL` 写的是**同一个文件**（`design/<f>.dsl.json`），
 * 而此前只有 `saveDSL` 会 ① 校验 `base_dsl_rev` ② 自增 `_dsl_rev` ③ 原子写。
 * `task_ops` 的 claim / start / release / complete / reopen / void / relaunch / renew / todo 共 11 处
 * 走的是 `saveDesignSheet` ⇒ 它们写的册 **rev 不停前进** ⇒ 另一个会话拿 `base_dsl_rev=N` 去写时
 * 乐观锁判「无冲突」，把别人刚 claim 的卡整本冲掉且回执一字不提。
 *
 * ## 两条判据（都能证红：把 `saveDesignSheet` 改回"不推进 rev"的旧体，两条当场红）
 * 1. 经 `saveDesignSheet` 落盘后 `_dsl_rev` **前进**（改前：停在 `saveDSL` 那一版）；
 * 2. 两者落盘的**是同一个文件**，且 `saveDSL` 的 `base_dsl_rev` 校验对前者写过的内容**生效**
 *    （拿旧 rev 写 ⇒ 抛冲突；改前不抛 ⇒ 乐观锁对那 11 个写端全部失效）。
 *
 * ## 夹具为什么这样隔离（踩过的坑，别重踩）
 * `saveDSL` 的乐观锁读的是 `currentDslRev()` → `readDSLRaw(feature)` ——
 * **它不接 `baseDir`**，只在**数据仓**里找册。若测试给 `saveDesignSheet` 传一个显式 `baseDir`，
 * 写会落到别处、rev 却从数据仓读 ⇒ 测的是两条不相干的路径（假绿）。
 * ⇒ 本证**不传 baseDir**：只钉 `AGENT_IO_HOME` 到一个临时目录（数据仓随之在临时区 = 沙盒 ⇒ 写闸放行），
 *   让读写**都**经同一个真落点解析出来。feature 用 `__revprobe_<pid>` 独立命名，
 *   `finally` 里把 `design/__revprobe_*.dsl.json` 与整个临时数据仓一起删掉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getDesignSheet, saveDSL, saveDesignSheet } from '../src/infrastructure/storage.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** ★ 独立 feature 名（不与任何真册撞名；`getDesignSheetFile` 要求 `^[a-zA-Z0-9_-]+$`） */
const FEATURE = `__revprobe_${process.pid}`;
/** 探针会被删掉的那几个文件（finally 里点名校验用） */
const probeFiles = (home: string): string[] => {
  const dir = path.join(home, '.agent-io', 'design');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('__revprobe_') && f.endsWith('.dsl.json'))
    .map((f) => path.join(dir, f));
};

/** 在临时数据仓里跑一段（`AGENT_IO_HOME` 是**唯一**的落点声明 ⇒ 读写同一处，见文件头） */
function inSandbox(fn: (home: string) => void): void {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  try {
    fn(home);
  } finally {
    // ★ 先点名删探针册，再整棵删数据仓 —— 两件都做：前者让"删的是哪个文件"进读数，后者保证不留渣
    for (const f of probeFiles(home)) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* 已删 / 句柄占用：下面的 rmRf 兜底 */
      }
    }
    assert.deepEqual(probeFiles(home), [], `探针册没删干净：${probeFiles(home).join(', ')}`);
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
}

/** 册的最小形状（`source_root` 指临时数据仓：那里没有 tasks.db ⇒ 不去碰任何真库） */
function sheetOf(sourceRoot: string, nodes: Array<Record<string, unknown>>): Record<string, unknown> {
  return { feature: FEATURE, source_root: sourceRoot, geometry: { nodes }, semantic: { files: [] } };
}

/** 磁盘上的 `_dsl_rev`（★ 从**文件**读，不从内存里那份读 —— 内存那份是调用方自己设的） */
function revOnDisk(file: string): number {
  return (JSON.parse(fs.readFileSync(file, 'utf-8')) as { _dsl_rev?: number })._dsl_rev ?? 0;
}

/** 造到 rev=2：`saveDSL` 两次（1→2），返回册路径 */
function seedToRev2(home: string): string {
  const file = saveDSL(
    sheetOf(home, [{ id: 'n1', label: '手写节点', decision: { summary: '人手写的决策，扫描产不出来' } }]) as never,
    'mcp',
  );
  assert.equal(revOnDisk(file), 1, '前置：saveDSL 首写 rev 必须是 1');
  const d = getDesignSheet(FEATURE);
  assert.ok(d, '前置：册读得回来');
  d.geometry.nodes.push({ id: 'n2', label: 'edit_dsl 加的节点' } as never);
  saveDSL(d, 'mcp', 1);
  assert.equal(revOnDisk(file), 2, '前置：saveDSL 带 base rev 写 ⇒ rev 2');
  return file;
}

test('P0-写端 ① · 经 saveDesignSheet 落盘后 `_dsl_rev` 前进（改前：停在 2 ⇒ 乐观锁对它失效）', () => {
  inSandbox((home) => {
    const file = seedToRev2(home);

    // ★ 这一笔就是 task_ops 那 11 处的形状：读册 → 改卡 → saveDesignSheet
    const d2 = getDesignSheet(FEATURE);
    assert.ok(d2, '册必须读得回来');
    (d2.geometry.nodes.find((n) => n.id === 'n1') as Record<string, unknown>).task = {
      id: 'card_probe',
      summary: 'B 领了卡',
      state: 'claimed',
      owner: 'agent:B',
    };
    const written = saveDesignSheet(d2);

    // ① 写的必须是**同一个文件**（不是"另一份册"）
    assert.equal(written, file, 'saveDesignSheet 与 saveDSL 必须落同一个文件（否则 rev 与乐观锁根本不在一条路上）');
    // ② ★ 红线：rev 必须前进（改前这里是 2 —— 与上一笔一字不差 ⇒ 乐观锁无从发现"册被改过"）
    assert.equal(revOnDisk(file), 3, 'saveDesignSheet 落盘后 _dsl_rev 必须从 2 前进到 3（改前停在 2 ⇒ 那 11 个写端全部绕过乐观锁）');
    // ③ 内容确实落盘了（本条不是在验一个"空写但 rev 涨了"的假前进）
    const back = getDesignSheet(FEATURE);
    const n1 = back?.geometry.nodes.find((n) => n.id === 'n1') as { task?: { owner?: string } } | undefined;
    assert.equal(n1?.task?.owner, 'agent:B', '卡必须真的落进册里（rev 前进 ≠ 反正没写内容）');
  });
});

test('P0-写端 ② · saveDSL 的 base_dsl_rev 校验对 saveDesignSheet 写过的内容生效（拿旧 rev 写 ⇒ 冲突）', () => {
  inSandbox((home) => {
    const file = seedToRev2(home);

    // 进程 A 拿着 rev=2 的快照（= `get_dsl` 那一刻），此时还看不出任何冲突
    const snapA = getDesignSheet(FEATURE);
    assert.ok(snapA, '册必须读得回来');

    // 进程 B 走 saveDesignSheet 改册（task_ops 那一类写入）
    const dB = getDesignSheet(FEATURE);
    assert.ok(dB);
    dB.geometry.nodes.push({ id: 'n3', label: 'B 加的节点' } as never);
    saveDesignSheet(dB);
    const revAfterB = revOnDisk(file);
    assert.equal(revAfterB, 3, 'B 那一笔也要推进 rev（2→3）');

    // A 基于旧快照写：base rev 2 ≠ 磁盘 3 ⇒ **必须**抛冲突（改前 rev 仍是 2 ⇒ 静默覆盖 B 的改动）
    snapA.geometry.nodes.push({ id: 'n4', label: 'A 基于旧快照加的节点' } as never);
    assert.throws(
      () => saveDSL(snapA, 'mcp', 2),
      /DSL 冲突/,
      'A 拿 rev=2 写而磁盘已是 3 ⇒ 必须抛「DSL 冲突」（改前不抛 = 乐观锁对 saveDesignSheet 的写完全失效）',
    );

    // 冲突被拦下之后：B 的改动还在，A 的改动一个字都没落盘
    const fin = getDesignSheet(FEATURE);
    const ids = (fin?.geometry.nodes ?? []).map((n) => n.id);
    assert.ok(ids.includes('n3'), `B 写的节点必须还在（实际：${ids.join(',')}）`);
    assert.equal(ids.includes('n4'), false, `A 被拒的那一笔不许留下痕迹（实际：${ids.join(',')}）`);
    assert.equal(revOnDisk(file), revAfterB, '被拒的写不许动 rev（拒绝 = 一个字节都不写）');
  });
});

