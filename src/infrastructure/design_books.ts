/**
 * design_books —— 「**哪个 path 归哪一册持有**」的**唯一意图表**（仓根 `design-books.json`）与它的判定核。
 *
 * ## 它回答哪个问题（以及不回答哪些）
 * 答：**「改这个文件该领哪一册的卡 / 该进哪一册的画布」** = `ownerOf(path)`。
 * 不答：① 谁可以**断言**这个文件（断言级独占是另一条正交判据，实测已 0 冲突，本文件不碰）；
 *       ② 这个目录属**哪一层的哪个域**（那是 `structure.domains.json`，两套切法不许互相派生）。
 *
 * ## 唯一语句
 * ```
 * 对任一 path：|{册 | 该册有该 path 的文件节点}| ≤ 1
 * owner(path) = 域表里**最具体**命中的那一条（精确条目 > 前缀条目；长前缀 > 短前缀）
 *              未命中 ⇒ null（**判不了**，不兜底成任何一册）
 * ```
 * ★ **为什么必须有这张表（不能靠派生）**：存量能派生（节点在谁家），**新增不能** ——
 *   一个刚建出来的文件在册上什么都不存在，没有数据可推出"登记到哪一册"。改前这件事的回答是
 *   `newFileLedgerWarning` 的「**任一条在册即可**」+ 示例里写 `feature:'<feature>'`，
 *   把"选哪册"留给模型自由发挥 ⇒ 那正是 414 个跨册重复的生成机制。
 *
 * ## 三态（★ 不许折成两态）
 * · **表在 ∧ 命中** ⇒ `owner`（可能是 `null`：即 `unowned` 条目，语义是"这不是本仓的设计对象"）；
 * · **表在 ∧ 未命中** ⇒ `{matched:false}` —— 调用方必须说「域表没覆盖它」，**不许**当成"无属主"放行；
 * · **表不在 / 坏** ⇒ `{table:null, error}` —— 门：判不了（退出码 2）；写端：不裁决归属，只留痕。
 *
 * ## 纯核与 IO 的分界
 * 本文件只读**一个**文件（仓根 `design-books.json`）；"哪几册属于本项目"走
 * `storage#readDesignSheetsForGate`（唯一读端），由调用方把册传进来 —— 本文件不自己 readdir
 * `.agent-io/design/`（那是第二份册清单，0.9.1 禁止）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileNodeId, dirNodeId, docNodeId, isScannedNodeId } from './graph/node_id.js';

/** 表里的一条管辖条目：`owns[]` 的元素（字符串 = 路径；`{path, why}` = 带理由的路径） */
export type BookOwnsEntry = string | { path: string; why?: string };

/** 一册的意图（`books[]` 的元素） */
export interface DesignBook {
  /** feature 名（= 册文件名，与 `loadDesignSheetsForGate` 同口径） */
  feature: string;
  /** 它**持有**哪些 path（前缀条目以 `/` 结尾；其余按精确路径匹配） */
  owns: BookOwnsEntry[];
  /** 为什么是它（一句话；读端会原样带进报文） */
  why?: string;
}

/** 不属于任何册的路径（原 `excluded` 的语义并入这里：`owner = ∅`） */
export interface UnownedEntry {
  path: string;
  why?: string;
}

/** 仓根意图表的形状 */
export interface DesignBooksTable {
  note?: string;
  books: DesignBook[];
  unowned: Array<UnownedEntry | string>;
}

/** {@link readDesignBooks} 的读数（★ 三态都在这里，调用方不许只看 `table` 非空） */
export interface DesignBooksRead {
  /** 表（**null = 判不了**：文件不在 / 解析失败 / 形状坏） */
  table: DesignBooksTable | null;
  /** 表文件路径（报文点名用） */
  file: string;
  /** 判不了的原因（`table !== null` 时为空串） */
  error: string;
}

/** 统一路径口径：`\` → `/`、去 `./` 前缀、去尾随空白（**保留**尾随 `/` 作为"前缀条目"的标记） */
export function normBookPath(p: unknown): string {
  const s = String(p ?? '')
    .replace(/\\/g, '/')
    .trim();
  const stripped = s.startsWith('./') ? s.slice(2) : s;
  return stripped;
}

/** 条目 → 归一后的路径（`{path,why}` 与裸字符串两种写法都收） */
function entryPathOf(e: BookOwnsEntry | UnownedEntry | string): string {
  return normBookPath(typeof e === 'string' ? e : (e as { path?: string }).path);
}

/** 条目 → 理由（裸字符串 = 空） */
function entryWhyOf(e: BookOwnsEntry | UnownedEntry | string): string {
  return typeof e === 'string' ? '' : String((e as { why?: string }).why ?? '');
}

/**
 * 读仓根 `design-books.json` —— 三态，**不抛**（"判不了"要能被调用方如实转述）。
 *
 * ★ 为什么放仓根（与 `structure.domains.json` 并列）：它是**架构约定（意图）**，不是派生数据。
 */
export function readDesignBooks(root: string): DesignBooksRead {
  const file = path.join(path.resolve(root), 'design-books.json');
  if (!fs.existsSync(file)) {
    return { table: null, file, error: `域表不在：${file}（没有它 ⇒ 归属判不了，不是"没有属主"）` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { table: null, file, error: `域表读不了（${(e as Error).message}）：${file}` };
  }
  const t = raw as Partial<DesignBooksTable>;
  if (!t || typeof t !== 'object' || !Array.isArray(t.books) || !Array.isArray(t.unowned)) {
    return {
      table: null,
      file,
      error: `域表形状坏（要有 \`books[]\` 与 \`unowned[]\` 两个数组）：${file}`,
    };
  }
  for (const b of t.books) {
    if (!b || typeof b.feature !== 'string' || !b.feature.trim() || !Array.isArray(b.owns)) {
      return { table: null, file, error: `域表形状坏（\`books[]\` 里有一条缺 \`feature\` 或 \`owns[]\`）：${file}` };
    }
  }
  return { table: t as DesignBooksTable, file, error: '' };
}

/** 一条命中的候选（内部用） */
interface Candidate {
  /** 命中它的册；`null` = 命中 `unowned` 条目 */
  owner: string | null;
  entry: string;
  /** 具体度：精确条目 +1e6（再按长度），前缀条目按长度 —— 越大越具体 */
  score: number;
  why: string;
}

/** 命中判定：一条条目命中 `p` 吗（精确 / 前缀两种写法） */
function matches(entry: string, p: string): boolean {
  if (!entry) return false;
  return entry.endsWith('/') ? p.startsWith(entry) : p === entry;
}

function scoreOf(entry: string): number {
  return entry.endsWith('/') ? entry.length : 1_000_000 + entry.length;
}

/** {@link ownerOf} 的读数 */
export interface OwnerHit {
  /** 属主册；`null` + `matched:true` = 落在 `unowned` 条目里（不是设计对象）；`null` + `matched:false` = 域表没覆盖 */
  owner: string | null;
  /** 表在不在且命中（`false` ⇒ 判不了） */
  matched: boolean;
  /** 命中的那条条目（原样，便于报文点名） */
  entry: string;
  /** 命中的理由（表的 `why`） */
  why: string;
  /** 同具体度命中多册 ⇒ 判不了（域表自己打架；报文要点名两边） */
  ambiguous?: string[];
}

/**
 * **属主判定**（唯一实现）：最具体命中者赢；同具体度打到不同册 ⇒ 判不了（`ambiguous`）。
 *
 * ★ `unowned` 条目参与同一场比赛：它比"更宽的 owns 前缀"具体 ⇒ 能剥掉（`tests/fixtures/` 盖过 `tests/`）。
 */
export function ownerOf(table: DesignBooksTable, relPath: string): OwnerHit {
  const p = normBookPath(relPath);
  const cands: Candidate[] = [];
  for (const b of table.books) {
    for (const e of b.owns) {
      const entry = entryPathOf(e);
      if (!matches(entry, p)) continue;
      cands.push({ owner: b.feature, entry, score: scoreOf(entry), why: b.why ?? entryWhyOf(e) });
    }
  }
  for (const e of table.unowned) {
    const entry = entryPathOf(e);
    if (!matches(entry, p)) continue;
    cands.push({ owner: null, entry, score: scoreOf(entry), why: entryWhyOf(e) });
  }
  if (!cands.length) return { owner: null, matched: false, entry: '', why: '' };
  cands.sort((a, b) => b.score - a.score || a.entry.localeCompare(b.entry));
  const top = cands[0] as Candidate;
  const rivals = cands.filter((c) => c.score === top.score && c.owner !== top.owner);
  if (rivals.length) {
    const names = [String(top.owner ?? '∅'), ...rivals.map((c) => String(c.owner ?? '∅'))].sort();
    return { owner: null, matched: false, entry: top.entry, why: top.why, ambiguous: names };
  }
  return { owner: top.owner, matched: true, entry: top.entry, why: top.why };
}

/** 某册声明的管辖条目（**意图**；声明了却没有节点**不红** —— 意图可以先于数据） */
export function ownsOf(table: DesignBooksTable, feature: string): string[] {
  const b = table.books.find((x) => x.feature === feature);
  return (b?.owns ?? []).map((e) => entryPathOf(e));
}

// ───────────────────────────────────────────────────────────────────────────
// 册 → 持仓（holder）视图 + 跨册归属读数
// ───────────────────────────────────────────────────────────────────────────

/** 判定核需要的**最小册面**（`loadDesignSheetsForGate` 的读数直接就是它） */
export interface BookSheetLike {
  feature?: string;
  geometry?: {
    nodes?: ReadonlyArray<{
      id?: string;
      path?: string;
      task?: { state?: string; owner?: string | null };
      decision?: { expectations?: ReadonlyArray<unknown> };
    }>;
  };
}

/** 一个 path 上的一个持有者 */
export interface BookHolder {
  feature: string;
  /** 该节点上的判据条数（报文用它说"两边各几条"） */
  expectations: number;
  /** 该节点的卡态（`claimed` 时换手必须先 release —— 见 `assessWriteEnd`） */
  card: string | null;
  /** 节点 id */
  node: string;
}

/**
 * **一个 path → 它被哪几册持有**（节点级；`path` 为空的节点不算 —— 它们没有归属可判）。
 *
 * ★ 这是"归属重复"的**节点级**账，与 `assertedPathsBySheet`（**断言级**）是两本不同的账：
 *   断言级实测 0 冲突，节点级实测 414 —— 台账混着用这两个数会推错结论。
 */
export function bookHoldings(sheets: readonly BookSheetLike[]): Map<string, BookHolder[]> {
  const out = new Map<string, BookHolder[]>();
  for (const s of sheets) {
    const feature = normBookPath(s.feature);
    for (const n of s.geometry?.nodes ?? []) {
      const p = normBookPath(n.path);
      if (!p) continue;
      const list = out.get(p) ?? [];
      list.push({
        feature,
        expectations: Array.isArray(n.decision?.expectations) ? n.decision.expectations.length : 0,
        card: n.task?.state ? String(n.task.state) : null,
        node: String(n.id ?? ''),
      });
      out.set(p, list);
    }
  }
  return out;
}

/** 一个 path 在归属这条链上的归类（★ 五档互斥） */
export type BookPathClass =
  /** `h == 1` ∧ 域表属主 = 那一册 ⇒ 绿 */
  | 'owned'
  /** `h ≥ 2` ⇒ 红（存量挂账：批 1–13 逐批下降） */
  | 'multi_owned'
  /** `h == 1` ∧ 属主是**别的**册 ⇒ 红（存量挂账：批 14） */
  | 'owner_mismatch'
  /** `h ≥ 1` ∧ 落在 `unowned` 条目里 ⇒ 红（意图说"不是设计对象"，册上却有节点） */
  | 'unowned_but_held'
  /** 域表在 ∧ 未命中 ∧ 有节点 ⇒ 红（**判不了**：没有一条意图覆盖它） */
  | 'undeclared'
  /** 同具体度命中多册 ⇒ 红（域表自己打架） */
  | 'owner_ambiguous'
  /** 域表不在 ⇒ 整张读数判不了（计数恒 0，`applied:false` 才是那个事实） */
  | 'unjudged';

/** 一行逐条读数（报文/台账用） */
export interface CrossBookRow {
  path: string;
  klass: BookPathClass;
  /** 持有册（可能多册） */
  holders: BookHolder[];
  /** 域表属主（`null` = 域表说"无属主"或判不了；看 `entry` 与 `klass` 区分） */
  owner: string | null;
  /** 命中的条目（`''` = 未命中） */
  entry: string;
  /** 表给的理由 */
  why: string;
}

/** `id ≠ nodeIdOf(path)` 的一个节点（★ 批 15 收口后存量 = 0；此类型只服务读数与门点名） */
export interface NodeIdDrift {
  feature: string;
  path: string;
  id: string;
  /** 按单点派生应该是什么 */
  want: string;
  /** 这个 id 声称自己是哪一类（`file`/`dir`/`doc`；见 `isScannedNodeId`） */
  kind: 'file' | 'dir' | 'doc';
}

/** {@link crossBookOwnership} 的读数（★ 每个数都带分母） */
export interface CrossBookReading {
  /** 域表在不在（`false` ⇒ 下面所有分类都判不了，只有一个数是真的：`paths`） */
  applied: boolean;
  /** 域表判不了的原因（`applied:true` 时为空串） */
  table_error: string;
  /** 分母：册上有 path 的节点覆盖的 path 数（三册去重） */
  paths: number;
  /** 分母：册数 */
  books: number;
  counts: Record<BookPathClass, number>;
  /** 逐条（只收**不清白**的行 + `owned` 逐条给，台账要能逐条点名；排序稳定） */
  rows: CrossBookRow[];
  /** `id ≠ nodeIdOf(path)` 的节点（★ 存量挂账，批 15 收口后 = 0 —— 见 node_id.ts 的说明） */
  id_drift: { nodes: number; paths: number; rows: NodeIdDrift[] };
}

/**
 * **跨册归属读数**（纯函数）：`structure-gate` 的 ② 档与 `gen-db-check` 的读数都从这里取。
 *
 * ★ 与 ① 档（`design_line#silentGapsOf`：盘上有 ∧ 册上无节点）**互补不重叠**：
 *   ① 问「有没有人管」，② 问「是不是恰一个人在管」。`h == 0` 是 ① 的领域，这里**不重算**。
 */
export function crossBookOwnership(
  sheets: readonly BookSheetLike[],
  read: DesignBooksRead,
): CrossBookReading {
  const holdings = bookHoldings(sheets);
  const applied = read.table !== null;
  const counts: Record<BookPathClass, number> = {
    owned: 0,
    multi_owned: 0,
    owner_mismatch: 0,
    unowned_but_held: 0,
    undeclared: 0,
    owner_ambiguous: 0,
    unjudged: 0,
  };
  const rows: CrossBookRow[] = [];
  for (const [p, holders] of holdings) {
    const feats = [...new Set(holders.map((h) => h.feature))].sort();
    if (!applied) {
      counts.unjudged += 1;
      rows.push({ path: p, klass: 'unjudged', holders, owner: null, entry: '', why: '' });
      continue;
    }
    const hit = ownerOf(read.table as DesignBooksTable, p);
    let klass: BookPathClass;
    if (feats.length >= 2) klass = 'multi_owned';
    else if (!hit.matched) klass = hit.ambiguous ? 'owner_ambiguous' : 'undeclared';
    else if (hit.owner === null) klass = 'unowned_but_held';
    else klass = hit.owner === feats[0] ? 'owned' : 'owner_mismatch';
    counts[klass] += 1;
    rows.push({ path: p, klass, holders, owner: hit.owner, entry: hit.entry, why: hit.why });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const drift = nodeIdDriftOf(sheets);
  return {
    applied,
    table_error: read.error,
    paths: holdings.size,
    books: new Set(sheets.map((s) => normBookPath(s.feature))).size,
    counts,
    rows,
    id_drift: drift,
  };
}

/**
 * **`id ≠ nodeIdOf(path)` 的节点**（★ 判据只落在"**声称自己是扫描 id**"的节点上）。
 *
 * 为什么不判手写 id（`poison_claimed` / `n_a` 这类）：手写节点是册的合法成员（没有 path 派生关系）；
 * 而 `file_capability_map_ts`（只取 basename）**声称**它是 `file_` 派生的 ⇒ 那才是漂移。
 */
export function nodeIdDriftOf(sheets: readonly BookSheetLike[]): CrossBookReading['id_drift'] {
  const rows: NodeIdDrift[] = [];
  for (const s of sheets) {
    const feature = normBookPath(s.feature);
    for (const n of s.geometry?.nodes ?? []) {
      const p = normBookPath(n.path);
      const id = String(n.id ?? '');
      if (!p || !id || !isScannedNodeId(id)) continue;
      const kind: NodeIdDrift['kind'] = id.startsWith('dir_') ? 'dir' : id.startsWith('doc_') ? 'doc' : 'file';
      const want = kind === 'dir' ? dirNodeId(p) : kind === 'doc' ? docNodeId(p) : fileNodeId(p);
      if (id === want) continue;
      rows.push({ feature, path: p, id, want, kind });
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path) || a.feature.localeCompare(b.feature) || a.id.localeCompare(b.id));
  return { nodes: rows.length, paths: new Set(rows.map((r) => r.path)).size, rows };
}

// ───────────────────────────────────────────────────────────────────────────
// 写端判据（saveDSL 唯一写端的前置）
// ───────────────────────────────────────────────────────────────────────────

/** `assessWriteEnd` 的入参 */
export interface WriteEndInput {
  /** 本次要写的册 */
  feature: string;
  /** 该册**写前**的样子（`null` = 这一册还没落盘） */
  before: BookSheetLike | null;
  /** 本次要写的**内容** */
  after: BookSheetLike;
  /** 同项目的其他册（**不含**本册） */
  others: readonly BookSheetLike[];
  /** 域表读数（三态原样传进来；`table:null` ⇒ 本判据不适用） */
  books: DesignBooksRead;
}

/** 一条写端拒绝/放行的理由 */
export interface WriteEndIssue {
  /** 机读码 */
  code: 'new_duplicate' | 'not_owner' | 'undeclared' | 'unowned_declared' | 'bad_id' | 'claimed_on_transfer';
  path: string;
  /** 人话（**带着另一册与它的判据数** —— 报文必须能复算） */
  message: string;
  /** 换手时败方册（`claimed_on_transfer` / `new_duplicate` 用） */
  rival?: string;
  /** 要 release 的卡（`feature/node_id`），换手前必须先放掉 */
  card?: string;
}

/** {@link assessWriteEnd} 的读数 */
export interface WriteEndVerdict {
  /** 域表在不在（`false` ⇒ 归属判据**不适用**，`issues` 只可能含 `bad_id`） */
  applied: boolean;
  issues: WriteEndIssue[];
  /** 本次写入是"换手"的那些 path（新增节点落在**别册已有**的 path 上） */
  transfers: string[];
}

/**
 * **写端归属判据**（唯一实现，`saveDSL` 落盘前调一次）。
 *
 * ## 它判什么（只判**本次写入新增**的东西 —— 存量挂账不在这里清）
 * 1. `new_duplicate`：本次写入使某个 path 的**持有册数**从 1（或 0）变成 ≥2；
 * 2. `not_owner` / `undeclared` / `unowned_declared`：**新增节点**的 path 不落在本册 `owns` 里；
 * 3. `bad_id`：**新增节点**声称自己是扫描 id，却 ≠ `nodeIdOf(path)`；
 * 4. `claimed_on_transfer`：换手（新增节点落在别册已有的 path 上）且**败方那一侧的卡是 `claimed`**
 *    —— 必须先 `release`（`plans` 表 PK 含 `feature`，`write_log` 按 `card_id` 归因 ⇒ 硬收会造孤儿卡）。
 *
 * ## 为什么只判"新增"（这条决定了本判据能不能上线）
 * 存量实测 414 个跨册重复 path + 31 个异 id。**对存量也开红 = 写端当场把所有编辑打死**，
 * 于是它会在第一天被关掉（0.16：永远亮的告警 = 被关掉的告警）。⇒ 判据是"**新增 = 0**"，
 * 存量挂账在 `structure-gate` ② 档里逐条点名、逐批下降。
 * ★ "新增"的判据是**写前那一册里有没有这个 id / 这个 path 的重复**，不是"看起来对不对"。
 */
export function assessWriteEnd(input: WriteEndInput): WriteEndVerdict {
  const feature = normBookPath(input.feature);
  const issues: WriteEndIssue[] = [];
  const transfers: string[] = [];
  const beforeIds = new Set<string>();
  const beforePaths = new Set<string>();
  for (const n of input.before?.geometry?.nodes ?? []) {
    const id = String(n.id ?? '');
    if (id) beforeIds.add(id);
    const p = normBookPath(n.path);
    if (p) beforePaths.add(p);
  }
  // 写前：本册已经与别人共持的 path（存量重复，不判）
  const priorDup = new Set(
    [...beforePaths].filter((p) => (input.others ?? []).some((o) => holdsPath(o, feature, p))),
  );
  const after = input.after;
  for (const n of after.geometry?.nodes ?? []) {
    const p = normBookPath(n.path);
    if (!p) continue;
    const id = String(n.id ?? '');
    const isNew = !id || !beforeIds.has(id);
    const rivals = (input.others ?? []).filter((o) => o.feature !== feature && holdsPath(o, feature, p));
    // 1) 新增重复（存量重复不算新增：写前就有 ⇒ 放行，挂账在门上）
    if (rivals.length && (!priorDup.has(p) || isNew)) {
      const rival = rivals[0] as BookSheetLike;
      const counts = rivals.map((r) => `${normBookPath(r.feature)}(${expectationsOf(r, p)} 条判据)`).join(' / ');
      issues.push({
        code: 'new_duplicate',
        path: p,
        rival: normBookPath(rival.feature),
        message:
          `path \`${p}\` 已由 ${counts} 持有 ⇒ 本册（${feature}）再建一个节点会让 ` +
          `\`decision:<node_id>#i\` 又变成"按名字猜"（同一个 path 两个 id）`,
      });
      transfers.push(p);
      // 4) 换手前先 release：败方那侧的卡必须是候选态
      for (const r of rivals) {
        const card = cardStateOf(r, p);
        if (card === 'claimed') {
          const node = nodeIdOn(r, p);
          issues.push({
            code: 'claimed_on_transfer',
            path: p,
            rival: normBookPath(r.feature),
            card: `${normBookPath(r.feature)}/${node}`,
            message:
              `换手前必须先 \`release\`：${normBookPath(r.feature)} 侧的 \`${node}\` 上有一张 **claimed** 卡` +
              `（硬收会造孤儿卡 —— plans 表 PK 含 feature，write_log 按 card_id 归因）`,
          });
        }
      }
    }
    if (!isNew) continue;
    // 3) 新增节点的 id 必须来自单点派生（手写 `file_<basename>_ts` 当场点名）
    if (id && isScannedNodeId(id)) {
      const kind: NodeIdDrift['kind'] = id.startsWith('dir_') ? 'dir' : id.startsWith('doc_') ? 'doc' : 'file';
      const want = kind === 'dir' ? dirNodeId(p) : kind === 'doc' ? docNodeId(p) : fileNodeId(p);
      if (id !== want) {
        issues.push({
          code: 'bad_id',
          path: p,
          message: `新增节点 id \`${id}\` ≠ 单点派生 \`${want}\`（\`nodeIdOf('${p}')\`）—— 同 path 两 id 就是跨册引用判不了的根`,
        });
      }
    }
    // 2) 新增节点的 path 必须落在本册 owns 里（域表在的时候才判）
    if (!input.books.table) continue;
    const hit = ownerOf(input.books.table, p);
    if (!hit.matched) {
      issues.push({
        code: 'undeclared',
        path: p,
        message:
          `域表（design-books.json）**没有一条**覆盖 \`${p}\` ⇒ 归属判不了。` +
          `新增文件必须先声明（在它的 \`owns[]\` 或 \`unowned[]\` 里加一条），否则下一册又会自己看着办`,
      });
    } else if (hit.owner === null) {
      issues.push({
        code: 'unowned_declared',
        path: p,
        message: `\`${p}\` 被声明为 **unowned**（${hit.entry}：${hit.why || '表里没写理由'}）⇒ 它不该有节点；要建节点请先改表`,
      });
    } else if (hit.owner !== feature) {
      issues.push({
        code: 'not_owner',
        path: p,
        message: `\`${p}\` 的属主是 **${hit.owner}**（命中 \`${hit.entry}\`${hit.why ? `：${hit.why}` : ''}）⇒ 写端只许属主册写`,
      });
    }
  }
  return { applied: input.books.table !== null, issues, transfers: [...new Set(transfers)] };
}

/** 某册是否持有某 path（`path` 为空的节点不算） */
function holdsPath(sheet: BookSheetLike, _feature: string, p: string): boolean {
  return (sheet.geometry?.nodes ?? []).some((n) => normBookPath(n.path) === p);
}

/** 某册在某 path 上的判据条数（报文用） */
function expectationsOf(sheet: BookSheetLike, p: string): number {
  let n = 0;
  for (const node of sheet.geometry?.nodes ?? []) {
    if (normBookPath(node.path) !== p) continue;
    n += Array.isArray(node.decision?.expectations) ? node.decision.expectations.length : 0;
  }
  return n;
}

/** 某册在某 path 上的卡态（多节点取"最活"的那个：claimed > 其他） */
function cardStateOf(sheet: BookSheetLike, p: string): string | null {
  const states = (sheet.geometry?.nodes ?? [])
    .filter((n) => normBookPath(n.path) === p)
    .map((n) => (n.task?.state ? String(n.task.state) : null))
    .filter((x): x is string => !!x);
  if (states.includes('claimed')) return 'claimed';
  return states[0] ?? null;
}

/** 某册在某 path 上的节点 id（报文点名用） */
function nodeIdOn(sheet: BookSheetLike, p: string): string {
  const n = (sheet.geometry?.nodes ?? []).find((x) => normBookPath(x.path) === p);
  return String(n?.id ?? '');
}
