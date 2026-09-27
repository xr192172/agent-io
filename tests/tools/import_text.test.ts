/**
 * import_text（文本级 import 解析）—— 权威单测（B1，2026-09-28）
 *
 * 背景：这段逻辑曾在 `cli_extract.ts` 与 `registry_extract.ts` 里**逐字相同**地存在两份，
 * 而**只有 registry 那份有测试**（`tests/tools/registry_extract.test.ts`），cli 那份没有 ——
 * 覆盖不对称正是副本能悄悄分叉的原因。
 * ⇒ 收敛到 `ts_kernel/import_text.ts` 后，用本文件直接测**权威**，一次覆盖两个消费者。
 */
import { describe, it, expect } from 'vitest';
import { parseRelativeNamedImportMap } from '../../src/tools/ts_kernel/import_text.js';

describe('parseRelativeNamedImportMap', () => {
  it('基本形：symbol → 去掉 ./ 与 .js 的模块串', () => {
    const src = `import { a, b } from './tools/x.js';`;
    const m = parseRelativeNamedImportMap(src);
    expect(m.get('a')).toBe('tools/x');
    expect(m.get('b')).toBe('tools/x');
  });

  it('★ 别名：远名与本地名**都收**（补上潜伏缺口，见权威模块的说明）', () => {
    const m = parseRelativeNamedImportMap(`import { a as c, d } from './y.js';`);
    expect([...m.keys()].sort()).toEqual(['a', 'c', 'd']);
    expect(m.get('a')).toBe('y'); // 旧行为保留（远名可用）
    expect(m.get('c')).toBe('y'); // ★ 新行为：本地名也可用 —— 消费者要的是这个
    expect(m.get('d')).toBe('y');
  });

  it('多行 import（含别名）', () => {
    const src = `import {\n  alpha,\n  beta as b2,\n} from './multi/mod.js';`;
    const m = parseRelativeNamedImportMap(src);
    expect([...m.keys()].sort()).toEqual(['alpha', 'b2', 'beta']);
  });

  it('import type 也认（可擦除但仍是源码事实）', () => {
    const m = parseRelativeNamedImportMap(`import type { T } from './types.js';`);
    expect(m.get('T')).toBe('types');
  });

  it('非相对（裸包名）不认 —— 这是适用边界，不是漏判', () => {
    expect(parseRelativeNamedImportMap(`import { z } from 'zod';`).size).toBe(0);
  });

  it('默认导入 / 命名空间导入不认（需走 kernel 的 AST 路径）', () => {
    expect(parseRelativeNamedImportMap(`import fs from './fs.js';`).size).toBe(0);
    expect(parseRelativeNamedImportMap(`import * as ns from './ns.js';`).size).toBe(0);
  });

  it('export … from 不算 import（不同语句）', () => {
    expect(parseRelativeNamedImportMap(`export { a } from './a.js';`).size).toBe(0);
  });

  it('非法标识符被过滤（不污染映射）', () => {
    const m = parseRelativeNamedImportMap(`import { ok, 'bad-str', 123 } from './m.js';`);
    expect([...m.keys()]).toEqual(['ok']);
  });

  it('同一符号后出现者覆盖（与原先两份实现一致）', () => {
    const src = `import { a } from './first.js';\nimport { a } from './second.js';`;
    expect(parseRelativeNamedImportMap(src).get('a')).toBe('second');
  });

  it('空输入 / 无 import → 空映射', () => {
    expect(parseRelativeNamedImportMap('').size).toBe(0);
    expect(parseRelativeNamedImportMap('const x = 1;\n').size).toBe(0);
  });
});
