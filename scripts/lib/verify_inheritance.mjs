/**
 * verify-inheritance.mjs —— verify 门级继承（T-#INC-VERIFY · 只读门缓存上次 verdict）
 *
 * ★ 它不是"免疫系统门"（`scripts/verify.mjs` 关于不建体检/巡航门的裁定）：
 *   本模块**不新增门、不改变任何门的判定**，只把「上次真跑过的只读门 verdict + 输入指纹」
 *   存成 content-addressed 缓存（与 `judge_cache.ts` 同形）。输入没变 ⇒ 复用 verdict，
 *   **并显式打印「继承」+ 分母**；指纹取不到 / 损坏 / 版本不符 ⇒ 一律 `miss`（回落实跑），
 *   绝不静默继承、也绝不把"没跑"读成绿。
 *
 * ## 继承范围（lead 裁定）
 * 只读门 = `go build` / `go vet` / `lint:prose` / `manifest:check`（后两个是「文档与事实」聚合门的子检查）。
 * 写面门（`ts 类型` / `设计册判据` / `判据突变` / `测试` / `无卡写账` / 其余）**永不继承**，恒串行全量。
 *
 * ## 输入指纹（fail-closed）
 *   指纹 = sha256( 实现版本标记 ‖ 门名/cmd/cwd ‖ 每个输入文件的 路径 + 字节长度 + 内容 sha1 )。
 *   输入 = 门的 `args` 指向的脚本 + 门声明的 `inputs`（额外输入文件 / 目录）。
 *   `manifest:check` 的输入 = 整个 `.agent-io` 顶层 + gen_manifest 脚本 + 卷表源 ⇒ 任一顶层条目增删都换指纹。
 *   读不到任何输入文件 ⇒ 指纹 `null` ⇒ miss（实跑）。
 *
 * ## 落盘
 * `<root>/.agent-io/scratch/verify-inheritance.json`（derived：`.gitignore` 的 `.agent-io/*` 覆盖，不进 git、不进棘轮）。
 * 结构 = `{version, entries:{<门名>:{fingerprint, verdict, state, ran_at, cases, note}}}`。
 * 键即"内容寻址"（指纹含 verdict 当时的输入内容）；损坏/版本不符 ⇒ 当空缓存 + 留痕（不静默吞）。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, readdirSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const STORE_REL = '.agent-io/scratch/verify-inheritance.json';
export const STORE_VERSION = 1;

/**
 * 继承白名单（只读门）—— 名字与 `GATES` / 子检查逐字相同。
 * H2（无法证明闭包就实跑）：仅读面可静态枚举证明闭包的门保留继承；
 * `manifest:check` 对账面 `.agent-io/` 顶层，递归含派生 db / scratch / 台账等跨机不一致且不可
 * 静态枚举闭包的部分 ⇒ 移出白名单，恒串行全量实跑（不继承未证闭包的读数）。
 */
export const INHERITABLE = Object.freeze(['Go 编译', 'Go 静态检查', 'lint:prose', 'doc:check']);

/** 默认额外输入（可覆盖；门的 args[0] 脚本自动进指纹） */
export const DEFAULT_INPUTS = Object.freeze({
  'Go 编译': ['observe-lang-go'], // go build ./... = 递归整棵包树
  'Go 静态检查': ['observe-lang-go'],
  // lint:prose 实扫面：docs/*.md（顶层）+ scripts/*.mjs（顶层）+ .agent-io/design 册；
  // 目录递归为超集（子目录变也触发重跑），fail-closed 方向，不漏钉。
  'lint:prose': ['docs', 'scripts', '.agent-io/design'],
  // manifest:check 已移出白名单；输入声明保留仅作诊断参照，不进继承键。
  'manifest:check': ['.agent-io'],
  'doc:check': ['docs', 'src/application/docs_view'],
});

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');

function hashOf(buf) {
  return createHash('sha1').update(buf).digest('hex');
}

/**
 * 工具链身份（H2：执行与指纹共用同一调用定义，钉工具链身份）。
 * · node 运行时版本恒钉；Go 两门额外钉 `go version` 输出。
 * · 身份取不到（工具链缺失 / spawn 失败）⇒ 返回 null（指纹不可算 ⇒ fail-closed 实跑），不拿"读不到"冒充"没变"。
 */
function toolchainIdentity(root, gate) {
  const parts = [`node:${process.version}`];
  if (/^Go /.test(gate.name)) {
    const r = spawnSync('go', ['version'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.error || r.status !== 0) return null;
    parts.push(`go:${String(r.stdout ?? '').trim()}`);
  }
  return parts.join('\u0000');
}

// ─────────────────────────────────────────────────────────────
// S-4 键面闭包化：门脚本的**本地相对依赖**纳入指纹（传递闭包）。
// 裸模块（node: 内置 / 已安装包）按 L7 归「工具链/环境 → 升级全量触发面」，不进缓存键；
// 本地相对依赖算不出（读不到 / 解析不到真实文件）⇒ 该门指纹 null（fail-closed 实跑），不进跳过集。
// ─────────────────────────────────────────────────────────────

/** 从源码提取相对 import/require 说明符（'./x' / '../x'）；node: 内置与裸包忽略。 */
function localSpecifiersOf(src) {
  const specs = new Set();
  const re = /import\(\s*['"]([^'"]+)['"]\)|import\s[^'"]*from\s*['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!spec) continue;
    if (spec.startsWith('./') || spec.startsWith('../')) specs.add(spec);
  }
  return [...specs];
}

/** 候选真实文件：补 .mjs/.js/.ts 扩展名或目录 index。返回存在的 rel，否则 null。 */
function resolveLocalRel(root, fromRel, spec) {
  const base = norm(path.join(path.dirname(fromRel), spec));
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}/index.mjs`, `${base}/index.js`, `${base}/index.ts`];
  for (const cand of candidates) {
    if (existsSync(path.join(root, cand))) return cand;
  }
  return null;
}

/**
 * 递归收集脚本的本地相对依赖闭包。`out` 累积 rel 清单；`visited` 防环。
 * 任一依赖读不到 ⇒ 返回 false（调用方判指纹不可算，fail-closed）。
 */
function collectLocalDeps(root, scriptRel, visited, out) {
  if (visited.has(scriptRel)) return true;
  visited.add(scriptRel);
  let src;
  try {
    src = readFileSync(path.join(root, scriptRel), 'utf8');
  } catch {
    return false;
  }
  for (const spec of localSpecifiersOf(src)) {
    const dep = resolveLocalRel(root, scriptRel, spec);
    if (!dep) return false; // 本地相对依赖解析不到 ⇒ 闭包不可静态算清 ⇒ fail-closed
    if (!out.includes(dep)) out.push(dep);
    if (!collectLocalDeps(root, dep, visited, out)) return false;
  }
  return true;
}

/** 展开输入：目录 ⇒ 递归取所有文件（跳过 .git/node_modules；这两者不是任何门的判定输入） */
function expandInput(root, rel, out) {
  const abs = path.join(root, rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return false; // 输入不存在 ⇒ 调用方判 miss（不拿"没有"冒充"没变"）
  }
  if (st.isDirectory()) {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      if (!expandInput(root, `${rel}/${ent.name}`, out)) return false;
    }
    return true;
  }
  try {
    const buf = readFileSync(abs);
    out.push({ path: norm(rel), size: buf.length, sha1: hashOf(buf) });
    return true;
  } catch {
    return false;
  }
}

/**
 * 门的输入指纹；任何一个声明的输入读不到 ⇒ `null`（miss）。
 * `gate` = verify.mjs#GATES 里定型后的一道门（{name, cmd, args, cwd, ...}）。
 * `extraInputs` 允许按门名覆盖（测试注入 / 派生目录输入）。
 */
export function inputFingerprint(root, gate, extraInputs = DEFAULT_INPUTS) {
  if (!gate || !INHERITABLE.includes(gate.name)) return null;
  const rels = [];
  const scripts = [];
  for (const a of gate.args ?? []) {
    if (typeof a === 'string' && /^scripts\//.test(a)) scripts.push(norm(a));
  }
  for (const s of scripts) {
    if (!rels.includes(s)) rels.push(s);
    // S-4 键面闭包：脚本本地相对依赖递归纳入；闭包算不清 ⇒ 指纹 null（fail-closed 实跑）。
    if (!collectLocalDeps(root, s, new Set(), rels)) return null;
  }
  if (/^Go /.test(gate.name)) rels.push('go.mod', 'go.sum'); // 相对 cwd 的 go 输入（cwd 也在指纹里）
  for (const r of extraInputs[gate.name] ?? []) if (!rels.includes(norm(r))) rels.push(norm(r));

  const parts = [];
  for (const rel of [...new Set(rels)].sort()) {
    if (!expandInput(root, rel, parts)) return null;
  }
  if (parts.length === 0) return null; // 没有任何可钉的输入 ⇒ 不许继承（静态路径不自证新鲜）
  const tc = toolchainIdentity(root, gate);
  if (!tc) return null; // 工具链身份取不到 ⇒ 闭包不可证 ⇒ fail-closed 实跑
  const shell = gate.shell ?? process.platform === 'win32';
  const h = createHash('sha256');
  h.update(`v${STORE_VERSION}\u0000`);
  // H2：执行与指纹共用同一调用定义 —— 钉完整 argv / shell / 工具链身份，不只 cmd/cwd。
  h.update(`${gate.name}\u0000${gate.cmd ?? ''}\u0000${gate.cwd ?? ''}\u0000`);
  h.update(`shell:${shell}\u0000argv:${JSON.stringify(gate.args ?? [])}\u0000`);
  h.update(`toolchain:${tc}\u0000`);
  for (const p of parts) h.update(`${p.path}\u0000${p.size}\u0000${p.sha1}\u0000`);
  return h.digest('hex');
}

/** 读缓存。损坏 / 版本不符 ⇒ `{ok:false, reason}`（调用方如实打印，不静默吞） */
export function loadStore(root) {
  const abs = path.join(root, STORE_REL);
  if (!existsSync(abs)) return { ok: false, reason: '文件不存在（冷启动）', entries: {} };
  try {
    const j = JSON.parse(readFileSync(abs, 'utf8'));
    if (j?.version !== STORE_VERSION || !j.entries || typeof j.entries !== 'object') {
      return { ok: false, reason: `版本不符或损坏（version=${String(j?.version)}）`, entries: {} };
    }
    return { ok: true, reason: '', entries: j.entries };
  } catch (e) {
    return { ok: false, reason: `解析失败：${String(e?.message ?? e).slice(0, 80)}`, entries: {} };
  }
}

/**
 * 判一道门能否继承。恒返回 `{name, decision:'inherit'|'run', reason, fingerprint, prior}`。
 * · 只读门 + 指纹算得出 + 缓存同指纹 + verdict=PASS/SKIP ⇒ inherit（带上次分母）
 * · 写面门 / 指纹不可算 / 缓存缺坏 / 指纹不同 / 上次 FAIL ⇒ run（fail-closed）
 */
export function planGate(root, gate, store, extraInputs = DEFAULT_INPUTS) {
  const base = { name: gate.name, decision: 'run', reason: '', fingerprint: null, prior: null };
  if (!INHERITABLE.includes(gate.name)) return { ...base, reason: '非只读门白名单：恒串行全量' };
  const fp = inputFingerprint(root, gate, extraInputs);
  base.fingerprint = fp;
  if (!fp) return { ...base, reason: '输入指纹算不出（缺输入）⇒ 实跑' };
  if (!store.ok) return { ...base, reason: `缓存不可用（${store.reason}）⇒ 实跑` };
  const e = store.entries?.[gate.name];
  if (!e || e.fingerprint !== fp) return { ...base, reason: e ? '输入指纹变了 ⇒ 实跑' : '无上次 verdict ⇒ 实跑' };
  if (e.verdict !== 'PASS' && e.verdict !== 'SKIP') return { ...base, reason: `上次 verdict=${e.verdict}（非 PASS/SKIP）⇒ 实跑` };
  return { ...base, decision: 'inherit', reason: `输入未变 + 上次 ${e.verdict}`, prior: e };
}

/** 写回一道**真跑过**的只读门 verdict（继承条目原样保留，证据时点不刷新）。
 *  S-4：写回前重读最新落盘合并（并发双写不丢其他门条目）；tmp + rename 原子替换（不写半截条目）。 */
export function recordGate(root, gate, store, result, extraInputs = DEFAULT_INPUTS) {
  if (!INHERITABLE.includes(gate.name)) return store;
  const fp = inputFingerprint(root, gate, extraInputs);
  if (!fp) return store; // 指纹不可算 ⇒ 不写（不许把"没钉住输入"的结果固化）
  const latest = loadStore(root);
  const entries = { ...(latest.entries ?? store.entries ?? {}) };
  entries[gate.name] = {
    fingerprint: fp,
    verdict: result.verdict, // 'PASS' | 'FAIL' | 'SKIP'
    state: result.state ?? '',
    ran_at: new Date().toISOString(),
    cases: result.cases ?? null,
    note: result.note ?? '',
  };
  const next = { version: STORE_VERSION, entries };
  const abs = path.join(root, STORE_REL);
  try {
    mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tmp, abs);
    return { ok: true, reason: '', entries };
  } catch (e) {
    return { ok: false, reason: `写入失败：${String(e?.message ?? e).slice(0, 80)}`, entries };
  }
}

/** 清掉（测试夹具 / 诊断用；正常路径不调用） */
export function clearStore(root) {
  try { rmSync(path.join(root, STORE_REL), { force: true }); } catch { /* 清不掉不致命 */ }
}
