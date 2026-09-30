/**
 * MCP 冒烟 —— **验 agent-io 服务端能不能被拉起并协商**的最小手法。
 *
 * 为什么值得留在仓里（而不是一次性脚本）：
 *   改 `server.ts` / 契约 / 依赖之后，"服务端还能不能被外部 client 拉起"是**第一件**要知道的事，
 *   而跑完整回归（~2.5min）来回答它太慢。本脚本 2 条 JSON-RPC（initialize + tools/list）就够。
 *
 * ★ 路径无关（不硬编码本仓路径）：服务端入口与 cwd 取自 argv 或 cwd。
 *   用法： node scripts/mcp/mcp_smoke.mjs [服务端入口.js] [cwd]
 *   缺省： <cwd>/dist/src/presentation/mcp/server.js ，cwd = 当前目录
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const cwd = process.argv[3] ? path.resolve(process.argv[3]) : process.cwd();
const entry = path.resolve(process.argv[2] ?? path.join(cwd, 'dist/src/presentation/mcp/server.js'));

const p = spawn('node', [entry], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
let buf = '';
const replies = [];
p.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      replies.push(JSON.parse(line));
    } catch {
      /* 非 JSON 行（日志）忽略 */
    }
  }
});
let err = '';
p.stderr.on('data', (d) => {
  err += d.toString('utf8');
});

const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '1' } },
});
setTimeout(() => {
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
}, 2500);

setTimeout(() => {
  const init = replies.find((r) => r.id === 1);
  const list = replies.find((r) => r.id === 2);
  console.log('── initialize ──');
  if (init?.result) {
    console.log('  serverInfo.name    =', init.result.serverInfo?.name);
    console.log('  serverInfo.version =', init.result.serverInfo?.version);
    console.log('  protocolVersion    =', init.result.protocolVersion);
  } else console.log('  ✗ 无响应：', JSON.stringify(init).slice(0, 200));
  const tools = list?.result?.tools ?? [];
  console.log('── tools/list ──');
  console.log('  工具数 =', tools.length);
  console.log('  前 8 个 =', tools.slice(0, 8).map((t) => t.name).join(', '));
  console.log('  含 capability_map =', tools.some((t) => t.name === 'capability_map'));
  if (err.trim()) console.log('── stderr（尾 4 行）──\n' + err.trim().split('\n').slice(-4).join('\n'));
  p.kill();
  // 判据：拿不到 tools/list 即非零退出（可被 CI / 脚本消费）
  process.exit(tools.length > 0 ? 0 : 1);
}, 6000);
