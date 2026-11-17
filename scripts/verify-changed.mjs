#!/usr/bin/env node
/**
 * ★★★ verify-changed.mjs —— **增量验证入口**（2026-10-17 · `task_plan.incremental_verify` / `preflight-checklist.md` B.5）
 *
 * 与 `npm run verify`（全量门）**并列**，不是替代它：全量那条仍在（收口 / 日终 / 改 schema 或判据框架本身时跑）。
 * ★ 第三条腿（`certs/` 那套 108 张证）已于 2026-10-31 整目录退役 ⇒ 行为断言现在**只住 `tests/*.test.ts`**
 *   （「测试」门每轮全跑；本入口按 `touches:` 挑**受影响的**那几支）。
 *
 * 用户原话（`docs/task-system-plan.dsl.json#task_plan.incremental_verify.why` 逐字）：
 *   *"我们的闸应该不用全量运行吧，改了哪里运行哪里应该就可以了。而且我们不是直接有契约的吗？
 *    只有契约，局部契约对上应该就可以了"*
 *
 * ## 三步（★ 次序就是设计里的次序，别调换）
 *   ① **拿改动文件**：`git diff --name-only`（★ 外加**未跟踪**文件 —— 新增的证/脚本在 `git diff` 里
 *      **根本不出现**，若只认 `git diff` 则"这笔新增的入口"永远验不到自己）；也可命令行直接传文件；
 *   ② ★★ **契约优先（便宜）**：读 `docs/task-system-plan.dsl.json` 的
 *      `geometry.nodes[].decision.expectations[]`，**`path` 命中改动文件**的 ⇒ 列出并**就地判**（复用
 *      `judgeExpectations`，★ 不新造第二把尺）；
 *   ③ ★ **测试其次**：扫 `tests/*.test.ts` 头注里的 **`touches:` 声明**，命中改动文件的测试才跑
 *      （★ 不跑全量：全量是 `npm run verify` 的「测试」门；本入口是内环）。
 *
 * ## ★★★ 2026-10-23（增量测试 · 选量）：第②步命中之后，**已有证据仍作数的就不重判**
 * 真正回答“这条还作数吗”的只有一把尺：`evidenceFreshness`（`src/domain/task_schema.ts`）——
 * 它判 `valid` / `stale` / `unverifiable`。本脚本不自己比指纹，只调 `planEvidenceRerun`
 * （`src/application/design/dsl_ops/task_ops.ts`）把它变成 `skip` / `rerun` / `unknown`，然后**不判** skip 那些。
 * ★ 为什么不是“第二套选量”：第②步的路径口径仍是 `expectationPaths` 一把；这一层只回答
 * “命中了、但**还没失效**的能不能省”—— 覆盖集也只有一处（证据里落的 `covers`）。
 * ★★ `unverifiable` **进 `rerun`**（不许当有效）；正在被领的卡（`claimed` / `preparing`）**不复用**。
 * ★ 逃生门 `--no-reuse`：一条都不复用（= 旧行为）。怀疑“它藏了红”就拿它复核一遍。
 *
 * ## 判据 / 退出码
 *   · 有红（★ 测试跑红/跑不起来 / 契约 expectation fail）⇒ **1**；
 *   · 全绿 ⇒ **0**；
 *   · ★★★ **git 读不到改动集 ⇒ 1**（AGENTS-RULES 0.12：失败必须与「没有」可区分）。
 *     ★ 改前 `gitList` 是 `catch { return [] }` ⇒ `changed=[]` ⇒ `nothingHit` ⇒ `red=false` ⇒ **exit 0**
 *     —— "增量门什么都没验"以**通过**退出（那行"这不是绿"的文案没人读，CI 只看退出码）。
 *     ⇒ 现在 git 失败**单独**拉起 `red`，且**不借道** `nothingHit`（那条的语义是"验了但没命中"）。
 *     显式点名文件（`node scripts/verify-changed.mjs <文件…>`）不经 git ⇒ 不受影响。
 *   · ★★ **命中 0 条 ≠ 绿**：那是"**没验**"。本脚本把它**打在结论那一行**（★ 这里不擅自 exit 2：
 *     用户定的退出码只有"红 ⇒ 1 / 绿 ⇒ 0"；但读数必须让人一眼看出"这次什么都没验"）。
 *   · ★ 读数**必带分母**：`改动集 K 个文件 · 覆盖 C · 未覆盖 U · 验了 N 项（测试 / 期望）· 跳过 M 项`（0.12 ③）。
 *   · ★★★ **"未被覆盖" ≠ "没影响"**（2026-10-31）：改动集里**一条都没命中**的文件会被读成"这次没影响"，
 *     而真相常是"**没有任何判据/测试观察它**"。⇒ 本脚本单列一节「未覆盖文件」（`--json` 为 `uncovered[]`，
 *     分母里 `covered` / `uncovered` 且 **C+U=K**），并给一行总述。
 *     ★ **U>0 不判红**：覆盖面是**存量状况**，判红会让内环天天红（内环被存量淹没已发生过）——
 *       它是**报告**，显眼且**可被测试断言**（`tests/p0_incremental_verify.test.ts`）。
 *     ★ `uncovered:null` = **没算**（git 读不到改动集）—— 与 `[]`（算了、一个都没有）必须能分开读。
 *
 * ## `touches` 的写法（★ 一行即可；**唯一住处是 `tests/*.test.ts` 的头注**）
 * ```
 * // touches: src/application/write_gate.ts, src/domain/task_machine.ts
 * ```
 * ★ 比对是**整路径精确相等**（不是子串）：`src/a.ts.bak` **不**命中 `src/a.ts` 的契约/touches
 *   —— 子串匹配会让"备份文件/同前缀文件"把不相关的测试全拉起来。
 * ★ **没写 `touches` 不等于没验**：那支测试仍由「测试」门全跑；内环只是**无法把它归因到你的改动**
 *   ⇒ 它会进「未声明」清单（带分母），并让被改的文件落进「未覆盖」。
 *
 * ## 用法
 * ```
 * node scripts/verify-changed.mjs                 # 按 git（含未跟踪）算改动
 * node scripts/verify-changed.mjs src/a.ts b.ts   # 显式点名
 * node scripts/verify-changed.mjs --no-run        # ★ 只算集合、不跑（给 `tests/p0_incremental_verify.test.ts` 断言用；也免得自调用递归）
 * node scripts/verify-changed.mjs --json --no-run src/a.ts
 * ```
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **`touches` 覆盖率**：`tests/` 里**只有少数文件**写了 `touches:` 声明 ⇒ 其余文件的覆盖只能靠契约
 *     `path`；两条路都不命中的进「未覆盖文件」（不再静默当"没影响"）。**不设派生索引**（`certs/.touches.json`
 *     那种第二处真相已随 `certs/` 一起退役：派生值一旦与声明分叉，"改哪跑哪"就没人能验证）；
 *   · **契约的 `path` 覆盖率**：判据退役后 `path` 载体变窄，`src/` 多数文件两条路都不命中
 *     ⇒ 这就是「未覆盖文件」那一节存在的实测理由（2026-10-31 读数）；
 *   · **`edge-*` 期望的命中**：按"主体 + 对端"两端算（`expectationPaths`），但**只**在这两端出现在改动里时命中；
 *   · **判定器要 dist**：契约的"判"复用 `dist/.../judgeExpectations` ⇒ 未 `npm run build` 时**只列不判**（会明说）；
 *   · **不写盘 / 不写真仓 home**：本脚本只读 `tests/`、`.agent-io/design/`、`git`；跑测试经
 *     `scripts/run-tests.mjs`（它自己给**每文件一个临时数据根**，真数据仓不碰）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTestFiles } from './lib/test_files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = (process.env.AGENT_IO_VERIFY_CHANGED_ROOT || path.resolve(HERE, '..')).replace(/\\/g, '/');
// ★ 测试缝：`AGENT_IO_VERIFY_CHANGED_ROOT` 可把"被验证的项目根"指到别处
//   （dist 的 import 仍相对本脚本解析 ⇒ 用真实实现跑临时工程）。
//   默认不设 = 老行为（本仓）。只用于**正例测试**，不参与任何判定口径。
// ★★★ 2026-10-22：设计册的**唯一位置**是 `.agent-io/design/`（`storage.ts#getDesignDir` 头注明写
//   「曾经试过放 docs/ … 现在只有一处」）。本行原来指着 `docs/task-system-plan.dsl.json` —— 那位置
//   2026-10-18 就废弃了，且 `docs/*` 进了 .gitignore ⇒ 文件根本不存在 ⇒ `plan=null` ⇒
//   **t354 的 ②②'⑤'⑥' 四条变成空断言**（它们「通过」不是因为对，是因为没东西可判）。
//   ⇒ 读不到册子要**当场报**，不许静默降到"只列不判"。
const PLAN = `${ROOT}/.agent-io/design/task-system-plan.dsl.json`;
// ★ 上移（2026-11-08）：快照那段要用它数"应验证对象"有几个；原来声明在文件后半段 ⇒ TDZ。
const TESTS = `${ROOT}/tests`;

const argv = process.argv.slice(2);
const NO_RUN = argv.includes('--no-run');
// ★ 2026-10-23：`--no-reuse` = 不用已有效证据（旧行为：命中就判）—— 复核“复用是不是藏了红”时用
const NO_REUSE = argv.includes('--no-reuse');
const JSON_OUT = argv.includes('--json');
const named = argv.filter((a) => !a.startsWith('--'));

/** ★ 路径口径只有一处：正斜杠 + 去 `./` + 去根前缀（与 `domain/expectation.ts` 的 `normPath` 同义） */
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

// ════════════════════════════════════════════════════════════════════
// ① 改动文件
// ════════════════════════════════════════════════════════════════════
/**
 * 跑一条 git 命令，**成败都如实带回**（★ AGENTS-RULES 0.12：`catch` 里不许空手返回）。
 *
 * ★ 为什么返回值必须是对象而不是 `string[]`：原先 `catch { return [] }` 让"git 跑不起来"
 *   与"git 说没有改动"**读起来一模一样** ⇒ `changed=[]` ⇒ `nothingHit` ⇒ `red=false` ⇒ **exit 0**。
 *   于是"增量门什么都没验"以**通过**退出（CI 只看退出码，那行"这不是绿"的文案没人读）。
 *   ⇒ 现在失败带 `ok:false` + `error`，由 {@link changedFromGit} 汇总成 `gitBroken`。
 */
function gitList(args) {
  try {
    const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, files: out.split('\n').map((s) => s.trim()).filter(Boolean), error: '' };
  } catch (e) {
    return { ok: false, files: [], error: String(e?.message ?? e).split('\n')[0] };
  }
}

/**
 * 改动文件集 + **取数是否可信**。
 *
 * 三态（★ 三者必须能分开读，不许合并成"空集"）：
 *   · `files`：真取到的改动文件；
 *   · `headMissing`：`git diff HEAD` 失败（全新仓还没 HEAD 是**合法**状态）⇒ 只用裸 diff + 未跟踪；
 *   · `errors`：**非空 ⇒ 改动集不可信** ⇒ 调用方必须非零退出（不许落进 `nothingHit` 的通过分支）。
 */
function changedFromGit() {
  // ★ 先判"这里到底是不是 git 仓"：它失败 = 环境级失败（不是仓库 / 没装 git），改动集根本无从谈起
  const probe = gitList(['rev-parse', '--is-inside-work-tree']);
  if (!probe.ok) {
    return { files: [], headMissing: false, errors: [`git rev-parse --is-inside-work-tree：${probe.error}`] };
  }
  // ★ `--name-only HEAD` 同时覆盖暂存与未暂存（相对 HEAD）；无 HEAD（全新仓）时退回裸 diff
  const tracked = gitList(['diff', '--name-only', 'HEAD']);
  const headMissing = !tracked.ok;
  const fallback = headMissing || tracked.files.length === 0 ? gitList(['diff', '--name-only']) : { ok: true, files: [] };
  // ★★ 未跟踪：新增的证/脚本在 `git diff` 里**不出现** —— 不列它，本入口就验不到自己（本次新增即此形状）
  const untracked = gitList(['ls-files', '--others', '--exclude-standard']);
  const errors = [];
  // `diff HEAD` 失败在**仓库里**只可能是"还没有 HEAD"（全新仓）⇒ 单独记 headMissing，不算环境失败；
  // 但裸 diff 与未跟踪**必须**成功，否则改动集就是残的 ⇒ 进 errors。
  if (!fallback.ok) errors.push(`git diff --name-only：${fallback.error}`);
  if (!untracked.ok) errors.push(`git ls-files --others：${untracked.error}`);
  return { files: [...new Set([...tracked.files, ...fallback.files, ...untracked.files])], headMissing, errors };
}

/**
 * ★★★ 2026-11-03（「什么变了」只有一处权威）：**改动集的来源必须自报**。
 *
 * 权威（唯一）= `cache.db` 的 `scan_changes` ∪ `symbol_diffs`：文件级 + 符号级，同一份数据。
 * `scan_changes.before_hash / after_hash` 直接取自 `files.content_hash`（同一指纹，不存第二份）。
 *
 * 本脚本**仍然用 git**（显式声明的第二个取数口，不是偷偷并存）：
 *   ① 内环必须能在「没建索引 / 空数据目录 / 没 build」的仓里跑（`cache.db` 可能不存在）；
 *   ② `git diff` 覆盖任何文件（`.md` / `scripts/*.mjs` / 未跟踪新增），而 `scan_changes` 只记进了索引的文件；
 *   ③ 内环要的是「这次改了哪些文件」，不是「索引认为变了哪些文件」。
 * ⇒ 读端拿到 `change_source` 就知道这两套的边界，谁都不用猜。
 */
function changeSourceBlock() {
  return {
    authority: 'cache.db 的 scan_changes ∪ symbol_diffs（两级：文件级 + 符号级）',
    used: 'git',
    why:
      '内环必须能在「没建索引 / 空数据目录 / 没 build」的仓里跑（cache.db 可能不存在）；' +
      '且 git diff 覆盖任何文件（含 .md / scripts/*.mjs / 未跟踪新增），而 scan_changes 只记已进索引的文件 —— ' +
      '两者覆盖面不同，内环要的是「这次改了哪些文件」。',
  };
}

// ★ 0.12：改动集的**来源**必须能读出"取到了 / 取不到" —— 显式点名（`named`）不经过 git ⇒ 恒可信
const gitInfo = named.length > 0 ? { files: [], headMissing: false, errors: [] } : changedFromGit();
/** ★ 非空 ⇒ **改动集不可信**（git 跑不起来）⇒ 本次"什么都没验"，必须非零退出（见 ⑤） */
const gitErrors = gitInfo.errors;
/**
 * ★★★ 0.12：**git 跑不起来 ⇒ 非零退出**。
 *
 * 改前：`gitList` 的 `catch { return [] }` ⇒ `changed=[]` ⇒ `nothingHit` ⇒ `red=false` ⇒ **exit 0**。
 * 那意味着"增量门**什么都没验**"以**通过**退出 —— 文案写着"这不是绿"，而 CI 只读退出码。
 * ⇒ 现在 git 失败**单独**把 `red` 拉起来（不借道 `nothingHit`，那条是"验了但没命中"）。
 * ★ 2026-10-31：本行**上移**到这里（③.7 的"未覆盖"要判"这一节算没算"，而 `const` 晚于使用会 TDZ）。
 */
const gitBroken = gitErrors.length > 0;

const changed = [...new Set((named.length > 0 ? named : gitInfo.files).map((p) => {
  // 允许传绝对路径：能相对仓库根就相对，否则原样（后面精确比对自然命不中）
  const abs = path.resolve(ROOT, p).replace(/\\/g, '/');
  return abs.startsWith(`${ROOT}/`) ? abs.slice(ROOT.length + 1) : norm(p);
}))].sort();

const changedSet = new Set(changed);

// ════════════════════════════════════════════════════════════════════
// ② 契约：`path` 命中改动文件
// ════════════════════════════════════════════════════════════════════
let E = null; // dist 的 expectation 模块（★ 摘要/路径口径都从它取，不自造格式）
let judge = null;
try {
  E = await import('../dist/src/domain/expectation.js');
  judge = (await import('../dist/src/application/design/intent/expectations.js')).judgeExpectations;
} catch {
  E = null;
}

/**
 * 一条期望涉及的路径（★ 精确比对用）。
 * ★ 有 dist 就调 `expectationPaths`（唯一口径）；没有就按 kind **就地**取 —— 这是**降级**，
 *   仅为"未 build 也能列出命中"，输出里会标 `判不了`。
 */
function pathsOf(e) {
  if (E) return E.expectationPaths(e);
  return e.kind === 'edge-exists' || e.kind === 'edge-absent' ? [norm(e.from), norm(e.to)] : [norm(e.path ?? '')];
}
function textOf(e) {
  if (E) return E.describeExpectation(e);
  return `${e.kind} ${norm(e.path ?? `${e.from}→${e.to}`)} ${e.symbol ?? ''} ${e.target ?? ''}`.trim();
}

let plan = null;
try {
  plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
} catch {
  plan = null;
}

const expHits = []; // { node_id, node_label, expectation, paths, text }
for (const n of plan?.geometry?.nodes ?? []) {
  for (const e of n.decision?.expectations ?? []) {
    const ps = pathsOf(e);
    if (ps.some((p) => changedSet.has(p))) {
      expHits.push({ node_id: n.id, node_label: n.label ?? n.id, expectation: e, paths: ps, text: textOf(e) });
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// ②.5 ★★★ 2026-10-23（增量测试 · 选量）：**已有证据仍作数 ⇒ 不重判**
//
// 判据**不在本脚本里**：`evidenceFreshness` 判 valid / stale / unverifiable，
// `planEvidenceRerun`（`task_ops.ts`）把它变成 skip / rerun / unknown。本脚本只做两件事：
// ① 把第②步命中的节点交给它；② **不判** skip 那些。
// ★ `unverifiable` 落在 `rerun`（卡上写死的判据：不许让历史证据冒充通过）。
let evidencePlan = null;
if (!NO_REUSE) {
  let P = null;
  try {
    P = await import('../dist/src/application/design/dsl_ops/task_ops.js');
  } catch {
    P = null;
  }
  if (P) {
    // 卡的**权威住处**是 `todos[]`（2026-10-22 迁移）；节点那份 `task` 只在无对应 todo 时用。
    const cardByNode = new Map();
    for (const t of plan?.todos ?? []) {
      if (!t.node_id || !(t.evidence ?? []).length) continue;
      // ★ 正在被领的卡**不复用**：它此刻可能正在改判据/代码，旧证据的 “valid” 是过去式
      if (t.state === 'claimed' || t.state === 'preparing') continue;
      cardByNode.set(t.node_id, { card_id: t.id, evidence: t.evidence });
    }
    for (const n of plan?.geometry?.nodes ?? []) {
      if (cardByNode.has(n.id) || !(n.task?.evidence ?? []).length) continue;
      if (n.task.state === 'claimed' || n.task.state === 'preparing') continue;
      cardByNode.set(n.id, { card_id: n.id, evidence: n.task.evidence });
    }
    const nodeById = new Map((plan?.geometry?.nodes ?? []).map((n) => [n.id, n]));
    const cards = [];
    for (const h of expHits) {
      const c = cardByNode.get(h.node_id);
      if (!c) continue; // 没证据 ⇒ 没得复用（照旧判）
      cards.push({
        id: c.card_id,
        feature: 'task-system-plan',
        node_id: h.node_id,
        expectations: nodeById.get(h.node_id)?.decision?.expectations ?? [],
        evidence: c.evidence,
      });
    }
    evidencePlan = P.planEvidenceRerun(ROOT, cards, { changed });
  }
}
// ════════════════════════════════════════════════════════════════════
// ②-b **VerifiedSnapshot**：上次已验证状态作基线（"没选中的凭什么说它仍成立"）
//
// ★ 它**不选用例**（选用例仍是上面那一条路径口径）：它只回答
//   「上次验过、且**未变 + 证据有效 + 影响关系可信**的条目，能不能继承」。
// ★★ 基线损坏 / 事实图不可信 / 公共底座改动 ⇒ **显式扩大范围**（本次全跑），
//   绝不默认为安全（这条是本模块存在的意义）。
// ════════════════════════════════════════════════════════════════════
let VS = null;
// ★★ 2026-11-09：验证器自证包（改共享验证器时先跑它，通过则**不扩大**）
let PP = null;
let impact = null;
let drift;
let tImpactStart = 0;
let tImpactMs = 0;
let snapLoad = { status: 'missing', reason: 'dist 里没有 verified_snapshot（先 npm run build）' };
let snapPlan = null;
// ★ 放在**模块作用域**：它们要在后面的读数里用，而算它们的那段在 try 块里。
//   （同类坑第 5 次：SD → drift → TESTS → 这三个 —— 凡"try 里算、外面打印"都要先声明在外面。）
let testsIndexed;
let testsOnDisk;
let runnerListForEvidence = 0; // ★ Java ②：Java 项目的运行器枚举数（node 系项目恒 0 = 不用）
// ★ Java ②：Java 项目的测试对象清单（选材段用——testFiles 对 Java 项目是 src/test/java 下的类文件）
let javaTestFiles = [];
// ★ Java ②（子项目委托）：主仓视角下，**嵌套子项目**的 Java 测试对象清单（仓库相对路径）
let subProjectJavaFiles = [];
/** 子项目 runner 归属：从文件向上找最近的 pom.xml / gradlew（找不到 ⇒ null = 不属于任何 Java 子项目） */
function subProjectRunnerOf(absFile) {
  let d = path.dirname(path.resolve(absFile));
  for (; d && d !== path.dirname(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'pom.xml'))) return { root: d, kind: 'maven' };
    if (fs.existsSync(path.join(d, 'gradlew')) || fs.existsSync(path.join(d, 'gradlew.bat'))) return { root: d, kind: 'gradle' };
    // 到主仓根为止（主仓自己的构建文件不算子项目——ROOT 判定已处理）
    if (path.resolve(d) === path.resolve(ROOT)) break;
  }
  return null;
}
// ★ Java ②：是否 Java 项目（pom.xml / gradlew 存在）——选材段的 testFiles 分源判定用
const isJavaProject = fs.existsSync(path.join(ROOT, 'pom.xml')) || fs.existsSync(path.join(ROOT, 'gradlew')) || fs.existsSync(path.join(ROOT, 'gradlew.bat'));
let testObjExtra = null;
try {
  VS = await import('../dist/src/application/design/verified_snapshot.js');
  snapLoad = VS.loadVerifiedSnapshot(ROOT);

  // ★★ 2026-11-09 收口：**验证器的局部修改不再无条件全跑**
  //   旧行为：命中 WIDEN_PATTERNS（含 verify-changed.mjs / verified_snapshot.ts）⇒ 每次都拉整册总门，见 scripts/verify.mjs 的门表。
  //   新行为：若本次只改了「共享验证器」⇒ 跑**自证包**；全绿且覆盖未丢 ⇒ 按增量走；
  //   有红 / 覆盖不足 / 额外还改了其它公共底座 ⇒ 才扩大。
  let proofDecision = null;
  if (PP) {
    const sv = PP.splitVerifierChange(changed);
    if (sv.verifier.length > 0 && sv.others.length === 0) {
      const cov = PP.proofPackCoverage((rel) => {
        try {
          return fs.readFileSync(path.join(ROOT, rel), "utf-8");
        } catch {
          return null;
        }
      });
      if (!cov.ok) {
        proofDecision = { widen: true, note: "自证包覆盖不足（文件缺 " + cov.missing_files.length + " / 用例缺 " + cov.missing_cases.length + "）⇒ 扩大" };
      } else {
        const run = PP.runVerifierProofPack((rel) => {
          const r = spawnSync(process.execPath, ["--import", "tsx", rel], { cwd: ROOT, encoding: "utf-8", env: { ...process.env, AGENT_IO_VERIFY_CHANGED_ROOT: ROOT } });
          const out = String(r.stdout ?? "") + String(r.stderr ?? "");
          const pass = /^# pass \d+/m.test(out) && /^# fail 0$/m.test(out);
          return { code: r.status === 0 && pass ? 0 : (r.status ?? 1), out };
        });
        proofDecision = { widen: !run.ok, note: run.note };
      }
      if (!JSON_OUT) console.log("   " + (proofDecision.widen ? "\u26a0 " : "\u2713 ") + proofDecision.note);
    }
  }
  // ★★ 2026-11-08（换锚点）：选择改为**改动集的波及集合**（O(改动数)），
  //   不再"把每条证据的去向闭包算到饱和再比哈希"（那是 O(证据×文件×2)，且长链文件永远判不了）。
  let IS = null;
  try {
    IS = await import('../dist/src/infrastructure/analysis/facts/impact_set.js');
  } catch {
    IS = null;
  }
  tImpactStart = Date.now();
  impact = IS ? IS.impactOfChanged(ROOT, changed, { max_depth: 6 }) : null;
  tImpactMs = Date.now() - tImpactStart;
  // ★★ 改动集可信度：拿基线里的**逐文件指纹**跟现算的比 —— 声明"没改"时也能发现漂移。
  //   算不出来（无基线/模块缺 API）⇒ `null` ⇒ 上层判"改动集不可信"（不许当没改动）。
  if (snapLoad.status === "ok" && typeof VS.hashProjectFiles === "function" && typeof VS.contentDrift === "function") {
    try {
      drift = (() => {
        const d = VS.contentDrift(snapLoad.snapshot.content.files, VS.hashProjectFiles(ROOT));
        return [...d.changed, ...d.added, ...d.removed];
      })();
    } catch {
      drift = null;
    }
  }
  // ★★ "应验证对象"的可见性：磁盘上有几个测试文件 / 索引里能看到几个。
  //   两者不一致（尤其索引 0 个）= 测试未纳入事实 ⇒ 不许把"没证据"读成"没问题"。
  try {
    const { getProjectCacheDb, closeAllProjectCacheDbs } = await import('../dist/src/infrastructure/index/db.js');
    const db = getProjectCacheDb(ROOT);
    const rows = db.prepare("SELECT DISTINCT file_path AS f FROM nodes WHERE file_path IS NOT NULL AND file_path <> ''").all();
    // ★ 口径不再钉在 `tests/` 前缀上：磁盘侧与索引侧用**同一份路径集合**算
    //   （`scanTestObjects` 只认 `*.test.*` / `*.spec.*` / `__tests__/`）。
    //   旧实现一个数前缀、一个扫目录 ⇒ 测试放在 `spec/` 时会被误判成"测试未纳入事实"。
    // ★ 基准 = **运行器自己会跑的**（collectTestFiles），不是形态扫描的估算
    // ★★ 第⑬项 Java ②（lead 集成验收抓到的缺口）：**Java 项目的运行器枚举**——
    //   collectTestFiles 只认 `<ROOT>/tests/**/*.test.ts`（本仓形态），Java 项目（pom.xml/gradlew）
    //   的测试对象在 `src/test/java/**` ⇒ 枚举恒 0 ⇒ "运行器枚举 0 个"假读数。
    //   修：ROOT 有 pom.xml/gradlew ⇒ 枚举走 **detectRunner 同源**的 Java 形态（JAVA_TEST_OBJECT_RE 扫描，
    //   与 maven/gradle runner 的 javaTestClassOf 映射同一约定）；node 系项目走原 collectTestFiles。
    let runnerList;
    if (isJavaProject) {
      runnerList = VS.scanTestObjects(ROOT).filter((r) => VS.JAVA_TEST_OBJECT_RE.test(r));
    } else {
      // ★★ 第⑬项 Java ②（lead 批准的"子项目 runner 委托"）：**主仓视角自动发现嵌套子项目**——
      //   形态扫描（scanTestObjects）扫到的 .java 测试对象属于**某个子项目**（向上找最近的
      //   pom.xml/gradlew），该子项目的 runner 负责跑它们 ⇒ 枚举 = node 系清单 + **子项目委托清单**。
      //   （例：主仓跑 verify-changed，夹具 tests/fixtures/java-proj 的 GreeterImplTest
      //     归 java-proj 子项目 ⇒ 枚举含它 ⇒ maven 真跑 ⇒ 实跑 1。）
      const nodeList = collectTestFiles(TESTS).map((f) => `tests/${f}`);
      const scanned = VS.scanTestObjects(ROOT).filter((r) => VS.JAVA_TEST_OBJECT_RE.test(r));
      const delegated = [];
      for (const f of scanned) {
        if (subProjectRunnerOf(path.join(ROOT, f))) delegated.push(f);
      }
      runnerList = [...nodeList, ...delegated];
      subProjectJavaFiles = delegated;
    }
    runnerListForEvidence = runnerList.length;
    javaTestFiles = runnerList;
    const vis = VS.testObjectVisibility(ROOT, rows.map((r) => String(r.f)), { onDisk: runnerList });
    testsIndexed = vis.objects_indexed;
    testsOnDisk = vis.objects_on_disk;
    // ★ `--json` 模式下 stdout 必须**只有那个 JSON**（既有判据 p0_change_set_truth ⑥ 依赖整段可解析）
    if (!JSON_OUT && vis.missing.length > 0 && vis.missing.length <= 5) {
      console.log(`   · 索引里看不到的测试对象：${vis.missing.join(', ')}`);
    }
    // ★ 差额必须说出来：形态扫到的 != 运行器会跑的，静默偏差迟早被读成"全都纳入了"
    testObjExtra = vis.extra;
    closeAllProjectCacheDbs();
  } catch {
    testsIndexed = undefined; // 索引不可用 ⇒ 不下断言（由 plan 的其它判据兜）
    testsOnDisk = undefined;
  }
  snapPlan = VS.planInheritance({
    // ★★ 验证器自证包通过 ⇒ 从生效 widen 名单里剔掉「验证器文件」（其它公共底座仍无条件扩大）
    ...(proofDecision && !proofDecision.widen ? { widenPatterns: VS.WIDEN_PATTERNS.filter((re) => !PP.VERIFIER_FILES.some((f) => re.test(f))) } : {}),
    loaded: snapLoad,
    changed,
    impact,
    drift,
    // ★ 2026-11-09：观察面补全——没写 touches 声明的测试，从 import/call 边推导；推不出就保持 undetermined
    deriveObserves: (e) => VS.derivedObservesOf(ROOT, String(e.id).replace(/^test:/, '')),
    evidence: {
      // ★ 第⑬项 Java ②：Java 项目的 on_disk 基准与 runnerList 同源（见上面 runnerList 的分支注释）
      objects_on_disk: testsOnDisk ?? (isJavaProject ? runnerListForEvidence : collectTestFiles(TESTS).length),
      objects_indexed: testsIndexed,
      label: '测试文件',
    },
  });
} catch (e) {
  snapLoad = { status: 'missing', reason: `快照模块不可用：${String(e && e.message ? e.message : e).slice(0, 100)}` };
}
const snapWiden = snapPlan?.widen ?? null;

/** ★ 这一步的**唯一输出**：哪几个节点不判（其余一律判） */
const reuseNodes = new Set((snapWiden ? [] : (evidencePlan?.skip ?? [])).map((i) => i.node_id));
const hitsToJudge = expHits.filter((h) => !reuseNodes.has(h.node_id));

// ════════════════════════════════════════════════════════════════════
// ③ 测试：`tests/*.test.ts` 头注的 `touches:` 命中改动文件（★ 另加一条：改的就是它自己 ⇒ 必跑）
//
// ★★★ 2026-10-31：这一步原来扫的是 `certs/t*.mjs`（108 张证），`certs/` 整目录退役后**机制搬来
//   `tests/`**：`tests/` 现在是唯一的行为断言处，「测试」门每轮全跑，本入口只挑**受影响的**那几支。
// ★ 同时**删掉**派生索引（`scripts/derive-touches.mjs` → `certs/.touches.json`）：
//   那是同一事实的第二处真相（改了测试忘了重派生 ⇒ 静默漏跑），0.9 要求发现即删。
// ════════════════════════════════════════════════════════════════════
/** `touches:` 一行声明。★ 只认**行首的** `touches:`（散文里提到 `touches` 不算声明） */
const TOUCH_RE = /^[ \t]*(?:\*|\/\/|\/\*)?[ \t]*touches[ \t]*:[ \t]*(.+)$/m;

/**
 * 读一个文件头里的 `touches:` **显式声明**（`null` = 没写 / 读不到）。
 * ★ 文法只有一份（`TOUCH_RE`）：不许另发明一套"我观察了谁"的写法（同一件事两个住处 = 本仓头号病）。
 */
/**
 * 头注里可选的 `symbols:` 声明（一行逗号分隔的 qualified name）。
 * ★ 与 `touches:` 同源同写法：都是**测试自己声明它观察什么**，本脚本只读不猜。
 * ★ 没写 = 只按文件看（`observes` 已经足够表达"改这个文件就重验我"）。
 */
function declaredSymbols(absFile) {
  let src = "";
  try {
    src = fs.readFileSync(absFile, "utf8");
  } catch {
    return null;
  }
  const m = src.match(/^[ \t]*(?:\*|\/\/|\/\*)?[ \t]*symbols[ \t]*:[ \t]*(.+)$/m);
  if (!m) return null;
  return [...new Set(m[1].split(",").map((x) => x.trim()).filter(Boolean))];
}

function declaredTouches(absFile) {
  let src = '';
  try {
    src = fs.readFileSync(absFile, 'utf8');
  } catch {
    return null;
  }
  const m = src.match(TOUCH_RE);
  if (!m) return null;
  return [...new Set(
    m[1]
      .replace(/\*\/\s*$/, '')
      .split(/[,\s]+/)
      .map((s) => s.replace(/[`'"]/g, '').trim())
      .filter(Boolean),
  )];
}

// ★★ **唯一实现**（0.9.1）：与 `scripts/run-tests.mjs` 共用 `scripts/lib/test_files.mjs`。
//   ★ 2026-11-05 修：这里原先是 `fs.readdirSync(TESTS).filter(...)` —— **只扫顶层**（82 个），
//     而 `run-tests.mjs` 是**递归**（85 个）⇒ `tests/budget/` · `tests/locate/` · `tests/rate/`
//     三个文件**在内环里永远选不中，而它自己不知道**（少跑 = 假绿的入口）。
//     更糟：这行注释当时写着"收集规则与 run-tests.mjs 一致" —— **注释在撒谎**。
//     ⇒ 判据不再是"注释声称一致"，而是"**两处调同一个函数**"（`tests/p0_summary_format_alignment.test.ts` 守它）。
// ★★ 第⑬项 Java ②：Java 项目的 testFiles = **形态扫描的 Java 测试对象**（collectTestFiles 只认
//   `tests/**/*.test.ts` 本仓形态，Java 项目恒 0 ⇒ 选材恒空 = 永不跑测试）。Java 的选材粒度 = 文件级
//   （maven runner 按类跑，归因回文件）——touches/self-changed 机制对 .java 文件同样工作。
// ★★ 第⑬项 Java ②：testFiles 分源补全——**主仓视角也要含委托的子项目 Java 测试**：
//   collectTestFiles 只认 `tests/**/*.test.ts`（本仓形态）⇒ 委托清单（subProjectJavaFiles）不在其中
//   ⇒ 选材循环 127 个里没有 GreeterImplTest ⇒ self-changed 永不命中（实测探针：javaInTestFiles=0）。
//   ⇒ testFiles = node 系清单 ∪ 委托清单（isJavaProject 时 = javaTestFiles 全量，原样）。
const testFiles = isJavaProject
  ? javaTestFiles
  : [...new Set([...collectTestFiles(TESTS), ...subProjectJavaFiles])];

const testHits = [];
const noTouches = [];
// ★★ 第⑬项 Java ②（lead 抓到的选材缺口）：**self-changed/touches 的路径前缀分源**——
//   node 系：清单条目相对 `tests/` ⇒ 改动集路径带 `tests/` 前缀（`tests/foo.test.ts`）；
//   Java 系：清单条目是**仓库相对**路径（`src/test/java/...`）⇒ changedSet 里就是它本身。
//   修复前两处都硬编码 `tests/${f}` ⇒ Java 测试文件的 self-changed 恒 false（改的就是它也没命中）。
// ★★ 第⑬项 Java ②（双前缀 bug · 沙箱探针实测抓的）：**前缀按条目形态判定，不按项目类型**——
//   node 系清单条目相对 `tests/` ⇒ 改动集 key 要拼 `tests/` 前缀；
//   **委托的 Java 条目已是仓库相对**（`tests/fixtures/java-proj/src/...`，主仓相对！）
//   ⇒ 拼 `tests/` 会变双前缀（`tests/tests/fixtures/...`）⇒ 永不命中（实测探针：javaInTestFiles=1 但命中 0）。
//   ⇒ 判定：条目以 `tests/` 开头 ⇒ 已是仓库相对（key=条目原文）；否则拼 `tests/`（node 系条目）。
const testPrefixFor = (f) => (isJavaProject || f.startsWith('tests/') ? '' : 'tests/');
const absPathFor = (f) => (isJavaProject || f.startsWith('tests/') ? path.join(ROOT, f) : `${TESTS}/${f}`);
for (const f of testFiles) {
  const t = declaredTouches(absPathFor(f));
  const selfChanged = changedSet.has(`${testPrefixFor(f)}${f}`);
  if (t === null) {
    // ★ **没写 `touches` ≠ 没验**：这支测试仍由「测试」门全跑；内环只是**无法归因**到你的改动。
    //   ⇒ 记进 `noTouches`（带分母），并让被改的文件落进「未覆盖」—— 不许当成"不跑"（0.12）。
    noTouches.push(f);
    if (selfChanged) testHits.push({ file: f, touches: [], hits: [], kind: 'self-changed', why: '改动文件就是它自己' });
    continue;
  }
  const hit = t.filter((p) => changedSet.has(norm(p)));
  if (hit.length > 0 || selfChanged) {
    testHits.push({
      file: f,
      touches: t,
      hits: hit,
      kind: selfChanged ? 'self-changed' : 'touches',
      why: selfChanged ? '改动文件就是它自己' : `touches 命中 ${hit.join(', ')}`,
    });
  }
}

// ★★ 2026-11-08（**账本 ↔ 运行器对齐**）：账本判"必须重验"的测试，**必须真的跑**。
//   否则它既不在 touches 选中集里（没跑）、又被账本排除在继承之外 ⇒ **既不跑也不继承**
//   —— 比不判更糟：读端会以为"处理过了"，实际悄悄丢失。
//   ⇒ 两者取**并集**，理由逐条写清（本处只加不减，不改 touches 口径）。
for (const r of snapPlan?.rerun ?? []) {
  if (!String(r.id).startsWith('test:tests/')) continue;
  const f = String(r.id).slice('test:tests/'.length);
  if (testHits.some((h) => h.file === f)) continue;
  testHits.push({
    file: f,
    touches: declaredTouches(`${TESTS}/${f}`) ?? [],
    hits: [],
    kind: 'ledger-rerun',
    why: `账本要求重验：${r.reason}`,
  });
}

// ★★ 2026-11-08（**无证据 ≠ 通过**）：基线条目为空 / 观察面全空时，账本给不出"该跑谁"，
//   若此时仍按 touches 选测试，就会**一个都不跑**却收工 —— 那正是要堵的假绿。
//   ⇒ 这两态一律**强制跑全部测试文件**（并把理由写进选材，读端看得见为什么跑了全量）。
// ★★ 第⑬项第四刀（2026-11-10 · 用户拍板"增量纪律收紧"）：**白名单外的 no-evidence 不再自动扩大**。
//   判定：改动集 ∩ WIDEN_PATTERNS ≠ ∅ ⇒ 白名单（判定器/共享运行器/schema）变更 ⇒ 全跑照旧（保守正确）；
//   改动集全是白名单外文件 ⇒ 改为**说明性继承**（kind:'no-evidence-inherit'）——
//   "该文件的契约覆盖待建"是事实，但为它每次拉全量等于把内环永久关掉（与 2026-11-09 移除册 widen 同理）。
//   ★ no-work 不动（0 对象本来就没活干）；混合改动走 widen 通道（:393 已处理，这里保守不过滤）。
//   ★ VS 为 null（dist 缺失/导入失败）⇒ WIDEN 判定不可用 ⇒ 保守走全跑（与 523 的 noEvidenceWiden 合流）。
const changedHitsWiden = VS
  ? VS.WIDEN_PATTERNS.some((re) => changed.some((c) => re.test(c)))
  : true;
const noEvidenceWiden = snapPlan && (snapPlan.state === 'no-evidence' || snapPlan.state === 'empty-observes') && changedHitsWiden;
if (snapPlan && (snapPlan.state === 'no-evidence' || snapPlan.state === 'empty-observes' || snapPlan.state === 'no-work')) {
  if (noEvidenceWiden || snapPlan.state === 'no-work') {
    for (const f of testFiles) {
      if (testHits.some((h) => h.file === f)) continue;
      testHits.push({
        file: f,
        touches: declaredTouches(`${TESTS}/${f}`) ?? [],
        hits: [],
        kind: 'no-evidence-full',
        why: `账本态 ${snapPlan.state} ⇒ 强制全跑（${snapPlan.note ?? snapPlan.widen?.reason ?? ''}）`.trim(),
      });
    }
  } else {
    // 白名单外 ⇒ 说明性继承（不扩大、不静默：读数明说"为什么没跑全量"）
    testHits.push({
      file: '(选材说明)',
      touches: [],
      hits: [],
      kind: 'no-evidence-inherit',
      why: `账本态 ${snapPlan.state}，但改动集不含白名单文件（判定器/共享运行器/schema）⇒ 不自动扩大；` +
        `按改动触达继续继承判定。该文件的契约覆盖待建（建覆盖 = 挂卡写判据，不是拉全量）`,
    });
  }
}

// ════════════════════════════════════════════════════════════════════
// ③.1 ★★★ T-#INC-VERIFY：选量 = touches ∪ 契约 path ∪ impact(changed)（三集合并）
//
// ## 为什么必须接 impact
// 现状 `touches` 只精确命中 35/135 个测试文件；契约 `path` 在判据退役后载体变窄。
// 机器明明能算「改了 X ⇒ 谁依赖 X」（impactOfChanged 已在 verify_project.ts:543 用），
// 内环却把它只当**报告读数**（verified_scope.impact），不参与**选量** ⇒ 漏 11/14 门。
// ## 口径（fail-closed）
// · `impact.ok=true` ⇒ 把 `impact.files` 的影响面并入选材：
//     - 契约 path 落在影响面里的 ⇒ 追加进 expHits（就地判，复用既有 judge）；
//     - 测试 touches / self-changed 落在影响面里的 ⇒ 追加进 testHits（真跑）；
//   ★ 这里 still 不"全跑"：只跑影响闭包命中的那些（三集合并，不是把 impact 当第四把尺）。
// · `impact.ok=false` ⇒ **回落全量**：把全部测试文件标记为 `impact-unavailable-full`（真跑），
//   并把原因写进读数与 JSON（0.12：判不了 ≠ 没影响 ≠ 通过，不假绿）。
// · "未覆盖"升级：③.7 算 uncovered 时，impact.ok=false 的文件不再"静默没覆盖"，
//   而是随全量回落一并覆盖，同时在 conclusion 给出「影响关系不可信 ⇒ 已回落全量」显式提示。
// ════════════════════════════════════════════════════════════════════
const IMPACT_UNAVAILABLE = !!(impact && impact.ok === false) || (!impact && !NO_RUN);
const impactFiles = impact && impact.ok ? impact.files : new Set();
const impactAdded = { contracts: 0, tests: 0, fullFallback: false };
{
  // ★ 选量在 --no-run 下也算（读数与真跑同源：`--no-run` 只是"不执行"，不是"不选材"）。
  if (IMPACT_UNAVAILABLE) {
    // fail-closed：影响关系不可信 ⇒ 全量跑测试（不静默按 touches 的窄集收工）
    impactAdded.fullFallback = true;
    for (const f of testFiles) {
      if (testHits.some((h) => h.file === f)) continue;
      testHits.push({
        file: f,
        touches: declaredTouches(isJavaProject ? f : `${TESTS}/${f}`) ?? [],
        hits: [],
        kind: 'impact-unavailable-full',
        why: `impactOfChanged ok:false（${impact && impact.ok === false ? impact.reason : '模块未加载'}）⇒ 回落全量（不假绿）`,
      });
    }
  } else if (impactFiles.size > 0) {
    // ① 契约：path 落在影响面 ⇒ 追加命中（去重：同一个 node+expectation 只加一次）
    for (const n of plan?.geometry?.nodes ?? []) {
      for (const e of n.decision?.expectations ?? []) {
        const ps = pathsOf(e);
        if (!ps.some((p) => impactFiles.has(p))) continue;
        if (expHits.some((h) => h.node_id === n.id && JSON.stringify(h.expectation) === JSON.stringify(e))) continue;
        expHits.push({ node_id: n.id, node_label: n.label ?? n.id, expectation: e, paths: ps, text: textOf(e) });
        impactAdded.contracts++;
      }
    }
    // ② 测试：touches 落在影响面（或测试自身在影响面）⇒ 追加命中
    for (const f of testFiles) {
      if (testHits.some((h) => h.file === f)) continue;
      const key = isJavaProject || f.startsWith('tests/') ? f : `tests/${f}`;
      const t = declaredTouches(absPathFor(f));
      const touchesHit = (t ?? []).some((p) => impactFiles.has(norm(p)));
      const selfInImpact = impactFiles.has(key) || impactFiles.has(f);
      if (touchesHit || selfInImpact) {
        testHits.push({
          file: f, touches: t ?? [], hits: (t ?? []).filter((p) => impactFiles.has(norm(p))),
          kind: 'impact',
          why: `impact 波及（${touchesHit ? 'touches 命中影响面' : '测试自身在影响面'}）`,
        });
        impactAdded.tests++;
      }
    }
  }
}
// ★ 影响面命中的契约也要进 hitsToJudge（在上面已算过 hitsToJudge 的后面追加去重）
if (impactAdded.contracts > 0) {
  const known = new Set(hitsToJudge.map((h) => `${h.node_id}\u0000${JSON.stringify(h.expectation)}`));
  for (const h of expHits) {
    const k = `${h.node_id}\u0000${JSON.stringify(h.expectation)}`;
    if (known.has(k)) continue;
    if (reuseNodes.has(h.node_id)) continue;
    hitsToJudge.push(h);
    known.add(k);
  }
}

// ★★ 开发遥测（第⑬项队列）：选材是故事线的关键帧——百分比/命中理由进 data（GUI 动画用）
try {
  const { emitTelemetry, TELEMETRY_STAGES } = await import('../dist/src/application/telemetry.js');
  const hits = testHits.filter((h) => h.file !== '(选材说明)');
  const inherited = testHits.filter((h) => h.kind === 'ledger-rerun').length;
  emitTelemetry(ROOT, TELEMETRY_STAGES.select, {
    text: `正在验证：选中 ${hits.length} 个测试对象（命中 ${testHits.filter((h) => h.kind !== 'no-evidence-inherit' && h.kind !== 'no-evidence-full').length} / 账本重验 ${inherited} / 无证据说明 ${testHits.length - hits.length}）`,
    data: {
      total: hits.length,
      byKind: testHits.reduce((acc, h) => { acc[h.kind] = (acc[h.kind] ?? 0) + 1; return acc; }, {}),
      percent: testFiles.length ? Math.round((hits.length / testFiles.length) * 100) : 0,
      denominators: { testFiles: testFiles.length, selected: hits.length },
    },
  });
} catch { /* 遥测不阻断 */ }

/**
 * ★ 精准命中 = 真声明了 `touches` 并命中（`self-changed` 也算：那是"改的就是它"）。
 * ★ 这里**没有**"兜底全跑"那一档了 —— 证时代那档存在是因为"没声明"的证没别处会跑；
 *   测试有「测试」门全跑兜着，内环再全跑一遍就是第二套跑法（0.9）。
 */
const testPreciseHits = testHits;

// ════════════════════════════════════════════════════════════════════
// ③.7 ★★★ 2026-10-31：**"未被覆盖" ≠ "没影响"**（AGENTS-RULES 0.12 在本脚本上的最后一处）
//
// ## 它挡的是哪一句话被读错
// 本脚本只报「命中 N 条契约 / M 个测试」。改动集里**一条都没命中**的文件 —— 读的人会读成
// **"这些文件这次没影响"**，而真相常常是 **"没有任何判据/测试观察它们"**（没人证这件事）。
// 实测（2026-10-31）：退役 574 条判据把 `path` 载体抽空（`write_gate.ts` 30 → 1 条）⇒ 改它
// 「看起来像没受影响」；而 `src/` 几百个文件里**多数**既无契约也无 touches 命中。
//
// ## 口径（两条边 = 本脚本已有的两路，不新造第三条）
// 一个改动文件算**被覆盖**，当且仅当：
//   · 第②步：某条契约的 `path`（`expectationPaths`，含 edge 两端）命中它；
//   · 第③步：某支测试的 `touches:` 命中它，或改的就是它自己（`tests/*.test.ts` —— 「测试」门天然跑它）。
// 两者都没有 ⇒ 进 `uncovered`。
//
// ## ★ 它**不是闸**：U>0 **不判红**
// 理由：覆盖面是**存量状况**，不是"这次改坏了"。判红会让内环天天红 ⇒ 内环被存量淹没（已发生过：
// `verify-changed` 的读数曾长期被无 touches 的证兜底全跑淹没）。⇒ 它是**报告**：
// 显眼（结论区 + 单独一节 + 分母），且**可被测试断言**（`tests/p0_incremental_verify.test.ts`）。
// ════════════════════════════════════════════════════════════════════

/** file → 覆盖它的理由（每条理由都点名**谁**覆盖：节点 id / test 名） */
const coveredBy = new Map();
const markCovered = (file, why) => {
  const f = norm(file);
  if (!changedSet.has(f)) return; // 只记改动集内的文件（覆盖集的定义域）
  const list = coveredBy.get(f) ?? [];
  list.push(why);
  coveredBy.set(f, list);
};
for (const h of expHits) for (const p of h.paths) markCovered(p, `契约 ${h.node_id}`);
for (const t of testPreciseHits) {
  // ★ Java ②：覆盖账的 key 分源——node 系条目相对 `tests/`（key 带 `tests/` 前缀）；Java 系条目
  //   **本身就是仓库相对**（key = 条目原样）——修复前硬编码 `tests/${t.file}` ⇒ Java 的覆盖账
  //   全部对不上 ⇒ 改动文件被误报"没有一支声明观察它"。
  const tKey = isJavaProject ? t.file : `tests/${t.file}`;
  for (const p of t.touches ?? []) markCovered(p, `${tKey}`);
  if (t.kind === 'self-changed') markCovered(tKey, `${tKey}（改的就是它自己）`);
}
// ★ T-#INC-VERIFY：impact 波及集合**不进 covered/uncovered 账**。
//   ★ 口径分离（lead 裁定）：impact 只驱动**选量**（③.1 追加测试/契约）；covered/uncovered
//   仍只回答"改动文件有没有契约 path / touches 观察它"—— 两者语义不同，混起来会把
//   "改动文件自己在影响闭包里（self）"误读成"它有专属断言"（p0_incremental_verify 实测抓到）。
//   `impact.ok:false` ⇒ ③.1 已回落全量；这里在 why 与结论里**显式提示**跑全量，但不伪造 covered。

/**
 * 未覆盖清单（**逐文件 + why**）。★ `gitBroken` 时是 `null`：改动集不可信 ⇒ **没算**
 * （0.12：`[]` 会被读成"一个都没有"，与"没算"分不开）。
 */
const uncovered = gitBroken
  ? null
  : changed
      .filter((f) => !coveredBy.has(f))
      .map((f) => ({
        file: f,
        why:
          `无契约（${expHits.length} 条命中期望的 path 都不含它）· ` +
          `无 touches（${testPreciseHits.length} 支命中测试 / ${testFiles.length} 个测试文件里，没有一支声明观察它）` +
          (IMPACT_UNAVAILABLE ? ` · ★ 影响关系本次不可信 ⇒ 已回落全量（本文件可能被波及，但无机器证明）` : ''),
      }));

// ════════════════════════════════════════════════════════════════════
// ③.5 项目级检查：**改设计 DSL ⇒ 跑 design-check**（2026-10-22 · 卡 A3）
//
// ## 为什么住在这里、而不是 `npm run verify`
// `scripts/design-check.mjs` 是**全量扫**（读整份设计册的 `task_plan.design_completeness.criteria`），
// 与增量哲学相反；挂进总门 = 每次 verify 都全量跑一遍（用户 2026-10-07 已裁：「不建普查门」）。
// ⇒ 正确位置是**受影响集合**：改了设计册（`.agent-io/design/*.dsl.json`）或改了它自己 ⇒ 跑它。
//
// ## 它挡的事故（实测，不是推测）
// 2026-10-22 当天 41 次 DSL 改动，`design-check` **一次都没被跑过**（它不在任何门里）
// ⇒ 那 41 次里"设计完整性"是什么样，**没人知道**；等发现时只能靠人回忆。
//
// ## 边界（诚实标注）
// · 它判的是**项目级** `criteria[].expect`，不是节点级 `decision.expectations`（后者在第 ② 步）；
// · 它只认默认 feature `task-system-plan`（`--feature` 未传）；改了**别的** feature 的册也会跑它，
//   此时它扫的是 `task-system-plan` ⇒ **可能不相关**（宁可多跑一次，也不静默当作"没影响"）。
// ════════════════════════════════════════════════════════════════════
const DESIGN_SHEET_RE = /^\.agent-io\/design\/[^/]+\.dsl\.json$/;
const designSheetHit = changed.find((p) => DESIGN_SHEET_RE.test(p)) ?? null;
const designCheckWhy = designSheetHit
  ? `改了设计册 ${designSheetHit}`
  : changed.includes('scripts/design-check.mjs')
    ? '改的就是 design-check 自己'
    : '';
const designCheckHit = designCheckWhy !== '';
let designCheckRun = null;
if (designCheckHit && !NO_RUN) {
  const t0 = Date.now();
  let out = '';
  let rc = 0;
  try {
    out = execFileSync('node', [`${ROOT}/scripts/design-check.mjs`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    rc = typeof e.status === 'number' ? e.status : -1;
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  const c = out.match(/通过 (\d+) · ★ 不通过 (\d+) · 进行中 (\d+)（共 (\d+) 条）/);
  designCheckRun = {
    rc,
    ms: Date.now() - t0,
    pass: c ? Number(c[1]) : null,
    fail: c ? Number(c[2]) : null,
    pending: c ? Number(c[3]) : null,
    checked: c ? Number(c[4]) : null,
    out,
  };
}

// ════════════════════════════════════════════════════════════════════
// ④ 实际跑（★ 只跑上面算出的；--no-run 时一个都不跑）
//
// ★ 跑法**不在本脚本里**：统一经 `scripts/run-tests.mjs --filter <文件>`（它与「测试」门同一支 runner，
//   同一套 TAP 口径，且**每文件一个临时数据根**）—— 否则本脚本就是第二套跑法（0.9）。
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-17（verify-changed-subjava-shadows-node）：**三个执行器是独立 if，不是 if/else 链**。
//
// ## 病（实测，pristine 树上就有）
// 原来这三段是 `if (Java项目) … / if (!isJavaProject && 有子项目Java) … / else if (!NO_RUN) …`。
// 而本仓**自带**一个 Java 夹具 `tests/fixtures/java-proj/`（HEAD 8837416 就有）⇒ 形态扫描把它的
// `GreeterImplTest.java` 收进 `subProjectJavaFiles` ⇒ 第二个分支**恒真** ⇒ 第三个分支的
// node 测试循环**永远进不来** ⇒ 本仓每次 `npm run verify:changed` 都「命中测试 N 支 / 实跑 0 支」，
// 而且**不红**（"0 支"被读成"没什么可跑"，不是"该跑没跑"）——这是假绿入口。
// 探针实测：`NO_RUN=false isJava=false testHits=3 subJava=1 → 实跑 0 支`。
//
// ## 为什么改成独立 if 是**正确**的（不是绕过）
// 三个执行器筛选的是**互斥**的子集：
//   · 整项目 Java（`isJavaProject`）—— 自己处理全部 Java 测试对象；
//   · 子项目 Java 委托 —— 只处理 `.endsWith('.java')` 的 testHits；
//   · node 测试 —— 只处理**非** `.java` 的 testHits（分支体第一行就 `continue`）。
// ⇒ 它们**本来就该都跑**，串成 else-if 是把"互斥的筛选"错当成"互斥的互斥"。
// ⇒ 也**不会**重复入列：同一个 h.file 只可能落进其中一个。
// ════════════════════════════════════════════════════════════════════
const testRuns = [];
if (!NO_RUN && isJavaProject) {
  // ★★ 第⑬项 Java ②（lead 集成验收抓到的最后一环）：**Java 项目的执行走 detectRunner**——
  //   node 系的 `run-tests.mjs --filter <file>` 是 node:test 专用 runner（对 .java 无效）。
  //   Java ⇒ dist verify_project 的 detectRunner(ROOT)（maven/gradle）→ `runner.run(javaTestFiles)`
  //   （按类粒度 mvn test + surefire XML 归因——Java ② 已实现）→ 结果进同一 testRuns 形状。
  //   ★ touches/self-changed 选材对 .java 同样工作（上面已接），这里只换**执行器**。
  try {
    const { detectRunner } = await import('../dist/src/application/verify/verify_project.js');
    const { runner, why } = detectRunner(ROOT);
    if (!runner) {
      testRuns.push({ file: '(runner)', rc: 1, tests: null, pass: null, fail: null, hasSummary: false, ms: 0, kind: 'crash', out: `Java 项目但 runner 不可用：${why}` });
    } else {
      // 只跑**选中**的（testHits 已按 touches/self-changed 选过）；runner.run 返回逐文件结果
      const selected = testHits.map((h) => h.file).filter((f) => f.endsWith('.java'));
      const results = runner.run(selected);
      for (const r of results) {
        testRuns.push({
          file: r.file,
          rc: r.rc,
          tests: r.pass + r.fail || null,
          pass: r.pass || null,
          fail: r.fail || null,
          hasSummary: r.rc !== undefined && (r.pass > 0 || r.fail > 0),
          ms: r.ms,
          kind: r.fail > 0 || r.rc !== 0 ? 'red' : 'green',
          out: r.tail,
        });
      }
    }
  } catch (e) {
    testRuns.push({ file: '(runner)', rc: -1, tests: null, pass: null, fail: null, hasSummary: false, ms: 0, kind: 'crash', out: `Java runner 执行失败：${String(e?.message ?? e).slice(0, 200)}` });
  }
}
// ★★ 第⑬项 Java ②（子项目委托 · lead 批准）：**主仓视角下嵌套子项目的 Java 测试执行**——
//   node 系执行路径跑不了 .java（node:test 只认 .test.ts）⇒ 形态扫到的 .java 测试对象按
//   **所属子项目根**（subProjectRunnerOf：向上找 pom.xml/gradlew）分组，每组委托对应 runner。
//   只跑**选中**的（testHits 命中的）；结果进同一 testRuns 形状（基线写回/红判共用）。
if (!NO_RUN && !isJavaProject && subProjectJavaFiles.length > 0) {
  const selected = new Set(testHits.map((h) => h.file).filter((f) => f.endsWith('.java')));
  const bySub = new Map(); // 子项目根 → files[]
  for (const f of subProjectJavaFiles) {
    if (!selected.has(f)) continue;
    const sub = subProjectRunnerOf(path.join(ROOT, f));
    if (!sub) continue;
    if (!bySub.has(sub.root)) bySub.set(sub.root, { kind: sub.kind, files: [] });
    bySub.get(sub.root).files.push(f);
  }
  for (const [subRoot, { files }] of bySub) {
    try {
      const { detectRunner } = await import('../dist/src/application/verify/verify_project.js');
      const { runner, why } = detectRunner(subRoot);
      if (!runner) {
        testRuns.push({ file: `(子项目 ${path.basename(subRoot)})`, rc: 1, tests: null, pass: null, fail: null, hasSummary: false, ms: 0, kind: 'crash', out: `子项目 Java runner 不可用：${why}` });
        continue;
      }
      const results = runner.run(files);
      for (const r of results) {
        testRuns.push({
          file: r.file,
          rc: r.rc,
          tests: r.pass + r.fail || null,
          pass: r.pass || null,
          fail: r.fail || null,
          hasSummary: r.rc !== undefined && (r.pass > 0 || r.fail > 0),
          ms: r.ms,
          kind: r.fail > 0 || r.rc !== 0 ? 'red' : 'green',
          out: r.tail,
        });
      }
    } catch (e) {
      testRuns.push({ file: `(子项目 ${path.basename(subRoot)})`, rc: -1, tests: null, pass: null, fail: null, hasSummary: false, ms: 0, kind: 'crash', out: `子项目 runner 执行失败：${String(e?.message ?? e).slice(0, 200)}` });
    }
  }
}
// ★ 独立 if（**不是** else-if）：见上面「三个执行器是独立 if」那段论证。
if (!NO_RUN && !isJavaProject) {
  for (const h of testHits) {
    // ★★ 第⑬项 Java ②（沙箱实测抓的双跑）：**.java 条目已由上面的委托块处理**（子项目 runner.run
    //   或 crash 条目）⇒ node 兜底（run-tests.mjs 对 .java 恒失败）**不许再碰它们**——
    //   修复前双跑：委托块一条 + node 兜底一条（unsupported 假绿）。
    if (h.file.endsWith('.java')) continue;
    const t0 = Date.now();
    let out = '';
    let rc = 0;
    try {
      out = execFileSync(process.execPath, [`${ROOT}/scripts/run-tests.mjs`, '--filter', h.file], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (e) {
      rc = typeof e.status === 'number' ? e.status : -1;
      out = String(e.stdout ?? '') + String(e.stderr ?? '');
    }
    // ★ 计数口径**只有一处**：runner 自己的机读行（不自解析源码、不数 `test(` 的个数）
    // ★★ 2026-11-05 修：原正则 `/…用例 (\d+) \/ 通过…/` **永远匹配不上** —— `run-tests.mjs` 实际打印的是
    //   `用例 8（源码声明 8）/ 通过 8`（**全角括号，且 `）` 与 `/` 之间没有空格**）。于是
    //   `hasSummary` 恒 false ⇒ `fail` 恒 null ⇒ 所有测试落进 `nosummary`，
    //   红还能靠 `rc!==0` 兜住，但"跑了几条、过了几条"**这个能力整个丢了**（违反本文件自己引的 0.12 带分母）。
    //   ⇒ `（源码声明 N）` 做成**可选组**，两种形态都认；间隙用 `\s*` 而不是写死一个空格。
    //   ★ 守它的是 `tests/p0_summary_format_alignment.test.ts`：把 `run-tests.mjs` 的**真格式串**渲染出来喂给本正则。
    const m = out.match(/测试门：文件 (\d+) \/ 用例 (\d+)(?:（源码声明 \d+）)?\s*\/ 通过 (\d+) \/ 失败 (\d+) \/ 跳过 (\d+)/);
    const hasSummary = !!m;
    const fail = hasSummary ? Number(m[4]) : null;
    testRuns.push({
      file: h.file,
      rc,
      tests: hasSummary ? Number(m[2]) : null,
      pass: hasSummary ? Number(m[3]) : null,
      fail,
      hasSummary,
      ms: Date.now() - t0,
      // ★ 没有汇总行 = 文件根本没跑起来 ⇒ `crash`（不许当"跑了没红"）
      kind: !hasSummary ? (rc !== 0 ? 'crash' : 'nosummary') : fail > 0 || rc !== 0 ? 'red' : 'green',
      out,
    });
  }
}

let expReport = null;
if (!NO_RUN && hitsToJudge.length > 0 && judge) {
  // ★ 判据复用既有判定器（★ 不新造第二把尺）；`node_label` 由 DSL 给，缺了用 id
  // ★ 2026-10-23：入参换成 `hitsToJudge` —— 证据仍作数的那几条不进判定器（见 ②.5）
  expReport = await judge(ROOT, hitsToJudge.map(({ node_id, node_label, expectation }) => ({ node_id, node_label, expectation })));
}

/** ★ Java ②：测试文件 → 全限定类名（与 verify_project.ts#javaTestClassOf 同款映射——改一处同步另一处） */
function javaTestClassOfForBaseline(rel) {
  const m = rel.replace(/\\/g, '/').match(/^src\/test\/java\/(.+)\.java$/);
  return m ? m[1].replace(/\//g, '.') : rel;
}

// ════════════════════════════════════════════════════════════════════
// ⑤ 输出 / 退出码
// ════════════════════════════════════════════════════════════════════
const badTests = testRuns.filter((r) => r.kind === 'red' || r.kind === 'crash');
const redExps = (expReport?.items ?? []).filter((i) => i.verdict === 'fail');
// ★★ 2026-10-22（A3）：项目级检查也是判据之一 —— 它 FAIL 就是这次真的有红（不是附录）。
// ★ 2026-10-31：`gitBroken` 的**唯一定义**已上移到改动集那段（见上），这里不再重算。
const red = gitBroken || badTests.length > 0 || redExps.length > 0 || (designCheckRun !== null && designCheckRun.rc !== 0);
/**
 * ★★ 2026-10-22：`nothingHit` 必须只看【精准命中】（现在只有一档：真声明了 `touches` 并命中，
 * 或改的就是它自己）—— 把"没写 touches"混进来会让这条读数永远 false，它就死了。
 * ★ 0.12：git 失败时 `changed` 是**空的但不可信** ⇒ 不许落到这一支（那是"验了但没命中"的语义）。
 */
const nothingHit = !gitBroken && expHits.length === 0 && testPreciseHits.length === 0;

// ★★ 0.12 硬要求③：统计型输出必须带分母 ——「验了 N / 跳过 M / 改动集 K」同时给
const verifiedTests = NO_RUN ? 0 : testRuns.length;
const verifiedExps = expReport?.checked ?? 0;
const verified = verifiedTests + verifiedExps;
const skippedTests = NO_RUN ? testHits.length : 0;
// 没判的期望：--no-run 全部没跑；否则 = 证据仍作数（reuseNodes）+ 判定器不可用（没 build）
const skippedExps = NO_RUN ? hitsToJudge.length : reuseNodes.size + (judge ? 0 : hitsToJudge.length);
const skipped = skippedTests + skippedExps;
/** 覆盖数 / 未覆盖数（★ 二者恒 `C+U=K`；`gitBroken` 时都是 `null` = 没算，不是 0） */
const coveredCount = uncovered === null ? null : changed.length - uncovered.length;
const uncoveredCount = uncovered === null ? null : uncovered.length;
/** 一行读数：**分子与分母同时给**（只给分子等于没验） */
const denomLine =
  `改动集 ${changed.length} 个文件 · 覆盖 ${coveredCount ?? '没算'} 个 · 未覆盖 ${uncoveredCount ?? '没算'} 个` +
  ` · 验了 ${verified} 项（测试 ${verifiedTests} 支 + 期望 ${verifiedExps} 条）` +
  ` · 跳过 ${skipped} 项（测试 ${skippedTests} 支 + 期望 ${skippedExps} 条）`;

// ★ 先把 scope 算出来：文本与 --json 必须**同源**（两套读数迟早不一致）
const snapRan = [];
for (const r of testRuns) snapRan.push(`test:tests/${r.file}`);
for (const it of (expReport?.items ?? [])) snapRan.push(`contract:${it.node_id}`);
const snapInherited = (snapPlan?.inherit ?? []).map((e) => e.id);
// ★ 去重（id+reason）：账本里"整批不可判"与 widen 那一行常是同一句话，
//   重复两遍会让"未判定 2"读成"两条不同的东西"。
const snapUndetermined = (() => {
  const raw = [
    ...(snapPlan?.undetermined ?? []),
    ...(snapWiden ? [{ id: '(全部)', reason: snapWiden.reason }] : []),
    ...(snapLoad.status !== 'ok' && !snapWiden ? [{ id: '(基线)', reason: snapLoad.reason }] : []),
  ];
  const seen = new Set();
  return raw.filter((u) => {
    const k = String(u.id) + '\u0000' + String(u.reason);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
})();

// ★★ 2026-11-08：**"这次省了多少"** —— 常驻读数，数据全部取自已有的
//   `snapInherited`（判定层继承下来的条目）与 `snapRan`（本次实跑），
//   **不引入任何新的判定口径**（省 = 没跑但结论仍有效，就是这么个数）。
const savedLine = (() => {
  if (snapPlan && (snapPlan.state === 'no-evidence' || snapPlan.state === 'empty-observes')) {
    // ★ 第⑬项第四刀：白名单外 ⇒ 不再全跑 ⇒ 节省读数改为真实口径（不再是"不适用"）
    if (!noEvidenceWiden) return '节省：**白名单外 no-evidence** ⇒ 未扩大全跑（按改动触达继承判定；该文件的契约覆盖待建）';
    return '节省：**不适用**（白名单文件变更 ⇒ 无证据/无观察面 ⇒ 本次全跑，没有任何东西被继承）';
  }
  if (snapWiden) return '节省：**无**（本次扩大 = 全跑）';
  const inhTests = snapInherited.filter((id) => String(id).startsWith('test:tests/')).length;
  const inhContracts = snapInherited.length - inhTests;
  const ranTests = snapRan.filter((id) => String(id).startsWith('test:tests/')).length;
  const ranContracts = snapRan.length - ranTests;
  const total = snapInherited.length + snapRan.length;
  if (NO_RUN) {
    return `节省：—（--no-run：本次没跑任何测试/契约；证据 ${total} 条中 ${snapInherited.length} 条本可继承，但**不作数**）`;
  }
  return (
    `节省：证据 ${total} 条 ⇒ 继承 ${snapInherited.length}（等效跳过 ${inhTests} 个测试文件 + ${inhContracts} 条契约）` +
    ` · 实跑 ${snapRan.length}（测试 ${ranTests} + 契约 ${ranContracts}）`
  );
})();
if (!JSON_OUT) console.log('   ' + savedLine);

if (JSON_OUT) {

  console.log(JSON.stringify({
    changed,
    // ★★ 0.12：改动集**怎么来的、可不可信**必须能机读 —— `ok:false` ⇒ 这次什么都没验（非零退出）
    git: { ok: !gitBroken, errors: gitErrors, head_missing: gitInfo.headMissing, source: named.length > 0 ? 'argv' : 'git' },
    // ★★★ 2026-11-03：改动集「权威是谁 / 本次用的是什么 / 为什么」—— 机读自报，终结「两套并存而无人知道」
    change_source: changeSourceBlock(),
    // ★★ 0.12 硬要求③：分母（验了 / 跳过 / 改动集）
    // ★ 已验证状态基线：**实跑 / 继承 / 未判定 + 波及规模**（与文本那一行同源，避免两套读数）
    verified_scope: {
      ran: snapRan,
      inherited: snapInherited,
      undetermined: snapUndetermined,
      partial: true,
      widen: snapLoad && snapWiden ? snapWiden.reason : null,
      saved: savedLine,
      drift: Array.isArray(drift) ? drift : drift === null ? null : undefined,
      impact: impact && impact.ok ? { files: impact.files.size, symbols: impact.symbols.size, calls: impact.calls, ms: tImpactMs } : null,
      impact_error: impact && impact.ok === false ? impact.reason : undefined,
      // ★★★ T-#INC-VERIFY：impact 选量接线（三集合并：touches ∪ 契约 path ∪ impact）
      impact_selection: {
        ok: impact ? impact.ok : null,
        available: !IMPACT_UNAVAILABLE,
        union: 'touches ∪ expectation.path ∪ impact(changed)',
        impact_files: impact && impact.ok ? impact.files.size : null,
        added_contracts: impactAdded.contracts,
        added_tests: impactAdded.tests,
        full_fallback: impactAdded.fullFallback,
        reason: IMPACT_UNAVAILABLE
          ? (impact && impact.ok === false ? impact.reason : 'impact 模块未加载')
          : '影响关系可信 ⇒ 三集合并选量',
      },
    },
    denominator: {
      changed: changed.length,
      // ★★★ 2026-10-31：**覆盖 / 未覆盖**必须进分母（`C+U=K`）—— 「改了 K 个文件」不等于
      //   「判过 K 个文件」；只给 K 会让读端把"没覆盖"读成"没影响"（0.12 ③）。
      covered: coveredCount,
      uncovered: uncoveredCount,
      verified,
      skipped,
      verified_tests: verifiedTests,
      verified_expectations: verifiedExps,
      skipped_tests: skippedTests,
      skipped_expectations: skippedExps,
    },
    /**
     * ★★★ 2026-10-31：**未覆盖清单**（改动集里既无契约 `path` 命中、也无测试 `touches` 命中的文件）。
     * ★ `null` = **没算**（`git.ok=false`：改动集不可信）—— 与 `[]`（算了、一个都没有）必须能分开读。
     * ★ 它**不是闸**：U>0 **不判红**（覆盖面是存量状况，不是"这次改坏了"）。
     */
    uncovered,
    // ★★★ 2026-10-22（t354 剩余缺口②）：**补 `why`** —— 它是每条契约唯一的人话摘要
    //   （`text` 只是"kind + 路径 + 符号"的形状描述，读不出"为什么要有这一条"）。
    //   ★ t354 的断言要"每条都带 node_id + **摘要** + path"，而旧输出里根本没有摘要 —— 那不是断言太严，
    //     是**输出缺一列**（补输出，不是把断言改松）。
    expectations: expHits.map((h) => ({
      node_id: h.node_id,
      kind: h.expectation.kind,
      paths: h.paths,
      text: h.text,
      why: typeof h.expectation.why === 'string' ? h.expectation.why : '',
    })),
    // ★★ `kind` 必须输出：`touches`（声明命中）与 `self-changed`（改的就是它自己）是两个来源。
    tests: testHits.map((c) => ({ file: c.file, touches: c.touches, kind: c.kind ?? 'touches' })),
    tests_precise: testPreciseHits.length,
    // ★ 没写 `touches` 的测试 —— **不是"没验"**（「测试」门全跑），只是内环无法归因（带分母）
    tests_no_touches: noTouches.length,
    tests_total: testFiles.length,
    // ★★★ 2026-10-23（选量）：`evidenceFreshness` 的读数 —— `skip` = 已有证据仍作数 ⇒ 这次**没判**。
    //   ★ `null` = 没算（`--no-reuse` 或 dist 里没有 `planEvidenceRerun`）—— 与“算了但一条都没复用”必须能分开读。
    evidence_plan: evidencePlan
      ? {
          skipped: evidencePlan.skip.length,
          rerun: evidencePlan.rerun.length,
          unknown: evidencePlan.unknown.length,
          skip: evidencePlan.skip.map((i) => ({ node_id: i.node_id, card_id: i.card_id, freshness: i.freshness, covers: i.covers.length, why: i.why })),
          rerun_items: evidencePlan.rerun.map((i) => ({ node_id: i.node_id, card_id: i.card_id, freshness: i.freshness, why: i.why })),
        }
      : null,
    // ★ 与 `expectations`（第②步的**命中集**）刻意分开：命中 ≠ 要判，差值就是上面 `skip` 那些
    judged: hitsToJudge.map((h) => h.node_id),
    ran: {
      tests: testRuns.map((r) => ({ file: r.file, rc: r.rc, tests: r.tests, pass: r.pass, fail: r.fail, kind: r.kind, ms: r.ms })),
      expectations: expReport ? { checked: expReport.checked, passed: expReport.passed, failed: expReport.failed, unsupported: expReport.unsupported } : null,
    },
    nothingHit,
    // ★★ 2026-10-22（A3）：`null` = **这次不该跑它**（不是"跑了没红"）—— 两者必须能分开读。
    design_check: designCheckHit
      ? {
          why: designCheckWhy,
          ran: designCheckRun !== null,
          rc: designCheckRun?.rc ?? null,
          pass: designCheckRun?.pass ?? null,
          fail: designCheckRun?.fail ?? null,
          pending: designCheckRun?.pending ?? null,
          checked: designCheckRun?.checked ?? null,
          ms: designCheckRun?.ms ?? null,
        }
      : null,
    red,
    noRun: NO_RUN,
  }));
process.exit(red ? 1 : 0);
}

// ★★★ 结论**一行在最上面**（★ 不许让人翻 28 行才看到它）
// ★★ 0.12：**git 失败必须排在最前面** —— 它不是"没命中"，是"改动集根本没取到"（改前这里会落到"全绿"）
const verdict = gitBroken
  ? `★ 没验：git 读不到改动集（${gitErrors.length} 条错误）⇒ 非零退出（这不是绿，也不是"没改"）`
  : red
    ? `★ 有红：${badTests.length} 支测试红/崩 · ${redExps.length} 条契约期望 fail`
    : nothingHit
      ? '★ 没验：命中 0 条契约 / 0 支测试（★ 这不是绿）'
      : NO_RUN
        ? `★ 只算集合（--no-run）：命中 ${expHits.length} 条契约 / ${testHits.length} 支测试（★ 一个都没跑）`
        : `★ 全绿：跑了 ${testRuns.length} 支测试 / ${hitsToJudge.length} 条期望` +
          (reuseNodes.size ? `（另 ${reuseNodes.size} 条已有证据仍作数 ⇒ 没重判）` : '');
console.log(`${verdict}`);
// ★ 分母：命中集是"分子"，跳过集是"分母的另一半" —— 两者一起给才算读过（0.12 ③）
console.log(`  （${denomLine} · 命中契约 ${expHits.length} 条 · 命中测试 ${testHits.length} 支${NO_RUN ? ' · --no-run：只算不跑' : ''}）`);
{
  const cs = changeSourceBlock();
  console.log(`  ★ 改动集来源：权威 = ${cs.authority} ｜ 本次用 = ${cs.used}（${cs.why}）`);
}
if (gitBroken) {
  console.log('\n★ git 错误（改动集不可信 ⇒ 本次**一个判据都没跑**）：');
  for (const e of gitErrors) console.log(`   · ${e}`);
  console.log('   ★ 出口：① 在 git 仓库里跑（`git rev-parse --is-inside-work-tree` 要成功）；② 或显式点名文件：`node scripts/verify-changed.mjs <文件…>`（不经 git ⇒ 可信）。');
}
if (gitInfo.headMissing && !gitBroken) {
  console.log('   ★ 注：`git diff HEAD` 读不到 HEAD（全新仓还没提交）⇒ 改动集只用 `git diff` + 未跟踪（**可能漏 staged**）。');
}

console.log(`\n★ 改动文件：${changed.length} 个`);
for (const f of changed) console.log(`   · ${f}`);

console.log(`\n★ 命中契约：${expHits.length} 条期望`);
for (const h of expHits) {
  console.log(`   · ${h.node_id}  ←  ${h.text}   [path: ${h.paths.join(' , ')}]`);
  // ★ 摘要另起一行：它是给人判断"这条契约该不该改"用的，挤在同行会把路径挤没
  if (typeof h.expectation.why === 'string' && h.expectation.why.trim()) console.log(`       摘要：${h.expectation.why}`);
}
if (expHits.length === 0) console.log('   （无：没有任何 expectation 的 path 命中改动文件）');

// ★★★ 2026-10-23（选量）：命中之后**哪些不判** —— 这一节是 `evidenceFreshness` 的**唯一可见读数**
console.log(
  `\n★ 证据复用（evidenceFreshness）：复用 ${evidencePlan?.skip.length ?? 0} 条（不重判）· 需重判 ${hitsToJudge.length} 条` +
    `· 其中不知道（无代码指纹）${evidencePlan?.unknown.length ?? 0} 条`,
);
for (const i of evidencePlan?.skip ?? []) {
  console.log(`   ✓ 复用 ${i.node_id}（${i.freshness} · covers ${i.covers.length}）  ${i.why}`);
}
for (const i of evidencePlan?.rerun ?? []) {
  console.log(`   ✗ 重判 ${i.node_id}（${i.freshness}）  ${i.why}`);
}
if (evidencePlan === null) {
  console.log('   （没算：`--no-reuse` 或 dist 里没有 `planEvidenceRerun` ⇒ 本次全部按旧行为重判）');
} else if (evidencePlan.skip.length === 0 && expHits.length > 0) {
  console.log('   （一条也没复用：命中的卡要么没证据，要么证据已陈旧/没指纹 ⇒ 这次省不了）');
}

console.log(`\n★ 命中测试：${testHits.length} 支`);
for (const c of testHits) console.log(`   · ${c.file}   （${c.why}）`);
if (testHits.length === 0) console.log('   （无：没有测试声明 touches 命中改动文件）');

/**
 * ★★★ 2026-10-31：**未覆盖文件**（本节就是"未被验证 ≠ 没影响"的唯一可见读数）
 * ★ 单独一节 + 一行总述 + 逐条列（显眼），但**不进退出码**（见 ③.7 那段论证）。
 */
if (uncovered === null) {
  console.log('\n★ 未覆盖文件：**没算**（改动集不可信 ⇒ 见上面的 git 错误；这不是"一个都没有"）');
} else if (uncovered.length === 0) {
  console.log(`\n★ 未覆盖文件：0 / ${changed.length} 个（改动集里每个文件都有契约或 touches 覆盖）`);
} else {
  console.log(`\n★ 未覆盖文件：${uncoveredCount} / ${changed.length} 个`);
  console.log(
    `   ★ 改动集 ${changed.length} 个文件里有 ${uncoveredCount} 个没有任何契约/测试覆盖 ⇒ ` +
      `这些文件本次改动**未被验证**（不是"没影响"）`,
  );
  for (const u of uncovered) console.log(`      ✗ ${u.file}\n         ${u.why}`);
  console.log(
    '   ★ 出口：① 把该文件写进某节点的 `expectations[].path`（契约）；② 让观察它的测试头注声明 `touches:`。' +
      '★ 本节**不判红**（覆盖面是存量状况，不是"这次改坏了"）。',
  );
}
if (noTouches.length > 0) {
  // ★ 带分母：「34 个测试文件里 29 个没声明」不等于「29 个没验」—— 它们仍由「测试」门全跑。
  console.log(
    `\n★ 未声明 \`touches\` 的测试：${noTouches.length} / ${testFiles.length} 个` +
      '（★ 它们仍由「测试」门全跑；只是内环**无法把改动归因**到它们）',
  );
}

console.log(
  `\n★ 项目级检查（design:check）：${designCheckHit ? designCheckWhy : '不跑（改动没碰设计册，也没碰它自己）'}`,
);
if (designCheckRun) {
  const tag = designCheckRun.rc === 0 ? '✓' : '★ 有红';
  console.log(
    `   ${tag}  通过 ${designCheckRun.pass ?? '?'} · 不通过 ${designCheckRun.fail ?? '?'} · 进行中 ${designCheckRun.pending ?? '?'}（共 ${designCheckRun.checked ?? '?'} 条）  ${(designCheckRun.ms / 1000).toFixed(1)}s`,
  );
  if (designCheckRun.rc !== 0) console.log(designCheckRun.out.split('\n').slice(-15).join('\n'));
} else if (designCheckHit && NO_RUN) {
  console.log('   （--no-run：只算不跑）');
}

console.log(`\n★ 实际跑了：${NO_RUN ? 0 : testRuns.length} 支测试 / ${NO_RUN ? 0 : hitsToJudge.length} 条期望`);
for (const r of testRuns) {
  const tag = r.kind === 'red' ? `★ 有红（FAIL=${r.fail}）` : r.kind === 'crash' ? `★ 崩（exit=${r.rc}）` : r.kind === 'nosummary' ? '○ 无汇总' : '✓';
  console.log(`   ${tag}  ${r.file}  用例 ${r.pass ?? '?'}/${r.tests ?? '?'} · fail ${r.fail ?? '?'}  ${(r.ms / 1000).toFixed(1)}s`);
}
if (expReport) {
  console.log(
    `   契约：pass ${expReport.passed} · fail ${expReport.failed} · unsupported ${expReport.unsupported}（checked ${expReport.checked}）`,
  );
  for (const it of expReport.items.filter((i) => i.verdict !== 'pass').slice(0, 8)) {
    console.log(`   ${it.verdict === 'fail' ? '✗' : '○'} ${it.node_id}  ${describeShort(it)}  —— ${String(it.detail).split('\n')[0]}`);
  }
} else if (expHits.length > 0 && !NO_RUN) {
  console.log('   ★ 契约**只列未判**：dist 里没有 `judgeExpectations`（先 `npm run build`）');
}

function describeShort(it) {
  try {
    return describe(it.expectation);
  } catch {
    return it.expectation?.kind ?? '?';
  }
}
function describe(e) {
  return e.kind === 'edge-exists' || e.kind === 'edge-absent' ? `${e.kind} ${e.from} ${e.kind === 'edge-exists' ? '→' : '⇸'} ${e.to}` : `${e.kind} ${e.path}${e.symbol ? ` :: ${e.symbol}` : ''}`;
}

if (nothingHit) {
  console.log(
    '\n★★ 命中 0 ⇒ **本次增量没有覆盖任何测试、任何契约**（改了，但没有判据观察这件事）。' +
      '\n   两条可查的出口：① 该文件是否该进某节点的 `expectations[].path`（契约没写到它）；' +
      '\n   ② 观察它的测试是否该在头注声明 `touches:`（内环才归因得到它）。' +
      '\n   ★ 这不等于通过：全量结论看 `npm run verify`（门清单 = `scripts/verify.mjs#GATES`，含「测试」门全跑 `tests/`）。',
  );
}

// ★ 崩/红的原文（★ 与「测试」门同一条纪律：只打这些）
for (const r of badTests) {
  console.log(`\n──── ${r.file}（exit=${r.rc}）────`);
  console.log(r.out.split('\n').slice(-20).join('\n'));
}
  // ════════════════════════════════════════════════════════════════════
// ★ VerifiedSnapshot：实跑 / 继承 / 未判定（**带分母**，不许只报"选中 N 个全绿"）
// ════════════════════════════════════════════════════════════════════

if (!JSON_OUT) {
  console.log('\n── 已验证状态基线（VerifiedSnapshot）──');
  console.log(`   基线：${snapLoad.status === 'ok' ? `可用（${snapLoad.snapshot.entries.length} 条证据，${snapLoad.snapshot.at}）` : `${snapLoad.status} —— ${snapLoad.reason}`}`);
  if (snapWiden) console.log(`   ★ 扩大范围：${snapWiden.reason}`);
  if (snapPlan && snapPlan.state) console.log(`   计划状态：${snapPlan.state}${snapPlan.note ? ` —— ${snapPlan.note}` : ''}`);
  // ★ 三个数一起给（只给一个等于没说）：运行器会跑几个 / 索引能看到几个 / 形态扫描多出几个
  console.log(
    `   应验证对象：运行器枚举 ${testsOnDisk ?? '没算'} 个 · 索引可见 ${testsIndexed ?? '没算'} 个` +
      (testObjExtra && testObjExtra.length > 0
        ? ` · 形态扫描多出 ${testObjExtra.length} 个（运行器不跑，不计入）：${testObjExtra.slice(0, 3).join(', ')}${testObjExtra.length > 3 ? ' …' : ''}`
        : ' · 形态扫描多出 0 个'),
  );
  if (Array.isArray(drift)) console.log(`   内容指纹交叉核对：漂移 ${drift.length} 个代码文件（声明改动 ${changed.length} 个）`);
  else if (drift === null) console.log("   内容指纹交叉核对：**不可用** ⇒ 改动集不可信");
  if (impact && impact.ok) console.log(`   波及集合：文件 ${impact.files.size} · 符号 ${impact.symbols.size} · diffImpact 调用 ${impact.calls} 次 · ${tImpactMs}ms（O(改动数)）`);
  else console.log(`   波及集合：**不可用** —— ${impact && impact.ok === false ? impact.reason : "模块未加载"}`);
  // ★★★ T-#INC-VERIFY：三集合并选量的显式读数（选量 = touches ∪ 契约 path ∪ impact）
  if (IMPACT_UNAVAILABLE) {
    console.log(`   ★ 选量（三集合并）：影响关系不可信 ⇒ **回落全量**` +
      `（新增全量测试 ${impactAdded.fullFallback ? '是' : '否'}；不假绿，不静默按 touches 窄集收工）`);
  } else {
    console.log(`   选量（三集合并）：touches ∪ 契约 path ∪ impact ⇒ ` +
      `impact 波及 ${impactFiles.size} 文件 · 追加契约 ${impactAdded.contracts} 条 · 追加测试 ${impactAdded.tests} 支`);
  }
  console.log(`   实跑 ${snapRan.length} · 继承 ${snapInherited.length} · 未判定 ${snapUndetermined.length} · 范围：局部（内环，不是全仓）`);
  if (snapInherited.length) {
    console.log(`   继承（未变 + 上次 pass + 影响关系可信）：`);
    for (const id of snapInherited.slice(0, 8)) console.log(`     · ${id}`);
    if (snapInherited.length > 8) console.log(`     · …另有 ${snapInherited.length - 8} 条`);
  }
  if (snapUndetermined.length) {
    console.log('   未判定（**不是通过**）：');
    for (const u of snapUndetermined.slice(0, 6)) console.log(`     ○ ${u.id} —— ${u.reason}`);
    if (snapUndetermined.length > 6) console.log(`     ○ …另有 ${snapUndetermined.length - 6} 条`);
  }
}

// 写回基线：只有"真跑过"的条目带本次 verdict；继承的条目原样搬运（证据时点不变）
// ★★ 本次**一条都没真跑**（--no-run / 命中 0）⇒ **不写基线**：
//   写一份 0 条证据的"基线"等于把"什么都没验"固化成可继承的状态（下一次会读到"基线可用"）。
if (VS && snapRan.length > 0) {
  try {
    const hashes = VS.hashProjectFiles ? VS.hashProjectFiles(ROOT) : {};
    // ★★ 2026-11-08：基线写回必须**合并**，不能整份覆盖。
    //   实测事故：内环只跑受影响子集，若只写"本次实跑"，下一次就没有东西可继承
    //   —— 基线从 15 条被一次窄跑冲成 1 条（继承能力被自己的写回吃掉）。
    //   规则：
    //     · 本次**继承**下来的条目原样保留（它的证据仍然有效）；
    //     · 本次**实跑/重验**的条目覆盖同名条目（新结论优先）；
    //     · `undetermined` 的旧条目**丢弃**（不知道它还成不成立 ⇒ 不许留下来冒充证据）。
    const prevById = new Map();
    if (snapLoad && snapLoad.status === "ok") for (const e of snapLoad.snapshot.entries) prevById.set(e.id, e);
    // ★★ 2026-11-09 修（证据被侵蚀）：`kept` 原先只收 `plan.inherit` —— 而 `widen` / 改动集不可信时
    //   `plan.inherit` 恰是**空的** ⇒ 只跑了 3 支就把其余 27 条证据**全丢了**（实测基线 30 → 3）。
    //   正确口径：**本次没重跑的条目一律保留**（它们没被推翻，只是这次没判）；只有
    //   ①本次真跑了的（覆盖/失败撤销）②基线里已被删除的，才动。
    const rerunIds = new Set(testRuns.map((r) => `test:tests/${r.file}`));
    const kept = [...prevById.values()].filter((e) => !rerunIds.has(e.id));
    const entries = [...kept];
    const dropThenPush = (e) => { const i = entries.findIndex((x) => x.id === e.id); if (i >= 0) entries.splice(i, 1); entries.push(e); };
    const nowIso = new Date().toISOString();
    // ★★ 第⑬项 Java ②（lead 抓到的假绿）：**基线写回的 command/observes 分源**——
    //   node 系：command=`node --import tsx tests/<f>`、observes 走 TESTS 前缀；
    //   Java 系：command=`mvn test -Dtest=<类>`（真跑的那条命令）、observes=文件自身（+deriveObserves
    //   的 Java import 边推导）。修复前 command 硬编码 node 模板 ⇒ 基线上的 pass 是"看起来像跑过"的假绿。
    const testPrefix2 = isJavaProject ? '' : 'tests/';
    // ★★ 第⑬项 Java ②（按**文件扩展名**分 command，不按项目类型）：主仓视角下委托的 .java 条目
    //   command 必须是 `mvn test -Dtest=<类>`（真跑的那条），不能因 isJavaProject=false 掉进 node 模板
    //   （lead 抓的假绿：unsupported 条目 command=node --import tsx —— runner.run 真跑的 mvn 结果
    //   被 node 模板 command 覆盖 ⇒ 证据链断裂）。
    const cmdOf = (label) =>
      label.endsWith('.java')
        ? `mvn test -Dtest=${javaTestClassOfForBaseline(label)}`
        : `node --import tsx ${label}`;
    for (const r of testRuns) {
      const verdict = r.kind === 'red' || r.kind === 'crash' ? 'fail' : r.kind === 'nosummary' ? 'pending' : r.pass > 0 || r.tests > 0 ? 'pass' : 'unsupported';
      // ★ Java ② 收口：declaredSymbols/declaredTouches 读**文件** ⇒ 必须绝对路径（node 系的
      //   `${TESTS}/${f}` 本就是绝对；Java 系的 r.file 是仓库相对 ⇒ join ROOT）。修复前 Java 系传
      //   相对路径 ⇒ 读文件恒 null ⇒ observes 只剩 deriveObserves 一条腿（当时又是旧数据 ⇒ 空）。
      // ★ 按扩展名分源（同 cmdOf）：.java 条目（主仓视角委托）absForFacts=join(ROOT)、deriveObserves=仓库相对
      const isJavaEntry = r.file.endsWith('.java');
      const absForFacts = isJavaProject || isJavaEntry ? path.join(ROOT, r.file) : `${TESTS}/${r.file}`;
      dropThenPush({
        id: `test:tests/${r.file}`,
        kind: 'test',
        verdict,
        command: cmdOf(r.file),
        at: nowIso,
        observes: ((declaredTouches(absForFacts) ?? []).length
          ? declaredTouches(absForFacts)
          : VS.derivedObservesOf(ROOT, isJavaProject || isJavaEntry ? r.file : `${TESTS}/${r.file}`)),
        symbols: (declaredSymbols(absForFacts) ?? []),
      });
    }
    for (const it of (expReport?.items ?? [])) {
      dropThenPush({
        id: `contract:${it.node_id}`,
        kind: 'contract',
        verdict: it.verdict === 'pass' ? 'pass' : it.verdict === 'fail' ? 'fail' : it.verdict === 'unsupported' ? 'unsupported' : 'pending',
        command: `node scripts/judge-all.mjs（契约 ${it.node_id}）`,
        at: nowIso,
        observes: [...new Set((pathsOf(it.expectation) ?? []).map(norm))],
        symbols: [it.expectation?.symbol, it.expectation?.from, it.expectation?.to, it.expectation?.target].filter((x) => typeof x === 'string'),
      });
    }
    for (const e of (snapPlan?.inherit ?? [])) entries.push(e);
    const files = hashes;
    const snap = {
      schema: 1,
      at: nowIso,
      content: { version: VS.contentVersion(files), files },
      graph: VS.graphVersion(ROOT),
      entries,
      scope: {
        ran: snapRan,
        inherited: snapInherited,
        undetermined: snapUndetermined,
        // ★ 内环只验受影响子集 ⇒ **不得**被读成"全仓已验证"
        partial: true,
        covered_files: [...new Set(entries.flatMap((e) => e.observes ?? []))].sort(),
      },
    };
    VS.writeVerifiedSnapshot(ROOT, snap);
    if (!JSON_OUT) console.log(`   已写回基线：${entries.length} 条证据（${VS.SNAPSHOT_REL}）`);
  } catch (e) {
    if (!JSON_OUT) console.log(`   ★ 写回基线失败（不影响本次判定）：${String(e && e.message ? e.message : e).slice(0, 120)}`);
  }
}

process.exit(red ? 1 : 0);
