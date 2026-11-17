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
import { execFileSync } from 'node:child_process';
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
// ★★★ 2026-11-16（销账三层机制 · L1）：**账本陈旧的三个判据**（S1 册内声明被取代 / S2 终态卡证据 stale /
//   S3 做了事没销账）。★ 第三次动态 import —— 与上面两次**同一模式**
//   （Windows：动态 import 的绝对路径必须是 file:// URL，否则 ERR_UNSUPPORTED_ESM_URL_SCHEME）。
//   ★ 判据本体住 `src/application/patrol/ledger_staleness.ts`（纯读、可单测）：本脚本只负责
//     **取数 + 排版 + 把"判不了"说出来**，不在这里重写任何对账逻辑（0.9 一处权威）。
const { scanLedgerStaleness, closedOutsideQuotes, LEDGER_REL } = await import(
  pathToFileURL(path.join(root, 'dist', 'src', 'application', 'patrol', 'ledger_staleness.js')).href
);
const ttlHoursOverride = arg('ttl-hours', null);
const ttlHours = ttlHoursOverride !== null ? Number(ttlHoursOverride) : LEASE_TTL_MS / 3.6e6;

const report = await patrolDrift(feature, {
  root,
  now_ms: Date.now(),
  ttl_ms: ttlHours * 3600 * 1000,
});

// ════════════════════════════════════════════════════════════════════
// L1 · 账本陈旧三判据的三个输入（★ 三个都是"既有那一份"，本脚本一条都不重写）
// ════════════════════════════════════════════════════════════════════
// ① S3-无卡写：**调既有对账器** `scripts/write-log-audit.mjs --json`（同一份对账逻辑）。
//    ★ 为什么 spawn 而不是搬进来：那是 `classifyWriteSubject` / `isUnderSkippedDir` /
//      `countsAsNoCardWrite` 三把尺的串联，复制一份 = 第二处权威（0.9）。
//    ★ 失败语义：跑不了 ⇒ 记 why，判据侧写 `unavailable`（★ 不是"0 条"：读不到 ≠ 干净）。
const noCardWriteAudit = (() => {
  const script = path.join(root, 'scripts', 'write-log-audit.mjs');
  if (!fs.existsSync(script)) return { summary: null, why: 'scripts/write-log-audit.mjs 不存在 ⇒ 判不了' };
  try {
    const out = execFileSync(process.execPath, [script, '--project', root, '--limit', '20', '--json'], {
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { summary: JSON.parse(out), why: null };
  } catch (e) {
    const msg = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 160);
    return { summary: null, why: `对账器跑不了（${msg}）⇒ 判不了` };
  }
})();

// ② 利息维度：近期被改的路径 —— ★ **只用于分档**（落在这上面的 stale 才升真异常），不参与判定。
//    ★ 拿不到 git ⇒ 返回空数组（全部落信息档）：不许因为"读不到 git"就把每一条都升成真异常。
const recentlyChanged = (() => {
  try {
    const out = execFileSync('git', ['-C', root, 'log', '--since=7.days', '--name-only', '--pretty=format:'], {
      encoding: 'utf-8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\\/g, '/')))];
  } catch {
    return [];
  }
})();

// ③ 上次巡检距今（★ 没有历史就是**判不了**，不假装 0）。
//    ★ 默认**不写盘**（patrol 的纪律是"只报不改"）；`--stamp` 才记这一次的时刻。
const PATROL_STAMP = path.join(root, '.agent-io', 'scratch', 'patrol-last-run.json');
const lastPatrolAgeMs = (() => {
  try {
    return fs.existsSync(PATROL_STAMP) ? Date.now() - fs.statSync(PATROL_STAMP).mtimeMs : null;
  } catch {
    return null;
  }
})();

// ④ 台账全文（★★ 全脚本**只读一次**：S4 三方对账与「台账体检」共用同一份文本）
//    ★ 读不到 ⇒ `null`，两处都按"判不了"处理（0.12：读不到 ≠ 台账干净）。
const ledgerText = (() => {
  try {
    return fs.readFileSync(path.join(root, LEDGER_REL), 'utf8');
  } catch {
    return null;
  }
})();

const stale = scanLedgerStaleness({
  feature,
  root,
  nowMs: Date.now(),
  recentlyChanged,
  missedClose: report.missed_close ?? [], // ★ 巡检自己算过的（不重跑判定器）
  noCardWrites: noCardWriteAudit.summary,
  noCardWritesUnavailable: noCardWriteAudit.why,
  lastPatrolAgeMs,
  // ★ S4（T-#PATROL-S4）：台账**只读一次**，体检与三方对账共用这一份
  //   （两个读者各读一遍 = 同一份事实两个时刻，正是本仓反复治的病）。
  ledgerRel: LEDGER_REL,
  ledgerText,
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
// ★★ 2026-11-17（T-#PATROL-S4）：`LEDGER_REL` / 结案词 / `closedOutsideQuotes` 全部搬进判据层
//   `src/application/patrol/ledger_staleness.ts`（S4 判据要**同一把尺**）⇒ 本文件只剩"读数 + 排版"。
const LEDGER_MAX_ROW = 1800;
/**
 * ★★★ 未完成动词 —— 判定"**整行**已了结"必须同时**没有**这些词。
 *
 * ★ 为什么必须加这一条（2026-11-05 自查，本检测点建好三小时就被自己的数据推翻）：
 *   第一版只按 `LEDGER_CLOSED` 判 ⇒ 报出 **15 条"已了结却仍占位"**，而逐条看**全是假阳**：
 *   一行常挂多个子项（例：某行写"①②已落地 ✅ … ③ 仍归 X 卡"），出现一个 ✅ **不代表整行完**。
 *   ⇒ 真数是 **0**，而那 15 条会变成**一盏永远亮的灯**（0.16），把人训练成无视它。
 *   ★ 反向也守住：`规格全文见` 这类**指针行**是**开着**的工作（行本身就是那份规格的索引条目），
 *     删了它没人知道规格存在 ⇒ 它绝不能被算成"已了结"。
 */
const LEDGER_OPEN_WORK = /待做|未做|仍未|还需|还要|要改|要补|下一步|规格全文见|已派|待派|等待|未提交/;

function ledgerCheck() {
  if (ledgerText === null) return { ok: false, reason: `${LEDGER_REL} 不存在` };
  const lines = ledgerText.split(/\r?\n/);
  const nonEmpty = lines.map((l, i) => ({ l, no: i + 1 })).filter((x) => x.l.trim());
  // ★ 两档分开报（信息 vs 真异常）：只出现结案词 = 信息；结案词且无未完成动词 = 真该删
  const closedMarked = nonEmpty.filter((x) => closedOutsideQuotes(x.l));
  const closedWhole = closedMarked.filter((x) => !LEDGER_OPEN_WORK.test(x.l));
  const long = nonEmpty.filter((x) => x.l.length > LEDGER_MAX_ROW);
  const rowId = (s) => {
    const m = s.match(/\*\*(R\d+|T-#[A-Z0-9-]+|G\d+)\*\*/) || s.match(/^\|\s*([A-Za-z0-9#_-]+)\s*\|/);
    return m ? m[1] : '?';
  };
  return {
    ok: true,
    path: LEDGER_REL,
    kb: Math.round(Buffer.byteLength(ledgerText) / 1024),
    lines: lines.length,
    scanned: nonEmpty.length, // ★ 分母：非空行
    closedMarked: closedMarked.length, // 信息档：行里出现过结案词（不代表整行完）
    closed: closedWhole.map((x) => ({ line: x.no, id: rowId(x.l), head: x.l.trim().slice(0, 70) })),
    long: long.map((x) => ({ line: x.no, id: rowId(x.l), chars: x.l.length })),
  };
}

const ledger = ledgerCheck();

if (asJson) {
  // ★ 2026-11-16：`--json` 增 `stale` 段（★ 三判据各自带 `unavailable` —— 读端不许把 null 读成"干净"）
  console.log(JSON.stringify({ drift: report, ledger, stale }, null, 2));
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
    console.log(`  ① **整行已了结**却仍占位：${ledger.closed.length} / ${ledger.scanned} 行${ledger.closed.length ? '  ← 按 AGENTS 五 该删或搬进 memory' : '  ✓'}`);
    for (const x of ledger.closed.slice(0, 8)) console.log(`     · L${x.line} [${x.id}] ${x.head}`);
    console.log(`     信息档：行里出现过结案词的 ${ledger.closedMarked} 行（★ 一行可挂多个子项，出现 ✅ 不代表整行完 ⇒ 只报不判）`);
    console.log(`  ② 单行 > ${LEDGER_MAX_ROW} 字符：${ledger.long.length} / ${ledger.scanned} 行${ledger.long.length ? '  ← 规格该搬 memory，行内只留指针' : '  ✓'}`);
    for (const x of ledger.long.slice(0, 8)) console.log(`     · L${x.line} [${x.id}] ${x.chars} 字符`);
    console.log('  ★ 不报"行数多"：欠账本来就会多（0.16 反向边界）；也不自动搬 —— 搬家是语义判断。');
  }

  // ──────────────────────────────────────────────────────────────────
  // L1 · 账本陈旧（三判据 · 只报不改）
  //
  // ★ 三条输出纪律：
  //   ① **每条带分母**（0.12③：只看分子等于没验）；
  //   ② **带 age 列**（claim 挂了多久 / 上次巡检距今）—— 判不了就印"判不了"，不印 0；
  //   ③ **不报数量多**（0.16）：S1 只报"已被取代"，S3 只点名欠账；S2 超过 8 条就折叠（读数在 --json 里）。
  // ★ 两档制（利息维度）：落在**近期被改路径**上的 stale 升真异常，其余是信息档。
  // ★ 永不自动改：`task_plan` 没有写入口，卡的状态只许 `edit_dsl {type:'task'}` 改。
  // ──────────────────────────────────────────────────────────────────
  const dur = (ms) =>
    ms === null || ms === undefined
      ? '判不了'
      : ms >= 86_400_000
        ? `${(ms / 86_400_000).toFixed(1)}d`
        : `${(ms / 3_600_000).toFixed(1)}h`;
  console.log('\n════ 账本陈旧（S1 册内声明 / S2 终态卡证据 / S3 没销账 / S4 台账三方对账 · 只报不改）════');
  console.log(
    `  age 口径：声明 age = 册最后一次提交（${stale.age_basis}）· 上次巡检 = ${dur(stale.last_patrol_age_ms)}` +
      `（★ git 没有逐字写入时刻 ⇒ 声明 age 是**上界**，真实写入只会更早；巡检时刻只在 \`--stamp\` 时记）`,
  );
  if (stale.unavailable) {
    console.log(`  ★ 判不了：${stale.unavailable} —— 这不是"账本干净"（0.12：读不到 ≠ 没有）`);
  }

  // S1 —— 册里的"零调用 / 未接线"声明是不是已被取代
  const s1 = stale.s1;
  if (s1.unavailable) {
    console.log(`  S1 册内声明：★ 判不了 —— ${s1.unavailable}`);
  } else {
    console.log(
      `  S1 册内声明（"零调用 / 未接线"）：**已被取代 ${s1.superseded.length} / ${s1.claims} 条**` +
        `（另：仍成立 ${s1.still_true} · 判不了 ${s1.unverifiable.length} · 共扫 ${s1.scanned_files} 次消费面文件）`,
    );
    for (const r of s1.superseded) {
      console.log(`     · [${r.tier === 'anomaly' ? '★ 真异常' : '信息档'}] ${r.where} · age=${dur(r.age_ms)}`);
      console.log(`       「${r.claim}」`);
      console.log(`       ⇒ ${r.why}`);
    }
    for (const r of s1.unverifiable.slice(0, 3)) console.log(`     ○ ${r.where}：${r.why}`);
    if (s1.superseded.length) {
      console.log('     ★ **不要求改册**：`task_plan` 没有写入口（改了也是绕过唯一写端）—— 这一行只承载 supersede + 证据。');
    }
  }

  // S2 —— 终态卡（done / void）的证据还作数吗
  const s2 = stale.s2;
  if (s2.unavailable) {
    console.log(`  S2 终态卡证据：★ 判不了 —— ${s2.unavailable}`);
  } else {
    console.log(
      `  S2 终态卡证据：stale **${s2.stale.length}** / 有证据 ${s2.with_evidence} 张（终态卡 ${s2.closed_cards} 张 · 仍有效 ${s2.valid}）` +
        `｜★ 判不了 ${s2.unverifiable.length} 张（覆盖集未知 / 当年没记指纹 —— **不折成绿**）`,
    );
    for (const r of s2.stale.slice(0, 8)) {
      console.log(`     · ${r.card_id}(${r.state}) · 证据 ${r.at} ⇒ ${r.why}`);
    }
    if (s2.stale.length > 8) console.log(`     …… 另有 ${s2.stale.length - 8} 张（逐条见 --json 的 stale.s2.stale）`);
    for (const r of s2.unverifiable.slice(0, 3)) {
      console.log(`     ○ ${r.card_id}(${r.state}) · 证据 ${r.at} ⇒ ${r.why}`);
    }
  }

  // S3 —— 做了事没销账
  const s3 = stale.s3;
  const branches = Object.entries(s3.by_branch ?? {});
  console.log(
    `  S3 做了事没销账：漏收口 **${s3.missed_close.length}** 张卡` +
      ` · 无卡写 **${s3.no_card_total === null ? '判不了' : s3.no_card_total}** 条` +
      (branches.length ? `（按支：${branches.map(([k, v]) => `${k} ${v}`).join(' · ')}）` : ''),
  );
  for (const r of s3.missed_close.slice(0, 8)) console.log(`     · [漏收口] ${r.id} ⇒ 只有 edit_dsl {type:'task',op:'complete'} 能销账`);
  for (const r of s3.no_card_write.slice(0, 8)) console.log(`     · [无卡写] ${r.id} · age=${dur(r.age_ms)} · ${r.detail}`);
  if (s3.unavailable) console.log(`     ★ 判不了：${s3.unavailable}`);

  // S4 —— 台账行 ↔ 册卡 ↔ 代码事实（三方抽对）
  // ★ 与上面三条**同一个段**（不新开门）：它读的是台账（声明面）+ 册（卡）+ 代码（接线事实）。
  // ★ 两档折叠：过期/结案各报到 8 条，悬空引用**按 id 去重**后再折（一行里同一 id 出现两次不是两件事）。
  const s4 = stale.s4;
  if (s4.unavailable) {
    console.log(`  S4 台账三方对账：★ 判不了 —— ${s4.unavailable}`);
  } else {
    const dangleIds = [...new Set(s4.dangling.map((r) => r.refs[0]))];
    console.log(
      `  S4 台账三方对账（行 ↔ 册卡 ↔ 代码）：**声明过期 ${s4.superseded.length} / ${s4.checked} 条已对声明**` +
        `（占台账 ${s4.rows} 带 id 行 · 扫 ${s4.scanned} 行）｜结案核不了 ${s4.closed_unverifiable.length}` +
        `｜悬空引用 ${dangleIds.length} 个 id（${s4.dangling.length} 处）` +
        `｜★ 判不了 ${s4.unjudgeable} 行（功能级措辞 / 没点名符号）`,
    );
    for (const r of s4.superseded.slice(0, 8)) {
      console.log(`     · [过期] L${r.line} [${r.id}] ${r.refs.join(' · ')} · 册=${r.trio.sheet} · 码=${r.trio.code}`);
      console.log(`       ⇒ ${r.why}`);
    }
    if (s4.superseded.length > 8) console.log(`     …… 另有 ${s4.superseded.length - 8} 条（逐条见 --json 的 stale.s4.superseded）`);
    for (const r of s4.closed_unverifiable.slice(0, 8)) {
      console.log(`     · [结案核不了] L${r.line} [${r.id}] ⇒ ${r.why}`);
    }
    const shownIds = dangleIds.slice(0, 8);
    for (const id of shownIds) {
      const first = s4.dangling.find((r) => r.refs[0] === id);
      console.log(`     · [悬空] L${first.line} 点名 ${id} ⇒ 台账里没有这一行（册=${first.trio.sheet}）`);
    }
    if (dangleIds.length > shownIds.length) {
      console.log(`     …… 另有 ${dangleIds.length - shownIds.length} 个 id（逐条见 --json 的 stale.s4.dangling）`);
    }
    console.log(
      '  ★ S4 **只报不改**：台账是文档、册是唯一写端（`edit_dsl`）—— 本段既不删行也不改册；' +
        '过期/悬空逐条看，可能有假阳（结案词在引文里、同名符号不同作用域）。',
    );
  }
  console.log('  ★ 四条判据**永不自动改**：册与卡的状态都由人 / edit_dsl 决定，这里只报。');
}

// ── `--stamp`：记这一次的巡检时刻（★ 默认不写盘：patrol 的纪律是"只报不改"）──
if (argv.includes('--stamp')) {
  try {
    fs.mkdirSync(path.dirname(PATROL_STAMP), { recursive: true });
    fs.writeFileSync(PATROL_STAMP, JSON.stringify({ at: new Date().toISOString(), feature }, null, 2));
    if (!asJson) console.log(`\n★ 已记本次巡检时刻（--stamp）：${path.relative(root, PATROL_STAMP).replace(/\\/g, '/')}`);
  } catch (e) {
    if (!asJson) console.log(`\n★ --stamp 写不了（${(e && e.message) || e}）—— 下次仍会报"上次巡检：判不了"`);
  }
}
