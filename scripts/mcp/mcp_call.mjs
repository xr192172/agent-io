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
 *   node scripts/mcp/mcp_call.mjs --describe <tool>      # ★ 打印该工具的 title / description / 入参名
 *   例：node scripts/mcp/mcp_call.mjs capability_map '{}'
 *
 * ★★★ 2026-10-11（T174）：加 `--describe` —— 修一个**实验环境的缺口**（不是产品缺陷）：
 *   本壳原先**只印回执、不印工具描述**，而真实 MCP host 是**把描述给模型的**（`tools/list`）。
 *   ⇒ 后果（黑盒第四轮实测）：`edit_dsl` 的回执/报错里写「完整字段表见 `edit_dsl` 描述里的「data 契约」段」，
 *     而**读它的人拿不到描述** ⇒ ★ **那句"指路"对他 = 死路**，只能靠"故意发非法入参套 schema"。
 *   ⇒ 现在壳能打印描述 ⇒ **实验环境与真实 host 对齐**。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

/** ★ 只作**兜底**：正常路径是"收到 id=2 的响应就退"（不再是"等满这个数"） */
const HARD_TIMEOUT_MS = 120000;

const [tool, argsJson, entryArg, cwdArg] = process.argv.slice(2);
if (!tool) {
  console.error("用法: node scripts/mcp/mcp_call.mjs <tool> '<json args>' [入口.js] [cwd]\n     : node scripts/mcp/mcp_call.mjs --describe <tool>");
  process.exit(2);
}
// ★ T174：`--describe <tool>` ⇒ 走 `tools/list` 打印该工具的 title / description / 入参名。
const isDescribe = tool === '--describe';
const describeTarget = isDescribe ? argsJson : undefined;
if (isDescribe && !describeTarget) {
  console.error('用法: node scripts/mcp/mcp_call.mjs --describe <工具名>');
  process.exit(2);
}
let args;
if (!isDescribe) {
  try {
    args = JSON.parse(argsJson || '{}');
  } catch (e) {
    console.error(`入参不是合法 JSON：${e.message}`);
    process.exit(2);
  }
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
        send(
          isDescribe
            ? { jsonrpc: '2.0', id: 2, method: 'tools/list' }
            : { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } },
        );
      } else if (r.id === 2) {
        if (isDescribe) {
          // ★ T174：把描述**原样**给出来（真实 host 就是把它给模型的）
          const list = r.result?.tools ?? [];
          const t = list.find((x) => x.name === describeTarget);
          if (!t) {
            out = `没有这个工具："${describeTarget}"。★ 共 ${list.length} 个工具；列表见 capability_map（或 AGENT_IO_MCP_FACE=composed 下的 atomic_call action=list）。`;
          } else {
            const sch = t.inputSchema ?? {};
            const req = Array.isArray(sch.required) ? sch.required : [];
            const names = Object.keys(sch.properties ?? {});
            out =
              `【${t.name}】${t.title ?? ''}\n\n` +
              `${t.description ?? '(无描述)'}\n\n` +
              `── 入参（顶层名）──\n` +
              names.map((n) => `${req.includes(n) ? '★必填' : '  可选'}  ${n}`).join('\n');
          }
          finish(out ? 0 : 1);
        } else {
          out = (r.result?.content ?? []).map((x) => x.text ?? '').join('\n');
          if (r.result?.isError) out += '\n[isError=true]';
          // ★ 拿到回执 ⇒ 立刻退出（原先在这里硬等 90 秒）
          finish(out ? 0 : 1);
        }
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
