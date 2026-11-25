#!/usr/bin/env node
/**
 * approve-rules —— H3 裁判独立：**独立批准动作**（规则版本准入 + 受保护 tag 前移）。
 *
 * ## 职责（唯一批准入口，不重实现判定）
 * 判据尺（裁判核 + 清单 + 册）被改动后，必须先经本脚本算当前指纹 → 写一条 append-only 审批
 * entry → 前移受保护 tag `rules-protected`。judge 运行时按 ledger 最新 entry 比对，不一致
 * fail-closed 拒判。**无 entry / 指纹不符 ⇒ 不许把红判据改绿后自批自尺。**
 *
 * ## 两条载体（与 protected_rules.ts 同一口径，Main 裁 A）
 * · 裁判核 / 清单 / 端口（TS 闭包）：`rules_sha` = 源码 sha256 排序拼接；
 * · 册 JSON：各册工作树 blob SHA 记入 `books`，tag 前移后与 tag 内 blob 一致。
 *
 * ## 用法
 *   node scripts/approve-rules.mjs --approver <名字> [--note <说明>] [--tested-commit <源码 commit sha>]
 *
 * ## 退出码
 *   0 = entry 已写、tag 已前移、回读校验一致；
 *   1 = 回读校验不一致（指纹/册/tag 对不上）⇒ 不冒充批准成功；
 *   2 = 前置不满足（非 git 仓 / 规则源码缺文件 / git 不可用 / --approver 缺失 / tested-commit 非法）。
 *
 * ★ 本脚本是单写者执行的审批动作；entry 的 approver/note 记录批准依据。首次引导的 note
 *   记「H3 初始引导 Main 裁示」。
 *
 * ## 防误跑（2026-11-26）
 * · `--approver` **必填**：缺省拒绝执行，不再回落 `git config user.name` / `main` 默认——
 *   否则误跑会落一条 approver=本地用户名（非 main）的非授权 entry。
 * · `tested_commit` 钉**源码 commit**：本脚本必须在「源码已 commit、ledger entry 尚未 commit」
 *   的时点跑；逆行到纯台账 entry commit 之后重跑会把 tested_commit 错钉到 entry commit。
 *   必要时用 `--tested-commit <sha>` 显式指源码 commit。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const distImport = async (relPath) =>
  import(pathToFileURL(path.join(ROOT, 'dist', relPath)).href);

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: r.status === 0, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').split('\n')[0] };
}

function parseArg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(msg, code = 2) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

async function main() {
  const rules = await distImport('src/infrastructure/rules/protected_rules.js');

  // ── 前置：git 仓 + HEAD 存在 ──
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) fail(`不是 git 仓（${inside.err}）⇒ 无法钉受保护 tag`);
  const head = git(['rev-parse', 'HEAD']);
  if (!head.ok) fail('无 HEAD commit ⇒ 无法钉 tag（先有提交再批准规则版本）');

  // ── 算当前规则指纹 / 册 blob / 被测提交 ──
  const fp = rules.rulesSourceFingerprint(ROOT);
  if (fp.missing.length) fail(`规则源码缺文件：${fp.missing.join(', ')}`);

  const books = {};
  for (const rel of rules.listBookFiles(ROOT)) {
    const blob = rules.worktreeBlobSha(ROOT, rel);
    if (!blob) fail(`册 blob 取不到：${rel}`);
    books[rel] = blob;
  }

  const approver = parseArg('--approver', '');
  if (!approver) {
    fail('--approver 必填：显式批准人；不再回落 git config user.name / main 默认（防误跑落非 main 审批 entry）', 2);
  }
  const note = parseArg('--note', 'H3 规则版本批准');
  // tested_commit 钉被审批的源码 commit：缺省取当前 HEAD（须在源码 commit 后、entry commit 前跑）；
  // 逆行重跑时用 --tested-commit <sha> 显式指源码 commit，避免错钉纯台账 entry commit。
  const testedCommit = parseArg('--tested-commit', '') || head.out;
  if (!/^[0-9a-f]{40}$/i.test(testedCommit)) {
    fail(`--tested-commit 非合法 40 位 sha：${testedCommit}`, 2);
  }

  const entry = {
    schema: 1,
    approved_at: new Date().toISOString(),
    approver,
    note,
    rules_sha: fp.sha,
    books,
    book_ref: rules.PROTECTED_TAG,
    tested_commit: testedCommit,
  };

  // ── 写 ledger（append-only：只追加一行，不改写历史） ──
  const ledgerAbs = path.join(ROOT, rules.APPROVAL_LEDGER_REL);
  fs.mkdirSync(path.dirname(ledgerAbs), { recursive: true });
  fs.appendFileSync(ledgerAbs, JSON.stringify(entry) + '\n', 'utf-8');

  // ── 前移受保护 tag 到源码 commit（-f：审批动作允许前移，前提是上面有新 entry） ──
  const tag = git(['tag', '-f', rules.PROTECTED_TAG, testedCommit]);
  if (!tag.ok) fail(`打 tag ${rules.PROTECTED_TAG} 失败：${tag.err}`);

  // ── 回读校验：当前指纹/册/tag 必须与刚写的 entry 一致 ──
  const verification = rules.verifyProtectedRules(ROOT);
  if (!verification.ok) {
    console.error('✗ 回读校验不一致：');
    for (const reason of verification.reasons) console.error(`  · ${reason}`);
    fail('审批后校验未过 ⇒ 本条 entry 未生效（请核对后重跑）', 1);
  }

  console.log(`✓ 规则版本已批准并钉受保护 tag ${rules.PROTECTED_TAG}`);
  console.log(`  rules_sha  : ${fp.sha}`);
  console.log(`  tested_commit: ${head.out}`);
  console.log(`  册 (${Object.keys(books).length})：`);
  for (const rel of Object.keys(books).sort()) console.log(`    ${rel}  ${books[rel].slice(0, 12)}`);
  console.log(`  ledger: ${rules.APPROVAL_LEDGER_REL}（append-only）`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e), 2));
