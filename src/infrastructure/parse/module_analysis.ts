/**
 * module_analysis —— TS/JS 家族的单文件**模块级作用域解析**（`analyzeModuleSource`）。
 *
 * 正确性机制：
 *   - 遍历 AST 建「作用域栈」，根作用域 = 全部模块绑定（声明 + import 说明符），
 *     每个 identifier/type_identifier 沿栈解析到最近的同名绑定；命中根作用域 → 是“模块符号的引用”，
 *     命中非根作用域 → 被局部遮蔽 → 不算（列级安全，与 ast_rename 同哲学）。
 *   - 通过 import/export 说明符的「本地名」与「远程名」区分：无别名才改写使用点；有别名只改 import 子句
 *     里的远程名，使用点（本地别名）不动。
 *   - 值符号（function/const）只认 identifier；类型符号（interface/type）只认 type_identifier；
 *     class/enum 值类型双栖，identifier 与 type_identifier 都算。
 *
 * ★ 为什么住在 infrastructure/parse（2026-10-04，T26）：
 *   本解析**只依赖基础设施**（`getParser` / `findLanguageByExt` / `parseContent` /
 *   `isTypeOnlyModuleStatement` + `ast_node` 原语），与 `project_root` / `renameFile` / `protect`
 *   无关（那三样只在跨文件改名执行器 `renameTsSymbol` 里用）。它原先被错误地放在
 *   `application/refactor/rename_symbol/languages/typescript.ts`（特性内部），
 *   而 `application/cross/project_root.ts`（共享工具层）却反向 import 它 —— 层次倒挂，
 *   并与该文件自身对外层 `cross` 的 value import 构成**双向 value 环**。
 *   下沉到 infrastructure 后，依赖方向回到「共享工具 → 基础设施」。
 */

import path from 'node:path';
import { getParser } from './loader.js';
import { findLanguageByExt } from './languages.js';
import { parseContent, isTypeOnlyModuleStatement } from './kernel.js';
import { TS_EXTS, stripQuotes, nameInfo, type N, type NodeType } from './ast_node.js';

/** TS/JS 家族的 tree-sitter 语言名 */
const TS_LANG_NAMES = new Set(['typescript', 'tsx', 'javascript', 'jsx']);

type ScopeMap = Map<string, number>;

/** import / re-export 边（跨文件依赖 + 改名定位共用） */
export interface ImportEdge {
  /** 原始 import 路径（如 './foo'、'../bar'；相对路径才可能落到项目内） */
  source: string;
  /** 远程名（被引入/被再导出的名字）；星号为 null */
  remoteName: string | null;
  /** 远程名节点字节偏移（跨文件改名要改这里） */
  remoteOffset: number | null;
  /** 本地名（import 说明符的别名或原名；re-export 为 null） */
  localName: string | null;
  /** 是否 `import type`（类型直连，引用只可能是 type_identifier） */
  typeOnly: boolean;
  /** 星号转发 `export * from` / `export * as ns from`：不可按名追踪 → 阻断 */
  star: boolean;
  /** 是否带 source 的 re-export（`export { a } from 'x'`） */
  isReexport: boolean;
}

export interface ModuleRef {
  name: string;
  offset: number;
  nodeType: NodeType;
}

export interface ModuleAnalysis {
  /** 模块级绑定：名字 → 声明处字节偏移（import 本地名也在内） */
  rootOffsets: Map<string, number>;
  /** 模块级绑定：名字 → 符号种类 */
  rootKinds: Map<string, string>;
  /** 解析到根作用域的引用 */
  rootRefs: ModuleRef[];
  /** export 列表里的说明符本地名（`export { a }` 的 a；re-export 同） */
  exportRefs: ModuleRef[];
  /** import / re-export 边 */
  imports: ImportEdge[];
}

// ─────────────────────────────────────────────
// 模块级作用域解析（构建全局符号引用地图的地基）
// ─────────────────────────────────────────────

const FN_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'generator_function',
  'arrow_function',
  'method_definition',
]);
const CLASS_TYPES = new Set(['class_declaration', 'abstract_class_declaration']);
const VAR_TYPES = new Set(['lexical_declaration', 'variable_declaration', 'module']);
const FOR_TYPES = new Set(['for_statement', 'for_in_statement', 'for_of_statement']);

function isRefType(t: string): NodeType | null {
  if (t === 'identifier' || t === 'shorthand_property_identifier' || t === 'shorthand_property_identifier_pattern') return 'value';
  if (t === 'type_identifier') return 'type';
  return null;
}

function fieldText(n: N | null, f: string): string {
  const c = n ? n.childForFieldName(f) : null;
  return c ? c.text : '';
}

function isFakePatternName(t: string): boolean {
  return t === 'object_pattern' || t === 'array_pattern';
}

/** 单文件模块级作用域解析（一次遍历） */
export async function analyzeModuleSource(src: string, filePath = 'file.ts'): Promise<ModuleAnalysis | null> {
  const ext = path.extname(filePath);
  if (!TS_EXTS.has(ext)) return null;
  const lang = findLanguageByExt(ext);
  if (!lang || !TS_LANG_NAMES.has(lang.name)) return null;
  const parser = await getParser(ext, lang);
  if (!parser) return null;
  // ★ §21 规矩③（2026-09-28 修剪）：解析失败**不再兜成 null**。
  //   null 的唯一含义收敛为"这个文件不适用模块级分析"（扩展名/语言/解析器缺一）；
  //   解析本身抛错 = 少做了事 → 向上抛（硬失败），"记 skipped 还是整体失败"由调用方定
  //   （本文件内：候选文件循环记 skipped，定义文件直接抛）。
  const root: N = (parseContent(parser as Parameters<typeof parseContent>[0], src) as unknown as { rootNode: N }).rootNode;

  const rootOffsets = new Map<string, number>();
  const rootKinds = new Map<string, string>();
  const rootRefs: ModuleRef[] = [];
  const exportRefs: ModuleRef[] = [];
  const imports: ImportEdge[] = [];

  const rootScope: ScopeMap = rootOffsets as ScopeMap;
  const stack: ScopeMap[] = [rootScope];

  const declare = (scope: ScopeMap, name: string, offset: number, kind: string): void => {
    if (!scope.has(name)) scope.set(name, offset);
    if (scope === rootScope && !rootKinds.has(name)) rootKinds.set(name, kind);
  };

  const lookupIsRoot = (name: string): boolean => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].has(name)) return i === 0;
    }
    return false;
  };

  const handleImport = (node: N): void => {
    const source = stripQuotes(fieldText(node, 'source'));
    // ★ type-only 判定收敛到内核唯一实现（2026-09-28）：此前本行与 kernel.ts 各有一份
    //   逐字相同的 `/^\s*import\s+type\b/`，于是 `export type … from` 的盲区在两处各存活一次。
    const typeOnly = isTypeOnlyModuleStatement(node.text);
    const pushEdge = (e: Omit<ImportEdge, 'typeOnly'>) => imports.push({ ...e, typeOnly });
    // 遍历 import 子句（import_clause / namespace_import / named_imports / default）
    const walkClause = (n: N, depth = 0): void => {
      if (depth > 20) return;
      if (n.type === 'import_specifier') {
        const rm = n.childForFieldName('name');
        const al = n.childForFieldName('alias');
        const remote = rm && (rm.type === 'identifier' || rm.type === 'type_identifier') ? { text: rm.text, offset: rm.startIndex } : null;
        const local = al ? { text: al.text, offset: al.startIndex } : remote;
        if (local) declare(rootScope, local.text, local.offset, 'import');
        if (remote) pushEdge({ source, remoteName: remote.text, remoteOffset: remote.offset, localName: local ? local.text : null, star: false, isReexport: false });
        else pushEdge({ source, remoteName: null, remoteOffset: null, localName: local ? local.text : null, star: false, isReexport: false });
        return;
      }
      if (n.type === 'namespace_import') {
        const al = n.childForFieldName('alias');
        if (al) declare(rootScope, al.text, al.startIndex, 'import');
        pushEdge({ source, remoteName: null, remoteOffset: null, localName: al ? al.text : null, star: false, isReexport: false });
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type !== 'source') walkClause(c, depth + 1);
      }
    };
    walkClause(node);
  };

  const handleExport = (node: N): void => {
    // 递归收集该 export 子树的全部 export_specifier（嵌在 export_clause 里，非直接子节点）
    const collectSpecs = (n: N, out: N[]): void => {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (!c) continue;
        if (c.type === 'export_specifier') out.push(c);
        else if (c.type !== 'source') collectSpecs(c, out);
      }
    };

    const sourceNode = node.childForFieldName('source');
    // 带 source 的 re-export（`export { a } from 'x'` / `export * from 'x'`）
    if (sourceNode) {
      const source = stripQuotes(sourceNode.text);
      // ★ `export type { A } from 'x'` / `export type * from 'x'` 同样运行时擦除 —— 用同一判据
      //   （2026-09-28：此前这里硬编码 typeOnly:false，是 type-only 知识的第二处盲区）
      const typeOnly = isTypeOnlyModuleStatement(node.text);
      const isStar = /^\s*export\s+\*(?: as [\w$]+)?\s+from/.test(node.text);
      if (isStar) {
        imports.push({ source, remoteName: null, remoteOffset: null, localName: null, typeOnly, star: true, isReexport: true });
        return; // 星号后面没有可追踪的说明符
      }
      const specs: N[] = [];
      collectSpecs(node, specs);
      for (const c of specs) {
        const ni = nameInfo(c);
        if (ni) {
          declare(rootScope, ni.text, ni.offset, 'reexport');
          exportRefs.push({ name: ni.text, offset: ni.offset, nodeType: 'value' });
          imports.push({ source, remoteName: ni.text, remoteOffset: ni.offset, localName: null, typeOnly, star: false, isReexport: true });
        }
      }
      return;
    }
    // 无 source 的 export：可能是 `export function/class/const/interface ...`（声明会被后续递归）
    // 或 `export { a }`（裸 export 列表 = 本地名引用 → exportRefs）
    const specs: N[] = [];
    collectSpecs(node, specs);
    for (const c of specs) {
      const ni = nameInfo(c);
      if (ni) {
        declare(rootScope, ni.text, ni.offset, 'exported');
        exportRefs.push({ name: ni.text, offset: ni.offset, nodeType: 'value' });
      }
    }
    // 声明类子节点交给通用递归（function_declaration 等会绑定根作用域）
  };

  const walk = (node: N, depth = 0): void => {
    if (depth > 1000) return;
    const t = node.type;

    const refType = isRefType(t);
    if (refType) {
      if (lookupIsRoot(node.text)) rootRefs.push({ name: node.text, offset: node.startIndex, nodeType: refType! });
      return;
    }

    if (t === 'import_statement') {
      handleImport(node);
      return;
    }
    if (t === 'export_statement') {
      handleExport(node);
      // 继续递归：里面可能是 function/class/interface 声明，需要绑定根作用域
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type !== 'export_specifier' && c.type !== 'export_clause' && c.type !== 'source') walk(c, depth + 1);
      }
      return;
    }
    if (t === 'import_clause' || t === 'named_imports' || t === 'namespace_import') {
      return; // import 说明符已由 handleImport 消费
    }
    if (t === 'export_specifier') {
      return; // 已由 handleExport 消费
    }

    // 声明节点：绑定名字到当前作用域，只递归其值/体，不把名字当引用
    if (FN_TYPES.has(t)) {
      const ni = nameInfo(node);
      if (ni && (t === 'function_declaration' || t === 'generator_function_declaration') && !node.text.startsWith('export default')) {
        declare(stack[stack.length - 1], ni.text, ni.offset, 'function');
      }
      // 函数体=新作用域：参数 + 体内局部
      const fnScope: ScopeMap = new Map();
      stack.push(fnScope);
      const params = node.childForFieldName('parameters');
      if (params) {
        for (let i = 0; i < params.childCount; i++) {
          const p = params.child(i);
          if (!p) continue;
          if (p.type === 'identifier') {
            // 裸标识符参数（无类型注解/解构）
            declare(fnScope, p.text, p.startIndex, 'param');
          } else {
            // 具类型参数 `p: T` / 解构：先绑定其中的参数标识符，再整段 walk 收集类型引用
            for (let j = 0; j < p.childCount; j++) {
              const idn = p.child(j);
              if (idn && idn.type === 'identifier') declare(fnScope, idn.text, idn.startIndex, 'param');
            }
            walk(p, depth + 1);
          }
        }
      }
      const body = node.childForFieldName('body') || node.childForFieldName('suite');
      if (body) walk(body, depth + 1);
      stack.pop();
      return;
    }
    if (CLASS_TYPES.has(t)) {
      const ni = nameInfo(node);
      if (ni) declare(stack[stack.length - 1], ni.text, ni.offset, 'class');
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type !== 'class_name') walk(c, depth + 1);
      }
      return;
    }
    if (t === 'interface_declaration' || t === 'type_alias_declaration') {
      const ni = nameInfo(node);
      if (ni) declare(stack[stack.length - 1], ni.text, ni.offset, t === 'interface_declaration' ? 'interface' : 'type');
      return; // 类型体内部是类型引用，交给 type_identifier 的通用处理？保守：不进入体（避免误当引用）
    }
    if (t === 'enum_declaration') {
      const ni = nameInfo(node);
      if (ni) declare(stack[stack.length - 1], ni.text, ni.offset, 'enum');
      // 枚举成员是值也是类型；此处简单跳过体（成员引用极少撞目标名，宁漏不误）
      return;
    }
    if (VAR_TYPES.has(t)) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c) continue;
        if (c.type === 'variable_declarator') {
          const nm = c.childForFieldName('name');
          const val = c.childForFieldName('value');
          const ty = c.childForFieldName('type');
          if (nm && nm.type === 'identifier') declare(stack[stack.length - 1], nm.text, nm.startIndex, 'const');
          else if (nm && isFakePatternName(nm.type)) {
            // 解构：绑定每个标识符，跳过名字子树
            for (let j = 0; j < nm.childCount; j++) {
              const idn = nm.child(j);
              if (idn && (idn.type === 'identifier' || idn.type === 'shorthand_property_identifier_pattern')) declare(stack[stack.length - 1], idn.text, idn.startIndex, 'const');
            }
          }
          // 类型注解 `: T` 也要 walk（收 type_identifier 引用）
          if (ty) walk(ty, depth + 1);
          if (val) walk(val, depth + 1);
        }
      }
      return;
    }
    if (t === 'statement_block') {
      const blockScope: ScopeMap = new Map();
      stack.push(blockScope);
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c) walk(c, depth + 1);
      }
      stack.pop();
      return;
    }
    if (FOR_TYPES.has(t)) {
      const fScope: ScopeMap = new Map();
      stack.push(fScope);
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c) continue;
        if (c.type === 'lexical_declaration' || c.type === 'variable_declaration') {
          for (let j = 0; j < c.childCount; j++) {
            const dec = c.child(j);
            if (dec && dec.type === 'variable_declarator') {
              const nm = dec.childForFieldName('name');
              if (nm && nm.type === 'identifier') declare(fScope, nm.text, nm.startIndex, 'const');
            }
          }
          continue;
        }
        walk(c, depth + 1);
      }
      stack.pop();
      return;
    }
    if (t === 'catch_clause') {
      const cScope: ScopeMap = new Map();
      stack.push(cScope);
      const param = node.childForFieldName('parameter');
      if (param) {
        for (let i = 0; i < param.childCount; i++) {
          const idn = param.child(i);
          if (idn && idn.type === 'identifier') declare(cScope, idn.text, idn.startIndex, 'catch');
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type !== 'parameter') walk(c, depth + 1);
      }
      stack.pop();
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) walk(c, depth + 1);
    }
  };

  walk(root, 0);
  return { rootOffsets, rootKinds, rootRefs, exportRefs, imports };
}
