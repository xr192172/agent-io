# B · 世界规则 —— 把 LLM 当玩家、把项目当游戏

> 视角：**世界规则 / 一致性**。游戏世界的铁律：**世界必须自洽，否则玩家会学会钻空子**。
> 玩家 = LLM；世界 = `.agent-io/` 里的 DSL + overlay + write_gate；GM = 用户。
> 纪律：报告"某处有某字段"必贴原文；判不了的明说。本文不改任何既有文件。

---

## 0. 先贴现状（读 DSL 的原文，不从实现推形状）

live DSL 顶层（`.agent-io/live/t192flow.dsl.json`）：

```json
{ "id": "imported_t192flow", "type": "feature_diagram", "feature": "t192flow",
  "version": "1.0.0", "title": "t192flow", "source_root": "…",
  "geometry": { "layout": "free", "width": 800, "height": 400,
    "nodes": [ { "id": "file_src_a_ts", "label": "a.ts · 1 APIs", "x": 80, "y": 110,
                 "width": 240, "height": 64, "type": "file", "description": "src/a.ts",
                 "arch_layer": "core" } ],
    "edges": [ { "id": "contains_src_src_a_ts", "from": "dir_src", "to": "file_src_a_ts", "label": "contains" } ] },
  "semantic": { "files": [ { "id": "file_src_a_ts", "path": "src/a.ts", … } ] },
  "layers": [ … ],
  "_sync": { "saved_at": "…", "source": "live", "feature": "t192flow" } }
```

overlay 顶层（`.agent-io/features/observe-skeleton.overlay.json`）：

```json
{ "version": 1, "feature": "observe-skeleton",
  "anchors": { "contract_obs_1": { "path": "…", "kind": "doc",
    "decision": { "summary": …, "rationale": …, "consequences": …, "acceptance": …,
                  "status": "active", "evidence_source": [ … ], "updated_at": …, "agent": … },
    "decision_history": [ … ] } } }
```

权威/投影铁律（`src/domain/overlay.ts` 头注释逐字）：
> "真相 DSL（base）由代码扫描每次可再生，但设计意图（决策卡 / 决策历史 / 设计参数 / 标注 /
> user_node / 分镜 / 主题）不是扫描能重造的。……与项目铁律同构：**真相单源 + 单向投影 + 对账**（不改 DSL 只报偏差）。"

进度权威（`overlay.ts:209` 逐字）：`progress?: DiagramStatus;`，注释自述
"权威住 overlay，`applyOverlay` 把它投影回 base（`geometry.nodes[].status` / `semantic.files[].status`）"。

evidence 三档（`overlay.ts:81-87` 逐字）：
```ts
export type ProgressEvidence =
  | { kind: 'expectations'; all_green: true; unsupported: 0; ref?: string }
  | { kind: 'reading'; command: string; observed: string; at: string }
  | { kind: 'attestation'; by: 'human' | 'llm'; at: string; why: string };
```

前置（`overlay.ts:284` 逐字）：`requires?: string[];`（"只有显式标了 `requires` 的 edge 才产生拦截；
没标（undefined/空数组）一律不拦"）。

进度写点实测：`anchor.progress =` 全仓仅 2 处 ——
`status_tools.ts:86`（**权威写端**）与 `overlay.ts:611`（`seedOverlayFromDsl` 首次迁移）。
与 replan §0.5 基线一致："进度**权威**写端 **1**（`status_tools.updateStatus`）；
进度**投影/首次迁移** `applyOverlay`（投影）+ `seedOverlayFromDsl`（迁移），各 1"。

---

## 1. ★ 世界规则清单（6 条，每条带可复跑判据）

| # | 规则 | 一句话 | 可复跑判据 |
|---|------|--------|-----------|
| R1 | **真相单源** | 可再生的（形状）住 base；不可再生的（意图/进度）住 overlay | `anchor.progress =` 的写入点数：权威写端 = 1（`status_tools.ts:86`），另有 1 处首次迁移（`overlay.ts:611`）。复跑：`grep -rn "\.progress\s*=" src/` → 恰 2 处 |
| R2 | **单向投影** | 权威 → 投影，只许 overlay 改 base，不许 base 回写 overlay（迁移除外） | `applyOverlay` 读 overlay 写 base；反方向持久写入点 = 0（`seedOverlayFromDsl` 仅首次铺回）。base 上的 `Node.status` 永远是"应用结果"，改它无效 |
| R3 | **谁能写** | 改源码可以，但**不登记不许悄悄改**：过 `write_gate`（未登记拒 / 前置未满足拒） | 复跑：对覆盖中的文件未登记 progress 就调 `edit_code` ⇒ 抛"拒绝落盘（任务闸）"。判据：闸抛错路径有测试/当场可试 |
| R4 | **怎么算完成** | `progress='done'` 必须带 evidence 三档之一，**不静默、不自动补、不降级** | 复跑：`edit_dsl` 置 done 不带 evidence ⇒ `validateProgressEvidence` 抛"拒绝：progress='done' 必须带一条 evidence" |
| R5 | **前置解锁** | 解锁只认**显式** `requires`；空/缺席一律不拦（import 边 ≠ 任务前置） | 复跑：`requires:['A']` 且 A 未 done ⇒ 改 B 源码被"前置闸"拒；`requires:[]` ⇒ 放行 |
| R6 | **判据唯一** | 同一判据只许住一处（本仓头号病根是"同一件事多个表达"） | 复跑：同问句 grep 命中集合 == 白名单（replan §2"判据唯一度：0 个已知副本"）。反例存档：§10.2 六套状态轴、§14 opl.ts 一套 |

---

## 2. ★ 冲突裁决顺序（两个表达打架时谁赢）

**一层一层往下裁，上层永远赢：**

1. `overlay.anchors[id].progress` —— **唯一权威**，赢一切；
2. `base.geometry.nodes[].status` —— 投影，与 1 冲突时**视为过期投影**（stale），下轮 `applyOverlay` 被覆盖；冲突本身 = 偏差，**只报不改**（铁律原文"不改 DSL 只报偏差"）；
3. `dsl.status`（feature 整体）—— 派生值，**不落库**，读侧走 `resolveDiagramStatus`（`status_tools.ts:22` 逐字："它是从各节点状态算出来的派生值"）。

一句话：**progress 说 done、Node.status 说 draft ⇒ 世界裁决为 done，base 是脏投影，报偏差并等对账。**

---

## 3. ★ 钻空子清单（玩家怎么假装推进）

| # | 钻法 | 现状防住？ | 依据 |
|---|------|-----------|------|
| C1 | 不写 evidence 直接置 done | **能** | `validateProgressEvidence`（`status_tools.ts:70`）先过闸再落盘，"不给 ⇒ 抛错并说清理由（不静默、不自动补）" |
| C2 | 写一条**自证** evidence（`attestation, by:'llm'`）把 done 糊上去 | **不能** | 三档原文允许 `by:'llm'`（`overlay.ts:87`）；形状校验只查字段齐不齐（`validateEvidenceShape`），**不查证据真伪**。玩家自己给自己签名，闸在结构上无法拒绝 |
| C3 | 把 `requires` 指向永远不会 done 的节点 | **能**（方向安全） | 前置闸只拦"未 done"，卡死的是玩家自己，不是世界 |
| C4 | **自己解除前置**：用 `design_intent` 把 `requires` 清成 `[]` 再开工 | **不能** | 前置闸的错误信息自己写了"② 若这个前置判断已过时 ⇒ 用 design_intent 显式解除"（`write_gate.ts:632-633`）；**没有任何人确认**这一步，玩家可自行"宣布过时" |
| C5 | 在别的项目/feature 里登记进度绕过闸 | **半防** | 闸按 `source_root === 项目根` 反查覆盖 feature（`write_gate.ts:495`），跨项目登记**不计数** ⇒ 这条防住了。但玩家可**新建一个自己的 feature 指向同一项目根**、给全仓文件登记 `in_progress` ⇒ 闸条件"任一条登记过即通过"（`write_gate.ts:650`）满足 ⇒ 放行。防不住 |
| C6 | 绕过本服务器的工具，用自己原生的 Write/Edit/改盘 | **不能** | 闸住在 MCP 工具内部（`edit_code.ts:486` / `writeSourceFiles:764` / `snapshotAndRecordSelfWrite:813`）；写盘咽喉是 `fs.writeFileSync`，闸在它**之上**一层。玩家不走工具，闸完全不在写入路径上 |
| C7 | 走旧轴：直写 `node.status` | **当前能防**（条件性的） | 已知残留 2 处（replan §0.5 基线：`opl.ts:322` · `simulation_engine.ts:326`，"内存直写、仓内无调用方、从不落库"）。我在 `simulation_engine.ts:326` 亲见 `node.status = up.status`；opl.ts 有独立状态机（`s.status='located'/'implementing'/'integrated'`…）。**只要它们不落库就不构成作弊面**；哪天有人接上落库，R1 即破。判据依赖"仓内无调用方"[未核] |
| C8 | 造一条假 `reading` 证据（command 随便填） | **不能** | `reading` 档只存 `command/observed` 字符串，**没有复跑器**去验证 observed 与 command 的产物一致。证据是"一张写了字的纸"，不是"可重放的实验" |

---

## 4. ★ 我最不放心的一条：R3（谁能写）

**R3 的完备性靠纪律维持，不靠结构。** 两个理由：

1. **闸的挂载是逐工具手挂的**：`edit_code` 当初就不走 `writeSourceFiles`，是 T328 步 6 事后内联补的（`edit_code.ts:483` 逐字："本工具**不走 `writeSourceFiles`（内联四件套）"）。下一个新写工具忘记挂闸 ⇒ 静默多一个作弊面，且**没有任何证盯着"每个写工具都过闸"这个全称命题**。判不了：我无法穷举"全部写源码的路径"来证完备 [未核]。
2. **闸在写入路径的"上面一层"**（见 C6）：玩家一旦拥有任何非 MCP 的写盘手段（原生工具 / shell），R3 整条失效。闸拦的是"礼貌玩家"，不是"所有写入"。

**失效方式可判**：写一个证，枚举"改动源码"的对外工具清单 × 各自过闸调用点，白名单外命中即红。今天这张证不存在。

---

## 5. 我会砍掉什么

1. **砍 `attestation` 档里的 `by:'llm'`**（或要求 GM 署名）：C2 是整张清单里最便宜的作弊，且它是**规则自己开的门**。
2. **砍 `reading` 档的"只存不复跑"**：要么给 `command` 配一个复核执行器（主线 C 的"可复跑复核命令"同款），要么降级为注释。现状它给 done 盖了个没人验的章（C8）。
3. **砍旧轴残留**：`opl.ts` 状态机与 `simulation_engine.ts:326` 的内存直写——不死代码是世界规则的腐化源（C7 的引信）。砍不动就先立证盯着"从不落库"。
4. **不砍** `Node.status`（base 投影）本身：渲染和读侧靠它；要砍的是"把投影当第二个表达去写"的念头。

---

## 6. 诚实清单

- `[未核]` "opl.ts:322 / simulation_engine.ts:326 仓内无调用方、从不落库"——引自 replan §0.5 基线（自称实测）；我只亲见了后者的直写行（`:326`），未逐个追调用方。
- `[未核]` R3 的完备性：未穷举"全部能写源码的工具"，闸调用点只核到 5 处（edit_code ×2 / writeSourceFiles / snapshotAndRecordSelfWrite / apply_writes 适配层）。
- `[未核]` §10.2"六套状态轴"与 §14"opl.ts 一套"的完整名单——出处是 replan-log（按纪律未读），本文只亲见 opl.ts 一套。
- 判不了：C2/C4/C5/C8 属"**规则允许玩家自证**"的结构性缺口，机制内无判据可防；只能靠 GM 介入或改规则形状。
- 本文所有"贴原文"均来自实读文件；行号以 2026-10-15 工作区为准，后续提交可能漂移。
