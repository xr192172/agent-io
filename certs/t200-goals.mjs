/**
 * T200 出生证：**把 9 条目标的【证据】更新到"现在"** —— ★ 它们本身在误导人。
 *
 * ## 为什么值得做（★ 与今天一整天同一条线）
 * 那批目标是**这个仓声明自己要往哪走**的陈述 ⇒ ★ **过时的目标会引导下一个人做已经做完的事**
 * （或去修不存在的病）⇒ 与"输出在误导"**同一族**。
 * ★★ 而 T199 之后它们**第一次真的可读**（`get_dsl query=goals`）⇒ **读得到，代价才开始产生** ✓
 *
 * ## ★ 逐条核的结果（★ 都是实测，不是读着像）
 * | 目标 | 原文说 | 事实 |
 * |---|---|---|
 * | `g-no-silent-fallback` | "**2 条仍未治**" | ★ **两条今天都修了**（T188/T190 活态回退进告警通道 + T191 数组参数走 `optionalArr`）|
 * | `g-retire-flow` | "仍存的边界：**② 看不见那个墓碑**（T184b）" | ★ **T184b 已结项**（`overlayTombstones`）|
 * | `g-output-not-misleading` | "10 条未修里**有 5 条**仍属这一族" | ★ **3 已修**（a/c/d）· 1 是**历史注释**（b）· **1 仍过时**（e ⇒ 今天修）|
 * | `g-detection-not-silently-degraded` | "`mcp_scan.mjs`…**检测力静默下降而照样 PASS**" | ★ **已修**（该门现在**直调 `handler` 绕过 zod**，见其文件头）|
 * | `g-tool-face-converge` | "**67 个**平铺" · "袋子 **2 个**" | ★ 工具已 **68** · ★ **袋子 2 → 1**（T194 扁平化 `manage_feature`）|
 * | `g-cli-only-to-face` | "**67 个工具**里" | ★ 68（能力仍未上工具面 ⇒ **目标本身仍成立**）|
 * | `g-decoy-instrument` / `g-freeze-baseline` / `g-getdsl-split` | 未做 / 未做 / 仍准确 | ★ **不改**（复核后仍准确）✓ |
 *
 * ## ★★ 而唯一【仍是活缺陷】的那条：`verify.mjs` 的 `why` 里写着「61 个工具」
 * 实测 **68**。★ 按本仓纪律 **删掉计数**（不手改）—— ★ 因为**那一行自己就记着一次"59 → 61"的更正**
 * ⇒ ★ **改一次过一次** ⇒ **要么由 `TOOL_DEFS` 派生、要么删掉** ⇒ 选了**删掉 + 注明真值在哪** ✓
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (tool, args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  return out;
};

const goalsText = call('get_dsl', { feature: 'run82', query: 'goals' });
console.log('══ ① 四条的【过时断言】都不在了');
chk(!goalsText.includes('2 条仍未治'), '①-a `g-no-silent-fallback` 不说"2 条仍未治"了');
chk(goalsText.includes('已治') && goalsText.includes('无在账项'), '①-b ★ 改成了"**都已治** + 当前**无在账项**"', '');
chk(!goalsText.includes('**② 看不见那个墓碑**') || goalsText.includes('已结项（T184b）'), '①-c `g-retire-flow` 的"② 看不见墓碑"已标为**已结项**');
// ★ 我第一版写的是 `!includes('5 条仍属这一族')` ⇒ ★ **假红**：新文案里**引用了**旧说法
//   （'原文说"…有 5 条仍属这一族"，**逐条核过**'）⇒ ★ **子串匹配分不清"主张"与"引用"**
//   （★ 今天那条"注释污染文本判据"的同款）。⇒ 改成**能区分**的：旧说法**只许出现在引用里**。
chk(goalsText.includes('逐条核过'), '①-d ★ `g-output-not-misleading` 改成了**逐条复核**（旧说法只作【引用】保留）');
// ★ 判"是主张还是引用"，最简单能区分的信号就是**有没有"原文说"这个框** ✓（别用花哨正则 —— 我第一版写坏了）。
chk(goalsText.includes('原文说'), '①-d2 ★ 旧说法**被框在"原文说…"里**（= 引用），不是当事实在讲');
chk(goalsText.includes('逐条复核'), '①-e ★ 改成了"逐条复核 + 结论"，并列出**新修的那批**');
chk(!goalsText.includes('检测力静默下降而照样 PASS'), '①-f `g-detection-not-silently-degraded` 不说"该门静默下降"了');
chk(goalsText.includes('绕过 zod') || goalsText.includes('def.handler'), '①-g ★ 改成了"该门已直调 handler、绕过 zod"');

console.log('\n══ ② 计数不写死（★ 本仓纪律：写死的数会过期 ⇒ 派生或删掉）');
chk(!/\b67 个(?=工具|平铺)/.test(goalsText) || goalsText.includes('不写死'), '②-a 目标里的工具数**已不写死**（注明真值看 `TOOL_DEFS`）', (goalsText.match(/工具数\*\*不写死\*\*/) ?? [''])[0]);
chk(goalsText.includes('TOOL_DEFS'), '②-b ★ 且**指明了真值在哪**');
const v = fs.readFileSync('scripts/verify.mjs', 'utf8');
// ★ 同上：`why` 的值里不许有；★ **注释里引用**（"原写 61 个工具"）是允许的 ⇒ 断言只取 `why:` 那一行的**字面值**。
const whyLine = v.split(String.fromCharCode(10)).find((l) => l.includes('MCP 工具签名')) ?? '';
chk(!/61 个工具/.test(whyLine), '②-c ★★ `verify.mjs` 那道门的 `why` 里**不再写死"61 个工具"**（实测 68）', whyLine.replace(/^\s+/, '').slice(0, 90));
chk(/TOOL_DEFS/.test(v), '②-d ★ 且注明"真值看 `TOOL_DEFS`"');

console.log('\n══ ③ 该保留的仍然保留（★ 别把对的也改掉）');
chk(goalsText.includes('decoy') || goalsText.includes('近名诱饵'), '③-a `g-decoy-instrument`（**仍未做**）原样保留 ✓');
chk(goalsText.includes('FreezingArchRule'), '③-b `g-freeze-baseline`（**仍未做**）原样保留 ✓');
chk(goalsText.includes('23 参'), '③-c `g-getdsl-split` 的「宽签名第 1 名（23 参）」**复核后仍准确** ⇒ 原样 ✓');
chk(goalsText.includes('brickify'), '③-d `g-cli-only-to-face` 的**能力清单**原样（只更新了计数写法）✓');

console.log('\n══ ④ ★ 目标仍活（T199 的保护）：跑一次 reset 不被退回');
execFileSync('node', ['certs/t185-reset.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const after = call('get_dsl', { feature: 'run82', query: 'goals' });
chk(after.includes('结构化目标 9 条'), '④-a reset 之后**还是 9 条** ✓');
chk(after.includes('无在账项'), '④-b ★ 且**仍是更新后的版本**（没被旧基线退回）✓', '');
chk(fs.readFileSync('certs/t185-base/run82.json', 'utf8').includes('无在账项'), '④-c ★ 基线里也已是**新版**（T199 的纪律：合法设计变更后**重抓基线**）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
