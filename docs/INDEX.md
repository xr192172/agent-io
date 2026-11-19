# INDEX.md — 现状与文档图

> 只写当前能力和权威。数字不抄；命令现算。历史在 git 与 ledger，不在当前树。

## 1. 产品与闭环

AgentIO 是由目标驱动的程序开发引擎。一个真实开发任务应走：

```text
理解 → 设计 → 改造 → 对账
```

事实来自源码与索引；意图住设计侧；执行事件住台账；文档是派生说明，不是第二真相。

## 2. 权威地图

| 问题 | 唯一权威 / 查询入口 |
|---|---|
| 工具能做什么、何时用 | `ToolDef.description`；导航用 `capability_map` |
| 当前门与判据行为 | `scripts/verify.mjs#GATES`；`src/domain/expectation_kinds.ts#KIND_SPECS`；`docs/GUIDE-GATE.md` |
| 当前文件/符号/调用事实 | 源码 + 项目索引；`index_integrity` 判新鲜度 |
| 设计意图、决策、判据、卡、计划 | `.agent-io/design/*.dsl.json`；`get_dsl` / `edit_dsl` / `design_line` |
| 当前任务、事件、裁定、销账 | `.agent-io/tasks.db` 的 ledger 表；`ledger` 工具 |
| 人读任务视图 | `docs/todo.md`，由 `npm run ledger:render` 生成；`npm run ledger:check` 验新鲜度 |
| 当前支持语言与能力档位 | `capability_audit` 现算；不写死语言数 |
| 路径身份 | `scripts/lib/path_identity.mjs#samePath` |
| 用户愿景原话 | `docs/VISION-ORIGINAL.md` |
| 当前仍有效的否决与回炉条件 | `docs/RETIRED.md` |

## 3. 能力边界

- **已具备**：设计册、判据、写闸、台账、增量验证、多模型席位协作、AST 辅助改写、按需运行观测。
- **不是承诺**：不是所有语言同精度；编译通过不等于行为等价；结构一致不等于设计优秀；工具数/判据数不是成功指标。
- **写入边界**：仓内写工具过闸；shell / 普通编辑器直写绕过写闸，只能事后对账发现。
- **语言边界**：按语法 / 语义 / 构建测试 / 运行观测逐格声明；能力不足时降级为 syntax-only 或 unsupported，不猜。
- **外部项目边界**：官方 DSH 完整源码的独立 checkout 是当前试点，但全链闭环尚未验收；运行中的 DSH 安装目录不是改造源。

## 4. 文档图

| 文档 | 用途 |
|---|---|
| `README.md` / `README.en.md` | 项目是什么、怎么开始 |
| `AGENTS.md` | 开发纪律（唯一住处） |
| `CONTRIBUTING.md` | 加/删工具与提交前检查 |
| `docs/INDEX.md` | 当前现状与权威地图 |
| `docs/PROJECT-DESIGN.md` | 目标设计、非目标、阶段出口 |
| `docs/GUIDE-USAGE.md` | 安装、环境、使用、Tailscale 安全 |
| `docs/DEVELOPMENT.md` | 开发、验证、席制、当前下一卡 |
| `docs/GUIDE-GATE.md` | 门、判据、四态与失败语义 |
| `docs/FIELD-ALIGNMENT.md` | 字段 ↔ 源码/存储对齐 |
| `docs/ROOTS.md` | 目录、数据根与权威边界 |
| `docs/PITFALLS.md` | 撞门/环境故障的现行处置 |
| `docs/GUIDE-LANGUAGE.md` | 加语言 / 加 AST 的边界与验货 |
| `docs/VISION-ORIGINAL.md` | 用户愿景原文 |
| `docs/RETIRED.md` | 当前仍有效的否决与回炉条件 |
| `docs/todo.md` | ledger 生成视图；不手改 |

## 5. 当前下一方向

完成本基线后，优先在**官方 DSH 完整源码的独立 checkout** 上把 `import_project → 设计册 → 领卡 → 施工 → 判据验收 → 销账` 全链闭环跑通，并记录机制维护成本是否超过它减少的返工。首刀限插件管理器安装流程的行为保持重构；试点不等于做 DSH 专属引擎或插件。

## 6. 规矩

1. 同一事实只有一个可写权威。
2. 判据只住一处；不抄数字、不造第二套门。
3. 读不到 ≠ 没有；判不了 ≠ 通过。
4. 写文档先改既有入口，不新开平行说明。
5. 历史由 git 与 ledger 保存；当前树只放可执行的现在。
