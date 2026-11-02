/**
 * P0 · `edit_code` 的语法门必须**三态各自出声**（AGENTS-RULES 0.12：失败与「没有」可区分）
 *
 * ## 改前红（已实测：%TEMP% 直跑本工具）
 * ① `.txt` / `.md` 这类**没有解析器**的文件：`parseAstRoot` 回 null ⇒ `hasError` 恒 false
 *    ⇒ 今天直接 `✓ 落盘`，回执**一个字都不提**它根本没验过语法（读端分不出「验过且干净」与「压根没验」）；
 * ② 基线本就脏的 `.ts`（错误区外追加一行合法代码）：今天**静默放行**，不点名「原本已有 N 处」。
 *
 * ## 四条断言各钉什么（改后必须全绿；③ 是回归护栏）
 * ① `.txt` ⇒ 不拦 + warnings/message 两侧都有「语法门未执行（.txt 无解析器），本次没有验语法」；
 * ② 基线脏 ⇒ 不拦 + 点名「原本已有 N 处语法错」；
 * ③ 基线干净 + 引入错 ⇒ **仍必须拦**，且磁盘逐字节等于改动前（改 ①② 不许把 ③ 放宽掉）；
 * ④ 脏→干净 ⇒ 说「已修复」而不是「未修复」（反方向也不许假读数）。
 *
 * 夹具不建 `.agent-io/` ⇒ 任务闸按「本项目不用任务系统」放行（与 `p0_edit_code_atomic_batch` 同款）；
 * `AGENT_IO_REQUIRE_PLAN=0` 只关**重写画布**闸（本文件验的是语法门，不是画布闸）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AGENT_IO_REQUIRE_PLAN = '0';

const { editCode } = await import('../src/application/refactor/edit/edit_code.js');

const ACTOR = 'subagent:test-syntax-gate';
/** 无解析器的回执文案（唯一住处 = `src/domain/syntax_gate.ts#syntaxNoParserNote`） */
const NO_PARSER_LINE = '语法门未执行（.txt 无解析器），本次没有验语法';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p0-syntax-gate-'));
}

function write(proj: string, rel: string, text: string): string {
  const abs = path.join(proj, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
  return abs;
}

async function replaceText(proj: string, rel: string, oldText: string, newText: string) {
  return editCode({
    project_dir: proj,
    file: rel,
    op: 'replace_text',
    old_text: oldText,
    new_text: newText,
    actor: ACTOR,
  });
}

/** `data.warnings` 里那一条**恰好一条**（同一条读数不许重复刷屏，也不许缺席） */
function warningMatching(warnings: string[] | undefined, re: RegExp): string {
  const hits = (warnings ?? []).filter((w) => re.test(w));
  assert.equal(hits.length, 1, `data.warnings 里应恰好有一条匹配 ${re}，实得 ${JSON.stringify(warnings)}`);
  return hits[0];
}

// ════════════════════════════════════════════════════════════════════
// ① 无解析器：不拦，但必须说「本次没有验语法」
// ════════════════════════════════════════════════════════════════════
test('① .txt（无解析器）⇒ 不拦，但 warnings 与 message 都必须说没验语法', async () => {
  const proj = mkProject();
  write(proj, 'src/note.txt', 'hello ( (( world )\n');
  const r = await replaceText(proj, 'src/note.txt', 'hello', 'goodbye');
  assert.equal(r.data.written, true, '无解析器不该拦（否则 .md/.txt 的合法编辑全废）');
  assert.equal(warningMatching(r.data.warnings, /语法门未执行/), NO_PARSER_LINE);
  assert.ok(
    r.message.includes(NO_PARSER_LINE),
    `人读回执也必须说这句（否则「没验」被读成「验过且干净」）—— 实测回执：${r.message.slice(0, 400)}`,
  );
  assert.match(fs.readFileSync(path.join(proj, 'src/note.txt'), 'utf8'), /goodbye/, '不拦 = 真的落盘了');
});

// ════════════════════════════════════════════════════════════════════
// ② 基线脏：不拦，但必须点名「原本已有 N 处」
// ════════════════════════════════════════════════════════════════════
test('② 基线脏（错误区外追加合法代码）⇒ 不拦，但必须点名「原本已有 N 处语法错」', async () => {
  const proj = mkProject();
  const dirty = 'export function broken( {\n  return 1;\n}\n\nexport const keep = 1;\n';
  write(proj, 'src/dirty.ts', dirty);
  const r = await replaceText(proj, 'src/dirty.ts', 'export const keep = 1;', 'export const keep = 1;\nexport const added = 2;');
  assert.equal(r.data.written, true, '基线脏时不做逐处比对 ⇒ 不拦');
  const line = warningMatching(r.data.warnings, /原本已有 \d+ 处语法错/);
  assert.match(line, /原本已有 \d+ 处语法错；本次改动未修复也未新增/);
  assert.ok(r.message.includes(line), `人读回执必须点名那句「原本已有 N 处」—— 实测：${r.message.slice(0, 400)}`);
});

// ════════════════════════════════════════════════════════════════════
// ③ 回归护栏：基线干净 + 引入错 ⇒ 仍必须拦，且不写盘
// ════════════════════════════════════════════════════════════════════
test('③ 基线干净 + 引入语法错 ⇒ 仍必须拦（③ 是 ①② 的护栏，不许被放宽掉）', async () => {
  const proj = mkProject();
  const clean = 'export const ok = 1;\n';
  const abs = write(proj, 'src/clean.ts', clean);
  await assert.rejects(
    () => replaceText(proj, 'src/clean.ts', 'export const ok = 1;', 'export const ok = (1;'),
    /编辑引入了语法错误（hasError false→true）/,
  );
  assert.equal(fs.readFileSync(abs, 'utf8'), clean, '被拦的编辑**一个字节都不许落盘**');
});

// ════════════════════════════════════════════════════════════════════
// ④ 脏→干净：说「已修复」，不说「未修复」
// ════════════════════════════════════════════════════════════════════
test('④ 基线脏 + 本次修好 ⇒ 读数必须是「已修复」', async () => {
  const proj = mkProject();
  write(proj, 'src/fix.ts', 'export const bad = (1;\n');
  const r = await replaceText(proj, 'src/fix.ts', '(1;', '(1);');
  assert.equal(r.data.written, true);
  warningMatching(r.data.warnings, /原本已有 \d+ 处语法错，本次改动已修复/);
  assert.ok(
    r.message.includes('本次改动已修复'),
    `人读回执要认这次修好了（而不是笼统的「语法门通过」）—— 实测：${r.message.slice(0, 400)}`,
  );
});
