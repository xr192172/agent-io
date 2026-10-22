#!/usr/bin/env node
/**
 * cert/门 —— **源文件 ↔ 设计节点 的对账**（2026-10-22 · 用户点破后补）
 *
 * ## 为什么非有它不可
 * 本仓有「册子 → 代码」的判据（`symbol-exists` / `call-exists` / `signature-matches`），
 * 但**没有「代码 → 册子」**。⇒ 后果实测（2026-10-22）：
 * ```
 * src/infrastructure/source_write_port.ts 是当天新建的源文件
 * 设计册里【匹配节点数 = 0】
 * 而 npm run verify 【7 门全绿】
 * ```
 * ⇒ **新建的源文件永远不参与对拍**（设计之外的一片飞地），而没有任何门会说"漏了一个"。
 *
 * 用户原话（这条门的来历）：
 * > 「你先挂一个任务……如果没有设计 DSL 和设计 DB，就是你没写这个那你就要先把这个完善，
 * >   **两边对上了才是判据**」
 * ⇒ 这句里的"两边"是**双向**的。只做一个方向，等于只对了一半。
 *
 * ## 判据（唯一一处）
 * `src/**\/*.ts`（**排除 `*.d.ts`**：类型声明不是实现，不该逼它进铺排）里，
 * 每个文件都必须在**至少一本册**里有一个 file/doc 节点，且该节点的 `path`（或 `description`）**逐字等于**它。
 *
 * ★ 为什么跨**所有**册：一个文件可能归 `task-system-plan`，也可能归 `design-canvas`；
 *   按单册算会误报（实测 design-canvas 175 + task-system-plan 543 有大量同名节点）。
 * ★ 比对用 `nodePath` 口径（`path ?? (file|doc 才回落 description)`）——
 *   聚合节点的 description 是**人话不是路径**，不能当路径用（那是写闸踩过的坑）。
 *
 * ## 出口
 * 0 = 全覆盖；1 = 有漏（逐个点名，带"这个文件是干什么的"第一句，方便直接补节点）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const HOME = process.env.AGENT_IO_HOME ?? path.join(ROOT, '.agent-io');
const DESIGN_DIRS = [
  path.join(HOME, '.agent-io', 'design'),
  path.join(ROOT, '.agent-io', 'design'),
];

/** 收集所有册里的 .ts 路径（★ nodePath 口径：path ?? 只对 file/doc 回落 description） */
function collectKnownPaths() {
  const known = new Set();
  const seen = new Set();
  for (const dir of DESIGN_DIRS) {
    if (!fs.existsSync(dir) || seen.has(dir)) continue;
    seen.add(dir);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.dsl.json')) continue;
      let dsl;
      try {
        dsl = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      } catch {
        continue; // 坏 JSON 不在这里报（别的门管）
      }
      for (const n of dsl.geometry?.nodes ?? []) {
        const p = n.path ?? ((n.type === 'file' || n.type === 'doc') ? n.description : null);
        if (p && String(p).endsWith('.ts')) known.add(String(p));
      }
    }
  }
  return known;
}

/** src 下所有实现文件（排除 .d.ts） */
function walkSrc(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(abs, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      out.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
    }
  }
  return out;
}

const known = collectKnownPaths();
const files = walkSrc(path.join(ROOT, 'src'));
const missing = files.filter((f) => !known.has(f));

console.log(`══ 源文件 ↔ 设计节点 对账 ══`);
console.log(`册子里的 .ts 节点: ${known.size} · src 实现文件: ${files.length} · 覆盖: ${files.length - missing.length}/${files.length}`);

if (missing.length === 0) {
  console.log(`✓ 全覆盖（每个源文件都在设计册里）`);
  process.exit(0);
}

console.log(`\n✗ ${missing.length} 个源文件【设计册里没有节点】：`);
for (const m of missing) {
  let hint = '';
  try {
    const txt = fs.readFileSync(path.join(ROOT, m), 'utf-8');
    const first = (txt.match(/^\/\*\*([\s\S]{0,300})/) ?? [])[1];
    if (first) {
      const line = first.split('\n').map((s) => s.replace(/^\s*\*?\s?/, '').trim()).find((s) => s && !s.startsWith('*'));
      if (line) hint = ' — ' + line.replace(/^[★\s]+/, '').slice(0, 70);
    }
  } catch { /* 读不到就不给提示，不影响判定 */ }
  console.log(`  · ${m}${hint}`);
}
console.log(
  `\n★ 怎么办（二选一，不许"加白名单绕过去"）：\n` +
  `  ① 补节点：\`edit_dsl { type:'node', op:'add', data:{...} }\` —— 至少给 id/label/type='file'/description=<路径>\n` +
  `  ② 如果它**确实不该在设计册里**（比如纯类型声明）⇒ 那要在**判据里**说明（本门已排除 \`*.d.ts\`），\n` +
  `     而不是在运行期加例外表 —— 例外表会变成第二份判据。`,
);
process.exit(1);
