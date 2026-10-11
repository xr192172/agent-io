/**
 * first_hop_args —— **起手入参**：把"知道该用哪个工具"到"把第一棒的入参凑齐"之间那一步，
 * 变成**有名字的一步**。它是 `next_hop_args`（下一棒入参）的**同族**：一个管"下一棒"、一个管"第一棒"。
 *
 * ## 它答什么问题（一次真实走查「同型任务第二次」实测出的头号缺口，逐字）
 * > ⚠️ **起手入参**：「**地图只给工具名、【不产入参】** ⇒ `{project_dir, feature, scope, dry_run, renames[]}`
 * >   **全是我手工拆的**；★ **地图也没提要先 `import_project` 建档**」
 * ⇒ 本工具把这两件事**一次给全**：
 *   ① **第一棒的可跑入参 JSON**（能填的填好、意图位显式留空并标注）；
 *   ② **"起手之前还有一步"**（若该链需要先建档 ⇒ 明说 —— 别让调用方踩到"缺少必需参数 feature"才发现）。
 *
 * ## ★★★ 与 `next_hop_args` 同族（照它抄口径，**不另创一套**）
 * 「意图位」的语义、占位串风格、逐格来源**全部复用** `next_hop_args` 的同一批函数/类型 ——
 * `assignPath` / `intentMarker` / `PreparedSlot` / `SlotState`。★ 本仓头号病是"同一件事住两处" ⇒
 * 本工具**不重写**这套语义，只**换个起点**调用它：
 *   · `next_hop_args` 的起点是"**上一步的 `touched`**"（有上游产物可搬）；
 *   · 本工具的起点是"**你还没跑任何一步**" —— 此时**没有 `touched`** ⇒ "能填的"只有你给的 `project_dir`，
 *     其余**下游必填**（`declaredRequiredMembersOf` 那两路并）一律是**意图位**。
 *
 * ## ★★ 数据源（每一块都取自**已有的权威** —— 只端，不新做）
 * | 块 | 权威（数据源） | 怎么取 |
 * |---|---|---|
 * | 链名 / 链全貌（`steps`） | **`CHAINS`**（`domain/chain_wiring.ts`） | 唯一权威；本工具**不新建链表** |
 * | 每段交接强度 | **`hopsOf`**（同文件） | **复用现成读数**（`strong` / `scope-only` 两档），本工具**不重算** |
 * | 链的标签与真跑结论 | **`evidenceLabel`** + `CHAINS[].note` | `[ran]`（当年跑过）只在那一处生成 |
 * | 第一棒是谁 | `CHAINS[].steps[0]` | 链的第一段 |
 * | 第一棒入参位置表 | **`collectInputPaths`** + **`declaredRequiredMembersOf`**（`registry/capability_map.ts`） | 与 `next_hop_args` **同一套**遍历/必填口径（必填 = schema 必填 ∪ 下游 `.describe` 里写「必填」） |
 * | 意图位提示语 | **zod `.describe` 原样**（经 `InputPath.description` → `intentMarker`） | 用**下游自己**的说明，本工具**不编** |
 * | "要不要先建档" | 链上工具的声明入参里**有没有 `feature`** | 判据**派生自链自身**，不新造表 |
 *
 * ## ★ 与 `design-import` 的关系
 * `design-import` 是 `CHAINS` 里**已被真跑证伪**的反例（断在第 2 段）—— 本工具照样列出它，
 * 并**照实带出**它的 `[ran]` 标签与 `note`（★ 跑过 ≠ 通；"现在通不通"看 `note`）。**不粉饰、不隐藏**。
 *
 * ## 只读
 * 本工具**只读**（不改任何文件），也**不代表"这条链跑通过"** —— 那是 `CHAINS[].note` / `[ran]` 标签说的。
 */
import { CHAINS, hopsOf, evidenceLabel, type Chain } from '../../../domain/chain_wiring.js';
import { collectInputPaths, declaredRequiredMembersOf, type InputPath } from '../registry/capability_map.js';
import { assignPath, intentMarker, type PreparedSlot } from './next_hop_args.js';
import type { ToolDef } from '../../types.js';

/** 本工具的三种工作模式（照 `next_hop_args` 的 `resolution` 口径：**查不到是一个态，不是留白**）。 */
export type FirstHopMode = 'chain' | 'tool' | 'list';

/** `FirstHopArgsResult.resolution`：明确态（未知链/未知工具各是一个态，不是空）。 */
export type FirstHopResolution = 'ok' | 'list' | 'unknown-chain' | 'unknown-tool';

/**
 * ★★ **"起手之前还有一步"** 的明确态（本笔实测缺口的落点）。
 * ★ 三态并列、**不猜**：不需要也是一个态（不是留白），需要时必须**说清否则会踩到什么**。
 */
export type PrerequisiteState =
  /** 第一步**就是** `import_project`（建档步本身）—— 起手即建档，无需额外前置 */
  | 'starts-with-intake'
  /** 起手目标**要用 `feature`**，而第一棒**不是**建档步 ⇒ **先 `import_project` 建档** */
  | 'needs-intake'
  /** 起手目标**不收 `feature`** ⇒ **不必**先建档（起手即第一棒） */
  | 'no-intake-needed';

export interface Prerequisite {
  state: PrerequisiteState;
  /** 那条提示（人读）。★ `needs-intake` 时**必须**说清"否则会踩到什么"。 */
  note: string;
}

/** 一段链路的**接手读数**（★ 直接取 `hopsOf` 的两档，本工具**不重算**）。 */
export interface ChainHopReading {
  hop: number;
  from: string;
  to: string;
  /** ★ `strong` = 有对象类边；`scope-only` = **仅靠作用域键**（`project_dir`/`feature`）交接 —— ★ **弱交接 ≠ 断**。 */
  kind: 'strong' | 'scope-only';
  /** 该段的**对象类**已验证边条数。 */
  object_edges: number;
  /** 该段的**作用域**已验证边条数。 */
  scope_edges: number;
}

/** ★★★ **备好的第一棒** —— 形状与 `next_hop_args` 的 `PreparedHop` 同族（只换起点，不换口径）。 */
export interface PreparedStart {
  /** 起手的第一棒工具名（= 链的第一段 / 你给的 `tool`）。 */
  to_tool: string;
  /**
   * ★★★ **可跑的第一棒入参模板** —— 能填的**已填好**（如你给的 `project_dir`）；
   * 意图位是**显眼的占位串**（`<你给：…>`），★ **不是空串、不是编的值** —— 替换后即可直接调 `to_tool`。
   */
  args: Record<string, unknown>;
  /** 逐格来源（★ 与 `next_hop_args` 的 `PreparedSlot` **同形**、同一套 `SlotState`）。 */
  slots: PreparedSlot[];
  /** 该棒的诚实边界（如"未给 `project_dir` ⇒ 按它的缺省"）。 */
  limitations: string[];
}

export interface FirstHopArgsInput {
  /**
   * 链名（`CHAINS[].name`，如 `refactor`）。与 `tool` 二选一；
   * ★ **都不给** ⇒ 列出**所有链 + 各自的起手**。
   */
  chain?: string;
  /** 起点工具名（不在任何链里也行）。与 `chain` 二选一。 */
  tool?: string;
  /** 起手根 —— ★ **能自动填的就填好**（填进第一棒的 `project_dir`）。 */
  project_dir?: string;
  /** ★ 计算要用的注册表目录（惰性取，避免与聚合器成环）。 */
  defs: readonly ToolDef[];
}

export interface FirstHopArgsResult {
  mode: FirstHopMode;
  resolution: FirstHopResolution;
  resolution_note: string;
  /**
   * 给了 `chain` 才有 —— **链名**（回显）。
   * ★ 字段名刻意**不叫** `chain`：`chain` 这个名已被 `feature_line` 的产物占用（那里是**调用链节点列表**，
   *   语义不同）⇒ 同名不同义 = 判据分叉。★ 也不登记进 `B_TERMS`（那会把两个不同语义并成一个词条）。
   */
  chain_name?: string;
  /** ★ 这条链的全貌（`CHAINS[].steps`）。 */
  chain_steps?: readonly string[];
  /** ★ 链的 `[ran]` / `[pending]` 标签（`evidenceLabel`）。 */
  chain_evidence?: string;
  /** ★ 链的真跑结论（`CHAINS[].note`）—— ★ **"通没通"看这里**，不是看 `[ran]`。 */
  chain_note?: string;
  /**
   * ★ 每段交接强度（**复用** `hopsOf` 的现成读数）。
   * ★ 字段名刻意**不叫** `hops`：那个名是 `next_hop_args` 的产物字段（那里是**备好的下一棒**，
   *   与"交接强度读数"语义不同）⇒ 取唯一名，不混进共用词表。
   */
  chain_hops?: ChainHopReading[];
  /** ★ 第一棒（+ 它**备好的入参**）。`mode='chain' | 'tool'` 时才有。 */
  start?: PreparedStart;
  /** ★★ **"起手之前还有一步"** —— 起手目标的建档前置。 */
  prerequisite: Prerequisite;
  /** `mode='list'`：所有链 + 各自的起手。 */
  chains?: Array<{
    name: string;
    evidence: string;
    steps: readonly string[];
    /** ★ 这条链的**起手** = 链的第一段工具名。 */
    first_step: string;
    /** ★ 起手的第一棒**有哪些必填意图位**（`declaredRequiredMembersOf` 的路径）。 */
    first_step_required: string[];
    prerequisite_state: PrerequisiteState;
  }>;
  limitations: string[];
  /** ★ **本工具没能确定的**（不许把推测写成实测）—— 逐条写在这里，不留白。 */
  not_determined: string[];
}

// ─────────────────────────────────────────────────────────────
// 纯函数
// ─────────────────────────────────────────────────────────────

/** 某工具的深层入参路径表（与 `next_hop_args` 同一口径：`collectInputPaths`）。 */
function pathsOfTool(defs: readonly ToolDef[], name: string): readonly InputPath[] {
  const d = defs.find((t) => t.name === name);
  return d ? collectInputPaths(d.inputSchema) : [];
}

/** 该工具的声明入参里**有没有 `feature`**（= 它是不是"按 feature 工作"的 [B]）。 */
function acceptsFeature(paths: readonly InputPath[]): boolean {
  return paths.some((p) => p.path === 'feature');
}

/**
 * ★★ 算"起手之前还有一步"（本笔的核心缺口）。
 *
 * 判据**派生自起手目标自身**（链的 `steps` / 单个工具）—— **不新造表**：
 *   · `steps[0] === 'import_project'` ⇒ **起手就是建档**（`starts-with-intake`）；
 *   · 否则若**起手目标里有工具收 `feature`** ⇒ **需要先建档**（`needs-intake`），
 *     并**明说否则会踩到什么**（"缺少必需参数 feature"）；
 *   · 否则 ⇒ **不必先建档**（`no-intake-needed`）。
 *
 * @param steps 起手目标的步骤（给 `tool` 时 = `[tool]`；给 `chain` 时 = `CHAINS[].steps`）
 * @param defs 注册目录
 * @param scopeLabel 人读的作用对象（"本链" / "该工具"）—— **只影响措辞，不影响判据**
 */
function prerequisiteOf(
  steps: readonly string[],
  defs: readonly ToolDef[],
  scopeLabel: string,
): Prerequisite {
  const first = steps[0];
  const hasFeature = steps.some((s) => acceptsFeature(pathsOfTool(defs, s)));
  if (first === 'import_project') {
    return {
      state: 'starts-with-intake',
      note:
        `${scopeLabel}的起手**就是建档步**（\`import_project\`）—— 起手即建档，**无需额外前置**。` +
        `★ 但它自己**要求 \`feature\`**（新 feature 名，见它自己的 \`.describe\`）：那就是你要给的**起手意图位**。`,
    };
  }
  if (hasFeature) {
    return {
      state: 'needs-intake',
      note:
        `★★ **起手之前还有一步**：${scopeLabel}的工作要用到 \`feature\`，而**第一棒（\`${first}\`）不是建档步** ` +
        `⇒ 先跑 \`import_project {project_dir, feature}\` 建档（` +
        `\`feature\` 在 \`import_project\` 的 schema 里是**必填**）—— ` +
        `★ **否则你会在某一步才踩到「缺少必需参数 feature」**（那时已经绕了几步）。`,
    };
  }
  return {
    state: 'no-intake-needed',
    note:
      `${scopeLabel}**不需要先建档**：起手涉及的工具**都不收** \`feature\` ` +
      `（判据 = 逐个查起手涉及工具的声明入参里有没有 \`feature\`；这是**派生读数**，不是断言）。` +
      `⇒ 起手即第一棒（\`${first}\`）。`,
  };
}

/**
 * ★★★ 组装**第一棒的可跑入参**（本笔的出生证）。
 *
 * 三条与 `next_hop_args` **同一套**的纪律：
 * 1. **能填的必须填**：起手时"能填的"只有你给的 `project_dir`（填进第一棒的 `project_dir`）。
 * 2. **意图位显式留空并标注**：第一棒的**必填槽位**（`declaredRequiredMembersOf` = schema 必填 ∪
 *    下游 `.describe` 里写「必填」）里，**没有任何上游可喂**的每一格 = 意图位 ⇒ 放显眼占位串
 *    （`<你给：…>`，提示语**逐字取下游 `.describe`**）—— ★ **绝不编造、绝不用空串冒充、绝不静默省略**。
 * 3. **不猜前提**：`project_dir` 没给就**不填**，并如实记一条 caveat（不假设它总有）。
 */
function buildStart(
  tool: string,
  projectDir: string | undefined,
  defs: readonly ToolDef[],
): PreparedStart {
  const paths = pathsOfTool(defs, tool);
  const accepted = new Set(paths.map((p) => p.path));
  const covered = new Set<string>();
  const slots: PreparedSlot[] = [];
  const limitations: string[] = [];

  // ── ① 能自动填的填好：project_dir（你给的起手根）—— 仅当第一棒声明里有这个位置 ──
  if (accepted.has('project_dir')) {
    if (projectDir !== undefined) {
      slots.push({
        path: 'project_dir',
        state: 'filled',
        value: projectDir,
        expr: '（起手入参 project_dir）',
        note: `已填：取自本工具的 \`project_dir\` 入参（你给的起手根 \`${projectDir}\`）`,
      });
      covered.add('project_dir');
    } else {
      // ★ 不给就**不猜**（不退回 cwd）：如实记一条，让调用方自己决定
      limitations.push(
        '未给 `project_dir` ⇒ 本棒会按它**自己的缺省**处理（见该工具的 `.describe`）；要显式指定就把它填进起手入参。',
      );
    }
  }

  // ── ② 其余必填 = 意图位（起手时没有任何上游产物可喂 ⇒ 只能由你给）──
  for (const leaf of declaredRequiredMembersOf(paths)) {
    if (covered.has(leaf.path)) continue;
    slots.push({
      path: leaf.path,
      state: 'intent',
      note: leaf.description || '下游必填，且起手时没有任何上游产物可喂它 ⇒ 只能由你给',
    });
    covered.add(leaf.path);
  }

  // ── ③ 组装成**可直接替换后即跑**的一整包 ──
  const args: Record<string, unknown> = {};
  for (const s of slots) {
    if (s.state === 'filled') assignPath(args, s.path, s.value);
    else assignPath(args, s.path, intentMarker(s.path, s.note));
  }

  const intentCount = slots.filter((s) => s.state === 'intent').length;
  if (intentCount === 0) {
    limitations.push(
      '本棒**没有必填的意图位**（`declaredRequiredMembersOf` 为空）⇒ 给了上面那些已填项即可跑；其余入参按它自己的缺省。',
    );
  }
  return { to_tool: tool, args, slots, limitations };
}

/** 一条链的逐段读数（★ 直接读 `hopsOf` 的现成结论）。 */
function hopsOfChain(chain: Chain): ChainHopReading[] {
  return hopsOf(chain).map((h) => ({
    hop: h.hop,
    from: h.from,
    to: h.to,
    kind: h.kind,
    object_edges: h.objectEdges.length,
    scope_edges: h.scopeEdges.length,
  }));
}

/** ★ **本工具没能确定的**（照本仓纪律：没验证的写在这里，不混进结论）。 */
function notDetermined(): string[] {
  return [
    '★ 本工具**不判**"第一棒在给定的 `project_dir` 上现在能不能真跑通"（那要真跑）—— 它只把**入参**与**前置**端出来。',
    '★ "要不要先建档"的判据 = 起手目标里**有没有工具收 `feature`**；它只覆盖 **DSL/feature 侧**的建档缺口，' +
      '**不**判"符号索引是否已建"（后者由各工具**就地冷启**自动建，如 `find_references`）—— 两者是两回事。',
    '★ 本工具**不替你选**链、也不替你给意图位的值（选择与意图是语义判断）—— 照 `applyChainEdge` 在 `pick` 上不替人选的同一条立论。',
  ];
}

/**
 * 主实现（纯函数）：`chain` 或 `tool`（+ 可选 `project_dir`）⇒ **备好的第一棒** + 链全貌 + 建档前置。
 * ★ 都不给 ⇒ **列出所有链 + 各自的起手**（明确态 `list`）。
 */
export function firstHopArgs(input: FirstHopArgsInput): FirstHopArgsResult {
  const { chain, tool, project_dir, defs } = input;
  const limitations: string[] = [];
  const nd = notDetermined();

  // ── 都不给 ⇒ 列出所有链 + 各自的起手 ──
  if (chain === undefined && tool === undefined) {
    return {
      mode: 'list',
      resolution: 'list',
      resolution_note:
        `未给 \`chain\` / \`tool\` ⇒ 列出 **${CHAINS.length}** 条链 + 各自的**起手**（= 链的第一段工具）。` +
        `★ 想看某一条的**备好入参**，把它的 ` +
        `\`chain\` 或第一棒的名字传给本工具（并可给 \`project_dir\` 让它自动填好）。`,
      chains: CHAINS.map((c) => ({
        name: c.name,
        evidence: evidenceLabel(c.evidence),
        steps: c.steps,
        first_step: c.steps[0]!,
        first_step_required: declaredRequiredMembersOf(pathsOfTool(defs, c.steps[0]!)).map((p) => p.path),
        prerequisite_state: prerequisiteOf(c.steps, defs, '本链').state,
      })),
      prerequisite: {
        state: 'no-intake-needed',
        note:
          '（`mode=list` 不针对单一起手 ⇒ 无单点提示。）★ 逐条的建档前置见每项的 `prerequisite_state`：' +
          '`starts-with-intake` = 起手就是建档；`needs-intake` = **要先建档**；`no-intake-needed` = 不必。',
      },
      limitations,
      not_determined: nd,
    };
  }

  // ── 指定了链名 ──
  if (chain !== undefined) {
    const c = CHAINS.find((x) => x.name === chain);
    if (!c) {
      return {
        mode: 'chain',
        resolution: 'unknown-chain',
        resolution_note:
          `**没有名为 \`${chain}\` 的链**（\`CHAINS\` 里只有：${CHAINS.map((x) => x.name).join(', ')}）。` +
          `★ 不给 \`chain\` / \`tool\` 可列出全部链 + 各自的起手。`,
        prerequisite: { state: 'no-intake-needed', note: '（链名未知 ⇒ 无前置可判。）' },
        limitations,
        not_determined: nd,
      };
    }
    const start = buildStart(c.steps[0]!, project_dir, defs);
    return {
      mode: 'chain',
      resolution: 'ok',
      resolution_note:
        `链 \`${c.name}\` 的**起手** = 第一棒 \`${c.steps[0]}\`；` +
        `已备好它的入参（能填的已填，\`<你给：…>\` 是**意图位**占位）。`,
      chain_name: c.name,
      chain_steps: c.steps,
      chain_evidence: evidenceLabel(c.evidence),
      chain_note: c.note,
      chain_hops: hopsOfChain(c),
      start,
      prerequisite: prerequisiteOf(c.steps, defs, '本链'),
      limitations,
      not_determined: nd,
    };
  }

  // ── 指定了起点工具名 ──
  const toolName = tool!;
  if (!defs.some((t) => t.name === toolName)) {
    return {
      mode: 'tool',
      resolution: 'unknown-tool',
      resolution_note: `**注册表里没有名为 \`${toolName}\` 的工具**（可能拼错，或它不在本仓工具面里）。`,
      prerequisite: { state: 'no-intake-needed', note: '（工具名未知 ⇒ 无前置可判。）' },
      limitations,
      not_determined: nd,
    };
  }
  const start = buildStart(toolName, project_dir, defs);
  return {
    mode: 'tool',
    resolution: 'ok',
    resolution_note: `起手工具 \`${toolName}\`；已备好它的入参（能填的已填，\`<你给：…>\` 是**意图位**占位）。`,
    start,
    prerequisite: prerequisiteOf([toolName], defs, '该工具'),
    limitations,
    not_determined: nd,
  };
}

/**
 * 渲染人读回执。
 * ★ 与 `next_hop_args` **同族**：`<…>` 是占位、逐格标注来源、`[ran]` 是**标签**（当年跑过，≠ 通）。
 */
export function renderFirstHopArgs(r: FirstHopArgsResult): string {
  const L: string[] = [];

  // ── list 模式 ──
  if (r.mode === 'list') {
    L.push(`起手：列出所有链 + 各自的起手　[${r.resolution}]`);
    L.push(`  ${r.resolution_note}`);
    L.push('');
    L.push('── 链 ── ' + '（★ `[ran]`=**当年真跑过**，**不是**"现在能通" ⇒ 真跑结论逐链见 `note`）');
    for (const c of r.chains ?? []) {
      const pre =
        c.prerequisite_state === 'starts-with-intake'
          ? '起手即建档'
          : c.prerequisite_state === 'needs-intake'
            ? '★ **要先建档**（import_project）'
            : '不必先建档';
      L.push(`  · ${c.name.padEnd(14)} [${c.evidence}] ${c.steps.join(' → ')}`);
      L.push(
        `      起手 = \`${c.first_step}\`　意图位必填：${c.first_step_required.length ? c.first_step_required.join(', ') : '（无）'}　｜ ${pre}`,
      );
    }
    L.push('', `  ${r.prerequisite.note}`);
    if (r.limitations.length) L.push('', '★ 诚实边界：\n   - ' + r.limitations.join('\n   - '));
    if (r.not_determined.length) L.push('', '★ 本工具**没能确定的**：\n   - ' + r.not_determined.join('\n   - '));
    return L.join('\n');
  }

  // ── chain / tool 模式（错误态）──
  const who = r.chain_name
    ? `链 \`${r.chain_name}\``
    : r.start
      ? `工具 \`${r.start.to_tool}\``
      : r.mode === 'chain'
        ? '链（未知）'
        : '工具（未知）';
  L.push(`起手：${who}　[${r.resolution}]`);
  L.push(`  ${r.resolution_note}`);
  if (r.resolution !== 'ok') {
    if (r.limitations.length) L.push('', '★ 诚实边界：\n   - ' + r.limitations.join('\n   - '));
    if (r.not_determined.length) L.push('', '★ 本工具**没能确定的**：\n   - ' + r.not_determined.join('\n   - '));
    return L.join('\n');
  }

  // ── ① 这条链的全貌 + 每段交接强度 ──
  if (r.chain_steps) {
    L.push('');
    L.push(`① 这条链的全貌（\`${r.chain_name}\`）[${r.chain_evidence}]：${r.chain_steps.join(' → ')}`);
    for (const h of r.chain_hops ?? []) {
      const tag =
        h.kind === 'strong'
          ? `✓ 强交接（有对象类边：${h.object_edges} 条）`
          : `◇ **弱交接**（仅靠作用域键：${h.scope_edges} 条，**弱交接 ≠ 断**）`;
      L.push(`     段 ${h.hop}：${h.from} → ${h.to}　${tag}`);
    }
    L.push(`   ★ 真跑结论（"通没通"看这里，` + '`[ran]` 只是"当年跑过"）：' + (r.chain_note ?? ''));
  }

  // ── ② 起手之前还有一步 ──
  L.push('');
  L.push('② 起手之前还有一步？');
  L.push(`   [${r.prerequisite.state}] ${r.prerequisite.note}`);

  // ── ③ 备好的第一棒入参 ──
  const s = r.start!;
  L.push('');
  L.push(`③ 起手第一棒：\`${s.to_tool}\` —— **备好的入参**（能填的已填；\`<…>\` 是占位，替换后即可直接跑）：`);
  L.push('    ' + JSON.stringify(s.args, null, 2).split('\n').join('\n    '));
  L.push('    ★ 逐格来源：');
  for (const slot of s.slots) {
    const tag =
      slot.state === 'filled'
        ? `✔ 已填  ← ${slot.expr}`
        : slot.state === 'intent'
          ? '★ 意图位 —— **要你给**（本工具不猜、不编、不省略）'
          : slot.state === 'pick'
            ? `★ 要你选下标（候选：${(slot.candidates ?? []).map((c, i) => `[${i}] ${c}`).join(' ')}）`
            : '✗ 拿不到（明确态）';
    L.push(`        ${slot.path.padEnd(28)} ${tag}　${slot.state === 'filled' ? '' : slot.note}`.trimEnd());
  }
  if (s.limitations.length) for (const c of s.limitations) L.push(`    · ${c}`);

  if (r.limitations.length) L.push('', '★ 诚实边界：\n   - ' + r.limitations.join('\n   - '));
  if (r.not_determined.length) L.push('', '★ 本工具**没能确定的**：\n   - ' + r.not_determined.join('\n   - '));
  L.push('');
  L.push('  ★★ 本工具的**分工**：它把"**从知道用哪个工具 → 到把第一棒入参凑齐**"那一步端上来 ——');
  L.push('     **能填的填好**（如 `project_dir`），**意图位**（要改成什么名 / 查哪个符号 …）**只能由你给** ⇒ 故意留空并标注。');
  L.push('  ★ **只读**：不改任何东西，也**不代表"这条链跑通过"**（那是 `CHAINS[].note` / `[ran]` 说的）。');
  return L.join('\n');
}
