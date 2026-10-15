/**
 * DSL 持久化
 *
 * 存储路径：
 *   1. <cwd>/.agent-io/features/<feature>.json —— 各 feature 历史存档
 *   2. <cwd>/agent-io.json —— 当前活态 DSL（LLM 和浏览器共享）
 *
 * 双向同步机制：
 *   - LLM 调用 saveDSL → 同时更新 agent-io.json
 *   - 浏览器启动时 → 读取 agent-io.json 覆盖本地状态
 *   - 人调整画布 → localStorage 暂存 + 可导出 agent-io.json
 */

import { DATA_DIR_NAME, PKG_NAME } from './data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesignDSL } from '../domain/types.js';

/**
 * agent-io 包根：从模块自身位置**按路标上溯**（找 `package.json` 且 `name === PKG_NAME` 的目录）。
 * ★ 2026-09-30：本文件从 `src/storage.ts` 搬到 `src/infrastructure/storage.ts`（深了一层）——
 *   **实现无需改**，因为它本来就按路标找、而不是数层级。
 *   （对照：同一天 `slim_brick.ts` / `daemon.ts` 用的是「上溯 N 级」⇒ 各翻车一次，见台账 §44.11）
 * 向上找最近的 package.json 且 name==="agent-io" 的目录。
 *
 * 与 cwd 无关：MCP server / serve / daemon 可能由任意 cwd 拉起
 * （TRAE/Claude 等 client 常以工作区根为用户目录作为 stdio 子进程 cwd），
 * 若 dataHome 裸依赖 process.cwd()，会把 features 存档 + 活态 DSL 错位写到
 * 工作区根，甚至把其它项目的 go-* 文件并进本 feature 的边（"146 条 flows 污染"根因）。
 * 这里自省锚定，保证设计数据永远落在 agent-io 自身安装根。
 */
export function getPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.dirname(dir)) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const j = JSON.parse(fs.readFileSync(pkg, 'utf-8')) as { name?: string };
        if (j.name === PKG_NAME) return dir;
      } catch {
        /* 忽略损坏的 package.json */
      }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * 数据主目录：所有持久化路径的根
 *
 * 优先级：
 *   1. AGENT_IO_HOME（测试/显式覆盖用，最高优先）
 *   2. agent-io 包根（getPackageRoot，从模块位置自省，cwd 无关，稳定）
 *   3. process.cwd()（自省失败的最末端兜底）
 *
 * 注意：必须在调用时读取 env（不能模块加载时缓存），保证 vitest setup 生效。
 */
export function getDataHome(): string {
  if (process.env.AGENT_IO_HOME) return process.env.AGENT_IO_HOME;
  return getPackageRoot();
}

/** 设计存储根目录：<dataHome>/.agent-io */
export function getStorageRoot(): string {
  return path.join(getDataHome(), DATA_DIR_NAME);
}

/**
 * ★★ 取「**被分析项目的根**」—— 只接受**同语义**的候选，**绝不兜底到 `cwd`**。
 *
 * ─────────────────────────────────────────────────────────────
 * 由来：用户 2026-10-01 一句「**越兜越多**」
 * ─────────────────────────────────────────────────────────────
 * `dsl.source_root ?? process.cwd()` 看起来是"退而求其次"，**其实是换题** ——
 * `cwd` 与被分析项目**没有任何关系**：它不是"更弱的答案"，是**另一个项目的答案**。
 * 拿它兜底 ⇒ 一个没有索引的项目会**静默读到 `cwd` 那个项目的数据**。
 * 而且**兜底会自我繁殖**：因为"反正总有一个能用"，就没人去保证**正确的那个**存在。
 *
 * ★ 判据（照这个分，**不要照"有没有 `??`"分**）：
 * | 写法 | 性质 | 处置 |
 * |---|---|---|
 * | `baseDir ?? getDataHome()` | **默认值**（dataHome 是这份数据的合法归属，同一件事） | 留 |
 * | `input.source_root ?? input.project_dir` | **两个来源、一个语义**（都是"被分析项目的根"） | 留 |
 * | `xxx ?? process.cwd()` | ★★ **换题** | **删掉 ⇒ 改成本函数（硬失败）** |
 *
 * ★ 为什么**硬失败**才是对的：**响亮是接上溯源的前提** ——
 * 只有"缺"得响亮，才知道该补**哪一道工序**（"缺了就往上溯源"那道链 = T19 第 (4) 步）。
 * 在那之前，"静默给出别人的数据"比"报错"坏得多。
 */
export function requireProjectRoot(cands: Record<string, unknown>): string {
  for (const [label, v] of Object.entries(cands)) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  throw new Error(
    `缺少「被分析项目的根」：${Object.keys(cands).join(' / ')} 都是空的。\n` +
      `★ 这里**故意不兜底到 cwd** —— cwd 是"另一个项目"，不是"更弱的答案"。\n` +
      `请显式传项目根（import_project 会把它持久化进 DSL 的 source_root）。`,
  );
}

/**
 * feature 持久化目录：**`<dataHome>/.agent-io/features`**。
 * ★ 2026-10-01 修注释：原文写的是 `<cwd>/.agent-io/features` —— **与实现不符**（实现一直走
 *   `getStorageRoot()` = dataHome）。错注释本身就是一种"判据分叉"：它会让读者照着 `<cwd>` 去读。
 */
export function getFeaturesDir(): string {
  return path.join(getStorageRoot(), 'features');
}

/** 活态 DSL 文件：<dataHome>/agent-io.json */
export function getLiveDslFile(): string {
  return path.join(getDataHome(), 'agent-io.json');
}

/** 单个 feature 文件路径 */
export function getFeatureFile(feature: string): string {
  // 防止路径穿越：feature 名必须匹配 [a-zA-Z0-9_-]
  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  return path.join(getFeaturesDir(), `${feature}.json`);
}

/** 实际 DSL 目录（动态快照）：<dataHome>/.agent-io/live */
export function getLiveDir(baseDir?: string): string {
  // ★ `baseDir ?? getDataHome()` 是**默认值**、不是兜底（判据见 `requireProjectRoot` 上方那张表）：
  //   dataHome 是这份数据的**合法归属**（同一件事），而 `?? process.cwd()` 是**换题**。
  return path.join(baseDir ?? getDataHome(), DATA_DIR_NAME, 'live');
}

/** 实际 DSL 文件路径：<dataHome>/.agent-io/live/<feature>.dsl.json */
export function getLiveFeatureFile(feature: string, baseDir?: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  return path.join(getLiveDir(baseDir), `${feature}.dsl.json`);
}

/** 保存实际 DSL（动态快照，带 _sync 标记；不触发 dslChangeCallback，避免打扰设计视图刷新）
 *  baseDir 可选：指定写入的项目根（默认 dataHome）。watch_project 监听任意项目时传 project_dir，
 *  使实际 DSL 与该项目 cache.db 同目录归位。 */
export function saveLiveFeature(dsl: DesignDSL, baseDir?: string): string {
  const dir = getLiveDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = getLiveFeatureFile(dsl.feature, baseDir);
  const data = {
    ...dsl,
    _sync: { saved_at: new Date().toISOString(), source: 'live', feature: dsl.feature },
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

/** 读取实际 DSL，不存在返回 null */
export function getLiveFeature(feature: string, baseDir?: string): DesignDSL | null {
  const file = getLiveFeatureFile(feature, baseDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DesignDSL;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// ★★★ 「设计那一侧」的**独立住处**（2026-10-15）：<dataHome>/.agent-io/design/<feature>.dsl.json
//
// ## 它要解决什么（用户逐字）
//   *"机器只能算出它的那些 DSL，我的意思是让你手写一份和机器算出来的东西同一性质的东西，
//     只不过那个是机器算出来的，而你是对于项目的一个设计。"*
//   ⇒ **两份同性质的 DSL**、**直接对拍**：`live/<f>.dsl.json`（扫描产物）vs `design/<f>.dsl.json`（手写设计）。
//
// ## 为什么必须是**独立文件**（而不是往 overlay 里加）
//   overlay 的锚点**按扫描 id 对齐** ⇒ 它**只能改扫描认得出的对象、声明不了新结构**：
//   实测往设计里 `node/add` 一个现状不存在的节点 ⇒ `import_project` 重建时被 `allow_design_drop` 拦、
//   归 `orphaned`、**没了**（见 `graph/import_project.ts` 的 `willDrop` 那一段）。
//   ★ 独立文件与 overlay **并存、互不干扰**：overlay 继续管"同名节点的属性补丁"，本文件管"**结构层**"。
//   ★ 且 `import_project` 的**任何**分支都**不写这个目录**（重建不碰它）——
//     判据（实测）见 `certs/t337-design-sheet-cert.mjs`：`rebuild_design=true` 前后文件逐字节相同。
//
// ## schema：**与 `live/<f>.dsl.json` 同 schema**
//   同一个 `DesignDSL`（`domain/types.ts`），同样附 `_sync` 标记 —— ★ 刻意**不另发明字段**：
//   两份要"同性质"才谈得上对拍（自己发明的字段 = 让对拍从第一步就不可比）。
// ─────────────────────────────────────────────────────────────

/** 设计图目录：<baseDir>/.agent-io/design（与 live/ baseline/ 同族） */
export function getDesignDir(baseDir?: string): string {
  return path.join(baseDir ?? getDataHome(), DATA_DIR_NAME, 'design');
}

/** 设计图文件路径：<baseDir>/.agent-io/design/<feature>.dsl.json（★ 与 live/<f>.dsl.json 同 schema） */
export function getDesignSheetFile(feature: string, baseDir?: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  return path.join(getDesignDir(baseDir), `${feature}.dsl.json`);
}

/** 保存设计图（**手写**那一份；带 `_sync` 标记，与 `saveLiveFeature` 同形 ⇒ 两份文件形状一致） */
export function saveDesignSheet(dsl: DesignDSL, baseDir?: string): string {
  const dir = getDesignDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = getDesignSheetFile(dsl.feature, baseDir);
  const data = {
    ...dsl,
    _sync: { saved_at: new Date().toISOString(), source: 'design_sheet', feature: dsl.feature },
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

/** 读取设计图，不存在返回 null */
export function getDesignSheet(feature: string, baseDir?: string): DesignDSL | null {
  const file = getDesignSheetFile(feature, baseDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DesignDSL;
  } catch {
    return null;
  }
}

/**
 * 基线（baseline）快照存储：契约创立时刻的参考基准。
 *
 * Git 语义：首次为一个 feature 生成 live 快照时，顺带把同一份 DSL 写入 baseline/，
 * 作为「共同祖先」。之后 live 随代码演进持续更新、设计 DSL 随意图演进修改，
 * 两者都相对 baseline 各自前进。diff_views 的三方对比据此裁决：
 *   - baseline → design = 意图增量
 *   - baseline → live   = 实现增量
 *   - 两侧都改动且不一致 = 冲突（交 LLM 裁决）
 *
 * baseline 只在首次 fork 时写入，绝不随 live/design 更新而移动（除非显式重建），
 * 与 baseDir 归位规则和 live 一致（watch_project 监听任意项目时传 project_dir）。
 */
export function getBaselineDir(baseDir?: string): string {
  // ★ `baseDir ?? getDataHome()` 是**默认值**、不是兜底（判据见 `requireProjectRoot` 上方那张表）：
  //   dataHome 是这份数据的**合法归属**（同一件事），而 `?? process.cwd()` 是**换题**。
  return path.join(baseDir ?? getDataHome(), DATA_DIR_NAME, 'baseline');
}

/** 基线 DSL 文件路径：<dataHome>/.agent-io/baseline/<feature>.dsl.json */
export function getBaselineFeatureFile(feature: string, baseDir?: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  return path.join(getBaselineDir(baseDir), `${feature}.dsl.json`);
}

// ─────────────────────────────────────────────────────────────
// ★★★ 「对拍」的第二份产物：**基线事实**（2026-10-09，T85/D2）
//
// ## 为什么必须有它（用户 2026-10-09 的原话）
//   *"你的意思是这两个产物没有分开是吗？**那要赶紧分开啊**。当时我不是说了**对拍**吗？
//     怎么可能对拍还放在同一个里面？**那这算什么对拍？自己测自己吗？**"*
//   ⇒ ★ **说得对**：对拍的**前提是两份产物**。而在此之前，对账的"期望侧"取的是
//     **`<feature>.json`（设计 DSL）里的 `expected_apis`** —— 那**恰恰是同一个东西**（fork 时复制过去的）
//     ⇒ **自己跟自己比** ⇒ 代码没变时要么恒 0、要么一堆假差异。
//
// ## 两份产物各自是什么（**不许混**）
//   · **基线事实**（本文件）= **fork 那一刻**的事实快照 —— ★ **一旦落盘就不再变**（除非重新 fork）；
//   · **现取事实** = `infrastructure/index/file_facts.ts` 的 `fileFacts(root, rel)`（此刻）。
//   ⇒ **对拍 = 这两者比** ⇒ 同窗口（代码未变）应 **0**；代码改了才有差异。
//   ★ 而"**人写的意图**"（DSL 里的 `expected_apis`，`edit_dsl type=api` 写）是**第三条线** ——
//     它与事实比才是"**设计 vs 实现**"。★ 三条线**各有各的问题**，混着比就是假差异（这就是 T85 的病根）。
//
// ## 为什么这份快照**不能**从 DSL 里取
//   ★ 那正是"自己测自己"。它必须**独立取**（`fileFacts` = 索引器的事实），
//     且取的时刻 = **fork 那一刻**（`import_project` 刚写完索引 ⇒ 索引与源码同期 ✓）。
// ─────────────────────────────────────────────────────────────

/** 基线事实文件（`baseline/<feature>.facts.json`）—— ★ **对拍的两份产物之一** */
export interface BaselineFactsFile {
  version: 1;
  feature: string;
  saved_at: string;
  /** 取这份事实时用的项目根（★ 事实的"出处"，与 `DSL.source_root` 同源） */
  source_root: string;
  /** 仓库相对路径 → **那一刻**的事实（API 签名 + 依赖） */
  files: Record<string, { apis: string[]; deps: string[] }>;
}

/** 基线事实文件路径（与 `.dsl.json` 并列，**同目录、同名族**） */
export function getBaselineFactsFile(feature: string, baseDir?: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  return path.join(getBaselineDir(baseDir), `${feature}.facts.json`);
}

/** 读取基线事实；不存在返回 `null`（★ 老 feature 没有它 ⇒ 调用方要能处理"没有基线事实"） */
export function getBaselineFacts(feature: string, baseDir?: string): BaselineFactsFile | null {
  const file = getBaselineFactsFile(feature, baseDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BaselineFactsFile;
  } catch {
    // ★ 坏了**抛**（不返回 null 冒作"没有"）—— 把"文件损坏"和"还没有"混成一个值，
    //   会让对拍静默地以为"没基线"⇒ 那正是本仓禁止的失败模式。
    throw new Error(`基线事实文件损坏：${file}（请重新 import_project 重建）`);
  }
}

/**
 * 写基线事实（**只在缺失时写**，与 `ensureBaseline` 同策：基线是"共同祖先"，**绝不漂移**）。
 *
 * ★ 事实来源**必须是 `fileFacts`**（索引器）—— **不许从 DSL 取**（那是"自己测自己"）。
 * ★ 取不到事实的文件**不写空条目**（省略 = 那时它没有事实），并在返回值里报出数量便于对账。
 */
export function saveBaselineFactsIfAbsent(
  feature: string,
  sourceRoot: string,
  rels: readonly string[],
  readFacts: (rel: string) => { apis: readonly string[]; deps: readonly string[] },
  baseDir?: string,
): { written: boolean; file: string; files: number } {
  const file = getBaselineFactsFile(feature, baseDir);
  if (fs.existsSync(file)) return { written: false, file, files: 0 };
  const files: BaselineFactsFile['files'] = {};
  for (const rel of rels) {
    const f = readFacts(rel);
    if (f.apis.length === 0 && f.deps.length === 0) continue;
    files[rel] = { apis: [...f.apis], deps: [...f.deps] };
  }
  const data: BaselineFactsFile = {
    version: 1,
    feature,
    saved_at: new Date().toISOString(),
    source_root: sourceRoot,
    files,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return { written: true, file, files: Object.keys(files).length };
}

/** 保存基线 DSL（带 _sync 标记；不触发 dslChangeCallback，避免打扰设计视图刷新） */
export function saveBaselineFeature(dsl: DesignDSL, baseDir?: string): string {
  const dir = getBaselineDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = getBaselineFeatureFile(dsl.feature, baseDir);
  const data = {
    ...dsl,
    _sync: { saved_at: new Date().toISOString(), source: 'baseline', feature: dsl.feature },
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

/** 读取基线 DSL，不存在返回 null */
export function getBaselineFeature(feature: string, baseDir?: string): DesignDSL | null {
  const file = getBaselineFeatureFile(feature, baseDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DesignDSL;
  } catch {
    return null;
  }
}

/**
 * 视图（`live` / `baseline`）的**取根候选链**（顺序 = 优先级）：`explicit` > DSL 的 `source_root` > `dataHome`。
 *
 * ★★ 2026-10-06（T19）：这是「根从哪来」的**唯一单点**。
 *
 * ## 为什么是**候选链**，而不是"选一个根"
 * 写侧有两种模式，**都真实存在**：
 *   · **落 `dataHome`**：`import_project` 未传 `live_dir`（★ 实测本仓 4 个 feature **全是这种**：
 *     `live` / `baseline` 都在 `<dataHome>/.agent-io/`，而 `dsl.source_root` 指向的仓里**没有**）；
 *   · **落项目根**：传了 `live_dir`（`watch_project` 监听任意项目时 = 那个项目的根，
 *     见 `saveLiveFeature` 的注释）。
 *   ⇒ 任何"二选一猜一个"都必然让**另一种模式读不到**。
 *   ★★ 本笔正是**修正我自己上一版**：上一版写成" `explicit` 否则 `dsl.source_root`"这个**二选一**，
 *   实测把上面**第一种（更常见的）模式读成了 `null`** —— `getDSLByView(feature, 'live')` 由「读到」变「读不到」。
 *   ⇒ 正解 = 与 `db.ts#findCacheDb`（两级锚、**取第一个存在的**）、`defaultEventsCandidates`（录制事件候选）
 *   **同一形状**：列候选、**取第一个"文件存在"的**。
 *
 * ## 边界（写清，免得再被"统一"掉）
 * · **读** ⇒ {@link getLiveFeatureResolved} / {@link getBaselineFeatureResolved}（按候选链取第一个存在的）；
 * · **写** ⇒ **不新造落点**：已有就写在它已在的那处，都没有才落 `dataHome`（见 `stage_registry` 的 `produce`）；
 * · **删** ⇒ 候选链上**每一处都删**（`deleteFeature`）—— 删除的语义是"**一处都不留**"。
 */
export function viewBaseDirCandidates(feature: string, explicit?: string): string[] {
  const out: string[] = [];
  if (explicit) out.push(explicit);
  const sr = getDSL(feature)?.source_root;
  if (sr) out.push(sr);
  out.push(getDataHome());
  return [...new Set(out.map((d) => path.resolve(d)))];
}

/** 按候选链读某个视图文件：**取第一个"文件存在"的根**；都没有 ⇒ `null`（不抛，容忍度与改前一致）。 */
function readViewAtCandidates<T>(
  feature: string,
  explicit: string | undefined,
  fileAt: (base: string) => string,
  readAt: (base: string) => T | null,
): T | null {
  for (const base of viewBaseDirCandidates(feature, explicit)) {
    if (fs.existsSync(fileAt(base))) return readAt(base);
  }
  return null;
}

/** 读 `live` 视图（**按候选链找**，不猜单一根）。 */
export function getLiveFeatureResolved(feature: string, explicit?: string): DesignDSL | null {
  return readViewAtCandidates(feature, explicit, (b) => getLiveFeatureFile(feature, b), (b) => getLiveFeature(feature, b));
}

/** 读 `baseline` 视图（**按候选链找**，不猜单一根）。 */
export function getBaselineFeatureResolved(feature: string, explicit?: string): DesignDSL | null {
  return readViewAtCandidates(feature, explicit, (b) => getBaselineFeatureFile(feature, b), (b) => getBaselineFeature(feature, b));
}

/**
 * fork 基线：仅在基线尚不存在时写入（契约创立时刻的一次性快照）。
 * 已在 live 更新（import/watch）时调用，保证基线锚定首次导入，不随代码演进漂移。
 */
export function ensureBaseline(dsl: DesignDSL, baseDir?: string): void {
  if (getBaselineFeature(dsl.feature, baseDir)) return;
  saveBaselineFeature(dsl, baseDir);
}

// ─────────────────────────────────────────────
// 下线库（archive）：孤立节点的历史研究材料
//
// Git 语义：基线是"共同祖先"，archive 是"reflog/存档分支"。
// 文件/符号真弃用（非合并、非被取代）时归档到这里——挂既往决策卡 + 为什么下线，
// 之后不再参与周边联系（diff 主体忽略它），但 diff 到 removed/deleted_from_live
// 时可按需查询：LLM 裁决"这个删除是否合理"时能读到"当初为什么这么设计"。
// 每个条目 = 归档时刻的完整 DSL 快照 + 元数据（retire_reason / merged_into）。
// ─────────────────────────────────────────────

/** 下线库归档条目 */
export interface ArchiveEntry {
  /** 条目 id（默认 `${feature}__${sanitize(file_path)}`，feature 级归档用 `${feature}__feature`） */
  id?: string;
  /** 所属 feature */
  feature: string;
  /** 归档的文件相对路径（"" = 整个 feature 级归档） */
  file_path: string;
  /** 归档时刻的 DSL 快照（含该文件/符号的决策卡，作为历史研究材料） */
  dsl: DesignDSL;
  /** 为什么下线（孤立原因，必填） */
  retire_reason: string;
  /** 若下线是合并（两文件合一），记录合并目标文件路径 */
  merged_into?: string;
  /** 归档时间（ISO 8601） */
  archived_at: string;
}

/** 下线库目录：<baseDir>/.agent-io/archive/<feature>/ */
export function getArchiveDir(feature: string, baseDir?: string): string {
  // ★ `baseDir ?? getDataHome()` 是**默认值**、不是兜底（判据见 `requireProjectRoot` 上方那张表）：
  //   dataHome 是这份数据的**合法归属**（同一件事），而 `?? process.cwd()` 是**换题**。
  return path.join(baseDir ?? getDataHome(), DATA_DIR_NAME, 'archive', feature);
}

/** 归档条目文件路径 */
export function getArchiveEntryFile(feature: string, entryId: string, baseDir?: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(entryId)) {
    throw new Error(`非法归档条目 id: "${entryId}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  return path.join(getArchiveDir(feature, baseDir), `${entryId}.json`);
}

/** 路径 → 安全条目 id（非 [a-zA-Z0-9_-] 一律转 _） */
function sanitizeEntryId(p: string): string {
  const s = p.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return s.length > 0 ? s : 'feature';
}

/** 保存归档条目（id 缺省自动生成），返回条目 id */
export function saveArchiveEntry(entry: ArchiveEntry, baseDir?: string): string {
  const id = entry.id ?? `${entry.feature}__${sanitizeEntryId(entry.file_path || 'feature')}`;
  const file = getArchiveEntryFile(entry.feature, id, baseDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...entry, id, archived_at: entry.archived_at ?? new Date().toISOString() }, null, 2), 'utf-8');
  return id;
}

/** 列出某 feature 的全部归档条目（无则空数组） */
export function listArchiveEntries(feature: string, baseDir?: string): ArchiveEntry[] {
  const dir = getArchiveDir(feature, baseDir);
  if (!fs.existsSync(dir)) return [];
  const entries: ArchiveEntry[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      entries.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as ArchiveEntry);
    } catch {
      /* 跳过损坏条目 */
    }
  }
  return entries.sort((a, b) => (a.archived_at ?? '').localeCompare(b.archived_at ?? ''));
}

/** 读取某 feature 归档中某文件的条目（按 file_path 匹配，无则 null） */
export function getArchiveEntryByPath(feature: string, filePath: string, baseDir?: string): ArchiveEntry | null {
  return listArchiveEntries(feature, baseDir).find((e) => e.file_path === filePath) ?? null;
}

/** 删除某 feature 的全部归档（manage_feature 删除时连带清理） */
export function clearArchiveEntries(feature: string, baseDir?: string): void {
  const dir = getArchiveDir(feature, baseDir);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/** 确保 features 目录存在 */
function ensureFeaturesDir(): void {
  fs.mkdirSync(getFeaturesDir(), { recursive: true });
}

/** DSL 变更回调（serve.ts 注册后，saveDSL 会触发） */
type DslChangeCallback = (feature: string, source: string) => void;
let dslChangeCallback: DslChangeCallback | null = null;

/** 注册 DSL 变更回调（serve.ts 调用） */
export function onDslChange(cb: DslChangeCallback): void {
  dslChangeCallback = cb;
}

/** 保存 DSL（覆盖），同时同步到活态文件
 *  source: 'mcp'（LLM 工具调用）| 'browser'（浏览器端保存）
 *  传入 source 决定 SSE 广播的来源标记，浏览器据此跳过自身触发的刷新
 *  base_dsl_rev 可选乐观锁：非 undefined 时要求磁盘当前 rev === base_dsl_rev，
 *  否则视为并发冲突抛错（最后写者胜 → 拒绝，防多会话丢改动）。
 *  省略则不做校验（保留旧直写语义，兼容既有 30 处调用）。
 */
export function saveDSL(dsl: DesignDSL, source: string = 'mcp', base_dsl_rev?: number): string {
  ensureFeaturesDir();
  // 乐观锁：读当前 rev 对比 base
  if (base_dsl_rev !== undefined) {
    const cur = currentDslRev(dsl.feature);
    if (cur !== base_dsl_rev) {
      throw new Error(
        `DSL 冲突：feature "${dsl.feature}" 已被他人更新（当前 rev ${cur}，你的 base rev ${base_dsl_rev}）。` +
          `请重新 get_dsl 拉取最新，在最新基础上重做你的改动，勿直接覆盖。`,
      );
    }
  }
  // 自增 rev（权威写经此落盘）
  const nextRev = (base_dsl_rev ?? currentDslRev(dsl.feature)) + 1;
  dsl._dsl_rev = nextRev;
  const file = getFeatureFile(dsl.feature);
  // ★★★ 2026-10-12（T188）：**改成原子写**（临时文件 + rename）—— 治的是 M4 的**根因**。
  //   为什么必须：本函数原先用**裸 `writeFileSync`** 直写目标文件（全仓 `renameSync` **0** 处）
  //   ⇒ ★ **写不是原子的**：看护进程（watch/daemon）写的时候，并发的读**可能读到半截**
  //     ⇒ `JSON.parse` 失败 ⇒ 调用方走 `getDSL` 的**静默回退**（`storage.ts:531` 那个 catch）。
  //   ★★ 于是这里有个**反直觉的结论**（我核过才敢写）：那个 catch 处**不能"失败就抛"** ——
  //     在**非原子写**的前提下抛，会把"**并发读撞上写入**"这个**正常现象**变成报错。
  //   ⇒ 正确次序是**先让写变原子**（消除"半截"这个可能），那个 catch 才只剩"**真损坏**"一种含义。
  //   ★ 同目录内 rename ⇒ 同文件系统 ⇒ 原子（POSIX 语义；Windows 的 `rename` 覆盖已存在文件
  //     在 Node 上走 `MoveFileEx`，对"同目录换名"同样是原子的）。
  const writeAtomic = (target: string, text: string): void => {
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, target);
  };
  writeAtomic(file, JSON.stringify(dsl, null, 2));

  // 同步到活态文件（带时间戳，方便 diff）
  const liveFile = getLiveDslFile();
  const liveData = {
    ...dsl,
    _sync: {
      saved_at: new Date().toISOString(),
      source: source,
      feature: dsl.feature,
    },
  };
  // ★ T188：活态文件同样走原子写 —— ★ 它**正是**那个被并发读的目标（`getDSL` 优先读它）。
  writeAtomic(liveFile, JSON.stringify(liveData, null, 2));

  // 触发 SSE 通知（用传入的 source，避免浏览器保存被误判为 mcp 触发 reload）
  if (dslChangeCallback) {
    try { dslChangeCallback(dsl.feature, source); } catch { /* ignore */ }
  }

  return file;
}

/**
 * ★ T188：**最近一次"活态 DSL 读不了 ⇒ 回退到存档"**的记录（没有则 `null`）。
 * ★ 为什么要它：那次回退**会改变你读到的内容**（可能是**较旧**的一份），
 *   而此前它**完全静默**（§2.3「不报错的错」）。⇒ 现在**记下来 + 一次性 stderr 提示**。
 * ★ 未做（登记在账）：把它接进 MCP 的告警通道（`tool_warnings`）——
 *   那需要一层注入（infrastructure 不许 import presentation，先例是 `dslChangeCallback`）。
 */
let lastLiveFallback: { file: string; error: string; at: string } | null = null;
let liveFallbackWarned = false;

/** 读最近一次"活态回退"记录（`null` = 本进程没发生过）。 */
export function getLiveFallback(): { file: string; error: string; at: string } | null {
  return lastLiveFallback;
}

/**
 * ★ T190：**活态文件现在还能不能解析** —— 给告警做**自清**用。
 *
 * ## 为什么要它（★ 我第一版漏了这一步）
 * `lastLiveFallback` 是**一条历史记录**，它**不会自己消失** ⇒ 若告警只读记录，就会
 * **粘住不放**：活态文件被修好之后，读者仍会一直被告知"你读到的可能是旧的"。
 * ★ 而同族先例是**自清**的：`staleSourceWarning` **每次都重算 mtime**（不存状态位 ——
 * 那个状态位当年正是因为"把持续陈旧变成**永久静默**"而被删；这里是**另一个方向**的错：
 * 把**已恢复**说成**仍然坏着**）。
 * ⇒ 判据：**告警说"现在读到的可能旧" ⇒ 它必须反映【现在】。**
 *
 * ★ 只判"**能不能 JSON.parse**"，**不碰** `feature` 比对 —— 那是"这份活态不是本 feature 的"
 * （**正常**情形，不是损坏）⇒ 混进来会误报。判据**就这一处**（`readLiveDsl` 的回退分支也用它）。
 */
export function isLiveDslParseable(): boolean {
  const f = getLiveDslFile();
  if (!fs.existsSync(f)) return true; // 没有活态文件 ≠ 损坏（下次 saveDSL 会建）
  try {
    JSON.parse(fs.readFileSync(f, 'utf-8'));
    return true;
  } catch {
    return false;
  }
}

/** 当前磁盘 rev：优先活态文件，回退 feature 存档，缺失为 0 */
function currentDslRev(feature: string): number {
  return getDSL(feature)?._dsl_rev ?? 0;
}

/** 读取 DSL，不存在返回 null。优先读取活态文件 */
export function getDSL(feature: string): DesignDSL | null {
  // 优先读取活态文件（LLM 最新修改）
  const liveFile = getLiveDslFile();
  if (fs.existsSync(liveFile)) {
    try {
      const liveContent = fs.readFileSync(liveFile, 'utf-8');
      const liveData = JSON.parse(liveContent);
      if (liveData.feature === feature) {
        return liveData as DesignDSL;
      }
    } catch (e) {
      // ★★★ 2026-10-12（T188）修 M4「**静默**回退」—— 此前这里只有一个注释，**外部一个字都看不到**。
      //
      // ## 为什么"抛"在这**不成立**（★ 我核过才敢这么写，别照着 doctrine 顺手改成 throw）
      // · 活态文件是**全局单文件**（`agent-io.json`），装的是**最后一次 saveDSL** 的那个 feature
      //   ⇒ ★ 它损坏时**它可能根本不属于当前 feature** ⇒ 抛会让**所有 feature 一起挂**。
      // · ★ 而且**写侧原先不是原子的**（裸 `writeFileSync`）：并发读**可能读到半截**
      //   ⇒ 在那种前提下抛，会把"**撞上写入**"这个正常现象变成报错。
      //   ★★ 该根因已在 `saveDSL` 里治掉（改成 临时文件 + `renameSync` 原子写）——
      //      ⇒ 于是**到这里就只剩"真损坏"一种含义**了，这才轮得到"要不要更响"。
      // · ★ 本仓先例也不是"一律抛"：`fileFacts` 对"**缺** db"返回空、对"**损坏**"才抛
      //   —— 判据是"**这份数据是不是我这一份**"。（这里答不了，所以不抛。）
      //
      // ## 所以处置 = **保可用 + 不静默**
      //   回退照旧（可用性不能拿来赌），但**把这件事记下来并说出来**（一次性，免得刷屏）。
      lastLiveFallback = { file: liveFile, error: (e as Error).message, at: new Date().toISOString() };
      if (!liveFallbackWarned) {
        liveFallbackWarned = true;
        console.error(
          `[agent-io] ⚠ **活态 DSL 读不了，已回退到 feature 存档**（★ 你刚读到的可能是**较旧的一份**）：\n` +
            `    ${liveFile}\n    ${(e as Error).message}\n` +
            '  ★ 处置：确认没有并发写入后删掉该活态文件（下次 saveDSL 会重建），或跑一次 import_project 重扫。\n' +
            `  ★ 本次进程内只提示这一次（避免刷屏）；后续可从 getLiveFallback() 读到这条记录。`,
        );
      }
    }
  }

  // 回退到 feature 存档文件
  const file = getFeatureFile(feature);
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf-8');
  return JSON.parse(content) as DesignDSL;
}

/** 视图层级：design=设计视图（活态文件+存档），live=实际视图（代码快照，只读） */
export type DSLView = 'design' | 'live';

/**
 * 按视图统一读取 DSL 入口（收敛 Step 2.5 视图分层护栏）
 * - design：走 getDSL（活态文件 + feature 存档），即现状默认路径
 * - live：走 getLiveFeature（实际代码快照，只读），用于对比"设计 vs 代码现状"
 */
export function getDSLByView(feature: string, view: DSLView = 'design'): DesignDSL | null {
  // ★★ 2026-10-06（T19 收口）：读 `live` 视图时**不再裸调 `getLiveFeature(feature)`** ——
  //   那会落 `dataHome`，而**写侧（`import_project`）可能把它写在被监听项目的根**
  //   （`watch_project` 监听任意项目时）⇒ **静默读不到**（隔离实测复现：返回 null，不抛）。
  //   ⇒ 改用**候选链** `getLiveFeatureResolved`（`explicit` > `dsl.source_root` > `dataHome`，取第一个存在的）。
  //   ★ 本函数**一处修、四处受益**：调用方有 `derive_feature_tree`（live 语义基准）·
  //     `diffFeatures`（view_a/view_b）· `query_feature`（`view` 入参）· `design` handlers。
  return view === 'live' ? getLiveFeatureResolved(feature) : getDSL(feature);
}

/** 列出所有已保存的 feature，按 feature 名升序 */
export function listFeatures(): DesignDSL[] {
  const dir = getFeaturesDir();
  if (!fs.existsSync(dir)) return [];
  // 排除 overlay 覆盖文件（<feature>.overlay.json 非完整 DSL，无 id/status，混入会被当成幽灵 feature）
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.overlay.json'));
  const dsls: DesignDSL[] = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      const dsl = JSON.parse(content) as DesignDSL;
      // 防御：损坏/遗留存档可能缺 feature 名（排序 localeCompare 会崩），丢弃
      if (!dsl || typeof dsl.feature !== 'string' || dsl.feature.length === 0) continue;
      dsls.push(dsl);
    } catch {
      // 跳过无法解析的文件
    }
  }
  return dsls.sort((a, b) => a.feature.localeCompare(b.feature));
}

/**
 * 完整删除 feature（manage_feature action=delete 用）：
 * 1. 删 feature 存档文件
 * 2. 删该 feature 的实际代码快照（live/<f>.dsl.json）
 * 3. 若活态文件（agent-io.json）当前对应此 feature，一并删除，避免残留陈旧活态视图
 */
export function deleteFeature(feature: string): void {
  // ★ 先算**视图根的候选链**（它要反查 `getDSL(feature).source_root`）—— 必须赶在下面删掉
  //   feature 存档**之前**算，否则反查不到、又只剩 `dataHome` 一处（就是原来的 bug）。
  const viewBases = viewBaseDirCandidates(feature);
  const file = getFeatureFile(feature);
  if (fs.existsSync(file)) fs.unlinkSync(file);

  // 连带删除该 feature 的 overlay 覆盖文件，避免删除后残留陈旧 overlay
  const overlayFile = path.join(getFeaturesDir(), `${feature}.overlay.json`);
  if (fs.existsSync(overlayFile)) fs.unlinkSync(overlayFile);

  // ★★ 2026-10-06（T19）：live / baseline **候选链上每一处都删** —— 原先只删
  //   `getLiveFeatureFile(feature)`（隐含 `dataHome`）⇒ 快照若落在被监听项目的根（传过 `live_dir`
  //   的那种模式）就**删不到、留残**。删除的语义就是"**一处都不留**"。
  for (const base of viewBases) {
    const liveFile = getLiveFeatureFile(feature, base);
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);
    const baselineFile = getBaselineFeatureFile(feature, base);
    if (fs.existsSync(baselineFile)) fs.unlinkSync(baselineFile);
  }

  // 连带删除下线库归档（孤立节点的历史研究材料）
  clearArchiveEntries(feature);

  const liveDsl = getLiveDslFile();
  if (fs.existsSync(liveDsl)) {
    try {
      const data = JSON.parse(fs.readFileSync(liveDsl, 'utf-8'));
      if (data.feature === feature) fs.unlinkSync(liveDsl);
    } catch {
      // 活态文件损坏则忽略，不阻塞删除主流程
    }
  }
}

/** 清空所有 feature（用于测试清理） */
export function clearAllFeatures(): void {
  const dir = getFeaturesDir();
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));
  }
}
