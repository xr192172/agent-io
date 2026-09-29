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
 */

export interface LanguageEntry {
  /** 语言显示名（go / typescript / ...） */
  name: string;
  /** npm 包名（tree-sitter-{pkg}） */
  pkg: string;
  /** 支持的文件扩展名（含 .） */
  exts: string[];
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
  { name: 'typescript', pkg: 'typescript', exts: ['.ts'], symbol_nodes: ['function_declaration', 'class_declaration', 'abstract_class_declaration', 'interface_declaration', 'type_alias_declaration', 'enum_declaration', 'method_definition'], import_nodes: ['import_statement', 'export_statement'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  { name: 'tsx', pkg: 'tsx', exts: ['.tsx'], symbol_nodes: ['function_declaration', 'class_declaration', 'abstract_class_declaration', 'interface_declaration', 'type_alias_declaration', 'enum_declaration', 'method_definition'], import_nodes: ['import_statement', 'export_statement'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  { name: 'javascript', pkg: 'javascript', exts: ['.js', '.mjs', '.cjs'], symbol_nodes: ['function_declaration', 'class_declaration', 'method_definition'], import_nodes: ['import_statement', 'export_statement'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'jsx', pkg: 'jsx', exts: ['.jsx'], symbol_nodes: ['function_declaration', 'class_declaration', 'method_definition'], import_nodes: ['import_statement', 'export_statement'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'vue', pkg: 'vue', exts: ['.vue'], symbol_nodes: ['export_statement'], field_map: { name: 'name' } },
  { name: 'html', pkg: 'html', exts: ['.html', '.htm'], symbol_nodes: ['script_element'], field_map: { name: 'name' } },
  { name: 'css', pkg: 'css', exts: ['.css'], symbol_nodes: ['rule_set'], field_map: { name: 'name' } },
  { name: 'scss', pkg: 'scss', exts: ['.scss'], symbol_nodes: ['rule_set'], field_map: { name: 'name' } },
  { name: 'less', pkg: 'less', exts: ['.less'], symbol_nodes: ['rule_set'], field_map: { name: 'name' } },

  // === 后端语言 ===
  { name: 'go', pkg: 'go', exts: ['.go'], symbol_nodes: ['function_declaration', 'method_declaration', 'type_declaration', 'type_spec'], import_nodes: ['import_spec'], field_map: { name: 'name', parameters: 'parameters', return_type: 'result', receiver: 'receiver' } },
  { name: 'python', pkg: 'python', exts: ['.py'], symbol_nodes: ['function_definition', 'class_definition'], import_nodes: ['import_statement', 'import_from_statement'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  { name: 'java', pkg: 'java', exts: ['.java'], symbol_nodes: ['class_declaration', 'method_declaration', 'interface_declaration'], import_nodes: ['import_declaration'], field_map: { name: 'name', parameters: 'parameters', return_type: 'type' } },
  { name: 'c', pkg: 'c', exts: ['.c', '.h'], symbol_nodes: ['function_definition', 'struct_specifier'], import_nodes: ['preproc_include'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'cpp', pkg: 'cpp', exts: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], symbol_nodes: ['function_definition', 'class_specifier', 'struct_specifier', 'namespace_definition'], import_nodes: ['preproc_include'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'c_sharp', pkg: 'c-sharp', exts: ['.cs'], symbol_nodes: ['class_declaration', 'method_declaration', 'interface_declaration'], import_nodes: ['using_directive'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'rust', pkg: 'rust', exts: ['.rs'], symbol_nodes: ['function_item', 'struct_item', 'impl_item', 'trait_item'], import_nodes: ['use_declaration'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  // ★ 2026-09-29 实测校准：symbol_nodes 的 class_declaration/function_declaration **本来就与
  //   tree-sitter-kotlin 的 node-types 对得上**（该 grammar 里两者都是 named 节点）——
  //   kotlin 此前提不出符号的真正原因是 kernel 侧三处"有字段"假设（见 kernel.ts: extractName /
  //   findBodyNode / extractCallee）。本次顺带把 object_declaration（单例 object）纳入符号；
  //   import_nodes=import_header 为专用 import 节点（`import a.b.C as D`）。
  { name: 'kotlin', pkg: 'kotlin', exts: ['.kt', '.kts'], symbol_nodes: ['class_declaration', 'function_declaration', 'object_declaration'], import_nodes: ['import_header'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'swift', pkg: 'swift', exts: ['.swift'], symbol_nodes: ['function_declaration', 'class_declaration'], field_map: { name: 'name', parameters: 'parameters' } },
  // ★ ruby 无 import_nodes：tree-sitter-ruby 没有"import 声明"节点 —— `require 'x'` 就是普通
  //   `call`（见 kernel.ts: LANG_ADAPTERS.ruby 注释）。调用边已通（callNode='call'）。
  { name: 'ruby', pkg: 'ruby', exts: ['.rb'], symbol_nodes: ['method', 'class', 'module'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'php', pkg: 'php', exts: ['.php'], symbol_nodes: ['function_definition', 'method_declaration', 'class_declaration'], import_nodes: ['namespace_use_declaration'], field_map: { name: 'name', parameters: 'parameters' } },
  // ★ 2026-09-29 校准：旧表项的 `def_definition` 在 tree-sitter-scala 里**根本不存在**
  //   （该 grammar 的真名是 function_definition / function_declaration）。实测（0.24.0，
  //   `node-node-types.json` + 真跑）：function_definition/class_definition/object_definition/
  //   trait_definition/enum_definition/type_definition 都带 name 字段，且函数带 body/parameters/return_type
  //   ⇒ 走通用"有字段"路径即可，不需要任何专属适配（适配器只补 callNode + object 的 kind 覆盖）。
  { name: 'scala', pkg: 'scala', exts: ['.scala', '.sc'], symbol_nodes: ['function_definition', 'function_declaration', 'class_definition', 'object_definition', 'trait_definition', 'enum_definition', 'type_definition'], field_map: { name: 'name', parameters: 'parameters', return_type: 'return_type' } },
  // ★ 2026-09-29 校准：旧表项的 `class_definition` 在 tree-sitter-groovy 里**不存在**
  //   （真名 class_declaration）。实测（0.1.2）：method_declaration/class_declaration 都带
  //   name/body 字段（方法的返回类型在 `type` 字段）；脚本级 `String f(){}` 是 function_definition。
  { name: 'groovy', pkg: 'groovy', exts: ['.groovy'], symbol_nodes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'method_declaration', 'function_definition'], field_map: { name: 'name', parameters: 'parameters', return_type: 'type' } },
  // ★ 2026-09-29 新增：实测（elixir 0.3.5）该语法里 **`def`/`defmodule` 自己就是 `call`**
  //   ⇒ 符号节点只能是 `call`，靠适配器的 symbolDispatch（target ∈ def/defp/defmodule/…）
  //   把"声明"与"普通调用"分开；名字走 namePaths、体走 bodyNodeTypes=['do_block']。
  //   旧表项 ['call','do_block'] 会把 defmodule/def/内层名全当符号（实测 8 条里 6 条是垃圾）。
  { name: 'elixir', pkg: 'elixir', exts: ['.ex', '.exs'], symbol_nodes: ['call'], field_map: { name: 'name' } },
  { name: 'erlang', pkg: 'erlang', exts: ['.erl', '.hrl'], symbol_nodes: ['function_clause'], field_map: { name: 'name' } },
  // ★ 2026-09-29 新增：实测（haskell 0.23.1）函数体在 **match** 字段（局部绑定在 binds），
  //   旧内核只认 'body'/'suite' ⇒ 下不了体 ⇒ 调用边恒空。真节点名是 function/bind（不是
  //   旧表项的 function_declaration/type_declaration，那两个在该 grammar 里不存在）。
  //   ★ `signature`（类型签名 greet :: Int -> Int）**故意不进表** —— 它不是函数声明。
  { name: 'haskell', pkg: 'haskell', exts: ['.hs'], symbol_nodes: ['function', 'bind', 'class', 'data_type', 'newtype'], field_map: { name: 'name' } },
  { name: 'lua', pkg: 'lua', exts: ['.lua'], symbol_nodes: ['function_declaration'], field_map: { name: 'name', parameters: 'parameters' } },
  { name: 'perl', pkg: 'perl', exts: ['.pl', '.pm'], symbol_nodes: ['subroutine_declaration_statement'], field_map: { name: 'name' } },
  { name: 'r', pkg: 'r', exts: ['.r', '.R'], symbol_nodes: ['function_definition'], field_map: { name: 'name' } },
  { name: 'dart', pkg: 'dart', exts: ['.dart'], symbol_nodes: ['function_signature', 'class_definition'], field_map: { name: 'name', parameters: 'parameters' } },

  // === 脚本/Shell ===
  { name: 'bash', pkg: 'bash', exts: ['.sh', '.bash'], symbol_nodes: ['function_definition'], field_map: { name: 'name' } },
  { name: 'fish', pkg: 'fish', exts: ['.fish'], symbol_nodes: ['function_definition'], field_map: { name: 'name' } },
  { name: 'powershell', pkg: 'powershell', exts: ['.ps1', '.psm1'], symbol_nodes: ['function_statement'], field_map: { name: 'name' } },

  // === 数据/配置 ===
  { name: 'json', pkg: 'json', exts: ['.json'], symbol_nodes: ['object'], field_map: { name: 'name' } },
  { name: 'yaml', pkg: 'yaml', exts: ['.yaml', '.yml'], symbol_nodes: ['block_mapping'], field_map: { name: 'name' } },
  { name: 'toml', pkg: 'toml', exts: ['.toml'], symbol_nodes: ['pair'], field_map: { name: 'name' } },
  { name: 'xml', pkg: 'xml', exts: ['.xml'], symbol_nodes: ['element'], field_map: { name: 'name' } },

  // === 系统/底层 ===
  { name: 'zig', pkg: 'zig', exts: ['.zig'], symbol_nodes: ['FnDecl'], field_map: { name: 'name' } },
  { name: 'nim', pkg: 'nim', exts: ['.nim'], symbol_nodes: ['proc_def'], field_map: { name: 'name' } },
  { name: 'crystal', pkg: 'crystal', exts: ['.cr'], symbol_nodes: ['method_def'], field_map: { name: 'name' } },
  { name: 'ocaml', pkg: 'ocaml', exts: ['.ml', '.mli'], symbol_nodes: ['let_binding'], field_map: { name: 'name' } },
  { name: 'fsharp', pkg: 'f-sharp', exts: ['.fs', '.fsx'], symbol_nodes: ['function_or_value_defn'], field_map: { name: 'name' } },
  // ★ 2026-09-29 新增：实测（julia 0.23.1）`function_definition` 的 node-types.json 里
  //   **"fields": {}** ⇒ 名字/体都靠结构走（适配器 nameNodeTypes + bodyIsSelf）。
  //   struct/abstract/primitive 是类型声明（名字在 type_head 里），module 有 name 字段但无 body 字段。
  //   ★ 未纳入 `assignment`（`f(x) = …` 短形式）：它需要"符号节点的结构谓词"（见提交信息）。
  { name: 'julia', pkg: 'julia', exts: ['.jl'], symbol_nodes: ['function_definition', 'struct_definition', 'module_definition', 'abstract_definition', 'primitive_definition'], field_map: { name: 'name' } },
  { name: 'clojure', pkg: 'clojure', exts: ['.clj', '.cljs'], symbol_nodes: ['list_lit'], field_map: { name: 'name' } },
  { name: 'scheme', pkg: 'scheme', exts: ['.scm', '.ss'], symbol_nodes: ['list'], field_map: { name: 'name' } },
  { name: 'solidity', pkg: 'solidity', exts: ['.sol'], symbol_nodes: ['contract_declaration', 'function_definition'], field_map: { name: 'name' } },
  { name: 'vhdl', pkg: 'vhdl', exts: ['.vhdl', '.vhd'], symbol_nodes: ['entity_declaration'], field_map: { name: 'name' } },
  { name: 'verilog', pkg: 'verilog', exts: ['.v', '.sv'], symbol_nodes: ['module_declaration'], field_map: { name: 'name' } },
  { name: 'tcl', pkg: 'tcl', exts: ['.tcl'], symbol_nodes: ['proc_statement'], field_map: { name: 'name' } },

  // === 文档/标记 ===
  { name: 'markdown', pkg: 'markdown', exts: ['.md', '.markdown'], symbol_nodes: ['section', 'atx_heading'], field_map: { name: 'name' } },
  { name: 'latex', pkg: 'latex', exts: ['.tex'], symbol_nodes: ['command'], field_map: { name: 'name' } },

  // === 其他流行语言 ===
  // ★ groovy 的表项已上移到"后端语言"一节（与 scala/kotlin 同区，便于对照；旧位置的表项已删，
  //   否则同一门语言在表里出现两次、后者静默胜出）
  { name: 'graphql', pkg: 'graphql', exts: ['.graphql', '.gql'], symbol_nodes: ['object_type_definition', 'field_definition'], field_map: { name: 'name' } },
  { name: 'protobuf', pkg: 'protobuf', exts: ['.proto'], symbol_nodes: ['message', 'service'], field_map: { name: 'name' } },
  { name: 'sql', pkg: 'sql', exts: ['.sql'], symbol_nodes: ['create_statement'], field_map: { name: 'name' } },
  { name: 'rego', pkg: 'rego', exts: ['.rego'], symbol_nodes: ['rule'], field_map: { name: 'name' } },
  { name: 'cue', pkg: 'cue', exts: ['.cue'], symbol_nodes: ['field'], field_map: { name: 'name' } },
];

/** 找语言（按扩展名） */
export function findLanguageByExt(ext: string): LanguageEntry | undefined {
  return LANGUAGES.find((l) => l.exts.includes(ext));
}
