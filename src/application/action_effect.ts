/**
 * P1-ACTION-EFFECT-BOUNDARY-01 · **动作效果边界（唯一纯模块）**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 本模块只做两件事，且都不碰文件系统 / 网络 / 进程时钟（**不调用 `Date.now()` / `new Date()`**）：
 *
 *   1. **类型与声明辅助**：`ActionEffect`（safe-read / may-write + 真实资源域 +
 *      conditionalWrite / destructive 证据标记）与 `ActionToolDef`（在 `types.ts#ToolDef`
 *      上挂一个 `effect` 槽）。41 个工具的事实在各自 lane 文件的 ToolDef 字面量里同处登记，
 *      由 `TOOL_DEFS` 汇总派生；本模块**不**维护第二份手写动作表 / URL 表。
 *
 *   2. **唯一 allow/deny 裁决**：`adjudicateActionEffect()` 是所有面（MCP stdio / CLI /
 *      HTTP serve / HTTP daemon / opl）共用的同一份判据。裁决只吃：通道、方法、Host、
 *      Origin、远端地址、动作/工具名、效果事实、**调用方显式注入的时钟**。
 *
 * ★ 时钟纪律：兼容期限比较所需的 `now` 必须由生产入口显式注入 ISO 8601；本模块不读进程
 *   时钟。需要判兼容期限而 `now` 缺失 / 非法时 ⇒ fail-closed（`compat-clock-unavailable`），
 *   绝不静默取 `Date.now()` 兜底。
 *
 * ★ 明确**不**读以下留痕字段做放行（它们进账本，不进裁决）：
 *   `actor` / `via` / `session` / `User-Agent` / `source`（`mcp`|`cli`|`http`）/
 *   `X-Forwarded-*`。转发头不能把非回环提升为回环。
 *
 * ★ 与旧 `writes` / `annotations` 的关系（见 design-ledger-gate §12）：
 *   `writes` 是历史 saveDSL 闸口径、`annotations` 是 wire 提示；二者都不是本卡的裁决输入。
 *   效果事实以本模块登记为准，不回读 annotations / writes 反推。
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { ToolDef } from './types.js';

// ────────────────────────────────────────────────────────────────────────
// 效果类型
// ────────────────────────────────────────────────────────────────────────

/**
 * `safe-read`：只读取本地事实 / 派生状态，不产生副作用。
 * `may-write`：存在写 / 外部副作用分支（含条件写、破坏性动作）。
 */
export type Effect = 'safe-read' | 'may-write';

/** 真实资源域（证据域）；`external` = 进程外副作用（LLM / 测试进程 / 外部工具链）。 */
export type ResourceDomain =
  | 'source'
  | 'design'
  | 'derived-state'
  | 'vcs-history'
  | 'external';

/** 动作效果登记（与对应 ToolDef / action schema 同处写在 lane 文件里）。 */
export interface ActionEffect {
  readonly effect: Effect;
  /** 真实资源域证据；may-write 缺资源域 ⇒ HTTP 不得放行。 */
  readonly resources: readonly ResourceDomain[];
  /** 条件写：仅在满足特定条件 / 入参分支时落盘（默认 false）。 */
  readonly conditionalWrite?: boolean;
  /** 破坏性：删除 / 覆盖 / 回滚 / 重建等高不可逆证据（默认 false）。 */
  readonly destructive?: boolean;
  /** 备注 / 证据指向（文件:行、外部依赖）；仅留痕，不参与裁决。 */
  readonly note?: string;
  /** 动作级子效果（如 opl 的 list/get 只读 vs 其余写）；缺省回落到工具级效果。 */
  readonly actions?: Readonly<Record<string, ActionEffect>>;
}

/** 在 `ToolDef` 上挂效果槽的扩展类型；lane 数组用它，不回写 `types.ts`。 */
export interface ActionToolDef extends ToolDef {
  readonly effect: ActionEffect;
}

/** 声明辅助：lane 字面量里 `effect: declareEffect('may-write', ['design'], { conditionalWrite: true })`。 */
export function declareEffect(
  effect: Effect,
  resources: readonly ResourceDomain[],
  extra?: Partial<Omit<ActionEffect, 'effect' | 'resources'>>,
): ActionEffect {
  return { effect, resources, ...extra };
}

/** 动作级子效果声明辅助（opl 等工具的 action 拆分）。 */
export function declareActionEffects(
  actions: Readonly<Record<string, ActionEffect>>,
): Readonly<Record<string, ActionEffect>> {
  return actions;
}

// ────────────────────────────────────────────────────────────────────────
// 效果表绑定（由 `tool_registry` 在 TOOL_DEFS 派生后注入一次，避免反向成环）
// ────────────────────────────────────────────────────────────────────────

let effectTable: ReadonlyMap<string, ActionEffect> | null = null;

export function bindActionEffects(defs: readonly { readonly name: string; readonly effect?: ActionEffect }[]): void {
  const table = new Map<string, ActionEffect>();
  for (const d of defs) {
    if (d.effect) table.set(d.name, d.effect);
  }
  effectTable = table;
}

/**
 * 按工具名（可选动作键）取效果事实；未登记 ⇒ null（裁决按 unsupported-action 处理）。
 *
 * ★ 动作级解析（§2.6.15）：工具登记了 `actions` 闭集时 ——
 *   · actionKey 在场且命中 ⇒ 子动作效果；
 *   · actionKey 在场但未命中 ⇒ **返回 null（显式 deny）**，不回落工具级 safe-read / may-write；
 *   · actionKey 缺席 ⇒ 回落工具级保守效果（工具级本身可能是 safe-read，那是登记事实）。
 * 工具没有 `actions` 闭集（纯 flag 分支工具）⇒ 一律工具级。
 */
export function actionEffectOf(toolName: string, actionKey?: string): ActionEffect | null {
  const base = effectTable?.get(toolName) ?? null;
  if (!base) return null;
  if (actionKey && base.actions) {
    return base.actions[actionKey] ?? null;
  }
  return base;
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * 从**未过 schema 校验的原始 args** 提取动作键（纯函数；不读 fs / 网络）。
 *
 * 提取顺序与各工具 schema / handler 缺省值对齐（§2.6 actionKey 形式）：
 *   · `op` —— opl / observe proposals 子动作；
 *   · `action` —— explore_code / observe / design_line / ledger / snapshot / rules / upgrade；
 *     `watch` 的内层子动作也叫 `action`，平铺无法与顶层区分 ⇒ 从兼容信封 `args:{action}` 取，
 *     组成 `watch#<inner>`；observe `proposals` 的子动作在 `op`，组成 `proposals#<op>`；
 *   · `analyze` —— rename_symbols 只读分析形态，组成 `analyze=<similar|suggest>`；
 *   · `mode` —— annotate_functions；
 *   · `book=true` —— translate 翻译册重算分支，动作键 `book`。
 *
 * 内层缺省值与真实 handler 对齐（显式 / 缺省等价）：
 *   · proposals 缺省 `op` ⇒ `list`（`observe/index.ts:279` `args.op ?? 'list'`）；
 *   · watch 缺省内层 `action` ⇒ `start`（`watch_project_tool.ts:1020` `input.action ?? 'start'`）。
 * 提取不到 ⇒ undefined（回落工具级效果）。
 */
export function extractActionKey(args: Record<string, unknown> | undefined): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const action = strArg(args, 'action');
  const op = strArg(args, 'op');
  if (action) {
    if (action === 'watch') {
      const nested = args['args'];
      const inner =
        nested && typeof nested === 'object' ? strArg(nested as Record<string, unknown>, 'action') : undefined;
      return `watch#${inner ?? 'start'}`;
    }
    if (action === 'proposals') return `proposals#${op ?? 'list'}`;
    return action;
  }
  if (op) return op;
  const analyze = strArg(args, 'analyze');
  if (analyze) return `analyze=${analyze}`;
  const mode = strArg(args, 'mode');
  if (mode) return mode;
  if (args['book'] === true) return 'book';
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────
// 无 Origin 本地写 · 限期兼容条目（5 要素齐备 + 未过期才可放行）
// ────────────────────────────────────────────────────────────────────────

export type Channel = 'stdio-mcp' | 'cli' | 'http-serve' | 'http-daemon';

export interface CompatibilityEntry {
  /** 动作键：`daemon:dsl` / `daemon:watch` / `tool:<name>` / `opl:<op>`。 */
  readonly actionKey: string;
  readonly channel: Channel;
  /** 关联任务卡。 */
  readonly task: string;
  /** 现役仓内调用证据（文件:行）。 */
  readonly evidence: readonly string[];
  /** 到期时刻（ISO 8601）；裁决时与注入时钟比较，过期即 deny。 */
  readonly expiresAt: string;
  /** 守护测试定位（文件 + 用例名）。 */
  readonly guardTest: string;
  /** 删除条件：任一成立即应撤下本条目并改走真实认证 / audience / 会话绑定。 */
  readonly revokeWhen: readonly string[];
}

/**
 * 兼容条目白名单 —— **只有 daemon dsl / watch** 两条有真实仓内 client 证据。
 * HTTP serve 通用工具面 / /api/opl 在仓内无调用证据，**不设秘密兼容**；
 * daemon shutdown 零调用者，**不默认兼容**。
 */
export const ACTION_EFFECT_COMPAT: readonly CompatibilityEntry[] = [
  {
    actionKey: 'daemon:dsl',
    channel: 'http-daemon',
    task: 'P1-ACTION-EFFECT-BOUNDARY-01',
    evidence: [
      'src/infrastructure/daemon/client.ts:79-109（dispatchDsl：无 Origin 头 POST /api/dsl）',
      'src/application/dispatch.ts:105（dispatch 队列入口）',
    ],
    expiresAt: '2027-02-22T00:00:00+08:00',
    guardTest: 'tests/p1_action_effect_boundary.test.ts#daemon-dsl-watch-compat-unexpired',
    revokeWhen: [
      '取得独立前端仓 dsl-workbench 的浏览器真实调用证据并接入真实认证 / audience / 会话绑定',
      'daemon 客户端改为显式携带回环 Origin 头',
      'daemon 接入真实 principal 认证后',
    ],
  },
  {
    actionKey: 'daemon:watch',
    channel: 'http-daemon',
    task: 'P1-ACTION-EFFECT-BOUNDARY-01',
    evidence: [
      'src/infrastructure/daemon/client.ts:58-76（postWatch：无 Origin 头 POST /api/watch）',
      'src/application/dispatch.ts:71（watch 队列入口）',
    ],
    expiresAt: '2027-02-22T00:00:00+08:00',
    guardTest: 'tests/p1_action_effect_boundary.test.ts#daemon-dsl-watch-compat-unexpired',
    revokeWhen: [
      'watch 接入真实认证 / audience / 会话绑定，或客户端改为显式携带回环 Origin 头',
      'watch 的派生态写子集（resolveViolation）取得独立的调用证据与到期复核',
    ],
  },
];

// ────────────────────────────────────────────────────────────────────────
// 裁决输入 / 输出
// ────────────────────────────────────────────────────────────────────────

export interface TransportFacts {
  readonly channel: Channel;
  /** HTTP 方法（非 HTTP 通道留空）。 */
  readonly method?: string;
  /** Host 头原值。 */
  readonly host?: string;
  /** Origin 头原值（含字符串 "null"）。 */
  readonly origin?: string;
  /** 连接远端地址（`req.socket.remoteAddress`）；未知 / 缺失按非回环处理。 */
  readonly remoteAddress?: string;
  /**
   * 注入时钟（ISO 8601）；纯模块不读 `Date.now()`。HTTP 兼容期限裁决必须由生产入口显式传入；
   * 缺失 / 非法 ⇒ fail-closed（`compat-clock-unavailable`），不兜底进程时钟。
   */
  readonly now?: string;
}

export interface AdjudicationInput {
  /** 工具名（工具面）；与 actionKey 二选一或并存。 */
  readonly toolName?: string;
  /** 非工具控制动作 / opl op 的动作键（daemon dsl/watch/shutdown、opl:<op>）。 */
  readonly actionKey?: string;
  /** 调用方已解析的效果事实；缺省由工具名查绑定表（daemon 非工具动作在此自带）。 */
  readonly effect?: ActionEffect;
  readonly transport: TransportFacts;
}

export type DenyReason =
  | 'unsupported-action'
  | 'missing-effect'
  | 'invalid-host'
  | 'non-loopback-remote'
  | 'malicious-origin'
  | 'null-origin'
  | 'get-write'
  | 'no-origin-write'
  | 'expired-compat'
  | 'compat-clock-unavailable'
  | 'no-resource-evidence';

export interface Adjudication {
  readonly allowed: boolean;
  /** HTTP 状态建议；非 HTTP 通道恒 0。 */
  readonly status: number;
  readonly reason?: DenyReason;
  readonly message: string;
  /** 命中的限期兼容条目（仅放行且走兼容时携带，留痕）。 */
  readonly compat?: CompatibilityEntry;
}

// ────────────────────────────────────────────────────────────────────────
// 回环判定（纯函数；转发头一律不采信）
// ────────────────────────────────────────────────────────────────────────

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);
const LOOPBACK_REMOTES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function hostOf(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  const at = hostHeader.trim();
  if (!at) return undefined;
  // 去掉端口；`[::1]:port` / `127.0.0.1:port` / `localhost:port`
  const bracketed = /^\[(.+)\]:\d+$/.exec(at);
  if (bracketed) return `[${bracketed[1]}]`;
  const colon = at.lastIndexOf(':');
  return colon >= 0 ? at.slice(0, colon) : at;
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
  const h = hostOf(hostHeader);
  return h != null && LOOPBACK_HOSTNAMES.has(h.toLowerCase());
}

function isLoopbackRemote(addr: string | undefined): boolean {
  // 缺失 / 未知 ⇒ 保守按非回环。
  return addr != null && LOOPBACK_REMOTES.has(addr.trim().toLowerCase());
}

/** 解析 Origin；返回 `'safe' | 'malicious' | 'null' | 'absent'`。 */
function classifyOrigin(origin: string | undefined): 'safe' | 'malicious' | 'null' | 'absent' {
  if (origin == null || origin === '') return 'absent';
  if (origin === 'null') return 'null';
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return 'malicious';
  }
  const host = u.hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(host) ? 'safe' : 'malicious';
}

function compatFor(channel: Channel, actionKey: string | undefined): CompatibilityEntry | null {
  if (!actionKey) return null;
  return (
    ACTION_EFFECT_COMPAT.find((c) => c.channel === channel && c.actionKey === actionKey) ?? null
  );
}

/**
 * 兼容期限裁决（纯函数；不读进程时钟）。
 * - `unexpired`：注入时钟合法且未过 deadline；
 * - `expired`：注入时钟合法但已过 deadline（或条目自身 expiresAt 非法，fail-closed）；
 * - `clock-unavailable`：`now` 缺失 / 非法 ⇒ fail-closed，不得静默取 `Date.now()`。
 */
function entryUnexpired(entry: CompatibilityEntry, now: string | undefined): 'unexpired' | 'expired' | 'clock-unavailable' {
  const deadline = Date.parse(entry.expiresAt);
  if (Number.isNaN(deadline)) return 'expired';
  if (now == null || now.trim() === '') return 'clock-unavailable';
  const t = Date.parse(now);
  if (Number.isNaN(t)) return 'clock-unavailable';
  return t <= deadline ? 'unexpired' : 'expired';
}

// ────────────────────────────────────────────────────────────────────────
// 唯一裁决入口
// ────────────────────────────────────────────────────────────────────────

function deny(status: number, reason: DenyReason, message: string): Adjudication {
  return { allowed: false, status, reason, message };
}

/**
 * 所有面共用的纯裁决。返回 `{ allowed, status, reason, message, compat? }`；
 * 调用方在 handler / 执行核**前**强制消费一次：deny ⇒ 不得进入 handler。
 */
export function adjudicateActionEffect(input: AdjudicationInput): Adjudication {
  const { transport } = input;
  const { channel } = transport;

  // 1) 效果事实解析：自带 > 工具名（+动作键）查表；两者都没有 ⇒ 未登记动作。
  const effect =
    input.effect ??
    (input.toolName ? actionEffectOf(input.toolName, input.actionKey) : null);
  if (!effect) {
    return deny(
      channel === 'stdio-mcp' || channel === 'cli' ? 0 : 404,
      'unsupported-action',
      `未登记动作（${input.toolName ?? input.actionKey ?? '?'}）：动作效果边界拒绝进入执行核。`,
    );
  }

  // 2) 本地进程通道（stdio / CLI）：无信封、无远端地址概念；现有写闸继续在后段把关。
  if (channel === 'stdio-mcp' || channel === 'cli') {
    return { allowed: true, status: 0, message: '本地进程通道：效果事实已登记，交既有写闸后置把关。' };
  }

  // 3) HTTP 面：Host 先过回环白名单（serve 与 daemon 同尺）。
  if (!isLoopbackHost(transport.host)) {
    return deny(403, 'invalid-host', 'Host 不在回环白名单内（localhost / 127.0.0.1 / [::1] / 0.0.0.0）。');
  }

  // 4) 远端地址：非回环写在真实认证 / audience / 会话绑定存在前 deny；不采信转发头。
  if (effect.effect === 'may-write' && !isLoopbackRemote(transport.remoteAddress)) {
    return deny(403, 'non-loopback-remote', '非回环远端写：当前无真实认证 / audience / 会话绑定，拒绝。');
  }

  const origin = classifyOrigin(transport.origin);

  // 5) Origin 在场：`null` / 非回环来源一律拒。
  if (origin === 'null') {
    return deny(403, 'null-origin', 'Origin: null（文件源 / 沙箱 / 隐私模式）不得调用本地写动作。');
  }
  if (origin === 'malicious') {
    return deny(403, 'malicious-origin', `Origin 非回环：${String(transport.origin)} 被拒绝。`);
  }

  if (effect.effect === 'safe-read') {
    return { allowed: true, status: 0, message: '回环 safe-read：放行。' };
  }

  // 6) may-write：GET 不得写。
  const method = (transport.method ?? '').toUpperCase();
  if (method === 'GET') {
    return deny(405, 'get-write', '写动作不得走 GET（状态 / 语义不可被缓存 / 预取）。');
  }

  // 7) may-write 必须带真实资源域证据。
  if (!effect.resources || effect.resources.length === 0) {
    return deny(400, 'no-resource-evidence', 'may-write 缺真实资源域证据，HTTP 面不得放行。');
  }

  // 8) Origin 在场且为回环 ⇒ 放行。
  if (origin === 'safe') {
    return { allowed: true, status: 0, message: '回环 Origin 写：放行。' };
  }

  // 9) 无 Origin：只有限期兼容条目（5 要素齐备且未过期）可放行。
  const entry = compatFor(channel, input.actionKey ?? (input.toolName ? `tool:${input.toolName}` : undefined));
  if (!entry) {
    return deny(403, 'no-origin-write', '无 Origin 写：该动作/通道无有效兼容条目，拒绝。');
  }
  const clockVerdict = entryUnexpired(entry, transport.now);
  if (clockVerdict === 'clock-unavailable') {
    return deny(
      403,
      'compat-clock-unavailable',
      `兼容期限裁决缺少合法注入时钟（now 缺失/非法），fail-closed 拒绝（${entry.actionKey}）。`,
    );
  }
  if (clockVerdict === 'expired') {
    return deny(403, 'expired-compat', `兼容条目已过期（${entry.actionKey}，expiresAt=${entry.expiresAt}），拒绝。`);
  }
  return {
    allowed: true,
    status: 0,
    message: `无 Origin 写：命中限期兼容条目 ${entry.actionKey}（${entry.task}，至 ${entry.expiresAt}）。`,
    compat: entry,
  };
}
