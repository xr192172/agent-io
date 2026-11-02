/**
 * 工具面度量 —— **一把尺**：真发出去的 `tools/list`（JSON-RPC 响应体）的 UTF-8 字节。
 *
 * ## 为什么必须有它（2026-11-02：同一天量出两个数，谁也不认谁）
 * 同一份 44 个工具，仓里曾并存两把尺：
 *   · `scripts/mcp/mcp_scan.mjs` 的 `sizeOfTool` —— `JSON.stringify({... inputSchema: <zod shape>}).length`
 *     ⇒ 量的是 **zod 内部结构** + **UTF-16 码元数**（中文一字算 1，实际 3 字节 ⇒ **低估约 1.6 倍**），
 *       而且它**不含**入口注入的 `actor` / `authorize`；
 *   · `tests/budget/payload_budget.test.ts` 登记的 wire 值 —— 起 server 取 JSON-RPC 响应体。
 * ⇒ 两张表各说各话（136,968 "字符" vs 215,158 字节），**没法互相验收**。
 *
 * ## 口径（唯一）
 * 起一个真的 stdio MCP server → `initialize` → `tools/list` → 对**解析回来的每个工具条目**取
 * `Buffer.byteLength(JSON.stringify(entry), 'utf8')`。⇒ 它量的就是模型收到的那段字节。
 * ★ 不含 JSON-RPC 信封（`{"jsonrpc","id","result":{"tools":[…]}}`）：信封与工具数无关，
 *   是常量开销；要总数时用 `totalBytes`（= 整份响应体，含信封），两条都在读数里。
 *
 * ## 谁读它（**别在别处再写一份**）
 * · `scripts/mcp/mcp_scan.mjs` 的工具面棘轮（基线 `tool-surface-baseline.json`）；
 * · `tests/budget/payload_budget.test.ts` 的 `tools/list` 预算 —— 并断言**两条路径对同一工具报数相等**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** UTF-8 字节 —— 全仓载荷度量的唯一口径（中文一字 3 字节）。 */
export const wireBytes = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');

/**
 * 起 server 取 `tools/list`。
 *
 * @param {object} o
 * @param {string} o.projectDir 必须能在其下找到入口（用来构造 package 相对路径的隔离 HOME）
 * @param {string} o.serverEntry server 入口（`.ts` ⇒ 走 `--import tsx` 直跑源码；`.js` ⇒ 直跑产物）
 * @param {string} [o.home] `AGENT_IO_HOME`（缺省 `<projectDir>/.inspect/_surface_home`；隔离，别污染真数据）
 * @param {Record<string,string>} [o.env] 额外环境变量
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{tools:{name:string,bytes:number}[], totalBytes:number, response:any}>}
 */
export async function readToolsListWire(o) {
  const { projectDir, serverEntry } = o;
  const home = o.home ?? path.join(projectDir, '.inspect/_surface_home');
  fs.mkdirSync(home, { recursive: true });
  const isTs = /\.ts$/.test(serverEntry);
  const args = isTs ? ['--import', 'tsx', serverEntry] : [serverEntry];
  const child = spawn(process.execPath, args, {
    cwd: projectDir,
    env: { ...process.env, ...(o.env ?? {}), AGENT_IO_HOME: home },
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  let buf = '';
  /** @type {Array<{id:number,res:(v:any)=>void}>} */
  const waiters = [];
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      for (const w of waiters.filter((x) => x.id === msg.id)) w.res(msg);
    }
  });

  const timeout = o.timeoutMs ?? 60_000;
  const send = (payload) =>
    new Promise((res, rej) => {
      waiters.push({ id: payload.id, res });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      // ★ `unref()`：计时器不许把父进程留住（否则测试会在断言跑完之后再等满超时）
      const t = setTimeout(() => rej(new Error(`tools/list 超时（${payload.method}）`)), timeout);
      t.unref?.();
    });

  try {
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tool-surface', version: '1' } },
    });
    const res = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = res?.result?.tools;
    if (!Array.isArray(tools) || !tools.length) {
      // ★ 0.12：读不到 ≠ 0 个工具 —— 这里必须响亮
      throw new Error(`tools/list 没有工具（读不到 ≠ 没有）：${JSON.stringify(res).slice(0, 300)}`);
    }
    return {
      response: res,
      tools: tools.map((t) => ({ name: String(t.name), bytes: wireBytes(t) })),
      totalBytes: wireBytes(res),
    };
  } finally {
    child.kill();
  }
}

/**
 * 从一份读数里算出**棘轮要存的那几个数**（mcp_scan 与预算测试共用同一份换算）。
 * @param {{tools:{name:string,bytes:number}[], totalBytes:number}} reading
 */
export function surfaceSummary(reading) {
  const sized = [...reading.tools].sort((a, b) => b.bytes - a.bytes);
  const bytes = sized.reduce((n, t) => n + t.bytes, 0);
  return {
    tools: sized.length,
    /** 全部工具契约面之和（不含 JSON-RPC 信封） */
    bytes,
    /** 整份响应体（含信封 + 逗号） */
    totalBytes: reading.totalBytes,
    /** 信封开销 = 整份 − 各工具之和 − 分隔符 */
    envelopeBytes: reading.totalBytes - bytes - Math.max(0, sized.length - 1),
    top10: sized.slice(0, 10).map((t) => [t.name, t.bytes]),
  };
}
