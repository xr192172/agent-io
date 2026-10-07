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
// ★ 只为 `coerceKeyValues` 的形参标注用（type-only ⇒ 运行时零成本）
import type { ToolDef } from '../../application/types.js';
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
      '  cli <name> key=value [key=...]      调一个工具（裸键值对；值按该字段声明的类型转（布尔 true/false · 数字 · JSON 数组/对象））',
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
const found = TOOL_DEFS.find((d) => d.name === cmd);
if (!found) {
  const like = TOOL_DEFS.map((d) => d.name).filter((n) => n.includes(cmd) || cmd.includes(n.slice(0, 4)));
  die(`未知工具名: ${cmd}${like.length ? `\n你是不是想找: ${like.slice(0, 5).join(', ')}` : ''}\n用 \`cli list\` 看全部。`);
}
/**
 * ★ 到此处**确定有值**（上面那个分支以 `die()` 收尾，而它返回 `never`）；显式再声明一次是因为：
 *   `readArgs()` 是个**闭包**，它内部拿不到调用点的收窄结果 ⇒ 直接引用会被 TS 判成
 *   `ToolDef | undefined`，而 `coerceKeyValues` 要的是确定的 `ToolDef`。
 */
const def: ToolDef = found;

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
 *   · 值在这里**只是字符串**；它该是什么类型，由**该字段在 `ToolDef.inputSchema` 里怎么声明**决定
 *     （见 `coerceKeyValues`）—— 所以**本函数不猜任何类型**。
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

/** 只需要 `safeParse` —— 不引 zod 的类型（本文件只用它判"这个值符不符合**该字段的声明**"）。 */
interface ZodLike {
  safeParse(v: unknown): { success: boolean };
}

/**
 * 把裸 `key=value` 的**字符串值**按 `def.inputSchema` **声明的类型**转一次（2026-10-06）。
 *
 * ★★ 为什么要有它（T58 的初版是"值一律按字符串"，本笔补齐那半句）：
 *   实测 `cli translate_go_ts file=… holes=true` ⇒ **布尔不生效**（字符串 `"true"` ≠ 布尔 `true`）——
 *   同理 `dry_run=false` / `remove_file=true` / `batchSize=3` 也一律失效 ⇒ **投影形态表达不了
 *   布尔/数字**。★ 而这正是那批手写 `*_cli` 还活着的**唯一技术原因**：它们的
 *   `--apply` / `--holes` / `--no-verify` / `--batch-size` 恰好**都是布尔/数字**。
 *   ⇒ 补上这一格，"CLI 是投影"才算完整 ⇒ 那些 wrapper 才可以删。
 *
 * ★★ 判据**不是**"猜类型"，而是**读声明**：类型早就写在 `ToolDef.inputSchema`（zod）里
 *   ⇒ 把候选值逐个交给**该字段自己的 zod 定义**去判（`safeParse`），**谁过谁赢**：
 *     ① 原样**字符串**（保住既有行为：声明为 `z.string()` 的字段仍收字符串）
 *     ② **布尔**（仅当值恰是 `true` / `false` 两个字面量）
 *     ③ **数字**（仅当整串是个合法数字）
 *     ④ **JSON**（`[{"from":"a"}]` 这类数组 / 对象）
 *   ⇒ ★ 于是 `project_dir=5` 这种"看上去像数字的字符串"**不会被误转**：该字段声明的是
 *     `z.string()` ⇒ ① 先过（**schema 说了算，不按长相猜**）。
 *   ★ 与 T58 那句"不发明第二套类型推断"**不矛盾**：推断**根本不需要** —— schema 就是那张表。
 *
 * ★ 边界（写清）：
 *   · 字段**不在** schema 里（多余键）⇒ 无声明可依 ⇒ **原样字符串**（不报错，不假装知道）；
 *   · 四种都不过 ⇒ **当场报错并点名该字段**（别把明显非法的值塞进去、让它在深处炸）；
 *   · 只作用于 `key=value` 这一种形态；`--json` / `--input` / `-` **逐字不动**。
 */
function coerceKeyValues(kv: Record<string, string>, def: ToolDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(kv)) {
    // ★★ 取**该字段自己的 zod 定义**：`ToolDef.inputSchema` 的声明类型是
    //   `Record<string, z.ZodType>` —— 也就是**原始 shape 表**（不是 `z.object(…)` 实例）
    //   ⇒ **直接按字段名取，没有 `.shape` 那一层**。
    //   ★★ 我第一版在这里假设了 `.shape`（因为脑里想的是 `z.object` 的用法）⇒ 恒取到 `undefined`
    //   ⇒ **整个转型静默退化成"原样字符串"**；而三档读数**看起来还都通过**（布尔没生效但不报错、
    //   字符串字段本来就该收到字符串）—— **这正是"看起来验过了"最危险的地方**：功能没接上，
    //   却没有任何一处会喊。⇒ 教训：**别按"我以为的类型"写，去读声明的类型**（本条就是反例）。
    const field = def.inputSchema[k] as unknown as ZodLike | undefined;
    if (!field || typeof field.safeParse !== 'function') {
      out[k] = raw; // 多余键 / 拿不到声明 ⇒ 原样（不猜）
      continue;
    }
    const tries: Array<[string, unknown]> = [['字符串', raw]];
    if (raw === 'true' || raw === 'false') tries.push(['布尔', raw === 'true']);
    if (raw.trim() !== '' && !Number.isNaN(Number(raw))) tries.push(['数字', Number(raw)]);
    try {
      tries.push(['JSON', JSON.parse(raw)]);
    } catch {
      /* 不是 JSON 字面量 ⇒ 少一个候选，不算错 */
    }
    const hit = tries.find(([, v]) => field.safeParse(v).success);
    if (!hit) {
      const tried = tries.map((t) => t[0]).join(' / ');
      die(
        `字段 \`${k}\` 的值 \`${raw}\` **不符合它在 inputSchema 里声明的类型**（已试：${tried}）。\n` +
          `  ⇒ 复杂结构（对象 / 数组 / 嵌套）请改用 \`--json '{…}'\` 传一段 JSON；简单标量请按声明改值。`,
      );
    }
    out[k] = hit[1];
  }
  return out;
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
  if (kvN > 0) return coerceKeyValues(kv, def);
  return {};
}

// ── <name> --schema：入参自述 ─────────────────────────────────────────────
// ★ 2026-10-07 新增（用户反馈第 4 条：入参形状不统一，每次都得裸调一次去"试缺哪个参数"）。
//   一处自述，免得调用方（尤其 LLM）反复试错。类型名取自 zod 的 _def.type / _def.typeName。
// ★ 名字**不叫** `ZodLike` —— 本文件已有一个（`{ safeParse }`），它是「只要 safeParse、不引 zod 类型」的意思。
//   这里要读的字段更多，另起一名，避免撞名（实测撞名会 TS2300 duplicate identifier）。
type ZodFieldMeta = { isOptional?: () => boolean; description?: string; _def?: { description?: string; type?: string; typeName?: string } };
const fieldDesc = (s: ZodFieldMeta): string => s.description ?? s._def?.description ?? '';
const fieldType = (s: ZodFieldMeta): string => String(s._def?.type ?? s._def?.typeName ?? '?');
if (argv.includes('--schema')) {
  const schema = (def.inputSchema ?? {}) as Record<string, ZodFieldMeta>;
  const rows = Object.entries(schema).map(([k, s]) => ({
    k,
    required: s.isOptional?.() === false,
    type: fieldType(s),
    desc: fieldDesc(s),
  }));
  const fmt = (r: (typeof rows)[number]) => `  ${r.required ? '*' : ' '} ${r.k.padEnd(16)} ${r.type.padEnd(12)} ${r.desc}`;
  const req = rows.filter((r) => r.required);
  const opt = rows.filter((r) => !r.required);
  process.stdout.write(
    [
      `${def.name} 的入参（* = 必填；类型按声明转换；嵌套/数组请用 --json）`,
      '',
      ...req.map(fmt),
      ...(opt.length ? ['', '可选:', ...opt.map(fmt)] : []),
      '',
      `调法: cli ${def.name} --json '{${req.map((r) => `"${r.k}":…`).join(', ')}}'`,
      '',
    ].join('\n'),
  );
  process.exit(0);
}

let args: Record<string, unknown>;
try {
  args = await readArgs();
} catch (e) {
  die(`入参不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
}

// ★ 走**唯一调用入口** —— 保鲜 / 首触 / 纠错 / 狗食 / 告警注入全在这里，与 MCP 面逐字同路径。
const r = await invokeTool(def, args);
// ★ 2026-10-07：缺参数时**把该工具的全部必填项一并列出**。原先一次只报一个 ⇒
//   调用方要反复裸调去"试"缺哪个（用户反馈第 4 条的现场）。
// ★ 提示**前置**、不追加在末尾 —— 末尾要留给 `---WARNINGS---` / `---DATA---` 机器块
//   （尾部必须是可直接 JSON.parse 的片段，追加会把那个契约破坏掉）。
let outText = r.text;
const miss = /缺参数\s*"([^"]+)"/.exec(outText);
if (miss) {
  const schema = (def.inputSchema ?? {}) as Record<string, ZodFieldMeta>;
  const keyList = (wantReq: boolean) =>
    Object.entries(schema)
      .filter(([, s]) => (s.isOptional?.() === false) === wantReq)
      .map(([k]) => k)
      .join(', ') || '（无）';
  outText =
    `✗ 缺参数 "${miss[1]}"\n` +
    `  ${def.name} 必填: ${keyList(true)}\n` +
    `  可选: ${keyList(false)}\n` +
    `  全量自述: cli ${def.name} --schema\n\n` +
    outText;
}
process.stdout.write(outText.endsWith('\n') ? outText : outText + '\n');
process.exit(r.isError ? 1 : 0);
