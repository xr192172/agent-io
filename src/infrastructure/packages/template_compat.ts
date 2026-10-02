/**
 * ★ 装包模板兼容性判据（**从 `presentation/cli/install_package_cli.ts` 抽出来的纯函数**）
 *
 * 为什么抽：搬 ⑥ 时架构门的 `layer-downward-only` **真的亮了** ——
 *   `src/infrastructure/parse/probe.ts → src/presentation/cli/install_package_cli.ts`
 *   （下层内核去引上层的 CLI）。该文件里原本就写着处置办法：
 *   「若日后要归位，应把这个纯函数抽到更底层的共享模块、两边都引它，而不是各自实现。」
 *   ⇒ 规则一点亮，"日后"就是现在。
 * 判据本身零依赖（不 import 任何东西）⇒ 放在 `infrastructure/parse/` 名下不欠任何债。
 *
 * 消费者：`infrastructure/parse/probe.ts`（探测已装解析器）、`presentation/cli/install_package_cli.ts`（装包预检）。
 */

/**
 * 装包模板兼容性 —— ★★ 本仓的「真筛子」（2026-09-29 侦察，8/8 命中 vs 0/15，无一例外）：
 *
 * 为什么 peer 声明靠不住：核心 `tree-sitter@0.21.1` 用 **N-API 的 LANGUAGE_TYPE_TAG**
 * 约定去认「语言对象」。包的**安装模板**决定它导出的是不是这种对象：
 *   · `scripts.install === 'node-gyp-build'`（prebuildify 模板）⇒ 导出 N-API 语言对象 ⇒ 可载入
 *   · 其它（老 `nan.h` 模板 / 干脆没有 install 脚本）⇒ `require` 可能成功，但 `setLanguage`
 *     抛 "Invalid language object"，或连 binding 都没编出来 ⇒ **装上也用不了**
 * 本机实测（36 个已装包，逐个真 `require` + `setLanguage` + `parse`）：
 *   `node-gyp-build` 的 20 个 → **20/20 可载入**；其余 16 个 → **0/16**（10 个 require 就挂、
 *   6 个 setLanguage 抛 Invalid language object）。
 *
 * 第二层信号（只作"要不要现场编译"的提醒，**不作**可载入判据）：
 *   `prebuilds/<platform>-<arch>/` 里有 .node ⇒ 装上即用；没有 ⇒ 靠本机 node-gyp 编译。
 *   实测例外：tree-sitter-kotlin 无 prebuild 但本机编译成功、仍可载入 ⇒ 缺 prebuild 不等于不可用。
 *
 * 用途：`list` 把已装的**标红**、`install` 在真正 npm install **之前**用 registry 元数据
 * 预检（而不是让它静默进 optionalDependencies、等运行时才炸）。
 */
export type TemplateCompat = 'ok' | 'incompatible' | 'unknown';

/** 纯函数：从 package.json 内容判模板兼容（本地读 / registry 元数据走同一判据，不抄第二份） */
export function templateCompatFromPkgJson(j: Record<string, unknown> | null): TemplateCompat {
  if (!j) return 'unknown';
  const scripts = j.scripts as Record<string, unknown> | undefined;
  const install = scripts?.install;
  return install === 'node-gyp-build' ? 'ok' : 'incompatible';
}
