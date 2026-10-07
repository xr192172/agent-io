/**
 * detect_dead_imports —— 文件级死 import 检测（确定性重构管线的"一键"真相层）
 *
 * 定位：与 dead_deps（闭包级）互补。dead_deps 回答"闭包内某三方源是否被种子可达
 * 代码引用"——它依赖 harvest_closure 产出的 closure/seed/external 上下文，只服务
 * 积木瘦身场景，无法对"只给 project_dir 的任意项目"通用一键。
 *
 * 本模块是**文件级自洽**判定：对一个文件，某 import 源的全部本地绑定在"剥离
 * import/require 语句自身"的源码里零出现 → 该源是死 import。不需要 DB、不需要
 * 闭包、不需要种子，任何 TS/Go 项目都能直接扫。这是管线把 dead_imports 步变成
 * "自动检测 + 删除"的基础。
 *
 * 保守规则（宁多报活/漏报死，不误删——检测信任优先，删除还过验证闭环）：
 *   - Go 空导入 `_` / 点导入 `.`：import 即执行副作用 → 恒活
 *   - TS 副作用导入 `import 'x'` / re-export `export ... from` / 语法不认识
 *     （parseTsImportQualifiers 返回 null）→ 恒活
 *   - TS 裸名扫描只在剥离 import 行后的源码做（import 语句自身含绑定名，不剥会
 *     假"出现"）；注释里的同名出现不剥（TS 无行注释剔除）→ 只会多活，安全向
 *   - Go 无 alias 时 import 行不含 `Q.`，成员访问扫描天然不误判 import 行自身
 *
 * 产物结构与 removeDeadImports 的 dead 清单一致（source + files），管线的
 * dead_imports 步据此删除；也可单独交付给用户先看报告再拍板。
 */

import { DATA_DIR_NAME } from '../../data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseGoImportQualifiers,
  parseTsImportQualifiers,
  qualifierLines,
  stripTsImportLines,
} from '../../graph/dead_deps.js';
// ★ 2026-10-08 ②-c：TS 的「哪个绑定被用了」不再自己扫文本 —— 改用**与报告口径同一份**绑定事实。
//   同一层（infrastructure）内的兄弟目录互引，不构成分层违规。
import { importBindingFactsSync } from '../health/index.js';

export interface DeadImportCandidate {
  /** 死三方源（Go import 路径 / TS 模块说明符） */
  source: string;
  /** 导入该源且文件内零引用的文件（相对 project_dir） */
  files: string[];
  reason: 'no_reference';
}

/**
 * ★ 2026-10-08 闸②：**判死但不许删**的项。
 *
 * 为什么另立一个类型、而不是扩 `DeadImportCandidate.reason` 的枚举：
 * `dead` 会被喂给 `DeadDepCandidate[]`（`dead_deps.ts`）⇒ 扩枚举等于动了那条既有的下游合同
 * （实测：扩完 tsc 立刻报 reason 不兼容）。本仓规矩是**新增一个语义唯一、类型钉死的东西**。
 */
export interface NeedsReviewCandidate {
  source: string;
  files: string[];
  reason: 'last_importer_with_load_effects';
}

/** ★ 三态里的第三态：**没判出来**（拿不到解析事实）—— 不删，且必须可见。 */
export interface UnjudgedCandidate {
  source: string;
  files: string[];
}

export interface DetectDeadImportsOptions {
  project_dir: string;
  /** 显式文件清单（相对或绝对路径）；缺省递归扫全部 TS/Go 源 */
  files?: string[];
}

export interface DetectDeadImportsResult {
  dead: DeadImportCandidate[];
  /**
   * ★ 2026-10-08 闸②：**判死但不许删**的项。
   *   判据（两条同时成立）：(b) 这条是该源**最后一个**引用点 —— 删了它该源就不再被任何文件加载；
   *   且 (a) 该源**加载时会产生可观察效果**。⇒ 删了会改行为 ⇒ 交人/LLM 复核，绝不自动删。
   *   ★ 为什么不能只靠「恒活豁免」：那只覆盖 import **自身**的形态（无绑定/副作用导入/re-export），
   *     而带绑定的 `import { h } from './side'` 完全可能正是**唯一让 side.ts 被加载**的原因。
   */
  needsReview?: NeedsReviewCandidate[];
  /**
   * ★★ 2026-10-08 三态：**没判出来**的项（拿不到解析事实：未预热 / 解析失败 / 语言不认识）。
   *
   * ★ 与 `needsReview` **分开**：那个是「判死但风险高，不许删」，这个是「**根本没判出来**」。
   * ★ 为什么必须报出来：把它折叠进「活」等于**把错误信息喂给下游** —— 下游会以为
   *   「这条算过了、没问题」，而真相是「我们没算」。
   * ★★ 它的**计数就是解析能力的量具**：>0 ⇒ 有东西没算到；目标压到 0。
   */
  unjudged?: UnjudgedCandidate[];
  /** 参与扫描的文件数 */
  scanned: number;
  /** 规则说明（供报告） */
  limitations: string[];
  /** 每个死 import 引用文件的来源分类（相对 project_dir → kind），便于一眼区分"真实源码可清"vs"测试/夹具噪音" */
  fileKind?: Record<string, FileKind>;
  /** 死 import 出现次数按来源分类聚合（src/test/fixture/generated/snapshot） */
  byKind?: Record<FileKind, number>;
}

/** 死 import 引用的来源分类：真实源码 / 测试 / 生成物 / 测试夹具 / 快照副本 */
export type FileKind = 'src' | 'test' | 'fixture' | 'generated' | 'snapshot';

const TS_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const GO_RE = /\.go$/;

function langOf(rel: string): 'go' | 'ts' | null {
  if (GO_RE.test(rel)) return 'go';
  if (TS_RE.test(rel)) return 'ts';
  return null;
}

/**
 * 按路径约定分类死 import 引用来源。
 * 优先级：快照 > 生成物 > 夹具 > 测试 > 源码（fixture/generated 属"不应真清"的噪音层）。
 * 纯路径判断，不读文件；对已显式收敛（files）或默认扫描都适用。
 */
export function classifyFileKind(rel: string): FileKind {
  const p = rel.split(/[\\/]/);
  const base = p[p.length - 1] ?? '';
  if (p.some((seg) => seg.startsWith(DATA_DIR_NAME))) return 'snapshot';
  if (/\.gen\.(ts|tsx|js|jsx|mjs|cjs|go)$/.test(base) || /\.generated\.|_generated\.go$/.test(base)) return 'generated';
  if (
    p.some((seg) => /^(fixtures?|__fixtures__|testdata|golden|snapshots)$/i.test(seg)) ||
    /\.(fixtures?|_testdata)\./.test(base)
  ) {
    return 'fixture';
  }
  if (
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base) ||
    /_test\.go$/.test(base) ||
    /[.\\/]test_.+\.go$/.test(base) ||
    p.includes('__tests__')
  ) {
    return 'test';
  }
  return 'src';
}

/** 递归收集项目内 TS/Go 源文件（跳过 node_modules/.git/dist） */
export function scanProjectSourceFiles(project_dir: string, files?: string[]): string[] {
  const proj = path.resolve(project_dir);
  const toAbs = (f: string): string => (path.isAbsolute(f) ? path.resolve(f) : path.resolve(proj, f));
  const targets: string[] = [];
  if (files && files.length > 0) {
    for (const f of files) {
      const abs = toAbs(f);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile() && langOf(abs)) targets.push(abs);
    }
    return targets;
  }
  const walkDir = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      // 递归跳过：依赖/版本控制/构建产物；以及 vendor/（第三方 vendored 代码）——
      // 它们绝不可能算"自研积木"，不参与死 import 扫描，避免把 vendored 依赖误报为下线候选。
      // 进一步排除 .agent-io* 快照/备份目录（含 .agent-io、.agent-io.bak-<ts> 变体）：
      // 它们是项目自身历史快照的生成副本，扫进来会把每个 src 命中重复多倍，污染清理清单。
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'vendor') continue;
      if (ent.isDirectory() && ent.name.startsWith(DATA_DIR_NAME)) continue;
      const p = path.join(dir, ent.name);
      // 跳过生成的源码产物（*.gen.ts 等），不参与"自研源码"判定
      if (ent.isDirectory()) walkDir(p);
      else if (langOf(ent.name) && !/\.gen\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ent.name)) targets.push(p);
    }
  };
  walkDir(proj);
  return targets;
}

/**
 * 单源判定：src 中某 import 源是否文件内零引用。
 * 返回 true = 死候选（可删）；false = 活（保守保留）。
 */
/**
 * ★★★ 2026-10-08 三态化：**判死 / 判活 / 判不出来**。
 *
 * 为什么必须是三态（用户当日的批评，原话意思）：
 *   「保守当活，就是**把错误信息喂给下游**。做保守是不是意味着我们还有没算到的东西？」
 *
 * ⇒ 「**约束不许删**」与「**谎报在用**」是两件事：
 *   · **砍的方向**要保守 —— 删除不可逆 ⇒ **只许 `dead` 删**；
 *   · **说的方向不许折叠** —— 拿不到解析事实时必须说 `unknown`，**不许冒充 `alive`**。
 *
 * ★ 本仓既有的正确形态就是三态：`verify.mjs` 的 0/1/**2=SKIP**（「有门跑不了」不冒充「通过」）、
 *   `Touched` 的「省略 ≠ 填假值」。本条把同一纪律落到这里。
 * ★★ 副产物：**`unknown` 的计数就是「解析能力」的量具**（目标：压到 0）。
 *   （实测本仓 324 个 TS 源文件：unknown = 0 —— 但**此前这个 0 是不可见的**，因为被折叠成了 alive。）
 */
type SourceVerdict = 'dead' | 'alive' | 'unknown';

function judgeSource(abs: string, src: string, source: string, lang: 'go' | 'ts'): SourceVerdict {
  if (lang === 'go') {
    const quals = parseGoImportQualifiers(src).get(source);
    // ★ 解析不出限定符 ⇒ **unknown**（原写成「活」= 冒充：可能是副作用导入，也可能是解析失败）
    if (!quals || quals.length === 0) return 'unknown';
    // 空/点导入：副作用 ⇒ **恒活**。这是**真判断**，不是保守 —— 它确实「在用」（用途就是被加载）
    if (quals.some((q) => q === '_' || q === '.')) return 'alive';
    // 任一候选限定符有 `Q.` 成员访问 → 活；全部零出现 → 死
    return quals.some((q) => qualifierLines(src, q, 'go').length > 0) ? 'alive' : 'dead';
  }

  // ── TS：读**共享绑定事实**（与报告口径同一份实现，见 ②-c）──
  const facts = importBindingFactsSync(abs, src);
  // ★ 拿不到事实 ⇒ **unknown**（原写成「活」= 把「我没算」冒充成「它在用」）
  if (facts === null) return 'unknown';
  const mine = facts.filter((f) => f.module === source);
  // 该源在本文件没有任何绑定 ⇒ 副作用导入 / re-export ⇒ **真·恒活**（不是保守）
  if (mine.length === 0) return 'alive';
  return mine.every((f) => !f.used) ? 'dead' : 'alive';
}

/**
 * 文件级死 import 检测：扫描项目源文件，聚合出死候选（source → files）。
 * 只返回"文件内零引用"的源；同一源可能在多个文件死（皆记入 files）。
 */
const TS_TRY_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * 项目内**相对说明符** → 相对 project_dir 的文件路径；解析不到 / 裸包名 / `node:` ⇒ null。
 * ★ 就地写而不复用 application 的 `resolveSpecifier`（后者在 `brick_bag.ts`）——
 *   infrastructure 引 application 是**分层违规**（本仓 2026-10-07 刚修过一处同类）。
 * ★ 裸包名一律返回 null ⇒ 闸② 不覆盖外部依赖（见 limitations，v1 有意如此）。
 */
function resolveInProject(proj: string, fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(proj, path.dirname(fromRel), spec);
  const tries = [base, ...TS_TRY_EXTS.map((e) => base + e), ...TS_TRY_EXTS.map((e) => path.join(base, 'index' + e))];
  for (const t of tries) {
    try {
      if (fs.statSync(t).isFile()) return path.relative(proj, t).replace(/\\/g, '/');
    } catch {
      /* 不存在就试下一个 */
    }
  }
  return null;
}

/**
 * 该模块**加载时是否可能产生可观察效果**（保守：证明不了纯 ⇒ 算有效果）。
 *
 * 为什么需要它：删掉某模块**最后一个**引用点 ⇒ 该模块不再被求值 ⇒ 它顶层干了什么就都不发生了。
 *
 * ★ v1 用**文本判据**（不是不想用 AST，是这里的约束决定的）：本函数在**同步**上下文被调用，
 *   而内核 AST 入口要么是 async（会牵动 3 个同步调用点）、要么走 `getParserSync` 需**预热**
 *   —— 没预热会返回 null，若那时判「无效果」就会**静默多删**（最坏的方向）。
 *   ⇒ 宁可文本 + 保守。层级升级与绑定判定一起放进第②步（一次只改一样）。
 *
 * 判据（剥离注释后逐行看；**认不出的一律算有效果**）：
 *   · `import 'x'`（无 clause）⇒ 有效果（会把 x 一并加载）
 *   · `export … from 'x'` ⇒ 有效果（re-export 会加载 x）
 *   · 纯声明 `export function|class|interface|type|enum` ⇒ 无
 *   · `export const|let|var` 且初始化器是**裸字面量/标识符** ⇒ 无；否则（含调用）⇒ 有效果
 *   · 任何其它顶层语句（表达式语句、调用、赋值…）⇒ 有效果
 */
function hasLoadEffects(src: string): boolean {
  const stripped = stripTsComments(src);
  for (const rawLine of stripped.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line === '}' || line === '};' || line === ');') continue;
    if (/^import\s+['"]/.test(line)) return true;
    if (/^export\s+.*\bfrom\s+['"]/.test(line)) return true;
    if (/^export\s+(default\s+)?(declare\s+)?(abstract\s+)?(function|class|interface|type|enum)\b/.test(line)) continue;
    const decl = /^(export\s+)?(declare\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*([^;]+);?\s*$/.exec(line);
    if (decl) {
      const init = decl[3].trim();
      // 裸字面量 / 裸标识符 / 取反的字面量 ⇒ 视为纯；含括号或跨行（认不出）⇒ 有效果
      if (/^-?[\w$.]+$/.test(init) || /^-?(['"`]|\d|true$|false$|null$)/.test(init)) continue;
      return true;
    }
    return true;
  }
  return false;
}

/**
 * 闸②：(b) 最后引用点 **且** (a) 目标模块加载有效果 ⇒ 不许删。
 * ★ 注意顺序：先判 (b) —— 它不是最后引用点时**直接放行**，连目标模块都不用读。
 */
function gatedByLoadEffects(
  proj: string,
  fromRel: string,
  source: string,
  importersOf: Map<string, Set<string>>,
  contentByRel: Map<string, string>,
): boolean {
  const importers = importersOf.get(source);
  if (!importers || importers.size !== 1) return false; // (b) 不成立 ⇒ 无害
  const targetRel = resolveInProject(proj, fromRel, source);
  if (targetRel === null) return false; // 外部依赖 ⇒ 本闸 v1 不覆盖（见 limitations）
  const tsrc = contentByRel.get(targetRel);
  if (tsrc === undefined) return false; // 目标不在本次扫描集内（例如被 noise 过滤）⇒ 不拦
  return hasLoadEffects(tsrc);
}

export function detectDeadImports(opts: DetectDeadImportsOptions): DetectDeadImportsResult {
  const proj = path.resolve(opts.project_dir);
  const absFiles = scanProjectSourceFiles(proj, opts.files);
  const agg = new Map<string, { files: string[]; seen: Set<string> }>();
  const readSrc = (abs: string): string | null => {
    try {
      return fs.readFileSync(abs, 'utf-8');
    } catch {
      return null;
    }
  };

  // ── 第 0 遍（★ 2026-10-08 闸②-b 需要）：**全部 import 者**（不管用没用）+ 内容缓存 ──
  //   为什么单独一遍：闸② 问的是「删了之后这个源还有没有别人加载」⇒ 必须知道**全体**引用面，
  //   而下面那遍只记「判死」的那些，看不见全体。
  const contentByRel = new Map<string, string>();
  const importersOf = new Map<string, Set<string>>();
  for (const abs of absFiles) {
    const src0 = readSrc(abs);
    if (src0 === null) continue;
    const lang0 = langOf(abs);
    if (!lang0) continue;
    const rel0 = path.relative(proj, abs) || abs;
    contentByRel.set(rel0, src0);
    const srcs0 = lang0 === 'go' ? [...parseGoImportQualifiers(src0).keys()] : enumerateTsSources(src0);
    for (const s of srcs0) {
      let set = importersOf.get(s);
      if (!set) {
        set = new Set();
        importersOf.set(s, set);
      }
      set.add(rel0);
    }
  }
  const reviewAgg = new Map<string, { files: string[]; seen: Set<string> }>();
  // ★ 三态的第三态：**没判出来**的项（拿不到解析事实）。与 reviewAgg **分开** ——
  //   那个是「判死但风险高」，这个是「根本没判出来」。名字像 ≠ 同义。
  const unjudgedAgg = new Map<string, { files: string[]; seen: Set<string> }>();

  for (const abs of absFiles) {
    const src = readSrc(abs);
    if (src === null) continue;
    const lang = langOf(abs);
    if (!lang) continue;

    // 枚举本文件的 import 源
    let sourcesOfFile: string[];
    if (lang === 'go') {
      sourcesOfFile = [...parseGoImportQualifiers(src).keys()];
    } else {
      sourcesOfFile = enumerateTsSources(src);
    }

    const rel = path.relative(proj, abs) || abs;
    for (const source of sourcesOfFile) {
      const verdict = judgeSource(abs, src, source, lang);
      // ★ 三态：只有 `dead` 才进「可删」；`unknown` **不删**，但**单独收**（不许折叠成 alive）
      if (verdict === 'unknown') {
        let u = unjudgedAgg.get(source);
        if (!u) {
          u = { files: [], seen: new Set() };
          unjudgedAgg.set(source, u);
        }
        if (!u.seen.has(rel)) {
          u.seen.add(rel);
          u.files.push(rel);
        }
        continue;
      }
      if (verdict !== 'dead') continue;
      // ★ 2026-10-08 闸②：**判死 ≠ 可删**。(b) 这是不是该源最后一个引用点？ 且 (a) 它加载有没有效果？
      //   两条同时成立 ⇒ 删了会改行为 ⇒ 进 needsReview，**绝不自动删**。
      if (gatedByLoadEffects(proj, rel, source, importersOf, contentByRel)) {
        let r = reviewAgg.get(source);
        if (!r) {
          r = { files: [], seen: new Set() };
          reviewAgg.set(source, r);
        }
        if (!r.seen.has(rel)) {
          r.seen.add(rel);
          r.files.push(rel);
        }
        continue;
      }
      let a = agg.get(source);
      if (!a) {
        a = { files: [], seen: new Set() };
        agg.set(source, a);
      }
      if (!a.seen.has(rel)) {
        a.seen.add(rel);
        a.files.push(rel);
      }
    }
  }

  const dead: DeadImportCandidate[] = [];
  const fileKind: Record<string, FileKind> = {};
  const byKind: Record<FileKind, number> = { src: 0, test: 0, fixture: 0, generated: 0, snapshot: 0 };
  for (const [source, a] of agg) {
    if (a.files.length === 0) continue;
    for (const rel of a.files) {
      const kind = classifyFileKind(rel);
      fileKind[rel] = kind;
      byKind[kind] += 1;
    }
    dead.push({ source, files: a.files.sort(), reason: 'no_reference' });
  }
  dead.sort((x, y) => (x.source < y.source ? -1 : 1));

  const needsReview: NeedsReviewCandidate[] = [];
  for (const [source, r] of reviewAgg) {
    if (r.files.length === 0) continue;
    needsReview.push({ source, files: r.files.sort(), reason: 'last_importer_with_load_effects' });
  }
  needsReview.sort((x, y) => (x.source < y.source ? -1 : 1));

  // ★ 第三态：**没判出来** —— 必须报出来（不许静默当成「在用」）
  const unjudged: UnjudgedCandidate[] = [];
  for (const [source, u] of unjudgedAgg) {
    if (u.files.length === 0) continue;
    unjudged.push({ source, files: u.files.sort() });
  }
  unjudged.sort((x, y) => (x.source < y.source ? -1 : 1));

  return {
    dead,
    unjudged,
    needsReview,
    scanned: absFiles.length,
    fileKind,
    byKind,
    limitations: [
      '文件级自洽判定：某 import 的全部绑定在文件内零引用即报死；注释中的同名出现（TS）会保守多活',
      'Go 空导入/点导入与 TS 副作用导入/re-export 恒活（import 即执行副作用，绝不误删）',
      '判定仅见文件内部，未做跨文件可达性——保守漏报多于误报；删除前请先过验证闭环',
      '来源分类纯路径判定：fixture/generated/snapshot 多为夹具/产物噪音，真实可清项以 src/test 为主，仍建议逐个过验证',
      '★ 闸②（needsReview）：该源是最后一个引用点【且】加载可能有效果 ⇒ 不自动删。',
      '★★ 三态（unjudged）：拿不到解析事实 ⇒ 报 unjudged，**不删也不冒充「在用」**；',
      '   它的计数是「解析能力」的量具（实测本仓 TS 侧当前为 0；一旦 >0 就是有东西没算到）。',
      '★ 闸② 的已知边界（v1，有意如此）：① 只覆盖**项目内相对说明符**，外部依赖（裸包名 / node:）不覆盖；',
      '   ② 有效果判定是**文本保守**近似（认不出即算有效果）；③ 只看目标模块**自身**，未展开它的 import 闭包。',
    ],
  };
}

/** 剥 TS 行注释 + 块注释（保行号/换行数），用于"源发现"侧：注释里的 import 字面量
 *  （如 docstring `// B import {..} from 'a'`）不该被当成真实模块源。
 *  先归一化 \r：JS 正则 `.` 不匹配 `\r`，CRLF 文件里 `//` 行注释会剥离失败（`$` 又不能在 \r 前锚定）。
 *  行注释保护 URL：`://` 前的 `//` 当字符串不剥（https://…）。块注释替换为空白保换行。 */
function stripTsComments(src: string): string {
  let out = src.replace(/\r/g, '');
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  out = out
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  return out;
}

/** 枚举 TS/JS 源码里出现的模块说明符（import/require/export-from），去引号。
 *  先剥注释：注释里的 `import ... from 'x'` / `require('x')` 字面量不是真导入，
 *  不该被当成源（否则 docstring 示例会把 'a'/'x' 之类报成死 import）。 */
export function enumerateTsSources(src: string): string[] {
  const scan = stripTsComments(src);
  const out = new Set<string>();
  const mod = (m: RegExpMatchArray): void => {
    const s = m[m.length - 1];
    if (s) out.add(s.replace(/^['"]|['"]$/g, ''));
  };
  // 具名/默认/命名空间/副作用 import 与 type import
  const reImport = /import(?:\s+type)?\s+[\s\S]*?from\s*(['"][^'"]+['"])/g;
  let m: RegExpMatchArray | null;
  while ((m = reImport.exec(scan)) !== null) mod(m);
  // import 'x' 副作用（无 from）
  const reBare = /import\s*(['"])([^'"]+)\1/g;
  while ((m = reBare.exec(scan)) !== null) {
    if (m.index !== undefined && scan.slice(Math.max(0, m.index - 8), m.index).trimEnd().endsWith('from')) continue;
    out.add(m[2]);
  }
  // export ... from 'x'
  const reExport = /export\s*[\s\S]*?from\s*(['"][^'"]+['"])/g;
  while ((m = reExport.exec(scan)) !== null) mod(m);
  // require('x')
  const reRequire = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((m = reRequire.exec(scan)) !== null) out.add(m[2]);
  return [...out];
}