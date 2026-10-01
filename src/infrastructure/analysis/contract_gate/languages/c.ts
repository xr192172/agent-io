/**
 * contract_gate · C 语言包
 */
import { scanDotRefs, type CgLangPackage, type FileSymbols, type RefHit } from '../parts.js';

/** C 关键字（`. 左侧是 struct 变量/typedef 名，关键字绝不可能） */
const C_RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'return', 'break', 'continue', 'case', 'default',
  'struct', 'union', 'enum', 'typedef', 'sizeof', 'void', 'int', 'long', 'short',
  'char', 'float', 'double', 'unsigned', 'signed', 'const', 'volatile', 'static',
  'extern', 'register', 'do', 'else', 'goto', 'auto', 'NULL', 'true', 'false',
]);

export const cgCPackage: CgLangPackage = {
  lang: 'c',
  exts: ['.c', '.h'],
  reserved: C_RESERVED,
  collectSymbols(text: string): FileSymbols {
    const declared = new Set<string>();
    const aliases = new Set<string>();
    const locals = new Set<string>();

    // C 全局函数/结构/typedef + 全局变量；形参 = 局部
    for (const m of text.matchAll(/^\s*(?:extern|static|inline)\s+[^;{}]+?\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:;|\{)/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/^\s*(?:typedef\s+)?struct\s+([A-Za-z_]\w*)/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/^\s*typedef\s+[^;{}]+?\b([A-Za-z_]\w*)\s*;/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/^\s*(?:extern|static|const|volatile|unsigned|signed|register)\s+[\w\s*]+?\b([A-Za-z_]\w*)\s*(?:=|;)/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/\b(?:[A-Za-z_]\w*\s*\*?\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/gm)) {
      for (const pm of (m[2] || '').split(',')) {
        const p = pm.trim().split(/\s+/).pop()?.replace(/^\*+/, '') ?? '';
        if (/^[A-Za-z_]\w*$/.test(p)) locals.add(p);
      }
    }

    return { declared, aliases, locals };
  },
  collectReferences(text: string): RefHit[] {
    // C 无内建对象引用（struct 变量已入 declared/locals）
    return scanDotRefs(text, C_RESERVED);
  },
};
