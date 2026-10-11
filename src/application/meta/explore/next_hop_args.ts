/**
 * next_hop_args —— **生成"下一棒入参"**：把上一步的 `touched` **组装成**下一步**可跑的入参 JSON**。
 *
 * ## 它答什么问题（两组独立验收共同指出的缺口）
 * D 组与 E 组的原话：
 * > *"CLI 无管道 ⇒ 「链」是【文档约定】不是可执行的 pipe，每一步都得人肉抄字段。"*
 * G 组更具体：`find_references.touched = {file, symbols[]}` → `rename_symbols` 要
 * `renames:[{file,symbol,to}]` ⇒ **"得自己把两字段拼成对象 + 另给新名 `to`"** ⇒
 * ★「这步没有名字也没有工具」。
 *
 * 用户的定位（本工具存在的全部理由）：
 * > *"不是全自动，而是能直接把**备好**……就像厨师把**备好的菜**直接递给厨师，
 * >  而不是让厨师自己去菜篮子里到处翻。"*
 * ⇒ 本工具 = 把"人肉抄字段"那一步，变成**有名字的一步**：**能填的替它填好**，
 *   只把**真正只能由人给的"意图位"**（如新名 `to`）**显式留空并标注**。
 *
 * ## ★★★ 三条硬语义（本工具的全部难点）
 * 1. **能填的必须填**：按 `fromKey` 从 `touched` 取值、按 `toPath` 落位（`cardinality` 定要不要下标）
 *    ⇒ 调用方**只需补"意图位"**就能直接跑。
 * 2. **意图位显式留空并标注**：下游**必填**里**没有任何出边覆盖**的那一格 = **意图位**
 *    ⇒ 填一个**显眼的占位串**（如 `<你给：renames[].to（新符号名）>`）——
 *    ★ **绝不编造**（不猜新名、不用空串冒充）、★ **也绝不静默省略**（省略会让你以为不用给）。
 * 3. **不猜前提**：`note` 里写明的接续前提（如"`mode=field` 下 `file` **整项省略**"）——
 *    拿不到就是拿不到 ⇒ 该格是一个**明确态**（`unresolved` + 理由），**不假设它总有、也不静默跳过**。
 *
 * ## ★★ 数据源（每一块都**取自已有的权威**，判据复用 —— 只端，不新做）
 * | 块 | 权威（数据源） | 怎么取 |
 * |---|---|---|
 * | 下一棒是谁 / 取值表达式 | **`nextHopsOf` / `universalHopsOf`**（`domain/chain_wiring.ts`） | 唯一权威；**不新增边表** |
 * | 取哪个 touched 键 → 填哪个入参位置 | **`CHAIN_EDGES` 的 `fromKey` / `toPath`** | 落位**用 `toPath`**（别自己拼路径）；形状由 `cardinality` 定 |
 * | 值怎么取（含 `pick` 不替人选） | **`applyChainEdge`**（同文件） | 不重写一遍取值/判错逻辑 |
 * | 标签 | **`evidenceLabel`**（同文件） | `[ran]` 只在那一处生成 |
 * | 下游**必填的深层路径** | **`collectInputPaths`**（`registry/capability_map.ts`） | 从 `ToolDef.inputSchema` 派生（与 `collectInputKeys` 同一套遍历口径） |
 * | 意图位的"是什么意思"提示 | **zod `.describe` 原样** | 用**下游自己**的说明，本工具**不编** |
 *
 * ## ★ 形态判据
 * · **要不要下标**：由 `cardinality` 定（唯一权威；`single` 直接取、`pick` 下标由你给）——
 *   本工具**复用** `applyChainEdge`，**不自己判**。
 * · **落位到哪儿**：由 `toPath` 定（`renames[].file` 就是 `renames[0].file`）——
 *   本工具**解析** `toPath`，**不发明**新路径。
 * · **还差哪些必填**：由 `collectInputPaths` 的**必填叶子**减去"被出边覆盖的"得出。
 *
 * ## 只读
 * 本工具**只读**（不改任何文件），也**不代表"这条链跑通过"** —— 那是 `CHAINS[].note` 说的。
 */
import { CHAIN_EDGES, applyChainEdge, chainExprOf, evidenceLabel, nextHopsOf, universalHopsOf, ANY_TOOL, type ChainEdge } from '../../../domain/chain_wiring.js';
import { collectInputPaths, requiredLeavesOf, type InputPath } from '../registry/capability_map.js';
import type { ToolDef } from '../../types.js';

/** 某一格的**明确态**（照 `contract_page` 的 `resolution` / `consistency_check` 的三态口径：查不到是一个态，不是空）。 */
export type SlotState =
  /** 已由出边填好（值取自 `touched`，位置由 `toPath` 定） */
  | 'filled'
  /** 意图位：下游**必填**、但**没有任何出边**喂它 ⇒ **只能由你给**（显式留空并标注） */
  | 'intent'
  /** 有出边、但上游这次**没产出那个键** ⇒ **拿不到**（明确态 + 理由），**不假设它总有** */
  | 'unresolved'
  /** 出边是 `pick`（多元素）⇒ **要你给下标**（本工具不替你在候选里选） */
  | 'pick';

/** 一个下游入参位置（= `CHAIN_EDGES.toPath` 形态）的处置结果。 */
export interface PreparedSlot {
  /** 下游入参位置（点路径，`[]` = 数组元素内）—— ★ 与 `CHAIN_EDGES.toPath` **同形**。 */
  path: string;
  state: SlotState;
  /** `filled` 时的值（其余态为占位串，见 {@link PreparedHop.args}）。 */
  value?: unknown;
  /** `filled` 时的**取值表达式**（`touched.<键>` / `touched.<键>[i]`，由 `chainExprOf` 单点生成）。 */
  expr?: string;
  /** 这条边从上游 `touched` 的哪个键取（`CHAIN_EDGES.fromKey`）。 */
  from_key?: string;
  /** 该边声明的**来源工具**（`CHAIN_EDGES.from`）。★ 与 `from_tool` 不同 ⇒ 是"同接力键"的**补位边**（见 `note`）。 */
  edge_from?: string;
  /** 边标签（`evidenceLabel`）：`ran` = 当年真跑过、非实时验证。 */
  evidence?: string;
  /** `pick` 时的候选清单（**全列**，不给默认值）。 */
  candidates?: readonly string[];
  /** 人话说明（意图位 = 下游自己的 `.describe`）；容器/全称规则/补位边的注明也在此。 */
  note: string;
}

/** 一个可接的下一棒 + 它**备好的入参**。 */
export interface PreparedHop {
  to_tool: string;
  /**
   * ★★★ **可跑的下一棒入参模板** —— 能填的**已填好**（值 + 位置）；
   * **意图位 / 拿不到 / 要选**的位置是**显眼的占位串**（`<你给：…>` / `<拿不到：…>` / `<你选：…>`），
   * ★ **不是空串、不是编的值** —— 你把它们替换掉即可直接调 `to_tool`。
   */
  args: Record<string, unknown>;
  slots: PreparedSlot[];
  /** 该跳的诚实边界（如"某边被下游声明拒绝 ⇒ 未塞"）。★ 用**已登记**的 `limitations`（见 `b_terms`）。 */
  limitations: string[];
}

export type NextHopResolution =
  /** 产出了 ≥1 个可接的下一棒 */
  | 'ok'
  /** 上游工具在接法表里**没有对象类出边**（通常是"链的终点"）；作用域键仍可接 */
  | 'no-object-hops'
  /** 指定了 `to_tool`，但**上游没有任何已验证边通到它**（明确态 + 可用目标清单） */
  | 'no-edge-to-target'
  /** 指定了 `to_tool`：无**对象类**边，但它收**作用域键** ⇒ 只能接"无对象交接"的半棒 */
  | 'scope-only';

export interface NextHopArgsResult {
  /** 上游工具名（给了才有）。 */
  from_tool?: string;
  /** 本次 `touched` 里**有哪些键**（如实回显，便于判"某某键这次没产出"）。 */
  touched_keys: string[];
  /** ★ 明确态（照本仓三态口径）：查不到 / 没有可接的，都是一个**态**，不是空。 */
  resolution: NextHopResolution;
  resolution_note: string;
  /** 每个可接的下一棒（`to_tool` 给了就只一个）。 */
  hops: PreparedHop[];
  /** 诚实边界（取不到 / 被拒 / 未做 —— 不许留白）。★ 用**已登记**的 `limitations`（见 `b_terms`）。 */
  limitations: string[];
}

/** `next_hop_args` 的入参。 */
export interface NextHopArgsInput {
  /**
   * 上一步的工具名（= 接法表里那条边的 `from`）。
   * ★ **接法表以 `from` 为键** ⇒ 不给它就只能按 `touched` 的**接力键**匹配（来源不指定）。
   */
  from_tool?: string;
  /** 可选：只算通到这一个下游的接续；不给 = 列出**所有可接的**下一棒。 */
  to_tool?: string;
  /** ★ 计算要用的注册表目录（惰性取，避免与聚合器成环）。 */
  defs: readonly ToolDef[];
}

/** 意图位占位串的提示语（取下游自己 `.describe` 的**领头短语**；不编）。 */
function shortHint(desc: string): string {
  if (!desc) return '';
  const cut = desc.search(/[（(；;。：:]/);
  const s = (cut > 0 ? desc.slice(0, cut) : desc).trim();
  return s.length > 28 ? s.slice(0, 28) + '…' : s;
}
const intentMarker = (path: string, desc: string): string => {
  const h = shortHint(desc);
  return `<你给：${path}${h ? `（${h}）` : ''}>`;
};
const unresolvedMarker = (path: string, reason: string): string => `<拿不到：${path} — ${reason}>`;
const pickMarker = (path: string, candidates: readonly string[]): string =>
  `<你选：${path} 候选 ${candidates.map((c, i) => `[${i}] ${c}`).join(' ')}>`;

/**
 * 把值**落位**到 `toPath` 上（`renames[].file` ⇒ `renames[0].file`）。
 * ★ 同一段路径多次落位**复用同一容器**（`renames[].file` / `renames[].symbol` / `renames[].to`
 *   落进**同一个** `renames[0]` 对象，而不是三个各带一个键的数组元素）。
 */
function assignPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.').map((s) => ({ name: s.replace(/\[\]$/, ''), array: s.endsWith('[]') }));
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < segs.length; i++) {
    const { name, array } = segs[i]!;
    if (i === segs.length - 1) {
      cur[name] = value;
      return;
    }
    if (array) {
      const slot = cur[name];
      if (!Array.isArray(slot)) cur[name] = [];
      const arr = cur[name] as unknown[];
      if (arr.length === 0) arr.push({});
      cur = arr[0] as Record<string, unknown>;
    } else {
      const slot = cur[name];
      if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) cur[name] = {};
      cur = cur[name] as Record<string, unknown>;
    }
  }
}

/** 一格边用 `applyChainEdge` 取值的**明确结果**（复用它，不自己判 `single`/`pick`）。 */
type EdgeOutcome =
  | { ok: true; value: string }
  | { ok: false; reason: string; candidates: readonly string[] };

/**
 * 计算某个下游的**入参模板**。
 *
 * @param to 下游工具名
 * @param edges 该下游的边（**本工具直接出边在前**，同接力键的补位边在后；含全称作用域边）
 * @param touchedObj 上游 `touched`（★ 形参名刻意**不叫** `touched`：`find_references` 的 mode=field 会把裸 `touched`
 *   标识符误判成"构造点" ⇒ 用它会给 `contract_page('Touched')` 的产者面增噪）
 * @param paths 下游的深层入参路径表（`collectInputPaths`）
 * @param fromTool 上游工具名（仅用于**标注**"某格是补位边填的"；`undefined` = 未指定来源）
 */
function buildHop(
  to: string,
  edges: readonly ChainEdge[],
  touchedObj: Record<string, unknown>,
  paths: readonly InputPath[],
  fromTool: string | undefined,
): PreparedHop {
  const slots: PreparedSlot[] = [];
  const limitations: string[] = [];
  const accepted = new Map<string, InputPath>(paths.map((p) => [p.path, p]));
  const covered = new Set<string>();
  // ★ 同一入参位置可能有多条边（不同 `fromKey` / 不同 `from`）⇒ **先到者定**（调用方已把直接出边排在前）。
  const seenPath = new Set<string>();

  // ── 逐边取值 + 落位（★ 直接出边在前、补位边在后、全称边最后）──
  for (const e of edges) {
    if (seenPath.has(e.toPath)) continue;
    // ★ 下游**声明**里没有这个位置 ⇒ **不塞**（例：`feature` 全称边落到一个不按 feature 工作的工具上）。
    //   宁可少塞、并如实记一条 caveat —— 不把"表里有这条边"当成"下游一定收"。
    if (!accepted.has(e.toPath)) {
      seenPath.add(e.toPath);
      limitations.push(
        `边 \`${chainExprOf(e)}\` → \`${to}.${e.toPath}\` **未塞**：下游声明里没有这个入参位置（别硬塞）。`,
      );
      continue;
    }
    seenPath.add(e.toPath);
    // ★ "补位边"：来自**别的**上游工具、但 `fromKey` 恰好在本轮 `touched` 里 ——
    //   按本仓「接力键」纪律（**同名 = 同义**，`from` 记的是"在谁身上验的"、`fromKey` 才承载语义）
    //   用来补本工具直接出边没覆盖到的**必填位置**（如 `find_references` 的 `symbols` 补 `renames[].symbol`）。
    const isCrossSource = fromTool !== undefined && e.from !== fromTool && e.from !== ANY_TOOL;
    const crossNote = isCrossSource
      ? `　★ 该边来自 \`${e.from}\`（同**接力键** \`${e.fromKey}\` 的已验证映射，非本工具直接出边）`
      : '';
    const r: EdgeOutcome = applyChainEdge(touchedObj, e);
    if (r.ok) {
      slots.push({
        path: e.toPath,
        state: 'filled',
        value: r.value,
        expr: chainExprOf(e),
        from_key: e.fromKey,
        edge_from: e.from,
        evidence: evidenceLabel(e.evidence),
        note: `已填：取自 \`${chainExprOf(e)}\`${crossNote}`,
      });
      covered.add(e.toPath);
      continue;
    }
    if (r.candidates.length > 0) {
      slots.push({
        path: e.toPath,
        state: 'pick',
        from_key: e.fromKey,
        edge_from: e.from,
        evidence: evidenceLabel(e.evidence),
        candidates: r.candidates,
        note: r.reason + crossNote,
      });
      covered.add(e.toPath);
      continue;
    }
    // 有边、但上游这次没产出那个键 ⇒ **明确态：拿不到**（不假设它总有、不静默跳过）
    slots.push({
      path: e.toPath,
      state: 'unresolved',
      from_key: e.fromKey,
      edge_from: e.from,
      evidence: evidenceLabel(e.evidence),
      note: r.reason + crossNote,
    });
    covered.add(e.toPath);
  }

  // ── 意图位：下游**必填叶子**里，**没有被任何出边覆盖**的那一格 ──
  for (const leaf of requiredLeavesOf(paths)) {
    if (covered.has(leaf.path)) continue;
    slots.push({
      path: leaf.path,
      state: 'intent',
      note: leaf.description || '下游必填，且没有任何已验证出边喂它 ⇒ 只能由你给',
    });
    covered.add(leaf.path);
  }

  // ── 组装可跑的入参模板 ──
  const args: Record<string, unknown> = {};
  for (const s of slots) {
    if (s.state === 'filled') assignPath(args, s.path, s.value);
    else if (s.state === 'intent') assignPath(args, s.path, intentMarker(s.path, s.note));
    else if (s.state === 'unresolved') assignPath(args, s.path, unresolvedMarker(s.path, s.note));
    else assignPath(args, s.path, pickMarker(s.path, s.candidates ?? []));
  }

  return { to_tool: to, args, slots, limitations };
}

/**
 * 主实现（纯函数）：`touched` + 可选 `from_tool` / `to_tool` ⇒ **备好的下一棒入参**。
 *
 * ★ `from_tool` 给了 ⇒ 目标集合取自 `nextHopsOf(from_tool)`（**权威**：接法表以 `from` 为键）。
 * ★ `from_tool` 没给 ⇒ 目标集合取自**按接力键匹配**的边（`fromKey ∈ touched`）。
 * ★★★ **填值**用的是**两条来源的并**（直接出边在前、接力键补位边在后；同一入参位置先到者定）：
 *   · 直接出边 ⇒ 能判"**有边但上游没产出**"（= `unresolved` **明确态**，如 `mode=field` 下 `file` 整项省略）；
 *   · 接力键补位边 ⇒ 补上"**同键、但边记在别的上游名下**"的必填位置
 *     （实证：`find_references.touched.symbols` → `rename_symbols.renames[].symbol` 的映射**记在
 *      `move_symbol` 那条边上**，而 `find_references → rename_symbols` 只有 `file` 一条边 —— 见 `CHAIN_EDGES` 里
 *      那条边的 `note`：*"`touched.symbols[0]` → `renames[].symbol` 同理"*，但**没有独立一行**）。
 *   ★ 本工具**不增改 `CHAIN_EDGES`**（那是"现有工具的判据"、不在本任务边界内）：改用**已有边 + 接力键**组装。
 */
export function nextHopArgs(
  touchedObj: Record<string, unknown>,
  input: NextHopArgsInput,
): NextHopArgsResult {
  const { from_tool, to_tool, defs } = input;
  const limitations: string[] = [];
  const touchedKeys = Object.keys(touchedObj);
  const pathsOf = (name: string): readonly InputPath[] => {
    const d = defs.find((t) => t.name === name);
    return d ? collectInputPaths(d.inputSchema) : [];
  };

  // ── 边 ──
  // ★ 两条来源：
  //   ① **本工具的直接出边** = `nextHopsOf(from_tool)`（给了 `from_tool` 时）—— **权威**（接法表以 `from` 为键）；
  //   ② **接力键补位边** = 所有"`fromKey` 恰好在你 `touched` 里"的已验证对象边 ——
  //      用于**补**直接出边没覆盖到的必填位置（★ 见 `buildHop` 的 `crossNote`；本仓「接力键」纪律：同名 = 同义）。
  const directEdges: readonly ChainEdge[] = from_tool ? nextHopsOf(from_tool) : [];
  const keyEdges = candidateEdgesForKeys(touchedKeys);
  if (from_tool === undefined && keyEdges.length > 0) {
    limitations.push(
      '未给 `from_tool` ⇒ 不限定来源，按**接力键**（`fromKey ∈ touched`）匹配候选边。' +
        '★ 接法表**以 `from` 为键**，指定 `from_tool` 才能得到"**只属于它**"的权威出边；不给则可能列出**别的上游**同样会产这些键的边。',
    );
  }

  // 全称作用域边（`project_dir` / `feature`：任何 [B] 之间直通，提一次、不按工具展开）
  const universals = universalHopsOf();

  // 全称规则提一次（不按工具展开 —— 展开成 N 行 = 把 1 条规则伪装成 N 条候选，信息量为零）。
  // ★ 摆在**所有 return 之前**：这样连"没有对象类下一棒"的回执也带着它（否则回执说"见 limitations"而 limitations 是空的）。
  limitations.push(
    '★ 全称规则（对**任何** [B] 都成立，只提一次、不展开）：`touched.project_dir → project_dir`、' +
      '`touched.feature → feature` —— ★ 只有**按 feature 工作**的工具该收 `feature`（全项目工具不需要，本工具已按下游声明**过滤**，不收的不硬塞）。',
  );

  // ── 目标清单 ──（给了 `from_tool` 用它能到的那几个；否则用接力键能到的）
  const targetSource = from_tool ? directEdges : keyEdges;
  const concreteTargets = [...new Set(targetSource.filter((e) => e.to !== ANY_TOOL).map((e) => e.to))];
  const targets = to_tool ? [to_tool] : concreteTargets;

  if (to_tool && !concreteTargets.includes(to_tool)) {
    // ★ 无**对象类**边通到它 —— 但它若**收作用域键**（`project_dir`），仍可接一棒（只是"无对象交接"）。
    //   ★ 明确态：`scope-only`（不是"没得接"，也不是"有对象交接"）。
    const scopePaths = universals.filter((e) => pathsOf(to_tool).some((p) => p.path === e.toPath));
    const scopeArgs = scopePaths
      .map((e) => ({ e, r: applyChainEdge(touchedObj, e) }))
      .filter(({ r }) => r.ok);
    if (scopePaths.length > 0 && scopeArgs.length > 0) {
      const hop = buildHop(to_tool, [...universals], touchedObj, pathsOf(to_tool), from_tool);
      return {
        ...(from_tool ? { from_tool } : {}),
        touched_keys: touchedKeys,
        resolution: 'scope-only',
        resolution_note:
          `**没有**对象类边从${from_tool ? ` \`${from_tool}\`` : '你手上的 touched'}通到 \`${to_tool}\`；` +
          `但它收**作用域键**（已给：${scopeArgs.map(({ e }) => `\`${chainExprOf(e)}\``).join('、')}）⇒ 只能接这一棒"**无对象交接**"的半棒。`,
        hops: [hop],
        limitations,
      };
    }
    const avail = concreteTargets.length ? concreteTargets.join(', ') : '（无）';
    return {
      ...(from_tool ? { from_tool } : {}),
      touched_keys: touchedKeys,
      resolution: 'no-edge-to-target',
      resolution_note:
        `**没有**从${from_tool ? ` \`${from_tool}\`` : '你手上的 touched'}通到 \`${to_tool}\` 的已验证边（明确态）。` +
        `可用的对象类下一棒：${avail}。`,
      hops: [],
      limitations,
    };
  }

  if (!to_tool && concreteTargets.length === 0) {
    return {
      ...(from_tool ? { from_tool } : {}),
      touched_keys: touchedKeys,
      resolution: 'no-object-hops',
      resolution_note:
        (from_tool
          ? `\`${from_tool}\` 在接法表里**没有对象类出边**（通常是"链的终点"）。`
          : '你手上的 `touched` 里**没有**任何已验证对象边的 `fromKey`。') +
        '★ 作用域键（`project_dir` / `feature`）仍可接**任何** [B]（全称规则，见 limitations）。',
      hops: [],
      limitations,
    };
  }

  // ── 逐目标构建：**直接出边在前，接力键补位边在后**（同位置先到者定）──
  const hops = targets.map((to) => {
    const direct = directEdges.filter((e) => e.to === to);
    const keyed = keyEdges.filter((e) => e.to === to);
    // 只把**下游真收**的边并进来（`buildHop` 会逐边按 `accepted` 过滤）。
    return buildHop(to, [...direct, ...keyed, ...universals], touchedObj, pathsOf(to), from_tool);
  });

  return {
    ...(from_tool ? { from_tool } : {}),
    touched_keys: touchedKeys,
    resolution: 'ok',
    resolution_note:
      `备好 **${hops.length}** 个下一棒的入参：` +
      hops
        .map((h) => {
          const filled = h.slots.filter((s) => s.state === 'filled').length;
          const need = h.slots.filter((s) => s.state === 'intent').length;
          const miss = h.slots.filter((s) => s.state === 'unresolved' || s.state === 'pick').length;
          return `${h.to_tool}（已填 ${filled}，**意图位 ${need}**${miss ? `，待定 ${miss}` : ''}）`;
        })
        .join(' · '),
    hops,
    limitations,
  };
}

/**
 * `from_tool` 未给时的候选边：所有**两端都具体**、且 `fromKey` **就在 `touched` 里**的已验证对象边。
 * ★ 直接读 `CHAIN_EDGES`（**唯一权威**），过滤口径与 `nextHopsOf` 的"两端都具体 + 已验证"**同款**
 *   （`nextHopsOf` 只差一个 `e.from === tool`），**不新增边表**；
 *   `ANY_TOOL` 通配边由 `universalHopsOf` 单独处理。
 */
function candidateEdgesForKeys(touchedKeys: readonly string[]): readonly ChainEdge[] {
  const keys = new Set(touchedKeys);
  return CHAIN_EDGES.filter(
    (e) => e.evidence === 'verified' && e.from !== ANY_TOOL && e.to !== ANY_TOOL && keys.has(e.fromKey),
  );
}

/**
 * 渲染人读回执。
 * ★ **查不到 / 没有可接的**都是一个**态** —— 明确写出，不留白。
 * ★ 逐格标注来源：`已填` / `意图位（要你给）` / `拿不到` / `要你选下标`。
 */
export function renderNextHopArgs(r: NextHopArgsResult): string {
  const L: string[] = [];
  L.push(`下一棒入参：${r.from_tool ? `\`${r.from_tool}\`` : '（未指定来源）'} 的 touched ⇒ [${r.resolution}]`);
  L.push(`  ${r.resolution_note}`);
  L.push(`  touched 里的键：${r.touched_keys.length ? r.touched_keys.join(', ') : '（空）'}`);

  for (const h of r.hops) {
    L.push('');
    L.push(`▷ 下一棒：\`${h.to_tool}\` —— **备好的入参**（能填的已填；\`<…>\` 是占位，替换后即可直接跑）：`);
    L.push('    ' + JSON.stringify(h.args, null, 2).split('\n').join('\n    '));
    L.push('    ★ 逐格来源：');
    for (const s of h.slots) {
      const tag =
        s.state === 'filled'
          ? `✔ 已填  ← ${s.expr}${s.evidence ? ` [${s.evidence}]` : ''}`
          : s.state === 'intent'
            ? '★ 意图位 —— **要你给**（本工具不猜、不编、不省略）'
            : s.state === 'pick'
              ? `★ 要你选下标（候选：${(s.candidates ?? []).map((c, i) => `[${i}] ${c}`).join(' ')}）`
              : '✗ 拿不到（明确态）';
      L.push(`        ${s.path.padEnd(28)} ${tag}　${s.state === 'filled' ? '' : s.note}`.trimEnd());
    }
    if (h.limitations.length) for (const c of h.limitations) L.push(`    · ${c}`);
  }

  if (r.limitations.length) L.push('', '★ 诚实边界：\n   - ' + r.limitations.join('\n   - '));
  L.push('');
  L.push('  ★★ 本工具的**分工**：它只负责**位置与对象**（把上一步的值放到下一步的入参位置）；');
  L.push('     "**要做什么操作 / 改成什么名 / 移到哪**"是**意图**，只能由你给 —— ★ 所以 `to` 这类格子**故意留空并标注**。');
  L.push('  ★ **只读**：不改任何东西，也**不代表"这条链跑通过"**（那是 `CHAINS[].note` 说的）。');
  return L.join('\n');
}
