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
 *   而 `infrastructure/analysis/project_root/index.ts`（共享工具层）却反向 import 它 —— 层次倒挂，
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
/**
 * ★★ 第⑬项 Java LanguagePack ①（2026-11-11 · 用户拍板）：**Java 纳入同一套模块级作用域解析**。
 * 表驱动的精神 = "同一机制多语言适配"——Java 的 class/interface/method 嵌套作用域与 TS 同形，
 * 走同一栈机制；差异面（import 形态 / 声明节点名）在 walk 里按语言分支。
 */
const JAVA_LANG_NAMES = new Set(['java']);

/** Java 家族扩展名（LANGUAGES 已登记 .java；这里只做"该扩展适用模块级分析"的门） */
const JAVA_EXTS = new Set(['.java']);

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
  /**
   * ★★ 2026-11-10（第⑥项 · find_references 类方法缺口）：**类方法三件套**（纯增量字段）。
   *
   * ## 为什么单开（不是塞进 rootKinds/rootRefs）
   * `Class.method` 的**定义侧**只有"归属"意义（类方法不是模块级绑定——`import { register }` 拿不到它），
   * 塞进 rootKinds 会让 rename/import 匹配的既有语义读出**假绑定**；`X.method(...)` 的**调用侧**的
   * property 节点不是根引用（它是成员访问）。⇒ 两个新数组各装各的，**纯增量**：
   * 既有消费方（rename/move/safe_rename）不读新字段，零影响。
   *
   * ## 边界（诚实）
   * `methodCalls[].receiver` 只是**调用点前缀的文本**（如 `r` / `this.registry`）——**不做接收者类型
   * 推断** ⇒ 同名方法可能命中多个类（误报方向），消费方（find_references 的 method-call 档）必须如实标注。
   */
  /** 类方法定义：`Class.method` 限定名 → 定义偏移（含 method_definition / 生成器/异步方法） */
  methodDefs: Map<string, number>;
  /** 成员调用点：`X.method(...)` 的方法名 + 接收者前缀文本 + 偏移（X 的类型不推断） */
  methodCalls: Array<{ method: string; receiver: string; offset: number }>;
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
const VAR_TYPES = new Set(['lexical_declaration', 'variable_declaration', 'module', 'local_variable_declaration']);
// ★★ Java 的局部变量声明（第⑬项 Java ①）：`String local = …` —— 形态与 TS lexical_declaration 同构
//   （type_identifier + variable_declarator）⇒ 走同一分支；不加它，`local` 会被当普通 identifier 收
//   成模块引用（误收——`name` 同理，实测 ③ 红）。`field_declaration`（类字段）走声明分支已覆盖。
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
  const isJava = JAVA_EXTS.has(ext);
  if (!isJava && !TS_EXTS.has(ext)) return null;
  const lang = findLanguageByExt(ext);
  if (!lang) return null;
  if (!isJava && !TS_LANG_NAMES.has(lang.name)) return null;
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
  // ★★ 2026-11-10（第⑥项）：类方法三件套（形状见 ModuleAnalysis.methodDefs 注释）
  const methodDefs = new Map<string, number>();
  const methodCalls: Array<{ method: string; receiver: string; offset: number }> = [];
  /** 当前正在下钻的类名栈（嵌套类/方法内再定义类时归属正确） */
  const classStack: string[] = [];
  // ★★ 2026-10-11（BD）：**前向引用**暂存 —— 本分析是**单遍**遍历，`rootScope` 由 `declare`
  //   边走边填 ⇒ 一个引用点若**词法上先于**它的模块级声明（函数提升 `f(); function f(){}`、
  //   类型/接口先行引用、模块级 const 的 TDZ 前向引用），遍历到它时根作用域**还没有那个名字**
  //   ⇒ 原先直接判"非根引用"丢弃。实测病灶：`src/application/meta/index.ts` 里 `renderHandoffPanel`
  //   定义在 891 行、调用在 504 行 ⇒ 该调用点漏收，改名后 504 行残留旧名 ⇒ 编译不过。
  //   暂存"当时任何作用域都查不到"的引用，遍历结束再按**最终**根作用域结算（见 walk(root) 之后）。
  const pendingRefs: ModuleRef[] = [];
  // ★★ 2026-10-11（BD）：**非根作用域出现过的名字**集合 —— 前向引用结算时的**安全闸**。
  //   单遍遍历下，"此刻查不到"既可能是"声明在后的模块级符号"（要收），也可能是"局部绑定但声明
  //   还没走到"（**不能收**：那处引用指的是局部，收了就会把局部名当模块符号改掉 = 改错东西）。
  //   本集合把**任何非根作用域里绑定过的名字**都记下来，结算时排除 ⇒ 宁可漏收，绝不误收
  //   （与本源文件一贯的"宁漏不误"一致）。局部绑定**不止** `declare` 覆盖的那些：解构默认值/
  //   重命名/剩余项（`{ a = 1 }`·`{ k: v }`·`...r`）此前**根本没登记**（本源文件既有的登记缺口），
  //   故另配 `collectPatternNames` 把这类模式里的绑定名也补进本集合。
  const nonRootBindings = new Set<string>();
  const exportRefs: ModuleRef[] = [];
  const imports: ImportEdge[] = [];

  const rootScope: ScopeMap = rootOffsets as ScopeMap;
  const stack: ScopeMap[] = [rootScope];

  const declare = (scope: ScopeMap, name: string, offset: number, kind: string): void => {
    if (scope !== rootScope) nonRootBindings.add(name);
    if (!scope.has(name)) scope.set(name, offset);
    if (scope === rootScope && !rootKinds.has(name)) rootKinds.set(name, kind);
  };

  // 把解构模式里的**绑定名**补进 `nonRootBindings`（只登记名字、不进作用域，故不改变既有分类；
  // 仅用于前向引用结算的安全闸）。覆盖：裸标识符 / 简写 / `k: v`（pair_pattern 的 value）/
  // `a = 1`（assignment_pattern·object_assignment_pattern 的 left）/ `...r`（rest_pattern）/
  // 具名与可选形参（required_parameter·optional_parameter 的 pattern）/ 嵌套 object·array。
  // ★ 刻意**不下钻默认值右值**（`= expr`）：那是引用、不是绑定，下钻会把表达式里的名字误当绑定名。
  const collectPatternNames = (n: N): void => {
    const t = n.type;
    if (t === 'identifier' || t === 'shorthand_property_identifier_pattern') {
      nonRootBindings.add(n.text);
      return;
    }
    if (t === 'required_parameter' || t === 'optional_parameter') {
      const p = n.childForFieldName('pattern');
      if (p) collectPatternNames(p);
      return;
    }
    if (t === 'object_assignment_pattern' || t === 'assignment_pattern') {
      const l = n.childForFieldName('left');
      if (l) collectPatternNames(l);
      return;
    }
    if (t === 'pair_pattern') {
      const v = n.childForFieldName('value');
      if (v) collectPatternNames(v);
      return;
    }
    if (t === 'rest_pattern' || t === 'object_pattern' || t === 'array_pattern') {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) collectPatternNames(c);
      }
    }
  };

  // 沿作用域栈解析到**最近**的同名绑定，返回它在栈中的下标（0 = 根作用域）；
  // 任何作用域都没有 ⇒ -1（"暂时查不到" —— 可能是全局名，也可能是**声明在后的前向引用**）。
  const lookupScope = (name: string): number => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].has(name)) return i;
    }
    return -1;
  };

  const handleImport = (node: N): void => {
    const source = stripQuotes(fieldText(node, 'source'));
    // ★ type-only 判定收敛到内核唯一实现（2026-09-28）：此前本行与 kernel.ts 各有一份
    //   逐字相同的 `/^\s*import\s+type\b/`，于是 `export type … from` 的盲区在两处各存活一次。
    const typeOnly = isTypeOnlyModuleStatement(node.text);
    const pushEdge = (e: Omit<ImportEdge, 'typeOnly'>) => imports.push({ ...e, typeOnly });

    // ── ★★ 已知缺口（2026-10-06 按 T33 的实测登记在此 —— **故意不修**，理由与触发条件见下）──
    //  · **默认导入的本地名不进 `rootOffsets`**：`import fs from 'node:fs'` 的 `fs`
    //    （tree-sitter 里它是 `import_clause` 的**裸 `identifier`**，既不是 `import_specifier`
    //     也不是 `namespace_import` ⇒ 本函数从不 declare 它）；`import * as ns from 'x'` 的 `ns` 同理，
    //     且那是**语法事实**而非笔误：tree-sitter-typescript 的 `namespace_import` 规则是
    //     `seq('*', 'as', $.identifier)` ⇒ **没有命名字段** ⇒ 下面 `childForFieldName('alias')` **恒取 null**。
    //    ⇒ 实测面：**186/317 文件**的 `rootOffsets` 缺导入本地名
    //      （default 缺 **348** 个、namespace 别名缺 **2** 个；named 缺 **0**）。
    //  · ★ **为什么现在不修**（T33 已量化 —— 别凭"看着不对"就改）：全仓**读 `rootOffsets` 的只有 2 处**
    //    —— `find_references.ts` 的 `def.rootOffsets.get(symbol!) ?? 0` 与
    //    `rename_symbol/languages/ts.ts` 的 `def.rootOffsets.get(symbol)!`；而 `symbol` 是
    //    **用户指定要改名的那个符号名**，它**绝不会是"从别处 import 进来的本地名"**
    //    （`rename_symbol` 那条路已有拒绝逻辑挡着：`… 在 x.ts 中是 import 绑定而非声明，
    //    请在它的定义文件上发起改名`）⇒ **缺的那些名字走不到这两处**。
    //    ⇒ 修它是**行为变更**（多填 map 条目）却**买不到观测收益** = 本仓说的**过度改动**。
    //  · ★ **触发条件**（满足其一就该修，那时它是真缺陷）：
    //      (a) 出现**按名字查询**的消费者（如"这个文件里有没有 `fs` 这个名字"）；
    //      (b) 出现**遍历 `rootOffsets`** 的逻辑（多填条目会直接改变其结果）。
    //    ★ 届时按**行为变更单独验收**，且**别与 T26 混做**（T26 只求"消掉那条环"，求的不是"分析器对不对"）。
    // ─────────────────────────────────────────────

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
    const before = imports.length;
    walkClause(node);
    // ★★ 2026-10-06（T33 里"优先级更高"的那条）：**纯 side-effect import 也要建边**。
    //   形态：`import './register_capabilities.js'`（无 import_clause）—— 上面的 walkClause
    //   找不到任何说明符 ⇒ 原先**一条边都不建**。
    //   ★ 但它是**真实的依赖边**（引它就是为了执行副作用），且 `parseFileFull` 那边**本来就有**：
    //   `kernel.extractImportSources` 走表项 `importSourceField`，**只要语句有 `source` 字段就返回一条**
    //   ⇒ 两边口径不一致，正是本仓头号病根「判据分叉」的又一实例。
    //   ★ 实测差异面（317 个候选文件逐文件对差集）：**只有 2 个** ——
    //   `infrastructure/parse/lang_hint.ts` · `presentation/cli/capability_cli.ts`，
    //   各缺一条 `register_capabilities.js` 副作用边。
    if (imports.length === before) {
      pushEdge({ source, remoteName: null, remoteOffset: null, localName: null, star: false, isReexport: false });
    }
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
      const scopeIdx = lookupScope(node.text);
      if (scopeIdx === 0) rootRefs.push({ name: node.text, offset: node.startIndex, nodeType: refType! });
      // scopeIdx === -1：此刻任何作用域都查不到 —— 不急着丢，先暂存，遍历结束后按最终根作用域结算。
      // 三态互斥：==0 根引用（直接收）· >0 被局部遮蔽（既非根也非前向，丢弃）· ==-1 暂存待结算。
      else if (scopeIdx === -1) pendingRefs.push({ name: node.text, offset: node.startIndex, nodeType: refType! });
      return;
    }

    // ★★★ 2026-10-27（T-#64）：**动态 import 也是一等公民**（在解析期就记成 `imports` 行）。
    //
    // ## 病史（结构性）
    // `imports.kind` 只有 `relative` / `package` —— 而这两者描述的是 **source 的形态**，
    // **不是"静态/动态"** ⇒ 动态 import **本该也能记进来**，却**从来没被抽过**。
    // 后果：`const { saveDSL } = await import('../../dist/src/storage.js')` 的 `saveDSL`
    // 在索引里**没有绑定** ⇒ 裸名解析判 `boundByName=false` ⇒ **永远 failed**（实测 12 条）。
    //
    // ## 当时的绕法（本次删掉）
    // `symbols.dynamicImportsOf()` —— 一个**事后文本正则扫描**，脆且**与索引两套尺**。
    //
    // ## 现在
    // 在这里按 `ImportEdge` 的**真实形状**（一条绑定一行）记下来 ⇒
    // **同一张绑定表**同时服务静态与动态导入。
    if (t === 'call_expression') {
      // ★★ 2026-11-10（第⑥项）：**成员调用点收集**（`X.method(...)`）——纯增量。
      //   只记形状（方法名 + 接收者前缀文本 + 偏移），**不做接收者类型推断**（诚实边界，见
      //   ModuleAnalysis.methodCalls 注释）；`X.y.method` 取整段前缀，消费方自行取末段。
      const fn = node.childForFieldName('function');
      if (fn && fn.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        if (prop && prop.type === 'property_identifier' && /^[A-Za-z_$][\w$]*$/.test(prop.text)) {
          const obj = fn.childForFieldName('object');
          methodCalls.push({ method: prop.text, receiver: obj ? obj.text : '', offset: prop.startIndex });
        }
      }
      if (fn && (fn.type === 'import' || fn.text === 'import')) {
        const args = node.childForFieldName('arguments');
        // ★ 取第一个**非括号**子节点（同 kernel：`arguments` 的 children 含 `(` / `)` token）
        let srcNode: N | null = null;
        if (args) {
          for (let i = 0; i < args.childCount; i++) {
            const c = args.child(i);
            if (!c) continue;
            if (c.type === '(' || c.type === ')' || c.type === ',') continue;
            srcNode = c;
            break;
          }
        }
        const src = srcNode ? stripQuotes(srcNode.text) : '';
        if (src) {
          // 绑定名：`const { a, b } = await import(…)` ⇒ 解构里的名字（`N` 未声明 parent ⇒ 显式窄化）
          const bindings: string[] = [];
          let p = (node as unknown as { parent?: N }).parent;
          if (p && p.type === 'await_expression') p = (p as unknown as { parent?: N }).parent;
          if (p && p.type === 'variable_declarator') {
            const nm = p.childForFieldName('name');
            const collect = (x: N): void => {
              if (x.type.includes('identifier') || x.type === 'shorthand_property_identifier_pattern') {
                if (/^[A-Za-z_$][\w$]*$/.test(x.text)) bindings.push(x.text);
                return;
              }
              for (let k = 0; k < x.childCount; k++) {
                const c = x.child(k);
                if (c) collect(c);
              }
            };
            if (nm) collect(nm);
          }
          // ★ 一条绑定一行（与静态 import 同形）；无绑定（裸 `import('x')`）也要记一条，
          //   否则「这个文件依赖了 x」这条事实会丢。
          const names = bindings.length > 0 ? bindings : [null];
          for (const nm of names) {
            // ★ 直接 push（`pushEdge` 是 `handleImport` 里的局部闭包，`walk` 作用域里没有）
            imports.push({
              source: src,
              remoteName: null,
              remoteOffset: null,
              localName: nm,
              typeOnly: false,
              star: false,
              isReexport: false,
            });
          }
        }
      }
      // ★ 不 return：参数里还可能有引用/嵌套调用，继续走通用递归
    }

    if (t === 'import_declaration') {
      // ★★ Java 的 import（第⑬项 Java ①）：`import com.example.B;` / `import static x.Y.z;` / `import com.foo.*;`
      //   映射到 ImportEdge：source=全限定路径（remoteName=末段或 *）；localName=末段（Java 无 import 别名）。
      //   ★ remoteOffset=null：Java 的 import 末段**就是**使用名（无别名机制）⇒ 改名时 remote 与 local 同改。
      //   ★ **declare 进根作用域**（与 TS handleImport 的 import_specifier 同语义）——否则
      //     `List.of(local)` 的 List 引用 lookupScope 落 pendingRefs、结算时根作用域没名字 ⇒ 丢
      //     （实测 ③ 红：List refs 0。import 本地名不是"从别处 import 的本地名"那条拒绝逻辑管的
      //     "用户要改名的符号"——Java 场景它是引用收集的关键绑定）。
      const text = node.text.replace(/^import\s+(static\s+)?/, '').replace(/;$/, '').trim();
      if (text) {
        const star = text.endsWith('.*');
        const source = star ? text.slice(0, -2) : text;
        const lastSeg = source.split('.').pop() ?? null;
        const firstChild = node.child(0); // `import` 关键字后面的路径节点起点（偏移锚）
        if (!star && lastSeg) {
          // 偏移：source 文本里 lastSeg 的起点（`import java.util.List;` 里 List 的绝对偏移）
          const segOffset = node.startIndex + node.text.lastIndexOf(lastSeg);
          declare(rootScope, lastSeg, segOffset, 'import');
        }
        imports.push({
          source,
          remoteName: star ? '*' : lastSeg,
          remoteOffset: null,
          localName: star ? null : lastSeg,
          typeOnly: false,
          star,
          isReexport: false,
        });
      }
      return;
    }
    if (t === 'package_declaration') {
      return; // 包声明不是绑定也不是引用
    }
    // ★★ Java 的方法调用（第⑬项 Java ①）：`helper.format(1)` ⇒ method_invocation{name, object}。
    //   与 TS 的 call_expression/member_expression 同语义（接收者前缀 + 方法名），字段名不同 ⇒ 单独分支。
    if (t === 'method_invocation') {
      const nameN = node.childForFieldName('name');
      const objN = node.childForFieldName('object');
      if (nameN && objN && /^[A-Za-z_$][\w$]*$/.test(nameN.text)) {
        methodCalls.push({ method: nameN.text, receiver: objN.text, offset: nameN.startIndex });
      }
      // 不 return：object 里可能还有引用/嵌套调用，继续走通用递归
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
      // ★★ 2026-11-10（第⑥项）：**方法定义 → `Class.method` 限定名归属**（最小形态，不做修饰符/可见性）。
      //   `method_definition` 只出现在类体里 ⇒ classStack 栈顶就是归属类；`name` 字段 = 方法名。
      if (t === 'method_definition' && ni && classStack.length > 0) {
        const qualified = `${classStack[classStack.length - 1]}.${ni.text}`;
        if (!methodDefs.has(qualified)) methodDefs.set(qualified, ni.offset);
      }
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
          collectPatternNames(p); // 形参（含解构默认值/重命名/剩余项）里的绑定名 → 安全闸
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
      // ★★★ 2026-10-27（T-#97a）：**返回类型 / 泛型参数也要 walk** —— 原先只走「形参 + 体」。
      //
      // ## 病史（用本仓工具改本仓时自己撞出来的）
      // `const globalsOf = (r: string): ReturnType<typeof mergeGlobals> => {…}`
      // ⇒ `return_type` 字段（`type_annotation`）**没人走** ⇒ `typeof mergeGlobals` 里的 identifier
      //   既不进 `rootRefs`、也不会被 rename 改 ⇒ **4 处只改 3 处，typecheck 红**
      //   （实测 `error TS2304: Cannot find name 'mergeGlobals'`）。
      // 同族还有：`function f(): Map<Foo, Bar>` 的 `Foo`/`Bar`、`<T extends Base>` 的 `Base`
      //   —— 全是**类型位置的引用**，一律漏。⇒ 一次补齐三个字段：`return_type` / `type_parameters` / `type`。
      for (const f of ['return_type', 'type_parameters', 'type'] as const) {
        const tn = node.childForFieldName(f);
        if (tn) walk(tn, depth + 1);
      }
      const body = node.childForFieldName('body') || node.childForFieldName('suite');
      if (body) walk(body, depth + 1);
      stack.pop();
      return;
    }
    if (CLASS_TYPES.has(t)) {
      const ni = nameInfo(node);
      if (ni) declare(stack[stack.length - 1], ni.text, ni.offset, 'class');
      // ★★ 2026-11-10（第⑥项）：下钻类体期间维护类名栈 ⇒ 方法定义归到 `Class.method`
      if (ni) classStack.push(ni.text);
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type !== 'class_name') walk(c, depth + 1);
      }
      if (ni) classStack.pop();
      return;
    }
    // ★★ Java 的类/接口/枚举/注解声明（第⑬项 Java ①）：与 TS 的 CLASS_TYPES 同形处理——
    //   绑定名字到当前作用域 + 维护类名栈（方法归属 `Class.method`）+ 下钻类体收成员引用。
    //   ★ Java 的类名引用走 `type_identifier`（与 TS 同形，isRefType 已覆盖）⇒ 泛型 `List<String>`
    //     的 `String` 也是 type_identifier ⇒ 按普通类型引用收（宁收不漏；rename 时它是否改取决于
    //     是否命中同名模块符号——与 TS 的泛型行为一致）。
    if (t === 'class_declaration' || t === 'interface_declaration' || t === 'enum_declaration' || t === 'annotation_type_declaration') {
      const ni = nameInfo(node);
      if (ni) declare(stack[stack.length - 1], ni.text, ni.offset, t === 'class_declaration' ? 'class' : t === 'interface_declaration' ? 'interface' : t === 'enum_declaration' ? 'enum' : 'annotation');
      if (ni) classStack.push(ni.text);
      // Java 声明的 modifiers/superclass/interfaces 里的 type_identifier 也要收（extends/implements）
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c) continue;
        if (c.type === 'identifier' && ni && c.text === ni.text) continue; // 声明名本身不当引用
        walk(c, depth + 1);
      }
      if (ni) classStack.pop();
      return;
    }
    // ★ Java 方法/构造器（method_declaration / constructor_declaration）：与 TS FN_TYPES 同形——
    //   方法名归 `Class.method`（classStack 栈顶）；形参/返回类型/方法体走同一栈机制。
    if (t === 'method_declaration' || t === 'constructor_declaration') {
      const ni = nameInfo(node);
      if (ni && classStack.length > 0) {
        const qualified = `${classStack[classStack.length - 1]}.${ni.text}`;
        if (!methodDefs.has(qualified)) methodDefs.set(qualified, ni.offset);
      }
      const fnScope: ScopeMap = new Map();
      stack.push(fnScope);
      const params = node.childForFieldName('parameters');
      if (params) {
        for (let i = 0; i < params.childCount; i++) {
          const p = params.child(i);
          if (!p) continue;
          if (p.type === 'formal_parameter' || p.type === 'spread_parameter') {
            // Java 形参：`Type name` ⇒ 最后一个 identifier 是参数名，前面的 type_identifier 是类型引用
            const parts: N[] = [];
            for (let j = 0; j < p.childCount; j++) {
              const c = p.child(j);
              if (c) parts.push(c);
            }
            const idents = parts.filter((c) => c.type === 'identifier');
            // 形参名 = 最后一个 identifier（type_identifier 不是 identifier ⇒ 不会混入）
            const nameNode = idents[idents.length - 1];
            if (nameNode) declare(fnScope, nameNode.text, nameNode.startIndex, 'param');
            // 类型部分走 walk（type_identifier 收为引用）
            for (const c of parts) {
              if (c !== nameNode && c.type !== 'modifier') walk(c, depth + 1);
            }
          } else {
            walk(p, depth + 1);
          }
        }
      }
      for (const f of ['type', 'type_parameters', 'dimensions'] as const) {
        const tn = node.childForFieldName(f);
        if (tn) walk(tn, depth + 1);
      }
      const body = node.childForFieldName('body');
      if (body) walk(body, depth + 1);
      stack.pop();
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
      // ★★ Java 差异（第⑬项 Java ① 实测）：**类型在 declaration 上，不在 declarator 上**——
      //   TS：`const x: T = …`（type 字段在 variable_declarator）；Java：`T x = …`（type 字段在
      //   local_variable_declaration / field_declaration 本身）。⇒ declaration 级先 walk 一次 type，
      //   declarator 级再 walk type（TS 形态，null 时无害）——两个位置都收，谁有走谁。
      const declType = node.childForFieldName('type');
      if (declType) walk(declType, depth + 1);
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c) continue;
        if (c.type === 'variable_declarator') {
          const nm = c.childForFieldName('name');
          const val = c.childForFieldName('value');
          const ty = c.childForFieldName('type');          if (nm && nm.type === 'identifier') declare(stack[stack.length - 1], nm.text, nm.startIndex, 'const');
          else if (nm && isFakePatternName(nm.type)) {
            // 解构：绑定每个标识符，跳过名字子树
            for (let j = 0; j < nm.childCount; j++) {
              const idn = nm.child(j);
              if (idn && (idn.type === 'identifier' || idn.type === 'shorthand_property_identifier_pattern')) declare(stack[stack.length - 1], idn.text, idn.startIndex, 'const');
            }
            // ★ 上面的 declare 只覆盖"裸标识符 / 简写"两种形态；解构默认值·重命名·剩余项
            //   （`{ a = 1 }` · `{ k: v }` · `...r`）此前**没登记**。本作用域非根时补进安全闸
            //   （根作用域的解构名是**模块级**符号，不该进闸 ⇒ 排除）。
            if (stack[stack.length - 1] !== rootScope) collectPatternNames(nm);
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
              else if (nm) collectPatternNames(nm); // `for (const { a = 1 } of xs)` 等解构绑定 → 安全闸
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
        collectPatternNames(param); // `catch ({ e })` 等解构绑定 → 安全闸
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
  // 结算前向引用：此刻根作用域已含**全部**模块级声明 —— 引用点当时"任何作用域都查不到"的名字，
  // 若最终落在根作用域**且从未在任何非根作用域绑定过**，才判为"声明在后的模块级符号"的前向引用。
  // ★ 后一条闸（`nonRootBindings`）挡的是误收：那处"查不到"可能只是**局部绑定还没遍历到**
  //   （如 `const { direction = … } = input` 的 `direction`，本源文件此前**没登记**这类解构绑定）
  //   ⇒ 若不挡，`rename_symbols` 会把那个局部名当模块符号一起改掉 = 改错东西。宁漏不误。
  for (const r of pendingRefs) if (rootScope.has(r.name) && !nonRootBindings.has(r.name)) rootRefs.push(r);
  // 前向引用是**后补**的 ⇒ 按偏移排序，恢复"跟随源码顺序"的稳定次序（下游 find_references 直接原序输出）。
  rootRefs.sort((a, b) => a.offset - b.offset);
  return { rootOffsets, rootKinds, rootRefs, exportRefs, imports, methodDefs, methodCalls };
}
