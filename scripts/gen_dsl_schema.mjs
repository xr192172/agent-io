#!/usr/bin/env node
/**
 * schema:gen —— **从 `domain/geometry.ts#Node` 生成 `definitions.Node`**（唯一源头 → 契约）
 *
 * ## 为什么需要它（2026-10-27）
 * `schema/design_dsl.schema.json` 的 `definitions.Node` 是**手写的**，而且**已经漂了**：
 *   实测它只有 id/label/path/x/y/width/height/layer/host/shapes/style/task
 *   ⇒ 缺 type / status / gate / decision / content / sub_dsl / attributes … 且缺 `title`
 * 而这份 schema 被 **6 处 src 引用**（`validator.ts` 用它校验 DSL）⇒ **漂移是承重的**。
 *
 * ## 为什么用 `typescript` 的 checker 而不是 tree-sitter
 * tree-sitter 只能看到**字段名 + 类型名**，看不到：
 *   · `Partial<X>` / `Pick<X,'a'>` 的**展开结果**
 *   · 交叉类型 `A & B` 的合并
 *   · 类型别名链
 * ⇒ `checker.getPropertiesOfType()` **直接给出解析后的属性表** —— 这就是"真契约"。
 *   （★ 这也回答了「AST 能不能推」：**语法层能拿字段名，语义层才拿得到展开结果**。）
 *
 * ## 用法
 *   node scripts/gen_dsl_schema.mjs           # 生成并写回 schema/design_dsl.schema.json 的 definitions.Node
 *   node scripts/gen_dsl_schema.mjs --check   # 只比对不写（可当门）
 *   node scripts/gen_dsl_schema.mjs --json    # 打印生成的 Node 定义
 *
 * ★ 只重写 `definitions.Node` 一个定义（其余定义手工维护，未接管）—— **一次只接管一格**，
 *   避免一次性重写整份 schema 造成大面积 diff。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const SCHEMA_FILE = path.join(ROOT, 'schema', 'design_dsl.schema.json');
const CHECK = process.argv.includes('--check');
const JSON_OUT = process.argv.includes('--json');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
};

const program = ts.createProgram(walk(SRC), {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();

/** 找 `interface Node` 的声明 */
let nodeDecl;
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (!sf.fileName.replace(/\\/g, '/').endsWith('src/domain/geometry.ts')) continue;
  ts.forEachChild(sf, (n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'Node') nodeDecl = n;
  });
}
if (!nodeDecl) {
  console.error('[schema:gen] ✗ 找不到 `interface Node`（src/domain/geometry.ts）');
  process.exit(2);
}

/** TS 类型 → JSON Schema 片段（★ 只覆盖本仓 Node 实际用到的形态，遇到不认识的**如实报**） */
const defs = {}; // 名字 → schema（递归收集被引用的具名类型）
const unknownKinds = new Set();

function namedOf(type) {
  const sym = type.getSymbol?.() ?? type.aliasSymbol;
  return sym && sym.name && sym.name !== '__type' && sym.name !== '__object' ? sym.name : undefined;
}

function mapType(type) {
  // union
  if (type.isUnion()) {
    const isNull = (t) => !!(t.flags & ts.TypeFlags.Null);
    const hasNull = type.types.some(isNull);
    // `undefined` 仍剥（"可选"由 required 列表表达）；**`null` 不剥** —— 见下方说明
    const parts = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined) && !isNull(t));
    const base =
      parts.length === 0 ? { type: 'null' } : parts.length === 1 ? mapType(parts[0]) : { anyOf: parts.map(mapType) };
    // ★★★ 2026-10-27（**T360 红十条的真因**）：`X | null` 里的 null **不许被剥掉**。
    //   病史：本行原先把 Null 一起 filter 掉 ⇒ `prepared_snapshot?: PreparedSnapshot | null` 在 schema 里
    //   变成"只允许 object" ⇒ 两段式领取用 `prepared_snapshot: null` 表示"删掉快照"的**合法写入**
    //   被判 `[type] … must be object` ⇒ 自洽性闸拒提交 ⇒ `t360` 的 B5/B6/B7 与 C2–C8 全红
    //   （而 gate 里那张红一直挂着，每次都被当"基线红"放过）。
    //   ⇒ TS 类型说可以为 null，schema 就必须允许 null：`anyOf: [<非空分支…>, {type:'null'}]`。
    if (!hasNull) return base;
    if (parts.length === 0) return { type: 'null' };
    return { anyOf: [...(base.anyOf ?? [base]), { type: 'null' }] };
  }
  // 字面量
  if (type.isStringLiteral?.()) return { const: type.value };
  if (type.isNumberLiteral?.()) return { const: type.value };
  // 原始
  const F = ts.TypeFlags;
  if (type.flags & F.String) return { type: 'string' };
  if (type.flags & F.Number) return { type: 'number' };
  if (type.flags & F.Boolean || type.flags & F.BooleanLiteral) return { type: 'boolean' };
  if (type.flags & F.Any || type.flags & F.Unknown) return {}; // 任意 ⇒ 空 schema
  // 数组
  if (checker.isArrayType?.(type)) {
    const el = checker.getTypeArguments(type)[0];
    return { type: 'array', items: mapType(el) };
  }
  // 具名类型 ⇒ 递归定义 + $ref
  const name = namedOf(type);
  const props = checker.getPropertiesOfType(type);
  if (props.length > 0) {
    if (name && !defs[name]) {
      defs[name] = {}; // 占位防环
      defs[name] = objectSchema(type);
    }
    return name ? { $ref: `#/definitions/${name}` } : objectSchema(type);
  }
  // 索引签名（Record<K,V>）
  const strIdx = checker.getIndexTypeOfType?.(type, ts.IndexKind.String);
  if (strIdx) return { type: 'object', additionalProperties: mapType(strIdx) };
  unknownKinds.add(`${ts.TypeFlags[type.flags] ?? type.flags}${name ? ` (${name})` : ''}`);
  return {};
}

function objectSchema(type) {
  const props = checker.getPropertiesOfType(type);
  const properties = {};
  const required = [];
  for (const p of props) {
    const pt = checker.getTypeOfSymbolAtLocation(p, nodeDecl);
    const optional = (p.flags & ts.SymbolFlags.Optional) !== 0;
    properties[p.name] = mapType(pt);
    if (!optional) required.push(p.name);
  }
  const out = { type: 'object', properties };
  if (required.length) out.required = required.sort();
  return out;
}

const nodeType = checker.getTypeAtLocation(nodeDecl.name);
const nodeSchema = objectSchema(nodeType);
if (JSON_OUT) {
  console.log(JSON.stringify({ Node: nodeSchema, extraDefs: Object.keys(defs) }, null, 2));
  process.exit(0);
}

const generated = {
  description: `★ **自动生成**（scripts/gen_dsl_schema.mjs ← src/domain/geometry.ts#Node）。不要手改。`,
  ...nodeSchema,
};

// 与现状比对
const current = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
const curNode = current.definitions?.Node;
const curProps = Object.keys(curNode?.properties ?? {}).sort();
const newProps = Object.keys(generated.properties ?? {}).sort();
const missing = newProps.filter((p) => !curProps.includes(p));
const extra = curProps.filter((p) => !newProps.includes(p));

if (CHECK) {
  const ok = missing.length === 0 && extra.length === 0;
  console.log(`[schema:gen] definitions.Node：生成 ${newProps.length} 字段 · 现状 ${curProps.length} 字段`);
  if (!ok) {
    if (missing.length) console.log(`  ✗ 现状**缺** ${missing.length} 个：${missing.join(', ')}`);
    if (extra.length) console.log(`  ✗ 现状**多** ${extra.length} 个：${extra.join(', ')}`);
    console.log('  ⇒ 跑 `npm run schema:gen` 重生成');
  } else {
    console.log('  ✓ 与 Node 逐字段一致');
  }
  if (unknownKinds.size) console.log(`  ⚠ 未识别的类型形态（如实报）：${[...unknownKinds].join(' · ')}`);
  process.exit(ok ? 0 : 1);
}

current.definitions = current.definitions ?? {};
current.definitions.Node = generated;
// 被递归引用到的具名类型：**已存在 ⇒ diff 后更新**（★ 第⑤项修复 2026-11-10：原先 `continue` 跳过
//   ⇒ NodeDecision 等生成定义**永不更新**——expectation 类型演进后 schema 停在旧版，
//   新形态判据（journey-cases/fakes）写进册被 ajv 拒（实测：schema 双形态修复被迫手改 dist））。
//   diff 相同 ⇒ 不写（mtime 不抖）；不同 ⇒ 覆盖 + 计数（评审可看见"更新了谁"）。
let added = 0;
let updated = 0;
const updatedNames = [];
for (const [name, schema] of Object.entries(defs)) {
  if (!current.definitions[name]) {
    current.definitions[name] = { description: '★ 自动生成（被 Node 引用）', ...schema };
    added++;
    continue;
  }
  const prev = JSON.stringify(current.definitions[name]);
  const next = JSON.stringify({ description: current.definitions[name].description, ...schema });
  if (prev === next) continue;
  current.definitions[name] = { description: current.definitions[name].description, ...schema };
  updated++;
  updatedNames.push(name);
}
fs.writeFileSync(SCHEMA_FILE, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
console.log(
  `[schema:gen] ✓ 已写 definitions.Node（${newProps.length} 字段，缺 ${missing.length} → 补、多 ${extra.length} → 删）` +
    `；新增被引用定义 ${added} 个` +
    (updated ? `；**更新已存在定义 ${updated} 个**：${updatedNames.join(', ')}` : ''),
);
if (unknownKinds.size) console.log(`  ⚠ 未识别的类型形态：${[...unknownKinds].join(' · ')}`);
