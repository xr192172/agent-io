/**
 * ast_node —— TS/JS 家族的**最小 tree-sitter 节点面** + 小工具（模块作用域解析与
 * AST 改名的共用底座）。
 *
 * ★ 为什么住在 infrastructure/parse（2026-10-04，T26）：
 *   这些原语原先定义在 `application/refactor/rename_symbol/parts.ts`。而模块级作用域解析
 *   `analyzeModuleSource`（现 `module_analysis.ts`）**必须下沉到 infrastructure**（`cross/` 曾
 *   反向依赖 `refactor` 特性内部的 typescript 语言包 ⇒ 层次倒挂 + 双向 value 环）。
 *   若它继续从 `parts.ts` 取这些原语，就会把 `infrastructure → application` 的**回边**新造出来
 *   —— 用一条新违规换掉一条旧环，方向反了。
 *   ⇒ 原语下沉到本文件（infrastructure），`parts.ts` 改为**向下复用**（import + 再导出）。
 *   同一份知识仍只此一处落点（不是复制两份）。
 */

import { TS_JS_EXTS } from './source_exts.js';

/** 最小 tree-sitter 节点面（同 Kernel 的 `SyntaxNodeLike`，但 startIndex/endIndex 必填：本仓调用方都按数值用） */
export interface N {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(i: number): N | null;
  childForFieldName(f: string): N | null;
}

/** 值/类型引用区分 */
export type NodeType = 'value' | 'type';

/** TS/JS 家族扩展名 —— 派生自内核唯一权威（`source_exts.ts` 的 `TS_JS_EXTS`） */
export const TS_EXTS: Set<string> = new Set<string>(TS_JS_EXTS);

/** 去引号（跨语言共用的小工具） */
export function stripQuotes(s: string): string {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('`') && s.endsWith('`'))) return s.slice(1, -1);
  return s;
}

/** 结合符（field 'name'，兜底首 identifier）返回 { text, offset } 或无 */
export function nameInfo(n: N): { text: string; offset: number } | null {
  const dir = n.childForFieldName('name');
  if (dir && (dir.type === 'identifier' || dir.type === 'type_identifier' || dir.type === 'property_identifier')) return { text: dir.text, offset: dir.startIndex };
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c && (c.type === 'identifier' || c.type === 'type_identifier')) return { text: c.text, offset: c.startIndex };
  }
  return null;
}
