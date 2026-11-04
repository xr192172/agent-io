/**
 * diff_scope —— `diff_views` 对拍之前的**三条可比性判据**（纯函数，**零 import**）。
 *
 * ## 三个问题（顺序即对拍顺序）
 * 1. **口径可比吗**（{@link pathBasisOf} / {@link rebasePath} / {@link normRelPath}）：
 *    两侧 DSL 的 `semantic.files[].path` 各自相对**自己那份** `source_root` ⇒ 两侧 root 不同时，
 *    同一文件会以两个不同字符串出现 ⇒ 逐文件比对会把它算成「一增一删」（实测：某册设计侧
 *    `src/…/x.ts`、实际侧裸名 `x.ts` ⇒ 全部文件都成了假差异）。⇒ 先重定基到共同口径；
 *    **归不了就不比**（不许把"没对齐"当"全新增"）。
 * 2. **比了多大一片**（{@link scopeLine}）：定向对拍必须同时给**分母**，否则"子集全绿"被读成"全绿"。
 * 3. **比的是不是当下的东西**（{@link assessFreshness}）：`live` 视图是 `cache.db` 的一次投影，
 *    投影可能落后于库 ⇒ 陈旧造成的差异**不是**真差异，必须显形。
 *
 * ## 为什么住 `domain/` 且零 import
 * 三条都是纯判据（无 IO / 无存储 / 无时间）：同一输入两次输出逐字相同 ⇒ 验收不依赖
 * "能否造出坏状态"（{@link pathBasisOf} 的四象限不必真造两个不同 root 的项目）。
 * 零 import 是为行为判据服务的：`behavior-cases` 的执行核要转译并加载本模块，依赖越少越不会被环境打翻。
 */

/**
 * 仓库相对路径的**唯一规范形**：`\` → `/`、去前导 `./`、折叠重复 `/`、去尾部 `/`。
 * ★ 只做"同一个文件的不同写法 → 同一串"这件事；**不做**大小写折叠（那是文件系统语义，
 * 由 {@link pathBasisOf} 在**比较时**处理），也不解析 `..`（输入本就来自扫描器的相对路径）。
 */
export function normRelPath(p: string | null | undefined): string {
  let s = String(p ?? '').trim().replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
  return s;
}

/**
 * 把一侧路径重定基到共同口径：`<prefix>/<path>`；`prefix` 为空 ⇒ 只归一化。
 * ★ 绝对路径不参与重定基（原样返回）：拼到另一个前缀上会造出一条**不存在的路径**，
 *   比"不归一"更坏 —— 那是静默的错误路径。
 */
export function rebasePath(p: string, prefix: string): string {
  const rel = normRelPath(p);
  if (rel.startsWith('/')) return rel;
  const pre = normRelPath(prefix);
  if (!pre) return rel;
  return rel ? pre + '/' + rel : pre;
}

/** 两侧 `source_root` 的关系（决定怎么重定基 / 能不能比） */
export type PathBasisKind = 'same-root' | 'live-under-design' | 'design-under-live' | 'incomparable';

/** 路径口径判定结果 */
export interface PathBasis {
  basis: PathBasisKind;
  /** 归一化后的设计侧 root（`''` = 缺失） */
  design_root: string;
  /** 归一化后的实际侧 root（`''` = 缺失） */
  live_root: string;
  /** 设计侧路径要加的前缀（`''` = 不加） */
  design_prefix: string;
  /** 实际侧路径要加的前缀（`''` = 不加） */
  live_prefix: string;
}

/**
 * ★① 判定两侧 `source_root` 的关系 ⇒ 怎么把两侧路径归到**同一口径**。
 * 只有"一方是另一方的祖先目录"才可重定基；其余一律 `incomparable`（**拒绝硬比**）。
 * ★ 大小写只用于**比较**，前缀从原串切 —— Windows 盘符大小写不敏感，据此改写原路径会造出错的串。
 */
export function pathBasisOf(designRoot?: string | null, liveRoot?: string | null): PathBasis {
  const d = normRelPath(designRoot);
  const l = normRelPath(liveRoot);
  const base = { design_root: d, live_root: l, design_prefix: '', live_prefix: '' };
  if (!d || !l) return { ...base, basis: 'incomparable' as const };
  const dl = d.toLowerCase();
  const ll = l.toLowerCase();
  if (dl === ll) return { ...base, basis: 'same-root' as const };
  if (ll.startsWith(dl + '/')) {
    return { ...base, basis: 'live-under-design' as const, live_prefix: l.slice(d.length + 1) };
  }
  if (dl.startsWith(ll + '/')) {
    return { ...base, basis: 'design-under-live' as const, design_prefix: d.slice(l.length + 1) };
  }
  return { ...base, basis: 'incomparable' as const };
}

/** 把 {@link pathBasisOf} 的结论写成人话（工具原样印出；**不可比时必须响亮**） */
export function pathBasisNote(b: PathBasis): string {
  switch (b.basis) {
    case 'same-root':
      return '✓ 两侧 source_root 相同（' + b.design_root + '）⇒ 路径口径一致';
    case 'live-under-design':
      return (
        '★ 两侧 source_root 不同（设计 = ' + b.design_root + '，实际 = ' + b.live_root +
        '）⇒ 实际侧路径已按 `' + b.live_prefix + '/` 重定基到设计口径后再比'
      );
    case 'design-under-live':
      return (
        '★ 两侧 source_root 不同（设计 = ' + b.design_root + '，实际 = ' + b.live_root +
        '）⇒ 设计侧路径已按 `' + b.design_prefix + '/` 重定基到实际口径后再比'
      );
    default:
      return (
        '⚠ **路径口径不一致，无法对账**：两侧 source_root 不构成包含关系（设计 = ' +
        (b.design_root || '（缺）') + '，实际 = ' + (b.live_root || '（缺）') + '）⇒ 本次**不逐文件比**' +
        '（硬比会把同一批文件全算成"一增一删"，而那不是差异，是口径没对齐）。'
      );
  }
}

/** 新鲜度三态：`fresh` 同代 · `stale` 落后 · `unknown` **读不到**（≠ 是新的） */
export type FreshnessVerdict = 'fresh' | 'stale' | 'unknown';

/** 新鲜度判据的输入（全部来自**册自己记的**事实，不读 mtime / cwd 这类环境态） */
export interface FreshnessInput {
  /** live 视图 `_sync.saved_at`（人读用；不参与判定） */
  live_saved_at?: string | null;
  /** live 视图 `_sync.scanRev` = 它复制自哪一代索引（`max(files.indexed_at)`）；缺 ⇒ null */
  live_scan_rev?: number | null;
  /** 当下索引扫描代（`scanRevOf().rev`）；读不到 ⇒ null */
  current_rev?: number | null;
}

/** 新鲜度判定结果 */
export interface Freshness {
  verdict: FreshnessVerdict;
  /** `current_rev - live_scan_rev`（毫秒）；`unknown` 时 null */
  lag_ms: number | null;
  live_saved_at: string | null;
  live_scan_rev: number | null;
  current_rev: number | null;
}

/**
 * ★③ 判 live 视图是否**落后于**当前索引。
 * 判据只有一条：`_sync.scanRev < 当前 max(files.indexed_at)` ⇒ 陈旧。
 * ★ 任一侧读不到 ⇒ `unknown`（**不是** `fresh`）：读不到 ≠ 是新的。
 */
export function assessFreshness(i: FreshnessInput): Freshness {
  const saved = typeof i.live_saved_at === 'string' ? i.live_saved_at : null;
  const rev = typeof i.live_scan_rev === 'number' ? i.live_scan_rev : null;
  const cur = typeof i.current_rev === 'number' ? i.current_rev : null;
  const base = { live_saved_at: saved, live_scan_rev: rev, current_rev: cur };
  if (rev === null || cur === null) return { ...base, verdict: 'unknown', lag_ms: null };
  const lag = cur - rev;
  return { ...base, verdict: lag > 0 ? 'stale' : 'fresh', lag_ms: lag };
}

/** 只要三态（`behavior-cases` 与调用方都用它；判定本体住 {@link assessFreshness}） */
export function freshnessVerdict(i: FreshnessInput): FreshnessVerdict {
  return assessFreshness(i).verdict;
}

/** 把新鲜度判定写成人话（工具原样印出；**陈旧必须显形**） */
export function freshnessLine(i: FreshnessInput): string {
  const f = assessFreshness(i);
  if (f.verdict === 'fresh') {
    return '✓ live 视图与当前索引同代（扫描代 ' + f.current_rev + '）⇒ 本次差异不是陈旧造成的';
  }
  if (f.verdict === 'stale') {
    const h = ((f.lag_ms ?? 0) / 3600000).toFixed(1);
    return (
      '⚠ **live 视图陈旧 ' + h + ' 小时**（live 快照 saved_at=' + (f.live_saved_at ?? '（未记）') +
      '，基于扫描代 ' + f.live_scan_rev + '；当前索引扫描代 ' + f.current_rev + '）⇒ ' +
      '本次差异中「看起来是设计/实现改了」的那部分**可能只是快照没跟上**，不是真差异。' +
      '处置：先跑 `import_project` 保鲜再对拍（本工具**不**自动触发全量扫描 —— 全量只用于建账）。'
    );
  }
  const why: string[] = [];
  if (f.live_scan_rev === null) why.push('live 快照没有 `_sync.scanRev`（不知道它基于哪一代索引）');
  if (f.current_rev === null) why.push('当前索引读不到扫描代（该 source_root 下没有可读的 `cache.db`）');
  return (
    '⚠ **无法判定 live 视图新鲜度**：' + why.join('；') +
    ' ⇒ 本次差异里"陈旧成分"**未知**（读不到 ≠ 是新的）。'
  );
}

/**
 * ★② **分母**：定向对拍必须同时给出「本次 N / 全量 M ⇒ 未覆盖 M−N」。
 * ★ 只给分子等于没验：把"子集绿"读成"全绿"是本仓 0.19③ 点名的违例形态。
 * ★ 不圈定时 label 用「全量（未圈定）」，读数里因此**一定**出现"全量"字样。
 */
export function scopeLine(scoped: number, universe: number, label: string): string {
  return '范围：' + label + ' · 本次 ' + scoped + ' 条 · 全量 ' + universe + ' 条 ⇒ 未覆盖 ' + (universe - scoped);
}
