/**
 * T247 出生证：★ **「索引覆盖磁盘了吗」的判据只能有一处**，且**必须是集合口径**。
 *
 * ## 它测的是哪一格
 * 同一个问题 —— *"现在能不能把「连不上」判成 `failed`，还是要 `keepUnresolvedPending`"* ——
 * 修复前**两处各持一份判据**：
 * | 处 | 判据 | 口径 |
 * |---|---|---|
 * | `index_freshness`（走查收尾） | `已索引 ⊇ 走查到的` | ★ **数据口径（对）** |
 * | `write_gate.ts:239/428/499` · `watch_project.ts:207` · `index_integrity.ts:202` | `isIndexIncomplete(root)` = **后台续建在不在跑** | ★ **进程口径（错的代理）** |
 * ★★ 造出分歧的输入（本证 ①）：**库在（2 行）· 磁盘 42 个源文件 · 本进程从没起过 backfill**
 *   ⇒ 数据口径说"留 pending"，进程口径说"可以判 failed"
 *   ⇒ ★ 后者**正好制造 `isIndexIncomplete` 自己注释里点名要防的事故**：
 *     把"还没索引到"判成 `failed`，而 `failed` 的边**永不重试** ⇒ 索引**永久缺边**。
 *
 * ## ★★★ 本证 ② 测的是**外部复核抓出的那一格**：计数口径会被"数相等但集合不等"骗过
 * `files` 表可以装着**走查宇宙之外**的文件（我们编辑过一个 `*.test.ts` ——
 * `walkFiles` 的 `includeTests=false` 不列它，而写路径照样把它同步进索引）
 * ⇒ ★ 多出来的行会把**计数**顶上去，于是在"真源文件还没索引到"时判出"覆盖了" ⇒ 又回到判死。
 * ⇒ 夹具（②）：磁盘 4 个真源文件 · 库里只索引了 1 个 · 再塞 3 个 `.test.ts` ⇒
 *   `files` 行数 = 4 **≥** 真源数 4（**计数口径会说"覆盖了"**），而**集合口径说没有**。
 *
 * ## 判据（★ 四条，且**自带反向**）
 * ① 覆盖不全 ⇒ `indexCoversDisk` **false**；② 全覆盖 ⇒ **true**（只测①的证是半张）；
 * ③ 判据本体的**方向性**：多余的键**不影响**覆盖（集合口径与计数口径的差别正在这）；
 * ④ 夹具确实落在"两口径分歧"的输入上（不然本证测不到那一格）。
 *
 * ## ★ 消融自证（★ 这条要说清）
 * 把 `write_gate.ts` 的三处 `!indexCoversDisk(db, root)` 改回 `isBackfillRunning(root)`
 * ⇒ ★ **本证仍会绿**（它测的是判据本体，不是站点）。⇒ 所以"**谁在答这个问题**"这件事
 *   **只能靠 `grep` 看**：`grep -rn "isBackfillRunning" src` 应只剩 `server_registry` 的一处用法。
 * ★★ 反过来，把 `indexCovers` 改回 `a >= b`（计数口径）⇒ ★ **②-a 必须变红**（那才是真消融）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const REPO = path.resolve(dir, '..');
const dist = (p) => pathToFileURL(path.join(REPO, 'dist', 'src', p)).href;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t247-'));
const { ensureProjectIndex, indexCovers, indexCoversDisk } = await import(
  dist('infrastructure/index/index_freshness.js')
);
const { isBackfillRunning } = await import(dist('infrastructure/index/index_backfill.js'));
const { getProjectCacheDb } = await import(dist('infrastructure/index/db.js'));
const { syncFile } = await import(dist('infrastructure/index/symbols.js'));

const mk = (name) => {
  const proj = path.join(SCRATCH, name);
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export function alpha(): number { return 1; }\n');
  fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'export function beta(): number { return 2; }\n');
  return proj;
};

console.log('══ ① 覆盖不全：库在（2 行）· 磁盘 42 个文件 · 本进程从没起过 backfill');
const P1 = mk('gap');
await ensureProjectIndex(P1, { bootstrap: true });
for (let i = 0; i < 40; i++) {
  fs.writeFileSync(path.join(P1, 'src', `n${i}.ts`), `export function f${i}(): number { return ${i}; }\n`);
}
const db1 = getProjectCacheDb(P1);
const cov1 = indexCoversDisk(db1, P1);
chk(cov1 === false, '①-a ★★ 覆盖不全 ⇒ `indexCoversDisk` = **false**（⇒ 站点据此**留 pending**）', `实测 = ${cov1}`);

console.log('\n══ ② ★★★ 集合口径 vs 计数口径（外部复核抓出的那一格）');
const P2 = path.join(SCRATCH, 'countset');
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
const counted = db2.prepare('SELECT COUNT(*) AS c FROM files').get().c;
const diskCount = fs.readdirSync(path.join(P2, 'src')).filter((f) => !/\.test\.ts$/.test(f)).length;
const cov2 = indexCoversDisk(db2, P2);
console.log(`     夹具：真源文件 ${diskCount} 个 · 库里索引了 1 个真源 + 3 个 .test.ts ⇒ files 行数 = ${counted}`);
chk(
  counted >= diskCount,
  '②-0 ★ 夹具成立：`files` 行数 >= 真源数 ⇒ **计数口径会判"覆盖了"**',
  `files=${counted} · 真源=${diskCount}`,
);
chk(cov2 === false, '②-a ★★★ 集合口径判 **false**（3 个真源文件还没索引）—— ★ 计数口径会判 true ⇒ 判死', `实测 = ${cov2}`);

console.log('\n══ ③ 判据本体（方向性）');
chk(indexCovers(new Set(['a']), ['a']) === true, '③-a 全覆盖 ⇒ true');
chk(indexCovers(new Set(['a']), ['a', 'b']) === false, '③-b 缺一个 ⇒ false');
chk(indexCovers(new Set(['a', 'b', 'z']), ['a', 'b']) === true, '③-c ★ **多余的键不影响覆盖**（集合口径与计数口径的差别正在这里）');

console.log('\n══ ★ 打印（★ 修复前就是这一格的答案被用错了）');
console.log(`    旧口径 isBackfillRunning(root) = ${isBackfillRunning(P1)}  ⇒ keepUnresolvedPending = ${isBackfillRunning(P1)}`);
console.log(`    新口径 !indexCoversDisk(db,root) = ${!cov1}  ⇒ keepUnresolvedPending = ${!cov1}`);
chk(
  isBackfillRunning(P1) !== !cov1,
  '④ ★ 夹具确实落在"两口径分歧"的输入上（★ 不然本证测不到那一格）',
  `旧=${isBackfillRunning(P1)} · 新=${!cov1}`,
);

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log(
  '★ 消融自证：★ 把 `indexCovers` 改回计数口径（`a >= b`）⇒ ★ **②-a 必须变红**；\n' +
    '  ★ 而把**站点**改回 `isBackfillRunning` ⇒ ★ 本证**仍绿**（它测的是判据本体）\n' +
    '  ⇒ ★★ "谁在答这个问题"只能靠 grep：`grep -rn "isBackfillRunning" src` 应只剩 server_registry 一处用法。',
);
console.log(`（工作副本留在 ${SCRATCH} —— 连接池持有 cache.db 句柄，删它会 EBUSY；由系统回收）`);
process.exit(F === 0 ? 0 : 1);
