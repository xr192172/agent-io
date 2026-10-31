#!/usr/bin/env node
/**
 * 跑**全部册**的节点级判据（`design_line action=judge`），汇总成一道门。
 *
 * ## 为什么需要这个脚本（而不是直接写进 verify.mjs）
 * 判据的**唯一执行核**是 CLI 的 `design_line action=judge`；这里只做「遍历册 + 汇总 + 退出码」，
 * 不重实现判定 —— 否则就是第二把尺。
 *
 * ## 为什么它该是门（判据此前**没有任何自动门在跑**）
 * 判据是设计册对代码的断言（"这个文件必须做到 X"）。在它进 `verify` 之前：
 * 判据红了**也拦不住提交**，等于那些断言只在有人手动跑 `design_line` 时才存在
 * （★ 条数由本脚本自己打印 —— **别在这里抄数字**，抄一次漂一次）。
 * ★ 它比人**多抓**的东西很具体：改了实现使某条断言不再成立 —— `tsc` 一声不响（那是"值"不是"形状"）。
 *
 * ## 退出码
 * 任一册出现 `fail` 或 `unsupported` ⇒ 1（`unsupported` 也是失败：
 * "判不了 ≠ 通过"，见 AGENTS-RULES 0.12 与 GUIDE-GATE 四态）。
 *
 * ## ★ dist 比 src 旧 ⇒ 同样判红（**判据可能判在旧代码上**）
 * 不变量：**跑判据之前先无条件验一次 dist 新鲜度**；不新鲜就红，且一条判据都不跑。
 * · 为什么是"红"而不是"警告一句再照旧 exit 0"：整批跑在旧代码上时，`pass` 是**旧代码的读数** ——
 *   它与"判据真的成立"在输出上长得一模一样（AGENTS-RULES 0.12：失败必须与「没有」可区分）；
 * · 为什么"无条件"：只在 `unsupported > 0` 时才查（`domain/stale_verdict.ts#staleJudgeCaveat` 的不变量）
 *   漏掉最糟的一态 —— **整轮都 pass** 时恰恰不查 ⇒ "判在旧代码上"零提示；
 * · 判据实现**不另造**：委派 `src/application/observe/runtime/stale_check.ts#checkStaleBuild`
 *   （与 MCP 的 `STALE_SOURCE` 告警、`verify` 的 MCP 门同一把尺），扫 `src/` 全树，不限子目录。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.cwd();
/** 本脚本自己所在的仓 —— **尺子的出处**。与 `ROOT` 分开：`ROOT` 是**被检查的**项目 */
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'src', 'presentation', 'cli', 'cli.js');
const DESIGN_DIR = path.join(ROOT, '.agent-io', 'design');
const DATA_MARK = '---DATA---';

function features() {
  if (!fs.existsSync(DESIGN_DIR)) return [];
  return fs
    .readdirSync(DESIGN_DIR)
    .filter((f) => f.endsWith('.dsl.json'))
    .map((f) => f.slice(0, -'.dsl.json'.length))
    .sort();
}

function judgeOne(feature) {
  const payload = JSON.stringify({ project_dir: '.', feature, action: 'judge' });
  // ★ shell:false + process.execPath：路径含空格时经 cmd.exe 会被截断（见 verify.mjs 的 tsGate 注释）
  const r = spawnSync(process.execPath, [CLI, 'design_line', '--json', payload], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

  // ★★★ 2026-10-31（第四轮独立复核抓到）：原来用 `"verdict":"pass"` 数个数、用 **400 字符窗口正则**抓
  //   `fail|unsupported` 的 node_id。两个毛病：① 计数靠字符串出现次数（detail 里出现一次就多算）；
  //   ② 400 字符窗口跨条目时会**张冠李戴**（归属到隔壁节点的 id）⇒ 报出来的"哪条红了"不可靠。
  //   现在改成**读 CLI 的结构化回执**：`---DATA---` 之后是一段干净 JSON（`tally` + `items[]`）。
  //   取不到可解析的 DATA 块 ⇒ **判这一册红**（0.12：读不到 ≠ 没有），不回落成"数个数"。
  // ★ 取结构化回执：`---DATA---` 之后是**一行 JSON**，再往后可能还有 `⚠️ STALE_INDEX：…` 这类**散文警告**
  //   （实测：JSON 与 `---WARNINGS---` 之间夹着警告正文）⇒ 不能用"到下一个标记为止"的懒惰正则，
  //   必须按**括号配对**把那个顶层对象截出来（字符串里的 `{`/`}` 要跳过）。
  const dataBlock = (() => {
    const i = out.indexOf(DATA_MARK);
    if (i < 0) return null;
    const s = out.slice(i + DATA_MARK.length);
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let k = start; k < s.length; k++) {
      const ch = s[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return s.slice(start, k + 1);
      }
    }
    return null;
  })();
  let rec = null;
  if (dataBlock) {
    try {
      rec = JSON.parse(dataBlock);
    } catch {
      rec = null;
    }
  }
  if (!rec || !rec.tally || !Array.isArray(rec.items)) {
    return { feature, pass: 0, fail: 0, unsupported: 0, bad: [], ok: false, unparsed: true };
  }
  const tally = rec.tally ?? {};
  const bad = rec.items
    .filter((it) => it.verdict === 'fail' || it.verdict === 'unsupported')
    .map((it) => `${it.verdict}:${it.node_id}${it.expectation?.kind ? `(${it.expectation.kind})` : ''}`);
  return {
    feature,
    pass: tally.pass ?? 0,
    fail: tally.fail ?? 0,
    unsupported: tally.unsupported ?? 0,
    bad,
    ok: r.status === 0,
  };
}

if (!fs.existsSync(CLI)) {
  console.error(`✗ 找不到 ${path.relative(ROOT, CLI)} ⇒ 先 npm run build（本门与「MCP 工具签名」同一前提）`);
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════
// ★★★ dist 新鲜度：**无条件先判一次**（判据可能判在旧代码上 —— 见文件头那段不变量）
//   委派唯一实现 `stale_check#checkStaleBuild`（不另造一把尺）；扫 `src/` 全树。
//   读不到尺子 / 尺子抛错 ⇒ 红（0.12：读不到 ≠ 新鲜），不许跳过。
// ════════════════════════════════════════════════════════════════════
const STALE_MOD = path.join(TOOL_ROOT, 'dist', 'src', 'application', 'observe', 'runtime', 'stale_check.js');
let fresh = null;
let freshErr = '';
try {
  const mod = await import(pathToFileURL(STALE_MOD).href);
  if (typeof mod.checkStaleBuild !== 'function') freshErr = `${path.relative(TOOL_ROOT, STALE_MOD)} 里没有 checkStaleBuild 导出`;
  else fresh = mod.checkStaleBuild(ROOT);
} catch (e) {
  freshErr = `读不到/跑不了 ${path.relative(TOOL_ROOT, STALE_MOD)}：${e?.message ?? String(e)}`;
}
if (!fresh) {
  console.error(
    `✗ 无法判定 dist 是否比 src 新：${freshErr}\n` +
      '  ⇒ 判据可能判在旧代码上，本门**不敢放行**（读不到 ≠ 新鲜）。先 npm run build 再跑。',
  );
  process.exit(1);
}
/** mtime → `HH:MM:SS`（与 `stale_check#formatStaleText` 同一口径，不另造一套渲染） */
const hhmmss = (ms) => (ms > 0 ? new Date(ms).toISOString().slice(11, 19) : '缺产物');
if (fresh.stale) {
  const first = fresh.entries[0];
  console.error(
    `✗ ★ dist 比 src 旧（src ${hhmmss(first.srcMtime)} vs dist ${hhmmss(first.outMtime)}；` +
      `checkStaleBuild 报 ${fresh.entries.length}/${fresh.scanned} 个源未重建，basis=${fresh.basis}）` +
      '⇒ 判据可能判在旧代码上；先 npm run build，再跑本门。',
  );
  for (const e of fresh.entries.slice(0, 10)) {
    console.error(`     · ${e.src} → ${e.missing ? '缺产物' : `产物旧(源 ${hhmmss(e.srcMtime)} vs 产物 ${hhmmss(e.outMtime)})`}`);
  }
  if (fresh.entries.length > 10) console.error(`     · …另有 ${fresh.entries.length - 10} 个`);
  console.error('  —— 本门**一条判据都没跑**（判在旧代码上的读数没有意义；这不是通过）');
  process.exit(1);
}
if (fresh.skipped.length > 0) {
  // ★ 0.12 ③：分母两半同时给。有源读不到 ⇒ 新鲜度只验了一部分 ⇒ 不许当"dist 最新"放行
  console.error(
    `✗ dist 新鲜度没验全：扫到 ${fresh.scanned} 个手写源，其中 ${fresh.skipped.length} 个读不到` +
      `（验了 ${fresh.scanned - fresh.skipped.length} 个 ⇒ 剩下那些**可能**正比 src 旧）⇒ 这不是「dist 最新」（0.12）。`,
  );
  for (const s of fresh.skipped.slice(0, 5)) console.error(`     · 未验 ${s.src}（${s.reason}）`);
  process.exit(1);
}
console.log(`  ✓ dist 不比 src 旧（checkStaleBuild：${fresh.scanned} 个手写源均已重建，basis=${fresh.basis}）`);

const list = features();
if (!list.length) {
  // ★ 0.12：读不到册不许当"全部通过"
  console.error(`✗ ${path.relative(ROOT, DESIGN_DIR)} 下没有任何 *.dsl.json ⇒ 无法判定（这不是通过）`);
  process.exit(1);
}

let bad = 0;
let totalPass = 0;
let totalJudged = 0;
for (const f of list) {
  const r = judgeOne(f);
  totalPass += r.pass;
  const judged = r.pass + r.fail + r.unsupported;
  totalJudged += judged;
  // ★★ 2026-10-31（第四轮独立复核抓到）：原来只有**跨册求和**的「判了 0 条」守卫 ⇒
  //   **单册判据被清空**时，只要别册还有料就照绿。每册必须自己判过东西。
  const emptyBook = judged === 0;
  const isBad = r.fail > 0 || r.unsupported > 0 || !r.ok || emptyBook;
  if (isBad) bad++;
  const mark = isBad ? '✗' : '✓';
  console.log(
    `  ${mark} ${f.padEnd(22)} pass=${String(r.pass).padEnd(4)} fail=${String(r.fail).padEnd(2)} unsupported=${r.unsupported}` +
      (r.unparsed
        ? '  ← ★ CLI 回执里没有可解析的 `---DATA---` 块（读不到 ≠ 通过）'
        : emptyBook
          ? '  ← 该册一条判据都没判到（≠ 通过）'
          : ''),
  );
  for (const b of r.bad.slice(0, 5)) console.log(`       · ${b}`);
  if (r.bad.length > 5) console.log(`       · …另有 ${r.bad.length - 5} 条`);
}

// ★★★ 0.12 第 1 条：「判了 0 条」不许当「全部通过」。
//   实测过的两种死法（独立复核 2026-10-31 用临时副本复现）：
//   ① 册在盘上、但 CLI 的 dataHome 被 `AGENT_IO_HOME` 指到别处 ⇒ 看到 0 个 feature ⇒ 0 条判据 ⇒ 若只看
//      `fail>0` 就会 exit 0（**假绿**）；② 判据被人删空 ⇒ 同样 0 条 ⇒ exit 0。
//   `run-tests` 有这条断言（"0 个用例被执行"算红），本门原来没有 —— 现在补上。
if (totalJudged === 0) {
  console.error(
    `✗ 一条判据都没判到（盘上发现 ${list.length} 册：${list.join(', ')}）⇒ 这不是通过。\n` +
      `  常见原因：① \`AGENT_IO_HOME\` 指到了别的数据根 ⇒ CLI 看不到册；② 该册的判据被删空。\n` +
      `  排查：\`node dist/src/presentation/cli/cli.js get_dsl --json '{"query":"features"}'\` 看 CLI 自己认几册。`,
  );
  process.exit(1);
}

console.log(`  —— ${list.length} 册 / 判据 ${totalJudged} 条判过（${totalPass} pass）/ ${bad} 册有红`);
process.exit(bad ? 1 : 0);
