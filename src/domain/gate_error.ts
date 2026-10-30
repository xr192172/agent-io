/**
 * gate_error —— **闸门规则的唯一事实源**（错误码登记表 + 结构化拒绝载体）。★ **零 import**。
 *
 * ## 为什么住 domain、且必须零 import
 * · **会被判据直接跑**：`behavior-cases` 的 harness 把目标文件**单独转译再 import**
 *   ⇒ 只要有 import 就报 `目标文件加载失败: Cannot find module …`（子代理手册 §8）；
 * · **只有一份**：`write_gate` / `plumbing` / `task_ops` 将来接线时 import 本文件，
 *   不许各自再抄一张码表（抄出去的那份必然与这份漂）。
 *
 * ## ★★ 码的稳定性约定（发布即冻结，本文件最要紧的一条）
 * 码一旦发布 ⇒ **不许改语义、不许复用号**：同一个 code 永远指同一个触发条件。
 * 只许两件事：① **新增码**（追加到族尾，号只增不复用）；② **在 `fix` 里追加说明**（不动 `what`）。
 * 退役一个码 ⇒ 走 `docs/RETIRED.md` 记一条（码 + 现在用什么），**不许**把号让给别人。
 * 理由：码会出现在回执、文档、别人的记忆里 —— 改语义 = 让历史上读到的同一个码指向另一件事。
 *
 * ## `where` 为什么不写行号
 * 行号会漂（本仓一天改几十处）。`where` 只给 `path` + `symbol`（定位到函数），
 * 拿不到符号级锚点的码才给 `messageStartsWith`（现有拒绝文案的**首句**）。两者都跟着代码走，行号不跟。
 *
 * ## 与文档的分工（防第二份事实）
 * 逐条内容**只**住本表；`docs/GUIDE-GATE.md §七` 只登记"族 + 码数 + 指向本表"；
 * `design_line action=rules` **直读本表**渲染（不复制）。判据 `run` 钉住
 * "文档里声明的码数 == 本表里真实码数" ⇒ 文档漂了当场红。
 *
 * ## 现状（本文件只定义、暂未接线）
 * 本轮只落地"码表 + 载体类型"：`write_gate` / `plumbing` / `task_ops` 的拒绝路径**一行未改**
 * （既有拒绝文案逐字不变）。接线是下一批卡的事 —— 接线时**只许**把 `throw new Error(...)`
 * 换成 `throw new GateError([gateRuleOf('E-XXX-NNN')!])`（人读文案保持逐字不变）。
 */

export interface GateRuleWhere {
  /** 实现所在的**仓库相对路径**（唯一认的写法：不要绝对路径、不要行号） */
  path: string;
  /** 实现所在的符号名（函数 / 类）。拿不到符号级锚点的码省略它。 */
  symbol?: string;
  /** 现有拒绝文案的**首句**（用于在源码里定位那条拒绝；不写完整句、不写行号）。 */
  messageStartsWith?: string;
}

export type GateFamily = 'E-PLAN' | 'E-TASK' | 'E-CLAIM' | 'E-CRIT' | 'E-EVD' | 'E-WRITE' | 'E-REASON' | 'E-GENDB';

export interface GateRule {
  /** `E-<族>-<三位号>`。★ 发布后不许改语义、不许复用号（见文件头）。 */
  code: string;
  family: GateFamily;
  /** 触发条件（什么情况下会被这个码挡住） */
  what: string;
  /** 为什么要这条规矩（没有它会坏成什么样） */
  why: string;
  /** 怎么过（可粘贴的做法） */
  fix: string;
  /** 唯一文档落点 */
  doc: string;
  /** 实现位置（不写行号） */
  where: GateRuleWhere;
}

/** 族的展示名（`design_line action=rules` 按族分组渲染时用；族语义的唯一住处） */
export const GATE_FAMILY_LABEL: Readonly<Record<GateFamily, string>> = {
  'E-PLAN': "画布 / 重写计划",
  'E-TASK': "任务闸：A7 身份 / authorize / 前置",
  'E-CLAIM': "claim / start / publish / 状态迁移",
  'E-CRIT': "卡站位 / 建构完整 / 可收口",
  'E-EVD': "收口证据 / 重开账本",
  'E-WRITE': "落盘（语法门 / 根外）",
  'E-REASON': "reason L1–L4 + 现取事实",
  'E-GENDB': "设计 DB 重生成",
};

/** 各族的文档落点（按族统一，逐条不重复；`GateRule.doc` 从这里取） */
const DOC = {
  plan: "docs/GUIDE-GATE.md §4.4（重写计划闸 / 画布）",
  gate: "docs/GUIDE-GATE.md §七（码表；机器源 = GATE_RULES）",
  write: "docs/GUIDE-GATE.md §4.6（覆盖面）",
  gendb: "docs/SUBAGENT-HANDBOOK.md §3.7（设计 DB 重生成必须全量）",
} as const;

/** 实现文件路径（逐条 `where.path` 从这里取：同一路径只写一次） */
const SRC = {
  rp: "src/application/design/db/rewrite_plan.ts",
  wg: "src/application/write_gate.ts",
  di: "src/application/design/index.ts",
  to: "src/application/design/dsl_ops/task_ops.ts",
  cc: "src/application/claim_conflict.ts",
  tm: "src/domain/task_machine.ts",
  ek: "src/domain/expectation_kinds.ts",
  ov: "src/domain/overlay.ts",
  ec: "src/application/refactor/edit/edit_code.ts",
  aw: "src/application/refactor/edit/apply_writes.ts",
  rpl: "src/application/refactor/pipeline/refactor_plan.ts",
  rv: "src/application/observe/reconcile/reason_validator.ts",
  dh: "src/application/design/handlers.ts",
  gc: "scripts/gen-db-check.mjs",
} as const;

/**
 * ★★★ **闸门规则登记表**（唯一事实源）。
 * 顺序 = 族序 + 号序；新增码**只能追加到族尾**（号只增不复用）。
 */
export const GATE_RULES: readonly GateRule[] = [
  {
    code: "E-PLAN-001",
    family: "E-PLAN",
    what: "该文件没有画布 plan/<rel>.plan.json",
    why: "没有画布的改动 = 没通读就想改；写完也没人能验",
    fix: "design_line {action:\"plan\", file:\"<rel>\", entries:[…], apply:true}",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planGaps", messageStartsWith: "没有重写计划" },
  },
  {
    code: "E-PLAN-002",
    family: "E-PLAN",
    what: "画布 entries 为空（0 条改动）",
    why: "0 条改动等于没表态：覆盖判据无从判",
    fix: "至少一条 {anchor:{symbol}, kind:\"rewrite\", detail, judgement_ref, status:\"open\"}",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planGaps", messageStartsWith: "计划里 0 条改动" },
  },
  {
    code: "E-PLAN-003",
    family: "E-PLAN",
    what: "某条 entry 缺 anchor.symbol",
    why: "行号会漂，只有符号名锚得住",
    fix: "给 anchor:{symbol:\"<符号名>\"}（不支持行号）",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planGaps" },
  },
  {
    code: "E-PLAN-004",
    family: "E-PLAN",
    what: "某条 entry 缺 detail（要改成什么样）",
    why: "写不下来的细节 = 还没想清楚",
    fix: "detail 写目标形态（一句话 + 关键签名）",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planGaps" },
  },
  {
    code: "E-PLAN-005",
    family: "E-PLAN",
    what: "某条 entry 缺 judgement_ref（拿什么验）",
    why: "没写判据，改完只能靠自我感觉",
    fix: "judgement_ref:\"decision:<node_id>#<index>\"",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planGaps" },
  },
  {
    code: "E-PLAN-006",
    family: "E-PLAN",
    what: "某条 entry 的锚点已 stale（对不上代码）",
    why: "过期锚点会把改动重放到错位置",
    fix: "重跑 {action:\"plan\", file, sync_status:true} 再核对",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planGaps" },
  },
  {
    code: "E-PLAN-007",
    family: "E-PLAN",
    what: "untouched 里有条目缺 symbol 或 why",
    why: "空理由 = 没表态（看过不等于表态过）",
    fix: "{symbol:\"x\", why:\"看过、不动，因为…\"}",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planUntouchedGaps", messageStartsWith: "untouched 里有" },
  },
  {
    code: "E-PLAN-008",
    family: "E-PLAN",
    what: "用了 untouched_default 却没记 symbols_at_freeze",
    why: "没有快照就判不出\"当时存在哪些符号\"",
    fix: "只在手改画布时撞；重跑 {action:\"plan\", apply:true}（工具自动写快照）",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planCoverageGaps", messageStartsWith: "用了" },
  },
  {
    code: "E-PLAN-009",
    family: "E-PLAN",
    what: "文件里出现冻结之后才有的新顶层符号",
    why: "画布是照旧版本写的，新符号没被表态",
    fix: "重跑 {action:\"plan\", file, apply:true} 刷新快照",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planCoverageGaps", messageStartsWith: "文件里有" },
  },
  {
    code: "E-PLAN-010",
    family: "E-PLAN",
    what: "顶层符号既不在 entries 也不在 untouched（没表态）",
    why: "没表态的符号会被悄悄改坏",
    fix: "二选一：写进 entries（要改），或写进 untouched（不动 + why）",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planCoverageGaps", messageStartsWith: "该文件有" },
  },
  {
    code: "E-PLAN-011",
    family: "E-PLAN",
    what: "judgement_ref 不是规范引用",
    why: "自由文本判不出判据强度",
    fix: "\"decision:<node_id>#<index>\" 或 \"cert:<证>#<检查号>\"",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planJudgementGaps" },
  },
  {
    code: "E-PLAN-012",
    family: "E-PLAN",
    what: "引用解不出 kind（册里无该节点 / 无该下标）",
    why: "判不出强度 ≠ 强度合格",
    fix: "先 edit_dsl 写判据再引用；cert 可补 judgement_kind",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planJudgementGaps" },
  },
  {
    code: "E-PLAN-013",
    family: "E-PLAN",
    what: "判据是存在/结构类（file-exists / symbol-exists / signature-matches / source-has）",
    why: "存在类永远发现不了逻辑错，绿色不代表对",
    fix: "换语义类：behavior-cases / call-exists / edge-absent / run / cert",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planJudgementGaps" },
  },
  {
    code: "E-PLAN-014",
    family: "E-PLAN",
    what: "判据 kind 不在已知分类里",
    why: "不认识的 kind 判不了强度，不假装强",
    fix: "查 src/domain/expectation_kinds.ts 的 KIND_SPECS",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planJudgementGaps" },
  },
  {
    code: "E-PLAN-015",
    family: "E-PLAN",
    what: "depends_on 自指（依赖了自己）",
    why: "自依赖让顺序判定永远无法满足",
    fix: "删掉该项",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planDependencyGaps" },
  },
  {
    code: "E-PLAN-016",
    family: "E-PLAN",
    what: "depends_on 指向本计划里不存在的锚点",
    why: "依赖不存在的条目 ⇒ 顺序无从成立",
    fix: "补一条 entry，或把它移进 untouched",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planDependencyGaps" },
  },
  {
    code: "E-PLAN-017",
    family: "E-PLAN",
    what: "entry 已标 done 而依赖还没 done（顺序被违反）",
    why: "顺序错 = 在赌编译",
    fix: "先做依赖（改签名 → 调用方 → 测试）",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planDependencyGaps" },
  },
  {
    code: "E-PLAN-018",
    family: "E-PLAN",
    what: "依赖成环（没有拓扑序）",
    why: "成环 = 路线不成立，不编一条假的出来",
    fix: "拆成单向依赖",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planDependencyGaps", messageStartsWith: "依赖" },
  },
  {
    code: "E-PLAN-019",
    family: "E-PLAN",
    what: "kind=create 但文件已存在（文件级 create）",
    why: "\"新建\"与\"改现有\"是两件事，混了会覆盖已有的活",
    fix: "改用 kind:\"rewrite\"；或补 anchor.symbol 做符号级 create",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planKindGaps" },
  },
  {
    code: "E-PLAN-020",
    family: "E-PLAN",
    what: "kind=delete 但文件不存在",
    why: "已经是删掉的状态 = 计划过期或路径写错",
    fix: "修路径，或删掉这条 entry",
    doc: DOC.plan,
    where: { path: SRC.rp, symbol: "planKindGaps" },
  },
  {
    code: "E-PLAN-021",
    family: "E-PLAN",
    what: "画布 base.content_hash 与现文件不一致（严格档）",
    why: "对着旧内容写的计划 = 覆盖率最高的那种错",
    fix: "每次 edit_code 前重跑 {action:\"plan\", file, sync_status:true}",
    doc: DOC.plan,
    where: { path: SRC.wg, symbol: "assertSourceWriteRegistered", messageStartsWith: "拒绝落盘（画布过期）" },
  },
  {
    code: "E-PLAN-022",
    family: "E-PLAN",
    what: "action=plan 没给 file",
    why: "一份画布只对一个文件：N 个文件 = N 次 plan",
    fix: "plan 必须带 file（仓库相对路径）",
    doc: DOC.plan,
    where: { path: SRC.di, messageStartsWith: "action=plan 需要" },
  },
  {
    code: "E-TASK-001",
    family: "E-TASK",
    what: "该文件在覆盖它的节点上没有 state=claimed 的卡",
    why: "不领任务就悄悄改 = 没人对这笔改动负责",
    fix: "publish + claim 该节点；★ 一张卡跨 N 文件 = 要 N 张卡",
    doc: DOC.gate,
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（任务闸）" },
  },
  {
    code: "E-TASK-002",
    family: "E-TASK",
    what: "卡的 owner 不是本次 actor",
    why: "改别人的活会覆盖对方的工作 = 真损坏",
    fix: "对方放弃 ⇒ release 再 claim；否则别动该文件",
    doc: DOC.gate,
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（任务闸 · A7" },
  },
  {
    code: "E-TASK-003",
    family: "E-TASK",
    what: "AGENT_IO_ACTOR_STRICT=1 且有 claimed 卡，但本次没传 actor",
    why: "不知道\"谁在写\"，就无法核对这张卡是不是你的",
    fix: "写调用带 actor:\"subagent:<name>\"（与 claim 的 data.owner 一致）",
    doc: DOC.gate,
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（任务闸 · A7 严格模式" },
  },
  {
    code: "E-TASK-004",
    family: "E-TASK",
    what: "authorize 不是合法 scope",
    why: "拼错一个字母会变成\"授权没生效但没人说\"",
    fix: "文法唯一落点 src/domain/scope.ts：files: / nodes: / subtree: / layer: / arch_layer:",
    doc: DOC.gate,
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（按 run 授权）" },
  },
  {
    code: "E-TASK-005",
    family: "E-TASK",
    what: "authorize:\"all\"（把整份 DSL 授权出去）",
    why: "整份授权 = 关闸，而写闸的价值就是\"不领任务不许改\"",
    fix: "写出那一片（例 files:src/application/design/）",
    doc: DOC.gate,
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（按 run 授权）" },
  },
  {
    code: "E-TASK-006",
    family: "E-TASK",
    what: "带了 authorize 但没能覆盖本批（已落回逐文件判定）",
    why: "授权失败必须点名，否则回执看起来像\"已授权\"",
    fix: "核对：全部文件 ⊆ scope，且 scope 内有 owner===actor 的 claimed 卡",
    doc: DOC.gate,
    where: { path: SRC.wg, symbol: "evaluateTaskGate" },
  },
  {
    code: "E-TASK-007",
    family: "E-TASK",
    what: "覆盖该文件的 feature 上某 edge intent 的 requires 里有节点未 done",
    why: "requires 是显式前置：完成 A 才准开始 B",
    fix: "先完成前置（status→done），或 design_intent 用 requires:[] 解除",
    doc: DOC.gate,
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（前置闸）" },
  },
  {
    code: "E-CLAIM-001",
    family: "E-CLAIM",
    what: "claim 一张 done 卡却没给 data.reason",
    why: "重开没有理由，历史就读不出\"为什么又开\"",
    fix: "data:{owner, reason, intent:\"modify\"}",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "claimTask", messageStartsWith: "claim 被拒（重开缺理由）" },
  },
  {
    code: "E-CLAIM-002",
    family: "E-CLAIM",
    what: "L1 卡而 DSL 已建构完整",
    why: "L1 卡的活是\"建构 DSL\"；已完整 ⇒ 没活可干",
    fix: "改走 publish（翻 L2 卡）",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "claimTask", messageStartsWith: "claim 被拒（L1 无活可干）" },
  },
  {
    code: "E-CLAIM-003",
    family: "E-CLAIM",
    what: "cardStanding ∉ {work, violated}（satisfied 只认 intent=modify）",
    why: "领一张没活干、或判不了的卡 = 空转",
    fix: "unknowable→补判据/补索引；blocked→等依赖；satisfied→加 intent:\"modify\"",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "claimTask", messageStartsWith: "claim 被拒（可领性" },
  },
  {
    code: "E-CLAIM-004",
    family: "E-CLAIM",
    what: "state≠candidate 或 owner 非空（且不是重开/接管）",
    why: "CAS：两个代理同时领同一张卡会互相覆盖",
    fix: "别抢；租约到期（TTL 3h）可接管并记 taken_over_from",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "claimTask", messageStartsWith: "claim 被拒（CAS）" },
  },
  {
    code: "E-CLAIM-005",
    family: "E-CLAIM",
    what: "声明的读集与另一张 claimed 卡相交",
    why: "读集相交 = 两边会改同一处，必对撞",
    fix: "拆卡；或用 data.read_set 精确声明真要碰的符号/文件",
    doc: DOC.gate,
    where: { path: SRC.cc, symbol: "claimConflictMessage", messageStartsWith: "claim 被拒（读集冲突" },
  },
  {
    code: "E-CLAIM-006",
    family: "E-CLAIM",
    what: "data.read_set 声明的读集覆盖不到卡上判据点名的符号（读集太小）",
    why: "读集太小 = 冲突判定看不见真实交集",
    fix: "把判据点名的符号写进 data.read_set",
    doc: DOC.gate,
    where: { path: SRC.cc, symbol: "claimConflictMessage", messageStartsWith: "claim 被拒（读集" },
  },
  {
    code: "E-CLAIM-007",
    family: "E-CLAIM",
    what: "data.read_set 形状不符",
    why: "形状不符就现算不了读集，冲突判定退化成空",
    fix: "data.read_set:{symbols:[{file, name}], files:[path]}",
    doc: DOC.gate,
    where: { path: SRC.cc, symbol: "parseDeclaredReadSet" },
  },
  {
    code: "E-CLAIM-008",
    family: "E-CLAIM",
    what: "迁移表里没有这条迁移",
    why: "状态机是唯一权威；随手改态会丢历史",
    fix: "查 src/domain/task_machine.ts 的迁移表；void 先 relaunch",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "assertTransition" },
  },
  {
    code: "E-CLAIM-009",
    family: "E-CLAIM",
    what: "后态判据 0 条 ⇒ 领进 preparing（领了但不能开工）",
    why: "没判据的卡干完也收不了口",
    fix: "补 post 判据后 {op:\"start\"}",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "claimTask", messageStartsWith: "已领取但" },
  },
  {
    code: "E-CLAIM-010",
    family: "E-CLAIM",
    what: "start 时 state≠preparing（或 owner 不是你）",
    why: "start 只用于两段式第二段",
    fix: "一段式直接 claim",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "startTask", messageStartsWith: "start 被拒" },
  },
  {
    code: "E-CLAIM-011",
    family: "E-CLAIM",
    what: "start 时仍 0 条 post 判据",
    why: "判据没补就开工 ⇒ 收不了口",
    fix: "先补判据，再 start",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "startTask" },
  },
  {
    code: "E-CLAIM-012",
    family: "E-CLAIM",
    what: "publish 一张 state=claimed 的卡却没给 data.reason",
    why: "原地换判据要理由（只换 summary+expectations，evidence 保留）",
    fix: "带 data.reason",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "publishTask", messageStartsWith: "publish 被拒" },
  },
  {
    code: "E-CLAIM-013",
    family: "E-CLAIM",
    what: "publish 盖到 done(L2)/void/其它状态的卡",
    why: "已收口 / 已弃做的卡不能悄悄翻新",
    fix: "done⇒reopen→改 decision→publish；void⇒relaunch",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "publishTask", messageStartsWith: "publish 被拒" },
  },
  {
    code: "E-CLAIM-014",
    family: "E-CLAIM",
    what: "原地换判据，但新 decision 没有 post 判据",
    why: "会得到一张收不了口的卡",
    fix: "先补 ≥1 条 post 判据",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "publishTask", messageStartsWith: "publish 被拒" },
  },
  {
    code: "E-CLAIM-015",
    family: "E-CLAIM",
    what: "feature 没有 source_root",
    why: "没有根就判不了后态判据",
    fix: "册子补 source_root",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "requireRoot", messageStartsWith: "该 feature 没有 source_root" },
  },
  {
    code: "E-CRIT-001",
    family: "E-CRIT",
    what: "判据形状非法（kind / 必填 / minItems / 闭集）",
    why: "形状不对就求值不了，等于没有判据",
    fix: "按 src/domain/expectation_kinds.ts 的 KIND_SPECS 补",
    doc: DOC.gate,
    where: { path: SRC.ek, symbol: "validateExpectation" },
  },
  {
    code: "E-CRIT-002",
    family: "E-CRIT",
    what: "判据缺 why",
    why: "说不出理由的验收没人敢删，也没人知道在测什么",
    fix: "why 写清实体 + 数字",
    doc: DOC.gate,
    where: { path: SRC.ek, symbol: "validateExpectation" },
  },
  {
    code: "E-CRIT-003",
    family: "E-CRIT",
    what: "complete 一张 L1 卡但 DSL 建构未完整",
    why: "L1 的收口判据 = DSL 建构完整，不是代码跑通",
    fix: "补 decision.summary + ≥1 条 post 判据",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "completeTask", messageStartsWith: "complete 被拒（L1 建构未完成）" },
  },
  {
    code: "E-CRIT-004",
    family: "E-CRIT",
    what: "L2 卡 isSatisfied 不成立",
    why: "判据没绿就收口 = 假绿",
    fix: "先把判据做绿；unsupported 先补索引",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "completeTask", messageStartsWith: "complete 被拒（可收口性" },
  },
  {
    code: "E-CRIT-005",
    family: "E-CRIT",
    what: "判定器只回了部分条目 / 后态 0 条 / unsupported>0 ⇒ unknowable",
    why: "判不了 ≠ 通过；unknowable 连 claim 都拒",
    fix: "补索引、补判据（把 unsupported 清零）",
    doc: DOC.gate,
    where: { path: SRC.tm, symbol: "cardStanding", messageStartsWith: "只回了部分条目" },
  },
  {
    code: "E-EVD-001",
    family: "E-EVD",
    what: "done 却没有 evidence",
    why: "收口必须有读数：写不出读数就收不了口",
    fix: "{kind:\"reading\", command, observed, at} —— 三键都要",
    doc: DOC.gate,
    where: { path: SRC.ov, symbol: "validateProgressEvidence", messageStartsWith: "complete 被拒（证据闸" },
  },
  {
    code: "E-EVD-002",
    family: "E-EVD",
    what: "证据形状不全（expectations 档还要 all_green:true + unsupported:0）",
    why: "缺字段的证据读不出结论",
    fix: "逐档补齐字段",
    doc: DOC.gate,
    where: { path: SRC.ov, symbol: "validateEvidenceShape", messageStartsWith: "拒绝：evidence 形状不完整" },
  },
  {
    code: "E-EVD-003",
    family: "E-EVD",
    what: "重开过的卡：证据 at < reopened_at，或 kind=expectations",
    why: "重开后的账必须比重开新，拿旧账收口 = 假绿",
    fix: "带新 at 的 reading / attestation；或改判据后 publish",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "reopenGate", messageStartsWith: "complete 被拒（重开账本" },
  },
  {
    code: "E-EVD-004",
    family: "E-EVD",
    what: "非 candidate 收口却没有 owner",
    why: "没主体就没有人对这笔收口负责",
    fix: "先 claim",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "completeTask", messageStartsWith: "complete 被拒：节点" },
  },
  {
    code: "E-EVD-005",
    family: "E-EVD",
    what: "todo 从 candidate 直接收口却没给 agent",
    why: "没被领过的卡，署名只能来自这次调用",
    fix: "加 agent（谁干的）",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "completeTask", messageStartsWith: "complete 被拒：从 candidate 直接收口必须给" },
  },
  {
    code: "E-WRITE-001",
    family: "E-WRITE",
    what: "编辑后 tree-sitter hasError 从 false 变 true",
    why: "语法坏了会遮挡语义检查，写盘也半残",
    fix: "先 dry_run:true；模板串里别放裸反引号",
    doc: DOC.write,
    where: { path: SRC.ec, symbol: "editCode", messageStartsWith: "编辑引入了语法错误" },
  },
  {
    code: "E-WRITE-002",
    family: "E-WRITE",
    what: "目标文件在 projectRoot 之外",
    why: "闸只管根内：根外改动既没判据也没回滚点",
    fix: "只改根内文件",
    doc: DOC.write,
    where: { path: SRC.aw, symbol: "applyWrites" },
  },
  {
    code: "E-WRITE-003",
    family: "E-WRITE",
    what: "replace_text 定位失败或多义（old_text 不在 / 命中多处）",
    why: "模糊命中会改错位置",
    fix: "加长 old_text（只有 L1·exact 可信）",
    doc: DOC.write,
    where: { path: SRC.rpl, symbol: "buildRefactorPlan" },
  },
  {
    code: "E-REASON-001",
    family: "E-REASON",
    what: "reason 少于 6 个有效字符",
    why: "一句话都写不出 = 没理由",
    fix: "一句话写清为什么发生",
    doc: DOC.gate,
    where: { path: SRC.rv, symbol: "validateReason", messageStartsWith: "原因过短或无实质内容" },
  },
  {
    code: "E-REASON-002",
    family: "E-REASON",
    what: "reason 命中套话黑名单（\"按设计补\"这类）",
    why: "套话过 L2 等于没有理由",
    fix: "补具体实体与变更动机",
    doc: DOC.gate,
    where: { path: SRC.rv, symbol: "validateReason" },
  },
  {
    code: "E-REASON-003",
    family: "E-REASON",
    what: "reason 文本本身没有实体（路径 / 文件名 / 数字 / 节点 id）",
    why: "这一层看的是 reason 那句话；evidence 不顶用",
    fix: "把实体名写进 reason 里",
    doc: DOC.gate,
    where: { path: SRC.rv, symbol: "validateReason", messageStartsWith: "原因未绑定具体实体" },
  },
  {
    code: "E-REASON-004",
    family: "E-REASON",
    what: "evidence 不可回溯（无 resolver，或 ref 查不到）",
    why: "不可回溯的证据必属编造 / 空挂",
    fix: "只挂真实存在的节点 id / 文件路径 / 观测事件",
    doc: DOC.gate,
    where: { path: SRC.rv, symbol: "validateReason" },
  },
  {
    code: "E-REASON-005",
    family: "E-REASON",
    what: "改 semantic.files 却没有现取该文件的事实（T20）",
    why: "DSL 不存事实镜像：不现取就是凭印象改",
    fix: "evidence:[{type:\"node\", ref:\"<仓库相对路径>\"}]",
    doc: DOC.gate,
    where: { path: SRC.dh, messageStartsWith: "改 semantic.files 前必须" },
  },
  {
    code: "E-REASON-006",
    family: "E-REASON",
    what: "声称新建文件，但同一批里没有 node.add（+ file-exists 判据）",
    why: "新建的依据是\"期望\"，不是\"库里已有\"",
    fix: "同批 node.add 并在 decision.expectations 里带 file-exists",
    doc: DOC.gate,
    where: { path: SRC.dh },
  },
  {
    code: "E-GENDB-001",
    family: "E-GENDB",
    what: "gen-db 带了 feature ⇒ 只重生成那一个切片（不报错）",
    why: "切片重生成会让 //source 与持有者列表对不上 ⇒ verify 门红",
    fix: "{action:\"gen-db\"} 不带 feature（= npm run design:gen-db）",
    doc: DOC.gendb,
    where: { path: SRC.di, messageStartsWith: "设计 DB 生成" },
  },
  {
    code: "E-GENDB-002",
    family: "E-GENDB",
    what: "投影与设计不一致（verify 门 6 的读数）",
    why: "派生物也要有门：源干净 ≠ 用户碰的那份干净",
    fix: "陈旧/缺/多 ⇒ 全量重生成；真冲突 ⇒ 改设计（重跑修不好）",
    doc: DOC.gendb,
    where: { path: SRC.gc, messageStartsWith: "真冲突" },
  },
];

/** 码 → 规则（一处索引；`gateRuleOf` 只查它，不各自线性扫表） */
const BY_CODE: ReadonlyMap<string, GateRule> = new Map(GATE_RULES.map((r) => [r.code, r]));

/**
 * 按码取规则。取不到 ⇒ `undefined`（★ 不许猜、不许造一个"通用"回来）。
 * 大小写不敏感（码对外总写大写，但调用方常从别处抄）。
 */
export function gateRuleOf(code: string): GateRule | undefined {
  const k = String(code ?? '').trim().toUpperCase();
  return k ? BY_CODE.get(k) : undefined;
}

/** 全部码（纯函数，供判据与 `design_line action=rules` 的 `data.codes` 用；顺序 = 表序） */
export function gateRuleCodes(): string[] {
  return GATE_RULES.map((r) => r.code);
}

/**
 * 一次拒绝可以带**多条**规则（例如"没领卡 + 画布过期"同时成立）。
 * ★ 人读文案**由调用方拼好**（逐字不变）；本类只负责把结构化读数带到调用方（`data.errors`）。
 * ★ 现状：**只定义、未接线**（`plumbing` 的 catch 目前只取 `message`，接线是下一批卡）。
 */
export class GateError extends Error {
  readonly data: { errors: GateRule[] };

  constructor(errors: GateRule[] | GateRule) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list[0]?.what ?? '被闸拒绝');
    this.name = 'GateError';
    this.data = { errors: list };
  }
}
