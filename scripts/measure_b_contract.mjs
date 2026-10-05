/**
 * ★★ 2026-10-05：本脚本是**生成器**，不是「门」—— 它**产出**两份文档：
 *   `docs/glossary.md`（术语表）与 `docs/b-field-dictionary.md`（[B] 字段字典）。
 *   它**不拦截**任何提交、**不只提示**你去看某个文件 ⇒ 不属"过度工程化的门"那一类。
 *
 *   ★ 曾有"把量具一并删掉"的提案把它删了 —— **理由不成立，已恢复**。
 *     删掉它的后果不是"少一个提示"，而是：那两份文档的数据还在仓里，
 *     却**再也无法从 `b_terms.ts` 重新生成** ⇒ 退化成人工维护的快照 ⇒ **文档与代码脱钩**
 *     （这正是本仓头号病根「判据分叉」的另一种形态）。
 *
 *   ⇒ ★ **给下一个想删它的人**：先看它**有没有产出物**。
 *     有产出物的是**功能**（该留）；只有"提示你去看某个文件"的才是**提示器**（该删）。
 *
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
import fs from 'node:fs';

const ROOT = process.cwd();
const cfgPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
const files = parsed.fileNames.filter((f) =>
  path.relative(ROOT, f).split(path.sep).join('/').startsWith('src/application/'),
);
/** 术语表模块（`--glossary` 直读它的 AST；★ 不依赖 dist 构建，避免读到陈旧产物） */
const TERMS_FILE = path.join(ROOT, 'src/domain/b_terms.ts');
const program = ts.createProgram(fs.existsSync(TERMS_FILE) ? [...files, TERMS_FILE] : files, parsed.options);
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
  try {
    return n ? checker.typeToString(checker.getTypeOfSymbolAtLocation(p, n)) : checker.typeToString(checker.getTypeOfSymbol(p));
  } catch {
    return checker.typeToString(checker.getTypeOfSymbol(p));
  }
};

/**
 * ★★ 比较类型前必须先**归一化可选性**（本量具第二版栽过）：
 *   `string` 与 `string | undefined` 只是"必填 vs 可选"，**不是语义不同**。
 *   第一版把 `feature` / `project_dir` / `file` / `node_id` / `symbol` 全判成"同名不同型" —— **全是假阳性**。
 */
const normType = (s) => s.replace(/\s*\|\s*undefined\b/g, '').replace(/\bundefined\s*\|\s*/g, '').trim();

/**
 * ★ 把一个初始化表达式**折成一行字符串**（能折就折，不能折返回 `null`）。
 *
 * 为什么必须有它（2026-10-05 实测）：词表里好些 `meaning`/`fix` 是**多行拼接**
 *   （`'第一句' + '第二句' + …`）。旧实现直接 `v.getText()` ⇒ 把**缩进和换行原样吐进 markdown 表格**
 *   ⇒ **一行被撑成多行、表格散架**（`definition_file` / `read_files` / `files` 都是这种写法，
 *   而上一版生成物里那份 `definition_file` **根本没生成过** ⇒ 这个洞一直没人碰）。
 *   ⇒ 判据：**AST 里的字符串拼接是语法结构，按结构折**（不是正则去拼）。
 */
function foldStringLiteral(v) {
  if (!v) return null;
  if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) return v.text;
  if (ts.isParenthesizedExpression(v)) return foldStringLiteral(v.expression);
  if (ts.isBinaryExpression(v) && v.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = foldStringLiteral(v.left);
    const r = foldStringLiteral(v.right);
    return l === null || r === null ? null : l + r;
  }
  return null;
}

/**
 * 读 `src/domain/b_terms.ts` 的 AST（**不 import 构建产物** ⇒ 不会读到陈旧 dist）。
 * ★ 2026-10-05：从 `--glossary` 分支里**提出来**，好让"锚点名"也由它派生（见下）——
 *   原先本文件**另持一份手抄的 `ANCHOR_CANDIDATES`**，里面还留着已删/已退役的名字
 *   （`box_dir` / `brick_dir` / `slim_dir` / `written` / `filesWritten`）⇒ **判据分叉**。
 */
function readTerms() {
  const tsf = program.getSourceFile(TERMS_FILE);
  const out = [];
  if (!tsf) return out;
  for (const st of tsf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== 'B_TERMS') continue;
      const init = d.initializer;
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      for (const p of init.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
        const obj = p.initializer;
        if (!nm || !ts.isObjectLiteralExpression(obj)) continue;
        const get = (key) => {
          for (const q of obj.properties) {
            if (!ts.isPropertyAssignment(q)) continue;
            const k = ts.isIdentifier(q.name) || ts.isStringLiteral(q.name) ? q.name.text : null;
            if (k !== key) continue;
            const v = q.initializer;
            const folded = foldStringLiteral(v);   // ★ 多行拼接折成一行（否则撑断 markdown 表格）
            if (folded !== null) return folded;
            if (v.kind === ts.SyntaxKind.TrueKeyword) return 'true';
            return v.getText();
          }
          return null;
        };
        out.push({ name: nm, kind: get('kind'), type: get('type'), meaning: get('meaning') ?? '', debt: get('debt') === 'true', fix: get('fix') });
      }
    }
  }
  return out;
}

const TERMS = readTerms();
/** ★ 权威来源 = 词表。**不再手抄**任何"锚点名"。 */
const TERM_NAMES = new Set(TERMS.map((t) => t.name));
/** 词表里登记为「链的接口」的词（`kind: 'anchor'`） */
const ANCHOR_NAMES = new Set(TERMS.filter((t) => t.kind === 'anchor').map((t) => t.name));
/** 已退役：不许再新增使用者的词（词表里带"已退役"字样的） */
const RETIRED_NAMES = new Set(TERMS.filter((t) => (t.meaning ?? '').includes('已退役')).map((t) => t.name));

/**
 * 产物侧「锚点候选」的判定（2026-10-05 改）：
 *   ① 词表登记为 anchor 的（**权威**）；或
 *   ② **不在词表里** 的字段名 —— 它们正是**候选异名 / 候选接力键**（该收口 or 该登记），
 *      由摘要里那一节机械列出，**不再靠手抄名单**。
 */
const isAnchorCandidate = (p) => ANCHOR_NAMES.has(p) || !TERM_NAMES.has(p);

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
    if (params.length === 0) input = { kind: 'none', text: '', fields: [], fieldTypes: {} };
    else if (params.length > 1) {
      input = { kind: 'positional', text: `${params.length} 个位置参数`, fields: params.map((p) => p.getName()), fieldTypes: {} };
    } else {
      const p = params[0];
      const d = p.valueDeclaration ?? decl;
      const t = checker.getTypeOfSymbolAtLocation(p, d);
      const s = checker.typeToString(t);
      const kind = BAG.test(s.replace(/\s+/g, ' ')) || s === '{}' || s === 'object' ? 'bag' : s.startsWith('{') ? 'inline' : 'typed';
      const props = t.getProperties().map((x) => x.getName());
      input = { kind, text: s, fields: props, fieldTypes: Object.fromEntries(props.map((x) => [x, typeOfProp(t, x)])) };
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
        anchors: props.filter((p) => isAnchorCandidate(p)),
      };
    }
    rows.push({ name, file: path.relative(ROOT, f).split(path.sep).join('/'), input, product });
  }
}

const count = (get) => rows.reduce((m, r) => ((m[get(r)] = (m[get(r)] ?? 0) + 1), m), {});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else if (process.argv.includes('--glossary')) {
  /**
   * ★ 术语表：**直读 `src/domain/b_terms.ts` 的 AST**（不 import 构建产物 ⇒ 不会读到陈旧 dist），
   *   并且**机检**：「出现在 ≥2 个 [B] 里的字段名」是否都在术语表里。
   *   ★ 只检这一个方向 —— 表里有词暂时没人用是**允许的**（那是"待采用的标准词"），不算腐。
   */
  const terms = TERMS;   // ★ 复用模块级 readTerms()（原先在这里 inline 再读一遍 AST）
  // 共用字段名（入参 ∪ 产物，出现 ≥2 个 [B]）
  const normT = (s) => s.replace(/\s*\|\s*undefined\b/g, '').trim();
  const tally = (getF, getT) => {
    const m = new Map();
    for (const r of rows) {
      const F = getF(r), T = getT(r);
      for (const f of F) {
        const e = m.get(f) ?? { n: 0, ty: new Set() };
        e.n++; e.ty.add(normT(T[f] ?? '?'));
        m.set(f, e);
      }
    }
    return m;
  };
  const inShared = tally((r) => r.input.fields, (r) => r.input.fieldTypes);
  const outShared = tally((r) => r.product.fields, (r) => r.product.fieldTypes);
  const shared = new Set([...[...inShared.entries()], ...[...outShared.entries()]].filter(([, e]) => e.n >= 2).map(([k]) => k));
  const known = new Set(terms.map((t) => t.name));
  const undef = [...shared].filter((k) => !known.has(k)).sort();
  const debt = terms.filter((t) => t.debt);
  const KIND_LABEL = { anchor: 'anchor —— 链的接口（下游能拿它当原料）', receipt: 'receipt —— 回执（人读）', state: 'state —— 状态', context: 'context —— 上下文' };

  console.log(`## 术语表（**规范定义**；生成：\`node scripts/measure_b_contract.mjs --glossary\`）\n`);
  console.log(`> ★ 含义栏是**"从此以后要求它是什么"**，不是现状；现状见 \`docs/b-field-dictionary.md\`。`);
  console.log(`> 覆盖范围：出现在 **≥2 个 [B]** 里的字段名（只服务 1 个 [B] 的私有字段不受约束 —— 实测占 80%）。`);
  console.log(`> ★★ **新写 [B] 时字段名从本表选**；表里没有 ⇒ 要么加进来（写含义），要么它是你这个 [B] 的私有字段。\n`);
  console.log(`**机检**：共用字段名 **${shared.size}** 个 ｜ 表里有定义 **${shared.size - undef.length}** ｜ ★ 未定义 **${undef.length}**`);
  if (undef.length) console.log(`\n⚠️ 未定义的共用字段名：${undef.map((k) => `\`${k}\``).join(' ')}`);
  console.log(`\n**债务**：\`debt: true\` **${debt.length}** 条（棘轮：只许减不许增）。\n`);
  for (const kind of ['anchor', 'receipt', 'state', 'context']) {
    const g = terms.filter((t) => t.kind === kind);
    if (!g.length) continue;
    console.log(`### ${KIND_LABEL[kind]}\n`);
    console.log('| 术语 | 类型 | 定义 | 债 |');
    console.log('|---|---|---|---|');
    for (const t of g) {
      console.log(`| \`${t.name}\`${t.debt ? ' ★' : ''} | \`${t.type}\` | ${t.meaning} | ${t.fix ? `**${t.fix}**` : ''} |`);
    }
    console.log('');
  }
  if (undef.length) process.exitCode = 1;
} else if (process.argv.includes('--dict')) {
  /**
   * ★ 字段字典（**机器生成，不手抄**）：把 42 个 [B] 的入参/产物字段全枚举出来，
   *   并机械判定三件事：
   *     ① 真·共用 = 同名 + **类型唯一** + 出现 ≥2 个 [B] ⇒ 可以直接进通用形态
   *     ② ★ 同名不同型 = 同名但类型有 ≥2 种 ⇒ **必须人核语义**（就是"同名不同义"的机器证据）
   *     ③ 只出现在 1 个 [B] 的字段 = 领域字段（用户原话：「它只是为了它这一个功能服务的」）
   *   ★ 语义**不由本脚本判定** —— 它只把"名字 + 类型 + 出处"摆出来，结论要人读（见文件头反例）。
   */
  const build = (side, getFields, getTypes) => {
    const m = new Map();
    for (const r of rows) {
      const fields = getFields(r);
      const types = getTypes(r);
      for (const f of fields) {
        const e = m.get(f) ?? { count: 0, types: new Map(), where: [] };
        e.count += 1;
        const t = normType(types[f] ?? '?');
        e.types.set(t, (e.types.get(t) ?? 0) + 1);
        e.where.push(r.name);
        m.set(f, e);
      }
    }
    return m;
  };
  const dump = (title, m, getFields, getTypes) => {
    const all = [...m.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
    const shared = all.filter(([, e]) => e.count >= 2);
    const unique = all.filter(([, e]) => e.count === 1);
    const multiType = shared.filter(([, e]) => e.types.size >= 2);
    console.log(`\n## ${title}（共 ${all.length} 个字段名）\n`);
    console.log(`- 真·共用（同名 + 类型唯一 + ≥2 个 [B]）：**${shared.length - multiType.length}**`);
    console.log(`- ★ 同名**不同型**（必须人核语义）：**${multiType.length}**`);
    console.log(`- 只出现在 1 个 [B]（= 领域字段）：**${unique.length}**\n`);
    console.log('| 字段名 | [B] 数 | 类型（出现次数） | 判定 |');
    console.log('|---|---:|---|---|');
    for (const [f, e] of all) {
      if (e.count === 1) continue;
      const ts = [...e.types.entries()].map(([t, n]) => (e.types.size > 1 ? `\`${t}\`×${n}` : `\`${t}\``)).join(' ／ ');
      const verdict = e.types.size >= 2 ? '★ 同名不同型' : '共用候选';
      console.log(`| \`${f}\` | ${e.count} | ${ts} | ${verdict} |`);
    }
    console.log('\n★ 同名不同型的**全部出处**（逐个看语义）：\n');
    for (const [f, e] of multiType) {
      console.log(`- \`${f}\``);
      for (const [t, n] of e.types) {
        const who = rows.filter((r) => getFields(r).includes(f) && normType(getTypes(r)[f] ?? '?') === t).map((r) => r.name);
        console.log(`    - \`${t}\` ×${n} ⇒ ${who.join(', ')}`);
      }
    }
    console.log('\n★ 只服务 1 个 [B] 的字段（领域字段，**不动**）：');
    console.log('  ' + unique.map(([f]) => f).join(', '));
  };
  console.log('# [B] 字段字典（**机器生成**；重生成：`node scripts/measure_b_contract.mjs --dict`）');
  console.log(`\n人群：${rows.length} 个 [B]（= application/** 里"导出函数名==文件名camelCase"的导出函数）`);
  const IN_F = (r) => r.input.fields;
  const IN_T = (r) => r.input.fieldTypes;
  const OUT_F = (r) => r.product.fields;
  const OUT_T = (r) => r.product.fieldTypes;
  dump('入参字段', build('in', IN_F, IN_T), IN_F, IN_T);
  dump('产物字段', build('out', OUT_F, OUT_T), OUT_F, OUT_T);
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
  console.log(`★ 产物字段组合：${outShapes.size} 种 / ${rows.length} 个 [B]；**字段集合完全相同**的只有 ${shared.length} 种`);
  if (shared.length) for (const [k, n] of shared) console.log(`     ×${n}  {${k}}`);
  // ★★ 单列「按字段的覆盖率」：**这才是"能不能接链"的判据**。
  //    上面那行是"字段集合完全相同的组合有几种" —— 它**不是覆盖率**，
  //    2026-10-05 实测：我曾把 `×2 {data,message,touched}` 读成"只有 2 个 [B] 带 touched"，
  //    真相是 30/37（见下）。★ 摘要容易被误读 ⇒ 把真正的判据摆在它旁边。
  const cov = (where, keys) =>
    keys.map((k) => `${k} ${rows.filter((r) => (r[where].fields ?? []).includes(k)).length}/${rows.length}`).join(' · ');
  console.log('★★ 按字段覆盖率（★ 这一行才是"能不能接链"的判据）：');
  console.log(`   产物端：${cov('product', ['touched', 'project_dir', 'feature', 'written_files', 'symbols', 'nodes'])}`);
  console.log(`   入参端：${cov('input', ['project_dir', 'feature', 'files', 'symbols', 'file', 'node_id'])}`);
  console.log('   ⇒ ★ 入参端**没有一个**收 `touched` 这个对象；两端只共享**扁平字段名**（project_dir / feature …）');
  console.log('   ⇒ ★ 也就是说：产物端把作用域塞进 `touched`，入参端却只认平铺的 — 这正是"链要手工拼"的地方。');
  // ★★★ 关键：上面那一节的产物字段是**顶层**的，而 `touched` 是个**对象** ⇒ 它内部的键**上面完全看不到**。
  //   2026-10-05 实测教训：我曾据此断言"`symbols`/`read_files` 产物端 0/37"，**整轮结论作废** ——
  //   而真调一看 `find_references` 的 `touched` = `{project_dir, symbols:["Kk"], read_files:["com/a/Kk.java"]}`。
  //   ⇒ 这一节**必须单列**：扫各 [B] 的 `touchedOf` **函数体**，看它填了哪些键。
  {
    // ★ 2026-10-05：补上 `file` —— 原 `definition_file` 已改名（见 T54）。★ 此前这个数组**不含**它，
    //   所以本节**一直量不到**那个字段的产出（盲区）；改名时一并补上。
    const KEYS = ['feature', 'project_dir', 'written_files', 'symbols', 'nodes', 'file'];
    /**
     * ★★ 匹配口径（2026-10-05 修）：**按"字段访问 / 属性键"匹配，不按裸词**。
     *   旧实现是 `new RegExp('\\b' + k + '\\b')` —— 那会把**局部变量、注释、入参名**也算进来（量到影子）。
     *   实测：刚给 `file` 补进 KEYS 时就报出 `file 7/31`，而真实产者只有 1 个
     *   （`find_references.ts` 的 `touched.file = …`）⇒ 其余 6 个是 `const file = …` / `r.definition.file` 之类。
     *   ⇒ 现在要求命中以下任一种形态（[B] 的 `touchedOf` 只会用这两种写法）：
     *     · `touched.<键>`（赋值式）
     *     · `<键>:` 或 `{ <键>,`（对象字面量式 —— `return { … }` 或 `withTouched(r, { … })`）
     */
    const hitOf = (body, k) =>
      new RegExp(`touched\\.${k}\\b`).test(body) || new RegExp(`(?:^|[{,\\s])${k}\\s*[,:}]`, 'm').test(body);
    const bodyOf = (src) => {
      const i = src.indexOf('touchedOf');
      if (i < 0) return null;
      const rest = src.slice(i);
      const end = rest.indexOf('\n}\n');
      return end > 0 ? rest.slice(0, end) : rest.slice(0, 3000);
    };
    const hits = [];
    for (const f of files) {
      const sf = program.getSourceFile(f);
      const body = bodyOf(sf ? sf.getFullText() : '');
      if (!body) continue;
      hits.push({ f: path.relative(ROOT, f).replace(/\\/g, '/'), got: KEYS.filter((k) => hitOf(body, k)) });
    }
    console.log(`★★★ \`touched\` **内部各键**的产出覆盖（扫 \`touchedOf\` 函数体；${hits.length} 个 [B] 有它）：`);
    for (const k of KEYS) {
      console.log(`     ${k.padEnd(15)} ${String(hits.filter((h) => h.got.includes(k)).length).padStart(2)} / ${hits.length}`);
    }
    console.log('     ⇒ ★ 这一个读数**上面几节都量不到** —— 上方"产物字段"只到 `touched` 这一层为止，不会下钻。');
    console.log('');
  }
  // ★★ 接力键：词表里 `kind === 'anchor'` 的词在两端各覆盖多少；以及**不在词表**的候选异名。
  //    ★ 2026-10-05（T54 第一步）：本节的目的是把"该收口的名字"**机械列出来**，
  //      替代原先那份**手抄的** `ANCHOR_CANDIDATES`（它会腐：里面留着已删家族的 `box_dir`/`brick_dir`/`slim_dir`）。
  const tally = (get) => {
    const m = new Map();
    for (const r of rows) for (const f of get(r) ?? []) m.set(f, (m.get(f) ?? 0) + 1);
    return m;
  };
  const prodNames = tally((r) => r.product.fields);
  const inNames = tally((r) => r.input.fields);
  console.log('★★ 接力键（词表 `kind: "anchor"` 的词）两端覆盖：');
  for (const k of [...ANCHOR_NAMES].sort()) {
    console.log(`     ${k.padEnd(16)} 入参 ${String(inNames.get(k) ?? 0).padStart(2)} · 产物 ${String(prodNames.get(k) ?? 0).padStart(2)}`);
  }
  const odd = (m) => [...m.entries()].filter(([n, c]) => !TERM_NAMES.has(n) && c >= 2).sort((a, b) => b[1] - a[1]);
  const op = odd(prodNames);
  const oi = odd(inNames);
  console.log(`★ 候选异名（**不在词表**、且出现在 ≥2 个 [B]）：产物侧 ${op.length} 个 · 入参侧 ${oi.length} 个`);
  if (op.length) console.log(`     产物：${op.map(([n, c]) => `${n}×${c}`).join(' · ')}`);
  if (oi.length) console.log(`     入参：${oi.map(([n, c]) => `${n}×${c}`).join(' · ')}`);
  console.log('     ⇒ ★ 这些要么**登记进词表**、要么**收口到已有的 anchor**（同义异名 = 判据分叉）');
  const retiredIn = (m) => [...new Set([...m.keys()].filter((n) => RETIRED_NAMES.has(n)))];
  console.log(`★ **已退役词**的使用 —— 产物侧：${retiredIn(prodNames).join(' · ') || '（无 ✓）'} ｜ 入参侧：${retiredIn(inNames).join(' · ') || '（无）'}`);
  console.log('     ⇒ ★ 词表的"退役"多数是**分侧**的（例：`files` 是**产物侧**退役 —— 产物必须用 `written_files`，');
  console.log('        而**入参侧**"限定本次处理哪几个文件"是正当用法）⇒ 两边分开看，别把入参侧的合法用法读成违规。');
  console.log('');
  const noAnchor = rows.filter((r) => !r.product.anchors?.length);
  console.log(`★ 产物里**没有任何锚点候选字段**的 [B]：${noAnchor.length}/${rows.length}（下游最难接）`);
  console.log(`     ${noAnchor.map((r) => r.name).join(', ')}`);
  console.log('');
  console.log('（细节：--anchors 看锚点候选 + 类型；--json 拿全部）');
}
