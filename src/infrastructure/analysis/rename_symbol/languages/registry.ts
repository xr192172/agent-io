/**
 * rename_symbol · 语言包注册表
 *
 * 唯一调度表：`ext → LangPackage`。原 `rename_symbol.ts` 里 5 条
 * `if (defExt === '.xx') return renameXxxSymbol({...})` 的 if 链，以及 TS/JS 家族收尾段，
 * 统一收敛到这里；core 只做 `findLangPackage(defExt)` 查表。
 *
 * ★ 行为等价性：各语言包 ext 互不相交（`.c`/`.h` 同 C 包），查表与 if 链等价。
 *
 * ★★ 文件命名规则（2026-10-05 统一，T28）：**文件名 = 该包主导扩展名去掉点**（`ts` / `py` / `cs`
 *   / `go` / `java` / `c`），与 `contract_gate/languages/` 的 `Lang` 短码、`package_migration/languages/`
 *   的文件名**三者一致**。本包原先叫 `typescript.ts` / `python.ts` / `csharp.ts`（长名），
 *   与另两张表（短码）不同 ⇒ **同一门语言三套写法**，按名字跨模块定位一首语言做不到
 *   （T28 的原症状）。取**短码**而不是长名的理由：① 短码 = `exts[0].slice(1)` ⇒ **可派生的**，
 *   不需要再维护一张名字表（本仓「不写名字表」那条纪律）；② `contract_gate` 的 `Lang`
 *   是**被代码读的类型**，它用短码；③ 另两处语言代号（`derive_chain` / `trace_exec`）也是短码。
 *   ★ TS/JS 家族仍叫 `ts`（它覆盖 `TS_JS_EXTS`，与 `contract_gate` 的同名包一致）。
 *
 * ★★ 目录规则（2026-10-05 立，T28）：**本目录里，一个文件 = 一门语言**。
 *   · 每个 `languages/<lang>.ts` **只放该语言特有的东西**（节点类型表 / 模块声明取法 / 常量），
 *     并导出自己的 `analyze<X>Source` + `rename<X>Symbol`；
 *   · **两门语言共用的算法不进本目录** —— 住 `../namespace_family.ts`（C#/Java 共用分析器工厂
 *     + 改名引擎）。那个文件名里的 "family" 就是它的身份说明：**它是"族"，不是语言**。
 *   · **语言文件之间零 import**（本目录内只有 `registry.ts` 可以 import 各语言包）。
 *
 *   ★ 为什么立这条：改前 `cs.ts` 与 `java.ts` **互相 import**（工厂住 cs、引擎住 java），
 *     靠"单向"躲开环 ⇒ **两个文件各自装着对方语言的零件**，是"一个文件一门语言"的反例。
 *     那种形状还有个更坏的后果：**impl 住 A 文件、exts 写在 registry 里** ⇒
 *     注册表可以悄悄让 A 的函数去服务 B 的扩展名，**没有任何东西会反对**。
 *   ⇒ 现在 impl 与「它的语言」同文件，注册表只剩查表。
 *   ★ 注意：**`code_health` 抓不到改前那种形状**（单向 import 不成环，也不是分层违规）
 *     ⇒ 这条规则目前**只在文档与头注里**，没有机器判据（见 `docs/todo.md`）。
 */
import { TS_JS_EXTS } from '../../../../infrastructure/parse/index.js';
import { renameTsSymbol } from './ts.js';
import { renameGoSymbol } from './go.js';
import { renamePythonSymbol } from './py.js';
import { renameCSharpSymbol } from './cs.js';
import { renameJavaSymbol } from './java.js';
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
    rename: (a) => renameCSharpSymbol(a),
  },
  {
    exts: ['.java'],
    rename: (a) => renameJavaSymbol(a),
  },
  {
    exts: ['.c', '.h'],
    rename: (a) => renameCSymbol({ file: a.file, symbol: a.symbol, to: a.to, dryRun: a.dryRun, resolvedRoot: a.resolvedRoot, blocked: a.blocked }),
  },
];

export function findLangPackage(ext: string): LangPackage | undefined {
  return LANG_PACKAGES.find((p) => p.exts.includes(ext));
}
