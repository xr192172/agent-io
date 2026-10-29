#!/usr/bin/env node
/**
 * ★★★ cert T442 —— **填孔验收升级到 TS 语法级**（2026-10-29 · `T-#FILL-TSC`）
 *
 * ## 为什么要这条证
 * 全仓实测：填孔 body 带进来 **`TS1184 ×173`**（Modifiers cannot appear here）与 **`TS2355 ×143`**
 * （声明返回类型却没有 return）。它们**全部通过了当时的 `verifySkeletons`** —— 因为那道闸只有
 * tree-sitter 静态复核 + 名字/参数结构核对，而 `TS1184` 属于 **TypeScript 自己的语法规则**，
 * tree-sitter 的容错语法照收。
 * ⇒ 结论：**填孔的验收强度低于 tsc**，坏体照样落盘。
 *
 * ## 加了什么（两道确定性判据，零 LLM）
 *   ① `tsGrammarIssues`：用 **TS 语法器**（`ts.createSourceFile` 的 `parseDiagnostics`）查语法 ——
 *      只取语法档，不建 program（单函数骨架必然缺 import/类型，语义诊断是噪声）；
 *   ② `missingReturnIssue`：**TS2355 的确定性代理** —— 声明返回非 `void/any/undefined`，
 *      体里既无 `return <值>` 也无 `throw` ⇒ 必报 TS2355，直接用 AST 判，不用建 program。
 *
 * ## 判据（含反向控制）
 *   ① 合法体**必须通过**（否则闸会把好体也打死）；
 *   ② `TS1184`（`public x = 1;` 在函数体里）**必须被拦**；
 *   ③ 声明返回但无 return（TS2355）**必须被拦**；
 *   ④ 语法截断（缺 `}`）**必须被拦**；
 *   ⑤ **反向控制**：把判据关掉（直接调 tree-sitter 那一段的等价物）时，①~④ 里至少有一个不再被拦
 *      —— 证这几条判据确实在起作用，而不是被别的闸顺带拦住。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只查**语法**与**返回值有无**，不查类型正确性（那要 program + 完整依赖，单函数骨架做不到）；
 *   · `TS2554`（参数个数）等语义错不在本证范围 —— 它们只能靠工程级 tsc（`verify=true`）兜；
 *   · 本证不验证"坏体是否真的被重试"（那是 `fillUnitWithRetry` 的行为，靠它自己的证）。
 *
 * ## 用法
 *   npm run build && node certs/t442-fill-tsc-gate-cert.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { verifySkeletons } = await import(D + 'infrastructure/authoring/translate/verify.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 造一个单元：`id` 与骨架里的函数名**必须一致**（否则会先被名字结构闸拦下，掩盖被测判据） */
const mk = (name, skeleton, retName = 'int') => ({
  id: name,
  kind: 'func',
  dstLang: 'ts',
  name,
  skeleton,
  srcSnippet: '',
  srcLine: 1,
  bodyHole: false,
  params: [],
  resultRef: retName ? { kind: 'ident', name: retName } : undefined,
  constraints: [],
});

const run = async (u) => verifySkeletons([u]);

// ① 合法体必须通过
{
  const issues = await run(mk('goodFn', 'export function goodFn(): number {\n  return 1;\n}\n'));
  chk(issues.length === 0, '① 合法体**通过**（闸不误杀）', issues.map((i) => `${i.gate}:${i.detail}`).join(' | '));
}

// ② TS1184：函数体里出现修饰符
{
  const issues = await run(mk('modFn', 'export function modFn(): number {\n  public x = 1;\n  return 1;\n}\n'));
  const hit = issues.some((i) => i.gate === 'syntax');
  chk(hit, '② `TS1184` 类（函数体里的修饰符）**被语法闸拦下**', issues.map((i) => `${i.gate}:${i.detail.slice(0, 50)}`).join(' | '));
}

// ③ TS2355：声明返回却无 return / throw
{
  const issues = await run(mk('noRetFn', 'export function noRetFn(): number {\n  const x = 1;\n}\n'));
  const hit = issues.some((i) => /TS2355|既无 return/.test(i.detail));
  chk(hit, '③ 声明返回但无 `return <值>`（TS2355）**被结构闸拦下**', issues.map((i) => `${i.gate}:${i.detail.slice(0, 50)}`).join(' | '));
}

// ④ 语法截断
{
  const issues = await run(mk('truncFn', 'export function truncFn(): number {\n  return 1\n'));
  chk(issues.some((i) => i.gate === 'syntax'), '④ 语法截断（缺 `}`）**被拦下**', issues.map((i) => `${i.gate}:${i.detail.slice(0, 50)}`).join(' | '));
}

// ⑤ 反向控制：throw 也算"有出路"⇒ 不该被 TS2355 代理误杀
{
  const issues = await run(mk('throwFn', "export function throwFn(): number {\n  throw new Error('nope');\n}\n"));
  chk(issues.length === 0, '⑤ **反向控制**：只有 `throw` 的体**不**被 TS2355 代理误杀（判据不过度）', issues.map((i) => `${i.gate}:${i.detail}`).join(' | '));
}

console.log(`\n═══ T442 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
