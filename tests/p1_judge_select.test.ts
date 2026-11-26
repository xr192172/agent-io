/**
 * touches: src/domain/expectation.ts, src/application/design/index.ts, scripts/judge-all.mjs, scripts/lib/changed_set.mjs
 *
 * P1 · **judge 侧选量（T-#INC-JUDGE-SEL）的检测点**（2026-11-17）。
 *
 * ## 它锁的是什么
 * `judge-all` 原来每轮全量现判（实测 100.3s / 822 条 / 三册各 spawn 一次 CLI）。
 * 本卡加的是**选量层**：`changed ∩ 观察面` ⇒ 只判可能被影响的判据。选量是**唯一**能
 * "省时间又不说谎"的地方 —— 所以它的每一条规则都必须有检测点，否则退化成**静默少判**。
 *
 * ## 三条最容易做错的（本文件逐条钉住）
 * 1. **不可局部化的判据不许被筛掉**：`run` / `domain-independent` / `runtime` 的主体不是文件，
 *    `call-exists` / `edge-*` 的事实源是**整张边表** ⇒ 它们**恒判**（实测：这一档 470 条判完 4.1s，
 *    是 `behavior-cases` 那 65s 的 6%）⇒ 省时间不该省它们，省了就是"判据面有洞而没人知道"。
 * 2. **分母必须给**：`selected / total` + `unselected` 三件一起出现在回执里（0.12 第 3 条）。
 *    `unselected` 的语义是"本次没判"，**不是**通过 —— 任何把它读成绿的读端都是假绿。
 * 3. **保守回退有三种，且都要说明原因**：空 changed / 册文件自己变了 / 未知 kind（进恒选集）。
 *    反向（消融）用例证明"恒选集"不是摆设。
 *
 * ## 为什么端到端跑 CLI（而不是只测纯函数）
 * 纯函数测得出"规则对不对"，测不出"**入口接上了没有**"（本仓最常见的形态：判定在、入口没接）。
 * 这里 spawn 真实 CLI（`dist/.../cli.js`，与 `scripts/judge-all.mjs` 同一条路），断言回执里的
 * `selection` 块与 `items` 条数一致；并断言**全量模式回执里没有 `selection` 字段**（向后兼容）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  collectExpectations,
  isLocalizableKind,
  selectExpectationsForChanged,
} from '../src/domain/expectation.js';
import { KIND_SPECS } from '../src/domain/expectation_kinds.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'dist', 'src', 'presentation', 'cli', 'cli.js');

type Item = { node_id: string; node_label: string; expectation: Record<string, unknown> };

/** 造一条最小判据（kind 必填字段由调用方给） */
function item(node_id: string, expectation: Record<string, unknown>): Item {
  return { node_id, node_label: node_id, expectation: { why: '夹具理由', ...expectation } } as Item;
}

// ══════════════════════════════════════════════════════════════════════════
// ① 基本口径：路径命中 + 恒选集；分子分母都对
// ══════════════════════════════════════════════════════════════════════════
test('选量① · 路径命中 + 恒选集：selected/total/hit/always/unselected 五个数必须自洽', () => {
  const items: Item[] = [
    item('n_hit1', { kind: 'file-exists', path: 'src/a.ts' }),
    item('n_hit2', { kind: 'source-has', path: 'src/a.ts', must: ['X'] }),
    item('n_miss', { kind: 'file-exists', path: 'src/b.ts' }),
    item('n_run', { kind: 'run', expect: 'true' }),
    item('n_domain', { kind: 'domain-independent', domain: 'd1', must_not_import: ['src/b.ts'] }),
    item('n_call', { kind: 'call-exists', path: 'src/b.ts', symbol: 'f', target: 'g' }),
    item('n_edge', { kind: 'edge-exists', from: 'src/b.ts', to: 'src/c.ts' }),
  ];
  const sel = selectExpectationsForChanged(items as never, ['src/a.ts']);
  assert.equal(sel.mode, 'changed');
  assert.equal(sel.why_full, '');
  assert.equal(sel.total, 7, '分母 = 该册全部判据（不是选中数）');
  assert.equal(sel.hit, 2, '路径命中：两条 src/a.ts 的判据');
  // ★ 恒选集是**按 kind** 定的，不是按路径：run / domain-independent / call-exists / edge-exists
  //   的事实源都不是"某一个文件的字节"（边表 / 表达式 / 域）⇒ 哪怕路径不命中也要判。
  assert.equal(sel.always, 4, '恒选集：run + domain-independent + call-exists + edge-exists');
  assert.equal(sel.selected, 6);
  assert.equal(sel.unselected, 1, '未判 = total - selected（"本次没判"，不是通过）');
  assert.deepEqual(
    sel.items.map((x) => x.node_id),
    ['n_hit1', 'n_hit2', 'n_run', 'n_domain', 'n_call', 'n_edge'],
    '选中集必须保序（回执与册的顺序一致）',
  );
  // ★ 唯一未判的必须是"可局部化 + 路径不相交"那条 —— 这就是选量该省的部分
  assert.equal(sel.items.some((x) => x.node_id === 'n_miss'), false);
});

// ══════════════════════════════════════════════════════════════════════════
// ② 保守方向之一：空 changed ⇒ 全量
// ══════════════════════════════════════════════════════════════════════════
test('选量② · 空 changed ⇒ 回落全量（"没有改动"不等于"没有判据要判"）', () => {
  const items: Item[] = [
    item('a', { kind: 'file-exists', path: 'src/a.ts' }),
    item('b', { kind: 'run', expect: 'true' }),
  ];
  for (const empty of [[], [''], ['   '], ['./']]) {
    const sel = selectExpectationsForChanged(items as never, empty as string[]);
    assert.equal(sel.mode, 'full', `空输入 ${JSON.stringify(empty)} 必须回落全量`);
    assert.equal(sel.why_full, 'no-changed');
    assert.equal(sel.selected, sel.total);
    assert.equal(sel.unselected, 0);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 保守方向之二：册文件自己变了 ⇒ 该册全量（判据内容变了，选量的输入就是它本身）
// ══════════════════════════════════════════════════════════════════════════
test('选量③ · 册文件在 changed 里 ⇒ 该册全量（否则"改了判据还没重判"= 假绿）', () => {
  const items: Item[] = [
    item('a', { kind: 'file-exists', path: 'src/a.ts' }),
    item('b', { kind: 'file-exists', path: 'src/b.ts' }),
  ];
  const sheet = '.agent-io/design/foo.dsl.json';
  const sel = selectExpectationsForChanged(items as never, ['src/a.ts', sheet], { sheetPath: sheet });
  assert.equal(sel.mode, 'full');
  assert.equal(sel.why_full, 'sheet-changed');
  assert.equal(sel.selected, 2, '册变了 ⇒ 两条都要判（不许只判命中那条）');
  // ★ 册路径的斜杠形态也要认（win32 侧常给反斜杠）
  const sel2 = selectExpectationsForChanged(items as never, ['src/a.ts', sheet.replace(/\//g, '\\')], { sheetPath: sheet });
  assert.equal(sel2.why_full, 'sheet-changed', '反斜杠形态的册路径必须同样认出来');
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 消融（0.16 反向）：证明恒选集真在起作用，不是摆设
// ══════════════════════════════════════════════════════════════════════════
test('选量④ · 消融：关掉恒选集 ⇒ 不可局部化的判据必须全部消失（这一档有牙）', () => {
  const items: Item[] = [
    item('n_file', { kind: 'file-exists', path: 'src/a.ts' }),
    item('n_run', { kind: 'run', expect: 'true' }),
    item('n_domain', { kind: 'domain-independent', domain: 'd1', must_not_import: [] }),
    item('n_call', { kind: 'call-exists', path: 'src/a.ts', symbol: 'f', target: 'g' }),
    item('n_edge', { kind: 'edge-absent', from: 'src/a.ts', to: 'src/zzz.ts' }),
  ];
  const on = selectExpectationsForChanged(items as never, ['src/a.ts']);
  const off = selectExpectationsForChanged(items as never, ['src/a.ts'], { alwaysJudgeNonLocalizable: false });
  assert.equal(on.selected, 5, '缺省：恒选集照判（run + domain + call + edge）');
  // ★ 消融口径：那一档**整档摘掉**（连它的路径命中也不选）—— 这样"差出来多少"才等于这一档的代价。
  assert.equal(off.selected, 1, '消融后只剩"可局部化 + 路径命中"的那一条');
  assert.equal(off.always, 0);
  assert.equal(on.selected - off.selected, 4, '差出来的正是 run + domain-independent + call-exists + edge-absent');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ 分类从注册表派生：不许手写名单（注册表加 kind ⇒ 分类自动跟上）
// ══════════════════════════════════════════════════════════════════════════
test('选量⑤ · "可不可局部化"逐 kind 对表（派生自 KIND_SPECS，不是手写名单）', () => {
  // 业务口径（这一份是**期望**，不是实现的复述）：主体不是文件 / 事实源是边表 ⇒ 不可局部化
  const mustBeGlobal = ['run', 'domain-independent', 'runtime', 'call-exists', 'edge-exists', 'edge-absent'];
  const mustBeLocal = ['file-exists', 'symbol-exists', 'signature-matches', 'source-has', 'behavior-cases', 'journey-cases'];
  for (const k of mustBeGlobal) {
    assert.equal(isLocalizableKind(k), false, `${k} 的观察面不是单文件 ⇒ 必须恒判`);
    assert.ok(KIND_SPECS[k], `${k} 必须在注册表里（否则本条断言在测空气）`);
  }
  for (const k of mustBeLocal) {
    assert.equal(isLocalizableKind(k), true, `${k} 只读目标文件 ⇒ 可以按 path 选`);
    assert.ok(KIND_SPECS[k], `${k} 必须在注册表里`);
  }
  // ★ 未知 kind：注册表里没有 ⇒ **不许**判成"可筛"（那等于静默跳过），必须进恒选集
  assert.equal(isLocalizableKind('no-such-kind'), false);
  const sel = selectExpectationsForChanged(
    [item('x', { kind: 'no-such-kind', path: 'src/zzz.ts' })] as never,
    ['src/a.ts'],
  );
  assert.equal(sel.selected, 1, '未知 kind 必须被恒选（保守方向）');
  assert.equal(sel.always, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ 结构审计：**没有**"路径命中却未判"的漏网（跨全部注册 kind 覆盖）
// ══════════════════════════════════════════════════════════════════════════
test('选量⑥ · 结构审计：每个 kind 的"命中样本"都必须被选中；未判的只能是路径不相交的', () => {
  // 用注册表自己的字段表造样本（加 kind 时本用例自动跟上 —— 不需要谁记得回来改）
  const sample = (kind: string, p: string): Item => {
    const spec = KIND_SPECS[kind];
    const e: Record<string, unknown> = { kind };
    for (const f of spec.fields) e[f.name] = f.type === 'string[]' ? [] : f.type === 'json[]' || f.type === 'object[]' ? [] : 'x';
    // 路径位：edge-* 用 from/to，其余用 path
    if (spec.axis === 'edge') {
      e.from = p;
      e.to = 'src/other.ts';
    } else if (spec.subject !== '') e.path = p;
    return item(`n_${kind}`, e);
  };
  const CHANGED = 'src/changed.ts';
  const items = Object.keys(KIND_SPECS).flatMap((k) => [sample(k, CHANGED), sample(k, 'src/untouched.ts')]);
  const sel = selectExpectationsForChanged(items as never, [CHANGED], { sheetPath: '.agent-io/design/x.dsl.json' });
  const selected = new Set(sel.items.map((x) => x.node_id));
  for (const k of Object.keys(KIND_SPECS)) {
    assert.ok(selected.has(`n_${k}`), `${k}：路径命中的样本必须被选中（漏了就是静默少判）`);
    // 不可局部化的 kind：两份样本都恒选（观察面不是单文件 ⇒ 不能靠路径否掉它）
    if (!isLocalizableKind(k)) {
      assert.ok(selected.has(`n_${k}`), `${k} 不可局部化 ⇒ 必须恒选`);
    }
  }
  // 未判集必须**只有**"可局部化 + 路径不相交"的那些
  const unjudged = items.filter((x) => !selected.has(x.node_id));
  for (const u of unjudged) {
    assert.equal(isLocalizableKind(u.expectation.kind as string), true, `${u.node_id} 不该未判`);
    assert.equal(pathsOf(u) .includes(CHANGED), false, `${u.node_id} 的路径命中却未判 ⇒ 漏网`);
  }
  assert.equal(sel.total, items.length, '分母 = 全部样本');
  assert.equal(sel.selected + sel.unselected, sel.total);

  function pathsOf(x: Item): string[] {
    const e = x.expectation;
    return String(e.kind).startsWith('edge-') ? [String(e.from), String(e.to)] : [String(e.path ?? '')];
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ⑦ 路径归一：反斜杠 / `./` 前缀 / 大小写外的形态差异都必须命中同一条
// ══════════════════════════════════════════════════════════════════════════
test('选量⑦ · 路径归一：判据侧给反斜杠、changed 侧给 `./` 前缀 ⇒ 仍要命中', () => {
  const items: Item[] = [
    item('n1', { kind: 'file-exists', path: 'src\\domain\\rate.ts' }),
    item('n2', { kind: 'source-has', path: './src/domain/rate.ts', must: ['x'] }),
  ];
  const sel = selectExpectationsForChanged(items as never, ['src/domain/rate.ts']);
  assert.equal(sel.hit, 2, '两种形态都必须归一到同一个路径（否则"改了却没判"）');
  const sel2 = selectExpectationsForChanged(items as never, ['./src/domain/rate.ts']);
  assert.equal(sel2.hit, 2);
  const sel3 = selectExpectationsForChanged(items as never, ['src\\domain\\rate.ts']);
  assert.equal(sel3.hit, 2, 'changed 侧的反斜杠形态也要认');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑧ 端到端：真实 CLI 的 judge 回执里带 selection，且 items 只含选中条目
// ══════════════════════════════════════════════════════════════════════════
type Fixture = { home: string; project: string; feature: string; dispose: () => void };

/** 一套隔离夹具：临时 dataHome（AGENT_IO_HOME）+ 临时项目 + 一份带 4 条判据的册。
 *  ★ 册落点 = `<project>/.agent-io/design`（与 judge 的显式 `project_dir` 锚点同根；
 *    2026-11-25 起 judge 钉 `project_dir` 前插锚、不再回落注册表 / dataHome，册落 dataHome 会读不到）。 */
function makeFixture(): Fixture {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-select-'));
  const feature = 'sel-fixture';
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'a.ts'), "export const MARK = 'TOKEN_A';\n", 'utf-8');
  fs.writeFileSync(path.join(project, 'src', 'b.ts'), "export const OTHER = 1;\n", 'utf-8');
  const dsl = {
    feature,
    title: feature,
    source_root: project,
    geometry: {
      nodes: [
        {
          id: 'n_a',
          label: 'a',
          type: 'service',
          decision: {
            expectations: [
              { kind: 'file-exists', path: 'src/a.ts', why: '选量夹具：a 在' },
              { kind: 'source-has', path: 'src/a.ts', must: ['TOKEN_A'], why: '选量夹具：a 里有标记' },
            ],
          },
        },
        {
          id: 'n_b',
          label: 'b',
          type: 'service',
          decision: { expectations: [{ kind: 'file-exists', path: 'src/b.ts', why: '选量夹具：b 在' }] },
        },
        {
          id: 'n_global',
          label: 'global',
          type: 'service',
          // ★ 主体不是文件 ⇒ 恒选集：无论 changed 是什么都必须被判
          decision: { expectations: [{ kind: 'run', expect: '1 + 1 === 2', why: '选量夹具：无文件主体' }] },
        },
      ],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  };
  const dir = path.join(project, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
  return {
    home,
    project,
    feature,
    dispose: () => {
      rmRf(home);
      rmRf(project);
    },
  };
}

/** 跑真实 CLI（与 judge-all 同一条路：argv 数组，不经 shell） */
function judgeCli(fx: Fixture, payloadExtra: Record<string, unknown>): Record<string, unknown> {
  const r = spawnSync(
    process.execPath,
    [
      CLI,
      'design_line',
      '--json',
      JSON.stringify({ project_dir: fx.project, feature: fx.feature, action: 'judge', ...payloadExtra }),
    ],
    {
      encoding: 'utf8',
      shell: false,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, AGENT_IO_HOME: fx.home },
    },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const i = out.indexOf('---DATA---');
  assert.ok(i >= 0, `CLI 回执里没有 ---DATA--- 块：\n${out.slice(0, 2000)}`);
  const s = out.slice(i + '---DATA---'.length);
  const start = s.search(/[[{]/);
  // 括号配对截顶层 JSON（与 judge-all 的 parseDataBlock 同口径）
  let depth = 0;
  let inStr = false;
  let esc = false;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  for (let k = start; k < s.length; k++) {
    const ch = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, k + 1)) as Record<string, unknown>;
    }
  }
  throw new Error(`CLI 回执的 DATA 块截不出来：${s.slice(0, 500)}`);
}

test('选量⑧ · 端到端：CLI judge 带 changed ⇒ 回执带 selection，且 items 只含选中条目', () => {
  assert.ok(fs.existsSync(CLI), `找不到 ${path.relative(ROOT, CLI)} ⇒ 先 npm run build（本证与 judge-all 同一前提）`);
  const fx = makeFixture();
  try {
    const rec = judgeCli(fx, { changed: ['src/a.ts'] });
    const sel = rec.selection as Record<string, number | string>;
    assert.ok(sel, '选量模式下回执**必须**带 selection 块（否则读端算不出分母）');
    assert.equal(sel.total, 4, '分母 = 该册全部判据');
    assert.equal(sel.selected, 3, '选中 = 两条 src/a.ts + 恒选的 run');
    assert.equal(sel.hit, 2);
    assert.equal(sel.always, 1, 'run 无文件主体 ⇒ 恒选');
    assert.equal(sel.unselected, 1, 'src/b.ts 那条本次没判');
    const items = rec.items as Array<{ node_id: string }>;
    assert.equal(items.length, 3, '回执的 items 只能是被判过的那几条');
    assert.equal(items.some((it) => it.node_id === 'n_b'), false, '未判条目**不许**出现在 items 里（那会变成"没判却像判过"）');
    assert.equal(items.some((it) => it.node_id === 'n_global'), true, '恒选集必须在里面');
    // 未判 ≠ 失败：选中三条都该 pass（夹具里它们确实成立）
    const tally = rec.tally as Record<string, number>;
    assert.equal(tally.fail ?? 0, 0);
    assert.equal(tally.unsupported ?? 0, 0);
  } finally {
    fx.dispose();
  }
});

test('选量⑨ · 端到端：不传 changed ⇒ 回执里没有 selection 字段（旧读端的字节形状不变）；空数组 ⇒ 带"回落全量"的读数', () => {
  assert.ok(fs.existsSync(CLI), '先 npm run build');
  const fx = makeFixture();
  try {
    const rec = judgeCli(fx, {});
    assert.equal(rec.selection, undefined, '全量模式不许凭空多出 selection 字段（向后兼容）');
    const items = rec.items as Array<{ node_id: string }>;
    assert.equal(items.length, 4, '全量必须判全部 4 条');
    // ★ 空数组是"**要了选量**但清单是空的" ⇒ 同样全量，但必须**看得见**这个回落（与"没人要选量"可区分）
    const rec2 = judgeCli(fx, { changed: [] });
    const sel2 = rec2.selection as Record<string, unknown>;
    assert.ok(sel2, '空 changed 也必须给出读数（否则"选量静默退化成全量"没人看得见）');
    assert.equal(sel2.mode, 'full');
    assert.equal(sel2.why_full, 'no-changed');
    assert.equal(sel2.selected, 4);
    assert.equal(sel2.total, 4);
    assert.equal((rec2.items as unknown[]).length, 4);
  } finally {
    fx.dispose();
  }
});

test('选量⑩ · 端到端：collectExpectations 的条数 = 回执 total（分母与收集端同源）', () => {
  const fx = makeFixture();
  try {
    const dsl = JSON.parse(fs.readFileSync(path.join(fx.project, '.agent-io', 'design', `${fx.feature}.dsl.json`), 'utf-8'));
    const collected = collectExpectations(dsl as never);
    assert.equal(collected.length, 4, '夹具应当有 4 条判据（夹具坏了先修夹具）');
    const sel = selectExpectationsForChanged(collected as never, ['src/b.ts'], {
      sheetPath: `.agent-io/design/${fx.feature}.dsl.json`,
    });
    assert.equal(sel.total, collected.length, 'total 必须与 collectExpectations 的条数同源（不许读端自己数）');
    assert.equal(sel.hit, 1, '只有 src/b.ts 那条命中');
  } finally {
    fx.dispose();
  }
});
