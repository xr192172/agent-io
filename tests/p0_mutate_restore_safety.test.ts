/**
 * ★ P0（DS-1R4 U-01/U-02/U-04）· 变异还原：**身份、失败即停、日志原子性与路径边界**。
 *
 * ## 病史（复核席实测，逐字）
 * ① **同内容两文件共用一份日志**：只拿原文 sha 当 id ⇒ `a.ts` 与 `b.ts` 原文相同就撞同一条日志；
 *    实测"`src/b.ts` 恢复成功、`src/a.ts` 仍停留在改坏状态"。
 * ② 恢复失败只 `console.error` 然后继续 → 下一轮在**未知残留**的树上测量。
 *
 * ## 本证断言什么（每条都双向）
 * 1. 同内容不同文件 ⇒ **各有独立日志**，两个都恢复（路径参与身份）。
 * 2. 同名不同目录、同内容/不同内容都覆盖。
 * 3. 恢复**任一失败**必须进 `failures`（不许返回"看起来无残留"的空结果），失败日志**保留**。
 * 4. 坏 JSON / 缺 orig / orig 的 sha 与元数据不符 / 路径越界（绝对路径、.. 逃逸）⇒ failure，且**不写盘**。
 * 5. 孤儿 `.orig`（无元数据）必须显式报出，不静默忽略。
 * 6. 原子性：`journalBegin` 返回时 `.orig` 与 `.json` 都已就位、无 `.tmp` 残留；
 *    同路径已有未销账日志 ⇒ `journalBegin` **拒绝**（不许覆盖掉真正的原文）。
 *
 * ## 消融（★ 必红）
 * · 把 id 改回"只用内容 sha" ⇒ 用例 1/2 红。
 * · 恢复遇错 `continue` 且不进 failures ⇒ 用例 3/4 红。
 * · 元数据先写、原文后写 ⇒ 用例 6 的原子性断言红（崩溃点会留下"有元数据、无原文"）。
 *
 * touches: scripts/mutate.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const sha = (b: Buffer | string): string => crypto.createHash('sha256').update(b).digest('hex');
const mod = await import(pathToFileURL(path.join(REPO, 'scripts', 'mutate.mjs')).href);

function mkTree(files: Record<string, string>): { root: string; put: (rel: string, body: string) => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds1r4-'));
  const put = (rel: string, body: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    const t = new Date('2026-01-01T00:00:00.000Z');
    fs.utimesSync(abs, t, t);
  };
  for (const [rel, body] of Object.entries(files)) put(rel, body);
  return { root, put };
}
const st = (f: string): { sha: string; mtimeMs: number } => ({ sha: sha(fs.readFileSync(f)), mtimeMs: fs.statSync(f).mtimeMs });
const entries = (root: string): string[] =>
  fs.existsSync(mod.journalDir(root)) ? fs.readdirSync(mod.journalDir(root)).sort() : [];

// ── U-01：身份必须含路径 ────────────────────────────────────────────────

test('U1-a 同内容两文件 ⇒ 各有独立日志，两个都恢复（改前：共用一条日志，只恢复一个）', () => {
  const same = 'export const v = 1;\n';
  const { root } = mkTree({ 'src/a.ts': same, 'src/b.ts': same });
  const a = path.join(root, 'src/a.ts');
  const b = path.join(root, 'src/b.ts');
  const beforeA = st(a);
  const beforeB = st(b);

  mod.journalBegin(root, a, fs.readFileSync(a), fs.statSync(a));
  mod.journalBegin(root, b, fs.readFileSync(b), fs.statSync(b));
  assert.equal(entries(root).filter((x) => x.endsWith('.json')).length, 2, '同内容不同文件必须有两条日志');

  fs.writeFileSync(a, 'export const v = 111;\n');
  fs.writeFileSync(b, 'export const v = 222;\n');
  // ★ DS-1C：真实时序是"写变异 → 立刻登记预期变异态"（否则恢复无法区分"我的变异"与"别人的新工作"）
  mod.journalExpect(root, a, sha(Buffer.from('export const v = 111;\n')));
  mod.journalExpect(root, b, sha(Buffer.from('export const v = 222;\n')));
  const rec = mod.journalRecover(root, () => {});
  assert.deepEqual(rec.restored.sort(), ['src/a.ts', 'src/b.ts'], `两个都要恢复：${JSON.stringify(rec)}`);
  assert.deepEqual(rec.failures, []);
  assert.deepEqual(st(a), beforeA, 'a 的字节与 mtime 都要回来');
  assert.deepEqual(st(b), beforeB, 'b 的字节与 mtime 都要回来');
  assert.deepEqual(entries(root), [], '两条日志都要销账');
});

test('U1-b 同名不同目录 + 同内容 ⇒ 仍然独立', () => {
  const same = 'x\n';
  const { root } = mkTree({ 'src/a.ts': same, 'lib/a.ts': same });
  for (const rel of ['src/a.ts', 'lib/a.ts']) {
    const abs = path.join(root, rel);
    mod.journalBegin(root, abs, fs.readFileSync(abs), fs.statSync(abs));
  }
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'broken\n');
  fs.writeFileSync(path.join(root, 'lib/a.ts'), 'broken\n');
  mod.journalExpect(root, path.join(root, 'src/a.ts'), sha(Buffer.from('broken\n')));
  mod.journalExpect(root, path.join(root, 'lib/a.ts'), sha(Buffer.from('broken\n')));
  const rec = mod.journalRecover(root, () => {});
  assert.deepEqual(rec.restored.sort(), ['lib/a.ts', 'src/a.ts']);
  assert.equal(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8'), same);
  assert.equal(fs.readFileSync(path.join(root, 'lib/a.ts'), 'utf8'), same);
});

test('U1-c 同路径不同原文：已有未销账日志时 journalBegin 必须拒绝（不许覆盖真原文）', () => {
  const { root } = mkTree({ 'src/a.ts': 'v1\n' });
  const a = path.join(root, 'src/a.ts');
  mod.journalBegin(root, a, fs.readFileSync(a), fs.statSync(a));
  fs.writeFileSync(a, 'v2\n'); // 模拟"上一次运行已把文件改坏且日志还在"
  assert.throws(
    () => mod.journalBegin(root, a, fs.readFileSync(a), fs.statSync(a)),
    /未销账|未收尾|未恢复/,
    '同路径已有日志 ⇒ 必须拒绝（否则会把 v1 这条真正的原文覆盖成 v2）',
  );
});

// ── U-02/U-04：恢复失败必须 fail-closed，并如实报出 ─────────────────────

test('U2-a 坏 JSON ⇒ 进 failures（不许静默忽略），日志保留', () => {
  const { root } = mkTree({ 'src/a.ts': 'v1\n' });
  fs.mkdirSync(mod.journalDir(root), { recursive: true });
  fs.writeFileSync(path.join(mod.journalDir(root), 'deadbeef.json'), '{ not json', 'utf8');
  const rec = mod.journalRecover(root, () => {});
  assert.equal(rec.failures.length, 1, `坏元数据必须报失败：${JSON.stringify(rec)}`);
  assert.match(rec.failures[0].why, /JSON|解析/);
  assert.ok(entries(root).some((x) => x.endsWith('.json')), '失败日志不许被删（要能诊断/人工恢复）');
});

test('U2-b 缺 .orig ⇒ failure 且目标文件不被写坏', () => {
  const { root } = mkTree({ 'src/a.ts': 'v1\n' });
  const a = path.join(root, 'src/a.ts');
  mod.journalBegin(root, a, fs.readFileSync(a), fs.statSync(a));
  const orig = entries(root).find((x) => x.endsWith('.orig'));
  fs.rmSync(path.join(mod.journalDir(root), orig));
  fs.writeFileSync(a, 'mutated\n');
  const rec = mod.journalRecover(root, () => {});
  assert.equal(rec.failures.length, 1);
  assert.equal(fs.readFileSync(a, 'utf8'), 'mutated\n', '缺原文时不许把文件写成空/乱码（宁可不写）');
});

test('U2-c orig 的 sha 与元数据不符 ⇒ failure，且不写盘', () => {
  const { root } = mkTree({ 'src/a.ts': 'v1\n' });
  const a = path.join(root, 'src/a.ts');
  mod.journalBegin(root, a, fs.readFileSync(a), fs.statSync(a));
  const orig = entries(root).find((x) => x.endsWith('.orig'));
  fs.writeFileSync(path.join(mod.journalDir(root), orig), 'tampered\n');
  fs.writeFileSync(a, 'mutated\n');
  const rec = mod.journalRecover(root, () => {});
  assert.equal(rec.failures.length, 1);
  assert.match(rec.failures[0].why, /sha/i);
  assert.equal(fs.readFileSync(a, 'utf8'), 'mutated\n', '原文自身被篡改 ⇒ 不许写回（会毁掉现场）');
});

test('U2-d 路径越界（绝对路径 / .. 逃逸）⇒ failure，且根外文件不被触碰', () => {
  const { root } = mkTree({ 'src/a.ts': 'v1\n' });
  const outside = path.join(os.tmpdir(), `ds1r4-outside-${process.pid}.txt`);
  const escapeName = `ds1r4-escape-${process.pid}-${Date.now()}.txt`;
  const escapeAbs = path.join(path.dirname(root), escapeName);
  fs.rmSync(escapeAbs, { force: true });
  fs.writeFileSync(outside, 'untouched\n');
  const dir = mod.journalDir(root);
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, rel] of [`../${escapeName}`, outside.replace(/\\/g, '/')].entries()) {
    const body = Buffer.from('evil\n');
    fs.writeFileSync(path.join(dir, `esc${i}.orig`), body);
    fs.writeFileSync(
      path.join(dir, `esc${i}.json`),
      JSON.stringify({ file: rel, sha: sha(body), atimeMs: 0, mtimeMs: 0 }),
      'utf8',
    );
  }
  const rec = mod.journalRecover(root, () => {});
  assert.equal(rec.failures.length, 2, `两个越界条目都必须报失败：${JSON.stringify(rec)}`);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched\n', '根外文件绝不能被写');
  assert.equal(fs.existsSync(escapeAbs), false, `.. 逃逸的目标绝不能被创建：${escapeAbs}`);
});

test('U2-e 孤儿 .orig（无元数据）必须显式报出，不静默留着', () => {
  const { root } = mkTree({ 'src/a.ts': 'v1\n' });
  fs.mkdirSync(mod.journalDir(root), { recursive: true });
  fs.writeFileSync(path.join(mod.journalDir(root), 'orphan.orig'), 'whatever', 'utf8');
  const rec = mod.journalRecover(root, () => {});
  assert.equal(rec.orphans.length, 1, `孤儿必须报出：${JSON.stringify(rec)}`);
});

// ── U-04：原子性 ────────────────────────────────────────────────────────

test('U4-a journalBegin 返回时两条都在、无 .tmp 残留', () => {
  const { root } = mkTree({ 'src/a.ts': 'v1\n' });
  const a = path.join(root, 'src/a.ts');
  mod.journalBegin(root, a, fs.readFileSync(a), fs.statSync(a));
  const list = entries(root);
  assert.equal(list.filter((x) => x.endsWith('.orig')).length, 1);
  assert.equal(list.filter((x) => x.endsWith('.json')).length, 1);
  assert.deepEqual(list.filter((x) => x.includes('.tmp')), [], `不许留临时件：${JSON.stringify(list)}`);
  // 原文必须可独立校验：orig 的 sha 与元数据一致
  const j = JSON.parse(fs.readFileSync(path.join(mod.journalDir(root), list.find((x) => x.endsWith('.json'))), 'utf8'));
  const orig = fs.readFileSync(path.join(mod.journalDir(root), list.find((x) => x.endsWith('.orig'))));
  assert.equal(sha(orig), j.sha, 'orig 与元数据 sha 必须一致（恢复才能先验证再写）');
  assert.equal(j.file, 'src/a.ts', '元数据存**项目相对路径**（不存绝对路径当身份）');
});

test('U4-b 恢复返回结构化结果：无残留时是空集合（不是"看起来无残留"的假空）', () => {
  const { root } = mkTree({ 'src/a.ts': 'v1\n' });
  const rec = mod.journalRecover(root, () => {});
  assert.deepEqual(rec, { restored: [], conflicts: [], indeterminate: [], failures: [], orphans: [] });
});

// ── V-01（DS-1C）：恢复必须带**当前盘面**冲突检查 ──────────────────────

/** 走真实时序：登记 → 写入变异 → 记录预期变异指纹 → （可选）模拟崩溃后别人继续改 */
function leftover(root: string, rel: string, mutated: string): { file: string; original: Buffer } {
  const file = path.join(root, rel);
  const st0 = fs.statSync(file);
  const original = fs.readFileSync(file);
  mod.journalBegin(root, file, original, st0);
  fs.writeFileSync(file, mutated);
  mod.journalExpect(root, file, sha(Buffer.from(mutated, 'utf8')));
  return { file, original };
}

test('V1-a 正常遗留变异（当前 == 预期变异态）⇒ 恢复原字节与 mtime', () => {
  const { root } = mkTree({ 'src/a.ts': 'original\n' });
  const { file, original } = leftover(root, 'src/a.ts', 'mutated\n');
  const before = { sha: sha(original), mtimeMs: fs.statSync(file).mtimeMs };
  void before;
  const rec = mod.journalRecover(root, () => {});
  assert.deepEqual(rec.restored, ['src/a.ts']);
  assert.deepEqual(rec.conflicts, []);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original\n');
});

test('V1-b 当前已是原文 ⇒ 安全销账、不写盘', () => {
  const { root } = mkTree({ 'src/a.ts': 'original\n' });
  const { file } = leftover(root, 'src/a.ts', 'mutated\n');
  fs.writeFileSync(file, 'original\n'); // 别人已经手工恢复过
  const before = st(file);
  const rec = mod.journalRecover(root, () => {});
  assert.deepEqual(rec.restored, ['src/a.ts'], '等于原文 ⇒ 可以直接销账（不算恢复写入）');
  assert.deepEqual(rec.conflicts, []);
  assert.deepEqual(st(file), before, '已经是原文 ⇒ 一个字节都不该写');
  assert.deepEqual(entries(root), []);
});

test('V1-c 崩溃后用户写了新内容 ⇒ **不许覆盖**，记 conflict、保留日志', () => {
  const { root } = mkTree({ 'src/a.ts': 'original\n' });
  const { file } = leftover(root, 'src/a.ts', 'mutated\n');
  fs.writeFileSync(file, 'human-new-work\n'); // ★ 复核席探针：崩溃后别人的新工作
  const rec = mod.journalRecover(root, () => {});
  assert.equal(fs.readFileSync(file, 'utf8'), 'human-new-work\n', '★ 恢复绝不能覆盖别人的新工作');
  assert.deepEqual(rec.restored, []);
  assert.equal(rec.conflicts.length, 1, `必须记 conflict：${JSON.stringify(rec)}`);
  assert.ok(entries(root).some((x) => x.endsWith('.json')), '冲突时日志必须保留（现场证据）');
});

test('V1-d 缺预期变异指纹且当前不是原文 ⇒ 不可判，不写、留现场', () => {
  const { root } = mkTree({ 'src/a.ts': 'original\n' });
  const file = path.join(root, 'src/a.ts');
  mod.journalBegin(root, file, fs.readFileSync(file), fs.statSync(file)); // 故意不 journalExpect
  fs.writeFileSync(file, 'who-knows\n');
  const rec = mod.journalRecover(root, () => {});
  assert.equal(fs.readFileSync(file, 'utf8'), 'who-knows\n', '不可判 ⇒ 不猜、不写');
  assert.deepEqual(rec.restored, []);
  assert.equal(rec.indeterminate.length, 1, `必须记"不可判"：${JSON.stringify(rec)}`);
  assert.ok(entries(root).some((x) => x.endsWith('.json')), '日志保留');
});

test('V1-e 冲突/不可判都必须进 journalRecover 的返回值（runMutate 据此拒绝新测量）', () => {
  const { root } = mkTree({ 'src/a.ts': 'original\n', 'src/b.ts': 'b-orig\n' });
  const a = leftover(root, 'src/a.ts', 'mutated-a\n');
  fs.writeFileSync(a.file, 'human\n');
  const b = path.join(root, 'src/b.ts');
  mod.journalBegin(root, b, fs.readFileSync(b), fs.statSync(b));
  fs.writeFileSync(b, 'unknown\n');
  const rec = mod.journalRecover(root, () => {});
  assert.equal(rec.conflicts.length + rec.indeterminate.length, 2, JSON.stringify(rec));
  assert.deepEqual(rec.restored, []);
});

test('T07 硬杀（SIGKILL）：下次启动的恢复必须把源码与 mtime 一起还原', () => {
  const { root } = mkTree({ 'src/a.ts': 'export const add = (a, b) => a + b;\n' });
  const file = path.join(root, 'src/a.ts');
  const before = st(file);
  const mutated = 'export const add = () => 0;\n';
  const mutatedSha = sha(Buffer.from(mutated, 'utf8'));
  const child = `
    import fs from 'node:fs';
    const mod = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'scripts', 'mutate.mjs')).href)});
    const root = ${JSON.stringify(root)};
    const file = ${JSON.stringify(file)};
    mod.journalBegin(root, file, fs.readFileSync(file), fs.statSync(file));
    fs.writeFileSync(file, ${JSON.stringify(mutated)});
    mod.journalExpect(root, file, ${JSON.stringify(mutatedSha)});
    process.kill(process.pid, 'SIGKILL');
  `;
  const childFile = path.join(root, 'crash.mjs');
  fs.writeFileSync(childFile, child);
  spawnSync(process.execPath, ['--import', 'tsx', childFile], { cwd: REPO, encoding: 'utf-8' });
  assert.notEqual(st(file).sha, before.sha, '前提：硬杀后源码停在变异态（钩子跑不到）');
  const rec = mod.journalRecover(root, () => {});
  assert.deepEqual(rec.restored, ['src/a.ts'], `日志必须认出这个残留：${JSON.stringify(rec)}`);
  assert.deepEqual(st(file), before, '★ 硬杀路径：字节与 mtime 都必须回来');
});
