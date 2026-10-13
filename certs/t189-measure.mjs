/**
 * T189 量具：**管道缺在哪** —— ★ 而本量具的第一版**度量写错了**，这里记下来当反面教材。
 *
 * ## ★★ v1 的错（差点报出 4 个假发现）
 * v1 数的是"**有多少工具的 `inputSchema` 里有个同名键**" —— 于是 `scope_files`/`written_files`/
 * `symbols`/`nodes` 全报 **0 个消费者**，看着像 **4 个死锚点**。
 * ★ **但那是错的**：链边的 `toPath` **名字本来就不同** ——
 *   `scope_files → edit_code.file` · `written_files → rename_symbols.renames[].file` ·
 *   `symbols → edit_code.symbol` · `nodes → derive_chain.node_ids`。
 *   ⇒ ★ **"名字翻译"正是这张表存在的理由**，所以"同名才算收"**根本不是那个问题**。
 * ⇒ 教训：**先说清"我要数的到底是哪个问题"，再写度量**；★ 差一步就把"度量选错"报成"仓库有病"。
 *
 * ## v2 数的（= 真问题）
 * 对每个 `Touched` 键：**经 `CHAIN_EDGES` 能到几个不同的下游工具**（不含通配边的 `ANY_TOOL`）。
 *  · 有条边 ⇒ 这个键**可被交接**（要不要连是**意图**问题，逐条判）；
 *  · **0 条边**（且通配也不覆盖）⇒ ★ 这个键**根本传不出去** ⇒ 那才是"管道没铺到这里"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';
import { CHAIN_EDGES, ANY_TOOL } from '../dist/src/domain/chain_wiring.js';

const KEYS = ['feature', 'project_dir', 'scope_files', 'written_files', 'file', 'symbols', 'nodes'];

console.log('════ ① 规模（分母）');
console.log(`  工具总数 = ${TOOL_DEFS.length}`);
const specific = CHAIN_EDGES.filter((e) => e.from !== ANY_TOOL && e.to !== ANY_TOOL);
const wild = CHAIN_EDGES.filter((e) => e.from === ANY_TOOL);
console.log(`  链边总数 = ${CHAIN_EDGES.length}（具体 ${specific.length} · 通配 ${wild.length}）`);
const withOut = [...new Set(specific.map((e) => e.from))].sort();
console.log(`  ★ 有具体出边的工具 = ${withOut.length} → ${withOut.join(', ')}`);
console.log(`  ★ 通配边的 fromKey = ${wild.map((e) => e.fromKey).join(' · ')}（★ 它们对**任何** [B] 直通）`);

console.log('\n════ ② ★★ 每个键"经链表能到几个下游工具"（★ 这才是"传不传得出去"）');
const reach = new Map();
for (const k of KEYS) {
  const es = CHAIN_EDGES.filter((e) => e.fromKey === k);
  const tos = [...new Set(es.filter((e) => e.to !== ANY_TOOL).map((e) => e.to))].sort();
  const wildcard = es.some((e) => e.to === ANY_TOOL);
  reach.set(k, { edges: es.length, tos, wildcard });
  const tag = tos.length
    ? `→ ${tos.slice(0, 7).join(', ')}${tos.length > 7 ? ` …(+${tos.length - 7})` : ''}`
    : wildcard
      ? '（无具体边，但**通配**覆盖：任何 [B] 直通）'
      : '★★ 【0 条边、也不通配】⇒ 这个键**传不出去**';
  console.log(`  ${k.padEnd(14)} 边=${String(es.length).padStart(2)}  ${tag}`);
}

console.log('\n════ ③ ★ 真结论：哪些键"传得出去"，哪些"根本传不出去"');
const blocked = KEYS.filter((k) => reach.get(k).tos.length === 0 && !reach.get(k).wildcard);
console.log(`  传不出去的键 = ${blocked.length ? blocked.join(', ') : '(无)'}`);
const onlyWildcard = KEYS.filter((k) => reach.get(k).tos.length === 0 && reach.get(k).wildcard);
console.log(`  只靠通配（作用域类，合理）= ${onlyWildcard.length ? onlyWildcard.join(', ') : '(无)'}`);
console.log(`  有具体边（对象类）= ${KEYS.filter((k) => reach.get(k).tos.length > 0).join(', ')}`);

console.log('\n════ ④ 产 touched 的源文件里，哪些"没有任何出边"（★ 逐条判该不该有下一棒）');
const files = [];
for (const root of ['src/application', 'src/infrastructure', 'src/presentation']) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && /\btouched\s*[:=]|withTouched\(|touchedOf\(/.test(fs.readFileSync(p, 'utf8')))
        files.push(p.replace(/\\/g, '/'));
    }
  };
  walk(root);
}
console.log(`  产 touched 的源文件 = ${files.length}`);
// ★ 其中**属于某个已注册工具实现**的（文件名恰好对上某个工具名或其目录）
const toolNames = new Set(TOOL_DEFS.map((d) => d.name));
const impls = files.filter((f) => {
  const base = path.basename(f, '.ts');
  return toolNames.has(base) || /\/handlers\.ts$|\/index\.ts$/.test(f);
});
console.log(`  其中"像工具实现"的 = ${impls.length}（文件名=工具名，或 handlers/index）`);
const noEdge = impls.filter((f) => !withOut.includes(path.basename(f, '.ts')));
console.log(`  ★ 有 touched 却**没有任何具体出边**的 = ${noEdge.length}`);
for (const f of noEdge.slice(0, 20)) console.log('     · ' + f);
