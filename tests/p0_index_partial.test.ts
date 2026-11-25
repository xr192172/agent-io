/**
 * P1 · **「走了走查、但没走完」必须响亮** + **#188 脱节态全量 backfill 不漏**。
 *
 * ## 它测的是哪一格
 * 保鲜分两条路径（2026-11-26 · #188 根治后）：
 *   · **常态**（索引已覆盖磁盘，仅既有文件改动）：增量新增仍守 `MAX_ADDS_PER_REFRESH=100` 上限，
 *     超上限 ⇒ `state:'partial'` + `skipped_adds>0`，由 stage_registry 抛 `INDEX_FRESHNESS_REFUSED`。
 *   · **脱节态**（`indexCoversDisk=false`：库内集合 ⊉ 磁盘走查集合，索引基线失效）：
 *     新增走**全量 backfill**，**不受** 100 上限截断 —— 旧实现脱节仍按 100 砍，scripts/ 落在
 *     截断外 ⇒ call-exists 查无行，正是 #188 偶发 unsupported 的根因。
 *
 * ## 判据（二值，且**自带反向**）
 *   ① **脱节态 >100 新增** ⇒ 全量补全，**不漏**：所有 extra 都进 `files` 表，`backfilled=true`，
 *      `state='ready'`，`skipped_adds=0`（旧实现这里会全 skip、留 partial）。
 *   ② ★ **反向：未超上限**（只多 1 个文件）⇒ 不抛 produced（否则就是"为少见情形天天吵" ⇒ 噪音）。
 *   ③ **冷启截断仍响亮**：bootstrap 撞上 `maxFiles` 上限 ⇒ `state='partial'` + `truncated=true`，
 *      抛错转换出 `INDEX_FRESHNESS_REFUSED`（护栏不随 #188 改动被拆掉）。
 *
 * ## 诚实边界
 *   · 上限值（100 / maxFiles）**不抄进断言**：靠"多 150"与"多 1"跨过它；
 *   · 只用**临时目录**（`makeTempHome()`）+ 临时 `AGENT_IO_HOME`；仓内 scratch 一律不碰。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ensureProjectIndex } from '../src/infrastructure/index/index_freshness.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { ensureStage } from '../src/application/stage_registry.js';
import { freshnessRefusedWarning } from '../src/presentation/mcp/server_registry.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
after(() => rmRf(TMP));

/** 造一个只有 2 个源文件、索引已建好的项目（夹具与"脱节增量"由调用方补文件） */
async function makeIndexed(name: string): Promise<string> {
  const proj = path.join(TMP, name);
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export function alpha(): number { return 1; }\n');
  fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'export function beta(): number { return 2; }\n');
  await ensureProjectIndex(proj, { bootstrap: true });
  return proj;
}

test('① 脱节态（磁盘比索引多 150 个）⇒ 全量 backfill 不漏 · backfilled=true · ready', async () => {
  const proj = await makeIndexed('disjoint');
  for (let i = 0; i < 150; i++) {
    fs.writeFileSync(path.join(proj, 'src', `extra${i}.ts`), `export function e${i}(): number { return ${i}; }\n`);
  }
  const r = await ensureProjectIndex(proj, { bootstrap: true });
  const rep = r.report;

  // ★ #188：脱节态不受 100 截断，150 个新增必须全部收录
  const db = getProjectCacheDb(proj);
  const files = (db.prepare('SELECT path FROM files').all() as Array<{ path: string }>).map((x) => x.path);
  const extraInIndex = files.filter((f) => f.startsWith('src/extra')).length;
  assert.equal(rep.backfilled, true, `① ★ 脱节态必须标 backfilled=true：实测 ${JSON.stringify({ backfilled: rep.backfilled, skipped: rep.skipped_adds, state: rep.state })}`);
  assert.equal(rep.skipped_adds, 0, `① ★ 脱节态不得跳过新增：skipped_adds=${rep.skipped_adds}`);
  assert.equal(rep.state, 'ready', `① ★ 全量补齐后必须 ready（不留 partial）：state=${rep.state}`);
  assert.equal(extraInIndex, 150, `① ★ 150 个 extra 必须全部进索引：实测 ${extraInIndex}/150`);
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

test('③ 冷启撞 maxFiles 截断 ⇒ state=partial/truncated · 抛错转结构化告警（护栏保留）', async () => {
  const proj = path.join(TMP, 'truncated');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(proj, 'src', `t${i}.ts`), `export function t${i}(): number { return ${i}; }\n`);
  }
  // 冷启硬上限压到 2 ⇒ 5 个走查文件被截断，必须诚实标 partial/truncated
  const r = await ensureProjectIndex(proj, { bootstrap: true, maxFiles: 2 });
  assert.equal(r.report.state, 'partial', `③-a ★ 撞上限必须 partial（不假装完整）：state=${r.report.state}`);
  assert.equal(r.report.truncated, true, `③-b ★ truncated=true：实测 truncated=${r.report.truncated}`);

  // 抛错闸（stage_registry）收到 partial ⇒ 错误点名「没能补齐」；告警转换出 code+fix
  const msg = `工序 symbol_index：索引本轮**没能补齐**（超补全上限、跳过新增 ${r.report.skipped_adds} 个文件）`;
  const w = freshnessRefusedWarning(msg, proj);
  assert.equal(w?.code, 'INDEX_FRESHNESS_REFUSED', `③-c ★ 必须转结构化告警：实测 ${w ? w.code : 'null'}`);
  assert.ok(w && typeof w.fix === 'string' && w.fix.length > 0, '③-c 告警必须带 fix（只说"失败了"没有出路）');
});
