#!/usr/bin/env node
/**
 * ★★★ cert T437 —— **类型位置由解析器给出，不再"拍平 + 正则扫"**（2026-10-28 · 彻底解 `T-#TERM-PARSE`）
 *
 * ## 病的根源（一句话）
 * 同一份 AST 事实被**两个解读器**读：`ts_codegen` 用真语法树生成代码（对），
 * `unmappedGoTypes` 把类型表达式**拍平成字符串再用标识符正则**扫（错）——
 * 于是形参名 `pattern` / `brain` 被当成"未覆盖术语"，符号被判 `blocked`，
 * 而这两个词**永远补不进术语表** ⇒ **不可修的 blocked**。这就是"第二处权威"的实际伤害。
 *
 * ## 修法
 * 新增 `typeIdents(expr)`：一个**按 Go 类型文法**走的解析器（分词 + 递归下降），
 * 只收集**类型位置**的标识符；形参名 / 字段名 / 方法名一律不收。
 * `unmappedGoTypes` 改为吃它的输出（不再是正则扫）。
 *
 * ## 判据（逐例可读，全部亲手跑）
 *   ① 单元级：8 个刁钻类型表达式，各自**只应吐出类型名**（见用例表）；
 *   ② 端到端：夹具 `func(pattern string, brain string) bool` 的节点 ⇒ **零未覆盖术语**；
 *   ③ **防过度修复**：`Channel` 未声明/未覆盖时**仍被抓**（不是"什么都不报"）；
 *   ④ 泛型参数 `T` 仍不算术语（既有口径不回归）；
 *   ⑤ 静态守卫：`unmappedGoTypes` 里**不再有**"匹配标识符的正则扫"，且确实调用 `typeIdents`。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖**类型表达式片段**（cache.db 里 `params[].type` / `return_type` / `members[].type` 那种），
 *     **不是**完整 Go 源码解析；
 *   · **[未核]** 更刁的写法：类型约束里的联合 `~int | ~string`、嵌套匿名 struct 的 tag、
 *     泛型约束 `T interface{ ~int }` —— 夹具未覆盖，行为未断言；
 *   · 不改变 `typeExpressions`（另有两处消费者用它做分类/术语命中），只改 `unmappedGoTypes` 的解读方式。
 *
 * ## 用法
 *   node certs/t437-type-position-parser-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
process.env.AGENT_IO_REQUIRE_PLAN = '0';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const { unmappedGoTypes, typeIdents } = await import(D + 'infrastructure/authoring/translate/book.js');

// ── ① 单元级：8 个刁钻表达式 ──────────────────────────
const CASES = [
  ['func(pattern string, brain string) bool', ['string', 'bool'], ['pattern', 'brain']],
  ['map[string]func(x, y int) []Widget', ['Widget'], ['x', 'y']],
  ['struct { Key string; N int; Sub Inner }', ['Inner'], ['Key', 'N', 'Sub']],
  ['interface { Do(a int) error }', ['error'], ['Do', 'a']],
  ['Channel[T]', ['Channel', 'T'], []],
  ['chan<- *Item', ['Item'], []],
  ['func(a, b int) (Result, error)', ['Result'], ['a', 'b']],
  ['(map[string][]int, error)', ['error'], []],
];
for (const [expr, must, mustNot] of CASES) {
  const got = typeIdents(expr);
  const okMust = must.every((x) => got.includes(x));
  const okNot = mustNot.every((x) => !got.includes(x));
  chk(okMust && okNot, `① \`${expr}\``, `→ ${JSON.stringify(got)}`);
}

// ── ② 端到端：夹具节点零未覆盖术语 ────────────────────
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'typeparse-'));
fs.writeFileSync(
  path.join(proj, 'x.go'),
  `package main

func UseFunc(fn func(pattern string, brain string) bool, n int) (map[string][]int, error) { return nil, nil }

func UseChan[T any](c Channel[T]) T { var z T; return z }
`,
);
await TOOL_DEFS.find((t) => t.name === 'import_project').handler({ project_dir: proj, feature: 'tp' });
const db = new DatabaseSync(path.join(proj, '.agent-io', 'cache.db'), { readOnly: true });
const rows = db
  .prepare("select id, kind, name, file_path, start_line, parent, signature, docstring, qualified_name, language, end_line, return_type, params, members, type_params, modifiers from nodes where language='go' and kind='function'")
  .all();
const byName = (n) => rows.find((r) => r.name === n);

{
  const bad = unmappedGoTypes(byName('UseFunc'), new Set(), new Set());
  chk(!bad.includes('pattern') && !bad.includes('brain'), '② 端到端：`func(pattern, brain)` 的节点**零假术语**', `实际：${bad.join(', ') || '(无)'}`);
}
{
  const bad = unmappedGoTypes(byName('UseChan'), new Set(), new Set());
  chk(bad.includes('Channel'), '③ **防过度修复**：`Channel` 未声明时**仍被抓**', `实际：${bad.join(', ') || '(无)'}`);
  chk(!bad.includes('T'), '④ 泛型参数 `T` 仍**不算术语**', `实际：${bad.join(', ')}`);
}

// ── ⑤ 静态守卫：正则扫已撤 ────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/authoring/translate/book.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export function unmappedGoTypes'), src.indexOf('export function unmappedGoTypes') + 1200);
  chk(/typeIdents\(/.test(fn), '⑤ `unmappedGoTypes` **确实调用 `typeIdents`**');
  chk(!/matchAll\(\/\[A-Za-z_\]/.test(fn), '⑤-b `unmappedGoTypes` 里**不再有**"匹配标识符的正则扫"');
  chk(/export function typeIdents/.test(src), '⑤-c `typeIdents` 已导出（可单测）');
}

console.log(`\n═══ T437 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
