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
export function chainExprOf(e: ChainEdge): string {
  return e.cardinality === 'single' ? `touched.${e.fromKey}` : `touched.${e.fromKey}[i]`;
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
export interface HopVerdict {
  hop: number;
  from: string;
  to: string;
  /** ★ 该段**除作用域外**的已验证边（= "下游要的对象"有没有人喂）。**这才是链的判据。** */
  objectEdges: readonly ChainEdge[];
}

/** 逐段判定。 */
export function hopsOf(chain: Chain): readonly HopVerdict[] {
  const out: HopVerdict[] = [];
  for (let i = 0; i + 1 < chain.steps.length; i++) {
    const from = chain.steps[i];
    const to = chain.steps[i + 1];
    out.push({
      hop: i + 1,
      from,
      to,
      objectEdges: verifiedEdgesBetween(from, to).filter((e) => !SCOPE_PATHS.has(e.toPath)),
    });
  }
  return out;
}

/**
 * 链上**第一处"一个对象类边都没有"**的段；全都有则 `null`。
 * ★ **这是信号，不是判决**：末段（如 `run_tests`）**本来就不要对象入参** ⇒ 它报 0 未必是断
 *   （`refactor` 链的第 3 段就是这种）⇒ 要定论必须知道下游的入参形状（`ToolDef`，下一步）。
 */
export function objectGapOf(chain: Chain): HopVerdict | null {
  return hopsOf(chain).find((h) => h.objectEdges.length === 0) ?? null;
}

/** 渲染链表（给 `capability_map` 用）。 */
export function renderChains(max = 20): string {
  const lines = CHAINS.slice(0, max).map((c) => {
    const hops = hopsOf(c)
      .map((h) => `${h.from}→${h.to}: ${h.objectEdges.length}`)
      .join(' · ');
    const gap = objectGapOf(c);
    const status = gap
      ? `⚠ 第 ${gap.hop} 段**无对象类边**（${gap.from} → ${gap.to}）`
      : '✓ 每段都有对象类边';
    return `    ${c.name.padEnd(14)} [${c.evidence}] ${c.steps.join(' → ')}\n${' '.repeat(19)}${status}｜对象类边数 ${hops}`;
  });
  return (
    '\n\n── 链（★ 一等公民：逐段查 `CHAIN_EDGES` 的**对象类**边；作用域边恒有 ⇒ 不进判定）──\n' +
    lines.join('\n') +
    '\n  ★ 本判定**只查表**，且**只报事实**（对象类边几条，不是"通/断"）：' +
    '\n    "下游到底要不要对象类入参"需要 `ToolDef`（`application` 层）⇒ 那是下一步。' +
    '\n  ★★ 通没通，**只看 `[verified]`** —— 那是整条链的真跑结论，权威在 `CHAINS[].note`。'
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
 * ★ 只取**两端都具体**的边：**排除通配边**（`ANY_TOOL`）——
 *   它们说的是"任何工具都能接"，对**具体某个**工具就是噪音（每条都要列 61 个下游），
 *   而且它们本来就已经写在接法表里当**背景规则**了。
 * ★ 用途（2026-10-06，用户裁定「**先不收敛，所有有可能的下一棒都给它**」）：
 *   在**回执通道**里告诉调用方"从这一步能接哪几棒、用什么表达式"。
 */
export function nextHopsOf(tool: string): readonly ChainEdge[] {
  return CHAIN_EDGES.filter((e) => e.evidence === 'verified' && e.from === tool && e.to !== ANY_TOOL);
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
    '\n    ★ 想接才用；不接就直接结束。'
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
