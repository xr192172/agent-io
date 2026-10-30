#!/usr/bin/env node
/**
 * audit:reach —— **工具有没有人用**（三个独立口径，避免单一信号误判）
 *
 * ## 为什么需要它
 * `npm run dogfood:coverage` 只答"烟测跑过哪些"（死工具 / 过期记录）。
 * 但它答不了另一个问题：**一个工具"零真调用"到底意味着"该删"还是"还没到用它的时候"？**
 * ⇒ 本脚本再加两个口径：
 *   ① **代码级引用**：该工具名在 `src/` 里除注册点外被提到多少次（0 = 真正孤立）
 *   ② **文档/证提及**：`docs/` + `certs/` + `scripts/` + README 里被提到多少次（有提及 = 有人在指望它）
 *   ③ **真调用 / 扫射调用**：`usage.jsonl`（★ 默认排除 `via=sweep|gate`）
 *
 * ## 三口径的判读（写死在这里，避免每次重新猜）
 * | 真调用 | 代码引用 | 文档提及 | 判读 |
 * |---|---|---|---|
 * | 0 | 0 | 0 | **孤立** ⇒ 退役候选（先跑 deprecate_offline 看它能否判） |
 * | 0 | 0 | >0 | **被宣传但没人用** ⇒ 要么补证（能力真实、还没到用的时候），要么删（前提不成立） |
 * | 0 | >0 | >0 | **有内部消费或强耦合** ⇒ 保留，补证 |
 * | >0 | — | — | 有真实使用 ⇒ 直接补证 |
 *
 * ## 用法
 *   npm run build && node scripts/audit-tool-reach.mjs            # 全部工具
 *   node scripts/audit-tool-reach.mjs translate ...               # 只看指定几个
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');

const only = process.argv.slice(2).filter((x) => !x.startsWith('-'));
const tools = TOOL_DEFS.map((t) => t.name).filter((n) => (only.length ? only.includes(n) : true));

function walk(dir, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.(ts|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const srcFiles = walk(path.join(ROOT, 'src'));
const docFiles = walk(path.join(ROOT, 'docs'))
  .concat(walk(path.join(ROOT, 'certs')))
  .concat(walk(path.join(ROOT, 'scripts')))
  .concat(['README.md', 'README.en.md', 'AGENTS.md', 'CONTRIBUTING.md'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)));

// 使用日志（不复用 dogfood_stats 的渲染，只要计数）
const logPath = path.join(ROOT, '.agentio-data/dogfood/usage.jsonl');
const usage = new Map();
if (fs.existsSync(logPath)) {
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const t = o.tool ?? '';
    if (!t) continue;
    const cur = usage.get(t) ?? { real: 0, sweep: 0 };
    if (o.via === 'sweep' || o.via === 'gate') cur.sweep++;
    else cur.real++;
    usage.set(t, cur);
  }
}

const verdict = (real, code, doc) => {
  if (real > 0) return '有真实使用 ⇒ 补证即可';
  if (code === 0 && doc === 0) return '★ 孤立 ⇒ 退役候选';
  if (code === 0 && doc > 0) return '★ 被宣传但没人用 ⇒ 要么补证、要么删（前提是否成立）';
  return '有内部耦合 ⇒ 保留 + 补证';
};

console.log('工具'.padEnd(28), '真调用'.padEnd(8), '扫射'.padEnd(6), '代码引用'.padEnd(9), '文档提及'.padEnd(9), '判读');
console.log('─'.repeat(110));
const rows = [];
for (const t of tools) {
  let codeHits = 0;
  for (const f of srcFiles) {
    const s = fs.readFileSync(f, 'utf8');
    if (!s.includes(t)) continue;
    if (s.includes(`name: '${t}'`)) continue; // 注册点不算
    codeHits += s.split(t).length - 1;
  }
  let docHits = 0;
  for (const f of docFiles) docHits += fs.readFileSync(f, 'utf8').split(t).length - 1;
  const u = usage.get(t) ?? { real: 0, sweep: 0 };
  const v = verdict(u.real, codeHits, docHits);
  rows.push({ t, ...u, codeHits, docHits, v });
  console.log(t.padEnd(28), String(u.real).padEnd(8), String(u.sweep).padEnd(6), String(codeHits).padEnd(9), String(docHits).padEnd(9), v);
}

const orphans = rows.filter((r) => r.v.startsWith('★'));
console.log(`\n合计 ${rows.length} 个工具；其中**需要判断**的 ${orphans.length} 个：`);
for (const o of orphans) console.log(`  · ${o.t} —— ${o.v}`);
console.log('\n★ 本脚本**只报告不判定**：退役要走 \`deprecate_offline\`（它的判据是"自研 + 无活跃消费 + 编译级验收"）。');
process.exit(0);
