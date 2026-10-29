/**
 * ★★★ 2026-10-29（T-#PIVOT-LIFTPROJ）：**函数体也走轴心** —— `lift_go` + `project_ts` 的第一条竖切。
 *
 * ## 为什么（这是轴心的最后一块）
 * 现在 `body_mech` 是 **Go→TS 直连**：它一边读 Go AST，一边直接吐 TS 文本。
 * 加第三种语言就要再写一遍"Go→Rust" ⇒ 回到 N²。轴心要求：**中间必须有一个中立表示**。
 * ```
 * body_mech（今天）:  Go AST ──────────────→ TS 文本
 * 轴心（目标）    :  Go AST ──lift──→ 体 IR ──project──→ TS 文本（或 Rust 文本）
 * ```
 *
 * ## 本文件的边界（诚实，逐条可查）
 * · 只覆盖**第一批构造**：`block` / `return` / `expression_statement` /
 *   表达式 `ident` `int` `string` `selector` `call` `binary`；
 * · **遇到任何未覆盖的节点 ⇒ `lift` 返回 `null`**（上层回落 legacy 直连路径），
 *   **绝不半翻**——半翻出来的东西既不是 Go 也不是 TS；
 * · 输出必须与 legacy **逐 token 相同**（`t447` 判据），否则说明这次拆分改变了语义。
 *
 * ## IR 为什么长这样
 * IR 里**只有语义，没有语法**：没有分号、没有缩进、没有 `let/const` 的选择（那是 `project_ts` 的事），
 * 也没有 Go 的 `:=`（IR 只说"声明并赋值"）。这样 Rust 渲染器可以自己决定用 `let mut`。
 */
import type { SyntaxNodeLike } from '../../parse/index.js';

/** 体 IR：语句 */
export type IrStmt =
  | { k: 'return'; values: IrExpr[] }
  | { k: 'expr'; value: IrExpr }
  | { k: 'declare'; name: string; value: IrExpr | null; mutable: boolean }
  | { k: 'assign'; target: IrExpr; op: string; value: IrExpr }
  | { k: 'block'; body: IrStmt[] }
  /** 条件分支。`else` 可以是块，也可以是**嵌套的 if**（Go 的 `else if`） */
  /**
   * 条件分支。★ `init` = Go `if err := f(); err != nil {}` 里的**初始化语句**。
   * 丢掉它 ⇒ `TS2304 Cannot find name 'err'`（实测 **两条路径都丢**：pivot 与 legacy 各一份）。
   */
  | { k: 'if'; init?: IrStmt; cond: IrExpr; then: IrStmt[]; else?: IrStmt[] | IrStmt }
  /** 三式 / 无条件循环 */
  | { k: 'for'; init?: IrStmt; cond?: IrExpr; post?: IrStmt; body: IrStmt[] }
  /** 条件循环（Go 的 `for cond {}`） */
  | { k: 'while'; cond: IrExpr; body: IrStmt[] }
  /** 遍历（Go 的 `for k, v := range x`）——**轴心只说"遍历"，TS 用 for-of/下标，Rust 用 iter()** */
  | { k: 'range'; index: string | null; value: string | null; target: IrExpr; body: IrStmt[] }
  | { k: 'incdec'; target: IrExpr; op: '++' | '--' }
  /**
   * `defer f()`：语义是"**函数返回时**执行，后进先出"。
   * ★ 轴心只在**函数体直接子层**接受它（嵌套 defer 的执行时机不同：每次迭代 vs 函数退出），
   *   嵌套的一律 lift→null（回落 legacy，legacy 同样不翻）。
   */
  | { k: 'defer'; call: IrExpr }
  /**
   * `continue` / `break`：轴心只记"继续/跳出"，不记层数（Go 无标签时也是一层）。
   * `[未核]` 带标签的 `break L` / `continue L` 未支持（会因 labeled_statement 失败）。
   */
  | { k: 'jump'; op: 'continue' | 'break' }
  /**
   * `switch`。`labels === null` 表示 default 分支。
   * ★ `[未核]` Go 的 **fallthrough** 未建模（legacy 也不支持：每个 case 一律补 `break;`），
   *   带 fallthrough 的 case 会**语义不同**——这类体应显式判"不翻"，见 lift 里的检查。
   */
  | { k: 'switch'; disc: IrExpr; cases: Array<{ labels: IrExpr[] | null; body: IrStmt[] }> };

/** 体 IR：表达式 */
export type IrExpr =
  | { k: 'ident'; name: string }
  | { k: 'int'; value: string }
  | { k: 'str'; raw: string }
  | { k: 'sel'; x: IrExpr; member: string }
  /**
   * 普通函数调用。★ `spreadLast`：Go 的 `f(a, xs...)` —— **最后一个实参要展开**。
   * 轴心只记"这里要展开这个实参"（语义），TS 渲染成 `...xs`、Python 渲染成 `*xs`。
   * （这是证 t454 抓到的分叉：pivot 漏了展开 ⇒ `Sprintf(format, args)` 而 legacy 是 `...args`。）
   */
  | { k: 'call'; fn: IrExpr; args: IrExpr[]; spreadLast?: boolean }
  | { k: 'bin'; op: string; l: IrExpr; r: IrExpr }
  /**
   * ★★★ **内建槽**：`len` / `cap` / `append` 这类**语言无关语义**（"长度"/"追加"）。
   * 它们不是普通函数调用：每个目标语言都有自己的写法（TS 是 `.length` / 展开运算符，
   * Rust 是 `.len()` / `push`）⇒ 必须由轴心建模，**不能留在 Go 适配器里硬编码成 TS 语法**。
   * （这条是证 t447 逼出来的：第一版把它们当普通 call ⇒ 输出 `len(x)`，与 legacy 的 `x.length` 不一致。）
   */
  | { k: 'builtin'; name: string; args: IrExpr[] }
  | { k: 'index'; x: IrExpr; idx: IrExpr }
  | { k: 'paren'; x: IrExpr }
  /** 一元运算；`&x`/`*x`（Go 指针）在轴心里**不带运算符**——JS 引用语义下就是值本身 */
  | { k: 'unary'; op: string; x: IrExpr }
  | { k: 'bool'; value: boolean }
  /** Go `nil` ⇒ 轴心的"空值"槽（TS 渲染器落 `null`，与 legacy 一致） */
  | { k: 'nil' }
  | { k: 'slice'; x: IrExpr; lo: IrExpr | null; hi: IrExpr | null }
  /**
   * 复合字面量（Go 的 `[]T{…}` / `map[K]V{…}` / `T{…}`）。
   * 轴心只区分**三种容器语义**；具体语法（数组/Map/对象）归渲染器。
   */
  | {
      k: 'composite';
      kind: 'slice' | 'map' | 'struct';
      elems: Array<{ key?: IrExpr; value: IrExpr }>;
      /**
       * ★ 2026-10-29（T-#RT-COMPOSITE）：**真类型**（如 `[]SkillToolDef`）。
       * 回译（IR→Go）必须用它复原；用占位（`[]int`）会让回环 lift 失败
       * —— 实测 236 个体里 43 个不等构，多数根因在这。
       * `[未核]` 这是**源语言拼写**；完全中立应存 `TypeRef`，
       * 但 `body_pivot` 不能 import `go_extractor`（会成环）⇒ 先用文本，后续搬到名词层解析。
       */
      typeText?: string;
    };

/** 列举本竖切支持的节点类型（未列出的一律 lift→null） */
export const OK_STMT = new Set(['block', 'return_statement', 'expression_statement', 'short_var_declaration', 'assignment_statement', 'if_statement', 'for_statement', 'inc_dec_statement', 'var_declaration', 'defer_statement', 'expression_switch_statement', 'continue_statement', 'break_statement']);
export /**
 * ★★★ 2026-10-29（**"return null 必须带原因"**）：lift 的失败点记录。
 * 之前 lift 一律 `return null`，外部只知道"翻不动"，**不知道卡在哪个构造** ⇒
 * 只能靠"猜 + 试"决定下一步铺什么（本仓反复吃过的亏）。这里把**第一个失败点**记下来：
 * 节点类型 + 一句为什么 + 该节点的文本片段（便于人工核对）。
 */
let LIFT_FAIL: { type: string; why: string; snippet: string } | null = null;

/** 记录失败点并返回 null（唯一入口，保证不会漏记） */
export function failLift(n: { type: string; text?: string } | null, why: string): null {
  if (!LIFT_FAIL) {
    LIFT_FAIL = { type: n?.type ?? '(null-node)', why, snippet: String(n?.text ?? '').slice(0, 60) };
  }
  return null;
}

/** 读最近一次 lift 失败点（诊断用；`liftGoBody` 每次开始会清空） */
export function lastLiftFail(): { type: string; why: string; snippet: string } | null {
  return LIFT_FAIL;
}

/**
 * ★★★ 2026-10-29（T-#SHIM-APPLY）：**让渲染器在"Go 会复制"的位置插入 `copy()`**。
 *
 * ## 为什么需要注入
 * Go 的 struct 是**值语义**（赋值都复制），TS 对象是引用别名。`t445` 测出这条失真
 * **100% 覆盖**每个翻译单元。用 `_slots/value.ts#copy` 顶掉它，但"哪里该复制"必须靠
 * **类型信息**判断 —— 那正是 pivot 提供的 `TypeRef`。
 *
 * ## 边界（如实，别当它已完美）
 * · 只处理**已识别**位置：`x := y` / `var x = y` 且 y 是**值类型 struct**；
 * · 函数**入参**（Go 传值）与**返回值**暂未插入 ⇒ `applied` 只能 `'partial'`，
 *   失真账**不得**整条变绿（今天反复栽过假绿）；
 * · `[未核]` Go 是**逐字段浅拷贝**、这里是**整体深拷贝** ⇒ 在"本该共享子对象"处会改行为。
 */
let VALUE_STRUCTS = new Set<string>();
/** 名字 → Go 类型文本（每次翻译时由 body_mech 从它自己的类型环境注入） */
let RESOLVE_TYPE: ((name: string) => string | null) | null = null;

export function setValueStructTypes(types: Iterable<string>): void {
  VALUE_STRUCTS = new Set(types);
}
/**
 * ★★★ 2026-10-29：**本模块自己声明的类型名**（供 `as T` 判定）。
 * 教训：一开始无条件给结构体复合字面量加 `as <typeText>`（546→533 有效），
 * 但 `typeText` 可能是**别的文件里的类型**（没 import ⇒ TS2304）或**根本不是类型**
 * （Go 常量 `contractGatePolicy`）。⇒ 只在**本文件声明过**时才加断言。
 */
let LOCAL_TYPE_NAMES: ReadonlySet<string> = new Set<string>();
export function setLocalTypeNames(names: ReadonlySet<string>): void {
  LOCAL_TYPE_NAMES = names;
}

export function setTypeResolver(fn: ((name: string) => string | null) | null): void {
  RESOLVE_TYPE = fn;
}

let SHIM_INSERTS = 0;
export function noteShimInsert(n: number): void {
  SHIM_INSERTS += n;
}
export function shimInsertCount(): number {
  return SHIM_INSERTS;
}
export function resetShimInsertCount(): void {
  SHIM_INSERTS = 0;
}
export function isValueStructType(goType: string | null): boolean {
  if (!goType) return false;
  return VALUE_STRUCTS.has(goType.replace(/^\*+/, ''));
}
/** 这个名字当前是否是**值类型 struct**（决定是否插 copy） */
function isValueStructIdent(name: string): boolean {
  if (!RESOLVE_TYPE) return false;
  const t = RESOLVE_TYPE(name);
  if (!t) return false;
  return VALUE_STRUCTS.has(t.replace(/^\*+/, ''));
}

const OK_EXPR = new Set([
  // ★ `f(x...)` 的 `x...` 是 variadic_argument 包装，解包即可（TS 侧同一个值）
  'variadic_argument',
  'identifier',
  // ★ 2026-10-29（阻塞点直方图第一名：114 个体）：结构体字面量的键是 `field_identifier`，
  //   不是 `identifier` —— 漏了它，凡带 `T{Field: v}` 的体全被判"翻不动"。
  'field_identifier',
  'int_literal',
  'interpreted_string_literal',
  'raw_string_literal',
  'selector_expression',
  'call_expression',
  'binary_expression',
  'index_expression',
  'parenthesized_expression',
  'unary_expression',
  'true',
  'false',
  'nil',
  'float_literal',
  'rune_literal',
  'slice_expression',
  'composite_literal',
  'literal_value',
  'keyed_element',
  'literal_element',
  'expression_list',
  'argument_list',
]);

/** 匿名 token（`{` `}` `(` `)` `,` `;` 等）跳过用：命名节点为 false 或类型是纯符号 */
const ignorable = (n: SyntaxNodeLike): boolean => n.isNamed === false || !/\S/.test(n.type);

/**
 * **Go AST → 体 IR**。不支持就返回 `null`（调用方回落 legacy）。
 * `env` 只用于判断"能不能翻"，不参与 IR 结构。
 */
export function liftGoBody(block: SyntaxNodeLike): IrStmt[] | null {
  LIFT_FAIL = null;
  const stmts = kidsOf(block);
  const out: IrStmt[] = [];
  for (const s of stmts) {
    const lifted = liftStmt(s);
    if (!lifted) {
      // ★★★ 2026-10-29（T-#KILL-LEGACY 步 0）：**每次拒绝都必须有原因**。
      //   实测 387 个阻塞里 **184 个"未记原因"** ⇒ 无法按频次排优先级，也就无法"逐组搬进 pivot"。
      //   ⇒ 若 liftStmt 内部没记原因，这里用**节点类型**兜底（failLift 幂等：已记的保留）。
      failLift(s, `stmt-not-recorded:${s.type}`);
      return null;
    }
    out.push(lifted);
  }
  return out;
}

function kidsOf(n: SyntaxNodeLike): SyntaxNodeLike[] {
  const out: SyntaxNodeLike[] = [];
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    // ★ 2026-10-29（失败点直方图抓到的**我自己的 bug**）：**注释是命名节点**，
    //   漏掉这行会让带注释的函数体整条被判"翻不动"——实测 **80 个**体卡在这（占阻塞的 19%）。
    //   legacy 把 comment 当空语句（返回 ''），这里等价跳过。
    if (c && !ignorable(c) && c.type !== 'comment') out.push(c);
  }
  return out;
}

function liftStmt(n: SyntaxNodeLike, depth = 0): IrStmt | null {
  if (!OK_STMT.has(n.type)) return failLift(n, 'stmt-not-supported');
  switch (n.type) {
    case 'block': {
      const inner = kidsOf(n).map((c) => liftStmt(c, depth + 1));
      if (inner.some((x) => !x)) return null;
      return { k: 'block', body: inner as IrStmt[] };
    }
    case 'if_statement': {
      // ★ 先分离 **init**（`if x := f(); cond {}`）与 **condition**：
      //   tree-sitter-go 里 condition 有 field，init 没有 ⇒ 取"condition 之前的命名语句"。
      const condField = fieldOf(n, 'condition');
      let initStmt: IrStmt | null = null;
      for (const c of kidsOf(n)) {
        if (c.type === 'block' || c.type === 'if_statement' || c.type === 'else') continue;
        if (condField && c === condField) break;
        if (c.type === 'short_var_declaration' || c.type === 'assignment_statement' || c.type === 'expression_statement') {
          initStmt = liftStmt(c, depth + 1);
          if (!initStmt) return failLift(c, 'if-init-not-supported');
          break;
        }
      }
      // 条件：优先用 field，其次退回"第一个非 init/非 block 的命名子节点"
      let condNode: SyntaxNodeLike | null = condField;
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (!c || c.isNamed === false) continue;
        if (['block', 'if_statement', 'else', 'short_var_declaration', 'assignment_statement', 'expression_statement'].includes(c.type)) continue;
        condNode = c;
        break;
      }
      if (!condNode) return null;
      const cond = liftExpr(condNode);
      if (!cond) return null;
      const blocks: SyntaxNodeLike[] = [];
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type === 'block') blocks.push(c);
      }
      const thenBlock = blocks[0];
      if (!thenBlock) return null;
      const thenIr = liftStmt(thenBlock, depth + 1);
      if (!thenIr || thenIr.k !== 'block') return null;
      // ★★ else：tree-sitter-go 里 `else` 是**匿名 token**，不是 else_clause 包装
      //   （legacy 注释里记过这条坑：漏了会静默丢分支）。见到 else 必须有分支，找不到就 null。
      let elseIdx = -1;
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && (c.type === 'else' || c.type === 'else_clause')) {
          elseIdx = i;
          break;
        }
      }
      const withInit = (
        o: { k: 'if'; cond: IrExpr; then: IrStmt[]; else?: IrStmt[] | IrStmt },
      ): Extract<IrStmt, { k: 'if' }> => (initStmt ? { ...o, init: initStmt } : o);
      if (elseIdx < 0) return withInit({ k: 'if', cond, then: thenIr.body });
      const wrapper = n.child(elseIdx);
      const inner =
        wrapper && wrapper.type === 'else_clause' ? (wrapper.child(1) ?? wrapper.child(0)) : n.child(elseIdx + 1);
      if (!inner) return null;
      if (inner.type === 'if_statement') {
        const nested = liftStmt(inner, depth + 1);
        if (!nested) return null;
        return withInit({ k: 'if', cond, then: thenIr.body, else: nested });
      }
      const elseIr = liftStmt(inner, depth + 1);
      if (!elseIr || elseIr.k !== 'block') return null;
      return withInit({ k: 'if', cond, then: thenIr.body, else: elseIr.body });
    }
    case 'return_statement': {
      const list = kidsOf(n).find((c) => c.type === 'expression_list');
      if (!list) return { k: 'return', values: [] };
      const values = kidsOf(list).map(liftExpr);
      if (values.some((v) => !v)) return null;
      return { k: 'return', values: values as IrExpr[] };
    }
    case 'expression_statement': {
      const e = kidsOf(n)[0];
      if (!e) return null;
      const value = liftExpr(e);
      return value ? { k: 'expr', value } : null;
    }
    case 'short_var_declaration': {
      const lists = kidsOf(n).filter((c) => c.type === 'expression_list');
      if (lists.length !== 2) return null;
      const lhs = kidsOf(lists[0]);
      const rhs = kidsOf(lists[1]);
      if (lhs.length !== 1 || rhs.length !== 1) return null;
      if (lhs[0].type !== 'identifier') return null;
      const value = liftExpr(rhs[0]);
      return value ? { k: 'declare', name: lhs[0].text, value, mutable: true } : null;
    }
    case 'assignment_statement': {
      const lists = kidsOf(n).filter((c) => c.type === 'expression_list');
      if (lists.length !== 2) return null;
      const lhs = kidsOf(lists[0]);
      const rhs = kidsOf(lists[1]);
      if (lhs.length !== 1 || rhs.length !== 1) return null;
      const target = liftExpr(lhs[0]);
      const value = liftExpr(rhs[0]);
      if (!target || !value) return null;
      // 赋值运算符在匿名 token 里
      let op = '=';
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && !c.isNamed && /^(\+|-|\*|\/|%|&|\||\^|<<|>>)?=$/.test(c.type)) op = c.type;
      }
      return { k: 'assign', target, op, value };
    }
    case 'expression_switch_statement': {
      const discNode = fieldOf(n, 'value') ?? n.child(1) ?? null;
      const discInner = discNode && discNode.type === 'expression_list' ? (kidsOf(discNode)[0] ?? null) : discNode;
      if (!discInner) return null;
      const disc = liftExpr(discInner);
      if (!disc) return null;
      const cases: Array<{ labels: IrExpr[] | null; body: IrStmt[] }> = [];
      for (const c of kidsOf(n)) {
        if (c.type !== 'expression_case' && c.type !== 'default_case') continue;
        // ★ fallthrough 未建模 ⇒ 见到就整条不翻（宁可交 LLM，也不静默改变控制流）
        let hasFallthrough = false;
        for (let i = 0; i < c.childCount; i++) {
          const k = c.child(i);
          if (k && k.type === 'fallthrough_statement') hasFallthrough = true;
        }
        if (hasFallthrough) return null;
        let labels: IrExpr[] | null = null;
        if (c.type === 'expression_case') {
          const list = kidsOf(c).find((x) => x.type === 'expression_list');
          if (!list) return null;
          labels = [];
          for (const k of kidsOf(list)) {
            const e = liftExpr(k);
            if (!e) return null;
            labels.push(e);
          }
        }
        const body: IrStmt[] = [];
        for (const k of kidsOf(c)) {
          if (k.type === 'expression_list' || k.type === 'fallthrough_statement') continue;
          const st = liftStmt(k, depth + 1);
          if (!st) return null;
          body.push(st);
        }
        cases.push({ labels, body });
      }
      if (!cases.length) return null;
      return { k: 'switch', disc, cases };
    }
    case 'continue_statement':
      return { k: 'jump', op: 'continue' };
    case 'break_statement':
      return { k: 'jump', op: 'break' };
    case 'defer_statement': {
      // ★ 只在函数体直接子层接受（depth 0）——嵌套 defer 的执行时机不同，不翻
      if (depth !== 0) return null;
      const parts = kidsOf(n);
      const call = parts[parts.length - 1] ?? null;
      if (!call) return null;
      const ir = liftExpr(call);
      return ir ? { k: 'defer', call: ir } : null;
    }
    case 'var_declaration': {
      // `var x T = v` / `var x T`：只支持**单名**（多名会变成多条语句，先不铺）
      const specs: SyntaxNodeLike[] = [];
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type === 'var_spec') specs.push(c);
      }
      if (specs.length !== 1) return null;
      const sp = specs[0];
      const ids: string[] = [];
      let valList: SyntaxNodeLike | null = null;
      for (let i = 0; i < sp.childCount; i++) {
        const c = sp.child(i);
        if (!c) continue;
        if (c.type === 'identifier') ids.push(c.text);
        else if (c.type === 'expression_list') valList = c;
      }
      if (ids.length !== 1) return null;
      if (valList) {
        const values = kidsOf(valList);
        if (values.length !== 1) return null;
        const value = liftExpr(values[0]);
        return value ? { k: 'declare', name: ids[0], value, mutable: true } : null;
      }
      return { k: 'declare', name: ids[0], value: null, mutable: true };
    }
    case 'inc_dec_statement': {
      const parts = kidsOf(n);
      if (parts.length !== 1) return null;
      const target = liftExpr(parts[0]);
      if (!target) return null;
      let op: '++' | '--' = '++';
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.isNamed === false && (c.type === '++' || c.type === '--')) op = c.type;
      }
      return { k: 'incdec', target, op };
    }
    case 'for_statement': {
      const bodyBlock = kidsOf(n).find((c) => c.type === 'block');
      if (!bodyBlock) return null;
      const bodyIr = liftStmt(bodyBlock, depth + 1);
      if (!bodyIr || bodyIr.k !== 'block') return null;
      const rng = kidsOf(n).find((c) => c.type === 'range_clause');
      if (rng) {
        const lhs = kidsOf(rng).find((c) => c.type === 'expression_list');
        const right = fieldOf(rng, 'right') ?? kidsOf(rng).filter((c) => c.type !== 'expression_list').pop() ?? null;
        if (!right) return null;
        const target = liftExpr(right);
        if (!target) return null;
        const names: string[] = [];
        if (lhs) {
          for (const c of kidsOf(lhs)) {
            if (c.type !== 'identifier') return null;
            names.push(c.text);
          }
        }
        const index = names[0] && names[0] !== '_' ? names[0] : null;
        const value = names[1] && names[1] !== '_' ? names[1] : null;
        return { k: 'range', index, value, target, body: bodyIr.body };
      }
      const fc = kidsOf(n).find((c) => c.type === 'for_clause') ?? null;
      const initNode = fc ? fieldOf(fc, 'initializer') : fieldOf(n, 'initializer');
      const condNode =
        (fc ? fieldOf(fc, 'condition') : null) ??
        fieldOf(n, 'condition') ??
        kidsOf(n).find((c) => !['for_clause', 'block'].includes(c.type)) ??
        null;
      const postNode = fc ? fieldOf(fc, 'update') : fieldOf(n, 'update');
      if (initNode || postNode) {
        const init = initNode ? liftStmt(initNode) : undefined;
        if (initNode && !init) return null;
        const post = postNode ? liftStmt(postNode) : undefined;
        if (postNode && !post) return null;
        const cond = condNode ? liftExpr(condNode) : undefined;
        if (condNode && !cond) return null;
        return { k: 'for', init: init ?? undefined, cond: cond ?? undefined, post: post ?? undefined, body: bodyIr.body };
      }
      if (!condNode) return { k: 'for', body: bodyIr.body }; // `for {}`
      const cond = liftExpr(condNode);
      if (!cond) return null;
      return { k: 'while', cond, body: bodyIr.body };
    }
    default:
      return null;
  }
}

/** tree-sitter 的字段访问（`childForFieldName`），拿不到就 null —— 不猜 */
function fieldOf(n: SyntaxNodeLike, name: string): SyntaxNodeLike | null {
  const anyN = n as unknown as { childForFieldName?: (s: string) => SyntaxNodeLike | null };
  return typeof anyN.childForFieldName === 'function' ? anyN.childForFieldName(name) : null;
}

function liftExpr(n: SyntaxNodeLike): IrExpr | null {
  if (!OK_EXPR.has(n.type)) return failLift(n, 'expr-not-supported');
  switch (n.type) {
    case 'identifier':
    case 'field_identifier':
      return { k: 'ident', name: n.text };
    case 'int_literal':
      return { k: 'int', value: normalizeInt(n.text) };
    case 'interpreted_string_literal':
    case 'raw_string_literal':
      return { k: 'str', raw: n.text };
    case 'selector_expression': {
      const parts = kidsOf(n);
      if (parts.length !== 2) return null;
      const x = liftExpr(parts[0]);
      if (!x) return null;
      return { k: 'sel', x, member: parts[1].text };
    }
    case 'call_expression': {
      const parts = kidsOf(n);
      const fnNode = parts.find((c) => c.type === 'identifier' || c.type === 'selector_expression');
      // ★ 内建槽：`len(x)` / `cap(x)` / `append(s, x…)` ⇒ 不走普通 call
      const CONV_RE = /^(u?int(8|16|32|64)?|uintptr|byte|rune|float(32|64)|string|bool)$/;
      const isBuiltin = fnNode && fnNode.type === 'identifier' && ['len', 'cap', 'append'].includes(fnNode.text);
      // ★ **类型转换也是内建槽**：`float64(x)`/`int(x)` 是"转成实数/整数"的语义，
      //   不是普通函数调用。目标语言各有写法（TS: 直接 number / Math.trunc / String）⇒ 归渲染器。
      //   （这条是证 t441「float64(x) 与 len(s)」对拍失败逼出来的：我第一版把转换当普通 call，
      //    直接吐出 `float64(x)` —— Go 的语法漏进了 TS 产物。）
      const isConv = fnNode && fnNode.type === 'identifier' && CONV_RE.test(fnNode.text);
      if (isBuiltin || isConv) {
        const argList = parts.find((c) => c.type === 'argument_list');
        const args: IrExpr[] = [];
        if (argList) {
          for (const a of kidsOf(argList)) {
            const e = liftExpr(a);
            if (!e) return null;
            args.push(e);
          }
        }
        return { k: 'builtin', name: fnNode.text, args };
      }
      if (!fnNode) return null;
      const fn = liftExpr(fnNode);
      if (!fn) return null;
      const argList = parts.find((c) => c.type === 'argument_list');
      const args: IrExpr[] = [];
      let spreadLast = false;
      if (argList) {
        for (const a of kidsOf(argList)) {
          // ★ Go `f(a, xs...)`：tree-sitter 里是 `variadic_argument` 节点（实测），
          //   里面才是真正的表达式。漏掉它会让展开语义整个丢掉。
          if (a.type === 'variadic_argument') {
            const inner = kidsOf(a)[0] ?? null;
            const e = inner ? liftExpr(inner) : null;
            if (!e) return null;
            args.push(e);
            spreadLast = true;
            continue;
          }
          const e = liftExpr(a);
          if (!e) return null;
          args.push(e);
        }
      }
      return { k: 'call', fn, args, ...(spreadLast ? { spreadLast } : {}) };
    }
    case 'index_expression': {
      const parts = kidsOf(n);
      if (parts.length !== 2) return null;
      const x = liftExpr(parts[0]);
      const idx = liftExpr(parts[1]);
      return x && idx ? { k: 'index', x, idx } : null;
    }
    case 'variadic_argument': {
      const inner = kidsOf(n)[0];
      if (!inner) return null;
      return liftExpr(inner);
    }
    case 'parenthesized_expression': {
      const inner = kidsOf(n)[0];
      if (!inner) return null;
      const x = liftExpr(inner);
      return x ? { k: 'paren', x } : null;
    }
    case 'unary_expression': {
      const parts = kidsOf(n);
      const x = parts.length ? liftExpr(parts[0]) : null;
      if (!x) return null;
      let op = '';
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.isNamed === false) { op = c.type; break; }
      }
      if (!op) return null;
      // ★ Go 指针运算符在 TS 不存在（legacy 同规则）：`&x`/`*x` ⇒ 值本身
      if (op === '&' || op === '*') return x;
      // Go 的按位取反是 `^x`，TS 是 `~x`
      return { k: 'unary', op: op === '^' ? '^' : op, x };
    }
    case 'composite_literal': {
      const typeNode = n.child(0) ?? null;
      // ★ 种类看**类型节点的 AST type**（结构化），不看类型文本形状（legacy 已记为旧毛病）
      const kindOf = (t: SyntaxNodeLike | null): 'slice' | 'map' | 'struct' | null => {
        if (!t) return null;
        if (t.type === 'slice_type' || t.type === 'array_type') return 'slice';
        if (t.type === 'map_type') return 'map';
        if (['struct_type', 'type_identifier', 'qualified_type', 'generic_type'].includes(t.type)) return 'struct';
        return null;
      };
      const kind = kindOf(typeNode);
      if (!kind) return null;
      const body = kidsOf(n).find((c) => c.type === 'literal_value');
      if (!body) return null;
      const elems: Array<{ key?: IrExpr; value: IrExpr }> = [];
      for (const c of kidsOf(body)) {
        if (c.type === 'keyed_element') {
          // ★ 收编第 1 组（单一改动，按纪律单独量）：tree-sitter-go 把 keyed_element 的键/值
          //   各包在 `literal_element` 里 ⇒ 直接 liftExpr(parts[0]) 拿到 literal_element（无分支）⇒ null
          //   ⇒ **整个带键结构体字面量判翻不动**（`MergeRequest{Source:"a"}` FAIL，`MergeRequest{}` OK）。
          const unwrap = (x: SyntaxNodeLike | undefined): SyntaxNodeLike | null => {
            if (!x) return null;
            if (x.type === 'literal_element') return kidsOf(x)[0] ?? null;
            return x;
          };
          const parts = kidsOf(c);
          if (parts.length < 2) return null;
          const kNode = unwrap(parts[0]);
          const vNode = unwrap(parts[parts.length - 1]);
          const key = kNode ? liftExpr(kNode) : null;
          const value = vNode ? liftExpr(vNode) : null;
          if (!key || !value) return null;
          elems.push({ key, value });
        } else {
          const inner = c.type === 'literal_element' ? (kidsOf(c)[0] ?? null) : c;
          if (!inner) return null;
          const value = liftExpr(inner);
          if (!value) return null;
          elems.push({ value });
        }
      }
      return { k: 'composite', kind, elems, ...(typeNode ? { typeText: typeNode.text } : {}) };
    }
    case 'nil':
      return { k: 'nil' };
    case 'float_literal':
    case 'rune_literal':
      return { k: 'int', value: normalizeInt(n.text) };
    case 'slice_expression': {
      const operand = fieldOf(n, 'operand') ?? kidsOf(n)[0] ?? null;
      if (!operand) return null;
      const x = liftExpr(operand);
      if (!x) return null;
      const loNode = fieldOf(n, 'start');
      const hiNode = fieldOf(n, 'end');
      const lo = loNode ? liftExpr(loNode) : null;
      const hi = hiNode ? liftExpr(hiNode) : null;
      if (loNode && !lo) return null;
      if (hiNode && !hi) return null;
      return { k: 'slice', x, lo, hi };
    }
    case 'true':
      return { k: 'bool', value: true };
    case 'false':
      return { k: 'bool', value: false };
    case 'binary_expression': {
      const parts = kidsOf(n);
      if (parts.length !== 2) return null;
      const l = liftExpr(parts[0]);
      const r = liftExpr(parts[1]);
      if (!l || !r) return null;
      // 运算符是匿名 token，位于两操作数之间
      let op = '';
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && !c.isNamed) {
          op = c.type;
          break;
        }
      }
      if (!op) return null;
      return { k: 'bin', op, l, r };
    }
    default:
      return null;
  }
}

/** Go 老式八进制 `0644` → TS `0o644`（与 legacy 的 `normalizeLegacyOctal` 同规则） */
function normalizeInt(text: string): string {
  // ★ 与 legacy 同规则：Go 允许 `1_000` 分隔符，TS 不允许 ⇒ 先去掉；
  //   再处理 Go 老式八进制 `0644`（TS1121 非法）⇒ `0o644`。
  const raw = text.replace(/_/g, '');
  if (/^0[0-7]+$/.test(raw)) return '0o' + raw.slice(1);
  return raw;
}

/** **体 IR → TS 文本**（只此一处决定 TS 语法；Rust 渲染器会是另一个函数） */
export function projectTsBody(stmts: IrStmt[], indent = 1): string {
  // ★★★ defer 是**结构变换**（不是语句渲染）：Go 在函数返回时按 LIFO 执行 ⇒ TS 用 try/finally。
  //   只在直接子层接受（lift 已保证）；嵌套 defer 在 lift 阶段就被拒了。
  const defers = stmts.filter((s): s is Extract<IrStmt, { k: 'defer' }> => s.k === 'defer');
  if (defers.length) {
    const rest = stmts.filter((s) => s.k !== 'defer');
    const restText = rest.length
      ? rest.map((s) => indentStr(indent + 1) + projectTsStmt(s, indent + 1)).join('\n')
      : '';
    const finText = defers
      .slice()
      .reverse() // LIFO
      .map((d) => indentStr(indent + 1) + projectTsExpr(d.call) + ';')
      .join('\n');
    return `${indentStr(indent)}try {\n${restText}\n${indentStr(indent)}} finally {\n${finText}\n${indentStr(indent)}}`;
  }
  return stmts.map((s) => indentStr(indent) + projectTsStmt(s, indent)).join('\n');
}

function indentStr(n: number): string {
  return '  '.repeat(n);
}

function projectTsStmt(s: IrStmt, indent: number): string {
  switch (s.k) {
    case 'return': {
      // ★★★ 2026-10-29：**多返回值必须包数组**。原来用 `join(', ')` ⇒ 生成 `return X, nil`
      //   是 TS 的**逗号表达式**（左侧求值即丢弃）⇒ `TS2695 Left side of comma operator is unused`。
      //   Go 的多返回值语义 = 元组 ⇒ TS 侧用数组承载（legacy 早就是这么做的，pivot 漏了）。
      if (s.values.length <= 1) {
        return `return${s.values.length ? ' ' + projectTsExpr(s.values[0]) : ''};`;
      }
      return `return [${s.values.map(projectTsExpr).join(', ')}];`;
    }
    case 'expr':
      return `${projectTsExpr(s.value)};`;
    case 'declare': {
      // ★ Go 的 `:=` 一律落 `let`（不能用 const：Go 里后续可以再赋值，实测过 const 会炸）
      let v = s.value ? projectTsExpr(s.value) : null;
      // ★ T-#SHIM-APPLY：值类型 struct 的赋值在 Go 里是**复制** ⇒ 显式 copy() 顶住
      if (s.value && s.value.k === 'ident' && isValueStructIdent(s.value.name)) v = `copy(${v})`;
      return `${s.mutable ? 'let' : 'const'} ${s.name}${v ? ' = ' + v : ''};`;
    }
    case 'assign':
      return `${projectTsExpr(s.target)} ${s.op} ${projectTsExpr(s.value)};`;
    case 'block':
      // 语句块在顶层不单独成句（由 if/for 内部消化）
      return projectTsBody(s.body, indent);
    case 'for': {
      // 三式 / 无条件：`for (init; cond; post) {}` —— init/post 是**行内**语句（不带缩进、不带分号后换行）
      const init = s.init ? projectTsInline(s.init) : '';
      const cond = s.cond ? projectTsExpr(s.cond) : '';
      const post = s.post ? projectTsInline(s.post) : '';
      const bodyText = projectTsBody(s.body, indent + 1);
      if (!s.init && !s.cond && !s.post) {
        // `for {}` ⇒ TS 用同一个形状（无限循环）
        return `for (;;) {\n${bodyText}\n${indentStr(indent)}}`;
      }
      return `for (${init}; ${cond}; ${post}) {\n${bodyText}\n${indentStr(indent)}}`;
    }
    case 'while': {
      const bodyText = projectTsBody(s.body, indent + 1);
      return `while (${projectTsExpr(s.cond)}) {\n${bodyText}\n${indentStr(indent)}}`;
    }
    case 'range': {
      const bodyText = projectTsBody(s.body, indent + 1);
      const t = projectTsExpr(s.target);
      // ★ TS 渲染器的决定（与 legacy 逐字一致）：有值名则按"是否同时要下标"分两种写法
      if (s.value) {
        if (s.index) {
          const inner = indentStr(indent + 1) + `const ${s.value} = ${t}[${s.index}];\n` + bodyText;
          return `for (let ${s.index} = 0; ${s.index} < ${t}.length; ${s.index}++) {\n${inner}\n${indentStr(indent)}}`;
        }
        return `for (const ${s.value} of ${t}) {\n${bodyText}\n${indentStr(indent)}}`;
      }
      if (s.index) return `for (let ${s.index} = 0; ${s.index} < ${t}.length; ${s.index}++) {\n${bodyText}\n${indentStr(indent)}}`;
      return `for (const _ of ${t}) {\n${bodyText}\n${indentStr(indent)}}`;
    }
    case 'jump':
      return `${s.op};`;
    case 'incdec':
      return `${projectTsExpr(s.target)}${s.op};`;
    case 'switch': {
      const lines: string[] = [];
      for (const c of s.cases) {
        // ★★★ 2026-10-29：**TS 不接受 `case a, b:`**（Go 允许）。原来 `join(', ')` ⇒ 语法错
        //   （表象是 TS2695）。正解是**堆叠 case 标签**，TS 的 fallthrough 语义正好等于 Go 的多值 case。
        if (c.labels) {
          for (const l of c.labels) lines.push(indentStr(indent + 1) + `case ${projectTsExpr(l)}:`);
        } else {
          lines.push(indentStr(indent + 1) + 'default:');
        }
        if (c.body.length) lines.push(projectTsBody(c.body, indent + 2));
        // ★ 与 legacy 一致：每个 case 一律补 break（fallthrough 已在 lift 阶段被拒）
        lines.push(indentStr(indent + 2) + 'break;');
      }
      return `switch (${projectTsExpr(s.disc)}) {\n${lines.join('\n')}\n${indentStr(indent)}}`;
    }
    case 'if': {
      const thenBody = projectTsBody(s.then, indent + 1);
      if (s.init) {
        // ★ Go 的 `if init; cond` 里 init 的作用域限于该 if ⇒ TS 用块包住，名字不外泄
        const inner = projectTsBody([{ k: 'if', cond: s.cond, then: s.then, ...(s.else ? { else: s.else } : {}) }], indent + 1);
        return `{\n${indentStr(indent + 1)}${projectTsStmt(s.init, indent + 1)}\n${inner}\n${indentStr(indent)}}`;
      }
      let out = `if (${projectTsExpr(s.cond)}) {\n${thenBody}\n${indentStr(indent)}}`;
      if (s.else) {
        if (Array.isArray(s.else)) {
          const elseBody = projectTsBody(s.else, indent + 1);
          out += ` else {\n${elseBody}\n${indentStr(indent)}}`;
        } else {
          // `else if`：把嵌套 if 的文本接在 `else ` 后面（与 legacy 同样的形状）
          out += ` else ${projectTsStmt(s.else, indent)}`;
        }
      }
      return out;
    }
    default:
      throw new Error('projectTsStmt: 未知 IR 语句');
  }
}

/** 行内语句（for 的 init/post）：不带缩进、**不带结尾分号** */
function projectTsInline(st: IrStmt): string {
  const text = projectTsStmt(st, 0);
  return text.endsWith(';') ? text.slice(0, -1) : text;
}

function projectTsExpr(e: IrExpr): string {
  switch (e.k) {
    case 'ident':
      return e.name;
    case 'int':
      return e.value;
    case 'str':
      return e.raw;
    case 'sel':
      return `${projectTsExpr(e.x)}.${e.member}`;
    case 'call': {
      // ★ Go 内置 `delete(m, k)` 不是 JS 的 delete 运算符（证 t454 抓到 pivot 与 legacy 分叉）
      if (e.fn.k === 'ident' && e.fn.name === 'delete' && e.args.length === 2) {
        return `${projectTsExpr(e.args[0])}.delete(${projectTsExpr(e.args[1])})`;
      }
      const rendered = e.args.map((a, i) =>
        e.spreadLast && i === e.args.length - 1 ? '...' + projectTsExpr(a) : projectTsExpr(a),
      );
      return `${projectTsExpr(e.fn)}(${rendered.join(', ')})`;
    }
    case 'bin': {
      // ★ TS 渲染器的决定：Go 的 `==` / `!=` 落成严格相等 `===` / `!==`。
      //   轴心只说"这是相等比较"，具体写法归渲染器（Rust 渲染器会是 `==`）。
      const op = e.op === '==' ? '===' : e.op === '!=' ? '!==' : e.op;
      return `${projectTsExpr(e.l)} ${op} ${projectTsExpr(e.r)}`;
    }
    case 'index':
      return `${projectTsExpr(e.x)}[${projectTsExpr(e.idx)}]`;
    case 'paren':
      return `(${projectTsExpr(e.x)})`;
    case 'unary':
      return `${e.op === '^' ? '~' : e.op}${projectTsExpr(e.x)}`;
    case 'bool':
      return e.value ? 'true' : 'false';
    case 'nil':
      return 'null';
    case 'composite': {
      // TS 渲染器：切片 → 数组；map → `new Map([[k, v], …])`（**必须元组**，不是 `k: v`）；struct → 对象字面量
      if (e.kind === 'slice') return `[${e.elems.map((x) => projectTsExpr(x.value)).join(', ')}]`;
      if (e.kind === 'map')
        return `new Map([${e.elems.map((x) => `[${x.key ? projectTsExpr(x.key) : 'undefined'}, ${projectTsExpr(x.value)}]`).join(', ')}])`;
      {
        const obj = `{ ${e.elems
          .map((x) => `${x.key ? projectTsExpr(x.key) : 'undefined'}: ${projectTsExpr(x.value)}`)
          .join(', ')} }`;
        // ★★★ 2026-10-29（**读代码读出来的**，不是量出来的）：Go 的 `&Server{cfg: cfg}` 起的是
        //   **具类型**的值，我们渲染成裸对象字面量 ⇒ TS 推断成 `{ cfg: ServerConfig }`
        //   ⇒ 后面 `s.graphPath = …` 全报 TS2339（一眼就看得出来）。
        //   轴心**本来就记了** `typeText`（`Server`），只是渲染时没输出 ⇒ 补类型断言。
        // ★ 2026-10-29 [已回退门限] 只在"本文件声明的类型"上加断言会让产物变差（440→452）：
        //   有些类型在同一模块但不在 `kind==='type'` 的单元里 ⇒ 断言被误删。
        //   缺 import 的问题改由 tsc 驱动补（TS2304 ⇒ 找到导出该名字的模块并 import）。
        const tn = e.typeText ? e.typeText.replace(/^\*+/, '') : '';
        return tn ? `(${obj} as ${tn})` : obj;
      }
    }
    case 'slice':
      // TS 渲染器：`x.slice(lo ?? 0, hi)`
      return `${projectTsExpr(e.x)}.slice(${e.lo ? projectTsExpr(e.lo) : '0'}${e.hi ? ', ' + projectTsExpr(e.hi) : ''})`;
    case 'builtin': {
      // ★★★ 2026-10-29：Go 内置 `delete(m, k)` **不是** JS 的 `delete` 运算符——
      //   直译为 `delete(m, k)` 会变成"逗号表达式 + delete 关键字"（实测 TS2695）。
      //   Map 的删除在 TS 侧是 `m.delete(k)`。
      if (e.name === 'delete' && e.args.length === 2) {
        return `${projectTsExpr(e.args[0])}.delete(${projectTsExpr(e.args[1])})`;
      }
      // fallthrough 到通用 builtin 渲染 {
      // TS 渲染器的决定：长度 → `.length`；追加 → 展开运算符
      if (e.name === 'len' || e.name === 'cap') return `${projectTsExpr(e.args[0])}.length`;
      // ★ 2026-10-29 [已回退] 试过 `len` 落 `(x instanceof Map ? x.size : x.length)`：
      //   产物反而 546 → **584**（接收者被重复求值 + 复合表达式让 tsc 报更多类型错）。
      //   正确做法需要**类型信息**（判定该值是 Map 还是数组），见 todo T-#LEN-MAP-TYPED。
      if (e.name === 'append') {
        const [head, ...rest] = e.args;
        return `[...${projectTsExpr(head)}, ${rest.map(projectTsExpr).join(', ')}]`;
      }
      // 数值/字符串转换（TS 渲染器的决定；与 legacy 的 GO_CONV 等价）
      const a = e.args.map(projectTsExpr).join(', ');
      if (/^(u?int(8|16|32|64)?|uintptr|byte|rune)$/.test(e.name)) return `Math.trunc(${a})`;
      if (/^float(32|64)$/.test(e.name)) return a; // TS 的 number 就是 f64 ⇒ 无需转换
      if (e.name === 'string') return `String(${a})`;
      if (e.name === 'bool') return `Boolean(${a})`;
      throw new Error('未支持的内建：' + e.name);
    }
    default:
      throw new Error('projectTsExpr: 未知 IR 表达式');
  }
}
