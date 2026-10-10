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
 *   · ★ **判据：不许同义异名**。★ 但**反过来也成立**：**"看起来不一致"可能根本不是同一件事**。
 *     ★★ 2026-10-05 复核**推翻了本表原先举的那个反例**（原写"`get_dsl(files)` 用 `path`、下游用 `file` ⇒ 同义异名"）：
 *       `path` 是**事实字段**（`SemanticFile.path` = 相对路径，且被 `schema/design_dsl.schema.json` 的 `required` 钉死）；
 *       `file` 是**定位器**（`find_references` 入参注释明文"**绝对路径**；或相对 project_dir/cwd"）
 *       ⇒ **不是同义异名，是两类东西**；硬对齐名字 = 把"事实字段"与"定位器"搅成一个名字
 *       （本仓头号病根的**反方向**：不是同名不同义，是**不同义被误当同名**）。
 *       ⇒ 要收口就收**同类**：`file`（下游定位器）↔ `Touched.file`（产物侧同一件事）—— 已于同日收口。
 *   · ★ 单数/复数是**同一族的两种形态**：`symbol` ↔ `symbols`、`node_id` ↔ `nodes`。
 *     ★ 而 **`file` 是通用单数定位器** —— `written_files`（写过的）/ `read_files`（读过的，已退役）虽与之同族，
 *       但各自带**加工语义**，**不等于** `file`。
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
  /**
   * ★★ **已退役**：不许再新增使用者 —— ★ 必须写成**这个字段**，**不能靠散文里写"已退役"三个字**。
   *
   * ★ 为什么（2026-10-06 实测假阳性）：量具原先用 `meaning.includes('已退役')` 判退役，
   *   而 `file` 词条的注释里恰好提到"`read_files`（读过的，已退役）"
   *   ⇒ **`file` 自己被判成"已退役"**，摘要里报出「已退役词仍在被用：产物侧 file」
   *     （★ `file` 确实在被用，**但它没退役** —— 它是活的 anchor）。
   *   ⇒ 正是本仓头号病根的老形态：**拿文本当行为**（把判据的影子当成判据）。
   *   ⇒ 判据必须是**结构**（本字段）；散文只许解释、不许判定。
   *
   * · `'product'` = 只退役**产物侧**（★ 入参侧可能仍合法 —— 如 `files`：入参"限定本次处理哪几个文件"是正当用法）
   * · `'input'`   = 只退役**入参侧**
   * · `'both'`    = 两侧都退役
   */
  retired?: 'product' | 'input' | 'both';
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
  /**
   * ★★★ **被框定/被审阅的「作用面」**（仓库相对路径数组）—— 2026-10-09 新增（`docs/todo.md` T81）。
   *
   * ## 为什么需要它（且为什么**不能**复用 `written_files`）
   * **只读**工具**也要有东西交给下游**。实测病灶：`design` 线 12 个工具**一条对象边都接不上**
   * （`CHAIN_EDGES` 里作上下游各 0），根因就是**它们的产物里没有任何"能交给下游的对象"**
   * ——`get_dsl` / `consistency_check` 都是只读的，产物里只有 `feature`。
   * ⇒ 而"我想改哪一片"这件事**恰恰是它们能给出的**：`get_dsl query=scope` 已经解析出**确定的文件集合**
   *   （`ResolvedScope.paths`）；`consistency_check` 的差异块里也是文件列表。
   *
   * ★★ **为什么不并进 `written_files`**：后者的口径是「**被写入/改动**的文件」
   *   （且"只列**落盘后仍然存在**的文件"）—— 而只读工具**一个文件都没写**
   *   ⇒ 塞进去就是**谎报"我改了这些"**。★ 同样不能并 `file`（它是**单个**"定义文件"）。
   *   ⇒ 三个键的分工（**这是本键存在的全部理由**）：
   *     · `written_files` = 我**改了**哪些（写盘事实）
   *     · `file`          = 主语**住在**哪个文件（单个·定位）
   *     · `scope_files`   = 我**圈定了/审阅了**哪些（作用面·**只读也成立**）
   *
   * ★ 消费者：**16 个工具**接受"文件 / 文件列表"类入参（`file` / `files` / `renames` / `change_points` / `targets`）
   *   ⇒ 它有大量下游（不是为一个消费者造的）。
   * ★ 与 `written_files` 同形（`string[]`·仓库相对·`/` 分隔），**但不含"我改了它"的断言**。
   */
  scope_files?: string[];
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
   * ★ 名字取 **`file`**（= 入参侧锚点：`find_references` 的入参就叫 `file`）⇒ 上游给 `touched.file`、
   *   下游收 `renames[].file`，**零字段名翻译**。
   *   ★ 2026-10-05 改名记录：本字段原先叫 `definition_file`（当日新加、1 产者 0 消费者），
   *     为"出口名 = 入口名"改为 `file`；旧名**已作废，不再使用**。
   *
   * ★ 为什么要单立一栏（2026-10-05 实测教训）：`find_references` 的产物既有"我读了哪些"（当时的 `read_files`，
   *   集合·无序）又有"符号定义在哪个文件"（`data.definition.file`）—— 二者**不是一回事**。
   *   我曾把 `read_files[0]` 当成"定义文件"来接链，**真跑证伪**：
   *   `mode=field` 下它是**纯消费文件**（声明在另一个文件里），而 `definition` **整项省略**。
   *   ⇒ `read_files[0]` 排首位只靠"某句 `add` 写在前面 + Set 插入序"，**没有任何类型/测试保证**。
   *   ★ 本栏不同：**只在真有定义时出现**（`definition` 只在 `mode=symbol` 成功出口赋值）⇒
   *     **它的"存在"本身就是断言** ⇒ **可无条件宣称**。★ `mode=field` 下整项省略。
   * ★ 与已撤出的 `read_files` 的分工：`read_files` = "我读了哪些"（凭据，给人/审计）—— ★ 已于 2026-10-05
   *   从 `Touched` 撤出（改判为"剪贴板"，不进链的接口）；本字段 = "**主语**在哪个文件"（给下游当定位入参）。
   */
  file?: string;
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
    debt: true,    fix: '新词，尚无使用者；由 ④-b refactor 族起逐族采用',
  },
  scope_files: {
    kind: 'anchor',
    type: 'string[]',
    meaning:
      '**我圈定了 / 要我关注的文件**（仓库相对路径，`/` 分隔）—— ★ 与 `written_files` 的分界是**本键存在的全部理由**：' +
      '`written_files` = 我**改了**哪些（写盘事实）；`file` = 主语**住在**哪个文件（单个·定位）；' +
      '**`scope_files` = 要我关注哪些（只读也成立）**。' +
      '★★ **三个产者，同一把钥匙，同一个语义**（★ **只加产者、不加钥匙** —— `scope_files` 一个键装下三个来源；' +
      '不许再分叉成第四把钥匙或新字段）：' +
      '· 「圈范围」类（`get_dsl query=scope`）交的是**作用面**（我框定了哪些）；' +
      '· 「对拍」类（`consistency_check`）交的是**差异面**（哪些文件**不对**）—— 因为对拍这个动作的产出本来就是"不对的范围"；' +
      '· 「建档」类（`import_project`）交的是**导入面**（本次扫进来、归本 feature 管的源码文件）—— 本次新增的第三个产者。' +
      '★ **只读工具也能产**（这正是它存在的理由：2026-10-09 实测 design 线 12 个工具**在此之前一条对象边都接不上**，' +
      '根因就是只读工具"没有能交给下游的对象"）；' +
      '★ **不许拿它冒充 `written_files`**（那等于谎报"我改了这些"），反之亦然；' +
      '★ 没圈到 / 没差异 ⇒ **省略整个键**，不给空数组（空数组会被读成"真的没有文件"）。',
    debt: true,
    fix: '★ 处置：三个来源（`get_dsl query=scope` 作用面 / `consistency_check` 差异面 / `import_project` 导入面）同一语义、不制造一名多义 ⇒ 债还清。',
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
    retired: 'product',
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
    meaning:
      '涉及到的 DSL 节点 id。★ 口径（**唯一住处** —— 原只写在 `chain_wiring.ts` 的注释里）：' +
      '**只给落定后仍存在的 DSL 节点 id** —— `op=delete` 之后那个节点**已不在 DSL 里**，' +
      '交出去会让下游去查一个**不存在的节点**（与 `file` 那条"只在真有定义时才给"同款判据）。' +
      '★ 产者分类：只收 `id` **就是节点 id** 的 op（`node` / `binding` / `status` / `decision`）；' +
      '`edge` / `file` / `api` 的 `id` **不是节点**，一个都不收。',
    debt: true,
    fix:
      '**已非新词**：本轮之前已有 3 个产者 —— `harvest_closure.ts:462` / `derive_anim_flow.ts:515` / ' +
      '`reconcile_chain.ts:353`；2026-10-09 起 `edit_dsl`（`update_feature.ts`）亦产（口径见 meaning）。' +
      '与旧 `node_id: string`（单个）并存期间禁止混用。',
  },
  // ★ 2026-10-05：原 `definition_file` 词条**已删** —— 该字段（当日新加、1 产者 0 消费者）为「出口名 = 入口名」
  //   改名为 `file`（词条见本表下方 anchor 续段），见 `Touched.file` 的注释；**旧名作废**，不留会误导的别名。

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
  //     `move_symbol` / `impact_analysis` 的入参就是 `{file, symbol}`。
  //   ★★ 2026-10-05 更正：原写"上游 `get_dsl(files)` 吐 `path`、下游收 `file` ⇒ 同义异名" ——
  //     经复核那是**两类东西**（`path` = 事实字段、`file` = 定位器，详见文件头「接力键规则」）⇒ 该说法已撤。
  file: {
    kind: 'anchor',
    type: 'string',
    meaning:
      '**通用单数定位器**：一个文件（仓库相对路径）。★ 产物侧的同一件事见 `Touched.file`（本次操作的那个对象所在的文件）；' +
      '★ 与 `written_files`（**写过的**）/ `read_files`（**读过的**，已退役）同族但**不同义** —— 那两个各带加工语义。',
  },
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
    retired: 'product',
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
    type: 'Touched（本文件导出的接口；7 个字段全可选：`feature` / `project_dir` / `written_files` / `scope_files` / `symbols` / `nodes` / `file`）',
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
    retired: 'both',
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
    retired: 'both',
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
  /**
   * ★ 2026-10-06 补（门「b 项契约占位符」**先红后绿**逼出来的）：它出现在 **2 个 [B]**、却不在表里。
   *
   * ★★ **登记前已核类型 + 语义**（本仓纪律：**"名字像" ≠ "同义"**）⇒ 实测**同名不同义**：
   *   · `harvestDecisions.candidates` = **`HarvestCandidate[]`**（**条目表**，draft 决策候选）
   *   · `deprecateOffline.candidates` = **`number`**（**计数**，= 可下线候选的个数）
   *   ⇒ 与已登记的 `filesWritten`（`number`，计数）↔ `files`（列表）是**同一族的老毛病**。
   */
  candidates: {
    kind: 'context',
    type: 'unknown[]',
    meaning: '**待定的候选项**（本工具自己指的那类候选）',
    debt: true,
    fix:
      '★ 实测**同名不同义** ⇒ 各领域改名：条目表 → `<领域>_candidates`（如 `decision_candidates`）；' +
      '计数 → `candidate_count`（同 `filesWritten` → `written_file_count` 的口径）。拆清之前禁止新增使用者。',
  },
  /**
   * ★★★ 2026-10-10（T106 决策写入口）新增 —— **决策卡上"多份证据说法不一致、尚未裁定"的差异**。
   *
   * ## 它**不是** `alternatives`（这是本词条存在的全部理由）
   * `NodeDecision.alternatives` 的既有语义 = 「**被否掉的**方案 + **否决原因**」（已经想清楚并排除了）；
   * 而本字段是「**还没想清楚**」。用户 2026-10-10 裁定：「并**不要强制它们没有区别**，……三个如果有了差别，
   * **要以用户的那个设计为准**，然后去想**怎样去往设计上靠拢**。」⇒ 分歧是**待对拍的差异**，不是噪声。
   * 处置后（对拍 / 以设计为准裁定）**才**进 `alternatives[{option, rejected_because}]`。
   *
   * ★ 口径唯一住处 = `domain/geometry.ts` 的 `NodeDecision.dissent`（契约值 = `DecisionDissent[]`）。
   */
  dissent: {
    kind: 'context',
    type: 'DecisionDissent[]',
    meaning:
      '**未决分歧**：多份证据给出了与 `NodeDecision.summary` 不同、且**尚未裁定**的说法（每条含 `option` + 可选 `votes` / `evidence_source`）。' +
      '★ 与 `alternatives` **严格分开**：`alternatives` = **已被否决**的方案 + 否决原因；`dissent` = **还没判**的分歧。' +
      '★ 混用 = 把"未决"伪装成"已排除"（同名不同义）；裁定后**未采纳的说法**才进 `alternatives`。',
  },
  /** ★ 2026-10-10（T106）：**支持 `NodeDecision.summary` 的证据源个数**（多源印证 = 置信）。 */
  votes: {
    kind: 'context',
    type: 'number',
    meaning:
      '**支持某条结论（summary）的证据源个数**（1..3）—— `harvest_decisions` 的三份证据（code/history/docs）里投它的份数，' +
      '是"多源印证 = 置信"的本意（★ 不是"同一提示词抽几次的稳定性"）。同族的 `AlternativeWhy` 也用它。',
  },
  /** ★ 2026-10-10（T106）：**支持某条结论的证据源**（哪几份证据投了它）。 */
  evidence_source: {
    kind: 'context',
    type: 'string[]',
    meaning:
      '**支持某条结论的证据源**（`harvest_decisions` 的枚举：`code` / `history` / `docs`），长度应 = `votes`。' +
      '用于给"分歧 / 结论"**归因到证据**（"这条来自哪份证据"可观察）。',
  },
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

/**
 * ★★ **`touched` 的例外清单**（2026-10-06 定稿 —— T18 的棘轮口径从「建议收窄」改为**已定**）。
 *
 * ## 口径
 * 棘轮原话是「**新增 [B] 必须给 `touched`**」。但那条会**逼人造假字段** —— 实例：`wizardSteps`
 * （无入参静态表）与 `dagLayout`（纯计算）**没有"本次动了什么"可报**。⇒ 定稿为：
 * 「新增 [B] 必须给 `touched`，**除非**它是 **(a) 纯数据 / 纯计算** 或 **(b) [C] 级分派器**
 *   或 **(c) 根只能靠 `cwd` 兜底**（本仓**禁** cwd 兜底 ⇒ 根算不出来）；**三种都必须登记在本表**。」
 *
 * ## 为什么是这张表、而不是塞进 `B_TERMS`
 * `B_TERMS` 是**字段级**词表（键 = 字段名，回答"这个名字是什么意思"）；本表是**工具级**
 * （键 = [B] 函数名，回答"这个工具为什么不给 `touched`"）。
 * ★ 粒度不同 ⇒ 混进一张表会让"**字段名**"与"**工具名**"共用一个命名空间 —— 正是本仓最忌的
 * 「一名多义」。**两张表、两个命名空间。**
 *
 * ## 与量具的关系（★ 两个数字不同是**必然**的，别对着看）
 * `scripts/measure_b_contract.mjs` 现在会把它报成**三类**（**已接 · 已登记例外 · 该给未给＝真债**），
 * 并**读本表**作为"已登记例外"的唯一数据源。★ 而它另有一行「**产物里没有任何锚点候选字段**的 [B]：
 * **8/37**」—— 那**不是**同一件事，两个数字**必然不相等**（2026-10-06 实测交叉核对过）：
 *   · 在 8 里、却**不在**本表的（`diffViews` / `editCode` / `renameFiles`）⇒ 它们**已接 `touched`**，
 *     只是**产物里没有"锚点候选"字段** ⇒ 两回事；
 *   · 在本表里、却**不在** 8 里的（`wizardSteps` / `runTests`）⇒ 它们**根本没有 `touchedOf`**，
 *     自然不会出现在"扫 `touchedOf`"的那一列。
 * ⇒ 一句话：**8 数的是"产物有没有候选锚点"，本表数的是"有没有 `touchedOf`"。**
 */
export const B_TOUCHED_EXEMPT: Record<
  string,
  { kind: 'dispatcher' | 'pure' | 'no-root'; why: string }
> = {
  // ── (b) [C] 级分派器（3）──
  //    ★★ 判据（比"有没有 switch"锋利）：**入参 `{action/query + 袋子}`** **并且** **产物 `data: unknown`**。
  //    （`editCode` 也用 `op` 的 if 链分派，但产物是 `{message; data: EditReceipt}`（**有类型**）⇒ **不是这一类**。）
  //    ⇒ 正确做法：`touched` 由**被分派到的真 [B]** 携带，分派器**转发**即可、不自己拼。
  manageFeature: { kind: 'dispatcher', why: '入参 {action,args} + 产物 data:unknown ⇒ [C] 级分派器' },
  exploreCode: { kind: 'dispatcher', why: '入参 {action,args} + 产物 data:unknown ⇒ [C] 级分派器' },
  queryFeature: { kind: 'dispatcher', why: '入参 {query,…} + 产物 data:unknown ⇒ [C] 级分派器' },
  // ── (a) 纯数据 / 纯计算（2）──
  wizardSteps: { kind: 'pure', why: '无入参静态表 ⇒ 没有"本次动了什么"可报' },
  collectFunctions: { kind: 'pure', why: '纯计算（把一个文件里的函数收集出来）⇒ 不产生动作' },
  // ── (c) 根只能靠 cwd 兜底（2）──
  observeTrace: { kind: 'no-root', why: '根只能靠 cwd 兜底（本仓禁 cwd）；且无仓库相对的对象' },
  runTests: { kind: 'no-root', why: '根只能靠 cwd 兜底（本仓禁 cwd）；且无仓库相对的对象' },
};
