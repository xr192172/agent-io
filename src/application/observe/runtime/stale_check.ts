/**
 * stale_check —— 检测「源码比编译产物新」的 STALE BUILD（文件级精确）
 *
 * 痛点：agent-io 自身 `npm run build` 产出 dist/（tsc）。改 src 下 ts 后忘了
 * 重跑 build，MCP server / CLI 跑的是旧 dist——行为与源码不符，排查浪费时间。
 *
 * 判定：对每个可编译源码文件（src 下 ts/tsx），找其对应 dist 产物
 *   src/foo.ts          → dist/src/foo.js
 *   src/tools/x.ts      → dist/src/tools/x.js
 * 若源文件 mtime > 产物 mtime（或产物缺失）→ stale。
 *
 * 忽略范围（生成文件/非手写源）：
 *   - gen.ts 后缀（构建脚本生成，改它=必然重跑 build，不算待重建的源）
 *   - AGENTS.md / .trae / docs 等非 src 内容（只盯 src/ 下手写 TS）
 *
 * 只读，不改文件。可被 run_tests/diagnose 前置调用，或独立 CLI 跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ─────────────────────────────────────────────────────────────
// ★★★ 2026-10-26（T-②）：**本文件是「dist 是否最新」的【唯一判据实现】**。
//
// 病史（写死，别再退回两套）：此前有两套判据同时活着 ——
//   ① `presentation/mcp/server_registry.ts#staleSourceWarning`：比「src 树最大 mtime」vs「dist 树最大 mtime」；
//   ② 本文件 `checkStaleBuild`：逐文件比 mtime。
// 同一事实两个判据 ⇒ 修好一个另一个还在喊（实测：①已不报，②仍报「3/354 文件」）。
//
// 而且两套都只靠 mtime —— 而 `tsconfig.json` 是 `incremental: true`：
//   文件改了**又改回原样**时，tsc 按 tsbuildinfo 的哈希判定未变更 ⇒ **跳过 emit**
//   ⇒ 产物 mtime 停在旧值，源 mtime 是新的 ⇒ **mtime 判据 100% 假阳性**
//   （实测：test_contract.ts 源 14:57 vs 产物 01:33，**内容其实一致**）。
//
// ⇒ 现在：**mtime/size 只做廉价触发**，命中后**内容哈希才是判定**；
//   哈希基准来自构建时写的 `dist/.build-manifest.json`（生产者存事实，消费者不猜）。
// ─────────────────────────────────────────────────────────────

/** 构建清单（生产者：`scripts/clean_dist.mjs` 构建成功时写；消费者：本文件判新旧） */
export interface BuildManifest {
  /** 构建完成时刻（ISO） */
  stamp: string;
  /** 仓库相对源路径 → { 产物相对路径, 源内容 sha1, 源 mtime, 源 size } */
  files: Record<string, { out: string; hash: string; mtime: number; size: number }>;
}

export const BUILD_MANIFEST_NAME = '.build-manifest.json';

/** 清单路径：`<root>/dist/.build-manifest.json` */
export function buildManifestPath(root: string): string {
  return path.join(path.resolve(root), 'dist', BUILD_MANIFEST_NAME);
}

/** 读清单；不存在 / 坏 JSON ⇒ null（调用方退回 mtime 兜底并如实标 basis） */
export function readBuildManifest(root: string): BuildManifest | null {
  try {
    const raw = fs.readFileSync(buildManifestPath(root), 'utf-8');
    const m = JSON.parse(raw) as BuildManifest;
    if (!m || typeof m !== 'object' || !m.files || typeof m.files !== 'object') return null;
    return m;
  } catch {
    return null;
  }
}

/**
 * ★ 生产者入口：构建成功后写清单（由 `scripts/clean_dist.mjs` 在 tsc 之后调）。
 * 只收 `src/` 下手写 `.ts/.tsx`（与 `checkStaleBuild` 的走查规则**同一套**，否则两边会各数一套）。
 */
export function writeBuildManifest(root: string): { files: number; stamp: string } {
  const rootAbs = path.resolve(root);
  const sources: string[] = [];
  walkSrcSources(rootAbs, sources);
  const files: BuildManifest['files'] = {};
  for (const srcAbs of sources) {
    const rel = path.relative(rootAbs, srcAbs).replace(/\\/g, '/');
    let buf: Buffer;
    try {
      buf = fs.readFileSync(srcAbs);
    } catch {
      continue;
    }
    files[rel] = {
      out: path.relative(rootAbs, distOutFor(rootAbs, srcAbs)).replace(/\\/g, '/'),
      hash: crypto.createHash('sha1').update(buf).digest('hex'),
      mtime: Math.round(mtimeOf(srcAbs)),
      size: buf.length,
    };
  }
  const stamp = new Date().toISOString();
  const manifest: BuildManifest = { stamp, files };
  fs.mkdirSync(path.dirname(buildManifestPath(rootAbs)), { recursive: true });
  fs.writeFileSync(buildManifestPath(rootAbs), JSON.stringify(manifest, null, 0) + '\n');
  return { files: Object.keys(files).length, stamp };
}

export interface StaleEntry {
  /** 相对项目根的源码路径（POSIX） */
  src: string;
  /** 对应 dist 产物路径（相对项目根） */
  out: string;
  /** 产物缺失（true）或比源旧（false） */
  missing: boolean;
  /** 源文件 mtime（ms） */
  srcMtime: number;
  /** 产物 mtime（ms；missing 时 0） */
  outMtime: number;
  /** ★ T-②：判成 stale 的原因（缺产物 / 内容哈希对不上） */
  why?: 'missing' | 'changed';
}

export interface StaleCheckResult {
  ok: boolean;
  /** 是否发现 stale（有未重建产物） */
  stale: boolean;
  /** stale 条目（文件级） */
  entries: StaleEntry[];
  /** 扫描的源码文件数 */
  scanned: number;
  /** 项目根 */
  root: string;
  /** ★ T-②：本次判定依据 —— `manifest`（内容哈希，权威）/ `mtime`（无清单时的兜底，如实标注） */
  basis: 'manifest' | 'mtime';
}

/** 忽略的源码文件名模式（生成文件，改它必重跑 build，不算待重建） */
const GEN_SRC_RE = /\.gen\.ts$/;

/** src 下递归收集手写 .ts/.tsx 源文件（排除 *.gen.ts） */
function walkSrcSources(root: string, out: string[]): void {
  const srcDir = path.join(root, 'src');
  if (!fs.existsSync(srcDir)) return;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.isFile() && /\.tsx?$/.test(e.name) && !GEN_SRC_RE.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(srcDir);
}

/**
 * 源文件 → dist 产物路径。
 *
 * 两种产出方式必须分开映射（否则判据会报假"缺产物"）：
 *   · **`.ts` / `.tsx`**：`tsc` 编译 ⇒ `src/x.ts → dist/src/x.js`（rootDir='.' 的相对映射）；
 *   · **`.d.ts`**：声明文件，`tsc` **不为它 emit** ⇒ 由 `scripts/clean_dist.mjs` **原样拷到同一相对路径**
 *     （`src/x.d.ts → dist/src/x.d.ts`，T267「外部插桩项目需要」）。
 *     ★ 2026-10-26 实测：原先这里一律按 `.js` 映射 ⇒ `probe.d.ts` 恒判「缺产物」（唯一的 stale 条目）。
 */
function distOutFor(root: string, srcAbs: string): string {
  const rel = path.relative(root, srcAbs); // src/foo.ts
  if (/\.d\.ts$/.test(rel)) return path.join(root, 'dist', rel);
  const relNoExt = rel.replace(/\.tsx?$/, '');
  return path.join(root, 'dist', relNoExt + '.js');
}

/** 文件 mtime（ms），不存在返回 -1 */
function mtimeOf(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return -1;
  }
}

/**
 * 判定 dist 是否最新（**本判据的唯一实现**）。
 *
 * 两级：
 *   · **触发**：产物缺失 ⇒ 直接 stale；否则 mtime/size 与清单记录不同 ⇒ 进入第二级（哈希）；
 *   · **判定**：算源文件当前 sha1，与清单里的 `hash` 比 —— **相同 ⇒ 不算 stale**。
 *     ★ 这一级正是为增量编译的"改了又改回"准备的：mtime 变了但内容没变 ⇒ 产物仍是最新的。
 *   · 无清单（旧仓 / 未 build）⇒ 退回纯 mtime，并在 `basis` 里**明说**（不假装是哈希判的）。
 */
export function checkStaleBuild(root: string): StaleCheckResult {
  const rootAbs = path.resolve(root);
  const sources: string[] = [];
  walkSrcSources(rootAbs, sources);
  const manifest = readBuildManifest(rootAbs);
  const basis: 'manifest' | 'mtime' = manifest ? 'manifest' : 'mtime';
  const entries: StaleEntry[] = [];
  for (const srcAbs of sources) {
    const rel = path.relative(rootAbs, srcAbs).replace(/\\/g, '/');
    const outAbs = distOutFor(rootAbs, srcAbs);
    let buf: Buffer;
    try {
      buf = fs.readFileSync(srcAbs);
    } catch {
      continue; // 源读不到（极端），跳过
    }
    const srcM = mtimeOf(srcAbs);
    const outM = mtimeOf(outAbs);
    if (outM < 0) {
      entries.push({
        src: rel,
        out: path.relative(rootAbs, outAbs).replace(/\\/g, '/'),
        missing: true,
        srcMtime: Math.round(srcM),
        outMtime: 0,
        why: 'missing',
      });
      continue;
    }
    const rec = manifest?.files?.[rel];
    if (!rec) {
      // 清单里没这条（新增文件 / 旧清单）⇒ 退回 mtime 判
      if (outM < srcM) {
        entries.push({
          src: rel,
          out: path.relative(rootAbs, outAbs).replace(/\\/g, '/'),
          missing: false,
          srcMtime: Math.round(srcM),
          outMtime: Math.round(outM),
          why: 'changed',
        });
      }
      continue;
    }
    // 第一级：mtime/size 与构建时一致 ⇒ 一定没变（免哈希）
    if (Math.round(srcM) === rec.mtime && buf.length === rec.size) continue;
    // 第二级：内容哈希 —— 相同则不算 stale（增量编译跳 emit 的假阳性死在这一步）
    if (crypto.createHash('sha1').update(buf).digest('hex') === rec.hash) continue;
    entries.push({
      src: rel,
      out: path.relative(rootAbs, outAbs).replace(/\\/g, '/'),
      missing: false,
      srcMtime: Math.round(srcM),
      outMtime: Math.round(outM),
      why: 'changed',
    });
  }
  entries.sort((a, b) => a.src.localeCompare(b.src));
  return {
    ok: true,
    stale: entries.length > 0,
    entries,
    scanned: sources.length,
    root: rootAbs,
    basis,
  };
}

/** 人类可读摘要（供 CLI/doctor 复用） */
export function formatStaleText(r: StaleCheckResult): string {
  if (!r.stale) return `✓ 无 STALE BUILD：${r.scanned} 个手写源均已重建（dist 最新）`;
  const lines = [`⚠ STALE BUILD：${r.entries.length}/${r.scanned} 个源码文件比 dist 新（未重跑 npm run build）`];
  for (const e of r.entries.slice(0, 30)) {
    lines.push(`  - ${e.src} → ${e.missing ? '缺产物' : `产物旧(源 ${new Date(e.srcMtime).toISOString().slice(11, 19)} vs 产物 ${new Date(e.outMtime).toISOString().slice(11, 19)})`}`);
  }
  if (r.entries.length > 30) lines.push(`  … 其余 ${r.entries.length - 30} 个`);
  lines.push(`  → 跑 npm run build 重建后生效`);
  return lines.join('\n');
}
