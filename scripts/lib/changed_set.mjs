/**
 * changed_set.mjs —— **「这次到底改了什么」的唯一实现**（T-#INC-JUDGE-SEL，2026-11-17）。
 *
 * ## 为什么它必须是一处权威
 * `judge-all --changed`、`verify`（设计册判据门）、以及将来的 gates 都要问同一个问题：
 * 「自**上一次全量判据**以来，哪些文件变了？」—— 答案有三条各自不完整的来源：
 *
 * | 来源 | 覆盖 | 缺什么 |
 * |---|---|---|
 * | `cache.db#scan_changes` | **全量扫描窗口内的**逐文件 diff（行级台账） | 日常 `edit_code` / `watch` **根本不写它**（只有 `recordScanRun` 写，见 `symbols.ts:1476`） |
 * | `git status`（工作区） | 未提交的改动（含未跟踪） | 已提交的改动看不见 |
 * | `git log --since=<上次全量判据时刻>` | 上次全量判据之后**提交掉**的改动 | 需要 `judge-readings.json.at` 这个锚；读不到 ⇒ 这条来源缺席（必须**说出来**） |
 *
 * ⇒ 本模块**取并集**，并把「哪几条来源真的用上了 / 哪条缺席、为什么」原样交出去
 * （`sources` + `unavailable`）。**读不到 ≠ 没有改动**：调用方必须能区分"并集是空"与"一条来源都没读到"。
 *
 * ## 口径（写给调用方）
 * · `paths` 一律**仓库相对 + 正斜杠 + 无 `./` 前缀**；
 * · `paths` 为空 **且** `unavailable === null` ⇒ **真的没改动** ⇒ 调用方**回落全量**（保守方向）；
 * · `unavailable !== null` ⇒ 至少一条来源读不到 ⇒ 调用方**回落全量**并把 `unavailable` 打印出来
 *   （0.12：读不到不许当"没改"）。
 *
 * ## 它不做什么（边界）
 * · **不**算波及闭包（那是 `infrastructure/analysis/facts/impact_set.ts#impactOfChanged` 的活）；
 * · **不**决定"要不要选量"（那是 `judge-all` / `verify` 的活）；
 * · **不**写盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// ★ `node:sqlite` 用同步 require 拿：本模块的函数是**同步**的（调用方是一次性脚本 / 门），
//   为它把整条调用链改成 async 只为了一个 import 不值得。`createRequire` 是 ESM 里的正路。
const require = createRequire(import.meta.url);

/** 与判据侧同一套归一（反斜杠、`./` 前缀、空白） */
export function normChangedPath(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

/**
 * ★★★ 2026-11-24（G-1 · 门11②）：**运行时产物窄模式排除**（fail-closed）。
 *
 * 只排除 sqlite 库与其 WAL/-shm 附属：`.agent-io/<name>.db`、`.agent-io/<name>.db-shm`、
 * `.agent-io/<name>.db-wal`。它们是索引/任务库的运行态产物，不是业务改动；WAL/-shm 由 sqlite
 * 随库抖动，列进改动集会污染增量选量（夹具实测：反例4 expected `[]` actual 非空，正例2/3 首位多 shm）。
 *
 * ★ fail-closed 边界：**仅**这组已知运行时模式；其它任何路径（含 `.agent-io/` 下的 json/jsonl/
 * design 册/快照）一律保留，不做宽通配。排除名单要扩 ⇒ 先在本谓词加可复核的模式与出处。
 */
const RUNTIME_DB_RE = /(^|\/)\.agent-io\/[^/]*\.db(?:-shm|-wal)?$/;
export function isRuntimeDbArtifact(p) {
  return RUNTIME_DB_RE.test(normChangedPath(p));
}

/** 跑 git（argv 数组，不经 shell —— 与 `detect_drift#gitChangedFiles` 同一纪律） */
function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * 来源一：`git status --porcelain` —— 工作区（含暂存、含未跟踪）。
 * ★ 为什么用 porcelain 而不是 `diff`：未跟踪文件**不在 diff 里**，而"新加的判据目标文件"恰恰是它。
 */
function gitWorktree(root) {
  try {
    const out = git(root, ['status', '--porcelain', '--untracked-files=all']);
    const paths = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      // 形态：`XY <path>` / `XY <old> -> <new>`（重命名两侧都要算改动）
      const body = line.slice(3);
      const arrow = body.indexOf(' -> ');
      if (arrow >= 0) paths.push(body.slice(0, arrow), body.slice(arrow + 4));
      else paths.push(body);
    }
    return { ok: true, paths: paths.map(normChangedPath).filter(Boolean) };
  } catch (e) {
    return { ok: false, paths: [], reason: `git status 跑不了：${String(e?.message ?? e).slice(0, 160)}` };
  }
}

/**
 * 来源二：**上次全量判据之后提交掉的改动**（`git log --since=<at> --name-only`）。
 * ★ 锚 = `.agent-io/judge-readings.json#at`（那份读数**只由全量跑写**，见 judge-all 的选量分支）。
 *   读不到锚 ⇒ 这条来源**缺席**（不是"没有改动"）。
 */
function gitSince(root, sinceIso) {
  if (!sinceIso) return { ok: false, paths: [], reason: '没有"上次全量判据"的时刻（judge-readings.json 缺 at）⇒ 已提交的改动看不见' };
  try {
    const out = git(root, ['log', `--since=${sinceIso}`, '--name-only', '--pretty=format:', '--diff-filter=ACMRD']);
    const paths = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map(normChangedPath);
    return { ok: true, paths };
  } catch (e) {
    return { ok: false, paths: [], reason: `git log 跑不了：${String(e?.message ?? e).slice(0, 160)}` };
  }
}

/** 上次**全量**判据的时刻（`judge-readings.json#at`）；读不到 ⇒ `null`（不许瞎猜成"刚刚"） */
export function lastFullJudgeAt(root) {
  try {
    const p = path.join(root, '.agent-io', 'judge-readings.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const at = typeof j?.at === 'string' ? j.at : '';
    return at && !Number.isNaN(Date.parse(at)) ? at : null;
  } catch {
    return null;
  }
}

/**
 * 来源三：`cache.db#scan_changes` —— **最近一次全量扫描窗口**的逐文件 diff。
 * ★ 打不开 / 没有表 / 没有行 ⇒ 各是各的原因，都带出去（"读不到 ≠ 没改"）。
 * ★ 只取 `MAX(scan_id)` 那一窗：整表 300+ 窗的行加起来 ≈ "这个仓历史上一共改过什么"（几乎是全仓），
 *   拿它当选量输入等于把增量退化成全量，而且**看不出**退化。
 */
function scanChangesRecent(root) {
  let db = null;
  try {
    const file = path.join(root, '.agent-io', 'cache.db');
    if (!fs.existsSync(file)) return { ok: false, paths: [], reason: `没有索引库 ${'.agent-io/cache.db'}` };
    // 延迟 require：只有真要读库的调用方才付 node:sqlite 的加载成本
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    const maxRow = db.prepare('SELECT MAX(scan_id) AS id FROM scan_changes').get();
    const id = maxRow?.id ?? null;
    if (id === null) return { ok: true, paths: [], reason: 'scan_changes 一条都没有（从没跑过全量扫描 ⇒ 这条来源为空）' };
    const rows = db.prepare('SELECT path FROM scan_changes WHERE scan_id = $id').all({ id });
    return { ok: true, paths: rows.map((r) => normChangedPath(r.path)).filter(Boolean), scan_id: id };
  } catch (e) {
    return { ok: false, paths: [], reason: `cache.db#scan_changes 读不了：${String(e?.message ?? e).slice(0, 160)}` };
  } finally {
    try {
      db?.close();
    } catch {
      /* 关不掉不改结论 */
    }
  }
}

/**
 * **改动集**（并集 + 每条来源的实况）。
 *
 * @returns {{
 *   paths: string[],
 *   sources: {scan_changes: object, git_worktree: object, git_since_last_judge: object},
 *   unavailable: string|null
 * }}
 *   `unavailable` = **至少一条来源读不到**的说明（调用方据此回落全量并打印）。
 *   ★ 三条都读不到 ⇒ `paths: []` + `unavailable` 非空 ⇒ 调用方**必须**回落全量。
 */
export function changedPathsOf(root, opts = {}) {
  const since = opts.since ?? lastFullJudgeAt(root);
  const scan = scanChangesRecent(root);
  const work = gitWorktree(root);
  const sinceLog = gitSince(root, since);
  const sources = {
    scan_changes: { ok: scan.ok, rows: scan.paths.length, reason: scan.reason ?? '', scan_id: scan.scan_id ?? null },
    git_worktree: { ok: work.ok, rows: work.paths.length, reason: work.reason ?? '' },
    git_since_last_judge: { ok: sinceLog.ok, rows: sinceLog.paths.length, reason: sinceLog.reason ?? '', since },
  };
  const set = new Set();
  for (const src of [scan, work, sinceLog]) {
    for (const p of src.paths) {
      // ★ 运行时 db/-shm/-wal 产物不进改动集（窄模式 fail-closed，见 isRuntimeDbArtifact）。
      if (p && !isRuntimeDbArtifact(p)) set.add(p);
    }
  }
  // ★ "读不到"的判定：**三条来源全失败**才算不可用（有一条成立就至少有可信的部分）；
  //   全部失败 ⇒ 不许把这当成"没有改动"（0.12）。
  const allFailed = !scan.ok && !work.ok && !sinceLog.ok;
  const unavailable = allFailed
    ? `三条来源都读不到：${[scan.reason, work.reason, sinceLog.reason].filter(Boolean).join(' · ')}`
    : null;
  return { paths: [...set].sort(), sources, unavailable };
}
