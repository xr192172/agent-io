/**
 * importer.ts —— T-#LEDGER-ENGINE **L2**：`docs/todo.md` → `ledger_rows` 的**全保真** importer。
 *
 * ## 它解决的问题（一句话）
 * 「MD 降为派生视图」的前提是**引擎里已经有整份 MD 的内容**。只收 `T-#*` 任务行的 importer 会让 L3
 * 一生成视图就**静默丢内容**（散文 / §H 纪律 / §F 裁决 / 表头），而"少了这一段"与"本来就没有"
 * 在库里长得一模一样（本仓 0.12 的老病）⇒ 本模块的判据是 **逐字 round-trip**
 * （{@link reconstructMarkdown}：从库里的行还能拼回原文件，一个字节不差）。
 *
 * ## 三层输出（一张表五种 `record_kind`，见 `task_history.ts#LEDGER_ADDED_COLUMNS`）
 * · `task`   —— 首格**整格**是业务 id 的表格行（`T-#*` / `R##` / `T###` / `D-#*` / `GAP-*`）；
 * · `ruling` —— §F 围栏里形如 `KEY  一句话结论` 的行，**一行可能拆多 key**（`A / B / C  说明`）；
 * · `prose` / `discipline` / `meta` —— 散文 / §H 纪律段 / 标题与表头等**视图素材**。
 *
 * ## 三种行有**两种身份**（这是本模块最容易写错的一处）
 * · **账行**（task / ruling）有**业务身份**：`ref_id` = 业务 id。它跨版本跟着这一条账走 ⇒
 *   内容变了是**漂移**（要点名、要拒写、要留痕）。
 * · **素材行**（prose / discipline / meta）只有**位置身份**：`ref_id` = `¶<节>#<行号>`。它们没有账义，
 *   所以**不做逐行漂移判定**，而是按"整节派生层摘要"整体比对（{@link derivedDigest}）：
 *   摘要不同 ⇒ `refresh` 时**整层重建**（删掉重插）。★ 为什么不做逐行：MD 中间插一行会让后面
 *   所有行号平移，逐行比对会把"什么都没改"报成几百条漂移 —— 那是**永远亮的灯**（0.16）。
 *
 * ## 三条"宁可报、不许猜"的规则（每条都有红用例）
 * ① **切分器**：`|` 只在"不在 code span 内且未被 `\` 转义"时才算分隔符（朴素 `split('|')` 会把
 *    含 `\|` 的行切错——本仓 `docs/todo.md` 里真有这种行）。
 * ② **表头**：**不按节、按表**推断 —— 有分隔行 `|---|` 的那张表，其上一行才是表头；
 *    **没有分隔行的表 = 无表头表**（首行即数据）。★ 按"每节第一行当表头"会把无表头表的
 *    **第一条数据行吃掉**，而少一行在库里长得跟"本来就没这行"一样（自证过一次的错）。
 * ③ **id 口径分两级**：首格**整格**是 id 才算 `ref_id`（strict）；行内其它位置出现的 id 只进
 *    `referenced_ids`（`R53` 这类引用在本文件里出现多次——把引用当身份会造出一堆假冲突）。
 *
 * ## 入口（L2 = module-only，工具面留 L3+：FACE-STABILITY「一次面变化」）
 * ```bash
 * node --import tsx -e "import('./src/application/ledger/importer.ts').then(m=>console.log(JSON.stringify(m.importLedger('.',{mode:'reconcile'}),null,1)))"
 * ```
 * ★ `reconcile` 必须在**任何 MD 改动之后**手工重跑（漂移只在你跑的时候才报）；L3 的 `ledger:check`
 *   门才把它变成自动闸。这是双读窗口的固有成本，不是缺陷。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openTasksDb } from '../../infrastructure/task_history.js';
import {
  appendEventTo,
  insertLedgerRow,
  queueReview,
  subjectConflicts,
  type LedgerRecordKind,
  type SubjectConflict,
} from './ledger.js';
import { reconcileLedgerIds, type ReconcileResult } from './reconcile.js';

/** 解析器版本（进 `source_json`；L3 换口径时靠它区分"老解析器写的行"） */
export const PARSER_VERSION = 'l2-md-1';

/** 默认源（仓库相对） */
export const DEFAULT_SOURCE = 'docs/todo.md';

export type RowKind = LedgerRecordKind;

/** 一行的解析结果（`cells` / `raw` 逐字：不去 `**`、不去反引号、不 unescape） */
export interface ParsedRow {
  /** 身份：账行 = 业务 id；素材行 = `¶<section>#<ordinal>`（位置身份） */
  refId: string;
  /** 首格整格是业务 id 时非 null（strict 口径，见③） */
  businessId: string | null;
  kind: RowKind;
  /** `§A`…`§I` / `(head)` */
  section: string;
  /** `§G · 历史账区（…）`（节 + 子节，供 L3 还原分段） */
  sectionPath: string;
  /** 1-based 源文件行号（**坐标不是身份**；只做排序投影） */
  ordinal: number;
  /** `docs/todo.md:391`（人读指针，不是主键） */
  sourceRef: string;
  /** 行型：table_row / headerless_row / table_header / table_sep / heading / rule / blank / fence / fence_body / quote / list / prose / ruling */
  detail: string;
  cells: string[];
  dirty: null | { bucket: 'half-escaped' | 'headerless' | 'ragged'; why: string };
  subject: { path: string; symbol: string | null } | null;
  /** 行内**非首格**出现的 id（引用，不是身份） */
  referencedIds: string[];
  /** ruling 行拆出的全部 key（捆绑行 `A / B / C` 会 > 1；其余为空） */
  keys: string[];
  /** 原文逐字（round-trip 的唯一依据） */
  raw: string;
}

export interface SectionMeta {
  id: string;
  title: string;
  ordinal: number;
}

export interface ParseStats {
  lines: number;
  table_blocks: number;
  headerless_tables: number;
  half_escaped: number;
  ragged: number;
  /** 一行里出现 ≥2 个不同强锚点（**只报不排队**：多锚点是常态，排队会变成永远亮的灯） */
  multi_anchor: number;
  rulings: number;
  /** 捆绑裁决行额外拆出的 key 数（`A / B / C` ⇒ 2；用于"一条物理行 ≠ 一条裁决"的可读读数） */
  ruling_alias_keys: number;
  /** §F 节内**围栏里没认出**的行数（>0 ⇒ 有裁决被降级成散文，必须人看） */
  fence_body_unparsed: number;
  by_kind: Record<RowKind, number>;
}

export interface ParseResult {
  rows: ParsedRow[];
  sections: SectionMeta[];
  dirty: ParsedRow[];
  stats: ParseStats;
}

/** 业务 id（strict：**整格**匹配） */
const BUSINESS_ID_RE = /^(T-#[A-Z0-9][A-Z0-9-]*|D-#[A-Z0-9][A-Z0-9-]*|GAP-[A-Z0-9][A-Z0-9-]*|R\d{1,4}|T\d{1,4}|G\d{1,3})$/;

/** 行内"出现了 id"的宽松口径（引用用） */
const ANY_ID_RE = /(?:T-#[A-Z0-9][A-Z0-9-]+|D-#[A-Z0-9][A-Z0-9-]+|GAP-[A-Z0-9][A-Z0-9-]+|\bR\d{1,4}\b|\bT\d{1,4}\b)/g;

/** 路径锚点只认这些顶层目录（**裸文件名不解析**：后缀唯一匹配属于"猜"，猜错就造假冲突） */
const ANCHOR_ROOTS = /^(src|scripts|tests|docs|apps|packages|vendor|\.agent-io)\//;
const ANCHOR_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|md|py|go|java|cs|rs|sql)$/;

/** 表分隔行的一格：`---` / `:--` / `--:` / `:-:`（GFM） */
const SEP_CELL_RE = /^:?-{1,}:?$/;

/**
 * **半转义行**的签名：行内粘了另一张表的整行 —— `\| **某个 id** \|`（前缀竖线转义了、后面那格是另一个 id）。
 * ★ 为什么不能只靠"格数 ≠ 表头格数"：本文件里有章节的表**被一行非表格文本打断**（表头与分隔行之间插了
 *   一行 `- 来源：…`）⇒ 按 GFM 渲染那是**两张表**，后一张**没有表头** ⇒ 没有"期望格数"可比。
 *   这 8 行全部落在那张无表头表里（自证：只按格数判会一行都抓不到）。
 * ★ 也不能"含 `\|` 就算脏"：本文件里大量**合法**转义（`/_test\.(go\|ts)/`、`a \| b` 之类）会被误判成脏行。
 */
const NESTED_ROW_RE = /\\\|\s*\*\*[^*\n]{1,80}\*\*\s*\\\|/;

/** 素材行的 `record_kind`（"派生层"= 可整层重建的那三类） */
const DERIVED_KINDS: readonly RowKind[] = ['prose', 'discipline', 'meta'];

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function sha(text: string | null | undefined): string {
  return createHash('sha256').update(String(text ?? '')).digest('hex');
}

function sha8(text: string | null | undefined): string {
  return text === null || text === undefined ? '(empty)' : sha(text).slice(0, 12);
}

/**
 * **切分一行表格**（全模块唯一实现）：
 * `|` 只在"不在 code span 内、且未被 `\` 转义"时才算分隔符；`\|` 还原成 `|`。
 *
 * ★ 为什么不 `split('|')`：`docs/todo.md` 里有"半转义"行（前缀 `\|` 已转义、后续竖线没转义）——
 *   朴素切分会把它切成 20+ 格，而它其实**只是一行**，该整行进报告交人。
 */
export function splitTableRow(line: string): { cells: string[]; escaped: number } {
  const s = line.trim();
  const cells: string[] = [];
  let cur = '';
  let escaped = 0;
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      escaped += 1;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      cur += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  if (s.startsWith('|')) cells.shift();
  // ★ 末尾 `\|` 是**转义**竖线（不是分隔符）⇒ 不许 pop
  if (s.endsWith('|') && !s.endsWith('\\|')) cells.pop();
  return { cells, escaped };
}

/** 这一行是不是表分隔行（`|---|---|`） */
export function isSeparatorRow(cells: readonly string[]): boolean {
  if (!cells.length) return false;
  return cells.every((c) => SEP_CELL_RE.test(c.trim()));
}

/** 首格**整格**是业务 id ⇒ 返回它（去 `**` 与反引号后整格匹配） */
export function businessIdOfCell(cell: string | undefined): string | null {
  if (cell === undefined) return null;
  const bare = cell.trim().replace(/\*\*/g, '').replace(/`/g, '').trim();
  return BUSINESS_ID_RE.test(bare) ? bare : null;
}

/**
 * 从行文本抽**强锚点**（只认反引号里的仓库相对路径，可带 `#symbol` / `:行号`）。
 * ★ 行号剥掉（`:103` / `:103-121` 都是坐标）：改个行号不该变成另一条锚点。
 * ★ 裸文件名不认（保守）：猜错会造出**假冲突**，而假冲突会把一次正常挂账打回。
 */
export function extractSubjectAnchors(line: string): Array<{ path: string; symbol: string | null }> {
  const out: Array<{ path: string; symbol: string | null }> = [];
  const seen = new Set<string>();
  const re = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const raw = m[1].trim().replace(/\\/g, '/');
    if (!raw || /\s/.test(raw)) continue;
    let s = raw;
    for (let round = 0; round < 2; round++) {
      s = s.replace(/:\d+(?:-\d+)?$/, '');
      const hash = s.indexOf('#');
      if (hash > 0) s = s.slice(0, hash);
    }
    if (!ANCHOR_ROOTS.test(s) || !ANCHOR_EXT.test(s)) continue;
    // ★ 通配/占位不算锚点：`.agent-io/design/*.dsl.json` 是**一组**文件，不是一个 subject
    //   （把它当 subject 会造出一条永远撞自己的假冲突）
    if (s.includes('..') || s.includes('*') || s.includes('?')) continue;
    const symbol = symbolOfAnchor(raw);
    const key = `${s}#${symbol ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: s, symbol });
  }
  return out;
}

function symbolOfAnchor(raw: string): string | null {
  const hashAt = raw.indexOf('#');
  if (hashAt <= 0) return null;
  const tail = raw.slice(hashAt + 1).replace(/:\d+(?:-\d+)?$/, '').trim();
  if (!tail || !/^[A-Za-z_$][\w$.]*$/.test(tail)) return null;
  return tail.replace(/\(\)$/, '');
}

interface SectionState {
  id: string;
  title: string;
  subsection: string | null;
}

function sectionPathOf(st: SectionState): string {
  if (st.subsection) return `${st.id} · ${st.subsection}`;
  if (st.id === '(head)') return '(head)';
  return `${st.id} · ${st.title}`;
}

/**
 * 解析整份 MD（**纯函数**：不读盘、不连库）。
 *
 * @param opts.sourceName 只进 `sourceRef`（`docs/todo.md:391`），不参与任何判据
 */
export function parseTodoMd(text: string, opts?: { sourceName?: string }): ParseResult {
  const sourceName = opts?.sourceName ?? DEFAULT_SOURCE;
  const eol = detectEol(text);
  const lines = text.split(eol);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  interface Ctx {
    raw: string;
    inFence: boolean;
    isFenceDelim: boolean;
    section: SectionState;
  }
  const ctx: Ctx[] = [];
  const sections: SectionMeta[] = [];
  const seenSection = new Set<string>();
  let section: SectionState = { id: '(head)', title: '', subsection: null };
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const isFenceDelim = /^\s*```/.test(raw);
    if (isFenceDelim) {
      inFence = !inFence;
    } else if (!inFence) {
      const h2 = /^##\s+(§[A-Z])\s*(?:·\s*(.*))?$/.exec(raw);
      if (h2) {
        section = { id: h2[1], title: (h2[2] ?? '').trim(), subsection: null };
      } else if (/^###\s+/.test(raw)) {
        section = { ...section, subsection: raw.replace(/^###\s+/, '').trim() };
      } else if (/^#\s+/.test(raw)) {
        section = { id: '(head)', title: raw.replace(/^#\s+/, '').trim(), subsection: null };
      }
    }
    ctx.push({ raw, inFence, isFenceDelim, section: { ...section } });
    if (!seenSection.has(section.id)) {
      seenSection.add(section.id);
      sections.push({ id: section.id, title: section.title, ordinal: i + 1 });
    }
  }
  if (!sections.length) sections.push({ id: '(head)', title: '', ordinal: 1 });

  const rows: ParsedRow[] = [];
  const stats: ParseStats = {
    lines: lines.length,
    table_blocks: 0,
    headerless_tables: 0,
    half_escaped: 0,
    ragged: 0,
    multi_anchor: 0,
    rulings: 0,
    ruling_alias_keys: 0,
    fence_body_unparsed: 0,
    by_kind: { task: 0, prose: 0, ruling: 0, discipline: 0, meta: 0 },
  };

  const emit = (row: ParsedRow): void => {
    rows.push(row);
    stats.by_kind[row.kind] += 1;
    if (row.dirty?.bucket === 'half-escaped') stats.half_escaped += 1;
    if (row.dirty?.bucket === 'ragged') stats.ragged += 1;
  };

  const meta = (i: number, detail: string, cells: string[], kind: RowKind = 'meta'): ParsedRow => {
    const c = ctx[i];
    return {
      refId: `¶${c.section.id}#${i + 1}`,
      businessId: null,
      kind,
      section: c.section.id,
      sectionPath: sectionPathOf(c.section),
      ordinal: i + 1,
      sourceRef: `${sourceName}:${i + 1}`,
      detail,
      cells,
      dirty: null,
      subject: null,
      referencedIds: [],
      keys: [],
      raw: c.raw,
    };
  };

  let i = 0;
  while (i < lines.length) {
    const c = ctx[i];
    const raw = c.raw;

    // ── 围栏分隔行
    if (c.isFenceDelim) {
      emit(meta(i, 'fence', [raw]));
      i += 1;
      continue;
    }

    // ── 围栏内
    if (c.inFence) {
      if (c.section.id === '§F') {
        const ruling = parseRulingLine(raw);
        if (ruling) {
          const anchors = extractSubjectAnchors(raw);
          if (anchors.length > 1) stats.multi_anchor += 1;
          for (const key of ruling.keys) {
            emit({
              ...meta(i, 'ruling', [raw], 'ruling'),
              refId: key,
              businessId: key,
              subject: anchors.length ? anchors[0] : null,
              keys: ruling.keys,
            });
          }
          i += 1;
          continue;
        }
        stats.fence_body_unparsed += 1;
      }
      emit(meta(i, 'fence_body', [raw], 'prose'));
      i += 1;
      continue;
    }

    // ── 表格块（连续以 `|` 开头的行；表头按**表**推断，见头注 ②）
    if (/^\s*\|/.test(raw)) {
      let j = i;
      while (j < lines.length && !ctx[j].inFence && !ctx[j].isFenceDelim && /^\s*\|/.test(ctx[j].raw)) j += 1;
      stats.table_blocks += 1;
      const firstCells = splitTableRow(ctx[i].raw).cells;
      const hasHeader = j - i >= 2 && isSeparatorRow(splitTableRow(ctx[i + 1].raw).cells);
      if (!hasHeader) stats.headerless_tables += 1;
      const headerCells = hasHeader ? firstCells : null;
      for (let k = i; k < j; k++) {
        if (hasHeader && k === i) {
          emit(meta(k, 'table_header', firstCells));
          continue;
        }
        if (hasHeader && k === i + 1) {
          emit(meta(k, 'table_sep', splitTableRow(ctx[k].raw).cells));
          continue;
        }
        emit(parseTableDataRow(k, headerCells));
      }
      i = j;
      continue;
    }

    // ── 非表格行
    const trimmed = raw.trim();
    if (!trimmed) {
      emit(meta(i, 'blank', [raw]));
    } else if (/^#{1,6}\s+/.test(trimmed)) {
      emit(meta(i, 'heading', [raw]));
    } else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      emit(meta(i, 'rule', [raw]));
    } else {
      const inDiscipline = c.section.id === '§H';
      const anchors = extractSubjectAnchors(raw);
      if (anchors.length > 1) stats.multi_anchor += 1;
      const detail = /^>/.test(trimmed) ? 'quote' : /^([-*+]\s+|\d+\.\s+)/.test(trimmed) ? 'list' : 'prose';
      const row = meta(i, detail, [raw], inDiscipline ? 'discipline' : 'prose');
      row.subject = anchors.length ? anchors[0] : null;
      emit(row);
    }
    i += 1;
  }

  const dirty = rows.filter((r) => r.dirty !== null);
  // ★ 裁决读数：`rulings` = 裁决**条数**（捆绑行拆开后）；`ruling_alias_keys` = 其中**不是单独占一行**的条数
  //   （= 条数 − 物理行数）。两个数都给，是因为"一条物理行 ≠ 一条裁决"这件事必须能被读出来
  //   （按物理行落库会静默丢 key，而"少一条裁决"在库里长得跟"本来就没有"一样）。
  const rulingRows = rows.filter((r) => r.kind === 'ruling');
  stats.rulings = rulingRows.length;
  stats.ruling_alias_keys = rulingRows.length - new Set(rulingRows.map((r) => r.ordinal)).size;
  return { rows, sections, dirty, stats };

  // ─────────────────────── 行级解析（闭包：只用当前行 + 表头上下文）

  function parseRulingLine(text: string): { keys: string[]; body: string } | null {
    const t = text.trim();
    if (!t) return null;
    // key 段 = 首个"两个及以上空格"之前的部分；`A / B / C  说明` 这种捆绑行拆成多 key。
    // ★ 退路：本文件里有一行 key 与结论之间**只有一个空格**（`FIXTURE-MUST-BE-STATIC 输入可造…`）——
    //   只认双空格会把它**静默降级成散文**（一条裁决凭空消失），所以再退一档"首个 token + 1 空格"。
    let keySeg = t;
    const wide = /^(.*?)\s{2,}(\S.*)$/.exec(t);
    if (wide) {
      keySeg = wide[1].trim();
    } else {
      const narrow = /^([A-Z0-9][A-Z0-9-]*(?:\s*\/\s*[A-Z0-9][A-Z0-9-]*)*)\s+\S/.exec(t);
      if (narrow) keySeg = narrow[1];
    }
    if (!/^[A-Z0-9][A-Z0-9-]*(?:\s*\/\s*[A-Z0-9][A-Z0-9-]*)*$/.test(keySeg)) return null;
    const keys = keySeg
      .split(/\s*\/\s*/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (!keys.length || !keys.every((k) => /^[A-Z0-9][A-Z0-9-]+$/.test(k))) return null;
    return { keys, body: wide ? wide[2] : t.slice(keySeg.length).trim() };
  }

  function parseTableDataRow(k: number, headerCells: string[] | null): ParsedRow {
    const raw = ctx[k].raw;
    const base = meta(k, headerCells ? 'table_row' : 'headerless_row', []);
    const { cells, escaped } = splitTableRow(raw);
    const expected = headerCells ? headerCells.length : null;
    let dirty: ParsedRow['dirty'] = null;
    let outCells = cells;
    const widthMismatch = expected !== null && cells.length !== expected;
    const nestedRow = escaped > 0 && NESTED_ROW_RE.test(raw);
    if (nestedRow || (widthMismatch && escaped > 0)) {
      // 桶①：半转义行 —— **不许切**，整行原样入库，交人
      dirty = {
        bucket: 'half-escaped',
        why:
          `格数 ${cells.length}${expected !== null ? ` ≠ 表头 ${expected} 格` : '（无表头表）'}，` +
          `行内含 ${escaped} 个转义竖线${nestedRow ? '且粘着一整行 `\\| **id** \\|`（另一张表的行）' : ''} ⇒ 这一行粘了不止一行的内容`,
      };
      outCells = [raw.trim()];
    } else if (widthMismatch) {
      // 桶③：缺列/多列但**无**转义竖线 ⇒ deterministic（缺列按 null 投影），不阻塞
      dirty = { bucket: 'ragged', why: `格数 ${cells.length} ≠ 表头 ${expected} 格（无转义竖线 ⇒ 按缺列处理）` };
    }
    const businessId = businessIdOfCell(cells[0]);
    const anchors = extractSubjectAnchors(raw);
    if (anchors.length > 1) stats.multi_anchor += 1;
    return {
      ...base,
      refId: businessId ?? base.refId,
      businessId,
      kind: businessId ? 'task' : 'prose',
      cells: outCells,
      dirty,
      subject: anchors.length ? anchors[0] : null,
      referencedIds: uniqueMatches(cells.slice(1).join(' | ')),
    };
  }
}

function uniqueMatches(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  ANY_ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANY_ID_RE.exec(text))) {
    const id = m[0];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 行的 `title` 投影（**列是可查询投影，`source_json.raw` 才是证据**） */
function titleOf(row: ParsedRow): string {
  if (row.kind === 'ruling') return row.keys[0] ?? row.refId;
  if (row.kind === 'task') {
    const cell = (row.cells[1] ?? '').trim();
    return cell || row.businessId || row.refId;
  }
  const t = row.raw.trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

/**
 * 进库的 `source_json`（**逐字证据**：raw + cells + 段路径 + 引用 + 解析器版本）。
 *
 * ★ **不含 `ordinal`**：行号住在列里（一处权威），JSON 只存"内容"——这样"同一行挪了位置"在内容层不可见，
 *   不会把一次纯插入报成几百行漂移。
 * ★ **不含整份文件的 `doc_sha`**：那份 sha 只住在导入回执里。把它塞进每一行 ⇒ **改一个字所有行都"漂移"**
 *   （实测过一次：报出来的"漂移"跟哪一行真的变了毫无关系 —— 那是"用全集冒充个体"的同族错误）。
 *   每一行的证据就是它自己那一行。
 */
export function sourceJsonOf(row: ParsedRow): string {
  return JSON.stringify({
    v: PARSER_VERSION,
    source: row.sourceRef.replace(/:\d+$/, ''),
    section: row.section,
    section_path: row.sectionPath,
    detail: row.detail,
    raw: row.raw,
    cells: row.cells,
    ...(row.keys.length ? { keys: row.keys } : {}),
    ...(row.referencedIds.length ? { referenced_ids: row.referencedIds } : {}),
    ...(row.dirty ? { dirty: row.dirty } : {}),
  });
}

/**
 * **逐字 round-trip**（L2 的核心判据）：从库里的行拼回 MD。
 *
 * 规则：按 `ordinal`（列）排序 → 同一 `ordinal` 的多行（§F 捆绑裁决 `A / B / C` 拆成多行、只有**一行原文**）
 * 只取第一条的 `raw` → 用 EOL 连接。
 * ★ `ordinal` 为 NULL 的行（engine 挂账行，不在 MD 里）跳过。
 */
export function reconstructMarkdown(
  rows: ReadonlyArray<{ ordinal: number | null; source_json: string | null }>,
  eol = '\n',
): string {
  const byOrdinal = new Map<number, string>();
  for (const r of rows) {
    if (r.ordinal === null || r.source_json === null) continue;
    if (byOrdinal.has(r.ordinal)) continue;
    let raw = '';
    try {
      const o = JSON.parse(r.source_json) as { raw?: unknown };
      raw = typeof o.raw === 'string' ? o.raw : '';
    } catch {
      raw = ''; // 坏 JSON 不静默：比对时自然不等 ⇒ 红
    }
    byOrdinal.set(r.ordinal, raw);
  }
  return [...byOrdinal.keys()]
    .sort((a, b) => a - b)
    .map((k) => byOrdinal.get(k) as string)
    .join(eol);
}

/** 派生层摘要（素材行"整体比对"的唯一口径：按源顺序把 `kind|detail|raw` 串起来取 sha） */
export function derivedDigest(rows: ReadonlyArray<{ record_kind?: string; kind?: string; detail?: string; raw: string; source_json?: string | null }>): string {
  const parts: string[] = [];
  for (const r of rows) {
    const kind = r.kind ?? r.record_kind ?? '';
    let detail = r.detail ?? '';
    let raw = r.raw;
    if (r.source_json !== undefined && r.source_json !== null && !detail) {
      try {
        const o = JSON.parse(r.source_json) as { detail?: unknown; raw?: unknown };
        detail = typeof o.detail === 'string' ? o.detail : '';
        raw = typeof o.raw === 'string' ? o.raw : '';
      } catch {
        detail = '(bad)';
        raw = '(bad)';
      }
    }
    parts.push(`${kind}\u0001${detail}\u0001${raw}`);
  }
  return sha(parts.join('\u0002'));
}

export interface ImportReport {
  mode: 'reconcile' | 'refresh';
  source: string;
  doc_sha: string;
  /** 解析出的行数（含 meta：标题/表头/空行——它们也是"内容"） */
  parsed: number;
  added: number;
  unchanged: number;
  /** `refresh` 写进去的账行数（task/ruling 的内容更新） */
  refreshed: number;
  /** `refresh` 重建的派生行数（prose/discipline/meta：整层删掉重插 ⇒ 数字 = 重建后的行数） */
  derived_rebuilt: number;
  /** 重建时删掉的旧派生行数 */
  derived_removed: number;
  /** 内容变了但 `mode='reconcile'` ⇒ **拒写**并点名 */
  drifted: Array<{ refId: string; from: string; to: string }>;
  /** 同一 ref_id 已被 **engine** 行占用 ⇒ import 不覆盖（引擎行是账，MD 是它的旧投影） */
  owned_by_engine: number;
  dirty: Array<{ refId: string; bucket: string; sourceRef: string }>;
  multi_anchor: number;
  fence_body_unparsed: number;
  by_kind: Record<RowKind, number>;
  rulings: number;
  review_queued: number;
  subject_conflicts: SubjectConflict[];
  id_diff: ReconcileResult;
}

/** 报错时把**完整读数**挂在 error 上（"拒写"必须带点名，不许只说失败） */
export interface ImportError extends Error {
  report?: ImportReport;
}

/**
 * 把 MD 灌进 `ledger_rows`（幂等：同 MD 连跑两遍，第二遍 `added=0` 且整表逐字不变）。
 *
 * 两种模式（唯一区别 = **稿子在库里已经变旧时怎么办**）：
 * · `reconcile`（默认，**只读对账**）：发现漂移 ⇒ **一行都不写**并抛（附 report）——
 *   "跑了导入以为同步了"是最坏的静默；要写就显式 `refresh`。
 * · `refresh`：更新账行列 + 追加 `annotate` 事件（body 含**旧原文逐字**），派生层整层重建。
 *
 * ★ **task / ruling 行永不删**：MD 里删掉一条挂账 ≠ 这条账没存在过（销账是 `state` 的事，
 *   不是"从视图里消失"）。派生行可以整层重建 —— 它们是视图素材，不是账。
 */
export function importLedger(
  projectRoot: string,
  opts?: { mode?: 'reconcile' | 'refresh'; sourcePath?: string; by?: string },
): ImportReport {
  const mode = opts?.mode ?? 'reconcile';
  const by = opts?.by ?? 'importer';
  const relSource = opts?.sourcePath ?? DEFAULT_SOURCE;
  const sourceFile = path.isAbsolute(relSource) ? relSource : path.join(projectRoot, relSource);
  const text = fs.readFileSync(sourceFile, 'utf-8');
  const docSha = sha(text);
  const parsed = parseTodoMd(text, { sourceName: relSource });

  const derivedRows = parsed.rows.filter((r) => DERIVED_KINDS.includes(r.kind));
  const stableRows = parsed.rows.filter((r) => r.kind === 'task' || r.kind === 'ruling');
  const mdTaskIds = parsed.rows.filter((r) => r.kind === 'task' && r.businessId).map((r) => r.businessId as string);

  const want = new Map<string, ParsedRow>();
  for (const r of stableRows) if (!want.has(r.refId)) want.set(r.refId, r);
  const wantDerivedDigest = derivedDigest(derivedRows.map((r) => ({ kind: r.kind, detail: r.detail, raw: r.raw })));

  const report: ImportReport = {
    mode,
    source: sourceFile,
    doc_sha: docSha,
    parsed: parsed.rows.length,
    added: 0,
    unchanged: 0,
    refreshed: 0,
    derived_rebuilt: 0,
    derived_removed: 0,
    drifted: [],
    owned_by_engine: 0,
    dirty: parsed.dirty.map((r) => ({ refId: r.refId, bucket: String(r.dirty?.bucket), sourceRef: r.sourceRef })),
    multi_anchor: parsed.stats.multi_anchor,
    fence_body_unparsed: parsed.stats.fence_body_unparsed,
    by_kind: parsed.stats.by_kind,
    rulings: parsed.stats.rulings,
    review_queued: 0,
    subject_conflicts: [],
    id_diff: { ok: false, mdOnly: [], ledgerOnly: [], both: 0, mdCount: 0, ledgerActive: 0, note: '（导入后现算）' },
  };

  const db: DatabaseSync = openTasksDb(projectRoot);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const existingStable = new Map<
        string,
        { row_id: number; record_kind: string; source_json: string | null; state: string }
      >();
      for (const r of db
        .prepare(
          `SELECT rowid AS row_id, ref_id, record_kind, source_json, state FROM ledger_rows
            WHERE origin = 'import' AND record_kind IN ('task','ruling')`,
        )
        .all() as Array<{ row_id: number; ref_id: string; record_kind: string; source_json: string | null; state: string }>) {
        existingStable.set(r.ref_id, {
          row_id: Number(r.row_id),
          record_kind: r.record_kind,
          source_json: r.source_json,
          state: r.state,
        });
      }
      const existingDerived = db
        .prepare(
          `SELECT rowid AS row_id, record_kind, source_json FROM ledger_rows
            WHERE origin = 'import' AND record_kind IN ('prose','discipline','meta')
            ORDER BY ordinal, rowid`,
        )
        .all() as Array<{ row_id: number; record_kind: string; source_json: string | null }>;
      const haveDerivedDigest = derivedDigest(
        existingDerived.map((r) => ({ record_kind: r.record_kind, raw: '', source_json: r.source_json })),
      );
      const derivedChanged = existingDerived.length !== derivedRows.length || haveDerivedDigest !== wantDerivedDigest;

      const engineOwned = new Set(
        (db.prepare(`SELECT ref_id FROM ledger_rows WHERE origin = 'engine' AND state = 'active'`).all() as Array<{
          ref_id: string;
        }>).map((r) => r.ref_id),
      );

      const inserts: ParsedRow[] = [];
      const updates: Array<{ row: ParsedRow; rowId: number; oldRaw: string | null }> = [];
      for (const [refId, row] of want) {
        const next = sourceJsonOf(row);
        const hit = existingStable.get(refId);
        if (!hit) {
          if (engineOwned.has(refId)) {
            report.owned_by_engine += 1;
            continue;
          }
          inserts.push(row);
          continue;
        }
        if (hit.source_json === next) {
          report.unchanged += 1;
          continue;
        }
        let oldRaw: string | null = null;
        if (hit.source_json) {
          try {
            const o = JSON.parse(hit.source_json) as { raw?: unknown };
            oldRaw = typeof o.raw === 'string' ? o.raw : null;
          } catch {
            oldRaw = null;
          }
        }
        report.drifted.push({ refId, from: sha8(hit.source_json), to: sha8(next) });
        updates.push({ row, rowId: hit.row_id, oldRaw });
      }

      if (mode === 'reconcile' && (report.drifted.length || derivedChanged)) {
        db.exec('ROLLBACK');
        const e = new Error(
          `[ledger/import] reconcile 拒写：${report.drifted.length} 条账行漂移` +
            `${derivedChanged ? ' + 派生层（散文/标题/表头）与 MD 不一致' : ''}。` +
            `点名的漂移 ref_id：${report.drifted.slice(0, 8).map((d) => d.refId).join(' · ') || '（无账行漂移）'}` +
            `${report.drifted.length > 8 ? ' …' : ''}\n` +
            '  ⇒ 要么 MD 改了（跑 `mode:"refresh"` 把它写进引擎并留痕），要么你以为导过了（没有）。',
        ) as ImportError;
        e.report = { ...report };
        throw e;
      }

      for (const row of inserts) {
        const rowId = insertLedgerRow(db, {
          refId: row.refId,
          section: row.section,
          title: titleOf(row),
          problem: null,
          proposal: null,
          recordKind: row.kind,
          origin: 'import',
          subject: row.subject,
          ordinal: row.ordinal,
          sourceJson: sourceJsonOf(row),
        });
        report.added += 1;
        // ★ 只有**账**（task/ruling）才有首挂事件；派生行是视图素材，不是挂账
        appendEventTo(db, rowId, 'hang', by, `source=${row.sourceRef}`, null);
      }

      for (const u of updates) {
        const next = sourceJsonOf(u.row);
        db.prepare(
          `UPDATE ledger_rows
              SET section = ?, title = ?, problem = ?, record_kind = ?, subject_path = ?, subject_symbol = ?,
                  ordinal = ?, source_json = ?
            WHERE rowid = ?`,
        ).run(
          u.row.section,
          titleOf(u.row),
          null,
          u.row.kind,
          u.row.subject?.path ?? null,
          u.row.subject?.symbol ?? null,
          u.row.ordinal,
          next,
          u.rowId,
        );
        report.refreshed += 1;
        // ★ 旧文逐字进事件体（append-only ⇒ 事后可考古"改之前长什么样"）
        appendEventTo(
          db,
          u.rowId,
          'annotate',
          by,
          `[import/refresh] ref_id=${u.row.refId}\n旧 sha=${sha8(u.oldRaw)}\n新 sha=${sha8(next)}\n旧原文（逐字）：\n${
            u.oldRaw ?? '（旧行没有 source_json）'
          }`,
          null,
        );
      }

      if (mode === 'refresh' && derivedChanged) {
        const del = db.prepare(
          `DELETE FROM ledger_rows WHERE rowid = ? AND record_kind IN ('prose','discipline','meta')
             AND NOT EXISTS (SELECT 1 FROM ledger_events e WHERE e.row_id = ledger_rows.rowid)`,
        );
        for (const r of existingDerived) {
          const res = del.run(r.row_id);
          if (Number(res.changes ?? 0) > 0) report.derived_removed += 1;
        }
        for (const row of derivedRows) {
          insertLedgerRow(db, {
            refId: row.refId,
            section: row.section,
            title: titleOf(row),
            problem: null,
            proposal: null,
            recordKind: row.kind,
            origin: 'import',
            subject: row.subject,
            ordinal: row.ordinal,
            sourceJson: sourceJsonOf(row),
          });
          report.derived_rebuilt += 1;
        }
      }

      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* 已回滚（reconcile 拒绝路径自己 ROLLBACK 过） */
      }
      throw e;
    }
  } finally {
    db.close();
  }

  // ── 台账行落定后才排"待人工"（可消项队列；重复 import 不刷屏）
  for (const d of report.dirty) {
    if (d.bucket !== 'half-escaped') continue;
    queueReview(projectRoot, {
      refId: d.refId.startsWith('¶') ? null : d.refId,
      reason: 'half-escaped',
      detail: `${d.sourceRef}：一行粘了多行内容（前缀竖线已转义、后续没转义）⇒ 机器不许切它，整行进 source_json`,
      sourceJson: JSON.stringify({ source: d.sourceRef }),
    });
    report.review_queued += 1;
  }
  const conflicts = subjectConflicts(projectRoot);
  report.subject_conflicts = conflicts;
  for (const g of conflicts) {
    queueReview(projectRoot, {
      refId: null,
      subject: { path: g.subject_path, symbol: g.subject_symbol },
      reason: 'subject-conflict',
      detail:
        `${g.subject_path}${g.subject_symbol ? '#' + g.subject_symbol : ''} 有 ${g.members.length} 条活跃 task 行：` +
        g.members.map((m) => `${m.ref_id}(${m.origin})`).join(' · ') +
        ' ⇒ import 存量行豁免唯一索引（不阻塞迁移），但矛盾还在：人裁"合并 / supersede / 另起 subject"三选一',
      candidates: g.members.map((m) => m.ref_id),
    });
    report.review_queued += 1;
  }

  report.id_diff = reconcileLedgerIds(projectRoot, mdTaskIds);
  return report;
}
