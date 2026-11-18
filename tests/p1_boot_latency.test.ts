/**
 * touches: src/domain/validator.ts, src/infrastructure/parse/kernel.ts,
 *          src/infrastructure/parse/loader.ts, src/infrastructure/index/project_exts.ts,
 *          src/presentation/mcp/server_registry.ts
 *
 * P1 · **入场税：两笔"付了但不用"的钱"**（延迟普查 `latency-ds-1` 快赢 QW-1 + QW-2）。
 *
 * ## 红（普查实测，`appdata/Temp/latency-ds-1.md` §2.1 / §6）
 * 每次 CLI/MCP 调用固定付 **1 325 ms** 入场费 = 裸 node 10 ms + ESM 图 931 ms + **prewarm 384 ms**，
 * 其中：
 *   · **11.7 %（165 ms）= `domain/validator.ts` 在模块顶层 `ajv.compile(96 KB schema)`**
 *     —— 连 `ledger` / `snapshot` / `rules` 这种**从不校验 DSL** 的工具也照付；
 *   · **384 ms = `prewarmKernel()` 无条件遍历 55 门语言**（51 个 Parser），而一次调用真正需要 0–2 门。
 *
 * ## 绿（本笔两处）
 * 1. **惰性 ajv**：`validator.ts` 的 `require('ajv')` + `compile` 挪进 `schemaValidator()`（首次校验才付）；
 * 2. **按需 prewarm**：`prewarmExts()` 只建点名的语言；`invokeTool` 的预热集合 =
 *    索引里这个项目**真有**的后缀（`projectParserExts`）∪ 入参点名的后缀；拿不到项目事实才退回全量。
 *
 * ## 每条用例"什么情形下会红"（判据必须有牙）
 * · 惰性 ajv 两条：模块缓存里**真的**没有 `ajv` ⇒ 回退成顶层编译立刻红；后面那条同时守住
 *   "懒了但还编得出来"（回退成 `validator` 恒真 / 不编译 ⇒ 红）。
 * · 按需 prewarm：点名 A 语言后 **A 就绪、B 仍不就绪** ⇒ 回退成全量预热 ⇒ B 变就绪 ⇒ 红；
 *   `prewarmKernel()` 那一条是**对照**（按需不许把全量也改懒）。
 * · 端到端：真 CLI 子进程的 stderr 里必须是 `prewarm(按需)` 且**没有**名册口径那行
 *   `prewarm: 可解析语言 …`（回退 ⇒ 只有那行 ⇒ 红）。
 * · 计时两条：`--help` 的墙钟上限 + `失败调用 − --help`（= 每次调用付的预热税）上限。
 *   ★ 它们是**预算/天花板**（本仓"全量验证 ≤2 s / 热操作 ≤100 ms"同族），不是"读数即判据"：
 *     具体毫秒数只在本机有意义，所以两条都**减去裸 node 地板**再加余量，且用 3 次取最小。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import * as validator from '../src/domain/validator.ts';
import { closeProjectCacheDb, getProjectCacheDb } from '../src/infrastructure/index/db.ts';
import { projectParserExts } from '../src/infrastructure/index/project_exts.ts';
import { canParseFileSync, parserReadyForFile } from '../src/infrastructure/parse/kernel.ts';
import { prewarmExts, prewarmKernel } from '../src/infrastructure/parse/index.ts';
import { clearLoaderCache, parserCacheExts } from '../src/infrastructure/parse/loader.ts';
import { findLanguageByExt } from '../src/infrastructure/parse/languages.ts';
import { listSupportedExts } from '../src/infrastructure/parse/probe.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'dist', 'src', 'presentation', 'cli', 'cli.js');
const nodeRequire = createRequire(import.meta.url);

/** 本进程的 CJS 模块缓存里，`ajv` / `ajv-formats` 到底加载了没有（惰性 = 此刻**没有**） */
function ajvLoaded(): boolean {
  return Object.keys(nodeRequire.cache).some((p) => /[\\/]node_modules[\\/](ajv|ajv-formats)[\\/]/.test(p));
}

/**
 * 取两个"不同语言、本机真的可载入"的后缀：A 用来点名、B 用来当**没点名**的对照。
 * 为什么不用写死的 `.ts`/`.go`：那是拿本机装了什么当判据（换台机器就假红/假绿）。
 */
function pickTwoLanguages(): { a: string; b: string; aLang: string; bLang: string } {
  const seen = new Set<string>();
  const picked: Array<{ ext: string; lang: string }> = [];
  for (const ext of listSupportedExts()) {
    const lang = findLanguageByExt(ext);
    if (!lang || seen.has(lang.name)) continue;
    seen.add(lang.name);
    picked.push({ ext, lang: lang.name });
    if (picked.length === 2) break;
  }
  assert.equal(picked.length, 2, '本机至少要能载入两门语言才谈得上"点名 vs 没点名"（实得 ' + picked.length + '）');
  return { a: picked[0].ext, b: picked[1].ext, aLang: picked[0].lang, bLang: picked[1].lang };
}

/**
 * 造一个**自己的**项目：索引里只有 `src/a.ts` 一行 ⇒ 项目事实 = `['.ts']`。
 * 为什么不用本仓自己的 `.agent-io/cache.db`：那要依赖"跑测试的机器上恰好有索引"，
 * 换成自造索引 ⇒ 判据只依赖被检代码（QW-2 的取数口），不依赖环境。
 */
function makeProjectWithIndex(): { dir: string; dispose: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootlat-proj-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf-8');
  const db = getProjectCacheDb(dir);
  const now = Date.now();
  db.prepare(
    'INSERT OR REPLACE INTO files(path, content_hash, language, size, modified_at, indexed_at, node_count) VALUES (?,?,?,?,?,?,?)',
  ).run('src/a.ts', 'h-bootlat', 'typescript', 20, now, now, 0);
  closeProjectCacheDb(dir);
  return {
    dir,
    dispose: () => {
      closeProjectCacheDb(dir);
      rmDirQuiet(dir);
    },
  };
}

function rmDirQuiet(dir: string): void {
  for (let i = 0; i < 3; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      /* Windows 句柄还没放干净 —— 再试一次；实在不行留给系统临时目录 */
    }
  }
}

/** 跑一次真 CLI（每次都是新进程 ⇒ "冷"在这里就是"进程第一眼"），返回墙钟毫秒与两端输出 */
function runCli(args: string[], cwd = ROOT): { ms: number; rc: number | null; out: string; err: string } {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return {
    ms,
    rc: r.status,
    out: (r.stdout ?? Buffer.alloc(0)).toString('utf8'),
    err: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
  };
}

/** 裸 `node -e ""` 的墙钟（地板的量法：与 `--help` 用同一条 spawnSync 通道才可比） */
function runBareNode(): number {
  const t0 = process.hrtime.bigint();
  spawnSync(process.execPath, ['-e', ''], { cwd: ROOT, encoding: 'buffer' });
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

// ─────────────────────────────────────────────────────────────
// QW-1 · 惰性 ajv（"从不校验 DSL 的工具不再为编译器付钱"）
// ─────────────────────────────────────────────────────────────

test('QW-1 · import `validator.ts` 不在模块加载期拉起 ajv（顶层 compile ⇒ 立刻红）', () => {
  assert.equal(ajvLoaded(), false, '`validator.ts` 已被 import ⇒ 此刻 CJS 缓存里**不该**有 ajv（实得：有）');
});

test('QW-1 · 第一次真校验才加载 ajv，且校验结论/错误键与懒化前一致', () => {
  const r = validator.validateDSL({});
  assert.equal(r.valid, false, '空对象不是合法 DSL（懒化不许把校验变成恒真）');
  assert.ok(r.errors.length > 0, '必须有可读错误，实得 ' + JSON.stringify(r.errors));
  assert.equal(r.errors.length, r.keys.length, 'errors 与 keys 同长同序');
  assert.equal(ajvLoaded(), true, '第一次校验之后 ajv **必须**已被加载（懒化不许变成不加载）');

  // 第二次走的是同一个已编译实例（`ajv` 只编译一次：再校验一次结论稳定）
  const again = validator.validateDSL({});
  assert.deepEqual(again.errors, r.errors, '同一输入的第二次校验结论必须逐字相同（编译实例复用）');
});

// ─────────────────────────────────────────────────────────────
// QW-2 · 按需 prewarm（点名谁才建谁）
// ─────────────────────────────────────────────────────────────

test('QW-2 · prewarmExts 只建点名的语言；没点名的**仍是冷的**（回退成全量 ⇒ 此条红）', async () => {
  const { a, b, aLang, bLang } = pickTwoLanguages();
  clearLoaderCache();
  assert.equal(parserReadyForFile('x' + a), false, '前提：清缓存后 ' + a + ' 不就绪');
  assert.equal(parserReadyForFile('x' + b), false, '前提：清缓存后 ' + b + ' 不就绪');

  const r = await prewarmExts([a]);
  assert.ok(r.warmed.includes(a), `${aLang} 的 ${a} 必须建好，实得 warmed=${JSON.stringify(r.warmed)}`);

  assert.equal(parserReadyForFile('x' + a), true, `点名的 ${a} 必须就绪（write_gate 的预热闸用同一把尺）`);
  assert.equal(canParseFileSync('x' + a), true, `canParseFileSync(${a}) 与就绪同值`);
  assert.equal(
    parserReadyForFile('x' + b),
    false,
    `没点名的 ${bLang}（${b}）**不许**被顺手建好 —— 建好了 = 又在无条件全量预热`,
  );
  assert.equal(canParseFileSync('x' + b), false, `canParseFileSync(${b}) 如实=false（未预到 ⇒ 落 L1b 登记）`);
  assert.ok(!parserCacheExts().includes(b), `Parser 缓存里不该出现 ${b}，实得 ${JSON.stringify(parserCacheExts())}`);
});

test('QW-2 · 对照：prewarmKernel() 仍是**全量**（按需不许把全量也改懒）', async () => {
  const { b, bLang } = pickTwoLanguages();
  clearLoaderCache();
  assert.equal(parserReadyForFile('x' + b), false, '前提：清缓存后 ' + b + ' 不就绪');
  const r = await prewarmKernel();
  assert.ok(r.warmed > 1, '全量预热必须建多个 Parser，实得 warmed=' + r.warmed);
  assert.equal(parserReadyForFile('x' + b), true, `全量预热后 ${bLang}（${b}）必须就绪`);
  assert.ok(parserCacheExts().length > 1, '全量预热后缓存里必须有多门语言');
});

test('QW-2 · projectParserExts 从索引取「本项目真有哪几门」；无上下文 ⇒ null（退回全量的唯一信号）', () => {
  const proj = makeProjectWithIndex();
  try {
    const exts = projectParserExts(proj.dir);
    assert.deepEqual(exts, ['.ts'], '项目事实 = 索引里的源码后缀（实得 ' + JSON.stringify(exts) + '）');
    assert.deepEqual(
      projectParserExts(proj.dir),
      exts,
      '第二次问必须同值（进程内缓存不许给出第二份答案）',
    );

    assert.equal(projectParserExts(null), null, '没有项目根 ⇒ null（调用方据此退回全量，不许静默按 0 门跑）');
    const noIndex = fs.mkdtempSync(path.join(os.tmpdir(), 'bootlat-noindex-'));
    try {
      assert.equal(projectParserExts(noIndex), null, '有目录但没有索引 ⇒ null（空目录 ≠ 没有源码）');
      assert.equal(fs.existsSync(path.join(noIndex, '.agent-io', 'cache.db')), false, '取数**不许**顺手造一个空 cache.db');
    } finally {
      rmDirQuiet(noIndex);
    }
  } finally {
    proj.dispose();
  }
});

test('QW-2 · 端到端：一次真 CLI 调用的预热是「按需」那行，不是名册口径那行（回退 ⇒ 红）', () => {
  assert.equal(fs.existsSync(CLI), true, '缺 ' + CLI + ' ⇒ 先 npm run build（本用例跑 dist，与 MCP 同一份产物）');
  const proj = makeProjectWithIndex();
  try {
    const r = runCli(['ledger', 'action=list', 'project_dir=' + proj.dir], proj.dir);
    assert.match(r.err, /\[ts_kernel\] prewarm\(按需\)/, 'stderr 里必须有按需预热那行，实得：' + r.err.slice(-400));
    assert.doesNotMatch(
      r.err,
      /\[ts_kernel\] prewarm: 可解析语言/,
      '拿得到项目事实时**不许**走全量（出现名册口径那行 = 退回了 55 门全量预热）',
    );
    const m = /新建 (\d+) 个 Parser/.exec(r.err);
    assert.ok(m, '按需那行必须报"新建了几个 Parser"（读数是给人看的，判据看下一行）：' + r.err.slice(-200));
    assert.ok(
      Number(m[1]) <= 4,
      '索引里只有 .ts 一个后缀 ⇒ 最多建同一门语言的那几个 Parser，实得 ' + m[1] + ' 个（=又全量了）',
    );
    assert.match(r.err, /\.ts/, '点名集合里必须有 .ts，实得：' + r.err.slice(-200));
  } finally {
    proj.dispose();
  }
});

// ─────────────────────────────────────────────────────────────
// 计时（预算/天花板；判据的牙在上面那批机制用例里，这里守"别退回去"）
// ─────────────────────────────────────────────────────────────

test('QW-1+QW-2 · 启动预算：--help 冷 ≤ 裸 node 地板 + 820 ms；失败的调用只多 ≤210 ms', () => {
  assert.equal(fs.existsSync(CLI), true, '缺 ' + CLI + ' ⇒ 先 npm run build');

  const floor = [0, 1, 2].map(() => runBareNode());
  const help = [0, 1, 2].map(() => runCli(['--help']).ms);
  // 一次**必然失败**的调用：`action=trace` 不是 observe 的动作（参数在 handler 里被拒）
  const fail = [0, 1, 2].map(() => {
    const r = runCli(['observe', 'action=trace']);
    assert.notEqual(r.rc, 0, '前提：这次调用必须真的失败（rc≠0），实得 rc=' + r.rc);
    return r.ms;
  });

  const floorMs = Math.min(...floor);
  const helpMs = Math.min(...help);
  const failMs = Math.min(...fail);

  // ★ 上限按"裸 node 地板 + 余量"表述：机器快慢体现在地板里，固定读数不跨机器搬运。
  assert.ok(
    helpMs - floorMs <= 820,
    `cli.js --help 超出启动预算：${Math.round(helpMs)}ms（地板 ${Math.round(floorMs)}ms，余量 ${Math.round(
      helpMs - floorMs,
    )}ms > 820ms）⇒ ESM 图/惰性 ajv 有回退`,
  );
  // ★ 失败调用 − --help = **每次调用为预热付的钱**（普查口径 384 ms；按需后应为两位数毫秒）
  assert.ok(
    failMs - helpMs <= 210,
    `每次调用的预热税超出预算：${Math.round(failMs - helpMs)}ms（失败调用 ${Math.round(failMs)}ms − --help ${Math.round(
      helpMs,
    )}ms > 210ms）⇒ 按需预热有回退`,
  );
});
