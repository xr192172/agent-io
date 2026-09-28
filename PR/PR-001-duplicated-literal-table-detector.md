# PR 需求：单源映射表 + 漂移检测（Duplicated Literal Table Detector）

- 提出方：`dsh-brain` 项目（DSH 底座上的三脑编排 / 席位机制）
- 日期：2026-09-27
- 类型：需求（Requirement），非补丁
- 状态：待评估

---

## 0. 一句话

> **同一个「映射表」在仓库里被复制了 6 份、每份自己的常量名。**
> 请提供一个「检测重复字面量表 + 建议单源化」的工具。
> 这正好接上本项目已有的 `TRIGGER_ROWS → AGENTS.md`（单源生成）思路，
> 只是希望把它**从"一个项目的自用做法"推广成"能扫任意仓库、能判红的能力"**。

---

## 1. 现场（我这边真实发生的事）

### 1.1 背景

`dsh-brain` 里有一个「席位」机制：三个 agent 席位
（架构师 / 开发 / 审查），每个席位用一份 Markdown 定义（persona + 契约）。

同一个席位**有四种名字形态**：

| 形态 | 例 | 用在哪 |
|---|---|---|
| 唯一名（连字符） | `council-architect` | md 的 `frontmatter.name`、provider 名 |
| 工具名（下划线） | `council_architect` | 模型真正调用的工具名 |
| 短名 | `architect` | 契约 API 的 key、门脚本的索引 |
| 派发名 | （取决于 preset 配置） | 会话启动时注入 |

**短名 → 唯一名** 需要一张映射表。

### 1.2 事故形状（这才是要解决的问题）

这张**完全一样**的映射表，在仓库里被**手工复制了 6 份**，而且**每份有自己的名字**：

**口径说明**：下面列的是**活代码**（被 git 跟踪）里的副本 = **5 处**，
落在 **4 个文件**（其中 `seat-contract.mjs` **一个文件里就有两处**）；
若按"常量声明条数"数则是 **6 条**（`LEGACY_ALIASES` 是 3 键的多行对象，另算一条）。

```js
// packages/subagent-council/src/index.ts:92       ①
const LEGACY_ALIASES = {
  architect: "council-architect",
  dev: "council-dev",
  review: "council-review",
};

// scripts/seats/seat-contract.mjs:348              ②  ← 同文件内出现两次！
const shortToUniq = { architect: 'council-architect', dev: 'council-dev', review: 'council-review' }

// scripts/seats/seat-contract.mjs:365              ③  ← 同一个文件里的第二份
const shortToUniq = { architect: 'council-architect', dev: 'council-dev', review: 'council-review' }

// scripts/seats/gen-roster.mjs:84                  ④
const UNIQUE_OF = { architect: 'council-architect', dev: 'council-dev', review: 'council-review' }

// scripts/seats/test-evo-seats-online.mjs:68       ⑤
const PROVIDER_OF = { architect: 'council-architect', dev: 'council-dev', review: 'council-review' }
```

★ **副本有 5 处、常量名有 4 种**（`shortToUniq` 这个名字被用了两次）——
**"名字不全不同"正是它逃过 grep 的原因**（见 §1.3-3）。

### 1.3 它实际造成的伤害（不是理论风险）

1. **改一席要改 6 处** —— 漏一处就静默不一致。
2. **已经出过一次真事故**：`seat-contract.mjs` 的目录模式下，
   一处 `shortToUniq` 遮蔽了另一处 ⇒ 生成的键**从短名退化成唯一名**
   ⇒ 下游 `test-seat-contract` 与 `gen-roster` **双双报错**（实测「席 dev 解析不到」）。
   ★ 根因就是**"同一个映射表有两份，两份的可见性不同"**。
3. **每份的名字都不同**（`LEGACY_ALIASES` / `shortToUniq` / `UNIQUE_OF` / `PROVIDER_OF`）
   ⇒ 用 `grep 一个名字` **永远扫不全**（这就是为什么它能活到第 6 份）。

---

## 2. 需求（要什么）

### 2.1 核心能力

**扫描仓库，找出「内容（近似）相同的字面量映射表 / 常量表，出现在多个位置」的地方，并报到能修的程度。**

- **输入**：仓库根 / 一组路径 / 语言范围（TS / JS / JSON / YAML）。
- **判定对象**：字面量集合类型 —— 对象字面量、`Record`/`Map` 初始化、
  JSON 对象、`as const` 数组。★ 重点是**静态可判定的字面量**，不做数据流分析。
- **相等判据**：
  - 键集合相同 **且** 值集合相同 ⇒ **完全重复**（硬红）；
  - 键集合相同、值部分相同（相似度 ≥ 阈值） ⇒ **疑似重复**（黄，提示复核）。
- **输出**（关键：要能直接改，不是只报个警告）：
  - 重复组的**全部位置**（文件 + 行 + 常量名）；
  - 每个副本的**常量名**（因为这个工具的价值一半在于暴露"6 份有 6 个名字"）；
  - **单源化建议**：哪一份适合当源（判据见 §2.3）、其余如何改成 import；
  - **锚点**：源应放在哪个模块（可选，给建议不给强制）。

### 2.2 判据（能不能红，决定它算不算门）

请参考本项目既有的诚实口径（**"能红"才算门**）：

- **必须能红**：往仓库里故意插一份重复表 ⇒ 工具报红（退出码非 0）。
- **消融自证**：把检测逻辑去掉 ⇒ 同一输入**必须变绿**（证明红是它造成的）。
- **不许假绿**：扫描不到（路径错 / 语言不支持）必须 `unknown`，**不许**算"通过"。
- **不许假红**：结构不同但长得像的（例如值不同、键不同）不许报。

### 2.3 单源化建议的选源判据（请明确写清，别让用户猜）

建议按这个优先级（可讨论）：
1. 已经是**构建期生成物**的那份（若存在）> 2. 被 import 次数最多的 > 3. 位于依赖最上游（被更多人依赖）的。

★ **特别希望**：如果某个重复表**已经被一个生成器产出**（像本项目 `TRIGGER_ROWS → AGENTS.md`），
工具应能**优先推荐它当源**，并把其余副本标成"应改为从生成物 import"。

---

## 3. 为什么是 agent-io 来做（而不是我自己写脚本）

1. **本项目已经有这个模式的正确先例**：`scripts/gen_agents.mjs` 的
   `TRIGGER_ROWS`（单一事实源）→ 生成 `AGENTS.md`，并在生成物里印
   「**改工具映射请改 TRIGGER_ROWS，不要手改本表**」。
   ⇒ 这是同一类问题的**已有答案**，只是**没有被做成"能扫任意仓库"的工具**。
2. **本项目已有相关基建**：`src/tools/consistency.ts`、`contract_gate.ts`、
   `capability_matrix.ts`、`ast_parser.ts`（tree-sitter）、`find_references`。
   ⇒ 语言内的字面量提取与引用查找，本项目的 AST 根基**已经具备**。
3. **它属于"工具收敛"这条线**：`docs/tool-convergence.md` 逐字说
   「真实问题是**三类不同性质的工具混在一起，没有入口语义**」
   —— 本需求是**同一病理的另一个切面**（"同一个真相混在 6 个地方，没有单一入口"）。

---

## 4. 验收（我这边会怎么验）

我拿到实现后，会用**我自己仓库的真实 6 份重复**当验收材料：

| # | 判据 | 期望 |
|---|---|---|
| A1 | 扫 `dsh-brain` 的 `packages/` + `scripts/` | **报出** `LEGACY_ALIASES` / `shortToUniq`×2 / `UNIQUE_OF` / `PROVIDER_OF` 属同一组 |
| A2 | 单源化建议 | 推荐其中一份为源，其余 5 处给出 import 改法 |
| A3 | **消融** | 删掉检测逻辑 ⇒ A1 不再报红 |
| A4 | 假红对照 | 值不同但键相同的表（如两份不同的 `{architect, dev}` 映射到不同东西）⇒ **不报完全重复** |

★ 若 A1–A4 全过，我会在 `dsh-brain` 里真的把这 6 份收敛成 1 份。

---

## 5. 边界（明说，不假装）

- 本需求**不要求**数据流分析、不做运行时去重、不做跨语言语义等价。
- 本需求**不要求**自动改写仓库 —— 给出**可执行的建议 + 精确位置**即可，
  真改由人（或本项目已有的 `rename_symbols`）来做。
- 若判定"字面量相同"存在歧义（例如值顺序不同、注释不同），
  **请按 §2.2 走 `unknown`**，不要硬判。

---

## 6. 附：现场证据可复现

```bash
cd dsh-brain
grep -rn "architect: 'council-architect'\|architect: \"council-architect\"" \
  --include=*.mjs --include=*.ts . | grep -v node_modules | grep -v .workbuddy
# 实测输出 8 行 = 5 行活代码（§1.2 的①②③④⑤）+ 3 行历史残留（out/_w59、out/_witness6×2）
```

★ 注：`out/_w59`、`out/_witness6-*` 下还有 3 份，属**历史实验残留**，
不列入本需求（它们不是活代码）—— 这也说明一条：
**工具需要能区分"活代码里的重复"与"历史残留里的重复"**（可按 `git ls-files` 跟踪状态过滤）。
