/**
 * design_db_projection.ts —— **实际 DB（`cache.db` 的 `nodes`）→ 设计 DB（`symbols[]`）的唯一投影表**。
 *
 * ## 为什么要有这张表（2026-10-28 挖到的漂移）
 * `gen_design_db` 的头注释一直写着「与实际 DB **同构**」，但实测：
 *   实际侧 `nodes` 有 **21 列**，设计侧 `symbols[]` 只带 **5 键**（name/kind/line/signature/members）。
 * 缺的包括 `start_line/end_line`（区间）、`params`、`return_type`、`type_params`、`modifiers`、
 * `qualified_name`、`parent`、`is_closure`、`docstring`，以及 **`sym_hash` / `body_hash`**。
 * `sym_hash` 早在 2026-09-30 就在实际侧了，而设计侧 2026-10-24 还在改别的（`expected_symbols`）——
 * **升级了实际侧、忘了同步设计侧** ⇒ 「同构」这句话从判据退化成了散文（写着、没有执行者）。
 *
 * ## 本文件的判据（一句话）
 * **每一列要么被投影（`key`），要么显式声明不投影（`why`）—— 不许有第三种（沉默）。**
 * ⇒ 新证 `t378` 拿这张表当判据：设计侧文件的键集必须**逐字等于** `projectedSymbolKeys()`；
 *   每一列都有交代；`why` 不许为空。
 *
 * ## 边界（诚实标注）
 * · 本表只管**符号级**（`nodes` 表）。`imports` / `calls` / `expected_symbols` 各有自己的取法，不在这里；
 * · 不投影的列**不是不重要**，而是"重写不需要"或"会误导"——每条都写了理由，别拿"没写就当没有"。
 */

/** 一列的交代：被投影到哪个键，或者为什么不投影 */
export interface ColumnDisposition {
  /** `cache.db` 表 `nodes` 的列名 */
  column: string;
  /** 投影到设计侧的键名（不给 = 不投影，此时 `why` 必填） */
  key?: string;
  /** 不投影的理由（`key` 缺省时必填） */
  why?: string;
}

/**
 * `nodes` 的 **21 列**逐列交代（顺序 = DDL 顺序，便于与 `PRAGMA table_info` 对账）。
 * ★ 加列时必须来这里表态：`t378` 第二条判据就是"实际表里每一列都在这张表里有交代"。
 */
export const SYMBOL_COLUMN_MAP: readonly ColumnDisposition[] = [
  { column: 'id', why: '内部主键，跨机器不稳定；锚点用 `path + name`（同 `t332` 的教训：别把内部 id 写进计划）' },
  { column: 'kind', key: 'kind' },
  { column: 'name', key: 'name' },
  { column: 'qualified_name', key: 'qualified_name' },
  { column: 'file_path', why: '★ 已由外层 `path` 承载（一份投影就是一个路径），逐符号再带一遍 = 复制事实' },
  { column: 'language', why: '★ 整份投影同一语言（看 `path` 后缀即得）；逐符号带 = 21 份同样的字符串' },
  // ★ 键名保持 `line`：`gen_design_db` 的搬家纪律写着「输出必须逐字相同」，改名会打断既有消费者
  { column: 'start_line', key: 'line' },
  { column: 'end_line', key: 'end_line' },
  { column: 'parent', key: 'parent' },
  { column: 'signature', key: 'signature' },
  { column: 'docstring', key: 'docstring' },
  { column: 'members', key: 'members' },
  { column: 'params', key: 'params' },
  { column: 'return_type', key: 'return_type' },
  { column: 'type_params', key: 'type_params' },
  { column: 'modifiers', key: 'modifiers' },
  { column: 'body_text', why: '整段正文：重写不需要它（要改的是意图），且体积随格式化抖动 ⇒ 投影进来只会让 diff 噪声淹没真改动' },
  { column: 'body_hash', key: 'body_hash' },
  { column: 'sym_hash', key: 'sym_hash' },
  { column: 'is_closure', key: 'is_closure' },
  { column: 'updated_at', why: '索引内部时间戳（每次重扫就变）⇒ 不是代码事实，投影进来会让"这份投影有没有变"永远为真' },
];

/** 设计侧 `symbols[]` **应有**的键集（`t378` ① 的判据；也是调用方唯一该信的那一份） */
export function projectedSymbolKeys(): string[] {
  return SYMBOL_COLUMN_MAP.filter((d) => d.key).map((d) => d.key!) as string[];
}

/** 由映射表**派生**的 SELECT（★ 只此一处拼 SQL —— 手写列名是漂移的入口） */
export function symbolSelectSql(): string {
  const cols = SYMBOL_COLUMN_MAP.map((d) => d.column).join(', ');
  return (
    `SELECT ${cols} FROM nodes WHERE file_path = ? AND parent IS NULL AND kind != 'file' ` +
    'ORDER BY start_line'
  );
}

/** 一行 `nodes` → 一个设计侧符号对象（只带投影列；JSON 字符串字段还原成数组/对象） */
export function projectSymbolRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of SYMBOL_COLUMN_MAP) {
    if (!d.key) continue;
    const v = row[d.column];
    if (v === null || v === undefined) continue; // 空就不写（与既有格式一致：空字段不落盘）
    // `members` / `params` / `type_params` / `modifiers` 在库里是 JSON 字符串
    if (d.column === 'members' || d.column === 'params' || d.column === 'type_params' || d.column === 'modifiers') {
      try {
        out[d.key] = JSON.parse(String(v));
      } catch {
        out[d.key] = v;
      }
      continue;
    }
    out[d.key] = v;
  }
  return out;
}
