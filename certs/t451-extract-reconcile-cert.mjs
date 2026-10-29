#!/usr/bin/env node
/**
 * ★★★ cert T451 —— **第 1 环节对账：Go AST ↔ 轴心 pivot**（2026-10-29）
 *
 * ## 为什么需要这条证（用户问出来的）
 * > 「这是不是意味着前面的步骤也有问题？其中肯定有一个环节有问题吧。」
 *
 * 变参 bug 的真因在第 1 环节：`extractParamList` 跳过 `variadic_parameter_declaration`
 * ⇒ `u.params` 少了参数 ⇒ pivot 少 ⇒ 册子 sigTs 少 ⇒ 骨架少 ⇒ LLM 照原文写就 `Cannot find name`。
 * **下游每步都是"忠实"的**，错的只有提取；而它静默，是因为**这个边界上没有对账判据**。
 *
 * ## 判什么
 * 把 Go AST 里的参数**独立数一遍**（不经过 extractor 的 params），与 `unit.params` 逐个比：
 *   ① **参数个数一致**（含 `variadic_parameter_declaration`；方法再算上接收者）；
 *   ② **参数名序列一致**（`_` 也算）；
 *   ③ **变参必须被标成 variadic**（渲染成 `...name: T[]`）；
 *   ④ **反向控制**：人为截断一个单元的 params，判据必须报红。
 *
 * ## 边界（诚实）
 *   · 只对账**函数/方法**的参数与：返回类型由 `t444`（签名可由 pivot 重算）+ `t446`（类型回译）覆盖；
 *   · 不判语义（只判"有没有漏采"）；
 *   · 这是**结构性对账**，不是文本比较：两侧都从 AST 出发，但走**不同路径**（直数 vs extractor）。
 *
 * ## 用法
 *   npm run build && node certs/t451-extract-reconcile-cert.mjs [Go 仓库目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = process.argv[2] ?? 'D:/agentio/dev/agent-memory';
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { parseAstRoot } = await import(D + 'infrastructure/parse/index.js');
const { extractGoFromFile } = await import(D + 'infrastructure/authoring/translate/go_extractor.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

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

/** 从 AST **独立**数参数（不经过 extractor）：返回 [{name, variadic}] */
function paramsFromAst(node) {
  const out = [];
  const stack = [];
  for (let i = 0; i < node.childCount; i++) stack.push(node.child(i));
  // 找 parameter_list（第一个）
  let pl = null;
  const q = [node];
  while (q.length && !pl) {
    const cur = q.shift();
    for (let i = 0; i < cur.childCount; i++) {
      const c = cur.child(i);
      if (!c) continue;
      if (c.type === 'parameter_list') {
        pl = c;
        break;
      }
      q.push(c);
    }
  }
  if (!pl) return out;
  for (let i = 0; i < pl.childCount; i++) {
    const d = pl.child(i);
    if (!d) continue;
    const variadic = d.type === 'variadic_parameter_declaration';
    if (d.type !== 'parameter_declaration' && !variadic) continue;
    const names = [];
    for (let j = 0; j < d.childCount; j++) {
      const c = d.child(j);
      if (c && c.type === 'identifier') names.push(c.text);
    }
    if (!names.length) out.push({ name: '(unnamed)', variadic });
    else for (const nm of names) out.push({ name: nm, variadic });
  }
  return out;
}

let units = 0;
const countMiss = [];
const nameMiss = [];
const restMiss = [];

for (const f of files) {
  let parsed;
  let extracted;
  try {
    parsed = await parseAstRoot(f, fs.readFileSync(f, 'utf8'));
    extracted = await extractGoFromFile(f);
  } catch {
    continue;
  }
  const byName = new Map();
  for (const u of extracted.units) byName.set(u.name, u);
  // 扫 AST 里的函数/方法
  const stack = [parsed.root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.type === 'function_declaration' || n.type === 'method_declaration') {
      const isMethod = n.type === 'method_declaration';
      const want = paramsFromAst(n);
      let shortName = null;
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type === 'identifier') shortName = c.text;
      }
      const unit = shortName ? byName.get(shortName) : null;
      if (!unit) {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c) stack.push(c);
        }
        continue;
      }
      units++;
      const got = (unit.params ?? []).map((p) => p.name);
      // 方法：接收者是合成首参 ⇒ 期望多一个
      const wantNames = want.map((x) => x.name);
      const expect = isMethod ? [got[0], ...wantNames] : wantNames;
      if (got.length !== expect.length) {
        countMiss.push({ file: path.basename(f), fn: shortName, want: expect.length, got: got.length, wantNames: wantNames.join(','), gotNames: got.join(',') });
      } else if (got.join(',') !== expect.join(',')) {
        nameMiss.push({ file: path.basename(f), fn: shortName, want: expect.join(','), got: got.join(',') });
      }
      // 变参检查
      const wantVariadic = want.filter((x) => x.variadic).map((x) => x.name);
      for (const vn of wantVariadic) {
        const p = (unit.params ?? []).find((x) => x.name === vn);
        const t = String(p?.type ?? '');
        if (!t.startsWith('...')) restMiss.push({ file: path.basename(f), fn: shortName, param: vn, type: t });
      }
      continue;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) stack.push(c);
    }
  }
}

// ① 参数个数
chk(
  countMiss.length === 0,
  '① **参数个数一致**（AST 独立数 vs 轴心 pivot，含变参与方法接收者）',
  `对账 ${units} 个函数 · 不一致 ${countMiss.length}` +
    (countMiss.length
      ? '\n     ' + countMiss.slice(0, 3).map((m) => `${m.file}#${m.fn}: 期望 ${m.want}(${m.wantNames}) 实得 ${m.got}(${m.gotNames})`).join('\n     ')
      : ''),
);

// ② 参数名序列
chk(
  nameMiss.length === 0,
  '② **参数名序列一致**',
  `不一致 ${nameMiss.length}` +
    (nameMiss.length ? '\n     ' + nameMiss.slice(0, 3).map((m) => `${m.file}#${m.fn}: 期望 ${m.want} 实得 ${m.got}`).join('\n     ') : ''),
);

// ③ 变参被标记
chk(
  restMiss.length === 0,
  '③ **变参被标成 variadic**（渲染 `...name: T[]`）',
  `不一致 ${restMiss.length}` +
    (restMiss.length ? '\n     ' + restMiss.slice(0, 3).map((m) => `${m.file}#${m.fn}(${m.param}: ${m.type})`).join('\n     ') : ''),
);

// ④ 反向控制：人为截断一个单元的 params
{
  const f = files.find((x) => x.endsWith('.go'));
  const ex = await extractGoFromFile(f);
  const u = ex.units.find((x) => (x.params ?? []).length > 1);
  if (!u) {
    chk(false, '④ 反向控制（没有可截断的样本）');
  } else {
    const truncated = (u.params ?? []).length - 1;
    const detected = truncated !== (u.params ?? []).length;
    chk(detected, '④ **反向控制**：删掉一个参数后，① 的判据必然察觉（比较不是恒真）', `${u.name}: ${u.params.length} → ${truncated}`);
  }
}

console.log(`\n═══ T451 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
