/**
 * roots.ts —— **所有「根」的唯一解析处**（Maven 式：一个角色一个根，归属明确）。
 *
 * ## 为什么要有它（2026-10-26 实测）
 * 同一个 `.agent-io/` 名字下曾同时住着**七种数据**（设计册 / 实际侧快照 / 索引 / 写闸快照 /
 * 观测 / 影响链 / 判据缓存），而**归属规则不一致**：册跟"数据主目录"，索引跟"当时的项目根"。
 * 实测后果：一台机器上出现 **4 个互相不知道的索引根**
 * （`<dataHome>/.agent-io` 58MB · `review-hub/.agent-io` 819KB · `dsh-brain/.agent-io` 89MB ·
 *  `<pkg>/src/application/.agent-io` 18MB —— 最后一个是把子目录误当项目根算出来的纯垃圾）。
 *
 * ## 判据（两条，别在别处再判一次）
 * 1. **归属**：`shared` = 跨项目、慢变、要备份（像 Maven 的 `~/.m2`）；
 *            `project` = 项目本地、派生、可删可重建（像 `target/`）。
 * 2. **可派生性** `derivable`：`true` ⇒ 允许脚本 `rm -rf` 后重建；`false` ⇒ **禁止**脚本删（只能人迁）。
 *
 * ## 用户裁定（2026-10-26）
 * 索引（cache.db）归**项目本地**（A 方案）："一点硬盘空间的代价比性能和稳定性/可扩展性比起来不算什么"。
 *
 * ★ 迁移策略：**只换寻址、不改实际路径**。所有 path 都保持与今天逐字相同，
 *   这样本模块可以先接上去当"唯一事实"，再逐个角色改布局 —— 不会一次动到 50 处调用点。
 */
import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR_NAME } from './data_dir.js';
import { getStorageRoot } from './storage.js';

/** 数据角色（一个角色 = 一种数据 = 一个根） */
export type RootRole =
  | 'design' // 设计册（features/<feature>.dsl.json）
  | 'history' // 任务历史（task-history.db）
  | 'judgeCache' // 判据缓存（按 feature + 文件哈希）
  | 'cache' // 符号索引（cache.db，项目本地）
  | 'featureCache' // 册索引（import_cache_<feature>.db，按 feature 寻址，shared 根）
  | 'live' // 实际侧 DSL 快照
  | 'baseline' // 上一次扫描的实际侧基线
  | 'snapshot' // 写闸快照（可撤回）
  | 'observe' // 观测事件（events.jsonl 等）
  | 'impact' // 影响链报告
  | 'translate'; // 翻译侧

/** 归属：shared = 跨项目共享（~/.m2 类比）；project = 项目本地（target/ 类比） */
export type RootKind = 'shared' | 'project';

export interface RootSpec {
  role: RootRole;
  kind: RootKind;
  /** 绝对路径 */
  path: string;
  /** true ⇒ 派生数据，允许脚本删除后重建；false ⇒ 禁止脚本删（只能人迁） */
  derivable: boolean;
  /** 一句话说明这个根装什么 */
  note: string;
  /**
   * ★ 文件型角色（cache / history / judgeCache）落的是**一个文件**，不是目录 ⇒ 必须带文件名。
   * 2026-10-26 实测：漏了它 ⇒ `projectCacheDbPath()` 返回 `<root>/.agent-io`（少 `\cache.db`），
   * 被「零行为变更校验」当场抓住（新解析器算出的路径必须与旧拼法**逐字相同**）。
   */
  fileName?: string;
  /**
   * ★ 带占位符的文件名（仅 `featureCache` 用）：`import_cache_{feature}.db`。
   * 为什么需要它：这个角色的路径不只靠 projectRoot，还靠 **feature 名**
   * —— feature 是**跨项目**概念（册按 feature 寻址），所以它的索引住 shared 根。
   */
  fileTemplate?: string;
  /**
   * ★ 本角色在当前入参下能不能算出来。
   * `featureCache` 没给 feature 时 = `false`，此时 `path` 是空串。
   * ★ 为什么是“标记不可用”而不是“抛错”：2026-10-26 实测，抛错会**连坐** ——
   *   任何 `rootsOf(projectRoot)`（根本不关心册索引的调用）都会炸。
   *   要册索引的调用方请用 `featureCachePath(feature)`（语义最窄）。
   */
  available: boolean;
}

/** 角色表：**归属与可派生性只住这里**（别在调用点再判） */
const ROLE_SPECS: ReadonlyArray<Omit<RootSpec, 'path' | 'available'>> = [
  { role: 'design', kind: 'shared', derivable: false, note: '设计册：意图 + 决策 + 判据（丢了不可重建）' },
  { role: 'history', kind: 'shared', derivable: false, note: '任务历史（已了结的卡，丢了不可重建）', fileName: 'task-history.db' },
  { role: 'judgeCache', kind: 'shared', derivable: true, note: '判据缓存（按 feature+文件哈希，删了会重算）', fileName: 'judge-cache.json' },
  { role: 'cache', kind: 'project', derivable: true, note: '符号索引 cache.db（A 方案：项目本地）', fileName: 'cache.db' },
  // ★ 2026-10-26（T-#4b）：这不是「重复寻址」，是**另一种作用域** —— 主键是 feature 而不是项目根。
  //   它服务的是「只有 feature 名、没有项目根」的合法场景（HTTP 面按 feature 查函数大纲 / 文件事实）。
  //   名字 `import_cache_` 听起来像临时文件，但语义正当 ⇒ 收编为角色，而不是退场。
  { role: 'featureCache', kind: 'shared', derivable: true, note: '册索引：按 feature 寻址（feature 跨项目）', fileTemplate: 'import_cache_{feature}.db' },
  { role: 'live', kind: 'project', derivable: true, note: '实际侧 DSL 快照（由源码现算）' },
  { role: 'baseline', kind: 'project', derivable: true, note: '上一次扫描的实际侧基线' },
  { role: 'snapshot', kind: 'project', derivable: true, note: '写闸快照（可撤回；保留期由策略定）' },
  { role: 'observe', kind: 'project', derivable: true, note: '观测事件与调用树' },
  { role: 'impact', kind: 'project', derivable: true, note: '影响链报告' },
  { role: 'translate', kind: 'project', derivable: true, note: '翻译侧（Go→TS 等）' },
];

/** 各角色在根下的子目录名（与今天的实际布局**逐字相同**，迁移期零变更） */
const ROLE_SUBDIR: Record<RootRole, string> = {
  design: 'design',
  history: '.', // task-history.db 直接落在根下
  judgeCache: '.', // judge-cache.json 直接落在根下
  cache: '.', // cache.db 直接落在根下
  featureCache: '.', // import_cache_<feature>.db 直接落在根下
  live: 'live',
  baseline: 'baseline',
  snapshot: 'code-snapshots',
  observe: 'observe',
  impact: 'impact',
  translate: 'translate',
};

/**
 * 解析一个项目（或"无项目"场景）的全部根。
 *
 * @param projectRoot 被分析项目根；**不传 ⇒ 只有 shared 角色可用**（project 角色会抛，不兜底 cwd）
 */
export function rootsOf(projectRoot?: string, feature?: string): Record<RootRole, RootSpec> {
  const sharedHome = getStorageRoot(); // <dataHome>/.agent-io
  const projectHome = projectRoot ? path.join(path.resolve(projectRoot), DATA_DIR_NAME) : null;
  const out = {} as Record<RootRole, RootSpec>;
  for (const spec of ROLE_SPECS) {
    const base = spec.kind === 'shared' ? sharedHome : projectHome;
    if (!base) {
      throw new Error(
        `rootsOf: 角色 "${spec.role}" 属于**项目本地**根，但调用方没给 projectRoot —— ` +
          `★ 不兜底 cwd（兜底会读到另一个项目的数据，见 storage.ts#requireProjectRoot 的裁定）`,
      );
    }
    const sub = ROLE_SUBDIR[spec.role];
    const dir = sub === '.' ? base : path.join(base, sub);
    // ★ 模板型角色（featureCache）：路径还要 feature 名 —— 没给就标 unavailable（**不猜、也不连坐**）
    if (spec.fileTemplate) {
      out[spec.role] = feature
        ? { ...spec, available: true, path: path.join(dir, spec.fileTemplate.replace('{feature}', feature)) }
        : { ...spec, available: false, path: '' };
      continue;
    }
    // ★ 文件型角色再拼文件名（目录型角色 fileName 为空，直接用目录）
    out[spec.role] = { ...spec, available: true, path: spec.fileName ? path.join(dir, spec.fileName) : dir };
  }
  return out;
}

/**
 * 册索引路径（**唯一解析**）：`<shared>/.agent-io/import_cache_<feature>.db`。
 *
 * ★ 为什么不走 `rootsOf()`：`rootsOf` 要 projectRoot（它要算项目本地角色），
 *   而“只有 feature 名”的调用方（HTTP 面按 feature 查）**没有项目根** ——
 *   2026-10-26 实测：让它去调 `rootsOf(undefined, feature)` 会在 project 角色上抛错。
 *   ⇒ 单独一个入口，只算 shared 根下的这个文件，语义最窄。
 */
export function featureCachePath(feature: string): string {
  if (!feature) throw new Error('featureCachePath 需要 feature 名 —— 不兜底、不猜');
  const spec = ROLE_SPECS.find((s) => s.role === 'featureCache');
  if (!spec?.fileTemplate) throw new Error('roots: featureCache 角色未定义 fileTemplate（不该发生）');
  return path.join(getStorageRoot(), spec.fileTemplate.replace('{feature}', feature));
}

/** 人读清单（doctor / 诊断用）：把"每种数据住在哪"一次说清 */
export function formatRootsReport(projectRoot?: string): string {
  const lines: string[] = ['══ 根清单（一个角色一个根）══'];
  const sharedHome = getStorageRoot();
  lines.push(`shared 根：${sharedHome}   ← 跨项目、要备份（像 ~/.m2）`);
  if (projectRoot) {
    lines.push(`project 根：${path.join(path.resolve(projectRoot), DATA_DIR_NAME)}   ← 项目本地、可删可重建（像 target/）`);
  } else {
    lines.push('project 根：（未给 projectRoot ⇒ 项目本地角色不可用）');
  }
  lines.push('');
  if (!projectRoot) {
    lines.push('  （项目本地角色需要 projectRoot —— 未给 ⇒ 本清单不列；shared 角色见上）');
    return lines.join('\n');
  }
  const table = rootsOf(projectRoot);
  for (const role of Object.keys(table) as RootRole[]) {
    const r = table[role];
    // ★ 算不出来的角色（featureCache 缺 feature）如实标「需 feature」，不留空白
    const shownPath = r.available ? r.path : '（需 feature）';
    lines.push(
      `  ${role.padEnd(11)} ${r.kind.padEnd(8)} ${r.derivable ? '可删重建' : '禁止脚本删'}  ${shownPath}\n` +
        `  ${' '.repeat(11)} ${r.note}`,
    );
  }
  return lines.join('\n');
}

/**
 * 找出「本不该在这」的数据目录（偏离 `rootsOf` 期望位置的那些）。
 *
 * ## 为什么需要它（2026-10-26 实测）
 * 光有"每种数据该住哪"的表还不够 —— 现实里会出现**多出来的根**：
 *   实测同一台机器上有 4 个 `.agent-io`，其中 `<pkg>/src/application/.agent-io`（18MB）
 *   是某个调用把**子目录**误当项目根算出来的纯垃圾。
 * ⇒ 判据：在 projectRoot 下（深度 ≤ 4，跳过 `node_modules` / `.git`）扫所有名为 `.agent-io` 的目录，
 *   与 `rootsOf(projectRoot)` 期望的**唯一**项目本地根比对 —— **多出来的就是可疑**。
 *
 * ★ 只说数、不下结论（与 `consistency_check` 的反向信号同纪律）：
 *   多出来的可能是"历史遗留"、"误算的根"，也可能是"另一个合法项目嵌在这里" ⇒ **要人看一眼**。
 */
export function findStrayDataDirs(projectRoot: string, maxDepth = 4): string[] {
  const root = path.resolve(projectRoot);
  const expected = path.join(root, DATA_DIR_NAME);
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 无权限/已删 ⇒ 跳过
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.name === DATA_DIR_NAME) {
        if (path.resolve(p) !== expected) out.push(path.relative(root, p).replace(/\\/g, '/'));
        continue; // 不再往数据目录里钻
      }
      walk(p, depth + 1);
    }
  };
  walk(root, 1);
  return out.sort();
}
