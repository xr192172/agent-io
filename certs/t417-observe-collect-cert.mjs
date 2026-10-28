#!/usr/bin/env node
/**
 * ★★★ cert T417 —— **L3 的观测入口**（T-#OBSERVE-8）（2026-10-28）
 *
 * ## 补的是哪一格
 * `runtime` 判据判事件流，而事件是**派生物**（`.agent/observe/` 不入 git）⇒
 * 新 clone / CI 上必然是 `unsupported`。`unsupported` 不是通过（这点要保住），
 * 但也**不能是死局** —— 这个入口就是"先采一轮"的那一步。
 *
 * ## 判据（每条亲手跑）
 *   ① `scripts/observe-collect.mjs` 起子进程时**真的注入了 loader** 并产生事件；
 *   ② 事件落到**被观测项目**的 `.agent/observe/`（不是框架仓、不是 cwd）；
 *   ③ **退出码原样透传**（子进程非 0 ⇒ 入口非 0）—— 它是"跑测试"的入口，不能把失败吞成成功；
 *   ④ 拿不到 loader / 已关观测 ⇒ **退化成直接运行**（仍然跑那条命令，只是没有事件）；
 *   ⑤ 采到的事件**能被 `runtime` 判据用**（`expect=ok` 从 `unsupported` 变 `pass`）——
 *      这条最要紧：证明"入口 → 事件 → 判据"三段是通的；
 *   ⑥ `runtime` 的 `unsupported` 详情里**带可操作提示**（`observe:collect`），不是干巴巴一句"判不了"。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 Node 进程（`.js/.mjs`）；Go/Python 需各自机制（未做）；
 *   · **[未核]** 采到的"够不够判"取决于跑的命令触没触到目标函数 —— 入口不保证 `runtime` 变绿；
 *   · **[未核]** 没接进 `verify`（故意：`verify` 不该默默跑别人的测试并产生派生物）。
 *
 * ## 用法
 *   node certs/t417-observe-collect-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp417collect-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// 夹具项目：一个可插桩的 .mjs（有 try/catch 也有普通函数）
const proj = path.join(TMP, 'proj');
fs.mkdirSync(proj, { recursive: true });
fs.writeFileSync(
  path.join(proj, 'work.mjs'),
  `export function add(a, b) { return a + b; }
console.log('WORK-OK', add(1, 2));
`,
);
fs.writeFileSync(
  path.join(proj, 'fail.mjs'),
  `process.exit(3);
`,
);

const collect = path.join(ROOT, 'scripts/observe-collect.mjs');
const run = (args, env = {}) => {
  const r = [];
  try {
    const out = execFileSync(process.execPath, [collect, ...args], {
      cwd: proj,
      encoding: 'utf8',
      env: { ...process.env, AGENT_IO_PROBE_ROOT: proj, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    r.push(0, out);
  } catch (e) {
    r.push(e.status ?? 1, `${e.stdout ?? ''}${e.stderr ?? ''}`);
  }
  return { code: r[0], out: r[1] };
};

// ── ① 入口真的注入并产生事件 ───────────────────────────
const ok = run(['node', 'work.mjs']);
chk(ok.code === 0, '① 入口能正常跑子进程', `exit=${ok.code}`);
chk(/WORK-OK/.test(ok.out), '①-b 子进程输出原样透传');
const obsDir = path.join(proj, '.agent', 'observe');
const files = fs.existsSync(obsDir) ? fs.readdirSync(obsDir).filter((f) => /^events-.*\.jsonl$/.test(f)) : [];
chk(files.length > 0, '①-c 产生事件文件（说明 loader 真被注入）', files.join(', ') || '(无)');

// ── ② 落在被观测项目 ───────────────────────────────────
chk(obsDir === path.join(proj, '.agent', 'observe') && files.length > 0, '② 事件落在**被观测项目**的 `.agent/observe/`', obsDir);

// ── ③ 退出码透传 ───────────────────────────────────────
const bad = run(['node', 'fail.mjs']);
chk(bad.code === 3, '③ 子进程退出码**原样透传**（3 ⇒ 入口 3）', `exit=${bad.code}`);

// ── ④ 关掉观测 ⇒ 退化成直接运行 ────────────────────────
const off = run(['node', 'work.mjs'], { AGENT_IO_PROBE_OFF: '1' });
chk(off.code === 0 && /WORK-OK/.test(off.out), '④ `AGENT_IO_PROBE_OFF=1` ⇒ **仍然跑那条命令**（只是没事件）', `exit=${off.code}`);

// ── ⑤ 采到的事件能被 runtime 判据用 ────────────────────
{
  const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
  const { judgeExpectations } = await import(D + 'application/design/intent/expectations.js');
  const evs = files.flatMap((f) =>
    fs.readFileSync(path.join(obsDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  );
  const probe = evs.find((e) => String(e.probe).includes('add'))?.probe ?? evs.find((e) => String(e.probe).endsWith('.enter'))?.probe;
  const rep = await judgeExpectations(proj, [
    { node_id: 'r', node_label: '采到的事件', expectation: { kind: 'runtime', probe, expect: 'ok', why: 'x' } },
  ]);
  chk(rep.items[0]?.verdict === 'pass', '⑤ 采到的事件被 `runtime` 判据**当场判出 pass**（入口→事件→判据三段通）', `${rep.items[0]?.verdict} —— ${String(rep.items[0]?.detail ?? '').slice(0, 100)}`);
}

// ── ⑥ unsupported 详情带可操作提示 ─────────────────────
{
  const empty = path.join(TMP, 'empty');
  fs.mkdirSync(path.join(empty, '.agent/observe'), { recursive: true });
  fs.writeFileSync(path.join(empty, '.agent/observe/events-empty.jsonl'), '');
  const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
  const { judgeExpectations } = await import(D + 'application/design/intent/expectations.js');
  const rep = await judgeExpectations(empty, [
    { node_id: 'e', node_label: '空事件', expectation: { kind: 'runtime', probe: 'x.enter', expect: 'ok', why: 'x' } },
  ]);
  const d = String(rep.items[0]?.detail ?? '');
  chk(rep.items[0]?.verdict === 'unsupported', '⑥ 空事件 ⇒ **unsupported**（判不了 ≠ 通过）', d.slice(0, 90));
  chk(/observe:collect/.test(d), '⑥-b 详情里带**可操作提示**（`observe:collect`），不是干巴巴一句判不了', d.slice(-90));
}

console.log(`\n═══ T417 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
