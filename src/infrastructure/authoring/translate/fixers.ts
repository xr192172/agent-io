/**
 * fixers —— C1 内建 deterministic fixer（翻译产物后处理通道）
 *
 * 背景：实测对整仓翻译产物，用户靠 40 个手写 `fix_*.cjs`（const→let、去未用 import、
 * 合 import、转义等）层层叠加才压过编译——"改错→打补丁→再改错"失控。
 * C1 目标是把这些**可机械判定的高频错**内建于翻译器、幂等地一次修完，
 * 而不是等人在产物上叠脚本。
 *
 * 原则：只做确定性、可证明、幂等的改写（不动语义）；改不动就保持原样。
 * 与 verify 闸的关系：fixer 在"组装/落盘"前跑，产出更干净的模块；verify 仍负责拦截坏产物。
 */

/**
 * 去除未使用的 import：对每个 `import { A, B } from 'm'`，A/B 只要不在"非 import 体"
 * 中出现就删；整条全删为空则移除该行。别名 `A as AA` 按本地名 AA 判断使用，重建时保留原说明符。
 * 幂等（第二次跑无变化）。
 */
export function fixUnusedImports(source: string): string {
  const lines = source.split('\n');
  // 去 import 头后的"正文" → 用名字集合
  const body = lines.filter((l) => !/^\s*import\s*\{/.test(l)).join('\n');
  const re = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/;
  const out: string[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const specifiers = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const localOf = (spec: string): string => (/\s+as\s+([\w$]+)$/.exec(spec) ?? [])[1] ?? spec.replace(/[^\w$]/g, '');
    const kept = specifiers.filter((s) => new RegExp(`\\b${localOf(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body));
    if (kept.length === 0) continue; // 整条 import 全未用 → 移除
    out.push(`import { ${kept.join(', ')} } from '${m[2]}';`);
  }
  return out.join('\n');
}

/**
 * 合并同源 import（去重 + 排序名字）：`import { A } from 'm'; import { B } from 'm';`
 * → `import { A, B } from 'm';`。幂等。
 */
export function squashImports(source: string): string {
  const bySource = new Map<string, string[]>();
  const other: string[] = [];
  for (const line of source.split('\n')) {
    const m = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?$/.exec(line);
    if (m) {
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      const existing = bySource.get(m[2]) ?? [];
      bySource.set(m[2], [...existing, ...names]);
    } else {
      other.push(line);
    }
  }
  const importLines: string[] = [];
  for (const [src, names] of bySource) {
    importLines.push(`import { ${[...new Set(names)].sort().join(', ')} } from '${src}';`);
  }
  // import 头放在最前，随后是其它行
  return [...importLines, ...other].join('\n');
}


/**
 * ★★★ 2026-10-29（**T-#SHADOW** · 画布已申报，判据 `decision:file_src_..._project_ts#0`）：
 * **本仓导出名遮蔽目标语言内置全局**。
 *
 * 实测一处就制造 **TS2555 ×122**：
 * ```ts
 * import { Error } from './logging/logging';   // 用户项目导出 Error
 * throw new Error('TODO(translate): …');       // ⇒ Expected at least 2 arguments, but got 1
 * ```
 * 因为本地 `Error` **遮蔽了 JS 内置 Error**，我们生成的每个 `new Error(单参)` 都变非法。
 *
 * ## 为什么只改 import（而不是"全局改名"）
 * 「把所有自由 `Error` 改名」**必然错**：`new Error(TODO)` 里那个指的就是 **JS 全局**
 * —— 同名两义，全局改名会把对的也改坏（实测 122 → 122，一个没少）。
 * ⇒ 只在 **import 说明符**上加别名（`Error as Error$go`），让 `Error` 恢复指向内置全局。
 *
 * ## 已知残留（[未核]）
 * body 里若把 `logging.Error(...)` 写成**裸 `Error(...)`**，别名后会静默命中 JS 全局。
 * 方向是安全侧：多参调用会触发 tsc 报错（不静默）；单参调用语义略有偏差。
 * 彻底解法见 todo `T-#SHADOW-USES`（把体里的限定引用一并改写）。
 */
const TS_BUILTIN_GLOBALS = new Set([
  'Error', 'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'String', 'Number', 'Boolean',
  'Date', 'JSON', 'Math', 'Promise', 'Symbol', 'RegExp', 'Function', 'BigInt', 'Proxy', 'Reflect',
  'Infinity', 'NaN', 'undefined', 'globalThis', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'console', 'process', 'Buffer', 'structuredClone',
]);

export function aliasBuiltinShadowing(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    // 只处理"具名 import 且无 type 前缀"的行（文本形状本身就是答案：import 语法只有这几种写法）
    const m = /^import\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])\s*;?$/.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const names = m[1]
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (TS_BUILTIN_GLOBALS.has(x) ? `${x} as ${x}$go` : x));
    out.push(`import { ${names.join(', ')} } from ${m[2]};`);
  }
  return out.join('\n');
}

/** 组合所有确定性 fixer（保持原有顺序；幂等） */
export function applyDeterministicFixers(source: string): string {
  return fixUnusedImports(aliasBuiltinShadowing(squashImports(source)));
}