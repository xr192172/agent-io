/**
 * contract_gate · Go 语言包
 */
import { scanDotRefs, type CgLangPackage, type FileSymbols, type RefHit } from '../parts.js';

const GO_RESERVED = new Set([
  'if', 'for', 'func', 'go', 'defer', 'range', 'return', 'switch', 'select', 'type',
  'package', 'import', 'var', 'const', 'else', 'break', 'continue', 'fallthrough',
  'default', 'case', 'chan', 'struct', 'interface', 'map', 'nil', 'true', 'false',
]);

export const cgGoPackage: CgLangPackage = {
  lang: 'go',
  exts: ['.go'],
  reserved: GO_RESERVED,
  collectSymbols(text: string): FileSymbols {
    const declared = new Set<string>();
    const aliases = new Set<string>();
    const locals = new Set<string>();

    // 顶层声明（func 支持方法接收者：func (v *Vault) Get( → 名字 Get）
    for (const m of text.matchAll(/^\s*(?:type|var|const)\s+([A-Za-z_]\w*)/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/^\s*func\s+(?:\(\s*\w+\s*[*\w./]+\)\s+)?([A-Za-z_]\w*)/gm)) declared.add(m[1]);
    // import 单行/+块：显式别名 或 裸路径取末段
    for (const m of text.matchAll(/(?<=^|[;\n(])\s*([A-Za-z_]\w*)\s+"[^"]+"/gm)) aliases.add(m[1]);
    for (const m of text.matchAll(/"([^"/ \t]+)"/g)) {
      if (m[1] && /^[a-zA-Z_]/.test(m[1])) aliases.add(m[1]);
    }
    // 局部名：:= 左值、var 名、函数参数名（括号内第一个标识符/接收者）
    for (const m of text.matchAll(/([A-Za-z_]\w*)\s*:=/gm)) locals.add(m[1]);
    for (const m of text.matchAll(/\bvar\s+([A-Za-z_]\w*)/gm)) locals.add(m[1]);
    for (const m of text.matchAll(/^\s*(?:func)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm)) {
      const inner = m[2] ?? '';
      for (const pm of inner.matchAll(/([A-Za-z_]\w*)\s*[*\w./]*(?:,|\)|$)/g)) {
        if (pm[1] && !GO_RESERVED.has(pm[1])) locals.add(pm[1]);
      }
    }

    return { declared, aliases, locals };
  },
  collectReferences(text: string): RefHit[] {
    return scanDotRefs(text, GO_RESERVED);
  },
};
