
/**
 * P0 · 「判据 kind → 投影去向」的**声明表 + 诚实读数 + 会红的门**（M1a）。
 *
 * ## 它钉的四件事（每件都是"错而没有声音"的那一类）
 * ① **声明表不许沉默**：`EXPECTATION_KIND_PROJECTION` 必须覆盖注册表里每一个 kind，且每条
 *    `keys` / `why_not_projected` **二选一**（不投影必须带 `carrier`，否则豁免不可追溯）。
 * ② **门必须有牙（消融）**：把声明表摘成 `{}`，夹具里 10 种 kind 全部被判红 —— 其中 9 种在**真实册**里
 *    也是"投影 0 条"（`gen-db-check` 那句话「每条判据都在 design-db 里」对 365 条是假话的机器证据）。
 * ③ **声明了就真落地 / 载体真能到**：`keys` 落地 0 ⇒ 红；`carrier` 声明的载体结构上到不了（`reach === 0`）⇒ 红。
 * ④ **分母必须现算并在场**：册侧 / 可投影 / 落地 / 可达 四个数与率都由 `expectationKindCoverage` 一处产出，
 *    且 `SYMBOL_COLUMN_MAP` 的「每列要么投影、要么写明 why」终于有执行者（`symbolColumnMapGaps`）。
 *
 * ## 为什么这些不能在册里写成 `behavior-cases`
 * 它们判的是"**门必须红**"与"声明表条数"，而 `behavior-cases` 的 harness 表达不了"抛 / 红"这一态
 * （`T-#BEHAVIOR-CASES-CANT-EXPRESS-THROW`）。执行核只认对照测试 ⇒ 落在这里由 `npm test` 门跑。
 *
 * ## 夹具完全自治（不读本仓的册 / 不读 cache.db）
 * 临时 `AGENT_IO_HOME`（避免注册表把别的项目的册并进来）+ 临时项目根（`design/*.dsl.json` + `design-db/`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EXPECTATION_KINDS,
  EXPECTATION_KIND_PROJECTION,
  projectionDeclarationGaps,
  type KindProjection,
} from '../src/domain/expectation_kinds.js';
import {
  expectationKindCoverage,
  symbolColumnMapGaps,
  outNameOf,
} from '../src/application/design/db/gen_design_db.js';

/** 夹具里用到的 10 种 kind（= 真实册里出现的那 10 种；`runtime` 册侧 0 条，只在注册表里） */
const FIXTURE_KINDS = [
  'file-exists',
  'symbol-exists',
  'signature-matches',
  'edge-exists',
  'edge-absent',
  'call-exists',
  'run',
  'source-has',
  'behavior-cases',
] as const;

/** 一种 kind 一条判据（形状按 `KIND_SPECS` 给必填字段，`validateExpectation` 也认） */
function expOf(kind: string): Record<string, unknown> {
  const why = `夹具：${kind} 的一条判据`;
  switch (kind) {
    case 'file-exists':
      return { kind, path: 'src/a.ts', why };
    case 'symbol-exists':
      return { kind, path: 'src/a.ts', symbol: 'f', why };
    case 'signature-matches':
      return { kind, path: 'src/a.ts', symbol: 'f', signature: 'f(): void', why };
    case 'edge-exists':
      return { kind, from: 'src/a.ts', to: 'src/b.ts', why };
    case 'edge-absent':
      return { kind, from: 'src/a.ts', to: 'src/c.ts', why };
    case 'call-exists':
      return { kind, path: 'src/a.ts', symbol: 'f', target: 'g', why };
    case 'run':
      return { kind, expect: '1 === 1', why };
    case 'source-has':
      return { kind, path: 'src/a.ts', must: ['export'], why };
    case 'behavior-cases':
      return { kind, path: 'src/a.ts', symbol: 'f', cases: [{ given: [1], expect: '1' }], why };
    case 'domain-independent':
      return { kind, domain: 'd1', must_not_import: ['d2'], why };
    default:
      throw new Error(`夹具不支持 kind=${kind}`);
  }
}

interface Fixture {
  home: string;
  project: string;
  prevHome: string | undefined;
}

/**
 * 建夹具：`n1`（有 path，9 种 kind 各一条）+ `n2`（**无 path**，一条 `domain-independent`）
 * + 一份 `design-db` 副本（`requirements` / `requirements_calls` 各 1 条 = call-exists 真落地）。
 */
function makeFixture(): Fixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-m1a-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-m1a-proj-'));
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;

  const expectations = FIXTURE_KINDS.map(expOf).concat([expOf('domain-independent')]);
  const dsl = {
    feature: 'fxkind',
    title: 'fxkind',
    source_root: project,
    geometry: {
      nodes: [
        { id: 'n1', label: 'n1', type: 'file', x: 0, y: 0, path: 'src/a.ts', decision: { summary: 's', expectations: expectations.slice(0, FIXTURE_KINDS.length) } },
        // ★ 无 path 节点：复刻真实册里那 57 条 domain-independent 的形状（planDesignDb 整节点跳过）
        { id: 'n2', label: 'n2', type: 'service', x: 0, y: 0, decision: { summary: 's', expectations: [expOf('domain-independent')] } },
      ],
      edges: [],
    },
    semantic: { files: [{ id: 'f1', path: 'src/a.ts' }] },
    todos: [],
  };
  const designDir = path.join(project, '.agent-io', 'design');
  fs.mkdirSync(designDir, { recursive: true });
  fs.writeFileSync(path.join(designDir, 'fxkind.dsl.json'), JSON.stringify(dsl, null, 2), 'utf-8');

  const dbDir = path.join(project, 'design-db');
  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(
    path.join(dbDir, outNameOf('src/a.ts')),
    JSON.stringify(
      {
        path: 'src/a.ts',
        symbols: [],
        imports: [],
        calls: [],
        requirements: [{ kind: 'call-exists', symbol: 'f', target: 'g', why: '夹具' }],
        requirements_calls: [{ from: 'src/a.ts#f', to: 'src/b.ts#g', why: '夹具' }],
      },
      null,
      2,
    ),
    'utf-8',
  );
  return { home, project, prevHome };
}

/** 判定闸读数的夹具：每个 kind 都判过 n 条（`by_kind` 的形状与 `judge-readings.json` 一致） */
function judgedEvery(judgedOf: (kind: string) => number): Record<string, { pass: number; fail: number; unsupported: number; pending: number; checked: number; judged: number }> {
  const byKind: Record<string, { pass: number; fail: number; unsupported: number; pending: number; checked: number; judged: number }> = {};
  for (const k of [...FIXTURE_KINDS, 'domain-independent', 'runtime']) {
    const n = judgedOf(k);
    byKind[k] = { pass: n, fail: 0, unsupported: 0, pending: 0, checked: n, judged: n };
  }
  return byKind;
}

function dropFixture(f: Fixture): void {
  if (f.prevHome === undefined) delete process.env.AGENT_IO_HOME;
  else process.env.AGENT_IO_HOME = f.prevHome;
  fs.rmSync(f.home, { recursive: true, force: true });
  fs.rmSync(f.project, { recursive: true, force: true });
}

// ════════════════════════════════════════════════════════════════════
// ① 声明表：注册表 N == 声明表 N，二选一，不投影必须带载体
// ════════════════════════════════════════════════════════════════════
test('① 声明表覆盖全部注册 kind，且每条 keys / why_not_projected 二选一（不投影必须带 carrier）', () => {
  assert.ok(EXPECTATION_KINDS.length > 0, `①a 注册表不许为空（否则"条数相等"0==0 也能绿）：实测 ${EXPECTATION_KINDS.length}`);
  assert.deepEqual(
    projectionDeclarationGaps(),
    [],
    `①b 声明表不规范（缺条目 / 两个都给 / 都不给 / 不投影没写 carrier / 幽灵条目）：${projectionDeclarationGaps().join(' / ')}`,
  );
  assert.equal(
    Object.keys(EXPECTATION_KIND_PROJECTION).length,
    EXPECTATION_KINDS.length,
    `①c 声明表条数（${Object.keys(EXPECTATION_KIND_PROJECTION).length}）必须等于注册表条数（${EXPECTATION_KINDS.length}）`,
  );
  const keysDeclared = EXPECTATION_KINDS.filter((k: string) => (EXPECTATION_KIND_PROJECTION[k].keys ?? []).length > 0);
  const exempt = EXPECTATION_KINDS.filter((k: string) => EXPECTATION_KIND_PROJECTION[k].why_not_projected);
  assert.equal(keysDeclared.length + exempt.length, EXPECTATION_KINDS.length, '①d 每条必须恰好落在 keys / why_not_projected 之一');
  assert.deepEqual(keysDeclared, ['call-exists'], `①e 现状只有 call-exists 有投影键（其余走载体）—— 变了就要同时改读数与门：实测 ${keysDeclared.join(',')}`);
  for (const k of exempt) {
    assert.ok(
      String(EXPECTATION_KIND_PROJECTION[k].carrier ?? '').trim() !== '',
      `①f ${k} 声明了不投影却没写 carrier ⇒ 豁免不可追溯`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// ② 门有牙（消融）：摘掉声明表 ⇒ 夹具里 10 种 kind 全部判红
// ════════════════════════════════════════════════════════════════════
test('② 消融：声明表为空 ⇒ 10 种 kind 全部被判红（其中 9 种在真实册里也是投影 0）', () => {
  const f = makeFixture();
  try {
    const cov = expectationKindCoverage(f.project, { projections: {} as Record<string, KindProjection> });
    const named = new Set<string>();
    for (const g of cov.gaps) for (const k of EXPECTATION_KINDS) if (g.includes(k)) named.add(k);
    assert.equal(
      named.size,
      EXPECTATION_KINDS.length,
      `②a 声明表为空时，注册表里每个 kind 都必须被点名（这是"沉默 ≠ 已投影"的机器证据）：实测点名 ${named.size}/${EXPECTATION_KINDS.length} —— ${[...named].join(',')}`,
    );
    const all: string[] = [...FIXTURE_KINDS, 'domain-independent'];
    for (const k of all) {
      assert.ok(named.has(k), `②b 夹具里出现的 ${k} 必须在红名单里（现状它的投影是 0 条）`);
    }
    // ★ 诊断必须可定位（0.12 之补充）：至少一条红要指出"声明表没表态"
    const decl = cov.gaps.filter((g) => g.includes('没在 EXPECTATION_KIND_PROJECTION 里表态'));
    assert.ok(decl.length > 0, `②c 红名单必须说清"哪一条没表态"，不能只给总数：${cov.gaps.slice(0, 3).join(' / ')}`);
  } finally {
    dropFixture(f);
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ 正面：真实声明表 ⇒ 0 红，四个分母与豁免条数同时在场
// ════════════════════════════════════════════════════════════════════
test('③ 真实声明表 ⇒ 0 红；册侧/可投影/落地/可达四个数与豁免条数都在（0.12：分母必须可见）', () => {
  const f = makeFixture();
  try {
    // ★ 「judge判过」来自判定闸落的读数（真跑 `judge-all` 才写 .agent-io/judge-readings.json；这里注入同形状）
    const cov = expectationKindCoverage(f.project, { judgeReadings: { at: new Date().toISOString(), by_kind: judgedEvery(() => 1) } });
    assert.deepEqual(cov.gaps, [], `③a 真实声明表下不许有红：${cov.gaps.join(' / ')}`);
    assert.equal(cov.sheetTotal, 10, `③b 册侧分母必须现算（9 条在 n1 + 1 条在无 path 的 n2）：实测 ${cov.sheetTotal}`);
    assert.equal(cov.projectableTotal, 9, `③c 可投影分母 = 有 path 节点上的 9 条（domain-independent 那条整节点被跳过）：实测 ${cov.projectableTotal}`);
    assert.equal(cov.landedTotal, 1, `③d 落地 = call-exists 那 1 条：实测 ${cov.landedTotal}`);
    assert.equal(cov.exemptedExpectations, 9, `③e 已声明不投影的**判据条数**必须可追溯（不是 kind 数）：实测 ${cov.exemptedExpectations}`);
    assert.equal(cov.noPathExpectations, 1, `③f 无 path 节点上的判据必须现形：实测 ${cov.noPathExpectations}`);

    const ce = cov.rows.find((x) => x.kind === 'call-exists')!;
    assert.equal(ce.declared, 'keys', '③g call-exists 必须是"声明了投影键"的那一档');
    assert.equal(ce.landed, 1, `③h call-exists 落地 1 条（夹具副本里就是 1 条）：实测 ${ce.landed}`);
    assert.match(ce.rate, /1\/1 = 100\.0%/, `③i 落地率必须带问题名 + 分子 + 分母 + 百分比：实测 ${ce.rate}`);

    const di = cov.rows.find((x) => x.kind === 'domain-independent')!;
    assert.equal(di.projectable, 0, '③j 无 path 节点上的 domain-independent 可投影 = 0（这正是投影侧缺口）');
    assert.equal(di.judged, 1, `③k judge 真判过 1 条 ⇒ 「判过」与「DB 落地 0」必须分开印：实测 ${di.judged}`);
    assert.match(di.rate, /分母为 0/, `③l 分母 0 必须印「不算率」，不许印 0.0%：实测 ${di.rate}`);
  } finally {
    dropFixture(f);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ 声明了 keys 却 0 落地 ⇒ 红（M1b 修完会自动转绿的那一档）
// ════════════════════════════════════════════════════════════════════
test('④ 声明了投影键却 0 条落地 ⇒ 红（"声明与投影脱节"）', () => {
  const f = makeFixture();
  try {
    const outPath = path.join(f.project, 'design-db', outNameOf('src/a.ts'));
    fs.writeFileSync(outPath, JSON.stringify({ path: 'src/a.ts', symbols: [], imports: [], calls: [] }, null, 2), 'utf-8');
    const cov = expectationKindCoverage(f.project);
    const hit = cov.gaps.filter((g) => g.includes('call-exists') && g.includes('0 条落地'));
    assert.equal(hit.length, 1, `④ 删掉 requirements 后必须点名 call-exists 0 落地：实测 ${cov.gaps.join(' / ')}`);
  } finally {
    dropFixture(f);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 载体结构上到不了 ⇒ 红（`intent='retired'` 的节点 judge 不收）
// ════════════════════════════════════════════════════════════════════
test('⑤ 载体到不了（judge 一条都没判出结论）⇒ 红，且报文点名是哪一档', () => {
  const f = makeFixture();
  try {
    // ★ 「判过」来自判定闸读数：这里注入 domain-independent judged=0 的形态
    //   （真实现场长这样：节点被标 intent=retired ⇒ collectExpectations 不收 ⇒ 该 kind 恒 0 条判过）
    const readings = {
      at: new Date().toISOString(),
      by_kind: {
        ...judgedEvery(() => 1),
        'domain-independent': { pass: 0, fail: 0, unsupported: 0, pending: 0, checked: 0, judged: 0 },
      },
    };
    const cov = expectationKindCoverage(f.project, { judgeReadings: readings });
    const di = cov.rows.find((x) => x.kind === 'domain-independent')!;
    assert.equal(di.judged, 0, `⑤a judge判过必须掉到 0：实测 ${di.judged}`);
    const hit = cov.gaps.filter((g) => g.includes('domain-independent') && g.includes('一条都没判出结论'));
    assert.equal(hit.length, 1, `⑤b 必须报「judge 一条都没判出结论」：实测 ${cov.gaps.join(' / ')}`);
    assert.match(hit[0], /pending|unsupported|judge-all/, `⑤c 报文必须可定位（点到 pending / unsupported / 复算命令）：${hit[0]}`);
  } finally {
    dropFixture(f);
  }
});

test('⑦ 判定读数缺失 / 陈旧 ⇒ 「judge判过」不可算（null + 明说原因），不许用假红冒充有牙', () => {
  const f = makeFixture();
  try {
    const missing = expectationKindCoverage(f.project, { judgeReadings: null });
    assert.deepEqual(missing.gaps, [], `⑦a 没有读数时不许判红（那是不可算，不是故障）：${missing.gaps.join(' / ')}`);
    assert.match(missing.judgedNote, /judge-readings|judge-all/, `⑦b 必须说清为什么不可算并给复算命令：${missing.judgedNote}`);
    for (const r of missing.rows) {
      assert.equal(r.judged, null, `⑦c 不可算时列值是 null（不是 0 —— 0 的含义是收进来了却没结论）：${r.kind}=${String(r.judged)}`);
    }
    // 陈旧：stale 标记由 readJudgeReadings（at + 1000ms < 册最新 mtime）现算；这里直接给该标记
    const stale = { at: '2000-01-01T00:00:00.000Z', stale: true, by_kind: judgedEvery(() => 1) };
    const st = expectationKindCoverage(f.project, { judgeReadings: stale });
    assert.match(st.judgedNote, /比册旧|judge-all/, `⑦d 陈旧读数必须被判成不可算：${st.judgedNote}`);
  } finally {
    dropFixture(f);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑥ SYMBOL_COLUMN_MAP 的「每列要么投影、要么写明 why」终于有执行者
// ════════════════════════════════════════════════════════════════════
test('⑥ SYMBOL_COLUMN_MAP 自洽（每列 key/why 二选一、投影键不重复、表非空）', () => {
  assert.deepEqual(symbolColumnMapGaps(), [], `⑥ 列交代表不合规（沉默列 / 两个都给 / 键重复）：${symbolColumnMapGaps().join(' / ')}`);
});
