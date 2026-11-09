/**
 * touches: src/application/design/intent/case_program.ts · src/application/design/intent/expectations.ts
 *
 * **契约形态扩展（fakes）的执行核** —— 2026-11-09/10
 *
 * 契约用例可以声明**显式的整模块替身**：
 *
 * ```ts
 * { fakes: [{ module: 'node:fs', exports: { readFileSync: '() => "fake"' } }] }
 * ```
 *
 * ## 硬边界（写死在实现里，不靠调用方自觉）
 * - **只做模块级替换**（整模块 exports），不做对象属性 patch / spy / 调用计数；
 * - **替身必须显式写在契约里**（`exports` 内联 JS 表达式，或 `file` 指向本地模块文件），引擎不自动生成 mock；
 * - **替身与目标在同一隔离子进程内加载**（先注册 resolve hook 再 import 目标），不污染判定进程；
 *   契约结束（子进程退出）替身即消失；
 * - 没声明 fakes 的依赖照常解析 ⇒ 解析不到时报错原样带出，由调用方判 `unsupported`（现有语义不变）。
 * - ★ v1 依赖面：`node:` 内置（由本机制整模块替换）+ 相对 import 闭包（镜像拷贝进 tmp）。
 *   真三方包不在 v1 射程（E-CRIT-006 的写前闸仍按既有口径拦，除非该条判据的 fakes 声明了它）。
 *
 * 实现：`node --import` 预载 hook 注册脚本 → `module.register()` 一个 resolve hook
 * （数据 = 替身映射）→ 动态 import 目标模块并跑用例主体（ctor → steps → throws → effects，
 * 与 `runCaseProgram` 同语义）。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** 一条替身声明：`module` = 被替换的说明符；替身 = `exports`（内联 JS 表达式表）或 `file`（本地模块文件）。
 *  ★ `file` 型替身**必须同时提供 default 导出**（目标写 `import x from 'spec'` 时用的是它）；
 *    `exports` 内联型由本函数自动生成 default（= 全部具名的对象字面量）。
 *  ★ 形状权威 = `domain/case_program.ts#CaseFake`（本文件 re-export，不手抄第二份）。 */
import type { CaseFake } from '../../../domain/case_program.js';
export type { CaseFake } from '../../../domain/case_program.js';

/** 子进程一次运行的完整输入（JSON 落盘传给 runner） */
export type FakesChildSpec = {
  /** 目标模块（转译/落盘后的绝对路径） */
  entry: string;
  projectRoot: string;
  symbol: string;
  /** 去掉 fakes 后的用例本体（ctor/steps/effects/throws/budget） */
  case: Record<string, unknown>;
};

export type FakesRunResult = {
  status: 'pass' | 'fail' | 'unsupported';
  at?: string;
  detail: string[];
};

/** 校验替身声明形状（引擎不猜、不自动生成） */
export function validateFakes(fakes: unknown): string | null {
  if (!Array.isArray(fakes)) return 'fakes 必须是数组';
  for (let i = 0; i < fakes.length; i++) {
    const f = fakes[i] as Record<string, unknown>;
    if (!f || typeof f !== 'object') return `fakes[${i}] 不是对象`;
    if (typeof f['module'] !== 'string' || !f['module']) return `fakes[${i}].module 缺失或不是非空字符串`;
    const hasExports = f['exports'] !== undefined;
    const hasFile = f['file'] !== undefined;
    if (hasExports === hasFile) return `fakes[${i}]：exports 与 file 必须二选一（显式声明，不猜）`;
    if (hasExports) {
      const ex = f['exports'] as Record<string, unknown>;
      if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return `fakes[${i}].exports 必须是对象`;
      const keys = Object.keys(ex);
      if (keys.length === 0) return `fakes[${i}].exports 是空对象 ⇒ 整模块替换没有意义，不收`;
      for (const k of keys) {
        if (typeof ex[k] !== 'string' || !ex[k]) return `fakes[${i}].exports.${k} 必须是非空 JS 表达式串`;
      }
    }
    if (hasFile) {
      const rel = f['file'];
      if (typeof rel !== 'string' || !rel) return `fakes[${i}].file 必须是非空字符串`;
      const abs = path.isAbsolute(rel) ? rel : path.resolve(rel);
      if (!fs.existsSync(abs)) return `fakes[${i}].file 在盘上不存在：${rel}`;
    }
  }
  return null;
}

/**
 * 把替身声明物化到 tmp：内联 exports → 生成 ESM 模块文件；file → 拷为 .mjs（.js 保持扩展名拷）。
 * 返回 {说明符 → tmp 相对路径}。
 */
export function materializeFakes(
  fakes: CaseFake[],
  tmp: string,
  baseDir: string,
): { map: Record<string, string>; errors: string[] } {
  const map: Record<string, string> = {};
  const errors: string[] = [];
  for (let i = 0; i < fakes.length; i++) {
    const f = fakes[i];
    const rel = `__fake_${i}.mjs`;
    try {
      if (f.file) {
        const src = path.isAbsolute(f.file) ? f.file : path.resolve(baseDir, f.file);
        fs.copyFileSync(src, path.join(tmp, rel));
      } else {
        const exportsTable = f.exports ?? {};
        const decls = Object.entries(exportsTable)
          .map(([k, expr]) => `const ${safeKey(k)}_v = ${expr};`)
          .join('\n');
        const aliases = Object.keys(exportsTable)
          .map((k) => `export { ${safeKey(k)}_v as ${JSON.stringify(k)} };`)
          .join('\n');
        // ★ 默认导出 = 全部具名的对象字面量：目标写 `import fs from 'node:fs'`（default import）
        //   时也拿得到同一份替身（实测：只给具名导出 ⇒ default import 直接 ERR，子进程判不了）。
        const def = `const __default = { ${Object.keys(exportsTable)
          .map((k) => `${JSON.stringify(k)}: ${safeKey(k)}_v`)
          .join(', ')} };\nexport default __default;\n`;
        fs.writeFileSync(path.join(tmp, rel), `${decls}\n${aliases}\n${def}`, 'utf-8');
      }
      map[f.module] = `./${rel}`;
    } catch (e) {
      errors.push(`fakes[${i}]（${f.module}）物化失败：${(e as Error).message}`);
    }
  }
  return { map, errors };
}

/** 内联声明用的安全变量名（键可能不是合法标识符） */
function safeKey(k: string): string {
  return `k_${k.replace(/[^A-Za-z0-9_$]/g, '_')}`;
}

// ── 目标模块进 tmp：TS 转译 + 相对闭包镜像（口径与 behavior/index.ts 的夹具同源，但那三个闭包
//    助手是私有的 ⇒ 在这里按同一口径实现，不为此把它们改成 export —— 改导出面是另一个决定）──

const REL_IMPORT_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const OUT_EXT: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.js', '.cts': '.js', '.jsx': '.js' };
const NODE_LOADABLE_SPEC_EXTS = ['.js', '.mjs', '.cjs'];

/** 单文件 TS→ESM 转译（与 behavior/index.ts#transpileForHarness 同一套 compilerOptions 口径） */
export function transpileToFakesEsm(abs: string, src: string): { js: string } | { error: string } {
  const out = ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      allowJs: true,
      isolatedModules: true,
    },
    fileName: abs.replace(/\.(mjs|mts|cjs|cts)$/i, '.js'),
    reportDiagnostics: true,
  });
  const errs = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length > 0) {
    const msg = errs.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n').split('\n')[0]).join('; ');
    return { error: `目标文件转译失败: ${msg}` };
  }
  return { js: out.outputText };
}

/** 从 `fromAbs` 出发解析相对说明符到盘上真文件（找不到 ⇒ null，不猜） */
function resolveRelImport(fromAbs: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromAbs), spec);
  const noExt = base.replace(/\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/i, '');
  const cands = [base, ...REL_IMPORT_EXTS.map((e) => noExt + e), ...REL_IMPORT_EXTS.map((e) => path.join(base, 'index' + e))];
  for (const c of cands) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}

/** 收集一个模块源码里的**相对**模块说明符（静态 import / export-from / 动态 import()） */
function relativeSpecsOf(fileAbs: string, src: string): string[] {
  const sf = ts.createSourceFile(fileAbs, src, ts.ScriptTarget.ES2020, true);
  const out: string[] = [];
  const push = (lit: ts.Expression | undefined): void => {
    if (lit && ts.isStringLiteralLike(lit) && lit.text.startsWith('.')) out.push(lit.text);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
      push(n.moduleSpecifier);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      push(n.arguments[0]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** tmp 镜像路径：仓库相对路径只换 TS 扩展名为 JS（与 behavior 夹具同一不变量：不拍平、不改名） */
function mirrorRel(repoRel: string): string {
  const p = String(repoRel ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  const ext = path.posix.extname(p).toLowerCase();
  const js = OUT_EXT[ext];
  return js ? `${p.slice(0, p.length - ext.length)}${js}` : p;
}

/**
 * 把 entry（含转译）与其相对 import 闭包按镜像路径搬进 tmp。
 * 搬不动 ⇒ 记名（diag），不静默 —— 与 behavior 夹具同一纪律（0.12）。
 */
export function materializeTarget(args: {
  entryAbs: string;
  entrySrc: string;
  tmp: string;
  projectRoot: string;
  diag: (msg: string) => void;
}): { entryRel: string } | { error: string } {
  const repoRel = path.relative(args.projectRoot, args.entryAbs).split(path.sep).join('/');
  const entryRel = mirrorRel(repoRel);
  if (path.posix.isAbsolute(entryRel) || entryRel === '..' || entryRel.startsWith('../')) {
    return { error: `目标文件不在项目根内（repoRel=${repoRel}）⇒ 无法建立仓库相对镜像` };
  }
  const write = (rel: string, content: string): void => {
    const abs = path.join(args.tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  };
  const tr = transpileToFakesEsm(args.entryAbs, args.entrySrc);
  if ('error' in tr) return { error: tr.error };
  write(entryRel, tr.js);
  // 递归搬闭包（visited 按绝对路径去重防环；环回 entry 跳过）
  const visited = new Set<string>([args.entryAbs]);
  const walk = (curAbs: string, curSrc: string, curRel: string): void => {
    for (const spec of relativeSpecsOf(curAbs, curSrc)) {
      const realAbs = resolveRelImport(curAbs, spec);
      if (!realAbs) {
        args.diag(`相对说明符在盘上解析不到：${spec}（从 ${path.basename(curAbs)}）`);
        continue;
      }
      if (visited.has(realAbs)) continue;
      visited.add(realAbs);
      const specExt = path.posix.extname(spec).toLowerCase();
      if (!NODE_LOADABLE_SPEC_EXTS.includes(specExt)) {
        args.diag(`说明符扩展名 node 解析不了、未搬：${spec}（从 ${curRel}）`);
        continue;
      }
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(curRel), spec));
      if (path.posix.isAbsolute(rel) || rel === '..' || rel.startsWith('../')) {
        args.diag(`说明符越出镜像根、未搬：${spec}（从 ${curRel}）`);
        continue;
      }
      let src = '';
      try {
        src = fs.readFileSync(realAbs, 'utf-8');
      } catch (e) {
        args.diag(`闭包成员读不了：${rel}（${(e as Error).message}）`);
        continue;
      }
      const t = transpileToFakesEsm(realAbs, src);
      if ('error' in t) {
        args.diag(`闭包成员转译失败：${rel}（${t.error}）`);
        continue;
      }
      write(rel, t.js);
      walk(realAbs, src, rel);
    }
  };
  walk(args.entryAbs, args.entrySrc, entryRel);
  return { entryRel };
}

/** hook 注册预载脚本源（`node --import` 进子进程；它 register resolve hook） */
export function fakesRegisterSource(): string {
  return `
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const map = JSON.parse(process.env.FAKES_MAP_JSON ?? '{}');
const here = fileURLToPath(new URL('.', import.meta.url));
register(pathToFileURL(path.join(here, 'fakes_resolve.mjs')).href, { parentURL: pathToFileURL('./'), data: map });
`;
}

/** resolve hook 本体：命中替身映射的说明符重定向到 tmp 里的替身文件；其余照常。
 * 限定：只拦**非 harness** 父模块（runner/fake 自身的 import 不受影响 —— 替身不劫持夹具）。 */
export function fakesResolveSource(): string {
  return `
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export async function initialize(data) {
  globalThis.__FAKE_MAP__ = data ?? {};
}
export async function resolve(specifier, context, nextResolve) {
  const map = globalThis.__FAKE_MAP__ ?? {};
  const parent = String(context.parentURL ?? '');
  const isHarness = parent.endsWith('/runner.mjs') || parent.endsWith('/register.mjs') || parent.includes('__fake_');
  if (!isHarness && Object.prototype.hasOwnProperty.call(map, specifier)) {
    return { url: pathToFileURL(path.resolve(process.cwd(), map[specifier])).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;
}

/**
 * 用例 runner 源（子进程 ESM 脚本）。主体语义与 `runCaseProgram` 对齐：
 * ctor → steps（逐 await / expect 精确比较）→ throws → effects（writes/handles）。
 * 输出：单行 JSON { status, at?, detail } 到**结果文件**（FAKES_RESULT_FILE env 指定）——
 * stdout 只作诊断（父进程在受限环境里读不到 pipe，见 runCaseWithFakes 的 spawn 回退注释）。
 */
export function fakesRunnerSource(): string {
  return `
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FUNC_NAME = process.argv[2];
const SPEC = JSON.parse(fs.readFileSync(process.argv[3], 'utf-8'));
const CASE = SPEC.case;
const OUT_FILE = process.env.FAKES_RESULT_FILE;

function canon(v){const walk=(x)=>{if(Array.isArray(x))return x.map(walk);if(x&&typeof x==='object'){const o=x;return Object.keys(o).sort().reduce((a,k)=>{a[k]=walk(o[k]);return a;},{});}return x;};try{return JSON.stringify(walk(v));}catch{return String(v);}}
function sameExpect(actual, expected){if(typeof expected==='string'){const t=expected.trim();if(t.startsWith('{')||t.startsWith('[')||t.startsWith('"')||t==='true'||t==='false'||t==='null'){try{return canon(actual)===canon(JSON.parse(t));}catch{}}return String(actual)===expected;}return canon(actual)===canon(expected);}
const isThenable=(v)=>!!v&&typeof v==='object'&&(typeof v.then==='function'||typeof v==='function'&&typeof v.then==='function');

function emit(r){
  const line = JSON.stringify(r);
  try { process.stdout.write(line + '\\n'); } catch {}
  if (OUT_FILE) { try { fs.writeFileSync(OUT_FILE, line, 'utf-8'); } catch {} }
  process.exit(0);
}

let mod;
try { mod = await import(pathToFileURL(SPEC.entry).href); }
catch (e) { emit({ status:'unsupported', detail:['模块加载失败 ⇒ 判不了：'+String((e&&e.message)||e)] }); }

const targetSym = mod[FUNC_NAME] ?? (mod.default ? mod.default[FUNC_NAME] : undefined);
if (targetSym === undefined) { emit({ status:'unsupported', detail:[FUNC_NAME+' 没有导出 ⇒ 判不了'] }); }

try {
  // effects 预清理（与 runCaseProgram 同口径：只碰 effects 点名的 writes）
  for (const ef of CASE.effects ?? []) { const rel=ef.writes; if(typeof rel!=='string'||!rel)continue; const t=path.isAbsolute(rel)?rel:path.join(SPEC.projectRoot,rel); try{fs.rmSync(t,{force:true});}catch{} }

  let instance;
  try { instance = Array.isArray(CASE.ctor) ? new targetSym(...CASE.ctor) : targetSym; }
  catch (e) { emit({ status:'fail', at:'ctor', detail:['构造实例抛错：'+String((e&&e.message)||e)] }); }

  let threw=null, lastValue;
  const steps=CASE.steps??[];
  for (let i=0;i<steps.length;i++){
    const s=steps[i];
    const at=s.method?('第 '+(i+1)+' 步（method='+s.method+'）'):('第 '+(i+1)+' 步');
    const fn = s.method===undefined ? instance : instance[s.method];
    if (typeof fn!=='function'){ emit({status:'fail',at,detail:[at+'：目标上没有可调用的 '+(s.method??'(函数本身)')]}); }
    try { let o=fn.apply(instance, s.args??[]); if(isThenable(o)) o=await o; lastValue=o; }
    catch(e){ threw=e; break; }
    if (s.expect!==undefined && !sameExpect(lastValue, s.expect)){ emit({status:'fail',at,detail:[at+'：期望 '+canon(s.expect)+'，实得 '+canon(lastValue)]}); }
  }

  if (CASE.throws){
    if(!threw){ emit({status:'fail',at:'throws',detail:['期望抛错（消息含 "'+CASE.throws.messageContains+'"），实际没有抛']}); }
    const msg=String((threw&&threw.message)||threw);
    if(!msg.includes(CASE.throws.messageContains)){ emit({status:'fail',at:'throws',detail:['抛错消息不含 "'+CASE.throws.messageContains+'"，实得："'+msg+'"']}); }
  } else if (threw){ emit({status:'fail',at:'steps',detail:['未声明 throws，但执行范围内抛错："'+String((threw&&threw.message)||threw)+'"']}); }

  for (let i=0;i<(CASE.effects?.length??0);i++){
    const e=CASE.effects[i]; const at='effects['+i+']';
    if (typeof e.writes==='string' && e.writes){
      const t=path.isAbsolute(e.writes)?e.writes:path.join(SPEC.projectRoot,e.writes);
      if (e.absent){ if (fs.existsSync(t)){ emit({status:'fail',at,detail:[at+'：声明 absent，但文件存在：'+e.writes]}); } }
      else {
        if(!fs.existsSync(t)){ emit({status:'fail',at,detail:[at+'：声明写入，但文件不存在：'+e.writes]}); }
        if (typeof e.mustContain==='string'){ const c=fs.readFileSync(t,'utf-8'); if(!c.includes(e.mustContain)){ emit({status:'fail',at,detail:[at+'：文件不含期望子串（先 30 字：'+c.slice(0,30)+'）']}); } }
      }
    } else if (typeof e.handles==='string' && e.handles){
      let cur=instance ?? mod; for(const k of e.handles.split('.')){ cur=cur==null?undefined:cur[k]; }
      if (!sameExpect(cur, e.equals)){ emit({status:'fail',at,detail:[at+'：进程内状态 '+e.handles+' 期望 '+canon(e.equals)+'，实得 '+canon(cur)]}); }
    } else { emit({status:'unsupported',at,detail:[at+'：effects 里既没有 writes 也没有 handles']}); }
  }
  emit({status:'pass', detail:[]});
} catch (e) { emit({ status:'unsupported', detail:['执行核异常 ⇒ 判不了：'+String((e&&e.message)||e)] }); }
`;
}
