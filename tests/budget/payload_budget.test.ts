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
import { spawn } from 'node:child_process';
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
  'tools/list': 221_184, // 实测**线缆** 215,158 B（含每工具注入的 actor/authorize）—— 只登记棘轮
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

/** 起一个 stdio MCP server 量 `tools/list` 的**真线缆字节**（不靠"读 TOOL_DEFS 猜"）。 */
async function toolsListWireBytes(): Promise<number> {
  const home = path.join(TMP, 'wire-home');
  fs.mkdirSync(home, { recursive: true });
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(REPO, 'src/presentation/mcp/server.ts')], {
    cwd: REPO,
    env: { ...process.env, AGENT_IO_HOME: home },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buf = '';
  const waiters: Array<{ id: number; res: (v: unknown) => void }> = [];
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: { id?: number };
      try {
        msg = JSON.parse(line) as { id?: number };
      } catch {
        continue;
      }
      for (const w of waiters.filter((x) => x.id === msg.id)) w.res(msg);
    }
  });
  const send = (o: { id: number } & Record<string, unknown>): Promise<unknown> =>
    new Promise((res, rej) => {
      waiters.push({ id: o.id, res });
      child.stdin.write(`${JSON.stringify(o)}\n`);
      // ★ `unref()`：这个超时计时器**不许**把进程留住（否则 node:test 会在测试跑完之后
      //   再等满 60 s —— 实测把整份文件的耗时从 13 s 顶到 75 s，而断言本身只要毫秒）。
      const timer = setTimeout(() => rej(new Error(`tools/list 超时（${String(o.method)}）`)), 60_000);
      timer.unref?.();
    });
  try {
    await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'budget-test', version: '1' } } });
    const r = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const n = bytes(JSON.stringify(r));
    assert.ok(n > 0, 'tools/list 回执为空 ⇒ 读不出载荷（读不到 ≠ 0）');
    return n;
  } finally {
    child.kill();
  }
}

// ════════════════════════════════════════════════════════════════════
// ① 绝对预算：每条出口都有一格显式上限（棘轮）
// ════════════════════════════════════════════════════════════════════
test('① 六条出口的绝对预算（字节 ≤ BUDGET 表）', async () => {
  const m = await measured();
  const got: Record<string, number> = {
    'get_dsl{query:functions}': bytes(m.fnsB),
    code_health: bytes(m.healthB),
    'tools/list': await toolsListWireBytes(),
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
