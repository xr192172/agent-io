#!/usr/bin/env node
/**
 * ★★★ cert T424 —— **死链已退役**（T-#OBSERVE-9 收口）（2026-10-28）
 *
 * ## 这张证**只能防什么**（用户指出来的：别高估它）
 * `code_workbench` + `llm_decider` 是死链（无产者、无审阅人），已删。
 * 但**删干净的东西不会自己复发** —— 会复发的是「有人**重新发明**同一个能力」，
 * 而那**不是证能防的**（换个文件名就绕过了）。
 *
 * ⇒ 所以分工是：
 * · **本证** 只防**意外复活**：旧分支 merge 回来、`git revert`、残留 import、批量恢复文件；
 * · **`docs/RETIRED.md`（删除台账）** 防**重新发明**：记清"做过 / 凭什么砍 / 现在用什么 / 代价"，
 *   下一个想重做的人先读到它。
 *
 * ★ 换句话说：证是**门禁**，台账是**记忆**。只有门禁没有记忆，人还会再走一遍老路。
 *
 * ## 判据（每条亲手跑）
 *   ① 两个文件**不存在**（`code_workbench.ts` / `llm_decider.ts`）；
 *   ② `src/` 里**没有** import 指向它们（注释里的历史说明不算）；
 *   ③ 工具面**仍是 55 个**，且没有"代码审批"类工具；
 *   ④ `pending-changes` 这个文件名**不再被活代码引用**（只允许出现在冻结基线 `certs/t185-base/` 里）；
 *   ⑤ `design_intent` 的描述**不再宣称** propose 可用（"已退役"必须写进工具描述，
 *      否则模型读到的仍是旧承诺）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只钉"这些文件/名称不在"；**不钉**"未来不该有代码变更提案能力"（那是产品决定，不是事实）；
 *   · **[未核]** `certs/t185-base/run82.json` 里的历史提及是冻结基线，故意不动。
 *
 * ## 用法
 *   node certs/t424-dead-chain-retired-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp424dead-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ── ① 文件不存在 ──────────────────────────────────────
for (const rel of ['src/application/design/workbench/code_workbench.ts', 'src/application/meta/llm/llm_decider.ts']) {
  chk(!fs.existsSync(path.join(ROOT, rel)), `① 死链文件**不存在**：${rel}`);
}

// ── ② 没有 import 指向它们 ────────────────────────────
{
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) {
        const src = fs.readFileSync(p, 'utf8');
        // 只看真实 import/export from 语句，不看注释
        if (/from\s+['"][^'"]*(code_workbench|llm_decider)\.js['"]/.test(src)) bad.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  chk(bad.length === 0, '② `src/` 里**没有** import 指向已删文件（注释里的历史说明不算）', bad.join(', ') || '0 处');
}

// ── ③ 工具面不变，且没有"代码审批"类工具 ───────────────
{
  const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
  const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
  const names = TOOL_DEFS.map((t) => t.name);
  // ★ 2026-10-30（B2 删除执行）：**删掉「工具面仍是 55 个」这条断言** —— 写死计数（55 是删死链那天的快照，
  //   现在 44）。工具数由注册表现取，证里不再存第二份；本段真正要断言的是下面 ③-b「没有代码审批类工具」。
  console.log(`  · 读数量具：注册表现有 ${names.length} 个工具（不入断言）`);
  const suspicious = names.filter((x) => /review_changes|code_approve|approve_change/.test(x));
  chk(suspicious.length === 0, '③-b 没有"代码审批"类工具', suspicious.join(', ') || '无');
}

// ── ④ pending-changes 不再是活引用 ─────────────────────
{
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        if (/pending-changes/.test(src)) hits.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  chk(hits.length === 0, '④ `pending-changes` 不再被 `src/` 活代码引用', hits.join(', ') || '0 处');
}

// ── ⑤ design_intent 描述不再宣称 propose 可用 ───────────
{
  const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
  const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
  const def = TOOL_DEFS.find((t) => t.name === 'design_intent');
  const desc = String(def?.description ?? '');
  // ★ 2026-10-30（B2 改指向）：退役的可判事实是「propose **不可表达**」（enum 只剩 set），
  //   而不是"描述里出现'已退役'四个字"（那是铭文，不是判据；描述后来被收敛掉了，字面断言就必红）。
  const actOpts = (() => {
    const a = def?.inputSchema?.action;
    const inner = a?.innerType ?? a?.def?.innerType ?? a?._def?.innerType ?? a;
    return inner?.options ?? inner?.enum ?? null;
  })();
  chk(Array.isArray(actOpts) && !actOpts.includes('propose'), '⑤ `action` 的 enum **没有** `propose`（schema 层就拒 ⇒ 模型读到的就是它）', `enum=${JSON.stringify(actOpts)}`);
  chk(/opl/.test(desc) && /observe action=proposals/.test(desc), '⑤-c 描述给出**替代路径**（opl 立卡 / observe action=proposals）', desc.slice(0, 110));
  chk(!/永不直接落盘/.test(desc), '⑤-b 描述里**不再**有"propose 永不直接落盘"这种已不成立的承诺');
}

console.log(`\n═══ T424 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
