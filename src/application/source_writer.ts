/**
 * source_writer —— **改用户源码的唯一原语**（写闸 / 快照 / 自写登记的**唯一**组合点）
 *
 * ## 它解决的是什么（实测病灶，不是推测）
 * 写闸（`write_gate#assertSourceWriteRegistered`）早就写好了，但**它和执行落盘的那一行不住在一起**：
 *   · `write_gate#writeSourceFiles` 收的是 `mutate: () => T` 回调 —— 它**自己不写**，落盘永远在调用方；
 *   · `edit_code` 干脆不走它，内联"闸 → 快照 → `fs.writeFileSync` → `syncFile`"四件套，**抄了 6 份**；
 *   · 于是全仓对用户源码的覆盖写有 25 处是**裸 `fs.writeFileSync`**，闸的判据与落盘点之间隔着几十行。
 * ⇒ 同一件事（"判闸了没有"）被 8 条写路各自记一遍，漏一处就是一个静默撒谎点。
 *
 * ## 判据（本模块的边界，机械可查）
 * `src/` 内对**用户源码路径**的 `fs.writeFileSync` 只许存在**本文件一处**（见 `commit`）。
 * 写 `.agent-io/` / `design-db/` / `dist/` 的**产物写不在此限**（那是另一条通道，本模块不管）。
 *
 * ## 三步顺序（顺序本身就是判据，别调换）
 *   ① `assertSourceWriteRegistered` —— **判**（拒绝就抛，一个字节都不落盘）
 *   ② `snapshotBeforeWrite`         —— **存**（可撤回；失败不阻断：增强不是前提）
 *   ③ `fs.writeFileSync`            —— **写**
 *   ④ `recordSelfWrite` + `syncSelfWritesSync` —— **登记/写穿**（读己之写可信）
 * ①② 在 `openSourceWrite` 里**整批一次**做完，③ 在 `commit` 里逐文件做，④ 在 `close` 里整批一次。
 *
 * ## 为什么是"事务"而不是"一个函数写完"
 * 有些写路的**内容在写之前算不出来**（`rename_symbols`：第 2 条改名要看第 1 条落盘后的盘面）。
 * 若只给 `writeSourceFile`，它们就只能"逐文件判闸" —— 那会把 `authorize` 的
 * **整批原子**退化成"能过的先落"（制造半写），也会让 `T214` 的"一份快照 = 一个撤回点"碎成 N 份。
 * ⇒ 给**同一道闸**开一个事务：`openSourceWrite` 整批判一次 + 拍一份快照，`commit` 只许落**判过的那些路径**。
 *
 * ## ★ 这不是"lower-level 逃生口"（判据写在代码里，不是写在注释里）
 * `commit` 会**校验路径是否在 open 时声明过**，没声明就抛 —— 拿不到"绕开闸的那个入口"。
 * 三个导出是同一件事的三种用法：`writeSourceFile` = open + commit + close；
 * `writeSourceBatch` = open + commit×N + close。**没有**"不判闸就能写"的出口。
 *
 * ## 已知限度（如实写）
 * · **只管 TS 侧**：`bash` / 编辑器 / 另一个 agent 直写磁盘，本原语看不见（那是 `watch_project` L2 的事）。
 * · **只覆盖"覆盖写"**：移动 / 删除 / 追加（本仓 `fs.renameSync|copyFileSync|unlinkSync|rmSync` 50 处、
 *   `appendFileSync` 7 处）**尚未收口** —— 判据只对覆盖写成立，别拿它当"源码写全收口"。
 * · **同步签名**：索引走 `syncSelfWritesSync`（解析器已预热则当场写穿 L1a，未预热整批落回 L1b 登记）。
 *   需要逐文件 `SyncStatus` 的调用方（`edit_code` 的符号 diff）仍自己再 `syncFile` 一次 ——
 *   那是**索引增强**，不是第二条写路。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  assertSourceWriteRegistered,
  resolveActor,
  recordSelfWrite,
  syncSelfWritesSync,
  type GateExemption,
  type WriteActor,
  type WriteThroughOutcome,
} from './write_gate.js';
import { snapshotBeforeWrite, type FileSnapshotMeta } from './refactor/snapshot/file_snapshot.js';
import { refreshAfterOwnWrite, type AssumptionCheck, type AssumptionTarget } from './read_set.js';
import { toIndexKey, type SyncStatus } from '../infrastructure/index/symbols.js';

/**
 * 一次写入的**上下文**（身份 + 授权 + 标签）。
 * ★ `actor` / `authorize` 只是**交上去** —— 解释它们的是闸（`evaluateTaskGate`），本层不判第二遍。
 */
export interface SourceWriteCtx {
  /** 人读标签（进快照 `reason` 与自写登记 `note`）：写清"哪个工具、改了什么" */
  label: string;
  actor?: WriteActor | null;
  authorize?: string | null;
  /**
   * 逐文件【索引】读数（SyncStatus）—— 只是读数，不改判据、不改写盘顺序。
   * ★ 给「回执里要逐文件 updated」的调用方用（apply_writes 的 index_synced）。
   */
  onFile?: (rel: string, status: SyncStatus) => void;
  /**
   * 本次要写的**符号**（`{file, symbol}`）—— 交给闸做**符号级**假设检定；不给 ⇒ 文件级。
   * ★ 只有「动符号本体」的写路才该给（`replace` / `delete`）；文本级写给了就是假装更精确。
   */
  symbols?: readonly AssumptionTarget[];
}

/**
 * 单个文件的**写入回执** —— 闸说了什么、豁免了谁、快照是哪一份、索引写穿成什么样。
 *
 * ★★★ `task_gate` **必填**（不是 `task_gate?`）：本仓 4 处历史 bug 的病因就是
 * "闸判了、返回值被丢、回执里一个字没有"。可选字段 = 允许不说 ⇒ 必填才能让 `tsc` 挡住漏接。
 */
export interface SourceWriteReceipt {
  /** 项目相对路径（posix 分隔；与闸的 `toIndexKey` 同一把尺） */
  path: string;
  /** 闸的原话（放行依据 / 豁免点名 / 警告）——**逐字**带出，不在这里重新拼 */
  task_gate: string;
  /** 本次靠设计侧声明豁过去的文件（空数组 = 本次没有任何豁免，不是"没算"） */
  exemptions: GateExemption[];
  /** 闸留下的警告（收集失败等）；空数组 = 没有 */
  warnings: string[];
  /** 读集检定（「我/别人读的符号现在还是不是这一版」）—— 与 `task_gate` 两件事，别混 */
  assumption_check?: AssumptionCheck;
  /** 整批写前快照（一次改动 = 一份快照 = 一个撤回点；`null` = 没拍成，增强不许阻断写入） */
  snapshot?: FileSnapshotMeta;
  /** 索引写穿结果（`undefined` = 本批没落盘任何文件） */
  index?: WriteThroughOutcome;
}

/**
 * 一次**已开闸**的批量写。`commit` 只接受 `paths` 里声明过的文件 —— 这是"没有逃生口"的实现。
 */
export interface SourceWriteTxn {
  /** 本批已在 `openSourceWrite` 里判过闸的路径（项目相对 posix） */
  readonly paths: readonly string[];
  /** 闸的原话（整批一份） */
  readonly task_gate: string;
  readonly exemptions: GateExemption[];
  readonly warnings: string[];
  readonly assumption_check?: AssumptionCheck;
  /** 整批写前快照 */
  readonly snapshot?: FileSnapshotMeta;
  /** 落一个文件（路径必须在 `paths` 里；不在就抛） */
  commit(file: string, content: string): SourceWriteReceipt;
  /** 收尾：自写登记 + 索引写穿 + 写者基线刷新。没落过盘 ⇒ `null` */
  close(): WriteThroughOutcome | null;
}

/** 把批内路径归一成项目相对 posix；根外路径返回 `null`（闸那边同样会判 `no-files`） */
function relOf(root: string, file: string): string | null {
  return toIndexKey(root, file);
}

/**
 * ★ **开闸**：整批一次判 + 整批一份快照。没有落盘动作（落盘只在 `commit` 里）。
 *
 * 拒绝时**抛**（`assertSourceWriteRegistered` 自己抛）⇒ 本函数返回前一个字节都没写。
 */
export function openSourceWrite(rootArg: string, files: readonly string[], ctx: SourceWriteCtx): SourceWriteTxn {
  const root = path.resolve(rootArg);
  const declared: string[] = [];
  for (const f of files) {
    const rel = relOf(root, f);
    if (rel && !declared.includes(rel)) declared.push(rel);
  }
  // ★ 判据只住 `write_gate`：这里**只接住回执**，不重算一遍（第二份判据 = 本仓头号病）。
  const gate = assertSourceWriteRegistered(root, declared, {
    actor: resolveActor(ctx.actor),
    authorize: ctx.authorize,
    symbols: ctx.symbols,
  });
  const snapshot = declared.length ? snapshotBeforeWrite(root, ctx.label, declared) : null;
  const allowed = new Set(declared);
  const written: string[] = [];

  const txn: SourceWriteTxn = {
    paths: declared,
    task_gate: gate.note,
    exemptions: gate.exempted,
    warnings: gate.warnings,
    ...(gate.assumption_check ? { assumption_check: gate.assumption_check } : {}),
    ...(snapshot ? { snapshot } : {}),
    commit(file: string, content: string): SourceWriteReceipt {
      const rel = relOf(root, file);
      if (!rel) {
        throw new Error(
          `拒绝落盘（source_writer）：\`${file}\` 不在项目根内（${root}）—— 根外文件进不了快照、也进不了索引，` +
            '写下去就是"改了但不可撤回、且索引看不见"。',
        );
      }
      // ★★ 这就是"没有逃生口"那一行：没在 open 时判过闸的路径，这里**不许**写。
      if (!allowed.has(rel)) {
        throw new Error(
          `拒绝落盘（source_writer）：\`${rel}\` **没有在 \`openSourceWrite\` 的 \`files\` 里声明过**。\n` +
            `  ★ 本次已判过的路径（${declared.length} 条）：${declared.join(', ')}\n` +
            '  ★ 怎么办：把这条路径加进 `files` 再开闸（判据只许走一次闸，不许绕）。',
        );
      }
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      if (!written.includes(rel)) written.push(rel);
      return {
        path: rel,
        task_gate: gate.note,
        exemptions: gate.exempted,
        warnings: gate.warnings,
        ...(gate.assumption_check ? { assumption_check: gate.assumption_check } : {}),
        ...(snapshot ? { snapshot } : {}),
      };
    },
    close(): WriteThroughOutcome | null {
      if (!written.length) return null;
      // ④a 自写登记（L1b）：写穿失败时读路径靠它兜 —— 必须**先**登记，否则失败就没兜底了
      recordSelfWrite(root, written, ctx.label);
      // ④b 同步写穿（L1a）：解析器已预热 ⇒ 当场直连；未预热 ⇒ 整批落回 L1b（绝不半同步）
      const index = syncSelfWritesSync(root, written);
      // ④c 写者自己的读集基线刷到写后 —— 不刷会让同一个 actor 下一次写必然报一条假 stale
      refreshAfterOwnWrite(root, resolveActor(ctx.actor), written);
      return index;
    },
  };
  return txn;
}

/**
 * ★ 单文件写入（最常用）：`open → commit → close`，一次调用做完四件事。
 * `root` 之后的所有路径都必须是**项目内**的（根外直接抛，理由见 `commit`）。
 */
export function writeSourceFile(
  root: string,
  file: string,
  content: string,
  ctx: SourceWriteCtx,
): SourceWriteReceipt {
  const txn = openSourceWrite(root, [file], ctx);
  const receipt = txn.commit(file, content);
  const index = txn.close();
  return index ? { ...receipt, index } : receipt;
}

/**
 * ★ 批量写入：**整批判一次闸 + 拍一份快照**，再逐文件落盘，最后一次性登记/写穿。
 *
 * ★ 为什么不做成"逐文件调 `writeSourceFile`"：那会让 `authorize` 的**整批原子**退化成
 *   "能过的先落"（半写），并让一份改动碎成 N 个撤回点。批的语义必须由一次判闸保证。
 */
export function writeSourceBatch(
  root: string,
  entries: ReadonlyArray<readonly [string, string]>,
  ctx: SourceWriteCtx,
): SourceWriteReceipt[] {
  if (!entries.length) return [];
  const txn = openSourceWrite(root, entries.map((e) => e[0]), ctx);
  const receipts = entries.map(([f, c]) => txn.commit(f, c));
  const index = txn.close();
  return index ? receipts.map((r) => ({ ...r, index })) : receipts;
}
