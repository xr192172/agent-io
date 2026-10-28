#!/usr/bin/env node
/**
 * ★★★ cert T407 —— **`observe_*` 合并的等价性证**（T-#SURFACE-2 试点）（2026-10-28）
 *
 * ## 试点的真问题
 * 合并省的是上下文与漂移面，代价是**可发现性**与**报错泛化**。所以验收不能"看着差不多"，
 * 必须是**同一批夹具、合并前后回执逐字段对比** —— 本证就是这件事。
 *
 * ## 合并了什么（以及**故意不合并**什么）
 * - 合并：`observe_log` / `observe_trace` / `observe_judge` → `observe { action: log | trace | judge }`
 *   依据：**输入事实相同**（events.jsonl / 事件数组）、**判断性质相同**（只读）、**前置条件相同**（不需要设计册）。
 * - **不合并**：`observe_instrument`（插桩/还原）、`observe_proposals`（提案四层门）——
 *   它们各有自己的 `action` 命名空间**且会写盘**；合进来会撞命名空间，也会把写能力混进只读入口。
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
const actionOf = { log: 'log', 'log-default': 'log', trace: 'trace', judge: 'judge' };
let same = 0;
const diffs = [];
for (const [name, b] of Object.entries(baseline)) {
  let after = null;
  try {
    after = extractData(cli('observe', { action: actionOf[name], ...b.args }));
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
  chk(names.has('observe_instrument') && names.has('observe_proposals'), '③ `observe_instrument` / `observe_proposals` **仍在注册表**（各有 action 命名空间 + 写盘 ⇒ 故意不并）');
  const gone = ['observe_log', 'observe_trace', 'observe_judge'].filter((n) => names.has(n));
  chk(gone.length === 0 && names.has('observe'), '③-b 三个旧名字**已摘**、`observe` 在册', `残留：${gone.join(',') || '(无)'}`);
  chk(TOOL_DEFS.length === 57, '⑤ 工具数 59 → **57**（3 并 1）', `实际 ${TOOL_DEFS.length}`);
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
