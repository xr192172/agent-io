/**
 * package_migration · 语言包注册表
 *
 * 唯一调度表：`ext → PmLangPackage`。原 `package_migration.ts` 的 `cleanAlias` 里
 * `if (ext === '.go') … else if (isTsJsExt(ext)) … else if (ext === '.py')` 的 if 链，
 * 统一收敛到这里；core 只做 `findPmLangPackage(ext)` 查表。
 *
 * ★ 行为等价性：各语言包 ext 互不相交，查表与 if 链等价（else → 正则回退由 core 处理）。
 */
import { TS_JS_EXTS } from '../../../../infrastructure/parse/index.js';
import { goAliasEdits } from './go.js';
import { tsAliasEdits } from './ts.js';
import { pyAliasEdits } from './py.js';
import type { PmLangPackage } from '../parts.js';

export type { PmLangPackage };

export const PM_LANG_PACKAGES: readonly PmLangPackage[] = [
  {
    exts: ['.go'],
    collect: (a) => goAliasEdits(a.src, a.exactPath, a.from, a.to, a.fileAbs),
  },
  {
    exts: TS_JS_EXTS,
    collect: (a) => tsAliasEdits(a.src, a.exactPath, a.from, a.to, a.fileAbs),
  },
  {
    exts: ['.py'],
    collect: (a) => pyAliasEdits(a.src, a.exactPath, a.from, a.to, a.fileAbs),
  },
];

export function findPmLangPackage(ext: string): PmLangPackage | undefined {
  return PM_LANG_PACKAGES.find((p) => p.exts.includes(ext));
}
