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
import { resolveProjectRoot } from '../../cross/project_root.js';
import { snapshotBeforeWrite } from '../snapshot/file_snapshot.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

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
  /** 累计引用改写处数（跨条可能重复计入同一 importer 的多次命中） */
  filesWritten: number;
  /** 整体阻断理由（ok=false 时给出全部） */
  blocked?: string[];
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
  {
    const touched = new Set<string>();
    for (const p of previews) {
      if (p.from) touched.add(p.from);
      if (p.to) touched.add(p.to);
      for (const r of p.result?.references ?? []) if (r?.file) touched.add(r.file);
    }
    snapshotBeforeWrite(projectDir, `rename_files:${renames.length} 条`, [...touched]);
  }
  const applied: RenameFilesResult['applied'] = [];
  let filesWritten = 0;
  for (let i = 0; i < renames.length; i++) {
    const item = renames[i];
    const result = await renameFile({ project_dir: projectDir, from: item.from, to: item.to, dry_run: false });
    if (!result.ok) {
      return {
        ok: false,
        previews,
        applied,
        filesWritten,
        blocked: [`条目 ${i}（${item.from}→${item.to}）实际落盘时被阻断：${(result.blocked || []).join('；')}。已应用 ${applied.length} 条，之后条目未执行`],
      };
    }
    filesWritten += result.references.length;
    applied.push({ index: i, from: item.from, to: item.to, result });
  }

  return { ok: true, previews, applied, filesWritten };
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