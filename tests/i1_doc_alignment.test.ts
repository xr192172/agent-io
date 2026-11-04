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
 *   ① **承诺侧读结构化数据**（`EXPLORE_ACTIONS` / `EXPLORE_ARGS` / `WHEN_OVERRIDES` / **`ToolDef.description`**），
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

test('edit_dsl 描述**指向**唯一判据表（op_data_spec.ts 的 OP_SPECS），表本身不再复刻进描述', () => {
  // ① 指向权威：描述里必须点出唯一判据表的住处 + 查表函数名（读者据此才知道去哪儿看）
  assert.match(editDsl.description, /op_data_spec\.ts/);
  assert.match(editDsl.description, /OP_SPECS/);
  // ② 反方向（同义必命中 / 异义必不命中）：整张表**不许**再贴回描述里 ——
  //    那段曾占描述 16,037 B（= op_data_spec.ts 的逐字复刻，0.9 违规）
  assert.ok(
    !editDsl.description.includes(renderOpSpecs()),
    'renderOpSpecs() 渲染的整张表又出现在 edit_dsl 的 description 里了（第二份 ⇒ 迟早与 OP_SPECS 漂）',
  );
  // ③ 表本身仍在（唯一权威没被顺手删掉）
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
/** 全部工具名（承诺侧解析「段首是不是工具名」要用；**唯一来源** = `TOOL_DEFS`） */
const toolNames = new Set(TOOL_DEFS.map((d: { name: string }) => d.name));
const { WHEN_OVERRIDES } = await import('../src/application/meta/registry/capability_map.js');
const { EXPLORE_ACTIONS } = await import('../src/application/meta/explore/explore_code.js');
const { EXPLORE_ARGS } = await import('../src/application/meta/explore/explore_arg_spec.js');
const { exploreCodeHandler } = await import('../src/application/meta/handlers.js');
const { makeTempHome, rmRf } = await import('./helpers/i1_fixture.js');

/**
 * **承诺侧 = `ToolDef.description`**（★ 2026-11-04：主体从「`AGENTS.md` 的生成源 `TRIGGER_ROWS`」改成**权威本身**）。
 *
 * 为什么改：那张「动作 → 工具」表是 `ToolDef.description` 的**第二份拷贝**（同一件事三个住处）⇒ 表已删、
 * 生成器 `scripts/gen_agents.mjs` 同时退役（见 `docs/RETIRED.md`）。★ 但**判据不能跟着消失** ——
 * 它要判的从来不是"那张表写没写对"，而是"**工具描述里教人调的 action 值真实存在**"。
 * 所以承诺侧换成描述本身（权威），契约侧仍是 `inputSchema[k].toJSONSchema().enum`
 * （= MCP `tools/list` 发出去的**同一份**）—— 两处仍是**不同事实**，不是同源恒真。
 *
 * ★ 分母必须打印（0.12 ③）：只有少数工具在 description 里写了 `action=` 承诺 ⇒
 *   参与数 / 不参与数一起给，并断言「参与数 ≥ 1」—— 否则"全部工具都不写承诺"会让这条判据静默变成空转（0.16）。
 */
function descriptionActionPromises(): { owner: string; tool: string; action: string; seg: string }[] {
  const out: { owner: string; tool: string; action: string; seg: string }[] = [];
  for (const def of TOOL_DEFS as { name: string; description?: string }[]) {
    const desc = String(def.description ?? '');
    for (const seg of [...desc.matchAll(/`([^`]*)`/g)].map((m) => m[1])) {
      const t = /action=([a-z_][a-z0-9_]*)/.exec(seg);
      if (!t) continue;
      const head = seg.trim().split(/[\s（(]/)[0];
      // 段首就是工具名 ⇒ 承诺属于**那个**工具（描述里点名了别的工具）；
      // 否则归给**本工具**（自己的描述里说 `action=X` 就是自己的 X）
      const tool = /^[a-z_][a-z0-9_]*$/.test(head) && toolNames.has(head) ? head : def.name;
      out.push({ owner: def.name, tool, action: t[1], seg });
    }
  }
  return out;
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

test('承诺 − enum = 空：EXPLORE_ACTIONS / EXPLORE_ARGS / ToolDef.description / TOOL_NOTES 里点到的 action 都真实存在', async () => {
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

  // ③ **工具描述**（权威 = `ToolDef.description`，不是 `AGENTS.md` 那份拷贝）里承诺的
  //    `<工具> action=<值>` 必须在那个工具自己的 enum 里
  const promises = descriptionActionPromises();
  for (const p of promises) {
    const en = enumOf(p.tool);
    if (!en.length) {
      problems.push(`\`${p.owner}\` 的描述承诺 \`${p.tool} action=${p.action}\`，但 ${p.tool} 根本没有 action 参数`);
    } else if (!en.includes(p.action)) {
      problems.push(`\`${p.owner}\` 的描述承诺 \`${p.tool} action=${p.action}\` —— 不在其 enum（${en.join(' / ')}）`);
    }
  }
  // ★ 分母两半都给（0.12 ③）+ 输入非空（0.16）：参与 0 个 = 这条判据静默空转，不许当绿
  const participants = new Set(promises.map((p) => p.owner));
  console.log(
    `    · 承诺侧分母（ToolDef.description）：参与工具 ${participants.size}/${TOOL_DEFS.length}` +
      ` · 承诺 ${promises.length} 条 · 违反 ${problems.length} 条`,
  );
  assert.ok(
    participants.size >= 1,
    `没有任何工具的 description 写 action= 承诺（参与 0/${TOOL_DEFS.length}）⇒ 这条判据成了空转，不许当通过`,
  );

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

// ══════════════════════════════════════════════════════════════════════════
// ⑤ **每个 enum 参数的 describe 必须列全它的取值**（tools/list 的可发现性）
// ══════════════════════════════════════════════════════════════════════════
/**
 * 为什么这条能升红（其余坏味道只当探针）：
 *   enum 的取值是**模型只能从 describe 读到**的那一档 —— `toJSONSchema()` 里虽然有 `enum` 数组，
 *   但工具描述里的自然语言说明若说"按状态过滤"而不给取值，读者只能试错（本仓实测：一个子代理被
 *   "审批列表里出现 draft" 骗过一次）。而"列全"是**机器可判**的：`enum ⊆ describe` 逐字比。
 * ★ 与上面「action 轴」那条同源但**不同轴**：那条只覆盖 `action` 字段；这条覆盖**所有** enum 参数。
 */
test('每个 enum 参数的 describe 都列全了它的取值（缺口清单见本文件头注）', () => {
  const bad: string[] = [];
  let checked = 0;
  let enumParams = 0;
  for (const def of TOOL_DEFS) {
    const shape = (def as { inputSchema?: Record<string, unknown> }).inputSchema ?? {};
    for (const [field, raw] of Object.entries(shape)) {
      const js = (raw as { toJSONSchema?: () => { enum?: unknown[]; description?: string } })?.toJSONSchema?.();
      const en = Array.isArray(js?.enum) ? js!.enum!.map(String) : [];
      if (!en.length) continue;
      enumParams++;
      checked++;
      const d = String(js?.description ?? '');
      const missing = en.filter((v) => !d.includes(v));
      if (missing.length) bad.push(`${def.name}.${field} 的 describe 漏了：${missing.join(' / ')}`);
    }
  }
  // ★ 分母两半都给（0.12 ③）：真的扫到了 enum 参数，不是"一个都没扫到"也算过
  assert.ok(enumParams >= 10, `只扫到 ${enumParams} 个 enum 参数（应有 10+）⇒ 这条判据的输入有问题，不许当通过`);
  assert.deepEqual(bad, [], `枚举里有、describe 里没有 ⇒ 模型在 tools/list 上读不到这个取值：\n${bad.join('\n')}`);
  void checked;
});
