/**
 * P0 · `edit_code` 的 `targets[]` 批量形态**必须幂等**
 *
 * ## 它挡的事故（实测）
 * 一张卡的同一条 `edit_code` 批量命令被跑了两次 ⇒ **同一段代码被插入两次**（`old_text` 是 `new_text`
 * 的前缀，插入式替换：`A` → `A\nB`）。第二次应用时 `old_text` **仍在**（它正是上一次插进去那段的前缀）
 * ⇒ 定位成功 ⇒ 照常再插一遍。之后对那段的任何 `replace_text` 都变成「不唯一」⇒ 只能用一次性脚本绕过写核。
 *
 * 根因：`planReplaceText` 里那条 `already_applied` 判据（`classifyReplaceTextMiss`）**只在
 * `old_text` 找不到时**才被问 —— 插入式替换永远走不到它。
 *
 * ## 判据（两个方向都要，缺一条就等于没验 —— AGENTS-RULES 0.14）
 * · **同义必命中**：同一条 `targets[]` 连跑两次 ⇒ 第二次全部 `already_applied`、`applied:[]`、
 *   文件 **sha256 与行数都不变**；L3 按命中缩进重排过的形态也要认（排版不同 ≠ 内容不同）。
 * · **异义必不命中**：`new_text` 在文件里出现，但**不覆盖** `old_text` 的命中 ⇒ 不许判"已应用"
 *   （那是另一处文本）；文件里本来就有两处相同文本 ⇒ 仍必须报**歧义**、不许猜改。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ★ 临时夹具项目里没有画布（`tasks.db#plans`）—— 本文件验的是批量路的幂等判定，不是画布闸。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const { editCode } = await import('../src/application/refactor/edit/edit_code.js');

/** 造一个夹具项目（**不**建 `.agent-io/` —— 闸按"本项目不用任务系统"放行） */
function mkProject(files: Record<string, string>): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-batch-idem-'));
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

type Target = { file: string; old_text: string; new_text: string };

async function run(proj: string, targets: Target[]): Promise<Awaited<ReturnType<typeof editCode>>> {
  return editCode({ project_dir: proj, file: '', op: 'replace_text', targets, atomic: true, actor: 'subagent:batch0-1' });
}

test('① 插入式替换重复应用：第二次全部 already_applied、applied:[]、文件 sha256 不变', async () => {
  const rels = ['src/a.ts', 'src/b.ts'];
  const proj = mkProject({
    'src/a.ts': 'export const A = 1;\nexport const B = 2;\n',
    'src/b.ts': 'export const C = 3;\n',
  });
  try {
    // 三条都是**插入式**（new_text 严格包含 old_text）—— 这正是重复应用会插两遍的形态
    const targets: Target[] = [
      { file: rels[0], old_text: 'export const B = 2;', new_text: 'export const B = 2;\nexport const B2 = 4;' },
      { file: rels[0], old_text: 'export const A = 1;', new_text: 'export const A = 1;\nexport const A2 = 5;' },
      { file: rels[1], old_text: 'export const C = 3;', new_text: 'export const C = 3;\nexport const C2 = 6;' },
    ];

    const r1 = await run(proj, targets);
    assert.equal(r1.data.ok, true, r1.message);
    assert.deepEqual([...r1.data.applied].sort(), rels, '第一次必须真的写这两个文件');
    assert.equal(r1.data.already_applied, 0, '第一次一项都不该是"已应用过"');
    const after1 = digest(proj, rels);

    const r2 = await run(proj, targets);
    assert.equal(r2.data.ok, true, r2.message);
    assert.deepEqual(r2.data.applied, [], '★ 第二次必须一个文件都不写（改前：把同一段再插一遍）');
    assert.equal(r2.data.written, false, '★ 第二次 written 必须是 false');
    assert.equal(r2.data.already_applied, targets.length, '★ 第二次必须全部 already_applied');
    assert.equal(r2.data.failed, 0, '重复应用不是失败');
    for (const it of r2.data.items ?? []) {
      assert.ok(it.already_applied, `${it.file} 必须逐项点名 already_applied（不许只给一个 ✓）`);
      assert.equal(it.written, false, `${it.file} 第二次不许落盘`);
    }
    assert.deepEqual(digest(proj, rels), after1, '★ 第二次前后文件必须逐字节相同（sha256 + 行数）');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('② 同义必命中：上一次经 L3 按命中缩进重排过的形态，重跑仍判 already_applied', async () => {
  const rel = 'src/f.ts';
  const proj = mkProject({ [rel]: 'function f() {\n  foo();\n  bar();\n}\n' });
  try {
    // old/new 都是**去缩进**写法 ⇒ L1 不命中、L3 命中并按 `  ` 重排落盘
    const targets: Target[] = [
      { file: rel, old_text: 'foo();\nbar();', new_text: 'foo();\nbar();\nbaz();' },
    ];
    const r1 = await run(proj, targets);
    assert.equal(r1.data.items?.[0]?.hit?.level, 3, `第一次应走 L3（模糊命中）：${r1.message}`);
    assert.match(fs.readFileSync(path.join(proj, rel), 'utf8'), /\n {2}baz\(\);/, '第一次应按命中缩进重排');
    const after1 = digest(proj, [rel]);

    const r2 = await run(proj, targets);
    assert.deepEqual(r2.data.applied, [], '★ 重排形态也必须认成"已应用"（排版不同 ≠ 内容不同）');
    assert.equal(r2.data.items?.[0]?.already_applied?.how, 'inside-new-text', r2.message);
    assert.deepEqual(digest(proj, [rel]), after1, '★ 文件必须逐字节相同');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('③ 异义必不命中：new_text 在文件里但不覆盖 old 的命中 ⇒ 不许判已应用', async () => {
  const rel = 'src/a.ts';
  const proj = mkProject({ [rel]: 'export const B = 2;\nexport const C = 3;\n' });
  try {
    // `new_text`（C = 3 那行）**确实在文件里**，但它不覆盖 `old_text`（B = 2 那行）的命中
    // ⇒ 这是另一处文本，不是"上一次应用留下的痕迹" ⇒ 必须照常替换，不许跳过
    const r = await run(proj, [{ file: rel, old_text: 'export const B = 2;', new_text: 'export const C = 3;' }]);
    assert.equal(r.data.items?.[0]?.already_applied, undefined, '★ 不许误判"已应用"（那会让真改动静默丢失）');
    assert.deepEqual(r.data.applied, [rel], '必须真的写盘');
    assert.equal(fs.readFileSync(path.join(proj, rel), 'utf8'), 'export const C = 3;\nexport const C = 3;\n');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('④ 真歧义仍要拒：文件里本来就有两处相同文本 ⇒ 报不唯一、不写盘、不猜', async () => {
  const rel = 'src/b.ts';
  const body = 'const X = 1;\nconst X = 1;\n';
  const proj = mkProject({ [rel]: body });
  try {
    const r = await run(proj, [{ file: rel, old_text: 'const X = 1;', new_text: 'const X = 2;' }]);
    assert.equal(r.data.ok, false, '歧义 ⇒ 不是成功');
    assert.equal(r.data.failed, 1);
    assert.match(r.data.items?.[0]?.error ?? '', /不唯一/, '必须报歧义（不许为幂等把歧义检测放宽）');
    assert.equal(r.data.items?.[0]?.already_applied, undefined, '歧义不是"已应用"');
    assert.equal(fs.readFileSync(path.join(proj, rel), 'utf8'), body, '一个字节都不许改');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});
