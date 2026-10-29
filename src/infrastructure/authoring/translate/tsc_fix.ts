/**
 * ★★★ 2026-10-29（`T-#TSC-DRIVEN-FIX` 步 2）：**用 tsc 报错当"接收者类型"的口径**，
 * 把 `recv.Prop(args)` 确定性改写成自由函数 `Type_Prop(recv, args)`。
 *
 * ## 为什么用 tsc 的报错当口径（而不是自己推断类型）
 * - `TS2339 Property 'X' does not exist on type 'Y'` **本身就把 (文件, 行, 列, 属性, 接收者类型)
 *   算好了** —— 这是**事实**，不是我的估算；
 * - 此前试过自己推断局部变量类型（`T-#REF-TYPES`）：**+0.2pp，基本无效**；
 * - 也不需要"猜覆盖"：只改 tsc **指名道姓**的位置，找不到对应自由函数就**不动**（绝不半改）。
 *
 * ## 为什么必须"改写 + 补 import"一起做（上一版教训）
 * 只改调用不补 import ⇒ 把 78 个 `TS2339` 换成 `TS2304`（总数 700→698，等于没修）。
 * ⇒ 本模块**一次做完两半**，并以「总数必须下降」为唯一验收。
 *
 * ## 为什么接收者要用 AST 取（上一版教训）
 * 文本拼接会把接收者插到已有实参前，产生 `TS2345`（参数位置/类型不匹配，实测新增 41 条）。
 * ⇒ 这里用 TS AST 取 `call.arguments` 的**原始文本**，重建成 `Target(recv, a1, a2)`。
 *
 * ## 边界（诚实）
 * - 只处理 `TS2339` 且接收者类型是**简单标识符**的那些；`{ cfg: ServerConfig }`/`[string, X]`
 *   这类匿名/元组类型**不处理**（不是方法没拍平的问题，见 todo 的四个真根因）；
 * - 只在**同目录或同文件**里找自由函数（确定性优先，不做全仓搜索）；
 * - 需要 `outDir/tsconfig.json` 存在，否则本模块 no-op（不猜）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

export interface TscFixResult {
  diags: number;
  rewritable: number;
  changed: number;
  imports: number;
  before: number;
  after: number;
  skipped: Record<string, number>;
}

/** 跑一次 tsc，返回 { log, total }（total = 错误条数，唯一红线口径） */
function runTsc(outDir: string, projDir: string): { log: string; total: number } {
  const tsconfig = path.join(projDir, 'tsconfig.json');
  const tscBin = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
  const useLocal = fs.existsSync(tscBin);
  const r = useLocal
    ? spawnSync(process.execPath, [tscBin, '-p', tsconfig, '--noEmit'], { cwd: projDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : spawnSync('npx', ['tsc', '-p', tsconfig, '--noEmit'], { cwd: outDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true });
  const log = String(r.stdout ?? '') + String(r.stderr ?? '');
  const total = (log.match(/error TS\d+/g) ?? []).length;
  return { log, total };
}

interface Diag {
  rel: string;
  line: number;
  col: number;
  prop: string;
  typeText: string;
}

export function parseTs2339(log: string): Diag[] {
  const out: Diag[] = [];
  // ★ 字符类不能含换行：`[^(]+` 会跨行吞掉前导 \n（实测 rel 变成 "\nsrc/builder.ts" ⇒ 目录判定全错）。
  const re = /^(?:src\/)?([^(\r\n]+)\((\d+),(\d+)\): error TS2339: Property '([^']+)' does not exist on type '([^']+)'/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log)) !== null) {
    out.push({
      rel: m[1].trim().replace(/^src\//, ''),
      line: Number(m[2]),
      col: Number(m[3]),
      prop: m[4],
      typeText: m[5].replace(/<.*$/, '').trim(),
    });
  }
  return out;
}

/** 收集 outDir/src 下每个文件的导出名（供"目标自由函数是否存在"判定） */
export function collectExports(srcRoot: string): Map<string, Map<string, number>> {
  const byFile = new Map<string, Map<string, number>>();
  const walk = (abs: string, rel: string): void => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(a, r);
        continue;
      }
      if (!e.name.endsWith('.ts')) continue;
      const src = fs.readFileSync(a, 'utf8');
      const sf = ts.createSourceFile(a, src, ts.ScriptTarget.ES2022, true);
      const names = new Map<string, number>();
      for (const st of sf.statements) {
        // ★ 修饰符读取要**容错**：不同 TS 版本给的是 `st.modifiers` 或 `ts.getModifiers(st)`。
        //   第一版只走 `ts.getModifiers` ⇒ 导出名**一个都没收到** ⇒ 全部被判"同目录无导出"
        //   ⇒ 后处理静默 no-op（实测 rewritable=0 而 sleep.ts 明明导出了 48 个名字）。
        const mods = (st as unknown as { modifiers?: readonly ts.Modifier[] }).modifiers ?? [];
        const hasExport =
          mods.some((x) => x.kind === ts.SyntaxKind.ExportKeyword) ||
          /^export/.test(src.slice(st.getStart(sf), st.getStart(sf) + 16));
        if (!hasExport) continue;
        if (ts.isFunctionDeclaration(st) && st.name) names.set(st.name.text, st.parameters.length);
        else if (ts.isClassDeclaration(st) && st.name) names.set(st.name.text, -1);
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name)) continue;
            const init = d.initializer;
            const arity = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init.parameters.length : -1;
            names.set(d.name.text, arity);
          }
        }
      }
      byFile.set(r, names);
    }
  };
  walk(srcRoot, '');
  return byFile;
}

/** 在该文件/行/属性处数出实参个数（AST；找不到返回 null —— 不猜） */
function countArgsAt(rel: string, line: number, prop: string): number | null {
  const abs = currentSrcRoot ? path.join(currentSrcRoot, rel) : null;
  if (!abs || !fs.existsSync(abs)) return null;
  const sf = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.ES2022, true);
  let hit: number | null = null;
  const visit = (node: ts.Node): void => {
    if (hit !== null) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === prop) {
      const { line: l } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      if (l + 1 === line) {
        hit = node.arguments.length;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hit;
}

/** 当前处理的 src 根（供 countArgsAt 用；applyTscDrivenFixes 每次设置） */
let currentSrcRoot: string | null = null;

/** 在文件里找到目标调用点（AST），返回替换区间与文本 */
function rewriteInFile(
  rel: string,
  abs: string,
  wanted: Array<{ prop: string; target: string }>,
): { edits: Array<{ start: number; end: number; text: string }>; hits: string[] } {
  const src = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.ES2022, true);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const hits: string[] = [];
  const byProp = new Map(wanted.map((w) => [w.prop, w.target]));
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const prop = node.expression.name.text;
      const target = byProp.get(prop);
      if (target) {
        const recv = node.expression.expression.getText(sf);
        const args = node.arguments.map((a) => a.getText(sf));
        const text = `${target}(${[recv, ...args].join(', ')})`;
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text });
        hits.push(target);
        return; // 不再深入该调用（避免嵌套重复）
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { edits, hits };
}

/** 把需要的名字合并进对应模块的 import（同源合并；无则插在最后一条 import 之后） */
function injectImports(abs: string, need: Map<string, Set<string>>): number {
  if (!need.size) return 0;
  let src = fs.readFileSync(abs, 'utf8');
  let lines = 0;
  for (const [ip, names] of need) {
    const esc = ip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exist = new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*'${esc}';?$`, 'm');
    const mm = exist.exec(src);
    if (mm) {
      const have = new Set(mm[1].split(',').map((x) => x.trim()).filter(Boolean));
      for (const n of names) have.add(n);
      src = src.replace(exist, `import { ${[...have].sort().join(', ')} } from '${ip}';`);
    } else {
      const line = `import { ${[...names].sort().join(', ')} } from '${ip}';`;
      const last = [...src.matchAll(/^import .*;$/gm)].pop();
      if (last) {
        const at = (last.index ?? 0) + last[0].length;
        src = src.slice(0, at) + '\n' + line + src.slice(at);
      } else {
        src = line + '\n' + src;
      }
    }
    lines++;
  }
  fs.writeFileSync(abs, src);
  return lines;
}

/**
 * 主管线后处理：跑 tsc → 改写 → 补 import → 复跑，返回前后总数。
 * **不在管线里抛错**（后处理失败就当没做，绝不改坏产物）。
 */
export function applyTscDrivenFixes(outDir: string, notes: string[]): TscFixResult | null {
  // ★ 落盘的 outDir 可能**就是** src 目录（调用方传 .../src）⇒ 自己往上找 tsconfig，
  //   srcRoot 用 outDir 本身。写死 'outDir/src' 会让后处理**静默 no-op**（第一次接线就这样白跑一趟）。
  const srcRoot = outDir;
  if (!fs.existsSync(srcRoot)) return null;
  let proj = outDir;
  let found = false;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(proj, 'tsconfig.json'))) {
      found = true;
      break;
    }
    const up = path.dirname(proj);
    if (up === proj) break;
    proj = up;
  }
  if (!found) return null;

  const { log, total: before } = runTsc(srcRoot, proj);
  const diags = parseTs2339(log);
  if (!diags.length) return { diags: 0, rewritable: 0, changed: 0, imports: 0, before, after: before, skipped: {} };

  currentSrcRoot = srcRoot;
  const exportsByFile = collectExports(srcRoot);
  const skipped: Record<string, number> = {};
  const bump = (k: string): void => {
    skipped[k] = (skipped[k] ?? 0) + 1;
  };

  // ① 逐条判定可改写（接收者类型是简单标识符 + 目标自由函数在同文件/同目录存在）
  const byFile = new Map<string, Array<{ prop: string; target: string; definedIn: string }>>();
  let rewritable = 0;
  for (const d of diags) {
    if (!/^[A-Za-z_$][\w$]*$/.test(d.typeText)) {
      bump(`类型不是简单标识符:${d.typeText.slice(0, 24)}`);
      continue;
    }
    const target = `${d.typeText}_${d.prop}`;
    // ★ 目录归一：`path.posix.dirname('sleep.ts')` 返回 `'.'`（不是 `''`）。
    //   第一版拿 `'.'` 跟 `''` 比 ⇒ **永远不等** ⇒ 全部判"同目录无导出"，后处理静默 no-op。
    const dir = path.posix.dirname(d.rel);
    const cands = [...exportsByFile.keys()].filter((f) => f === d.rel || path.posix.dirname(f) === dir);
    const definedIn = cands.find((f) => exportsByFile.get(f)?.has(target));
    if (!definedIn) {
      bump(`同目录无导出:${target}`);
      continue;
    }
    // ★ 参数个数守卫：自由函数 = `目标(接收者, ...实参)` ⇒ 元数必须恰好是实参数 + 1。
    //   第一版没这道守卫 ⇒ 接收者被插进签名对不上的函数，产生了 **42 个 TS2345**（此消彼长）。
    const arity = exportsByFile.get(definedIn)?.get(target) ?? -1;
    const argCount = countArgsAt(d.rel, d.line, d.prop);
    if (arity >= 0 && argCount !== null && arity !== argCount + 1) {
      bump(`元数不符:${target}(${arity}≠${argCount}+1)`);
      continue;
    }
    if (!byFile.has(d.rel)) byFile.set(d.rel, []);
    byFile.get(d.rel)!.push({ prop: d.prop, target, definedIn });
    rewritable++;
  }

  // ② 改写 + 补 import
  let changed = 0;
  let imports = 0;
  for (const [rel, list] of byFile) {
    const abs = path.join(srcRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const { edits, hits } = rewriteInFile(rel, abs, list);
    if (!edits.length) continue;
    let src = fs.readFileSync(abs, 'utf8');
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      src = src.slice(0, e.start) + e.text + src.slice(e.end);
    }
    fs.writeFileSync(abs, src);
    changed += edits.length;

    const need = new Map<string, Set<string>>();
    for (const h of new Set(hits)) {
      const def = list.find((x) => x.target === h);
      if (!def || def.definedIn === rel) continue;
      const ip = (() => {
        const r = path.posix.relative(path.posix.dirname(rel), def.definedIn).replace(/\.ts$/, '');
        return r.startsWith('.') ? r : './' + r;
      })();
      if (!need.has(ip)) need.set(ip, new Set());
      need.get(ip)!.add(h);
    }
    imports += injectImports(abs, need);
  }

  const { total: after } = runTsc(srcRoot, proj);
  const res: TscFixResult = { diags: diags.length, rewritable, changed, imports, before, after, skipped };
  const top = Object.entries(skipped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${v}× ${k}`)
    .join(' · ');
  notes.push(
    `tsc 驱动改写：诊断 ${res.diags} · 可改 ${rewritable} · 实改 ${changed} · 补 import ${imports} · ` +
      `总数 ${before}→${after}${top ? ` · 跳过主因 ${top}` : ''}`,
  );
  return res;
}
