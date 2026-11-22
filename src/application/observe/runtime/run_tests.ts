/**
 * run_tests —— 通用测试编排工具（跑测试 → 返回退出码 + 输出尾部）
 *
 * 解决日常缺口：改完代码要确认——此前跑 `npm test` 看长文本再人工判断成败。
 * 本品不再绑定任何具体测试框架：一律走目标项目 package.json 的 scripts.test，
 * 以进程退出码判定成败（退出码 0 ⇒ 成功，这是所有测试框架的共同契约），
 * 失败时回吐 stdout/stderr 的尾部供 LLM 快速定位，而不是解析某框架的私有 JSON。
 *
 * 用法：
 *   - filter（推荐）：`npm test -- <filter>` 定向跑（npm 会把 `--` 后的参数透传给 scripts.test）。
 *   - 省略 filter：跑全量（耗时，适合提交前检查，注意 timeout）。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { resolveNoShell } from '../../../infrastructure/exec_guard.js';
import {
  finishAttempt,
  startAttempt,
  type AttemptContext,
  type AttemptRecord,
} from './attempt_recorder.js';

export interface RunTestsResult {
  /** 工具是否成功执行（能定位到 scripts.test、能起进程拿到退出码）——不含测试通过与否 */
  ok: boolean;
  /** 测试是否全通过（退出码 === 0） */
  success: boolean;
  /** 实际执行的命令（如 `npm test` / `npm test -- foo`） */
  command: string;
  /** 进程退出码；被信号杀死或超时时为 null */
  exitCode: number | null;
  /** 传入的 filter（若有） */
  filter?: string;
  /** filter 的传递方式说明（如采用 npm 透传，或无法传递的原因） */
  filterNote?: string;
  /** 是否超时被杀 */
  timedOut: boolean;
  /** stdout 尾部（截断，仅尾部） */
  stdoutTail: string;
  /** stderr 尾部（截断，仅尾部） */
  stderrTail: string;
  /** 输出是否被截断（超过尾部阈值） */
  outputTruncated: boolean;
  /** ok=false 时的失败原因说明 */
  error?: string;
  /** P2：本次调用的 Attempt 事件记录回执（未记时 `recorded=false` 并给原因，非静默） */
  attempt?: AttemptRecord;
}

/** runTests 入参（执行上下文可选：缺任务字段 = 通用 runner，事件不记但回执显式标注）。 */
export interface RunTestsInput {
  project_dir?: string;
  filter?: string;
  timeoutMs?: number;
  /** 任务/租约上下文（透传自工具入参；授权仍由既有写闸判，这里只做审计与分桶）。 */
  execution?: AttemptContext;
}

/** 单条输出流的尾部保留字符数（约 4000） */
const TAIL_CHARS = 4000;

export function runTests(input: RunTestsInput): RunTestsResult {
  const cwd = input.project_dir ? path.resolve(input.project_dir) : process.cwd();
  // ★ P2：一次正式调用 = 一个 Attempt（同 Run 内可多个顺序 Attempt；这里不做重试/分组）。
  //   ref 在开工前生成，started/finished 按它配对；同步句柄拿不到 pid（记录器里标 unavailable）。
  const attemptRef = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const execCtx: AttemptContext | undefined = input.execution;

  // 防自递归：npm 跑任何 script 时都会设置 `npm_lifecycle_event`。本仓测试入口不止一个
  // （test / test:main / test:r5 / test:watch），只要在「测试类 npm script」进程内、又省略
  // filter 跑全量 → 会再起一个嵌套全量套件，层层套壳直至超时，一律拒绝。仅匹配 test / test:*，
  // 不误伤 start / serve / build 等非测试脚本（用 npm script 起本服务时仍可跑全量）。
  const lifecycle = process.env.npm_lifecycle_event;
  if (!input.filter && lifecycle && (lifecycle === 'test' || lifecycle.startsWith('test:'))) {
    return fail(
      `run_tests 检测到当前已在 npm 测试进程内（npm_lifecycle_event=${lifecycle}）：省略 filter 会跑全量套件造成自递归，已拒绝。请显式传 filter 定向回归，或在正常环境（非测试进程）跑全量。`,
    );
  }

  // 判定方式：读目标项目 package.json 的 scripts.test。
  // ★ 这是**我们选择的口径**，不是「所有项目都这样」：npm 生态全体（npm/pnpm/yarn/bun 项目、
  //   以及用 vitest/jest/mocha/node:test 的项目）都把测试入口声明在这里；跨语言没有统一入口。
  // ★★ 第⑬项 Java ②（2026-11-11）：**Java 项目接入同款识别**——pom.xml ⇒ `mvn test`（有 filter ⇒
  //   `-Dtest=<类名>`，filter 传测试类名/方法）；gradlew ⇒ `gradlew test --tests=<类名>`。
  //   与 verifyProject 的 detectRunner 同一口径（pom + mvn 可用性探测）。
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
    const mvnCheck = spawnSync('mvn', ['-v'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (mvnCheck.status !== 0) {
      return fail('pom.xml 存在，但 `mvn -v` 不可用（Maven 不在 PATH）⇒ Java 测试跑不了（如实报，不假装）。');
    }
    const mvnArgs = ['test', '-q'];
    let filterNote: string | undefined;
    if (input.filter) {
      // filter 语义：Maven surefire 的 -Dtest 接受类名/类名#方法/通配（与 npm 的 -- 透传不同族）
      mvnArgs.push(`-Dtest=${input.filter}`);
      filterNote = `filter 经 surefire 的 -Dtest 传递（类名/类名#方法/通配；如 com.example.GreeterImplTest）`;
    }
    const command = ['mvn', ...mvnArgs].join(' ');
    const timeout = input.timeoutMs ?? 600_000;
    const exe = resolveNoShell('mvn');
    if (!exe) {
      return fail('`mvn` 解析失败（resolveNoShell）——Maven 安装形态不受支持。');
    }
    // ★ P2：解析出真实命令之后、起进程之前落 attempt_started（输入指纹；pid unavailable）。
    const attempt = startAttempt(cwd, execCtx, attemptRef, { command, filter: input.filter, cwd, timeoutMs: timeout });
    const r = spawnSync(exe.file, [...exe.prefixArgs, ...mvnArgs], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 << 20,
      timeout,
    });
    const stdout = typeof r.stdout === 'string' ? r.stdout : '';
    const stderr = typeof r.stderr === 'string' ? r.stderr : '';
    const { text: stdoutTail, truncated: t1 } = tail(stdout);
    const { text: stderrTail, truncated: t2 } = tail(stderr);
    const err = r.error as (Error & { code?: string }) | undefined;
    const timedOut = err?.code === 'ETIMEDOUT';
    const signal = r.signal != null ? String(r.signal) : null;
    // ★ F5：start 未落库就不补 finish（上下文齐 ≠ 已落库）；finish 回执显式带 append_ok/error。
    const fin = attempt.recorded
      ? finishAttempt(cwd, execCtx, attemptRef, {
          command,
          exit_code: r.status,
          signal,
          timed_out: timedOut,
          log_ref: { stdout_tail_ref: 'stdoutTail', stderr_tail_ref: 'stderrTail' },
        }, cwd)
      : null;
    if (fin) {
      attempt.finished = fin.finished;
      attempt.git_finished = fin.git_finished;
      attempt.append_ok = fin.append_ok;
      attempt.append_error = fin.error;
    }
    if (timedOut) {
      return withAttempt(attempt, {
        ok: false, success: false, command, exitCode: r.status,
        filter: input.filter, filterNote, timedOut: true,
        stdoutTail, stderrTail, outputTruncated: t1 || t2,
        error: `mvn test 超时（>${Math.round(timeout / 1000)}s），进程已被终止。`,
      });
    }
    if (err) {
      return withAttempt(attempt, {
        ok: false, success: false, command, exitCode: r.status,
        filter: input.filter, filterNote, timedOut: false,
        stdoutTail, stderrTail, outputTruncated: t1 || t2,
        error: `无法启动 mvn：${err.message}`,
      });
    }
    return withAttempt(attempt, {
      ok: true,
      success: r.status === 0,
      command,
      exitCode: r.status,
      filter: input.filter,
      filterNote,
      timedOut: false,
      stdoutTail,
      stderrTail,
      outputTruncated: t1 || t2,
    });
  }
  let pkg: { scripts?: Record<string, string> } | undefined;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')) as { scripts?: Record<string, string> };
  } catch {
    return fail(
      `无法读取目标项目 package.json（${path.join(cwd, 'package.json')}）。` +
        `本工具的口径：以 package.json 的 scripts.test 作为测试入口（npm 生态的通用约定）。` +
        `若目标项目不是 npm 生态（Go / Python / Java 等），本工具**不代为推断**命令 —— ` +
        `请直接运行其原生测试命令（go test ./... / pytest / mvn test）。`,
    );
  }
  const testScript = pkg.scripts?.test;
  if (typeof testScript !== 'string' || testScript.trim() === '') {
    return fail(
      `目标项目 package.json 存在，但没有 scripts.test（或为空）—— 无法确定如何运行测试。` +
        `本工具不会去猜一个命令来跑（猜错会产出"看起来跑了测试"的假读数）；请在 package.json 里补 scripts.test。`,
    );
  }

  const args = ['test'];
  let filterNote: string | undefined;
  if (input.filter) {
    // npm 标准透传：`npm test -- <filter>` 会把 `--` 后的参数追加到 scripts.test 命令尾。
    // ★★ 不变量（P0 命令注入，2026-11-05）：filter **原样作为一个 argv 元素**，不加引号、不转义。
    //   它的合法性**无法枚举**（测试过滤串可以是任意文本）⇒ 只能靠“不让 shell 看见它”，
    //   而不是靠白名单：`spawnSync(file, argv, { shell: false })` 直接把 argv 交给 execve。
    args.push('--', input.filter);
    filterNote = `已将 filter 经 npm 标准透传（npm test -- ${input.filter}）追加到 scripts.test；是否被具体测试运行器采纳取决于该脚本，工具无法验证。`;
  }
  const command = ['npm', ...args].join(' ');

  const timeout = input.timeoutMs ?? 120_000;
  // ★★ 不变量（P0 命令注入）：**shell: false + argv 逐项传递**。
  //   **开 shell** 会把 args 拼成一行命令串再交给 cmd.exe / sh —— filter 里的 `$(id)`、反引号、`& calc`
  //   就会被当成命令执行（旧实现只是给 filter 加一对双引号，POSIX 下仍会命令替换）。
  //   `resolveNoShell` 解掉“Windows 上 npm 只是 .cmd shim、不带 shell 直接 EINVAL”这唯一障碍。
  const exe = resolveNoShell('npm');
  if (!exe) {
    return fail('PATH 上找不到 npm（本工具需要它才能跑 scripts.test）—— 请确认 Node.js / npm 已安装并在 PATH 上。');
  }
  // ★ P2：解析出真实命令之后、起进程之前落 attempt_started（输入指纹；pid unavailable）。
  const attempt = startAttempt(cwd, execCtx, attemptRef, { command, filter: input.filter, cwd, timeoutMs: timeout });
  const r = spawnSync(exe.file, [...exe.prefixArgs, ...args], {
    cwd,
    timeout,
    shell: false,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  const stderr = typeof r.stderr === 'string' ? r.stderr : '';
  const { text: stdoutTail, truncated: t1 } = tail(stdout);
  const { text: stderrTail, truncated: t2 } = tail(stderr);

  const err = r.error as (Error & { code?: string }) | undefined;
  const timedOut = err?.code === 'ETIMEDOUT';
  const signal = r.signal != null ? String(r.signal) : null;
  // ★ F5：start 未落库就不补 finish；finish 回执显式带 append_ok/error。
  const fin = attempt.recorded
    ? finishAttempt(cwd, execCtx, attemptRef, {
        command,
        exit_code: r.status,
        signal,
        timed_out: timedOut,
        log_ref: { stdout_tail_ref: 'stdoutTail', stderr_tail_ref: 'stderrTail' },
      }, cwd)
    : null;
  if (fin) {
    attempt.finished = fin.finished;
    attempt.git_finished = fin.git_finished;
    attempt.append_ok = fin.append_ok;
    attempt.append_error = fin.error;
  }

  if (timedOut) {
    return withAttempt(attempt, {
      ok: false,
      success: false,
      command,
      exitCode: r.status,
      filter: input.filter,
      filterNote,
      timedOut: true,
      stdoutTail,
      stderrTail,
      outputTruncated: t1 || t2,
      error: `测试超时（>${Math.round(timeout / 1000)}s），进程已被终止。`,
    });
  }

  // spawn 层面的失败（如 npm 无法启动）：error 存在且非超时。如实返回，不吞。
  if (err) {
    return withAttempt(attempt, {
      ok: false,
      success: false,
      command,
      exitCode: r.status,
      filter: input.filter,
      filterNote,
      timedOut: false,
      stdoutTail,
      stderrTail,
      outputTruncated: t1 || t2,
      error: `无法启动测试进程：${err.message}`,
    });
  }

  // 退出码是唯一判据。exitCode 为 null（被信号杀死）时按失败处理。
  return withAttempt(attempt, {
    ok: true,
    success: r.status === 0,
    command,
    exitCode: r.status,
    filter: input.filter,
    filterNote,
    timedOut: false,
    stdoutTail,
    stderrTail,
    outputTruncated: t1 || t2,
  });
}

/** 把 Attempt 记录回执附到结果上（未记录时回执原样保留 `recorded=false` 与原因）。 */
function withAttempt(attempt: AttemptRecord, result: RunTestsResult): RunTestsResult {
  result.attempt = attempt;
  return result;
}

/** ok=false 的统一返回（退出码/输出均为空） */
function fail(error: string): RunTestsResult {
  return {
    ok: false,
    success: false,
    command: '',
    exitCode: null,
    timedOut: false,
    stdoutTail: '',
    stderrTail: '',
    outputTruncated: false,
    error,
  };
}

/** 取文本尾部；超长时截断并注明「仅尾部」 */
function tail(s: string): { text: string; truncated: boolean } {
  if (s.length <= TAIL_CHARS) return { text: s, truncated: false };
  return { text: `…（仅尾部，已截断前 ${s.length - TAIL_CHARS} 字符）\n` + s.slice(-TAIL_CHARS), truncated: true };
}
