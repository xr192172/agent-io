/**
 * T205 出生证：**先测"拆分链"好不好用，再决定接不接** —— ★ 结果：**识别层好用；但汇总层原本在撒谎（已修）**
 *
 * ## 用户的要求（逐字）
 * > *"你先看看它的这个功能实现的怎么样吧，因为它的功能不一定好用，你先测过去看它好不好用，好用的话再去接。
 * >   而且能不能判不应该你决定吗？因为我又不知道 JSON 是什么形式。我甚至不知道这个功能是干嘛的，能拆出什么产物。"*
 * ⇒ ★ 所以就一件事：**真跑它，看它好不好用** —— ★ 而不是先接线。
 *
 * ## 这个功能是干嘛的（★ 人话）
 * ★ **找出"一个文件里塞了好几种职责"的文件**，然后**按职责簇把它切成几个独立文件**：
 *   · 第一棒 `signal_review`：跑 `brickify` 找"混合文件"信号 → 逐个喂 LLM（读全文+注释）⇒ **逐簇「采纳/驳回」+ 积木名 + 理由**
 *   · 最后一棒 `split_stage`：把**判"采纳"的簇**切出去（★ 默认只出草稿；`apply=true` 才落盘，带编译/测试验收 + 失败回滚）
 *
 * ## ★★ 测出来的三件事
 * 1. ★★ **识别层好用**（真跑 ✓）：夹具里我埋了 **4 簇**（会话/SECRET · 金额 · CSV · 旧世代金额），
 *    `signal_review` **4 簇全中** ⇒ ★ "找出混合文件并分簇"这一层是**可靠的** ✓
 * 2. ★★ **LLM 判定层【这次没测到】**：本机网关**所有 key 均在冷却窗口内** ⇒ LLM 一次都没跑成
 *    ⇒ ★ **"判得准不准"我**没法**确认** ✓（★ 如实标注，不当成"好用"）
 *    ★ 但它**没有伪造结论** ✓（`reviews: []` + `note` 写明失败原因）
 * 3. ★★★ **汇总层原本在撒谎**（★ 这是本次最值钱的发现，已修）：
 *    修前回执照抄：`1 个信号 → 0 个需拆(采纳) / **1 个驳回**。`
 *    ⇒ ★ 而真相是 **LLM 没跑、谁都没判** ⇒ 读者会得出"**工具判定这个文件不该拆**"的**错结论** ✗
 *    ⇒ ★★ 而下游 `split_stage` **只认"采纳"** ⇒ **静静地什么都不拆，还回 `ok: true`** ✓
 *    ⇒ 这就是本仓一直在治的「**猜错不报错，只会静静地接错**」✓
 *
 * ## 改了三处（★ 判据都只住一处）
 * 1. `signal_review.ts`：`rejected = 总数 − actionable` ⇒ **改成三分**：
 *    采纳 / 驳回（**判过**的）/ ★ **未判**（`reviews.length === 0` —— ★ 判据只此一处）
 * 2. `signal_review.ts`：`llm_available` **原先写死 `true`** ⇒ 改成**由失败情况推出**（LLM 真失败过就说 false）
 * 3. `index.ts`：汇总行 + `split_stage` 的 handler **都把"未判"单独说出来**（★ 带 `llm_available=false` 的提示）
 *
 * ## ★ 一个明说**没测到**的东西（如实）
 * ★ **LLM 真判过时，汇总行长什么样**？—— ★ 测不了（本机 LLM 不可用）⇒ ★ 本证**不假装验过** ✓
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (tool, args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  return out;
};

// ★★★ T223（2026-10-13）：**工作副本放进 temp**（★ 治的是"护栏把本证打死"这个真病）
//   · ★ 宿主的删除护栏**按"删掉的【条目数】"计数**（不是按调用次数）—— ★ 证据是它自己的报错原文：
//     `{"count":51,"threshold":50,"targetCount":1}` ⇒ ★ 只 1 个调用（targetCount:1）却数到 51 ✓
//   · ★★ ⇒ T214 续4 那条注释（"按【调用次数】计数…N 次 → 1 次"）**是错的** ✗：
//     那个修法**没修掉护栏**，只是把失败点从"多次小删"挪到"一次大删" ⇒ ★ 本证**死在 reset 行、
//     一条断言都没跑**（而它在套件里只显示"崩"，★ 看起来像环境噪声 —— 其实它是**坏证** ✓）
//   · ⇒ ★ 改到 `os.tmpdir()` 下：shim 对 temp 路径**整体绕过**护栏
//     （`node-safe-delete-shim.cjs` 的 `shouldBypassSafeDelete` ⇒ `isUnderAnyTempDir` ✓）
//   · ★ 附带：temp 在【仓外】⇒ 项目扫描器不会像跳过 `.inspect/` 那样把它整片跳过 ✓
//   ⇒ ★ 每次运行拷一份**全新副本** ⇒ ★ **"还原被自己改坏的前提"这一步整个不需要了** ✓（0 次删除 ✓）
const TEMPLATE = 'certs/t205-fixture';                      // ★ 只读模板：本证【永不删它】
if (!fs.existsSync(TEMPLATE)) {
  console.log(`★★ 夹具模板不在（${TEMPLATE}）—— 本证无法自足，先停手。`);
  process.exit(2);
}
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t205-'));
fs.cpSync(TEMPLATE, FIX, { recursive: true });
const SRC = `${FIX}/src`;
const ORIG = `${FIX}/mixed.ts.orig`;   // ★ 快照放【src 之外】—— ★ 否则重置 src 时把它也删了 ✗
const REPORT = `${FIX}/review.json`;
if (!fs.existsSync(ORIG)) {
  console.log(`★★ 模板里缺快照 ${ORIG} —— 本证无法自足，先停手。`);
  process.exit(2);
}
// ★★★ 重置这一步**必须在**（★ 我第一版跳过它 ⇒ **实测红** ✓）——
//   ★ 理由是"全新副本 ⇒ 天然干净"，★ **那是错的**：★★ **模板自己的 `src/mixed.ts` 是【脏的】**
//   （上一次跑留下的**已拆开**版本，旁边还躺着 `money-format.ts` / `token-session.ts`）✓
//   ⇒ ★ 干净来自 **`.orig` 那份真原样**，不来自"副本新"✓（判据见 `t212-regex-vs-ast.mjs` 同段注 ✓）
//   ★ 而重置放在 temp 里 ⇒ ★ shim 对 temp **整体绕过**护栏（★ 这条才是 T223 真正的修法 ✓）
fs.rmSync(SRC, { recursive: true, force: true });   // ★ 在 temp ⇒ 不计入护栏 ✓
fs.mkdirSync(SRC, { recursive: true });
fs.copyFileSync(ORIG, `${SRC}/mixed.ts`);           // ★ 读【src 之外】那份真原样 ✓

console.log('══ ① 先证"它真跑了"（★ 不是静默失败）');
const sr = call('signal_review', { project_dir: FIX, report_path: REPORT });
chk(/个信号/.test(sr), '①-a `signal_review` 有回执', sr.split('\n')[0].slice(0, 80));
chk(fs.existsSync(REPORT), '①-b ★ 报告真的落盘了', REPORT);

console.log('\n══ ② ★★ 识别层好不好用（★ 用户在意的"好不好用"）');
const rep = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const clusters = (rep.signals_scanned ?? []).flatMap((s) => (s.clusters ?? []).map((c) => c.join('+')));
chk(clusters.length >= 3, '②-a ★ 它把夹具里的混合文件**分出了多个簇**', `簇数=${clusters.length}`);
chk(clusters.some((c) => /signToken|verifyToken|SECRET/.test(c)), '②-b ★ 认出了【会话 token】那一簇');
chk(clusters.some((c) => /toCsv|downloadCsv/.test(c)), '②-c ★ 认出了【CSV 导出】那一簇');
chk(clusters.some((c) => /formatMoney/.test(c)) && clusters.some((c) => /formatMoneyLegacy/.test(c)), '②-d ★ 认出了【金额】与【旧世代金额】两簇（★ 我埋的"两代并存"也没漏）');

console.log('\n══ ③ ★★★ 汇总层不再撒谎（★ 本次最值钱的发现）');
// ★★★ T209：**断言【不变式】，不断言【当时的状态】** ——
//   我原先写的是"报告里 `undecided === 1` / `llm_available === false`"，★ 而那**只在 LLM 挂着时成立** ⇒
//   ★★ 今天链路恢复、LLM 判成功了 ⇒ 断言**假红** ✗（★ 一张"依赖服务恰好坏着"的证书不是证书）。
//   ⇒ 改成**两种状态各自的不变式**，无论 LLM 通不通都成立 ✓：
//     · **通**（`llm_available === true`）⇒ 不许有"未判"（`undecided === 0`）✓
//     · **不通**（`false`）⇒ 必须有未判、且**回执里【明说】这不是"驳回"** ✓
const meta = rep.review?.meta ?? {};
const llmOk = meta.llm_available === true;
chk(!/个驳回。$/.test(sr) || !/1 个驳回/.test(sr), '③-a ★ 不再把"没判成"写成"驳回"', sr.split('\n')[0].slice(0, 70));
if (llmOk) {
  chk(meta.undecided === 0, '③-b ★【LLM 通】⇒ 不该有"未判"', `undecided=${meta.undecided} actionable=${meta.actionable} rejected=${meta.rejected}`);
} else {
  chk(/未判/.test(sr), '③-b ★★【LLM 不通】⇒ 回执**明说**有"未判"、且说"这不是驳回"');
  chk(/llm_available = false/.test(sr) || /LLM 不可用/.test(sr), '③-c ★ 并点了原因是 LLM 不可用');
}
chk((meta.actionable ?? 0) + (meta.rejected ?? 0) + (meta.undecided ?? 0) === (meta.total_signals ?? -1),
  '③-d ★★ **三数相加 = 信号总数**（不多不少 —— ★ 这是"三分"的不变式）',
  `采纳 ${meta.actionable} + 驳回 ${meta.rejected} + 未判 ${meta.undecided} = ${meta.total_signals}`);
chk(!(meta.undecided > 0 && meta.llm_available === true),
  '③-e ★★ **"有未判" 与 "llm_available=true" 不许同时成立**（★ 那正是 T205 修掉的谎）',
  `llm_available=${meta.llm_available} undecided=${meta.undecided}`);
chk(meta.rejected === undefined || meta.rejected === (meta.total_signals ?? 0) - (meta.actionable ?? 0) - (meta.undecided ?? 0),
  '③-f ★ `rejected` **只算"判过的驳回"**（不再把"没判成"算进去）', `rejected=${meta.rejected}`);

console.log('\n══ ④ ★★ 第二棒也不再说"成功"就完事（★ 整条链的诚实）');
// ★★★ T209：同 ③ —— ★ **断言不变式**：★ 第二棒的表现必须**跟着报告里的"未判"数走** ✓
//   · 报告有未判（`meta.undecided > 0`）⇒ ★ **必须明说"0 簇不代表判定不该拆"** ✓
//   · 报告没未判（LLM 通了）⇒ ★ **不许**凭空说"未判"（那也是一种误导）✓
const ss = call('split_stage', { project_dir: FIX, report_path: REPORT });
const ssUndecided = (meta.undecided ?? 0) > 0;
chk(/个采纳簇/.test(ss), '④-a `split_stage` 跑了', ss.split('\n')[0].slice(0, 60));
if (ssUndecided) {
  chk(/未判/.test(ss) && /不代表"判定不该拆"/.test(ss), '④-b ★★【报告有未判】⇒ 它明说"0 簇**不代表判定不该拆**"');
  chk(/LLM 不可用/.test(ss), '④-c ★ 并给了下一步：恢复 LLM 后重跑 `signal_review`');
} else {
  chk(!/未判/.test(ss), '④-b ★【报告无未判（LLM 通了）】⇒ **不许**凭空说"未判"（那也是一种误导）', ss.split('\n').slice(-1)[0].slice(0, 80));
}

console.log('\n══ ⑤ 反例：**没改错东西**（★ 别把对的也改了）');
const src = fs.readFileSync('src/application/design/bricks/signal_review.ts', 'utf8');
chk(/const undecided = reviews\.filter/.test(src), '⑤-a 判据只住在 `signal_review.ts` 一处（`reviews.length === 0`）');
chk(/llm_available: !llmFailed/.test(src), '⑤-b `llm_available` 由**失败情况**推出（不再写死）');
chk(/默认 dry_run|dry-run/.test(ss), '⑤-c ★ `split_stage` 的默认仍是 **dry-run**（★ 没被我碰坏）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('★ 未测到（如实）：**LLM 真判过时**汇总行长什么样 —— 本机 LLM 不可用（key 全在冷却窗口）⇒ 不假装验过。');
console.log('★★ 而"能不能接这条链"的结论：★ **先不接** —— 第一棒的**判定层**这次没跑成，');
console.log('   ★ "好用"还不成立（识别层好用 ✓、判定层未验 ✗）⇒ ★ 等 LLM 可用、真判过一轮之后再接。');
