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
 *   · ★ ③④ 两条"从未写/从未读"是**近似读数、未核**：计数只认 `x.f = …` 与键式字面量 `T{f: …}`，
 *     **认不出位置式复合字面量 `T{a,b,c}`**，也认不出跨包写入；实测 `heatStore` 这类字段只在测试里出现。
 *     要变成判据，必须先补这两类（或将字段级写点改为"构造点聚合"）。
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

/**
 * ★ READ_WRITE_SITES（A 档免费部分）：每个字段在 Go 源码里的**写入点 / 读取点**计数。
 * 只做**名字级 + 单文件内**的机械识别，不做数据流：
 *   写：`x.f = …`（赋值左值是 selector）· 复合字面量的键 `T{f: …}`
 *   读：`.f`（selector 的字段名）
 * ⇒ 白拿两个判据：**声明了但从未写入**（死字段/漏构造）· **声明了但从未读取**（死字段/漏消费）。
 */
const WRITES = new Map();
const READS = new Map();
const { parseAstRoot } = await import(D + 'infrastructure/parse/index.js');
for (const f of fs.readdirSync(GO_DIR).filter((x) => x.endsWith('.go') && !x.endsWith('_test.go'))) {
  let root;
  try {
    root = (await parseAstRoot(path.join(GO_DIR, f), fs.readFileSync(path.join(GO_DIR, f), 'utf8'))).root;
  } catch {
    continue;
  }
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    // 写：赋值左值
    if (n.type === 'assignment_statement') {
      const lhs = n.child(0);
      // ★ 单值赋值 s.f = x 的左值直接就是 selector_expression（不是 expression_list）
      //   第一版只处理 expression_list ⇒ 漏掉全部单字段赋值 ⇒ 假报 205 个「从未写入」。
      const bump = (c) => {
        if (c && c.type === 'selector_expression') {
          const fld = c.child(c.childCount - 1);
          if (fld && fld.type === 'field_identifier') WRITES.set(fld.text, (WRITES.get(fld.text) ?? 0) + 1);
        }
      };
      if (lhs && lhs.type === 'expression_list') {
        for (let i = 0; i < lhs.childCount; i++) bump(lhs.child(i));
      } else bump(lhs);
    }
    // 写：复合字面量的键
    if (n.type === 'keyed_element') {
      const k = n.child(0);
      if (k && k.type === 'field_identifier') WRITES.set(k.text, (WRITES.get(k.text) ?? 0) + 1);
    }
    // 读：selector 的字段名
    if (n.type === 'selector_expression') {
      const fld = n.child(n.childCount - 1);
      if (fld && fld.type === 'field_identifier') READS.set(fld.text, (READS.get(fld.text) ?? 0) + 1);
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) stack.push(c);
    }
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

// ★ 落成持久产物：设计侧与其它工具都能读（不新造表 —— 声明字段其实已在 cache.db 的 nodes.members 里，
//   这里补的是**跨语言对账结果**这一层派生事实）。
const LEDGER = path.join(ROOT, '.agent-io/field-ledger.json');
const ledger = {
  note: '字段账（A 档）：Go 结构体声明 vs 生成 TS 接口成员，同名对账。missing=Go 有 TS 无（丢字段）；extra=TS 凭空多。',
  goDir: GO_DIR,
  tsDir: TS_DIR,
  at: new Date().toISOString(),
  structures: [...goStructs.entries()].map(([name, g]) => {
    const t = tsIfaces.get(name);
    return {
      structure: name,
      goFile: g.file,
      tsFile: t?.file ?? null,
      goFields: [...g.fields].sort(),
      tsMembers: t ? [...t.members].sort() : null,
      missing: t ? [...g.fields].filter((f) => !t.members.has(f)) : [...g.fields],
      extra: t ? [...t.members].filter((m) => !g.fields.has(m)) : [],
    };
  }),
  totals: { structures: compared, missing: missing.length, extra: extra.length },
  readWrite: Object.fromEntries(
    [...goStructs.values()].flatMap((g) => [...g.fields]).map((f) => [f, { writes: WRITES.get(f) ?? 0, reads: READS.get(f) ?? 0 }]),
  ),
};
fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
console.log(`字段账已落盘：${path.relative(ROOT, LEDGER)}（${ledger.structures.length} 个结构体）`);

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

// ③④ 字段的写/读三态（名字级，跨结构体聚合；同名同计 —— 已在文档标注为已知近似）
const allFields = [...new Set([...goStructs.values()].flatMap((g) => [...g.fields]))];
const noWrite = allFields.filter((f) => (WRITES.get(f) ?? 0) === 0);
const noRead = allFields.filter((f) => (READS.get(f) ?? 0) === 0);
chk(true, '③ [未核·近似] **从未写入的字段读数**（死字段/漏构造嫌疑）—— 计数只认 `x.f =` 与键式字面量，**认不出位置式 `T{a,b,c}`**，故本行不是判据', `${noWrite.length} 个：${noWrite.slice(0, 8).join(', ')}${noWrite.length > 8 ? ' …' : ''}`);
chk(true, '④ [未核·近似] **从未读取的字段读数**（死字段/漏消费嫌疑）—— 同上，非判据', `${noRead.length} 个：${noRead.slice(0, 8).join(', ')}${noRead.length > 8 ? ' …' : ''}`);
console.log(`\n═══ T457 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
