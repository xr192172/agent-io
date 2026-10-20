# 三方合并

> 只有现状。规则变了改这张表。

## 一、三方

| 角色 | 文件 | 谁写 | 会不会移动 |
|---|---|---|---|
| base | `.agent-io/baseline/<f>.dsl.json` | fork 时写入 | 不移动（除非显式重建） |
| ours（设计） | `.agent-io/design/<f>.dsl.json` | 人：`edit_dsl` / `design_intent` | 每次写意图 |
| theirs（实际） | `.agent-io/live/<f>.dsl.json` | `import_project` / `renderLiveFromDb` | 每次扫描 |

`baseline → design` = 意图增量；`baseline → live` = 实现增量。语义在 `src/infrastructure/storage.ts` 的 `getBaselineDir` 上方。

- **保鲜单向**：`源码 → cache.db → live` 一直跑，**从不看 baseline**；对比（`live`/`design` vs `baseline`）按需现算。保鲜若照着 baseline 改，差异消失 ⇒ 设计不存在了。
- **`design` 是全量工作区**（看得见全貌才改得动），不是"复制事实"违规；"哪些是人写的"用 baseline 现算，**不落字段**（落了就是读数快照）。
- **baseline 永不移动**：它一跟着实际侧走，就量不出"实际动过没"。同一条纪律——事件可存，读数不可存。

## 二、步骤

| # | 做什么 | 在哪 | 注意 |
|---|---|---|---|
| 1 | 确认 base 在 | `.agent-io/baseline/<f>.dsl.json` | 没有 ⇒ 只有双边，无三方 |
| 2 | 出差异 | `diff_views feature=<f>` | 返回 `three_way`（`files[].state` + `summary`） |
| 3 | 分类 | `three_way.files[].state` | `added` / `implemented` / `removed` / `deleted_from_live` / `design_only` / `live_only` / `conflict` / `both_moved` / `converged` / `unchanged` |
| 4 | 裁决 | 人 | `decision` / `expectations` 不被 `theirs` 覆盖 |
| 5 | 收结构 | `edit_dsl`（`node` / `edge` / `file`） | 只收事实，不改意图 |
| 6 | 同步签名 | `design_line project_dir=. action=sync-signatures apply=true` | 只改签名；落盘后自动复核 |
| 7 | 前移 base | 人 | 可前移 ⟺ `live_only=0 ∧ conflict=0 ∧ both_moved=0 ∧ deleted_from_live=0`（`design_only` 不阻塞，那是 ⑥ 未落地的活）；工具只判不写 |

## 三、粒度

| 对象 | 自动 | 人工 |
|---|---|---|
| 文件新增 | `theirs` 新增 ⇒ 收进 design | — |
| 文件删除 | — | `ours` 删了而 `theirs` 还在 ⇒ 问 |
| API / 签名 | — | 一律人工（`signature-matches` 依赖它） |
| 调用边 | `theirs` 新增 ⇒ 收进 design | `theirs` 删了而 `ours` 的 `call-exists` 指着它 ⇒ 标失效，不删 |
| `decision` | 永不自动改 | 人的裁决才动 |
| `expectations` | 结构类（`file-exists` / `symbol-exists`）可随 `theirs` 更新 | 行为类（`call-exists`）目标消失 ⇒ 人工确认，不删（`stale` 未实现） |

硬规则：**`decision` 和 `expectations` 永远不被 `theirs` 覆盖。**

冲突只在**同一维度**两边都改时成立：命名（`label` / `description` / `status`）· 结构（`lines` / `symbols` / `apis`）· 符号（`signature`）。不同维度各自改 ⇒ `both_moved`（两条独立待裁项），不是冲突。

## 四、未实现

| 什么 | 现状 |
|---|---|
| `sync`（`theirs` → `design` 补结构） | 无工具无脚本（`scripts/sync.mjs` 不存在）；手工 `edit_dsl` |
| `merge` 裁决清单 | 已并入 `diff_views.three_way`（`scripts/merge.mjs` 不存在） |
| 判据 `stale` 标记 | 未实现（`diff_views` 无 `stale` 字段） |
| 自动写 `design` | 不做 |
