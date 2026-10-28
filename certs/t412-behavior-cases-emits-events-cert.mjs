#!/usr/bin/env node
/**
 * ★★★ cert T412 —— **L2/L3 真正缝上：跑一条 `behavior-cases` 判据，事件落到被观测项目**（T-#OBSERVE-6）（2026-10-28）
 *
 * ## 补的是哪一格
 * `t411` 是**直接调 loader**（手动设 env），没走判据链 ⇒ 没证"harness 注入真的生效"。
 * 本证跑**一条真的 `behavior-cases` 判据**，证明：
 * ```
 * judgeExpectations(root, [behavior-cases…])
 *    → runHarness(spec) → spawnSync(node, tmpfile)   ← 我们起的进程
 *    → probeRunEnv(spec.project_dir) 注入 loader + OBSERVE_EVENTS_FILE
 *    → 被测函数被内存插桩 → 事件写进 <project>/.agent/observe/events-*.jsonl
 * ```
 *
 * ## 判据（每条亲手跑）
 *   ① 判据本身**判出来了**（`behavior-cases` 给出 pass/fail，而不是 `unsupported`）；
 *   ② **事件落到了 `<project>/.agent/observe/`**（不是 cwd、不是临时目录）—— 这是缝合点；
 *   ③ 事件里**有该文件的探针**（`.enter`/`.exit`），且 args/ret 在；
 *   ④ **被测源码逐字节不变**（零污染，判据跑完也不能改人代码）；
 *   ⑤ 事后 `runtime` 判据能**零配置**读到这批事件（L2 跑完 L3 直接可用）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 `.mjs`（v1 范围）；`.ts` 需宿主 transpiler，另一步；
 *   · **[未核]** 一次跑多条 case 时事件是累积的（本证用例只有 1 条）；
 *   · **[未核]** harness 的临时文件被插桩后是否影响其 `parse(stdout)`（本证用 pass 判据间接覆盖）。
 *
 * ## 用法
 *   node certs/t412-behavior-cases-emits-events-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp412bc-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { judgeExpectations } = await import(D + 'application/design/intent/expectations.js');

// 夹具项目
const proj = path.join(TMP, 'proj');
fs.mkdirSync(proj, { recursive: true });
const file = path.join(proj, 'calc.mjs');
fs.writeFileSync(
  file,
  `export function add(a, b) {
  try {
    return a + b;
  } catch (e) {
    // 静默吞掉（给 L3 留一个可判的点）
  }
  return 0;
}
`,
);
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = hash();

// 一条真的 behavior-cases 判据（1 个 case：add(2,3) 期望 "5"）
const item = {
  node_id: 'file_calc',
  node_label: 'calc.add 行为契约',
  expectation: {
    kind: 'behavior-cases',
    path: 'calc.mjs',
    symbol: 'add',
    cases: [{ given: [2, 3], expect: '5' }],
    why: 't412：证明 L2 判据跑的同时 L3 事件落到被观测项目',
  },
};

const rep = await judgeExpectations(proj, [item]);
const v = rep.items[0];

// ── ① 判据判出来了 ────────────────────────────────────
chk(v?.verdict === 'pass' || v?.verdict === 'fail', '① `behavior-cases` 判据**真的判了**（不是 unsupported）', `${v?.verdict} —— ${String(v?.detail ?? '').slice(0, 140)}`);

// ── ② 事件落到被观测项目 ───────────────────────────────
const obsDir = path.join(proj, '.agent', 'observe');
const files = fs.existsSync(obsDir) ? fs.readdirSync(obsDir).filter((f) => /^events-.*\.jsonl$/.test(f)) : [];
chk(files.length > 0, '② 事件落到 **`<project>/.agent/observe/`**（缝合点）', `目录 ${obsDir}：${files.join(', ') || '(空)'}`);
const evs = files.flatMap((f) =>
  fs
    .readFileSync(path.join(obsDir, f), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean),
);

// ── ③ 用户代码被插桩（不是只观测到框架自己）────────────
{
  // ★ 关键区分：harness 跑的是**转译后的副本** target.mjs，runner.mjs 是框架自己的金丝雀。
  //   ⇒ 只有 probe 以 target. 开头的才是"用户代码被观测到"。
  const mine = evs.filter((e) => String(e.probe).startsWith('target.'));
  const enter = mine.find((e) => String(e.probe).endsWith('.enter'));
  const exit = mine.find((e) => String(e.probe).endsWith('.exit'));
  chk(mine.length > 0, '③ **用户代码被插桩**（probe 以 `target.` 开头）', mine.length ? mine.map((e) => `${e.probe}@${e.fields?.file}`).join(', ') : '只有 runner.* —— 说明 CJS require 绕过了 hooks');
  chk(!!enter && !!enter.fields?.args, '③-b 目标函数的 `.enter` 带 **args**（harness 传的实参）', JSON.stringify(enter?.fields?.args ?? null));
  chk(!!exit && 'ret' in (exit.fields ?? {}), '③-c 目标函数的 `.exit` 带 **ret**（函数返回值）', JSON.stringify(exit?.fields?.ret ?? null));
  chk(String(mine[0]?.fields?.file ?? '').endsWith('target.mjs'), '③-d `file` 指向**转译后的 target.mjs**（harness 跑副本的必然结果，源文件不被改）', String(mine[0]?.fields?.file ?? ''));
}

// ── ④ 零污染：判据跑完源码不变 ─────────────────────────
chk(hash() === before, '④ 判据跑完，被测源码**逐字节不变**（零污染）');

// ── ⑤ L2 之后 L3 直接可用（零配置）────────────────────
{
  const probeName = evs.find((e) => String(e.probe).startsWith('target.') && String(e.probe).endsWith('.enter'))?.probe;
  const r2 = await judgeExpectations(proj, [
    { node_id: 'l3', node_label: 'L3 零配置读', expectation: { kind: 'runtime', probe: probeName, expect: 'ok', why: 'x' } },
  ]);
  chk(r2.items[0]?.verdict !== 'unsupported', '⑤ L2 跑完后，`runtime` 判据**零配置**就能读到这批事件', `${r2.items[0]?.verdict} —— ${String(r2.items[0]?.detail ?? '').slice(0, 110)}`);
}

console.log(`\n═══ T412 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
