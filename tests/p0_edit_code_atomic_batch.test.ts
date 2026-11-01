/**
 * P0 · `edit_code` 的 `targets[] + atomic:true` 必须是**真·原子**（第二轮外审 P0-1）
 *
 * ## 它挡的事故（外审已实测复现）
 * `atomic` 原来只作用于**预检**（`blockedByAtomic`）。真正的落盘循环是裸
 * `for (…) batchTxn.commit(…)` —— 无 try/catch、无回滚，`close()` 写在循环之后。于是第 N 个文件抛错时：
 * ① 前 N-1 个**已落盘** ② 自写登记 / 索引写穿**一份没做** ③ **异常直接上抛，连回执都没有**。
 * 触发条件很日常（Windows 上文件被 IDE / 杀软占用、磁盘满、只读）。
 *
 * ## 本文件的两条断言（缺一条就等于没验）
 * ① **失败路径**：第 2 个文件写失败 ⇒ `a/b/c` **逐字节等于改动前**、回执 `ok:false / rolled_back:true /
 *    applied:[]`、`landed` 只列真正落过盘的、`failed_at` 点名、**一条自写都不登记**（完整回滚 ⇒ 索引没变）。
 * ② **成功路径**：三条都写成功 ⇒ `ok:true / rolled_back:false / applied` 长度 3、文件都变了、
 *    自写登记照常跑（证明回滚逻辑没把正常路径搞坏）。
 *
 * ## 注入方式（为什么用 monkeypatch 而不是"把文件设成只读/占用"）
 * 真实 IO 故障（只读属性 / 独占句柄）**同时会挡住回滚**（还原那一份也要写同一个文件）⇒
 * 那样验出来的只会是"回滚不全"，验不到"整批回滚"这条主线。故这里 patch 的是**唯一写原语**
 * （`source_writer#commit` 里的 `fs.writeFileSync`），只对 `src/b.ts` 抛 —— 抛点与真实磁盘错误
 * **同一条路径**（`commit` → 抛 → 落盘循环接住），且不影响 `rollbackFileSnapshot`（它走 `copyFileSync`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ★ 临时夹具项目里没有重写画布（`plan/<rel>.plan.json`）—— 本文件验的是**落盘阶段**的原子性，不是画布闸。
//   写闸自己把这一档列为"测试用"（`write_gate.ts#planStrictMode`：「测试与批量迁移用它」）。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const { editCode } = await import('../src/application/refactor/edit/edit_code.js');
const { pendingSelfWrites } = await import('../src/infrastructure/index/self_writes.js');

const NAMES = ['a', 'b', 'c'] as const;
const original = (n: string): string => `export const TOKEN_${n.toUpperCase()} = 'OLD';\n`;
const edited = (n: string): string => `export const TOKEN_${n.toUpperCase()} = 'NEW';\n`;

/** 造一个三文件夹具项目（**不**建 `.agent-io/` —— 闸按"本项目不用任务系统"放行） */
function mkProject(): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-edit-code-atomic-'));
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  for (const n of NAMES) fs.writeFileSync(path.join(proj, 'src', `${n}.ts`), original(n), 'utf8');
  return proj;
}

/** 逐文件读回原始字节（"逐字节相等"的判据只用它，不看 mtime） */
function bytesOf(proj: string): Record<string, string> {
  return Object.fromEntries(NAMES.map((n) => [n, fs.readFileSync(path.join(proj, 'src', `${n}.ts`), 'utf8')]));
}

function targets(): Array<{ file: string; old_text: string; new_text: string }> {
  return NAMES.map((n) => ({
    file: `src/${n}.ts`,
    old_text: `TOKEN_${n.toUpperCase()} = 'OLD'`,
    new_text: `TOKEN_${n.toUpperCase()} = 'NEW'`,
  }));
}

/**
 * 只对 `b.ts` 注入写失败（patch `fs.writeFileSync`；`fs` 的默认导出是 CJS 那个可变对象 ⇒ 所有 importer 同一份）。
 * @returns 还原函数（必须 `finally` 里调，否则会把后面的用例一起弄坏）
 */
function injectWriteFailureOnce(bAbs: string, code: string): { hits: () => number; restore: () => void } {
  const orig = fs.writeFileSync;
  let hits = 0;
  Object.defineProperty(fs, 'writeFileSync', {
    configurable: true,
    writable: true,
    value: function patched(p: unknown, ...rest: unknown[]): unknown {
      if (typeof p === 'string' && path.resolve(p) === path.resolve(bAbs)) {
        hits++;
        throw new Error(code);
      }
      return (orig as unknown as (...a: unknown[]) => unknown)(p, ...rest);
    },
  });
  return {
    hits: () => hits,
    restore: () => Object.defineProperty(fs, 'writeFileSync', { configurable: true, writable: true, value: orig }),
  };
}

test('① 落盘失败（第 2 个文件）：整批回滚到改动前 + 结构化回执，不裸抛、不登记假自写', async () => {
  const proj = mkProject();
  try {
    const before = bytesOf(proj);
    const inject = injectWriteFailureOnce(path.join(proj, 'src', 'b.ts'), 'INJECTED-EWRITE');
    let res: Awaited<ReturnType<typeof editCode>> | undefined;
    let threw: string | undefined;
    try {
      res = await editCode({ project_dir: proj, actor: 'subagent:atomic-batch', atomic: true, targets: targets() });
    } catch (e) {
      threw = (e as Error).message;
    } finally {
      inject.restore();
    }

    // ★ 改前的形态：这里抛异常、`res === undefined`（`receipt = null`）；注入确实命中了第 2 个文件
    assert.equal(inject.hits(), 1, '注入没命中 b.ts ⇒ 这条用例什么也没验');
    assert.equal(threw, undefined, `落盘失败**不许裸抛**（改前就是在这里抛的）：${threw}`);
    assert.ok(res, '必须有结构化回执（改前连回执都没有）');

    const d = res.data;
    // ── 回执的结构化读数（两种"没生效"必须能分开） ──
    assert.equal(d.ok, false, '落盘失败 + 整批回滚 ⇒ ok 必须是 false（改前压根没有回执）');
    assert.equal(d.written, false, '整批回滚后磁盘没变 ⇒ written 必须是 false');
    assert.equal(d.rolled_back, true, 'rolled_back 必须明说"已整批回滚"');
    assert.deepEqual(d.applied, [], '完整回滚 ⇒ 一个改动都没留下');
    assert.deepEqual(d.landed, ['src/a.ts'], '只有 a.ts 真落过盘（b 抛错即停，c 没轮到）');
    assert.equal(d.failed_at, 'src/b.ts', '必须点名在哪个文件失败');
    assert.ok(d.rollback, '必须有回滚读数（ok/message/restored/removed/failed）');
    assert.equal(d.rollback.ok, true, `回滚必须成功：${d.rollback.message}`);
    assert.deepEqual([...d.rollback.restored].sort(), ['src/a.ts', 'src/b.ts', 'src/c.ts'], '三份都要回写（整批一份快照）');
    assert.deepEqual(d.rollback.failed, [], '不许有"未能还原"的文件');

    // ── 磁盘：逐字节等于改动前（这才是"真回滚"的判据） ──
    assert.deepEqual(bytesOf(proj), before, '回滚后必须逐字节等于改动前（a 已改就是半写）');

    // ── 自写登记：完整回滚 ⇒ **一条都不许登记**（登记了就是"索引说变了、实际没变"的假读数） ──
    assert.deepEqual(pendingSelfWrites(proj), [], '完整回滚后不许留下任何自写登记');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('② 成功路径：三条都写成功 ⇒ ok:true / rolled_back:false / applied 三个，且自写登记照常跑', async () => {
  const proj = mkProject();
  try {
    const res = await editCode({ project_dir: proj, actor: 'subagent:atomic-batch', atomic: true, targets: targets() });
    const d = res.data;

    assert.equal(d.ok, true);
    assert.equal(d.written, true);
    assert.equal(d.rolled_back, false, '没发生回滚 ⇒ false（与"回滚成功"的 true 必须分开）');
    assert.deepEqual(d.applied, ['src/a.ts', 'src/b.ts', 'src/c.ts'], '三个文件都真留在盘上');
    assert.equal(d.failed_at, undefined, '成功时不该有 failed_at');
    assert.equal(d.landed, undefined, 'landed 只在落盘中途失败时出现');
    assert.equal(d.rollback, undefined, '成功时不该有回滚读数');
    assert.equal(d.close_error, undefined, '收尾没失败');

    // 文件都变了（回滚逻辑没把正常路径搞坏）
    for (const n of NAMES) assert.equal(fs.readFileSync(path.join(proj, 'src', `${n}.ts`), 'utf8'), edited(n));

    // `close()` 照常跑：自写登记里有这三个文件（回滚逻辑不许把正常收尾一起吞掉）
    assert.deepEqual([...pendingSelfWrites(proj)].sort(), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});
