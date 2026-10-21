/**
 * field_refs —— find_references 的 field/type 结构引用引擎（tree-sitter 背书的分类）
 *
 * 背景：find_references mode=field 第一版用正则，够用但粗糙——把「构造点、解构读取、
 * 声明键」全算成 field-key，还漏方括号访问、会把注释/字符串里的字面匹配当引用。
 * 本模块改用 ts_kernel 的 AST（parseAstRoot，节点带字节偏移）做精确分类：
 *
 *   field 模式：
 *     - 读取点   obj.field / obj?.field / obj['field'] / obj["field"]
 *     - 构造点   { field: v }（对象字面量键，pair 于 object 内）
 *     - 解构点   const { field } = o（object_pattern）
 *     - 声明点   interface T { field: string } / type T = { field: ... }（object_type）
 *     - 去噪     AST 判定能跳过注释/字符串里的同名文本
 *     - 行内上下文 snippet（免 LLM 再开文件）
 *     - scope   closure（给 file 时按 import 闭包）| all（全项目扫）
 *     - ★ of_type（2026-10-10，T125「备菜」）：**按所属类型限定**——收窄到该类型声明文件的
 *       import 闭包，并把**能确证不属于该类型**的声明点丢弃，其余的（读/构/解 与 ownerType 未知的
 *       声明点）**一律保留**（本仓无类型推断 ⇒ 无法判定 ⇒ 不许丢真引用，只做"能证伪才丢"）。
 *       ★ 声明点能确证：AST 里包着它的 `interface_declaration` / `type_alias_declaration` 的名字就是
 *       ownerType（见 `enclosingTypeName`）；读取/构造/解构点要知接收者的类型 ⇒ **本仓做不到**。
 *
 *   type 模式（「谁构造形如类型 T 的对象」，启发式）：
 *     - 从 file 里解析出 symbol 声明的成员字段集合
 *     - 在闭包/全项目里找对象字面量，其 pair 键与成员集交叠 ≥ 阈值 → 候选构造点
 *     - 标注「命中 N 个成员」，供 LLM 判断（非类型求解器，是候选）
 *
 * 只读，不改文件。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
// ★ v13（2026-10-20）：`identifiers` 是**位置**的唯一事实来源；同源判据与索引层同一把尺
import { findCacheDb } from '../../../infrastructure/index/db.js';
import { contentHash } from '../../../infrastructure/index/symbols.js';
import { parseAstRoot, type SyntaxNodeLike } from '../../../infrastructure/parse/kernel.js';
import { expandClosure, walkProjectFiles, loadAliasConfig } from '../../../infrastructure/analysis/project_root/index.js';

export type FieldRefKind = 'field-read' | 'field-key' | 'field-destructure' | 'field-decl';

export interface FieldRefPoint {
  /** 字节偏移（匹配 token 起点） */
  offset: number;
  /** 1-based 行号 */
  line: number;
  /** 该字段名（匹配文本） */
  text: string;
  kind: FieldRefKind;
  /** 行内容（去首尾空白），LLM 免开文件判断 */
  snippet: string;
  /**
   * ★ 仅 `field-decl` 点：**声明它的外层类型名**（`interface T { field }` / `type T = { field }` 的 T）。
   *  依据：AST 祖先链里最近的那个 `interface_declaration` / `type_alias_declaration` 的名字节点
   *  （`enclosingTypeName`；节点形状实测见 kernel 的 TS grammar：`interface_declaration → type_identifier`）。
   *  ★ 取不到的两种情形 ⇒ **省略**（不猜）：① 非声明点；② 声明点但外层只是**内联类型**
   *  （`const y: { field: string }` 的 `object_type` 挂在 `type_annotation` 下，没有名字）。
   */
  ownerType?: string;
  /**
   * ★ v13：这个引用点的**候选位置从哪来** —— `db` = `identifiers`（AST 写入）；
   *   `regex` = 正则兜底（`obj['x']` 方括号读 / 无可用索引 / 库与源码不同源）。
   *   ★ 分类（读/构/解/声明）仍由 AST 定：`identifiers` 按设计只记位置、不记语义（schema.ts:41-44）。
   */
  via: 'db' | 'regex';
}

/** ★ v13 回执：字段引用的位置出处 + 兜底占比 */
export interface FieldRefVia {
  db_points: number;
  regex_points: number;
  db_files: number;
  regex_files: number;
  regex_ratio: number;
}

export interface FieldRefFile {
  /** 相对项目根（POSIX） */
  file: string;
  refs: FieldRefPoint[];
}

/**
 * ★ `of_type` 限定的**账目**（T125）：限定不是"少给"，而是"能证伪才丢、其余如实保留"。
 * 这三个读数让"丢了多少、为什么"在产物里看得见（不许静默降级）。
 */
export interface FieldScopeReport {
  /** 调用方给的类型名（原样回显） */
  of_type: string;
  /** 是否定位到该类型的声明（false ⇒ 结果为空，**绝不**退回全仓扫 —— 那是"看起来正常"） */
  resolved: boolean;
  /** 该类型的**声明文件**（相对项目根，POSIX）—— 定位不到则空 */
  declared_in: string[];
  /** ★ 因 `ownerType` **已知且 ≠ of_type** 被丢弃的声明点条数（只丢"确证不属于"的） */
  dropped_decl_points: number;
  /** ★ 无法做类型判定、**如实保留**的条数（读/构/解 全部 + ownerType 未知的声明点） */
  unverified_points: number;
}

export interface TypeConstructCandidate {
  file: string;
  line: number;
  offset: number;
  /** 命中该类型成员的字段名（与成员集交集） */
  matched: string[];
  snippet: string;
}

function lineOf(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function lineText(src: string, offset: number): string {
  const lines = src.split('\n');
  const l = lineOf(src, offset);
  return (lines[l - 1] ?? '').trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 收集给定文件范围内匹配的 (kind, offset) —— 读取点用正则（.field / ['field']），键位交给 AST 分类 */
function captureReads(src: string, field: string): FieldRefPoint[] {
  const out: FieldRefPoint[] = [];
  const re = new RegExp(`(?:\\.|\\?\\.)\\b${escapeRegex(field)}\\b|\\[\\s*['"]${escapeRegex(field)}['"]\\s*]`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // offset 取到字段名本体（. 或 [' 之后）
    const text = m[0];
    const dotIdx = text.indexOf(field);
    const off = m.index + Math.max(0, dotIdx);
    out.push({ offset: off, line: 0, text: field, kind: 'field-read', snippet: '', via: 'regex' });
  }
  return out;
}

/**
 * ★ v13：**方括号读**的候选位置（`obj['field']` / `obj["field"]`）。
 *
 * 为什么这条**必须**留正则：`identifiers` 只记 `identifier / property_identifier /
 * type_identifier / shorthand*` —— 方括号里的字段名在 AST 里是 **string 节点**，
 * 按设计不进标识符表（不然 string 字面量会和其他字符串混为一谈）。
 * 所以它是**已知缺口**：数量很小（本仓实测 `feature` 6 处 / `summary` 2 处 / `file_path` 0 处），
 * 用一条**只匹配方括号读**的正则补齐，分类仍由 AST 定（`subscript_expression` ⇒ field-read）。
 */
function bracketReadOffsets(src: string, field: string): number[] {
  const re = new RegExp(`\\[\\s*['"]${escapeRegex(field)}['"]\\s*]`, 'g');
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const idx = m[0].indexOf(field);
    if (idx >= 0) out.push(m.index + idx);
  }
  return out;
}

/** `identifiers` 的一行（只要位置；语义由 AST 分类） */
interface IdentRow {
  name: string;
  kind: string;
  si: number;
  ei: number;
}

/** 打开项目 cache.db 只读；不存在/读不动 ⇒ null（整轮走正则兜底） */
function openIdentDb(root: string): DatabaseSync | null {
  const dbFile = findCacheDb({ sourceRoot: root });
  if (!dbFile) return null;
  try {
    return new DatabaseSync(dbFile, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * 取该文件里 `field` 的全部标识符位置 —— **四道准入**（照 `remove_dead_imports` 的先例）：
 *   ① 库里有行：该文件在 `identifiers` 里有行（无行 = 没索引过，不是“没引用”）；
 *   ② 字段齐全：每行都有整数 `start_index/end_index` 与非空 `name`；
 *   ③ 库与源码同源：`files.content_hash === contentHash(src)`；
 *   ④ 取出的值能对上：`src.slice(si, ei) === field`。
 * 任一不过 ⇒ null（调用方整文件退回旧正则路径）。
 * 返回 [] = **库确认该文件里没有这个名字**（合法结果，不是失败）。
 */
function identifiersFor(db: DatabaseSync, rel: string, src: string, field: string): IdentRow[] | null {
  const file = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: rel }) as
    | { content_hash: string }
    | undefined;
  if (!file || file.content_hash !== contentHash(src)) return null; // ③
  const cov = db.prepare('SELECT COUNT(*) n FROM v_identifiers WHERE file_path = $p').get({ p: rel }) as { n: number } | undefined;
  if (!cov || cov.n <= 0) return null; // ①
  const rows = db
    .prepare('SELECT name, kind, start_index si, end_index ei FROM v_identifiers WHERE file_path = $p AND name = $n')
    .all({ p: rel, n: field }) as Array<{ name: string; kind: string; si: number | null; ei: number | null }>;
  const out: IdentRow[] = [];
  for (const r of rows) {
    if (typeof r.name !== 'string' || !r.name) return null; // ②
    if (!Number.isInteger(r.si) || !Number.isInteger(r.ei)) return null; // ②
    if (r.si! < 0 || r.ei! > src.length || r.si! >= r.ei!) return null; // ②
    if (src.slice(r.si!, r.ei!) !== field) return null; // ④
    out.push({ name: r.name, kind: r.kind, si: r.si!, ei: r.ei! });
  }
  return out;
}

/** 分类结果：kind + （仅声明点）其外层类型名 */
interface ClassifiedFieldRef {
  kind: FieldRefKind;
  ownerType?: string;
  /** ★ v13：候选位置出处（缺省 = regex 兜底） */
  via?: 'db' | 'regex';
}

/** 对文件 src 的 AST：把每个字段名子串(含偏移)按 AST 归属分类 */
function classifyKeyOffsets(root: SyntaxNodeLike, src: string, field: string): Map<number, ClassifiedFieldRef> {
  const result = new Map<number, ClassifiedFieldRef>();
  const reWord = new RegExp(`\\b${escapeRegex(field)}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = reWord.exec(src))) {
    const off = m.index;
    const kind = classifyOffset(root, off, field);
    if (kind) result.set(off, kind);
  }
  return result;
}

/**
 * ★ 叶→根路径里最近的**外层类型声明**的名字（`interface T {...}` / `type T = {...}` 的 T）。
 * 依据（实测的 TS grammar 节点形状）：`interface_declaration → type_identifier`，
 * `type_alias_declaration → type_identifier`，名字节点带 `name` 字段；取不到就退化为扫子节点。
 * ★ 只在**声明点**上调用（读取/构造/解构点没有"所属类型"可解 —— 那要类型推断，本仓没有）。
 */
function enclosingTypeName(path: SyntaxNodeLike[]): string | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    const t = path[i].type;
    if (t !== 'interface_declaration' && t !== 'type_alias_declaration') continue;
    const nm = path[i].childForFieldName('name');
    if (nm) return nm.text;
    for (let j = 0; j < path[i].childCount; j++) {
      const c = path[i].child(j);
      if (c && (c.type === 'type_identifier' || c.type === 'identifier')) return c.text;
    }
    return undefined;
  }
  return undefined;
}

/** 定位 offset 所在最深节点并收集祖先链，返回归类；单次下降（可靠，不再用 findParent 引用相等上溯） */
function classifyOffset(root: SyntaxNodeLike, offset: number, _field: string): ClassifiedFieldRef | null {
  const path: SyntaxNodeLike[] = [];
  const collect = (n: SyntaxNodeLike): void => {
    if (n.startIndex !== undefined && n.endIndex !== undefined) {
      if (offset < n.startIndex || offset >= n.endIndex) return; // 不含该字节则剪枝
    }
    path.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) collect(c);
    }
  };
  collect(root);
  const deepestType = path[path.length - 1]?.type ?? '';
  // 注释里的同名（tree-sitter 会挂到外层对象字面量下）→ 直接跳过
  if (deepestType === 'comment') return null;
  // 字符串里的同名：只当它是 obj['field'] 方括号读才有意义（subscript_expression 之下）；否则是普通字符串，非引用
  if (STRING_LEAF_TYPES.has(deepestType)) {
    for (const n of path) if (n.type === 'subscript_expression') return { kind: 'field-read' };
    return null;
  }
  // 叶→根 顺序判类（先验叶端，读取优先于容器键）
  for (let i = path.length - 1; i >= 0; i--) {
    const t = path[i].type;
    if (t === 'object_pattern') return { kind: 'field-destructure' };
    if (t === 'object_type' || t === 'property_signature' || t === 'method_signature')
      return { kind: 'field-decl', ownerType: enclosingTypeName(path) };
    if (t === 'object' || t === 'pair') return { kind: 'field-key' };
    if (t === 'member_expression' || t === 'subscript_expression') return { kind: 'field-read' };
  }
  return null;
}

const STRING_LEAF_TYPES = new Set(['string', 'string_fragment', 'template_string', 'template_literal', 'string_literal']);

/**
 * ★ 定位类型 `of_type` 的**声明文件**（T125）：先文本预筛（与 `extractTypeMembers` 同族正则），
 * 再 AST 复核（挡掉注释/字符串里的同名，避免据此把作用域收错）。返回绝对路径。
 * ★ 为什么预筛而不是直接 AST 全扫：预筛是 O(读文件)（不解析）⇒ 绝大多数文件被一行正则挡掉；
 *   AST 只对**文本命中**的那几个文件跑（通常 1~2 个）。
 */
async function ofTypeDeclFiles(root: string, candidates: string[], ofType: string): Promise<string[]> {
  const re = new RegExp(`\\b(?:interface|type)\\s+${escapeRegex(ofType)}\\b`);
  const out: string[] = [];
  for (const abs of candidates) {
    let src: string;
    try {
      src = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    if (!re.test(src)) continue;
    const ast = await parseAstRoot(abs, src);
    if (ast && hasTypeDeclNamed(ast.root, ofType)) out.push(abs);
  }
  return out;
}

/** 子树里是否存在名为 `name` 的 `interface` / `type` 声明（AST 复核用） */
function hasTypeDeclNamed(root: SyntaxNodeLike, name: string): boolean {
  let found = false;
  const walk = (n: SyntaxNodeLike): void => {
    if (found) return;
    if (n.type === 'interface_declaration' || n.type === 'type_alias_declaration') {
      const nm = n.childForFieldName('name');
      if (nm && nm.text === name) {
        found = true;
        return;
      }
      for (let j = 0; j < n.childCount; j++) {
        const c = n.child(j);
        if (c && (c.type === 'type_identifier' || c.type === 'identifier') && c.text === name) {
          found = true;
          return;
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(root);
  return found;
}

/**
 * field 模式主入口：scope 内收集字段的结构引用点。
 *
 * ★ of_type（T125「备菜」）：**按所属类型限定**。语义两条，**都不许丢真引用**：
 *   ① **能证伪才丢**：`field-decl` 点若 `ownerType` **已知且 ≠ of_type** ⇒ 丢（那确定不是 T 的字段）；
 *      `ownerType` 未知（内联类型）⇒ **保留**（不能证伪）。
 *   ② **不能判定的一律保留**：读/构/解 无法解析接收者类型 ⇒ 全留；只是**作用域**收窄到
 *      T 声明文件的 import 闭包（与 `mode=symbol` 的 `file` 锚点**同源**：都是"主语住的那条链"）。
 *   ★ 定位不到 T 的声明 ⇒ **空结果 + resolved:false**（**不退回全仓** —— 那会让"没限定"看起来成功）。
 */
export async function collectFieldRefs(input: {
  project_dir: string;
  field: string;
  /** 定义文件（可选）：提供时默认按闭包扫描 */
  file?: string;
  /** closure（默认，给 file 时按 import 闭包）| all（全项目扫） */
  scope?: 'closure' | 'all';
  /** ★ 所属类型名：把字段引用限定到该类型（见上方 of_type 说明）。 */
  of_type?: string;
}): Promise<{ files: FieldRefFile[]; scope?: FieldScopeReport; field_via: FieldRefVia }> {
  const resolvedRoot = path.resolve(input.project_dir);
  const field = input.field;
  const ofType = input.of_type;
  const wantAll = input.scope === 'all';
  const fileAbs = input.file ? (path.isAbsolute(input.file) ? path.resolve(input.file) : path.resolve(resolvedRoot, input.file)) : undefined;

  const scopeFiles: string[] = [];
  if (!wantAll && fileAbs) {
    const closure = await expandClosure(fileAbs, resolvedRoot, loadAliasConfig(resolvedRoot));
    for (const f of closure) if (path.resolve(f).startsWith(resolvedRoot)) scopeFiles.push(f);
  }
  if (scopeFiles.length === 0) {
    const walked: string[] = [];
    walkProjectFiles(resolvedRoot, walked);
    scopeFiles.push(...walked);
  }

  // ★ of_type 且调用方**没给 file** ⇒ 由类型定位声明文件，再把作用域收窄到它的 import 闭包。
  //   （给了 file 就以 file 为准，of_type 只做"证伪才丢"的声明点过滤 —— 见下方主循环。）
  let declFilesAbs: string[] = [];
  let report: FieldScopeReport | undefined;
  if (ofType) {
    declFilesAbs = await ofTypeDeclFiles(resolvedRoot, scopeFiles, ofType);
    if (declFilesAbs.length > 0 && !wantAll && !fileAbs) {
      const union = new Set<string>();
      for (const d of declFilesAbs) {
        const clo = await expandClosure(d, resolvedRoot, loadAliasConfig(resolvedRoot));
        for (const f of clo) if (path.resolve(f).startsWith(resolvedRoot)) union.add(path.resolve(f));
      }
      scopeFiles.length = 0;
      scopeFiles.push(...union);
    }
    if (declFilesAbs.length === 0) {
      // ★ 不静默降级：查不到声明 ⇒ 空结果 + 明标（不退回全仓扫）。
      report = { of_type: ofType, resolved: false, declared_in: [], dropped_decl_points: 0, unverified_points: 0 };
      return {
        files: [],
        scope: report,
        field_via: { db_points: 0, regex_points: 0, db_files: 0, regex_files: 0, regex_ratio: 0 },
      };
    }
    report = {
      of_type: ofType,
      resolved: true,
      declared_in: declFilesAbs.map((a) => (path.relative(resolvedRoot, a) || path.basename(a)).replace(/\\/g, '/')).sort(),
      dropped_decl_points: 0,
      unverified_points: 0,
    };
  }

  const identDb = openIdentDb(resolvedRoot);
  let dbPoints = 0;
  let regexPoints = 0;
  const dbFiles = new Set<string>();
  const regexFiles = new Set<string>();

  const out: FieldRefFile[] = [];
  for (const abs of scopeFiles) {
    let src: string;
    try {
      src = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    const rel = (path.relative(resolvedRoot, abs) || path.basename(abs)).replace(/\\/g, '/');
    const ast = await parseAstRoot(abs, src);
    // ★ 分格：DB 优先（identifiers 给位置）；四道准入不过 ⇒ 整文件退回旧路径（正则枚举 + AST 分类）
    const idRows = ast && identDb ? identifiersFor(identDb, rel, src, field) : null;
    let byOff: Map<number, ClassifiedFieldRef>;
    if (ast) {
      if (idRows !== null) {
        byOff = new Map<number, ClassifiedFieldRef>();
        for (const r of idRows) {
          const cls = classifyOffset(ast.root, r.si, field);
          if (cls) byOff.set(r.si, { ...cls, via: 'db' });
        }
        // 已知缺口：方括号读（string 节点按设计不进 identifiers）——只这一条正则，分类仍走 AST
        for (const off of bracketReadOffsets(src, field)) {
          // ★ 只收 AST 确认过的（`subscript_expression` ⇒ read）；数组字面量 `['x']` / 注释 / 字符串
          //   会被 `classifyOffset` 判 null ⇒ **丢弃**（旧实现在这些位置也误报过；实测 6 处）。
          const cls = classifyOffset(ast.root, off, field);
          if (cls) byOff.set(off, { ...cls, via: 'regex' });
        }
      } else {
        // AST 全量分类（构造/解构/声明/读取，天然去重，且能跳过注释/字符串里的字面）
        byOff = classifyKeyOffsets(ast.root, src, field);
      }
    } else {
      // 无 AST（语言不支持/解析失败）：正则兜底——.field 读 + field: 构造（保守）
      byOff = new Map<number, ClassifiedFieldRef>();
      for (const r of captureReads(src, field)) byOff.set(r.offset, { kind: 'field-read', via: 'regex' });
      const reKey = new RegExp(`\\b${escapeRegex(field)}\\s*:`, 'g');
      let km: RegExpExecArray | null;
      while ((km = reKey.exec(src))) byOff.set(km.index, { kind: 'field-key', via: 'regex' });
    }
    const points: FieldRefPoint[] = [];
    for (const [off, cls] of byOff) {
      const kind = cls.kind;
      if (ofType) {
        const provablyOther = kind === 'field-decl' && cls.ownerType !== undefined && cls.ownerType !== ofType;
        if (provablyOther) {
          // ★ 只丢"确证不属于 of_type"的声明点（T125 判据：能证伪才丢）
          if (report) report.dropped_decl_points++;
          continue;
        }
        // 读/构/解 + ownerType 未知的声明点 ⇒ 无法判定 ⇒ 如实保留（计入"未确证"读数）
        if (!(kind === 'field-decl' && cls.ownerType === ofType)) if (report) report.unverified_points++;
      }
      const via: 'db' | 'regex' = cls.via ?? 'regex';
      if (via === 'db') dbPoints++;
      else regexPoints++;
      const p: FieldRefPoint = { offset: off, line: lineOf(src, off), text: field, kind, snippet: lineText(src, off), via };
      if (cls.ownerType) p.ownerType = cls.ownerType;
      points.push(p);
    }
    if (points.some((p) => p.via === 'db')) dbFiles.add(rel);
    if (points.some((p) => p.via === 'regex')) regexFiles.add(rel);
    if (points.length > 0) {
      points.sort((a, b) => a.offset - b.offset);
      out.push({ file: (path.relative(resolvedRoot, abs) || path.basename(abs)).replace(/\\/g, '/'), refs: points });
    }
  }
  out.sort((a, b) => a.file.localeCompare(b.file));
  try {
    identDb?.close();
  } catch {
    /* 已关闭 */
  }
  const totalPoints = dbPoints + regexPoints;
  return {
    files: out,
    scope: report,
    field_via: {
      db_points: dbPoints,
      regex_points: regexPoints,
      db_files: dbFiles.size,
      regex_files: regexFiles.size,
      regex_ratio: totalPoints > 0 ? Math.round((regexPoints / totalPoints) * 1000) / 1000 : 0,
    },
  };
}

/** type 模式：返回与类型成员集交叠 ≥ 阈值的对象字面量候选构造点 */
export async function collectTypeConstructCandidates(input: {
  project_dir: string;
  file: string;
  symbol: string;
  scope?: 'closure' | 'all';
  /** 交叠成员数阈值，默认 2 */
  min_hit?: number;
}): Promise<{ members: string[]; candidates: TypeConstructCandidate[] }> {
  const resolvedRoot = path.resolve(input.project_dir);
  const fileAbs = path.isAbsolute(input.file) ? path.resolve(input.file) : path.resolve(resolvedRoot, input.file);
  const minHit = input.min_hit ?? 2;
  const src = readFileSync(fileAbs, 'utf-8');
  const members = extractTypeMembers(fileAbs, src, input.symbol);
  if (members.length === 0) return { members, candidates: [] };

  const wantAll = input.scope === 'all';
  const scopeFiles: string[] = [];
  if (!wantAll) {
    const closure = await expandClosure(fileAbs, resolvedRoot, loadAliasConfig(resolvedRoot));
    for (const f of closure) if (path.resolve(f).startsWith(resolvedRoot)) scopeFiles.push(f);
  }
  if (scopeFiles.length === 0) {
    const walked: string[] = [];
    walkProjectFiles(resolvedRoot, walked);
    scopeFiles.push(...walked);
  }

  const candidates: TypeConstructCandidate[] = [];
  const memberSet = new Set(members);
  for (const abs of scopeFiles) {
    let fsrc: string;
    try {
      fsrc = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    const ast = await parseAstRoot(abs, fsrc);
    if (!ast) continue;
    const objs = findNodesByType(ast.root, new Set(['object']));
    for (const obj of objs) {
      const matched = objectLiteralKeys(obj).filter((k) => memberSet.has(k));
      if (matched.length >= minHit) {
        candidates.push({
          file: (path.relative(resolvedRoot, abs) || path.basename(abs)).replace(/\\/g, '/'),
          line: obj.startPosition.row + 1,
          offset: obj.startIndex ?? 0,
          matched: [...new Set(matched)],
          snippet: lineText(fsrc, obj.startIndex ?? 0),
        });
      }
    }
  }
  candidates.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { members, candidates };
}

/** 从类型声明里抽成员字段集（interface/type 的花括号属性键） */
function extractTypeMembers(fileAbs: string, src: string, symbol: string): string[] {
  // 定位 `symbol` 的声明段落，取其花括号块内所有标识符+可选 `?:`
  const symRe = new RegExp(`\\b(?:interface|type)\\s+${escapeRegex(symbol)}\\b[^\\n{]*\\{`);
  const m = symRe.exec(src);
  if (!m) return [];
  const open = src.indexOf('{', m.index);
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [];
  const body = src.slice(open, close);
  const members: string[] = [];
  const re = /([A-Za-z_$][\w$]*)\s*[?:]/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(body))) members.push(mm[1]);
  return [...new Set(members)];
}

/** 返回子树里所有 type ∈ set 的节点 */
function findNodesByType(node: SyntaxNodeLike, types: Set<string>): SyntaxNodeLike[] {
  const out: SyntaxNodeLike[] = [];
  const walk = (n: SyntaxNodeLike): void => {
    if (types.has(n.type)) out.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(node);
  return out;
}

/** 对象字面量成对键（pair 的属性键、shorthand 的键） */
function objectLiteralKeys(obj: SyntaxNodeLike): string[] {
  const keys: string[] = [];
  const walk = (n: SyntaxNodeLike): void => {
    const t = n.type;
    if (t === 'pair' && n.childCount >= 1) {
      const k = n.child(0)!;
      keys.push(k.text);
    } else if (t === 'shorthand_property_identifier_pattern' || t === 'shorthand_property_identifier') {
      keys.push(n.text);
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(obj);
  return keys;
}