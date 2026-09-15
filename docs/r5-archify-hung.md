# R5（archify 渲染线）挂起说明

> 状态：**已挂起（保留在仓内，暂不开发）** —— 2026-09-15 用户拍板。
> 目的：这条线留着以便日后继续，但**不得影响主线开发**；主线也不得无意中把它改坏。

## 1. R5 是什么

R5 = **archify 及其基础上开发的组件**：把 design-canvas 的语义面（DSL / 编辑 IR）
渲染成 5 类图（architecture / workflow / sequence / dataflow / lifecycle）的可视化产线。

它由三层构成，**其中有一层是主线资产，不要误伤**：

| 层 | 文件 | 归属 | 说明 |
|---|---|---|---|
| **中性数据层** | `src/tools/view_inputs.ts` | ★ **主线资产** | "数据层只产中性的图内容，渲染器只负责画" —— 与渲染器解耦，**不属于 R5** |
| 适配/语义层 | `src/tools/archify_semantics.ts`、`archify_project.ts`、`archify_mappers.ts` | R5 | 编辑 IR → 语义面 → 各类型 IR |
| 渲染编排层 | `src/tools/archify_pipeline.ts`、`archify_cli.ts` | R5 | 调外部渲染器 validate / deliver |
| 外部渲染器 | `third_party/archify/**` | **vendored 上游** | JSON-IR → 图表 HTML（MIT，上游 tt-a1i/archify） |
| 对外端点 | `POST /api/archify-demo`（`src/tools/serve.ts` + `src/api/contract.ts`） | R5 | 演示模式：一次产 5 类图 |

## 2. 为什么挂起（而不是删掉）

诊断结论：**渲染管线本身是通的**（5 类图都能产出、`archify doctor` 全绿），
问题只在**产出质量**——3 类图的纵向布局超出 1440×900 视口：

| 类型 | visual-check | scrollHeight | 溢出 |
|---|---|---|---|
| architecture | ✅ pass | 900 | — |
| workflow | ✅ pass | 900 | — |
| sequence | ❌ fail | 1586 | +76% |
| dataflow | ❌ fail | 1302 | +45% |
| lifecycle | ❌ fail | 1245 | +38% |

失败诊断均为 `viewer/viewport-overflow`（纵向尺寸没收敛到视口内）。

⇒ 不是"组件坏了"，是**布局参数未收敛**。修它需要动 vendored 上游的 renderer
（会有升级冲突成本），**与主线（索引/压缩/编辑/自进化）无关** ⇒ 挂起，日后专门做。

## 3. 挂起开关：`DC_R5_SKIP`

单点控制，逻辑在 `tests/helpers/r5_gate.ts`。

| 变量 | 行为 |
|---|---|
| 不设 / `DC_R5_SKIP=0` | **默认**：R5 测试照常跑（保留回归保护） |
| `DC_R5_SKIP=1` | **整线挂起**：R5 的 28 项测试全部 skip（报告里可见，非静默消失） |

**为什么默认是"跑"而不是"跳过"**：静默跳过会隐瞒问题（本项目最反对"静默给旧答案"）。
那条线虽然不开发了，但只要没坏就该继续被回归守着；只有真的出问题、要绕过时，
才显式设 `DC_R5_SKIP=1`。

### 相关命令

```bash
npm test           # 全量（含 R5，默认）
npm run test:main  # 只跑主线（排除 tests/tools/archify_*.test.ts）
npm run test:r5    # 只跑 R5 那 4 个文件
DC_R5_SKIP=1 npm test   # 全量但把 R5 挂起
```

### CI 里的表现

- `archify doctor` 自检步骤带 `if: ${{ env.DC_R5_SKIP != '1' }}` ⇒ 挂起时自动跳过；
- R5 测试随 `npm test` 一起跑；要挂起，在 job 里加 `env: { DC_R5_SKIP: '1' }`。

## 4. 挂起的边界（**重要**：哪些没挂起）

挂起的是 **R5 专属测试**（`tests/tools/archify_*.test.ts`，4 文件 28 项）。
以下**没有**挂起，因为它们守着主线资产或对外契约：

- `tests/tools/view_inputs.test.ts` —— 测**中性数据层**（`deriveViewInputs`），
  该层是主线资产（"与 Archify 无关"正是它的断言）⇒ **继续守着**。
- `tests/api/contract.test.ts` —— 测**对外响应契约**（含 `archify-demo` 端点 zod schema）
  ⇒ 契约漂移必须继续暴露。
- `src/api/contract.ts` 里的 `archify-demo` 定义 —— 属对外契约，**保留**；
  `scripts/contract_docs_gate.mjs` 继续按既有规则管它。

⇒ 也就是说：**挂起 ≠ 免责**。R5 的对外契约与中性层仍然受 CI 保护；
被挂起的只是"这条线自己的 28 项单元测试"。

## 5. 日后如何恢复开发

1. 取消挂起：确认环境没设 `DC_R5_SKIP`（或显式 `DC_R5_SKIP=0`）。
2. 跑基线：`npm run test:r5`（应 28 passed）。
3. 复现质量问题：
   ```bash
   node third_party/archify/bin/archify.mjs render sequence \
     third_party/archify/examples/cache-miss-request.sequence.json /tmp/seq.html
   node third_party/archify/bin/archify.mjs visual-check /tmp/seq.html --json
   ```
4. 修布局：目标 = `scrollHeight ≤ 900`。改动集中在
   `third_party/archify/renderers/{sequence,dataflow,lifecycle}/` 与
   `renderers/shared/geometry.mjs`（**注意**：动 vendored 上游要同步改
   `third_party/archify/VENDORED.md` 的差异说明）。
5. 5 类全 `pass` 后，可考虑把 `visual-check` 纳入 CI（当前只有 `doctor`）。

## 6. 与主线开发的互不干扰约定

- **主线别动**：`src/tools/archify_*.ts`、`third_party/archify/**`、
  `/api/archify-demo` 端点与契约 —— 除非是在做 R5 本身。
- **R5 别动**：`view_inputs.ts` 的中性语义（主线多个工具消费它）。
- 改了 `third_party/archify/**`（比如换版本）⇒ 必须跑 `archify doctor` +
  `npm run test:r5`，并更新 `VENDORED.md`。
