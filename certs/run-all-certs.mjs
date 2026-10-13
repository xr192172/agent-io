/**
 * run-all-certs.mjs —— ★ 全量跑所有出生证，**并把"崩了的"的原文打出来**（T213 续）。
 *
 * ## 为什么要它（★ 一个真实的教训）
 * ★ 我原先的全量循环只 `grep '汇总：'` ⇒ ★ **崩掉的证只会显示"★ 无汇总"** ✗
 *   ⇒ ★★ 我因此**误判过两次**：一次以为"输出被截"、一次差点去"修"一个没坏的证 ✓
 * ★★ 加了 **exit code** 之后才看清：★ **那三张是 `exit=1`（真崩了）**，★ 不是没输出 ✓
 * ⇒ ★ 本脚本把这一步固化：★ **每张证都记 exit code，且崩了就把它的输出原文打出来** ✓
 *   （★ 判据：★ **"没跑"与"跑过且通过"必须分开** —— ★ 本仓铁律 ✓）
 *
 * ## 用法
 * ```
 * node certs/run-all-certs.mjs                       # 跑全部（★ 实测 19.4 分钟）
 * node certs/run-all-certs.mjs t205 t212             # 只跑名字里含这几个串的
 * node certs/run-all-certs.mjs --exclude t189-sweep  # ★ 排掉某张（★ 实测 19.4 → 9.3 分钟）
 * ```
 * ★ `--exclude` 的由来：全量里 **52% 的时间花在一张【不判红】的量具**上
 *   （`t189-sweep` 把 69 个工具逐个真跑，602s / 1164s）—— 它被名字规则收进来陪跑，
 *   **而它不是出生证**。⇒ 给一条**显式**退出口（不替调用方决定"哪些算证"）。
 *
 * ## 每张证都记耗时
 * ★ 为什么加：我被告知"全量要 21 分钟"，而当时的量具**没有时间列** ⇒ 只能猜是谁慢。
 *   ★ 而"用没量过的判据下结论"正是本仓反复栽的那个病 ⇒ **"慢"也必须有出处** ✓
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NL = String.fromCharCode(10);   // ★ T253：换行符用**无歧义**的写法，别再踩三引号转义

const filters = process.argv.slice(2);
// ★★ T224：`--exclude <串>` —— 起因（★ 有读数）：全量 **19.4 分钟**里，
//   **52% 是一张【不判红】的量具**（`t189-sweep`，602s/1164s，把 **69 个工具逐个真跑**一遍）✓
//   ★ 它被 runner 的**名字规则**收进来了 ⇒ 每次全量都陪跑 ⇒ 而它**本来就不是出生证**。
//   ⇒ 给它一条**显式**的退出口（★ 不做隐式策略：不猜"哪些算证"，由调用方点名）：
//     `node certs/run-all-certs.mjs --exclude t189-sweep`   ⇒ ★ **实测 19.4 → 9.3 分钟** ✓
const EXCLUDE = process.argv.includes('--exclude')
  ? process.argv[process.argv.indexOf('--exclude') + 1] ?? ''
  : '';
const named = filters.filter((a) => a !== '--exclude' && a !== EXCLUDE);

// ★★★ T250（2026-10-13）：**默认不跑「量具 / 探针 / 复位」** —— 它们**不判红**，是**工具**不是**证据**。
//
// ## 起因（★ 用户问"为什么每次都十几二十分钟"—— 这是量出来的答案）
// runner 的收集规则是**按文件名**（`t\d+-.*\.mjs`）⇒ 它把 `certs/` 里**不产出 `汇总：PASS=`** 的那批
// 一起卷了进来：复位脚本 / 探针 / 量具 / 扫码器。★ 40 个命中里 **10 个根本不判红**。
// ★★ 而 T224 已经量过：全量 **19.4 分钟**里 **52%** 花在**一张**这样的量具（`t189-sweep`）上。
//
// ## 为什么"跳过它们"不损失判断力（★ 这是本笔的前提，别跳过这段话）
// 它们**给不出 `PASS/FAIL`** ⇒ 跑或不跑**都不会改变"产品对不对"这个结论**。
// ★ 它们的**崩**会被 runner 算成 fail（`rc !== 0`）—— 但"**量具崩了**"说明的是**量具坏了**，
//   不说明产品坏了 ⇒ ★ 把它当验收红，本身就是**判据错位**。
// ⇒ 默认不跑；要用某件量具时**显式点名**（`node certs/run-all-certs.mjs t189-sweep`）或 `--all`。
//
// ## ★★ 自检（★ 防这份清单腐掉——"硬编码的清单一定会过期"）
// 每一条都要求**它的源码里真的没有 `汇总：PASS=`** ⇒ 谁将来给它补上了判定，这里**当场警告**并拒绝跳过它。
// ★★ **T254（2026-10-14）**：`t187-probe.mjs` **已升级为真证** —— 它现在产标准 `汇总：PASS=n FAIL=m`、
//   有红时 `exit 1` ⇒ 从本清单**删掉**，由 runner 正常收集与判红。
//   （★ 它曾经是 T253 那个"源码文本查假阳性"的主角：源码里有 `汇总：PASS=` 串、运行期却不产出 ⇒
//     权威口径改成**运行期台账** `cert-facts.json` 之后，这类误判才消掉。）
// ★★ T253 续：`t184b-probe.mjs` / `t197sub-approval.mjs` / `t203b-declared.mjs` **已从清单删掉** ——
//   实测它们**不匹配 `COLLECT_RE`**（`t\d+` 后面必须紧跟 `-`，而它们是 `t184b-`/`t197sub-`/`t203b-`）
//   ⇒ ★ runner **根本不会收集它们** ⇒ 列在清单里**毫无作用**（既不会跳过、也不会跑）。
//   ★ 要单独跑它们：直接 `node certs/<名字>`；★ 想让它们进 runner：给它们改名。
const NON_JUDGING = [
  ['t181-reset.mjs', '复位脚本（摆证器纪律用）'],
  ['t185-reset.mjs', '复位脚本'],
  ['t189-measure.mjs', '量具'],
  ['t189-sweep.mjs', '量具：把 69 个工具逐个真跑（★ T224 实测 = 全量 52% 的时间）'],
  ['t192-phantom.mjs', '探针'],
  ['t192-pointer-sweep.mjs', '扫码器'],
  ['t203-touched-audit.mjs', '审计量具'],
];
const ALL = process.argv.includes('--all');
const nonJudgingNames = new Set();
const staleList = [];
// ★★★ T224（2026-10-13）：证书从 `.inspect/`（gitignored 垃圾场）搬进 `certs/`（**进版本控制**）——
//   起因：那 4 张死在 reset 的证、其中 2 张其实是红的，**在 git 里完全看不见**（`.inspect/` 被忽略）
//   ⇒ ★ 判据：**验收依据必须在评审里可见**；`certs/` 不在 `package.json` 的 `files` 里 ⇒ **不随 npm 发布** ✓
//   ★ `dir` 从**模块自身位置**取（不再写死相对路径）⇒ 从任何 cwd 调用都对 ✓
//   ★ 转成正斜杠：下面这些命令走 `shell: true`，Windows 上反斜杠会被 shell 吃掉 ✓
const dir = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const REPORT_PATH = `${dir}/.work/cert-report.md`;

// ★★★ T253 续：**收集规则抽成一个常量** —— ★ 自检要拿它判"这条到底在不在收集范围里"
//   （★ 第一版把声明插在 `.readdirSync(dir)` 与 `.filter` 之间 ⇒ 把链打断了 ✗，且它在下面自检之后 ⇒ TDZ）
const COLLECT_RE = /^(t\d+.*-cert\.(sh|mjs)|t\d+-.*\.mjs)$/;

// ★★★ T253（2026-10-13）：清单自检改用**运行期台账**，不再用**源码文本**。
//
// ## 为什么换（★ 实测的假阳性）
// 旧版按源码文本查 汇总：PASS= ⇒ t187-probe.mjs 源码里**有**那个串、**运行期却不产出汇总**
//   ⇒ 被误判成"已是真证" ⇒ 拒绝跳过 ⇒ ★ 它每次全量都陪跑（约 22s）。
// ★★ 与 T197 同族：**验证方式的来源不能与生成方式同源**（拿源码文本查源码文本）。
//
// ## 现在的权威来源 = 运行期台账（每次跑完自动记 hasSummary）
// certs/.work/cert-facts.json = { "<file>": { hasSummary, rc, at } }
//   · 台账说它**产出** PASS/FAIL ⇒ ★ **拒绝跳过**（否则静默漏掉一张真证）
//   · 台账说它**不产出** ⇒ 允许跳过 ✓（运行期事实）
//   · 台账**没有它** ⇒ 允许跳过但**标"未核"**（★ 如实说）
// ⇒ ★★ **反向核对（"清单里这条其实已是真证"）只有 --all 跑得出来** —— 被跳过的文件不产生记录。
//   所以：**定期跑一次 npm run certs:all** 刷新整份台账 ⇒ 那次的反向核对才是权威的。
const FACTS_PATH = `${dir}/.work/cert-facts.json`;
let FACTS = {};
try {
  FACTS = JSON.parse(fs.readFileSync(FACTS_PATH, 'utf8'));
} catch {
  /* 首次运行：没有台账，全部标"未核" */
}
const unverified = [];
const notCollected = [];
for (const [f, why] of NON_JUDGING) {
  if (!fs.existsSync(path.join(dir, f))) {
    staleList.push(`${f}（★ 文件已不在，清单条目该删；原记理由：${why}）`);
    continue;
  }
  const rec = FACTS[f];
  if (rec && rec.hasSummary === true) {
    staleList.push(`${f}（★ **运行期事实**：上次跑它产出了 PASS/FAIL ⇒ 它已是真证，清单条目该删）`);
    continue;
  }
  if (!rec) {
    // ★★★ T253 续（2026-10-13）：**先问"这条到底在不在 runner 的收集范围里"** ——
    //   起因（★ 实测到的**说谎**）：第一版对 `t184b-probe.mjs` / `t197sub-approval.mjs` /
    //   `t203b-declared.mjs` 说了"本次照跑了一遍"，而它们**名字不匹配收集正则**
    //   （`t\d+` 后面必须紧跟 `-`，而它们是 `t184b-`/`t197sub-`/`t203b-`）⇒ ★ **根本没被收进来、根本没跑**。
    //   ⇒ 后果两条：① 提示**在说谎**；② 它们**永远核不上**（自举不收敛）。
    if (!COLLECT_RE.test(f)) {
      notCollected.push(f);
      continue;
    }
    // ★ T253 自举：**台账里没有记录 ⇒ 本次照跑一遍**（花一次成本）⇒ 跑完台账就有它 ⇒ 下次才跳过。
    //   为什么必须这样：被跳过的文件**不产生记录** ⇒ 否则清单条目会**永远停在"未核"**。
    unverified.push(f);
    continue;
  }
  nonJudgingNames.add(f);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => COLLECT_RE.test(f))
  .filter((f) => (named.length === 0 ? true : named.some((x) => f.includes(x))))
  .filter((f) => !(EXCLUDE && f.includes(EXCLUDE)))
  // ★★★ T250：**默认剔掉"不判红"的那批**（除非显式点名它、或 `--all`）
  .filter((f) => ALL || named.some((x) => f.includes(x)) || !nonJudgingNames.has(f))
  .sort();

// ★ 把"跳过了什么、怎么带回来"**说出来**（★ 不许静默少跑 —— 那正是本仓最反对的形状）
if (staleList.length > 0) {
  console.log('★★ T250：`NON_JUDGING` 清单有**过期条目**（已忽略该条目、照常跑对应文件）：');
  for (const x of staleList) console.log(`   · ${x}`);
}
if (!ALL && named.length === 0) {
  const skipped = [...nonJudgingNames].sort();
  console.log(
    `★ T250：默认**不跑 ${skipped.length} 个「量具/探针/复位」**（它们不产出 PASS/FAIL，跳过不损失判断力）：\n` +
      `   ${skipped.join(' · ')}\n` +
      `   ⇒ 要用某一件：\`node certs/run-all-certs.mjs <名字片段>\`；要全跑：\`--all\`（★ 约 +10 分钟）`,
  );
}

const rows = [];
let crashed = 0;
let failed = 0;

for (const f of files) {
  // ★ 每个证跑前先还原（★ 摆证器纪律 ✓）
  try {
    execSync(`node "${dir}/t185-reset.mjs"`, { stdio: 'ignore' });
  } catch {
    /* reset 失败不致命 —— 但下面每张证自己也会还原 ✓ */
  }

  const cmd = f.endsWith('.sh') ? `bash "${dir}/${f}"` : `node "${dir}/${f}"`;
  let out = '';
  let rc = 0;
  // ★★★ T224：**记每张证的耗时** —— 起因：我被告知"全量要 21 分钟"，
  //   而当时的量具**根本没有时间列** ⇒ ★ 我只能**猜**是谁慢（★ 那正是本仓反复栽的"用没量过的判据下结论"）。
  //   ★ 判据：**"慢"也要有出处** —— 谁是瓶颈必须能从读数里读出来，不能靠印象。
  const t0 = Date.now();
  try {
    out = execFileSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  } catch (e) {
    rc = typeof e.status === 'number' ? e.status : -1;
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  const ms = Date.now() - t0;

  const sum = (out.match(/汇总：PASS=(\d+)\s+FAIL=(\d+)/) ?? []).slice(1);
  // ★★★ T213 续：**"没有汇总" ≠ "有红"** —— ★ 本脚本第一版把两者混成一档 ✗
  //   ★ 实测：证书目录里还住着**一批量具/探针**（不是出生证）★ 它们本来就不打印"汇总" ✓
  //     （★ 2026-10-13 搬家前它们在 `.inspect/`，现在都在 `certs/` ✓ 判据不变 ✓）
  //   ⇒ ★ 于是一跑就报"有红 9 张" ✗★ —— ★ **那是【我的口径】造成的假警报** ✓
  //   ★★ 判据：★ **三档分开** —— ★ 崩（exit≠0）· ★ **有红（有汇总且 FAIL≠0）** · ★ **无汇总（= 不是证书，或它还没成形）** ✓
  //   ★★★ 而 ★ **"崩"是一个待定性状态、不是"环境噪声"**（T223 实测：4 张崩里 3 张死在 reset 行、
  //     其中 2 张**【本来就是红的】** ⇒ 崩把它盖住了 ✓）⇒ ★ **崩了就把原文打出来，逐张查明** ✓
  const hasSummary = sum.length === 2;
  const pass = sum[0] ?? '?';
  const fail = sum[1] ?? '?';
  // ★★★ T254：**三档判读收成一处**（唯一派生 = `kind`）—— 下面所有地方（计数 · 行标签 · 报告表 ·
  //   崩/有红原文 · 漏项自检）都从它取，不再各写一遍谓词（本仓头号病：同一判据住两处）。
  //   · 有标准汇总且 FAIL>0 ⇒ `red`：**不管 rc**（探针自己 `exit 1` 仍算"有红"，不是"崩"）
  //   · 否则 rc!=0 ⇒ `crash`：没跑完/自己炸（连汇总都给不出）
  //   · 否则有汇总 ⇒ `green`
  //   · 否则 ⇒ `nosummary`：跑了但没判红汇总（不是出生证 / 未成形）
  const kind = hasSummary && fail !== '0' ? 'red' : rc !== 0 ? 'crash' : hasSummary ? 'green' : 'nosummary';
  rows.push({ f, rc, pass, fail, out, hasSummary, ms, kind });

  if (kind === 'crash') crashed++;
  else if (kind === 'red') failed++;

  const tag =
    kind === 'crash'
      ? `★ 崩（exit=${rc}）`
      : kind === 'nosummary'
        ? '○ 无汇总（★ 不是证书 / 未成形）'
        : kind === 'red'
          ? `★ 有红（FAIL=${fail}）`
          : '✓';
  console.log(`${String(rc).padStart(2)}  ${String(pass).padStart(3)}/${String(fail).padEnd(2)}  ${f.padEnd(28)} ${tag}  ${(ms / 1000).toFixed(1)}s`);
}
// ★ T224：**耗时排行** —— "慢"必须有出处；前 8 名 + 合计，能直接看出瓶颈在哪。
const totalMs = rows.reduce((a, r) => a + r.ms, 0);
const slowest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 8);
console.log('\n══ 耗时（★ 这才能回答"为什么全量要那么久"）');
console.log(`  合计 ${(totalMs / 1000 / 60).toFixed(1)} 分钟`);
for (const r of slowest) console.log(`  ${(r.ms / 1000).toFixed(1).padStart(7)}s  ${r.f}`);
console.log(`  其余 ${rows.length - slowest.length} 张合计 ${((totalMs - slowest.reduce((a, r) => a + r.ms, 0)) / 1000).toFixed(1)}s`);

const noSummary = rows.filter((r) => r.kind === 'nosummary').length;
const green = rows.filter((r) => r.kind === 'green').length;
const verdict = `══ ${files.length} 张：崩 ${crashed} · 有红 ${failed} · 无汇总 ${noSummary} · **真证书全绿 ${green}**`;
console.log(`\n${verdict}`);

// ★★★ T250 续（2026-10-13）：**清单漏项自检（用【运行期事实】，不是源码文本）**
//   起因（★ 实测）：`t187-probe.mjs` 跑了 **21.6s 却不判红**，而它**不在** `NON_JUDGING` 清单里 ——
//   ★ 因为清单的自检是**按源码文本**查 `汇总：PASS=`，而它源码里有那个串、运行期却不产出汇总
//   ⇒ ★★ **文本查不出漏项**。而"跑了却没汇总"这件事，**runner 手上就是现成的**（`hasSummary`）。
//   ⇒ 所以：把"跑了、没崩、没汇总、又不在清单里"的文件**当场列出来**（这是权威来源）。
// ★★★ T253：**刷新运行期台账**（下次的清单自检就读它）
{
  const next = { ...FACTS };
  for (const r of rows) next[r.f] = { hasSummary: r.hasSummary, rc: r.rc, at: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(FACTS_PATH), { recursive: true });
    fs.writeFileSync(FACTS_PATH, JSON.stringify(next, null, 1), 'utf8');
    console.log(`\n★ T253：运行期台账已刷新（${rows.length} 条）⇒ 下次清单自检读它，不再读源码文本 ✓`);
  } catch (e) {
    console.log(`\n★ T253：台账写入失败（不影响本次判定）：${String(e && e.message)}`);
  }
}

const drift = rows.filter((r) => r.kind === 'nosummary' && !NON_JUDGING.some((n) => n[0] === r.f));
if (drift.length > 0) {
  console.log(`\n★ T253：**清单漏项（运行期事实）** —— 这些跑了、没崩、但不产出 PASS/FAIL，且不在 NON_JUDGING 里：`);
  for (const r of drift) console.log(`   · ${r.f}（${(r.ms / 1000).toFixed(1)}s）`);
  console.log('   ⇒ ★ 把它们加进 NON_JUDGING（附理由）⇒ 下次默认就不跑了。');
}
if (notCollected.length > 0) {
  console.log(
    `${NL}★★ T253：清单里有 ${notCollected.length} 条**根本不在 runner 的收集范围**（名字不匹配 COLLECT_RE）⇒ 列着也没用：`,
  );
  console.log(`   ${notCollected.join(' · ')}`);
  console.log('   ⇒ ★ 它们**永远不会被跑**（所以也永远核不上）⇒ 要么从清单里删掉，要么给它们改名。');
}
if (unverified.length > 0) {
  console.log(
    `${NL}★ T253 **自举**：清单里有 ${unverified.length} 条台账没记录 ⇒ **本次照跑了一遍**（花一次成本，不是陪跑）：`,
  );
  console.log(`   ${unverified.join(' · ')}`);
  console.log('   ⇒ ★ 它们的结果已写进台账 ⇒ **下次默认就跳过**（★ 不需要人工跑 `--all` 了）。');
}
if (ALL) {
  console.log('\n★ T253：本次是 --all ⇒ **台账覆盖全部文件** ⇒ 两个方向（漏项 / 该删的条目）都是权威的 ✓');
}

// ★★★ T213 续2：**结果同时写一份文件** —— ★ 为什么：★ 我原先用 `| head` / `| tail` 去截输出
//   ⇒ ★ 管道会**缓冲** ⇒ ★★ 命令不跑完**一个字都看不到** ⇒ 我为此白等了两次（★ 各 17 分钟 ✗）
//   ⇒ ★★ **量具"不便读"也是量具问题** ✓ ⇒ 写文件：★ 想看随时看，不用等 ✓
//   （★ 而"该看的时候不用等"正是本仓一贯的取向：★ 读数要能被【随时】取到 ✓）
// ★ T252 续（2026-10-13）：**零张时不覆盖读数文件** ——
//   起因（实测）：我为了看提示跑了一次 `node certs/run-all-certs.mjs __nope__`（0 张），
//   ★ 结果把上一份**真读数**覆盖成了 "0 张 / 0.0 分钟" ⇒ 差点把一次全绿当成"没跑"。
//   ⇒ 判据：**没跑任何东西，就不许写读数**。
const reportPath = REPORT_PATH;   // ★ 放 if **外面**（★ 我第一版把它一起包进去了 ⇒ 下面那条消息就报 reportPath is not defined）
if (files.length > 0) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });   // ★ 不假设 .work 已存在（全新 clone 第一次跑 ✓）
  fs.writeFileSync(
    reportPath,
    [
      `# 出生证全量读数 · ${new Date().toISOString()}`,
      '',
      '| exit | PASS/FAIL | 耗时 | 证 | 判 |',
      '|---|---|---|---|---|',
      ...rows.map(
        (r) =>
          `| ${r.rc} | ${r.pass}/${r.fail} | ${(r.ms / 1000).toFixed(1)}s | ${r.f} | ${
            r.kind === 'crash' ? '★ 崩' : r.kind === 'nosummary' ? '○ 无汇总' : r.kind === 'red' ? `★ 有红(${r.fail})` : '✓'
          } |`,
      ),
      '',
      `**${verdict}**`,
      '',
      `**耗时合计 ${(totalMs / 1000 / 60).toFixed(1)} 分钟** —— 最慢：${slowest.map((r) => `${r.f}(${(r.ms / 1000).toFixed(1)}s)`).join(' · ')}`,
      '',
      crashed > 0 ? '## 崩掉的证 · 输出原文（尾部 25 行）' : '（无崩）',
      ...rows
        .filter((r) => r.kind === 'crash')
        .flatMap((r) => [`### ${r.f}（exit=${r.rc}）`, '```', ...r.out.split('\n').slice(-25), '```', '']),
    ].join('\n'),
    'utf8',
  );
}
console.log(files.length > 0 ? `（读数已写入 ${reportPath} —— ★ 下次直接读它，不用盯着终端等 ✓）`
  : `（★ 本次 0 张 ⇒ **没有覆盖** ${reportPath} —— 上一份真读数还在 ✓）`);

// ★★ 崩了的：**把原文打出来**（★ 否则下一个人还是只能猜 ✓）
if (crashed > 0) {
  console.log('\n════ 崩掉的证，输出原文（★ 只打这些，免得刷屏）════');
  for (const r of rows.filter((x) => x.kind === 'crash')) {
    console.log(`\n──── ${r.f}（exit=${r.rc}）────`);
    console.log(r.out.split('\n').slice(-25).join('\n'));
  }
}

// ★★★ T218（2026-10-13）：**"有红"的也要打原文** ✗ —— ★ 原来只打"崩"的 ✓
//   ★ 起因：★ 全量里 `t181`(12/2) 与 `t182`(3/5) 红了，★ 而**它们单独跑都全绿** ✗
//     ⇒ ★ 我知道"是顺序里出的问题"，★ **却看不到【红在哪一句】—— 只能猜** ✗
//   ★★ 而 ★ "看回执"是今天**唯一一次就成**的办法（★ 前两次靠猜都错 ✓）
//   ⇒ ★ 所以这里补上：★ **把"有红"证的【失败那几行】也打出来** ✓（★ 只打失败行 + 上下文 ✓）
if (failed > 0) {
  console.log('\n════ 有红的证，**失败那几行**原文（★ 只打 ✗ 行 ± 它们前面 6 行）════');
  for (const r of rows.filter((x) => x.kind === 'red')) {
    console.log(`\n──── ${r.f}（${r.pass}/${r.fail}）────`);
    const ls = r.out.split('\n');
    const idx = ls.map((l, i) => [l, i]).filter(([l]) => /^✗/.test(l)).map(([, i]) => i);
    for (const i of idx.slice(0, 6)) {
      console.log(ls.slice(Math.max(0, i - 6), i + 3).join('\n'));
      console.log('  ·····');
    }
  }
}
process.exit(crashed > 0 || failed > 0 ? 1 : 0);
