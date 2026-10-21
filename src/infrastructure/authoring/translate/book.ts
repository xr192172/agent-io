/**
 * book —— 翻译册的**生成器**（从 cache.db 派生 symbols / shapes，types / atoms 是人写的，不覆盖）
 *
 * ## 它解决什么（为什么不能手写）
 * 账要一一对应到源侧每个导出符号。实测 src/ 当前有 **2682** 个（2627 直接 export + 55 个
 * exported class 的方法）。手写到第 29 条已经是极限 ⇒ 账必须从**事实库**派生，人只维护
 * 「术语映射」（`types`）与「原子规则」（`atoms`）那两小块。
 *
 * ## 复跑语义（改术语表 ⇒ 重跑 ⇒ 账跟着变）
 * 输入 = 现成册子的 `types` / `atoms` / 人写的行；输出 = 重算后的 `symbols` / `shapes`。
 * 合并规则（按 `from` = `nodes.id` 对齐）：
 *   · `state` 属于 {translated, verified, diff, stubbed} ⇒ **保留**（人的进度，不倒退）；
 *   · `state=blocked` 且 note **不以 `[auto]` 开头** ⇒ **保留**（人判的阻断，例如正则 lookahead 在 Go 里不支持）；
 *   · 其余 ⇒ 重算 `to` / `state` / 自动 note；**人写的 note 一律保留**（有就用有的）。
 *   · `origin=added`（源侧不存在的目标符号）⇒ **原样保留**，不过生成器管。
 *
 * ## 覆盖判据（⑤「还差哪几条术语」的唯一来源）
 * 一个符号被判 `blocked` 当且仅当它的类型面里出现了**术语表覆盖不到的名字**：
 * 不是内建、不是容器泛型、不是泛型参数、也不是仓内声明的类型（interface/type/class）。
 * ⇒ blocked 的条数就是「术语表还差几条」的真实读数；`unknowns` 里逐条点名。
 *
 * ## 诚实边界
 *   · 只收 **export**（+ exported class 的方法）。非导出符号（约 1300 个函数）**不进账** ——
 *     它们跨文件不可见，翻译时跟着所在文件走；要进账得先定「内部符号怎么记」。
 *   · `to` 只是**机械可算的目标名**（包路径 + 标识符），不代表函数体翻好了。
 *   · 结构型类型（匿名对象 / 真联合 / 函数类型）没有身份 ⇒ 进 `shapes` 按类聚合，不逐条造 id。
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// ── 类型 ────────────────────────────────────────────────────────────────

export interface BookSymbol {
  from: string | null;
  to: string | null;
  kind: string;
  origin: 'source' | 'added';
  state: string;
  note?: string;
}

export interface BookShape {
  /** 稳定键（func / inline_object / union）—— unknowns 按它引用，不按数组下标 */
  id?: string;
  from: { shape: string };
  to: { shape: string } | null;
  origin: 'source' | 'added';
  count?: number;
  samples?: string[];
  note?: string;
}

/** 册子的宽松形状：只强类型化本模块**读写**的块，其余原样透传。 */
export interface TranslateBook {
  id: string;
  kind: string;
  version: number;
  feature: string;
  meta: Record<string, unknown>;
  types: Array<Record<string, unknown>>;
  symbols: BookSymbol[];
  shapes: BookShape[];
  atoms: Array<Record<string, unknown>>;
  unknowns: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface BookGenOptions {
  /** 被分析项目根（cache.db 所在） */
  projectDir: string;
  /** 要读写的册子路径 */
  bookPath: string;
  /** 源侧前缀（默认 `src/`）与目标侧前缀（默认 `internal/`） */
  srcPrefix?: string;
  targetPrefix?: string;
  /** 生成时刻（可注入，便于测试确定性） */
  now?: string;
}

export interface BookGenStats {
  symbols: number;
  pending: number;
  blocked: number;
  added: number;
  blockedByTerm: number;
  blockedByCollision: number;
  /** static 方法（Go 没有静态方法）⇒ 目标形态待人工定 */
  blockedByStatic: number;
  shapes: number;
  scanRev: number | null;
  dbSchemaVersion: number | null;
  srcFiles: number;
}

/** 一行 nodes 事实（只取生成器要用的列）。 */
interface NodeRow {
  id: string;
  kind: string;
  name: string;
  file_path: string;
  start_line: number;
  parent: string | null;
  return_type: string | null;
  params: string | null;
  members: string | null;
  type_params: string | null;
  modifiers: string | null;
}

// ── 词表（唯一住处：本文件）─────────────────────────────────────────────

/** Go 侧保持全大写的初值缩略词（Go Code Review Comments · Initialisms）。 */
const GO_INITIALISMS = new Set([
  'dsl', 'api', 'url', 'uri', 'http', 'https', 'json', 'sql', 'ast', 'mcp', 'llm',
  'ts', 'tsx', 'db', 'id', 'ui', 'io', 'ip', 'yaml', 'html', 'css', 'sse', 'rpc',
  'cpu', 'pid', 'jwt', 'cors', 'grpc', 'sdk', 'cli', 'urls', 'ids', 're',
]);

/** 名义内建（有「一个词 ↔ 一个词」的映射）。 */
const NOMINAL = new Set(['string', 'number', 'boolean', 'any', 'unknown', 'object', 'symbol', 'bigint', 'this']);
/** 内建容器 / 工具泛型（必须带参数一起翻，见 types）。 */
const CONTAINER = new Set([
  'Promise', 'Array', 'ReadonlyArray', 'Record', 'Map', 'Set', 'WeakMap', 'WeakSet', 'ReadonlySet', 'ReadonlyMap',
  'Partial', 'Required', 'Pick', 'Omit', 'Readonly', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters',
  'InstanceType', 'Awaited', 'ArrayLike', 'Iterable', 'Iterator', 'RegExp', 'Date', 'Error', 'Function',
  'Uint8Array', 'Buffer', 'JSON',
]);
/** 空值 / 存在性原子（不是类型名）。 */
const NULLISH = new Set(['null', 'undefined', 'void', 'never', 'true', 'false']);

/** 自动判定的 blocked 必须带这个前缀（与人工 blocked 区分；见文件头「复跑语义」）。 */
const AUTO_TAG = '[auto]';
/** 人不该被生成器覆盖的状态。 */
const STICKY_STATES = new Set(['translated', 'verified', 'diff', 'stubbed']);

// ── 名字映射 ────────────────────────────────────────────────────────────

/** TS 标识符 → Go 标识符（Pascal / 初值缩略词；`_` 前缀剥掉但**不**降为小写 —— 见 note）。 */
export function goName(tsName: string): string {
  const raw = tsName.replace(/^_+/, '') || tsName;
  if (/^[A-Z0-9_]+$/.test(raw)) {
    return raw
      .split('_')
      .filter(Boolean)
      .map((part) => (GO_INITIALISMS.has(part.toLowerCase()) ? part.toUpperCase() : part[0] + part.slice(1).toLowerCase()))
      .join('');
  }
  const parts = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return parts
    .map((p) => (GO_INITIALISMS.has(p.toLowerCase()) ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join('');
}

/** `src/a/b.ts` → `internal/a/b.go`（Go 的包 = 目录；见 atoms.module）。 */
export function goPath(filePath: string, srcPrefix = 'src/', targetPrefix = 'internal/'): string {
  const rel = filePath.startsWith(srcPrefix) ? filePath.slice(srcPrefix.length) : filePath;
  return targetPrefix + rel.replace(/\.(ts|tsx|mts|cts)$/, '.go');
}

// ── 类型面分析 ──────────────────────────────────────────────────────────

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const stripLiterals = (s: string): string => s.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ');

/** 一个节点的全部类型表达式（返回 / 形参 / 成员）。★ 先剥注释 —— 不剥会数出注释里的英文词。 */
export function typeExpressions(row: NodeRow): string[] {
  const out: string[] = [];
  if (row.return_type) out.push(row.return_type);
  for (const p of parseJson<Array<{ type?: string }>>(row.params, [])) if (p?.type) out.push(p.type);
  for (const m of parseJson<Array<{ type?: string }>>(row.members, [])) if (m?.type) out.push(m.type);
  return out;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback; // 坏 JSON 不猜（本仓铁律：没跑 ≠ 跑过）
  }
}

/** 该节点声明的泛型参数名（`<T>` / `<T extends X>`）。 */
function genericNames(row: NodeRow): Set<string> {
  const out = new Set<string>();
  for (const t of parseJson<Array<string | { name?: string }>>(row.type_params, [])) {
    const n = typeof t === 'string' ? t.trim().split(/[\s:]/)[0] : t?.name;
    if (n) out.add(String(n));
  }
  return out;
}

/**
 * 找出**术语表覆盖不到**的类型名（blocked 的唯一判据）。
 * ★ 只看大写开头的标识符（小写裸名是属性键或限定名前缀）；跳过泛型参数与单字母。
 */
export function unmappedTypes(row: NodeRow, declared: ReadonlySet<string>): string[] {
  const generics = genericNames(row);
  const bad = new Set<string>();
  for (const expr of typeExpressions(row)) {
    const text = stripLiterals(stripComments(expr));
    for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const w = m[0];
      if (NOMINAL.has(w) || CONTAINER.has(w) || NULLISH.has(w)) continue;
      if (declared.has(w) || generics.has(w)) continue;
      if (/^[A-Z][0-9]?$/.test(w)) continue; // 泛型实参（T / K / V）
      if (/^[A-Z]/.test(w)) bad.add(w);
    }
  }
  return [...bad].sort();
}

// ── shapes 分类 ─────────────────────────────────────────────────────────

interface ShapeCat {
  id: string;
  label: string;
  to: { shape: string } | null;
  match: (s: string) => boolean;
}

const SHAPE_CATS: ShapeCat[] = [
  {
    id: 'func',
    label: '(p: T) => U（函数类型）',
    to: { shape: 'func(T) U' },
    match: (s) => /=>/.test(s),
  },
  {
    id: 'inline_object',
    label: '{ ... }（内联对象类型 / 匿名结构）',
    to: null,
    match: (s) => /\{/.test(s),
  },
  {
    id: 'union',
    label: 'A | B（真联合，不含 null/undefined）',
    to: null,
    match: (s) => /\|/.test(s) && !/\b(null|undefined|void)\b/.test(s),
  },
];

function classifyShape(expr: string): ShapeCat | null {
  const text = stripLiterals(stripComments(expr)).trim();
  if (!text) return null;
  for (const cat of SHAPE_CATS) if (cat.match(text)) return cat;
  return null;
}

// ── 读库 ────────────────────────────────────────────────────────────────

function openBookDb(projectDir: string): DatabaseSync {
  const dbFile = path.join(projectDir, '.agent-io', 'cache.db');
  if (!fs.existsSync(dbFile)) {
    throw new Error(
      `翻译册生成失败：找不到事实库 ${dbFile}。\n` +
        `★ 账必须从事实派生（不手写）；先对 ${projectDir} 跑一次索引（import_project / explore_code）再来。`,
    );
  }
  return new DatabaseSync(dbFile, { readOnly: true }); // ★ 只读：生成器不改事实
}

/**
 * 取「该进账的符号」：所有 exported 节点 + **exported class 的方法**。
 * ★ 方法节点自己不带 `export`（导出的是 class）⇒ 只按 export 取会漏掉整个类的方法面。
 * ★ 关联靠 `(file_path, parent=类名)`：`nodes.parent` 存的是**名字**不是 id（实测），所以两列一起用。
 */
function readSymbolRows(db: DatabaseSync): { rows: NodeRow[]; srcFiles: number } {
  const cols = `id, kind, name, file_path, start_line, parent, return_type, params, members, type_params, modifiers`;
  const where = `language='ts' AND file_path LIKE 'src/%' AND file_path NOT LIKE '%.d.ts'`;
  const direct = db
    .prepare(
      `SELECT ${cols} FROM nodes WHERE ${where} AND kind IN ('function','const','interface','type','class')` +
        ` AND modifiers LIKE '%"export"%' ORDER BY file_path, start_line`,
    )
    .all() as unknown as NodeRow[];
  const classes = new Set(direct.filter((r) => r.kind === 'class').map((r) => `${r.file_path}#${r.name}`));
  const methods = (
    db.prepare(`SELECT ${cols} FROM nodes WHERE ${where} AND kind='method' ORDER BY file_path, start_line`).all() as unknown as NodeRow[]
  ).filter((m) => m.parent && classes.has(`${m.file_path}#${m.parent}`));
  const srcFiles = (db.prepare(`SELECT count(*) AS c FROM files WHERE language='ts' AND path LIKE 'src/%' AND path NOT LIKE '%.d.ts'`).get() as { c: number }).c;
  return { rows: [...direct, ...methods].sort((a, b) => (a.file_path === b.file_path ? a.start_line - b.start_line : a.file_path < b.file_path ? -1 : 1)), srcFiles };
}

// ── 生成 ────────────────────────────────────────────────────────────────

function autoNote(row: NodeRow, bad: string[], target: string): string {
  if (bad.length) return `${AUTO_TAG} 术语表未覆盖：${bad.join(', ')} ⇒ 先补 types（或判它 \`added\`），再翻 ${target}。`;
  return ''; // ★ pending 不写逐行样板话（2695 行同一句 = 噪音；「pending 是什么」住 meta.state_machine）
}

/**
 * 目标符号名（含 class 的两条特判）。
 * ★ 构造器：Go 没有「方法形态的构造器」⇒ `New<Type>` 包级函数（**形态变了**，必须看得见）。
 * ★ private 方法：Go 的小写 = **包级**私有（放宽）⇒ 照实降为首字母小写，不静默导出。
 */
export function goSymbolName(row: NodeRow): string {
  if (row.kind === 'method' && row.parent) {
    if (row.name === 'constructor') return 'New' + goName(row.parent);
    const base = goName(row.name);
    const isPrivate = (row.modifiers ?? '').includes('"private"');
    return `${goName(row.parent)}.${isPrivate ? base.charAt(0).toLowerCase() + base.slice(1) : base}`;
  }
  return goName(row.name);
}

function shapeStats(rows: readonly NodeRow[]): Map<string, { count: number; samples: string[]; distinct: Set<string> }> {
  const out = new Map<string, { count: number; samples: string[]; distinct: Set<string> }>();
  for (const r of rows) {
    for (const expr of typeExpressions(r)) {
      const cat = classifyShape(expr);
      if (!cat) continue;
      const e = out.get(cat.id) ?? { count: 0, samples: [], distinct: new Set<string>() };
      e.count++;
      const norm = stripLiterals(stripComments(expr)).replace(/\s+/g, ' ').trim().slice(0, 120);
      e.distinct.add(norm);
      if (e.samples.length < 5 && !e.samples.some((s) => s.endsWith(norm))) {
        e.samples.push(`${r.file_path}:${r.start_line} ${r.name} ⇒ ${norm}`);
      }
      out.set(cat.id, e);
    }
  }
  return out;
}

/**
 * 从事实库重建册子（**纯函数式**：不写盘；写盘交给 {@link writeBook}）。
 * ★ 保留 `types` / `atoms` / `unknowns` / `meta`（人写的），只重算 `symbols` / `shapes`。
 */
export function generateBook(book: TranslateBook, opts: BookGenOptions): { book: TranslateBook; stats: BookGenStats } {
  const srcPrefix = opts.srcPrefix ?? 'src/';
  const targetPrefix = opts.targetPrefix ?? 'internal/';
  const db = openBookDb(opts.projectDir);
  try {
    const { rows, srcFiles } = readSymbolRows(db);
    const declared = new Set(
      (db.prepare(`SELECT DISTINCT name FROM nodes WHERE language='ts' AND kind IN ('interface','type','class')`).all() as Array<{ name: string }>).map((r) => r.name),
    );
    const scanRev = (db.prepare('SELECT max(indexed_at) AS m FROM files').get() as { m: number | null }).m;
    let schemaVersion: number | null = null;
    try {
      schemaVersion = (db.prepare('SELECT max(version) AS v FROM schema_versions').get() as { v: number | null }).v;
    } catch {
      schemaVersion = null;
    }

    const before = new Map(book.symbols.filter((s) => s.from).map((s) => [s.from as string, s]));
    const kept: BookSymbol[] = book.symbols.filter((s) => !s.from); // origin=added 的原样保留

    // 先算 to（撞名要按 target 分组，得先全算完）
    const mapped = rows.map((row) => {
      const target = goPath(row.file_path, srcPrefix, targetPrefix);
      // ★ static 方法：Go 没有静态方法 ⇒ 目标形态未定（包级函数 XxxYyy / 独立函数）⇒ to=null，人工定
      const isStatic = row.kind === 'method' && (row.modifiers ?? '').includes('"static"');
      const to = isStatic ? null : `${target}#${goSymbolName(row)}`;
      const bad = unmappedTypes(row, declared);
      return { row, to, target, bad, isStatic };
    });
    const byTarget = new Map<string, number>();
    for (const m of mapped) if (m.to) byTarget.set(m.to, (byTarget.get(m.to) ?? 0) + 1);

    const symbols: BookSymbol[] = [];
    let blockedByTerm = 0;
    let blockedByCollision = 0;
    let blockedByStatic = 0;
    for (const { row, to, target, bad, isStatic } of mapped) {
      const prev = before.get(row.id);
      const collision = !!to && (byTarget.get(to) ?? 0) > 1;
      const kind: 'term' | 'collision' | 'static' | null = bad.length
        ? 'term'
        : collision
          ? 'collision'
          : isStatic
            ? 'static'
            : null;
      let state = kind ? 'blocked' : 'pending';
      if (kind === 'term') blockedByTerm++;
      if (kind === 'collision') blockedByCollision++;
      if (kind === 'static') blockedByStatic++;

      const sticky =
        prev &&
        (STICKY_STATES.has(prev.state) || (prev.state === 'blocked' && !(prev.note ?? '').startsWith(AUTO_TAG)));
      if (sticky) state = prev.state;

      const auto =
        kind === 'collision'
          ? `${AUTO_TAG} 同包撞名：${byTarget.get(to as string)} 个源符号都映射到 ${to} ⇒ 需人工改名（Go 同包不允重名）。`
          : kind === 'static'
            ? `${AUTO_TAG} static 方法：Go 没有静态方法 ⇒ 目标形态未定（包级函数 ${goSymbolName(row).replace('.', '')} / 独立函数），故 to=null。`
            : autoNote(row, bad, to ?? target);

      symbols.push({
        from: row.id,
        to,
        kind: row.kind, // ★ 从 nodes.kind 现取，不手写
        origin: 'source',
        state,
        // ★ note 优先级：人写的（有且非 [auto]）> 本次自动。有 note 但不 sticky 时也保留人的说明。
        note: prev?.note && !prev.note.startsWith(AUTO_TAG) ? prev.note : auto,
      });
    }

    // shapes：按类聚合（结构没有身份 ⇒ 不逐条造 id）
    const stats = shapeStats([...rows]);
    const shapes: BookShape[] = SHAPE_CATS.map((cat) => {
      const s = stats.get(cat.id);
      const prev = book.shapes.find((sh) => sh.from?.shape === cat.label);
      return {
        id: cat.id, // ★ 稳定键：unknowns 按它引用（按数组下标引用会在重排后指错，实测已踩过）
        from: { shape: cat.label },
        to: cat.to,
        origin: 'source' as const,
        count: s?.count ?? 0,
        samples: s?.samples ?? [],
        note:
          prev?.note ??
          `${AUTO_TAG} 由生成器从类型表达式分类得到：${s?.distinct.size ?? 0} 种不同写法、${s?.count ?? 0} 处出现。`,
      };
    });

    // unknowns：生成的（`[auto]` 前缀）每次重算；人写的原样保留 —— ⑤「还差哪几条术语」就从这里读
    const termHit = new Map<string, string[]>();
    for (const s of symbols) {
      if (s.state !== 'blocked' || !String(s.note).includes('术语表未覆盖')) continue;
      const m = String(s.note).match(/术语表未覆盖：([^⇒]+)⇒/);
      for (const t of (m?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
        const arr = termHit.get(t) ?? [];
        arr.push(s.from as string);
        termHit.set(t, arr);
      }
    }
    const collisionGroups = new Map<string, string[]>();
    for (const s of symbols) {
      if (s.state !== 'blocked' || !String(s.note).includes('同包撞名')) continue;
      const arr = collisionGroups.get(s.to as string) ?? [];
      arr.push(s.from as string);
      collisionGroups.set(s.to as string, arr);
    }
    const staticRows = symbols.filter((s) => s.state === 'blocked' && String(s.note).includes('static 方法'));
    const autoUnknowns: Array<Record<string, unknown>> = [
      ...[...termHit.entries()].map(([t, hits]) => ({
        where: `[auto] 术语表未覆盖 · ${t}`,
        what: `${t} 没有对应术语 ⇒ 引用它的 ${hits.length} 个符号全部 blocked`,
        why:
          `补一条 types（源词 → Go 类型）后重跑生成器即可自动解锁；或判它 \`origin=added\`（目标侧新建）。` +
          `\n  涉及：${hits.slice(0, 5).join(' · ')}${hits.length > 5 ? ` …共 ${hits.length} 个` : ''}`,
      })),
      ...(staticRows.length
        ? [
            {
              where: `[auto] static 方法 · ${staticRows.length} 个（Go 没有静态方法）`,
              what: '目标形态未定：包级函数 `TypeMethod` / 独立函数 / 挂在单例上，三条都会改调用点',
              why:
                `逐个定（改的是形状，不是名字）。清单：\n  ` +
                staticRows.map((s) => String(s.from).split('#').slice(1).join('#')).join('\n  '),
            },
          ]
        : []),
      ...(collisionGroups.size
        ? [
            {
              where: `[auto] 同包撞名 · ${collisionGroups.size} 组 / ${[...collisionGroups.values()].reduce((a, v) => a + v.length, 0)} 个符号`,
              what: 'TS 的值与类型分属两个命名空间，Go 只有一个 ⇒ 同名（仅大小写不同）会撞',
              why:
                `逐组人工改名（改哪一侧是决定，不是机械替换）。前 6 组：\n  ` +
                [...collisionGroups.entries()]
                  .slice(0, 6)
                  .map(([to, hits]) => `${to} ← ${hits.map((h) => h.split('#')[1]).join(' | ')}`)
                  .join('\n  '),
            },
          ]
        : []),
    ];
    const unknowns = [
      ...book.unknowns.filter((u) => !String(u.where ?? '').startsWith(AUTO_TAG)),
      ...autoUnknowns,
    ];

    const out: TranslateBook = {
      ...book,
      symbols: [...symbols, ...kept].sort((a, b) => String(a.from ?? '').localeCompare(String(b.from ?? ''))),
      shapes,
      unknowns,
      meta: {
        ...book.meta,
        // ★ 基线跟着每次生成走：「这份账反映哪一代事实」只有一处（别留两个 baseline 互相打架）
        baseline: {
          ...(book.meta.baseline as Record<string, unknown> | undefined),
          db: '.agent-io/cache.db',
          scanRev,
          scanRevIso: scanRev ? new Date(scanRev).toISOString() : null,
          dbSchemaVersion: schemaVersion,
          srcFiles,
          note:
            '★ 由生成器每轮重算（scanRev = max(files.indexed_at)，schema = max(schema_versions.version)）：' +
            '这是「这份账反映哪一代事实」的唯一读数。types/atoms 的决定时间不在这里（它们是人写的）。',
        },
        book_gen: {
          generator: 'src/infrastructure/authoring/translate/book.ts#generateBook',
          run_at: opts.now ?? new Date().toISOString(),
          rules: [
            '入账面 = exported（modifiers 含 export）+ exported class 的方法（按 file_path+parent 关联；方法自己不带 export）',
            'to = 目标路径（src/ → internal/）+ Go 标识符（Pascal；初值缩略词全大写，见 GO_INITIALISMS）',
            'method 形态：constructor → New<Class>（包级函数）；private → 首字母小写（包级私有）',
            'kind 从 nodes.kind 现取；state 由「术语覆盖 + 同包撞名」决定，人的进度不被倒退（translated/verified/diff/stubbed 与人工 blocked 保留）',
            'shapes 按类型表达式分类聚合（结构无身份，不逐条造 id）',
            'unknowns 里 [auto] 开头的每次重算，其余（人写的）原样保留',
          ],
          stats: { symbols: symbols.length + kept.length, blockedByTerm, blockedByCollision, blockedByStatic, added: kept.length },
        },
      },
    };
    const stat: BookGenStats = {
      symbols: symbols.length + kept.length,
      pending: symbols.filter((s) => s.state === 'pending').length,
      blocked: symbols.filter((s) => s.state === 'blocked').length,
      added: kept.length,
      blockedByTerm,
      blockedByCollision,
      blockedByStatic,
      shapes: shapes.reduce((a, s) => a + (s.count ?? 0), 0),
      scanRev,
      dbSchemaVersion: schemaVersion,
      srcFiles,
    };
    return { book: out, stats: stat };
  } finally {
    db.close();
  }
}

/** 写册子（唯一落盘点；缩进 2 便于人读 — 设计侧是人可读可改的）。 */
export function writeBook(bookPath: string, book: TranslateBook): void {
  fs.mkdirSync(path.dirname(bookPath), { recursive: true });
  fs.writeFileSync(bookPath, JSON.stringify(book, null, 2) + '\n', 'utf8');
}

/** 便捷入口：读册子 → 重建 → 写回。返回本次读数。 */
export function rebuildBook(opts: BookGenOptions): BookGenStats {
  const book = JSON.parse(fs.readFileSync(opts.bookPath, 'utf8')) as TranslateBook;
  const { book: next, stats } = generateBook(book, opts);
  writeBook(opts.bookPath, next);
  return stats;
}
