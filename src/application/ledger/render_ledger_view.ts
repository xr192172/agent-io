/**
 * render_ledger_view.ts —— T-#LEDGER-ENGINE **L3**：台账引擎 → `docs/todo.md` 的**唯一渲染器** + `--check` 三向对账。
 *
 * ## 它解决的问题（一句话）
 * L1 让台账有了真相（`ledger_rows` / `ledger_events`），L2 把整份 MD 搬了进去（逐字 `source_json.raw`）。
 * L3 的职责：**让视图成为引擎的纯函数**，并且让"视图不是最新"这件事**变成可判的红**。
 *
 * ## 渲染器的三种行来源（**只有这三种**，其余一律不许出现）
 * ① **原文回放**：`ordinal IS NOT NULL` 的行 ⇒ 逐字 `source_json.raw`（不 trim、不重排、不去 markdown）。
 *    ★ 为什么不做"从 cells 重新拼表格行"：实测 `|`+cells.join(`|`)+`|` 只在 350 行成立、22 行不成立
 *      （`\|` 半转义行、粘着另一张表的行、单元格内裸 `|`）⇒ 重建必丢字节。**原文是唯一无损载体**。
 * ② **事件追加**：`annotate / verdict / close / reopen / supersede` 五类事件渲染成 `> ↳ …` 行，
 *    紧跟在宿主行之后（`hang` 事件**不渲染**：挂账的表现在于行本身）。
 * ③ **引擎新行**：`ordinal IS NULL` 的行（`hangRow` 挂的账）⇒ 在该行 `section` 的最后一行之后追加，
 *    一律 4 列——**不猜它属于哪个子表**（那是语义判断）。
 *
 * ## 为什么 `--check` 是**三向**（不是两向）
 * 两向（现算 vs 盘上）只能说"不一致"，说不出**该干什么**。第三向 = `git show HEAD:docs/todo.md`：
 * · 盘上 ≠ 现算 且 盘上 == HEAD ⇒ **stale**（引擎变了没重生成）⇒ 处置 = 跑 render；
 * · 盘上 ≠ 现算 且 盘上 ≠ HEAD ⇒ **hand-edited**（工作区有人手改）⇒ 处置 = 回滚或走引擎；
 * · 盘上缺 ⇒ **missing** ⇒ 处置 = 跑 render；
 * · 引擎读不到 ⇒ **unjudgeable** ⇒ **不印"一致"**（0.12：读不到 ≠ 干净）。
 * 退出码仿 tetherto/mdk《single source of truth》：`0` 最新 / `3` 陈旧或缺失（去跑生成）/ `1` 判定或生成本身坏了。
 *
 * ## 头部指纹（`DO NOT EDIT` 随文件走 + 无引擎也能抓手改）
 * 视图正文之上插 3 行 `>` 引用块：声明 + 重生成命令 + `body_sha256`（**它自己这份正文**的哈希）。
 * ⇒ 没有 `tasks.db` 的环境（新克隆 / CI）也能判"正文被手改过"；只是**判不了引擎新鲜度**。
 *
 * ## 层次
 * application 层纯函数 + 两个薄读者（`openTasksDbForRead` 只读、`git show` 子进程）；
 * `scripts/gen_ledger_view.mjs` 只做"调本模块 + 写盘 + 打印 + 退出码"，**不排版**。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openTasksDbForRead } from '../../infrastructure/task_history.js';

/** 视图（仓库相对）——**只此一处**：脚本、check、patrol 都问它 */
export const VIEW_REL = 'docs/todo.md';

/** 头里那三行（`> ` 引用块；mdk 的 "DO NOT EDIT travels with the page"） */
export const HEADER_LINES = [
  '> ⛔ **GENERATED —— 不要手改本文件**（台账真相住 `.agent-io/tasks.db` 的 `ledger_rows` / `ledger_events`）。',
  '> 改行请走引擎（`ledger` 工具：hang / annotate / close / verdict）；重生成：`npm run ledger:render`；对账：`npm run ledger:check`。',
  '> 指纹：`engine_rows=@ROWS@ events=@EVENTS@ body_sha256=@SHA@` —— 手改必被 `ledger:check` 点名。',
];

/** 渲染进视图的事件类型（`hang` 不渲染：见头注 ②） */
const RENDER_EVENT_KINDS = ['annotate', 'verdict', 'close', 'reopen', 'supersede'] as const;

export interface ViewRow {
  row_id: number;
  ref_id: string;
  section: string;
  title: string;
  problem: string | null;
  proposal: string | null;
  state: string;
  superseded_by: string | null;
  record_kind: string;
  origin: string;
  ordinal: number | null;
  source_json: string | null;
}

export interface ViewEvent {
  row_id: number;
  seq: number;
  kind: string;
  at: string;
  by: string;
  body: string | null;
}

export interface RenderOptions {
  /** 默认 true：带 `DO NOT EDIT` 头。★ 迁移期做"逐字对拍"时传 false（比对手写原文） */
  header?: boolean;
  /**
   * `--check` 专用：引擎不可读时是否**必须判红**。
   * · 默认 false = **降级档**：只验"头自证 + 盘上 == git HEAD"，并**明确打印没验引擎**
   *   （`tasks.db` 按裁定不进 git ⇒ 新克隆 / CI 天然没有引擎；那里判红就是"永远亮的灯"）。
   * · true = 严格档（有引擎的地方用；CI 若挂了引擎卷也该开它）。
   */
  requireEngine?: boolean;
}

export interface RenderResult {
  text: string;
  /** 正文（不含头）—— 头的 `body_sha256` 就是它的哈希 */
  body: string;
  lines: number;
  rows: number;
  engine_rows: number;
  event_lines: number;
  /** 源行号缺口（**可判的丢行**：`1..max` 里没有对应行的序号） */
  ordinal_gaps: number[];
  /** 渲染拒绝继续的原因（非 null ⇒ 调用方必须当成"没验"，不许当成"一致"） */
  error: string | null;
}

function sha16(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** ISO 时刻 → `YYYY-MM-DD`（UTC；**不许本地时区**：同一份库在两台机器上必须渲染出同一份视图） */
function dayOf(at: string): string {
  return String(at).slice(0, 10);
}

/** 多行 body 进引用块：续行补 `> `（不重排、不改字） */
function quote(text: string): string[] {
  return String(text)
    .split('\n')
    .map((p, i) => (i === 0 ? p : `> ${p}`));
}

/** 一条事件 → 视图行（**格式在此一处**：谁要读视图里的事件行，读的就是这里的产物） */
export function renderEventLines(e: ViewEvent, row: ViewRow): string[] {
  const head = `> ↳ ${e.by} ${dayOf(e.at)}：`;
  switch (e.kind) {
    case 'annotate':
      return quote(`${head}${e.body ?? ''}`);
    case 'verdict':
      return quote(`${head}⚖ 裁定：${e.body ?? ''}`);
    case 'supersede':
      return quote(`${head}⇄ 被 ${row.superseded_by ?? '?'} 取代（旧行保留，见 superseded_by）`);
    case 'close':
      return quote(`${head}✅ 销账（state=${row.state}）：${(e.body ?? '').replace(/\n/g, ' · ')}`);
    case 'reopen':
      return quote(`${head}↩ 重开`);
    default:
      return [];
  }
}

/** 引擎挂的账（没有源行）→ 4 列表格行（**不猜子表**：追加在所属 section 的块末） */
export function renderEngineRow(r: ViewRow): string {
  const cell = (s: string | null): string =>
    String(s ?? '')
      .replace(/\n/g, ' ')
      .replace(/\|/g, '\\|')
      .trim();
  const verdict = r.state === 'active' ? '（引擎挂账，待裁）' : `（已销账 state=${r.state}）`;
  return `| **${r.ref_id}** | ${cell(r.title) || '（无标题）'} | ${cell(r.problem) || verdict} | ${cell(r.proposal) || '—'} |`;
}

/** 纯函数核心：行 + 事件 → 视图全文（不读盘、不连库、不写盘） */
export function renderRowsToView(
  rows: readonly ViewRow[],
  events: readonly ViewEvent[],
  opts?: RenderOptions,
): RenderResult {
  const header = opts?.header ?? true;
  const byOrdinal = new Map<number, ViewRow>();
  for (const r of rows) {
    if (r.ordinal === null || r.source_json === null) continue;
    if (byOrdinal.has(r.ordinal)) continue; // 同一源行的多条记录（§F 捆绑裁决）只渲染第一条
    byOrdinal.set(r.ordinal, r);
  }
  const eventsByRow = new Map<number, ViewEvent[]>();
  for (const e of events) {
    if (!RENDER_EVENT_KINDS.includes(e.kind as (typeof RENDER_EVENT_KINDS)[number])) continue;
    const list = eventsByRow.get(e.row_id) ?? [];
    list.push(e);
    eventsByRow.set(e.row_id, list);
  }

  const ordered = [...rows].sort((a, b) => {
    const ao = a.ordinal === null ? Number.MAX_SAFE_INTEGER : a.ordinal;
    const bo = b.ordinal === null ? Number.MAX_SAFE_INTEGER : b.ordinal;
    return ao === bo ? a.row_id - b.row_id : ao - bo;
  });

  const out: string[] = [];
  let eventLines = 0;
  let engineRows = 0;
  let section = '';
  const pending = new Map<string, ViewRow[]>();
  const flush = (sec: string): void => {
    const list = pending.get(sec);
    if (!list?.length) return;
    pending.delete(sec);
    // ★ 若这一节的末行不是表格行 ⇒ 先补一个 4 列表头 + 分隔行。
    //   不补的话引擎新行会造出一张"无表头表"（GFM 里合法、但人读与 importer 都更容易误判）。
    const last = out.length ? out[out.length - 1] : '';
    if (!/^\s*\|/.test(last)) {
      out.push('| 编号 | 任务 | 当前裁定 | 待论证点 |', '|---|---|---|---|');
    }
    for (const r of list) {
      out.push(renderEngineRow(r));
      engineRows += 1;
      // ★ 引擎新行的**事件也要渲染**（`hang` 之后必然有 annotate/close —— 漏掉它们，
      //   "挂账 → 批注 → 销账" 这条链在视图里就只剩第一句。实测踩过：close 的留痕没进视图。）
      for (const e of eventsByRow.get(r.row_id) ?? []) {
        out.push(...renderEventLines(e, r));
        eventLines += 1;
      }
    }
  };
  for (const r of ordered) {
    if (r.ordinal === null) {
      const sec = r.section || '(head)';
      const list = pending.get(sec) ?? [];
      list.push(r);
      pending.set(sec, list);
      continue;
    }
    if (r.section !== section) {
      if (section) flush(section);
      section = r.section;
    }
    // ★ 同一 ordinal 的多条记录（§F 捆绑裁决 `A / B / C` 拆成多行、只有**一行原文**）只渲染一次
    if (byOrdinal.get(r.ordinal)?.row_id !== r.row_id) continue;
    // ★ 2026-11-17（用户原话落地）：销账 = 逻辑删除 ⇒ 活跃视图不再检索该行（引擎保留可审计；实测：销账残影 ¶§I#604 以 `|` 原样回放会被解析器再判成重复 ref_id）。
    if ((r as { state?: string }).state === 'void') continue;
    const parsed = JSON.parse(r.source_json as string) as { raw?: unknown };
    out.push(typeof parsed.raw === 'string' ? parsed.raw : '');
    for (const e of eventsByRow.get(r.row_id) ?? []) {
      out.push(...renderEventLines(e, r));
      eventLines += 1;
    }
  }
  if (section) flush(section);
  for (const sec of [...pending.keys()]) flush(sec);

  const body = `${out.join('\n')}\n`;
  let maxOrd = 0;
  for (const k of byOrdinal.keys()) if (k > maxOrd) maxOrd = k;
  const gaps: number[] = [];
  for (let i = 1; i <= maxOrd; i++) if (!byOrdinal.has(i)) gaps.push(i);

  let text = body;
  if (header) {
    const stamp = HEADER_LINES.join('\n')
      .replace('@ROWS@', String(rows.length))
      .replace('@EVENTS@', String(events.length))
      .replace('@SHA@', sha16(body))
      .split('\n');
    const lines = body.split('\n');
    let at = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^#\s+/.test(lines[i])) {
        at = i + 1;
        break;
      }
    }
    while (at < lines.length && lines[at].trim() === '') at += 1;
    lines.splice(at, 0, ...stamp, '');
    text = lines.join('\n');
  }

  return {
    text,
    body,
    lines: text.split('\n').length - 1,
    rows: rows.length,
    engine_rows: engineRows,
    event_lines: eventLines,
    ordinal_gaps: gaps,
    error: null,
  };
}

/** 从库里读行 + 事件（读端只读：**不建库、不建表**） */
function readEngine(projectRoot: string): { rows: ViewRow[]; events: ViewEvent[] } | { skip: string } {
  const opened = openTasksDbForRead(projectRoot, 'ledger_rows');
  if ('skip' in opened) return { skip: opened.skip };
  const db = opened.db;
  try {
    const rows = db
      .prepare(
        'SELECT rowid AS row_id, ref_id, section, title, problem, proposal, state, superseded_by, record_kind, origin, ordinal, source_json FROM ledger_rows',
      )
      .all() as unknown as ViewRow[];
    let events: ViewEvent[] = [];
    try {
      events = db
        .prepare('SELECT row_id, seq, kind, at, "by" AS by, body FROM ledger_events ORDER BY row_id, seq')
        .all() as unknown as ViewEvent[];
    } catch {
      events = []; // 老库没有 ledger_events ⇒ 没有事件可渲染（由 check 的 unjudgeable 段点名）
    }
    return { rows, events };
  } finally {
    db.close();
  }
}

/** 现算视图（**唯一**入口；脚本、check、patrol 都调它） */
export function renderLedgerView(projectRoot: string, opts?: RenderOptions): RenderResult {
  const read = readEngine(projectRoot);
  if ('skip' in read) {
    return {
      text: '',
      body: '',
      lines: 0,
      rows: 0,
      engine_rows: 0,
      event_lines: 0,
      ordinal_gaps: [],
      error: `tasks.db 读不到（${read.skip}）⇒ 这不是"视图最新"，是"判不了"`,
    };
  }
  try {
    return renderRowsToView(read.rows, read.events, opts);
  } catch (e) {
    // ★ 抄 gen_cognition.mjs 的 ERROR-hash 教训：渲染失败**绝不能**产出一个"看起来一致"的文本
    return {
      text: '',
      body: '',
      lines: 0,
      rows: read.rows.length,
      engine_rows: 0,
      event_lines: 0,
      ordinal_gaps: [],
      error: `渲染失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export type ViewCheckState =
  | 'current'
  | 'degraded-current'
  | 'stale'
  | 'hand-edited'
  | 'missing'
  | 'unjudgeable'
  | 'render-failed';

export interface ViewCheckResult {
  state: ViewCheckState;
  /** 退出码：0 最新 / 3 陈旧或缺失 / 1 判定或生成本身坏了 */
  exit: 0 | 1 | 3;
  why: string;
  /** 第一处差异（行号 + 双方片段）——**点名**，不许只说"不一致" */
  diff?: { line: number; onDisk: string; rendered: string };
  ordinal_gaps: number[];
  /** 头指纹自证是否成立（无引擎环境也能判"正文被手改"）；null = 视图没有头（迁移期无头档） */
  header_sha_ok: boolean | null;
  counters: { rows: number; engine_rows: number; event_lines: number; disk_bytes: number };
}

function firstDiff(a: string, b: string): { line: number; onDisk: string; rendered: string } {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return {
        line: i + 1,
        onDisk: String(la[i] ?? '（无此行）').slice(0, 160),
        rendered: String(lb[i] ?? '（无此行）').slice(0, 160),
      };
    }
  }
  return { line: 0, onDisk: '', rendered: '' };
}

function gitShowHead(projectRoot: string, rel: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null; // 不在 git 里 / 文件没进过 HEAD（新文件）——调用方按"分不清"处理
  }
}

/** 盘上文件有没有未提交改动（**只问这一个路径**：全仓 `git status` 在本仓常驻脏，实测 2 条） */
export function viewHasUncommittedEdits(projectRoot: string): boolean | null {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '-z', '--', VIEW_REL], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

/** 头里的 `body_sha256=`（没有头 ⇒ null） */
function declaredBodySha(text: string): string | null {
  const m = /body_sha256=([0-9a-f]{16})/.exec(text);
  return m ? m[1] : null;
}

/**
 * 盘上文件的**正文**（把头那一段剥掉）。
 * ★ 头的 `body_sha256` 是**它自己这份正文**的哈希 ⇒ 必须拿**盘上那一份**去算。
 *   拿渲染结果去算是把两个判据混成一个（实测误诊过：引擎前进后，自洽的头被判成"手改"）。
 */
function bodyOfViewText(text: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('> ⛔ **GENERATED'));
  if (at < 0) return text; // 无头档：正文就是全文
  let cut = at + HEADER_LINES.length;
  if (lines[cut] === '') cut += 1;
  return lines.slice(0, at).concat(lines.slice(cut)).join('\n');
}

/**
 * `--check`：三向对账（引擎现算 / 盘上 / `git HEAD`）。
 *
 * @param opts.header 与生成时**同一档**（默认 true）。迁移期逐字对拍用 false。
 */
export function checkLedgerView(projectRoot: string, opts?: RenderOptions): ViewCheckResult {
  const header = opts?.header ?? true;
  const file = path.join(projectRoot, VIEW_REL);
  const rendered = renderLedgerView(projectRoot, { header });
  const counters = {
    rows: rendered.rows,
    engine_rows: rendered.engine_rows,
    event_lines: rendered.event_lines,
    disk_bytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
  };
  if (rendered.error) {
    const engineMissing = rendered.error.includes('tasks.db 读不到');
    if (engineMissing && !opts?.requireEngine && fs.existsSync(file)) {
      // ★ 降级档：只验"头自证 + 盘上 == git HEAD"，**明确说没验引擎**（不是"一致（最新）"）
      const disk0 = fs.readFileSync(file, 'utf8');
      const declared0 = declaredBodySha(disk0);
      const shaOk = declared0 === null ? null : declared0 === sha16(bodyOfViewText(disk0));
      const head0 = gitShowHead(projectRoot, VIEW_REL);
      const dirty = head0 !== null && disk0 !== head0;
      const exit = shaOk === false || dirty ? 1 : 0;
      return {
        // ★ 有手改（头与正文不符 / 盘上动了）时**不许**叫 `degraded-current`：那种"名字说 current、退出码说 1"
        //   的读数是本仓最贵的一类假象（实测在沙箱里出现过一次：state=degraded-current 但 exit=1）。
        state: exit === 0 ? 'degraded-current' : 'hand-edited',
        exit,
        why:
          `**降级档**：${VIEW_REL} 自证（头 body_sha256 ${
            shaOk === true ? '与正文一致' : shaOk === false ? '**与正文不符**（正文被改过，头没改）' : '缺失（无头档，只能靠 git 比）'
          } · 盘上 ${dirty ? '≠' : '=='} git HEAD），` +
          `但**引擎没验**：${rendered.error}。\n` +
          `  ★ tasks.db 按裁定不进 git（.gitignore:239）⇒ 新克隆 / CI 天生没有引擎，"引擎是否更新"在这里**不可判**。\n` +
          `  要严格判 ⇒ 加 \`--require-engine\`（有引擎的环境 / 挂了库卷的 CI 应当加）。`,
        ordinal_gaps: [],
        header_sha_ok: shaOk,
        counters,
      };
    }
    return {
      state: rendered.error.startsWith('渲染失败') ? 'render-failed' : 'unjudgeable',
      exit: 1,
      why: `${rendered.error}\n  ★ 这不是"一致（最新）"，是**没验**（抄 gen_cognition 的 ERROR-hash 教训）`,
      ordinal_gaps: rendered.ordinal_gaps,
      header_sha_ok: null,
      counters,
    };
  }
  if (!fs.existsSync(file)) {
    return {
      state: 'missing',
      exit: 3,
      why: `${VIEW_REL} 不存在 ⇒ 先跑一次 \`npm run ledger:render\``,
      ordinal_gaps: rendered.ordinal_gaps,
      header_sha_ok: null,
      counters,
    };
  }
  const disk = fs.readFileSync(file, 'utf8');
  const declared = declaredBodySha(disk);
  const header_sha_ok = declared === null ? null : declared === sha16(bodyOfViewText(disk));
  if (disk === rendered.text) {
    return {
      state: 'current',
      exit: 0,
      why: `一致（最新）：视图 == 引擎现算（${rendered.lines} 行 · 引擎新行 ${rendered.engine_rows} · 事件行 ${rendered.event_lines}）`,
      ordinal_gaps: rendered.ordinal_gaps,
      header_sha_ok,
      counters,
    };
  }
  const head = gitShowHead(projectRoot, VIEW_REL);
  const diff = firstDiff(disk, rendered.text);
  if (head !== null && disk !== head) {
    return {
      state: 'hand-edited',
      exit: 1,
      why:
        `**视图有未提交的手改**（盘上既 ≠ 引擎现算、也 ≠ git HEAD）⇒ 本检查**拒判**：\n` +
        `  它分不清"引擎改过没重生成"与"有人正在写"（mdk 先例：Report mode declines to run）。\n` +
        `  处置：手改请回滚（\`git checkout -- ${VIEW_REL}\`）；要改台账请走引擎，然后 \`npm run ledger:render\`。\n` +
        `  第一处差异 L${diff.line}：\n    盘上  ${diff.onDisk}\n    现算  ${diff.rendered}`,
      diff,
      ordinal_gaps: rendered.ordinal_gaps,
      header_sha_ok,
      counters,
    };
  }
  return {
    state: 'stale',
    exit: 3,
    why:
      `${VIEW_REL} 已过期：盘上 == git HEAD，但与引擎现算不一致 ⇒ 引擎/引擎数据变了、视图没重生成。\n` +
      (header_sha_ok === false
        ? '  ★ 头里的 body_sha256 与**盘上正文**不符 ⇒ 这更像"手改之后又提交了"（不是引擎单方面变）：\n' +
          '    处置同上（重生成会覆盖手改），另外请查是谁绕过了引擎写视图。\n'
        : header_sha_ok === true
          ? '  （头与盘上正文自洽 ⇒ 不是手改，是引擎单方面变了）\n'
          : '') +
      `  处置：\`npm run ledger:render\`\n` +
      `  第一处差异 L${diff.line}：\n    gitHEAD ${diff.onDisk}\n    现算    ${diff.rendered}`,
    diff,
    ordinal_gaps: rendered.ordinal_gaps,
    header_sha_ok,
    counters,
  };
}
