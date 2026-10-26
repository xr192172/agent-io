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
  // ★ 2026-10-26（T-#8）：`fileTemplate` / `available` 已随 `featureCache` 一并删除 ——
  //   它们只为那一个角色存在（占位符文件名 + “算不出来就标不可用”）。真没用就删，不留抽象。
}

/** 角色表：**归属与可派生性只住这里**（别在调用点再判） */
const ROLE_SPECS: ReadonlyArray<Omit<RootSpec, 'path'>> = [
  // ★★★ 2026-10-26（T-#29）：`design` / `history` 从 `shared` 改 `project`。
  //   实测证据：`rootsOf('review-hub').design.path` 曾是 **agent-io 的数据家**
  //   （而 `cache` 正确落在 review-hub）⇒ `rootsOf` 与事实矛盾。
  //   ⇒ 两者都住 `<项目根>/.agent-io/`、都是 `derivable:false`（意图，随仓移交）⇒ 它们是**项目本地**角色。
  //   ★ `gitignoreRules()` 只看 `derivable`，不看 `kind` ⇒ 本改动**不影响** gitignore。
  { role: 'design', kind: 'project', derivable: false, note: '设计册：意图 + 决策 + 判据（丢了不可重建）' },
  { role: 'history', kind: 'project', derivable: false, note: '任务历史（已了结的卡，丢了不可重建）—— ★ 跟踪产物是 .jsonl 文本镜像，.db 工作库由通用 *.db* 规则忽略', fileName: 'task-history.jsonl' },
  { role: 'judgeCache', kind: 'shared', derivable: true, note: '判据缓存（按 feature+文件哈希，删了会重算）', fileName: 'judge-cache.json' },
  { role: 'cache', kind: 'project', derivable: true, note: '符号索引 cache.db（A 方案：项目本地）', fileName: 'cache.db' },
  // ★ 2026-10-26（T-#8）：**`featureCache` 已删**（原为“按 feature 寻址的跨项目索引”）。
  //   删的依据是取证：三个工作区全盘扫 `import_cache_*.db` ⇒ **0 个**（从未产生过任何产物）；
  //   且寄风确认 HTTP 面（它唯一的消费者）是**可视化预留、没人用**。
  //   ⇒ 乙方案下每个项目有自己的索引，不存在“跨项目的按 feature 索引”这个角色。
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
export function rootsOf(projectRoot?: string): Record<RootRole, RootSpec> {
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
    // ★ 文件型角色再拼文件名（目录型角色 fileName 为空，直接用目录）
    out[spec.role] = { ...spec, path: spec.fileName ? path.join(dir, spec.fileName) : dir };
  }
  return out;
}

// ★ 2026-10-26（T-#8）：`featureCachePath()` 已随 `featureCache` 角色一起删除。
//   它存在的唯一理由是“只有 feature 名、没有项目根”的 HTTP 调用方 —— 而那个面是可视化预留、没人用。
//   要恢复“上传模式跨次复用”，正确做法是给项目注册表加 feature→cache 映射，不是再长一个平行索引。

/**
 * **三个侧**（寄风的口径：一个项目独立拥有三个侧）+ 一个跨项目任务系统。
 * ★ 2026-10-26 澄清：原先写成“三本册”是语音把**侧**误识别成**册**；模型是“侧”。
 */
export type RootSide = 'design' | 'live' | 'translate' | 'task';

/** 每个角色属于哪个侧（唯一住处；分组渲染与后续迁移都读它） */
const ROLE_SIDE: Record<RootRole, RootSide> = {
  design: 'design', // 设计侧：意图（决策卡/期望/判据）
  judgeCache: 'design', // 判据缓存服务判据 ⇒ 跟设计侧
  cache: 'live', // 实际侧：事实
  live: 'live',
  baseline: 'live',
  snapshot: 'live',
  observe: 'live',
  impact: 'live',
  translate: 'translate', // 翻译侧
  history: 'task', // 任务系统（跨项目，不属于任何一侧）
};

/** 侧的展示名与一句话说明 */
const SIDE_LABEL: Record<RootSide, string> = {
  design: '设计侧（意图：决策卡 / 期望 / 判据）',
  live: '实际侧（事实：代码现在长什么样；全部可由源码重建）',
  translate: '翻译侧（跨语言映射）',
  task: '任务系统（跨项目；不属于任何一个侧）',
};

/**
 * ★★★ 2026-10-26（T-#13）：**由角色表生成 .gitignore 规则** —— 唯一住处。
 *
 * 为什么必须生成而不是手写：哪些该忽略、哪些该进 git，**不是口味，是 `derivable`**：
 *   · `derivable: true` ⇒ 派生数据、可由源码重建 ⇒ **不进 git**
 *   · `derivable: false` ⇒ 意图（册/历史）⇒ **随仓移交**
 * 病史：手写的 `.agent-io/*` 只锚在仓根 ⇒ `src/application/.agent-io/cache.db`（23.5MB）进了 git。
 * ⇒ 布局一变（例如三侧落地、shared 角色搬到 `~/.agent-io`）只需重跑 `scripts/gen_gitignore.mjs`，
 *   规则自动跟随；且可用 `--check` 当门比对。
 */
export function gitignoreRules(): { ignore: string[]; keep: string[] } {
  const ignore: string[] = [];
  const keep: string[] = [];
  for (const spec of ROLE_SPECS) {
    const sub = ROLE_SUBDIR[spec.role];
    const name = sub === '.' ? (spec.fileName ?? '') : sub;
    if (!name) continue;
    const rel = `${DATA_DIR_NAME}/${name}`;
    (spec.derivable ? ignore : keep).push(rel);
  }
  // sqlite 的三个伴生文件（-wal / -shm）跟着主库一起忽略
  ignore.push(`${DATA_DIR_NAME}/*.db*`);
  return { ignore: [...new Set(ignore)].sort(), keep: [...new Set(keep)].sort() };
}

/** 人读清单（doctor / 诊断用）：把"每种数据住在哪"一次说清 */
export function formatRootsReport(projectRoot?: string): string {
  const lines: string[] = ['══ 根清单（按【三个侧】分组）══'];
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
  // ★ 按【侧】分组渲染（寄风的模型：一个项目独立拥有三个侧）
  const order: RootSide[] = ['design', 'live', 'translate', 'task'];
  for (const side of order) {
    const roles = (Object.keys(table) as RootRole[]).filter((r) => ROLE_SIDE[r] === side);
    if (roles.length === 0) continue;
    lines.push(`\n■ ${SIDE_LABEL[side]}`);
    for (const role of roles) {
      const r = table[role];
      const shownPath = r.path;
      lines.push(
        `  ${role.padEnd(11)} ${r.kind.padEnd(8)} ${r.derivable ? '可删重建' : '禁止脚本删'}  ${shownPath}\n` +
          `  ${' '.repeat(11)} ${r.note}`,
      );
    }
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
