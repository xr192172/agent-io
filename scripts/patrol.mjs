#!/usr/bin/env node
/**
 * patrol —— 巡检的**运行时入口**（A1 的接法）。
 *
 * ## 为什么需要它（A1 的真形态）
 * `patrolDrift` 建好了、内部也通（它自己调 `renderLiveFromDb`），但：
 *   ① **零 TS 调用方**（`cache.db` 入度 0）；
 *   ② **更根本**：它的 `PatrolOptions.ttl_ms` **从来没被定值**（源码注释："取值待裁"）⇒ 接口要求一个没人定义过的参数 ⇒ **谁也调不了**。
 *   ③ 而它的正确入口本就该是**运行时**（一个可被调的命令），不是藏在某个读写路径里
 *      ⇒ ★ 所以 `expected_callers`（TS 入度）对它是**不适用的** —— 这条债要用"有没有运行时入口"来判。
 *
 * ## 它只"报"，不"改"
 * 巡检不把卡改成 done/void（那是第二处权威）。产出 `DriftReport`，由人/榜单决定下一步。
 *
 * ## ttl 的取值（★ 明写"待裁"）
 * 本脚本给 `--ttl-hours` 默认 24h —— 但这**是业务决定，不是代码决定**。
 * `task_machine.releaseIfExpired` 的注释写着"取值待裁"⇒ 这里只是**给一个可跑的值**，
 * 让巡检先能跑起来；真要定，得由人拍。
 *
 * 用法：
 *   node scripts/patrol.mjs                       # 默认 feature=task-system-plan, ttl=24h
 *   node scripts/patrol.mjs --feature x --ttl-hours 12
 *   node scripts/patrol.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const feature = arg('feature', 'task-system-plan');
const asJson = argv.includes('--json');
const root = process.cwd();

// ★ Windows：动态 import 的绝对路径必须是 file:// URL，否则报 ERR_UNSUPPORTED_ESM_URL_SCHEME
const target = path.join(root, 'dist', 'src', 'application', 'patrol', 'task_drift.js');
const { patrolDrift } = await import(pathToFileURL(target).href);

// ★★★ 2026-10-22：**默认 TTL 从 `LEASE_TTL_MS` 派生，不再在这里写死 24h**
//   ★ 为什么必须改：本文件写 24h、而 `domain/task_machine.ts#LEASE_TTL_MS` 是 2h
//     ⇒ 同一个数住两处 ⇒ `patrol` 说"没有过期租约"时，`claim` 那边早就按 2h 接管了。
//     （这正是本仓头号病，今天刚在别处修过一次，这里又撞到。）
//   ★ 仍可用 `--ttl-hours` 临时覆盖（诊断用），但**默认值不许再有自己的口径**。
const { LEASE_TTL_MS } = await import(pathToFileURL(path.join(root, 'dist', 'src', 'domain', 'task_machine.js')).href);
const ttlHoursOverride = arg('ttl-hours', null);
const ttlHours = ttlHoursOverride !== null ? Number(ttlHoursOverride) : LEASE_TTL_MS / 3.6e6;

const report = await patrolDrift(feature, {
  root,
  now_ms: Date.now(),
  ttl_ms: ttlHours * 3600 * 1000,
});

// ════════════════════════════════════════════════════════════════════
// 台账体检（R31 · AGENTS 五「做完一项 ⇒ 从 docs/todo.md 删掉那一行」没有任何检测点）
// ════════════════════════════════════════════════════════════════════
// ★★ 为什么住在这里（0.25② 不许开三个入口）：R19（临时件无收口）与 R23-c 的候选吸收点
//   都是 `patrol`，三件事共用这一个运行时入口 ⇒ 一处加，不新开门。
// ★★★ 只「报」，不「改」：搬家是**语义判断**（机器只知道"长"，不知道"该去哪"）⇒
//   本函数不删行、不搬行、不写盘。人/榜单决定下一步。
// ★ 反向边界（0.16：不许变成永远亮的灯）：**不报「行数多」** —— 欠账本来就会多。
//   只报两条真异常：① 已了结却仍占位（该删没删）② 单行超长（规格该搬去 memory，行内只留指针）。
// ★ 读数纪律（0.12 第 3 条 / R61）：分子**必须**带分母 —— 每条报数都给"本次 N / 扫描 M 行"。
const LEDGER_REL = 'docs/todo.md';
const LEDGER_MAX_ROW = 1800;
/** 已了结的标记：出现即代表"这件事完了"，按 AGENTS 五 该删行 */
const LEDGER_CLOSED = /✅|已了结|已收口|已结案|已闭合/;

function ledgerCheck() {
  const abs = path.join(root, LEDGER_REL);
  if (!fs.existsSync(abs)) return { ok: false, reason: `${LEDGER_REL} 不存在` };
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.map((l, i) => ({ l, no: i + 1 })).filter((x) => x.l.trim());
  const closed = nonEmpty.filter((x) => LEDGER_CLOSED.test(x.l));
  const long = nonEmpty.filter((x) => x.l.length > LEDGER_MAX_ROW);
  const rowId = (s) => {
    const m = s.match(/\*\*(R\d+|T-#[A-Z0-9-]+|G\d+)\*\*/) || s.match(/^\|\s*([A-Za-z0-9#_-]+)\s*\|/);
    return m ? m[1] : '?';
  };
  return {
    ok: true,
    path: LEDGER_REL,
    kb: Math.round(Buffer.byteLength(text) / 1024),
    lines: lines.length,
    scanned: nonEmpty.length, // ★ 分母：非空行
    closed: closed.map((x) => ({ line: x.no, id: rowId(x.l), head: x.l.trim().slice(0, 70) })),
    long: long.map((x) => ({ line: x.no, id: rowId(x.l), chars: x.l.length })),
  };
}

const ledger = ledgerCheck();

if (asJson) {
  console.log(JSON.stringify({ drift: report, ledger }, null, 2));
} else {
  console.log('════ 漂移巡检 ════');
  console.log(`feature=${feature} · ttl=${ttlHours}h · 状态=${report.state ?? report.status ?? '?'}\n`);

  // ★ 判不了的情形要明说（不把"读不到"读成"没有漂移"）
  const unavailable = report.state === 'unavailable' || report.unavailable;
  if (unavailable) {
    console.log('★★ 判不了 —— 原因：');
    console.log('   ' + (report.reason ?? report.why ?? JSON.stringify(report).slice(0, 300)));
    console.log('\n★ 这不是"没有漂移"，是"读不到 ⇒ 判不了"（本仓铁律）。');
  }

  const keys = Object.keys(report).filter((k) => k !== 'feature' && k !== 'root' && !k.startsWith('_'));
  console.log('\n报告字段：' + keys.join(', '));

  for (const k of ['missed_close', 'should_void', 'lease_ttl', 'cards', 'reds']) {
    if (report[k] !== undefined) {
      const v = report[k];
      console.log(`  ${k}: ${Array.isArray(v) ? `${v.length} 条` : JSON.stringify(v)}`);
      if (Array.isArray(v)) for (const item of v.slice(0, 5)) console.log(`     · ${JSON.stringify(item).slice(0, 140)}`);
    }
  }

  // ── 台账体检（只报不改；每条带分母）──
  console.log('\n════ 台账体检（AGENTS 五「做完就删行」的检测点 · 只报不改）════');
  if (!ledger.ok) {
    console.log(`  ★ 判不了：${ledger.reason} —— 这不是"台账干净"，是"读不到"`);
  } else {
    console.log(`  ${ledger.path}：${ledger.kb} KB / ${ledger.lines} 行（非空 ${ledger.scanned} 行 = 本次扫描分母）`);
    console.log(`  ① 已了结却仍占位：${ledger.closed.length} / ${ledger.scanned} 行${ledger.closed.length ? '  ← 按 AGENTS 五 该删或搬进 memory' : '  ✓'}`);
    for (const x of ledger.closed.slice(0, 8)) console.log(`     · L${x.line} [${x.id}] ${x.head}`);
    console.log(`  ② 单行 > ${LEDGER_MAX_ROW} 字符：${ledger.long.length} / ${ledger.scanned} 行${ledger.long.length ? '  ← 规格该搬 memory，行内只留指针' : '  ✓'}`);
    for (const x of ledger.long.slice(0, 8)) console.log(`     · L${x.line} [${x.id}] ${x.chars} 字符`);
    console.log('  ★ 不报"行数多"：欠账本来就会多（0.16 反向边界）；也不自动搬 —— 搬家是语义判断。');
  }
}
