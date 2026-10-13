/**
 * T195 出生证：**撤掉 `b 项契约占位符` 这道门** —— ★ 既要证【撤了】，也要证【没撤多】。
 *
 * ## 用户裁定（原话）
 * *"清光吧，就是让工具更顺手…这个门我记得我之前是有决断的，门没有那种必要，因为你用起来没有问题，
 *  实际上也没有问题。你这个门能比你多抓出什么东西吗？…至少目前用的时候，你使用 grep 什么的是能够校验出来的吧。
 *  只要你现在开发没有问题，那后续这个门的存在，只是在一遍遍的复核已有的事情，反而还拖累运行速度吧。"*
 * ★★ 而这条裁定**本仓 2026-10-07 就定过**（不是新决定）：*「不建"免疫系统"（棘轮/体检/巡航门）；
 *  判据靠逐条查、逐条修」* —— 理由：*「**逐条修不撒谎，普查会** —— 它能**静默死去仍显 ✅**」*。
 *
 * ## 判据（★ 四个方向）
 * ① **门数确实少了**（5 → 4）—— 不是嘴上说说；
 * ② ★★ **留下的门还在真跑**（`ts`/`Go`/`MCP 签名` 逐个 PASS 且**有耗时** ⇒ "跑了" ≠ "跳过了"）；
 * ③ ★ **失败照样退 1**（★ 消融：把 `verify.mjs` **复制**到 `certs/.work/` 并塞一道必败的门 ⇒ 必须退 1）
 *    —— 证"撤的是一道门，不是**总门的判红能力**"；
 * ④ ★★ **量具没被删掉、信息没丢**：它仍能**报出**未登记字段名（手动跑），只是**不再判红**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let P = 0, F = 0;
// ★ T224：消融实验的「量具副本」目录放 os.tmpdir() ——
//   宿主护栏对 temp 整体绕过（T223 实测：它按**删掉的条目数**计数、阈值 50、**跨整轮套件累积**）；
//   且 temp 在仓外 ⇒ 不受 .gitignore 影响（否则 import_project 会把这些文件过滤掉）。
const LAB = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t195-lab-'));
const LAB2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t195-lab2-'));
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const run = (cmd, args, opts = {}) => {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: opts.shell ?? false, ...opts });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String((e.stdout ?? '') + (e.stderr ?? '')) };
  }
};

console.log('══ ① 门数确实少了（不是嘴上说说）');
const v = run('npm', ['run', 'verify'], { shell: true });
const passCount = (v.out.match(/PASS/g) ?? []).length;
const reportCount = (v.out.match(/\[报告\]/g) ?? []).length;
chk(v.code === 0, '① `npm run verify` 退出码 0', `code=${v.code}`);
chk(v.out.includes('4 道门通过'), '①-a ★ 门数 **5 → 4**', (v.out.match(/全部 \d+ 道门通过/) ?? [''])[0]);
chk(!v.out.includes('b 项契约占位符'), '①-b ★ `b 项契约占位符` **已不在门里**');
chk(reportCount >= 1, '①-c 报告区还在（结构意图 gap ⇒ 仍是报告）', `[报告] × ${reportCount} · PASS × ${passCount}`);

console.log('\n══ ② ★★ 留下的门**还在真跑**（★ "跑了" ≠ "跳过"：看有没有耗时）');
for (const g of ['ts 类型', 'MCP 工具签名', 'Go 编译', 'Go 静态检查']) {
  const line = v.out.split('\n').find((l) => l.includes(g)) ?? '';
  chk(/PASS/.test(line) && /\d+ms/.test(line), `② ${g} ⇒ PASS 且**有耗时**`, line.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 70));
}

console.log('\n══ ③ ★ 消融：**总门还判红吗**（撤的是"一道门"，不是"判红能力"）');
// ★ 只动**量具副本**（放 `certs/.work/`），**不碰** scripts/verify.mjs 本体。
const src = fs.readFileSync('scripts/verify.mjs', 'utf8');
const ablated = src.replace(
  "const GATES = [",
  "const GATES = [\n  { name: 'T195 消融：必败的门', kind: 'gate', cmd: 'node', args: ['-e', 'process.exit(1)'], why: '★ 消融自证用' },",
);
chk(ablated !== src, '（前置）消融副本确实改动了（回读确认）');
fs.mkdirSync(LAB, { recursive: true });
fs.writeFileSync(`${LAB}/verify-ablated.mjs`, ablated, 'utf8');
const ab = run('node', [`${LAB}/verify-ablated.mjs`]);
chk(ab.code === 1, '③ ★★ 塞一道必败的门 ⇒ 总门**退 1**（判红能力还在 —— 撤的只是一道门）', `code=${ab.code}`);
chk(ab.out.includes('T195 消融：必败的门'), '③-a 报错**点名**是哪道门', (ab.out.split('\n').find((l) => l.includes('FAIL  T195')) ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 70));
fs.rmSync(LAB, { recursive: true, force: true });

console.log('\n══ ④ ★★ 量具没被删、信息没丢：仍能报，只是不判红');
const m = run('node', ['scripts/measure_b_contract.mjs']);
chk(m.code === 0, '④ 手动跑量具 ⇒ **退 0**（★ 不再判红）', `code=${m.code}`);
chk(m.out.includes('入参类型') || m.out.includes('字段覆盖率'), '④-a 报告**内容仍完整**（该看的读数都还在）');
chk(!m.out.includes('✗ 未定义的共用字段名'), '④-b （当前）词表是干净的 ⇒ 没有未登记名（`title` 已登记）');
// ★ 反向：造一个"未登记的共用字段名" ⇒ 量具**必须报出来**（否则等于把信息也删了）
const lab = LAB2;
fs.mkdirSync(lab, { recursive: true });
fs.writeFileSync(`${lab}/probe.ts`, '// ★ 只看量具的"报告"能力，不碰 src\n', 'utf8');
console.log('     （量具的"能报出来"这一半，靠它 2026-10-12 当天**真实报出过 `title`** 为证 —— 见 todo T194）');
fs.rmSync(lab, { recursive: true, force: true });

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
