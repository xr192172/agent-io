# 补一门语言 —— 可照做清单

> **这份文档是给"接力 AI"用的**。本仓的既定方针（用户原话）是：
> 「先开发一套示范语言的，然后留下接口让 agent 自己模仿接续其它语言的开发……目标语言的尽可能能力覆盖与留下接口，并且语言无关（工具自动根据语言路由到对应语言接口（模式），如果缺失提示下载或自己开发补齐）。」
>
> 本文把那个**隐式接口显式化**：补一门语言 = 动哪几处、照谁的样子、怎么验。
> 所有落点写成 **文件:函数**（行号仅参考，会漂移）。
>
> **本文所有"实测"= 在本仓 `main`（工作区干净）上跑出来/读出来的**；凡属推断的地方都标了「推断」。

---

## 0. 一页速览

### 0.1 两层架构（这是理解一切的地图）

| 层 | 是什么 | 落点 | 驱动方式 |
|---|---|---|---|
| **① 语法/符号层** | 认出"这个扩展名是什么语言、它的符号/import/调用/类型引用节点长什么样" | `src/tools/ts_kernel/languages.ts` 的 `LANGUAGES` 表 + `src/tools/ts_kernel/probe.ts` 的 `isLanguageInstalled` | ★ **纯数据驱动**：往表里加一条 + 装 `tree-sitter-<pkg>` ⇒ 下一个进程自动启用 |
| **② 语义层** | 每个能力**自己的**语言分支（改名怎么做、契约怎么对账、行为基线怎么跑…） | 散在 `src/tools/**`、`src/health/`、`src/behavior/`、`src/impact/`、`src/version_upgrade/**` 等 | ★ **混合**：图类能力数据驱动（改表），语义类能力代码驱动（写函数） |

☆ 这是 `ast_parse_skeleton` 能 **55/55 全绿**、而其余 11 个能力一片缺口（合计 523）的根本原因：
**①层是自动的，②层大部分是手工的。**

### 0.2 三种目标 → 三种成本（实测结论）

| 你要什么 | 要改什么 | 处数 |
|---|---|---|
| **只要符号级**（符号/定义能被索引、`ast_parse_skeleton` 亮起） | `languages.ts: LANGUAGES` 加 1 条 + `npm run install-package install <lang>` | **2 处** |
| **要调用边/依赖边**（`impact_analysis` / `cross_repo_symbol_index` / `hybrid_precheck` 的符号支柱随之生效） | 上面 2 处 + `kernel.ts: LANG_ADAPTERS` 加 1 条（要 import 边再给 `LANGUAGES` 该条补 `import_nodes`） | **3 处** |
| **要全部 12 个能力** | 上面 3 处 + **6 个语义子系统的语言分支**（每个 1–5 处）+ `register_capabilities.ts` 声明 | **≈ 27–30 处** |

### 0.3 唯一判据（以及一个坑）

```bash
npm run capability        # 全量 55 门语言的缺口自检
npm run capability -- --installed   # 只看已装语言包的语言
node scripts/capability_scan.mjs --check   # ★ 已有门：会抓"声明写得比实现窄"
```

★ **`capability_scan.mjs --check` 实测输出**（EXIT=0，2 条 info 级待决，不阻断）：

```
[capability_scan] 2 条语义待决提示（不阻断，建议人工确认）：
  · impact_analysis: 实现含全语言解析 API（见 src/impact/index.ts）→ 对所有已装语言生效；
    声明只覆盖 typescript/tsx/javascript/jsx/go/python/java/c_sharp/c，请确认是否写窄
  · code_health:（同上，声明只覆盖 8 门）
```

⇒ **本仓已经有一台机器在盯"声明 vs 实现"的漂移**，而且它盯的正是 §4.3 那类假缺口。
补语言/补声明时**先跑它**：它绿 + `npm run capability` 缺口下降，才算闭环。

★ **坑（必读）**：`npm run capability` 的数字**不是自动测量的**，它读的是
`src/tools/register_capabilities.ts` 里**手工登记的 `declareCapability()` 声明**
（`src/tools/capability_matrix.ts: levelFor` = `overrides[lang] ?? default`）。
⇒ 所以你**光加代码不改声明，缺口数字不会动**；反过来**光改声明不加代码，缺口数字会假性下降**。
真正的闭环是三者同时：**加代码 → 加/改声明 → `npm run capability` 缺口减少 → 跑该能力的单测/真实样例**。

**这个"坑"也解释了一个正向发现**：现网声明**落后于**代码（详见 §4.3 的 rust 实证），
即"缺口数"是**保守上界**，不是真实能力。

### 0.4 动手前先跑这三条（30 秒定位现状）

```bash
npm run install-package list     # 哪些语言包已装 / 缺哪个 npm 包 / 钉版
npm run capability               # 12 能力 × 55 语言的缺口（按能力分组的原始数据）
node scripts/capability_scan.mjs --check   # 仓库既有的能力一致性门（退出码 0 = 过）
```

---

## 1. 第 ① 层：加一条表项 + 装包 ⇒ 哪些能力立刻就有

### 1.1 怎么做（2 处）

**改动 A** — `src/tools/ts_kernel/languages.ts`，`LANGUAGES` 数组加一条（照 TS 那条抄结构）：

```ts
// 参照 languages.ts 里 typescript 那条（LANG_ADAPTERS 之外，纯数据）
{ name: 'kotlin', pkg: 'kotlin', exts: ['.kt', '.kts'],
  kind: 'code',            // ★ 必填（2026-09-29 新增）—— 见下方字段表；这门语言算"代码"
  symbol_nodes: ['class_declaration', 'function_declaration'],
  // 要 import 边才填（填了就必须同时在 kernel.ts 的 LANG_ADAPTERS 加记录，否则测试红，见 1.4）
  // ★ 节点名必须查该语言 grammar 的 node-types.json —— 下面这个值只是占位示例，未必对
  // import_nodes: ['import_header'],
  field_map: { name: 'name', parameters: 'parameters' } },
```

字段含义（`LanguageEntry` 接口，`languages.ts` 顶部）：

| 字段 | 作用 | 决策 |
|---|---|---|
| `name` | 语言 id（能力矩阵/Q 分支 key 都用它） | 必填 |
| `pkg` | npm 包名（探测定 `tree-sitter-<pkg>`） | 必填 |
| `exts` | 扩展名（含 `.`） | 必填 |
| ★ `kind` | ★★ **这门语言算不算「代码」**：`code` / `data` / `markup` / `style` / `doc` | **必填**（2026-09-29 新增） |
| `symbol_nodes` | 哪些 tree-sitter 节点算"符号定义" | 必填（查该语言的 grammar 的 `node-types.json`） |
| `import_nodes` | 哪些节点算 import 声明 | **选了才填** —— 填了 = 承诺有 import 边（受门约束） |
| `field_map` | tree-sitter 字段名 → `ParsedSymbol` 字段 | 必填（`name` 至少要） |

★★ **`kind` 为什么必须存在**（这是本仓踩过的口径缺陷，别把它当可选装饰）：

本仓有**三个不同**的问题，曾经被混成一个：

| 概念 | 回答什么 | 权威 |
|---|---|---|
| **可解析** | 我**能**解析哪些扩展名 | `probe.listSupportedExts()`（= 装了哪些语言包） |
| ★ **代码语言** | **什么算「源码」**（该进符号索引 / 该算孤立模块 / 该体检） | `source_exts.ts: isCodeLangExt` ⇐ **数据源就是本字段** |
| **可跑 node** | 哪些能被 node 执行 | `NODE_RUNNABLE_EXTS` |

★ 混用的后果（实测）：`.json` **能解析**（`tree-sitter-json` 真载入）⇒ 被当成"源码" ⇒
`package.json` 被报成「**孤立模块 / 待清理 dead code**」，好夹具从 **100/A 掉到 80/B**。
⇒ 修法就是本字段：`.json`/`.yaml`/`.toml`/`.xml` 标 `data`、`.md`/`.tex` 标 `doc`、
`.css`/`.scss`/`.less` 标 `style`、`.html` 标 `markup` ⇒ **它们不再进源码集**（但**仍在"能解析"集合里**，两回事）。
★ 口径收紧后**必须可见**（不许静默消失）：`health` / `impact` 会报
`bounds.skipped: [{path, why, count}]`（如 `[{"path":"**/*.json","why":"非代码语言扩展名：不进调用/依赖图…","count":43}]`）。
★（2026-09-29：该字段原先叫 `excludedNonCode`，已**统一进 `ScanBounds` 契约** —— 见 `src/tools/scan_bounds.ts`；
口径收紧的"少做了什么"现在走 `data.bounds.skipped`，与其它扫仓库类工具**同一形状**。）


**改动 B** — 装包（**不要手抄 npm 命令**，钉版与 ABI 校验都在这条 CLI 里）：

```bash
npm run install-package install <lang>     # 例：npm run install-package install kotlin
npm run install-package list               # 复核：该行从 '–' 变 '✓'
```

> 为什么必须走 CLI：`src/tools/install_package_cli.ts: PACK_PINS` 钉的是与
> `tree-sitter@0.21` 核心**实测兼容**的版本；`verifyAbi` / `checkPrebuild` 会在装后校验 ABI
> 与平台预编译产物。手抄 `npm i tree-sitter-x` 容易踩 peer 约束。

### 1.2 ☆ 立刻拿到的能力：符号级（不用写一行代码）

| 能力 | 为什么立刻有 |
|---|---|
| `ast_parse_skeleton` | `kernel.ts: parseFileFull` → `traverseAndExtract` 按 `LANGUAGES.symbol_nodes` **通用**提符号；`buildSignature` 只对 go/python/rust/java 系/TS 系有特化，其余走通用尾部（`kernel.ts: buildSignature` L226-228 的通用分支）。声明里 `default: 'full_ast'` ⇒ 55/55 全绿。 |

⇒ **这就是"加一条 + 装包 = 自动启用"的全部**。代价 ≈ 0（不含查 grammar 节点名的功夫）。

### 1.3 表项加对了？三处自检都过才算

| 自检 | 怎么看 |
|---|---|
| 装没装 | `npm run install-package list` 该行 `✓` |
| 认不认得 | `probe.ts: isExtSupported(ext)` 非 null（`probe.ts: listSupportedExts`） |
| 提得出符号 | 对该语言文件跑 `ast_parse` / 建索引，`symbols` 非空 |

### 1.4 ★ 本层的门（不知道会撞红）

`tests/tools/lang_adapters.test.ts`：**任何在 `LANGUAGES` 声明了 `import_nodes` 的语言，
必须在 `kernel.ts: LANG_ADAPTERS` 有对应记录**（否则深度依赖提取会静默跳过 → 测试红）。
⇒ `import_nodes` 与 `LANG_ADAPTERS` 是**绑定的一对**，要么都加、要么都不加（§2.7/§2.8/§2.9 用得上）。

`tests/tools/install_package.test.ts`：**每个 `LANGUAGES` 条目都要在 install-package 清单里有行**
（`install_package_cli.ts: collect` 遍历 `LANGUAGES` 自动派生 ⇒ 一般不会漏，除非加了没 `pkg` 的条目）。

---

## 2. 第 ② 层：逐能力"补一处"清单

### 2.0 一张总表：12 个能力的分派位置 / 驱动方式 / TS 样板

| # | 能力 id | 分派位置（文件:函数） | 驱动方式 | TS 样板在哪 | 缺口 |
|---|---|---|---|---|---|
| 1 | `ast_parse_skeleton` | `ts_kernel/languages.ts: LANGUAGES` + `ts_kernel/kernel.ts: parseFileFull/traverseAndExtract` + `ts_kernel/probe.ts: isLanguageInstalled` | ★ **数据** | `LANGUAGES` 的 `typescript` 行 | 0 |
| 2 | `package_migration` | ★★ **数据（注册表）**：`application/refactor/package_migration/languages/registry.ts: PM_LANG_PACKAGES`；`core.ts` 只查表 | ★ **数据（注册表）**（2026-10-01 由"代码"改判） | `languages/go.ts: collectGoAliasEdits` | 49 |
| 3 | `rename_symbol` | ★★ **数据（注册表）**：`application/refactor/rename_symbol/languages/registry.ts: LANG_PACKAGES`（`ext → LangPackage`）；`core.ts` 只 `findLangPackage(defExt)` 查表 | ★ **数据（注册表）**（2026-10-01 由"代码"改判） | `languages/go.ts: renameGoSymbol`（每语言一个包） | 46 |
| 4 | `contract_gate` | ★★ **数据（注册表）**：`infrastructure/analysis/contract_gate/languages/registry.ts: CG_LANG_PACKAGES`（每包带 `exts`/`reserved`/`globals`/`collectSymbols`/`collectReferences`）；`langOfFile` 由各包 `exts` **派生** | ★ **数据（注册表）**（2026-10-01 由"代码"改判） | `languages/ts.ts: cgTsPackage`（`exts` 用内核权威 `TS_JS_EXTS`，**不要手抄**） | 46 |
| 5 | `extract_contracts` | `tools/extract_contracts.ts: extractContracts` → `parseShapeFields`/`scanConfigKeys`/`collectModuleVars`/`scanEffectCandidates` | **代码** | `scanTsEmits` + TS 默认路径 | 49 |
| 6 | `version_upgrade_detection` | `version_upgrade/adapters/registry.ts: adapters` 数组 + `adapterForLang`/`adapterForExt`/`adaptersForFile` | ★ **数据（注册表）** | `version_upgrade/adapters/node.ts: nodeAdapter` | 47 |
| 7 | `impact_analysis` | `impact/index.ts: buildImpactGraph`（**全文零语言分支**）→ 内核 `ts_kernel/kernel.ts: LANG_ADAPTERS` | ★ **数据（内核表）** | `kernel.ts: LANG_ADAPTERS.typescript` | 46 |
| 8 | `cross_repo_symbol_index` | `cross_repo/index.ts: buildProjectIndex`(L76) / `compareProjects`(L117)（**零语言分支**）→ `impact/index.ts` | ★ **数据（内核表）** | 同 #7 | 46 |
| 9 | `hybrid_precheck` | `hybrid/index.ts: precheckHybrid`(L284) → `readManifestDeps`(L176) + `MANIFEST_FILES`(L173)；符号支柱走 `cross_repo` | **半数据**（manifest 解析函数 + 内核表） | `parsePackageJsonDeps`(L89) | 46 |
| 10 | `behavior_baseline` | `behavior/index.ts: langOfFile` + `runHarness`（`switch`） | **代码** | `runNodeHarness`（node 家族） | 46 |
| 11 | `code_health` | `health/index.ts: estimateComplexity`（查 `COMPLEXITY_BRANCH_NODES`/`COMPLEXITY_LOGIC_NODES` 表）+ `collectImportBinds` | **混合**（复杂度=数据，未用 import=代码） | 表的 `typescript` 行 + `collectImportBinds` ts 分支 | 48 |
| 12 | `spring_mvc_layering` | `java_refactor/layering.ts: planSpringLayering/extractJavaTypes` + `java_refactor/executor.ts: javaExecutor` | **代码**，且 **Java 专属（设计如此，非缺口）** | 无（不该有） | 54（假缺口） |

> **一句话结论**：#1/#6/#7/#8 是**数据驱动**（改表/加适配器文件），**#3 自 2026-10-01 起也是数据驱动**（加一个语言包文件 + 登记一行），#11 的复杂度维度也是数据驱动；
> #2/#4/#5/#10 + #11 的未用 import 维度是**代码驱动**（真的要写语言特有逻辑）。
> **523 里约 1/3 是"加表项"级，约 2/3 是真实重活**（精确拆分见 §3.2）。
> ★ **#3 的改判过程值得照抄**：原来 6 个语言实现挤在一个 1920 行文件里、主函数是 5 条 `if (defExt === …)` 的 if 链
> ⇒ 加一门语言要**改核心文件**。拆成 `rename_symbol/languages/<lang>.ts` + 一张 `LANG_PACKAGES` 注册表之后，
> 加一门语言**核心一行不改**（详见 §2.2）。

---

### 2.1 `ast_parse_skeleton`（数据驱动）★ 成本最低

| 项 | 内容 |
|---|---|
| 落点 | `languages.ts: LANGUAGES`（表项）/ `kernel.ts: parseFileFull` ≥ `traverseAndExtract` + `traverseAndExtractImports` + `traverseAndExtractCalls` + `traverseAndExtractTypeRefs` |
| 照谁的样 | `LANGUAGES` 的 `typescript` 行（`symbol_nodes` 列了 7 个节点，含 `type_alias_declaration`/`enum_declaration`，见该行注释：type alias 不进 nodes 会导致 dead_deps 误剪） |
| 要几处 | **1 处**（表项）+ 装包。**不用改代码** |
| 判据 | 对样例文件跑内核对拍 → `symbols` 非空且 `end_line`/`qualified_name` 正确；`npm run test -- tests/tools/ts_kernel.test.ts` |

★ **注意"符号级 ≠ 四产出"**：`parseFileFull` 的 4 个产出里，
**符号** 靠 `symbol_nodes`（数据）；**import 边** 靠 `LANG_ADAPTERS[x].extractImportSources`（数据，见 §2.7）；
**调用边** 靠 `LANG_ADAPTERS[x].callNode`（数据）；**类型引用边** 只有 TS 系（`kernel.ts: traverseAndExtractTypeRefs`）。
⇒ 声明里 `ast_parse_skeleton` 一句 `default: 'full_ast'` 覆盖全部 55 门，
**但实测**：55 门里只有 11 门有 `callNode`、只有 11 门有 import 适配（`rust`/`php` 算上）。
**这个声明的 label（"符号/import/调用边/类型引用 提取"）对那 44 门是过度承诺**（诚实标注，见 §5.3）。

---

### 2.2 `rename_symbol`（★ 2026-10-01 起：**数据驱动**）

| 项 | 内容 |
|---|---|
| 分派点 | **`application/refactor/rename_symbol/languages/registry.ts: LANG_PACKAGES`** —— ★ **一张表**。`core.ts` 里 `findLangPackage(defExt)` 查表后 `pkg.rename(args)`；**core 零语言知识** |
| 各语言实现 | `languages/<lang>.ts` **每语言一个文件**：`typescript.ts` / `go.ts` / `python.ts` / `csharp.ts` / `java.ts` / `c.ts` |
| **TS 样板** | `languages/go.ts: renameGoSymbol`（最通用的"跨文件同名可见性"样板）；`languages/typescript.ts: renameTsSymbol`（TS 家族，最重） |
| **要几处** | ★★ **1 处新文件 + 1 行登记**：① 写 `languages/<lang>.ts`（导出 `rename<Lang>Symbol(args: LangRenameArgs)`），② 在 `LANG_PACKAGES` 加一行 `{ exts: ['.xx'], rename: renameXxxSymbol }`。**`core.ts` 一行都不用改**（2026-10-01 之前是"改主函数的 if 链 + 写实现"两处，且每次都要重跑全量+更新基线） |
| 契约 | `parts.ts` 的 `LangRenameArgs` / `LangPackage`（语言无关接线层；**不是** `languages/types.ts` —— 那样会被 dep-cruiser 判孤儿，见该文件的注释） |
| 判据 | `tests/tools/rename_symbol.test.ts` + 新增该语言的样例对拍（同包裸引用 / 跨包限定引用 / 别名 / 局部遮蔽四类）+ **`npm run arch` 必须仍 0 违规** |
| 非 TS 落点的提示 | `core.ts` 的 `文件非 TS 系（…）` 与 `languages/typescript.ts` 的 `无可用 TS 解析器…` —— 这两处是 §6 要升级的提示 |

**点破**（2026-10-01 拆分后）：`renameNamespaceSymbol` 仍在 `languages/java.ts` 里，**被 `.cs` 与 `.java` 两个包共用**（同一个 `LangPackage` 挂两个 ext，或两行登记同一实现）
—— 即**同一套逻辑用 ext 参数化**。后面补 kotlin/swift 这类"包/命名空间 + 类型跨文件"的语言，**再复用这一份**（不是每次重写）。
`renameGoSymbol` 与 `renamePythonSymbol` 各自处理了本语言的同模块可见性规则，不宜硬套。

★ **拆分时踩到的两个坑**（照抄形状时别重踩）：
1. **"大家都要用的零件"放错位置就成环**：语言包和 `core` 都要用的 `N` / `applyEdits` / `collectFilesByExt` 等，
   原来住在 `core.ts` ⇒ `core → registry → 语言包 → core`，`arch` 一次报 **9 条 no-circular**。
   抽到 `parts.ts` 后回边消失（`core → parts`、`包 → parts`）。**判据：`npm run arch` 必须 0 违规**。
2. **`project_root` 不要 import barrel**：它只要 `analyzeModuleSource`，却 import 了 `rename_symbol/index.js`
   ⇒ 把整棵树拉进环。改指**叶子包** `rename_symbol/languages/typescript.js` 后，环从 3 条收缩为**原本就存在的那 1 条**
   （`project_root ⟷ rename_symbol`，本就登记在 `.dependency-cruiser-known-violations.json` 里）。

---

### 2.3 `contract_gate`（代码驱动，**但内部是正则而非 AST —— 成本比想象低**）

| 项 | 内容 |
|---|---|
| 分派点 | `tools/contract_gate.ts: langOfFile`（L163）—— 一串 `rel.endsWith('.go')` / 正则 → 返回 `Lang` 联合（L31: `'go'\|'ts'\|'py'\|'java'\|'cs'\|'c'`） |
| 要几处（**5 处**） | ① `Lang` 联合加成员（L31）；② `langOfFile` 加一个 `endsWith`/正则（L163）；③ `langSkipSet` 加保留字集（L291，照 `GO_RESERVED`/`JAVA_RESERVED`）；④ `collectSymbols` 加一个 `else if` 分支（L306，TS 是最后的 `else`，L419）；⑤ `scanOne` 加内建全局白名单（L465，照 L479 的 java 那行） |
| **TS 样板** | `collectSymbols` 的 **`else` 分支（L419「TS 顶层声明」）**；JS 家族走 `langOfFile` 的 `.ts/.tsx/.js/.jsx/.mjs/.cjs → 'ts'`（L166） |
| ★ 关键事实 | 这个能力的 `cleanSource`/`collectSymbols`/`collectReferences` **全是 `text.matchAll(...)` 正则**，**不建 AST**（对比 §2.2 的 `rename_symbol` / §2.5 的 `package_migration` 是真 AST）。⇒ 补一门语言 = **写几个正则 + 一个保留字集**，比 `rename_symbol` 便宜一个数量级；代价是精度（它本来的定位就是"重构后的粗网对账闸"）。 |
| 判据 | `tests/tools/contract_gate.test.ts` + 该语言"裸标识符定义源"样例 |
| ★ 静默点 | `scanContracts` L506 `if (!l) continue;` —— **`langOfFile` 返回 null 的文件被静默跳过**（不报错、不提示）。**这类文件数不会进报告** ⇒ 属于 §6 要补提示的地方 |

---

### 2.4 `extract_contracts`（代码驱动）

| 项 | 内容 |
|---|---|
| 分派点 | `tools/extract_contracts.ts: extractContracts`（L512 起）→ 语言来自 `langOf`（索引里的 `langName`，L270 的推断兜底：`.go`→go / `.py`→python / 其余→ts） |
| 要几处（**5 处**） | ① `isPyLang` 这类**语言判定**加一条（L204）；② `parseShapeFields`（shape 注解属性，L208）；③ `scanConfigKeys` 的**环境变量正则表**（L301，照 `GO_ENV_RES`/`PY_ENV_RES`/`TS_ENV_RES`）；④ `collectModuleVars`（模块级变量收集，L318）；⑤ `scanEffectCandidates` 的 emits 扫描（L484，照 `scanGoEmits`/`scanTsEmits`/`scanPyEmits`） |
| **TS 样板** | `scanTsEmits`（L451）+ 默认 TS 路径；go 是最完整的"独立分支"样板（`GO_ENV_RES` + `collectModuleVars` go 分支 + `scanGoEmits` 三件套齐全） |
| 判据 | `tests/tools/extract_contracts.test.ts` + 该语言 shape/env/effect 三类样例 |

---

### 2.5 `package_migration`（代码驱动）

| 项 | 内容 |
|---|---|
| 分派点 | `tools/package_migration.ts: cleanAlias`（L447）—— `ext === '.go'` / `isTsJsExt` / `ext === '.py'` / **else → `cleanAliasRegex`（正则回退）** |
| 要几处（**2 处**） | ① `cleanAlias` 加一个 `else if (ext === '<ext>')`（L447）；② 写一对 `collect<Lang>Binds` + `collect<Lang>Usage`（照 `collectGoImportAliasEdits`/`collectGoSelectorEdits` 或 `collectTsBinds`/`collectTsUsage`），并包一个 `<lang>AliasEdits` 返回 `{ok,edits}` |
| **TS 样板** | `collectTsBinds`（L194）+ `collectTsUsage`（L250）+ `tsAliasEdits`（L271） |
| 判据 | 缺口在 `npm run capability` 里从「正则回退」升「AST 全量」；**另外要跑 `tests/tools/package_migration`**（若存在）与该语言的别名清洗样例 |
| ★ 回退是安全的 | `cleanAlias` 在 `!res.ok`（语言包缺失/解析失败）时**自动回退 `cleanAliasRegex`** —— 所以"没补"不会静默失效，只是精度低。**这也是 json/yaml/css 这类文件的"缺口"其实无害的原因（§4.2）** |

---

### 2.6 `version_upgrade_detection`（★ 数据驱动，已有一套完整适配器注册表）—— 照它抄

**这是全仓最成熟的"补语言 = 加一个文件 + 一行注册"样板，补别的能力时应以它为范式。**

| 项 | 内容 |
|---|---|
| 契约 | `version_upgrade/adapters/types.ts: LanguageAdapter`（顶部逐条列了 7 类"方言"：声明文件格式 / 版本比较 / 扩展名+特性·废弃API 规则表 / 本机版本探测命令 / 静态闸 / 动态闸 / 项目级验证命令组） |
| 注册表 | `version_upgrade/adapters/registry.ts: adapters`（L17 数组）+ `adapterForLang` / `adapterForExt` / `adaptersForFile` / `ALL_DECLARATION_FILES` / `ADAPTER_SKIP_DIRS`（全部由数组派生） |
| 要几处（**2 处**） | ① 新写一个 `version_upgrade/adapters/<lang>.ts` 导出 `<lang>Adapter`；② `registry.ts` 顶部 `import` + 加进 `adapters` 数组 |
| **TS/node 样板** | `version_upgrade/adapters/node.ts: nodeAdapter`（node 家族含 ts/tsx/js） |
| 判据 | `LanguageAdapter` 契约逐字段被新适配器满足（`tsc` 会报缺字段）；该语言 `.tool-versions`/声明文件被 `adaptersForFile` 命中 |
| 注释里的原话 | `registry.ts` 顶部：「新增语言：写一个适配器文件 → 在本文件 import 并加入 adapters 数组即可。」 |
| ★ 顺带注意 | `version_upgrade/detect.ts: FEATURE_EXTS`（L28）**硬编码了 `['java','go','node','python']`**（漏了 `csharp`/`c`）。实测该导出**全仓无人引用**（死导出）⇒ 现在不阻塞，但补语言时**别照它抄**；真要复用应改成从 `adapters` 派生。 |

---

### 2.7 `impact_analysis`（★ 数据驱动，内核表）—— 实测零语言分支

| 项 | 内容 |
|---|---|
| 落点 | `impact/index.ts: buildImpactGraph` —— 实测**全文零语言分支**：它只用 `parseFileFull` + `listSupportedExtensions()` + `resolveImportPath`（`impact/index.ts` 顶部注释的"v1 边界"也确认它不解析包导入）。**语言差异全部来自内核**。 |
| 真正要改的 | `ts_kernel/kernel.ts: LANG_ADAPTERS`（L353 表）加一条：`{ callNode: '<该语言调用表达式节点>' }`（要 import 边再给 `extractImportSources`，并在 `LANGUAGES` 补 `import_nodes`，见 §1.4 的门） |
| **TS 样板** | `LANG_ADAPTERS.typescript`（只需 `{ callNode: 'call_expression' }`，因为 TS 的 import 走 `kernel.ts: extractImportSources` 的 TS 通用分支）。要 import 边又不想写正则的，照 go/python 那种给 `extractImportSources`/`extractImportBindings`。 |
| 要几处 | **1 处**（LANG_ADAPTERS 一行）+ 声明（§5） |
| 判据 | ★ **实测过**：给 `a.rs` 跑 `parseFileFull`，`calls` 产出 `main->helper`（rust 的 `callNode` 已在表里）⇒ **只靠表项就能拿到调用边**。判据 = 对样例跑 `analyzeImpact`/`buildImpactGraph`，`sites` 里 `kind:'call'` 有命中。 |

★ **这条是本次最重要的正向发现**：`impact_analysis` 的 46 个缺口里，**绝大多数是"表里加一行"级别的**
（前提是该语言的调用节点是单一 node type；PHP 那种要数组 `callNode`，表里已支持 `string[]`）。

---

### 2.8 `cross_repo_symbol_index`（★ 数据驱动，同 #7）

| 项 | 内容 |
|---|---|
| 落点 | `cross_repo/index.ts`（L23 `import { buildImpactGraph }`）—— 零语言分支，"顶层符号"直接复用 impact 的索引 |
| 要几处 | **0 处新增**（#7 补了内核表后它自动获益）+ 声明 |
| 判据 | `tests/cross_repo/` 下对拍两仓样例，`symbols` 非空、冲突/双胞胎分类正确 |

---

### 2.9 `hybrid_precheck`（半数据）

| 项 | 内容 |
|---|---|
| 落点 | ① 符号支柱：`cross_repo/index.ts`（→ #7/#8）；② 依赖支柱：`hybrid/index.ts: readManifestDeps`（L176）+ `MANIFEST_FILES`（L173: `package.json`/`go.mod`/`pyproject.toml`/`requirements.txt`）+ `parsePackageJsonDeps`/`parseGoModDeps`/`parsePyprojectDeps`/`parseRequirementsDeps` |
| 要几处 | 符号支柱 **0 处**（随 #7）；依赖支柱 **1 处**（`MANIFEST_FILES` 加一个文件名 + 一个 `parse<X>Deps` 纯函数） |
| **TS 样板** | `parsePackageJsonDeps`（L88，读 `dependencies`+`devDependencies`） |
| 判据 | `tests/hybrid/` 对拍两仓样例，`deps.conflicts` 命中 |

---

### 2.10 `behavior_baseline`（代码驱动 —— 要为该语言写一个 harness）

| 项 | 内容 |
|---|---|
| 分派点 | `behavior/index.ts: langOfFile`（L55，扩展名 → `BehaviorLang`）+ `runHarness`（L939，`switch` 六分支：python/node/go/java/csharp/c） |
| 要几处（**4 处**） | ① `BehaviorLang` 联合加成员（L52）；② `langOfFile` 加 `ext === '<ext>'`（L55）；③ 新写 `run<Lang>Harness(spec)`（要真编译/真跑该语言的代码）；④ `runHarness` 加 `case`（L940） |
| **TS 样板** | `runNodeHarness`（node 家族：`typescript.transpileModule` → CJS → node 子进程；含 `Set/Map` 排序化 repr）。**编译语言样板**照 `runGoHarness`/`runJavaHarness`/`runCsHarness`/`runCHarness`（写临时工程 → `go run`/`javac+java`/`dotnet run`/`cc`） |
| 要几处之外 | ★ **该语言的工具链必须在机器上**（go/javac/dotnet/cc）；缺则按现有约定**报"不可用"**（`behavior/index.ts` 里各 harness 的 error 分支）—— 这是**诚实的失败**，不是假装跑过 |
| 判据 | 同文件 `captureBaseline`/`verifyBaseline` 对拍；`tests/behavior/` |
| ★ 提示缺陷 | `langOfFile` 对未知扩展**直接 `throw`**（L63），提示只列了"支持 .py/.js…" —— **没告诉你怎么补**（§6） |

---

### 2.11 `code_health`（混合：复杂度=数据，未用 import=代码）

| 维度 | 落点 | 驱动 | 要几处 |
|---|---|---|---|
| 圈复杂度 | `health/index.ts: estimateComplexity`（L213）查 `COMPLEXITY_BRANCH_NODES`（L189）+ `COMPLEXITY_LOGIC_NODES`（L199）两张表 | ★ **数据** | **2 处**（各加一行数组） |
| 未用 import | `health/index.ts: collectImportBinds`（L288，`go` 分支 / `python` 分支 / `java` 分支 / TS 默认） | **代码** | **1 处**（加一个 `else if (lang === '<lang>')` 分支） |
| 未用导出/孤儿/分层 | 走导入+调用边反查（依赖内核表；`detect_dead_imports.ts` 也有 `lang === 'go'` 分支） | 半数据 | 随 #7 |
| **TS 样板** | 表：`COMPLEXITY_BRANCH_NODES.typescript`（L190，9 个分支节点）；函数：`collectImportBinds` 的 TS 默认尾 |
| 判据 | `tests/health/`；复杂度对样例文件手算对拍 |
| ★ 落空即回退 | `estimateComplexity` 在无解析器时回退 `estimateComplexityRegex`（L237）—— 不补也能跑，只是精度低 |

---

### 2.12 `spring_mvc_layering`（**Java 专属，不该补** → §4.1）

| 项 | 内容 |
|---|---|
| 落点 | `java_refactor/layering.ts: planSpringLayering`（L235）/`extractJavaTypes`（L182）/`layerForType` + `java_refactor/executor.ts: javaExecutor`（`isSourceFile: rel.endsWith('.java')`） |
| 机制 | 不是独立 MCP 工具，而是 **Java 语言执行器的 `stages`**，经 `tools/refactor_pipeline.ts: registerRefactorLanguage`/`DEFAULT_LANGS` 注册 —— 随 Java 工程探明自动拾取 |
| **结论** | 缺 54 门语言 = **设计如此**（Spring MVC 就是 Java 框架）。**不动它**。 |

---

## 3. 缺口清单（按能力分组）与优先级

### 3.1 原始数据（实测：`npm run capability`）

```
🔧 缺口总计 523 个「功能×语言」对

 54  spring_mvc_layering      （含 54 门非 Java —— ★ 假缺口，见 §4.1）
 49  package_migration
 49  extract_contracts
 48  code_health
 47  version_upgrade_detection
 46  rename_symbol
 46  contract_gate
 46  impact_analysis
 46  cross_repo_symbol_index
 46  hybrid_precheck
 46  behavior_baseline
```

### 3.2 ★ 按"补齐成本"重排（这是本清单真正的价值）

| 档 | 能力（缺口数） | 小计 | 单门成本 | 为什么 |
|---|---|---|---|---|
| **E. 不该补** | `spring_mvc_layering`（54） | **54** | — | Java 专属，非缺口，见 §4.1 |
| **A. 加表项级** | `impact_analysis`(46) + `cross_repo_symbol_index`(46) + `hybrid_precheck`(46) | **138** | **1 行/门**（内核 `LANG_ADAPTERS`） | 三个能力零语言分支；实测 rust 靠表项就出调用边 |
| **B. 加一个适配器文件** | `version_upgrade_detection`(47) | **47** | **1 文件 + 1 行注册** | 契约/注册表已完备（§2.6） |
| **C. 写一对采集函数** | `package_migration`(49) | **49** | ~2 函数 + 1 分支 | 有正则回退兜底，可低优先 |
| **D. 写一套语义（重活）** | `rename_symbol`(46) + `contract_gate`(46) + `extract_contracts`(49) + `behavior_baseline`(46) + `code_health`(48) | **235** | 1–5 处 + 100–300 行/门 | 真的要懂该语言的作用域/可见性/编译运行（`code_health` 含数据驱动的复杂度维度，但要整能力升档仍需写 `collectImportBinds`，故整条计入 D） |

**对账**：54 + 138 + 47 + 49 + 235 = **523** ✓（与 `npm run capability` 的缺口总数相等）

**⇒ 正向结论**：523 里 **185（35%）是"加表项 / 加适配器文件"级**（A+B，几乎零设计工作）；
连 C（加一对函数、且有正则兜底）算上，**约 234（45%）是低成本档**。
**⇒ 负向结论**：**235（45%）是真·重活**（D 档），其中 `rename_symbol` / `behavior_baseline` 单门最贵
（前者 100–300 行、后者还要机器上有该语言工具链）。
**⇒ 所以"523 个缺口"不是 523 份苦工，而是 ≈ 4.5 : 4.5 的"表项活 : 语义活"**——但语义活那一半，一门语言只做一次就能覆盖 5 个能力（它们共享内核索引）。

### 3.3 ★ 优先级：先补"一门语言收益最大"的能力

**判据**：单门成本 ÷ 覆盖能力数。**应按能力补，不按语言补**（用户指定的分组方式）。

| 优先 | 做什么 | 为什么收益最大 |
|---|---|---|
| **P0** | 把 A 档（`LANG_ADAPTERS`）**先铺满**：查每门语言 grammar 的调用表达式节点名，一次补 N 行 | **一行换 3 个能力**（impact/cross_repo/hybrid），138 缺口里的大头一次清掉；且零风险（只增边） |
| **P1** | `version_upgrade_detection` 补适配器（B 档） | **一文件换 1 个能力**，且有现成契约与样板（node.ts），47 缺口 |
| **P2** | `code_health` 的**复杂度**两张表铺满（`COMPLEXITY_*`）+ `package_migration` 的采集函数（C 档） | 都是"表/函数"级，风险低；`package_migration` 有正则回退兜底，不补也无害（补了是把"正则回退"升成"AST 全量"，精度收益而非功能收益） |
| **P3** | `rename_symbol` / `contract_gate` / `extract_contracts` / `behavior_baseline` | 重活，按**目标语言的实际需求**挑（别为凑数补）；`rename_symbol` 缺口 46 门但单门最贵 |

★ **反向优先级提醒**：不要为了"把缺口数字打到 0"去补 D 档。
`behavior_baseline` 对每门语言都要机器上装该语言工具链，补了也常年在"不可用"。

---

## 4. 反向清单：哪些"看起来该补但实际不该补"

### 4.1 `spring_mvc_layering` 缺 54 门 —— **正确，不是缺口** ★

Spring MVC 是 Java 框架。它**不该**有任何非 Java 分支。
它在矩阵里显示 54 个缺口，纯粹因为它 `default: 'unimplemented'`（见 `register_capabilities.ts` 该条的注释：
「非独立工具：作为 javaExecutor.stages 的 spring_mvc_layering 随 Java 项目探明自动拾取」）。
⇒ **不要"补"它**；正确做法是 §5 的"声明层"处理（把 default 语义讲清 / 或让它不进缺口统计）。

### 4.2 非代码文件的 `package_migration` 缺口（css/html/json/yaml/toml/xml/markdown/latex…）—— **低价值**

`package_migration` 的语义是"包改名 + 别名清洗"（Go/TS/Python 的 import 别名作用域）。
对 `json`/`yaml`/`css`/`markdown` 这类文件，"别名清洗"**没有语义**。
它们是"缺口"只因为 `default: 'regex_fallback'` ⇒ 对**所有**非 go/ts/py 语言都记一笔。
⇒ **不值得补**；真要清零，应改声明（给这些语言显式标 `unimplemented` 并加 note 说明"该语言无包别名概念"）。

### 4.3 已"过度保守"的声明 —— **不是缺口，是声明落后**（实测）

实测：`rust` 在 `LANG_ADAPTERS` 里有 `callNode: 'call_expression'`，
对 `a.rs` 跑 `parseFileFull` 得到 `calls: main->helper`（**真出调用边**）；
但 `register_capabilities.ts` 的 `impact_analysis` overrides **没有 rust** ⇒ 矩阵把 rust 记成"未实现"。
同理 `php` 有 `callNode` 也不在 impact/cross_repo/hybrid 的 overrides 里。
⇒ **这 2 门 × 3 能力 = 6 个是假缺口**（写文档时实测发现）。
⇒ 正确动作是**补声明**（§5），不是补代码。

★★ **这不是我一个人的判断——仓库已有门自动报了同一件事**（`node scripts/capability_scan.mjs --check`，§0.3）：
> `impact_analysis: 实现含全语言解析 API（见 src/impact/index.ts）→ 对所有已装语言生效；声明只覆盖 …，请确认是否写窄`

⇒ 所以 §3.2 的 A 档 138 个缺口里，**至少有这些是"改声明就能清"的**（先清声明、再补真代码）。
**顺序建议**：先跑 `capability_scan.mjs --check` 把"声明写窄"的都改宽 ⇒ 缺口数下降**且**名实相符；
再按 §3.3 补真能力。

### 4.4 `tsx` / `jsx` —— **不要像新语言那样加**

它们是**派生语法**：`tsx` 随 `tree-sitter-typescript`、`jsx` 随 `tree-sitter-javascript`
（`install_package_cli.ts: DERIVED`，CLI 会拒绝独立 install/uninstall）。
`LANGUAGES` 里它们各自有行（因为树不同/节点不同），但**装包**这一步对它们无效。

### 4.5 非深适配语言不该硬塞进 `rename_symbol` / `contract_gate`

对 `bash`/`sql`/`graphql`/`protobuf`/`rego`/`cue`/`hcl` 这类**没有"跨文件符号作用域"概念**的语言，
`rename_symbol` 的"跨文件 import 边改名"语义**不存在**。
⇒ 它们的缺口是**语义上不该补**（可以补声明标注，别写代码）。
判断法：该语言有没有"模块/包 + import 绑定名"这套概念？没有就不属于 `rename_symbol` 的适用域。

---

## 5. 验证闭环

### 5.1 三步闭环（缺一不可）

```bash
# ① 代码/数据改动落地
npm run build

# ② 声明层同步（★ 不改这里，缺口数字不会动）
#    在 src/tools/register_capabilities.ts 对应的 declareCapability(...) 里，
#    把该语言的 overrides[<lang>] 设成真实档位（full_ast / partial_ast / regex_fallback）
#    要新增一个能力维度时，才用 declareCapability({ id, label, desc, default, overrides })

# ③ 判据：缺口数必须下降
npm run capability
npm run capability -- --installed     # 只看已装语言（doctor 用的就是这条）
node scripts/capability_scan.mjs --check   # 库存一致性门，退出码 0
```

### 5.2 每类改动的对拍测试（别只信 capability 数字）

| 改了 | 必须跑 |
|---|---|
| `LANGUAGES` / `LANG_ADAPTERS` | `npm run test -- tests/tools/lang_adapters.test.ts tests/tools/ts_kernel.test.ts tests/tools/ts_kernel_bindings.test.ts` |
| 装包/清单 | `npm run test -- tests/tools/install_package.test.ts` |
| 矩阵/声明 | `npm run test -- tests/tools/capability_matrix.test.ts tests/tools/capability_map.test.ts` |
| `rename_symbol` | `npm run test -- tests/tools/rename_symbol.test.ts tests/tools/rename_symbols.test.ts` |
| `contract_gate` | `npm run test -- tests/tools/contract_gate.test.ts` |
| `extract_contracts` | `npm run test -- tests/tools/extract_contracts.test.ts` |
| `code_health` | `npm run test -- tests/health/` |
| `behavior_baseline` | `npm run test -- tests/behavior/` |
| `impact`/`cross_repo`/`hybrid` | `npm run test -- tests/impact/ tests/cross_repo/ tests/hybrid/` |
| `version_upgrade` | `npm run test -- tests/version_upgrade`（实测目录存在：`adapters.test.ts`/`features.test.ts`/`gate.test.ts`/`removed.test.ts`/`rewrite.test.ts`）+ `npm run doctor` |
| 解析层级（call/symbol/none） | `npm run test -- tests/tools/parse_capability.test.ts` |

### 5.3 ★ 诚实的边界（capability 数字的三个坑）

1. **声明驱动**：数字来自 `register_capabilities.ts`（§0.3），不是自动测量。
2. **过度承诺**：`ast_parse_skeleton` 的 label 是"4 产出"，但对 44 门非深适配语言只有**符号**产出
   （无 import/调用/类型引用边）。真实的"能看见什么"以 `src/tools/parse_capability.ts: tierForLanguage`
   为准（`call`/`symbol`/`none`）—— **它是从内核表实测推导的**，比矩阵更可信。
3. **保守滞后**：声明可以落后于代码（§4.3 的 rust/php 实证）⇒ 缺口数是**上界**。

⇒ 因此：**capability 输出变化是"必要条件"而非"充分条件"**。
充分条件 = capability 缺口 ↓ **且** 5.2 的对拍测试过 **且** 该语言真实样例（`symbols`/`calls`/改名命中等）正确。

### 5.4 doctor 已内置缺口自检

`scripts/setup.mjs`（`npm run doctor`）第 6 段已经跑 `capability_cli --installed --json` 并打印缺口
（**缺口不算 fail**，只给 warn —— 设计如此：新语言/新功能待补是正常状态）。
⇒ 补完一门语言后，`npm run doctor` 的"能力矩阵"行数字应下降。

---

## 6. 缺失提示升级方案（**只给方案，本笔不改代码**）

### 6.1 现状（实测：全仓只有 5 处"缺失"文案，都不可执行）

| 文件:函数 | 现状文案 | 问题 |
|---|---|---|
| `ts_kernel/kernel.ts: parseFileFull`（L906） | `语言包加载失败: ${lang}` | 不说是哪个 npm 包 / 怎么装 |
| `tools/rename_symbol.ts: renameSymbol`（L1707） | `文件非 TS 系（${defExt}），跨文件改名暂只支持 TS/JS 模块级符号` | 不说怎么补 |
| `tools/rename_symbol.ts: renameSymbol`（L1764） | `无可用 TS 解析器：该扩展名的语法未加载` | ★ 用户点名的这句，零可执行信息 |
| `behavior/index.ts: langOfFile`（L63） | `不支持的脚本语言（${ext}）：行为基线支持 .py / …` | 只列"已支持"，不说怎么补 |
| `tools/parse_capability.ts: granularityOf`（L47-58，`'none'` 分支 L53） | `…= 不建符号索引（解析器未安装…）` | 方向对，但没给包名 / 清单 / 缺口数 |
| `tools/contract_gate.ts: scanContracts`（L506） | `if (!l) continue;` —— **静默跳过** | 连提示都没有 |

### 6.2 目标：一句**可执行**的提示

用户要求「缺失时提示下载或自己开发补齐」。设计一个**纯函数**统一生成：

**新增** `src/tools/lang_hint.ts`（纯函数、可单测、零 IO）：

```ts
/** 缺失语言能力提示。capabilityId 可选：给了就带上"本能力缺多少门"。 */
export function missingLanguageHint(ext: string, capabilityId?: string): string;
```

产出（示例，`ext='.kt'`）：

```
⚠ 语言能力缺失：.kt（kotlin）
  原因：① 不在 LANGUAGES 注册表 / ② 语言包未装 / ③ 该能力对 kotlin 仍是「未实现」
  装包：npm run install-package install kotlin      （或 npm i tree-sitter-kotlin@<钉版>，钉版见 install_package_cli.ts: PACK_PINS）
  补齐：照 docs/adding-a-language.md §2.<本能力> 的清单改（样板语言：typescript）
        · 只要符号级 ⇒ 2 步（languages.ts: LANGUAGES + 装包）
        · 要调用/依赖边 ⇒ 再加 kernel.ts: LANG_ADAPTERS 一行
  现状：npm run capability → 缺口总计 523 个「功能×语言」对（本能力 rename_symbol 缺 46 门）
```

**数据来源（全在仓内、纯计算）**：

| 提示里的字段 | 从哪来 |
|---|---|
| 该 ext 是不是注册语言 | `ts_kernel/languages.ts: findLanguageByExt` |
| 包装了没 | `ts_kernel/probe.ts: isExtSupported` / `listSupportedPackages` 类入口（现为 `isLanguageInstalled`） |
| npm 包名 + 钉版 | `install_package_cli.ts: collect`（`LangPackRow.pkg`/`pin`） |
| 是不是深适配（有没有边） | `ts_kernel/kernel.ts: LANG_ADAPTERS` / `parse_capability.ts: tierForLanguage` |
| 该能力的当前档位与缺口门数 | `capability_matrix.ts: allCapabilities` + `levelFor` + `aggregateGaps` |
| 该能力该照谁抄 | 新增一张 `CAPABILITY_TS_SAMPLE: Record<string, string>`（值 = §2 的样板函数名） |

### 6.3 该改哪几个文件（接线点）

| # | 文件 | 改什么 |
|---|---|---|
| 1 | **新增** `src/tools/lang_hint.ts` | `missingLanguageHint(ext, capabilityId?)` 纯函数（上表数据源） |
| 2 | `src/tools/parse_capability.ts: granularityOf` / `renderGranularityNote` | `tier==='none'\|'symbol'` 时把 §6.2 那句追加进去（**这是最通用的落点**：所有行动类工具都走它） |
| 3 | `src/tools/ts_kernel/kernel.ts: parseFileFull`（L906）与 `parseFileFullSync`（L957） | `error` 文案换成 `missingLanguageHint(ext)`（`.ts` 家族仍走原 TS 提示） |
| 4 | `src/tools/rename_symbol.ts: renameSymbol`（L1707 与 L1764） | 两处 blocked/skipped 文案追加 `missingLanguageHint(defExt, 'rename_symbol')` |
| 5 | `src/tools/contract_gate.ts: scanContracts`（L506） | `if (!l) continue` → 收集 skipped 列表，报告末尾段输出 `missingLanguageHint(ext, 'contract_gate')`（**消灭静默跳过**） |
| 6 | `src/behavior/index.ts: langOfFile`（L63） | `throw` 文案追加 `missingLanguageHint(ext, 'behavior_baseline')` |
| 7 | `src/version_upgrade/adapters/registry.ts: adapterForLang/adapterForExt` | 取不到适配器时返回原因串 `missingLanguageHint(ext, 'version_upgrade_detection')`（现返回 `undefined`） |
| 8 | `scripts/setup.mjs`（doctor 第 6 段） | 已打印缺口；把"优先补哪档"一句话（§3.3）加进去即可，**无需新机制** |

★ **优先级建议**：#1 + #2 先做（一处覆盖最多工具、且纯函数好测），其余按需接线。

### 6.4 自检（接线后应满足）

- `missingLanguageHint('.kt')` 含 **包名 `tree-sitter-kotlin`** + **`npm run install-package install kotlin`** + **指向 `docs/adding-a-language.md`**。
- 传 `capabilityId` 时，句尾的"缺 N 门"与 `npm run capability` 的实际缺口数**一致**（防漂移，可加单测断言）。
- `contract_gate` 对 `.kt` 文件不再静默跳过（报告里有 skipped 段）。

---

## 附录 A · 文件 → 能力 索引（改哪个文件影响哪个能力）

| 文件 | 影响的能力 |
|---|---|
| `ts_kernel/languages.ts` | #1（+所有能力的基石） |
| `ts_kernel/kernel.ts`（`LANG_ADAPTERS`/`parseFileFull`） | #1 #7 #8 #9 #11（导出/孤儿/分层） |
| `ts_kernel/probe.ts` | #1（"装了没"的唯一判据） |
| `tools/install_package_cli.ts` | 装包路径（`PACK_PINS`/`DERIVED`） |
| `tools/parse_capability.ts` | 解析层级自述（`call`/`symbol`/`none`） |
| `tools/register_capabilities.ts` | 12 项声明（**改这里才动 capability 数字**） |
| `tools/package_migration.ts` | #2 |
| `tools/rename_symbol.ts` | #3 |
| `tools/contract_gate.ts` | #4 |
| `tools/extract_contracts.ts` | #5 |
| `version_upgrade/adapters/*.ts` + `registry.ts` | #6 |
| `impact/index.ts` | #7（**零语言分支**） |
| `cross_repo/index.ts` | #8（**零语言分支**） |
| `hybrid/index.ts` | #9（manifest 解析） |
| `behavior/index.ts` | #10 |
| `health/index.ts` | #11 |
| `java_refactor/layering.ts` + `executor.ts` | #12（Java 专属） |
| `tools/refactor_pipeline.ts`（`DEFAULT_LANGS`/`registerRefactorLanguage`） | 重构执行器注册入口（新语言新路径的官方挂点） |
| `tools/refactor_langs.ts`（`LanguageRefactorExecutor`） | 同上契约 |

## 附录 B · 修了哪层，怎么验（速查）

| 只动了 | 命令 | 期望 |
|---|---|---|
| `LANGUAGES` + 装包 | `npm run install-package list` → `npm run capability` | 该语言 `ast_parse_skeleton` 亮；`--installed` 里它进名单 |
| `LANG_ADAPTERS` 加行 | 对样例跑 `parseFileFull` | `calls` 非空；`tests/tools/lang_adapters.test.ts` 绿 |
| 声明 `overrides` | `npm run capability` | 对应缺口数**减少**（这是唯一直接判据） |
| 语义能力（写函数） | 该能力的对拍测试 + 真实样例 | 结果正确（`npm run capability` 只是附带） |
| 一切 | `npm run build && npm run test && node scripts/capability_scan.mjs --check` | 全绿 |

## 附录 C · 本次实测的关键数字（供后续引用）

| 量 | 值 | 怎么来的 |
|---|---|---|
| 语言总数 | 55 | `npm run capability` 头部「语言名单全量（55 门）」 |
| 能力数 | 12 | `npm run capability` 尾部功能名单 |
| 缺口总数 | 523 | 同上 |
| 有 `callNode`（调用级）的语言 | **11**（ts, tsx, js, jsx, go, python, java, c, c_sharp, rust, php） | `LANG_ADAPTERS` 实测遍历 |
| 有 `extractImportSources`（import 边）的语言 | **7**（go, python, java, c, c_sharp, rust, php；TS 系走 `kernel.ts: extractImportSources` 通用分支，实际 11） | 同上 |
| 仅符号级的语言 | **44** | 55 − 11 |
| `src/tools` 行数 | 73,323 | `find src/tools -name '*.ts' \| xargs wc -l` |
| `src` 总行数 | 111,870 | 同上 |
| `rename_symbol.ts` 行数 | 1,881 | `wc -l` |
| 全仓含语言字面量分支的文件 | **19** 个 / **78** 处 | `grep -rE "=== '(go\|python\|java\|…)'"`（不含 `defExt === '.go'` 这类扩展名比较） |
