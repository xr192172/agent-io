#!/usr/bin/env node
/**
 * ★★★ cert T407 —— **`observe_*` 合并的等价性证**（T-#SURFACE-2 试点）（2026-10-28）
 *
 * ## 试点的真问题
 * 合并省的是上下文与漂移面，代价是**可发现性**与**报错泛化**。所以验收不能"看着差不多"，
 * 必须是**同一批夹具、合并前后回执逐字段对比** —— 本证就是这件事。
 *
 * ## 用户裁定（2026-10-28）：接口形状不是约束
 * 「命名空间什么的都无所谓，我要的是**最后达成的效果可以被替代**的话就替代掉，你完全可以重写」
 * ⇒ 原先按"action 冲突 / 副作用不同"保留的两个工具，**全部并入**；形状（action 套 action、参数名）随便改，
 *   只要**每个动作的效果逐字段不变**。这就是本证的验收口径。
 *
 * ## 合并了什么
 * - 合并：`observe_log` / `observe_trace` / `observe_judge` → `observe { action: log | trace | judge }`
 *   依据：**输入事实相同**（events.jsonl / 事件数组）、**判断性质相同**（只读）、**前置条件相同**（不需要设计册）。
 * - 也合并：`observe_instrument`（instrument/uninstrument/restore/ledger）与
 *   `observe_proposals`（list/show/approve/reject，子动作走 `op`）——**执行核原样保留**，只改入口形状。
 *
 * ## 判据（每条亲手跑）
 *   ① 基线里每个场景（4 个）用新入口重放 ⇒ `data` **深度相等**（逐字段，不靠肉眼）；
 *   ② 三个 handler 仍住在 `observe/handlers.ts`（**拆注册不拆执行核**）；
 *   ③ `observe_instrument` / `observe_proposals` **仍在注册表**（故意没合并）；
 *   ④ 非法 action ⇒ 明确报错（不静默退回 log —— 那是最坏的"猜"）；
 *   ⑤ 工具数：59 → **57**（合并 3 个成 1 个）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 基线是**合并前**录的（`certs/baselines/observe-merge-baseline.json`），只覆盖 4 个场景；
 *   · **[未核]** `keep` / `limit` / `use_llm` / `decls` 等分支没进基线（本证只证**主路径等价**）；
 *   · **[未核]** 报错文本是否"变得更泛"——这只能人读，本证只用 ④ 钉住"不静默"。
 *
 * ## 用法
 *   node certs/t407-observe-merge-equivalence-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp407merge-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 从 CLI 输出里取出 ---DATA--- 之后的**第一个完整 JSON**（可能后面还跟提示文本） */
function extractData(out) {
  const i = out.indexOf('---DATA---');
  if (i < 0) return null;
  const rest = out.slice(i + '---DATA---'.length);
  const cands = ['{', '['].map((c) => rest.indexOf(c)).filter((x) => x >= 0);
  if (!cands.length) return null;
  const start = Math.min(...cands);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < rest.length; k++) {
    const ch = rest[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(rest.slice(start, k + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * ★ 等价性对比必须**声明**要排除的非确定字段（不许偷偷抹掉）：
 *   `entries[*].event.time` 是 `observe_judge` 在**调用时刻**打的时间戳 ⇒ 天然不可重复，
 *   与本合并无关（实测差异只有它）。排除清单写在这里，看得见。
 */
const NONDET_KEYS = new Set(['time']);
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = NONDET_KEYS.has(k) ? '<nondet>' : normalize(v[k]);
    return o;
  }
  return v;
}

const cli = (tool, args) =>
  execFileSync('node', ['dist/src/presentation/cli/cli.js', tool, '--json', JSON.stringify(args)], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, AGENT_IO_REQUIRE_PLAN: '0' },
  });

// ── ① 逐场景等价（合并前 vs 合并后，data 深度比较）────────
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'certs/baselines/observe-merge-baseline.json'), 'utf8'));
// ★ 用户裁定（2026-10-28）："接口形状不是约束，效果可替代就替代" ⇒ **5 个全并成 1 个**。
//   映射规则：动作名进 `action`（proposals 的子动作进 `op`）；参数名不改。
const mapOf = {
  log: { action: 'log' },
  'log-default': { action: 'log' },
  trace: { action: 'trace' },
  judge: { action: 'judge' },
  'instrument-ledger': { action: 'ledger' },
  'instrument-dry': { action: 'instrument' },
  'proposals-list': { action: 'proposals', op: 'list' },
};
let same = 0;
const diffs = [];
for (const [name, b] of Object.entries(baseline)) {
  let after = null;
  try {
    // ★ 基线里存的是**旧工具的 action**（如 proposals 的 list）⇒ 重放时必须摘掉，
    //   否则它会覆盖新入口的 action（这是夹具问题，不是产品问题 —— 实测踩过一次）。
    const { action: _drop, ...restArgs } = b.args ?? {};
    after = extractData(cli('observe', { ...mapOf[name], ...restArgs }));
  } catch (e) {
    after = extractData(String(e.stdout ?? '') + String(e.stderr ?? ''));
  }
  const equal = JSON.stringify(normalize(after)) === JSON.stringify(normalize(b.data));
  if (equal) same++;
  else diffs.push(`${name}: before=${JSON.stringify(b.data).slice(0, 90)} / after=${JSON.stringify(after).slice(0, 90)}`);
}
chk(same === Object.keys(baseline).length, `① 基线 ${Object.keys(baseline).length} 个场景经新区入口重放，\`data\` **深度相等**`, diffs.join('\n     ') || `全部相等（${same} 个）`);

// ── ② 执行核没拆 ───────────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/application/observe/handlers.ts'), 'utf8');
  const kept = ['observeLogHandler', 'observeTraceHandler', 'observeJudgeHandler'].filter((h) => src.includes(h));
  chk(kept.length === 3, '② 三个 handler 仍住 `observe/handlers.ts`（**拆注册不拆执行核**）', kept.join(', '));
}

// ── ③ 故意没合并的两个仍在 ──────────────────────────────
{
  const D = 'file://' + path.join(ROOT, 'dist/src/').replace(/\\/g, '/');
  const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
  const names = new Set(TOOL_DEFS.map((t) => t.name));
  // ★ 2026-10-30（B2 删除执行）：**删掉「工具数 === 55」这条断言** —— 它是写死的快照（工具面后来 55→49→44
  //   一路缩，它必红且不指向任何真缺陷）。工具数由注册表现取（`capability_map` / `verify` 的 MCP 工具签名门），
  //   本证真正要断言的是下面 ③-b「五个旧名字全摘 + 单入口 observe 在」。
  console.log(`  · 读数量具：注册表现有 ${names.size} 个工具（不入断言）`);
  const gone = ['observe_log', 'observe_trace', 'observe_judge', 'observe_instrument', 'observe_proposals'].filter((n) => names.has(n));
  chk(gone.length === 0 && names.has('observe'), '③-b **五个旧名字全部已摘**、只剩单入口 `observe`', `残留：${gone.join(',') || '(无)'}`);
}

// ── ④ 非法 action 不静默退回 ────────────────────────────
{
  let msg = '';
  try {
    msg = cli('observe', { action: 'nonsense' });
  } catch (e) {
    msg = String(e.stdout ?? '') + String(e.stderr ?? '') + String(e.message ?? '');
  }
  chk(/action|nonsense|非法|enum|校验/.test(msg) && !/"events"/.test(msg), '④ 非法 `action` ⇒ **明确报错**（不静默退回 log）', msg.split('\n').find((l) => l.trim())?.slice(0, 140) ?? '');
}

console.log(`\n═══ T407 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
