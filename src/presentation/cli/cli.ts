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
 *   **唯一真相源 = `application/<线名>/index.ts` 的 `ToolDef`** —— MCP 面本来就已从它投影
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
 *   node dist/src/presentation/cli/cli.js list                      列出全部工具（名字 + 一句话）
 *   node dist/src/presentation/cli/cli.js list --json               同上，机器可读
 *   node dist/src/presentation/cli/cli.js <name> --json '{"a":1}'   调一个工具（入参走 JSON）
 *   node dist/src/presentation/cli/cli.js <name> --input args.json  入参从文件读
 *   echo '{"a":1}' | node dist/src/presentation/cli/cli.js <name> - 入参从 stdin 读
 *   node dist/src/presentation/cli/cli.js <name>                   入参 = {}（等价 MCP 的无参调用）
 *
 * 退出码：0 = 成功；1 = 工具报错（`isError`）；2 = 用法错/工具名不存在。
 *
 * ★ 纪律：本文件**不许**自己加"保鲜 / 告警 / 统计" —— 那些在 `invokeTool` 里，
 *   在这里重做一遍就又造出了第二份口径（本仓最贵的病）。
 */
import fs from 'node:fs';
import { TOOL_DEFS } from '../../application/tool_registry.js';
import { invokeTool } from '../mcp/server_registry.js';

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
      '  cli <name> key=value [key=...]      调一个工具（裸键值对；值按字符串，可含 = 与盘符路径）',
      "  cli <name> [--json '{...}']         调一个工具（结构化 / 嵌套入参用这个）",
      '  cli <name> --input args.json        入参从文件读',
      "  echo '{...}' | cli <name> -         入参从 stdin 读",
      '  ★ key=value 与 --json / --input / - **不可同时给**（入参有歧义 ⇒ 直接报错）',
      '',
      `共 ${TOOL_DEFS.length} 个工具（唯一真相源：application/<线名>/index.ts 的 ToolDef）。`,
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

/**
 * 收集裸 `key=value` 入参（2026-10-06，T58 修复）。
 *
 * ★ 为什么必须有它：CLI 是 `AGENTS.md` 推荐的验证通道，但在它之前**只认**
 *   `--json '{...}'` / `--input <file>` / `-`（stdin）⇒ `cli structure_gap project_dir=D:/proj`
 *   这种**最自然的写法**会把 `project_dir=D:/proj` 当空气 ⇒ 入参成空对象 ⇒ 工具回
 *   「缺参数 project_dir」（看着像工具坏了）⇒ agent 改去手改/grep
 *   —— **正好绕开本仓最想让人用的那条路**。
 *
 * ★ 规则（刻意保守，**宁可不吃也不猜**）：
 *   · 只认**从第 2 个 token 起**（`argv[0]` 是工具名）、且**不以 `-` 开头**的 token；
 *   · 必须含 `=` 且键非空 ⇒ **用第一个 `=` 分割**（⇒ 值里可以再出现 `=`，Windows 盘符路径吃得下）；
 *   · **值一律按字符串**，不猜布尔/数字/数组 —— 需要结构化入参请用 `--json`
 *     （不发明第二套类型推断，那会变成"同一件事两套口径"）。
 *   · 已被 `--json` / `--input` 的**值**占用的下标跳过（否则 `--json '{"a=b":1}'` 会被误当键值对）。
 */
function bareKeyValues(): Record<string, string> {
  const consumed = new Set<number>();
  for (const flag of ['--json', '--input']) {
    const i = argv.indexOf(flag);
    if (i >= 0) {
      consumed.add(i);
      consumed.add(i + 1);
    }
  }
  const kv: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    if (consumed.has(i)) continue;
    const t = argv[i];
    if (t.startsWith('-')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue; // 键必须非空（`=x` 这种不算）
    kv[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return kv;
}

/** 取入参：裸 `key=value` / `--json` / `--input` / stdin / 空对象 */
async function readArgs(): Promise<Record<string, unknown>> {
  const kv = bareKeyValues();
  const kvN = Object.keys(kv).length;
  const hasStructured = argv.includes('--json') || argv.includes('--input') || argv.includes('-');
  // ★ 冲突即报错，不静默合并、也不让后者覆盖前者：两套入参同时给，语义没有唯一答案。
  if (hasStructured && kvN > 0) {
    die(
      `入参有歧义：既给了 ${kvN} 个 \`key=value\`，又给了 \`--json\` / \`--input\` / \`-\`。\n` +
        '两者功能重叠且没有唯一答案 ⇒ 请只用一种（结构化 / 嵌套入参用 `--json`，简单标量用 `key=value`）。',
    );
  }
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
  if (kvN > 0) return kv;
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
