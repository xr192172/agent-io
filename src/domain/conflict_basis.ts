/**
 * conflict_basis.ts —— claim 读集的**基准选择**（零依赖纯函数；判据唯一住处）。
 *
 * ## 它回答的唯一问题
 * 用户 2026-10-30 原话：
 * > 「刚开始领任务的时候是读集，但是后面在进行设计之后，就这个任务卡**正式成立**的时候，
 * >  受到修改的这些部分会**坍缩为改集**，就不再依赖读集，而是依赖**改集**了。」
 *
 * ⇒ 二元口径：卡**已成立**（有画布坍缩集 = 设计已完成，改集已坍缩成要改的那几个符号）
 *   ⇒ `decidedBy='canvas'`；未成立 ⇒ `decidedBy='read-set'`（回到 declared → expectations → node-path）。
 *
 * ## 为什么**不许**把两套取并集（这正是本文件要修的事）
 * `claim_conflict.ts` 原来把四级**累积**成一份读集：卡已有 3 个符号的坍缩集之后，
 * 早期随手声明的宽读集**仍然在占位** ⇒ 别人领一张只碰那些多余符号的卡时被拒 —— 那是**假阻塞**。
 * 而「假阻塞比漏判更打击积极性」这句就写在同一段注释里，当时只防了「画布展开态」那一侧，
 * 没防「早期宽声明」这一侧。⇒ 基准必须**二选一**，不是求和。
 *
 * ## 边界（如实写，别假装它能做更多）
 * · **只选基准、不判冲突**：相交就拒（E-CLAIM-005）仍住 `claim_conflict.ts#detectClaimConflicts`；
 * · **不做路径归一、不查指纹**：进来的是已归一的仓库相对 `{file,name}`；facts 归 `claim_conflict.ts`；
 * · 「画布非空」= **有效条目非空**（`file` 与 `symbol` 都非空）；空串锚点不占位（它指不到任何东西）；
 * · 读集模式下**一个符号也隐含占住它所在的文件**（写是文件级的，与 `claim_conflict.ts#addSymbol` 同口径）。
 *
 * ## 为什么零 import
 * `behavior-cases` 的 harness 会把目标文件**单独转译再 import** ⇒ 目标文件必须零依赖自含
 * （否则报「目标文件加载失败: Cannot find module …」）。所以类型自己也声明一份，不从 task_schema 取。
 */

/** 一处符号占位（仓库相对路径 + 符号名；名字可以是短名，归一成 qualified_name 是调用方的事） */
export interface ConflictSymbol {
  file: string;
  name: string;
}

/** 一级输入（`declared` 与 `expectations` 同形：符号 + 整文件） */
export interface ConflictSymbolsAndFiles {
  symbols?: ConflictSymbol[];
  files?: string[];
}

/** 算基准要的四类原始输入（★ 只管收集，判定在本文件唯一的函数里） */
export interface ConflictInputs {
  /** ① 调用方在 claim 时显式声明（`data.read_set`） */
  declared?: ConflictSymbolsAndFiles;
  /** ①' 画布坍缩集（`status !== 'done'` 的那些条目；一张卡可有多份画布） */
  canvas?: Array<{ file: string; symbol: string }>;
  /** ② 卡上判据里点名的符号 / 文件 */
  expectations?: ConflictSymbolsAndFiles;
  /** ③ 节点自己的文件（L1 卡唯一能算出来的东西） */
  nodePath?: string;
}

/** 生效的是哪几级（顺序 = declared → expectations → node-path；canvas 独占） */
export type ConflictBasis = 'canvas' | 'declared' | 'expectations' | 'node-path';

/** 基准判定结果：`basis` 说清「凭什么是它」，`decidedBy` 说清「用的是哪套口径」 */
export interface ConflictSelection {
  basis: ConflictBasis[];
  symbols: ConflictSymbol[];
  files: string[];
  /** ★ 二元口径：卡已成立 ⇒ 'canvas'；未成立 ⇒ 'read-set' */
  decidedBy: 'canvas' | 'read-set';
}

/** 只认非空字符串（`file`/`symbol` 给 null、数字、空白都算没给） */
function normText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 符号排序：先 file 再 name（两次同名不同序的输入必须产出同一份结果） */
function compareSymbols(a: ConflictSymbol, b: ConflictSymbol): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
}

/** 文件排序（字典序；确定性读数是判据能逐字比的前提） */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 画布坍缩集 → 符号 + 文件（去重；空串锚点跳过） */
function canvasEntries(list: ConflictInputs['canvas']): { symbols: ConflictSymbol[]; files: string[] } {
  const symbols: ConflictSymbol[] = [];
  const files: string[] = [];
  const seenSym = new Set<string>();
  const seenFile = new Set<string>();
  for (const c of list ?? []) {
    const file = normText(c?.file);
    const name = normText(c?.symbol);
    if (!file || !name) continue;
    const key = file + '#' + name;
    if (!seenSym.has(key)) {
      seenSym.add(key);
      symbols.push({ file, name });
    }
    if (!seenFile.has(file)) {
      seenFile.add(file);
      files.push(file);
    }
  }
  return { symbols: symbols.sort(compareSymbols), files: files.sort(compareText) };
}

/**
 * **选基准**（本模块的唯一判据；`claim_conflict.ts#computeClaimReadSet` 只调用它、不另算）。
 *
 * 判据（两条，覆盖全部输入组合）：
 * 1. `canvas` **非空** ⇒ **只用 canvas**：`decidedBy='canvas'`、`basis=['canvas']`，
 *    `declared` / `expectations` / `nodePath` **一律不参与**（★ 不许取并集 —— 那正是假阻塞的来源）；
 * 2. `canvas` 为空 ⇒ 回到现状：`decidedBy='read-set'`、`basis` = declared ∪ expectations ∪ node-path
 *    （去重，顺序 declared → expectations → node-path）。
 */
export function selectConflictBasis(i: ConflictInputs): ConflictSelection {
  const canvas = canvasEntries(i?.canvas);
  if (canvas.symbols.length) {
    return { basis: ['canvas'], symbols: canvas.symbols, files: canvas.files, decidedBy: 'canvas' };
  }

  const symbols: ConflictSymbol[] = [];
  const files: string[] = [];
  const basis: ConflictBasis[] = [];
  const seenSym = new Set<string>();
  const seenFile = new Set<string>();
  /** 把一级输入并进读集；该级**只要有有效条目**就记进 basis（去重命中的也算它出过力） */
  const takeLevel = (level: ConflictBasis, src?: ConflictSymbolsAndFiles): void => {
    if (!src) return;
    let touched = false;
    for (const raw of src.files ?? []) {
      const file = normText(raw);
      if (!file) continue;
      touched = true;
      if (seenFile.has(file)) continue;
      seenFile.add(file);
      files.push(file);
    }
    for (const s of src.symbols ?? []) {
      const file = normText(s?.file);
      const name = normText(s?.name);
      if (!file || !name) continue;
      touched = true;
      const key = file + '#' + name;
      if (!seenSym.has(key)) {
        seenSym.add(key);
        symbols.push({ file, name });
      }
      // ★ 要碰一个符号 ⇒ 也占住它所在的文件（写是文件级的）
      if (!seenFile.has(file)) {
        seenFile.add(file);
        files.push(file);
      }
    }
    if (touched) basis.push(level);
  };

  takeLevel('declared', i?.declared);
  takeLevel('expectations', i?.expectations);
  const nodePath = normText(i?.nodePath);
  if (nodePath) {
    if (!seenFile.has(nodePath)) {
      seenFile.add(nodePath);
      files.push(nodePath);
    }
    basis.push('node-path');
  }

  return { basis, symbols: symbols.sort(compareSymbols), files: files.sort(compareText), decidedBy: 'read-set' };
}
