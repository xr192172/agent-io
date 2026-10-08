/**
 * ★ 语言包 ABI 钉版表（**从 `presentation/cli/install_package_cli.ts` 抽出来的常量**）
 *
 * 为什么抽：搬 T11 时落点检查发现 `src/tools/lang_hint.ts:39` 引的是
 * `presentation/cli/install_package_cli.js` 的 `PACK_PINS` ⇒ 该文件若落 `infrastructure/`，
 * 就成了 **infrastructure → presentation**（下层依赖上层）。
 * ★ 那个文件里原本已写明「`lang_hint` 要**复用本表**、不许另抄一份」—— **避免第二真相源是对的**，
 *   只是**落错了层**；层规则现在把它的正确位置指出来了：它属"tree-sitter 包元数据"，该住内核层。
 * 消费者：`presentation/cli/install_package_cli.ts`（装包预检/索引）、`tools/lang_hint.ts`（缺失提示带钉版）。
 */

/**
 * 语言包 ABI 钉版表：已实测与 `tree-sitter@0.21` 核心兼容的版本（含 bindings 导出 .language）。
 * 加语言包 = 在此登记 {pkg 版本} + 在 LANGUAGES/适配器/resolver 各加一行。
 *
 * ★ 导出（2026-09-29）：`lang_hint.ts` 的缺失提示要带钉版，**复用本表**而不是另抄一份
 *   （另抄一份 = 第二个真相源，装包换了钉版告示不跟着换）。本模块顶层无副作用，可安全 import。
 */
export const PACK_PINS: Record<string, string> = {
  go: '^0.21.2',
  python: '^0.21.0',
  java: '^0.23.5',
  rust: '^0.21.0',
  'c-sharp': '^0.21.3', // note: LANGUAGES.pkg 用的是 'c-sharp'（tree-sitter-c-sharp）
  php: '^0.23.12',
  // ★★ 2026-10-08 新增：本机 `node_modules` 里那份 css 是 **0.20.0**（`nan` 绑定 ⇒ 载入必失败），
  //   而它**不是我们装的** —— 是 `tree-sitter-scss` 的**传递依赖**（`tree-sitter-css: ^0.20.0`）。
  //   上游**同核心线上**的 0.21.0 是 N-API（peer `tree-sitter ^0.21.0`）⇒ 实测（隔离目录
  //   `.inspect/fx-css`，核心 0.21.1）`setLanguage` + `parse` 出 `stylesheet` ✓ 真能读。
  //   ★ 注意**不能装 latest**：0.25.0 要核心 `^0.25.0`，装了当场 ERESOLVE。
  css: '^0.21.0',
};
