#!/usr/bin/env node
/**
 * ★★★ cert T425 —— **`plan_refactor` 已合并进 `apply_refactor_plan`**（T-#CERT-1 步 1 第 1 笔）（2026-10-28）
 *
 * ## 合并的判据（为什么这两个该是一个工具）
 * 它们是**同一操作对象的两个半**：同一份清单、同一个 `plan_id`、同一套定位实现（`edit_code replace_text`
 * 的 4 级模糊级联）。拆成两个工具只多一次往返 + 多一处描述漂移。
 * ⇒ 现在**一个工具两种形态**：给 `targets` ⇒ 算清单（只读）；给上一轮回执的 `plan` ⇒ 落盘（幂等）。
 *
 * ## 判据（每条亲手跑 · 合并前先录了基线 `certs/baselines/refactor-plan-baseline.json`）
 *   ① `plan_refactor` **不再在注册表**里；
 *   ② **等价性**：新入口给 `targets` ⇒ `plan_id` / `summary` / `items` / 人读回执 **与基线逐字段相等**
 *      （★ 这条是合并的全部意义：能力不能少一点）；
 *   ③ **只读**：算清单形态跑完，夹具文件 **sha256 不变**；
 *   ④ 落盘形态：把回执的 `plan` 传回去 ⇒ 文件**真变** + `written=true`；
 *   ⑤ **幂等**：同一份 `plan` 再落一次 ⇒ `already_applied`，文件**字节不变**；
 *   ⑥ 两种入参都不给 ⇒ **报错并说清**"要么给 targets（算清单）要么给 plan（落盘）"。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只测 `edit_code` 类替换的两项；`atomic` / `authorize` / 跨文件多项目标未在本证里覆盖；
 *   · **[未核]** 基线是人读回执里的措辞（末行文案改过一次：从"交给 apply_refactor_plan"改成"传回本工具"），
 *     ⇒ ② 对 `msg` 的比对**只比对前 3 行结构**，末行提示允许不同（这是合并**必然**要改的一句话）。
 *
 * ## 用法
 *   node certs/t425-refactor-plan-merge-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp425merge-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const def = TOOL_DEFS.find((t) => t.name === 'apply_refactor_plan');

// ── ① 旧工具已不在注册表 ───────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!names.includes('plan_refactor'), '① `plan_refactor` **不再在注册表**（合并后只剩一个入口）', `工具数 ${names.length}`);
  chk(names.includes('apply_refactor_plan'), '①-b 幸存者是 `apply_refactor_plan`');
}

/** ★ `wrapData` 的返回是 `{ text: "人读回执---DATA---{json}" }` —— 这里拆成人读 + 数据 */
function unwrap(r) {
  const t = String(r?.text ?? '');
  const i = t.lastIndexOf('---DATA---');
  if (i < 0) return { msg: t.trim(), data: undefined };
  return { msg: t.slice(0, i).trim(), data: JSON.parse(t.slice(i + 10).trim()) };
}

const baseline = JSON.parse(fs.readFileSync(path.join(HERE, 'baselines/refactor-plan-baseline.json'), 'utf8'));

// 夹具（用基线里记的同一份源码，保证可复现）
const proj = path.join(TMP, 'proj');
fs.mkdirSync(proj, { recursive: true });
const file = path.join(proj, baseline.fixture_file);
fs.writeFileSync(file, baseline.fixture_src);
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sha0 = sha();

// ── ② 等价性：新入口给 targets ─────────────────────────
let plan;
{
  const { msg, data } = unwrap(await def.handler({ project_dir: proj, targets: baseline.targets }));
  plan = data;
  chk(plan?.plan_id === baseline.plan_id, '② 算清单形态的 `plan_id` **与基线相同**', `${plan?.plan_id} vs ${baseline.plan_id}`);
  chk(
    JSON.stringify(plan?.summary) === JSON.stringify(baseline.summary),
    '②-b `summary` **逐字段相等**（项数/文件数/命中级别分布）',
    JSON.stringify(plan?.summary ?? null).slice(0, 150),
  );
  chk(
    JSON.stringify(plan?.items) === JSON.stringify(baseline.items),
    '②-c `items` **逐字段相等**（含每项 file / hit 级别 / diff 预览）',
    `${(plan?.items ?? []).length} 项`,
  );
  // 人读回执：只比对前若干行结构（末行提示按合并后的新文案）
  const headLines = (s) => s.split('\n').filter((l) => l.trim()).slice(0, 3).join('\n');
  chk(headLines(msg) === headLines(baseline.msg), '②-d 人读回执**前 3 行逐字相同**（清单摘要 + 每项级别）', headLines(msg).slice(0, 140));
}

// ── ③ 只读性 ──────────────────────────────────────────
chk(sha() === sha0, '③ 算清单形态**只读**：夹具文件 sha256 **不变**', sha0.slice(0, 12));

// ── ④ 落盘形态 ────────────────────────────────────────
{
  const d = unwrap(await def.handler({ project_dir: proj, plan })).data;
  chk(d?.written === true, '④ 给 `plan` ⇒ **落盘**（written=true）', `applied ${d?.applied ?? '?'} / failed ${d?.failed ?? '?'}`);
  const now = fs.readFileSync(file, 'utf8');
  chk(now.includes('return a + 2;') && now.includes('export const BAR = 10;'), '④-b 文件**真改了**（两项替换都生效）');
  chk(sha() !== sha0, '④-c 文件字节确实变了（不是"报告改了其实没改"）');

  // ── ⑤ 幂等 ──────────────────────────────────────────
  const sha1 = sha();
  const d2 = unwrap(await def.handler({ project_dir: proj, plan })).data;
  chk(d2?.written === false && (d2?.already_applied ?? 0) === 2, '⑤ **幂等**：同一份 plan 再落一次 ⇒ 全部 `already_applied`、written=false', `already ${d2?.already_applied ?? '?'} / total ${d2?.total ?? '?'}`);
  chk(sha() === sha1, '⑤-b 第二次落盘后文件**字节不变**');
}

// ── ⑥ 两种入参都不给 ⇒ 报错说清 ────────────────────────
{
  let msg = '';
  try {
    const r = await def.handler({ project_dir: proj });
    msg = String(r?.text ?? r?.message ?? JSON.stringify(r));
  } catch (e) {
    msg = String((e && e.message) || e);
  }
  chk(/targets/.test(msg) && /plan/.test(msg), '⑥ 两个入参都不给 ⇒ **报错并说清**"要么给 targets 要么给 plan"', msg.slice(0, 140));
}

console.log(`\n═══ T425 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
