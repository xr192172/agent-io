#!/usr/bin/env node
/**
 * ★★★ 通用 CLI —— 从**唯一真相源**投影出的命令行入口（2026-09-30）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么有它（用户裁定 + 实测的真缺陷）
 * ─────────────────────────────────────────────────────────────
 *   > 「有很多本身它既有 MCP 工具又有 CLI 工具的……把那些 CLI 工具等**全部清除只留 MCP 工具**。
 *   >   然后**后续再通过唯一真相源投影出 CLI 工具**。」
 *
 *   **唯一真相源 = `registry/lanes/*.ts` 的 `ToolDef`** —— MCP 面本来就已从它投影
 *   （`LANE_SOURCES` → `TOOL_DEFS` → `registerTool`）。本文件只是**再投影一个面**，不新造机制。
 *
 *   ★ **投影的价值不只是消重，是修一个真缺陷**：实测 5 个手写 CLI
 *     （`health_cli` / `impact_cli` / `behavior_cli` / `cross_repo_cli` / `hybrid_cli`）
 *     **全都没有**「每次调用前保鲜 / 陈旧告警 / 狗食统计」（各 0 命中）⇒ 它们跑的是
 *     **旧索引 + 无任何标注**，给出不可信的结果**还不说**。
 *     本文件走 `invokeTool()`（与 MCP 面**同一个入口**）⇒ 这些能力**结构上自动获得**。
 *
 * ─────────────────────────────────────────────────────────────
 * 用法
 * ─────────────────────────────────────────────────────────────
 *   node dist/src/cli.js list                      列出全部工具（名字 + 一句话）
 *   node dist/src/cli.js list --json               同上，机器可读
 *   node dist/src/cli.js <name> --json '{"a":1}'   调一个工具（入参走 JSON）
 *   node dist/src/cli.js <name> --input args.json  入参从文件读
 *   echo '{"a":1}' | node dist/src/cli.js <name> - 入参从 stdin 读
 *   node dist/src/cli.js <name>                   入参 = {}（等价 MCP 的无参调用）
 *
 * 退出码：0 = 成功；1 = 工具报错（`isError`）；2 = 用法错/工具名不存在。
 *
 * ★ 纪律：本文件**不许**自己加"保鲜 / 告警 / 统计" —— 那些在 `invokeTool` 里，
 *   在这里重做一遍就又造出了第二份口径（本仓最贵的病）。
 */
import fs from 'node:fs';
import { TOOL_DEFS, invokeTool } from './server_registry.js';

function die(msg: string): never {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(2);
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
  process.stdout.write(
    [
      '用法:',
      '  cli list [--json]                   列出全部工具',
      "  cli <name> [--json '{...}']         调一个工具",
      '  cli <name> --input args.json        入参从文件读',
      "  echo '{...}' | cli <name> -         入参从 stdin 读",
      '',
      `共 ${TOOL_DEFS.length} 个工具（唯一真相源：registry/lanes/*.ts 的 ToolDef）。`,
      '',
    ].join('\n'),
  );
  process.exit(0);
}

// ── list ────────────────────────────────────────────────────────────────────
if (cmd === 'list') {
  const asJson = argv.includes('--json');
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        TOOL_DEFS.map((d) => ({ name: d.name, title: d.title, description: d.description })),
        null,
        2,
      ) + '\n',
    );
  } else {
    const w = Math.max(...TOOL_DEFS.map((d) => d.name.length));
    for (const d of TOOL_DEFS) process.stdout.write(`${d.name.padEnd(w)}  ${d.title}\n`);
    process.stdout.write(`\n共 ${TOOL_DEFS.length} 个工具\n`);
  }
  process.exit(0);
}

// ── 调一个工具 ───────────────────────────────────────────────────────────────
const def = TOOL_DEFS.find((d) => d.name === cmd);
if (!def) {
  const like = TOOL_DEFS.map((d) => d.name).filter((n) => n.includes(cmd) || cmd.includes(n.slice(0, 4)));
  die(`未知工具名: ${cmd}${like.length ? `\n你是不是想找: ${like.slice(0, 5).join(', ')}` : ''}\n用 \`cli list\` 看全部。`);
}

/** 取入参：--json / --input / stdin / 空对象 */
async function readArgs(): Promise<Record<string, unknown>> {
  const iJson = argv.indexOf('--json');
  if (iJson >= 0) {
    const raw = argv[iJson + 1] ?? die('--json 后面要给一段 JSON');
    return JSON.parse(raw) as Record<string, unknown>;
  }
  const iIn = argv.indexOf('--input');
  if (iIn >= 0) {
    const f = argv[iIn + 1] ?? die('--input 后面要给文件路径');
    return JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, unknown>;
  }
  if (argv.includes('-')) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }
  return {};
}

let args: Record<string, unknown>;
try {
  args = await readArgs();
} catch (e) {
  die(`入参不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
}

// ★ 走**唯一调用入口** —— 保鲜 / 首触 / 纠错 / 狗食 / 告警注入全在这里，与 MCP 面逐字同路径。
const r = await invokeTool(def, args);
process.stdout.write(r.text.endsWith('\n') ? r.text : r.text + '\n');
process.exit(r.isError ? 1 : 0);
