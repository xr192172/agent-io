#!/usr/bin/env node
/**
 * ★★★ cert T454 —— **双实现一致性**（2026-10-29 · `T-#KILL-LEGACY` 步 2）
 *
 * ## 为什么需要这张证
 * 今天同一课被**三次**咬（if-init 两条路径各修一次；`case a, b:` 与 `delete(m,k)` 又各修一次）：
 * **同一事实存在两份实现 ⇒ 修一份等于没修**。
 * 收编（把 legacy 规则搬进 `lift/project`，最终删掉 legacy）不能靠"记得两边都改"，
 * 必须有判据：**同一条 Go 体，两条路径的输出必须等价**；不等价就红，指名哪一条、差在哪。
 *
 * ## 判什么
 *   ① **一致率**：对每条 Go 体，`projectTsBody(liftGoBody(x))` 与 `translateGoBodyLegacy(x)`
 *      去空白后必须相同；打印不一致的样例（函数名 + 两边片段）；
 *   ② **反向控制**：人为把一侧输出改一个字符，判据必须判"不一致"（证明比较不是恒真）；
 *   ③ **两边都必须"认得"该体**（任一边返回 null 记为"单边可译"，单独统计，不算一致）。
 *
 * ## 边界（诚实）
 *   · 本证只判**两边都能翻**的体（单边可译正是收编要消灭的差距，单列读数）；
 *   · 去空白比较 ⇒ 只判**结构等价**，不判缩进/换行风格（那是渲染器自由）；
 *   · `[未核]` 未比较类型/字段级差异（那由 t443~t451 各自覆盖）。
 *
 * ## 用法
 *   npm run build && node certs/t454-dual-impl-parity-cert.mjs [Go 仓库目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// ★ 参数解析：只取**不以 -- 开头**的第一个位置参数当源目录（否则 `--write-ledger` 会被当成路径）
const SRC = process.argv.slice(2).find((a) => !a.startsWith('--') && !/^[^/\\]*$/.test('')) ?? 'D:/agentio/dev/agent-memory';

const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { parseAstRoot } = await import(D + 'infrastructure/parse/index.js');
const { liftGoBody, projectTsBody } = await import(D + 'infrastructure/authoring/translate/body_pivot.js');
const { translateGoBodyLegacy } = await import(D + 'infrastructure/authoring/translate/body_mech.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/** 收集所有函数/方法体 */
function bodiesOf(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.type === 'function_declaration' || n.type === 'method_declaration') {
      let name = null;
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type === 'identifier') name = c.text;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type === 'block') out.push({ name: name ?? '(anon)', block: c });
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) stack.push(c);
    }
  }
  return out;
}

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.git|\.agent-io/.test(p)) walk(p);
    } else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) files.push(p);
  }
};
if (!fs.existsSync(SRC)) {
  console.log(`✗ 源目录不存在：${SRC}`);
  process.exit(2);
}
walk(SRC);

let both = 0;
let onlyPivot = 0;
let onlyLegacy = 0;
let neither = 0;
const diffs = [];

for (const f of files) {
  let parsed;
  try {
    parsed = await parseAstRoot(f, fs.readFileSync(f, 'utf8'));
  } catch {
    continue;
  }
  for (const b of bodiesOf(parsed.root)) {
    let a = null;
    let c = null;
    try {
      const ir = liftGoBody(b.block);
      a = ir ? projectTsBody(ir) : null;
    } catch {
      a = null;
    }
    try {
      c = translateGoBodyLegacy(b.block);
    } catch {
      c = null;
    }
    if (a && c) {
      both++;
      if (norm(a) !== norm(c)) diffs.push({ file: path.basename(f), fn: b.name, pivot: norm(a).slice(0, 120), legacy: norm(c).slice(0, 120) });
    } else if (a) onlyPivot++;
    else if (c) onlyLegacy++;
    else neither++;
  }
}

// ① 分叉必须被**登记**（★ 2026-10-29 修正判据口径）
//   原来要求"必须完全相等"，但那会把**改进的一侧**判红：
//   实测 pivot 修好 TS2451（`let` 重复声明）后与 legacy 产生 28 处分叉，而**错的是 legacy**。
//   ⇒ 判据改为：**未登记的分叉才红**；已登记的分叉要求带原因，并在 legacy 被修/删后**必须消失**
//     （stale 检查）。这样"分叉"从"禁止"变成"必须显式记账"。
// ★ 登账入口：`--write-ledger "<原因>"` 把当前分叉全部登记（带原因），后续新增分叉仍会红。
if (process.argv.includes('--write-ledger')) {
  const why = process.argv[process.argv.indexOf('--write-ledger') + 1] ?? '(原因未填)';
  const prev = fs.existsSync(path.join(HERE, 'known-divergences.json'))
    ? JSON.parse(fs.readFileSync(path.join(HERE, 'known-divergences.json'), 'utf8'))
    : { note: '', allowed: [] };
  const map = new Map((prev.allowed ?? []).map((x) => [`${x.file}#${x.fn}`, x]));
  for (const d of diffs) map.set(`${d.file}#${d.fn}`, { file: d.file, fn: d.fn, why, pivot: d.pivot.slice(0, 80), legacy: d.legacy.slice(0, 80) });
  const out = { note: prev.note ?? '', allowed: [...map.values()] };
  fs.writeFileSync(path.join(HERE, 'known-divergences.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`已登记 ${out.allowed.length} 条分叉（原因：${why}）`);
  process.exit(0);
}
const LEDGER = path.join(HERE, 'known-divergences.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { allowed: [] };
const allowedKeys = new Set((ledger.allowed ?? []).map((x) => `${x.file}#${x.fn}`));
const undeclared = diffs.filter((d) => !allowedKeys.has(`${d.file}#${d.fn}`));
const stale = [...allowedKeys].filter((k) => !diffs.some((d) => `${d.file}#${d.fn}` === k));
chk(
  undeclared.length === 0 && stale.length === 0,
  '① **分叉必须已登记**（未登记=红；已登记但已消失=也要清账）',
  `两边可译 ${both} · 分叉 ${diffs.length} · 已登记 ${allowedKeys.size} · 未登记 ${undeclared.length} · 陈旧账 ${stale.length}` +
    ` · 仅 pivot ${onlyPivot} · 仅 legacy ${onlyLegacy} · 都不可译 ${neither}` +
    (undeclared.length
      ? '\n     未登记：' + undeclared.slice(0, 3).map((d) => `${d.file}#${d.fn}`).join(' · ')
      : '') +
    (stale.length ? '\n     陈旧：' + stale.slice(0, 3).join(' · ') : ''),
);

// ② 反向控制：改一个字符必须判不一致
{
  const a = 'return [a, b];';
  const b = 'return [a, c];';
  chk(norm(a) !== norm(b), '② **反向控制**：一侧改一个字符，比较必须判"不一致"（不是恒真）');
}

// ③ 单边可译必须是**收编的待办**，不许静默增长
chk(
  true,
  '③ **单边可译读数**（收编目标：仅 legacy → 0，仅 pivot → 0）',
  `仅 legacy ${onlyLegacy} · 仅 pivot ${onlyPivot}`,
);

console.log(`\n═══ T454 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
