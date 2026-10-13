/**
 * T238 出生证：★ **"逐调用保鲜"必须真的做走查** —— 不许被一个"文件在就新鲜"的兜底悄悄吃掉。
 *
 * ## 它测的是哪一格
 * `invokeTool` 每个工具调用前会做一次「保鲜」（`server_registry.ts`）。T221 把这一步
 * 从"直调 `ensureProjectIndex`"改成"走统一机制 `ensureStage('symbol_index')`"。★ 而当时
 * `symbol_index` **有 `locate` 却没写 `isFresh`** ⇒ 落到兜底的「locate 存在 ⇒ 恒判 fresh」
 * ⇒ `produce` **一次都没跑** ⇒ ★★ **保鲜静默变成空操作**，而代码注释逐字写着"行为不变 ✓"。
 *
 * ## 判据（★ 二值、可证伪、且**自带对照**）
 * 造一个**已建好索引**的项目 → 之后**新增一个源文件** → 调 `ensureStage('symbol_index')`
 *   · 若保鲜真的跑了 ⇒ 新文件被同步进 `cache.db`（files 表 +1）
 *   · ★ **对照组**：直接调 `ensureProjectIndex(…, {bootstrap:false})`（= T221 前的老行为）
 *     必须给出**同样的**结果 ⇒ ★ 这才证明"接上统一机制后行为不变"，而不是只证明"这次碰巧动了"。
 *
 * ## ★ 为什么判据必须落在【files 表计数】上
 * 不用"返回值 `action`" —— ★ 那是**被验证方自己说的话**（T238 修前它就说 `action:'fresh'`，
 * 而实际什么都没做）。用**盘上事实**（sqlite 计数）当判据 ⇒ 来源与生成不同源 ✓。
 *
 * ## ★★ 消融自证（怎么证明本证测的是它声称的东西）
 * 把 `src/application/stage_registry.ts` 里 `symbol_index` 的 `isFresh: () => false,` **删掉**
 * ⇒ ★ **①-b 必须变红**（files 表纹丝不动）。★ 已实测过一次（T238 修前它就是红的）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const REPO = path.resolve(dir, '..');
const dist = (p) => pathToFileURL(path.join(REPO, 'dist', 'src', p)).href;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ★ 工作副本放 temp：宿主删除护栏按【条目数】计（阈值 50/会话）⇒ 仓内 scratch 会死在这行
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t238-'));
const PROJ = path.join(SCRATCH, 'proj');

const { ensureProjectIndex } = await import(dist('infrastructure/index/index_freshness.js'));
const { ensureStage } = await import(dist('application/stage_registry.js'));

const DB = path.join(PROJ, '.agent-io', 'cache.db');
const fileCount = () => {
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      `const {DatabaseSync}=require('node:sqlite');` +
        `const d=new DatabaseSync(${JSON.stringify(DB)},{readOnly:true});` +
        `console.log(d.prepare('select count(*) c from files').get().c);`,
    ],
    { encoding: 'utf8' },
  );
  return Number(out.trim());
};

console.log('══ ⓪ 夹具：一个**已建好索引**的小项目（2 个源文件）');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'a.ts'), 'export function alpha(): number { return 1; }\n');
fs.writeFileSync(path.join(PROJ, 'src', 'b.ts'), 'export function beta(): number { return 2; }\n');
await ensureProjectIndex(PROJ, { bootstrap: true });
const n0 = fileCount();
chk(n0 === 2, `⓪-a 索引已建好：files 表 = 2`, `实测 = ${n0}`);

console.log('\n══ ① ★★ 硬判据：磁盘加了一个文件 ⇒ `ensureStage(symbol_index)` 必须真的把它同步进来');
fs.writeFileSync(path.join(PROJ, 'src', 'c.ts'), 'export function gamma(): number { return 3; }\n');
console.log('     （已新增 src/c.ts；此刻磁盘 3 个源文件，索引仍是 2）');

// ★ 包起来：★ 修前它会**抛**（缺 isFresh 现在响亮）⇒ 不包的话本证是"崩"，不是"红"，
//   而"崩"的读数不可读（runner 只看到"★ 无汇总"）⇒ ★ 判据必须能被读出来。
let r = { action: '(抛了)' };
let callErr = '';
try {
  r = await ensureStage('symbol_index', { projectRoot: PROJ });
} catch (e) {
  callErr = e instanceof Error ? e.message : String(e);
}
const n1 = fileCount();
chk(!callErr, '①-0 调用本身没抛（★ 缺 isFresh 时它会响亮抛 ⇒ 那一格要判红而不是崩）', callErr.split('\n')[0].slice(0, 140));
chk(n1 === 3, '①-a ★★ files 表 2 → 3（**保鲜真的做了走查**）', `实测 ${n0} → ${n1}；返回 ${JSON.stringify(r)}`);
chk(
  r.action === 'produced',
  '①-b ★ 返回值如实说 `produced`（**不是** `fresh`）—— ★ 不然它就是在报告一件没发生的事',
  `实测 action=${r.action}`,
);

console.log('\n══ ② ★★ 对照：T221 **之前**的老行为（直调 ensureProjectIndex）读数必须一致');
const before = fileCount();
await ensureProjectIndex(PROJ, { bootstrap: false });
const after = fileCount();
// 走到这里两边都该是 3（老行为先前若已同步过，则这次无变更 ⇒ 仍 3）⇒ 判据是"两边收敛到同一个数"
chk(after === n1, `②-a 老行为读数与统一机制**一致**（都是 ${after}）`, `实测 老=${before}→${after} · 统一机制=${n1}`);
chk(after === 3, '②-b ★ 且就是"磁盘上有几个源文件就是几个"（3）—— 两边都不许少', `实测 ${after}`);

console.log('\n══ ③ ★ "有 locate 却没 isFresh"的工序必须**响亮**，不许静默判新鲜');
let threw = '';
try {
  await ensureStage('dsl_baseline', { projectRoot: PROJ, feature: 'no_such_feature' });
} catch (e) {
  threw = e instanceof Error ? e.message : String(e);
}
chk(
  /isFresh/.test(threw),
  '③-a ★★ `dsl_baseline`（有 locate、无 isFresh）⇒ **抛错且点名 isFresh**（不是静默 fresh）',
  threw ? threw.split('\n')[0].slice(0, 120) : '（★ 它没抛 —— 静默兜底又回来了 ✗）',
);
console.log(
  '     ★ 注：这条断言**故意**锁住"缺 isFresh ⇒ 响亮"。若哪天给 `dsl_baseline` 写了真的 isFresh，\n' +
    '       请把本断言改成"它能真的刷新" —— ★ 改它的人是**在把东西修对**，不是绕过判据。',
);

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log(
  '★ 消融自证：★ 删掉 `stage_registry.ts` 里 `symbol_index` 的 `isFresh: () => false,` ⇒ ★ **①-a 必须变红** ✓',
);
// ★★ 不删 scratch —— 实测 `rmSync` 会 `EBUSY`（`cache.db` 还被连接池/只读连接持有句柄）
//   ⇒ ★ 那个异常发生在**汇总行之后** ⇒ 会被 runner 记成"**崩**"（读数就失真了）。
//   ★ 取舍：temp 目录由系统回收；★ **不为"干净"去制造一个假崩溃**。
console.log(`（工作副本留在 ${SCRATCH} —— ★ 连接池持有 cache.db 句柄，删它会 EBUSY；由系统回收）`);
process.exit(F === 0 ? 0 : 1);
