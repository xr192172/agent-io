/**
 * contract_gate · Java 语言包
 */
import { scanDotRefs, type CgLangPackage, type FileSymbols, type RefHit } from '../parts.js';

/** Java 关键字（`. 左侧不可能代表"接收者/包引用"） */
const JAVA_RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'return', 'new', 'class', 'interface', 'enum',
  'extends', 'implements', 'import', 'package', 'public', 'private', 'protected',
  'static', 'final', 'abstract', 'synchronized', 'native', 'throws', 'throw',
  'try', 'catch', 'finally', 'void', 'int', 'long', 'double', 'float', 'boolean',
  'char', 'byte', 'short', 'true', 'false', 'null', 'this', 'super', 'instanceof',
]);

/** Java 内置命名空间/常用类型（System./java.* 段不会误判） */
const JAVA_GLOBALS = new Set([
  'System', 'String', 'Math', 'Integer', 'Double', 'Boolean', 'Long', 'Object', 'Class', 'Thread', 'Runtime', 'ProcessBuilder',
]);

export const cgJavaPackage: CgLangPackage = {
  lang: 'java',
  exts: ['.java'],
  reserved: JAVA_RESERVED,
  globals: JAVA_GLOBALS,
  collectSymbols(text: string): FileSymbols {
    const declared = new Set<string>();
    const aliases = new Set<string>();
    const locals = new Set<string>();

    // Java 顶层类型 + 顶层方法；import 末段 = 别名；方法形参 = 局部
    for (const m of text.matchAll(/^\s*(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp|synchronized|native|transient|volatile|default|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/gm)) declared.add(m[1]);
    for (const m of text.matchAll(/^\s*import\s+static\s+([\w.]+(?:\.\*)?)\s*;/gm)) {
      const last = m[1].replace(/\.\*$/, '').split('.').pop() ?? '';
      if (last) aliases.add(last);
    }
    for (const m of text.matchAll(/^\s*import\s+([\w.]+(?:\.\*)?)\s*;/gm)) {
      const last = m[1].replace(/\.\*$/, '').split('.').pop() ?? '';
      if (last && /^[A-Za-z_]/.test(last)) aliases.add(last);
    }
    for (const m of text.matchAll(/^\s*(?:public|protected|private|static|final|synchronized|native|abstract|default|\s)*\s*[\w<>,.\[\] ]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws[^;]*)?\{/gm)) {
      locals.add(m[1]); // 方法名不入 locals 也无妨（declare 语义）
      for (const pm of (m[2] || '').split(',')) {
        const pn = pm.trim().split(/\s+/).pop()?.split('[')[0] ?? '';
        if (/^[A-Za-z_]\w*$/.test(pn)) locals.add(pn);
      }
    }
    // Java 局部变量声明：Foo f = ... / Foo f; → f 入 locals
    for (const m of text.matchAll(/^\s*[\w<>,.\[\] ]+\s+([A-Za-z_]\w*)\s*(?:=|\s*;)/gm)) {
      if (/^[A-Za-z_]\w*$/.test(m[1])) locals.add(m[1]);
    }

    return { declared, aliases, locals };
  },
  collectReferences(text: string): RefHit[] {
    // Java 的 import/package 行（如 com.acme.Foo）不是"使用点"——整行跳过
    return scanDotRefs(text, JAVA_RESERVED, (line) => /^\s*(import|package)\s/.test(line));
  },
};
