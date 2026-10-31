/**
 * P1 · **判定器端口纯度 + 残缺报告守卫** —— 由原证 `certs/t353-judge-port-cert.mjs` 整张迁入。
 *
 * ## 它钉两件东西（两件都可能被下一次"顺手重构"搞坏，而现网看不见）
 *   ① **纯度**：`src/domain/**` 对 `../application` / `../infrastructure` / `../presentation` 的
 *      import **恒为 0**。★ 这不是格式洁癖：它是全仓**唯一**一条逻辑上的层方向约束，而
 *      **`tsconfig.contract` 只 include `src/**`、不查分层**（`npm run contract` 只查符号/签名成立）
 *      ⇒ 除本文件外**没有任何机器门管它**（`structure.domains.json#layers` 是给人读的分类标签）。
 *   ② **残缺报告守卫**：端口化把"报告的生产者"从"只有真 judge"变成了"任何注入者" ⇒
 *      注入一个 `{checked:0, items:[]}` 就能让 `failed===0 ∧ unsupported===0` 判成 `satisfied`
 *      （= 一条没判 = 全部通过）。守卫要求 `unknowable` + reason 点名 `N/M`。
 *
 * ## 原证断言 → 本文件用例（一条不删，13 条）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ①a 扫描器确实读到了 domain 文件（否则"0 命中"可能是"一个没扫到"） | `① 纯度`（第 1 条 assert） |
 * | ①b domain 向上 import = 0 | 同上（第 2 条 assert） |
 * | ①c 正对照：application → domain 的 import 存在（证明 regex 会命中） | 同上（第 3 条 assert） |
 * | ②a 注入"什么也没判"的判定器 ⇒ `unknowable` | `② 残报守卫`（第 1 条 assert） |
 * | ②b 拒因点名"只回了 N/M" | 同上（第 2 条 assert） |
 * | ②c 读数自证：报告 0 条 / 提交 1 条 | 同上（第 3 条 assert） |
 * | ③a 真 judge ⇒ `satisfied`（守卫不是"恒 unknowable"） | `③ 对照：真 judge`（第 1 条 assert） |
 * | ③b `isSatisfied` 同源 | 同上（第 2 条 assert） |
 * | ③c 真 judge 下有红 ⇒ `work` | 同上（第 3 条 assert） |
 * | ④a 真 judge 的 `checked === items.length` | `④ 真 judge 不触发守卫`（第 1 条 assert） |
 * | ④b 守卫没在真 judge 路径上误触发 | 同上（第 2 条 assert） |
 * | ⑤a 后态批全过、前态批回 0 条 ⇒ `unknowable` | `⑤ 残报也可能只发生在前态`（第 1 条 assert） |
 * | ⑤b 拒因点名前态那一条缺了 | 同上（第 2 条 assert） |
 *
 * ## ★★ 消融（★ 本证**必须用真消融** —— 它的价值就在能抓到真错；2026-10-31 迁移时实测）
 *   **改哪一行**：给 `src/domain/task_schema.ts` 顶部加**一行** `import type`（类型导入，运行期被擦除，
 *   所以只造出"层方向违规"这一个变量）：
 *   ```ts
 *   import type { ExpectationsReport } from '../application/design/intent/expectations.js';
 *   ```
 *   ⇒ **红读数**：`①` 用例红 —— `①b` 打印出 `src/domain/task_schema.ts → ../application/design/intent/expectations.js`，
 *      `用例 1/5 失败` · exit 非 0。
 *   **还原后**（`git diff` 为空）⇒ **5/5 用例 · 13 条断言全绿** · exit 0。
 *   ★ 为什么这条消融值得做：`tsc` 对"层方向"**一声不响**（形状合法），`npm run contract` 也不查
 *     ⇒ 除了本文件的 ①b，**没有任何东西会红**。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · ①只扫 `.ts`（domain 里没有 `.mjs`/`.js` 源文件）；
 *   · `import type` 也算违规（本文件的 regex 不区分）；反向的"运行期依赖"未单独统计 ——
 *     [未核] 若哪天要区分"仅类型依赖是否算违规"，那要先改判据再改断言；
 *   · [未核] `pending` 洞（`pending` 在后态不被计数 ⇒ 仍能判 satisfied）—— 那是**下一张卡**，本证不碰；
 *   · 夹具只用 `file-exists` 判据（不需要索引），`AGENT_IO_HOME` 指到临时 home。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cardStanding, isSatisfied } from '../src/domain/task_machine.js';
import { judgeExpectations } from '../src/application/design/intent/expectations.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = makeTempHome();
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前（storage 每次调用现读 env）
after(() => rmRf(TMP));

// ── 夹具代码根：只要一个存在的文件（`file-exists` 判据够用，且**不需要索引**）──
fs.writeFileSync(path.join(ROOT, 'src/ok.ts'), 'export const ok = 1;\n', 'utf-8');

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRec = Record<string, any>;

const POST_OK = { kind: 'file-exists', path: 'src/ok.ts', why: 'T353 夹具：已存在的后态判据（不靠索引）' };
const POST_MISSING = { kind: 'file-exists', path: 'src/nope.ts', why: 'T353 夹具：不存在的后态判据' };
/** ★ 只用它来"凑出一批前态"（pre 批由 stub 接走，所以**不需要索引**） */
const PRE_EDGE = { kind: 'edge-absent', from: 'src/ok.ts', to: 'src/zzz.ts', why: 'T353 夹具：前态存在性' };

const card = (id: string, criteria: AnyRec[]): AnyRec => ({ id, summary: `T353 ${id}`, criteria, state: 'candidate' });
const opts = (judge: (root: string, items: AnyRec[]) => Promise<AnyRec>, nodes: AnyRec[] = []) => ({ root: ROOT, nodes, judge });

/** 一份**空的**报告（= 一个"什么也没判"的判定器） */
const EMPTY = () => ({ checked: 0, passed: 0, failed: 0, unsupported: 0, items: [], notes: [], conflicts: [] });
/** 一个**完全不判**的判定器（端口允许注入 ⇒ 它必须被当成"判不了"，不是"全过"） */
const blindJudge = async () => EMPTY();
/** 一个**只对后态判、不判前态**的判定器（残报只发生在 preReport 那一批） */
const postOnlyJudge = async (root: string, items: AnyRec[]) =>
  items.length && items.every((i) => i.expectation.kind === 'edge-absent') ? EMPTY() : judgeExpectations(root, items as never);

const standingOf = (c: AnyRec, o: AnyRec) => cardStanding(c as never, (c.criteria ?? []) as never, o as never);
const satisfiedOf = (c: AnyRec, o: AnyRec) => isSatisfied(c as never, (c.criteria ?? []) as never, o as never);

// ════════════════════════════════════════════════════════════════════
// ① 纯度：src/domain 对 ../application / ../infrastructure 的 import 恒为 0
// ════════════════════════════════════════════════════════════════════
test('① 纯度：`src/domain` 向上 import（application / infrastructure / presentation）= 0', () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith('.ts')) out.push(p);
    }
    return out;
  };
  const files = walk(path.join(REPO, 'src/domain'));
  const UP = /from\s+['"][^'"]*\.\.\/(application|infrastructure|presentation)\//g;
  const hits: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf-8');
    const rel = path.relative(REPO, f).replace(/\\/g, '/');
    for (const m of src.matchAll(UP)) hits.push(`${rel} → ${m[0].replace(/from\s+['"]/, '')}`);
  }
  assert.ok(files.length > 0, `①a 扫描器必须读到 domain 文件（否则"0 命中"可能只是"一个没扫到"）：实测扫到 ${files.length} 个 .ts`);
  assert.equal(
    hits.length,
    0,
    `①b ★★ domain 向上 import 必须为 0（这是全仓**唯一**的层方向约束，且没有别的门在查）：实测 ${hits.join(' / ')}`,
  );

  // ★ 正对照：同一套判据用在 application 上必须有命中 —— 否则 ①b 可能只是 regex 写坏了
  let down = 0;
  for (const f of walk(path.join(REPO, 'src/application'))) {
    down += (fs.readFileSync(f, 'utf-8').match(/from\s+['"][^'"]*\/domain\//g) || []).length;
  }
  assert.ok(down > 0, `①c 正对照：application → domain 的 import 必须存在（证明 regex 会命中，不是恒 0）：实测命中 ${down} 处`);
});

// ════════════════════════════════════════════════════════════════════
// ② 残报守卫：注入一个"什么也没判"的判定器 ⇒ unknowable（不是 satisfied）
// ════════════════════════════════════════════════════════════════════
test('② 残报守卫：注入"什么也没判"的判定器 ⇒ unknowable（不是 satisfied）', async () => {
  const v = (await standingOf(card('blind', [POST_OK]), opts(blindJudge))) as AnyRec;
  assert.equal(
    v.standing,
    'unknowable',
    `②a ★ 一条没判 ≠ 全部通过：实测 standing=${String(v.standing)}・satisfaction=${JSON.stringify(v.satisfaction)}`,
  );
  assert.match(String(v.reason), /0\/1/, `②b 拒因必须点名"只回了 N/M"（人读能看出缺了几条）：${String(v.reason)}`);
  assert.ok(
    v.report.checked === 0 && v.judged.post.length === 1,
    `②c 读数自证：报告 0 条 / 提交 1 条（实际 checked=${String(v.report.checked)} / submitted=${String(v.judged.post.length)}）`,
  );
});

// ════════════════════════════════════════════════════════════════════
// ③ 对照：同一张卡 + 真 judge ⇒ satisfied（守卫不是"恒 unknowable"）
// ════════════════════════════════════════════════════════════════════
test('③ 对照：同一张卡 + 真 judge ⇒ satisfied（守卫不是"恒 unknowable"）', async () => {
  const real = (r: string, items: AnyRec[]) => judgeExpectations(r, items as never);
  const c = card('real-ok', [POST_OK]);
  const v = (await standingOf(c, opts(real))) as AnyRec;
  assert.equal(v.standing, 'satisfied', `③a 真 judge 下必须 satisfied（★ 若守卫恒 unknowable，这条会红）：${String(v.reason)}`);
  const s = (await satisfiedOf(c, opts(real))) as AnyRec;
  assert.equal(s.satisfied, true, '③b `isSatisfied` 必须同源（收口侧读同一张卡）');
  const red = (await standingOf(card('real-red', [POST_MISSING]), opts(real))) as AnyRec;
  assert.equal(red.standing, 'work', `③c 真 judge 下有红 ⇒ work（证明 ③a 不是"一片全绿"）：${String(red.reason)}`);
});

// ════════════════════════════════════════════════════════════════════
// ④ 契约第 2 条：真 judge 的 checked === items.length（⇒ 守卫对真实现不可达）
// ════════════════════════════════════════════════════════════════════
test('④ 真 judge 的 checked === items.length（守卫对真实现不可达）', async () => {
  const items = [
    { node_id: 'n', node_label: 'n', expectation: POST_OK },
    { node_id: 'n', node_label: 'n', expectation: POST_MISSING },
  ];
  const rep = (await judgeExpectations(ROOT, items as never)) as AnyRec;
  assert.ok(
    rep.checked === items.length && rep.items.length === items.length,
    `④a 报告条数必须 = 提交条数（真 judge）：实测 checked=${String(rep.checked)}/${items.length}・items=${String(rep.items.length)}`,
  );
  const real = (r: string, xs: AnyRec[]) => judgeExpectations(r, xs as never);
  const v = (await standingOf(card('real-mixed', [POST_OK, POST_MISSING]), opts(real))) as AnyRec;
  assert.ok(
    v.standing === 'work' && !/只回了部分条目/.test(String(v.reason)),
    `④b 守卫不许在真 judge 路径上误触发：standing=${String(v.standing)} reason=${String(v.reason).slice(0, 120)}`,
  );
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 残报也可能只发生在**前态**批 ⇒ 守卫必须覆盖 preReport
// ════════════════════════════════════════════════════════════════════
test('⑤ 残报只发生在前态批 ⇒ 同样 unknowable（守卫覆盖 preReport）', async () => {
  const v = (await standingOf(card('pre-half', [POST_OK, PRE_EDGE]), opts(postOnlyJudge))) as AnyRec;
  assert.equal(v.standing, 'unknowable', `⑤a 后态批全过、但前态批回 0 条 ⇒ 必须 unknowable：实测 standing=${String(v.standing)}`);
  assert.match(String(v.reason), /前态\s*0\/1/, `⑤b 拒因必须点名前态那一条缺了：${String(v.reason)}`);
});
