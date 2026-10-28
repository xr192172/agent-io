/**
 * ★★★ 2026-10-28（T-#OBSERVE-8 剩项 · 用户："继续"）：**探针侧依赖闭包** —— 决定"哪些文件绝不能插桩"。
 *
 * ## 为什么需要它（一次**静默自伤**换来的）
 * 为了能「观测我们自己的 dist」，曾把排除口径从**整个 dist** 收窄成**只排 `observe/` 目录**。
 * 结果：**进程没有任何输出、exit code 0**（最难查的那类失败）。
 *
 * 真凶不是探针本体（`probe.js` 只 import node 内置），而是**插桩器自己**：
 * `instrument.js` 依赖 `ts_kernel`（大量 dist 模块），而它**跑在 loader 的 hooks 线程里** ——
 * 那些模块一旦被插桩，注入的 `import { captureProbe } from './probe.js'` 就在
 * "正在加载依赖的 hooks 线程"里再触发加载 ⇒ **循环** ⇒ 静默死掉。
 *
 * ⇒ 正确口径：排除的是「**探针可达的整个 import 闭包**」（probe 闭包 + 插桩器闭包 + 胶水层），
 *   而不是"某个目录"。这样 **其余 dist 代码可以安全插桩**，观测面从 `certs/` 扩到整个 `src/`。
 *
 * ## 不变式（证 `t418` 会验）
 * 对闭包里每个文件，它的**相对 import 目标也必在闭包内** —— 即闭包对 import **封闭**。
 * 不封闭就会出现"被插桩的模块 → 探针 → 被插桩的模块"的环。
 *
 * ★ 零依赖（只 node 内置）：它要能在 hooks 线程里被安全调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 闭包种子：探针本体 + 插桩器 + loader/hooks 胶水 */
const SEEDS = ['probe.js', 'run_sentinel.js', 'instrument.js', 'instrument_skeleton.js', 'probe_hooks.js', 'probe_loader.js', 'run_env.js'];

const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"();]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

/** 把相对说明符解析成实际文件（`.js` / `/index.js` 两种兜底） */
function resolveRel(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
      /* 继续试下一个 */
    }
  }
  return null;
}

/** 从一个文件出发，静态扫描它的相对 import（只扫 dist 的 .js，够用且快） */
function importsOf(file: string): string[] {
  let src: string;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const re of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const r = resolveRel(file, m[1]);
      if (r) out.add(r);
    }
  }
  return [...out];
}

let cached: string[] | null = null;

/**
 * 探针侧依赖闭包（绝对路径列表，已排序）。
 * ★ 含**种子自身** —— 它们也绝不能被插桩。
 */
export function probeClosure(dir: string = path.dirname(fileURLToPath(import.meta.url))): string[] {
  if (cached) return cached;
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const s of SEEDS) {
    const p = path.join(dir, s);
    if (fs.existsSync(p)) queue.push(p);
  }
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const dep of importsOf(f)) if (!seen.has(dep)) queue.push(dep);
  }
  cached = [...seen].sort();
  return cached;
}

/** 供自测：清掉缓存 */
export function resetProbeClosureCache(): void {
  cached = null;
}
