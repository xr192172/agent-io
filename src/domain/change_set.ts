/**
 * change_set.ts —— **ChangeSet 组合视图**的纯核：§7.1 七行的定义 + 组装 + 缺行/缺字段体检。
 *
 * ## 它是什么（一段话）
 * `docs/PROJECT-DESIGN.md` §7.1（`:441-455`）把 ChangeSet 定义成「**现有对象的组合视图，不是新存储**」，
 * 并逐行列了它要回答的七件事。本文件就是那七行的**机器形状**：给一组**已经取好的普通数据**
 * （节点的 decision / 卡 / 该卡名下的画布行 / 判据现算结果 / 索引事实 / 施工证据），
 * 组装成一个 `ChangeSetView`，并回答「**缺哪一行**」。
 *
 * ## 为什么它是**纯**的（零 import、零 IO）
 * 1. **domain 不许 import 上层**（`src/domain` 是产品概念的住处，不许反向依赖 application / infrastructure）；
 * 2. 更要紧：**只有纯文件能被 `behavior-cases` 判据真跑** —— 判定器把目标文件转译进 tmp 再 `import`，
 *    带 `fs` / `node:sqlite` 的模块加载不起来 ⇒ 判据只能退化成 `file-exists` / `source-has` 那类
 *    「存在类」判据，而它们**永远发现不了逻辑错**（`strengthOfKind` 的原话）。
 *    ⇒ 「删掉一行 ⇒ 红」这条判据**只能**长在这里。取数的活交给
 *    `application/design/db/change_set_view.ts#changeSetOfCard`。
 *
 * ## ★★★ 与 `index_integrity` 的「变更集」**不是同一个东西**（同一个词指两个对象的现场）
 * `changeset_unreadable`（`application/meta/integrity/index_integrity.ts`，
 * `tests/p0_change_set_truth.test.ts` 通篇在断它）指的是 **`symbol_diffs` 的 added / removed / changed**
 * —— 那是「这次代码里哪些符号变了」。
 * 本文件的 `ChangeSetView` 是「**这次要改什么、如何验、做到哪里**」（decision + 卡 + 画布 + 判据结果）。
 * ⇒ **改一个的时候别顺手改另一个**；两边都叫「变更集」，但对象、权威、消费方全不同。
 *
 * ## 两条纪律（§7.1 字面 + 本卡判据）
 * · **不许坍缩**：`entries` 必须带齐 `kind / detail / judgement_ref / status`（外加 `depends_on`），
 *   且**文件级工作项**（没有 `anchor.symbol` 的 `create` / `delete` 整文件）**一条都不许丢** ——
 *   现存坍缩集 `rewrite_plan.ts#planChangeSet` 恰好把它们丢了（它是**并发读集**，只认「要碰哪个符号」，
 *   口径不同，别拿它冒充 ChangeSet）。
 * · **缺就点名**：少一行 / 少一格都进 `missing` / `entry_field_gaps`，**不许静默省略**
 *   （「静默省略」是本仓反复撞的那个坑：读的人以为「这里有 0 条」，其实是「这里没看」）。
 */

/**
 * §7.1 七行 —— **顺序就是表序**（`docs/PROJECT-DESIGN.md:445-453`）。
 *
 * ★ `carrier` 只作说明（「这一行今天从哪个现有对象取」），**不是取数逻辑**：
 *   取数在 `application/design/db/change_set_view.ts`，本文件不碰 IO。
 */
export const CHANGE_SET_ROWS = [
  { key: 'goal_why_acceptance', label: '目标、理由与验收', carrier: 'decision / expectations' },
  { key: 'ownership', label: '执行责任与归属', carrier: 'task / card' },
  { key: 'work_items', label: '文件与符号级工作项', carrier: 'RewritePlan.entries[]' },
  { key: 'targets', label: '目标文件、改动类型与细节', carrier: 'RewritePlan.path、entry.kind/detail' },
  { key: 'judgement_refs', label: '验收引用与先后依赖', carrier: 'entry.judgement_ref / depends_on' },
  { key: 'card_surface', label: '同任务跨文件工作面', carrier: 'card 名下全部画布（不坍缩）' },
  { key: 'baseline_evidence', label: '实际事实基线与施工证据', carrier: '冻结指纹 / 实际索引 / 判据执行结果' },
] as const;

/** 七行的键（`ChangeSetRows` 的字段名） */
export type ChangeSetRowKey = (typeof CHANGE_SET_ROWS)[number]['key'];

/**
 * 七行的**中文名**（顺序 = §7.1 表序）—— 缺行报文的**唯一来源**。
 *
 * ★ 为什么缺行报文只许用这七个字面：`source-has` 那类存在类判据抓不到「少了一行」，
 *   而「少了一行」又最容易被读成「本来就该没有」。⇒ 判据要比对的必须是**固定、逐字**的名单。
 */
export const CHANGE_SET_ROW_LABELS: readonly string[] = CHANGE_SET_ROWS.map((r) => r.label);

/**
 * 一条画布 entry **必须带**的字段（`RewritePlanEntry` 的必填四项）。
 *
 * ★ 为什么不把 `depends_on` 算进来：它是**可选**的（`rewrite_plan.ts:63`）——
 *   把它算成必填，会把这个仓库里**每一条真实画布**都报成「坍缩」（实测：真卡
 *   `file_src_application_meta_registry_project_actual_fields_ts` 的 15 条 entry 全都没写 `depends_on`）。
 *   判据要能区分「没写可选字段」与「丢了必填字段」，否则它只会被关掉。
 */
export const ENTRY_REQUIRED_FIELDS = ['kind', 'detail', 'judgement_ref', 'status'] as const;

/** entry 的改动类型（与 `RewritePlanEntry.kind` 同域） */
export type ChangeSetEntryKind = 'rewrite' | 'create' | 'delete';

/** entry 的施工状态（与 `RewritePlanEntry.status` 同域） */
export type ChangeSetEntryStatus = 'open' | 'stale' | 'done';

/**
 * **输入**：一条画布 entry（`RewritePlanEntry` 的结构型，不 import ⇒ domain 零依赖）。
 * ★ 字段全可选是**故意的**：本类型同时用于「**坍缩的输入**」——
 *   少字段要能被 `entryFieldGaps` 抓到，声明成必填就抓不到了（TS 只是编译期，运行期照样可能有洞）。
 */
export interface ChangeSetEntryInput {
  /** 它属于哪个文件（读端按画布行注入；`RewritePlan.entries[]` 里没有这一格） */
  file?: string;
  anchor?: { symbol?: string } | null;
  kind?: string;
  detail?: string;
  judgement_ref?: string;
  judgement_kind?: string;
  depends_on?: string[];
  status?: string;
  note?: string;
  done_at?: string;
}

/**
 * **输出**：一条工作项 —— ★ **不坍缩**。
 *
 * `symbol: null` 的意思是「**文件级工作项**」（整文件 `create` / `delete`），
 * **不是**「不知道」：现存坍缩集会把这类整条丢掉，于是「新建整个文件」这件事在工作面上消失。
 */
export interface ChangeSetEntry {
  file: string;
  symbol: string | null;
  kind: ChangeSetEntryKind;
  detail: string;
  judgement_ref: string;
  judgement_kind?: string;
  depends_on: string[];
  status: ChangeSetEntryStatus;
  note?: string;
  done_at?: string;
}

/** 卡（`ChangeSet` 第 2 行的输入）：节点卡与 todo 卡同形，只是 `kind` 与"决策住在哪"不同 */
export interface ChangeSetCardInput {
  id: string;
  /** `node` = 节点上的 `task` 卡；`todo` = `todos[]` 卡（**没有节点决策**）；`unknown` = 册里查不到 */
  kind: 'node' | 'todo' | 'unknown';
  feature: string | null;
  node_id: string | null;
  state: string | null;
  owner: string | null;
  claimed_at: string | null;
  /** 卡还活着吗（`rewrite_plan.ts#cardLivesOf` 的权威读数；`null` = 判不出） */
  life: 'live' | 'closed' | 'gone' | null;
}

/** 决策卡（第 1 行的输入）—— 四个字段缺一不可（§7.1 写的是「目标、**理由**与验收」） */
export interface ChangeSetDecisionInput {
  summary?: string;
  rationale?: string;
  acceptance?: string;
  expectations?: ReadonlyArray<{ kind?: string }>;
}

/** 一行画布（第 3/4/6/7 行的输入） */
export interface ChangeSetPlanInput {
  file: string;
  entries: ReadonlyArray<ChangeSetEntryInput>;
  frozen_at?: string | null;
  base_content_hash?: string | null;
  symbols_at_freeze?: ReadonlyArray<string> | null;
  /** `fps_at_freeze` 的**条数**（不搬整张表：视图只回答"冻结指纹在不在"，内容归画布） */
  fps_at_freeze_count?: number | null;
  untouched?: ReadonlyArray<{ symbol: string; why: string }> | null;
  untouched_default_why?: string | null;
  /** 非空 = 这段画布**已软消解**（落地了）。★ 视图**照收**，只标出来（宪法：完整 ≠ 只看活的） */
  dissolved_at?: string | null;
  dissolve_reason?: string | null;
}

/** 判据的现算结果（第 7 行的输入）—— ★ **现算不现存**（§7.1：属只读派生） */
export interface ChangeSetJudgementInput {
  file: string;
  symbol: string | null;
  judgement_ref: string;
  /** `pass` / `fail` / `unsupported` / `pending` / `unresolved`（沿用 `Verdict` 词汇，不另造） */
  verdict: string;
  detail: string;
}

/** 实际索引的读数（第 7 行）：`checkRewriteExit` 的只读结论，逐文件 */
export interface ChangeSetIndexFactInput {
  file: string;
  file_exists: boolean;
  /** 文件内容自冻结以来变过吗（`null` = 没冻结指纹，判不了） */
  changed_since_freeze: boolean | null;
  /** 改了却没计划（设计漏了）的符号 —— ★ 这一格是「设计期权威」的可判形态 */
  changed_unplanned: readonly string[];
  error?: string | null;
}

/** 卡上存的施工证据（第 7 行）：只搬结论与新鲜度，不搬全文 */
export interface ChangeSetEvidenceInput {
  kind: string;
  verdict?: string;
  at?: string;
  /** `TaskEvidenceRecord` 的指纹新鲜度（`valid` / `stale` / `unverifiable`） */
  freshness?: string;
}

/** 组装输入：**全是普通数据**（读端负责现取，本文件负责组装） */
export interface ChangeSetInput {
  card?: ChangeSetCardInput | null;
  decision?: ChangeSetDecisionInput | null;
  plans?: ReadonlyArray<ChangeSetPlanInput>;
  judgements?: ReadonlyArray<ChangeSetJudgementInput>;
  evidence?: ReadonlyArray<ChangeSetEvidenceInput>;
  index?: ReadonlyArray<ChangeSetIndexFactInput> | null;
}

/** 第 1 行：目标、理由与验收 */
export interface ChangeSetGoalRow {
  summary: string | null;
  rationale: string | null;
  acceptance: string | null;
  expectation_count: number;
  expectation_kinds: string[];
  /**
   * **文字项缺哪些**（`理由` / `验收` / `可判验收`）—— 观测，不是缺行。
   * ★ 为什么不算缺行：`rationale` / `acceptance` 在 schema 里是**可选**的（`domain/geometry.ts:339-359`）；
   *   把它们算缺行会让本仓库大量合法决策卡永久红，于是这条判据会被关掉（而不是被满足）。
   */
  unstated: string[];
}

/** 第 2 行：执行责任与归属 */
export interface ChangeSetOwnershipRow {
  card_id: string;
  kind: string;
  feature: string | null;
  node_id: string | null;
  state: string | null;
  owner: string | null;
  claimed_at: string | null;
  life: string | null;
}

/** 第 3 行：文件与符号级工作项（计数 + 逐文件分布；**明细在 `view.entries`**，不复制两份） */
export interface ChangeSetWorkItemsRow {
  count: number;
  by_file: Array<{ file: string; count: number }>;
}

/** 第 4 行：目标文件、改动类型与细节 */
export interface ChangeSetTargetRow {
  file: string;
  symbol: string | null;
  kind: string;
  detail: string;
}

/** 第 5 行：验收引用与先后依赖（含该条判据的**现算结论**，若有） */
export interface ChangeSetJudgementRefRow {
  file: string;
  symbol: string | null;
  judgement_ref: string;
  judgement_kind?: string;
  depends_on: string[];
  verdict: string | null;
  detail: string | null;
}

/** 第 6 行：同任务跨文件工作面 */
export interface ChangeSetSurfaceRow {
  /** 有工作项的文件（**由 entries 派生，不用坍缩集** —— 坍缩集会丢文件级工作项） */
  files: string[];
  /** 这张卡名下有画布行的**全部**文件（含 0 条 entry 的行与已消解的行） */
  plan_files: string[];
  /** 只有 `done` 条目的文件（= 这段已经做完；不让它冒充"还有活"） */
  files_only_done: string[];
  /** 含**文件级**工作项的文件（整文件 create/delete 的家） */
  files_file_level: string[];
  /** 已软消解的文件（落地了；只标出来，不滤掉） */
  dissolved_files: string[];
}

/** 第 7 行：实际事实基线与施工证据 */
export interface ChangeSetBaselineRow {
  /** 冻结基线（每行的 `base.content_hash` / `frozen_at` / 冻结时的符号数 / 冻结指纹数） */
  frozen: Array<{
    file: string;
    base_content_hash: string | null;
    frozen_at: string | null;
    symbols_at_freeze: number | null;
    fps_at_freeze: number | null;
  }>;
  /** 实际索引读数（`checkRewriteExit` 的只读结论，逐文件） */
  index: ChangeSetIndexFactInput[];
  /** 判据执行结果（**现算**，不落盘） */
  judgements: Array<{ file: string; symbol: string | null; judgement_ref: string; verdict: string; detail: string }>;
  judgement_tally: { pass: number; fail: number; unsupported: number; pending: number; unresolved: number };
  /** 卡上存的施工证据（人/机器当时看到的那一版） */
  evidence: ChangeSetEvidenceInput[];
}

/** 七行 */
export interface ChangeSetRows {
  goal_why_acceptance: ChangeSetGoalRow | null;
  ownership: ChangeSetOwnershipRow | null;
  work_items: ChangeSetWorkItemsRow | null;
  targets: ChangeSetTargetRow[];
  judgement_refs: ChangeSetJudgementRefRow[];
  card_surface: ChangeSetSurfaceRow | null;
  baseline_evidence: ChangeSetBaselineRow | null;
}

/** 一条缺行读数（`row` 是 §7.1 的中文行名，`why` 是人读原因） */
export interface ChangeSetGap {
  row: string;
  why: string;
}

/**
 * **ChangeSet 组合视图** —— 只回答「这次要改什么、如何验、做到哪里」（§7.1 末句）。
 *
 * ★ 它不是第二份目标副本：`entries` / `rows` 全是从现有对象**现组装**的派生值，
 *   一个字节都不落盘（判据：`tests/p0_change_set_view.test.ts` 的 `plans` 行数与项目树指纹跑前跑后不变）。
 */
export interface ChangeSetView {
  card: ChangeSetCardInput | null;
  feature: string | null;
  rows: ChangeSetRows;
  /** ★ **全量、不坍缩**的工作项（含文件级与 `done` 项） */
  entries: ChangeSetEntry[];
  /** 逐条的**必填字段缺口**（空数组 = 每条都带齐）—— ★ 坍缩会在这里留下名字 */
  entry_field_gaps: string[];
  /** 缺哪几行（§7.1 中文行名；空数组 = 七行齐） */
  missing: ChangeSetGap[];
}

/** `undefined` / `null` / 非字符串 ⇒ `null`（★ 不用 `String(x)`：它会把 `undefined` 变成 "undefined"） */
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 去重保序（不引依赖：本文件零 import） */
function uniq(list: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (const x of list) if (x && !out.includes(x)) out.push(x);
  return out;
}

/**
 * 逐条 work item 的**必填字段缺口**（坍缩检出）。
 *
 * 判据（只有这一条）：`ENTRY_REQUIRED_FIELDS` 里每个键**必须出现在这条 entry 上**。
 * ★ 为什么按「键在不在」而不是「值是不是空」判：
 *   · 「键不在」= 这一条**根本不是工作项**（坍缩成 `{file, symbol}` 就会这样）——
 *     这是本仓真出现过的形态，必须红；
 *   · 「键在、值是空串」（如被吸收进来的 entry 的 `judgement_ref: ''`）= **工作项在，但设计没补完** ——
 *     那归 `rewrite_plan.ts#planGaps` 点名，不归本函数（两件事，别混）。
 */
export function entryFieldGaps(entries: ReadonlyArray<ChangeSetEntryInput>): string[] {
  const out: string[] = [];
  entries.forEach((e, i) => {
    const raw = (e ?? {}) as Record<string, unknown>;
    const file = strOrNull(raw['file']) ?? '';
    const anchor = raw['anchor'] as { symbol?: unknown } | null | undefined;
    const sym = strOrNull(anchor?.symbol) ?? '';
    const who = `${file || '(缺 file)'}#${sym || '(文件级)'}（第 ${i + 1} 条）`;
    if (!file) out.push(`${who} 缺 file（不知道这一条属于哪个文件 ⇒ 无法归位）`);
    for (const k of ENTRY_REQUIRED_FIELDS) {
      if (!(k in raw) || raw[k] === undefined) out.push(`${who} 缺 ${k}`);
    }
  });
  return out;
}

/**
 * **缺哪几行**（§7.1 七行体检）—— 唯一的判据实现。
 *
 * 输入是**组装好的视图**（不是输入数据）：这样它可以同时用来
 * ① 组装完自检（`assembleChangeSet` 内部调它生成 `missing`）；
 * ② 被 `behavior-cases` 判据**直接喂**（给一个人造视图 ⇒ 断言它报哪几行）。
 *
 * ★ 每行的"在场"判据写在这里、**只写一遍**；理由文案在下面的 `gapWhyOf`（两件事分家：
 *   判据容易写错，文案容易写漏 —— 混在一起时，改一处会悄悄改另一处）。
 */
export function changeSetRowGaps(view: ChangeSetView): string[] {
  const out: string[] = [];
  const rows = (view?.rows ?? {}) as Partial<ChangeSetRows>;
  const L = CHANGE_SET_ROW_LABELS;

  // ① 目标、理由与验收
  if (!rows.goal_why_acceptance) out.push(L[0]);

  // ② 执行责任与归属
  if (!rows.ownership || !rows.ownership.card_id) out.push(L[1]);

  /**
   * ③ 文件与符号级工作项
   * ★ **两条腿**：有工作项 **且** 每条都带齐必填字段。
   *   只断前者 ⇒ 坍缩成 `{file, symbol}` 也照样绿（而"坍缩"正是本卡要防的形态）。
   */
  const collapsedByGaps = Array.isArray(view?.entry_field_gaps) && view.entry_field_gaps.length > 0;
  const collapsedByShape =
    Array.isArray(view?.entries) &&
    view.entries.length > 0 &&
    view.entries.some((e) => {
      const raw = (e ?? {}) as unknown as Record<string, unknown>;
      return ENTRY_REQUIRED_FIELDS.some((k) => !(k in raw));
    });
  if (!rows.work_items || !(rows.work_items.count > 0) || collapsedByGaps || collapsedByShape) out.push(L[2]);

  // ④ 目标文件、改动类型与细节
  if (!Array.isArray(rows.targets) || rows.targets.length === 0) out.push(L[3]);

  // ⑤ 验收引用与先后依赖
  if (!Array.isArray(rows.judgement_refs) || rows.judgement_refs.length === 0) out.push(L[4]);

  // ⑥ 同任务跨文件工作面（★ 认 `plan_files`：有画布行就算工作面，哪怕这一行 0 条 entry）
  if (!rows.card_surface || !Array.isArray(rows.card_surface.plan_files) || rows.card_surface.plan_files.length === 0) {
    out.push(L[5]);
  }

  // ⑦ 实际事实基线与施工证据
  if (!rows.baseline_evidence) out.push(L[6]);

  return out;
}

/**
 * 每条缺行的**人读理由**（★ 与判据分开：判据说"缺哪行"，这里说"为什么，以及该怎么办"）。
 *
 * @param label §7.1 中文行名（= `CHANGE_SET_ROW_LABELS` 里的一个字面）
 */
function gapWhyOf(label: string, view: ChangeSetView): string {
  const card = view.card;
  switch (label) {
    case '目标、理由与验收':
      return card?.kind === 'todo'
        ? '卡是 `todos[]` 里的 **todo 卡**：判据只住节点 `decision`（`domain/task_schema.ts:1055-1070` 的 `expectationsOf`），' +
            'todo 卡**没有节点决策** ⇒ 第 1 行今天**无来源**。★ 本视图**不借** `node_id` 那个文件节点的决策 —— ' +
            '借来的"目标"是那个文件的目标，不是这张卡的（借 = 假覆盖）。'
        : '卡挂的节点**没有 decision**（`geometry.nodes[].decision` 缺失）⇒ 目标/理由/验收都无从读起。';
    case '执行责任与归属':
      return '这个 id 既不是 `geometry.nodes[].task`（节点卡），也不在 `todos[]` 里（册里查不到这张卡）——' +
        '`plans.card_id` 可能指向一张已消失的卡（`cardLivesOf` 判 `gone`）。';
    case '文件与符号级工作项':
      return view.entry_field_gaps.length > 0
        ? `画布条目**不足以当工作项**（坍缩了）：${view.entry_field_gaps.slice(0, 3).join('；')}` +
            (view.entry_field_gaps.length > 3 ? ` …另有 ${view.entry_field_gaps.length - 3} 处` : '')
        : '这张卡名下**没有任何画布行**（`tasks.db#plans` 里 `card_id` 无行）⇒ 没有工作项可读。';
    case '目标文件、改动类型与细节':
      return '没有 entry ⇒ 也就没有「目标文件 / 改动类型 / 细节」这三格。';
    case '验收引用与先后依赖':
      return '所有 entry 都**没有非空的 `judgement_ref`** ⇒ 这些改动今天**说不出拿什么验**（`planGaps` 会逐条点名同一条病）。';
    case '同任务跨文件工作面':
      return '这张卡名下没有任何画布行 ⇒ 工作面为空（★ 不是"只有一个文件"，是"一个都没有"）。';
    case '实际事实基线与施工证据':
      return '既没有冻结基线（`base.content_hash` 全空）、也没有索引读数 / 判据结果 / 施工证据 ⇒ ' +
        '「改动是不是安全」今天**不可判**（§7.3：不可验证可以保留改动，但不能标记完成）。';
    default:
      return '缺（未归类的原因 —— 这是本视图的漏洞，请补 `gapWhyOf`）。';
  }
}

/**
 * 把「现有对象」组装成 **ChangeSet 视图**。
 *
 * 判据（三条，缺一不算）：
 * ① **不坍缩**：`entries` 逐字段搬齐（含 `depends_on`），文件级工作项（`symbol: null`）与 `done` 项一律保留；
 * ② **不静默**：七行缺哪几行进 `missing`，逐条缺字段进 `entry_field_gaps`；
 * ③ **不落盘**：本函数只见普通数据（连 `fs` 都碰不到 —— 零 import 是结构保证，不是纪律）。
 */
export function assembleChangeSet(input: ChangeSetInput): ChangeSetView {
  const card = input?.card ?? null;
  const decision = input?.decision ?? null;
  const plans = input?.plans ?? [];
  const judgements = input?.judgements ?? [];
  const evidence = input?.evidence ?? [];
  const index = input?.index ?? null;

  // ── entries：全量搬（★ 这一格就是「不许坍缩」的落点）
  const entries: ChangeSetEntry[] = [];
  const raws: ChangeSetEntryInput[] = [];
  for (const p of plans) {
    const file = typeof p?.file === 'string' ? p.file : '';
    for (const e of p?.entries ?? []) {
      const raw = (e ?? {}) as ChangeSetEntryInput;
      raws.push({ ...raw, file });
      const kindRaw = typeof raw.kind === 'string' ? raw.kind : '';
      const statusRaw = typeof raw.status === 'string' ? raw.status : '';
      entries.push({
        file,
        symbol: strOrNull(raw.anchor?.symbol),
        // ★ 认不出的 kind/status ⇒ 落回最保守的那一格（`rewrite` / `open`），**不丢这一条**
        kind: (kindRaw === 'create' || kindRaw === 'delete' || kindRaw === 'rewrite' ? kindRaw : 'rewrite') as ChangeSetEntryKind,
        detail: typeof raw.detail === 'string' ? raw.detail : '',
        judgement_ref: typeof raw.judgement_ref === 'string' ? raw.judgement_ref : '',
        ...(typeof raw.judgement_kind === 'string' ? { judgement_kind: raw.judgement_kind } : {}),
        depends_on: Array.isArray(raw.depends_on) ? raw.depends_on.map(String) : [],
        status: (statusRaw === 'done' || statusRaw === 'stale' || statusRaw === 'open' ? statusRaw : 'open') as ChangeSetEntryStatus,
        ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
        ...(typeof raw.done_at === 'string' ? { done_at: raw.done_at } : {}),
      });
    }
  }
  const entry_field_gaps = entryFieldGaps(raws);

  // ── ① 目标、理由与验收（四个字段，缺哪个记进 `unstated`）
  const exps = decision?.expectations ?? [];
  const expectation_kinds = exps.map((x) => (typeof x?.kind === 'string' ? x.kind : '')).filter(Boolean);
  const summary = decision ? strOrNull(decision.summary) : null;
  const rationale = decision ? strOrNull(decision.rationale) : null;
  const acceptance = decision ? strOrNull(decision.acceptance) : null;
  const goal_why_acceptance: ChangeSetGoalRow | null = decision
    ? {
        summary,
        rationale,
        acceptance,
        expectation_count: exps.length,
        expectation_kinds,
        unstated: [
          ...(rationale ? [] : ['理由（`decision.rationale` 空）']),
          ...(acceptance ? [] : ['验收那句话（`decision.acceptance` 空）']),
          ...(exps.length > 0 ? [] : ['可判验收（`decision.expectations` 0 条）']),
        ],
      }
    : null;

  // ── ② 执行责任与归属
  const ownership: ChangeSetOwnershipRow | null =
    card && card.id
      ? {
          card_id: card.id,
          kind: card.kind,
          feature: card.feature ?? null,
          node_id: card.node_id ?? null,
          state: card.state ?? null,
          owner: card.owner ?? null,
          claimed_at: card.claimed_at ?? null,
          life: card.life ?? null,
        }
      : null;

  // ── ③ 文件与符号级工作项（计数 + 逐文件分布）
  const by_file = uniq(entries.map((e) => e.file)).map((file) => ({
    file,
    count: entries.filter((e) => e.file === file).length,
  }));
  const work_items: ChangeSetWorkItemsRow | null = entries.length > 0 ? { count: entries.length, by_file } : null;

  // ── ④ 目标文件、改动类型与细节
  const targets: ChangeSetTargetRow[] = entries.map((e) => ({
    file: e.file,
    symbol: e.symbol,
    kind: e.kind,
    detail: e.detail,
  }));

  // ── ⑤ 验收引用与先后依赖（把判据现算结论并进来）
  const verdictIndex = new Map<string, { verdict: string; detail: string }>();
  for (const j of judgements) verdictIndex.set(`${j.file}#${j.judgement_ref}`, { verdict: j.verdict, detail: j.detail });
  const judgement_refs: ChangeSetJudgementRefRow[] = entries
    .filter((e) => !!e.judgement_ref)
    .map((e) => {
      const hit = verdictIndex.get(`${e.file}#${e.judgement_ref}`);
      return {
        file: e.file,
        symbol: e.symbol,
        judgement_ref: e.judgement_ref,
        ...(e.judgement_kind ? { judgement_kind: e.judgement_kind } : {}),
        depends_on: e.depends_on,
        verdict: hit?.verdict ?? null,
        detail: hit?.detail ?? null,
      };
    });

  // ── ⑥ 同任务跨文件工作面（★ 由 entries 派生；`plan_files` 另存"有画布行的文件"）
  const plan_files = uniq(plans.map((p) => (typeof p?.file === 'string' ? p.file : '')));
  const files = uniq(entries.map((e) => e.file));
  const files_only_done = uniq(entries.filter((e) => e.status === 'done').map((e) => e.file)).filter(
    (f) => !entries.some((e) => e.file === f && e.status !== 'done'),
  );
  const files_file_level = uniq(entries.filter((e) => e.symbol === null).map((e) => e.file));
  const dissolved_files = uniq(plans.filter((p) => !!p?.dissolved_at).map((p) => (typeof p.file === 'string' ? p.file : '')));
  const card_surface: ChangeSetSurfaceRow | null =
    plan_files.length > 0 || files.length > 0
      ? { files, plan_files, files_only_done, files_file_level, dissolved_files }
      : null;

  // ── ⑦ 实际事实基线与施工证据
  const frozen = plans.map((p) => ({
    file: typeof p?.file === 'string' ? p.file : '',
    base_content_hash: strOrNull(p?.base_content_hash),
    frozen_at: strOrNull(p?.frozen_at),
    symbols_at_freeze: Array.isArray(p?.symbols_at_freeze) ? p.symbols_at_freeze.length : null,
    fps_at_freeze: typeof p?.fps_at_freeze_count === 'number' ? p.fps_at_freeze_count : null,
  }));
  const tally = { pass: 0, fail: 0, unsupported: 0, pending: 0, unresolved: 0 };
  for (const j of judgements) {
    const v = String(j.verdict ?? '');
    if (v === 'pass' || v === 'fail' || v === 'unsupported' || v === 'pending' || v === 'unresolved') tally[v] += 1;
  }
  const indexFacts: ChangeSetIndexFactInput[] = (index ?? []).slice();
  const hasBaseline =
    frozen.some((f) => !!f.base_content_hash) ||
    indexFacts.length > 0 ||
    judgements.length > 0 ||
    evidence.length > 0;
  const baseline_evidence: ChangeSetBaselineRow | null = hasBaseline
    ? {
        frozen,
        index: indexFacts,
        judgements: judgements.map((j) => ({
          file: j.file,
          symbol: j.symbol ?? null,
          judgement_ref: j.judgement_ref,
          verdict: j.verdict,
          detail: j.detail,
        })),
        judgement_tally: tally,
        evidence: evidence.slice(),
      }
    : null;

  const view: ChangeSetView = {
    card,
    feature: card?.feature ?? null,
    rows: { goal_why_acceptance, ownership, work_items, targets, judgement_refs, card_surface, baseline_evidence },
    entries,
    entry_field_gaps,
    missing: [],
  };
  // ★ 缺行只算一处：让 `changeSetRowGaps` 判，本函数只把结论配上理由（不另写一份判据）
  view.missing = changeSetRowGaps(view).map((row) => ({ row, why: gapWhyOf(row, view) }));
  return view;
}
