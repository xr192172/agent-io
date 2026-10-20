/**
 * go_tests —— 仓库自带 Go 测试的发现与表驱动用例抽取（"有测试 ⇒ 跑同一批输入"的输入端）
 *
 * 判据（用户裁定）：翻译是否成功看**功能是否达成** —— 同一批输入，Go 原函数与 TS
 * 翻译函数输出逐条一致。输入从哪来？**优先仓库自己的测试**，其次调用方显式给；
 * 两者都没有 ⇒ 只能跑自动生成的冒烟样例，且回执必须报「未验证」。
 *
 * 诚实边界（写清，别被"看起来有测试"骗）：
 *   · 只发现**同目录**的 `*_test.go`（Go 测试与被测代码同包同目录，这是惯用法）；
 *   · 只抽**字面量表驱动**用例（int/float/string/bool，按字段名或位置对到参数名）；
 *   · 抽不到 ⇒ 返回空 cases + note 说明为什么（**绝不拿生成的样例冒名成仓库测试**）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAstRoot, type SyntaxNodeLike } from '../../parse/index.js';
import type { BehaviorCase } from '../behavior/index.js';
import type { TranslateParam } from './unit.js';

/** 单个函数最多抽多少条用例（有界，防超大表把对拍拖成分钟级） */
const MAX_CASES = 50;

/** 仓库里被看到的 Go 测试（file 为绝对路径；回执只做展示） */
export interface GoTestRef {
  file: string;
  line: number;
  func: string;
  /** 从该测试抽到的用例数（0 = 看到了、也调用了目标函数，但抽不出字面量） */
  cases: number;
}

export interface HarvestResult {
  cases: BehaviorCase[];
  tests: GoTestRef[];
  notes: string[];
}

/** 同目录下的 *_test.go（没有 = 这个文件在仓库里没有测试） */
export function findGoTestFiles(goFileAbs: string): string[] {
  const dir = path.dirname(goFileAbs);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('_test.go'))
    .sort()
    .map((n) => path.join(dir, n));
}

function walkType(node: SyntaxNodeLike, type: string, out: SyntaxNodeLike[]): void {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type === type) out.push(c);
    walkType(c, type, out);
  }
}

function topLevelFuncs(root: SyntaxNodeLike): SyntaxNodeLike[] {
  const out: SyntaxNodeLike[] = [];
  for (let i = 0; i < root.childCount; i++) {
    const c = root.child(i);
    if (c && c.type === 'function_declaration') out.push(c);
  }
  return out;
}

function nameOfFunc(node: SyntaxNodeLike): string {
  try {
    return node.childForFieldName('name')?.text ?? '';
  } catch {
    return '';
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在括号/引号深度 0 处按分隔符切（`{"a,b", x}` 里的逗号不会被切坏） */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote !== '`') {
        i++;
        cur += s[i] ?? '';
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

/** `[]struct{ name string; a, b int }` → ['name','a','b']（嵌入字段跳过：无法按键取值） */
function structFieldNames(typeText: string): string[] {
  const open = typeText.indexOf('{');
  const close = typeText.lastIndexOf('}');
  if (open < 0 || close <= open) return [];
  const names: string[] = [];
  // ★ Go 的字段分隔是**换行**（分号由编译器自动插入，源码里通常没有）⇒ 先归一成 ';' 再切
  const body = typeText.slice(open + 1, close).replace(/[\r\n]+/g, ';');
  for (const decl of splitTopLevel(body, ';')) {
    const d = decl.trim();
    if (!d) continue;
    const m = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+\S/.exec(d);
    if (!m) continue; // 嵌入字段 / 无法解析
    for (const n of m[1].split(',')) names.push(n.trim());
  }
  return names;
}

/** Go 字面量 → JS 值；只收确定性的标量（其余如实拒收，不猜） */
function parseGoLiteral(raw: string): { ok: true; value: unknown } | { ok: false } {
  const t = raw.trim();
  if (/^-?\d+$/.test(t)) return { ok: true, value: Number(t) };
  if (/^-?\d*\.\d+(?:[eE][+-]?\d+)?$/.test(t)) return { ok: true, value: Number(t) };
  if (t === 'true' || t === 'false') return { ok: true, value: t === 'true' };
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) {
    try {
      return { ok: true, value: JSON.parse(t) };
    } catch {
      return { ok: false };
    }
  }
  const rawStr = /^`([\s\S]*)`$/.exec(t);
  if (rawStr) return { ok: true, value: rawStr[1] };
  return { ok: false };
}

/** 摊平一层嵌套字面量（`args{a: 1, b: 2}` / `{1, 2}`）——覆盖 Go 表驱动最常见的两种写法 */
function absorbNested(text: string, values: Map<string, string>): void {
  const open = text.indexOf('{');
  if (open < 0) return;
  const close = text.lastIndexOf('}');
  if (close <= open) return;
  for (const part of splitTopLevel(text.slice(open + 1, close), ',')) {
    const p = part.trim();
    if (!p) continue;
    const kv = /^([A-Za-z_]\w*)\s*:\s*([\s\S]+)$/.exec(p);
    if (!kv) continue;
    if (!values.has(kv[1])) values.set(kv[1], kv[2].trim());
    absorbNested(kv[2], values);
  }
}

/** 从一个 Test 函数体里抽表驱动用例；抽不出返回 []（原因写进 notes） */
function harvestFromTest(testFunc: SyntaxNodeLike, funcName: string, params: TranslateParam[], notes: string[]): BehaviorCase[] {
  const blocks: SyntaxNodeLike[] = [];
  walkType(testFunc, 'composite_literal', blocks);
  const cases: BehaviorCase[] = [];
  const seen = new Set<string>();
  for (const blk of blocks) {
    let typeText = '';
    let bodyText = '';
    try {
      typeText = blk.childForFieldName('type')?.text ?? '';
      bodyText = blk.childForFieldName('body')?.text ?? '';
    } catch {
      continue;
    }
    if (!typeText.startsWith('[]') || !typeText.includes('struct')) continue;
    const fields = structFieldNames(typeText);
    if (!fields.length) continue;
    const inner = bodyText.replace(/^\{/, '').replace(/\}$/, '');
    for (const elem of splitTopLevel(inner, ',')) {
      if (cases.length >= MAX_CASES) break;
      const e = elem.trim();
      if (!/^\{[\s\S]*\}$/.test(e)) continue;
      const values = new Map<string, string>();
      let pos = 0;
      let shaped = true;
      for (const part of splitTopLevel(e.slice(1, -1), ',')) {
        const p = part.trim();
        if (!p) continue;
        const kv = /^([A-Za-z_]\w*)\s*:\s*([\s\S]+)$/.exec(p);
        if (kv) {
          values.set(kv[1], kv[2].trim());
          continue;
        }
        while (pos < fields.length && values.has(fields[pos])) pos++;
        if (pos >= fields.length) {
          shaped = false;
          break;
        }
        values.set(fields[pos], p);
        pos++;
      }
      if (!shaped) continue;
      for (const v of [...values.values()]) absorbNested(v, values);
      const args: unknown[] = [];
      let complete = true;
      for (const pm of params) {
        const raw = values.get(pm.name);
        if (raw === undefined) {
          complete = false;
          break;
        }
        const lit = parseGoLiteral(raw);
        if (!lit.ok) {
          complete = false;
          break;
        }
        args.push(lit.value);
      }
      if (!complete) continue;
      const key = JSON.stringify(args);
      if (seen.has(key)) continue;
      seen.add(key);
      const labelRaw = values.get('name');
      const label = labelRaw ? parseGoLiteral(labelRaw) : { ok: false as const };
      cases.push({ name: label.ok ? String(label.value) : `${funcName}#${cases.length}`, args });
    }
  }
  void funcName;
  return cases;
}

/**
 * 为一组待译函数抽用例（每个测试文件只解析一次）。
 * 返回 unit 名 → { cases, tests, notes }；没有 *_test.go 时逐条写明「仓库无测试」。
 */
export async function harvestForUnits(
  testFiles: string[],
  funcs: { name: string; params?: TranslateParam[]; /** 方法单元的原始方法名：测试里是 \`c.Double()\`，不是 \`Counter_Double()\` */ methodName?: string }[],
): Promise<Map<string, HarvestResult>> {
  const out = new Map<string, HarvestResult>();
  for (const f of funcs) out.set(f.name, { cases: [], tests: [], notes: [] });
  if (!testFiles.length) {
    for (const r of out.values()) r.notes.push('同目录没有 *_test.go（仓库无测试 ⇒ 对照测试无从谈起，只能报未验证）');
    return out;
  }
  for (const file of testFiles) {
    let src = '';
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const parsed = await parseAstRoot(file, src);
    if (!parsed?.root) {
      for (const r of out.values()) r.notes.push(`${path.basename(file)} 解析失败（tree-sitter）⇒ 未取用例`);
      continue;
    }
    const tests = topLevelFuncs(parsed.root).filter((n) => nameOfFunc(n).startsWith('Test'));
    for (const [unitName, res] of out) {
      const spec = funcs.find((f) => f.name === unitName);
      const params = spec?.params ?? [];
      for (const t of tests) {
        const tname = nameOfFunc(t);
        const calledDirectly = new RegExp(`\\b${escapeRe(unitName)}\\s*\\(`).test(t.text);
        // ★ 方法被折成 Type_Method，但仓库测试调用的是 c.Double() ⇒ 还要按方法名找。
        //   边界：只按方法名匹配，可能命中**同名的别的 receiver** 的方法测试 ⇒ 记一条 note。
        const calledAsMethod = !!spec?.methodName && new RegExp(`\\.\\s*${escapeRe(spec.methodName)}\\s*\\(`).test(t.text);
        if (!calledDirectly && !calledAsMethod) continue; // 没调到目标函数 ⇒ 不相关
        if (!calledDirectly && calledAsMethod) {
          res.notes.push(`${path.basename(file)}:${t.startPosition.row + 1} ${tname} 按方法名 .${spec!.methodName}( 匹配（可能跨 receiver 同名，需人工核）`);
        }
        if (params.length === 0) {
          if (res.cases.length >= MAX_CASES) continue;
          res.tests.push({ file, line: t.startPosition.row + 1, func: tname, cases: 1 });
          res.cases.push({ name: `${tname}#noargs`, args: [] });
          continue;
        }
        const ref: GoTestRef = { file, line: t.startPosition.row + 1, func: tname, cases: 0 };
        const got = harvestFromTest(t, unitName, params, res.notes);
        ref.cases = got.length;
        res.tests.push(ref);
        for (const c of got) {
          if (res.cases.length >= MAX_CASES) break;
          res.cases.push(c);
        }
        if (got.length === 0) {
          res.notes.push(`${path.basename(file)}:${ref.line} ${tname} 调用了 ${unitName}，但抽不出字面量表驱动用例（字段名与参数名不匹配 / 用了变量）`);
        }
      }
    }
  }
  return out;
}
