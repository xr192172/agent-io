#!/usr/bin/env node
/**
 * ★★★ cert T459 —— **F1b 语义层事实填充**（端到端，自建临时库，2026-10-30）
 *
 * ## 判什么
 *   ① 抽取器可用（`go` + 仓内 `gofacts`）且 `ok=true`（type-check 通过）
 *   ② **已知答案**：`occurrences` 里必须出现 `member='graphNode'` 的 selection 行
 *      —— 这正是困扰我们一整天的嵌入字段（`node.Type` 是它的提升字段）
 *   ③ **字段账**：`fields` 里 `CachedNode.graphNode` 必须 `ordinal=0 · embedded=1`
 *   ④ 幂等：连跑两次，`occurrences` 行数不翻倍（按 file_id 先删后插）
 *
 * ## 边界
 *   · 只验 Go 侧（TS 侧填充是同一张表，另证）；
 *   · 抽取器要求目标项目能 type-check；不能时本证会红 **且这是对的**（不该假装有事实）；
 *   · 用临时库 + 只插入目标项目的 files 行，不碰真实 cache.db。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const GO_PROJ = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'D:/agentio/dev/agent-memory';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { openDb } = await import(D + 'infrastructure/index/db.js');
const { fillSemanticFacts } = await import(D + 'infrastructure/index/semantic_facts.js');

const tmp = path.join(os.tmpdir(), `t459-${process.pid}.db`);
try {
  const db = openDb(tmp);

  // 预置 files 行（抽取器按相对路径回填 file_id）
  const insertFile = db.prepare(
    'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const goFiles = fs.readdirSync(GO_PROJ).filter((f) => f.endsWith('.go'));
  for (const f of goFiles) {
    const abs = path.join(GO_PROJ, f);
    insertFile.run(f, 'h', 'go', fs.statSync(abs).size, 0, 0, 0, 0);
  }

  const r1 = fillSemanticFacts(db, GO_PROJ);
  chk(r1.ok, '① 抽取器可用且 type-check 通过', `via=${r1.via} packages=${r1.packages} files=${r1.files} typeErrors=${r1.typeErrors} occ=${r1.occurrences} fields=${r1.fields}${r1.reason ? ` · ${r1.reason}` : ''}`);

  const graphNodeSel = db
    .prepare("SELECT COUNT(*) AS c FROM occurrences WHERE role='selection' AND member='graphNode'")
    .get().c;
  const sample = db
    .prepare("SELECT structure, member, line FROM occurrences WHERE role='selection' AND member='graphNode' LIMIT 1")
    .get();
  chk(graphNodeSel > 0, '② **已知答案**：occurrences 里有 graphNode 的 selection 行', `命中 ${graphNodeSel} 条 · 样例 ${JSON.stringify(sample)}`);

  const fld = db.prepare("SELECT ordinal, embedded, type FROM fields WHERE structure='CachedNode' AND name='graphNode'").get();
  chk(!!fld && fld.ordinal === 0 && fld.embedded === 1, '③ 字段账：CachedNode.graphNode ordinal=0 且 embedded=1', JSON.stringify(fld));

  const before = db.prepare('SELECT COUNT(*) AS c FROM occurrences').get().c;
  fillSemanticFacts(db, GO_PROJ);
  const after = db.prepare('SELECT COUNT(*) AS c FROM occurrences').get().c;
  chk(before === after, '④ **幂等**：连跑两次行数不翻倍', `第一次 ${before} · 第二次 ${after}`);

  // 类型引用也顺手看一眼（type 角色目前未产出 ⇒ 如实读数，不作判据）
  const byRole = db.prepare('SELECT role, COUNT(*) AS c FROM occurrences GROUP BY role ORDER BY c DESC').all();
  console.log('     角色分布：' + byRole.map((x) => `${x.role}=${x.c}`).join(' · '));

  db.close();
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch {}
}

console.log(`\n═══ T459 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
