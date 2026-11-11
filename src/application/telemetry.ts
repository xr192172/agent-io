/**
 * telemetry —— **开发遥测**（第⑬项队列任务，用户拍板）。
 *
 * ## 它是什么
 * 引擎全环节（领卡 → 选材 → 执行 → 判定 → 级联）的过程事件流——**遥测对象是所有项目的开发过程**，
 * 引擎自身环节（领卡/找文件/判契约）是被遥测的内容。模型不感知：不加工具、不加参数、失败静默。
 *
 * ## 形态（lead 确认）
 * · **复用 observe 事件基建**：`TSProbeCapture.emit()` 落 `TSEvent`（probe 前缀 `telemetry.` 区分），
 *   同文件混存（`<root>/.agent-io/observe/events.jsonl`）——将来 rebuildChains 可把遥测与探针
 *   放同一条时间线（引擎决策与代码执行是同一条故事线）。
 * · **人读文案直接进事件**：`text` 字段是解说词（"正在验证受影响的 12 条契约…"）——
 *   算法的解释文本在发射点写好，回放/GUI 层只渲染不猜。`data` 带结构化数据（GUI 动画用）。
 * · **单点 API**：`telemetry.emit(stage, {text, data}, root)` —— 引擎各环节一行调用。
 *
 * ## 失败语义
 * 遥测**绝不阻断主操作**：全链 try/catch 吞（events 目录不可写 / 磁盘满 / 序列化失败 ⇒ 丢帧不抛）。
 */
import path from 'node:path';

/**
 * TSProbeCapture 用**延迟动态 import**（而非顶层静态 import）：
 * telemetry 被夹具打包（behavior-cases 的 esbuild bundle）时，静态 import 会把
 * captureProbe 内联进 bundle 与夹具自身声明冲突（实测：Identifier 'captureProbe'
 * has already been declared）。动态 import 在运行时才解析 —— 夹具场景下
 * emit 走 try/catch 吞（遥测绝不阻断主操作）。
 */
let _capture: { emit(probe: string, fields: Record<string, unknown>, source?: string): void } | null = null;
async function getCapture(eventsPath: string) {
  if (!_capture) {
    const m = await import('../infrastructure/analysis/observe/probe.js');
    _capture = new m.TSProbeCapture(eventsPath);
  }
  return _capture;
}

/** 遥测 stage 常量表（★ 唯一取值处；防 stage 名漂移——回放器按它过滤/分组） */
export const TELEMETRY_STAGES = {
  /** 领卡：从任务系统领了哪张卡 */
  claim: 'claim',
  /** 写闸放行：basis=direct/instrument/authorized/exempt… 各支的放行读数 */
  gate: 'gate',
  /** 选材：verify-changed 选了哪些测试/契约、为什么（百分比/命中理由进 data 给 GUI） */
  select: 'select',
  /** 执行：写源码落盘（文件清单） */
  write: 'write',
  /** 判定：契约反馈/judge 的绿/红/继承读数 */
  judge: 'judge',
  /** 级联：文档刷新了什么（cognition/design-db/facts） */
  cascade: 'cascade',
} as const;

export type TelemetryStage = (typeof TELEMETRY_STAGES)[keyof typeof TELEMETRY_STAGES];

export interface TelemetryPayload {
  /** 解说词（将来动画的文案载体——写成"正在…"的叙事形态） */
  text: string;
  /** 结构化数据（GUI 用：百分比/命中理由/文件清单…） */
  data?: Record<string, unknown>;
}

/** 进程内单例 capture（避免每条事件重建；capture 是轻对象但路径解析有成本） */
type Capture = Awaited<ReturnType<typeof getCapture>>;
let cached: { root: string; capture: Capture } | null = null;

async function captureFor(root: string): Promise<Capture> {
  const resolved = path.resolve(root);
  if (cached && cached.root === resolved) return cached.capture;
  // events 路径约定与 observe 线同一处（watch_project_tool.ts#observeEventsDir 的同款口径）：
  // <root>/.agent-io/observe/events.jsonl —— 同文件混存，probe 前缀区分。
  const eventsPath = path.join(resolved, '.agent-io', 'observe', 'events.jsonl');
  const capture = await getCapture(eventsPath);
  cached = { root: resolved, capture };
  return capture;
}

/**
 * **遥测发射**（引擎各环节的一行调用）。
 *
 * @param root    项目根（events 落 `<root>/.agent-io/observe/events.jsonl`）
 * @param stage   环节名（用 TELEMETRY_STAGES 常量，别裸写字符串）
 * @param payload 人读文案 + 结构化数据
 */
export function emitTelemetry(
  root: string,
  stage: TelemetryStage,
  payload: TelemetryPayload,
): void {
  // 延迟异步初始化 + fire-and-forget：遥测绝不阻断主操作
  // （初始化失败/落盘失败/序列化失败 ⇒ 丢帧不抛——catch 全包）
  void captureFor(root)
    .then((capture) => {
      capture.emit(`telemetry.${stage}`, { text: payload.text, ...(payload.data ?? {}) }, 'dev-telemetry');
    })
    .catch(() => {
      /* 丢帧不抛 */
    });
}

/** 人读时序行渲染（回放器共用）：`HH:mm:ss.SSS [stage] text` */
export function renderTelemetryLine(time: string, probe: string, text: string): string {
  const stage = probe.replace(/^telemetry\./, '');
  // time 是 UTC RFC3339 ⇒ 取本地时分的简单做法：直接显示原始 ISO 的时分秒（回放器按本地再转也行）
  const hhmmss = time.slice(11, 23);
  return `${hhmmss} [${stage}] ${text}`;
}
