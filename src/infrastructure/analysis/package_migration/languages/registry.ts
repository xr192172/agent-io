/**
 * package_migration · 语言包注册表
 *
 * 唯一调度表：`ext → PmLangPackage`。原 `package_migration.ts` 的 `cleanAlias` 里
 * `if (ext === '.go') … else if (isTsJsExt(ext)) … else if (ext === '.py')` 的 if 链，
 * 统一收敛到这里；core 只做 `findPmLangPackage(ext)` 查表。
 *
 * ★ 行为等价性：各语言包 ext 互不相交，查表与 if 链等价（else → 正则回退由 core 处理）。
 */
import { goPackage } from './go.js';
import { tsPackage } from './ts.js';
import { pyPackage } from './py.js';
import type { PmLangPackage } from '../parts.js';

export type { PmLangPackage };

/**
 * ★★ 这张表现在是**纯收集**（2026-10-05，与 `contract_gate/languages/registry.ts` 同形）：
 *   每个语言包**自带 `exts`**（就在它自己那个文件里），本表只把它们排好序。
 *   ⇒ 好处：**「让某个文件去服务别的扩展名」在结构上不可能** —— 要改一个包的 `exts`，
 *     必须进那个语言的文件。（改前 `exts` 写在本表、impl 写在语言文件里，是**分居两处**。）
 */
export const PM_LANG_PACKAGES: readonly PmLangPackage[] = [goPackage, tsPackage, pyPackage];

export function findPmLangPackage(ext: string): PmLangPackage | undefined {
  return PM_LANG_PACKAGES.find((p) => p.exts.includes(ext));
}
