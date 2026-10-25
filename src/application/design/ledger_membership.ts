/**
 * ledger_membership —— 「**这个路径在设计册里吗**」的唯一查询住处（P0 保鲜链第 1 环，2026-10-26）。
 *
 * ## 解决什么
 * W0 实测（DSH agent 全量入眼审计）：edit_code op=insert 在盘上**新建**了 7 个测试文件，
 * 它们不在设计册 `semantic.files` 里 ⇒ 判据/对账（consistency_check / detect_drift / 闸覆盖）
 * **全都不会看它们一眼** —— 而这件事当时没有被任何机制报出。
 *
 * ## 行为（有意只警告、不自动入册）
 * 入册必须带 **responsibility 意图**（`file add` 的必填字段）；自动插只会造出
 * 「没有职责说明的空壳文件节点」—— 那比不入册更坏。⇒ 本模块只产出**回执警告段**，
 * 并给出一键入参示例（调用方照抄即可入册）。
 *
 * ## 判据（不另立第二把尺）
 * · 覆盖判定与写闸 `collectGateCoverage` **同款**：`path.resolve(DSL.source_root) === 项目根`；
 * · 在册判定与 `semantic.files` **同源**：`listDesignSheets()`（设计侧唯一权威）。
 * · 项目根上**没有**任何设计册指向（covering=0）⇒ 返回 null（没有册就谈不上"册外"，
 *   对着无册项目喊"未入册"是噪音 —— 这与写闸 `no-feature-for-root` 合法放行同一立场）。
 */
import path from 'node:path';
import { listDesignSheets } from '../../infrastructure/storage.js';

/** 统一路径口径（\ → /）—— 与 `nodeFilePath`（write_gate）同款，不引它（避免反向依赖应用层） */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * 新建文件**入册检查**：落盘新文件后调用。
 * · 项目根有设计册指向、但该路径不在任何一条的 `semantic.files` ⇒ 返回警告段（多行）；
 * · 在册 / 没有册指向 ⇒ 返回 null（不加噪声）。
 */
export function newFileLedgerWarning(projectRoot: string, relPath: string): string | null {
  const root = path.resolve(projectRoot);
  const rel = toPosix(relPath);
  let covering = 0;
  for (const d of listDesignSheets()) {
    if (!d.source_root || path.resolve(d.source_root) !== root) continue;
    covering++;
    const inLedger = (d.semantic?.files ?? []).some((f) => f.path && toPosix(f.path) === rel);
    if (inLedger) return null; // 任一条在册即可 —— 判据/对账覆盖得到
  }
  if (covering === 0) return null;
  return (
    `⚠ 新文件未入册：\`${rel}\` —— 判据/对账覆盖不到它（它不在本项目 ${covering} 条设计册的 \`semantic.files\` 里）。` +
    `本回执**只警告、不自动入册**（入册要带 responsibility 意图，自动插会造空壳节点）。\n` +
    `  入册（一键示例，feature 取覆盖本项目的那条）：\n` +
    `    edit_dsl { feature:'<feature>', reason:'新文件入册', operations:[{ type:'file', op:'add', id:'<node_id>', data:{ path:'${rel}', responsibility:'<职责一句话>' } }] }\n` +
    `  或增量重建：import_project（会把盘上新文件逐条列进 semantic.files）。`
  );
}
