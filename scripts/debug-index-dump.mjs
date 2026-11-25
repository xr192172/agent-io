#!/usr/bin/env node
/**
 * debug-index-dump —— 任务 #188 索引收录取证（只读，不建库、不改判定）。
 *
 * ## 为什么存在
 * verify-windows 设计册判据 8 条 unsupported，全落在 `scripts/mutate.mjs`（call-exists）；
 * 判定核按 `files`/`nodes` 表查该文件 ⇒ 查无行。本地（主仓 923 / 隔离复现 663）都收录了该文件，
 * clean-clone 本地不复现；CI windows 现场的「索引收录了哪些文件 / 走查扫到了哪些文件」只能在
 * runner 侧采到。本脚本把两侧集合与差集原样落进 artifact，供定位扫描 root / 排除规则 / 口径差异
 * （CI 现算口径 vs 本地 923 行的差集）。
 *
 * ## 纪律
 * · 只读：打开 cache.db 用 node:sqlite readOnly，绝不走 getProjectCacheDb（那会在空目录造空库、
 *   Windows 上还持 EBUSY 锁）；不写任何索引、不改判定。
 * · 任一子项失败都 try/catch 记 error 继续，整体不崩（读不到 ≠ 没有，必须把失败本身交出去）。
 * · 落点 `.agent-io/scratch/verify-last/index-debug/`（scratch 是已声明卷，派生不入库），
 *   被既有 `verify-windows-logs` artifact 的 path `.agent-io/scratch/verify-last/` 一并收录。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.agent-io', 'scratch', 'verify-last', 'index-debug');

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const extOf = (p) => path.extname(p).toLowerCase();
const topOf = (p) => p.split('/')[0] ?? '';

function tryExec(label, fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── dist 动态导入（与 judge-all.mjs 同一接缝；CI 已先 npm run build） ──
const distImport = async (relPath) =>
  import(pathToFileURL(path.join(ROOT, 'dist', relPath)).href);

const report = {
  schema: 1,
  at: new Date().toISOString(),
  env: {},
  git: {},
  grammar: {},
  walk: {},
  db: {},
  diff: {},
  errors: [],
};

function recordError(where, e) {
  report.errors.push({ where, message: e instanceof Error ? e.message : String(e) });
}

// ── 1. 环境 / 平台 ──
report.env = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  execPath: process.execPath,
  cwd: process.cwd(),
  root: ROOT,
};

// ── 2. git HEAD / 忽略态 ──
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8' });
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}
report.git.head = tryExec('git head', () => git(['rev-parse', 'HEAD']));
report.git.branch = tryExec('git branch', () => git(['rev-parse', '--abbrev-ref', 'HEAD']));
report.git.status = tryExec('git status', () => git(['status', '--porcelain']));
report.git.checkIgnoreMutate = tryExec('git check-ignore', () => {
  const r = git(['check-ignore', 'scripts/mutate.mjs']);
  return { ignored: r.status === 0, stdout: r.stdout, stderr: r.stderr };
});

// ── 3. 语法包 / 代码扩展名口径 ──
let walkFiles = null;
let codeSourceExtSet = null;
let listSupportedExtensions = null;
try {
  const imp = await distImport('src/infrastructure/graph/import_project.js');
  walkFiles = imp.walkFiles;
  const se = await distImport('src/infrastructure/parse/source_exts.js');
  codeSourceExtSet = se.codeSourceExtSet;
  const k = await distImport('src/infrastructure/parse/kernel.js');
  listSupportedExtensions = k.listSupportedExtensions;
} catch (e) {
  recordError('dist import', e);
}

report.grammar.codeExts = tryExec('codeSourceExtSet', () => [...codeSourceExtSet()].sort());
report.grammar.parseableExts = tryExec('listSupportedExtensions', () => [...listSupportedExtensions()].sort());

// ── 4. 走查集合（与 ensureFreshIndex 冷启同一把尺：walkFiles(root,false,false)） ──
const TARGET = 'scripts/mutate.mjs';
let walkRels = [];
if (walkFiles) {
  const w = tryExec('walkFiles', () => walkFiles(ROOT, false, false).map(rel));
  if (w.ok) {
    walkRels = w.value;
    report.walk.count = walkRels.length;
    report.walk.byTop = bucket(walkRels, topOf);
    report.walk.byExt = bucket(walkRels, extOf);
    report.walk.targetInWalk = walkRels.includes(TARGET);
    report.walk.sample = walkRels.slice(0, 40);
  } else {
    report.walk.error = w.error;
  }
} else {
  report.walk.error = 'walkFiles 未载入';
}

// ── 5. 索引库现状（只读打开；不存在如实记 no-db，不建） ──
const dbPath = path.join(ROOT, '.agent-io', 'cache.db');
report.db.path = rel(dbPath);
report.db.exists = existsSync(dbPath);
let fileRows = [];
let nodeFilePaths = [];
if (report.db.exists) {
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    fileRows = db.prepare('SELECT path, content_hash, size, modified_at FROM files').all();
    const nodeRows = db.prepare("SELECT DISTINCT file_path FROM nodes WHERE kind = 'file'").all();
    nodeFilePaths = nodeRows.map((r) => r.file_path);
    const normalize = (p) => String(p ?? '').split(path.sep).join('/');
    const fileRels = fileRows.map((r) => normalize(r.path));
    report.db.filesCount = fileRels.length;
    report.db.nodesFileCount = nodeFilePaths.length;
    report.db.filesByTop = bucket(fileRels, topOf);
    report.db.filesByExt = bucket(fileRels, extOf);
    report.db.targetInFiles = fileRels.includes(TARGET);
    report.db.targetInNodes = nodeFilePaths.map((x) => normalize(x)).includes(TARGET);
    report.db.filesSample = fileRels.slice(0, 40);
    const mutateRows = db.prepare("SELECT path FROM files WHERE path LIKE '%mutate.mjs'").all();
    report.db.mutateRows = mutateRows.map((r) => r.path);
  } catch (e) {
    recordError('db read', e);
    report.db.error = e instanceof Error ? e.message : String(e);
  } finally {
    try { db?.close(); } catch { /* noop */ }
  }
}

// ── 6. 磁盘目标文件存在性 ──
report.fs = tryExec('target exists', () => ({
  exists: existsSync(path.join(ROOT, TARGET)),
  abs: path.join(ROOT, TARGET),
}));

// ── 7. 差集：磁盘走查有 / 索引无；索引有 / 走查无 ──
const fileSet = new Set(fileRows.map((r) => rel(r.path)));
const walkSet = new Set(walkRels);
const missingInDb = [...walkSet].filter((p) => !fileSet.has(p)).sort();
const extraInDb = [...fileSet].filter((p) => !walkSet.has(p)).sort();
report.diff.walkMinusDb = {
  count: missingInDb.length,
  byTop: bucket(missingInDb, topOf),
  sample: missingInDb.slice(0, 60),
};
report.diff.dbMinusWalk = {
  count: extraInDb.length,
  byTop: bucket(extraInDb, topOf),
  sample: extraInDb.slice(0, 60),
};

function bucket(list, keyOf) {
  const m = new Map();
  for (const p of list) {
    const k = keyOf(p) || '(root)';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

// ── 落盘 ──
mkdirSync(OUT_DIR, { recursive: true });
const dumpPath = path.join(OUT_DIR, 'index-dump.json');
writeFileSync(dumpPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');

// stdout 摘要（进 verify 门日志，便于不下载 artifact 也能看到关键差集）
const sum = [
  `[debug-index] root=${rel(ROOT)} platform=${report.env.platform} node=${report.env.node}`,
  `[debug-index] walkFiles=${report.walk.count ?? '?'} · files=${report.db.filesCount ?? '?'} · nodes=${report.db.nodesFileCount ?? '?'}`,
  `[debug-index] target ${TARGET}: walk=${report.walk.targetInWalk} files=${report.db.targetInFiles} nodes=${report.db.targetInNodes} fs=${report.fs?.value?.exists}`,
  `[debug-index] walk−db=${report.diff.walkMinusDb.count} (${JSON.stringify(report.diff.walkMinusDb.byTop)})`,
  `[debug-index] db−walk=${report.diff.dbMinusWalk.count} (${JSON.stringify(report.diff.dbMinusWalk.byTop)})`,
  `[debug-index] codeExts=${JSON.stringify(report.grammar.codeExts.value ?? report.grammar.codeExts.error)}`,
  `[debug-index] parseable=${JSON.stringify(report.grammar.parseableExts.value ?? report.grammar.parseableExts.error)}`,
  `[debug-index] dump=${rel(dumpPath)}`,
];
for (const line of sum) console.log(line);
if (report.errors.length) {
  console.log(`[debug-index] 采集错误 ${report.errors.length} 条：`);
  for (const e of report.errors) console.log(`  - ${e.where}: ${e.message}`);
}
