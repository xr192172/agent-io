#!/usr/bin/env node
/**
 * ★★★ cert T397 —— **T287**：`replace_text` 未命中时不再一律说"未找到"（2026-10-28）
 *
 * ## 真因（复现出来的）
 * 同一次编辑**应用第二次**：`planReplaceText` 一律抛"未找到 old_text"，而盘上**早已是 new_text**
 * ⇒ 读回执的人会以为没生效。而 `refactor_plan` 那条路**另有一套**判法（自己 `locateReplaceText` 两遍，
 * 判 `already_applied`）⇒ **同一判据住两处、强度不同**（本仓头号病）。
 *
 * ## 修法
 * 抽出纯函数 `classifyReplaceTextMiss(content, oldText, newText)`（判据唯一住处）；
 * `planReplaceText` 用它抛带 `code='ALREADY_APPLIED'` 的错误；`refactor_plan` 改成读**错误码**，不再自己 locate。
 *
 * ## 判据（每条亲手跑）
 *   ① 重复应用 ⇒ 错误消息含「已经应用过」且 `code === 'ALREADY_APPLIED'`；
 *   ② 真没命中（old/new 都不在）⇒ 消息含「未找到」且点明「new_text 也不在」；
 *   ③ **删除类**（`new_text` 为空）**不被**误判成"已应用"（空新文本是删除的正常形态）；
 *   ④ 纯函数三态：`already_applied`（**带行号**）/ `not_found` / 空 `new_text` ⇒ `not_found`。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 `replace_text` 这一路；`range` / 符号级编辑不走这里；
 *   · **[未核]** 批量 `targets[]` 里混合"已应用 + 真失败"时的聚合文案（本证只核单文件/单项语义）。
 *
 * ## 用法
 *   node certs/t397-replace-text-miss-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/infrastructure/parse/fuzzy_match.ts, src/application/refactor/edit/edit_code.ts, pipeline/refactor_plan.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp397miss-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const REL = 'src/a.ts';
fs.writeFileSync(path.join(PROJ, REL), 'export function fa(): number {\n  return 1;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');
const { editCode, planReplaceText } = await import(D + 'application/refactor/edit/edit_code.js');
const { classifyReplaceTextMiss } = await import(D + 'infrastructure/parse/fuzzy_match.js');

await importProject({ project_dir: PROJ, feature: 't397' });
{
  const dsl = getDSL('t397');
  for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
  saveDSL(dsl, PROJ);
}

const CONTENT = 'export function fa(): number {\n  return 1;\n}\n';

// ── ④ 纯函数三态 ───────────────────────────────────────
{
  const a = classifyReplaceTextMiss(CONTENT.replace('return 1;', 'return 42;'), 'return 1;', 'return 42;');
  chk(a.kind === 'already_applied' && a.line === 2, '④ 已应用 ⇒ `already_applied` 且**带行号**', JSON.stringify(a));
  const b = classifyReplaceTextMiss(CONTENT, 'return 99;', 'return 42;');
  chk(b.kind === 'not_found', '④-b 两个都不在 ⇒ `not_found`', JSON.stringify(b));
  const c = classifyReplaceTextMiss(CONTENT.replace('  return 1;\n', ''), 'return 1;', '');
  chk(c.kind === 'not_found', '④-c **空 new_text（删除类）** ⇒ `not_found`（不许当成"已应用"）', JSON.stringify(c));
}

// ── ① 重复应用 ⇒ 已经应用过 + 错误码 ────────────────────
{
  const args = {
    project_dir: PROJ,
    op: 'replace_text',
    file: REL,
    old_text: 'return 1;',
    new_text: 'return 42;',
    reason: 't397：应用两次',
    actor: 'agent:t397',
  };
  await editCode(args, {});
  let err = null; // (Error & { code?: string }) | null —— .mjs 里不能写类型注解
  try {
    await editCode(args, {});
  } catch (e) {
    err = e;
  }
  chk(!!err && /已经应用过/.test(err.message), '① 第二次应用 ⇒ 消息说「**已经应用过**」', err?.message.split('\n')[0]?.slice(0, 120) ?? '(没抛)');
  chk(err?.code === 'ALREADY_APPLIED', '①-b 带**机器可判**的错误码 `ALREADY_APPLIED`', String(err?.code));
}

// ── ② 真没命中 ⇒ 未找到 + 点明 new 也不在 ───────────────
{
  let err = null;
  try {
    await planReplaceText(path.join(PROJ, REL), CONTENT, '\n', 'return 99;', 'return 777;');
  } catch (e) {
    err = e;
  }
  chk(!!err && /未找到/.test(err.message) && /new_text 也不在/.test(err.message), '② 真没命中 ⇒ 说「未找到」并点明「**new_text 也不在**」', err?.message.split('\n')[0]?.slice(0, 120) ?? '(没抛)');
  chk(err?.code !== 'ALREADY_APPLIED', '②-b 这一路**不带** `ALREADY_APPLIED`（两件事不许混）', String(err?.code));
}

console.log(`\n═══ T397 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
