/**
 * MCP 单次调用 —— 从命令行调**任意一个** agent-io 工具，打印它的回执。
 *
 * 为什么值得留在仓里：这是**最容易复用的调试入口**——
 *   想知道"某个工具现在返回什么"（尤其带 `---DATA---` 机器字段时），
 *   不必起 host、不必写测试、不必进 REPL。改契约/改回执时是第一个该跑的东西。
 *
 * ★ 路径无关。用法：
 *   node scripts/mcp/mcp_call.mjs <tool> '<json args>' [服务端入口.js] [cwd]
 *   例：node scripts/mcp/mcp_call.mjs capability_map '{}'
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const [tool, argsJson, entryArg, cwdArg] = process.argv.slice(2);
if (!tool) {
  console.error("用法: node scripts/mcp/mcp_call.mjs <tool> '<json args>' [入口.js] [cwd]");
  process.exit(2);
}
const cwd = cwdArg ? path.resolve(cwdArg) : process.cwd();
const entry = path.resolve(entryArg ?? path.join(cwd, 'dist/src/presentation/mcp/server.js'));

const p = spawn('node', [entry], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
let buf = '';
let out = '';
let err = '';
p.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!l) continue;
    try {
      const r = JSON.parse(l);
      if (r.id === 2) {
        out = (r.result?.content ?? []).map((x) => x.text ?? '').join('\n');
        if (r.result?.isError) out += '\n[isError=true]';
      }
    } catch {
      /* 日志行 */
    }
  }
});
p.stderr.on('data', (d) => {
  err += d.toString('utf8');
});

const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-call', version: '1' } },
});
setTimeout(() => {
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: JSON.parse(argsJson || '{}') } });
}, 2200);

setTimeout(() => {
  console.log(out || '(空回执)');
  if (err.trim()) console.log('--- stderr ---\n' + err.trim().split('\n').slice(-3).join('\n'));
  p.kill();
  process.exit(out ? 0 : 1);
}, 90000);
