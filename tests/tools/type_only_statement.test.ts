/**
 * type-only 模块语句判定 —— 单元 + 内核集成测试（回归门，2026-09-28）
 *
 * 背景：这条知识（"什么在运行时被整体擦除 ⇒ 依赖图不算边"）原先有**两份**逐字相同的实现：
 *   · `ts_kernel/kernel.ts`   → 喂 db / health / impact / import_project / dead_deps /
 *                               harvest_closure / import_graph / project_root 的 `type_only`
 *   · `rename_symbol.ts:178`  → 自己的 import 边
 * 两份都只有 `/^\s*import\s+type\b/`，于是**同一个盲区在两处各存活一次**：
 * `export type { A } from './x'` 同样被擦除却谁都不认 ——
 * 实测表现为 health 报出 `dsl/types.ts:47 → dsl/contract.ts` 这条假分层违规。
 *
 * 本文件守住两件事：
 *   ① 判定逻辑本身（含**否定用例** —— 混有值绑定时不得误判，否则会把真依赖边丢光）；
 *   ② 内核真的把 `export type … from` 标成 `type_only`（经 parseFileFull 端到端）。
 */

import { describe, it, expect } from 'vitest';
import { isTypeOnlyModuleStatement, parseFileFull } from '../../src/tools/ts_kernel/index.js';

describe('isTypeOnlyModuleStatement: 运行时被整体擦除的写法 → true', () => {
  const CASES: Array<[string, string]> = [
    ['import type 具名', `import type { A } from 'x';`],
    ['import type 默认', `import type A from 'x';`],
    ['import type 命名空间', `import type * as ns from 'x';`],
    ['import type 多行', `import type {\n  A,\n  B,\n} from 'x';`],
    ['export type 具名再导出', `export type { A } from 'x';`],
    ['export type 多说明符', `export type { A, B } from 'x';`],
    ['export type 星号', `export type * from 'x';`],
    ['export type 星号别名', `export type * as ns from 'x';`],
    ['内联 type 全部都是', `import { type A, type B } from 'x';`],
    ['内联 type 带别名', `import { type A as B } from 'x';`],
    ['内联 type 多行', `import {\n  type A,\n  type B\n} from 'x';`],
    ['export 内联 type', `export { type A } from 'x';`],
    ['export 内联 type 带别名', `export { type A as B } from 'x';`],
  ];
  for (const [name, text] of CASES) {
    it(name, () => expect(isTypeOnlyModuleStatement(text)).toBe(true));
  }
});

describe('isTypeOnlyModuleStatement: 仍会产出运行时 import 的写法 → false', () => {
  const CASES: Array<[string, string]> = [
    ['普通具名 import', `import { A } from 'x';`],
    ['默认 import', `import A from 'x';`],
    ['命名空间 import', `import * as ns from 'x';`],
    ['副作用 import', `import './x';`],
    ['混有值绑定（关键否定：全 type 才算擦除）', `import { type A, B } from 'x';`],
    ['export 星号（值再导出）', `export * from 'x';`],
    ['export 具名（值再导出）', `export { A } from 'x';`],
    ['export 混有值绑定', `export { type A, B } from 'x';`],
    ['空说明符', `import {} from 'x';`],
    // 无模块源 ⇒ 不构成依赖边，本判定对其无定义 ⇒ 一律 false（见 kernel 里的"适用边界"注释）。
    // 注意 `export interface A {}` / `export type A = …` 也在运行时被擦除，但它们不 import 任何模块，
    // 故不属本函数的适用对象 —— 这不是漏判。
    ['类型别名声明（无模块源）', `export type A = string;`],
    ['接口声明（无模块源）', `export interface A { x: number }`],
    ['标识符前缀相近：typeX 不是 type（\\b 边界）', `import typeX from 'x';`],
    ['普通声明', `export const a = 1;`],
    ['require 调用（非模块语句）', `const x = require('x');`],
  ];
  for (const [name, text] of CASES) {
    it(name, () => expect(isTypeOnlyModuleStatement(text)).toBe(false));
  }
});

describe('内核集成：parseFileFull 真的把 export type … from 标成 type_only', () => {
  it('三条语句：export type / import type 为 type_only，普通 import 不是', async () => {
    const src = [
      `export type { A } from './a.js';`,
      `import type { B } from './b.js';`,
      `import { C } from './c.js';`,
      ``,
      `export const z = 1;`,
      ``,
    ].join('\n');
    const parsed = await parseFileFull('x.ts', src);
    const bySource = new Map(parsed.imports.map((i) => [i.source, i]));
    expect([...bySource.keys()]).toEqual(['./a.js', './b.js', './c.js']);
    expect(bySource.get('./a.js')!.type_only).toBe(true); // ★ 修复前为 undefined（假违规的根因）
    expect(bySource.get('./b.js')!.type_only).toBe(true);
    expect(bySource.get('./c.js')!.type_only).toBeUndefined(); // 值边必须保留
  });

  it('内联全 type 也标 type_only；混有值绑定则不标', async () => {
    const src = [`import { type A, type B } from './all_type.js';`, `import { type C, D } from './mixed.js';`, ``].join('\n');
    const parsed = await parseFileFull('y.ts', src);
    const bySource = new Map(parsed.imports.map((i) => [i.source, i]));
    expect(bySource.get('./all_type.js')!.type_only).toBe(true);
    expect(bySource.get('./mixed.js')!.type_only).toBeUndefined();
  });

  it('非 TS 语言不受影响（Go 的 import 不会被判 type-only）', async () => {
    const parsed = await parseFileFull('m.go', 'package m\n\nimport "fmt"\n\nfunc F() { fmt.Println(1) }\n');
    for (const imp of parsed.imports) expect(imp.type_only).toBeUndefined();
  });
});
