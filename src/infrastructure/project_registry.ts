/**
 * project_registry —— **项目注册表：`feature → 项目根`**（设计出处 `docs/ROOTS.md` §7）
 *
 * ## 为什么需要它（实证 2026-10-26）
 * `storage.ts#getDSL(feature)` **没有 baseDir 参数** ⇒ 它拿不到项目根 ⇒ 只能落到 `getDataHome()`
 * ⇒ **每个 feature 的册都住在 data home 里**。实测：`<review-hub>/.agent-io/design` 不存在，
 * 而 `review-hub.dsl.json` 住在 agent-io 的数据家里；同源后果是 `design-db/` 里混进了 4 个项目。
 *
 * ## 三条裁定（§7.3，已定，不再讨论）
 * ① **全局唯一** —— 跨项目索引**不能**住任何项目里（住进去 ⇒ 那个项目一删全表没了）。
 * ② **不进 git** —— 路径含盘符/用户名，换机器即错；它是"本机登记"，不是设计。
 * ③ **写端 = `import_project`**（唯一）—— 它同时知道 `project_dir` 与 `feature`。
 *
 * ## 形状：扁平 `feature → project_root`
 * 一个 feature **只属于一个**项目根；一个项目有多个 feature 是常态（agent-io 就有 3 个）。
 * ⇒ 扁平表是**函数**（唯一真相），`项目 → features[]` 是**索引**（可现算，不落盘）。
 *
 * ## 读端纪律（§7.4）
 * 查表 ⇒ 命中就用；**不许**"注册表没有就直接读 data home 当默认"——那正是今天分叉的来源。
 * 本文件只提供"查"与"登记"；`getDSL` 的读端接线是下一片（先让产者产）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDataHome, getStorageRoot } from './storage.js';

/** 注册表里的一条：项目根 + 登记痕迹（谁、何时 —— 登记是可考古的事实，不是配置） */
export interface RegistryEntry {
  /** 项目根（绝对路径，`/` 分隔、无尾斜杠） */
  project_root: string;
  /** ISO 时间戳 */
  registered_at: string;
  /** 谁登记的（目前只有 `import_project`） */
  registered_by: string;
}

export interface ProjectRegistry {
  version: number;
  features: Record<string, RegistryEntry>;
}

/** 注册表文件的唯一住址：`<dataHome>/.agent-io/projects.json` */
export function registryFile(): string {
  return path.join(getStorageRoot(), 'projects.json');
}

/** 路径归一（`\` → `/`，去尾斜杠）—— 与 `roots.ts` / `write_gate#nodeFilePath` 同口径 */
export function normRoot(p: string): string {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

/** `project_root` 必须是**绝对**路径：`C:/x`、`C:\x`、UNC `\\srv\share`（posix 上 `/x` 也算）。 */
function isAbsoluteRoot(p: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(p)) return true; // C:/… · C:\…
  if (/^[\\/]{2}[^\\/]/.test(p)) return true; // \\server\share（UNC）
  return process.platform !== 'win32' && p.startsWith('/');
}

/** 能否落到磁盘上**真实存在的目录**（连 stat 都拿不到 ⇒ 也算失效）。 */
function isLiveDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * ★★★ 2026-10-30：**加载自净** —— 注册表记不住"不存在的东西"。
 *
 * ## 为什么（实测两个 footgun）
 * ① **相对路径是歧义源**：`task-system-plan` 的 `project_root` 曾写成 `"."` ⇒ 同一条登记在不同 cwd 下
 *    解析成**不同项目**（当时没出事只是碰巧从包根启动）。⇒ ★ **相对路径一律判坏**：注册表的语义是
 *    "这台机器上的某个**绝对**目录"，相对路径表达不了这件事，留着只会让读端靠 cwd 猜。
 * ② **临时夹具目录会被删**：证/测试跑出的幽灵项目（`t192flow` / `isofix` / `sp` / `tp` …）登记时目录
 *    真实存在，跑完 temp 一删，登记就只剩噪声 ⇒ 而注册表是**总任务视图的钥匙**，脏条目会把跨项目聚合读数弄脏。
 *
 * ## 判据（两条，任一不成立 ⇒ 剪）
 *   · `project_root` 是**绝对路径**；
 *   · `project_root` 现在**是磁盘上一个真实目录**。
 * ⇒ 剪掉后**写回文件**（文件与内存必须一致：只在内存里剪 = 每次读都重剪一遍、读数与文件长期不符），
 *   并且只打**一行** stderr（读一次一行，**不是每条一行** —— 热路径上不许刷屏）。
 * ★ 正常条目**一个都不动**：全部通过时本函数**不写盘、不出声**（原样返回入参对象）。
 */
function pruneStaleEntries(reg: ProjectRegistry, file: string): ProjectRegistry {
  const stale: string[] = [];
  const kept: Record<string, RegistryEntry> = {};
  for (const [feature, entry] of Object.entries(reg.features)) {
    const root = entry && typeof entry.project_root === 'string' ? normRoot(entry.project_root) : '';
    if (!root || !isAbsoluteRoot(root) || !isLiveDir(root)) {
      stale.push(feature);
      continue;
    }
    kept[feature] = entry;
  }
  if (stale.length === 0) return reg;
  process.stderr.write(`[project_registry] 剪掉 ${stale.length} 条失效条目：${stale.join(', ')}\n`);
  const cleaned: ProjectRegistry = { version: reg.version, features: kept };
  try {
    writeRegistry(cleaned);
  } catch (e) {
    process.stderr.write(
      `[project_registry] 失效条目**写回失败**（本次只在内存里剪掉，文件下次加载会再剪一遍）：${file}\n  ${String(
        (e as Error).message,
      ).slice(0, 200)}\n`,
    );
  }
  return cleaned;
}

/**
 * 读注册表。**不存在 ⇒ 返回空表**（不是错误：第一次用还没有任何登记）。
 * ★ 坏文件 ⇒ 也返回空表但**打警告**（不静默：损坏的登记表会让所有 feature 退回旧位置）。
 * ★★ **加载自净**（`pruneStaleEntries`）：每条登记当场校验，失效的剪掉并写回文件 —— 论证见那个函数。
 */
export function readRegistry(): ProjectRegistry {
  const f = registryFile();
  try {
    const raw = fs.readFileSync(f, 'utf8');
    const j = JSON.parse(raw) as Partial<ProjectRegistry>;
    const features = (j.features ?? {}) as Record<string, RegistryEntry>;
    return pruneStaleEntries({ version: typeof j.version === 'number' ? j.version : 1, features }, f);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[project_registry] 注册表读不动（按空表处理，所有 feature 会退回旧位置）：${f}\n  ${String(
          (e as Error).message,
        ).slice(0, 200)}`,
      );
    }
    return { version: 1, features: {} };
  }
}

/** 写注册表（原子：先写 `.tmp` 再 rename，避免半截文件让读端全退回旧位置） */
export function writeRegistry(reg: ProjectRegistry): void {
  const f = registryFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, f);
}

/** 查某个 feature 的项目根（`null` = 没登记）。**这是读端唯一入口**。 */
export function projectRootOf(feature: string): string | null {
  const e = readRegistry().features[feature];
  return e && typeof e.project_root === 'string' && e.project_root ? normRoot(e.project_root) : null;
}

/**
 * 登记 / 更新一个 feature 的项目根（**唯一写端** = `import_project`）。
 * ★ 幂等：根没变就**不写盘**（避免无谓 churn 与 mtime 抖动）。
 * ★ 根**变了** ⇒ 覆盖并保留 `registered_by`，但 `registered_at` 更新（那是"何时改成这样的"）。
 */
export function registerFeature(
  feature: string,
  projectRoot: string,
  by: string,
): { changed: boolean; entry: RegistryEntry } {
  const root = normRoot(projectRoot);
  if (!feature || !root) throw new Error('[project_registry] feature 与 projectRoot 都必填。');
  const reg = readRegistry();
  const prev = reg.features[feature];
  if (prev && normRoot(prev.project_root) === root) {
    return { changed: false, entry: prev };
  }
  const entry: RegistryEntry = {
    project_root: root,
    registered_at: new Date().toISOString(),
    registered_by: by,
  };
  reg.features[feature] = entry;
  writeRegistry(reg);
  return { changed: true, entry };
}
