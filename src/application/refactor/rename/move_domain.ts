/**
 * move_domain —— **一次搬完一个域**（整块搬迁，T166 / 2026-10-11）。
 *
 * ## 它答什么问题（用户的理念，逐字）
 * > *"AI 直接**不打补丁而是局部重写**……哪怕**重构工具**，我的推荐也是
 * >  **把那一整块圈出来，然后让你去重写**……**重新规划功能的分布**，
 * >  而不是说重新做一个文件或者**做一块补丁在那里**。"*
 *
 * ⇒ 「重新规划功能的分布」在工具上分三步，本工具是**第三步**：
 *   1. **改意图** —— 人改 `structure.domains.json` 的 `domains[].dir`（新家在哪）；
 *   2. **看差异** —— `structure_gap` 报 `relocating`（域表改了位置、旧家还有人）
 *      ⇒ ★ **待搬清单**（`relocate_moves[].files`）；
 *   3. ★ **本工具**：**一次搬完这一整块**（枚举旧家全部源码文件 + **逐个改写 import**）。
 *
 * ## ★★ 判据从哪来（**不新造**，这是本工具的立身之本）
 * `structure_gap` 的 **`relocate_moves`**（机读形态）—— ★ **不解析它的 `note` 散文**
 * （那正是本仓纪律②「产物结构化，非 message 串」要根治的形态）。
 * ★ 而"该不该搬、搬谁"的判据**只有那一处** ⇒ 本工具**不自己再算一遍**
 *   （再算一遍 = 判据分叉，本仓头号病根）。
 *
 * ## 落地动作（**复用**，不另写一套）
 * 逐文件 `renameFiles`（`[B]` 已具备："整体校验 → 全通过才落盘" + import 引用改写 +
 * 目标目录自动 `mkdirSync` + 写前快照 + 索引写穿）。★ 本工具只做**枚举 + 映射 + 汇总**。
 *
 * ## ★ 三条纪律
 * 1. **不猜**：`domain_ids` 给了但不在待搬清单里 ⇒ **抛**（明说是哪个）。
 * 2. **不静默**：清单为空 ⇒ **明确报"没有待搬的域"**（不是静默 `ok:true`）；
 *    ★ 旧家**非源码条目**（子目录 / `.md` / 夹具）**本工具不搬** ⇒ **如实列进 `leftovers`**；
 *    ★ 取不到 `HEAD` 版域表（`relocate_note`）⇒ 那**一半"没查"**要带进回执。
 * 3. **量具与执行器分开**：`structure_gap` 只读，本工具只写 —— **不把它俩合成一个**。
 *
 * ## 只搬**声明过的**那一层
 * `relocate_moves[].files` 来自 `structure_gap` 的 `sourceFileNames`（**只看旧目录的直接子文件**）。
 * ⇒ ★ 旧目录里若有**子目录**，它**不在清单里**（不是遗漏，是口径）⇒ 一并进 `leftovers` 报出。
 */
import path from 'node:path';
import { structureGap } from '../../../infrastructure/analysis/structure/structure_gap.js';
import { renameFiles, type RenameFilesResult } from './rename_files.js';
import { isSourceExt, isNoiseFileName } from '../../../infrastructure/parse/source_exts.js';
import type { Touched } from '../../../domain/b_terms.js';
import fs from 'node:fs';

export interface MoveDomainInput {
  /** 项目根（读它根下的 `structure.domains.json` 作为"结构意图"） */
  project_dir: string;
  /**
   * 只搬这些域 id（`domains[].id`）。省略 ⇒ 搬**全部**「待搬」的域。
   * ★ 给了却不在待搬清单里 ⇒ **抛**（不猜：那说明"你以为它要搬，而判据说不用"）。
   */
  domain_ids?: string[];
  /** true = 只算影响面预览，不落盘（默认 false） */
  dry_run?: boolean;
}

export interface MoveDomainResult {
  ok: boolean;
  dryRun: boolean;
  /** ★ 判据来源（写死在这里，让读端一眼看到"清单不是本工具算的"） */
  source: 'structure_gap.relocate_moves';
  /** 本次要搬的域（`domain_ids` 过滤之后），逐文件给出 from → to */
  domains: Array<{
    domain_id: string;
    from_dir: string;
    to_dir: string;
    files: Array<{ from: string; to: string }>;
    /** ★ 旧目录里**本工具不搬**的条目（子目录 / 非源码 / 噪音名）—— 如实报，不静默 */
    untouched: string[];
  }>;
  /** 逐文件结果（★ 从 `renameFiles` 的 previews **透传**，不重算） */
  per_file: Array<{ from: string; to: string; ok: boolean; blocked?: string[] }>;
  total_files: number;
  /** 真落盘的文件数（`dry_run` ⇒ 0） */
  files_written: number;
  /** 旧目录搬完后的残留（与 `domains[].untouched` 同源，此处按目录聚一次，便于人读） */
  leftovers: Array<{ domain_id: string; dir: string; entries: string[] }>;
  /**
   * ★ **真删掉的旧目录**（T166：搬完的收尾）—— `dry_run` ⇒ 恒空（预告见 `would_remove_dirs`）。
   *
   * ★ 为什么要删（真跑踩出来的）：搬完后旧目录**空了却还在** ⇒ `structure_gap` 会报
   *   **`unlisted: 1`**（"没人要的家"）—— ★ 判据没写错（那个空壳确实没人要），
   *   但**读数变成"待处置 1 个待定归属"**，而真相是"**搬完了，只差把空壳收掉**"
   *   ⇒ 不删的话，"一次搬完"就**永远差最后一步**，每次都得人手工 `rmdir`。
   * ★ **安全**：只用 `rmdirSync`（**非空会抛**）⇒ 天然不会删掉还有东西的目录。
   */
  removed_dirs: string[];
  /** `dry_run` 时**预告**会删掉的旧目录（真跑时该项与 `removed_dirs` 同一判据） */
  would_remove_dirs: string[];
  /** ★ **非空 ⇒ 不删**、只报（旧目录里还有人 —— 本工具**不替**你决定它们去哪） */
  leftover_dirs: Array<{ dir: string; entries: string[] }>;
  /** ★ 诚实边界（"没查"的那一半 / 域表未提交之类）—— 不许让它静默 */
  notes: string[];
}

/** 旧目录下**本工具不搬**的条目（子目录 / 非源码文件 / 噪音名）—— 如实报。 */
function untouchedEntries(dirAbs: string): string[] {
  if (!fs.existsSync(dirAbs)) return [];
  return fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .filter((e) => e.isDirectory() || isNoiseFileName(e.name) || !isSourceExt(path.extname(e.name)))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
}

/** 出口形状（照 `renameFiles` 的同族：`{ok, reason, data}` + 可选的 `touched`） */
export interface MoveDomainOutput {
  ok: boolean;
  reason: string;
  data: MoveDomainResult;
  /** ★ 直接**透传**下层 `renameFiles` 的 `touched`（"我动了什么"**不重算** —— 重算＝同一判据两处） */
  touched?: Touched;
}

export async function moveDomain(input: MoveDomainInput): Promise<MoveDomainOutput> {
  const projectDir = path.resolve(input.project_dir);
  const dryRun = !!input.dry_run;

  // ── ① 判据来源：structure_gap 的 relocate_moves（**唯一一处**）──
  const gap = structureGap(projectDir);
  if (!gap.configured) {
    throw new Error(
      `项目未声明结构意图（根下 ${gap.config_path} 不存在）⇒ 没有"域"可言，「搬域」无从谈起。` +
        `★ 这不是本工具能替你决定的事（哪些目录算域是**人写的架构约定**）。`,
    );
  }
  const notes: string[] = [];
  if (gap.relocate_note) notes.push(gap.relocate_note);

  let moves = gap.relocate_moves;
  if (input.domain_ids && input.domain_ids.length > 0) {
    const want = new Set(input.domain_ids);
    const known = new Set(moves.map((m) => m.domain_id));
    const missing = input.domain_ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new Error(
        `这些域**不在待搬清单里**：${missing.join(' / ')} —— ` +
          `★ 本工具只搬「域表改了位置、而旧家还有人」的域（判据见 structure_gap 的 relocate_moves）。` +
          `如果你确实改了它们的 dir，请先确认那处改动**在工作区**（本判据比的是 HEAD → 工作区）。`,
      );
    }
    moves = moves.filter((m) => want.has(m.domain_id));
  }
  if (moves.length === 0) {
    // ★ **不静默**：这不是"搬完了"，是"**本次没有可搬的**"——要说清是哪一种。
    const why = gap.relocate_note
      ? '★ 且本轮的搬迁判据**没查**（见 notes）⇒ 这两件事都不是"没有待搬"。'
      : '（域表与 `HEAD` 一致，或旧家已空）';
    return {
      ok: true,
      reason: `没有待搬的域：structure_gap 的 relocate_moves 为空。${why}`,
      data: {
        ok: true,
        dryRun,
        source: 'structure_gap.relocate_moves',
        domains: [],
        per_file: [],
        total_files: 0,
        files_written: 0,
        leftovers: [],
        removed_dirs: [],
        would_remove_dirs: [],
        leftover_dirs: [],
        notes,
      },
    };
  }

  // ── ② 枚举 + 映射（旧家 → 新家，**保持文件名**；本工具只搬直接子文件）──
  const domains: MoveDomainResult['domains'] = moves.map((mv) => ({
    domain_id: mv.domain_id,
    from_dir: mv.from_dir,
    to_dir: mv.to_dir,
    files: mv.files.map((rel) => ({
      from: rel,
      to: path.posix.join(mv.to_dir, path.posix.basename(rel)),
    })),
    untouched: untouchedEntries(path.join(projectDir, ...mv.from_dir.split('/'))),
  }));

  // ── ③ 落地：复用 renameFiles（整体校验 → 全通过才落盘；import 引用改写 / mkdir / 快照全在它里面）──
  const renames = domains.flatMap((d) => d.files.map((f) => ({ from: f.from, to: f.to })));
  const r: RenameFilesResult & { touched?: Touched } = await (renameFiles({
    project_dir: projectDir,
    renames,
    dry_run: dryRun,
  }) as Promise<RenameFilesResult & { touched?: Touched }>);

  const perFile = r.previews.map((p) => ({
    from: p.from,
    to: p.to,
    ok: p.ok,
    ...(p.blocked && p.blocked.length ? { blocked: p.blocked } : {}),
  }));

  // ── ④ 收尾：旧家搬空了 ⇒ **把空壳删掉**（★ 非空则**绝不删**，只报）──
  //    ★ 只在**真落盘且整体成功**时动盘；`dry_run` 只预告（同一判据，两个出口）。
  const removedDirs: string[] = [];
  const wouldRemoveDirs: string[] = [];
  const leftoverDirs: MoveDomainResult['leftover_dirs'] = [];
  for (const d of domains) {
    const dirAbs = path.join(projectDir, ...d.from_dir.split('/'));
    if (!fs.existsSync(dirAbs)) continue;
    const rest = fs.readdirSync(dirAbs);
    if (rest.length > 0) {
      leftoverDirs.push({ dir: d.from_dir, entries: rest.sort() });
      continue;
    }
    if (dryRun || !r.ok) {
      wouldRemoveDirs.push(d.from_dir);
      continue;
    }
    // ★ `rmdirSync` 在非空时**会抛** —— 这正是我们要的安全网（不 rm -r，不做递归删）
    fs.rmdirSync(dirAbs);
    removedDirs.push(d.from_dir);
  }

  const data: MoveDomainResult = {
    ok: r.ok,
    dryRun: !!r.dryRun,
    source: 'structure_gap.relocate_moves',
    domains,
    per_file: perFile,
    total_files: renames.length,
    files_written: r.filesWritten ?? 0,
    leftovers: domains
      .filter((d) => d.untouched.length > 0)
      .map((d) => ({ domain_id: d.domain_id, dir: d.from_dir, entries: d.untouched })),
    removed_dirs: removedDirs,
    would_remove_dirs: wouldRemoveDirs,
    leftover_dirs: leftoverDirs,
    notes,
  };

  const reason =
    `${r.ok ? '' : '⚠ 有阻断 ⇒ 整体未落盘：'}${domains.length} 个域 / ${renames.length} 个文件` +
    (dryRun ? '（dry_run，未落盘）' : `（落盘 ${data.files_written} 个）`) +
    (removedDirs.length ? `；收掉空壳目录 ${removedDirs.length} 个` : '') +
    (wouldRemoveDirs.length ? `；★ 预告将收掉空壳目录 ${wouldRemoveDirs.length} 个` : '') +
    (leftoverDirs.length
      ? `；★ ${leftoverDirs.length} 个旧目录**还有人**⇒ **没删**（见 leftover_dirs）`
      : '') +
    (data.leftovers.length ? `；★ ${data.leftovers.length} 个旧目录有不搬的条目（见 leftovers）` : '');

  return { ok: r.ok, reason, data, ...(r.touched ? { touched: r.touched } : {}) };
}
