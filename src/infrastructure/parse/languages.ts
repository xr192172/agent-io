/**
 * Tree-sitter Kernel - 语言注册表
 *
 * 元数据：ext → npm 包名 + tree-sitter 节点类型 → 我们的 ParsedSymbol 字段
 * 来源：tree-sitter 官方 https://github.com/tree-sitter/tree-sitter (150+ 语言)
 *
 * 注释：
 *   - name: 语言的 npm 包名
 *   - ext: 支持的文件扩展名（含 .）
 *   - symbol_query: 用于识别该语言中"符号节点"的 tree-sitter 节点类型列表
 *   - signature_template: 字段提取模板，{name} 占位符
 *
 * 探测逻辑（probe.ts）会扫描 node_modules/tree-sitter-* 找出已安装的，
 * kernel 自动只对已安装的语言启用解析。
 *
 * ★★ `kind`（2026-09-29）—— 本表新增的一个维度，回答的问题与上面那几条**不同**：
 *   不是"我能不能解析它"（那是 probe 的 `isExtSupported`），而是"**它算不算源码**"。
 *   消费方 = `source_exts.ts` 的「代码语言」权威（`isCodeLangExt` / `codeSourceExts`），
 *   目前落点是 `health`（体检）/ `impact`（影响面）—— 它们此前拿"已装语言包"当"什么算源码"，
 *   于是 `package.json`（`.json` 真能被 tree-sitter-json 载入）被报成"孤立模块 / 待清理 dead code"。
 *
 *   判据（**可判定、可复核**，不是"手抄一张要排除的清单"）：
 *     `code` —— 该语言的文件是**程序**：语法里有"**会被求值的定义**"（函数 / 方法 / 过程 /
 *               模块 / 规则体 …），或存在**调用 / 依赖**概念 ⇒ 进符号索引、可算孤儿、该体检。
 *     其余四类 —— 文件是被程序读的**素材**：结构化数据 / 标记结构 / 呈现样式 / 文档，
 *               语法里**没有"会被求值的定义"**，也没有调用边 ⇒ 不进符号索引、不报孤儿。
 *   ⇒ 这条判据与 `docs/adding-a-language.md` §4.2 的「非代码文件（css/html/json/yaml/toml/xml/
 *     markdown/latex…）」**同一口径**，本字段只是把它变成**可枚举的数据**。
 *
 *   ★ 加新语言时**只加数据**（在此填一个 `kind`），不再往任何工具里散落 if —— 与本仓
 *     "内核去按语言 if"的纪律一致（见 `dev` 提交 `2301041`）。
 *   ★ 灰区（`graphql`/`protobuf`/`sql`/`rego`/`cue`）判为 `code`：它们是**声明/查询语言**，
 *     与 `.d.ts` 同类 —— 开发者手写、随代码版本演进、被代码消费，不是"被程序读的素材"。
 *     这是**判断**、不是实测（本机未装这 5 门，对行为无影响）；要翻案改这一个字段即可。
 */

/** 语言类别 —— 决定该语言的文件算不算「源码」（判据见上方模块注释的 `kind` 一节）。 */
export type LangKind = 'code' | 'data' | 'markup' | 'style' | 'doc';

export interface LanguageEntry {
  /** 语言显示名（go / typescript / ...） */
  name: string;
  /**
   * npm 包名。**默认按 `tree-sitter-{pkg}` 派生**（见 loader）。
   * ★★ 2026-10-08：派生在「**一门语法住在别人的包里**」时表达不出来 —— 那种情况用下面的 `pkgSpec`。
   */
  pkg: string;
  /**
   * ★★ 2026-10-08 新增：**显式模块说明符**（覆盖 `tree-sitter-{pkg}` 的派生）。
   *
   * 为什么必须有（实测）：`tsx` / `jsx` **不是独立的 npm 包** ——
   *   · TSX 语法住在 `tree-sitter-typescript` 里（该包同时导出 `typescript` 与 `tsx`）；
   *   · JSX 语法就在 `tree-sitter-javascript` 里。
   * 而派生名会去找 `tree-sitter-tsx` / `tree-sitter-jsx`（**两个都不存在**）⇒
   *   这两个扩展名**永远解析不出来**（且被静默归入 unknown，看不见）。
   * ★ 派生是「约定/猜测」，显式是「事实」——**猜不出来的时候必须能写下来**。
   */
  pkgSpec?: string;
  /** 支持的文件扩展名（含 .） */
  exts: string[];
  /** ★ 语言类别：`code` = 算源码；`data`/`markup`/`style`/`doc` = 不算（判据见模块注释） */
  kind: LangKind;
  /** tree-sitter 节点类型，对应"符号定义" */
  symbol_nodes: string[];
  /** tree-sitter 节点类型，对应"import 声明"（可选，用于依赖提取） */
  import_nodes?: string[];
  /** 字段名映射（tree-sitter 字段 → ParsedSymbol 字段） */
  field_map: {
    name: string;
    parameters?: string;
    body?: string;
    return_type?: string;
    receiver?: string;
  };
}

/** 150+ 语言注册表（npm 包名已与官方仓库对齐） */
export const LANGUAGES: LanguageEntry[] = [
  // === Web/JS 生态 ===
  // TS 符号宇宙 v6 扩容：type_alias/enum/abstract class 进 nodes——
  // 跨文件 type_ref 解析（resolveCrossFileCalls 的 typeNamesByFile 只认
  // interface/type/class 节点）此前定位不到 type alias，dead_deps live 集
  // 永远缺它们 → 剪刀误剪（ua_theme_engine 的 PresetId/HeadingFont 实证）
  // ★ 2026-10-04 补全：`.mts`（ESM）/`.cts`（CJS）是 tree-sitter-typescript 同一套语法的
  //   模块扩展名，与 `.ts` 同类。此前注册表只写 `['.ts']`，靠 `source_exts.ts` 的 `TS_JS_EXTS`
  //   保底才没在 `SOURCE_EXTS` 里丢文件；但 `findLanguageByExt`/`isExtSupported`/`listSupportedExts`
  //   走的是**本注册表** ⇒ 这两类文件此前对内核"不受支持"。补进注册表后口径一致（见 source_exts.ts 注释）。
  { name: 'typescript', pkg: 'typescript', exts: ['.ts', '.mts', '.cts'], kind: 'code', symbol_nodes: ['function_declaration', 'class_declaration', 'abstract_class_declaration', 'interface_declaration', 'type_alias_declaration', 'enum_declaration', 'method_definition'], import_nodes: ['import_statement', 'export_statement'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  { name: 'tsx', pkg: 'tsx', pkgSpec: 'tree-sitter-typescript', exts: ['.tsx'], kind: 'code', symbol_nodes: ['function_declaration', 'class_declaration', 'abstract_class_declaration', 'interface_declaration', 'type_alias_declaration', 'enum_declaration', 'method_definition'], import_nodes: ['import_statement', 'export_statement'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  { name: 'javascript', pkg: 'javascript', exts: ['.js', '.mjs', '.cjs'], kind: 'code', symbol_nodes: ['function_declaration', 'class_declaration', 'method_definition'], import_nodes: ['import_statement', 'export_statement'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'jsx', pkg: 'jsx', pkgSpec: 'tree-sitter-javascript', exts: ['.jsx'], kind: 'code', symbol_nodes: ['function_declaration', 'class_declaration', 'method_definition'], import_nodes: ['import_statement', 'export_statement'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'vue', pkg: 'vue', exts: ['.vue'], kind: 'code', symbol_nodes: ['export_statement'], field_map: { name: 'name' } },
  { name: 'html', pkg: 'html', exts: ['.html', '.htm'], kind: 'markup', symbol_nodes: ['script_element'], field_map: { name: 'name' } },
  { name: 'css', pkg: 'css', exts: ['.css'], kind: 'style', symbol_nodes: ['rule_set'], field_map: { name: 'name' } },
  { name: 'scss', pkg: 'scss', exts: ['.scss'], kind: 'style', symbol_nodes: ['rule_set'], field_map: { name: 'name' } },
  { name: 'less', pkg: 'less', exts: ['.less'], kind: 'style', symbol_nodes: ['rule_set'], field_map: { name: 'name' } },

  // === 后端语言 ===
  { name: 'go', pkg: 'go', exts: ['.go'], kind: 'code', symbol_nodes: ['function_declaration', 'method_declaration', 'type_declaration', 'type_spec'], import_nodes: ['import_spec'], field_map: { name: 'name', parameters: 'parameters', return_type: 'result', receiver: 'receiver' } },
  { name: 'python', pkg: 'python', exts: ['.py'], kind: 'code', symbol_nodes: ['function_definition', 'class_definition'], import_nodes: ['import_statement', 'import_from_statement'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  { name: 'java', pkg: 'java', exts: ['.java'], kind: 'code', symbol_nodes: ['class_declaration', 'method_declaration', 'interface_declaration'], import_nodes: ['import_declaration'], field_map: { name: 'name', parameters: 'parameters', return_type: 'type' } },
  { name: 'c', pkg: 'c', exts: ['.c', '.h'], kind: 'code', symbol_nodes: ['function_definition', 'struct_specifier'], import_nodes: ['preproc_include'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'cpp', pkg: 'cpp', exts: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], kind: 'code', symbol_nodes: ['function_definition', 'class_specifier', 'struct_specifier', 'namespace_definition'], import_nodes: ['preproc_include'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'c_sharp', pkg: 'c-sharp', exts: ['.cs'], kind: 'code', symbol_nodes: ['class_declaration', 'method_declaration', 'interface_declaration'], import_nodes: ['using_directive'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'rust', pkg: 'rust', exts: ['.rs'], kind: 'code', symbol_nodes: ['function_item', 'struct_item', 'impl_item', 'trait_item'], import_nodes: ['use_declaration'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  // ★ 2026-09-29 实测校准：symbol_nodes 的 class_declaration/function_declaration **本来就与
  //   tree-sitter-kotlin 的 node-types 对得上**（该 grammar 里两者都是 named 节点）——
  //   kotlin 此前提不出符号的真正原因是 kernel 侧三处"有字段"假设（见 kernel.ts: extractName /
  //   findBodyNode / extractCallee）。本次顺带把 object_declaration（单例 object）纳入符号；
  //   import_nodes=import_header 为专用 import 节点（`import a.b.C as D`）。
  { name: 'kotlin', pkg: 'kotlin', exts: ['.kt', '.kts'], kind: 'code', symbol_nodes: ['class_declaration', 'function_declaration', 'object_declaration'], import_nodes: ['import_header'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'swift', pkg: 'swift', exts: ['.swift'], kind: 'code', symbol_nodes: ['function_declaration', 'class_declaration'], field_map: { name: 'name', parameters: 'parameters' } },
  // ★ ruby 无 import_nodes：tree-sitter-ruby 没有"import 声明"节点 —— `require 'x'` 就是普通
  //   `call`（见 kernel.ts: LANG_ADAPTERS.ruby 注释）。调用边已通（callNode='call'）。
  { name: 'ruby', pkg: 'ruby', exts: ['.rb'], kind: 'code', symbol_nodes: ['method', 'class', 'module'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'php', pkg: 'php', exts: ['.php'], kind: 'code', symbol_nodes: ['function_definition', 'method_declaration', 'class_declaration'], import_nodes: ['namespace_use_declaration'], field_map: { name: 'name', parameters: 'parameters' } },
  // ★ 2026-09-29 校准：旧表项的 `def_definition` 在 tree-sitter-scala 里**根本不存在**
  //   （该 grammar 的真名是 function_definition / function_declaration）。实测（0.24.0，
  //   `node-node-types.json` + 真跑）：function_definition/class_definition/object_definition/
  //   trait_definition/enum_definition/type_definition 都带 name 字段，且函数带 body/parameters/return_type
  //   ⇒ 走通用"有字段"路径即可，不需要任何专属适配（适配器只补 callNode + object 的 kind 覆盖）。
  //   ★ 2026-09-29 补 import 边（本笔）：import_declaration 是**专用** import 节点
  //   （grammar.js L224：`import` + sep1(',', $._namespace_expression)）。同形另有 export_declaration
  //   （L227，Scala 3 再导出）——它的源是同一个 namespace_expression，是等价的**依赖方向**
  //   ⇒ 一并纳入（与 TS 系把 export_statement 计入 import_nodes 同一判据）。
  //   ★ 拒绝纳入的形态（别"顺手加"）：`using`/`given` 不是 import；`namespace_selectors`
  //   花括号里的是**被引入的名字**（`{Try, Success}`），不是模块源 —— 见 kernel.ts 的提取器。
  { name: 'scala', pkg: 'scala', exts: ['.scala', '.sc'], kind: 'code', symbol_nodes: ['function_definition', 'function_declaration', 'class_definition', 'object_definition', 'trait_definition', 'enum_definition', 'type_definition'], import_nodes: ['import_declaration', 'export_declaration'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  // ★ 2026-09-29 校准：旧表项的 `class_definition` 在 tree-sitter-groovy 里**不存在**
  //   （真名 class_declaration）。实测（0.1.2）：method_declaration/class_declaration 都带
  //   name/body 字段（方法的返回类型在 `type` 字段）；脚本级 `String f(){}` 是 function_definition。
  //   ★ 2026-09-29 补 import 边（本笔）：import_declaration（grammar.js L131）——
  //   `import [static] a.b.C [as D]` / `import a.b.*`。★ 与 Java 同族（scoped_identifier 链）。
  { name: 'groovy', pkg: 'groovy', exts: ['.groovy'], kind: 'code', symbol_nodes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'method_declaration', 'function_definition'], import_nodes: ['import_declaration'], field_map: { name: 'name', parameters: 'parameters', return_type: 'type' } },
  // ★ 2026-09-29 新增：实测（elixir 0.3.5）该语法里 **`def`/`defmodule` 自己就是 `call`**
  //   ⇒ 符号节点只能是 `call`，靠适配器的 symbolDispatch（target ∈ def/defp/defmodule/…）
  //   把"声明"与"普通调用"分开；名字走 namePaths、体走 bodyNodeTypes=['do_block']。
  //   旧表项 ['call','do_block'] 会把 defmodule/def/内层名全当符号（实测 8 条里 6 条是垃圾）。
  //   ★ 2026-09-29（本笔）**仍然无 import_nodes，这是核查后的结论、不是遗漏**：
  //   tree-sitter-elixir 0.3.5 的 node-types.json 里**没有** import/require/alias/use 节点类型
  //   （只有 `call` 与模块名 token `alias`）—— `import Helper` / `alias App.Helper` /
  //   `require Logger` / `use GenServer` **全都是普通 `call`**（target 字段的 identifier）。
  //   把 `call` 声明成 import_nodes 有两个后果，都不可接受：
  //     ① 类别错误：每次函数调用都成了 import 候选（与 ruby 的 `require` 同一情形，见下条）；
  //     ② 实测的**机制**后果：`traverseAndExtractImports` 命中 import_nodes 即 `return`（不再下滑），
  //        而 `defmodule … do … end` 自身就是 call ⇒ 模块体内的 import **永远扫不到**。
  //   ⇒ 要接 elixir，得先给 LANG_ADAPTERS 扩一个「按某字段的**值**分派 import」的数据字段
  //     （形如已有的 `symbolDispatch`，那正是 elixir 符号侧用的同一机制），并让上述 return 改为
  //     "命中但无源 ⇒ 继续下滑"。本笔**未做**（见提交信息「没验什么」），故不声明。
  { name: 'elixir', pkg: 'elixir', exts: ['.ex', '.exs'], kind: 'code', symbol_nodes: ['call'], field_map: { name: 'name' } },
  { name: 'erlang', pkg: 'erlang', exts: ['.erl', '.hrl'], kind: 'code', symbol_nodes: ['function_clause'], field_map: { name: 'name' } },
  // ★ 2026-09-29 新增：实测（haskell 0.23.1）函数体在 **match** 字段（局部绑定在 binds），
  //   旧内核只认 'body'/'suite' ⇒ 下不了体 ⇒ 调用边恒空。真节点名是 function/bind（不是
  //   旧表项的 function_declaration/type_declaration，那两个在该 grammar 里不存在）。
  //   ★ `signature`（类型签名 greet :: Int -> Int）**故意不进表** —— 它不是函数声明。
  //   ★ 2026-09-29 补 import 边（本笔）：`import` 是**专用**节点，带 module/alias/names 字段
  //   （grammar/module.js L59）。★ 与 elixir 正相反：这里是真 import 声明节点，故可以声明。
  { name: 'haskell', pkg: 'haskell', exts: ['.hs'], kind: 'code', symbol_nodes: ['function', 'bind', 'class', 'data_type', 'newtype'], import_nodes: ['import'], field_map: { name: 'name' } },
  { name: 'lua', pkg: 'lua', exts: ['.lua'], kind: 'code', symbol_nodes: ['function_declaration'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'perl', pkg: 'perl', exts: ['.pl', '.pm'], kind: 'code', symbol_nodes: ['subroutine_declaration_statement'], field_map: { name: 'name' } },
  { name: 'r', pkg: 'r', exts: ['.r', '.R'], kind: 'code', symbol_nodes: ['function_definition'], field_map: { name: 'name' } },
  { name: 'dart', pkg: 'dart', exts: ['.dart'], kind: 'code', symbol_nodes: ['function_signature', 'class_definition'], field_map: { name: 'name', parameters: 'parameters' } },

  // === 脚本/Shell ===
  { name: 'bash', pkg: 'bash', exts: ['.sh', '.bash'], kind: 'code', symbol_nodes: ['function_definition'], field_map: { name: 'name' } },
  { name: 'fish', pkg: 'fish', exts: ['.fish'], kind: 'code', symbol_nodes: ['function_definition'], field_map: { name: 'name' } },
  { name: 'powershell', pkg: 'powershell', exts: ['.ps1', '.psm1'], kind: 'code', symbol_nodes: ['function_statement'], field_map: { name: 'name' } },

  // === 数据/配置 ===
  { name: 'json', pkg: 'json', exts: ['.json'], kind: 'data', symbol_nodes: ['object'], field_map: { name: 'name' } },
  { name: 'yaml', pkg: 'yaml', exts: ['.yaml', '.yml'], kind: 'data', symbol_nodes: ['block_mapping'], field_map: { name: 'name' } },
  { name: 'toml', pkg: 'toml', exts: ['.toml'], kind: 'data', symbol_nodes: ['pair'], field_map: { name: 'name' } },
  { name: 'xml', pkg: 'xml', exts: ['.xml'], kind: 'data', symbol_nodes: ['element'], field_map: { name: 'name' } },

  // === 系统/底层 ===
  { name: 'zig', pkg: 'zig', exts: ['.zig'], kind: 'code', symbol_nodes: ['FnDecl'], field_map: { name: 'name' } },
  { name: 'nim', pkg: 'nim', exts: ['.nim'], kind: 'code', symbol_nodes: ['proc_def'], field_map: { name: 'name' } },
  { name: 'crystal', pkg: 'crystal', exts: ['.cr'], kind: 'code', symbol_nodes: ['method_def'], field_map: { name: 'name' } },
  { name: 'ocaml', pkg: 'ocaml', exts: ['.ml', '.mli'], kind: 'code', symbol_nodes: ['let_binding'], field_map: { name: 'name' } },
  { name: 'fsharp', pkg: 'f-sharp', exts: ['.fs', '.fsx'], kind: 'code', symbol_nodes: ['function_or_value_defn'], field_map: { name: 'name' } },
  // ★ 2026-09-29 新增：实测（julia 0.23.1）`function_definition` 的 node-types.json 里
  //   **"fields": {}** ⇒ 名字/体都靠结构走（适配器 nameNodeTypes + bodyIsSelf）。
  //   struct/abstract/primitive 是类型声明（名字在 type_head 里），module 有 name 字段但无 body 字段。
  //   ★ 未纳入 `assignment`（`f(x) = …` 短形式）：它需要"符号节点的结构谓词"（见提交信息）。
  //   ★ 2026-09-29 补 import 边（本笔）：`import_statement` 与 `using_statement` 是**两个**专用节点
  //   （grammar.js L485/L495）。★ 故意**不**纳入 `export_statement`（L47x）：julia 的 `export foo`
  //   导出的是**本文件里的名字**，不含模块源 ⇒ 当 import 节点会造出假边（与 scala 的 export 相反）。
  { name: 'julia', pkg: 'julia', exts: ['.jl'], kind: 'code', symbol_nodes: ['function_definition', 'struct_definition', 'module_definition', 'abstract_definition', 'primitive_definition'], import_nodes: ['import_statement', 'using_statement'], field_map: { name: 'name' } },
  { name: 'clojure', pkg: 'clojure', exts: ['.clj', '.cljs'], kind: 'code', symbol_nodes: ['list_lit'], field_map: { name: 'name' } },
  { name: 'scheme', pkg: 'scheme', exts: ['.scm', '.ss'], kind: 'code', symbol_nodes: ['list'], field_map: { name: 'name' } },
  { name: 'solidity', pkg: 'solidity', exts: ['.sol'], kind: 'code', symbol_nodes: ['contract_declaration', 'function_definition'], field_map: { name: 'name' } },
  { name: 'vhdl', pkg: 'vhdl', exts: ['.vhdl', '.vhd'], kind: 'code', symbol_nodes: ['entity_declaration'], field_map: { name: 'name' } },
  { name: 'verilog', pkg: 'verilog', exts: ['.v', '.sv'], kind: 'code', symbol_nodes: ['module_declaration'], field_map: { name: 'name' } },
  { name: 'tcl', pkg: 'tcl', exts: ['.tcl'], kind: 'code', symbol_nodes: ['proc_statement'], field_map: { name: 'name' } },

  // === 文档/标记 ===
  { name: 'markdown', pkg: 'markdown', exts: ['.md', '.markdown'], kind: 'doc', symbol_nodes: ['section', 'atx_heading'], field_map: { name: 'name' } },
  { name: 'latex', pkg: 'latex', exts: ['.tex'], kind: 'doc', symbol_nodes: ['command'], field_map: { name: 'name' } },

  // === 其他流行语言 ===
  // ★ groovy 的表项已上移到"后端语言"一节（与 scala/kotlin 同区，便于对照；旧位置的表项已删，
  //   否则同一门语言在表里出现两次、后者静默胜出）
  { name: 'graphql', pkg: 'graphql', exts: ['.graphql', '.gql'], kind: 'code', symbol_nodes: ['object_type_definition', 'field_definition'], field_map: { name: 'name' } },
  { name: 'protobuf', pkg: 'protobuf', exts: ['.proto'], kind: 'code', symbol_nodes: ['message', 'service'], field_map: { name: 'name' } },
  { name: 'sql', pkg: 'sql', exts: ['.sql'], kind: 'code', symbol_nodes: ['create_statement'], field_map: { name: 'name' } },
  { name: 'rego', pkg: 'rego', exts: ['.rego'], kind: 'code', symbol_nodes: ['rule'], field_map: { name: 'name' } },
  { name: 'cue', pkg: 'cue', exts: ['.cue'], kind: 'code', symbol_nodes: ['field'], field_map: { name: 'name' } },
];

/** 找语言（按扩展名） */
export function findLanguageByExt(ext: string): LanguageEntry | undefined {
  return LANGUAGES.find((l) => l.exts.includes(ext));
}

/**
 * 该语言包的**模块说明符** —— 「显式 `pkgSpec` 优先，否则按 `tree-sitter-{pkg}` 派生」的**唯一落点**。
 *
 * ★ 2026-10-08：这条派生原先**散在两处**（`loader.loadLanguage` 的 `await import(...)`、
 *   `probe.isLanguageInstalled` 的 `resolvedIsLoadable(...)`）。两处都写对了**不代表第三处也会写对**
 *   —— 而下一处（「这个后缀该补哪个包」的可执行提示）正需要它。同一个问题的第二份实现
 *   = 本仓头号病根「判据分叉」的起点 ⇒ 在加第三处**之前**先收成这里一份。
 *
 * ★ 签名收成 `(pkg, pkgSpec?)` 而不是 `(LanguageEntry)`：调用方有两种 ——
 *   ① 手上**有注册表表项**（`languageModuleSpec(l.pkg, l.pkgSpec)`）；
 *   ② 手上只有**一个裸包名**（`probe.isLanguageInstalled` 在注册表里查不到时会拿 pkgName 直接拼，
 *      那条路径也得走**同一条规则**）。收成表项类型会把 ② 挡在门外、逼它自己再拼一次。
 */
export function languageModuleSpec(pkg: string, pkgSpec?: string): string {
  return pkgSpec ?? `tree-sitter-${pkg}`;
}
