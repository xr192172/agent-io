/**
 * 载荷预算（**能红的那种**）—— 六条出口的字节上限 + 尺度不变性 + 文本占比 + 截断文案形状。
 *
 * ## 为什么这是一个测试文件而不是"编目表"
 * 本仓的实测事故是"新人第一次爆上下文就发生在这两处"：
 *   · `get_dsl{query:functions}` 在 README 第 3 步就被推荐，而它对本仓原样输出 **4,215,811 B**
 *     （3238 函数 / 413 文件，avg 1302 B/函数）；
 *   · `code_health` **431 KB**（547 文件 / 923 条 issue），其中 `complexity` 数组与 `high_complexity`
 *     issues **完全重叠**（10/10），而 `top` 只砍那份冗余副本。
 * ⇒ 判据必须能在**没人记得**的时候把这件事重新点亮。四条断言的强度递增：
 *   ① 绝对预算（棘轮：改大就红）；
 *   ② ★**尺度不变性**（这条才真能红、小夹具绕不过）：夹具 A=50 文件、B=200 文件（=4×），
 *      聚合后的载荷**不许跟着 4×** —— 改前 functions 是严格的 1:1 线性（实测 115114 B → 463616 B = 4.03×），
 *      这条当时必红；
 *   ③ **文本占比**：`message` 不许超过整份回执的 20%（它和 `data` 都进上下文 ⇒ 同一条信息付两遍钱）；
 *   ④ **截断文案形状**：截了就必须说——分子 / 分母 / 百分比 / "取更多：…" 一个不能少（0.12 第 3 条）。
 *
 * ## 输入为什么是**现场生成的合成夹具**（不拿本仓当输入）
 * AGENTS-RULES 0.12 第 2 条：门与判据的输入不许是环境态。本仓 `code_health` 实测要 **80 s**、
 * 文件数随提交漂 ⇒ 拿本仓当输入等于让这道门跑一份"今天恰好长这样"的样本，还会拖死 CI。
 * 夹具由 `tests/fixtures/budget-proj/generate.ts` 现写：规模显式钉死，三个维度都有货
 * （未使用导出 / 高复杂度 / 调用边）。
 *
 * ## 改前 → 改后读数（2026-11-02，同一份夹具）
 * | 出口 | 改前 50 文件 | 改前 200 文件 | 改后 50 | 改后 200 |
 * |---|---|---|---|---|
 * | `get_dsl{query:functions}` | 115,114 B | 463,616 B（**4.03×**） | 8,580 B | 8,802 B（**1.03×**） |
 * | `code_health` | 133,242 B | 527,046 B（3.96×） | 5,036 B | 5,077 B（1.01×） |
 * | 本仓真实读数（仓库不是夹具，仅记录动机） | functions **4,215,811 B** · health **431 KB / 80.4 s** | | | |
 *
 * ## 边界（诚实清单）
 * · 夹具的目录数**两组相同**（10）⇒ 本文件证明的是"**按函数/文件铺开的明细**不再线性增长"，
 *   不证明"目录数增长时聚合层恒定"（那由断言① 对 B 的绝对预算兜）；
 * · `tools/list` 只登记**棘轮**（线缆字节）：把散文搬进 docs 是产品决策、不归本卡（另开卡）；
 * · 本文件不测模型的 token 计数（字节 ≠ token），也不测"输出是否易懂"。
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_DEFS } from '../../src/application/tool_registry.js';
import { invokeTool } from '../../src/presentation/mcp/server_registry.js';
import { writeBudgetProject } from '../fixtures/budget-proj/generate.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-budget-'));
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* 临时目录删不掉不影响判据结论（它不在判据输入里） */
  }
});

/** UTF-8 字节 —— 载荷预算的**唯一**度量（中文一字 3 字节；按字符量会把中文低估约 1.6 倍）。 */
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/**
 * 六条出口的**显式预算表**（字节）。
 * ★ 值 = 本卡改后的实测读数，留出包装噪音的余量；改大任何一格都必须在本文件里现形。
 */
const BUDGET: Record<string, number> = {
  'get_dsl{query:functions}': 12_288, // 实测 8,580（50 文件）/ 8,802（200 文件）；改前 115,114 / 463,616
  code_health: 8_192, // 实测 5,036 / 5,077；改前 133,242 / 527,046（本仓 431 KB / 80.4 s）
  'tools/list': 165_000, // 实测**线缆** 163,357 B（含每工具注入的 actor/authorize）；瘦身前 215,158
  contract_page: 8_192, // 实测 5,929
  find_references: 8_192, // 实测 2,594
  capability_audit: 8_192, // 实测 3,806
};

/** 一次工具调用 = 一份**回执文本**（走唯一咽喉 `invokeTool`，与 MCP/CLI 同一个面）。 */
async function call(tool: string, args: Record<string, unknown>): Promise<string> {
  const def = TOOL_DEFS.find((d) => d.name === tool);
  assert.ok(def, `没有注册工具 "${tool}"（测试写错了名字？）`);
  const r = await invokeTool(def, args, 'cert');
  return String(r.text ?? '');
}

/** 回执里 `---DATA---` 之前的那段 = `message`（文本），之后 = 机器载荷。 */
function splitReceipt(text: string): { message: string; data: string } {
  const i = text.indexOf('---DATA---');
  return i < 0 ? { message: text, data: '' } : { message: text.slice(0, i), data: text.slice(i) };
}

interface Proj {
  proj: string;
  home: string;
  feature: string;
}

/** 建一份夹具项目并登记（`import_project` 会建 cache.db —— `query=functions` 需要它）。 */
async function makeProject(name: string, files: number): Promise<Proj> {
  const root = path.join(TMP, name);
  const proj = path.join(root, 'proj');
  const home = path.join(root, 'home');
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  writeBudgetProject(proj, { files, fnsPerFile: 4 });
  const prev = process.env.AGENT_IO_HOME;
  delete process.env.AGENT_IO_DATA_ROOT;
  process.env.AGENT_IO_HOME = home;
  try {
    const feature = `budget_${name}`;
    const out = await call('import_project', { project_dir: proj, feature });
    assert.ok(!/拒绝|error/i.test(out.slice(0, 200)), `import_project 失败：${out.slice(0, 400)}`);
    return { proj, home, feature };
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
  }
}

/** 在指定 home 下跑一段调用（DSL 按数据根分居 ⇒ 读册必须切根）。 */
async function inHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.AGENT_IO_HOME;
  delete process.env.AGENT_IO_DATA_ROOT;
  process.env.AGENT_IO_HOME = home;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
  }
}

interface Measured {
  a: Proj;
  b: Proj;
  fnsA: string;
  fnsB: string;
  healthA: string;
  healthB: string;
}

let memo: Promise<Measured> | null = null;

/** 夹具与读数只算一次（node:test 的 4 个用例共用同一份现场）。 */
function measured(): Promise<Measured> {
  memo ??= (async () => {
    const a = await makeProject('a50', 50);
    const b = await makeProject('b200', 200);
    const fnsA = await inHome(a.home, () => call('get_dsl', { feature: a.feature, query: 'functions' }));
    const fnsB = await inHome(b.home, () => call('get_dsl', { feature: b.feature, query: 'functions' }));
    const healthA = await call('code_health', { project_dir: a.proj });
    const healthB = await call('code_health', { project_dir: b.proj });
    return { a, b, fnsA, fnsB, healthA, healthB };
  })();
  return memo;
}

/**
 * 起一个 stdio MCP server 量 `tools/list` 的**真线缆字节**（不靠"读 TOOL_DEFS 猜"）。
 *
 * ★★ 2026-11-02（度量统一）：此前本文件的这把尺与本仓另一把（`scripts/mcp/mcp_scan.mjs` 的
 *   `JSON.stringify({..., inputSchema: <zod shape>}).length`）**各说各话** —— 后者量的是 zod 内部结构 +
 *   UTF-16 码元数、且不含入口注入的 `actor`/`authorize`（136,968"字符" vs 215,158 字节，差 57%）。
 *   ⇒ 现在**唯一把尺**住 `scripts/mcp/tool_surface.mjs`（起 server、按 UTF-8 字节量、逐工具可归因），
 *   本文件与 mcp_scan 都调它；两条路径（dist / tsx 直跑 src）**对同一个工具必须报出同一个数**。
 */
async function toolsListWire(): Promise<{ tools: Array<{ name: string; bytes: number }>; totalBytes: number; response: any }> {
  const { readToolsListWire } = await import('../../scripts/mcp/tool_surface.mjs');
  const home = path.join(TMP, 'wire-home');
  fs.mkdirSync(home, { recursive: true });
  return readToolsListWire({
    projectDir: REPO,
    serverEntry: path.join(REPO, 'src/presentation/mcp/server.ts'),
    home,
    timeoutMs: 60_000,
  });
}

// ════════════════════════════════════════════════════════════════════
// ① 绝对预算：每条出口都有一格显式上限（棘轮）
// ════════════════════════════════════════════════════════════════════
test('① 六条出口的绝对预算（字节 ≤ BUDGET 表）', async () => {
  const m = await measured();
  const got: Record<string, number> = {
    'get_dsl{query:functions}': bytes(m.fnsB),
    code_health: bytes(m.healthB),
    'tools/list': (await toolsListWire()).totalBytes,
    contract_page: bytes(await call('contract_page', { symbol: 'fn0_0', project_dir: m.a.proj })),
    find_references: bytes(await call('find_references', { symbol: 'fn0_0', file: 'src/mod0/file0.ts', project_dir: m.a.proj })),
    capability_audit: bytes(await call('capability_audit', { installed_only: true, gaps_only: true })),
  };
  for (const [k, cap] of Object.entries(BUDGET)) {
    assert.ok(typeof got[k] === 'number', `BUDGET 表里的 "${k}" 没有对应的读数（表与断言脱节）`);
    assert.ok(
      got[k]! <= cap,
      `[${k}] 载荷 ${got[k]} B **超过**上限 ${cap} B（差 ${got[k]! - cap}）。` +
        `\n  全部读数：${JSON.stringify(got)}` +
        `\n  ★ 要么把输出压回去，要么在 tests/budget/payload_budget.test.ts 的 BUDGET 表里**显式**改上限并说明理由。`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// ② ★ 尺度不变性：文件数 4× 时载荷不许跟着 4×
// ════════════════════════════════════════════════════════════════════
test('② 尺度不变性：A(50 文件) → B(200 文件 = 4×)，载荷 ≤ 1.5×', async () => {
  const m = await measured();
  const cases: Array<[string, number, number]> = [
    ['get_dsl{query:functions}', bytes(m.fnsA), bytes(m.fnsB)],
    ['code_health', bytes(m.healthA), bytes(m.healthB)],
  ];
  for (const [name, a, b] of cases) {
    const ratio = b / a;
    assert.ok(
      b <= Math.ceil(a * 1.5),
      `[${name}] 尺度不变性破了：50 文件 ${a} B → 200 文件（4×）${b} B = **${ratio.toFixed(2)}×**。` +
        `\n  ★ 判据：聚合型载荷的**明细**必须被预算/条数上限截住；只有"按文件/函数铺开"的实现才会线性涨` +
        `（改前实测 functions 115114 B → 463616 B = 4.03×、code_health 133242 B → 527046 B = 3.96×）。`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ 文本占比：message 不许成为主体
// ════════════════════════════════════════════════════════════════════
test('③ code_health 的 message 占比 ≤ 20%（文本是索引，data 是内容）', async () => {
  const m = await measured();
  const { message, data } = splitReceipt(m.healthB);
  const total = bytes(m.healthB);
  const msg = bytes(message);
  assert.ok(
    msg <= 0.2 * total,
    `code_health 的 message ${msg} B / 整份 ${total} B = **${((msg / total) * 100).toFixed(1)}%**（上限 20%）。` +
      `\n  ★ 改前这一项是 35%（issues 逐条印进文本）；把样例/kind×file 也印进文本会升到 40%+ —— ` +
      `因为 text 与 data 都要进上下文，同一信息付两遍钱。文本只留"有几类、各几条、怎么要更多"，样例在 data。` +
      `\n  ★ data 段实测 ${bytes(data)} B。`,
  );
});

// ════════════════════════════════════════════════════════════════════
// ④ 截断文案形状：必须带分母 + 百分比 + 出路
// ════════════════════════════════════════════════════════════════════
test('④ 截断文案必须含分母与出路（防"截了但不说"）', async () => {
  const m = await measured();
  const { message } = splitReceipt(m.healthB);
  const fns = splitReceipt(m.fnsB).message;

  // 分母 + 百分比 + "取更多"，三段缺一不可（形状断言：这里判的正是"文本形状本身就是答案"）
  assert.match(
    message,
    /已列 \d+\/\d+ 条问题（\d+(\.\d+)?%），[^；]+；取更多：\S/,
    `code_health 的文本里没有"已列 k/N（x%），<为什么停>；取更多：<出路>"：\n${message}`,
  );
  assert.match(message, /detail=true|top=-1/, `code_health 的出路必须点明 detail=true / top=-1：\n${message}`);
  // data 侧同一条账（机器读的那份也要有分子分母）
  const t = /"truncation":\{"shown":(\d+),"total":(\d+)/.exec(m.healthB);
  assert.ok(t, 'code_health 的 data 里没有 truncation.shown/total（机器读不到分母）');
  assert.ok(Number(t[1]) <= Number(t[2]), `truncation.shown(${t[1]}) 不许大于 total(${t[2]})`);

  // functions：预算用尽时必须说清分母与三条出路（dir= / files= / budget= / detail=true）
  if (/预算 .* 用尽/.test(fns)) {
    assert.match(fns, /已列 \d+\/\d+ 个函数（\d+(\.\d+)?%）/, `functions 的截断文案没有"已列 k/N（x%）"：\n${fns.slice(0, 800)}`);
    assert.match(fns, /取更多：.*(dir=|files=|budget=|detail=true)/, `functions 的截断文案没有可用出路：\n${fns.slice(0, 800)}`);
  } else {
    // 预算够用（夹具 1600 函数在 32 KB 内能列完明细）时必须**明说没截**，而不是留空
    assert.match(fns, /明细 \d+\/\d+ 条/, `functions 的文本必须报"明细 k/N 条"（分母恒在）：\n${fns.slice(0, 800)}`);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑤ ★ 一把尺：两条路径（tsx 直跑 src / 直跑 dist）对**同一个工具**报出的字节数必须相等
// ════════════════════════════════════════════════════════════════════
test('⑤ tools/list 的两把尺已统一：dist 与 src 对同一工具报数逐字相等，且各工具之和 + 分隔符 + 信封 = 整份响应体', async () => {
  const src = await toolsListWire();
  // 同一把尺的**内部一致性**：条目之和 + (n-1) 个逗号 + 信封 = 整份（信封 = 整份 − 条目 − 分隔符）
  const sum = src.tools.reduce((n, t) => n + t.bytes, 0);
  const envelope = Buffer.byteLength('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}', 'utf8');
  assert.ok(
    sum + (src.tools.length - 1) + envelope === src.totalBytes ||
      Math.abs(sum + (src.tools.length - 1) + envelope - src.totalBytes) <= 2,
    `逐条目之和(${sum}) + 分隔符(${src.tools.length - 1}) ≈ 整份(${src.totalBytes}) 对不上 ⇒ 这条尺量的不是 tools 数组里的条目`,
  );

  const distEntry = path.join(REPO, 'dist/src/presentation/mcp/server.js');
  if (!fs.existsSync(distEntry)) {
    // ★ 0.12：读不到 ≠ 相等 —— 但也不许把"没验"当"验过了"
    assert.fail(`找不到 ${path.relative(REPO, distEntry)} ⇒ 两条路径的相等性这次**没验**（先 npm run build）`);
  }
  const { readToolsListWire } = await import('../../scripts/mcp/tool_surface.mjs');
  const dist = await readToolsListWire({
    projectDir: REPO,
    serverEntry: distEntry,
    home: path.join(TMP, 'wire-home-dist'),
    timeoutMs: 60_000,
  });
  const a = new Map(src.tools.map((t) => [t.name, t.bytes]));
  const b = new Map(dist.tools.map((t) => [t.name, t.bytes]));
  const onlySrc = [...a.keys()].filter((k) => !b.has(k));
  const onlyDist = [...b.keys()].filter((k) => !a.has(k));
  const diff = [...a.entries()].filter(([k, v]) => b.has(k) && b.get(k) !== v).map(([k, v]) => `${k}: src ${v} ≠ dist ${b.get(k)}`);
  assert.deepEqual(
    { onlySrc, onlyDist, diff },
    { onlySrc: [], onlyDist: [], diff: [] },
    `两条路径对 tools/list 报的数不一致 —— dist 与 src 不同源？先 \`npm run build\`：${JSON.stringify({ onlySrc, onlyDist, diff }, null, 1)}`,
  );
});

// ════════════════════════════════════════════════════════════════════
// ⑥ ★ 去重不许把**可发现性**一起去掉：44 个工具仍各含 actor/authorize 两键 + 非空语义 + 指向唯一详解
// ════════════════════════════════════════════════════════════════════
test('⑥ actor / authorize 的语义没被"省字节"省掉：每个工具都有两键、都有非空 describe、都指向 capability_map', async () => {
  const { response } = await toolsListWire();
  const tools = response.result.tools as Array<{ name: string; description?: string; inputSchema?: { properties?: Record<string, { description?: string }> } }>;
  const bad: string[] = [];
  for (const t of tools) {
    const props = t.inputSchema?.properties ?? {};
    const a = String(props.actor?.description ?? '');
    const z = String(props.authorize?.description ?? '');
    if (!('actor' in props)) bad.push(`${t.name}: 缺 actor 键`);
    if (!('authorize' in props)) bad.push(`${t.name}: 缺 authorize 键`);
    if (a.length < 30) bad.push(`${t.name}: actor 的 describe 太短（${a.length}）`);
    if (z.length < 30) bad.push(`${t.name}: authorize 的 describe 太短（${z.length}）`);
    if (!a.includes('capability_map') && !z.includes('capability_map')) {
      bad.push(`${t.name}: 两个 describe 都没指向权威详解（capability_map）`);
    }
  }
  assert.deepEqual(bad, [], `可发现性退了（A7 写闸的入参会变成不可发现）：\n${bad.join('\n')}`);

  // ★ 反过来：长文必须真的在 capability_map 描述里（"指向的那一头"存在）
  const cm = tools.find((t) => t.name === 'capability_map');
  assert.match(String(cm?.description ?? ''), /跨工具保留入参/, 'capability_map 的描述里必须有 actor/authorize 的完整规则（唯一住处）');
});
