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

/** 包装一个同步/异步纯函数调用为 handler（统一 try/catch；陈旧构建警告由 registerAllTools 统一注入，避免重复） */
export function wrap(
  fn: (args: Record<string, unknown>) => { message: string; data?: unknown } | Promise<{ message: string; data?: unknown }>,
): ToolDef['handler'] {
  return async (args) => {
    try {
      const r = await fn(args);
      return { text: r.message };
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
      if (r.data !== undefined) {
        parts.push('---DATA---');
        parts.push(JSON.stringify(r.data));
      }
      return { text: parts.join('\n') };
    } catch (e) {
      return { text: (e as Error).message, isError: true };
    }
  };
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
