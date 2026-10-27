#!/usr/bin/env node
/**
 * ★★★ cert T372 —— **工具使用账本的 GC（保留期 + 聚合压缩）**（2026-10-27 · 用户问的"要不要做 GC"）
 *
 * ## 本笔新增的方向
 *   · `dogfood_stats.ts#compactUsageLog` —— 把早于保留期的**原始行**折进 `usage-rollup.json`
 *     的 `(日 × 工具 × 来源 × 动作)` 计数桶；默认 dry-run；`apply` 前过守恒校验；落盘原子；
 *   · `snapshotDogfoodStats` **把 rollup 一起算** ⇒ GC 之后读数不缩水。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **dry-run 不改盘**：账本与 rollup 的内容逐字节不变；
 *   ② **apply 后账本只剩保留期内的行**，且**坏行原样留着**（不许借 GC 抹证据）；
 *   ③ **守恒**：`归档行数 == 新桶计数 - 旧桶计数`；桶里的次数/成功失败/下一棒都跟着搬过去；
 *   ④ **读数不变**：GC 前后 `snapshotDogfoodStats` 的 `total`、工具集合、`by_via` 计数**逐字相同**
 *      （这是"删明细不删统计"的判据）；
 *   ⑤ **再跑一次是空的**（幂等：没有可归档的行 ⇒ 不动盘）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **丢的是 `ms` 明细**：桶里只留次数 —— 想看"某一次多慢"只能在保留期内查（这是 GC 的代价，写在读数里）；
 *   · **[未核] `AGENT_IO_DOGFOOD_FILE` 覆写 + 只读目录** 的失败路径；
 *   · **[未核] 多进程同时 record + gc**：账本 grow 与重写并发未验证。
 *
 * ## 用法
 *   node certs/t372-usage-gc-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/infrastructure/dogfood_stats.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp372gc-'));
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { compactUsageLog, usageRollupFile, readUsageRollup, snapshotDogfoodStats, dogfoodLogDir } = await import(
  '../dist/src/infrastructure/dogfood_stats.js'
);

const LOG = path.join(dogfoodLogDir(), 'usage.jsonl');
const ROLLUP = usageRollupFile();
fs.mkdirSync(path.dirname(LOG), { recursive: true });

/** 造账本：3 条很老的 + 2 条新的 + 1 条坏行 */
const day = (n) => new Date(Date.UTC(2026, 0, n, 12, 0, 0)).toISOString();
const lines = [
  JSON.stringify({ ts: day(1), tool: 'old_tool', via: 'mcp', ok: true, ms: 10, nextHops: 1 }),
  JSON.stringify({ ts: day(2), tool: 'old_tool', via: 'mcp', ok: false, ms: 20 }),
  JSON.stringify({ ts: day(3), tool: 'get_dsl', via: 'cert', ok: true, ms: 30, nextHops: 2 }),
  JSON.stringify({ ts: new Date(Date.now() - 3600_000).toISOString(), tool: 'edit_dsl', via: 'mcp', ok: true, ms: 5 }),
  JSON.stringify({ ts: new Date(Date.now() - 60_000).toISOString(), tool: 'edit_dsl', via: 'mcp', ok: false, ms: 7 }),
  '{ 这不是合法 JSON',
];
fs.writeFileSync(LOG, lines.join('\n') + '\n', 'utf-8');
// ★ 保留期 30 天 ⇒ 2026-01-01/02/03 都该被归档（用固定 now 让判据不随"今天"漂）
const NOW = new Date(Date.UTC(2026, 2, 1, 0, 0, 0)); // 2026-03-01 ⇒ 分界 2026-01-30，1 月 1/2/3 那三条都进归档

const before = snapshotDogfoodStats({ includeSweeps: true });
const beforeText = fs.readFileSync(LOG, 'utf-8');

// ── ① dry-run 不改盘 ─────────────────────────────────────
const dry = compactUsageLog({ keepDays: 30, now: NOW, apply: false });
chk(
  fs.readFileSync(LOG, 'utf-8') === beforeText && !fs.existsSync(ROLLUP),
  '① dry-run **一个字节不改**（账本原样、rollup 不生成）',
  `lines_archive=${dry.lines_archive} lines_keep=${dry.lines_keep} applied=${dry.applied}`,
);

// ── ②③ apply：归档 + 坏行保留 + 守恒 ─────────────────────
const rep = compactUsageLog({ keepDays: 30, now: NOW, apply: true });
const afterText = fs.readFileSync(LOG, 'utf-8');
const afterLines = afterText.split('\n').filter(Boolean);
chk(rep.applied === true, '②-a 真写盘（applied=true）', JSON.stringify({ keep: rep.lines_keep, arch: rep.lines_archive }));
chk(
  afterLines.length === 3 && afterLines.every((l) => !l.includes('old_tool')) && !afterLines.some((l) => l.includes('get_dsl')),
  '②-b 账本只剩**保留期内**的那 2 条 + 1 条**坏行**（坏行原样留着）',
  `剩 ${afterLines.length} 行`,
);
chk(afterLines.includes('{ 这不是合法 JSON'), '②-c 坏行**没被删**（不许借 GC 抹证据）');
const rollup = readUsageRollup();
const rollupCalls = rollup.buckets.reduce((n, b) => n + b.ok + b.failed, 0);
chk(
  rep.lines_archive === 3 && rollupCalls === 3,
  '③ 守恒：归档 3 条 ⇒ 桶里计数合计 3（次数/成功失败跟着搬）',
  `buckets=${rollup.buckets.length} calls=${rollupCalls}`,
);
// ★ 桶是**按天**分的：old_tool 那条 ok 在 1 月 1 日、failed 在 1 月 2 日 ⇒ 两个桶，按工具合计才对
const sumBy = (tool, key) => rollup.buckets.filter((b) => b.tool === tool).reduce((n, b) => n + b[key], 0);
chk(
  sumBy('old_tool', 'ok') === 1 && sumBy('old_tool', 'failed') === 1 && sumBy('get_dsl', 'hinted') === 1,
  '③-b 桶里逐项对得上（old_tool 成功 1 失败 1 · get_dsl 带下一棒 1；按天分桶、按工具合计）',
  JSON.stringify(rollup.buckets.map((b) => `${b.day}/${b.tool}:${b.ok}/${b.failed}/${b.hinted}`)),
);

// ── ④ 读数不变（删明细不删统计）───────────────────────────
const after = snapshotDogfoodStats({ includeSweeps: true });
const toolKey = (s) => s.tools.map((t) => `${t.tool}:${t.calls}/${t.ok}/${t.failed}/${t.hinted}`).sort().join(' · ');
const viaKey = (s) => s.by_via.map((v) => `${v.via}:${v.calls}/${v.ok}/${v.failed}`).sort().join(' · ');
chk(after.total === before.total, '④-a `total` 前后一致', `${before.total} ⇒ ${after.total}`);
chk(toolKey(after) === toolKey(before), '④-b 工具表逐项一致（次数/成功/失败/下一棒）', toolKey(after));
chk(viaKey(after) === viaKey(before), '④-c `by_via` 逐项一致', viaKey(after));

// ── ⑤ 幂等：再跑一次没有可归档的行 ───────────────────────
const rep2 = compactUsageLog({ keepDays: 30, now: NOW, apply: true });
chk(
  rep2.lines_archive === 0 && fs.readFileSync(LOG, 'utf-8') === afterText,
  '⑤ 幂等：再跑一次没有可归档的行 ⇒ 账本不变',
  `archive=${rep2.lines_archive} applied=${rep2.applied}`,
);

console.log(`\n═══ T372 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
