/**
 * rename_local —— `scope='local'` 的 **[B] 实现分支**：文件内局部作用域的批量改名。
 *
 * ─────────────────────────────────────────────────────────────
 * 它是什么（以及不是什么）
 * ─────────────────────────────────────────────────────────────
 *   **是**：`rename_symbols` 单一入口里「作用域」这一维的那一支 —— 与 `.go`/`.py`/`.cs`/`.java`/`.c`
 *        各支是同一件事（同一个 [B] 内部按对象路由），只不过那一维分的是**语言**、这一维分的是**作用域**。
 *   **不是**：新造一台改名引擎。作用域分析（`analyzeLocals`：作用域树 + 名字绑定解析）、
 *        合并改写（`renameMany`：一次解析、多编辑逆序应用）全部复用 `tools/ast_rename.ts` ——
 *        那是本仓的**真实资产**，本模块一行都没有重写它。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么「读 + 算 + 写」全在这一层（而不是散回 [C]）
 * ─────────────────────────────────────────────────────────────
 *   上一版把这三段里的**读写**放在 [C]（lane）里，于是同一件"落盘"两处形态 ⇒ 局部改名这一支
 *   少了三样：`dry_run`（先看后写）、写前快照（不可撤回）、索引写穿（改完立刻读可能读到旧索引）。
 *   现在：本模块是 [B]，[C] 只做路由与渲染；落盘**只**走共享内核 `applyWrites`
 *   （= 写闸的结构化适配层：一次快照含全部文件 → 逐文件写 → 索引写穿）；本模块**不自己 writeFileSync**。
 *
 * ─────────────────────────────────────────────────────────────
 * 逐项语义（与 module 支共享同一封回执，但**写盘粒度**不同 —— 这是有意的）
 * ─────────────────────────────────────────────────────────────
 *   - **逐项独立**：某一项找不到绑定 / 名字歧义 / 撞名 / 非法名 ⇒ **只跳它**，其余照改
 *     （局部改名的失败天然是逐项的：一个名字对不上，不构成"别的项也有问题"）。
 *     module 支相反（任一条被阻断 ⇒ 整批不落盘），因为那一支的阻断常是**跨条目**性质
 *     （重复条目、跨文件符号图、根外文件、字面量计划）。两支的差别在 [C] 的 description 里明写。
 *   - **一个文件一次解析**：同文件的所有项合成一次 `renameMany` —— 否则串行逐项改，
 *     后面项的字节偏移会因前面项的改写而错位（这是 "一次解析多编辑逆序合并" 要防的那个错）。
 *   - **一批一份快照**：全部改动文件合成**一次** `applyWrites` ⇒ 一次调用 = 一个撤回点。
 *   - **跳过项可见**：每项都带 `ok / changed / blocked[]`；`changed===0` 必然给出**具体**理由
 *     （由 `renameMany` 的 `why` 或本层的寻址结论提供），绝不出现"只报 0 不说为什么"。
 *
 * ─────────────────────────────────────────────────────────────
 * 寻址（调用方给什么、我们怎么认人）
 * ─────────────────────────────────────────────────────────────
 *   条目 = `{file, symbol, to, decl_line?}`：按**名字**寻址，同名遮蔽时用**声明行**消歧；
 *   解析规则与理由见 `ast_rename.resolveLocalAddress` 的文档（为什么不用内部 id 寻址）。
 *   歧义 ⇒ **拒**（把候选连同行号列出来让调用方补一刀），不猜。
 */

import fs from 'node:fs';
import path from 'node:path';
import { analyzeLocals, renameMany, resolveLocalAddress, type RenameItem } from '../../../infrastructure/parse/ast_rename.js';
import { applyWrites } from '../rf-edit/apply_writes.js';
import { findLanguageByExt } from '../../../infrastructure/parse/languages.js';
import type { WriteThroughOutcome } from '../../observe/write_gate.js';

/** 一条局部改名请求（`scope='local'` 的条目形态；与 module 支的条目同形，见 rename_symbols.ts） */
export interface LocalRenameTarget {
  /** 目标文件：相对 `root` 或绝对路径 */
  file: string;
  /** 当前绑定名（函数/块内 const·let·var，或形参、catch 参数） */
  symbol: string;
  /** 新名（合法标识符） */
  to: string;
  /** 同名绑定多于一个时用来消歧：声明的行号（1-based，含声明的那一行） */
  decl_line?: number;
  /** 仅 module 支支持；本支拿到 true 会**响亮地**拒该项，而不是静默忽略 */
  rename_file_if_matching?: boolean;
}

/** 逐项结果（`ok=false` 的理由必在 `blocked[]` 里） */
export interface LocalRenameOutcome {
  /** 在入参 `renames` 里的下标（与回执 `previews[].index` 对齐） */
  index: number;
  /** 目标文件绝对路径 */
  file: string;
  /** 旧名 */
  symbol: string;
  /** 新名 */
  to: string;
  /** true = 这项的改名成立（`dry_run` 时 = 将会成立）；false = 见 `blocked` */
  ok: boolean;
  /** 实际（`dry_run` 时 = 预计）替换的字节位置数：声明 + 赋值目标 + 全部引用 */
  changed: number;
  /** 命中绑定的声明行（1-based） */
  declLine?: number;
  /** 命中绑定所属函数名（模块顶层/匿名兜底见 LocalBinding.parentFunction） */
  parentFunction?: string;
  /** `ok=false` 的全部理由 */
  blocked?: string[];
}

export interface LocalRenameBatchResult {
  /** 落盘动作完成（=false ⇒ 见 `blocked`：一个字节都没写） */
  ok: boolean;
  dryRun: boolean;
  items: LocalRenameOutcome[];
  /** 有新内容待写/已写的文件（绝对路径；`dry_run` 时 = 预计要写的） */
  changedFiles: string[];
  /** 真的落盘的文件数（`dry_run` ⇒ 0） */
  filesWritten: number;
  /** 写前快照 id（撤回通道凭据） */
  snapshotId?: string;
  /** 索引写穿回执（`null` = 没做/没索引） */
  index: WriteThroughOutcome | null;
  /** 整批被拒的理由（如文件在 `root` 之外 ⇒ 进不了快照也进不了索引） */
  blocked?: string[];
}

/**
 * 批量执行「文件内局部作用域改名」。
 *
 * @param input.root     已解析的项目根（快照与索引的归属；调用方保证非空）
 * @param input.renames  条目（可跨多个文件；`root` 外的文件会被拒）
 * @param input.dry_run  true=只算不落盘（同构回执，`filesWritten=0`）
 */
export async function renameLocals(input: {
  root: string;
  renames: LocalRenameTarget[];
  dry_run?: boolean;
}): Promise<LocalRenameBatchResult> {
  const root = path.resolve(input.root);
  const dryRun = input.dry_run === true;
  const abs = (f: string): string => (path.isAbsolute(f) ? path.resolve(f) : path.resolve(root, String(f)));

  const items: LocalRenameOutcome[] = input.renames.map((it, index) => ({
    index,
    file: abs(it.file),
    symbol: it.symbol,
    to: it.to,
    ok: false,
    changed: 0,
  }));

  // 按文件分组（保持入参顺序）：同文件的所有项**一次解析、一次合并** —— 「多编辑逆序合并」的前提。
  const byFile = new Map<string, number[]>();
  for (const it of items) {
    const a = byFile.get(it.file);
    if (a) a.push(it.index);
    else byFile.set(it.file, [it.index]);
  }

  /** 待写内容（文件绝对路径 → 新全文）；只有真的算出改动才进来 */
  const pending = new Map<string, string>();

  for (const [file, idxs] of byFile) {
    const ext = path.extname(file);
    if (!findLanguageByExt(ext)) {
      // 说清"是解析器不支持"，而不是让调用方看到"没有名为 x 的绑定"这种误导性结论
      for (const i of idxs) items[i].blocked = [`无 ${ext} 语言解析器 ⇒ 局部作用域改名不支持该文件类型`];
      continue;
    }
    let src: string;
    try {
      src = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      for (const i of idxs) items[i].blocked = [`读文件失败：${String(err)}`];
      continue;
    }

    const bindings = await analyzeLocals(src, file);
    const targets: RenameItem[] = [];
    /** 绑定 id → 入参下标（同一文件内 id 唯一） */
    const idToIndex = new Map<number, number>();

    for (const i of idxs) {
      const it = input.renames[i];
      if (it.rename_file_if_matching === true) {
        items[i].blocked = ['局部作用域不支持 rename_file_if_matching（那是模块级符号的文件联动改名）⇒ 请改用 scope=module'];
        continue;
      }
      const got = resolveLocalAddress(bindings, src, { symbol: it.symbol, declLine: it.decl_line });
      if (!got.ok) {
        items[i].blocked = [got.why];
        continue;
      }
      if (idToIndex.has(got.binding.id)) {
        items[i].blocked = [`与第 ${idToIndex.get(got.binding.id)! + 1} 条指向同一绑定（同一绑定只改一次）`];
        continue;
      }
      idToIndex.set(got.binding.id, i);
      items[i].declLine = got.line;
      items[i].parentFunction = got.binding.parentFunction;
      targets.push({ id: got.binding.id, to: it.to });
    }
    if (targets.length === 0) continue;

    // ★ 复用真实资产：`renameMany` 内部 `resetIds()` 后重新解析 ⇒ 同一份源码两次解析的 id 逐位一致
    //   （见 ast_rename 的 `resetIds` 注释）⇒ 上面解析到的 id 与这里改的绑定**是同一个**，不是"猜的"。
    const { out, applied } = await renameMany(src, targets, file);
    for (const a of applied) {
      const i = idToIndex.get(a.id);
      if (i === undefined) continue;
      items[i].changed = a.changed;
      items[i].ok = a.changed > 0;
      if (a.changed === 0) items[i].blocked = [a.why ?? '未改动（内核未给出理由）'];
    }
    if (out !== src) pending.set(file, out);
  }

  const changedFiles = [...pending.keys()];
  if (dryRun || pending.size === 0) {
    return { ok: true, dryRun, items, changedFiles, filesWritten: 0, index: null };
  }

  // ★ 一批 = 一次 applyWrites = 一份快照 = 一个撤回点（快照 / 真写 / 索引写穿全在写闸里）
  const receipt = await applyWrites(
    root,
    changedFiles.map((f) => ({ file: f, content: pending.get(f)! })),
    { note: `rename_symbols(scope=local): ${items.filter((x) => x.ok).length} 项 / ${changedFiles.length} 文件` },
  );

  if (receipt.blocked?.length) {
    // 根外的文件进不了快照、也进不了索引 ⇒ 写下去就是"改了但不可撤回、且索引看不见"。
    // 内核已按"整批拒"处理（一个字节都没写）；这里必须**响亮**地改口，不能让逐项的 ok 继续喧哗。
    const why = `整批未落盘：以下文件在项目根之外（进不了写前快照与索引写穿）⇒ ${receipt.blocked.join(', ')}（root=${root}）`;
    for (const it of items) {
      if (!it.ok) continue;
      it.ok = false;
      it.blocked = [...(it.blocked ?? []), why];
    }
    return { ok: false, dryRun, items, changedFiles, filesWritten: 0, index: null, blocked: [why] };
  }

  return {
    ok: true,
    dryRun,
    items,
    changedFiles,
    filesWritten: receipt.written.length,
    ...(receipt.snapshot_id ? { snapshotId: receipt.snapshot_id } : {}),
    index: receipt.index,
  };
}
