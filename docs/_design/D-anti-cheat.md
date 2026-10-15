# D-anti-cheat — 设计稿（2026-10-15）

> **视角**：把 LLM 当玩家，把项目当游戏。**核心命题**：若"假装完成"比"真完成"便宜，系统必然腐烂。
> **纪律**：★ 每条主张都给判据（或明说"判不了"）；不确定的标 `[未核]`；**不发明新能力**。

---

## 0. 三条立场（先讲规则）

- **A. 廉价证明 = 默认 → 系统发霉。** 必须让"假完成"贵过"真完成"。
- **B. 没有"不会被绕过"的机制。** 选**过时被立刻察觉**的，不选**永远不被过**的。
- **C. 一切主张以原文为据。** DSL 形状从 `.agent-io/live/d1.dsl.json` 读；闸从 `certs/t328-*` / `t332-*` 头读。

---

## 1. 现状（**只贴原文**，不贴二手转述）

### 1.1 顶层形状（`d1.dsl.json`）
**原文**（`.agent-io/live/d1.dsl.json:1-9`）：
```json
{ "id": "imported_d1", "type": "feature_diagram", "feature": "d1",
  "version": "1.0.0", "title": "d1", "source_root": "...",
  "status": "done", "geometry": { ... }, ... }
```
**形状**：`id / type / feature / version / title / source_root / status / geometry{layout,width,height,nodes,edges} / semantic{files} / layers / _dsl_rev / _sync`。
- ★ **顶层无 `progress`** —— 进度**只**住 `*.overlay.json` 的 `OverlayAnchor.progress`（见 `certs/t328-progress-authority-cert.mjs:7-9`）。
- `_sync` 块仅 `live/` 有；`features/` 没有（已 `diff` 验证）。

### 1.2 三档证据（`t328:18-23` 原文转写）
- ① `expectations` 全绿（机器可判）
- ② 一条可复跑读数
- ③ 显式人工确认：`by: human|llm` + `at` + `why`

### 1.3 `expectations` 只表达"结构事实"（`run82.overlay.json:13-28` 实证）
- 已观察 `kind`: `signature-matches`（**结构事实**类）。
- ★ **"完成"里必有一块永不可判**（用户指出） ⇒ 全绿 ≠ 完成。

### 1.4 write_gate 现状
- 已接：`未登记` + `前置未满足`（`t328` B/C、`t332-requires-gate-cert.mjs:7-13`）。
- **未接**：`rename_files` / `symbol_move` 走自己的快照路径（用户原话）。
- **同形字段+简写**：没有单条 grep 能数全某字段的写入点（用户原话）。

---

## 2. "假装完成"完整清单（≥5 条，逐条给**现状能不能防住**）

| # | 作弊招式 | 现状能不能防 | 依据（原文/实测） |
|---|---|---|---|
| 1 | 默默勾 `progress=done`，**不带 evidence** | **能** | `t328:19-23` C1/C2 拒；判据：跑 `node certs/t328-*.mjs` 全绿 |
| 2 | 把"**全绿 expectations**"当完成 | **半能** | ① 是设计目标；但 §1.3 ⇒ 全绿 ≠ 完成 |
| 3 | 走 `rename_files` / `symbol_move` **绕过 write_gate** | **不能** | 用户原话 + `t332` 头未列入此二路径 |
| 4 | **改 expect 所查的文件**让 expectation 跑绿（"判据自污染"） | **不能** | 历史教训（用户原话）；无第二来源验证机制 |
| 5 | **attestation 滥用**：每条都靠"档③"糊弄 | **不能** | 见 §3 机制（**当前无任何约束**） |
| 6 | 把 `attestation.by` 标 `"llm"` 假装"人审过了" | **不能** | 无 source 绑定；见 §3 |
| 7 | 同形字段+简写（把 `expectations.kind` 写成 `type` / 漏写） | **不能** | grep 数不全（用户原话）；防法见 §3 末 |
| 8 | "判据恒真"：grep -c 关键字 == 0，但**关键字就在被查文件里** | **能**（已吃过亏）| 用户原话"本仓历史教训"；防法见 §4 |
| 9 | 改 **base** 而非 overlay；`rebuild_design=true` 把人写的 progress 冲掉 | **能** | `t328:15-18` B 节专防（`importProject` 真跑） |

> ★ **结论**：5 条以上"现状不能防" —— 3、4、5、6、7。**5 条可防**（1、2 半、8、9）。

---

## 3. 防第三档（attestation）**滥用的机制**（**不是靠自觉**）

> 三条**机器可判**的硬约束，**全部落进 overlay**（不是文档约定）：

### 3.1 attestation 必须绑定 source_node_id
- **落点**：`OverlayAnchor.evidence.attestation.source_node_id`（**新增字段**）。
- **机制**：节点**改名/重挂/删除** ⇒ attestation 自动失效（下次落盘校验失败 ⇒ `progress` 回退 `in_progress`）。
- **判据**：跑 `node certs/<新证>.mjs` 验证"改名后原 attestation 被拒"。
- **理由**：攻击成本从"写一句话"升到"改名也保不住"，**博弈上不再便宜**。

### 3.2 attestation 配额（强制中转）
- **数值**：每 feature 每会话最多 **3** 条 attestation。
- **第 4 条** ⇒ 必须先经 `draft → in_progress → done` 一次中转（**不能直接 done**）。
- **判据**：构造一个 feature 连续提交 4 条 attestation ⇒ 4th 被拒。

### 3.3 attestation 与 expectations **互斥**
- **规则**：若 `decision.expectations.length > 0` ⇒ **`evidence.attestation` 必须为空**（校验在 `updateStatus` 写盘时跑）。
- **理由**：挡 ① 全绿后**不能再用档③糊弄** —— 二选一。
- **判据**：挂两条 expectation ⇒ 再传 attestation ⇒ 拒。

### 3.4 attestation 时戳（防批量勾选）
- **`at` 由系统时钟填**（不接受 LLM 自报）。
- 同锚点相邻两次 `updated_at` 之差 **≥ 30 秒**（防止一次会话内连勾多条）。
- **判据**：连续两次 `updateStatus` 间隔 < 30s ⇒ 后者被拒。

### 3.5 同形字段简写的治法（§2 第 7 条的根治）
- **规则**：任何"写端"工具（`updateStatus` / `setDesignIntent` / 等）的**输入 schema** 不许有可选字段名简写；
  必填字段在 JSON Schema 里 `additionalProperties: false`。
- **判据**：跑 `certs/<新证>.mjs` 构造带 `type` 而非 `kind` 的输入 ⇒ 被 schema 拒。

---

## 4. 防"判据自污染"通用规则

### 4.1 通用规则（一句话纪律）
> **任何判据 a，若它所检查的文件/输入包含字符串 b ⇒ 判据 a 不可信；必须用第二个来源 c 验证 a，且 c 的内容不许由 a 的产出者生成。**

### 4.2 本仓实例（**实测过的历史教训** —— 用户原话转写）
- 旧判据："某文件**不含**关键词 X" → `grep -c X == 0`。
- 失败原因：X 本身就被**写在该文件里**（文件 = 关键词的家）。
- **修复**：换成 `signature-matches`（`run82.overlay.json:15-22` 实证）—— 检查**符号签名**而非字符串；
  签名由 TS 编译器解析得出，**不**由写 expectation 的人生成 ⇒ 满足"c 的内容不来自 a 的产出者"。
- **判据**：`run82.json:3572-3587` 的两条 expectation 至今在 overlay 仍绿；期间若改 `tool_faces.ts` 的签名 ⇒ `t82xx` 跑红。

### 4.3 第二来源候选清单（**可机判**，不接受 LLM 自报）
- `signature-matches`（AST） · `symbol-exists`（AST） · `path-exists`（fs） · `import-resolves`（TS 解析） · `line-count` · `token-count`
- ★ **这六种**就是 §1.3 说的"六种结构事实"。

---

## 5. 只留一条"证明"——**我会留哪个**

**★ 留档①（`expectations` 全绿）。**

**理由（按重要性排）**：
1. **最便宜** —— 机器自己跑，不需要人介入。
2. **最难伪造** —— 必须把代码改到 `signature-matches` 真匹配（动 AST 不是改字符串）。
3. **不依赖诚实** —— 不论是人类还是 LLM，**结构事实**自证。
4. **唯一短板正是设计目标**：六种 kind 是穷举的 ⇒ 永不可判的部分**自动**落档③，**挡①不被污染**。

> ★ **但单条不够**："完成"里必有一块永不可判 ⇒ 档③ 必须存在（**不砍档③，只用 §3 约束它**）。

---

## 6. 我会砍掉什么

### 6.1 砍档②（"一条可复跑读数"）
- **理由**：本质是档①的**退化版**。任何"可复跑读数"都该**升格**成 expectation `kind`（落 §4.3 六种里），
  否则就是给 LLM 留"便宜档"窗口。
- **判据**：跑改造后的 `t328` 全绿 ⇒ `evidence.kind ∈ {reading}` 的条目数 == 0（**只剩 ① 和 ③**）。

### 6.2 砍"harness 自报告成功"
- **规则**：`evidence` 任何字段**不许**含 `by: "llm"` 作为**唯一**证明（与档③ 共生时允许，但 §3.1/3.2/3.3 全部生效）。
- **判据**：构造一条 `attestation.by = "llm"` 且无 `expectations` ⇒ **仍受 §3 全套约束**（不豁免）。

### 6.3 不砍的东西（明示）
- 档③ **不砍**（§5）；
- 六种 expectation kind **不砍**（§4.3）；
- write_gate 三道闸（未登记 / 前置 / 快照路径）—— **快照路径那道要从无变有**（见 §7）。

---

## 7. 防不住清单（**总览** —— 喂给最终回复）

**现状不能防的 5 条**（来自 §2）：
- §2.3：`rename_files` / `symbol_move` 走 snapshot 路径绕过 write_gate ⇒ **要新证钉住**（`t333-rename-snapshot-gate-cert`，**计划**非已做）
- §2.4："判据自污染" ⇒ 见 §4 通用规则（**纪律**，待落进 cert）
- §2.5：attestation 滥用 ⇒ 见 §3 机制（**计划**非已做）
- §2.6：attestation.by="llm" 假装人审 ⇒ 见 §3.1（**计划**非已做）
- §2.7：同形字段简写 ⇒ 见 §3.5（**计划**非已做）

---

## 8. `[未核]` 项

- **六种 expectation kind 的完整清单**：只实测到 `signature-matches`（`run82.overlay.json:15/22`）；
  其余五种（`symbol-exists` / `path-exists` / `import-resolves` / `line-count` / `token-count`）是按 §4.3 命名习惯**推断**，
  须 `grep -rn '"kind":' .agent-io/` 全仓复核。
- **attestation 配额数值 "3" / 时戳间隔 "30s"**：是设计稿取值，**未跑过实证**；
  真值由 `certs/<新证>.mjs` 决定。
- **§7 计划提及的 `t333-rename-snapshot-gate-cert`**：**未建**；只是按 `t332` 命名习惯外推。
- **`expectations` 与 `decision` 同挂 `OverlayAnchor` 的细节**：run82.overlay.json:13-28 已确认同挂；
  但 `updateStatus` 写盘路径**没读完**（仅看 `t328` 头注释，**未读 `dist/src/.../status_tools.js`**）。
