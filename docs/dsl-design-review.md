# DSL / 工具面设计评审（2026-10-08）

> 起因：用户问 *「你觉得这个 DSL 在设计上有什么缺陷吗？可以提改进意见吗？比如换不同的名字。机制上有什么可改的？」*
> ★ 纪律：**先取证再开口**。本文每条都挂**可复现读数**（`npm run probe:tool-smells`），
> 并**记下我自己被数据推翻的那一条**。

## 〇、先给判据（把"意见"变成"读数"）

`npm run probe:tool-smells`（`scripts/probe_tool_smells.mjs`）扫全部 **61 个工具**，四条**可判定**的坏味道：

| 判据 | 阈值 | 含义 |
|---|---|---|
| **宽签名** | 入参 ≥ 8 | 多半是"多个工具被塞进一个" |
| **袋子** | 入参里是 `record/any/unknown` | 真参数藏在**描述文字**里，zod 校验不到 |
| **描述过短** | < 80 字 | LLM 判不出它干什么 |
| **命名词序** | 动词/名词开头并存 | 靠名字猜用途时无据可依 |

### 实测读数（2026-10-08）
```
宽签名 8 个：get_dsl(21) rules(16) edit_code(13) import_project(11)
            gateway_provider(11) translate_go_ts(9) observe_instrument(8) find_references(8)
袋子   2 个：manage_feature[args]  explore_code[args]
描述过短 1 个：consistency_check(75 字)
命名词序：动词开头 17 · 非动词开头 44
```

★ **探针自己先被验过**（第一版有**两处假阴性**，已修，见文末"记账"）。

## 一、缺陷（按证据强度排序）

### ★★★ 缺陷 1：`get_dsl` 是"把 5 个查询塞进 1 个工具"（21 参数）
参数清单本身就是证据 —— 它明显是**4~5 组互斥参数**的并集：
```
query view                       ← 选路
node_id thread decision_status   ← ① 线程/决策
annotation_node_id severity unresolved_only status assignee annotation_id  ← ② 标注
file_id project_dir layer type file_layer file_status                    ← ③ 文件/层
feature_a feature_b view_b       ← ④ 两视图 diff（view_b 与 view 成对）
```
**为什么是缺陷**（不是"参数多不好看"）：
- 调 `query=nodes` 时**另外 12 个参数全是噪声** ⇒ LLM 要在 21 个里挑对的那几个；
- **本仓自己的规矩**：§5「[B] 收**显式参数**，非 `Record<string,unknown>` 袋子」——
  21 参数的"宽签名"与袋子是**同一病的两端**（一个全摊开、一个全藏起），**中间那条正确的路（按语义拆工具）没人走**。

### ★★★ 缺陷 2：两个"袋子"工具（`manage_feature` / `explore_code`）
```ts
// manage_feature
inputSchema: { action: z.enum(MANAGE_ACTIONS), args: z.record(z.string(), z.unknown()).optional() }
```
真正的参数（`feature`/`title`/`source_feature`/`target_feature`/`template_id`）**只写在 description 的中文里** ⇒
zod 校验不到、契约上不可见、拼错也不报错（**运行时才炸**）。
★ 这是**设计车道自己违反了自己的纪律**（§5 那条 [B] 规矩），最该先修。

### ★★ 缺陷 3：`view: 'design' | 'live'` 把"读写权限"藏进了参数
只有 `edit_dsl` / `get_dsl` 带 `view`（`get_dsl` 还有 `view_b`）。而 **`live` 只读、拒绝写入**这条语义
**在签名上完全不可见** ⇒ LLM 可能拿 `edit_dsl(view:'live')` 去写 ⇒ **运行期才被拒**。
⇒ 用**参数**表达"两种模式"是错的：这两档**权限不同**，本应是**两个工具**（读 / 写），而不是一个工具的两个取值。

### ★ 缺陷 4：`design_intent` 也藏着"多动作"（`action` + 4 个可选参）
参数 `['action','feature','goals','edge_intents','project_dir']` ⇒ 与 `manage_feature` 同型（只是没用袋子）。
它描述 689 字、`consistency_check` 只有 75 字 ⇒ **同一车道的契约打磨程度差 9 倍**，LLM 对后者的用途基本靠猜。

### ✗ 缺陷 5（**我的批评，被数据推翻**）："命名词序混用"
我原以为 `signal_review` / `consistency_check` / `design_intent`（名词开头）与其余（动词开头）"混用有害"。
**实测 17 : 44 —— 名词短语才是主流**（`rename_symbols` / `code_health` / `diff_views` …），
且读作"**那件事的名字**"完全成立 ⇒ **命名不是首要问题**，**降级为"车道内一致性"的小事**。
★ 记这条是因为：**没有读数时，"我觉得乱"很容易被当成缺陷**。

## 二、改进建议

### A. 拆工具（治缺陷 1、2、4）—— 每拆一个，入参会掉到 2~4 个
| 现在 | 建议 | 入参 |
|---|---|---|
| `get_dsl(query=dsl)` | `read_dsl` | `feature, view` |
| `get_dsl(query=features)` | `list_features` | （无） |
| `get_dsl(query=nodes)` | `list_nodes` | `feature, layer, type, status` |
| `get_dsl(query=annotations)` | `list_annotations` | `feature, severity, assignee, unresolved_only` |
| `get_dsl(query=diff)` | `diff_views` | `feature_a, feature_b, view, view_b` |
| `manage_feature(action=create)` | `create_feature` | `feature, title` |
| `manage_feature(action=clone)` | `clone_feature` | `source_feature, target_feature` |
| `manage_feature(action=template)` | `new_feature_from_template` | `template_id, feature` |
| `manage_feature(action=list)` | 复用 `list_features` | （无） |
| `manage_feature(action=delete)` | `delete_feature` | `feature` |
| `explore_code[args]` | 按它的 action 同法拆 | — |
| `design_intent(action=…)` | 按 action 拆（或至少把 4 个可选参**显式化**） | — |
★ **收益可验证**：拆完 `probe:tool-smells` 的"宽签名/袋子"应降到 **0**（那就是验收）。

### B. 读写分离（治缺陷 3）
- 写入口 `edit_dsl` **不接受 `live`**（**类型上不可达**，而不是运行期拒绝）；
- 读入口 `read_dsl` 接受 `view`。
⇒ "live 只读"从**运行期约定**升到**契约层**。

### C. 命名（治缺陷 5 的"小事"）—— **只做车道内一致**，最小改动
design 车道 12 个里 9 个动词开头、3 个名词开头 ⇒ **只改那 3 个**（不动全仓 44 个名词短语）：
`signal_review → review_signals` · `consistency_check → check_consistency` · `design_intent → set_design_intent`
★ 换名的**代价**要写清：这些名字会进**调用日志 / 既有脚本 / LLM 的对话历史** ⇒ 改名需一次到位，
且**恰好**我们刚建的 `tool-surface` 快照**会指出"改了哪些"** ✓（工具面已进快照，改名可被追踪）。

### D. 补描述（治缺陷 4 的后半）
`consistency_check` 的 75 字要写清：**它检什么、不检什么、与 `detect_drift` 的分工**（后者 249 字）。

## 三、机制上的可改之处

1. ★★ **把坏味道接进快照**（本轮已做）：`tool-smells` 加入 `snap:*` 观测点 ⇒
   **拆工具的进展可被追踪，"坏味道反弹"会当场变红**（不靠人记得去查）。
2. ★ **阈值进配置而非散在代码**：`SMELL_WIDE` / `SMELL_THIN` 已是环境变量，但**没人定过"该是多少"**
   ⇒ 应由**一次讨论**定下并写进文档（现在 8 是我拍的）。
3. **"多动作工具"应可判定**：`action: z.enum(...)` + 其余参数与 action 相关 ⇒ 目前**探针抓不到**它
   （只有"袋子"能抓）⇒ 值得加一条判据（例如"含有 `action` 枚举 **且** 参数 ≥ 5"）。
4. **目录 ≠ 职责**：`src/application/design/bricks/` 里混着**渲染**（`render_brickwork`）、**审阅**（`signal_review`）、
   **分类**（`classify_bricks`）、**叙事**（`cluster_narrator`）⇒ 可留（同一车道内）。
   ★★ **更正（2026-10-08 当天自查发现）**：本文件初版写「`dsl_ops/` 是**空目录**（墓碑）⇒ 该删」——
   **那是我的假证**：`dsl_ops/` 有 **9 个 `.ts` 文件**（`node_ops` / `update_feature` / `annotation_tools` /
   `file_ops` / `api_ops` / `feature_ops` / `edge_ops` / `status_tools` / `edit_result`，最大 22KB）。
   错因：`ls -la <两目录> | head -10` 的输出被我读串了
   （`head -10` 把一个大目录的列表**截断**，另一半目录的头部也一起吃掉 ⇒ 看起来"空"）。
   ⇒ **"目录看起来空"也要用 `Glob`/`ls *.ts | wc -l` 数一遍再说。**
   ★★ **本条更正自己又犯了一次**：初稿我填的是"**7 个文件**"，实测 **9 个** ——
   **同一个动作、同一个错**（列了 7 个名字就以为数完了，没让机器数）。
   ⇒ **通则：凡"多少个"，一律让命令报数（`| wc -l`），不许凭列举的条数当计数。**

## 四、记账：**我的探针第一版有两处假阴性**（已修）

| 假阴性 | 症状 | 真因 |
|---|---|---|
| 袋子报 **0 个** | 与人工读到的 `manage_feature` 矛盾 | `z.record(...).optional()` 的 `_def.type` 是 **`'optional'`** ⇒ 我只看了**外层** ⇒ 必须**剥修饰层**再判 |
| 词序报 **0 个族混用** | 与"3 个名词开头"矛盾 | 我按"前缀族 ≥2 个成员"分组，而**那 3 个恰恰各自成单例** ⇒ 判据把例外**排除在外**了 |

★ 修后：袋子 **0 → 2**（多看出一个 `explore_code`）；词序改成**整体统计** ⇒ `17 : 44`（于是推翻了我自己的批评）。
★ 教训（本仓已有一条，现再验一次）：**判据设计错时，它给出的"0"看起来同样干净** ——
 所以**必须拿已知真值对一次**（我这次是拿"人工读到的 `manage_feature`"当已知真值）。

## 五、建议的执行顺序（若采纳）

1. **先修 2 个袋子**（`manage_feature` / `explore_code`）—— 违反自家纪律、且最小改动；
2. **拆 `get_dsl`**（21 → 5 个工具）—— 收益最大；
3. **读写分离**（`view` 从写入口拿掉）；
4. 补 `consistency_check` 描述 + 删 `dsl_ops/` 空目录 + 车道内 3 个改名。

★ 每一步的验收都已经现成：**`probe:tool-smells` 读数 + `snap:diff` 工具面指纹**。
