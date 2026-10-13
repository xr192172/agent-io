/**
 * T189 全量扫：**每个工具真跑一次，看它到底交了什么 `Touched`**（★ 分子分母要同一把尺）。
 *
 * ## 为什么必须全量真跑
 * · "产 `touched`" 的**门槛很低**：★ **只产作用域键（`feature` / `project_dir`）也算产**；
 * · 而"该有一条链边"要求的是**对象锚点**（`scope_files` / `written_files` / `file` / `symbols` / `nodes`）
 *   —— 有对象才谈得上"交给下一棒"。
 * ⇒ ★★ 那句"**产 `touched` 33 处 vs 有具体出边仅 8 个工具**"是**拿两个不同尺的分母比**
 *   （我此前把它读成"产品侧铺开了、管道侧没跟上" —— ★ 那个读法**误导**）。
 *
 * ## 做法
 * 对 68 个工具逐个调（最小可信入参），记录 `data.touched` 的键，按"只有作用域键 / 有对象锚点"分类。
 * ★ 失败/无 DATA 的**如实计入"未取到"**（不当 0 —— `gate-authoring`：通道不可用 ≠ 读数为 0）。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';
import { CHAIN_EDGES, ANY_TOOL } from '../dist/src/domain/chain_wiring.js';
import { parseDataBlock } from '../dist/src/application/plumbing.js';

const OBJ_KEYS = ['scope_files', 'written_files', 'file', 'symbols', 'nodes'];
const SCOPE_KEYS = ['feature', 'project_dir'];
const REPO = process.cwd();
const ARGS = { feature: 'run82', project_dir: REPO };

const withOut = new Set(CHAIN_EDGES.filter((e) => e.from !== ANY_TOOL && e.to !== ANY_TOOL).map((e) => e.from));

const rows = [];
for (const def of TOOL_DEFS) {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', def.name, JSON.stringify(ARGS)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    out = String(e.stdout ?? '');
  }
  // ★★★ T251：机器段解析只走唯一入口 `parseDataBlock`（原先这里自己 indexOf+slice+JSON.parse 一份）。
  //   只取首行的理由在唯一入口的头注里（JSON 之后还有"下一棒"散文块与 `--- stderr ---`）。
  const touched = (parseDataBlock(out) ?? {}).touched ?? null;
  const keys = touched ? Object.keys(touched) : [];
  rows.push({
    name: def.name,
    got: !!touched,
    keys,
    objKeys: keys.filter((k) => OBJ_KEYS.includes(k)),
    scopeOnly: keys.length > 0 && keys.every((k) => SCOPE_KEYS.includes(k)),
    hasOutEdge: withOut.has(def.name),
  });
}

const got = rows.filter((r) => r.got);
const objProducers = got.filter((r) => r.objKeys.length > 0);
const scopeOnly = got.filter((r) => r.scopeOnly);
console.log(`工具总数                     = ${rows.length}`);
console.log(`取到 touched 的               = ${got.length}（★ 未取到 ${rows.length - got.length} —— 如实计入，不当 0）`);
console.log(`  ★ 只产作用域键（feature/project_dir）= ${scopeOnly.length}`);
console.log(`  ★★ 产【对象锚点】的           = ${objProducers.length} → ${objProducers.map((r) => r.name).join(', ')}`);
console.log(`有具体出边的工具               = ${withOut.size} → ${[...withOut].sort().join(', ')}`);

const hasObjNoEdge = objProducers.filter((r) => !r.hasOutEdge);
const hasEdgeNoObj = [...withOut].filter((n) => !objProducers.some((r) => r.name === n));
console.log('\n★★ 真结论（两个分母同一把尺之后）：');
console.log(`  · **产对象锚点、但没有出边**的 = ${hasObjNoEdge.length}${hasObjNoEdge.length ? ' → ' + hasObjNoEdge.map((r) => `${r.name}(${r.objKeys.join('/')})`).join(', ') : ''}`);
console.log(`  · **有出边、但本次没取到对象锚点**的 = ${hasEdgeNoObj.length} → ${hasEdgeNoObj.join(', ')}（★ 多是"要真参数才跑得动"，不据此下结论）`);

fs.writeFileSync('certs/.work/t189-sweep.json', JSON.stringify(rows, null, 1), 'utf8');
console.log('\n逐条明细： certs/.work/t189-sweep.json');
