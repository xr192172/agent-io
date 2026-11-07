/**
 * 槽来源表（slot_source）—— 「人工必填槽」的**静态来源声明表** = F 的计量骨架 + C 段的规格书
 *
 * ## 它回答什么
 * `OP_SPECS` 说「某个 `(type, op)` 必须给哪些 `data` 键」，但**不说这些键的值从哪来**。
 * F（人工必填槽数）要的正是那一维：哪些键只能人/模型给（`model`），哪些能从仓里现取。
 *
 * ## 判据一处（本仓头号纪律）
 * **键的存在性只在 `OP_SPECS`**；本文件**只加「来源」这一维**，且 `checkSlotSources()` 双向卡死：
 * **少 ⇒ `undeclared`（漏声明）· 多 ⇒ `ghost`（第二份键清单）**。
 * ⇒ `OP_SPECS` 加了一个 required 键而这里没加来源 ⇒ **当场红**（判据②「跨源一致」）。
 *
 * ## 形状为什么是 `type → key`（22 条）而不是 `type → op → key`（39 条）
 * 实测 39 个槽只对应 **22 个不同 `(type, key)`**（`reason` 10 次 / `owner` 4 / `summary` 2 /
 * `ids` 2 / `signature` 2 / `snapshot_id` 2 / `tag` 2）⇒ 三维写法会造出 **17 条字面重复声明**，
 * 而重复之间"该不该一致"**没有任何判据能判**（它们合法地可以不同）。
 * ⇒ 二维 + {@link SLOT_OVERRIDES} 兜 op 级例外（目前恰好 1 条：`api/add.signature`）。
 *
 * ## 四个来源的口径（问的是「值的**内容**从哪来」）
 * · `actual-db` —— 索引 / 磁盘 / **台账**里的既成事实，且能唯一确定
 *   （`file_id`、最新 `snapshot_id`、台账里那张卡）；
 * · `design`    —— 册上**已写下的原文**，逐字搬（要删的那条签名 / 已有标签 / 旧 summary / 全量 goals）；
 * · `rule`      —— 由**已给入参 / 身份 / 上游回执**确定性变换而来，**没有新信息进系统**
 *   （`owner ← actor` / `evidence ← 判据批回执` / `status ← 卡态` / `label ← 时间戳`）；
 * · `model`     —— 必须**新写出、或特指一个值**（哪怕候选可枚举，选哪个仍是人的事）：
 *   `reason` / `path` / 端点 / 判据语义 / 职责文本。
 *
 * ## 诚实边界（别在别处包装）
 * `checkSlotSources()` 判的是「**取法被声明了、且不自循环**」，**它不能**判「语义上永远取得到」。
 * "真能取到"的证明在 C 段：**每个 `model` 槽的每个实例，要么被 provider 填上、要么被显式署名**。
 * ⇒ `SLOT_PROVIDERS` 现在只有 `from` / `needs` 两个字段；把它变成可执行函数体，就是 C 段的第一笔增量。
 */
import { OP_SPECS, type OpSpec } from './op_data_spec.js';

/** 一个 required 键的值的来源。 */
export type SlotSource = 'actual-db' | 'design' | 'rule' | 'model';

/** 取法（provider）的**数据面** —— 它与 `SlotSource` 必须有对应关系，见 {@link PROVIDER_FROM_FITS}。 */
export type ProviderFrom =
  | 'index'
  | 'disk'
  | 'ledger'
  | 'design-book'
  | 'actor'
  | 'judge-receipt'
  | 'card-state'
  | 'generated';

/** ★ **来源 → 允许的取法**（同一条纪律的第二个落点：声明不能与取法打架）。 */
export const PROVIDER_FROM_FITS: Readonly<Record<SlotSource, readonly ProviderFrom[]>> = {
  'actual-db': ['index', 'disk', 'ledger'],
  design: ['design-book'],
  rule: ['actor', 'judge-receipt', 'card-state', 'generated'],
  model: [],
};

/**
 * 一条声明。
 * ★ `requires` = 「这条 `source` 成立的条件」。缺省 = 无条件成立；
 *   给了就**必须**有运行时见证（`SlotWitness`）兑现，否则一律按 `model` 记 ——
 *   **不知道就不许记白**（把"人工成本"高估比低估安全：低估会让 C 段看起来已经做完了）。
 */
export interface SlotDecl {
  readonly source: SlotSource;
  /** 凭什么这个键是这个来源（人读；`model` 的必须说清"为什么机器给不出"）。 */
  readonly why: string;
  readonly requires?: { readonly allGreen?: true; readonly unsupported?: 0 };
}

/** `type → key → 声明`（22 条）。★ 键的存在性仍只有 `OP_SPECS` 一处 —— 这里只是"来源"这一维。 */
export type SlotTable = Readonly<Record<string, Readonly<Record<string, SlotDecl>>>>;

/** op 级例外：键为 `'<type>/<op>.<key>'`。★ 只在**同一个键在不同 op 上来源确实不同**时才用。 */
export type SlotOverrides = Readonly<Record<string, SlotDecl>>;

/** 取法声明：`from` = 取法面；`needs` = 它还需要哪些**入参**（★ 不许包含该 op 的 required 键，见 `provider-cycle`）。 */
export interface SlotProvider {
  readonly from: ProviderFrom;
  readonly needs: readonly string[];
}
export type SlotProviders = Readonly<Record<string, SlotProvider>>;

/** 判据批的运行时见证（只有带 `requires` 的声明需要）。 */
export interface SlotWitness {
  readonly allGreen?: boolean;
  readonly unsupported?: number;
}

/** 违规码（判据①②③ 的唯一出口；每条都能点名槽）。 */
export type SlotViolationCode =
  | 'undeclared'
  | 'ghost'
  | 'ghost-override'
  | 'uncovered'
  | 'overclaimed'
  // ★★★ 2026-11-07（T-40）：下面两码补的是「**声明了取法**」与「**取法真的存在且取得到**」之间的那道缝。
  | 'provider-missing'
  | 'provider-unrunnable'
  | 'provider-cycle'
  | 'bad-provider-from';

export interface SlotViolation {
  readonly code: SlotViolationCode;
  /** 违规的槽：`<type>/<op>.<key>`（op 级）或 `<type>.<key>`（type 级）。 */
  readonly slot: string;
}

/**
 * ★★★ **唯一来源表**（22 条，覆盖 `OP_SPECS` 的 39 个 required 槽）。
 * 逐条判定的口径见文件头「四个来源」；每条的 `why` 都指名了证据（函数/表/纪律）。
 */
export const SLOT_SOURCES: SlotTable = {
  edge: {
    from: { source: 'model', why: '特指哪个端点；候选可从 import 图枚举，但选哪一对是意图' },
    to: { source: 'model', why: '同上' },
  },
  file: {
    path: { source: 'model', why: '特指"哪个文件"（P22 里登记刚写的文件时可退 rule，一般态是 model）' },
    responsibility: { source: 'model', why: '职责是新写出的语义文本（import_project 的 gen_roles 也是 LLM 生成）' },
  },
  api: {
    // ★ 唯一的 op 级例外在 SLOT_OVERRIDES：add 的签名可从 AST 现取（actual-db），delete 的必须逐字取自册（design）。
    signature: { source: 'design', why: '要删/要改的那条必须逐字取自 expected_apis（册上已有原文）' },
  },
  binding: {
    file_id: { source: 'actual-db', why: '由路径/文件节点 id 归一，唯一（resolveDecisionTarget 同一把尺）' },
  },
  status: {
    status: { source: 'rule', why: '派生自卡态（task_schema.ts#progressOf）；手填它本身就不该发生' },
  },
  snapshot: {
    label: { source: 'rule', why: '可机械生成 pre-<tool>-<iso>；人想表达语义时才需要 model' },
    snapshot_id: { source: 'actual-db', why: '"latest" = 最近一份，唯一（snapshot store 现取）' },
  },
  tag: {
    // ★ base 判 add（新增标签名 = 新语义）；delete 要逐字取册上已有名字 ⇒ 走 SLOT_OVERRIDES。
    tag: { source: 'model', why: '新增标签名是新语义（tag/add 才是常态那条）' },
  },
  decision: {
    summary: { source: 'design', why: 'P13 要求"每次都带"⇒ 多数是原样搬旧卡 summary（真改判据语义时才是 model）' },
  },
  todo: {
    summary: { source: 'model', why: '新卡的说法（todo/add）或改后的说法（todo/update）' },
    node_id: { source: 'model', why: '特指挂到哪个节点' },
    cards: { source: 'actual-db', why: 'todo/import 只搬台账（tasks.jsonl）里已存在的整卡 ⇒ 内容逐字来自台账' },
    reason: { source: 'model', why: '为什么改/为什么作废/为什么删/为什么重接 —— L3 要求文本里点名实体，是语义判断' },
    ids: { source: 'model', why: '挑哪些卡（批量 op 的选择点）' },
  },
  excluded: {
    excluded: { source: 'model', why: '新的排除声明（path + 为什么不管）是语义内容' },
  },
  task: {
    owner: { source: 'rule', why: '← 顶层 actor（write_gate.ts:1404：claim 与写共用同一个来源 ⇒ 才保证 owner===actor）' },
    reason: { source: 'model', why: '为什么放回/弃做/又开/重立 —— 语义判断，不是既有事实' },
    evidence: {
      source: 'rule',
      why: '判据批回执可直接折成 {kind:"expectations",all_green,unsupported:0}（T334 的机器档）',
      // ★ 回退条件：只有"全绿且 unsupported===0"才轮得到机器档；否则只能 attestation（含自由文本 why）⇒ 退回 model。
      requires: { allGreen: true, unsupported: 0 },
    },
  },
  goal: {
    goals: { source: 'design', why: '全量替换 ⇒ 必须先读旧再合并（读-改-写机械；新增条目才是 model）' },
  },
  edge_intent: {
    edge_intents: { source: 'design', why: '同上：全量替换，内容来自册上既有边意图' },
  },
};

/**
 * ★★ op 级例外（**2 条**，都是"同一个键在不同 op 上来源确实不同"）：
 * · `api/add.signature` —— add 的签名是"代码里那个符号的**真实签名**"（AST 现取，`sync_contracts` 是既有实现）；
 *   而 `api/delete.signature` 必须逐字取自册上已有的一条（base = design）。
 * · `tag/delete.tag` —— delete 要逐字取册上已有的标签名（design）；而 `tag/add.tag` 是新增名字（base = model）。
 * ★ 这条第二例是**判据③ 第一次跑就抓出来的**（`uncovered: tag/add.tag`）：我原先把 base 判成 design，
 *   等于给 `tag/add` 也声明了"能从册上搬到"——而新名字根本不册上。
 * ★ 若例外涨到 >3 条，就该把表升成 `type → op → key` —— 现在不值得为 2 条付那 17 条重复。
 */
export const SLOT_OVERRIDES: SlotOverrides = {
  'api/add.signature': { source: 'actual-db', why: '要加的签名 = 该符号在代码里的真实签名（AST 现取）；sync_contracts 是同一件事的既有实现' },
  'tag/delete.tag': { source: 'design', why: '要删的标签名必须逐字取自册上已有的一条（册上事实）' },
};

/**
 * 取法声明（`from` / `needs`）—— ★ **不是第二份键清单**：键仍来自 `OP_SPECS`，
 * 这里只回答"取它需要什么"。`needs` 里**不许**出现该 op 的 required 键（那是"拿必填填必填"= 循环）。
 */
export const SLOT_PROVIDERS: SlotProviders = {
  'api/add.signature': { from: 'index', needs: [] },
  'binding/update.file_id': { from: 'index', needs: [] },
  'snapshot/rollback.snapshot_id': { from: 'ledger', needs: [] },
  'snapshot/delete.snapshot_id': { from: 'ledger', needs: [] },
  'todo/import.cards': { from: 'ledger', needs: [] },
  'api/delete.signature': { from: 'design-book', needs: [] },
  'tag/delete.tag': { from: 'design-book', needs: [] },
  'decision/update.summary': { from: 'design-book', needs: [] },
  'goal/set.goals': { from: 'design-book', needs: [] },
  'edge_intent/set.edge_intents': { from: 'design-book', needs: [] },
  'status/update.status': { from: 'card-state', needs: [] },
  'snapshot/save.label': { from: 'generated', needs: [] },
  'task/claim.owner': { from: 'actor', needs: [] },
  'task/start.owner': { from: 'actor', needs: [] },
  'task/reopen.owner': { from: 'actor', needs: [] },
  'task/renew.owner': { from: 'actor', needs: [] },
  // ★ 取法面 = 判据批回执；`needs` 里点名它要的那份回执（不是 required 键）。
  'task/complete.evidence': { from: 'judge-receipt', needs: [] },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ★★★ 取法的**可执行实现** —— C 段第一笔增量（2026-11-07 · T-40）
//
// ## 它补的是哪道缝
// 在此之前 `SLOT_PROVIDERS` 只有 `from` / `needs` 两个**声明**字段，全仓**没有人写实现**，
// 而 `checkSlotSources()` 只看声明形状 ⇒ 那 17 条「非 model ⇒ 必须有取法」**全是空话**
// （实测：给一个纯声明、零实现的 provider，`checkSlotSources` 返回 `[]`）。
// ⇒ 判据③ 的第二半（`provider-missing` / `provider-unrunnable`）钉的就是这道缝。
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 取法运行时能看到的**既有事实**（一个上下文对象）。
 * ★ 缺哪一格 ⇒ 那个取法必须说 `{ok:false, why:'缺上下文：<格>'}` —— **不许拿默认值顶上**
 *   （编出来的值会被读成"已经自动了"，比"没接"更坏）。
 */
export interface SlotContext {
  /** 顶层 `actor`（`task/{claim,start,reopen,renew}.owner ← actor` 的唯一来源）。 */
  readonly actor?: string;
  /** 卡态（`status/update.status`）。 */
  readonly cardState?: string;
  /** 调用时刻（ISO 串；`snapshot/save.label` = `pre-<tool>-<now>`）。 */
  readonly now?: string;
  /** 工具名（同上）。 */
  readonly tool?: string;
  /** 台账里最近一份快照 id（`snapshot/rollback|delete.snapshot_id`）。 */
  readonly latestSnapshotId?: string;
  /** 台账（`tasks.jsonl` / `todos[]`）里的整卡清单（`todo/import.cards`）。 */
  readonly ledgerCards?: readonly unknown[];
  /** 该符号在代码里的真实签名（`api/add.signature`：AST 现取，`sync_contracts` 是同一件事）。 */
  readonly symbolSignature?: string;
  /** 册上那条要删的签名（`api/delete.signature`：必须逐字取自册）。 */
  readonly bookSignature?: string;
  /** 册上已有的一条标签名（`tag/delete.tag`）。 */
  readonly bookTag?: string;
  /** 册上这张卡现有的 summary（`decision/update.summary`）。 */
  readonly bookSummary?: string;
  /** 册上既有 goals 全集（`goal/set.goals`；★ **空数组合法**，`undefined` 不合法）。 */
  readonly bookGoals?: readonly unknown[];
  /** 册上既有边意图全集（`edge_intent/set.edge_intents`；同上）。 */
  readonly bookEdgeIntents?: readonly unknown[];
  /** 由路径归一出的文件节点 id（`binding/update.file_id`；`resolveDecisionTarget` 同一把尺）。 */
  readonly resolvedFileId?: string;
  /** 判据批回执（`task/complete.evidence` 机器档的唯一来源：`allGreen ∧ unsupported===0`）。 */
  readonly judgeReceipt?: { readonly allGreen?: boolean; readonly unsupported?: number };
}

/** 一条取法的结果：算出了值，或说清缺什么。**第三种态不许有**（沉默的成功 = 假绿）。 */
export type SlotValue =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly why: string };

/** 一条取法的**可执行实现**。 */
export type SlotProviderImpl = (ctx: SlotContext) => SlotValue;

/** `槽 id → 实现`（键集必须与 {@link SLOT_PROVIDERS} 完全一致，见 {@link SLOT_PROVIDER_IMPLS}）。 */
export type SlotProviderImpls = Readonly<Record<string, SlotProviderImpl>>;

const got = (value: unknown): SlotValue => ({ ok: true, value });
const miss = (field: string): SlotValue => ({ ok: false, why: `缺上下文：${field}` });

/**
 * ★★★ **17 条取法的可执行实现**（与 `SLOT_PROVIDERS` 的键一一对应）。
 *
 * ## 三条口径（都能被验，见 `tests/p0_slot_source.test.ts` 与节点上的 4 条 behavior-cases）
 * ① **键集等式**：多一条（没有声明）少一条（声明了没实现）都算错 —— 少的那条由 `provider-missing` 报，
 *    多的那条由测试里的集合等式报（这一档**故意不新增违规码**：9 码封顶，见 `SlotViolationCode`）；
 * ② **缺上下文 ⇒ `{ok:false, why:'缺上下文：<格>'}`**，**绝不编值**；
 * ③ **给了那一格就必须出值** —— 不在取法里做第二重判断（"该不该自动"住在写路径）。
 *
 * ★ 诚实边界：**这 17 条还没被写路径消费**（`resolveSlot` 是唯一调用口，今天调用方 = 0）。
 *   ⇒ 它们此刻证明的是"取法是**可执行且零发明**的"，**不是**"这些槽已经不用人给了"。
 *   那件事的判据是"值真被写路径消费"（C 段的下一个增量），不在本文件里假装完成。
 */
export const SLOT_PROVIDER_IMPLS: SlotProviderImpls = {
  'api/add.signature': (c) => (c.symbolSignature ? got(c.symbolSignature) : miss('symbolSignature')),
  'api/delete.signature': (c) => (c.bookSignature ? got(c.bookSignature) : miss('bookSignature')),
  'binding/update.file_id': (c) => (c.resolvedFileId ? got(c.resolvedFileId) : miss('resolvedFileId')),
  'decision/update.summary': (c) => (c.bookSummary ? got(c.bookSummary) : miss('bookSummary')),
  // ★ 空数组是**合法值**（`goals` / `edge_intents` 的"清空"就是一个合法意图）⇒ 判据是 `Array.isArray`，
  //   不是"非空"；`undefined` 才是"没给"。
  'edge_intent/set.edge_intents': (c) =>
    Array.isArray(c.bookEdgeIntents) ? got(c.bookEdgeIntents) : miss('bookEdgeIntents'),
  'goal/set.goals': (c) => (Array.isArray(c.bookGoals) ? got(c.bookGoals) : miss('bookGoals')),
  'snapshot/delete.snapshot_id': (c) => (c.latestSnapshotId ? got(c.latestSnapshotId) : miss('latestSnapshotId')),
  'snapshot/rollback.snapshot_id': (c) => (c.latestSnapshotId ? got(c.latestSnapshotId) : miss('latestSnapshotId')),
  // ★ "label 可以机械生成"（见 SLOT_SOURCES 里那条 why）—— 这就是那句话的可执行形态。
  'snapshot/save.label': (c) => (c.now ? got(`pre-${c.tool ?? 'edit_dsl'}-${c.now}`) : miss('now')),
  'status/update.status': (c) => (c.cardState ? got(c.cardState) : miss('cardState')),
  'tag/delete.tag': (c) => (c.bookTag ? got(c.bookTag) : miss('bookTag')),
  'task/claim.owner': (c) => (c.actor ? got(c.actor) : miss('actor')),
  // ★★ 唯一一个"带条件的取法"：形状被 `domain/overlay.ts:98` 钉死成
  //   `{kind:'expectations', all_green:true, unsupported:0}` ⇒ 只有"全绿且 unsupported===0"才成立；
  //   否则**必须**返回 not-ok（那两档的正确答案是"退回人工 attestation"，不是"凑一个绿"）。
  'task/complete.evidence': (c) => {
    const r = c.judgeReceipt;
    if (!r) return miss('judgeReceipt');
    if (r.allGreen !== true) return { ok: false, why: '判据批不全绿 ⇒ 机器档不成立' };
    if (r.unsupported !== 0) return { ok: false, why: '判据批有 unsupported ⇒ 那不算通过' };
    return got({ kind: 'expectations', all_green: true, unsupported: 0 });
  },
  'task/reopen.owner': (c) => (c.actor ? got(c.actor) : miss('actor')),
  'task/renew.owner': (c) => (c.actor ? got(c.actor) : miss('actor')),
  'task/start.owner': (c) => (c.actor ? got(c.actor) : miss('actor')),
  'todo/import.cards': (c) =>
    Array.isArray(c.ledgerCards) && c.ledgerCards.length > 0 ? got(c.ledgerCards) : miss('ledgerCards'),
};

/**
 * ★ **声明 ↔ 实现的差集**：`[声明了却没实现的…, 有实现却没声明的…]`（两侧都算错，确定性有序）。
 *
 * 它就是「**空话声明**」的机读形态：空数组 = 每一句"我会自动取"背后都真的有一条实现。
 * ★ 为什么要有它（而不是只留 `provider-missing`）：`checkSlotSources` 要在**夹具**上判，
 *   而"**真表**里每条声明都有实现"这件事得有一个**不吃参数**的入口 —— 判据（behavior-cases）
 *   只能传 JSON，拿不到 `OP_SPECS` / 真表的引用。
 */
export function slotProviderGaps(
  providers: SlotProviders = SLOT_PROVIDERS,
  impls: SlotProviderImpls = SLOT_PROVIDER_IMPLS,
): string[] {
  const declared = Object.keys(providers);
  const implemented = Object.keys(impls);
  const missing = declared.filter((slot) => !implemented.includes(slot));
  const ghost = implemented.filter((slot) => !declared.includes(slot));
  return [...missing, ...ghost].sort();
}

/**
 * 取法的**唯一调用口**（写路径只许走这里，别直接 `SLOT_PROVIDER_IMPLS[slot](ctx)` ——
 * 那样"这条根本没有实现"就没人报了）。
 */
export function resolveSlot(
  slot: string,
  ctx: SlotContext,
  impls: SlotProviderImpls = SLOT_PROVIDER_IMPLS,
): SlotValue {
  const impl = impls[slot];
  if (!impl) return { ok: false, why: `没有取法实现：${slot}` };
  return impl(ctx);
}

/**
 * ★ **棘轮读数**：在**这一个上下文**下取不到的槽（确定性有序，键集从 `SLOT_PROVIDERS` 现取 ——
 * 不是第二份清单）。
 *
 * 它把"**声明了会自动取、其实还没接**"变成一张明账：这张账**只许变短**
 * （每接一条真取法就少一条；变长 = 有人把取法接断了，或者上下文少了某格）。
 */
export function unrunnableSlots(probe: SlotContext, impls: SlotProviderImpls = SLOT_PROVIDER_IMPLS): string[] {
  const out: string[] = [];
  for (const slot of Object.keys(SLOT_PROVIDERS).sort()) {
    const impl = impls[slot];
    if (!impl) continue; // 没有实现的那条由 `provider-missing` 报 —— 同一个事实不报两遍
    let v: SlotValue;
    try {
      v = impl(probe);
    } catch {
      out.push(slot); // 实现自己抛 ⇒ 也算"取不到"（不许因为抛错就当它没出现）
      continue;
    }
    if (!v.ok) out.push(slot);
  }
  return out;
}

/** 只取校验需要的三格（`OpSpec` 之外的形状也认 —— 判据里会用夹具 spec）。 */
export interface SlotSpecLike {
  readonly type: string;
  readonly ops?: readonly string[];
  readonly required?: Readonly<Record<string, readonly string[]>>;
}

const T = (type: string, op: string, key: string): string => `${type}/${op}.${key}`;

/** 某个 `(type, op, key)` 的声明（override 优先）。 */
export function slotDeclOf(
  type: string,
  op: string,
  key: string,
  table: SlotTable = SLOT_SOURCES,
  overrides: SlotOverrides = SLOT_OVERRIDES,
): SlotDecl | undefined {
  return overrides[T(type, op, key)] ?? table[type]?.[key];
}

/**
 * 某个槽的**实际**来源 —— 与 {@link slotDeclOf} 的唯一区别：带 `requires` 的声明要**见证**兑现。
 * ★ 没有见证 ⇒ 按 `model` 记（**不知道就不许记白**）。
 */
export function slotSourceOf(
  type: string,
  op: string,
  key: string,
  witness?: SlotWitness | null,
  table: SlotTable = SLOT_SOURCES,
  overrides: SlotOverrides = SLOT_OVERRIDES,
): SlotSource | undefined {
  const d = slotDeclOf(type, op, key, table, overrides);
  if (!d) return undefined;
  if (!d.requires) return d.source;
  const ok = witness?.allGreen === true && witness.unsupported === 0;
  return ok ? d.source : 'model';
}

/**
 * 某个槽的**声明**来源（忽略 `requires` 的运行时兑现）。
 * ★ 为什么取法检查要看它而不是 {@link slotSourceOf}：带 `requires` 的声明（如 `task/complete.evidence`）
 * 在**没有见证**时按 `model` 记（不许记白），但那不等于"它被声明成必须人给" ——
 * 拿后者去比取法会把它误判成 `overclaimed`（★ 判据③ 第一次跑就抓到了这一条）。
 */
export function slotDeclaredSourceOf(
  type: string,
  op: string,
  key: string,
  table: SlotTable = SLOT_SOURCES,
  overrides: SlotOverrides = SLOT_OVERRIDES,
): SlotSource | undefined {
  return slotDeclOf(type, op, key, table, overrides)?.source;
}

/** 某个 `(type, op)` 的 required 键（顺序即 `OP_SPECS` 里的顺序）。 */
export function requiredKeysOf(specs: readonly SlotSpecLike[], type: string, op: string): string[] {
  const spec = specs.find((s) => s.type === type);
  const keys = spec?.required?.[op];
  return keys ? [...keys] : [];
}

/**
 * ★ **F 的计量入口**：某个 `(type, op)` 里落进 `model` 的键（= 人/模型必须给的那些）。
 * ★ 它返回**键名数组**（不是计数）：读数要能点名"哪几个槽"，只有数字没法审计。
 */
export function manualSlotsOf(
  specs: readonly SlotSpecLike[],
  type: string,
  op: string,
  witness?: SlotWitness | null,
  table: SlotTable = SLOT_SOURCES,
  overrides: SlotOverrides = SLOT_OVERRIDES,
): string[] {
  return requiredKeysOf(specs, type, op).filter((k) => slotSourceOf(type, op, k, witness, table, overrides) === 'model');
}

/**
 * ★★★ **判据 ①②③ 的唯一实现**（只读、纯函数、无副作用）。
 *
 * | 码 | 判据 | 什么情形下红 |
 * |---|---|---|
 * | `undeclared` | ① 无漏声明 / ② 跨源一致 | `OP_SPECS` 有 required 键而表里没来源（**新增键不改表 ⇒ 红**） |
 * | `ghost` | ② 反方向 | 表里有 `(type,key)`，但 `OP_SPECS` 里**没有任何 op** 要求它 ⇒ 这是第二份键清单 |
 * | `ghost-override` | ② 反方向 | override 指向的 `(type,op,key)` 在 `OP_SPECS` 里不存在 |
 * | `uncovered` | ③ 来源分类可反驳 | 声明了非 `model`，却**没有取法** ⇒ 那句声明是空话 |
 * | `overclaimed` | ③ 反方向 | 声明是 `model`（要人手给），却有取法 ⇒ 虚报人工成本 |
 * | `provider-missing` | ③ 第三半（2026-11-07 T-40） | 声明了取法，却**没有可执行实现** ⇒ 那句"我会自动取"是自我安慰 |
 * | `provider-unrunnable` | ③ 第三半 | 有实现，但**给了探针也取不到**（`{ok:false}` / 抛）⇒ 声明了却拿不到 |
 * | `provider-cycle` | ③ | 取法的 `needs` 里出现了该 op 的 required 键 ⇒ 拿必填填必填 |
 * | `bad-provider-from` | ③ | `from` 与声明的 `source` 对不上（如 design 的槽挂了一个 `index` 取法） |
 *
 * ★ 输出**确定性有序**：先逐 spec（specs 顺序 × ops 顺序 × required 顺序），再表键（排序），再 override（排序）。
 */
export function checkSlotSources(
  specs: readonly SlotSpecLike[],
  table: SlotTable = SLOT_SOURCES,
  overrides: SlotOverrides = SLOT_OVERRIDES,
  providers: SlotProviders = SLOT_PROVIDERS,
  // ★★★ 2026-11-07（T-40）：第 5 参 = 取法的**可执行实现**（`null` = 用真表；允许 null 是为了让
  //   `behavior-cases` 的 JSON 夹具能同时表达「用真实现」与「给一个空实现表」两种输入）。
  impls: SlotProviderImpls | null = SLOT_PROVIDER_IMPLS,
  // ★ 第 6 参 = **探针上下文**（给了才判 `provider-unrunnable`；不给就不判 ——
  //   凭空说"取不到"同样是编)。
  probe?: SlotContext | null,
): SlotViolation[] {
  const out: SlotViolation[] = [];
  const requiredPairs = new Map<string, Set<string>>(); // type → 该 type 任 op 要求的键集

  for (const spec of specs) {
    const type = spec.type;
    const keysOfType = requiredPairs.get(type) ?? new Set<string>();
    requiredPairs.set(type, keysOfType);
    for (const op of spec.ops ?? []) {
      for (const key of spec.required?.[op] ?? []) {
        keysOfType.add(key);
        if (!slotDeclOf(type, op, key, table, overrides)) out.push({ code: 'undeclared', slot: T(type, op, key) });
      }
    }
  }

  for (const type of Object.keys(table).sort()) {
    const keysOfType = requiredPairs.get(type);
    for (const key of Object.keys(table[type]).sort()) {
      if (!keysOfType || !keysOfType.has(key)) out.push({ code: 'ghost', slot: `${type}.${key}` });
    }
  }

  for (const slot of Object.keys(overrides).sort()) {
    const m = /^([^/]+)\/(.+?)\.([^.]+)$/.exec(slot);
    if (!m) {
      out.push({ code: 'ghost-override', slot });
      continue;
    }
    const [, type, op, key] = m;
    const exists = specs.some((s) => s.type === type && (s.ops ?? []).includes(op) && (s.required?.[op] ?? []).includes(key));
    if (!exists) out.push({ code: 'ghost-override', slot });
  }

  for (const spec of specs) {
    for (const op of spec.ops ?? []) {
      const required = spec.required?.[op] ?? [];
      for (const key of required) {
        const slot = T(spec.type, op, key);
        const source = slotDeclaredSourceOf(spec.type, op, key, table, overrides);
        if (source === undefined) continue; // 已由 undeclared 报过
        const provider = providers[slot];
        if (source !== 'model' && !provider) {
          out.push({ code: 'uncovered', slot });
          continue;
        }
        if (source === 'model' && provider) {
          out.push({ code: 'overclaimed', slot });
          continue;
        }
        if (!provider) continue;
        // ★ 次序固定：声明面（from / needs）→ 实现面的存在性 → 实现面的可运行性。
        //   四条互不蕴含，**都要报**（"报一条藏一条"就是本仓说的那种静默）。
        if (!PROVIDER_FROM_FITS[source].includes(provider.from)) out.push({ code: 'bad-provider-from', slot });
        if (provider.needs.some((n) => required.includes(n))) out.push({ code: 'provider-cycle', slot });
        const impl = (impls ?? SLOT_PROVIDER_IMPLS)[slot];
        if (!impl) {
          // ★★★ 声明了取法、却没人写实现 ⇒ 这句话今天谁都不验（T-40 之前的真形态：17 条全中）。
          out.push({ code: 'provider-missing', slot });
        } else if (probe) {
          // ★ 给了探针就**真跑一次**：算不出值（或实现自己抛）⇒ 声明了却拿不到。
          let v: SlotValue;
          try {
            v = impl(probe);
          } catch {
            v = { ok: false, why: 'impl threw' };
          }
          if (!v.ok) out.push({ code: 'provider-unrunnable', slot });
        }
      }
    }
  }
  return out;
}

/** 一个 `(type, op)` 的读数行。 */
export interface SlotGroupReading {
  readonly type: string;
  readonly op: string;
  readonly required: number;
  readonly manual: number;
  readonly manualKeys: readonly string[];
}

/** 全表读数（`slot-stats.mjs` 与人读共用同一份实现）。 */
export interface SlotReading {
  readonly groups: number;
  readonly slots: number;
  readonly manualSlots: number;
  readonly bySource: Readonly<Record<SlotSource, number>>;
  readonly perGroup: readonly SlotGroupReading[];
}

/** 现算全表读数。★ 只数 **required 非空**的 `(type, op)`（空数组那 3 组没有槽可数）。 */
export function slotReading(specs: readonly SlotSpecLike[] = OP_SPECS): SlotReading {
  const perGroup: SlotGroupReading[] = [];
  const bySource: Record<SlotSource, number> = { 'actual-db': 0, design: 0, rule: 0, model: 0 };
  for (const spec of specs) {
    for (const op of spec.ops ?? []) {
      const required = spec.required?.[op] ?? [];
      if (required.length === 0) continue;
      for (const key of required) {
        const s = slotSourceOf(spec.type, op, key, null);
        if (s) bySource[s] += 1;
      }
      perGroup.push({
        type: spec.type,
        op,
        required: required.length,
        manual: manualSlotsOf(specs, spec.type, op).length,
        manualKeys: manualSlotsOf(specs, spec.type, op),
      });
    }
  }
  return {
    groups: perGroup.length,
    slots: perGroup.reduce((a, g) => a + g.required, 0),
    manualSlots: perGroup.reduce((a, g) => a + g.manual, 0),
    bySource,
    perGroup,
  };
}

/** ★ 供 `OpSpec` 直接喂进来的窄化（类型层：`OP_SPECS` 元素满足 `SlotSpecLike`）。 */
export type SlotSpecFromOpSpec = Pick<OpSpec, 'type' | 'ops' | 'required'>;
