#!/usr/bin/env node
/**
 * telemetry-replay —— **开发遥测回放器**（第⑬项队列，lead 确认先 CLI 后 GUI）。
 *
 * ## 做什么
 * 读 `<root>/.agent-io/observe/events.jsonl` → 过滤 `probe^=telemetry.` → 按 time 排序 →
 * 渲染**时序文本**（`HH:mm:ss.SSS [stage] 解说词`）或 JSON。
 *
 * ## 用法
 *   node scripts/telemetry-replay.mjs <projectRoot> [--json] [--last N] [--stage claim,gate]
 *
 * ## 动画后置
 * DSH Web GUI 动画（用户提的"画面感"环节）读同一份事件流——`--json` 就是它的数据源。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
const asJson = args.includes('--json');
const lastIdx = args.indexOf('--last');
const last = lastIdx >= 0 ? Number(args[lastIdx + 1]) : Infinity;
const stageIdx = args.indexOf('--stage');
const stages = stageIdx >= 0 ? args[stageIdx + 1].split(',') : null;

const eventsPath = path.join(root, '.agent-io', 'observe', 'events.jsonl');
if (!fs.existsSync(eventsPath)) {
  console.error(`遥测事件流不存在：${eventsPath}`);
  console.error('（跑一次 edit_code / verify:changed / edit_dsl 后会自动产生 telemetry.* 事件）');
  process.exit(1);
}

const events = fs
  .readFileSync(eventsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  })
  .filter(Boolean)
  .filter((e) => typeof e.probe === 'string' && e.probe.startsWith('telemetry.'))
  .filter((e) => !stages || stages.includes(e.probe.replace(/^telemetry\./, '')))
  .sort((a, b) => String(a.time).localeCompare(String(b.time)))
  .slice(-last);

if (asJson) {
  console.log(JSON.stringify({ project: root, count: events.length, events }, null, 2));
  process.exit(0);
}

console.log(`── 开发遥测回放（${events.length} 帧 · ${root}）──\n`);
for (const e of events) {
  const stage = e.probe.replace(/^telemetry\./, '');
  const hhmmss = String(e.time).slice(11, 23);
  console.log(`${hhmmss} [${stage}] ${e.fields?.text ?? '（无解说词）'}`);
}
console.log(`\n── 共 ${events.length} 帧 ──`);
