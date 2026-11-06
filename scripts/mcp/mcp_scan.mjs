/**
 * 全量工具「零坏签名」扫描 —— 把**每个**工具都传 `{}`，看它回的是人话还是 Node 原始异常。
 *
 * 为什么值得留在仓里（而不是一次性脚本）：
 *   本仓每一次结构搬迁（T42 那类）的验收里都有同一条：**全量工具零坏签名**。
 *   而"缺参守卫"是会**悄悄退化**的 —— 一个新的 handler 忘了 `requireStr`，
 *   就会抛 `The "path" argument…` 或**静默返回假结果**
 *   （历史实例：`impact_analysis` 静默报"零波及"、`refactor_pipeline` 静默报"全局通过"）。
 *   没有这条扫描，这类退化**只在用户真去用的时候才被发现**。
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★★ 2026-10-12（T188）**重写：把检测力要回来** —— 它此前**瞎了**（假绿，最坏那档）
 * ═══════════════════════════════════════════════════════════════
 * ## 事实（逐条核过）
 * · 旧版走 **CLI 面**，理由写在旧注释里：*"`cli.js` 直接调 `invokeTool`，**不做 zod 校验**
 *   ⇒ 守卫有没有接上，只有这里看得见"*。
 * · ★ **这句已经不成立**：`presentation/cli/cli.ts:18` 逐字写着
 *   *"本文件走 `invokeTool()`（与 MCP 面**同一个入口**）"*，而 `invokeTool` 会先
 *   `validateToolArgs` → `argValidatorOf(def).safeParse(a)`（`server_registry.ts:525`）。
 * · ⇒ ★ **两面都先跑 zod** ⇒ 传 `{}` 时**先被 zod 拦下**，**根本走不到 handler 的守卫**。
 *   ⇒ 于是这道门测的是 **zod schema**，**不是** `[B]` 的守卫 ——
 *     ★ 一个 handler 丢了 `requireStr`，它**照样绿**。
 *   ⇒ 这属于「**假绿 / 空过**」：**绿着、没有坐标、而你以为查过了**。
 *
 * ## 修法（按 `gate-authoring` §0 纪律①："要 import 编译产物、**真调函数**、内省运行时对象"）
 * ★ **直接 import `TOOL_DEFS`，调 `def.handler({})`** —— **绕过 zod，专测 handler 自己的守卫**。
 *   · 这也顺带**快得多**（不再每个工具起一个 node 子进程：旧版这道门要 ~44s）。
 *   · ★ `wrap`/`wrapData` 会把异常吞成 `{text, isError}`（**不 throw**）⇒ 判据就是**匹配它的文本**。
 *
 * ## ★ 本门**验什么 / 不验什么**（`gate-authoring` §0 纪律②：没跑的不许显示成通过）
 * · ✅ **验**：handler 在"**只给空参数**"时的**输出形态** —— 是人话，还是 Node 原始异常/外部命令报错。
 *   ⇒ 它守的是"**缺参守卫接上了没有**"。
 * · ❌ **不验**：① **schema 层**的拦截（那是 zod 的活，MCP 面由 SDK 做 —— 本门**故意绕过**它）；
 *   ② 参数**给对了**时的正确性（那是各工具自己的事）；
 *   ③ `z.record(...)` **自由袋子**类入参（如 `explore_code` 的 `args`）里那些键的**形状**
 *     —— 它们**不在** zod 的眼里，只能靠 `[B]` 自己守（已登记的欠账）。
 *
 * ## 判据（两种，都对不上才算合格）
 *   合格 A —— 返回一句**人话**（如 `缺参数 "project_dir"`）；
 *   合格 B —— 返回**正常结果**（少数工具 `{}` 是可用的）。
 *   不合格 —— 输出里命中 `paths[0]` / `Cannot read propert` / `The "path"` /
 *             `Command failed: git` / `fatal: not a git` / `reading .map.`（Node 原始异常 / 外部命令泄漏）
 *
 * ## 隔离与退出码
 * ★ 会给本进程设 `AGENT_IO_HOME=<cwd>/.inspect/_scan_home`，避免"传 `{}` 的空调用"污染真实数据目录。
 * ★ 坏签名 > 0 即非零退出（可被 CI / 脚本消费）。
 *
 * ## ★★ 2026-10-21：**这一遍扫射要入账**
 * ★ 此前它**完全不在狗食账本里**：它直接调 `def.handler({})`（理由见上一段），绕过 `invokeTool`，
 *   而 `recordDogfoodUsage` 只挂在 `invokeTool` 上（`server_registry.ts:817 / :878`）。
 *   ⇒ 后果实测：账本里 `canvas_notes` 的 7 次成功**全在 4 个扫射日**（09-14/09-27/09-28/10-04，
 *     每天 49~66 个工具、相邻只隔 10ms~1.2s）—— 那些**不是** mcp_scan 记的（它一条都没记），
 *     是「agent 自己一个个撞」撞出来的；两边都分不清，因为账本没有 `via`。
 * ★ **为什么不改成走 `invokeTool`**：本门**故意绕过 zod**（见上一段）。`invokeTool` 第一件事就是
 *   `validateToolArgs` ⇒ 走它的话所有 `{}` 都会先被 schema 拦下，**又变回「测 zod、不测 handler 守卫」的假绿**。
 *   ⇒ 所以这里**自己记一条**：验什么、怎么验**一个字不改**。
 * ★ 落点：默认写**真实**账本。隔离（`AGENT_IO_HOME` → `.inspect/_scan_home`）的本意是
 *   「别让 `{}` 空调用污染数据目录」，**不是**「把读数藏进沙箱」。真实数据目录必须在覆写 HOME **之前**取到。
 * ★ `via` 取值：`AGENT_IO_DOGFOOD_VIA` 环境变量，缺省 `'sweep'`；`npm run verify` 会传 `'gate'`
 *   （同一份扫射，但「总门发起的」与「随手扫一遍」是两件事）。
 * ★★ **口径差异（必须知道）**：`via='sweep'|'gate'` 的行里，`ok` = **零坏签名**（本门的判据），
 *   而 `via='mcp'|'cli'|'cert'` 的 `ok` = handler 真的返回成功。两者**不是同一把尺** ⇒
 *   看成功率时先按 `via` 分组，别混在一起算。
 * ★ 需要先 `npm run build`（本门本来就要求 dist —— 见下面的存在性检查）。
 *
 * ## ★★★ 2026-10-31：**工具面固定开销棘轮并入本门**（原 `certs/t326-tool-surface-cost-cert.mjs`）
 * 它守的是一条与"签名"完全不同的不变量：**这段每轮都要重付的 tools 块不许无理由增长**。
 * · 机制（为什么值得守）：不是每次**工具调用**付一遍，是**每个请求**付一遍（一轮调 3 次 = 3 个请求，
 *   整段重发）⇒ 成本 ≈ **工具面大小 × 轮数**。谁加几句描述，成本就静默上涨 —— 此前没有一处会红。
 * · **为什么不新建门/不新建测试**：本门已经在 `import TOOL_DEFS` 且已经打印「工具数 = N」
 *   ⇒ 同一处权威里顺手判它（0.9 一处权威：同一件事不许有两个住处、更不许被两道门各跑一遍）。
 * · **阈值从哪来（★ 不是抄来的数字）**：住 `scripts/mcp/tool-surface-baseline.json`，
 *   那份文件里存的是**上一次实测读数**（`tools` / `chars` / `top10` 明细 / `capturedAt`），
 *   不是人定的阈值。判据只有一条方向：**当前 ≤ 基线**。要变大必须显式
 *   `node scripts/mcp/mcp_scan.mjs --update`（有意识的动作，且该文件的 diff 在评审里可见）；
 *   当前小于基线时本门会提示"可以把基线收紧"（读完立刻知道能收紧多少字符）。
 *   ★ 这就是为什么它不算"抄读数"：数字是**版本化的读数**，每次运行都把**当前实测**打在报告里。
 *
 * 用法： node scripts/mcp/mcp_scan.mjs [dist 根] [cwd] [--update]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ★ 工具面棘轮的基线 —— 与**本文件**同目录（一处权威；不随 cwd / 不随 `certs/` 存亡）
const BASELINE = path.join(HERE, 'tool-surface-baseline.json');
// ★ 位置参数要跳过 `--` 开头的开关（否则 `mcp_scan.mjs --update` 会把 `--update` 当成 dist 根 = 报"找不到编译产物"）
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const UPDATE = process.argv.includes('--update');
const cwd = positional[1] ? path.resolve(positional[1]) : process.cwd();
const distRoot = path.resolve(positional[0] ?? path.join(cwd, 'dist'));

const registry = path.join(distRoot, 'src/application/tool_registry.js');
if (!fs.existsSync(registry)) {
  console.error(`✗ 找不到编译产物：${registry}\n  ⇒ 先构建： npm run build`);
  process.exit(2);
}

/**
 * ★★★ 2026-11-07（T36）：账本落点 = **写端自己的 resolver**（唯一权威 = `dogfood_stats#usageLogFile`）。
 *
 * ## 旧写法错在哪（不是风格问题，是“两本账”）
 * 它自己拼 `path.join(realDataHome, '.agent-io/dogfood/usage.jsonl')`，而那条式子与写端
 * **只在 `AGENT_IO_HOME` 缺省时才一致**：
 *   · 设了 `AGENT_IO_HOME=<root>` ⇒ 写端（`getStorageRoot()` 的 ②）落 `<root>/.agent-io` —— **一致**；
 *   · 不设 ⇒ 写端（③ `<包根>/.agentio-data`）落 `.agentio-data` —— **不一致**。
 * ⇒ 同一个写端按环境**分裂成两本账**。实测：
 *   `.agent-io/dogfood/usage.jsonl` 26,211 行，`via:"mcp"` **零条**（全是门/扫射/证/CLI）；
 *   `.agentio-data/dogfood/usage.jsonl` 10,633 行，`via:"mcp"` **3,720** 条。
 *   于是“拿一本当全部”量出来的每个数都可能是**另一本**的（“业务拒绝 = 0” 就是这么来的）。
 *
 * ★ 必须在覆写 `AGENT_IO_HOME` **之前**调（此后取到的是沙箱）。
 * ★ 为什么不用“写死一个路径”来修：那只是把今天的形状固定下来 —— 下一次改 resolver 又会漂。
 */
export async function resolveLedgerFrom(root) {
  const mod = await import(pathToFileURL(path.join(root, 'src/infrastructure/dogfood_stats.js')).href);
  return mod.usageLogFile();
}

// ★★ 2026-11-07：**真实账本路径必须在覆写 `AGENT_IO_HOME` 之前取**（此后取到的都是沙箱）。
const realLedger = await resolveLedgerFrom(distRoot);

// ★ 隔离：先设 HOME 再 import —— 那些模块在**加载期**就可能解析数据目录。
process.env.AGENT_IO_HOME = path.join(cwd, '.inspect/_scan_home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
// ★ 账本落点**显式**指回真实目录（`AGENT_IO_DOGFOOD_FILE`，见 `dogfood_stats.ts` 的 `logFile()`）——
//   否则这一遍的记录只会落在沙箱里、真实账本上仍然看不见（= 修了等于没修）。
// ★★ 2026-11-07（T36）：落点**不再自己拼** —— 用上一步从写端 resolver 取到的**同一个式子**算出来的那一个。
process.env.AGENT_IO_DOGFOOD_FILE ??= realLedger;

// ★ Windows：动态 import 绝对路径必须是 file:// URL（否则 ES 加载器报 ERR_UNSUPPORTED_ESM_URL_SCHEME）
const { TOOL_DEFS } = await import(pathToFileURL(registry).href);
// ★ 入账走**同一个写端**（不在这儿自己拼 JSON —— 一条字段改了、两处写法就会漂）。
const { recordDogfoodUsage } = await import(
  pathToFileURL(path.join(distRoot, 'src/infrastructure/dogfood_stats.js')).href
);
const VIA = process.env.AGENT_IO_DOGFOOD_VIA ?? 'sweep';

/** 「坏签名」的六条模式 —— 全是 Node 原始异常或被工具泄漏出去的外部命令报错。 */
const BAD = [
  /paths\[0\]/,
  /Cannot read propert/,
  /The "path"/,
  /Command failed: git/,
  /fatal: not a git/,
  /reading 'map'/,
  /reading "map"/,
];

console.log(`工具数 = ${TOOL_DEFS.length}`);
console.log('★ 本门**绕过 zod** 直接调 handler（专测缺参守卫；★ 它**不**验 schema 层拦截）\n');

// ══════════════════════════════════════════════════════════════════════
// 工具面固定开销棘轮（2026-10-31 从 `certs/t326-tool-surface-cost-cert.mjs` 并入；
// ★ 判据一条不少：①字符数不增长 ②工具数不增长 ③基线含 Top-10 明细 ④dist 不比 src 旧）
// ══════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-02（度量统一）：原来这里是
//   `JSON.stringify({name, description, title, inputSchema: <zod shape>}).length`
//   —— 量的是 **zod 内部结构** + **UTF-16 码元数**（中文一字算 1、实际 3 字节 ⇒ 低估约 1.6 倍），
//   而且**不含**入口注入的 actor/authorize。于是同一个 44 工具的工具面在仓里有**两个数**：
//   本文件的 136,968"字符" 与 tests/budget 的 215,158 字节 —— 谁也不认谁（两张表各说各话）。
//   ⇒ 现在唯一把尺在 `scripts/mcp/tool_surface.mjs`：起 server 取真 `tools/list`，按 UTF-8 字节量。
//   ★ 基线因此**跳变是允许的**，但原因必须写在 commit 里：改前量的不是 wire 字节。
const { readToolsListWire, surfaceSummary } = await import('./tool_surface.mjs');
const reading = await readToolsListWire({
  projectDir: cwd,
  serverEntry: path.join(distRoot, 'src/presentation/mcp/server.js'),
});
const surf = surfaceSummary(reading);
const toolCount = surf.tools;
const surfaceBytes = surf.bytes;
const top10 = surf.top10;
const top10Share = surfaceBytes ? ((100 * top10.reduce((n, [, l]) => n + l, 0)) / surfaceBytes).toFixed(1) : '0.0';
/** 字节 → token 区间（粗估：中文密 ≈2.5 字节/token，英文/JSON 疏 ≈3.5）★ 字节数才是实测 */
const tokRange = (c) => `${Math.round(c / 3.5 / 1000)}k–${Math.round(c / 2.5 / 1000)}k`;

const ratchetFails = [];
if (toolCount !== TOOL_DEFS.length) {
  ratchetFails.push(
    `① 线上工具数(${toolCount}) 必须等于 TOOL_DEFS(${TOOL_DEFS.length}) —— 不相等说明面被过滤/多注册，本门量到的不是全部契约`,
  );
}
const ratchetLine = (ok, label, detail) => {
  if (!ok) ratchetFails.push(`${label}（${detail}）`);
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  —— ${detail}` : ''}`);
};

console.log('════════ 工具面固定开销（每请求重付；棘轮 = 只许不增长）════════');
console.log(
  `  读数（实测 wire）：工具 ${toolCount} 个 · tools 块 **${surfaceBytes} B（UTF-8）** · 平均 ${Math.round(surfaceBytes / toolCount)} B/工具` +
    ` · 整份响应体 ${surf.totalBytes} B（含信封 ${surf.envelopeBytes} B）`,
);
console.log(`  粗估 token：约 ${tokRange(surfaceBytes)}（每个请求重付一遍；稳定前缀可走缓存）`);
console.log(`  Top-10 占 ${top10Share}%：${top10.map(([n, l]) => `${n} ${l}`).join(' · ')}`);

// ── ④ dist 不许比 src 旧 —— 否则这一段量的是**旧产物**（本仓踩过"dist 旧 ⇒ 对账三处对不上"）──
//   ★ 锚 `dist/.build-manifest.json`（`scripts/clean_dist.mjs` **每轮构建都重写它**）而不是某个 .js 的 mtime：
//     `tsc --incremental` 不重写未变动的文件 ⇒ 拿单个产物当"新鲜度"会假红（T326 2026-10-30 的修法）。
// ★★★ 2026-10-31（第十轮复核）：原来这里用 `dist/.build-manifest.json` 的 **mtime** 当"dist 新鲜"的时钟 ——
//   而 `scripts/clean_dist.mjs` 单独跑就会重写那个文件 ⇒ **不 build 也能把时钟刷绿**（假绿）。
//   ⇒ 委派唯一实现 `stale_check#checkStaleBuild`（**内容哈希**判据，与 judge-all 同一把尺），不在这里再算一遍（0.9 一处权威）。
const { checkStaleBuild } = await import(
  new URL('../../dist/src/application/observe/runtime/stale_check.js', import.meta.url).href
);
let fresh = { stale: false, entries: [], scanned: 0, skipped: [], basis: 'n/a' };
try {
  fresh = checkStaleBuild(cwd);
} catch (e) {
  ratchetLine(false, '④ dist 新鲜度判得了', `尺子读不到：${String(e?.message ?? e).slice(0, 120)}`);
}
if (fresh && typeof fresh.stale === 'boolean') {
  ratchetLine(
    !fresh.stale,
    '④ dist 不比 src 旧（否则这一段量的是旧产物）',
    fresh.stale
      ? `dist 旧 ⇒ 先 \`npm run build\` 再跑本门（${fresh.entries.length}/${fresh.scanned} 源未重建，basis=${fresh.basis}）`
      : `一致（${fresh.scanned} 个手写源，basis=${fresh.basis}）`,
  );
  if (Array.isArray(fresh.skipped) && fresh.skipped.length) {
    // ★ 0.12 ③：分母两半都给 —— 有源读不到 ⇒ 新鲜度只验了一部分，不许当"dist 最新"放行
    ratchetLine(
      false,
      '⑤ dist 新鲜度验全了',
      `扫到 ${fresh.scanned} 个源，其中 ${fresh.skipped.length} 个读不到 ⇒ 剩下的可能比 src 旧`,
    );
  }
}

// ── 基线：**上一次实测读数**（不是人定的阈值）──
const rec = { tools: toolCount, bytes: surfaceBytes, totalBytes: surf.totalBytes, top10, capturedAt: new Date().toISOString().slice(0, 10) };
let pendingBaseline = false;
// ★★★ 2026-10-31（第四轮独立复核抓到）：原来条件是 `UPDATE || !fs.existsSync(BASELINE)` ——
//   基线**缺失**时就用当前读数自建、**跳过下面 ①②③ 的比对**，还在门里回写文件并声称"本次是**显式**动作"
//   ⇒ **删掉 baseline.json 就永久放宽**（"唯一删个文件就变绿"的洞）。
//   ⇒ 基线**只许 `--update` 写**；缺失必须 **FAIL**（0.12：读不到 ≠ 没有）。
if (!UPDATE && !fs.existsSync(BASELINE)) {
  ratchetLine(
    false,
    '① 工具面基线存在',
    `缺 ${path.relative(cwd, BASELINE)} ⇒ 基线只许显式建立：\`node scripts/mcp/mcp_scan.mjs --update\`` +
      '（有意识动作，本文件的 diff 会在评审里现形）',
  );
} else if (UPDATE) {
  // ★★★ 2026-10-31（第十轮复核，与 E-3 同族）：原来**基线写盘就在这里**，早于下面的坏签名判定与退出码 ⇒
  //   失败态（如 ④ dist 旧）跑 `--update` 照样把基线按**坏读数**重写 ⇒ 棘轮被永久放宽。
  //   ⇒ 写盘推迟到本次运行判完之后（见下方 `if (pendingBaseline)`），且**有任何失败就不写**。
  pendingBaseline = true;
  console.log('  ★ --update：基线将在本次运行**判完之后**才写盘（有坏签名 / 棘轮失败 ⇒ 不写）');
} else {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  console.log(`  基线（上次读数，住 ${path.relative(cwd, BASELINE)}，采集于 ${base.capturedAt}）：工具 ${base.tools} 个 · ${base.bytes} B`);
  ratchetLine(
    typeof base.bytes === 'number' && surfaceBytes <= base.bytes,
    '① 工具面开销未增长（≤ 基线）',
    `当前 ${surfaceBytes} B / 基线 ${base.bytes} B（差 ${surfaceBytes - (base.bytes ?? 0)}）—— ★ 单位是 UTF-8 字节（wire），不是字符`,
  );
  ratchetLine(toolCount <= base.tools, '② 工具数未增长', `当前 ${toolCount} / 基线 ${base.tools}`);
  ratchetLine(
    Array.isArray(base.top10) && base.top10.length >= 5 && base.top10.every((x) => Array.isArray(x) && typeof x[1] === 'number'),
    '③ 基线含 Top-10 明细（把一个工具悄悄撑大 ⇒ 在它的 diff 里现形）',
    `top10 条目 ${Array.isArray(base.top10) ? base.top10.length : '缺失'}`,
  );
  if (surfaceBytes < base.bytes) {
    console.log(
      `\n  ★ 比基线**小了 ${base.bytes - surfaceBytes} B** —— 可以把基线收紧（有意识动作）：` +
        '`node scripts/mcp/mcp_scan.mjs --update`',
    );
  }
  if (surfaceBytes > base.bytes) {
    console.log('\n  ★★ 工具面变大了。两条路（二选一，都要有意识）：');
    console.log('     ① 把描述压回去（★ Top-10 占四成以上，见上面读数）；');
    console.log('     ② 若确有必要 ⇒ `--update` 更新基线，并在提交信息里写清理由。');
  }
}
console.log('');

const rows = [];
for (const def of TOOL_DEFS) {
  let out = '';
  let threw = null;
  const t0 = Date.now();
  try {
    const r = await def.handler({});
    out = typeof r?.text === 'string' ? r.text : JSON.stringify(r ?? null);
  } catch (e) {
    // ★ `wrap` 通常把异常吞成 {text,isError}；真漏出来的照收 —— 那也是证据。
    threw = String(e?.message ?? e);
    out = threw;
  }
  const hits = BAD.filter((re) => re.test(out)).map((re) => re.source);
  // ★★ 2026-10-21：入账（`via` 见文件头）。★ `ok` 在这里的口径是**本门的判据**（零坏签名），
  //   不是「handler 返回成功」—— `{}` 空调用本来就该被守卫拒掉，那不算失败。别拿它算采纳率。
  recordDogfoodUsage({
    ts: new Date().toISOString(),
    tool: def.name,
    via: VIA,
    ok: hits.length === 0,
    ms: Date.now() - t0,
    err: threw ?? (hits.length ? `坏签名[${hits.join(' | ')}]` : undefined),
  });
  const first = (out.trim().split('\n')[0] ?? '').slice(0, 110);
  rows.push({ name: def.name, bad_signature: hits, first_line: first, threw });
  console.log(
    `${def.name.padEnd(28)} ${hits.length ? `✗ 坏签名 [${hits.join(' | ')}]` : '· 人话/正常返回'}\n    ${first}`,
  );
}

const bad = rows.filter((r) => r.bad_signature.length);
// ★★★ 基线写盘（推迟到这里：本次跑的结论已经清楚）
if (pendingBaseline) {
  if (bad.length || ratchetFails.length) {
    console.log(
      `\n✗ 本次有失败（坏签名 ${bad.length} / 工具面棘轮 ${ratchetFails.length}）⇒ **拒绝更新基线**` +
        '（基线不许按坏读数改写；先修好再 --update）',
    );
  } else {
    fs.writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          note:
            '工具面固定开销基线 = **上一次实测读数**（`scripts/mcp/mcp_scan.mjs` 每次运行都会现算当前值并打印，' +
            '两者一比就是本门判据）。★ 字段含义：tools=线上工具数 · bytes=全部工具契约面 **wire 字节**（UTF-8，' +
            '逐条目 `Buffer.byteLength(JSON.stringify(entry))`）之和 · totalBytes=整份 tools/list 响应体 · ' +
            'top10=最占篇幅的十个工具（评审就靠这一眼看"谁把面撑大了"）· capturedAt=这份读数的采集日。' +
            '★ 判据只有一条方向：当前 ≤ 基线；要变大必须显式 `node scripts/mcp/mcp_scan.mjs --update`' +
            '（有意识动作，且只许在**本次无失败**时写盘；本文件的 diff 会在评审里现形）。' +
            '★★ 2026-11-02 起单位是**字节**不是字符：旧基线存的是 `JSON.stringify(<zod shape>).length`（UTF-16 码元），' +
            '中文被低估约 1.6 倍且不含注入的 actor/authorize ⇒ 那次跳变不是工具面变大，是尺子换了。',
          ...rec,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(`\n  ★ 已更新基线 → ${path.relative(cwd, BASELINE)}（工具 ${rec.tools} · ${rec.bytes} B wire）`);
    console.log('  ★ 更新基线 = 声明"我知道工具面变大了"。请在提交信息里写清理由。');
  }
}

console.log('\n================ 汇总 ================');
console.log(`总工具   = ${rows.length}`);
const markBad = bad.length ? '✗' : '·';
console.log(`${markBad} 坏签名 = ${bad.length}${bad.length ? '  →  ' + bad.map((r) => r.name).join(', ') : ''}`);
console.log(`· 其余   = ${rows.length - bad.length}（人话 or 正常返回）`);
console.log(`${ratchetFails.length ? '✗' : '·'} 工具面棘轮 = ${ratchetFails.length}${ratchetFails.length ? '  →  ' + ratchetFails.join(' / ') : ''}`);
console.log('★ **本门没验**：schema 层拦截（zod，故意绕过）· 参数给对时的正确性 · 自由袋子类入参的形状');

const jsonOut = path.join(cwd, '.inspect/mcp_scan.json');
fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
console.log(`\n逐条明细： ${jsonOut}`);
// ★ 两道判据都在这一个退出码里（坏签名 / 工具面棘轮）—— 它们同属"工具面这件事"，不拆成两道门
process.exit(bad.length || ratchetFails.length ? 1 : 0);

