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
 * 约定去认「语言对象」。包的**绑定方式**决定它导出的是不是这种对象：
 *   · **N-API**（`node-addon-api` + `node-gyp-build` / prebuildify）⇒ 导出 N-API 语言对象 ⇒ 可载入
 *   · **NAN**（老 `nan.h` 包，依赖里写着 `nan`）⇒ `require` 可能成功，但 `setLanguage`
 *     抛 "Invalid language object"，或连 binding 都没编出来 ⇒ **装上也用不了**
 *
 * ★★★ 2026-10-08 更正判据本身（本仓 §2.3「我数的是判据本身，还是判据的影子」第 N 次）：
 *   原来这里**只看 `scripts.install === 'node-gyp-build'`** —— 那是**模板指纹**，是**影子**；
 *   **因果判据是「依赖里有没有 `nan`」**（NAN ≠ N-API，核心 0.21 只认 N-API）。
 *   本机实测（28 个已装包，**逐个真 `import` + `setLanguage` + `parse`**，见 `.inspect/probe_sieve.mjs`）：
 *   ```
 *   交叉表:  nan=true  筛子=❌ ⇒ 真加载 FAIL  10/10   （css cue dart lua markdown sql toml vue yaml zig）
 *            nan=false 筛子=✅ ⇒ 真加载 OK    18/20   （另 2 个是 typescript / php）
 *   ```
 *   ★ 那 2 个例外**不是包的错**：`tree-sitter-typescript` 导出 `{typescript, tsx}`、
 *     `tree-sitter-php` 导出 `{php, php_only}` —— 都是**具名导出袋**，探针取 `default` 自然不是
 *     语言对象；agent-io 的 loader 对这两个有**专门处理**（`loader.ts` 两处 `if`），所以它们可用。
 *   ⇒ 在这个样本上 `nan` 与真加载 **10/10 + 18/18 一致**；`scripts.install` 只是恰好同向。
 *
 * ★★ 另一条不能忘的（同一个实验顺手证到）：**「过不了筛子」≠「装/重装都无用」** ——
 *   判据只看**本机磁盘上这一份**，而上游可能早已换 N-API。实测 `tree-sitter-css`：
 *   本机 0.20.0（`nan` ✔）**是 `tree-sitter-scss` 的传递依赖**，而上游最新 **0.25.0** 已是
 *   `node-gyp-build`、无 `nan` ⇒ **装上游最新版就能读**。⇒ 任何"装包无效"的结论**必须先联网核上游**
 *   （`install-package check <lang>`），不能只看本机那份就下判决。
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
  return templateCompatFromFacts(usesNanBinding(j), typeof scripts?.install === 'string' ? scripts.install : null);
}

/**
 * ★ 同一判据的**第二个入口形态**：手上不是一份清单、而是**两个事实**时用它。
 *
 * 为什么需要（实测逼出来的）：`install-package check` 问的是 **registry 元数据**，而
 * `npm view x version scripts.install dependencies --json` 把字段**拍平**成 `'scripts.install'`
 * 这种**带点的键**（与本地 package.json 的嵌套形状不同）。为了复用 `templateCompatFromPkgJson`
 * 去现造一份假清单 = **拿形状去骗判据**（正是本仓 §2.3 那条病）。⇒ 判据收到"两个事实"这一层，
 * 两种形态都喂它，**只有一份逻辑**。
 * @param usesNan      依赖里有没有 `nan`（`null` = 上游没声明 dependencies / 取不到）
 * @param installScript `scripts.install` 的值（`null` = 没有这个脚本）
 */
export function templateCompatFromFacts(usesNan: boolean | null, installScript: string | null): TemplateCompat {
  // ★ 因果判据优先：依赖 `nan`（NAN 绑定）⇒ 核心 0.21 只认 N-API 语言对象 ⇒ 必失败。
  if (usesNan === true) return 'incompatible';
  // ② 级（模板指纹）：既不是 NAN、也没有 node-gyp-build 安装脚本 ⇒ 拿不到 N-API 语言对象。
  return installScript === 'node-gyp-build' ? 'ok' : 'incompatible';
}

/**
 * 这个包**是不是 NAN 绑定**（= 依赖里写着 `nan`）—— **因果判据的唯一落点**。
 * 安装后的包与 registry 元数据**同形**（都有 `dependencies`）⇒ 本地读 / 联网查走同一份。
 * `null` = 拿不到清单（未装 / registry 查不到）⇒ **不许当成 false**。
 */
export function usesNanBinding(j: Record<string, unknown> | null): boolean | null {
  if (!j) return null;
  const deps = j.dependencies as Record<string, unknown> | undefined;
  return !!deps && 'nan' in deps;
}

/**
 * 兼容性**人读一句** —— **唯一落点**：`list` / `check` / `install` / `lang_hint` 都调它，别各写一份。
 * @param compat  verdict（`templateCompatFromPkgJson` 的产物）
 * @param usesNan 该包是不是 NAN 绑定（`null` = 拿不到清单）—— 决定"为什么不可用"那句怎么写
 */
export function templateCompatReason(compat: TemplateCompat, usesNan: boolean | null): string {
  if (compat === 'unknown') return '？未装（离线判不出，用 `check <lang>` 查 registry 元数据）';
  if (compat === 'ok') return '✅ 模板兼容（node-gyp-build ⇒ N-API 语言对象）';
  return usesNan === true
    ? '❌ 载入必失败：依赖 `nan`（NAN 绑定）⇒ 核心 tree-sitter 0.21 只认 N-API 语言对象，`setLanguage` 抛 Invalid language object'
    : '❌ 载入必失败：没有 `node-gyp-build` 安装脚本（多为老 nan.h 模板）';
}
