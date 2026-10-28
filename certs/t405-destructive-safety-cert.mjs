#!/usr/bin/env node
/**
 * ★★★ cert T405 —— **破坏性三个工具的"安全侧"证明**（T-#CERT-1 第一批）（2026-10-28）
 *
 * ## 为什么先证这三个
 * 29 个无证工具里，这三个会**搬/删别人的代码**：
 *   `move_symbol`（跨文件搬符号）· `move_domain`（整块搬域）· `deprecate_offline`（下线/物理删模块）。
 * 生成类工具错了是"白干"，这三个错了是"弄坏"。所以先钉**拒绝语义**与**缺省安全档**。
 *
 * ## 判据（每条亲手跑；核心口径 = "拒绝时**盘上一个字节都不许动**"）
 *   ① `move_symbol dry_run:true` ⇒ 两个文件**内容 hash 全不变**；
 *   ② `move_symbol` 撞名（目标文件已有同名导出）⇒ **整体不动**（非 dry-run 也不落盘），并说明原因；
 *   ③ `move_domain`（域表没改 ⇒ 无 relocate_moves）⇒ 明确报「没有待搬的域」，**目录/文件全不变**；
 *   ④ `deprecate_offline` 缺省（不给 `dry_run`）⇒ **默认 dry_run=true**：文件一个不删、一个不改；
 *   ⑤ `deprecate_offline remove_file:true` 但 `dry_run` 未给 false ⇒ 仍然**不删**（两个开关都得给）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 不证"成功搬/成功删"的正面行为（本证只证**安全侧**；正面行为各有各的夹具，另开证）；
 *   · `move_domain` 的**正面搬迁**要改 `structure.domains.json` 再跑，本证**故意不碰**（碰了就动真仓）；
 *   · **[未核]** `deprecate_offline` 的 `verify` 编译级验收（要真跑 tsc，夹具项目没装 TS 依赖）。
 *
 * ## 用法
 *   node certs/t405-destructive-safety-cert.mjs      # ★ 先 npm run build
 *
 * touches: （只读证明，不改 src）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp405safe-'));
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

const A = 'src/a.ts';
const B = 'src/b.ts';
fs.writeFileSync(path.join(PROJ, A), 'export function fa(): number {\n  return 1;\n}\n\nexport function fb(): number {\n  return 2;\n}\n');
fs.writeFileSync(path.join(PROJ, B), 'export function fb(): number {\n  return 999;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));
fs.writeFileSync(
  path.join(PROJ, 'structure.domains.json'),
  JSON.stringify({ domains: [{ id: 'src', layer: 'domain', role: 'engine', dir: 'src', note: '夹具域' }] }, null, 2),
);

const digest = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(PROJ, rel))).digest('hex');
const snap = () => ({ a: digest(A), b: digest(B) });
const before = snap();

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');
const { moveSymbol } = await import(D + 'application/refactor/rename/symbol_move.js');
const { moveDomain } = await import(D + 'application/refactor/rename/move_domain.js');
const { deprecateOffline } = await import(D + 'application/refactor/deprecate_offline/deprecate_offline.js');

await importProject({ project_dir: PROJ, feature: 't405' });
{
  const dsl = getDSL('t405');
  for (const n of dsl.geometry.nodes ?? []) if ([A, B].includes(String(n.path ?? n.description))) n.gate = 'exempt';
  saveDSL(dsl, PROJ);
}

// ── ① move_symbol dry_run 不落盘 ─────────────────────
{
  const r = await moveSymbol({ project_dir: PROJ, file: A, symbol: 'fb', to_file: 'src/c.ts', dry_run: true });
  const after = snap();
  chk(after.a === before.a && after.b === before.b, '① `move_symbol dry_run:true` ⇒ 两个源文件**内容未变**');
  chk(!fs.existsSync(path.join(PROJ, 'src/c.ts')), '①-b 目标文件**没被创建**（dry-run 不产生副作用）');
  chk(typeof r === 'object' && r !== null, '①-c 有结构化预览返回（不是静默成功）', JSON.stringify(r).slice(0, 110));
}

// ── ② move_symbol 撞名 ⇒ 整体不动 ────────────────────
{
  const r = await moveSymbol({ project_dir: PROJ, file: A, symbol: 'fb', to_file: B });
  const after = snap();
  const msg = String(r?.message ?? r?.reason ?? JSON.stringify(r));
  chk(after.a === before.a && after.b === before.b, '② 撞名（B 已有 `fb`）⇒ **源/目标两个文件都没变**');
  chk(/撞名|同名|已存在|冲突/.test(msg) || r?.ok === false || r?.refused, '②-b 明确说明**原因**（不静默失败）', msg.slice(0, 140));
}

// ── ③ move_domain（域表没改）⇒ 无事可做且不动文件 ────
{
  let msg = '';
  try {
    const r = await moveDomain({ project_dir: PROJ });
    msg = String(r?.message ?? JSON.stringify(r));
  } catch (e) {
    msg = String(e?.message ?? e);
  }
  const after = snap();
  chk(after.a === before.a && after.b === before.b, '③ `move_domain`（域表没改）⇒ 文件**未动**');
  chk(/没有待搬|无需|无 relocate|0 个/.test(msg), '③-b 明确报「没有待搬的域」（不猜、不静默）', msg.slice(0, 150));
}

// ── ④ deprecate_offline 缺省 = dry_run ───────────────
{
  const filesBefore = fs.readdirSync(path.join(PROJ, 'src')).sort();
  let msg = '';
  try {
    const r = await deprecateOffline({ project_dir: PROJ });
    msg = String(r?.message ?? JSON.stringify(r));
  } catch (e) {
    msg = String(e?.message ?? e);
  }
  const after = snap();
  const filesAfter = fs.readdirSync(path.join(PROJ, 'src')).sort();
  chk(after.a === before.a && after.b === before.b, '④ `deprecate_offline` 缺省 ⇒ **内容未变**（缺省落在安全侧）');
  chk(JSON.stringify(filesAfter) === JSON.stringify(filesBefore), '④-b **一个文件都没被删**', `${filesBefore.join(',')} → ${filesAfter.join(',')}`);
}

// ── ⑤ remove_file:true 但没给 dry_run:false ⇒ 仍不删 ─
{
  const filesBefore = fs.readdirSync(path.join(PROJ, 'src')).sort();
  try {
    await deprecateOffline({ project_dir: PROJ, remove_file: true });
  } catch {
    /* 抛错也算安全（只要没删文件） */
  }
  const filesAfter = fs.readdirSync(path.join(PROJ, 'src')).sort();
  chk(JSON.stringify(filesAfter) === JSON.stringify(filesBefore), '⑤ `remove_file:true` 但 `dry_run` 未显式 false ⇒ **仍不删**（两个开关都要给）');
}

console.log(`\n═══ T405 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
