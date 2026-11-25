#!/usr/bin/env node
/**
 * 「文档与事实一致」五件套 —— 让 `npm run verify` 绿 ⇔ 全仓绿。
 * （2026-11-17 由四件套扩成五件套：`docs/todo.md` 降为派生视图后，"视图是否最新"也必须是门 ——
 *   否则手改视图 / 引擎改了没重生成，在 `verify` 里是**看不见的**。）
 *
 * ## 为什么需要它（2026-10-31 第六轮独立复核抓到的洞）
 * `lint:prose` / `gen-facts:check` / `manifest:check` / `cognition:check` 这四个断言式检查
 * 当时**都不在任何门里**：`GATES` 九项没有它们、`ci.yml` 只跑 build+verify、`pre-commit` 只跑 gen_agents。
 * 实测后果：`npm run verify` 报全绿的同时，其中三个是 **EXIT=1**（FACTS 说 55 工具而实为 44、
 * MANIFEST 有 27 个未登记条目、COGNITION.txt 根本不存在）。
 * ⇒ **verify 绿 ≠ 仓绿**。这个脚本把四个并成一道门，让"总门绿"重新等于"这些东西都验过"。
 *
 * ## 口径
 * · 每个子检查**原样执行**（`npm run <script>`，走 package.json 的唯一定义，不在这里重实现）；
 * · 任一非 0 ⇒ 本门非 0（逐个打印，先失败先看见）；
 * · **子检查缺失（script 不存在）⇒ 也算红**（0.12：读不到 ≠ 通过）。
 *
 * ## ★★ T-#INC-VERIFY：子检查级继承（只对只读子检查 lint:prose / manifest:check）
 * 与总门的门级继承同一套 lib（`scripts/lib/verify_inheritance.mjs`）、同一个 store
 * （`.agent-io/scratch/verify-inheritance.json`）。输入指纹变 ⇒ 重跑；未变 ⇒ 复用上次结论并
 * 打「⟲ 继承 + 上次分母」；上次 FAIL 永不继承。`AGENT_IO_VERIFY_INHERIT=0` 可关。
 */
import { spawnSync } from 'node:child_process';
import { loadStore, planGate, recordGate, DEFAULT_INPUTS } from './lib/verify_inheritance.mjs';

const ROOT = process.cwd();
const INHERIT = process.env.AGENT_IO_VERIFY_INHERIT !== '0';

// ★★★ 2026-11-25（P3 施工批 · Main 裁① 统一车道政策）：六子检查按**数据源归属**分两组。
//   · `--snapshot` 入库快照对账（lint:prose / manifest:check）：读盘上入库文档/卷表，CI 可判 ⇒ 车道内 inLane。
//   · `--derived` 派生现算（gen-facts / cognition / ledger / doc:check）：依赖 cache.db 等派生
//     现算落盘，CI clean-clone 缺派生 ⇒ 车道外 offLane 单列（本地全量 laneSet=null 仍强制核）。
//   缺省（不带 mode）= 六件全跑，向后兼容；逐条判据语义不变，只按数据源分桶。
const GROUPS = {
  snapshot: [
    ['lint:prose', '散文当结构 / 写死计数（规则 A–E）'],
    ['manifest:check', 'MANIFEST 卷表与 `.agent-io/` 实际内容是否一致'],
  ],
  derived: [
    ['gen-facts:check', 'FACTS.json 与 README 的数字是否与实际一致'],
    ['cognition:check', 'COGNITION.txt 是否最新（枚举源必须读 `design/*.dsl.json`）'],
    // ★★ 2026-11-17（T-#LEDGER-ENGINE L3）：`docs/todo.md` 从**手写真相**降为**派生视图** ⇒
    //   "视图是不是最新"必须有门，否则手改视图（或引擎改了没重生成）在 `verify` 里是**看不见的**。
    //   退出码是三态（0 最新 / 3 陈旧或缺失 / 1 坏），本聚合器只关心"非 0 ⇒ 红"。
    ['ledger:check', 'docs/todo.md 视图是否最新（引擎现算 vs 盘上 vs git HEAD 三向对账）'],
    ['doc:check', '文档投影块是否最新（引擎现算 vs 盘上 vs git HEAD 三向对账；手改生成区/stale/自洽失败非绿）'],
  ],
};
const MODE = process.argv.includes('--derived') ? 'derived'
  : process.argv.includes('--snapshot') ? 'snapshot'
  : 'all';
const CHECKS = MODE === 'all' ? [...GROUPS.snapshot, ...GROUPS.derived] : GROUPS[MODE];

const SUBCHECK_SCRIPT = {
  'lint:prose': 'scripts/lint-prose-as-structure.mjs',
  'manifest:check': 'scripts/gen_manifest.mjs',
  'doc:check': 'scripts/gen_docs_view.mjs',
};

// 只读子检查的输入扩展：lint:prose 判文档散文，manifest:check 判 .agent-io 顶层，doc:check 判投影块与内核。
const SUBCHECK_INPUTS = {
  'lint:prose': ['docs', 'AGENTS.md', 'README.md'],
  'manifest:check': ['.agent-io', 'structure.domains.json'],
  'doc:check': ['docs', 'src/application/docs_view'],
};

const INHERIT_INPUTS = { ...DEFAULT_INPUTS, ...SUBCHECK_INPUTS };

let store = INHERIT ? loadStore(ROOT) : { ok: false, reason: '继承关闭', entries: {} };
let failed = 0;
let inheritedCount = 0;
let ranCount = 0;
for (const [script, what] of CHECKS) {
  // 只读子检查：inputFingerprint 需要 gate 形状；脚本名做 gate.name 即可（白名单按名字认）。
  const gate = { name: script, cmd: 'npm', args: [SUBCHECK_SCRIPT[script] ?? script], cwd: '' };
  const plan = INHERIT ? planGate(ROOT, gate, store, INHERIT_INPUTS) : { decision: 'run', reason: '继承关闭', fingerprint: null };
  let ok;
  let inherited = null;
  if (plan.decision === 'inherit') {
    inherited = plan.prior;
    ok = inherited.verdict === 'PASS';
    inheritedCount++;
  } else {
    const r = spawnSync('npm', ['run', script, '--silent'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: true, // npm 在 Windows 上是 .cmd
      maxBuffer: 32 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    ok = r.status === 0;
    if (INHERIT) {
      store = recordGate(ROOT, gate, store, { verdict: ok ? 'PASS' : 'FAIL', state: ok ? 'PASS' : 'FAIL', note: `子检查 ${script}` }, INHERIT_INPUTS);
    }
    ranCount++;
    if (!ok) printFailDetail(script, out);
  }
  if (!ok) failed++;
  const tag = inherited ? '⟲ 继承' : ok ? '✓' : '✗';
  const denom = inherited
    ? `（上次 ${inherited.verdict} · ${inherited.cases ? `${inherited.cases.unit} ${inherited.cases.pass}/${inherited.cases.total}` : '无分母'} · ran_at ${inherited.ran_at}）`
    : '';
  console.log(`  ${tag} ${script.padEnd(18)} ${what} ${denom}`);
}
if (INHERIT) {
  console.log(`  ⟲ 子检查继承：可证闭包白名单 2 个（lint:prose / doc:check；manifest:check 闭包不可静态枚举 ⇒ 恒实跑）→ 继承 ${inheritedCount} / 实跑 ${ranCount}` +
    `（派生存储 .agent-io/scratch/verify-inheritance.json，不进 git）`);
}

function printFailDetail(script, out) {
  const missing = /Missing script/i.test(out);
  console.log(
    missing
      ? `       ★ package.json 里没有 \`${script}\` 这个 script ⇒ 这个检查**不存在**（不是通过）`
      : out.split('\n').slice(-6).map((l) => `       ${l}`).join('\n'),
  );
}

const head = MODE === 'derived' ? '文档派生投影' : '文档与事实';
console.log(`  —— ${head}：${CHECKS.length - failed}/${CHECKS.length} 通过`);
process.exit(failed ? 1 : 0);
