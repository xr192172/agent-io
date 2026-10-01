/**
 * contract_gate · TypeScript / JS 家族语言包
 *
 * 语法上是 TS 子集 ⇒ JS(.js/.jsx/.mjs/.cjs) 与 TS(.ts/.tsx) 走**同一套** TS 逻辑。
 * ★ 扩展名清单**来自内核唯一权威** `source_exts.ts` 的 `TS_JS_EXTS`，**不在这里再抄一遍** ——
 *   抄一份就是 G4「同族副本棘轮」（`source-extension-static-list`）家族的第 N+1 份，门会红。
 *   （本文件初版手抄了 6 个，被 G4 当场抓住。）
 * ★★ 顺带补上一个**潜在缺口**：手抄那 6 个漏了 `.mts/.cts`。而扫描用的 `SOURCE_EXTS` **含**它们
 *   ⇒ 这两个扩展名的文件**会被扫到、却认不出语言**（`langOfFile` 返回 null ⇒ 整份文件跳过）。
 *   改用权威后 TS 家族 8 个扩展名都认（这是"唯一权威"顺手带来的正确性，不是本笔的有意改动）。
 */
import { TS_JS_EXTS } from '../../../parse/source_exts.js';
import { scanDotRefs, type CgLangPackage, type FileSymbols, type RefHit } from '../parts.js';

/** `.` 左侧绝不可能代表"包/接收者引用"的标识符（保留字 / 关键字） */
const SKIP_LHS = new Set([
  'if', 'for', 'func', 'go', 'defer', 'range', 'return', 'switch', 'select',
  'type', 'package', 'import', 'var', 'const', 'else', 'break', 'continue',
  'fallthrough', 'default', 'case', 'chan', 'struct', 'interface', 'map',
  'append', 'int', 'int64', 'uint', 'string', 'bool', 'byte', 'rune',
  'float64', 'error', 'len', 'cap', 'new', 'make', 'delete', 'copy', 'close',
  'panic', 'recover', 'complex', 'real', 'imag', 'nil', 'true', 'false',
]);

/** TS 全局对象白名单——避免把 Math/document/process 等误判成未定义 */
const TS_GLOBALS = new Set([
  'window', 'document', 'history', 'location', 'navigator', 'localStorage', 'sessionStorage',
  'Math', 'JSON', 'console', 'process', 'Buffer', 'URL', 'URLSearchParams', 'fetch',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Intl', 'Reflect', 'Proxy',
  'Promise', 'Symbol', 'Object', 'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Date',
  'Error', 'Map', 'Set', 'WeakMap', 'WeakSet', 'BigInt', 'performance', 'crypto', 'module',
  'exports', 'require', '__dirname', '__filename', 'globalThis', 'global', 'self', 'location',
]);

export const cgTsPackage: CgLangPackage = {
  lang: 'ts',
  // JS 家族：语法是 TS 子集，走同一套 ts 分支（collectSymbols/collectReferences 的 TS 逻辑对纯 JS 兼容）
  exts: TS_JS_EXTS,
  reserved: SKIP_LHS,
  globals: TS_GLOBALS,
  collectSymbols(text: string): FileSymbols {
    const declared = new Set<string>();
    const aliases = new Set<string>();
    const locals = new Set<string>();

    // TS 顶层声明
    for (const m of text.matchAll(/^\s*(?:export\s+default\s+|export\s+|default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
      declared.add(m[1]);
    }
    // import {a, b as c} from / import x from / import * as x from
    for (const m of text.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) aliases.add(m[1]);
    for (const m of text.matchAll(/(?:import)\s+([A-Za-z_$][\w$]*)\s+from/g)) aliases.add(m[1]);
    for (const m of text.matchAll(/(?:import)\s*(?:type\s*)?\{([^}]*)\}\s*from/g)) {
      for (const nm of (m[1] || '').split(',')) {
        const clean = nm.trim();
        if (!clean) continue;
        const asM = clean.match(/(?:([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*))|(?:([A-Za-z_$][\w$]*))/);
        if (asM) aliases.add((asM[2] || asM[1] || asM[3] || '').trim());
      }
    }
    // 局部名：const/let/var
    for (const m of text.matchAll(/\b(?:const|let|var)\s+([{A-Za-z_$][\w$]*)/gm)) {
      const nm = m[1].replace(/^\s*\{/, '');
      if (/^[A-Za-z_$]/.test(nm)) locals.add(nm);
    }

    return { declared, aliases, locals };
  },
  collectReferences(text: string): RefHit[] {
    return scanDotRefs(text, SKIP_LHS);
  },
};
