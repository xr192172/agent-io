#!/usr/bin/env node
/**
 * **派生 touches** —— 让增量验证真的能命中（2026-10-22）
 *
 * ## 它解决的问题
 * `scripts/verify-changed.mjs` 第 ③ 步要读证书里的 `touches:` 声明，但实测：
 * **75 张证里 70 张没写**（它自己的注释第 41 行就写明了，并归因到 `task_plan.touches_gap`）。
 * ⇒ 增量入口"命中 0 张"⇒ **它不是"只跑受影响的"，是"什么都不跑"**。
 *
 * ## 为什么派生而不是手写
 * `touches` 是**"这个证观察了谁"的事实**，不是"作者声明的意图"。
 * - 手写 = 第二份事实（改了证忘了改 touches ⇒ 又变成静默漏跑）
 * - 派生 = 从证自己的代码里算（证 `readFileSync('src/x.ts')` 就是在观察 `src/x.ts`）
 *
 * ★ 派生是**保守的**：宁可多算（多跑几张证），绝不漏算（漏跑 = 假绿）。
 *   因此注释里提到的路径**也算**——多跑无害，漏跑致命。
 *
 * ## 产物
 * `certs/.touches.json`：`{ "certs/t360-xxx.mjs": ["src/domain/task_machine.ts", ...], ... }`
 * ★ 它**是产物，不是源**（每次跑重新生成；不手改；`certs/.work/` 与 `certs/.touches.json` 都不入库）
 *
 * ## 用法
 *   node scripts/derive-touches.mjs          # 生成 certs/.touches.json + 打印覆盖率
 *   node scripts/derive-touches.mjs --check  # 只打印，不写盘
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CERTS = path.join(ROOT, 'certs');
const OUT = path.join(CERTS, '.touches.json');
const CHECK = process.argv.includes('--check');

/** 从一段文本里抽 `src/...` 路径（★ 含 dist/src/ 前缀的，归一成 src/） */
function extractPaths(txt) {
  const out = new Set();
  // 匹配 'src/xxx.ts' / "src/xxx.ts" / `src/xxx.ts` / dist/src/xxx.ts
  const re = /(?:dist\/)?src\/[A-Za-z0-9_\-./]+\.(?:ts|mjs|js|json)/g;
  let m;
  while ((m = re.exec(txt))) {
    const p = m[0].replace(/^dist\//, '');
    if (p.includes('..')) continue;
    out.add(p);
  }
  return [...out].sort();
}

/** 从 `certs/*.mjs` 头部注释里读显式 `touches:` 声明（若有，优先用它 ∪ 派生结果） */
function declaredTouches(txt) {
  const out = new Set();
  const lines = txt.split('\n').slice(0, 60); // 只扫文件头（声明住在头注释里）
  for (const line of lines) {
    const m = line.match(/^\s*\*\s*touches:\s*(.+)$/i);
    if (!m) continue;
    for (const part of m[1].split(',')) {
      const p = part.trim().replace(/^`|`$/g, '');
      if (/^(?:dist\/)?src\//.test(p)) out.add(p.replace(/^dist\//, ''));
    }
  }
  return [...out];
}

const files = fs.readdirSync(CERTS).filter((f) => f.endsWith('.mjs') && !f.startsWith('.'));
const index = {};
let zero = [];
for (const f of files) {
  const txt = fs.readFileSync(path.join(CERTS, f), 'utf-8');
  const all = new Set([...extractPaths(txt), ...declaredTouches(txt)]);
  if (all.size === 0) { zero.push(f); continue; }
  index[f] = [...all].sort();
}

const withTouches = Object.keys(index).length;
console.log(`══ 派生 touches ══`);
console.log(`证总数 ${files.length} · 派生到 ≥1 个源文件的 ${withTouches} · 零命中（必须全跑）${zero.length}`);
const ratio = Math.round((withTouches / files.length) * 100);
console.log(`覆盖率 ${ratio}%`);

if (zero.length) {
  console.log(`\n★ 零命中的 ${zero.length} 张（没法增量，只能全跑；这是诚实的下限，不是错误）：`);
  for (const z of zero.slice(0, 8)) console.log(`  · ${z}`);
  if (zero.length > 8) console.log(`  … 另 ${zero.length - 8} 张`);
}

if (!CHECK) {
  fs.writeFileSync(OUT, JSON.stringify(index, null, 2));
  console.log(`\n✓ 写到 ${path.relative(ROOT, OUT)}（★ 产物，不入库）`);
  if (zero.length) console.log(`★ 建议 verify-changed 对"零命中"的证采取【全跑】而不是【不跑】（漏跑=假绿）`);
}
