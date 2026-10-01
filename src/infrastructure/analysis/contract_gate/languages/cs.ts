/**
 * contract_gate · C# 语言包
 */
import { scanDotRefs, type CgLangPackage, type FileSymbols, type RefHit } from '../parts.js';

/** C# 关键字 */
const CS_RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'return', 'new', 'class', 'interface', 'struct',
  'enum', 'namespace', 'using', 'public', 'private', 'protected', 'internal',
  'static', 'readonly', 'const', 'abstract', 'virtual', 'override', 'async',
  'await', 'void', 'int', 'long', 'double', 'float', 'bool', 'char', 'byte',
  'short', 'true', 'false', 'null', 'this', 'base', 'is', 'as', 'typeof', 'throw',
  'try', 'catch', 'finally', 'var', 'string', 'object', 'out', 'ref', 'in',
]);

/** C# 内置命名空间/常用类型 */
const CS_GLOBALS = new Set([
  'System', 'String', 'Console', 'Math', 'Convert', 'Environment', 'DateTime', 'Guid', 'Object', 'Type', 'Exception', 'Array', 'List', 'Dictionary',
]);

export const cgCsPackage: CgLangPackage = {
  lang: 'cs',
  exts: ['.cs'],
  reserved: CS_RESERVED,
  globals: CS_GLOBALS,
  collectSymbols(text: string): FileSymbols {
    const declared = new Set<string>();
    const aliases = new Set<string>();
    const locals = new Set<string>();

    // C# 顶层类型；using 末段/别名；方法形参
    for (const m of text.matchAll(/^\s*(?:public|internal|private|protected|abstract|sealed|static|partial|readonly|record|\s)*\s*(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/^\s*using\s+static\s+([\w.]+)\s*;/gm)) {
      const last = m[1].split('.').pop() ?? '';
      if (last) aliases.add(last);
    }
    for (const m of text.matchAll(/^\s*using\s+([\w.]+)\s*(?:=\s*([\w.]+))?\s*;/gm)) {
      const bind = m[2] || (m[1].split('.').pop() ?? '');
      if (bind && /^[A-Za-z_]/.test(bind)) aliases.add(bind);
    }
    for (const m of text.matchAll(/^\s*(?:public|internal|private|protected|static|async|virtual|override|abstract|sealed|partial|readonly|extern|unsafe|\s)*\s*[\w<>,.\[\]? ]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:=>|where|\{)/gm)) {
      for (const pm of (m[2] || '').split(',')) {
        let pn = pm.trim();
        pn = pn.split('=')[0].trim(); // 默认值
        pn = pn.replace(/^(out|ref|in|params|this|scoped)\s+/, '').trim();
        const p = pn.split(/\s+/).pop()?.split('[')[0] ?? '';
        if (/^[A-Za-z_]\w*$/.test(p)) locals.add(p);
      }
    }
    locals.add('this');
    locals.add('base');

    return { declared, aliases, locals };
  },
  collectReferences(text: string): RefHit[] {
    // C# 的 using/namespace 行不是"使用点"——整行跳过
    return scanDotRefs(text, CS_RESERVED, (line) => /^\s*(using|namespace)\s/.test(line));
  },
};
