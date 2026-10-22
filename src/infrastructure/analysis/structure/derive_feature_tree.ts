/**
 * derive_feature_tree —— 功能树生成（项目 → 目录分组 → 社区 → 文件）
 *
 * 把"一滩平铺的文件星图"变成逐级下钻的层级导航数据：
 *   项目（feature 根）→ 几大目录分组 → 社区（analyze_monolith 结构簇）→ 文件
 *
 * 数据来源：
 *   - analyze_monolith：基于 cache.db 调用边做跨文件 Louvain 结构簇圈定，
 *     产出 communities（结构簇，锚点名 + 横跨文件）与 file_view（文件内社区分布）。
 *   - 本工具把社区**二次归并**成"几大目录分组"，并建立
 *     文件 → 主导社区 → 目录分组 的归属映射（file_map）。
 *
 * 归并策略（目录优先，结构保真——功能树必须对得上实际项目、符合人类阅读习惯）：
 *   - 社区按"成员文件主导目录"聚成目录分组（domain/infrastructure/presentation/registry/observe… 各成一组）；
 *   - 零社区的目录（纯定义/配置/入口文件，如 dsl 类型、db 存储、daemon 守护）
 *     按目录直挂补成目录分组，不凭空消失；
 *   - gen_names=true（配置了 LLM）时 LLM 只做**命名润色**（目录分组 → 中文分组名），
 *     不重新归并——避免 LLM 按猜的业务语义把目录打散/吞并，导致对不上实际项目。
 * 结果写入 DSL 顶层 feature_tree 字段，供渲染端逐级下钻。
 *
 * ★★ T230（2026-10-13）**改角色**：**这一层的定义归目录，聚类只作"差异信号"**（不是退役）——
 *   - **无可用社区**（`communities.length === 0` / 社区皆无成员）⇒ **回落【目录分组】**，
 *     不再返回空 `features`（改前这条链会让功能树**直接变空**）。判据复用本文件唯一的
 *     `fileKeyOf`/`ruleLabelOf`（`dirFallbackTree` 内），**不新造第二套目录算法**。
 *   - **有社区时**除功能树外**额外**输出 `community_dir_diff`：**文件的主导社区之家目录 ≠
 *     该文件自己的目录**的那些文件。★ 这正是聚类**唯一**目录给不了的价值——跨目录的调用关系
 *     （一个功能横跨多目录时，目录会把它**切碎**，而聚类看得见"这些点在外还聚在一起"）。
 *   - ★ **判据可判定**：`社区 ≠ 目录` 的文件**必须显式出现**；两者**一致时不出现**
 *     （输出空清单占位 = 装饰，不许）。
 */

import { analyzeMonolith } from './analyze_monolith.js';
import { getDSLByView, getDesignSheet, saveDSL } from '../../storage.js';
import { loadLlmConfig, callChat, loadExplainConfig } from '../../llm_focus.js';
import type {
  DesignDSL,
  FeatureTree,
  FeatureNode,
  FeatureCommunity,
  CommunityDirDiffEntry,
} from '../../../domain/types.js';

export interface FeatureTreeInput {
  /** 项目根（定位 <root>/.agent-io/cache.db） */
  project_dir: string;
  /** 可选：注入已打开的 cache.db 连接（复用调用方同一实例，避免路径漂移）；缺省按 project_dir 推导 */
  db?: import('../../index/db.js').Database;
  /** 可选：写入哪个 feature 的 DSL（缺省不落盘，仅返回） */
  feature?: string;
  /** 是否用 LLM 润色分组名（默认 false；未配置 LLM 时静默降级为规则中文名） */
  gen_names?: boolean;
}

export interface FeatureTreeResult {
  feature?: string;
  /** 目录分组层 */
  features: Array<FeatureNode & { file_count: number }>;
  /** 参与归属的文件总数 */
  file_count: number;
  /** 未归入任何目录分组的孤立文件数（通常无调用边也无目录归属，如纯配置） */
  unassigned_count: number;
  message: string;
  /**
   * ★ T230：社区 ≠ 目录 的文件（聚类唯一的增量价值）。
   *   ★ **仅当存在不一致时才带这个键** —— 一致时**不出现**（空清单占位 = 装饰，不许）。
   */
  community_dir_diff?: CommunityDirDiffEntry[];
}

/** 把 LLM 配置格式（explain_gen）转为通用 LlmConfig */
function toLlmCfg(c: ReturnType<typeof loadExplainConfig>) {
  return c ? { apiKey: c.apiKey, model: c.model, baseURL: c.baseURL } : null;
}

/** 取文件路径首段目录，作为规则兜底归并主键 */
function dirOf(p: string): string {
  const seg = p.split('/');
  return seg.length > 1 ? seg[0] : '(根)';
}

/**
 * 顶层目录 → 中文分组名（规则归并时分组名符合人类阅读习惯，而非裸目录名）。
 * 未列出的目录保持原名（如 observe-lang-go 等外部子项目）。
 */
const DIR_FEATURE_NAMES: Record<string, string> = {
  dsl: 'DSL 协议定义',
  db: '数据存储',
  daemon: '守护进程',
  renderer: '渲染引擎',
  observe: '观测探针',
  diagnosis: '诊断分析',
  go_observe: 'Go 探针引擎',
  go_slim: '轻量探针',
  scripts: '构建脚本',
  schema: 'Schema 定义',
  tests: '测试套件',
};

/**
 * 全局基础设施文件：真身是数据层/协议层/服务层（dsl/db/daemon/根级 storage/server），
 * 不应随调用边被吸进业务社区——文件归属按目录直挂，不跟社区走。
 */
function isInfraPath(relPath: string): boolean {
  const seg = relPath.split('/');
  if (seg.length === 1) {
    return /^(storage|server|server_registry|storage_overlay)\./.test(seg[0]);
  }
  return seg[0] === 'dsl' || seg[0] === 'db' || seg[0] === 'daemon';
}

/** 路径归一化：cache.db 的 file_path 锚定仓库根（带 src/ 前缀），DSL 语义路径已剥 src/。
 *  不剥一致则 communityKeyOf 会把所有社区都判成 'src' 主键 → 全部坍缩成一个"核心分组"大桶。
 *  统一剥掉前导 src/，让两套路径空间对齐，目录/能力域判定一致。 */
function normPath(p: string): string {
  const seg = p.split('/');
  if (seg[0] === 'src' && seg.length > 1) return seg.slice(1).join('/');
  return p;
}

/** 测试文件：tests/ 目录或 *.test./*.spec./*_test.* 命名。
 *  测试文件决定不了业务社区的家目录（否则社区被 tests 拉走成"测试套件"大桶），
 *  但文件归属仍按社区走（跟被测模块走），仅孤儿测试文件直挂 tests。 */
function isTestPath(p: string): boolean {
  const nf = normPath(p);
  const base = nf.split('/').pop() ?? '';
  return nf.startsWith('tests/') || /\.(test|spec)\.[a-z0-9]+$/i.test(base) || /_test\.(go|ts|js|tsx|jsx)$/i.test(base);
}

/** 社区 → 规则归并主键：根级归"基础服务"，其余按首段目录 */
function communityKeyOf(c: { files: string[] }): string {
  if (c.files.length === 0) return 'root-svc';
  const counts = new Map<string, number>();
  let testOnly = true;
  for (const f of c.files) {
    if (isTestPath(f)) continue;
    testOnly = false;
    const seg = normPath(f).split('/');
    const key = seg.length > 1 ? seg[0] : 'root-svc';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (testOnly) return 'tests';
  let best = 'root-svc';
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

/** 单个文件 → 规则归并主键（目录维度）：根级 → root-svc，其余按首段目录 */
function fileKeyOf(relPath: string): string {
  const seg = normPath(relPath).split('/');
  if (seg.length === 1) return 'root-svc';
  return seg[0];
}

/** 规则归并主键 → 分组展示名 */
function ruleLabelOf(key: string): string {
  if (key === 'root-svc') return '基础服务';
  return DIR_FEATURE_NAMES[key] ?? key;
}

/**
 * 规则兜底归并：社区按"成员文件主导目录"聚成目录分组（先目录聚）；
 *   - 根级文件（storage/server…）聚成"基础服务"，消除"(根)"伪分组
 * 分组名用中文（DIR_FEATURE_NAMES），符合人类阅读习惯。
 */
function groupByDir(
  comms: Array<{ id: number; name: string; files: string[]; est_lines: number; symbol_count: number }>,
): FeatureNode[] {
  const bucketOf = new Map<number, string>();
  for (const c of comms) bucketOf.set(c.id, communityKeyOf(c));
  const byKey = new Map<string, number[]>();
  for (const [cid, key] of bucketOf) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(cid);
  }
  const features: FeatureNode[] = [];
  for (const [key, ids] of byKey) {
    features.push({ id: '', name: ruleLabelOf(key), communities: ids.map((id) => comms.find((c) => c.id === id)!) });
  }
  return features;
}

/**
 * LLM 仅重命名（命名润色路径）：目录归并结构不动，只让 LLM 给每组起中文名——
 * 结构对得上实际项目，名字又符合人类阅读习惯。输出极小（N 个名字），秒级返回。
 * 返回与 groups 等长的名字数组，或 null（失败保持规则中文名）。
 */
async function renameGroupsByLLM(groups: FeatureNode[]): Promise<string[] | null> {
  if (groups.length === 0) return null;
  const cfg = loadLlmConfig() ?? toLlmCfg(loadExplainConfig());
  if (!cfg) return null;
  const list = groups
    .map((g, i) => {
      const anchors = g.communities.slice(0, 5).map((c) => c.name).join('、');
      const files = [...new Set(g.communities.flatMap((c) => c.files))].slice(0, 4).join(', ');
      return `- ${i}: 现名[${g.name}] · 社区锚点：${anchors} · 文件如：${files}`;
    })
    .join('\n');
  const prompt =
    `下面是一个软件项目按目录粗分的若干目录分组。请给每组起一个简短的**中文名**（4-8 字，体现业务用途，` +
    `如"渲染引擎""配置加载"），不要用目录名/英文原名。\n` +
    `只输出紧凑 JSON：{"names":["名字0","名字1",...]}，顺序与组号一致，共 ${groups.length} 个。\n\n${list}`;
  try {
    const text = await callChat(cfg, [{ role: 'user', content: prompt }], 0.2, 45_000);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { names?: unknown };
    if (!Array.isArray(parsed.names) || parsed.names.length !== groups.length) return null;
    const out = parsed.names.map((n) => String(n).trim());
    if (out.some((n) => !n || n.length > 12)) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * ★ T230 空社区回落：**目录分组**（不再返回空 features）。
 *
 * 判据复用本文件**唯一**的目录键 `fileKeyOf` 与展示名 `ruleLabelOf`（与 `groupByDir` 同源），
 * **不新造第二套目录算法**（本仓头号病：同一判据住两处）。
 * 产出形状与社区路径**一致**（`features: FeatureNode & {file_count}` + `file_map`）⇒ 下游不变。
 *
 * @param reason analyzeMonolith 给出的"为什么没有社区"（原样带出，不吞）
 */
function dirFallbackTree(
  input: FeatureTreeInput,
  liveDsl: DesignDSL | null,
  semanticFiles: Array<{ id: string; path: string }>,
  reason: string,
): FeatureTreeResult {
  const byKey = new Map<string, string[]>(); // 目录键 → 语义文件 id
  for (const sf of semanticFiles) {
    const k = fileKeyOf(sf.path);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(sf.id);
  }
  const features: Array<FeatureNode & { file_count: number }> = [];
  const fileMap: Record<string, { feature_id: string; community_id: number }> = {};
  let i = 0;
  for (const [key, ids] of byKey) {
    const id = `f${i++}`;
    features.push({ id, name: ruleLabelOf(key), communities: [], file_count: ids.length });
    for (const fid of ids) fileMap[fid] = { feature_id: id, community_id: -1 };
  }
  features.sort((a, b) => b.file_count - a.file_count);

  if (input.feature && liveDsl && features.length > 0) {
    persistFeatureTree(input.feature, { features, file_map: fileMap, source: 'rule' }, liveDsl);
  }
  const total = semanticFiles.length;
  const mapped = Object.keys(fileMap).length;
  return {
    feature: input.feature,
    features,
    file_count: mapped,
    unassigned_count: Math.max(0, total - mapped),
    message:
      features.length > 0
        ? `功能树生成（★ 无结构簇 ⇒ 回落【目录分组】）：${features.length} 个目录分组 · ` +
          `${mapped}/${total} 个文件按目录归属。原因：${reason}`
        : `${reason}（且无 live 语义文件 ⇒ 目录分组同样为空）`,
  };
}

/**
 * ★★★ 2026-10-22：功能树落盘**只改 `feature_tree` 一个字段**，绝不整份覆盖。
 *
 * ## 这一处修的是什么（事故级）
 * 原先是 `saveDSL(liveDsl, 'feature_tree')` —— 读的是 **live 视图**、走的是 `saveDSL`。
 * 而 `saveDSL` 自 2026-10-18 起**只写设计侧**（`design/<f>.dsl.json`），不再写活态。
 * ⇒ 于是「把功能树写回 live 快照」这句话**已经不成立**：实际发生时是
 *   **用 live 快照整份盖掉设计册** ⇒ `todos` / 各节点的 `task` / `decision` 全部消失。
 * ★ 2026-10-22 实测：`GET /api/overview`（一个看起来只读的接口）走 `tryDeriveFeatureTree`
 *   ⇒ 设计册 5.03MB → 2.16MB，**96 张任务卡整片清空**。
 *
 * ## 为什么是"读设计册再写"而不是"干脆不写"
 * 功能树是 `overview` 与结构图共用的**落盘事实**（`file_map` 被下游读），不落盘会退化成每次现算。
 * ⇒ 保留写盘，但把写入面收窄到**本函数唯一负责的字段**：
 *   `getDesignSheet` 是**裸读**（不并 overlay）⇒ 写回时不会把 overlay 的内容烘进 base。
 * ★ 读不到设计册（只有 live 的项目）才退回 `liveDsl` —— 那是"首次落册"，语义上等于 fork。
 */
function persistFeatureTree(
  feature: string,
  tree: NonNullable<DesignDSL['feature_tree']>,
  liveDsl: DesignDSL | null,
): void {
  const sheet = getDesignSheet(feature) ?? liveDsl;
  if (!sheet) return;
  sheet.feature_tree = tree;
  saveDSL(sheet, 'feature_tree');
}

export async function deriveFeatureTree(
  input: FeatureTreeInput,
): Promise<FeatureTreeResult> {
  const mono = analyzeMonolith({ project_dir: input.project_dir, db: input.db });

  // 语义基准：live 视图（功能树是"实际代码结构"的产物，必须对齐 cache.db 索引的代码快照）。
  // 不能用设计视图（design）：设计视图是人工/历史拼装态，可能混入跨项目残留文件
  //（曾因 cwd 漂移把 observe-lang-go、observe-conformance 等并进来），命中率闸门会误判"不相关"而拒生成。
  // ★ T230：提前到"空社区回落"之前 —— 回落【目录分组】也要拿这份文件清单当判据。
  const liveDsl = input.feature ? getDSLByView(input.feature, 'live') : null;
  const semanticFiles = liveDsl?.semantic?.files ?? [];

  // 1. 文件 → 主导社区（取 file_view 内符号数最多的社区）
  const fileToCommunity = new Map<string, number>();
  for (const fv of mono.file_view) {
    if (fv.communities.length === 0) continue;
    let top = fv.communities[0];
    for (const c of fv.communities) if (c.symbols > top.symbols) top = c;
    fileToCommunity.set(fv.path, top.id);
  }

  // 2. 提取社区描述（含文件、行数），供归并
  const comms: Array<{ id: number; name: string; files: string[]; est_lines: number; symbol_count: number }> =
    mono.communities
      .filter((c) => c.files.length > 0)
      .map((c) => ({ id: c.id, name: c.name, files: c.files, est_lines: c.est_lines, symbol_count: c.symbol_count }));

  // ★★ T230：**无可用社区 ⇒ 回落【目录分组】**（改前这里直接 `features: []`，功能树会**变空**）。
  //   —— 这一层的定义归**目录**（更准、更便宜、人可直接检查）；聚类只作"差异信号"（见下 `community_dir_diff`）。
  //   ⇒ 判据复用本文件唯一的 `fileKeyOf`/`ruleLabelOf`（`dirFallbackTree` 内），**不新造第二套目录算法**。
  if (comms.length === 0) {
    return dirFallbackTree(input, liveDsl, semanticFiles, mono.message);
  }

  // 3. 归并成目录分组：目录优先（结构保真，对得上实际项目）——社区按"成员文件主导目录"聚成目录分组，
  //    再按能力域拆 tools 大桶；LLM 只做命名润色（不重新归并，避免把目录打散成猜的业务功能）。
  let nodes: FeatureNode[] = groupByDir(comms);
  let usedLlm = false;
  let renameOnly = false;
  if (input.gen_names) {
    const names = await renameGroupsByLLM(nodes);
    if (names) {
      nodes.forEach((n, i) => {
        if (names[i]) n.name = names[i];
      });
      usedLlm = true;
      renameOnly = true;
    }
  }

  // 4. 稳定分组 id（f0, f1, …），供 file_map 引用
  nodes.forEach((n, i) => {
    n.id = `f${i}`;
  });

  // 4.5 建"目录主键 → 分组"索引 + 补零社区目录分组（B）：
  //     数据/协议/服务/工具等目录的纯定义/配置/入口文件（dsl/db/daemon/tools/observe 等）没有调用边，
  //     进不了社区；按目录直挂补成目录分组，保证 L2 层体现真实目录，而不是凭空消失。
  const keyToFeature = new Map<string, string>();
  const coveredKeys = new Set<string>();
  for (const n of nodes) {
    if (n.communities.length === 0) continue;
    const k = communityKeyOf(n.communities[0]);
    if (!keyToFeature.has(k)) {
      keyToFeature.set(k, n.id);
      coveredKeys.add(k);
    }
  }
  const dirFileCount = new Map<string, number>();
  for (const sf of semanticFiles) {
    const k = fileKeyOf(sf.path);
    dirFileCount.set(k, (dirFileCount.get(k) ?? 0) + 1);
  }
  for (const [k, n] of dirFileCount) {
    if (coveredKeys.has(k) || n === 0) continue;
    const id = `f${nodes.length}`;
    keyToFeature.set(k, id);
    nodes.push({ id, name: ruleLabelOf(k), communities: [] });
    coveredKeys.add(k);
  }
  // 社区 → 分组 id
  const commFeatureId = new Map<number, string>();
  nodes.forEach((n) => {
    for (const c of n.communities) commFeatureId.set(c.id, n.id);
  });

  // 组装 features（file_count 按 file_map 归属实算，见下方）
  const features: Array<FeatureNode & { file_count: number }> = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    communities: n.communities.map((c) => ({
      id: c.id,
      name: c.name,
      files: c.files,
      est_lines: c.est_lines,
      symbol_count: c.symbol_count,
    })),
    file_count: 0,
  }));

  // 5. file_map：文件 → 目录分组（社区优先保原子性，孤儿文件目录直挂补全）
  // 路径形态可能不一致：cache.db 的路径相对其项目根（如本仓库 observe/internal/...），
  // DSL 的路径相对导入快照根（顶层目录已剥，如 internal/...）。
  // 用后缀索引兜底（≥2 段，避免单文件名误命中）。
  const suffixToCommunity = new Map<string, number>();
  for (const [p, cid] of fileToCommunity) {
    const segs = p.split('/');
    for (let k = 0; k < segs.length - 1; k++) {
      const key = segs.slice(k).join('/');
      if (!suffixToCommunity.has(key)) suffixToCommunity.set(key, cid); // 长后缀优先
    }
  }
  function communityOf(relPath: string): number | undefined {
    const segs = relPath.split('/');
    for (let k = 0; k < segs.length - 1; k++) {
      const hit = suffixToCommunity.get(segs.slice(k).join('/'));
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const fileMap: Record<string, { feature_id: string; community_id: number }> = {};
  // 归属原则（E，v2 目录优先）：文件按"自己的目录/能力域"归属目录分组（fileKeyOf），
  //   - L4 下钻是"文件层"，文件必须落在它实际所在的目录分组里（tools 文件按能力域、
  //     observe 文件归观测探针），不能跟着"社区的主目录"跑——否则跨目录社区会把
  //     observe/diagnosis 的文件拖进 tools 大分组，对不上实际项目。
  //   - community_id 仅作参考保留（L3 实现路径仍按社区协作模块叙事）。
  //   - 目录键对不上（理论上不会，keyToFeature 覆盖全部语义文件目录）→ 按社区兜底。
  for (const sf of semanticFiles) {
    const cid = fileToCommunity.get(sf.path) ?? communityOf(sf.path);
    const dirFid = keyToFeature.get(fileKeyOf(sf.path));
    if (dirFid) {
      fileMap[sf.id] = { feature_id: dirFid, community_id: cid ?? -1 };
      continue;
    }
    const fid = cid !== undefined ? commFeatureId.get(cid) : undefined;
    if (fid) {
      fileMap[sf.id] = { feature_id: fid, community_id: cid! };
    }
  }
  // file_count：按 file_map 实算（社区成员 + 目录直挂都算上）
  const perFeatureFiles = new Map<string, number>();
  for (const m of Object.values(fileMap)) {
    perFeatureFiles.set(m.feature_id, (perFeatureFiles.get(m.feature_id) ?? 0) + 1);
  }
  for (const f of features) f.file_count = perFeatureFiles.get(f.id) ?? 0;
  features.sort((a, b) => b.file_count - a.file_count);

  // ★★ 4.8 T230：**社区 ≠ 目录 的文件**（聚类唯一的增量价值 = 跨目录的调用关系；目录会把它切碎）。
  //   判据（可判定）：某文件**主导社区的家目录**（`communityKeyOf` = 该社区多数成员文件所在目录）
  //   ≠ 该文件**自己的目录键**（`fileKeyOf`）⇒ 进清单；两者**一致的文件不出现**（否则就是装饰）。
  //   · 无主导社区的文件（孤儿 / 纯目录文件）谈不上"社区≠目录" ⇒ 不进清单。
  //   · 只在"有社区"这条路径上算 —— 空社区回落【目录分组】时本来就没有社区可比（差异清单必空）。
  const communityById = new Map<number, { id: number; name: string; files: string[] }>();
  for (const c of comms) communityById.set(c.id, c);
  const communityDirOf = new Map<number, string>();
  for (const c of comms) communityDirOf.set(c.id, communityKeyOf(c));
  const community_dir_diff: CommunityDirDiffEntry[] = [];
  for (const sf of semanticFiles) {
    const cid = fileToCommunity.get(sf.path) ?? communityOf(sf.path);
    if (cid === undefined) continue;
    const c = communityById.get(cid);
    if (!c) continue;
    const cdir = communityDirOf.get(cid)!;
    const fdir = fileKeyOf(sf.path);
    if (cdir === fdir) continue; // ★ 一致 ⇒ 不出现
    community_dir_diff.push({
      file_id: sf.id,
      file: sf.path,
      dir: fdir,
      community_id: cid,
      community_name: c.name,
      community_dir: cdir,
    });
  }
  community_dir_diff.sort((a, b) => a.file.localeCompare(b.file) || a.community_id - b.community_id);

  // 5.5 范围过滤 + 命中率闸门：cache.db 覆盖整个 project_dir，而 feature 可能只是
  // 其中一个子目录，甚至属于完全无关的代码库（早期无 source_root 的数据）。
  // 闸门判据用 **db 侧命中率**：db 索引文件中属于该 feature 的比例 < 50% 视为
  // 不相关（db 必须是 feature 范围内的子集索引才合法）。注意 db 可只索引 feature
  // 的一部分（如跳过 scripts），DSL 侧命中率会偏低，故不用 DSL 侧做判据。
  const semExact = new Set(semanticFiles.map((f) => f.path));
  const semSuffix = new Set<string>();
  for (const f of semanticFiles) {
    const segs = f.path.split('/');
    for (let k = 0; k < segs.length - 1; k++) semSuffix.add(segs.slice(k).join('/'));
  }
  function inFeature(p: string): boolean {
    if (semExact.has(p)) return true;
    const segs = p.split('/');
    for (let k = 0; k < segs.length - 1; k++) if (semSuffix.has(segs.slice(k).join('/'))) return true;
    return false;
  }
  const dbTotal = mono.file_view.length;
  const dbHit = mono.file_view.filter((fv) => inFeature(fv.path)).length;
  if (dbTotal > 0 && dbHit < dbTotal * 0.5) {
    return {
      feature: input.feature,
      features: [],
      file_count: Object.keys(fileMap).length,
      unassigned_count: semanticFiles.length,
      message: `cache.db 与该 feature 不相关（db 文件 ${dbHit}/${dbTotal} 属于此项目），已拒绝生成功能树`,
    };
  }
  // 规则：分组下任一社区的文件都没进 file_map → 该分组整体剔除。
  const mappedFids = new Set(Object.values(fileMap).map((m) => m.feature_id));
  let scoped = features;
  if (semanticFiles.length > 0 && mappedFids.size > 0) {
    scoped = features.filter((f) => mappedFids.has(f.id));
  }

  // 6. 落盘 —— ★ 只改 feature_tree（见 persistFeatureTree 头注：整份覆盖会清掉 todos / task / decision）
  if (input.feature && liveDsl) {
    persistFeatureTree(
      input.feature,
      {
        features: scoped,
        file_map: fileMap,
        source: usedLlm ? 'llm' : 'rule',
        ...(community_dir_diff.length > 0 ? { community_dir_diff } : {}),
      },
      liveDsl,
    );
  }

  const total = semanticFiles.length;
  return {
    feature: input.feature,
    features: scoped,
    file_count: Object.keys(fileMap).length,
    unassigned_count: Math.max(0, total - Object.keys(fileMap).length),
    message:
      `功能树生成：${scoped.length} 个目录分组 · ${mono.community_count} 个社区 · ` +
      `${Object.keys(fileMap).length}/${total} 个文件完成归属` +
      (renameOnly ? '（LLM 重命名目录分组）' : usedLlm ? '（LLM 归并命名）' : '（规则目录归并）') +
      (community_dir_diff.length > 0 ? ` · ★ 社区≠目录 ${community_dir_diff.length} 个文件` : ''),
    // ★ 仅在不一致时带上这个键（一致时不出现 —— 空清单占位=装饰）
    ...(community_dir_diff.length > 0 ? { community_dir_diff } : {}),
  };
}
