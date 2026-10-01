/**
 * contract_gate · 语言包注册表
 *
 * 唯一调度表：`Lang → 语言包`，以及 `相对路径 → Lang`（由各包 `exts` **派生**，不另抄映射）。
 * `core.ts` 只做 `cgPackageForLang(lang)` / `langOfFile(rel)` 查表，不认识具体语言。
 *
 * ★ 行为等价性：各语言包 `exts` 互不相交（`.c`/`.h` 同 C 包），查表与原先的
 *   `if (lang === 'go') … else if (lang === 'py') …` 链等价。
 *
 * ★ 加一门语言：写 `languages/<lang>.ts` + 在 `CG_LANG_PACKAGES` 加一行 ⇒ `core.ts` 一行都不用改。
 */
import type { CgLangPackage, Lang } from '../parts.js';
import { cgTsPackage } from './ts.js';
import { cgGoPackage } from './go.js';
import { cgPyPackage } from './py.js';
import { cgJavaPackage } from './java.js';
import { cgCsPackage } from './cs.js';
import { cgCPackage } from './c.js';

/** 全部已注册语言包 */
export const CG_LANG_PACKAGES: readonly CgLangPackage[] = [
  cgTsPackage,
  cgGoPackage,
  cgPyPackage,
  cgJavaPackage,
  cgCsPackage,
  cgCPackage,
];

/** 语言代号 → 语言包 */
export function cgPackageForLang(lang: Lang): CgLangPackage | undefined {
  return CG_LANG_PACKAGES.find((p) => p.lang === lang);
}

/** 源码相对路径 → Lang（由各包 `exts` 派生；无匹配返回 null） */
export function langOfFile(rel: string): Lang | null {
  for (const p of CG_LANG_PACKAGES) {
    for (const e of p.exts) if (rel.endsWith(e)) return p.lang;
  }
  return null;
}
