#!/usr/bin/env node
/**
 * clean_dist —— 清掉 `dist/` 里「**源文件已不存在**」的孤儿产物。
 *
 * ★ 为什么需要它（2026-10-02 实测，这是 MCP server 起不来的**根因**）：
 *   `tsc` **不清 outDir**。而本仓刚经历 200+ 文件的大搬迁（按域重组）⇒ 旧位置编译出的
 *   `.js` / `.js.map` **一直留在 dist 里**，实测：**产物 1253 个，孤儿 609 个**（接近一半）。
 *   后果不是"占空间"，而是**新旧两套相对 import 混在同一条链上**：
 *     `dist/src/application/tool_registry.js` 里写着 `../../application/observe/index.js`
 *     ——那是它**还在 `presentation/mcp/` 时**的相对路径，被放在新位置后解析成
 *     `dist/application/observe/index.js`（不存在）⇒ **server 启动即 ERR_MODULE_NOT_FOUND**。
 *   更险的是 `dist/src/server.js`：源文件 `src/server.ts` 早搬走了，产物却还在 ——
 *   而 `~/.workbuddy/mcp.json` 曾**指着它**,于是整条 MCP 通道静默失效了很久没人发现。
 *
 * ★ 它同时是一把**量具**：读数（产物数 / 孤儿数）就是"dist 干净度"。
 *   ★★ 判据要问一句：「dist 里还有多少东西**没有任何源文件对应**」——
 *   只要不是 0，就说明"当前 dist 并不等于当前源码编译出来的东西"。
 *
 * 用法：
 *   node scripts/clean_dist.mjs --dry-run   # 只报读数与清单，不删
 *   node scripts/clean_dist.mjs             # 真删（顺带清理清空的目录）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
/**
 * ★ 只扫 `dist/src/` —— **判据范围要收窄，不能整个 dist 一起判**（2026-10-02 实测）：
 *   `dist/schema/design_dsl.schema.json` 是 `npm run gen:schema` 生成的，**不是 tsc 产物**，
 *   没有对应的 `.ts` ⇒ 按"源不存在即孤儿"会被**误删**。
 *   本脚本只管「tsc 编出来的东西」，别的生成物各归各的生成器管。
 */
const SCAN = path.join(DIST, 'src');
const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(SCAN)) {
  console.log('[clean_dist] dist/src 不存在，跳过。');
  process.exit(0);
}

/**
 * ★★★ T267（2026-10-14）：把 `src/` 下的 `.d.ts` **拷到 dist** —— `tsc` 不会为单文件开 `declaration`，
 *   而**外部项目插桩时需要它**。
 *
 * ## 为什么必须（实测）
 * `observe_instrument` 往**被测项目**注入的 import 指向 `<agent-io>/dist/…/probe.js`，
 * 而 dist 里没有 `.d.ts` ⇒ 严格项目必报 `TS7016: Could not find a declaration file …`
 * ⇒ 默认 `noEmitOnError:false` 还能跑，CI 一严就搭不起来。
 *
 * ## 为什么是"手写一份契约"而不是给全仓开 `declaration`
 * 全仓开 `declaration` 会为**几百个源文件**各产一份 `.d.ts`（大量无谓产物 + 又一批要清的孤儿）；
 * 而**外部真正需要的只有探针模块**那份。⇒ 只拷 `.d.ts`，且**它由人写、是契约不是镜像**
 *   （见 `src/infrastructure/analysis/observe/probe.d.ts` 头注：只声明外部真会用的成员）。
 *
 * ★ 与下面的孤儿判定不冲突：`sourceCandidates()` 本来就把 `${stem}.d.ts` 算作合法源
 *   ⇒ 拷进去的 `.d.ts` **不会被当孤儿删掉**（这正是它应有的地位）。
 */
const dtsSources = [];
{
  const walkSrc = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkSrc(p);
      else if (e.name.endsWith('.d.ts')) dtsSources.push(p);
    }
  };
  const SRC = path.join(ROOT, 'src');
  if (fs.existsSync(SRC)) walkSrc(SRC);
}
let dtsCopied = 0;
for (const abs of dtsSources) {
  const rel = path.relative(path.join(ROOT, 'src'), abs).split(path.sep).join('/');
  const dst = path.join(SCAN, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
  dtsCopied++;
}
if (dtsCopied > 0) console.log(`[clean_dist] 已把 ${dtsCopied} 份 \`.d.ts\` 契约声明带到 dist（T267：外部插桩项目需要）。`);

/** 收集 dist 下所有产物（相对 dist 的 posix 路径） */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(path.relative(DIST, p).split(path.sep).join('/'));
  }
  return out;
}

const all = walk(SCAN);

/** 产物 → 它应当来自的源文件（tsc 的 outDir=dist，rootDir=仓根 ⇒ 产物 path = src 的相对 path） */
function sourceCandidates(rel) {
  // ★★★ T267（2026-10-14）：`.d.ts` 产物**源就是它自己** ——
  //   下面那套是给 `.js` 产物用的（去后缀再拼 `.ts`），对 `x.d.ts` 会算出 `x.d.ts.ts`（不存在）
  //   ⇒ 实测：手写拷进 dist 的 `probe.d.ts` 当场被判成孤儿删掉（"已删除 1 个孤儿"）。
  //   ★ 这在 T267 之前是**潜伏 bug**：本仓此前没有 `.d.ts` 产物，所以从没暴露。
  if (rel.endsWith('.d.ts')) return [rel];
  const stem = rel.replace(/\.js\.map$/, '').replace(/\.js$/, '');
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`];
}

const orphans = all.filter((rel) => !sourceCandidates(rel).some((s) => fs.existsSync(path.join(ROOT, s))));

console.log(`[clean_dist] dist 产物 ${all.length} 个；**孤儿**（源文件已不存在）${orphans.length} 个。`);

/**
 * ★★★ 2026-10-22：**反向也要查**（源有、产物没有）。
 *
 * 此前只查孤儿 ⇒ 那句 "dist 与源码一一对应 ✓" 在**产物缺失**时照样打出来。
 * 它证明的只是「**没有多的**」，**没证明「也没有少的」**——而 "一一对应" 两者都要。
 *
 * ★ 这不是理论缺口，2026-10-22 实测踩了两次：
 *   `tsconfig` 开了 `incremental`（`tsBuildInfoFile` 在 `node_modules/.cache/`）⇒
 *   手动删掉某个产物后 `npm run build` **不会重编它**（tsc 认为该源文件没变），
 *   而本脚本报 ✓ ⇒ 接着跑去验证的**还是旧 build 的产物**（我据此连红两次，差点误判修复无效）。
 * ⇒ 判据：**每个 `src/**\/*.ts`（除 `.d.ts`）都必须有对应 `.js` 产物**，缺一个就不可信。
 * ★ 修法是 `rm node_modules/.cache/tsbuildinfo.json` 再 build（而不是在这里替 tsc 补编）。
 */
function walkSrc(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(p, out);
    else {
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel.startsWith('src/') && /\.tsx?$/.test(rel) && !rel.endsWith('.d.ts')) out.push(rel);
    }
  }
  return out;
}
const srcTs = walkSrc(path.join(ROOT, 'src'));
const missing = srcTs.filter((rel) => !fs.existsSync(path.join(DIST, rel.replace(/^src\//, 'src/').replace(/\.ts$/, '.js'))));

if (missing.length > 0) {
  console.error(`[clean_dist] ✗ **产物缺失 ${missing.length} 个**（源在、dist 里没有）—— dist 不可信：`);
  for (const m of missing.slice(0, 20)) console.error(`   (missing) ${m} ⇒ 期望 dist/${m.replace(/\.ts$/, '.js')}`);
  if (missing.length > 20) console.error(`   …还有 ${missing.length - 20} 个`);
  console.error(`   ★ 多半是 tsc 增量缓存认为"没变" ⇒ rm node_modules/.cache/tsbuildinfo.json && npm run build`);
  process.exit(1);
}
console.log(`[clean_dist] 反向检查：${srcTs.length} 个源文件，缺产物 0 个 ✓`);

// ★★ 2026-10-26：写「构建戳」`dist/.build-stamp`。
//   为什么需要它（实测根因，不是补丁）：
//     tsconfig.json:21 是 `incremental: true`（tsBuildInfoFile 在 node_modules/.cache）⇒
//     一个文件"改了又改回原样"时，tsc 按 tsbuildinfo 的哈希判定**未变更** ⇒ **跳过 emit**
//     ⇒ 该产物 mtime 停在旧值，而源 mtime 是新的 ⇒ `staleSourceWarning`（src 最大 mtime > dist 最大 mtime）
//     **永远喊脏**（假阳性；实测：test_contract.ts 源 14:57 vs 产物 01:33，内容其实一致）。
//   ⇒ 把戳写进 dist/ 里，现有的 `newestMtime(DIST_DIR)` 会自动把它算进最大 mtime ⇒ **一处生效、零改判据代码**；
//     而"真的改了 src 没 build"仍然会告警（戳不刷新）✓ —— 判据语义不变，只是基准变准。
// ★★ 2026-10-26（T-②）：写「构建清单」`dist/.build-manifest.json` —— **生产者存事实**。
//   替掉临时构建戳（`.build-stamp`）：戳只能回答"构建过没有"，清单能回答"**哪个源文件的产物对不上**"。
//   消费者 = `src/application/observe/runtime/stale_check.ts#checkStaleBuild`（**唯一判据实现**）。
//   ★ 为什么必须内容哈希：tsconfig 是 incremental，文件改了又改回原样时 tsc 跳过 emit
//     ⇒ 产物 mtime 停在旧值 ⇒ 纯 mtime 判据 100% 假阳性（实测 test_contract.ts 源 14:57 / 产物 01:33，内容一致）。
if (!dryRun) {
  try {
    const mod = await import(
      pathToFileURL(path.join(DIST, 'src/application/observe/runtime/stale_check.js')).href
    );
    const r = mod.writeBuildManifest(ROOT);
    console.log(`[clean_dist] 已写构建清单：${r.files} 个文件 → dist/.build-manifest.json`);
  } catch (e) {
    console.log(`[clean_dist] ⚠ 构建清单写入失败：${e?.message ?? e}（不影响产物，但 STALE_SOURCE 会退回 mtime 判据）`);
  }
}

if (orphans.length === 0) {
  console.log('[clean_dist] ⇒ dist 与源码一一对应 ✓（无孤儿 · 无缺失）');
  process.exit(0);
}

if (dryRun) {
  for (const o of orphans.slice(0, 40)) console.log(`   (would remove) ${o}`);
  if (orphans.length > 40) console.log(`   …还有 ${orphans.length - 40} 个`);
  console.log('⇒ --dry-run：未删除任何文件。');
  process.exit(0);
}

for (const rel of orphans) fs.rmSync(path.join(DIST, rel), { force: true });

/** 顺带清掉因此变空的目录（自底向上，删到 dist 为止） */
let removedDirs = 0;
function pruneEmpty(dir) {
  if (dir === SCAN) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) pruneEmpty(p);
  }
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      removedDirs += 1;
    }
  } catch {
    /* 非空或占用：留着，不是错误 */
  }
}
for (const e of fs.readdirSync(SCAN)) {
  const p = path.join(SCAN, e);
  if (fs.statSync(p).isDirectory()) pruneEmpty(p);
}

console.log(`[clean_dist] 已删除 ${orphans.length} 个孤儿产物、${removedDirs} 个空目录。`);
console.log('★ 现在 dist 只含"当前源码编译出来的东西"——这才配得上"dist 是最新的"这句话。');
