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
import { DATA_DIR_NAME } from './data_dir.js';
import { getStorageRoot } from './storage.js';

/** 数据角色（一个角色 = 一种数据 = 一个根） */
export type RootRole =
  | 'design' // 设计册（features/<feature>.dsl.json）
  | 'history' // 任务历史（task-history.db）
  | 'judgeCache' // 判据缓存（按 feature + 文件哈希）
  | 'cache' // 符号索引（cache.db）
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
}

/** 角色表：**归属与可派生性只住这里**（别在调用点再判） */
const ROLE_SPECS: ReadonlyArray<Omit<RootSpec, 'path'>> = [
  { role: 'design', kind: 'shared', derivable: false, note: '设计册：意图 + 决策 + 判据（丢了不可重建）' },
  { role: 'history', kind: 'shared', derivable: false, note: '任务历史（已了结的卡，丢了不可重建）', fileName: 'task-history.db' },
  { role: 'judgeCache', kind: 'shared', derivable: true, note: '判据缓存（按 feature+文件哈希，删了会重算）', fileName: 'judge-cache.json' },
  { role: 'cache', kind: 'project', derivable: true, note: '符号索引 cache.db（A 方案：项目本地）', fileName: 'cache.db' },
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
  const table = rootsOf(projectRoot);
  for (const role of Object.keys(table) as RootRole[]) {
    const r = table[role];
    lines.push(
      `  ${role.padEnd(11)} ${r.kind.padEnd(8)} ${r.derivable ? '可删重建' : '禁止脚本删'}  ${r.path}\n` +
        `  ${' '.repeat(11)} ${r.note}`,
    );
  }
  return lines.join('\n');
}
