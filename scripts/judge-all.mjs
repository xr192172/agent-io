#!/usr/bin/env node
/**
 * 跑**全部册**的节点级判据（`design_line action=judge`），汇总成一道门。
 *
 * ## 为什么需要这个脚本（而不是直接写进 verify.mjs）
 * 判据的**唯一执行核**是 CLI 的 `design_line action=judge`；这里只做「遍历册 + 汇总 + 退出码」，
 * 不重实现判定 —— 否则就是第二把尺。
 *
 * ## 为什么它该是门（当前 339 条判据**没有任何自动门在跑**）
 * 判据是设计册对代码的断言（"这个文件必须做到 X"）。在它进 `verify` 之前：
 * 判据红了**也拦不住提交**，等于 339 条断言只在有人手动跑 `design_line` 时才存在。
 * ★ 它比人**多抓**的东西很具体：改了实现使某条断言不再成立 —— `tsc` 一声不响（那是"值"不是"形状"）。
 *
 * ## 退出码
 * 任一册出现 `fail` 或 `unsupported` ⇒ 1（`unsupported` 也是失败：
 * "判不了 ≠ 通过"，见 AGENTS-RULES 0.12 与 GUIDE-GATE 四态）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CLI = path.join(ROOT, 'dist', 'src', 'presentation', 'cli', 'cli.js');
const DESIGN_DIR = path.join(ROOT, '.agent-io', 'design');

function features() {
  if (!fs.existsSync(DESIGN_DIR)) return [];
  return fs
    .readdirSync(DESIGN_DIR)
    .filter((f) => f.endsWith('.dsl.json'))
    .map((f) => f.slice(0, -'.dsl.json'.length))
    .sort();
}

function judgeOne(feature) {
  const payload = JSON.stringify({ project_dir: '.', feature, action: 'judge' });
  // ★ shell:false + process.execPath：路径含空格时经 cmd.exe 会被截断（见 verify.mjs 的 tsGate 注释）
  const r = spawnSync(process.execPath, [CLI, 'design_line', '--json', payload], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const count = (v) => (out.match(new RegExp(`"verdict":"${v}"`, 'g')) ?? []).length;
  const bad = [...out.matchAll(/"verdict":"(fail|unsupported)"[\s\S]{0,400}?"(?:id|node_id)":"([^"]+)"/g)].map(
    (m) => `${m[1]}:${m[2]}`,
  );
  return { feature, pass: count('pass'), fail: count('fail'), unsupported: count('unsupported'), bad, ok: r.status === 0 };
}

if (!fs.existsSync(CLI)) {
  console.error(`✗ 找不到 ${path.relative(ROOT, CLI)} ⇒ 先 npm run build（本门与「MCP 工具签名」同一前提）`);
  process.exit(1);
}

const list = features();
if (!list.length) {
  // ★ 0.12：读不到册不许当"全部通过"
  console.error(`✗ ${path.relative(ROOT, DESIGN_DIR)} 下没有任何 *.dsl.json ⇒ 无法判定（这不是通过）`);
  process.exit(1);
}

let bad = 0;
let totalPass = 0;
let totalJudged = 0;
for (const f of list) {
  const r = judgeOne(f);
  totalPass += r.pass;
  const judged = r.pass + r.fail + r.unsupported;
  totalJudged += judged;
  // ★★ 2026-10-31（第四轮独立复核抓到）：原来只有**跨册求和**的「判了 0 条」守卫 ⇒
  //   **单册判据被清空**时，只要别册还有料就照绿。每册必须自己判过东西。
  const emptyBook = judged === 0;
  const isBad = r.fail > 0 || r.unsupported > 0 || !r.ok || emptyBook;
  if (isBad) bad++;
  const mark = isBad ? '✗' : '✓';
  console.log(
    `  ${mark} ${f.padEnd(22)} pass=${String(r.pass).padEnd(4)} fail=${String(r.fail).padEnd(2)} unsupported=${r.unsupported}` +
      (emptyBook ? '  ← 该册一条判据都没判到（≠ 通过）' : ''),
  );
  for (const b of r.bad.slice(0, 5)) console.log(`       · ${b}`);
  if (r.bad.length > 5) console.log(`       · …另有 ${r.bad.length - 5} 条`);
}

// ★★★ 0.12 第 1 条：「判了 0 条」不许当「全部通过」。
//   实测过的两种死法（独立复核 2026-10-31 用临时副本复现）：
//   ① 册在盘上、但 CLI 的 dataHome 被 `AGENT_IO_HOME` 指到别处 ⇒ 看到 0 个 feature ⇒ 0 条判据 ⇒ 若只看
//      `fail>0` 就会 exit 0（**假绿**）；② 判据被人删空 ⇒ 同样 0 条 ⇒ exit 0。
//   `run-tests` 有这条断言（"0 个用例被执行"算红），本门原来没有 —— 现在补上。
if (totalJudged === 0) {
  console.error(
    `✗ 一条判据都没判到（盘上发现 ${list.length} 册：${list.join(', ')}）⇒ 这不是通过。\n` +
      `  常见原因：① \`AGENT_IO_HOME\` 指到了别的数据根 ⇒ CLI 看不到册；② 该册的判据被删空。\n` +
      `  排查：\`node dist/src/presentation/cli/cli.js get_dsl --json '{"query":"features"}'\` 看 CLI 自己认几册。`,
  );
  process.exit(1);
}

console.log(`  —— ${list.length} 册 / 判据 ${totalJudged} 条判过（${totalPass} pass）/ ${bad} 册有红`);
process.exit(bad ? 1 : 0);
