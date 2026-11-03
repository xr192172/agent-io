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
    assert.ok(/源码 1 .*有节点 0 .*已声明排除 0 .*缺口 1/.test(red.out), `读数必须带分母（源码/有节点/已排除/缺口）：\n${tail(red.out)}`);

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
    const green = runIn(GATE_STRUCTURE, ['--project', proj], proj, ENV(home));
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

/** 让一条写进账：走**写原语自己的记账函数**（`writeLogRowOf` + `recordWriteLog`），不手拼 SQL（0.20） */
function appendWrite(proj: string, opts: { file: string; card?: string; at: string }): void {
  openTasksDb(proj).close();
  const r = recordWriteLog(proj, [
    writeLogRowOf(opts.file, 'commit', {
      actor: 'subagent:fixture',
      at: opts.at,
      card_of: opts.card ? { [opts.file]: { feature: 'fx', nodeId: opts.card } } : {},
      branch_of: { [opts.file]: opts.card ? 'covered' : 'files-not-in-design' },
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
