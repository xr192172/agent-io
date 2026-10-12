/**
 * 全局未读影响提醒收件箱（响应注入通道，Step 3+；daemon 化扩展，方向 E）
 *
 * MCP stdio 是请求-响应模型，server 无法主动向 LLM 推消息——"主动播报"只能
 * 借力下一次工具调用。watch 产出的一行影响摘要进入本收件箱后，任何 MCP
 * 工具响应都会自动附带未读提醒（读即清空，一次性投递），LLM 无需记得调
 * watch status。
 *
 * 语义：
 *   - pushAlert：watch doWork 产出摘要时入箱（新→旧，cap 内保留）
 *   - takeAlerts：原子读清——取走全部未读并清空（投递即已读）
 *   - appendPendingAlerts：把未读拼接到工具响应文本尾部（分发中间件用）
 *
 * 方向 E（daemon 化）新增两件事：
 *   - alertLog：append-only 带自增 id 的环形日志（cap 200）。daemon 模式下
 *     多客户端按游标拉取（alertsSince），互不互抢——takeAlerts 的一次性
 *     消费语义只服务进程内降级路径。
 *   - setAlertListener：push 入箱时同步通知（daemon 借此广播 SSE）。
 *
 * 与 entry.alerts 的分工：entry.alerts 是项目内历史（watch status 回看，cap 20）；
 * 本收件箱是跨项目投递队列（一次投递即消费）。全文始终落盘 impact/ 目录，
 * 两者丢的都只是提醒行，不丢数据。
 */

export interface PendingAlert {
  project_dir: string;
  seq: number;
  line: string;
  created_at: string;
}

/** 带自增 id 的日志条目（daemon 游标拉取用） */
export interface LoggedAlert extends PendingAlert {
  id: number;
}

/** 收件箱上限：超出丢最旧（全文已落盘，丢的只是提醒行） */
const ALERT_INBOX_CAP = 10;

/** 游标日志上限：daemon 多客户端按 id 游标拉取，超量丢最旧（全文已落盘） */
const ALERT_LOG_CAP = 200;

const inbox: PendingAlert[] = [];
const alertLog: LoggedAlert[] = [];
let nextAlertId = 1;
let alertListener: ((a: LoggedAlert) => void) | null = null;

/** 注册入箱监听器（daemon 广播 SSE 用）；传 null 注销 */
export function setAlertListener(fn: ((a: LoggedAlert) => void) | null): void {
  alertListener = fn;
}

/** 入箱（新在前）+ 追加游标日志 + 通知监听器 */
export function pushAlert(a: PendingAlert): void {
  inbox.unshift(a);
  if (inbox.length > ALERT_INBOX_CAP) inbox.length = ALERT_INBOX_CAP;
  const logged: LoggedAlert = { ...a, id: nextAlertId++ };
  alertLog.push(logged);
  if (alertLog.length > ALERT_LOG_CAP) alertLog.splice(0, alertLog.length - ALERT_LOG_CAP);
  if (alertListener) {
    try {
      alertListener(logged);
    } catch {
      /* 监听器故障不影响入箱 */
    }
  }
}

/** 原子取走全部未读并清空（投递即已读） */
export function takeAlerts(): PendingAlert[] {
  if (inbox.length === 0) return [];
  const out = inbox.slice();
  inbox.length = 0;
  return out;
}

/** 窥视未读（不动状态；测试/调试用） */
export function peekAlerts(): readonly PendingAlert[] {
  return inbox;
}

/** 按游标拉取日志（daemon 多客户端通道：返回 id > cursor 的条目与最新游标） */
export function alertsSince(cursor: number): { alerts: LoggedAlert[]; cursor: number } {
  const alerts = alertLog.filter((a) => a.id > cursor);
  return { alerts, cursor: alertLog.length > 0 ? alertLog[alertLog.length - 1].id : cursor };
}

/** 清空（测试隔离） */
export function clearAlertInbox(): void {
  inbox.length = 0;
  alertLog.length = 0;
}

/**
 * ★★★ **响应自带 alerts piggyback 的工具**：跳过注入，避免同屏重复。
 * ★ 本常数是**唯一住处** —— `application/dispatch.ts` 从**这里** import（★ 此前**各写一份**，
 *   是"同一判据住两处"的又一实例）。★ 放 infrastructure 而非 application 是有意的：
 *   `infrastructure` 不许 import `application`，反向可以 ⇒ 共享点必须在**下位**。
 *
 * ★★★ **2026-10-12（T188）清空，并记下故事**：
 *   此前唯一成员是 **`watch_project`** —— ★ 而**它已经不是工具了**
 *   （注册表 67 个名字里搜不到，连 `watch*` 前缀都没有；实测读数为证）。
 *   ⇒ ★ **那个 `has()` 判定永远为 false** ⇒ 这条"跳过注入"的分支**结构上不可能触发**
 *     ⇒ 本集合**行为上早就是空的** ⇒ 换成空集合是**零行为变化的纯真话修复**。
 * ★ **规矩（新增前先读）**：真有一个工具在自己的响应里已经带 alerts ⇒ 把它的**注册表里的准确名字**
 *   加进来，并**当面核过它在 `TOOL_DEFS` 里**（★ 否则就是这次的复刻：写了一个不存在的名字，
 *   而它不会有任何东西报错 —— 静默失效）。
 */
export const SELF_CARRYING_TOOLS: ReadonlySet<string> = new Set<string>();

/**
 * 把未读提醒追加到工具响应文本尾部（分发中间件调用，一次投递即消费）。
 * 无未读、或该工具自带 piggyback 时原样返回。
 */
export function appendPendingAlerts(text: string, toolName: string): string {
  if (SELF_CARRYING_TOOLS.has(toolName)) return text;
  const pending = takeAlerts();
  if (pending.length === 0) return text;
  const lines = pending.map((p) => `- ${p.line}（${p.project_dir}，全文 watch action=impact seq=${p.seq}）`);
  return `${text}\n\n[未读影响提醒 · 自动附带] watch 侦测到代码变更影响：\n${lines.join('\n')}`;
}
