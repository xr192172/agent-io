#!/usr/bin/env node
/**
 * design-line.mjs —— ★ 设计线业务链【一步一读数】
 *
 * ## 它回答一个问题
 * "这条业务线现在到哪一步了、每步的产物是什么、有多少"
 *
 * ## 业务链（用户 2026-10-19 定义）
 * ```
 * 源码 → 实际 DB → 实际 DSL → 设计 DSL → 设计 DB → 源码（重写）
 *  ①       ②          ③           ④          ⑤         ⑥
 * ```
 *
 * ## 用法
 *   node scripts/design-line.mjs            # 只读（不改任何东西）
 *   node scripts/design-line.mjs --run      # 顺带跑 ①（扫描）和 ⑤（生成设计 DB）
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const RUN = process.argv.includes('--run');
const feature = 'task-system-plan';
const p = {
  design: path.join(ROOT, '.agent-io', 'design', `${feature}.dsl.json`),
  live: path.join(ROOT, '.agent-io', 'live', `${feature}.dsl.json`),
  db: path.join(ROOT, '.agent-io', 'cache.db'),
  designDb: path.join(ROOT, 'certs', 'design-db'),
};

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const no = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const wait = (s) => `\x1b[33m·\x1b[0m ${s}`;
const row = (step, name, io, state) => {
  console.log(`\n${step}  ${name}`);
  console.log(`    ${io}`);
  console.log(`    ${state}`);
};

// ── ① 源码 → 实际 DB ──────────────────────────────────────────
let dbFiles = 0;
let dbSymbols = 0;
let dbCalls = 0;
if (fs.existsSync(p.db)) {
  const db = new DatabaseSync(p.db, { readOnly: true });
  dbFiles = db.prepare("SELECT COUNT(*) c FROM files WHERE path NOT LIKE 'scripts/%' AND path NOT LIKE 'dogfood/%'").get().c;
  dbSymbols = db.prepare('SELECT COUNT(*) c FROM nodes WHERE parent IS NULL').get().c;
  dbCalls = db.prepare("SELECT COUNT(*) c FROM edges WHERE kind = 'call'").get().c;
  db.close();
}
row('①', '源码 → 实际 DB', 'import_project（扫描 + 符号 + 调用边）',
  dbFiles ? ok(`cache.db：${dbFiles} 文件 · ${dbSymbols} 符号 · ${dbCalls} 调用边`) : no('cache.db 不存在'));

// ── ② 实际 DB → 实际 DSL ─────────────────────────────────────
let liveNodes = 0;
let liveEdges = 0;
if (fs.existsSync(p.live)) {
  const j = JSON.parse(fs.readFileSync(p.live, 'utf8'));
  liveNodes = j.geometry?.nodes?.length ?? 0;
  liveEdges = j.geometry?.edges?.length ?? 0;
}
row('②', '实际 DB → 实际 DSL', 'renderLiveFromDb（投影）',
  liveNodes ? ok(`live/：${liveNodes} 节点 · ${liveEdges} 边`) : no('live/ 不存在（跑 --run 或 import_project）'));

// ── ③ 实际 DSL → 设计 DSL ────────────────────────────────────
let dNodes = 0;
let dDecisions = 0;
let dReqs = 0;
let dTodds = 0;
if (fs.existsSync(p.design)) {
  const j = JSON.parse(fs.readFileSync(p.design, 'utf8'));
  dNodes = j.geometry?.nodes?.length ?? 0;
  dDecisions = (j.geometry?.nodes ?? []).filter((n) => n.decision).length;
  dReqs = (j.geometry?.nodes ?? []).reduce((s, n) => s + (n.decision?.expectations?.length ?? 0), 0);
  dTodds = (j.todos ?? []).length;
}
row('③', '实际 DSL → 设计 DSL', 'fork（一次性，之后由人写）',
  dNodes ? ok(`design/：${dNodes} 节点 · ★ ${dDecisions} 个 decision · ${dReqs} 条 expectations · ${dTodds} 张卡`) : no('design/ 不存在'));

// ── ④ 设计 DSL 上写意图（产物就是 ③ 里的 decision/expectations）──
row('④', '在设计 DSL 上写意图', 'edit_dsl / design_intent（人写）',
  dDecisions ? ok(`已写：${dDecisions} 个 decision（其中 ${dReqs} 条判据）`) : wait('还没写 decision'));

// ── ⑤ 设计 DSL → 设计 DB ────────────────────────────────────
let dbCount = 0;
let dbSyms = 0;
let dbCalls2 = 0;
let dbReqs = 0;
if (fs.existsSync(p.designDb)) {
  const files = fs.readdirSync(p.designDb).filter((f) => f.endsWith('.calls.json'));
  dbCount = files.length;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(p.designDb, f), 'utf8'));
    dbSyms += j.symbols?.length ?? 0;
    dbCalls2 += j.calls?.length ?? 0;
    dbReqs += j.requirements_calls?.length ?? 0;
  }
}
row('⑤', '设计 DSL → 设计 DB', 'gen-design-db（全量，与实际 DB 同构）',
  dbCount ? ok(`certs/design-db/：${dbCount} 份 · ${dbSyms} 符号 · ${dbCalls2} 调用 · ★ ${dbReqs} 条设计要求`) : no('设计 DB 未生成（跑 --run）'));

// ── ⑥ 设计 DB → 源码 ────────────────────────────────────────
row('⑥', '设计 DB → 源码（重写）', '重构线（impact_analysis + 重写）',
  wait('未实现 —— 这是 VISION.md §6 的"接入重构线"'));
