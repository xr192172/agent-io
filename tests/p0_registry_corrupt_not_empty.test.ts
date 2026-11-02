/**
 * ★ P0 · **产物注册表：坏 ≠ 空**（`T-#CORRUPT-AS-EMPTY-FAMILY` 的第三处）。
 *
 * ## 病（改前实测，读数原样记在这里）
 * `src/infrastructure/index/registry.ts` 的 `readRegistry()` 与 `readFileEntries(file)` **逐字同体**：
 * `!existsSync ⇒ []`、`catch {} ⇒ []`、根不是数组 ⇒ `[]`。而 `registerArtifactTo` 的写端是
 * 「读全量 → upsert → **整份写回**」⇒ 坏 JSON 时它拿到空列表，以「空 + 新条目」覆盖整份：
 * ```
 * 好状态 3 条（a/b/c.html）→ 截断成坏 JSON（sha 6964756d…）
 * 注册一条 d.html ⇒ 不抛 ⇒ 文件变成只剩 1 条（d.html），sha 6964756d… → 6e739c4e…
 * ```
 * ⇒ **一次注册抹掉其余条目，零报错**（0.12：读不出被当成没有）。
 *
 * ## 本证断言什么（每条都双向）
 * 1. 坏 JSON / 根不是数组 / 元素缺 `path` ⇒ **抛**，报文点名**文件** + 明写「读失败」+ 给 **JSON 错误首行**，
 *    且该文件 **sha256 前后完全一致**（一个字节都没写）；
 * 2. ★ **首次使用**（文件不存在）⇒ **仍能正常注册**，文件被正确创建 —— `不存在 ≠ 坏了`（0.12 的另一半）；
 * 3. 读口**只有一处实现**：`readRegistry(file)` 直接读任意注册表文件；读一次**不写盘**（sha + mtime 不变）；
 *    源码里不再有 `readFileEntries` / `writeFileEntries` 的实现（同体副本已删）。
 *
 * ★ 消融（criterion d）：把 `readRegistry` 的「坏 ⇒ 抛」改回「坏 ⇒ 返回 []」，a1/a2/a3 三条**立刻变红**。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRegistryText,
  readRegistry,
  registerArtifactTo,
  registryFilePath,
} from '../src/infrastructure/index/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 一个**独立**的注册表文件路径（父目录存在，文件本身不创建） */
function tmpRegistry(tag: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `agentio-artreg-${tag}-`)), '.registry.json');
}

const sha = (f: string): string =>
  fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : '<absent>';
const mtime = (f: string): number => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);
const entriesOf = (f: string): number => (JSON.parse(fs.readFileSync(f, 'utf-8')) as unknown[]).length;

/** 建一个「好」注册表（3 条），返回它的路径 */
function goodRegistry(tag: string): string {
  const f = tmpRegistry(tag);
  for (const p of ['a.html', 'b.html', 'c.html']) registerArtifactTo(f, { path: p, title: p });
  assert.equal(entriesOf(f), 3, '前提：先有 3 条好登记');
  return f;
}

/** 跑一次注册，返回它抛的报文（没抛 ⇒ 空串 —— 那就是"静默"） */
function catchMessage(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

/** 断言「坏注册表 ⇒ 拒写且字节不变」，并把这条坏内容还回去（调用方决定是否还原） */
function assertRefusesAndKeepsBytes(file: string, bad: string, tag: string): string {
  fs.writeFileSync(file, bad, 'utf-8');
  const before = sha(file);
  const msg = catchMessage(() => registerArtifactTo(file, { path: 'd.html', title: 'D' }));
  assert.notEqual(msg, '', `${tag}：坏注册表上注册**必须报错**（改前是静默把其余条目整份抹掉）`);
  assert.ok(msg.includes(file), `${tag}：报文要点名**哪个文件**，实得：${msg}`);
  assert.match(msg, /读失败/, `${tag}：报文要明写这是「读失败」，不是「一条都没注册」`);
  assert.equal(sha(file), before, `${tag}：**一个字节都不许写**（sha256 前后一致）`);
  return msg;
}

// ── a1 坏 JSON ────────────────────────────────────────────────────────────
test('a1 坏 JSON ⇒ 拒写 + 点名文件 + 给出 JSON 错误首行 + sha256 不变', () => {
  const f = goodRegistry('a1');
  const good = fs.readFileSync(f, 'utf-8');
  const bad = good.slice(0, good.length - 20); // 截断 = 坏 JSON
  const msg = assertRefusesAndKeepsBytes(f, bad, 'a1');
  assert.match(msg, /JSON 解析失败/, 'a1：错因要点明「JSON 解析失败」');
  assert.match(msg, /JSON 错误首行：\S/, 'a1：要点名 **JSON 错误首行**（不是只说"坏了"）');
  assert.equal(fs.readFileSync(f, 'utf-8'), bad, 'a1：坏内容原样还在（没被覆盖成「只剩新条目」）');
});

// ── a2 根不是数组 ─────────────────────────────────────────────────────────
test('a2 根不是数组（{}）⇒ 拒写 + 说明实得什么 + sha256 不变', () => {
  const f = goodRegistry('a2');
  const msg = assertRefusesAndKeepsBytes(f, '{"a":1}', 'a2');
  assert.match(msg, /根必须是数组/, 'a2：要点明形状错在「根必须是数组」');
  assert.match(msg, /实得 object/, 'a2：要说清**实得**是什么形状');
});

// ── a3 元素形状不对 ───────────────────────────────────────────────────────
test('a3 元素缺 path ⇒ 拒写 + 点名第几条 + sha256 不变', () => {
  const f = goodRegistry('a3');
  const msg = assertRefusesAndKeepsBytes(f, '[{"path":"ok.html"},{"title":"缺 path"}]', 'a3');
  assert.match(msg, /第 2 条/, 'a3：要点名**第几条**形状不对');
  assert.match(msg, /path/, 'a3：要说清缺的是 path');
});

// ── b 首次仍可用：不存在 ≠ 坏了 ───────────────────────────────────────────
test('b 文件不存在 ⇒ 注册成功并创建文件（首次不是错误）', () => {
  const f = tmpRegistry('b');
  assert.equal(fs.existsSync(f), false, '前提：这个注册表**不存在**');
  assert.deepEqual(readRegistry(f), [], '不存在 ⇒ 空数组（首次使用，合法）');
  const created = registerArtifactTo(f, { path: 'first.html', title: '首次' });
  assert.equal(created.path, 'first.html');
  assert.equal(fs.existsSync(f), true, '第一次注册必须**创建**文件（不许把「首次」也拒了）');
  assert.equal(entriesOf(f), 1);
  registerArtifactTo(f, { path: 'second.html', title: '第二条' });
  assert.equal(entriesOf(f), 2, '第二次注册是**追加**，不是覆盖');
});

// ── c 读口只有一处实现 + 读路径不写盘 ─────────────────────────────────────
test('c 读口只有一处：readRegistry(file) 直读任意表，且读一次不写盘（sha+mtime 不变）', () => {
  const f = goodRegistry('c');
  const before = { sha: sha(f), mtime: mtime(f) };
  const got = readRegistry(f);
  assert.equal(got.length, 3, 'readRegistry(file) 直接读指定文件（原先这条路要 readFileEntries）');
  assert.equal(sha(f), before.sha, '读路径**绝不写盘**：sha256 前后一致');
  assert.equal(mtime(f), before.mtime, '读路径**绝不写盘**：mtime 前后一致');

  // 同体副本已删：源码里不许再有这两个 `function` 定义
  const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/index/registry.ts'), 'utf-8');
  assert.equal(/function\s+readFileEntries\b/.test(src), false, 'readFileEntries 必须已收进 readRegistry（同体副本 = 同一事实两处）');
  assert.equal(/function\s+writeFileEntries\b/.test(src), false, 'writeFileEntries 必须已收进 writeRegistry');

  // 缺省的 `readRegistry()` 仍走 <dataHome>/output/.registry.json（签名没变，5 个外部调用点免改）
  assert.match(registryFilePath(), /[\\/]output[\\/]\.registry\.json$/, '缺省路径仍是 <dataHome>/output/.registry.json');
});

// ── 纯判定核：三档语义（判据用 behavior-cases 钉，这里再钉一遍失败方向） ──
test('parseRegistryText：坏 JSON / 根非数组 / 元素缺 path ⇒ ok:false；只有真数组才 ok:true', () => {
  assert.equal(parseRegistryText('[]').ok, true, '空数组是**唯一**合法的"没有条目"');
  assert.equal(parseRegistryText('[{"path":"a.html"}]').ok, true);
  const broken = parseRegistryText('[{"path":"a.html"');
  assert.equal(broken.ok, false, '坏 JSON 不许当空');
  if (!broken.ok) assert.notEqual(broken.firstLine, '', '坏 JSON 必须带**错误首行**');
  const notArray = parseRegistryText('{}');
  assert.equal(notArray.ok, false, '根不是数组不许当空');
  const badEl = parseRegistryText('[{"title":"x"}]');
  assert.equal(badEl.ok, false, '元素缺 path 不许当空');
});
