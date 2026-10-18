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
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const feature = arg('feature', 'task-system-plan');
const ttlHours = Number(arg('ttl-hours', '24'));
const asJson = argv.includes('--json');
const root = process.cwd();

// ★ Windows：动态 import 的绝对路径必须是 file:// URL，否则报 ERR_UNSUPPORTED_ESM_URL_SCHEME
const target = path.join(root, 'dist', 'src', 'application', 'patrol', 'task_drift.js');
const { patrolDrift } = await import(pathToFileURL(target).href);

const report = await patrolDrift(feature, {
  root,
  now_ms: Date.now(),
  ttl_ms: ttlHours * 3600 * 1000,
});

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
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
}
