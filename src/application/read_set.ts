/**
 * read_set —— 「我读过的东西，是不是已经被别人改了」：写前**假设检定**（★ 只报，不拦）
 *
 * ## 它买的是什么
 * agent 的推理依赖它**读过**的那些符号。那些符号在"读"与"写"之间被别人改了 ⇒ 这次编辑
 * 是基于**旧假设**的（STORM, arXiv 2605.20563：把冲突检测从"合并时"挪到"写入时"；
 * Aura 的 collision detection 三层里的 **Dependency 层**就是这个）。
 * ⇒ 写闸在落盘前比一次指纹，命中就在回执里点名「你读的 X 变了（h1→h2）」，让 agent 自己重读。
 *
 * ## ★ 为什么不阻塞（用户 2026-10-21 定，别再改回去）
 * 「不用做那么精确，LLM 自己会适配；只要做到大致的影响、减少不良后果即可。」
 * 一旦阻塞，就会出现"agent 被莫名其妙拦住"的新故障 —— 那个代价比"偶尔漏报一条"大得多。
 * ⇒ 本模块**只产出读数**，判据与 `task_gate`（A7 谁在写）**完全分开**：A7 管身份，这里管假设。
 *
 * ## ★ 读集存在进程内存里（按 project × actor 分桶）—— 理由写在 `STORE` 上
 * ## ★ 粒度
 * · 符号级：`sym_hash`（= `symbolSpanHash`，去注释/空白后的 sha1）—— 与索引的符号 diff **同一个函数**，
 *   所以"改注释/格式化"不会虚报；
 * · 文件级：`contentHash`（= `files.content_hash`）—— 只有"整文件读、又指不出符号"时才退到这一层。
 *   ★ 退化是**明示**的：回执里 `symbol:null` 就是"只能到文件粒度"。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getProjectCacheDb, nearestCacheDb, projectCacheDbPath } from '../infrastructure/index/db.js';
import { contentHash, symbolSpanHash, toIndexKey } from '../infrastructure/index/symbols.js';
import { parseFileFullSync } from '../infrastructure/parse/index.js';
import { splitKeepEnds } from '../infrastructure/text/line_utils.js';

// ─────────────────────────────────────────────────────────────
// 类型（对外契约：回执里的 `assumption_check` 就是 `AssumptionCheck`）
// ─────────────────────────────────────────────────────────────

/** 一个符号指纹（`symbol` = qualified_name；`name` 用于按短名匹配） */
export interface ReadSymbolFp {
  symbol: string;
  name?: string;
  /** `sym_hash`（sha1 前 12 位在渲染层截；这里存全量） */
  fp: string;
  start?: number;
  end?: number;
}

/** 读集里的一条（一个 actor 对一个文件的一次读；同 actor 同文件**后者覆盖前者**） */
export interface ReadSetEntry {
  project: string;
  actor: string;
  /** 仓库相对 posix 路径（索引键） */
  file: string;
  kind: 'read' | 'facts';
  at: number;
  /** 文件级指纹（`contentHash(源码)`） */
  file_fp: string;
  /** 本次读到的符号（按返回的行区间/符号过滤） */
  symbols: ReadSymbolFp[];
  /**
   * ★ Dependency 层（Aura 的第 3 层）：读过的符号**正向一跳**依赖的符号。
   * `via` = 从哪个读过的符号走过来的（回执里要说清"你读 A，A 依赖 B"）。
   * ★ 只取一跳（`edges.kind IN ('call','type_ref')`）：两跳开始噪声指数上升
   *   （A 调到工具函数、工具函数调到全局 util ⇒ 全仓都相关），而"我读的 A 的**直接**依赖"才是
   *   A 的假设里真正会咬人的那一层。用户已明确否决传递闭包（贵且不准）。
   */
  deps: Array<ReadSymbolFp & { via: string; file: string }>;
  /** 记录时的退化说明（没索引 / 解析器没预热 / 依赖被截断 …）—— 不许静默 */
  note?: string;
}

/** 一条过期假设（回执形态；字段名按任务卡） */
export interface StaleAssumption {
  /** 变了的符号（`null` = 只能到文件粒度：整文件读、又指不出符号） */
  symbol: string | null;
  file: string;
  /** 谁读过它（写自己的读集也会被点名 —— 那正是"我读完之后它变了"） */
  reader: string;
  /** 读那一刻的指纹（12 位；`null` 不会出现在这里） */
  read_fp: string;
  /** 现在的指纹；`null` = 符号已不存在（删了/改名了） */
  now_fp: string | null;
  /** 读的时间（ISO） */
  read_at: string;
  /** ★ Dependency 层命中：`via` = 变化来自"读过的符号所依赖的符号" */
  via?: 'dependency';
  /** `via=dependency` 时：读者读的那个符号 */
  via_symbol?: string;
}

/** 写前假设检定的读数（★ 独立字段，别混进 `task_gate`） */
export interface AssumptionCheck {
  /** 本次真的比了几对（reader × symbol）；0 = 读集里没有与本次写集相交的东西 */
  checked: number;
  stale: StaleAssumption[];
  /** 读集里参与本次比的 actor 数（0 也算读数：`checked:0` 时说明"没人读过"） */
  readers: number;
  /** 超过上限被截掉的条数（>0 才出现） */
  stale_truncated?: number;
  /** 检定自身失败（**不是**"没查"）：写闸会把它放进读数，但**绝不因此拒绝落盘** */
  error?: string;
}

/** 写集里的一项：文件 + 可选符号（`symbol` 缺省 ⇒ 这一项只能做文件级比对） */
export interface AssumptionTarget {
  file: string;
  symbol?: string;
}

// ─────────────────────────────────────────────────────────────
// 存储：**进程内存**，按 (project, actor) 分桶
// ─────────────────────────────────────────────────────────────
//
// ## 为什么是内存（而不是 `.agent-io/sessions/<actor>.json` 或 cache.db 一张表）
//   ① 读集回答的是「**当前这一轮工作**的假设还成不成立」 —— 它是**瞬态**，不是事实；
//      重启后旧假设**本来就该失效**（重读一遍很便宜，拿着隔夜的读集去判反而会误报）。
//   ② cache.db 是**可重建的派生层**（索引），把"会话状态"塞进去会让"删库重建"顺带丢掉协作状态，
//      也会让只读方（facts/read）产生**写库**副作用。
//   ③ 会话文件要清理、要处理多进程写冲突、要防陈旧 —— 为一件瞬态事实引入一套持久化，
//      成本远大于收益。
//
// ## ★ 边界（诚实写在这里，别在文档里假装没有）
//   **MCP server 一次只服务一个客户端进程（stdio：每个客户端 spawn 一个 server）**。
//   所以：
//   · **同一个 server 进程内**的多个 actor（同一宿主会话里的多个子代理 / 多次带 `actor` 的调用）
//     ⇒ 读集**共享**，本能力成立；
//   · **不同 server 进程之间**（两个客户端各自 spawn 一个 server）⇒ **互不可见**；
//   · **CLI 每次是独立进程** ⇒ 天然没有"会话" ⇒ 读集只在**常驻面**有效，
//     CLI 面每次都从空读集开始（回执里 `checked:0`，**不是**"没人改过"）。
//   ⇒ 这是选内存的**代价**，也是本能力的**适用面**。要做跨进程就得持久化（方案 b/c），
//     那要另立一笔（清理策略 + 多进程锁），不在本笔偷偷塞进去。

const STORE = new Map<string, Map<string, ReadSetEntry>>();

/** 读集里的匿名桶（调用方没自报身份时的唯一桶） */
export const ANONYMOUS_ACTOR = '(anonymous)';

/** 一个 bucket 最多记多少个文件（安全阀：常驻进程不许被读集撑爆） */
const MAX_FILES_PER_BUCKET = 200;

/** 条目 TTL：超过就丢（读集是"当前工作假设"，2 小时前的读已经没有判据价值） */
const READ_SET_TTL_MS = 2 * 60 * 60 * 1000;

/** 一次记录最多带多少条依赖（防大符号把一跳闭包撑爆） */
const MAX_DEPS_PER_READ = 40;

/** 一次假设检定最多回多少条 stale（超过只计数，不刷屏） */
const MAX_STALE_REPORTED = 20;

const bucketKey = (project: string, actor: string): string => `${project}\u0000${actor}`;

function pruneBucket(bucket: Map<string, ReadSetEntry>): void {
  const now = Date.now();
  for (const [file, e] of bucket) if (now - e.at > READ_SET_TTL_MS) bucket.delete(file);
  while (bucket.size > MAX_FILES_PER_BUCKET) {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [file, e] of bucket) {
      if (e.at < oldestAt) {
        oldestAt = e.at;
        oldest = file;
      }
    }
    if (oldest === null) break;
    bucket.delete(oldest);
  }
}

// ─────────────────────────────────────────────────────────────
// 指纹读取：**一个文件的符号 + fp**（优先索引，索引不同源就现解析）
// ─────────────────────────────────────────────────────────────

interface FileFacts {
  file: string;
  /** `contentHash(当前源码)`；文件不存在时为空串 */
  file_fp: string;
  symbols: ReadSymbolFp[];
  /** `db` = 索引与磁盘同源，fp 直接取 `nodes.sym_hash`；`disk` = 现解析；`none` = 拿不到 */
  source: 'db' | 'disk' | 'none';
  note?: string;
}

/** 同一文件在**一次** record/check 里只读一次（跨调用不缓存：缓存 = 判据读到旧世界） */
type FactsCache = Map<string, FileFacts>;

function extOf(rel: string): string {
  return path.extname(rel).slice(1).toLowerCase();
}

/** 现解析磁盘源码 → 符号 fp（与索引的 `sym_hash` 同一函数 `symbolSpanHash`） */
function factsFromDisk(root: string, rel: string, content: string): FileFacts {
  const abs = path.join(root, ...rel.split('/'));
  const parsed = parseFileFullSync(abs, content);
  if (parsed.error) {
    return {
      file: rel,
      file_fp: contentHash(content),
      symbols: [],
      source: 'none',
      note: `解析失败（${parsed.error}）⇒ 只能到文件级`,
    };
  }
  const lines = splitKeepEnds(content);
  const ext = extOf(rel);
  return {
    file: rel,
    file_fp: contentHash(content),
    source: 'disk',
    symbols: parsed.symbols.map((s) => ({
      symbol: s.qualified_name,
      name: s.name,
      fp: symbolSpanHash(lines, s.start_line, s.end_line, ext),
      start: s.start_line,
      end: s.end_line,
    })),
  };
}

/**
 * 读一个文件的符号指纹。
 *
 * ★ 优先索引（便宜、且 `sym_hash` 就是索引 diff 用的那一份）；但**必须验证同源**
 *   （`files.content_hash === contentHash(当前源码)`）—— 不同源就**现解析**，
 *   绝不把旧索引的 fp 当成"读者看到的那一版"（那会制造假 stale）。
 * ★ 没有任何索引也**不建**（`projectCacheDbPath` 存在性先判 ⇒ 不给只读路径造库副作用）。
 */
function loadFileFacts(root: string, rel: string, cache: FactsCache): FileFacts {
  const hit = cache.get(rel);
  if (hit) return hit;
  const abs = path.join(root, ...rel.split('/'));
  let content = '';
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    const miss: FileFacts = { file: rel, file_fp: '', symbols: [], source: 'none', note: '文件不存在/读不到' };
    cache.set(rel, miss);
    return miss;
  }
  const fileFp = contentHash(content);
  const dbFile = projectCacheDbPath(root);
  if (fs.existsSync(dbFile)) {
    try {
      const db = getProjectCacheDb(root);
      const row = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: rel }) as
        | { content_hash: string }
        | undefined;
      if (row && row.content_hash === fileFp) {
        const rows = db
          .prepare(
            "SELECT name, qualified_name, start_line, end_line, sym_hash FROM nodes WHERE file_path = $p AND kind != 'file'",
          )
          .all({ p: rel }) as Array<{
          name: string;
          qualified_name: string;
          start_line: number;
          end_line: number;
          sym_hash: string | null;
        }>;
        const out: FileFacts = {
          file: rel,
          file_fp: fileFp,
          source: 'db',
          symbols: rows
            .filter((r) => !!r.sym_hash)
            .map((r) => ({
              symbol: r.qualified_name,
              name: r.name,
              fp: r.sym_hash as string,
              start: r.start_line,
              end: r.end_line,
            })),
        };
        cache.set(rel, out);
        return out;
      }
    } catch {
      // 索引读不了（旧库缺列 / 被锁）⇒ 落到现解析；这里不静默，note 会在下面带上
    }
  }
  const disk = factsFromDisk(root, rel, content);
  if (disk.source === 'none' && !disk.note) disk.note = '索引不同源且现解析失败 ⇒ 只能到文件级';
  cache.set(rel, disk);
  return disk;
}

/** 在 `facts` 里找一个符号（先精确 qualified_name，再短名）；重载会有多条 */
function fpsOf(facts: FileFacts, symbol: string): ReadSymbolFp[] {
  const byQn = facts.symbols.filter((s) => s.symbol === symbol);
  if (byQn.length) return byQn;
  return facts.symbols.filter((s) => s.name === symbol);
}

// ─────────────────────────────────────────────────────────────
// Dependency 层：读过的符号**正向一跳**依赖（edges: call / type_ref）
// ─────────────────────────────────────────────────────────────

function oneHopDeps(
  root: string,
  file: string,
  symbols: ReadSymbolFp[],
  cache: FactsCache,
): { deps: Array<ReadSymbolFp & { via: string; file: string }>; note?: string } {
  const dbFile = projectCacheDbPath(root);
  if (!fs.existsSync(dbFile) || symbols.length === 0) return { deps: [] };
  const rels = symbols.map((s) => s.symbol);
  try {
    const db = getProjectCacheDb(root);
    const marks = rels.map(() => '?').join(',');
    const src = db
      .prepare(`SELECT id, qualified_name FROM nodes WHERE file_path = ? AND qualified_name IN (${marks})`)
      .all(file, ...rels) as Array<{ id: string; qualified_name: string }>;
    if (!src.length) return { deps: [] };
    const idToQn = new Map(src.map((r) => [r.id, r.qualified_name] as const));
    const idMarks = src.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT e.source AS src, n.qualified_name AS qn, n.file_path AS file
           FROM edges e JOIN nodes n ON n.id = e.target
          WHERE e.source IN (${idMarks}) AND e.kind IN ('call','type_ref')`,
      )
      .all(...src.map((r) => r.id)) as Array<{ src: string; qn: string; file: string }>;
    const seen = new Set<string>();
    const picked: Array<{ file: string; symbol: string; via: string }> = [];
    for (const r of rows) {
      const key = `${r.file}#${r.qn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({ file: r.file, symbol: r.qn, via: idToQn.get(r.src) ?? '' });
      if (picked.length >= MAX_DEPS_PER_READ) break;
    }
    const deps: Array<ReadSymbolFp & { via: string; file: string }> = [];
    for (const p of picked) {
      const f = loadFileFacts(root, p.file, cache);
      const now = fpsOf(f, p.symbol)[0];
      if (!now) continue; // 依赖的符号在索引里没有 fp ⇒ 不收（收入一条假 fp 比漏一条坏）
      deps.push({
        symbol: p.symbol,
        name: now.name,
        fp: now.fp,
        start: now.start,
        end: now.end,
        via: p.via,
        file: p.file,
      });
    }
    const truncated = rows.length > picked.length;
    return { deps, ...(truncated ? { note: `依赖只取前 ${MAX_DEPS_PER_READ} 条` } : {}) };
  } catch {
    return { deps: [], note: '依赖层没取到（索引不可读）' };
  }
}

// ─────────────────────────────────────────────────────────────
// 记录：read / facts 两个入口（由 presentation 的唯一入口调用）
// ─────────────────────────────────────────────────────────────

export interface RecordReadInput {
  projectRoot: string;
  /** 已解析的 actor（`null` ⇒ 匿名桶） */
  actor: string | null;
  /** 仓库相对路径或绝对路径 */
  file: string;
  kind: 'read' | 'facts';
  /** read：本次真正返回的行区间（1-based 含端点）—— 决定"读到了哪些符号" */
  range?: { start: number; end: number };
  /** facts：本次返回的符号（qualified_name；空 = 退回按区间取） */
  symbols?: string[];
}

export interface RecordReadResult {
  recorded: boolean;
  symbols: number;
  deps: number;
  note?: string;
}

/**
 * 记一条读集。
 *
 * ★ `read` 与 `facts` 的**粒度差别**（如实写在回执里）：
 *   · `read` 只有行号范围 ⇒ 用"与返回区间相交的符号" + 索引/现解析的 `sym_hash`；
 *     **不**把"整文件的符号表"全记下来 —— 那个表只是导航（`data.symbols`，还可能被截断）。
 *   · `facts` 本身就是符号级的（`data.symbols` 就是返回的行）⇒ 按那些 qualified_name 记。
 * ★ 本函数**绝不抛**（读工具不能因为"记读集"失败而失败）；失败用 `note` 说清。
 */
export function recordRead(input: RecordReadInput): RecordReadResult {
  try {
    const root = path.resolve(input.projectRoot);
    const rel = toIndexKey(root, input.file);
    if (!rel) return { recorded: false, symbols: 0, deps: 0, note: '文件在项目根外 ⇒ 无索引键，不记读集' };
    const cache: FactsCache = new Map();
    const facts = loadFileFacts(root, rel, cache);
    if (!facts.file_fp) return { recorded: false, symbols: 0, deps: 0, note: facts.note ?? '读不到源码，不记读集' };

    // ① 本次读到的符号
    let picked: ReadSymbolFp[];
    if (input.symbols && input.symbols.length) {
      const wanted = new Set(input.symbols);
      picked = facts.symbols.filter((s) => wanted.has(s.symbol) || (s.name ? wanted.has(s.name) : false));
    } else if (input.range) {
      const { start, end } = input.range;
      picked = facts.symbols.filter((s) => (s.end ?? 0) >= start && (s.start ?? 0) <= end);
    } else {
      picked = facts.symbols;
    }
    // 重载同 qn 时保留全部（指纹可能不同），但同 (qn,fp) 去重
    const seen = new Set<string>();
    picked = picked.filter((s) => {
      const k = `${s.symbol}\u0000${s.fp}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // ② Dependency 层（读过的符号正向一跳）
    const depRes = oneHopDeps(root, rel, picked, cache);

    const actor = (input.actor && input.actor.trim()) || ANONYMOUS_ACTOR;
    const key = bucketKey(root, actor);
    let bucket = STORE.get(key);
    if (!bucket) {
      bucket = new Map();
      STORE.set(key, bucket);
    }
    const notes = [facts.note, depRes.note].filter((x): x is string => !!x);
    bucket.set(rel, {
      project: root,
      actor,
      file: rel,
      kind: input.kind,
      at: Date.now(),
      file_fp: facts.file_fp,
      symbols: picked,
      deps: depRes.deps,
      ...(notes.length ? { note: notes.join('；') } : {}),
    });
    pruneBucket(bucket);
    return {
      recorded: true,
      symbols: picked.length,
      deps: depRes.deps.length,
      ...(notes.length ? { note: notes.join('；') } : {}),
    };
  } catch (e) {
    return { recorded: false, symbols: 0, deps: 0, note: (e as Error).message };
  }
}

/**
 * 从**工具回执**里认出一条读（`read` / `facts`）—— 唯一调用点是 `invokeTool`。
 *
 * ★ 为什么挂在 `invokeTool`（而不是改 `readFacts` / `readCode`）：
 *   · 它是 MCP 面与 CLI 面的**唯一入口**，两个面自动同口径；
 *   · 读集是"**谁**在读"，而"谁"（`actor`）只在这一层有（`read`/`facts` 的 args 里没有身份维度）；
 *   · `read`/`facts` 的产物形状（`rel_path` / `symbols` / `start` / `end`）是**回执契约**，
 *     在这里解它，不必把两个读函数都改成"知道会话"。
 * ★ 不认识的工具/动作 ⇒ 直接返回（这不是"静默失败"，是"不适用"）。
 */
export function recordReadFromInvocation(input: {
  tool: string;
  action: string;
  actor: string | null;
  root: string | null;
  data: unknown;
}): RecordReadResult {
  if (input.tool !== 'explore_code') return { recorded: false, symbols: 0, deps: 0 };
  // ★ 先按 action 短路：`search` / `guided_tour` 的产物可能很大，不认识的 action **不解包**。
  if (input.action !== 'read' && input.action !== 'facts') return { recorded: false, symbols: 0, deps: 0 };
  const d = input.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return { recorded: false, symbols: 0, deps: 0 };
  // ★ 根的来源：① 入参解析出来的根 ② 回执里的 project_dir（facts 恒有）
  //   ③ **从被读文件的绝对路径向上找 `.agent-io/cache.db`** —— `read` 不要求 project_dir，
  //      缺了它也得能记（否则最常见的调法反而记不上）。`nearestCacheDb` 是仓里已有的"向上找"。
  let root: string | null = input.root ?? (typeof d['project_dir'] === 'string' ? (d['project_dir'] as string) : null);
  if (!root && typeof d['file'] === 'string' && path.isAbsolute(d['file'] as string)) {
    const hit = nearestCacheDb(path.dirname(d['file'] as string));
    if (hit) root = path.dirname(path.dirname(hit));
  }
  if (!root) return { recorded: false, symbols: 0, deps: 0, note: '没有项目根（也找不到 .agent-io/cache.db）⇒ 读集未记录' };

  if (input.action === 'read') {
    // ★ 用 `file`（绝对）而不是 `rel_path`：没有 project_dir 时 rel_path 就是绝对路径，
    //   `toIndexKey` 两种都收，但绝对路径在有根时也能正确归一。
    const rel = typeof d['file'] === 'string' ? (d['file'] as string) : d['rel_path'];
    if (typeof rel !== 'string' || !rel) return { recorded: false, symbols: 0, deps: 0, note: '回执里没有 file/rel_path' };
    const start = typeof d['start'] === 'number' ? (d['start'] as number) : undefined;
    const end = typeof d['end'] === 'number' ? (d['end'] as number) : undefined;
    return recordRead({
      projectRoot: root,
      actor: input.actor,
      file: rel,
      kind: 'read',
      range: start !== undefined && end !== undefined ? { start, end } : undefined,
    });
  }
  if (input.action === 'facts') {
    const rel = d['file'];
    if (typeof rel !== 'string' || !rel) return { recorded: false, symbols: 0, deps: 0, note: '回执里没有 file' };
    const rows = Array.isArray(d['symbols']) ? (d['symbols'] as Array<Record<string, unknown>>) : [];
    const symbols = rows
      .map((r) => (typeof r['qualified_name'] === 'string' ? (r['qualified_name'] as string) : ''))
      .filter((s) => !!s);
    return recordRead({ projectRoot: root, actor: input.actor, file: rel, kind: 'facts', symbols });
  }
  return { recorded: false, symbols: 0, deps: 0 };
}

// ─────────────────────────────────────────────────────────────
// 比对：写前假设检定（★ 判据只有这一处）
// ─────────────────────────────────────────────────────────────

const shortFp = (fp: string): string => fp.slice(0, 12);

function ageText(at: number): string {
  const d = Math.max(0, Date.now() - at);
  if (d < 60_000) return `${Math.round(d / 1000)} 秒前`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)} 分钟前`;
  return `${Math.round(d / 3_600_000)} 小时前`;
}

function entriesOfProject(project: string): ReadSetEntry[] {
  const out: ReadSetEntry[] = [];
  for (const [key, bucket] of STORE) {
    // bucketKey = project \0 actor ⇒ 前缀匹配比逐条看 e.project 更便宜，也更不会串桶
    if (!key.startsWith(`${project}\u0000`)) continue;
    for (const e of bucket.values()) out.push(e);
  }
  return out;
}

/**
 * 写前假设检定。
 *
 * 判据：**本次要写的 (file, symbol) ∩ 某人的读集 ≠ ∅** ⇒ 比指纹；
 *   不一致（或符号已不存在）⇒ 一条 `stale`。
 *
 * ★ 包含**写者自己的读集**：那正是"我读完之后别人改了、我现在要写"的主场景（任务卡 ⑤）。
 *   ★ 自己上一次写造成的"改动"不算过期 —— 写成功后会调 {@link refreshAfterOwnWrite}
 *     把该 actor 的基线刷到写后（否则第二次写必然报一条假 stale）。
 *
 * ★ 单文件 `replace_text` 这类**没有符号**的写：退到文件级（`symbol:null`）——
 *   粒度变粗、**但回执里明写**，不假装是符号级。
 */
export function checkAssumptions(input: {
  projectRoot: string;
  files: readonly string[];
  targets?: readonly AssumptionTarget[];
}): AssumptionCheck {
  const root = path.resolve(input.projectRoot);
  const rels = new Set<string>();
  for (const f of input.files) {
    const r = toIndexKey(root, f);
    if (r) rels.add(r);
  }
  const targets: AssumptionTarget[] = [];
  for (const t of input.targets ?? []) {
    const r = toIndexKey(root, t.file);
    if (r) targets.push({ file: r, ...(t.symbol ? { symbol: t.symbol } : {}) });
  }
  if (!rels.size && !targets.length) return { checked: 0, stale: [], readers: 0 };

  const entries = entriesOfProject(root).filter((e) => rels.has(e.file) || targets.some((t) => t.file === e.file));
  const readers = new Set(entries.map((e) => e.actor));
  const cache: FactsCache = new Map();
  const stale: StaleAssumption[] = [];
  let checked = 0;

  const pushStale = (s: StaleAssumption): void => {
    if (stale.some((x) => x.reader === s.reader && x.file === s.file && x.symbol === s.symbol && x.via === s.via)) return;
    stale.push(s);
  };

  for (const e of entries) {
    const tg = targets.filter((t) => t.file === e.file);
    const facts = loadFileFacts(root, e.file, cache);

    // ── ① 文件级（没有目标符号 / 读者没记下任何符号时）──
    const hasSymbolTargets = tg.some((t) => !!t.symbol);
    if (!hasSymbolTargets) {
      checked++;
      if (e.file_fp !== facts.file_fp) {
        pushStale({
          symbol: null,
          file: e.file,
          reader: e.actor,
          read_fp: shortFp(e.file_fp),
          now_fp: facts.file_fp ? shortFp(facts.file_fp) : null,
          read_at: new Date(e.at).toISOString(),
        });
      }
    }

    // ── ② 符号级 + Dependency 级 ──
    for (const t of tg) {
      if (!t.symbol) continue;
      const recs = e.symbols.filter((s) => s.symbol === t.symbol || s.name === t.symbol);
      for (const rec of recs) {
        checked++;
        // ★ 用**指纹集合**比（不是"取第一条"）：同 qn 的重载有多条 span/多条 sym_hash，
        //   取第一条会把另一条重载的真实存在误报成"签名变了"。
        const nowAll = fpsOf(facts, t.symbol);
        const nowSet = new Set(nowAll.map((x) => x.fp));
        if (nowAll.length === 0) {
          pushStale({
            symbol: t.symbol,
            file: e.file,
            reader: e.actor,
            read_fp: shortFp(rec.fp),
            now_fp: null,
            read_at: new Date(e.at).toISOString(),
          });
        } else if (!nowSet.has(rec.fp)) {
          pushStale({
            symbol: t.symbol,
            file: e.file,
            reader: e.actor,
            read_fp: shortFp(rec.fp),
            now_fp: shortFp(nowAll[0].fp),
            read_at: new Date(e.at).toISOString(),
          });
        }
      }
      // ★ Dependency 层：目标符号是"读者读过的某个符号的依赖" ⇒ 也要报
      const depRecs = e.deps.filter((d) => d.symbol === t.symbol || d.name === t.symbol);
      for (const dep of depRecs) {
        checked++;
        const depFacts = loadFileFacts(root, dep.file, cache);
        const nowAll = fpsOf(depFacts, dep.symbol);
        const nowFp = nowAll[0]?.fp ?? null;
        if (!nowFp || !nowAll.some((x) => x.fp === dep.fp)) {
          pushStale({
            symbol: t.symbol,
            file: dep.file,
            reader: e.actor,
            read_fp: shortFp(dep.fp),
            now_fp: nowFp ? shortFp(nowFp) : null,
            read_at: new Date(e.at).toISOString(),
            via: 'dependency',
            ...(dep.via ? { via_symbol: dep.via } : {}),
          });
        }
      }
    }
  }

  const truncated = Math.max(0, stale.length - MAX_STALE_REPORTED);
  return {
    checked,
    stale: truncated ? stale.slice(0, MAX_STALE_REPORTED) : stale,
    readers: readers.size,
    ...(truncated ? { stale_truncated: truncated } : {}),
  };
}

/**
 * 写成功后：把**写者自己**的基线刷到写后。
 *
 * 为什么必须有：不刷的话，写者第二次写同一个符号时会拿"自己上一次写之前"的指纹来比 ⇒
 * 必然报一条 stale —— 那不是"别人改了"，是"你自己刚改的"。这种假警报一多就没人看了
 * （用户的原话：别每次都报警）。
 * ★ 只刷**这个 actor 自己的**条目；别人的读集不动（他们确实需要知道这里变了）。
 * ★ 只更新"原本记过的符号"（不新增），保持"读者读过什么"这个语义不被写操作扩大。
 */
export function refreshAfterOwnWrite(projectRoot: string, actor: string | null, files: readonly string[]): number {
  try {
    const root = path.resolve(projectRoot);
    const who = (actor && actor.trim()) || ANONYMOUS_ACTOR;
    const bucket = STORE.get(bucketKey(root, who));
    if (!bucket) return 0;
    const cache: FactsCache = new Map();
    let patched = 0;
    for (const f of files) {
      const rel = toIndexKey(root, f);
      if (!rel) continue;
      const facts = loadFileFacts(root, rel, cache);
      if (!facts.file_fp) continue;
      const entry = bucket.get(rel);
      if (entry) {
        entry.file_fp = facts.file_fp;
        entry.symbols = entry.symbols
          .map((s): ReadSymbolFp | null => {
            const now = fpsOf(facts, s.symbol)[0];
            return now ? { ...s, fp: now.fp, start: now.start, end: now.end } : null;
          })
          .filter((s): s is ReadSymbolFp => !!s);
        patched++;
      }
      // 依赖里指向这个文件的，也一起刷（否则下一次写依赖会报"你自己刚改的"）
      for (const [, other] of bucket) {
        other.deps = other.deps
          .map((d): (ReadSymbolFp & { via: string; file: string }) | null => {
            if (d.file !== rel) return d;
            const now = fpsOf(facts, d.symbol)[0];
            return now ? { ...d, fp: now.fp, start: now.start, end: now.end } : null;
          })
          .filter((d): d is ReadSymbolFp & { via: string; file: string } => !!d);
      }
    }
    return patched;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// 人读侧（★ 只在 stale 非空时加行 —— 空不刷屏）
// ─────────────────────────────────────────────────────────────

/**
 * 把假设检定渲染成人读的几行；`stale` 为空 ⇒ 返回 `[]`（**不产生任何噪声**）。
 * ★ 与 `exemptionLines` 同一条纪律：机器字段在 `data`，这里只负责"人能不能看见"。
 */
export function assumptionLines(check: AssumptionCheck | undefined): string[] {
  if (!check || check.stale.length === 0) return [];
  const lines = [
    `★ 假设过期：${check.stale.length + (check.stale_truncated ?? 0)} 条（**不阻塞**，本次写入照常落盘）—— ` +
      `你/别人读过的符号在这之后变了，继续写可能基于旧假设：`,
  ];
  for (const s of check.stale) {
    const who = s.reader === ANONYMOUS_ACTOR ? '（未自报身份的一方）' : s.reader;
    const what = s.symbol
      ? `\`${s.symbol}\`（${s.file}）`
      : `整个文件（${s.file}，★ 只能到文件粒度）`;
    const fp = `${s.read_fp}→${s.now_fp ?? '（已不存在）'}`;
    const why = s.via === 'dependency'
      ? `${who} 读过 \`${s.via_symbol ?? '?'}\`，它依赖的 ${what} 变了：${fp}`
      : `${who} 读过的 ${what} 变了：${fp}`;
    const when = new Date(s.read_at).getTime() ? `（读于 ${ageText(new Date(s.read_at).getTime())}）` : '';
    lines.push(`  · ${why}${when}`);
  }
  if (check.stale_truncated) lines.push(`  · …另有 ${check.stale_truncated} 条未列出（上限 ${MAX_STALE_REPORTED}）`);
  lines.push('  ★ 处理：重读受影响的符号（explore_code action=read/facts）确认现状后再决定怎么改。');
  return lines;
}
