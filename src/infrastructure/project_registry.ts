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
import { getStorageRoot } from './storage.js';

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

// ════════════════════════════════════════════════════════════════════════
// 条目的可达性 —— **三态判定，唯一的判据住这里**（只判不写、不删）
// ════════════════════════════════════════════════════════════════════════

/**
 * 一条登记「为什么用不了」的三种原因（闭集，别扩成自由文本）：
 * · `relative` —— `project_root` 不是绝对路径（**含根本没有 project_root 的坏条目**）。
 *   注册表的语义是"这台机器上的某个**绝对**目录"，相对路径表达不了 ⇒ 读端只能靠 cwd 猜（= 换题）。
 * · `missing` —— 绝对路径，但磁盘上**没有**这个路径（被删 / 临时夹具跑完就没了）。
 * · `not-dir` —— 路径在，但不是目录。
 */
export type RegistrySuspectReason = 'relative' | 'missing' | 'not-dir';

/** 一条**不可达**的登记（★ 派生视图：每次读现算，绝不写回文件） */
export interface RegistrySuspect {
  feature: string;
  /** 登记里写的根（已归一；`relative` 且根本没有 project_root 时为空串） */
  root: string;
  reason: RegistrySuspectReason;
}

/** 一次读的回执：登记表 + 不可达清单（两者同源、同一次读得出） */
export interface RegistryCheck {
  reg: ProjectRegistry;
  suspects: RegistrySuspect[];
}

/**
 * 一个登记根的状态（**纯判**：不写盘、不删、不猜）。
 * @returns `null` = 可达（绝对路径且是现存目录）；否则是不可达的那一种原因
 */
function judgeRoot(root: string): RegistrySuspectReason | null {
  if (!root || !isAbsoluteRoot(root)) return 'relative';
  try {
    return fs.statSync(root).isDirectory() ? null : 'not-dir';
  } catch {
    return 'missing';
  }
}

/** 这个根此刻能不能落到一个真实存在的目录上（`false` = 不可达，**不是**"没登记"） */
export function isReachableRoot(root: string): boolean {
  return judgeRoot(normRoot(String(root ?? ''))) === null;
}

/** 一行错误（压平折行 + 截断）：`JSON.parse` 的原文常常带换行，报文里只需一行 */
function oneLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * 册文件坏掉的**唯一报文**：文件绝对路径 + 形状错在哪 + 三条救法。
 *
 * ★ 为什么必须自带救法：`readRegistry` 也在 `saveDSL` 的路径上过 ⇒ 这里抛错会让人**连写都写不了**
 *   （改设计册 / 登记新项目都要先读它）⇒ 三条救法必须能**独立执行**、不依赖 agent-io 自身。
 */
function registryBrokenMessage(file: string, why: string): string {
  return (
    '[project_registry] 注册表文件**坏了**（这是「读失败」，不是「一条都没登记」）：\n' +
    `  文件：${file}\n` +
    `  形状错在哪：${why}\n` +
    '★ 三条救法（任选一条，都不依赖 agent-io 自身 —— 本文件坏着的时候连"登记新项目"都写不了）：\n' +
    '  ① 从 git 取回：git checkout -- <projects.json 所在的仓>/…/projects.json（★ 它按设计**不进项目仓**，' +
    '先确认它在哪个仓：默认在 <包根>/.agentio-data/ 或 $AGENT_IO_HOME/.agent-io/ 下）\n' +
    '  ② 从快照取回：同目录下的 projects.json.bak-<时间戳>（历史备份），或 <包根>/.agent-io/snapshots/ 下最近一份\n' +
    '  ③ 手工修 JSON：最小合法形状是 {"version":1,"features":{}}；' +
    '每条登记 = {"project_root":"<绝对路径>","registered_at":"<ISO>","registered_by":"<谁>"}\n' +
    '★ 修好之前**不要**删它当作"重置" —— 那会把所有 feature 的项目根一次性丢掉（册的位置由本表决定）。'
  );
}

/** 顶层形状校验：不是对象 / `features` 不是对象 / `version` 不是数字 ⇒ 说清是哪一个 */
function shapeErrorOf(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    const actual = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    return `顶层必须是对象，实际是 ${actual}`;
  }
  const o = v as { version?: unknown; features?: unknown };
  if (o.features !== undefined && (o.features === null || typeof o.features !== 'object' || Array.isArray(o.features))) {
    const actual = o.features === null ? 'null' : Array.isArray(o.features) ? 'array' : typeof o.features;
    return `features 必须是对象（feature → 登记），实际是 ${actual}`;
  }
  if (o.version !== undefined && typeof o.version !== 'number') {
    return `version 必须是数字，实际是 ${typeof o.version}`;
  }
  return null;
}

/**
 * ★★★ **读注册表的唯一实现**（`readRegistry` 只是它的视图）。
 *
 * ## 只做三件事，一件都不多做
 * ① 读文件：不存在 ⇒ 空表（第一次用，**不是**错误）；读不出来 / JSON 坏 / 形状坏 ⇒ **抛**；
 * ② 逐条判可达，不可达的进 `suspects`（**不删、不写回**）；
 * ③ 有 suspect ⇒ stderr **一行**（N 条 + 该跑什么命令），热路径上不刷屏。
 *
 * ★ 为什么"不可达"只能当派生视图：把它持久化成事实（剪掉并写回）= 文件与内存长期不符的源头，
 *   而且**判断错了就再也回不来**（临时盘掉线一次，登记就永久消失）。
 */
export function readRegistryChecked(): RegistryCheck {
  const f = registryFile();
  let raw: string;
  try {
    raw = fs.readFileSync(f, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { reg: { version: 1, features: {} }, suspects: [] };
    }
    throw new Error(registryBrokenMessage(f, `读取失败：${oneLine(e)}`));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(registryBrokenMessage(f, `JSON 解析失败：${oneLine(e)}`));
  }
  const shape = shapeErrorOf(parsed);
  if (shape) throw new Error(registryBrokenMessage(f, `结构校验失败：${shape}`));

  const j = parsed as Partial<ProjectRegistry>;
  const reg: ProjectRegistry = {
    version: typeof j.version === 'number' ? j.version : 1,
    features: (j.features ?? {}) as Record<string, RegistryEntry>,
  };
  const suspects: RegistrySuspect[] = [];
  for (const [feature, entry] of Object.entries(reg.features)) {
    const root = entry && typeof entry.project_root === 'string' ? normRoot(entry.project_root) : '';
    const reason = judgeRoot(root);
    if (reason) suspects.push({ feature, root, reason });
  }
  if (suspects.length) {
    process.stderr.write(
      `[project_registry] ${suspects.length} 条登记**不可达**（只报不删，登记本身仍然有效）：` +
        `${suspects.map((s) => `${s.feature}(${s.reason})`).join(', ')}` +
        ' ⇒ 处置：node scripts/registry_repair.mjs（默认 dry-run，--apply 才删）或 unregisterFeature(feature, reason)\n',
    );
  }
  return { reg, suspects };
}

/**
 * 读注册表（**签名不动** —— 4 个调用点免改）。
 * ★ 不存在 ⇒ 空表；**坏文件 ⇒ 抛**（返回值里没有"读失败"这一格，就不许拿空表冒充它 —— 0.12）。
 * ★ 要区分"没登记 / 登记了但不可达" ⇒ 用 `readRegistryChecked`（本轮起唯一的判据来源）。
 */
export function readRegistry(): ProjectRegistry {
  return readRegistryChecked().reg;
}

/**
 * 写 `.tmp` 的文件名。
 * ★ 必须带 pid：固定 `${f}.tmp` 两进程并发写同一本册时会互相踩（本仓同族写法见 `storage.ts` 的 `.tmp-<pid>`）。
 */
export function tmpPathFor(file: string): string {
  return `${file}.tmp-${process.pid}`;
}

/** 写注册表（原子：先写 `.tmp-<pid>` 再 rename，避免半截文件让读端全退回旧位置） */
export function writeRegistry(reg: ProjectRegistry): void {
  const f = registryFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = tmpPathFor(f);
  fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, f);
}

/**
 * 查某个 feature 的项目根。**这是读端唯一入口**。
 * ★ `null` 只表示「**没登记**」；「登记了但目录不可达」仍然返回登记里的根 ——
 *   可达性是另一件事（`isReachableRoot` / `readRegistryChecked().suspects`）。
 *   两种情形共用一个 null 正是本文件要根除的静默。
 */
export function projectRootOf(feature: string): string | null {
  const e = readRegistry().features[feature];
  if (!e || typeof e.project_root !== 'string' || !e.project_root) return null;
  return normRoot(e.project_root);
}

/**
 * ★★★ 2026-11-02（subagent:canvas-db）：`projectRootOf` 的**反方向** —— 一个根下登记了哪几个 feature。
 *
 * ## 为什么要它
 * 画布住 `tasks.db#plans`，主键 `(feature, card_id, file)`；写一份新画布要知道它属于哪本册。
 * 判据只有一本书（注册表）⇒ 反查也只能在这一处，不许别处再拼 `path.join(...)` 或比字符串。
 * ★ 返回**排序去重**的数组：这个根一个 feature 都没登记 ⇒ 空数组（**如实空**，不是「反查失败」）；
 *   多个（本仓实测 3 个：`agent-io` / `agent-io-toolface` / `task-system-plan`）⇒ 调用方自己判歧义。
 */
export function featuresOfRoot(root: string): string[] {
  const want = normRoot(root);
  if (!want) return [];
  const out: string[] = [];
  for (const [feature, e] of Object.entries(readRegistry().features)) {
    if (typeof e?.project_root !== 'string') continue;
    if (normRoot(e.project_root) === want) out.push(feature);
  }
  return [...new Set(out)].sort();
}

/**
 * 登记 / 更新一个 feature 的项目根（**唯一写端** = `import_project`）。
 *
 * ★ **绝对的化只在这里做一次**（`path.resolve` + `normRoot`）：
 *   写端是唯一知道"这是哪个目录"的地方；把原始入参（可能是 `.`）原样落盘，读端就只能靠 cwd 猜
 *   —— 实测后果：`registerFeature('f_rel','.')` 落盘 `.` ⇒ 下一次读即判坏 ⇒ 登记等于没登记。
 * ★ 幂等：根没变就**不写盘**（避免无谓 churn 与 mtime 抖动）。
 * ★ 根**变了** ⇒ 覆盖并保留 `registered_by`，但 `registered_at` 更新（那是"何时改成这样的"）。
 * ★ 本函数**不剪别人**：删除只走 `unregisterFeature`（删除不许藏在写路径里）。
 */
export function registerFeature(
  feature: string,
  projectRoot: string,
  by: string,
): { changed: boolean; entry: RegistryEntry } {
  if (!feature) throw new Error('[project_registry] feature 必填。');
  if (!projectRoot) throw new Error('[project_registry] projectRoot 必填。');
  const root = normRoot(path.resolve(projectRoot));
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

/** 一次注销的读数（`removed:false` = 本来就没这条登记 ⇒ 不是错误，也不写盘不写日志） */
export interface UnregisterResult {
  removed: boolean;
  /** 被删掉的那条（`removed:true` 时才有） */
  entry?: RegistryEntry;
  /** 审计日志文件的绝对路径（`removed:true` 时才有） */
  log_file?: string;
}

/**
 * ★★★ **显式注销**一条登记（带理由）。
 *
 * ## 为什么必须有它
 * 读路径改成"只报不删"之后，**错误登记就没有出口了** —— 而错误登记会真的发生
 * （实测：5 条测试夹具根 `iso / ds / sp / tp / t192flow` 指向 Temp 下的一次性目录）。
 * ⇒ 删除必须是一个**显式动作**，并且留下"为什么删"（删除是可考古的事实，不是清理噪声）。
 *
 * ## 判据
 * · `reason` 为空 ⇒ **拒**（说不出为什么的注销 = 猜；不许按名字或时间猜）；
 * · 该 feature 没登记 ⇒ `removed:false`（幂等，不改文件、不写日志）；
 * · 成功 ⇒ 删条目 + 一行 JSONL 进 `<数据仓>/projects.unregister.jsonl`。
 * @param by 谁注销的（写进日志；缺省 `unknown`）
 */
export function unregisterFeature(feature: string, reason: string, by = 'unknown'): UnregisterResult {
  if (!feature || !feature.trim()) throw new Error('[project_registry] unregisterFeature 需要 feature 名。');
  const why = String(reason ?? '').trim();
  if (!why) {
    throw new Error(
      '[project_registry] unregisterFeature 需要**理由**：注销是可考古的动作，日志里要能回答"为什么删"。\n' +
        '  ★ 不许按名字或时间猜 —— 写清"不可达 + 不是本项目根"这类可复核的事实。',
    );
  }
  const reg = readRegistry();
  const prev = reg.features[feature];
  if (!prev) return { removed: false };
  delete reg.features[feature];
  writeRegistry(reg);
  const logFile = path.join(getStorageRoot(), 'projects.unregister.jsonl');
  const line = `${JSON.stringify({
    at: new Date().toISOString(),
    feature,
    project_root: normRoot(String(prev.project_root ?? '')),
    reason: why,
    by,
  })}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (e) {
    // ★ 删除已经发生 ⇒ 不能静默：审计行写不进去要响亮说出来（别让"删了没记"变成无声事实）。
    throw new Error(
      `[project_registry] 登记 "${feature}" **已删除**，但审计日志写不进去：${logFile}（${oneLine(e)}）\n` +
        `  ⇒ 请手工补一条：${line.trim()}`,
    );
  }
  return { removed: true, entry: prev, log_file: logFile };
}
