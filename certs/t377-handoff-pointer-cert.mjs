#!/usr/bin/env node
/**
 * ★★★ cert T377 —— **接续段的"指针"必须指得通 + 首次给全貌**（2026-10-27）
 *
 * ## 为什么有这张证（用户原话）
 * 「默认只列 3 条能看清楚全貌吗，给指针是什么意思（我对此工具不熟悉），我还以为散文是工具使用指南呢」
 * ⇒ 一查就抓到真 bug：**指针指错了工具的参数** —— 我第一版写的是
 *   `next_hop_args(tool='find_references')`，而该工具的必填是 **`touched`**（`tool` 根本不是它的入参）
 *   ⇒ 照着这行跑会报「缺必填：touched」。**比不给指针更糟**：让人以为"全貌拿不到"。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **首次给全貌**：新进程里第一次出现接续段 ⇒ 5 条边全列（这时它是"指南"）；
 *   ② **收敛**：`AGENT_IO_HANDOFF=brief` ⇒ 只列 3 条 + 一行"看全貌跑什么"；
 *   ③ **指针真能跑通**：把指针里那行调用**照着跑一次** ⇒ 退出 0，且回执里有"备好 N 个下一棒的入参"；
 *   ④ **页脚指到指南**：`capability_map(from_tool, touched)` 这一行存在（不熟工具的人有地方可去）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 本证走 CLI（每次新进程）⇒ 只核「首次全貌」与「显式 brief」两种；**长驻 MCP 里第二次自动收敛**
 *     靠的是进程内 `Set`，本证不覆盖（要覆盖得起真 server，成本高于收益）；
 *   · 只核 `find_references` 一条工具的接续段；别的工具走同一个渲染器（`renderHandoffPanel`）。
 *
 * ## 用法
 *   node certs/t377-handoff-pointer-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/meta/index.ts
 */
import { execFileSync } from 'node:child_process';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const CLI = ['dist/src/presentation/cli/cli.js'];
const run = (args, env = {}) => {
  try {
    return execFileSync('node', [...CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  } catch (e) {
    return String(e.stdout ?? '') + String(e.stderr ?? '');
  }
};

const FIND = ['find_references', 'symbol=normRoot', 'file=src/infrastructure/project_registry.ts', 'project_dir=.'];

// ── ① 首次（新进程）⇒ 全貌 5 条 ────────────────────────────
const full = run(FIND);
const edgeLines = full.split('\n').filter((l) => / ←  touched\./.test(l));
chk(edgeLines.length >= 5, '① 首次出现接续段 ⇒ **全貌**（5 条边全列，这时它是指南）', `边行=${edgeLines.length}`);

// ── ② brief ⇒ 3 条 + 一行指针 ─────────────────────────────
const brief = run(FIND, { AGENT_IO_HANDOFF: 'brief' });
const briefEdges = brief.split('\n').filter((l) => / ←  touched\./.test(l));
const pointerLine = brief.split('\n').find((l) => /另有 \d+ 条/.test(l)) ?? '';
chk(briefEdges.length === 3, '② `AGENT_IO_HANDOFF=brief` ⇒ 只列 3 条', `边行=${briefEdges.length}`);
chk(/另有 2 条/.test(pointerLine), '②-b 并给出"另有 2 条"的指针行', pointerLine.trim().slice(0, 120));

// ── ③ 指针真能跑通（★ 这条是本证的立证理由）────────────────
// 指针行里写的调用：`next_hop_args(touched=<本回执 ---DATA--- 里的 touched>)`
const touched = (full.match(/"touched":(\{.*?\})\s*[,}]/) ?? [])[1] ?? '';
chk(/next_hop_args\(touched=/.test(pointerLine), '③-a 指针指的是 `next_hop_args(touched=…)`（不是 `tool=`）', pointerLine.trim().slice(0, 100));
let followed = { ok: false, text: '' };
if (touched) {
  try {
    const out = execFileSync('node', [...CLI, 'next_hop_args', `touched=${touched}`, 'project_dir=.'], { encoding: 'utf8' });
    followed = { ok: true, text: out };
  } catch (e) {
    followed = { ok: false, text: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}
chk(followed.ok, '③-b **照着指针跑一次 ⇒ 退出 0**（指针不是装饰）', touched ? `touched=${touched.slice(0, 60)}…` : '回执里没取到 touched');
chk(/备好 \*\*5\*\* 个下一棒的入参|备好 \*\*\d+\*\* 个下一棒的入参/.test(followed.text), '③-c 而且它真给了全貌（"备好 N 个下一棒的入参"）', (followed.text.split('\n').find((l) => /备好/.test(l)) ?? '').trim().slice(0, 110));

// ── ④ 页脚指到指南（不熟工具的人有地方去）────────────────
chk(/capability_map\(from_tool='find_references'/.test(brief), "④ 页脚给出指南入口 `capability_map(from_tool='find_references', …)`");

console.log(`\n═══ T377 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
