/**
 * actor_spec —— **什么算一个合法身份**（唯一定义处）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么要有它（这是判据，不是风格）
 * ─────────────────────────────────────────────────────────────
 * 读集（`application/read_set.ts`）**按 actor 分桶**：
 *   分桶键不干净 ⇒ 同一个 agent 被拆成多个桶 / 不同 agent 挤进同一个桶
 *   ⇒「我读的」被当成「别人读的」⇒ 误报与漏报**同时**发生。
 * 实测（2026-10-21，都出现在真实调用里）：`workbuddy` / `agent-a7` / `agent-v16` /
 *   `agent-docstring` / `agent-facts-db` / `agent-readset` / `agent-body-v15` / `deepseek-v4.1-flash`，
 *   而且**同一轮里同一个人**既写 `workbuddy` 又写 `deepseek-v4.1-flash`（模型名被当成了身份）。
 * ⇒ 缺的不是校验代码，是「什么算身份」的**定义**。本文件就是那份定义 —— 别处只许 import，
 *   不许再写第二套正则（本仓最贵的病就是「第二份判据」）。
 *
 * ## 三分（为什么三类，不是两类也不是四类）
 *   `human:<name>`     人         例 `human:admin`       —— 它的假设过期了要**提醒人**；
 *   `agent:<name>`     常驻 agent  例 `agent:workbuddy`  —— 会自己重读，但人要知道它在动；
 *   `subagent:<name>`  子代理      例 `subagent:a7`      —— 自己会重读，不必惊动谁。
 *   ★ 读集要能**按类查**（"谁该被提醒"）⇒ 类别必须是**前缀里的第一等公民**，不是事后贴的标签。
 *   ★ **不设第四类**（`ci:` / `system:` 之类）：没有实际用途的分类就是噪音 —— 真要用再加，
 *     加时只改 `ACTOR_KINDS`（校验与归一化都从它派生，别处不用动）。
 *
 * ## 文法（机器可判，只有这一份）
 *   `<kind>:<name>`
 *   kind ∈ {human, agent, subagent}
 *   name = `[a-z0-9_-]{1,40}` ∧ **至少含一个字母或数字**（排除 `---` / `___` 这类纯分隔噪音）
 *   ⇒ 正则就是下面的 `ACTOR_RE`；调用点**不许**再写一条自己的。
 *
 * ## 归一化（**只补前缀，不猜别的**）
 *   无前缀但 name 合法（`workbuddy`）⇒ 补 `agent:`（即 **「常驻 agent 默认」**）。
 *   ★ 为什么默认 agent 而不是 human：本仓的调用方绝大多数是 agent（人一般不直接改代码），
 *     而且**猜错的代价不对称** —— 猜成 agent 最坏是"过期了没提醒到人"；
 *     猜成 human 会让每次过期都去惊动人（噪音会把提醒本身废掉）。
 *   ★ 这是**判断**、不是事实 ⇒ 所以它必须**可预测**（同一输入永远同一输出）且**必须留痕**
 *     （`invokeTool` 在回执里明说"已归一化"，不许悄悄改身份 —— 本仓明令禁静默兜底）。
 *   ★ 归一化**只在一个地方发生**：`presentation/mcp/server_registry#invokeTool`（唯一入口，回执挂得上）。
 *     `task.owner` 等**新写入**的值，由写入方（如 `task_ops#claimTask`）用**同一个** `admitActor` 过一遍。
 *   ★ **历史值不改**：已经落盘的 `task.owner`（如 `workbuddy`）原样保留 —— 历史就是历史。
 *     比对时用 {@link sameActor}（同一规范下的**等价**判断，不写回、不搬家）。
 *
 * ## 两条纪律（本仓已付过学费）
 *   ① **不一刀切拒绝**：老格式要能继续跑（归一化 + 留痕），只有**完全非法**的才拒；
 *      `AGENT_IO_ACTOR_STRICT=1` 时才连老格式一起拒（报文给正确写法）。
 *   ② **不造默认身份**：拿不到 actor ⇒ 保持 `null`（= "没自报"）。
 *      造一个默认身份等于"所有人都是同一个人"，对读集**比没有更坏**（会把两个人合并）。
 */

/** 身份类别。★ 加类别只改这里（校验 / 归一化 / 提示都从它派生）。 */
export type ActorKind = 'human' | 'agent' | 'subagent';
export const ACTOR_KINDS = ['human', 'agent', 'subagent'] as const;

/** name 的长度上限（含边界：1..40）。 */
export const ACTOR_NAME_MAX = 40;

/** name 的文法：小写字母/数字/`-`/`_`，1..40，且至少含一个字母或数字。 */
export const ACTOR_NAME_RE = /^(?=.*[a-z0-9])[a-z0-9_-]{1,40}$/;

/** 完整身份文法：`<kind>:<name>`。★ 全仓唯一一条身份正则。 */
export const ACTOR_RE = /^(human|agent|subagent):(?=.*[a-z0-9])[a-z0-9_-]{1,40}$/;

/** 归一化时补的前缀（见文件头「常驻 agent 默认」那条判断）。 */
export const LEGACY_ACTOR_KIND: ActorKind = 'agent';

/** 身份从哪来（回执要用它说清"是谁自报的"）。 */
export type ActorSource = 'explicit' | 'env' | 'none';

/** `admitActor` 的结论。`ok:false` 时**只有** `error` 有意义。 */
export interface ActorAdmission {
  ok: boolean;
  /** 规范化后的身份；`null` = 没自报（**不是**错误，见纪律②）。 */
  actor: string | null;
  source: ActorSource;
  /** 发生过归一化时，原始输入（回执必须点名它）。 */
  normalizedFrom?: string;
  /** `ok:false` 时的**人话**拒绝报文（含正确写法）。 */
  error?: string;
}

/** 严格模式的唯一开关（`task_ops` 也读它 ⇒ 不许各读一次 env）。 */
export function actorStrictMode(): boolean {
  return process.env.AGENT_IO_ACTOR_STRICT === '1';
}

/** 是不是合法身份（完整形式）。 */
export function isCanonicalActor(v: unknown): v is string {
  return typeof v === 'string' && ACTOR_RE.test(v);
}

/** 是不是"老格式"：没有前缀，但 name 本身合法。 */
export function isLegacyActorName(v: unknown): v is string {
  return typeof v === 'string' && !v.includes(':') && ACTOR_NAME_RE.test(v);
}

/** 取类别；不合法 / 老格式 ⇒ `null`（老格式的类别是**归一化**时才定的，别在这儿猜）。 */
export function actorKindOf(v: unknown): ActorKind | null {
  if (typeof v !== 'string') return null;
  const m = ACTOR_RE.exec(v);
  return m ? (m[1] as ActorKind) : null;
}

/**
 * **比对键**（只用于"是不是同一个人"，**不用于写回**）。
 *
 * 三档，全部可预测：
 *   · 合法 ⇒ 原样；
 *   · 老格式 name ⇒ 补 `agent:`（与 `admitActor` 同一条规则）；
 *   · 其它（含非法）⇒ 原样 —— ★ 不猜、不改，宁可让它们**不等**（fail-closed）。
 *
 * ★ 为什么比对要等价：历史 `task.owner` 全是老格式（实测 12 种取值，无一有前缀）。
 *   若比对只认逐字相等，`owner=workbuddy` 的卡在 `actor=agent:workbuddy` 下会被判
 *   "改别人的活" ⇒ **自己的卡把自己的文件锁死**。等价判断解决它，且**不动历史数据**。
 *   ★ 但这不是"读时归一化"：存储里的值一个字都没变，只是判断"是不是你"时按同一规范折算。
 */
export function actorKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (ACTOR_RE.test(s)) return s;
  if (isLegacyActorName(s)) return `${LEGACY_ACTOR_KIND}:${s}`;
  return s;
}

/** 两个身份是不是**同一个**（同一规范下的等价；两边都空 ⇒ `false`）。 */
export function sameActor(a: unknown, b: unknown): boolean {
  const ka = actorKey(a);
  const kb = actorKey(b);
  return ka !== null && kb !== null && ka === kb;
}

/**
 * 把非法输入机械地"擦"成一个**建议**（只用于报文，**绝不自动采用**）。
 * 规则：小写 → 非 `[a-z0-9_-]` 替换成 `-` → 折叠连续 `-` → 去首尾 `-` → 截 40。
 */
export function suggestActorName(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, ACTOR_NAME_MAX);
  return s || null;
}

const KIND_LIST = ACTOR_KINDS.join(' / ');

/** 合法写法的"一行示例"（报文里反复用到，只写一次）。 */
const SAMPLES = `human:admin · agent:workbuddy · subagent:a7`;

function suggestLine(raw: string): string {
  const name = suggestActorName(raw);
  if (!name) return '';
  return `\n   ★ 机械建议（**自己确认**，工具不替你改）：\`${LEGACY_ACTOR_KIND}:${name}\``;
}

function invalidError(raw: string, extra = ''): string {
  const reasons: string[] = [];
  if (/\s/.test(raw)) reasons.push('含空白');
  if (/[^a-zA-Z0-9:_-]/.test(raw)) reasons.push('含非法字符（只许小写字母/数字/-/_）');
  if (/[A-Z]/.test(raw)) reasons.push('含大写字母（name 只许小写）');
  if (raw.includes(':') && !ACTOR_RE.test(raw)) {
    const kind = raw.slice(0, raw.indexOf(':'));
    if (!(ACTOR_KINDS as readonly string[]).includes(kind)) reasons.push(`类别 "${kind}" 不在 {${KIND_LIST}} 里`);
    if (raw.length - kind.length - 1 > ACTOR_NAME_MAX) reasons.push(`name 超过 ${ACTOR_NAME_MAX} 字符`);
  }
  if (!raw.includes(':') && raw.length > ACTOR_NAME_MAX) reasons.push(`名字超过 ${ACTOR_NAME_MAX} 字符`);
  return (
    `✗ 拒绝调用：\`actor\` 不是合法身份 —— 收到 ${JSON.stringify(raw)}。` +
    (reasons.length ? `\n   为什么不合法：${reasons.join('；')}` : '') +
    `\n   规范：\`<kind>:<name>\`，kind ∈ {${KIND_LIST}}；name 只许 **小写字母/数字/-/_**，长度 1..${ACTOR_NAME_MAX}。` +
    `\n   例：${SAMPLES}` +
    suggestLine(raw) +
    `\n   ★ 为什么拦：读集按 \`actor\` 分桶 —— 身份不规范会让「我读的」被当成「别人读的」（误报 + 漏报同时发生）。` +
    extra
  );
}

function legacyStrictError(raw: string): string {
  return (
    `✗ 拒绝调用（\`AGENT_IO_ACTOR_STRICT=1\`）：\`actor\` 缺**类前缀** —— 收到 ${JSON.stringify(raw)}。` +
    `\n   正确写法（三选一，按你是什么）：` +
    `\n     \`${LEGACY_ACTOR_KIND}:${raw}\`（常驻 agent · 最常见）` +
    `\n     \`human:${raw}\`（人）` +
    `\n     \`subagent:${raw}\`（子代理）` +
    `\n   ★ 非 STRICT 下这条会被**自动归一化为 \`${LEGACY_ACTOR_KIND}:${raw}\`** 并在回执里留痕；` +
    `STRICT 下**不猜**，直接拒 —— 这正是严格模式的意义。`
  );
}

/**
 * 解析 + 校验 + 归一化（**唯一实现**）。
 *
 * 优先级与 `write_gate#resolveActor` 逐字相同（只有这一处实现，那边只是薄壳）：
 *   ① 显式入参 ② 环境变量 `AGENT_IO_ACTOR` ③ 都没有 ⇒ `null`。
 * ★ 显式给了但**不合法** ⇒ **不回落**到 env（回落 = 静默兜底，会掩盖调用方的错）。
 *
 * 三种情况分开处置（见文件头纪律①）：合法通过 / 老格式归一化（STRICT 下拒）/ 非法拒。
 */
export function admitActor(
  explicit?: string | null,
  env?: string | null,
  opts: { strict?: boolean } = {},
): ActorAdmission {
  const strict = opts.strict ?? actorStrictMode();
  const e = typeof explicit === 'string' ? explicit.trim() : '';
  const v = typeof env === 'string' ? env.trim() : '';
  const raw = e || v;
  const source: ActorSource = e ? 'explicit' : v ? 'env' : 'none';
  if (!raw) return { ok: true, actor: null, source: 'none' };
  if (ACTOR_RE.test(raw)) return { ok: true, actor: raw, source };
  if (isLegacyActorName(raw)) {
    const canon = `${LEGACY_ACTOR_KIND}:${raw}`;
    if (strict) return { ok: false, actor: null, source, error: legacyStrictError(raw) };
    return { ok: true, actor: canon, source, normalizedFrom: raw };
  }
  return { ok: false, actor: null, source, error: invalidError(raw) };
}

/** 归一化留痕的**回执**那一行（`invokeTool` 用；写在一处，别在调用点各拼一遍）。 */
export function normalizedActorNote(adm: ActorAdmission): string {
  if (!adm.ok || !adm.normalizedFrom || !adm.actor) return '';
  return (
    `\n★ \`actor\` 已归一化：\`${adm.normalizedFrom}\` → \`${adm.actor}\`（缺类前缀 ⇒ 按「常驻 agent 默认」补 \`${LEGACY_ACTOR_KIND}:\`；` +
    `规则唯一定义在 \`domain/actor_spec.ts\`。要它变拒绝：\`AGENT_IO_ACTOR_STRICT=1\`）`
  );
}
