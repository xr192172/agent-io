/**
 * P0-3 · **文案里的 `docs/*.md` 必须存在**（`lint:prose` 规则 I 的双向 + 消融用例）。
 *
 * ## 它守的是哪一步
 * 三处"照它做"的指引都指旧版语言指南，而那份文件早在 `6f02c75b` 就被删了 ——
 * 于是 `lang_hint` / `behavior` / `install_package_cli` 的修法**全部指向空处**，而**门里没人喊**。
 * 规则 I 就是那道喊：`scripts/lint-prose-as-structure.mjs#checkDanglingDocRefs`（住 `lint:prose`，
 * 不新开门 ⇒ 与 E/F/G/H 共用一条退出码）。
 *
 * ## 用例（每一条都对应一个会真出错的形态）
 * | # | 输入 | 期望 |
 * |---|---|---|
 * | a | 文案指 `docs/gone.md`（不存在） | **红**（点名文件:行） |
 * | b | 文案指 `docs/here.md`（存在） | 绿 |
 * | c | **注释**里指 `docs/gone.md`（历史引述） | **绿**（判别域只到文案，0.17①） |
 * | d | 基线 `DOC_REF_ALLOW` 里的占位符 | 绿（按设计不存在，条目带 why） |
 * | e | 基线里某条**已不再被引用** | **红**（棘轮：账不许烂在原地） |
 * | f | 真仓现状 | 绿（>0 条引用 = 有效分母） |
 *
 * ★ a–d 用**临时根**：基线棘轮（`DOC_REF_ALLOW`）判的是**真仓那份账**，
 *   在临时根里它必然"没被引用" ⇒ 那几条基线噪音与 a–d 要验的事无关，过滤掉（e 专门验它）。
 *
 * ## 消融（真跑）
 * · 把 `checkDanglingDocRefs` 里的 `if (allow.has(ref)) { … continue; }` 删掉 ⇒ 用例 d 红（占位符被当悬空）；
 * · 把 `if (fs.existsSync(path.join(root, ref))) continue;` 改成恒 `continue` ⇒ 用例 a 红（a 不再报）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkDanglingDocRefs, DOC_REF_ALLOW } from '../scripts/lint-prose-as-structure.mjs';

/** 造一个只有 src/docs 的临时根（判定核只扫 `scripts/` + `src/`，见 `countScanTargets`） */
function mkRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-docref-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf-8');
  }
  return root;
}

function rm(root: string): void {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* 临时目录，清理是卫生不是断言 */
  }
}

/** 临时根里**不判基线棘轮**（那是真仓那份账的事，见文件头说明） */
const danglingOnly = (r: { problems: Array<{ file: string }> }) =>
  r.problems.filter((p) => p.file !== 'DOC_REF_ALLOW');

test('a 悬空引用 ⇒ 红（点名文件与行号）', () => {
  const root = mkRoot({
    'src/hint.ts': "export const msg = (): string => `补齐：照 docs/gone.md 改`;\n",
  });
  try {
    const r = checkDanglingDocRefs(root);
    const hit = danglingOnly(r);
    assert.equal(hit.length, 1, `应有 1 条悬空，实得 ${JSON.stringify(r.problems)}`);
    assert.equal((hit[0] as { rule: string }).rule, 'I');
    assert.match(hit[0].file, /hint\.ts$/);
    assert.equal((hit[0] as { line: number }).line, 1);
    assert.match((hit[0] as { msg: string }).msg, /docs\/gone\.md/);
    assert.equal(r.refs, 1, '分母要能看见（扫到几条引用）');
  } finally {
    rm(root);
  }
});

test('b 文档真的存在 ⇒ 绿（正向不缺）', () => {
  const root = mkRoot({
    'src/hint.ts': "export const msg = (): string => `照 docs/here.md 改`;\n",
    'docs/here.md': '# here\n',
  });
  try {
    const r = checkDanglingDocRefs(root);
    assert.equal(danglingOnly(r).length, 0, `不该有红：${JSON.stringify(r.problems)}`);
    assert.equal(r.refs, 1);
    assert.equal(r.scanned, 1);
  } finally {
    rm(root);
  }
});

test('c 注释里的历史引述 ⇒ 绿（判别域只到文案）', () => {
  const root = mkRoot({
    'src/hint.ts':
      '/** 病史：这里原先指 docs/gone.md，那篇已删。 */\n' +
      '// 同上：docs/gone.md\n' +
      "export const msg = (): string => 'ok';\n",
  });
  try {
    const r = checkDanglingDocRefs(root);
    assert.equal(danglingOnly(r).length, 0, `注释不算文案：${JSON.stringify(r.problems)}`);
    assert.equal(r.refs, 0, '剥注释后应当一条引用都不剩');
  } finally {
    rm(root);
  }
});

test('d 基线里的占位符 ⇒ 绿（按设计不存在）', () => {
  assert.ok(DOC_REF_ALLOW.length >= 1, '基线不该是空的（占位符 docs/xxx.md 在里面）');
  assert.ok(
    DOC_REF_ALLOW.every((a) => typeof a.why === 'string' && a.why.length > 10),
    '每条基线条目都要带 why（没有 why 的豁免就是"关灯"）',
  );
  const ref = DOC_REF_ALLOW[0].ref;
  const root = mkRoot({
    'src/hint.ts': `export const msg = (): string => '见 ${ref}:行号';\n`,
  });
  try {
    const r = checkDanglingDocRefs(root);
    assert.equal(danglingOnly(r).length, 0, `基线条目应放行：${JSON.stringify(r.problems)}`);
    assert.equal(r.refs, 1);
  } finally {
    rm(root);
  }
});

test('e 棘轮：基线条目已不再被引用 ⇒ 红（要求删条目）', () => {
  const root = mkRoot({ 'src/hint.ts': "export const msg = (): string => '无事';\n" });
  try {
    const r = checkDanglingDocRefs(root);
    const stale = r.problems.filter((p) => p.file === 'DOC_REF_ALLOW');
    assert.equal(stale.length, DOC_REF_ALLOW.length, `每条不再需要的基线都要报：${JSON.stringify(r.problems)}`);
    assert.match(stale[0].msg, /删掉/);
  } finally {
    rm(root);
  }
});

test('f 真仓现状：规则 I 在真仓上必须是绿的（否则就是"修了引用但判据没接上"）', () => {
  const r = checkDanglingDocRefs(process.cwd());
  assert.equal(r.problems.length, 0, `真仓有悬空文案引用：${JSON.stringify(r.problems.slice(0, 5), null, 2)}`);
  assert.ok(r.refs > 0, '真仓文案里应当有引用（>0 才是有效分母）');
});
