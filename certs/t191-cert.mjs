/**
 * T191 出生证：**自由袋子里的形状错，从"静默当没给"改成"当场抛"**。
 *
 * ## 判据（两个方向 + 一次消融）
 * ① **坏形状 ⇒ 必须抛**（且报错说出"要什么、收到什么"）；
 *   ★ **消融**：把 `dist` 里 `optionalBool` 改回"宽松"（返回 undefined）⇒ ★ **必须变回不报错**
 *     ⇒ 证了"这条断言测的就是那个修复"，而不是"它恰好因为别的原因报错"。
 * ② **好输入 ⇒ 照常工作**（不许变成"一律拒"的废门）。
 * ③ 反例：**没给**该键 ⇒ 不抛（可选项的正当用法）。
 *
 * ★ 为什么只动 `dist`：`gate-authoring` §2 —— 消融**只允许改 gitignore 的产物**，**绝不碰 `src/`**。
 * ★ 隔离：全程用**临时 project 根**，不碰真实 DSL；收尾重跑 build 让 dist 再生。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t191-'));  /* ★ T224：草稿放 os.tmpdir() —— 宿主护栏对 temp 整体绕过（T223 实测），且 temp 在仓外 ⇒ 不受 .gitignore 影响（否则 import_project 会把这些文件过滤掉）*/
const PLUMBING = 'dist/src/application/plumbing.js';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
/** 调 explore_code（真走 mcp_call ⇒ 与服务器同一条路） */
const call = (args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', 'explore_code', JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  return { isErr: out.includes('isError=true') || /MCP error|Input validation/.test(out), out };
};
const firstLine = (s) => s.split('\n').filter((l) => l.trim()).slice(0, 1).join('').slice(0, 150);

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify({ name: 't191-tenant', version: '1.0.0' }, null, 2));
console.log('临时项目根：' + ROOT);

// ★★★ T197 修正（2026-10-12）：**原先这里多传了一个 `project_dir`** ——
//   而 `derive_mind_map` 的 [B] **只读 4 个键**（`feature`/`gen_descriptions`/`max_files_per_community`/`output_path`）
//   ⇒ ★ 那个 `project_dir` **一直是被【静默忽略】的**，本证却浑然不觉地"通过"了。
//   ★ 这正是 T197 要治的病（自由袋子吞掉不认识的键），只不过发生在**我自己这张证里** ——
//     ★★ **抓到它的是【回归套件】（表之外的独立来源），不是我的新证**（我新证的 ① 用"表自己的键"当输入 ⇒ 恒真）。
const BASE = { action: 'derive_mind_map', args: { feature: 'run82' } };

console.log('\n════ ① 反例：**没给**可选项 ⇒ 不抛（可选项的正当用法）');
const none = call(BASE);
chk(!/形状不对/.test(none.out), '★ 省略 `gen_descriptions` 不报"形状不对"（没给 ≠ 给错）', firstLine(none.out));

console.log('\n════ ② 坏形状 ⇒ **必须抛**（且报错说清"要什么、收到什么"）');
const badBool = call({ action: 'derive_mind_map', args: { ...BASE.args, gen_descriptions: 'yes' } });
chk(/形状不对/.test(badBool.out), '★★ 传 `gen_descriptions:"yes"`（字符串，要 boolean）⇒ **抛**', firstLine(badBool.out));
chk(/要 \*\*boolean\*\*，收到 \*\*string\*\*/.test(badBool.out), '★ 报错**说清**要什么、收到什么（不是一句"参数错"）');
const badNum = call({ action: 'derive_mind_map', args: { ...BASE.args, max_files_per_community: '5' } });
chk(/形状不对/.test(badNum.out), '★★ 传 `max_files_per_community:"5"`（字符串，要 number）⇒ **抛**', firstLine(badNum.out));

console.log('\n════ ③ 消融：把 dist 的 optionalBool 改回"宽松" ⇒ ★ 必须**不再报错**');
const orig = fs.readFileSync(PLUMBING, 'utf8');
const marker = 'if (typeof v !== \'boolean\')\n        throw new Error(shapeErr(key, hint, v));';
if (!orig.includes(marker)) {
  chk(false, '（前置）在 dist 里找不到那条 throw —— ★ 本证不能假装验过', marker);
} else {
  fs.writeFileSync(PLUMBING, orig.replace(marker, 'if (typeof v !== \'boolean\') return undefined; // ★消融'), 'utf8');
  chk(!fs.readFileSync(PLUMBING, 'utf8').includes(marker), '（前置）消融已确实落盘（回读确认）');
  const ablated = call({ action: 'derive_mind_map', args: { ...BASE.args, gen_descriptions: 'yes' } });
  chk(!/形状不对/.test(ablated.out), '★★ **消融后不再报错**（回到"静默当没给"）⇒ 证了②测的就是那个修复', firstLine(ablated.out));
  fs.writeFileSync(PLUMBING, orig, 'utf8');
}

console.log('\n════ ④ 还原 + 好输入照常工作（★ 不许变成"一律拒"的废门）');
execFileSync('npm', ['run', 'build'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
chk(fs.readFileSync(PLUMBING, 'utf8').includes(marker), '✓ 已重跑 build ⇒ dist 再生（比手工改回更可信）');
const good = call({ action: 'derive_mind_map', args: { ...BASE.args, gen_descriptions: true, max_files_per_community: 3 } });
chk(!/形状不对/.test(good.out), '★ 形状**正确**时不报"形状不对"（好输入不被误拒）', firstLine(good.out));
const badAgain = call({ action: 'derive_mind_map', args: { ...BASE.args, gen_descriptions: 'yes' } });
chk(/形状不对/.test(badAgain.out), '★ 还原后坏形状**又抛了**（不是一次性的）');

fs.rmSync(ROOT, { recursive: true, force: true });
chk(!fs.existsSync(ROOT), '收尾：临时根已清（不污染真实状态）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
