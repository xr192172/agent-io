#!/usr/bin/env node
/**
 * ★★★ cert T411 —— **内存插桩端到端 + L2/L3 一次运行同时产出**（T-#OBSERVE-6）（2026-10-28）
 *
 * ## 这条链要证的三件事
 * ```
 * 我们起的进程 ──loader(内存插桩)──> 源码零改动
 *      ├─→ 函数输出（L2 判据 behavior-cases 比对用）
 *      └─→ 探针事件（L3 判据 runtime 用）
 * ```
 *
 * ## 判据（每条亲手跑）
 *   ① **零污染**：跑完被测源码**逐字节不变**（loader 只在内存里改写）；
 *   ② **行为不变**：插桩后程序输出与不插桩时**完全一致**（观测不能改变宿主行为）；
 *   ③ **事件产生**：`.agent/observe/events-*.jsonl` 出现，且含 `.enter`（带 args）与 `.exit`（带 ret）；
 *   ④ **L3 判据能判**：用 `judgeExpectations` 的 `runtime` 判据读这批事件 —— 存在该 probe ⇒ 不再 `unsupported`；
 *   ⑤ **失败即放行**：源文件故意写成"插不了桩"的形态（纯类型 / 无函数体）⇒ 程序照跑、无事件、无异常。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 **`.js/.mjs`**（v1；`.ts` 要宿主 transpiler 配合）；
 *   · **[未核]** harness 注入的完整路径没有在这里走 `behavior-cases` 判据全链（本证直接调 loader，
 *     等价性由 harness 的 `probeRunEnv()` 单一实现保证；下一个证应跑一条真 `behavior-cases` 判据）；
 *   · **[未核]** CJS（`.cjs`）只做了 exclude 名单，没有专证。
 *
 * ## 用法
 *   node certs/t411-memory-instrument-e2e-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp411mem-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const loaderPath = path.join(ROOT, 'dist/src/infrastructure/analysis/observe/probe_loader.js');
const loader = pathToFileURL(loaderPath).href; // ★ Windows：--import 只认 file:// URL
const proj = path.join(TMP, 'proj');
fs.mkdirSync(path.join(proj, '.agent/observe'), { recursive: true });

const src = `export function risky(n) {
  try {
    return 10 / n;
  } catch (e) {
    // 静默吞掉
  }
  return 0;
}
console.log('OUT:', JSON.stringify(risky(2)));
`;
const file = path.join(proj, 'demo.mjs');
fs.writeFileSync(file, src);
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before = hash(file);

/** 跑一次子进程（可带/不带 loader），返回 { stdout, events } */
function run(withLoader) {
  const events = path.join(proj, `.agent/observe/events-${Date.now()}-${withLoader ? 'on' : 'off'}.jsonl`);
  fs.rmSync(events, { force: true });
  const env = {
    ...process.env,
    AGENT_IO_PROBE_ROOT: proj,
    AGENT_IO_PROBE_EXCLUDE: path.join(ROOT, 'dist'),
    ...(withLoader ? { OBSERVE_EVENTS_FILE: events } : {}),
  };
  const args = withLoader ? ['--import', loader, file] : [file];
  const stdout = execFileSync(process.execPath, args, { cwd: proj, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
  const evs = fs.existsSync(events)
    ? fs
        .readFileSync(events, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  return { stdout: stdout.trim(), evs, events };
}

const plain = run(false);
const probed = run(true);

// ── ① 零污染 ─────────────────────────────────────────
chk(hash(file) === before, '① 跑完被测源码**逐字节不变**（loader 只在内存里改写，盘上零改动）');

// ── ② 行为不变 ───────────────────────────────────────
chk(probed.stdout === plain.stdout && probed.stdout.includes('OUT:'), '② 插桩后程序输出与不插桩**完全一致**（观测不改变宿主行为）', `plain=${plain.stdout} / probed=${probed.stdout}`);

// ── ③ 事件产生 ───────────────────────────────────────
{
  const enter = probed.evs.find((e) => String(e.probe).endsWith('.enter'));
  const exit = probed.evs.find((e) => String(e.probe).endsWith('.exit'));
  chk(probed.evs.length >= 2, '③ 事件文件已产生', `事件 ${probed.evs.length} 条：${probed.evs.map((e) => e.probe).join(', ')}`);
  chk(!!enter && !!enter.fields?.args, '③-b `.enter` 事件带 **args**', JSON.stringify(enter?.fields?.args ?? null));
  chk(!!exit && 'ret' in (exit.fields ?? {}), '③-c `.exit` 事件带 **ret**', JSON.stringify(exit?.fields?.ret ?? null));
  chk(plain.evs.length === 0, '③-d **不带 loader 时没有事件**（不设 sink 即 no-op，天然安全）');
}

// ── ④ L3 判据能判（不再 unsupported）────────────────
{
  const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
  const { judgeExpectations } = await import(D + 'application/design/intent/expectations.js');
  const probeName = probed.evs.find((e) => String(e.probe).endsWith('.enter'))?.probe;
  const rep = await judgeExpectations(proj, [
    { node_id: 'a', node_label: 'L3 读这批事件', expectation: { kind: 'runtime', probe: probeName, expect: 'ok', why: 'x' } },
  ]);
  const v = rep.items[0];
  chk(v?.verdict !== 'unsupported', '④ `runtime` 判据能读到这批事件（不再"判不了"）', `${v?.verdict} —— ${String(v?.detail ?? '').slice(0, 120)}`);
}

// ── ⑤ 失败即放行（纯类型文件插不了桩，但必须照跑）──────
{
  const t = path.join(proj, 'plain.mjs');
  fs.writeFileSync(t, "export const only = 1;\nconsole.log('OK');\n");
  const ev = path.join(proj, '.agent/observe/events-plain.jsonl');
  const out = execFileSync(process.execPath, ['--import', loader, t], {
    cwd: proj,
    encoding: 'utf8',
    env: { ...process.env, AGENT_IO_PROBE_ROOT: proj, AGENT_IO_PROBE_EXCLUDE: path.join(ROOT, 'dist'), OBSERVE_EVENTS_FILE: ev },
  });
  chk(out.trim() === 'OK', '⑤ 无可插桩点 ⇒ 程序**照跑**（观测是增强，绝不让用户代码跑挂）', out.trim());
}

console.log(`\n═══ T411 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
