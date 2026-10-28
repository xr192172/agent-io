#!/usr/bin/env node
/**
 * ★★★ cert T415 —— **测试数据的归属与保留**（T-#OBSERVE-7）（2026-10-28）
 *
 * ## 用户之问：「这个测试数据要不要也随项目走」
 * 答案是**按"谁的事实"分**，而且本仓早就这么做了 —— 本证把它钉成可回归的读数。
 *
 * | 数据 | 归谁 | 位置 | 进 git？ |
 * |---|---|---|---|
 * | 运行时事件（真跑出来的） | **项目** | `<project>/.agent/observe/events-*.jsonl` | ❌ 派生物（`.gitignore` 已排除 `.agent/`） |
 * | 判据（对项目的断言） | **项目册** | `.agent-io/design/<f>.dsl.json` | ✅ 意图 |
 * | 插桩备份（改盘插桩中间态） | 项目 | `<project>/.agent-io/observe-backup/` | ❌（`.agent-io/*` 已排除） |
 * | 框架自证（`certs/` / `certs/baselines/`） | **框架** | 框架仓 | ✅（**不随被观测项目走**） |
 *
 * ## 判据（每条亲手跑）
 *   ① 事件文件**确实被 git 忽略**（`git check-ignore` 在真仓上跑）；
 *   ② **保留策略**：造 `KEEP+5` 份旧事件 ⇒ 跑一次 `probeRunEnv` ⇒ 只剩 `KEEP` 份（新的在、旧的被删）；
 *   ③ 保留策略**只碰 `events-*.jsonl`**：同目录的 `dsl.json` / 别的文件**一个都不删**；
 *   ④ 事件落在**被观测项目**（不是 cwd、不是框架仓）—— 这是"随项目走"的最硬证据；
 *   ⑤ 清理是 **best-effort**：目录不可写也不抛（不影响 spawn）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只证"文件层面"；**事件内容随项目演进**（跨版本可比性）没有机制，属未解问题（记 todo）；
 *   · **[未核]** `AGENT_IO_EVENTS_KEEP` 的极端值（0 / 负数 / 非数字）只做了"兜底到 20"的代码路径，未逐值证。
 *
 * ## 用法
 *   node certs/t415-observe-data-ownership-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp415own-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { probeRunEnv, pruneEvents } = await import(D + 'infrastructure/analysis/observe/run_env.js');

// ── ① 事件被 git 忽略（在真仓上问 git）─────────────────
{
  let out = '';
  let ignored = false;
  try {
    out = execFileSync('git', ['check-ignore', '-v', '.agent/observe/events-1.jsonl'], { cwd: ROOT, encoding: 'utf8' });
    ignored = true;
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  chk(ignored, '① 运行时事件**被 git 忽略**（`git check-ignore` 命中）', out.trim().slice(0, 120));
}

// ── ② 保留策略：只留最近 KEEP 份 ────────────────────────
{
  const proj = path.join(TMP, 'proj');
  const dir = path.join(proj, '.agent', 'observe');
  fs.mkdirSync(dir, { recursive: true });
  const KEEP = 5;
  // 造 KEEP+5 份旧事件（mtime 递增，保证"最近"可判）
  const made = [];
  for (let i = 0; i < KEEP + 5; i++) {
    const p = path.join(dir, `events-${fromNow(i)}.jsonl`);
    fs.writeFileSync(p, '{}\n');
    const t = new Date(Date.now() - (KEEP + 5 - i) * 60_000);
    fs.utimesSync(p, t, t);
    made.push(p);
  }
  pruneEvents(dir, String(KEEP));
  const left = fs.readdirSync(dir).filter((f) => /^events-.*\.jsonl$/.test(f));
  const newestKept = made.slice(-KEEP).every((p) => fs.existsSync(p));
  const oldestGone = made.slice(0, 5).every((p) => !fs.existsSync(p));
  chk(left.length === KEEP, `② 保留策略只留最近 ${KEEP} 份`, `实际剩 ${left.length} 份`);
  chk(newestKept && oldestGone, '②-b **新的留、旧的删**（按 mtime，不是按名字）');
}

// ── ③ 只碰 events-*.jsonl ──────────────────────────────
{
  const proj = path.join(TMP, 'proj2');
  const dir = path.join(proj, '.agent', 'observe');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dsl.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me\n');
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(dir, `events-${fromNow(i)}.jsonl`), '{}\n');
  pruneEvents(dir, '2');
  const survivors = fs.readdirSync(dir).sort();
  chk(
    survivors.includes('dsl.json') && survivors.includes('notes.txt'),
    '③ 保留策略**只碰 `events-*.jsonl`**（`dsl.json` / 其它文件一个都不删）',
    survivors.join(', '),
  );
  chk(survivors.filter((f) => /^events-/.test(f)).length === 2, '③-b 事件被清到 2 份');
}

// ── ④ 事件落在被观测项目 ───────────────────────────────
{
  const proj = path.join(TMP, 'proj3');
  fs.mkdirSync(proj, { recursive: true });
  const env = probeRunEnv(proj);
  const events = String(env?.OBSERVE_EVENTS_FILE ?? '');
  chk(events.startsWith(path.join(proj, '.agent', 'observe')), '④ 事件落在**被观测项目**（随项目走的最硬证据）', events);
  chk(fs.existsSync(path.dirname(events)), '④-b 目录已被创建（不用调用方先建）');
}

// ── ⑤ best-effort：不可写也不抛 ────────────────────────
{
  let threw = false;
  try {
    pruneEvents(path.join(TMP, 'no-such-dir-415'), '3');
  } catch {
    threw = true;
  }
  chk(!threw, '⑤ 清理是 **best-effort**：目录不存在也不抛（绝不影响 spawn）');
}

/** 造一个"看起来像时间戳"的文件名片段 */
function fromNow(i) {
  const t = new Date(Date.now() - i * 60_000).toISOString().replace(/[:.]/g, '-');
  return t;
}

console.log(`\n═══ T415 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
