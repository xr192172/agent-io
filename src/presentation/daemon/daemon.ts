/**
 * agent-io daemon（方向 E）—— watch/影响播报/loop 回流的常驻宿主进程
 *
 * 启动：npm run daemon（node dist/src/presentation/daemon/daemon.js）
 * 端口：127.0.0.1:7600（AGENT_IO_DAEMON_PORT 可配）；pidfile 落 OS tmpdir
 *
 * 为什么需要 daemon（此前"伪常驻"的三个断点）：
 *   1. watch 注册表挂在 MCP stdio 进程内存——LLM 会话重启全丢；daemon 独立
 *      生命周期，注册表跨会话存活（Ledger 本就落盘，配合后状态完全连续）
 *   2. serve 与 MCP 各自跑 watch 实例互不知情（重复同步）；daemon 单实例权威
 *   3. alert 单订阅互抢（takeAlerts 一次清空）；daemon 游标制多客户端各取所需
 *
 * 方向 D 闭环自动化：ledger-violated 事件 → 防抖 10s → spawn observe-dsl loop
 * （读 events.jsonl + ledger.json，产出 known-spread/未声明探针提案）→
 * 新提案 pushAlert + SSE 广播。deviation 回流 DSL 从"外部手动触发"变事件驱动。
 *
 * 幂等：启动时探测已有 daemon（health 通）→ 打印提示直接退出；pidfile 只做
 * 事后诊断（进程已死但 pidfile 残留 → 覆盖）。
 */

import { DATA_DIR_NAME, GO_OBSERVE_DIR_NAME } from '../../infrastructure/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLoop } from '../../infrastructure/analysis/observe/run_loop.js';
import { watchProjectTool, listActiveWatches, setWatchToolEventListener } from '../../application/observe/runtime/watch_project_tool.js';
import { setAlertListener, alertsSince, pushAlert } from '../../infrastructure/alert_inbox.js';
import { saveDSL, getDSL, onDslChange } from '../../infrastructure/storage.js';
import { updateFeature } from '../../application/design/dsl_ops/update_feature.js';
import { createDaemonServer, type DslWriteRequest, type DslWriteResult } from './server.js';
import { probeDaemon, daemonPort } from '../../infrastructure/daemon/client.js';
import { startMemoryWatch } from './memory_watch.js';

// ─────────────────────────────────────────────────────────────
// 依赖区域感知：写冲突的"细粒度"判据
//
// 从 edit_dsl 的 ops（FeatureOperation[]）提取本次提交实际影响的目标元素
// （`type:id`），作为该提交的"依赖区域"。daemon 用各 feature 最近一次成功写
// 的影响元素集做重叠判断：
//   - 本次提交与在途/最新提交的元素无交集 → 属于不同依赖区域，可放心 rebase
//   - 有交集 → 同一块依赖区域被并发改写，强冲突提示，须人工/LLM 决策
// feature 级操作（annotation/approval/snapshot/layout/simulation 无 id）视为
// 影响整个 feature，与任何写都重叠（保守安全）。
// ─────────────────────────────────────────────────────────────

/** 从 ops 提取依赖区域元素集（`type:id`）；feature 级操作折叠为全局哨兵 */
function extractTouchedElements(ops?: Record<string, unknown>): string[] {
  const operations = ops?.operations;
  if (!Array.isArray(operations)) return [];
  const touched: string[] = [];
  for (const op of operations as Array<{ type?: string; id?: string }>) {
    if (!op.type) continue;
    touched.push(op.id ? `${op.type}:${op.id}` : `__feature__:${op.type}`);
  }
  return touched;
}

/** 各 feature 最近一次成功写的影响元素集（供下一次提交做依赖重叠判断） */
const lastTouchedByFeature = new Map<string, string[]>();

/**
 * 判断依赖区域是否重叠：本次提交 touched 与给定集合（该 feature 最后一次成功写）
 * 是否有交集。任一为空数组视为未知域——保守判定为冲突（防止静默覆盖）。
 */
function regionsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true; // 未知域，保守重叠
  return a.some((x) => b.includes(x));
}

/**
 * 单写者应用对设计 DSL 的编辑（方向 E 写权威，经 daemon 串行队列）
 *
 * 两种提交形态（req.input 决定）：
 *  - 带 ops（edit_dsl 原始入参）：daemon 在串行队列内读最新 DSL → 执行 updateFeature
 *    （结果落盘，rev 自增底层处理）→ SSE 广播 dsl-changed。由于读改写全部发生在
 *    daemon 同一进程的串行队列内，进程内绝不并发直写 —— 「最后写者胜」被结构性消除。
 *  - 不带 ops（bdsl 完整提交）：以 base_dsl_rev 乐观锁校验后 saveDSL。
 *
 * 乐观锁：客户端（LLM）先从 get_dsl 拿到 base_rev，编辑后带同一 base_rev 提交。
 *  daemon 在执行前比对磁盘当前 rev，不一致即冲突拒绝（返回 current_rev 供 rebase），
 *  避免多会话/多窗口并发改同一 feature 时静默丢改动。
 */
function dslWriteHandler(req: DslWriteRequest): Promise<DslWriteResult> {
  const feature = req.feature as string;
  const ops = req.ops as Record<string, unknown> | undefined;
  const expectRev = req.base_dsl_rev;
  const currentRev = getDSL(feature)?._dsl_rev ?? 0;
  // 本次提交的依赖区域元素集（读改写形态才有；完整提交形态取不到 → 视为全局域）
  const touched = extractTouchedElements(ops);
  // 显式带 base_rev 时做乐观锁；缺省则按"无条件写"（兼容历史直写路径）
  if (expectRev !== undefined && expectRev !== currentRev) {
    // 依赖重叠判断：与最后一次成功写的元素是否有交集
    const lastTouched = lastTouchedByFeature.get(feature) ?? [];
    const overlap = regionsOverlap(touched, lastTouched);
    const overlapNote = overlap
      ? '且依赖区域重叠（与最新提交改到同一批元素），须拉取最新合并后重做。'
      : '但依赖区域不重叠（改动为不同元素），可在最新基础上安全 rebase。';
    // 冲突待办注入：复用 alert 通道（daemon 侧 alertLog + SSE），
    // MCP 侧 collectPendingAlertText 会随下一次工具响应自动带到 LLM 上下文
    pushAlert({
      project_dir: `dsl:${feature}`,
      seq: 0,
      line: `DSL 写冲突：feature "${feature}" 提交了 ${touched.length > 0 ? touched.length : '新'} 处依赖区域改动被拒绝（基础 rev ${expectRev} → 当前 ${currentRev}）${overlap ? '，依赖区域重叠' : '，依赖区域不重叠'}。edit_dsl base_dsl_rev=${currentRev} 重试。`,
      created_at: new Date().toISOString(),
    });
    return Promise.resolve({
      ok: false,
      rev: currentRev,
      conflict: true,
      current_rev: currentRev,
      touched,
      message:
        `DSL 冲突：feature "${feature}" 已被他人更新（当前 rev ${currentRev}，你的 base rev ${expectRev}）${overlapNote}` +
        `请重新 get_dsl 拉取最新后重做。`,
    });
  }
  try {
    if (ops && typeof ops === 'object') {
      // edit_dsl 原始入参：在 daemon 进程内执行读改写（updateFeature 内部 saveDSL 落盘）
      const r = updateFeature(ops as never);
      // 写成功后记录该 feature 的最新依赖区域（供后续提交重叠判断）
      lastTouchedByFeature.set(feature, touched);
      return Promise.resolve({ ok: true, rev: getDSL(feature)?._dsl_rev ?? currentRev + 1, touched, message: r.message });
    }
    // 完整提交形态：乐观锁已校验，saveDSL 带 currentRev 保证落盘 rev 匹配；
    // 该形态影响面未知，记录为全局域（后续任何写都视为重叠，保守）
    saveDSL(req.dsl as never, req.source ?? 'daemon', currentRev);
    lastTouchedByFeature.set(feature, []);
    return Promise.resolve({ ok: true, rev: currentRev + 1, touched, message: `已保存 ${feature}（rev ${currentRev + 1}）` });
  } catch (e) {
    return Promise.resolve({
      ok: false,
      rev: currentRev,
      conflict: true,
      current_rev: currentRev,
      touched,
      message: (e as Error).message,
    });
  }
}

const startedAt = new Date().toISOString();

// ─────────────────────────────────────────────────────────────
// pidfile（诊断用：确认端口归属；不承担互斥——互斥靠 health 探测）
// ─────────────────────────────────────────────────────────────

function pidfilePath(port: number): string {
  return path.join(os.tmpdir(), `agent-io-daemon-${port}.pid`);
}

function writePidfile(port: number): void {
  fs.writeFileSync(pidfilePath(port), JSON.stringify({ pid: process.pid, port, started_at: startedAt }, null, 2));
}

function removePidfile(port: number): void {
  try {
    fs.rmSync(pidfilePath(port), { force: true });
  } catch {
    /* 残留无碍 */
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 3：ledger-violated → observe-dsl loop 自动回流
// ─────────────────────────────────────────────────────────────

/** loop 触发防抖（每项目冷却窗口）：编辑风暴里连续 violated 只触发一次 */
const LOOP_COOLDOWN_MS = 10_000;
/** observe-dsl 执行超时（Go 二进制冷启动 + loop 单次迭代足够） */
const LOOP_TIMEOUT_MS = 60_000;
const loopCooldown = new Map<string, number>();
let loopRunning = false;

/**
 * ★ 从**任意模块位置**向上找仓库根：按**路标** `go-observe/`（本仓独有目录）判定，**不数层级**。
 *
 * 为什么导出：原先这里写死「`dist/src/daemon/daemon.js` → 上溯 **3** 级」，
 * 本文件随 §44.3 ⑥ 搬到 `dist/src/presentation/daemon/` 后层级变成 **4** ⇒ **静默算错**
 * （指到 `dist/` ⇒ 找不到二进制 ⇒ 悄悄退回 PATH）。导出后**可被测试钉住**。
 * ★ 这类"按层级数推路径"的知识**改名工具抓不到** —— 台账 §44.7 的形态清单里叫「⑥ 数层级」。
 */
export 
/** observe-dsl 二进制定位：env 显式指定 → 仓库内 build 产物 → PATH */

/** 事件驱动 loop：violated 后防抖触发，产出新提案则 pushAlert + SSE 广播
 *
 * ★ 2026-10-05（P2 之后的接线收口）：**从 spawn Go 二进制改成调用 TS `runLoop`**。
 *   改前是 `execFile(findObserveDslBin(), ['--project-root',…, 'loop', …])`，
 *   而 `findObserveDslBin` 的仓库内候选路径 `go-observe/build/observe-dsl.exe`
 *   **从来不存在、也没有任何脚本产出它**（P0 侦察核实：`.gitignore:6/38` 双忽略，
 *   `e2e_smoke.ps1:18` 输出到 `$env:TEMP`）⇒ 实际只有 `AGENT_IO_OBSERVE_DSL_BIN`
 *   或 PATH 生效 ⇒ **这条方向 D 闭环在多数部署下是静默不执行的**。
 *
 *   换 TS 之后顺带**从根上消掉两个老问题**（都不是"顺手修"，是换实现方式的必然结果）：
 *   ① **ENOENT 与"事件流不存在"被混为一谈**（旧 `:238-244`）：
 *      旧代码拿 `!fs.existsSync(eventsPath)` 去解释**所有**失败 ⇒ 二进制缺失、权限错、
 *      崩溃全都被报成"尚无 observe 事件流"。现在 `runLoop` 返回**结构化结果**
 *      （`skipReason` / `triggered` / `proposals`），失败与"没事件"**在类型上就是两件事**。
 *   ② **超时保护不能跟着 spawn 一起消失**：`execFile` 的 `timeout` 是白送的，
 *      换成 Promise 后必须显式补 —— 见下面 `withTimeout`。
 *
 *   保留不变的部分（避免打断下游）：广播事件名 `loop-started` / `loop-skipped` /
 *   `loop-proposal` / `loop-done` 全部沿用；`loopCooldown` 防抖与 `loopRunning` 互斥照旧。
 *   唯一改了文案：提示里的「observe-dsl proposals 查看」改为指向 TS 侧工具。
 */
function scheduleLoopTrigger(projectDir: string, broadcast: (event: string, data: unknown) => void): void {
  const now = Date.now();
  const last = loopCooldown.get(projectDir) ?? 0;
  if (now - last < LOOP_COOLDOWN_MS) return; // 冷却中：本轮违反已进 ledger，下轮 loop 会带上
  if (loopRunning) return; // 全局互斥：loop 幂等，串行足够
  loopCooldown.set(projectDir, now);
  loopRunning = true;

  // ★ 两个目录名**不是笔误，是两个程序各自的仓库**（分工见 data_dir.ts 的两张表）：
  //   · `.agent/observe` = 设计 DSL 仓库（dsl.json / proposals/）—— 必须与 Go 侧一致，改了断插桩集成
  //   · `.agent-io/`      = agent-io 自己的（事件流 / 台账）
  const dataDir = path.join(projectDir, GO_OBSERVE_DIR_NAME, 'observe');
  const proposalsDir = path.join(dataDir, 'proposals');
  const before = new Set(fs.existsSync(proposalsDir) ? fs.readdirSync(proposalsDir) : []);
  const eventsPath = path.join(projectDir, DATA_DIR_NAME, 'observe', 'events.jsonl');

  broadcast('loop-started', { project_dir: projectDir, engine: 'ts', at: new Date().toISOString() });

  withTimeout(
    runLoop(eventsPath, dataDir, projectDir),
    LOOP_TIMEOUT_MS,
    `loop 超过 ${LOOP_TIMEOUT_MS}ms 未完成（已放弃等待；daemon 不被阻塞）`,
  )
    .then((res) => {
      loopRunning = false;
      // 「没有事件流」与「真失败」现在天然分开：前者由 runLoop 自己给出 skipReason。
      if (res.skipReason && !res.triggered && res.proposals.length === 0 && res.report.event_count === 0) {
        broadcast('loop-skipped', { project_dir: projectDir, reason: res.skipReason });
        return;
      }
      if (!res.triggered) {
        broadcast('loop-skipped', { project_dir: projectDir, reason: res.skipReason ?? '未触发演进' });
        return;
      }
      const after = new Set(fs.existsSync(proposalsDir) ? fs.readdirSync(proposalsDir) : []);
      const newProposals = [...after].filter((f) => !before.has(f));
      if (newProposals.length > 0) {
        const line =
          `[loop 回流] ${projectDir} 产生 ${newProposals.length} 条新提案` +
          `（${newProposals.map((p) => p.replace('.json', '')).join(', ')}）· ` +
          `用 reconcile_proposals 查看、approve 后并入设计 DSL`;
        pushAlert({ project_dir: projectDir, seq: 0, line, created_at: new Date().toISOString() });
        broadcast('loop-proposal', { project_dir: projectDir, proposals: newProposals, at: new Date().toISOString() });
      } else {
        broadcast('loop-done', { project_dir: projectDir, proposals: 0, at: new Date().toISOString() });
      }
    })
    .catch((e: Error) => {
      loopRunning = false;
      // ★ 失败**响亮**：不再把任何错误都归因成"事件流还不存在"。
      console.warn('[loop] 执行失败:', e.message);
      broadcast('loop-skipped', { project_dir: projectDir, reason: `loop 执行失败：${e.message}` });
    });
}

/** 给 Promise 加超时（换掉 execFile 后必须显式补回的保护）。
 *  ⚠ 超时后**不取消**底层工作，只放弃等待 —— runLoop 只做文件 I/O（默认不开 LLM），
 *     放弃等待即可保证 daemon 不会被拖住。 */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const port = daemonPort();

  // 幂等：已有 daemon 在跑 → 提示并退出（不抢端口）
  const existing = await probeDaemon(500);
  if (existing) {
    console.log(`agent-io daemon 已在运行（pid ${existing.pid}，${existing.watches.length} 个监听），本次启动退出。`);
    process.exit(0);
  }

  // /api/shutdown 的实际流程在 server 就绪后绑定（闭包延迟绑定）
  let doShutdown: (() => Promise<void>) | null = null;
  const srv = createDaemonServer({
    health: () => ({
      ok: true,
      name: 'agent-io-daemon',
      pid: process.pid,
      port,
      started_at: startedAt,
      watches: listActiveWatches(),
    }),
    watch: (input) => watchProjectTool(input as unknown as Parameters<typeof watchProjectTool>[0]) as unknown as Promise<Record<string, unknown>>,
    dslWrite: dslWriteHandler,
    alertsSince: (cursor) => alertsSince(cursor),
    shutdown: () => doShutdown?.() ?? Promise.resolve(),
  }, { port });

  // 事件桥 ①：alert 入箱 → SSE 即时广播
  setAlertListener((a) => srv.broadcast('watch-alert', a));
  // 事件桥 ②：ledger violated → SSE 广播 + 防抖触发 loop 回流（方向 D 闭环）
  setWatchToolEventListener((e) => {
    srv.broadcast(e.type, e);
    if (e.type === 'ledger-violated') scheduleLoopTrigger(e.project_dir, (ev, d) => srv.broadcast(ev, d));
  });

  await srv.start();
  writePidfile(port);
  console.log(`agent-io daemon 就绪：http://127.0.0.1:${port}`);
  console.log(`  GET  /api/health          存活 + 监听汇总`);
  console.log(`  POST /api/watch           watch action 转发（start/status/stop/declare/ledger/impact）`);
  console.log(`  GET  /api/alerts?since=N  游标拉取未读提醒`);
  console.log(`  GET  /api/events          SSE（watch-alert / ledger-violated / loop-*）`);
  console.log(`  POST /api/shutdown        优雅退出（Windows 无 POSIX 信号的 HTTP 替代）`);
  console.log(`  pid ${process.pid} · pidfile ${pidfilePath(port)}`);

  // 内存自动托管看门狗：持续采样 gen（带 --inspect 的外部进程）→ 阈值判定 →
  // pushAlert（daemon SSE 实时广播 + 下一次 MCP 工具响应自动附带，DSH gen 自己看到）。
  if ((process.env.AGENT_IO_MEMORY_WATCH ?? '1') !== '0') {
    const intervalMs = Number(process.env.MEMORY_WATCH_INTERVAL_MS ?? 60_000);
    const rssDeltaMb = Number(process.env.MEMORY_WATCH_RSS_DELTA_MB ?? 1024);
    const leakRuns = Number(process.env.MEMORY_WATCH_LEAK_RUNS ?? 3);
    const minGapMs = Number(process.env.MEMORY_WATCH_MIN_GAP_MS ?? 300_000);
    await startMemoryWatch({ enabled: true, intervalMs, rssDeltaMb, leakRuns, minAlertGapMs: minGapMs });
    console.log(`  [memory_watch] 采样间隔 ${intervalMs}ms · RSS 增幅>${rssDeltaMb}MB 或 heapUsed 连续${leakRuns}次↑判告警 · AGENT_IO_MEMORY_WATCH=0 关闭`);
  }

  // 优雅退出：停 watch（flush 未落库变更）→ 关 server → 清 pidfile。
  // 触发：SIGINT/SIGTERM（POSIX）或 POST /api/shutdown（Windows/远程一律走这里）
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`\n收到 ${signal}，正在关闭（flush 监听队列）…`);
    return (async () => {
      try {
        for (const w of listActiveWatches()) {
          await watchProjectTool({ project_dir: w.project_dir, action: 'stop' });
        }
      } catch (e) {
        console.warn('停止监听时出错:', (e as Error).message);
      }
      await srv.stop();
      removePidfile(port);
      console.log('daemon 已退出。');
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  doShutdown = () => shutdown('api/shutdown') ?? Promise.resolve();
}

main().catch((e) => {
  console.error('daemon 启动失败:', e.message);
  process.exit(1);
});
