#!/usr/bin/env node
/**
 * ★★★ cert T436 —— **函数类型的形参名不许被当成"未覆盖术语"**（假 blocked 回归）（2026-10-28）
 *
 * ## 病（实测复现，不是推测）
 * `typeExpressions()` 把结构化事实**拍平成字符串**，再交给 `unmappedGoTypes()` 的**标识符正则**扫。
 * 于是一段完全可翻的类型 `func(pattern string, brain string) bool` 会让函数被判 `blocked`，
 * 理由是"术语表未覆盖：**brain, pattern**" —— 而这两个词**永远补不进术语表**（它们是形参名，不是术语）。
 * ⇒ 制造一个**不可修的 blocked**：人无从下手，该修的是解析，不是术语表。
 *
 * ## 判据（冻结夹具 + 直接调执行核）
 *   ① 修后：`func(pattern string, brain string) bool` ⇒ **零未覆盖术语**（`pattern` / `brain` 不再冒头）；
 *   ② **不是"全都不报"**（防过度修复）：`Channel[T]` 且 `Channel` 未声明/未覆盖 ⇒ **仍报 `Channel`**；
 *   ③ 泛型参数 `T` **不算术语**（既有行为不回归）；
 *   ④ 静态守卫：`stripFuncParamNames` 存在，且 `typeExpressions` 的三个来源都过了它。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 `func(...)` **形参名**这一种假阳性；**[未核]** 其它拍平失真（如匿名 struct 字面量的字段名、
 *     复杂嵌套 `map[string]func(...)` 里的名字）—— 彻底解法是"类型位置由解析器给"，见 todo；
 *   · 本仓 126 个 go 函数/方法里实测 **0 个**触发本 bug（本仓 go 代码没有 func 类型形参）
 *     ⇒ 它是**潜在** bug，不是正在发生的 bug。
 *
 * ## 用法
 *   node certs/t436-false-blocked-cert.mjs      # ★ 先 npm run build
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
const { unmappedGoTypes, typeExpressions } = await import(D + 'infrastructure/authoring/translate/book.js');

// ── 冻结夹具 ─────────────────────────────────────────
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'terms-'));
fs.writeFileSync(
  path.join(proj, 'x.go'),
  `package main

func UseFunc(fn func(pattern string, brain string) bool, n int) (map[string][]int, error) { return nil, nil }

func UseChan[T any](c Channel[T]) T { var z T; return z }

func Plain(a int) string { return "" }
`,
);
await TOOL_DEFS.find((t) => t.name === 'import_project').handler({ project_dir: proj, feature: 'sp' });
const db = new DatabaseSync(path.join(proj, '.agent-io', 'cache.db'), { readOnly: true });
const rows = db
  .prepare("select id, kind, name, file_path, start_line, parent, signature, docstring, qualified_name, language, end_line, return_type, params, members, type_params, modifiers from nodes where language='go' and kind='function'")
  .all();
const byName = (n) => rows.find((r) => r.name === n);

// ── ① 形参名不再是"术语" ─────────────────────────────
{
  const r = byName('UseFunc');
  const bad = unmappedGoTypes(r, new Set(), new Set());
  chk(!bad.includes('pattern') && !bad.includes('brain'), '① **`func(pattern, brain)` 的形参名不再被判为未覆盖术语**', `实际：${bad.join(', ') || '(无)'}`);
}

// ── ② 不是"全都不报" ────────────────────────────────
{
  const r = byName('UseChan');
  const bad = unmappedGoTypes(r, new Set(), new Set());
  chk(bad.includes('Channel'), '② **真术语仍被抓**：`Channel` 未声明/未覆盖 ⇒ 仍报（防过度修复）', `实际：${bad.join(', ') || '(无)'}`);
  chk(!bad.includes('T'), '③ 泛型参数 `T` **不算术语**（既有口径不回归）', `实际：${bad.join(', ')}`);
}

// ── ④ 静态守卫 ──────────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/authoring/translate/book.ts'), 'utf8');
  chk(/function stripFuncParamNames/.test(src), '④ `stripFuncParamNames` **存在**（剥离只在类型位置，不做全局替换）');
  const te = src.slice(src.indexOf('export function typeExpressions'), src.indexOf('export function typeExpressions') + 900);
  const uses = (te.match(/stripFuncParamNames\(/g) ?? []).length;
  chk(uses >= 3, '④-b `typeExpressions` 的**三个来源**（return_type / params / members）都过了剥离', `实际调用 ${uses} 处`);
}

// ── 附：读数（本仓规模，供对照） ──────────────────────
{
  const repoDb = path.join(ROOT, '.agent-io/cache.db');
  if (fs.existsSync(repoDb)) {
    const rdb = new DatabaseSync(repoDb, { readOnly: true });
    const n = rdb.prepare("select count(*) c from nodes where language='go' and kind in ('function','method') and signature is not null").get().c;
    console.log(`\n（对照读数：本仓 go 函数/方法 ${n} 个；本证夹具 ${rows.length} 个函数）`);
  }
}

console.log(`\n═══ T436 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
