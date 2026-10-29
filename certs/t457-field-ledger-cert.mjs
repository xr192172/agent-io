#!/usr/bin/env node
/**
 * ★★★ cert T457 —— **跨语言字段对账**（字段账 A 档，只读，2026-10-30）
 *
 * ## 为什么先做这一张（而不是字段级流转流）
 * 实测结论（memory §208）：运行时载荷恒同、字段级流转链昂贵；而**字段清单是免费的**（AST 声明）。
 * 而"Go 声明了字段、TS 接口没发出来"这一类 bug（今天实测：`CachedNode.graphNode` 整行丢失，
 * 连带 `node.Type` 提升字段全报 TS2339）**只需要对账，不需要任何数据流**。
 *
 * ## 判什么
 *   ① **Go 声明了、TS 没有** ⇒ 红（丢字段，消费者必踩 TS2339/undefined）
 *   ② **TS 有、Go 没有**   ⇒ 红（凭空造字段，通常是渲染 bug）
 *   ③ 同名结构体逐字段比，输出逐结构体的 matched / missing / extra
 *
 * ## 边界（诚实）
 *   · 只比**同名结构体/接口**（本仓翻译保持名字）；跨文件改名/泛型实参未处理 `[未核]`；
 *   · 只比**字段名集合**，不比类型（类型由 t451/t447 覆盖）；
 *   · Go 侧用 `extractGoFromFile`（已有），TS 侧用 tsc AST 解析生成物；
 *   · 只读：不改任何代码。
 *
 * ## 用法
 *   npm run build && node certs/t457-field-ledger-cert.mjs [Go源目录] [TS生成目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('D:/agentio/dev/agent-io/node_modules/typescript');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { extractGoFromFile } = await import(D + 'infrastructure/authoring/translate/go_extractor.js');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const GO_DIR = args[0] ?? 'D:/agentio/dev/agent-memory';
const TS_DIR = args[1] ?? 'D:/agentio/dev/agent-memory-ts2/src';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** Go 侧：结构体名 → 字段名集合 */
const goStructs = new Map();
for (const f of fs.readdirSync(GO_DIR).filter((x) => x.endsWith('.go') && !x.endsWith('_test.go'))) {
  let r;
  try {
    r = await extractGoFromFile(path.join(GO_DIR, f));
  } catch {
    continue;
  }
  for (const u of r.units ?? []) {
    if (u.typeKind !== 'struct' || !u.fields?.length) continue;
    if (!goStructs.has(u.name)) goStructs.set(u.name, { file: f, fields: new Set() });
    for (const fl of u.fields) goStructs.get(u.name).fields.add(fl.name);
  }
}

/** TS 侧：interface 名 → 成员名集合（递归扫生成目录） */
const tsIfaces = new Map();
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.git/.test(p)) walk(p);
      continue;
    }
    if (!e.name.endsWith('.ts')) continue;
    const sf = ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.ES2022, true);
    for (const st of sf.statements) {
      if (!ts.isInterfaceDeclaration(st)) continue;
      if (!tsIfaces.has(st.name.text)) tsIfaces.set(st.name.text, { file: path.relative(TS_DIR, p), members: new Set() });
      for (const m of st.members) if (m.name && ts.isIdentifier(m.name)) tsIfaces.get(st.name.text).members.add(m.name.text);
    }
  }
};
if (fs.existsSync(TS_DIR)) walk(TS_DIR);

let compared = 0;
let matchedPairs = 0;
const missing = [];
const extra = [];
for (const [name, g] of goStructs) {
  const t = tsIfaces.get(name);
  if (!t) continue;
  compared++;
  matchedPairs++;
  for (const fl of g.fields) if (!t.members.has(fl)) missing.push({ struct: name, field: fl, tsFile: t.file });
  for (const m of t.members) if (!g.fields.has(m)) extra.push({ struct: name, field: m, tsFile: t.file });
}

console.log(`Go 结构体 ${goStructs.size} · TS 接口 ${tsIfaces.size} · 同名可比 ${compared}`);
console.log(`字段：缺失 ${missing.length} · 多余 ${extra.length}`);

chk(matchedPairs > 0, '① **比得上东西**（不是恒空）', `同名结构体/接口 ${matchedPairs} 对`);
chk(
  missing.length === 0,
  '② **Go 声明的字段必须都在 TS 接口里**（丢字段 = 消费者必踩 TS2339/undefined）',
  missing.length ? missing.slice(0, 8).map((x) => `${x.struct}.${x.field}（${x.tsFile}）`).join('\n     ') : '无缺失',
);
chk(
  extra.length === 0,
  '③ **TS 不许凭空多字段**（通常是渲染 bug）',
  extra.length ? extra.slice(0, 8).map((x) => `${x.struct}.${x.field}（${x.tsFile}）`).join('\n     ') : '无多余',
);

console.log(`\n═══ T457 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
