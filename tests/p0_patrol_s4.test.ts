/**
 * P0 · **台账行 ↔ 册卡 ↔ 代码事实的 S4 三方抽对**（`src/application/patrol/ledger_staleness.ts#judgeLedgerTrio`）
 *
 * ## 它守的是哪条规则（第一性理由）
 * `docs/todo.md` 是**声明面**：577 行里 240 个 id 各自断着"还没做成 / 已了结 / 见某行"。
 * 这些断言的**唯一读者是人**，而没有任何机器判据在看它们 —— 于是出现两种典型病：
 * ① **声明过期**：行里写着「`X` 零调用」，而 `X` 早在 `scripts/patrol.mjs:40` 每天被 import；
 * ② **结案核不了**：行里写着 ✅，而它点名的产物在盘上**一个都不在**（删了 / 改名了 / 从来只是计划）。
 * ③ **引用悬空**：行里点名 `R61`，而台账里**没有**这一行（AGENTS 五「做完就删行」删掉后没人回头改引用）。
 *
 * ## 三类判据各自的三方读数
 * | 类 | 台账说 | 册说 | 代码说 |
 * |---|---|---|---|
 * | (a) `superseded` | `X` 零调用 / 未接线 | 这行有没有卡、卡是否终态（`trio.sheet`） | `X` **已接线**（证据 `file:line`） |
 * | (b) `closed-unverifiable` | ✅ / 已了结 | 同上 | 点名的产物**全都不在盘上** |
 * | (c) `dangling-ref` | 点名了别的 id | 那个 id 在册上的卡（信息档） | —（不需要代码事实） |
 *
 * ## 消融（每条判据都必须能红 —— 第 ②、③ 组就是这一组的机器形态）
 * · 把 (a) 的「就近取值」退回成「行内任一个已接线符号」⇒ 第 ② 组红（它断言"同一行里别的符号被 import 不算数"）；
 * · 把 `WIRE_DEBT` 放宽成「未修 / 未实现」⇒ 第 ③ 组红（功能级措辞没有机器判据能证伪，实测假阳 100%）；
 * · 把 (b) 的「全都不在」放宽成「任一不在」⇒ 第 ④ 组的"部分缺失不报"红；
 * · 把 `declaredIdsOf` 换成"引用的都算定义"⇒ 第 ⑤ 组的悬空引用红。
 *
 * ## 实测（2026-11-17，真台账 577 行 / 册 = task-system-plan）
 * `checked 10 · unjudgeable 13 · superseded 0 · closed 0 · dangling 52 处（29 个 id）· 440ms`。
 * ★ `superseded 0` **不是**"判据没用"：它是"真台账今天没有接线级过期声明"的读数 ——
 *   而 L424 那一行同时点名 3 个符号（`expectationPhase` / `KIND_SPECS` 都已被 import、`phaseOfKind` 零调用），
 *   判据**只对紧邻的 `phaseOfKind()` 说话** ⇒ 保持沉默（正确）；若改成"行内任一已接线"就会误报。
 *
 * ## 诚实边界
 * · 本文件**不碰真仓**：root 全是 `os.tmpdir()` 里的临时树，台账文本一律**注入**（不读真 `docs/todo.md`）；
 * · (a) **只认接线级声明**（零调用 / 未接线 / 零消费者…）：功能级欠账（未修 / 未实现）没有机器判据，
 *   它们只进 `unjudgeable` 分母（这条是对 lead 裁定的**收窄**，理由见模块注释里的 10 条实测）；
 * · 结论**永不自动改台账 / 改册**：台账是文档、册只走 `edit_dsl`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  declaredIdsOf,
  judgeLedgerTrio,
  parseLedgerRows,
  pathsIn,
  scanLedgerStaleness,
  sheetCardLinksOf,
} from '../src/application/patrol/ledger_staleness.js';

/** 造一棵临时树（相对路径 → 内容）；返回根 */
function mkTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patrol-s4-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  }
  return root;
}
const rm = (root: string): void => fs.rmSync(root, { recursive: true, force: true });

/** 反引号（★ 测试源码里不直接写它：台账夹具全是"反引号包住名字"的形状） */
const BT = '`';
/** 一行台账（表格首格 = id 定义位；与真台账同形） */
const row = (id: string, body: string): string => `| ${id} | ${body} |`;

/** 一张只带"某个 id 的卡"的册（`state` 可换；用来验 `trio.sheet` 那一格真的在说话） */
function sheetWithCard(id: string, state: 'done' | 'claimed'): unknown {
  return {
    feature: 'f',
    geometry: { nodes: [{ id: 'n1', label: 'x', type: 'service', x: 0, y: 0, task: { id, summary: 's', state, evidence: [] } }] },
  };
}

const DRIFT_TS = 'export function patrolDrift(): number {\n  return 1;\n}\n';

// ════════════════════════════════════════════════════════════════════
// ① (a) 声明过期：绿（符号真被 import）· 红（消费点消失）· 三方齐全
// ════════════════════════════════════════════════════════════════════
test('① (a) 「`X` 零调用」而 X 真被 import ⇒ superseded + 证据 file:line；消费点没了 ⇒ 不报（只进分母）', () => {
  const root = mkTree({
    'src/patrol/task_drift.ts': DRIFT_TS,
    'src/user.ts': "import { patrolDrift } from './patrol/task_drift.js';\npatrolDrift();\n",
  });
  try {
    const ledgerText = row('T-#ZERO-CALL', `${BT}patrolDrift${BT} 全仓零调用 ⇒ 这个 metric 一次都没算过`);
    const green = judgeLedgerTrio({ ledgerText, root, dsl: sheetWithCard('T-#ZERO-CALL', 'done') });
    assert.equal(green.unavailable, null, '台账给进来了 ⇒ 不许报"判不了"');
    assert.equal(green.superseded.length, 1, '声明"零调用"而代码有消费点 ⇒ 必须报已被取代');
    assert.equal(green.superseded[0].evidence, 'src/user.ts:1', '证据必须点到 file:line（读端能复核）');
    assert.deepEqual(
      green.superseded[0].trio,
      { ledger: 'row', sheet: 'card-closed', code: 'wired' },
      '★ 三方都要说话：行在、册上那张卡是终态、代码说已接线',
    );
    assert.match(green.superseded[0].why, /已经在被消费/);

    // 红的方向：把消费点删掉 ⇒ 声明**重新成立**，不许再报 superseded
    fs.unlinkSync(path.join(root, 'src/user.ts'));
    const red = judgeLedgerTrio({ ledgerText, root, dsl: sheetWithCard('T-#ZERO-CALL', 'done') });
    assert.equal(red.superseded.length, 0, '【消融失败】没有消费点却报"已被取代" ⇒ 判据在瞎报');
    assert.equal(red.checked, 1, '★ 判过它（进了分母）—— "没报"必须与"没看"可区分');
  } finally {
    rm(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ② (a) 就近取值：同一行里**别的**符号被 import 不算数（真台账 L424 的形状）
// ════════════════════════════════════════════════════════════════════
test('② (a) 消融：同一行 3 个符号、2 个已被 import，但"零调用者"说的是第 3 个 ⇒ 必须沉默', () => {
  const root = mkTree({
    'src/exp.ts': 'export function expectationPhase(): string {\n  return "post";\n}\nexport function phaseOfKind(): string {\n  return "post";\n}\n',
    'src/user.ts': "import { expectationPhase } from './exp.js';\nexpectationPhase();\n",
  });
  try {
    // ★ 逐字照抄真台账 L424 的形状：两个符号被引用、被断"零调用者"的却是第三个
    const ledgerText = row(
      'T-#KIND-PHASE-DUP',
      `注释「唯一权威处」，${BT}expectationPhase${BT} 有 4 个调用者 vs ${BT}KIND_SPECS${BT}[].phase（导出的 ${BT}phaseOfKind()${BT} **零调用者**）`,
    );
    const r = judgeLedgerTrio({ ledgerText, root });
    assert.equal(r.superseded.length, 0, '【消融失败】把"行内任一已接线符号"当成那句声明的主语 ⇒ 假阳');
    assert.equal(r.checked, 1, '这一行确实被判过（它点名的 `phaseOfKind` 有导出、能查）');

    // 反向：把 `phaseOfKind` 也接上 ⇒ 同一行必须立刻报（证明"沉默"不是因为判据瞎了）
    fs.writeFileSync(
      path.join(root, 'src/user.ts'),
      "import { expectationPhase, phaseOfKind } from './exp.js';\nexpectationPhase();\nphaseOfKind();\n",
      'utf8',
    );
    const after = judgeLedgerTrio({ ledgerText, root });
    assert.equal(after.superseded.length, 1, '被点名的那一个真接上了 ⇒ 声明过期，必须报');
    assert.deepEqual(after.superseded[0].refs, ['phaseOfKind'], '报的必须是**紧邻**那句声明的符号');
    assert.equal(after.superseded[0].evidence, 'src/user.ts:1', '证据指向那条 import 绑定（与 S1 同一套 evidenceLineOf）');
  } finally {
    rm(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ (a) 收窄：功能级措辞（未修 / 未实现）不是接线级声明 ⇒ 只进 unjudgeable 分母
// ════════════════════════════════════════════════════════════════════
test('③ (a) 消融：行说「`X` 未实现」（功能级）而 X 已被 import ⇒ 不许报 superseded（假阳 100% 的那一类）', () => {
  const root = mkTree({
    'src/patrol/task_drift.ts': DRIFT_TS,
    'src/user.ts': "import { patrolDrift } from './patrol/task_drift.js';\npatrolDrift();\n",
  });
  try {
    const ledgerText = [
      row('T-#NOT-IMPLEMENTED', `**未实现**：${BT}patrolDrift${BT} 这条能力到今天还没做`),
      row('T-#NOT-FIXED', `③ 产物注册表（**未修**）：坏注册表 ⇒ ${BT}patrolDrift${BT} 整文件重写`),
    ].join('\n');
    const r = judgeLedgerTrio({ ledgerText, root });
    assert.equal(r.superseded.length, 0, '【消融失败】功能级措辞被当成接线级声明 ⇒ 结论永远是错的（0.16）');
    assert.equal(r.unjudgeable, 2, '★ 判不了要说出来：两条都进分母');
    assert.equal(r.checked, 0);
  } finally {
    rm(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ (b) 结案核不了：产物一个都不在 ⇒ 报；产物在 / 部分在 ⇒ 不报
// ════════════════════════════════════════════════════════════════════
test('④ (b) 「✅ 已了结」+ 点名的产物全不在 ⇒ closed-unverifiable；产物在 ⇒ 不报；部分在 ⇒ 只进分母', () => {
  const root = mkTree({ 'src/keep.ts': 'export const keep = 1;\n' });
  try {
    const gone = row('T-#CLOSED-GONE', `✅ 已了结：落地 ${BT}src/tool/gone.ts${BT} + ${BT}src/tool/gone2.ts${BT}`);
    const miss = judgeLedgerTrio({ ledgerText: gone, root });
    assert.equal(miss.closed_unverifiable.length, 1);
    assert.deepEqual(miss.closed_unverifiable[0].refs, ['src/tool/gone.ts', 'src/tool/gone2.ts']);
    assert.equal(miss.closed_unverifiable[0].trio.code, 'file-missing');
    assert.equal(miss.checked, 1);

    // 红：产物真在盘上 ⇒ 结案**核过了**，不许再报
    fs.mkdirSync(path.join(root, 'src/tool'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/tool/gone.ts'), 'export const x = 1;\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src/tool/gone2.ts'), 'export const y = 1;\n', 'utf8');
    assert.equal(judgeLedgerTrio({ ledgerText: gone, root }).closed_unverifiable.length, 0);

    // 判不了的那一态：点名两个、只有一个在盘上 ⇒ "缺的那一个是不是唯一对应物"判不了 ⇒ 只进分母
    fs.unlinkSync(path.join(root, 'src/tool/gone2.ts'));
    const partial = judgeLedgerTrio({ ledgerText: gone, root });
    assert.equal(partial.closed_unverifiable.length, 0, '【消融失败】部分缺失被当成"结案核不了" ⇒ 满屏假阳');
    assert.equal(partial.checked, 1, '判过它（分母要 ≥ 分子）');

    // 行里没点名产物 ⇒ 判不了（不许当"真做完"，也不报）
    const nowhere = judgeLedgerTrio({ ledgerText: row('T-#CLOSED-OK', '✅ 已了结，细节见规格'), root });
    assert.equal(nowhere.closed_unverifiable.length, 0);
    assert.equal(nowhere.unjudgeable, 1);
  } finally {
    rm(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑤ (c) 悬空引用：点名了台账里没有的 id ⇒ 报；定义了 ⇒ 不报；点名自己 ⇒ 不报
// ════════════════════════════════════════════════════════════════════
test('⑤ (c) 点名台账里没有的 id ⇒ dangling（按 id 去重）；那一行补回来 ⇒ 不报；点名自己 ⇒ 不报', () => {
  const root = mkTree({});
  try {
    const ledgerText = row('T-#REF-OTHER', '结论见 R99 与 T-#GHOST 的取证（R99 重复出现两次也只算一处）R99');
    const r = judgeLedgerTrio({ ledgerText, root });
    assert.deepEqual(r.dangling.map((x) => x.refs[0]).sort(), ['R99', 'T-#GHOST'], '★ 每个悬空 id 一条（同 id 不重复计）');
    assert.equal(r.declared_ids, 1);

    // 红：把 R99 定义出来 ⇒ 只剩 T-#GHOST
    const withR99 = [row('T-#REF-OTHER', '结论见 R99 与 T-#GHOST'), row('R99', '我补回来了')].join('\n');
    assert.deepEqual(judgeLedgerTrio({ ledgerText: withR99, root }).dangling.map((x) => x.refs[0]), ['T-#GHOST']);

    // 红：点名自己不算悬空
    assert.equal(judgeLedgerTrio({ ledgerText: row('T-#SELF', '本行 T-#SELF 的补充说明'), root }).dangling.length, 0);
  } finally {
    rm(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑥ 解析与分母 + 「判不了」不许折成绿（含 scanLedgerStaleness 的接线）
// ════════════════════════════════════════════════════════════════════
test('⑥ 台账解析两种定义形态 / 分母齐全 / 台账读不到 ⇒ 判不了（不是"干净"）', () => {
  const root = mkTree({ 'src/a.ts': 'export const a = 1;\n' });
  try {
    const ledgerText = [
      '# 待办',
      row('T-#TABLE', '表格首格是定义位'),
      '- **R7** 行首加粗也是定义位',
      '| 不是 id | 表格首格不是 id 的行',
      '',
    ].join('\n');
    const rows = parseLedgerRows(ledgerText);
    assert.equal(rows.length, 4, '非空行才是行（空行不进分母）');
    assert.deepEqual([...declaredIdsOf(rows)].sort(), ['R7', 'T-#TABLE'], '两种定义形态都要认出来');
    assert.equal(parseLedgerRows(ledgerText)[0].id, null, '标题行不定义 id');

    // 路径抽取：只认**带顶层目录**的反引号路径（单文件名不猜）
    assert.deepEqual(pathsIn(`见 ${BT}src/a.ts${BT} 与 ${BT}package.json${BT}`), ['src/a.ts']);

    // 分母：rows / scanned / declared_ids 三个读数都在（0.12③：只看分子等于没验）
    const r = judgeLedgerTrio({ ledgerText, root });
    assert.equal(r.scanned, 4);
    assert.equal(r.declared_ids, 2);
    assert.ok(r.rows >= 2, `带 id 的行数必须 > 0（实得 ${r.rows}）`);

    // 台账读不到 ⇒ unavailable（★ 不是"台账与代码对得上"）
    const none = judgeLedgerTrio({ ledgerText: null, root });
    assert.match(String(none.unavailable), /读不到|判不了/);
    assert.equal(none.scanned, 0);

    // 接线：scanLedgerStaleness 缺省读 `<root>/docs/todo.md` —— 临时树里没有 ⇒ ok:false + s4 点名
    const scanned = scanLedgerStaleness({
      feature: 'no-such-feature',
      root,
      nowMs: Date.now(),
      readSheet: () => null,
      missedClose: [],
      noCardWrites: { no_card: 0, total: 0, rows: [] },
    });
    assert.equal(scanned.ok, false, '有一条判据判不了 ⇒ ok:false（眼下的缺口不许被读成绿）');
    assert.match(String(scanned.s4.unavailable), /docs\/todo\.md|判不了/);

    // 注入台账（patrol 就是这么传的）⇒ s4 有读数
    const injected = scanLedgerStaleness({
      feature: 'no-such-feature',
      root,
      nowMs: Date.now(),
      readSheet: () => null,
      missedClose: [],
      noCardWrites: { no_card: 0, total: 0, rows: [] },
      ledgerText,
      ledgerRel: 'docs/todo.md',
    });
    assert.equal(injected.s4.unavailable, null);
    assert.equal(injected.s4.scanned, 4);

    // 册读不到 ⇒ `trio.sheet` 必须是 unavailable（不许假装"册上没卡"）
    assert.equal(sheetCardLinksOf(null)('T-#TABLE'), 'unavailable');
    assert.equal(sheetCardLinksOf(sheetWithCard('T-#TABLE', 'claimed'))('T-#TABLE'), 'card-open');
  } finally {
    rm(root);
  }
});
