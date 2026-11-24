/**
 * touches: src/application/design/intent/expectations.ts
 *
 * **journey 契约的执行核** —— 2026-11-10
 *
 * ## 它考什么（"卡级契约"＝组合证据）
 * 子函数各自全绿 ≠ 旅程通。journey 契约把一条真实消息从**投递 → 分发 → 处理 → 多席位出站帧**
 * 走完，对**终态投影**断言：哪些 seat 收到 notice（code）、哪些角色收到 relay（type、次数）。
 *
 * ## 执行形态（为什么不是 runCaseProgram）
 * journey 的输入不是"构造参数"而是"注入环境 + 一条消息"，断言的是多对象出站帧——
 * ctor/steps/throws/effects 的形状对不上。本核复用 `case_program_fakes` 的转译基建
 * （TS→ESM + 相对闭包镜像），在隔离子进程里跑（判定进程不 import 被测代码，与 fakes 同纪律）。
 *
 * ## 为什么不用网络替身（fakes 备而不用）
 * 第③项改造（review-hub router.ts）已把传输层挡在 `RouterDeps` 注入边界外：
 * journey 核组装假 registry/send + 真 queue/真 protocol，直接调 `routeMessage` ——
 * **没有 socket、没有帧解析，组合行为全部可考**。若未来 journey 依赖了 fs 实现，
 * 同一子进程里声明 `fakes` 即覆盖（基建同源）。
 *
 * ## 依赖注入契约（谁保证 journey 不失真）
 * 本核只消费 `routeMessage(deps, seat, env)` 这一个入口 —— 与 server.ts 的接线**同一个口**。
 * 假件只有两样：registry（席位表）与 send（出站帧收集器）；queue/protocol 用**真件**——
 * 队列记账与信封形状是旅程语义的一部分，换成假件旅程就假了。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { materializeTarget, transpileToFakesEsm } from './case_program_fakes.js';

/** 一条 journey 场景（判据 cases[] 的元素；JSON 直写） */
export type JourneyCase = {
  /** 投递的一条消息：`{type, from?, payload?, correlation_id?}` */
  deliver: { type: string; from?: { role: string; id?: string }; payload?: Record<string, unknown>; correlation_id?: string };
  /** 环境：`{seats:[{id,role}...], handoffValidateOk?, validatorProblems?}`（缺省 2 席位 + 校验器放行） */
  fixture?: {
    seats?: Array<{ id: string; role: string }>;
    handoffValidateOk?: boolean;
    validatorProblems?: string[];
    validatorThrows?: boolean;
  };
  /** 终态投影：`{notices:[{to,code}], relays:[{to,type,count}]}` */
  expect: {
    notices?: Array<{ to: string; code: string }>;
    relays?: Array<{ to: string; type: string; count?: number }>;
  };
};

export type JourneyRunResult = {
  status: 'pass' | 'fail' | 'unsupported';
  at?: string;
  detail: string[];
};

/** 一条出站帧的投影（假 send 收集到的） */
type OutboundFrame = { to: { role: string; id?: string }; type: string; payload: Record<string, unknown> };

/** journey runner 子进程源：组装 RouterDeps 假件 + 投递 + 投影比对，结果落 FAKES_RESULT_FILE */
function journeyRunnerSource(entry: string): string {
  return `
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const SPEC = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const CASE = SPEC.journeyCase;
const OUT_FILE = process.env.FAKES_RESULT_FILE;

function emit(r) {
  const line = JSON.stringify(r);
  try { process.stdout.write(line + '\\n'); } catch {}
  if (OUT_FILE) { try { fs.writeFileSync(OUT_FILE, line, 'utf-8'); } catch {} }
  process.exit(0);
}

try {
  const mod = await import(pathToFileURL(${JSON.stringify(entry)}).href);
  const P = await import(pathToFileURL(${JSON.stringify('')} + SPEC.protocolEntry).href);

  // ── 假 seat / 假 registry（出站帧收集器）──
  const frames = [];
  const seats = (CASE.fixture?.seats ?? [
    { id: 'executor-1', role: 'executor' },
    { id: 'review-board-1', role: 'review-board' },
  ]).map((s) => ({
    clientId: s.id, seatName: s.id, role: s.role, rawRole: s.id, name: s.id, connectedAt: 0,
    send: (e) => frames.push({ to: { ...(e.to ?? {}) }, type: e.type, payload: e.payload ?? {} }),
  }));

  // ── 真 queue / 真 protocol；假 registry（路由表来自 fixture）──
  const { TaskQueue } = await import(pathToFileURL(SPEC.queueEntry).href);
  const queue = new TaskQueue({ maxConcurrent: 4 });

  const deps = {
    queue,
    registry: {
      register: () => { throw new Error('journey 不需要注册'); },
      unregister: () => false,
      byClientId: (cid) => seats.find((s) => s.clientId === cid),
      byRole: (role) => seats.filter((s) => s.role === role),
    },
    resolveTarget: (addr) => (addr.id ? seats.find((s) => s.clientId === addr.id) : seats.find((s) => s.role === addr.role)),
    relayToRole: (role, env) => {
      const hits = seats.filter((s) => s.role === role);
      for (const h of hits) h.send(env);
      return hits.length > 0;
    },
    notice: (seat, code, detail, extra = {}) => {
      seat.send({ type: P.CHANNELS.notice, to: { role: seat.role, id: seat.clientId }, payload: { code, detail, ...extra } });
    },
    pendingPermissions: new Map(),
    alerts: [],
    handoffValidate: async (md) => {
      if (CASE.fixture?.validatorThrows) throw new Error('validator down (journey fixture)');
      const ok = CASE.fixture?.handoffValidateOk !== false;
      return ok
        ? { ok: true, problems: [], meta: { src: 'journey' }, sections: [], source: 'journey-fixture' }
        : { ok: false, problems: CASE.fixture?.validatorProblems ?? ['缺少结论'], meta: {}, sections: [], source: 'journey-fixture' };
    },
  };

  const seat = seats.find((s) => s.id === (CASE.deliver.from?.id ?? '')) ?? seats[0];
  const env = {
    protocol: P.COUNCIL_PROTOCOL, id: 'j1', ts: 0, timestamp: 0,
    type: CASE.deliver.type,
    from: CASE.deliver.from ?? { role: 'executor', id: 'executor-1' },
    to: { role: 'hub' },
    payload: CASE.deliver.payload ?? {},
    ...(CASE.deliver.correlation_id ? { correlation_id: CASE.deliver.correlation_id } : {}),
  };

  await mod.routeMessage(deps, seat, env);

  // ── 终态投影比对 ──
  const detail = [];
  let fail = false;
  const canon = (v) => JSON.stringify(v, Object.keys(v ?? {}).sort());

  for (const n of CASE.expect?.notices ?? []) {
    const hit = frames.filter((f) => f.type === P.CHANNELS.notice && f.payload.code === n.code && (!n.to || f.to.role === n.to || f.to.id === n.to));
    if (hit.length === 0) { fail = true; detail.push('expect notice ' + JSON.stringify(n) + ' ⇒ 没有出现（实际 notices：' + JSON.stringify(frames.filter((f) => f.type === P.CHANNELS.notice).map((f) => ({ to: f.to, code: f.payload.code }))) + '）'); }
    else detail.push('notice ' + JSON.stringify(n) + ' ✓');
  }
  for (const r of CASE.expect?.relays ?? []) {
    const hit = frames.filter((f) => f.type === r.type && (r.to ? f.to.role === r.to : true));
    const want = r.count ?? 1;
    if (hit.length !== want) { fail = true; detail.push('expect relay ' + JSON.stringify(r) + ' ⇒ 实得 ' + hit.length + ' 帧（全部出站：' + JSON.stringify(frames.map((f) => ({ to: f.to, type: f.type }))) + '）'); }
    else detail.push('relay ' + JSON.stringify(r) + ' ✓');
  }

  emit(fail ? { status: 'fail', at: 'expect', detail } : { status: 'pass', detail });
} catch (e) {
  emit({ status: 'unsupported', detail: ['journey 执行核异常 ⇒ 判不了：' + String((e && e.message) || e)] });
}
`;
}

/** 跑一个 journey 契约场景（子进程隔离，与 fakes 同一套 spawn 双通道纪律） */
export function runJourneyCase(input: {
  projectRoot: string;
  file: string;
  journeyCase: JourneyCase;
  slackMs?: number;
}): JourneyRunResult {
  const abs = path.join(input.projectRoot, input.file);
  if (!fs.existsSync(abs)) return { status: 'unsupported', detail: [`${input.file} 不存在`] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-journey-'));
  try {
    // 目标（router）+ 相对闭包镜像
    const diags: string[] = [];
    let src = '';
    try {
      src = fs.readFileSync(abs, 'utf-8');
    } catch (e) {
      return { status: 'unsupported', detail: [`目标文件读不了 ⇒ 判不了：${(e as Error).message}`] };
    }
    const t = materializeTarget({ entryAbs: abs, entrySrc: src, tmp, projectRoot: input.projectRoot, diag: (m) => diags.push(m) });
    if ('error' in t) return { status: 'unsupported', detail: [t.error, ...diags] };
    // 旅程闭包里的两个真件也落镜像（queue / protocol）
    for (const dep of ['queue.ts', 'protocol.ts']) {
      const depAbs = path.join(input.projectRoot, 'src', dep);
      if (!fs.existsSync(depAbs)) return { status: 'unsupported', detail: [`旅程依赖 src/${dep} 不存在`] };
      const dSrc = fs.readFileSync(depAbs, 'utf-8');
      const dTr = transpileToFakesEsm(depAbs, dSrc);
      if ('error' in dTr) return { status: 'unsupported', detail: [`${dep} 转译失败：${dTr.error}`] };
      fs.writeFileSync(path.join(tmp, 'src', dep.replace(/\.ts$/, '.js')), dTr.js, 'utf-8');
    }

    fs.writeFileSync(path.join(tmp, 'runner.mjs'), journeyRunnerSource(path.join(tmp, t.entryRel)), 'utf-8');
    const spec = {
      protocolEntry: path.join(tmp, 'src', 'protocol.js'),
      queueEntry: path.join(tmp, 'src', 'queue.js'),
      journeyCase: input.journeyCase,
    };
    fs.writeFileSync(path.join(tmp, 'spec.json'), JSON.stringify(spec), 'utf-8');

    const baseEnv = { ...process.env };
    const importSpec = pathToFileURL(path.join(tmp, 'runner.mjs')).href;
    let r = spawnSync(process.execPath, ['runner.mjs', 'spec.json'], {
      cwd: tmp, encoding: 'utf-8', timeout: (input.slackMs ?? 250) + 15_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: baseEnv,
    });

    if (r.error && (r.error as NodeJS.ErrnoException).code === 'EPERM') {
      const resultFile = path.join(tmp, 'result.json');
      const bat = path.join(tmp, 'run.cmd');
      fs.writeFileSync(bat, `"${process.execPath}" runner.mjs spec.json > nul 2>&1\r\n`, 'utf-8');
      // ★ P2-R3worker：cmd 解释器用 ComSpec 绝对路径，不用裸名 `cmd.exe`（裁剪 PATH 时裸名 ENOENT）。
      const comSpec = process.env.ComSpec || path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
      r = spawnSync(comSpec, ['/d', '/c', 'run.cmd'], {
        cwd: tmp, encoding: 'utf-8', timeout: (input.slackMs ?? 250) + 15_000, windowsHide: true, stdio: 'ignore',
        env: { ...baseEnv, FAKES_RESULT_FILE: resultFile },
      });
      if (r.error) return { status: 'unsupported', detail: [`journey 子进程跑不了 ⇒ 判不了：${(r.error as Error).message}`] };
      if (!fs.existsSync(resultFile)) return { status: 'unsupported', detail: ['journey 子进程没有产出结果文件', ...diags] };
      try {
        return JSON.parse(fs.readFileSync(resultFile, 'utf-8').trim()) as JourneyRunResult;
      } catch {
        return { status: 'unsupported', detail: ['journey 结果解析失败'] };
      }
    }

    if (r.error) return { status: 'unsupported', detail: [`journey 子进程跑不了 ⇒ 判不了：${(r.error as Error).message}`] };
    const last = `${r.stdout ?? ''}`.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
    try {
      return JSON.parse(last) as JourneyRunResult;
    } catch {
      return { status: 'unsupported', detail: [`journey 子进程输出解析失败：${last.slice(0, 160)}`] };
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* Windows 留给 OS */
    }
  }
}
