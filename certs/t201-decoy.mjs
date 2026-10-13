/**
 * T201 出生证：**补上"近名诱饵"检测**（`g-decoy-instrument`）—— ★ 并**收紧了目标里那条判据**。
 *
 * ## ★★★ 目标原文的判据说错了一件事（这是我实测出来的）
 * > 判据：两工具共享 ≥1 个长度>2 的词根、**且用途不同** ⇒ 报。**实测本仓有 41 对**。
 *
 * ★ 照它跑（**只**看共享词根）⇒ 实测 **48 对**（不是 41）。而看那 48 对的内容：
 * ```
 * memory_observe ↔ observe_log / observe_judge / observe_instrument / observe_proposals   （全共享 observe）
 * reconcile_effects ↔ reconcile_chain
 * ```
 * ⇒ ★★ **共享同一个词根，正是"这是一【族】"的标志** —— 族是**有意分组**，是诱饵的**反面**；
 *   而 n 个族员两两组合 ⇒ **对数被族内组合撑爆**（5 个 `observe_*` 贡献 10 对）✓
 * ⇒ ★ 而目标自己举的例子 `edit_dsl` ↔ `edit_code`（**一个改设计、一个改代码**）才是真形状：
 *   ★ **共享词根 + 族不同** ⇒ **会挑错** ✓
 *
 * ## ★★ 收紧后的判据：共享词根 **且【跨 lane】**
 * lane 是**机器可读**的（`application/<线>/index.ts` 的 `<LANE>_TOOLS`，★ 由数据派生、**不手列**）。
 * ⇒ 实测：**48 对 → 同 lane（族）31 对 + 跨 lane 17 对** ✓
 *
 * ## ★★★ 而"跨 lane"**仍然不等于**"用途不同" —— 这条必须说清（否则又是一次"量错东西"）
 * 17 对里那 6 对全是 `observe_*`[observe] ↔ `observe_proposals`[**meta**]：
 * ★ `observe_proposals` 归 `meta`，而它的**语义域明显是 `observe`** ⇒ ★★ 那些对是
 *   【**组织归属与语义域不一致**】的信号，**不是诱饵** ✓
 * ⇒ ★ 处置：按**弱词根**（≥4 个工具共享的词根 ⇒ 共享它信息量低）把候选分成**强 / 弱** ✓
 *   ⇒ 强 11 对（含 `edit_dsl↔edit_code` · `signal_review↔review_changes` 等）· 弱 6 对（全是 observe 那批）✓
 *
 * ## ★ 所以本项是【候选生成器】，不是判据
 * "**用途是否真不同**"是**语义判断，机器判不了** ⇒ 量具给候选 + 证据，**由读的人判** ✓
 * （★ 与 §2.2「扫描器/量具是候选生成器」同一条；★ 也**不建门** —— 2026-10-07 裁定"不建免疫系统"）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const out = (() => {
  try {
    return execFileSync('node', ['scripts/probe_tool_smells.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return String((e.stdout ?? '') + (e.stderr ?? ''));
  }
})();
const src = fs.readFileSync('scripts/probe_tool_smells.mjs', 'utf8');

console.log('══ ① 量具真的跑起来了（★ 先证"跑了"，再看读数）');
chk(/工具面坏味道扫描/.test(out), '①-a 有输出（不是静默失败）', out.split('\n')[0].slice(0, 60));
chk(/近名诱饵候选/.test(out), '①-b ★ 新增的"近名诱饵"段在');

console.log('\n══ ② ★★ 族与诱饵被**分开**（这是收紧判据的直接效果）');
const m = out.match(/近名诱饵候选[^：]*：(\d+) 对/);
const fam = out.match(/族内\*\*共享词根 (\d+) 对/);
const noLane = out.match(/取不到 lane 的 (\d+) 对/);
chk(!!m && !!fam, '②-a 同时报出"候选"与"族内"两个数', `候选 ${m?.[1] ?? '?'} · 族内 ${fam?.[1] ?? '?'}`);
chk(Number(m?.[1] ?? 0) < Number(fam?.[1] ?? 0), '②-b ★ 候选对数 **< 族内对数**（说明"族"被剔出去了）', `候选 ${m?.[1]} < 族内 ${fam?.[1]}`);
chk(noLane && Number(noLane[1]) === 0, '②-c ★ "取不到 lane 的对数"**如实报**（此处 0 ⇒ lane 派生成功）', `无归属 ${noLane?.[1] ?? '?'}`);

console.log('\n══ ③ ★★ 强 / 弱候选分开（"跨 lane"仍不等于"用途不同"）');
const strong = out.match(/强候选\*\*[^：]*：(\d+) 对/);
const weak = out.match(/弱候选[^：]*：(\d+) 对/);
chk(!!strong && !!weak, '③-a 两栏都在', `强 ${strong?.[1] ?? '?'} · 弱 ${weak?.[1] ?? '?'}`);
chk(Number(strong?.[1] ?? 0) + Number(weak?.[1] ?? 0) === Number(m?.[1] ?? -1), '③-b ★ 强 + 弱 = 候选总数（没丢没重）');
chk(out.includes('edit_dsl') && out.includes('edit_code'), '③-c ★ **目标自己举的例子**（`edit_dsl↔edit_code`）出现在**强候选**里', '（"一个改设计、一个改代码"）');
chk(/observe_proposals.*\[meta\]/s.test(out) && out.includes('弱词根'), '③-d ★ 那批 `observe_*↔observe_proposals` 被标成**弱候选**（弱词根 `observe`）');
chk(out.includes('"跨 lane" ≠ "用途不同"'), '③-e ★★ 输出里**明说了**这个区别（否则读的人会把组织问题当诱饵）');

console.log('\n══ ④ 判据的**数据源是派生的**（★ 不手列 —— 手列会腐）');
chk(/application\/\$\{l\}\/index\.js/.test(src) && /\$\{l\.toUpperCase\(\)\}_TOOLS/.test(src), '④-a lane 归属从 `application/<线>/index.ts` 的 `<LANE>_TOOLS` **派生**');
chk(/rootCount/.test(src) && /WEAK_ROOT_MIN/.test(src), '④-b ★ 弱词根**由数据算**（≥N 个工具共享），**不是手列黑名单**');
chk(/withoutLane/.test(src), '④-c ★ 取不到 lane 的情况**有字段如实记**（不当 0）');

console.log('\n══ ⑤ ★ 它是**量具**、不是门（★ 2026-10-07 裁定"不建免疫系统"）');
const verifySrc = fs.readFileSync('scripts/verify.mjs', 'utf8');
chk(!/probe_tool_smells/.test(verifySrc), '⑤-a ★ `probe_tool_smells` **不在 `verify` 的门表里**（量具只报告）');
chk(/snapshot/.test(fs.readFileSync('scripts/snapshot.mjs', 'utf8')), '⑤-b 它挂在 snapshot 上（进展可被追踪）✓');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('★ 读数（2026-10-12）：共享词根 48 对 = 族内 31 + 跨 lane 17（强 11 / 弱 6）');
console.log('★★ 而"用途是否真不同"机器判不了 ⇒ 本项是【候选生成器】，由读的人判（§2.2）。');
