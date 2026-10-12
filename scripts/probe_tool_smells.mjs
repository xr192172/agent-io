/**
 * probe_tool_smells —— 扫**全部工具**的"契约坏味道"，把批评变成**可复现的读数**（不靠人眼看）。
 *
 * 判据（都可判定，且**直指本仓自己的规矩**）：
 *   · **袋子**：入参里出现 `z.record(...)` 这类"任意键袋子" ⇒ 真参数藏在描述文字里、zod 校验不到
 *     （本仓 §5 明写：「[B] 收显式参数，非 `Record<string, unknown>` 袋子」）
 *   · **宽签名**：入参个数 ≥ WIDE（默认 8）⇒ 多半是"多个工具被塞进一个"
 *   · **命名词序**：同一个**前缀族**（下划线前一段）里出现两种词序 ⇒ 对"按名字猜用途"的 LLM 有害
 *   · **描述过短**：`description` < THIN（默认 80）字 ⇒ LLM 判断不了它干什么
 *
 * `--json` 吐 `{ wide:[], bags:[], thin:[], mixedOrder:{} }`（供 `snap:*` 观测；按名字排序 ⇒ 确定）。
 */
const REPO = 'D:/project_develop/design-canvas';
const { TOOL_DEFS } = await import('file://' + REPO + '/dist/src/application/tool_registry.js');

const WIDE = Number(process.env.SMELL_WIDE ?? 8);
const THIN = Number(process.env.SMELL_THIN ?? 80);

/** zod 的"袋子"长什么样：`z.record(...)` / `z.any()` / `z.unknown()` —— 判据是**类型名**，不是猜
 *  ★★ 必须**剥掉外层修饰**再判（2026-10-08 自己抓到假阴性）：
 *    `z.record(...).optional()` 的 `_def.type` 是 **`'optional'`** ⇒ 只看外层会**漏掉**它
 *    （实测 `manage_feature.args` 就是这么写的 ⇒ 第一版探针报"袋子 0 个"，是**假的绿**）。
 *    修饰层用 `_def.innerType`（zod 3 的 optional/nullable/default）或 `_def.schema`（effects）承载。 */
const UNWRAP = ['optional', 'nullable', 'default', 'prefault', 'effects', 'readonly', 'catch'];
const isBag = (schema) => {
  let s = schema?._def;
  for (let i = 0; i < 6 && s && UNWRAP.includes(s.type ?? s.typeName); i++) s = (s.innerType ?? s.schema)?._def;
  const t = s?.type ?? s?.typeName;
  return t === 'record' || t === 'any' || t === 'unknown';
};

const wide = [], bags = [], thin = [];
const byPrefix = new Map();
for (const t of TOOL_DEFS) {
  const keys = Object.keys(t.inputSchema ?? {});
  if (keys.length >= WIDE) wide.push({ name: t.name, params: keys.length, keys });
  const bagKeys = keys.filter((k) => isBag(t.inputSchema[k]));
  if (bagKeys.length) bags.push({ name: t.name, bagKeys, params: keys.length });
  if ((t.description ?? '').length < THIN) thin.push({ name: t.name, len: (t.description ?? '').length });
  const p = t.name.split('_')[0];
  (byPrefix.get(p) ?? byPrefix.set(p, []).get(p)).push(t.name);
}

// ★ 命名词序：**不按"前缀族"分组** —— 第一版就是按族（≥2 个才算）分组的，
//   结果**恰恰把 3 个例外排除在外**（`signal_review`/`consistency_check`/`design_intent` 的前缀各只有一个成员）
//   ⇒ 报"混用 0 个族"是**判据设计错**（能区分吗？不能）。
//   改成**整体统计**：数"动词开头"与"非动词开头"各多少，两边都非空就是混用。
const VERBS = new Set(['get', 'edit', 'manage', 'render', 'split', 'scaffold', 'detect', 'import', 'read', 'list', 'create', 'delete', 'add', 'remove', 'run', 'check', 'review', 'set', 'sync', 'probe', 'find', 'apply', 'build', 'scan', 'measure']);
const verbFirst = [], otherFirst = [];
for (const t of TOOL_DEFS) (VERBS.has(t.name.split('_')[0]) ? verbFirst : otherFirst).push(t.name);

/**
 * ★★★ T201（2026-10-12）：**近名诱饵**（`g-decoy-instrument`）——
 *   ★ 目标原文的判据是「两工具共享 ≥1 个长度>2 的词根、且**用途不同** ⇒ 报。实测本仓有 41 对」。
 *
 * ## ★★ 我实测后**改了它的判据**（照原文写法会量错东西）
 * 照原文（**只**看共享词根）跑 ⇒ **本仓 68 个工具里共 48 对**。而看那 48 对的内容：
 *   `memory_observe ↔ observe_log/observe_judge/observe_instrument/observe_proposals`（全共享 `observe`）
 *   `reconcile_effects ↔ reconcile_chain`
 * ⇒ ★★ **共享同一个词根，正是"这是一个【族】"的标志** —— 而**族是有意分组**，是诱饵的**反面**。
 *   ★ 而 n 个族员**两两组合** ⇒ 对数被族内组合撑爆（5 个 `observe_*` 就贡献 10 对）。
 *
 * ## 真诱饵的形状（★ 目标自己举的例子就是它）
 * `edit_dsl` ↔ `edit_code`：**共享词根 `edit`，但一个改设计、一个改代码** ⇒ ★ **名字像、族不同** ⇒ 会挑错。
 * ⇒ ★★ **判据收紧为：共享词根 且【跨 lane】**（lane = `application/<线>/index.ts` 的归属，机器可读）。
 *
 * ## ★ 而"用途不同"这一半**机器判不了** —— 所以本项是【候选生成器】，不是判据
 * 它报的是「**共享词根 + 跨 lane**」的全部对 + 共享的那个词根 ⇒ ★ **"用途到底同不同"由读的人判** ✓
 * （★ 与 §2.2「扫描器/量具是候选生成器，不是判据」同一条）。
 */
const LANES = ['design', 'refactor', 'observe', 'harvest', 'cross', 'meta'];
const laneOf = new Map();
for (const l of LANES) {
  try {
    const mod = await import(`file://${REPO}/dist/src/application/${l}/index.js`);
    const defs = mod[`${l.toUpperCase()}_TOOLS`] ?? [];
    for (const d of defs) laneOf.set(d.name, l);
  } catch {
    /* ★ 取不到就**不猜**：留着 undefined ⇒ 下面会把"无归属"的数如实报出来 */
  }
}
const rootWords = (n) => n.split('_').filter((w) => w.length > 2);
const rootSets = new Map(TOOL_DEFS.map((d) => [d.name, new Set(rootWords(d.name))]));
const sameLanePairs = [];
const crossLanePairs = [];
let noLaneCount = 0;
const names = TOOL_DEFS.map((d) => d.name);
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    const shared = [...rootSets.get(a)].filter((x) => rootSets.get(b).has(x));
    if (!shared.length) continue;
    const la = laneOf.get(a), lb = laneOf.get(b);
    if (!la || !lb) noLaneCount++;
    (la && lb && la !== lb ? crossLanePairs : sameLanePairs).push({ a, b, shared, la, lb });
  }
}
// ★ 弱词根：**出现在 ≥4 个工具名里**的词根 ⇒ 共享它的**信息量低**（★ 不是"不是诱饵"，是"这条候选的证据弱"）。
//   ★ 由数据算出来，**不是手列黑名单**（手列会腐）。
const rootCount = new Map();
for (const set of rootSets.values()) for (const r of set) rootCount.set(r, (rootCount.get(r) ?? 0) + 1);
const WEAK_ROOT_MIN = 4;
const isWeakRoot = (r) => (rootCount.get(r) ?? 0) >= WEAK_ROOT_MIN;

const decoy = {
  /** ★ 候选（共享词根 **且跨 lane**）—— ★ 这才是"名字像、族不同" */
  candidates: crossLanePairs.map((c) => ({ ...c, weakRoots: c.shared.filter(isWeakRoot) })),
  /** ★ 弱词根定义（≥N 个工具共享）—— 供读的人判断"这条证据有多硬" */
  weakRootMin: WEAK_ROOT_MIN,
  /** ★ 族内组合（共享词根但**同 lane**）—— ★ 那是**族**、不是诱饵（报出来是为了让人看见差别） */
  familyPairs: sameLanePairs.length,
  /** ★ 取不到 lane 的对数（★ 如实报，不当 0） */
  withoutLane: noLaneCount,
};

const payload = {
  decoy,
  total: TOOL_DEFS.length,
  thresholds: { wide: WIDE, thin: THIN },
  wide: wide.sort((a, b) => b.params - a.params),
  bags,
  thin,
  order: { verbFirst: verbFirst.sort(), otherFirst: otherFirst.sort() },
};
if (process.argv.includes('--json')) { console.log(JSON.stringify(payload)); process.exit(0); }

console.log(`工具面坏味道扫描（${payload.total} 个工具）\n`);
console.log(`★ 宽签名（入参 ≥ ${WIDE}，多半是"多工具塞一个"）：${wide.length} 个`);
for (const w of payload.wide.slice(0, 8)) console.log(`    ${w.name.padEnd(22)} ${w.params} 参数`);
console.log(`\n★ 袋子（入参里有 record/any/unknown ⇒ 真参数藏在描述里）：${bags.length} 个`);
for (const b of payload.bags) console.log(`    ${b.name.padEnd(22)} 袋子键=[${b.bagKeys.join(',')}]（总 ${b.params} 参）`);
console.log(`\n★ 描述过短（< ${THIN} 字 ⇒ LLM 判不出用途）：${thin.length} 个`);
for (const t of payload.thin.slice(0, 8)) console.log(`    ${t.name.padEnd(22)} ${t.len} 字`);
console.log(`\n★ 命名词序：动词开头 ${payload.order.verbFirst.length} 个 · **非动词开头 ${payload.order.otherFirst.length} 个**（两边都非空 ⇒ **混用**）`);
console.log(`    非动词开头的: ${payload.order.otherFirst.join(' ') || '（无）'}`);

const strong = decoy.candidates.filter((c) => !c.weakRoots.length);
const weakOnes = decoy.candidates.filter((c) => c.weakRoots.length);
console.log(`
★★ 近名诱饵候选（共享词根 **且跨 lane** —— ★ "名字像、族不同"）：${decoy.candidates.length} 对`);
console.log(`  ★★ **强候选**（共享的词根**不**常见 ⇒ 证据硬）：${strong.length} 对`);
for (const c of strong) {
  console.log(`    ${c.a.padEnd(22)}[${c.la}] ↔ ${c.b.padEnd(22)}[${c.lb}]  共享词根: ${c.shared.join(',')}`);
}
if (!strong.length) console.log('    （无）');
console.log(`  ★ 弱候选（共享的只是**常见词根**，≥${decoy.weakRootMin} 个工具都有它 ⇒ 证据弱）：${weakOnes.length} 对`);
for (const c of weakOnes.slice(0, 6)) {
  console.log(`    ${c.a.padEnd(22)}[${c.la}] ↔ ${c.b.padEnd(22)}[${c.lb}]  ★ 弱词根: ${c.weakRoots.join(',')}`);
}
if (weakOnes.length > 6) console.log(`    …（还有 ${weakOnes.length - 6} 对）`);
console.log('    ★ 注：**"跨 lane" ≠ "用途不同"** —— lane 是【组织归属】不是语义域。');
console.log('      ★ 例：`observe_proposals` 归 `meta`，而它的语义域明显是 `observe` ⇒ 它与 `observe_*` 的那些对');
console.log('        是【组织归属与语义域不一致】的信号，**不是**诱饵 ⇒ 这类由"弱词根"标出来。');
console.log(`    ★ 对照：**族内**共享词根 ${decoy.familyPairs} 对（= 族，**不是**诱饵）· 取不到 lane 的 ${decoy.withoutLane} 对（★ 如实计，不当 0）`);
console.log('    ★★ 本项是【候选生成器】："用途是否真不同"机器判不了 ⇒ 由读的人判（§2.2）。');
