# 加语言 / 加 AST 的开发指南

> 目标：**加一门语言 = 填数据 + 写 2 个函数 + 跑 6 条验货命令**。不需要动内核。
> 内核（`parseFileFull` / `traverseAndExtract*` / `resolveCrossFileCalls`）**不认识任何具体语言** ——
> 凡是"认识某门语言"的东西，都必须住在下面三张表里。**发现内核里有 `if (langName === 'xx')`，
> 那就是设计漏了，该搬进表。**

---

## 0 · 三张表的分工（先建立这个地图）

| 表 | 文件 | 管什么 |
|---|---|---|
| `LANGUAGES` | `parse/languages.ts` | **语法包**：npm 包名、扩展名、符号节点、import 节点、字段映射 |
| `LANG_ADAPTERS` | `parse/kernel.ts` | **抽取行为**：调用形态、import source 抽取、`resolveImport`、局部绑定节点 |
| `*_BUILTIN_*` / `BUILTIN_TYPES` | `index/symbols.ts` | **只放真全局**（TS lib / 语言内置），**不放包成员** |

★ 三张表**必须同时填**。只填 `LANGUAGES` ⇒ 能解析语法但抽不出调用/导入；只填前两张 ⇒ 跨文件解析不了。

---

## 1 · 加一门新语言（6 步）

### 步骤 1：确认 grammar 包真的存在

```bash
npm run lang:check        # 逐条把声明与 npm 事实对照
```

`LANGUAGES` 的 `pkgSpec` 是**三态**，别混：

| 写法 | 含义 |
|---|---|
| **不写** `pkgSpec` | 按约定派生 `tree-sitter-{pkg}` —— **只有约定成立时才能不写** |
| `pkgSpec: 'tree-sitter-fsharp'` | 显式真名（约定不成立时**必须**写） |
| `pkgSpec: null` | **本仓没有登记可用包**（上游 npm 上不存在）⇒ 不许让调用方去猜 |

**实测踩过的**：`tsx`/`jsx` **不是独立包**（住在 `tree-sitter-typescript` / `tree-sitter-javascript` 里）；
`f-sharp` 的派生名 `tree-sitter-f-sharp` **E404**，真名 `tree-sitter-fsharp`。

### 步骤 2：`parse/languages.ts` 加 `LanguageEntry`

```ts
{
  name: 'mylang',                       // 与 LANG_ADAPTERS 的 key 必须一致
  pkg: 'mylang',
  exts: ['.ml'],                        // 含点
  kind: 'code',                         // code=算源码；data/markup/style/doc=不算
  symbol_nodes: ['function_definition', 'class_definition'],   // "符号定义"的节点类型
  import_nodes: ['import_statement'],   // "import 声明"的节点类型
  field_map: { name: 'name', parameters: 'parameters', body: 'body' },
}
```

### 步骤 3：`parse/kernel.ts` 的 `LANG_ADAPTERS` 加适配器

**逐字段**（都有默认值，但**默认值只对 TS 系成立**）：

```ts
mylang: {
  // ① 调用形态（必填，否则抽不到调用）
  callNode: 'call_expression',           // 数组 = 多种形态（PHP 三种 / Groovy 两种）
  calleeFields: ['function'],            // 被调名的【字段名】，按序试
  calleeObjectField: 'object',           // 只有 Java/Groovy 需要（拼回 `对象.方法`）

  // ② import source 抽取（import_nodes 复杂时必填）
  extractImportSources(node) { ... },    // 返回 string[]（可以是多个 source）
  extractImportBindings(node) { ... },   // 返回绑定名（`{ a, b }` / `x` / `*`）

  // ③ ★ 导入解析（**必填**，否则跨文件引用一条都解析不到）
  resolveImport(source, fromRel, ctx) {
    // []      = 明确外部（标准库/第三方）
    // string[]= 项目内候选文件
    // null    = 本语言不管，交调用方试别的路子
  },

  // ④ 局部绑定声明（不填 = 本语言没有局部绑定概念）
  localBindingNodes: ['let_declaration'],
}
```

#### ③ `resolveImport` 的三种已实现约定（**照抄**）

| 语言 | 判据 |
|---|---|
| **Go** | 本仓 module 前缀 → 目录 → 该目录所有 `.go`（`readGoModules` 提供 module→dir） |
| **Java** | `a.b.C` → 路径以 `a/b/C.java` 结尾（**目录=包，语言强制**）；`a.b.*` → 该包目录下所有 `.java`；`java.*`/`javax.*`/`jdk.*`/`sun.*` → `[]` |
| **Python** | `a.b` → `a/b.py` / `a/b/__init__.py`；`.` 前缀按**点数上溯**；也试"相对于当前文件目录" |

#### ④ `localBindingNodes` 之后还要写抽取分支

`localBindingsOfDecl(node, langName)` 会先**按语言门控**（只看 `localBindingNodes`），
然后**按节点类型**抽 —— 目前实现了两种形态：

| 形态 | 节点 | 抽取 |
|---|---|---|
| TS/JS | `lexical_declaration` / `variable_declaration` | `variable_declarator(name, value)` |
| Go | `short_var_declaration` / `var_declaration` | `left(expression_list)` / `right(expression_list)` |

⇒ **新语言如果是第三种形态**（如 Python `assignment`、Rust `let_declaration`），
必须在 `localBindingsOfDecl` 里**加一支**，并把节点类型填进 `localBindingNodes`。

> ★ 门控解决了历史上的一个隐蔽 bug：`var_declaration` 在 TS 分支和 Go 分支**都出现**，
> TS 分支先 `return` ⇒ **Go 的 `var x T = …` 永远收不到**。门控后两边可以安全重叠。

### 步骤 4：`index/symbols.ts` 的内置表（**谨慎**）

```ts
// 只放【真全局】—— 语法上不需要 import 就能用的名字
'Buffer', 'NodeJS', 'RegExpExecArray', 'Uint8Array', 'ReadonlySet', ...
```

**绝对不要**放"包成员的类型尾名"（`ServerResponse` / `Dirent` / `Ident` / `Stmt` …）。

> **判据（已应验三次）**：**每张 `*_BUILTIN_*` 表都要问一句 ——「它是不是在掩盖一个缺失的解析能力？」**
>
> | 表 | 掩盖的缺失 | 处置 |
> |---|---|---|
> | `BUILTIN_TYPES` tail 名 | `type_ref` 丢 receiver | 修解析器 ⇒ 删表 |
> | `GO_BUILTIN_TYPES` stdlib 名 | 同上 | 同上 |
> | `JAVA_BUILTIN_TYPES` | **Java 没有 `resolveImport`** | 补解析器 ⇒ 删表 |
>
> 化石的危害：**让真洞看不见**，而且**换个项目就漏**。

### 步骤 5：验货（6 条命令，缺一不可）

```bash
# ① 语法包与 npm 事实一致
npm run lang:check

# ② 类型/编译
npx tsc --noEmit

# ③ 解析冒烟：该语言的文件能抽出符号 / import / 调用
node -e "const k=await import('./dist/src/infrastructure/parse/kernel.js');
const fs=await import('node:fs');
const r=await k.parseFileFull('<某文件>', fs.readFileSync('<某文件>','utf8'));
console.log('symbols',r.symbols.length,'imports',r.imports.length,'calls',r.calls.length,'error',r.error)" --input-type=module

# ④ resolveImport 单测（**合成 ctx，不要依赖本仓有没有该语言的文件**）
node -e "const k=await import('./dist/src/infrastructure/parse/kernel.js');
const ctx={projectRoot:'/x',files:new Set(['a/b.py']),goModules:[]};
console.log(k.LANG_ADAPTERS.python.resolveImport('a.b','x.py',ctx))" --input-type=module

# ⑤ 全量重建（MCP 必须先停，否则 cache.db 被占）
#    停 MCP → 删 .agent-io/cache.db{,-wal,-shm} → importProject → indexIntegrity({retry_failed:true})

# ⑥ 看读数：failed 不该涨；本仓解析率不该跌
```

**★ ④ 特别重要**：本仓对多数语言只有 0-4 个文件 ⇒ **全量重建看不出对错**。
`resolveImport` 必须用**合成 ctx 单测**（步骤 4 的写法），否则就是"纯设计零实测"。

### 步骤 6：写进 `docs/METHOD.md` 的能力边界表

加完语言后，更新「导入解析：26 个语言只有 N 个能解析」那张表。

---

## 2 · 加一个 AST 节点（不是加语言）

常见需求：某种语法构造没被识别（比如某语言的类型别名没进 `nodes`）。

### 2.1 加"符号定义"节点

1. 在 `LANGUAGES` 的 `symbol_nodes` 里加节点类型。
2. 确认 `nodeTypeToKind`（`kernel.ts`）能把它映射到正确的 `kind`：
   `function` / `method` / `class` / `interface` / `type` / `enum` / `const` / `variable`。
   ★ 常见坑：新节点落进 `undefined` ⇒ 后面所有按 kind 的判据都失效。
3. 确认 `field_map` 里有 `name`（没有名字的符号抽不出来）。

### 2.2 加"import 声明"节点 —— **有坑，务必读**

`import_nodes` 是**命中即 `return`**（"import 节点内部不再递归"）。

> **实测事故**：`typescript.import_nodes = ['import_statement', 'export_statement']`
> ⇒ `export async function f() { … }` **也是 `export_statement`** ⇒ 整个函数体被跳过
> ⇒ **函数体内的 `await import(…)` 一条都抽不到**（而 `.mjs` 的动态 import 在模块顶层，所以正常）。
>
> **正确姿势**：命中 `import_nodes` 但**没抽出 source** 且带 `declaration` 子节点
> ⇒ 它是「导出**声明**」不是导出**语句** ⇒ **必须继续递归**。

**加任何新的 `import_nodes` 前，先问**：这个节点类型会不会**包裹**普通代码（函数体/语句块）？
会 ⇒ 必须保证"抽不到 source 时继续递归"。

### 2.3 加"调用形态"

`callNode` 加节点类型；`calleeFields` 加被调名的**字段名**。
★ 不要在内核里写 `if (langName === 'xx')` —— 加字段。

### 2.4 加"带点的类型/引用"

**必须保留 receiver**。`http.ServerResponse` 的 AST 是 `nested_type_identifier`（TS）/
`qualified_type`（Go）—— 如果只认内层 `type_identifier`，receiver 就丢了，
解析器判不出"这是外部包成员"，只能靠内置表猜。

> 已修：`traverseAndExtractTypeRefs` 对 `nested_type_identifier` / `qualified_type` /
> `scoped_type_identifier` **记全名**，交给 `resolveCrossFileCalls` 的带点分支
> 判 `namespace-member-of-package`（**有据**）。
> **新语言如果也有"限定类型"，加进那个三元组。**

---

## 3 · 已知未实现的（**别当成"已支持"**）

| 缺口 | 现状 | 补法 |
|---|---|---|
| **导入解析** | 26 个语言只有 **3 个**（go · java · python）+ TS 默认路径 | 按步骤 3 的 ③ 填 `resolveImport` |
| 其余 23 个语言 | rust · c_sharp · c · cpp · ruby · kotlin · php · scala · groovy · julia · haskell · elixir · bash · fish · ocaml · solidity · crystal · swift … | 同上 |
| 局部绑定（第三种形态） | 只有 TS/Go 两种形态有抽取分支 | Python `assignment` · Rust `let_declaration` 等要加分支 |
| 计算路径的 import | 记为 `kind:'computed'`，**路径解析不了**（67 条） | 需要求值/类型系统；**当前只保留事实** |

---

## 4 · 常见坑速查

| 症状 | 原因 | 对策 |
|---|---|---|
| 某语言的调用一条都抽不到 | `callNode` 没填，或 `calleeFields` 字段名错 | 用 `parseTreeForFile` dump 一下真实字段名 |
| 符号抽到了但 `kind` 是 `undefined` | `nodeTypeToKind` 没映射 | 加映射 |
| 函数体内的动态 import 抽不到 | `import_nodes` 里的节点**包裹**了函数体 | 见 2.2 的"继续递归" |
| 跨文件引用全 `failed` | 该语言没有 `resolveImport` | 见步骤 3 的 ③ |
| 局部变量被当成外部引用 | `localBindingNodes` 没填 / 没有抽取分支 | 见步骤 3 的 ④ |
| 删了内置表项后 `failed` 暴涨 | **那是好事** —— 暴露了真洞 | **修洞**，别把表加回去 |
| `resolveImport` 写完在本仓"验证通过" | 本仓可能**只有 0 个**该语言文件 | 用**合成 ctx** 单测（步骤 5 ④） |

---

## 5 · 一句话

> **内核不认识任何语言；一切语言知识都在三张表里。**
> 加语言 = 填三张表 + 写 `resolveImport` / `localBindingNodes` 的抽取 + **合成用例验货**。
> 发现内核里有按语言的分支 ⇒ 那是设计漏了 ⇒ 搬进表，并回来给本指南补一行。
