# third_party/archify —— 上游溯源与更新规程

本目录是 **Archify** 的仓内 vendor 副本（非本仓库自有代码）。

## 这是什么

Archify 是一套 **JSON-IR → 图表 HTML** 的渲染器（architecture / workflow / sequence /
dataflow / lifecycle 五类图），design-canvas 通过 `src/tools/archify_*.ts` 把语义面
映射成其 IR，再调用其官方 `validate` / `deliver` 产出最终图形。

## 上游与版本

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/tt-a1i/archify |
| 版本 | `2.17.0-dev.1`（见 `skill-release.json`） |
| 渠道 | development |
| 许可证 | MIT（见 `LICENSE`、`THIRD_PARTY_NOTICES.md`） |
| 体量 | ≈2.4M（精简副本，见下） |

## 为什么 vendor 进仓（而不是靠环境变量指向外部安装）

1. **版本固定**：产物可复现 —— 渲染器版本随仓库一起走，不会因机器上装了什么而漂移。
2. **CI 可验证**：此前 `ARCHIFY_ROOT` 指向机器上的外部目录（不在仓库、不在 CI），
   导致这条链路**永远无法在 CI 里被验证**，且会污染本机测试（宿主环境变量泄漏）。
3. **零环境依赖**：clone 即可用，不需要任何环境变量或额外安装步骤。

## 解析优先级

`src/tools/archify_cli.ts#resolveArchifyRoot` 按以下顺序解析（高 → 低）：

1. **显式入参** `explicit`（测试 / 调用方临时指定）；
2. **`ARCHIFY_ROOT` 环境变量**（可选覆盖，保留给"指向外部安装"的高级用法）；
3. **★ 仓内默认**：本目录（从模块位置逐级上溯找到含 `third_party/archify/bin/archify.mjs` 的目录）。

返回值语义 = **"含 archify/ 的根目录"**（即 `third_party`，`archifyCliPath` 再拼 `archify/bin/archify.mjs`）。

## 精简策略（相对上游全量 7.5M）

**保留**（渲染必需的运行件）：
`bin/ renderers/ schemas/ assets/ scripts/ references/ brand-marks/ delta/ migrations/ recipes/`
`SKILL.md LICENSE THIRD_PARTY_NOTICES.md package.json package-lock.json skill-release.json`
`examples/`（**仅 7 个必需件**：5 个各类型 example + 2 个 architecture compare proof fixture）

**未纳入**（开发/演示用，上游 `test/` 1.6M 与 `examples/` 其余 3.5M）：
如需对上游做完整回归，请从上游仓库取得。

> ⚠️ `examples/` 里那 7 个文件**不是可选示例**：`archify doctor` 把"每类型 renderer +
> schema + example"当作装配完整性必需项，architecture compare 也依赖 2 个 proof fixture。
> 删任意一个 `doctor` 即报 `not ready`。

## 更新规程

1. 从上游取新版（release 或 dev 包）；
2. 按上述"保留清单"覆盖本目录；`examples/` 仍需保留那 7 个必需件；
3. 跑装配自检：`node third_party/archify/bin/archify.mjs doctor`（应全 `[ok]` 且 `Archify is ready.`）；
4. 跑本仓验收：
   - `node node_modules/typescript/bin/tsc`
   - `node node_modules/vitest/vitest.mjs run tests/tools/archify_*.test.ts`
5. 更新本文件的**版本号**与差异说明。

## 自检命令

```bash
node third_party/archify/bin/archify.mjs doctor      # 装配完整性
node third_party/archify/bin/archify.mjs --help      # 命令面
```
