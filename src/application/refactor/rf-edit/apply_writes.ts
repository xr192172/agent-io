/**
 * apply_writes —— ★ **落盘内核**：凡是"把算好的新内容写到源码文件"，都走这里。
 *
 * 由来（用户 2026-09-29）：
 *   「把它**通过路由等方式进行内化**，就像是 `SafeRename` 那样。」
 *   诊断：`rename_symbols` 的 [C] 是**薄转发**（落盘在 [B] 里），而**另一支局部改名入口**的 [C]
 *   **自己 readFileSync/writeFileSync**（该支已于 2026-09-29 并入 `rename_symbols`）—— 而且它缺
 *   `dry_run`、缺写前快照（撤回通道）、缺索引同步。同一件事"落盘"，有的工具做全了、有的漏一半
 *   ⇒ 这就是"接口性收敛收敛不起来"。
 *
 * ★ 本模块**不是**新造的第五份写入实现：它就是 `write_gate.writeSourceFiles`
 *   （L1a 统一写入闸：**快照(一次，含全部文件) → 真写 → 索引写穿 + 引用方重算**）的
 *   结构化适配层。为什么还要一层：闸的入参形态是"文件列表 + mutate 回调"（给自己人写代码用），
 *   而 lane/[B] 手里拿到的是"**算好的内容**"（`{file, content}[]`）——
 *   适配层把那对形态对上，顺带把闸的回执归一成**结构化 receipt**（见下）。**没有第二份写盘逻辑。**
 *
 * 落盘顺序（照 `edit_code` 的三件套，不自创）：
 *   ① 写前快照（**一次**，含全部文件 ⇒ 一次改动 = 一份快照 = 一个撤回点）
 *   ② 逐文件写
 *   ③ 逐文件 `syncFile` 写穿 + 引用方重算（`writeSourceFiles` 内建）
 *   ④ 结构化 receipt（`written_files` / `snapshot_id` / `index_synced` / `blocked`）
 *
 * 语义边界（★ 别想当然）：
 *   - `dryRun: true` ⇒ **完全不碰盘**（不快照、不写、不同步），返回**同构**回执但 `written_files: []`。
 *   - 项目**没有索引**时不会凭空建库（闸的纪律）：`index.mode === 'skipped'`，
 *     此时 `index_synced` 为**空数组**（"没同步" ≠ "同步了但没更新"—— 后者是 `updated:false`）。
 *   - 逐文件判决只在索引写穿**真的跑了**（`index.mode === 'synced'`）时才给。
 *   - 落在 `projectRoot` 之外的文件**拒绝落盘**并进 `blocked`：它们进不了快照也进不了索引，
 *     写下去就是"改了但不可撤回、且索引看不见"——比不写更糟。
 */

import fs from 'node:fs';
import path from 'node:path';
import { writeSourceFiles, toRelPosix, type WriteThroughOutcome } from '../../observe/runtime/write_gate.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

/** 一项待落盘的改写：目标文件（相对 `projectRoot` 或绝对路径）+ 新内容全文 */
export interface WriteItem {
  file: string;
  content: string;
}

export interface WriteReceipt {
  /** 落盘动作本身是否完成（=false ⇒ 见 `blocked`）。**不**代表索引已同步 —— 那看 `index`。 */
  ok: boolean;
  /** 真的落盘的文件（相对 `projectRoot` 的 posix 路径；`dryRun` 时为 `[]`）。
   *  ★ 新名：旧 `written` 与 4 个 boolean「是否落盘」同名两义；路径表统一 `written_files`。 */
  written_files: string[];
  /** 写前快照 id（撤回通道凭据；`dryRun` / 文件不存在 / 快照失败时缺省） */
  snapshot_id?: string;
  /** 索引写穿的完整回执（闸的口径；`null` = 没做/没索引） */
  index: WriteThroughOutcome | null;
  /** 逐文件索引同步结果（**只在** `index.mode === 'synced'` 时有值；否则为空数组） */
  index_synced: Array<{ file: string; updated: boolean }>;
  /** 被拒绝落盘的文件（根外路径 ⇒ 无法快照/写穿）。有值即 `ok=false`。 */
  blocked?: string[];
}

/**
 * 把 `items` 里的新内容落到磁盘。
 *
 * @param projectRoot 项目根（快照与索引的归属）
 * @param items       待写文件与新内容；**同一文件多项时后者胜**（与"逐项覆盖"直觉一致，且只写一次）
 * @param opts.dryRun true=只走流程、不碰盘
 * @param opts.note   快照/回执里的人读说明（如 `rename_symbols(scope=local):src/a.ts`）
 */
async function applyWritesCore(
  projectRoot: string,
  items: readonly WriteItem[],
  opts: { dryRun?: boolean; note?: string } = {},
): Promise<WriteReceipt> {
  const root = path.resolve(projectRoot);
  const note = opts.note ?? 'apply_writes';

  // 归一到「相对根路径 → 内容」；根外路径单独收集（拒绝落盘，见文件头"语义边界"）
  const byRel = new Map<string, string>();
  const outside: string[] = [];
  for (const it of items ?? []) {
    if (!it || typeof it.file !== 'string' || it.file.trim() === '') continue;
    const rel = toRelPosix(root, it.file);
    if (rel === null) outside.push(it.file);
    else byRel.set(rel, it.content);
  }

  if (outside.length > 0) {
    return { ok: false, written_files: [], index: null, index_synced: [], blocked: outside };
  }
  if (byRel.size === 0) return { ok: true, written_files: [], index: null, index_synced: [] };
  // ★ 干跑：不碰盘（不快照、不写、不同步），但回执结构不变
  if (opts.dryRun === true) return { ok: true, written_files: [], index: null, index_synced: [] };

  const written = [...byRel.keys()];
  const updatedByRel = new Map<string, boolean>();

  // ① 快照（一次，含全部文件）+ ② 逐文件写 + ③ 逐文件 syncFile/引用方重算 —— 全在闸里，别在这重写
  const { report } = await writeSourceFiles(
    root,
    written,
    () => {
      for (const [rel, content] of byRel) fs.writeFileSync(path.join(root, rel), content, 'utf8');
      return written;
    },
    { label: note, onFile: (rel, status) => updatedByRel.set(rel, status === 'updated') },
  );

  return {
    ok: true,
    written_files: written,
    ...(report.snapshot?.id ? { snapshot_id: report.snapshot.id } : {}),
    index: report.index,
    // ★ 只有**真进了逐文件同步循环**（`mode === 'synced'`）才有逐文件判决。
    //   没索引 / 写穿提前失败 ⇒ 给**空数组**，而不是一排 `updated:false` ——
    //   后者会与"同步了但这个文件内容没变（skipped）"混为一谈，读的人没法分辨。
    index_synced:
      report.index?.mode === 'synced'
        ? written.map((rel) => ({ file: rel, updated: updatedByRel.get(rel) === true }))
        : [],
  };
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 *
 * 本 [B] 是**落盘内核**（只写不改别的）：
 *   - 作用域类 `project_dir`：入参 `projectRoot` 是必需参数 ⇒ 随时可给（`path.resolve` 成绝对根）。
 *   - 对象类 `written_files`：**只有真落盘才给**。判据取**产物自身**：`r.ok && r.written_files.length > 0`
 *     —— 三个"没落盘"的出口都天然被它挡掉：
 *       · 根外文件（:85，`ok:false`，`written_files:[]`）；
 *       · 无可写项（:87，`ok:true` 但空）；
 *       · `dryRun`（:89，`ok:true` 但空）。
 *       ⇒ 不另立 `if (dryRun)` 判据（那会把同一个事实两处各判一次）。
 *   - 值**直接复用**产物里的 `written_files`：它本就是 `toRelPosix(root, it.file)` 的键（仓库相对 POSIX），
 *     与 `Touched.written_files` 口径**逐字一致**（无需再转一次）。
 *
 * ★★ 已知重复：产物**顶层**已有一个规范名 `written_files`（:47）⇒ 本次调用后同一份路径表会**出现两次**
 *   （顶层一份 + `touched` 里一份）。**仍然加** —— `touched` 是"下游只读一个统一处"的收据，不能残缺；
 *   顶层那份将来应移交/退役（见交付报告）。
 */
function touchedOf(projectRoot: string, r: WriteReceipt): Touched {
  const touched: Touched = { project_dir: path.resolve(projectRoot) };
  if (r.ok && r.written_files.length > 0) touched.written_files = r.written_files;
  return touched;
}

export async function applyWrites(
  projectRoot: string,
  items: readonly WriteItem[],
  opts: { dryRun?: boolean; note?: string } = {},
): Promise<TouchedProduct<WriteReceipt>> {
  const r = await applyWritesCore(projectRoot, items, opts);
  return withTouched(r, touchedOf(projectRoot, r));
}
