/**
 * register_capabilities —— 现有多语言功能的支持度登记（能力矩阵的数据填充）
 *
 * 每个登记项声明：功能 id / 默认支持度 / 逐语言覆盖。
 * 依据来自各工具的既有实现（实测分支点），不是臆造：
 *   - package_migration 的 cleanAlias：Go/TS 家族/Python 已走 AST 作用域守卫；
 *     其余语言仍回退正则（cleanAliasRegex）。
 *   - rename_symbol / contract_gate：只实现了 go + ts 两条分支。
 *   - ts_kernel 的 parseFileFull：对 LANGUAGES 里"已安装"的语言做 符号/import/调用边/类型引用
 *     四产出，是通用 AST 根基（full_ast 覆盖全部已装语言）。
 *
 * 未来新功能：在本文件追加 `declareCapability({...})` 即可自动进入矩阵，
 * 无需改动 audit 主流程。
 */

import { declareCapability } from './capability_matrix.js';

/** 通用性：一棵语言解析产出的能力（符号/import/调用边/类型引用）——凡是 ts_kernel 能解析的语言都 full_ast */
declareCapability({
  id: 'ast_parse_skeleton',
  label: '符号/import/调用边/类型引用 提取',
  desc: 'ts_kernel parseFileFull 的四产出；凡装了解析器的语言都全量支持',
  default: 'full_ast',
});

/** 包改名/提级：别名清洗已 AST 化，仅 Go/TS 家族/Python 走守卫，其余回退正则 */
declareCapability({
  id: 'package_migration',
  label: '包改名/提级（含别名清洗）',
  desc: '别名清洗 AST 作用域守卫：Go/TS 家族/Python 全量；其余语言正则回退',
  default: 'regex_fallback',
  overrides: {
    go: 'full_ast',
    typescript: 'full_ast',
    tsx: 'full_ast',
    javascript: 'full_ast',
    jsx: 'full_ast',
    python: 'full_ast',
  },
  notes: {
    go: 'collectGoImportAliasEdits / collectGoSelectorEdits（AST 守卫）',
    typescript: 'collectTsBinds / collectTsUsage',
    python: 'collectPyBinds / collectPyUsage',
    javascript: '经由 tsAliasEdits 同一路径（import_statement 结构一致）',
  },
});

/** 符号改名：TS 家族全量；Go/Python/C#/Java 支持模块级符号 + 跨文件引用 */
declareCapability({
  id: 'rename_symbol',
  label: '符号改名（作用域解析 + 跨文件 import 边）',
  desc: 'TS 家族（作用域解析 + import/reexport 边）全量；Go 同包+跨包 pkg.Sym；Python 模块级+跨模块 X.sym；C#/Java 命名空间级类型跨文件（同包裸引用+跨包限定引用）；C/C++ def+头文件声明+#include 调用点联动',
  default: 'unimplemented',
  overrides: {
    typescript: 'full_ast',
    tsx: 'full_ast',
    javascript: 'full_ast',
    jsx: 'full_ast',
    go: 'full_ast',
    python: 'full_ast',
    java: 'full_ast',
    c_sharp: 'full_ast',
    c: 'full_ast',
  },
  notes: {
    typescript: '值/类型双栖 + import 边 + 别名 + 局部遮蔽',
    go: '同包 function/type/const + 跨包 pkg.Sym 引用（经 import 本地名判连，前缀隔离不误改）',
    python: '模块级 function/class + 同模块裸引用 + 跨模块 X.sym 引用（import 本地名判连）',
    java: '顶层 class/interface/enum/record + 同包裸引用 + 跨包 pkg.Type 限定引用（scoped_type_identifier）',
    c_sharp: '顶层 class/interface/struct/enum/record + 同命名空间裸引用 + 跨命名空间 Name.Type 限定引用（qualified_name）',
    c: '函数/类型定义 + 原型声明(头文件) + `#include` 该头文件的调用点裸引用联动',
  },
});

/** 契约对账闸门：go / python / java / cs / c / JS 家族各走本族分支 */
declareCapability({
  id: 'contract_gate',
  label: '契约对账闸门（重构后裸标识符定义源检查）',
  desc: 'go/python/java/cs/c 各自分支；ts/tsx/js/jsx/mjs/cjs 走同一套 TS 逻辑（语法兼容）',
  default: 'unimplemented',
  overrides: {
    go: 'full_ast',
    typescript: 'full_ast',
    tsx: 'full_ast',
    javascript: 'full_ast',
    jsx: 'full_ast',
    python: 'full_ast',
    java: 'full_ast',
    c_sharp: 'full_ast',
    c: 'full_ast',
  },
  notes: {
    java: 'import 末段/同包类型/方法形参为定义源；System 等内建白名单',
    c_sharp: 'using 末段/别名/同命名空间类型/方法形参为定义源；System 等内建白名单',
    c: '全局函数/struct/typedef/全局变量/形参为定义源（struct 成员访问左侧不误报）',
  },
});

/** 契约提取（签名/env 对账）：go / python / JS 家族各走本族；其余回退 TS 逻辑 */
declareCapability({
  id: 'extract_contracts',
  label: '契约提取（签名 + 环境符号）',
  desc: 'go 单独分支；非 go(含 js 家族)走 TS 提取逻辑；python 走本族分支（shape 注解属性 + env/config + effect 候选）',
  default: 'partial_ast',
  overrides: {
    go: 'full_ast',
    typescript: 'full_ast',
    tsx: 'full_ast',
    javascript: 'full_ast',
    jsx: 'full_ast',
    python: 'full_ast',
  },
  notes: {
    python: 'shapes 注解属性 + reads_config(PY_ENV) + writes/holds/emits 候选（PY 正则）',
  },
});

// ─────────────────────────────────────────────
// 版本升级线 + 影响面/跨仓/行为/健康（自 feat/version-upgrade 移植，2026-09）
// ─────────────────────────────────────────────

/** 版本升级契约差检测：工具链声明扫描 + 语言特性/废弃 API 检测 */
declareCapability({
  id: 'version_upgrade_detection',
  label: '版本升级契约差检测（扫描 + 特性/废弃API）',
  desc: 'version_upgrade 线 detect 内核；go/java/node/python/csharp/c 六适配器均按方言实现工具链扫描、特性命中与废弃 API 检测',
  default: 'unimplemented',
  overrides: {
    go: 'full_ast',
    java: 'full_ast',
    python: 'full_ast',
    c_sharp: 'full_ast',
    c: 'full_ast',
    typescript: 'full_ast',
    tsx: 'full_ast',
    javascript: 'full_ast',
  },
  notes: {
    go: 'go adapter：go.mod / 依赖特性扫描',
    java: 'java adapter：JDK 特性 + 废弃 API',
    python: 'python adapter：版本边界特性',
    c_sharp: 'csharp adapter：global.json SDK / Directory.Build.props LangVersion·TargetFramework + C# 语言版本特性/废弃 API',
    c: 'c adapter：Makefile/CMakeLists -std=cXX / CMAKE_C_STANDARD + C 标准特性/废弃 API',
    typescript: 'node adapter：ts/package.json 特性（统称 node 家族）',
    javascript: '经 node adapter 同一路径',
  },
});

/** 跨项目符号索引：两仓顶层导出交集/差集 */
declareCapability({
  id: 'cross_repo_symbol_index',
  label: '跨项目符号索引（两仓顶层导出交集）',
  desc: '两仓顶层符号求交=冲突(同名不同签)/双胞胎(同名同签)、求差=迁移范围；复用 impact 依赖索引',
  default: 'unimplemented',
  overrides: {
    typescript: 'full_ast',
    tsx: 'full_ast',
    javascript: 'full_ast',
    jsx: 'full_ast',
    go: 'full_ast',
    python: 'full_ast',
    java: 'full_ast',
    c_sharp: 'full_ast',
    c: 'full_ast',
    // 2026-09-29 P0：内核 LANG_ADAPTERS 补 cpp/ruby/kotlin（符号支柱随内核表生效）
    cpp: 'full_ast',
    ruby: 'full_ast',
    kotlin: 'full_ast',
    // 2026-09-29 本笔：同内核表落地 scala/groovy/julia/haskell/elixir 5 门。本能力要的是
    //   「顶层导出符号」，5 门均实测非空（scala/groovy/julia/elixir 的 object/class/module 即顶层符号，
    //   haskell 顶层 function）⇒ 两仓符号求交/求差可用（读数见提交信息）。
    scala: 'full_ast',
    groovy: 'full_ast',
    julia: 'full_ast',
    haskell: 'full_ast',
    elixir: 'full_ast',
  },
});

/** 代码健康度：死代码 + 复杂度 + 分层违规 */
declareCapability({
  id: 'code_health',
  label: '代码健康度（死代码/复杂度/分层违规）',
  desc: '死代码检测（未使用导出/import/孤儿文件）+ 圈复杂度（AST 分支节点计数）+ 分层违规（积木/契约/胶水反向依赖）',
  default: 'unimplemented',
  overrides: {
    typescript: 'full_ast',
    tsx: 'full_ast',
    javascript: 'full_ast',
    jsx: 'full_ast',
    java: 'full_ast',
    c_sharp: 'full_ast',
    c: 'full_ast',
    python: 'partial_ast',
    go: 'partial_ast',
  },
  // ★ 2026-09-29 本笔**评估过、决定不纳入** scala/groovy/julia/haskell/elixir（保持 default=unimplemented）。
  //   ── 第一轮评估（上一笔；★ 原证据用的是 `health_cli`，该 CLI 已于 2026-09-30 删除
  //      —— 因为 CLI 已改为**从唯一真相源投影**（`npm run tool -- code_health …`）。
  //      要复现当时的读数，用投影入口：`npm run tool -- code_health --json '{"project_dir":"<夹具>"}'`）──
  //     · 未使用导出/孤儿文件/分层违规 三处都靠 `imports` 建边（`reverseConsumers` 只由 import 填）
  //       ⇒ 内核这 5 门**无 import 边**（languages.ts 未声明 import_nodes）⇒ **每门每个非胶水文件都被
  //       报成 orphan_file（实测 5 门均 100% 密度、2/2 文件全中）**，这是系统性假阳，不是"部分支持"。
  //     · 分层违规恒 0；未使用导出：haskell 能靠裸名跨文件反查，其余 4 门的方法挂 object/class/module
  //       下（有 parent）进不了只收顶层的 symIndex ⇒ 已用的 `Helper` 仍被报 unused_export（实测）。
  //     · 结论（上一笔）：**差的是内核 import 边**（根因在 languages.ts，不在 health）。
  //   ── 第二轮评估（import 边**已补**：scala/groovy/julia/haskell 4 门）——结论同"不纳入"，但根因更正 ──
  //     · 真跑夹具 `.inspect/decl5_imports/<lang>`（2 文件，每门用**该语言母语形态**的 import：
  //       scala `import app.Helper` / groovy `import helper.Helper` / julia `using Helper` /
  //       haskell `import Lib (twice)`；elixir 无 import 边，作同批对照）。
  //       读数：orphan 仍 **2/2 = 100.0/百文件**（5 门全同）；`Helper`（/`Use`）仍被报 unused_export
  //       （haskell 例外，与上一笔同：裸名能反查）。
  //     · **根因更正**：上一笔断言"根因不在 languages.ts，而在工程内解析口径"——方向对，但
  //       "orphan 密度不再 100" 这条判据**本身选错了**（2 文件夹具里入口文件永远无项目内消费者，
  //       orphan 最多降到 1，不可能到 0 ⇒ 拿一条不可达的线当验收标准）。
  //     · **本笔已修复口径**（`ts_kernel/import_resolve.ts` 新增 `resolveProjectImport` 唯一实现，
  //       health/impact 共用），scala/groovy/julia/haskell/java/python 的 import 边现在可以解析。
  //     · 另：`Helper` 的 unused_export **与 import 边无关** —— 该维度走 internalRefs/crossRefs，
  //       只按**裸名**匹配顶层符号；`Helper.twice(3)` 的被调是 `twice`（挂 object 下有 parent，
  //       进不了 symIndex），`Helper` 前缀从不成为 crossRef。加 import 边不改这条判据一个字节。
  //     · 另两维不受本笔影响（仍然是真读数、不是假阳/假阴）：复杂度这 5 门未进
  //       `COMPLEXITY_BRANCH_NODES` ⇒ 走正则回退（非 AST 计数）；未使用 import 因
  //       `collectImportBinds` 无这 5 门分支 ⇒ 恒 0（无声）。
  //   ── 第三轮评估（本笔：**解析口径已内化**，2026-09-30）——orphan 判据**已达标**，unused_export 仍未达标 ──
  //     · 改的是什么：`ts_kernel/import_resolve.ts` 新增 `resolveProjectImport`（六层口径：
  //       relative / python-dot / dotted / bare-name / go-module / package-dir），health 与 impact
  //       **各自的私有实现全部删除**、共用它。此前同一问题三个工具三个答案（`import_project` 能解析
  //       点分模块与单段名，health/impact 恒不解析）——本仓最反对的那种分叉。
  //     · 真跑读数（`.inspect/measure_import_fix.mjs`，夹具同为 2 文件）：
  //
  //        | 夹具                      | orphan | impact 边                       |
  //        |---------------------------|--------|---------------------------------|
  //        | decl5_imports/scala       | 2 → 1  | `app/Use.scala→app/Helper.scala` |
  //        | decl5_imports/groovy      | 2 → 1  | `use/Use.groovy→helper/Helper.groovy` |
  //        | decl5_imports/julia       | 2 → 1  | `Use.jl→Helper.jl`              |
  //        | decl5_imports/haskell     | 2 → 1  | `Use.hs→Lib.hs`                 |
  //        | decl5_imports/elixir      | 2 → 2  | 无（该 grammar 无 import 节点）  |
  //        | 对照 java / python（点分·前导点）| 2 → 1 | `app/Use.java→app/Helper.java` 等 |

  //       ⇒ **判据一（孤儿密度）已达标**：2 → 1。剩下那 1 个是**入口文件本身**（无项目内消费者、
  //       非 `glue` 层）—— 它是"没有别人 import 我"，不是"我可能是死的"，2 文件夹具里**不可能到 0**。
  //       上一笔把它当判据是**判据选错了**（本笔更正：见下"判据更正"）。
  //     · **判据二（已用的 `Helper` 不再被报 unused_export）仍未达标，且本笔证明它与此无关**：
  //       该维度走 internalRefs/crossRefs，**只按裸名匹配顶层符号**；`Helper.twice(3)` 的被调是
  //       `twice`（挂 object/class 下有 parent，进不了只收顶层的 symIndex），`Helper` 前缀从不成为
  //       crossRef。⇒ 加 import 边不改这条判据一个字节（实测：unused_export 仍为 2）。
  //       要修它得改的是 **symIndex 的收面**（是否收带 parent 的方法），属**另一笔**。
  //     · 另两维不受影响（真读数，非假阳/假阴）：复杂度这 5 门未进 `COMPLEXITY_BRANCH_NODES`
  //       ⇒ 走正则回退（非 AST 计数）；未使用 import 因 `collectImportBinds` 无这 5 门分支 ⇒ 恒 0（无声）。
  //   ── 所以：档位**保持不纳入**（不硬塞）—— 一条判据达标、一条不达标，且不达标那条的根因在别处 ──
  //     后续要动的是 symIndex 收面（见上）与分叉 D（health 缺 impact 的"裸名唯一保底"调用边，
  //     那是 import 级消费者 vs 调用级依赖两个不同判据，**先判定是否有意，别顺手统一**）。
  //     ★ 顺带（本笔未动）：java/c/c_sharp/cpp/go/python 这几门的 full_ast 档在
  //       同样口径下也读不出孤儿边，档位与"真读数"本就不严格对应；本笔不擅自下调既有声明。
  notes: {
    typescript: '复杂度=AST 分支节点计数；未使用 import=AST 绑定+使用集比对；未使用导出/孤儿/分层=导入+调用边反查',
    javascript: '经 TS 家族同一解析路径',
    java: '复杂度(正则回退)+未使用 import(AST 绑定: import_declaration)+未使用导出/孤儿/分层(导入+调用边反查)',
    c_sharp: '复杂度+未使用导出/孤儿/分层(导入+调用边反查)；unused_import 不查（using 是命名空间导入，语义同 include，非 per-name）',
    c: '复杂度+未使用导出/孤儿/分层(导入+调用边反查)；unused_import 不查（include 是 include-guard 语义，同 Go）',
    python: '复杂度/未使用 import 已 AST 化；未使用导出/孤儿/分层仍受"导出名唯一"匹配限制（重名不建边）→ partial',
    go: '复杂度已 AST 化，未使用 import 不查（编译器兜底）；未使用导出/孤儿/分层同上限制 → partial',
  },
});

/** 按 Spring MVC 分层（Java 专属，收敛进 Java 重构执行器）：从类型级注解识别 controller/
 *  service/repository/entity/config，随 refactor 线命中 Java 工程自动触发，落盘/验证/回滚由管线闭环 */
declareCapability({
  id: 'spring_mvc_layering',
  label: '按 Spring MVC 分层（类型级注解识别）',
  desc: '扫 Java 源码，从 tree-sitter-java AST 的 class/interface/enum/record 类型声明的 modifiers 子树提取类型级注解（@RestController/@Controller→controller、@Service→service、@Repository/@Mapper→repository、@Entity/@Table→entity、@Configuration/@Component→config），按文件归层 + 推断根包，产出迁移计划；作为 javaExecutor 的 stage 收敛进 refactor 管线，物理移动文件 + 改写 package 声明 + 全项目 import FQN，落盘/验证/回滚由管线统一闭环',
  default: 'unimplemented',
  overrides: {
    java: 'full_ast',
  },
  notes: {
    java: '非独立工具：作为 javaExecutor.stages 的 spring_mvc_layering 随 Java 项目探明自动拾取；tree-sitter-java 的 class_declaration.modifiers → marker_annotation/annotation → name；package_declaration 提取包名推断根包',
  },
});