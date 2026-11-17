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
// ★ R75：重活排他锁的**唯一实现**（verify / mutate / judge-all 共用一份）
import { acquireHeavyLock } from './lib/heavy_lock.mjs';
// ★ 路径身份（软链/大小写/斜杠归一）：唯一实现
import { samePath } from './lib/path_identity.mjs';

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

// ── 并行闸（共享 dist/ · judge-cache · cache.db · design-db ⇒ 一次只许一个）────────
/**
 * ★★★ R75（2026-11-05）：**本函数原来是全仓唯一的锁实现，现已收归 `scripts/lib/heavy_lock.mjs`**。
 * 为什么搬走（0.9.1 方向 A：同一件事只许一个住处）：
 *   · 它报错文案里那句「不许并行：共享 dist/ · judge-cache · cache.db」**对 `verify` 与 `judge-all` 同样成立**，
 *     而它们当时**完全不受保护** ⇒ 实测三次拿到不可归因的假红（同一条命令两次结论不同 / 402ms 崩在这把锁上）。
 *   · 共用一份之后范围扩到三道重活，且**陈旧锁不再静默接管** —— `mutate` 会**改 `dist/` 里的文件再还原**，
 *     SIGKILL / 断电时 `restoreAll` 不执行 ⇒ 树可能**停在改过的状态**；静默接管 = 在不知道是什么的地上量。
 */
function acquireLock(root) {
  return acquireHeavyLock(root, { name: 'mutate' });
}

// ── 判据分类：观测源 + 是否语义类 ────────────────────────────────────
/**
 * 判据的「观测源」——**它读哪份代码才看得见一处变异**。
 * 这不是分类癖好：判据看不见的变异，跑出来的 `survived` 是假读数。
 */
export function observationOf(e) {
  const k = String(e?.kind ?? '');
  if (k === 'behavior-cases') return 'src'; // harness 现读 spec.file（src）
  if (k === 'journey-cases') return 'src'; // journey 执行核现转译 path 文件 + 闭包（src）
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
  if (k === 'journey-cases') return 'semantic'; // 出站帧投影比对 = 值语义（转交行删掉/拦截摘掉它必红）
  if (k === 'run') return observationOf(e) === 'dist' ? 'semantic@dist' : 'structural';
  return 'structural';
}

// ── T-#SOFT-KIND-RATCHET：存在类强度分档（Q1 已裁：4 kind，edge-* 归 semantic） ──
/**
 * ★ 唯一权威 = `src/application/design/db/rewrite_plan.ts#strengthOfKind` 的 `EXISTENCE_KINDS`
 *   （lead 2026-11-17 Q1 裁定：edge-exists/edge-absent 归 semantic，不在此集合）。
 *   这里是**脚本侧镜像**（planMutants 保持纯读、不依赖 dist）；等价性由
 *   `tests/p1_mutate_strength_quota.test.ts` 对权威逐 kind 钉死。
 *   ★ 与 `strengthOf()` 的关系：那是 mutate 内部"能抓值错 vs 结构代理"的分类；
 *   本表是设计侧"能不能发现逻辑错"的分类 —— 两者差在 call-exists（那边 structural / 这边 semantic），
 *   这个差是**有意保留**的，测试里钉死，不许静默统一。
 */
export const EXISTENCE_KINDS = new Set(['file-exists', 'source-has', 'symbol-exists', 'signature-matches']);
export function isExistenceKind(e) {
  return EXISTENCE_KINDS.has(String(e?.kind ?? e?.expectation?.kind ?? ''));
}

/** 强度桶：参与排序键（C.*）；与 class 一一对应，故不改变 semantic/structural 的既有次序。 */
export function strengthBucketOf(c) {
  if (c.strength_bucket) return c.strength_bucket;
  if (c.class === 'existence' || isExistenceKind(c)) return 'existence';
  if (c.class === 'structural' || String(c.kind ?? '') === 'call-exists') return 'wiring';
  return 'semantic';
}

/**
 * 在 `src/` 文本里为一条存在类判据找一个**可变异的锚点**（变它 ⇒ 判据应当 fail）。
 * · source-has：`must[]` 里的裸标识符，取 AST 中**首个 code token**（注释天然被 AST 排除）
 * · symbol-exists / signature-matches：**声明处**的符号名（盲改注释/类型引用不生效，实测过）
 * · file-exists：不删文件（破坏性越过"改一处源码"的纪律）⇒ null，进 skipReasons.no_anchor
 */
function existenceAnchor(text, fileRel, e) {
  const kind = String(e?.kind ?? '');
  if (kind === 'file-exists') return null;
  const sf = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true);
  const targets =
    kind === 'source-has'
      ? (e.must ?? []).map(String).filter((t) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t))
      : [String(e.symbol ?? '')].filter(Boolean);
  if (!targets.length) return null;
  const hits = [];
  const visit = (n) => {
    const isDecl =
      ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) ||
      ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n) ||
      (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name));
    if (isDecl && n.name && ts.isIdentifier(n.name) && targets.includes(n.name.text)) {
      hits.push({ start: n.name.getStart(sf), end: n.name.getEnd(), to: n.name.text + 'X',
        label: `存在类锚点 · ${kind} · ${n.name.text} → ${n.name.text}X`,
        line: sf.getLineAndCharacterOfPosition(n.name.getStart(sf)).line + 1 });
    }
    if (kind === 'source-has' && ts.isIdentifier(n) && targets.includes(n.text)) {
      const st = n.getStart(sf);
      if (!hits.some((h) => h.start === st)) {
        hits.push({ start: st, end: n.getEnd(), to: n.text + 'X',
          label: `存在类锚点 · source-has · ${n.text} → ${n.text}X`,
          line: sf.getLineAndCharacterOfPosition(st).line + 1 });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!hits.length) return null;
  hits.sort((a, b) => a.start - b.start); // 确定性：取最前的一个（与 T-#MUTATE-DET 码元序同精神）
  return hits[0];
}

/**
 * 分桶轮转：把按强度桶分组的样本合成**确定的**执行顺序（semantic → existence → wiring 循环，
 * 空桶跳过）。★ 只改变 plan 的**次序**，不改变 selectSamples 选出的成员 ⇒ T-#MUTATE-DET 的
 * "同一输入同一报告"与账 id 完全不受影响；跨轮次轮转需持久化游标（会破坏确定性），列待论证。
 */
export function rotateByStrength(groups) {
  const buckets = ['semantic', 'existence', 'wiring'];
  const queues = new Map(buckets.map((b) => [b, [...(groups[b] ?? [])]]));
  const out = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const b of buckets) {
      const q = queues.get(b);
      if (q?.length) { out.push(q.shift()); progress = true; }
    }
  }
  return out;
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

// ── 确定性采样 + 存活体挂账（T-#MUTATE-DET）──────────────────────────────
/**
 * ★★★ 2026-11-17（T-#MUTATE-DET）：**「同一输入 ⇒ 同一份报告」必须是结构保证，不是运气。**
 *
 * ## 病一（卡面原话「随机抽样」）—— 实测**不成立**，而真病更糟
 * 现 HEAD 的 `planMutants` **没有随机数**（本文件零 `Math.random`）：它是
 * `sort(按 file#symbol)` + `slice(0, N)`。实测同一册连跑两次，报告 sha256 **完全相同**。
 * ⇒ 真正的病不是"偶发不同"，是"**恒定相同**"：`slot_source.ts#checkSlotSources` 的三条突变体
 *   （swap / bool / str）全 `pass`，而它**恒**进前 5 ⇒ D7 **恒红** —— 一盏永远亮着的灯（0.16）。
 *
 * ## 病二（排序键不够硬）
 * 旧键 = `(file + '#' + symbol).localeCompare(…)`：
 * ① 缺 feature / 判据 kind / 突变算子类 ⇒ 跨册同名候选谁在前取决于**册的遍历顺序**；
 * ② `localeCompare` 跟随 ICU/locale ⇒ 换机器（en-US vs zh-CN）**可能换序**，
 *    "可复现"会被环境吃掉，且这种漂移**不会在单机复现**（最贵的一类缺陷）。
 *
 * ## 治法（三段，每段都能单独消融）
 * 1. `rankCandidates`：**与输入顺序无关**的去重（同键取 min(feature, node_id)）+ 码元序排序，
 *    键 = `feature · file · symbol · kind · target · 突变算子类`；
 * 2. `selectSamples`：**先**剔除无突变体（旧实现是"先抽 5 个再算"⇒ 实测 1/5 额度被
 *    "函数体内没有可突变点"白吃，样本数虚高）→ **再**跳过账内 id（`skipped_reason='baselined-survivor'`）
 *    → 最后取前 N。整个函数是**纯**的（只吃候选数组与账，不碰盘）⇒ 可注入、可消融；
 * 3. `scripts/mutate-survivors-baseline.json`：**只许人工增**的存活体账（形态仿 `write-log-baseline`）。
 *
 * ★ 账的边界（写清，别让这条变成静默豁口）：
 *   · 脚本**只读**账、从不写；新存活体只**点名**（`report.baseline_candidates`），入账由人确认；
 *   · 每条必须有 `why`（"这条判据为什么抓不住"），无 `why` 的行 ⇒ **抛**；
 *   · 账内 id 对不上现役判据 ⇒ `stale_baseline` 点名（**不自动删**，删也要人）；
 *   · `--only=<file#symbol>` **绕过**豁免（人明确点名要量这一格时，不许给一个"什么都没量"的结果）。
 */

/** 码元序（字节序）比较。★ 不用 `localeCompare`：它跟随 ICU/locale，换机器就换序。 */
const cmpCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 存活体账的路径（相对项目根）—— **唯一住处** */
export const SURVIVORS_BASELINE = 'scripts/mutate-survivors-baseline.json';

/**
 * 读存活体账。缺文件 ⇒ 空账（诚实：没账就没豁免）；**"读不懂" ⇒ 抛**。
 * ★ 为什么"读不懂"必须抛：若回落成空账，账被写坏的那天全部已挂账的存活体**同时复活**
 *   ⇒ 又是一盏恒红的灯，而人会把它读成"新问题"。宁可停机。
 */
export function loadSurvivorBaseline(root) {
  const file = path.join(path.resolve(root), SURVIVORS_BASELINE);
  if (!fs.existsSync(file)) return { file, rows: [], byId: new Map(), note: null, missing: true };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`★ ${SURVIVORS_BASELINE} 解析失败（${e.message}）—— 不许当空账（那会让全部挂账同时复活成假红）`);
  }
  if (!Array.isArray(raw?.rows)) {
    throw new Error(`★ ${SURVIVORS_BASELINE} 缺 rows 数组 —— 拒绝把"读不懂"当成"没有豁免"`);
  }
  const byId = new Map();
  for (const r of raw.rows) {
    const id = String(r?.id ?? '').trim();
    const why = String(r?.why ?? '').trim();
    if (!id) throw new Error(`★ ${SURVIVORS_BASELINE} 有一行没有 id`);
    if (!why) throw new Error(`★ ${SURVIVORS_BASELINE} 的 ${id} 没有 why —— 挂账必须点名"为什么抓不住"（无 why 的账 = 消红按钮）`);
    if (byId.has(id)) throw new Error(`★ ${SURVIVORS_BASELINE} 重复 id：${id}`);
    byId.set(id, { id, why, debt: r.debt ?? null, added_at: r.added_at ?? null, review_by: r.review_by ?? null });
  }
  return { file, rows: [...byId.values()], byId, note: raw.note ?? null, missing: false };
}

/** 测试/消融用的注入形态：`Map<id,row>` / 行数组 / `{rows,byId}` ⇒ 统一 `{rows,byId}` */
export function asBaseline(input) {
  if (!input) return { rows: [], byId: new Map(), note: null };
  if (input instanceof Map) return { rows: [...input.values()], byId: input, note: null };
  if (Array.isArray(input)) {
    const byId = new Map(input.filter(Boolean).map((r) => [String(r.id), r]));
    return { rows: [...byId.values()], byId, note: null };
  }
  if (input.byId) return { rows: input.rows ?? [...input.byId.values()], byId: input.byId, note: input.note ?? null };
  throw new Error('内部用法错误：baseline 必须是 Map / 数组 / {rows,byId}');
}

/** 存活体账 id = `册|文件|符号|kind[|target]`（竖线形态同 `write-log-baseline` 的 `at|file|kind`） */
export function survivorIdOf(c) {
  const kind = String(c.kind ?? c.expectation?.kind ?? '');
  const sym = String(c.symbol ?? c.expectation?.symbol ?? '');
  const parts = [String(c.feature ?? ''), String(c.file ?? ''), sym, kind];
  // call-exists 的"同一符号"会挂多条（每个 target 一条）⇒ target 进键
  if (kind === 'call-exists') parts.push(String(c.target ?? c.expectation?.target ?? ''));
  return parts.join('|');
}

/** 去重键：同一 (文件, 符号[, 目标]) 在册里可能重复声明（跨册同一条也常见）⇒ 只留一条 */
function dedupeKeyOf(c) {
  return c.class === 'structural' ? `ce:${c.file}#${c.symbol}->${c.target}` : `${c.file}#${c.symbol}`;
}

/** 稳定排序键（逐段码元序比）—— lead 裁定 feature+file+symbol+mutation-kind，另补 kind/target/class 消歧 */
export function sampleKeyOf(c) {
  return [
    String(c.feature ?? ''),
    String(c.file ?? ''),
    String(c.symbol ?? c.expectation?.symbol ?? ''),
    String(c.kind ?? c.expectation?.kind ?? ''),
    String(c.target ?? ''),
    (c.mutation_kinds ?? []).join(','),
    String(c.class ?? ''),
    strengthBucketOf(c), // ★ T-#SOFT-KIND-RATCHET：强度桶进排序键（同 class 内不换序；跨 class 本就分开 pick）
  ];
}

function cmpStable(a, b) {
  const ka = sampleKeyOf(a);
  const kb = sampleKeyOf(b);
  for (let i = 0; i < ka.length; i++) {
    const r = cmpCode(ka[i], kb[i]);
    if (r) return r;
  }
  return 0;
}

/**
 * 去重 + 排序。★ **与输入顺序无关**（这正是"打乱候选顺序 ⇒ 样本不变"能成立的原因）：
 * 旧实现"首见即留"，而 `feature` 是键的一部分 ⇒ 换个遍历顺序，样本里的 `feature` 就换了。
 * 现在同键取 `min(feature)`、再 `min(node_id)`。
 */
export function rankCandidates(cands) {
  const best = new Map();
  for (const c of cands) {
    const k = dedupeKeyOf(c);
    const cur = best.get(k);
    const tie = `${c.feature}\u0000${c.node_id}`;
    if (!cur || cmpCode(tie, `${cur.feature}\u0000${cur.node_id}`) < 0) best.set(k, c);
  }
  return [...best.values()].sort(cmpStable);
}

/** 候选身上出现过的突变算子类（唯一化 + 码元序）—— 排序键的最后一维 */
export function mutKindsOf(mutants) {
  return [...new Set((mutants ?? []).map((m) => String(m.op ?? '?')))].sort(cmpCode);
}

/**
 * **纯**选择：去重 → 排序 → (`only`) → 剔除无突变体 → 账内豁免 → 取前 N。
 * @param {Array} cands 候选（**必须已算好 `mutants`**；`mutants` 为空的候选不吃额度）
 * @param {{n?:number, only?:string, baseline?:Map<string,any>}} [opts]
 *
 * ★ `baselined` 只收**真的顶掉了一个样本位**的账目（`slot` = 它顶掉的那个位次）：
 *   额度满了之后才轮到的账目**没有**影响本次样本 ⇒ 既不计数也不点名（否则"豁免 N 条"
 *   会把不生效的行算进去，读数比实际作用大 —— 那是另一种 0.16）。
 */
export function selectSamples(cands, opts = {}) {
  const n = Number(opts.n ?? 5);
  const baseline = opts.baseline instanceof Map ? opts.baseline : new Map();
  const ranked = rankCandidates(cands);
  let pool = ranked;
  if (opts.only) {
    const [of, os] = String(opts.only).split('#');
    pool = ranked.filter((c) => c.file === of && String(c.symbol ?? '') === os);
    // ★ 不在这里抛「没匹配」：本函数对语义/结构两档**各调一次**，某一档空是常态
    //   （`--only` 指的那条只可能在其中一档）。"整次跑一条都没匹配"由 `planMutants` 统一判红
    //   （它看得见两档的并集）。
  }
  const limit = opts.only ? Number.POSITIVE_INFINITY : n;
  const noMutant = [];
  const baselined = [];
  const live = [];
  for (const c of pool) {
    if (!(c.mutants?.length)) {
      noMutant.push(c);
      continue;
    }
    if (live.length >= limit) break; // 额度已满：后面既不算豁免也不算样本
    // ★ `--only` 是人明确点名要量这一格 ⇒ **绕过**豁免（否则给一个"什么都没量"的读数）
    if (!opts.only) {
      const row = baseline.get(survivorIdOf(c));
      if (row) {
        baselined.push({ ...row, candidate: c, slot: live.length });
        continue;
      }
    }
    live.push(c);
  }
  // `not_selected` 的分母 = **可突变且未被豁免**的候选（与额度、与本次是否被账顶掉无关）
  let notSelected = 0;
  if (!opts.only) {
    const eligible = pool.filter((c) => c.mutants?.length && !baseline.has(survivorIdOf(c)));
    notSelected = Math.max(0, eligible.length - live.length);
  }
  return { ranked, pool, live, samples: live, noMutant, baselined, notSelected };
}

/** 给**一个候选**算突变体（`before` 是源码全文；每算子类只试一次；语法不合法的不许写盘） */
async function mutantsFor(ROOT, c) {
  const text = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
  const sym = String(c.symbol ?? c.expectation?.symbol ?? '');
  const kind = String(c.kind ?? c.expectation?.kind ?? '');
  let points = [];
  let loc = null;
  if (kind === 'call-exists') {
    const p = deleteCallMutant(text, c.file, sym, String(c.target ?? c.expectation?.target ?? ''));
    if (p) points = [p];
  } else if (strengthBucketOf(c) === 'existence') {
    // ★ T-#SOFT-KIND-RATCHET：存在类用专用锚点算子（改判据钉住的源码 token）
    const p = existenceAnchor(text, c.file, c.expectation ?? c);
    if (p) points = [p];
  } else {
    const r = await candidateMutants(ROOT, c.file, text, sym);
    loc = r.loc;
    // 每个算子类只试一次（同类两处突变 = 同一个问题问两遍）
    const byPrio = new Map();
    for (const p of r.points) if (!byPrio.has(p.prio)) byPrio.set(p.prio, p);
    points = [...byPrio.values()];
  }
  const mutants = [];
  for (const p of points.slice(0, 3)) {
    const after = applyPoint(text, c.file, p);
    if (after === null) continue; // 语法不可解析 ⇒ 不许写盘（否则 unsupported 会被误记成"抓到"）
    mutants.push({ label: pointLabel(text, p), line: p.line, op: p.op, before: text, after });
  }
  return { mutants, loc };
}

// ── 计划（只读）：挑样本 + 算突变体 —— **一个字节都不写盘** ──────────────
/**
 * ★ 为什么"计划"要能单独调用：判据突变器本身也要有判据。
 *   `tests/p0_mutate_is_real.test.ts` 靠它断言「`mutants[].after` 是**改写过后的源码**、
 *   `file` 在 `src/` 下」—— 旧实现（变异判据）在这一步就会现形。
 *
 * ★★★ T-#MUTATE-DET（2026-11-17）：本函数现在把「采样」与「算突变体」**调了顺序** ——
 *   先给**每个候选**算突变体，再按稳定键排序、剔除不可突变、跳过账内 id、取前 N。
 *   理由与账的边界见上方「确定性采样 + 存活体挂账」头注；纯选择段抽成 `selectSamples`
 *   就是为了让 `tests/p1_mutate_determinism.test.ts` 能**注入候选数组直测**（不跑真 mutate）。
 *
 * @param {string} root 项目根
 * @param {string[]} features 册名
 * @param {{n?:number, structural?:number|false, only?:string, baseline?:any}} [opts]
 *   `baseline` 只给测试/消融用（`[]` = 关掉豁免）；缺省从盘上读账。
 * @returns {Promise<{expectations:number, semantic:any[], structural:any[], semSamples:any[], stSamples:any[], skipReasons:Record<string,number>, plans:any[], baselined:any[], stale_baseline:string[], baseline_path:string}>}
 */
export async function planMutants(root, features, opts = {}) {
  const N = Number(opts.n ?? 5);
  const N_STRUCT = opts.structural === false ? 0 : Number(opts.structural ?? 1);
  const ROOT = path.resolve(root);
  // ★ 账**默认读盘**；注入只给测试/消融（`opts.baseline = []` ⇒ 关掉豁免）。
  //   缺文件 = 空账（诚实：没账就没豁免）；"读不懂" = 抛（见 loadSurvivorBaseline 的头注）。
  const baseline = opts.baseline === undefined ? loadSurvivorBaseline(ROOT) : asBaseline(opts.baseline);

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
    not_selected: 0, // 额度用完（★ 只数"可突变且未被豁免"的候选）
    baselined_survivor: 0, // ★ 账内已知存活体（豁免不隐藏：每跑都点名）
    no_anchor: 0, // ★ T-#SOFT-KIND-RATCHET：存在类候选里找不到可变异的代码锚点（如实报）
  };

  // 候选：behavior-cases（语义）/ call-exists（结构代理）/ **存在类**（软判据）。
  // ★ 去重与排序**不在这里做** —— 三者都统一收在 rankCandidates（同一件事只许一个住处）。
  const semantic = [];
  const structural = [];
  const existence = [];
  for (const it of all) {
    const e = it.expectation;
    const obs = observationOf(e);
    const strength = strengthOf(e);
    const isEx = isExistenceKind(e);
    if (e.kind === 'run' && obs === 'dist') {
      skipReasons.reads_dist++;
      continue;
    }
    // ★ 存在类的 src-text / n/a 不再是跳过理由：核心机制就是文本/符号锚点，由 existenceAnchor 现算。
    if ((obs === 'src-text' || obs === 'n/a') && !isEx) {
      skipReasons[obs === 'src-text' ? 'src_text_only' : 'no_symbol']++;
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
    const carried = { ...it, file: rel, kind: e.kind, symbol: e.symbol ?? null, target: e.target ?? null };
    if (e.kind === 'behavior-cases' && strength === 'semantic') {
      semantic.push({ ...carried, class: 'semantic', strength_bucket: 'semantic' });
    } else if (e.kind === 'call-exists') {
      structural.push({ ...carried, class: 'structural', strength_bucket: 'wiring' });
    } else if (isEx) {
      existence.push({ ...carried, class: 'existence', strength_bucket: 'existence' });
    }
  }

  // ★ ① 先给**每个候选**算突变体（旧实现是"先抽 5 个再算"）：
  //   · `mutants.length === 0` 的候选从此**不吃额度**（实测旧口径 5 个额度里 1 个被白吃 ⇒ 样本数虚高）；
  //   · 让"突变算子类"能进排序键（lead 裁定 feature+file+symbol+kind 之后再补一维）。
  //   ★ T-35 的边界照旧：跳过的是**候选样本**，不是判据本身（判据仍在册、仍被 judge 判）。
  const candidates = [];
  for (const c of [...semantic, ...structural, ...existence]) {
    const { mutants, loc } = await mutantsFor(ROOT, c);
    if (!mutants.length) {
      if (c.class === 'existence') skipReasons.no_anchor++;
      else if (loc || c.kind === 'call-exists') skipReasons.no_mutant++;
      else skipReasons.no_symbol++;
    }
    candidates.push({ ...c, mutants, mutation_kinds: mutKindsOf(mutants) });
  }

  // ★ ② 纯选择：去重（与顺序无关）→ 码元序排序 → only → 剔除无突变体 → 账内豁免 → 取前 N
  // ★ T-#SOFT-KIND-RATCHET：存在类保底配额（缺省 1；`existence:false/0` 可关，用于消融）。
  //   ★ 接在 T-#MUTATE-DET 的 selectSamples 新结构上：**不碰 selector 内部**，只是第三次 pick()。
  //   ★ 不挤占 semantic/structural 的既有额度（N=5 语义 + N_STRUCT 结构照旧）——
  //     T-#MUTATE-DET 的 p1_determinism ⑤ 钉死 `semSamples.length === N`（账才真的顶掉样本位）。
  //     软判据是**加一层覆盖**，不是从强判据手里抢名额（那会让弱判据的引入反而降低门的鉴别力）。
  const QUOTA_EX = opts.existence === false ? 0
    : Number(opts.existence ?? Math.max(1, Math.min(N, 1)));
  if (opts.only) {
    const [of, os] = String(opts.only).split('#');
    const hit = candidates.some((c) => c.file === of && String(c.symbol ?? '') === os);
    if (!hit) throw new Error(`--only=${opts.only} 没有匹配任何判据（文件+符号要逐一相等）`);
  }
  const pick = (cls, n) =>
    selectSamples(
      candidates.filter((c) => c.class === cls),
      { n, only: opts.only, baseline: baseline.byId },
    );
  const semSel = pick('semantic', N); // ★ 保持 N（不因存在类配额缩水，兼容 p1_determinism ⑤）
  const stSel = pick('structural', N_STRUCT);
  const exSel = pick('existence', opts.only ? Number.POSITIVE_INFINITY : QUOTA_EX);

  const semSamples = semSel.samples;
  const stSamples = stSel.samples;
  const exSamples = exSel.samples;
  const effectiveEx = exSamples.filter((c) => c.mutants?.length).length;
  const quota = {
    enabled: QUOTA_EX > 0,
    requested: QUOTA_EX,
    pool: existence.length,
    sampled: exSamples.length,
    effective: effectiveEx,
    // ★ `--only` 是显式过滤（T-#MUTATE-DET），配额不生效 ⇒ 不报降级；
    //   否则以**有效突变体数**为准：抽到但无锚点（no_anchor）也是降级，不许冒充覆盖。
    degraded: !opts.only && QUOTA_EX > 0 && effectiveEx === 0,
    no_anchor: skipReasons.no_anchor,
  };
  skipReasons.not_selected = semSel.notSelected + stSel.notSelected + exSel.notSelected;
  skipReasons.baselined_survivor = semSel.baselined.length + stSel.baselined.length + exSel.baselined.length;

  // 计划：`before` / `after` 都是**源码全文**，判据对象原样不动。
  // ★ 分桶轮转决定**执行次序**（semantic → existence → wiring，空桶跳过）；成员与账 id 完全不变。
  const ordered = rotateByStrength({ semantic: semSamples, existence: exSamples, wiring: stSamples });
  const plans = [];
  for (const c of ordered) {
    plans.push({ ...base(c), expectation: c.expectation, node_label: c.node_label, mutants: c.mutants, reason: null });
  }

  // ★ ③ 账的复核（stale）：账里写着、而本册候选里**找不到**的 id ⇒ 点名（账不许变成永久免死牌；删也要人）
  const inScope = new Set(features);
  const liveIds = new Set(candidates.map((c) => survivorIdOf(c)));
  const stale = baseline.rows
    .filter((r) => inScope.has(String(r.id).split('|')[0]) && !liveIds.has(String(r.id)))
    .map((r) => r.id);

  return {
    expectations: all.length,
    semantic,
    structural,
    existence,
    semSamples,
    stSamples,
    exSamples,
    quota, // ★ T-#SOFT-KIND-RATCHET（含 degraded / effective / no_anchor 读数）
    skipReasons,
    plans,
    /** ★ 账内豁免（每条带 why）：每跑都点名，不做"扣掉不说" */
    baselined: [...semSel.baselined, ...stSel.baselined].map((b) => ({
      id: b.id,
      why: b.why,
      debt: b.debt ?? null,
      review_by: b.review_by ?? null,
      file: b.candidate.file,
      symbol: b.candidate.symbol ?? null,
      slot: b.slot,
    })),
    /** 本次参与计划的册里，账内一共几行（> baselined.length 的部分 = 本次没轮到，不影响样本） */
    baseline_rows: baseline.rows.filter((r) => inScope.has(String(r.id).split('|')[0])).length,
    /** ★ 账里对不上现役判据的 id（人清或改账；脚本不自动删） */
    stale_baseline: stale,
    // ★ 报告里只放**相对**路径：绝对路径会让同一输入在不同机器上产出不同报告（可复现性的一部分）
    baseline_path: SURVIVORS_BASELINE,
    baseline_note: baseline.note ?? null,
  };
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
  // ★★★ 2026-11-02（subagent:plan-semantics）：**锁必须先于任何源码读取**（判据突变门假红的根因）。
  //
  // ## 病（实测两次）
  // 旧顺序 = 先 `planMutants`（读 src、算出每条的 before/after）**再** `acquireLock` ⇒ 计划窗口不在锁里。
  // 另一次 mutate 的「写变异 → 判据 → 还原」窗口正好落在里面时，`p.before` 拿到的是**别人变异中的临时内容**；
  // 等本进程执行到那条时，比对当前内容不符 ⇒ 抛「在判据期间被别处改过」。**同一次重跑就 PASS**（不重叠了）。
  // ⇒ 这就是"假红训练人重跑、重跑把真红也一起跑掉"的那条链。
  //
  // ## 判据（不是"重试一次"）
  // **读输入与写变异必须同处一把锁**：取锁之后的任何读取都不会看见别人的变异窗口 ⇒ 那个窗口不存在，
  // 也就不需要重试。★ 重试只会把假红藏起来，不会消掉竞态。
  const unlock = acquireLock(ROOT);
  installHooks();
  try {
    return await runMutateLocked(ROOT, features, distEntry, opts);
  } finally {
    restoreAll('finally');
    unlock();
  }
}

/** `runMutate` 的**锁内部分**（拆出来只为让「取锁」早于「读输入」；判据在 `runMutate` 头注） */
async function runMutateLocked(ROOT, features, distEntry, opts) {
  const plan = await planMutants(ROOT, features, opts);
  const je = await import(pathToFileURL(distEntry).href);

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
      // ★ 2026-11-02：这条**不再是"另一次 mutate 的重叠"**（本进程先取锁再读输入，重叠的那个在取锁时就被拒）。
      //   能走到这里只剩一种解释：**有人在测量窗口里改了源码**（编辑器 / 另一个 agent 的 write）。
      //   ⇒ 文案要指出两边的 sha256（可复核，不猜），处置是"先查它在改什么"，**不是"重跑一次"**。
      throw new Error(
        `★ ${plan_.file} 的当前内容不是本进程计划时读到的那一版 ⇒ 停机，读数无效。\n` +
          `  · 计划时 sha256 = ${sha(Buffer.from(p.before, 'utf8'))}\n` +
          `  · 当前   sha256 = ${rec.sha}\n` +
          `★ 为什么停：变异是破坏性的，源一动，"改前 / 改后"就不再是同一条对照。\n` +
          `★ 为什么这不可能是"另一个 mutate"：本进程**先取锁再读输入**（\`.agent-io/mutate.lock\`），\n` +
          `  重叠的 mutate 在取锁那一刻就被拒了 ⇒ 只剩"有人在测量窗口里改源码"这一种解释。\n` +
          `★ 怎么办：先看它改了什么（\`git diff -- ${plan_.file}\`），确认后再重跑；**别把这条当成偶发**。`,
      );
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
    // ★ 锁不在本函数里释放：它由 `runMutate` 的 finally 统一释放（本函数整段跑在锁内）。
    //   在这里再 `unlock()` 一次只是重复（unlink 已幂等），但会让"谁拥有锁"变得含混。
    restoreAll('finally');
  }

  const tally = (cls, v) => items.filter((i) => i.class === cls && i.verdict === v).length;
  // ★ T-#MUTATE-DET：本次**新**发现的存活体 —— 只点名，**绝不自动入账**
  //   （自动入账 = 把"新问题"当天抹平；挂账是人的判断，脚本的职责是把它摆到人眼前）
  const baselineCandidates = items
    .filter((i) => i.verdict === 'survived')
    .map((i) => ({
      id: survivorIdOf(i),
      file: i.file,
      symbol: i.symbol ?? null,
      kind: i.kind,
      why_hint: `${(i.attempts ?? []).length} 个突变算子类全部 pass（判据对这一格无感）`,
    }));
  const report = {
    mode: 'code',
    features,
    /** 判据总数（分母：本脚本只验样本，没验它们 ⇒ 两个数一起给，0.12） */
    expectations: plan.expectations,
    /** 语义样本候选（behavior-cases ∩ src） */
    candidates: plan.semantic.length,
    structural_candidates: plan.structural.length,
    existence_candidates: plan.existence.length, // ★ T-#SOFT-KIND-RATCHET
    sampled: plan.plans.length,
    semantic_sampled: plan.semSamples.length,
    structural_sampled: plan.stSamples.length,
    existence_sampled: plan.exSamples.length,
    /** ★ 配额读数：池空 / 无锚点 ⇒ degraded=true，带分母（0.12），不冒充覆盖 */
    quota: plan.quota,
    killed: tally('semantic', 'killed'),
    survived: tally('semantic', 'survived'),
    unsupported: tally('semantic', 'unsupported'),
    structural_killed: tally('structural', 'killed'),
    structural_survived: tally('structural', 'survived'),
    structural_unsupported: tally('structural', 'unsupported'),
    // ★ 存在类四态：只进报告 / design:check D 段读数，**不进 report.ok**（不建免疫系统门裁定）
    existence_killed: tally('existence', 'killed'),
    existence_survived: tally('existence', 'survived'),
    existence_unsupported: tally('existence', 'unsupported'),
    skipped: Object.values(plan.skipReasons).reduce((a, b) => a + b, 0),
    skipped_reasons: plan.skipReasons,
    attempts,
    restored_files: [...new Set(restored)],
    /** ★ 账内豁免 N 条（明细带 why）：豁免**不隐藏** —— 少了这一组字段，"D7 变绿"就没人知道是因为什么 */
    baselined_count: plan.baselined.length,
    baseline_rows: plan.baseline_rows,
    baselined: plan.baselined,
    stale_baseline: plan.stale_baseline,
    baseline_path: plan.baseline_path,
    /** `--only` 时豁免被绕过（人点名的格必须真量） */
    baseline_bypassed: Boolean(opts.only),
    /** ★ 新存活体：报告点名，入账由人确认（不静默吞，也不自动写账） */
    baseline_candidates: baselineCandidates,
    items,
  };
  // ★ `killed === 0`（没有样本被判定）**不是绿**：那是"没验"（0.12）
  // ★ 注意 `survived` 的口径已变（T-#MUTATE-DET）：它**不含**账内豁免疫的那些 ——
  //   新存活体仍然 ⇒ 红 + 点名。D7/D9 的判据因此从"恒红"变成"有信息"。
  report.ok = report.survived === 0 && report.unsupported === 0 && report.killed > 0;
  return report;
}

/** 报告里不带判据原文与代码全文（CLI 不打印它们，JSON 也够小） */
function strip(pl) {
  const { expectation: _e, node_label: _l, mutants, ...rest } = pl;
  return { ...rest, mutant_count: mutants.length };
}

function base(c) {
  const e = c.expectation;
  return {
    feature: c.feature,
    node_id: c.node_id,
    kind: e.kind,
    class: c.class, // 'semantic' | 'structural' | 'existence'（候选自己带，不再靠调用点传）
    strength_bucket: strengthBucketOf(c), // ★ 排序/读数用；不进判据对象
    file: c.file,
    symbol: e.symbol ?? null,
    target: e.target ?? null,
  };
}

// ── 存在类方向棘轮（★ 不进 verify GATES；只进 mutate 报告 + design:check D 段读数） ──
/** 基线文件相对路径（形态仿 judge-baseline：只拦掉不拦涨） */
export const EXISTENCE_BASELINE_REL = 'scripts/mutate-existence-baseline.json';

/** 缺文件 ⇒ null（如实报"无基线"，不折成 0）；解析失败 ⇒ 抛（不许把坏账当空账） */
export function readExistenceBaseline(root) {
  const file = path.join(path.resolve(root), EXISTENCE_BASELINE_REL);
  if (!fs.existsSync(file)) return null;
  let b;
  try { b = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`★ ${EXISTENCE_BASELINE_REL} 解析失败（${e.message}）—— 不许当空基线（那会把退化读成正常）`); }
  if (typeof b?.existence_killed !== 'number') {
    throw new Error(`★ ${EXISTENCE_BASELINE_REL} 缺数值 existence_killed —— 拒绝把"读不懂"当"没有基线"`);
  }
  return b;
}

/** 纯比较：涨/平不拦，只拦掉。 */
export function compareExistenceRatchet(baseline, currentKilled) {
  if (!baseline) return { ok: true, regressed: false, baselineKilled: null, currentKilled, note: '无基线（本次只读数，不判退化）' };
  const b = baseline.existence_killed;
  return {
    ok: currentKilled >= b,
    regressed: currentKilled < b,
    baselineKilled: b,
    currentKilled,
    note: currentKilled < b ? `存在类 killed 掉档 ${b} → ${currentKilled}（只拦掉不拦涨）`
      : currentKilled > b ? `存在类 killed 涨档 ${b} → ${currentKilled}（不拦涨）`
      : `存在类 killed 持平 ${b}`,
  };
}

/** 显式写基线（--write-baseline；评审里现形，不自动写） */
export function writeExistenceBaseline(root, report) {
  const file = path.join(path.resolve(root), EXISTENCE_BASELINE_REL);
  const body = {
    '//': '存在类判据 killed 数方向棘轮（只拦掉不拦涨）。由 design:mutate --write-baseline 更新；不进 verify GATES。',
    existence_killed: report.existence_killed ?? 0,
    by_kind: (report.items ?? []).filter((i) => i.class === 'existence')
      .reduce((m, i) => { m[i.kind] = (m[i.kind] ?? 0) + (i.verdict === 'killed' ? 1 : 0); return m; }, {}),
    capturedAt: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return body;
}

// ── CLI ──────────────────────────────────────────────────────────────
// ★ 2026-11-16（恢复事故）：入口判定走**物理路径归一**（旧的 `pathToFileURL(argv[1]).href === import.meta.url`
//   在软链下恒 false ⇒ CLI 分支静默不执行 ⇒ exit 0 假绿）。唯一实现见 scripts/lib/path_identity.mjs
const isCli = (() => {
  try {
    return Boolean(process.argv[1]) && samePath(process.argv[1], import.meta.url);
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
  const WRITE_BASELINE = args.includes('--write-baseline');
  const EX_OPT = args.includes('--no-existence') ? false : val('existence') !== null ? Number(val('existence')) : undefined;
  const rep = await runMutate(FEATURES, ROOT, {
    n: N,
    structural: args.includes('--no-structural') ? false : 1,
    existence: EX_OPT,
    only: val('only') ?? undefined,
  });
  // ★ 方向棘轮读数（不进退出码 —— verify.mjs:297-306 不建免疫系统门裁定）
  const exBaseline = readExistenceBaseline(ROOT);
  if (WRITE_BASELINE) writeExistenceBaseline(ROOT, rep);
  const exRatchet = compareExistenceRatchet(exBaseline, rep.existence_killed);
  const repOut = { ...rep, existence_ratchet: exRatchet };

  if (JSON_OUT) {
    console.log(JSON.stringify(repOut, null, 2));
  } else {
    console.log(`══ mutate（**代码突变**；判据对象不动）· ${rep.features.join(', ')} ══`);
    console.log(`  册内判据 ${rep.expectations} 条 · 语义候选 ${rep.candidates} 条（behavior-cases∩src）· 本次样本 ${rep.sampled}`);
    console.log(`  ★ 存在类配额：池 ${rep.existence_candidates} · 请求 ${rep.quota.requested} · 实抽 ${rep.quota.sampled} · 有效 ${rep.quota.effective}${rep.quota.degraded ? `  ★ 降级（池空或无锚点 ${rep.quota.no_anchor}，如实报）` : ''}`);
    console.log(`  ✓ killed（判据 fail ⇒ 这处代码上判据是活的）：${rep.killed}`);
    console.log(`  ★ survived（判据仍 pass ⇒ 对逻辑错无感）：${rep.survived}`);
    console.log(`  ? unsupported（判不了 ≠ 抓到）：${rep.unsupported}`);
    console.log(`  … skipped：${rep.skipped}（${Object.entries(rep.skipped_reasons).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')}）`);
    // ★ T-#MUTATE-DET：账内豁免/待挂账**每次都点名**（豁免不许静默；新存活体不许自动入账）
    console.log(
      `  ⚖ 基线豁免（已知存活体 · ${rep.baseline_path}）：${rep.baselined_count} 条（账内 ${rep.baseline_rows} 条）${rep.baseline_bypassed ? '（本次 --only ⇒ 豁免已绕过）' : ''}`,
    );
    for (const b of rep.baselined) {
      console.log(`      · ${b.id}`);
      console.log(`        ↳ ${String(b.why).split('\n')[0].slice(0, 200)}`);
    }
    if (rep.stale_baseline?.length) {
      console.log(`  ⚠ 账里 ${rep.stale_baseline.length} 条对不上现役判据（stale，需人清/改账，脚本不自动删）：`);
      for (const id of rep.stale_baseline) console.log(`      · ${id}`);
    }
    if (rep.baseline_candidates?.length) {
      console.log(`  ★ 新发现存活体 ${rep.baseline_candidates.length} 条（**没有**自动挂账 —— 由人确认后加行）：`);
      for (const b of rep.baseline_candidates) console.log(`      · ${b.id}（${b.why_hint}）`);
    }
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
    if (rep.existence_sampled || rep.quota.degraded) {
      console.log('');
      console.log(
        `  ── 存在类配额对照（T-#SOFT-KIND-RATCHET）：killed ${rep.existence_killed} · survived ${rep.existence_survived}` +
          ` · unsupported ${rep.existence_unsupported}（候选池 ${rep.existence_candidates}）`,
      );
      console.log(`  ── 方向棘轮（只拦掉不拦涨 · 不进 verify GATES）：${exRatchet.note}`);
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
