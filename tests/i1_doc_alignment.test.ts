/**
 * I1 · 第 3/4/8 条（文档对齐，用测试钉住）：
 * · kinds 表进 get_dsl 的入参 schema 描述（含 run 首行「不执行命令，只求值表达式」/ source-has 纯子串）；
 * · domain/expectation.ts 的 run kind 文档首行同口径；
 * · op_data_spec 的 todo 段写明「claim/complete 走 type=task（用 todo id）」且 todo 不跑节点建构判定；
 *   decision idNote / node note 的 service 放开与 decision 合并语义也在册。
 *
 * ★★ 2026-11-02（subagent:dead-paths）：本文件新增后半段「**文档教的调用形态必须真跑得通**」——
 *   病（只读卡实测，不是推测）：AGENTS.md / README / capability_map 教的都是**平铺**
 *   （`explore_code action=docs`），而入口把顶层 `action` 也塞进了 `args` ⇒
 *   被 per-action 键表当「不认识的键」拒掉 ⇒ **12 个 action 里 11 个全死**，只有 `watch` 活着
 *   （它的键表本就有 `action`）。而 `tests/` 对 `explore_code` **零覆盖** ⇒ 整条死路没人发现。
 *
 * 为什么这一段的判据不能是"grep 一下文案"：
 *   本仓最贵的病是**同源恒真**（用同一份表生成、再用同一份表核对）⇒ 所以这里分两层：
 *   ① **承诺侧读结构化数据**（`EXPLORE_ACTIONS` / `EXPLORE_ARGS` / `WHEN_OVERRIDES` / `gen_agents.mjs#TRIGGER_ROWS`），
 *      **契约侧读 `def.inputSchema[k].toJSONSchema().enum`**（= MCP `tools/list` 发出去的**同一份**，绝不手抄）；
 *   ② **两形态各真跑一次**（同一 action，平铺 vs `args` 信封 ⇒ 返回必须逐字相同），
 *      再对**全部 12 个 action** 各跑一次「键名不被误拒」+「假键必须被拒」（单向断言没有鉴别力）。
 *
 * 已知的手抄源（无法由生成器产出，如实标注）：`README.md` / `README.en.md` 里那几行 `explore_code action=…`
 * 是**人写的示例**，不在本文件的承诺侧数据源里 ⇒ 它若与 enum 漂了，本文件**不会**红（[未核]）。
 * 残留的同类缺口（本文件**不**覆盖，属别的轴，需要各自的卡）：`get_dsl.query|layer|file_status|severity|format`、
 * `diagnose.symptom_type`、`capability_map.lane`、`rules.level` 的 enum 值也没全进各自的 describe。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DESIGN_TOOLS } from '../src/application/design/index.js';
import { renderOpSpecs, OP_SPECS } from '../src/application/design/dsl_ops/op_data_spec.js';

const getDsl = DESIGN_TOOLS.find((d) => d.name === 'get_dsl') as (typeof DESIGN_TOOLS)[number];
const editDsl = DESIGN_TOOLS.find((d) => d.name === 'edit_dsl') as (typeof DESIGN_TOOLS)[number];

test('get_dsl 入参 schema：query 描述含「判据 kinds 字段表」', () => {
  const schema = getDsl.inputSchema as { query?: { description?: string } };
  assert.match(schema.query?.description ?? '', /判据 kinds 字段表/);
});

test('kinds 表逐条：symbol-exists / source-has=纯子串 / run=不执行命令只求值表达式', () => {
  const schema = getDsl.inputSchema as { query?: { description?: string } };
  const d = schema.query?.description ?? '';
  assert.match(d, /symbol-exists=\{path, symbol, why\}/);
  assert.match(d, /source-has=\{path, must\?\/mustNot\?, why\} —— 匹配前\*\*剥注释\*\*/);
  assert.match(d, /run=\{input\?, expect, why\} —— \*\*不执行命令，只求值表达式\*\*/);
});

test('domain/expectation.ts：run kind 的声明文档首行写明「不执行命令，只求值表达式」', async () => {
  const src = fsRead('../src/domain/expectation.ts');
  assert.match(src, /不执行命令，只求值表达式/);
});

test('edit_dsl 描述渲染的 op 表（renderOpSpecs）随 schema 出去且含 kinds 相关的 decision 键', () => {
  assert.match(editDsl.description, /data 契约/);
  assert.ok(renderOpSpecs().length > 100);
});

test('todo 段：claim/complete 走 type=task（用 todo id）+ 不跑节点建构判定（I1 对齐）', () => {
  const todo = OP_SPECS.find((s) => s.type === 'todo') as { note?: string };
  assert.match(todo.note ?? '', /claim \/ start \/ release \/ complete \/ void \/ reopen 等【状态流转】走 `type=task`/);
  assert.match(todo.note ?? '', /`id` 填 todo 的 id/);
  assert.match(todo.note ?? '', /不跑节点建构判定/);
  assert.match(todo.note ?? '', /constructionVerdict/);
});

test('decision 段：idNote 含 service（I1 放开）；node 段写明 decision 合并/清除语义', () => {
  const decision = OP_SPECS.find((s) => s.type === 'decision') as { idNote?: string };
  assert.match(decision.idNote ?? '', /service/);
  const node = OP_SPECS.find((s) => s.type === 'node') as { note?: string };
  assert.match(node.note ?? '', /逐字段合并/);
  assert.match(node.note ?? '', /decision:null` 清除整张卡/);
  assert.match(node.note ?? '', /decision_history/);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
function fsRead(rel: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.resolve(here, rel), 'utf-8');
}

// ══════════════════════════════════════════════════════════════════════════
// ② + ④ —— explore_code：**文档教的平铺形态**必须真跑得通，且承诺 ≡ enum
// ══════════════════════════════════════════════════════════════════════════

const { TOOL_DEFS } = await import('../src/application/tool_registry.js');
const { WHEN_OVERRIDES } = await import('../src/application/meta/registry/capability_map.js');
const { EXPLORE_ACTIONS } = await import('../src/application/meta/explore/explore_code.js');
const { EXPLORE_ARGS } = await import('../src/application/meta/explore/explore_arg_spec.js');
const { exploreCodeHandler } = await import('../src/application/meta/handlers.js');
const { makeTempHome, rmRf } = await import('./helpers/i1_fixture.js');

/** `TRIGGER_ROWS` = `AGENTS.md` 的**唯一生成源**（★ 读它，**不 grep 产物** —— 产物是二手事实） */
async function triggerRows(): Promise<string[][]> {
  const m = (await import('../scripts/gen_agents.mjs')) as unknown as { TRIGGER_ROWS: string[][] };
  assert.ok(Array.isArray(m.TRIGGER_ROWS) && m.TRIGGER_ROWS.length > 20, 'gen_agents.mjs 必须导出 TRIGGER_ROWS（AGENTS.md 的唯一事实源）');
  return m.TRIGGER_ROWS;
}

/** 工具的某个字段的**契约枚举** —— 取 `toJSONSchema()`，即 MCP `tools/list` 发出去的同一份（不许手抄） */
function enumOf(toolName: string, field = 'action'): string[] {
  const def = TOOL_DEFS.find((d) => d.name === toolName) as { inputSchema?: Record<string, unknown> } | undefined;
  const schema = def?.inputSchema?.[field] as { toJSONSchema?: () => { enum?: unknown[] } } | undefined;
  const js = schema?.toJSONSchema?.();
  const en = js?.enum;
  return Array.isArray(en) ? en.map(String) : [];
}

/** 工具某个字段的 describe（同样取自 `toJSONSchema()`） */
function describeOf(toolName: string, field = 'action'): string {
  const def = TOOL_DEFS.find((d) => d.name === toolName) as { inputSchema?: Record<string, unknown> } | undefined;
  const schema = def?.inputSchema?.[field] as { toJSONSchema?: () => { description?: string } } | undefined;
  return String(schema?.toJSONSchema?.()?.description ?? '');
}

/** 调一个工具（这里只用 explore_code；返回 `wrapData` 的信封 `{text}`） */
const callTool = async (args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> =>
  (await exploreCodeHandler(args as never)) as { text: string; isError?: boolean };

const textOf = (r: { text?: string } | null | undefined): string => String(r?.text ?? '');

test('explore_code：**平铺**与 `args` 信封真跑同一 action ⇒ 返回逐字相同（两套契约并存的代价用判据钉住）', async () => {
  const home = makeTempHome();
  try {
    const proj = path.join(home, 'probe');
    fs.mkdirSync(path.join(proj, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'docs', 'probe.md'), '# 探针文档\n\n一行正文。\n', 'utf-8');
    const keys = { feature: 'dead-paths-probe', project_dir: proj };

    const flat = await callTool({ action: 'docs', ...keys });
    const nested = await callTool({ action: 'docs', args: keys });

    // ① 平铺形态**不许**被「不认识的键」拒（这正是那张卡的病）
    assert.doesNotMatch(textOf(flat), /不认识的键/, `平铺形态被键表拒了：${textOf(flat).slice(0, 300)}`);
    // ② 它真的跑到了业务层（不是"没报错"就算过：0 篇文档也是一种"正常结果"）
    assert.match(textOf(flat), /项目文档 1 篇/);
    // ③ 两形态同结果
    assert.deepEqual(flat, nested);
  } finally {
    rmRf(home);
  }
});

test('explore_code：12 个 action 的键名都不被误拒（且假键必须被拒 —— 单向断言没有鉴别力）', async () => {
  assert.equal(EXPLORE_ACTIONS.length, 12, `EXPLORE_ACTIONS 应为 12 个（现 ${EXPLORE_ACTIONS.length} 个）—— 数目变了请同步本判据与文档`);
  const failures: string[] = [];
  let checked = 0;
  for (const action of EXPLORE_ACTIONS as readonly string[]) {
    const legal = (EXPLORE_ARGS[action] ?? []).filter((k) => k !== 'action'); // 顶层 `action` 是**选动作**的键，不是参数
    assert.ok(legal.length > 0, `${action} 在 EXPLORE_ARGS 里没有键表 ⇒ 键名校验对它整格失效（T197 复发形态）`);

    // ① 合法键全给上（值给 undefined ⇒ 必填闸先拦，不会真干活）：不许出现「不认识的键」
    const allUndefined = Object.fromEntries(legal.map((k) => [k, undefined]));
    const ok = await callTool({ action, ...allUndefined });
    checked++;
    if (/不认识的键/.test(textOf(ok))) failures.push(`${action}：合法键被误拒 —— ${textOf(ok).split('\n')[0]}`);

    // ② 反方向：塞一个假键 ⇒ **必须**被拒。缺了这条，"①恒过"也可能只是校验被整条关掉。
    const bogus = await callTool({ action, zzz_dead_paths_not_a_key: 1 });
    if (!/不认识的键/.test(textOf(bogus))) failures.push(`${action}：假键没被拒 —— ${textOf(bogus).split('\n')[0]}`);
  }
  assert.deepEqual(failures, [], `键名校验对 ${checked}/${EXPLORE_ACTIONS.length} 个 action 出错`);
});

test('承诺 − enum = 空：EXPLORE_ACTIONS / EXPLORE_ARGS / TRIGGER_ROWS / TOOL_NOTES 里点到的 action 都真实存在', async () => {
  const problems: string[] = [];

  // ① 分发器的 action 枚举 ≡ schema 里声明的枚举（两份**不同文件**的事实，不是同源恒真）
  const schemaActions = enumOf('explore_code');
  const missingInSchema = (EXPLORE_ACTIONS as readonly string[]).filter((a) => !schemaActions.includes(a));
  const extraInSchema = schemaActions.filter((a) => !(EXPLORE_ACTIONS as readonly string[]).includes(a));
  if (missingInSchema.length) problems.push(`schema 少声明：${missingInSchema.join(', ')}`);
  if (extraInSchema.length) problems.push(`schema 多声明（分发器没有）：${extraInSchema.join(', ')}`);

  // ② 键表必须与 action 枚举**恰好一致**（缺一个 ⇒ 该 action 的键名校验整格失效；多一个 ⇒ 误拒）
  const argsKeys = Object.keys(EXPLORE_ARGS);
  const noTable = (EXPLORE_ACTIONS as readonly string[]).filter((a) => !argsKeys.includes(a));
  const ghostTable = argsKeys.filter((a) => !(EXPLORE_ACTIONS as readonly string[]).includes(a));
  if (noTable.length) problems.push(`EXPLORE_ARGS 缺：${noTable.join(', ')}`);
  if (ghostTable.length) problems.push(`EXPLORE_ARGS 多：${ghostTable.join(', ')}`);

  // ③ AGENTS.md 的生成源（TRIGGER_ROWS）里承诺的 `<工具> action=<值>` 必须在那个工具自己的 enum 里
  const toolNames = new Set(TOOL_DEFS.map((d) => d.name));
  for (const row of await triggerRows()) {
    const cell = String(row[1] ?? '');
    // 只在**同一段**里认「工具 + action=」：`\`observe action=instrument\`` / `\`explore_code action=docs\``
    for (const seg of [...cell.matchAll(/`([^`]*)`/g)].map((m) => m[1])) {
      const t = /action=([a-z_][a-z0-9_]*)/.exec(seg);
      if (!t) continue;
      const head = seg.trim().split(/[\s（(]/)[0];
      const tool = /^[a-z_][a-z0-9_]*$/.test(head) && toolNames.has(head)
        ? head
        : [...cell.matchAll(/`([^`]*)`/g)].map((m) => m[1].trim().split(/[\s（(]/)[0]).find((w) => toolNames.has(w)) ?? '';
      if (!tool) {
        problems.push(`AGENTS 触发行里的 \`action=${t[1]}\` 认不出属于哪个工具（段：${seg}）`);
        continue;
      }
      const en = enumOf(tool);
      if (!en.length) problems.push(`AGENTS 触发行承诺 \`${tool} action=${t[1]}\`，但 ${tool} 根本没有 action 参数`);
      else if (!en.includes(t[1])) problems.push(`AGENTS 触发行承诺 \`${tool} action=${t[1]}\` —— 不在其 enum（${en.join(' / ')}）`);
    }
  }

  // ④ 策展文本（TOOL_NOTES）同理：某工具的策展语里写 `action=X` 就只能指**它自己**的 action
  //    （写别的工具的 action 就是在教一条会当场被拒的调用 —— memory_observe 的 `action=line` 正是此形态）
  for (const [tool, note] of Object.entries(WHEN_OVERRIDES as Record<string, string>)) {
    if (!toolNames.has(tool)) continue; // 陈旧条目由下一条断言管
    const en = enumOf(tool);
    for (const m of String(note).matchAll(/action=([a-z_][a-z0-9_]*)/g)) {
      if (!en.includes(m[1])) {
        problems.push(`TOOL_NOTES["${tool}"] 承诺 \`action=${m[1]}\` —— 不在其 enum（${en.join(' / ') || '该工具没有 action 参数'}）`);
      }
    }
  }

  assert.deepEqual(problems, [], '承诺侧点名的 action 与工具真声明之间存在空差');
});

test('TOOL_NOTES 的 key ⊆ TOOL_DEFS 的 key（专抓「工具删了、策展文本忘删」这类陈旧串台）', () => {
  const toolNames = new Set(TOOL_DEFS.map((d) => d.name));
  const stale = Object.keys(WHEN_OVERRIDES as Record<string, string>).filter((k) => !toolNames.has(k)).sort();
  assert.deepEqual(stale, [], `TOOL_NOTES（capability_map#WHEN_OVERRIDES）里有注册表已不存在的工具：${stale.join(', ')}`);
});

test('每个工具的 action 枚举值都出现在 action 字段的 describe 里（tools/list 的可发现性）', () => {
  const bad: string[] = [];
  for (const def of TOOL_DEFS) {
    const en = enumOf(def.name);
    if (!en.length) continue;
    const d = describeOf(def.name);
    const missing = en.filter((v) => !d.includes(v));
    if (missing.length) bad.push(`${def.name}.action 的 describe 漏了：${missing.join(' / ')}`);
  }
  assert.deepEqual(bad, [], '枚举里有、describe 里没有 ⇒ 模型在 tools/list 上读不到这个取值');
});

test('design_line 的 code_dir 进 schema（handler 早就在读它；不声明 = 功能通但清单里看不见）', () => {
  const def = TOOL_DEFS.find((d) => d.name === 'design_line') as { inputSchema?: Record<string, unknown> } | undefined;
  assert.ok(def?.inputSchema && 'code_dir' in def.inputSchema, 'design_line.inputSchema 必须声明 code_dir');
  const schema = def.inputSchema.code_dir as { toJSONSchema?: () => { type?: string; description?: string } };
  const js = schema.toJSONSchema?.() ?? {};
  assert.equal(js.type, 'string');
  assert.match(String(js.description ?? ''), /drift/, 'code_dir 的 describe 必须点明它只对 action=drift 生效');
});
