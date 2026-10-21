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
 * 用法： node scripts/mcp/mcp_scan.mjs [dist 根] [cwd]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cwd = process.argv[3] ? path.resolve(process.argv[3]) : process.cwd();
const distRoot = path.resolve(process.argv[2] ?? path.join(cwd, 'dist'));

const registry = path.join(distRoot, 'src/application/tool_registry.js');
if (!fs.existsSync(registry)) {
  console.error(`✗ 找不到编译产物：${registry}\n  ⇒ 先构建： npm run build`);
  process.exit(2);
}

// ★★ 2026-10-21：**真实**数据目录必须在覆写 `AGENT_IO_HOME` 之前取（此后取到的都是沙箱）。
const realDataHome =
  process.env.AGENT_IO_HOME ??
  (await import(pathToFileURL(path.join(distRoot, 'src/infrastructure/storage.js')).href)).getDataHome();

// ★ 隔离：先设 HOME 再 import —— 那些模块在**加载期**就可能解析数据目录。
process.env.AGENT_IO_HOME = path.join(cwd, '.inspect/_scan_home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
// ★ 账本落点**显式**指回真实目录（`AGENT_IO_DOGFOOD_FILE`，见 `dogfood_stats.ts` 的 `logFile()`）——
//   否则这一遍的记录只会落在沙箱里、真实账本上仍然看不见（= 修了等于没修）。
process.env.AGENT_IO_DOGFOOD_FILE ??= path.join(realDataHome, '.agent-io/dogfood/usage.jsonl');

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

console.log('\n================ 汇总 ================');
console.log(`总工具   = ${rows.length}`);
console.log(`✗ 坏签名 = ${bad.length}${bad.length ? '  →  ' + bad.map((r) => r.name).join(', ') : ''}`);
console.log(`· 其余   = ${rows.length - bad.length}（人话 or 正常返回）`);
console.log('★ **本门没验**：schema 层拦截（zod，故意绕过）· 参数给对时的正确性 · 自由袋子类入参的形状');

const jsonOut = path.join(cwd, '.inspect/mcp_scan.json');
fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
console.log(`\n逐条明细： ${jsonOut}`);
process.exit(bad.length ? 1 : 0);
