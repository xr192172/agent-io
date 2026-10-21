/**
 * todo_journal.ts —— **todo 物理删除的墓碑日志**（`<feature>.journal.jsonl`，append-only）。
 *
 * ## 为什么要有它（用户 2026-10-21 的裁决）
 * 「`delete` 也要 `reason`，而且**删掉的东西要落在 journal 里**（可追溯），不是无声消失。」
 * ⇒ 物理删是**唯一**会让卡真的从册上消失的操作 ⇒ 必须有卡外的留痕处。
 *
 * ## 为什么是「设计册旁边的 JSONL」，而不是别的三个候选（逐个排除过）
 * | 候选 | 为什么不 |
 * |---|---|
 * | `cache.db` | 它是**可重建的事实索引**（`.agent-io/cache.db` 不入库）⇒ 一次重建就把墓碑冲掉；而「谁被删过」是**事件**，不是可由代码现算的事实（`task_schema.ts` 文件头铁律 1）|
 * | `archive/`（下线库）| `ArchiveEntry` 要求**整份 DesignDSL 快照** + `file_path` 语义（那是「文件下线」的账）⇒ 把一张 todo 塞进去会污染那条线的口径 |
 * | `design-db/` | 它是**生成投影**（`*.calls.json`，`scripts/gen-db-check.mjs` 逐字节比对）⇒ 往里写事件会让那道门红 |
 * ⇒ 与设计册**同目录、同归属**的追加日志：一次 `appendFileSync` 就落盘（不需要读-改-写），坏一行不影响其余，diff 也好看。
 *
 * ★ 本仓此前**没有** journal 基础设施（2026-10-21 实测：全仓 `grep journal` 只命中 `PRAGMA journal_mode`）
 *   ⇒ 这是**第一条**；口径写在这里，以后别的 type 要记墓碑就复用它，**别各写一份**。
 *
 * ## 谁能读它
 * `get_dsl query=todo` 的 `deleted` 段（★ 能力不许藏在「你得自己去翻文件」里）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDesignSheetFile } from '../../../infrastructure/storage.js';
import type { TaskSpec } from '../../../domain/task_schema.js';

/**
 * 行分隔符（JSONL 的**协议**部分，不跟随平台换行）。
 *
 * ★ 为什么是常量而不是字面量：本文件在 Windows 上也会被写 —— 若哪天有人把它换成平台 EOL，
 *   回车符会**混进 JSON 字段**（读端 `JSON.parse` 报错，或字段尾多一个不可见字符，对拍时诡异地不相等）。
 *   固定 LF，且只有一个住处 ⇒ 改不掉。
 */
const LF = String.fromCharCode(10);

/**
 * 一条墓碑：**被物理删掉的那张卡**（原样快照）+ 为什么删。
 *
 * ★ `card` 是**全文**而不是摘要：删了以后，只剩这里能回答
 *   「原来那张卡要求什么、谁领过、有没有证据」。摘要等于把答案也删了。
 */
export interface TodoTombstone {
  /** 事件类型（一行一事件；将来扩别的 type 时按这个字段分流） */
  kind: 'todo.delete';
  /** 删除时刻（ISO 8601） */
  at: string;
  /** 谁删的（顶层 `edit_dsl` 的 `agent`；缺省 ⇒ 未署名 —— 工具不伪造） */
  by?: string;
  /** 为什么删（**必填**，由 `OP_SPECS` 保证 —— 这里不再判一遍） */
  reason: string;
  /** 被删的完整卡 */
  card: TaskSpec;
}

/**
 * 墓碑日志的路径：**与设计册同目录**（`<baseDir>/.agent-io/design/<feature>.journal.jsonl`）。
 * ★ 从 `getDesignSheetFile(feature)` 取目录（而不是在这里再拼一次 `.agent-io/design`）——
 *   设计册搬过一次家（`features/` → `design/`，2026-10-18），**路径只有一个出处**才不会重演。
 */
export function todoJournalFile(feature: string): string {
  return path.join(path.dirname(getDesignSheetFile(feature)), `${feature}.journal.jsonl`);
}

/** 追加一条墓碑（★ 只加不减 —— 日志的语义就是 append-only）。 */
export function appendTodoTombstone(feature: string, t: TodoTombstone): string {
  const file = todoJournalFile(feature);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(t) + LF, 'utf-8');
  return file;
}

/**
 * 读回全部墓碑（按落盘顺序）。
 *
 * ★ 坏行**不静默吞掉**：截断/手改过的行会被计数返回 ⇒ 读端（`query=todo`）会把
 *   「有 N 行读不出」**报出来**（本仓纪律：不许把「读不到」读成「没有」）。
 * ★ 文件不存在 ⇒ `{entries: [], bad_lines: 0}`（**没有墓碑**是合法状态，不是错误）。
 */
export function readTodoTombstones(feature: string): { entries: TodoTombstone[]; bad_lines: number } {
  const file = todoJournalFile(feature);
  if (!fs.existsSync(file)) return { entries: [], bad_lines: 0 };
  const entries: TodoTombstone[] = [];
  let bad = 0;
  for (const line of fs.readFileSync(file, 'utf-8').split(LF)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s) as TodoTombstone;
      if (o && o.kind === 'todo.delete' && o.card) entries.push(o);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { entries, bad_lines: bad };
}
