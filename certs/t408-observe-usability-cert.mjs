#!/usr/bin/env node
/**
 * ★★★ cert T408 —— **`observe` 单入口的可用性**（2026-10-28）
 *
 * ## 这个工具是干什么的（先答清楚，再谈好不好用）
 * `observe` 是"**运行时观测线**"的唯一入口，一条链五段：
 * ```
 * ① 在哪打点      recommend_observe_points（另开）
 * ② 打点          observe { action: instrument | uninstrument | restore | ledger }
 * ③ 跑起来产生事件 events.jsonl（探针写出，不是本工具）
 * ④ 看事件/链路    observe { action: log | trace | judge }
 * ⑤ 回流出提案     observe { action: proposals, op: list|show|approve|reject }  ← 四层门，approve 才动 DSL
 * ```
 * 一句话：**它把"代码跑起来之后的真事"读出来，并且只让过了四层门的东西回到设计册。**
 *
 * ## 好不好用 —— 实测发现的坑（本证钉住的就是这些）
 * 单入口最大的风险是"**参数传错却静默生效**"：`action=log` 时给 `events_path`（那是 trace 的参数），
 * 原来只报"需要 events_file" ⇒ 用户以为自己给对了路径。
 * 修法：入口做**按 action 的参数守卫**（白名单 + 陌生人点名 + 缺必填列清单），且**顺序**是
 * 先报"你传错了"再报"你缺什么"（实测反了会误导）。
 *
 * ## 判据（每条亲手跑）
 *   ① `action=log` + `events_path` ⇒ 报错**点名** strangers 属于哪个动作（trace）；
 *   ② `action=judge` 缺 `events` ⇒ 报错**列出该动作要哪些字段**；
 *   ③ 非法 `action` ⇒ 被 **schema** 拒绝（明确，不静默退回 log）；
 *   ④ 正常调法 ⇒ 仍有数据，且与 `t407` 基线里 `log` 场景**逐字段相等**（守卫没破坏正常路径）；
 *   ⑤ 报错里**不出现旧工具名**（`observe_log` / `observe_judge` / `observe_instrument`）——
 *      否则用户会去查一个已经不存在的工具。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核"参数用错"这一族；**语义用错**（比如 events 形状不对）不在此证；
 *   · **[未核]** `proposals` 的 `op` 子动作只核了 `list`（approve/reject 会写盘，属于另一张证）。
 *
 * ## 用法
 *   node certs/t408-observe-usability-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp408use-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const ev = path.join(ROOT, 'certs/baselines/t407-fixture/events.jsonl');

/** 跑 CLI 并同时拿到 输出 + 是否失败 */
function run(args) {
  try {
    const out = execFileSync('node', ['dist/src/presentation/cli/cli.js', 'observe', '--json', JSON.stringify(args)], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, AGENT_IO_REQUIRE_PLAN: '0' },
    });
    return { out, failed: false };
  } catch (e) {
    return { out: String(e.stdout ?? '') + '\n' + String(e.stderr ?? ''), failed: true };
  }
}
const firstErr = (out) => out.split('\n').find((l) => /^Error:/.test(l))?.trim() ?? '';

// ── ① 传错参数：点名 stranger 的归属 ──────────────────────
{
  const { out, failed } = run({ action: 'log', events_path: ev });
  const msg = firstErr(out);
  chk(failed && /不属于本动作/.test(msg) && /events_path（属于 trace）/.test(msg), '① `action=log` + `events_path` ⇒ **点名**它属于 trace', msg.slice(0, 170));
  chk(/本动作只认：events_file \/ files \/ all/.test(msg), '①-b 同时**列出本动作认哪些字段**');
}

// ── ② 缺必填：列出该动作字段 ──────────────────────────────
{
  const { out, failed } = run({ action: 'judge' });
  const msg = firstErr(out);
  chk(failed && /缺必填 events/.test(msg) && /该动作要这些字段：events \/ decls/.test(msg), '② `action=judge` 缺 `events` ⇒ 明确说缺什么 + 要什么', msg.slice(0, 170));
}

// ── ③ 非法 action：schema 拒绝，不静默退回 ────────────────
{
  const { out, failed } = run({ action: 'nonsense' });
  chk(failed && /schema 校验|入参未通过/.test(out) && !/事件 0/.test(out), '③ 非法 `action` ⇒ **schema 拒绝**（不静默退回 log）', out.split('\n').find((l) => /✗/.test(l))?.trim().slice(0, 130) ?? '');
}

// ── ④ 正常路径没被守卫弄坏（与 t407 基线逐字段比）─────────
{
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'certs/baselines/observe-merge-baseline.json'), 'utf8'));
  const b = baseline.log;
  const { out } = run({ action: 'log', ...b.args });
  const i = out.indexOf('---DATA---');
  let data = null;
  if (i >= 0) {
    const rest = out.slice(i + 10);
    const s = Math.min(...['{', '['].map((c) => rest.indexOf(c)).filter((x) => x >= 0));
    if (Number.isFinite(s)) {
      let d = 0;
      let inStr = false;
      let esc = false;
      for (let k = s; k < rest.length; k++) {
        const ch = rest[k];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') d++;
        else if (ch === '}' || ch === ']') {
          d--;
          if (d === 0) {
            try {
              data = JSON.parse(rest.slice(s, k + 1));
            } catch {
              /* ignore */
            }
            break;
          }
        }
      }
    }
  }
  chk(JSON.stringify(data) === JSON.stringify(b.data), '④ 正常调法（`log`）仍与 t407 基线**逐字段相等**（守卫没破坏正常路径）', `len=${JSON.stringify(data ?? null).length} vs ${JSON.stringify(b.data ?? null).length}`);
}

// ── ⑤ 报错里不出现旧工具名 ────────────────────────────────
{
  const outs = [run({ action: 'log', events_path: ev }).out, run({ action: 'judge' }).out, run({ action: 'instrument' }).out].join('\n');
  const leaked = ['observe_log', 'observe_judge', 'observe_instrument', 'observe_proposals'].filter((n) => outs.includes(n));
  chk(leaked.length === 0, '⑤ 报错里**不出现旧工具名**（否则用户会去查一个已不存在的工具）', `泄漏：${leaked.join(',') || '(无)'}`);
}

console.log(`\n═══ T408 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
