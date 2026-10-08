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

/**
 * ★★ 本层的**唯一概念**：这个包的**绑定属于哪一代**。
 *
 * 判据的靶子是「它导出的是不是核心认的 **N-API 语言对象**」，而这**只**取决于"绑定是哪一代"——
 * "模板长什么样""install 脚本叫什么"都只是它的**影子**。
 * ⇒ 做成**穷尽的枚举**，而不是几条布尔的组合：原先这里是
 * `usesNan` / `installScript` / `hasBuiltBinding` 三条事实在**一条 if 链**里排队，
 * 读的人分不清谁是判据、谁是线索（2026-10-08 用户点出"别再打补丁"之后收成这个形状）。
 */
export type BindingGeneration =
  | 'nan'             // 老 `nan.h` 模板：`require` 可能成功，但 `setLanguage` 抛 Invalid language object
  | 'napi-template'   // `node-addon-api` + `node-gyp-build`（prebuildify）⇒ 标准 N-API 语言对象
  | 'self-built'      // 包**自带已构建产物**（本仓用通用 N-API 绑定从语法源码编出来的那批）⇒ 同样导出语言对象
  | 'no-napi-export'; // 三者皆非：无 `nan`、无 `node-gyp-build` 脚本、也没有自带产物
// ★ **没有 `'unknown'` 成员**（2026-10-08 自己纠正）：代际只在**有事实可判**时才存在；
//   "拿不到清单"是**入口层**的状态（`templateCompatFromPkgJson(null)` ⇒ 直接 'unknown'），
//   不该由分类器冒出——否则 `install-package check` 会对"装了但元数据缺 `dependencies`"的包
//   说出「？未装」那句**错话**（我的第一版这么干了，是**行为降级**，已改回）。

/** 判"代际"所需的**事实** —— 三条来源不同：清单里两条、**本地磁盘**一条 */
export interface BindingFacts {
  /** 依赖里写着 `nan`？`null` = 拿不到清单（未装 / registry 查不到）—— **不许当成 false** */
  usesNan: boolean | null;
  /** `scripts.install` 的值；`null` = 没有这个脚本 */
  installScript: string | null;
  /** ★ 本地看得见：包自带 `build/Release/*.node`？`null` = 不知道（registry 元数据那条路拿不到这条事实） */
  hasBuiltBinding: boolean | null;
}

/**
 * ★★ **唯一分类处**：事实 → 代际。顺序即优先级，理由逐条写在下面（别再往调用方散落 if）。
 * 本仓任何地方要判"这个包能不能载入"，都**只**调 `bindingGenerationOf` 或 `bindingVerdictOf`。
 */
export function bindingGenerationOf(f: BindingFacts): BindingGeneration {
  if (f.usesNan === true) return 'nan';                 // ① **因果判据**：NAN ≠ N-API（核心 0.21 只认后者）
  if (f.hasBuiltBinding === true) return 'self-built';  // ② **直接证据**：产物在盘上 ⇒ 比"模板指纹"硬
  if (f.installScript === 'node-gyp-build') return 'napi-template'; // ③ **模板指纹**（最弱的一条）
  // ★ `usesNan === null`（拿不到 `dependencies`）**不**改判：退回指纹继续判（= 本文件旧有的"② 级"行为）。
  return 'no-napi-export';
}

/** ★ 代际 → verdict：**穷尽映射**（5 → 3）。枚举加成员时，TS 会在这里报缺分支 —— 这就是要的效果。 */
export function bindingVerdictOf(gen: BindingGeneration): TemplateCompat {
  switch (gen) {
    case 'napi-template':
    case 'self-built':
      return 'ok';
    case 'nan':
    case 'no-napi-export':
      return 'incompatible';
  }
}

/**
 * 纯函数：从 package.json 内容判模板兼容（本地读 / registry 元数据走**同一判据**，不抄第二份）。
 * ★ 这是**入口形态①**（手上有清单）；手上只有事实时用 `templateCompatFromFacts`（形态②）。
 * @param opts.hasBuiltBinding 本地只见得到的一条事实：该包自带已构建的 native 产物。
 *        `null` = 不知道（registry 元数据那条路没有这条事实）。
 */
export function templateCompatFromPkgJson(
  j: Record<string, unknown> | null,
  opts?: { hasBuiltBinding?: boolean | null },
): TemplateCompat {
  if (!j) return 'unknown';
  const scripts = j.scripts as Record<string, unknown> | undefined;
  return templateCompatFromFacts(
    usesNanBinding(j),
    typeof scripts?.install === 'string' ? scripts.install : null,
    opts?.hasBuiltBinding ?? null,
  );
}

/**
 * ★ **入口形态②**：手上不是一份清单、而是**三条事实**时用它。
 *
 * 为什么需要（实测逼出来的）：`install-package check` 问的是 **registry 元数据**，而
 * `npm view x version scripts.install dependencies --json` 把字段**拍平**成 `'scripts.install'`
 * 这种**带点的键**（与本地 package.json 的嵌套形状不同）。为了复用形态①去现造一份假清单
 * = **拿形状去骗判据**（正是本仓 §2.3 那条病）。⇒ 判据落到"事实"这一层，两种形态都喂它，**只有一份逻辑**。
 * @param usesNan      依赖里有没有 `nan`（`null` = 上游没声明 dependencies / 取不到）
 * @param installScript `scripts.install` 的值（`null` = 没有这个脚本）
 * @param hasBuiltBinding 该包是否**自带已构建产物**（`<pkg>/build/Release/*.node` 在盘上）；
 *        `null` = 不知道（registry 那条路拿不到）。★ 这条是 2026-10-08 加的：
 *        本仓自建的那批（`agent-io-grammar-*`）既无 `nan`、也没有 `node-gyp-build` 脚本，
 *        但它们**真带产物、真加载 8/8 通过** ⇒ 旧判据把它们判死 ⇒ **整门语言的功能走不到**（`isSupported` 返 false）。
 */
export function templateCompatFromFacts(
  usesNan: boolean | null,
  installScript: string | null,
  hasBuiltBinding: boolean | null = null,
): TemplateCompat {
  return bindingVerdictOf(bindingGenerationOf({ usesNan, installScript, hasBuiltBinding }));
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
 * @param compat verdict（`bindingVerdictOf` 的产物）
 * @param usesNan 该包是不是 NAN 绑定（`null` = 拿不到清单）—— 决定"为什么不可用"那句怎么写
 * @param gen    ★ 可选：有**代际**时按代际说（能区分"自带产物"那一路）；不传则退回旧的两参措辞
 *               （`lang_hint.ts` 只传两个参数，保持兼容）。
 */
export function templateCompatReason(
  compat: TemplateCompat,
  usesNan: boolean | null,
  gen?: BindingGeneration,
): string {
  if (compat === 'unknown') return '？未装（离线判不出，用 `check <lang>` 查 registry 元数据）';
  if (compat === 'ok') {
    return gen === 'self-built'
      ? '✅ 可用（本仓自建：用通用 N-API 绑定从语法源码编出，**自带产物**）'
      : '✅ 模板兼容（node-gyp-build ⇒ N-API 语言对象）';
  }
  if (gen === 'no-napi-export') {
    return '❌ 载入必失败：既无 `nan`、也无 `node-gyp-build` 安装脚本、更没有自带产物 ⇒ 拿不到 N-API 语言对象';
  }
  return usesNan === true
    ? '❌ 载入必失败：依赖 `nan`（NAN 绑定）⇒ 核心 tree-sitter 0.21 只认 N-API 语言对象，`setLanguage` 抛 Invalid language object'
    : '❌ 载入必失败：没有 `node-gyp-build` 安装脚本（多为老 nan.h 模板）';
}
