/**
 * P0 · **账本陈旧三判据**（销账三层机制的 L1：`src/application/patrol/ledger_staleness.ts`）
 *
 * ## 它守的是哪条规则（本证的第一性理由）
 * 「做完事要销账」这件事在册里有**三种**陈旧形态，而此前**一条机器判据都没有**：
 * | 判据 | 陈旧长什么样 | 唯一的那把尺 |
 * |---|---|---|
 * | S1 | 册里写着「X 零调用 / 未接线」，而 X **其实早就接上了** | `wiring_enumerate#consumesModule` + 它的**脚本入口**先例 |
 * | S2 | **终态卡**（done / void）的证据是**旧代码**的读数（或当年没记指纹） | `task_schema#evidenceFreshness`（current 用 `covers` 现算） |
 * | S3 | 状态机说"可收口"卡却还在 claimed / 写了源码却**没有卡** | `DriftReport.missed_close` + `write-log-audit` 的对账读数 |
 *
 * ## 实测的那一条（2026-11-16，本卡开工时在真册上读到的）
 * `.agent-io/design/task-system-plan.dsl.json#task_plan.patrols` 里 **3 条** `unjudged` 都写着
 * 「★ patrolDrift 全仓零调用（A1）⇒ 这个 metric 真的一次都没被算过」——
 * 而 `scripts/patrol.mjs:40` 每天都在 `const { patrolDrift } = await import(...)`。
 * ⇒ 这正是 S1 要抓的形态：**声明与代码已经分叉，而没有任何东西在看它**。
 * ★ 它的正确处置**不是改册**：`task_plan` 没有写入口（`task_ops#task_plan.update` 只认 state_machine /
 *   criteria）⇒ 判据只能「报 supersede + 证据 file:line」，本文件也**只读不写**。
 *
 * ## 消融（每条判据都必须能红 —— 本文件第 ⑥ 组就是这一组的机器形态）
 * 把 `judgeSheetClaims` 里 `if (!fact.wired) { stillTrue += 1; continue; }` 改成 `if (false) { … }`
 * ⇒ ① 组的"断开 import 后不再报"会红（声明被当成"已取代"，而它其实仍然成立）。
 * 把 `judgeClosedCardEvidence` 的 `unverifiable` 分支并进 `stale` ⇒ ③ 组红
 * （前者"当年没记"，后者"记了但已不同"）。
 *
 * ## 诚实边界
 * · 本文件**不碰真仓**（所有 root 都是 `os.tmpdir()` 里的临时树）：不改任何文件、不需要 `cache.db`；
 * · S1 的 age 是「册文件最后一次提交」这一**上界**（git 没有逐字写入时刻）⇒ 断言里不钉具体数字；
 * · 真仓上的读数（3 条声明全 superseded）由 `node scripts/patrol.mjs` 打印，**不进本证**（那是数据、不是机制）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  claimsOfSheet,
  judgeClosedCardEvidence,
  judgeSheetClaims,
  judgeUnsettled,
  scanLedgerStaleness,
  symbolsIn,
  wiringEvidenceOf,
} from '../src/application/patrol/ledger_staleness.js';
import { codeFingerprintAt } from '../src/application/design/dsl_ops/task_ops.js';

/** 造一棵临时树（相对路径 → 内容）；返回根 */
function mkTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-stale-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  }
  return root;
}
const rm = (root: string): void => fs.rmSync(root, { recursive: true, force: true });

/** 一张只带 `task_plan.patrols[]` 的册（形状与真册同：`patrols[].unjudged` / `patrols[].metrics[].unjudged`） */
function sheetOf(patrols: unknown[]): unknown {
  return { feature: 'f', task_plan: { patrols } };
}
const CLAIM = '★ patrolDrift 全仓零调用（A1）⇒ 这个 metric 真的一次都没被算过';

// ════════════════════════════════════════════════════════════════════
// ① S1：声明已被取代（静态 import 那条路）
// ════════════════════════════════════════════════════════════════════
test('① S1 绿：声明说"零调用"、代码里真有消费点 ⇒ superseded + 证据 file:line（红：断开 import 后不再报）', () => {
  const root = mkTree({
    'src/patrol/task_drift.ts': 'export function patrolDrift(): number {\n  return 1;\n}\n',
    'src/user.ts': "import { patrolDrift } from './patrol/task_drift.js';\npatrolDrift();\n",
  });
  try {
    const dsl = sheetOf([{ id: 'lease_ttl', unjudged: CLAIM, debt: 'A1' }]);
    assert.equal(claimsOfSheet(dsl).length, 1, '真册的形状：patrols[].unjudged 就是声明格');
    assert.deepEqual(symbolsIn(CLAIM), ['patrolDrift'], '符号抽取不许把散文当名字');

    const green = judgeSheetClaims({ dsl, root, nowMs: Date.now() });
    assert.equal(green.claims, 1);
    assert.equal(green.superseded.length, 1, '声明"零调用"而代码有消费点 ⇒ 必须报已被取代');
    assert.equal(green.superseded[0].evidence, 'src/user.ts:1', '证据必须点到 file:line（读端能复核）');
    assert.match(green.superseded[0].why, /已被取代/);
    assert.equal(green.still_true, 0);
    assert.ok(green.scanned_files > 0, '分母必须 > 0（扫了消费面文件）');

    // 红的方向：把 import 断开（消费点消失）⇒ 声明**重新成立**，不许再报 superseded
    fs.writeFileSync(path.join(root, 'src/user.ts'), "import { other } from './patrol/task_drift.js';\nother();\n", 'utf8');
    const red = judgeSheetClaims({ dsl, root, nowMs: Date.now() });
    assert.equal(red.superseded.length, 0, '【消融失败】没有消费点却报"已被取代" ⇒ 判据在瞎报');
    assert.equal(red.still_true, 1, '声明仍然成立 ⇒ 只进分母、不报（0.16）');
  } finally {
    rm(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ② S1：脚本入口先例 —— **真仓的那条路**（动态 import，路径被拆成变量）
// ════════════════════════════════════════════════════════════════════
test('② S1 脚本入口先例：`scripts/x.mjs` 被 npm scripts 指向 + 文本点名 ⇒ 算接线（动态加载静态看不见）', () => {
  const drift = 'export function patrolDrift(): number {\n  return 1;\n}\n';
  const withEntry = mkTree({
    'package.json': JSON.stringify({ name: 'fixture', scripts: { patrol: 'node scripts/patrol.mjs' } }),
    'src/application/patrol/task_drift.ts': drift,
    // ★ 逐字照抄真仓 scripts/patrol.mjs:39-40 的加载方式：specifier 是**变量**，不是字面量
    'scripts/patrol.mjs':
      "import path from 'node:path';\n" +
      "const target = path.join(root, 'dist', 'src', 'application', 'patrol', 'task_drift.js');\n" +
      'const { patrolDrift } = await import(pathToFileURL(target).href);\n',
  });
  try {
    const fact = wiringEvidenceOf(withEntry, 'patrolDrift');
    assert.deepEqual(fact.export_modules, ['src/application/patrol/task_drift.ts']);
    assert.equal(fact.wired, true, '`npm run patrol` 指向的脚本里点了名 ⇒ 这就是"已接线"的可核查事实');
    assert.equal(fact.evidence, 'scripts/patrol.mjs:3');
    assert.match(fact.note, /脚本入口先例/);
  } finally {
    rm(withEntry);
  }
  // 反向：同一个脚本**没被** package.json 指向 ⇒ 不许算（否则任何 .mjs 都能冒充入口）
  const noEntry = mkTree({
    'package.json': JSON.stringify({ name: 'fixture', scripts: {} }),
    'src/application/patrol/task_drift.ts': drift,
    'scripts/patrol.mjs': 'const { patrolDrift } = await import(pathToFileURL(target).href);\n',
  });
  try {
    const fact = wiringEvidenceOf(noEntry, 'patrolDrift');
    assert.equal(fact.wired, false, '没被 npm scripts 指向的 .mjs **不是**入口 ⇒ 不许凭"文件里提了一句"判定接线');
    assert.equal(fact.evidence, null);
  } finally {
    rm(noEntry);
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ S2：终态卡证据三态（valid / stale / unverifiable）—— 后两者**必须分开**
// ════════════════════════════════════════════════════════════════════
test('③ S2 三态：valid 不报 · stale 与 unverifiable 分两桶（不许把"判不了"折成绿）', () => {
  const root = mkTree({ 'src/a.ts': 'export const a = 1;\n' });
  const covers = ['src/a.ts'];
  const now = codeFingerprintAt(root, covers);
  const card = (fp: unknown) => ({
    id: 'n1',
    summary: 'x',
    state: 'done' as const,
    evidence: [{ kind: 'expectations' as const, at: '2026-11-01T00:00:00.000Z', verdict: 'pass' as const, fingerprint: fp }],
  });
  const dslWith = (fp: unknown): never => ({ feature: 'f', geometry: { nodes: [{ id: 'n1', task: card(fp) }] } }) as never;
  try {
    // 绿：指纹与此刻一致
    const valid = judgeClosedCardEvidence({ dsl: dslWith({ what: 'judgeExpectations:n1', code: now.code, covers }), root });
    assert.equal(valid.valid, 1);
    assert.equal(valid.stale.length, 0);
    assert.equal(valid.unverifiable.length, 0);

    // 红一：覆盖的文件改了 ⇒ stale（★ 证据是**旧代码**的读数）
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 2;\n', 'utf8');
    const stale = judgeClosedCardEvidence({ dsl: dslWith({ what: 'judgeExpectations:n1', code: now.code, covers }), root });
    assert.equal(stale.valid, 0);
    assert.equal(stale.stale.length, 1);
    assert.equal(stale.stale[0].card_id, 'n1');
    assert.deepEqual(stale.stale[0].covers, covers);
    assert.equal(stale.unverifiable.length, 0, 'stale 不许被塞进 unverifiable（那是"当年没记"）');

    // 红二：没有指纹 / 没有覆盖集 ⇒ unverifiable（**既不 stale 也不 valid**）
    const unver = judgeClosedCardEvidence({ dsl: dslWith(null), root });
    assert.equal(unver.valid, 0, '★ unverifiable 不许折成绿');
    assert.equal(unver.stale.length, 0);
    assert.equal(unver.unverifiable.length, 1);
    assert.match(unver.unverifiable[0].why, /覆盖集|指纹/);

    // 只巡终态卡：把卡改成 claimed ⇒ 一条都不报（S2 的扫描面就是 done/void）
    const openDsl = { feature: 'f', geometry: { nodes: [{ id: 'n1', task: { ...card(null), state: 'claimed' } }] } } as never;
    const skipped = judgeClosedCardEvidence({ dsl: openDsl, root });
    assert.equal(skipped.closed_cards, 0);
    assert.equal(skipped.with_evidence, 0);

    // 册读不到 ⇒ 判不了（不许返回"全部新鲜"）
    const none = judgeClosedCardEvidence({ dsl: null, root });
    assert.match(String(none.unavailable), /判不了|读不到/);
  } finally {
    rm(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ S3：欠账点名（missed_close + 无卡写），判不了 ≠ 0
// ════════════════════════════════════════════════════════════════════
test('④ S3 点名：漏收口给卡 id、无卡写给 at|file 与 age；对账器跑不了 ⇒ 判不了（不是 0 条）', () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z');
  const s3 = judgeUnsettled({
    missedClose: ['file_src_a_ts', 'todo_7'],
    noCardWrites: {
      no_card: 2,
      total: 40,
      by_branch: { 'files-not-in-design': 2 },
      rows: [{ at: '2026-11-10T12:00:00.000Z', file: 'src/a.ts', actor: 'agent', branch: 'files-not-in-design' }],
    },
    nowMs: now,
  });
  assert.deepEqual(s3.missed_close.map((r) => r.id), ['file_src_a_ts', 'todo_7'], '★ 必须点名到卡（计数说不出"哪张"）');
  assert.equal(s3.missed_close[0].age_ms, null, '卡上没有"该收口的时刻" ⇒ age 判不了，不拿 claimed_at 冒充');
  assert.equal(s3.no_card_total, 2);
  assert.equal(s3.no_card_write.length, 1);
  assert.equal(s3.no_card_write[0].id, '2026-11-10T12:00:00.000Z|src/a.ts');
  assert.equal(s3.no_card_write[0].age_ms, 6 * 86400000, 'age = now − 那条写的时刻（可复算）');
  assert.equal(s3.unavailable, null);

  // 红：对账器跑不了 ⇒ unavailable，且**分子留 null**（不许写成 0 —— 那会把"读不到"读成"干净"）
  const broken = judgeUnsettled({ missedClose: [], noCardWrites: null, noCardWritesUnavailable: '对账器跑不了（库不在）', nowMs: now });
  assert.equal(broken.no_card_total, null, '★ 判不了 ≠ 0 条');
  assert.match(String(broken.unavailable), /跑不了/);
});

// ════════════════════════════════════════════════════════════════════
// ⑤ feature 不存在 / 册读不了 ⇒ 不许返回一份"看起来干净"的空报告
// ════════════════════════════════════════════════════════════════════
test('⑤ feature 不存在 ⇒ ok:false + unavailable 点名（空报告会被读成"账本干净"）', () => {
  const root = mkTree({ 'src/a.ts': 'export const a = 1;\n' });
  try {
    const missing = scanLedgerStaleness({
      feature: 'no-such-feature',
      root,
      nowMs: Date.now(),
      readSheet: () => null,
      missedClose: [],
      noCardWrites: { no_card: 0, total: 0, rows: [] },
    });
    assert.equal(missing.ok, false);
    assert.match(String(missing.unavailable), /读不到|判不了/);
    assert.match(String(missing.s1.unavailable), /读不到|判不了/);
    assert.equal(missing.s3.unavailable, null, 'S3 自己读到了 ⇒ 它照样给读数（不被 S1 的判不了拖死）');
    assert.equal(missing.s3.no_card_total, 0);

    const corrupt = scanLedgerStaleness({
      feature: 'f',
      root,
      nowMs: Date.now(),
      readSheet: () => {
        throw new Error('册坏了：Unexpected token }');
      },
      missedClose: [],
      noCardWrites: null,
      noCardWritesUnavailable: '没读',
    });
    assert.equal(corrupt.ok, false);
    assert.match(String(corrupt.unavailable), /读不了/);
    assert.match(String(corrupt.unavailable), /Unexpected token/);
  } finally {
    rm(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑥ 鉴别力：三个判据各"弄坏一次"，各自必须换读数（不是永远亮 / 永远灭）
// ════════════════════════════════════════════════════════════════════
test('⑥ 鉴别力：S1 接线面 / S2 覆盖指纹 / S3 对账读数 —— 各弄坏一次 ⇒ 结论必须跟着换', () => {
  const root = mkTree({
    'src/m.ts': 'export function patrolDrift(): number {\n  return 1;\n}\n',
    'src/user.ts': "import { patrolDrift } from './m.js';\npatrolDrift();\n",
  });
  try {
    const dsl = sheetOf([{ id: 'lease_ttl', unjudged: CLAIM }]);
    const nowMs = Date.now();
    const ok1 = judgeSheetClaims({ dsl, root, nowMs });
    assert.equal(ok1.superseded.length, 1);

    // S1 弄坏：消费点消失
    fs.unlinkSync(path.join(root, 'src/user.ts'));
    assert.equal(judgeSheetClaims({ dsl, root, nowMs }).superseded.length, 0);

    // S2 弄坏：覆盖集里的文件变了
    const covers = ['src/m.ts'];
    const fp = codeFingerprintAt(root, covers);
    const dslS2 = {
      feature: 'f',
      geometry: {
        nodes: [
          {
            id: 'n1',
            task: {
              id: 'n1',
              summary: 'x',
              state: 'void',
              evidence: [
                {
                  kind: 'reading',
                  at: '2026-11-01T00:00:00.000Z',
                  verdict: 'pass',
                  fingerprint: { what: 'r', code: fp.code, covers },
                },
              ],
            },
          },
        ],
      },
    } as never;
    assert.equal(judgeClosedCardEvidence({ dsl: dslS2, root }).valid, 1);
    fs.writeFileSync(path.join(root, 'src/m.ts'), 'export function patrolDrift(): number {\n  return 2;\n}\n', 'utf8');
    assert.equal(judgeClosedCardEvidence({ dsl: dslS2, root }).stale.length, 1);

    // S3 弄坏：对账器读数没交进来 ⇒ 分子 null + unavailable（不许静默成 0）
    const s3 = judgeUnsettled({ missedClose: [], noCardWrites: null, noCardWritesUnavailable: '没交进来', nowMs });
    assert.equal(s3.no_card_total, null);
    assert.ok(s3.unavailable);
  } finally {
    rm(root);
  }
});
