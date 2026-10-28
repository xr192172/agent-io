/**
 * Observe 多语言契约 · TypeScript 接入试点
 *
 * 统一导出 TS 探针端口（ProbeCapture）与判定哨兵（Comparator），作为
 * 「跨语言契约」的 TS 侧第一落点。验证路径：
 *
 *   TS 探针埋点 emit → events.jsonl ─┐
 *                                      ├→ TS 哨兵 Comparator 判定（本包）
 *   dsl.json（权威真相源，Go 定稿）──┘
 *
 * 同一份 events.jsonl + dsl.json 也可喂给 Go 装配层（observe-dsl actual/diff/loop）
 * 判定——这正是「语言无关契约」要证明的：判定逻辑不绑定探针语言。
 */

export { TSProbeCapture, loadTSEvents } from './probe.js';
export { setGlobalProbeSink, captureProbe } from './probe.js';
export type { TSEvent, ExtraFields } from './probe.js';
export { TSComparator, renderTSDiffReport } from './contract.js';
export type {
  TSDLDecl,
  TSDesignDSLDoc,
  TSDeviation,
  DeviationKind,
  TSDiffReport,
  TSProbeObs,
} from './contract.js';
export { enableObserveFromEnv } from './run_sentinel.js';

// ★★★ 2026-10-28（T-#DOMAIN-4）：**把跨域实际用到的符号收进公开入口** ——
//   此前 `application/observe/reconcile/*` 直接摸内部实现文件（封装问题，读数记在 docs/todo.md）。
//   这里只补**真有跨域使用者**的符号，不做 `export *`（那等于取消封装）。
export { approveGated } from './approve_gated.js';
export type { ApproveResult } from './approve_gated.js';
export { defaultDSLDir, DesignDSLStore } from './dsl_store.js';
export { ProposalStore } from './proposal_store.js';
export type { Proposal } from './proposal_store.js';
export { queryObserveLog } from './log_query.js';
export { judgeEvent } from './judge.js';
export { rebuildChains, matchChainDecl } from './chain.js';
export type { TSChainObs } from './chain.js';
// ★ 2026-09-28 剪枝：原先此处再导出 v2 分级采集 runtime（`tiered` / `trace` / `export_incident`，
//   共 704 行）—— 它们是"对齐 Go 语言包的 TS 侧移植"，但**从未接线**：
//   全仓（含测试）没有任何真实消费者，只有本 barrel 再导出。
//   Go 侧（`observe-lang-go/probe/tiered.go` 等）仍在用，死的是这份 TS 移植。
//   口径：可达闭包（本仓已有机器判据）之外 ⇒ 剪；需要时 git 里还在。
//   同批剪掉 `online_loader/`（4 个 .mjs，263 行，零引用）。