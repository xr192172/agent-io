/**
 * edit_code：符号级语义编辑（Agent 第一性编辑路径）
 *
 * 设计动机（2026-08-18 狗食结论）：AI 用 old_string 文本匹配改代码，
 * 行号漂移 / 同名函数 / 相似代码块都会改错位置。既然 ts_kernel 已能
 * 定位"哪个文件、哪个函数、第几行、什么签名"，编辑也应按符号定位：
 * AI 只给 文件 + 符号名 + 新代码，工具重新解析当前文件、按 AST 符号
 * 边界替换——不信 AI 的行号，不信 AI 的 old_string。
 *
 * 安全设计：
 * - 替换后 re-parse 整个文件，解析失败 → 报错不写盘（防缩进/括号破坏）
 * - replace 的新代码必须解析出同名符号（防粘贴错函数）
 * - 同名多候选 → 报错列出候选（签名+行号），AI 传 parent 消歧后重试
 * - 写盘后自动 syncFile 重建该文件索引（新鲜度闭环：编辑即索引更新）
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 落盘形态：**有意保留的第三份**（2026-09-29 判定 —— 勿再"顺手统一"）
 * ─────────────────────────────────────────────────────────────
 * 本文件的落盘是内联四件套 `snapshotBeforeWrite → writeFileSync → syncFile → reopenAndResolveAfterWrite`，
 * **没有**走 `tools/apply_writes.ts` 的 `applyWrites()`（= `write_gate.writeSourceFiles` 的适配层）。
 * 第一刀（`b6e5647`）把它登记为"下一笔候选，请人拍板"；本笔拍板 = **保留**，判据是**实测**出的
 * 四条政策差异（不是"懒得改"，也不是"看着统一"）：
 *
 * 1. **索引政策相反**：本文件 =「编辑即建索引」——`syncFile(getProjectCacheDb(...))` 在**没有索引**的
 *    项目里会就地建库并同步该文件（`edit_code.test.ts`「未预热…编辑后索引已建立」锁定此行为）。
 *    而 `applyWrites` 继承 `write_gate` 的纪律「**绝不因为一次编辑就凭空建索引**」（`write_gate.ts:42`：
 *    否则会造出"只有这几个文件"的半成品索引）。两条政策**相互否定** ⇒ 合并 = 单方面推翻一条，不是内化。
 * 2. **目录创建**：`op='insert'` 建新文件会 `mkdirSync(dirname, {recursive:true})`
 *    （`edit_code.test.ts`「insert 创建新文件」走的正是尚不存在的 `src/`）；`applyWrites` 不建目录（实测 `ENOENT`）。
 * 3. **根外文件**：本文件对 `project_dir` 之外的目标**照写**（实测写盘成功）；`applyWrites`
 *    **拒绝落盘**并进 `blocked`（`ok=false`）。
 * 4. **快照时机**：本文件在**编辑前**（校验之前）就快照 ⇒ 被拒绝的编辑也留一份撤回点（实测）；
 *    `applyWrites` 只在**真要写**的那一刻快照。
 *
 * ★ 而"**逐文件**快照"这条 —— 当初被当成理由的差异 —— **实测证不出必要性**（本笔的判断题）：
 *   · 判据场景「批量改 3 文件、第 2 个失败、第 1 个必须能单独撤回」：现状**能**（`snapshot(action="list")` 找到
 *     该文件的快照 id → `snapshot(action="rollback")`）；
 *   · 「**一次**快照含全部文件」**也能**做到同样的事（`rollbackFileSnapshot` 支持 `file` 过滤）；
 *   · 反向：逐文件粒度**做不到**"整批一次撤回"（`rollback latest` 只回到最后一个被写的文件）。
 *   ⇒ 快照粒度**不是**能力差异，也**不是**本文件不能并入 `applyWrites` 的原因；真正原因是上面那 4 条政策。
 *   （下一步若要动：先由人拍板"索引政策以哪条为准"，再谈合并。详见
 *    `docs/architecture-refactor-plan.md` §31）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFileFull, parseAstRoot, type ParsedSymbol } from '../../../infrastructure/parse/index.js';
import { syncFile } from '../../../infrastructure/index/symbols.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { splitKeepEnds, detectEol, isBlankLine } from '../../../infrastructure/text/line_utils.js';
import { snapshotBeforeWrite } from '../snapshot/file_snapshot.js';
import { assertSourceWriteRegistered, reopenAndResolveAfterWrite, reopenNote, resolveActor, exemptionLines, type GateExemption } from '../../write_gate.js';
// ★★ 2026-10-22：落盘改走**唯一写原语**（`openSourceWrite` 事务：整批判一次闸 + 一份写前快照 + 逐文件 commit）。
//   ★★ 2026-10-28（T-#RP-3）：**已改为调 `close()`**（唯一收尾）—— 原来"走自己的 `syncFile`"的两条收尾已合一；
//     `close()` 里的『登记自写 + 写穿 + 基线刷新』是给没有 async 索引通道的同步写路的替代品。
// ★★★ 2026-10-23（澄清一处误判）：有人说「self-writes.json 自 10-13 起就是空的 ⇒ recordSelfWrite 没接到 edit_code」。
//   **那不是缺陷，是设计**：① 本文件逐分支 `txn.commit()` 落盘后立刻 `await syncFile(...)`（:587/652/712/758/916/1076），
//   索引当场就新了 ⇒ 不需要「待消费登记」；② `pendingSelfWrites` 自带 TTL（`now - at >= SELF_WRITE_TTL_MS ⇒ skip`）
//   ⇒ 旧记录自动过期，不会产生假信号。⇒ 别为了「让它看起来接上了」去调 close()（那会多建一次索引）。
import { openSourceWrite, type SourceWriteTxn, type SourceWriteReceipt } from '../../source_writer.js';
// ★ 2026-10-28（T150）：纯函数住 domain（零依赖 ⇒ 判据执行核可加载）
import { planBatchDiffReport } from '../../../domain/batch_diff.js';
// ★ 2026-10-28（T245）：计划读数（出口闭环 / 画布新陈代谢）的**唯一渲染器**住 write_gate，本文件只调用
import { renderPlanReadings } from '../../write_gate.js';
// ★★★ P0 保鲜链第 1 环（2026-10-26）：**新建文件自动提议入册**。
//   W0 实测：op=insert 在盘上新建的文件不在设计册 semantic.files ⇒ 判据/对账全覆盖不到，
//   而这件事没有任何机制报出。⇒ 落盘后查一次册（只警告、不自动入册 —— 入册要带
//   responsibility 意图，自动插会造空壳节点），判据唯一住处 = `design/ledger_membership.ts`。
import { newFileLedgerWarning } from '../../design/ledger_membership.js';
// ★★★ 2026-10-21（并发控制·读集比对）：回执里的**假设检定**（与 `task_gate` 两件事）。
//   ★ 判定在写闸（`write_gate` 是唯一判据处），这里只**带出**读数 + 写后刷新写者自己的基线。
import { assumptionLines, refreshAfterOwnWrite, type AssumptionCheck } from '../../read_set.js';
import { toIndexKey } from '../../../infrastructure/index/symbols.js';
// ★ 2026-10-28：出口闭环的一行读数（判据唯一实现在 plan_exit_check.ts，这里只调用）
import { readRewritePlan } from '../../design/db/rewrite_plan.js';

import {
  locateReplaceText,
  realignNewTextTo,
  FUZZY_LEVEL_LABEL,
  classifyReplaceTextMiss,
  classifyReplaceTextApply,
  type ReplaceTextAppliedHow,
} from '../../../infrastructure/parse/fuzzy_match.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';
// ★ 语法门的**判据与文案**唯一住处（`src/domain/syntax_gate.ts`）：本文件只负责取 AST 读数。
//   把三态折成一个 boolean（旧 `hasSyntaxError`）正是「.txt 永远 ✓ 落盘」的病根 —— 0.12。
import { judgeSyntaxGate, SYNTAX_BLOCK_HEAD, type SyntaxProbe } from '../../../domain/syntax_gate.js';

export type EditCodeOp = 'replace' | 'insert' | 'delete' | 'range' | 'replace_text';

export interface EditCodeArgs {
  /** 项目根目录（索引归属，编辑后重建该文件的 cache.db 索引） */
  project_dir: string;
  /** 目标文件（相对 project_dir 或绝对路径） */
  file: string;
  op: EditCodeOp;
  /**
   * 目标符号。replace/delete：按 qualified_name 优先、短名兜底匹配；
   * insert：插入到该符号之后（缺省 = 文件末尾）。
   * Go 方法用短名 + parent（receiver 类型）消歧。
   */
  symbol?: string;
  /** 符号父级（类名 / Go receiver 类型名），同名消歧用 */
  parent?: string;
  /** replace/insert 的新代码（完整符号定义；delete 不需要；range=区间新内容，传空串删除区间） */
  code?: string;
  /** op='range' 专用：1-based 含端点的起始行（行号随时漂移前由调用方先读文件确认） */
  start?: number;
  /** op='range' 专用：1-based 含端点的结束行 */
  end?: number;
  /** 所有 op 支持：true=只出 diff 预览 + 语法门结果，不写盘、不改索引 */
  dry_run?: boolean;
  /** op='range' 专用：true=区间穿透只报符号计数、不展开明细列表（减少视觉噪声） */
  quiet?: boolean;
  /** op='replace_text' 专用：要替换的旧文本（在文件中须恰好出现 1 次，否则报歧义） */
  old_text?: string;
  /** op='replace_text' 专用：替换后的新文本 */
  new_text?: string;
  /** op='replace' 专用：sub='body' 时只替换函数/方法体（code 只给新 body 内容，免自包含/签名） */
  sub?: string;
  /**
   * ★ P-B（规划书 §16.2）批量模式：一次调用对**多个文件**做 replace_text（每项 = 文件内的一次唯一文本替换）。
   * 给了非空 `targets` ⇒ 走批量（此时忽略 file/op/symbol/code/old_text/new_text）。
   * 逐项**独立回报**（每项 ok/hit/error 各自独立），一项失败不影响其余（除非 atomic=true）。
   */
  targets?: Array<{ file: string; old_text: string; new_text: string }>;
  /**
   * ★ P-B 原子性（仅 `targets` 批量有效）：true ⇒ 任一项失败则**整批不落盘**（全成或全不成）；
   * 缺省/false ⇒ **逐项独立**（失败项红、其余照常落盘）。dry_run 天然不落盘，与 atomic 无关。
   * ★★★ 2026-11-01（第二轮外审 P0-1）：「全成或全不成」**覆盖两个阶段** ——
   * ① 规划阶段（`blockedByAtomic`：任一项定位/语法门失败 ⇒ 一个字节都不写）；
   * ② **落盘阶段**（第 N 个文件写失败 ⇒ 用同一份写前快照整批回滚，逐字节回到改动前）。
   * 改前只有 ①：②里半写、`close()` 不跑、异常裸抛**连回执都没有**（外审已实测复现）。
   * 回执读法：`rolled_back:true` + `applied:[]` = 整笔未生效；`rollback.failed` 非空 = 回滚不全。
   */
  atomic?: boolean;
  /**
   * ★★★ 2026-10-20（A7 逐调用自报）：**本次写入是谁**（与 claim 时的 `data.owner` **同一个值**）。
   * ★ 不传 ⇒ 落回 `AGENT_IO_ACTOR` ⇒ 都没有就"提醒 + 放行"（闸的现有行为，`AGENT_IO_ACTOR_STRICT=1` 才会改拒）。
   * ★ 它是 `server_registry#invokeTool` 的**保留键**（不写在这里的工具 schema 也能传 —— 那是 loose object）。
   */
  actor?: string;
  /**
   * ★★★ T356（2026-10-20）：「**按 run 授权**」（`authorize`）—— 一个 scope 一次授权一批文件。
   * ★ 与 `actor` 一样是 `server_registry#invokeTool` 的**保留键**（本工具 schema 不声明它也能传）。
   * ★ 判据**只住一处**：`write_gate#evaluateRunAuthorize`（本层只做透传，**不在这里解读 scope**）。
   * ★★ 批量路径（`targets[]`）与单文件路径**同一个闸、同一个传法** —— 不允许"批量认、单文件不认"。
   */
  authorize?: string;
  /**
   * ★★★ 2026-10-30（租约 fencing）：你手上这一代写权（`claim` 回执里的 `lease_generation`）。
   * ★ **不传 ⇒ 不校验**（老 CLI / 老脚本照常跑）；传了而卡上代数已变大 ⇒ `E-WRITE-004`（已被接管）。
   */
  lease_generation?: number;
}

/** ★ P-B：批量模式**逐项**回报（`targets[]` 专用；一项一条） */
export interface EditBatchItem {
  /** 目标文件（相对 project_dir 的路径，展示口径） */
  file: string;
  /** 该项是否成功（干跑成功也算 true —— 看 written 区分是否落盘） */
  ok: boolean;
  /** 该项是否**真的落盘**（dry_run=true / 原子性回退 ⇒ false） */
  written: boolean;
  /** replace_text 命中位置与级别 */
  hit?: { level: number; label: string; start_line: number; old_lines: number; new_lines: number };
  /** 该文件本次落盘的符号 diff（同一文件多项时按文件级归属） */
  symbol_diff?: { added: number; removed: number; changed: number };
  /** 该文件本次落盘后索引同步状态 */
  index_synced?: string;
  /** ★ 2026-10-20：**空操作**（该项替换后内容未变）—— 未写盘、未重建索引 */
  no_op?: boolean;
  /**
   * ★★★ 2026-11-02：**该项已应用过**（同一条 `targets[]` 重跑的第二遍）—— 未写盘、未重建索引、未进写闸。
   * ★ 与 `no_op` 是**两件事**：`no_op` = 这次替换本身没改变内容；本字段 = 目标状态**上一次就已经在盘上**。
   */
  already_applied?: { line: number; how: ReplaceTextAppliedHow };
  /** ★ 语法门读数（基线脏 / 无解析器）：不拦，但**逐项**点名 —— 不跨项混 */
  warnings?: string[];
  /** 失败原因（ok=false 时必有） */
  error?: string;
}

interface LineOp {
  startIdx: number; // 0-based 半开区间起点
  count: number; // 删除行数
  insert: string[]; // 插入行（含终止符）
}

/** 新代码规范化为文件行尾风格，每行带终止符 */
/** 新代码规范化为文件行尾风格，每行带终止符（末尾空元素先丢弃——由调用方决定是否补空行） */
function normalizeCode(code: string, eol: string): string[] {
  const normalized = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((l) => l + eol);
}

/** tree-sitter 节点最小面（只读「是不是错误恢复节点 / 子节点」—— 不碰 text，省一次 substring） */
interface ErrWalkNode {
  type: string;
  isMissing?: boolean;
  childCount: number;
  child(index: number): ErrWalkNode | null;
}

/** 数 tree-sitter 的错误恢复节点（`ERROR` / MISSING）。**栈**而非递归：大文件不爆调用栈。 */
function countErrorNodes(root: unknown): number {
  const stack: ErrWalkNode[] = [root as ErrWalkNode];
  let n = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'ERROR' || node.isMissing === true) n += 1;
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }
  return n;
}

/**
 * 语法探针（★ 唯一读法）：`parseAstRoot` 回 null ⇒ 该扩展名**没有解析器**（`noParser`）——
 * 这与「解析过且干净」**不是一回事**，折成 boolean 就会把「没验」读成「验过且干净」（0.12 静默假绿）。
 * 判据与文案一律不在这里 —— 见 `domain/syntax_gate.ts#judgeSyntaxGate`。
 */
async function probeSyntax(absPath: string, content: string): Promise<SyntaxProbe> {
  const ast = await parseAstRoot(absPath, content);
  if (!ast) return { noParser: true, errorCount: 0 };
  // ★ `hasError` 为真却数不到错误节点（极少见）时按 1 处计：读数不许退回 0，那会让「脏」看起来「干净」。
  return { noParser: false, errorCount: ast.root.hasError === true ? Math.max(1, countErrorNodes(ast.root)) : 0 };
}

/**
 * 语法门（★ 唯一出口）：取两侧读数 → `judgeSyntaxGate` 判 → 读数交给 `onWarning` → 该拦就抛。
 * ★ 调用方**只许经它过门**：判据与文案住在 domain（三份实现 = 三处会分叉的真相）。
 */
async function applySyntaxGate(input: {
  absPath: string;
  /** 编辑前内容（新文件传空串） */
  baseline: string;
  newContent: string;
  /** 阻塞句的尾部（各 op 自己的「请检查 …」） */
  blockHint: string;
  /** 读数出口（必须进 `data.warnings` + 人读回执） */
  onWarning: (m: string) => void;
  /** 阻塞句的头（新建文件那条措辞不同才需要传） */
  blockHead?: string;
}): Promise<{ repaired: boolean }> {
  const ext = path.extname(input.absPath) || '（无扩展名）';
  const verdict = judgeSyntaxGate(
    ext,
    await probeSyntax(input.absPath, input.baseline),
    await probeSyntax(input.absPath, input.newContent),
    input.blockHint,
    input.blockHead ?? SYNTAX_BLOCK_HEAD,
  );
  for (const w of verdict.warnings) input.onWarning(w);
  if (verdict.blocked) throw new Error(verdict.blocked);
  return { repaired: verdict.repaired };
}

/** 符号匹配：qualified_name 精确 > name 精确；parent 提供时必须相等（explore_code read 共用，保证同名/消歧口径一致） */
export function matchSymbols(symbols: ParsedSymbol[], symbol: string, parent?: string): {
  qnHits: ParsedSymbol[];
  nameHits: ParsedSymbol[];
} {
  const qnHits = symbols.filter(
    (s) => s.qualified_name === symbol && (!parent || s.parent === parent),
  );
  const nameHits = symbols.filter(
    (s) => s.name === symbol && (!parent || s.parent === parent),
  );
  return { qnHits, nameHits };
}

export function describeSymbol(s: ParsedSymbol): string {
  return `${s.qualified_name} (${s.kind}, ${s.signature || s.name}, L${s.start_line}-${s.end_line}${s.parent ? `, parent=${s.parent}` : ''})`;
}

/** 压缩连续 ≥2 空行为 1 空行（delete 后清理） */
function squeezeBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (isBlankLine(l) && out.length > 0 && isBlankLine(out[out.length - 1])) continue;
    out.push(l);
  }
  return out;
}

/** 生成 range 编辑的 diff 预览（− 移除 / + 新增 / 区间穿透符号提示），预览行数设上限防爆 */
function buildRangePreview(
  start: number,
  end: number,
  total: number,
  removed: string[],
  added: string[],
  overlapped: ParsedSymbol[],
  quiet?: boolean,
): string {
  const cap = 400;
  const trunc = removed.length > cap || added.length > cap;
  const body = [
    ...removed.slice(0, cap).map((l) => '- ' + l.replace(/\r?\n$/, '')),
    ...added.slice(0, cap).map((l) => '+ ' + l.replace(/\r?\n$/, '')),
  ].join('\n');
  const symNote =
  overlapped.length > 0
    ? quiet
      ? `\n⚠ 区间穿透 ${overlapped.length} 个符号（quiet，明细略）`
      : `\n⚠ 区间穿透 ${overlapped.length} 个符号: ` +
        overlapped.map((s) => describeSymbol(s)).join('；') +
        '（显式行区间，默认信任 caller，请复核）'
    : '';
  return (
    `diff L${start}-L${end}/${total}（${removed.length} 行 → ${added.length} 行）` +
    (trunc ? '，预览已截断' : '') +
    symNote +
    '\n```diff\n' +
    body +
    '\n```'
  );
}

/** 生成通用 diff 预览（− 移除 / + 新增），行数设上限防爆 */
function buildGenericDiff(header: string, removed: string[], added: string[]): string {
  const cap = 400;
  const trunc = removed.length > cap || added.length > cap;
  const body = [
    ...removed.slice(0, cap).map((l) => '- ' + l),
    ...added.slice(0, cap).map((l) => '+ ' + l),
  ].join('\n');
  return (
    `diff ${header}${trunc ? '，预览已截断' : ''}\n` +
    '```diff\n' +
    body +
    '\n```'
  );
}

/** 定位符号的函数/方法体行区间（AST 精确：body/suite 字段节点）。失败返回 null。 */
async function findBodyRange(
  absPath: string,
  content: string,
  symbol: string,
  parent?: string,
): Promise<{ startIndex: number; endIndex: number; startLine: number; endLine: number } | null> {
  const ast = await parseAstRoot(absPath, content);
  if (!ast?.root) return null;
  const TYPE_NODES = new Set([
    'class_declaration', 'abstract_class_declaration', 'interface_declaration',
    'class_definition', 'type_alias_declaration', 'enum_declaration', 'struct_specifier',
  ]);
  let out: { startIndex: number; endIndex: number; startLine: number; endLine: number } | null = null;
  const walk = (node: any, parentName: string | undefined): void => {
    if (out) return;
    const nameNode = node?.childForFieldName?.('name');
    if (nameNode) {
      const name = nameNode.text ?? '';
      const qn = parentName ? `${parentName}.${name}` : name;
      if ((qn === symbol || name === symbol) && (!parent || parentName === parent)) {
        const body = node.childForFieldName('body') ?? node.childForFieldName('suite');
        if (body) {
          out = {
            startIndex: body.startIndex ?? 0,
            endIndex: body.endIndex ?? 0,
            startLine: body.startPosition.row + 1,
            endLine: body.endPosition.row + 1,
          };
          return;
        }
      }
    }
    const childParent = nameNode && TYPE_NODES.has(node.type) ? (nameNode.text ?? '') : parentName;
    for (let i = 0; i < (node?.childCount ?? 0); i++) {
      const child = node.child(i);
      if (child) walk(child, childParent);
    }
  };
  walk(ast.root as any, undefined);
  return out;
}

/** 行首空白字符数 */
function leadingSpaces(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].length : 0;
}

/** 取第 line 行（1-based）的前导空白 */
function leadingWhitespaceOfLine(content: string, line: number): string {
  const l = content.split('\n')[line - 1];
  const m = l ? /^[ \t]*/.exec(l) : null;
  return m ? m[0] : '';
}

/**
 * 把新代码按目标缩进重排（以周围上下文为准）：
 * 去最小公共缩进（相对化）后整体补上 refIndent，保留内部相对嵌套。
 * 空行保持原样。用于 range 编辑让粘贴代码贴合周围缩进层级，
 * 而非把 AI 给的可能来自别处的缩进原样塞进去。
 * 幂等：调用方已按 refIndent 对齐时，minIndent==refIndent → 结果不变。
 */
function realignCode(lines: string[], refIndent: string): string[] {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return lines;
  const minIndent = Math.min(...nonEmpty.map((l) => leadingSpaces(l)));
  return lines.map((l) => (l.trim().length === 0 ? l : refIndent + l.slice(minIndent)));
}

/** 声明样首行关键字（用于判断新 code 是否像完整定义而非裸函数体片段） */
const DECL_PREFIXES = [
  'function ', 'class ', 'interface ', 'enum ', 'type ', 'abstract class ', 'export ',
  'import ', 'const ', 'let ', 'var ', 'func ', 'def ', 'public ', 'private ', 'protected ', 'static ',
];

/** 新 code 是否像「函数/方法体片段」而非「完整自包含定义」（缺签名声明行） */
function looksLikeBareBody(code: string): boolean {
  const first = (code.trim().split('\n')[0] ?? '').trim();
  if (!first) return false;
  if (/^[{[\]:;]/u.test(first)) return true; // 直接以花括号/返回语句开头 → 体片段
  return !DECL_PREFIXES.some((k) => first.startsWith(k));
}

/** 目标符号是函数/方法时，附加「改用 sub=body」的引导文案 */
function subBodyHint(targetKind: string | undefined): string {
  if (targetKind !== 'function' && targetKind !== 'method') return '';
  return (
    '\n提示：目标符号是函数/方法。若你只想改函数体而非整套重写定义，' +
    "请改用 op='replace' + sub='body'——把 code 只设为新的函数体内容即可，工具会自动保留签名与大括号。"
  );
}

/** 符号 disambiguate 的上下文摘要（签名行 + 其后两行正文，让 AI 凭内容而不是行号区分同名） */
function describeSymbolCtx(s: ParsedSymbol, lines: string[]): string {
  const snippet = lines
    .slice(s.start_line - 1, Math.min(s.end_line, s.start_line + 2))
    .map((l) => l.replace(/^\s+/, '').trimEnd())
    .filter((l) => l.length > 0)
    .join(' → ');
  return `  ${describeSymbol(s)}\n      ctx: ${snippet || '（无上下文）'}`;
}

/** 同名多候选歧义错误：N 候选 + 每个的上下文摘要 + 引导 parent 消歧 */
function buildAmbiguityError(hits: ParsedSymbol[], symbol: string, lines: string[]): string {
  return (
    `符号不唯一（${hits.length} 候选，symbol=${symbol}）。传 parent 消歧` +
    '（方法 → 所在类名；Go 方法 → receiver 类型名），候选如下:\n' +
    hits.map((s) => describeSymbolCtx(s, lines)).join('\n')
  );
}

/**
 * ★ P-A（规划书 §16.1）：写工具回执的**机器可读字段**。
 *
 * 为什么需要：回执此前是**纯散文**，agent 判成败只能**正则解析文本** ——
 * 实测我因此踩了两次（干跑回执以 `[干跑]` 开头 ⇒ `startsWith('✓')` 把成功判成失败 ⇒ **静默跳过落盘**；
 * 正则漏 `from ` ⇒ 6 个文件全判错）。这与本仓 §2d「不许靠猜」**自相矛盾**。
 *
 * ★ 字段**从入参派生**，不从 message 反推（反推 = 把上面的错再写一遍）。
 */
export interface EditReceipt {
  /** 调用是否成功（**干跑成功也是 true** —— 看 `written` 区分是否真落盘） */
  ok: boolean;
  op: string;
  file: string;
  /** 是否干跑（未写盘） */
  dry_run: boolean;
  /** 是否**真的落盘**（干跑 = false）—— ★ agent 判"做没做"只看这个字段 */
  written: boolean;
  /** `replace_text` 专有：命中位置与级别 */
  hit?: { level: number; label: string; start_line: number; old_lines: number; new_lines: number };
  /** ★ 2026-10-20：**空操作**（old_text 与 new_text 等价、内容逐字未变）—— 此时 `written:false` 且索引未重建 */
  no_op?: boolean;
  /** 落盘后索引同步状态 */
  index_synced?: string;
  /** 符号 diff（落盘后才有；**条目级只在该文件整批内唯一出现时**才有 —— 见 T150） */
  symbol_diff?: { added: number; removed: number; changed: number };
  /**
   * ★ 2026-10-28（T150）：**文件级**符号 diff（每个文件一条，按文件名排序）—— 唯一出处。
   * 判据：逐项 `symbol_diff` 之和必须等于这里该文件的 diff（条目级只在"该文件唯一"时才带 ⇒ 恒成立）。
   * 仅批量 `targets[]` 时有值。
   */
  files?: Array<{ file: string; symbol_diff: { added: number; removed: number; changed: number } }>;
  /** ★ P-B 批量专有：逐项独立回报（每项一条，含失败项的 error） */
  items?: EditBatchItem[];
  /** ★ P-B 批量专有：目标项总数 */
  total?: number;
  /** ★ P-B 批量专有：成功项数 */
  succeeded?: number;
  /** ★ P-B 批量专有：失败项数 */
  failed?: number;
  /**
   * ★★★ 2026-11-02：**已应用过**（重复应用的第二遍；不写盘、不进闸、不重建索引）。
   * ★ 两种形状、同一个概念：批量 = **项数**；单条 = 那一条的**判据证据**（与 `EditBatchItem.already_applied` 同形）。
   */
  already_applied?: number | { line: number; how: ReplaceTextAppliedHow };
  /** ★ P-B 批量专有：是否启用原子性（任一项失败则整批不落盘） */
  atomic?: boolean;
  /**
   * ★★★ 2026-10-20（`docs/certs-4-ways.md` ③）：**任务闸的放行读数**（闸的 `note`）。
   *
   * ★ 之前这个值**根本不存在**：调用点是 `assertSourceWriteRegisteredFor(...)`（返回值丢弃）
   *   ⇒ 闸写了几百行的“凭什么放行”与“豁免了谁”，**从未进过任何回执**（只拦不说）。
   *   ⇒ 而“豁免必须可查，不许静默”正靠这一行落地（`write_gate.ts#exemptionLines`）。
   */
  task_gate: string;
  /**
   * ★ AGENTS-RULES 0.12：闸 / 语法门留下的**读数**（`txn.warnings` 的同一数组 + 语法门那几条）。
   * 只印在 message 里不够 —— 读端要能机器判「这次到底验了没有」。非空才给。
   */
  warnings?: string[];
  /**
   * ★★★ 2026-10-21（并发控制·读集比对）：**写前假设检定** —— 「我/别人读过的符号，现在是哪一版」。
   * ★ 与 `task_gate` **两个字段、两条判据**：`task_gate` 管身份（A7），本字段管假设是否过期。
   * ★ **不阻塞**：`stale` 非空也照常落盘（只报，不拦）。人读侧见消息末尾的「★ 假设过期」段。
   */
  assumption_check?: AssumptionCheck;
  /**
   * ★★★ 2026-11-01（第二轮外审 P0-1）：**本批是否整批回滚到改动前**（恒有这一格，取值可区分）。
   *
   * · `false` ⇒ 没有发生"完整回滚"（正常成功 / 没走到落盘 / 回滚不全 —— 后两者由 `rollback` 与
   *   `failed_at` 分开）；
   * · `true`  ⇒ 磁盘与改动前**逐字节一致**，`applied:[]`、`written:false` —— 整笔未生效。
   */
  rolled_back?: boolean;
  /**
   * ★ 2026-11-01（P0-1）：本次**落过盘**的文件（仓库相对路径，落盘顺序；**只在落盘中途失败时出现**）。
   * ★ 与 `applied` 分开看：`landed` 非空而 `applied` 空 = "落过又撤回了"；两者都没有 = "一个都没落"。
   */
  landed?: string[];
  /**
   * ★ 2026-11-01（P0-1）：**本次调用真正留在盘上的改动**（恒有这一格）。
   * 完整回滚 ⇒ `[]`；正常成功 ⇒ 全部落盘文件；回滚不全 ⇒ 没还原成的那几个。
   */
  applied?: string[];
  /** ★ 2026-11-01（P0-1）：回滚读数（`failed` 非空 = 回滚不全 ⇒ 项目可能停在半改状态，请手动核对） */
  rollback?: EditBatchRollback;
  /** ★ 2026-11-01（P0-1）：在第几个文件落盘失败（仓库相对路径）—— 与 `rollback` 一起读 */
  failed_at?: string;
  /**
   * ★ 2026-11-01（P0-1）：**收尾自己抛错**时的原话（自写登记 / 索引写穿没跑成）。
   * ★ 与"落盘失败"**两件事**：落盘失败说的是磁盘，这一格说的是索引与登记 —— 别合并成一个字段。
   */
  close_error?: string;
}

/**
 * ★★★ 2026-11-01（第二轮外审 P0-1）：批量落盘失败后的**回滚读数**（只有"落盘中途失败"时出现）。
 *
 * 形状直接取自 `file_snapshot#RollbackResult`（不另造一套词）：`restored` / `removed` / `failed`
 * 就是那次回滚的逐文件事实，`message` 是它的原话（本文件不重拼）。
 */
export interface EditBatchRollback {
  /** 是否已还原到改动前（`failed` 非空 ⇒ false） */
  ok: boolean;
  /** 人读说明（`rollbackFileSnapshot` 的原话） */
  message: string;
  /** 被还原原内容的文件（仓库相对路径） */
  restored: string[];
  /** 因"快照时不存在"被删掉的文件（批量改的都是已存在文件 ⇒ 正常为空） */
  removed: string[];
  /** ★ **未能还原**的文件 —— 它们**仍在盘上**（回滚不全时，自写登记只认这几个） */
  failed: string[];
}

/** ★ P-B：`replace_text` 的**纯规划结果**（不写盘、不碰索引）—— 单文件路径与 targets[] 批量共用同一份实现。
 *  ★ P-C：`planReplaceText` 同时被 `refactor_plan.ts` 复用（算清单/判"已应用"）—— 导出以免再写第二份定位+语法门。 */
export interface ReplaceTextPlan {
  /** 编辑后的完整文件内容（已过语法门） */
  newContent: string;
  /**
   * ★★★ 2026-10-20：**空操作** —— 替换后内容与原文**逐字相同**。
   *
   * 判据 = `newContent === content`（**不是** `oldText === newText`）：后者会漏掉模糊级重排后
   * 仍然等价的情形；而真正要回答的问题是"**文件变了吗**"（没变就没什么可写、也没什么可重建）。
   * ★ 调用方必须据此**不写盘、不重建索引**，并在回执里明说"空操作，未改动" ——
   *   旧行为是照写不误、回 ✓、还重建索引（实测骗过两个子代理）。
   */
  noop: boolean;
  hit: NonNullable<EditReceipt['hit']>;
  /** diff 预览（"-" 侧为**实际命中的文件片段**，模糊级 ≠ 传入 old_text） */
  preview: string;
  /** 模糊命中时的提示文案（L1 为空串） */
  levelNote: string;
  /** 实际命中片段的行数（= hit.old_lines，供消息复用） */
  matchedLineCount: number;
  /**
   * ★ 语法门读数（`domain/syntax_gate.ts` 给的 warnings）—— **必须由调用方带进回执**：
   *   基线脏 / 无解析器这两种态**不拦**，但「根本没验」与「验过且干净」不许长一个样（0.12）。
   */
  syntaxWarnings: string[];
}

/**
 * ★★★ 2026-11-02（单条幂等）：`planReplaceText` 的**两态** —— 这是「这条替换现在该不该写盘」的
 * **判据出口**（判据本身住 `classifyReplaceTextApply`，本类型只把它带到三个调用方）。
 * ★ 出现 `already_applied` ⇒ **不许**写盘、不许重建索引、不许进写闸；三个调用方各自的回执形状不同
 * （单条 = 一份回执 / 批量 = 一项 item / `apply_refactor_plan` = `already_applied` 决策）。
 */
export type ReplaceTextPlanOutcome =
  | ({ kind: 'edit' } & ReplaceTextPlan)
  | { kind: 'already_applied'; line: number; how: ReplaceTextAppliedHow };

/**
 * ★★★ 2026-11-03（0.6）：`already_applied` 两档的**人读依据**（唯一住处）。
 *
 * 不变量：同一个事实（「上一次应用留下的痕迹」）的文案只许有一份 —— 单条 `replace_text` 回执、
 * `targets[]` 批量的项、`apply_refactor_plan` 算清单的拒绝，三处都调它。
 * 改前每处各翻一遍（单条硬编码「严格覆盖」、批量内联三目、算清单另一句）⇒ `new-text-present`
 * 在三条路上被说成三件事（0.9 一处权威）。
 */
export function describeReplaceTextAppliedHow(how: ReplaceTextAppliedHow): string {
  return how === 'inside-new-text'
    ? 'old_text 的命中已被一处 new_text **严格覆盖**（插入式替换的第二次应用）'
    : 'old_text 已不在，而 new_text **已在文件里恰好一处**（上一次应用留下的痕迹）';
}

/**
 * ★ P-B：`replace_text` 的**规划**（纯函数语义：读 content → 返回新内容或抛错，不写盘、不碰索引）。
 * 单文件 `op='replace_text'` 与 `targets[]` 批量**共用这一份**（同一件事不许两份实现）。
 * 纪律不变：歧义即停（不猜）、语法门兜底（新引入语法错误 → 抛错）、模糊命中回执明示级别。
 * ★ 导出（P-C）：`refactor_plan.ts` 的算清单/判"已应用"必须用**这一份**（同一定位+语法门），不许另写。
 */
export async function planReplaceText(
  absPath: string,
  content: string,
  eol: string,
  oldText: string,
  newText: string,
): Promise<ReplaceTextPlanOutcome> {
  // ★★★ 2026-11-02（单条幂等）：同一条替换重跑 ⇒ 文件必须逐字节不变。判据**只住** `classifyReplaceTextApply`
  //   —— 本函数是单条 `replace_text` / `targets[]` 批量 / `apply_refactor_plan` 三者的**唯一汇合处**
  //   ⇒ 在这里问一次，三条路都不可能漏。改前只有批量的规划循环问它 ⇒ **单条那条腿结构上到不了**判据：
  //   插入式替换（new 严格包含 old）重跑时 old 仍在（它正是上次插进去那段的前缀）⇒ 定位成功 ⇒ 再插一遍。
  // ★★★ 2026-11-03（0.6）：**两档 `how` 都是成功**，不再按 `how` 分流到错误通道 ——
  //   `inside-new-text`（old 的命中被一处 new 严格覆盖）与 `new-text-present`（old 已不在、new 恰一处）
  //   是同一事实的两种证据；读端要的是「文件没变」，不是「报错」。错误通道只剩两档真错（歧义 / 两边都没有）。
  const applied = classifyReplaceTextApply(content, oldText, newText, eol);
  if (applied.kind === 'already_applied') {
    return { kind: 'already_applied', line: applied.line, how: applied.how };
  }
  const loc = locateReplaceText(content, oldText);
  if (loc.candidates.length > 1) {
    throw new Error(
      `replace_text 不唯一（L${loc.candidates[0].level}·${FUZZY_LEVEL_LABEL[loc.candidates[0].level]} ` +
        `匹配到 ${loc.candidates.length} 处：行号 ${loc.candidates.map((c) => c.startLine).join(', ')}）。` +
        '请用更长/更独特的 old_text（含上下文）唯一化。',
    );
  }
  if (!loc.match) {
    // ★ 2026-10-28（T287）：未命中**不等于没生效** —— 三档归类只住 `classifyReplaceTextMiss`（本处只渲染文案）。
    // ★ 2026-11-03（0.6）：`already_applied` 那一档已在本函数开头由 `classifyReplaceTextApply` 早退
    //   ⇒ 这里只剩两档真错（`ambiguous` / `not_found`）。再抛一遍就是把同一事实翻第二遍，
    //   而那条 throw 的 `code=ALREADY_APPLIED` **不出仓**（错误通道只给 {text,isError}）⇒ 读端判不出它是成功。
    const miss = classifyReplaceTextMiss(content, oldText, newText);
    // ★ ambiguous **不许**落到下面的「未找到」文案：new_text 出现多次时，「已经应用过」说不出是**哪一处**
    //   （旧实现拿四级级联去判 new_text ⇒ 出现两次反而报 not_found）。
    if (miss.kind === 'ambiguous') {
      throw new Error(
        `replace_text 的 new_text 在文件里出现 **${miss.count} 处**（行号 ${miss.lines.join(', ')}）：` +
          `old_text 不在，而 new_text 不唯一 ⇒ **说不出"已经应用过"的是哪一处**，不做猜测。` +
          `请给出**当前**文本的上下文（旧文本 + 足够上下文）后重试。`,
      );
    }
    throw new Error(
      `replace_text 未找到 old_text（L1 逐字 / L2 空白归一 / L3 缩进弹性 / L4 省略号占位 四级均未命中；` +
        `${JSON.stringify(oldText.slice(0, 40))}），且 new_text 也不在文件里 ⇒ 两边都没有，确认是不是改错了文件。`,
    );
  }
  const m = loc.match;
  // L3/L4：new_text 按实际命中首行缩进重排（模型写去缩进形态也能落对位置；eol 用外层 detectEol 结果）
  const effectiveNew = m.level >= 3 ? realignNewTextTo(newText, m.targetIndent, eol) : newText;
  const newContent = content.slice(0, m.start) + effectiveNew + content.slice(m.end);
  const reparsed = await parseFileFull(absPath, newContent);
  if (reparsed.error) {
    throw new Error(`编辑后文件解析失败，已放弃（未写盘）: ${reparsed.error}`);
  }
  // ★ 语法门（判据/文案唯一住在 `domain/syntax_gate.ts`）：读数带出给调用方 → 批量路也丢不了
  const syntaxWarnings: string[] = [];
  await applySyntaxGate({
    absPath,
    baseline: content,
    newContent,
    blockHint: '请检查 new_text。',
    onWarning: (m) => {
      if (!syntaxWarnings.includes(m)) syntaxWarnings.push(m);
    },
  });
  // diff 的 "-" 侧用实际文件片段（L≥2 时 ≠ 模型写的 old_text，诚实展示被改内容）
  const matchedLines = m.matchedText.split(/\r?\n/);
  const newLines = effectiveNew.split(/\r?\n/);
  const levelNote =
    m.level >= 2
      ? `（⚠ L${m.level}·${FUZZY_LEVEL_LABEL[m.level]} 模糊命中：old_text 非逐字一致` +
        `${m.level >= 3 ? '，new_text 已按命中缩进重排' : ''}）`
      : '';
  const preview = buildGenericDiff(
    `L${m.startLine}（${matchedLines.length} 行 → ${newLines.length} 行）`,
    matchedLines,
    newLines,
  );
  return {
    kind: 'edit',
    newContent,
    // ★★★ 2026-10-20：空操作判据（唯一一处）—— 只看“结果跟原文一样吗”
    noop: newContent === content,
    hit: {
      level: m.level,
      label: FUZZY_LEVEL_LABEL[m.level],
      start_line: m.startLine,
      old_lines: matchedLines.length,
      new_lines: newLines.length,
    },
    preview,
    levelNote,
    matchedLineCount: matchedLines.length,
    syntaxWarnings,
  };
}

/** ★ 2026-10-20：把任务闸的放行读数**带出**到回执（`editCodeInner` 有 10 处 return，不逐处改）。 */
interface GateReceipt {
  note?: string;
  exempted?: GateExemption[];
  /**
   * ★ AGENTS-RULES 0.12：闸/收尾留下的**读数**（`txn.warnings` 的同一引用）。
   * 原来这类 warn 全仓**没有任何人打印** ⇒ 写成功了、读数丢了（"少做了什么"被藏起来）。
   */
  warnings?: string[];
  /** ★ 2026-10-21：假设检定读数（**与 `note` 分开**；`stale` 非空也照样落盘） */
  assumption?: AssumptionCheck;
}



/**
 * ★★★ 2026-10-28（用户提议"读集限制改成画布限制" → 落地）：**画布/读集过期的一行读数**。
 *
 * ## 为什么它必须出现在回执里（实测病灶）
 * `edit_code` 用旧 body **覆盖了我 4 分钟前刚加的修复**，回执只说"文件符号: 20 → 20" ——
 * 一个字都没提"你覆盖了别人的改动"。⇒ 读数为真但**没进人眼**，等于没有。
 *
 * ## 判据
 * `assumption.stale` 非空 ⇒ 出一行（**`via=canvas` 的排前面**：那是"你冻结的版本已经变了"，
 * 比"某人读的东西变了"更该先看）。空 ⇒ 闭嘴（不制造假警报）。
 */
function assumptionNote(gateOut: GateReceipt | undefined): string {
  const stale = gateOut?.assumption?.stale ?? [];
  if (!stale.length) return '';
  const byCanvas = stale.filter((s) => s.via === 'canvas');
  const head = byCanvas.length
    ? `★ **画布冻结的版本已经变了**（${byCanvas.length} 个文件）：${byCanvas.map((s) => s.file).join(', ')} ⇒ 你的计划是对着旧内容写的，先重读再改`
    : '';
  const rest = stale.filter((s) => s.via !== 'canvas');
  const tail = rest.length ? `\n★ 另有 ${rest.length} 处读集过期（${rest.slice(0, 2).map((s) => `${s.file}${s.symbol ? '#' + s.symbol : ''}`).join(', ')}…）` : '';
  return `\n${head}${tail}`;
}

/**
 * ★ 2026-10-28（T-#RP-3）：本函数是**正文**（14 处 return 各管一种 op 的回执），
 * 它**不负责收尾** —— 事务通过 `registerTxn` 交给外层 `editCodeInner`，
 * 由外层统一 `close()`（唯一收尾）。这样"批级读数"自然回到回执里，不必现算。
 */
async function editCodeBody(
  args: EditCodeArgs,
  gateOut: GateReceipt | undefined,
  registerTxn: (t: SourceWriteTxn) => void,
): Promise<{
 message: string; data?: unknown }> {
  // ★ 2026-10-28（T245）：接住写穿回执 —— 画布读数（`plan_exit` / `plan_baseline`）在它身上，
  //   原来 `txn.commit()` 的返回值被**丢弃** ⇒ 回执只能自己再算一遍（同一判据住两处）。
  let _lastRec: SourceWriteReceipt | null = null;
  const { op } = args;
  const projectRoot = path.resolve(args.project_dir);
  const absPath = path.isAbsolute(args.file) ? args.file : path.resolve(projectRoot, args.file);
  const relPath = path.relative(projectRoot, absPath).split(path.sep).join('/');

  // ★ AGENTS-RULES 0.12：语法门读数必须进 `data.warnings` + 人读回执。
  //   有事务时闸/收尾共用 `txn.warnings` 那**一个**数组；**干跑没有事务**（不判闸、不快照）
  //   ⇒ 先给它一个自有数组，事务建立后再把它并进 `txn.warnings`（下面那处合并）。
  if (gateOut && !gateOut.warnings) gateOut.warnings = [];
  /** 语法门是否**真的验过且干净**（干跑回执不许无条件写「语法门通过」） */
  let syntaxClean = true;
  /** 语法门读数出口（★ 唯一出口）：三态里只有「干净」不出声，另两态必须进回执 */
  const noteSyntaxWarning = (m: string): void => {
    syntaxClean = false;
    if (gateOut?.warnings && !gateOut.warnings.includes(m)) gateOut.warnings.push(m);
  };
  /** 干跑回执里的语法门短语：干净才许写「语法门通过」；另两态由 warnings 那几行说 */
  const drySyntaxPhrase = (): string => (syntaxClean ? '，语法门通过' : '');

  if ((op === 'replace' || op === 'delete') && !args.symbol) {
    throw new Error(`${op} 需要 symbol（目标符号名或 qualified_name）`);
  }
  if (op === 'replace' || op === 'insert') {
    if (!args.code || !args.code.trim()) throw new Error(`${op} 需要 code（新代码）`);
  }
  if (op === 'replace_text') {
    if (!args.old_text || !args.old_text.trim()) throw new Error('replace_text 需要 old_text（要替换的唯一旧文本）');
    if (args.new_text == null) throw new Error('replace_text 需要 new_text（新文本，传空串表示删除该文本）');
  }
  if (op === 'replace' && args.sub !== undefined && args.sub !== 'body') {
    throw new Error(`replace 的 sub 仅支持 'body'，收到 ${args.sub}`);
  }

  const fileExists = fs.existsSync(absPath);
  /** ★ 2026-10-22：本工具一次调用只改一个文件 ⇒ 一个事务；`dry_run` 时**不建**（不判闸、不拍空快照）。 */
  let txn: SourceWriteTxn | undefined;
  if (!fileExists && op !== 'insert') {
    throw new Error(`文件不存在: ${absPath}（insert 可创建新文件，replace/delete 不行）`);
  }

  // ★ 可撤回：任何会落盘的编辑，先把目标文件原样存一份（dry_run 不快照）。
  // 之后可用 snapshot(action="rollback") 一键回到这一刻（含"本次新建的文件"会被删掉）。
  // 逐文件（本工具一次只改一个文件）+ 编辑前（校验之前）就快照 —— 两条都是**有意**的形态，
  // 且是"不并入 applyWrites"的两条原因之一，理由与实测证据见文件头「落盘形态」块。
  if (args.dry_run !== true) {
    // ★★★ T328 步 6：**未登记不许落盘** —— 本工具**不走 `writeSourceFiles`**（内联四件套），
    //   所以闸必须在这里**显式**调一次，否则最大的那条"改源码"路会成为绕过口。
    //   ★ 位置：快照**之前**（拒绝就是拒绝，连快照都不该建）。
    // ★★★ 2026-10-20：闸的**放行读数**（含“本次写入 X 被豁免”）带出去 —— 返回值不许再丢。
    //   ★ 仍然只调用**一次**（闸不便宜，且两次调用在并发下可能读到不同世界）。
    // ★★★ 2026-10-20（A7 闭合）：`actor` **显式入参** —— 之前这里写的是 `resolveActor()`（无参）
    //   ⇒ 只可能读到 env，而生产面（stdio MCP）里 env 是空的 ⇒ 闸永远只能"提醒 + 放行"。
    //   （这就是"判据在、代码在、入口没接"那一类的具体形状：一个空括号。）
    // ★★★ 2026-10-21（读集比对）：**把"我要改哪个符号"交给闸** —— 只有 replace / delete 会动符号本体
    //   （insert 是加新符号、replace_text 是文本级 ⇒ 都退到文件粒度；**粒度由事实决定，不假装**）。
    // ★★★ 2026-10-22：闸 + 写前快照收进**唯一写原语**（事务形态）。
    //   改前：这里判闸、拍快照，然后 6 个分支各自 `fs.writeFileSync` —— 闸与落盘点隔着几十行，
    //   任何一条分支忘了判就是一个静默撒谎点（本仓 25 处裸写里的头一份）。
    //   ★ 读集检定仍到**符号级**：只有 replace / delete 动符号本体（insert / replace_text 退到文件级）。
    txn = openSourceWrite(projectRoot, [relPath], {
      label: `edit_code:${op}:${relPath}`,
      actor: args.actor,
      authorize: args.authorize,
      // ★ 2026-10-30（fencing）：
      leaseGeneration: args.lease_generation,
      ...(op === 'replace' || op === 'delete' ? { symbols: [{ file: relPath, symbol: args.symbol! }] } : {}),
    });
    registerTxn(txn);
    if (gateOut) {
      gateOut.note = txn.task_gate;
      gateOut.exempted = txn.exemptions;
      gateOut.assumption = txn.assumption_check;
      // ★ 0.12：**同一个数组引用** —— `close()` 后面追加的收尾读数（如读集基线刷新）也看得见。
      //   ★ body 若已先产过读数（语法门），**并进事务那一个**：换引用会把前面的读数丢在另一处。
      if (gateOut.warnings?.length && gateOut.warnings !== txn.warnings) {
        for (const w of gateOut.warnings) if (!txn.warnings.includes(w)) txn.warnings.push(w);
      }
      gateOut.warnings = txn.warnings;
    }
  }

  // ── insert 新文件：直接写入 + 索引 ──
  if (!fileExists && op === 'insert') {
    const eol = '\n';
    const lines = normalizeCode(args.code!, eol);
    const content = lines.join('');
    const reparsed = await parseFileFull(absPath, content);
    if (reparsed.error) throw new Error(`新文件内容解析失败（不写盘）: ${reparsed.error}`);
    // ★ 语法门：新文件没有「基线」⇒ 基线恒干净（只剩「编辑后脏」这一态）
    await applySyntaxGate({
      absPath,
      baseline: '',
      newContent: content,
      blockHint: '请检查 code 的括号/缩进/引号。',
      blockHead: '新文件内容含语法错误（hasError=true，不写盘）。',
      onWarning: noteSyntaxWarning,
    });
    if (args.dry_run) {
      return {
        message:
          `[干跑] 将创建 ${relPath}（${reparsed.symbols.length} 符号）${drySyntaxPhrase()}，未写盘:\n\`\`\`\n` + content + '\n\`\`\`',
      };
    }
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    _lastRec = txn!.commit(absPath, content);
    const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
    // ★★★ P0 保鲜链第 1 环（2026-10-26）：**本笔在盘上产生了一个新路径** ⇒ 查一次设计册。
    //   不在册 ⇒ 回执追加警告段（只警告不自动入册，给一键入参示例）；在册 / 无册指向 ⇒ 不加噪声。
    const ledgerWarn = newFileLedgerWarning(projectRoot, relPath);
    return {
      message:
        `✓ 已创建 ${relPath}（${reparsed.symbols.length} 符号）并重建索引（${sync.status}${reopenNote(_rw)}）\n` +
        reparsed.symbols.map((s) => `  + ${describeSymbol(s)}`).join('\n') +
        (ledgerWarn ? `\n${ledgerWarn}` : ''),
    };
  }

  const original = fs.readFileSync(absPath, 'utf8');
  const eol = detectEol(original);
  const lines = splitKeepEnds(original);
  const parsed = await parseFileFull(absPath, original);
  if (parsed.error) throw new Error(`目标文件当前就解析失败（先修文件再编辑）: ${parsed.error}`);

  // ── op='replace' + sub='body'：只替换函数/方法体（文本级，保留签名与大括号；code 只给 body、免自包含）──
  if (op === 'replace' && args.sub === 'body') {
    const body = await findBodyRange(absPath, original, args.symbol!, args.parent);
    if (!body) throw new Error(`sub=body 未定位到 ${args.symbol} 的函数体（确认 qualified_name 或传 parent）`);
    if (args.code == null) throw new Error('sub=body 需要 code（新函数体内容，含大括号；传空串=清空函数体）');
    // ── 智能缩进对齐：保留大括号原位置，body 内容按父级缩进重排 ──
    const braceIndent = leadingWhitespaceOfLine(original, body.startLine);
    // 从原 body 内部推导 indent unit（内部最小缩进 − 大括号缩进）；单行/空 body 回退 2 空格
    const innerLines = original.slice(body.startIndex + 1, body.endIndex - 1).split('\n').filter((l) => l.trim().length > 0);
    let indentUnit = '  ';
    if (innerLines.length > 0) {
      const minInner = Math.min(...innerLines.map((l) => leadingSpaces(l)));
      indentUnit = ' '.repeat(Math.max(2, minInner - braceIndent.length));
    }
    const innerIndent = braceIndent + indentUnit;
    // code 剥可选大括号 → 相对化（去最小公共缩进）→ 加 innerIndent（保持内部相对嵌套）
    let codeLines = args.code.replace(/\r\n/g, '\n').split('\n');
    if ((codeLines[0] ?? '').trim() === '{') codeLines = codeLines.slice(1);
    if ((codeLines[codeLines.length - 1] ?? '').trim() === '}') codeLines = codeLines.slice(0, -1);
    while (codeLines.length > 0 && codeLines[0].trim() === '') codeLines.shift();
    while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === '') codeLines.pop();
    const nonEmpty = codeLines.filter((l) => l.trim().length > 0);
    const minCodeIndent = nonEmpty.length > 0 ? Math.min(...nonEmpty.map((l) => leadingSpaces(l))) : 0;
    const realigned = codeLines.map((l) => (l.trim().length === 0 ? '' : innerIndent + l.slice(minCodeIndent))).join('\n');
    const newBodyText = '{\n' + (realigned.length > 0 ? realigned + '\n' : '') + braceIndent + '}';
    const newContent = original.slice(0, body.startIndex) + newBodyText + original.slice(body.endIndex);

    // 语法门（同 replace_text：解析失败 / 新引入语法错误 → 拒绝不写盘）
    const reparsed = await parseFileFull(absPath, newContent);
    if (reparsed.error) {
      throw new Error(`编辑后文件解析失败，已放弃（未写盘）: ${reparsed.error}`);
    }
    await applySyntaxGate({
      absPath,
      baseline: original,
      newContent,
      blockHint: '请检查 code。',
      onWarning: noteSyntaxWarning,
    });
    const oldBody = original.slice(body.startIndex, body.endIndex);
    const preview = buildGenericDiff(
      `L${body.startLine}-${body.endLine}（body）`,
      oldBody.split(/\r?\n/),
      newBodyText.split(/\r?\n/),
    );
    if (args.dry_run) {
      return {
        message:
          `[干跑] replace ${relPath} 的 ${args.symbol} body（L${body.startLine}-${body.endLine}）${drySyntaxPhrase()}，未写盘:\n${preview}`,
      };
    }
    _lastRec = txn!.commit(absPath, newContent);
    const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
    const diffNote = sync.symbol_diff
      ? `（符号 diff: +${sync.symbol_diff.added} -${sync.symbol_diff.removed} ~${sync.symbol_diff.changed}）`
      : '';
    return {
      message:
        `✓ 已替换 ${relPath} 的 ${args.symbol} body（L${body.startLine}-${body.endLine}），` +
        `签名与大括号保留，索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}\n${preview}` + '' + assumptionNote(gateOut),
    };
  }

  // ── op='range'：显式行区间编辑（符号为主路径的可选偏好；行号由调用方先读文件确认）──
  if (op === 'range') {
    if (args.start == null || args.end == null) {
      throw new Error('range 需要 start/end（1-based 含端点行号）');
    }
    if (args.code == null) throw new Error('range 需要 code（新内容；传空串表示删除该区间）');
    const start = args.start;
    const end = args.end;
    const total = lines.length;
    if (start < 1) throw new Error(`start 必须 ≥1，收到 ${start}`);
    if (end < start) throw new Error(`end(${end}) < start(${start})`);
    if (end > total) throw new Error(`end(${end}) 超出文件总行数(${total})`);

    const startIdx = start - 1;
    const count = end - start + 1;
    const codeLines = normalizeCode(args.code!, eol);
    // ── 缩进规范化（以周围上下文为准）：新代码按 start 行的所在缩进层级重排，
    //    而非把 AI 给的（可能来自别处的）缩进原样塞进去。
    const aligned = realignCode(codeLines, leadingWhitespaceOfLine(original, start));
    const newLines = [...lines];
    newLines.splice(startIdx, count, ...aligned);
    const newContent = newLines.join('');

    // 语法门（同 replace：解析失败 / 新引入语法错误 → 拒绝不写盘）
    const reparsed = await parseFileFull(absPath, newContent);
    if (reparsed.error) {
      throw new Error(`编辑后文件解析失败，已放弃（未写盘）: ${reparsed.error}`);
    }
    const { repaired: syntaxRepaired } = await applySyntaxGate({
      absPath,
      baseline: original,
      newContent,
      blockHint: '请检查 code 的括号/引号/缩进。',
      onWarning: noteSyntaxWarning,
    });

    // 区间穿透的符号（提示影响面，不禁止——行区间是显式请求，默认信任 caller）
    const overlapped = parsed.symbols.filter((s) => s.start_line <= end && s.end_line >= start);
    const preview = buildRangePreview(start, end, total, lines.slice(startIdx, startIdx + count), aligned, overlapped, args.quiet);

    if (args.dry_run) {
      return {
        message:
          `[干跑] range ${relPath} L${start}-L${end}（${count} 行 → ${aligned.length} 行）` +
          (syntaxRepaired ? '（此编辑会顺手修复原文件语法错误）' : '') +
          `${drySyntaxPhrase()}，未写盘:\n${preview}`,
      };
    }

    _lastRec = txn!.commit(absPath, newContent);
    const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
    const diffNote = sync.symbol_diff
      ? `（符号 diff: +${sync.symbol_diff.added} -${sync.symbol_diff.removed} ~${sync.symbol_diff.changed}）`
      : '';
    const repairNote = syntaxRepaired ? '（顺手修复了原文件的语法错误 ✓）' : '';
    return {
      message:
        `✓ range 编辑 ${relPath} L${start}-L${end}（${count} 行 → ${aligned.length} 行），` +
        `索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}${repairNote}\n${preview}` +
        '' + assumptionNote(gateOut),
    };
  }

  // ── op='replace_text'：文本唯一替换（edit 工具的 AST 安全版）──
  // ★ 模糊编辑级联（P0-4，2026-09-15）：L1 逐字 → L2 空白归一 → L3 缩进弹性 → L4 省略号占位。
  //   纪律：歧义即停（某级命中 >1 处直接报错并列行号，绝不降级硬找唯一）+ 唯一才动；
  //   L≥2 在回执里明示命中级别与实际被替换片段（诚实——不让模型误以为逐字一致）。
  // ★ P-B（2026-09-28）：定位/语法门抽成 `planReplaceText`（与 `targets[]` 批量共用同一份实现）。
  if (op === 'replace_text') {
    const out = await planReplaceText(absPath, original, eol, args.old_text!, args.new_text ?? '');
    // ★★★ 2026-11-02（单条幂等）：插入式替换重跑 ⇒ 判据说「上一次已经在盘上了」⇒ **不写盘、不重建索引**。
    //   改前这条腿只看 `!loc.match`（old 还在就照改）⇒ 同一条命令重跑会把同一段再插一遍。
    if (out.kind === 'already_applied') {
      return {
        message:
          `= ${args.dry_run ? '[干跑] ' : ''}已应用过，未改动 ${relPath} L${out.line}：` +
          `${describeReplaceTextAppliedHow(out.how)}` +
          ' ⇒ **未写盘、未重建索引**。\n' +
          '★ 若你本以为这次会再改一次，说明上一次已经生效（这不等于又改了一次，也不是空操作）。',
        data: {
          already_applied: { line: out.line, how: out.how },
          written: false,
          index_synced: '未重建（已应用过：文件内容未变）',
        },
      };
    }
    const plan = out;
    // ★ 0.12：门读数由 planner 带出 ⇒ 必须进回执（基线脏 / 无解析器不拦，但不许静默）
    for (const w of plan.syntaxWarnings) noteSyntaxWarning(w);
    if (args.dry_run) {
      return {
        message:
          `[干跑] replace_text ${relPath} L${plan.hit.start_line}（唯一命中 · L${plan.hit.level}·${plan.hit.label}）` +
          `${drySyntaxPhrase()}，未写盘:\n${plan.preview}`,
        data: { hit: plan.hit },
      };
    }
    // ★★★ 2026-10-20：**空操作不许假装落了盘** —— 内容逐字未变 ⇒ 不写、不重建索引，
    //   并在回执里**明说**“空操作，未改动”。
    //   前者会骗过调用方（实测骗过两个子代理：它们看到 ✓ 就当改动生效了）。
    if (plan.noop) {
      return {
        message:
          `= 空操作，未改动 ${relPath} L${plan.hit.start_line}（唯一命中 · L${plan.hit.level}·${plan.hit.label}）：` +
          `替换后内容与原文**逐字相同**（old_text 与 new_text 等价）⇒ **未写盘、未重建索引**。` +
          `\n★ 若你本以为会变，说明 old_text/new_text 写错了（或这处改动早已存在）；不要把它当成功。`,
        data: {
          hit: plan.hit,
          written: false,
          no_op: true,
          index_synced: '未重建（空操作：文件内容未变）',
        },
      };
    }
    _lastRec = txn!.commit(absPath, plan.newContent);
    const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
    const diffNote = sync.symbol_diff
      ? `（符号 diff: +${sync.symbol_diff.added} -${sync.symbol_diff.removed} ~${sync.symbol_diff.changed}）`
      : '';
    return {
      message:
        `✓ replace_text ${relPath} L${plan.hit.start_line}（${plan.matchedLineCount} 行 → ${plan.hit.new_lines} 行，` +
        `匹配 L${plan.hit.level}·${plan.hit.label}）${plan.levelNote}，` +
        `索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}\n${plan.preview}` + '' + assumptionNote(gateOut),
      data: { hit: plan.hit, index_synced: sync.status, ...(sync.symbol_diff ? { symbol_diff: sync.symbol_diff } : {}) },
    };
  }

  let lineOp: LineOp;
  /** 本次替换/删除/插入命中的目标符号 kind（供 sub=body 引导文案用；replace/delete 时才有值） */
  let targetKind: ParsedSymbol['kind'] | undefined;

  if (op === 'insert') {
    const codeLines = normalizeCode(args.code!, eol);
    let at: number; // 插入点（行索引，该行之前插）
    if (args.symbol) {
      const { qnHits, nameHits } = matchSymbols(parsed.symbols, args.symbol, args.parent);
      const hits = qnHits.length > 0 ? qnHits : nameHits;
      if (hits.length === 0) {
        throw new Error(
          `插入锚点符号未找到: ${args.symbol}。文件符号:\n` +
            parsed.symbols.map((s) => `  ${describeSymbol(s)}`).join('\n'),
        );
      }
      if (hits.length > 1) {
        throw new Error(buildAmbiguityError(hits, args.symbol, lines));
      }
      at = hits[0].end_line; // 符号最后一行的下一行
    } else {
      at = lines.length; // 文件末尾
    }
    // 插入块前后保证空行分隔（Go/TS 函数间无空行会破坏可读性甚至编译）
    const block: string[] = [];
    if (at > 0 && !isBlankLine(lines[at - 1] ?? '')) block.push(eol);
    block.push(...codeLines);
    if (!isBlankLine(lines[at] ?? '')) block.push(eol);
    lineOp = { startIdx: at, count: 0, insert: block };
  } else {
    // replace / delete：定位目标符号
    const { qnHits, nameHits } = matchSymbols(parsed.symbols, args.symbol!, args.parent);
    let hits = qnHits.length > 0 ? qnHits : nameHits;
    if (hits.length === 0 && args.parent) {
      // parent 消歧失败时提示无 parent 的命中
      const { qnHits: q2, nameHits: n2 } = matchSymbols(parsed.symbols, args.symbol!);
      const alt = [...qnHits, ...nameHits, ...q2, ...n2];
      if (alt.length > 0) {
        throw new Error(
          `symbol=${args.symbol} + parent=${args.parent} 无命中（parent 可能写错），但去掉 parent 有 ${alt.length} 候选:\n` +
            alt.map((s) => `  ${describeSymbol(s)}`).join('\n') +
            '\n请按上面候选的 parent（类名 / receiver 类型名）修正 parent 重试。',
        );
      }
    }
    if (hits.length === 0) {
      targetKind = parsed.symbols.find((s) => s.name === args.symbol!)?.kind;
      const hint = subBodyHint(targetKind);
      // 若缺命中且新 code 像裸函数体 → 多一个提示给用户引导，大概率是想改函数体却传成了 full replace
      const bodyHint = (args.code && looksLikeBareBody(args.code)) ? hint : '';
      throw new Error(
        `符号未找到: ${args.symbol}。文件符号:\n` +
          parsed.symbols.map((s) => `  ${describeSymbol(s)}`).join('\n') +
          bodyHint,
      );
    }
    if (hits.length > 1) {
      throw new Error(buildAmbiguityError(hits, args.symbol!, lines));
    }
    const target = hits[0];
    targetKind = target.kind;
    const startIdx = target.start_line - 1;
    const count = target.end_line - target.start_line + 1;
    lineOp = {
      startIdx,
      count,
      insert: op === 'delete' ? [] : normalizeCode(args.code!, eol),
    };
  }

  // ── 应用行操作 ──
  const newLines = [...lines];
  newLines.splice(lineOp.startIdx, lineOp.count, ...lineOp.insert);
  let newContent = newLines.join('');
  if (op === 'delete') {
    newContent = squeezeBlankRuns(splitKeepEnds(newContent)).join('');
    if (newContent && !newContent.endsWith(eol)) newContent += eol;
  }

  // ── 安全校验：re-parse，失败不写盘 ──
  const bodyHint = op === 'replace' && !args.sub && args.code && looksLikeBareBody(args.code) ? subBodyHint(targetKind) : '';
  const reparsed = await parseFileFull(absPath, newContent);
  if (reparsed.error) {
    throw new Error(
      `编辑后文件解析失败，已放弃（未写盘）: ${reparsed.error}\n` +
        '常见原因：新代码缩进/括号不完整、class 方法缩进层级错。请检查 code 后重试。' +
        bodyHint,
    );
  }
  const { repaired: syntaxRepaired } = await applySyntaxGate({
    absPath,
    baseline: original,
    newContent,
    blockHead: '编辑引入了语法错误（hasError false→true），已放弃（未写盘）。\n',
    blockHint:
      '常见原因：新代码括号/引号不闭合、缩进层级错、Go 少了 return。请检查 code 后重试。' + bodyHint,
    onWarning: noteSyntaxWarning,
  });
  if (op === 'replace') {
    const newName = reparsed.symbols.some(
      (s) => s.qualified_name === args.symbol || s.name === args.symbol ||
        (args.parent && s.name === args.symbol && s.parent === args.parent),
    );
    if (!newName) {
      throw new Error(
        `替换后未找到同名符号 ${args.symbol}（疑似粘贴了别的函数），已放弃（未写盘）。\n` +
          '新代码解析出的符号:\n' +
          reparsed.symbols.map((s) => `  ${describeSymbol(s)}`).join('\n') +
          bodyHint,
      );
    }
    // 重复顶层符号防御（狗食缺陷：replace 大符号时新 code 带入了旧定义的副本，
    // 新旧并存导致编译错 + 手工清理）。TS/JS 顶层同名声明本就是编译错误，直接拦。
    const dupByQn = new Map<string, number>();
    for (const s of reparsed.symbols) {
      if (s.parent === undefined) dupByQn.set(s.qualified_name, (dupByQn.get(s.qualified_name) ?? 0) + 1);
    }
    const dups = [...dupByQn.entries()].filter(([, n]) => n > 1);
    if (dups.length > 0) {
      throw new Error(
        `编辑后出现重复的顶层符号（疑似新 code 带入了既有定义的副本），已放弃（未写盘）:\n` +
          dups.map(([qn, n]) => `  ${qn} × ${n}`).join('\n') +
          '\n请从 code 中移除重复定义后重试。',
      );
    }
  }

  // ── dry_run（replace/delete/insert 已有文件）：语法门已过，只出 diff 预览，不写盘 ──
  if (args.dry_run) {
    const removed = lines.slice(lineOp.startIdx, lineOp.startIdx + lineOp.count).map((l) => l.replace(/\r?\n$/, ''));
    const added = lineOp.insert.map((l) => l.replace(/\r?\n$/, ''));
    const preview = buildGenericDiff(
      `L${lineOp.startIdx + 1}-${lineOp.startIdx + lineOp.count}（${removed.length} 行 → ${added.length} 行）`,
      removed,
      added,
    );
    return {
      message:
        `[干跑] ${op} ${relPath}（${args.symbol ?? '文件末尾'}）${drySyntaxPhrase()}，未写盘:\n${preview}`,
    };
  }

  // ── 写盘 + 索引重建（新鲜度闭环） ──
  _lastRec = txn!.commit(absPath, newContent);
  const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
  const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);

  const before = parsed.symbols.length;
  const after = reparsed.symbols.length;
  const diffNote =
    sync.symbol_diff
      ? `（符号 diff: +${sync.symbol_diff.added} -${sync.symbol_diff.removed} ~${sync.symbol_diff.changed}）`
      : '';
  const repairNote = syntaxRepaired ? '（顺手修复了原文件的语法错误 ✓）' : '';

  if (op === 'delete') {
    const delSym = args.symbol!;
    return {
      message:
        `✓ 已删除 ${relPath} 的 ${delSym}（L${lineOp.startIdx + 1} 起 ${lineOp.count} 行），` +
        `符号 ${before} → ${after}，索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}${repairNote}` + '' + assumptionNote(gateOut),
    };
  }
  if (op === 'insert') {
    const anchor = args.symbol ? `（锚点 ${args.symbol} 之后）` : '（文件末尾）';
    // ★ 2026-10-07 修：原先的条件里带了 `o.start_line === s.start_line` —— 错在**把位置当成了身份**。
    //   插入会让**插入点之后的每个符号行号整体下移** ⇒ 它们 start_line 全都不再相等 ⇒
    //   全被当成「新符号」（实测：只插 1 个函数，列表却列了 19 条，其中全是既有符号）。
    //   符号的身份是 **qualified_name**，位置只是它的属性。口径与同文件的 `symbolDiff` 对齐
    //   （那里也只比 qualified_name + 内容 hash，从不比行号）。
    const fresh = reparsed.symbols.filter((s) => !parsed.symbols.some((o) => o.qualified_name === s.qualified_name));
    return {
      message:
        `✓ 已插入 ${relPath}${anchor}，符号 ${before} → ${after}，索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}${repairNote}\n` +
        (fresh.length
          ? `新符号:\n` + fresh.map((s) => `  + ${describeSymbol(s)}`).join('\n')
          : `新符号:（无 —— 本次插入没有产生任何新 qualified_name）`),
    };
  }
  return {
    message:
      `✓ 已替换 ${relPath} 的 ${args.symbol}（原 L${lineOp.startIdx + 1}-${lineOp.startIdx + lineOp.count}，` +
      `${lineOp.count} 行 → ${lineOp.insert.length} 行），索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}${repairNote}\n` +
      `文件符号: ${before} → ${after}` + '' + assumptionNote(gateOut),
  };
}


/**
 * ★ P-B（规划书 §16.2）：`targets[]` 批量编辑的编排（**唯一实现**，`editCode` 在 `targets` 非空时分派到这里）。
 *
 * 语义（= 把 N 次单文件 `edit_code(replace_text)` 折叠成 **1 次调用**）：
 * - **逐项独立回报**：每项 `{file, ok, hit?, symbol_diff?, index_synced?, error?}`；默认一项失败不影响其余。
 * - **原子性可选**（`atomic:true`）：先对**全部**项做规划校验，任一项失败 ⇒ **整批不落盘**（全成或全不成）。
 *   ★★★ 2026-11-01（第二轮外审 P0-1）：**落盘阶段**中途失败同样整批不落盘 —— 逐项 try/catch +
 *   `batchTxn.rollback()` 用同一份写前快照还原，`close()` 在 `finally` 收尾
 *   （完整回滚 ⇒ 一条自写都不登记；回滚不全 ⇒ 只登记实际留在盘上的）。
 * - **dry_run 仍可用**：批量 dry-run **一次性给出全部预览**，不写盘。
 *
 * 为什么这样能保证「等价 + 可真原子」：
 * - **虚拟文件集**（absPath → 累积内容）按序规划：同一文件多项按序叠加，外部可观察结果与
 *   「逐次调用、每次重读磁盘」一致；但**落盘时每文件只写一次**（写闸/索引各一次）。
 * - 原子性由「**先全部规划、后统一落盘**」保证：规划阶段不碰磁盘，落盘阶段写的就是规划结果本身，不再重算。
 * - 落盘阶段的失败由「**写前快照 + 整批回滚**」兜住：`openSourceWrite` 在落盘前已拍下整批一份快照
 *   ⇒ "第 N 个失败"能逐字节回到改动前，而不是留下前 N-1 个半成品（改前就是这个病）。
 */
async function editCodeBatch(args: EditCodeArgs): Promise<{ message: string; data: EditReceipt }> {
  const targets = args.targets!;
  const projectRoot = path.resolve(args.project_dir);
  const dry = args.dry_run === true;
  const atomic = args.atomic === true;

  // [B] 收显式参数 + 「失败就抛」：空数组是调用方错误，不静默当成功
  if (targets.length === 0) {
    throw new Error('targets 是空数组（批量编辑需要至少一项 {file, old_text, new_text}）。');
  }

  interface Planned {
    file: string;
    absPath: string;
    ok: boolean;
    hit?: NonNullable<EditReceipt['hit']>;
    preview?: string;
    error?: string;
    /** ★ 2026-10-20：该项**空操作**（替换后内容与当前内容逐字相同）—— 不落盘、不进闸、不重建索引 */
    noop?: boolean;
    /** ★ 2026-11-02：该项**已应用过**（重复应用）—— 不落盘、不进闸、不重建索引 */
    alreadyApplied?: { line: number; how: ReplaceTextAppliedHow };
    /** ★ 语法门读数（基线脏 / 无解析器）：不拦，但**逐项**点名（不跨项混） */
    syntaxWarnings?: string[];
  }

  // ── 阶段 1：逐项规划（不落盘）。虚拟文件集保证同文件多目标按序叠加 ──
  const virtual = new Map<string, string>();
  const plans: Planned[] = [];
  for (const [i, t] of targets.entries()) {
    let absPath = '';
    let relPath = '';
    try {
      if (!t || typeof t.file !== 'string' || !t.file.trim()) throw new Error(`targets[${i}] 缺 file`);
      absPath = path.isAbsolute(t.file) ? t.file : path.resolve(projectRoot, t.file);
      relPath = path.relative(projectRoot, absPath).split(path.sep).join('/');
      if (typeof t.old_text !== 'string' || t.old_text.trim().length === 0) {
        throw new Error(`targets[${i}]（${relPath}）缺 old_text（要替换的唯一旧文本）`);
      }
      if (typeof t.new_text !== 'string') {
        throw new Error(`targets[${i}]（${relPath}）缺 new_text（传空串=删除该文本）`);
      }
      if (!fs.existsSync(absPath)) throw new Error(`文件不存在: ${absPath}`);
      const cur = virtual.get(absPath) ?? fs.readFileSync(absPath, 'utf8');
      const eol = detectEol(cur);
      // ★★★ 2026-11-02（幂等）：**同一条 `targets[]` 重跑必须不写盘**。判据住 `planReplaceText`（唯一汇合处，
      //   单条与批量共用同一条腿）—— 本处只把它翻成回执（不在这里再造一次判据）。
      const out = await planReplaceText(absPath, cur, eol, t.old_text, t.new_text);
      if (out.kind === 'already_applied') {
        plans.push({ file: relPath, absPath, ok: true, alreadyApplied: { line: out.line, how: out.how } });
        continue; // 内容没变 ⇒ 不推进虚拟文件集、不进闸、不落盘、不重建索引
      }
      const plan = out;
      // ★★★ 2026-10-20：空操作 ⇒ **不推进虚拟文件集**（内容没变），也不进闸/落盘/索引那一批。
      if (!plan.noop) virtual.set(absPath, plan.newContent);
      plans.push({
        file: relPath,
        absPath,
        ok: true,
        hit: plan.hit,
        preview: plan.preview,
        ...(plan.noop ? { noop: true } : {}),
        ...(plan.syntaxWarnings.length ? { syntaxWarnings: plan.syntaxWarnings } : {}),
      });
    } catch (e) {
      plans.push({
        file: relPath || String(t?.file ?? `targets[${i}]`),
        absPath,
        ok: false,
        error: (e as Error).message,
      });
    }
  }

  const succeeded = plans.filter((p) => p.ok).length;
  const failed = plans.length - succeeded;
  const blockedByAtomic = !dry && atomic && failed > 0;

  // ── 阶段 2：落盘（每文件一次；原子性回退 / dry_run 时不落盘）──
  const symbolDiffByFile = new Map<string, EditReceipt['symbol_diff']>();
  const indexStatusByFile = new Map<string, string>();
  const writtenFiles = new Set<string>();
  /** ★ 2026-10-20：闸的放行读数（干跑 / 被原子性拦下时没有 —— 那时闸根本没跑） */
  let gateNote: string | undefined;
  let gateExempted: GateExemption[] = [];
  /** ★ 2026-10-21：假设检定读数（批量是 `replace_text` ⇒ **文件级**，`symbol:null`） */
  let gateAssumption: AssumptionCheck | undefined;
  /** ★ 2026-10-28（T-#RP-3）：批量路的**批级计划读数**（统一 close() 之后才有） */
  let batchPlanReadings: { plan_exit?: string[]; plan_baseline?: string[] } = {};
  /** ★ 2026-10-22：批量路的事务（整批一次判闸 + 一份写前快照）；干跑/被原子性拦下时**不建** */
  let batchTxn: SourceWriteTxn | undefined;
  // ★★★ 2026-11-01（第二轮外审 P0-1）：批量路的**落盘失败读数** —— 声明在块外，回执要用。
  //   改前这些读数**根本没有住处**：落盘循环裸抛异常 ⇒ 连回执都不存在（`receipt = null`），
  //   读端看到的是"什么都没发生"，而不是"改了一半"。
  const landed: string[] = [];
  let landError: string | undefined;
  let landFailedAt: string | undefined;
  let rollbackReceipt: EditBatchRollback | undefined;
  let closeError: string | undefined;
  /** 仓库相对 POSIX（与本文件别处同一把尺） */
  const relOfAbs = (abs: string): string => path.relative(projectRoot, abs).split(path.sep).join('/');
  if (!dry && !blockedByAtomic) {
    // ★★★ T328 步 6：**未登记不许落盘** —— 整批先过一次闸（一次判定，失败 ⇒ 一个文件都不写）。
    // ★★ 2026-10-20：返回值**不许再丢**（豁免要在回执里点名）。
    // ★★★ 2026-10-20（A7 闭合）：同上 —— 批量路也要自报 `actor`（两处闸用**同一个** `resolveActor`）。
    // ★ 2026-10-20：**空操作项不进闸**（它不写盘，写闸管不着它；拉进来只会让不该拒的批被拒）。
    //   ★ 全批都是空操作 ⇒ 一个文件都不写 ⇒ **闸根本不跑**（那时回执也不该凭空多一个 `task_gate`，
    //     否则会印一句“没有落在项目根内的文件”去描述一件根本没发生的事）。
    const writeRels = [...new Set(plans.filter((p) => p.ok && !p.noop && !p.alreadyApplied).map((p) => p.file))];
    // ★★★ 2026-10-22：整批开一次闸 + **一份**写前快照（唯一写原语的事务形态）。
    //   ★ 与改前的**有意**差别：快照粒度从"逐文件一份"变成"整批一份" —— 同一次调用本来就是一个撤回点。
    //     它可观察（`snapshot(action="list")` 的条目数、`rollback latest` 的语义），故在此明写。
    batchTxn = writeRels.length
      ? openSourceWrite(projectRoot, writeRels, {
          label: `edit_code:batch:${writeRels.length} 文件`,
          actor: args.actor,
          authorize: args.authorize,
          // ★ 2026-10-30（fencing）：批量路同样透传代际
          leaseGeneration: args.lease_generation,
        })
      : undefined;
    gateNote = batchTxn?.task_gate;
    gateExempted = batchTxn?.exemptions ?? [];
    gateAssumption = batchTxn?.assumption_check;
    // ★★★ 2026-10-28（T-#RP-3 最后一步）：**两条收尾合一** ——
    //   ① 先把所有文件落盘（逐文件一份快照的口径不变）；
    //   ② 再**一次** `close()`：自写登记 + 写穿（含引用方重算）+ **批级计划读数** + 刷读集基线；
    //   ③ 逐文件事实（status / symbol_diff）从批级结果 `byFile` 取 —— 不再每个文件各 sync 一次。
    //   ★ 之前这里是"逐文件 commit + 逐文件 syncFile + 逐文件 reopen"，与单文件路各写一份；
    //     T245 那次修的就是它的一半（读数别扔），这次把**收尾**也合一。
    const toWrite = [...new Set(plans.filter((p) => p.ok && !p.noop && !p.alreadyApplied).map((p) => p.absPath))];
    // ★★★ 2026-11-01（第二轮外审 P0-1）：**落盘循环逐个接住异常，失败就整批回滚**。
    //   改前这里是裸 `for (…) batchTxn.commit(…)`：第 N 个文件抛错 ⇒ ① 前 N-1 个**已落盘**
    //   ② `close()` 走不到（自写登记 / 写穿一份没做）③ **异常直接上抛，连回执都没有**（`receipt = null`）。
    //   ★ 回滚实现**不新写**：`batchTxn.rollback()` 走的就是 `rename_files` 那条 `rollbackFileSnapshot`。
    for (const absPath of toWrite) {
      try {
        batchTxn!.commit(absPath, virtual.get(absPath)!);
        landed.push(relOfAbs(absPath));
      } catch (e) {
        landError = (e as Error).message;
        landFailedAt = relOfAbs(absPath);
        break;
      }
    }
    // ★★★ 2026-11-01（P0-1）：**收尾只有一个出口** —— `close()` 落在 `finally`（不留未关闭的编辑会话）。
    //   两种情形在回执里必须分得开（0.12「失败」与「没有」可区分）：
    //   · **完整回滚** ⇒ `rollback()` 把还原成功的文件从事务的 `written` 里剔掉 ⇒ `close()` **一条自写都不登记**
    //     （登记了就是"索引说变了、实际没变"的假读数）；
    //   · **回滚不全** ⇒ 剔不掉的仍在 `written` 里 ⇒ `close()` 只登记**实际留在盘上**的那些。
    let closeOutcome: ReturnType<SourceWriteTxn['close']> = null;
    try {
      if (landError !== undefined) {
        const rb = batchTxn!.rollback();
        rollbackReceipt = { ok: rb.ok, message: rb.message, restored: rb.restored, removed: rb.removed, failed: rb.failed };
      }
    } catch (e) {
      // ★ 回滚**自己**抛错也不许吞（0.12）：盘面不明就点名 —— 别让"没回滚成"读起来像"没失败"
      rollbackReceipt = {
        ok: false,
        message: `★★ 回滚**自己**抛错：${(e as Error).message} —— 盘面状态不明，请手动核对`,
        restored: [],
        removed: [],
        failed: [...landed],
      };
    } finally {
      try {
        // ★ 2026-11-02：**没有要写的文件时 `batchTxn` 根本没建**（全批已应用 / 空操作 / 全失败）——
        //   改前这里裸 `batchTxn!.close()` 会抛 "Cannot read properties of undefined"，
        //   回执于是印一句「**收尾失败**（写已落盘…）」，而实际一个字节都没落盘（0.12：假读数）。
        closeOutcome = batchTxn ? batchTxn.close() : null;
      } catch (e) {
        closeError = (e as Error).message;
      }
    }
    // ★ 仍在盘上的本次改动 = 落过盘 ∧ 没被还原（回滚不全时就是 `rollback.failed` 那几个）
    const stillOnDisk = rollbackReceipt ? landed.filter((rel) => rollbackReceipt!.failed.includes(rel)) : landed;
    const byFileOf = (closeOutcome as { byFile?: Record<string, { status: string; symbol_diff?: { added: number; removed: number; changed: number } }> } | null)?.byFile ?? {};
    for (const rel of stillOnDisk) {
      const absPath = path.join(projectRoot, rel);
      const f = byFileOf[rel];
      if (f?.symbol_diff) symbolDiffByFile.set(absPath, f.symbol_diff);
      indexStatusByFile.set(absPath, f?.status ?? 'unknown');
      writtenFiles.add(absPath);
    }
    if (closeOutcome) {
      batchPlanReadings = {
        ...(closeOutcome.plan_exit ? { plan_exit: closeOutcome.plan_exit } : {}),
        ...(closeOutcome.plan_baseline ? { plan_baseline: closeOutcome.plan_baseline } : {}),
      };
    }
    // ★★★ 2026-10-21（读集比对）：**写后刷新写者自己的基线**（与单文件那条同一把尺）——
    //   否则同一 actor 第二次写同一文件，会拿"自己上一次写之前"的指纹来比 ⇒ 假 stale。
    refreshAfterOwnWrite(
      projectRoot,
      resolveActor(args.actor),
      [...writtenFiles].map((abs) => path.relative(projectRoot, abs).split(path.sep).join('/')),
    );
  }

  // ★ 2026-10-28（T150）：**文件级读数只出现一次**（`files[]`）；条目级仅在该文件唯一时带（`perItem[i]`）
  const diffReport = planBatchDiffReport(
    Object.fromEntries([...symbolDiffByFile.entries()].map(([abs, d]) => [path.relative(projectRoot, abs).split(path.sep).join('/'), d!])),
    plans.map((p) => path.relative(projectRoot, p.absPath).split(path.sep).join('/')),
  );
  /** 文件 → 它在 `plans` 里的第一个下标（同一个文件会被写一次、但可能对应多个条目） */
  const itemIndexOf = new Map<string, number>();
  plans.forEach((p, i) => {
    const rel = path.relative(projectRoot, p.absPath).split(path.sep).join('/');
    if (!itemIndexOf.has(rel)) itemIndexOf.set(rel, i);
  });

  const items: EditBatchItem[] = plans.map((p, i) => ({
    file: p.file,
    ok: p.ok,
    written: p.ok && writtenFiles.has(p.absPath),
    ...(p.hit ? { hit: p.hit } : {}),
    // ★ 2026-10-20：空操作项逐项点名（`written:false` + `no_op:true`）—— 不许只给一个 ✓ 就算完
    ...(p.noop ? { no_op: true, index_synced: '未重建（空操作：文件内容未变）' } : {}),
    // ★ 2026-11-02：已应用过的项逐项点名（`written:false` + `already_applied`）—— 重复应用必须看得见
    ...(p.alreadyApplied
      ? { already_applied: p.alreadyApplied, index_synced: '未重建（已应用过：文件内容未变）' }
      : {}),
    ...(p.syntaxWarnings?.length ? { warnings: p.syntaxWarnings } : {}),
    // ★ 2026-10-28（T150）：条目级读数**只在"该文件在整批里唯一出现"时**才挂
    //   （否则同一文件 N 项会把同一个文件级 diff 各挂一次 ⇒ 重复记账）。
    ...(p.ok && diffReport.perItem[i] ? { symbol_diff: diffReport.perItem[i]! } : {}),
    ...(p.ok && indexStatusByFile.has(p.absPath) ? { index_synced: indexStatusByFile.get(p.absPath)! } : {}),
    ...(p.error ? { error: p.error } : {}),
  }));

  // ★ 2026-10-28（T150）：文件级读数只出现一次（\iles[]\）—— 条目级不再重复挂
  const filesDiff = diffReport.files;

  // ── 消息（供人读）：逐项一行 + 全部预览（dry-run 亦一次性给全）──
  const noopCount = plans.filter((p) => p.noop).length;
  /** ★ 2026-11-02：已应用过（重复应用）的项数 —— 与 noopCount **分开记账**（两种「没写盘」的原因不同） */
  const appliedCount = plans.filter((p) => p.alreadyApplied).length;
  // ★ 2026-10-20：全批空操作时**不许打 ✓**（那就是旧行为“骗过两个子代理”的形状）⇒ 用 `=`。
  // ★★★ 2026-11-01（P0-1）：落盘失败 / 已回滚 / 收尾失败同样**不许打 ✓** —— 那是同一个形状。
  const mark =
    dry
      ? '[干跑] '
      : blockedByAtomic || rollbackReceipt
        ? '⛔ '
        : failed > 0 || landError !== undefined || closeError !== undefined
          ? '⚠ '
          : writtenFiles.size > 0
            ? '✓ '
            : noopCount > 0 || appliedCount > 0
              ? '= '
              : '✓ ';
  const head =
    mark +
    `批量 replace_text：${plans.length} 项（成功 ${succeeded} / 失败 ${failed}）` +
    `${
      dry
        ? '，未写盘'
        : blockedByAtomic
          ? `，原子性开启且有 ${failed} 项失败 ⇒ 整批未落盘`
          : landError !== undefined
            ? `，**${landFailedAt} 文件落盘失败**（${landError}）⇒ ${
                rollbackReceipt?.ok
                  ? `已用写前快照整批回滚，项目回到改动前（落过盘 ${landed.length} 个 / 仍生效 ${writtenFiles.size} 个）`
                  : '⚠ **回滚不全**，见 rollback（项目可能停在半改状态）'
              }`
            : writtenFiles.size > 0
              ? `，已写盘 ${writtenFiles.size} 个文件${noopCount ? `（另有 ${noopCount} 项空操作，未改动、未重建索引）` : ''}${appliedCount ? `（另有 ${appliedCount} 项**已应用过**，未改动）` : ''}`
              : noopCount > 0 || appliedCount > 0
                ? `，全批 ${noopCount + appliedCount} 项均无需改动（空操作 ${noopCount} / 已应用过 ${appliedCount}）⇒ 未改动、未重建索引`
                : '，未写盘'
    }`;
  const lines: string[] = [head];
  for (const it of items) {
    if (it.ok && it.already_applied) {
      lines.push(
        `  = ${it.file} L${it.already_applied.line} **已应用过**` +
          `（${describeReplaceTextAppliedHow(it.already_applied.how)}）` +
          '⇒ 未改动、未写盘、未重建索引（同一条 targets 重跑不会再插一遍）',
      );
    } else if (it.ok && it.no_op) {
      lines.push(`  = ${it.file} L${it.hit?.start_line ?? '?'} 空操作，未改动（替换后内容与原文逐字相同；未写盘、未重建索引）`);
    } else if (it.ok && it.hit) {
      lines.push(
        `  ✓ ${it.file} L${it.hit.start_line}（L${it.hit.level}·${it.hit.label}）` +
          `${it.hit.old_lines} 行 → ${it.hit.new_lines} 行${it.written ? '' : '（未落盘）'}`,
      );
    } else {
      lines.push(`  ✗ ${it.file}：${it.error ?? '未知失败'}`);
    }
  }
  // ★ 0.12：批量路的语法门读数（基线脏 / 无解析器）—— 不拦，但必须**逐项**进人眼
  //   （改前整条批量路一个字都没有：比单文件路更静默）
  for (const it of items) for (const w of it.warnings ?? []) lines.push(`  ⚠ ${it.file}：${w}`);

  // ★★★ 2026-11-01（第二轮外审 P0-1）：**落盘失败的读数必须进人眼** —— 否则回执里
  //   "⛔ 全批未落盘"与"根本没改"同形（0.12）。两种情形**分开写**：
  //   · 完整回滚 ⇒ 明说"磁盘与改动前逐字节一致、一条自写都没登记"；
  //   · 回滚不全 ⇒ 点名**没还原成**的那几个（它们仍在盘上，且**只有它们**被登记为自写）。
  if (landError !== undefined) {
    lines.push('', `  ⛔ ${landFailedAt} 文件**落盘失败**：${landError}`);
    if (rollbackReceipt) {
      lines.push(
        rollbackReceipt.ok
          ? `  ✓ 已用**同一份写前快照**整批回滚 —— ${rollbackReceipt.message}`
          : `  ✗ **回滚不全** —— ${rollbackReceipt.message}`,
      );
      lines.push(
        `     落过盘 ${landed.length} 个：${landed.join(', ') || '（无）'}`,
        `     仍留在盘上（= 自写只登记这些）${writtenFiles.size} 个：` +
          `${[...writtenFiles].map((abs) => relOfAbs(abs)).join(', ') || '（无 ⇒ 磁盘与改动前逐字节一致，本批整笔未生效）'}`,
      );
      if (rollbackReceipt.ok) {
        lines.push('     ★ 本批**整笔未生效**：`ok:false` / `rolled_back:true` / `applied:[]`（上面那些 ✓ 已全部撤回）');
      } else {
        lines.push(
          `     ★ 未能还原 ${rollbackReceipt.failed.length} 个：${rollbackReceipt.failed.join(', ') || '（未点名）'} ⇒ 项目可能停在半改状态，请手动核对`,
        );
      }
    }
  }
  if (closeError !== undefined) {
    lines.push('', `  ⚠ **收尾失败**（写已落盘，但自写登记 / 索引写穿没跑）：${closeError}`);
  }
  // ★ 2026-10-20：空操作项**不出预览**（它的 diff 两侧逐字相同，只会让人以为“改了什么”）。
  const previews = plans.filter((p) => p.preview && !p.noop).map((p) => `— ${p.file}\n${p.preview}`);
  if (previews.length > 0) lines.push('', ...previews);
  // ★ 2026-10-28（T-#RP-3）：批级计划读数（出口闭环 / 画布新陈代谢）—— 批量路此前**一条都没有**
  for (const l of [...(batchPlanReadings.plan_exit ?? []), ...(batchPlanReadings.plan_baseline ?? [])]) lines.push('  ' + l);
  // ★★★ 2026-10-20：批量也要点名豁免（与单文件那条**同一句话**，来自 `exemptionLines`）
  if (gateExempted.length) lines.push('', exemptionLines(gateExempted));
  // ★ 2026-10-21：假设过期只在非空时加行（空不刷屏）；机器读数在 `data.assumption_check`。
  const assumptionText = assumptionLines(gateAssumption);
  if (assumptionText.length) lines.push('', ...assumptionText);

  // ★ AGENTS-RULES 0.12：批级收尾读数（`close()` 推进 `gate.warnings` 的那几条，如读集基线刷新）
  //   也必须进人眼 —— 否则 `SourceWriteReceipt.warnings` 全仓没人打印，等于没记。
  if (batchTxn?.warnings?.length) lines.push('', ...batchTxn.warnings);

  return {
    message: lines.join('\n'),
    data: {
      // ★★★ 2026-11-01（P0-1）：落盘失败 / 收尾失败 ⇒ **不是成功**（改前只看规划成败，
      //   于是"改了 1 个文件后崩了"会报 `ok:true` —— 那正是外审复现出来的那个假绿）。
      ok: failed === 0 && landError === undefined && closeError === undefined,
      op: 'batch',
      file: `${plans.length} files`,
      dry_run: dry,
      written: !dry && !blockedByAtomic && writtenFiles.size > 0,
      // ★ 2026-10-22：`task_gate` 在 `EditReceipt` 里已是**必填** ⇒ 闸没跑的那两种处境必须**说出来**
      //   （`dry_run` 不落盘 / 被 `atomic` 拦下），而不是留空字段让它看起来"没判也没事"。
      task_gate:
        gateNote ??
        '（未判闸：dry_run / 被 atomic 拦下 / 全部项已应用或空操作 ⇒ 本批一个字节都没落盘）',
      items,
      // ★ 2026-10-28（T150）：**文件级 symbol_diff 的唯一出处**（每个文件一条；条目级只在该文件唯一时带）
      files: filesDiff,
      // ★ 2026-10-28（T-#RP-3）：批级计划读数（统一 close() 之后才有；此前批量路**完全没有**这两项）
      ...batchPlanReadings,
      total: plans.length,
      succeeded,
      failed,
      // ★ 2026-11-02：已应用过的项数（重复应用）—— 与 failed / no_op 分开，读端不必靠文案判
      already_applied: appliedCount,
      atomic,
      // ★★★ 2026-11-01（P0-1）：**恒有的两格** —— 读端不该靠"字段在不在"猜有没有回滚过
      rolled_back: rollbackReceipt?.ok === true,
      applied: [...writtenFiles].map((abs) => relOfAbs(abs)),
      // ★ 以下四格**只在落盘中途失败时出现**（缺省 ≠ 回滚失败，也 ≠ 回滚成功）
      ...(landError !== undefined
        ? {
            landed: [...landed],
            ...(landFailedAt !== undefined ? { failed_at: landFailedAt } : {}),
            ...(rollbackReceipt ? { rollback: rollbackReceipt } : {}),
          }
        : {}),
      ...(closeError !== undefined ? { close_error: closeError } : {}),
      // ★ 0.12：批量路的语法门读数也要**机器可读**（非空才给）
      ...(items.some((x) => x.warnings?.length) ? { warnings: items.flatMap((x) => x.warnings ?? []) } : {}),
      ...(gateNote ? { task_gate: gateNote } : {}),
      ...(gateAssumption ? { assumption_check: gateAssumption } : {}),
    },
  };
}

/**
 * ★ P-A 外层：给**所有**返回路径补一份稳定回执（`ok/op/file/dry_run/written` 从入参派生）。
 * 内层若给了更细的 `data`（如 `replace_text` 的 `hit`/`symbol_diff`）则合并保留。
 * ★ P-B：`targets` 非空 ⇒ 分派到批量编排（自带完整回执）。
 */
/**
 * ★★★ 2026-10-28（T-#RP-3 · 结构解 B）：**写路只许有一种收尾**。
 *
 * ## 之前为什么必须"现算"
 * 正文（{@link editCodeBody}）逐分支 `txn.commit()` + 自己 `await syncFile(...)`，
 * 而批级读数（`plan_exit` / `plan_baseline`）只在 `close()` 里产生
 * ⇒ 回执拿不到 ⇒ 只能自己再算一遍（T245 查出的那层）。
 *
 * ## 现在
 * 正文只落盘、**不收尾**；事务交到这里统一 `close()`：
 * ① 自写登记 ② 写穿（读己之写立刻可信）③ **计算批级计划读数** ④ 刷写者自己的读集基线。
 * ⇒ 读数从**唯一出处**来；`renderPlanReadings` 的回退分支因此不再需要。
 *
 * ★ 范围：**单文件路**（`op=replace/insert/delete/range/replace_text`）。批量 `targets[]` 走的是
 *   另一个函数（`editCodeBatch`，它自有逐文件 sync + `files[]` 读数）—— 两路合并是下一步，见 todo T-#RP-3。
 */
async function editCodeInner(
  args: EditCodeArgs,
  gateOut?: GateReceipt,
): Promise<{ message: string; data?: unknown }> {
  let txn: SourceWriteTxn | null = null;
  const r = await editCodeBody(args, gateOut, (t) => {
    txn = t;
  });
  // ★ 唯一收尾：事务在这里关，批级读数在这里产生
  let readings = '';
  let planReadings: { plan_exit?: string[]; plan_baseline?: string[] } | null = null;
  if (txn) {
    try {
      const outcome = (txn as SourceWriteTxn).close();
      if (outcome) {
        readings = renderPlanReadings(outcome);
        planReadings = {
          ...(outcome.plan_exit ? { plan_exit: outcome.plan_exit } : {}),
          ...(outcome.plan_baseline ? { plan_baseline: outcome.plan_baseline } : {}),
        };
      }
    } catch (e) {
      readings = `\n★ 收尾失败（写已落盘，但索引写穿/计划读数没跑）：${(e as Error).message}`;
    }
  }
  return {
    message: r.message + readings,
    data: { ...((r.data as Record<string, unknown> | undefined) ?? {}), ...(planReadings ?? {}) },
  };
}

async function editCodeCore(args: EditCodeArgs): Promise<{ message: string; data: EditReceipt }> {
  if (Array.isArray(args.targets)) return editCodeBatch(args);
  const gateOut: GateReceipt = {};
  const r = await editCodeInner(args, gateOut);
  const base: EditReceipt = {
    ok: true,
    op: String(args.op),
    file: String(args.file),
    dry_run: args.dry_run === true,
    written: args.dry_run !== true,
    // ★ 2026-10-22：`EditReceipt.task_gate` 是**必填** ⇒ 干跑也要给读数（干跑不判闸、不快照、不写盘）。
    task_gate: gateOut.note ?? '（未判闸：dry_run ⇒ 不快照、不写盘）',
  };
  // ★★★ 2026-10-20（`docs/certs-4-ways.md` ③）：**豁免必须点名，不许静默** ——
  //   点名写在**人读消息**里（不只埋在 `---DATA---` 里：没人会去析 JSON 看自己是不是被豁免了）。
  const exemptNote = gateOut.exempted?.length ? `\n${exemptionLines(gateOut.exempted)}` : '';
  // ★ AGENTS-RULES 0.12：`txn.warnings` 里有收尾读数（如"读集基线刷新：算不出指纹"）——
  //   全仓此前**没有一处**打印它 ⇒ 这条读数等于不存在。这里让它进人眼。
  const warnNote = gateOut.warnings?.length ? `\n${gateOut.warnings.join('\n')}` : '';
  // ★★★ 2026-10-21（读集比对）：**写后刷新写者自己的基线** —— 否则同一 actor 第二次写会拿
  //   "自己上一次写之前"的指纹来比 ⇒ 报一条假 stale（"每次都报警" = 没人看）。
  //   ★ 只刷**本 actor**（别人的读集不动：他们确实需要知道这里变了）。
  if (base.written) refreshAfterOwnWrite(path.resolve(args.project_dir), resolveActor(args.actor), [args.file]);
  // ★ 假设过期**只在非空时**加行（空不刷屏）；机器读数恒在 `data.assumption_check`。
  const assumptionText = assumptionLines(gateOut.assumption);
  return {
    message: r.message + exemptNote + warnNote + (assumptionText.length ? `\n${assumptionText.join('\n')}` : ''),
    data: {
      ...base,
      ...((r.data as Partial<EditReceipt>) ?? {}),
      ...(gateOut.note ? { task_gate: gateOut.note } : {}),
      ...(gateOut.assumption ? { assumption_check: gateOut.assumption } : {}),
      // ★ 0.12：语法门 / 闸 / 收尾读数 —— message 里有字不够，读端要能机器判
      ...(gateOut.warnings?.length ? { warnings: gateOut.warnings } : {}),
    },
  };
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 *
 * ★★ 陷阱（已核实）：**批量模式**产物顶层 `data.file` 是拼串 `` `${n} files` ``（:984）——
 *   看着像路径、实为**文案**。故：
 *   - 批量模式（`Array.isArray(args.targets)`）**整项省略 `written_files`**（不拿那串文案凑），
 *     也省略 `symbols`（批量是逐文件 `replace_text`，没有"目标符号"这一维）。
 *   - **只有单文件模式**才回填 `written_files`，且必须**真落盘**（`r.data.written === true`）。
 */
function touchedOf(args: EditCodeArgs, r: { message: string; data: EditReceipt }): Touched {
  const touched: Touched = {};
  // 作用域类（⇒ 随时可给，不依赖成败）：入参 project_dir 必填 ⇒ 解析成绝对根。
  touched.project_dir = path.resolve(args.project_dir);

  const single = !Array.isArray(args.targets);
  // 对象类（⇒ 只有真发生才给）：单文件 + 真落盘，才谈"写了哪个文件 / 涉及哪个符号"。
  //   dry_run / 校验失败（throw，走不到这里）⇒ 整项省略（省略 ≠ 空数组）。
  if (single && r.data.written === true) {
    // written_files：口径 = **仓库相对 POSIX**。复用闸的 `toIndexKey`（同族现成助手，scaffold 同款判据）：
    //   ★ 根外文件返回 null ⇒ **不塞**（本工具的政策 #3 允许写根外文件，但那种路径没有"仓库相对"形式，
    //   塞绝对路径 = 换口径而非更弱的答案，故省略该文件；见交付报告"有条件省略"）。
    const rel = toIndexKey(path.resolve(args.project_dir), args.file);
    if (rel) touched.written_files = [rel];
    // symbols（可选）：value 取"**落定后**的符号标识"（b_terms 口径）。
    //   · replace：新代码必须仍解析出同名符号（:768 已校验）⇒ 落定后仍在，可作下游锚点；
    //   · insert：`args.symbol` 是**锚点符号**（插入点之前/之后的那个），落定后仍在 ⇒ 可给；
    //   · delete：目标符号**被删掉**，落定后已不存在 ⇒ **不给**（给了会指向一个已消失的锚点）；
    //   · range / replace_text：本就没有 `symbol` 维度 ⇒ 省略。
    if (typeof args.symbol === 'string' && args.symbol && args.op !== 'delete') {
      touched.symbols = [args.symbol];
    }
  }

  return touched;
}

export async function editCode(args: EditCodeArgs): Promise<TouchedProduct<{ message: string; data: EditReceipt }>> {
  const r = await editCodeCore(args);
  return withTouched(r, touchedOf(args, r));
}

