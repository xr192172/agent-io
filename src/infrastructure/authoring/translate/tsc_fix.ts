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
 * - tsc 的**输入必须是本次产物**：在被改写目录里生成一份只覆盖它自己的 tsconfig（`include: **\/*.ts`）
 *   再跑 tsc。★ 不能沿用上层 tsconfig 的 `include`（产物 tsconfig 里是 `src/**` = **上一版产物**）⇒
 *   那会让同一份输入连跑两次得到不同产物（实测 435↔367 交替）；
 * - 前置缺失（没有 tsconfig / tsc 跑不起来）⇒ **不静默**：返回 `ran=false` 且往 diagnostics 写
 *   `[tsc-fix] skipped: …`（旧实现 `return null` 零痕迹，读数漂了没人知道）。
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
  /** ★ 本次是否真跑了。false ⇒ 前置缺失，`notes` 里必有一条 `[tsc-fix] skipped: …`（不许静默） */
  ran: boolean;
  /** ran=false 的原因（可读、含路径）；ran=true 时为空串 */
  skipReason: string;
  /** 实际喂给 tsc 的 tsconfig —— **必在被改写目录内**（"输入 = 本次产物"的可审计证据） */
  tsconfig: string;
}

/**
 * 跑一次 tsc。
 * ★ `cwd` 必须是**被改写的目录**：tsc 的报错路径是相对 `cwd` 打印的 ⇒ 只有这样才能保证
 *   报错里的相对路径 == 产物相对路径（否则会出现 `src/x.ts` 这种指向别处的路径）。
 */
function runTsc(cwdDir: string, tsconfig: string): { log: string; total: number; broken: string } {
  const tscBin = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
  const useLocal = fs.existsSync(tscBin);
  const r = useLocal
    ? spawnSync(process.execPath, [tscBin, '-p', tsconfig, '--noEmit'], { cwd: cwdDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : spawnSync('npx', ['tsc', '-p', tsconfig, '--noEmit'], { cwd: cwdDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true });
  const log = String(r.stdout ?? '') + String(r.stderr ?? '');
  const total = (log.match(/error TS\d+/g) ?? []).length;
  // ★ 不变量：tsc 没跑起来 / tsconfig 本身不合法（TS5xxx = 配置错）时，`total` **不是**"产物错误数"。
  //   拿它当读数 ⇒ 后处理按假诊断改写（实测：compilerOptions 写成数字枚举 ⇒ 511 条全是 TS5024）。
  const broken = r.error ? `tsc 未能运行：${r.error.message}` : ((log.match(/error TS5\d{3}: [^\r\n]*/) ?? [])[0] ?? '');
  return { log, total, broken };
}

/** 向上最多 4 层找 `tsconfig.json`（**只**为拿 compilerOptions，见 `writeSelfTsconfig`） */
function findBaseTsconfig(srcRoot: string): { found: string | null; searched: string[] } {
  const searched: string[] = [];
  let dir = srcRoot;
  for (let i = 0; i < 4; i++) {
    const p = path.join(dir, 'tsconfig.json');
    searched.push(p);
    if (fs.existsSync(p)) return { found: p, searched };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { found: null, searched };
}

/**
 * 在**被改写的目录里**生成一份只覆盖它自己的 tsconfig，喂给 tsc。
 *
 * ★ 不变量：`include` 一律覆盖成 `**\/*.ts`（= 本目录自己的文件）。base 的 `include`
 *   （产物 tsconfig 里是 `src/**`）指的是**上一版产物** ⇒ 用它就是"拿旧诊断打新产物"：
 *   同一份输入连跑两次，产物在 435↔367 之间交替（实测）。
 * ★ 只继承 base 的 `compilerOptions`：错误口径必须一致（`typeRoots` 决定 `console`/`process`
 *   这些全局是否可用，实测差 23 条）。
 * ★ 边界：base 的 `extends` 不解析（本仓产物 tsconfig 无 extends）；有 extends 时选项可能不全。
 */
function writeSelfTsconfig(srcRoot: string, base: string): string {
  const read = ts.readConfigFile(base, ts.sys.readFile);
  const raw = (read.config?.compilerOptions ?? {}) as Record<string, unknown>;
  const abs = path.join(srcRoot, '.tsconfig.tscfix.json');
  fs.writeFileSync(abs, JSON.stringify({ compilerOptions: { ...raw, noEmit: true }, include: ['**/*.ts'] }, null, 2) + '\n', 'utf8');
  return abs;
}

/**
 * 把本次读数写到 `AGENT_IO_TSC_FIX_REPORT` 指定的文件（住哪由调用方定；未设则只留 diagnostics）。
 * ★ 为什么要有它：`[tsc-fix]` 的读数此前**只进 tool 回执**，不落 `regen-report.json` ⇒
 *   "跳过没有 / 改写多少 / 前后几条"没人能复核，读数漂了也看不见。
 */
function emitReport(res: TscFixResult): void {
  const to = process.env.AGENT_IO_TSC_FIX_REPORT;
  if (!to) return;
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, JSON.stringify(res, null, 2) + '\n', 'utf8');
  } catch {
    /* 落不了盘不影响改写本身（读数在 diagnostics 里仍有一份） */
  }
}

interface Diag {
  rel: string;
  line: number;
  col: number;
  prop: string;
  typeText: string;
}

/**
 * ★★★ 2026-10-29（读报错看出来的）：**TS2304 多半是"名字存在但没导入"**。
 * 例：`let req = ({ … } as MergeRequest);` —— `MergeRequest` 在别的模块里，本文件没 import。
 * ⇒ tsc 指名的名字，如果能找到**导出它的模块**，补一条 import 即可（零推断）。
 */
export function parseTs2304(log: string): Array<{ rel: string; line: number; name: string }> {
  const out: Array<{ rel: string; line: number; name: string }> = [];
  const re = /^(?:src\/)?([^(\r\n]+)\((\d+),\d+\): error TS2304: Cannot find name '([^']+)'/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log)) !== null) {
    out.push({ rel: m[1].trim().replace(/^src\//, ''), line: Number(m[2]), name: m[3] });
  }
  return out;
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
        // ★★★ 2026-10-29（抽查：`as MergeRequest` 报 Cannot find name）：**类型也要收进来**。
        //   原来只收 function/const/class ⇒ `interface` / `type` 永远补不上 import
        //   （`MergeRequest` 明明在 graph_writer.ts 里 `export interface`）。
        else if (ts.isInterfaceDeclaration(st) && st.name) names.set(st.name.text, -1);
        else if (ts.isTypeAliasDeclaration(st) && st.name) names.set(st.name.text, -1);
        else if (ts.isEnumDeclaration(st) && st.name) names.set(st.name.text, -1);
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
 * **不在管线里抛错**（后处理失败就当没做，绝不改坏产物）；**但前置缺失必留一条 `[tsc-fix] skipped:` 诊断**
 * —— "没跑"必须能被人看见，否则读数会继续漂（旧实现直接 `return null`，零痕迹）。
 */
export function applyTscDrivenFixes(outDir: string, notes: string[]): TscFixResult {
  // ★ 落盘的 outDir 可能**就是** src 目录（调用方传 .../src）⇒ srcRoot 用 outDir 本身。
  //   写死 'outDir/src' 会让后处理**静默 no-op**（第一次接线就这样白跑一趟）。
  const srcRoot = outDir;
  const skip = (reason: string): TscFixResult => {
    notes.push(`[tsc-fix] skipped: ${reason}`);
    const res: TscFixResult = {
      diags: 0,
      rewritable: 0,
      changed: 0,
      imports: 0,
      before: 0,
      after: 0,
      skipped: {},
      ran: false,
      skipReason: reason,
      tsconfig: '',
    };
    emitReport(res);
    return res;
  };
  if (!fs.existsSync(srcRoot)) return skip(`outDir 不存在：${srcRoot}`);
  // ★ base 只用来拿 compilerOptions；**tsc 的输入永远是 srcRoot 自己**（见 writeSelfTsconfig）。
  const base = findBaseTsconfig(srcRoot);
  if (!base.found) return skip(`no tsconfig at ${srcRoot}（向上 4 层都没有；试过 ${base.searched.join(' · ')}）`);

  const selfTsconfig = writeSelfTsconfig(srcRoot, base.found);
  try {
    const res = fixWithSelfTsconfig(srcRoot, selfTsconfig, notes);
    emitReport(res);
    return res;
  } finally {
    // ★ 探针 tsconfig 不留在产物目录里（产物目录只该有产物）
    try {
      fs.rmSync(selfTsconfig, { force: true });
    } catch {
      /* 删不掉不影响读数 */
    }
  }
}

/** 真正的改写流程：输入 = `tsconfig`（覆盖 `srcRoot` 自己），输出 = 改写后的 `srcRoot` */
function fixWithSelfTsconfig(srcRoot: string, tsconfig: string, notes: string[]): TscFixResult {
  const { log, total: before, broken } = runTsc(srcRoot, tsconfig);
  if (broken) {
    const reason = `tsc 不可用：${broken}`;
    notes.push(`[tsc-fix] skipped: ${reason}`);
    return {
      diags: 0,
      rewritable: 0,
      changed: 0,
      imports: 0,
      before: 0,
      after: 0,
      skipped: {},
      ran: false,
      skipReason: reason,
      tsconfig,
    };
  }
  const diags = parseTs2339(log);
  // ★ TS2304-IMPORT：名字找不到 ⇒ 若能找到导出它的模块，补 import（tsc 指名的名字，零推断）
  const missing = parseTs2304(log);
  if (!diags.length) {
    return { diags: 0, rewritable: 0, changed: 0, imports: 0, before, after: before, skipped: {}, ran: true, skipReason: '', tsconfig };
  }

  currentSrcRoot = srcRoot;
  const exportsByFile = collectExports(srcRoot);

  // ★ TS2304-IMPORT：按名字建"导出者"索引（同目录优先）
  let importFixed = 0;
  {
    const byName = new Map<string, string[]>();
    for (const [f, names] of exportsByFile) for (const nm of names.keys()) {
      if (!byName.has(nm)) byName.set(nm, []);
      byName.get(nm)!.push(f);
    }
    const need = new Map<string, Map<string, Set<string>>>();
    for (const d of missing) {
      const cands = byName.get(d.name);
      if (!cands || !cands.length) continue;
      const dir = path.posix.dirname(d.rel);
      const pick = cands.find((f) => f !== d.rel && path.posix.dirname(f) === dir) ?? cands.find((f) => f !== d.rel);
      if (!pick) continue;
      const ip = (() => {
        const r = path.posix.relative(dir === '.' ? '' : dir, pick).replace(/\.ts$/, '');
        return r.startsWith('.') ? r : './' + r;
      })();
      if (!need.has(d.rel)) need.set(d.rel, new Map());
      const m2 = need.get(d.rel)!;
      if (!m2.has(ip)) m2.set(ip, new Set());
      m2.get(ip)!.add(d.name);
    }
    for (const [rel, m2] of need) {
      const abs = path.join(srcRoot, rel);
      if (!fs.existsSync(abs)) continue;
      importFixed += injectImports(abs, m2);
    }
  }
  const skipped: Record<string, number> = {};
  const bump = (k: string): void => {
    skipped[k] = (skipped[k] ?? 0) + 1;
  };

  // ① 逐条判定可改写（接收者类型是简单标识符 + 目标自由函数在同文件/同目录存在）
  /**
   * ★★★ 2026-10-29（读代码读出来的）：**槽位方法表**。
   * `Time → number`（epoch ms）之后，Go 的方法 `t.Format(layout)` 在 TS 里成了
   * `number.Format(…)` —— tsc 直接报 TS2339（因为它知道接收者类型是 `number`）。
   * 这类不改写就永远错。tsc 的报错**已经把接收者类型算好了** ⇒ 按类型查这张表即可，
   * 不需要任何推断。
   */
  const SLOT_METHODS: Record<string, string[]> = {
    number: [
      'Format', 'UTC', 'Local', 'Unix', 'UnixMilli', 'Year', 'Month', 'Day', 'Hour', 'Minute', 'Second',
      'Add', 'AddDate', 'Sub', 'Before', 'After', 'Equal', 'IsZero', 'Truncate', 'Round',
    ],
  };
    /**
   * ★★★ 2026-10-29（**读 tsc 报错一眼看出**）：`Property 'length' does not exist on type 'Map<…>'`
   *   ⇒ 这是 `len(map)` 被渲染成 `.length`。tsc **已经算好接收者类型是 Map** ⇒ 按位置把
   *   `.length` 改成 `.size` 即可（不改表达式结构、不重复求值、不做推断）。
   *   ★ 之前试过"内联三元"版本：接收者被**重复求值**且表达式变复杂 ⇒ 产物 546→584 更差，已回退。
   */
  const MAP_PROP_RENAME: Record<string, string> = { length: 'size' };
  /** 按 (文件, 行, 属性) 精确改名的清单 */
  const propRenames = new Map<string, Array<{ line: number; from: string; to: string }>>();
  const byFile = new Map<string, Array<{ prop: string; target: string; definedIn: string }>>();
  let rewritable = 0;
  for (const d of diags) {
    if (!/^[A-Za-z_$][\w$]*$/.test(d.typeText)) {
      bump(`类型不是简单标识符:${d.typeText.slice(0, 24)}`);
      continue;
    }
    // ★ Map 上的属性改名：tsc 说接收者是 Map<…> 且属性是 length ⇒ 改成 size
    // ★ 注意：parseTs2339 会把泛型参数截掉（`Map<string, boolean>` → `Map`），所以判 `Map`。
    if (d.typeText === 'Map' && MAP_PROP_RENAME[d.prop]) {
      if (!propRenames.has(d.rel)) propRenames.set(d.rel, []);
      propRenames.get(d.rel)!.push({ line: d.line, from: d.prop, to: MAP_PROP_RENAME[d.prop] });
      rewritable++;
      continue;
    }
    // ★ 槽位方法：接收者是 `number` 且属性是 Time 的方法 ⇒ 自由函数就叫 prop 本身
    if (SLOT_METHODS[d.typeText]?.includes(d.prop)) {
      const idx = 'src/_go_std/time.ts';
      const definedIn = [...exportsByFile.keys()].find((f) => f.endsWith('_go_std/time.ts') && exportsByFile.get(f)?.has(d.prop));
      if (definedIn) {
        if (!byFile.has(d.rel)) byFile.set(d.rel, []);
        byFile.get(d.rel)!.push({ prop: d.prop, target: d.prop, definedIn });
        rewritable++;
        continue;
      }
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

  let changed = 0;
  let imports = 0;

  // ②a 属性改名（lines.length → lines.size，按诊断行精确匹配）
  for (const [rel, list] of propRenames) {
    const abs = path.join(srcRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const sf2 = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.ES2022, true);
    const edits2: Array<{ start: number; end: number; text: string }> = [];
    const visit2 = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'length') {
        const { line } = sf2.getLineAndCharacterOfPosition(node.getStart(sf2));
        const hit = list.find((r) => r.line === line + 1 && r.from === 'length');
        if (hit) {
          edits2.push({ start: node.name.getStart(sf2), end: node.name.getEnd(), text: hit.to });
          changed++;
        }
      }
      ts.forEachChild(node, visit2);
    };
    visit2(sf2);
    if (!edits2.length) continue;
    let src2 = fs.readFileSync(abs, 'utf8');
    for (const e of edits2.sort((a, b) => b.start - a.start)) src2 = src2.slice(0, e.start) + e.text + src2.slice(e.end);
    fs.writeFileSync(abs, src2);
  }

  // ② 改写 + 补 import
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

  const { total: after } = runTsc(srcRoot, tsconfig);
  const res: TscFixResult = {
    diags: diags.length,
    rewritable,
    changed,
    imports: imports + importFixed,
    before,
    after,
    skipped,
    ran: true,
    skipReason: '',
    tsconfig,
  };
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
