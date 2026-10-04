/**
 * registry/plumbing.ts —— 工具 handler 的统一包装
 *
 * ★ P1a（2026-09-28）：从 `server_registry.ts`（3,586 行）抽出的**基础设施**。
 *   textOut / wrap / wrapData 三个包装器 + looseInputSchema（未知键保留，供参数纠错）。
 *
 * 为什么必须先抽这一层（而不是直接按 lane 切 TOOL_DEFS）：
 *   lane 文件要用到这里的东西，而它们原先都定义在 `server_registry.ts` 内部 ⇒
 *   lane 一 import 就成环（server_registry → lanes → server_registry）。
 *   拆出本模块后，lane 文件可以单向依赖它。
 */
import { z } from 'zod';
import type { ToolDef } from './types.js';

/** MCP content 输出 */
export function textOut(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

/**
 * 合成 [B] 产物的**机器可读载荷**（含 `touched` 小票）。
 *
 * ★★ 为什么两个包装器都必须走这里（2026-10-05，**实测的真缺陷**，不是风格问题）：
 *   `Touched`（"本次动了什么"）是**跨 [B] 的统一契约**（`domain/b_terms.ts`），但它挂在 [B] 产物的**顶层**；
 *   而 `wrap` 只回 `message`、`wrapData` 只序列化 `r.data` ⇒ 产物顶层的 `touched` 会在 **[C] 层静默丢掉**。
 *   **实测**：`detect_drift` / `edit_dsl` 用裸 `wrap` ⇒ 子代理刚给它们的 [B] 接上的 `touched`
 *   **压根没出现在输出里**（同一批里用 `wrapData` + `data: r` 的工具则正常）。
 *   ⇒ 处置：**在两个出口处统一合成**（结构保证）——**不是**"要求每个 handler 记得 `data: r`"（那是自觉）。
 *
 * 规则（可预测、不改既有形状）：
 *   - 无 `data` 且无 `touched` ⇒ `undefined`（包装器退回"只回 message"，`wrap` 语义不变）。
 *   - 有 `data`、无 `touched` ⇒ **原样返回 `r.data`**（既有 DATA 形状逐字不变）。
 *   - 有 `touched` + `data` 是**普通对象** ⇒ `{...data, touched}`（**加法**，不动既有键）。
 *   - 有 `touched` + 其它（`data` 为数组/标量/缺失）⇒ `{data, touched}`（`JSON.stringify` 会丢掉
 *     值为 `undefined` 的键 ⇒ 于是自然退化成 `{"touched":…}`）。
 */
function machinePayload(r: { data?: unknown; touched?: unknown }): unknown {
  const hasTouched = r.touched !== undefined;
  if (r.data === undefined) return hasTouched ? { touched: r.touched } : undefined;
  if (!hasTouched) return r.data;
  const isPlainObject = typeof r.data === 'object' && r.data !== null && !Array.isArray(r.data);
  return isPlainObject
    ? { ...(r.data as Record<string, unknown>), touched: r.touched }
    : { data: r.data, touched: r.touched };
}

/** 包装一个同步/异步纯函数调用为 handler（统一 try/catch；陈旧构建警告由 registerAllTools 统一注入，避免重复） */
export function wrap(
  fn: (args: Record<string, unknown>) => { message: string; data?: unknown } | Promise<{ message: string; data?: unknown }>,
): ToolDef['handler'] {
  return async (args) => {
    try {
      const r = await fn(args);
      // ★ 产物带 `touched` 时**必须**让它出现在机器通道里（否则契约在 [C] 层静默丢失，见 machinePayload 头注）。
      const payload = machinePayload(r as { data?: unknown; touched?: unknown });
      if (payload === undefined) return { text: r.message };
      return { text: [r.message, '---DATA---', JSON.stringify(payload)].join('\n') };
    } catch (e) {
      return { text: (e as Error).message, isError: true };
    }
  };
}

/** 同 wrap，但 data 一并序列化进文本（---DATA--- 分隔），避免只回显 message 导致静默丢数据 */
export function wrapData(
  fn: (args: Record<string, unknown>) => { message: string; data?: unknown } | Promise<{ message: string; data?: unknown }>,
): ToolDef['handler'] {
  return async (args) => {
    try {
      const r = await fn(args);
      const parts: string[] = [];
      if (r.message) parts.push(r.message);
      const payload = machinePayload(r as { data?: unknown; touched?: unknown });
      if (payload !== undefined) {
        parts.push('---DATA---');
        parts.push(JSON.stringify(payload));
      }
      return { text: parts.join('\n') };
    } catch (e) {
      return { text: (e as Error).message, isError: true };
    }
  };
}

// ─────────────────────────────────────────────────────────────
// [C] 层入参守卫
// ─────────────────────────────────────────────────────────────

/**
 * 缺必填字符串 ⇒ **当场报错**（绝不把 `undefined` 拼进路径 —— 规划书 §16.4 P-D）。
 *
 * ★ 2026-09-29（面收敛第二批）从 `lanes/refactor.ts` 的**文件内私有**函数上提到本模块：
 *   `lanes/harvest.ts` 的新入口 `bricks` 也要用同一把守卫，留在原地就会长出**第二份副本**
 *   —— 那正是 G4（`tests/single_source.test.ts` 同族副本棘轮）要消灭的东西。
 *   ⇒ 上提到**跨 lane 共用的基础设施**（本文件与 `types.ts` / `handlers.ts` 同层）。
 *   ★ 未收编的第三份：`src/application/meta/explore/explore_code.ts` 里有一个同名私有实现 —— 它在 `[B]` 层，
 *     不在本笔（只改 `src/registry/**`）的边界内，**登记但不改**（见 commit message「没验什么」）。
 */
export function requireStr(a: Record<string, unknown>, key: string): string {
  const v = a[key];
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`缺参数 "${key}"`);
  return v;
}

/**
 * 缺必填**数组**参数 ⇒ **当场报错**（同 `requireStr` 的 P-D 纪律，只是这里守的是"是数组"）。
 *
 * ★ 2026-10-05：与 `requireStr` 同一个洞的另一半 —— `rename_symbols` / `rename_files` /
 *   `harvest_closure` 等直接 `a.renames.map(...)` / `a.files.map(...)`，缺参时抛的是
 *   `Cannot read properties of undefined (reading 'map')`（Node 原始异常，用户看不懂）。
 *   `hint` 用来在报错里给出该字段的**形状**（例：`[{file, symbol, to}]`），比只报名字有用。
 */
export function requireArr(a: Record<string, unknown>, key: string, hint: string): unknown[] {
  const v = a[key];
  if (!Array.isArray(v)) throw new Error(`缺参数 "${key}"：${hint}`);
  return v;
}

// ─────────────────────────────────────────────────────────────
// 输入 schema 包装
// ─────────────────────────────────────────────────────────────

/**
 * 输入 schema 用 **loose object**：保留未知键，好让参数纠错（Did you mean）能看见写错的键。
 *
 * 为什么必须这样：SDK 会把 raw shape 包成**严格 object**（zod 4 mini / zod 3），
 * 而严格 object 解析时**静默丢弃**未知键 —— 参数写错就变成"结果莫名其妙"，
 * 参数纠错代码永远看不到那个错键（实测：不改这里，提示不出现）。
 * zod v4 → `z.looseObject`；zod v3 → `.passthrough()` 回退。
 */
export function looseInputSchema(shape: Record<string, unknown>): unknown {
  const anyZ = z as unknown as { looseObject?: (s: Record<string, unknown>) => unknown };
  if (typeof anyZ.looseObject === 'function') return anyZ.looseObject(shape);
  return (z.object(shape as never) as unknown as { passthrough: () => unknown }).passthrough();
}
