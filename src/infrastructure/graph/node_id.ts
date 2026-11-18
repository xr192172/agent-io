/**
 * node_id —— **扫描产出的节点 id 的唯一派生点**（`file_*` / `dir_*` / `doc_*` 三种前缀全在这里）。
 *
 * ## 它治哪个洞（T-#A8A9-CROSS-BOOK 批 0.3）
 * 改前这套派生式是 `import_project.ts` 里**闭包内的三个 const**（`sanitize` / `fileNodeId` / `dirNodeId`），
 * **没有导出** ⇒ 任何"想造一个 `file_*` id"的地方只能**自己抄一份**，于是实测长出了 **4 种派生式**：
 *
 * | 派生式 | 样本 | 谁 |
 * |---|---|---|
 * | `file_` + sanitize(rel)（`-` 保留） | `file_observe-lang-go_cmd_instrument_main_go` | `agent-io`（现行式） |
 * | 同上但 `-`→`_` | `file_observe_lang_go_cmd_instrument_main_go` | `task-system-plan` 的存量（老一代 sanitize） |
 * | 去 `src/` 前缀 | `file_application_observe_reconcile_proposal_approve_ts` | `task-system-plan` 的存量（老扫描根） |
 * | 只取 basename | `file_capability_map_ts` / `file_tool_faces_ts` | `agent-io-toolface`（**手写**节点） |
 *
 * ⇒ 同一个文件在两册里可以有**两个 id**（实测 31 个节点的 id ≠ 它 path 的派生式）⇒ `decision:<node_id>#i`
 *   这种"按名字猜"的引用在两册之间**判不了**（`T-#JUDGEMENT-REF-CROSS-BOOK` 的根因之一）。
 *
 * ## 纪律（加前缀必须同时做三件事）
 * ① 加进 {@link SCANNED_ID_PREFIXES}；② 生成它的那行写 `★ 前缀登记在 SCANNED_ID_PREFIXES`；
 * ③ 走本文件导出的函数造 id —— **不许**再在调用点写 `` `file_${…}` ``（那正是本文件存在的原因）。
 *
 * ★ 口径**逐字**沿用改前的实现（`s.replace(/[^a-zA-Z0-9_-]/g,'_')`）：`-` 与 `_` 都是合法字符。
 *   改它 = 改全仓节点 id ⇒ 那是迁移，不是重构（本卡不做：存量 id 一个都不动，见 §4 untouched）。
 */

/** 前缀登记表 —— 与 `import_project.ts#SCANNED_ID_PREFIXES` 同一份（该处改为从这里 import） */
export const SCANNED_ID_PREFIXES = ['file_', 'dir_', 'doc_'] as const;

/** 路径 → id 片段（★ 保留 `-`：`file_observe-lang-go_…` 是**现行**式，改它会改全仓 id） */
export function nodeIdSanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 文件节点 id：`file_<sanitized rel>` */
export function fileNodeId(rel: string): string {
  return `file_${nodeIdSanitize(rel)}`;
}

/** 目录容器节点 id：`dir_<sanitized rel>` */
export function dirNodeId(rel: string): string {
  return `dir_${nodeIdSanitize(rel)}`;
}

/** 文档节点 id：`doc_<sanitized rel>` */
export function docNodeId(rel: string): string {
  return `doc_${nodeIdSanitize(rel)}`;
}

/** 节点种类（与 {@link SCANNED_ID_PREFIXES} 一一对应） */
export type ScannedNodeKind = 'file' | 'dir' | 'doc';

/**
 * **唯一派生入口**：`nodeIdOf('src/a.ts')` ⇒ `file_src_a_ts`。
 *
 * ★ 新增节点（`edit_dsl file add` / 扫描 / 导入）**必须**用它造 id —— 手写 `file_<basename>_ts`
 *   会让同一个文件在两册里得到不同 id，而那正是批 0 要止住的东西。
 * ★ 存量节点**不重命名**（那会断 `judgement_ref` / `plans` / `write_log` 的既有引用）：
 *   分辨存量/新增的办法是"写前那一册里有没有这个 id"，不是"id 看起来对不对"（见 `design_books#assessWriteEnd`）。
 *
 * ★★ 2026-11-18（T-#A8A9-CROSS-BOOK 批 15）：**上面那张"4 种派生式"的表现在已经清空**——
 *   存量 10 个异 id 全部收口（3 个随节点搬进属主册 / 删除而消失、7 个按本文件的派生式**改名**，
 *   其中 6 个就是下面 `file_capability_map_ts` 那一代手写式）。改名前置是"旧 id 上 0 条
 *   `judgement_ref` / `plans` / `live_cards` / `write_log` 引用"（批 15 交付书 §2 逐条核过）。
 *   ⇒ 现在全仓 `id === nodeIdOf(path)`，本文件是**唯一**一种派生式；新增节点仍由写端强制。
 */
export function nodeIdOf(rel: string, kind: ScannedNodeKind = 'file'): string {
  switch (kind) {
    case 'file':
      return fileNodeId(rel);
    case 'dir':
      return dirNodeId(rel);
    case 'doc':
      return docNodeId(rel);
  }
}

/** `id` 是不是**本次扫描产得出的**（`SCANNED_ID_PREFIXES` 的唯读者） */
export function isScannedNodeId(id: string): boolean {
  return SCANNED_ID_PREFIXES.some((p) => id.startsWith(p));
}
