#!/usr/bin/env node
/**
 * write-log-audit.mjs —— **「无卡变更」第三本账的只读对账器**（`docs/todo.md` §一 0.8 · 步骤⑤）。
 *
 * ## 它回答的问题
 * 「本项目的写，有多少条**没有任务卡**在账上？」并按**放行支**分组：
 * `exempt`（设计侧声明豁免）/ `authorized`（按 run 授权）/ `files-not-in-design`（不在设计里）/
 * `unaddressable`（文件节点收集失败）/ `first-run-unclaimed`（首跑模式）/ `covered`（有卡）。
 * ⇒ 这直接把「豁免面到底放行了多少写」量化出来，不必先去审那 59 个裸字段。
 *
 * ## ★ 已声明边界（AGENTS-RULES 0.17 口径①：本账**不管**什么）
 * 本账只覆盖**过写原语的写**（`source_writer` 的 `commit` / `append` / `copy` / `move` / `remove`
 * + 回滚通道 `restoreSourceBytes`）。**`Write` / `Edit` / shell 直写磁盘不在内**，且**不打算用
 * 周期性全量扫描去兜**（0.19：政策兜底不是机制）—— 要覆盖它需要常驻 daemon（OS 事件），那是另一件事。
 *
 * ## 只读
 * 本脚本**不写任何 state**：不建库、不建表、不改行、不建目录。库不在就直说"读不到"并非 0 退出
 * （0.12：读不到 ≠ 一条都没有）。
 *
 * 用法：
 *   node scripts/write-log-audit.mjs [--project <dir>] [--limit N] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const asJson = argv.includes('--json');
/**
 * ★ `--gate`（2026-11-03 接线）：同一个脚本的**门模式** —— `npm run verify` 的「无卡写账」门。
 *   ★ 它**不新写一套对账逻辑**：走的是下面**同一份** reconciliation（同一批权威函数、同一个分母口径、
 *     同一个"哪一行算用户源码的写"分类），只把结论换成三态退出码。★ 为什么不拆成
 *     `scripts/write-log-gate.mjs`：拆出去就得把 `classifyWriteSubject` / `isUnderSkippedDir` /
 *     `shouldSyncRel` 三把尺的串联复制一份 —— 那正是 0.9.1 禁止的第二处权威。
 */
const asGate = argv.includes('--gate');
const projectDir = path.resolve(arg('project', process.cwd()));
const listLimit = Math.max(1, Number(arg('limit', '10')) || 10);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distUrl = (...p) => pathToFileURL(path.join(repoRoot, 'dist', 'src', ...p)).href;
/** 门模式的棘轮基线（只记**已登记的存量**，每条带 reason） */
const baselineFile = path.resolve(arg('baseline', path.join(here, 'write-log-baseline.json')));

const die = (msg) => {
  console.error(msg);
  process.exit(2);
};

// ★ 只读探查 DB 前 existsSync 先行：`new DatabaseSync(<不存在的路径>)` 会建 0 字节空壳（撞 manifest:check）
const tasksDb = path.join(projectDir, '.agent-io', 'tasks.db');
if (!fs.existsSync(tasksDb)) {
  die(
    `读不到写账：${tasksDb} **不存在**。\n` +
      '  ★ 这不是「零无卡写」，而是「这个项目还没有写账」（0.12：读不到 ≠ 一条都没有）。\n' +
      '  ★ 写账只在**过写原语**的写之后才产生（source_writer 的 5 个动词 + 回滚通道）。',
  );
}

let readWriteLog;
let classifyWriteSubject;
let isUnderSkippedDir;
let shouldSyncRel;
// ★★★ 2026-11-04（G13/G17）：分诊与「无卡写」的**唯一判定式**住 `domain/task_gate_basis.ts`
//   —— 本脚本只调它，**不再自己写 `!card_id`**（那是把“没有凭证”当成“没有卡”的原病）。
let cardabilityOfBranch;
let countsAsNoCardWrite;
let countsAsCredentialMiss;
/** ★ 2026-11-04（F2/F3 的读端）：缺 path 节点数 + 册级 excluded 的前缀匹配（唯一实现分在下面两个模块） */
let collectGateCoverage;
let isExcludedPath;
/**
 * ★★★ 2026-11-07（T44 · 认账档 R1）：**「这张卡真的存在吗」的唯一读端** = `task_history#listLiveCards`
 *   （读 `tasks.db#live_cards`；本脚本**不自己拼 SQL** —— AGENTS 六「判任何事实先看有没有现成函数」）。
 */
let listLiveCards;
try {
  ({ readWriteLog } = await import(distUrl('infrastructure', 'write_log.js')));
  ({ classifyWriteSubject, collectGateCoverage } = await import(distUrl('application', 'write_gate.js')));
  ({ isExcludedPath } = await import(distUrl('application', 'design', 'db', 'gen_design_db.js')));
  ({ isUnderSkippedDir } = await import(distUrl('infrastructure', 'parse', 'source_exts.js')));
  ({ shouldSyncRel } = await import(distUrl('infrastructure', 'index', 'watch_project.js')));
  ({ cardabilityOfBranch, countsAsNoCardWrite, countsAsCredentialMiss } = await import(
    distUrl('domain', 'task_gate_basis.js')
  ));
  ({ listLiveCards } = await import(distUrl('infrastructure', 'task_history.js')));
} catch (e) {
  die(
    `读不到权威模块（${(e && e.message) || e}）⇒ 判不了。\n` +
      '  ★ 本脚本**不自己拼 SQL / 不自己造"什么算源码"的清单**（AGENTS-RULES 0.20）——\n' +
      '    它调的是 write_log#readWriteLog / write_gate#classifyWriteSubject /\n' +
      '    source_exts#isUnderSkippedDir / watch_project#shouldSyncRel。\n' +
      '  ⇒ 先 `npm run build`（dist 必须比 src 新）。',
  );
}

const read = readWriteLog(projectDir, { limit: 5000 });
if (read.skip) die(`读不到 write_log：${read.skip}`);

/**
 * 「这一行算不算用户源码的写」——**复用现有权威**，不新造清单：
 * ① `classifyWriteSubject`：产物目录 / 临时目录 / 根外（`.agent-io` `.agent` `design-db` `dist`
 *    `node_modules` `output` 都在它里面）；
 * ② `isUnderSkippedDir`：索引器本来就不收的目录（`node_modules` / `dist` / 隐藏目录…）；
 * ③ `shouldSyncRel`：非源码扩展名 / 索引跳过的文件名。
 * @returns 排除原因（`null` = 保留）
 */
const exclusionOf = (rel) => {
  const cls = classifyWriteSubject(projectDir, path.join(projectDir, rel));
  if (cls.subject !== 'source') return cls.subject; // product / temp / outside-root
  if (isUnderSkippedDir(rel)) return 'skipped-dir';
  if (!shouldSyncRel(rel)) return 'not-source-ext';
  return null;
};

/** 支名（`exempt:by` 这类带附注的写法只取前缀 —— 与 `domain/task_gate_basis#cardabilityOfBranch` 同一口径） */
const branchOf = (r) => String(r.gate_branch ?? '').split(':')[0];

const kept = [];
const dropped = new Map();
for (const r of read.rows) {
  const why = exclusionOf(r.file);
  if (why) dropped.set(why, (dropped.get(why) ?? 0) + 1);
  else kept.push(r);
}

/**
 * ★★★ 2026-11-04（F3 的**读端**）：设计侧「管辖范围声明」—— 册级 `excluded`（前缀/精确）。
 * 唯一权威 = `write_gate#collectGateCoverage` 的 `declaredExcluded`（它自己又走
 * `gen_design_db#excludedPathsOf` / `#isExcludedPath`），本脚本**不重写匹配**。
 *
 * 两件事共用这一份读数（同一把尺）：
 *   ① **F2 的闸**：缺 path 的 file/doc 节点数必须为 0（不为 0 ⇒ `unaddressable` 支复活
 *      ⇒ “未入册就写”会被当成“判不了”而跳过 ⇒ 门的牙齿被磨掉）；
 *   ② **旧支名纠正**（见下）。
 */
let cov = null;
let covError = '';
try {
  cov = collectGateCoverage(projectDir);
} catch (e) {
  // ★ 算不出而言“没有”就是 0.12 禁的那种静默（下面直接当失败报）。
  covError = `算不出设计侧读数（collectGateCoverage：${(e && e.message) || e}）`;
}
const declaredExcluded = cov ? cov.declaredExcluded : [];
const covUnaddressable = cov ? cov.unaddressable.length : 0;

/**
 * ★ 2026-11-04（F3 的读端 · 已声明边界）：**`files-not-in-design` 是可证伪的** ——
 * 若那条路径落在册级 `excluded` 里，它就不是“不在设计册”，而是“设计册声明这块不立卡”（= `exempt`）。
 * 旧闸（F3 那版之前）读不到册级声明 ⇒ 会把这类写贴成 files-not-in-design ⇒ 按新口径会被算进分子。
 *
 * ⇒ 这里**只把支名喂对**（files-not-in-design → exempt）：分诊仍只经 `domain/task_gate_basis`
 *   判（**唯一判定式**不破），纠正过的行**逐条可查 + 计数打印**（不许静默改写历史）。
 */
/**
 * ★★★ 2026-11-04（D1 裁定 · 时间上界版）：**旧支名纠正**的**一次性上界**（写死，UTC）。
 *
 * 为何要有上界（而不是无条件重贴）：无条件版是**永久逃逸通道** ——
 * 「先写未入册文件 → 门红 → 去册里声明 excluded → 变绿」。F3 之后「声明 excluded」
 * 本来就会豁免**以后所有**的写，那已经够了；无条件重贴唯一多出来的能力就是
 * 「回溯豁免已经发生的写」—— 它**没有任何正当用途**。
 * ⇒ 上界之前：旧闸（F3 之前）把「声明 excluded 的路径」贴成 files-not-in-design ⇒ 可证伪，改喂 exempt；
 *   上界之后：**恒红** + 印诊断（先怀疑「旧 dist 还在跑」，再怀疑「F3 没真生效」）。
 * ★★ **禁令：这个上界一旦写入不许往后挪** —— 挪一次就把「一次性历史纠正」变回「永久逃逸通道」。
 */
const RELABEL_UNTIL = '2026-11-04T12:30:00.000Z';
const relabeled = [];
/** 上界**之后**仍出现「files-not-in-design 但该路径在册级 excluded 里」的行 —— 恒红（见 fail） */
const relabelLate = [];
const branchForClass = (r) => {
  const b = branchOf(r);
  if (b === 'files-not-in-design' && cov && isExcludedPath(declaredExcluded, r.file)) {
    if (r.at <= RELABEL_UNTIL) {
      relabeled.push(r);
      return 'exempt';
    }
    relabelLate.push(r);
  }
  return b;
};

/**
 * ★★★ 2026-11-04（G13/G17 的口径修法）：**「无卡」不再等于「没有 card_id」**。
 *
 * 判据全部落在 `domain/task_gate_basis.ts`（唯一住处），本脚本只调它、不自己写 `!card_id`：
 *   ① **该有卡而没卡**（card-required ∧ 无凭证）⇒ 这才是分子（**本门的牙齿**）；
 *   ② **结构上不可能有卡**（card-impossible）⇒ 跳过，但**按支逐个印出来**（0.12③：跳过必须看得见）；
 *   ③ **有卡但凭证没记下**（card-guaranteed ∧ 无凭证）⇒ 另计（G13：这不是“绕开设计线”，
 *      但也不许被吞掉 —— 棘轮按“新增即红”判）；
 *   ④ 支名不在闭集里 ⇒ **判不了** ⇒ 硬红（0.12：判不了 ≠ 通过）。
 *
 * ★ 改前这里是一行 `kept.filter((r) => !r.card_id)` —— 于是 exempt / unaddressable（结构上不可能有卡）
 *   和 covered / authorized（有卡、只是凭证没记下）全被算成“无卡写”⇒ 实测 31 条里 29 条是噪音。
 */
const noCard = kept.filter((r) => countsAsNoCardWrite(branchForClass(r), r.card_id));
const withCard = kept.filter((r) => !!r.card_id);
const skipped = kept.filter((r) => !r.card_id && cardabilityOfBranch(branchForClass(r)) === 'card-impossible');
const credMiss = kept.filter((r) => countsAsCredentialMiss(branchForClass(r), r.card_id));
const unknown = kept.filter((r) => !r.card_id && cardabilityOfBranch(branchForClass(r)) === 'unknown');
const N = noCard.length;
const M = withCard.length;
const T = kept.length;
const K = skipped.length;
const G = credMiss.length;
const U = unknown.length;
/** ★ 五格互斥且穷尽（有卡 / 该有卡而没卡 / 不该有卡跳过 / 凭证未记 / 判不了）⇒ 不闭合就是本脚本有 bug */
const closed = N + M + K + G + U === T;

/**
 * 支分组：★ **分母 = kept 全量**（0.12③：豁免面放行多少写 = exempt / 全量，不是 exempt / 无卡总数）。
 * ★ 改前它只统计“无卡”那批 ⇒ 分母被自己的定义偷换了。
 */
const byBranch = new Map();
for (const r of kept) {
  const b = branchForClass(r);
  byBranch.set(b, (byBranch.get(b) ?? 0) + 1);
}
const branches = [...byBranch.entries()].sort((a, b) => b[1] - a[1]);
/** 被跳过的那批（结构上不可能有卡）按支分组 —— “跳过”不许等于“看不见” */
const skippedBranch = new Map();
for (const r of skipped) {
  const b = branchForClass(r);
  skippedBranch.set(b, (skippedBranch.get(b) ?? 0) + 1);
}
const skipBranches = [...skippedBranch.entries()].sort((a, b) => b[1] - a[1]);
/** 被纠正过支名的行（去重计数 + 逐条可查） */
const relabeledRows = [...new Map(relabeled.map((r) => [`${r.at}|${r.file}`, r])).values()];
/** 上界之后仍贴错的行（去重）—— 恒红 + 诊断（见 gate 的 fail） */
const relabelLateRows = [...new Map(relabelLate.map((r) => [`${r.at}|${r.file}`, r])).values()];

/** 历史上被贴上 unaddressable 的行数（冻结读数：它们不进分子，也不许新增） */
const historicalUnaddressable = kept.filter((r) => !r.card_id && branchOf(r) === 'unaddressable').length;

const BOUNDARY =
  '本账只覆盖「过写原语的写」（source_writer 的 commit / append / copy / move / remove + 回滚通道 restoreSourceBytes）；\n' +
  '  `Write` / `Edit` / shell 直写磁盘**不在内**，且**不打算用周期性全量扫描去兜**（AGENTS-RULES 0.19：政策兜底不是机制）——\n' +
  '  要覆盖它需要常驻 daemon（OS 事件），那是另一件事（docs/todo.md §一 6.3）。';

const fmtRow = (r, i) =>
  `  ${String(i + 1).padStart(3)}. ${r.at} · ${r.file} · actor=${r.actor ?? '（空）'} · kind=${r.kind} · ` +
  `source=${r.source} · card=${r.card_id ?? '（无）'}${r.card_feature ? `(${r.card_feature})` : ''} · ` +
  `branch=${r.gate_branch ?? '（无）'}`;

// ════════════════════════════════════════════════════════════════════
// ★ 门模式（`--gate` · 2026-11-03 接线）：`npm run verify` 的「无卡写账」门
//
// ## 它治哪个洞
// 这个对账器此前**连 npm script 都没登记**（`package.json` 里没有 `audit:writes`）⇒
// 「无卡变更」这件事依旧靠**人记得跑脚本** —— 发现者审计里它正落在 HUMAN 那一档（"只有人撞上才发现"）。
// 现在：① `npm run audit:writes` = 有人读的入口；② `--gate` = 总门能跑的三态结论。
//
// ## ★★ 这门现在**靠什么长牙**（2026-11-04 写清：别让下一个人把「无卡 0」读成「门在空转」）
//   「该有卡而没卡 = 0」是**正确且预期**的读数，不是空转：
//   · 写「有卡覆盖面」的文件却没卡 ⇒ **被写闸当场抛错拦住**，根本进不了 write_log ⇒ 本账看不见它；
//   · 提不到 actor 的 covered / authorized ⇒ 走 `credential_missed` 棘轮（冻结历史 + 新增恒红）；
//   · 所以本账能抓的只有**放行但没卡**的那两类 ⇒ 真正的牙齿是
//     **`files-not-in-design`：有人写了不在设计册里的源文件**（另一类是首跑补丁 `first-run-unclaimed`）。
//   ★ 这也正是 F3 的价值：读册级 `excluded` 之前，`scripts/` 那 63 个量具**一直**落进
//     files-not-in-design ⇒ **真正的牙齿被噪音淹了**（噪音一大，人就把整扇门关掉 —— 0.16）。
//
// ## ★★ 棘轮纪律（2026-11-04 裁定）：**冻结历史 + 新增恒严**，两个名单**只许缩小**
//   · `rows`（裁制性基线：该有卡而没卡）与 `credential_missed`（凭证未记）都是棘轮，不是"豁免清单"；
//   · **禁止**把新出现的一条塞进名单来让它变绿 —— 那是把本账退化成本卡要消灭的东西；
//   · 修好一条就从名单里删一条（`stale_baseline` 会把它列成"可删"）。
//
// ## 判据（都可判；①-⑤ 是 2026-11-04 那五条，⑥-⑨ 是 2026-11-07 加的「已认账」档）
// ① **无卡写 = 该有卡而没卡**（唯一判定式 = `domain/task_gate_basis#countsAsNoCardWrite`）才算脏
//    —— ★ 2026-11-04 前这里写的是“`card_id IS NULL` 才算脏”，于是结构上不可能有卡的支
//    （exempt / unaddressable）与“有卡、只是凭证没记下”的支（covered / authorized）全被算成无卡写
//    ⇒ 31 条里 29 条是噪音 ⇒ 门被基线关掉（0.16）。分诊表唯一住处 = `domain/task_gate_basis.ts`；
// ② 历史存量走棘轮：`scripts/write-log-baseline.json` 逐条登记（键 = `at|file|kind`）——
//    **键集与条数同时**比对 ⇒ **只许不增**，新出现一条无卡写就红（★ 不许"清零骗绿"：存量逐条列出）；
//    ★ 「有卡但凭证没记下」是**第二个棘轮**（`credential_missed`）：冻结历史 + 新增恒严；
// ③ 读不全（5000 行上限截断 / 五格不闭合）⇒ 红 —— 只对了一部分不许当通过（0.12 ③）；
// ④ 没有基线却已有无卡写 ⇒ 红（拒"空名单全靠开关"）；
// ⑤ 支名不在 `TaskGateBasis` 闭集里 ⇒ **红**（判不了 ≠ 通过，0.12）。
// ⑥ **已认账档（`acknowledged`）只治「补不了卡的冻结历史」**：`row` 里的每一笔都要带 `reason` + `card`，
//    而 `card` 必须能在 `listLiveCards` 里查到、`state ≠ void` ⇒ **没有处置卡的认账不算认账（那是记旗）**；
// ⑦ **新写塞不进来**：条目 `at` ≤ `ACKNOWLEDGED_UNTIL`（写死在脚本里的常量），且基线的
//    `acknowledged_until` 必须与它**逐字相等** —— 挪任何一处 ⇒ 红（上界不许往后挪）；
// ⑧ **账只许变短（可判的那一半）**：条目必须仍对应一条**真实**的无卡写，否则请删；
//    同一笔不许同时在 `rows` 与 `acknowledged` 里（重复会让上限凭空变大）；
// ⑨ 基线**必须有 `max_no_card` 字段**（缺省会落回 `rows.length` ⇒ 删字段 = 抬上限，比改数字还隐蔽）。
// ★★ 读口径：`无卡 N` **始终是原始条数**，认账只抵扣"判定用"的有效值（`noCardEffective`）——
//    哪天输出变成"只报 1"，那是把账扫到地毯下，不是修好。
//
// ## 退出码（与总门同口径）
//   0 = 干净 ｜ 1 = 红（逐条点名 file + at + actor + source）｜ 2 = 判不了（库不在 / 权威模块读不到，见 `die`）
/**
 * ★★★ 2026-11-07（T44 · 认账档 R2）：**认账的一次性上界**（写死，UTC）。
 *
 * ## 为什么它必须是常量、而不是基线里的一个可编辑字段
 * 「账只许变短」在**无状态文件**上不可实现：文件只看得到「当前清单」，看不到「以前更长」；
 * 要判「变长了没有」就必须有一个**记住的上限** —— 那就是 `max_no_card` 本人 ⇒ 循环。
 * ⇒ 换成这个可机械判的等价物：认账条目的 `at` 必须 ≤ 上界；新写（at 晚于上界）**塞不进来**。
 *
 * ★★ **禁令：这个上界一旦写入不许往后挪** —— 挪一次就把「一次性历史窗口」变回永久逃逸通道
 *    （与 `RELABEL_UNTIL` 同一把尺，见上面那一段的理由）。
 * ★ 基线里的 `acknowledged_until` 必须与它**逐字相等**，否则红 —— 两个独立处都要改才算真改，
 *    而那是**蓄意伪造**，不是「顺手调一下」。
 */
const ACKNOWLEDGED_UNTIL = '2026-11-06T23:59:59.999Z';
if (asGate) {
  let baseline = null;
  let baselineError = '';
  try {
    if (fs.existsSync(baselineFile)) baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
    else baselineError = `基线文件不存在：${baselineFile}`;
  } catch (e) {
    // ★ 读不了 ≠ 没有（0.12）：坏基线不许静默当空名单 —— 那会把"登记过的存量"变成"未登记"而报假红。
    baselineError = `基线读不了（${(e && e.message) || e}）：${baselineFile}`;
  }
  const keyOf = (r) => `${r.at}|${r.file}|${r.kind}`;
  /** ★ 只认带 reason 的条目：空 reason 的登记等于没登记（排除/豁免必须是**声明**） */
  const baseRows = Array.isArray(baseline?.rows)
    ? baseline.rows.filter((x) => x && x.key && String(x.reason ?? '').trim())
    : [];
  const baseKeys = new Set(baseRows.map((x) => x.key));
  const baseMax = typeof baseline?.max_no_card === 'number' ? baseline.max_no_card : baseRows.length;
  /**
   * ★★★ 2026-11-07（T44 · 判据 ④ 的牙齿）：**`max_no_card` 字段缺失即红**。
   *   为什么：上面那一行的缺省是 `baseRows.length` ⇒ 删掉这个字段，上限就**自动**变成「当前登记条数」，
   *   与「把 6 条塞进 rows」是**同一个动作的两种写法**（比改数字还隐蔽）。⇒ 字段必须在。
   *   ★ `baseMax` 的取值逻辑一个字不动 —— 这里只加「它在不在」。
   */
  const maxDeclared = !!baseline && Object.prototype.hasOwnProperty.call(baseline, 'max_no_card');

  // ══════════════════════════════════════════════════════════════════
  // ★★★ 2026-11-07（T44 · 「已认账」档）：**冻结历史 · 每条有主 · 上界时点**
  //
  // ## 它治的是死结（不是「让门变绿」）
  // `write_log` 里的历史无卡写**永远补不了卡**（append-only；重贴通道 `RELABEL_UNTIL` 上界已永久关闭，
  // 见上面「上界之后仍贴错的恒红」那段）⇒ 只靠 `rows` + `max_no_card` 这一对，门只有两条路：
  // **永远红**，或**抬 max**（往 rows 加条目而不动 max 照样因 `N > baseMax` 红 ⇒ 塞 rows 就是抬 max 的前台）。
  // ⇒ 这一档把**上限**与**认账清单**分开，并给认账挂两道机械钩子：
  //   ① **每条有主**：`card` 必须能在 `listLiveCards` 里查到、且 `state ≠ void` —— 「无主」本身是缺陷；
  //   ② **新写塞不进来**：条目 `at` ≤ `ACKNOWLEDGED_UNTIL`；
  //   另加 ③ 条目必须仍对应一条真实无卡写（否则请删 = 「账只许变短」唯一还剩下的机械形态）。
  // ★★ 它与抬 max 的区别**只有这两点（① 与 ②）**。缺任一条，它就是抬 max 换了个名字 —— 写在这儿，
  //    别让下一个人以为它天然更干净。
  const ackUntilDeclared =
    typeof baseline?.acknowledged_until === 'string' ? baseline.acknowledged_until.trim() : '';
  const ackRaw = Array.isArray(baseline?.acknowledged) ? baseline.acknowledged : [];
  const ackRows = ackRaw.filter((x) => x && typeof x.key === 'string' && x.key.trim());
  const ackKeys = new Set(ackRows.map((x) => x.key));
  const noCardKeySet = new Set(noCard.map((r) => keyOf(r)));
  /** 活卡表（R1 的唯一读端）；读不到 ⇒ **判不了** ⇒ 红（0.12：判不了 ≠ 通过） */
  let liveCards = null;
  let liveCardsWhy = '';
  try {
    liveCards = listLiveCards(projectDir);
  } catch (e) {
    liveCardsWhy = `读不到活卡表（${(e && e.message) || e}）`;
  }
  const liveHitById = new Map((liveCards ?? []).map((c) => [c.id, c]));
  /** 认账条目自己的红（与 noCard 的判据分开列，便于一眼看出是哪一类） */
  const ackIssues = [];
  if (ackUntilDeclared && ackUntilDeclared !== ACKNOWLEDGED_UNTIL) {
    ackIssues.push(
      `基线的 acknowledged_until=${ackUntilDeclared} ≠ 脚本里冻结的 ${ACKNOWLEDGED_UNTIL}` +
        ` ⇒ **上界被挪动过**（禁令：一旦写入不许往后挪——挪一次就把一次性历史窗口变回永久逃逸通道）`,
    );
  }
  if (ackRows.length && !ackUntilDeclared) {
    ackIssues.push('有 acknowledged 条目却没有 acknowledged_until ⇒ 认账必须带上界时点（无上界 = 什么都能塞）');
  }
  for (const a of ackRows) {
    const who = a.key;
    if (String(a.reason ?? '').trim().length < 10) {
      ackIssues.push(`${who} —— 缺 reason（认账必须有理由，否则它是一块静音垫）`);
    }
    const cardId = String(a.card ?? '').trim();
    if (!cardId) ackIssues.push(`${who} —— **缺 card**（没有处置卡的认账不算认账，那是记旗）`);
    else if (liveCardsWhy) ackIssues.push(`${who} —— 判不了 card=${cardId}：${liveCardsWhy}`);
    else if (!liveHitById.has(cardId)) {
      ackIssues.push(
        `${who} —— card=${cardId} 在活卡表里**不存在**（认账必须指向真卡；编号、路径、文件节点 id 都不算）`,
      );
    } else if (liveHitById.get(cardId)?.state === 'void') {
      ackIssues.push(`${who} —— card=${cardId} 已 **void（作废）** ⇒ 认账失效（作废 = 没人处置了）`);
    }
    const atInKey = String(who).split('|')[0];
    if (a.at != null && String(a.at) !== atInKey) {
      ackIssues.push(`${who} —— data.at=${a.at} 与 key 里的 at=${atInKey} 不一致（同一件事两个说法）`);
    }
    if (ackUntilDeclared && atInKey > ackUntilDeclared) {
      ackIssues.push(
        `${who} —— 这条写的 at=${atInKey} **晚于认账上界 ${ackUntilDeclared}** ⇒ 新写不许认账（上界之后的无卡写必须红）`,
      );
    }
    if (baseKeys.has(who)) {
      ackIssues.push(`${who} —— 同一笔写**同时在 rows 和 acknowledged 里**（二选一；重复会让上限凭空变大）`);
    }
    if (!noCardKeySet.has(who)) {
      ackIssues.push(`${who} —— 这条**已经不在无卡写里了**（该行消失 / 被重新分类）⇒ 请把条目删掉（账只许变短）`);
    }
  }
  /** 真正被认账抵扣掉的条数（只认「对应得到真实无卡写」的那些；红了也照扣，读数才稳定） */
  const ackMatched = ackRows.filter((a) => noCardKeySet.has(a.key)).length;
  /** ★ 判定用的有效分子；**读数 `N` 仍是原始条数**（不许被打折 —— 折了就是把账扫到地毯下） */
  const noCardEffective = Math.max(0, N - ackMatched);
  const unbaselined = noCard.filter((r) => !baseKeys.has(keyOf(r)) && !ackKeys.has(keyOf(r)));
  const truncated = read.total > read.rows.length;
  const stale = baseRows.filter((x) => !noCard.some((r) => keyOf(r) === x.key));
  /**
   * ★★★ 2026-11-04（裁定 2）：**凭证未记的棘轮** —— 冻结历史（那 15 条是写端 bug 修之前产生的）+ **新增恒严**。
   * ★ 为什么不直接归零：它们是**真实发生过的**记录，不能装作没发生；但也不许继续增长
   *   —— 所以用第二个棘轮名单（`credential_missed`，每条带 reason）：名单外**新增一条就红**。
   * ★ 为什么不把它并进无卡写的分子：它不是“绕开设计线”（那支已经核到卡了），
   *   把它算成无卡写就等于把 G13 那个错再犯一遍（只是方向反了）。
   */
  const credKeys = new Set(
    (Array.isArray(baseline?.credential_missed) ? baseline.credential_missed : [])
      .filter((x) => x && x.key && String(x.reason ?? '').trim())
      .map((x) => x.key),
  );
  const credUnbaselined = credMiss.filter((r) => !credKeys.has(keyOf(r)));

  const fail = [];
  if (!closed)
    fail.push(
      `五格不闭合（有卡 ${M} + 该有卡而没卡 ${N} + 跳过 ${K} + 凭证未记 ${G} + 判不了 ${U} ≠ 全量 ${T}）—— 对账器自己有 bug，不许当通过`,
    );
  if (truncated) fail.push(`只读到 ${read.rows.length}/${read.total} 行（5000 行上限）⇒ 这一遍只对了一部分，不许当通过`);
  if (baselineError && (N > 0 || G > 0)) fail.push(`${baselineError}（无基线 ⇒ 判不了"只许不增"）`);
  if (!baselineError && noCardEffective > 0 && baseRows.length === 0 && ackRows.length === 0) {
    fail.push('基线里**没有一条**带 reason 的登记（空名单，也没有一条认账）⇒ 拒绝把整扇门关掉');
  }
  if (!maxDeclared) {
    fail.push(
      '基线里**没有 `max_no_card` 字段** ⇒ 缺省会落回 rows.length（等于抬上限）⇒ 不许（这是第二条抬 max 的路，比改数字还隐蔽）',
    );
  }
  if (unbaselined.length) {
    fail.push(`**新增**无卡写 ${unbaselined.length} 条（基线只许不增；既不在 rows 也不在 acknowledged）`);
  }
  if (noCardEffective > baseMax) {
    fail.push(`无卡写 ${N} 条（认账 ${ackMatched} 条后有效 ${noCardEffective}）> 基线上限 ${baseMax} 条`);
  }
  if (ackIssues.length) {
    fail.push(
      `认账档 ${ackIssues.length} 处不合规（每条认账都要「有主 · 在上界内 · 仍对应真实无卡写」）：\n     · ` +
        ackIssues.slice(0, 8).join('\n     · ') +
        (ackIssues.length > 8 ? `\n     · …… 另有 ${ackIssues.length - 8} 处` : ''),
    );
  }
  // ★ 判不了 ≠ 通过（0.12）：支名不在闭集里就不能归档，必须红。
  if (U > 0)
    fail.push(
      `${U} 行的 gate_branch 不在 TaskGateBasis 闭集里 ⇒ 判不了它该不该有卡：` +
        unknown.slice(0, 5).map((r) => `${r.at}|${r.file}`).join(' / '),
    );
  // ★ 裁定 2：凭证未记的棘轮 —— 冻结历史 + 新增恒严。
  if (credUnbaselined.length)
    fail.push(
      `**新增**「有卡但凭证没记下」${credUnbaselined.length} 条（G13 已修：A7 拿不到 actor 也照样记卡 ⇒ 新增一条就是写端回退）`,
    );
  // ★ F2 的闸：缺 path 的 file/doc 节点必须为 0（不为 0 ⇒ unaddressable 支复活 ⇒ 未入册就写会被跳过）。
  if (covError) fail.push(covError);
  else if (covUnaddressable > 0)
    fail.push(
      `全仓有 ${covUnaddressable} 个 file/doc 节点**缺 path** ⇒ unaddressable 支复活（“未入册就写”会被当成判不了而跳过）` +
        `—— 给它们补 path，或把非文件节点的 type 改掉`,
    );
  // ★ D1 上界之后恒红：把「环境态」与「F3 真 bug」分开（这条诊断比“纠正几行”有用得多）。
  // ★★ 第⑬项 Java ② 收口（2026-11-11 · lead 批准方案 a）：**已认账的 relabelLate 行不计**——
  //   append-only 历史记录 vs 现时状态的**分类漂移**（路径后来入册 + excluded 声明 ⇒ 历史行的
  //   files-not-in-design 分类被今天的 excluded 重判为"该改喂 exempt"）——这正是认账机制的
  //   适用形态：历史行冻结当时的合法分类，今天的 excluded 只对**新写**生效。
  //   ⇒ 过滤：relabelLate 里已进 acknowledged（key 对上）的行不计入恒红；剩下的才是真 F3 嫌疑。
  const relabelLateUnacknowledged = relabelLateRows.filter((r) => {
    const k = `${r.at}|${r.file}|${r.kind}`;
    return !ackKeys.has(k) && !baseKeys.has(k);
  });
  if (relabelLateUnacknowledged.length)
    fail.push(
      `上界（${RELABEL_UNTIL}）之后仍有 ${relabelLateUnacknowledged.length} 条「files-not-in-design 但该路径在册级 excluded 里」` +
        ` ⇒ 诊断二选一：① **旧 dist 还在跑**（重启 agent-io MCP server 后应为 0）；` +
        `② 重启后仍出现 ⇒ **册级 excluded 没真生效（F3 有 bug）**。逐条：` +
        relabelLateUnacknowledged.slice(0, 5).map((r) => `${r.at}|${r.file}`).join(' / '),
    );

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: fail.length === 0,
          project_dir: projectDir,
          tasks_db: tasksDb,
          read: { fetched: read.rows.length, total: read.total, truncated },
          total: T,
          with_card: M,
          no_card: N,
          // ★ 四数并列（0.12③ 分子与跳过同时给）+ 凭证未记 + 判不了
          cardability: { counted_no_card: N, skipped_not_cardable: K, credential_missed: G, unknown_branch: U, total: T },
          denominator_closed: closed,
          by_branch: Object.fromEntries(branches),
          skipped_by_branch: Object.fromEntries(skipBranches),
          excluded: Object.fromEntries(dropped),
          baseline: {
            file: baselineFile,
            error: baselineError || undefined,
            entries: baseRows.length,
            max_no_card: baseMax,
            max_no_card_declared: maxDeclared,
          },
          acknowledged: {
            until: ACKNOWLEDGED_UNTIL,
            declared: ackUntilDeclared || undefined,
            entries: ackRows.length,
            matched: ackMatched,
            effective_no_card: noCardEffective,
            cards: ackRows.map((a) => {
              const hit = liveHitById.get(String(a.card ?? ''));
              return {
                key: a.key,
                card: a.card ?? null,
                card_state: hit ? hit.state : null,
                card_owner: hit && hit.card ? (hit.card.owner ?? null) : null,
              };
            }),
            issues: ackIssues,
          },
          unbaselined: unbaselined.map((r) => ({ at: r.at, file: r.file, actor: r.actor, source: r.source, branch: r.gate_branch })),
          credential_missed_total: G,
          credential_unbaselined: credUnbaselined.map((r) => ({ at: r.at, file: r.file, actor: r.actor, branch: r.gate_branch })),
          unknown_branch_rows: unknown.map((r) => ({ at: r.at, file: r.file, branch: r.gate_branch })),
          stale_baseline: stale.map((x) => x.key),
          failures: fail,
          boundary: BOUNDARY,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('════ 无卡写账（verify 门 · write_log 第三本账 · 只读）════');
    console.log(`项目：${projectDir}`);
    console.log(`库：  ${tasksDb}`);
    console.log(
      `读到：${read.rows.length} 行（库内共 ${read.total} 行${truncated ? ' · ★ 已截断（5000 行上限）' : ''}）`,
    );
    console.log('');
    console.log(`★ 总写入 ${T} 条 · 有卡 ${M} · **无卡 ${N}**（五格互斥穷尽 ⇒ ${closed ? 'true' : 'false'}）`);
    // ★ 2026-11-04：三个数一起给（0.12③）—— 只看分子等于没验。
    console.log(
      `★ 分诊四数：**该有卡而没卡 ${N}**（分子）· 不该有卡跳过 ${K} · 凭证未记 ${G}（另计，棘轮管）· 全量 ${T}` +
        (U ? ` · ★ 判不了 ${U}（支名不在闭集里）` : ''),
    );
    // ★★ 2026-11-04（裁定 1/2）：两个棘轮都要把「历史冻结 / 新增」两个数一起印（0.12③）。
    console.log(
      `  ★ 凭证未记棘轮：历史冻结 ${credKeys.size} · 新增 ${credUnbaselined.length}（新增 > 0 ⇒ 红；名单**只许缩小**，修好一条删一条 —— 禁止把新出现的塞进去）`,
    );
    console.log(
      `  ★ 认账档（冻结历史 · 每条有主 · 上界 ${ACKNOWLEDGED_UNTIL}）：登记 ${ackRows.length} 条 · 抵扣 ${ackMatched} · ` +
        `**计入分子 ${N} − 认账 ${ackMatched} = 有效 ${noCardEffective}**（上限 ${baseMax}${maxDeclared ? '' : '，★ 基线缺 max_no_card 字段'}）`,
    );
    if (ackRows.length) {
      console.log(
        '     处置卡（R1 现验活卡表）：' +
          ackRows
            .map((a) => {
              const hit = liveHitById.get(String(a.card ?? ''));
              const st = hit ? `${hit.state}${hit.card && hit.card.owner ? '/' + hit.card.owner : '/无主'}` : '查不到';
              return `${a.card ?? '(缺卡)'}@${st}`;
            })
            .join(' · '),
      );
    }
    console.log(
      `  ★ unaddressable：历史 ${historicalUnaddressable} 条（冻结）· 新增上限 0（判据：全仓缺 path 的 file/doc 节点 = ${covUnaddressable}${covError ? '，★ ' + covError : ''}）`,
    );
    console.log(
      `  ★ 旧支名纠正上界 = ${RELABEL_UNTIL}（一次性历史纠正；**上界不许往后挪** —— 挪一次就变回永久逃逸通道）· 上界后仍贴错 ${relabelLateRows.length} 条`,
    );
    if (relabeledRows.length) {
      console.log(
        `  ★ 旧支名纠正 ${relabeledRows.length} 行（files-not-in-design ⇒ exempt）：这些路径在册级 excluded 里，` +
          `旧闸（F3 之前）读不到册级声明才贴错；分诊仍由 domain/task_gate_basis 判，逐条可查：` +
          relabeledRows.slice(0, 5).map((r) => `${r.at}|${r.file}`).join(' / '),
      );
    }
    console.log(
      '  ★ 「无卡」的判据 = 该有卡而没卡（唯一判定式 = domain/task_gate_basis#countsAsNoCardWrite）' +
        ' —— 只有这一格进分子；covered/authorized 的 card_id 空是「凭证没记下」(G13)，' +
        'exempt/unaddressable 是「结构上不可能有卡」(G17)。',
    );
    const droppedTotal = [...dropped.values()].reduce((a, b) => a + b, 0);
    console.log(
      `★ 已排除 ${droppedTotal} 行（非用户源码的写，按现有权威分类）：${
        droppedTotal ? [...dropped.entries()].map(([k, v]) => `${k} ${v}`).join(' · ') : '（无）'
      }`,
    );
    if (branches.length) {
      console.log(
        '按支分组（**kept 全量**，不是“无卡”那批 —— 分母不许被自己的定义偷换）：' +
          branches.map(([b, n]) => `${b || '(无支名)'} ${n}`).join(' · '),
      );
    }
    if (skipBranches.length) {
      console.log(
        '  ★ 被跳过（结构上不可能有卡）按支：' + skipBranches.map(([b, n]) => `${b || '(无支名)'} ${n}`).join(' · '),
      );
    }
    console.log('');
    console.log(
      `基线：${path.relative(repoRoot, baselineFile).split(path.sep).join('/')} —— ` +
        `登记 ${baseRows.length} 条 / 上限 ${baseMax} 条${baseline?.note ? `（${baseline.note}）` : ''}`,
    );
    if (baselineError) console.log(`  ★ ${baselineError}`);
    if (stale.length) {
      console.log(`  ★ 已消失的基线条目 ${stale.length} 条（可删；不影响判定）：`);
      for (const x of stale.slice(0, 10)) console.log(`     · ${x.key}`);
    }
    console.log('');
    if (!unbaselined.length) {
      console.log('新增无卡写：无（每一行无卡写都在基线里登记过）');
    } else {
      console.log(`★ **新增**无卡写 ${unbaselined.length} 条（逐条点名；基线只许不增）：`);
      unbaselined.slice(0, listLimit).forEach((r, i) => {
        console.log(fmtRow(r, i) + `  ★ 新`);
      });
      if (unbaselined.length > listLimit) console.log(`  …… 另有 ${unbaselined.length - listLimit} 条`);
    }
    console.log('');
    console.log('★ 本账的**已声明边界**（0.17①）：');
    console.log(`  ${BOUNDARY}`);
    console.log('');
    if (fail.length) {
      console.log('FAIL  无卡写账：');
      for (const f of fail) console.log(`   · ${f}`);
    } else {
      console.log(
        `PASS  无卡写账：总写入 ${T} · 有卡 ${M} · **无卡 ${N}**（其中认账 ${ackMatched} 条有主 · 有效 ${noCardEffective} ≤ 上限 ${baseMax}）`,
      );
    }
  }
  process.exit(fail.length ? 1 : 0);
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        project_dir: projectDir,
        tasks_db: tasksDb,
        read: { fetched: read.rows.length, total: read.total, truncated: read.total > read.rows.length },
        no_card: N,
        with_card: M,
        total: T,
        denominator_closed: closed,
        by_branch: Object.fromEntries(branches),
        excluded: Object.fromEntries(dropped),
        boundary: BOUNDARY,
        rows: noCard.slice(0, listLimit),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log('════ write_log 对账（「无卡变更」第三本账 · 只读）════');
console.log(`项目：${projectDir}`);
console.log(`库：  ${tasksDb}`);
const truncNote =
  read.total > read.rows.length ? ` · ★ 已截断（上限 5000 行），下面 N/M 只是这 ${read.rows.length} 行的` : '';
console.log(`读到：${read.rows.length} 行（库内共 ${read.total} 行${truncNote}）`);
console.log('');
console.log(`★ 无卡写（该有卡而没卡）${N} 条 / 有卡写 ${M} 条 / 跳过（结构上不可能有卡）${K} 条 / 凭证未记 ${G} 条 / 总 ${T} 条`);
console.log(
  `★ 五格互斥穷尽：有卡 ${M} + 该有卡而没卡 ${N} + 跳过 ${K} + 凭证未记 ${G} + 判不了 ${U} = 全量 ${T} ⇒ ${closed ? 'true' : 'false'}`,
);
if (!closed) console.log('  ★★ 不闭合 = 本脚本的分组有 bug（不许当成"没问题"读）。');
console.log('');
if (branches.length) {
  console.log('按支分组（**kept 全量**）—— ★ 这一行直接量化「豁免面放行/跳过了多少写」：');
  for (const [b, n] of branches) console.log(`  · ${(b || '(无支名)').padEnd(24)} ${String(n).padStart(4)} 条`);
  console.log('');
}
if (skipBranches.length) {
  console.log('被跳过（结构上不可能有卡）按支：');
  for (const [b, n] of skipBranches) console.log(`  · ${(b || '(无支名)').padEnd(24)} ${String(n).padStart(4)} 条`);
  console.log('');
}
const droppedTotal = [...dropped.values()].reduce((a, b) => a + b, 0);
console.log('排除分母（非用户源码的写，按现有权威分类）:');
if (!droppedTotal) console.log('  （无 —— 本次读到的每一行都落在用户源码路径上）');
else {
  console.log(`  已排除 ${droppedTotal} 行：${[...dropped.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log('  ★ 分类口径：classifyWriteSubject（产物/临时/根外）· isUnderSkippedDir（索引跳过的目录）· shouldSyncRel（非源码扩展名）');
}
console.log('');
console.log('★ 未覆盖分母（已声明边界）：');
console.log(`  ${BOUNDARY}`);
console.log('');
console.log(`逐条名单（无卡写，前 ${Math.min(listLimit, N)} / 共 ${N} 条）:`);
if (!N) console.log('  （无 —— 本次读到的写全部挂了任务卡）');
else noCard.slice(0, listLimit).forEach((r, i) => console.log(fmtRow(r, i)));
console.log('');
console.log('★ 本脚本只读：不改 state、不建库、不建表、不开卡。');
