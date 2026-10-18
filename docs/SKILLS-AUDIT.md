# 17 份 Skill 通读审计

> 2026-10-18，逐份逐行读完 `~/.workbuddy/skills/*/SKILL.md`（17 份 / 274,646 字节 / 3,853 行）。
> 本文件只做三件事：**一句话讲什么**、**与本项目的关系**、**过期章节 + 重叠**。
> 不删任何 skill —— 删不删由用户定。

**关系分档**：`直接相关` = 操作对象就是 design-canvas 仓；`通用方法论` = 可搬到本仓、案例多来自本仓/dsh-brain；`与本项目无关` = DSH 宿主侧（preset / profile / 计费面）。

---

## 总览

| # | skill | 体量 | 关系 | 一句话 |
|---|---|---|---|---|
| 1 | dc-add-tool | 10.5K / 186 行 | 直接相关 | 加一个 MCP 工具要同步 7 处登记面，且 AGENTS.md 是生成物 |
| 2 | dc-remove-tool | 8.3K / 132 行 | 直接相关 | 删工具先证"谁真的 import"，再清 12 处只留错话术的引用面 |
| 3 | dc-drive-chain | 7.4K / 96 行 | 直接相关 | 多工具链写成数据，入参直接写 `touched.<键>` |
| 4 | dc-index-triage | 11.3K / 165 行 | 直接相关 | 索引慢/漏先按六类排序证伪，别先怀疑算法 |
| 5 | dc-face-bench | 5.6K / 79 行 | 直接相关 | 用全新上下文子代理盲测"少列工具"是否降低选错率 |
| 6 | dc-open-parallel-line | 6.3K / 107 行 | 直接相关 | 开并行线用 worktree 不用 fork，且禁止 `mcp:install` |
| 7 | dsh-agent-preset-authoring | 7.3K / 151 行 | 与本项目无关 | 改 DSH preset：文件位置、两个平面、"否定+禁止" |
| 8 | dsh-delegate-loop | 23.0K / 230 行 | 通用方法论 | 派活给 DSH/子代理的传输、停工识别与核验闭环 |
| 9 | dsh-profile-integrity | 15.9K / 282 行 | 与本项目无关 | DSH 插件树体检：重复 id / BOM / 悬空 patch |
| 10 | gate-authoring | 56.0K / 682 行 | 通用方法论 | 写"不会撒谎"的门：真证据、消融自证、输入防腐 |
| 11 | git-repo-hygiene | 10.7K / 232 行 | 通用方法论 | 多份 git 副本留哪份、假 remote / 假分叉 / 推送卡死 |
| 12 | guard-blindspot-diagnosis | 62.1K / 848 行 | 通用方法论 | 闸门静默放行后用 mtime 复现，再换正向证据 |
| 13 | internalize-external-agents | 6.0K / 99 行 | 通用方法论 | 外部 agent 只取料不倒库：删知识、留纪律、补契约 |
| 14 | oss-prior-art-first | 9.5K / 120 行 | 通用方法论 | 自造前查先例，先判"共享的是哪一层"，过许可证闸 |
| 15 | prompt-cache-reuse-diagnosis | 11.8K / 138 行 | 与本项目无关 | 用 cacheReadTokens + LCP 断点定位缓存为谁失效 |
| 16 | remove-silent-fallbacks | 9.5K / 157 行 | 通用方法论 | 按三分类删兜底：换题类要抛或 skip，别拿错输入继续跑 |
| 17 | verify-delegated-work | 13.5K / 149 行 | 通用方法论 | 把"完成"当待验假设：独立重算、回归差集、证可达 |

---

## 1. dc-add-tool

**一句话**：把"加一个 MCP 工具"拆成四件事 —— def 写在哪、7 处登记面怎么同步、`wrap`/`wrapData` 怎么选、以及四条验收怎么真跑。核心不是清单，是**"AGENTS.md 是生成物，计数要派生"**。

**与 design-canvas 的关系**：直接相关（本仓的加工具手册）。

**★ 过期章节**
- **frontmatter 与正文漂移**：`description` 仍写 "there are EIGHT registration sites" 并列出 G1/G8 快照、README count gates；正文 §一 已改口"**7 处**（2026-10-05 重核）"，并明说 8 处里有 4 处随测试框架移除。⇒ 读正文，别读摘录。
- **§四「测试」整节自声明历史**："2026-10-05 起测试框架已整体移除，本节保留作【历史】参考"，且开头就写"现在跑不了"。
- **§五末两段自声明失效**：`npm run arch` / `npm run test:main` / `tests/helpers/gate_probe.ts` / `239 文件 / 2466 项` —— 全部已不存在。
- **§二一半是"纠正旧版"**：旧版"PATH 是坏的、要 export 一长串"已过时（2026-10-02 实测正常）。
- **§三 `LANE_OF` 已删除**（P1c），`lane_sources.test.ts` 也已不存在。

**★ 与其他份的重叠**
- **§五「四条验收」↔ `dc-remove-tool` §四「验收（四条）」**：四条命令逐字相同（tsc / build / structure:gap / 真调），连"只有主控能跑 build"的括号都在两处各写一遍。
- **§一「登记面」↔ `dc-remove-tool` §三「会静默失效的引用面」**：同一张表的加/删两个方向；但条目数不一致（这里 7，那边正文 12 行）。
- **§四「mkdtemp 删除次数别超 50」↔ `dc-remove-tool` §二.3**：同一条宿主管家护栏，两处各记一次。
- **§四/§五「真调 CLI」↔ `dc-drive-chain` §三**：CLI 两种入参形式在那边讲得更全，这里只给一条示例。

---

## 2. dc-remove-tool

**一句话**：删工具的核心不是删文件，而是**先证明"谁真的 import 它"**（按名字 grep 会骗你），然后叶子先删，再逐个清 12 处"漏了不报错、只留着错东西"的引用面。

**与 design-canvas 的关系**：直接相关（本仓的删工具手册，与 dc-add-tool 镜像）。

**★ 过期章节**
- **frontmatter 与正文漂移**：`description_zh` 写"**7 处**会静默失效的登记面"，`description` 写"**7** silently-stale sites"；正文 §三 表实际有 **12 行**（1–12），且 §一 开头仍说"加工具是补 **8** 处"。三处数字互不一致 ⇒ 这是**清单类文档的典型腐烂**，不是历史演进。
- **无自声明历史节**：§五"README 计数的正确核对法（没有门了）"已经是**修正后**的写法（`readme_tools_gate.mjs` 已删），不算过期。

**★ 与其他份的重叠**
- **§三 ↔ `dc-add-tool` §一**：同一组登记面，一加一删；`capability_map` / `register_capabilities` / `structure.domains.json` / `AGENTS.md+gen_agents.mjs` 四项逐条对应。
- **§四 ↔ `dc-add-tool` §五**：四条验收完全重复（见上）。
- **§六「docs/ 被 ignore ⇒ `git add -f`」↔ `git-repo-hygiene` §八 ↔ `dc-open-parallel-line` §二.1**：同一件事讲了三遍。
- **§四「Windows 必须用 `C:/tmp/...` 真路径」↔ `git-repo-hygiene` §三「`git -C` 不认 MSYS 路径」**：同一族 Windows 路径陷阱（一个讲 `path.resolve`，一个讲 `.exe` 参数）。
- **§二.3「绝不用 rm 循环」↔ `dc-add-tool` §四「删除次数别超 50」**：同一护栏，两种表述。

---

## 3. dc-drive-chain

**一句话**：链不是代码，是**数据**；下一步入参直接写 `touched.<键>` 或 `touched.<键>[i]`，整套编排里唯一的人工动作是给 `[i]` 选下标。

**与 design-canvas 的关系**：直接相关（本仓 `chain_wiring.ts` 的实测手册）。

**★ 过期章节**
- **无自声明过期节**。§四.6 的 `manage_feature` 入参扁平（T194，2026-10-12）是**最新修正**，不是历史。
- 待现场核对（我未核源码）：§一 说表达式写法与 `src/domain/chain_wiring.ts` 的 `chainExprOf()` 同一套；若该函数已改名，此节会静默失效——这正是 `dc-remove-tool` §三.11 说的"注释/描述漂移"。

**★ 与其他份的重叠**
- **§三「CLI 两种入参形式」↔ `dc-add-tool` §五.4**：同一入口，两处各写一段；这里更全（含 `--input` / stdin）。
- **§五「判定真的成了」↔ `verify-delegated-work` §1**：都要求"别只看回执，读磁盘/换独立方法"；`verify` 讲得更系统。
- **§六「不许把预测/推断写成实测」↔ `oss-prior-art-first` §4 证据分级 ↔ `verify-delegated-work` §0**：同一纪律的三处表述。
- **§四.1「import_project 没有 touched」↔ `dc-add-tool` §三「[C] 只转发、判据留在 [B]」**：同一条分层事实（infrastructure 层的工具不产 `touched`）的两个推论。

---

## 4. dc-index-triage

**一句话**：索引"慢/漏"时按**出现频率**排序证伪：Windows spawn 5 秒 → 写放大 → O(n²) → 频次 → 召回回归 → 才是算法；并用 `not_fresh` 与 `stale_resolved` 两个指标分清"落后于磁盘"与"索引自相矛盾"。

**与 design-canvas 的关系**：直接相关（本仓 cache.db / 写穿 / 召回边界的运维手册）。

**★ 过期章节**
- **§3「既有失败别自认，但必须对照证明」**：教 `git checkout <parent>` 再跑同一批测试，并引用"本仓 **2040 项**原本稳定有 **18 项**失败"。本仓 `tests/` **已不存在**、无 vitest（2026-10-05 整体移除，见 `dc-add-tool` §一）⇒ 这段在当前仓**不可执行**。
- **§坑「不存在的测试路径 ⇒ vitest 整轮静默中止」**：同样属于测试框架时代。
- **§相关资产 三条指针全断**：`docs/index-freshness-extreme.md`、`docs/index-locality-design.md` 在当前 `docs/` 下不存在（现存只有 DESIGN/GOAL/VISION/todo/board/discussion-log）。
- **§1 的探针脚本 `scripts/probe-dc-*` 不在本仓**（在 dsh-brain）；本仓 `scripts/` 无 `probe-dc-` 前缀文件。

**★ 与其他份的重叠**
- **「铁律：先证伪，再优化」↔ `guard-blindspot-diagnosis` §1「从磁盘复现，不许先编因果」**：同一姿态；`guard` 有 mtime 时间轴这一更硬的取证法。
- **「索引层唯一判据是不撒谎 / 召回边界要上报」↔ `gate-authoring` §0.1「只跑真证据」+ §3「看不到 ≠ 没有」**：同一"诚实读数"原则在索引层的落地。
- **「写工具一律接闸 / `noAutoFresh`」↔ `dc-add-tool` §三「`trustAnnotated` 只在依赖索引时标」**：同一"索引可信度"家族，一个讲写、一个讲读。
- **「跑探针前必须重建 dist」↔ `dc-add-tool` §五.2**：同一"tsc ≠ dist 已更新"的坑。

---

## 5. dc-face-bench

**一句话**：用**全新上下文的子代理**当被试、用**不含工具名**的任务语言出题、允许答 `NONE`，量化"少列工具"到底有没有降低选错率——并且明确它测不出"列多了也没事"。

**与 design-canvas 的关系**：直接相关（本仓工具面/渐进披露的验收手段）。

**★ 过期章节**
- **§六 与开头的文档指针断了两处**：`docs/tool-surface-prior-art.md` §9 —— 该文档已不存在（docs 清理后只剩 6 个 md）。
- **§五 探针路径 `out/probe-tools-insert.mjs`**：本仓 `out/` 是否仍有该文件未核（我未核）；`prompt-cache-reuse-diagnosis` §2 也引用了同一路径，属**同一份探针在两处被当成常驻资产**。

**★ 与其他份的重叠**
- **§一「被试必须独立」↔ `verify-delegated-work` §0.5「独立复核：只给判据，不给答案，不告诉结论」**：同一"独立性"原则的两种实验设计。
- **§四「NONE 是诚实够不着，不是错」↔ `gate-authoring` §3 三档的价值排序（无门 > 假绿）**：都在说"诚实的无知优于假的好看"。
- **§六「未核实清单（样本量/题是我出的/被试是子代理）」↔ `oss-prior-art-first` §4 证据分级 ↔ `verify-delegated-work` §2**：同一"证据要标级、过宽表述要收窄"的纪律。
- **§二「题面不得出现工具名」↔ `internalize-external-agents`「description 只留触发条件」**：都在防"名字替代判断"（一个防被试按名匹配，一个防模型照摘要跳过正文）。

---

## 6. dc-open-parallel-line

**一句话**：开并行线选 `git worktree` 而不是 fork（fork 会造出**第二份判据**，本仓头号病根），先提交文档（`docs/*` 被 ignore，要 `-f`）再开线，且**禁止在支线跑 `mcp:install`**（它改用户级全局配置）。

**与 design-canvas 的关系**：直接相关（本仓的分支/沙盒手册）。

**★ 过期章节**
- **§五.5 两条指针全断**：`npm run test:main` 已不存在（package.json 无此 script）；`docs/refactor-playbook.md` 也不存在（docs 清理）。"支线该有自己的验收"这条**判据仍成立**，但示例命令失效。
- **§四「支线没有 node_modules/dist/.agent-io」**：事实性描述，随仓状态变化；当前判断需现场 `ls`，不能照抄。

**★ 与其他份的重叠**
- **§一「worktree vs fork」↔ `git-repo-hygiene` §一「副本能否自证新鲜度」**：两个 skill 互为对照（一个故意开线、一个治已经出现的重复副本），文中已互引。
- **§二.1「docs 被 ignore 要 `-f`」↔ `dc-remove-tool` §六 ↔ `git-repo-hygiene` §八**：同一件事第三遍。
- **§三「`mcp:install` 写 `~/.claude.json` 等用户级配置」↔ `dsh-delegate-loop` §6.2「隔离 `DSH_HOME`，不许写 `~/.dsh`」**：同一"全局状态被并行线污染"的陷阱，一个在 MCP 注册、一个在 DSH 主目录。
- **§五.3「写死退出判据」↔ `oss-prior-art-first` §2「先判层再决定造不造」**：都在要求"先定边界再动手"，避免无限期支线。

---

## 7. dsh-agent-preset-authoring

**一句话**：改 DSH agent preset 的三件事——文件该放用户根而不是 `node_modules`、provider 注册（host）与工具行（agent）分属两个平面、以及**"否定 + 禁止"比"说明 + 让模型判断"更能拦住犯错**（0 次 vs 1–2 次被拒的实测）。

**与 design-canvas 的关系**：与本项目无关（DSH 宿主配置）；但 §四的 prompt 经验属通用方法论。

**★ 过期章节**
- **无自声明过期节**。§五「Code Mode 下 `tools` 只有 `run_code`」与 `dsh-profile-integrity` 一致，属宿主事实；但**没有时间戳**，宿主升级后需重验。
- §六「验证清单」依赖 `scripts/check-preset.mjs` / `probe-verify-council.mjs` —— 都在 dsh-brain，不在本仓。

**★ 与其他份的重叠**
- **§三「两个平面」↔ `dsh-profile-integrity`「两个平面：host plane vs preset plane」**：**同一分工讲了两遍**，表格几乎同构（provider 注册在 host / 工具行在 preset）。谁是权威？两处都没有指向对方，属"同一知识两份副本"。
- **§五 Code Mode ↔ `dsh-profile-integrity`「边界②」↔ `prompt-cache-reuse-diagnosis` §4b.5**：三处都讲"`tools: [run_code]` 不等于工具被裁，工具知识在 system 里"。
- **§六「验证清单」↔ `dsh-profile-integrity`「自检清单」**：`check-preset` 与 `check:profile` 两个入口，覆盖面不同（preset 层 vs host 层），但都叫"体检"，容易互相冒充。
- **§七「provider 名对不上 ⇒ 静默不挂」↔ `gate-authoring` §3「依赖不存在的 API ⇒ 判据恒空过」**：同一"静默失败"形状（配了、看起来对、永远不生效）。

---

## 8. dsh-delegate-loop

**一句话**：派活给 DSH 会话/子代理的完整闭环：任务书怎么写（路径必须与沙箱一致、判据必须可证伪）、RPC 怎么发（`session.prompt` 的形状、基准 seq 要在发指令**前**读）、四类停工怎么识别（等待指令 / 提权挂死 / 零工具 / vitest EPERM）、回来怎么读 diff **和它的理由**。

**与 design-canvas 的关系**：通用方法论，但**脚本与判层门全是 dsh-brain 的**，在本仓不可直接执行。

**★ 过期章节**
- **§2/§4 的脚本全在 dsh-brain**：`scripts/delegation/dsh-delegate.mjs`、`session-create.mjs`、`session-drive.mjs`、`last-say.mjs`、`steer.mjs`、`audit-delegates.mjs` —— 本仓 `scripts/` 无 `delegation/` 目录。
- **§3「vitest spawn EPERM」与 §8.2「全量测试只由一个人跑」**：本仓测试框架已整体移除（无 `tests/`、无 vitest），这两条在当前仓**无对应物**。
- **§7「判层 / 挂票 / approve / 批次指纹」**：整套是 dsh-brain switchboard 的门，本仓没有 `change-classify.mjs` / 封条机制。

**★ 与其他份的重叠**
- **§5.6「取代型改造查回归差集」+ §5.7「证据只在夹具形状上成立」↔ `verify-delegated-work` §1.4 / §1.5**：**两节几乎逐字重复**（同样的 `dist/` 免费旧基线、同样的 Maven 布局反例）。这是本组 17 份里**最明显的一处双份**。
- **§8.4「执行者会纠正判据」+ §8.5「读 diff + 理由」↔ `verify-delegated-work` §0.5 / §1.7**：同一"独立复核 + 不看总结看理由"的纪律。
- **§6.6「`git commit -F` 绝不用 `-m`」↔ `dc-open-parallel-line` §二**：同一反引号被 shell 命令替换吃掉的坑。
- **§3「提权 ⇒ `approval/asked` 挂死」↔ §6.1「绝不提权」**：同一条硬边界，前面讲现象、后面讲禁令。

---

## 9. dsh-profile-integrity

**一句话**：DSH profile 插件树的体检与修复：重复 loader id（单一来源原则）、UTF-8 BOM 让 `JSON.parse` 在启动首字节炸、无效 bundle、悬空 patch、插件真删要删目录；以及**"`--dump-config` 绿 ≠ 能启动"**。

**与 design-canvas 的关系**：与本项目无关（DSH 宿主装配）。

**★ 过期章节**
- **§6 自声明降级**：「2026-09-15 更新：根因已加固，本节降级为『历史事故 + 推荐做法』」；同节还有「该盲区已于 2026-09-15 修复」整段历史。
- **§核心杠杆里的基线数字自声明过时**："579 行 / `pet` 0 条 …（更早的 571 / 576 行都已过时）"。
- **「环境坑」第一行与 `dc-add-tool` §二 直接矛盾**："Bash 工具 PATH 损坏（`dirname: command not found`）" vs 本仓"PATH 现在正常（2026-10-02 实测 `npx`/`tail`/`sed` 都可用）"。⇒ 至少一份对该机器状态的描述已过期，**照抄任何一份都可能白折腾**。

**★ 与其他份的重叠**
- **「两个平面」↔ `dsh-agent-preset-authoring` §三**：同一 host/preset 分工的第二份副本（见上）。
- **「一句话判据：读 `request/header`」↔ `prompt-cache-reuse-diagnosis` §1「数据源：`request/header` 是权威」**：同一权威口径。
- **「换代报 success ≠ 新代可用」↔ `guard-blindspot-diagnosis` 核心案例（637ms 读太早）**：同一事故；这里给结论，`guard` 给完整时间轴与修法。
- **「`--dump-config` 不校验插件 config ⇒ 绿是假的」↔ `gate-authoring` §3「假绿」**：这是"门只组装不实例化"的教科书级假绿，两处可互证。
- **§3 BOM 与 `git-repo-hygiene` §五 的 BOM 规则方向相反**（json/源码必须无 BOM；`.ps1` 必须带 BOM）——不是矛盾，是**消费方不同要相反处理**，但两份各写一半，读者容易只记住一半。

---

## 10. gate-authoring

**一句话**：写"不会撒谎"的门：只跑真证据、未实施级显式 `unenforced`、两方向 + 消融自证、假信号三档、门自己的输入（豁免/基线）会不会腐烂、状态群账、以及"**编译器/框架能查就别写门**"。

**与 design-canvas 的关系**：通用方法论（案例几乎全来自本仓与 dsh-brain）。

**★ 过期章节**
- **§2/§3 的例子依赖已删基础设施**：`tests/server_registry.consistency.test.ts`、`tests/health/health-validity.test.ts`、`.dependency-cruiser-known-violations.json`、`scripts/capability_scan.mjs`、vitest —— 本仓已无 `tests/`、无 dependency-cruiser（2026-10-05 移除）。
- **§5e 推荐 `dependency-cruiser` / `knip` 作为"现成工具"**：作为方法论成立，但与本仓"测试框架与全部门整体移除"的裁定相反 ⇒ 不能拿这节当"本仓该装什么"的依据。
- **§6 验收清单「跑完全套既有门禁」**：当前仓无对象（`npm run verify` 是另一套，不等于当年的门禁矩阵）。
- **§5b 的"搬迁炸 3 处"案例**里 `rename_symbol.ts` 已拆成目录、`tests/` 已不存在 ⇒ 症状仍可复用，具体路径失效。

**★ 与其他份的重叠**
- **§3「假信号三档」↔ `guard-blindspot-diagnosis` §1d（双向失真）/ §7b（永不变红）/ §7d（空转）**：同一族。`gate` 给分类学，`guard` 给实测案例；**两处都自称是"三档"的权威**，读者要自己合。
- **§2「消融自证」↔ `guard` §6「prove the test would have failed before」↔ `internalize-external-agents`「门·消融自证」**：同一手法写了三遍（撤掉修复 ⇒ 必须变红）。
- **§5g「编译器能查就别写门」↔ `remove-silent-fallbacks` §2⑤「把编译器当量具」**：同一判据的两个用法（一个决定"要不要写门"，一个决定"漏改清单怎么列"）。
- **§5f「variation test」↔ `remove-silent-fallbacks` §1「三分类」**：同一"数据归哪个根"问题的判据化；`gate` 明确说这套判据能抓到 `cacheDir()` 偷用 `cwd` 的 bug。
- **§5b「门自己的输入腐烂」↔ `guard` pitfalls「别让门硬编码输入路径」**：同一"门读空气"的两种形态（名单腐烂 / 路径搬走）。
- **§5c「状态群 / 手抄副本」↔ `internalize-external-agents`「双份真相」↔ `dc-open-parallel-line` §一「判据分叉」**：同一病根三个名字。
- **§0.1「不读源码」↔ `verify-delegated-work` §6「数的可能是判据的影子」**：同一"文本不是行为"的纪律。

---

## 11. git-repo-hygiene

**一句话**：多份 git 副本怎么判留哪份（能否**自证新鲜度** = 有没有 remote + 两条空命令）、以及假 remote / 假分叉 / 推送卡死三类"git 自己说成功了"的误判怎么拆。

**与 design-canvas 的关系**：通用方法论（工作区治理）。

**★ 过期章节**
- **无自声明过期节**。§二 的 PortableGit 2.55.0 "rc=0 但 ref 不落盘"是**时点版本 bug**（2026-09-14），可能已修，需重测；文中给的规避（显式用系统 git）仍安全。
- §五 PowerShell 5.1 的 BOM 规则是环境事实，不随仓变。

**★ 与其他份的重叠**
- **§一 ↔ `dc-open-parallel-line` §一**：fork vs worktree 的判据分叉，一份讲"别造第二份"，一份讲"造了怎么治"。
- **§三「`git -C` 不认 MSYS 路径」↔ `dc-remove-tool` §四「`/c/tmp` 交给 `path.resolve` 变 `C:\c\tmp`」**：同一 Windows 路径族。
- **§八「`git add -f` 被 ignore 的文档」↔ `dc-remove-tool` §六 ↔ `dc-open-parallel-line` §二.1**：三份重复。
- **§六「『已分叉』是高危结论」↔ `verify-delegated-work` §2「过宽表述改成可用的数字」**：一个讲 fetch 前别下结论，一个讲结论要给分布；同属"未观测 ≠ 事实"。

---

## 12. guard-blindspot-diagnosis

**一句话**：自愈闸门"报了 OK 但被守护的东西是坏的"之后，用**磁盘证据的 mtime 时间轴**复现案发现场，先分清"判据错"还是"读太早"，再用**有界等待 + 正向就绪信号 + 三态**替换一次性否定判据；另覆盖更坏的变体——**量具自身坏了，同时假绿 + 假红**。

**与 design-canvas 的关系**：通用方法论（参考案例大量来自本仓 `code_health` / 解析器 / 注册表拆分）。

**★ 过期章节**
- **参考案例 3/4/5/6 的"验收数字"全部不可复现**：`205 文件 / 2137 项`、`208 / 2193`、`210 / 2210`、`210 / 2211` —— 本仓已无 `tests/`、无 vitest。
- **路径失效**：`tests/fixtures/codehealth-fixture`、`tests/health/health-validity.test.ts`、`tests/fixtures/codehealth-esm-fixture` 均不存在。
- **§1d 的 `code_health` 工具是否仍在本仓未核**（我未核）；若已下线，整个案例只剩方法论价值。
- **§1d 的"修好后 12 条违规"清单**（`archify_pipeline` / `daemon` / `dsl/types`）是 2026-09-28 时点快照，代码已多次搬迁。

**★ 与其他份的重叠**
- **§1d / §1b ↔ `gate-authoring` §3**：假绿、恒 0、空过——`guard` 是 `gate` 分类学的实证展开，两处都在讲"0 不是通过"。
- **§6「出生证」↔ `gate-authoring` §2「消融自证」↔ `internalize-external-agents`「门·消融自证」**：同一手法。
- **§1c「看不到 ≠ 观察到没有」↔ `gate-authoring` §3「通道自身不可用要单列」**：同一"可观测性"纪律。
- **§7「真 artifact 集成」↔ `verify-delegated-work` §1.5「证据是否只在夹具形状成立」**：同一"夹具不等于生产"。
- **§1e-bis「按意图写测试，不按旧输出录基线」↔ `remove-silent-fallbacks` §2⑥「测试失败是证据，不是改断言迁就实现」**：同一"别把 bug 固化成契约"。
- **§1g「静默降级不该存在」↔ `remove-silent-fallbacks` 全篇**：一个从护栏视角、一个从兜底视角，讲同一件事。

---

## 13. internalize-external-agents

**一句话**：外部 agent 市场只能"取料"不能"倒入"：删掉它知道的知识、保留并强化它做事的纪律、补四块契约、带 provenance，且**"合并成几个"必须是读数而不是设计目标**。

**与 design-canvas 的关系**：通用方法论（席位库建设）；本仓目前没有 `seats/`。

**★ 过期章节**
- **无自声明过期节**。§门的检查项（frontmatter、description 长度、provenance、消融自证）是纪律，不随时点失效。
- 待核：文中"我们实测 12,000 → 1,600 字符"是时点数据；`seats/schema.json` 等目录约定在本仓不存在。

**★ 与其他份的重叠**
- **「门 + 消融自证」↔ `gate-authoring` §2 ↔ `guard` §6**：同一"门必须能变红"的验收。
- **「双份真相」↔ `gate-authoring` §5c「手抄副本必腐」↔ `dc-open-parallel-line` §一「判据分叉」**：同一病根。
- **「description 只留触发条件」↔ `prompt-cache-reuse-diagnosis` §4b「脸就是整个请求」↔ `dc-face-bench` §二「题面不得含工具名」**：同一"脸的每一字都付费且会替代判断"的经济学。
- **「N 必须是读数」↔ `oss-prior-art-first` §2「造格子还是造房子」**：都要求先量再决策。

---

## 14. oss-prior-art-first

**一句话**：自造之前先在三处查先例（本地 clone → GitHub → arXiv），**先判"我们和它共享哪一层"**、再过许可证闸门，用 L1–L5 判据决定采用 / 借协议 / 组合 / 自造。

**与 design-canvas 的关系**：通用方法论（立项前的前置）。

**★ 过期章节**
- **无自声明过期节**。§0 的具体项目（VeRO、harness-opt）与 "2026 + 领域名" 的检索式是时点线索，可能已变；L1–L5 判据稳定。
- §3.5 的许可证案例（Serena 的 `src/solidlsp/` 是 MIT）是具体仓库的时点事实，需重核。

**★ 与其他份的重叠**
- **§4「证据分级」↔ `verify-delegated-work` §2 ↔ `dc-face-bench` §六**：同一"直接读过 / 二手 / 推断"的三级，三处各写一遍。
- **§5「落成文档 + 未核实清单」↔ `dc-face-bench` §六 ↔ `internalize-external-agents` §收尾**：同一收尾格式。
- **§3.5「核实 LICENSE」↔ `internalize-external-agents`「核实 LICENSE / provenance」**：同一前置，一处讲代码复用、一处讲 agent 取料。
- **§3.6「反向证据：你刚修的 bug 它会不会有」↔ `verify-delegated-work` §5「缺陷指控先证可达」**：都在问"结构上可不可能"，避免修不存在的缺陷。

---

## 15. prompt-cache-reuse-diagnosis

**一句话**：缓存没命中时不看 fork/spawn，而是看**子代首个请求的 `[system + tools]` 是不是父代最近请求的逐字前缀**；用 `cacheReadTokens` 量命中率、用 LCP 断点归因到 `persona`/`system`/工具清单，并给出"增量放哪最便宜"的定价表。

**与 design-canvas 的关系**：与本项目无关（DSH 宿主计费面）；但"脸 = 整个请求"的结论解释了为什么工具描述要短。

**★ 过期章节**
- **§3 的基线是时点读数**：2026-09-21 / 181 会话 / 15 对父子；98.6%–99.6% 等数字**必须重测**。
- **§4b 的规模数字是时点测量**：脸 ≈ 40.5K tok、`system` 2.4K、工具块 ~38K、`ToolArgsMap` 27350 chars、2.87 chars/token —— 工具集一变全部失效。
- **§5.1 的 `agnes` 本地网关**：当时环境，现是否可用未核。
- **§2 的仪器路径**：`scripts/measure-delegation-reuse.mjs` 在 dsh-brain，`out/probe-tools-insert.mjs` 与本仓 `out/` 状态未核。

**★ 与其他份的重叠**
- **§1「`request/header` 是权威」↔ `dsh-profile-integrity`「一句话判据」**：同一口径。
- **§4b.5 Code Mode 的 SDK section ↔ `dsh-profile-integrity`「边界②」↔ `dsh-agent-preset-authoring` §五**：同一宿主事实三处重复。
- **§4b「脸就是整个请求」↔ `internalize-external-agents`「删知识 / description ≤500」**：同一经济学（token 账单 vs 上下文噪音）。
- **§5.3「共线时交叉表只能生成假设」↔ `verify-delegated-work` §2「方向 vs 量级」**：同一"别把相关当因果"。

---

## 16. remove-silent-fallbacks

**一句话**：把"拿着错的输入继续跑"的兜底按**三分类**拆开（合法默认值 / 两来源一语义 / 换题），换题类当场抛或 skip，用编译器补漏改的 import，用测试失败找出"谁在依赖兜底"。

**与 design-canvas 的关系**：通用方法论，且**直接适用于本仓**（`?? process.cwd()` / `?? 默认根` 家族）。

**★ 过期章节**
- **§6 的"行为快照门（golden/snapshot）按 `UPDATE_XXX=1` 更新基线"**：本仓 G8 行为快照与 vitest 已整体移除（`dc-add-tool` §一）⇒ 当前仓无对象。
- **§5「删完要同步 `gate-authoring` 的登记表与棘轮」**：`gate-authoring` §5c/§5e 已改口"能删表就删表、别再加门" ⇒ **两份 skill 的口径已不一致**（一个让你同步棘轮，一个让你别养棘轮）。

**★ 与其他份的重叠**
- **§2⑤「编译器当量具」↔ `gate-authoring` §5g**：同一判据（11 处改动 ⇒ 编译器精确报 11 处缺 import）。
- **§1「三分类」↔ `gate-authoring` §5f「variation test」**：后者是前者的判据化（owner = 位置随哪个变量变）。
- **§2⑥「测试失败是证据」↔ `guard` §1e-bis ↔ `verify-delegated-work` §1.6**：同一"别改断言迁就实现"。
- **§5「独立核验」↔ `verify-delegated-work` §1.8「同族漏网要自己再扫一遍」**：同一"门只保护册上的东西"。

---

## 17. verify-delegated-work

**一句话**：把子代理/同事的"完成"当**待验假设**：用独立方法重算关键数字、区分方向与量级、取代型改造做**回归差集**、查证据是否只在夹具形状成立、先证缺陷指控**可达**、并分清"数的是判据还是判据的影子"。

**与 design-canvas 的关系**：通用方法论（本仓派活验收可直接用；本任务自身的"诚实清单"也用了这套）。

**★ 过期章节**
- **无自声明过期节**。§0.5 的"换模型路由"是 2026-10-05 时点经验（`model` 传错名静默回落）。
- §1.4 的"`dist/` 是免费旧基线"有前提（产物还没重建）；并行/已 build 时该前提失效，文中已写明，但容易被略读。

**★ 与其他份的重叠**
- **§1.4 / §1.5 ↔ `dsh-delegate-loop` §5.6 / §5.7**：**本组最严重的逐字重复**（回归差集 + 夹具形状）。
- **§0.5 ↔ `dsh-delegate-loop` §8.4 / §8.5**：独立复核 / 读理由，同一纪律。
- **§6「计数影子」↔ `gate-authoring` §3「文本判据没有作用域」**：同一"文件边界 ≠ 能力边界"。
- **§5「先证可达」↔ `gate-authoring` §3「依赖不存在的 API ⇒ 恒空过」**：一个查指控、一个查门，同一"路径根本走不到"。

---

## 去重结论（只列，不删）

**重复最重的三簇**：

1. **"门 / 假信号 / 消融"簇**（`gate-authoring` + `guard-blindspot-diagnosis` + 部分 `verify-delegated-work` + `internalize-external-agents` 的门节）
   - 假信号三档在 `gate` §3 与 `guard` §1d/§7b/§7d 各有一套分类；
   - "撤掉修复必须变红"在四处出现（`gate` §2、`guard` §6、`internalize` 门、`verify` §1.4 的回归差集是它的变体）。
   - **建议**：`gate-authoring` 保留"怎么写"，`guard` 保留"坏了怎么查"，把重复的"三档表"在一处定稿、另一处只链接。

2. **"DSH 宿主平面 / Code Mode"簇**（`dsh-agent-preset-authoring` §三/§五 + `dsh-profile-integrity` 两平面/边界② + `prompt-cache` §4b.5）
   - 三份都在解释 "`tools: [run_code]` 不代表工具被裁" 与 "provider 在 host、工具行在 preset"。
   - **建议**：以 `dsh-profile-integrity` 为权威（它讲装配），另两份只保留"对本主题的推论"。

3. **"dc-add / dc-remove 的登记面与四条验收"簇**
   - 同一张登记面表两个方向、同一组验收命令两处逐字。
   - **建议**：抽一份 `docs/TOOL-REGISTRATION.md` 作为唯一来源，两份 skill 各自只写"加/删时这一步的特殊性"。

**另有四处"三份讲同一件小事"**：`docs/ 被 ignore 要 git add -f`（dc-remove §六 / dc-open-parallel §二.1 / git-repo §八）、`MSYS 路径陷阱`（dc-remove §四 / git-repo §三）、`request/header 是权威`（profile-integrity / prompt-cache §1）、`证据分级 + 未核实清单`（oss §4 / face-bench §六 / verify §2）。

**★ 我没有权限判断"谁对"的地方**（已写进诚实清单）：`dc-add-tool` 的 7 处 vs `dc-remove-tool` 的 12 处 vs 两份 frontmatter 的 8/7 —— 这需要现场数一遍当前注册面才能定；`dsh-profile-integrity` 的"PATH 损坏"与 `dc-add-tool` 的"PATH 正常"也互相矛盾，只能按机器现状实测。
