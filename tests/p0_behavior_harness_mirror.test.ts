/**
 * P0 · `behavior-cases` 的夹具：**tmp 是仓库相对镜像 + node_modules 是一条 junction**，
 * 且「搬不动就记名」不再静默跳过；E-CRIT-006 的说明符分档**双向**（`node:` 内置放行 / 真三方仍拒）。
 *
 * ## 它挡的事故（实测读数，不是推断）
 * 377 个 `src/` 文件逐个真跑 `runHarness`：含相对 import 的 319 个里 **256 个 load 失败**（成功率 20%）。
 * 三个结构性缺陷：
 * ① entry 只写 `target.mjs`（tmp 根）⇒ 闭包里环回 entry 的 `./project_registry.js` 解析不到；
 * ② 闭包映射 `join(dirname(tmpRel), spec)` **拍平在 tmp 根** ⇒ 二级 `../` 逃出根被**静默 `continue`**；
 * ③ tmp 里没有 `node_modules` ⇒ 三方包一律 `Cannot find package`。
 * 再加一条闸的（另一个 49%）：`text_strip.ts` 只按 `.` 前缀分档 ⇒ `node:fs` 被当成"拷不过去的裸包"
 * ⇒ 185/377 个文件连 behavior-cases 都写不进去，而 `node:` 内置在 tmp 里跑得绿。
 *
 * ## 六条断言（每条都真的跑被测代码）
 * ① **正例**：`src/infrastructure/project_registry.ts#normRoot` 的 behavior-cases ⇒ `pass`；
 * ② **反例**：把它尾斜杠剥离改坏（只改**临时副本**，不提交）⇒ 同一条判据变 `fail`
 *    （证明它真在跑被测代码，而不是回放一个常量）；
 * ③ **消融①**：同一说明符下「拍平 / 镜像」两种落盘，用真 node 解析器各跑一次 —— 拍平解析不到、镜像解析得到；
 * ④ **消融②**：同一目标、有/无 `node_modules` junction 各跑一次 —— 无 ⇒ `Cannot find package 'typescript'`，
 *    有 ⇒ load 成功（`top-level function not found` 是**加载之后**才说的话），且"没有 node_modules"进诊断；
 * ⑤ **闸双向**：`node:` 内置放行；`typescript` / `zod` / `ignore` 仍被 `E-CRIT-006` 拒；
 * ⑥ **静默跳过已改成记名**：解析不到的相对说明符出现在 error 的「夹具诊断」里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runHarness, harnessMirrorRel, harnessClosureRel } from '../src/infrastructure/authoring/behavior/index.js';
import { judgeExpectations } from '../src/application/design/intent/expectations.js';
import { assertValidExpectations } from '../src/domain/expectation.js';
import type { Expectation } from '../src/domain/expectation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 只读卡实测的返回值：`normRoot` 只做 `\`→`/` 与**去尾斜杠**，不折叠 `..` */
const NORM_ROOT_EXPECTATION: Expectation = {
  kind: 'behavior-cases',
  path: 'src/infrastructure/project_registry.ts',
  symbol: 'normRoot',
  cases: [{ given: ['D:/a/b/../c/'], expect: 'D:/a/b/../c' }],
  why: '路径归一必须只去尾斜杠、不动 `..`（折叠 `..` 会把 `a/b/../c` 错算成 `a/c`，那是另一个语义）',
};

/** 建临时项目根（调用方自己保证清理） */
function tmpDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bc-mirror-${tag}-`));
}

/** ★ Windows 上 `node_modules` 是 junction：**先摘链接再删目录**，否则递归删除可能跟着链接走 */
function dropTree(dir: string): void {
  const nm = path.join(dir, 'node_modules');
  try {
    if (fs.lstatSync(nm).isSymbolicLink()) fs.unlinkSync(nm);
  } catch {
    /* 没有链接 / 已不存在 */
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort：临时目录 */
  }
}

/** 让临时项目也能解析三方包（与夹具同一条做法：junction，Windows 必须是 'junction'） */
function linkRepoNodeModules(projectDir: string): void {
  const src = path.join(ROOT, 'node_modules');
  assert.ok(fs.existsSync(src), '本仓没有 node_modules ⇒ 消融②的"有 junction 那一向"无从成立');
  fs.symlinkSync(src, path.join(projectDir, 'node_modules'), 'junction');
}

/**
 * ★ #188 测试隔离：建**镜像临时工程**（整棵 src 副本 + node_modules junction），不拿主仓根当 project_dir。
 * 项目库跟 project_dir 走（项目本地）；用主仓根 ⇒ worker 写主仓 cache.db，与 judge-all 跨进程争写同一 WAL。
 * 调用方必须在 finally 里 `dropTree(proj)` 收尾。
 */
function makeMirrorProject(): string {
  const proj = tmpDir('mirror');
  fs.cpSync(path.join(ROOT, 'src'), path.join(proj, 'src'), { recursive: true });
  linkRepoNodeModules(proj);
  return proj;
}

test('① 正例：project_registry.ts#normRoot 的 behavior-cases 判 pass（夹具能加载跨目录闭包）', async () => {
  const proj = makeMirrorProject();
  try {
    const rep = await judgeExpectations(proj, [
      { node_id: 'probe-normRoot', node_label: 'probe', expectation: NORM_ROOT_EXPECTATION },
    ]);
    const item = rep.items[0];
    assert.equal(
      item.verdict,
      'pass',
      `normRoot 的行为判据没绿 ⇒ 夹具还是加载不了目标（detail=${item.detail}）`,
    );
    assert.match(item.detail, /1\/1 case 一致/, `判据没真跑满 case：${item.detail}`);
  } finally {
    dropTree(proj);
  }
});

test('② 反例：把 normRoot 的尾斜杠剥离改坏（临时副本，不提交）⇒ 同一条判据变 fail', async () => {
  const proj = makeMirrorProject();
  try {
    const target = path.join(proj, 'src', 'infrastructure', 'project_registry.ts');
    const before = fs.readFileSync(target, 'utf8');
    const after = before.replace("    .replace(/\\/+$/, '');\n", ';\n');
    assert.notEqual(after, before, '变异没落到 normRoot 的尾斜杠剥离那一行（锚点失配 ⇒ 反例无效）');
    fs.writeFileSync(target, after, 'utf8');

    const rep = await judgeExpectations(proj, [
      { node_id: 'probe-normRoot-mut', node_label: 'probe', expectation: NORM_ROOT_EXPECTATION },
    ]);
    const item = rep.items[0];
    // ★ 关键：必须是 fail（判据看着真代码），不是 unsupported（"判不了"冒充"抓到"）
    assert.equal(item.verdict, 'fail', `变异体上同一条判据没有变红（verdict=${item.verdict}，detail=${item.detail}）`);
    assert.match(item.detail, /行为差异/, `红的方式不像行为判据给的：${item.detail}`);

    // 还原后必须回到 pass（证明红是那颗变异带来的，不是环境）
    fs.writeFileSync(target, before, 'utf8');
    const rep2 = await judgeExpectations(proj, [
      { node_id: 'probe-normRoot-back', node_label: 'probe', expectation: NORM_ROOT_EXPECTATION },
    ]);
    assert.equal(rep2.items[0].verdict, 'pass', `还原后没回绿 ⇒ 前一次的 fail 不是变异造成的：${rep2.items[0].detail}`);
  } finally {
    dropTree(proj);
  }
});

test('③ 消融①：同一说明符「拍平 → 解析不到 / 镜像 → 解析得到」（真 node 解析器各跑一次）', async () => {
  // 纯函数层：拍平（entry 落 tmp 根叫 target.mjs）下 `../` 说明符必然越出镜像根 —— 旧代码就在这一步 continue 掉了
  assert.equal(
    harnessClosureRel('target.mjs', '../domain/task_schema.js'),
    null,
    '拍平口径下 `../x.js` 应当越出镜像根（= 旧夹具丢成员的那一支）',
  );
  // 镜像口径：同一说明符解析成镜像内的路径（目录层级原样）
  assert.equal(
    harnessClosureRel('src/application/claim_conflict.js', '../domain/task_schema.js'),
    'src/domain/task_schema.js',
    '镜像口径下同一说明符应落回仓库相对路径',
  );
  assert.equal(harnessMirrorRel('src/infrastructure/project_registry.ts'), 'src/infrastructure/project_registry.js');
  assert.equal(harnessMirrorRel('src\\domain\\a.mts'), 'src/domain/a.js');

  // 真解析器层：**同一份 entry 源码逐字相同**，只有「成员有没有按镜像落盘」这一个变量。
  // ★ 两个方向必须用**两棵树**：node 会缓存同一个 URL 的加载结果（第一次失败，第二次仍拿到同一个错误）。
  const tmp = tmpDir('ablate-flat');
  const ENTRY_SRC = "import { z } from '../domain/task_schema.js';\nexport const v = z;\n";
  const writeTree = (name: string, withMember: boolean): string => {
    const root = path.join(tmp, name);
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}', 'utf8');
    fs.mkdirSync(path.join(root, 'src', 'application'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'application', 'target.js'), ENTRY_SRC, 'utf8');
    if (withMember) {
      fs.mkdirSync(path.join(root, 'src', 'domain'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'domain', 'task_schema.js'), 'export const z = 42;\n', 'utf8');
    }
    return path.join(root, 'src', 'application', 'target.js');
  };
  try {
    // 拍平/丢失成员：`../domain/task_schema.js` 解析不到（= 今天的 unsupported 的真正原因）
    const flat = writeTree('flat', false);
    await assert.rejects(
      import(pathToFileURL(flat).href),
      /ERR_MODULE_NOT_FOUND|Cannot find module/,
      '成员没按镜像落盘时，同一说明符竟然解析到了 ⇒ 这条消融没有鉴别力',
    );

    // 镜像：成员落 `src/domain/task_schema.js` ⇒ 同一份 entry 立刻可加载
    const mirrored = writeTree('mirror', true);
    const mod = (await import(pathToFileURL(mirrored).href)) as { v: number };
    assert.equal(mod.v, 42, '镜像落盘后 entry 仍加载不到 ⇒ 镜像口径本身有问题');
  } finally {
    dropTree(tmp);
  }
});

test('④ 消融②：无 node_modules ⇒ 三方包要 Cannot find package（且"没链上"进诊断）；有 junction ⇒ load 成功', () => {
  const proj = tmpDir('ablate-junction');
  try {
    fs.writeFileSync(path.join(proj, 'probe.ts'), "import ts from 'typescript';\n\nexport function f(): number {\n  return ts.version.length;\n}\n", 'utf8');

    // 无 junction：三方包解析不到，**且**错误里能看出"项目根下没有 node_modules"（不是"包不存在"）
    const noLink = runHarness({ project_dir: proj, file: 'probe.ts', function: '__no_such_symbol__', cases: [], timeout_ms: 30_000 });
    assert.match(String(noLink.error), /Cannot find package 'typescript'/, `无 junction 时不该加载成功：${noLink.error}`);
    assert.match(String(noLink.error), /没有 node_modules/, `"没链上"必须与"包不存在"可区分（夹具诊断不见了）：${noLink.error}`);

    // 有 junction：同一个文件 load 成功 —— 口号是「top-level function not found」，
    // 那是**加载之后**才说的话（模块没加载进来时说的是"目标文件加载失败"）
    linkRepoNodeModules(proj);
    const linked = runHarness({ project_dir: proj, file: 'probe.ts', function: '__no_such_symbol__', cases: [], timeout_ms: 30_000 });
    assert.match(String(linked.error), /top-level function not found/, `有 junction 仍加载失败 ⇒ junction 没生效：${linked.error}`);
  } finally {
    dropTree(proj);
  }
});

test('⑤ 闸双向：`node:` 内置放行，真三方（typescript / zod / ignore）仍被 E-CRIT-006 拒', () => {
  const judge = (src: string): string => {
    try {
      assertValidExpectations(
        [{ kind: 'behavior-cases', path: 'src/probe_target.ts', symbol: 'f', cases: [{ given: [1], expect: '1' }], why: 'probe' }],
        { readSource: () => src },
      );
      return 'accepted';
    } catch (e) {
      return String((e as Error).message);
    }
  };

  // 放行向：内置由 node 自己解析 ⇒ 能 load ⇒ 不许拒（否则 185/377 个文件写不进判据）
  assert.equal(judge("import fs from 'node:fs';\nexport function f() { return 1; }\n"), 'accepted', 'node: 内置被拒了');
  assert.equal(
    judge("import path from 'node:path';\nimport fs from 'node:fs';\nexport function f() { return 1; }\n"),
    'accepted',
    '多处 node: 内置被拒了',
  );
  // 相对 import 一向仍然放行（夹具拷闭包）
  assert.equal(judge("import { a } from './x.js';\nexport function f() { return a; }\n"), 'accepted', '相对 import 被拒了');

  // 拒绝向：真三方包 —— 三个都在 package.json 里，但"用户项目没装"这一档仍然拷不过去
  for (const pkg of ['typescript', 'zod', 'ignore']) {
    const msg = judge(`import { a } from '${pkg}';\nexport function f() { return a; }\n`);
    assert.match(msg, /E-CRIT-006/, `真三方 ${pkg} 没被拒 ⇒ 闸只是被"关掉"而不是被"分档"`);
  }
  // 混合形态：内置放行、真三方仍拒（两个方向同时钉住）
  const mixed = judge("import fs from 'node:fs';\nimport { a } from 'zod';\nexport function f() { return a; }\n");
  assert.match(mixed, /E-CRIT-006/, '混合形态里真三方那一处没被拒');
  assert.match(mixed, /node: 内置/, `报文该把"内置已放行"单列（否则用户会去抽 node:fs）：${mixed}`);
});

test('⑥ 静默跳过已改成记名：解析不到的相对说明符出现在「夹具诊断」里', () => {
  const proj = tmpDir('diag');
  try {
    fs.writeFileSync(path.join(proj, 'probe.ts'), "import { a } from './nope.js';\n\nexport function f() {\n  return a;\n}\n", 'utf8');
    const run = runHarness({ project_dir: proj, file: 'probe.ts', function: 'f', cases: [] });
    assert.ok(run.error, '缺成员时不该声称跑成功');
    assert.match(String(run.error), /夹具诊断/, `失败报文里没有诊断区（又回到静默跳过）：${run.error}`);
    assert.match(String(run.error), /nope\.js/, `诊断没点名缺了谁：${run.error}`);
  } finally {
    dropTree(proj);
  }
});
