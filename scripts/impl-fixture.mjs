/**
 * impl-fixture —— `cardStanding` 等**判据实现**的行为夹具（门「实现夹具」的执行核）
 *
 * ## 三条不变量（为什么必须这样）
 *
 * 1. **只钉状态名，不钉 reason 文案**：reason 是给人看的措辞，会改；`standing` / `isClaimable` /
 *    `applicableTransitions` 的 id 集合是判据。
 *
 * 2. ★★ **门的输入必须是本脚本自己钉死的东西 —— 不读本仓 `.agent-io/cache.db`，也不读任何册**。
 *    它自带一个**微型舞台**：临时目录里两个文件（`a.ts` 依赖 `b.ts`），用本仓自己的
 *    `ensureFreshIndex` 建索引（同一个索引器，不手编形状）。
 *    · 为什么必须自带：`violated` 分支要一条**前态红**，而前态判据只有 `edge-absent` /
 *      `domain-independent` 两种、都只能读索引 ⇒ 依赖边是这一门**不可回避**的输入。
 *      旧版去借本仓索引（`fileFacts(HANDLERS).deps[0]`），而那份 `cache.db` 是**别的工具顺手建的**
 *      ⇒ 冷索引时 `deps[0] === undefined` ⇒ `edge-absent.to` 为空 ⇒ 判定器里 `normPath(undefined)`
 *      抛 TypeError，且红绿取决于**门序**（`MCP 工具签名` 先跑就建出 60MB 的它）。
 *      **门不许测门序**：一个结论取决于"别人有没有顺手建过文件"的门，测的不是仓库。
 *    · 附带好处：舞台里的边是**本脚本写下的**，`edge-absent` 的 `to` 不可能再是 undefined。
 *
 * 3. **三态退出码（与 `scripts/verify.mjs` 的 `run()` 同一口径）**：
 *    `0` = 全部断言通过 · `1` = 有断言红 · `2` = **跑不了 / 判不了**（unsupported：缺 dist，
 *    或微型舞台的依赖边建不出来）。★ `2` 在总门里显示成 **SKIP**，**不许折成 PASS**（0.12）。
 *    ⇒ 缺什么就点名什么，**不许崩**（崩掉的栈读不出"缺哪个输入"）。
 *
 * ## 场景（对着 cardStanding 的分支 + 相邻判据写的；舞台 = 微型临时目录）
 *   F1 后态全过 ∧ 前态无红   ⇒ satisfied
 *   F2 后态有红（自己）      ⇒ work
 *   F3 后态全过 ∧ 前态红     ⇒ violated
 *   F4 零判据                ⇒ unknowable
 *   F5a 后态红 · 归属 own         ⇒ work
 *   F5b 后态红 · 归属 orphan      ⇒ work
 *   F5c 后态红 · 归属 dep-done    ⇒ blocked
 *   F5d 后态红 · 归属 dep-pending ⇒ blocked
 *   F6 isClaimable 五值穷尽      ⇒ work/violated true；其余 false
 *   F7 applicableTransitions     ⇒ from=done 含 t_reopen；from=void 含 t_relaunch
 *   F8 releaseIfExpired          ⇒ 六个分支（一个该释放 + 五个不该释放）
 *   F9 isSatisfied               ⇒ cardStanding 的薄投影
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** `0` 通过 · `1` 断言红 · `2` 跑不了/判不了（= 总门里的 SKIP） */
const EXIT_FAIL = 1;
const EXIT_UNSUPPORTED = 2;

/** 仓根 —— 由**脚本自身位置**推出（不读 cwd：cwd 是环境态，见 0.12 第 2 条）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 微型舞台（临时目录）；建不起来/用不了时按 unsupported 收场，绝不带着半个舞台往下跑。 */
let STAGE = null;
let stageDbOpen = false;

/** 清理：临时目录与它那条池化连接（Windows 上不先关连接会 EBUSY 删不掉）。 */
function cleanupStage(closeDb) {
  if (stageDbOpen) {
    try {
      closeDb(STAGE);
    } catch (e) {
      console.log(`⚠ 舞台索引连接没关掉：${((e && e.message) || String(e))}`);
    }
    stageDbOpen = false;
  }
  if (STAGE && fs.existsSync(STAGE)) {
    try {
      fs.rmSync(STAGE, { recursive: true, force: true });
    } catch (e) {
      // ★ 删不掉必须出声（0.12）：`force:true` 会把"删不掉"咽掉
      console.log(`⚠ 临时舞台没删掉（${STAGE}）：${((e && e.message) || String(e))} —— 不影响本次结论，但会留垃圾`);
    }
  }
}

/**
 * 「判不了」的唯一出口：**点名缺什么** + 退出码 2（总门记成 SKIP）。
 *
 * ★ 不许用 throw 代替它：崩溃的栈只留 TypeError，读不出「缺哪个输入」（这正是本门 0.5 的病）。
 */
let cleanupRef = null;
function unsupported(why) {
  if (cleanupRef) cleanupRef();
  console.log(`\nunsupported：${why}`);
  console.log('★ 这一门**判不了**（≠ 通过，≠ 断言红）⇒ 退出码 2；补齐上面点名的输入后重跑。');
  process.exit(EXIT_UNSUPPORTED);
}

// ── 前置输入 ①：构建产物（dist）—— 缺它连领域函数都加载不到 ────────────────────
const NEED_DIST = [
  'dist/src/domain/task_machine.js',
  'dist/src/application/design/intent/expectations.js',
  'dist/src/infrastructure/index/db.js',
  'dist/src/infrastructure/index/index_freshness.js',
  'dist/src/infrastructure/index/file_facts.js',
];
const missingDist = NEED_DIST.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
if (missingDist.length) {
  unsupported(
    `缺构建产物 ${missingDist.length}/${NEED_DIST.length}：${missingDist.join('、')}` +
      `（仓根按脚本位置解析为 ${ROOT}）⇒ 先 \`npm run build\``,
  );
}

const load = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let mod;
try {
  mod = {
    ...(await load('dist/src/domain/task_machine.js')),
    ...(await load('dist/src/application/design/intent/expectations.js')),
    ...(await load('dist/src/infrastructure/index/db.js')),
    ...(await load('dist/src/infrastructure/index/index_freshness.js')),
    ...(await load('dist/src/infrastructure/index/file_facts.js')),
  };
} catch (e) {
  unsupported(`dist 里的模块加载失败：${((e && e.message) || String(e))}（先 \`npm run build\`）`);
}
const { cardStanding, isClaimable, applicableTransitions, releaseIfExpired, isSatisfied } = mod;
// ★ 判定器是**注入**的（`StandingInput.judge` 必填）—— 注入的仍是生产那个 `judgeExpectations`
//   （★ 不另写一个判定器：本夹具钉的只是 `cardStanding` 的行为）。
const { judgeExpectations } = mod;
const { getProjectCacheDb, closeProjectCacheDb } = mod;
const { ensureFreshIndex } = mod;
const { fileFacts } = mod;
cleanupRef = () => cleanupStage(closeProjectCacheDb);

// ── 前置输入 ②：微型舞台（临时目录 + 本仓索引器建出的依赖边）────────────────────
STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-fixture-'));
/** 舞台里的两个文件：A 依赖 B（`edge-absent` 的前态红就靠这条真边） */
const A = 'a.ts';
const B = 'b.ts';
fs.writeFileSync(path.join(STAGE, A), "import { b } from './b.js';\nexport const a = b;\n");
fs.writeFileSync(path.join(STAGE, B), 'export const b = 1;\n');

try {
  const db = getProjectCacheDb(STAGE);
  stageDbOpen = true;
  await ensureFreshIndex(db, STAGE);
} catch (e) {
  unsupported(`微型舞台建索引失败：${((e && e.message) || String(e))} ⇒ 造不出 edge-absent 的前态红（F3 判不了）`);
}
const stageDeps = fileFacts(STAGE, A).deps;
if (!stageDeps.includes(B)) {
  unsupported(
    `微型舞台的依赖边没建出来：fileFacts('${A}').deps = [${stageDeps.join(', ') || '（空）'}]，期望含 '${B}'` +
      `（索引器没解析出这条 import ⇒ edge-absent 的前态红造不出来）`,
  );
}

/**
 * ★ 记下旧版夹具的错（不变量，不是故事）：`edge-absent` 比的是**文件路径**
 *   （`fileFacts(from).deps` 里的仓库相对路径），不是节点 id ——
 *   拿节点 id 当 `to` 会永远"不依赖"⇒ 判据"通过"⇒ 拿到 satisfied 而不是 violated（判据在撒谎）。
 */

/**
 * ★ 2026-10-22（task.expectations 去副本）：判据不再住卡（`TaskSpec` 无该字段）。
 *   夹具把判据放在 `criteria` 上，调用时作**第二个参数**交给领域函数（不再冒充卡字段）。
 */
const card = (exps, id = 'file_a_ts') => ({
  id,
  summary: '夹具',
  criteria: exps,
  state: 'candidate',
});

/** F5 的舞台：一个"自己"节点 + 一个 done 节点 + 一个 pending 节点（都不必真实存在于磁盘） */
const SELF = 'self_probe.ts';
const DEP_DONE = 'dep_done_probe.ts';
const DEP_PENDING = 'dep_pending_probe.ts';
const stageNodes = [
  { id: 'file_self_probe', path: SELF, task: { state: 'claimed' } },
  { id: 'file_dep_done', path: DEP_DONE, task: { state: 'done' } },
  { id: 'file_dep_pending', path: DEP_PENDING, task: { state: 'claimed' } },
];
const redCard = (targetPath) => card([{ kind: 'file-exists', path: targetPath }], 'file_self_probe');

const CASES = [
  { name: 'F1 后态全过 + 前态无红', card: card([{ kind: 'file-exists', path: A }]), expect: 'satisfied' },
  { name: 'F2 后态有红（文件不存在）', card: card([{ kind: 'file-exists', path: 'src/__fixture_missing__.ts' }]), expect: 'work' },
  {
    name: 'F3 后态全过 + 前态红（edge-absent 但边存在）',
    card: card([
      { kind: 'file-exists', path: A },
      { kind: 'edge-absent', from: A, to: B },
    ]),
    expect: 'violated',
  },
  { name: 'F4 零判据（空集）', card: card([]), expect: 'unknowable' },

  // ── F5：红归属的四种（own / orphan 可领；dep-* 等别人）──
  { name: 'F5a 后态红 · own（本节点自己）', card: redCard(SELF), nodes: stageNodes, expect: 'work' },
  { name: 'F5b 后态红 · orphan（不对应任何节点）', card: redCard('nobody_owns_me.ts'), nodes: stageNodes, expect: 'work' },
  { name: 'F5c 后态红 · dep-done（依赖已 done）', card: redCard(DEP_DONE), nodes: stageNodes, expect: 'blocked' },
  { name: 'F5d 后态红 · dep-pending（依赖未完成）', card: redCard(DEP_PENDING), nodes: stageNodes, expect: 'blocked' },
];

let pass = 0;
const fails = [];
for (const c of CASES) {
  const v = await cardStanding(c.card, c.card.criteria, {
    root: STAGE,
    nodes: c.nodes ?? [],
    judge: judgeExpectations,
  });
  const ok = v.standing === c.expect;
  if (ok) pass++;
  else fails.push(`${c.name}: 期望 ${c.expect}，实际 ${v.standing}`);
  console.log(`${ok ? '✓' : '✗'} ${c.name} → ${v.standing}${ok ? '' : `  (期望 ${c.expect})`}`);
}

// ── F6：isClaimable 五值穷尽（★ 只允许 work/violated 为真）──
const claimableCases = [
  ['work', true],
  ['violated', true],
  ['satisfied', false],
  ['blocked', false],
  ['unknowable', false],
];
for (const [standing, expect] of claimableCases) {
  const got = isClaimable(standing);
  const ok = got === expect;
  if (ok) pass++;
  else fails.push(`F6 isClaimable(${standing}): 期望 ${expect}，实际 ${got}`);
  console.log(`${ok ? '✓' : '✗'} F6 isClaimable(${standing}) → ${got}`);
}

// ── F7：applicableTransitions 按 from + ready 过滤 ──
const transCases = [
  ['done', ['t_reopen']],
  ['void', ['t_relaunch']],
  // ★★★ 2026-10-23：加 `t_prepare`（两段式第一段 candidate → preparing）——
  //   ★ 这条**不是"为了让门变绿"而放宽**：夹具本来就是"迁移表的快照"，
  //     表真的多了这一条（`TRANSITIONS` 里 t_prepare 是 ready），所以**期望值**跟着表走。
  //     ★ 判据是：如果 t_prepare 被误设成 blocked/unimplemented，这条**必须**红（它钉的是"可走"）。
  ['candidate', ['t_claim', 't_prepare', 't_void', 't_done_from_candidate']],
  ['preparing', ['t_start', 't_abandon']],
];
for (const [from, expectIds] of transCases) {
  const got = applicableTransitions(from).map((t) => t.id).sort();
  const ok = JSON.stringify(got) === JSON.stringify([...expectIds].sort());
  if (ok) pass++;
  else fails.push(`F7 applicableTransitions(${from}): 期望 ${expectIds}，实际 ${got}`);
  console.log(`${ok ? '✓' : '✗'} F7 applicableTransitions(${from}) → [${got}]`);
}

// ── F8：releaseIfExpired —— 五个"不该释放"的分支 + 一个"该释放" ──
const NOW = Date.parse('2026-10-20T08:00:00.000Z');
const TTL = 60_000; // 1 分钟
const lease = (state, claimedAt) => ({ id: 'file_x', summary: '夹具', expectations: [], state, ...(claimedAt ? { claimed_at: claimedAt } : {}) });
const old = new Date(NOW - 5 * 60_000).toISOString(); // 5 分钟前 ⇒ 过 TTL
const fresh = new Date(NOW - 10_000).toISOString(); // 10 秒前 ⇒ 没过
const leaseCases = [
  ['claimed + 超时 ⇒ 释放', [lease('claimed', old)], 1],
  ['claimed + 未超时 ⇒ 不释放', [lease('claimed', fresh)], 0],
  ['candidate ⇒ 不释放（state !== claimed）', [lease('candidate', old)], 0],
  ['claimed 但无 claimed_at ⇒ 判不了，不释放', [lease('claimed')], 0],
  ['claimed + claimed_at 非法 ⇒ 不释放', [lease('claimed', 'not-a-date')], 0],
  ["非法 state（'bogus'）⇒ 不释放", [lease('bogus', old)], 0],
];
for (const [name, cards, expect] of leaseCases) {
  const got = releaseIfExpired(cards, NOW, TTL).length;
  const ok = got === expect;
  if (ok) pass++;
  else fails.push(`F8 ${name}: 期望 ${expect} 条事件，实际 ${got}`);
  console.log(`${ok ? '✓' : '✗'} F8 ${name} → ${got} 条`);
}

// ── F9：isSatisfied 是 cardStanding 的薄投影（standing === 'satisfied'）──
const satCases = [
  ['后态全过 ⇒ satisfied:true', card([{ kind: 'file-exists', path: A }]), true],
  ['后态有红 ⇒ satisfied:false', card([{ kind: 'file-exists', path: 'nope.ts' }]), false],
];
for (const [name, c, expect] of satCases) {
  const v = await isSatisfied(c, c.criteria, { root: STAGE, nodes: [], judge: judgeExpectations });
  const ok = v.satisfied === expect;
  if (ok) pass++;
  else fails.push(`F9 ${name}: 期望 ${expect}，实际 ${v.satisfied}（standing=${v.standing}）`);
  console.log(`${ok ? '✓' : '✗'} F9 ${name} → satisfied=${v.satisfied}`);
}

cleanupRef();
const total = CASES.length + claimableCases.length + transCases.length + leaseCases.length + satCases.length;
console.log(`\n夹具：${pass}/${total} 通过`);
if (fails.length) {
  console.log('失败明细：');
  for (const f of fails) console.log('  ' + f);
  process.exit(EXIT_FAIL);
}
