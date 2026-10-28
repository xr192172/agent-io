/**
 * ★★★ 2026-10-28（T-#OBSERVE-6 · 用户定位："开发管理器 + 实验室，遵规范就没有外部"）：
 * **内存插桩的 hooks 线程实现**（`probe_loader` 注册它）。
 *
 * ## 它做什么
 * 在模块**加载时**把源码交给 `instrumentFile({ write:false })` 改写 —— **盘上一个字节都不动**，
 * 然后把改写后的文本交给引擎执行。⇒ 「零污染插桩」。
 *
 * ## 为什么在 hooks 线程里做也行（实测过）
 * 尖探验证：hooks 线程能 import 我们的 dist 并跑 tree-sitter 插桩（夹具注入 3 个探针、程序行为不变）。
 * ★ 但必须**失败即放行**：任何异常（解析失败 / 不支持的语言 / 语法怪）⇒ 原样返回，
 *   **绝不因为观测而导致用户代码跑不起来**。
 *
 * ## 覆盖范围（诚实边界，v1）
 * · 只处理 **`.js` / `.mjs` / `.cjs`**（本仓 128 张证全是 `.mjs`，够"框架内部自洽"用）；
 *   **`.ts` 不处理** —— 那需要宿主 transpiler（tsx/ts-node）配合，属另一步。
 * · 跳过 `node_modules`、以及**框架自己的 dist**（否则会插桩探针自身 → 递归）。
 * · 按 `(路径 + mtime + size)` 缓存改写结果，避免同一文件多次解析。
 *
 * ## env 契约（由启动方注入，见 `behavior` harness / `run_tests`）
 * · `OBSERVE_EVENTS_FILE`   事件落点（`probe_loader` 据此激活全局 sink；不设 ⇒ captureProbe 是 no-op）
 * · `AGENT_IO_PROBE_ROOT`   被观测项目根（用于 `fileRel`；缺省取文件所在目录）
 * · `AGENT_IO_PROBE_EXCLUDE` 额外排除前缀（`path.delimiter` 分隔）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const D = new URL('./', import.meta.url); // dist/.../observe/
const EXTS = new Set(['.js', '.mjs', '.cjs']);
const cache = new Map<string, { key: string; out: string | null }>();

/** 是否该处理这个 URL（只在"项目源码"里动手） */
function shouldHandle(url: string): boolean {
  if (!url.startsWith('file:')) return false;
  let p: string;
  try {
    p = fileURLToPath(url);
  } catch {
    return false;
  }
  if (!EXTS.has(path.extname(p))) return false;
  if (p.includes(`${path.sep}node_modules${path.sep}`)) return false;
  // 框架自身：dist 目录（含探针本体）与 loader 本体 —— 插桩它们只会自伤
  const selfDist = path.resolve(fileURLToPath(D), '..', '..', '..'); // dist/src/infrastructure/analysis/observe → dist/src
  if (p.startsWith(selfDist + path.sep)) return false;
  for (const ex of (process.env.AGENT_IO_PROBE_EXCLUDE ?? '').split(path.delimiter)) {
    if (ex && p.startsWith(ex)) return false;
  }
  return true;
}

export async function load(url: string, context: unknown, nextLoad: Function) {
  if (!shouldHandle(url)) return nextLoad(url, context);
  const file = fileURLToPath(url);
  try {
    const st = fs.statSync(file);
    const key = `${st.mtimeMs}:${st.size}`;
    const hit = cache.get(file);
    if (hit && hit.key === key) {
      if (!hit.out) return nextLoad(url, context);
      return { format: 'module', source: hit.out, shortCircuit: true };
    }
    const { instrumentFile } = await import(new URL('./instrument.js', D).href);
    const r = await instrumentFile(file, {
      write: false,
      projectRoot: process.env.AGENT_IO_PROBE_ROOT || path.dirname(file),
      probeImport: new URL('./probe.js', D).href,
    });
    const out = typeof r?.content === 'string' ? r.content : null;
    cache.set(file, { key, out });
    if (!out) return nextLoad(url, context);
    return { format: 'module', source: out, shortCircuit: true };
  } catch {
    // ★ 失败即放行：观测绝不能把用户代码跑挂
    return nextLoad(url, context);
  }
}
