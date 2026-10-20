/**
 * rename_files —— 批量文件级重命名 + import 引用改写（对标 rename_symbols 的批处理模式）
 *
 * 把多个「文件重命名/移动」合成一次调用，复用 rename_file 的单条原子语义：
 *   - 先对所有条目按原始文件态 dry_run 算影响面（rename_file dry_run 返回 blocked/references），
 *     任一条被阻断（源缺失 / 目标已存在 / 命中冻结行）→ 整体不落盘，先给预览报告。
 *   - 全部可落盘时才逐条真落盘，返回每条 preview(applied)。
 *   - apply 阶段串行：一条引用改写成功可能使后续条目的影响面变化；若后续被阻断，
 *     立即中止并如实报告已应用条数。
 *
 * 与 rename_symbols 对称：rename_symbols 批量「模块级符号」，本品批量「文件路径」。
 * 消除"70 个文件改名 = 70 次调用"（障碍 #3 粒度太细）。
 *
 * 冻结行保护 / 生成物识别：逐条内部走 rename_file，天然继承（body 文件不套 / importer 命中冻结行 → 该条阻断）。
 */

import path from 'node:path';
import { renameFile, type RenameFileResult } from './rename_file.js';
import { resolveProjectRoot } from '../../../infrastructure/analysis/project_root/index.js';
// ★ T336（2026-10-16）：接上唯一写盘闸 —— 未登记不许落盘（同族：`edit_code` / `write_gate` 是唯一权威）
import { assertSourceWriteRegistered, assertSourceWriteRegisteredFor, resolveActor } from '../../write_gate.js';
import { snapshotBeforeWrite } from '../snapshot/file_snapshot.js';
// ★ T214 续8：兑现"整批不落盘"要用它 —— ★ 用**写前那份快照**回滚整批（★ 与 rename_symbols 对称 ✓）
import { rollbackFileSnapshot } from '../snapshot/file_snapshot.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';
// ★ 2026-10-20：任务闸的放行读数（note / 豁免）带出口 —— 三条写路共用同一份
import { attachGateNote } from '../gate_note.js';

export interface FileRenameItem {
  /** 源文件：相对 project_dir 或绝对路径 */
  from: string;
  /** 目标文件：相对 project_dir 或绝对路径 */
  to: string;
}

export interface RenameFilesInput {
  /** 目标项目根（可选；缺省各条自动定位；统一定位时传） */
  project_dir?: string;
  renames: FileRenameItem[];
  /** true=只算全部 dry-run 影响面不落盘；默认优先整体校验，全通过才落盘 */
  dry_run?: boolean;
}

export interface RenameFilesResult {
  ok: boolean;
  /** true=本次为纯预览（dry_run=true，或任一条被阻断返回的整体不落盘预览） */
  dryRun?: boolean;
  previews: Array<{
    index: number;
    from: string;
    to: string;
    ok: boolean;
    blocked?: string[];
    result?: RenameFileResult;
  }>;
  /** 真正落盘的条目（dry_run 时为 []; 部分成功后剩余被阻断时自此据实返回） */
  applied: Array<{ index: number; from: string; to: string; result: RenameFileResult }>;
  /**
   * ★ 口径与全仓一致（`rename_local` / `rename_symbols` 同义）：**真的落盘的文件数**（`dry_run` ⇒ 0）。
   *
   * 2026-10-07 修正：本字段原先存的是「累计引用改写**处数**」—— 注释与字段名**互相矛盾**，
   * 且同一份回执里 `touched.written_files` 有 3 条而本字段报 2：两个数说的根本不是一回事。
   * 现在与下层 `renameFile()` 返回的 `filesWritten` 同口径（那也是 `rename_symbols` 的用法）。
   */
  filesWritten: number;
  /** 整体阻断理由（ok=false 时给出全部） */
  blocked?: string[];
  /**
   * ★★★ T214 续8（2026-10-13）：**本批失败时【有没有回滚成功】** —— ★ `false` 表示**可能停在半改状态** ✗
   *
   * ★ 与 `rename_symbols` **对称**（★ 那边 T214 已修 ✓）：★ 说明里写着"整批不落盘"，
   *   ★★ 而真执行是**逐条落盘** ⇒ 中途失败原来 `return { applied }` ⇒ **已落盘的保留** ✗
   * ★ 本函数**本来就拍了快照**（`snapshotBeforeWrite` ✓）★ **却丢了返回值** ✗ ⇒ 只差"失败时用它回滚" ✓
   * ★★ 调用方**必须能分辨**"回滚成功"与"回滚失败"（★ 后者要人去处理 ✓）
   */
  rolledBack?: boolean;
  /** ★ T214 续8：回滚的**人话说明**（★ 成功说"已回滚整批"· 失败说"可能停在半改状态，请手动处理" ✓） */
  rollbackNote?: string;
  /**
   * ★★★ 2026-10-20：**任务闸的放行读数**（闸的 `note`；含豁免点名）。
   * ★ 之前 `assertSourceWriteRegisteredFor(...)` 的返回值被丢了 ⇒ 闸判了、豁免生效了，回执里一个字都没有。
   * ★ 形状照抄 `edit_code`（`EditReceipt.task_gate`）；人读侧由 `refactor/index.ts` 追加。
   */
  task_gate?: string;
}

async function renameFilesCore(input: RenameFilesInput): Promise<RenameFilesResult> {
  const { renames, dry_run } = input;
  // rename_file 强制要求 project_dir（它不像 rename_symbol 会自动定位根），这里在批量层做一次根解析兜底
  const projectDir = (() => {
    if (typeof input.project_dir === 'string' && input.project_dir) return input.project_dir;
    if (renames?.[0]?.from) {
      try {
        return resolveProjectRoot(renames[0].from);
      } catch {
        /* fallthrough */
      }
    }
    return process.cwd();
  })();
  const blocked: string[] = [];

  if (!renames || renames.length === 0) return { ok: false, dryRun: true, previews: [], applied: [], filesWritten: 0, blocked: ['批量列表为空'] };

  // 跨条目基础校验：同 from 重复（同一源文件不能改名两次）
  const fromSet = new Set<string>();
  for (const it of renames) {
    if (fromSet.has(it.from)) blocked.push(`重复源文件：${it.from}`);
    fromSet.add(it.from);
  }
  if (blocked.length > 0) return { ok: false, dryRun: true, previews: [], applied: [], filesWritten: 0, blocked };

  // 阶段 1：全部 dry_run 预览（基于原始文件态，不落盘）
  const previews: RenameFilesResult['previews'] = [];
  let allOk = true;
  for (let i = 0; i < renames.length; i++) {
    const item = renames[i];
    const result = await renameFile({ project_dir: projectDir, from: item.from, to: item.to, dry_run: true });
    previews.push({ index: i, from: item.from, to: item.to, ok: result.ok, blocked: result.ok ? undefined : result.blocked, result });
    if (!result.ok) allOk = false;
  }

  // 任一阻断 → 整体不落盘，给预览报告
  if (!allOk) return { ok: false, dryRun: true, previews, applied: [], filesWritten: 0, blocked: ['至少一个条目被阻断→整体未落盘'] };

  // dry_run 显式要求 → 只预览
  if (dry_run === true) return { ok: true, dryRun: true, previews, applied: [], filesWritten: 0 };

  // 阶段 2：全部通过 → 逐条真落盘（串行；前面改动导致后续阻断则中止并据实报告）
  // ★ 可撤回：落盘前把"本次会改到的全部文件"（每个条目的 from/to + 各 importer）各存一份。
  // 清单取自阶段 1 的 dry_run 预览（references 已列出会被改的引用方文件）。
  // ★ T214 续8：这三个是"失败 ⇒ 回滚"要用的（★ 声明在【拍快照那块之前】—— 否则"used before declaration" ✗）
  let snap: ReturnType<typeof snapshotBeforeWrite> = null;
  let failedAt = -1;
  let failedBlocked = '';
  /** ★ 2026-10-20：闸的放行读数（在拍快照那段里拿到；后面两个出口都要带它） */
  let gate: ReturnType<typeof assertSourceWriteRegisteredFor> | undefined;
  {
    const touched = new Set<string>();
    for (const p of previews) {
      if (p.from) touched.add(p.from);
      if (p.to) touched.add(p.to);
      for (const r of p.result?.references ?? []) if (r?.file) touched.add(r.file);
    }
    // ★★★ T336（2026-10-16）：**未登记不许落盘** —— 本函数是"真正落盘"的那一层，必须过任务闸。
    //   同族（`edit_code`）：闸调在**落盘前**，且**在拍快照之前**（拒绝就是拒绝，连快照都不该建）。
    //   ★ 闸的对象 = 本批**会动到的全部文件** —— 复用上面刚拼好的 `touched`
    //     （每条目的 from/to + 阶段 1 预览里列出的各 importer），不另立第二份清单。
    //   ★ 闸**不会**替你登记、也不降级放行：未登记 ⇒ 抛错、整批不落盘（与下方"回滚整批"同一目的）。
    // ★★★ 2026-10-20：返回值**不许再丢**（闸判了什么、豁免了谁，要随回执出去）。
    gate = assertSourceWriteRegisteredFor(projectDir, [...touched], resolveActor());
    // ★ T214 续8：**接住快照**（★ 否则失败时无从回滚 ✓ —— 原来这里把返回值丢了 ✗）
    snap = snapshotBeforeWrite(projectDir, `rename_files:${renames.length} 条`, [...touched]);
  }
  const applied: RenameFilesResult['applied'] = [];
  let filesWritten = 0;
  for (let i = 0; i < renames.length; i++) {
    const item = renames[i];
    const result = await renameFile({ project_dir: projectDir, from: item.from, to: item.to, dry_run: false });
    if (!result.ok) {
      // ★★★ T214 续8：**不再直接 return** —— ★ 先记住"在第几条失败"，★ 出循环后**用它回滚整批** ✓
      //   ★★ 原来这里 `return { …, applied, blocked: [… 已应用 N 条 …] }` ⇒ **已落盘的【保留】** ✗
      //     —— ★ 与 `rename_symbols` 修前同形（★ 那边 T214 已修 ✓）
      //   ★ 内层**只说它确知的**（★ "在第几条停下、之后未执行" ✓）；
      //   ★★ **"最终有没有回滚"由出循环后那一处补**（★ 那儿才拿着快照 ✓ —— ★ 与 T214 同一口径 ✓）
      failedAt = i;
      failedBlocked = `条目 ${i}（${item.from}→${item.to}）实际落盘时被阻断：${(result.blocked || []).join('；')}。★ 本批**在此停下**，之后条目未执行（★ **最终是否已整批回滚，看外层回执** ✓）`;
      break;
    }
    // ★ 2026-10-07：原先 += result.references.length（**引用处数**）—— 名字与注释互相矛盾，
    //   且同一份回执里 touched.written_files 有 3 条而本字段报 2：两个数说的不是一回事。
    //   现改为**据实算真·落盘文件数**：被移动的那个文件（moved）+ 被改写引用涉及的 importer（去重）。
    //   （RenameFileResult 本身没有 filesWritten 字段，但 moved 与 references 都是现成的数据 ——
    //     实测一次移动报 moved=1 + 2 个 distinct importer = 3，与 touched.written_files 对得上。）
    filesWritten += (result.moved ? 1 : 0) + new Set(result.references.map((x) => x.file)).size;
    applied.push({ index: i, from: item.from, to: item.to, result });
  }

  // ★★★ T214 续8（2026-10-13）：**中途失败 ⇒ 用写前快照回滚整批** —— ★ 这才真兑现"整批不落盘" ✓
  //   ★★ 与 `rename_symbols` 对称（★ 那边 T214 已修 ✓）；★ 本函数**本来就拍了快照**（`snap` ✓）
  //     ⇒ 原来**只差"失败时用它回滚"** ✗
  //   ★ 事后对不上时的口径（★ 与 T214 一致）：★ **回滚成功** ⇒ 明说"已回滚整批、项目回到改写前" ✓；
  //     ★★ **回滚失败 / 无快照** ⇒ **如实说"可能停在半改状态、请手动处理"** ✗（★ 不许只说"失败" ✓）
  if (failedAt >= 0) {
    let rolledBack: boolean;
    let rollbackNote: string;
    if (!snap?.id) {
      rolledBack = false;
      rollbackNote =
        '★★ **本批未落盘成功，且【没有可用快照】⇒ 无法自动回滚** —— ★ 项目可能停在半改状态，请手动处理';
    } else {
      const rb = rollbackFileSnapshot(projectDir, snap.id);
      rolledBack = rb.ok;
      rollbackNote = rb.ok
        ? `★ **已用写前快照回滚整批**（恢复 ${rb.restored.length} 个 / 删除 ${rb.removed.length} 个）` +
          '⇒ **项目回到改写前状态** ✓（★ 上面 `applied[]` 里列的文件**其实已被改回** ✓）'
        : `★★ **回滚失败**：${rb.message} —— ★ 项目可能停在半改状态，请手动处理`;
    }
    // ★ 2026-10-20：失败回执也要点名豁免（不是只有成功才报）。
    return attachGateNote(
      { ok: false, previews, applied, filesWritten, blocked: [failedBlocked], rolledBack, rollbackNote },
      gate,
    );
  }

  // ★ 2026-10-20：任务闸的放行读数（note / 豁免点名）随回执带出 —— 不再“做了不说”。
  return attachGateNote({ ok: true, previews, applied, filesWritten }, gate);
}

/** ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去 */
function touchedOf(input: RenameFilesInput, r: RenameFilesResult): Touched {
  const touched: Touched = {};
  // project_dir：★ **只从入参取**，入参没给就整项省略（裁定 2026-10-01）——
  //   这里**刻意不复刻** Core 的根解析（入参优先 → 首条 from 自动定位 → cwd 兜底）：
  //   ① 复刻 = 同一个判据两处各持一份 ⇒ Core 改了这里不改会**悄悄偏**，而且**不会红**（本仓头号病根）；
  //   ② 全族口径一致：`rename_symbol` / `find_references` 都只在入参显式给了才填；
  //   ③ `cwd` 兜底尤其不能要 —— 那会把它变成"**进程当前目录**"，不是本次调用**确立的对象**。
  if (typeof input.project_dir === 'string' && input.project_dir) {
    touched.project_dir = path.resolve(input.project_dir);
  }
  // ★ 只有真落盘了才给 written_files（dry_run / 被阻断 / ok:false 一律省略）：
  //   落盘路径下写过的文件 = 每条已应用条目的新文件（result.toRel）+ 各被改写引用的 importer（result.references[].file）。
  //   两者均为仓库相对路径（实现里经 toPosix(path.relative(...)) 产出）；被搬走的原文件（from）已不存在，不列。
  if (r.ok && !r.dryRun && r.applied.length > 0) {
    const written = new Set<string>();
    for (const a of r.applied) {
      written.add(a.result.toRel);
      for (const e of a.result.references) written.add(e.file);
    }
    touched.written_files = [...written];
  }
  return touched;
}

export async function renameFiles(input: RenameFilesInput): Promise<TouchedProduct<RenameFilesResult>> {
  const r = await renameFilesCore(input);
  return withTouched(r, touchedOf(input, r));
}