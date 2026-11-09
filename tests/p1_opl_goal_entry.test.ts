/**
 * touches: src/application/design/derive/opl_goal_entry.ts, src/application/design/db/changeset_draft.ts
 *
 * P1 · **OPL 目标入口**（`propose` / `adopt`）的机器回归。
 *
 * 钉住六条硬边界（每条都要能红）：
 *  ① 无证据 ⇒ `no_candidate`（不硬凑草案）；
 *  ② 非候选主体 ⇒ **拒**（候选未确认不许施工）；
 *  ③ 缺独立契约 ⇒ **拒**（不从当前实现代生成预期）；
 *  ④ 已有契约 ⇒ `reuse`、不重复新增；
 *  ⑤ `adopt` **确实产生**设计决策与施工卡（不是只回建议）；
 *  ⑥ **未执行/不可判不得核销**：判据没全过时 `complete` 必须被拒。
 *
 * ★ 用一个**临时真实工程**（src + 调用边 + 设计册），与 `p1_verify_project_lifecycle` 同一驱动路径
 *   （仓里的 node_modules 用 junction，不装依赖；git 初始化让改动集可读）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importProject } from '../src/infrastructure/graph/import_project.js';
import { getDSL } from '../src/infrastructure/storage.js';
import { closeAllProjectCacheDbs } from '../src/infrastructure/index/db.js';
import { oplPropose, oplAdopt } from '../src/application/design/derive/opl_goal_entry.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FEATURE = 'opl-entry-t';

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
}

/** 主项 + 消费方（真实调用边：consumer 里调 alpha） */
function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opl-entry-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.agent-io\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'opl-entry', version: '1.0.0', type: 'module' }, null, 2));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(root, 'src', 'alpha.ts'), 'export function alpha(raw: string): string {\n  return raw.trim();\n}\n');
  fs.writeFileSync(
    path.join(root, 'src', 'consumer.ts'),
    "import { alpha } from './alpha.js';\n\nexport function useAlpha(raw: string): string {\n  return alpha(raw);\n}\n",
  );
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return root;
}

function cleanup(root: string): void {
  closeAllProjectCacheDbs();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows 句柄偶发未释放 */
  }
}

const dslOf = (root: string) => getDSL(FEATURE) as unknown as {
  geometry?: { nodes?: Array<{ id: string; path?: string; task?: { state?: string }; decision?: { summary?: string; expectations?: Array<Record<string, unknown>> } }> };
} | null;

test('P1-opl-entry · ① 无证据 ⇒ no_candidate；② 非候选主体 ⇒ 拒；③ 缺契约 ⇒ 拒；④⑤ 复用与真建；⑥ 不可判不得核销', async () => {
  const root = mkProject();
  try {
    // 建档（设计册 + 索引），这是 propose/adopt 的事实前提
    await importProject({ project_dir: root, feature: FEATURE } as never);

    // ① 无证据：目标与本项目毫无关系 ⇒ 必须 no_candidate，且**不出** changeSet
    const ghost = await oplPropose({ feature: FEATURE, projectRoot: root, goal: '把日志改成 PARQUET 并加上 trace id 与采样率' });
    assert.equal(ghost.outcome, 'no_candidate', `无关目标必须 no_candidate（实测 ${ghost.outcome}）`);
    assert.ok(ghost.unsupported.length > 0, '必须点名"证据不足"的原因');

    // ② 非候选主体：拿一个根本不在候选里的 subject ⇒ 拒
    const refusedSubject = await oplAdopt({
      feature: FEATURE,
      projectRoot: root,
      goal: 'alpha 应当支持大小写不敏比较',
      answer: { subject: 'src/nowhere.ts#nope', consumers: [], contracts: [{ of: 'src/nowhere.ts#nope', kind: 'behavior-cases', cases: [{ given: ['A'], expect: '"a"' }], why: 'x' }] },
    });
    assert.equal(refusedSubject.ok, false, '非候选主体必须被拒');
    assert.match(String(refusedSubject.refused?.why), /不在.*候选/, `拒绝理由要点明"不在候选"（实测：${refusedSubject.refused?.why}）`);
    assert.equal(refusedSubject.wrote.decisions.length, 0, '被拒时不许写任何决策');

    // ③ 缺独立契约：subject 合法（候选里有），但 contracts 空 ⇒ 拒
    const subjectKey = `src/${ghost.subjects.length >= 0 ? 'alpha' : 'alpha'}.ts#alpha`;
    const refusedContract = await oplAdopt({
      feature: FEATURE,
      projectRoot: root,
      goal: 'alpha 应当支持大小写不敏比较',
      answer: { subject: subjectKey, consumers: [], contracts: [] },
    });
    assert.equal(refusedContract.ok, false, '缺独立预期必须被拒（不许从当前实现代生成）');
    assert.match(String(refusedContract.refused?.why), /不在.*候选|缺独立预期/, `实测：${refusedContract.refused?.why}`);

    // ⑤ 正常采纳：人给 subject + 消费方 + 契约 ⇒ 真的写决策与卡
    const okAdopt = await oplAdopt({
      feature: FEATURE,
      projectRoot: root,
      goal: 'alpha 应当支持大小写不敏比较',
      answer: {
        subject: subjectKey,
        consumers: ['src/consumer.ts#useAlpha'],
        contracts: [
          {
            of: subjectKey,
            kind: 'behavior-cases',
            cases: [{ given: ['ABC'], expect: '"abc"' }],
            why: '大小写不敏是本次目标；未做时返回原串 ⇒ 该条现在应为红',
          },
          { of: 'src/consumer.ts#useAlpha', kind: 'call-exists', why: '消费方必须继续调用 alpha（接线约束）' },
        ],
      },
    });
    assert.equal(okAdopt.ok, true, `正常采纳应当成功（实测：${okAdopt.refused?.why ?? 'ok'}）`);
    assert.ok(okAdopt.wrote.decisions.length > 0, '必须写设计决策');
    assert.ok(okAdopt.wrote.cards.length > 0, '必须建施工卡');
    assert.ok(okAdopt.commands.length >= 6, `必须给出依赖序命令（实测 ${okAdopt.commands.length} 步）`);

    // 落盘事实：册上节点有 decision.expectations、卡处于 claimed
    const dsl = dslOf(root);
    const node = (dsl?.geometry?.nodes ?? []).find((n) => String(n.path ?? '').replace(/\\/g, '/') === 'src/alpha.ts');
    assert.ok(node, '册上必须有 src/alpha.ts 节点');
    assert.ok((node?.decision?.expectations ?? []).length > 0, '节点上必须真的写下后态判据');
    assert.equal(node?.task?.state, 'claimed', `卡必须已被领（实测 ${node?.task?.state}）`);

    // ④ 复用：再 adopt 一次同一主体 ⇒ 该主体应进 skipped_reuse（不重复新增）
    const again = await oplAdopt({
      feature: FEATURE,
      projectRoot: root,
      goal: 'alpha 应当支持大小写不敏比较',
      answer: {
        subject: subjectKey,
        consumers: [],
        contracts: [
          { of: subjectKey, kind: 'behavior-cases', cases: [{ given: ['ABC'], expect: '"abc"' }], why: '复用既有那条，不新建' },
        ],
      },
    });
    assert.equal(again.ok, true, '重复采纳应当成功（只补/复用）');
    assert.ok(
      again.wrote.skipped_reuse.some((s) => s.includes(subjectKey)),
      `已有契约必须走复用、不重复新增（实测 skipped_reuse=${JSON.stringify(again.wrote.skipped_reuse)}）`,
    );

    // ⑥ 未执行/不可判不得核销：判据现在是红的（源码还没改）⇒ complete 必须被拒
    let completeRejected = false;
    let why = '';
    try {
      const r = execFileSync(
        process.execPath,
        [
          path.join(REPO, 'dist', 'src', 'presentation', 'cli', 'cli.js'),
          'edit_dsl',
          `feature=${FEATURE}`,
          `project_dir=${root}`,
          'reason=试图在判据仍红时核销（应当被拒）',
          'operations=[{"type":"task","op":"complete","id":"file_src_alpha_ts","data":{"reason":"未执行就想核销","evidence":{"kind":"reading","command":"none","observed":"none","at":"2026-01-01T00:00:00.000Z"}}}]',
        ],
        { encoding: 'utf8', cwd: REPO },
      );
      why = r;
    } catch (e) {
      completeRejected = true;
      why = String((e as { stdout?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? '');
    }
    assert.ok(completeRejected, '判据仍红时 complete 必须被拒（未执行/不可判不得核销）');
    console.log(`[rejected] ${why.split('\n').filter((l) => /拒|判据|红/.test(l)).slice(0, 2).join(' | ').slice(0, 200)}`);
  } finally {
    cleanup(root);
  }
});
