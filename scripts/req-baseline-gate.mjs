#!/usr/bin/env node
/**
 * req-baseline-gate —— 「**派生条目无要求权**」的门（AGENTS **0.29⑥** · `npm run verify` 第 13 道门 · 2026-11-04）
 *
 * ## 它治哪个洞（0.25：缺陷必须沉淀为检测点）
 * 0.29⑥ 说得很清楚：`expected_apis` 里的**派生条目**（`notes` 带 `from:cache.db@<rev>`）不承载人类意图，
 * 分歧时该改源码的才叫"要求"，派生条目**只有基线权**。可它的失效形态是**静默**的：
 *
 * ```
 * 1. 派生条目在册（notes = from:cache.db@<rev>）
 * 2. 有人重构把形参改名：源码 f(enabled)，册里还写着 f(flag) ⇒ drift 变红
 * 3. 最省事的操作：把册改回 (enabled)，源码不动 ⇒ 门变绿
 * 4. 后果：该条目与源码永远同源 ⇒ 再也报不出"这里被改过" ⇒ 设计册退化成纯镜像，而它的绿是伪造的
 * ```
 * 在这扇门之前，这条判据**只存在于文档里**（`AGENTS.md` 0.29⑥ + `docs/FIELD-ALIGNMENT.md`）——
 * 谁把册改回源码，**没有任何机器会发现**。
 *
 * ## 判据（三情形；判定核住 `src/domain/req_baseline.ts`，本文件**不重写**）
 * 对每个窗口内**被改动的**条目（改前/改后都在 ⇒ 才进入判定）：
 * | 优先 | 情形 | 判 |
 * |---|---|---|
 * | 1 | 只有一侧（新增 / 删除） | **不判** —— 「删 + 重派生」是 0.29⑥ 点名的唯一合法基线更新路径 |
 * | 2 | 两侧都不是派生条目 | **不判** —— 人写契约 / 其它来源的派生 |
 * | 3 | **情形 C**：同窗口内该条目对应的**源码文件**也被改过 | **放行** —— 设计线的正常顺序 |
 * | 4 | **情形 A**：改后签名 == `cache.db` 此刻 | **红** —— 手改字面量冒充基线 |
 * | 5 | **情形 B**：改后签名 != `cache.db`（= 真提升） | 有凭证 ⇒ 绿；无凭证 ⇒ **红** |
 *
 * ### 为什么情形 C 必须有（0.16）
 * 设计线本来就要"先改册、再改码"（甚至分两个 commit）。若"册变了码没变"一律判红，这扇门**永远亮**
 * ⇒ 一堆真红被一起忽略。缺省口径 = **同一 commit / 同一工作区变更**内有源码改动就放行。
 * ★ 取「同 commit」而不取「同 PR / 同分支」的依据（本仓实测；改动这段前先复算）：
 *   · 最近 **25** 个碰过 `.agent-io/design/*.dsl.json` 的提交里，**没有一个**是"只改册、不改任何源码"；
 *   · 最近 **40** 个提交逐个 commit 跑本门：**红 0**；其中发生过条目改动的两个提交读数是
 *     `163296df` 新增 4 / 改 0、`a7f31249` 新增 3064 / 改 0 ⇒ 历史上**从未**出现"改派生条目"这个动作。
 *   ⇒ 设计线在本仓不跨 commit。取 PR 口径要把窗口放宽到整个分支（那时**定位不到**是哪次提交违反的），
 *     而实测没有需要它的场景。若将来真出现"册在前、码在后"的两次提交，这里必须改成 PR 口径并重跑上表。
 *
 * ★ **情形 C 的口径是「该条目对应的源码文件」**，不是"任一源码改动"：
 *   拿 `expected_apis` 的 `path` 去和窗口变更集比（两侧按后缀归一，因为册里的 path 可能相对 `source_root`）。
 *   ⇒ 洞（已封）：若写成"任一变就放行"，则"改 X 的册 + 顺手改 Y 的源码"就能过门。
 *   ⇒ 代价（已声明）：同一次重构里"册改在前、码改在后"分两个 commit ⇒ 前一个 commit 会红（0.16 的反向：宁可这一步红，也不许整门永久亮）。
 *
 * ### 凭证（情形 B）的可判形态
 * 必须有一条**指名**（`path` + `symbol`）的判据：
 * · `signature-matches` 且**其签名与改后那条一致**（归一后逐字），或 `behavior-cases`。
 * ★ `symbol-exists` / `source-has` / `file-exists` **不算** —— 存在类判据说不出"要求是什么"（0.2）。
 *
 * ## 输入（两条通路）
 * · **git 窗口**（`verify` 用）：缺省 = `工作区（HEAD vs 磁盘 ∪ 未跟踪）` ∪ `最近一次提交（HEAD~1..HEAD）`；
 *   也可 `--range A..B` / `--worktree` / `--commit` 只取一条。
 * · **显式两版 DSL**（人工与测试用）：`--old-dsl <file> --new-dsl <file>` —— 不经 git。
 *   ★ 这条通路**判不了情形 C**（手上没有源码变更集），故如实印一行"本窗口只用于人工/测试"，**不静默**。
 *
 * ## 三态（与总门同口径）
 * **0** 没有未登记的红 · **1** 红（逐条点名：窗口 · 文件 · 符号 · 改前→改后 · 情形 · 该怎么修）·
 * **2** 判不了（dist 不在 / cache.db 不在 / git 不可用 / DSL 读不了）—— ★ 不折成 0，也不折成 1。
 *
 * ## 读数带分母（0.12③）
 * `条目改动 K（改 c / 新增 a / 删除 d）· 人写或非派生跳过 h · 新增删除不判 s · 情形 C 放行 x · 红 y（A p / B q）`
 *
 * ## 已知边界（0.17①）
 * · 只判**签名**这一列（`expected_apis[].signature`）；`expected_deps` / `contract` 的派生条目不在内（同族另卡）。
 * · `cache.db` 陈旧时"实际签名"可能是旧值 ⇒ 判不出情形 A ⇒ 落到情形 B ⇒ 仍要凭证 ⇒ **只严不松**（不会假绿）。
 * · 派生标志取 `oldEntry` **或** `newEntry` 其一命中 `from:cache.db@` 即算 —— 否则"把 notes 一并删掉"就能
 *   从情形 A 逃到"人写条目"（0.29⑥ 的禁用形态）。判据见 `src/domain/req_baseline.ts` 文件头。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, dflt) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const asJson = flag('json');

const UNSUPPORTED = 2;
const project = path.resolve(arg('project', process.cwd()));
/** 严格档：基线不参与 ⇒ 已登记存量也计入红（收尾清零验收用） */
const strict = flag('strict') || flag('no-baseline');
const allow = !strict && (flag('allow-req-baseline') || process.env.AGENT_IO_ALLOW_REQ_BASELINE === '1');
const baselineFile = path.resolve(arg('baseline', path.join(SCRIPT_DIR, 'req-baseline-baseline.json')));
const rangeArg = arg('range', '');
const oldDslArg = arg('old-dsl', '');
const newDslArg = arg('new-dsl', '');

const die = (why) => {
  if (asJson) console.log(JSON.stringify({ ok: false, unsupported: true, project, why }, null, 2));
  else {
    console.error('════ 派生条目要求权（verify 门 · 0.29⑥）════');
    console.error(`项目：${project}`);
    console.error(`✗ 判不了（退出码 ${UNSUPPORTED}）：${why}`);
  }
  process.exit(UNSUPPORTED);
};

// ────────────────────────────────────────────────────────────────
// 判定核只在 dist/（与其余门同一前提）—— 拿不到就是"判不了"，不许在本文件里再撸一遍
// ────────────────────────────────────────────────────────────────
const distUrl = (...p) => pathToFileURL(path.join(REPO_ROOT, 'dist', 'src', ...p)).href;
let judgeDerivedEntryChange;
let diffDerivedEntries;
let symbolOfSignature;
let normSignature;
let normPath;
let collectExpectations;
let DERIVED_NOTES_PREFIX;
let fileFacts;
let findCacheDb;
let openDb;
let scanRevOf;
try {
  ({ judgeDerivedEntryChange, diffDerivedEntries, symbolOfSignature } = await import(
    distUrl('domain', 'req_baseline.js')
  ));
  ({ normSignature, normPath, collectExpectations } = await import(distUrl('domain', 'expectation.js')));
  ({ DERIVED_NOTES_PREFIX } = await import(distUrl('application', 'meta', 'registry', 'project_actual_fields.js')));
  ({ fileFacts } = await import(distUrl('infrastructure', 'index', 'file_facts.js')));
  ({ findCacheDb, openDb } = await import(distUrl('infrastructure', 'index', 'db.js')));
  ({ scanRevOf } = await import(distUrl('infrastructure', 'index', 'scan_rev.js')));
} catch (e) {
  die(
    `读不到判定核（${(e && e.message) || e}）\n` +
      '  ★ 本脚本**不自己算**判定（0.9.1：同一判据只许一处实现）—— 它调的是\n' +
      '    `domain/req_baseline.ts#judgeDerivedEntryChange` / `#diffDerivedEntries` / `#symbolOfSignature`。\n' +
      '  ⇒ 先 `npm run build`（dist 必须比 src 新）。',
  );
}

// ────────────────────────────────────────────────────────────────
// 窗口
// ────────────────────────────────────────────────────────────────
if (oldDslArg || newDslArg) {
  if (!oldDslArg || !newDslArg) die('`--old-dsl` 与 `--new-dsl` 必须成对给（只给一侧判不出"改了什么"）');
}

function windows() {
  if (oldDslArg && newDslArg) {
    return [
      {
        label: `显式两版 DSL（${oldDslArg} → ${newDslArg}）`,
        kind: 'files',
        oldFile: path.resolve(project, oldDslArg),
        newFile: path.resolve(project, newDslArg),
      },
    ];
  }
  if (rangeArg) {
    const [base, head] = rangeArg.split('..');
    if (!base || !head) die(`--range 要 \`A..B\` 形式（收到 "${rangeArg}"）`);
    return [{ label: `提交区间 ${rangeArg}`, kind: 'git', base, head }];
  }
  const onlyWT = flag('worktree') && !flag('commit');
  const onlyCommit = flag('commit') && !flag('worktree');
  const wt = { label: '工作区（HEAD vs 磁盘 ∪ 未跟踪）', kind: 'git', base: 'HEAD', head: null };
  const last = { label: '最近一次提交（HEAD~1..HEAD）', kind: 'git', base: 'HEAD~1', head: 'HEAD' };
  if (onlyWT) return [wt];
  if (onlyCommit) return [last];
  return [wt, last];
}

// ────────────────────────────────────────────────────────────────
// git
// ────────────────────────────────────────────────────────────────
function git(args) {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, error: r.error.message };
  if (r.status !== 0) {
    const first = String(r.stderr ?? '')
      .trim()
      .split('\n')[0];
    return { ok: false, error: first || `退出码 ${r.status}` };
  }
  return { ok: true, out: r.stdout };
}

const WINDOWS = windows();
if (WINDOWS.some((w) => w.kind === 'git')) {
  const probe = git(['rev-parse', '--is-inside-work-tree']);
  if (!probe.ok) die(`git 不可用（或 ${project} 不是 git 仓库）：${probe.error} ⇒ 判不了"哪些设计册条目被改过"`);
}

// ────────────────────────────────────────────────────────────────
// 事实：cache.db 此刻该符号的签名（路径解析复用 fileFacts —— 别处不再写一份"怎么在库里找这个文件"）
// ────────────────────────────────────────────────────────────────
const dbPath = findCacheDb({ sourceRoot: project });
if (!dbPath || !fs.existsSync(dbPath)) {
  die(
    `cache.db 不在（${dbPath ?? '<无候选>'}）⇒ 判不了情形 A/B（"改后签名是否等于源码当前值"没有对照物）\n` +
      '  ★ 这不是"没有违规"（0.12：判不了 ⇒ 单独成态，不许折成通过）。\n' +
      '  ⇒ 先 `import_project`（或任一读工具触发保鲜）建索引后重跑。',
  );
}
const db = openDb(dbPath);
let scanRev = null;
try {
  scanRev = scanRevOf({ sourceRoot: project })?.rev ?? null;
} catch {
  scanRev = null;
}

/** `path#symbol` → 归一后的实际签名（`null` = 索引里查不到 / 文件未被索引） */
const actualCache = new Map();
function actualSignatureOf(fileRel, symbol) {
  const key = `${normPath(fileRel)}#${symbol}`;
  if (actualCache.has(key)) return actualCache.get(key);
  let value = null;
  try {
    const facts = fileFacts(project, normPath(fileRel));
    if (facts.matched_path) {
      const row = db
        .prepare(
          `SELECT signature FROM nodes
            WHERE file_path = ? AND name = ? AND kind <> 'file' AND signature IS NOT NULL
            ORDER BY start_line LIMIT 1`,
        )
        .get(facts.matched_path, symbol);
      if (row && typeof row.signature === 'string') value = normSignature(row.signature);
    }
  } catch {
    value = null; // 库坏/锁 ⇒ 当"查不到"（走情形 B：只严不松，见文件头"已知边界"）
  }
  actualCache.set(key, value);
  return value;
}

// ────────────────────────────────────────────────────────────────
// DSL → 条目表 / 凭证表
// ────────────────────────────────────────────────────────────────
function flattenDsl(dsl) {
  const out = [];
  for (const f of dsl?.semantic?.files ?? []) {
    const p = normPath(String(f?.path ?? ''));
    if (!p) continue;
    for (const a of f?.expected_apis ?? []) {
      const raw = String(a?.signature ?? '');
      if (!raw) continue;
      out.push({
        path: p,
        symbol: symbolOfSignature(raw),
        signature: normSignature(raw),
        derived: String(a?.notes ?? '').includes(DERIVED_NOTES_PREFIX),
      });
    }
  }
  return out;
}

function credentialsOf(dsl) {
  /** @type {Map<string, {behavior:boolean, signatures:string[]}>} */
  const byKey = new Map();
  let scanned = 0;
  for (const it of collectExpectations(dsl)) {
    const e = it.expectation;
    if (e.kind !== 'signature-matches' && e.kind !== 'behavior-cases') continue;
    const p = normPath(String(e.path ?? ''));
    const s = String(e.symbol ?? '');
    if (!p || !s) continue;
    scanned++;
    const key = `${p}#${s}`;
    const cur = byKey.get(key) ?? { behavior: false, signatures: [] };
    if (e.kind === 'behavior-cases') cur.behavior = true;
    else cur.signatures.push(normSignature(String(e.signature ?? '')));
    byKey.set(key, cur);
  }
  return { byKey, scanned };
}

function credentialOf(creds, p, symbol, newSignature) {
  const hit = creds.byKey.get(`${p}#${symbol}`);
  if (!hit) return 'none';
  if (hit.behavior) return 'behavior-cases';
  if (hit.signatures.some((s) => s === newSignature)) return 'signature-matches';
  return 'none';
}

// ────────────────────────────────────────────────────────────────
// 读两版
// ────────────────────────────────────────────────────────────────
const readGitAt = (rev, rel) => {
  const r = git(['show', `${rev}:${rel}`]);
  return r.ok ? r.out : null;
};
const readWorktree = (rel) => {
  try {
    return fs.readFileSync(path.join(project, rel), 'utf8');
  } catch {
    return null;
  }
};
const parseDsl = (text, where) => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    die(`设计册不是合法 JSON（${where}）：${(e && e.message) || e} ⇒ 判不了（不猜"大概没改"）`);
  }
};

// ────────────────────────────────────────────────────────────────
// 主循环
// ────────────────────────────────────────────────────────────────
const judged = [];
const windowReadings = [];

for (const w of WINDOWS) {
  /** 本窗口改动过的文件（仓库相对、posix）；`null` = 拿不到变更集（显式两版通路） */
  let changed = null;
  let dslFiles = [];
  let note = '';

  if (w.kind === 'git') {
    const baseOk = git(['rev-parse', '--verify', `${w.base}^{commit}`]);
    if (!baseOk.ok) {
      windowReadings.push({ label: w.label, skipped: `base 版本取不到（${w.base}：${baseOk.error}）⇒ 本窗口没查` });
      continue;
    }
    if (w.head && w.head !== 'HEAD') {
      const headOk = git(['rev-parse', '--verify', `${w.head}^{commit}`]);
      if (!headOk.ok) die(`窗口「${w.label}」的 head 版本取不到（${w.head}）：${headOk.error}`);
    }
    const r = git(['diff', '--name-only', w.base, ...(w.head ? [w.head] : [])]);
    if (!r.ok) die(`窗口「${w.label}」取不到改动清单：${r.error}`);
    changed = String(r.out)
      .split('\n')
      .map((s) => normPath(s.trim()))
      .filter(Boolean);
    if (!w.head) {
      // 工作区口径还要算上**未跟踪**文件：否则"新建源码 + 改册"会被判成情形 A（假红）
      const u = git(['ls-files', '--others', '--exclude-standard']);
      if (u.ok) {
        for (const p of String(u.out)
          .split('\n')
          .map((s) => normPath(s.trim()))
          .filter(Boolean))
          changed.push(p);
      }
    }
    dslFiles = changed.filter((p) => /^\.agent-io\/design\/.*\.dsl\.json$/.test(p));
  } else {
    dslFiles = [path.relative(project, w.oldFile).split(path.sep).join('/')];
    note =
      '本窗口是**显式两版 DSL**（人工/测试通路）⇒ 没有源码变更集 ⇒ **情形 C 判不了**' +
      '（既不因此判红，也不因此放行别的情形）';
  }

  const perWindow = { label: w.label, changed_files: changed ? changed.length : null, dsl_files: 0, changes: 0, note };
  for (const rel of dslFiles) {
    let oldText;
    let newText;
    if (w.kind === 'git') {
      oldText = readGitAt(w.base, rel);
      newText = w.head ? readGitAt(w.head, rel) : readWorktree(rel);
    } else {
      try {
        oldText = fs.readFileSync(w.oldFile, 'utf8');
      } catch {
        oldText = null;
      }
      try {
        newText = fs.readFileSync(w.newFile, 'utf8');
      } catch {
        newText = null;
      }
    }
    if (newText === null) {
      perWindow.note = `${perWindow.note ? `${perWindow.note} · ` : ''}${rel} 的改后版本读不到（删了？）⇒ 本文件跳过`;
      continue;
    }
    const oldDsl = parseDsl(oldText, `${w.label} · ${rel} · 改前`);
    const newDsl = parseDsl(newText, `${w.label} · ${rel} · 改后`);
    const oldEntries = oldDsl ? flattenDsl(oldDsl) : [];
    const newEntries = flattenDsl(newDsl);
    const creds = credentialsOf(newDsl);
    perWindow.dsl_files++;
    perWindow.credentials = (perWindow.credentials ?? 0) + creds.scanned;

    for (const c of diffDerivedEntries(oldEntries, newEntries)) {
      perWindow.changes++;
      // 情形 C：该条目对应的**源码文件**在本窗口内也被改过？（两侧按后缀归一：DSL path 可能相对 source_root）
      const sourceChanged = changed
        ? changed.some((f) => f === c.path || f.endsWith(`/${c.path}`) || c.path.endsWith(`/${f}`))
        : false;
      const j = judgeDerivedEntryChange({
        oldEntry: c.oldEntry,
        newEntry: c.newEntry,
        actualSignature: c.newEntry ? actualSignatureOf(c.path, c.symbol) : null,
        sourceChanged,
        credential: c.newEntry ? credentialOf(creds, c.path, c.symbol, c.newEntry.signature) : 'none',
      });
      judged.push({
        window: w.label,
        path: c.path,
        symbol: c.symbol,
        kind: c.kind,
        oldSig: c.oldEntry ? c.oldEntry.signature : null,
        newSig: c.newEntry ? c.newEntry.signature : null,
        verdict: j.verdict,
        case: j.case,
        ok: j.ok,
        why: j.why,
      });
    }
  }
  windowReadings.push(perWindow);
}

// ────────────────────────────────────────────────────────────────
// 基线（棘轮：只冻结已登记存量，每条必须带 reason；**新增恒红**）
// ────────────────────────────────────────────────────────────────
let baseline = { note: '', rows: [] };
let baselineReadError = '';
try {
  if (fs.existsSync(baselineFile)) {
    const raw = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
    baseline = {
      note: String(raw.note ?? ''),
      rows: (raw.rows ?? []).filter((x) => x && x.key && String(x.reason ?? '').trim()),
    };
  } else baselineReadError = `基线文件不存在：${baselineFile}`;
} catch (e) {
  // 读不了 ≠ 没有（0.12）：坏基线既不许静默当空（存量会全变红），也不许静默当"什么都登记过"
  baselineReadError = `基线读不了（${(e && e.message) || e}）：${baselineFile}`;
}

const keyOf = (r) =>
  `${r.path}#${r.symbol}|${r.oldSig === null ? '-' : r.oldSig} -> ${r.newSig === null ? '-' : r.newSig}`;
const baseKeys = new Set(baseline.rows.map((x) => x.key));
const reds = judged.filter((r) => !r.ok);
const newReds = allow ? reds.filter((r) => !baseKeys.has(keyOf(r))) : reds;
const exempted = allow ? reds.length - newReds.length : 0;
const staleBaseline = baseline.rows.filter((x) => !reds.some((r) => keyOf(r) === x.key));

// ────────────────────────────────────────────────────────────────
// 读数 + 结论
// ────────────────────────────────────────────────────────────────
const counts = {
  windows: WINDOWS.length,
  changed_files: windowReadings.reduce((n, w) => n + (w.changed_files ?? 0), 0),
  dsl_files: windowReadings.reduce((n, w) => n + (w.dsl_files ?? 0), 0),
  changes: judged.length,
  changed: judged.filter((r) => r.kind === 'changed').length,
  added: judged.filter((r) => r.kind === 'added').length,
  deleted: judged.filter((r) => r.kind === 'deleted').length,
  not_derived: judged.filter((r) => r.verdict === 'pass-not-derived').length,
  case_c: judged.filter((r) => r.verdict === 'pass-source-changed').length,
  credentialed: judged.filter((r) => r.verdict === 'pass-credentialed').length,
  skipped_side: judged.filter((r) => r.verdict === 'skip-added' || r.verdict === 'skip-deleted').length,
  red_a: reds.filter((r) => r.case === 'A').length,
  red_b: reds.filter((r) => r.case === 'B').length,
  reds: reds.length,
  new_reds: newReds.length,
  exempted,
};

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: newReds.length === 0,
        project,
        db: dbPath,
        scan_rev: scanRev,
        allow,
        strict,
        baseline_file: baselineFile,
        baseline_read_error: baselineReadError || undefined,
        windows: windowReadings,
        counts,
        reds: reds.map((r) => ({
          window: r.window,
          file: r.path,
          symbol: r.symbol,
          case: r.case,
          before: r.oldSig,
          after: r.newSig,
          why: r.why,
        })),
        baseline_stale: allow ? staleBaseline.map((x) => x.key) : undefined,
      },
      null,
      2,
    ),
  );
  process.exit(newReds.length ? 1 : 0);
}

console.log('════ 派生条目要求权（verify 门 · 0.29⑥）════');
console.log(`项目：${project}`);
console.log(`事实源：${path.relative(REPO_ROOT, dbPath).split(path.sep).join('/')}（扫描代 ${scanRev ?? '读不到'}）`);
console.log('');
for (const w of windowReadings) {
  if (w.skipped) {
    console.log(`· ${w.label}：**没查** —— ${w.skipped}`);
    continue;
  }
  console.log(
    `· ${w.label}：改动文件 ${w.changed_files === null ? '拿不到（显式两版通路）' : w.changed_files} · ` +
      `其中设计册 ${w.dsl_files} · 条目改动 ${w.changes}` +
      (w.credentials ? ` · 扫到的凭证判据 ${w.credentials} 条` : ''),
  );
  if (w.note) console.log(`  ★ ${w.note}`);
}
console.log('');
console.log(
  `汇总：条目改动 ${counts.changes}（改 ${counts.changed} / 新增 ${counts.added} / 删除 ${counts.deleted}）· ` +
    `人写或非派生跳过 ${counts.not_derived} · 新增删除不判 ${counts.skipped_side} · ` +
    `情形 C 放行 ${counts.case_c} · 有凭证 ${counts.credentialed} · **红 ${counts.reds}**（A ${counts.red_a} / B ${counts.red_b}）`,
);
// ★ 两条**声明边界**必须进读数（不是只进代码注释）：读端要能区分"没有发生"与"发生了但本门不管"（0.12③）。
console.log(
  `口径：情形 C = **该条目对应的源码文件**在窗口变更集内（不是"任一源码改动"）；` +
    `本次删除派生条目 ${counts.deleted} 条 · **不判红**（0.29⑥：删基线不产生伪造的绿，而"删 + 重派生"是唯一合法更新路径 —— 故单列计数，不改判定）`,
);
console.log(`基线：${path.relative(REPO_ROOT, baselineFile).split(path.sep).join('/')} —— 登记 ${baseline.rows.length} 条`);
if (baselineReadError) console.log(`  ★ ${baselineReadError}`);
if (allow) {
  // ★ 「已登记豁免 N」必须进读数：不出现就无法区分"没有红"与"红被静默吞掉"（0.12）
  console.log(`★ 已登记豁免 ${exempted} 条 · 新增红 ${newReds.length}（基线只许不增）`);
} else {
  console.log(`★ 已登记豁免 0 · 红 ${counts.reds}（★ 严格档：基线不参与）`);
}
if (staleBaseline.length) {
  console.log(`  ★ 已消失的基线条目 ${staleBaseline.length} 条（可以删，删不影响判定）：`);
  for (const s of staleBaseline.slice(0, 5)) console.log(`     · ${s.key}`);
}
console.log('');
if (newReds.length) {
  console.log(`✗ ${newReds.length} 条违规（逐条点名：窗口 · 文件 · 符号 · 改前 → 改后 · 情形 · 该怎么修）：`);
  for (const [i, r] of newReds.entries()) {
    console.log(
      `  ${String(i + 1).padStart(3)}. [情形 ${r.case}] ${r.path} · ${r.symbol} · ` +
        `\`${r.oldSig ?? '-'}\` → \`${r.newSig ?? '-'}\`（窗口：${r.window}）`,
    );
    console.log(`       ${r.why}`);
  }
  console.log('');
  console.log(
    `FAIL  派生条目要求权：${newReds.length} 条未登记违规` +
      `（A ${newReds.filter((r) => r.case === 'A').length} / B ${newReds.filter((r) => r.case === 'B').length}）· ` +
      `判了 ${counts.changes} 条条目改动`,
  );
  process.exit(1);
}
console.log(
  `PASS  派生条目要求权：判了 ${counts.changes} 条条目改动，0 条违规` +
    `（人写跳过 ${counts.not_derived} · 情形 C 放行 ${counts.case_c} · 新增删除不判 ${counts.skipped_side}` +
    `${allow ? ` · 已登记豁免 ${exempted}` : ''}）`,
);
process.exit(0);
