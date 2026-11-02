#!/usr/bin/env node
/**
 * inventory-sweep —— 清点机制：封闭清单 × 强结构化表单 × 未填显形 × 重扫对账 × 断点续跑
 *
 * ## 它治的病
 * 有封闭清单的对象（工具面 / 判据 / 门）能被对账；没有清单的对象（domain 模块 / scripts / tests）
 * 会反复长出重复件，而没人知道有几件。语义相似度抓不到「同功能不同名」（实测），
 * 所以机制取另一条路：先枚举封闭清单，再逼逐项填同一张表，未填的进读数。
 *
 * ## 判据（每条可判真假；计数一律由本脚本自己 readdir 现算，别处不许写死）
 * · 清单 = `<dir>` 下 `<ext>` 文件的全部 ⇒ 条数由本脚本打印；
 * · 台账里每一项恒有状态，且只有三值：`done`（已清点）/ `pending`（未清点）/ `stale`（待复核）；
 *   未清点 = pending ∪ stale ∪ 台账缺项，读数逐项点名，不许静默跳过；
 * · 重扫时：新出现的项 ⇒ `pending`；内容哈希变了的项 ⇒ `stale`；哈希没变的项状态原样保留；
 * · 表单字段固定为 question / authority / overlap / criteria ⇒ 多出任何一个键即拒收（自由散文不进台账）；
 * · `overlap` 要求 ≥2 个具体候选（说不出「跟谁比了」不算结论），`相同` 必带 `merge_into`；
 * · 提交被拒的项逐条点名原因，状态仍是 `pending`（拒收 ≠ 清点）。
 *
 * ## 一处权威
 * · 清单从磁盘现算，不在台账里存第二份；台账只存「这一项被清点成了什么」+ 那一版内容哈希；
 * · `consumers` 不靠填表人猜：每次重扫从符号索引（`cache.db` 的 imports 边）重算并覆盖；
 *   索引读不到 ⇒ 该字段为 null 且读数里点名原因（读不到 ≠ 没有）。
 *
 * ## 用法
 *   node scripts/inventory-sweep.mjs                     重扫 + 读数（写台账）
 *   node scripts/inventory-sweep.mjs --json              机器读
 *   node scripts/inventory-sweep.mjs --batch 8 --index 0 只打印这一批：待清点项的事实 + 空表单
 *   node scripts/inventory-sweep.mjs --submit ans.json   校验并合入（拒收项逐条点名）
 *   --dir / --ext 换封闭清单（默认 src/domain + .ts）· --root 换项目根（默认脚本所在仓）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 台账形状版本（改形状必须升它，否则旧台账会被按新形状读） */
const SCHEMA = 'inventory/1';
/** 表单字段 = 闭集。多出的键一律拒收 —— 这是「自由散文不收」的可判形态 */
const FORM_FIELDS = ['question', 'authority', 'overlap', 'criteria'];
/** overlap 表态 = 闭集 */
const VERDICT = ['不同', '相同'];
/** 台账落盘位置（相对项目根）：走 dogfood/ 而不是 .agent-io/ —— 后者被 gitignore，台账要可 diff */
const LEDGER_DIR = 'dogfood/inventory';

// ════════════════════════════════════════════════════════════════
// 纯函数（judge 的 behavior-cases 直接跑这几个，无 I/O、无环境态）
// ════════════════════════════════════════════════════════════════

/**
 * 校验一张表单。判据全部是「形状 / 闭集 / 点名」，不做任何语义判断。
 * @param {unknown} form 提交的表单
 * @param {readonly string[]} closed 封闭清单（`with` / `merge_into` 只能取这里的项）
 * @returns {{ok: boolean, problems: Array<{code: string, detail: string}>}}
 */
export function validateForm(form, closed) {
  /** @type {Array<{code: string, detail: string}>} */
  const problems = [];
  const add = (code, detail) => problems.push({ code, detail });
  if (!form || typeof form !== 'object' || Array.isArray(form)) {
    add('not_object', '表单必须是对象');
    return { ok: false, problems };
  }
  for (const k of Object.keys(form)) {
    if (!FORM_FIELDS.includes(k)) add('unknown_key', '多出的键不收（表单字段固定为 question / authority / overlap / criteria）：' + k);
  }
  if (typeof form.question !== 'string' || !form.question.trim()) {
    add('missing_question', 'question 缺失：它回答什么问题（一句话，且能与同批别项区分）');
  }
  const a = form.authority;
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    add('missing_authority', 'authority 缺失：这个问题的唯一住处 {file, symbol}');
  } else {
    if (typeof a.file !== 'string' || !a.file.trim()) add('bad_authority', 'authority.file 缺失');
    if (typeof a.symbol !== 'string' || !a.symbol.trim()) add('bad_authority', 'authority.symbol 缺失');
  }
  const ov = form.overlap;
  if (!Array.isArray(ov)) {
    add('missing_overlap', 'overlap 缺失：必须逐个表态（「没有重叠」不是结论，「跟谁比了、为什么不同」才是）');
  } else {
    if (ov.length < 2) {
      add('too_few_overlap', 'overlap 只有 ' + ov.length + ' 个候选 ⇒ 至少要比 2 个具体项');
    }
    ov.forEach((o, i) => {
      const at = 'overlap[' + i + ']';
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        add('bad_overlap', at + ' 不是对象');
        return;
      }
      for (const k of Object.keys(o)) {
        if (!['with', 'verdict', 'why', 'merge_into'].includes(k)) add('unknown_key', at + ' 多出的键不收：' + k);
      }
      const w = typeof o.with === 'string' ? o.with.trim() : '';
      if (!w) add('bad_overlap', at + '.with 缺失');
      else if (!closed.includes(w)) add('unknown_with', at + '.with 不在清单里：' + w);
      if (!VERDICT.includes(o.verdict)) add('bad_verdict', at + '.verdict 只能是 不同 / 相同，实得：' + String(o.verdict));
      if (typeof o.why !== 'string' || !o.why.trim()) add('missing_why', at + '.why 缺失（不同 / 相同都要说为什么）');
      if (o.verdict === '相同') {
        const m = typeof o.merge_into === 'string' ? o.merge_into.trim() : '';
        if (!m) add('missing_merge_into', at + ' 判「相同」却没给 merge_into（谁吞谁）');
        else if (!closed.includes(m)) add('bad_merge_into', at + '.merge_into 不在清单里：' + m);
        else if (m === w) add('bad_merge_into', at + '.merge_into 等于 with（自己吞自己不是合并）');
      }
    });
  }
  if (!('criteria' in form)) {
    add('missing_criteria', 'criteria 缺失：有判据/测试就给 ref（文件:行 或 判据 id），没有就显式写 null');
  } else if (form.criteria !== null) {
    if (!Array.isArray(form.criteria)) {
      add('bad_criteria', 'criteria 只能是 null 或数组');
    } else {
      form.criteria.forEach((x, i) => {
        const at = 'criteria[' + i + ']';
        if (!x || typeof x !== 'object' || typeof x.ref !== 'string' || !x.ref.trim()) {
          add('bad_criteria', at + '.ref 缺失（文件:行 或 判据 id）');
          return;
        }
        for (const k of Object.keys(x)) {
          if (!['ref', 'why'].includes(k)) add('unknown_key', at + ' 多出的键不收：' + k);
        }
      });
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 重扫对账：拿「上一版台账项」× 「这一版磁盘清单」算新台账。
 *
 * 判据（三档，且只有三档）：
 * · 清单里新出现的路径 ⇒ `pending`（未清点）；
 * · 已在台账里但内容哈希变了 ⇒ 曾清点过则 `stale`（待复核），从未清点过则仍 `pending`；
 * · 哈希没变 ⇒ 状态与表单原样保留（重扫不得把已清点项打回未清点）。
 * 台账里有、磁盘上已没有的项 ⇒ 丢弃并列进 `dropped`（清单是权威，台账不是）。
 *
 * @param {Record<string, {content_hash?: string, status?: string, form?: unknown}>} prevItems
 * @param {ReadonlyArray<{path: string, content_hash: string}>} current
 * @param {string} nowIso
 */
export function reconcile(prevItems, current, nowIso) {
  const prev = prevItems && typeof prevItems === 'object' ? prevItems : {};
  /** @type {Record<string, unknown>} */
  const items = {};
  const fresh = [];
  const changed = [];
  for (const cur of current) {
    const p = prev[cur.path];
    if (!p) {
      items[cur.path] = { content_hash: cur.content_hash, status: 'pending', form: null, updated_at: nowIso };
      fresh.push(cur.path);
      continue;
    }
    if (p.content_hash === cur.content_hash) {
      items[cur.path] = { ...p, content_hash: cur.content_hash };
      continue;
    }
    const wasFilled = !!p.form && p.status === 'done';
    items[cur.path] = {
      content_hash: cur.content_hash,
      status: wasFilled ? 'stale' : 'pending',
      form: p.form ?? null,
      updated_at: nowIso,
      previous_hash: p.content_hash ?? null,
    };
    changed.push(cur.path);
  }
  const alive = new Set(current.map((c) => c.path));
  const dropped = Object.keys(prev).filter((p) => !alive.has(p));
  return { items, readings: { fresh, changed, dropped } };
}

/**
 * 读数：清单 × 台账 ⇒ 计数 + 逐项点名。
 *
 * 判据：`total === done + pending + stale + missing`（无第四态、无缺失）；
 * `uncovered = pending + stale + missing` 就是「未清点」的全部，且每一项都点名。
 * @param {readonly string[]} paths 封闭清单（磁盘现算的那一份）
 * @param {Record<string, {status?: string}>} items 台账项
 */
export function sweepReport(paths, items) {
  const done = [];
  const pending = [];
  const stale = [];
  const missing = [];
  const third = [];
  const src = items && typeof items === 'object' ? items : {};
  for (const p of paths) {
    const it = src[p];
    if (!it || !it.status) {
      missing.push(p);
      continue;
    }
    if (it.status === 'done') done.push(p);
    else if (it.status === 'pending') pending.push(p);
    else if (it.status === 'stale') stale.push(p);
    else third.push(p + ':' + String(it.status));
  }
  const uncovered = [...pending, ...stale, ...missing];
  return {
    total: paths.length,
    done,
    pending,
    stale,
    missing,
    third,
    uncovered,
    accounted: done.length,
    consistent: done.length + pending.length + stale.length + missing.length === paths.length && third.length === 0,
  };
}

/**
 * 一个台账项在这一版清单里的结论（单值，`reconcile` 的逐项投影）。
 *
 * 判据（四值，闭集）：`done`（已清点且内容没变）/ `pending`（未清点）/ `stale`（清点过但内容变了 ⇒ 待复核）
 * / `dropped`（台账里有、清单里已没有）。★ 第四值在这里是清单侧的回答；
 * 台账侧「某项没有状态」由 `sweepReport` 的 `missing` 回答 —— 两者不是一回事，别混。
 */
export function statusAfterReconcile(prevItems, current, nowIso, rel) {
  const r = reconcile(prevItems, current, nowIso);
  if (!Object.prototype.hasOwnProperty.call(r.items, rel)) return 'dropped';
  return String(r.items[rel].status);
}

/**
 * 校验结果的可判形态（一行字符串）：`problemCodes(form, closed)`。
 * 用它的理由不是好读，是「判据要能比对」—— behavior-cases 比的是字符串（不是对象）。
 * ★ 它只转调 `validateForm`，不另判一次（否则就是两把尺）。
 */
export function problemCodes(form, closed) {
  return validateForm(form, closed)
    .problems.map((p) => p.code)
    .join('|');
}

/**
 * 读数的可判形态（一行字符串）：计数 + 未清点项逐个点名。
 * 判据：`total = done + pending + stale + missing`（`consistent=true`）；未清点项必须出现在 `uncovered=[…]` 里。
 */
export function renderReadings(report) {
  const n = (x) => x.length;
  return (
    'total=' + report.total +
    ' done=' + n(report.done) +
    ' pending=' + n(report.pending) +
    ' stale=' + n(report.stale) +
    ' missing=' + n(report.missing) +
    ' third=' + n(report.third) +
    ' uncovered=' + n(report.uncovered) +
    ' consistent=' + String(report.consistent) +
    ' uncovered=[' + report.uncovered.join(',') + ']'
  );
}

/**
 * 分批：给「待清点」清单切一片 —— 单次调用不许把所有项一次塞进上下文。
 * 判据：`slice.length <= size`、`slice` 是清单的前缀序切片、`batches` 覆盖全集。
 */
export function takeBatch(paths, size, index) {
  const n = Number(size) > 0 ? Math.floor(Number(size)) : paths.length;
  const i = Math.max(0, Math.floor(Number(index) || 0));
  const from = i * n;
  const slice = paths.slice(from, from + n);
  return {
    slice,
    total: paths.length,
    offset: from,
    size: n,
    batches: n > 0 ? Math.ceil(paths.length / n) : 0,
    remaining_after: Math.max(0, paths.length - (from + slice.length)),
  };
}

// ════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════

const posix = (p) => String(p).replace(/\\/g, '/');
const stripExt = (p) => posix(p).replace(/\.(d\.ts|[cm]?[jt]sx?|mjs|cjs)$/i, '');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readOpt = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const ledgerPathOf = (root, slug) => path.join(root, ...LEDGER_DIR.split('/'), slug + '.json');

/** 封闭清单：目录下 ext 文件的全量（非递归；条数由调用方打印，不写死） */
function listItems(root, dir, ext) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return { ok: false, reason: '目录不存在：' + dir, items: [] };
  const names = fs.readdirSync(abs, { withFileTypes: true });
  const items = names
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => posix(path.join(dir, e.name)))
    .sort();
  return { ok: true, reason: '', items };
}

/**
 * 从符号索引取机械事实：符号清单 + 消费者（imports 边）+ 索引新鲜度。
 * ★ 索引读不到 ⇒ ok:false + 原因（调用方必须点名，不许当成「没有任何消费者」）。
 */
async function factsFromIndex(root, rels) {
  const dbPath = path.join(root, '.agent-io', 'cache.db');
  if (!fs.existsSync(dbPath)) {
    return { ok: false, reason: '没有符号索引 .agent-io/cache.db ⇒ 消费者无法现取（先建索引，别猜）', symbols: {}, consumers: {}, staleImporters: [] };
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const allFiles = db.prepare('SELECT id, path, indexed_at FROM files').all();
    const byNoExt = new Map();
    for (const f of allFiles) byNoExt.set(stripExt(f.path), f.path);
    const pathOfId = new Map(allFiles.map((f) => [f.id, f.path]));
    // 符号：顶层声明（排除文件节点自身）
    const nodeRows = db.prepare("SELECT file_path, name, kind, start_line, signature FROM nodes WHERE kind != 'file'").all();
    /** @type {Record<string, Array<{name:string,kind:string,line:number,signature:string}>>} */
    const symbols = {};
    for (const n of nodeRows) {
      const rel = posix(n.file_path);
      if (!rels.includes(rel)) continue;
      (symbols[rel] ||= []).push({ name: n.name, kind: n.kind, line: Number(n.start_line), signature: String(n.signature ?? '') });
    }
    // 消费者：imports 的 source 解析成仓库相对路径后按目标归并
    const impRows = db.prepare('SELECT file_id, source, bindings FROM imports').all();
    /** @type {Record<string, Array<{file:string, bindings:string[], group:string}>>} */
    const consumers = {};
    const importersOf = new Map();
    for (const r of impRows) {
      const from = pathOfId.get(r.file_id);
      if (!from) continue;
      const spec = posix(r.source);
      if (!spec.startsWith('.')) continue; // 包名：不是仓内消费者
      const resolved = posix(path.posix.normalize(path.posix.join(path.posix.dirname(posix(from)), spec)));
      const target = byNoExt.get(stripExt(resolved));
      if (!target || !rels.includes(target)) continue;
      let bindings = [];
      try {
        bindings = JSON.parse(r.bindings ?? '[]');
      } catch {
        bindings = [];
      }
      const importer = posix(from);
      const group = importer.startsWith('tests/') ? 'tests' : importer.startsWith('src/') ? 'src' : importer.startsWith('scripts/') ? 'scripts' : 'other';
      (consumers[target] ||= []).push({ file: importer, bindings, group });
      if (!importersOf.has(target)) importersOf.set(target, new Set());
      importersOf.get(target).add(importer);
    }
    // 索引新鲜度（只对真正被引用到的 importer 算，成本与消费者数成正比）
    const staleImporters = [];
    for (const target of Object.keys(consumers)) {
      for (const importer of importersOf.get(target)) {
        const row = allFiles.find((f) => posix(f.path) === importer);
        const abs = path.join(root, importer);
        if (!row || !fs.existsSync(abs)) continue;
        const mtime = fs.statSync(abs).mtimeMs;
        const indexedAt = Date.parse(String(row.indexed_at ?? '')) || 0;
        if (indexedAt && mtime > indexedAt + 1000 && !staleImporters.includes(importer)) staleImporters.push(importer);
      }
    }
    for (const k of Object.keys(consumers)) consumers[k].sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : 0));
    return { ok: true, reason: '', symbols, consumers, staleImporters: staleImporters.sort() };
  } catch (err) {
    return { ok: false, reason: '读符号索引失败：' + err.message, symbols: {}, consumers: {}, staleImporters: [] };
  } finally {
    try {
      db.close();
    } catch {
      /* 关闭失败不影响读数 */
    }
  }
}

/** 台账读：坏台账要说出来（不许静默当空台账） */
function readLedger(file) {
  if (!fs.existsSync(file)) return { items: {}, exists: false };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { items: j && typeof j.items === 'object' && j.items ? j.items : {}, exists: true, schema: j.schema, spec: j.spec };
  } catch (err) {
    return { items: {}, exists: true, broken: '台账解析失败（' + err.message + '）⇒ 本次按空台账重扫' };
  }
}

/** 台账写：稳定 JSON（项按路径排序、键序由构造决定）⇒ 可 diff */
function writeLedger(file, spec, items) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = {};
  for (const k of Object.keys(items).sort()) sorted[k] = items[k];
  const body = { schema: SCHEMA, spec, updated_at: new Date().toISOString(), items: sorted };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return body;
}

/** 台账项的落盘形状（键序固定、overlap 与 criteria 排序 ⇒ 同一结论不因顺序产生 diff 噪音） */
function formShape(f) {
  return {
    question: String(f.question).trim(),
    authority: { file: String(f.authority.file).trim(), symbol: String(f.authority.symbol).trim() },
    overlap: [...f.overlap]
      .map((o) => {
        const out = { with: String(o.with).trim(), verdict: o.verdict, why: String(o.why).trim() };
        if (o.verdict === '相同') out.merge_into = String(o.merge_into).trim();
        return out;
      })
      .sort((x, y) => (x.with < y.with ? -1 : x.with > y.with ? 1 : 0)),
    criteria:
      f.criteria === null
        ? null
        : [...f.criteria]
            .map((c) => ({ ref: String(c.ref).trim(), ...(c.why ? { why: String(c.why).trim() } : {}) }))
            .sort((x, y) => (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0)),
  };
}

function readingsShape(r) {
  return {
    total: r.total,
    done: r.done.length,
    pending: r.pending.length,
    stale: r.stale.length,
    missing: r.missing.length,
    third: r.third.length,
    uncovered: r.uncovered.length,
    uncovered_named: r.uncovered,
    consistent: r.consistent,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('node scripts/inventory-sweep.mjs [--dir src/domain] [--ext .ts] [--root <项目根>] [--json | --batch N --index K | --submit FILE]');
    return;
  }
  const selfDir = path.dirname(path.resolve(process.argv[1] ?? '.'));
  const root = path.resolve(readOpt(argv, '--root') ?? path.join(selfDir, '..'));
  const dir = readOpt(argv, '--dir') ?? 'src/domain';
  const ext = readOpt(argv, '--ext') ?? '.ts';
  const slug = posix(dir).replace(/^\/+|\/+$/g, '').replace(/\//g, '-') + '-' + ext.replace(/^\./, '');
  const ledgerFile = ledgerPathOf(root, slug);

  const list = listItems(root, dir, ext);
  if (!list.ok) {
    console.error('✗ ' + list.reason + '（清单产不出来 ⇒ 清点无法进行，不静默当成 0 项）');
    process.exitCode = 1;
    return;
  }
  const closed = list.items;
  const current = closed.map((rel) => ({ path: rel, content_hash: sha256(fs.readFileSync(path.join(root, rel))) }));
  const hashOf = new Map(current.map((c) => [c.path, c.content_hash]));

  const prev = readLedger(ledgerFile);
  if (prev.broken) console.error('⚠ ' + prev.broken);
  const rec = reconcile(prev.items, current, new Date().toISOString());
  const facts = await factsFromIndex(root, closed);

  // ★ consumers 是机械事实：每次重扫覆盖（不靠填表人猜，也不存第二份判断）
  for (const rel of closed) {
    const it = rec.items[rel];
    if (it && it.form && typeof it.form === 'object') {
      it.form = { ...it.form, consumers: facts.ok ? facts.consumers[rel] ?? [] : null };
    }
  }
  const report = sweepReport(closed, rec.items);
  const spec = { dir: posix(dir), ext };
  const mode = argv.includes('--batch') ? 'batch' : argv.includes('--submit') ? 'submit' : argv.includes('--json') ? 'json' : 'human';

  if (mode === 'batch') {
    const size = Number(readOpt(argv, '--batch') ?? 8);
    const index = Number(readOpt(argv, '--index') ?? 0);
    const b = takeBatch(report.uncovered, size, index);
    const payload = {
      spec,
      ledger: posix(path.relative(root, ledgerFile)),
      batch: { index, size: b.size, total: b.total, batches: b.batches, offset: b.offset, remaining_after: b.remaining_after },
      facts_ok: facts.ok,
      facts_note: facts.ok ? '' : facts.reason,
      items: b.slice.map((rel) => ({
        path: rel,
        status: statusAfterReconcile(prev.items, current, new Date().toISOString(), rel),
        symbols: facts.ok ? facts.symbols[rel] ?? [] : null,
        consumers: facts.ok ? facts.consumers[rel] ?? [] : null,
        test_candidates: facts.ok ? (facts.consumers[rel] ?? []).filter((c) => c.group === 'tests').map((c) => c.file) : null,
        previous_form: rec.items[rel]?.form ?? null,
        form_template: {
          question: '<它回答什么问题（一句话，必须能与同批别项区分）>',
          authority: { file: rel, symbol: '<唯一住处的符号名>' },
          overlap: [
            { with: '<清单内另一项>', verdict: '不同', why: '<为什么不同>' },
            { with: '<清单内另一项>', verdict: '不同', why: '<为什么不同>' },
          ],
          criteria: [{ ref: '<tests/x.test.ts:行 或 判据 id>', why: '<它验什么>' }],
        },
      })),
      submit_hint: '填好后 --submit <文件>，文件形状 = {"items": {"<path>": <form>}}',
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (mode === 'submit') {
    const file = readOpt(argv, '--submit');
    if (!file || !fs.existsSync(file)) {
      console.error('✗ --submit 后面要给一个存在的 JSON 文件');
      process.exitCode = 1;
      return;
    }
    let ans;
    try {
      ans = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error('✗ 提交文件不是合法 JSON：' + err.message);
      process.exitCode = 1;
      return;
    }
    const given = ans && typeof ans.items === 'object' && ans.items ? ans.items : {};
    const accepted = [];
    const rejected = [];
    const unknown = [];
    for (const rel of Object.keys(given).sort()) {
      if (!closed.includes(rel)) {
        unknown.push(rel);
        continue;
      }
      const v = validateForm(given[rel], closed);
      if (!v.ok) {
        rejected.push({ path: rel, codes: problemCodes(given[rel], closed), problems: v.problems });
        const cur = rec.items[rel] ?? { content_hash: hashOf.get(rel), status: 'pending', form: null };
        rec.items[rel] = { ...cur, status: cur.status === 'done' ? 'done' : 'pending', rejected: { at: new Date().toISOString(), problems: v.problems } };
        continue;
      }
      rec.items[rel] = {
        content_hash: hashOf.get(rel),
        status: 'done',
        form: { ...formShape(given[rel]), consumers: facts.ok ? facts.consumers[rel] ?? [] : null },
        updated_at: new Date().toISOString(),
      };
      accepted.push(rel);
    }
    const after = sweepReport(closed, rec.items);
    const body = writeLedger(ledgerFile, spec, rec.items);
    console.log(
      JSON.stringify(
        { ok: rejected.length === 0 && unknown.length === 0, ledger: posix(path.relative(root, ledgerFile)), schema: body.schema, accepted, rejected, unknown_items: unknown, readings: readingsShape(after) },
        null,
        2,
      ),
    );
    if (rejected.length || unknown.length) process.exitCode = 1;
    return;
  }

  const body = writeLedger(ledgerFile, spec, rec.items);
  const payload = {
    schema: body.schema,
    spec,
    ledger: posix(path.relative(root, ledgerFile)),
    ledger_existed: prev.exists,
    index: { ok: facts.ok, note: facts.ok ? '' : facts.reason, stale_importers: facts.ok ? facts.staleImporters : [] },
    readings: { ...readingsShape(report), fresh: rec.readings.fresh, changed: rec.readings.changed, dropped: rec.readings.dropped },
    next_batch: report.uncovered.length ? '--batch ' + Math.min(8, report.uncovered.length) + ' --index 0' : '',
  };
  if (mode === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const named = (label, arr) => {
    if (!arr.length) return;
    console.log(label + '（' + arr.length + '）：');
    for (const x of arr) console.log('  · ' + x);
  };
  console.log('清单 ' + spec.dir + '/*' + spec.ext + ' · 本脚本 readdir 现算');
  console.log(renderReadings(report));
  if (!report.consistent) console.log('★ 恒等式不成立（total ≠ done + pending + stale + missing，或存在第四态）⇒ 台账坏了，逐项见下');
  console.log('口径：未清点 = pending ∪ stale ∪ missing ⇒ ' + report.uncovered.length + ' 项未清点（逐项点名见下）');
  if (!facts.ok) console.log('★ consumers 未取到：' + facts.reason);
  if (facts.ok && facts.staleImporters.length) {
    console.log('★ 索引落后（这些 importer 在索引之后被改过，consumers 可能漏）：' + facts.staleImporters.slice(0, 5).join(', ') + (facts.staleImporters.length > 5 ? ' …' : ''));
  }
  named('未清点（逐个点名）', report.pending);
  named('待复核（内容变了，需重读）', report.stale);
  named('台账缺项（清单里有、台账里没有）', report.missing);
  named('第四态', report.third);
  for (const rel of Object.keys(rec.items)) {
    const r = rec.items[rel].rejected;
    if (r) named('上次提交被拒：' + rel + '（' + r.problems.map((p) => p.code).join('|') + '）', r.problems.map((p) => p.code + ' — ' + p.detail));
  }
  if (report.uncovered.length) console.log('\n下一批：node scripts/inventory-sweep.mjs ' + payload.next_batch + '（剩余 ' + report.uncovered.length + ' 项；填好 --submit 合入）');
  else console.log('\n✓ 清单内每一项都已清点（台账 ' + payload.ledger + '）');
}

// ★ 只有直接跑才执行 CLI：judge 的 behavior-cases 会 import 本模块取纯函数，
//   若顶层就执行 I/O，判据会变成「跑一遍清点」（副作用进判据 = 不可重复判）。
if (/inventory-sweep\.m?js$/.test(String(process.argv[1] ?? ''))) {
  main().catch((err) => {
    console.error('✗ inventory-sweep 失败：' + (err && err.stack ? err.stack : String(err)));
    process.exitCode = 1;
  });
}
