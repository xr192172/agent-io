#!/usr/bin/env node
/**
 * ★★★ cert T353 —— **判定器端口纯度 + 残缺报告守卫**（2026-10-21 · D-judge-port）。
 *
 * ## 它钉两件东西（两件都可能被下一次“顺手重构”搞坏，而现网看不见）
 *   ① **纯度**：`src/domain/**` 对 `../application` / `../infrastructure` 的 import **恒为 0**。
 *      ★ 这不是格式洁癖：它是全仓**唯一**一条逻辑上的层方向约束，而**今天没有任何机器门管它**
 *        （`structure.domains.json#layers` 是给人读的分类标签；dep-cruiser 已退场 —— 见
 *        `infrastructure/analysis/structure/structure_gap.ts` 文件头）。不钉它，D-judge-port 就只是一次性重构。
 *   ② **残缺报告守卫**：端口化把“报告的生产者”从“只有真 judge”变成了“任何注入者” ⇒
 *      注入一个 `{checked:0, items:[]}` 就能让 `failed===0 ∧ unsupported===0` 判成 `satisfied`
 *      （= 一条没判 = 全部通过）。守卫要求 `unknowable` + reason 点名 `N/M`。
 *
 * ## 为什么这条证只能在端口化之后写（= 本笔的收益）
 * 守卫要锚的输入是“一份**不完整**的报告”。端口化之前，这个输入只能靠“真实世界刚好碰不对”才能构造；
 * 现在注入一个 stub 即可 ⇒ 这条分支第一次成为**可夹具化的行为**。
 *
 * ## ★★ “自己坏”的对照（证必须能被自己的反面打红）
 *   ③ 同一个卡 + **真** judge ⇒ `satisfied`：证明 ②的 unknowable **不是“恒 unknowable”**（否则 ② 是装饰）。
 *   ④ 真 judge 的 `checked === items.length`：证明守卫**对真实现不可达**（否则它就是在改现有结论）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只扫 `.ts`（domain 里没有 `.mjs`/`.js` 源文件）；
 *   · [未核] `src/domain` 对 `presentation` 的 import —— ①的 regex 只抽了 application/infrastructure 两级，
 *     但同一份扫描里多一行就能抽（没抽是因为本仓从未出现过，不想拿“没出现过”当已证）；
 *   · [未核] `pending` 洞（`pending` 在后态不被计数 ⇒ 仍能判 satisfied）—— 那是**下一张卡**，本证不碰。
 *
 * ## 用法
 *   node certs/t353-judge-port-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
// ★ 夹具用 mkdtempSync（每次新目录、**不删**旧目录）—— 同 t351：`rmSync` 会碰到宿主的批量删除闸。
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp353-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

// ── 夹具代码根：只要一个存在的文件（`file-exists` 判据够用，且**不需要索引**）──
fs.writeFileSync(path.join(ROOT, 'src/ok.ts'), 'export const ok = 1;\n', 'utf-8');

const { cardStanding: standingRaw, isSatisfied: satisfiedRaw } = await import('../dist/src/domain/task_machine.js');
/**
 * ★ 2026-10-22（task.expectations 去副本）：判据不再住卡（TaskSpec 无该字段）⇒ 夹具把它挂在 `criteria` 上，
 *   由这两行适配器作为**第二个参数**送给领域函数（卡上不再有 expectations）。
 */
const cardStanding = (c, opts) => standingRaw(c, c.criteria ?? [], opts);
const isSatisfied = (c, opts) => satisfiedRaw(c, c.criteria ?? [], opts);
const { judgeExpectations } = await import('../dist/src/application/design/intent/expectations.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const POST_OK = { kind: 'file-exists', path: 'src/ok.ts', why: 'T353 夹具：已存在的后态判据（不靠索引）' };
const POST_MISSING = { kind: 'file-exists', path: 'src/nope.ts', why: 'T353 夹具：不存在的后态判据' };
// ★ 只用它来“凑出一批前态”（pre 批由 stub 接走，所以**不需要索引**）
const PRE_EDGE = { kind: 'edge-absent', from: 'src/ok.ts', to: 'src/zzz.ts', why: 'T353 夹具：前态存在性' };
const card = (id, criteria) => ({ id, summary: `T353 ${id}`, criteria, state: 'candidate' });
const opts = (judge, nodes = []) => ({ root: ROOT, nodes, judge });

/** 一份**空的**报告（= 一个“什么也没判”的判定器） */
const EMPTY = () => ({ checked: 0, passed: 0, failed: 0, unsupported: 0, items: [], notes: [], conflicts: [] });
/** 一个**完全不判**的判定器（端口允许注入 ⇒ 它必须被当成“判不了”，不是“全过”） */
const blindJudge = async () => EMPTY();
/** 一个**只对后态判、不判前态**的判定器（残报只发生在 preReport 那一批） */
const postOnlyJudge = async (root, items) =>
  items.length && items.every((i) => i.expectation.kind === 'edge-absent') ? EMPTY() : judgeExpectations(root, items);

// ═══════════════════════════════════════════════════════════════════════
console.log('════ ① 纯度：src/domain 对 ../application / ../infrastructure 的 import 恒为 0 ════');
{
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith('.ts')) out.push(p);
    }
    return out;
  };
  const DOMAIN = path.join(REPO, 'src/domain');
  const files = walk(DOMAIN);
  const UP = /from\s+['"][^'"]*\.\.\/(application|infrastructure|presentation)\//g;
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf-8');
    const rel = path.relative(REPO, f).replace(/\\/g, '/');
    for (const m of src.matchAll(UP)) hits.push(`${rel} → ${m[0].replace(/from\s+['"]/, '')}`);
  }
  chk(files.length > 0, '①a 扫描器确实读到了 domain 文件（否则“0 命中”可能是“一个没扫到”）', `扫到 ${files.length} 个 .ts`);
  chk(hits.length === 0, '①b domain 向上 import = 0（application / infrastructure / presentation 全算）', hits.length ? hits.join(' / ') : '（无）');

  // ★ 正对照：同一套判据用在 application 上必须有命中 —— 否则 ①b 可能只是 regex 写坏了
  const appFiles = walk(path.join(REPO, 'src/application'));
  let down = 0;
  for (const f of appFiles) down += (fs.readFileSync(f, 'utf-8').match(/from\s+['"][^'"]*\/domain\//g) || []).length;
  chk(down > 0, '①c 正对照：application → domain 的 import 存在（证明 regex 会命中，不是恒 0）', `命中 ${down} 处`);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n════ ② 残报守卫：注入一个“什么也没判”的判定器 ⇒ unknowable（不是 satisfied）════');
{
  const c = card('blind', [POST_OK]);
  const v = await cardStanding(c, opts(blindJudge));
  chk(v.standing === 'unknowable', '②a standing=unknowable（★ 一条没判 ≠ 全部通过）', `standing=${v.standing}・satisfaction=${JSON.stringify(v.satisfaction)}`);
  chk(/0\/1/.test(v.reason), '②b 拒因点名“只回了 N/M”（人读能看出缺了几条）', v.reason);
  chk(v.report.checked === 0 && v.judged.post.length === 1, '②c 读数自证：报告 0 条 / 提交 1 条', `checked=${v.report.checked} / submitted=${v.judged.post.length}`);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n════ ③ 对照：同一张卡 + 真 judge ⇒ satisfied（守卫不是“恒 unknowable”）════');
{
  const c = card('real-ok', [POST_OK]);
  const v = await cardStanding(c, opts(judgeExpectations));
  chk(v.standing === 'satisfied', '③a 真 judge 下 satisfied（★ 若守卫恒 unknowable，这条会红）', v.reason);
  chk((await isSatisfied(c, opts(judgeExpectations))).satisfied === true, '③b isSatisfied 同源（收口侧读同一张卡）');

  const red = await cardStanding(card('real-red', [POST_MISSING]), opts(judgeExpectations));
  chk(red.standing === 'work', '③c 真 judge 下有红 ⇒ work（证明 ③a 不是“一片全绿”）', red.reason);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n════ ④ 契约第 2 条：真 judge 的 checked === items.length（⇒ 守卫对真实现不可达）════');
{
  const items = [
    { node_id: 'n', node_label: 'n', expectation: POST_OK },
    { node_id: 'n', node_label: 'n', expectation: POST_MISSING },
  ];
  const rep = await judgeExpectations(ROOT, items);
  chk(rep.checked === items.length && rep.items.length === items.length, '④a 报告条数 = 提交条数（真 judge）', `checked=${rep.checked}/${items.length}・items=${rep.items.length}`);
  const v = await cardStanding(card('real-mixed', [POST_OK, POST_MISSING]), opts(judgeExpectations));
  chk(v.standing === 'work' && !/只回了部分条目/.test(v.reason), '④b 守卫没在真 judge 路径上误触发', `standing=${v.standing}`);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ 残报也可能只发生在**前态**批 ⇒ 守卫必须覆盖 preReport ════');
{
  const c = card('pre-half', [POST_OK, PRE_EDGE]);
  const v = await cardStanding(c, opts(postOnlyJudge));
  chk(v.standing === 'unknowable', '⑤a 后态批全过、但前态批回 0 条 ⇒ unknowable', `standing=${v.standing}`);
  chk(/前态\s*0\/1/.test(v.reason), '⑤b 拒因点名前态那一条缺了', v.reason);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
process.exit(F ? 1 : 0);
