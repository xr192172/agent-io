/**
 * observe · **Python 插桩语言包**（第 3 门语言，2026-10-15）。
 *
 * 骨架（`instrument_skeleton.ts`：主流程 + ③ `applyInsertions` + 备份/写盘/幂等）**一行不改**，
 * 加一门语言只写本文件。分节即三个钩子：
 *   ① **命名规则** `lambdaName` / `scanFunctions` 的 qualname —— 含**所属**与**位置**
 *   ② **遍历模型** `scanFunctions` —— 所有「函数」节点及其 body 范围
 *   ⑥ **取值时机** `collectReturns` / `returnExprOf` —— `return` 怎么读返回值
 * 其余是**每语言必需的语法管道**：幂等标记、探针 import、项目根路标、数函数、语句渲染。
 *
 * ★ Python 与 TS 的三处**真差异**：① 无大括号 ⇒ 靠**缩进**，单行 suite（`def f(): return 1` /
 * `if c: return x`）不能塞换行 ⇒ 退回 `;`；② `lambda` 体是**表达式** ⇒ 包成 `cam_lambda(...)`
 * （对应 TS 的"表达式体箭头"）；③ 多返回值 `return a, b` 是 `expression_list` ⇒ `T = a, b`
 * 天然 tuple、语义不变；裸 `return` 与生成器（`yield`）另判。
 */

import fs from 'node:fs';
import path from 'node:path';
import { isNoiseFileName, skipDirSet } from '../../parse/source_exts.js';
import {
  instrumentFileWithHooks,
  type AstNode,
  type CollectSitesCtx,
  type InstrumentHooks,
  type Insertion,
} from './instrument_skeleton.js';
import type { InstrumentFileResult, InstrumentOptions } from './instrument.js';

/** ★ 唯一落点：Python 探针运行时目录（相对 agent-io 仓库根）。 */
const PROBE_DIR_REL = 'observe-lang-py';
const PROBE_MODULE = 'camprobe';
const MARKER = 'observe:instrumented';
const DEEP_MARKER = 'observe:deep';
/** `async def` 也是 `function_definition`（`async` 是子 token）。 */
const FN_TYPES = new Set(['function_definition', 'lambda']);

/** 是否可插桩的 Python 源文件（`.py` 且不是噪音产物）。 */
export function isInstrumentablePyFile(rel: string): boolean {
  return rel.endsWith('.py') && !isNoiseFileName(path.basename(rel));
}

/** 递归收集项目下所有可插桩的 .py（跳过 node_modules/dist/.git/__pycache__ 等）。 */
export function collectPyFiles(root: string): string[] {
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
      else if (e.isFile() && isInstrumentablePyFile(e.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** 对项目下所有 .py 插桩（骨架主流程逐文件跑）。 */
export async function instrumentPyProject(root: string, opts: InstrumentOptions = {}): Promise<InstrumentFileResult[]> {
  const results: InstrumentFileResult[] = [];
  for (const f of collectPyFiles(root)) {
    results.push(await instrumentFileWithHooks(f, pyInstrumentHooks, { ...opts, backupRoot: root }));
  }
  return results;
}

// ── 骨架钩子（★ 语言专属装配点） ──────────────────────────────

export const pyInstrumentHooks: InstrumentHooks = {
  lang: 'python',
  markers: { core: MARKER, deep: DEEP_MARKER },
  comment: '#',
  probeImport: (file, projectRoot) => relProbeDir(file, projectRoot),
  inferProjectRoot: (file) => inferPyProjectRoot(file),
  buildImportStmt: (spec) => buildPyImportStmt(spec),
  countFunctions: (root) => countPyFunctions(root),
  collectSites: (ctx) => collectPySites(ctx),
};

/** 从 file 目录到探针目录（`<projectRoot>/observe-lang-py`）的相对路径（posix）。 */
function relProbeDir(file: string, projectRoot: string): string {
  const rel = path.relative(path.dirname(file), path.join(projectRoot, PROBE_DIR_REL)).replaceAll('\\', '/');
  return rel || '.';
}

/** 向上找含 `observe-lang-py/camprobe.py` 的项目根；找不到**响亮抛**（不静默兜底）。 */
export function inferPyProjectRoot(file: string): string {
  let dir = path.dirname(file);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, PROBE_DIR_REL, `${PROBE_MODULE}.py`))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `推断不出 agent-io 仓库根：从 ${file} 向上 8 层都没找到路标 \`${PROBE_DIR_REL}/${PROBE_MODULE}.py\` ` +
      `⇒ 无法算出探针模块位置。★ 请**显式传** \`project_root\`（= agent-io 仓库根）。`,
  );
}

/** 头部 import：Python 无"相对 import 说明符"⇒ 用 `__file__` 相对路径把探针目录插进 `sys.path`。 */
function buildPyImportStmt(spec: string): string {
  return (
    `import os as __cam_os, sys as __cam_sys\n` +
    `__cam_sys.path.insert(0, __cam_os.path.normpath(__cam_os.path.join(__cam_os.path.dirname(__cam_os.path.abspath(__file__)), ${JSON.stringify(spec)})))\n` +
    `from ${PROBE_MODULE} import capture_probe, cam_lambda  # noqa: E402\n`
  );
}

/** 数函数节点（台账判据③用）：`function_definition` + `lambda`，含嵌套。 */
function countPyFunctions(n: AstNode): number {
  let c = FN_TYPES.has(n.type) ? 1 : 0;
  for (let i = 0; i < n.childCount; i++) {
    const ch = n.child(i);
    if (ch) c += countPyFunctions(ch);
  }
  return c;
}

// ── ② 遍历模型：所有「函数」节点及其 body 范围（方法/嵌套/lambda/async def） ──

interface PyFn {
  node: AstNode;
  kind: 'def' | 'lambda';
  name: string; // 探针名基（已含所属：`Class.method` / `outer.inner`）
  params: string[];
  body: AstNode | null;
}

function scanFunctions(root: AstNode): PyFn[] {
  const out: PyFn[] = [];
  const walk = (n: AstNode, owner: string, parent?: AstNode): void => {
    if (n.type === 'function_definition') {
      const nm = n.childForFieldName?.('name')?.text ?? '';
      const qual = owner ? `${owner}.${nm}` : nm;
      const body = n.childForFieldName?.('body') ?? null;
      out.push({ node: n, kind: 'def', name: qual, params: paramNames(n), body });
      if (body) for (let i = 0; i < body.childCount; i++) { const c = body.child(i); if (c) walk(c, qual, body); }
      return;
    }
    if (n.type === 'class_definition') {
      const nm = n.childForFieldName?.('name')?.text ?? '';
      const qual = owner ? `${owner}.${nm}` : nm;
      const body = n.childForFieldName?.('body') ?? null;
      if (body) for (let i = 0; i < body.childCount; i++) { const c = body.child(i); if (c) walk(c, qual, body); }
      return;
    }
    if (n.type === 'lambda') {
      out.push({ node: n, kind: 'lambda', name: lambdaName(n, owner, parent), params: paramNames(n), body: n.childForFieldName?.('body') ?? null });
      return;
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, owner, n); }
  };
  walk(root, '');
  return out;
}

/** ① 命名规则：lambda 名基。★ 教训（T263/T277/T298）：合成名必须含**所属**与**位置**。 */
function lambdaName(node: AstNode, owner: string, parent?: AstNode): string {
  if (parent && parent.type === 'assignment') {
    const left = parent.childForFieldName?.('left');
    if (left && left.type === 'identifier') return owner ? `${owner}.${left.text}` : left.text;
  }
  const anon = `anon@L${node.startPosition.row + 1}C${node.startPosition.column + 1}`;
  return owner ? `${owner}.${anon}` : anon;
}

/** 参数名（`parameters` / `lambda_parameters`；跳过 self/cls）。 */
function paramNames(fn: AstNode): string[] {
  const params = fn.childForFieldName?.('parameters');
  if (!params) return [];
  const out: string[] = [];
  for (let i = 0; i < params.childCount; i++) {
    const p = params.child(i);
    if (!p) continue;
    const name = firstIdent(p);
    if (name && name !== 'self' && name !== 'cls' && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 节点下第一个 identifier（覆盖 `typed_parameter` / `default_parameter` / `*args`）。 */
function firstIdent(n: AstNode, depth = 0): string | null {
  if (n.type === 'identifier') return n.text;
  if (depth > 4) return null;
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (!c) continue;
    const r = firstIdent(c, depth + 1);
    if (r) return r;
  }
  return null;
}

// ── ⑥ 取值时机：`return` 怎么读返回值（多返回值 / 裸 return / 生成器） ──

/** 收集函数体内所有 return（**不进嵌套函数/lambda/类**）。 */
function collectReturns(body: AstNode): AstNode[] {
  const out: AstNode[] = [];
  const walk = (n: AstNode): void => {
    if (n.type === 'return_statement') { out.push(n); return; }
    if (n.type === 'function_definition' || n.type === 'lambda' || n.type === 'class_definition') return;
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c); }
  };
  for (let i = 0; i < body.childCount; i++) { const c = body.child(i); if (c) walk(c); }
  return out;
}

/** 取返回值表达式（null = 裸 `return`）。★ `return_statement` **无字段名** ⇒ 取最后一个子节点。 */
function returnExprOf(ret: AstNode): AstNode | null {
  if (ret.childCount === 0) return null;
  const last = ret.child(ret.childCount - 1);
  return !last || last.type === 'return' ? null : last;
}

// ── 收集编辑（② 遍历 → 逐函数注入 enter/exit；渲染 Python 语句） ──

function collectPySites(ctx: CollectSitesCtx): void {
  const { root, file, content, fileRel, probes, insertions } = ctx;
  const mod = path.basename(file).replace(/\.py$/, '');
  for (const fn of scanFunctions(root)) {
    const base = `${mod}.${fn.name}`;
    if (fn.kind === 'lambda') collectLambdaSite(fn, base, file, content, fileRel, probes, insertions);
    else collectDefSites(fn, base, file, content, fileRel, probes, insertions);
  }
}

function collectDefSites(fn: PyFn, base: string, file: string, content: string, fileRel: string, probes: string[] | undefined, insertions: Insertion[]): void {
  const body = fn.body;
  if (!body) return;
  const line = fn.node.startPosition.row + 1;
  if (matchContract(`${base}.enter`, probes)) {
    const { indent, inline } = indentInfo(content, body.startIndex);
    const call = probeCall(`${base}.enter`, [['file', str(fileRel)], ['args', pyDict(fn.params.map((p) => [p, p]))], ['level', str('core')]]);
    insertions.push({ index: body.startIndex, site: { probe: `${base}.enter`, file, line, kind: 'enter', level: 'core', injected: `${inline ? '\n' + indent : ''}${call}\n${indent}` } });
  }
  const returns = collectReturns(body);
  if (returns.length === 0) {
    // 无显式 return（普通函数 / `__init__` / 生成器）⇒ 函数体末尾补出口探针
    if (matchContract(`${base}.exit`, probes)) {
      const { indent, inline } = indentInfo(content, body.startIndex);
      const call = probeCall(`${base}.exit`, [['file', str(fileRel)], ['ret', 'None'], ['level', str('core')]]);
      insertions.push({ index: body.endIndex, site: { probe: `${base}.exit`, file, line, kind: 'exit', level: 'core', injected: `${inline ? '; ' : '\n' + indent}${call}` } });
    }
    return;
  }
  for (const ret of returns) handleReturnSite(ret, `${base}.exit`, file, content, fileRel, probes, insertions);
}

function handleReturnSite(ret: AstNode, probeName: string, file: string, content: string, fileRel: string, probes: string[] | undefined, insertions: Insertion[]): void {
  if (!matchContract(probeName, probes)) return;
  const line = ret.startPosition.row + 1;
  const expr = returnExprOf(ret);
  // ★ 单行 suite（`if c: return x`）不能塞换行 ⇒ 退回 `;` 分隔（同 TS 侧 T273，形态不同）
  const { indent, inline } = indentInfo(content, ret.startIndex);
  const sep = inline ? '; ' : '\n' + indent;
  if (!expr) {
    const call = probeCall(probeName, [['file', str(fileRel)], ['ret', 'None'], ['level', str('core')]]);
    insertions.push({ index: ret.startIndex, removeTo: ret.endIndex, site: { probe: probeName, file, line, kind: 'exit', level: 'core', injected: `${call}${sep}return` } });
    return;
  }
  const tv = `__cam_ret_${ret.startPosition.row + 1}_${ret.startPosition.column + 1}`;
  // 两段法（同 TS 侧 T270/T300）：`return <expr>` → `T = <expr>` + `<probe>; return T` ⇒ 单次求值
  insertions.push({ index: ret.startIndex, removeTo: expr.startIndex, site: { probe: probeName, file, line, kind: 'exit', level: 'core', injected: `${tv} = ` } });
  const call = probeCall(probeName, [['file', str(fileRel)], ['ret', tv], ['level', str('core')]]);
  insertions.push({ index: expr.endIndex, removeTo: ret.endIndex, site: { probe: probeName, file, line, kind: 'exit', level: 'core', injected: `${sep}${call}${sep}return ${tv}` } });
}

/** lambda：体是**表达式** ⇒ 包成 `cam_lambda(...)`（同发 enter+exit 并原样返回）。`template` 接住内层编辑。 */
function collectLambdaSite(fn: PyFn, base: string, file: string, content: string, fileRel: string, probes: string[] | undefined, insertions: Insertion[]): void {
  const wantEnter = matchContract(`${base}.enter`, probes);
  const wantExit = matchContract(`${base}.exit`, probes);
  const body = fn.body;
  if ((!wantEnter && !wantExit) || !body) return;
  const args = pyDict(fn.params.map((p) => [p, p]));
  const build = (inner: string): string =>
    `cam_lambda(${str(base)}, ${args}, (${inner})${wantEnter ? '' : ', emit_enter=False'}${wantExit ? '' : ', emit_exit=False'})`;
  insertions.push({
    index: body.startIndex,
    removeTo: body.endIndex,
    site: {
      probe: base + (wantEnter ? '.enter' : '.exit'),
      extraProbes: wantEnter && wantExit ? [`${base}.exit`] : undefined,
      file,
      line: fn.node.startPosition.row + 1,
      kind: wantEnter ? 'enter' : 'exit',
      level: 'core',
      injected: build(content.slice(body.startIndex, body.endIndex)),
      template: build,
    },
  });
}

// ── 语法管道小件 ──────────────────────────────────────────────

/** 契约门：probes 为 undefined ⇒ 探索模式恒 true。 */
function matchContract(name: string, probes?: string[]): boolean {
  return probes === undefined || probes.includes(name);
}

/** 该偏移处的缩进；★ 本行在它之前**已有代码**（单行 suite）⇒ `inline=true`，注入走 `;`。 */
function indentInfo(content: string, index: number): { indent: string; inline: boolean } {
  const ls = content.lastIndexOf('\n', index - 1) + 1;
  const pre = content.slice(ls, index);
  if (/^[ \t]*$/.test(pre)) return { indent: pre, inline: false };
  return { indent: (/^[ \t]*/.exec(content.slice(ls))?.[0] ?? '') + '    ', inline: true };
}

const str = (s: string): string => JSON.stringify(s);
/** Python dict 字面量（键为字符串字面量）。 */
const pyDict = (entries: Array<[string, string]>): string => `{${entries.map(([k, v]) => `${str(k)}: ${v}`).join(', ')}}`;
/** 一条探针调用语句：`capture_probe('<name>', {...})`。 */
const probeCall = (name: string, fields: Array<[string, string]>): string => `capture_probe(${str(name)}, ${pyDict(fields)})`;
