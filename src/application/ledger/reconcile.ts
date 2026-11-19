/**
 * reconcile.ts —— T-#LEDGER-ENGINE **L2**：台账 ↔ MD 的**双向 id 对账**（纯读，不写盘）。
 *
 * ## 它回答的唯一问题
 * 「MD 里有、引擎里没有」和「引擎里有、MD 里没有」这两侧差集**各是什么**（空 = 一致）。
 *
 * ## ★★★ 三条不变量（每条都能打断即红）
 * ① **读不到 ≠ 干净**：库不存在 / 表还没建 / 项目根不可达 ⇒ `unavailable` 三态各报各的话，
 *    且 `ok=false` —— **绝不印"一致"**。
 *    （`listActive` 把三态一律按 0 行返回，那是查询的合理默认；对账器**不能**继承那个默认，
 *      否则"表还没建"会被读成"引擎一条都没有" ⇒ 假红成"MD 多出全部行"，或反过来假装干净。）
 *    ⇒ 本函数**自己**走 `openTasksDbForRead`，不经过 `listActive`。
 * ② **两侧同一个 id 宇宙**：引擎侧 = `record_kind='task'` 的活跃行（`prose`/`ruling`/`meta` 不进来 ——
 *    §F 的 key 是另一个 id 空间）；MD 侧 = importer 解析出的**首格整格 id**（不是行内引用）。
 * ③ **点名不计数**：`onlyInMd` / `onlyInEngine` 给**具体 id**，不给"差 N 条"——
 *    "计数相等即绿"的实现会让两条互换的 id 判绿。
 *
 * ## L3 之后本函数**不再是门**
 * L3 把 MD 变成派生视图后，"MD ↔ 引擎"就是拿派生物对真相（恒等）⇒ 恒绿陷阱。
 * 那时该对的是「视图 sha ↔ 引擎渲染 sha」（三态退出码），**不许复用本函数当门**。
 * 它仍是 L2 双读窗口的读数工具，以及"某条账只活在引擎里"的取证入口。
 */
import { listActive } from './ledger.js';
import { openTasksDbForRead } from '../../infrastructure/task_history.js';

/** 读不到引擎的三种原因（闭集；与 `task_history.ts#openTasksDbForRead` 的 skip 逐字一致） */
export type ReconcileUnavailable = 'unreachable' | 'no-db' | 'no-table';

export interface ReconcileResult {
  /** 双向差集皆空 ∧ 读得到 ⇒ true（**读不到时必须 false**） */
  ok: boolean;
  /** MD 有、引擎没有（点名，升序） */
  mdOnly: string[];
  /** 引擎有、MD 没有（点名，升序） */
  ledgerOnly: string[];
  /** 两侧都有的条数（**带分母**，不是判据） */
  both: number;
  mdCount: number;
  ledgerActive: number;
  /** 读不到引擎时的原因；**非空 ⇒ 本回执什么都没证明** */
  unavailable?: ReconcileUnavailable;
  /** 人读一句话（"一致" / "读不到，不是干净"）—— 不许让调用方自己猜 */
  note: string;
}

/**
 * 双向 id 对账。
 *
 * @param projectRoot 项目根（`.agent-io/tasks.db` 所在的项目）
 * @param mdIds MD 侧的业务 id 集合（由 `importer.ts#parseTodoMd` 提供 —— **不要自己 grep 正则**：
 *   本文件的 id 形态有 `T-#*` / `D-#*` / `GAP-*` / `R##` / `T###` / `G##` 六种，
 *   只认 `T-#*` 会把 §G 历史账区整片判成"引擎多出"）
 */
export function reconcileLedgerIds(projectRoot: string, mdIds: Iterable<string>): ReconcileResult {
  const mdSet = new Set<string>();
  for (const id of mdIds) {
    const v = String(id ?? '').trim();
    if (v) mdSet.add(v);
  }
  const md = [...mdSet].sort();

  const opened = openTasksDbForRead(projectRoot, 'ledger_rows');
  if ('skip' in opened) {
    return {
      ok: false,
      mdOnly: [],
      ledgerOnly: [],
      both: 0,
      mdCount: md.length,
      ledgerActive: 0,
      unavailable: opened.skip,
      note:
        opened.skip === 'unreachable'
          ? `项目根不可达（${opened.file}）⇒ 对账没做（★ 这是「读不到」，不是「对账通过」）`
          : opened.skip === 'no-db'
            ? '还没有 tasks.db ⇒ 引擎侧一条都没有（★ 这是「没有库」，不是「对账通过」）'
            : 'tasks.db 里还没有 ledger_rows 表 ⇒ 引擎侧一条都没有（★ 这是「没有表」，不是「对账通过」）',
    };
  }

  try {
    // ★ 当前性只走 listActive（内部唯一 isCurrentRow）：这里不再复制 state/superseded SQL 条件。
    //   availability 已确认库/表在场 ⇒ 这里的 0 行才是真 0，不是"读不到"。
    const engine = listActive(projectRoot, { recordKind: 'task' }).rows.map((r) => String(r.ref_id));
    const engineSet = new Set(engine);
    const mdOnly = md.filter((id) => !engineSet.has(id));
    const ledgerOnly = engine.filter((id) => !mdSet.has(id));
    const both = md.length - mdOnly.length;
    const ok = mdOnly.length === 0 && ledgerOnly.length === 0;
    return {
      ok,
      mdOnly,
      ledgerOnly,
      both,
      mdCount: md.length,
      ledgerActive: engine.length,
      note: ok
        ? `一致（MD ${md.length} · 引擎活跃 task ${engine.length}）`
        : `不一致：MD 多 ${mdOnly.length} 条 · 引擎多 ${ledgerOnly.length} 条（分母 MD ${md.length} / 引擎 ${engine.length}）`,
    };
  } finally {
    opened.db.close();
  }
}
