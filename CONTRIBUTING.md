# 贡献指南

感谢你愿意为 agent-io 添砖加瓦。这是一个「人机共享的可视化协议层」项目，核心是**任意代码 → 带契约插头的积木 → 可信组合**这条主线。在动手前请先读完本指南，避免白干。

## 项目结构速览

```
src/
  dsl/        DSL 类型、校验、语义锚定、几何/动画/推理等纯逻辑
  renderer/   自包含 HTML 渲染器（零构建链，产物单文件）
  tools/      全部 MCP 工具实现（get_dsl / edit_dsl / render_design / explore_code …）
  observe/     observe 运行时插桩与对账（行为基线 / 金丝雀）
  diagnosis/  症状 → 根因 → 修复 → 验证 的审闭环
  daemon/     MCP 常驻服务 / 事件分发
  db/         符号缓存（tree-sitter 产物的持久化）
go-observe/    Go 版 observe 探针/裁决（独立小模块）
go-slim/      Go 积木瘦身器（编译器式死码剪枝）
```

## 开发环境

```bash
npm install
npm run build   # 构建（gen bundle + tsc）
npm run doctor  # 环境体检 + 能力矩阵缺口自检
```

## 约定

### 提交前必须过

1. **每个新工具 = 实现 + 注册**。工具经 `register_capabilities.ts` 注册；实现与注册必须一致。
2. **优先用现有 AST 根基，不要手写正则**。`ts_kernel`（tree-sitter）是符号/import/调用边/类型引用的唯一权威来源。确实有 regex_fallback 的场景，请在能力矩阵里标注并说明原因。
3. **保持能力矩阵诚实**：新增能力或修正缺口时同步更新 `capability` 输出，不要留下「未落地但假装可用」的窟窿。
4. **改完自己验**（★ 2026-10-04 裁定，取代原「每个工具必有单测」）：
   `npm run build` → `npm run doctor` → 用 `npm run tool -- <工具名>` **真调一遍**。
   本项目**不设单元测试套件** —— 验证靠「把功能摆成目标的样子，再一个个工具试用过去，哪里有 bug 就修哪里」。
   理由：59% 的历史提交在动 `tests/`，而同期真实功能提交只有 189 个；框架的维护成本超过了它的收益。

### 代码风格

- TypeScript + ESM（`"type": "module"`），Node ≥ 22.5（`node:sqlite` 为内置模块，无第三方原生依赖）。
- 每个工具文件顶部用中文写清「输入 / 行为 / 输出 / 边界」，新读者第一眼要知道这个工具干什么。
- 双向绑定是项目灵魂：改 DSL 格式、改 schema 时，必须同步 `schema/design_dsl.schema.json`、校验器、渲染器、文档四件套。

## 提 PR 流程

1. 先开 issue 说明动机，避免重复劳动。
2. 小步提交：每个 commit 只做一件事，信息用中文，说明「为什么」而不是「改了什么」。
3. 本地全量 `npm test` + `npm run build` 通过后再 push。
4. PR 里附上：改动摘要、验收方式（最好有截图/渲染对比）、是否影响既有工具契约。

## 不懂就问

对主线（积木 / 契约 / 质检）有疑问时，先看 README 的「核心能力线」和 `.trae/skills/agent-io-mind`，那两处是项目的"宪法"。
