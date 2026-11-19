/**
 * touches: src/application/tool_registry.ts,
 *          src/application/{observe,cross,design,meta,refactor}/index.ts,
 *          src/application/meta/registry/{lane_ids,input_paths,catalog,tool_catalog_ref}.ts,
 *          src/application/meta/{ledger/tool_schema,explore/explore_actions}.ts,
 *          src/presentation/cli/cli.ts
 *
 * P1 · **元数据 / 实现分家**（延迟普查 `latency-ds-1` 簇 A：每次调用把半个仓的 ESM 图编译进来）。
 *
 * ## 红（普查实测，`appdata/Temp/latency-ds-1.md` 簇 A）
 * `cli.ts:36` 静态 import 整个 `TOOL_DEFS`、`:45` 静态 import `invokeTool` ⇒ 一条 `list --json`
 * 执行 **725 个脚本 / 370 个 `dist/src` 模块（占 458 个的 80.8 %）**，`cli.js --help` 941 ms。
 * 根因不是"注册表大"，是**元数据与实现绑在同一个模块里**：`TOOL_DEFS` 同时给
 * name/title/description/schema **和** handler，而"列工具"只要前四样，"调工具"只要第五样。
 *
 * ## 绿（本笔）
 * · 元数据仍住 `application/<线>/index.ts`（唯一真相源不变）；**实现模块改成函数体内 `await import()`**：
 *   模块求值期只加载 schema（zod）与元数据常量，实现图在**首次调用那个 handler** 时才进来；
 * · 元数据常量从实现模块搬到零依赖叶子（`lane_ids` / `input_paths` / `catalog` /
 *   `tool_schema` / `explore_actions`），原模块 **re-export**（公开 API 与工具面一字不变）；
 * · `cli.ts` 的 `invokeTool` 改成调用点前 `await import()`（`--help` / `list` / `--schema` 三个分支
 *   在它之前就 exit，从此不为工具实现付一分钱）。
 *
 * ## 每条用例"什么情形下会红"（判据必须有牙）
 * ① **元数据轻量**：import `TOOL_DEFS` 之后，进程里**没有**任何 handler / kernel / storage /
 *    capability_map / explore_code / ledger-tool 模块 ⇒ 回退成静态 import（哪怕只回退一条）
 *    ⇒ 那个模块出现在读数里 ⇒ 红。
 * ② **按需实现 + 缓存**：第一次调 `get_dsl` 的 handler 之后**必须**出现 `design/handlers.js`；
 *    再调一次**不许新增任何模块**（= 没走第二次加载 / 没走第二条加载路径）。
 * ③ **工具面逐字节不变**：用仓里那把唯一的尺（`scripts/mcp/tool_surface.mjs`，起真 server 取
 *    `tools/list`）量 wire 字节，与 `scripts/mcp/tool-surface-baseline.json` 的 tools/bytes
 *    **完全相等** ⇒ 谁"顺手"改了一个描述 / 一个 schema 字段 / 一个注解，这条就红。
 * ④ **元数据齐全**：41 个工具逐个要求 name / title / description / inputSchema / annotations / writes
 *    （缺一个 = MCP 面上的声明就少一格，与 `TOOL_DEFS` 的绑定期检查互为表里）。
 * ⑤ **lane 文件求值期不许 import 实现**（源码侧同一把尺的另一面）：不依赖 build，
 *    直接读 5 个 lane 的顶层 import 行。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REGISTRY = path.join(ROOT, 'dist', 'src', 'application', 'tool_registry.js');
const SERVER = path.join(ROOT, 'dist', 'src', 'presentation', 'mcp', 'server.js');
const BASELINE = path.join(ROOT, 'scripts', 'mcp', 'tool-surface-baseline.json');

/**
 * 实现侧模块（**元数据求值期一个都不许出现**）。
 * 挑的是"最贵 / 最能代表实现链"的那批：handler 表、解析内核、存储、导航实现、
 * explore 实现、台账引擎、判据执行核、重构流水线。
 * ★ 不含 lane 的 `index.js`：那**正是**元数据住的地方（它必须被加载）。
 */
const IMPL_MODULES = [
  'application/observe/handlers.js',
  'application/cross/handlers.js',
  'application/design/handlers.js',
  'application/meta/handlers.js',
  'application/refactor/handlers.js',
  'infrastructure/parse/kernel.js',
  'infrastructure/storage.js',
  'infrastructure/analysis/health/index.js',
  'application/meta/registry/capability_map.js',
  'application/meta/explore/explore_code.js',
  'application/meta/ledger/tool.js',
  'application/design/db/judgement_run.js',
  'application/refactor/pipeline/refactor_pipeline.js',
  'infrastructure/index/index_freshness.js',
];

/** 一次子进程探针：跑 `body`（ESM 源码），返回 { urls, out, rc }；urls = 进程真加载过的脚本 */
function probe(body: string): { urls: string[]; out: string; rc: number } {
  const cov = fs.mkdtempSync(path.join(os.tmpdir(), 'split-cov-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'split-home-'));
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', body], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, NODE_V8_COVERAGE: cov, AGENT_IO_HOME: home },
    });
    assert.equal(r.status, 0, '探针子进程失败：' + (r.stderr ?? '').slice(0, 1200));
    const urls: string[] = [];
    for (const f of fs.readdirSync(cov)) {
      for (const rr of JSON.parse(fs.readFileSync(path.join(cov, f), 'utf8')).result ?? []) urls.push(rr.url);
    }
    return { urls: [...new Set(urls)], out: r.stdout ?? '', rc: r.status ?? 0 };
  } finally {
    fs.rmSync(cov, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const norm = (u: string): string => decodeURIComponent(u).replace(/^file:\/\/\//, '').replace(/\\/g, '/');
const distSrc = (urls: string[]): string[] => urls.map(norm).filter((u) => u.includes('/dist/src/'));
const present = (urls: string[]): string[] => {
  const set = distSrc(urls);
  return IMPL_MODULES.filter((m) => set.some((u) => u.endsWith('/dist/src/' + m) || u.endsWith(m)));
};

const IMPORT_DEFS = `const { TOOL_DEFS } = await import(${JSON.stringify(pathToFileURL(REGISTRY).href)});`;

test('簇 A ① 元数据轻量：import TOOL_DEFS 不拉任何实现模块（回退成静态 import ⇒ 红）', () => {
  assert.equal(fs.existsSync(REGISTRY), true, '缺 ' + REGISTRY + ' ⇒ 先 npm run build（本文件跑 dist）');
  const { urls, out } = probe(`${IMPORT_DEFS}\nconsole.log('N=' + TOOL_DEFS.length);`);
  const n = Number(/N=(\d+)/.exec(out)?.[1] ?? NaN);
  assert.equal(n, 41, '元数据里必须仍有 41 个工具（实得 ' + out.trim() + '）');

  const leaked = present(urls);
  assert.deepEqual(
    leaked,
    [],
    'import TOOL_DEFS 竟然加载了实现模块：' + JSON.stringify(leaked) +
      ' ⇒ 元数据/实现又绑回同一个模块（`--help` 会把整条实现图拖进来）',
  );
  // 对照：元数据该加载的东西**在**（否则"空图"也能让上一条变绿 —— 假绿）
  const set = distSrc(urls);
  const lanes = ['observe', 'cross', 'design', 'meta', 'refactor'].filter((l) =>
    set.some((u) => u.endsWith(`/dist/src/application/${l}/index.js`)),
  );
  assert.equal(lanes.length, 5, '5 条 lane 的元数据模块必须已加载（实得 ' + JSON.stringify(lanes) + '）');
  assert.ok(
    set.some((u) => u.endsWith('/dist/src/application/tool_registry.js')),
    '注册表本身当然要在（对照项）',
  );
});

test('簇 A ② 按需实现：首次调用才拉实现模块；第二次调用不再新增任何模块', () => {
  const callOnce = `const { TOOL_DEFS } = await import(${JSON.stringify(pathToFileURL(REGISTRY).href)});
const d = TOOL_DEFS.find((x) => x.name === 'get_dsl');
await d.handler({});`;
  const callTwice = callOnce + `\nawait d.handler({});`;

  const once = probe(callOnce);
  const twice = probe(callTwice);

  const implAfterFirst = present(once.urls).filter((m) => m === 'application/design/handlers.js');
  assert.deepEqual(
    implAfterFirst,
    ['application/design/handlers.js'],
    '第一次调 get_dsl 的 handler 之后必须已加载 design/handlers.js（实得 ' +
      JSON.stringify(present(once.urls)) + '）⇒ 说明实现真的走 `await import()` 进来了',
  );

  const setOnce = distSrc(once.urls).sort();
  const setTwice = distSrc(twice.urls).sort();
  assert.deepEqual(
    setTwice,
    setOnce,
    '第二次调用新增了模块（或换了另一条加载路径）：\n  首次 ' + setOnce.length + ' 个\n  二次 ' + setTwice.length +
      ' 个\n  多出来：' + JSON.stringify(setTwice.filter((u) => !setOnce.includes(u))),
  );
});

/**
 * 分家**前**（真仓 HEAD `1f98ec72` 的 `dist/`）用同一把尺量出来的工具面指纹：
 *   41 个工具 / wire 160259 B / 规范化 sha256 = 下面这个值。
 * 分家后必须**逐字节同值** —— 本笔只换加载策略，面一个字都不许动。
 *
 * ★ 为什么不直接跟 `scripts/mcp/tool-surface-baseline.json` 比：那份基线在 HEAD 上就已经**落后 611 B**
 *   （`tools` 仍是 41，`bytes` 159648 vs HEAD 实测 160259 ⇒ 已是一门存量红，与本笔无关：本笔前后都是 160259）。
 *   所以这条判据钉在**从 HEAD 实测的指纹**上 —— 它才是"面没变"的那个事实。
 *   基线文件的补录按仓规走 `node scripts/mcp/mcp_scan.mjs --update`（主控的有意识动作）。
 */
const SURFACE_SHA256_AT_HEAD = '75abac6cbf8709bcbc1e72f9bb59ca86788eb01507eba2847e66a8fb36e9da92';
const SURFACE_BYTES_AT_HEAD = 160259;

test('簇 A ③ 工具面逐字节不变：tools/list 的规范化指纹 == 分家前 HEAD 的实测值（改一个描述/schema 字段即红）', async () => {
  assert.equal(fs.existsSync(SERVER), true, '缺 ' + SERVER + ' ⇒ 先 npm run build');
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const { readToolsListWire, surfaceSummary } = await import(
    pathToFileURL(path.join(ROOT, 'scripts', 'mcp', 'tool_surface.mjs')).href
  );
  const reading = await readToolsListWire({ projectDir: ROOT, serverEntry: SERVER, timeoutMs: 120_000 });
  const s = surfaceSummary(reading);

  assert.equal(s.tools, 41, `工具总数必须仍是 41（实得 ${s.tools}）`);
  assert.equal(s.tools, base.tools, `工具总数与 mcp_scan 基线一致（基线 ${base.tools} / 实测 ${s.tools}）`);

  const tools = [...reading.response.result.tools].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const canon = JSON.stringify(tools);
  const sha = createHash('sha256').update(canon).digest('hex');
  assert.equal(
    sha,
    SURFACE_SHA256_AT_HEAD,
    `工具面**变了**（分家前 HEAD 的指纹 ${SURFACE_SHA256_AT_HEAD} / 实测 ${sha}）` +
      '：本笔只许可换加载策略，不许动 name / title / description / inputSchema / annotations',
  );
  assert.equal(
    s.bytes,
    SURFACE_BYTES_AT_HEAD,
    `工具面 wire 字节必须与 HEAD 实测值相等：HEAD ${SURFACE_BYTES_AT_HEAD} B / 实测 ${s.bytes} B`,
  );

  // 逐工具复核（指纹变了要知道是谁）：top10 的排序与字节数都是"谁把面撑大了"的直接读数
  const top = new Map(s.top10);
  assert.equal(top.get('get_dsl'), 14536, 'getIdsl 的字节数变了：' + top.get('get_dsl'));
  assert.equal(top.get('design_line'), 8448, 'design_line 的字节数变了：' + top.get('design_line'));
});

test('簇 A ④ 元数据齐全：41 个工具逐个有 name/title/description/inputSchema/annotations/writes', async () => {
  const { TOOL_DEFS } = await import(pathToFileURL(path.join(ROOT, 'src', 'application', 'tool_registry.ts')).href);
  assert.equal(TOOL_DEFS.length, 41, '工具总数 41（实得 ' + TOOL_DEFS.length + '）');
  for (const d of TOOL_DEFS) {
    assert.ok(d.name && typeof d.name === 'string', 'name 缺：' + JSON.stringify(d.name));
    assert.ok(d.title && d.title.length > 0, d.name + ' 缺 title');
    assert.ok(d.description && d.description.length > 0, d.name + ' 缺 description');
    assert.equal(typeof d.inputSchema, 'object', d.name + ' 的 inputSchema 不是对象');
    assert.ok(d.inputSchema && Object.keys(d.inputSchema).length > 0, d.name + ' 的 inputSchema 是空的');
    assert.ok(d.annotations && typeof d.annotations === 'object', d.name + ' 缺 annotations（MCP 对外声明）');
    assert.equal(typeof d.writes, 'boolean', d.name + ' 的 writes 必须是布尔（saveDSL 闸的唯一读数）');
    assert.equal(typeof d.handler, 'function', d.name + ' 的 handler 必须是函数');
  }
});

test('簇 A ⑤ 源码侧同一把尺：5 条 lane 在模块求值期不许 import 实现（不依赖 build）', () => {
  const LANES = ['observe', 'cross', 'design', 'meta', 'refactor'];
  const offenders: string[] = [];
  for (const lane of LANES) {
    const file = path.join(ROOT, 'src', 'application', lane, 'index.ts');
    const src = fs.readFileSync(file, 'utf8');
    // 只看**顶层 import 行**（行首 import，且不是 `import type`）
    const top = src.split('\n').filter((l) => /^import\s/.test(l));
    for (const line of top) {
      for (const m of IMPL_MODULES) {
        const tail = m.split('/').slice(-2).join('/'); // 例：design/handlers.js
        if (line.includes(tail) && !line.includes('import type')) offenders.push(lane + ': ' + line.trim());
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '这些 lane 文件在**模块求值期**（顶层 import）又拉实现模块了 —— 必须改成 handler 体内的 `await import()`：\n' +
      offenders.join('\n'),
  );
});
