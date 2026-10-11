/**
 * MCP 单次调用 —— 从命令行调**任意一个** agent-io 工具，打印它的回执。
 *
 * 为什么值得留在仓里：这是**最容易复用的调试入口**——
 *   想知道"某个工具现在返回什么"（尤其带 `---DATA---` 机器字段时），
 *   不必起 host、不必写测试、不必进 REPL。改契约/改回执时是第一个该跑的东西。
 *
 * ★★★ 2026-10-11（T167）**修两处"让量具撒谎"的形态** —— 而它骗到的是**我**：
 *   · **原先**：`initialize` 之后 `setTimeout(…, 2200)` 才发 `tools/call`，
 *     再 `setTimeout(…, 90000)` **死等 90 秒**才打印退出。
 *     ⇒ ★ 于是**任何人用它测出来的"这个工具很慢"都是假的**：
 *       `structure_gap` 走它报 **90,111 ms**，而**同一个 [B]** 走壳只要 **121 ms**。
 *       我当场把它读成了"**工具面比壳慢 745 倍**"—— **那是把"固定窗口"当成了"开销"**。
 *   · **现在**：**收到 `initialize` 的响应 ⇒ 立刻发下一棒**；**收到 `tools/call` 的响应 ⇒ 立刻打印退出**。
 *     ⇒ 计时才真的是"工具面的代价"。
 *   · ★ 兜底超时**保留**，但**超时要说出来** —— 原先超时会打印 `(空回执)`，
 *     与"工具真的返回空"**长得一样**（本仓最反对的"沉默被读成没问题"）。
 *
 * ★ 路径无关。用法：
 *   node scripts/mcp/mcp_call.mjs <tool> '<json args>' [服务端入口.js] [cwd]
 *   例：node scripts/mcp/mcp_call.mjs capability_map '{}'
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

/** ★ 只作**兜底**：正常路径是"收到 id=2 的响应就退"（不再是"等满这个数"） */
const HARD_TIMEOUT_MS = 120000;

const [tool, argsJson, entryArg, cwdArg] = process.argv.slice(2);
if (!tool) {
  console.error("用法: node scripts/mcp/mcp_call.mjs <tool> '<json args>' [入口.js] [cwd]");
  process.exit(2);
}
let args;
try {
  args = JSON.parse(argsJson || '{}');
} catch (e) {
  console.error(`入参不是合法 JSON：${e.message}`);
  process.exit(2);
}
const cwd = cwdArg ? path.resolve(cwdArg) : process.cwd();
const entry = path.resolve(entryArg ?? path.join(cwd, 'dist/src/presentation/mcp/server.js'));

const p = spawn('node', [entry], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
let buf = '';
let out = '';
let err = '';
let done = false;
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');

function finish(code, extra) {
  if (done) return; // ★ 幂等：正常退出与超时兜底可能同时到
  done = true;
  if (extra) console.log(extra);
  console.log(out || '(空回执)');
  if (err.trim()) console.log('--- stderr ---\n' + err.trim().split('\n').slice(-3).join('\n'));
  try {
    p.kill();
  } catch {
    /* 已死 */
  }
  process.exit(code);
}

p.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!l) continue;
    try {
      const r = JSON.parse(l);
      if (r.id === 1) {
        // ★ 收到 initialize 的响应 ⇒ **立刻**发下一棒（原先在这里硬等 2.2 秒）
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
      } else if (r.id === 2) {
        out = (r.result?.content ?? []).map((x) => x.text ?? '').join('\n');
        if (r.result?.isError) out += '\n[isError=true]';
        // ★ 拿到回执 ⇒ 立刻退出（原先在这里硬等 90 秒）
        finish(out ? 0 : 1);
      }
    } catch {
      /* 日志行（非 JSON-RPC） */
    }
  }
});
p.stderr.on('data', (d) => {
  err += d.toString('utf8');
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-call', version: '1' } },
});

setTimeout(() => {
  // ★ **超时要说出来**：不许让它长得像"工具返回空"
  finish(1, `⚠ 超时：${HARD_TIMEOUT_MS} ms 内没收到 id=2 的响应 ⇒ **这次没测到**，不是"工具返回空"。`);
}, HARD_TIMEOUT_MS);
