/**
 * p0_mutate_lock_window.test.ts —— 判据突变门的**竞态**证：锁必须包住「读输入」。
 *
 * ## 病（2026-11-02 实测两次假红）
 * `scripts/mutate.mjs` 的旧顺序是「先 `planMutants`（读 src、算出每条 before/after）**再** `acquireLock`」
 * ⇒ **计划窗口不在锁里**。另一次 mutate 的「写变异 → 判据 → 还原」窗口正好落在里面时，
 * `p.before` 拿到的是**别人变异中的临时内容**；执行到那条时比对当前内容不符
 * ⇒ 抛「在判据期间被别处改过」，而**同一次重跑就 PASS**（不重叠了）。
 * 两次实测：① 与 `manifest:check` 抢 `.agent-io/mutate.lock`；
 * ② `src/domain/behavior_compare.ts`（`git status` 干净、代理没碰它）。
 *
 * ## 本证把「竞态被真消掉」钉成可判（三条，全是真跑；不靠"重跑一次"）
 * ① **异义必拒**：装一个**活 pid** 的锁 ⇒ `runMutate` 必须抛「已有 mutate 在跑」。
 * ② **同义必放**（过期锁可回收）：装一个**死 pid** 的锁 ⇒ 必须照跑完，
 *    且跑完 `src/f.ts` **逐字节不变**、锁被清掉（证"没被别人的窗口污染"，也证还原真的发生）。
 * ③ ★ **因果的那一条（鉴别器）**：**活锁 + 一个不存在的册名**。
 *    · 锁在前 ⇒ 报**锁冲突**；
 *    · 读输入在前 ⇒ 报「找不到 …dsl.json」。
 *    ⇒ 把 `acquireLock` 挪回 `planMutants` 之后，本条**立刻变红**。
 *    ★ 对照组（无锁 + 同一个不存在的册名）必须报「找不到」—— 否则第 ③ 条是空断言
 *      （"两个错误都不出现"也能让 assert.rejects 变绿）。
 *
 * ## 为什么必须是一条**独立的证**而不是只写 source-has
 * source-has 只能证明"某两行文本的先后"。本证把同一个裁决放到**真跑**上：
 * 换掉顺序、或让 `acquireLock` 变成"先读后锁"，三条里至少一条红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MUTATE = path.join(ROOT, 'scripts', 'mutate.mjs');
/** ★ R75：锁的**唯一实现** —— ④⑤ 直接测它（verify / mutate / judge-all 都吃这一份语义） */
const HEAVY_LOCK = path.join(ROOT, 'scripts', 'lib', 'heavy_lock.mjs');

/** 夹具里的被测源码：体内有关系运算符与字符串字面量 ⇒ 不依赖 `dist/…/mutants.js` 也能算出变异点 */
const FIXTURE_SRC = `export function classify(a: number, b: number): string {
  if (a > b) return 'gt';
  return 'le';
}
`;

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

/** 夹具的册：一条 `behavior-cases`（唯一语义类样本来源） */
function fixtureSheet(): string {
  return JSON.stringify({
    id: 'fx',
    type: 'feature_diagram',
    feature: 'fx',
    geometry: {
      nodes: [
        {
          id: 'file_src_f_ts',
          type: 'file',
          label: 'f.ts',
          path: 'src/f.ts',
          decision: {
            summary: '夹具',
            expectations: [
              { kind: 'behavior-cases', path: 'src/f.ts', symbol: 'classify', cases: [{ given: [2, 1], expect: '"gt"' }], why: '夹具' },
            ],
          },
        },
      ],
    },
    semantic: { files: [{ id: 'file_src_f_ts', path: 'src/f.ts', responsibility: '夹具' }] },
  });
}

/**
 * 造一个能真跑 `runMutate` 的临时工程。
 * ★ `dist/…/expectations.js` 是**桩**：本证判的是「锁与读输入的先后」，不是判据本身
 *   （判据那层由 `mutate.mjs` 的 killed/survived 三态与 `tests/p0_mutate_is_real.test.ts` 负责）。
 */
function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-lock-'));
  fs.mkdirSync(path.join(dir, '.agent-io', 'design'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist', 'src', 'application', 'design', 'intent'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'dist', 'src', 'application', 'design', 'intent', 'expectations.js'),
    'export async function judgeExpectations(_root, list) {\n  return { items: (list || []).map(() => ({ verdict: "pass", detail: "stub" })) };\n}\n',
    'utf8',
  );
  fs.writeFileSync(path.join(dir, 'src', 'f.ts'), FIXTURE_SRC, 'utf8');
  fs.writeFileSync(path.join(dir, '.agent-io', 'design', 'fx.dsl.json'), fixtureSheet(), 'utf8');
  return dir;
}

/**
 * ★★★ R75（2026-11-05）：锁**从 `mutate.lock` 收归 `heavy.lock`**（唯一实现 = `scripts/lib/heavy_lock.mjs`，
 * verify / mutate / judge-all 共用一份），内容也从「一串 pid」变成 **JSON** `{pid, name, at, shared}`。
 * ⇒ 本证的三条**判据不变**（异义必拒 / 同义必放 / 鉴别器），只是夹具的落盘形状跟着改。
 * ★ 没有另写一份新证：锁语义的住处只有这一个文件（0.25② 入口数 +0）。
 */
const LOCK_OF = (dir: string): string => path.join(dir, '.agent-io', 'heavy.lock');

/** 装一个「活 pid」的锁（另起一个活进程，它的 pid 真的活着） */
function installLiveLock(dir: string): { pid: number; stop: () => void } {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  const pid = child.pid;
  assert.ok(typeof pid === 'number' && pid > 0, '夹具：起不出一个活进程 ⇒ 本证判不了（不是"通过"）');
  fs.mkdirSync(path.dirname(LOCK_OF(dir)), { recursive: true });
  fs.writeFileSync(LOCK_OF(dir), JSON.stringify({ pid, name: 'another-mutate', at: new Date().toISOString() }), 'utf8');
  return { pid, stop: () => { try { child.kill(); } catch { /* 已经退了 */ } } };
}

/** 装一个「死 pid」的锁（不可能存在的 pid ⇒ 必须被当成过期锁回收，且**响亮提示**） */
function installDeadLock(dir: string): void {
  fs.mkdirSync(path.dirname(LOCK_OF(dir)), { recursive: true });
  fs.writeFileSync(LOCK_OF(dir), JSON.stringify({ pid: 999999, name: 'dead-mutate', at: new Date().toISOString() }), 'utf8');
}

async function loadMutate(): Promise<{ runMutate: (feature: string, root: string, opts?: unknown) => Promise<{ ok: boolean; killed: number; survived: number; restored_files: string[] }> }> {
  return (await import(pathToFileURL(MUTATE).href)) as never;
}

test('P0-mutate-lock ①异义必拒：活 pid 的锁 ⇒ 必须抛「已有重活在跑」', async () => {
  const dir = makeFixture();
  const live = installLiveLock(dir);
  try {
    const { runMutate } = await loadMutate();
    await assert.rejects(
      () => runMutate('fx', dir, { n: 1 }),
      /已有重活在跑（another-mutate · pid \d+，锁 /,
      '活锁必须拒（并行会串 dist/ · judge-cache · cache.db，更会互相踩源码）',
    );
  } finally {
    live.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P0-mutate-lock ②同义必放：死 pid 的锁（过期锁）⇒ 照跑，且源码逐字节还原、锁被清掉', async () => {
  const dir = makeFixture();
  installDeadLock(dir);
  try {
    const { runMutate } = await loadMutate();
    const rep = await runMutate('fx', dir, { n: 1 });
    // ★ 不抛 = 过期锁被回收（不是"锁机制关掉了"：①那条证明活锁仍会拒）
    assert.equal(typeof rep.ok, 'boolean');
    assert.ok(rep.killed + rep.survived >= 1, '夹具必须真的跑过至少一条变异（否则本证是空跑：0 条被判定 ≠ 通过）');
    assert.deepEqual(rep.restored_files, ['src/f.ts'], '变异的那个文件必须被逐字节还原');
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'f.ts'), 'utf8'), FIXTURE_SRC, '还原后必须与原文逐字节一致');
    assert.equal(sha256(fs.readFileSync(path.join(dir, 'src', 'f.ts'), 'utf8')), sha256(FIXTURE_SRC));
    assert.equal(fs.existsSync(LOCK_OF(dir)), false, '正常收尾必须把锁清掉（否则下一次会被自己锁死）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P0-mutate-lock ③鉴别器：活锁 + 不存在的册 ⇒ 报锁冲突（证明锁早于读输入）；对照组报「找不到」', async () => {
  const { runMutate } = await loadMutate();

  // 对照组：**没有锁** + 不存在的册 ⇒ 计划阶段自己会报"找不到册"。
  //   ★ 没有这一条，第 ③ 条就是空断言（两种错误都不出现也能过）。
  {
    const dir = makeFixture();
    try {
      await assert.rejects(() => runMutate('no-such-feature', dir, { n: 1 }), /找不到 .*no-such-feature\.dsl\.json/);
      assert.equal(fs.existsSync(LOCK_OF(dir)), false, '对照组必须走完"取锁→读册失败→释放锁"，不许留锁');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 实验组：**活锁** + 同一个不存在的册 ⇒ 必须先撞锁。
  //   锁在前 ⇒ 锁冲突；读输入在前 ⇒ 「找不到 …dsl.json」⇒ 本条变红。
  {
    const dir = makeFixture();
    const live = installLiveLock(dir);
    try {
      await assert.rejects(
        () => runMutate('no-such-feature', dir, { n: 1 }),
        /已有重活在跑（another-mutate · pid \d+，锁 /,
        '★ 取锁必须先于读输入：报「找不到册」就说明 planMutants 又跑在锁外面了',
      );
    } finally {
      live.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ R75（2026-11-05）新增的两条 —— 它们测的是**锁本身**（`scripts/lib/heavy_lock.mjs`，唯一实现），
//   不是 `runMutate` 的接线（那是上面三条的事）。分开测的理由：这两条要说的是
//   「重活排他这件事的语义」，而 verify / judge-all 也吃同一份语义。
// ─────────────────────────────────────────────────────────────────────────────

test('P0-heavy-lock ④可重入：AGENT_IO_HEAVY_HOLDER 指向持有者 ⇒ 子孙放行，且不改写锁', async () => {
  const { acquireHeavyLock } = await import(pathToFileURL(HEAVY_LOCK).href);
  const dir = makeFixture();
  const live = installLiveLock(dir);
  const before = fs.readFileSync(LOCK_OF(dir), 'utf8');
  const oldEnv = process.env.AGENT_IO_HEAVY_HOLDER;
  try {
    // 模拟「我是 verify 的子进程」—— env 按进程树继承，天然只对子孙有效
    process.env.AGENT_IO_HEAVY_HOLDER = String(live.pid);
    const release = (acquireHeavyLock as (r: string, o: { name: string }) => () => void)(dir, { name: 'judge-all' });
    assert.equal(fs.readFileSync(LOCK_OF(dir), 'utf8'), before, '可重入必须**不改写**锁文件（否则会把祖先进程的锁替换成自己的 pid）');
    release();
    assert.equal(fs.existsSync(LOCK_OF(dir)), true, '可重入者的 release 不许删掉【祖先的】锁');
  } finally {
    if (oldEnv === undefined) delete process.env.AGENT_IO_HEAVY_HOLDER;
    else process.env.AGENT_IO_HEAVY_HOLDER = oldEnv;
    live.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P0-heavy-lock ⑤陈旧锁必须【响亮】：死 pid 的锁 ⇒ 有「陈旧重活锁」告警；活 pid 的锁 ⇒ 不许报陈旧', async () => {
  const { acquireHeavyLock } = await import(pathToFileURL(HEAVY_LOCK).href);
  const acquire = acquireHeavyLock as (r: string, o: { name: string }) => () => void;

  // ── 死 pid：必须接管，且**必须说出来**（mutate 会改 dist/ 再还原，SIGKILL 时不还原 ⇒ 地可能不干净）──
  {
    const dir = makeFixture();
    installDeadLock(dir);
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
    try {
      const release = acquire(dir, { name: 'mutate' });
      release();
    } finally {
      console.warn = orig;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.ok(warns.some((w) => /陈旧重活锁/.test(w)), '陈旧锁必须**响亮提示**，不许静默接管 —— 静默就在于下一个人以为地是干净的');
    assert.ok(warns.some((w) => /git status/.test(w)), '告警必须给出**正路**（先看一眼源码树），不只是"我接管了"');
  }

  // ── 活 pid：必须抛，且**不许**说"陈旧"（否则这条告警就成了永远亮的灯，0.16）──
  {
    const dir = makeFixture();
    const live = installLiveLock(dir);
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
    try {
      assert.throws(() => acquire(dir, { name: 'mutate' }), /已有重活在跑/);
    } finally {
      console.warn = orig;
      live.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(warns.some((w) => /陈旧重活锁/.test(w)), false, '活着的不许报"陈旧" —— 那会让真告警失去意义');
  }
});
