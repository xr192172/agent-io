/**
 * P1 · T-#N4 —— `design_line action=compile`（§9.5.5 第 2 条的**生成侧入口**）的接线判据。
 *
 * ## 它挡的事故（每条都能"该红就红"）
 * ① **有实现 ≠ 有入口**：`compileBehaviorContracts` 八步编译器此前只能被 pilot 与测试调，
 *    **任何工具面都调不到**（判据在册上守着它，模型却够不着）。删掉 `action === 'compile'` 分支 ⇒ ① 红。
 * ② **面漂移**：只往 `z.enum` 塞一个值、不写 `describe` 值表 / 不扩 `apply` 的说明 ⇒ 模型看不见这条路
 *    （能力在 MCP 面之外，与 `rules`「有描述无实现」是同一枚硬币的两面）⇒ ① 的第三段红。
 * ③ **拿 `ok:null` 冒充已验**：工具面必须照实转述编译器结论（pass/fail/unsupported + 步号），
 *    且**不许**把"第 7/8 步移交下游"说成"核销通过" ⇒ 见 `p0_behavior_contract_compile` ⑥b 与本案 ⑤。
 * ④ **分母被剔**：`cases: []` / 主体缺失的契约必须**在回执里**（`skipped[]` 具名、`input === checked + skipped`），
 *    不许"跳过它然后报全绿" ⇒ ③ 红。
 * ⑤ **落册绕过写端**：`apply=true` 必须经既有唯一写端 `updateFeature`（下标不变 ⇒ `judgement_ref` 不漂），
 *    且**缺省零写入** ⇒ ④ / ⑤ 红。
 *
 * ## 为什么这些断言都打在**工具面**上（不是直调编译器）
 * 直调 `compileBehaviorContracts` 的那一半已被 `p0_behavior_contract_compile.test.ts` 的 ①–⑥b 钉住。
 * 本卡缺的正是"经过 `DESIGN_TOOLS` 的 handler 还对不对" —— 那一段（册读取、契约适配、写端、回执）
 * 只在工具面上存在，直调测试覆盖不到。
 *
 * ## 消融（0.25② 有鉴别力）
 * · 删 `src/application/design/index.ts` 里 `action === 'compile'` 那一支 ⇒ ① ② ③ ④ ⑤ 全红
 *   （调用落到默认 `report` 分支，回执里没有 `data.report.input`）；
 * · 把 `apply` 的默认改成"真写"（`a.apply !== false`）⇒ ⑤ 红；
 * · 把落册改成 `expectation.add`（追加而不是原位替换）⇒ ④ 的"下标不变"与"ref 仍可解析"红；
 * · 把契约的 `subject.file` 去掉 ⇒ ② 里"册上 path 与 DB 对不上"那一支无法再被判（本卡不覆盖该支，见 ⑥ 注释）。
 *
 * ★ 全部在临时 `AGENT_IO_HOME` 里跑（册、cache.db、源码都在同一个临时项目根），**不碰真册**。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 临时项目根 = 数据家（册住 `<root>/.agent-io/design`，源码与 cache.db 也在它下面） */
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-n4-compile-'));
process.env.AGENT_IO_HOME = HOME; // ★ 必须在 import storage 之前

const { DESIGN_TOOLS } = await import('../src/application/design/index.js');
const { parseDataBlock } = await import('../src/application/plumbing.js');
const { ensureProjectIndex } = await import('../src/infrastructure/index/index_freshness.js');
const { closeProjectCacheDb } = await import('../src/infrastructure/index/db.js');
const { parseJudgementRef } = await import('../src/application/design/db/rewrite_plan.js');
const { loadDesignSheetsForGate, resolveDecisionExpectation } = await import(
  '../src/application/design/db/gen_design_db.js'
);

const CALC = path.join(HOME, 'calc.ts');
/** 目标实现的**正确**版本 / 把它改坏（加法 → 减法）用的消融针 */
const CALC_OK = 'export function add(a: number, b: number) {\n  return a + b;\n}\n';
const MUTATION_MARK = 'return a + b;';

/** 取 `design_line` 的工具定义（**唯一**入口；工具面就在它身上） */
function designLine() {
  const t = DESIGN_TOOLS.filter((x) => x.name === 'design_line');
  assert.equal(t.length, 1, 'design_line 必须**恰好**一条声明（零新工具：本卡不许另开工具）');
  return t[0];
}

type Cases = Array<{ given: unknown[]; expect: string }>;
type Exp = Record<string, unknown>;

/**
 * 落一份最小设计册：一个 service 节点 + 若干条判据。
 * ★ 直接写盘（不经 `updateFeature`）：本文件要测的是**读侧 + 落册**，构造册不该再借被测写端的手。
 */
function writeSheet(
  feature: string,
  expectations: Exp[],
  opts: { summary?: string; intent?: string } = {},
): void {
  const dsl = {
    feature,
    title: feature,
    source_root: HOME,
    geometry: {
      nodes: [
        {
          id: 'svc_1',
          label: 'calc',
          type: 'service',
          x: 0,
          y: 0,
          ...(opts.intent ? { intent: opts.intent } : {}),
          decision: {
            summary: opts.summary ?? 'add 的行为基线',
            expectations,
          },
        },
      ],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  };
  const dir = path.join(HOME, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

/** 一条 behavior-cases 判据（`path`/`symbol` 指向临时项目里的 `calc.ts#add`） */
function bc(cases: Cases, why = '行为基线：add 的输出不许随重构变化（换实现不改结果）'): Exp {
  return { kind: 'behavior-cases', path: 'calc.ts', symbol: 'add', cases, why };
}

const CASES_OK: Cases = [
  { given: [1, 2], expect: '3' },
  { given: [-1, 1], expect: '0' },
];

/** 经**工具面**调 `design_line action=compile`，返回 `{ text, isError, data }` */
async function callCompile(args: Record<string, unknown> = {}): Promise<{
  text: string;
  isError: boolean;
  data: Record<string, unknown>;
}> {
  const r = await designLine().handler({ action: 'compile', project_dir: HOME, ...args });
  const parsed = parseDataBlock(r.text) as Record<string, unknown> | null;
  assert.ok(parsed, `action=compile 必须走标准信封（---DATA--- 段），实得：${r.text.slice(0, 300)}`);
  return { text: r.text, isError: r.isError === true, data: parsed! };
}

/** 回执里的编译报告（`data.report`） */
function reportOf(data: Record<string, unknown>): {
  input: number;
  checked: number;
  pass: number;
  fail: number;
  unsupported: number;
  skipped: Array<{ contract_id: string; stage_no: number; gap: string }>;
  unverified: unknown[];
  items: Array<{ contract_id: string; verdict: string; stage_no: number | null; detail: string; expectation?: unknown }>;
} {
  const rep = data.report as Record<string, unknown> | undefined;
  assert.ok(rep, '回执里必须有 data.report（编译报告本体，不是一句摘要）');
  return rep as never;
}

before(async () => {
  fs.writeFileSync(CALC, CALC_OK, 'utf-8');
  // ★ 主体反查（第 2 步）与真跑（第 7 步）都要 cache.db ⇒ 先建索引
  await ensureProjectIndex(HOME);
});

after(() => {
  try {
    closeProjectCacheDb(HOME);
  } catch {
    /* 没有库 / 已关 */
  }
  try {
    fs.rmSync(HOME, { recursive: true, force: true });
  } catch {
    /* 临时目录，句柄晚释放就留给 OS */
  }
});

// ── ① 面：可调 + 零新工具 + 三处同步 ─────────────────────────

test('① 新 action 可调；零新工具、零新入参；枚举 / describe 值表 / apply 三处同时收下 compile', async () => {
  const dl = designLine();
  const schema = dl.inputSchema as Record<string, { safeParse?: (v: unknown) => { success: boolean }; description?: string }>;

  // ★ 第 1 处：枚举
  assert.equal(schema.action.safeParse?.('compile').success, true, "action 的 z.enum 必须收下 'compile'");
  assert.equal(schema.action.safeParse?.('rules').success, false, 'rules 已退役（2026-11-02 删）—— 不许悄悄回来');
  // ★ 第 2 处：describe 的值表（模型能不能"看见"这条路，靠它）
  assert.match(String(schema.action.description ?? ''), /compile=/, "action 的 describe 值表必须列出 compile=（只加枚举不改描述 = 能力在面之外）");
  // ★ 第 3 处：apply 的说明
  assert.match(String(schema.apply.description ?? ''), /compile/, 'apply 的 describe 必须点名 compile（否则 apply 只对 rewrite 有效这句假话会一直被读）');
  assert.match(String(schema.feature.description ?? ''), /compile/, 'feature 的 describe 必须点名 compile 也必填');
  assert.match(String(schema.node_id.description ?? ''), /compile/, 'node_id 的 describe 必须点名 compile 也认它（否则"能传但没声明"）');

  // ★ 零新工具：本卡**不**新增顶层工具（FACE-STABILITY），也不新增"袋子"入参
  assert.ok(!DESIGN_TOOLS.some((t) => /compile|contract/i.test(t.name)), '不许为编译器另开工具（只许挂 design_line 的第 12 个 action）');
  assert.ok(!('contracts' in schema), '不许新增 contracts 袋子入参：契约从册上适配（§9.5.2 第 3 段）');

  // ★ 真能调：回执必须带编译报告 + 逐条稳定引用
  writeSheet('n4-face', [bc(CASES_OK)]);
  const { data } = await callCompile({ feature: 'n4-face' });
  assert.equal(data.action, 'compile');
  assert.equal(data.contracts, 1, '分母 = 该 feature 的 behavior-cases 判据条数');
  const rep = reportOf(data);
  assert.equal(rep.input, 1);
  assert.deepEqual(
    (data.judgement_refs as Array<{ judgement_ref: string }>).map((x) => x.judgement_ref),
    ['decision:svc_1#0'],
    '稳定引用 = `decision:<node>#<index>`（与 entries 的 judgement_ref 同一形态）',
  );
  assert.equal(data.apply && (data.apply as { requested: boolean }).requested, false, 'apply 缺省必须是 false（零写入）');
});

// ── ② 红绿：工具面也是真跑（不是 `ok:null` 冒充） ─────────────

test('② 红绿：正确实现 ⇒ pass；把目标函数改坏 ⇒ 同一契约 fail；改回 ⇒ pass', async () => {
  writeSheet('n4-red-green', [bc(CASES_OK)]);

  const green = reportOf((await callCompile({ feature: 'n4-red-green' })).data);
  assert.equal(green.items[0].verdict, 'pass', `正向应 pass，实得 ${green.items[0].verdict}：${green.items[0].detail}`);
  assert.ok(green.items[0].expectation, '产物必须回带 —— 它才是"现有 behavior-cases 输入"（第 6 步的产物）');

  const original = fs.readFileSync(CALC, 'utf-8');
  assert.ok(original.includes(MUTATION_MARK), `消融针没命中 ⇒ 这次"改坏"根本没改坏（不能算验证）：${MUTATION_MARK}`);
  fs.writeFileSync(CALC, original.split(MUTATION_MARK).join('return a - b;'), 'utf-8');
  try {
    const broken = reportOf((await callCompile({ feature: 'n4-red-green' })).data);
    assert.equal(broken.items[0].verdict, 'fail', `改坏后同一契约必须 fail，实得 ${broken.items[0].verdict}：${broken.items[0].detail}`);
    assert.equal(broken.pass, 0);
  } finally {
    fs.writeFileSync(CALC, original, 'utf-8');
  }

  const restored = reportOf((await callCompile({ feature: 'n4-red-green' })).data);
  assert.equal(restored.items[0].verdict, 'pass', `改回应 pass，实得 ${restored.items[0].verdict}：${restored.items[0].detail}`);
});

// ── ③ 分母不剔：无预期 / 主体缺失都在回执里 ──────────────────

test('③ 分母不剔：cases:[] ⇒ unsupported@1 且不产出 expectation；主体缺失 ⇒ 第 2 步；input === checked + skipped', async () => {
  writeSheet('n4-denominator', [
    bc(CASES_OK),
    bc([]), // 没有独立预期 ⇒ 第 1 步就该挡（§9.5.7 边界）
    { ...bc([{ given: [1, 2], expect: '3' }]), symbol: 'noSuchFunctionAtAll_xyz' }, // 主体不存在 ⇒ 第 2 步
  ]);
  const { data } = await callCompile({ feature: 'n4-denominator' });
  const rep = reportOf(data);

  assert.equal(rep.input, 3, '分母恒等于**该范围里全部** behavior-cases 判据（一条都不剔）');
  assert.equal(rep.checked + rep.skipped.length, rep.input, 'input === checked + skipped（跳过的都在 skipped 里，不是被剔掉）');
  assert.equal(rep.items.length, 3, '三条都必须**在回执里**');

  const noExpect = rep.items.find((x) => x.contract_id === 'svc_1#1');
  assert.ok(noExpect, '缺预期的契约必须具名在 items 里');
  assert.equal(noExpect.verdict, 'unsupported');
  assert.equal(noExpect.stage_no, 1, `无独立预期必须点名第 1 步，实得 ${noExpect.stage_no}`);
  assert.equal(noExpect.expectation, undefined, '没有独立预期时不许拿运行观察值凑一个期望');

  const ghost = rep.items.find((x) => x.contract_id === 'svc_1#2');
  assert.ok(ghost);
  assert.equal(ghost.stage_no, 2, `主体缺失要点名第 2 步，实得 ${ghost.stage_no}`);
  assert.match(String(ghost.detail), /第 2 步/);
  assert.ok(rep.skipped.some((s) => s.contract_id === 'svc_1#2'), '跳过要**具名**（不许静默）');
  // ★ 回执的人读面也必须说清分母（不是只有 data 里有）
  assert.match(String((await callCompile({ feature: 'n4-denominator' })).text), /分母/);
});

// ── ④ 落册：经既有写端、下标不变、ref 可解析 ─────────────────

test('④ apply=true ⇒ 经 updateFeature 落册；judgement_ref 不变且可解析；why 只记一次契约身份', async () => {
  writeSheet('n4-apply', [bc(CASES_OK)], { summary: 'add 的行为基线' });

  const first = await callCompile({ feature: 'n4-apply', apply: true });
  const apply = first.data.apply as {
    requested: boolean;
    ok: boolean;
    written: Array<{ node_id: string; index: number; judgement_ref: string; verified: boolean; why_from: string }>;
    error: string | null;
  };
  assert.equal(apply.requested, true);
  assert.equal(apply.ok, true, `落册应成功，实得 error=${apply.error}`);
  assert.equal(apply.written.length, 1);
  assert.equal(apply.written[0].judgement_ref, 'decision:svc_1#0', '回执必须给 judgement_ref');
  assert.equal(apply.written[0].index, 0, '**原位**落册：下标不变（变了 = 已冻结画布的引用会指错条）');
  assert.equal(apply.written[0].verified, true, '落地即验：回读到的那个下标必须是刚写的那一条');

  // 盘上：判据仍是一条、下标 0、cases 未缩水，且 why 里记下了契约身份（只记一次）
  const sheet = JSON.parse(
    fs.readFileSync(path.join(HOME, '.agent-io', 'design', 'n4-apply.dsl.json'), 'utf-8'),
  ) as { geometry: { nodes: Array<{ decision: { summary: string; expectations: Array<Record<string, unknown>> } }> } };
  const node = sheet.geometry.nodes[0];
  assert.equal(node.decision.summary, 'add 的行为基线', 'decision.update 是合并语义 ⇒ 原有 summary 不许被清');
  assert.equal(node.decision.expectations.length, 1, '原位替换，不是追加（追加会让下标漂）');
  const written = node.decision.expectations[0];
  assert.equal(written.kind, 'behavior-cases');
  assert.equal((written.cases as Cases).length, 2);
  const why1 = String(written.why);
  assert.match(why1, /行为基线/, '人的话必须留着（why 以册上原文为底）');
  assert.match(why1, /（契约 svc_1#0 /, '契约身份必须随判据落册（可追溯：这条判据是哪份契约编出来的）');

  // 第二次 apply：why **不许**再叠一截（否则每跑一次长一条）
  const second = await callCompile({ feature: 'n4-apply', apply: true });
  assert.equal((second.data.apply as { ok: boolean }).ok, true);
  const again = JSON.parse(
    fs.readFileSync(path.join(HOME, '.agent-io', 'design', 'n4-apply.dsl.json'), 'utf-8'),
  ) as { geometry: { nodes: Array<{ decision: { expectations: Array<Record<string, unknown>> } }> } };
  assert.equal(String(again.geometry.nodes[0].decision.expectations[0].why), why1, 'why 不许随 apply 次数增长（幂等）');
  assert.equal((second.data.apply as { written: Array<{ why_from: string }> }).written[0].why_from, 'sheet');

  // 稳定引用真的指得到刚写的那一条（与 complete 闸 / 画布同一条解析路径）
  const parsed = parseJudgementRef('decision:svc_1#0');
  assert.ok(parsed);
  assert.equal((parsed as { kind: string }).kind, 'decision');
  const sheets = loadDesignSheetsForGate(HOME, { feature: 'n4-apply' }).sheets;
  const found = resolveDecisionExpectation('svc_1', 0, sheets);
  assert.equal(found.ok, true, `judgement_ref 必须解析得到（${found.ok ? '' : found.why_not}）`);
  assert.deepEqual(
    ((found as { exp: { cases?: Cases } }).exp.cases ?? []).length,
    2,
    '解析到的必须是刚写的那一条（cases 条数 = 编译产物）',
  );
});

// ── ⑤ 缺省零写入 ────────────────────────────────────────────

test('⑤ 不带 apply ⇒ 册上一个字节都不动（与 plan / sync-signatures 同一语义）', async () => {
  writeSheet('n4-no-write', [bc(CASES_OK)]);
  const file = path.join(HOME, '.agent-io', 'design', 'n4-no-write.dsl.json');
  const before = fs.readFileSync(file, 'utf-8');

  const { data } = await callCompile({ feature: 'n4-no-write' });
  assert.equal((data.apply as { requested: boolean }).requested, false);
  assert.deepEqual((data.apply as { written: unknown[] }).written, []);

  assert.equal(fs.readFileSync(file, 'utf-8'), before, '缺省零写入：连 why 的身份后缀都不许落盘');
});

// ── ⑥ 诚实边界：工具面不替编译器升级结论 ─────────────────────

test('⑥ 第 7/8 步不冒充：回执不说"已核销"，且 unsupported 不因"落册成功"变成通过', async () => {
  writeSheet('n4-honest', [bc([]), bc(CASES_OK)]);
  const { text, data } = await callCompile({ feature: 'n4-honest', apply: true });
  const rep = reportOf(data);

  assert.equal(rep.unsupported, 1, 'cases:[] 的那条仍是 unsupported（落册只写成形的产物，不改变判定）');
  assert.equal(rep.pass, 1);
  assert.match(text, /ok:null/, '回执必须明说第 7/8 步在本层恒为 null（不冒充"已验/已核销"）');
  assert.match(text, /既有 `complete` 闸/, '核销的唯一入口必须被点名（编译面只移交，不代替）');
  assert.match(text, /不冒充/, '回执要自己说清"不冒充核销"');

  // ★ 诚实边界（本卡**不覆盖**，写在这里免得被当成覆盖了）：
  //   ① 册上 `path` 与 DB 反查不一致 ⇒ 第 2 步报 unsupported（本文件没有那条夹具）；
  //   ② 写端因 E-CRIT-006/007 拒写 ⇒ 回执 `data.apply.ok=false` + `isError:true`（同上）。
  //   两者的判定都住在既有实现里，本文件不复制它们的判据。
});
