# S-EXEC 信号量 / 资源统一调度执行模型 · 企划草案（待 Main 复核冻结）

- **状态**：**草案待 Main 复核冻结，非自冻结**；不写入冻结企划正文。本轮只读研究 + 企划写作，不写 main、不碰主仓代码、不跑主仓脚本、不做 git 写操作、不改冻结企划 `AgentIO增量覆盖证明-M1-M10裁决表与G1-G10闭合企划.md` 正文。
- **定位**：S 线底层执行模型（资源准入 / 并发 / 互斥原语层），含**施工 + 验证 + 收口流水线任务建模**；呼应冻结企划 §13.11「S 线范围扩 · 施工+验证+收口统一流水线调度」。
- **基线**：主仓 HEAD `5cee21ff7afaa0d30339fe2e1c8d1877b5891b9f`（行号锚点施工前重导）；本机 16GB RAM / i5-12500H / Windows；重量任务放 CI/云端（§0.3-4）。
- **复用材料**：S 三路决策简报（`artifacts\S线调度层-三路研究决策简报.md`，S-1~S-14、SIG-S01~S16 + SIG-X1~X4）；冻结企划 §13.1–13.11、§10.1/§10.6/§10.7；trackB 外部机制与签名报告；`trackB-EXEC-resource-models.md`（236 行 / 35 条一手来源，计数信号量 / mutex / 限速器 / 死锁避免 / 增量失效 / 测试选择一手已核，URL 见 §9.1/§9.2）；`trackB-EXEC-signatures.md`（SIG-S17/18/19 签名侧外部先例背书，见 §8）。
- **标注**：机制事实附 `文件:行号`；方案主张与起步值标 **【建议】**；判定三级：`静态确证` / `候选待实验` / `前瞻风险`。

---

## 1. 模型总纲（Main 七点之 ①）

### 1.1 步骤 = 任务，资源 = 池

- 流水线中的每个步骤建模为**任务（Task）**；每个有争用的外部/共享对象建模为**资源池（Pool）**。任务在就绪后向池申请准入 permit，运行期持有，结束释放。
- **只建模有争用的池**：无共享对象、无并发争用的动作不单独建池。
- **廉价任务不单独占信号量**：per-part smoke（syntax / import / 编译级廉价检查）与收口 commit（本地写账动作）不单独申请 CPU 计数信号量；其触发的下游验证任务照常请求对应池（对齐 §10.7 ②⑥）。
- EXEC 层职责边界：只管**准入、并发、互斥、释放与记账**；不决定 DAG 拓扑（S-1）、不决定优先级序（S-2/S-5）、不决定预算档位（S-6）、不决定跳过（S-4）。

### 1.2 三层职责分离

| 层 | 归属 | 职责 |
|---|---|---|
| 拓扑层 | S-1 DAG | 任务节点、依赖边、就绪队列、环检测 |
| 准入层 | **S-EXEC（本模型）** | 池登记、permit 发放/回收、互斥、申请失败语义、资源记账、释放保证 |
| 策略层 | S-2 / S-5 / S-6 / S-7 | 优先级、预算档位、节奏合并、降级回退 |

---

## 2. 流水线任务建模（施工 + 验证 + 收口，对齐 §13.11）

### 2.1 任务类型

| 类型 | 阶段 | 资源特征 | 准入口径 |
|---|---|---|---|
| `build-part` | 施工波内 | 编译/写源码段；请求 CPU permit；写面段持 DB/源码写 mutex | 波内 per-part 提交，树干净（§10.7①） |
| `smoke-part` | 施工波内 | 廉价 syntax/import/编译级检查；**不单独占 CPU 信号量** | 早抓低级断裂（§10.7②） |
| `verify-scoped` | 波内验证 | scoped 验证，只读为主；请求 CPU + IO permit | 信任由 S-4 cache 闭包 + holes=0 + M3′ 契约提供（§10.4③/§10.7⑤） |
| `verify-full` | 阶段末 | 整大 diff 全量核验；CPU 高负载；阶段边界一次（§10.7③） | 唯一可信验证集中阶段边界（= M2′） |
| `commit` | 收口 | 本地写账动作；**不单独占 CPU 信号量**；写 mutex | 收口排空闸门后执行（§10.7 / S-7 强制门不合并） |
| `background` | 后台 | 校准 / reference-run / 消融 / 突变；低优池；可被前台抢占 | 隔离 worktree；不在活工作树跑（§0.3-3） |
| `mutation` | 后台/专项 | 临时改源码再还原；独立写面槽 + 还原自检；抢占点必须在还原完成后 | 独占槽位；临界区内不可被抢占（S-5/SIG-S08） |

### 2.2 任务字段（EXEC 记账口径）

- `task_id`：稳定 id（禁节号行号，对齐 M7/冻结企划 §13.7 锚点口径）。
- `type`：2.1 枚举之一。
- `priority`：前台验证 / 后台校准；由 S-2/S-5 赋值，EXEC 只读取排队序。
- `resources`：`{ cpu_permit: n, db_write: bool, mcp_slots: n, io_handles: n, mem_budget: bytes }`；由 S-2 能力标签（`reads/writes/side_effect`）派生，不得命令文本反推（S-1 依赖边同口径）。
- `deps`：DAG 依赖边（S-1 登记）；EXEC 不裁剪边。
- `cancel_point`：可安全取消点（临界区外、临时态可清理）；抢占交接契约（§5.3）。
- `acceptance`：三态 verdict 口径（PASS / FAIL / SKIP / unsupported / unknown / incomplete）；未跑不进通过计数（三兜底 (c)）。
- `cache_key`：S-4 跳过判定输入；未变任务在**入池前**被跳过，不请求资源（§4.3）。
- `trace`：owner_card / 席位 / 快照时点 / 释放记录。

### 2.3 流水线串接（对齐 §10.6 / §10.7 / §13.11）

1. 波内 `build-part` → `smoke-part`（廉价）→ 下游 `verify-scoped`；
2. 阶段边界 `verify-full` 整 diff 核验；
3. 收口排空闸门 → `commit` 单 diff；红则 commit 粒度 bisect；
4. `background`/`mutation` 低优池旁路，不阻塞前台收口路径。

---

## 3. 资源池清单（Main 七点之 ②）

### 3.1 本地池

| 池 | 原语类型 | 容量 / 争用对象 | 准入语义 | 申请失败语义 | 观测 |
|---|---|---|---|---|---|
| **P-CPU** | 计数信号量 | 可用核数；CPU 计算型任务（验证 / 编译段） | acquire permit；并发上限由 S-6 预算档位给定 | 无 permit ⇒ 排队等预算；超时 ⇒ fail/unknown 单列，**不跳过、不折绿** | 占用曲线 / 等待队列 / 持有时长 |
| **P-DB-WRITE** | 二元 mutex（单写者） | `tasks.db` / `cache.db` / `design-db/` / 投影写面 / 真册注册表 | 写面串行；同一时刻单写者 | acquire 失败不越预算排队等待；响亮 fail（写面不并发）；对齐 SIG-S16 临时文件 + rename 原子写 | 持有者 / 等待者 / 陈旧接管事件 |
| **P-MCP** | 计数信号量 | MCP handler slot 数；调外部工具 / MCP 的验证门 | 按槽位计数准入 | 外部不可用 ⇒ unsupported / fail-closed，不折缓存命中 | slot 占用 / 外部降级读数 |
| **P-IO** | 计数配额 | 句柄 / 网络并发；文件与网络 I/O 型任务 | 句柄余量准入（对齐 `run-tests.mjs:498-499` 135 进程句柄教训） | 句柄耗尽 ⇒ 降档排队，响亮报错不静默挂 | 句柄占用 / I/O 等待占比 |
| **P-MEM** | 内存预算配额 | 并发任务 RSS 峰值；水位线准入 | 三输入（RSS 余量 / 温度电源 / 句柄）联合定档（S-6） | 超水位 ⇒ 降后台档；85% 停后台【建议起步值，待探针标定】 | RSS 峰值 / swap 增速 / 节流档 |
| **P-LOCAL-BUDGET** | 本地预算配额 | 后台校准 / 消融 / 突变；本机轻量抽样池 | jobs 上限 + 低优先级 + 可被前台抢占/取消 | 前台优先；后台让渡；不在活工作树跑重量对照（§0.3-4） | 后台占用 / 被抢占次数与恢复点 |

### 3.2 外部池（非 CPU）

| 池 | 原语类型 | 争用对象 | 准入语义 | 失败语义 |
|---|---|---|---|---|
| **E-API** | 速率限制器 / 令牌桶 | 外部 API 调用（模型席位、外部服务） | 令牌桶容量按外部方约定；排队或拒绝 | 超限排队可见化；外部不可用 ⇒ unsupported 单列；**本地池口径不得误套到外部配额** |

- 本地不自建分布式协调器；外部配额由外部方约定与远端限流为准（对齐 trackB §1.2/F6：`.agent-io/*` gitignored 单机派生，无跨机对账基础）。
- 池登记一处权威：与 S-2 能力标签同源，不抄第二份资源清单（对照 `heavy_lock.mjs:6-7` 共享资源清单口径）。

### 3.3 不建模项（不过度建模）

- 无争用的纯本地计算 / 日志 / 台账追加动作；
- 廉价 smoke 与收口 commit（§1.1）；
- 只读且无共享面的独立任务（读面并发由 P-CPU 计数统一约束，不另建读锁池）。

---

## 4. 信号量与抢占的正交边界（Main 七点之 ③）

### 4.1 信号量管准入 / 并发，不管抢占

- 计数信号量 / mutex 只回答「现在能不能进、几个人能进」；**不回答「谁先谁后、谁可以被中断」**。
- 抢占（前台验证抢占后台校准 / 消融 / 突变）走 **OS 优先级 / kill** 通道，与 permit 发放正交叠加；EXEC 登记可取消点与临时态还原，不实现抢占决策（S-5 策略层）。

### 4.2 正交交接点

1. 高优任务到来 ⇒ 策略层（S-5）判定可让渡的低优任务；
2. 低优任务在 `cancel_point` 外进入可取消状态；临时变异先完成还原才可中断（SIG-S08 守卫）；
3. 被中断任务释放全部 permit / mutex，安全边界状态进回执；
4. 高优任务正常走池准入；**抢占不绕池**，不产生双写双持。

### 4.3 缓存跳过先于准入

- S-4 判定未变任务在入池前跳过；跳过任务不申请任何 permit，不进等待队列；命中读数不读作漏测（SIG-S06 / 三兜底 (b)）。

---

## 5. 硬约束原语（Main 七点之 ④）

### 5.1 写面串行 = mutex

- 凡声明 `writes` 的任务持 P-DB-WRITE 二元 mutex；写面门不进并发槽；突变门独占槽位（三兜底 (a)；SIG-S02）。
- 跨仓并行走独立 worktree，各仓各锁（`heavy_lock.mjs:29-31` 指引）。

### 5.2 缓存 fail-closed = acquire 失败即 fail，不阻塞、不跳过

- 池申请失败 / 外部不可用 / 输入不全 ⇒ 走保守方向：fail / unknown / unsupported 单列；**不阻塞挂死、不复用旧缓存、不跳过应跑任务**（三兜底 (b)；SIG-S05/S06）。
- 排队预算内可等待；超预算响亮报错，点名持有者 + 等待时长（SIG-S03/S08 观测口径）。

### 5.3 三态退出

- 任务退出三态：PASS / FAIL / SKIP（含 unsupported / unknown / incomplete 单列）；未跑门不得出现在通过计数内；中止轮次独立退出档，不汇总成完整绿（三兜底 (c)；SIG-S05）。
- OOM / kill / 信号终止与断言失败分流；读数带「被杀」原因，不折空跑通过（S-6 把守口径）。

---

## 6. 死锁避免（Main 七点之 ⑤）

### 6.1 资源有序分配

- 全局资源秩【建议】：`mutex(DB/写面) > 其他写面锁 > MCP > IO > CPU`；任务按秩升序申请，禁止逆序交叉持锁。
- 资源秩表随 S-2 能力标签一处登记；新池入表补秩。

### 6.2 写锁不 hold-and-wait

- 持 P-DB-WRITE 期间不得再等待其它池 permit；申请不到 ⇒ 回滚当前 part / fail 当前任务，释放已持写锁，不挂等待链。
- 临时变异任务：先完成还原才允许进入可中断 / 可让出状态。

### 6.3 双重环检测 + 看门狗

- DAG 边环（S-1 计划期）+ 资源等待图环（EXEC 运行期）双重检测；检出 fail-closed 拒绝出计划 / 响亮死锁报错，点名环节点或等待对（SIG-S04/S18）。
- 节点独立 deadline + 等待链看门狗；超时判「未完成」独立退出档，不静默挂（S-1 依赖项口径）。

### 6.4 租约与心跳（长期位，对齐 S-10）

- 写 mutex 可演进 lease TTL + 续约 + 陈旧接管前洁净校验；本地单写者场景不需要分布式选举；字段模型借 K8s Lease（trackB §5.2），不引入协调器。

---

## 7. 与 S 线既有项的集成接口（Main 七点之 ⑥）

| 既有项 | EXEC 接口 | 方向 | 守卫 |
|---|---|---|---|
| **S-1 DAG** | 任务节点挂 `resources` 字段；EXEC 提供 acquire/release 原语；拓扑、边、就绪队列归 S-1 | S-1 → EXEC | 依赖边不被裁剪；环检测双重覆盖 |
| **S-2 并行（能力分类）** | 资源请求由 `reads/writes/side_effect` 标签派生；写面 → mutex，只读 → CPU/IO 计数 | S-2 → EXEC | 标签与写盘原语逐项反查；误标只读被夹具拒绝 |
| **S-3 fail-fast 分级** | acquire 失败语义与早退策略衔接；硬阻断环境门可早退，独立不变量门组跑满或显式未跑 | S-3 ↔ EXEC | 未跑门不进通过计数；中止独立退出档 |
| **S-4 缓存** | 未变任务入池前跳过，不请求资源；缓存条目写回走 P-DB-WRITE 单写者 + 原子替换 | S-4 → EXEC | 键面不符不复用；坏缓存自愈为空显形 |
| **S-6 预算** | 池容量档位由三输入反馈驱动；P-CPU/P-MEM/P-LOCAL-BUDGET 容量随档位升降；退避环 | S-6 → EXEC | 降档不改判定口径；自适应决策留痕可回放 |
| **S-13 抢占** | 正交通道；EXEC 登记 cancel_point、临时态还原、permit 归还交接 | EXEC → S-13 | 抢占不绕池；临界区内不可中断；降级读数显形 |

- 不接入项：S-7 节奏合并（策略层）、S-8 放置（本机/CI 映射）、S-9 I/O 重叠编排（长期）、S-11 清单并发（应用层 CAS）、S-12 scoped 对账（读端域）——EXEC 只提供底层准入原语，不越权实现上层策略。

---

## 8. 新增签名 SIG-S17 ~ SIG-S19（Main 七点之 ⑦）

> 接入统一签名目录（SIG-S01~S16 + SIG-X1~X4 之后顺延编号）；四要素 + 证据分级 + effect-aware 备注。原语层外部背书由 `trackB-EXEC-resource-models.md` 核入（§9.1/§9.2）；签名侧检测模式 / 测量方法 / 解法先例由 `trackB-EXEC-signatures.md` 核入本节；静态可测部分以主仓锚点复核为准。

### SIG-S17 · 资源 acquire/release 泄漏与错配

- **检测模式**【静态+运行时】：permit / mutex 申请后无配对释放；任务跨取消点持有资源；资源请求字段与实际写面不符；句柄 / 内存泄漏；池记账与实际占用不一致。
- **测量方法**【运行时】：持有时长 / 等待队列 / 未释放计数；acquire-release 配对审计；池占用曲线与任务台账对账；泄漏句柄样本。
- **解法**：RAII 式释放（作用域 / finally 保证）；任务字段显式声明资源；池记账双写（申请 / 释放事件）；超时强制归还并报错。
- **正确性守卫**：泄漏 / 错配夹具必须检出；写面误标只读被拒；释放点只在取消点外；观测不改变互斥语义。
- **证据分级**：申请/释放形状【静态】；运行时泄漏样本【候选待实验】。
- **effect-aware**：写面 mutex 的持有期必须覆盖完整临界区，不得为提前释放而拆分临界区。
- **外部参照**：Go `x/sync/semaphore` Weighted / errgroup `SetLimit`、Java `Semaphore`、Tokio permit drop 释放语义【一手已核，§9.1】；GNU make jobserver 跨递归进程单一令牌池 + 错误路径也必须归还令牌、少还/多还顶层报错【一手已核，§9.2】；Ninja pools 命名 depth 池 / `console` depth=1 互斥 / 超 depth 延迟排队【一手已核，§9.2】；Airflow pool 槽位回收 / Dask worker 槽归还【前轮已核，§9.2】。
- **签名侧守卫（trackB-EXEC-signatures）**：任何退出路径（错误/取消/超时）都 release；许可泄漏永久亏空须可检测可告警；二元互斥面只放共享可写资源，只读任务不进互斥池；池 depth 不超全局并行上限；无争用池不建模；N 初值探针标定不默认等于核数。

### SIG-S18 · 死锁 / 锁序反转

- **检测模式**【前瞻+静态】：多池申请顺序任务间不一致；hold-and-wait 持写锁等其它池；资源等待成环；无全局资源秩；节点无 deadline / 看门狗。
- **测量方法**【运行时夹具】：构造相反锁序对与等待环，检出时长与等待链报告；持写锁等待其它池样本审计；计划边表 / 资源秩表可打印。
- **解法**：全局秩升序申请；写锁不 hold-and-wait；计划期 DAG 环 + 运行期等待图环双检；节点独立 deadline + 看门狗；超时独立退出档。
- **正确性守卫**：环 / 反转夹具必须检出；中止轮次不汇总成完整绿；推断依赖边不进正式 DAG；等待超预算响亮报错点名。
- **证据分级**：现状无 DAG / 无等待图【静态确证 · 前瞻风险】；环检出行为【候选待实验】。
- **effect-aware**：故意串行链（build→dist 消费门）保持串行，不在死锁避免优化中拆错顺序。
- **外部参照**：Oracle Multithreaded Programming Guide 锁层级全序 + 自死锁防护（最常见死锁是请求自己已持有锁；持锁时不调用可能回路进本模块的外部函数）、Cornell CS2112 locking level 前置条件、Java `Lock.tryLock()` 回退 / `lockInterruptibly` 可中断退出、Go `Acquire(ctx,n)` 带上下文可取消等待【一手已核，§9.1】；K8s Lease `ReleaseOnCancel` 临界区保护、Zuul shared queue serial manager【前轮已核，§9.2】。
- **签名侧守卫（trackB-EXEC-signatures）**：一次性申请（多资源先 try-acquire 全部，任一不可得即释放已持回退，不持其一等其二）；全序申请禁 AB/BA 环；临界区最小化（持锁段无外部调用/慢 I/O，回调不得回路同一互斥体）；可重入按进程树/env 祖先判定；回退后重试须基于重新核验的状态，不沿用持锁前假设。

### SIG-S19 · 外部 rate-limiter 缺接线 / 超限伪装通过

- **检测模式**【静态+运行时】：外部 API 调用无速率限制器 / 令牌桶；超限排队被静默吞；外部不可用被当缓存命中复用；本地 CPU 池口径误套到外部配额；令牌耗尽仍跳过应跑调用。
- **测量方法**【运行时】：调用计数 / 令牌余量 / 超限拒绝数；外部降级单列读数；本地池与外部池记账分开审计。
- **解法**：外部池独立建模（E-API 令牌桶）；超限排队或拒绝可见化；外部不可用 ⇒ unsupported 不折绿；令牌桶容量对齐外部约定；本地不建分布式协调。
- **正确性守卫**：外部降级单列不计干净通过；本地池与外部池不混用配额；token 耗尽不跳过；外部配额以远端限流为准。
- **证据分级**：本仓外部调用面现状待审计【静态待补】；超限行为【候选待实验】。
- **effect-aware**：模型席位翻译属语义路，缺模型必须 blocked/unsupported，不得靠限流兜底假装已理解（对齐冻结企划 A 段纠偏口径）。
- **外部参照**：Guava `RateLimiter` SmoothBursty（存许可折算秒数、支持突发）/ SmoothWarmingUp（冷状态平滑预热、闲置回冷）客户端节流远端服务器【一手已核，§9.1】；令牌桶概念（桶容 b、按速率 r 补令牌、满则丢弃、不足不合规、可排队延后或拒绝）【概念引用，形式化变体未核】；本地并发闸与远端限速分池计数，K8s Resource Quotas 为正交参照【前轮已核】。
- **签名侧守卫（trackB-EXEC-signatures）**：限速失败不得冒充本地并发耗尽；拒绝/延后须显式三态（未完成/不可信），不记通过；突发容量与稳定速率分参，预热参数按远端容忍度探针标定；重试计入速率预算不得绕过限速器；单进程内限速即可，多进程共享配额需外部计数，本仓不臆造分布式一致性。

### 8.1 签名 ↔ 既有签名衔接

| 新签名 | 衔接既有签名 | 关系 |
|---|---|---|
| SIG-S17 | SIG-S03（锁粒度过粗 + contention 无观测）、SIG-S16（非原子写面汇总） | 资源记账与释放保证的底层原语 |
| SIG-S18 | SIG-S04（DAG 环 / 锁顺序死锁） | 同一攻击面在执行层的落地守卫 |
| SIG-S19 | SIG-S07（资源超配）、SIG-X4（运行时病静态不可见） | 外部资源面与本地资源面分界 |

---

## 9. 借源映射：借用原语层 vs 我们的信任/契约层（Main 补充·借源不 reinvent）

> 原则：**并发 / 互斥 / 限速 / 失效追踪等工程原语直接借已验证参考实现，不重新发明；创新只集中在构建系统没有的信任与契约层**（§9.3）。每条标注一手核实状态：【一手已核】=本轮或前轮读到官方文档/源码；残余无源项列 §9.4 / §11.2，不臆造链接。

### 9.1 语言级 / 框架级原语（trackB-EXEC-resource-models 一手已核）

| EXEC 组件 | 借用原语 | 参考实现 | 对应 SIG | 一手 URL | 核实状态 |
|---|---|---|---|---|---|
| P-CPU 计数信号量 | 加权计数信号量；`Acquire(ctx,n)` 阻塞至可用或 ctx 取消，失败计数不变；`TryAcquire` 非阻塞 | Go `x/sync/semaphore` `Weighted` | SIG-S17 | https://pkg.go.dev/golang.org/x/sync/semaphore | 一手已核 |
| P-CPU 并发上限 | group 活跃 goroutine 达限阻塞；首错共享 ctx 取消；limit 组活跃期不可改 | Go `errgroup.SetLimit(n)` | SIG-S17 | https://github.com/golang/sync/blob/master/errgroup/errgroup.go ；https://pkg.go.dev/golang.org/x/sync | 一手已核 |
| P-CPU / P-DB-WRITE | 计数信号量；`tryAcquire` 不可用立即 false 计数不变；计数 1 即互斥排他锁；公平策略下 barging 语义需注意 | Java `Semaphore` | SIG-S17/S18 | https://docs.oracle.com/en/java/javase/25/docs/api//java.base/java/util/concurrent/Semaphore.html | 一手已核 |
| P-CPU / P-DB-WRITE | permit 释放 = drop `SemaphorePermit`；`close()` 停发新许可并唤醒等待者，不回夺已发许可；AcqRel 内存序 | Tokio `Semaphore` | SIG-S17 | https://docs.rs/tokio/latest/tokio/sync/struct.Semaphore.html ；https://github.com/tokio-rs/tokio/blob/master/tokio/src/sync/semaphore.rs | 一手已核 |
| P-DB-WRITE 单写者 | `Semaphore::const_new(1)` 保护 DB insert/update 互斥 | Tokio 单许可示例 | SIG-S17 | 同 Tokio Semaphore 文档 | 一手已核 |
| P-MEM 配额 | 动作声明资源需求（cpu/memory）；`HOST_CPUS`/`HOST_RAM` 乘减表达式；资源估计官方自述 very crude | Bazel `--local_resources` / resources 标签 | SIG-S17 | https://bazel.build/reference/command-line-reference ；https://bazel.build/docs/user-manual | 一手已核 |
| E-API 限速器 | 客户端节流远端服务器；`SmoothBursty` 存许可折算秒数支持突发；`SmoothWarmingUp` 冷状态平滑预热；`acquire` 阻塞到可放行 | Guava `RateLimiter` | SIG-S19 | https://guava.dev/releases/17.0/api/docs/com/google/common/util/concurrent/RateLimiter.html ；https://github.com/google/guava/blob/master/guava/src/com/google/common/util/concurrent/SmoothRateLimiter.java | 一手已核 |
| 死锁避免 · 锁序全序 | 建锁层级（lock hierarchy），所有线程按指定顺序获取；严格顺序非最优，重获后须重新核验状态 | Oracle Multithreaded Programming Guide | SIG-S18 | https://docs.oracle.com/cd/E37838_01/html/E61057/guide-35930.html | 一手已核 |
| 死锁避免 · 锁序定义 | 锁序 `<`；只允许获取比所持锁序更高的锁；方法锁级别前置条件 | Cornell CS2112 同步讲义 | SIG-S18 | https://www.cs.cornell.edu/courses/cs2112/2018fa/lectures/lecture.html?id=synchronization | 一手已核 |
| 死锁避免 · tryLock 回退 | `tryLock()` 拿不到立即/超时内 backing out；`lockInterruptibly` 可被中断退出 | Oracle Java Tutorial Lock Objects | SIG-S18 | https://docs.oracle.com/javase/tutorial//essential/concurrency/newlocks.html | 一手已核 |
| 抢占正交参照 | PriorityClass 按优先级驱逐低优 Pod；非抢占类排在队列前但不驱逐他人 | K8s PriorityClass/preemption | S-5（策略层，非 EXEC） | https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/ | 一手已核（前轮） |
| 写面租约字段模型 | leaseDuration / renewDeadline / retryPeriod + resourceVersion CAS；`ReleaseOnCancel` 临界区保护 | K8s Lease / client-go leaderelection | SIG-S18 | https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/ ；https://github.com/kubernetes/client-go/blob/master/tools/leaderelection/leaderelection.go | 一手已核（前轮） |

### 9.2 构建系统借源映射（Main 登记清单；状态逐条标注）

| 借用原语 | 参考实现 | 对应 S-EXEC 组件 / SIG | 一手 URL | 核实状态 |
|---|---|---|---|---|
| 跨递归子进程封顶的令牌协议：顶层 `make -j N` 管道发 N−1 令牌 + 自留 1 隐式槽；`--jobserver-auth=` 经 MAKEFLAGS 传递归子 make；新目标前阻塞取令牌、结束写回；错误路径也必须归还；少还/多还顶层报错 | GNU make jobserver 令牌协议 | P-CPU 计数信号量跨进程封顶；许可泄漏防护；SIG-S17 | https://www.gnu.org/software/make//manual/html_node/Job-Slots.html ；https://make.mad-scientist.net/papers/jobserver-implementation/ ；https://www.gnu.org/software/make/manual/make.html ；https://manpages.ubuntu.com/manpages/focal/man1/make.1.html | 一手已核（trackB-EXEC §1.1；GNU make 4.4 手册 + 实现论文） |
| 命名池 depth；默认池 depth=0 无限；预定义 `console` 池 depth=1 独占 stdin/stdout/stderr = 写/控制台互斥；超 depth 边延迟排队，完成扣减 `current_use_` | Ninja pools | P-DB-WRITE mutex 与命名池清单；SIG-S17 | https://ninja-build.org/manual.html#pools ；https://deepwiki.com/ninja-build/ninja/5.1-rules-and-pools ；https://deepwiki.com/ninja-build/ninja/5-state-management | 一手已核（trackB-EXEC §1.2；源码锚点 `src/state.h`、`src/state.cc`；Ninja 1.1 pools / 1.5 console） |
| 不可变 SkyKey + 逐节点精确依赖追踪 + 最小失效反向闭包；变更剪枝（新值同旧值则下游复活） | Bazel Skyframe | S-1 DAG 节点依赖追踪 + S-4 缓存失效语义；SIG-S06 | https://bazel.build/versions/8.0.1/reference/skyframe | 一手已核（前轮 trackB §1.1） |
| 动作资源需求声明 + 本地/远程/动态执行；RE 分发多机 | Bazel `local_resources` / RBE / 动态依赖 | P-MEM/P-CPU 配额；S-8 放置分层 | https://bazel.build/remote/rbe ；https://bazel.build/reference/command-line-reference | 一手已核（前轮 + EXEC） |
| red-green / try-mark-green：改动输入向输出反向重算；中间查询与上次指纹相同即停（backdating）；128 位稳定 `Fingerprint` 跨会话可比；指纹缺失/任一字段变化 ⇒ dirty 向上传播；增量目录定稿后永不修改（私有版本目录 + 重命名发布，旧版只读保留）；不可读/缺失 ⇒ 按 dirty 全量重算（fail-closed，不臆造新鲜） | rustc 增量编译（cargo fingerprint 同口径） | S-4 缓存跳过与 fail-closed 保守方向；SIG-S06 | https://rustc-dev-guide.rust-lang.org/queries/incremental-compilation-in-detail.html ；https://doc.rust-lang.org/nightly/nightly-rustc/cargo/compiler/fingerprint/index.html ；https://doc.rust-lang.org/nightly/nightly-rustc/src/cargo/compiler/fingerprint/mod.rs.html ；https://doc.rust-lang.org/stable/nightly-rustc/src/rustc_incremental/persist/fs.rs.html | 一手已核（trackB-EXEC §3.1；rustc 生产增量编译） |
| 边改边算：查询纯函数 memoize；新输入到达先取消挂起中的长查询（防读到不可重复读的不一致快照）；全局 revision bump，在算线程发现计数递增即抛特殊取消值，边界层捕获转 `Result<T, Cancelled>`；`CancellationToken` 可按本地库取消特定查询 | salsa + rust-analyzer 增量计算 | S-13 在飞任务取消交接；cancel_point 契约；SIG-S08 | https://rust-analyzer.github.io/book/contributing/architecture.html ；https://rust-analyzer.github.io/book/contributing/guide.html ；https://docs.rs/salsa/latest/salsa/ ；https://github.com/rust-lang/rust-analyzer/blob/master/crates/ide/src/lib.rs | 一手已核（trackB-EXEC §3.2；rust-analyzer 生产使用，salsa 0.27/3.0 线支持并行查询） |
| 测试层「改哪测哪」：影响分析选最小必要集；不可推断 safe fallback 跑全部 | MS TIA（Test Impact Analysis） | S-4 跳过口径 + 不可推断回退全量；SIG-S06 | https://learn.microsoft.com/fil-ph/Azure/devops/pipelines/test/test-impact-analysis?view=azure-devops | 一手已核（前轮 trackB §3.2） |
| 测试层「改哪测哪」：运行期覆盖依赖库；首轮全量建库；上次失败恒重跑；未追踪静态资源/外部服务 | testmon | S-4 选择输入口径 | https://testmon.org/ | 一手已核（trackB-EXEC §4） |
| 测试层「改哪测哪」：基于 git/hg 变更文件找相关测试；**要求静态依赖图，不支持动态 require**；同族 `--changedSince` / `--lastCommit` / `--findRelatedTests` | Jest `--onlyChanged`（`-o`） | S-4 跳过口径；SIG-S06；动态导入盲区对照 | https://jestjs.io/docs/30.4/cli | 一手已核（trackB-EXEC §4；动态依赖不支持与本仓 tsx 动态导入盲区同形） |
| 反向依赖集合：`rdeps(u, x[, depth])` 在宇宙 u 传递闭包内求 x 反向依赖，可选深度上限；Sky Query `allrdeps` | Bazel rdeps | S-1 依赖边反向闭包（impact 闭包同构） | https://bazel.build/versions/8.7.0/query/language ；https://bazel.build/versions/9.2.0/query/guide | 一手已核（trackB-EXEC §4） |
| affected 图 + 输入模式声明 + 本地先于远程降级顺序 | Nx affected | S-1/S-4 选择与降级口径 | https://nx.dev/docs/features/ci-features/affected | 一手已核（前轮 trackB §2.1） |
| 池槽位隔离与并发上限；路径权重聚合（近似，非原生关键路径优先） | Airflow Pool / `max_active_tasks` | P-LOCAL-BUDGET 隔离池；S-2 排队序（策略层） | https://airflow.apache.org/docs/apache-airflow/2.0.1/concepts.html | 一手已核（前轮） |
| 用户优先级 + FIFO + worker 槽回收；work-stealing 列远期 | Dask.distributed | 槽位归还记账；S-5 策略层参照 | https://distributed.dask.org/en/stable/priority.html ；https://github.com/dask/distributed/blob/main/distributed/stealing.py | 一手已核（前轮） |
| 共享队列串行化保护共享状态；投机并行 + 失败回退重测 | Zuul Serial/Dependent manager | P-DB-WRITE 写面串行队列；S-3 失败回退 | https://zuul-ci.org/docs/zuul/latest/config/pipeline.html ；https://zuulci.org/docs/zuul/latest/gating.html | 一手已核（前轮） |
| 队列并发上限 + 组内去重；在跑者取消取决于安全取消点 | GitHub concurrency group | S-7 节奏合并参照；cancel_point 守卫 | https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency | 一手已核（前轮） |
| 放置策略（本地轻聚簇/重活打散）；gang 调度 | Ray Placement Group PACK/SPREAD | S-8 放置分层；S-6 重型任务配额 | https://docs.ray.io/en/latest/ray-core/scheduling/placement-group.html ；https://docs.ray.io/en/latest/ray-core/scheduling/index.html | 一手已核（前轮） |

### 9.3 我们的创新层（构建系统没有，不归借源）

> 以下四件是 AgentIO 相对通用构建/测试系统的**新增信任与契约层**；EXEC 原语为其服务，但创新点不落在原语层。

| 创新层 | 内容 | 与构建系统的分界 | 对应既有冻结口径 |
|---|---|---|---|
| **trust-gated scoped 验证** | 以 holes=0 + fail-closed 继承为信任门槛，把 scoped 验证结果升级为「已验证提交」；信任不达标即回退全量 | 构建系统缓存只信 hermetic 动作输入；不评价「生成代码是否被契约覆盖无洞」这层信任 | §10.7⑤；S-4；M3′ 契约；三兜底 (b) |
| **契约充当依赖图来源** | contract 是 agent 代码的 BUILD 文件：任务依赖边、读面/写面分类、资源请求均从契约派生，而非命令文本反推 | 构建系统依赖图来自源码 import/构建标签；本仓依赖图来自模型产物与契约台账 | S-1 依赖边；S-2 能力分类；M7 锚点口径 |
| **单写者 / 证据台账** | 写面单写者互斥 + 证据台账（owner_card / 快照时点 / 释放记录 / 三态读数）落账可追溯；未跑不进通过计数 | 构建系统关心产物正确性；不维护生成-验证-收口全链证据归因台账 | SIG-S16；三兜底 (a)(c)；S-12 对账 |
| **外部 API 速率 / 令牌池** | 模型席位与外部服务的独立限速/令牌桶池，与本地并发闸分轴计数；外部不可用 unsupported 单列 | 构建系统默认离线 hermetic 执行，无远端 API 配额概念 | E-API；SIG-S19；§0.3-4 |

### 9.4 未核实沿用

> **无源 / 未核实（保留边界，探针阶段实测，不臆造 URL）**：MCP 规范专属 slot/速率规格；Buck2 本地资源信号量（RE 侧资源分配未在 OSS 文档读到本地池模型）；Dask/Ray 内存准入细节；leaky bucket / GCRA / fixed·sliding window 形式规范；i5-12500H 本机核数/频率/温度基线与 16GB 占用曲线。前轮沿用未核实：Airflow 原生 CPM；Ray 新版任务优先级；商业 PTS 内部模型与命中率。

---

## 10. 待 Main 裁决分歧清单（草案不代裁）

| # | 分歧点 | 选项 / 现状 | 【建议】倾向 |
|---|---|---|---|
| 10.1 | P-CPU 池容量：固定核数上限 vs S-6 自适应档位 | 固定简单；自适应三输入（RSS/温度/句柄） | 起步 jobs ≤4【建议】，容量档位交 S-6 反馈驱动；下限保护常驻 |
| 10.2 | P-DB-WRITE mutex 粒度：单仓单写者 vs 按资源面细分 | 现行全局重活锁；SIG-S03 长期位按资源面拆 | 一期单写者 mutex；资源面拆分随 S-10 长期位评估 |
| 10.3 | P-MCP slot 容量取值与外部不可用降级口径 | 现行 MCP 门 #3 实测 122.4s；slot 数未登记 | 容量待探针标定；外部不可用 unsupported 单列，不折缓存命中 |
| 10.4 | E-API 令牌桶：本地记账 vs 远端限流为准；超限排队 / 拒绝 / 降级 | 本地无外部调用面审计 | 以远端限流为准，本地令牌桶只做可见化排队；超限拒绝可见化 |
| 10.5 | 写面 acquire 失败语义：立即 fail vs 排队等待预算 | 排队可能掩盖写面竞争；立即 fail 归因清晰 | 写面不越预算排队；立即 fail + 点名持有者，回滚当前 part |
| 10.6 | 资源秩表与任务资源字段 schema 权威住处 | 新表；S-2 能力标签同源 | 随 S-2 一处登记，EXEC 只读消费；schema 字段集待裁 |
| 10.7 | 施工任务（build-part）是否同 P-CPU 池 vs 独立建造池 | 编译段与验证段负载形态不同 | 一期同池 + 类型标记；池负载分化后再拆池 |
| 10.8 | 抢占与 permit 归还交接点（cancel point 契约） | 现行无抢占机制 | 临时变异先还原、写锁释放、快照落账后为可取消点；契约随 S-5 冻结 |
| 10.9 | 池观测台账是否进 `run_events` | S-10 contention 台账长期位 | 一期池计数 / 等待 / 释放事件入诊断读数； contention 排序长期 |

---

## 11. 诚实边界与待补项

### 11.1 贯穿边界

1. **信号量 ≠ 抢占**：准入并发与优先级中断是两层；不得用信号量队列序冒充抢占决策（§4.1）。
2. **外部 vs 本地**：本地池不建分布式协调；外部配额以远端为准；两套记账不混（§3.2）。
3. **不过度建模**：无争用不建池；廉价 smoke/commit 不占独立信号量（§3.3）。
4. **非纯静态**：池泄漏、死锁等待环、超限退化均为运行时嫌疑，需探针 / 夹具复核；静态形状审查不替代运行时证据（SIG-X4）。
5. **effect-aware**：写面串行与故意串行链是正确性约束，资源优化不得拆错顺序（SIG-X1）。
6. **fail-closed 总纲**：申请失败 / 外部不可用 / 输入不全 ⇒ 保守方向，绝不折绿（三兜底 (b)）。
7. **借源不 reinvent，创新不越层**：并发 / 互斥 / 限速 / 失效追踪原语直接借已验证参考实现（§9.1/§9.2）；信任门槛、契约依赖图、证据台账、外部令牌池属我们的创新层（§9.3）；不把信任层判定下沉成原语参数，也不在原语层重复发明构建系统已有的并发语义。

### 11.2 待补 / 待实验（不得当已发生假绿）

- **一手背书已闭合**：§9.2 七项构建系统借源（make jobserver / Ninja pools / rustc red-green / salsa+rust-analyzer 取消在飞 / testmon / Jest `--onlyChanged` / Bazel rdeps）与 SIG-S17/18/19 签名侧外部先例均已按 trackB-EXEC 两份报告回填 URL 与核实读数。
- **残余无源项（探针 / 对接阶段补，不臆造 URL）**：MCP 专属 slot/速率规格；Buck2 本地资源池；Dask/Ray 内存准入细节；leaky bucket/GCRA/窗口算法形式规范；本机核数/温度/16GB 占用基线；远端各 API 实际配额上限（对接时读官方配额文档标定）。
- **池容量与拐点**：jobs 上限、RSS 水位线、MCP slot、令牌桶容量均为方向建议，待隔离 worktree / 聚焦子集探针标定后由 Main 冻结（对齐 §13.3 标定义务）。
- **运行时嫌疑待插桩复测**：写面竞争、池泄漏、等待环、超限退化、句柄耗尽——均为候选待实验，未在隔离夹具执行。
- **外部调用面现状未审计**：E-API 池建模基于 Main 登记口径；本仓实际外部调用清单待 S-2 / 审计 A 补全。
- **阈值不冻结**：本草案所有数值起步值不进冻结企划；Main 复核冻结后再落阈值表。
- **行号锚点**：HEAD `5cee21ff`；施工前在干净基线重导；在途 G-2 工作树改动不在评估范围。

### 11.3 落地边界

- 本草案为 S-EXEC 执行模型设计输入，不构成准入 / 退场判据，不触发任何施工；阶段 1 收口由写者在途，本路不碰主仓。
- S-A 批次内 EXEC 原语随 S-1 / S-6 / S-13 同批落地（§13.4）；S-5 抢占、S-10 租约台账属 S-C 长期位。
- 草案经 Main 复核冻结后，方可写入冻结企划 §13 新增子节；冻结企划正文本轮未改。
