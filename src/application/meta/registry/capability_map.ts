/**
 * capability_map —— 能力线导航（目录由工具注册表自动派生，人工只维护「归属标注」）
 *
 * 为什么需要：MCP 工具集扁平广播，客户端不做两级 UI。60 个工具一次性铺给 agent，
 * 选择噪音大、易幻觉选错。与其把全部工具塞进一个 mega 入口（schema 膨胀反噬），
 * 不如给一个**纯只读的能力线地图**：agent 不确定用哪个工具前，先调它分层定位，
 * 再进入具体工具；高频工具仍直接可用、无需先经导航。
 *
 * ★ 单一真相源（2026-09-14 起逐步收紧，2026-09-28 P1c 收口）：
 *   - 工具集合 = server_registry 的 TOOL_DEFS（真实注册，唯一权威）；本模块**不自己维护工具清单**。
 *   - **线的归属** = lane 文件所在（`application/<线名>/index.ts`）→ server_registry 汇总后 `bindLaneOf()` 注入。
 *     本模块**不再持有归属清单**（P1c 前的 `LANE_OF` 是第二份，必然与 lane 文件漂移）。
 *   - `when` 策展文本 = 本文件 `WHEN_OVERRIDES`（**只是文本**，不含归属）；缺省由注册描述
 *     **自动摘要**（首句，≤60 字）⇒ 新增工具把它放进对应 lane 文件即可露面，**不必改本文件**。
 *   - 线元信息 = LANE_META（线 id / 展示名 / 说明 / direct 白名单）。
 *
 * 漂移防护（均为"看得见"而非静默）：
 *   1. 已注册但没归属的工具 → 输出单列「未归线」段，导航仍能看见它（不再静默消失）；
 *   2. 注入表里有、注册表没有 → validateLanes 报「陈旧标注」；
 *      `WHEN_OVERRIDES` 里有、注册表没有 → 报「陈旧策展文本」（工具删了、说明忘删）；
 *   3. tests/registry/lane_sources.test.ts 对**真实 lane 文件**断言：六份来源两两不交、并集 = TOOL_DEFS、
 *      磁盘上 lane 文件名集合 = 归属 id 集合（防"新建了 lane 文件但没人 import"）；
 *   4. tests/tools/capability_map.test.ts 对**真实 TOOL_DEFS** 断言
 *      （旧测试自带一份手抄的 55 工具清单，等于第三份副本，已删）。
 *
 * 装配（两步注入，均在 server_registry 加载期完成）：
 *   · `makeCapabilityMapHandler(() => TOOL_DEFS)` —— 注入**目录**；
 *   · `bindLaneOf(汇总各 lane 文件得出的 name→lane 表)` —— 注入**归属**。
 *   本模块**不 import 注册表**，避免 server_registry ⇄ capability_map 循环 import。
 *   ★ 未注入就调 buildLanes ⇒ **抛错**（见 resolveAssign 的说明：不给"看起来能用"的空表）。
 *
 * 纯数据 + 纯函数（目录取自入参，无 IO）：testable。
 */

import type { ToolDef } from '../../types.js';
import { renderChainWiring, CHAINS, hopsOf, SCOPE_PATHS, type Chain, type HopVerdict } from '../../../domain/chain_wiring.js';
import { B_TERMS } from '../../../domain/b_terms.js';
// ★★ 2026-10-06：工具「面」= 同一个注册表的**视图**（实现方式 = **不注册** + 一个原子入口 `atomic_call`；
//   ★ 注意：不是"裁 listTools" —— 那做不到，理由见 `tool_faces.ts` 模块头的实测更正）。
//   ★ 依赖单向：本模块调它；它只 `import type` 本模块（类型导入被擦除 ⇒ 无运行时环）。
import { renderFaces } from './tool_faces.js';

export const LANE_IDS = ['design', 'refactor', 'observe', 'harvest', 'cross', 'meta'] as const;
export type LaneId = (typeof LANE_IDS)[number];

/** 工具目录项：注册表里能拿到的元信息（只取派生日录需要的字段） */
export interface ToolCatalogEntry {
  name: string;
  title?: string;
  description?: string;
  /**
   * ★★ 该工具**声明入参**里的**全部属性名**（**深层**收集，含数组元素对象里的键）—— 2026-10-06 加。
   * ★ 为什么必须"深层"：`rename_symbols` 的对象入参**不在顶层** —— 它是
   *   `renames: z.array(z.object({ file, symbol, to }))` ⇒ 只看顶层键会得到 `renames`（一个 `context` 词）
   *   ⇒ **判成"下游不要对象"（假阴性）**。★ 与记过的 `touched` 盲区**同一个病：量具只量到顶层**。
   * ★ 由 `application/meta/index.ts` 在注入目录时用 {@link collectInputKeys} 算好（那层拿得到 zod）。
   */
  inputKeys?: readonly string[];
}

export interface LaneTool {
  /** 工具注册名（与 server_registry TOOL_DEFS 一致） */
  name: string;
  /** 何时用它（agent 据此判断该线内的工具选择） */
  when: string;
  /** when 来源：curated=人工撰写 / derived=注册描述自动摘要（待补） */
  whenSource: 'curated' | 'derived';
}

export interface Lane {
  id: LaneId;
  /** 人类可读名（中文，展示用） */
  label: string;
  /** 一句话说明这条线在干什么 */
  desc: string;
  /** 线内工具（由注册表派生；同一工具不跨线复用） */
  tools: LaneTool[];
  /** 高频工具：可绕过 capability_map 直接调用 */
  direct: string[];
}

/**
 * 工具 → 线归属。**由 lane 文件派生后注入**（`bindLaneOf`），不是本文件的数据。
 * when 省略 = 走 `WHEN_OVERRIDES`；再省略 = 由注册描述自动摘要。
 */
export interface LaneAssign {
  lane: LaneId;
  /** 需要人工语义时才写（导航价值高于注册描述时）；一般不必——策展文本请写进 WHEN_OVERRIDES */
  when?: string;
}

/** 线元信息（静态：线 id / 展示名 / 说明 / 直接可用白名单）。 */
export const LANE_META: ReadonlyArray<Omit<Lane, 'tools'>> = [
  {
    id: 'design',
    label: '设计 / 活文档',
    desc: 'DSL 读写、feature 生命周期、渲染与一致性。',
    // ★★ 2026-10-08 补 `import_project` + `design_intent`（**这是"门"，原来不在面上**）。
    //   实测（`facesOf` 输出）：编排面 9 个工具里 design 线**只露了 `get_dsl` / `edit_dsl`**，
    //   而 `import_project`（扫描代码生成 DSL —— **这条线的入口**）不在 direct 也不在派生链
    //   ⇒ 编排面上是"能读能写、**没有门**"。调用方看到两个读写工具却不知从哪进来，
    //   只能退到 `atomic_call` 先 list 才发现入口 ⇒ **门在门后面**。
    //   `design_intent` 同理：它是"改 why/方向先请人批"的那道闸（本仓核心纪律），
    //   不可见就等于不存在。★ 这三条是**结构性判据**（面无门 ⇒ 该线不可达），不是偏好。
    direct: ['get_dsl', 'edit_dsl', 'import_project', 'design_intent'],
  },
  {
    id: 'refactor',
    label: '重构 / 改名',
    desc: '确定性改造：符号改名、文件移动、引用联动、影响面。',
    direct: ['rename_symbols', 'rename_files', 'find_references'],
  },
  {
    id: 'observe',
    label: '观测 / 验证',
    desc: '运行时插桩、行为基线、测试与契约对账（执行类，按需触发）。',
    direct: [],
  },
  {
    id: 'harvest',
    label: '契约 / 闭包采集',
    desc: '从文档/git/注释/闭包采集决策卡与契约。',
    direct: [],
  },
  {
    id: 'cross',
    label: '跨仓 / 翻译 / 健康',
    desc: '重量级分析：跨仓符号索引、代码健康度、跨语言翻译（Go→TS）。',
    direct: [],
  },
  {
    id: 'meta',
    label: '元信息 / 探索',
    desc: '代码理解入口、诊断、画布笔记、归档与网关说明。',
    // ★★ 2026-10-08 补 `capability_map` —— **地图必须出现在它自己要省的那段路上**。
    //   它自己的描述写着"agent 开工前先定位"，但它既不在 direct 也不在派生链
    //   ⇒ 面设成 `composed` 时它**是隐身的**：要拿到地图得先 `atomic_call(action=list)`
    //   列全 61 个、再 describe、再 call —— **用 4 跳去换一个"省跳数"的工具**，正好相反。
    direct: ['explore_code', 'capability_map'],
  },
];

/**
 * ★ 只保留**策展文本**（`when`）。lane 归属**不在这里**。
 *
 * P1c（2026-09-28）：此前本文件持有 `LANE_OF`（工具 → { lane, when }）—— 那是**第二份归属清单**，
 *   与 P1b 切出来的 lane 文件必然漂移（一处改了、另一处忘改，只在导航里静默显示成"未归线"）。
 *   现在：
 *     · **归属**（工具属哪条线）＝ 由 lane 文件所在表达（`application/<线名>/index.ts`），
 *       `server_registry` 汇总时调 `bindLaneOf()` 注入；
 *     · **说明**（when：导航价值高于注册描述时的策展语句）＝ 留在本表，是真正的人工资产。
 *   ⇒ 本文件**不再有任何 lane 字面量**；`validateLanes` 的"未归线 / 陈旧标注"检查改成对着注入表查，
 *     并新增"`WHEN_OVERRIDES` 里的陈旧条目"检查（工具删了、策展文本忘了删）。
 */
export const WHEN_OVERRIDES: Readonly<Record<string, string>> = {
  index_integrity: '索引可信度自检：陈旧断言 / 未保鲜文件 / 覆盖度 —— 判断"现在读到的索引能不能当真"，可选 refresh 顺手保鲜',
  get_dsl: '统一只读入口，query 参数查 DSL/features/decisions/simulation_state',
  edit_dsl: '统一写入口，operations 批量增删改节点/边/文件/API/binding/status',
  manage_feature: 'feature 生命周期：create/clone/template/list/delete',
  render_design: '渲染并保存设计图（完整 DSL 模式产物）',
  render_brickwork: '渲染积木墙视图',
  scaffold: '脚手架生成（action=generate）', // ★ 2026-10-05 更正：原说明写 action=generate / backfill，
  //   而 backfill 已随 T20 整条删除 ⇒ 教了一个不存在的 action。
  consistency_check: '设计 DSL 与代码语义一致性体检',
  detect_drift: '检测 DSL 与代码语义漂移',
  import_project: '扫描代码项目生成 DSL（文件节点+调用边+符号语义层）',
  design_intent: '设计意图(why)统一入口（action=set=直接写 overlay：goals + edge_intents / propose=只算审批卡不写盘，人 approve 才落）',
  rename_symbols: '标识符改名（两种作用域粒度：scope=module 跨文件模块级符号、全批原子；scope=local 文件内局部绑定、作用域隔离、逐项独立），dry_run 预览后落盘',
  rename_files: '批量文件改名（dry_run 计算影响面，原子阻断）',
  move_symbol: '跨文件移动模块级符号（自动重定向 importer 的 import 源，只改 source 不动使用点）',
  edit_code: '符号级替换（文件+函数+新函数体，AST 定位）',
  find_references: '查某符号的引用点/外部导入者（影响面前置）',
  impact_analysis: '计算一次改动的变更点/风险面',
  structure_gap: '结构意图 vs 现状四态读数（域表声明 vs 磁盘）：待搬清单 / 归属未定 / 待建域 —— 回答"这次分层还差多少、下一步搬什么"（判据是域表 + 目录扫描，不读符号索引）',
  remove_dead_imports: '清理未使用 import',
  refactor_pipeline: '整条重构流水线（预览→执行→校验闭环）',
  plan_refactor: '★ 先算清单（只读）：把一批 file+old_text+new_text 算成可审、可复跑、可入账的清单（plan id + 命中级别 + 预览）——"工具链"缺的那一环',
  apply_refactor_plan: '按 plan_refactor 的清单落盘（幂等：重复 apply 不重复改；plan_id 指纹不符即报错）；与 plan_refactor 成对',
  annotate_functions: '函数语义注释（TS/JS + Go）：扫覆盖→缺失用 LLM 补→@fnhash body 指纹同步过期；可配进 refactor_pipeline 的 function_annotation 步',
  suggest_renames: '生成改名建议（就近相似名/命名规范）；混淆/压缩代码的短名还原可读也走这里——建议先由格式化梳理结构，再经 rename_symbols 应用，意图复原留人/LLM',
  find_similar_names: '找相似命名（撞名/歧义排查）',
  refactor_judge: '重构后裁判：校验是否符合契约/无回归',
  snapshot: '代码快照统一入口（action=list/rollback）：列每次 edit_code/rename_files/move_symbol 落盘前自动存的撤回点，或回滚到某一份（省略=最近一份）；★ 回滚立即落盘、本身不可再撤回',
  diff_views: '多视图/多版本差异对比',
  rules: '规则库统一入口（action=export/apply/check）—— export：把一次实际修复泛化成可复跑规则（$hole + 自动夹具，过「出生回归/反例不命中/幂等」三关才准落盘）；apply：三态（applied/todo/clean），唯一才动、歧义即停；check：当 lint 跑，带 CI 棘轮（只在"新增命中"上 fail）+ 规则自身夹具自检。两个写 action 默认 dry_run=true',
  observe_log: '读运行日志/观测产物',
  observe_judge: '对观测结果做判定',
  observe_instrument: '源码插桩探针（dry_run 可预览）',
  observe_trace: '读录制调用链回放：从 events.jsonl 重建结构化调用树（纯后端，LLM 分析用）',
  feature_line: '功能线：每个功能搭一条主链（功能→入口→调用节点），供沿线单步运行/投大屏点位',
  narrate_step: '把某一步观测过程叙述成可读记录',
  behavior_baseline: '编译语言行为基线（跑函数用例出返回值）',
  run_tests: '运行测试并汇总结果',
  reconcile_chain: '沿效应链逐级对账契约',
  reconcile_effects: '对账函数/模块的实际效应与契约',
  memory_observe: '外部进程内存观测（CDP 外连，不插目标进程）：action=targets 列出本机 --inspect 进程 / status/baseline/track/gc/snapshot 定位 JS 堆 vs native 泄漏方向',
  recommend_observe_points: '★ 推荐该在哪打观测点（索引/图 + AST 语义打分，不做全量插桩）；输出可编辑清单 + 每条的理由',
  harvest_decisions: '从 docs/git log/注释粗提决策卡候选',
  harvest_closure: '扫描闭包出产入盒三件套',
  extract_contracts: '从代码提取契约（多语言 AST）',
  sync_contracts: '以注册表 zod schema 回填 DSL expected_apis',
  cross_repo_symbol_index: '跨仓库符号索引建立/反查',
  code_health: '代码健康度扫描（含 unused_import 多语言）',
  translate_go_ts: '跨语言翻译：Go→TS 半自动（机械骨架+验证闸；fill 用 LLM 逐孔填；verify 跑行为对拍）',
  go_originals: '读 Go 源文件顶层符号原文（ground truth）：翻译/评审时对照 Go 原文，不对着 TS 壳猜',
  explore_code: '代码理解统一入口（search/check_monolith/run_simulation/watch）',
  // ★ 2026-10-05 更正：第一轮实测发现这条写的是 capability_audit 的活（"诊断能力缺口（多语言矩阵）"）⇒
  //   agent 照它去选 diagnose 会得到完全无关的结果。正确口径 = diagnosis 域 note 的第一句。
  diagnose: '症状 → 根因 + 证据链 + 影响面 + 修复建议（不知道是哪条线坏了时先用它定位）',
  canvas_notes: '画布人审标注的读取/渲染',
  archive: '下线库统一入口（action=node/list）—— node：把文件下线归档（写，不可逆，立即落盘，无 dry_run，重复归档被拒）+ 合并记录；list：列某 feature 的下线库归档条目（只读）',
  gateway_provider: 'LLM 网关供应商/Key 池说明与状态',
  read_project_docs: '读项目文档（README/活文档）',
  capability_map: '本工具：能力线导航（目录由注册表 TOOL_DEFS 自动派生）',
};

// ─────────────────────────────────────────────────────────────
// 工具目录注入（P1b 起）：目录来自真实注册表，本模块**不 import 注册表**
// ─────────────────────────────────────────────────────────────

/**
 * 注入的工具目录（null = 还没注入）。模块级单值 —— 与下面的 `_laneOf` 同一模式。
 *
 * ★★ 为什么这份 ref 住在**本叶子模块**而不是 `meta/index.ts`（2026-10-01，④-2）：
 *   目录的注入点是「谁需要读注册表却不能被注册表 import」的那一层。
 *   `meta/index.ts` 会被 `tool_registry.ts`（聚合 6 条 lane 数组）import ⇒
 *   任何**从 meta/index.ts 出发能走到 tool_registry.ts** 的模块，都会和聚合器成环。
 *   `sync_contracts`（同属 meta 线，要读目录）正是这样一个模块 ⇒ 它必须改从叶子取目录。
 *   放在本文件后，`sync_contracts.ts → capability_map.ts`（叶子，无出边）⇒ **环结构性不存在**。
 */
let _toolDefs: ToolDef[] | null = null;

/**
 * 注入工具目录。由 **`application/tool_registry.ts`** 在汇总完 6 条 lane 数组后调用一次
 * （模块加载期 ⇒ 早于任何 handler 执行）。
 */
export function bindToolDefs(defs: ToolDef[]): void {
  _toolDefs = defs;
}

/**
 * 取本次调用要用的工具目录。
 *
 * ★ 未注入时**抛错**（同 `resolveAssign` 的理由）：返回空目录会让所有消费者**静默列出 0 个工具**，
 *   把"加载期接线漏了"伪装成"注册表里真没有工具"。
 */
export function listToolDefs(): ToolDef[] {
  if (!_toolDefs) {
    throw new Error('capability_map：工具目录未注入 —— tool_registry 应在汇总后调用 bindToolDefs()');
  }
  return _toolDefs;
}

// ─────────────────────────────────────────────────────────────
// 归属表注入（P1c）：lane 文件的归属由 server_registry 汇总后送进来
// ─────────────────────────────────────────────────────────────

/** 注入的归属表（null = 还没注入）。模块级单值 —— 与上面的 `_toolDefs` 同一模式。 */
let _laneOf: Readonly<Record<string, LaneAssign>> | null = null;

/**
 * 注入「工具 → 线」归属表。由 **server_registry** 在汇总各 lane 文件后调用一次。
 * 为什么是注入而不是本文件持有：归属已由 lane 文件所在表达，在本文件再存一份 = 第二份清单，必然漂移。
 */
export function bindLaneOf(table: Readonly<Record<string, LaneAssign>>): void {
  _laneOf = table;
}

/** 测试隔离用：清掉注入的归属表（回到"未注入"状态） */
export function resetLaneOfForTest(): void {
  _laneOf = null;
}

/**
 * 解析本次调用要用的归属表。
 *
 * ★ 未注入时**抛错**，返回空表是错的：空表会让 67 个工具**全部**变成"未归线"，
 *   而"未归线"在导航里是**正常可见**的一类（设计如此，防新工具静默消失）——
 *   于是"忘了注入"会被伪装成"这些工具确实没归线"，静默且难查。
 *   抛错把加载期接线错误变成**立刻可见的失败**（同 P1a 的破环纪律：不给"看起来能用"的空壳）。
 */
function resolveAssign(assign?: Readonly<Record<string, LaneAssign>>): Readonly<Record<string, LaneAssign>> {
  if (assign) return assign;
  if (!_laneOf) {
    throw new Error(
      'capability_map：归属表未注入。归属由 lane 文件（application/*/index.ts）表达，' +
        '需在 server_registry 汇总后调用 bindLaneOf()；测试请显式传第二参。',
    );
  }
  return _laneOf;
}

// ─────────────────────────────────────────────────────────────
// 域表注入（2026-10-05）：让 role / note 真正被消费 —— 回答"实现住在哪个目录"
// ─────────────────────────────────────────────────────────────

/**
 * 一条域声明的**导航视图**（只取导航要用的字段；来源 `structure.domains.json`）。
 *
 * ★ 为什么要有这个（2026-10-05 逐文件扫描后的动因）：
 *   导航此前只答一件事 —— 「**用哪个工具**」；但真正让人卡住的是第二件 ——
 *   「**这个工具的实现住在哪个目录**」。`analysis/` 下面混着 11 个域，
 *   你想找 Go→TS 翻译的实现，只能靠猜（这就是"找错起点"的根因）。
 *   ⇒ 域表里已经写好了每个域的 `role` 与 `note`，**把它们读出来接进导航**，
 *     `role` 就从"给量具看的注释"变成**在选工具那一刻起作用的判据**。
 */
export interface DomainNavView {
  id: string;
  layer?: string;
  role?: string;
  dir: string;
  note?: string;
}

/** 注入的域表（null = 还没注入 / 该项目没声明结构意图）。同一注入模式，不新建机制。 */
let _domains: readonly DomainNavView[] | null = null;

/**
 * 注入域表。由**调用方**（`meta/index.ts` 的 capability_map handler，它手上有 `project_dir`）
 * 在调用前读 `structure.domains.json` 后送进来。
 *
 * ★ 为什么是注入而不是本文件自己读：① 本模块是**无 IO 的纯模块**（见文件头）——
 *   自己读会把 IO 引进所有消费者；② 与 `_toolDefs` / `_laneOf` 同一模式，不新造第三种接线。
 * ★ 没注入不是错误：**该项目没声明结构意图**是合法状态（`structureGap` 的 `configured:false`），
 *   此时导航**降级为只答"用哪个工具"**并说明原因 —— 而不是给一个空的"实现地图"骗人。
 */
export function bindDomains(domains: readonly DomainNavView[] | null): void {
  _domains = domains;
}

/** 取本次调用要用的域表（null = 没注入 / 没声明结构意图 —— 两种"没有"都归到这里，导航会明说）。 */
export function listDomains(): readonly DomainNavView[] | null {
  return _domains;
}

/** 测试隔离用：清掉注入的域表 */
export function resetDomainsForTest(): void {
  _domains = null;
}

/**
 * 某条能力线下面的域（按 `dir` 的层数降序 ⇒ 越具体的域排越前）。
 *
 * ★ 判据：**从域表自己派生**，不引第二份映射表 ——
 *   「工具注册在 `application/<lane>/index.ts`」是本仓既有约定（`LANE_SOURCES` 的注释就是这么写的），
 *   所以"这条线有哪些域" = 域表里 `layer === 'application'` 且第 3 段目录名 = lane id 的那些。
 *   ⇒ lane id 与域表都是**各自唯一的事实源**，本函数只做**连接**，不持有第三份清单。
 *   ★ 为什么不用 `LANE_SOURCES`：它在 `tool_registry.ts`，而本模块**不能 import 注册表**
 *     （`server_registry ⇄ capability_map` 循环，见文件头），而且它给的是 `ToolDef[]`、**不是路径**。
 */
export function domainsOfLane(lane: LaneId, all: readonly DomainNavView[]): DomainNavView[] {
  return all
    .filter((d) => d.dir?.startsWith('src/application/') && d.dir.split('/')[2] === lane)
    .sort((a, b) => b.dir.split('/').length - a.dir.split('/').length || (a.dir < b.dir ? -1 : 1));
}

/** 域表的一段导航文本（按 lane 分组；role 打头，让"这是能力还是基建"先看到）。 */
export function renderDomainText(lanes: readonly Lane[], all: readonly DomainNavView[] | null, why = ''): string {
  if (!all || all.length === 0) {
    return (
      `\n▢ 实现地图：${why || '**该项目未声明结构意图**（根下没有 structure.domains.json）'}` +
      ' ⇒ 只能答「用哪个工具」，答不了「实现住在哪个目录」。' +
      '要补的话：写下 domains（哪些目录是域，各带 role 与一句 note）即可。'
    );
  }
  const lines: string[] = [
    '',
    '▢ 实现地图（工具注册在哪个文件 ≠ 实现住在哪个目录 —— 这份是「去哪儿找」）',
    ...(why ? [`  （${why}）`] : []),
  ];
  for (const lane of lanes) {
    const ds = domainsOfLane(lane.id, all);
    if (!ds.length) continue;
    lines.push(`  ◆ ${lane.id}（${ds.length} 个域）`);
    for (const d of ds) {
      const role = d.role ?? '未标 role';
      const note = (d.note ?? '').split(/[。；]/)[0].trim();
      lines.push(`      ${role.padEnd(10)} ${d.dir}${note ? ` —— ${note}` : ''}`);
    }
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// 派生（纯函数）
// ─────────────────────────────────────────────────────────────

export interface BuiltLanes {
  lanes: Lane[];
  /** 已注册但没归属的工具（导航可见，测试红） */
  unassigned: ToolCatalogEntry[];
  /** 归属表有、注册表没有的工具（陈旧标注） */
  stale: string[];
  /** `WHEN_OVERRIDES` 有、注册表没有的工具（陈旧策展文本：工具删了、说明忘删） */
  staleWhen: string[];
}

/**
 * 由注册目录派生能力线。**迭代顺序 = 注册表顺序**（不再人工排序，消除第二处手抄）。
 * when 取值优先级：注入表里的 `when` → `WHEN_OVERRIDES[name]` → describeForNav（注册描述首句）。
 * @param assign 归属表（省略 = 用 `bindLaneOf` 注入的表；测试可显式传以验证派生路径）
 */
export function buildLanes(
  catalog: readonly ToolCatalogEntry[],
  assign?: Readonly<Record<string, LaneAssign>>,
): BuiltLanes {
  const table = resolveAssign(assign);
  const lanes: Lane[] = LANE_META.map((m) => ({ ...m, tools: [] }));
  const byId = new Map(lanes.map((l) => [l.id as string, l]));
  const unassigned: ToolCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const t of catalog) {
    if (!t?.name || seen.has(t.name)) continue;
    seen.add(t.name);
    const a = table[t.name];
    if (!a) {
      unassigned.push(t);
      continue;
    }
    const lane = byId.get(a.lane);
    if (!lane) {
      unassigned.push(t);
      continue;
    }
    const when = a.when ?? WHEN_OVERRIDES[t.name];
    lane.tools.push({
      name: t.name,
      when: when ?? describeForNav(t),
      whenSource: when ? 'curated' : 'derived',
    });
  }

  const stale = Object.keys(table).filter((n) => !seen.has(n)).sort();
  const staleWhen = Object.keys(WHEN_OVERRIDES).filter((n) => !seen.has(n)).sort();
  return { lanes, unassigned, stale, staleWhen };
}

/** 导航用短描述：注册描述首句（截 60 字），空则退回标题/工具名。 */
export function describeForNav(t: ToolCatalogEntry, max = 60): string {
  const raw = (t.description ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return t.title?.trim() || t.name;
  // ★ 2026-10-05 修两处（都是第一轮实测在导航里看出来的）：
  //   ① 原判据在**第一个** `。.；;` 处切 ⇒ 会切在括号**内部**，切出
  //      `**能力矩阵自检**（缺口清单；` 这种**括号没闭合**的半句。
  //   ② `.` 会切在**标识符内部** ⇒ 「读 `a.b` 三个文件」被切成「读 `a.」。
  //      （这一条原判据也有，不是本次新引入。）
  //   ⇒ 改成两个判据：**终止符要在括号配平处**，且 **`.` 只有不在单词中间时才算句子结束**。
  //   一句话：**切完必须是个能独立读的句子**，不是"恰好遇到的分隔符"。
  // ★ 用 \u0060 而不是裸反引号：裸反引号在本会话里已多次破坏构建（模板串内、脚本内），
  //   而这里只需要一个「成对包裹符」字符 —— 转义后源码里一个裸反引号都不剩。
  const TICK = '\u0060';
  const OPEN = '（「『【《([{' + TICK;
  const CLOSE = '）」』】》)]}' + TICK;
  const isWord = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_$\u4e00-\u9fff]/.test(c);
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if ('。；;'.includes(c)) { cut = i + 1; break; }
      // `.` 只在"后面不是单词"时才是句末（否则是 a.b / v1.2 / node:fs 的一部分）
      if (c === '.' && !isWord(raw[i + 1])) { cut = i + 1; break; }
    }
  }
  let s = (cut > 0 ? raw.slice(0, cut) : raw).trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return s;
}

/** 校验（对真实注册表断言用）：返回错误列表，空 = 目录与注册表一致。 */
export function validateLanes(
  catalog: readonly ToolCatalogEntry[],
  assign?: Readonly<Record<string, LaneAssign>>,
): string[] {
  const errors: string[] = [];
  const { lanes, unassigned, stale, staleWhen } = buildLanes(catalog, assign);

  for (const t of unassigned) {
    errors.push(`已注册但未归线：${t.name}（把它加成 application/<line>/index.ts 里对应线数组的一项）`);
  }
  if (stale.length) {
    errors.push(`归属表里的陈旧标注（注册表已无此工具）：${stale.join(', ')}`);
  }
  if (staleWhen.length) {
    errors.push(`WHEN_OVERRIDES 里的陈旧策展文本（注册表已无此工具）：${staleWhen.join(', ')}`);
  }
  for (const lane of lanes) {
    const names = new Set(lane.tools.map((t) => t.name));
    const bad = lane.direct.filter((d) => !names.has(d));
    if (bad.length) errors.push(`线 ${lane.id} 的 direct 引用了线外/不存在的工具：${bad.join(', ')}`);
  }
  return errors;
}

/** 维护视图（不进 agent 输出）：哪些 when 还是自动摘要、哪些没归线。 */
export function laneMaintenanceReport(
  catalog: readonly ToolCatalogEntry[],
  assign?: Readonly<Record<string, LaneAssign>>,
): {
  derived: string[];
  curated: number;
  unassigned: string[];
  stale: string[];
  staleWhen: string[];
} {
  const { lanes, unassigned, stale, staleWhen } = buildLanes(catalog, assign);
  const derived: string[] = [];
  let curated = 0;
  for (const lane of lanes) {
    for (const t of lane.tools) {
      if (t.whenSource === 'derived') derived.push(t.name);
      else curated += 1;
    }
  }
  return { derived, curated, unassigned: unassigned.map((t) => t.name), stale, staleWhen };
}

// ─────────────────────────────────────────────────────────────
// 渲染
// ─────────────────────────────────────────────────────────────

/** 渲染若干能力线成文本（laneIds=空 表示全部） */
export function renderLaneText(lanes: readonly Lane[], laneIds: readonly LaneId[] = []): string {
  const want = new Set(laneIds.length ? laneIds : (LANE_IDS as readonly LaneId[]));
  const lines: string[] = [];
  for (const lane of lanes) {
    if (!want.has(lane.id)) continue;
    lines.push(`\n◆ ${lane.id} · ${lane.label} —— ${lane.desc}`);
    lines.push(`  直接可用（无需导航）：${lane.direct.length ? lane.direct.join(', ') : '（无）'}`);
    for (const t of lane.tools) {
      const mark = lane.direct.includes(t.name) ? '·' : ' ';
      lines.push(`    ${mark} ${t.name} —— ${t.when}`);
    }
  }
  return lines.join('\n');
}

/** 未归线工具段：宁可在导航里显式暴露，也不静默消失（旧版就是这样漏掉 4 个工具的）。 */
export function renderUnassigned(unassigned: readonly ToolCatalogEntry[]): string {
  if (!unassigned.length) return '';
  const lines = [`\n⚠ 未归线工具（${unassigned.length}）—— 尚未纳入任何能力线，按需直接调用：`];
  for (const t of unassigned) lines.push(`      ${t.name} —— ${describeForNav(t)}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// MCP handler
// ─────────────────────────────────────────────────────────────

export interface CapabilityMapInput {
  lane?: LaneId;
}

/**
 * ★★ 从一个 [B] 的**声明入参**里**深层**收集全部属性名（2026-10-06）。
 *
 * ★ 为什么必须"深层"：`rename_symbols` 的对象入参**不在顶层** ——
 *   `renames: z.array(z.object({ file, symbol, to }))` ⇒ 只看顶层键得到的是 `renames`（`context` 词）
 *   ⇒ **判成"下游不要对象"（假阴性）**。★ 与记过的 `touched` 盲区同一个病：**量具只量到顶层**。
 *
 * ★ 实现：走 zod 的 `_def`，**只读结构、不跑校验**；取不到的形态**直接跳过**（宁可少收，也不猜）。
 *   ★★ **必须同时兼容 v3 与 v4**（本仓 `package.json` 写的是 `^3.25.0 || ^4.0.0`，实测装的是 **4.4.3**）：
 *     · **v3**：`ZodArray` 的元素在 `_def.type`；`_def.typeName` 才是类型名。
 *     · **v4**：`ZodArray` 的元素在 **`_def.element`**，而 `_def.type` 变成了**类型名字符串**。
 *   ⇒ 第一版只走 `_def.type` ⇒ **数组那一层没下去、而且不报错**（静默少收 ⇒ `renames[]` 里的
 *     `file`/`symbol` 收不到 ⇒ `rename_symbols` 被误判成"不要对象"）。
 *     ★ 是**探针**（手写同形 schema 跑一遍）抓到的，不是读代码看出来的 —— **先问解析器不猜**。
 *   顶层 `inputSchema` 的**键**本身就是顶层入参名 ⇒ 单独收一遍。
 */
export function collectInputKeys(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const top = schema as Record<string, unknown>;
  const out = new Set<string>(Object.keys(top));
  const walk = (t: unknown, d: number): void => {
    if (!t || d > 8) return;
    const shape = (t as { shape?: unknown }).shape as Record<string, unknown> | undefined;
    if (shape && typeof shape === 'object' && !Array.isArray(shape)) {
      for (const [k, v] of Object.entries(shape)) {
        out.add(k);
        walk(v, d + 1);
      }
      return;
    }
    const def = (t as { _def?: Record<string, unknown> })._def;
    if (!def) return;
    // ★ 逐一走**已知承载子类型**的字段（v3 与 v4 取并集）——
    //   `type`（v3 的 array/innerType 位置；v4 退化成字符串 ⇒ 无害 no-op）
    //   `element`（v4 的 ZodArray）、`innerType`（optional/nullable/default/effects）、
    //   `valueType`（record）、`options` / `items`（union / tuple）
    walk(def.type, d + 1);
    walk(def.element, d + 1);
    walk(def.innerType, d + 1);
    walk(def.valueType, d + 1);
    for (const key of ['options', 'items'] as const) {
      const arr = def[key];
      if (Array.isArray(arr)) for (const o of arr) walk(o, d + 1);
    }
  };
  for (const v of Object.values(top)) walk(v, 0);
  return [...out].sort();
}

/**
 * ★★ 把注册表转成「面 / 完整判定」要用的目录（**单点**，2026-10-06）。
 * ★ 为什么立它：`collectInputKeys` 的调用原先**会散在两处**（`meta/index.ts` 的注入点 +
 *   `server_registry` 按面过滤时）⇒ 再抄一份就是第三份（本仓头号病根：判据分叉）。
 */
export function catalogOf(defs: readonly ToolDef[]): ToolCatalogEntry[] {
  return defs.map((d) => ({
    name: d.name,
    title: d.title,
    description: d.description,
    inputKeys: collectInputKeys(d.inputSchema),
  }));
}

/** 某 [B] 的**对象类入参**名（= 声明入参（深）∩ 词表 `anchor` − **作用域锚点**）。 */
export function objectInputsOf(name: string, catalog: readonly ToolCatalogEntry[]): readonly string[] {
  const keys = catalog.find((c) => c.name === name)?.inputKeys ?? [];
  // ★ 作用域锚点用**同一份** `SCOPE_PATHS`（`domain/chain_wiring.ts` 导出）—— 别在这里再写一遍。
  return keys.filter((k) => B_TERMS[k]?.kind === 'anchor' && !SCOPE_PATHS.has(k));
}

/** 一段的**完整**判定（表侧对象边 + 下游要不要对象）。 */
export interface ChainHopVerdict extends HopVerdict {
  /** 下游这一段**要**的对象类入参（它要什么） */
  wants: readonly string[];
  /** 上游这一段**能喂**的对象键（表侧已验证边的 `fromKey`） */
  fed: readonly string[];
  /**
   * · `no-need` = 下游**本就不要**对象入参（如 `run_tests` 只吃 `project_dir`）⇒ **不算缺口**
   * · `ok`      = 下游要对象，且表里有已验证的对象边喂它
   * · `gap`     = ★ **下游要对象，而上游没有已验证的对象边** ⇒ **真缺口**
   */
  state: 'ok' | 'no-need' | 'gap';
}

/** 逐段完整判定。 */
export function chainVerdictsOf(chain: Chain, catalog: readonly ToolCatalogEntry[]): readonly ChainHopVerdict[] {
  return hopsOf(chain).map((h) => {
    const wants = objectInputsOf(h.to, catalog);
    const fed = [...new Set(h.objectEdges.map((e) => e.fromKey))];
    const state: ChainHopVerdict['state'] = wants.length === 0 ? 'no-need' : fed.length > 0 ? 'ok' : 'gap';
    return { ...h, wants, fed, state };
  });
}

/**
 * ★★★ 链的**完整判定** —— 补齐"表侧"缺的那一半：「**下游到底要不要对象类入参**」。
 *
 * ★ 为什么落点在这里（`application` 层）而不是 `chain_wiring.ts`（`domain`）：
 *   只有这层拿得到 `ToolDef`（`domain` 反向依赖 `application` 是分层违规）。
 * ★ 口径：`no-need` **不算缺口** —— 末段（如 `run_tests`）本来就不要对象入参，
 *   若把它算成缺口，`refactor` 链会被**误报**（这正是"表侧判定"做不到、必须补这半边的理由）。
 */
export function renderChainVerdicts(catalog: readonly ToolCatalogEntry[]): string {
  const lines = CHAINS.map((c) => {
    const hops = chainVerdictsOf(c, catalog);
    const gap = hops.find((h) => h.state === 'gap');
    const detail = hops
      .map((h) => {
        const what =
          h.state === 'no-need'
            ? '不要对象'
            : `${h.state === 'ok' ? '✓' : '✗'} 要[${h.wants.join(',')}] ← 喂[${h.fed.join(',') || '—'}]`;
        return `${h.from}→${h.to}: ${what}`;
      })
      .join(' · ');
    return `    ${c.name.padEnd(14)} ${gap ? `✗ 第 ${gap.hop} 段**真缺口**` : '✓ 无缺口'}\n${' '.repeat(19)}${detail}`;
  });
  return (
    '\n\n── 链的完整判定（★ 表侧对象边 × **下游要不要对象**）──\n' +
    lines.join('\n') +
    '\n  ★ `no-need` = 下游**本就不要**对象（如 `run_tests` 只吃 `project_dir`）⇒ **不算缺口**；' +
    '\n    `gap` = **下游要对象、上游没有已验证的对象边** ⇒ 真缺口。' +
    '\n  ★ 本段用 `ToolDef` 的**声明入参**（深层收集）判"要不要"，表侧口径见 `chain_wiring.ts`。'
  );
}

/**
 * handler 工厂：目录由 server_registry 注入（避免循环 import）。
 * @param getCatalog 取真实注册目录（如 () => TOOL_DEFS）
 */
export function makeCapabilityMapHandler(getCatalog: () => readonly ToolCatalogEntry[]) {
  return async function capabilityMapHandler(
    args: Record<string, unknown>,
    domainReadNote = '',
  ): Promise<{ text: string; isError?: boolean }> {
    const catalog = getCatalog();
    const { lanes, unassigned } = buildLanes(catalog);
    const lane = args.lane as LaneId | undefined;
    const toolCount = lanes.reduce((n, l) => n + l.tools.length, 0) + unassigned.length;
    const header =
      `agent-io 能力线导航：先看线再看工具，高频工具可绕过本导航直接调用。` +
      `\n目录由工具注册表自动派生（${toolCount} 工具 / ${LANE_IDS.length} 线），与注册表同源、不会脱节。` +
      `\n前缀语义：observe_=观测、harvest_=采集、reconcile_=对账、rename_=改名、edit_=修改、render_=渲染。`;

    if (lane) {
      if (!LANE_IDS.includes(lane)) {
        return { text: `未知能力线 "${lane}"。可选：${LANE_IDS.join(' / ')}。`, isError: true };
      }
      // ★ 单线视图也带实现地图：看某条线时正是"这个工具的实现住在哪"最想知道的时候
      const doms = renderDomainText(lanes.filter((l) => l.id === lane), listDomains(), domainReadNote);
      return { text: `${header}${renderLaneText(lanes, [lane])}${doms}`.trim() };
    }
    // ★★ 链的接法（2026-10-05）：把"上一步的产物怎么喂下一步的入参"摆在这里 ——
    //   它是**新用户第一站**，所以 LLM 一眼就能看到接法，**不必回忆字段名、不必数下标**。
    //   ★ 只在全量视图（不带 lane）追加：看单条线时不需要这张表。
    //
    // ★★ 2026-10-05 修一个**既有**的渲染 bug：原来写的是
    //   `` `${header}${renderLaneText(…)}${renderUnassigned(…)}${renderChainWiring()}` .trim() ``
    //   —— `.trim()` 挂在**模板字面量**上，于是它把 `renderChainWiring()` 的**前导两个换行**剥掉了
    //   ⇒「── 链的接法」永远**粘**在前一段末尾（同理会粘住未归线段/实现地图段）。
    //   本轮加「实现地图」段时它第一次被人看见 —— ★ 又一条「加东西才会暴露的旧缺陷」。
    //   ⇒ 修法：先拼成**数组**、滤掉空段、join，最后对**整体** trim。
    return {
      text: [
        header,
        renderLaneText(lanes),
        renderDomainText(lanes, listDomains(), domainReadNote),
        renderUnassigned(unassigned),
        renderChainWiring(),
        // ★★ 2026-10-06：链的**完整判定**（表侧对象边 × 下游要不要对象）——
        //   接在"链的接法"之后：先看**怎么接**，再看**接到哪一步就断了**。
        renderChainVerdicts(catalog),
        // ★★ 2026-10-06：工具「面」（同一个注册表的**视图**）——
        //   `direct` 名单由本模块的 `LANE_META` 提供（避免反向 import 成环）；名字零手写。
        renderFaces(catalog, LANE_META.flatMap((m) => m.direct)),
      ]
        .filter((s) => s && s.length > 0)
        .join('')
        .trim(),
    };
  };
}
