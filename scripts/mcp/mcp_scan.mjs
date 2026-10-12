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

// ★ 隔离：先设 HOME 再 import —— 那些模块在**加载期**就可能解析数据目录。
process.env.AGENT_IO_HOME = path.join(cwd, '.inspect/_scan_home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

// ★ Windows：动态 import 绝对路径必须是 file:// URL（否则 ES 加载器报 ERR_UNSUPPORTED_ESM_URL_SCHEME）
const { TOOL_DEFS } = await import(pathToFileURL(registry).href);

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
  try {
    const r = await def.handler({});
    out = typeof r?.text === 'string' ? r.text : JSON.stringify(r ?? null);
  } catch (e) {
    // ★ `wrap` 通常把异常吞成 {text,isError}；真漏出来的照收 —— 那也是证据。
    threw = String(e?.message ?? e);
    out = threw;
  }
  const hits = BAD.filter((re) => re.test(out)).map((re) => re.source);
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
