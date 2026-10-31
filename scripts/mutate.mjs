/**
 * mutate.mjs —— 判据突变测试：**改代码**，看判据会不会红。
 *
 * ## 它回答的问题（唯一一个）
 * **「这条判据能发现代码被改坏吗？」**
 * 做法：挑一条判据 → 在它**断言的那段 `src/` 代码**上做**一处**语义突变 → 跑该条判据
 * → 判据 `fail` ⇒ **killed**（判据有反应）；仍然 `pass` ⇒ **survived**（判据对逻辑错无感）。
 *
 * ## ★★★ 2026-10-31 订正（本文件此前量的是另一件事）
 * 旧实现 `mutantsOf()` 变异的是 **判据自身**（把 `symbol` 改成 `symbol + '__MUTANT__'`、
 * 把 `input` 的叶子换成边界值）⇒ 它证明的是「判据对自己的字段变化敏感」，
 * **不是**「判据能发现代码被改坏」。`survived === 0` 按构造成立（名字改了必然找不到符号），
 * 所以那份全绿读数与「判据是不是装饰」**无关**。
 * 现在变异点**必须落在 `src/` 的代码上**；判据对象一个字节都不改。
 *
 * ## 观测源决定「改 src 看得见吗」（★ 这条不写清就会得出假读数）
 * | 判据 kind | 读出事实的地方 | 改 `src/` 能被它看见？ |
 * |---|---|---|
 * | `behavior-cases` | `runHarness` **现读** `spec.file`（src） | ✅ 能 —— 这才是**语义类**样本 |
 * | `call-exists` | `cache.db` 的调用边（源自 src，判前保鲜） | ✅ 能，但**只抓结构**（删/换了调用） |
 * | `source-has` | 现读磁盘文本 | ✅ 能，但**只抓文本**（改字符串就红，抓不到逻辑） |
 * | `run` | 求值域里的 `validateDSL` 等来自 **`dist/`** | ❌ 看不见 —— 必须 `npm run build` 之后另量 |
 * ⇒ 只把 `behavior-cases` 当**语义样本**计分；`call-exists` 作**结构代理对照**单列；
 *   `run` / `source-has` 归 `skipped` 并各自标注原因（**不冒充 survived**，也不冒充 killed）。
 *
 * ## 安全纪律（变异是破坏性的，进 `npm run gate` 也跑）
 * - 一次只改**一处**，改前把原文读成 Buffer；
 * - 每次判完**立刻**写回，并用 `sha256` 逐字节自检；不等会 ⇒ **抛错停机**（不继续下一次）；
 * - 还原必须连 **mtime/atime** 一起还原：只还字节会让「dist 不比 src 旧」那道门（`mcp_scan` ④）
 *   与 judge 的 stale 提示把这次测量读成"源码刚改过"（实测撞红过）；
 * - `finally` + `process.on('exit'|'SIGINT'|'SIGTERM'|'uncaughtException')` 再兜一次还原；
 * - `.agent-io/mutate.lock` 拒**并行**（共享 `dist/` / `judge-cache` / `cache.db`）；
 * - 变异体必须**语法可解析**（`typescript` 的 parseDiagnostics 为空）后才许写盘
 *   —— 否则判据报 `unsupported`（"判不了"）会被误记成"抓到了"。
 *
 * ## 两个词（与 impl-mutate.mjs 同口径）
 * - **killed** = 判据 `fail` ⇒ 判据在这处代码上是**活的**
 * - **survived** = 判据仍 `pass` ⇒ ★ 该判据对这处逻辑**无感**（不是"代码没问题"）
 *
 * ## 用法
 *   node scripts/mutate.mjs                    # 全部册 · 5 个语义样本
 *   node scripts/mutate.mjs --n=3 --json       # 机器可读
 *   node scripts/mutate.mjs --feature=agent-io --only=src/domain/text_strip.ts#isCodeText
 *   node scripts/mutate.mjs --no-structural    # 不跑结构代理对照
 *   import { runMutate } from './mutate.mjs'   # design-check 的 D7/D9 用它
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ── 还原登记：任何退出路径都要把被改过的文件写回去 ────────────────────
/** abs -> {buf, sha} */
const ACTIVE = new Map();
let hooksInstalled = false;

function restoreAll(reason) {
  for (const [abs, rec] of ACTIVE) {
    try {
      fs.writeFileSync(abs, rec.buf);
      if (rec.atimeMs) fs.utimesSync(abs, rec.atimeMs / 1000, rec.mtimeMs / 1000);
      const now = sha(fs.readFileSync(abs));
      if (now !== rec.sha) console.error(`  ✗ 还原后 sha256 不一致：${abs}（${reason}）`);
    } catch (e) {
      console.error(`  ✗ 还原失败：${abs} —— ${e.message}（${reason}）`);
    }
  }
  ACTIVE.clear();
}

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const die = (sig) => () => {
    restoreAll(`signal ${sig}`);
    process.exit(1);
  };
  process.on('exit', () => restoreAll('exit'));
  process.on('SIGINT', die('SIGINT'));
  process.on('SIGTERM', die('SIGTERM'));
  process.on('uncaughtException', (e) => {
    restoreAll('uncaughtException');
    console.error(e);
    process.exit(1);
  });
}

// ── 并行闸（共享 dist/ · judge-cache · cache.db ⇒ 一次只许一个）────────
function acquireLock(root) {
  const f = path.join(root, '.agent-io', 'mutate.lock');
  if (fs.existsSync(f)) {
    const pid = Number(String(fs.readFileSync(f, 'utf8')).trim());
    let alive = false;
    try {
      if (pid > 0) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch {
      alive = false;
    }
    if (alive && pid !== process.pid) {
      throw new Error(`已有 mutate 在跑（pid ${pid}，锁 ${f}）⇒ 不许并行：共享 dist/ · judge-cache · cache.db`);
    }
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, String(process.pid), 'utf8');
  return () => {
    try {
      fs.unlinkSync(f);
    } catch {
      /* 已经没了就算 */
    }
  };
}

// ── 判据分类：观测源 + 是否语义类 ────────────────────────────────────
/**
 * 判据的「观测源」——**它读哪份代码才看得见一处变异**。
 * 这不是分类癖好：判据看不见的变异，跑出来的 `survived` 是假读数。
 */
export function observationOf(e) {
  const k = String(e?.kind ?? '');
  if (k === 'behavior-cases') return 'src'; // harness 现读 spec.file（src）
  if (k === 'source-has') return 'src-text'; // 现读磁盘文本
  if (k === 'call-exists') return 'src-index'; // cache.db 调用边（源自 src）
  if (k === 'run') {
    // 求值域里能读到 src 的只有显式的 readFileSync（= grep 型）；其余一律走 dist
    return /readFileSync/.test(String(e?.expect ?? '')) ? 'src-text' : 'dist';
  }
  return 'n/a';
}

/** 语义类 = 判据本身能发现「值算错了」；结构代理只能发现「东西不见了 / 名字变了」 */
export function strengthOf(e) {
  const k = String(e?.kind ?? '');
  if (k === 'behavior-cases') return 'semantic';
  if (k === 'run') return observationOf(e) === 'dist' ? 'semantic@dist' : 'structural';
  return 'structural';
}

// ── 目标函数定位（真 AST，不靠正则）─────────────────────────────────
function locateFunction(text, fileName, symbol) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === symbol && n.body) {
      found = n;
      return;
    }
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        const name = d.name;
        const init = d.initializer;
        if (!init) continue;
        if (
          ts.isIdentifier(name) &&
          name.text === symbol &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          init.body &&
          ts.isBlock(init.body)
        ) {
          found = init;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found || !found.body) return null;
  return { sf, node: found, bodyStart: found.body.getStart(sf), bodyEnd: found.body.getEnd() };
}

// ── 候选突变点 ───────────────────────────────────────────────────────
/** 关系运算符取反（语义翻转，不是"换个方向"） */
const REL_FLIP = {
  '<': '>=',
  '>': '<=',
  '<=': '>',
  '>=': '<',
};

/**
 * 在目标函数体内收集候选突变点。
 * ★ 比较运算符（`===`/`!==`/`==`/`!=`）的互换表**不在这里**：一处权威是
 *   `src/infrastructure/parse/mutants.ts`（经 dist 的 `extractMutants` 取，含 tree-sitter 偏移）。
 *   本函数只补它没有的算子（关系取反 / 布尔取反 / 字面量改值）。
 */
async function candidateMutants(root, fileRel, text, symbol) {
  const loc = locateFunction(text, fileRel, symbol);
  if (!loc) return { loc: null, points: [] };
  const { bodyStart, bodyEnd, sf } = loc;
  const pts = [];

  // ① 比较运算符互换（单一权威：mutants.ts）
  try {
    const mod = await import(
      pathToFileURL(path.join(root, 'dist/src/infrastructure/parse/mutants.js')).href
    );
    const all = await mod.extractMutants(path.join(root, fileRel), text);
    for (const m of all) {
      if (m.startIndex >= bodyStart && m.endIndex <= bodyEnd) {
        pts.push({ prio: 1, op: 'swap', start: m.startIndex, end: m.endIndex, to: m.to, line: m.line });
      }
    }
  } catch (e) {
    // 拿不到算子表 ⇒ 只是少一类算子，不是"没有变异点"：如实说，不静默当空。
    console.error(`  ⚠ 取不到 comparison-swap 算子表（${e.message}）⇒ 本次少一类算子（不是"没变异点"）`);
  }

  // ② 关系取反 / ③ 布尔取反 / ④ 字符串改值 / ⑤ 数值 ±1
  const walk = (n) => {
    if (n.getStart(sf) < bodyStart || n.getEnd() > bodyEnd) {
      // 子节点可能在界内，仍要继续下钻
    }
    if (ts.isBinaryExpression(n)) {
      const tok = n.operatorToken.getText(sf);
      const flip = REL_FLIP[tok];
      if (flip) {
        pts.push({
          prio: 2,
          op: 'rel',
          start: n.operatorToken.getStart(sf),
          end: n.operatorToken.getEnd(),
          to: flip,
          line: sf.getLineAndCharacterOfPosition(n.operatorToken.getStart(sf)).line + 1,
          label: `rel · L${sf.getLineAndCharacterOfPosition(n.operatorToken.getStart(sf)).line + 1} · ${tok} → ${flip}`,
        });
      }
    }
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) {
      const isTrue = n.kind === ts.SyntaxKind.TrueKeyword;
      pts.push({
        prio: 3,
        op: 'bool',
        start: n.getStart(sf),
        end: n.getEnd(),
        to: isTrue ? 'false' : 'true',
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      });
    }
    if (ts.isStringLiteral(n) && n.getStart(sf) >= bodyStart && n.getEnd() <= bodyEnd) {
      const raw = text.slice(n.getStart(sf), n.getEnd());
      const q = raw[0] === "'" ? "'" : '"';
      const inner = n.text.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`);
      pts.push({
        prio: 4,
        op: 'str',
        start: n.getStart(sf),
        end: n.getEnd(),
        to: `${q}${inner}__MUT${q}`,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      });
    }
    if (ts.isNumericLiteral(n) && n.getStart(sf) >= bodyStart && n.getEnd() <= bodyEnd) {
      const v = Number(n.text);
      if (Number.isFinite(v)) {
        pts.push({
          prio: 5,
          op: 'num',
          start: n.getStart(sf),
          end: n.getEnd(),
          to: String(Number.isInteger(v) ? v + 1 : v + 1),
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        });
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(loc.node.body);

  pts.sort((a, b) => a.prio - b.prio || a.start - b.start);
  return { loc, points: pts };
}

/** 结构代理专用：删掉「必须存在的那个调用」所在的整条语句 */
function deleteCallMutant(text, fileRel, fnSymbol, target) {
  const loc = locateFunction(text, fileRel, fnSymbol);
  if (!loc) return null;
  const { sf, bodyStart, bodyEnd } = loc;
  let hit = null;
  const walk = (n) => {
    if (hit) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (name === target) {
        // 往上找到函数体里的那条语句（语句级删除；`const x = f()` 也算）
        let s = n;
        while (s.parent && !ts.isStatement(s) && s.parent !== sf) s = s.parent;
        if (ts.isStatement(s) && s.getStart(sf) >= bodyStart && s.getEnd() <= bodyEnd) hit = s;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(loc.node.body);
  if (!hit) return null;
  return {
    prio: 0,
    op: 'drop-call',
    start: hit.getStart(sf),
    end: hit.getEnd(),
    to: '',
    line: sf.getLineAndCharacterOfPosition(hit.getStart(sf)).line + 1,
    label: `删掉对 ${target}() 的调用（整条语句）`,
  };
}

/** 应用一处突变（纯函数）；不能解析 ⇒ null（绝不让语法错冒充"被抓到"） */
function applyPoint(text, fileRel, p) {
  const next = text.slice(0, p.start) + p.to + text.slice(p.end);
  if (next === text) return null;
  const sf = ts.createSourceFile(fileRel, next, ts.ScriptTarget.Latest, false);
  if ((sf.parseDiagnostics ?? []).length > 0) return null;
  return next;
}

const pointLabel = (t, p) =>
  p.label ??
  `${p.op} · L${p.line} · ${String(t.slice(p.start, p.end)).slice(0, 24)} → ${String(p.to).slice(0, 24)}`;

// ── 从册里挑样本 ─────────────────────────────────────────────────────
function readDsl(root, feature) {
  const file = path.join(root, '.agent-io', 'design', `${feature}.dsl.json`);
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function listFeatures(root) {
  const dir = path.join(root, '.agent-io', 'design');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.dsl.json'))
    .map((f) => f.slice(0, -'.dsl.json'.length))
    .sort();
}

/** 全部判据（带 node 归属）+ 分层统计 */
export function collectExpectations(dsl) {
  const out = [];
  for (const n of dsl.geometry?.nodes ?? []) {
    for (const e of n.decision?.expectations ?? []) {
      out.push({ node_id: n.id, node_label: String(n.description ?? n.id), expectation: e });
    }
  }
  return out;
}

const judgeCorePath = (ROOT) => path.join(ROOT, 'dist/src/application/design/intent/expectations.js');

// ── 计划（只读）：挑样本 + 算突变体 —— **一个字节都不写盘** ──────────────
/**
 * ★ 为什么"计划"要能单独调用：判据突变器本身也要有判据。
 *   `tests/p0_mutate_is_real.test.ts` 靠它断言「`mutants[].after` 是**改写过后的源码**、
 *   `file` 在 `src/` 下」—— 旧实现（变异判据）在这一步就会现形。
 *
 * @param {string} root 项目根
 * @param {string[]} features 册名
 * @param {{n?:number, structural?:number|false, only?:string}} [opts]
 * @returns {Promise<{expectations:number, semantic:any[], structural:any[], semSamples:any[], stSamples:any[], skipReasons:Record<string,number>, plans:any[]}>}
 */
export async function planMutants(root, features, opts = {}) {
  const N = Number(opts.n ?? 5);
  const N_STRUCT = opts.structural === false ? 0 : Number(opts.structural ?? 1);
  const ROOT = path.resolve(root);

  // 全部判据（分母；0.12：统计必须带分母）
  const all = [];
  for (const f of features) {
    for (const it of collectExpectations(readDsl(ROOT, f))) all.push({ feature: f, ...it });
  }

  const skipReasons = {
    not_src: 0, // 判据的文件不在 src/ 下（文档 / 配置）⇒ 不参与代码突变
    reads_dist: 0, // run：求值域来自 dist ⇒ 改 src 它看不见
    src_text_only: 0, // run/source-has：只读文本（grep 型）⇒ 只能证明"文本变了"
    no_symbol: 0, // 判据没有可定位的符号（file-exists / edge-* 等）
    file_missing: 0,
    no_mutant: 0, // 目标函数体内找不到可应用（且语法合法）的突变点
    not_selected: 0, // 本次样本额度用完了
  };

  // 语义样本候选：behavior-cases，且目标文件在 src/ 下
  const semantic = [];
  const structural = [];
  const seen = new Set();
  for (const it of all) {
    const e = it.expectation;
    const obs = observationOf(e);
    const strength = strengthOf(e);
    if (e.kind === 'run' && obs === 'dist') {
      skipReasons.reads_dist++;
      continue;
    }
    if (obs === 'src-text') {
      skipReasons.src_text_only++;
      continue;
    }
    if (obs === 'n/a') {
      skipReasons.no_symbol++;
      continue;
    }
    const rel = String(e.path ?? '').replace(/\\/g, '/');
    if (!rel.startsWith('src/')) {
      skipReasons.not_src++;
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, rel))) {
      skipReasons.file_missing++;
      continue;
    }
    if (e.kind === 'behavior-cases' && strength === 'semantic') {
      const key = `${rel}#${e.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      semantic.push({ ...it, file: rel });
    } else if (e.kind === 'call-exists') {
      const key = `ce:${rel}#${e.symbol}->${e.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      structural.push({ ...it, file: rel });
    }
  }
  // 确定性顺序（可复现）：按 (文件, 符号) 排
  const cmp = (a, b) => (a.file + '#' + a.expectation.symbol).localeCompare(b.file + '#' + b.expectation.symbol);
  semantic.sort(cmp);
  structural.sort(cmp);

  let semSamples = semantic;
  let stSamples = structural;
  if (opts.only) {
    const [of, os] = String(opts.only).split('#');
    const keep = (x) => x.file === of && String(x.expectation.symbol) === String(os);
    semSamples = semantic.filter(keep);
    stSamples = structural.filter(keep);
    if (!semSamples.length && !stSamples.length) throw new Error(`--only=${opts.only} 没有匹配任何判据（文件+符号要逐一相等）`);
  } else {
    semSamples = semantic.slice(0, N);
    stSamples = structural.slice(0, N_STRUCT);
  }
  skipReasons.not_selected = semantic.length - semSamples.length + (structural.length - stSamples.length);

  // 为每个样本算突变体（`before` / `after` 都是**源码全文**，判据对象原样不动）
  const plans = [];
  for (const sa of [
    ...semSamples.map((x) => ({ x, cls: 'semantic' })),
    ...stSamples.map((x) => ({ x, cls: 'structural' })),
  ]) {
    const it = sa.x;
    const text = fs.readFileSync(path.join(ROOT, it.file), 'utf8');
    const sym = String(it.expectation.symbol);
    let points = [];
    let loc = null;
    if (it.expectation.kind === 'call-exists') {
      const p = deleteCallMutant(text, it.file, sym, String(it.expectation.target));
      if (p) points = [p];
    } else {
      const r = await candidateMutants(ROOT, it.file, text, sym);
      loc = r.loc;
      // 每个算子类只试一次（同类两处突变 = 同一个问题问两遍）
      const byPrio = new Map();
      for (const p of r.points) if (!byPrio.has(p.prio)) byPrio.set(p.prio, p);
      points = [...byPrio.values()];
    }
    const mutants = [];
    for (const p of points.slice(0, 3)) {
      const after = applyPoint(text, it.file, p);
      if (after === null) continue; // 语法不可解析 ⇒ 不许写盘（否则 unsupported 会被误记成"抓到"）
      mutants.push({ label: pointLabel(text, p), line: p.line, before: text, after });
    }
    if (!mutants.length) {
      if (loc || it.expectation.kind === 'call-exists') skipReasons.no_mutant++;
      else skipReasons.no_symbol++;
    }
    plans.push({
      ...base(it, sa.cls),
      expectation: it.expectation,
      node_label: it.node_label,
      mutants,
      reason: mutants.length
        ? null
        : it.expectation.kind === 'call-exists'
          ? `删不掉：\`${sym}\` 里找不到对 \`${it.expectation.target}()\` 的调用`
          : loc
            ? '函数体内没有语法合法的突变点'
            : `目标符号 \`${sym}\` 在 ${it.file} 里定位不到（不是 function 声明）`,
    });
  }
  return { expectations: all.length, semantic, structural, semSamples, stSamples, skipReasons, plans };
}

// ── 执行：改代码 → 跑判据 → 还原（逐字节）────────────────────────────
/**
 * @param {string|string[]} feature 册名（数组 = 多册；CLI 缺省 = 全部册）
 * @param {string} root 项目根
 * @param {{n?:number, structural?:number|false, only?:string}} [opts]
 */
export async function runMutate(feature, root = process.cwd(), opts = {}) {
  const ROOT = path.resolve(root);
  const features = Array.isArray(feature) ? feature : [feature];

  const distEntry = judgeCorePath(ROOT);
  if (!fs.existsSync(distEntry)) {
    // 0.12：判据执行核读不到 ⇒ 抛，不许回落成"0 个变异 = 全绿"
    throw new Error(`找不到 ${distEntry} —— 先 \`npm run build\`（判据执行核读 dist/，读不到不许静默跳过）`);
  }
  const plan = await planMutants(ROOT, features, opts);
  const je = await import(pathToFileURL(distEntry).href);

  const unlock = acquireLock(ROOT);
  installHooks();
  const items = [];
  let attempts = 0;
  const restored = [];

  /** 写一处突变 → 跑该条判据 → **立刻**还原，并 sha256 自检 */
  const runMutant = async (p, plan_) => {
    const abs = path.join(ROOT, plan_.file);
    if (!ACTIVE.has(abs)) {
      const buf = fs.readFileSync(abs);
      const st = fs.statSync(abs);
      // ★ 必须连 mtime 一起还原：只还原字节，mtime 仍停在「刚被写过」⇒
      //   verify 的「dist 不比 src 旧」与 judge 的 stale 提示会被这次测量污染（实测撞红过）。
      ACTIVE.set(abs, { buf, sha: sha(buf), atimeMs: st.atimeMs, mtimeMs: st.mtimeMs });
    }
    const rec = ACTIVE.get(abs);
    if (rec.buf.toString('utf8') !== p.before) {
      throw new Error(`★ ${plan_.file} 在判据期间被别处改过（原文已不是计划时读到的内容）—— 停机，读数无效`);
    }
    fs.writeFileSync(abs, p.after, 'utf8');
    if (fs.readFileSync(abs, 'utf8') !== p.after) {
      throw new Error(`写入未生效：${plan_.file}（变异没落盘 ⇒ 本次读数无效）`);
    }
    try {
      const rep = await je.judgeExpectations(ROOT, [
        { node_id: plan_.node_id, node_label: plan_.node_label, expectation: plan_.expectation },
      ]);
      attempts += 1;
      const r = rep.items[0];
      return { verdict: r.verdict, detail: String(r.detail ?? '') };
    } finally {
      fs.writeFileSync(abs, rec.buf);
      if (rec.atimeMs) fs.utimesSync(abs, rec.atimeMs / 1000, rec.mtimeMs / 1000);
      const now = sha(fs.readFileSync(abs));
      if (now !== rec.sha) {
        throw new Error(`★ 还原失败：${plan_.file} 的 sha256 与原文不一致（${now} ≠ ${rec.sha}）—— 已停机，别再跑`);
      }
      ACTIVE.delete(abs);
      if (!restored.includes(plan_.file)) restored.push(plan_.file);
    }
  };

  try {
    for (const pl of plan.plans) {
      if (!pl.mutants.length) {
        items.push({ ...strip(pl), verdict: 'skipped', reason: pl.reason, attempts: [] });
        continue;
      }
      const tried = [];
      let last = null;
      for (const p of pl.mutants) {
        const r = await runMutant(p, pl);
        tried.push({ mutation: p.label, line: p.line, verdict: r.verdict, detail: r.detail.slice(0, 400) });
        last = r;
        // 抓到一次就够证「判据在这处代码上是活的」；`pass` 才继续试下一个算子类
        if (r.verdict === 'fail') break;
      }
      const verdict = last.verdict === 'fail' ? 'killed' : last.verdict === 'pass' ? 'survived' : 'unsupported';
      items.push({ ...strip(pl), verdict, attempts: tried });
    }
  } finally {
    restoreAll('finally');
    unlock();
  }

  const tally = (cls, v) => items.filter((i) => i.class === cls && i.verdict === v).length;
  const report = {
    mode: 'code',
    features,
    /** 判据总数（分母：本脚本只验样本，没验它们 ⇒ 两个数一起给，0.12） */
    expectations: plan.expectations,
    /** 语义样本候选（behavior-cases ∩ src） */
    candidates: plan.semantic.length,
    structural_candidates: plan.structural.length,
    sampled: plan.plans.length,
    semantic_sampled: plan.semSamples.length,
    structural_sampled: plan.stSamples.length,
    killed: tally('semantic', 'killed'),
    survived: tally('semantic', 'survived'),
    unsupported: tally('semantic', 'unsupported'),
    structural_killed: tally('structural', 'killed'),
    structural_survived: tally('structural', 'survived'),
    structural_unsupported: tally('structural', 'unsupported'),
    skipped: Object.values(plan.skipReasons).reduce((a, b) => a + b, 0),
    skipped_reasons: plan.skipReasons,
    attempts,
    restored_files: [...new Set(restored)],
    items,
  };
  // ★ `killed === 0`（没有样本被判定）**不是绿**：那是"没验"（0.12）
  report.ok = report.survived === 0 && report.unsupported === 0 && report.killed > 0;
  return report;
}

/** 报告里不带判据原文与代码全文（CLI 不打印它们，JSON 也够小） */
function strip(pl) {
  const { expectation: _e, node_label: _l, mutants, ...rest } = pl;
  return { ...rest, mutant_count: mutants.length };
}

function base(it, cls) {
  return {
    feature: it.feature,
    node_id: it.node_id,
    kind: it.expectation.kind,
    class: cls,
    file: it.file,
    symbol: it.expectation.symbol ?? null,
    target: it.expectation.target ?? null,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────
const isCli = (() => {
  try {
    return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isCli) {
  const args = process.argv.slice(2);
  const val = (n) => {
    const a = args.find((x) => x.startsWith(`--${n}=`));
    return a ? a.slice(n.length + 3) : null;
  };
  const ROOT = process.cwd();
  const FEATURES = val('feature') ? String(val('feature')).split(',') : listFeatures(ROOT);
  const N = Number(val('n') ?? 5);
  const JSON_OUT = args.includes('--json');
  const rep = await runMutate(FEATURES, ROOT, {
    n: N,
    structural: args.includes('--no-structural') ? false : 1,
    only: val('only') ?? undefined,
  });

  if (JSON_OUT) {
    console.log(JSON.stringify(rep, null, 2));
  } else {
    console.log(`══ mutate（**代码突变**；判据对象不动）· ${rep.features.join(', ')} ══`);
    console.log(`  册内判据 ${rep.expectations} 条 · 语义候选 ${rep.candidates} 条（behavior-cases∩src）· 本次样本 ${rep.sampled}`);
    console.log(`  ✓ killed（判据 fail ⇒ 这处代码上判据是活的）：${rep.killed}`);
    console.log(`  ★ survived（判据仍 pass ⇒ 对逻辑错无感）：${rep.survived}`);
    console.log(`  ? unsupported（判不了 ≠ 抓到）：${rep.unsupported}`);
    console.log(`  … skipped：${rep.skipped}（${Object.entries(rep.skipped_reasons).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')}）`);
    console.log('');
    for (const it of rep.items) {
      const tag = it.verdict === 'killed' ? 'killed ✓' : it.verdict === 'survived' ? '★ survived' : it.verdict === 'unsupported' ? '? unsupported' : '… skipped';
      console.log(`  ${tag}  ${it.file}#${it.symbol ?? ''}${it.target ? '->' + it.target : ''}  [${it.kind}/${it.class}]`);
      for (const a of it.attempts ?? []) {
        console.log(`      · ${a.verdict}  ${a.mutation}`);
        if (a.detail) console.log(`        ↳ ${String(a.detail).split('\n')[0].slice(0, 160)}`);
      }
      if (it.reason) console.log(`      · ${it.reason}`);
    }
    if (rep.structural_sampled) {
      console.log('');
      console.log(
        `  ── 结构代理对照（call-exists · 删一条必须存在的调用）：killed ${rep.structural_killed} · survived ${rep.structural_survived}` +
          ` · unsupported ${rep.structural_unsupported}`,
      );
      console.log('     ★ 它只能抓「调用不见了 / 名字变了」；把 `add(a,b)` 改成 `mul(a,b)` 这类**语义错它抓不到** —— 那要 behavior-cases。');
    }
    console.log('');
    console.log(`  还原：${rep.restored_files.length} 个文件逐字节还原 ✓（${rep.restored_files.join(', ') || '本次没改动任何文件'}）`);
    console.log(`  判据执行 ${rep.attempts} 次（串行；并行会串 dist/ · judge-cache · cache.db）`);
    if (!rep.ok && rep.survived === 0 && rep.unsupported === 0 && rep.killed === 0) {
      console.log('  ★ 没有一条样本被判定（killed=0）⇒ 这不是"全绿"，是**没验**。');
    }
  }
  process.exit(rep.ok ? 0 : 1);
}
