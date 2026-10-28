#!/usr/bin/env node
/**
 * ★★★ cert T414 —— **T-#KIND-2 的三处结构归位**（2026-10-28）
 *
 * ## 这三处都不是 bug，是**位置 / 命名 / 推导方式**不对
 * 1. `probeRunEnv()` 住在 `authoring/behavior/index.ts`，但它是**跨切面**能力
 *    （任何"我们起的进程"都该用）⇒ 搬到 `observe/run_env.ts`；
 * 2. `transpileToCjs(abs, src, {esm})` —— **名字与新行为矛盾**（能产 ESM）⇒ 改 `transpileForHarness({module})`；
 * 3. `probe_hooks` 里 `resolve(…,'..','..','..')` 手算自根 ⇒ 命名常量 + `AGENT_IO_PROBE_SELF_ROOT` 可覆盖。
 *
 * ## 判据（每条亲手跑）
 *   ① `probeRunEnv` **只在** `observe/run_env.js` 导出（harness 不再自带一份）；
 *   ② `transpileForHarness` 已导出、`transpileToCjs` **不再是导出**（无遗留双名）；
 *   ③ `run_env` 提供的 env 契约：`NODE_OPTIONS` 是 **file:// URL**（Windows 硬要求）、
 *      `OBSERVE_EVENTS_FILE` 落在**被观测项目**的 `.agent/observe/`、`AGENT_IO_PROBE_EXCLUDE` 含**探针层目录**（只排自己，不排整个 dist）；
 *   ④ 总开关：`AGENT_IO_PROBE_OFF=1` ⇒ 返回 `undefined`（增强能力可关）；
 *   ⑤ 自根覆盖：删掉 loader 时返回 `undefined`（拿不到就不注入 —— 不制造半开状态）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 不证"事件真的产生"——那是 `t411`（loader 层）与 `t412`（判据链层）的事，本证只证**归位与契约**；
 *   · **[未核]** `run_tests` 尚未接入 `probeRunEnv`（接入会改变"跑测试"的行为，需单独一张证）；
 *   · **[未核]** `AGENT_IO_PROBE_SELF_ROOT` 的**行为**只做了"能否设置"级别，没有构造"自根指错会怎样"。
 *
 * ## 用法
 *   node certs/t414-run-env-home-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp414home-'));
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
const runEnv = await import(D + 'infrastructure/analysis/observe/run_env.js');
const harness = await import(D + 'infrastructure/authoring/behavior/index.js');

// ── ① probeRunEnv 的家 ─────────────────────────────────
chk(typeof runEnv.probeRunEnv === 'function', '① `probeRunEnv` 由 `observe/run_env.js` 导出（跨切面能力归位）');
chk(!('probeRunEnv' in harness), '①-b harness **不再自带** `probeRunEnv`（没有第二份实现）');

// ── ② 改名的落地 ───────────────────────────────────────
chk(typeof harness.transpileForHarness === 'function', '② `transpileForHarness` 已导出（名字说真话）');
chk(!('transpileToCjs' in harness), '②-b `transpileToCjs` **不再是导出**（无遗留双名）');

// ── ③ env 契约 ─────────────────────────────────────────
{
  const proj = path.join(TMP, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const env = runEnv.probeRunEnv(proj);
  chk(!!env, '③ `probeRunEnv(root)` 给出 env');
  chk(/--import\s+file:\/\//.test(String(env?.NODE_OPTIONS)), '③-b `NODE_OPTIONS` 里 `--import` 是 **file:// URL**（Windows 硬要求）', String(env?.NODE_OPTIONS).slice(0, 120));
  chk(String(env?.OBSERVE_EVENTS_FILE ?? '').startsWith(path.join(proj, '.agent', 'observe')), '③-c `OBSERVE_EVENTS_FILE` 落在**被观测项目**的 `.agent/observe/`', String(env?.OBSERVE_EVENTS_FILE ?? ''));
  const dist = runEnv.probeLayerRoot();
  chk(
    String(env?.AGENT_IO_PROBE_EXCLUDE ?? '').split(path.delimiter).some((x) => x === dist),
    '③-d 排除清单**含**探针层目录**（只排自己，不排整个 dist）**（否则会插桩探针本体＝自伤）',
    `${dist} ∈ [${String(env?.AGENT_IO_PROBE_EXCLUDE ?? '')}]`,
  );
  chk(fs.existsSync(runEnv.probeLoaderPath()), '③-e `probeLoaderPath()` 指向真实存在的 loader', runEnv.probeLoaderPath());
}

// ── ④ 总开关 ───────────────────────────────────────────
{
  process.env.AGENT_IO_PROBE_OFF = '1';
  const env = runEnv.probeRunEnv(path.join(TMP, 'proj'));
  delete process.env.AGENT_IO_PROBE_OFF;
  chk(env === undefined, '④ `AGENT_IO_PROBE_OFF=1` ⇒ 返回 `undefined`（观测可一键关，排查要有对照组）');
}

// ── ⑤ 拿不到 loader ⇒ 不注入（不制造半开状态）──────────
{
  const orig = fs.renameSync;
  const loaderPath = runEnv.probeLoaderPath();
  const bak = loaderPath + '.bak414';
  let env;
  try {
    fs.renameSync(loaderPath, bak);
    env = runEnv.probeRunEnv(path.join(TMP, 'proj'));
  } finally {
    try {
      fs.renameSync(bak, loaderPath);
    } catch {
      /* 恢复失败也不该掩盖真实结论 */
    }
  }
  chk(env === undefined, '⑤ loader 不存在 ⇒ 返回 `undefined`（拿不到就按原样 spawn，不半开）');
}

// ── ⑥ 自根有命名常量（不再手算式散落在 hooks 里）────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/analysis/observe/probe_hooks.ts'), 'utf8');
  chk(/AGENT_IO_PROBE_SELF_ROOT/.test(src), '⑥ `probe_hooks` 支持 `AGENT_IO_PROBE_SELF_ROOT` 覆盖自根');
  chk(/selfRoot/.test(src) && !/selfDist/.test(src), '⑥-b 手算的 `selfDist` 已换成语义名 `selfRoot`');
}

console.log(`\n═══ T414 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
