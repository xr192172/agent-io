#!/usr/bin/env node
/**
 * ★★★ regen-translate —— **产物重生成的唯一入口**（T-#REPLAY-REGEN 步 1）
 *
 * ## 为什么需要它
 * 2026-10-30 的事故：为了看一个改进的效果，我**按猜测**跑了两条命令重生成产物 ⇒
 * 孔数 188 → 617、错误 336 → 48（"错误暴跌 + 孔暴涨" = 丢体），**把基线搞红且无法回滚**
 * （产物目录不在 git 里）。根因不是命令难，而是**生成入口从来没有被固化成一条命令**。
 *
 * ## 它做什么
 *   ① 用**唯一已知能写出产物**的路径生成：`projectDir` + `outDir`（单文件 `out` 模式会被骨架闸拦、不落盘）
 *   ② **现场读数**：文件数 / TODO 孔数 / tsc 错误数（单一实现，不另设口径）
 *   ③ 与上一次读数比对，**变差就非零退出**（默认拦；`--allow-worse` 显式放行）
 *   ④ 读数落 `.agent-io/regen-report.json`（谁都能复核"这次生成了什么"）
 *
 * ## 已知边界（诚实）
 *   · 本入口走的是**逐文件 pairs.ts 路径**，它**不查** `project.ts` 的填空缓存
 *     ⇒ 缓存里的历史函数体在这里用不上（孔数会偏高）。这一点见 `T-#REPLAY-REGEN` 步 2。
 *   · 产物目录**不在 git 里** ⇒ 覆盖即不可回滚 ⇒ 故本脚本**先写临时目录**，再整体替换。
 *
 * ## 用法
 *   node scripts/regen-translate.mjs                 # 生成 + 读数 + 与上次比对
 *   node scripts/regen-translate.mjs --into <dir>    # 指定产物目录（默认 agent-memory-ts2）
 *   node scripts/regen-translate.mjs --allow-worse   # 变差也放行（需在提交信息里说明原因）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
// ★ 默认写进 `.../agent-memory-ts2/src`（tsconfig 在上层目录；写到上层会把 tsconfig 挤掉）
const INTO = (() => {
  const i = args.indexOf('--into');
  return path.resolve(i >= 0 ? args[i + 1] : 'D:/agentio/dev/agent-memory-ts2/src');
})();
const ALLOW_WORSE = args.includes('--allow-worse');
const GO_SRC = process.env.AGENT_IO_CORPUS ?? 'D:/agentio/dev/agent-memory';
const REPORT = path.join(ROOT, '.agent-io/regen-report.json');

const countHoles = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        walk(p);
        continue;
      }
      if (!e.name.endsWith('.ts')) continue;
      n += (fs.readFileSync(p, 'utf8').match(/TODO\(translate\)/g) ?? []).length;
    }
  };
  walk(dir);
  return n;
};

const countErrors = (dir) => {
  // ★ tsconfig 可能在**上层**（产物目录是 <proj>/src）⇒ 向上找最近的一个
  let d = dir;
  let tsconfig = path.join(d, 'tsconfig.json');
  for (let i = 0; i < 4 && !fs.existsSync(tsconfig); i++) {
    d = path.dirname(d);
    tsconfig = path.join(d, 'tsconfig.json');
  }
  if (!fs.existsSync(tsconfig)) return { total: 0, note: '无 tsconfig，跳过 tsc' };
  /**
   * ★★★ T-#SYNTAX-MASKS-SEMANTIC（2026-10-30，真实教训）：**有语法错时 tsc 会跳过语义检查**。
   *   实测：撤掉一处语法修好前是 "22 个错"，修好后变 **535 个错** —— 不是变差，是**遮挡被揭开**。
   *   ⇒ 读数必须**分开**：syntax（TS1005/TS1134/TS1135/TS1109…）与 semantic（其余）。
   *   ⇒ 有语法错时 semantic 数**无意义**（会被跳过），必须在报告里说清。
   */
  const split = (log) => {
    const all = log.match(/error TS(\d+)/g) ?? [];
    const isSyntax = new Set(['1005', '1134', '1135', '1109', '1003', '1128']);
    let syntax = 0;
    for (const a of all) if (isSyntax.has(a.replace('error TS', ''))) syntax++;
    return { total: all.length, syntax, semantic: all.length - syntax };
  };
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', tsconfig, '--noEmit'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      cwd: dir,
    });
    return split(out);
  } catch (e) {
    const log = String(e.stdout ?? '') + String(e.stderr ?? '');
    return split(log);
  }
};

// ① 生成到临时目录（先不碰目标目录 ⇒ 避免"半成品覆盖 + 无回滚"）
// ★ 临时目录必须与目标**同盘**（跨盘 renameSync 会 EXDEV 失败 —— 第一次跑就踩了）
fs.mkdirSync(path.dirname(INTO), { recursive: true });
const tmp = fs.mkdtempSync(path.join(path.dirname(INTO), '.regen-tmp-'));
console.log(`[regen] 生成 → ${tmp}（临时），源 ${GO_SRC}`);
// ★ 直接调 CLI（不要 `npm run tool`：Windows 下 execFileSync 带 shell 会失败/吞退出码）
execFileSync(
  process.execPath,
  [
    path.join(ROOT, 'dist/src/presentation/cli/cli.js'),
    'translate',
    '--json',
    // ★★★ 必须 `fill: true`：project.ts 里 **mechBody + 填空缓存**整块都在 `if (opts.fill)` 内。
    //   不传 ⇒ 那条确定性回放完全不执行 ⇒ 产物全是 TODO 孔（实测 617 孔 / 错误 48 的假象就是这么来的）。
    //   回放模式（AGENT_IO_REPLAY_ONLY=1）下 LLM 部分会被优雅跳过，只做 mechBody + 缓存回放。
    JSON.stringify({ from: 'go', to: 'ts', projectDir: GO_SRC, outDir: tmp, fill: true }),
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, AGENT_IO_REPLAY_ONLY: '1', AGENT_IO_TSC_FIX: '1' },
    timeout: 30 * 60 * 1000,
  },
);

// ★★★ 必须**先替换再测量**：tsconfig 在产物的上层（include 指向 src/**），
//   若在临时目录测量，向上找到的是**旧目录的 tsconfig** ⇒ 量的是旧文件 ⇒ 读数完全失真
//   （实测：临时目录测得 22 错，真实是数百条 —— 这就是"判据本身错了"）。
const holesTmp = countHoles(tmp);
const tsFiles = fs.readdirSync(tmp).filter((f) => f.endsWith('.ts')).length;

// ② 落盘（把临时目录整体替换进目标；先备份旧的目标为 .bak-<ts>）
if (fs.existsSync(INTO)) {
  const bak = `${INTO}.bak-${Date.now()}`;
  fs.renameSync(INTO, bak);
  console.log(`[regen] 旧产物已备份 → ${bak}`);
}
fs.mkdirSync(path.dirname(INTO), { recursive: true });
fs.renameSync(tmp, INTO);
console.log(`[regen] 已写入 ${INTO}`);

// ③ **在最终位置测量**（tsconfig 的 include 才指向刚生成的这些文件）
const holes = countHoles(INTO);
const err = countErrors(INTO);
const reading = {
  at: new Date().toISOString(),
  into: INTO,
  corpus: GO_SRC,
  files: tsFiles,
  holes,
  errors: err.total ?? 0,
  syntax: err.syntax ?? 0,
  semantic: err.semantic ?? 0,
  note: err.note ?? '',
  masked: (err.syntax ?? 0) > 0 ? '⚠ 存在语法错 ⇒ tsc 跳过语义检查，semantic 数偏小（不可用于比较）' : '',
};
console.log(
  `[regen] 读数：files=${reading.files} · holes=${reading.holes} · errors=${reading.errors}` +
    `（语法 ${reading.syntax} / 语义 ${reading.semantic}）` +
    (reading.masked ? ` ${reading.masked}` : ''),
);

const prev = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : null;
const worse = [];
if (prev) {
  if (reading.holes > prev.holes) worse.push(`holes ${prev.holes} → ${reading.holes}`);
  if (reading.errors > prev.errors) worse.push(`errors ${prev.errors} → ${reading.errors}`);
}

fs.writeFileSync(REPORT, JSON.stringify({ ...reading, prev: prev ? { at: prev.at, holes: prev.holes, errors: prev.errors } : null, worse }, null, 2) + '\n');

if (worse.length && !ALLOW_WORSE) {
  console.error(`[regen] ✗ 变差：${worse.join(' · ')}——若确属预期，加 --allow-worse 并在提交信息说明`);
  process.exit(1);
}
console.log('[regen] ✓ 生成完成');
