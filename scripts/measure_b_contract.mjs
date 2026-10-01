/**
 * ④ 的进展量具：**[B] 契约现状**（入参形态 × 产物形态 × 锚点语义）。
 *
 * 为什么要它：
 *   §19 用户设想的"工具链"要求 **[B] 之间有统一的中间数据形态**（B₂ 能接 B₁ 的产物）。
 *   在动任何代码之前，先把"现在长什么样"量出来 —— 否则就是"没判据就动代码"。
 *
 * ★★ 为什么**必须同时报字段类型**（本量具第一版栽过）：
 *   第一版只比**字段名**，把 `filesWritten` 当成 `files` 的同义名 ⇒ **假阳性**。
 *   实测真相：`renameFiles.filesWritten` 是 **`number`（计数）**、`applied` 是**逐条结果数组**；
 *   `runTests` 的 `success` 是"测试全过"的**领域判定**（≠ `ok`）；`searchBricks.box_dir` 是**积木盒根**（≠ project_dir）。
 *   ⇒ **"名字像" ≠ "同义"**。类型摆出来，`number` 与 `string[]` 一眼可分。
 *   ⇒ 本量具只产出**候选 + 证据**，**不下"欠账"结论** —— 是否同义要人读语义。
 *
 * 判据来源：TS 编译器的 type checker（结构化数据），不是正则。
 *
 * 用法：
 *   node scripts/measure_b_contract.mjs            # 摘要 + 逐条表
 *   node scripts/measure_b_contract.mjs --anchors   # 只列含锚点候选字段的（带类型）
 *   node scripts/measure_b_contract.mjs --json
 */
import ts from 'typescript';
import path from 'node:path';

const ROOT = process.cwd();
const cfgPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
const files = parsed.fileNames.filter((f) =>
  path.relative(ROOT, f).split(path.sep).join('/').startsWith('src/application/'),
);
const program = ts.createProgram(files, parsed.options);
const checker = program.getTypeChecker();
const toCamel = (s) => s.replace(/_(\w)/g, (_, c) => c.toUpperCase());
const BAG = /^(Record<string,\s*(unknown|any|never)>|unknown|any|object)$/;

const unwrap = (t) => {
  const n = t.getSymbol?.()?.getName?.();
  if (n === 'Promise' || n === 'Array' || n === 'ReadonlyArray') {
    const a = checker.getTypeArguments(t);
    if (a.length) return unwrap(a[0]);
  }
  return t;
};
const typeOfProp = (t, name) => {
  const p = t.getProperty(name);
  if (!p) return '?';
  const d = p.valueDeclaration ?? p.declarations?.[0];
  const n = d?.name ?? p.valueDeclaration;
  return n ? checker.typeToString(checker.getTypeOfSymbolAtLocation(p, n)) : checker.typeToString(t);
};

/**
 * 锚点候选（**只是候选**）：出现在产物里、可能被下游 [B] 当原料用的字段名。
 * ★ 不作为"欠账清单"用 —— 语义是否一致要逐个人读（见文件头）。
 */
const ANCHOR_CANDIDATES = new Set([
  'feature', 'project_dir', 'project_root', 'box_dir', 'brick_dir', 'target_dir', 'slim_dir',
  'files', 'written', 'filesWritten', 'files_changed', 'added_files', 'updated_files',
  'written_to_dsl', 'moved', 'applied', 'files_written',
  'symbol', 'symbols', 'node_id', 'nodes', 'previews',
]);

const rows = [];
for (const f of files) {
  const sf = program.getSourceFile(f);
  const base = path.basename(f, '.ts');
  if (!sf || base === 'index') continue;
  const want = toCamel(base);
  for (const st of sf.statements) {
    if (!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    let name = null, decl = null;
    if (ts.isFunctionDeclaration(st) && st.name) { name = st.name.text; decl = st; }
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer;
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) { name = d.name.text; decl = init; }
      }
    }
    if (name !== want) continue;
    const sig = checker.getSignatureFromDeclaration(decl);
    if (!sig) continue;

    // 入参
    const params = sig.getParameters();
    let input;
    if (params.length === 0) input = { kind: 'none', text: '', fields: [] };
    else if (params.length > 1) input = { kind: 'positional', text: `${params.length} 个位置参数`, fields: params.map((p) => p.getName()) };
    else {
      const p = params[0];
      const d = p.valueDeclaration ?? decl;
      const t = checker.getTypeOfSymbolAtLocation(p, d);
      const s = checker.typeToString(t);
      const kind = BAG.test(s.replace(/\s+/g, ' ')) || s === '{}' || s === 'object' ? 'bag' : s.startsWith('{') ? 'inline' : 'typed';
      input = { kind, text: s, fields: t.getProperties().map((x) => x.getName()) };
    }

    // 产物
    const rt = unwrap(checker.getReturnTypeOfSignature(sig));
    const rtText = checker.typeToString(rt);
    let product;
    if (rtText === 'void' || rtText === 'undefined' || rtText === 'never') product = { kind: 'void', text: rtText, fields: [] };
    else if (rtText === 'string') product = { kind: 'string', text: rtText, fields: [] };
    else {
      const props = rt.getProperties().map((p) => p.getName());
      if (!props.length) product = { kind: 'opaque', text: rtText, fields: [] };
      else product = {
        kind: props.filter((x) => x !== 'message').length ? 'structured' : 'message-only',
        text: rtText,
        fields: props,
        fieldTypes: Object.fromEntries(props.map((p) => [p, typeOfProp(rt, p)])),
        anchors: props.filter((p) => ANCHOR_CANDIDATES.has(p)),
      };
    }
    rows.push({ name, file: path.relative(ROOT, f).split(path.sep).join('/'), input, product });
  }
}

const count = (get) => rows.reduce((m, r) => ((m[get(r)] = (m[get(r)] ?? 0) + 1), m), {});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else if (process.argv.includes('--anchors')) {
  console.log('=== 含"锚点候选"字段的 [B]（★ 名字 + **类型** + 语义由人读）===');
  for (const r of rows.filter((r) => r.product.anchors?.length)) {
    console.log(`\n${r.name}  (${r.file})`);
    for (const a of r.product.anchors) console.log(`   ${a}: ${r.product.fieldTypes[a]}`);
  }
} else {
  const inTypes = new Set(rows.map((r) => r.input.text).filter((t) => t && !t.startsWith('{')));
  const outShapes = new Map();
  for (const r of rows) {
    const k = [...r.product.fields].sort().join(',');
    outShapes.set(k, (outShapes.get(k) ?? 0) + 1);
  }
  const shared = [...outShapes.entries()].filter(([, n]) => n >= 2);
  console.log(`人群（[B] = application/** 里"函数名==文件名camelCase"的导出函数）: ${rows.length}`);
  console.log(`入参形态: ${JSON.stringify(count((r) => r.input.kind))}`);
  console.log(`产物形态: ${JSON.stringify(count((r) => r.product.kind))}`);
  console.log('');
  console.log(`★ 入参类型：${inTypes.size} 种不同名字 / ${rows.length} 个 [B]   ⇒ 越接近 1:1 越说明"各写各的"`);
  console.log(`★ 产物字段组合：${outShapes.size} 种 / ${rows.length} 个 [B]；被 ≥2 个共用的只有 ${shared.length} 种`);
  if (shared.length) for (const [k, n] of shared) console.log(`     ×${n}  {${k}}`);
  const noAnchor = rows.filter((r) => !r.product.anchors?.length);
  console.log(`★ 产物里**没有任何锚点候选字段**的 [B]：${noAnchor.length}/${rows.length}（下游最难接）`);
  console.log(`     ${noAnchor.map((r) => r.name).join(', ')}`);
  console.log('');
  console.log('（细节：--anchors 看锚点候选 + 类型；--json 拿全部）');
}
