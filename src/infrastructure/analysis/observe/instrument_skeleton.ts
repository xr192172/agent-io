/**
 * observe · 插桩**骨架**（语言无关）—— 2026-10-15 立。
 *
 * ## 为什么立它（本笔的目的）
 * `instrument.ts`（TS 侧）与 `observe-lang-go/internal/instrument/instrument.go` 各写了一大坨
 * （1257 / 1165 行），而本仓**别的线**的语言包很小（`contract_gate/languages/`：c 41 · go 44 ·
 * java 58 · cs 59 · py 68 · ts 75 行）。⇒ 本文件把那两坨里**语言无关**的部分抽成一件，
 * 语言包只留少量钩子 —— 形状照抄本仓既有范式（`contract_gate/languages/registry.ts`：
 * `LanguagePack` 接口 + 注册表）。
 *
 * ## 骨架里有哪几格（语言无关）
 *   ① **主流程**：读盘 → 幂等标记 → `parseAstRoot` → 数函数 → 算项目根/探针引用 → 收编辑
 *      → **应用编辑** → 补头部 import/标记 → 备份 → 写盘；
 *   ② **③ 应用模型**：`applyInsertions`（**分段拼接**；重叠在结构上不再可能 —— 见其头注）；
 *   ③ **落点知识**：备份目录 / 台账目录（`.agent-io/`）。
 *   ★ **不在这里**：⑤ 错误传播（`reportProbeError`）住在**探针运行时**里（TS `probe.ts` /
 *     Python `camprobe.py`）—— 它必须与探针同编译/同解释单元，属每语言最小件（不计入语言包行数）。
 *
 * ## 语言包要提供什么（`InstrumentHooks`）
 *   两个语义钩子是**核心**（对应 TS 侧的 `detectEnclosingFunction` / `collectSites` / `handleReturn`）：
 *     ② **遍历模型** `collectSites`：给树 + 内容，产出全部编辑（内部再分 ①命名 / ⑥取值）；
 *     ① **命名规则**、⑥ **取值时机** 是实现 `collectSites` 的内部件（见 `instrument_py.ts` 的分节）。
 *   其余是**每语言必需的语法/位置管道**（不同语言无法共用）：
 *     `markers`（幂等标记串）· `comment`（标记注释前缀）· `probeImport`（探针模块引用）·
 *     `buildImportStmt`（头部 import 语句）· `inferProjectRoot`（路标文件向上找根）· `countFunctions`。
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAstRoot } from '../../parse/kernel.js';
// ★ 这四件**类型**住在 `instrument.ts`（TS 侧的历史落点，其它模块按 `./instrument.js` 取它）
//   ⇒ 这里**只 import type**（编译后擦除，**不产生运行时环**）—— 同一件事**不写第二份**
//   （本仓头号病根是"判据住两处"；类型同理）。
import type {
  InstrumentFileResult,
  InstrumentOptions,
  InstrumentedSite,
} from './instrument.js';

/**
 * 强类型节点接口：tree-sitter 节点原生携带 startIndex/endIndex（字符偏移），
 * kernel 的 SyntaxNodeLike 只标了可选，这里断言为必填以支持文本注入。
 */
export interface AstNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  childCount: number;
  child(i: number): AstNode | null;
  childForFieldName?(name: string): AstNode | null;
}

/** 将 kernel 节点断言为强类型节点（tree-sitter 保证字段齐全） */
export function asNode(n: unknown): AstNode {
  return n as AstNode;
}

/** 一次编辑：`[index, removeTo)` 被替换（无 `removeTo` 则是在 `index` 处纯插入）。 */
export type Insertion = { index: number; removeTo?: number; site: InstrumentedSite };

/**
 * ★★★ **把「按原文偏移逐次应用」重写成「分段拼接」** —— 重叠在结构上不再可能。
 *
 * 老模型是「按 `index` 降序，逐条 `out = out.slice(0,index) + injected + out.slice(removeTo)`」，
 * 它**默认所有编辑互不重叠**。而该假设**不成立**（实测三次：同 offset 插入 vs 替换 ⇒ `captureProbe(`
 * 被吃成 `reProbe(`；包含关系 ⇒ 同样吃字符；同 offset 插入 vs 插入 ⇒ 事件顺序反转）。
 * ⇒ 新模型一次从前往后扫，把原文切段、逐段输出：
 *   · **纯插入** ⇒ 在 `index` 处塞进文本，原文继续；
 *   · **替换** ⇒ 该段原文交给 `site.template(inner)`，`inner` = 区间原文【先经过区间内其它编辑处理】后的文本。
 * ⇒ 于是「区间内含其它编辑」**不再是异常**，而是**正常的一层递归**（内联探针与 `ret` 不再二选一）。
 * ★ 同 `index` 定序：**纯插入(0) 排在替换(1) 之前** ⇒ `enter` 落在改写后的 `return` **之前**。
 */
export function applyInsertions(content: string, insertions: Insertion[]): string {
  const sorted = [...insertions].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    const ar = a.removeTo === undefined ? 0 : 1;
    const br = b.removeTo === undefined ? 0 : 1;
    return ar - br;
  });

  /** 渲染原文 `[from, to)`，其中 `list` 是落在这个区间内的编辑（已升序）。 */
  const render = (from: number, to: number, list: Insertion[]): string => {
    let out = '';
    let pos = from;
    let i = 0;
    while (i < list.length) {
      const ins = list[i];
      if (ins.index < pos) {
        i++;
        continue; // 防御：理论上不会发生（区间内的都归到内层递归了）
      }
      if (ins.index >= to) break;
      const rTo = ins.removeTo ?? ins.index;
      out += content.slice(pos, ins.index);
      if (ins.removeTo === undefined) {
        out += ins.site.injected;
        pos = ins.index;
        i++;
        continue;
      }
      // 替换：区间内的其它编辑**先作用在区间原文上**（递归），结果再喂给模板
      const inner: Insertion[] = [];
      for (let j = i + 1; j < list.length && list[j].index < rTo; j++) inner.push(list[j]);
      const innerText = inner.length > 0 ? render(ins.index, rTo, inner) : content.slice(ins.index, rTo);
      out += ins.site.template ? ins.site.template(innerText) : ins.site.injected;
      // ★★★ 2026-10-15：**先推进 i，再跳过区间内的**（`do…while` 而不是 `while`）。
      //   病（Python 侧实测踩到）：当 `rTo === ins.index`（**空区间替换**）时，原 `while` 条件
      //   `list[i].index < rTo` 一开始就为假 ⇒ **i 永不前进** ⇒ 同一条编辑被反复应用
      //   ⇒ `RangeError: Invalid string length`（字符串无限增长）。TS 侧之所以没露头：
      //   它的替换区间**总非空**（`return <expr>;` 的 `;` 让 removeTo > index）；
      //   而 Python 的 `return <expr>` **没有分号** ⇒ `removeTo === index` ⇒ 立刻踩中。
      //   ⇒ 空区间替换与"纯插入"在应用层等价，这里只是保证**一定推进**。
      do {
        i++;
      } while (i < list.length && list[i].index < rTo);
      pos = rTo;
    }
    out += content.slice(pos, to);
    return out;
  };

  return render(0, content.length, sorted);
}

/** 前缀插入且兼容 shebang：若 content 首行是 `#!...`，把 head 插到首行之后（保住 shebang 在行 1）。 */
export function prependAfterShebang(content: string, head: string): string {
  if (!content.startsWith('#!')) return head + content;
  const nl = content.indexOf('\n');
  if (nl < 0) return content + '\n' + head;
  return content.slice(0, nl + 1) + head + content.slice(nl + 1);
}

/** `collectSites` / `collectDeepSites` 的入参（语言包据此产出编辑）。 */
export interface CollectSitesCtx {
  root: AstNode;
  file: string;
  content: string;
  /** 文件相对项目根的 posix 路径（探针 fields.file 用它）。 */
  fileRel: string;
  /** 契约模式探针清单（undefined = 探索模式全量）。 */
  probes?: string[];
  /** scope 模式（调用树录制）；语言包不支持时忽略。 */
  scope: boolean;
  /** 语言包把编辑 push 到这里。 */
  insertions: Insertion[];
}

/**
 * 一门语言的插桩钩子。★ 加一门语言 = 写一个本接口的实现 + 在注册表加一行，
 * 主流程（`instrumentFileWithHooks`）**一行都不用改**。
 */
export interface InstrumentHooks {
  /** 语言 id（注册唯一 key） */
  lang: string;
  /** 幂等标记：core 与 deep 各一串（写在文件头注释里）。 */
  markers: { core: string; deep: string };
  /** 注释前缀（标记行用它拼；TS/JS `//`，Python `#`）。 */
  comment: string;
  /** 探针模块引用（写进报告 `probeImport` 字段；TS = 相对 `dist/.../probe.js` 的说明符）。 */
  probeImport(file: string, projectRoot: string): string;
  /** 从文件向上找项目根（路标 = 探针实现文件）；找不到**响亮抛**，不静默兜底。 */
  inferProjectRoot(file: string): string;
  /** 头部 import 语句（语言语法不同：`import … from` / `const {…}=require` / `from … import …`）。 */
  buildImportStmt(probeImport: string, content: string, file: string): string;
  /** 数函数节点（台账判据③用；语言包的 FN_TYPES 口径）。 */
  countFunctions(root: AstNode): number;
  /**
   * ★ ② **遍历模型**（内部再分 ①命名 / ⑥取值）：产出一个文件内全部插桩编辑。
   * 语言包在这里做它自己的 AST 遍历与探针文本渲染。
   */
  collectSites(ctx: CollectSitesCtx): void;
  /** 可选的 deep 级插桩（TS 有；不支持的语言不实现）。 */
  collectDeepSites?(ctx: CollectSitesCtx): void;
}

/** 备份目录名（相对被插桩项目根，位于 .agent-io 下）。 */
export const BACKUP_DIR = '.agent-io/observe-backup';

/** 备份文件名：把原文件相对项目根（backupRoot）的路径映射为备份目录下的镜像路径 */
export function backupPathFor(backupRoot: string, file: string): string {
  const rel = path.relative(backupRoot, file).replaceAll('\\', '/');
  return path.join(backupRoot, BACKUP_DIR, rel);
}

/** 原文件写盘前，若尚无备份则把当前内容备份到 .agent-io/observe-backup */
export function backupOriginal(backupRoot: string, file: string, content: string): void {
  const dest = backupPathFor(backupRoot, file);
  if (fs.existsSync(dest)) return; // 已备份过则保留最早的原版
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf-8');
}

/**
 * ★ **骨架主流程**：对单个文件插桩（语言无关）。语言包只提供钩子。
 *
 * 顺序与 `instrument.ts` 原实现**逐字一致**（本函数即从它抽出）：
 *   读盘 → 幂等标记 → 解析 → 数函数 → 算项目根/探针引用 → `collectSites` → `applyInsertions`
 *   → 补头部 import/标记（shebang 兼容）→ 备份 → 写盘。
 */
export async function instrumentFileWithHooks(
  file: string,
  hooks: InstrumentHooks,
  opts: InstrumentOptions = {},
): Promise<InstrumentFileResult> {
  const applyWrite = opts.write ?? true;
  const enableDeep = opts.enableDeep ?? false;
  const result: InstrumentFileResult = { file, sites: [] };
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    result.error = (e as Error).message;
    return result;
  }

  // 幂等：按标记判断该文件已注入哪些级别的探针，避免重复。
  const hasCore = content.includes(hooks.markers.core);
  const hasDeep = content.includes(hooks.markers.deep);
  if ((hasCore && !enableDeep) || (hasCore && hasDeep)) return result;

  const parsed = await parseAstRoot(file, content);
  if (!parsed) {
    result.error = '解析失败（语言包不支持或语法错误）';
    return result;
  }
  const root = asNode(parsed.root);
  // ★ 必须在 `insertions.length === 0` 的早退**之前**算：0 探针文件正是要记账的那批。
  result.functions = hooks.countFunctions(root);

  const projectRoot = opts.projectRoot ?? hooks.inferProjectRoot(file);
  const probeImport = opts.probeImport ?? hooks.probeImport(file, projectRoot);
  result.probeImport = probeImport;
  // 探针注入时附带的文件相对路径（相对项目根，正斜杠），供日志按文件过滤
  const fileRel = path.relative(projectRoot, file).replaceAll('\\', '/');

  const insertions: Insertion[] = [];
  const probes = opts.contractProbes;
  if (!hasCore) {
    hooks.collectSites({ root, file, content, fileRel, probes, scope: opts.scope === true, insertions });
  }
  if (enableDeep && !hasDeep && hooks.collectDeepSites) {
    hooks.collectDeepSites({ root, file, content, fileRel, probes, scope: opts.scope === true, insertions });
  }

  if (insertions.length === 0) return result;

  const importStmt = hooks.buildImportStmt(probeImport, content, file);

  // ★ `let`（不是 const）：下面还要补 import/标记头
  let out = applyInsertions(content, insertions);
  // 头部补 import 与分级标记（shebang 兼容：shebang 必须留在文件首行）
  // scope 模式走 globalThis.__probeScope，无需每文件 import 探针 → 不注入 importStmt
  let head = '';
  if (!hasCore) head += (opts.scope === true ? '' : importStmt) + `${hooks.comment} ${hooks.markers.core}\n`;
  if (enableDeep && !hasDeep) head += `${hooks.comment} ${hooks.markers.deep}\n`;
  if (head) out = prependAfterShebang(out, head);

  result.sites = insertions.map((i) => i.site);
  if (applyWrite) {
    // 写盘前先备份原文件（幂等：已备份则保留最早原版），供 --uninstrument 一键还原
    const backupRoot = opts.backupRoot ?? projectRoot;
    backupOriginal(backupRoot, file, content);
    fs.writeFileSync(file, out, 'utf-8');
  }
  return result;
}
