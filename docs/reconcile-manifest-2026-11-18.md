# 对账清单（reconciliation manifest）· 2026-11-18 · lead
# 用途：单 ledger 工具落地后，逐条执行状态翻转（closeRow via tool）。
# 纪律：只收有直接证据（commit 或实测读数）的行；不确定/部分完成的留 active。
# 格式：<ref_id> | disposition | 证据（commit/读数）

# ── 引擎主体（本会话链内落地）──
T-#LEDGER-ENGINE | done | L1 410bd8b1 · L2 fd1c54d2 · L3 779c1284 · L3b d070c408+fc2c409a；账本 673 行、视图 current、写闸拒直写
T-#PATROL-S4 | done | 86751739；三方对账实跑 + 6 用例消融
T-#KIND-CALIBER | done | 86751739；9 处抄数改引用式 + 4 用例
T-#E4-DEAD-EXPORT | done | 86751739 链；首次狗粮全链实测
T-#H1-T48-CARDS | done | 4 张 t48 卡全收口（含卡级接管 16 判据表态）5ee226ab 链
T-#A12-PLAN-EXIT | done | 前提证伪销账（接线 11-09 已在）5ee226ab 链
T-#N7-FIRST-WRITEOFF | done | 元问题修复：N1 三条 + E4，全 S
T-#N1-LEDGER-SYNC | done | runtime kind 修复 + 三方对账 S4 落地
T-#N2-REGISTRY-UNREACHABLE | done | 运营面已清（22 条注销，67c7c896）；系统性测试隔离另账（jest 夹具归属）
T-#N4-CONTRACT-COMPILER-WIRE | done | design_line action=compile 8837416c
T-#N5-JUDGE-PORT | wontfix-falsified | 前提证伪：judge_port 10-21 已实现且 6 文件消费（ff404203）
T-#RELEASE-R55 | done | push 全通 + 新机器五步实测（git-bash 逐字）
T-#INC-JOBS | done | --jobs N 2.04×（41b6029b）
T-#INC-TSC | done | --incremental + tsBuildInfoFile（41b6029b）；build 侧 --incremental false 修正 ddd9dd2c
T-#INC-COGNITION | done | dsl_rev 复用（41b6029b 链）
T-#INC-JUDGE-SEL | done | 100s→8.3s 选量 12×（95a51368）
T-#INC-GENDB | done | 2150ms→260ms 签名 8.3×（a46199b1）
T-#INC-VERIFY | done | impactOfChanged 三集合并 + 4 只读门继承（a46199b1）
T-#MUTATE-DET | done | 确定性排序 + 存活体挂账（9cd51d12）
T-#SOFT-KIND-RATCHET | done | existence 配额轮转 + 棘轮（0262117d）
T-#HEARTBEAT-DERIVED | done | derived scope 一处修 9 工具（a61ccde2）
T-#JUNCTION-SCRIPT-NOOP | done | verify/gen_cognition/mutate/lint-prose 四脚本 samePath 修复；全仓 grep 排查完毕（未修者均无 main 守卫问题）
T-#EXCLUDED-EMPTY-PATH | wontfix-not-present | 结构门全绿（573/0），字符串形态不在当前册（3e553199）
T-#WRITEENDS-STATIC-GAP | done | saveDesignSheet 平行静态守 6/6（4544501d）
T-#REVIEWQ-WIRING | done | completeTask 接线 + readReviewQueue 四态（14e55934）

# ── 规则行（被后续卡根治）──
R25 | done | interim writes:true 已随 T-#HEARTBEAT-DERIVED 根治回退（a61ccde2）
R31 | done | todo.md"第二份规格库"病已由 L3 派生视图根治（779c1284；手改被闸拦——实证多次）
R55 | done | 索引/垃圾无限增长 → gc 三类回收（0eff5f7a，3078→291MB）；发布链路 → T-#RELEASE-R55
R69 | done | verify 全量门耗时 + judge-cache 空 → INC-JUDGE-SEL（95a51368）
R71 | done | verify:changed 假绿入口 → INC-VERIFY impact 三集合并（a46199b1）

# ── 早期普查行（ Census 交付即使命）──
T-#BKLOG | done | 任务源普查交付（backlog-census-2026-11-17-{ds,hy}.md），已消费进 P1 排序

# ── 明确保持 active 的（部分完成/常设纪律/等外部）──
# T-#FACE-STABILITY / T-#TEN-DISCIPLINES / T-#SELF-DOGFOOD   —— 常设纪律
# T-#MINIPROGRAM-ADAPT / T-#LANG-ADAPT                        —— 等真实项目/对方队
# T-#A8A9-CROSS-BOOK                                          —— 批 11-17 在途
# T-#ENGINE-AUDIT / T-#MARKET-AUDIT                           —— P0 done，P1 结构项余（变异入门/provenance/D4）
# T-#BOOK-LIFECYCLE / T-#MESH-QUESTBOARD / T-#DOCS-SUNSET / T-#TWO-TEAM-SPLIT —— 立项在途
# T-#N3-DUAL-SHEET-CARDS / T-#PLAN-REF-CROSS-BOOK / T-#CANVAS-CROSS-BOOK —— 批 16 卡收敛
# T-#LEDGER-STATE-HYGIENE / T-#DIGEST-LOAD-CAP / T-#E10 / T-#E12 / T-#SHEET-DIFFSCOPE —— 新挂/未动
