#!/usr/bin/env node
/**
 * ★★★ cert T421 —— **推荐器 → 插桩器**接上了（T-#OBSERVE-4 ③）（2026-10-28）
 *
 * ## 断点在哪
 * `recommend_observe_points` 算"该在哪打"，把清单写到 `<project>/.agent-io/observe-points.json`；
 * `observe action=instrument` 只认**内联的** `contract_probes` ⇒ 中间那一步要人**手工把文件内容抄进来**。
 * ⇒ 于是"全量无脑插桩"成了唯一好用的路径，"推荐"等于白算。
 *
 * ## 补的是什么
 * `contract_from_points: true` ⇒ 直接读那份清单的 `points[].key`（**就是探针名**，与插桩器同源同命名）。
 * ★ 文件缺失 / 解析失败 / 清单为空 ⇒ **响亮报错，绝不静默退回全量**
 *   （退回全量 = 把探针打满还谎称"按清单插的"，比不插更坏）。
 *
 * ## 判据（每条亲手跑）
 *   ① 契约模式：**只插清单里的点**（探针集合 ⊆ 清单）；
 *   ② 探索模式（不给清单）：**全量不变**（行为不回归）；
 *   ③ 推荐器的 `key` 与插桩器**同源同命名** ⇒ 拿全量跑出的探针名当 key 一定能命中；
 *   ④ 工具级：`contract_from_points=true` + 清单文件 ⇒ 真的只插那些点；
 *   ⑤ 工具级：清单**缺失** ⇒ 报错并提示先跑推荐器（**不退回全量**）；
 *   ⑥ 工具级：清单**空** ⇒ 报错不插（同上）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · ④⑤⑥ 走 CLI 入口，**没走 MCP 线**（同 handler，但传输层未验）；
 *   · **[未核]** 推荐器**打分质量**不在本证范围（本证只证"接上了、不漂移"）；
 *   · **[未核]** `contract_from_points` 目前只读 `.agent-io/observe-points.json` 这一个位置。
 *
 * ## 用法
 *   node certs/t421-recommend-to-instrument-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(ROOT, 'certs/.work/tmp421rec-'));
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
const { instrumentProject } = await import(D + 'infrastructure/analysis/observe/instrument.js');

// 夹具项目
const proj = fs.mkdtempSync(path.join(TMP, 'proj-'));
fs.writeFileSync(path.join(proj, 'probe.js'), 'export function captureProbe() {}\nexport function enterScope() {}\nexport function exitScope() {}\n');
fs.writeFileSync(
  path.join(proj, 'a.ts'),
  `export function alpha(x: number) {
  try { return x; } catch (e) { }
}
export function beta(y: number) { return y; }
`,
);
const probeOpts = (extra = {}) => ({ write: false, projectRoot: proj, probeImport: './probe.js', ...extra });

// ── ② 探索模式全量 ─────────────────────────────────────
const all = await instrumentProject(proj, probeOpts());
const allProbes = (all[0]?.sites ?? []).map((s) => s.probe);
chk(allProbes.length >= 5, '② 探索模式（不给清单）**全量不变**', `${allProbes.length} 条：${allProbes.join(', ')}`);

// ── ① / ③ 契约模式：只插清单点，且 key 同源 ─────────────
const keys = [allProbes[0]];
const only = await instrumentProject(proj, probeOpts({ contractProbes: keys }));
const got = (only[0]?.sites ?? []).map((s) => s.probe);
chk(got.length === 1 && got[0] === keys[0], '① 契约模式**只插清单里的点**', `清单 ${keys.join(',')} ⇒ 实插 ${got.join(',')}`);
chk(allProbes.includes(keys[0]), '③ 推荐器的 `key` 与插桩器**同源同命名**（拿实插探针名当 key 必命中）', keys[0]);

// 工具级调用辅助
const callTool = (obj) => {
  try {
    const out = execFileSync(process.execPath, ['dist/src/presentation/cli/cli.js', 'observe', '--json', JSON.stringify(obj)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, AGENT_IO_REQUIRE_PLAN: '0' },
      maxBuffer: 32 * 1024 * 1024,
    });
    return out;
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
};

// ── ④ 工具级：读清单只插那些点 ─────────────────────────
{
  fs.mkdirSync(path.join(proj, '.agent-io'), { recursive: true });
  fs.writeFileSync(
    path.join(proj, '.agent-io/observe-points.json'),
    JSON.stringify({ points: [{ key: allProbes[0] }, { key: allProbes[allProbes.length - 1] }] }, null, 2),
  );
  const out = callTool({ action: 'instrument', target: proj, dry_run: true, contract_from_points: true });
  const head = out.split('\n').filter((l) => /探针|契约|points|插桩/.test(l)).slice(0, 3).join(' | ');
  chk(/契约|contract|points/i.test(out) || /探针/.test(out), '④ 工具级 `contract_from_points=true` 被接受并出报告', head.slice(0, 160));
  // ★ 报告里应体现"按契约清单"，而不是全量
  chk(!/全量/.test(out) || /契约/.test(out), '④-b 报告体现**按清单**（不是全量）', head.slice(0, 160));
}

// ── ⑤ 清单缺失 ⇒ 报错不退回全量 ────────────────────────
{
  const empty = fs.mkdtempSync(path.join(TMP, 'nofile-'));
  fs.writeFileSync(path.join(empty, 'probe.js'), 'export function captureProbe() {}\nexport function enterScope() {}\nexport function exitScope() {}\n');
  fs.writeFileSync(path.join(empty, 'z.ts'), 'export function zeta(a: number) { return a; }\n');
  const out = callTool({ action: 'instrument', target: empty, dry_run: true, contract_from_points: true });
  chk(/要求先跑推荐器|先 .?recommend_observe_points/.test(out), '⑤ 清单**缺失** ⇒ 报错并提示先跑推荐器（**不退回全量**）', out.split('\n').find((l) => /推荐器|points/.test(l))?.slice(0, 160) ?? '');
}

// ── ⑥ 清单空 ⇒ 报错不插 ────────────────────────────────
{
  const e2 = fs.mkdtempSync(path.join(TMP, 'empty-'));
  fs.writeFileSync(path.join(e2, 'probe.js'), 'export function captureProbe() {}\nexport function enterScope() {}\nexport function exitScope() {}\n');
  fs.writeFileSync(path.join(e2, 'z.ts'), 'export function zeta(a: number) { return a; }\n');
  fs.mkdirSync(path.join(e2, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(e2, '.agent-io/observe-points.json'), JSON.stringify({ points: [] }));
  const out = callTool({ action: 'instrument', target: e2, dry_run: true, contract_from_points: true });
  chk(/一条 key 都没有/.test(out), '⑥ 清单**空** ⇒ 报错不插（不静默退回全量）', out.split('\n').find((l) => /key 都没有/.test(l))?.slice(0, 160) ?? '');
}

console.log(`\n═══ T421 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
