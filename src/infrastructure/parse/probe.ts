/**
 * 探测 tree-sitter 语言包是否**可用**：两级判定 —— ① 可解析（resolve 得到）② 可载入（真筛子）。
 * 用标准 ESM resolver (import.meta.resolve) 解析，而非扫 node_modules 目录名。resolve 从
 * 【本模块所在包】向上解析，天然定位到 agent-io 自带 node_modules，与进程 cwd 无关——修复深度
 * 注入（宿主进程 cwd 非 agent-io）下被误判"语言未装"→ parseFileFull 0 符号的问题；也让"该用哪个
 * language 包"的判定可复用于 AST 引擎等任何按语言探依赖的场合。
 *
 * resolve 同步、不加载 native（只解析路径）：成功=包可解析，抛 ERR_MODULE_NOT_FOUND=未装。
 *
 * ★★ 2026-09-29 补第二级「真筛子」（以下称筛子）—— **只 resolve 成功不等于能用**：
 *   本机实测 36 个 tree-sitter-* 语言包**全部可 resolve**，但只有 20 个真能载入；其余 16 个
 *   （css/markdown/yaml/vue/toml/xml/lua/clojure/latex/graphql/sql/scheme/verilog/zig/cue/dart）
 *   装上也是死包：老 nan.h 模板导出的不是 tree-sitter 0.21 认的 N-API 语言对象 ⇒
 *   setLanguage 抛 "Invalid language object"，或二进制压根没编出来 ⇒ MODULE_NOT_FOUND。
 *   把"死包"当"已装"的两个后果，都在测试里踩到过：
 *     · prewarmKernel 逐个 import 死包 ⇒ stderr 刷 [ts_kernel] load tree-sitter-x failed（噪音）；
 *     · .md/.css 等被判"受支持但未预热" ⇒ 写闸（write_gate 的预热闸，契约是"绝不半同步"）
 *       整批落回 L1b ⇒ 生成物该当场写穿却只登记（scaffold 的"同步写穿"回执消失）。
 *   ⇒ 判据本身**不在本文件复述**：复用具权威实现（见 `isLoadablePackage` 的注释与 import 处的说明）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, findLanguageByExt, LanguageEntry } from './languages.js';
/**
 * ★ 真筛子的判据：`./template_compat.js` 的 `templateCompatFromPkgJson`（**唯一权威**）。
 *   `list`/`check`/`install` 三处共用同一判据（注释里逐字写着"本地读 / registry 元数据走同一判据，
 *   **不抄第二份**"）⇒ 这里**复用**，不在内核里再写一份（本仓 G4「同一意图只有一份实现」）。
 *   ★ 2026-09-30：原先它住在 `tools/install_package_cli.ts`（工具 CLI）里，内核去引 CLI 是
 *   **下层依赖上层**；搬 ⑥ 后架构门的 `layer-downward-only` **真的亮了** ⇒ 按本文件原注释
 *   自己写下的处置办法，把那个纯函数抽到 `infrastructure/parse/template_compat.ts`，两边都引它。
 */
import { templateCompatFromPkgJson } from '../packages/template_compat.js';

/**
 * 语言包可解析性判定用了两套 resolver，按可用性依次回退：
 *   - import.meta.resolve：标准 ESM resolver，从【本模块所在包】向上解析，
 *     与进程 cwd 无关（修复深度注入下被误判"语言未装"→ 0 符号）。
 *   - createRequire(import.meta.url).resolve：vitest/vite 转换环境里
 *     import.meta.resolve 对裸包名解析不可用（会被当虚拟模块），回退到
 *     CommonJS 的 require.resolve，从模块真实落盘位置解析 node_modules——
 *     let 测试环境（tests/）与运行时（dist/）都能探到已安装语言包。
 */
const nodeRequire = createRequire(import.meta.url);

/** import.meta.resolve 给的是 file: URL，createRequire 给的是路径 —— 统一成文件系统路径 */
function toFsPath(u: string): string {
  return u.startsWith('file:') ? fileURLToPath(u) : u;
}

function resolvePackage(pkgName: string): string | null {
  const meta = import.meta as unknown as { resolve?: (specifier: string) => string };
  if (typeof meta.resolve === 'function') {
    try {
      return toFsPath(meta.resolve(pkgName));
    } catch {
      /* fall through */
    }
  }
  try {
    return nodeRequire.resolve(pkgName);
  } catch {
    return null;
  }
}

/** 从已解析的入口文件向上找**最近**的 package.json（= 该文件所属包的清单），6 层封顶 */
function nearestPackageJson(entryFile: string): string | null {
  let dir = path.dirname(entryFile);
  for (let i = 0; i < 6; i++) {
    const cand = path.join(dir, 'package.json');
    if (fs.existsSync(cand)) return cand;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * ★★ 真筛子：这个包**能不能载入**（纯文件判定：读它的 package.json，不 import、不 spawn）。
 *
 * ★ 判据**不在本文件**：委派给权威实现 `templateCompatFromPkgJson`
 *   （`scripts.install === 'node-gyp-build'` = prebuildify 模板 ⇒ 导出 N-API 语言对象 ⇒ 可载入；
 *   其它（老 nan.h 模板 / 没有 install 脚本）⇒ 装上必失败）。**没有任何包名清单** ——
 *   硬编码那 15 个包名就是手抄清单，环境一变（包换版本/换模板）就腐；而"安装模板"是包自身的
 *   结构性事实，与包名无关。本机 36 包实测：模板兼容的 20 个 20/20 真载入，
 *   其余 16 个 0/16（10 个 require 就挂、6 个 setLanguage 抛 Invalid language object）。
 *
 * ★ 为什么**不**把 `prebuilds/<platform>-<arch>/` 是否存在并入判据（主线原方案要求"两条件"）：
 *   实测它会**误杀真能用的包** —— `tree-sitter-kotlin` 无 prebuild、但有本机 node-gyp 编好的
 *   `build/Release/*.node`，实测载入成功（上一笔刚把 kotlin 做通）。仓内对 prebuild 的定位本来
 *   也只是"要不要现场编译"的**提醒**（`compatVerdict` 的 '⚠ 可载入，但本机无 prebuild'），
 *   不是可载入判据 ⇒ 一并入判据就把提醒升级成了否决，方向反了。
 *
 * ★ 兜底（筛子只读清单，故有误判风险）：过了筛子却仍载入失败的（版本漂移等），
 *   `loader.loadLanguage` 会**记一次** warning 并把该包缓存为不可用（同一包不刷屏）。
 */
export function isLoadablePackage(pkgJsonPath: string): boolean {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return false; // 清单读不出/坏了 ⇒ 不能声称可用
  }
  return templateCompatFromPkgJson(pkg) === 'ok';
}

/** 该裸包名解析到的入口所属包是否过了真筛子（解析不到 ⇒ false） */
function resolvedIsLoadable(pkgName: string): boolean {
  const entry = resolvePackage(pkgName);
  if (entry === null) return false;
  const pkgJson = nearestPackageJson(entry);
  return pkgJson !== null && isLoadablePackage(pkgJson);
}

/** 已确认可用（可解析 ∧ 过真筛子）的语言包缓存 */
let loadable = new Set<string>();
/** 已确认不可用的语言包缓存（避免反复 resolve 失败） */
let unloadable = new Set<string>();

/**
 * 判定某 tree-sitter 语言包是否**可用**（同步；只 resolve + 读它的 package.json，不加载 native）。
 * 注意语义是"可用"而不是"装在盘上"：装了但载入必失败的包（老 nan.h 模板）判为 false，
 * 调用方据此不去 import 它（消灭 stderr 噪音 + 加速），也不把它算进"受支持扩展名"。
 */
export function isLanguageInstalled(pkgName: string): boolean {
  if (loadable.has(pkgName)) return true;
  if (unloadable.has(pkgName)) return false;
  if (resolvedIsLoadable('tree-sitter-' + pkgName)) {
    loadable.add(pkgName);
    return true;
  }
  unloadable.add(pkgName);
  return false;
}

/** 探测可用的语言（LANGUAGES 中可解析且过真筛子的子集） */
export function probeInstalledLanguages(): LanguageEntry[] {
  return LANGUAGES.filter((l) => isLanguageInstalled(l.pkg));
}

/** 检查某扩展名是否受支持（且对应语言包**可用**） */
export function isExtSupported(ext: string): LanguageEntry | null {
  const lang = findLanguageByExt(ext);
  if (!lang) return null;
  if (!isLanguageInstalled(lang.pkg)) return null;
  return lang;
}

/** 强制重置缓存（用于测试或配置变更后） */
export function resetProbeCache(): void {
  loadable.clear();
  unloadable.clear();
}

/** 获取所有可用扩展名 */
export function listSupportedExts(): string[] {
  return probeInstalledLanguages().flatMap((l) => l.exts);
}
