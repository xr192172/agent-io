/**
 * P0 · **增量内环必须自报"未覆盖"**（2026-10-31 · 从 `certs/t354-incremental-verify-cert.mjs` 迁来）。
 *
 * ## 本文件**取代** `certs/t354-incremental-verify-cert.mjs`（已迁、已删）
 * 原证 T354 守的是「`scripts/verify-changed.mjs` 真的'改哪跑哪'」，它今天红在 ②/②'/④''
 * （判据退役后 `task_ops.ts` 的契约 29 → 0 条、`write_gate.ts` 30 → 1 条 ⇒ 那几条**读的是数字**）。
 * 迁进测试时只留**它还说得通的那个洞**，并把断言从「命中多少张」换成「**它有没有说真话**」——
 * 前者随判据数漂（判据一退役就变假红），后者不漂。
 *
 * ## 它挡的事故（0.12 在本仓的最后一处：静默失败 = 假绿的源头）
 * `verify-changed` 原来只报「命中 N 条契约 / M 张证」。改动集里**一条都没命中**的文件 ⇒ 读的人
 * 读成 **"这次没影响"**，而真相常常是 **"没有任何判据/证观察它"**。
 * 实测（2026-10-31）：退役 574 条判据把 `path` 载体抽空，改 `write_gate.ts`（契约 30 → 1 条）
 * 「看起来像没受影响」；`src/` 378 个文件里 **312 个**既无契约也无 touches 命中。
 * ⇒ 工具现在单列一节「未覆盖文件」+ `--json` 的 `uncovered[{file,why}]` + 分母 `covered/uncovered`。
 *
 * ## 三条断言（都不打"命中多少"，只打"有没有说真话"）
 *   ① 给一个**已知未覆盖**的文件 ⇒ `uncovered` 里**必须**有它，且 `why` 说清"无契约也无 touches"；
 *   ② 给一个**已覆盖**的文件 ⇒ `uncovered` 里**不得**有它（否则"什么都报"就没人读了）；
 *   ③ 分母齐全：`changed K · covered C · uncovered U`，且 **C+U=K**（0.12 ③：只给分子等于没验）。
 * ★ 另：① 顺带断言 **U>0 不判红**（`red === false`）—— 覆盖面是**存量状况**，判红会让内环天天红。
 *
 * ## 为什么必须 **spawn**（不能在本进程里 import 调函数）
 * 被证的是「**这个 CLI 的 `--json` 回执**说没说真话」：
 *   · `scripts/verify-changed.mjs` 是 **ESM 顶层直跑的脚本**（没有导出入口，`process.argv` / `process.exit`
 *     就是它的语义面：`--no-run` / `--json` 两个开关只在这里生效）；
 *   · 它 `import('../dist/…')`（`expectationPaths` / `judgeExpectations` / `planEvidenceRerun`）⇒
 *     同进程 import 会污染本进程的模块图，也让"CLI 少传了一个参数"这类错测不出来；
 *   · 它在自己内部 spawn 子证（第 ④ 步）⇒ 进程边界是**它的一部分**，绕过去就不是同一条路径。
 * ⇒ spawn + 读它自己的 JSON 回执（与 `tests/p0_evidence_plan.test.ts` ⑧ 同一手法）。
 * ★ 一律 `--no-run`（只算集合）：本文件不该顺手跑别的证；也免得"证 → 工具 → 证"自己调自己。
 * ★ 前提：`--no-run` 下不判期望 ⇒ **不需要 `dist`**（缺 `dist` 只是 `expectationPaths` 降级为就地取
 *   `path`，`uncovered` 的两条边都由 `path` / `touches` 算，读数不变）。
 *
 * ## 消融（★ 本文件必须能红 —— 2026-10-31 迁移时实测）
 *   把 `scripts/verify-changed.mjs` 里新加的 **`uncovered` 组装那几行**（`const uncovered = gitBroken ?…`）
 *   `//` 掉 ⇒ 本文件 **3/3 全红**（`uncoveredCount` / `coveredCount` 引用不到 ⇒ CLI 直接崩，JSON 都没有）；
 *   还原 ⇒ **3/3 全绿**。读数见 `docs/RETIRED.md` 里 t354 那行。
 *
 * ## 诚实清单（[未核]）
 *   · **`uncovered:null`（git 读不到改动集）这一支测不到**：要造"git 跑不起来"得改 cwd / 骗 PATH，
 *     会让同一进程里的其它读 git 的用例一起漂 —— 那一支只有读法（`git.ok=false` 时 `uncovered` 为
 *     `null`、人读那节打印「**没算**」），**没跑过**，如实标注；
 *   · **`tests/*.test.ts` 的 `touches:` 那一路今天是空断言**：`tests/` 里目前**一张都没写**
 *     `touches:` ⇒ 那条边只测到"没声明时不算覆盖"（本文件 ① 的 `why` 里那句 `33 个 tests 文件`），
 *     测不到"声明了就算覆盖"。要测它得先有 test 真的声明（别为了测而给本文件乱写 touches）；
 *   · 本文件**不写仓内任何文件**（`--no-run` 下 `verify-changed` 不落盘）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'scripts', 'verify-changed.mjs');

/**
 * ① 的夹具：**已知未被覆盖**的源文件（既不在任何 `expectations[].path`，也不在任何证/tests 的 `touches`）。
 * ★ 它哪天被覆盖了，① 会红 —— 那一刻的正确动作是**换一个仍未被覆盖的文件**（并更新本行注释），
 *   **不是**把断言改松：这条断言守的是"未覆盖必须被报出来"，不是"这个文件永远未覆盖"。
 *
 * ★★ 2026-11-18（T-#A8A9-CROSS-BOOK 批 15）：原夹具 `src/application/design/dsl_ops/node_ops.ts`
 *   **在这一天被覆盖了** —— 原因是批 15 把 `verify-changed` 的契约来源从"**只读计划册**"改成
 *   "**全部设计册**"（计划册从此 0 个 path 节点，只读它 ⇒ 契约维度静默归零，`p0_evidence_plan` ⑧ 抓到的）。
 *   agent-io 册里一直有 `node_ops.ts` 的契约 ⇒ 扫全册之后它不再是"未覆盖"。
 *   ⇒ 按本行注释的规矩换一个仍未被覆盖的 src 文件（同目录、同为 dsl_ops），断言一条没删。
 */
const UNCOVERED_FIXTURE = 'src/application/design/dsl_ops/api_ops.ts';
/** ② 的夹具：**已覆盖**（`src/domain/task_machine.ts` 有契约 `path` 命中，且多张证声明了 touches） */
const COVERED_FIXTURE = 'src/domain/task_machine.ts';

interface Receipt {
  changed: string[];
  git: { ok: boolean; errors: string[]; source: string };
  denominator: {
    changed: number;
    covered: number | null;
    uncovered: number | null;
    verified: number;
    skipped: number;
  };
  uncovered: Array<{ file: string; why: string }> | null;
  expectations: Array<{ node_id: string; kind: string; paths: string[]; why: string }>;
  certs_precise: number;
  red: boolean;
  nothingHit: boolean;
}

/**
 * 跑一次工具，取它自己的 `--json` 回执（**只取最后一行**：它可能在前面打降级提示）。
 * ★ 0.12：拿不到回执 ⇒ **响亮失败并贴原文尾巴**，绝不 `return {}` 假装"没有未覆盖"。
 */
function runTool(files: string[]): Receipt {
  let out = '';
  try {
    out = execFileSync(process.execPath, [TOOL, '--json', '--no-run', ...files], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    assert.fail(
      `前置失败：\`verify-changed --json --no-run ${files.join(' ')}\` 跑不起来（exit=${err.status ?? '?'}）\n` +
        `—— 拿不到回执 = 判不了，**不许当绿**（0.12）。前 5 行输出：\n` +
        `${String(err.stdout ?? '')}${String(err.stderr ?? '')}`.split(/\r?\n/).slice(0, 5).join('\n'),
    );
  }
  const last = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  let j: Receipt;
  try {
    j = JSON.parse(last) as Receipt;
  } catch {
    assert.fail(`回执不是 JSON（最后一行解析失败）⇒ 判不了 ≠ 通过（0.12）。最后一行：${last.slice(0, 300)}`);
  }
  assert.equal(j.git.ok, true, `本次是显式点名文件（不经 git）⇒ git.ok 必须为 true：${JSON.stringify(j.git)}`);
  return j;
}

test('P0-1 · 已知未覆盖的文件 ⇒ 必须出现在 uncovered，why 说清"无契约也无 touches"（且不判红）', () => {
  const r = runTool([UNCOVERED_FIXTURE]);
  assert.ok(Array.isArray(r.uncovered), `uncovered 必须是数组（null = 没算）：实测 ${JSON.stringify(r.uncovered)}`);
  const hit = r.uncovered.find((u) => u.file === UNCOVERED_FIXTURE);
  assert.ok(
    hit,
    `未覆盖的文件必须被逐条报出来：${UNCOVERED_FIXTURE} 不在 uncovered 里。` +
      `若它现在**已被**某条契约/证覆盖 ⇒ 本测试的夹具过期了（换一个仍未被覆盖的文件，别删这条断言）。` +
      `实测 uncovered=${JSON.stringify(r.uncovered)}`,
  );
  assert.match(hit.why, /无契约/, `why 必须点名"无契约"这一半：实测「${hit.why}」`);
  assert.match(hit.why, /无 touches/, `why 必须点名"无 touches"那一半：实测「${hit.why}」`);
  // ★ U>0 **不是红**：覆盖面是存量状况，判红会让内环天天红（内环被存量淹没已发生过）
  assert.equal(r.red, false, `U>0 时 red 必须为 false（它是报告不是闸）：实测 red=${r.red}`);
  assert.equal(r.denominator.uncovered, 1, `分母里的未覆盖数必须与清单一致：实测 ${r.denominator.uncovered}`);
});

test('P0-2 · 已覆盖的文件 ⇒ uncovered 里不得出现它（正体：不是"什么都报"）', () => {
  const r = runTool([COVERED_FIXTURE]);
  assert.ok(Array.isArray(r.uncovered), `uncovered 必须是数组：实测 ${JSON.stringify(r.uncovered)}`);
  assert.deepEqual(
    r.uncovered,
    [],
    `已覆盖的文件不许出现在 uncovered（否则这一节会退化成噪音）：实测 ${JSON.stringify(r.uncovered)}。` +
      `★ 若这里红了，先看 ${COVERED_FIXTURE} 的契约/证是不是被退役了 —— 那要换夹具，不是放宽断言`,
  );
  assert.equal(r.denominator.covered, 1, `分母里的覆盖数必须为 1：实测 ${r.denominator.covered}`);
});

test('P0-3 · 分母齐全：改动集 K / 覆盖 C / 未覆盖 U，且 C+U=K', () => {
  const r = runTool([COVERED_FIXTURE, UNCOVERED_FIXTURE]);
  const d = r.denominator;
  assert.equal(r.changed.length, 2, `改动集应为 2 个文件：实测 ${JSON.stringify(r.changed)}`);
  assert.equal(d.changed, 2, `denominator.changed 必须等于改动集：实测 ${d.changed}`);
  // ★ 0.12 ③：只给分子等于没验 ⇒ C 与 U 都必须给，且必须**数得出来**（不是 null）
  assert.equal(typeof d.covered, 'number', `denominator.covered 必须是数（null = 没算）：实测 ${d.covered}`);
  assert.equal(typeof d.uncovered, 'number', `denominator.uncovered 必须是数（null = 没算）：实测 ${d.uncovered}`);
  assert.equal(d.covered! + d.uncovered!, d.changed, `C+U 必须等于 K：${d.covered}+${d.uncovered}≠${d.changed}`);
  // 清单与分母是同一个事实的两个面：条数必须对得上
  assert.equal(r.uncovered!.length, d.uncovered, `uncovered[] 条数必须等于 denominator.uncovered：${r.uncovered!.length}≠${d.uncovered}`);
});
