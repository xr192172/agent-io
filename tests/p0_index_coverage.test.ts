/**
 * P1 · **「索引覆盖磁盘了吗」的判据只有一处，且必须是集合口径** ——
 * 由原证 `certs/t247-coverage-cert.mjs` 整张迁入。
 *
 * ## 它测的是哪一格
 * 同一个问题 —— *"现在能不能把「连不上」判成 `failed`，还是要 `keepUnresolvedPending`"* ——
 * 修复前**两处各持一份判据**：
 * | 处 | 判据 | 口径 |
 * |---|---|---|
 * | `index_freshness`（走查收尾） | `已索引 ⊇ 走查到的` | ★ **数据口径（对）** |
 * | `write_gate.ts` · `watch_project.ts` · `index_integrity.ts` | `isIndexIncomplete(root)` = **后台续建在不在跑** | ★ **进程口径（错的代理）** |
 * ★★ 造出分歧的输入（①）：**库在（2 行）· 磁盘 42 个源文件 · 本进程从没起过 backfill**
 *   ⇒ 数据口径说"留 pending"，进程口径说"可以判 failed"
 *   ⇒ ★ 后者**正好制造 `isIndexIncomplete` 自己注释里点名要防的事故**：
 *     把"还没索引到"判成 `failed`，而 `failed` 的边**永不重试** ⇒ 索引**永久缺边**。
 *
 * ## ★★★ ② 测的是**外部复核抓出的那一格**：计数口径会被"数相等但集合不等"骗过
 * `files` 表可以装着**走查宇宙之外**的文件（我们编辑过一个 `*.test.ts` ——
 * `walkFiles` 的 `includeTests=false` 不列它，而写路径照样把它同步进索引）
 * ⇒ ★ 多出来的行会把**计数**顶上去，于是在"真源文件还没索引到"时判出"覆盖了" ⇒ 又回到判死。
 *
 * ## 原证断言 → 本文件用例（一条不删，7 条）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ①-a 覆盖不全 ⇒ `indexCoversDisk` = **false** | `① 覆盖不全` |
 * | ②-0 夹具成立：`files` 行数 >= 真源数（计数口径会判"覆盖了"） | `② 集合口径 vs 计数口径`（第 1 条 assert） |
 * | ②-a ★★★ 集合口径判 **false** | 同上（第 2 条 assert） |
 * | ③-a 全覆盖 ⇒ true · ③-b 缺一个 ⇒ false · ③-c 多余的键不影响覆盖 | `③ 判据本体（方向性）`（3 条 assert） |
 * | ④ 夹具确实落在"两口径分歧"的输入上 | `④ 夹具落在分歧点上` |
 *
 * ## ★ 消融（必须用真消融 —— 本证的价值就在"能抓到真错"；2026-10-31 迁移时实测）
 *   **改哪一行**：`src/infrastructure/index/index_freshness.ts` 的 `indexCovers`（第 533-535 行）
 *   从集合口径改成**计数口径**：
 *   ```ts
 *   export function indexCovers(coveredRel, diskRel) { return coveredRel.size >= diskRel.length; }
 *   ```
 *   ⇒ **红读数**：`②` 用例红（`②-a` 集合口径本该 false，计数口径给了 true —— 正是"判死"那一格；
 *      `files=4 · 真源=4` 两个数相等）· `用例 1/4 失败` · exit 非 0。
 *   **还原后**（`git diff` 为空）⇒ **4/4 用例 · 7 条断言全绿** · exit 0。
 *   ★ 反过来把**站点**改回 `isBackfillRunning` ⇒ 本证**仍绿**（它测的是判据本体，不是站点）
 *     ⇒ ★★ "谁在答这个问题"只能靠 grep：`grep -rn "isBackfillRunning" src` 应只剩
 *     `server_registry` 一处用法。
 *
 * ## 诚实边界（与原证一致）
 *   · 只用**临时目录**夹具 + 临时 `AGENT_IO_HOME`；
 *   · `*.test.ts` 这一路的"把走查宇宙外的文件塞进索引"用的是**写路径真行为**（`syncFile`），
 *     不是手改 sqlite 行 —— 否则夹具就成了"我自己造的假输入"；
 *   · 不证明 `failed` 边真的永不重试（那是 `resolve` 链的语义，本证只守"判据是哪一把尺"）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ensureProjectIndex, indexCovers, indexCoversDisk } from '../src/infrastructure/index/index_freshness.js';
import { isBackfillRunning } from '../src/infrastructure/index/index_backfill.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { syncFile } from '../src/infrastructure/index/symbols.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
after(() => rmRf(TMP));

function mk(name: string): string {
  const proj = path.join(TMP, name);
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export function alpha(): number { return 1; }\n');
  fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'export function beta(): number { return 2; }\n');
  return proj;
}

/** ① 的读数在 ④ 里还要用（"两口径分歧"这条判据的输入必须是**同一份**夹具） */
let cov1: boolean | null = null;
let P1 = '';

test('① 覆盖不全：库在（2 行）· 磁盘 42 个文件 · 本进程从没起过 backfill', async () => {
  P1 = mk('gap');
  await ensureProjectIndex(P1, { bootstrap: true });
  for (let i = 0; i < 40; i++) {
    fs.writeFileSync(path.join(P1, 'src', `n${i}.ts`), `export function f${i}(): number { return ${i}; }\n`);
  }
  cov1 = indexCoversDisk(getProjectCacheDb(P1), P1);
  assert.equal(cov1, false, `①-a ★★ 覆盖不全 ⇒ \`indexCoversDisk\` 必须是 **false**（站点据此**留 pending**）：实测 = ${String(cov1)}`);
});

test('② ★★★ 集合口径 vs 计数口径（外部复核抓出的那一格）', async () => {
  const P2 = path.join(TMP, 'countset');
  fs.mkdirSync(path.join(P2, 'src'), { recursive: true });
  fs.writeFileSync(path.join(P2, 'src', 'real0.ts'), 'export function r0(): number { return 0; }\n');
  await ensureProjectIndex(P2, { bootstrap: true }); // 此刻磁盘只有 real0 ⇒ 索引 = 1
  for (const n of ['real1', 'real2', 'real3']) {
    fs.writeFileSync(path.join(P2, 'src', `${n}.ts`), `export function ${n}(): number { return 1; }\n`);
  }
  const db2 = getProjectCacheDb(P2);
  for (const n of ['t1', 't2', 't3']) {
    const abs = path.join(P2, 'src', `${n}.test.ts`);
    fs.writeFileSync(abs, `export function ${n}(): number { return 9; }\n`);
    await syncFile(db2, P2, abs); // ★ 写路径照样把它同步进索引；而 walkFiles 不列它
  }
  const counted = Number((db2.prepare('SELECT COUNT(*) AS c FROM files').get() as { c: number }).c);
  const diskCount = fs.readdirSync(path.join(P2, 'src')).filter((f) => !/\.test\.ts$/.test(f)).length;
  const cov2 = indexCoversDisk(db2, P2);

  assert.ok(
    counted >= diskCount,
    `②-0 ★ 夹具必须成立：\`files\` 行数 >= 真源数 ⇒ **计数口径会判"覆盖了"**：files=${counted} · 真源=${diskCount}`,
  );
  assert.equal(
    cov2,
    false,
    `②-a ★★★ 集合口径必须判 **false**（3 个真源文件还没索引）—— ★ 计数口径会判 true ⇒ 把"还没索引到"判死：` +
      `实测 = ${String(cov2)}（files=${counted} · 真源=${diskCount}）`,
  );
});

test('③ 判据本体（方向性）：全覆盖 true · 缺一个 false · 多余的键不影响覆盖', async () => {
  assert.equal(indexCovers(new Set(['a']), ['a']), true, '③-a 全覆盖 ⇒ true');
  assert.equal(indexCovers(new Set(['a']), ['a', 'b']), false, '③-b 缺一个 ⇒ false');
  assert.equal(
    indexCovers(new Set(['a', 'b', 'z']), ['a', 'b']),
    true,
    '③-c ★ 多余的键**不影响**覆盖（集合口径与计数口径的差别正在这里）',
  );
});

test('④ 夹具确实落在"两口径分歧"的输入上（不然本证测不到那一格）', async () => {
  assert.notEqual(cov1, null, '④ 前置：① 必须先跑过（同一个进程内顺序执行）');
  const oldWay = isBackfillRunning(P1);
  assert.notEqual(
    oldWay,
    !cov1,
    `④ ★ 夹具必须落在两口径**分歧**的输入上：旧口径 isBackfillRunning=${oldWay} · 新口径 !indexCoversDisk=${!cov1}`,
  );
  console.log(
    `    旧口径 isBackfillRunning(root) = ${oldWay}  ⇒ keepUnresolvedPending = ${oldWay}\n` +
      `    新口径 !indexCoversDisk(db,root) = ${!cov1}  ⇒ keepUnresolvedPending = ${!cov1}\n` +
      '    ★ 上一行两个值必须**不同** —— 这才说明"谁在答这个问题"换了尺',
  );
});
