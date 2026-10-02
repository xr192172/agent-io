/**
 * structure_gap —— 「结构意图 vs 现状」的**四态读数**（域 = 能力的家）。
 *
 * ★ 它补的是重构工具缺的那一位：**"域"这个概念**。
 *   既有 DSL 的维度是「功能 → 文件 → API」，管的是"一条功能线该有哪些文件、暴露哪些 API"；
 *   **它不表达"哪个目录算哪个域、谁归谁"** ⇒ 于是"整仓分层/搬家"这类重构只能靠人在会话里
 *   手工摊一张表（2026-10-02 实测：`infrastructure/analysis/` 一个目录 84 个文件，其中 19 个
 *   没分类直接堆着，另有 11 个已按域分子目录 —— **两种标准并存**）。
 *
 * ★ 与既有判据的分工（**这三条决定了"补什么、不补什么"**，别只看结论）：
 *   · **依赖方向不在这里**：`dep-cruiser` 已在算（`layer-downward-only` 等）⇒ 搬进来就是第二副本。
 *     ⇒ 配置里的 `layer` 只是给人读的**分类标签**，**不参与任何判定**。
 *   · **实际依赖边也不在这里**：从 `cache.db` 现取。
 *   · **本模块只做一件事**：把「配置声明的结构意图」与「磁盘现状」对账，报出差异。
 *
 * ★★ 四态（前两态是**待办清单**，第三态是**要人做决定**的，第五态是**配置写错**）：
 *   `misplaced` 文件在，但不在目标域（= 该搬还没搬）           —— 待搬清单
 *   `unlisted`  文件在，且没在任何域里登记                    —— 归属未定，**不猜**
 *   `missing`   目标声明了某域，但那个目录还不存在/域里没有源码 —— 与 misplaced 一体两面：
 *               搬迁完成 ⇒ 目录出现、misplaced 归零、本项自然消失；若并不打算建 ⇒ 配置写错。
 *
 * ★ `flatDirs`（有意平铺的目录）**不是免检白名单**：它声明"这里的散文件是终态"，因此它的
 *   **子目录必须被登记** —— 出现了却没登记 ⇒ 报 `unlisted`。这是 flat 唯一的可证伪点。
 *
 * ★ 两种"没有"必须分开（否则就是兜底）：
 *   · 配置文件**不存在** ⇒ `configured:false`（**这是合法状态**：项目没声明结构意图，不是失败）
 *   · 配置文件在但读不了 / JSON 坏 / id 重复 ⇒ **抛**（那是真错误，不许降级成"没配置"）
 */

import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_EXTS, isSourceExt, isNoiseFileName } from '../../parse/source_exts.js';

/** 结构意图的配置文件名（与 `.dependency-cruiser.cjs` 同级：**架构约定**，不是派生数据） */
export const STRUCTURE_CONFIG_BASENAME = 'structure.domains.json';

/** 一条域声明：`dir` 里的散文件「要么已搬完、要么就是待搬的缺口」 */
export interface StructureDomainDecl {
  id: string;
  /** 分类标签（给人读；**不参与判定** —— 依赖方向是 dep-cruiser 的职责） */
  layer?: string;
  /** 域目录，相对 project_dir，**正斜杠** */
  dir: string;
  note?: string;
}

/** 一条平铺声明：`dir` 里的散文件**就是终态**（不报 misplaced）；子目录必须另行登记 */
export interface FlatDirDecl extends StructureDomainDecl {}

export interface StructureDomainsConfig {
  domains: StructureDomainDecl[];
  flatDirs?: FlatDirDecl[];
  /** 有意留白：归属还没定的文件名（不含扩展名）。读数把它们报成 `unlisted` 而不是猜一个域 */
  unassigned?: string[];
}

export interface StructureGapItem {
  /** 相对 project_dir 的路径（目录以 `/` 结尾） */
  path: string;
  note: string;
}

export interface StructureGapReport {
  config_path: string;
  domain_count: number;
  flat_count: number;
  /** 在，但不在目标域 —— **待搬清单** */
  misplaced: StructureGapItem[];
  /** 在，归属未定 —— **要决定，不要猜** */
  unlisted: StructureGapItem[];
  /** 域目录还不存在 / 域里没有源码 —— 与 misplaced 一体两面 */
  missing: StructureGapItem[];
}

/** 顶层入口的返回：多一个 `configured` —— 项目**没声明**结构意图时，四态都是空数组 */
export interface StructureGapResult extends StructureGapReport {
  configured: boolean;
}

export function structureConfigPath(projectDir: string): string {
  return path.join(projectDir, STRUCTURE_CONFIG_BASENAME);
}

const absOf = (projectDir: string, rel: string): string => path.join(projectDir, ...rel.split('/'));

/** 目录下的源码文件名（已排噪音/声明产物）；目录不存在 ⇒ 空数组 */
function sourceFileNames(dirAbs: string): string[] {
  if (!fs.existsSync(dirAbs)) return [];
  return fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .filter((e) => e.isFile() && !isNoiseFileName(e.name) && isSourceExt(path.extname(e.name)))
    .map((e) => e.name)
    .sort();
}

/** 域也可能体现在**同名单文件**里（"收编"场景：`meta/index.ts` 就是 `meta` 域的入口） */
function siblingSourceFile(projectDir: string, dirRel: string): string | null {
  for (const ext of SOURCE_EXTS) {
    const cand = `${dirRel}${ext}`;
    if (fs.existsSync(absOf(projectDir, cand))) return cand;
  }
  return null;
}

/**
 * 配置的结构性校验 —— 不合法就**抛**。
 * ★ 为什么 id 唯一必须在这里兜：`structure_gap` 的入参只有一个 project_dir，但**读数是按 id
 *   索引给人看的**；id 重复 ⇒ 报告中两个域同名、人无法判断哪条对应哪个目录（实测教训：加
 *   `meta/` 域时差点造出第二个 id=impact —— 已有的 impact 域在 infrastructure/analysis/ 下）。
 */
function assertConfig(cfg: StructureDomainsConfig, configPath: string): void {
  if (!Array.isArray(cfg.domains)) throw new Error(`${configPath}: 缺 domains 数组`);
  const all = [...cfg.domains, ...(cfg.flatDirs ?? [])];
  for (const d of all) {
    if (!d?.id || !d?.dir) throw new Error(`${configPath}: 每条声明都要有 id 与 dir（问题条目：${JSON.stringify(d)}）`);
    if (path.isAbsolute(d.dir) || d.dir.includes('\\')) {
      throw new Error(`${configPath}: dir 必须是相对路径且用正斜杠（${d.id}: ${d.dir}）`);
    }
  }
  const ids = all.map((d) => d.id);
  const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  if (dup.length) throw new Error(`${configPath}: 域 id 重复 —— ${dup.join(', ')}（读数按 id 索引，重复后无法对应目录）`);
}

/**
 * 读配置。见头注「两种"没有"必须分开」：
 * @returns 配置对象；**文件不存在**时返回 `null`；文件坏/结构非法时**抛**。
 */
export function readStructureConfig(projectDir: string): StructureDomainsConfig | null {
  const p = structureConfigPath(projectDir);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf-8');
  } catch (e) {
    // 只有 ENOENT 才算"没配置"；权限等其它 IO 错是**真错误**，照抛
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const cfg = JSON.parse(raw) as StructureDomainsConfig; // 坏 JSON ⇒ 抛（不降级成"没配置"）
  assertConfig(cfg, p);
  return cfg;
}

/** 对账：意图（配置）vs 现状（磁盘）。纯函数，不写盘、不兜底。 */
export function computeStructureGap(projectDir: string, cfg: StructureDomainsConfig): StructureGapReport {
  const flat = cfg.flatDirs ?? [];
  const unassigned = new Set(cfg.unassigned ?? []);
  const declaredDirs = [...cfg.domains, ...flat].map((d) => d.dir);
  const misplaced: StructureGapItem[] = [];
  const unlisted: StructureGapItem[] = [];
  const missing: StructureGapItem[] = [];

  // ① missing：域目录还不存在 / 域里没有源码
  for (const d of cfg.domains) {
    if (sourceFileNames(absOf(projectDir, d.dir)).length > 0) continue;
    const asFile = siblingSourceFile(projectDir, d.dir);
    missing.push({
      path: d.dir,
      note: asFile
        ? `目标是目录，现在是单文件 ${asFile}（域已收编进单文件）`
        : fs.existsSync(absOf(projectDir, d.dir))
          ? '目录存在但域里一个源码文件都没有'
          : '目录不存在，域里也没有文件',
    });
  }

  // ② misplaced / unlisted：只看**域目录的父目录下、直接堆放**的文件（那才是"没分类"）
  //    ★★ 必须**扣掉 flatDirs 声明的目录**（2026-10-02 实测的真缺口）：
  //      只要有一条域的 `dir` 落在 `src/infrastructure/` 下（如 `src/infrastructure/text`），
  //      它的 dirname 就把 `src/infrastructure` 带进 parents ⇒ 量具开始扫那个目录的直属散文件
  //      ⇒ 报 `misplaced`。**可那个目录早已被 flatDirs 声明为"有意平铺"**（那 10 个横切件是终态）
  //      ⇒ 两条声明打架：一边说"散文件是成员"，一边把它们算成"该搬的缺口"。
  //      实测证据：把 `text/` 登记成域的那一刻，读数 待搬 0 → **10**（全是 flat 目录里的成员）。
  const flatSet = new Set(flat.map((f) => f.dir));
  const parents = [...new Set(cfg.domains.map((d) => path.posix.dirname(d.dir)))]
    .filter((p) => !flatSet.has(p))
    .sort();
  for (const parent of parents) {
    for (const name of sourceFileNames(absOf(projectDir, parent))) {
      const stem = name.replace(/\.[^.]*$/, '');
      if (stem === 'index') continue; // 父目录自己的 barrel 合法
      const rel = path.posix.join(parent, name);
      if (unassigned.has(stem)) unlisted.push({ path: rel, note: '在配置的 unassigned 里 —— 归属未定' });
      else misplaced.push({ path: rel, note: `${stem} 没进任何域目录` });
    }
  }

  // ③ flat 目录**不是免检**：它声明了"这里是平铺的"，所以它的子目录必须被登记
  //    ★ 判"子目录已登记"的**方向**很重要：`dd === rel || dd.startsWith(rel + '/')`（登记项在它下面）。
  //      若反向也认（`rel.startsWith(dd + '/')`），flat 自己的 dir 会前缀命中**所有**子目录
  //      ⇒ 6 个未登记容器全部漏报（本判据的出生证就是为抓这个写的）。
  for (const f of flat) {
    const dirAbs = absOf(projectDir, f.dir);
    if (!fs.existsSync(dirAbs)) continue;
    for (const e of fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!e.isDirectory()) continue;
      const rel = path.posix.join(f.dir, e.name);
      if (declaredDirs.some((dd) => dd === rel || dd.startsWith(`${rel}/`))) continue;
      unlisted.push({
        path: `${rel}/`,
        note: `flat 目录 ${f.id}(${f.dir}) 里长出的子目录，没登记 —— 要么给它登记（域，或它自己也是 flat），要么这个目录不该标 flat`,
      });
    }
  }

  return {
    config_path: STRUCTURE_CONFIG_BASENAME,
    domain_count: cfg.domains.length,
    flat_count: flat.length,
    misplaced,
    unlisted,
    missing,
  };
}

/** 顶层入口：读配置（没有则 `configured:false`）→ 对账 → 四态。 */
export function structureGap(projectDir: string): StructureGapResult {
  const cfg = readStructureConfig(projectDir);
  if (!cfg) {
    return {
      configured: false,
      config_path: STRUCTURE_CONFIG_BASENAME,
      domain_count: 0,
      flat_count: 0,
      misplaced: [],
      unlisted: [],
      missing: [],
    };
  }
  return { configured: true, ...computeStructureGap(projectDir, cfg) };
}
