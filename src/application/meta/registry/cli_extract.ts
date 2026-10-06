/**
 * cli_extract —— CLI 入口提取器（功能清单的另一半真相层）
 *
 * 用户定调（2026-08-25）：有些功能只有 CLI 没有 MCP（当时举例 signal_review_cli），
 * 有些只有 MCP。功能中心必须把两种入口统一采集，才能成为完整的功能注册面。
 *
 * ★ 2026-10-06（T15）后记：那条「CLI-only」通道已基本归零 —— 手写 CLI 从 13 删到 5，能力一律归位到
 *   **MCP 注册**（`ToolDef`），argv 面由 `cli.js <工具名>` 投影提供。本提取器仍保留：
 *   它采集的是**尚未注册**的能力（当前还剩几个手写 CLI），不是"两种入口并存"的长期形态。
 *
 * 本模块纯确定性（零 LLM）：
 *   - 扫描 tools/ 下 *_cli.ts（约定式 CLI 入口）
 *   - 文件头注释首行「xxx_cli —— 人话描述」提取 name + desc
 *   - usage: 字符串提取参数清单
 *   - 相对 import → 实现模块连线（与 registry_extract 同法）
 *
 * 暴露形态合并规则（collect_functions.ts）：
 *   CLI 名去 `_cli` 后缀后与 MCP 工具名相等 → 双入口（both）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseRelativeNamedImportMap } from '../../../infrastructure/parse/import_text.js';

export interface CliCommand {
  /** 规范名（去 _cli 后缀，用于与 MCP 工具名对齐） */
  name: string;
  /** 文件名（含 _cli.ts） */
  file: string;
  /** 人话描述（文件头注释首行破折号后） */
  desc: string;
  /** usage 参数清单（原样） */
  usage: string;
  /** 实现模块（相对路径无扩展名） */
  implModules: string[];
}

export interface CliExtractResult {
  commands: CliCommand[];
  /** 扫描的目录 */
  source: string;
}

/**
 * 相对具名 import：symbol → 模块（如 'tools/brickify_cli'）。含多行 import。
 * ★ 实现已收进内核唯一落点 `ts_kernel/import_text.ts`（B1，2026-09-28）——
 *   本函数与 `registry_extract.ts` 的同名函数曾是**逐字相同**的两份。
 */
const extractImportMap = parseRelativeNamedImportMap;

/** 扫描目录下 *_cli.ts，提取 CLI 命令清单。 */
export function extractCliCommands(dir: string): CliExtractResult {
  const abs = path.resolve(dir);
  const files = fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('_cli.ts') && !f.endsWith('.d.ts'))
    .sort();

  const commands: CliCommand[] = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(abs, f), 'utf-8');

    // 头注释首行「xxx_cli —— 人话描述（…）」（例：仍存在的手写 CLI `brickify_cli`）
    const head = src.match(/^\/\*\*\s*\n\s*\*\s*([A-Za-z_]+)\s*[—-]{1,2}\s*(.+)/);
    const name = (head?.[1] ?? f.replace(/\.ts$/, '')).replace(/_cli$/, '');
    const desc = head?.[2]?.replace(/\*\/.*/, '').trim() ?? '';

    // usage 串
    const usageM = src.match(/usage:\s*([A-Za-z_]+_?cli?)\s+(.+)/);
    const usage = usageM ? `--${usageM[2].split("'")[0]}` : '';

    // import 连线：main() 体内被调用的 import 符号
    const importMap = extractImportMap(src);
    const mainBody = src.slice(src.indexOf('async function main') >= 0 ? src.indexOf('async function main') : 0);
    const hits: string[] = [];
    for (const [sym, mod] of importMap) {
      if (new RegExp(`\\b${sym.replace(/[$]/g, '\\$&')}\\(`).test(mainBody) && !hits.includes(mod)) {
        hits.push(mod);
      }
    }

    commands.push({ name, file: f, desc, usage, implModules: hits });
  }
  return { commands, source: abs };
}
