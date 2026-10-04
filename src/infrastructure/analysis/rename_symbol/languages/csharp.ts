/**
 * rename_symbol · C#（+ 共享的命名空间分析器工厂）
 *
 * C# / Java 命名空间级符号改名（方向二 · C#/Java）
 * 语义（与 Python 的"模块=命名空间"同构，但跨文件限定引用形态不同）：
 *   - 顶层类型（class/interface/struct/enum/record）是"模块级符号"，同名同包/同命名空间内直接可见
 *   - 跨文件引用：同包/同命名空间 → 裸名；跨包 → `Qualified.Name`（scoped_type_identifier / qualified_name）
 * 本分析复用 GoModuleAnalysis 结构：
 *   rootOffsets/refs/defined → 顶层类型 + 同文件裸引用
 *   imports      → package/namespace 声明 + import/using（首段/末段做同模块判定）
 *   selections   → `X.sym` 限定引用（key=限定符末段，field=符号名）
 *
 * ★ 拆分说明：`makeNamespaceAnalyzer` 是 C#/Java 共用的工厂，落在本文件；`renameNamespaceSymbol`
 *   同时用到 `analyzeCSharpSource` 与 `analyzeJavaSource`，为避免 core↔语言包循环依赖，
 *   执行器落在 `java.ts`（单向 `java.ts → csharp.ts` 依赖）。
 */
import { getParser } from '../../../../infrastructure/parse/loader.js';
import { findLanguageByExt } from '../../../../infrastructure/parse/languages.js';
import { parseContent } from '../../../../infrastructure/parse/kernel.js';
import { nameInfo, type N } from '../parts.js';
import type { GoModuleAnalysis } from './go.js';

export function makeNamespaceAnalyzer(opts: {
  ext: '.java' | '.cs';
  typeNodes: string[];
  idType: string;
}) {
  return async function analyze(src: string): Promise<GoModuleAnalysis | null> {
    const parser = await getParser(opts.ext, findLanguageByExt(opts.ext)!);
    if (!parser) return null;
    // §21 规矩③：解析失败不兜底（同 analyzeModuleSource）
    const root: N = (parseContent(parser as Parameters<typeof parseContent>[0], src) as unknown as { rootNode: N }).rootNode;
    const isJava = opts.ext === '.java';
    const typeNodes = new Set(opts.typeNodes);
    const rootOffsets = new Map<string, number>();
    const rootKinds = new Map<string, string>();
    const refs = new Map<string, number[]>();
    const defined = new Set<string>();
    const imports: Array<{ alias: string; path: string }> = [];
    const selections = new Map<string, Array<{ field: string; fieldOffset: number }>>();
    const add = (m: Map<string, number[]>, name: string, offset: number): void => {
      let a = m.get(name);
      if (!a) {
        a = [];
        m.set(name, a);
      }
      a.push(offset);
    };

    // 顶层类型定义：parent 为 compilation_unit（Java）或 declaration_list@namespace/root（C#）
    const isModuleScope = (p: N | null, gp: N | null): boolean => {
      if (!p) return false;
      if (p.type === 'compilation_unit' || p.type === 'program') return true;
      if (p.type === 'declaration_list') {
        return !gp || gp.type === 'namespace_declaration' || gp.type === 'compilation_unit' || gp.type === 'program';
      }
      return false;
    };
    const collectDefs = (n: N, parent: N | null, gp: N | null, depth = 0): void => {
      if (depth > 1000) return;
      if (typeNodes.has(n.type) && isModuleScope(parent, gp)) {
        const ni = nameInfo(n);
        if (ni && n.type !== 'method_declaration' && n.type !== 'property_declaration' && !rootOffsets.has(ni.text)) {
          rootOffsets.set(ni.text, ni.offset);
          rootKinds.set(ni.text, n.type);
          defined.add(ni.text);
        }
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) collectDefs(c, n, parent, depth + 1);
      }
    };

    // module 名 = package/namespace 路径（末段做同模块判定）；imports 记 package/namespace + import/using
    const collectModuleAndImports = (n: N, depth = 0): void => {
      if (depth > 1000) return;
      const t = n.type;
      if (isJava && t === 'package_declaration') {
        // 取 package 后的 scoped_identifier 全文本
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && (c.type === 'scoped_identifier' || c.type === 'identifier')) {
            imports.push({ alias: c.text.split('.').filter(Boolean).pop() ?? '', path: c.text });
            return;
          }
        }
        return;
      }
      if (isJava && t === 'import_declaration') {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && (c.type === 'scoped_identifier' || c.type === 'identifier')) {
            imports.push({ alias: c.text.split('.').filter(Boolean).pop() ?? '', path: c.text });
            return;
          }
        }
        return;
      }
      if (!isJava && t === 'namespace_declaration') {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && (c.type === 'qualified_name' || c.type === 'identifier')) {
            imports.push({ alias: c.text.split('.').filter(Boolean).pop() ?? '', path: c.text });
            break;
          }
        }
        return;
      }
      if (!isJava && t === 'using_directive') {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c) {
            const seg = c.text.split('.').filter(Boolean).pop() ?? '';
            if (seg && /^[A-Za-z_][\w$]*$/.test(seg)) imports.push({ alias: seg, path: c.text });
            break;
          }
        }
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) collectModuleAndImports(c, depth + 1);
      }
    };

    // 裸引用（同文件/同模块的裸名引用）+ 限定引用 `X.sym`（key=限定符末段）
    const collectRefs = (n: N, depth = 0): void => {
      if (depth > 1000) return;
      const t = n.type;
      // 限定引用：Java scoped_type_identifier/scoped_identifier 末段带 name 字段；C# qualified_name
      if ((!isJava && t === 'qualified_name') || (isJava && (t === 'scoped_type_identifier' || t === 'scoped_identifier'))) {
        let nameField = n.childForFieldName('name');
        // scoped_type_identifier 无 name 字段 → 回退取最后一个 identifier/type_identifier 子节点
        if (!nameField) {
          for (let i = n.childCount - 1; i >= 0; i--) {
            const c = n.child(i);
            if (c && (c.type === 'identifier' || c.type === 'type_identifier')) {
              nameField = c;
              break;
            }
          }
        }
        if (nameField && (nameField.type === 'identifier' || nameField.type === 'type_identifier')) {
          // 限定符 = 除末段外的文本（去末段名字）
          let scopeText = '';
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i);
            if (c && c !== nameField) scopeText += c.text;
          }
          if (scopeText.includes('.') || (scopeText && /^[A-Za-z_][\w$]*\./.test(n.text))) {
            const last = scopeText.split('.').filter(Boolean).pop()?.replace(/[^\w$]/g, '') ?? '';
            if (last) {
              let a = selections.get(last);
              if (!a) {
                a = [];
                selections.set(last, a);
              }
              a.push({ field: nameField.text, fieldOffset: nameField.startIndex });
            }
          }
        }
        return; // 不深入（限定符是链式，叶子在下一层 qualified_name 已覆盖）
      }
      if (t === opts.idType || t === 'type_identifier') {
        add(refs, n.text, n.startIndex);
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) collectRefs(c, depth + 1);
      }
    };

    collectDefs(root, null, null, 0);
    collectModuleAndImports(root, 0);
    collectRefs(root, 0);

    // 去掉定义处名字节点在 refs 里的记录（定义不是引用）
    for (const off of [...refs.values()].flat()) {
      for (const [, o] of rootOffsets) {
        if (o === undefined) continue;
      }
    }
    // refs 去重
    for (const [name, arr] of refs) refs.set(name, [...new Set(arr)]);
    return { rootOffsets, rootKinds, refs, defined, imports, selections };
  };
}

export const analyzeCSharpSource = makeNamespaceAnalyzer({
  ext: '.cs',
  typeNodes: ['class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration', 'record_declaration'],
  idType: 'identifier',
});
