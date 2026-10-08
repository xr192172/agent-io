# AOCI 的机读 DSL vs 本仓 DSL（2026-10-08 实样对照）

> 起因（用户）：*"我们不是有参考项目吗？DSL 是最开始我一步步推演过来的，没有看这些参考的。
> 两个参考项目里面，有一个是专门面向机读的。他的 DSL 写法会不会比我们更优？
> 然后它的那个 DSL 依赖于 LLM 去把项目翻译成 DSL，但是我们的 DSL 是代码自动生成的。
> 哦，不对，我们的 DSL 也依赖于大模型，那这样呢就更像了。"*
> **取证**：clone 真源码 `D:/project_develop/_research/aoci-code`（`v0.1.0-rc17`），
> 读 `aoci.txt` / `aoci.meta.txt` / `aoci.code.txt` 实样 + `spec/public/aoci-index-format-v1.txt` + Go 侧工具面。
> ★ 许可：**FSL-1.1-MIT**（Fair Source，**非 OSI 开源**，带竞争性使用限制，两年后转 MIT）
> ⇒ **机制/思路可学，源码不可搬。**

## 1. 它长什么样（实样，不是宣传）

**三卷 + 每卷自述格式**：

| 文件 | 规模 | 是什么 |
|---|---|---|
| `aoci.txt` | **7 行 / 305 字节** | **root manifest**：`#Format-Version: cognition-volumes/v1`；`#Volume: id=code path=aoci.code.txt format=object-fras-v2 depends=meta state=enabled` |
| `aoci.meta.txt` | **20 行 / 910 字节** | **自述卷**：`#Object-Protocol`、`#FRAS-Discipline`、`#S-Admission`、**`#S quota: C9-8≤600 C7-4≤200 C3-1≤50`**、标签字典 |
| `aoci.code.txt` | **640 行 / 195,231 字节** | 主体：**一行一个文件** |

**记录格式 `object-fras-v2`**：
```
<path>[<tags>]: F:<事实> | R:<关系> | A:<依据> | S:<陷阱>
```
标签 `[CG8T]` = A层(`C`=Code) + B模块(`G`=General) + C重要度(8) + E规模(`T`=tiny)；可带 `[D]`。

**逐字实例**（取自 `aoci.code.txt`，截断）：
```
go.mod[CG8T]: F:Declares the canonical Go module, exact Go version, and pinned runtime graph… |
R:code:third_party/openGauss-connector-go-pq/go.mod,code:THIRD-PARTY-NOTICES | A:Go module dependency graph |
S:The exact local replace keeps builds off unpatched upstream; … a first-party import must be a direct requirement, since CI tidies and diffs the marker
```
目录分节头：`===<绝对目录>/==="`。

## 2. 逐项对照

| 维度 | AOCI（`object-fras-v2`） | 本仓 DSL |
|---|---|---|
| 载体 | **纯文本**，一行一条，可 git diff / 回滚 | **JSON**（`geometry` + `semantic` 混装） |
| 卷结构 | root manifest + **自述卷**（每卷带 `format=` 与 `depends=`） | 单文件；`version:"1.0.0"` 是 **feature 版本**，**不是格式版本** |
| 记录粒度 | **一个文件一行** | 节点（文件**+目录**）+ 边 + 语义层 |
| 字段 | **固定四格** `F/R/A/S`（强制齐） | 各段自由（`geometry` 有坐标/颜色/圆角） |
| 关系 | **行内** `R:code:a.go,code:b.go`，带**命名空间前缀** → 一条记录自带出边 | 边在 `geometry.edges[]`、依赖在 `semantic.files[].actual_deps`；**各带 id/from/to/label 四段** |
| 陷阱 | **`S:` 一等公民**，且**有准入判据** | 最接近的是 `decision.consequences`，**无准入判据** |
| 长度约束 | **有**（`C9-8≤600 C7-4≤200 C3-1≤50`，且声明为 machine-contract） | **无**（`goals` / `acceptance` 想多长多长） |
| 坐标 | **完全没有** | `geometry` 占 **28.9%**（`d1.json` 实测 939/3,254 字符） |
| 读法 | 人/LLM 一遍读完 = 全仓地图，token 极省 | 要读 JSON 结构 + 解码节点 id（`file_src_core_format_ts`） |
| 能否执行 | **不能**：描述性认知压缩，不生成语义、不改代码 | **能**：`scaffold` / `edit_code` / `consistency_check` / rename 联动的输入 |
| 落盘 | 进 Git | `.agent-io/`（gitignore） |
| **工具面** | **9 个**（`machinecontract` 权威清单；且**有测试锁死**：「nine-tool surface changed」） | **61 个**（编排面 12 个） |
| ★ **一行式认知视图** | *它就是全部* | ★ **我们也有**：`get_dsl query=digest`（`路径[层]: F:… \| R:… \| A:… \| S:…`，源码注释自称"AOCI 形状"）—— **但三处引导都不点名它**（见 §7） |

## 3. ★ 两边都依赖 LLM，但**角色相反**（回答用户那句"更像我"）

**你说的对：两边都有 LLM。但它在两端：**

| | AOCI | 本仓 |
|---|---|---|
| LLM 是 | **作者**（model-authored first-index：整个索引由模型写） | **注释者 / 裁决者** |
| 事实来自 | LLM 通读仓库后写 | **解析器扫描**（`import_project` 的文件/边/API 签名） |
| LLM 的活 | 写 F/R/A/S 全部四格 | `gen_roles`（默认 **false**，未配 LLM **静默跳过**）、`annotate_functions`、`harvest_decisions`、`classify_bricks` |
| 因此它的防错必须是 | **防 LLM 编造**：`#S-Admission: non-inferable-and-error-preventing`（"**不可推得 且 能防错**"才有资格写）、字符配额、Validator、`machine-contract` 权威条款 | — |
| 而我们该防的是 | — | **防人读不懂**（`docs/guidance-audit.md` 第一条）——**这件事今天基本没做** |

⇒ 一句话：**相似的是"有 LLM 参与"，相反的是"LLM 在造事实，还是在给事实起名"。**

## 4. 它确实更优的地方 —— 该抄的 5 条

1. **显式格式版本**：`#Format-Version: cognition-volumes/v1` / `format=object-fras-v2`。
   我们的 `version` 字段是 feature 版本 ⇒ **格式漂了没处看**。
2. **准入判据写进格式**：`#S-Admission: non-inferable-and-error-preventing`
   ——不是"这条有用就写"，而是"**不可推得 且 能防错**"才准写。
3. **字符预算，且声明为机器契约**：`#S quota: C9-8≤600 C7-4≤200 C3-1≤50`
   （`#FRAS-v2-Limits-Authority: machine-contract`）。我们的 `goals` / `acceptance` **无约束**
   ——旁证：`design_intent` 描述 689 字 vs `consistency_check` 75 字，就是"没有预算"的后果。
4. **关系行内化 + 命名空间前缀**：一条记录自带出边，**不必跨表查**
   ——这直接对上我们"链要手工拼"的病（`docs/orchestration-audit.md`）。
5. ★ **给"LLM 忘了自己读过"配了探针**：`aoci_overview` 带游标分页（`next_cursor` / `completed`），
   且有一条明写的失败判据 ——「`cognition loss measured; declare context_compaction: call aoci_overview with refresh_reasons=["context_compaction"]`」。
   ⇒ 我们的 DSL 有**同一个病**（上下文一压缩，LLM 就忘了"有三个层"），但**没有探针**。

## 5. 但它为"更机读"付了税 —— 可量化

`spec/public/aoci-index-format-v1.txt` = **170 行 / 9,421 字符**，拆开看：

| 章节 | 行数 | 讲什么 |
|---|---|---|
| 「Directory and file names」（L56–136） | **81 行 = 47.6%** | **"这一行怎么读"**：section header 的路径到哪结束、文件名带 `[` 怎么切、目录名带 `(`/`=`/空白怎么读、clone 到别处怎么重定位…… |
| 「Object Entry」（L137–155） | 19 行 | **"记什么"** |

⇒ ★★ **它花在"怎么读"上的规范，是"记什么"的 4 倍多。** 这是**行式纯文本 DSL 的税**
（JSON 免了这笔税，但也就买不到行式可读性）。
★ 且规范自己写明：**"compiled binary 里的 parser / validator 才是可执行权威"**（spec 只是互操作边界）
—— **文档不是判据**，与我们上轮撞的坑同型。

## 6. 不能抄的两条（抄了伤本体）

1. **把几何层塞进同一条记录** —— 它零坐标，这是它省 token 的来源；但**它也就画不出图，
   更不能让人在图上拖决策**。我们的 `geometry` 占 28.9%，**是病，也是能力**。
   ⇒ 正解是**分开两种视图**（人读用零坐标的 outline，画布仍吃 geometry），不是删掉 geometry。
2. **"描述性认知压缩"（不可执行）** —— 它的索引再准也**不生成语义、不改代码**。
   我们的 DSL 是 `scaffold` / `edit_code` / `consistency_check` / rename 联动的**输入**。
   ⇒ **降到"只能读" = 把命脉砍掉。**

## 7. 结论：不是"谁更优"——**而且第一条我们早就抄了，只是没人知道**

★★★ **重大更正（本文初稿写错了）**：初稿的"最小可搬动作"第一条提的是
「给 `get_dsl` 加 `query=outline`：一行一条 `path[标签]: 职责 | 依赖 | 依据 | 陷阱`，零坐标」。
**那是重复造已存在的东西。** 实测真跑：

```
══ feature "wga_syncwarm_2" 一行式认知索引（语义层派生视图·只读·不落盘）══
src/auth.ts[core]:       F:核心层 · src — 1 个 API（导入自 0 个模块） | A:login(user: string): boolean
src/service.ts[service]: F:服务层 · src — 1 个 API（导入自 1 个模块） | R:src/auth.ts | A:handle(u: string): boolean
```

**`get_dsl query=digest` 就是 AOCI 形状的 F/R/A/S 视图，而且四段都实现了**
（`src/application/meta/explore/query_feature.ts:718` 源码注释逐字写着「**AOCI 形状**的派生视图：只读、不落盘、不新增真相源」）：
`F:` ← `responsibility` · `R:` ← `expected_deps ∪ cache.db import 事实`（走 `fileFacts` **不新算**）·
`A:` ← `expected_apis` 签名 · `S:` ← 高熵字段（`expected_behavior` / `contract` / 非活跃 `lifecycle`）·
标签位 `[layer]` **等价 AOCI 的标签槽** · **段缺则省略（宁缺毋造）**。
★ 证据分级说清楚：**`F` / `R` / `A` 三格是实跑看到的**（上面那两行原文）；
**`S` 格是读源码看到的**（`query_feature.ts:762–769` 逐段构造）—— 现存 4 个 feature 都没填
`expected_behavior`/`contract`，所以跑不出 `S`。**没跑的就不说成跑过。**

⇒ **所以真正的差距不是"格式不如它"，是"我们的那份没人点名"**（三处引导都不提 `digest`，
详见 `docs/guidance-audit.md` §四）。**我上一轮甚至提议再造一个 `outline`。**

**结论**：**两个目标不同的东西** —— 它优化"**被读**"，我们优化"**被执行**"。
在"被读"这件事上它确实更优（纯文本·一行一条·固定四格·显式格式版本·字符预算·零坐标），
**但这五条里，我们已经有第 4 条（`digest` 的 F/R/A/S）**。

**真正还没做的（按价值排序，均未实现）**：
1. **让 `digest` 被看见**（已修引导：`WHEN_OVERRIDES` / README / router 三处点名）——
   ★ 这一条的教训比格式本身值钱：**少点名的代价 > 多写几个字的代价。**
2. **DSL 文件头写 `#Format-Version:`**（我们现在只有 feature 版本，格式漂了没处看）；
3. **给 `acceptance` / `goals` 加字符预算**（它按重要度分级：`C9-8≤600 C7-4≤200 C3-1≤50`）；
4. **给 `S:` 设准入判据**（它写死了 `non-inferable-and-error-preventing`；我们的 `consequences` 无门槛）；
5. **给"LLM 忘了读过"配探针**（它的 `cognition loss measured; … refresh_reasons=["context_compaction"]`）。

## 8. 没做 / 未验（诚实清单）

- ★★ **本文初稿犯了一次"重复造轮子"**：不知道本仓已有 `query=digest`，却提议造 `query=outline`（见 §7 更正）。
  根因 = 没先 grep 自己的仓就下"我们没有"的结论。**同一天连续第二次**（`guidance-audit.md` §四 是第一次）。
- **没有全量解析** `aoci.code.txt` 那 640 行（只读了前 45 行）。
- 未跑它的 **Validator**（spec 说权威在编译产物里）⇒ 所以"S 内容是否真'不可推得'"**未验**。
- 未比 **token 成本**：195,231 字节是全仓索引，我们一个 feature 是 3,254 字节 —— **量纲不同，不该直接比**。
- 工具面：权威清单 **9 个**（`internal/machinecontract/capabilities.go`）；`internal/mcptools/` 里另见
  `aoci_test` / `aoci_tool_calls` 两个名字，**是否也在 MCP 面未确认**。
