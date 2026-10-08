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

const payload = {
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
