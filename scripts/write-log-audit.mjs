#!/usr/bin/env node
/**
 * write-log-audit.mjs —— **「无卡变更」第三本账的只读对账器**（`docs/todo.md` §一 0.8 · 步骤⑤）。
 *
 * ## 它回答的问题
 * 「本项目的写，有多少条**没有任务卡**在账上？」并按**放行支**分组：
 * `exempt`（设计侧声明豁免）/ `authorized`（按 run 授权）/ `files-not-in-design`（不在设计里）/
 * `unaddressable`（文件节点收集失败）/ `first-run-unclaimed`（首跑模式）/ `covered`（有卡）。
 * ⇒ 这直接把「豁免面到底放行了多少写」量化出来，不必先去审那 59 个裸字段。
 *
 * ## ★ 已声明边界（AGENTS-RULES 0.17 口径①：本账**不管**什么）
 * 本账只覆盖**过写原语的写**（`source_writer` 的 `commit` / `append` / `copy` / `move` / `remove`
 * + 回滚通道 `restoreSourceBytes`）。**`Write` / `Edit` / shell 直写磁盘不在内**，且**不打算用
 * 周期性全量扫描去兜**（0.19：政策兜底不是机制）—— 要覆盖它需要常驻 daemon（OS 事件），那是另一件事。
 *
 * ## 只读
 * 本脚本**不写任何 state**：不建库、不建表、不改行、不建目录。库不在就直说"读不到"并非 0 退出
 * （0.12：读不到 ≠ 一条都没有）。
 *
 * 用法：
 *   node scripts/write-log-audit.mjs [--project <dir>] [--limit N] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const asJson = argv.includes('--json');
/**
 * ★ `--gate`（2026-11-03 接线）：同一个脚本的**门模式** —— `npm run verify` 的「无卡写账」门。
 *   ★ 它**不新写一套对账逻辑**：走的是下面**同一份** reconciliation（同一批权威函数、同一个分母口径、
 *     同一个"哪一行算用户源码的写"分类），只把结论换成三态退出码。★ 为什么不拆成
 *     `scripts/write-log-gate.mjs`：拆出去就得把 `classifyWriteSubject` / `isUnderSkippedDir` /
 *     `shouldSyncRel` 三把尺的串联复制一份 —— 那正是 0.9.1 禁止的第二处权威。
 */
const asGate = argv.includes('--gate');
const projectDir = path.resolve(arg('project', process.cwd()));
const listLimit = Math.max(1, Number(arg('limit', '10')) || 10);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distUrl = (...p) => pathToFileURL(path.join(repoRoot, 'dist', 'src', ...p)).href;
/** 门模式的棘轮基线（只记**已登记的存量**，每条带 reason） */
const baselineFile = path.resolve(arg('baseline', path.join(here, 'write-log-baseline.json')));

const die = (msg) => {
  console.error(msg);
  process.exit(2);
};

// ★ 只读探查 DB 前 existsSync 先行：`new DatabaseSync(<不存在的路径>)` 会建 0 字节空壳（撞 manifest:check）
const tasksDb = path.join(projectDir, '.agent-io', 'tasks.db');
if (!fs.existsSync(tasksDb)) {
  die(
    `读不到写账：${tasksDb} **不存在**。\n` +
      '  ★ 这不是「零无卡写」，而是「这个项目还没有写账」（0.12：读不到 ≠ 一条都没有）。\n' +
      '  ★ 写账只在**过写原语**的写之后才产生（source_writer 的 5 个动词 + 回滚通道）。',
  );
}

let readWriteLog;
let classifyWriteSubject;
let isUnderSkippedDir;
let shouldSyncRel;
try {
  ({ readWriteLog } = await import(distUrl('infrastructure', 'write_log.js')));
  ({ classifyWriteSubject } = await import(distUrl('application', 'write_gate.js')));
  ({ isUnderSkippedDir } = await import(distUrl('infrastructure', 'parse', 'source_exts.js')));
  ({ shouldSyncRel } = await import(distUrl('infrastructure', 'index', 'watch_project.js')));
} catch (e) {
  die(
    `读不到权威模块（${(e && e.message) || e}）⇒ 判不了。\n` +
      '  ★ 本脚本**不自己拼 SQL / 不自己造"什么算源码"的清单**（AGENTS-RULES 0.20）——\n' +
      '    它调的是 write_log#readWriteLog / write_gate#classifyWriteSubject /\n' +
      '    source_exts#isUnderSkippedDir / watch_project#shouldSyncRel。\n' +
      '  ⇒ 先 `npm run build`（dist 必须比 src 新）。',
  );
}

const read = readWriteLog(projectDir, { limit: 5000 });
if (read.skip) die(`读不到 write_log：${read.skip}`);

/**
 * 「这一行算不算用户源码的写」——**复用现有权威**，不新造清单：
 * ① `classifyWriteSubject`：产物目录 / 临时目录 / 根外（`.agent-io` `.agent` `design-db` `dist`
 *    `node_modules` `output` 都在它里面）；
 * ② `isUnderSkippedDir`：索引器本来就不收的目录（`node_modules` / `dist` / 隐藏目录…）；
 * ③ `shouldSyncRel`：非源码扩展名 / 索引跳过的文件名。
 * @returns 排除原因（`null` = 保留）
 */
const exclusionOf = (rel) => {
  const cls = classifyWriteSubject(projectDir, path.join(projectDir, rel));
  if (cls.subject !== 'source') return cls.subject; // product / temp / outside-root
  if (isUnderSkippedDir(rel)) return 'skipped-dir';
  if (!shouldSyncRel(rel)) return 'not-source-ext';
  return null;
};

/** 支名（`exempt` 那类带 `:by` 附注 ⇒ 分组只取前缀） */
const branchOf = (r) => String(r.gate_branch ?? '(none)').split(':')[0];

const kept = [];
const dropped = new Map();
for (const r of read.rows) {
  const why = exclusionOf(r.file);
  if (why) dropped.set(why, (dropped.get(why) ?? 0) + 1);
  else kept.push(r);
}

const noCard = kept.filter((r) => !r.card_id);
const withCard = kept.filter((r) => !!r.card_id);
const N = noCard.length;
const M = withCard.length;
const T = kept.length;
const closed = N + M === T;

/** 无卡写按支分组（★ 本账的核心读数：豁免面到底放行了多少写） */
const byBranch = new Map();
for (const r of noCard) byBranch.set(branchOf(r), (byBranch.get(branchOf(r)) ?? 0) + 1);
const branches = [...byBranch.entries()].sort((a, b) => b[1] - a[1]);

const BOUNDARY =
  '本账只覆盖「过写原语的写」（source_writer 的 commit / append / copy / move / remove + 回滚通道 restoreSourceBytes）；\n' +
  '  `Write` / `Edit` / shell 直写磁盘**不在内**，且**不打算用周期性全量扫描去兜**（AGENTS-RULES 0.19：政策兜底不是机制）——\n' +
  '  要覆盖它需要常驻 daemon（OS 事件），那是另一件事（docs/todo.md §一 6.3）。';

const fmtRow = (r, i) =>
  `  ${String(i + 1).padStart(3)}. ${r.at} · ${r.file} · actor=${r.actor ?? '（空）'} · kind=${r.kind} · ` +
  `source=${r.source} · card=${r.card_id ?? '（无）'}${r.card_feature ? `(${r.card_feature})` : ''} · ` +
  `branch=${r.gate_branch ?? '（无）'}`;

// ════════════════════════════════════════════════════════════════════
// ★ 门模式（`--gate` · 2026-11-03 接线）：`npm run verify` 的「无卡写账」门
//
// ## 它治哪个洞
// 这个对账器此前**连 npm script 都没登记**（`package.json` 里没有 `audit:writes`）⇒
// 「无卡变更」这件事依旧靠**人记得跑脚本** —— 发现者审计里它正落在 HUMAN 那一档（"只有人撞上才发现"）。
// 现在：① `npm run audit:writes` = 有人读的入口；② `--gate` = 总门能跑的三态结论。
//
// ## 判据（四条，都可判）
// ① **无卡写（`card_id IS NULL`）= 0** 才算干净；
// ② 历史存量走棘轮：`scripts/write-log-baseline.json` 逐条登记（键 = `at|file|kind`）——
//    **键集与条数同时**比对 ⇒ **只许不增**，新出现一条无卡写就红（★ 不许"清零骗绿"：存量逐条列出）；
// ③ 读不全（5000 行上限截断 / 分母不闭合）⇒ 红 —— 只对了一部分不许当通过（0.12 ③）；
// ④ 没有基线却已有无卡写 ⇒ 红（拒"空名单全靠开关"）。
//
// ## 退出码（与总门同口径）
//   0 = 干净 ｜ 1 = 红（逐条点名 file + at + actor + source）｜ 2 = 判不了（库不在 / 权威模块读不到，见 `die`）
if (asGate) {
  let baseline = null;
  let baselineError = '';
  try {
    if (fs.existsSync(baselineFile)) baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
    else baselineError = `基线文件不存在：${baselineFile}`;
  } catch (e) {
    // ★ 读不了 ≠ 没有（0.12）：坏基线不许静默当空名单 —— 那会把"登记过的存量"变成"未登记"而报假红。
    baselineError = `基线读不了（${(e && e.message) || e}）：${baselineFile}`;
  }
  const keyOf = (r) => `${r.at}|${r.file}|${r.kind}`;
  /** ★ 只认带 reason 的条目：空 reason 的登记等于没登记（排除/豁免必须是**声明**） */
  const baseRows = Array.isArray(baseline?.rows)
    ? baseline.rows.filter((x) => x && x.key && String(x.reason ?? '').trim())
    : [];
  const baseKeys = new Set(baseRows.map((x) => x.key));
  const baseMax = typeof baseline?.max_no_card === 'number' ? baseline.max_no_card : baseRows.length;
  const unbaselined = noCard.filter((r) => !baseKeys.has(keyOf(r)));
  const truncated = read.total > read.rows.length;
  const stale = baseRows.filter((x) => !noCard.some((r) => keyOf(r) === x.key));

  const fail = [];
  if (!closed) fail.push(`分母不闭合（N ${N} + M ${M} ≠ T ${T}）—— 对账器自己有 bug，不许当通过`);
  if (truncated) fail.push(`只读到 ${read.rows.length}/${read.total} 行（5000 行上限）⇒ 这一遍只对了一部分，不许当通过`);
  if (baselineError && N > 0) fail.push(`${baselineError}（无基线 ⇒ 判不了"只许不增"）`);
  if (!baselineError && N > 0 && baseRows.length === 0) fail.push('基线里**没有一条**带 reason 的登记（空名单）⇒ 拒绝把整扇门关掉');
  if (unbaselined.length) fail.push(`**新增**无卡写 ${unbaselined.length} 条（基线只许不增）`);
  if (N > baseMax) fail.push(`无卡写 ${N} 条 > 基线上限 ${baseMax} 条`);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: fail.length === 0,
          project_dir: projectDir,
          tasks_db: tasksDb,
          read: { fetched: read.rows.length, total: read.total, truncated },
          total: T,
          with_card: M,
          no_card: N,
          denominator_closed: closed,
          by_branch: Object.fromEntries(branches),
          excluded: Object.fromEntries(dropped),
          baseline: { file: baselineFile, error: baselineError || undefined, entries: baseRows.length, max_no_card: baseMax },
          unbaselined: unbaselined.map((r) => ({ at: r.at, file: r.file, actor: r.actor, source: r.source, branch: r.gate_branch })),
          stale_baseline: stale.map((x) => x.key),
          failures: fail,
          boundary: BOUNDARY,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('════ 无卡写账（verify 门 · write_log 第三本账 · 只读）════');
    console.log(`项目：${projectDir}`);
    console.log(`库：  ${tasksDb}`);
    console.log(
      `读到：${read.rows.length} 行（库内共 ${read.total} 行${truncated ? ' · ★ 已截断（5000 行上限）' : ''}）`,
    );
    console.log('');
    console.log(`★ 总写入 ${T} 条 · 有卡 ${M} · **无卡 ${N}**（分母闭合 N+M=T ⇒ ${closed ? 'true' : 'false'}）`);
    const droppedTotal = [...dropped.values()].reduce((a, b) => a + b, 0);
    console.log(
      `★ 已排除 ${droppedTotal} 行（非用户源码的写，按现有权威分类）：${
        droppedTotal ? [...dropped.entries()].map(([k, v]) => `${k} ${v}`).join(' · ') : '（无）'
      }`,
    );
    if (branches.length) {
      console.log('按支分组（无卡写）：' + branches.map(([b, n]) => `${b} ${n}`).join(' · '));
    }
    console.log('');
    console.log(
      `基线：${path.relative(repoRoot, baselineFile).split(path.sep).join('/')} —— ` +
        `登记 ${baseRows.length} 条 / 上限 ${baseMax} 条${baseline?.note ? `（${baseline.note}）` : ''}`,
    );
    if (baselineError) console.log(`  ★ ${baselineError}`);
    if (stale.length) {
      console.log(`  ★ 已消失的基线条目 ${stale.length} 条（可删；不影响判定）：`);
      for (const x of stale.slice(0, 10)) console.log(`     · ${x.key}`);
    }
    console.log('');
    if (!unbaselined.length) {
      console.log('新增无卡写：无（每一行无卡写都在基线里登记过）');
    } else {
      console.log(`★ **新增**无卡写 ${unbaselined.length} 条（逐条点名；基线只许不增）：`);
      unbaselined.slice(0, listLimit).forEach((r, i) => {
        console.log(fmtRow(r, i) + `  ★ 新`);
      });
      if (unbaselined.length > listLimit) console.log(`  …… 另有 ${unbaselined.length - listLimit} 条`);
    }
    console.log('');
    console.log('★ 本账的**已声明边界**（0.17①）：');
    console.log(`  ${BOUNDARY}`);
    console.log('');
    if (fail.length) {
      console.log('FAIL  无卡写账：');
      for (const f of fail) console.log(`   · ${f}`);
    } else {
      console.log(`PASS  无卡写账：总写入 ${T} · 有卡 ${M} · 无卡 ${N}（全部在基线登记内，无新增）`);
    }
  }
  process.exit(fail.length ? 1 : 0);
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        project_dir: projectDir,
        tasks_db: tasksDb,
        read: { fetched: read.rows.length, total: read.total, truncated: read.total > read.rows.length },
        no_card: N,
        with_card: M,
        total: T,
        denominator_closed: closed,
        by_branch: Object.fromEntries(branches),
        excluded: Object.fromEntries(dropped),
        boundary: BOUNDARY,
        rows: noCard.slice(0, listLimit),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log('════ write_log 对账（「无卡变更」第三本账 · 只读）════');
console.log(`项目：${projectDir}`);
console.log(`库：  ${tasksDb}`);
const truncNote =
  read.total > read.rows.length ? ` · ★ 已截断（上限 5000 行），下面 N/M 只是这 ${read.rows.length} 行的` : '';
console.log(`读到：${read.rows.length} 行（库内共 ${read.total} 行${truncNote}）`);
console.log('');
console.log(`★ 无卡写 ${N} 条 / 有卡写 ${M} 条 / 总 ${T} 条`);
console.log(`★ 分母闭合：N + M = T ⇒ ${closed ? 'true' : 'false'}（${N} + ${M} = ${N + M}，T = ${T}）`);
if (!closed) console.log('  ★★ 不闭合 = 本脚本的分组有 bug（不许当成"没问题"读）。');
console.log('');
if (branches.length) {
  console.log('按支分组（无卡写）—— ★ 这一行直接量化「豁免面放行了多少写」：');
  for (const [b, n] of branches) console.log(`  · ${b.padEnd(24)} ${String(n).padStart(4)} 条`);
  console.log('');
}
const droppedTotal = [...dropped.values()].reduce((a, b) => a + b, 0);
console.log('排除分母（非用户源码的写，按现有权威分类）:');
if (!droppedTotal) console.log('  （无 —— 本次读到的每一行都落在用户源码路径上）');
else {
  console.log(`  已排除 ${droppedTotal} 行：${[...dropped.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log('  ★ 分类口径：classifyWriteSubject（产物/临时/根外）· isUnderSkippedDir（索引跳过的目录）· shouldSyncRel（非源码扩展名）');
}
console.log('');
console.log('★ 未覆盖分母（已声明边界）：');
console.log(`  ${BOUNDARY}`);
console.log('');
console.log(`逐条名单（无卡写，前 ${Math.min(listLimit, N)} / 共 ${N} 条）:`);
if (!N) console.log('  （无 —— 本次读到的写全部挂了任务卡）');
else noCard.slice(0, listLimit).forEach((r, i) => console.log(fmtRow(r, i)));
console.log('');
console.log('★ 本脚本只读：不改 state、不建库、不建表、不开卡。');
