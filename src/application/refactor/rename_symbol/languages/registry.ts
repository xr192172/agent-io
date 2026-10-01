/**
 * rename_symbol · 语言包注册表
 *
 * 唯一调度表：`ext → LangPackage`。原 `rename_symbol.ts` 里 5 条
 * `if (defExt === '.xx') return renameXxxSymbol({...})` 的 if 链，以及 TS/JS 家族收尾段，
 * 统一收敛到这里；core 只做 `findLangPackage(defExt)` 查表。
 *
 * ★ 行为等价性：各语言包 ext 互不相交（`.c`/`.h` 同 C 包），查表与 if 链等价。
 */
import { TS_JS_EXTS } from '../../../../infrastructure/parse/index.js';
import { renameTsSymbol } from './typescript.js';
import { renameGoSymbol } from './go.js';
import { renamePythonSymbol } from './python.js';
import { renameNamespaceSymbol } from './java.js';
import { renameCSymbol } from './c.js';
import type { LangPackage } from '../parts.js';

export type { LangPackage };

export const LANG_PACKAGES: readonly LangPackage[] = [
  {
    exts: TS_JS_EXTS,
    rename: (a) => renameTsSymbol(a),
  },
  {
    exts: ['.go'],
    rename: (a) => renameGoSymbol({ file: a.file, symbol: a.symbol, to: a.to, dryRun: a.dryRun, resolvedRoot: a.resolvedRoot, blocked: a.blocked }),
  },
  {
    exts: ['.py'],
    rename: (a) => renamePythonSymbol({ file: a.file, symbol: a.symbol, to: a.to, dryRun: a.dryRun, resolvedRoot: a.resolvedRoot, blocked: a.blocked }),
  },
  {
    exts: ['.cs'],
    rename: (a) => renameNamespaceSymbol({ file: a.file, symbol: a.symbol, to: a.to, dryRun: a.dryRun, resolvedRoot: a.resolvedRoot, blocked: a.blocked, ext: '.cs' }),
  },
  {
    exts: ['.java'],
    rename: (a) => renameNamespaceSymbol({ file: a.file, symbol: a.symbol, to: a.to, dryRun: a.dryRun, resolvedRoot: a.resolvedRoot, blocked: a.blocked, ext: '.java' }),
  },
  {
    exts: ['.c', '.h'],
    rename: (a) => renameCSymbol({ file: a.file, symbol: a.symbol, to: a.to, dryRun: a.dryRun, resolvedRoot: a.resolvedRoot, blocked: a.blocked }),
  },
];

export function findLangPackage(ext: string): LangPackage | undefined {
  return LANG_PACKAGES.find((p) => p.exts.includes(ext));
}
