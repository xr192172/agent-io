/**
 * P0 · 两个「**已建好但没接线**」的检测能力，接线之后**有没有牙**（2026-11-03）。
 *
 * 两条都是发现者审计里落在 HUMAN 档的账（"只有人撞上才发现"）：
 *   ① **结构意图**：`structure_gap` 是工具、`design_line action=report` ⑥ 的沉默缺口是读数，
 *      而 `scripts/verify.mjs` 头注自己写着「结构意图**没有任何门在查**」⇒ 盘上有、册上无的文件没人管；
 *   ② **无卡写账**：`write_log` 表与 `scripts/write-log-audit.mjs` 都在，但它**连 npm script 都没登记**
 *      ⇒ 「这次改动挂在哪张卡上」依旧靠人记得跑脚本。
 *
 * ★ 本文件断的是 AGENTS-RULES 0.25 的三条：**可执行**（跑真脚本）· **有鉴别力**（每条都先造出"该红"
 *   的输入看它真红，再把病灶去掉看它转绿）· **取值域与异常域重叠**（说明"什么情形红、什么情形绿"）。
 * ★ 只用临时目录夹具（`%TEMP%`），**绝不动仓里的 `src/` `dist/` `tests/`** —— 门的判据实现在 `dist/`，
 *   夹具只提供"被检查的项目"（册 / 源码 / 写账），所以每条都不会因为本仓当前缺口数而变红或变绿。
 * ★ `AGENT_IO_HOME` 指到空的临时目录：`loadDesignSheetsForGate` 会并进**数据家**里登记的册，
 *   不隔离的话夹具会读到本仓那几册（"测的不是我以为的那份"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import { openTasksDb } from '../src/infrastructure/task_history.js';
import { recordWriteLog, writeLogRowOf } from '../src/infrastructure/write_log.js';
// ★★★ 2026-11-04（G13/G17 · subagent:nocard-fix）：分诊表 + 写闸的逐文件卡读数
import {
  BASIS_CARDABILITY,
  cardabilityOfBranch,
  countsAsNoCardWrite,
  countsAsCredentialMiss,
} from '../src/domain/task_gate_basis.js';
import { assertSourceWriteRegistered } from '../src/application/write_gate.js';
import { saveDSL } from '../src/infrastructure/storage.js';
// ★★★ 2026-11-05（R32）：两条闭合不变量的**消融**要直接喂坏输入 ⇒ 直接 import 判定核
import {
  assertConflictUniverseClosed,
  assertSilentGapClosed,
  silentGapOf,
} from '../src/application/design/line/design_line.js';

const GATE_STRUCTURE = path.resolve('scripts/structure-gate.mjs');
const AUDIT_WRITES = path.resolve('scripts/write-log-audit.mjs');

/** 跑一个脚本（`NODE_TEST_CONTEXT` 必须摘掉：否则子进程的 node 认为这是嵌套 test run） */
function runIn(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): { status: number | null; out: string } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...base, ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const tail = (s: string, n = 2000): string => (s.length <= n ? s : `…（截断，仅尾部）\n${s.slice(-n)}`);

/** 一个最小"被检查的项目"：`src/a.ts` 在盘上（`walkFiles` 会收它：`.ts` ∈ 代码语言后缀） */
function makeProject(home: string): string {
  const proj = path.join(home, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  return proj;
}

/** 落一份设计册：`nodes` = 带 path 的节点，`excluded` = 管辖范围声明 */
function writeSheet(proj: string, sheet: { nodes?: Array<{ id: string; path: string }>; excluded?: Array<{ path: string; reason: string }> }): void {
  const dir = path.join(proj, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  const dsl = {
    feature: 'fx',
    title: 'fx',
    geometry: {
      nodes: (sheet.nodes ?? []).map((n) => ({ ...n, label: n.path, type: 'file', x: 0, y: 0 })),
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
    ...(sheet.excluded ? { excluded: sheet.excluded } : {}),
  };
  fs.writeFileSync(path.join(dir, 'fx.dsl.json'), JSON.stringify(dsl, null, 2), 'utf8');
}

const ENV = (home: string): NodeJS.ProcessEnv => ({ AGENT_IO_HOME: path.join(home, 'datahome') });

// ════════════════════════════════════════════════════════════════════
// ① 结构意图门
// ════════════════════════════════════════════════════════════════════
test('① 结构意图：源码文件既无节点也未排除 ⇒ 红，且**点名**它；把它登记进册 ⇒ 同一夹具转绿（消融）', () => {
  const home = makeTempHome();
  try {
    const proj = makeProject(home);
    writeSheet(proj, { nodes: [], excluded: [] });
    const red = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', path.join(home, 'none.json')], proj, ENV(home));
    assert.equal(red.status, 1, `有缺口必须是红（实测 status=${red.status}）：\n${tail(red.out)}`);
    assert.ok(red.out.includes('src/a.ts'), `必须**逐个点名**缺口文件（不许只报数字）：\n${tail(red.out)}`);
    // ★ 分母：0.12 第 3 条 —— 只给分子等于没验
    // ★ R32/R49：四桶读数（缺一档就回到「`with_node` 吞冲突」的改前形态）—— 标签统一为「干净入册」；
    //   `conflict` 自 R49 起是**债务槽位**（node wins ⇒ 必须为 0），所以文案是「冲突债务 N（必须为 0）」
    assert.ok(
      /源码 1 .*干净入册 0 .*已声明排除 0 .*冲突债务 0.*缺口 1/.test(red.out),
      `读数必须带分母（源码/干净入册/已排除/冲突债务/缺口）：\n${tail(red.out)}`,
    );

    // 消融的另一半：同一个夹具，只把文件登记进册 ⇒ 转绿（证明红不是"永远亮"）
    writeSheet(proj, { nodes: [{ id: 'f1', path: 'src/a.ts' }], excluded: [] });
    const green = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', path.join(home, 'none.json')], proj, ENV(home));
    assert.equal(green.status, 0, `有节点之后就应当绿（实测 status=${green.status}）：\n${tail(green.out)}`);
    assert.ok(green.out.includes('PASS'), `应当打印 PASS：\n${tail(green.out)}`);
  } finally {
    rmRf(home);
  }
});

test('② 结构意图：已声明 excluded（带 reason）的文件不算缺口 —— 但**空基线 + 开关**不能把门关掉', () => {
  const home = makeTempHome();
  try {
    const proj = makeProject(home);
    writeSheet(proj, { nodes: [], excluded: [{ path: 'src/', reason: '夹具目录，整目录不入册' }] });
    // ★ R32：**必须显式给基线**（不许落到仓里那份）—— 仓基线现在带 73 条冲突挂账，
    //   夹具项目里一条都不存在 ⇒ 会被判成"已消散 73 条"而红。这条原来靠"仓基线的 files/dirs 恰好为空"侥幸成立。
    const green = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', path.join(home, 'none.json')], proj, ENV(home));
    assert.equal(green.status, 0, `已声明排除 ⇒ 不算缺口（实测 status=${green.status}）：\n${tail(green.out)}`);
    assert.ok(/已声明排除 1 .*缺口 0/.test(green.out), `读数必须把"已声明排除"那一档数出来：\n${tail(green.out)}`);

    // 开关空转：没有排除声明 + 空基线名单 ⇒ 即使给了 --allow-structure-gaps 也必须红
    writeSheet(proj, { nodes: [], excluded: [] });
    const blank = path.join(home, 'blank-baseline.json');
    fs.writeFileSync(blank, JSON.stringify({ note: '', files: [], dirs: [] }), 'utf8');
    const noBlanket = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', blank, '--allow-structure-gaps'], proj, ENV(home));
    assert.equal(noBlanket.status, 1, `空名单 + 开关 = 拒绝（不许"一个全局开关关掉整扇门"）：\n${tail(noBlanket.out)}`);
    assert.ok(noBlanket.out.includes('开关不生效'), `报文要说清为什么拒：\n${tail(noBlanket.out)}`);
  } finally {
    rmRf(home);
  }
});

test('③ 结构意图：基线**只许不增** —— 登记过的缺口免红，新出现的一个照样红', () => {
  const home = makeTempHome();
  try {
    const proj = makeProject(home);
    writeSheet(proj, { nodes: [], excluded: [] });
    const baseline = path.join(home, 'baseline.json');
    fs.writeFileSync(
      baseline,
      JSON.stringify({ note: '夹具', files: [{ path: 'src/a.ts', reason: '夹具：已知存量，待补节点' }], dirs: [] }),
      'utf8',
    );
    const baselined = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', baseline, '--allow-structure-gaps'], proj, ENV(home));
    assert.equal(baselined.status, 0, `已登记 + 给开关 ⇒ 绿（棘轮的"不增"那一半）：\n${tail(baselined.out)}`);
    // ★ ⑤ 的判据（用户 2026-11-03 第二轮裁定）：棘轮口径下读数里**必须出现「已登记豁免 N」** ——
    //   不出现就无法区分「没有缺口」与「缺口被静默吞掉」（而"静默吞掉"正是 0.16 说的那种被关掉的告警）。
    assert.ok(
      baselined.out.includes('已登记豁免 1'),
      `棘轮口径必须把"已登记豁免 N"打进读数（缺了它，绿就可能是"缺口被吞"）：\n${tail(baselined.out)}`,
    );

    // ★ 严格模式必须压过开关：同一份基线 + --strict ⇒ 存量也算红（M2b 收尾"清零"验收就靠这一档）
    const strict = runIn(
      GATE_STRUCTURE,
      ['--project', proj, '--baseline', baseline, '--allow-structure-gaps', '--strict'],
      proj,
      ENV(home),
    );
    assert.equal(strict.status, 1, `--strict 必须压过 --allow-structure-gaps（存量也算红）：\n${tail(strict.out)}`);
    assert.ok(strict.out.includes('严格模式'), `报文要说清这是严格模式：\n${tail(strict.out)}`);

    // 再放一个**没登记**的源码文件 ⇒ 同一个基线下必须红，且点名的是"新的那个"
    fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
    const grown = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', baseline, '--allow-structure-gaps'], proj, ENV(home));
    assert.equal(grown.status, 1, `新增缺口必须红（基线只许不增）：\n${tail(grown.out)}`);
    assert.ok(grown.out.includes('src/b.ts'), `要点名**新增**的那一个：\n${tail(grown.out)}`);
    assert.ok(grown.out.includes('新增'), `报文要说清是"新增"：\n${tail(grown.out)}`);
  } finally {
    rmRf(home);
  }
});

// ────────────────────────────────────────────────────────────────────
// ★★★ 2026-11-05（R49）：冲突档从「三档棘轮」改成「**信息档 + 两条断言**」
//   前提：`excluded` 声明只豁免**没有任何册给它建节点**的路径（node wins）⇒ 本夹具（同一 path 既在
//   `nodes` 又在 `excluded` 里）现在归**干净入册**，`conflict` 桶必须为 0。
//   仍然保留的牙：① `conflict` 非零 ⇒ 红（判序被绕开）；② 四口径闭合等式不成立 ⇒ 红。
//   仍然保留的可见性：**N 处声明被节点覆盖**每次打印 + 逐条点名（删了就没人知道发生过什么）。
// ────────────────────────────────────────────────────────────────────
/**
 * 夹具要点：**同一个 path 同时在 `nodes` 与 `excluded` 里** ⇒ `excludedNodeConflicts` 把它算进信息档
 * （判定核在 `gen_design_db`，本门只读读数、不重算），而 `silentGapOf` 因 node wins 把它归 `with_node`。
 *
 * ★ 改前（R12④/R32）这一格是"待清债务"：投影跳过那些节点、判据不进 design-db ⇒ 两个读者取相反结论。
 *   R49 把声明的作用面收窄到"没有节点的路径" ⇒ 矛盾按构造成 0，那条债务账也随之退役。
 */
function makeConflictProject(home: string, files: string[] = ['src/a.ts']): string {
  const proj = path.join(home, 'proj-conflict');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(proj, f), 'export const a = 1;\n', 'utf8');
  writeSheet(proj, {
    nodes: files.map((f, i) => ({ id: `n${i}`, path: f })),
    excluded: [{ path: 'src/', reason: '夹具：整目录声明不管' }],
  });
  return proj;
}

const conflictEntry = (p: string, extra: Record<string, unknown> = {}) => ({
  path: p,
  declared: 'fx:src/',
  nodes: 1,
  expectations: 0,
  fix_by: 'todo_fixture-r12d',
  ...extra,
});

test('③-1 R49 冲突档（信息档）：声明被节点覆盖 ⇒ **只报不红**，且**逐条点名**（不许只给数字）', () => {
  const home = makeTempHome();
  try {
    const proj = makeConflictProject(home);
    // ★ 冲突档已**不再需要**基线：这个文件故意不存在 ⇒ 只应留下一条"基线文件不存在"的说明，不影响判定
    const baseline = path.join(home, 'b-none.json');
    const r = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', baseline], proj, ENV(home));
    assert.equal(r.status, 0, `信息档不红（实测 status=${r.status}）：\n${tail(r.out)}`);
    assert.ok(/干净入册 1/.test(r.out), `node wins ⇒ 该文件归「干净入册」（这是 R49 的核心）：\n${tail(r.out)}`);
    assert.ok(/冲突债务 0/.test(r.out), `冲突债务必须为 0：\n${tail(r.out)}`);
    assert.ok(r.out.includes('信息档：**1 处声明被节点覆盖**'), `信息档要**报数**：\n${tail(r.out)}`);
    assert.ok(r.out.includes('src/a.ts'), `必须**逐条点名**（只给数字等于没给）：\n${tail(r.out)}`);
    assert.ok(r.out.includes('fx:src/'), `每条要点得出命中**哪册哪个前缀**：\n${tail(r.out)}`);
  } finally {
    rmRf(home);
  }
});

test('③-2 R49 冲突档：多一处覆盖**也不红**（不再是"基线只许不增"），但**名单必须跟着变**', () => {
  const home = makeTempHome();
  try {
    const proj = makeConflictProject(home, ['src/a.ts', 'src/b.ts']);
    const r = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', path.join(home, 'b-none.json')], proj, ENV(home));
    assert.equal(r.status, 0, `信息档不红（实测 status=${r.status}）：\n${tail(r.out)}`);
    assert.ok(r.out.includes('信息档：**2 处声明被节点覆盖**'), `要报 2 处：\n${tail(r.out)}`);
    assert.ok(r.out.includes('src/a.ts') && r.out.includes('src/b.ts'), `两处都点名：\n${tail(r.out)}`);
    assert.ok(/干净入册 2/.test(r.out), `两个文件都因 node wins 入册：\n${tail(r.out)}`);
  } finally {
    rmRf(home);
  }
});

test('③-3 R49 冲突档：基线里残留**已退役**的 `conflicts` 键 ⇒ 不读它（只提示可删），判定不变', () => {
  const home = makeTempHome();
  try {
    const proj = makeConflictProject(home);
    const baseline = path.join(home, 'b-legacy.json');
    fs.writeFileSync(
      baseline,
      JSON.stringify({
        note: '',
        files: [],
        dirs: [],
        conflicts: [conflictEntry('src/a.ts'), conflictEntry('src/gone.ts')],
      }),
      'utf8',
    );
    const r = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', baseline], proj, ENV(home));
    assert.equal(r.status, 0, `残留键不改变判定（实测 status=${r.status}）：\n${tail(r.out)}`);
    assert.ok(r.out.includes('已退役'), `要说清那个键**已退役**（不许静默忽略）：\n${tail(r.out)}`);
    assert.ok(!/已消散|== 基线/.test(r.out), `旧的棘轮口径不许再出现（"已消散 / == 基线"）：\n${tail(r.out)}`);
  } finally {
    rmRf(home);
  }
});

test('③-4 R49 `--update-baseline` **已退役**：给退出码 2 + 说明，且**一个字节都不写**', () => {
  const home = makeTempHome();
  try {
    const proj = makeConflictProject(home);
    const baseline = path.join(home, 'b-upd.json');
    const before = `${JSON.stringify({ note: '夹具', files: [{ path: 'keep/me.ts', reason: '夹具' }], dirs: [] }, null, 2)}\n`;
    fs.writeFileSync(baseline, before, 'utf8');
    const r = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', baseline, '--update-baseline'], proj, ENV(home));
    assert.equal(r.status, 2, `退役开关必须给"判不了"(2) 而不是静默成功（实测 status=${r.status}）：\n${tail(r.out)}`);
    assert.ok(r.out.includes('已退役'), `要说清它已退役：\n${tail(r.out)}`);
    assert.equal(fs.readFileSync(baseline, 'utf8'), before, '基线文件**一个字节都不许动**');
  } finally {
    rmRf(home);
  }
});

// ────────────────────────────────────────────────────────────────────
// ★★★ 2026-11-05（R32/R49）：两条闭合不变量的**消融** —— 不闭合的输入**必须抛**
//   ★ 为什么必须在这里：注释里写的等式**自己不会红**（注释没有变量，写进去的也只是快照）。
//     等式落成可执行断言、并用一份坏输入把它打断，才算 0.25① 意义上的"检测点"。
// ────────────────────────────────────────────────────────────────────
test('③-6 闭合不变量①（四桶和 === 源码 ∧ **conflict 必须为 0**）：一致 ⇒ 过；不闭合 / 桶非空 ⇒ 必抛', () => {
  // 一致：2 + 0 + 0 + 0 = 2 = 源码数（node wins 之下 conflict 恒 0）
  assert.doesNotThrow(() =>
    assertSilentGapClosed({ source_files: 2, with_node: 2, excluded: 0, conflict: 0, conflict_list: [], gaps: [] }),
  );
  // ★★ R49 消融（本卡的核心）：把「有节点优先」摘掉 ⇒ 那批文件落回 conflict 桶（改前正是如此）⇒ 必须抛。
  //    这是"如果那一行被删掉，会红吗"的可执行答案。
  assert.throws(
    () => assertSilentGapClosed({ source_files: 1, with_node: 0, excluded: 0, conflict: 1, conflict_list: ['src/a.ts'], gaps: [] }),
    /冲突桶非空/,
    '「声明 ∧ 节点」落进任何桶 = 判序被绕开（有节点却没排在 excluded 之前）',
  );
  // 消融 A：某个文件被数了两次 ⇒ 和 > 分母
  assert.throws(
    () => assertSilentGapClosed({ source_files: 2, with_node: 2, excluded: 1, conflict: 0, conflict_list: [], gaps: [] }),
    /四桶不闭合/,
    '重复计数必须被抓：否则"干净入册"里可以混进已被排除的文件',
  );
  // 消融 B：某个文件一个桶都没进 ⇒ 和 < 分母
  assert.throws(
    () => assertSilentGapClosed({ source_files: 3, with_node: 1, excluded: 0, conflict: 0, conflict_list: [], gaps: [] }),
    /四桶不闭合/,
    '漏数必须被抓：否则缺口会被静默吞掉（这正是改前那个病）',
  );
  // 消融 C：冲突的"数"与"名单"不同口径（闸在"桶非空"之前，先抓口径）
  assert.throws(
    () => assertSilentGapClosed({ source_files: 1, with_node: 0, excluded: 0, conflict: 1, conflict_list: [], gaps: [] }),
    /不同口径/,
    '数了却没点名 = 有一条冲突既被数了又没被点名',
  );
});

test('③-7 四口径闭合（册上 === 本门冲突 + 幽灵 + 口径外 + 因 node-wins 入册）：一致 ⇒ 过；对不上 ⇒ 必抛', () => {
  assert.doesNotThrow(() =>
    assertConflictUniverseClosed({ book_files: 5, gate_conflict: 0, ghosts: 1, out_of_scope: 1, node_won: 3 }),
  );
  // 消融：口径外被算错（少算一个）⇒ 册上多出来一个没解释的
  assert.throws(
    () => assertConflictUniverseClosed({ book_files: 5, gate_conflict: 0, ghosts: 1, out_of_scope: 0, node_won: 3 }),
    /四个口径不闭合/,
  );
  // 消融：幽灵被清掉却没同步（册上仍按旧口径）
  assert.throws(
    () => assertConflictUniverseClosed({ book_files: 4, gate_conflict: 0, ghosts: 1, out_of_scope: 1, node_won: 3 }),
    /四个口径不闭合/,
  );
  // 消融：R49 的第四项漏算（因 node-wins 入册的那批没人解释）
  assert.throws(
    () => assertConflictUniverseClosed({ book_files: 5, gate_conflict: 0, ghosts: 1, out_of_scope: 1, node_won: 2 }),
    /四个口径不闭合/,
  );
  // 消融：冲突项两边都不在（既没节点、也没被声明）⇒ `silentGapOf` 当场抛，不许静默归到缺口
  assert.throws(
    () => silentGapOf({ source_files: ['src/a.ts'], node_paths: [], excluded: [], conflict_paths: ['src/a.ts'] }),
    /闭合不变量被破坏/,
  );
  // 反向（R49 node wins）：确实是「声明 ∧ 节点」时**不许**抛 —— 否则"一律抛"也能让上面几条绿；
  //   而且它必须归 `with_node`、conflict 必须为 0。
  const r = silentGapOf({
    source_files: ['src/a.ts'],
    node_paths: ['src/a.ts'],
    excluded: [{ path: 'src/a.ts', reason: '夹具' }],
    conflict_paths: ['src/a.ts'],
  });
  assert.equal(r.with_node, 1, 'node wins：有节点 ⇒ 声明不适用');
  assert.equal(r.conflict, 0, '「声明 ∧ 节点」不再落进任何桶');
});

test('③-8 四口径并排：门的读数里出现**现算的等式**，且幽灵 / 因 node-wins 入册的**逐个点名**（不写死数字）', () => {
  const home = makeTempHome();
  try {
    const proj = makeConflictProject(home, ['src/a.ts']);
    // 再给一个**盘上不存在**的节点（幽灵）：它也在 excluded 前缀里 ⇒ 册上口径算覆盖、本门看不见
    writeSheet(proj, {
      nodes: [
        { id: 'n1', path: 'src/a.ts' },
        { id: 'n2', path: 'src/gone.ts' },
      ],
      excluded: [{ path: 'src/', reason: '夹具：整目录声明不管' }],
    });
    // ★ R49：冲突档不再需要基线（这里故意给一个不存在的路径，只留一句"基线文件不存在"的说明）
    const r = runIn(GATE_STRUCTURE, ['--project', proj, '--baseline', path.join(home, 'b-none.json')], proj, ENV(home));
    assert.equal(r.status, 0, `信息档不红：\n${tail(r.out)}`);
    assert.ok(r.out.includes('自解释等式'), `读数必须印等式（而不是只给一个数）：\n${tail(r.out)}`);
    // 册上 2 = 本门冲突 0 + 幽灵 1 + 口径外 0 + 因 node-wins 入册 1 —— 四个数都是现算的
    assert.ok(
      /册上 2 = 本门冲突 0 \+ 幽灵 1 \+ 本门口径外 0 \+ 因 node-wins 入册 1/.test(r.out),
      `等式必须逐项对得上（含 R49 的第四项）：\n${tail(r.out)}`,
    );
    assert.ok(r.out.includes('src/gone.ts'), `幽灵必须**逐个点名**：\n${tail(r.out)}`);
    assert.ok(r.out.includes('幽灵节点'), `要说清它属于哪一类（幽灵 vs 口径外 vs 入册）：\n${tail(r.out)}`);
    assert.ok(r.out.includes('因 node wins 进了 with_node'), `第四类也要点名说清（R49 新增的那一类）：\n${tail(r.out)}`);
    assert.ok(r.out.includes('分区成立'), `等式成立时也要说清"成立"（否则读端分不清"对"与"没算"）：\n${tail(r.out)}`);
  } finally {
    rmRf(home);
  }
});


// ════════════════════════════════════════════════════════════════════
// ② 无卡写账门
// ════════════════════════════════════════════════════════════════════
/**
 * ★ 这一档的夹具**不能放 `%TEMP%`**（实测撞出来的边界，如实记下）：
 *   对账器的「哪一行算用户源码的写」只认 `classifyWriteSubject` 的一把尺，而它按**顺序**
 *   先判 `temp`（`os.tmpdir()` 之下）⇒ `%TEMP%` 里的 `src/a.ts` 被记成 `temp` 并从分母里**排除**
 *   （实测：两行写全被排除 ⇒ 读数 总写入 0）。⇒ 夹具建在仓内 `.agent-io/scratch/wire-gates/`
 *   之下（`AGENTS-RULES 0.27.4` 指定的临时件目录），**收尾必删**；它自己的 `.agent-io/tasks.db`
 *   是夹具库，与真账无涉。
 */
const SCRATCH = path.resolve('.agent-io', 'scratch', 'wire-gates');

function makeScratchProject(tag: string): string {
  const proj = path.join(SCRATCH, `fx-${tag}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  return proj;
}

/** 让一条写进账（★ 2026-11-04：`branch` 可指定 —— 分诊要用不同放行支做消融） */
function appendWrite(proj: string, opts: { file: string; card?: string; at: string; branch?: string }): void {
  openTasksDb(proj).close();
  const branch = opts.branch ?? (opts.card ? 'covered' : 'files-not-in-design');
  const r = recordWriteLog(proj, [
    writeLogRowOf(opts.file, 'commit', {
      actor: 'subagent:fixture',
      at: opts.at,
      card_of: opts.card ? { [opts.file]: { feature: 'fx', nodeId: opts.card } } : {},
      branch_of: { [opts.file]: branch },
    }),
  ]);
  assert.equal(r.error, undefined, `夹具自己的写账失败了（不是被测对象的问题）：${r.error ?? ''}`);
}

test('④ 无卡写账：有卡写 ⇒ 绿；插入一条 `card_id IS NULL` 的写 ⇒ 红并**逐条点名** file/at/actor/source', () => {
  const proj = makeScratchProject('writes');
  try {
    const baseline = path.join(path.dirname(proj), 'wl-baseline.json');
    fs.writeFileSync(baseline, JSON.stringify({ note: '', max_no_card: 0, rows: [] }), 'utf8');

    appendWrite(proj, { file: 'src/a.ts', card: 'card_1', at: '2026-01-01T00:00:00.000Z' });
    const green = runIn(AUDIT_WRITES, ['--gate', '--project', proj, '--baseline', baseline], proj);
    assert.equal(green.status, 0, `全都有卡 ⇒ 绿（实测 status=${green.status}）：\n${tail(green.out)}`);
    assert.ok(/总写入 1 .*有卡 1 .*\*?\*?无卡 0/.test(green.out), `读数必须带分母（总写入/有卡/无卡）：\n${tail(green.out)}`);

    // 消融：插一条无卡写（`card_of` 为空 ⇒ 账原生 `card_id=NULL`）
    appendWrite(proj, { file: 'src/a.ts', at: '2026-01-02T00:00:00.000Z' });
    const red = runIn(AUDIT_WRITES, ['--gate', '--project', proj, '--baseline', baseline], proj);
    assert.equal(red.status, 1, `无卡写必须红（实测 status=${red.status}）：\n${tail(red.out)}`);
    assert.ok(red.out.includes('2026-01-02T00:00:00.000Z'), `要点名那条无卡写的 at：\n${tail(red.out)}`);
    assert.ok(red.out.includes('subagent:fixture'), `要点名那条无卡写的 actor：\n${tail(red.out)}`);
    assert.ok(red.out.includes('source=unmapped'), `要点名那条无卡写的 source：\n${tail(red.out)}`);
  } finally {
    rmRf(path.dirname(proj));
  }
});

test('⑤ 无卡写账：历史存量进基线后免红，**新插**一条又红（棘轮只许不增）', () => {
  const proj = makeScratchProject('ratchet');
  try {
    const at1 = '2026-01-01T00:00:00.000Z';
    appendWrite(proj, { file: 'src/a.ts', at: at1 });
    const baseline = path.join(path.dirname(proj), 'wl-baseline.json');
    fs.writeFileSync(
      baseline,
      JSON.stringify({
        note: '夹具',
        max_no_card: 1,
        rows: [{ key: `${at1}|src/a.ts|commit`, reason: '夹具：历史存量（无卡，但走的是写原语，记账留痕）' }],
      }),
      'utf8',
    );
    const baselined = runIn(AUDIT_WRITES, ['--gate', '--project', proj, '--baseline', baseline], proj);
    assert.equal(baselined.status, 0, `存量已登记 ⇒ 绿：\n${tail(baselined.out)}`);

    appendWrite(proj, { file: 'src/a.ts', at: '2026-01-03T00:00:00.000Z' });
    const grown = runIn(AUDIT_WRITES, ['--gate', '--project', proj, '--baseline', baseline], proj);
    assert.equal(grown.status, 1, `新增无卡写必须红（基线只许不增）：\n${tail(grown.out)}`);
    assert.ok(grown.out.includes('2026-01-03T00:00:00.000Z'), `要点名新增的那一条：\n${tail(grown.out)}`);
    assert.ok(/无卡写 2 条 > 基线上限 1 条/.test(grown.out), `条数棘轮也要报出来：\n${tail(grown.out)}`);
  } finally {
    rmRf(path.dirname(proj));
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ 分诊表 / G13 记卡 / 口径消融（2026-11-04 · `docs/todo.md` G13·G17 收口）
// ════════════════════════════════════════════════════════════════════

/**
 * ⑥ 分诊表：**8 个放行支逐条**有分类，且「该不该进无卡写的分子」在三个方向上都钉住 ——
 *   · `card-required` ∧ 无卡 ⇒ **计数**（这是门唯一的牙齿：文件不在册就写）；
 *   · `card-guaranteed` ∧ 无卡 ⇒ **不计数**（G13：凭证没记下 ≠ 没有卡，另计「凭证未记」）；
 *   · `card-impossible` ∧ 无卡 ⇒ **不计数**（G17：结构上不可能有卡）。
 * 外加两条异义用例：`rollback`（回滚通道不过闸）与闭集外支名（判不了 ⇒ 不冒充任何一档）。
 */
test('⑥ 分诊表：8 个支逐条有分类；card-guaranteed 无卡**不算**无卡写（G13/G17 双向判据）', () => {
  type Card = 'card-required' | 'card-guaranteed' | 'card-impossible';
  const EXPECTED: Record<string, Card> = {
    'no-files': 'card-impossible',
    'no-feature-for-root': 'card-impossible',
    'files-not-in-design': 'card-required',
    unaddressable: 'card-impossible',
    exempt: 'card-impossible',
    authorized: 'card-guaranteed',
    'first-run-unclaimed': 'card-required',
    covered: 'card-guaranteed',
  };
  // ★ 8 个支**全给**分类：漏一个 `tsc --noEmit` 就红（`Record<TaskGateBasis, …>` 穷尽）。
  //   这里再在运行期钉一次「表里的键恰好是这 8 个」—— 防止有人用 `as` 强转绕过穷尽检查。
  assert.deepEqual(
    Object.keys(BASIS_CARDABILITY).sort(),
    Object.keys(EXPECTED).sort(),
    `分诊表必须恰好覆盖 8 个放行支：实测 ${JSON.stringify(Object.keys(BASIS_CARDABILITY).sort())}`,
  );
  for (const [b, want] of Object.entries(EXPECTED)) {
    assert.equal(cardabilityOfBranch(b), want, `${b} 的分诊必须是 ${want}`);
    assert.equal(
      countsAsNoCardWrite(b, null),
      want === 'card-required',
      `${b} ∧ 无卡 ⇒ 是否计入分子（期望 ${want === 'card-required'}）`,
    );
    assert.equal(
      countsAsCredentialMiss(b, null),
      want === 'card-guaranteed',
      `${b} ∧ 无卡 ⇒ 是否算「凭证未记」（期望 ${want === 'card-guaranteed'}）`,
    );
    assert.equal(countsAsNoCardWrite(b, 'card_x'), false, `${b} ∧ 有卡 ⇒ 一律不计数`);
    assert.equal(countsAsCredentialMiss(b, 'card_x'), false, `${b} ∧ 有卡 ⇒ 一律不算凭证未记`);
  }
  // 异义①：回滚通道（`write_log#writeLogRowOf` 记的就是这个支名）不过闸 ⇒ 无卡是对的
  assert.equal(cardabilityOfBranch('rollback'), 'card-impossible');
  assert.equal(countsAsNoCardWrite('rollback', null), false);
  // 异义②：闭集外的支名 ⇒ **判不了**，绝不冒充「不该有卡」（对账器对它必须硬红）
  assert.equal(cardabilityOfBranch('made-up-branch'), 'unknown');
  assert.equal(countsAsNoCardWrite('made-up-branch', null), false);
  assert.equal(countsAsCredentialMiss('made-up-branch', null), false);
});

/**
 * ⑦ G13（**消融过**）：有 claimed 卡但**不传 actor** ⇒ `card_of` 仍然记卡。
 *
 * 改前：`evaluateTaskGate` 的 `if (!actor)` 那一支直接 `continue`（不写 `cardOf`）⇒ branch=covered 但
 * card_id 为空 ⇒ write_log 记 NULL ⇒ 被算成「无卡写」（存量实测 14 条 covered + 1 条 authorized）。
 * 消融：把 `recordCard(rel, claimed)` 那一行删掉 ⇒ 本用例红。
 */
test('⑦ G13：claimed 卡在、但不传 actor ⇒ card_of 仍记卡（凭证不因「不知道是谁」而消失）', () => {
  const home = makeTempHome();
  const saved = {
    home: process.env.AGENT_IO_HOME,
    actor: process.env.AGENT_IO_ACTOR,
    strict: process.env.AGENT_IO_ACTOR_STRICT,
    plan: process.env.AGENT_IO_REQUIRE_PLAN,
  };
  try {
    const proj = path.join(home, 'g13proj');
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    process.env.AGENT_IO_HOME = path.join(home, 'datahome');
    delete process.env.AGENT_IO_ACTOR;
    delete process.env.AGENT_IO_ACTOR_STRICT;
    // ★ 与 `tests/p0_gate_exemption.test.ts` 同一条边界：本用例观察的是**逐文件卡读数**，
    //   而重写计划闸会先把它拦掉（夹具里没有画布）⇒ 只在本用例内关掉（关掉后仍会打一行「只报不拦」）。
    process.env.AGENT_IO_REQUIRE_PLAN = '0';
    saveDSL({
      id: 'feature_g13',
      type: 'feature_diagram',
      feature: 'g13',
      version: '1.0.0',
      title: 'g13',
      source_root: proj,
      geometry: {
        layout: 'free',
        width: 200,
        height: 200,
        edges: [],
        nodes: [
          {
            id: 'file_src_a_ts',
            type: 'file',
            label: 'a.ts',
            path: 'src/a.ts',
            task: {
              id: 'file_src_a_ts',
              summary: 'G13 夹具：别人领着的卡',
              expectations: [],
              state: 'claimed',
              owner: 'someone-else',
              claimed_at: '2026-10-20T00:00:00.000Z',
            },
          },
        ],
      },
      semantic: { files: [] },
      layers: {},
      annotations: [],
    } as never);
    const out = assertSourceWriteRegistered(proj, ['src/a.ts']) as unknown as {
      basis: string;
      card_of: Record<string, { feature: string; nodeId: string } | null>;
    };
    assert.equal(out.basis, 'covered', `这一批应当判 covered（有 claimed 卡）：实测 ${out.basis}`);
    const card = out.card_of['src/a.ts'];
    assert.ok(
      card && card.nodeId === 'file_src_a_ts',
      `★ G13：拿不到 actor 只说明「卡是不是你的」未核对，不说明「没有卡」⇒ card_of 必须仍记卡；` +
        `实测 ${JSON.stringify(card)}（改前这里是 null ⇒ write_log 记 card_id=NULL ⇒ 被算成无卡写）`,
    );
  } finally {
    if (saved.home === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = saved.home;
    if (saved.actor === undefined) delete process.env.AGENT_IO_ACTOR;
    else process.env.AGENT_IO_ACTOR = saved.actor;
    if (saved.strict === undefined) delete process.env.AGENT_IO_ACTOR_STRICT;
    else process.env.AGENT_IO_ACTOR_STRICT = saved.strict;
    if (saved.plan === undefined) delete process.env.AGENT_IO_REQUIRE_PLAN;
    else process.env.AGENT_IO_REQUIRE_PLAN = saved.plan;
    rmRf(home);
  }
});

/**
 * ⑧ 口径消融（**本门的牙齿**）：`exempt` / `unaddressable` 的无卡写**不计数但是必须印出来**；
 * 而 `files-not-in-design`（文件不在册就写）**照样红** —— 否则 `该有卡而没卡 = 0` 就是一个空洞的门。
 */
test('⑧ 口径消融：exempt / unaddressable 不计数但必须印出数；files-not-in-design 照样红', () => {
  const proj = makeScratchProject('cardability');
  try {
    const baseline = path.join(path.dirname(proj), 'wl-card.json');
    fs.writeFileSync(baseline, JSON.stringify({ note: '', max_no_card: 0, rows: [], credential_missed: [] }), 'utf8');
    appendWrite(proj, { file: 'src/a.ts', at: '2026-02-01T00:00:00.000Z', branch: 'exempt' });
    appendWrite(proj, { file: 'src/a.ts', at: '2026-02-02T00:00:00.000Z', branch: 'unaddressable' });
    const green = runIn(AUDIT_WRITES, ['--gate', '--project', proj, '--baseline', baseline], proj);
    assert.equal(green.status, 0, `结构上不可能有卡的两条 ⇒ 不计数、门绿：\n${tail(green.out)}`);
    assert.ok(/不该有卡跳过 2/.test(green.out), `★ 跳过必须印出数（跳过 ≠ 看不见，0.12③）：\n${tail(green.out)}`);
    assert.ok(
      /exempt 1/.test(green.out) && /unaddressable 1/.test(green.out),
      `跳过的按支分组要印出来（哪一支跳了几条）：\n${tail(green.out)}`,
    );

    appendWrite(proj, { file: 'src/a.ts', at: '2026-02-03T00:00:00.000Z', branch: 'files-not-in-design' });
    const red = runIn(AUDIT_WRITES, ['--gate', '--project', proj, '--baseline', baseline], proj);
    assert.equal(red.status, 1, `★ 门唯一的牙齿：新文件不入册就写（files-not-in-design）必须红：\n${tail(red.out)}`);
    assert.ok(red.out.includes('**新增**无卡写 1 条'), `要点名「新增无卡写 1 条」：\n${tail(red.out)}`);
    assert.ok(red.out.includes('2026-02-03T00:00:00.000Z'), `要点名那一条的 at：\n${tail(red.out)}`);
  } finally {
    rmRf(path.dirname(proj));
  }
});

/**
 * ⑨ 凭证未记的棘轮（裁定 2：**冻结历史 + 新增恒严**）：
 * `covered` 支却拿不到 card_id ⇒ **不进分子**（不是绕开设计线），但也**不许被吞掉** ——
 * 不在 `credential_missed` 名单里就红（写端已修 ⇒ 新增一条就是回退）。
 */
test('⑨ 凭证未记棘轮：covered 无凭证不进分子，但不在 credential_missed 名单里就红', () => {
  const proj = makeScratchProject('credmiss');
  try {
    const baseline = path.join(path.dirname(proj), 'wl-cred.json');
    fs.writeFileSync(baseline, JSON.stringify({ note: '', max_no_card: 0, rows: [], credential_missed: [] }), 'utf8');
    appendWrite(proj, { file: 'src/a.ts', at: '2026-03-01T00:00:00.000Z', branch: 'covered' });
    const red = runIn(AUDIT_WRITES, ['--gate', '--project', proj, '--baseline', baseline], proj);
    assert.equal(red.status, 1, `G13 修后「covered 无凭证」= 写端回退 ⇒ 必须红：\n${tail(red.out)}`);
    assert.ok(red.out.includes('有卡但凭证没记下'), `报文要说清这是凭证问题、不是绕开设计线：\n${tail(red.out)}`);
    assert.ok(/该有卡而没卡 0/.test(red.out), `分子仍是 0（「有卡但没记」不进分子）：\n${tail(red.out)}`);
  } finally {
    rmRf(path.dirname(proj));
  }
});
