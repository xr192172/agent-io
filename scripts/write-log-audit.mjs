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
const projectDir = path.resolve(arg('project', process.cwd()));
const listLimit = Math.max(1, Number(arg('limit', '10')) || 10);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distUrl = (...p) => pathToFileURL(path.join(repoRoot, 'dist', 'src', ...p)).href;

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
