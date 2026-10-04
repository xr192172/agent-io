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
}

/** 单条输出流的尾部保留字符数（约 4000） */
const TAIL_CHARS = 4000;

export function runTests(input: { project_dir?: string; filter?: string; timeoutMs?: number }): RunTestsResult {
  const cwd = input.project_dir ? path.resolve(input.project_dir) : process.cwd();

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
  //   其它生态（Go 的 `go test`、Python 的 pytest、Java 的 mvn test…）本工具**不做推断**，
  //   如实报错并指路，而不是猜一个命令去跑。
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
    args.push('--', quoteForShell(input.filter));
    filterNote = `已将 filter 经 npm 标准透传（npm test -- ${input.filter}）追加到 scripts.test；是否被具体测试运行器采纳取决于该脚本，工具无法验证。`;
  }
  const command = ['npm', ...args].join(' ');

  const timeout = input.timeoutMs ?? 120_000;
  const r = spawnSync('npm', args, {
    cwd,
    timeout,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  const stderr = typeof r.stderr === 'string' ? r.stderr : '';
  const { text: stdoutTail, truncated: t1 } = tail(stdout);
  const { text: stderrTail, truncated: t2 } = tail(stderr);

  const err = r.error as (Error & { code?: string }) | undefined;
  const timedOut = err?.code === 'ETIMEDOUT';

  if (timedOut) {
    return {
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
    };
  }

  // spawn 层面的失败（如 npm 无法启动）：error 存在且非超时。如实返回，不吞。
  if (err) {
    return {
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
    };
  }

  // 退出码是唯一判据。exitCode 为 null（被信号杀死）时按失败处理。
  return {
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
  };
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

/** 含空白或 shell 元字符时加双引号，避免经 shell 被拆成多个参数 */
function quoteForShell(s: string): string {
  return /[\s"'`$&|;<>(){}[\]*?!\\]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}
