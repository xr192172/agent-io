/**
 * MCP/CLI 全量工具「零坏签名」扫描 —— 把**每个**工具都传 `{}`，看它回的是人话还是 Node 原始异常。
 *
 * 为什么值得留在仓里（而不是一次性脚本）：
 *   本仓的每一次结构搬迁（T42 那类）验收里都有同一条：**全量工具零坏签名**。
 *   而"缺参守卫"是会**悄悄退化**的 —— 一个新的 handler 忘了 `requireStr`，
 *   CLI 面（**绕过 zod**，见下）就会抛 `The "path" argument…` 或**静默返回假结果**
 *   （历史实例：`impact_analysis` 静默报"零波及"、`refactor_pipeline` 静默报"全局通过"）。
 *   没有这条扫描，这类退化**只在用户真去用的时候才被发现**。
 *
 * ★ 为什么要走 **CLI 面**：MCP 面由 SDK 按 zod 校验，缺参会先被拦下；
 *   而 `cli.js` 直接调 `invokeTool`，**不做 zod 校验** ⇒ 守卫有没有接上，只有这里看得见。
 *   （两面共用同一份 `[C]` handler 实现。）
 *
 * ★ 判据（两种，都对不上才算合格）：
 *   合格 A —— 返回一句**人话**（如 `缺参数 "project_dir"`）并**非零退出**；
 *   合格 B —— 返回**正常结果**（少数工具 `{}` 是可用的）。
 *   不合格 —— 输出里命中 `paths[0]` / `Cannot read propert` / `The "path"` /
 *             `Command failed: git` / `fatal: not a git` / `reading .map.`（Node 原始异常 / 工具泄漏）
 *
 * ★ 路径无关（不硬编码本仓路径）：入口与 cwd 取自 argv 或 cwd。
 *   用法： node scripts/mcp/mcp_scan.mjs [服务端入口.js] [cwd]
 *   缺省： <cwd>/dist/src/presentation/cli/cli.js ，cwd = 当前目录
 *
 * ★ 隔离：本脚本会给子进程设 `AGENT_IO_HOME=<cwd>/.inspect/_scan_home`，
 *   避免"传 `{}` 的空调用"污染真实数据目录。
 *
 * ★ 退出码：坏签名 > 0 即非零退出（可被 CI / 脚本消费）。
 */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.argv[3] ? path.resolve(process.argv[3]) : process.cwd();
const cli = path.resolve(process.argv[2] ?? path.join(cwd, 'dist/src/presentation/cli/cli.js'));

if (!fs.existsSync(cli)) {
  console.error(`✗ 找不到 CLI 入口：${cli}\n  ⇒ 先构建： npm run build`);
  process.exit(2);
}

const home = path.join(cwd, '.inspect/_scan_home');
fs.mkdirSync(home, { recursive: true });

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

const tools = JSON.parse(execFileSync('node', [cli, 'list', '--json'], { encoding: 'utf8', cwd })).map((t) => t.name);
console.log(`工具数 = ${tools.length}\n`);

const rows = [];
for (const name of tools) {
  const r = spawnSync('node', [cli, name, '--json', '{}'], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, AGENT_IO_HOME: home },
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const hits = BAD.filter((re) => re.test(out)).map((re) => re.source);
  const first = (out.trim().split('\n')[0] ?? '').slice(0, 110);
  rows.push({ name, exit: r.status, bad_signature: hits, first_line: first, spawn_error: r.error?.code ?? null });
  const tag = hits.length
    ? `✗ 坏签名 [${hits.join(' | ')}]`
    : r.status === 0
      ? '· 正常返回'
      : `· 人话(exit=${r.status})`;
  console.log(`${name.padEnd(28)} ${tag}\n    ${first}`);
}

const bad = rows.filter((r) => r.bad_signature.length);
const errs = rows.filter((r) => !r.bad_signature.length && r.exit === 0).length;

console.log('\n================ 汇总 ================');
console.log(`总工具     = ${rows.length}`);
console.log(`✗ 坏签名   = ${bad.length}${bad.length ? '  →  ' + bad.map((r) => r.name).join(', ') : ''}`);
console.log(`· 正常返回 = ${errs}`);
console.log(`· 人话退出 = ${rows.length - bad.length - errs}`);

const jsonOut = path.join(cwd, '.inspect/mcp_scan.json');
fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
console.log(`\n逐条明细： ${jsonOut}`);
process.exit(bad.length ? 1 : 0);
