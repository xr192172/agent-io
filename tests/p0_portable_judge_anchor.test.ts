/**
 * P0 · **judge 的路径锚必须可移植**（改前：`design_line action=judge` 的 root 取 `dsl.source_root`）。
 *
 * ## 病（改前实测，夹具四态见下）
 * 册里 `source_root` 存的是**写册那台机器**的绝对路径（本仓三册都是 `D:\agentio\dev\agent-io`）。
 * 别的机器上 ⇒ `path.join(root, e.path)` 指向不存在的文件、`checkStaleBuild(root)` 读不到 `<root>/src`、
 * `scripts/judge-all.mjs` 的根守卫与自己的 `ROOT` 不重合 ⇒ **三册全红**。
 * 本机之所以 10/10 全绿，**只是因为 win32 下那两个字符串恰好相等** —— 这道门从没在别的机器上跑绿过。
 *
 * ## 本证断言什么（四条，都在同一个夹具里跑）
 *   ① **改后绿**：册里留着异机绝对路径 `source_root`，判据仍然按**调用方给的 `project_dir`** 判 ⇒ exit 0 且 `pass=1`；
 *   ② **对照 A（去 source_root）**：同样绿 —— 证明绿不是"恰好相等"，而是锚根本不看册里那台机器；
 *   ③ **对照 B（把 `src/foo.ts` 改名）**：红，且**红在判据上**（`fail:n0`），**不是**红在册守卫上
 *      ⇒ 证明它真的在读夹具根（不是假绿）；
 *   ④ **对照 C（CLI 判的是另一份册）**：红，且报文点名「不是同一份」
 *      ⇒ 证明 `scripts/judge-all.mjs` 的守卫比的是**回执里的 `sheet`**（比 `root` 会恒过：`root` 现在恒等于
 *      本脚本传的 `'.'`，那样这条防线就静默消失了 —— 0.9「两把尺只能删第二把」）。
 *
 * ★ 纪律：夹具全在 `mkdtemp` 里造（`dist` 拷一份 + `node_modules` 用 junction），**绝不动真仓**；
 *   `finally` 里删 —— 实测 `fs.rmSync(recursive)` 对 junction 只删链接、不追进目标（见本卡回执）。
 * ★ 本证**不**复制 `dist` 之外的产物，也不写 `src/`：它断言的是"门读的是哪一份册/哪个根"，
 *   而不是"某句文案好看"（AGENTS-RULES 0.12）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmRf } from './helpers/i1_fixture.js';

/** 真仓（= 尺子的出处；也是"写册那台机器"的路径 —— 在本机上恰好重合，正是本证要绕开的东西） */
const REPO = path.resolve('.');
/** 「写册那台机器」的绝对路径（Windows 形态；在 posix 上是个根本不存在的相对名） */
const FOREIGN = 'D:/agentio/dev/agent-io';
const FEATURE = 'fake-book';

function w(p: string, s: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
}
function j(p: string, o: unknown): void {
  w(p, `${JSON.stringify(o, null, 2)}\n`);
}
/** 钉死 mtime（0.12 ②：门的输入不许是环境态 —— 这里钉的是 dist 新鲜度判据的输入） */
function pin(p: string, ms: number): void {
  fs.utimesSync(p, new Date(ms), new Date(ms));
}

/** 夹具册：一个 file 节点 + 一条 `file-exists src/foo.ts`（判据只看**夹具根**里有没有这个文件） */
function sheet(sourceRoot?: string): unknown {
  return {
    feature: FEATURE,
    ...(sourceRoot ? { source_root: sourceRoot } : {}),
    geometry: {
      nodes: [
        {
          id: 'n0',
          label: 'n0',
          type: 'file',
          path: 'src/foo.ts',
          decision: {
            expectations: [{ kind: 'file-exists', path: 'src/foo.ts', why: '夹具：判据只看夹具根里有没有这个文件' }],
          },
        },
      ],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  };
}

/** 跑夹具里的 `scripts/judge-all.mjs`（摘掉 NODE_TEST_CONTEXT：否则子进程 node --test 会当自己是被嵌套跑的） */
function runJudgeAll(root: string): { status: number | null; out: string } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'judge-all.mjs')], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...base, AGENT_IO_HOME: path.join(root, 'home') },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const tail = (s: string, n = 1800): string => (s.length <= n ? s : `…（截断，仅尾部）\n${s.slice(-n)}`);

test('judge 的路径锚：异机 source_root 不许左右判定（改后绿 / 去 source_root 仍绿 / 删文件必红 / 判的不是这份册必红）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-anchor-'));
  const foo = path.join(root, 'src', 'foo.ts');
  const sheetFile = path.join(root, '.agent-io', 'design', `${FEATURE}.dsl.json`);
  const registry = path.join(root, 'home', '.agent-io', 'projects.json');
  /** 注册表 = 「feature → 项目根」的唯一入口（CLI 就靠它定位册） */
  const pointCliAt = (target: string): void =>
    j(registry, {
      version: 1,
      features: {
        [FEATURE]: { project_root: target.replace(/\\/g, '/'), registered_at: new Date().toISOString(), registered_by: 'fixture' },
      },
    });

  try {
    // ── 夹具与真仓同形：dist（CLI 要整个编译树）+ judge-all.mjs + 被检查项目的 src/产物 + 册 + 注册表
    fs.cpSync(path.join(REPO, 'dist'), path.join(root, 'dist'), { recursive: true });
    // ★ 删掉构建清单 ⇒ dist 新鲜度走 mtime 兜底（basis=mtime），读数与本证关心的事无关、且必须确定
    fs.rmSync(path.join(root, 'dist', '.build-manifest.json'), { force: true });
    w(path.join(root, 'scripts', 'judge-all.mjs'), fs.readFileSync(path.join(REPO, 'scripts', 'judge-all.mjs'), 'utf8'));
    // ★★★ R75（2026-11-05）：`judge-all.mjs` 现在 import `./lib/heavy_lock.mjs`（重活排他锁的唯一实现）
    //   ⇒ **夹具必须连它的 import 闭包一起拷**，否则子进程一启动就 `ERR_MODULE_NOT_FOUND`。
    //   ★ 这条不是"为了让测试过"：**任何"把脚本整份拷进夹具"的证，都必须拷它新引的依赖** ——
    //     否则那个证测的就不再是这个脚本在真仓里的行为（实测：本行缺失时 status=1，红在 import，不在判据）。
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'scripts', 'lib', 'heavy_lock.mjs'), path.join(root, 'scripts', 'lib', 'heavy_lock.mjs'));
    // ★ ESM 不认 NODE_PATH ⇒ 用 junction 让 `dist/**` 的包解析走回真仓的 node_modules（只读，删夹具不追进去）
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    w(foo, 'export const a = 1;\n');
    w(path.join(root, 'dist', 'src', 'foo.js'), 'export const a = 1;\n');
    pin(foo, Date.now() - 600_000); // 源比产物旧 ⇒ 新鲜度判据（stale_check）不掺进来
    pin(path.join(root, 'dist', 'src', 'foo.js'), Date.now());
    j(sheetFile, sheet(FOREIGN));
    pointCliAt(root);
    // 对照 C 用：另一份册 + 它自己的 src/foo.ts（判据这份现成满足 ⇒ 改前这里是**假绿**）
    j(path.join(root, 'decoy', '.agent-io', 'design', `${FEATURE}.dsl.json`), sheet());
    w(path.join(root, 'decoy', 'src', 'foo.ts'), 'export const a = 1;\n');

    // ── ① 改后绿：册里留着异机绝对路径，判定仍按调用方给的 project_dir
    const a = runJudgeAll(root);
    assert.equal(a.status, 0, `册里的异机 source_root 不许左右判定（exit 应 0）:\n${tail(a.out)}`);
    assert.match(a.out, /pass=1/, `应按夹具根判过 1 条:\n${tail(a.out)}`);
    assert.match(a.out, /0 册有红/, `应 0 册有红:\n${tail(a.out)}`);
    assert.doesNotMatch(
      a.out,
      /D:[\\/]agentio[\\/]dev[\\/]agent-io/,
      `判定读的**不许**是册里写的那台机器（出现 "${FOREIGN}" 就说明还在按 source_root 判）:\n${tail(a.out)}`,
    );

    // ── ② 对照 A：删掉 source_root ⇒ 同样绿（证明绿不是"两串恰好相等"）
    j(sheetFile, sheet());
    const b = runJudgeAll(root);
    assert.equal(b.status, 0, `去掉 source_root 后也应绿（否则说明锚还偷偷依赖它）:\n${tail(b.out)}`);
    assert.match(b.out, /pass=1/, `对照 A 应判过 1 条:\n${tail(b.out)}`);

    // ── ③ 对照 B：把 src/foo.ts 改名 ⇒ 必须红，且红在**判据**上（不是红在册守卫上）
    j(sheetFile, sheet(FOREIGN));
    fs.renameSync(foo, `${foo}.bak`);
    const c = runJudgeAll(root);
    assert.notEqual(c.status, 0, `夹具根里没有 src/foo.ts 时必须红:\n${tail(c.out)}`);
    assert.match(c.out, /fail:n0/, `必须红在判据上（fail:n0）:\n${tail(c.out)}`);
    assert.doesNotMatch(c.out, /不是同一份/, `这一态不许走"册不重合"那条路（那是另一条判据）:\n${tail(c.out)}`);

    // ── ④ 对照 C：CLI 判的**是另一份册**（注册表指到 decoy）⇒ 必须红，且点名「不是同一份」
    //    改前这里是**假绿**：守卫比 `root`，而 judge 的 root = 本脚本传的 `'.'` ⇒ 恒等 ⇒ 防线静默消失。
    fs.renameSync(`${foo}.bak`, foo);
    pin(foo, Date.now() - 600_000);
    pointCliAt(path.join(root, 'decoy'));
    const d = runJudgeAll(root);
    assert.notEqual(d.status, 0, `CLI 判的是另一份册时必须红（否则"副本里判绿"的防线又消失了）:\n${tail(d.out)}`);
    assert.match(d.out, /不是同一份/, `必须点名"判的不是这一份册"（比的是回执里的 sheet）:\n${tail(d.out)}`);
  } finally {
    rmRf(root);
  }
});
