/**
 * contract_gate · Python 语言包
 */
import { scanDotRefs, type CgLangPackage, type FileSymbols, type RefHit } from '../parts.js';

/** Python 关键字（`. 左侧不可能代表"对象引用"） */
const PY_RESERVED = new Set([
  'if', 'elif', 'else', 'for', 'while', 'def', 'class', 'return', 'import', 'from',
  'as', 'in', 'is', 'not', 'and', 'or', 'pass', 'break', 'continue', 'with', 'try',
  'except', 'finally', 'raise', 'yield', 'lambda', 'del', 'global', 'nonlocal',
  'assert', 'async', 'await', 'None', 'True', 'False',
]);

/** Python 常用内建（避免把 str./list./Exception 等误判成未定义对象） */
const PY_GLOBALS = new Set([
  'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'frozenset',
  'object', 'type', 'bytes', 'bytearray', 'complex', 'Exception', 'ValueError',
  'TypeError', 'KeyError', 'AttributeError', 'RuntimeError', 'IndexError', 'NameError',
  'print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed',
  'sum', 'min', 'max', 'abs', 'round', 'pow', 'divmod', 'all', 'any', 'next', 'iter',
  'repr', 'format', 'hash', 'id', 'input', 'open', 'super', 'self', 'cls', 'isinstance',
  'issubclass', 'callable', 'hasattr', 'getattr', 'setattr', 'delattr', 'vars', 'dir',
]);

export const cgPyPackage: CgLangPackage = {
  lang: 'py',
  exts: ['.py'],
  reserved: PY_RESERVED,
  globals: PY_GLOBALS,
  collectSymbols(text: string): FileSymbols {
    const declared = new Set<string>();
    const aliases = new Set<string>();
    const locals = new Set<string>();

    // 顶层声明：def / class / 模块级常量（^NAME = ，大写约定）
    for (const m of text.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/^([A-Z][A-Z0-9_]*)\s*=/gm)) declared.add(m[1]);
    // import a.b[ as c] / from x import a[ as b]（别名取 as 右值或末段）
    for (const m of text.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+([A-Za-z_]\w*))?/gm)) {
      aliases.add((m[2] || m[1].split('.').pop() || '').trim());
    }
    for (const m of text.matchAll(/^\s*from\s+[\w.]+\s+import\s+(?:\(([^)]*)\)|(.+))/gm)) {
      for (const nm of (m[1] || m[2] || '').split(',').map((s) => s.trim())) {
        if (!nm) continue;
        const asM = nm.match(/^([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)/);
        aliases.add(asM ? asM[2] : nm.replace(/[*()]/g, ''));
      }
    }
    // 局部名（文件级并集，"宁可多收不漏收"）：self/cls、赋值左值、for 变量、def 形参
    locals.add('self');
    locals.add('cls');
    for (const m of text.matchAll(/([A-Za-z_]\w*)\s*=/gm)) locals.add(m[1]);
    for (const m of text.matchAll(/\bfor\s+([A-Za-z_]\w*)/gm)) locals.add(m[1]);
    for (const m of text.matchAll(/\bwith\s+[^:]*?\bas\s+([A-Za-z_]\w*)/gm)) locals.add(m[1]);
    for (const m of text.matchAll(/^\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([^)]*)\)/gm)) {
      for (const pm of (m[1] || '').split(',')) {
        const pn = pm.trim().split(':')[0].split('=')[0].trim();
        if (/^[A-Za-z_]\w*$/.test(pn)) locals.add(pn);
      }
    }

    return { declared, aliases, locals };
  },
  collectReferences(text: string): RefHit[] {
    return scanDotRefs(text, PY_RESERVED);
  },
};
