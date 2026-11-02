/**
 * P0 · `edit_code` 的**单条** `replace_text` 形态**必须幂等**（`p0_edit_code_batch_idempotent` 的同族）
 *
 * ## 它挡的事故（实测）
 * 上一张卡（commit 88049ea0）修好了**批量** `targets[]` 的幂等，但**单条**形态没修 ——
 * 同一个机制的两个出口：插入式替换（`new_text` 严格包含 `old_text`，如 `A` → `A\nB`）重跑一次，
 * `old_text` **仍在**（它正是上一次插进去那段的前缀）⇒ 定位成功 ⇒ 照常**再插一遍**。
 * ⇒ "批量修好了、单条还漏"，同一份**静默制造重复代码**的机制。
 *
 * ## 根因（不是"没实现"）
 * `classifyReplaceTextApply` 只被批量的**规划循环**调用；单条 `replace_text` 直接进 `planReplaceText`，
 * 而那里只问 `classifyReplaceTextMiss`（只在 `old_text` 找不到时才被问）⇒ 插入式替换结构上到不了。
 *
 * ## 判据（两个方向都要，缺一条就等于没验 —— AGENTS-RULES 0.14）
 * · **同义必命中**：同一条 `replace_text` 连跑两次 ⇒ 第二次 `already_applied`、`written:false`、
 *   文件 **sha256 与行数都不变**；L3 按命中缩进重排过的形态也要认（排版不同 ≠ 内容不同）。
 * · **异义必不命中**：`new_text` 在文件里但不覆盖 `old_text` 的命中 ⇒ 必须照常写盘（那是另一处文本）；
 *   文件里本来就有两处相同文本 ⇒ 仍必须报**歧义**；old/new 都不在文件里 ⇒ 仍必须报**未找到**
 *   （不许把"没找到"当"已应用"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ★ 临时夹具项目里没有画布（`tasks.db#plans`）—— 本文件验的是单条路的幂等判定，不是画布闸。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const { editCode } = await import('../src/application/refactor/edit/edit_code.js');
// ★ 落盘会按项目根开一个 `cache.db`（进程级缓存）。Windows 上句柄没关 ⇒ 删目录报 EBUSY
//   （那不是"测试绿不绿"的问题，是夹具在删一个自己还开着的文件）⇒ 先关再删，**不许**用重试把它藏掉。
const { closeAllProjectCacheDbs } = await import('../src/infrastructure/index/db.js');

function cleanup(proj: string): void {
  closeAllProjectCacheDbs();
  fs.rmSync(proj, { recursive: true, force: true });
}

/** 造一个夹具项目（**不**建 `.agent-io/` —— 闸按"本项目不用任务系统"放行） */
function mkProject(files: Record<string, string>): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-single-idem-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(proj, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return proj;
}

/** 逐文件 sha256 + 行数（"字节没变"的判据只看这个，不看 mtime） */
function digest(proj: string, rels: string[]): Record<string, string> {
  return Object.fromEntries(
    rels.map((rel) => {
      const buf = fs.readFileSync(path.join(proj, rel));
      const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
      return [rel, `${sha}/L${buf.toString('utf8').split(/\r?\n/).length}`];
    }),
  );
}

/** 单条 `replace_text`（★ 本文件验的就是这一侧；批量那侧由 `p0_edit_code_batch_idempotent` 守） */
async function single(proj: string, rel: string, oldText: string, newText: string) {
  return editCode({
    project_dir: proj,
    file: rel,
    op: 'replace_text',
    old_text: oldText,
    new_text: newText,
    actor: 'subagent:batch0-3',
  });
}

test('① 单条重跑（old⊂new）：第二次 already_applied、written:false、文件 sha256 不变', async () => {
  const rel = 'src/a.ts';
  const proj = mkProject({ [rel]: 'export const A = 1;\n' });
  try {
    // 插入式替换：new_text 严格包含 old_text —— 这正是重复应用会插两遍的形态
    const oldText = 'export const A = 1;';
    const newText = 'export const A = 1;\nexport const B = 2;';

    const r1 = await single(proj, rel, oldText, newText);
    assert.equal(r1.data.written, true, `第一次必须真的写盘：${r1.message}`);
    assert.equal(r1.data.already_applied, undefined, '第一次不许是"已应用过"');
    const after1 = digest(proj, [rel]);
    assert.equal(fs.readFileSync(path.join(proj, rel), 'utf8'), `${newText}\n`);

    const r2 = await single(proj, rel, oldText, newText);
    assert.equal(r2.data.written, false, `★ 第二次必须不写盘（改前：把同一段再插一遍）\n${r2.message}`);
    assert.deepEqual(
      r2.data.already_applied,
      { line: 1, how: 'inside-new-text' },
      `★ 第二次必须给出 already_applied 判据（逐条点名行号与依据）：${r2.message}`,
    );
    assert.equal(r2.data.no_op, undefined, '"已应用过"与"空操作"是两件事（不许混成一个字段）');
    assert.deepEqual(digest(proj, [rel]), after1, '★ 第二次前后文件必须逐字节相同（sha256 + 行数）');
    assert.equal(
      fs.readFileSync(path.join(proj, rel), 'utf8').match(/export const B = 2;/g)?.length,
      1,
      '★ 同一段代码只许出现一次（改前是两遍）',
    );
  } finally {
    cleanup(proj);
  }
});

test('② 同义必命中：上一次经 L3 按命中缩进重排过的形态，单条重跑仍判 already_applied', async () => {
  const rel = 'src/f.ts';
  const proj = mkProject({ [rel]: 'function f() {\n  foo();\n  bar();\n}\n' });
  try {
    // old/new 都是**去缩进**写法 ⇒ L1 不命中、L3 命中并按 `  ` 重排落盘
    const oldText = 'foo();\nbar();';
    const newText = 'foo();\nbar();\nbaz();';
    const r1 = await single(proj, rel, oldText, newText);
    assert.equal(r1.data.hit?.level, 3, `第一次应走 L3（模糊命中）：${r1.message}`);
    assert.match(fs.readFileSync(path.join(proj, rel), 'utf8'), /\n {2}baz\(\);/, '第一次应按命中缩进重排');
    const after1 = digest(proj, [rel]);

    const r2 = await single(proj, rel, oldText, newText);
    assert.equal(r2.data.written, false, `★ 重排形态也必须认成"已应用"（排版不同 ≠ 内容不同）\n${r2.message}`);
    assert.equal((r2.data.already_applied as { how?: string } | undefined)?.how, 'inside-new-text', r2.message);
    assert.deepEqual(digest(proj, [rel]), after1, '★ 文件必须逐字节相同');
  } finally {
    cleanup(proj);
  }
});

test('③ 异义必不命中：new_text 在文件里但不覆盖 old 的命中 ⇒ 必须照常写盘', async () => {
  const rel = 'src/a.ts';
  const body = 'export const B = 2;\nexport const C = 3;\n';
  const proj = mkProject({ [rel]: body });
  try {
    // `new_text`（C = 3 那行）**确实在文件里**，但它不覆盖 `old_text`（B = 2 那行）的命中
    // ⇒ 这是另一处文本，不是"上一次应用留下的痕迹" ⇒ 必须照常替换，不许跳过
    const r = await single(proj, rel, 'export const B = 2;', 'export const C = 3;');
    assert.equal(r.data.already_applied, undefined, '★ 不许误判"已应用"（那会让真改动静默丢失）');
    assert.equal(r.data.written, true, r.message);
    assert.equal(
      fs.readFileSync(path.join(proj, rel), 'utf8'),
      'export const C = 3;\nexport const C = 3;\n',
      '必须真的写了',
    );
  } finally {
    cleanup(proj);
  }
});

test('④ 真歧义仍拒：文件里本来就两处相同文本 ⇒ 报不唯一、不写盘、不猜', async () => {
  const rel = 'src/b.ts';
  const body = 'const X = 1;\nconst X = 1;\n';
  const proj = mkProject({ [rel]: body });
  try {
    await assert.rejects(
      () => single(proj, rel, 'const X = 1;', 'const X = 2;'),
      /不唯一/,
      '必须报歧义（不许为幂等把歧义检测放宽）',
    );
    assert.equal(fs.readFileSync(path.join(proj, rel), 'utf8'), body, '一个字节都不许改');
  } finally {
    cleanup(proj);
  }
});

test('⑤ 真不匹配仍拒：old 与 new 都不在文件里 ⇒ 报未找到（不许把"没找到"当"已应用"）', async () => {
  const rel = 'src/c.ts';
  const body = 'export const K = 7;\n';
  const proj = mkProject({ [rel]: body });
  try {
    await assert.rejects(
      () => single(proj, rel, 'export const Z = 9;', 'export const Y = 8;'),
      /未找到 old_text/,
      '两边都没有 ⇒ 必须报 not_found，而不是 already_applied',
    );
    assert.equal(fs.readFileSync(path.join(proj, rel), 'utf8'), body, '一个字节都不许改');
  } finally {
    cleanup(proj);
  }
});

test('⑥ 一处权威：「该不该写盘」的判据在 edit_code.ts 里只有 1 个调用点，且落在 planReplaceText 里', () => {
  // ★ 这里"文本形状本身就是答案"（AGENTS.md §四的例外条款）：判据是"这条腿有几个调用点"，
  //   而**两个调用点正是本卡那个病的成因**（批量有、单条没有）⇒ 回到 2 处 = 分叉回来了。
  //   调用点用的是 `planReplaceText` 的形参名 `content`；批量当年那份私货叫 `classifyReplaceTextApply(cur, …)`
  //   —— 两个词各查一次：既数总数，又证明它只在汇合点、不在某个调用方里。
  const src = fs.readFileSync(new URL('../src/application/refactor/edit/edit_code.ts', import.meta.url), 'utf8');
  const calls = src.match(/classifyReplaceTextApply\(/g) ?? [];
  assert.equal(calls.length, 1, `判据只许有 1 个调用点（实际 ${calls.length} 处）—— 单条与批量必须共用同一条腿`);
  assert.equal(
    (src.match(/classifyReplaceTextApply\(content,/g) ?? []).length,
    1,
    '调用点必须在 `planReplaceText` 里（形参 `content`）—— 单条/批量/apply_refactor_plan 都经它',
  );
  assert.equal(
    (src.match(/classifyReplaceTextApply\(cur,/g) ?? []).length,
    0,
    '批量的私货调用（`cur`）必须删掉：它让单条那条路结构上到不了判据',
  );
});

