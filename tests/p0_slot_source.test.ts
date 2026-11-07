/**
 * P0 · **槽来源表（slot_source）的三条判据 + 三条反证**
 *
 * ## 它钉什么
 * ① **无漏声明**：`OP_SPECS` 的每一个 required 键，在 `SLOT_SOURCES` 里都有来源；
 * ② **跨源一致**：`OP_SPECS` 加一个 required 键而表里没加 ⇒ **红**（不许有第二份键清单）；
 * ③ **来源分类可反驳**：声明成非 `model` 的槽**必须有取法**（否则那句声明是空话）；
 *    声明成 `model` 的槽**不许有取法**（否则虚报人工成本）；取法的 `needs` 不许拿必填填必填。
 *
 * ## ★ 为什么每条都要有反证（本文件的下半部分）
 * 一条判据"绿"可能只是**它没在看东西**。所以每个方向都配一个**该红的输入**：
 * 在内存里复制一份表 / 一份 specs，**只改一处**，断言它**恰好命中一条**且**点名那个槽**。
 * ★ 多报也算错（`deepEqual` 比全量）—— 否则"任何改动都报一堆"也能让定向反证看起来是对的。
 *
 * ## ★★ 真消融（跑这两步，不是我说的）
 * ```bash
 * # (A) 漏一条声明：删掉 SLOT_SOURCES.task.evidence
 * cmd /c "npm run build" && node scripts/run-tests.mjs --filter p0_slot_source
 *   ⇒ ① 红：「task/complete.evidence undeclared」
 * # (B) OP_SPECS 演进：给 task.claim 的 required 加一个 'ownerAlias'
 * cmd /c "npm run build" && node scripts/run-tests.mjs --filter p0_slot_source
 *   ⇒ ① 红：「task/claim.ownerAlias undeclared」
 * ```
 * 两次都必须 `git checkout -- <改的那个文件>` 还原（★ 判据在 dist 与 src 之间没有缓存：
 * `behavior-cases` 现读 src，而这两步改的是 `OP_SPECS` 的**值**，所以 `npm test` 读 src 就够；
 * 之所以仍要 build：`npm run verify` 的「MCP 工具签名 / 设计册判据」两门吃 dist（P24）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OP_SPECS } from '../src/application/design/dsl_ops/op_data_spec.js';
import {
  PROVIDER_FROM_FITS,
  SLOT_OVERRIDES,
  SLOT_PROVIDER_IMPLS,
  SLOT_PROVIDERS,
  SLOT_SOURCES,
  checkSlotSources,
  manualSlotsOf,
  requiredKeysOf,
  resolveSlot,
  slotReading,
  slotProviderGaps,
  slotSourceOf,
  unrunnableSlots,
} from '../src/application/design/dsl_ops/slot_source.js';

/** 手的 spec（夹具用；形状与 `OP_SPECS` 元素同） */
const specOf = (type, op, keys) => ({ type, ops: [op], required: { [op]: keys } });

/** 深拷贝一张声明表（反证要在内存里改它，不许动真表） */
const copyTable = (t) => JSON.parse(JSON.stringify(t));

test('① 真实表覆盖：`checkSlotSources(OP_SPECS)` 零违规（无漏声明 / 无幽灵 / 取法齐 / 无虚报）', () => {
  const violations = checkSlotSources(OP_SPECS);
  assert.deepEqual(
    violations,
    [],
    `★ 真实表与 OP_SPECS 必须双向对齐（少=漏声明·多=幽灵声明·非 model 无取法=空话·model 有取法=虚报）：实测 ${JSON.stringify(violations)}`,
  );
});

test('② 读数自证：实现数出来的槽数 == 我在本文件里手算的分母（防"扫不到=0 违规"）', () => {
  const handSlots = OP_SPECS.reduce(
    (a, s) => a + Object.values(s.required ?? {}).filter((ks) => ks.length > 0).reduce((b, ks) => b + ks.length, 0),
    0,
  );
  const handGroups = OP_SPECS.reduce(
    (a, s) => a + Object.values(s.required ?? {}).filter((ks) => ks.length > 0).length,
    0,
  );
  const r = slotReading(OP_SPECS);
  assert.ok(handSlots > 0, '★ 分母必须非零（否则"零违规"是"一个键都没读"）');
  assert.equal(r.slots, handSlots, `槽数必须对得上：实现 ${r.slots} / 手算 ${handSlots}`);
  assert.equal(r.groups, handGroups, `组数必须对得上：实现 ${r.groups} / 手算 ${handGroups}`);
  assert.equal(
    r.slots,
    r.bySource['actual-db'] + r.bySource.design + r.bySource.rule + r.bySource.model,
    `四档之和必须等于槽数（否则有槽既不属于哪一档：${JSON.stringify(r.bySource)}）`,
  );
});

test('③ 反证 A（漏声明）：删掉一条声明 ⇒ 恰好一条 undeclared，并点名那个槽', () => {
  const table = copyTable(SLOT_SOURCES);
  delete table.task.evidence;
  const violations = checkSlotSources(OP_SPECS, table);
  assert.deepEqual(
    violations,
    [{ code: 'undeclared', slot: 'task/complete.evidence' }],
    `★ 删一条声明必须**恰好**红这一条：实测 ${JSON.stringify(violations)}`,
  );
});

test('④ 反证 B（跨源一致）：给 OP_SPECS 加一个 required 键而不改表 ⇒ 恰好一条 undeclared', () => {
  const specs = OP_SPECS.map((s) =>
    s.type === 'task' ? { ...s, required: { ...s.required, claim: [...(s.required?.claim ?? []), 'ownerAlias'] } } : s,
  );
  const violations = checkSlotSources(specs);
  assert.deepEqual(
    violations,
    [{ code: 'undeclared', slot: 'task/claim.ownerAlias' }],
    `★ OP_SPECS 演进而表没跟 ⇒ 必须当场红（这就是"不失同步"）：实测 ${JSON.stringify(violations)}`,
  );
});

test('⑤ 反证 C（来源分类可反驳）：把 model 槽声明成可从索引取 ⇒ 未兑现；反向虚报 ⇒ overclaimed', () => {
  // (a) file/add.path 声明成 actual-db 却没有取法 ⇒ 那句"能自动取"是空话
  const tableA = copyTable(SLOT_SOURCES);
  tableA.file.path = { source: 'actual-db', why: '反证夹具：假装它可从索引唯一取到' };
  const a = checkSlotSources(OP_SPECS, tableA);
  assert.deepEqual(a, [{ code: 'uncovered', slot: 'file/add.path' }], `★ 声明了取不到 ⇒ 必须红：实测 ${JSON.stringify(a)}`);

  // (b) task/claim.owner 声明成 model 但表里**本来就有**取法（actor）⇒ 虚报人工成本
  const tableB = copyTable(SLOT_SOURCES);
  tableB.task.owner = { source: 'model', why: '反证夹具：把能从 actor 拿的说成必须人给' };
  const b = checkSlotSources(OP_SPECS, tableB);
  // ★ 一处 base 声明覆盖 4 个 op 的 owner 槽（claim / start / reopen / renew）—— 这正是"二维表 = 同一概念一处权威"的读数：
  //   改一处，四处同时红。要只改一个 op 就得走 overrides（那才是"确实不同"的情形）。
  assert.deepEqual(
    b,
    [
      { code: 'overclaimed', slot: 'task/claim.owner' },
      { code: 'overclaimed', slot: 'task/start.owner' },
      { code: 'overclaimed', slot: 'task/reopen.owner' },
      { code: 'overclaimed', slot: 'task/renew.owner' },
    ],
    `★ 反向虚报也必须红，且一处声明要四处同时红：实测 ${JSON.stringify(b)}`,
  );
});

test('⑥ 取法不许拿必填填必填（provider-cycle）+ 取法面必须与来源同类（bad-provider-from）', () => {
  const specs = [specOf('file', 'add', ['path'])];
  const table = { file: { path: { source: 'actual-db', why: '夹具' } } };

  // ★ T-40：`checkSlotSources` 多了第 5 参 `impls` —— 不传就要有一条实现，否则新码
  //   `provider-missing` 会在本条**多报一条**（实测），反证就变成"红了但红的不是那一条"。
  const impls = { 'file/add.path': () => ({ ok: true, value: 'src/a.ts' }) };

  const cyclic = checkSlotSources(specs, table, {}, { 'file/add.path': { from: 'index', needs: ['path'] } }, impls);
  assert.deepEqual(cyclic, [{ code: 'provider-cycle', slot: 'file/add.path' }], `★ 必填填必填 = 循环：实测 ${JSON.stringify(cyclic)}`);

  const wrongFace = checkSlotSources(specs, table, {}, { 'file/add.path': { from: 'design-book', needs: [] } }, impls);
  assert.deepEqual(
    wrongFace,
    [{ code: 'bad-provider-from', slot: 'file/add.path' }],
    `★ actual-db 的槽挂了个"从册上搬"的取法 ⇒ 面不同类即红：实测 ${JSON.stringify(wrongFace)}`,
  );
});

test('⑦ 带条件的来源能判：`task/complete.evidence` 只在"全绿且 unsupported=0"时是 rule', () => {
  const green = slotSourceOf('task', 'complete', 'evidence', { allGreen: true, unsupported: 0 });
  assert.equal(green, 'rule', '判据批全绿 ⇒ 机器档可用（rule）');
  const notGreen = slotSourceOf('task', 'complete', 'evidence', { allGreen: false, unsupported: 0 });
  assert.equal(notGreen, 'model', '不全绿 ⇒ 只能 attestation（含自由文本 why）⇒ 退回 model');
  const dirty = slotSourceOf('task', 'complete', 'evidence', { allGreen: true, unsupported: 1 });
  assert.equal(dirty, 'model', '★ unsupported>0 = "没判定"，不是"通过" ⇒ 退回 model');
  const noWitness = slotSourceOf('task', 'complete', 'evidence', null);
  assert.equal(noWitness, 'model', '★ 没有见证 ⇒ 不许记白（不知道就不许按 rule 记）');
});

test('⑧ 来源 → 取法面是闭集（每个 SlotSource 都有映射，且 model 一个都不许有）', () => {
  for (const [source, faces] of Object.entries(PROVIDER_FROM_FITS)) {
    assert.ok(Array.isArray(faces), `${source} 必须有取法面清单`);
  }
  assert.deepEqual(PROVIDER_FROM_FITS.model, [], '★ model 槽不许有取法面（有 = 虚报人工）');
  // 每个声明里的 source 都必须在 PROVIDER_FROM_FITS 里有键（防新增一档忘了配面）
  for (const type of Object.keys(SLOT_SOURCES)) {
    for (const key of Object.keys(SLOT_SOURCES[type])) {
      assert.ok(
        Object.hasOwn(PROVIDER_FROM_FITS, SLOT_SOURCES[type][key].source),
        `${type}.${key} 的来源 ${SLOT_SOURCES[type][key].source} 不在 PROVIDER_FROM_FITS 里`,
      );
    }
  }
  for (const slot of Object.keys(SLOT_OVERRIDES)) {
    assert.ok(Object.hasOwn(PROVIDER_FROM_FITS, SLOT_OVERRIDES[slot].source), `override ${slot} 的来源不在 PROVIDER_FROM_FITS 里`);
  }
});

test('⑨ 一次完整取卡链的 F（读数复核）：有见证时 F=0，无见证时 evidence 记 model（保守），file/add 才是真人工', () => {
  const chain = (witness) =>
    ['decision/update', 'task/claim', 'task/complete'].map((g) => {
      const [type, op] = g.split('/');
      return { group: g, slots: requiredKeysOf(OP_SPECS, type, op).length, manual: manualSlotsOf(OP_SPECS, type, op, witness) };
    });

  const green = chain({ allGreen: true, unsupported: 0 });
  assert.equal(
    green.reduce((a, c) => a + c.manual.length, 0),
    0,
    '★ 判据批全绿时这条链的 F 必须是 0（owner←actor / evidence←判据批 / summary←旧卡）—— 这正是 F_B/3 当判据会空转的原因：实测 ' + JSON.stringify(green),
  );

  // ★ 保守口径：没有见证 ⇒ evidence 按 model 记（不知道就不许记白）。这一条钉住"F=0 是**有条件**的"。
  const blind = chain(null);
  assert.deepEqual(blind.at(-1).manual, ['evidence'], '★ 无见证 ⇒ evidence 记 model（保守），别把"可能自动"当成"已经自动"');

  assert.deepEqual(manualSlotsOf(OP_SPECS, 'file', 'add'), ['path', 'responsibility'], '建新文件那一步才是人工成本所在（P22 入册）');
  assert.ok(SLOT_PROVIDERS['task/claim.owner'], 'owner 必须有取法（actor）——否则上面的 0 就是空话');
});

// ═══════════════════════════════════════════════════════════════════════════════
// ★★★ T-40（2026-11-07）：取法**可执行**那一层 —— 上面 ①–⑨ 钉的是"声明对不对"，
//   下面 ⑩–⑮ 钉的是"**声明了到底有没有实现、给了上下文到底取不取得到**"。
//   病史：在 ⑩ 之前，`checkSlotSources` 对一个"纯声明、零实现"的 provider 返回 `[]`
//   —— 那 17 条「非 model ⇒ 必须有取法」全是自我安慰。
// ═══════════════════════════════════════════════════════════════════════════════

/** 空上下文：**一格都没给** —— 任何"拿默认值顶上"的取法都会在这里暴露。 */
const EMPTY_PROBE = {};

/**
 * 今天写路径**不需要额外查询**就能填的那几格（每接一格 ⇒ `RUNNABLE_TODAY` 只许变长）：
 * · `actor`        ← 每次工具调用的顶层 actor（write_gate.ts:1404「claim 与写共用同一个来源」）
 * · `cardState`    ← 改动前现读该节点卡
 * · `judgeReceipt` ← claim / complete 前必跑的判据批
 * · `now` / `tool` ← 调用时刻与工具名
 * ★ 冻结的"取不到"清单（10 条）**住在节点 behavior-cases**，不在这里拄第二份。
 */
const PROBE_TODAY = {
  actor: 'agent:t40',
  cardState: 'claimed',
  now: '2026-11-07T00:00:00.000Z',
  tool: 'edit_dsl',
  judgeReceipt: { allGreen: true, unsupported: 0 },
};

/** 今天真能取到的槽（★ **只许增加**；减一条就是有人把取法接断了）。 */
const RUNNABLE_TODAY = [
  'snapshot/save.label',
  'status/update.status',
  'task/claim.owner',
  'task/complete.evidence',
  'task/reopen.owner',
  'task/renew.owner',
  'task/start.owner',
];

/** 从实现表里摘掉一条（"删实现就红"的进料）。 */
const implsWithout = (slot) => {
  const m = { ...SLOT_PROVIDER_IMPLS };
  delete m[slot];
  return m;
};

test('⑩ 声明了取法但零实现 ⇒ **每一条声明**恰好一条 provider-missing，并逐条点名', () => {
  const slots = Object.keys(SLOT_PROVIDERS).sort();
  assert.ok(slots.length > 0, '★ 分母必须非零（否则"每条都点名"是"一条都没看"）');
  const v = checkSlotSources(OP_SPECS, SLOT_SOURCES, SLOT_OVERRIDES, SLOT_PROVIDERS, {});
  // ★ 比**归一化后的集合**（`code + slot` 排序）：违规的**次序**由 OP_SPECS 的 spec 顺序决定，
  //   而那条顺序是这张表的实现细节 —— 钉死它会让"加一个 op"顺手红一条无关的用例。
  //   钉的是"每条声明恰好一条、码只能是 provider-missing、槽名逐个对得上"。
  const norm = (arr) => arr.map((x) => `${x.code} ${x.slot}`).sort();
  assert.deepEqual(
    norm(v),
    norm(slots.map((slot) => ({ code: 'provider-missing', slot }))),
    `★ 空实现表 ⇒ 每条声明都要点名（多报/少报/换码都算错）：实测 ${JSON.stringify(v)}`,
  );
  // 反向：真实现表 ⇒ 一条都没有（同一把尺的两个方向）
  assert.deepEqual(checkSlotSources(OP_SPECS), [], '★ 真实现表必须 0 违规 —— 否则"全点名"可能只是这张表天生红');
});

test('⑪ 实现表与声明表**键集必须相等**（多一条=幽灵实现，少一条=空话声明）', () => {
  assert.deepEqual(
    Object.keys(SLOT_PROVIDER_IMPLS).sort(),
    Object.keys(SLOT_PROVIDERS).sort(),
    '★ 两侧键集不等 ⇒ 要么有人写了没人声明的实现（永不生效），要么声明了没实现（空话）',
  );
  // ★ 同一个判断的**单入口**形态（judge 侧也钉它）：差集必须为空
  assert.deepEqual(slotProviderGaps(), [], '★ 真表的声明 ↔ 实现差集必须为空');
  for (const slot of Object.keys(SLOT_PROVIDER_IMPLS)) {
    assert.equal(typeof SLOT_PROVIDER_IMPLS[slot], 'function', `${slot} 的实现必须是函数（声明不是实现）`);
  }
});

test('⑫ 空上下文**不得编值**：每条取法要么说清缺哪一格，要么就是错的', () => {
  const slots = Object.keys(SLOT_PROVIDERS).sort();
  assert.deepEqual(
    unrunnableSlots(EMPTY_PROBE),
    slots,
    '★ 空上下文下每一条都必须"取不到"；能出值的就是在编（编出来的值会被读成"已经自动了"）',
  );
  for (const slot of slots) {
    const r = resolveSlot(slot, EMPTY_PROBE);
    assert.equal(r.ok, false, `${slot} 在空上下文下不许成功：${JSON.stringify(r)}`);
    assert.match(String(r.why), /^缺上下文：/, `${slot} 必须点名缺哪一格：${JSON.stringify(r)}`);
  }
  // 没有实现的槽也走同一个口，且点名自己
  assert.deepEqual(resolveSlot('no/such.op', {}), { ok: false, why: '没有取法实现：no/such.op' });
  // ★ 同一件事的**另一侧**：真实现 + 空探针 ⇒ `checkSlotSources` 必须逐条报 provider-unrunnable
  //   （"有实现 ≠ 取得到"）。这一条与 `unrunnableSlots` 结论同源、入口不同 —— 两个入口都要真跑。
  const v = checkSlotSources(OP_SPECS, SLOT_SOURCES, SLOT_OVERRIDES, SLOT_PROVIDERS, null, EMPTY_PROBE);
  assert.equal(v.length, slots.length, `★ 空探针下每条声明都要报 provider-unrunnable：实测 ${JSON.stringify(v)}`);
  assert.deepEqual(
    v.map((x) => x.code),
    slots.map(() => 'provider-unrunnable'),
    `★ 只许 provider-unrunnable（混进别的码 = 探针把别的东西也打翻了）：实测 ${JSON.stringify(v)}`,
  );
});

test('⑬ 棘轮：可运行集与"取不到"集**恰好划分**全表（冻结的 10 条清单住在节点 behavior-cases）', () => {
  const slots = Object.keys(SLOT_PROVIDERS).sort();
  const miss = unrunnableSlots(PROBE_TODAY);
  assert.deepEqual(
    miss,
    slots.filter((s) => !RUNNABLE_TODAY.includes(s)),
    `★ "取不到"必须恰等于全表减去可运行集：实测 ${JSON.stringify(miss)}`,
  );
  assert.equal(miss.length + RUNNABLE_TODAY.length, slots.length, '★ 两个集合必须无重叠且覆盖全表（否则有槽既算可运行又算取不到）');
  for (const s of RUNNABLE_TODAY) assert.ok(slots.includes(s), `RUNNABLE_TODAY 里的 ${s} 不在声明表里 ⇒ 棘轮记了一条不存在的槽`);
});

test('⑭ 删实现就红：摘掉任一条实现 ⇒ **恰好**该槽一条 provider-missing（三条零发明的重点各一遍）', () => {
  for (const slot of ['task/claim.owner', 'status/update.status', 'task/complete.evidence']) {
    const v = checkSlotSources(OP_SPECS, SLOT_SOURCES, SLOT_OVERRIDES, SLOT_PROVIDERS, implsWithout(slot));
    assert.deepEqual(v, [{ code: 'provider-missing', slot }], `★ ${slot} 的实现被摘掉 ⇒ 必须恰好红它一条：实测 ${JSON.stringify(v)}`);
  }
});

test('⑮ 三条零发明的取法：给了那格就出**唯一**的值（不是"能算"，是"算对"）', () => {
  assert.deepEqual(resolveSlot('task/claim.owner', { actor: 'agent:t40' }), { ok: true, value: 'agent:t40' });
  assert.deepEqual(resolveSlot('status/update.status', { cardState: 'claimed' }), { ok: true, value: 'claimed' });
  assert.deepEqual(
    resolveSlot('task/complete.evidence', { judgeReceipt: { allGreen: true, unsupported: 0 } }),
    { ok: true, value: { kind: 'expectations', all_green: true, unsupported: 0 } },
    '★ 形状必须逐字等于 domain/overlay.ts:98 钉死的那一档',
  );
  // 反向：不全绿 / 有 unsupported ⇒ 机器档不成立（**不许**凑一个绿）
  assert.equal(resolveSlot('task/complete.evidence', { judgeReceipt: { allGreen: false, unsupported: 0 } }).ok, false);
  assert.equal(resolveSlot('task/complete.evidence', { judgeReceipt: { allGreen: true, unsupported: 1 } }).ok, false);
  // ★ goal/set.goals：空数组是**合法值**（"清空"是一个意图）⇒ 不许被当成"没给"
  assert.deepEqual(resolveSlot('goal/set.goals', { bookGoals: [] }), { ok: true, value: [] });
});
