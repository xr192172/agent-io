#!/usr/bin/env node
/**
 * gen_ledger_view.mjs —— 台账视图生成 / 对账（`npm run ledger:render` / `npm run ledger:check`）。
 *
 * ★ 本文件**不排版**：它只做四件事 —— 调 `renderLedgerView`（application 里的唯一渲染器）、写盘、
 *   打印读数、给退出码。"同一渲染器"在这里是**结构保证**：本文件里没有任何拼接视图行的代码。
 * ★ 退出码仿 tetherto/mdk：`0` 最新 / `3` 陈旧或缺失（去跑 render）/ `1` 判定或生成本身坏了。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const wantCheck = argv.includes('--check');
const header = !argv.includes('--no-header');
const requireEngine = argv.includes('--require-engine');
const mod = await import(new URL('../src/application/ledger/render_ledger_view.ts', import.meta.url).href);

if (wantCheck) {
  const r = mod.checkLedgerView(ROOT, { header, requireEngine });
  const tag = { current: '✓ 最新', 'degraded-current': '✓ 最新（降级：引擎没验）', stale: '✗ 已过期', missing: '✗ 缺失', 'hand-edited': '✗ 手改', unjudgeable: '✗ 判不了', 'render-failed': '✗ 渲染失败' }[r.state];
  console.log(`${tag}（state=${r.state} · exit=${r.exit}）`);
  console.log(`  ${r.why}`);
  if (r.ordinal_gaps.length) console.log(`  ★ 源行号缺口（可判的丢行）：${r.ordinal_gaps.slice(0, 10).join(', ')}${r.ordinal_gaps.length > 10 ? ' …' : ''}`);
  if (r.header_sha_ok === false) console.log('  ★ 头里的 body_sha256 与正文不符 ⇒ 正文被手改过（无引擎环境也能判）');
  // ★★★ 2026-11-17（L3b / E6b）：手改视图**不只是"点名"** —— importer 会**拒绝**把它灌回引擎。
  //   这一行是那个拒绝的**预览**（判据仍只住 application 层 `viewSourceTrust`，本脚本不判第二次）。
  if (r.state === 'hand-edited') {
    console.log('  ★ E6b：手改视图 ⇒ `importLedger`（引擎灌回）**拒绝执行** —— 视图不是源（先 `git checkout -- docs/todo.md` 或走引擎）');
  }
  console.log(`  读数：引擎行 ${r.counters.rows} · 引擎新行 ${r.counters.engine_rows} · 事件行 ${r.counters.event_lines} · 盘上 ${r.counters.disk_bytes} B`);
  process.exit(r.exit);
}

const r = mod.renderLedgerView(ROOT, { header });
if (r.error) {
  console.log(`✗ 生成失败：${r.error}`);
  process.exit(1);
}
const file = path.join(ROOT, mod.VIEW_REL);
const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
fs.writeFileSync(file, r.text, 'utf8');
console.log(`✓ 已生成 ${mod.VIEW_REL}：${r.lines} 行 / ${Buffer.byteLength(r.text)} B（引擎行 ${r.rows} · 引擎新行 ${r.engine_rows} · 事件行 ${r.event_lines}）`);
if (r.ordinal_gaps.length) console.log(`  ★ 源行号缺口：${r.ordinal_gaps.join(', ')} —— 引擎里缺这些源行，视图会少内容（先去 refresh / 修 importer）`);
if (before !== null && before === r.text) console.log('  （与盘上逐字节相同：本次无变化）');
process.exit(0);
