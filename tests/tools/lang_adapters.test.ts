/**
 * 语言适配器注册表完备性自检：
 *  - 任何在 LANGUAGES 声明了 import_nodes 的语言，都必须有 LANG_ADAPTERS 记录（否则深度依赖提取会静默跳过）。
 *  - 深适配语言（go/python/java/rust）必须同时提供 callNode + import/binding 提取。
 *  - 兜底目标：把「平移到注册表时漏掉某个语言/某层」变成测试期错误，而非运行时静默遗漏。
 */
import { describe, it, expect } from 'vitest';
import { LANG_ADAPTERS } from '../../src/infrastructure/parse/kernel.js';
import { LANGUAGES } from '../../src/infrastructure/parse/languages.js';

describe('语言适配器注册表完备性', () => {
  it('每个声明 import_nodes 的语言都有 adapter 记录', () => {
    const declared = LANGUAGES.filter((l) => l.import_nodes && l.import_nodes.length > 0).map((l) => l.name);
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(LANG_ADAPTERS[name], `语言 ${name} 声明了 import_nodes 但缺 LANG_ADAPTERS 记录`).toBeDefined();
    }
  });

  it('深适配语言（go/python/java/rust/c_sharp/php）同时具备 callNode 与 import/binding 提取', () => {
    for (const name of ['go', 'python', 'java', 'rust', 'c_sharp', 'php']) {
      const a = LANG_ADAPTERS[name]!;
      expect(a.callNode, `${name} 缺 callNode`).toBeDefined();
      expect(typeof a.extractImportSources, `${name} 缺 extractImportSources`).toBe('function');
      expect(typeof a.extractImportBindings, `${name} 缺 extractImportBindings`).toBe('function');
    }
  });

  it('TS 系走原生 ImportEdge：只登记 callNode，不要求 binding 方法', () => {
    expect(LANG_ADAPTERS.typescript.callNode).toBe('call_expression');
    expect(LANG_ADAPTERS.javascript.callNode).toBe('call_expression');
    expect(LANG_ADAPTERS.typescript.extractImportBindings).toBeUndefined();
  });

  it('c_sharp/php 已配 using/use import_nodes，使闭包可沿 C#/PHP import 边扩展', () => {
    const cs = LANGUAGES.find((l) => l.name === 'c_sharp')!;
    const php = LANGUAGES.find((l) => l.name === 'php')!;
    expect(cs.import_nodes).toEqual(['using_directive']);
    expect(php.import_nodes).toEqual(['namespace_use_declaration']);
    // 与注册表一致性：声明了 import_nodes 必有其适配器（上一条已断言）
    expect(LANG_ADAPTERS['c_sharp'].callNode).toBe('invocation_expression');
    expect(Array.isArray(LANG_ADAPTERS['php'].callNode)).toBe(true);
  });

  it('无深适配/无 import_nodes 的语言不要求 adapter（保持未装语言静默禁用）', () => {
    // 尚未接线的语言（如 swift）无 import_nodes → 不需要 adapter（静默禁用，不报漏接）
    const swift = LANGUAGES.find((l) => l.name === 'swift')!;
    expect(swift.import_nodes).toBeUndefined();
    // C 已接线（t4）：import_nodes=preproc_include + c adapter
    const c = LANGUAGES.find((l) => l.name === 'c')!;
    expect(c.import_nodes).toEqual(['preproc_include']);
    expect(LANG_ADAPTERS['c'].callNode).toBe('call_expression');
    expect(typeof LANG_ADAPTERS['c'].extractImportSources).toBe('function');
  });

  it('cpp/kotlin 已接线（callNode + import_nodes）；ruby 只接调用边（无专用 import 节点）', () => {
    // cpp：调用边 + `#include` 边（与 c 共用 includePath）
    const cpp = LANGUAGES.find((l) => l.name === 'cpp')!;
    expect(cpp.import_nodes).toEqual(['preproc_include']);
    expect(LANG_ADAPTERS['cpp'].callNode).toBe('call_expression');
    expect(typeof LANG_ADAPTERS['cpp'].extractImportSources).toBe('function');
    // kotlin：调用边 + import_header；grammar 无字段 ⇒ 申报 bodyNodeTypes/calleeIsFirstChild
    const kotlin = LANGUAGES.find((l) => l.name === 'kotlin')!;
    expect(kotlin.import_nodes).toEqual(['import_header']);
    expect(LANG_ADAPTERS['kotlin'].callNode).toBe('call_expression');
    expect(LANG_ADAPTERS['kotlin'].bodyNodeTypes).toEqual(['function_body', 'class_body']);
    expect(LANG_ADAPTERS['kotlin'].calleeIsFirstChild).toBe(true);
    // ruby：`require` 就是普通 `call`（无专用 import 节点）⇒ 有意不声明 import_nodes
    const ruby = LANGUAGES.find((l) => l.name === 'ruby')!;
    expect(ruby.import_nodes).toBeUndefined();
    expect(LANG_ADAPTERS['ruby'].callNode).toBe('call');
  });

  it('c 适配器已有 callNode 与 import 提取（不要求 binding：C include 无本地名）', () => {
    expect(LANG_ADAPTERS['c'].extractImportBindings).toBeUndefined();
  });
});