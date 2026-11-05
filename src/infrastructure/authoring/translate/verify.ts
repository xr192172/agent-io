/**
 * verify —— 骨架验证闸（三段式落地"④ 行为对账"的前置静态闸）
 *
 * 在 LLM 介入前先保证"机械产物不会打烂目标语言"：
 *   1. 语法闸：每条骨架以 .ts 重新 tree-sitter 解析，必须解析出根节点——
 *      拦截"写成了不可解析的垃圾"（同仓库 refactor 管线的静态复核兜底做法）。
 *   2. 结构闸：核对骨架签名与单元源证据一致（函数名 / 参数个数；func 必带
 *      导出、type 以 interface 开头），防骨架生成本身漂移。
 *
 * 这是"飞刀"级保证（非 tsc 权威编译），失败即回滚该单元、不落盘。
 * 说明：真编译闸（tsc + 行为基线）留给切片之后接行为层时再加。
 */

import { parseAstRoot } from '../../parse/index.js';
// ★ R6：剥注释没有第二份 —— 函数体**片段**走片段权威（`domain/text_strip.ts#stripComments`）。
import { stripComments } from '../../../domain/text_strip.js';
import ts from 'typescript';
import type { TransUnit } from './unit.js';

export interface VerifyIssue {
  id: string;
  /** 'syntax' | 'structure' */
  gate: 'syntax' | 'structure';
  detail: string;
}

/** 取函数体文本（首 `{` 之后、末 `}` 之前） */
function bodyText(code: string): string {
  const open = code.indexOf('{');
  const close = code.lastIndexOf('}');
  if (open < 0 || close <= open) return code;
  return code.slice(open + 1, close);
}

/** 结构闸：签名/形状与源证据一致（func 导出+参数计数；type 为 interface） */
function structureCheck(u: TransUnit): string | null {
  if (u.kind === 'func') {
    if (!/^export\s+function\s+/.test(u.skeleton)) return 'func 骨架缺少 export function 前缀';
    const n = (u.params ?? []).length;
    const re = new RegExp(`^export\\s+function\\s+${escapeRe(u.name)}(?:<[^>]*>)?\\s*\\(`);
    if (!re.test(u.skeleton)) return `骨架函数名与单元不一致：${u.name}`;
    // 粗略数参数：函数头括号内逗号数 + (0 个参数时无逗号)
    const head = u.skeleton.slice(u.skeleton.indexOf('(') + 1, u.skeleton.indexOf(')'));
    const nParams = countTopLevelParams(head);
    if (nParams !== n) return `参数个数不一致：源=${n}，骨架=${nParams}`;
    // A3/A4 决策表：case 分支数与 default 必须与源一一对应（填后仍生效 → 拦"丢分支/改判别式"）
    if (u.decision) {
      const nCase = (u.skeleton.match(/\bcase\b/g) || []).length;
      if (nCase !== u.decision.cases.length) return `决策表分支数不一致：源=${u.decision.cases.length}，骨架=${nCase}`;
      const hasDef = u.skeleton.includes('default:');
      if (u.decision.hasDefault !== hasDef) return `决策表 default 分支${u.decision.hasDefault ? '缺失' : '多余'}`;
      if (!u.skeleton.includes(`switch (${u.decision.discriminant})`) && !u.skeleton.includes(`switch(${u.decision.discriminant})`)) {
        return `决策表判别式被改动：应为 switch(${u.decision.discriminant})`;
      }
    }
    // A4 填后结构化断言（仅对已填单元 bodyHole=false）：
    //   1) 空壳检测——函数体去掉注释/空白为空 → 疑似降级为空壳（如服务被砍成 new Map()）
    //   2) 入参语义丢失——Go 用过（非占位 argN、非 _）的参数，填后 body 未引用
    if (u.bodyHole === false) {
      // ★ R6：改调片段权威（旧版内联正则，本文件不留剥注释实现）。
      const body = stripComments(bodyText(u.skeleton));
      if (body.trim() === '') return '填后函数体为空（仅注释/空白），疑似降级为空壳';
      for (const p of u.params ?? []) {
        if (p.name === '_' || /^arg\d+$/.test(p.name)) continue;
        if (new RegExp(`\\b${escapeRe(p.name)}\\b`).test(body)) continue;
        // 参数在 Go 源里出现过（签名即含名）→ 填后 body 未引用，报语义丢失
        if (u.srcSnippet && new RegExp(`\\b${escapeRe(p.name)}\\b`).test(u.srcSnippet)) {
          return `填后函数体未使用 Go 用过参数「${p.name}」，疑似丢失该入参语义`;
        }
      }
    }
    return null;
  }
  if (u.kind === 'const') {
    if (!new RegExp(`^export\\s+(?:const|let)\\s+${escapeRe(u.name)}\\s*=`, 'm').test(u.skeleton)) return `const 骨架缺少 export (const|let) ${u.name} =`;
    return null;
  }
  if (u.kind === 'type') {
    if (u.typeKind === 'alias') {
      if (!new RegExp(`^export\\s+type\\s+${escapeRe(u.name)}(?:<[^>]*>)?\\s*=`).test(u.skeleton)) return `type 骨架缺少 export type ${u.name} =`;
    } else {
      if (!/^export\s+interface\s+/.test(u.skeleton)) return 'type 骨架缺少 export interface 前缀';
      if (!new RegExp(`^export\\s+interface\\s+${escapeRe(u.name)}\\b`).test(u.skeleton)) return `骨架类型名与单元不一致：${u.name}`;
    }
    return null;
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 深度感知的参数个数：逗号在 <>{}([]) 内不算分隔（如 `Map<string, number>, k: string` = 2 参） */
function countTopLevelParams(s: string): number {
  const t = s.trim();
  if (t === '') return 0;
  let depth = 0;
  let count = 1;
  for (const ch of t) {
    if ('<({['.includes(ch)) depth++;
    else if ('>)}]'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

/**
 * 对一批单元做骨架验证。返回全部发现的 issue；任一语法闸失败即该单元不可用。
 * 依赖 tree-sitter .ts 解析（仓库已装 typescript 语言包）。
 */

/**
 * ★★★ 2026-10-29（T-#FILL-TSC）：**用 TS 自己的语法器查语法** —— tree-sitter 放过的错它不放。
 *
 * 为什么不满足于 tree-sitter：`TS1184 "Modifiers cannot appear here"` 属于 **TS 的语法规则**，
 * tree-sitter 的容错语法会照收 ⇒ 坏体照样落盘（全仓 173 个 TS1184 全是从填孔 body 进来的）。
 * 这里只取 **parseDiagnostics（纯语法，不建 program）**：单函数骨架必然缺 import/类型，
 * 语义诊断会是噪声 —— 只要语法这一档。
 */
function tscGrammarIssues(u: TransUnit): VerifyIssue[] {
  const out: VerifyIssue[] = [];
  const fileName = "__sk_" + u.id + ".ts";
  const sf = ts.createSourceFile(fileName, u.skeleton, ts.ScriptTarget.ES2022, true);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const d of diags.slice(0, 3)) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    out.push({ id: u.id, gate: 'syntax', detail: "TS" + d.code + ": " + msg });
  }
  return out;
}

/**
 * ★ 2026-10-29（T-#FILL-TSC）：**返回值结构检查**（`TS2355` 的确定性代理判据）。
 * 声明了非 `void/any/undefined` 返回类型，体里既无 `return <值>` 也无 `throw` ⇒ 必然报 TS2355。
 * 用 AST 判，不建 program。
 */
function missingReturnIssue(u: TransUnit): VerifyIssue[] {
  const fileName = "__sk_" + u.id + ".ts";
  const sf = ts.createSourceFile(fileName, u.skeleton, ts.ScriptTarget.ES2022, true);
  let found: VerifyIssue | null = null;
  const scanReturns = (body: ts.Node): { hasValueReturn: boolean; hasThrow: boolean } => {
    let hasValueReturn = false;
    let hasThrow = false;
    const scan = (n: ts.Node): void => {
      if (ts.isReturnStatement(n) && n.expression) hasValueReturn = true;
      if (ts.isThrowStatement(n)) hasThrow = true;
      ts.forEachChild(n, scan);
    };
    scan(body);
    return { hasValueReturn, hasThrow };
  };
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.body) {
      const ret = node.type ? node.type.getText(sf).trim() : '';
      const returnsNothing = !ret || /^(void|any|undefined)$/.test(ret);
      if (!returnsNothing) {
        const r = scanReturns(node.body);
        if (!r.hasValueReturn && !r.hasThrow) {
          found = {
            id: u.id,
            gate: 'structure',
            detail: "声明返回 " + ret + "，但函数体既无 return <值> 也无 throw（必报 TS2355）",
          };
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found ? [found] : [];
}
/**
 * ★★★ 2026-10-29（T-#BODY-SCOPE）：**作用域检查** —— 填孔验收的最后一格判据。
 *
 * ## 为什么需要它（用户问出来的）
 * `TS2304 Cannot find name 'retrievers'` 这类错，来自**body 里引用了不存在的名字**
 * （字段写成裸标识符 / 骨架少了参数 / 拼错函数名）。等 tsc 统计太晚，而且分不清根因。
 * 这里在**填孔验收**阶段就用 TS 解析器查：body 里引用的每个名字，必须满足其一：
 *   ① 是函数/方法参数；② 是同函数内的 let/const/var/class/function 声明；
 *   ③ 是 import 进来的；④ 是语言/运行时全局（白名单，显式列）。
 *
 * ## 边界（诚实，防误杀）
 * · **只看表达式位置**：`ts.isTypeNode` 的子树整体跳过（签名里的类型名不在本单元声明，天然是"外部"）；
 * · 属性访问的**属性名**不算引用（`b.retrievers` 里的 `retrievers` 不查）；对象字面量的键同理；
 * · 全局白名单是**显式列表**（不是"猜"）；漏了的全局会造成误报 ⇒ 宁可在证里暴露，也不放宽成"全不查"；
 * · 只报**前 3 个**未声明名字（够用于重试提示，不刷屏）。
 *
 * ## [未核]
 * 闭包/嵌套函数的作用域、`with`、动态 `eval` 未建模；TS 的 `declare` 合并也未处理。
 * 这些在机械/LLM 体里罕见；出现时会被当作"未声明"（**误报方向是安全的那一侧**）。
 */
const SCOPE_GLOBALS = new Set([
  'console', 'JSON', 'Math', 'Number', 'String', 'Boolean', 'Object', 'Array', 'Set', 'Map', 'WeakMap',
  'WeakSet', 'Promise', 'Error', 'TypeError', 'RangeError', 'Date', 'RegExp', 'Symbol', 'BigInt',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Infinity', 'NaN', 'undefined', 'null', 'true', 'false',
  'globalThis', 'this', 'arguments', 'require', 'module', 'exports', 'process', 'Buffer', 'structuredClone',
  'ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Int8Array', 'Int32Array', 'Uint32Array', 'Float32Array',
  'Float64Array', 'DataView', 'Atomics', 'TextEncoder', 'TextDecoder', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'queueMicrotask', 'fetch', 'URL', 'URLSearchParams', 'crypto', 'void',
  'yield', 'await', 'new', 'typeof', 'instanceof', 'in', 'of', 'delete',
]);

export function undeclaredNameIssues(u: TransUnit): VerifyIssue[] {
  const sf = ts.createSourceFile(`__sk_${u.id}.ts`, u.skeleton, ts.ScriptTarget.ES2022, true);
  const declared = new Set<string>(SCOPE_GLOBALS);

  /** 收集"本文件内已声明"的名字（只收顶层 + 函数参数 + 函数体内的局部声明） */
  const collect = (node: ts.Node, into: Set<string>): void => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) into.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) into.add(node.name.text);
    if (ts.isFunctionDeclaration(node) && node.name) into.add(node.name.text);
    if (ts.isClassDeclaration(node) && node.name) into.add(node.name.text);
    if (ts.isImportDeclaration(node) && node.importClause) {
      const nc = node.importClause;
      if (nc.name) into.add(nc.name.text);
      const nb = nc.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) into.add(el.name.text);
      if (nb && ts.isNamespaceImport(nb)) into.add(nb.name.text);
    }
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      into.add(node.variableDeclaration.name.text);
    }
    ts.forEachChild(node, (c) => collect(c, into));
  };
  collect(sf, declared);

  const missing: string[] = [];
  const visit = (node: ts.Node): void => {
    // 类型位置整体跳过（签名里的类型名天然是"外部"）
    if (ts.isTypeNode(node)) return;
    // 属性名 / 键名不算引用
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      visit(node.initializer);
      return;
    }
    if (ts.isIdentifier(node)) {
      const name = node.text;
      const parent = node.parent;
      const isDeclName =
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isParameter(parent) && parent.name === node) ||
        (ts.isFunctionDeclaration(parent) && parent.name === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node);
      if (!isDeclName && !declared.has(name) && !missing.includes(name)) missing.push(name);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return missing.slice(0, 3).map((n) => ({
    id: u.id,
    gate: 'structure' as const,
    detail: `引用未声明的名字 ${n}（body 里裸用了不存在的变量/字段）`,
  }));
}

export async function verifySkeletons(units: TransUnit[]): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = [];
  for (const u of units) {
    if (!u.skeleton) {
      issues.push({ id: u.id, gate: 'structure', detail: '骨架为空（未生成）' });
      continue;
    }
    const parsed = await parseAstRoot(`__skeleton_${u.id}.ts`, u.skeleton);
    // tree-sitter 是容错解析：坏骨架仍可能返回根节点。除"解析不到根"外，
    // 还检查根节点 hasError（含 ERROR/MISSING）——拦截"写成了带语法错误的垃圾"。
    if (!parsed?.root) {
      issues.push({ id: u.id, gate: 'syntax', detail: '骨架无法被 .ts 解析（tree-sitter 静态复核失败）' });
    } else if (parsed.root.hasError) {
      issues.push({ id: u.id, gate: 'syntax', detail: '骨架 .ts 解析含 ERROR/MISSING 节点（语法不完整）' });
    }
    const structural = structureCheck(u);
    if (structural) issues.push({ id: u.id, gate: 'structure', detail: structural });
    // ★ T-#FILL-TSC：tree-sitter 之后再过一遍 **TS 语法器**（拦 TS1184 这类 TS 自己的语法规则）
    issues.push(...tscGrammarIssues(u));
    // ★ T-#FILL-TSC：返回值结构检查（TS2355 的确定性代理）
    issues.push(...missingReturnIssue(u));
    // ★ T-#BODY-SCOPE：作用域检查（引用的名字必须已声明/已导入/是全局）
    issues.push(...undeclaredNameIssues(u));
  }
  return issues;
}