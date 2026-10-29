/**
 * ★★★ 2026-10-29（T-#REF-REWRITE）：**引用改写层** —— `x.M(args)` → `T_M(x, args)`。
 *
 * ## 为什么必须有这一层
 * Go 的方法挂在类型上（`b.AddFix(x)`），TS 侧我们把方法拍平成**自由函数**（`Builder_AddFix(b, x)`）。
 * 只翻签名不翻调用点 ⇒ 全仓 **`TS2339 ×539`**（Property 'X' does not exist on type 'Y'），占错误总量一半以上。
 *
 * ## 为什么用 AST 而不是正则
 * 正则分不清 `b.AddFix(...)`（要改写）与 `obj.field.AddFix`、字符串里的 `"b.AddFix()"`、注释里的示例。
 * 这里用 **TypeScript 自己的解析器**（`ts.createSourceFile`）定位 `CallExpression` + `PropertyAccessExpression`，
 * 只在**确认接收者有已知类型**时改写 —— 判断依据来自册子（方法表），不是猜。
 *
 * ## 类型来源（诚实边界）
 * · 参数类型注解：`export function Builder_AddFix(b: Builder, …)` ⇒ `b : Builder`；
 * · 局部变量类型注解：`const t: SkillTree = …`；
 * · **字段/表达式的类型暂不推断**（需要符号表 + 流分析）⇒ 这类调用点**不改写**，留给后续或 LLM。
 *   `[未核]`：不改写的调用点仍会报 TS2339，这是**已知缺口**，不是静默放过（诊断里计数）。
 */
import ts from 'typescript';

export interface RefRewriteResult {
  /** 改写后的源码 */
  code: string;
  /** 改写处数 */
  rewrites: number;
  /** 见到形如 `x.M(...)` 但接收者类型未知（未改写）的处数 */
  unknownReceiver: number;
  /** 见到的明细（前若干条，便于对账） */
  samples: string[];
}

/** 册子 → 方法名索引：`类型名 → Set<方法名>`（`to` 形如 `builder.ts#Builder_AddFix`） */
export function buildMethodIndex(
  symbols: Array<{ to?: string | null; kind?: string }>,
): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const s of symbols) {
    if (s.kind !== 'method' || !s.to) continue;
    const hash = s.to.indexOf('#');
    if (hash < 0) continue;
    const sym = s.to.slice(hash + 1);
    const us = sym.indexOf('_');
    if (us <= 0) continue;
    const typeName = sym.slice(0, us);
    const methodName = sym.slice(us + 1);
    if (!typeName || !methodName) continue;
    if (!idx.has(typeName)) idx.set(typeName, new Set());
    idx.get(typeName)!.add(methodName);
  }
  return idx;
}

/**
 * 对一段 TS 源码做方法调用改写。
 * @param methodIndex `类型名 → Set<方法名>`（来自册子）
 */
export function rewriteMethodCalls(code: string, methodIndex: Map<string, Set<string>>): RefRewriteResult {
  const sf = ts.createSourceFile('__rewrite.ts', code, ts.ScriptTarget.ES2022, true);
  /** 变量/参数 → TS 类型名（只认简单类型注解，匿名对象/泛型不求值） */
  const types = new Map<string, string>();
  const simpleTypeName = (node: ts.TypeNode | undefined): string | null => {
    if (!node) return null;
    if (ts.isTypeReferenceNode(node)) return node.typeName.getText(sf);
    return null;
  };

  const collect = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.name && ts.isIdentifier(node.name)) {
      const t = simpleTypeName(node.type);
      if (t) types.set(node.name.text, t);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const t = simpleTypeName(node.type);
      if (t) types.set(node.name.text, t);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  // ★★★ 2026-10-29（v2）：**字段链**才是大头 —— 实测 `b.Method()` 只 32 处，
  //   而 `b.skillTree.Load(...)` / `s.heatStore.X()` 这类**接收者是字段访问**的有 482 处。
  //   字段类型从本模块的 `interface` 声明里取（那是册子 `sigTs` 排出来的，等价于 Go struct 定义）。
  const fieldTypes = new Map<string, Map<string, string>>();
  const collectInterfaces = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      const tname = node.name.text;
      const fields = new Map<string, string>();
      for (const m of node.members) {
        if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) {
          const ft = simpleTypeName(m.type);
          if (ft) fields.set(m.name.text, ft);
        }
      }
      if (fields.size) fieldTypes.set(tname, fields);
    }
    ts.forEachChild(node, collectInterfaces);
  };
  collectInterfaces(sf);

  /** 解析一个接收者表达式的类型：标识符 / 字段链（深度不限，全在已知类型里才成功） */
  const recvType = (e: ts.Expression): { type: string | null; root: string | null } => {
    if (ts.isIdentifier(e)) return { type: types.get(e.text) ?? null, root: e.text };
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
      const base = recvType(e.expression);
      if (!base.type) return { type: null, root: base.root };
      const ft = fieldTypes.get(base.type)?.get(e.name.text);
      return { type: ft ?? null, root: base.root };
    }
    if (ts.isParenthesizedExpression(e)) return recvType(e.expression);
    return { type: null, root: null };
  };
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let unknownReceiver = 0;
  const samples: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const pa = node.expression;
      const recv = pa.expression;
      const method = pa.name.text;
      const rt = recvType(recv);
      if (!rt.type) {
        // 接收者类型仍未知（函数返回值 / 索引 / 类型断言…）⇒ 不改写，但记账
        unknownReceiver++;
        if (samples.length < 8) samples.push(`${recv.getText(sf).slice(0, 28)}.${method}() ← 接收者类型未知`);
      } else if (methodIndex.get(rt.type)?.has(method)) {
        const args = node.arguments.map((a) => a.getText(sf));
        const flat = `${rt.type}_${method}(${[recv.getText(sf), ...args].join(', ')})`;
        edits.push({ start: node.getStart(sf), end: node.end, text: flat });
        if (samples.length < 8) samples.push(`${recv.getText(sf).slice(0, 28)}.${method}(…) → ${rt.type}_${method}(…)`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // 从后往前替换，避免偏移错位
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  return { code: out, rewrites: edits.length, unknownReceiver, samples };
}
