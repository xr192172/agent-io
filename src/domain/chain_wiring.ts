/**
 * 链的**接法表** —— 「上一步的产物，怎么喂给下一步的入参」。
 *
 * ★★ 为什么需要它（2026-10-05 实测）：
 *   `Touched`（产物端的锚点契约）**统一过、也是活的** —— 各键都有人产
 *   （`feature 19/31 · project_dir 21/31 · written_files 8/31 · symbols 4/31 · nodes 3/31 · file 1/31`
 *    —— ★ `read_files` 已于 2026-10-05 撤出、`definition_file` 同日改名为 `file`，详见下方注释；
 *    ★★ 这组数字 2026-10-05 **改过口径**：旧版量具按**裸词**扫函数体 ⇒ 把注释/局部变量也算进去
 *      （影子），如 `written_files` 报 19 而真实 8；现在的口径是**字段访问 / 属性键**，读数可信），
 *   而且**链在数据上已经通了**：实测 `find_references.touched`（含 `file` / `symbols`）能**零字段名翻译**地
 *   构造出 `rename_symbols` 的入参并跑通（2026-10-05 真跑 ⇒ 见 `CHAIN_EDGES` 里那条 `verified`）。
 *   ★ **但那个接法只活在"那一次对话"里** —— 没有任何东西**承载**它 ⇒
 *   每一次都得由调用方（人或 LLM）**自己回忆字段名、自己挑元素** ⇒ **这正是会出错的地方**。
 *   ⇒ 本表把它变成**数据**：`上游 → touched 的哪个键 → 下游入参的哪个位置`。
 *
 * ★★ 谁读它：`capability_map`（新用户第一站）。LLM 一眼看到"上一步给什么、下一步要什么"，
 *   **不必猜、不必回忆、不必数下标** —— 这就是「把列表给出来、从上一步的列表里挑」。
 *
 * ★★ 表里只放**有证据**的边：`verified` = 已**真跑**过；`pending` = 文档写了但**没验**。
 *   ★ **不许把 pending 写成 verified**（本仓纪律：不许把预测写成实测）。
 *
 * ★ 与 `docs/tool-chain-contract.md` §5 的关系：§5 是**散文里的目标链**
 *   （`find_references → rename_symbols → edit_code → run_tests`），本文件是它的**可消费形态**。
 *
 * ★★★ 「**从集合里选一个**」这一格的**明文约定**（2026-10-06）—— 本表唯一"要你自己动手"之处：
 *
 *   表达式形（**这就是那一格的名字**）：
 *     · `cardinality: 'single'` ⇒ 取 `touched.<键>`      （只有一个，取即确定）
 *     · `cardinality: 'pick'`   ⇒ 取 `touched.<键>[i]`   （可能有多个，**下标由你给**）
 *   ★ 例：`touched.written_files[1]` = 上游这次改的第 2 个文件。
 *
 *   ★ **为什么"选"永远由调用方给**（不是我们偷懒）：选择是**语义判断**、不是数据搬运 ——
 *     Unix 的"万能"同样不包括自动选（`grep` 就是在选；`$1` / `xargs` 也是调用方给的）。
 *     我们只负责**给它一个统一的名字**（上面那三点式），不负责替他选。
 *   ★ 例外是 `single`：**集合确定只有一个元素**（如 `find_references.touched.file`）⇒ 那一步**无需选择**。
 *
 * ★★ **2026-10-06 真跑验收（§5 那条链，夹具 `$TEMP/t54chain`，全程零字段名翻译）**：
 *   `rename_symbols`（`Kk → KkRenamed`，真落盘 2 文件）给出
 *   `touched = {project_dir, symbols:["KkRenamed"], written_files:["src/a.ts","src/b.ts"]}` ⇒
 *   · `written_files[1] → edit_code.file` ✅ **成立**（`ok=true`；下标 i=1 由调用方给）
 *   · `symbols[0] → edit_code.symbol`（`op=replace`）✅ **成立**（`ok=true`）
 *   · `edit_code.written_files → run_tests.project_dir` ❌ **证伪**（把**文件**当**根**传 ⇒
 *     `无法读取目标项目 package.json（…\src\b.ts\package.json）`）；★ 正确接法是
 *     `touched.project_dir → run_tests.project_dir`（= 通用边，已 `verified`）。
 *   ⇒ 三条 `pending` **全部有了结论**：两条升级 `verified`、一条证伪撤掉；`pending` 表已清空。
 */
import type { Touched } from './b_terms.js';

/** `touched` 的六个键 —— ★ **从 `Touched` 类型派生，不手抄**（改契约时本表自动跟上） */
export type AnchorKey = keyof Touched;

/** 通配：作用域类字段（`feature` / `project_dir`）两端逐字同名 ⇒ 任何 [B] 之间都直通 */
export const ANY_TOOL = '*';

export interface ChainEdge {
  /** 上游工具（= `[B]` 名）；`ANY_TOOL` 表示"任何 [B]" */
  readonly from: string;
  /** 上游 `touched` 里的哪个键 */
  readonly fromKey: AnchorKey;
  /** 下游工具；`ANY_TOOL` 表示"任何 [B]" */
  readonly to: string;
  /** 下游入参的哪个位置（点路径；`[]` 表示数组元素内） */
  readonly toPath: string;
  /**
   * 上游那个键是**集合**；这条边怎么把集合变成下游要的单个：
   * · `single` —— 集合**只有一个元素**时**确定** ⇒ 直接取，**无需选择**
   *   ⇒ 表达式 `touched.<fromKey>`
   * · `pick`   —— 集合可能有多个 ⇒ **由调用方挑一个**（= 「从上一步的列表里选」）
   *   ⇒ 表达式 `touched.<fromKey>[i]`（**下标由调用方给**；选择是语义判断，不自动化）
   * ★ 表达式**只由 {@link chainExprOf} 一处生成**（别在别处手抄这个形态 —— 那是第二份副本）。
   */
  readonly cardinality: 'single' | 'pick';
  readonly evidence: 'verified' | 'pending';
  /** 证据一句话（`verified` 必填，写清"怎么验的"） */
  readonly note: string;
}

/**
 * ★★★ 链边表。
 *
 * ★ **本表最早的两条对象类边**（`read_files[0] → file` / `symbols[0] → symbol`）**已被真跑证伪、撤掉**
 *   （证伪过程见下方注释）；`read_files` 本身也已于 2026-10-05 从 `Touched` **撤出**
 *   （它是"剪贴板"，**不该占链的接口** —— T56 ④-1，它零消费者）。
 *   ⇒ 2026-10-05 时本表只剩**两条作用域类**的 `verified`（`project_dir` / `feature`），
 *     对象类的边一律在 `CHAIN_EDGES_PENDING` 里**待验**。
 * ★★ **2026-10-06：`CHAIN_EDGES_PENDING` 已清空**（原有三条全部真跑出了结论）—— 两条对象类边
 *   （`rename_symbols.written_files → edit_code.file` · `…symbols → edit_code.symbol`）**升级进本表**；
 *   第三条（`edit_code.written_files → run_tests.project_dir`）**证伪撤掉**（留证见下方注释）。
 *   ⇒ 至此 §5 那条链（`find_references → rename_symbols → edit_code → run_tests`）**每一环都验过了**。
 */
export const CHAIN_EDGES: readonly ChainEdge[] = [
  // ── 作用域类：两端逐字同名，任何 [B] 之间直通（已验：17/17 按 feature 工作的 [B] 都接受 feature）──
  {
    from: ANY_TOOL,
    fromKey: 'project_dir',
    to: ANY_TOOL,
    toPath: 'project_dir',
    cardinality: 'single',
    evidence: 'verified',
    note: '两端逐字同名；`Touched` 侧 22/31 产、入参侧 17/37 收（按 feature 工作的 17 个 [B] 全收）',
  },
  {
    from: ANY_TOOL,
    fromKey: 'feature',
    to: ANY_TOOL,
    toPath: 'feature',
    cardinality: 'single',
    evidence: 'verified',
    note: '两端逐字同名；★ 但只有**按 feature 工作**的 [B] 该收它（全项目工具不需要，别硬塞）',
  },

  // ── ★★ 2026-10-05：原先这里放了两条标 `verified` 的边 ──
  //   `find_references.touched.read_files[0] → renames[].file`
  //   `find_references.touched.symbols[0]    → renames[].symbol`
  //   **两条都被真跑证伪、已撤掉**。证伪用的两个夹具（都在 `C:/tmp/`，不进仓）：
  //
  //   ① mode=field 反例（`C:/tmp/t28field2/`：`zeta.ts` 声明 `config`，`alpha.ts` 只消费 `config.retries`）：
  //      `touched = {project_dir, read_files:["src/alpha.ts","src/zeta.ts"]}`
  //      ⇒ **`read_files[0]` 是纯消费文件（alpha.ts），不是定义文件**；
  //      ⇒ `symbols` **整项省略**（`definition` 也省略 —— 它只在 mode=symbol 的成功出口才赋值）。
  //   ② ★★ 更坏的一条：**顶层 `symbol` 在 mode=field 下装的是"字段名"（`"retries"`）而不是符号名**
  //      ⇒ "**`find_references` 的『符号』槽位是复用的**" —— mode=symbol 装符号、mode=field 装字段名。
  //      ⇒ ★ **任何"无条件"的接法都错**（拿它去喂改名工具 = 把字段名当符号名，**静默接错**）。
  //
  //   ★★ 教训（比这两条边值钱）：**"实测夹具里恰好单元素"不是契约** ——
  //      `read_files` 排在首位只靠 `find_references.ts:526` 那句 `read.add(r.definition.file)`
  //      写在 `:527-529` 之前 + `Set` 的插入序；**没有类型 / schema / 测试 / 文档**把它写下来
  //      （`b_terms.ts:95` 的类型就是 `string[]`，没写"第 0 个是定义"）。
  //      ⇒ 顺序一变就**静默接错** ⇒ 这正是"把偶然当契约"。
  //
  //   ★ 正确的锚点应当是**单数、且只在真有定义时给** ⇒ 那才是"无条件"能宣称的东西。
  //     2026-10-05 已落地并按此**真跑**（见下面那条 `verified` 边）。
  //
  //   ★★ 2026-10-05 续（T56 ④-1）：`read_files` **字段本身已从 `Touched` 撤出**（零消费者）。
  //      ⇒ 上面这些"从 `read_files` 接"的讨论**从此是历史记录**（它不再出现在任何产物里）；
  //        它原先的定位应是"**剪贴板 / 变量**"，不是"链的接口"。

  // ── ★★ 2026-10-05 真跑通的第一条**对象类**边（原挂 `CHAIN_EDGES_PENDING`，现升级 `verified`）──
  //   夹具：`$TEMP/agentio_chain_probe/`（2 个 TS 文件；不进仓，用完即删）
  //   ① `find_references {project_dir, file:"src/a.ts", symbol:"dupName"}`
  //      ⇒ `touched = {project_dir, symbols:["dupName"], file:"src/a.ts"}`   ← ★ 字段名就是 `file`
  //   ② 用它 `touched.file` + `touched.symbols[0]` **零字段名翻译**地构造
  //      `rename_symbols {project_dir, renames:[{file, symbol, to:"renamedDup"}]}` ⇒ **跑通**
  //      （落盘 2 个文件：定义 + import + 用法全改；下游 `touched.written_files` 亦照给）
  {
    from: 'find_references',
    fromKey: 'file',
    to: 'rename_symbols',
    toPath: 'renames[].file',
    cardinality: 'single',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-05）：`touched.file`（单数、只在真有定义时给）→ `renames[].file` **逐字同名、零翻译**；' +
      '`touched.symbols[0]` → `renames[].symbol` 同理。★ 前提：`definition` 只在 mode=symbol 成功出口赋值 ⇒ ' +
      '`mode=field` 下 `file` **整项省略**（别当它总有）。',
  },

  // ── ★★ 2026-10-06：`find_references` → `move_symbol`（**第 4/5 条对象类边**）真跑升级 ──
  //   ★ 来源：用机算出的"待验边候选"清单（`objectInputsOf` ∩ 无入边）⇒ `move_symbol` 要 `[file, symbol]`。
  {
    from: 'find_references',
    fromKey: 'file',
    to: 'move_symbol',
    toPath: 'file',
    cardinality: 'single',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-06，夹具 `C:/tmp/t54chain3`）：`touched.file` → `move_symbol.file` **逐字同名、零翻译**，' +
      '`touched.symbols[0]` → `move_symbol.symbol` 同理，`touched.project_dir` → `project_dir`（通用边）⇒ `ok=true`，' +
      '落盘 3 文件（新建 `src/moved.ts` + 清空源文件 + 重定向 `src/c.ts` 的 import `./a.js` → `./moved`）。' +
      '★★ **前提（试了三次夹具才逼出来）**：`move_symbol` 要求**被搬的符号是别人从该文件唯一取用的东西**' +
      '（每条 import 语句只引它一个）—— 否则报「一条 import 语句从源文件同时引入其它符号，无法整条重定向」' +
      '⇒ **那是合法限制，不是接线问题**（前两次 `ok:false` 全是夹具不满足它，不是边不成立）。' +
      '★ 它同时是**链的终点**：**没有 `touchedOf`** ⇒ 交不出棒（想继续接就得先给它补 `touchedOf`）。',
  },
  {
    from: 'find_references',
    fromKey: 'symbols',
    to: 'move_symbol',
    toPath: 'symbol',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-06，同夹具、同一批参数）：`touched.symbols[0]` → `move_symbol.symbol`。' +
      '★ `pick`：一次操作可能涉及多个符号 ⇒ 下标由调用方给。',
  },

  // ── ★★ 2026-10-07：`find_references` → `impact_analysis`（**第 6/7 条对象类边**）真跑升级 ──
  //   ★ 来源：机算的"待验边候选"（要 `file`+`symbol` 却无入边）。
  {
    from: 'find_references',
    fromKey: 'file',
    to: 'impact_analysis',
    toPath: 'change_points[].file',
    cardinality: 'single',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-07，夹具 `C:/tmp/t54chain3`）：`touched.file` → `change_points[0].file` **键名逐字同名**；' +
      '`touched.symbols[0]` → `change_points[0].symbol` 同理；`touched.project_dir` → `project_dir`（通用边）' +
      '⇒ 回执正常、报告正常（受影响文件 1 个）。' +
      '★★ **这一条澄清了"零字段名翻译"的边界**：调用方要**包一层数组**（`change_points[]`）—— ' +
      '**键名没变，变的是"住在哪个容器里"**。⇒ **零字段名翻译 ≠ 零结构包装**；' +
      '容器形态是**下游的契约**（上游决定不了），由 `toPath` 这一维表达。' +
      '★ 它是**链的终点**：产物里**没有 `touched`**（只有 root / changePoints / files / total + fell_back）' +
      '⇒ 能进不能出（与 `move_symbol` 同类）。' +
      '★ 它自己还会**诚实降级**：符号级消费方解析失败时置 `fell_back: true` 并整文件闭包兜底（那是它对自己能力的标注，不是链的问题）。',
  },
  {
    from: 'find_references',
    fromKey: 'symbols',
    to: 'impact_analysis',
    toPath: 'change_points[].symbol',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 同批真跑（2026-10-07，同一次调用）：`touched.symbols[0]` → `change_points[0].symbol`。' +
      '★ `pick`：一次可能涉及**多个变更点** ⇒ 下标由调用方给。',
  },

  // ── ★★★ 2026-10-07：`move_symbol` → `rename_symbols`（**第 8/9 条对象类边**）──
  //   ★★ 这两条边是「**调用即备料**」的直接产物：`move_symbol` 此前**没有 `touched`**
  //      （= 链的**终点**，能进不能出）⇒ 给它补上"把已有产物投影成统一契约"之后，它才**交得出棒**。
  //   ⇒ 一条改动让链**长了一整个深度**（`find_references → move_symbol → rename_symbols`）。
  {
    from: 'move_symbol',
    fromKey: 'written_files',
    to: 'rename_symbols',
    toPath: 'renames[].file',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-07，夹具 `C:/tmp/t54chain3`）：`touched.written_files[i]` → `renames[].file`，' +
      '`touched.symbols[0]` → `renames[].symbol`，`touched.project_dir` → `project_dir` ⇒ `ok=true`（搬完接着改名）。' +
      '★★ **语义**：`written_files` = 源文件 + 目标文件 + 各 importer 三者的**有序**清单 ⇒ ' +
      '**"符号现在住哪个文件"要挑**（本例 `[1]` = 搬到的那个新文件）—— 与"选择永远由调用方给"同一口径。',
  },
  {
    from: 'move_symbol',
    fromKey: 'symbols',
    to: 'rename_symbols',
    toPath: 'renames[].symbol',
    cardinality: 'pick',
    evidence: 'verified',
    note: '★ 同批真跑（2026-10-07，同一次调用）：`touched.symbols[0]` → `renames[].symbol`。★ `pick`：同批可能有多个符号。',
  },

  // ── ★★ 2026-10-06：§5 第二环的两条对象类边，**真跑升级**进本表（原在 `CHAIN_EDGES_PENDING`）──
  {
    from: 'rename_symbols',
    fromKey: 'written_files',
    to: 'edit_code',
    toPath: 'file',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-06，夹具 `$TEMP/t54chain`）：`rename_symbols`（`Kk→KkRenamed`，真落盘 2 文件）给 ' +
      '`touched.written_files=["src/a.ts","src/b.ts"]` ⇒ 调用方挑 `[1]` 放进 `edit_code.file`（`op=replace_text`）' +
      ' ⇒ `ok=true`。★★ **前提（不满足会静默改错文件）**：`edit_code.file` 是**相对 `project_dir`** 解析的，' +
      '而 `written_files` 是**仓库相对** ⇒ **必须同时把 `touched.project_dir`（通用边）传过去**，让两者同基准。',
  },
  {
    from: 'rename_symbols',
    fromKey: 'symbols',
    to: 'edit_code',
    toPath: 'symbol',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-06，同夹具）：`touched.symbols=["KkRenamed"]` ⇒ `symbols[0]` 放进 `edit_code.symbol`' +
      '（`op=replace` + 调用方给的 `code`）⇒ `ok=true`。★ 之所以是 `pick`：一次批量改 N 个符号就有 N 个。' +
      '★ `symbols` 装的是**新名**（下游拿新名继续操作；给旧名会让链静默接错）。',
  },

  // ── ★★★ 2026-10-09（T81）：**design 线的第一条对象边** ──
  //   在此之前 `CHAIN_EDGES` **一条 design 线都没有**（实测：design 线 12 个工具作上下游各 0）。
  //   根因不是"没写"，而是**只读工具没有能交给下游的对象**：`Touched` 里原先只有
  //   `written_files`（我**改了**哪些）与 `file`（主语**住**在哪），**没有一个"我圈定了哪些"**。
  //   ⇒ 为此新增了 `Touched.scope_files`（作用面·**只读也成立**），并让 `get_dsl query=scope` 产出它。
  {
    from: 'get_dsl',
    fromKey: 'scope_files',
    to: 'edit_code',
    toPath: 'file',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-09，夹具 3 文件）：`get_dsl {query:"scope", scope:"arch_layer:service"}` ⇒ ' +
      '`touched.scope_files=["src/core/format.ts","src/core/math.ts"]` ⇒ 走 `applyChainEdge` 取 `[0]` 放进 ' +
      '`edit_code.file`（`op=range`）⇒ **真落盘成功**（改后源码逐字可见）。' +
      '★ 之所以是 `pick`：一个 scope 圈住的通常是**一组**文件，改哪一片是**语义判断**（`applyChainEdge` 因此**不替你选**）。' +
      '★★ **前提（与 `written_files → edit_code.file` 同款）**：`edit_code.file` 相对 `project_dir` 解析，' +
      '而 `scope_files` 是**仓库相对** ⇒ **必须同时把 `touched.project_dir`（通用边）传过去**，让两者同基准。' +
      '★ 这一条的意义不在"多一条边"，而在：**编排里第一次有了设计侧**（此前只有 refactor 线）。' +
      '★ 同形但**未逐条验**的边（故**先不写进表**）：`scope_files → move_symbol.file`、' +
      '`scope_files → rename_symbols.renames[].file` —— 验过再加，不把预测写成实测。',
  },
  {
    from: 'get_dsl',
    fromKey: 'scope_files',
    to: 'move_symbol',
    toPath: 'file',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-09，夹具）：`get_dsl {query:"scope", scope:"all"}` ⇒ `scope_files` 里取 ' +
      '`src/core/math.ts` 放进 `move_symbol.file`（`symbol=add` / `to_file=src/util/calc.ts` 由**调用方给**）' +
      '⇒ `ok=true`、`filesWritten=2`（源文件删段 + 目标文件新建）。' +
      '★★ **这是"半条边"，如实记**：它只填下游 3 个必填里的 **1 个**（`file`）；' +
      '`symbol` 与 `to_file` 是**意图**，只能由调用方给 —— ' +
      '★ 依 `CHAIN_EDGES` 的立论：**接续负责"位置与对象"，不负责"意图"**（`capability_map` 的接续段会把' +
      '"还要给"逐条列出来）。★ 与 `applyChainEdge` 在 `pick` 上不替人选中下标**同一条道理**。',
  },
  {
    from: 'consistency_check',
    fromKey: 'scope_files',
    to: 'edit_code',
    toPath: 'file',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★★ **这是"对拍 → 重写"那一跳**（用户工作流的核心：把**不对的范围**圈出来 ⇒ 去改它）。' +
      '★ 真跑（2026-10-09，夹具）：`consistency_check` 的 `touched.scope_files=["src/core/format.ts"]`' +
      '（= **差异面**：验收 `call-exists total→add` 判 fail 的那个文件）⇒ 取 `[0]` 放进 `edit_code.file`' +
      '（`op=range`）⇒ **真落盘成功** ⇒ 再对拍 ⇒ **无差异（`scope_files` 随之省略）** ✅ —— 闭环。' +
      '★ 语义记清：`get_dsl query=scope` 交的是**作用面**，本工具交的是**差异面**（"哪些文件不对"），' +
      '两者**都落进 `scope_files` 同一个键**（语义统一为"**要我关注的文件**"，词表已写清这两种来源）。' +
      '★ 之所以是 `pick`：差异可能落在多个文件上；改哪一片由调用方定。' +
      '★★ **前提**：`edit_code.file` 相对 `project_dir` 解析 ⇒ 必须同时传 `touched.project_dir`（通用边）同基准。' +
      '★★ 实现踩到的坑（留档）：`consistency_check` 有**两条返回路径**（给 scope / 不给 scope），' +
      '我最初只改了给 scope 的那条 ⇒ **默认那条根本不产 `touched`**。' +
      '⇒ 两条路径现在**共用同一套判据**（`hasDiff` 与 `groupExpectationFails`，都是导出的单点）。',
  },

  // ── ★★★ 2026-10-09（T82 的硬前提）：**入口也能上链了** ──
  //   在此之前 `import_project`（建档 = 这条链的**第一步**）在 `deriveObjectChains()` 里**永远没有它**。
  //   ★ 根因**不是"没写这条边"**，而是它交的两个键（`feature` / `project_dir`）**都是作用域键**
  //     （`ANY_TOOL → ANY_TOOL`，见 `SCOPE_PATHS`）⇒ **一个对象都不承载**。
  //   ★ 实测代价（T82，2026-10-09 真跑试用）：手写 `direct` 名单 9 个，去掉"没上链的 6 个"之后
  //     会**削掉 `import_project`（新人第一站）/ `edit_dsl`（写设计）/ `capability_map`（导航它自己）**。
  //   ⇒ 补法 = 让它交出一个**对象类**锚点 `scope_files`（= 本次扫进来、归本 feature 管的源码文件），
  //     与 `get_dsl query=scope`（作用面）、`consistency_check`（差异面）**同一把钥匙、同一个语义**。
  {
    from: 'import_project',
    fromKey: 'scope_files',
    to: 'edit_code',
    toPath: 'file',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-09，夹具 `C:/tmp/agentio_t82`，3 个 TS 文件）：' +
      '`import_project {project_dir,feature}` ⇒ `touched.scope_files=["src/core/format.ts","src/core/math.ts","src/util/calc.ts"]`' +
      '（与读数 `files_parsed:3` 同源）⇒ 取 `[0]` 放进 `edit_code.file`（`op=range` L1-L3 + 调用方给的 `code`）' +
      '⇒ `ok=true` / `written=true` / `written_files=["src/core/format.ts"]` ⇒ **真落盘**（diff 逐字可见）。' +
      '★★ **零字段名翻译**：`scope_files[0]` → `file`、`touched.project_dir` → `project_dir`（后者走通用边）。' +
      '★ 之所以是 `pick`：导入的是**一整个项目**（本仓实测 400 文件）⇒ 改哪一个是**语义判断**，`applyChainEdge` 不替你选' +
      '（与 `get_dsl` 那两条同款）。' +
      '★★ **前提**：`edit_code.file` 相对 `project_dir` 解析，而 `scope_files` 是**仓库相对** ⇒ ' +
      '**必须同时把 `touched.project_dir` 传过去**，让两者同基准。',
  },

  // ── ★★★ 2026-10-09（T82 的硬前提·第 2 条）：**写设计这一步也上链了** ──
  //   与上一条同病同治：`edit_dsl` 的 `touchedOf` 原先**只给 `feature`**（作用域键）⇒ 零对象 ⇒ 上不了链。
  //   而它**明明有对象可交**：它改的就是 DSL 的**节点** —— `Touched.nodes` 这个键**早就存在**。
  //   ⇒ 补法 = `touchedOf` 交出 `nodes`（只收 `id` 就是节点 id 的那几种 op：`node`/`binding`/`status`；
  //     `edge`/`file`/`api` 的 `id` **不是节点**，一个都不收 —— §2.2「名字像 ≠ 同义」）。
  {
    from: 'edit_dsl',
    fromKey: 'nodes',
    to: 'get_dsl',
    toPath: 'node_id',
    cardinality: 'pick',
    evidence: 'verified',
    note:
      '★ 真跑（2026-10-09，夹具 `C:/tmp/agentio_t82` 的 feature `t82probe`）：' +
      '`edit_dsl {op:move,type:node,id:"file_src_core_format_ts"}` ⇒ `touched.nodes=["file_src_core_format_ts"]`' +
      '⇒ 取 `[0]` 放进 `get_dsl.node_id`（`query="node"`）⇒ **真读到该节点**（`label/type/x/y` 全在）。' +
      '★ 之所以是 `pick`：一次 `edit_dsl` 可以改**多个**节点（`operations[]` 是数组）⇒ 下游看哪个由调用方定。' +
      '★★ **口径（别拿它当"改了哪些节点"的唯一来源）**：只给**落定后仍存在**的 id —— ' +
      '`op=delete` 之后那个节点已经不在 DSL 里，交出去会让下游去查一个**不存在的节点**。' +
      '★ 出生证（真跑，能区分）：同一次调用里 `delete dir_src_util` + `move file_src_core_math_ts` ⇒ ' +
      '`touched.nodes=["file_src_core_math_ts"]` —— **两个都被点名，只给活着的那个** ✓' +
      '（与 `find_references.file` "只在真有定义时才给" 同款判据）。',
  },
];

/**
 * ★ **待验**的边：`docs/tool-chain-contract.md` §5 写了链，但**一条都没真跑过**。
 * ★ 单独一张表 —— 让"没验"这件事**在读数里看得见**，而不是混进 `CHAIN_EDGES` 冒充已验证。
 */
export const CHAIN_EDGES_PENDING: readonly ChainEdge[] = [
  // ★★★ 2026-10-06：**本表已清空** —— 原有三条全部真跑出了结论：
  //   · `rename_symbols.written_files → edit_code.file`   ⇒ ✅ **成立**，已升级进 `CHAIN_EDGES`；
  //   · `rename_symbols.symbols → edit_code.symbol`       ⇒ ✅ **成立**，已升级进 `CHAIN_EDGES`；
  //   · `edit_code.written_files → run_tests.project_dir` ⇒ ❌ **证伪、撤掉**（见下证伪记录）。
  //   ★ 保留"空表"而不是删掉这个导出：`renderChainWiring` 仍在读它，且**它下次该重新有内容**
  //     （§5 那条链只是第一条；别的链还没人真跑）。
  //
  // ── 证伪记录（★ **撤掉的边必须留证**，否则下一个人会重新写一遍同一张表）──
  //   `edit_code.touched.written_files → run_tests.project_dir`（2026-10-06 真跑，夹具 `$TEMP/t54chain`）：
  //   把 `written_files[0]`（= `src/b.ts`，一个**文件**）当 `run_tests.project_dir`（一个**根**）传 ⇒
  //   `ok=false`，报 `无法读取目标项目 package.json（…\src\b.ts\package.json）`。
  //   ⇒ **文件 ≠ 根**：这条边**形态上就不成立**（不是"待验"）。
  //   ★ **正确接法** = `touched.project_dir → run_tests.project_dir`（**通用边**，已 `verified`）⇒ 真跑 `ok=true`。
  //   ★ 而 §5 想要的那件事（"只跑本次改动相关的测试"）**今天仍接不上**：`run_tests.filter` 要的是
  //     **测试文件 / 名称**，`written_files` 是**源文件** ⇒ 中间缺一步"**源文件 → 对应测试**"的映射
  //     （今天没有任何工具给这个映射）⇒ 那是**能力缺口**，不是命名问题，**别用改字段名去凑**。
  //
  // ── ★★ 2026-10-06（第 2 条链）真跑记录：`import_project → extract_contracts → find_references` ──
  //   ★ 结论：**这条链接不上**；而且它**本来就不是一条"对象类"链** —— 逐环真跑（夹具 `C:/tmp/t54chain2`，
  //     2 个 TS 文件；三环都经 CLI `cli <name> k=v` 真调，非推断）：
  //     · 环A `import_project` ⇒ 产物**没有 `touched`**：它住 `src/infrastructure/graph/`，
  //       **不在量具的 [B] 人群（`application/**`）里**，全文件 `grep touchedOf` = **0**。
  //       ⇒ 能往下传的只有产物顶层那个 `feature`（**纯字段、不是链的接口** = "剪贴板"那一格）。
  //     · 环B `extract_contracts` ⇒ `touched = {project_dir, feature}` —— **只有两条作用域锚点，
  //       没有任何对象类锚点**（源码自陈：不给 read_files / written_files / symbols / nodes，理由"取不到就不猜"）。
  //     · 环C `find_references`（只带 A/B 能给出的 `project_dir` + `feature`）⇒ ❌ **报错**：
  //       `缺少必需参数 file：mode=symbol（默认）需要 file（定义符号的文件）`。
  //   ⇒ **证伪点 = 环C**：`extract_contracts` **交不出棒**，链在此断（不是"待验"，是**形态上不成立**）。
  //   ⇒ ★★ **结论更正（2026-10-06 复核，推翻本段初稿）**：初稿写「给 `extract_contracts` 补一个
  //     对象类锚点即可让它成链」—— **不成立**。复核实测：`find_references` 要的是 **`file` + `symbol`**
  //     **两个**对象入参，而 `extract_contracts` 的产物里**既没有定位器、也没有符号名**
  //     （`contract_reports[]` 只有 `path`（**事实字段**）/`role`/`fan_in`/`fan_out`/`shape_count`/`effects`；
  //      `contract_stats` 全是计数）⇒ **补一个锚点补不上两个缺口**。
  //     ★ 更准确的定性：`extract_contracts` 是**终端分析工具**（产物交给 DSL / 交给人，不交给符号级下游）
  //       ⇒ **`import_project → extract_contracts → find_references` 根本不是一条链**，
  //       它只是三个工具**共用作用域锚点**（`project_dir` / `feature`）而已。
  //     ⇒ 教训：**「看起来连得上」≠「是链」** —— 判它要看**下游要不要对象类入参**（见 `CHAINS` 的判据）。
  //
  //   ★★ 顺带发现（**通配边的隐含前提**）：`ANY_TOOL` 那两条边（`project_dir` / `feature`）的成立前提是
  //     "**上游有 `touched`**"，而下面两类上游**没有**：
  //     · 7 个**已登记豁免**的 [B]（`B_TOUCHED_EXEMPT`：分派器 / 纯计算 / 无根）—— 没有 `touchedOf`；
  //     · **`application/` 之外**的工具（如 `import_project`，住 `infrastructure/`）—— 不进量具人群，同样没有。
  //     ⇒ 这两条边**对它们并不成立**（对 `import_project` 尤其明显：它连 `touched` 对象都没有）。
  //     ★ **本次不改这两条边**：那是"**对谁成立**"的**范围**问题、不是形态问题；且收紧前先要有人读量
  //       "到底多少 [B] 真的产 `touched.feature` / `.project_dir`"（今天读数：`feature` 19/33 · `project_dir` 22/33）
  //       —— 记在此处，**别凭感觉收紧或放宽**。
];

/**
 * 「这一格的**表达式**」—— ★★ **全仓唯一一处**定义"选一个"怎么写（别在别处手抄）。
 *
 * · `single` ⇒ `touched.<键>`（只有一个，取即确定）
 * · `pick`   ⇒ `touched.<键>[i]`（可能有多个，**下标由调用方给** —— 选择是语义判断，不自动化）
 */
/**
 * ★★★ **按"谁来接谁"查接法边**（2026-10-09，T54 顺便收口）。
 *
 * ## 为什么要有它（实测踩到）
 * 接法表里有**通配边**（`from`/`to` = `ANY_TOOL`，如 `project_dir` / `feature`：任何 [B] 之间直通）。
 * ⇒ 调用方若照 `edge.to === 'edit_code'` 去找，**永远找不到通配那两条**，然后报"接法表里没有这条边" ——
 *   而**那条边其实在**，只是用通配表达的。
 * ★ 这个"要不要算通配"的判断**此前散在每个调用方手里**（本仓头号病的又一例）⇒ 收成这一处。
 * ★ 反面同样有坑：**逐段判定链通不通时，通配边必须排除**（否则恒真，见 `verifiedEdgesBetween` 的教训）。
 *   两处结论相反、方向相反 —— 所以更**必须各自写在一个具名函数里**，别让读者在调用点猜。
 *
 * 排序：**精确边优先于通配边**（更具体的赢）；同具体度按表内顺序（稳定）。
 */
export function findChainEdges(
  from: string,
  to: string,
  opts?: { fromKey?: string; toPath?: string },
): readonly ChainEdge[] {
  const hit = (x: string, t: string): boolean => x === t || x === ANY_TOOL;
  const rank = (e: ChainEdge): number => (e.from === from && e.to === to ? 0 : 1);
  return CHAIN_EDGES.filter(
    (e) =>
      hit(e.from, from) &&
      hit(e.to, to) &&
      (opts?.fromKey === undefined || e.fromKey === opts.fromKey) &&
      (opts?.toPath === undefined || e.toPath === opts.toPath),
  ).slice().sort((a, b) => rank(a) - rank(b));
}

export function chainExprOf(e: ChainEdge): string {
  return e.cardinality === 'single' ? `touched.${e.fromKey}` : `touched.${e.fromKey}[i]`;
}

/**
 * ★★★ **执行一次接续**：拿上游的 `touched` + 一条接法边 ⇒ 产出下游入参的那一格（2026-10-09，`docs/todo.md` T54）。
 *
 * ## 为什么需要它（这就是"管道"缺的那一段）
 * 本仓的产物端（`Touched`）与接法表（`CHAIN_EDGES`）**都已经做完了**，
 * 但**"把上一步的值取出来、放到下一步的入参位置"**这件事**一直由调用方手工做** ——
 * 而"手工做"正是会出错的地方：**回忆字段名、自己数下标**。
 * ⇒ 本函数把那一格变成**一个纯函数调用**：输入 `touched` + 边，输出 `{toPath, value}`。
 *
 * ## 三条纪律
 * 1. ★★★ **不替调用方选**：`cardinality:'pick'` 时**必须**显式给下标；不给就**报错并列出候选**，
 *    绝不默认取第 0 个（"选"是语义判断 —— 本文件开头的立论；默认选 = 静默替人做决定）。
 * 2. ★★ **不许静默降级**：字段缺了、类型不对、`single` 却给了多元素 —— 一律 `ok:false` + 人话原因，
 *    不返回 `undefined` 让下游猜（`undefined` 传下去会变成"看起来能跑"）。
 * 3. ★ **表达式只由 {@link chainExprOf} 生成**（同一个形态，别在这里再拼一份）。
 */
export type ChainHandoff =
  | { ok: true; toPath: string; value: string; expr: string }
  | { ok: false; reason: string; candidates: readonly string[]; expr: string };

export function applyChainEdge(
  touched: Record<string, unknown>,
  edge: ChainEdge,
  opts?: { pick?: number },
): ChainHandoff {
  const expr = chainExprOf(edge);
  const raw = touched[edge.fromKey];
  if (raw === undefined || raw === null) {
    return { ok: false, reason: `上游 touched 里**没有** \`${edge.fromKey}\`（这次没产出它）`, candidates: [], expr };
  }
  if (Array.isArray(raw)) {
    const xs = raw.map((x) => String(x));
    if (xs.length === 0) {
      return { ok: false, reason: `上游 \`${edge.fromKey}\` 是**空数组**（这次没产出任何元素）`, candidates: [], expr };
    }
    if (edge.cardinality === 'single') {
      if (xs.length !== 1) {
        return {
          ok: false,
          reason: `这条边声明的是 \`single\`（只该有一个元素），但上游给了 ${xs.length} 个`,
          candidates: xs,
          expr,
        };
      }
      return { ok: true, toPath: edge.toPath, value: xs[0]!, expr };
    }
    // pick：★ 下标必须由调用方给 —— 这里**不默认取第 0 个**
    //   ★★ 例外（2026-10-09，实跑时发现）：**候选只有 1 个 ⇒ 选是确定的** —— 直接取，并注明。
    //     理由就是本表自己的立论：「`single` —— 集合**只有一个元素**时**确定** ⇒ 直接取，无需选择」。
    //     `cardinality` 是**静态声明**（"这条边可能有多个"），而"**这轮实际有几个**"是**运行期事实** ⇒
    //     后者更准。★ 否则会出现"只有 1 个候选却要你选"——那不是谨慎，是把判断推给调用方。
    const i = opts?.pick;
    if (i === undefined) {
      if (xs.length === 1) return { ok: true, toPath: edge.toPath, value: xs[0]!, expr };
      return {
        ok: false,
        reason: `这条边是 \`pick\`（可能有多个）⇒ **要你给下标**（\`pick:i\`）。★ 刻意不替你在候选里选 —— 选择是语义判断`,
        candidates: xs,
        expr,
      };
    }
    if (!Number.isInteger(i) || i < 0 || i >= xs.length) {
      return { ok: false, reason: `下标 ${i} 越界（候选 ${xs.length} 个）`, candidates: xs, expr };
    }
    return { ok: true, toPath: edge.toPath, value: xs[i]!, expr };
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return { ok: true, toPath: edge.toPath, value: String(raw), expr };
  }
  return { ok: false, reason: `上游 \`${edge.fromKey}\` 的类型是 ${typeof raw}，不是标量也不是数组`, candidates: [], expr };
}

/**
 * ★★★ 链 = **一等公民**（2026-10-06，M1 第一步：把「链」从**散文**变成**可判定的数据**）。
 *
 * ★ 为什么要它：在此之前 `CHAIN_EDGES` 只是**一张两条边的表**（A→B），而"**一条链**"只活在
 *   `docs/tool-chain-contract.md` 的散文里 ⇒ **没有任何东西能机器判定"这条链通不通"** ⇒
 *   "跑通一条记一条"全靠人记（**记漏、记错都静默**）—— 正是本文件开头说的那个病。
 *
 * ★★ 判定的**唯一判据** = `CHAIN_EDGES`：逐段查 `(A → B)` 有没有**对象类**的 `verified` 边
 *   （★ 作用域边 `project_dir` / `feature` **恒有** ⇒ **剔出判定**，理由见 `verifiedEdgesBetween` 上的实测教训）。
 *   ★ **只查表** —— 故判"通"是**必要不充分**：它说"每段都有已验证边"，**不等于**"整条链真跑过"。
 *     整条链有没有真跑过，**另记**在 `evidence`（同 `CHAIN_EDGES` 的口径：**不许把没跑的写成跑过**）。
 * ★ **没做的事（下一步）**：本判定**不查"下游到底要不要对象类入参"** —— 那需要 `ToolDef`
 *   （属 `application` 层），而本文件在 `domain`，**不能反向依赖**。⇒ 现状下"作用域锚点能通"
 *   会让一条**其实没有对象交接**的链也显示"每段有边"（`import_project → extract_contracts → …`
 *   就是这种：它只共用 `project_dir` / `feature`）。
 */
export interface Chain {
  /** 链名（人读，唯一） */
  readonly name: string;
  /** 有序的 [B] 序列（`steps[i] → steps[i+1]` 是一段） */
  readonly steps: readonly string[];
  /** ★ **整条链真跑过没有**（`verified` = 每一段都真跑过；`pending` = 还没人跑） */
  readonly evidence: 'verified' | 'pending';
  /** 证据一句话（`verified` 必填，写清"怎么验的"） */
  readonly note: string;
}

/**
 * ★★ 链表。★ 每加一条都要有**真跑**结论才许写 `verified`。
 */
export const CHAINS: readonly Chain[] = [
  {
    name: 'refactor',
    steps: ['find_references', 'rename_symbols', 'edit_code', 'run_tests'],
    evidence: 'verified',
    note:
      '§5 那条链（= `docs/tool-chain-contract.md` §5）。三环真跑：两条对象类边升级 `verified`；' +
      '第四段（`edit_code → run_tests`）真跑**证伪**了"拿 `written_files` 当 `project_dir`"，' +
      '**正确接法** = `touched.project_dir`（通用边，已 `verified`）⇒ 机器判"每段都有已验证边" ✓，与真跑一致。' +
      '★ 但第四段想要的那件事（"只跑本次改动相关的测试"）**仍未实现**：`run_tests.filter` 要**测试文件/名称**，' +
      '而 `written_files` 是**源文件** ⇒ 中间缺"源文件 → 对应测试"的映射（**能力缺口**，今天没有工具给）。',
  },
  {
    name: 'design-import',
    steps: ['import_project', 'extract_contracts', 'find_references'],
    evidence: 'verified',
    note:
      '2026-10-06 真跑 ⇒ **断在第 2 段**（`extract_contracts → find_references`）：**无已验证边**，' +
      '真跑时 `find_references` 报"缺少必需参数 file"。★ 且它**根本不是一条链**：' +
      '`extract_contracts` 是**终端分析工具**，产物里既无定位器也无符号名 ⇒ 交接不出对象。' +
      '★ 这条链记的是"**看起来连得上 ≠ 是链**"这个反例。',
  },
  {
    name: 'design-loop',
    steps: ['import_project', 'edit_dsl', 'consistency_check', 'edit_code', 'consistency_check'],
    evidence: 'verified',
    note:
      '★★ **用户工作流那条链**：**建档 → 写设计 → 对拍 → 重写 → 再对拍**（"一步步往设计靠近"）。' +
      '★ 端到端真跑（2026-10-09，3 文件夹具，**全程真落盘**）：' +
      '`import_project` ⇒ `edit_dsl` 写决策卡+`call-exists` 验收 ⇒ `consistency_check` 判 **failed=1** 并交出 ' +
      '`scope_files=["src/core/format.ts"]` ⇒ 取 `[0]` 给 `edit_code.file`（`op=range`）⇒ `written=true` ⇒ ' +
      '再 `consistency_check` ⇒ **通过 1 / failed 0**（`scope_files` 随之省略）⇒ **闭环** ✅' +
      '★★ **逐段交接物（如实，别粉饰）**：①→② `feature`（**作用域**）· ②→③ `feature`（**作用域**）· ' +
      '③→④ **`scope_files → file`（对象边，已 `verified`）** · ④→⑤ `project_dir`（**作用域**，通用边）。' +
      '★ 所以 `hopsOf` 会把**前两段与末段**报成 **`scope-only`（弱交接）** —— ★ 那不是"断"：' +
      '**设计侧工具的对象天然都住在同一个 `feature` 里**（DSL / 决策 / 验收 / 差异块），' +
      '它们之间**本来就靠作用域键 `feature` 交接** ⇒ "没有对象边"在这里是**结构事实**，不是断链。' +
      '★★ 真跑中修掉的**真缺口**：`import_project` **原本连 `touched` 都没有** ⇒ 这条链的**第一段根本没有交接物**' +
      '（调用方只能自己记住 `feature`）。已补 `touched={feature, project_dir}`；' +
      '★ **刻意不给 `written_files`** —— 它写的是 `<dataHome>` 下的 DSL/存档/索引，**不是源码**，给了就是谎报。' +
      '★★ 遗留（未做）：判据只有"有对象边/没有"**两值**，而真实情况是**三值**' +
      '（有对象边 / **仅靠作用域交接** / 真断）⇒ 建议三值化（`docs/todo.md`）。',
  },
];

/**
 * `(A → B)` 之间**已验证**的边（含通配 `ANY_TOOL`）。
 * ★ 一处定义，别在别处再写一遍这个过滤（那是第二份副本）。
 *
 * ★★★ **2026-10-06 实测教训：本判定第一版是「恒真」的（同轮发现、同轮修）** ——
 *   第一版用 `verifiedEdgesBetween(from, to).length === 0` 判"这段断没断"，
 *   而表里有两条 `ANY_TOOL → ANY_TOOL` 的**通配边**（`project_dir` / `feature`）⇒
 *   **任何一段都能匹配上** ⇒ 判定**恒真**、**一条链也断不了**。
 *   ★ **证据不是我推出来的**：它当时给 `design-import` 判的是"✓ 每段都有已验证边"，
 *     而**同一天的真跑已证明这条链在 `extract_contracts → find_references` 处断**
 *     （`find_references` 报"缺少必需参数 file"）⇒ **机器与真跑打架 ⇒ 机器是假的**。
 *   ⇒ 修法：**把"作用域边"从判定里剔出去** —— 它们（`project_dir` / `feature`）几乎**任何段都有**
 *     ⇒ **必要不充分、不承载对象**。判定只报**对象类边**（见 {@link SCOPE_PATHS} / {@link hopsOf}）。
 *   ★★ 但**仍不判生死**："该段下游到底要不要对象类入参"需要 `ToolDef`（`application` 层），
 *     本文件（`domain`）取不到 ⇒ 故只报**事实（对象类边几条）**，
 *     而"通没通"那条**真跑结论另记在 `CHAINS[].note`**（那里才是权威）。
 */
export function verifiedEdgesBetween(from: string, to: string): readonly ChainEdge[] {
  return CHAIN_EDGES.filter(
    (e) => e.evidence === 'verified' && (e.from === from || e.from === ANY_TOOL) && (e.to === to || e.to === ANY_TOOL),
  );
}

/**
 * 作用域锚点的入参位置：**几乎任何段都能通** ⇒ 必要不充分，**不算"对象交接"**。
 * ★ **导出**（2026-10-06）：`application` 层的完整判定（`capability_map`）必须用**同一份**口径
 *   —— 否则「什么是作用域锚点」就有了第二份副本（本仓头号病根）。
 */
export const SCOPE_PATHS = new Set(['project_dir', 'feature']);

/** 一段的判定 —— ★ **只报事实**，不判生死。 */
/**
 * 一段链路的判定 —— ★★★ **三值**（2026-10-09，`docs/todo.md` T83）。
 *
 * ## 为什么必须是三值（实测暴露）
 * 写 `design-loop`（用户那条工作流）时：**每一段都端到端真跑通、闭环**
 * （验收 failed 1 → 改写 → 通过 1），而旧判据把它报成**三处「⚠ 无对象类边」** ——
 * 因为那几段靠 **`feature`（作用域键）** 交接，而判据**特意剔除作用域边**
 * （理由见 `verifiedEdgesBetween`：不剔就"恒真、没有信息量"）。
 * ⇒ **判据错吗？不错。错的是它只有两值** ⇒ **真跑通的链看起来像断了**（事实被压成错误的样子）。
 *
 * ## 三档**实际只落两档**（★ 2026-10-09 当场验出来，据实改）
 * 我第一版写的是三值（强 / 弱 / **真断**），可**实测立刻打脸**：作用域边是 `ANY_TOOL → ANY_TOOL`
 * ⇒ **恒有** ⇒ `scopeEdges` **从不空** ⇒ **"真断"那一档不可达**（死档）。
 * ★ **"真断"的正确判据**应是「**下游确实要对象类入参，而这一段没喂**」 —— 那需要知道下游的入参形状
 *   （`ToolDef`，在 `application` 层）。
 *   ⇒ ★★★ **而它已经住在别处**：「链的完整判定」段（`capability_map` 的 `renderChainVerdicts` /
 *     `chainVerdictsOf`）用 `ToolDef` 算 `wants`（下游要哪些对象）/ `fed`（上游喂了哪些）/ `state`
 *     （`ok` / `no-need` / `gap`）—— **比本段完整**。
 *   ⇒ 所以本段**只查表、只报"有没有对象边"这一件事**，**不把段 B 的逻辑抄过来**（抄过来 = **判据分叉**）。
 *   ★★ 记账（2026-10-09，T84）：我**差点就抄了** —— 已经把 `needsObjects` 注入写好，
 *     回头一查才发现段 B 早就有更全的算法 ⇒ **当场回退**，并把责任边界写在这儿。
 *     教训：**动手前先查仓库里有没有**（本仓反复栽在这一条上）。
 *   ⇒ 所以本类型**只给可达的两档**，**不摆一个永远不出现的警告**（摆着就是骗人）。
 */
export interface HopVerdict {
  hop: number;
  from: string;
  to: string;
  /** ★ 该段**除作用域外**的已验证边（= "下游要的对象"有没有人喂）。**这是强交接的判据。** */
  objectEdges: readonly ChainEdge[];
  /** ★ 该段的**作用域**已验证边（`project_dir` / `feature`）—— 弱交接的判据（T83 新增）。 */
  scopeEdges: readonly ChainEdge[];
  /** ★ **可达的两档**（本段的责任边界；"真断"看「链的完整判定」段）：`strong` / `scope-only`。 */
  kind: 'strong' | 'scope-only';
}

/** 逐段判定（★ 两档；"真断"见「链的完整判定」段 —— 责任边界见 {@link HopVerdict}）。 */
export function hopsOf(chain: Chain): readonly HopVerdict[] {
  const out: HopVerdict[] = [];
  for (let i = 0; i + 1 < chain.steps.length; i++) {
    const from = chain.steps[i];
    const to = chain.steps[i + 1];
    const all = verifiedEdgesBetween(from, to);
    const objectEdges = all.filter((e) => !SCOPE_PATHS.has(e.toPath));
    const scopeEdges = all.filter((e) => SCOPE_PATHS.has(e.toPath));
    out.push({
      hop: i + 1,
      from,
      to,
      objectEdges,
      scopeEdges,
      kind: objectEdges.length > 0 ? 'strong' : 'scope-only',
    });
  }
  return out;
}

/** 渲染链表（给 `capability_map` 用）。 */
export function renderChains(max = 20): string {
  const lines = CHAINS.slice(0, max).map((c) => {
    const hops = hopsOf(c);
    const counts = hops.map((h) => `${h.from}→${h.to}: ${h.objectEdges.length}`).join(' · ');
    // ★★★ T83：三值分档 —— **"仅靠作用域交接"≠"断"**（旧版把两者都印成 ⚠，把通的说成断的）。
    // ★★ 但**原因不在渲染处解释**：同样是"弱交接"，`refactor` 第 3 段的原因是"缺 源文件→测试 的映射"，
    //   而 `design-loop` 的原因是"设计侧对象都住在同一个 feature 里"—— **两回事**。
    //   ⇒ 渲染**只报事实（哪一档、几段）**，**为什么**由 `CHAINS[].note` 说（那里是逐链真跑结论）。
    //     ★ 我第一版在这句里套了解释"设计侧…"，结果把它贴到了 `refactor` 上 —— **又一处"同一段话套不同事实"**。
    const strong = hops.filter((h) => h.kind === 'strong').length;
    const weak = hops.filter((h) => h.kind === 'scope-only').length;
    const firstWeak = hops.find((h) => h.kind === 'scope-only');
    const tally = `强 ${strong}/${hops.length} · 弱 ${weak}`;
    const status = weak
      ? `◇ **仅靠作用域键交接**（首处在第 ${firstWeak!.hop} 段：${firstWeak!.from} → ${firstWeak!.to}）` +
        ` —— ★ **弱交接 ≠ 断**；"**这一段到底行不行**"看下面「**链的完整判定**」段（它算"下游要不要对象"）；` +
        `**为什么弱**逐链见 CHAINS[].note｜${tally}`
      : `✓ 每段都是**强交接**（有对象类边）｜${tally}`;
    return `    ${c.name.padEnd(14)} [${c.evidence}] ${c.steps.join(' → ')}\n${' '.repeat(19)}${status}｜对象类边数 ${counts}`;
  });
  return (
    '\n\n── 链（★ 一等公民：逐段查 `CHAIN_EDGES`；每段分**两档**：强交接（有对象类边）/ 弱交接（仅作用域键））──\n' +
    lines.join('\n') +
    '\n  ★★ **本段只回答一件事**："每一段**有没有对象类边**"。' +
    '\n     ★ **"这一段到底行不行"不在这里判** —— 那要知道"下游要不要对象类入参"，' +
    '\n       而那件事**已经住在下面「链的完整判定」段**（它用 `ToolDef` 算 `wants`/`fed`/`state`）。' +
    '\n     ★★ 责任边界是**有意**划的（2026-10-09，T84）：我**差点把段 B 的逻辑抄进本段**（`needsObjects` 注入都写好了），' +
    '\n        回头一查才发现段 B 早就有更全的算法 ⇒ **当场回退**。**抄一份 = 判据分叉**（本仓头号病）。' +
    '\n  ★★ 通没通，**只看 `[verified]`** —— 那是整条链的真跑结论，权威在 `CHAINS[].note`。' +
    '\n  ★★ **"弱交接"不是断**（2026-10-09，T83）：它只是"这一段靠 `feature`/`project_dir` 接上、没有对象类边"。' +
    '\n     ★ 旧版把弱交接与"无对象边"印成同一个 "⚠"，⇒ **真跑通了整条链，看起来却像断的**' +
    '\n       （判据只有一档 ⇒ 事实被压成错误的样子）。' +
    '\n     ★ **为什么某一段是弱交接，逐链看 `note`** —— 不同链的原因不同（例：`design-loop` 是"设计侧对象都住在同一个 feature 里"；' +
    '\n       `refactor` 末段是"缺 源文件→对应测试 的映射"），渲染处**不替它们编统一解释**。'
  );
}

/**
 * ★★ 从**已验证的对象边**枚举**候选链**（2026-10-06，M1：从"手写"走向"派生"）。
 *
 * ★ 只取**两端都具体**的对象边：**排除通配边**（`ANY_TOOL`）—— 它们既会让枚举**爆炸**，
 *   又正是上一次"恒真判定"的根因（见 `verifiedEdgesBetween` 上的实测教训）。
 * ★ 结果是**候选**，**不是"已验证链"**：它只证明"每段都有对象边"，**没有真跑过**。
 *   ⇒ `CHAINS` 那种"手写的、带真跑结论的链"**仍然要留**：两者回答的是不同问题 ——
 *     派生回答"**还能拼出哪些**"，手写回答"**哪条真的跑通过**"。
 * ★ 校验（本函数的出生证，2026-10-06 实测）：派生集合**包含**手写 `refactor` 链的**对象段**
 *   `[find_references, rename_symbols, edit_code]`，且**不含** `design-import`（它一条对象边都没有）
 *   —— 与"那条链真跑断在 `extract_contracts → find_references`"**一致**。
 */
export function deriveObjectChains(minLen = 2, maxLen = 6): string[][] {
  const arcs = CHAIN_EDGES.filter(
    (e) => e.evidence === 'verified' && e.from !== ANY_TOOL && e.to !== ANY_TOOL && !SCOPE_PATHS.has(e.toPath),
  );
  const next = new Map<string, string[]>();
  // ★★ **邻接表必须去重**：同一对 (A → B) 可能挂着**多条对象边**
  //   （例：`rename_symbols → edit_code` 就有 `written_files→file` 与 `symbols→symbol` 两条）
  //   ⇒ 不去重会让**同一条链被枚举多次**（本函数第一版实测输出了两个相同的 `[find_references, rename_symbols, edit_code]`）。
  //   ★ 又是"**静默多收**"的同族：不报错，只是多算。
  for (const a of arcs) next.set(a.from, [...new Set([...(next.get(a.from) ?? []), a.to])]);
  const hasIn = new Set(arcs.map((a) => a.to));
  const starts = [...next.keys()].filter((k) => !hasIn.has(k));
  const out: string[][] = [];
  const walk = (path: string[]): void => {
    if (path.length >= minLen) out.push([...path]);
    if (path.length >= maxLen) return;
    for (const nxt of next.get(path[path.length - 1]) ?? []) {
      if (path.includes(nxt)) continue; // 防环
      walk([...path, nxt]);
    }
  };
  // ★ 全图都有入度时（纯环）没有"起点" ⇒ 从每个节点起，免得**静默空结果**。
  for (const s of starts.length > 0 ? starts : [...next.keys()]) walk([s]);
  return out;
}

/**
 * 本工具**所有**已验真的出边（= "下一棒"）。
 *
 * ★ 只取**两端都具体**的边：**排除通配边**（`ANY_TOOL`）。
 *   ★★ **为什么不展开它（不是"提前收敛"，是"展开会失真"）**：
 *     通配边是一条**全称命题**（「**任何** [B] 的 `touched.project_dir` 能喂**任何** [B] 的 `project_dir`」），
 *     它**忠实的渲染就是"任何工具"四个字**。展开成 `61 × 2` 行 = 把 **1 条规则伪装成 122 条候选**，
 *     而**信息量恰好为零** —— 每个工具都在里面 ⇒ 狗食从它身上**看不出任何区别**（这正是"要减"的东西）。
 *     ⇒ 正确的给法 = **规则提一次**（见 `renderNextHops` 末尾那行脚注 + 接法表里的两行），
 *       **不按工具展开**。
 * ★ 用途（2026-10-06，用户裁定「**先不收敛，所有有可能的下一棒都给它**」）：
 *   在**回执通道**里告诉调用方"从这一步能接哪几棒、用什么表达式"。
 */
export function nextHopsOf(tool: string): readonly ChainEdge[] {
  return CHAIN_EDGES.filter((e) => e.evidence === 'verified' && e.from === tool && e.to !== ANY_TOOL);
}

/** 本工具**适用**的通配边（= 全称规则）。★ 只用于"提一次"，**不展开**。 */
export function universalHopsOf(): readonly ChainEdge[] {
  return CHAIN_EDGES.filter((e) => e.evidence === 'verified' && e.from === ANY_TOOL);
}

/**
 * 渲染"下一棒"（给 `invokeTool` 的**回执通道**用）。
 *
 * ★★ **不进产物**：它既不是契约（下游不会用它重算）、也不是剪贴板 —— 它是**提示**。
 *   塞进产物会同时干两件坏事：在契约里掺提示 + 让所有不接链的调用一起变胖。
 * ★ 无出边 ⇒ 返回**空串**（完全不注入）—— 今天 61 个工具里只有 3 个有出边。
 * ★★ **按边列全、不合并**（用户裁定：先不收敛）：同一下游有两条边就列两行。
 */
export function renderNextHops(tool: string): string {
  const edges = nextHopsOf(tool);
  if (edges.length === 0) return '';
  const lines = edges.map((e) => {
    const card = e.cardinality === 'single' ? '直接取' : '**下标由你给**';
    return `    ${chainExprOf(e).padEnd(26)} → ${e.to} · ${e.toPath}　（${card}）`;
  });
  return (
    '\n── 下一棒（★ **提示**，不是链的接口：本工具**全部**已验证出边，先全给、不收敛）──\n' +
    lines.join('\n') +
    '\n    ★ 想接才用；不接就直接结束。' +
    '\n    ★ 另有**全称规则**（**提一次、不展开**，展开就是"每个工具都能接每个工具"= 零信息量）：\n' +
    universalHopsOf()
      .map((e) => `      ${chainExprOf(e)} → 任何 [B] · ${e.toPath}`)
      .join('\n')
  );
}

/** 渲染**派生的**候选链（区别于 `CHAINS` 里手写、带真跑结论的那两条）。 */
export function renderDerivedChains(): string {
  const chains = deriveObjectChains();
  const body = chains.length
    ? chains.map((c) => `    ${c.join(' → ')}`).join('\n')
    : '    （**空**：已验证的对象边还连不成链）';
  return (
    '\n\n── 可派生链（★ 从**已验证对象边**枚举；**候选**，没真跑过）──\n' +
    body +
    '\n  ★ 判据：只连**两端都具体**的对象边（**排除通配边** ⇒ 否则恒真、且枚举爆炸）。'
  );
}

/** 渲染成人读列表（给 `capability_map` 用）—— ★ 给"谁读得到"，也给"**怎么写出来**"。 */
export function renderChainWiring(max = 20): string {
  const line = (e: ChainEdge): string => {
    const arrow = chainExprOf(e);
    const card = e.cardinality === 'single' ? '单元素·直接取' : '多元素·下标由你给';
    // ★ 宽度按**最长那串表达式**留：`touched.written_files[i]` = 24 字符 + 2 空格（否则 `[i]` 会挤到箭头上）
    return `    ${e.from.padEnd(17)} ──${arrow.padEnd(26)}──▶ ${e.to} · ${e.toPath.padEnd(22)} （${card}）`;
  };
  const verified = CHAIN_EDGES.slice(0, max).map(line).join('\n');
  const pending = CHAIN_EDGES_PENDING.slice(0, max).map(line).join('\n');
  return (
    '\n\n── 链的接法（上一步的产物 → 下一步的入参）──\n' +
    '  ★ 已实测（可直接用；touched 是**产物端**统一过的那张契约）：\n' + verified + '\n' +
    (pending.length > 0
      ? '  ⏳ 待验（文档写了链，但**一条都没真跑过** —— 用之前先自己核）：\n' + pending + '\n'
      : '  ⏳ 待验：**空**（§5 那条链的每一环都已真跑过；★ 第 2 条链 `import_project → extract_contracts → find_references` 已于 2026-10-06 **真跑 ⇒ 接不上**（环C 缺 `file`），记录见本文件 `CHAIN_EDGES_PENDING`；新验出来的边加进本表）。\n') +
    '  ★ 用法：把左边那串表达式**原样**填进右边的入参位置（它就是"上一次的产物"的地址）；\n' +
    '    标"单元素"的**直接取**即确定；标"多元素"的**下标由你给**（`[i]` 就是"从列表里选一个" ——\n' +
    '    选择是语义判断 ⇒ **永远由调用方给**；本表只负责给它一个统一的名字）。' +
    renderChains(max) +
    renderDerivedChains()
  );
}
