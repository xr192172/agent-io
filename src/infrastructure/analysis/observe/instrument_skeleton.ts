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
 *     `buildImportStmt`（头部 import 语句）· `packageDeclNode`（head 落点：package 声明之后）。
 *
 * ## ★★ 2026-10-15 第二笔：把「项目级四件」也收进骨架（本笔）
 * 上一笔只抽走了**单文件**的主流程；**项目级**那几件（收文件 / 数函数 / 向上找根 / 逐文件循环）
 * 仍被 TS 与 Python **各抄了一份**（结构逐字相同，只差一处数据）。本笔搬进骨架：
 *   · `collectSourceFiles`（遍历 + 跳过表住一份）· `countFunctionNodes`（按 `fnTypes` 递归）
 *   · `inferProjectRootByMarker`（含 T265 的「找不到就响亮抛」）· `instrumentProjectWithHooks`
 *   · `matchesContract`（三行的契约门，也曾各写一份）
 * ⇒ 两个「钩子」随之**降级为数据**：`inferProjectRoot(file)` → `rootMarker: string`，
 *   `countFunctions(root)` → `fnTypes: ReadonlySet<string>`。
 *   ★ 判据：**凡是"两份实现只差一处数据"的，就不该是钩子，该是数据** —— 钩子要求每个语言包
 *     重写一遍逻辑（抄错的机会 ×N），数据只要求它填一个值。
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAstRoot } from '../../parse/kernel.js';
import { skipDirSet } from '../../parse/source_exts.js';
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
 * 契约门：探针名是否命中契约列表。
 *   · `probes === undefined` ⇒ 探索模式，**恒 true**（全量无脑插桩）；
 *   · 否则**精确匹配**（契约模式）。
 *
 * ★ 骨架件（2026-10-15 从 `instrument.ts` 搬来）：搬之前 TS 与 Python **各写了一份逐字相同的**
 *   实现（`instrument.ts:167` / `instrument_py.ts:303`）—— 判据住两处就是本仓头号病根，
 *   哪怕它只有三行。
 */
export function matchesContract(probeName: string, probes?: string[]): boolean {
  if (probes === undefined) return true;
  return probes.includes(probeName);
}

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

/**
 * ★ ⑦ 引用方式的**落点偏移**（2026-10-15 v2）：文件里有 `packageDeclNode` 节点 ⇒ 返回它的 **endIndex**
 * （head 落在 package 声明**之后** —— Java 语法：import 必须在 package 之后）；
 * 没填或文件里没有该节点 ⇒ 0（落文件头，走 `prependAfterShebang`）。
 *
 * ★ 为什么直接拿 endIndex 当插入点就是对的：package 声明是文件第一条语句，**在任何函数体之前**
 *   ⇒ 该偏移不受 `collectSites` 产出的任何编辑影响；且 `applyInsertions` 按**原文偏移**拼接
 *   ⇒ 偏移语义与原 insertions 一致，不需要任何换算。
 */
export function headOffset(root: AstNode, packageDeclNode?: string): number {
  if (packageDeclNode) {
    for (let i = 0; i < root.childCount; i++) {
      const c = root.child(i);
      if (c && c.type === packageDeclNode) return c.endIndex;
    }
  }
  return 0;
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
  /**
   * ★ 单文件【硬失败】通道（2026-10-15 加，Java 打包文件用）：语言包发现"这个文件形态插不了"
   *   （如 Java 打包文件里的默认包探针永远解析不了）时调它 ⇒ 记进 `result.error`、**不写盘**、不静默跳过一个字。
   *   ★ 为什么不是 throw：throw 会让整个运行中断，而**之前的文件已经写盘** ⇒ 留下半插桩项目（T315 同族的教训）。
   */
  fail?: (message: string) => void;
}

// ─────────────────────────────────────────────────────────────
// 跨语言共享的【判据】（原 TS / Python 各有一份 ⇒ 收到这里，只住一处）
// ─────────────────────────────────────────────────────────────

/**
 * `return` 是否是某控制语句的【无花括号单语句体】（如 `if (c) return 1;` / `else return 2;` / `for (…) return;`）。
 *
 * ★ 这种位置【不能做两段法改写】（`T = expr; probe; return T` 三句）：
 *   ① 赋值/声明语句不能当控制语句的单语句体 ⇒ 语法错（`if (c) T = 1` 非法）；
 *   ② 硬插的话，探针与 return 会**逃逸成无条件执行** ⇒ **静默改宿主行为**（T273）。
 *   ⇒ 调用方必须【包成块】：`if (c) { T = expr; probe; return T; }`（T273/T276）。
 *
 * ★ 判据**只看直接父节点**是不是控制语句：tree-sitter 的父节点即直接父 ⇒
 *   块体内的 return 父节点是那个块，到不了这里；反之父节点是控制语句 ⇒ return 就是它的体。
 *   ★★ **别加"父节点有没有块子节点"的判断** —— `if (c) return 1; else { … }` 的 then 分支
 *      父节点是 if_statement 且它**有**块子节点（else 块），加了的会把 then 分支误判为"安全" ⇒ 踩回 T273。
 *
 * @param guardTypes 该语言的控制语句节点类型表（**每语言不同**：TS 有 `else_clause` 节点；
 *   tree-sitter-java **没有** —— else 体是 `if_statement` 的直接子节点，靠父类型一并覆盖）
 */
export function isBracelessBodyReturn(parent: AstNode | undefined, guardTypes: ReadonlySet<string>): boolean {
  return !!parent && guardTypes.has(parent.type);
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
  /**
   * ★ 项目根**路标**（相对根、posix）：从文件向上找含它的目录。
   * 找不到时由骨架**响亮抛**（见 `inferProjectRootByMarker`），不静默兜底。
   *
   * ★★ 2026-10-15 由**钩子降级为数据**：TS 与 Python 两份 `inferProjectRoot` 除路标路径
   *   与错误措辞外**逐字相同** ⇒ 留着当钩子 = 让每个语言包白抄 15 行。
   */
  rootMarker: string;
  /** 找不到路标时，错误文案里补的「怎么办」（措辞每语言不同；缺省只说"显式传 project_root"）。 */
  rootHint?: string;
  /** 头部 import 语句（语言语法不同：`import … from` / `const {…}=require` / `from … import …`）。 */
  buildImportStmt(probeImport: string, content: string, file: string): string;
  /**
   * ★ ⑦ **引用方式的落点数据**（2026-10-15 v2 新增）：package 声明节点类型
   * （Java `package_declaration`；没有 package 概念的语言不填）。
   *
   * 填了 ⇒ 头部 import/标记落在该节点**之后**（Java 语法：import 必须在 package 声明之后）；
   * 不填 ⇒ 落在文件头（`prependAfterShebang`，保住 shebang）。
   * ★ 为什么是数据不是钩子：两侧只差"落在哪"这一个事实；而落点**必须先于所有其它编辑**确定
   *   （package 声明在任何函数体之前 ⇒ 它的 endIndex 不受其它编辑影响 ⇒ 偏移恒有效）。
   */
  packageDeclNode?: string;
  /**
   * ★ 「函数」节点类型集合（台账判据③的口径）。**数据，不是钩子** —— 两侧只差这一个集合。
   * ★★ 2026-10-15 由 `countFunctions(root)` 降级：那个钩子的两份实现是同一个递归。
   */
  fnTypes: ReadonlySet<string>;
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
  result.functions = countFunctionNodes(root, hooks.fnTypes);

  const projectRoot = opts.projectRoot ?? inferProjectRootByMarker(file, hooks.rootMarker, hooks.rootHint);
  const probeImport = opts.probeImport ?? hooks.probeImport(file, projectRoot);
  result.probeImport = probeImport;
  // 探针注入时附带的文件相对路径（相对项目根，正斜杠），供日志按文件过滤
  const fileRel = path.relative(projectRoot, file).replaceAll('\\', '/');

  const insertions: Insertion[] = [];
  const probes = opts.contractProbes;
  // ★ 单文件硬失败通道：语言包发现"这文件插不了"时记下来（见 CollectSitesCtx.fail）—— 不写盘、不静默。
  let fileError: string | undefined;
  const sitesCtx: CollectSitesCtx = {
    root,
    file,
    content,
    fileRel,
    probes,
    scope: opts.scope === true,
    insertions,
    fail: (m) => {
      fileError ??= m;
    },
  };
  if (!hasCore) {
    hooks.collectSites(sitesCtx);
  }
  if (fileError) {
    result.error = fileError;
    return result;
  }
  if (enableDeep && !hasDeep && hooks.collectDeepSites) {
    hooks.collectDeepSites({ root, file, content, fileRel, probes, scope: opts.scope === true, insertions });
  }

  if (insertions.length === 0) return result;

  const importStmt = hooks.buildImportStmt(probeImport, content, file);

  // 头部补 import 与分级标记（shebang 兼容：shebang 必须留在文件首行）
  // scope 模式走 globalThis.__probeScope，无需每文件 import 探针 → 不注入 importStmt
  let head = '';
  if (!hasCore) head += (opts.scope === true ? '' : importStmt) + `${hooks.comment} ${hooks.markers.core}\n`;
  if (enableDeep && !hasDeep) head += `${hooks.comment} ${hooks.markers.deep}\n`;

  // ★ ⑦ 引用方式的落点（2026-10-15 v2）：填了 `packageDeclNode` 且文件真有该节点
  //   （如 Java 的 package 声明）⇒ head 作为一条**纯插入**参与分段拼接，落在 package 声明之后
  //   （Java 语法：import 必须在 package 之后；package 声明在任何函数体之前 ⇒ 该偏移恒有效）。
  //   否则落文件头（`prependAfterShebang`）。
  //   ★ head **不是探针点** ⇒ 从 `insertions`（原表）映射 result.sites，不混进台账。
  const headAt = head ? headOffset(root, hooks.packageDeclNode) : 0;
  const all: Insertion[] =
    headAt > 0
      ? [
          ...insertions,
          {
            index: headAt,
            site: { probe: 'observe:head', file, line: 0, kind: 'enter', level: 'core', injected: `\n${head}` },
          },
        ]
      : insertions;
  let out = applyInsertions(content, all);
  if (head && headAt === 0) out = prependAfterShebang(out, head);

  result.sites = insertions.map((i) => i.site);
  if (applyWrite) {
    // 写盘前先备份原文件（幂等：已备份则保留最早原版），供 --uninstrument 一键还原
    const backupRoot = opts.backupRoot ?? projectRoot;
    backupOriginal(backupRoot, file, content);
    fs.writeFileSync(file, out, 'utf-8');
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 语言无关的「项目级」四件（2026-10-15 从 TS / Python 两份实现里搬来）
//
// ★ 为什么它们该在骨架里：搬之前，TS 与 Python **各写了一份**，且**逐字/结构相同**，
//   只差一处数据（扩展名 / 路标 / 集合）。留着当钩子 ⇒ 每个新语言包白抄 ~55 行。
// ★ 它们是「同一件事住两处」的典型样本：同一份 `inferProjectRoot` 的**错误文案**
//   都各写了一遍 —— 改一处必漏另一处（本仓反复踩过）。
// ─────────────────────────────────────────────────────────────

/**
 * 数「函数」节点（台账判据③用）：按语言给的 `fnTypes` 递归数，**含嵌套**。
 *
 * ★ 只数 `fnTypes` 里的那几类 —— 无体的签名（`declare function` / `abstract foo():void`）
 *   不是函数节点 ⇒ 天然不算（那些文件本就该 0 探针）。
 */
export function countFunctionNodes(root: AstNode, fnTypes: ReadonlySet<string>): number {
  let c = fnTypes.has(root.type) ? 1 : 0;
  for (let i = 0; i < root.childCount; i++) {
    const ch = root.child(i);
    if (ch) c += countFunctionNodes(ch, fnTypes);
  }
  return c;
}

/**
 * 递归收集项目下所有可插桩源文件（跳过 `node_modules` / `dist` / `.git` / `.agent-io` 等）。
 *
 * ★ `isInstrumentable` 是**谓词注入**（不是让语言包重写整个遍历）：
 *   语言包只回答「这个文件名算不算我的源文件」，遍历与跳过表**只住这里一份**。
 */
export function collectSourceFiles(root: string, isInstrumentable: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const skip = skipDirSet([]);
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && isInstrumentable(e.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * 从被插桩文件**向上**找项目根（路标 = `markerRel`，posix 相对路径）。
 *
 * ★★★ **找不到路标时【响亮抛】，绝不静默退回文件目录。**
 *   实测病（T265，不传 `project_root` 时）：旧写法 `return path.dirname(file)`
 *   ⇒ 生成的 import 变成 `./dist/src/…/probe.js`（指进**被测项目自己**）
 *   ⇒ `tsc: error TS2307 Cannot find module` / 运行 `ERR_MODULE_NOT_FOUND`
 *   ⇒ ★ **缺一个参数却静默产出一份跑不起来的代码**，正是本仓最反对的形态。
 *   ⇒ 宁可停下并告诉调用方"**该显式传 `project_root`**"，也不插坏用户源码。
 */
export function inferProjectRootByMarker(file: string, markerRel: string, hint?: string): string {
  const marker = path.join(...markerRel.split('/'));
  let dir = path.dirname(file);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `推断不出项目根：从 ${file} 向上 8 层都没找到路标 \`${markerRel}\` ⇒ 无法算出探针模块的位置。\n` +
      (hint ??
        `★ 请**显式传** \`project_root\`（= agent-io 仓库根）。\n` +
          `★ 这里【故意不兜底】：兜底会生成一个指进被测项目自己的 import，表面成功、实际跑不起来。`),
  );
}

/**
 * 对整个项目插桩：收文件 → 逐文件跑骨架主流程 → 汇总结果。
 *
 * ★ `backupRoot` 固定为被插桩项目根（与 `projectRoot` 无关：后者用于算 probe import）
 *   —— 这条口径两侧也各写过一遍，现在只住这里。
 */
export async function instrumentProjectWithHooks(
  root: string,
  hooks: InstrumentHooks,
  isInstrumentable: (rel: string) => boolean,
  opts: InstrumentOptions = {},
): Promise<InstrumentFileResult[]> {
  const files = collectSourceFiles(root, isInstrumentable);
  const perFileOpts: InstrumentOptions = { ...opts, backupRoot: root };
  const results: InstrumentFileResult[] = [];
  for (const f of files) {
    results.push(await instrumentFileWithHooks(f, hooks, perFileOpts));
  }
  return results;
}
