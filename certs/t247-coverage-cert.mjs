/**
 * T247 出生证：★ **「索引覆盖磁盘了吗」的判据只能有一处** —— 不许拿"后台在跑"当它的代理。
 *
 * ## 它测的是哪一格
 * 同一个问题 —— *"现在能不能把「连不上」判成 `failed`，还是要 `keepUnresolvedPending`"* ——
 * 修复前**两处各持一份判据**：
 * | 处 | 判据 | 口径 |
 * |---|---|---|
 * | `index_freshness`（走查收尾） | `已索引行数 >= 走查到的文件数` | ★ **数据口径（对）** |
 * | `write_gate.ts:239/428/499` · `watch_project.ts:207` · `index_integrity.ts:202` | `isIndexIncomplete(root)` = **后台续建在不在跑** | ★ **进程口径（错的代理）** |
 * ★★ 造出分歧的输入（本证夹具）：**库在（2 行）· 磁盘有 42 个源文件 · 本进程从没起过 backfill**
 *   ⇒ 数据口径说"留 pending"，进程口径说"可以判 failed"
 *   ⇒ ★ 后者**正好制造 `isIndexIncomplete` 自己注释里点名要防的事故**：
 *     把"还没索引到"判成 `failed`，而 `failed` 的边**永不重试** ⇒ 索引**永久缺边**。
 *
 * ## 判据（★ 三条，且**自带反向**）
 * ① **覆盖不全** ⇒ `indexCoversDisk` 必须 **false**（⇒ 站点据此留 pending）—— 这一格修复前会错。
 * ② ★ **全覆盖** ⇒ 必须 **true**（★ 只测①的证是半张：一个 `return false` 的常量也能过①）。
 * ③ **同源**：`indexCovers(a,b)` 与 `indexCoversDisk(db,root)` 在同一输入下必须**一致**
 *    （证"判据只有一处定义"，不是两处各算各的）。
 *
 * ## ★ 消融自证
 * 把 `src/application/write_gate.ts` 里那三处 `!indexCoversDisk(db, root)` 改回
 * `isIndexIncomplete(root)`（旧名 `isBackfillRunning`）⇒ ★ **本证仍会绿**（它测的是判据本身）——
 * ⇒ ★★ **这正是要你知道的**：那一刻"谁在答这个问题"的事实在 **`grep` 里**，
 *    所以本证**额外打印**两者在夹具上的取值（**读得出**），让人一眼看见"它们本该不同"。
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
const disk1 = fs.readdirSync(path.join(P1, 'src')).length;
const cov1 = indexCoversDisk(db1, P1);
chk(cov1 === false, '①-a ★★ 覆盖不全 ⇒ `indexCoversDisk` = **false** ⇒ 站点据此**留 pending**', `实测 = ${cov1}`);
chk(
  indexCovers(2, disk1) === cov1,
  '①-b ★ 同源：`indexCovers(已索引, 磁盘)` 与 `indexCoversDisk(db,root)` **一致**（判据只一处定义）',
  `indexCovers(2,${disk1})=${indexCovers(2, disk1)} · indexCoversDisk=${cov1}`,
);

console.log('\n══ ★ 打印（★ 修复前就是这一格的答案被用错了）');
const old1 = isBackfillRunning(P1);
console.log(`    旧口径 isBackfillRunning(root) = ${old1}  ⇒ keepUnresolvedPending = ${old1}`);
console.log(`    新口径 !indexCoversDisk(db,root) = ${!cov1}  ⇒ keepUnresolvedPending = ${!cov1}`);
console.log(
  old1 === !cov1
    ? '    （两者一致 —— 本夹具没造出分歧；★ 下面 ①-c 会判红）'
    : '    ★★ 两者**不同** ⇒ 旧口径会把"还没索引到"判死（failed 的边永不重试 ⇒ 索引永久缺边）',
);
chk(old1 !== !cov1, '①-c ★ 夹具确实落在"两口径分歧"的输入上（★ 不然本证测不到那一格）');

console.log('\n══ ② ★ 反向：全覆盖（补齐一个文件后）⇒ 必须 **true**');
fs.writeFileSync(path.join(P1, 'src', 'c.ts'), 'export function gamma(): number { return 3; }\n');
await ensureProjectIndex(P1, { bootstrap: true });
const cov2 = indexCoversDisk(db1, P1);
chk(cov2 === true, '②-a ★ 全覆盖 ⇒ `indexCoversDisk` = **true**（不许恒 false ⇒ 那是另一种恒真）', `实测 = ${cov2}`);
chk(indexCovers(1, 1) === true && indexCovers(0, 1) === false, '②-b ★ 判据本体：1>=1 真、0>=1 假（边界可判）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log(
  '★ 消融自证（★ 这一条要看清）：把 `write_gate.ts` 的三处 `!indexCoversDisk(db, root)` 改回旧口径\n' +
    '  ⇒ ★ **本证仍绿**（判据本体没变）—— ★★ 所以"谁在答这个问题"只能靠 **grep** 看：\n' +
    '     `grep -rn "isBackfillRunning" src` ⇒ 应**只剩** `server_registry` 的"在建就跳过保鲜"那一处用法。',
);
console.log(`（工作副本留在 ${SCRATCH} —— 连接池持有 cache.db 句柄，删它会 EBUSY；由系统回收）`);
process.exit(F === 0 ? 0 : 1);
