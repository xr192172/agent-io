#!/usr/bin/env node
/**
 * ★★★ cert T452 —— **填孔验收的作用域判据**（2026-10-29 · `T-#BODY-SCOPE`）
 *
 * ## 判什么
 * `TS2304 Cannot find name 'retrievers'` 这类错误的根因是 **body 里引用了不存在的名字**
 * （字段裸用 / 骨架少参数 / 拼错）。等 tsc 统计太晚且分不清根因；这里在**填孔验收**阶段就挡。
 *
 * ## 判据
 *   ① 合法体（只用参数/局部/全局）**必须通过**（不误杀）；
 *   ② 裸用未声明名字（`retrievers`）**必须被抓**；
 *   ③ **反向控制**：同一个名字加上声明后**不得**再被抓（判据读的是声明，不是名字长相）；
 *   ④ 属性访问的**属性名**不算引用（`b.retrievers` 不该被抓）；
 *   ⑤ 签名里的**类型名**（`Builder`）不该被抓（类型位置整体跳过）。
 *
 * ## 边界（诚实 · [未核]）
 *   · 全局白名单是**显式列表**，漏了的全局会误报（方向安全：宁可误报也不放过）；
 *   · 闭包/嵌套函数作用域、`with`、动态 `eval`、TS `declare` 合并未建模。
 *
 * ## 用法
 *   npm run build && node certs/t452-body-scope-cert.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { undeclaredNameIssues } = await import(D + 'infrastructure/authoring/translate/verify.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const mk = (name, skeleton) => ({ id: name, kind: 'func', dstLang: 'ts', name, skeleton, srcSnippet: '', srcLine: 1, bodyHole: false, params: [], constraints: [] });

// ① 合法体
{
  const issues = undeclaredNameIssues(
    mk('good', 'export function good(b: Builder, x: number): number {\n  const y = x + 1;\n  return b.retrievers.length + y;\n}\n'),
  );
  chk(issues.length === 0, '① 合法体（参数/局部/属性名/类型名）**通过**', issues.map((i) => i.detail).join(' | '));
}

// ② 裸用未声明名字
{
  const issues = undeclaredNameIssues(
    mk('bad', 'export function bad(b: Builder): number {\n  return retrievers.length;\n}\n'),
  );
  chk(issues.some((i) => /retrievers/.test(i.detail)), '② 裸用未声明名字 `retrievers` **被抓**', issues.map((i) => i.detail).join(' | '));
}

// ③ 反向控制：加上声明后不得再被抓
{
  const issues = undeclaredNameIssues(
    mk('fixed', 'export function fixed(b: Builder): number {\n  const retrievers = b.retrievers;\n  return retrievers.length;\n}\n'),
  );
  chk(issues.length === 0, '③ **反向控制**：同名加上声明后**不再**被抓（读声明，不看名字长相）', issues.map((i) => i.detail).join(' | '));
}

// ④ 属性名不算引用
{
  const issues = undeclaredNameIssues(
    mk('prop', 'export function prop(b: Builder): number {\n  return b.notDeclaredAnywhere;\n}\n'),
  );
  chk(issues.length === 0, '④ **属性名**不算引用（`b.notDeclaredAnywhere` 不该被抓）', issues.map((i) => i.detail).join(' | '));
}

// ⑤ 类型名不查
{
  const issues = undeclaredNameIssues(
    mk('ty', 'export function ty(x: SomeUndeclaredType): SomeUndeclaredType {\n  return x;\n}\n'),
  );
  chk(issues.length === 0, '⑤ 签名里的**类型名**不查（类型位置整体跳过）', issues.map((i) => i.detail).join(' | '));
}

console.log(`\n═══ T452 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
