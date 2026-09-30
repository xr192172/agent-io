/**
 * ast_rename —— 作用域感知的局部变量重命名（AST 重构引擎地基）
 *
 * 目标：把"改一个局部变量"降维成安全的列级文本替换。
 * 核心是**名字绑定解析**：遍历 TS/JS AST，按作用域（函数 / 块 / for / catch）
 * 把每个 `identifier` 解析归属到最近的同名声明，得到「声明点 + 全部引用点」。
 * 重命名时只替换目标绑定的这些字节偏移，绝不碰其他作用域的同名绑定。
 *
 * 安全边界（测试锁定）：
 *   - 只处理 identifier 节点；属性访问（obj.a 的 a 是 property_identifier）、
 *     类型名（type_identifier）、字符串、注释天然排除。
 *   - 无同名可解析的 identifier（外部/内置/全局）→ 不替换。
 *   - 块级遮蔽：内层声明遮蔽外层，各自独立绑定，互不误伤。
 *   - 宁漏不误：无法判定的形态（如解构逐名失败）不持有，而非乱改。
 *
 * ★ 本模块**只算不写**：它是「文件内局部作用域改名」的**分析/改写引擎**（纯函数面，吃得进
 *   源码字符串、吐得出新源码字符串），**不做任何文件 IO**。读文件 + 落盘（写前快照 / 索引写穿）
 *   统一在 `tools/rename_local.ts`（`scope='local'` 的 [B] 分支）里走 `applyWrites` 内核。
 *   这样切的意义：**同一份改写能力可以被不同入口复用，而"落盘"永远只有一条路** ——
 *   旧版本模块自带一个 `renameManyInFile`（自己 readFileSync + 自己写盘），
 *   与 `rename_symbol.ts` 的落盘形态各写各的，正是"收敛收敛不起来"的病根。
 */
import { getParser } from './loader.js';
import { findLanguageByExt, type LanguageEntry } from './languages.js';
import { parseContent } from './kernel.js';

/** 最小 tree-sitter 节点面（与 ts_slim 同源） */
interface NodeLike {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(i: number): NodeLike | null;
  childForFieldName(f: string): NodeLike | null;
}

export interface LocalBinding {
  id: number;
  name: string;
  kind: 'const' | 'let' | 'var' | 'param' | 'catch' | 'other';
  /** 所在作用域 id（function / block / for） */
  scopeId: number;
  /** 所在命名函数名（顶层非函数内为 ''，匿名函数给 anon@offset） */
  parentFunction: string;
  /** 声明处 identifier 的字节偏移 */
  declIndex: number;
  /** 赋值目标（含声明点）identifier 字节偏移，升序 */
  defs: number[];
  /** 引用 identifier 字节偏移（不含声明点），升序 */
  refs: number[];
}

export interface LocalScope {
  id: number;
  kind: 'function' | 'block';
  parentFunction: string;
  declared: string[];
}

// ─────────────────────────────────────────────
// 构建期内部模型
// ─────────────────────────────────────────────
interface ScopeNode {
  id: number;
  kind: 'function' | 'block';
  parentFunction: string;
  parent: ScopeNode | null;
  bindings: Map<string, B>;
}
interface B {
  id: number;
  name: string;
  kind: LocalBinding['kind'];
  scope: ScopeNode;
  declIndex: number;
  defs: Set<number>;
  refs: Set<number>;
}

/**
 * 一条声明语句单元（如 `const a = 1, b = foo();`）。
 * 多声明符共享一个语句区间：只要其中任一 declarator 活 / 含副作用，整句不删。
 */
interface DeclUnit {
  start: number;
  end: number;
  /** 整句初始值是否含函数调用 / new（副作用风险） */
  hasCall: boolean;
  scope: ScopeNode;
  members: B[];
}

/** 子树是否含副作用候选节点（调用 / new / 带副作用表达式） */
function subtreeHasCall(node: NodeLike): boolean {
  return scanCall(node, 0);
}
function scanCall(node: NodeLike, depth: number): boolean {
  if (depth > 300) return false;
  if (node.type === 'call_expression' || node.type === 'new_expression' || node.type === 'tagged_template' || node.type === 'await_expression') {
    return true;
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && scanCall(c, depth + 1)) return true;
  }
  return false;
}

let nextId = 1;

/** 每次 build 重置 id 计数器：同一源码两次解析（分析 + 重命名）id 逐位一致 */
function resetIds(): void {
  nextId = 1;
}

/** identifier → 归属绑定：沿父链向上，命中最近同名声明即返回 */
function resolveTo(state: { name: string; scope: ScopeNode }): B | null {
  let scope: ScopeNode | null = state.scope;
  while (scope) {
    const b = scope.bindings.get(state.name);
    if (b) return b;
    scope = scope.parent;
  }
  return null;
}

interface Decl {
  name: string;
  kind: LocalBinding['kind'];
  declIndex: number;
}

/** 深度遍历节点内所有 identifier 子节点（不跨作用域边界，边界由调用方控制） */
function forEachIdentifier(node: NodeLike, cb: (id: NodeLike) => void): void {
  walkIds(node, cb, 0);
}
function walkIds(node: NodeLike, cb: (id: NodeLike) => void, depth: number): void {
  if (depth > 200) return;
  if (node.type === 'identifier' || node.type === 'shorthand_property_identifier_pattern') {
    cb(node);
    return;
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) walkIds(c, cb, depth + 1);
  }
}

/** 收集声明节点的声明符名字（支持单标识符与解构） */
function collectDeclaratorDecls(node: NodeLike): Decl[] {
  const kind: Decl['kind'] = isVarNode(node) ? 'var' : node.text.trimStart().startsWith('const') ? 'const' : 'let';
  const decls: Decl[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c || c.type !== 'variable_declarator') continue;
    const nameNode = c.childForFieldName('name');
    if (!nameNode) continue;
    if (nameNode.type === 'identifier') {
      decls.push({ name: nameNode.text, kind, declIndex: nameNode.startIndex });
    } else if (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') {
      forEachIdentifier(nameNode, (id) => decls.push({ name: id.text, kind, declIndex: id.startIndex }));
    }
  }
  return decls;
}
function isVarNode(node: NodeLike): boolean {
  return node.type === 'variable_declaration' || node.text.trimStart().startsWith('var ');
}

const FN_SCOPE_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
  'generator_function',
]);
const PARAM_TYPES = new Set(['formal_parameters', 'parameters']);
const FOR_TYPES = new Set(['for_statement', 'for_in_statement', 'for_of_statement']);

/** 函数自身的名字（method_definition / declaration 取 name 字段；匿名给 anon@offset） */
function ownFnName(fallback: string, fnNode: NodeLike): string {
  const n = fnNode.childForFieldName('name');
  if (n && n.type === 'identifier') return n.text;
  if (n) return n.text; // method_definition 的 name 是 property_identifier
  return fallback || `anon@${fnNode.startIndex}`;
}

/**
 * 一次性遍历 AST：建作用域树 + 收集绑定的声明点/引用点。
 * 返回收集到的所有绑定 B（每条恰一次）与作用域列表。
 */
async function build(
  src: string,
  filePath: string,
): Promise<{ bindings: B[]; scopes: LocalScope[]; units: DeclUnit[] } | null> {
  const ext = '.' + (filePath.split('.').pop() || '');
  const lang = findLanguageByExt(ext);
  if (!lang) return null;
  const parser = (await getParser(ext, lang)) as unknown;
  if (!parser) return null;

  let root: NodeLike;
  try {
    const tree = parseContent(parser as Parameters<typeof parseContent>[0], src) as unknown as { rootNode: NodeLike };
    root = tree.rootNode;
  } catch {
    return null;
  }

  const scopes: LocalScope[] = [];
  // 模块根作用域（函数级容器）
  resetIds();
  const rootScope: ScopeNode = { id: nextId++, kind: 'function', parentFunction: '', parent: null, bindings: new Map() };
  scopes.push({ id: rootScope.id, kind: 'function', parentFunction: '', declared: [] });

  const bindings: B[] = [];
  const units: DeclUnit[] = [];
  const pull = (b: B): void => {
    bindings.push(b);
  };
  const mkScope = (parent: ScopeNode, kind: ScopeNode['kind'], parentFunction: string): ScopeNode => {
    const s: ScopeNode = { id: nextId++, kind, parentFunction, parent, bindings: new Map() };
    scopes.push({ id: s.id, kind, parentFunction, declared: [] });
    return s;
  };
  const declare = (scope: ScopeNode, d: Decl, parentFunction: string, pull: (b: B) => void): B => {
    const existing = scope.bindings.get(d.name);
    if (existing) {
      existing.defs.add(d.declIndex);
      return existing;
    }
    const b: B = { id: nextId++, name: d.name, kind: d.kind, scope, declIndex: d.declIndex, defs: new Set([d.declIndex]), refs: new Set() };
    scope.bindings.set(d.name, b);
    scopes.find((s) => s.id === scope.id)!.declared.push(d.name);
    pull(b);
    return b;
  };

  /** 声明节点内部：只递归「值/条件」里的引用，跳过 declarator 的 name（def 不当 ref） */
  function trValue(node: NodeLike, scope: ScopeNode, parentFunction: string, depth: number): void {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      if (c.type === 'variable_declarator') {
        const val = c.childForFieldName('value');
        if (val) tr(val, scope, parentFunction, depth + 1);
        continue;
      }
      tr(c, scope, parentFunction, depth + 1);
    }
  }

  function tr(node: NodeLike, scope: ScopeNode, parentFunction: string, depth: number): void {
    if (depth > 400) return;

    // 作用域入口节点
    if (FN_SCOPE_TYPES.has(node.type)) {
      const ownName = ownFnName(parentFunction, node);
      const fnScope = mkScope(scope, 'function', ownName);
      scanFn(node, fnScope, ownName);
      return;
    }
    if (node.type === 'statement_block') {
      const block = mkScope(scope, 'block', parentFunction);
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c) tr(c, block, parentFunction, depth + 1);
      }
      return;
    }
    if (PARAM_TYPES.has(node.type)) {
      //（站在函数 body 外的参数节点：归属当前 scope）
      forEachIdentifier(node, (id) => {
        const b = declare(scope, { name: id.text, kind: 'param', declIndex: id.startIndex }, parentFunction, pull);
        b.defs.add(id.startIndex);
      });
      trValue(node, scope, parentFunction, depth);
      return;
    }
    if (node.type === 'catch_clause') {
      const cp = node.childForFieldName('parameter');
      if (cp) {
        forEachIdentifier(cp, (id) => {
          const b = declare(scope, { name: id.text, kind: 'catch', declIndex: id.startIndex }, parentFunction, pull);
          b.defs.add(id.startIndex);
        });
      }
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type !== 'parameter') tr(c, scope, parentFunction, depth + 1);
      }
      return;
    }
    if (FOR_TYPES.has(node.type)) {
      const fscope = mkScope(scope, 'block', parentFunction);
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c) continue;
        if (c.type === 'lexical_declaration' || c.type === 'variable_declaration') {
          for (const d of collectDeclaratorDecls(c)) {
            declare(fscope, d, parentFunction, pull);
          }
          continue;
        }
        tr(c, fscope, parentFunction, depth + 1);
      }
      return;
    }

    // 声明节点
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      const unit: DeclUnit = {
        start: node.startIndex,
        end: node.endIndex,
        hasCall: subtreeHasCall(node),
        scope,
        members: [],
      };
      for (const d of collectDeclaratorDecls(node)) {
        const b = declare(scope, d, parentFunction, pull);
        unit.members.push(b);
      }
      units.push(unit);
      trValue(node, scope, parentFunction, depth);
      return;
    }

    // identifier 引用解析
    if (node.type === 'identifier' || node.type === 'shorthand_property_identifier_pattern' || node.type === 'shorthand_property_identifier') {
      const resolved = resolveTo({ name: node.text, scope });
      if (resolved) resolved.refs.add(node.startIndex);
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) tr(c, scope, parentFunction, depth + 1);
    }
  }

  function scanFn(fnNode: NodeLike, fnScope: ScopeNode, ownName: string): void {
    for (let i = 0; i < fnNode.childCount; i++) {
      const c = fnNode.child(i);
      if (c && PARAM_TYPES.has(c.type)) {
        forEachIdentifier(c, (id) => {
          const b = declare(fnScope, { name: id.text, kind: 'param', declIndex: id.startIndex }, ownName, pull);
          b.defs.add(id.startIndex);
        });
        trValue(c, fnScope, ownName, 0);
      }
    }
    const body = fnNode.childForFieldName('body') || fnNode.childForFieldName('suite');
    if (body) tr(body, fnScope, ownName, 0);
  }

  tr(root, rootScope, '', 0);
  return { bindings, scopes, units };
}

/** 绑定 → 公共输出形态 */
function toPublic(b: B): LocalBinding {
  const defs = [...b.defs].sort((x, y) => x - y);
  const defSet = b.defs;
  const refs = [...b.refs].filter((r) => !defSet.has(r)).sort((x, y) => x - y);
  return {
    id: b.id,
    name: b.name,
    kind: b.kind,
    scopeId: b.scope.id,
    parentFunction: b.scope.parentFunction,
    declIndex: b.declIndex,
    defs,
    refs,
  };
}

interface BuiltRaw {
  bindings: B[];
  scopes: LocalScope[];
  units: DeclUnit[];
}
async function buildRaw(src: string, filePath: string): Promise<BuiltRaw> {
  const r = await build(src, filePath);
  if (!r) return { bindings: [], scopes: [], units: [] };
  return r;
}

async function built(src: string, filePath: string): Promise<{ bindings: LocalBinding[]; scopes: LocalScope[] }> {
  const r = await buildRaw(src, filePath);
  return { bindings: r.bindings.map(toPublic), scopes: r.scopes };
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────

/** 分析源码：提取局部绑定（含作用域归属与引用偏移）。filePath 用于选语言（.ts/.js）。 */
export async function analyzeLocals(src: string, filePath = 'file.ts'): Promise<LocalBinding[]> {
  return (await built(src, filePath)).bindings;
}

/** 作用域清单（审计/展示用） */
export async function analyzeScopes(src: string, filePath = 'file.ts'): Promise<LocalScope[]> {
  return (await built(src, filePath)).scopes;
}

/** 字节偏移 → **1-based** 行号（报告与寻址都用它；`declIndex` 是偏移，人读的是行号）。 */
export function lineNumberOf(src: string, index: number): number {
  const end = Math.max(0, Math.min(index, src.length));
  let line = 1;
  for (let i = 0; i < end; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** 同名绑定在**别的**作用域里出现时，用来让人（或 LLM）挑出目标的那点信息 */
export interface LocalAddressCandidate {
  id: number;
  name: string;
  kind: LocalBinding['kind'];
  /** 声明所在行（1-based） */
  line: number;
  parentFunction: string;
}

export type LocalAddressResolution =
  | { ok: true; binding: LocalBinding; line: number }
  | { ok: false; why: string; candidates: LocalAddressCandidate[] };

/**
 * 按「**符号名 +（可选）声明行**」在绑定表里寻址 → 目标绑定。
 *
 * ★ 为什么寻址键是「名字 + 声明行」，而不是 `LocalBinding.id`：
 *   1. **id 是不可外部复算的遍历序号**（`resetIds()` 每次 build 从 1 重排）。源码一变，
 *      老 id 会**静默指到另一个绑定**上 —— 那等于"改错变量"，是本引擎最不能出的错。
 *      名字 + 行号是**对着当前源码验**的：对不上就拒（下面的 why），绝不会错改。
 *   2. **id 对 agent 不可得**：给 id 的那两个只读工具（命名建议 / 相似名消歧）只覆盖
 *      "短名"与"易混淆孪生名"两类局部变量；其余局部变量**没有任何入口能拿到 id** ⇒ 工具对它们不可用。
 *      名字 + 行号是 agent 读一眼文件就能给出的东西。
 *   3. **歧义不猜**：同文件里同名绑定（不同函数/块级遮蔽）多于一个、而调用方没给 `declLine`
 *      （或给了仍不唯一）⇒ 返回 `ok:false` 并列出全部候选（id/行/函数），让调用方补精确的一刀。
 *      "宁漏不误"是本引擎的地基（见文件头"安全边界"）。
 */
export function resolveLocalAddress(
  bindings: readonly LocalBinding[],
  src: string,
  addr: { symbol: string; declLine?: number },
): LocalAddressResolution {
  const named = bindings.filter((b) => b.name === addr.symbol);
  const describe = (b: LocalBinding): LocalAddressCandidate => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    line: lineNumberOf(src, b.declIndex),
    parentFunction: b.parentFunction,
  });
  if (named.length === 0) {
    return {
      ok: false,
      why:
        `该文件里没有名为 "${addr.symbol}" 的局部绑定` +
        '（局部绑定 = 函数/块内的 const/let/var + 形参 + catch 参数；模块顶层声明属 scope=module）',
      candidates: [],
    };
  }
  if (named.length === 1) {
    const b = named[0];
    const line = lineNumberOf(src, b.declIndex);
    if (addr.declLine !== undefined && addr.declLine !== line) {
      return {
        ok: false,
        why: `"${addr.symbol}" 唯一绑定的声明在第 ${line} 行，与声明的 decl_line=${addr.declLine} 不符`,
        candidates: [describe(b)],
      };
    }
    return { ok: true, binding: b, line };
  }
  const pool = addr.declLine === undefined ? named : named.filter((b) => lineNumberOf(src, b.declIndex) === addr.declLine);
  if (pool.length === 1) {
    const b = pool[0];
    return { ok: true, binding: b, line: lineNumberOf(src, b.declIndex) };
  }
  // ★ 候选清单必须**写进 why**（不只是放进结构化 candidates）：[C] 渲染的是 why —— 只说"有 2 个绑定、
  //   请用 decl_line"却不给行号，调用方补不上这一刀（工具就白拒了）。这是可用性问题，不是文案问题。
  const shown = (bs: readonly LocalBinding[]): string =>
    bs.map((b) => `第 ${lineNumberOf(src, b.declIndex)} 行${b.parentFunction ? `（函数 ${b.parentFunction}）` : ''}`).join('、');
  return {
    ok: false,
    why:
      `"${addr.symbol}" 在该文件里有 ${named.length} 个绑定` +
      (addr.declLine === undefined
        ? `（不同函数 / 块级遮蔽各算一个）⇒ 请用 decl_line 指定声明行。候选：${shown(named)}`
        : `，其中声明行 = ${addr.declLine} 的有 ${pool.length} 个 ⇒ 无法唯一定位。候选：${shown(pool)}`),
    candidates: named.map(describe),
  };
}

/**
 * 列级安全重命名：把目标绑定（声明 + 全部引用）换成 to。
 * 只改动该作用域内的字节偏移，绝不波及其他同名绑定。
 */
export async function renameLocal(
  src: string,
  targetId: number,
  to: string,
  filePath = 'file.ts',
): Promise<{ out: string; changed: number }> {
  const { bindings } = await built(src, filePath);
  const target = bindings.find((b) => b.id === targetId);
  if (!target) return { out: src, changed: 0 };
  if (target.name === to) return { out: src, changed: 0 };

  const edits = new Set<number>([target.declIndex, ...target.defs, ...target.refs]);
  const positions = [...edits].filter((p) => p >= 0 && p <= src.length).sort((x, y) => x - y);

  let out = '';
  let last = 0;
  let changed = 0;
  for (const p of positions) {
    if (p < last) continue;
    out += src.slice(last, p);
    out += to;
    last = p + target.name.length;
    changed++;
  }
  out += src.slice(last);
  return { out, changed };
}

export interface RenameItem {
  id: number;
  to: string;
}

export interface RenameApplied {
  id: number;
  from: string;
  to: string;
  /** 实际替换的字节位置数（声明+引用）；0 = 未改（原名相同 / 冲突 / 非法名 / 目标不存在） */
  changed: number;
  /**
   * `changed === 0` 时的**具体**理由（原名相同 / 非法新名 / 同作用域撞名 / 目标 id 不存在）。
   * ★ 为什么必须有：只报 `changed:0` 等于"少做了一件事而不说话"（§2d）—— 调用方（与 LLM）
   *   无法区分"这个名字本来就对"和"它撞了名所以没改"，只能重跑一遍分析去猜。
   */
  why?: string;
}

/**
 * 批量重命名：一次解析源码，合并多个目标绑定的编辑偏移，按位置逆序统一生成。
 * 绝不串行逐个调用 renameLocal（那样后续目标的偏移会因前次改写而错位）。
 *
 * 保守边界（与 renameLocal 同理，宁漏不误）：
 *   - 每个目标替换其【声明点 + 全部赋值目标 + 全部引用点】的字节偏移。
 *   - 冲突检测：目标新名已在【同一作用域】作为另一绑定存在 → 跳过该项（避免遮蔽篡改）。
 *   - to 非法（非标识符）或目标 id 不存在 → 跳过该项，不报错。
 */
export async function renameMany(
  src: string,
  items: RenameItem[],
  filePath = 'file.ts',
): Promise<{ out: string; applied: RenameApplied[] }> {
  const bindings = await analyzeLocals(src, filePath);
  const byId = new Map(bindings.map((b) => [b.id, b]));

  const edits: Array<{ pos: number; len: number; text: string }> = [];
  const applied: RenameApplied[] = [];

  for (const item of items) {
    const b = byId.get(item.id);
    if (!b) {
      applied.push({ id: item.id, from: '', to: item.to, changed: 0, why: '目标绑定不存在（id 与当前源码的绑定表对不上）' });
      continue;
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(item.to)) {
      applied.push({ id: item.id, from: b.name, to: item.to, changed: 0, why: `新名非法（必须是标识符）：${JSON.stringify(item.to)}` });
      continue;
    }
    if (b.name === item.to) {
      applied.push({ id: item.id, from: b.name, to: item.to, changed: 0, why: '新名与原名相同' });
      continue;
    }
    // 同作用域冲突：目标名已是另一绑定 → 跳过
    const clash = bindings.some((o) => o.scopeId === b.scopeId && o.name === item.to && o.id !== b.id);
    if (clash) {
      applied.push({ id: item.id, from: b.name, to: item.to, changed: 0, why: `同作用域已有同名绑定 "${item.to}"（作用域 #${b.scopeId}）` });
      continue;
    }
    const positions = new Set<number>([b.declIndex, ...b.defs, ...b.refs]);
    let changed = 0;
    for (const p of positions) {
      if (p < 0 || p > src.length) continue;
      edits.push({ pos: p, len: b.name.length, text: item.to });
      changed++;
    }
    applied.push({ id: item.id, from: b.name, to: item.to, changed });
  }

  if (edits.length === 0) return { out: src, applied };

  // 逆序应用，避免改动偏移互相影响
  edits.sort((a, b) => b.pos - a.pos);
  let out = src;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos + e.len);
  return { out, applied };
}

/**
 * 死局部变量删除：删掉块作用域内「声明了但从未被引用」的 const/let/var 整条语句。
 *
 * 保守判定（宁漏不误）：
 *   - 只处理块作用域（函数体 / if / for 块）内的声明；模块顶层与参数不碰。
 *   - 判定死：该声明语句的所有 declarator 绑定 refs 均为空。
 *   - 副作用保护：整句含函数调用 / new → 不删，避免丢弃副作用。
 *   - 同一语句多声明（`const a=1, b=2`）：只要有一个活 → 整句保留。
 */
export async function deleteDeadLocals(
  src: string,
  filePath = 'file.ts',
): Promise<{ out: string; deleted: Array<{ name: string; start: number; end: number }> }> {
  const r = await buildRaw(src, filePath);

  // 收集可删语句区间
  const intervals: Array<{ start: number; end: number }> = [];
  for (const u of r.units) {
    if (u.hasCall) continue; // 副作用保护
    if (u.scope.kind !== 'block') continue; // 只删块作用域内（跳过模块顶层 / 参数）
    if (u.members.length === 0) continue;
    const allDead = u.members.every((b) => b.refs.size === 0);
    if (allDead) intervals.push({ start: u.start, end: u.end });
  }
  if (intervals.length === 0) return { out: src, deleted: [] };

  // 升序、去重叠、吞前导缩进与尾随换行
  intervals.sort((a, b) => a.start - b.start);
  const deleted: Array<{ name: string; start: number; end: number }> = [];
  let out = '';
  let last = 0;
  for (const iv of intervals) {
    if (iv.start < last) continue; // 已被覆盖
    // 吞前导缩进（回退到本行首个非空白前）
    let s = iv.start;
    while (s > 0 && (src.charCodeAt(s - 1) === 0x20 || src.charCodeAt(s - 1) === 0x09)) s--;
    // 吞尾随单个换行（删整行，避免残留空行）
    let e = iv.end;
    if (src[e] === '\n') e++;
    else if (src[e] === '\r' && src[e + 1] === '\n') e += 2;
    out += src.slice(last, s);
    const u = r.units.find((x) => x.start === iv.start);
    deleted.push({ name: u ? u.members.map((m) => m.name).join(',') : '', start: s, end: e });
    last = e;
  }
  out += src.slice(last);
  return { out, deleted };
}