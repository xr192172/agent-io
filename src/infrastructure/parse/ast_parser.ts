/**
 * ast_parser —— 同步兼容层：给**需要同步 parse 的旧调用方**（如 consistency.ts）保留 sync 接口。
 *
 * 内部转调本目录 `kernel.ts` 的 async API。
 * 提供 isSupportedFile() 同步检查扩展名是否支持。
 *
 * 注意：parseFileSymbols 是 async（因为 kernel 内部 lazy-load）。
 * 旧的同步调用方需迁移到 await。
 *
 * ★ 2026-10-06（T20 尾巴，清过期引用）：本头注原先写「让旧代码（consistency.ts / backfill.ts）
 *   继续用 sync 接口」与「转调 ts_kernel 的 async API」—— **两处都指着已不存在的东西**：
 *   `backfill.ts` 已随 T20 删除；`ts_kernel` 已改名并搬到本目录（`parse/`）。
 */

import { isSupported, parseFile, listSupportedLanguages, listSupportedExtensions } from './index.js';
import type { ParsedSymbol } from './index.js';

export { parseFile as parseFileSymbolsAsync } from './index.js';
export type { ParsedSymbol };

/** 同步检查文件是否被支持（只检查扩展名 + 是否已安装） */
export function isSupportedFile(filePath: string): boolean {
  const ext = '.' + (filePath.split('.').pop() || '');
  return isSupported(ext);
}

/** 异步版本（推荐） */
export async function parseFileSymbols(filePath: string, content: string): Promise<ParsedSymbol[]> {
  return parseFile(filePath, content);
}

export { listSupportedLanguages, listSupportedExtensions };
