#!/usr/bin/env node
/**
 * npm run demo —— 黄金演示路径：克隆后几步看到 agent-io 的价值
 *
 * 流程：build（缺则补）→ 把 examples/*.json 存成 feature（走 saveDSL，与工具链同一条落盘路径）
 *       → 起 serve（数据/API 引擎）→ 提示前端接法。
 *
 * ★ 2026-10-13 更正：本脚本此前引用 `dist/src/tools/serve.js` 与
 *   `dist/src/tools/render_design.js`（并取 `r.htmlFile`）—— 三者**都已不存在**：
 *   `src/tools/` 已按 application/domain/infrastructure/presentation 分层重组；
 *   自包含 HTML 渲染器 2026-09-30 删除 ⇒ `render_design` 不再产 `htmlFile`。
 *   ⇒ 本脚本原样是**一跑就崩**（且因 SERVE_JS 恒不存在，每次都白跑一遍 build）。
 *   现改为：落盘走 `saveDSL`（真实存储入口），服务走 `presentation/http/serve.js`。
 *   ★ 同时**不再假装**能打开 `/workbench` —— 那个页面已撤（实测 404），
 *   前端统一为**独立仓库** dsl-workbench。要用浏览器看，请按末尾提示在前端仓跑 dev。
 *
 * 用法（agent-io 根）：
 *   npm run demo                 # 准备示例 + 起服务（数据/API 引擎）
 *   npm run demo -- 8081         # 指定端口
 *   npm run demo -- --prepare    # 只准备示例（构建 + 落盘 feature），不起服务（适合 CI/验收）
 *   npm run demo -- --open       # 若设了 AGENT_IO_FRONTEND_URL，就顺手打开它
 *
 * 幂等：已有同名 feature（用户数据）不会被覆盖，仅提示跳过。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const PREPARE_ONLY = ARGS.includes('--prepare');
const OPEN_FRONTEND = ARGS.includes('--open');
const PORT_ARG = ARGS.find((a) => /^\d+$/.test(a));
const PORT = PORT_ARG ? parseInt(PORT_ARG, 10) : parseInt(process.env.AGENT_IO_PORT || '3000', 10);
const BASE_URL = `http://localhost:${PORT}`;
const EXAMPLES_DIR = path.join(ROOT, 'examples');
const SERVE_JS = path.join(ROOT, 'dist', 'src', 'presentation', 'http', 'serve.js');
const STORAGE_JS = path.join(ROOT, 'dist', 'src', 'infrastructure', 'storage.js');
/** 独立前端仓的地址（本仓不产前端；设了才打开） */
const FRONTEND_URL = (process.env.AGENT_IO_FRONTEND_URL || '').trim();

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', cwd, shell: process.platform === 'win32' });
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
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

/** 前端在哪 —— **本仓没有页面**，如实给出独立仓的位置与接法 */
function frontendHint() {
  const sibling = path.resolve(ROOT, '..', 'dsl-workbench');
  const lines = [
    '  ★ 本仓是数据/协议层：serve 只提供 API，**不渲染任何页面**（旧 /workbench 已撤，实测 404）。',
    '    可视化前端在**独立仓库** dsl-workbench ——',
  ];
  if (fs.existsSync(path.join(sibling, 'package.json'))) {
    lines.push(`    本地已存在：${sibling}`);
    lines.push(`      cd ${sibling} && npm install && npm run dev`);
  } else {
    lines.push('      git clone https://github.com/xr192172/dsl-workbench');
    lines.push(`      cd dsl-workbench && npm install && npm run dev`);
  }
  return lines.join('\n');
}

/** 把 examples/ 下所有示例 DSL 存成 feature（走真实存储入口 saveDSL） */
async function prepareExamples() {
  if (!fs.existsSync(SERVE_JS)) {
    console.log('[demo] dist 不存在，先 npm run build …');
    await run('npm', ['run', 'build'], ROOT);
  }

  // ★ 落盘路径**不自己拼**：`.agent-io/features` 由 storage 决定（dataHome 可被 AGENT_IO_HOME 覆盖）
  //   —— 自己拼一份就是"同一判据住两处"，迟早与实现分叉。
  const { saveDSL, getFeatureFile } = await import(pathToFileURL(STORAGE_JS).href);
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.log('[demo] examples/ 目录不存在，无示例可渲染');
    return [];
  }

  const rendered = [];
  const files = fs.readdirSync(EXAMPLES_DIR).filter((n) => n.endsWith('.json')).sort();
  if (files.length === 0) {
    console.log('[demo] examples/ 下没有 .json 示例');
    return [];
  }

  for (const f of files) {
    let dsl;
    let feature;
    try {
      dsl = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, f), 'utf-8'));
      feature = dsl.feature;
    } catch (e) {
      console.warn(`[demo] 跳过 ${f}（解析失败：${e.message}）`);
      continue;
    }
    if (!feature) {
      console.warn(`[demo] 跳过 ${f}（缺少 feature 字段）`);
      continue;
    }
    // getFeatureFile 会顺带校验 feature 名合法性（非法名直接抛，比"写歪了才炸"早）
    const featureFile = getFeatureFile(feature);
    if (fs.existsSync(featureFile)) {
      console.log(`[demo] 跳过 ${feature}（已存在同名 feature，不覆盖用户数据）`);
      continue;
    }
    try {
      const written = saveDSL(dsl, 'demo');
      rendered.push(feature);
      console.log(`[demo] ✓ 示例 ${feature} 已落盘 → ${written}`);
    } catch (e) {
      console.warn(`[demo] ✗ 落盘 ${feature} 失败：${e.message}`);
    }
  }
  return rendered;
}

async function main() {
  console.log(`\n[demo] agent-io 黄金演示路径（端口 ${PORT}）\n`);
  const rendered = await prepareExamples();

  if (PREPARE_ONLY) {
    console.log(`\n[demo] 准备完成：已就绪 ${rendered.length} 个示例 feature。`);
    console.log('[demo] 执行 npm run demo 可启动数据/API 引擎。\n');
    return;
  }

  // 端口已有服务？直接复用
  if (await waitReady(BASE_URL, 1200)) {
    console.log(`[demo] 端口 ${PORT} 已有服务在跑，直接复用 ${BASE_URL}`);
    if (OPEN_FRONTEND && FRONTEND_URL) openBrowser(FRONTEND_URL);
    return;
  }

  console.log(`[demo] 启动数据/API 引擎（端口 ${PORT}）… Ctrl+C 停止`);
  const server = spawn(process.execPath, [SERVE_JS, String(PORT)], { stdio: 'inherit', cwd: ROOT });
  server.on('close', (code) => process.exit(code ?? 0));

  if (await waitReady(BASE_URL, 15000)) {
    console.log(`[demo] 已就绪：${BASE_URL}（feature：${rendered.join(', ') || '无'}）`);
    if (OPEN_FRONTEND && FRONTEND_URL) {
      console.log(`[demo] 打开前端 ${FRONTEND_URL}`);
      openBrowser(FRONTEND_URL);
    }
    console.log(`
────────────────────────────────────────────────────────────
${frontendHint()}

  下一步（10 分钟闭环）：在 MCP client（Claude/Cursor）里
  让 LLM 调用 edit_dsl 改这张图 → 前端画布会自动刷新。
────────────────────────────────────────────────────────────`);
  } else {
    console.error('[demo] 服务启动超时，请查看上方日志排查');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[demo]', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
