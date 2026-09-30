/**
 * adapters/registry —— 语言适配器注册表（通用内核的唯一入口）
 *
 * 通用内核不 import 任何具体适配器，只经这里按 lang / 扩展名 / 声明文件名取适配器。
 * 新增语言：写一个适配器文件 → 在本文件 import 并加入 adapters 数组即可。
 */

import type { LanguageAdapter, ToolName } from './types.js';
import { javaAdapter } from './java.js';
import { goAdapter } from './go.js';
import { nodeAdapter } from './node.js';
import { pythonAdapter } from './python.js';
import { csharpAdapter } from './csharp.js';
import { cAdapter } from './c.js';
import { missingLanguageHint } from '../../../parse/lang_hint.js';

/** 全部已注册适配器（顺序即探测/验证优先级，go 须在 node 前保持既有行为） */
export const adapters: LanguageAdapter[] = [javaAdapter, goAdapter, nodeAdapter, pythonAdapter, csharpAdapter, cAdapter];

/** 语言代号 → 适配器 */
export function adapterForLang(lang: ToolName): LanguageAdapter | undefined {
  return adapters.find((a) => a.lang === lang);
}

/** 源码扩展名 → 适配器（'.java' → javaAdapter） */
export function adapterForExt(ext: string): LanguageAdapter | undefined {
  const e = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return adapters.find((a) => a.sourceExts.includes(e));
}

/** 声明文件名 → 适配器列表（'.tool-versions' 等多语言共享文件返回多个） */
export function adaptersForFile(name: string): LanguageAdapter[] {
  return adapters.filter((a) => a.declarationFiles.includes(name));
}

/** 内核扫描目录时关注的声明文件全集（去重，含 .tool-versions） */
export const ALL_DECLARATION_FILES: string[] = [
  ...new Set(adapters.flatMap((a) => a.declarationFiles)),
];

/** 各语言默认跳过的构建产物/依赖目录（并入内核默认集） */
export const ADAPTER_SKIP_DIRS: Set<string> = new Set(adapters.flatMap((a) => a.skipDirs ?? []));

/**
 * 全部适配器覆盖的源码扩展名**并集**（由数组派生，不另抄）。
 * 判"这个扩展名到底有没有适配器"要用**并集**，不能用"当前这条声明那门语言的 ext"
 * —— 否则多语言仓库里每个文件都会被记成"未覆盖"（实测踩过：`.nvmrc`(node) 声明下
 * 一个 `a.py` 被误报未覆盖，虽然 python 适配器明明在管它）。
 */
export const ALL_ADAPTER_EXTS: Set<string> = new Set(adapters.flatMap((a) => a.sourceExts));

/**
 * 「取不到适配器」时的**可执行**提示（纯函数）。P11（2026-09-29）。
 *
 * 为什么不让 `adapterForLang` / `adapterForExt` **直接返回原因串**（规划书 §6.3 的原写法）：
 * 它们的返回类型是 `LanguageAdapter | undefined`，改成 `| string` 会让**全部调用点**
 * 都要处理 string 分支（`adapterForExt(ext)?.featureRules` 这种 `?.` 语义直接失效）
 * —— 提示升级不该以破坏契约/类型为代价。故另开一个独立入口，
 * 由"确实遇到了未覆盖扩展名"的调用点（如 `upgrade_cli` 的未覆盖段）按需调用。
 */
export function adapterMissHint(extOrLang: string): string {
  const e = extOrLang.startsWith('.') ? extOrLang : `.${extOrLang}`;
  return missingLanguageHint(e, 'version_upgrade_detection');
}
