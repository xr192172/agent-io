# ARBITRATION.md —— 需要你裁决的清单（★ 其余我已实测定掉）

> ★ 2026-10-18 起。**只有"机器判不了"的才放这里** —— 能实测的，我先测完再写结论。

---

## A · 已实测定掉（不需要你裁）

| # | 争议 | 实测结论 | 谁错 |
|---|---|---|---|
| **A1** | 注册面 **7 处 / 12 行 / 8 处** 三种说法 | ★ **2 处**：`LANE_SOURCES` 加一行 + 对应 lane 文件加 def。因为 **P1c 已把"手抄 6 份清单"改成"1 处映射"** | ★ **`dc-add-tool` / `dc-remove-tool` 都过时**（P1c 之前） |
| **A2** | **PATH 正常 vs PATH 损坏** | ★ **正常**：`node`/`npm` 都在 `.workbuddy/binaries/node/versions/22.22.2-6/`，`node -v` = v22.22.2 | ★ **`dsh-profile-integrity` 记的是旧环境/特定坑** |
| **A3** | G1/G8 快照是否还在 | ★ **`G8` 只 1 处** ⇒ 印证 `dc-add-tool` 自己写的"测试框架已移除" | —— |

---

## B · 需要你裁（3 条，每条给"选项 + 我的建议"）

### B1 · 三簇重复：**以谁为权威？**

**簇 1「门 / 假信号 / 消融」**（`gate-authoring` · `guard-blindspot-diagnosis` · 部分 `verify-delegated-work` · `internalize-external-agents`）
- 假信号"三档"在 **`gate` §3** 和 **`guard` §1d/§7b/§7d** 各有一套
- "撤掉修复必须变红"在**四处**出现

★ **我建议**：**`gate` 保留"怎么写"，`guard` 保留"坏了怎么查"** —— 三档表在 `gate` §3 定稿，`guard` 只链接。
★ **理由**：`gate` 是"造门前"（正向），`guard` 是"门坏了"（反向）—— **正向该定标准**。

**簇 2「DSH 宿主平面 / Code Mode」**（`dsh-agent-preset-authoring` · `dsh-profile-integrity` · `prompt-cache-reuse-diagnosis`）
★ **我建议**：**以 `dsh-profile-integrity` 为权威**（它讲装配），另两份只保留"对本主题的推论"。
★ **理由**：装配是根，另两份是它的两个后果。

**簇 3「dc-add / dc-remove 的登记面与四条验收」**
★ **我建议**：**抽 `docs/TOOL-REGISTRATION.md` 作唯一来源**，两份 skill 各写"加/删时的特殊性"。
★ **理由**：同一张表两个方向写两遍 ⇒ 必然漂移（A1 就是证据）。

### B2 · 四处"三份讲同一件小事"：**抽公共文档，还是各留一份？**

| 小事 | 出现在 |
|---|---|
| `docs/` 被 ignore 要 `git add -f` | `dc-remove` §六 / `dc-open-parallel` §二.1 / `git-repo` §八 |
| MSYS 路径陷阱 | `dc-remove` §四 / `git-repo` §三 |
| `request/header` 是权威 | `dsh-profile-integrity` / `prompt-cache` §1 |
| 证据分级 + 未核实清单 | `oss` §4 / `face-bench` §六 / `verify` §2 |

★ **我建议**：**抽一份 `docs/PITFALLS.md`**（坑清单），三份 skill 各留一句"见 PITFALLS#x"。
★ **理由**：**这四条都是"环境坑"** —— 而**环境坑最会变**（如 A2 的 PATH）⇒ **集中一处才不会三份同时过期**。

### B3 · 两份"假信号三档"的分类学：**要不要合并成一套？**

- **`gate` §3**：按"有没有坐标"排序的三档（分类学）
- **`guard` §1d/§7b/§7d**：按"实证案例"展开（同一批案例的不同切法）

★ **我建议**：**合并成一套**（用 `gate` 的分类学当骨架，`guard` 的案例当注脚）。
★ **理由**：**两套分类 = 两种口径** ⇒ 读者不知道该用哪套判；而**它们讲的是同一件事**。

---

## C · 我不该替你判的（明确留给你）

| # | 事项 | 为什么该你判 |
|---|---|---|
| **C1** | ② `coverage 17%`：**哪些 interface/type 算"对外契约"** | 我给三类的建议（见下），但**"边界在哪"是产品判断** |
| **C2** | Skill 的**删不删** | 子代理报了"重复最重的三簇"，但**删是破坏性的** |

### C1 的具体建议（你只需说"同意 / 不同意"）

| 类 | 例子 | 我的建议 |
|---|---|---|
| **工具入参/出参** | `AddNodeInput` · `DeleteNodeInput` · `CheckedOperation` · `ConstructBasis` | ★ **该进设计**（它们是"接口契约"，调用方按它对账） |
| **领域类型** | `CardStanding` · `DiagramStatus` · `Expectation` · `DecisionAuthor` | ★ **该进设计**（它们是"语义契约"，跨文件共享） |
| **内部细分** | `EdgeKeysExtra` · `EdgeKeysMissing` · `EdgeOwnedKeys` · `DriftRed` | ★ **不该进**（校验的中间产物，随时可改） |

★ **按这个分，161 个导出里该声明的大约 40-50 个**（而不是 135 个）⇒ **覆盖度会从 17% 到 ~55%**。
