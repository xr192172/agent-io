# 裁决

> 只有现状。能实测的不进这张表；实测完写进 `INDEX.md` / `DESIGN.md`。

## 一、规则

| # | 规则 | 做法 |
|---|---|---|
| R1 | 能实测的先测 | 测完写结论，不进本表 |
| R2 | 两份说法冲突 | 以代码为准；代码与文档不符 ⇒ 改文档 |
| R3 | 破坏性动作 | 删文件 / 删 skill / 改对外契约 ⇒ 人裁 |
| R4 | 对外契约的边界 | 工具入参出参、跨文件领域类型 ⇒ 进设计；校验中间产物 ⇒ 不进 |
| R5 | 判据与被检对象 | 先证明判据错，再动判据；不改被检对象去迎合 |

## 二、R4 的三类

| 类 | 例子 | 进设计 |
|---|---|---|
| 工具入参 / 出参 | `AddNodeInput` `DeleteNodeInput` `CheckedOperation` | ✅ |
| 领域类型 | `CardStanding` `DiagramStatus` `Expectation` | ✅ |
| 内部细分 | `EdgeKeysExtra` `EdgeKeysMissing` `DriftRed` | ❌ |

## 三、待裁

| # | 事项 | 现状 | 选项 |
|---|---|---|---|
| C1 | 哪些导出算对外契约 | `npm run coverage`：705 导出 / 435 声明，漏 275，覆盖 61%（11 个设计文件） | 按 §二 圈定后补声明 / 维持现状 |
| C2 | skill 删不删 | 三簇重复（门与假信号 / DSH 宿主平面 / add-remove 登记面） | 删 / 留 |
| C3 | 是否抽 `docs/TOOL-REGISTRATION.md` | 文件不存在，登记规则仍分散 | 抽 / 各留一份 |
