# ④-2 方案：按能力**改判整条线**，而不是只挪一个 import

> 状态：**待你过**（这是唯一会动到架构形状的一条）。取证日期 2026-10-01。

## 1. 问题（现状取证）

```
src/tools/sync_contracts.ts:18   import { TOOL_DEFS } from '../presentation/mcp/server_registry.js';
                                 ↑ application 层要去引 presentation 层 ⇒ 【下层依赖上层】
```
而且它**自己就承认了这是个将就**（`sync_contracts.ts:15` 逐字）：
> 「循环依赖说明：TOOL_DEFS 由 server_registry 导出，本模块仅在函数执行期读取（handler 调用时）」

**它同时是那条已知 `no-circular` 的一环**：
```
handlers.ts → sync_contracts.ts → server_registry.ts → application/<线>/index.ts → handlers.ts
                                                    ↑ 环
```
⇒ 所以 `sync_contracts` **既违反分层、又参与循环**，而且**落哪都不行**（留在 `tools/` 也一样：
`tools → presentation` 同样是倒挂），这就是它一直"未搬"的原因。

## 2. 关键取证：**根本不需要"注册表快照"**

`TOOL_DEFS` 是什么？它是 `server_registry.ts:520-529` 里的**两行汇总**：
```ts
export const LANE_SOURCES = [
  ['observe', OBSERVE_TOOLS], ['cross', CROSS_TOOLS], ['design', DESIGN_TOOLS],
  ['meta', META_TOOLS], ['refactor', REFACTOR_TOOLS], ['harvest', HARVEST_TOOLS],
];
const TOOL_DEFS = LANE_SOURCES.flatMap(([, defs]) => [...defs]);
```
而 **6 个 `*_TOOLS` 数组全都住在 `application/<线>/index.ts`** ✓（同层！）。

⇒ ★ **`TOOL_DEFS` 其实是"application 层内部的事实"**，只是**恰好被放在 presentation 的文件里**。
`server_registry` 拿它做的事只有一件：**把它注册到 MCP server**（那才是 presentation 的职责）。

## 3. 方案：把「汇总」下沉到 `application/`，两边都引它

**新增 `src/application/tool_registry.ts`**（内容 = 从 `server_registry.ts` **原样搬**这三件）：
```ts
export const LANE_SOURCES: ReadonlyArray<readonly [LaneId, readonly ToolDef[]]> = [...]; // 6 条线
export const ALL_TOOL_DEFS: ToolDef[] = LANE_SOURCES.flatMap(([, defs]) => [...defs]);
export function laneOfFromSources(...) { ... }      // 工具 → 线 归属表
bindToolDefs(ALL_TOOL_DEFS);                        // 破环注入（capability_map 要目录）
bindLaneOf(laneOfFromSources());                    // P1c 归属注入
```

**改动点（4 处）**：
| 文件 | 改什么 |
|---|---|
| `src/application/tool_registry.ts` | **新建**（搬入上面三件 + 两个 bind） |
| `src/presentation/mcp/server_registry.ts` | 删掉这三件，改为 `import { LANE_SOURCES, ALL_TOOL_DEFS } from '../../application/tool_registry.js'`；只留"注册"职责 |
| `src/tools/sync_contracts.ts` | `import { ALL_TOOL_DEFS } from '../application/tool_registry.js'`（**同层**）⇒ 倒挂消失 |
| `tests/helpers/lane_files.ts` | `LANE_SOURCES` 的 import 路径跟着改（relink 自动） |

**然后 `sync_contracts.ts` 就能搬了** ⇒ `src/application/harvest/sync_contracts.ts` ✓（`src/tools/` 只剩 2 个）

## 4. 为什么这是最优解（而不是"注册表快照"）

| 备选 | 为什么不选 |
|---|---|
| **A. infrastructure 侧写一份注册表快照**（gen 或运行时落盘） | 引入**第三份数据**且**会陈旧**；"事实源"从 1 个变 2 个 —— 正是本仓反复踩的"判据分叉" |
| **B. 把 `ToolDef` 类型下沉** | 类型**已经在 `application/types.ts`** 了 ✓ 不是问题所在 |
| **C. 让 server_registry 反向注入**（presentation 调 application 的 setter） | 只是把环换个方向，且引入"必须先初始化"的时序依赖 |
| **D.（本方案）把汇总下沉 application，两边都引** | ✅ 零新机制；**同层引用**；且**顺手消灭一条已知 `no-circular`** |

★ 这也正是你说的形状：**"提炼出来，所有引用它的都引用那个接口"** ——
只是"接口"不是新造的类型，而是**把那份数据放回它本来该在的层**。

## 5. 预期收益与风险

**收益**
1. ④-2 关闭 ⇒ `sync_contracts` 可搬 ⇒ **`src/tools/` 只剩 2 个**（`trace_reasoning`/`view_inputs` 待裁）
2. **已知 `no-circular` 基线少 1 条**（`handlers → sync_contracts → server_registry → lanes → handlers` 不复存在）
3. `server_registry.ts` 职责变纯：只剩"把 application 的工具表注册到 MCP server"

**风险（逐条给了处置）**
| 风险 | 处置 |
|---|---|
| **加载期两个 bind 的时序**（`bindToolDefs` 原先在 server_registry 加载时跑） | 搬进 `tool_registry.ts` 后**同样是加载期跑**，只是提前到 application 层 ⇒ 更早、更可靠；且 `tool_registry → meta/index → capability_map` 是**单向**，不构成新环（用 `arch` 验） |
| `LANE_SOURCES` 的消费者（`tests/helpers/lane_files.ts` 等） | 走 `scripts/relink_specifiers.mjs` 自动改；`arch` + 全量兜底 |
| 归属表 `laneOfFromSources` 的语义 | **原样搬，不改逻辑**（`capability_map` 的注入契约不变） |

## 6. 验收（照本仓惯例）
1. `npx tsc` 0 error
2. `npm run arch` **0 违规**，且 **`no-circular` 基线条目少 1 条**（用 `scripts/arch_baseline_remap.mjs` 先证明"只少了它、没有新真违规"）
3. **全量**：0 失败
4. `src/tools/` 顶层 **3 → 2**

## 7. 不做的事
- ✗ 不造"注册表快照"、不造过渡层、不留旧导出别名
- ✗ 不动 `check_monolith` / `derive_chain` 那些**仍是空壳/半空壳**的 action（那是 G7 的另一笔账，与本条无关）

---

## 8. ★★ 用户意见采纳：**按能力改判整条线**（不只是挪 import）

用户原话：「你不能**根据他的能力重新重构整个能力线**吗？这样的话，就不会有你那些隐患了呗。」

⇒ 采纳。取证后发现要害：**`sync_contracts` 现在挂在 `harvest`（收割）线**（`application/harvest/index.ts:64`），
但它的能力是「**以注册表为事实源，把工具契约回填进 DSL**」—— 这是**元数据 / 注册**的能力，**不是"收割"**。
它和 `capability_map`（同样以 `TOOL_DEFS` 为目录）是**同一族的**，而 `capability_map` 就在 **`meta` 线**。

### 改判
| 项 | 从 | 到 |
|---|---|---|
| `sync_contracts` 的工具归属 | `harvest` 线（收割） | **`meta` 线（元数据/注册）** —— 与 `capability_map` 同族 |
| 「工具表」这份事实 | 藏在 `presentation/mcp/server_registry.ts` 里 | **`application/tool_registry.ts`** 的一等数据 |
| `sync_contracts.ts` 的位置 | `src/tools/`（未搬） | **`application/meta/sync_contracts.ts`** |

### 为什么这样**隐患就结构性地不存在**（而不只是"这次修好了"）
- `sync_contracts` 与「工具表」**同层** ⇒ 任何方向的倒挂都不可能产生；
- 它不是"一个特例被容忍"，而是**回归它本该在的那条线** ⇒ 以后新增同类能力（任何"以注册表为准"的工具）
  都自然落在 `meta` 线，**不会再有"落哪都违规"的第三个文件**；
- ★ 顺带**消灭一条已知 `no-circular`**（`handlers → sync_contracts → server_registry → lanes → handlers`）。

### 改判会不会碰到门？
- `capability_map` 的**归属表**由 lane 数组**派生**（`laneOfFromSources`）⇒ 改判后**自动跟着变**，不用手抄 ✓
- `tool_set_snapshot.json`（G1）里工具的 **name/title/schema 不变**，只是**归属线**变了 ⇒ 若快照记了归属需重算（用 `UPDATE_TOOL_SNAPSHOT=1`）
- `single_source` / `INTERNAL_MODULES` / README 工具表：**按门报错逐条对**（不改判据）
