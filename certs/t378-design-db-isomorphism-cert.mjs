#!/usr/bin/env node
/**
 * ★★★ cert T378 —— **实际 DB ↔ 设计 DB 的同构判据**（2026-10-28 · 用户假设"实际侧升级忘了同步设计侧"）
 *
 * ## 病史（本证的立证理由）
 * `gen_design_db` 的头注释一直写着「与实际 DB **同构**」，但实测：
 *   实际侧 `nodes` **21 列**，设计侧 `symbols[]` 只带 **5 键**（name/kind/line/signature/members）。
 * `sym_hash` 早在 **2026-09-30** 就在实际侧了，设计侧 **2026-10-24** 还在改别的（expected_symbols）——
 * **升级了实际侧、忘了同步设计侧**。⇒「同构」从判据退化成散文（写着、没有执行者）。
 * ★ 为什么这件事致命：`rewrite_plan` 的锚点就是 `sym_hash`（行号会漂），同构不同步 ⇒ 锚点是空中楼阁。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① 映射表**覆盖 `nodes` 全部列**（拿 `PRAGMA table_info` 对账，一个都不许沉默）；
 *   ② 每一列都有交代：投影（`key`）或**写明理由**的不投影（`why` 非空）；
 *   ③ 键名**唯一**（两列映到同一键 = 静默覆盖）；
 *   ④ `symbolSelectSql()` 的列**逐字来自映射表**（手写列名是漂移入口）；
 *   ⑤ 已生成的设计 DB 里，`symbols[]` 的键**只能是**映射表声明的那些，且**必须带 `sym_hash`**；
 *   ⑥ 回归钉子：`body_text` / `updated_at` / `id` **不投影**；`sym_hash` / `body_hash` **投影**。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · `design-db/` 是**本地产物**（`.gitignore:246` 忽略）⇒ ⑤ 在没生成时**跳过并如实报**，
 *     不是假绿（①–④⑥ 全部只依赖入库的代码，可当门）；
 *   · `cache.db` 也不入库 ⇒ ① 同样按"有就跑、没有就报 unsupported"处理；
 *   · **[未核] `v_imports` / `edges` 的同构**：本证只管符号级（`nodes` 表）。
 *
 * ## 用法
 *   node certs/t378-design-db-isomorphism-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/design_db_projection.ts, gen_design_db.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = 'D:/agentio/dev/agent-io';
let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { SYMBOL_COLUMN_MAP, projectedSymbolKeys, symbolSelectSql } = await import(
  'file:///D:/agentio/dev/agent-io/dist/src/application/design/db/design_db_projection.js'
);

// ── ② 每一列都有交代（先跑：纯静态）────────────────────────
{
  const silent = SYMBOL_COLUMN_MAP.filter((d) => !d.key && !(d.why ?? '').trim());
  chk(silent.length === 0, '② 不投影的列**都写了理由**（不许沉默）', silent.map((d) => d.column).join(',') || '全部有交代');
}

// ── ③ 键名唯一 ────────────────────────────────────────────
{
  const keys = projectedSymbolKeys();
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  chk(dup.length === 0, '③ 投影键**唯一**（两列映到同一键 = 静默覆盖）', dup.join(',') || `${keys.length} 个键`);
}

// ── ④ SQL 逐列来自映射表 ──────────────────────────────────
{
  const sql = symbolSelectSql();
  const missing = SYMBOL_COLUMN_MAP.filter((d) => !new RegExp(`\\b${d.column}\\b`).test(sql)).map((d) => d.column);
  chk(missing.length === 0 && /FROM nodes/.test(sql), '④ `symbolSelectSql()` 的列**逐字来自映射表**', missing.join(',') || '无漏列');
}

// ── ⑥ 回归钉子（先钉，防"修好又漂回去"）──────────────────
{
  const key = Object.fromEntries(SYMBOL_COLUMN_MAP.map((d) => [d.column, d.key ?? null]));
  chk(key.sym_hash === 'sym_hash' && key.body_hash === 'body_hash', '⑥-a `sym_hash` / `body_hash` **被投影**（重写锚点就在这）', `sym_hash→${key.sym_hash} · body_hash→${key.body_hash}`);
  chk(
    key.body_text === null && key.updated_at === null && key.id === null,
    '⑥-b `body_text` / `updated_at` / `id` **不投影**（正文抖、时间戳每次都变、内部 id 跨机器不稳）',
    `body_text=${key.body_text} · updated_at=${key.updated_at} · id=${key.id}`,
  );
}

// ── ① 映射表覆盖 `nodes` 全部列（要 cache.db）──────────────
const DB = path.join(ROOT, '.agent-io/cache.db');
if (!fs.existsSync(DB)) {
  console.log('⚠ ① 跳过：没有 cache.db（不入库）⇒ 无法与真实 DDL 对账；①只有④的静态部分可判');
} else {
  const db = new DatabaseSync(DB, { readOnly: true });
  const cols = db.prepare('PRAGMA table_info(nodes)').all().map((c) => c.name);
  db.close();
  const declared = new Set(SYMBOL_COLUMN_MAP.map((d) => d.column));
  const uncovered = cols.filter((c) => !declared.has(c));
  const phantom = [...declared].filter((c) => !cols.includes(c));
  chk(
    uncovered.length === 0 && phantom.length === 0,
    `① 映射表把 \`nodes\` 的 **${cols.length} 列**全交代了（无沉默、无幽灵）`,
    uncovered.length || phantom.length ? `沉默：${uncovered.join(',')} · 幽灵：${phantom.join(',')}` : `${SYMBOL_COLUMN_MAP.length} 条交代`,
  );
}

// ── ⑤ 已生成的设计 DB：键只能是声明过的，且必须带 sym_hash ──
const SAMPLE = path.join(ROOT, 'design-db/application-design-line-design_line.calls.json');
if (!fs.existsSync(SAMPLE)) {
  console.log('⚠ ⑤ 跳过：`design-db/` 未生成（本地产物，不入库）');
} else {
  const j = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const allowed = new Set(projectedSymbolKeys());
  const extra = new Set();
  for (const s of j.symbols ?? []) for (const k of Object.keys(s)) if (!allowed.has(k)) extra.add(k);
  const withHash = (j.symbols ?? []).filter((s) => typeof s.sym_hash === 'string' && s.sym_hash).length;
  chk(extra.size === 0, '⑤-a 设计 DB 里的符号键**只有**映射表声明的那些（没有偷偷多出来的）', [...extra].join(',') || `${(j.symbols ?? []).length} 个符号`);
  chk(withHash > 0, '⑤-b 符号**带 `sym_hash`**（重写锚点可用）', `带哈希的符号 ${withHash}/${(j.symbols ?? []).length}`);
  const keysSeen = Object.keys((j.symbols ?? [])[0] ?? {}).join(',');
  chk(!/body_text/.test(keysSeen), '⑤-c 正文**没有**混进来（`body_text` 不投影）', keysSeen);
}

console.log(`\n═══ T378 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
