/**
 * design_line —— 设计链【六步读数】（工具面入口，从 `scripts/design-line.mjs` 收进来）
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
 * ## ★ ⑥ 为什么不再写"未实现"
 * 旧脚本对 ⑥ 只能打印 `未实现 —— 这是 VISION.md §6 的"接入重构线"`。
 * 那是一句**装饰**：读的人得不到任何读数，也看不出还差多少。
 * 现在它给一条**真读数**：设计 DB 覆盖了多少源码文件、还有多少没覆盖。
 * ★ 这只是**计数级**（不是符号级）：符号级差分归 `rewrite` / `design-diff`。
 *
 * ## 纪律
 * - **只读**：不碰任何文件、不写 DSL、不改源码。
 * - `lineReport` 是纯函数（给 root + feature，返回结构化读数），`designLineHandler` 只做入参适配
 *   ⇒ 判据能单测，不用起 MCP。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** 单步读数 */
export interface LineStep {
  /** ①..⑥ */
  id: string;
  /** 这一步叫什么 */
  name: string;
  /** 谁干这活（工具名 / 人） */
  by: string;
  /** ok=有产物 · missing=产物不存在 · pending=还没实现 */
  status: 'ok' | 'missing' | 'pending';
  /** 一句话读数（带数字） */
  reading: string;
}

export interface LineReport {
  feature: string;
  steps: LineStep[];
  /** 六步里 ok / missing / pending 各几个 —— 便于一眼看"断在哪" */
  tally: { ok: number; missing: number; pending: number };
}

const n = (x: number): string => x.toLocaleString('en-US');

/** 六步读数（纯函数：只读磁盘与 cache.db） */
export function lineReport(root: string, feature: string): LineReport {
  const p = {
    db: path.join(root, '.agent-io', 'cache.db'),
    live: path.join(root, '.agent-io', 'live', `${feature}.dsl.json`),
    design: path.join(root, '.agent-io', 'design', `${feature}.dsl.json`),
    designDb: path.join(root, 'certs', 'design-db'),
  };

  // ── ① 源码 → 实际 DB ──
  let dbFiles = 0;
  let dbSymbols = 0;
  let dbCalls = 0;
  const sourceFiles: string[] = [];
  if (fs.existsSync(p.db)) {
    const db = new DatabaseSync(p.db, { readOnly: true });
    try {
      // ★ 与旧脚本同口径：排除 scripts/ 与 dogfood/（它们不是产品面）
      const rows = db
        .prepare("SELECT path FROM files WHERE path NOT LIKE 'scripts/%' AND path NOT LIKE 'dogfood/%'")
        .all() as Array<{ path: string }>;
      for (const r of rows) sourceFiles.push(r.path);
      dbFiles = sourceFiles.length;
      dbSymbols = (db.prepare('SELECT COUNT(*) c FROM nodes WHERE parent IS NULL').get() as { c: number }).c;
      dbCalls = (db.prepare("SELECT COUNT(*) c FROM edges WHERE kind = 'call'").get() as { c: number }).c;
    } finally {
      db.close();
    }
  }

  // ── ② 实际 DB → 实际 DSL ──
  let liveNodes = 0;
  let liveEdges = 0;
  if (fs.existsSync(p.live)) {
    const j = JSON.parse(fs.readFileSync(p.live, 'utf8'));
    liveNodes = j.geometry?.nodes?.length ?? 0;
    liveEdges = j.geometry?.edges?.length ?? 0;
  }

  // ── ③ / ④ 设计 DSL（人写意图）= ③ 的产物 ──
  let dNodes = 0;
  let dDecisions = 0;
  let dReqs = 0;
  let dTodos = 0;
  if (fs.existsSync(p.design)) {
    const j = JSON.parse(fs.readFileSync(p.design, 'utf8'));
    dNodes = j.geometry?.nodes?.length ?? 0;
    dDecisions = (j.geometry?.nodes ?? []).filter((x: { decision?: unknown }) => x.decision).length;
    dReqs = (j.geometry?.nodes ?? []).reduce(
      (s: number, x: { decision?: { expectations?: unknown[] } }) => s + (x.decision?.expectations?.length ?? 0),
      0,
    );
    dTodos = (j.todos ?? []).length;
  }

  // ── ⑤ 设计 DSL → 设计 DB ──
  let dbCount = 0;
  let dbSyms = 0;
  let dbCalls2 = 0;
  let dbReqs = 0;
  /** 设计 DB 覆盖了哪些源码文件（用副本里记的 path，不靠文件名猜） */
  const covered = new Set<string>();
  if (fs.existsSync(p.designDb)) {
    for (const f of fs.readdirSync(p.designDb)) {
      if (!f.endsWith('.calls.json')) continue;
      dbCount += 1;
      const j = JSON.parse(fs.readFileSync(path.join(p.designDb, f), 'utf8'));
      dbSyms += j.symbols?.length ?? 0;
      dbCalls2 += j.calls?.length ?? 0;
      dbReqs += j.requirements_calls?.length ?? 0;
      // ★ 2026-10-19：**优先读 `path` 字段**（副本自报路径，gen-design-db 已输出）。
      //   只有在读旧产物（没有该字段）时才退回解析首行 `//` 注释 —— 那是给人看的，格式一变就断，
      //   不再作为主路径。
      if (typeof j.path === 'string') covered.add(j.path.replace(/\\/g, '/'));
      else {
        const m = String(j['//'] ?? '').match(/——\s*([^\s（(]+)/u);
        if (m) covered.add(m[1].replace(/\\/g, '/'));
      }
    }
  }

  // ── ⑥ 设计 DB → 源码：★ 真读数（覆盖差），不是"未实现" ──
  const uncovered = sourceFiles.filter((s) => !covered.has(s));
  const coverRate = sourceFiles.length > 0 ? ((covered.size / sourceFiles.length) * 100).toFixed(1) : '0.0';

  const steps: LineStep[] = [
    {
      id: '①',
      name: '源码 → 实际 DB',
      by: 'import_project（扫描 + 符号 + 调用边）',
      status: dbFiles ? 'ok' : 'missing',
      reading: dbFiles
        ? `cache.db：${n(dbFiles)} 文件 · ${n(dbSymbols)} 符号 · ${n(dbCalls)} 调用边`
        : 'cache.db 不存在',
    },
    {
      id: '②',
      name: '实际 DB → 实际 DSL',
      by: 'renderLiveFromDb（投影）',
      status: liveNodes ? 'ok' : 'missing',
      reading: liveNodes ? `live/：${n(liveNodes)} 节点 · ${n(liveEdges)} 边` : 'live/ 不存在（跑 import_project）',
    },
    {
      id: '③',
      name: '实际 DSL → 设计 DSL',
      by: 'fork（一次性，之后由人写）',
      status: dNodes ? 'ok' : 'missing',
      reading: dNodes
        ? `design/：${n(dNodes)} 节点 · ★ ${dDecisions} 个 decision · ${n(dReqs)} 条 expectations · ${dTodos} 张卡`
        : 'design/ 不存在',
    },
    {
      id: '④',
      name: '在设计 DSL 上写意图',
      by: 'edit_dsl / design_intent（人写）',
      status: dDecisions ? 'ok' : 'pending',
      reading: dDecisions ? `已写：${dDecisions} 个 decision（其中 ${n(dReqs)} 条判据）` : '还没写 decision',
    },
    {
      id: '⑤',
      name: '设计 DSL → 设计 DB',
      by: 'gen-design-db（全量，与实际 DB 同构）',
      status: dbCount ? 'ok' : 'missing',
      reading: dbCount
        ? `certs/design-db/：${dbCount} 份 · ${n(dbSyms)} 符号 · ${n(dbCalls2)} 调用 · ★ ${dbReqs} 条设计要求`
        : '设计 DB 未生成',
    },
    {
      id: '⑥',
      name: '设计 DB → 源码（重写）',
      by: 'rewrite（结构重写：只改签名，实现永远人写）',
      status: dbCount && sourceFiles.length ? 'ok' : 'missing',
      reading:
        dbCount && sourceFiles.length
          ? `覆盖：设计 DB ${dbCount} 份 / 源码 ${n(sourceFiles.length)} 文件 = ${coverRate}%；` +
            `★ 未覆盖 ${n(uncovered.length)} 个（设计侧还没有副本；符号级差分归 rewrite / design-diff）`
          : '设计 DB 或源码缺失，无法算覆盖',
    },
  ];

  const tally = { ok: 0, missing: 0, pending: 0 };
  for (const s of steps) tally[s.status] += 1;
  return { feature, steps, tally };
}

/** MCP handler（只做入参适配 + 渲染文本） */
export function designLineHandler(input: { project_dir: string; feature: string }): {
  message: string;
  data: LineReport;
} {
  const report = lineReport(input.project_dir, input.feature);
  const icon = (s: LineStep['status']): string => (s === 'ok' ? '✓' : s === 'missing' ? '✗' : '·');
  const lines = [
    `设计链 · ${report.feature}（ok ${report.tally.ok} / missing ${report.tally.missing} / pending ${report.tally.pending}）`,
  ];
  for (const s of report.steps) {
    lines.push(`${s.id} ${s.name}  ${icon(s.status)}`);
    lines.push(`    ${s.by}`);
    lines.push(`    ${s.reading}`);
  }
  lines.push('★ 只读：不改 DSL、不改源码。');
  return { message: lines.join('\n'), data: report };
}
