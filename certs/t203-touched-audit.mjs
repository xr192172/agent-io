/**
 * T203：**盘点"接不上链"的工具**（★ 用户："你给我统计一下有什么工具，用我能看懂的话来解释"）。
 *
 * ## 背景（用户的话，逐字）
 * > *"有一些工具它有可能是**孤立工具**，但是很多工具**当时在设计的时候都是顺理成章的，但是没有接入**"*
 *
 * ⇒ ★ 所以要分**三类**，而不是一刀切：
 * · **A 有锚点**：`touched`（产物锚点）在 ⇒ 链**接得上** ✓
 * · **B 该孤立**：只读 / 纯计算 ⇒ **没有产物可交** ⇒ 没锚点**是对的** ✓
 * · **C 该接、没接**：★ **会改动东西**（写盘 / 建对象）却**没有锚点** ⇒ ★★ **这就是用户说的那批** ✓
 *
 * ## ★★ 本脚本是【候选生成器】，不是判据（§2.2）
 * · "有没有 `touched`" 是**静态扫**（grep 源码）⇒ ★ 只能当**候选**：真值要**真调**工具看回执里有没有 `data.touched`。
 * · "该不该有锚点"（B 与 C 的分界）用**描述里的动词**做**近似** ⇒ ★ **不是判据**，是给人一条线索。
 * ⇒ ★ 所以本脚本**只报候选 + 线索**，**不下断言** ✓
 *
 * ★ 用法：`node certs/t203-touched-audit.mjs`
 */
import fs from 'node:fs';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';

const REPO = 'D:/project_develop/design-canvas';

// ── ① 静态扫：只看【该工具自己的 def 块】（★ 绑松了会全命中 —— 我第一版就那样，52/69 全中 ✗）──
// ★ 做法：在 6 个 lane 的 index.ts 里，找 `name: '<tool>'` 到**下一个** `name: ` 之间的那段 ⇒ 那段才是它的 def。
const LANE_INDEX_FILES = ['design', 'refactor', 'observe', 'harvest', 'cross', 'meta'].map(
  (l) => REPO + '/src/application/' + l + '/index.ts',
);
const laneTexts = new Map();
for (const f of LANE_INDEX_FILES) {
  try { laneTexts.set(f, fs.readFileSync(f, 'utf8')); } catch { /* 没这个 lane 就跳过 */ }
}
/** 取某个工具的 def 块（★ 找不到返回 null —— 不猜） */
const defBlockOf = (tool) => {
  for (const [, text] of laneTexts) {
    const i = text.indexOf("name: '" + tool + "'");
    if (i < 0) continue;
    const j = text.indexOf("name: '", i + 10); // 下一个工具的 name:
    return text.slice(i, j < 0 ? i + 4000 : j);
  }
  return null;
};
const hasTouchedAt = (tool) => {
  const blk = defBlockOf(tool);
  if (blk === null) return { found: false, why: 'def 块没找到' };
  // ★ 锚点可能写在 def 的 handler 里（直接构造），也可能由 [B] 返回 ⇒ 两种都算
  return { found: /touched/.test(blk), why: /touched/.test(blk) ? 'def 块内出现 touched' : 'def 块内没有 touched' };
};

// ── ② 按描述里的动词判"会不会改动东西"（★ 近似，只报线索）──
const WRITE_WORDS = /写|改|改(名|动)|生成|创建|新建|移动|删除|应用|落盘|注入|归档|提交|同步|导入|克隆|修复|补丁|写入|追加|标记/;
const READ_WORDS = /^(只读|查询|列出|查看|读|统计|报(告)?|检查|扫描|对比|对账|诊断|分析|算|计算|校验|验证|渲染|导出^)/;

const rows = TOOL_DEFS.map((d) => {
  const h = hasTouchedAt(d.name);
  const hit = h.found ? d.name : null;
  const text = String(d.title ?? '') + ' ' + String(d.description ?? '');
  const looksWrite = WRITE_WORDS.test(text);
  const looksRead = READ_WORDS.test(text);
  return { name: d.name, hit, looksWrite, looksRead, desc: String(d.description ?? '') };
});

const A = rows.filter((r) => r.hit);
const noAnchor = rows.filter((r) => !r.hit);
const C = noAnchor.filter((r) => r.looksWrite && !r.looksRead);
const B = noAnchor.filter((r) => !(r.looksWrite && !r.looksRead));

console.log(`本仓工具总数：${rows.length}\n`);
console.log('════════════════════════════════════════════════════════');
console.log('【第一类】Anchor 在 —— 链接得上');
console.log(`  共 ${A.length} 个\n`);
for (const r of A) console.log('   · ' + r.name);

console.log('\n════════════════════════════════════════════════════════');
console.log('【第二类·待判】描述里有"改动类"动作，却找不到锚点');
console.log('  ★ 这就是你说的「当时设计时顺理成章、只是没接入」那批（★ 但只是【线索】，要逐条核）');
console.log(`  共 ${C.length} 个\n`);
for (const r of C) console.log('   · ' + r.name.padEnd(26) + String(r.desc).replace(/\s+/g, ' ').slice(0, 78));

console.log('\n════════════════════════════════════════════════════════');
console.log('【第三类·待判】描述看着像"只读/报数" —— 没锚点可能是【应该的】（孤立工具）');
console.log(`  共 ${B.length} 个\n`);
for (const r of B) console.log('   · ' + r.name.padEnd(26) + String(r.desc).replace(/\s+/g, ' ').slice(0, 78));

console.log('\n════════════════════════════════════════════════════════');
console.log('★ 提醒：以上三类都由【静态扫 + 描述动词】得到 ⇒ 是【候选】，不是判据。');
console.log('  真值要真调工具看回执里到底有没有 data.touched（★ 今天已经出过一次"其实是有的、只是我没扫到"）。');
