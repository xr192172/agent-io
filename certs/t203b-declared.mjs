/**
 * T203b：**描述里【自己声明了】的链** —— ★ 这是 T203 的真发现。
 * ★ 用户的话："很多工具**当时在设计的时候都是顺理成章的，但是没有接入**" ✓
 * ★ 判据（精确版）：描述里出现 **棒/链/半/Phase/第 N 步/承接/消费** 这类**接力词** ✓
 * ★★ 但"描述里说是一条链" **≠** "这条链真跑过" ⇒ 这些该进 Map 的 **pending** 区 ✓
 */
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';
import * as c from '../dist/src/domain/chain_wiring.js';

const covered = new Set();
for (const e of c.CHAIN_EDGES) {
  if (e.from !== 'ANY_TOOL') covered.add(e.from);
  if (e.to !== 'ANY_TOOL') covered.add(e.to);
}
const RELAY = /链|棒|第[一二三四]半|Phase\s*\d|第[一二三四五六七八九十]步|承接|消费|接上|接力|下游|上游/;
const hits = [];
for (const d of TOOL_DEFS) {
  const txt = String(d.title ?? '') + ' ' + String(d.description ?? '');
  if (!RELAY.test(txt)) continue;
  const m = txt.match(/.{0,26}(链|棒|第[一二三四]半|Phase\s*\d).{0,40}/);
  hits.push({ name: d.name, covered: covered.has(d.name), snippet: m ? m[0].replace(/\s+/g, ' ') : '' });
}
const uncovered = hits.filter((h) => !h.covered);
console.log(`★ 描述里带【接力词】的工具：${hits.length} 个`);
console.log(`  其中 **已在 Map 里**（有 verified 边）：${hits.length - uncovered.length} 个`);
console.log(`  ★★ 其中 **不在 Map 里**（= 用户说的"没接入"）：${uncovered.length} 个\n`);
console.log('════ ★★ 声明了接力、但没登记的（逐个看它说的是哪条链）════');
for (const h of uncovered) console.log('  · ' + h.name.padEnd(24) + h.snippet);
console.log('\n════ 已在 Map 里的（对照）════');
for (const h of hits.filter((x) => x.covered)) console.log('  · ' + h.name.padEnd(24) + h.snippet);
