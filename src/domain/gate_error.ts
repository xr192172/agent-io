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
  // ★ 2026-10-30（带异议领卡）：三道门的判定内核 + 合并后收口读数（dissent_spec.ts 零依赖纯函数）
  ds: "src/domain/dissent_spec.ts",
  // ★ 2026-10-31（E-CRIT-006）：判据形状校验的唯一入口 —— 值 import 扫描的"拒"就抛在这里
  ex: "src/domain/expectation.ts",
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
    code: "E-PLAN-023",
    family: "E-PLAN",
    what: "外层码：整份重写计划闸拒绝（本次要改的文件里有 N 个没有够格的重写计划）",
    why: "内层 gap 码 E-PLAN-001…020 的文案永远排在「拒绝落盘（重写计划闸）：」表头之后 ⇒ messageStartsWith 接不上；没有外层码，这条真实拒绝只带散文、脚本无从分流（2026-10-30 实测：24 条缺前缀里 13 条属这一族）",
    fix: "按回执「· <rel> 没有够格的重写计划（N 处）」段的明细逐条补画布：design_line {action:\"plan\", file:\"<rel>\", entries:[…], apply:true}；★ 要让单条 gap 自带码，得改抛点 throw new GateError([...])（另卡）",
    doc: DOC.plan,
    where: { path: SRC.wg, symbol: "assertSourceWriteRegistered", messageStartsWith: "拒绝落盘（重写计划闸）" },
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
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（按 run 授权）：`authorize` 不是合法 scope" },
  },
  {
    code: "E-TASK-005",
    family: "E-TASK",
    what: "authorize:\"all\"（把整份 DSL 授权出去）",
    why: "整份授权 = 关闸，而写闸的价值就是\"不领任务不许改\"",
    fix: "写出那一片（例 files:src/application/design/）",
    doc: DOC.gate,
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（按 run 授权）：`authorize:'all'` **明令不支持**" },
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
    code: "E-TASK-008",
    family: "E-TASK",
    what: "带异议（supersedes）的卡收口时，evidence 里没有「合并后整册 judge」读数（command + observed），或读数里 fail ≠ 1 / 唯一 fail 不是 gen_design_db.ts",
    why: "两张卡各自红→绿 ≠ 合起来对 —— 用户点名的失效模式正是「各自都对、合起来不对」⇒ 收口必须看**合并后**的整册读数（fail 不增才叫没坏）",
    fix: "complete 的 evidence 用 kind:'reading'：command 抄 `design_line {action:'judge', feature:'agent-io'}` 的命令原文；observed 抄读数原文（含 `N pass / M fail`，且唯一 fail 点名 gen_design_db.ts）",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "completeTask", messageStartsWith: "complete 被拒（合并后整册读数" },
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
    fix:
      "别抢；**租约到期后可接管**（TTL 的唯一取值处 = `domain/task_machine.ts#LEASE_TTL_MS`，可用 `AGENT_IO_LEASE_TTL_HOURS` 覆盖 —— 本文件**不写数字**，否则又会像 patrol.mjs 曾写 24h、实际 2h 那样两处口径打架）并记 taken_over_from；" +
      "若这张卡正被别人办且你有异议 ⇒ 用 `data.supersedes` 对象形态接管（落卡即 `discussion.supersedes`，against 填**这张卡自己的 id**，" +
      "走 E-CLAIM-016/017/018 三道门：against = 本卡且 state=claimed · 本卡画布坍缩集的文件逐个顶层符号表态 · judgements 逐条覆盖本卡判据）",
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
    where: { path: SRC.cc, symbol: "parseDeclaredReadSet", messageStartsWith: "claim 被拒（data.read_set" },
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
    where: { path: SRC.to, symbol: "startTask", messageStartsWith: "start 被拒（判据还是空的）" },
  },
  {
    code: "E-CLAIM-012",
    family: "E-CLAIM",
    what: "publish 一张 state=claimed 的卡却没给 data.reason",
    why: "原地换判据要理由（只换 summary+expectations，evidence 保留）",
    fix: "带 data.reason；★ 本码**没有** messageStartsWith：真实文案是 `publish 被拒：节点 \"<id>\" 上有一张 **state=claimed** 的任务卡`，与 E-CLAIM-013 的分叉落在**变量节点 id 之后** ⇒ 前缀同长并列只能给 undefined（留着等于假覆盖）",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "publishTask" },
  },
  {
    code: "E-CLAIM-013",
    family: "E-CLAIM",
    what: "publish 盖到 done(L2)/void/其它状态的卡",
    why: "已收口 / 已弃做的卡不能悄悄翻新",
    fix: "done⇒reopen→改 decision→publish；void⇒relaunch；★ 本码**没有** messageStartsWith：真实文案是 `publish 被拒：节点 \"<id>\" 上已有一张 state=<态> 的任务卡`，与 E-CLAIM-012 的分叉落在**变量节点 id 之后** ⇒ 前缀只能同长并列（= undefined，不猜）",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "publishTask" },
  },
  {
    code: "E-CLAIM-014",
    family: "E-CLAIM",
    what: "原地换判据，但新 decision 没有 post 判据",
    why: "会得到一张收不了口的卡",
    fix: "先补 ≥1 条 post 判据",
    doc: DOC.gate,
    where: { path: SRC.to, symbol: "publishTask", messageStartsWith: "publish 被拒（原地换判据会得到一张收不了口的卡）" },
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
    code: "E-CLAIM-016",
    family: "E-CLAIM",
    what: "claim 声明了 supersedes（带异议领卡），但 against 不是同项目根下 state=claimed 的卡（含旧字符串形态 / 缺 against / why 里没点到实体）",
    why: "异议是给「那个正在办的人」的：点不到占位卡 ⇒ 没人会知道设计被改了，等于绕过并发闸",
    fix: "data.supersedes 用对象形态 {against:'<活跃卡 id>', why:'<带实体>', judgements:[{ref, verdict:'仍成立'|'被推翻', why}]}；against 取 claim 回执里 collectActiveClaims 报出的 card_id",
    doc: DOC.gate,
    where: { path: SRC.ds, symbol: "validateSupersedes", messageStartsWith: "claim 被拒（带异议领卡 · against" },
  },
  {
    code: "E-CLAIM-017",
    family: "E-CLAIM",
    what: "带异议领卡时，两卡改集交集的某个文件里有顶层符号没在画布 entries / untouched 里表态（planCoverageGaps 非空）",
    why: "没表态 = 没通读就动手；用户要的是「把前一个人的设计读完了再重写」，不是「抢过来再说」",
    fix: "design_line {action:'plan', file:'<交集文件>', entries/untouched…, apply:true} 把那几个符号逐个表态（要改写 entries，看过不动写 untouched + why），再 claim",
    doc: DOC.gate,
    where: { path: SRC.ds, symbol: "validateSupersedes", messageStartsWith: "claim 被拒（带异议领卡 · 读全证据" },
  },
  {
    code: "E-CLAIM-018",
    family: "E-CLAIM",
    what: "supersedes.judgements 没逐条覆盖对端卡上的全部判据（或 verdict 不在 {仍成立, 被推翻} / why 没点到实体 / 空数组）",
    why: "「我读过它」的硬证据就是逐条对它的判据表态；少一条就说明有一半设计没读",
    fix: "对端节点 decision.expectations 每条给一条 {ref:'decision:<node>#<i>', verdict, why:'<带实体>'}；拒绝报文会点名缺哪几条",
    doc: DOC.gate,
    where: { path: SRC.ds, symbol: "validateSupersedes", messageStartsWith: "claim 被拒（带异议领卡 · 判据未逐条覆盖" },
  },
  {
    code: "E-CRIT-001",
    family: "E-CRIT",
    what: "判据形状非法（kind / 必填 / minItems / 闭集）",
    why: "形状不对就求值不了，等于没有判据",
    fix: "按 src/domain/expectation_kinds.ts 的 KIND_SPECS 补；★ messageStartsWith 只覆盖 `assertValidExpectations` 的「expectations 必须是数组」这一支 —— 其余分支（kind / 必填 / minItems / 闭集）的文案以可变的 `expectations[<下标>]` 开头，前缀接不上",
    doc: DOC.gate,
    where: { path: SRC.ek, symbol: "validateExpectation", messageStartsWith: "expectations 必须是数组" },
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
    code: "E-CRIT-006",
    family: "E-CRIT",
    what:
      "`behavior-cases` 判据的 `path` 指向的文件有**裸说明符的值 import**（`import x from 'typescript'` / `import {a} from 'lodash'` / `require('fs')` 这类外部依赖）；" +
      "★ **相对说明符**（`./x.js` / `../y.js`）**不算** —— 夹具会把它连同闭包一起转译进 tmp",
    why:
      "harness 把目标文件转译进 tmp 时**只拷相对 import 闭包**（`copyRelativeImportClosure()`），拷不了 node_modules ⇒ " +
      "裸 import 会 load 失败 ⇒ 那条行为判据根本没有**行为落点**；" +
      "人只能退成 `source-has`（存在类，永远发现不了逻辑错）⇒ 必漂 ⇒ 被删 ⇒ 落点还是没有 ⇒ 再发明一个量具",
    fix:
      "① 把被考的决策抽成 `src/domain/` 下的**零依赖纯函数**（范例 `src/domain/import_names.ts`），判据打那个函数；" +
      "② 或改用他种判据（`call-exists` / `signature-matches` / `run`）；" +
      "★ `import type` / 具名全是 `type` / `export type` **不算**（类型被擦除，不 load）；" +
      "★ **相对 import 放行**（不是缺陷：夹具按 TS AST 拷闭包，`import './x.js'` 能 load）",
    doc: DOC.gate,
    where: { path: SRC.ex, symbol: "behaviorTargetValueImportProblem", messageStartsWith: "E-CRIT-006" },
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
    code: "E-WRITE-004",
    family: "E-WRITE",
    what: "写入时带的 lease_generation 已经过期（卡被接管过：卡上代数更大）",
    why:
      "租约过期 ⇒ 别人接管（`lease_generation` +1）⇒ 上一任只是\"暂时没回报\"，**写权已经不在它手上**；" +
      "继续写就是用旧判据覆盖新接管人的活（\"僵尸回来写\"）",
    fix:
      "重新 claim 拿最新一代（`edit_dsl {type:'task', op:'claim', id:'<节点>', data:{owner, supersedes:{…}}}`）再写；" +
      "或停下先看当前 owner —— ★ **不传** `lease_generation` 时本码不生效（老 CLI / 老脚本不受影响），" +
      "所以看到它说明你带了一个过期的代数",
    doc: DOC.write,
    where: { path: SRC.wg, symbol: "evaluateTaskGate", messageStartsWith: "拒绝落盘（任务闸 · 租约代际）" },
  },
  {
    code: "E-REASON-001",
    family: "E-REASON",
    what: "reason 少于 6 个有效字符",
    why: "一句话都写不出 = 没理由",
    fix: "一句话写清为什么发生；★ 前缀取的是真抛点 `变更原因校验未通过（L1）：`（内层句 `原因过短或无实质内容…` 排在表头之后，端到端恒不命中）",
    doc: DOC.gate,
    where: { path: SRC.rv, symbol: "validateReason", messageStartsWith: "变更原因校验未通过（L1）：" },
  },
  {
    code: "E-REASON-002",
    family: "E-REASON",
    what: "reason 命中套话黑名单（\"按设计补\"这类）",
    why: "套话过 L2 等于没有理由",
    fix: "补具体实体与变更动机；★ 前缀取的是真抛点（design/handlers.ts 的 `变更原因校验未通过（L2）：`）—— 内层句子以可变的 reason 原文开头（`原因 \"<reason>\" 命中套话黑名单`）⇒ 只能用外层层号分叉",
    doc: DOC.gate,
    where: { path: SRC.rv, symbol: "validateReason", messageStartsWith: "变更原因校验未通过（L2）：" },
  },
  {
    code: "E-REASON-003",
    family: "E-REASON",
    what: "reason 文本本身没有实体（路径 / 文件名 / 数字 / 节点 id）",
    why: "这一层看的是 reason 那句话；evidence 不顶用",
    fix: "把实体名写进 reason 里；★ 前缀取的是真抛点 `变更原因校验未通过（L3）：`（内层句 `原因未绑定具体实体…` 排在表头之后，端到端恒不命中）",
    doc: DOC.gate,
    where: { path: SRC.rv, symbol: "validateReason", messageStartsWith: "变更原因校验未通过（L3）：" },
  },
  {
    code: "E-REASON-004",
    family: "E-REASON",
    what: "evidence 不可回溯（无 resolver，或 ref 查不到）",
    why: "不可回溯的证据必属编造 / 空挂",
    fix: "只挂真实存在的节点 id / 文件路径 / 观测事件；★ 前缀取的是真抛点 `变更原因校验未通过（L4）：` —— L4 的两支（无 resolver / ref 查不到）共用它，与 L1/L2/L3 靠层号分叉",
    doc: DOC.gate,
    where: { path: SRC.rv, symbol: "validateReason", messageStartsWith: "变更原因校验未通过（L4）：" },
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

  constructor(errors: GateRule[] | GateRule, message?: string) {
    const list = Array.isArray(errors) ? errors : [errors];
    // ★★★ 2026-10-30（包装层透传）：**可选**人读文案 —— 给了就逐字用它，不给退回 `errors[0].what`。
    //   为什么必须有这个口子：`edit_dsl` 的 op 循环 catch 要保留**外层两句文案**（`操作 i/N 失败…` +
    //   `失败原因: …`），而那两句不是任何一条规则的 `what` ⇒ 只能另外传；用 `Object.assign(e, {message})`
    //   硬改 `.message` 比这脏（那是在错误对象上做后处理）。★ 既有调用方都不传 ⇒ 行为**逐字不变**。
    super(message ?? list[0]?.what ?? '被闸拒绝');
    this.name = 'GateError';
    this.data = { errors: list };
  }
}

/**
 * 从**任意抛出的东西**里取回结构化码 —— 结构化通道的**唯一取码入口**（★ 本函数绝不抛：它住在 catch 里）。
 *
 * ## 它补的是哪个洞（本仓自己记过的那一条）
 * `src/application/plumbing.ts` 的 `wrap` / `wrapData` 两处 catch 过去**只取 `message`**
 * ⇒ 抛什么都变成一句中文散文，机器没法 pattern-match。这正是 `docs/GUIDE-GATE.md` 里
 * 记过的「判了但读数丢掉」。本函数只做**取码**：它不改任何拒绝点、不拼人读文案。
 *
 * ## 三种入参（判据逐条钉住：`decision:file_src_domain_gate_error_ts#6`）
 * ① `GateError` ⇒ 它的 `data.errors`（顺序逐字保留：不排序、不去重）；
 * ② **鸭子类型**：任意对象带 `data.errors` **数组** ⇒ 认 —— 给尚未改造的抛点用
 *    （它们只要 `throw Object.assign(new Error(msg), { data: { errors } })` 就能带码，
 *    不必等换类）；★ 只保留 `code` 是**字符串**的条目（catch 里不许因为脏数据再抛一次）；
 * ③ 其它（`null` / `undefined` / 字符串 / 数字 / 普通 `Error`）⇒ `[]`。
 *
 * ★ **不做字符串嗅探**：一句散文里出现 `E-WRITE-001` **不算**带码 ——
 *   否则散文就成了第二个码表（同一件事两处，必然漂）。
 */
export function gateErrorsOf(e: unknown): GateRule[] {
  if (e instanceof GateError) return [...e.data.errors];
  if (typeof e !== 'object' || e === null) return [];
  const list = (e as { data?: { errors?: unknown } }).data?.errors;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is GateRule => typeof (x as { code?: unknown } | null)?.code === 'string');
}

/**
 * ★ **判据专用桥**（只为 `behavior-cases` 服务，**不是第二个入口**）。
 *
 * ## 为什么还留着它（★ 2026-10-30 D4 之后：**已不再需要**，退役另卡）
 * ★ 它当初存在的唯一理由已经消失：`cases[].given` 自 2026-10-30 起是 **JSON 值数组**
 * （字段类型 `json[]`，schema 侧只声明 `array`、**不写 items**）⇒ 对象 / 数组 / 数字 / 字符串 /
 * null 都能当位置实参写进判据，函数收到的是**真值**（harness 把 cases 内联成 JSON 字面量再
 * `fn(...args)`，**不 parse**）。⇒ ★ 新生判据一律**直喂对象**，不许再写桥；这里保留只为
 * 不撕掉既有 6 条 case 的基线。
 *
 * 历史（D4 之前）：`given` 在 schema 里是纯字符串数组 ⇒ 真实入参传不进 harness，于是用一条 JSON
 * 描述"该造什么"，造出来喂 `gateErrorsOf`，再把结果压成**码数组**。
 *
 * ## 边界（别把它当功能用）
 * 它**不解析码表**（读码只有 `GATE_RULES`）、**不做判定**（取码只有 `gateErrorsOf`）、
 * **不拼文案**。线上调用方要取码，一律用 `gateErrorsOf`；本函数只出现在判据里
 * （`decision:file_src_domain_gate_error_ts#7`）。
 *
 * spec 形状：`{"kind":"gate","codes":["E-WRITE-001"]}` / `{"kind":"error","message":"x"}` /
 * `{"kind":"null"}` / `{"kind":"undefined"}` / `{"kind":"duck","codes":["E-EVD-001"]}`。
 */
export function gateErrorCodesFromJson(s: string): string[] {
  const inner = gateInnerFromJson(s);
  // ★ 认不出的 spec ⇒ 明确回「坏 spec」标记，绝不与"没有码"（`[]`）混为一谈
  if (inner === BAD_SPEC) return ['<bad-spec>'];
  return gateErrorsOf(inner).map((r) => r.code);
}

/**
 * ★★ 2026-10-30：spec → "内层抛出的东西"的**唯一构造处**（`gateErrorCodesFromJson` 与
 * `carriedCodesFromJson` 共用 —— 同一份 spec 语法只解析一次，两份必然漂）。
 *
 * spec 形状：`{"kind":"gate","codes":[...]}` / `{"kind":"error","message":"…"}` /
 * `{"kind":"null"}` / `{"kind":"undefined"}` / `{"kind":"duck","codes":[...]}`。
 * ★ 认不出的 kind ⇒ 回 `BAD_SPEC` 哨兵（**不是** `undefined`：`{"kind":"undefined"}` 是合法入参，
 *   两者混起来就分不出"坏的 spec"与"内层抛了 undefined"）。
 */
function gateInnerFromJson(s: string): unknown {
  const spec = JSON.parse(String(s ?? '{}')) as { kind?: unknown; codes?: unknown; message?: unknown };
  const codes = Array.isArray(spec.codes) ? spec.codes.filter((c): c is string => typeof c === 'string') : [];
  switch (spec.kind) {
    case 'gate': {
      const rules = codes.map((c) => gateRuleOf(c)).filter((r): r is GateRule => !!r);
      return new GateError(rules);
    }
    case 'error':
      return new Error(typeof spec.message === 'string' ? spec.message : 'x');
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'duck':
      return { data: { errors: codes.map((code) => ({ code })) } };
    default:
      return BAD_SPEC;
  }
}

/**
 * ★★ 散文 → 码的**反查**（过渡方案：60 多个拒绝点还都是 `throw new Error(散文)`，本函数**一处抛点都不改**）。
 *
 * ## 口径（三条，别的都不猜）
 * ① **归一化**：先把 message 去首尾空白、并把连续空白压成一个空格（真实散文里带 `\n` 与两格缩进）；
 * ② **前缀命中**：与 `GATE_RULES[i].where.messageStartsWith` 比对前缀 —— **没有** `messageStartsWith` 的条目
 *    **不参与**反查（它压根没有可对号的文案）；
 * ③ **最长前缀优先**；★★ **最长前缀并列 ≥2 条 ⇒ 返回 `undefined`**。
 *    例：`E-CLAIM-012 / 013 / 014` 三条都写 `publish 被拒` ⇒ 这句散文分辨不出是哪一条
 *    ⇒ **歧义不猜**（本仓一贯口径）。★ 宁可没有码，也不带**错**码：错码比没码更坏，
 *    因为下游会按码分流，而错码会让"另一件事"被当成"这件事"处理。
 *
 * ## 与 `gateErrorsOf` 的分工（并存，不是第二份判定）
 * 抛点改造后（`throw new GateError([...])`）走 `gateErrorsOf`，**优先**；
 * 本函数只在 `gateErrorsOf` 取不到码时兜底。两者都只**读** `GATE_RULES`，不拼文案、不改判据。
 *
 * @param message 抛出的散文（`Error#message`）；空串 / 全是空白 ⇒ `undefined`
 * @returns 命中的规则；前缀并列（歧义）、空串、乱码（一条都不命中）⇒ `undefined`
 */
export function gateRuleByMessage(message: string): GateRule | undefined {
  const m = normalizeGateMessage(message);
  if (!m) return undefined;
  let best: GateRule | undefined;
  let bestLen = 0;
  let tie = false;
  for (const rule of GATE_RULES) {
    const raw = rule.where.messageStartsWith;
    if (typeof raw !== 'string') continue;
    const prefix = normalizeGateMessage(raw);
    if (!prefix || !m.startsWith(prefix)) continue;
    if (prefix.length > bestLen) {
      best = rule;
      bestLen = prefix.length;
      tie = false;
    } else if (prefix.length === bestLen) {
      // ★ 同长前缀又命中一条 ⇒ 并列（最终返回 undefined）
      tie = true;
    }
  }
  return tie ? undefined : best;
}

/**
 * 归一化的**唯一实现** —— 消息与码表前缀必须过**同一把尺子**：
 * 否则"表里写一格空白、消息里写两格"就永远命中不了（两把尺子必然漂）。
 */
function normalizeGateMessage(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}
// ─────────────────────────────────────────────────────────────
// ★★★ 2026-10-30（包装层透传）：**内层的码穿过外层文案**
// ─────────────────────────────────────────────────────────────

/** `gateInnerFromJson` 的「坏 spec」哨兵（★ 必须有存在感：`unknown` 里 `undefined` 是合法值） */
const BAD_SPEC: unique symbol = Symbol('bad-spec');

/**
 * ★★★ 2026-10-30：**包装层透传** —— 外层人读文案**逐字**保留，只把**内层**抛出的结构化码带出去。
 *
 * ## 它补的是哪个洞（实测，不是推的）
 * `edit_dsl` 的 op 循环 catch（`design/dsl_ops/update_feature.ts#updateFeatureCore`）过去统一
 * 造一句「操作 i/N 失败，已回滚全部 K 个已应用变更」+「失败原因: 内层 message」——
 * ★ 内层哪怕是 `E-CLAIM-*` / `E-CRIT-*` / `E-EVD-*`，也被包装层**吃掉**：`plumbing#wrap` 的
 * `gateErrorsOf` 在**外层** Error 上取不到码，反查又只认码表里的首句前缀（外层首句是「操作 1/1 失败」，
 * 一条规则都命中不了）⇒ 端到端连 `---DATA---` 段都没有。两次真拒绝实测都取不到码：
 * `start 被拒…`（E-CLAIM-*）与 `expectations 必须是数组…`（E-CRIT-001）。
 *
 * ## 口径（三条，别的都不猜）
 * ① **外层文案逐字不变**：`outerMsg` 原样进 `message`（既有回执一字不改）；
 * ② **取码只走 `gateErrorsOf`**（唯一入口，绝不抛）；取不到才 `gateRuleByMessage` 反查**内层**散文；
 * ③ **仍取不到 ⇒ 返回普通 `Error`**（= 旧行为：不带 `data.errors`，`wrap` 也不会多出 `---DATA---`）。
 *    ★ 宁可没有码，也不带**错**码 —— 与本文件 `gateRuleByMessage` 的歧义口径一致。
 *
 * ## 边界
 * 它**不改任何拒绝的判定与文案**，只做搬运：拒绝点照旧 `throw new Error(散文)`，本函数只读它。
 */
export function withGateCodes(outerMsg: string, inner: unknown): Error {
  const rules = innerGateRules(inner);
  if (rules.length === 0) return new Error(outerMsg);
  return new GateError(rules, outerMsg);
}

/**
 * 内层抛出的东西 → 闸门规则（空 = 内层没带码）。
 * ★ 两级**同一个顺序**：结构化优先（`gateErrorsOf`），散文反查兜底（`gateRuleByMessage`）——
 *   与 `plumbing#wrap` 的 catch 完全同源，别在这里另排一套。
 */
function innerGateRules(inner: unknown): GateRule[] {
  const structural = gateErrorsOf(inner);
  if (structural.length > 0) return structural;
  const msg = (inner as { message?: unknown } | null | undefined)?.message;
  const byMsg = gateRuleByMessage(typeof msg === 'string' ? msg : '');
  return byMsg ? [byMsg] : [];
}

/**
 * ★ **判据专用桥**（只为 `behavior-cases` 服务，**不是第二个入口**；与 `gateErrorCodesFromJson` 同一口径）。
 *
 * ## 为什么还留着它（★ 2026-10-30 D4 之后：**已不再需要**，退役另卡）
 * ★ `cases[].given` 现在是 **JSON 值数组**（`json[]`）⇒ 真错误对象能直接当位置实参，新生判据不必再走桥。
 * 历史（D4 之前）：`given` 只吃字符串 ⇒ 喂不了真错误对象，只好收一条 JSON spec
 * （`gateInnerFromJson` 认识的形状），造出内层、调 `withGateCodes`，
 * 再从**真载体**上用 `gateErrorsOf` 取码 —— 于是判据验的是**真链路**（外层文案 + 载体上的码），
 * 而不是另写一遍取码逻辑。
 *
 * ★ 坏 spec ⇒ `codes:['<bad-spec>']`（与 `[]` 区分：`[]` = 内层确实没带码）。
 */
export function carriedCodesFromJson(outerMsg: string, innerJson: string): { message: string; codes: string[] } {
  const inner = gateInnerFromJson(innerJson);
  if (inner === BAD_SPEC) return { message: outerMsg, codes: ['<bad-spec>'] };
  const err = withGateCodes(outerMsg, inner);
  return { message: err.message, codes: gateErrorsOf(err).map((r) => r.code) };
}
