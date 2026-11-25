/**
 * P0 · H3 裁判独立（2026-11-26，#202 A+①）：**受保护规则版本钉验**配套测试。
 *
 * ## 本证锁的 fail-closed 不变量
 * 判据尺（裁判核 + 清单 + 端口 + 册）被改而无独立批准 entry ⇒ 校验必须拒判，不许拿未审批的尺子下结论。
 * 覆盖四条：
 * 1. **非受保护环境放行**：隔离临时夹具 / 未引导基线（非 git 仓，或 git 仓但无 entry 无 tag）⇒
 *    `protected=false`、`ok=true`，指纹照常记录；没有基线可比，不硬 fail-closed。
 * 2. **受保护环境强制比对**：git 仓且存在 entry 或 tag ⇒ `protected=true`；rules_sha / 册工作树 blob /
 *    tag blob / tested_commit 任一不符 ⇒ `ok=false`，reasons 点名。
 * 3. **ledger append-only**：`loadLatestApproval` 取最后一条合法 entry；坏 JSON 行跳过不崩。
 * 4. **指纹随源码变**：规则源码字节一变，`rules_sha` 必须变（指纹不是恒值，否则钉验是空转）。
 *
 * ## 夹具口径
 * 受保护环境用 `git init` 临时仓：把 RULE_SOURCE_FILES 从主仓拷到同相对路径 + 落一份红样本册 +
 * commit + 写 entry + 打 tag。纯文件解析用例（ledger 坏行）不 init git。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as rules from '../src/infrastructure/rules/protected_rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function git(root: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync(
    'git',
    ['-c', 'user.email=h3@example.invalid', '-c', 'user.name=h3-test', ...args],
    { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return { ok: r.status === 0, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').split('\n')[0] };
}

function initRepo(root: string): void {
  assert.equal(git(root, ['init', '-q']).ok, true, `git init 失败：${git(root, ['rev-parse', '--is-inside-work-tree']).err}`);
  git(root, ['config', 'user.email', 'h3@example.invalid']);
  git(root, ['config', 'user.name', 'h3-test']);
}

/** 把规则源码集合从主仓拷到临时仓同相对路径（指纹只算字节哈希，不装载闭包 ⇒ 拷文件即可）。 */
function seedSources(root: string): void {
  for (const rel of rules.RULE_SOURCE_FILES) {
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
}

function seedBook(root: string, feature = 'red-samples'): void {
  const dir = path.join(root, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'red-samples', `${feature}.dsl.json`), path.join(dir, `${feature}.dsl.json`));
}

function commitAll(root: string, msg: string): void {
  git(root, ['add', '-A']);
  const c = git(root, ['commit', '-q', '-m', msg]);
  assert.equal(c.ok, true, `commit 失败：${c.err}`);
}

/** 按当前工作树指纹 / 册 blob / HEAD 造一条审批 entry 并 append 进 ledger。 */
function writeEntry(root: string, over: Partial<rules.ApprovalEntry> = {}): rules.ApprovalEntry {
  const fp = rules.rulesSourceFingerprint(root);
  const books: Record<string, string> = {};
  for (const rel of rules.listBookFiles(root)) books[rel] = rules.worktreeBlobSha(root, rel) ?? '';
  const head = rules.headCommit(root);
  const entry: rules.ApprovalEntry = {
    schema: 1,
    approved_at: new Date().toISOString(),
    approver: 'h3-test',
    note: 'H3 配套测试',
    rules_sha: fp.sha,
    books,
    book_ref: rules.PROTECTED_TAG,
    tested_commit: head ?? '',
    ...over,
  };
  const abs = path.join(root, rules.APPROVAL_LEDGER_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, JSON.stringify(entry) + '\n', 'utf-8');
  return entry;
}

function tagHead(root: string): void {
  const head = rules.headCommit(root);
  assert.ok(head, '打 tag 前必须有 HEAD');
  const t = git(root, ['tag', '-f', rules.PROTECTED_TAG, head]);
  assert.equal(t.ok, true, `打 tag 失败：${t.err}`);
}

/** 造一个已引导（entry + tag 齐全、指纹一致）的受保护临时仓。 */
function makeManagedRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-managed-'));
  initRepo(root);
  seedSources(root);
  seedBook(root);
  commitAll(root, 'h3 base');
  writeEntry(root);
  tagHead(root);
  return root;
}

// ══════════════════════════════════════════════════════════════════════════
// ① 非 git 夹具：无基线可比 ⇒ 放行（protected=false），指纹照常记录
// ══════════════════════════════════════════════════════════════════════════
test('H3-① · 非 git 临时夹具 ⇒ protected=false 放行，rules_sha 照常记录、tested_commit=null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-nongit-'));
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.ok, true, '非受保护环境不得 fail-closed');
  assert.equal(v.protected, false);
  assert.ok(v.rulesSha.length > 0, '指纹必须照常记录');
  assert.equal(v.testedCommit, null, '非 git 仓读不到 HEAD');
  assert.equal(v.entry, null);
});

// ══════════════════════════════════════════════════════════════════════════
// ② git 仓但无 entry 无 tag ⇒ 未纳入基线，放行不强制
// ══════════════════════════════════════════════════════════════════════════
test('H3-② · git 仓但无 entry / 无 tag ⇒ 未引导基线，protected=false 放行', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-unbooted-'));
  initRepo(root);
  seedSources(root);
  seedBook(root);
  commitAll(root, 'unbooted');
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.ok, true, '未引导基线不得 fail-closed');
  assert.equal(v.protected, false);
  assert.equal(v.entry, null);
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 受保护环境一致态 ⇒ ok=true，entry / books 齐全
// ══════════════════════════════════════════════════════════════════════════
test('H3-③ · 已引导受保护环境：指纹 / 册 blob / tag / tested_commit 一致 ⇒ ok=true', () => {
  const root = makeManagedRepo();
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.protected, true);
  assert.equal(v.ok, true, `一致态必须通过：${v.reasons.join(' | ')}`);
  assert.ok(v.entry, '受保护环境必须有 entry');
  assert.ok(Object.keys(v.books).length > 0, '册清单必须带出');
  assert.equal(v.testedCommit, v.entry?.tested_commit);
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 受保护环境 rules_sha 不符 ⇒ fail-closed 拒判
// ══════════════════════════════════════════════════════════════════════════
test('H3-④ · 规则源码未审批改动 ⇒ rules_sha 不符 fail-closed', () => {
  const root = makeManagedRepo();
  const rel = rules.RULE_SOURCE_FILES[0];
  fs.appendFileSync(path.join(root, rel), '\n// mutated without approval\n', 'utf8');
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.protected, true);
  assert.equal(v.ok, false, '未审批改尺必须拒判');
  assert.ok(v.reasons.some((r) => /rules_sha 不符/.test(r)), `reasons 须点名 rules_sha：${v.reasons.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ tag 存在但 ledger 无 entry ⇒ fail-closed（防自批：有 tag 没批准记录）
// ══════════════════════════════════════════════════════════════════════════
test('H3-⑤ · tag 存在但 ledger 无 entry ⇒ fail-closed 拒判', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-tag-noentry-'));
  initRepo(root);
  seedSources(root);
  seedBook(root);
  commitAll(root, 'tag only');
  tagHead(root); // 不写 ledger
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.protected, true);
  assert.equal(v.ok, false, '有 tag 无 entry 必须拒判');
  assert.ok(v.reasons.some((r) => /无 entry/.test(r)), `reasons 须点名无 entry：${v.reasons.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ ledger append-only：坏 JSON 行跳过，取最后一条合法 entry
// ══════════════════════════════════════════════════════════════════════════
test('H3-⑥ · ledger：坏行跳过，取最后一条合法 entry（append-only 解析）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-ledger-'));
  const abs = path.join(root, rules.APPROVAL_LEDGER_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, '{这是坏 JSON\n', 'utf8');
  fs.appendFileSync(abs, 'not-json-line\n', 'utf8');
  const good: rules.ApprovalEntry = {
    schema: 1,
    approved_at: '2026-11-26T00:00:00.000Z',
    approver: 'h3-test',
    note: '最后一条合法',
    rules_sha: 'abc123',
    books: {},
    book_ref: rules.PROTECTED_TAG,
    tested_commit: 'c001',
  };
  fs.appendFileSync(abs, JSON.stringify(good) + '\n', 'utf8');
  const entry = rules.loadLatestApproval(root);
  assert.ok(entry, '坏行之后的合法 entry 必须读到');
  assert.equal(entry?.rules_sha, 'abc123');
  assert.equal(entry?.tested_commit, 'c001');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑦ 册工作树 blob ≠ 审批记录 ⇒ fail-closed（未审批改册）
// ══════════════════════════════════════════════════════════════════════════
test('H3-⑦ · 册工作树被改而 entry 未更新 ⇒ 册 blob 不符 fail-closed', () => {
  const root = makeManagedRepo();
  const bookRel = rules.listBookFiles(root)[0];
  assert.ok(bookRel, '夹具仓应有册');
  fs.appendFileSync(path.join(root, bookRel), '\n// tampered book\n', 'utf8');
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.protected, true);
  assert.equal(v.ok, false, '未审批改册必须拒判');
  assert.ok(v.reasons.some((r) => /工作树 blob/.test(r)), `reasons 须点名册工作树 blob：${v.reasons.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑧ tag blob ≠ 审批记录 ⇒ fail-closed（tag 未随 entry 前移 / 册不一致）
// ══════════════════════════════════════════════════════════════════════════
test('H3-⑧ · entry 记假册 blob ⇒ tag blob 与工作树 blob 双不符 fail-closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-tagblob-'));
  initRepo(root);
  seedSources(root);
  seedBook(root);
  commitAll(root, 'tagblob base');
  const bookRel = rules.listBookFiles(root)[0];
  // entry 里册 blob 记成一个不存在的假哈希 ⇒ tag 内 / 工作树 blob 都对不上
  writeEntry(root, { books: { [bookRel]: '0'.repeat(64) } });
  tagHead(root);
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.protected, true);
  assert.equal(v.ok, false, '册 blob 与 tag 对不上必须拒判');
  assert.ok(v.reasons.some((r) => /tag blob/.test(r)), `reasons 须点名 tag blob：${v.reasons.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑨ 突变牙：规则源码字节一变，rules_sha 必须变（指纹不是恒值）
// ══════════════════════════════════════════════════════════════════════════
test('H3-⑨ · 突变牙：源码改动必须改变 rules_sha（指纹真随源码走）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-fp-mut-'));
  seedSources(root);
  const before = rules.rulesSourceFingerprint(root).sha;
  const rel = rules.RULE_SOURCE_FILES[0];
  fs.appendFileSync(path.join(root, rel), '\n// one byte changed\n', 'utf8');
  const after = rules.rulesSourceFingerprint(root).sha;
  assert.notEqual(before, after, '源码变 ⇒ 指纹必须变；若相等说明指纹没读源码（钉验空转）');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑩ 受保护环境缺规则源码文件 ⇒ reasons 点名 missing
// ══════════════════════════════════════════════════════════════════════════
test('H3-⑩ · 受保护环境规则源码缺文件 ⇒ fail-closed 点名缺失文件', () => {
  const root = makeManagedRepo();
  const rel = rules.RULE_SOURCE_FILES[1];
  fs.rmSync(path.join(root, rel));
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.protected, true);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => /缺文件/.test(r) && r.includes(rel)), `reasons 须点名缺失文件：${v.reasons.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑪ 基线后追加纯台账 commit（HEAD 领先 tested_commit）⇒ 主防线一致仍 ok=true，commit 不一致单列 warning
// ══════════════════════════════════════════════════════════════════════════
test('H3-⑪ · 纯台账 commit 领先基线 ⇒ 不 fail-closed，commit 不一致进 warning 而非 reasons', () => {
  const root = makeManagedRepo();
  // 追加一个不碰规则源码 / 册的台账文件并提交 ⇒ HEAD 领先 entry.tested_commit。
  fs.writeFileSync(path.join(root, 'notes.md'), '# follow-up ledger note\n', 'utf8');
  commitAll(root, 'follow-up ledger note');
  const v = rules.verifyProtectedRules(root);
  assert.equal(v.protected, true);
  assert.equal(v.ok, true, '规则 / 册未变 ⇒ 纯台账 commit 领先不得拒判');
  assert.equal(v.reasons.length, 0, '主防线（rules_sha / 册 blob / tag）不符才进 reasons');
  assert.ok(v.warnings.some((w) => /tested_commit/.test(w)), 'commit 不一致须单列 warning：' + v.warnings.join(' | '));
});
