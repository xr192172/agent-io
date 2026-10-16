#!/usr/bin/env node
/**
 * ★★★ cert T347 —— **回执五栏完整性检查器**的出生证（2026-10-16，滞涩 #3 · `docs/preflight-checklist.md` C0）。
 *
 * ## 这一笔要钉住什么
 * `docs/frictions.jsonl` 滞涩 #3：**子代理只回一句"已修好"**，主代理只能自己重跑核验
 * （实测 1 次抓到"报真绿而实际 `unsupported=2`"）。
 * C0 定了"回执强制五栏"（① 做了什么 ② 判据读数 ③ `[未核]` ④ 行为改变 ⑤ 滞涩报告），
 * 但**只是文字约定、没人检查**。本笔把它落成 `scripts/check-receipt.mjs`（纯规则、缺栏 ⇒ exit 1）
 * + 本证。★ 判据：**检查器真的能判，且判得准** —— 光"文件存在"是空判据（本仓 G5 的形状）。
 *
 * ## 判据（★ 每条都亲手跑、贴读数）
 *   (a) **坏样例必夹具**：一句 `"已修好"` ⇒ 必须 **exit 1**，且**五栏全判缺**（= 抓住滞涩 #3 那种回执）；
 *   (b) **能判出"缺哪一栏"**：一份只缺 ⑤滞涩报告 的回执 ⇒ exit 1，且**点名的正是那两栏**（其余不冤枉）；
 *   (c) **正例 ⇒ exit 0**：五栏齐的回执 ⇒ exit 0 且报 "5/5"；
 *   (d) **JSONL 行模式**（"或 `docs/accounting.jsonl` 的一行"）：五栏齐的 JSON 对象 ⇒ exit 0；
 *       ★ 顺带用**真台账最后一行**如实读数：老格式回执会**被判缺栏**（该检查器**管的是新回执**）；
 *   (e) ★★ **纯规则可复现**：同一夹具跑两遍 ⇒ **输出逐字相同**（无 LLM / 无时间戳 / 无随机性）；
 *   (f) ★ **守门**：检查器**不许**把 bear 样例放过（要求 (a) 的 pass 数恰为 0）。
 *
 * ## 用法
 *   node certs/t347-receipt-completeness-cert.mjs     # ★ 不需要 build（检查器是纯 node 脚本）
 * ★ 夹具住 `certs/.work/tmp347-check`；★ 不打开真仓 `cache.db`、不碰 `.agent-io/`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.work/tmp347-check');
fs.mkdirSync(TMP, { recursive: true });

const CHECKER = path.join(ROOT, 'scripts/check-receipt.mjs').replace(/\\/g, '/');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 跑检查器：返回 {rc, out}。 */
const run = (fileArg) => {
  const r = spawnSync(process.execPath, [CHECKER, fileArg], { cwd: ROOT, encoding: 'utf8', shell: false });
  return { rc: typeof r.status === 'number' ? r.status : -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

// ── 夹具（★ 五栏的形态；坏例子就是滞涩 #3 里那句话）──
const FIX = {
  // (a) 坏例：滞涩 #3 的原话，一句
  badOneLiner: '已修好',
  // (b) 坏例：四栏齐、只缺 ⑤滞涩报告
  badMissingFriction: [
    '做了什么：修了 expectations.ts:335-337 的扩展名口径',
    '判据读数：exit=0 · PASS=10 FAIL=0',
    '[未核] 无',
    '行为改变：某些 edge-exists 由 fail 变 unsupported',
  ].join('\n'),
  // (c) 正例：五栏齐
  good: [
    '做了什么：修了 expectations.ts:335-337 的 type-only 排解（basename 去扩展名再比）',
    '判据读数：t346 PASS=10 FAIL=0 · exit=0 · npm run verify 4/4 · md5 未变',
    '[未核] 全仓同名不同目录的 basename 唯一性未枚举',
    '行为改变：某些 edge-exists 由 fail 变 unsupported（不产生 pass）',
    '滞涩报告：检查器 ② 栏在"只有散文、无读数令牌"时会误判缺失',
  ].join('\n'),
};
const files = {};
for (const [k, v] of Object.entries(FIX)) {
  files[k] = path.join(TMP, `${k}.txt`).replace(/\\/g, '/');
  fs.writeFileSync(files[k], v, 'utf8');
}

// (d) JSONL 行模式：五栏齐的 JSON 对象（① 取 what 字段，②③④⑤ 在 note 里）
const goodJsonl = path.join(TMP, 'good.jsonl').replace(/\\/g, '/');
fs.writeFileSync(
  goodJsonl,
  JSON.stringify({
    at: '2026-10-16',
    n: '81',
    what: '回执五栏检查器 + 证 t347 落地',
    tools: ['scripts/check-receipt.mjs', 'certs/t347-receipt-completeness-cert.mjs', 'npm run build', 'npm run verify'],
    note: [
      '做了什么见 what 字段。',
      '判据读数：t347 PASS/FAIL 见汇总行 · exit=0 · npm run verify 4/4 · md5 记录见 note 尾。',
      '[未核] 老台账（n<=80）不合五栏格式，未逐条回填。',
      '行为改变：新增 scripts/check-receipt.mjs（新文件，不改既有路径行为）。',
      '滞涩报告：无（本笔的滞涩已单独记 frictions.jsonl）。',
    ].join(' '),
  }),
  'utf8',
);

console.log('════ 0. 夹具就位（临时根 + 纯 node 检查器，不碰真仓）════');
console.log(`   检查器 = ${CHECKER}\n   夹具根 = ${TMP}`);

// ── (a) 坏例：一句"已修好" ⇒ exit 1 且五栏全缺 ──
{
  const { rc, out } = run(files.badOneLiner);
  console.log('\n════ (a) 坏样例（滞涩 #3 的原话）════');
  console.log(out.trim().split('\n').slice(0, 3).join('\n'));
  chk(rc === 1, '(a) 一句「已修好」⇒ **exit 1**（抓住滞涩 #3 那种回执）', `rc=${rc}`);
  chk(/缺 5 栏/.test(out), "(a') 五栏**全判缺**（不是蒙一个）", `命中「缺 5 栏」= ${/缺 5 栏/.test(out)}`);
  chk(/完整性：0\/1/.test(out), '(a\'\') 该坏例 pass 数 **恰为 0**（★ 守门：不许放过）', `命中= ${/完整性：0\/1/.test(out)}`);
}

// ── (b) 能判出"缺哪一栏" ──
{
  const { rc, out } = run(files.badMissingFriction);
  console.log('\n════ (b) 四栏齐、只缺 ⑤滞涩报告 ════');
  console.log(out.trim().split('\n').filter((l) => /缺|⇒/.test(l)).slice(0, 3).join('\n'));
  chk(rc === 1, '(b) 缺栏 ⇒ **exit 1**', `rc=${rc}`);
  chk(/缺栏：⑤滞涩报告/.test(out) && !/①|②/.test(out.split('缺栏：')[1] ?? ''), '(b\') 点名的**正是 ⑤滞涩报告**（不冤枉其它栏）', `缺栏行=${(out.match(/缺栏：[^\n]*/) ?? [''])[0]}`);
  chk(/^ {4}✓ ① 做了什么/m.test(out) && /^ {4}✓ ④ 行为改变/m.test(out), '(b\'\') ①④ 判为**有**（检查器逐栏判，不是"一缺全缺"）', '');
}

// ── (c) 正例 ⇒ exit 0 ──
{
  const { rc, out } = run(files.good);
  console.log('\n════ (c) 正例（五栏齐）════');
  console.log(out.trim().split('\n').filter((l) => /5\/5|完整性/.test(l)).join('\n'));
  chk(rc === 0, '(c) 五栏齐 ⇒ **exit 0**', `rc=${rc}`);
  chk(/5\/5 栏齐/.test(out) && /完整性：1\/1/.test(out), "(c') 报「5/5 栏齐」且 pass 数 1/1", '');
}

// ── (d) JSONL 行模式 ──
{
  const good = run(goodJsonl);
  console.log('\n════ (d) JSONL 行模式（what 字段 + note）════');
  console.log(good.out.trim().split('\n').filter((l) => /5\/5|完整性|JSON/.test(l)).join('\n'));
  chk(good.rc === 0, '(d) 五栏齐的 **JSONL 行** ⇒ exit 0（① 取 what 字段）', `rc=${good.rc}`);

  // ★ 如实对照：**老格式**台账行 —— 检查器**管的是新回执**，老行会被判缺栏。
  //   ★★ 夹具必须**确定**：早先这里取"台账最后一行"，本证随即在批跑里红了 ——
  //      因为本笔自己往台账追加了一条**合规**行（n=81），"最后一行"从"缺栏"变成了"合规"。
  //      ⇒ 判据 = "台账的最后一行"这件事**会随台账增长而变** ⇒ 那不是可复现的夹具。
  //   ★ 现取**首行**（台账是 append-only ⇒ 首行恒为最早的老行）+ 全量统计（"被判缺栏的行数"），
  //      两者都不依赖"末行是谁"。
  const acctLines = fs.readFileSync(path.join(ROOT, 'docs/accounting.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
  const tmpAcct = path.join(TMP, 'acct-first.jsonl').replace(/\\/g, '/');
  fs.writeFileSync(tmpAcct, acctLines[0], 'utf8');
  const { rc, out } = run(tmpAcct);
  const missing = (out.match(/缺栏：[^\n]*/) ?? ['(无)'])[0];
  const legacy = (() => {
    let n = 0;
    const one = path.join(TMP, '_one.jsonl').replace(/\\/g, '/');
    for (const l of acctLines) {
      fs.writeFileSync(one, l, 'utf8');
      if (run(one).rc !== 0) n++;
    }
    return n;
  })();
  const firstN = JSON.parse(acctLines[0]).n;
  console.log(`   ★ 对照：台账**首行**（n=${firstN}，append-only ⇒ 恒为老格式）⇒ rc=${rc} · ${missing}`);
  console.log(`   ★ 对照：台账现共 ${acctLines.length} 行，其中**被判缺栏** ${legacy} 行（老格式回执不回填）`);
  chk(rc === 1, `(d') ★ 对照：**老格式台账行被判缺栏**（取首行 n=${firstN}，不依赖"末行是谁"）`, `rc=${rc} · ${missing}`);
  chk(legacy >= 1, "(d'') ★ 统计自足：台账里**至少有一行**被判缺栏（该检查器管**新**回执，不回填历史）", `判缺栏 ${legacy}/${acctLines.length} 行`);
}

// ── (e) ★★ 纯规则 ⇒ 可复现（同一夹具两遍，输出逐字相同）──
{
  const a = run(files.good);
  const b = run(files.good);
  chk(a.rc === b.rc && a.out === b.out, '(e) ★★ 纯规则可复现：同一夹具跑两遍 ⇒ **输出逐字相同**（无 LLM / 无随机 / 无时间戳）',
    `rc ${a.rc}=${b.rc} · 输出相同=${a.out === b.out} · 长度=${a.out.length}`);
}

// ── (f) ★ 守门：检查器源码里**没有**任何 LLM/网络调用（"不许用 LLM 判断"的机械化读数）──
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts/check-receipt.mjs'), 'utf8');
  const forbidden = ['fetch(', 'http://', 'https://', 'openai', 'anthropic', 'api_key', 'require("https")'];
  const hits = forbidden.filter((f) => src.includes(f));
  chk(hits.length === 0, '(f) ★ 检查器源码**无 LLM/网络调用**（纯规则）', `命中禁用串：${hits.length === 0 ? '无' : hits.join(', ')}`);
}

// ★ 清理（一次；失败响亮报告，但不是本证的判据）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 宿主删除闸，不是本证判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
