#!/usr/bin/env node
/**
 * ★★★ cert T423 —— **退役动作不许静默执行**（T-#OBSERVE-2 的真实形态）（2026-10-28）
 *
 * ## 真相与旧账不同
 * 旧账写的是「`design_intent action=propose` 提了没人能批」。实证下来**更糟**：
 * propose 分支早在 2026-10-22 就删了，而 `action` **读出来就没用过** ⇒
 * `action=propose` 会被**当成 `set` 直接写盘**。
 * 也就是「**propose 永不直接落盘**」这个写在工具描述里的承诺，实际是**反的** —— 这是**越权写盘**，
 * 比"没人能批"严重一个量级：调用方以为自己在提建议，结果已经把设计改了。
 *
 * ## 判据（每条亲手跑）
 *   ① 调 `action=propose` ⇒ **响亮报错**（不是静默成功）；
 *   ② **零副作用**：调用前后项目 + HOME 下的落盘文件数**不变**；
 *   ③ 报错消息给出**替代路径**（`opl` 立卡 / `observe action=proposals`）；
 *   ④ `action=set` **未被误伤**：它仍走到自己的实现（示例项目里报"feature 不存在"）；
 *   ⑤ 静态：handler 里 `action` **真的被使用**（存在 `if (action === 'propose')`）；
 *   ⑥ 静态：工具描述**不再宣称** propose 会"进入人工审批闸门"（旧承诺已删）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 `design_intent`；「两套提案库」**故意不合并**（见 §结论：payload 与审阅人都不同），
 *     但那条判断**没有证**（属设计决策，不是可断言事实）；
 *   · **[未核]** 工作台「代码审批」页签的 approve 路径没有自动化证（前端）。
 *
 * ## 用法
 *   node certs/t423-retired-action-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp423retired-'));
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
const def = TOOL_DEFS.find((t) => t.name === 'design_intent');

const proj = path.join(TMP, 'proj');
fs.mkdirSync(proj, { recursive: true });

/** 统计"可能被写"的文件数（proj + HOME 全树） */
const countFiles = () => {
  let c = 0;
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else c++;
    }
  };
  walk(proj);
  walk(process.env.AGENT_IO_HOME);
  return c;
};

const before = countFiles();
let res;
try {
  res = await def.handler({ action: 'propose', feature: 'demo', project_dir: proj, goals: [{ title: '不该写盘' }] });
} catch (e) {
  res = { thrown: String((e && e.message) || e) };
}
const after = countFiles();
const msg = String(res?.thrown ?? res?.text ?? JSON.stringify(res));

// ── ① 响亮报错（★ 2026-10-30 B2 改指向：报错**提前到 schema 层**，不再靠 handler 里的 if）────
//   ★ 事实：`design_intent` 的 `action` 现在是 `z.enum(['set'])` ⇒ 传 `propose` 在**参数校验**就失败，
//     比原来"进了 handler 再报"更早、更强。所以判据从"handler 文本带'已退役'"改成"**propose 不可表达**"。
const actOpts = (() => {
  const a = def?.inputSchema?.action;
  const inner = a?.innerType ?? a?.def?.innerType ?? a?._def?.innerType ?? a;
  return inner?.options ?? inner?.enum ?? null;
})();
chk(Array.isArray(actOpts) && !actOpts.includes('propose'), '① `action` 的 enum **没有** `propose`（schema 层就拒，不静默成功）', `enum=${JSON.stringify(actOpts)}`);
chk(actOpts?.length === 1, '①-b 写端只剩**一个** action（不存在"预览/审批"形态）', JSON.stringify(actOpts));

// ── ② 零副作用 ────────────────────────────────────────
chk(after === before, '② **零副作用**：调用前后落盘文件数不变', `${before} → ${after}`);

// ── ③ 替代路径（★ 从**工具描述**派生：模型读到的就是它）────
const diDesc = String(def?.description ?? '');
chk(/opl/.test(diDesc) && /observe action=proposals/.test(diDesc), '③ 工具描述给出**替代路径**（opl 立卡 / observe action=proposals）', diDesc.slice(0, 120));

// ── ④ set 未被误伤 ────────────────────────────────────
{
  let r2;
  try {
    r2 = await def.handler({ action: 'set', feature: 'demo', project_dir: proj, goals: [{ title: 'x' }] });
  } catch (e) {
    r2 = { thrown: String((e && e.message) || e) };
  }
  const m2 = String(r2?.text ?? r2?.thrown ?? JSON.stringify(r2));
  chk(!/已退役/.test(m2), '④ `action=set` **未被误伤**（不报"退役"）', m2.slice(0, 100));
  chk(/不存在/.test(m2), '④-b 它仍走到自己的实现（示例项目里报"feature 不存在"）', m2.slice(0, 100));
}

// ── ⑤⑥ 静态：退役靠 enum 表达（★ B2 改指向：原来断言"handler 里有 if(action==='propose')"，
//      那是**上一版的实现形态**；现在退役住在 schema 的 enum 里 ⇒ 判据跟着搬到 enum 上）
{
  const src = fs.readFileSync(path.join(ROOT, 'src/application/design/index.ts'), 'utf8');
  chk(!/if \(action === 'propose'\)/.test(src), '⑤ handler 里**不再**留 propose 分支（不在两处表达同一件事）');
  chk(!/进入人工审批闸门/.test(src), '⑥ 工具描述**不再宣称** propose 会"进入人工审批闸门"（旧承诺已删）');
  chk(/action:\s*z\s*\n?\s*\.enum\(\s*\['set'\]\s*\)/.test(src), '⑥-b `action` 的合法值**只有** set（enum 里没有 propose ⇒ schema 阶段就读到）');
}

console.log(`\n═══ T423 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
