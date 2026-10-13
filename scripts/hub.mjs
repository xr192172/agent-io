// npm run hub：一键启动 agent-io 的**数据/API 引擎**（供前端连）
// ★ 2026-10-13 更正：本脚本原写「主页/项目页由 serve 动态渲染」，并引用
//   `dist/src/tools/serve.js` —— 两者**都已不成立**：serve 已撤掉全部自包含页面
//   （`GET /` 只回一段 JSON，`/workbench` 实测 404），且 `src/tools/` 已重组为
//   presentation/http。⇒ 现在 hub = 把引擎跑起来 + 告诉你前端在哪，**不再假装有页面**。
// 用法：npm run hub        （默认 3000 端口）
//       npm run hub 8081   （指定端口）
//       AGENT_IO_FRONTEND_URL=http://localhost:5173 npm run hub   （顺带打开独立前端）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.argv[2]) || 3000;
const BASE_URL = `http://localhost:${PORT}`;
const SERVE_JS = path.join(ROOT, 'dist', 'src', 'presentation', 'http', 'serve.js');
const FRONTEND_URL = (process.env.AGENT_IO_FRONTEND_URL || '').trim();

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}`))));
  });
}

async function waitReady(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function openBrowser(url) {
  const plat = process.platform;
  const cmd = plat === 'win32' ? 'cmd' : plat === 'darwin' ? 'open' : 'xdg-open';
  const args = plat === 'win32' ? ['/c', 'start', '""', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

function frontendHint() {
  const sibling = path.resolve(ROOT, '..', 'dsl-workbench');
  if (fs.existsSync(path.join(sibling, 'package.json'))) {
    return `[hub] 前端（独立仓）本地已存在：${sibling}\n[hub]   cd ${sibling} && npm install && npm run dev`;
  }
  return '[hub] 前端（独立仓）：git clone https://github.com/xr192172/dsl-workbench 后 npm install && npm run dev';
}

// 0. 端口已有服务？直接复用，不重复起
if (await waitReady(BASE_URL, 1200)) {
  console.log(`[hub] 端口 ${PORT} 已有服务在跑，直接复用 ${BASE_URL}`);
  console.log(frontendHint());
  if (FRONTEND_URL) openBrowser(FRONTEND_URL);
  process.exit(0);
}

// 1. dist 缺失 → 先构建
if (!fs.existsSync(SERVE_JS)) {
  console.log('[hub] dist 不存在，先 npm run build …');
  await run('npm', ['run', 'build']);
}

// 2. 起 serve（前台常驻；★ 纯数据/API 引擎，无页面）
console.log(`[hub] 启动数据/API 引擎（端口 ${PORT}）…  Ctrl+C 停止`);
const server = spawn(process.execPath, [SERVE_JS, String(PORT)], { stdio: 'inherit', cwd: ROOT });
server.on('close', (code) => process.exit(code ?? 0));

// 3. 服务就绪后指路（★ 不再开 BASE_URL —— 它只回一段 JSON，不是页面）
if (await waitReady(BASE_URL, 15000)) {
  console.log(`[hub] 引擎已就绪：${BASE_URL}`);
  console.log(frontendHint());
  if (FRONTEND_URL) {
    console.log(`[hub] 打开前端 ${FRONTEND_URL}`);
    openBrowser(FRONTEND_URL);
  }
} else {
  console.warn(`[hub] 等待服务就绪超时，请查看上方日志排查`);
}
