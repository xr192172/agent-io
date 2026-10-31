/**
 * stale_verdict —— 「dist 是否最新」的**判定核**（零依赖纯函数）。
 *
 * ## 为什么住 domain
 * `src/application/observe/runtime/stale_check.ts`（3 个值 import：fs / path / crypto）里这段判定只能靠
 * `source-has must:[".build-manifest.json","createHash","basis"]` 守 —— 而那三个串**抽取后仍在**
 * （生产者 writeBuildManifest 还要写清单、算哈希），所以那条判据**连"判定用了哈希"这件事都不再判**。
 * 抽到这里，两级判定（mtime/size 只做触发 / 内容哈希才是判定）才能给输入比输出。
 *
 * ## 为什么拆成两次调用（而不是一次把哈希也算进去）
 * 哈希是**贵的**：mtime+size 与清单一致时**根本不该读哈希**（原实现就是这么省事的）。
 * ⇒ `staleDecision(…, hash: null)` 先问"要不要哈希"，回 `need-hash` 时调用方才算哈希再问一次。
 *   ★ 这条"省一次哈希"也是判据的一部分：mtime+size 一致却去算哈希 = 白跑；算完还判错 = 更糟。
 */

/** 构建清单里的一条记录（生产者：`scripts/clean_dist.mjs`；消费者：本文件的判定核） */
export interface ManifestRec {
  /** 构建时记录的源 mtime（ms，已取整） */
  readonly mtime: number;
  /** 构建时记录的源 size（字节） */
  readonly size: number;
  /** 构建时记录的源内容 sha1 */
  readonly hash: string;
}

/** 判定结果：`need-hash` = 便宜的两级看不出来，要调用方补算哈希再问一次 */
export type StaleDecision = 'none' | 'missing' | 'changed' | 'need-hash';

/** 判定输入的**事实**（全部由调用方从盘上现取，本文件不碰 IO） */
export interface StaleFacts {
  /** 产物存在？（`mtimeOf(out) >= 0`） */
  readonly outExists: boolean;
  /** 源文件 mtime（ms，**未取整**） */
  readonly srcMtime: number;
  /** 产物 mtime（ms；不存在时 0） */
  readonly outMtime: number;
  /** 源文件当前字节数 */
  readonly size: number;
  /** 源文件当前 sha1；`null` = **还没算**（省哈希） */
  readonly hash: string | null;
  /** 清单里这条的记录；`null` = 清单里没有这条（新增文件 / 旧清单） */
  readonly rec: ManifestRec | null;
}

/**
 * 判定"这个源文件是否需要重建"。
 *
 * 顺序与抽取前**逐字一致**（顺序即语义，别重排）：
 *   ① 产物缺失 ⇒ `missing`；
 *   ② 清单里没这条 ⇒ 退回 mtime：产物比源旧 ⇒ `changed`，否则 `none`；
 *   ③ mtime（取整）+ size 与清单一致 ⇒ `none`（**免哈希**）；
 *   ④ 还没哈希 ⇒ `need-hash`（调用方补算后带 `hash` 再问一次）；
 *   ⑤ 哈希相同 ⇒ `none`（增量编译"改了又改回"跳 emit 的假阳性死在这一步）；否则 `changed`。
 */
export function staleDecision(f: StaleFacts): StaleDecision {
  if (!f.outExists) return 'missing';
  if (!f.rec) return f.outMtime < f.srcMtime ? 'changed' : 'none';
  if (Math.round(f.srcMtime) === f.rec.mtime && f.size === f.rec.size) return 'none';
  if (f.hash === null) return 'need-hash';
  return f.hash === f.rec.hash ? 'none' : 'changed';
}

/**
 * 本次判定的**依据**，如实标注（无清单时退回纯 mtime，不假装是哈希判的）。
 * 抽取前是 `const basis = manifest ? 'manifest' : 'mtime'` —— 一行，但它是"不许假装"这条纪律的唯一落点。
 */
export function basisOf(manifest: unknown): 'manifest' | 'mtime' {
  return manifest ? 'manifest' : 'mtime';
}

/**
 * judge 回执里「旧 dist」提示的**唯一产地**（纯函数 ⇒ 给输入比输出）。
 *
 * ## 不变量（两个条件**同时**成立才提示）
 *   ① `unsupported > 0` —— 一条判据都判不了时才谈得上；缺它 ⇒ 本来就没有"判不了"，提示是狼来了；
 *   ② `r.stale` 且 `entries` 非空 —— dist **确实**比 src 旧。缺它 ⇒ 把"判不了"归因给 build 会误导。
 * ★ 为什么必须两个一起要：`unsupported` 与"整批跑在旧代码上"在读数上**长得一模一样**。
 *   实测：`task-system-plan` 的 `normSignature` behavior-cases 报
 *   `Cannot find module '…expectation_kinds.js'`，连跑 3 次却是 3/3 pass、unsupported=0；
 *   真因是那几次 judge 跑在**旧 dist** 上（判据跑在旧代码上 = 读数失真）。
 *   不提示 ⇒ 读端无法区分"这条判不了"与"旧代码"（AGENTS-RULES 0.12）。
 */
export interface StaleJudgeFacts {
  /** `checkStaleBuild` 的结论：有源比 dist 新 */
  readonly stale: boolean;
  /** 扫了几个手写源（**分母** —— 只给分子等于没验） */
  readonly scanned: number;
  /** 逐条未重建的源（只取第 1 条渲染 mtime；分母用 `entries.length` / `scanned`） */
  readonly entries: ReadonlyArray<{
    readonly srcMtime: number;
    readonly outMtime: number;
    /** 产物整个缺失（`outMtime` 为 0 时也按"缺产物"渲染） */
    readonly missing: boolean;
  }>;
}

/**
 * 拼那条提示；不成立回 `null`（**不**回空串 —— 空串会被读成"提示过、但内容是空"）。
 * ★ 结构型入参：`stale_check#StaleCheckResult` 可直接赋值 ⇒ domain 不必反向依赖 application。
 * ★ mtime 渲染与 `stale_check#formatStaleText` 同一口径（`toISOString().slice(11,19)`），不另造一套。
 */
export function staleJudgeCaveat(unsupported: number, r: StaleJudgeFacts): string | null {
  if (!(unsupported > 0) || !r.stale || r.entries.length === 0) return null;
  const first = r.entries[0];
  const t = (ms: number): string => (ms > 0 ? new Date(ms).toISOString().slice(11, 19) : '缺产物');
  return (
    `★ 有 ${unsupported} 条判据 unsupported 且 dist 比 src 旧（src ${t(first.srcMtime)} vs dist ${t(first.outMtime)}；` +
    `checkStaleBuild 报 ${r.entries.length}/${r.scanned} 个源未重建）⇒ 先 npm run build 再判，` +
    '否则无法区分"判不了"与"旧代码"'
  );
}
