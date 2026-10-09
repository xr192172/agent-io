/**
 * diff_blocks.ts —— 「**差异块**」：把 per-file 的差异聚成**可重写的区域块**（2026-10-09，`docs/todo.md` T73）。
 *
 * ## 为什么需要它
 * 用户口述的目标工作流：*"对比项目现状与设计，得到**区别的地方**，然后**分区域**将它重写。"*
 * 实测起点（2026-10-09）：`consistency_check` / `detect_drift` **都以文件为粒度**报差异
 * ⇒ 拿到的是一串"哪个文件差什么"，**没有"哪一片要改"**。
 * ⇒ 本模块把"一串文件差异"折成"**几块区域**"：块的粒度 = 一个**可命名的区域**，
 *    下游就能说"**先重写这块**"，而不是"先重写第 3、7、11 个文件"。
 *
 * ## 三条纪律
 * 1. ★★★ **块名必须稳定**：块名**只用 `formatScope` 生成**（`domain/scope.ts` 是它唯一的文法落点）。
 *    ⇒ 同一片区域，今天叫 `arch_layer:service`，明天还叫 `arch_layer:service` —— 这才谈得上
 *      "**这块我上一轮已经改过了**"、"**这块还在欠账**"。
 *    ★ 反面：按"差异条数排序后编号"（块 1/2/3）**不行** —— 改一条差异，块号全变。
 * 2. ★★ **不许静默**：空块、无差异、以及"某文件判据里没有 arch_layer 可归"全部进 `notes`。
 * 3. ★ **纯函数**：输入 → 输出，不读盘、不看时间 ⇒ 可判可测（与 `scope.ts` 同一条纪律）。
 *
 * ## 归块的轴（`group_by`）
 *   · `arch_layer` —— 默认。架构层是**既在数据里、又有语义**的命名轴（`semantic.files[].layer`
 *     或 `geometry` 节点的 `arch_layer`），且 `formatScope({kind:'arch_layer'})` 能给它一个稳定名。
 *   · `scope` —— **当 scope 本身比 arch_layer 更窄时**（如 `files:a.ts` / `subtree:X`），
 *     再按 arch_layer 切就没有意义了 ⇒ 整个 scope 作**一块**，块名 = scope 自己的规范名。
 */
import type { Scope } from './scope.js';
import { formatScope } from './scope.js';

/**
 * ★★ **"有差异"的判据 —— 只此一处**（2026-10-09 导出，T81 续）。
 *
 * ★ 为什么要导成单点：`consistency_check` 有**两条返回路径**（给 scope / 不给 scope），
 *   两条都要算"哪些文件**要我关注**" ⇒ 若各写一遍判据，就是本仓头号病（**同一判据住两处**）。
 * ★ 口径：四类差异之和 > 0 —— 含 `expectation_failures`（T78：**人写的验收**也算差异）。
 */
export function hasDiff(f: FileDiff): boolean {
  return f.missing + f.mismatched + f.unexpected + (f.expectation_failures ?? 0) > 0;
}

/** 一个文件的差异计数（★ 只数差异，不数"通过"——通过的文件不进块） */
export interface FileDiff {
  /** 仓库相对路径（已规范化为 `/`） */
  path: string;
  /** 归块用的轴值（`arch_layer`；缺则进 notes 并落到 `<未分层>` 块） */
  arch_layer?: string;
  missing: number;
  mismatched: number;
  unexpected: number;
  /**
   * ★★ 2026-10-09（T78）：**人写的验收**（`expectations`）在这个文件上失败了**几条**。
   *
   * ## 为什么必须并进来
   * 「差异」有**两个来源**：`expected_apis` 对账（**扫描来的**契约 —— 而设计是从扫描 fork 的，
   * 所以它对出来**永远干净**）与人写的 `expectations`（**只有它会真的不一样**）。
   * 而本模块当初只吃前者 ⇒ **块永远是空的** ⇒ 用户要的那一步「**把不对的范围自动圈出来**」等于没做
   * （2026-10-09 真跑试用当场抓到：验收报 `failed 1`，而块报"有差异 0 个"，两者矛盾）。
   * ⇒ 把它并进同一个计数，让**两个来源汇成同一份块**。
   */
  expectation_failures?: number;
}

export interface DiffBlock {
  /** ★ 区域名 —— **只由 `formatScope` 生成**（纪律 1：稳定命名） */
  region: string;
  /** 这一块里**有差异**的文件（已排序） */
  files: string[];
  /** 差异计数（四类之和 = 这一块要处理的总条数） */
  counts: { missing: number; mismatched: number; unexpected: number; expectation_failures: number };
}

export interface DiffBlocksResult {
  blocks: DiffBlock[];
  /** 范围内**没有差异**的文件（已排序）—— 也要报，否则"范围里有几个文件"会失真 */
  clean_files: string[];
  /** ★ 说明（空块 / 无分层 / 归不进任何块 …… 不许静默） */
  notes: string[];
}

/**
 * 把文件差异折成块。
 *
 * @param files    范围内的文件差异（**只应有差异的**；通过的文件由调用方放进 `clean_files`）
 * @param scope    用于**回退命名**（`group_by='scope'` 时块名 = 它）
 * @param group_by `'arch_layer'`（默认）或 `'scope'`
 */
export function buildDiffBlocks(
  files: readonly FileDiff[],
  scope: Scope,
  group_by: 'arch_layer' | 'scope' = 'arch_layer',
): DiffBlocksResult {
  const notes: string[] = [];
  const withDiff = files.filter(hasDiff);

  if (withDiff.length === 0) {
    notes.push('范围内**没有任何差异** ⇒ 无块可出。★ 这是"好消息"，不是"没跑"。');
    return { blocks: [], clean_files: [...files.map((f) => f.path)].sort(), notes };
  }

  const keyOf = (f: FileDiff): string => {
    if (group_by === 'scope') return formatScope(scope);
    return f.arch_layer ? formatScope({ kind: 'arch_layer', value: f.arch_layer }) : '<未分层>';
  };

  const noLayer = withDiff.filter((f) => !f.arch_layer).map((f) => f.path).sort();
  if (group_by === 'arch_layer' && noLayer.length) {
    notes.push(
      `以下文件**没有 arch_layer 可归**（判据里没有该字段）⇒ 暂落 \`<未分层>\` 块：${noLayer.join(', ')}；` +
        `要归得住，需先给这些文件定架构层（否则"块"少了归属这条腿）`,
    );
  }

  const byKey = new Map<string, FileDiff[]>();
  for (const f of withDiff) {
    const k = keyOf(f);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(f);
  }

  const blocks: DiffBlock[] = [...byKey.entries()]
    .map(([region, fs]) => ({
      region,
      files: fs.map((f) => f.path).sort(),
      counts: {
        missing: fs.reduce((a, f) => a + f.missing, 0),
        mismatched: fs.reduce((a, f) => a + f.mismatched, 0),
        unexpected: fs.reduce((a, f) => a + f.unexpected, 0),
        expectation_failures: fs.reduce((a, f) => a + (f.expectation_failures ?? 0), 0),
      },
    }))
    // ★ 排序键必须**只由稳定量**构成：先按差异总数降序，同数再按 region 名字典序
    //   （★ 不许用"插入顺序"或"文件数"当第一键 —— 那会让块的顺序随无关改动漂）
    .sort((a, b) => {
      const ta = a.counts.missing + a.counts.mismatched + a.counts.unexpected + a.counts.expectation_failures;
      const tb = b.counts.missing + b.counts.mismatched + b.counts.unexpected + b.counts.expectation_failures;
      return tb - ta || a.region.localeCompare(b.region);
    });

  // ★ T78：若整份块的差异**全部来自人写的验收**，明说一句 —— 否则读者会以为"扫描对账也没对上"，
  //   而真相恰恰相反：**扫描对账永远干净**（设计是从扫描 fork 的），差异只可能来自人写的意图。
  const scanSide = blocks.reduce((a, b) => a + b.counts.missing + b.counts.mismatched + b.counts.unexpected, 0);
  const expSide = blocks.reduce((a, b) => a + b.counts.expectation_failures, 0);
  if (expSide > 0 && scanSide === 0) {
    notes.push(
      `本次差异**全部来自"人写的验收"**（${expSide} 条），扫描侧对账是干净的 —— ` +
        `★ 这是常态：**设计 DSL 的结构是从扫描 fork 的**，expected_apis 与代码同源 ⇒ 它那一路对出来必然一致；` +
        `真正会不一样的只有**人写的意图**（决策卡上的验收）。`,
    );
  }

  return { blocks, clean_files: files.filter((f) => !withDiff.includes(f)).map((f) => f.path).sort(), notes };
}
