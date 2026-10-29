/**
 * ★★★ 2026-10-29（T-#STD-TERMS-AUTO）：语言层名词表**从适配模块的实际导出**取，不手写。
 *
 * ## 为什么必须这样
 * 手写表的根本问题不是麻烦，是**会漂移**：表里写 `Context` 支持，`_go_std/context.ts` 里其实没导出
 * ⇒ 册子判定"已覆盖"，下游拿不到名字 ⇒ **又一次假绿**（今天已栽 5 次）。
 * 改成从 `renderGoStdAdapter(pkg)` 的**导出面**生成：**表就是实现的投影**，不可能不一致。
 *
 * ## 边界（用户定的规矩）
 * · 本文件的表**只放语言层**（Go 标准库/标准概念 ↔ TS 适配模块）；
 * · **项目自己的领域词一律不进这里**，随项目配置走（`<proj>/.agent-io/design/<f>.translate.json` 的 `types[]`）；
 * · 这条由证 `t450` 强制检查（语言表里出现项目词 ⇒ 报红）。
 */
import { renderGoStdAdapter } from './go_std.js';

/** Go std 包 → TS 适配模块里导出的名字集合（从生成源码的**导出面**取） */
export function deriveStdExports(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const PKGS = [
    'strings', 'time', 'os', 'filepath', 'fmt', 'json', 'context', 'sort', 'log', 'sync', 'errors',
    'slices', 'signal', 'syscall', 'atomic', 'heap', 'unicode', 'strconv', 'math', 'sha256', 'hex',
    'fnv', 'bytes', 'bufio', 'runtime', 'norm', 'exec', 'io', 'sql', 'http', 'mem', 'ort',
  ];
  for (const pkg of PKGS) {
    const src = renderGoStdAdapter(pkg);
    if (!src) continue;
    const names = new Set<string>();
    // 导出面：`export const X` / `export function X` / `export class X` / `export interface X`
    const re = /export\s+(?:const|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
    // `export const { a, b }` 形式少见，这里不处理（若出现会在 t450 里暴露为"缺名"）
    out.set(pkg, names);
  }
  return out;
}

/** 语言层已决策的名字 → 目标侧名字（`null` = 明确无对应） */
export interface LangTermDecision {
  /** 目标侧名字；null = 明确没有对应 */
  to: string | null;
  /** 依据：哪个适配模块的导出（对账用；包名本身则填 `pkg:<name>`） */
  from: string;
}

/**
 * 生成语言层名词表：**只收"适配模块真的导出了"的名字**。
 * ⇒ 表与实现同源，不可能出现"说支持但没实现"。
 */
export function buildLangTerms(): Record<string, LangTermDecision> {
  const table: Record<string, LangTermDecision> = {};
  const exportsByPkg = deriveStdExports();

  // ① 包名 → 同名（TS 侧 `import * as pkg from './_go_std/pkg'`）
  for (const pkg of exportsByPkg.keys()) table[pkg] = { to: pkg, from: `pkg:${pkg}` };

  // ② 标准类型名 → 同名（**只在某个适配模块真的导出它时**才收）
  const TYPE_LIKE = [
    'Context', 'Request', 'ResponseWriter', 'Cmd', 'File', 'FileInfo', 'DirEntry',
    'Scanner', 'Reader', 'Writer', 'Mutex', 'RWMutex', 'Once', 'WaitGroup', 'Ticker',
    'Form', 'Interface', 'Hash64a', 'ServeMux',
  ];
  for (const name of TYPE_LIKE) {
    for (const [pkg, set] of exportsByPkg) {
      if (set.has(name)) {
        table[name] = { to: name, from: `${pkg}#${name}` };
        break;
      }
    }
  }

  // ③ 语义不同、必须换名的（语言层决策；每条都要写明依据）
  table['Time'] = { to: 'number', from: 'time#Time（epoch ms）' };

  // ④ 明确"无对应"（判 null，仍算已决定、不阻塞）
  table['mem'] = { to: null, from: 'mem（cgo 内存 API）' };
  table['Pointer'] = { to: null, from: 'mem#Pointer' };

  return table;
}

/** 语言层词表（快照，供 book 使用；由 `buildLangTerms` 生成，不手写） */
export const GO_TS_LANG_TERMS: Record<string, string | null> = Object.fromEntries(
  Object.entries(buildLangTerms()).map(([k, v]) => [k, v.to]),
);

export function langTermCount(): number {
  return Object.keys(GO_TS_LANG_TERMS).length;
}
