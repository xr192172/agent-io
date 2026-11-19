# PITFALLS.md — 撞门与故障处置

> 撞到再查。每条只保留可搜索的症状和可执行对策；历史取证在 Git/ledger，不在本表堆过程。

| # | 症状 | 对策 |
|---|---|---|
| P1 | 新文档被 `docs/*` 忽略，Git 看不到 | 把当前基线文件列入 `.gitignore` 例外；不要对过程稿长期加例外 |
| P5 | 写闸报文件没有 claimed 卡 | 每个有节点的目标文件都要真实 publish/claim；todo 卡或别人的卡不替代 |
| P7 / P16 | `judgement_ref` 指向存在/文本类判据被计划闸拒绝 | 用有独立行为预期的判据或现有测试承载，不靠文件存在冒充验收 |
| P9 | 零符号文件使用 `untouched_default` 报缺快照 | 零符号文件只写明确 entries；不要伪造冻结符号集 |
| P12 | complete 的 evidence 数组/字段被拒 | 传单个对象；阅读证据用 `{kind:'reading',command,observed,at}`，形状以当前 schema 为准 |
| P13 | `decision.update` 缺 `summary` | 带当前完整 summary；只加/删一条判据优先 `expectation.add/remove` |
| P15 | `source-has` 被 import 或注释误满足 | 针写真实调用形态；更可靠的逻辑行为交给测试/行为判据 |
| P17 / P22 | 无卡写账门红，或新文件留下 `card_id=NULL` | 新文件先入册再写；不要抬基线，也不要事后补登记冒充当时有卡 |
| P24 | verify 报 dist 比 src 旧 | 先 `npm run build`；verify 不负责 build |
| P26 | `decision.update` 整块替换吞掉旧判据 | 单条操作用 expectation.add/remove；整批净缩按闸要求逐条 `drop_ok` |
| P29 | 证据只存在某次会话，无法复算 | 核销前把命令、读数、对象和观察写入测试/台账/commit；会话记忆不是证据 |
| P30 | 删除 op/分支后原不变量无人接管 | 删除前列出原守卫及继任检测点；先补会红的反例再删 |
| P31 | `mustNot` 因折行或空白变化漏报 | 不用整段多行文本做禁令；用结构断言或行为反例 |
| P32 | 判据指向未来符号，claim 报 unknowable | 先移除不可判项或改成当前可判失败的契约；施工后用真实行为证据验收，不能绕状态机 |
| P34 | 手改 dist 做消融后，build 没覆盖它 | 不用 dist 做手写消融；从 src 修改并干净重建，证明产物来自本次源码 |
| P35 | 回执首行没有关键结果 | 关键结论放首行；结构化明细同时放 `---DATA---` |
| P36 | 空 cases 被当成全过 | 写端与内存构造都拒绝空契约；缺独立预期时标 unsupported，不自动通过 |
| P37 | 相对 `project_dir` 写到别的项目 | 传当前项目的绝对路径，并读回确认落点 |
| P38 | 新文件的判据抛 ENOENT，被记 unsupported | 判据要把缺失表示为可判失败；真正的行为验证再由测试/执行核承担 |
| P39 | 新建 src 文件后派生字段未刷新 | 运行既有 `project-actual-fields` 派生入口，再判据复核 |

## 环境与进程

- 软链/junction/物理路径是否同一处，只问 `scripts/lib/path_identity.mjs#samePath`；脚本入口静默 exit 0 不是通过。
- 多卡重活共用 `heavy.lock`；锁被占时不要并行跑测试后拿假红归因。
- Windows 上 `child.kill()` 不一定终止 npm/cmd/node 进程树；需要终止整树并确认没有孙进程继续写盘。
- JSON 入参写 UTF-8 无 BOM 文件后用 `--input`；不要依赖 PowerShell 内联引号。

新增条目只写当前仍可复现的症状、修法与权威代码位置；编号不复用，历史故事留在 Git。
