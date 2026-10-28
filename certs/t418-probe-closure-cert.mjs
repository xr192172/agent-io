#!/usr/bin/env node
/**
 * ★★★ cert T418 —— **探针侧依赖闭包排除**：让"观测我们自己的框架代码"成为可能（2026-10-28）
 *
 * ## 背景：一次**静默自伤**
 * 曾把排除口径从"整个 dist"收窄成"只排 `observe/` 目录" ⇒ **进程无输出、exit 0**。
 * 真凶不是探针本体（`probe.js` 只 import node 内置），而是**插桩器自己**：
 * `instrument.js` 依赖 `ts_kernel` 那一批 dist 模块，而它**跑在 hooks 线程里** ——
 * 那些模块被插桩后注入的 `import {captureProbe} from './probe.js'` 会在"正在加载依赖的 hooks 线程"里
 * 再触发加载 ⇒ **循环** ⇒ 静默死。
 *
 * ## 现在的不变式（本证要钉的）
 * 排除 = **探针可达的 import 闭包**，且该闭包**对 import 封闭**
 * （每个成员的相对 import 目标也必在闭包内）⇒ 不会有"被插桩模块 → 探针 → 被插桩模块"的环。
 *
 * ## 判据（每条亲手跑）
 *   ① 闭包非空且**明显多于胶水层**（含插桩器的依赖，如 `ts_kernel` 那批）；
 *   ② **闭包对 import 封闭** —— 这是安全性的真正依据（不是"列了个名单"）；
 *   ③ 用闭包口径跑真子进程：**有输出**（不再静默自伤）+ **有事件**；
 *   ④ 事件里的 `file` **指向 dist 模块**（★ 这就是"观测到自己"的证据）；
 *   ⑤ **行为不变**：插桩后程序输出与不插桩逐字一致；
 *   ⑥ 探针层自身（`probe_closure.js` / `instrument.js` …）**不出现在事件里**（闭包确实生效）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 Node/ESM（`.js/.mjs`）；`require()` 的 CJS 不走 hooks（见 `t412` 的发现）；
 *   · **[未核]** 插桩整个 dist 的**性能**代价（本次夹具只碰到 1 个模块）；大项目可能明显变慢；
 *   · **[未核]** 闭包靠**静态扫描相对 import** 算 —— 若哪天出现"动态拼路径的 import"，闭包会漏（故留 `AGENT_IO_PROBE_SELF_ROOT` 强制排除兜底）。
 *
 * ## 用法
 *   node certs/t418-probe-closure-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp418closure-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { probeClosure } = await import(D + 'infrastructure/analysis/observe/probe_closure.js');
const closure = probeClosure();

// ── ① 闭包规模 ────────────────────────────────────────
chk(closure.length > 5, '① 闭包非空且**明显多于胶水层**（含插桩器的依赖）', `${closure.length} 个文件，如 ${closure.slice(0, 3).map((f) => path.basename(f)).join(', ')}`);

// ── ② 闭包对 import 封闭（安全性的真正依据）────────────
{
  const set = new Set(closure);
  const leaks = [];
  for (const f of closure) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"();]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const base = path.resolve(path.dirname(f), m[1]);
      const hit = [base, `${base}.js`, path.join(base, 'index.js')].find((c) => {
        try {
          return fs.statSync(c).isFile();
        } catch {
          return false;
        }
      });
      if (hit && !set.has(hit)) leaks.push(`${path.basename(f)} → ${path.relative(ROOT, hit)}`);
    }
  }
  chk(leaks.length === 0, '② 闭包**对 import 封闭**（不会有"被插桩模块 → 探针 → 被插桩模块"的环）', leaks.slice(0, 3).join('; ') || '无泄漏');
}

// ── ③④⑤ 真子进程 ──────────────────────────────────────
const root = path.join(TMP, 'proj');
fs.mkdirSync(root, { recursive: true });
const driver = path.join(root, 'drive.mjs');
fs.writeFileSync(
  driver,
  `const m = await import('${D}domain/expectation_kinds.js');
console.log('KINDS', m.EXPECTATION_KINDS.length, m.renderExpectation({ kind: 'file-exists', path: 'a.ts' }));
`,
);

const loader = D + 'infrastructure/analysis/observe/probe_loader.js';
const runOnce = (inject) => {
  const ev = path.join(root, `.agent/observe/events-${inject ? 'on' : 'off'}.jsonl`);
  fs.rmSync(ev, { force: true });
  fs.mkdirSync(path.dirname(ev), { recursive: true });
  const env = { ...process.env, AGENT_IO_PROBE_ROOT: root, AGENT_IO_PROBE_EXCLUDE: '', ...(inject ? { OBSERVE_EVENTS_FILE: ev } : {}) };
  const out = execFileSync(process.execPath, inject ? ['--import', loader, driver] : [driver], { cwd: root, encoding: 'utf8', env, timeout: 180_000 });
  const evs = fs.existsSync(ev)
    ? fs.readFileSync(ev, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { out: out.trim(), evs };
};

let on;
let off;
try {
  on = runOnce(true);
  chk(true, '③ 用闭包口径跑真子进程：**有输出**（不再静默自伤）', on.out.slice(0, 90));
} catch (e) {
  chk(false, '③ 用闭包口径跑真子进程：**有输出**', String((e && e.message) || e).slice(0, 160));
  on = { out: '', evs: [] };
}
chk(on.evs.length > 0, '③-b **产生事件**', `${on.evs.length} 条`);

{
  // ★ file 是**相对 AGENT_IO_PROBE_ROOT** 的路径 ⇒ 夹具根在临时目录时会是 ../../dev/agent-io/dist/…，故按片段判
  const fromDist = on.evs.filter((e) => /dist[\\/]src[\\/]/.test(String(e.fields?.file ?? '')));
  chk(fromDist.length > 0, '④ 事件里的 `file` **指向 dist 模块**（观测到了框架自己）', fromDist.slice(0, 3).map((e) => `${e.probe}@${e.fields.file}`).join(', '));
  const probeLayerHit = on.evs.filter((e) => /probe_closure|probe_hooks|probe_loader|run_sentinel|instrument\.js/.test(String(e.fields?.file ?? '')));
  chk(probeLayerHit.length === 0, '⑥ 探针层自身**不出现在事件里**（闭包确实生效）', probeLayerHit.length ? probeLayerHit.map((e) => e.probe).join(', ') : '0 条');
}

try {
  off = runOnce(false);
  chk(on.out === off.out && on.out.startsWith('KINDS'), '⑤ **行为不变**：插桩后输出与不插桩逐字一致', `on="${on.out.slice(0, 60)}" off="${off.out.slice(0, 60)}"`);
} catch (e) {
  chk(false, '⑤ 行为不变（对照组跑失败）', String((e && e.message) || e).slice(0, 160));
}

console.log(`\n═══ T418 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
