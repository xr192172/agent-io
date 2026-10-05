/**
 * [B] 契约的**受控术语表**（glossary）—— ★★ **规范性的，不是描述性的**。
 *
 * 用途（用户 2026-10-01 裁定）：
 *   「**制定一张术语表**，制定一张术语表之后，再去重构整个这些工具的逻辑。
 *     因为以后也是要做的，这是**技术债**，你不还完的话，以后只会在这个地方越兜越那个。」
 *
 * 三条读法：
 *   1. **含义栏是"我们从今往后要求它是什么"**，不是"现状是什么"。
 *      现状（42 个 [B] 实际怎么用这些名字）见 `docs/b-field-dictionary.md`（机器生成）。
 *   2. `debt: true` = **现状与定义不符或一名多义** ⇒ 在拆清之前**不许再新增使用者**。
 *      债务条数见本文件导出的 `B_TERMS_DEBT`。
 *   3. **新写 [B] 时，字段名从这个表里选**；表里没有 ⇒ 要么加进来（并写含义），
 *      要么它只服务你这一个 [B]（私有字段，不进表）。
 *
 * 覆盖范围（为什么是这些词）：**出现在 ≥2 个 [B] 里的字段名**必须有一条定义
 * （只服务 1 个 [B] 的私有字段不约束 —— 实测那占 80%）。
 *
 * ★★ **接力键规则**（2026-10-05 立，T54 第一步）—— `kind: 'anchor'` 的词是**链的接口**：
 *   **上游产物给出什么名字，下游入参就用什么名字。**
 *   · **产物侧** = `Touched` 的字段；**入参侧** = 工具接受的那几个名字（两者是**同一批名字**）。
 *   · ★ **判据：不许同义异名**。实测反例（2026-10-05）：
 *     `get_dsl(query='files')` 产出的每个条目用 **`path`** 指文件，而 `find_references` 的入参叫 **`file`**
 *     ⇒ 中间必须由**调用方翻译**一次，而**翻译会错** ⇒ 这就是"链接不上"的实体。
 *   · ★ 单数/复数是**同一族的两种形态**：`file` ↔ `written_files`、
 *     `symbol` ↔ `symbols`、`node_id` ↔ `nodes`（词表已写明"新写 [B] 一律用复数"）。
 *   · ★ 量具 `measure_b_contract.mjs` 会**机械列出**「不在本表、但出现在 ≥2 个 [B] 的字段名」
 *     ⇒ 那就是**候选异名 / 候选接力键**，逐条判"收口"还是"登记"。
 */

export type BTermKind =
  /**
   * ★★ **链的接口** —— 下游 [B] 能拿它当原料（见文件头「接力键规则」）。
   *   · **产物侧**：就是 `Touched` 的字段（`feature` / `project_dir` / `written_files` / …）
   *   · **入参侧**：工具**接受**的这些名字（`project_dir` / `feature` / `file` / `symbol` …）
   *   ⇒ ★ **两端必须同名**；不许同义异名（实测 `path` vs `file` 就是反例）。
   */
  | 'anchor'
  /** 回执：给人/agent 读的文本 */
  | 'receipt'
  /** 状态：这次调用成不成、落没落盘 */
  | 'state'
  /** 上下文：描述"作用在哪"，但**不是链的原料**（如 `action` / `query` 这种本工具自己的口径） */
  | 'context';

export interface BTerm {
  kind: BTermKind;
  /** 规范类型（写成 TS 类型文本） */
  type: string;
  /** ★ 规范定义：这个词**从此以后**是什么 */
  meaning: string;
  /** ★ 债：现状与定义不符 / 一名多义。拆清前不许新增使用者 */
  debt?: true;
  /** 处置（debt 才有）：拆名 or 并入哪个术语 */
  fix?: string;
}

/**
 * ★★ 链的接口 —— 一次 [B] 调用"动了哪些对象"。
 *
 * ★★★ **统一口径（2026-10-01 由 ④-b 三个执行者的追问逼出来的，一条规则管全部字段）**：
 *   `Touched` 描述的是「**这次调用之后，下游能从哪儿接着走**」。所以字段分两类：
 *   - **作用域类**（`feature` / `project_dir`）：描述"作用在哪"，**任何时候都可给**（不依赖成败）；
 *   - **对象类**（`written_files` / `symbols` / `nodes`）：描述「**本次调用确立下来的对象**」——
 *     ★ `read_files` **已于 2026-10-05 撤出**（T56 ④-1）—— 它是**剪贴板**（下游自己读/扫即可），
 *       **不该占「链的接口」**这一格（它原先**无人消费**的根本原因就在这里）。
 *     · **写类** [B]（会落盘的）：**只有真的落盘了才给**；`dry_run` / 被阻断 / `ok:false` ⇒ **整项省略**
 *       （★ 省略 ≠ 空数组：空数组会被读成"真的没写文件"，省略才是"这次没发生落盘"）；
 *     · **只读** [B]（只查不改）：照给（读到的文件 / 查到的符号）。
 *
 * 为什么是这一组：实测（`docs/b-field-dictionary.md`）42 个 [B] 的产物共 189 个字段名，
 * 其中 **80% 只服务 1 个 [B]**（私有，不动）；共用那批里又有 21 个是"同一个词指不同东西"
 * ⇒ **不能靠"名字通用"来造通用层**，只能**新增语义唯一、类型钉死的字段**。
 *
 * 每个字段的取舍依据都写在各字段注释里（哪个数据支持它、为什么不复用现成名字）。
 */
export interface Touched {
  /** 作用到的 feature（DSL 活文档单元）。
   *  依据：入参侧 18 个 [B]、产物侧 12 个已用 `feature: string`（同名同型，真共用） */
  feature?: string;
  /** 作用到的**项目根**（一个仓库的根目录）。
   *  依据：入参侧 17 个 [B] 已用 `project_dir: string`（同名同型，真共用）。
   *  ★ **不并** `target_dir`（它是**目标目录**，不是"被分析项目的根"）—— 2026-10-01 实测的
   *    同类还有 `box_dir` / `brick_dir` / `slim_dir`，但**它们已随积木盒族一起删除**（2026-10-05）。
   *  ★ 口径（2026-10-01 由 ④-b 执行者的追问定下）：填**解析后的绝对根**（`path.resolve(...)`），
   *    不是入参原值（入参可能是相对路径）。 */
  project_dir?: string;
  /** 被**写入/改动**的文件（仓库相对路径，`/` 分隔）。
   *  ★ 用**新名**：`files` 在产物侧有 **6 种不同语义**（已污染）、`filesWritten` 是 `number`（计数）、
   *    `written` 是 `boolean`（是否落盘）—— 三个都不能复用。
   *  ★ 口径（2026-10-01 定下）：
   *    ① 只列**落盘后仍然存在**的文件；被**移动/删除**的旧路径**不列**（下游读不到它）；
   *    ② **未落盘**时（`dry_run` / 被阻断 / `ok:false`）**省略整个字段** —— 不给空数组
   *       （空数组会被读成"真的没写文件"，省缺才是"这次没发生落盘"）。 */
  written_files?: string[];
  /** 涉及到的符号标识。
   *  ★ 新名：既有 `symbol` 是 `string`（单个），链需要全部。
   *  ★ 口径（2026-10-01 核过内核后定下）：**本仓内核的 `qualified_name` 对模块级符号就是裸名**
   *    （`kernel.ts:366 qualified_name: nameNode.text`），成员才是 `Class.method`（`:399`）。
   *    ⇒ 填"模块级裸名 / `Class.method`"**都算合格**；★ **跨文件同名**时靠 `written_files` 消歧。
   *  ★ 值取「**落定后**的符号标识」—— 改名类 [B] 成功时给**新名**（下游要用新名继续操作），未落定则省略。 */
  symbols?: string[];
  /** 涉及到的 DSL 节点 id。★ 新名：既有 `node_id` 是 `string`（单个）。 */
  nodes?: string[];
  /**
   * ★★ **本次操作的那个对象所在的文件** —— 单数，**只在真有"定义文件"时给**（省略 = 没有）。
   *
   * ★ 为什么要它（2026-10-05 实测教训）：`find_references` 的产物既有 `read_files`（**读了哪些**，集合·无序）
   *   又有"符号定义在哪个文件"（`data.definition.file`）—— 二者**不是一回事**。
   *   我曾把 `read_files[0]` 当成"定义文件"来接链，**真跑证伪**：
   *   `mode=field` 下 `read_files[0]` 是**纯消费文件**（声明在另一个文件里），而 `definition` **整项省略**。
   *   ⇒ `read_files[0]` 排首位只靠"某句 `add` 写在前面 + Set 插入序"，**没有任何类型/测试保证**。
   *   ★ 而 `definition_file` 不同：**它只在真有定义时出现** ⇒ 它的存在本身就是断言 ⇒ **可无条件宣称**。
   * ★ 与（已撤出的）`read_files` 的分工：`read_files` = "我读了哪些"（凭据，给人/审计）——
   *   ★ 它**已于 2026-10-05 从 `Touched` 撤出**（改判为"剪贴板"，不进链的接口）；
   *   `definition_file` = "**主语**在哪个文件"（给下游当定位入参），★ **留** —— 它是**单数定位锚点**，不是凭据。
   */
  definition_file?: string;
}

/**
 * ★★ [B] 的**统一构造点**（④-b，2026-10-01）—— 解决"`rename_symbol` 有 10+ 个 return 点，
 * 逐处手加 `touched` 必漏"。
 *
 * 用法（每个 [B] 一个**导出薄壳**，一处算、所有出口都从它出去）：
 *   ```ts
 *   async function renameSymbolsCore(input: RenameSymbolsInput): Promise<RenameSymbolsResult> {
 *     ...原实现一字不改（它的每个 return 都不用管 touched）...
 *   }
 *   export async function renameSymbols(input: RenameSymbolsInput): Promise<TouchedProduct<RenameSymbolsResult>> {
 *     const r = await renameSymbolsCore(input);
 *     return withTouched(r, touchedOf(input, r));   // ★ 唯一的构造点
 *   }
 *   ```
 *
 * 为什么是"包一层"而不是"每个 return 手加"：
 *   ① 出口多（实测 6~10+ 个），手加**必漏**；
 *   ② 漏了不会红 —— `touched` 是可选字段，缺失只是"链接不上"，**静默**。
 *   ⇒ 包一层让"漏"在结构上不可能。
 *
 * ★ 不编造：取不到的锚点**省略该字段**（它们是可选的）；省略 ≠ 填假值。
 */
export function withTouched<T extends object>(
  product: T,
  touched: Touched,
): T & { touched: Touched } {
  return { ...product, touched };
}

/** `withTouched` 的返回类型：产物 + 链的锚点 */
export type TouchedProduct<T extends object> = T & { touched: Touched };

/**
 * 统一回执/状态的最小面 —— [B] 的产物里这几项按此定义，不再各写各的。
 */
export interface BReceipt {
  /** 一行人读摘要。★ **不是数据**：下游禁止从它解析（要数据就加字段） */
  message: string;
  /** 本次调用是否成功完成 */
  ok: boolean;
}

// ─────────────────────────────────────────────────────────────
// 术语表
// ─────────────────────────────────────────────────────────────
export const B_TERMS: Record<string, BTerm> = {
  // ── anchor：链的接口（Touched 的字段）──────────────────────
  feature: { kind: 'anchor', type: 'string', meaning: 'DSL 的 feature 名（活文档单元）' },
  project_dir: {
    kind: 'anchor',
    type: 'string',
    meaning: '被分析/改动的**项目根**（一个仓库的根目录）；不是盒根、不是子目录',
  },
  written_files: {
    kind: 'anchor',
    type: 'string[]',
    meaning:
      '被**写入/改动**的文件（仓库相对路径，`/` 分隔）。★ 只列「**本次操作对被操作对象产生的工作产物**」；★ **排除工具自有的状态/账本/索引目录**（如被分析项目内的 `.agent-io/**`）——那是工具的内部数据，不是工作产物；★ 写在 `<dataHome>`（工具数据主目录）下的 DSL/存档/导图 JSON **本就不是仓库相对** ⇒ 从来不给。',
    debt: true,
    fix: '新词，尚无使用者；由 ④-b refactor 族起逐族采用',
  },
  read_files: {
    kind: 'context',
    type: 'string[]',
    meaning:
      '被**读取**作为输入的文件（仓库相对路径）。★ **已退役（产物侧，2026-10-05，T56 ④-1）**：' +
      '它是**剪贴板 / 变量**，**不该占「链的接口」**这一格 —— 下游要文件列表自己读/扫即可' +
      '（读工具只吃路径，不关心是源码还是事件）⇒ 已从 `Touched` 撤出；**禁止在产物里新增使用者**。',
    fix:
      '2026-10-05 撤出 `Touched`：原 5 个产者（`find_references` / `extract_contracts` / `reconcile_effects` / ' +
      '`reconcile_chain` / `harvest_decisions`）已全部移除该项；其值改由调用方**从上游产物的自有字段里取**' +
      '（= "剪贴板"那一格，见 T56 ④-2）。',
  },
  symbols: {
    kind: 'anchor',
    type: 'string[]',
    meaning: '涉及到的符号 `qualified_name`',
    debt: true,
    fix: '新词，尚无使用者；与旧 `symbol: string`（单个）并存期间禁止混用',
  },
  nodes: {
    kind: 'anchor',
    type: 'string[]',
    meaning: '涉及到的 DSL 节点 id',
    debt: true,
    fix: '新词，尚无使用者；与旧 `node_id: string`（单个）并存期间禁止混用',
  },
  definition_file: {
    kind: 'anchor',
    type: 'string',
    meaning:
      '**本次操作的那个对象所在的文件**（仓库相对路径，`/` 分隔）。★ 与（已撤出的）`read_files` **不是一回事**：' +
      '`read_files` 是"我读了哪些"（集合、无序、凭据）；本词是"**主语**在哪个文件"（单数、定位）。' +
      '★ **只在真有"定义文件"时给，省略 = 没有** ⇒ 它的"存在"本身就是断言，可无条件宣称。' +
      '★ 反例（2026-10-05 真跑）：拿 `read_files[0]` 当定义文件是**错的** —— `mode=field` 下它是纯消费文件。',
    debt: true,
    fix: '新词，首个采用者 = `find_references`（从产物里已有的 `data.definition.file` 补进 `touched`）',
  },

  // ── receipt ────────────────────────────────────────────────
  message: { kind: 'receipt', type: 'string', meaning: '一行人读摘要。★ 不是数据：下游禁止从它解析' },
  limitations: { kind: 'receipt', type: 'string[]', meaning: '本次调用**做不到什么**（诚实列，不留白）' },

  // ── state ──────────────────────────────────────────────────
  ok: { kind: 'state', type: 'boolean', meaning: '本次调用**是否成功完成**（领域失败也给 false，理由进 `blocked`）' },
  blocked: { kind: 'state', type: 'string[]', meaning: '被**阻断**的逐条原因（未落盘时必填，不许空手失败）' },
  dry_run: { kind: 'state', type: 'boolean', meaning: '本次是**预演**（未落盘）' },
  dryRun: {
    kind: 'state',
    type: 'boolean',
    meaning: '与 `dry_run` **同义**',
    debt: true,
    fix: '并入 `dry_run`（命名统一；全仓只用 `dry_run`）',
  },
  skipped: {
    kind: 'state',
    type: '{ item: string; why: string }[]',
    meaning: '被**有意跳过**的条目 + 原因',
    debt: true,
    fix: '★ 现状 3 种形状（`{seeds,reason}[]` / `string[]` / `{path,why}[]`）⇒ 统一到定义的形状',
  },
  incomplete: {
    kind: 'state',
    type: '{ item: string; kind: string; why: string }[]',
    meaning: '**未完成**的部分 + 原因',
    debt: true,
    fix: '★ 现状 2 种形状（`brick_path` 版 / `dsl_path` 版）⇒ 统一到定义的形状',
  },
  pending: {
    kind: 'state',
    type: 'string[]',
    meaning: '**尚未处理**的条目',
    debt: true,
    fix: '★ 现状 `number`（计数）与 `string[]`（列表）混用 ⇒ 统一为列表；计数另立 `*_count`',
  },

  // ── anchor（续）：**单数形式**的接力键（★ 2026-10-05 T54 第一步从 `context` 改判过来）──
  //   ★ 改判理由：它们是**链的原料**，不是"上下文" —— `find_references` / `rename_symbols` /
  //     `move_symbol` / `impact_analysis` 的入参就是 `{file, symbol}`；上游 `get_dsl(files)`
  //     产出的也是"一个个文件"。原先归 `context` ⇒ **词表自己就没承认它们是链的接口**
  //     ⇒ 于是没人有义务让两端同名（实测：上游吐 `path`、下游收 `file`）。
  file: { kind: 'anchor', type: 'string', meaning: '**单个**文件（仓库相对路径）；同一族的复数形式是 `written_files`' },
  files: {
    kind: 'context',
    type: 'string[]',
    meaning:
      '★ **入参侧**：本次操作**限定在这几个文件**上（输入范围，仓库相对路径）—— 这是**合法**的用法。' +
      '★ **产物侧**：**已退役**（2026-10-05）—— 产物里表达"改了哪些文件"必须用 `written_files`' +
      '（"读了哪些"现已是"剪贴板"、不进产物：`read_files` 亦已退役）；**禁止在产物里新增使用者**。',
    fix:
      '★ 2026-10-05 更正：原写"全仓 [B] 已清零、禁止再新增使用者"，**那句话只对产物成立** —— ' +
      '实测入参侧仍有 3 个 [B] 在用（`extract_contracts` / `harvest_closure` / `watch_project_tool`），' +
      '那是"限定范围"的正当输入，**不退役**。产物侧：路径表 → `written_files`（`read_files` 已退役）；报告数组 → `<领域>_reports`。',
  },
  project_root: {
    kind: 'context',
    type: 'string',
    meaning: '与 `project_dir` **同义**',
    debt: true,
    fix: '并入 `project_dir`',
  },
  /**
   * ★ 2026-10-05 补（T45 机检报出的"未定义共用字段名"）：它被 **14 个 [B]** 采用却不在表里。
   *   它是 **T18 的契约本体** —— 所以含义栏写的是"从此以后要求它是什么"，不是现状。
   */
  touched: {
    kind: 'receipt',
    type: 'Touched（本文件导出的接口；6 个字段全可选）',
    meaning: '**本次调用"动了什么"的统一小票**（T18）：跨 [B] 的**唯一收据**，供下游接链',
    fix: '新接 [B] 一律 `withTouched(r, touchedOf(input, r))`（单构造点）；★ **纯数据 / 纯计算 [B] 例外**（它们没有"本次动了什么"）',
  },
  /** ★ 2026-10-05 补：实测 `runTests` / `watchProjectTool` **同名同型**（`string | undefined`）共用。 */
  error: {
    kind: 'state',
    type: 'string | undefined',
    meaning: '失败原因（**人话**，给人 / LLM 读；**不是**异常对象）',
  },
  source_path: { kind: 'context', type: 'string', meaning: '输入物的来源路径（文件或 URL）' },
  events_files: { kind: 'context', type: 'string[]', meaning: '观测事件（JSONL）文件路径表' },
  effect_events: { kind: 'state', type: 'number', meaning: '对账到的事件条数' },
  indexWriteThrough: { kind: 'state', type: 'WriteThroughOutcome', meaning: '索引写穿结果（快照 + 索引是否同步成功）' },
  written_to_dsl: { kind: 'state', type: 'boolean', meaning: '本次结果**是否写进了 DSL**（领域状态，不等于落盘）' },
  written: {
    kind: 'state',
    type: 'boolean',
    meaning: '★ **已退役**（2026-10-05）：全仓 [B] 已清零，**禁止再新增使用者**',
    fix: '文件表用 `written_files`；"是否落盘"用 `dry_run` 的反面表达（或直接报 `written_files` 的有无）',
  },
  filesWritten: {
    kind: 'state',
    type: 'number',
    meaning: '写入文件的**数量**（计数，不是列表）',
    debt: true,
    fix: '改名 `written_file_count`（避免与 `written_files`/`files` 混读）',
  },
  stats: {
    kind: 'receipt',
    type: 'Record<string, number>',
    meaning: '★ **已退役**（2026-10-05）：全仓 [B] 已清零，**禁止再新增使用者**',
    fix: '各领域改名为 `<领域>_stats`（如 `contract_stats` / `closure_stats` / `algorithm_stats`）',
  },
  data: {
    kind: 'context',
    type: 'unknown',
    meaning: '工具响应的**载荷**（[C] 层通道用）',
    debt: true,
    fix: '★ 现状 6 个 [B] 用它当逃生口（`unknown`）⇒ 逐族收窄成具体类型，禁止新增 `data: unknown`',
  },
  meta: {
    kind: 'context',
    type: 'Record<string, unknown>',
    meaning: '本次调用的**元信息**（怎么算的、用了什么策略）',
    debt: true,
    fix: '★ 现状 3 种形状 ⇒ 各领域改名 `<领域>_meta`',
  },
  summary: {
    kind: 'receipt',
    type: 'string',
    meaning: '一段**人读**总结',
    debt: true,
    fix: '★ 现状 `string` 与一个大对象混用 ⇒ 人读用 `message`/`summary: string`，对象改 `<领域>_summary`',
  },
  contracts: { kind: 'context', type: 'Record<string, BrickContract>', meaning: '积木契约表（键 = 契约名）' },
  brick: { kind: 'context', type: 'string', meaning: '积木名（标识）；★ 不是对象', debt: true, fix: '★ 现状 `string` 与一个对象混用 ⇒ 对象改 `brick_detail`' },
  bricks: { kind: 'context', type: 'BrickSpec[]', meaning: '积木表（装配用规格）', debt: true, fix: '★ 现状入参 `string[] | BrickSpec[]`、产物两种 Report ⇒ 各按语义拆名' },
  renames: { kind: 'context', type: 'RenameItem[]', meaning: '批量改名条目表', debt: true, fix: '★ 现状 `FileRenameItem[]` 与 `RenameSymbolsItem[]` 两种 ⇒ 统一到 `RenameItem`' },
  definition: { kind: 'context', type: '{ file: string; kind: string; refs: ReferenceSite[] }', meaning: '符号的**定义点**', debt: true, fix: '★ 现状 2 种形状 ⇒ 统一' },
  importers: { kind: 'context', type: 'ReferenceFile[]', meaning: '**谁 import 了**目标（文件 + 引用点）', debt: true, fix: '★ 现状 `ReferenceFile[]` 与 `RenameSymbolFileInfo[]` 同义不同型 ⇒ 统一' },
  externalRefs: { kind: 'context', type: 'ExternalRef[]', meaning: '跨包/跨仓的外部引用' },
  entries: { kind: 'context', type: 'unknown[]', meaning: '条目表', debt: true, fix: '★ 现状两种不同条目 ⇒ 各领域改名' },
  literals: { kind: 'context', type: 'unknown[]', meaning: '字符串字面量命中表', debt: true, fix: '★ 现状两种形状 ⇒ 统一' },
  previews: { kind: 'state', type: 'unknown[]', meaning: '预演结果（逐条）', debt: true, fix: '★ 现状与 `applied` 平行两套（file 版 / symbol 版）⇒ 统一' },
  applied: { kind: 'state', type: 'unknown[]', meaning: '已落盘的逐条结果', debt: true, fix: '★ 同 `previews`：两套平行形状 ⇒ 统一' },
  tools: { kind: 'context', type: 'unknown[]', meaning: '工具清单（含各自元信息）', debt: true, fix: '★ 现状 `WizardTool[]` 与 `MappedTool[]` ⇒ 各领域改名' },
  detail: { kind: 'context', type: 'unknown', meaning: '细节开关/细节内容', debt: true, fix: '★ 现状 `boolean` 与 `string` 混用 ⇒ 拆：开关用 `with_detail`' },
  view: { kind: 'context', type: 'string', meaning: '视图名（渲染/查询维度）', debt: true, fix: '★ 现状 3 种枚举 ⇒ 各领域改名（如 `render_view` / `query_view`）' },
  mode: { kind: 'context', type: 'string', meaning: '运行模式（本工具自己的枚举）', debt: true, fix: '★ 现状 3 组互不相同的枚举 ⇒ 各领域改名（如 `classify_mode` / `rename_scope`）' },
  scope: { kind: 'context', type: 'string', meaning: '作用范围（本工具自己的枚举）', debt: true, fix: '★ 现状 3 组互不相同的枚举 ⇒ 各领域改名' },
  action: { kind: 'context', type: 'string', meaning: '**面分发参数**：选哪个子动作（属 [C] 层入参，不是领域字段）', debt: true, fix: '保留语义，但**不得**用它当产物的领域字段' },
  query: { kind: 'context', type: 'string', meaning: '查询意图/查询串（本工具自己的口径）', debt: true, fix: '★ 现状 `string` 与 19 个枚举混用 ⇒ 各领域改名' },
  node_id: { kind: 'anchor', type: 'string', meaning: '**单个** DSL 节点 id；同一族的复数形式是 `nodes`', debt: true, fix: '新写 [B] 一律用 `nodes: string[]`' },
  symbol: { kind: 'anchor', type: 'string', meaning: '**单个**符号 `qualified_name`；同一族的复数形式是 `symbols`', debt: true, fix: '新写 [B] 一律用 `symbols: string[]`' },
  brick_name: { kind: 'context', type: 'string', meaning: '积木名（与 `brick` 同指时用本词）', debt: true, fix: '与 `brick` 二选一' },
  to: { kind: 'context', type: 'string', meaning: '目标值（新名/新路径）' },
  name: { kind: 'context', type: 'string', meaning: '名称（本工具自己指的那个对象的名字）' },
  limit: { kind: 'context', type: 'number', meaning: '返回条目上限' },
  max_depth: { kind: 'context', type: 'number', meaning: '遍历深度上限' },
  max_steps: { kind: 'context', type: 'number', meaning: '步数上限' },
  write: { kind: 'context', type: 'boolean', meaning: '**是否真的落盘**（= `dry_run` 的反面）；★ 与 `dry_run` 二选一' },
  write_dsl: { kind: 'context', type: 'boolean', meaning: '是否写进 DSL（领域开关，不等于落盘）' },
  report_literals: { kind: 'context', type: 'boolean', meaning: '是否一并报告字符串字面量命中' },
  args: { kind: 'context', type: 'unknown', meaning: '子动作的参数袋子（★ 只允许在 [C] 分发层出现）', debt: true, fix: '禁止渗进 [B]' },
  opts: { kind: 'context', type: 'unknown', meaning: '选项袋子（★ 泛型丢失，待类型化）', debt: true, fix: '类型化后按语义改名' },
  r: { kind: 'context', type: 'unknown', meaning: '值占位（★ 名字无语义）', debt: true, fix: '按语义改名' },
};

/** ★ 债务计数：`debt: true` 的条数（棘轮：只许减不许增） */
export const B_TERMS_DEBT = Object.values(B_TERMS).filter((t) => t.debt).length;
