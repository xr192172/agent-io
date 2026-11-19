# GUIDE-LANGUAGE.md — 加语言 / 加 AST

> 目标：加一门语言 = 填表 + 写适配器 + 跑验货命令。内核不认识具体语言；发现 `if (lang === 'xx')` 就是设计漏了。

## 1. 三张表

| 表 | 位置 | 管什么 |
|---|---|---|
| `LANGUAGES` | `parse/languages.ts` | 语法包、扩展名、符号节点、import 节点、字段映射 |
| `LANG_ADAPTERS` | `parse/kernel.ts` | 调用形态、import source 抽取、`resolveImport`、局部绑定 |
| 内置表 | `index/symbols.ts` | 只放真全局；不放包成员尾名 |

三张表必须同时填：只填语法包 ⇒ 抽不出调用/导入；少 `resolveImport` ⇒ 跨文件引用解析不到。

## 2. 加语言的步骤

1. 确认 grammar 包存在：`npm run grammar:list`。`pkgSpec` 三态：省略（约定派生）、显式真名、`null`（未登记可用包）。
2. 在 `LANGUAGES` 加 `LanguageEntry`：name、pkg、exts、kind、symbol_nodes、import_nodes、field_map。
3. 在 `LANG_ADAPTERS` 加适配器：callNode / calleeFields / import 抽取 / `resolveImport` / localBindingNodes。
4. 只在真全局需要时加内置表；先问它是不是在掩盖解析能力缺失。
5. 验货：类型检查、解析冒烟、`resolveImport` 合成 ctx 单测、全量重建、能力读数。
6. 更新能力边界读数（由 `capability_audit` 现算，不写死语言数）。

`resolveImport` 返回约定：`[]` = 明确外部；`string[]` = 项目内候选；`null` = 本语言不管，交别的路子。

## 3. 加 AST 节点

- 新符号节点：加入 `symbol_nodes`，确认 `nodeTypeToKind` 映射到 function/method/class/interface/type/enum/const/variable，且 `field_map.name` 存在。
- 新 import 节点：注意命中即 return 的陷阱；若节点包裹普通代码，必须保证"抽不到 source 时继续递归"。
- 新调用形态：加 `callNode` / `calleeFields`，不在内核写语言分支。
- 带点类型：保留 receiver；外层 `nested_type_identifier` / `qualified_type` / `scoped_type_identifier` 不能只取内层名字。
- 函数值变量：用 `typedFuncSymbol` 声明形态；没填就当本语言没有。

## 4. 已知边界

- 语法可解析 ≠ 语义可解；语义可解 ≠ 跨文件可解析。
- 计算路径 import 记为 `computed`，当前只保留事实，不猜实际路径。
- 局部绑定只有在对应抽取分支存在时才生效；新形态要补分支。
- 内置表能临时掩盖缺口，但会让真洞长期不可见；优先修解析器。

## 5. 验货命令

```bash
npm run grammar:list
npm run typecheck
npm run probe:extract
# 对目标语言样文件做 parseFileFull 冒烟：symbols/imports/calls/error 分项
# 对 resolveImport 用合成 ctx 单测，不依赖本仓是否有该语言文件
# 全量重建前停 MCP；重建后用 index_integrity / capability_audit 看读数
```

全仓没有某语言文件时，全量重建看不出对错；`resolveImport` 必须用合成上下文单独验。
