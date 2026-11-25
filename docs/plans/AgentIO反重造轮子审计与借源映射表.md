# AgentIO 反重造轮子审计与借源映射表

> **登记性质**：只读研究 + 审计写作。本文件给出现状判定、借源参考与迁移/对齐决策建议，**不代裁**；落地须另立卡并经独立裁定，过把守测试与回放后冻结。
> **审计锚点**：主仓 `D:\Projects\ai\agentio\dev\agent-io`，HEAD `782d627994560c904b519ff17447c7ef6c756e92`（只读核对，未写不改）。
> **隔离纪律**：不写 main、不合并、不 push、不跑主仓脚本改动；阶段 1 收口写者、S-EXEC trackB/简报作者在途，主仓在途 dirty 文件一律不触碰。
> **统一 thesis 对齐**：企划 §15（模型无关 · 契约中介 · 证据驱动的确定性项目重写引擎；三能力映射；确定性在验收/执行/台账层而非生成层）。

---

## 1. Main 裁决口径（逐字落实为审计判据）

以下为 Main 给定口径，本审计逐条落为映射表行项与施工纪律条款：

- **索引**：adopt SCIP 符号 scheme（manager/package/version/descriptor）+ tree-sitter 解析；自研键面 = 重造 SCIP。
- **增量**：借 salsa / Skyframe / Nix / Unison。
- **调度 S-EXEC**：借 jobserver / Ninja / Skyframe，不新写。
- **沙箱**：借 Bazel sandbox / nsjail。
- **改写**：借 OpenRewrite / LibCST / ts-morph / Coccinelle / comby。
- **codegen**：借 protobuf / Smithy / TypeSpec / MPS。
- **已自研管道**：要么迁移借用品，要么语义对齐；**自定义精力只投信任/契约/证据层**。
- **设计指引**：CompCert verified-verifier（不可信变换 + 事后验证）= translation validation（alive2）/ proof-carrying code；**provenance** 借 in-toto / SLSA / Sigstore / Nix / Unison 哈希。
- **愿景参考**：Unison / MPS / Glamorous Toolkit / Smalltalk / Emacs。

---

## 2. 借源映射表（核心）

决策口径：**迁移** = 引入借用品替换自研内核；**对齐** = 保留自研表示/实现，但键面、口径、语义向借标准对齐；**自研特有** = AgentIO 信任/契约/证据层，不外包。

| # | 子系统 | AgentIO 现状（仓内证据锚点，只读） | 重造风险判定 | 借用参考（一手 URL） | 决策 | 自定义精力边界 |
|---|---|---|---|---|---|---|
| 1 | 索引 · 解析层 | 依赖已借 `tree-sitter@^0.21.1` + `tree-sitter-javascript@^0.21.4` + `tree-sitter-typescript@^0.21.2`（`package.json`）；`src/infrastructure/parse/` 底层 tree-sitter | **低**：解析内核已借，无重造 | tree-sitter 官方：https://tree-sitter.github.io/tree-sitter/ | **保持借源**；不自研语法解析器 | 多语言适配器表、导入解析口径属本仓编排层 |
| 2 | 索引 · 符号身份键面 | 自研 SQLite schema（`nodes/edges/files/identifiers/imports/unresolved_refs/symbol_diffs` 等，`src/infrastructure/index/schema.ts`）；符号 id = `<file>#<qualified_name>`，重名追加 `:L<start_line>`（`symbols.ts`）；`sym_hash/body_hash/body_text/norm_hash` 自造指纹；**无** manager/package/version/descriptor 跨仓身份；无 SCIP 依赖 | **高**：自研身份协议层重造 SCIP；跨仓符号身份缺失 | SCIP（Source Code Intelligence Protocol）：https://github.com/sourcegraph/scip ；文档站 https://sourcegraph.github.io/scip.dev/ | **语义对齐优先**：身份编码对齐 SCIP descriptor（manager/package/version/descriptor + Occurrence/Role）；本地 SQLite 存储保留为派生态；跨仓/对外消费时导出 SCIP protobuf；**不先**迁移整套 SCIP 工具链（Windows 单机、当前无跨仓消费需求） | 本仓事实分级、known/unknown 标注、fail-closed 不宣称完整，属契约认知层，不外借 |
| 3 | 增量 · 影响集 / 备忘录 | 自研差分 + 指纹继承：`analysis/facts/impact_set.ts`、`facts/test_coverage.ts`、`facts/semantic_digest.ts`、`facts/incsel_ablation.ts`、`facts/incsel_cron.ts`；`analysis/impact/diff_impact.ts`、`impact/impact_ledger_store.ts`；快照继承 `application/design/verified_snapshot.ts#planInheritance`；改动集 `scripts/lib/changed_set.mjs`。**无** red-green 查询备忘录框架，无评估图节点依赖闭包 | **中—高**：自研差分继承重造增量备忘录；失效口径未对齐成熟输入闭包/动作键 | salsa（tracked query，red-green 算法）：https://salsa-rs.github.io/salsa/overview.html ；源码 https://github.com/salsa-rs/salsa ；Skyframe（Bazel 评估图）：https://bazel.build/versions/8.0.1/reference/skyframe ；Nix（derivation 输入哈希闭包）：https://nixos.org/guides/how-nix-works/ ；Unison（内容寻址项）：https://www.unison-lang.org/docs/the-big-idea/ | **语义对齐**：增量键面/失效口径对齐 Nix derivation 输入闭包 + Bazel action key；读写依赖追踪按需对齐 salsa tracked-function 读写集；**不迁移** Rust 框架（Node/Windows 栈） | 消融对照、证据新鲜度、holes=0 trust-gated 继承为 AgentIO 特有（外部增量框架不覆盖） |
| 4 | 调度 S-EXEC · DAG / 并发 / 锁 | `scripts/verify.mjs` GATES 串行循环 + `spawnSync`；`scripts/run-tests.mjs --jobs N` 有界并发池（缺省 1 = 原串行路径）；`scripts/lib/heavy_lock.mjs` 文件 pid 锁（env 可重入、陈旧锁响亮接管；无 TTL/续约/CAS）；`src/application/scheduling/{shadow_scheduler,evidence_frame}.ts`。**无** DAG edge/ready-queue、无令牌池、无优先级/抢占模型 | **高**：串行门 + 粗粒度文件锁重造调度器；并发原语自研 | Ninja（DAG edge/ready-queue/命名 pools）：https://ninja-build.org/manual.html ；pools 节 https://ninja-build.org/manual.html#pools ；GNU make jobserver（跨进程令牌池）：https://www.gnu.org/software/make/manual/html_node/Job-Slots.html ；实现论文 https://make.mad-scientist.net/papers/jobserver-implementation/ ；Skyframe：https://bazel.build/versions/8.0.1/reference/skyframe ；K8s 优先级/抢占 https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/ ；Lease 选举 https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/ ；Go 信号量 https://pkg.go.dev/golang.org/x/sync/semaphore ；Java Semaphore https://docs.oracle.com/en/java/javase/25/docs/api//java.base/java/util/concurrent/Semaphore.html ；Tokio Semaphore https://docs.rs/tokio/latest/tokio/sync/struct.Semaphore.html ；Bazel local_resources https://bazel.build/reference/command-line-reference ；锁序全序 https://docs.oracle.com/cd/E37838_01/html/E61057/guide-35930.html ；Guava RateLimiter（远端限速独立池）https://guava.dev/releases/17.0/api/docs/com/google/common/util/concurrent/RateLimiter.html | **对齐 + 渐进迁移**：先借 Ninja edge/ready-queue + 命名池结构做轻量 DAG 执行器；并发槽位借 jobserver 令牌语义；优先级/租约对齐 K8s 模型；远端限速与本地并发分池；**不自研**分布式选举（本地单写者） | 契约充当依赖图来源（节点 = 判据/证据/任务，非编译目标）、单写者台账、trust-gated scoped 政策，属调度政策层自研 |
| 5 | 沙箱 · 执行隔离 | 每文件独立临时数据根 + worktree 隔离 + `heavy_lock` 互斥；**无** OS namespace/cgroups/seccomp 装置；无 nsjail/Bazel sandbox 依赖或脚本 | **中**：目录隔离 ≠ 强制隔离；hermeticity 纪律未形式化 | Bazel sandboxing（execroot 已知输入声明、动作内不可写工作区外）：https://bazel.build/versions/7.6.1/docs/sandboxing ；hermeticity 口径 https://bazel.build/versions/7.6.1/basics/hermeticity ；nsjail（Linux namespaces/cgroups/rlimits/seccomp-bpf）：https://github.com/google/nsjail | **语义对齐**：先立 hermeticity 纪律（声明输入/输出、工作区外工具入键、网络隔离口径、隐藏依赖检测）；nsjail/Bazel sandbox 直接迁移受 Windows 平台限制，列为 Linux/CI 远端动作可选；本机保持目录隔离 + 隔离探针 | 证据台账、写闸、回放/回滚不外包 |
| 6 | 改写 · AST 变换 / 规则 | `src/application/refactor/`（`edit/`、`rename/`、`find/`、`rule_library/`、`pipeline/`、`snapshot/`、`deprecate_offline/`）；`src/infrastructure/analysis/refactor/langs/{java,python}/`；`analysis/rename_symbol/languages/{c,cs,go,java,py,ts}.ts`。正则 + tree-sitter 轻量 AST 辅助；**无** LST/CST/编译器 API 包装依赖 | **高**：自研正则改名/移动重造 AST 变换内核；正则漏别名/解构/动态访问、误报注释与字符串（仓内注释自承） | OpenRewrite（LST visitor/recipe，Java 及多语）：https://docs.openrewrite.org/ ；LibCST（Python 无损 CST）：https://libcst.readthedocs.io/ ；ts-morph（TS/JS 编译器 API 包装）：https://ts-morph.com/ ；Coccinelle（SmPL 语义补丁，C 系）：https://coccinelle.gitlabpages.inria.fr/website/ ；comby（跨语结构洞模板）：https://comby.dev/ | **按语言迁移借用品**：TS/JS 路径借 ts-morph；Python 借 LibCST；Java 批量迁移评估 OpenRewrite；一次性结构替换借 comby；C 内核场景借 Coccinelle SmPL。自研 `rule_library` 保留为规则编排/裁决/证据附着层，**不重写**语法树编辑内核 | 规则可信度裁决、改写前后契约对账、证据附着属信任层 |
| 7 | codegen · schema / IDL / 发射器 | `schema/{design_dsl,endpoints,observe_contract}.schema.json`；zod/ajv 校验；`scripts/gen-*.mjs/cjs` 若干生成器；`authoring/translate/{ts_codegen,py_codegen}.ts`。**无** protobuf/Smithy/TypeSpec/MPS | **中**：手写 schema + 手写发射器重造 IDL→多语生成；封闭 DTO 场景现有 JSON Schema/zod 可接受 | protobuf（schema→多语生成）：https://protobuf.dev/ ；Smithy（协议无关服务模型→SDK/文档）：https://smithy.io ；TypeSpec（API-first，OpenAPI/JSON Schema/Protobuf emitter）：https://typespec.io/ ；MPS（DSL 语言工作台/投影编辑）：https://www.jetbrains.com/mps/ | **对齐 + 受限迁移**：封闭 DTO/适配器 schema 走 schema codegen，模型层对齐 TypeSpec/Smithy 结构；内部 `design_dsl` 暂不迁 MPS；发射器只在自有契约层定制，**不自研**新语言工作台 | 外化器忠实性判据、契约前后条件、验证环属自研 |
| 8 | provenance · 来源 / 哈希 / 签名 | `src/application/ingestion/provenance.ts`：`source_kind/source_ref/captured_at/source_fingerprint`、`ModelSeat{seat,version,input_fingerprint}`、`Adjudication{ruling_at,ruling_by,ruling_ref}`、`raw`；一期 `rawSha256` + `rowFingerprint` sha16（明确不防恶意碰撞）；行级完整哈希对账列后续批次。**无** in-toto layout/link、无 SLSA 谓词分级、无 Sigstore keyless 签名/透明日志、无 Nix store 哈希闭包/Unison SHA3 内容寻址 | **中**：字段形状自研，未对齐供给链元数据标准；哈希口径弱于内容寻址 | in-toto（layout/link 元数据 + 签名步骤链）：https://in-toto.io/ ；入门 https://in-toto.io/docs/getting-started/ ；SLSA（provenance 谓词/级别）：https://slsa.dev/spec/v1.1-rc1/levels ；Sigstore（keyless，Fulcio/Rekor）：https://docs.sigstore.dev/ ；Nix 哈希闭包：https://nixos.org/guides/how-nix-works/ ；Unison SHA3 内容寻址：https://www.unison-lang.org/docs/the-big-idea/ | **语义对齐**：provenance 字段映射 in-toto attestation statement/predicate 结构；行级哈希对齐 Nix/Unison 内容寻址口径；签名/透明日志按需对接 Sigstore；本地单机阶段不建公网日志 | 裁决回执语义（Main/人/主控 adjudication）、证据四态分级、fail-closed 不宣称完整，属 AgentIO 信任层特有，不外包 |
| 9 | 设计指引 · 验证器（横切，非管道部件） | 验证环 = 契约测试 + 突变 + 回放；生成器（含 LLM/代码生成）不可信，事后验证 | —（方法论参照，非依赖） | CompCert（机器检查语义保持证明的验证编译器）：https://compcert.org/ ；translation validation · alive2（不可信变换 + 事后 refinement check）：https://github.com/AliveToolkit/alive2 ；在线版 https://alive2.llvm.org/ ；Proof-Carrying Code（Necula, POPL '97）：https://dl.acm.org/doi/abs/10.1145/263699.263712 ；PDF https://courses.engr.illinois.edu/cs421/fa2010/papers/necula-pcc.pdf | **采纳为指引**：不可信变换 + 事后验证；证据随产物携带，独立验证器快速核对；确定性落在验收/执行/台账层 | 验证环判据、证据分级、裁决闸为本仓自研 |
| 10 | 愿景参考（环境参照，非依赖迁移目标） | 程序开发操作系统愿景；环境/交互哲学参照 | — | Unison：https://www.unison-lang.org/ ；MPS：https://www.jetbrains.com/mps/ ；Glamorous Toolkit：https://gtoolkit.com/ ；手册 https://book.gtoolkit.com/ ；Smalltalk：**无源统一官方站点**（ESUG 历史档案 https://archive.esug.org/ ）；GNU Emacs：https://www.gnu.org/software/emacs/ | **参照不引入**：取其环境/反射/可定制哲学，不引入其运行时 | — |

---

## 3. 逐子系统重造风险审计

### 3.1 索引

**现状**
- 解析层已借 tree-sitter（deps 含 JS/TS grammar）；自研部分集中在事实抽取与身份键面。
- `src/infrastructure/index/`：`db.ts`、`schema.ts`、`symbols.ts`、`file_facts.ts`、`function_outline.ts`、`semantic_facts.ts`、`index_backfill.ts`、`index_freshness.ts`、`scan_rev.ts`、`registry.ts`、`watch_project.ts` 等。
- 符号身份：文件节点 = 相对根 posix 路径；符号节点 = `<file>#<qualified_name>`，重名追加 `:L<start_line>`；指纹列 `sym_hash/body_hash/body_text/norm_hash`。
- 无 manager/package/version/descriptor 形式的跨仓符号身份；外部符号与跨仓引用解析是已知盲区（`symbols.ts` 导入解析适配器表注释病史记录）。

**风险判定**：身份协议层**高**风险重造（自研键面对应 SCIP 已解决的语言无关符号身份问题）；解析层低风险（已借）。

**误报排除（词面命中 ≠ 已借源）**：仓内 `SCIP` 17 处命中全部为 `discipline` 的子串（di**scip**line），非 SCIP 协议引用；依赖清单无 SCIP 包。

**决策**：语义对齐 SCIP descriptor 模型；本地存储保留派生态；对外导出层再迁 SCIP protobuf。不先整体迁移工具链。

### 3.2 增量

**现状**
- 影响集/覆盖选择：`analysis/facts/impact_set.ts`、`facts/test_coverage.ts`、`facts/semantic_digest.ts`、`facts/incsel_ablation.ts`、`facts/incsel_cron.ts`；`analysis/impact/diff_impact.ts`、`impact/impact_ledger_store.ts`。
- 快照继承：`application/design/verified_snapshot.ts#planInheritance`；改动集：`scripts/lib/changed_set.mjs`。
- 机制形态：DB 差分 + 指纹继承；没有 tracked query 备忘录（读写集记录 + 红-green 失效），也没有评估图节点级依赖闭包。

**风险判定**：中—高。自研差分继承在单机小仓可用，但失效口径未对齐成熟输入闭包/动作键；随规模上升会重复造 salsa/Skyframe 已解决的依赖追踪与增量复用问题。

**决策**：对齐 Nix derivation 输入闭包 + Bazel action key 口径；读写依赖追踪按需对齐 salsa tracked-function 模型；不引入 Rust 框架。AgentIO 特有的消融对照、证据新鲜度、holes=0 trust-gated 继承不属外部增量框架覆盖范围，保留自研。

### 3.3 调度 S-EXEC

**现状**
- `verify.mjs`：GATES 门清单串行循环，`spawnSync` 逐门执行；`run-tests.mjs`：`--jobs N` 有界池，缺省 1 保持串行；`heavy_lock.mjs`：文件 pid 二元锁，env 传祖先可重入，陈旧锁响亮显形；无 TTL/续约/CAS。
- `application/scheduling/`：`shadow_scheduler.ts`、`evidence_frame.ts`。
- 缺口：无 DAG edge/ready-queue；无命名资源池/令牌池；无优先级、抢占、租约模型；远端 API 限速与本地并发未分池（trackB-EXEC S17/S18/S19 已核）。

**风险判定**：高。串行门 + 粗粒度锁是调度器内核的自研重造；并发原语（信号量/池/锁序/限速）在成熟系统中已有定型实现。

**决策**：渐进迁移——Ninja edge/ready-queue + 命名池做轻量 DAG 执行器；jobserver 令牌语义管在途并发；K8s PriorityClass/Lease 模型参照优先级与租约；远端限速独立池；不造分布式选举（本地单写者）。契约充当依赖图来源、单写者台账、trust-gated scoped 政策保留自研。

### 3.4 沙箱

**现状**：隔离 = 每文件独立临时数据根 + worktree 隔离 + 互斥锁；无 namespace/cgroups/seccomp 装置；无 nsjail/Bazel sandbox 依赖。

**风险判定**：中。目录隔离能防同仓互写，但不是强制 OS 隔离；hermeticity（声明输入/输出、隐藏依赖检测）尚未形式化。

**决策**：先对齐 Bazel hermeticity 纪律与 execroot 输入声明口径；nsjail/Bazel sandbox 作为 Linux/CI 远端动作可选，本机 Windows 不强行迁移。隔离探针与证据台账自研保留。

### 3.5 改写

**现状**
- 应用层 `application/refactor/`：`edit/apply_writes.ts`、`edit/edit_code.ts`、`edit/remove_dead_imports.ts`；`rename/rename_local.ts`、`rename_symbols.ts`、`symbol_move.ts`、`move_domain.ts`、`rename_file(s).ts`；`find/find_references.ts`、`field_refs.ts`、`ast_suggest.ts`；`rule_library/rule_apply·extract·library.ts`；`pipeline/`；`snapshot/file_snapshot.ts`；`deprecate_offline/`。
- 分析层 `analysis/refactor/langs/{java,python}/`；`analysis/rename_symbol/languages/{c,cs,go,java,py,ts}.ts`。
- 机制：正则 + tree-sitter 轻量 AST 辅助；仓内注释已记录正则在别名、解构、动态访问、注释/字符串误报上的盲区。

**风险判定**：高。语法树编辑内核自研重造 LST/CST/编译器 API 包装；规则编排与裁决层才是本仓该投精力处。

**决策**：按语言迁移借用品（ts-morph / LibCST / OpenRewrite 评估 / comby / Coccinelle）；自研规则库退居编排、裁决、证据附着层。

**误报排除**：`TypeSpec` 2 处命中为局部函数 `unitFromTypeSpec`（`go_extractor.ts`），非 TypeSpec 语言采用。

### 3.6 codegen

**现状**：三个 JSON Schema（`design_dsl/endpoints/observe_contract`）；zod/ajv 校验；`scripts/gen-*.mjs/cjs` 生成器；`translate/ts_codegen.ts`、`py_codegen.ts`；无 IDL 语言与多语发射器框架。

**风险判定**：中。封闭 DTO/适配器场景手写 schema + 发射器可接受；若向服务模型/多语言 SDK 扩展，会重造 Smithy/TypeSpec/protobuf 已解决的模型→多语生成问题。

**决策**：模型层对齐 TypeSpec/Smithy 结构；内部 `design_dsl` 暂不迁 MPS；不自研语言工作台；外化器忠实性判据与验证环自研。

**误报排除**：`protobuf` 5 处命中为语言 roster 条目与语法名（`.proto` 扩展名、`tree-sitter-protobuf` 派生名核实记录），非 protobuf 依赖。

### 3.7 provenance

**现状**：`provenance.ts` 立字段边界——来源类别闭集、来源引用、捕获时刻、来源指纹、模型席位/版本/输入指纹、裁决回执（时刻/裁决者/口径引用）、原始逐字片段；一期 `rawSha256` + `rowFingerprint`（sha16，防意外漂移不防恶意碰撞）；行级完整哈希对账列独立后续批次。

**风险判定**：中。字段语义贴近 in-toto/SLSA 概念，但未映射为标准元数据结构；哈希口径弱于内容寻址；无签名/透明日志装置。

**决策**：对齐 in-toto statement/predicate 结构；行级哈希对齐 Nix/Unison 内容寻址口径；签名与透明日志按需对接 Sigstore；单机阶段不建公网日志。裁决回执语义、证据四态分级、fail-closed 不宣称完整保留自研。

---

## 4. 设计指引：CompCert / translation validation / PCC

### 4.1 三种验证范式

- **CompCert（验证编译器）**：编译器本身经机器检查的语义保持证明，生成代码行为被证明符合源语义。代价是证明构造重，适用高保证内核场景。https://compcert.org/
- **translation validation（事后验证，alive2 代表）**：不要求变换内核被证明；在每一对 src/tgt 上事后做 refinement check。结论三态：正确 / 不正确（带反例）/ 超时；bounded 验证有漏检边界，不宣称覆盖所有未测行为。https://github.com/AliveToolkit/alive2 ；https://alive2.llvm.org/
- **Proof-Carrying Code（PCC）**：代码生产者随产物附带满足安全策略的证明；消费方用简单快速的验证器核对证明，不依赖密码学身份或外部代理。Necula, POPL '97。https://dl.acm.org/doi/abs/10.1145/263699.263712

### 4.2 对齐 AgentIO

- **生成器不可信**：含 LLM 生成、代码生成、外部变换在内的生成端一律按不可信处理；确定性在验收/执行/台账层，不在生成层（§15.3）。
- **事后验证环**：契约测试 + 突变 + 回放 = translation validation 形态的事后验证器；每轮变换后对 src/tgt 契约关系做核对。
- **证据随产物携带**：PCC 形态——产物附可检查证据（契约回执、指纹、回放轨迹），独立验证器快速核对，而非靠对生成端的身份信任。
- **边界如实**：bounded 验证有漏检；事后验证只覆盖测试/契约触及的行为，未覆盖的不宣称正确（沿用 E-1 诊断完整性口径）。

---

## 5. 自定义精力边界（只投信任 / 契约 / 证据层）

**投入自研**：
1. 契约语言：前后条件、效果、可验证性分级（known/unknown，fail-closed 不宣称完整）。
2. 证据分级与裁决回执：adjudication 闸、证据四态、新鲜度、谁按哪份口径依据哪些一手来源裁决。
3. 不变量锚定、回放、回滚、写闸。
4. trust-gated scoped 政策：holes=0 + 覆盖证明 / cache 闭包 / 契约作为增量可信度门，继承 fail-closed。
5. 契约充当依赖图来源：图节点 = 判据 / 证据 / 任务，不是编译目标。
6. 单写者 / 证据台账语义；证据只拦涨、读数不进退出码。
7. 外部 API 限速与本地并发分池政策。

**不投入自研（借用品对齐或迁移）**：语法解析内核、增量备忘录框架、调度执行器内核、OS 隔离装置、AST 变换内核、IDL 语言工作台、供给链签名/透明日志装置。

---

## 6. borrow-first 施工纪律条款（供 S-A / 阶段 2 遵循）

- **C1 立项先查借源**：新管道部件立项先查本映射表；决定自研前须书面说明借用品为何不适用（平台约束 / 语义不匹配 / 许可 / 维护状态），无说明不开工。
- **C2 表示层对齐标准**：身份、元数据、schema 表示优先对齐成熟标准（SCIP 身份、in-toto 元数据、JSON Schema·TypeSpec 模型），不新造身份词汇与元数据方言。
- **C3 执行层借成熟内核**：调度、隔离、变换等执行层优先借成熟内核；自研只做编排、裁决、证据附着。
- **C4 状态标注与语义对账**：已自研管道逐项标注 **已借 / 对齐 / 待迁移 / 自研特有**；迁移前做语义对账，不 parity 照搬；迁移产物须过验证环。
- **C5 借用品不豁免把守**：外部工具/库引入后同样过契约测试 + 突变 + 回放；外部读数同样 fail-closed，不因其为知名项目而记通过。
- **C6 信任层不外包**：契约、裁决、证据层为自研边界，不委托给借用品实现。
- **C7 平台约束优先**：Windows 单机优先；Linux/CI 远端动作再评估 nsjail/Bazel sandbox 等平台相关借源，不为本机场景过度建模。
- **C8 误报纪律**：词面命中（子串、局部函数名、语言 roster 条目）不得记为已借源；借源判定以依赖、装置或协议的实际采用为准。

---

## 7. 愿景参考（环境参照，非依赖）

| 参照 | 可取哲学 | 一手来源 |
|---|---|---|
| Unison | 定义按语法树哈希内容寻址；命名只是元数据；活库重构始终可类型检查；代码入库而非文本文件 | https://www.unison-lang.org/ ；https://www.unison-lang.org/docs/the-big-idea/ |
| MPS | DSL 语言工作台；投影编辑；程序即 AST，可组合多语言 | https://www.jetbrains.com/mps/ |
| Glamorous Toolkit | Moldable Development：按具体问题造上下文微工具，让系统可解释 | https://gtoolkit.com/ ；https://book.gtoolkit.com/ |
| Smalltalk | 反射活环境；一切对象；消息传递；环境随语言可 live 改 | 无源统一官方站点；ESUG 历史档案 https://archive.esug.org/ |
| GNU Emacs | 可定制、自文档编辑环境；扩展语言即环境本身 | https://www.gnu.org/software/emacs/ |

对齐 AgentIO 愿景（程序开发操作系统）：参照其环境、反射、可定制与上下文工具哲学；**不引入其运行时**，不据此排迁移工序。

---

## 8. 与企划 §15 三能力映射对齐

| §15 能力 | 归属 / 现状 | 借源策略 | 自研边界 |
|---|---|---|---|
| ① 得整项目契约 | 认知 / 翻译 / 切片 C（最难） | 解析借 tree-sitter；符号身份对齐 SCIP | 契约分级 known/unknown、fail-closed 不宣称完整、提取判据 |
| ② 契约 → 源码 | 外化器 / 意图编译器 | codegen 对齐 TypeSpec/Smithy/protobuf 模型与发射器 | 外化器忠实性判据、验证环、schema 忠实性核对 |
| ③ 证据驱动改源码 | 根因重写 / 写闸 / 回放 / 回滚 | 改写按语言借 AST 工具；调度借 Ninja/jobserver 模型 | 根因重写、写闸、回放/回滚、证据台账 |

---

## 9. 局限与未核实

- **样本**：n=1 仓内现状快照（HEAD `782d6279`）；未做迁移成本、性能与规模实测；迁移/对齐决策为建议，非施工指令。
- **复用证据**：调度/资源借源复用 trackB-EXEC-signatures（S17 信号量/命名池、S18 死锁锁序、S19 远端限速）与 trackB-S-external-mechanisms（Skyframe/Buck2/Nx/Turborepo/TIA/Airflow/Dask/Ray/Zuul/GitHub concurrency/K8s）已核实 URL。
- **沿用未核实项**（trackB-EXEC 登记，本轮不补）：MCP 专属 slot/速率规格；leaky bucket/GCRA 形式规范；Buck2 本地资源信号量；Dask/Ray 内存准入细节；各远端 API 实际配额上限。
- **Smalltalk**：无单一官方站点，标「无源」；仅列 ESUG 历史档案。
- **边界声明**：本审计为只读研究输入；阶段 1 收口由写者在途、S-EXEC 由 trackB/简报作者在途，本审计不触碰主仓改动；任何落地须另立卡、经独立裁定、把守测试与回放验证后冻结。

---

## 附录 A. 一手 URL 清单（按子系统分组）

### 索引
- tree-sitter：https://tree-sitter.github.io/tree-sitter/
- SCIP：https://github.com/sourcegraph/scip ；https://sourcegraph.github.io/scip.dev/

### 增量
- salsa：https://salsa-rs.github.io/salsa/overview.html ；https://github.com/salsa-rs/salsa
- Skyframe（Bazel）：https://bazel.build/versions/8.0.1/reference/skyframe
- Nix：https://nixos.org/guides/how-nix-works/
- Unison：https://www.unison-lang.org/docs/the-big-idea/

### 调度 S-EXEC
- Ninja：https://ninja-build.org/manual.html ；pools https://ninja-build.org/manual.html#pools
- GNU make jobserver：https://www.gnu.org/software/make/manual/html_node/Job-Slots.html ；实现论文 https://make.mad-scientist.net/papers/jobserver-implementation/
- K8s 优先级/抢占：https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/ ；Lease 选举 https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/
- Go 信号量：https://pkg.go.dev/golang.org/x/sync/semaphore ；errgroup 源码 https://github.com/golang/sync/blob/master/errgroup/errgroup.go
- Java Semaphore：https://docs.oracle.com/en/java/javase/25/docs/api//java.base/java/util/concurrent/Semaphore.html
- Tokio Semaphore：https://docs.rs/tokio/latest/tokio/sync/struct.Semaphore.html
- Bazel local_resources / 命令行参考：https://bazel.build/reference/command-line-reference
- 锁序全序（Oracle）：https://docs.oracle.com/cd/E37838_01/html/E61057/guide-35930.html
- Cornell CS2112 locking level：https://www.cs.cornell.edu/courses/cs2112/2018fa/lectures/lecture.html?id=synchronization
- Guava RateLimiter：https://guava.dev/releases/17.0/api/docs/com/google/common/util/concurrent/RateLimiter.html ；源码 https://github.com/google/guava/blob/master/guava/src/com/google/common/util/concurrent/SmoothRateLimiter.java

### 沙箱
- Bazel sandboxing：https://bazel.build/versions/7.6.1/docs/sandboxing ；hermeticity https://bazel.build/versions/7.6.1/basics/hermeticity
- nsjail：https://github.com/google/nsjail

### 改写
- OpenRewrite：https://docs.openrewrite.org/
- LibCST：https://libcst.readthedocs.io/
- ts-morph：https://ts-morph.com/
- Coccinelle：https://coccinelle.gitlabpages.inria.fr/website/
- comby：https://comby.dev/

### codegen
- protobuf：https://protobuf.dev/
- Smithy：https://smithy.io
- TypeSpec：https://typespec.io/
- MPS：https://www.jetbrains.com/mps/

### provenance
- in-toto：https://in-toto.io/ ；https://in-toto.io/docs/getting-started/
- SLSA：https://slsa.dev/spec/v1.1-rc1/levels
- Sigstore：https://docs.sigstore.dev/
- Nix 哈希闭包：https://nixos.org/guides/how-nix-works/
- Unison 内容寻址：https://www.unison-lang.org/docs/the-big-idea/

### 设计指引
- CompCert：https://compcert.org/
- alive2：https://github.com/AliveToolkit/alive2 ；https://alive2.llvm.org/
- PCC（Necula, POPL '97）：https://dl.acm.org/doi/abs/10.1145/263699.263712 ；PDF https://courses.engr.illinois.edu/cs421/fa2010/papers/necula-pcc.pdf

### 愿景参考
- Unison：https://www.unison-lang.org/
- MPS：https://www.jetbrains.com/mps/
- Glamorous Toolkit：https://gtoolkit.com/ ；https://book.gtoolkit.com/
- Smalltalk：无源统一官方站点；ESUG 档案 https://archive.esug.org/
- GNU Emacs：https://www.gnu.org/software/emacs/

---

## 附录 B. 老文献借源映射（Main 2026-11-25 登记 · 设计输入 · 不施工）

> **登记性质**：设计输入借源映射，追加附录，不改写 §1–§9 与附录 A 既有正文；引定理/方法不自证，本仓落地以契约/证据层把守为准。阶段 1 收口、S-A/阶段 2、CI-fix 在途不变，本附录不构成施工指令。
> **可修订性**：本附录的死亡三分类、复活候选判定与定位综合属 Main 裁决 / 再诊断，按 B.4 meta-gate 外延**不豁免独立复核、可被后续证据 supersede**，不当不可变真理。

### B.1 五栏复核框架与死亡三分类口径

每条借源走五栏复核：① **愿景**（剥时代包装）② **当年实现** ③ **宣称死因** ④ **我们的再诊断**（真正绑定约束？诊断对/全？）⑤ **今天变了什么 + 重达愿景需改目标还是改实现**。

④栏死亡三分类：
- **① 证明的不可能**（undecidability / 无摊销组合爆炸）——真死不复活；
- **② contingent 成本墙**——成本变可复活；
- **③ 过早放弃 / 社会学死亡**——愿景 90% 剩 10% 是工程磨非科学新；学术 novelty 计酬致 90% 弃坑；历史记失败实为未完成。

每篇加问：**剩余缺口是科学还是工程？是工程且今天条件供得起 ⇒ 复活候选（改弱目标）**。

### B.2 九条复核（七条老文献 + 两示例）

#### B.2.1 Bernstein 条件（存活形式定理）

- **① 愿景**：并发操作按可交换性重序——读写集不相交即可并行且保持正确。
- **② 当年实现**：数据库事务并发控制理论，读/写集相交判定与可交换事务。
- **③ 宣称死因**：定理无死因·作形式基础引用，不自证（存活形式定理）。
- **④ 再诊断**：真正绑定约束 = 读写集可静态/契约判定且不相交；适用边界 = 动态导入/反射/生成物盲区下读写集不可判定。非死掉系统，不套三分类；剩余缺口属工程（能力标注/键面）非科学；定理照引，盲区必须保守串行。诊断对/全：否，未覆盖盲区须 fail-closed。
- **⑤ 今天变了什么 / 重达方向**：静态图盲区仍在；重达 = **改实现**（S-2 能力分类 + 契约标注读写面），不改定理目标。

#### B.2.2 Meyer DbC + Opdyke 重构前置条件目录

- **① 愿景**：软件契约化（前后条件/不变量约束行为）；重构在前置条件目录下安全进行。
- **② 当年实现**：DbC 设计-by-contract；Opdyke 博士论文重构前置条件/变换条件目录。
- **③ 宣称死因**：方法存活，未成死掉系统；落地依赖语言/工具链承载前置条件。
- **④ 再诊断**：绑定约束 = 变换前可核验前置条件；本仓诊断 `rename_symbols` 类工具缺前置条件目录、不满足即静默通过是缺陷；前置条件与契约覆盖面对应关系尚未审全。三分类：**② contingent 成本墙**（承载工具链成本）偏 ③；剩余缺口以工程为主，今天 AST 工具链已供得起 ⇒ **复活候选（改弱目标）**。
- **⑤ 今天变了什么 / 重达方向**：AST 工具链成熟（OpenRewrite/ts-morph/LibCST 已借，§3.5）；重达 = **改实现**（补前置条件目录 + 拒绝/补齐路径），契约约束重构目标不变。

#### B.2.3 Necula PCC 精确化 C11

- **① 愿景**：代码随产物携带可独立核对的证明；消费方用小验证器快速核验，不依赖产者身份。
- **② 当年实现**：Necula PCC（POPL'97）证明携带码 + 独立验证器；C11 系列精确化。
- **③ 宣称死因**：未死；形态被 translation validation / 事后验证环部分替代，「验证器小/冻结/独立重核」前提存活。
- **④ 再诊断**：绑定约束 = 验证器冻结且不可被产者改动 + 证书可独立重核；**非「分两系统」**。三分类：历史上 **② 成本墙**拖累证明构造；今天我们只借形态不做机器检查证明 ⇒ **复活候选（改弱目标）**。
- **⑤ 今天变了什么 / 重达方向**：生成端不可信化使 PCC 形态更相关；重达 = **改实现**（harness 哈希钉死 + 独立重核器），目标不变。

#### B.2.4 Daikon 不变量推断 + 假不变量过滤

- **① 愿景**：自动从运行样本推断不变量，辅助规格发现与回归检测。
- **② 当年实现**：Daikon 动态不变量推断框架；候选不变量 + 过滤/鉴别机制。
- **③ 宣称死因**：研究工具存活，未进主流生产流水线。
- **④ 再诊断**：绑定约束 = 样本代表性 + 假不变量过滤强度；当年局限 = 样本覆盖不足、推断易过拟合/假阳性。三分类：**② contingent 成本墙**（样本采集/过滤成本）偏 ③；剩余缺口工程为主；**复活候选（改弱目标）**：风险自扫只出候选 + 证据分级，推断结果不直接进硬判据。
- **⑤ 今天变了什么 / 重达方向**：可观测样本面扩大（台账/回放轨迹），静态不可见行为仍无源；重达 = 部分**改目标**（候选 + 分级）+ **改实现**（过滤/突变鉴别环，§13.7 Goodhart/分权口径）。

#### B.2.5 黑板塌缩条件（知识源少 + 控制显式）

- **① 愿景**：多知识源经黑板共享状态协作求解，控制流集中编排。
- **② 当年实现**：黑板模型（知识源 + 黑板 + 控制组件）；专家系统/调度类应用。
- **③ 宣称死因**：黑板架构淡出主流；常归因知识源耦合/控制不透明。
- **④ 再诊断**：绑定约束 = 知识源数量少 + 控制显式（塌缩条件即护栏）；对无限递归子代理，数量/层级/控制交还必须显式登记。三分类：**③ 过早放弃/社会学死亡**偏多（控制不透明被记为架构死）；剩余缺口工程（显式控制登记）；**复活候选（改弱目标）**：护栏显式控制保持，不放开隐式自治。
- **⑤ 今天变了什么 / 重达方向**：多 Agent 框架回潮，塌缩条件未变；重达 = **改目标**（护栏口径）+ **改实现**（限递归深度与交还点）。

#### B.2.6 Hoare wp（最弱前置条件）

- **① 愿景**：程序语义可由前后条件形式化；从后置条件反推最弱前置条件判断程序正确性。
- **② 当年实现**：Hoare 逻辑 / wp 演算；程序验证理论基础。
- **③ 宣称死因**：定理无死因·作形式基础引用，不自证（存活形式定理）。
- **④ 再诊断**：绑定约束 = 规格/前后条件完整且可表述；规格错 ⇒ 程序正确但无用；边界 = 完整规格不可得时 wp 反推不成立，落四态语义。非死掉系统；缺口在规格提取（见 B.2.8），工程与科学交叉；定理照引，不做复活判定。
- **⑤ 今天变了什么 / 重达方向**：规格提取仍是瓶颈（E-1 B 臂为证）；重达 = **改实现**（四态判据 + 契约分级 known/unknown），定理目标不变。

#### B.2.7 Lamport happened-before

- **① 愿景**：并发/分布式事件因果偏序可判定；无因果关系即并发可重序。
- **② 当年实现**：happened-before 偏序关系 + 逻辑时钟。
- **③ 宣称死因**：定理无死因·作形式基础引用，不自证（存活形式定理）。
- **④ 再诊断**：绑定约束 = 事件可登记因果序号；边界 = 本地单写者场景无分布式时钟需求，不照搬分布式时间同步。非死掉系统；缺口工程（台账序号锚定）；定理照引。
- **⑤ 今天变了什么 / 重达方向**：台账/证据轨迹提供因果登记面；重达 = **改实现**（D3 txn 序号按偏序锚定），定理目标不变。

#### B.2.8 演绎合成（Main 示例）

- **① 愿景**：从规格演绎合成正确程序，搜索空间组合求解。
- **② 当年实现**：演绎程序合成 / 组合搜索（定理证明 + 代码生成）。
- **③ 宣称死因**：合成规模受限；搜索成本与规格编写成本双高。
- **④ 再诊断**：双绑定 = 写规格 + 组合搜索；LLM 压搜索/起草，但规格校验仍在；自洽 ≠ 完整。三分类：**② contingent 成本墙**（搜索成本 + 规格成本）；剩余缺口以工程/规格表达为主；**复活候选（改弱目标）**。
- **⑤ 今天变了什么 / 重达方向**：搜索/起草被 LLM 压缩，规格化成本未消失；重达 = **改目标**为部分/可执行/可演化契约（判据四态 + append-only），而非回到全自动合成。

#### B.2.9 专家系统（Main 示例）

- **① 愿景**：知识库 + 推理机复刻专家判断，规则可解释。
- **② 当年实现**：规则引擎 + 知识获取回路；专家知识抽取入库。
- **③ 宣称死因**：知识获取瓶颈 + 无学习回路 + 难优雅降级，规则库脆。
- **④ 再诊断**：绑定约束 = 缺学习回路 + 优雅降级；规则不能自更新、边界外脆断。三分类：**③ 复活候选**；剩余缺口工程为主，今天台账/证据轨迹条件供得起。
- **⑤ 今天变了什么 / 重达方向**：台账/证据轨迹可作可审计可演化知识层；重达 = **改目标**为活的可审计可演化账本，而非静态规则库（与前条 ③ 复活候选口径一致，合并呈现）。

### B.3 死亡三分类示例补入（不在原七条内，按 ④ 栏分类登记，不硬塞进不相关条目）

- **结构化编辑器 / BDI** = **③ 复活候选**。
- **Cyc** = **③ 但目标本身可能错 ⇒ 改目标优先**。
- **GPS / 纯逻辑主义感知** = **① 证明的不可能，不复活**。

### B.4 读法纪律 + meta-gate 外延

- **五栏复核表读法纪律**：每条借源走 ①愿景（剥时代包装）②当年实现 ③宣称死因 ④我们的再诊断（绑定约束 + 死亡三分类 + 科学/工程 + 复活候选判定）⑤今天变了什么（改目标还是改实现）。借方法骨架，不照搬当年成本假设与适用前提。
- **meta-gate 外延（显著标注）**：文献 / 他窗分析 / Main 裁决**皆不豁免独立复核**；supersede 留追溯 = **真相可修订不可抹除（append-only）**；本映射每条本身可被后续证据 supersede。
- **形式定理适配**：Bernstein / Hoare / Lamport 这类存活形式定理而非死掉系统的条目，③栏如实标「定理无死因·作形式基础引用，不自证」，④栏仍问绑定约束/适用边界，⑤栏问改目标还是改实现；五栏框架统一，内容按条目性质适配，不硬造死因。

### B.5 两处修正（显著标注；属 ④⑤ 再诊断结论）

1. **LLM 压的是起草成本，非规格化成本**：生成起草环节被压缩，瓶颈搬到**裁决吞吐 × 质量**；E-1「C 自洽 ≠ 完整」为证。**禁「成本→0」表述**：不得宣称规格化/裁决成本趋零；曲线按渐近非指数登记（对齐加速度曲线 §6.4）。
2. **幸存者教训**：赢家都是嵌进现有工作流、成零流程税的隐形基础设施（IDE / 类型系统 / 分布式 DB）；AgentIO 以 **MCP/LSP 式引擎嵌入，不卖新工作流**（CASE 死因解药）。

### B.6 定位综合（显著标注 · Main 裁决，可被后续证据 supersede）

- **AgentIO = 最后 10% 完成机**：契约 / 信任 / 账本 / 调度 = 不发论文的集成磨，廉价供给学术弃坑处。
- **行百里半九十**：我们自己的最后 10%（holes=0 / CI 观察期 / 外部采纳）占半；**阶段门 / 观察期 / 禁提前报完成 = 制度化尊重最后 10%**，防过早宣布死亡，也防过早宣布成功。
- 本段定位与 B.2 三分类同属 Main 再诊断，按 B.4 meta-gate 外延不豁免独立复核。

### B.7 吸收管线（borrow-first 细化 · Main 2026-11-25 裁决）

> 与 B.2 五栏复核 / 死亡三分类衔接；属 Main 裁决 / borrow-first 细化，按 B.4 meta-gate 外延**不豁免独立复核、可被后续证据 supersede**。

1. **活下来老工程 = 代码源**（tree-sitter / salsa / Bazel Skyframe / OpenRewrite / LibCST / rust-analyzer / Postgres·SQLite 事务 / git 对象模型 / Daikon / MPS）：许可证允许直接借实现/语义；**抄被证明 90% + 不和谐 10% 局部结构性替换（不打补丁）**。衔接：对应存活工程（嵌工作流幸存者，见 B.5②）。
2. **死在 90% 老论文 = 愿景源 + 尸检源**：抄思想 / 再诊断**不抄实现**（整体照搬进口死因）。衔接：对应 ③ 过早放弃 / 社会学死亡复活候选（见 B.2.5 / B.2.9）。
3. **不和谐处** = 实现与愿景矛盾或当年成本咬人处，**用我们条件（LLM / 信任层 / 账本）替换**；10% 局部结构性替换呼应「根因反补丁」纪律——不打补丁、局部结构重写。
4. **许可证护栏**（显著标注 · 与企划 §12.2 provenance / 许可干净口径一致）：优先 permissive（MIT/Apache）；**GPL 系只借思想不抄代码（硬约束）**；满足 L3 provenance 许可同意。
5. **灵光 = 选择效应，非年代因果**（幸存 + 未探索低垂果实）；判据 = **每页可证伪洞察密度 + 能否改一行代码 / 加前置条件**，不浪漫化年代。

### B.8 未核实

- 七条文献除 PCC（附录 A 已列）外，一手 URL 未在本轮逐条回填；其余沿用经典书目/教材口径，立卡时补一手出处。
- 本附录为设计输入；任何落地须另立卡、经独立裁定、把守测试与回放验证后冻结。

## 附录 C. 意图编译器·能力优先黑盒组合设计原则（Main 2026-11-25 登记 · 审计 C/M3′/S-1 设计输入 · 不施工）

> **登记性质**：设计输入原则，追加附录，不改写 §1–§9 与附录 A/B 既有正文；属 Main 裁决/设计输入，按 B.4 meta-gate 外延**不豁免独立复核、可被后续证据 supersede**。M3′ 仅命名登记，冻结判据待 Main 另立（本附录不自行定义）。阶段 1 收口、S-A/阶段 2、CI-fix 在途不变，本节不构成施工指令。

### C.1 六条原则

1. **黑盒能力面** = 契约/能力投影（capability_map / MCP 投影 / DSL 符号），**只取签名不看内部**。
2. **需要 X → 需要有什么 → 往下分解 = 精化（refinement）**；分解树 = 契约推导；意图 → 能力树 → 叶子命中已证明块或新建 + 验证契约。
3. **分解终点 = 借来的被证明原语（borrow-first）**；自上而下分解与自下而上 borrow 在中间会合，**到存在被证明块即停**。
4. **拼接 = S-1 DAG / S-EXEC 调度**。
5. **每个黑盒附证据/信任才可组合（assume-guarantee，holes=0 / fail-closed / PCC）**；组合可靠性 = 所假设保证的可靠性；防 leaky abstraction 魔法盒说谎。
6. **分解只终止于已存在被证明块**，不发明 unobtanium 中间魔法盒；不存在者立为**新建 + 验证契约**。

### C.2 童年思维精确化

**童年思维 = 设计引擎，信任层 = 现实引擎**：用户童年工程思维精确化 = 契约优先 + assume-guarantee + refinement。

### C.3 衔接标注

- ③ 借被证明原语 呼应 B.7 吸收管线（代码源抄 90% + 不和谐 10% 结构性替换）与 §6 C1–C8。
- ⑤ assume-guarantee / PCC 呼应 B.2.3 Necula PCC-C11（验证器冻结 + 独立重核）与 holes=0 / fail-closed scoped 信任。
- ④ 拼接呼应 §13.11 S-1 DAG（施工任务入图）/ §13.12 S-EXEC。
- ② refinement / 契约推导呼应 Hoare wp（B.2.6）/ DbC（B.2.2）形式基础。

## 附录 D. 开盒提取同构 → 正交算子内核（Main 2026-11-25 登记 · 架构原则 · 单处权威/反补丁推论 · 不施工）

> **前提**：组合 ≠ 系统，纯黑盒组合 = 脚本拼凑（= 用户单处权威/反补丁原则推论）。与附录 C 互补：能力优先 = 组合，开盒提取同构 = 抽象，合起来才是系统。属 Main 裁决/架构原则，meta-gate 不豁免独立复核、可 supersede；同构审计仅登记待排期，不自行定义冻结判据。

### D.1 四条原则

1. **borrow 借在内核层非工具层**：整盒借高层工具进口 N 份同构 = 拼凑；借底层 proven 内核（AST / 增量 / 事务日志 / 调度原语），**同构中间层在我们系统塌缩一处**。
2. **公共抽象 = 小而正交算子代数**（read / write / derive / verify / commit / schedule），所有能力 = 其表达式（Unix 管道 / 关系代数 / RISC 类比，同构用户算子库直觉）。
3. **护栏：同构被证明才提取**（rule of three / ≥2 真实用例），防预先大一统上帝对象，内核最小正交。
4. **内核 = 单点故障 ⇒ 拿最强信任 / 突变 / meta-gate 覆盖**。

### D.2 童年原则补全

能力优先 = 组合 + 开盒提取同构 = 抽象，合起来才是系统；**分解终点 = 我们小正交内核 + 借来内核**（补全附录 C ③「分解终点 = 借被证明原语」）。

### D.3 正式项登记：同构审计（审计 D）

扫现有 40+ 工具内部重复模式（解析 / 定位 / 读集 / 写 / 验证 / 记账）提取进正交算子内核，强制单处权威，**排审计 A/B/C 序列之后**（审计 D，待 Main 排期施工，本批仅登记不施工）。

### D.4 衔接标注

- ① 内核层 borrow 呼应 B.7 吸收管线①代码源（借底层 proven 内核非整盒高层工具）与 C1–C8。
- ② 正交算子代数呼应附录 C ②契约推导 / ④S-1 DAG 拼接（算子 = 能力表达式）。
- ③ rule of three 防上帝对象呼应「根因反补丁 / 单处权威」。
- ④ 内核单点故障最强信任呼应 B.2.3 PCC-C11（验证器冻结 + 独立重核）+ meta-gate 外延。

### D.5 合题修正：同构提取须尊重权威边界（Main 2026-11-25，修正前条同构审计范围；supersede 留追溯，不抹除前条）

> **总纲**：同构只在**同一权威域内**提取；跨权威域盒子保持封闭，靠**契约 + 证书**组合不硬解。本修正属 Main 合题裁决，meta-gate 不豁免独立复核、可 supersede。

1. **我们胶水/能力层 = 一个权威域**：开盒提取同构进正交内核。
2. **借来/proven/verified 引擎 = 独立权威域**：整盒原子借用，版本钉死 + 输出证书/校验和，CLI/FFI 契约调用，**绝不并入我们内核**（合并杀死其独立证明/PCC 小验证器性质）；跨域同构不是我们的，**接口处组合**。
3. **评估器/判据核 = 密封权威域（meta-gate）**：同构审计**必须排除信任/评估域**，防把尺子熔进被量对象。

**防污染机制 = 权威隔离**：每域自有写 scope，跨域写禁止，跨域读只走契约 + 证据（写闸/单写者/via-actor 非鉴权/进程边界/校验和）。**内核 = 组合代数层非外国盒子熔炉**。borrow 借内核 = 借整个自足权威盒当原子积木，提取同构只针对自己胶水。

**对前条附录 D 的修正标注（supersede 留追溯，不抹除前条）**：

- 前条①「borrow 借底层 proven 内核…同构中间层塌缩一处」须以本修正限定：**塌缩一处只针对我们胶水/能力域内的同构**；借来 proven 引擎是独立权威域整盒原子借用，**不塌缩进我们内核**（前条措辞若含「借来内核塌缩一处」歧义，标注以本修正为准）。
- 前条「同构审计扫 40+ 工具内部重复模式提取进正交内核」范围修正：**只扫我们胶水/能力域自有工具**；借来/proven/verified 引擎（独立权威域）与评估器/判据核（密封 meta-gate 域）**排除在外**，不硬解不熔合。
- 分解终点「我们小正交内核 + 借来内核」精确化：借来内核 = **独立权威盒原子积木**（接口契约组合），非熔进我们内核。

**衔接标注**：权威隔离呼应 via-actor 非鉴权（传输来源 ≠ 鉴权）/单写者/写闸/进程边界/校验和；②独立证明/PCC 小验证器呼应 B.2.3 Necula PCC-C11（验证器不可被产者改动）；③密封评估域呼应 meta-gate 外延（评估器对改进者不可变）。

### D.6 三轴精确化：读共享 / 写验密封（Main 2026-11-25，精确化 D.5 权威边界）

解用户「数据越多法力越强 vs 怕污染」表面矛盾（非杞人忧天）：读/写/验三轴分离。

① **数据（读）共享最大化 = 长法力**：读不污染，所有盒子共享事实底座（fact-core/索引/账本/设计册 = 黑板共享事实空间）。
② **权威（写）密封**：防 blast radius/单点故障，跨域写禁止。
③ **信任（验）密封**：防生产者与验证者熔合失独立复核。

**更多数据 ≠ 更多写权威**，盒子靠读共享事实变强，不靠吞并权威。**账本形态 = 单写者多读者**，同时满足数据集中法力大 + 写验分域不污染。前条权威边界原则据此精确为「**读共享 / 写验密封**」。

衔接：读共享黑板呼应 B.2.5（黑板作读侧共享事实空间，写/验仍密封）；单写者多读者呼应 §13.12 单写者 mutex；验密封呼应 meta-gate 外延 + B.2.3 PCC-C11。属 Main 裁决，meta-gate 不豁免独立复核、可 supersede。

### D.7 范畴论设计输入：内核/投影（Main 2026-11-25 登记 · 形式化 property · 不施工）

> **律 = 可测试 property 非玄学**：下列范畴论律落地为 property-based 测试 + 突变牙纳入证据纪律，非抽象玄谈。属 Main 裁决/设计输入，meta-gate 不豁免独立复核、可 supersede。

1. **算子代数成范畴**（结合律 + 恒等）= S-1 DAG 重排/重构正确性。
2. **投影 = 函子**（保结构，先运算再投影 = 先投影再运算）；漂移 = 函子律失败 → 单权威/投影精确判据。
3. **模型无关 = 契约 → 代码映射自然**（自然变换，不特判）。
4. **读共享/写验密封 = 纯计算与效应分离进单子**（单写者账本 = state/writer 单子）；单子律 = 效应管线重构正确性。
5. **最小正交内核 = 初始代数/泛性质**（无冗余无混淆，rule-of-three 后提炼，防 unobtanium）。
6. **黑盒 + 证据 = Yoneda**（对象由探针/关系决定）。

**落地**：结合律/函子律/单子律变 property-based 测试 + 突变牙纳入证据纪律。

**护栏**：已有 2-3 具体实例后才提炼，不先建大一统。

**衔接**（范畴论律 = 既有原则的可测试 property 形式化）：

- ②函子律 ↔ 投影精确/单权威（D.5 同权威域内提取/借来引擎独立权威域整盒原子借用/评估器判据核密封 meta-gate 域排除）；
- ④单子律 ↔ 读共享写验密封/单写者账本（D.6 数据读共享最大化长法力/权威写密封/信任验密封/账本 = 单写者多读者）；
- ⑤初始代数 ↔ 最小正交内核 rule-of-three（D.1②/D.3）；
- ⑥Yoneda ↔ 黑盒 + 证据（C.1①/C.1⑤）。

## 附录 E. 竞品/借源映射与命题 sharpen（Main 2026-11-25 简报登记 · 设计输入 · 不施工）

> **登记性质**：11-25 简报竞品/借源映射 + 命题 sharpen，追加附录，不改写 §1–§9 与附录 A–D 既有正文；编号沿用简报借源类别序号。属 Main 裁决/设计输入，meta-gate 不豁免独立复核、可 supersede。

### E.1 竞品/借源映射（编号对应借源映射表类别）

- trail-code = ② 索引 code-source；
- dsh-orchestrator / worktree-for-agents = ⑥ 写 scope / merge-ancestor code-source；
- rulebookguard = ③ 三方锚定 code-source；
- opencode-harness = ③⑩ 校验和权威；
- MCP Tasks / Elicitation = ⑪ 平台集成威胁观察；
- AutoGPT CVE = ⑩ 组合授权/审批 digest 回归用例。

（code-source = 代码源，按 B.7 吸收管线①借实现/语义；编号 ②③⑥⑩⑪ 对齐审计借源映射表既有类别，类别名以本条括号描述为准；未落档一手出处者立卡时回填。）

### E.2 命题 sharpen

- **独特性 = 单一权威下集成 + trust-gated scoped + meta-gate 互相强制（最后 10%），非组件**；
- **组件层商品化承认**；
- **唯一威胁 = 平台集成（MCP）⇒ 加速信任层 + 模型无关开放引擎 + 自托管飞轮**；
- **竞品 bug=我们规格**。

### E.3 衔接标注

- 竞品 bug=我们规格 呼应 B.2.2 DbC 前置条件 / C.1⑤ assume-guarantee（竞品缺陷转为我们前置条件/回归用例）。
- 平台集成威胁呼应 §12 L3 护城河（大厂自研验证器垂直整合风险）+ B.3 幸存者教训（MCP/LSP 式引擎嵌入不卖新工作流）。
- 独特性 = 最后 10% 呼应 B.6 / D.6 定位综合（AgentIO = 最后 10% 完成机）。
- AutoGPT CVE 组合授权/审批 digest 回归用例呼应 D.5 权威隔离 / 写验密封。
