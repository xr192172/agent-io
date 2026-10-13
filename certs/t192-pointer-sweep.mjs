/**
 * T192 量具：**"指路到工具"的地方，有几个指向了不在册的名字？**
 *
 * ## ★★ v1 的错（我当场修）
 * v1 把"任何 snake_case 标识符"都算可疑 ⇒ **196 处"强可疑"**，绝大多数是**字段名**
 * （`project_dir` / `timeout_ms`）与**历史叙述**（"原 `translate_cli` 的 --batch-size"）
 * ⇒ ★ **度量不判别**（与 T189 v1 同款错：**没先说清"要数的是哪个问题"**）。
 *
 * ## v2 的判据（收窄到"真的在指路"）
 * 只认**这一种形状**：**祈使词**（请先使用 / 请使用 / 使用 / 改用 / 调用 / 用）
 * **紧跟**一个**反引号包住或裸的** `snake_case` 名 ⇒ 那才是在**叫人去用某个东西**。
 * 再看那个名字**在不在 `TOOL_DEFS` 里**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';

const known = new Set(TOOL_DEFS.map((d) => d.name));
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p.replace(/\\/g, '/'));
  }
};
walk('src');

// ★ 祈使词**紧跟**名字（允许中间有反引号/冒号/空格）
const RE = /(?:请先使用|请使用|可以先使用|建议使用|使用|改用|调用|换成|用)\s*[:：]?\s*`?([a-z][a-z0-9]*(?:_[a-z0-9]+){1,3})`?/g;

const dead = [];
const alive = [];
for (const f of files) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(RE)) {
      const tok = m[1];
      const rec = { tok, where: `${f}:${i + 1}`, line: line.trim().slice(0, 140) };
      (known.has(tok) ? alive : dead).push(rec);
    }
  });
}
const dedup = (a) => {
  const s = new Set();
  return a.filter((r) => (s.has(r.tok + r.where) ? false : (s.add(r.tok + r.where), true)));
};
const D = dedup(dead);
const A = dedup(alive);
console.log(`工具总数 ${known.size} · 扫了 ${files.length} 个源文件`);
console.log(`\n════ ✅ 指路到【在册】工具: ${A.length} 处（抽样 6）`);
for (const r of A.slice(0, 6)) console.log(`  ${r.tok.padEnd(22)} ${r.where}`);
console.log(`\n════ ★★★ 指路到【不在册】的名字: ${D.length} 处`);
const byTok = new Map();
for (const r of D) (byTok.get(r.tok) ?? byTok.set(r.tok, []).get(r.tok)).push(r);
for (const [tok, rs] of [...byTok.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ★ ${tok}  （${rs.length} 处）`);
  for (const r of rs.slice(0, 3)) console.log(`      ${r.where}\n        ${r.line}`);
}
