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
