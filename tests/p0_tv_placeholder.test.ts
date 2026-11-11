/**
 * P0 · 插桩占位符泄漏 —— `TV` 既是占位符又是**探针名/路径里会出现的子串**
 *
 * ## 它挡的事故（2026-11-11，judge-all 红绿不稳的元凶；审计已复现）
 * `instrument.ts` 的**表达式体箭头**出口探针，先把 `ret` 写成一个占位符，再
 * `exitLine.replace('TV', tvName)` 填真名。两个病叠加：
 * · `String.prototype.replace(<string>, …)` **只换第一处**；
 * · `TV` **不是**"不可能出现的子串" —— 文件名 / 目录名 / 探针名里都可能有它，且它们
 *   **排在 `ret` 前面**。
 * ⇒ 文件叫 `myTVfile.ts` 时：
 * ```
 * captureProbe("myTVfile.anon@L3C20.exit", { file: "myTVfile.ts", ret: TV, level: 'core' });
 *                 ^^^^ 被换掉的是这里（探针名）
 *                                                       ^^ 真正该换的留成了裸 TV
 * ```
 * ⇒ 生成代码引用**未定义变量** ⇒ 运行时 `TV is not defined` ⇒ **整模块加载失败**
 *   ⇒ 同一输入两次跑出不同结论（一次 supported、一次 unsupported）。
 *
 * ## 判据（"探针名含 TV"这个输入，修之前必须红）
 * ① **不崩**：`instrumentFile` 不抛、且真的注入了探针；
 * ② **探针名不被改写**：`sites` / 生成源码里的探针名逐字保留 `myTVfile.…`，且不含 `__cam_arrow`（临时变量名跑到探针名里 = 改写打偏了）；
 * ③ **无裸 `TV`**：把文件名/路径里的 `myTVfile` / `TVdir` 摘掉后，生成代码里**一个 `TV` 标识符都不许剩**（它就是 `TV is not defined` 的源头）；
 * ④ **占位符不泄漏**：`__TV_PLACEHOLDER__` 一个都不许出现在产物里（漏替换必须当场抛，不是悄悄落盘）；
 * ⑤ **产物仍是合法 TS**：用仓里的 parser 回读生成代码，`ERROR` 节点必须为 0（"修完能编译"不是靠人眼）。
 *
 * ## 为什么住 `npm test` 而不是册里的 `behavior-cases`
 * `instrument.ts` 有值 import（fs / tree-sitter / path）⇒ 不满足 `behavior-cases` 的零值 import 门槛。
 * 形态照 `tests/p0_replace_text_token_boundary.test.ts`：端到端夹具 + `npm test` 跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { instrumentFile } = await import('../src/infrastructure/analysis/observe/instrument.js');
const { parseAstRootSync } = await import('../src/infrastructure/parse/kernel.js');

/** 夹具源码：**表达式体箭头**（`=> expr`）是唯一会走"占位符"那条分支的形态，必须都在。 */
const SRC = [
  'export const twice = (a: number) => a * 2;',
  'export const idOf = (x: { id: string }) => x.id;',
  'export function blockBody(n: number): number { return n + 1; }',
  '',
].join('\n');

/** 造夹具项目（不建 `.agent-io/`：插桩只看 `projectRoot` 算相对路径，与任务系统无关） */
function mkProject(files: Record<string, string>): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-tv-placeholder-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(proj, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return proj;
}

/** 断言一条插桩结果满足 ①②③④⑤（`names` = 生成代码里"合法出现 TV"的词，如文件名/目录名）。 */
async function assertNoTvLeak(proj: string, rel: string, legalTvWords: string[]): Promise<string> {
  const abs = path.join(proj, rel);
  const r = await instrumentFile(abs, { write: false, projectRoot: proj });
  const code = r.content ?? '';

  // ① 不崩 + 真有注入
  assert.equal(r.error, undefined, `插桩不该报错，实得：${r.error}`);
  assert.ok(r.sites.length > 0, '夹具含表达式体箭头 ⇒ 必须至少有 enter/exit 探针');
  assert.ok(code.length > 0, '注入了探针就必须交出改写后的源码（content 为空 = 读数在中间层蒸发）');

  // ④ 占位符不泄漏（漏替换必须当场抛；这里再兜一层：产物里一个都不许有）
  assert.ok(!code.includes('__TV_PLACEHOLDER__'), '占位符泄漏进生成代码 ⇒ 漏替换没被拦住');

  // ③ 无裸 TV：先把"合法含有 TV 的词"（文件名 / 目录名）整体摘掉，剩下的 TV 就是裸标识符
  let stripped = code;
  for (const w of legalTvWords) stripped = stripped.split(w).join('');

  // ② 探针名不被改写：临时变量名 `__cam_arrow…` 只许出现在语句里，不许出现在探针名字符串里
  const probeNames = [...code.matchAll(/captureProbe\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  assert.ok(probeNames.length > 0, '生成代码里必须能读到探针名（否则下面的断言是空转）');
  for (const nm of probeNames) {
    assert.ok(!nm.includes('__cam_arrow'), `探针名被临时变量名改写（占位符打偏了）：${nm}`);
    assert.ok(!nm.includes('__TV_PLACEHOLDER__'), `探针名里残留占位符：${nm}`);
  }
  assert.ok(
    probeNames.some((nm) => nm.startsWith(`${path.basename(rel, path.extname(rel))}.`)),
    `探针名必须逐字保留模块基名（${path.basename(rel)} 的基名被改写了）：${probeNames.join(', ')}`,
  );
  // 台账（sites）与源码同源：台账里的探针名同样不许被改写
  for (const s of r.sites) {
    assert.ok(!String(s.probe).includes('__cam_arrow'), `台账探针名被改写：${s.probe}`);
  }

  // ③（续）摘掉合法词之后，一个 `TV` 标识符都不许剩 —— 它就是 `TV is not defined` 的源头
  assert.ok(
    !/\bTV\b/.test(stripped),
    `生成代码里残留裸 \`TV\`（运行时会 \`TV is not defined\`）：\n${stripped.slice(0, 600)}`,
  );

  // ⑤ 产物仍是合法 TS：parser 回读不允许有 ERROR 节点
  const parsed = parseAstRootSync(abs, code);
  assert.ok(parsed, '生成代码必须能被 parser 解析（解析不了说明产物已坏）');
  const errs: string[] = [];
  const walk = (n: { type: string; hasError?: boolean; childCount: number; child: (i: number) => any }): void => {
    if (n.type === 'ERROR' || n.hasError) errs.push(n.type);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(parsed.root as any);
  assert.equal(errs.length, 0, `生成代码含语法错误节点：${errs.slice(0, 5).join(', ')}`);

  return code;
}

test('P0 占位符泄漏 · 文件名含 TV（myTVfile.ts）⇒ 不崩、探针名不被改写、无裸 TV', async () => {
  const proj = mkProject({ 'myTVfile.ts': SRC });
  try {
    const code = await assertNoTvLeak(proj, 'myTVfile.ts', ['myTVfile']);
    // 反向确认：夹具真的踩中了那条分支（否则本用例是空转）
    assert.ok(code.includes('const __cam_arrow'), '表达式体箭头必须走"临时变量 + ret 探针"那条分支');
    assert.ok(code.includes('ret: __cam_arrow'), 'ret 必须填成临时变量名（不是占位符、也不是裸名称）');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('P0 占位符泄漏 · 目录名含 TV（TVdir/app.ts）⇒ 路径那一处也不能被打偏', async () => {
  const proj = mkProject({ 'TVdir/app.ts': SRC });
  try {
    const code = await assertNoTvLeak(proj, 'TVdir/app.ts', ['TVdir']);
    // 反向确认：`file` 字段里的相对路径（含 TVdir）必须原样在生成代码里
    assert.ok(code.includes('TVdir/app.ts'), 'file 字段必须保留原始相对路径（含 TV 的目录名）');
    assert.ok(code.includes('ret: __cam_arrow'), 'ret 必须填成临时变量名');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});
