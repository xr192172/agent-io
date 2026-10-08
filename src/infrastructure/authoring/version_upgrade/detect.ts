/**
 * detect：版本升级契约差 · 共享检测编排（供 `upgrade` 工具复用；原 upgrade_cli / upgrade_rewrite_cli
 * 两个 CLI 已于 2026-10-06 删除 —— 能力归位到 `application/meta/upgrade/upgrade.ts`）—— 通用内核
 *
 * 把"按子项目扫描"的编排逻辑从 CLI 抽出来，语言差异全部委托给适配器注册表：
 *   1. 工具链声明（阶段 A）→ 每个子项目声明什么运行时版本
 *   2. 语言特性契约差（阶段 B）→ 用了超过声明版本的语言特性
 *   3. 废弃/移除 API（阶段 C）→ 用了目标版本已移除/废弃的 API
 *
 * 边界规则：
 *   - 每个声明的扫描目录 = 该子项目目录；根目录声明（"."）只扫根自身源码，
 *     跳过嵌套子项目目录，避免重复报告。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  scanToolchains,
  type ToolchainDeclaration,
  type ToolchainScan,
  type ToolName,
} from './toolchain.js';
import { adapterForLang, ALL_ADAPTER_EXTS } from './adapters/registry.js';
import { scanFeatureHits, type FeatureHit } from './features.js';
import { scanRemovedApis, type RemovedHit } from './removed.js';
import { skipDirSet, isSourceExt } from '../../parse/source_exts.js';

/** 语言 → 源码扩展名（来自适配器；保持导出以兼容既有调用方） */
export const FEATURE_EXTS: Record<ToolName, string[]> = Object.fromEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (['java', 'go', 'node', 'python'] as ToolName[]).map((t) => [t, adapterForLang(t)?.sourceExts ?? []])
) as Record<ToolName, string[]>;

/** 声明版本 → 检测的目标边界（各语言边界语义见适配器 featureBoundary） */
export function declaredToFeatureVersion(tool: ToolName, declaredVersion: string): number | null {
  const adapter = adapterForLang(tool);
  if (!adapter) return null;
  const info = adapter.parseVersion(declaredVersion);
  return info ? adapter.featureBoundary(info) : null;
}

/** 各子项目根目录（相对 root；"." = 根目录本身） */
export function projectDirs(declarations: ToolchainDeclaration[]): Set<string> {
  return new Set(declarations.map((d) => d.projectDir));
}

/** 目录 dir 之下需要跳过的嵌套子项目根（相对 dir） */
export function nestedProjectDirs(dir: string, allDirs: Set<string>): Set<string> {
  const prefix = dir === '.' ? '' : `${dir}/`;
  const out = new Set<string>();
  for (const p of allDirs) {
    if (p === '.' || p === dir) continue;
    if (p.startsWith(prefix)) out.add(p.slice(prefix.length));
  }
  return out;
}

/**
 * 收集 dir 下指定扩展名的源码文件（跳过构建产物/依赖目录）。
 * @param excludeRelDirs 相对 dir 的子目录路径集合，命中则不深入（按子项目边界隔离）
 * @param unmatched      可选输出：**扫到但没被 `exts` 收下**的扩展名 → 文件数。
 *   ★★ 2026-10-08 口径修正：原先这里**内联了调用方的政策**
 *     （`SOURCE_EXTS.includes(ext) && !ALL_ADAPTER_EXTS.has(ext)`，即「版本升级适配器管不管」）。
 *     共用走查**不许持调用方的政策** —— 它会让下一个调用方被迫吞下前一个的口径：
 *     `code_health` 问的是「哪些后缀**我没有解析器**」，与「适配器管不管」**是两个问题**，
 *     而适配器恰好覆盖 `.java/.rs/.cs` 等一大堆 `code_health` 真读不了的后缀 ⇒ 真话被滤掉。
 *   ⇒ 走查只报**事实**（哪些后缀没被收下、各有几个），**判「哪些该报出来」留给调用方**。
 */
export function collectSourceFiles(
  dir: string,
  exts: string[],
  excludeRelDirs?: Set<string>,
  unmatched?: Map<string, number>
): Array<{ rel: string; content: string }> {
  const out: Array<{ rel: string; content: string }> = [];
  const skip = skipDirSet(['target', 'bin', 'vendor']);
  const stack: Array<{ abs: string; rel: string }> = [{ abs: dir, rel: '' }];
  while (stack.length > 0) {
    const { abs, rel } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(abs, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (skip.has(e.name) || e.name.startsWith('.')) continue;
        if (excludeRelDirs?.has(relPath)) continue;
        stack.push({ abs: full, rel: relPath });
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!exts.includes(ext)) {
          // ★ 只记**事实**（这个后缀没被本次 `exts` 收下）——判它重不重要是**调用方**的事，见 @param unmatched。
          if (unmatched) unmatched.set(ext, (unmatched.get(ext) ?? 0) + 1);
          continue;
        }
        try {
          out.push({ rel: relPath, content: fs.readFileSync(full, 'utf-8') });
        } catch {
          // 读失败跳过
        }
      }
    }
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/** 某声明的源码扫描输入（路径为相对该子项目） */
export interface DeclarationFiles {
  declaration: ToolchainDeclaration;
  boundary: number | null;
  files: Array<{ path: string; content: string }>;
}

/** 对每条声明装配扫描输入（含嵌套子项目隔离）
 *  @param unmatched 可选输出：扫到但没被本次 `exts` 收下的扩展名 → 文件数（原样转交 `collectSourceFiles`；
 *                   它只记事实，「哪些该报」由调用方筛 —— 见那里的 @param unmatched）
 */
export function filesForDeclarations(
  root: string,
  declarations: ToolchainDeclaration[],
  unmatched?: Map<string, number>
): DeclarationFiles[] {
  const allDirs = projectDirs(declarations);
  return declarations.map((d) => {
    const boundary = declaredToFeatureVersion(d.tool, d.declaredVersion);
    const dir = path.join(root, d.projectDir === '.' ? '' : d.projectDir);
    const excluded = nestedProjectDirs(d.projectDir, allDirs);
    const files = collectSourceFiles(dir, adapterForLang(d.tool)?.sourceExts ?? [], excluded, unmatched).map((f) => ({
      path: f.rel,
      content: f.content,
    }));
    return { declaration: d, boundary, files };
  });
}

/** 一次契约差扫描的完整结果 */
export interface ContractScanResult {
  root: string;
  scan: ToolchainScan;
  /** 阶段 B：按声明的语言特性超标命中 */
  features: Array<{ declaration: ToolchainDeclaration; boundary: number; hits: FeatureHit[] }>;
  /** 阶段 C：按声明的废弃/移除 API 命中 */
  removed: Array<{ declaration: ToolchainDeclaration; boundary: number; hits: RemovedHit[] }>;
  /** 扫到、属源码、但**无语言适配器** ⇒ 未被检查的扩展名 → 文件数（§2d：少做事必须可见） */
  uncoveredExts: Array<{ ext: string; files: number }>;
}

/** 一键扫描：工具链盘点 + 语言特性 + 废弃/移除 API */
export function runContractScan(root: string): ContractScanResult {
  const scan = scanToolchains(root);
  const unmatched = new Map<string, number>();
  const inputs = filesForDeclarations(root, scan.declarations, unmatched);
  const features: ContractScanResult['features'] = [];
  const removed: ContractScanResult['removed'] = [];
  for (const { declaration: d, boundary, files } of inputs) {
    if (boundary == null) continue;
    const fh = scanFeatureHits(files, boundary);
    if (fh.length > 0) features.push({ declaration: d, boundary, hits: fh });
    const rh = scanRemovedApis(files, boundary);
    if (rh.length > 0) removed.push({ declaration: d, boundary, hits: rh });
  }
  // ★★ 政策**搬到这里**（原先内联在 `collectSourceFiles` 的走查里）：
  //   「属源码（`SOURCE_EXTS`）∩ **不被任何适配器覆盖**」才是**本工具**意义上的「少做了什么」。
  //   判据用 `ALL_ADAPTER_EXTS` 的**并集**、不是本次那条声明的 ext —— 否则多语言仓库里
  //   每个文件都会被记成「未覆盖」（实测踩过：`.nvmrc`(node) 声明下一个 `a.py` 被误报）。
  const uncoveredExts = [...unmatched.entries()]
    .filter(([ext]) => isSourceExt(ext) && !ALL_ADAPTER_EXTS.has(ext))
    .map(([ext, files]) => ({ ext, files }))
    .sort((a, b) => (b.files === a.files ? (a.ext < b.ext ? -1 : 1) : b.files - a.files));
  return { root, scan, features, removed, uncoveredExts };
}
