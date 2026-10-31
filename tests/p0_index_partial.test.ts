/**
 * P1 · **「走了走查、但没走完」必须响亮** —— 由原证 `certs/t246-partial-cert.mjs` 整张迁入。
 *
 * ## 它测的是哪一格
 * 走查有补全上限（`MAX_ADDS_PER_REFRESH = 100`）。超出时 `ensureProjectIndex` 会**如实**回
 * `state:'partial'` + `skipped_adds>0`（它自己的注释："有界 = 诚实 … 绝不假装完整"）——
 * ★ **但保鲜那条路径从来不读这个返回值** ⇒ 于是"库在、但不全"会被**当成完整**继续用
 * = `write_gate.ts` 自己命名的"**比不建更糟**"。
 *
 * ## 判据（二值，且**自带反向**）
 *   ① **超上限**（磁盘比索引多 > 100 个文件）⇒ `ensureStage('symbol_index')` **必须抛**，
 *      且错误里点名"没能补齐"；把它交给 `freshnessRefusedWarning` ⇒ 必须产出
 *      `code:'INDEX_FRESHNESS_REFUSED'` 的结构化告警（走既有 `emitWarnings` 通道）。
 *   ② ★ **未超上限**（只多 1 个文件）⇒ **必须不抛**（否则就是"为少见情形天天吵" ⇒ 噪音）。
 *   ★ 只测①不测②的证是**半张** —— 一个"永远抛"的实现也能过①。
 *
 * ## 原证断言 → 本文件用例（一条不删，6 条）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ①-a 超上限 ⇒ **抛**（不许静默当成完整） | `① 超上限 ⇒ 响亮`（第 1 条 assert） |
 * | ①-b 错误里点名「**没能补齐**」（可读，不是裸错误） | 同上（第 2 条 assert） |
 * | ①-c 转成结构化告警（code + summary + fix 齐） | 同上（第 3 条 assert） |
 * | ②-a ★ 反向：未超上限 ⇒ 必须不抛 | `② 反向：没超上限 ⇒ 不吵`（第 1 条 assert） |
 * | ②-b 且如实说 `produced`（真的走了走查） | 同上（第 2 条 assert） |
 * | ②-c 没有失败 ⇒ 告警必须是 `null`（不许"恒有"⇒ 那是装饰） | 同上（第 3 条 assert） |
 *
 * ## ★ 消融（本文件必须能红 —— 2026-10-31 迁移时实测）
 *   **改哪一行**：`src/application/stage_registry.ts` 里 `symbol_index.produce` 的
 *   `if (idx.state === 'partial') { throw … }` 整段（第 198-204 行）整段注释掉。
 *   · **红读数**：`用例 1/2 失败` · exit 1 —— `①` 红，实测 `①-b` 收到的错误串是
 *     `①-a ★★ 超上限必须**抛**…它没抛，返回了 {"id":"symbol_index","action":"produced"}`
 *     （= 半成品被当成完整，正是本证要抓的那一格）；`②`（反向）仍绿 ⇒ 反向控制没被连带。
 *   · **还原后**（`git diff` 里该文件消失 = 逐字节相同）⇒ **用例 2/2 · 6 条断言全绿** · exit 0。
 *
 * ## 诚实边界（与原证一致）
 *   · 上限值（100）**不抄进断言**：本文件靠"多 150 个"与"多 1 个"**跨过**它，而不是断言它等于 100
 *     （阈值若变了，夹具仍成立；★ 抄一个数字进判据就是本仓已判过的坏判据形态）；
 *   · 只用**临时目录**（`makeTempHome()`）+ 临时 `AGENT_IO_HOME`；仓内 scratch 一律不碰；
 *   · 不证明告警真的被打印到 MCP 回执（那一段由 `invokeTool` 的通道负责，本文件只判**转换函数**产出）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ensureProjectIndex } from '../src/infrastructure/index/index_freshness.js';
import { ensureStage } from '../src/application/stage_registry.js';
// ★ 告警转换函数住在这里（与写端同源）—— 本文件只调它，不另造一份"什么算告警"的口径
import { freshnessRefusedWarning } from '../src/presentation/mcp/server_registry.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
after(() => rmRf(TMP));

/** 造一个只有 2 个源文件、索引已建好的项目（夹具与两种"超/未超"由调用方补文件） */
async function makeIndexed(name: string): Promise<string> {
  const proj = path.join(TMP, name);
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export function alpha(): number { return 1; }\n');
  fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'export function beta(): number { return 2; }\n');
  await ensureProjectIndex(proj, { bootstrap: true });
  return proj;
}

test('① 超上限（磁盘比索引多 150 个）⇒ 必须抛 · 点名「没能补齐」· 转成结构化告警', async () => {
  const proj = await makeIndexed('big');
  for (let i = 0; i < 150; i++) {
    fs.writeFileSync(path.join(proj, 'src', `extra${i}.ts`), `export function e${i}(): number { return ${i}; }\n`);
  }
  let err = '';
  try {
    const r = await ensureStage('symbol_index', { projectRoot: proj });
    err = '';
    assert.fail(`①-a ★★ 超上限必须**抛**（不许静默当成完整）—— 它没抛，返回了 ${JSON.stringify(r)}`);
  } catch (e) {
    // ★ `assert.fail` 也走这里 ⇒ 用它自己的消息（否则会误报成"抛了但是别的原因"）
    err = e instanceof Error ? e.message : String(e);
  }
  assert.match(err, /没能补齐/, `①-b ★ 错误里必须点名「没能补齐」（可读，不是裸错误）：${err.split('\n')[0].slice(0, 130)}`);

  const w = freshnessRefusedWarning(err, proj);
  assert.equal(w?.code, 'INDEX_FRESHNESS_REFUSED', `①-c ★ 必须转成结构化告警（code=INDEX_FRESHNESS_REFUSED + fix）：实测 ${w ? JSON.stringify({ code: w.code, fix: String(w.fix).slice(0, 50) }) : 'null'}`);
  assert.ok(w && typeof w.fix === 'string' && w.fix.length > 0, '①-c 告警必须带 fix（只说"失败了"没有出路）');
});

test('② ★ 反向：未超上限（只多 1 个文件）⇒ 必须不抛 · 如实说 produced · 无告警', async () => {
  const proj = await makeIndexed('small');
  fs.writeFileSync(path.join(proj, 'src', 'c.ts'), 'export function gamma(): number { return 3; }\n');
  let err = '';
  let action = '';
  try {
    const r = await ensureStage('symbol_index', { projectRoot: proj });
    action = String((r as unknown as { action?: string }).action);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert.equal(err, '', `②-a ★ 未超上限必须**不抛**（否则天天吵）：${err.split('\n')[0].slice(0, 130)}`);
  assert.equal(action, 'produced', `②-b ★ 且如实说 produced（真的走了走查）：实测 action=${action}`);
  assert.equal(freshnessRefusedWarning('', proj), null, '②-c ★ 没有失败 ⇒ 告警必须是 null（不许"恒有"⇒ 那是装饰）');
});
