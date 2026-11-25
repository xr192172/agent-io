#!/usr/bin/env node
/**
 * index-integrity-gate —— 「索引可信度进门」（批 3 · G4 · M6 最高优先级）。
 *
 * ## 治哪个洞
 * 此前 `index_integrity` 只是 MCP 工具 / 手动读数，不在 `npm run verify` 总门里：索引陈旧断言
 * （`stale_resolved_refs`）/ 保鲜范围内未同步（`files_not_fresh`）/ 幽灵行（`ghost_files`）/
 * schema 过期 / 变更集读不了，都不会让总门响。本门把 `index_integrity` 的三态 verdict 接进总门。
 *
 * ## 判据（判定核只在 `src/application/meta/integrity/index_integrity.ts`，本脚本不重写）
 * · `trusted`  ⇒ 退出 0（索引可信）；
 * · `untrusted` ⇒ 退出 1（有 blocker / 幽灵行，逐条点名 issue）；
 * · `unknown`  ⇒ 退出 2（判不了：无索引 / 读不到 —— 不折成 0，也不折成 1）。
 *
 * ★ 只读：`refresh:false`，不顺手保鲜、不写索引；读不到 dist ⇒ 退出 2（先 `npm run build`）。
 * ★ 不弱化既有门：本门是新增趋严读数，不改任何既有 GATES 判定。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distUrl = (...p) => pathToFileURL(path.join(repoRoot, 'dist', 'src', ...p)).href;

const argv = process.argv.slice(2);
const fullNav = argv.includes('--full');
const projectDir = path.resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd());

let indexIntegrity;
try {
  ({ indexIntegrity } = await import(distUrl('application', 'meta', 'integrity', 'index_integrity.js')));
} catch (e) {
  console.error(`✗ 判不了（退出码 2）：读不到 index_integrity 模块（${(e && e.message) || e}）⇒ 先 \`npm run build\`。`);
  process.exit(2);
}

let result;
try {
  result = await indexIntegrity({ project_dir: projectDir, refresh: false, navigation: fullNav ? 'full' : 'short' });
} catch (e) {
  console.error(`✗ 判不了（退出码 2）：index_integrity 现算抛错：${String(e).slice(0, 160)}`);
  process.exit(2);
}

const verdict = result.verdict;
const label = { trusted: '可信', untrusted: '不可信', unknown: '判不了' }[verdict] ?? verdict;
console.log(`索引可信度：${verdict}（${label}）｜ 导航：${result.navigation ?? 'short'}${fullNav ? '（全量）' : '（摘要）'}`);
if (result.summary) console.log(`  ${result.summary}`);

const blockers = (result.issues ?? []).filter((i) => i.severity === 'blocker');
for (const iss of blockers) {
  console.error(`  ✗ [${iss.code}] ${iss.message}${iss.fix ? ` → ${iss.fix}` : ''}`);
}
if ((result.stale_names ?? []).length > 0) {
  console.error(`  陈旧断言点名（前 ${result.stale_names.length}）：`);
  for (const s of result.stale_names.slice(0, 20)) console.error(`    · ${s.file}:${s.line ?? ''} ${s.name ?? ''}`);
}

if (verdict === 'trusted') process.exit(0);
if (verdict === 'untrusted') process.exit(1);
process.exit(2);
