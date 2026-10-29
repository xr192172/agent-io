#!/usr/bin/env node
/**
 * ★★★ cert T453 —— **零 LLM 回放基线（棘轮）**（2026-10-29 · `T-#BASELINE-CERT`）
 *
 * ## 为什么需要这张证
 * `design_line action=plan`（画布）要求每条改动都带 `judgement_ref`，规范形态是
 * `cert:<证文件>#<检查号>` 或 `decision:<node#>i`。
 * 而"确定性层有没有退化"此前只有一个**读数**（回放 tsc = 1010），**不是判据** ⇒
 * 所有"改确定性层"的改动都无法在画布上合法申报，也就拿不到"改完要复核什么"。
 *
 * ## 判什么
 *   ① **计数自洽**：从 tsc 日志里求和各类 `TSxxxx` = 总数（防止"总数"和"分类"两个口径打架）；
 *   ② **反向控制**：给一段合成日志（已知 3 个错），计数必须是 3 —— 证明计数真在读日志；
 *   ③ **棘轮**：当前回放错误数 **≤** 基线（`.agent-io/baseline-replay.json`），涨了就红；
 *   ④ **基线可追溯**：基线文件带 `dir` / `at` / `errors`，能回答"这个数是在哪、什么时候测的"。
 *
 * ## 边界（诚实）
 *   · 本证**不跑翻译**（不生成产物），只读已有产物 + 跑 `tsc`；产物由
 *     `AGENT_IO_REPLAY_ONLY=1 npm run tool -- translate …` 生成（全仓 5 秒）；
 *   · 基线里的数**依赖当时的输出目录**；换目录必须重设基线（④ 会显示 dir，便于发现）；
 *   · `[未核]` 未固定 tsconfig/TS 版本 ⇒ 换 TS 版本可能整体偏移，届时需同时更新基线。
 *
 * ## 用法
 *   node certs/t453-replay-baseline-cert.mjs            # 校验（棘轮）
 *   node certs/t453-replay-baseline-cert.mjs --set      # 重设基线为当前读数
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE_FILE = path.join(ROOT, '.agent-io', 'baseline-replay.json');
const DIR = process.env.AGENT_IO_BASELINE_DIR ?? 'D:/agentio/dev/agent-memory-ts2';
const SET = process.argv.includes('--set');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 从 tsc 日志文本里数错误：返回 {total, byCode}（单一实现，总数与分类同源） */
function countErrors(log) {
  const codes = log.match(/error TS\d+/g) ?? [];
  const byCode = {};
  for (const c of codes) byCode[c] = (byCode[c] ?? 0) + 1;
  return { total: codes.length, byCode };
}

// ① 计数自洽（用真实日志自证：分类求和 = 总数）
let realLog = '';
try {
  const out = execFileSync(process.execPath, [
    path.join(ROOT, 'node_modules/typescript/bin/tsc'),
    '-p',
    path.join(DIR, 'tsconfig.json'),
    '--noEmit',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: DIR });
  realLog = out;
} catch (e) {
  realLog = String(e.stdout ?? '') + String(e.stderr ?? '');
}
const real = countErrors(realLog);
/**
 * ★★★ 2026-10-29（**差点被假绿骗**）：一次改动让 `builder.ts` 从 730 行掉到 796 行、**161→188 个 TODO 孔**，
 * tsc 错误数从 431 掉到 **22** —— 看起来"修好了 409 个"，其实是**函数体退化成空孔**（丢体）。
 * ⇒ 基线必须同时锁**错误数**与**空孔数**：孔数涨 = 丢体 = 红。
 */
const HOLES = (() => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const src = fs.readFileSync(p, 'utf8');
      n += (src.match(/TODO\(translate\)/g) ?? []).length;
    }
  };
  const root = path.join(DIR, 'src');
  if (fs.existsSync(root)) walk(root);
  return n;
})();
const sum = Object.values(real.byCode).reduce((a, b) => a + b, 0);
chk(real.total === sum, '① **计数自洽**：分类求和 = 总数（同一实现，不设第二口径）', `total ${real.total} = ΣbyCode ${sum}`);

// ② 反向控制：合成日志必须被数出 3
{
  const fake = 'a.ts(1,1): error TS2304: x\nb.ts(2,2): error TS2339: y\nc.ts(3,3): error TS2555: z\n';
  const c = countErrors(fake);
  chk(c.total === 3 && c.byCode['error TS2304'] === 1, '② **反向控制**：合成日志（3 个已知错）必须数出 3', `实得 ${c.total}`);
}

// ③ 棘轮
const base = fs.existsSync(BASE_FILE) ? JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')) : null;
if (SET || !base) {
  fs.writeFileSync(
    BASE_FILE,
    JSON.stringify({ errors: real.total, holes: HOLES, dir: DIR, at: new Date().toISOString(), note: '零 LLM 回放 tsc 错误数 + TODO 空孔数（孔数涨=丢体=红）' }, null, 2) + '\n',
  );
  chk(true, SET ? '③ **重设基线**（--set）' : '③ 首次建立基线', `errors=${real.total} · holes=${HOLES} · dir=${DIR}`);
} else {
  const delta = real.total - base.errors;
  const holeDelta = typeof base.holes === 'number' ? HOLES - base.holes : 0;
  chk(
    delta <= 0 && holeDelta <= 0,
    '③ **棘轮**：错误数不高于基线 **且** TODO 空孔数不高于基线（孔数涨=丢体）',
    `基线 ${base.errors} · 当前 ${real.total} · 差 ${delta >= 0 ? '+' : ''}${delta}` +
      (delta > 0
        ? '\n     ' +
          Object.entries(real.byCode)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k, v]) => `${k}×${v}`)
            .join(' · ')
        : ''),
  );
}

// ④ 基线可追溯
{
  const b = fs.existsSync(BASE_FILE) ? JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')) : {};
  chk(
    typeof b.errors === 'number' && typeof b.dir === 'string' && typeof b.at === 'string',
    '④ **基线可追溯**：带 errors / dir / at（能回答"在哪、何时测的"）',
    `${b.errors} · ${b.dir} · ${b.at ?? ''}`,
  );
}

console.log('\n── 当前分类 ──');
for (const [k, v] of Object.entries(real.byCode).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   ${k} × ${v}`);
console.log(`\n═══ T453 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
