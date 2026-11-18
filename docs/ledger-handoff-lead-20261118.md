# ledger 交接 · lead 侧 9 条挂账（待引擎收录）

> 2026-11-18 由 lead（本检出点 D:\dev_hzy\agent-io）产出。docs/todo.md 是引擎派生视图，本检出点 tasks.db 为空库
> （引擎真相在另一检出点、不随 git 迁移），故这 9 条**不在引擎里**——本文件把它们以可直接
> `hangRow` 的形状交付，请引擎侧守席按行收录（每行 JSON 即 HangRowInput 去掉 by 字段后的内容；`by` 建议
> 记 "lead:handoff-20261118"）。收录后请在本文件头部标注"已收录 <date> <refIds>"并销本文件或留指针。
> ★ 其中前 3 条已随 git 历史进入 docs/todo.md 视图正文（6051c68 手挂 6 条中 3 条来自 jfacts 分支），
>   若引擎已从视图 importer 收到过，收录时同 ref_id 会撞部分唯一索引——按重复处理跳过即可。

## A · jfacts 分支随卡交付的 3 条（正文在 todo.md，内容详 commit 285e00d）

```json
{"refId":"T-#JFACTS-FIELDS-CONSUMER","section":"§I","title":"Java 结构事实的落库必须等真实消费者卡（不许蹭 fields 表）"}
{"refId":"T-#JFACTS-UNRESOLVED","section":"§I","title":"javac 事实无处消化 unresolved_refs（dotted.callchain pending 不因抽取器消解）；21,000 条仓外 receiver 应分类出 pending 而非 resolve"}
{"refId":"T-#ENV-SANDBOX-TEMP","section":"§I","title":"DSH 沙箱 Temp EPERM ⇒ behavior-cases 全体 unsupported；跑门须设 TMP+TEMP 指工作区（os.tmpdir 优先认 TEMP）"}
```

## B · 收尾会话补挂的 6 条（正文详 commit 6051c68 / 9fcae0e）

```json
{"refId":"T-#EXTERNAL-REJUDGE","section":"§I","title":"external 是终态不重判 ⇒ 修判据后存量 external 行不自动更新","problem":"四条路径核清：选行写死 status=pending（symbols.ts:2179/2186）· reopenRefsTo 只重开 resolved/failed（:1301-1309）· schema 迁移只重置 resolved（db.ts:389）· keepUnresolvedPending 只影响 failed 侧。fuintBackend 现存 44,718 external 中无 package-import 误判（卡2 修复后重导，暂无实际失效）","proposal":"第 3 档语义变更（external 终态→可重证结论）独立小卡 + 反例（判 external 后目标文件新增 ⇒ 不重导仍 external）；重导场景不受影响"}
{"refId":"T-#INHERIT-CALL","section":"§I","title":"继承方法裸名调用无解析（getSuccessResult 型）","problem":"fuintBackend 各 Controller extends BaseController 后裸名调父类方法；import/同文件/导入绑定通道均覆盖不了继承作用域。★ 重导实测 getSuccessResult 431 条已 resolved（走通了某条路）——挂账前先复核其解析路径再定是否仍缺能力","proposal":"第 4 档新能力（真实事故面）；反例口径：子类裸名调父类方法必须 resolved + 出 call 边；打断继承链查找即红"}
{"refId":"T-#SQLXML-NATIVE","section":"§I","title":"SQL/XML ts-fallback 降级解析器在 C++ 工具链可用后回切原生 tree-sitter","problem":"本机无 VS C++ Build Tools ⇒ tree-sitter-sql/xml 无 prebuilds 编译不了（双实证）；卡4 走纯 TS 降级（parser=ts-fallback 诚实标注），kernel 原生优先不可用才降级","proposal":"装 Build Tools 后 npm i --allow-scripts 两包 ⇒ 原生自动优先 ⇒ 删 fallback 标记 + 回归确认"}
{"refId":"T-#CLI-BOOL-ARGS","section":"§I","title":"CLI key=value 把布尔 true 当字符串（include_sql_xml=true 静默无效）","problem":"card-mybatis 实测：key=value 传成字符串 true，=== true 不成立；必须 --input JSON。与 PowerShell 吞引号同族不同层","proposal":"布尔 key=value 转换或显式报错；独立小卡 + 反例"}
{"refId":"T-#MYBATIS-TOOLFACE","section":"§I","title":"mybatis_contracts 接 MCP 工具面（现仅验收链消费）","problem":"卡4 裁定本轮只接验收链（⑥ 真跑转绿）；工具面是产品面扩张需独立卡判据","proposal":"先证打断产品入口会红再注册 ToolDef；__CLASS_NOT_FOUND__ 降级不假装"}
{"refId":"T-#MAPPER-EDGE-IMPACT","section":"§I","title":"mapper_statement 边的影响闭包传播（改 XML 波及 Java）","problem":"卡4 已建边（fuintBackend 实测 146 条）+ 建边即对账；但内环波及集尚不沿此边传播","proposal":"波及集计算吸收 mapper_statement 边（第 1 档扩展既有影响计算）；判据：改 mapper XML ⇒ 波及含对应 Java 接口方法；砍边 ⇒ 退回"}
```

## C · 结构性挂账建议（供裁定，非本轮欠账）

```json
{"refId":"T-#LEDGER-CROSS-CHECKOUT","section":"§I","title":"台账引擎真相单机化：tasks.db 不进 git ⇒ 跨检出点/协作时挂账无法互通","problem":"L2 导入的引擎行只在本检出点 tasks.db；另一检出点手挂的行引擎看不到（本轮实测双向断链）；docs/todo.md 指纹锁手改 ⇒ 无法用 MD 互通","proposal":"裁引擎真相的迁移载体：引擎行导出为 git 内 JSON 事件文件（append-only，类似 decision_history 侧车）或 tasks.db 入 git（与「不可重建审计数据」裁定冲突需复议）；跨检出点 source_root 同族问题（T-#DSL-SOURCE-ROOT-STALE）一并裁"}
```
