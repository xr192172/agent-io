/**
 * touches: src/application/design/takeover_assessment.ts
 *
 * P1 · **接管评估协议**的机器回归（2026-11-09）
 *
 * 钉住两件事：
 *  ① 三场景**可区分**：fresh / resume / conflict；
 *  ② conflict 分**两档**：机械可判 ⇒ `resolution=auto`（取较新侧、给依据）；
 *     语义矛盾 / 时间戳缺失或同轮 / supersedes 互指 ⇒ `resolution=human`（**引擎不选边**）。
 *
 * ★ 全部用**纯函数 + 临时目录**（不建索引、不跑项目测试），所以能快速红/绿。
 * ★ 反例方向要能双向：auto 用例若退化成 human ⇒ 红；human 用例若被误判成 auto ⇒ 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assessTakeover } from '../src/application/design/takeover_assessment.js';

const mkRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-'));
const designDir = (root: string): string => path.join(root, '.agent-io', 'design');

function rm(root: string): void {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows 句柄偶发未释放 */
  }
}

/** 造一本册：节点带内联历史（可选），侧车逐条写 */
function mkBook(
  root: string,
  book: string,
  opts: { nodeId?: string; inline?: unknown[]; sidecar?: unknown[] } = {},
): void {
  const dir = designDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const nodeId = opts.nodeId ?? 'n1';
  fs.writeFileSync(
    path.join(dir, book + '.dsl.json'),
    JSON.stringify({
      feature: book,
      geometry: {
        nodes: [
          {
            id: nodeId,
            type: 'file',
            path: 'src/a.ts',
            decision: { summary: '甲' },
            ...(opts.inline ? { decision_history: opts.inline } : {}),
          },
        ],
      },
    }),
  );
  if (opts.sidecar) {
    fs.writeFileSync(
      path.join(dir, book + '.history.jsonl'),
      opts.sidecar.map((entry, index) => JSON.stringify({ node_id: nodeId, index, entry })).join('\n') + '\n',
    );
  }
}

const HOUR = 3600 * 1000;
const at = (iso: string): Record<string, unknown> => ({ at: iso });
const dec = (iso: string, acceptance: string, summary = '甲'): Record<string, unknown> => ({
  at: iso,
  decision: { summary, acceptance },
});

test('P1-takeover · ① fresh：没有设计册 ⇒ 允许派生、不保留、可写', () => {
  const root = mkRoot();
  try {
    const a = assessTakeover({ projectRoot: root });
    assert.equal(a.scenario, 'fresh');
    assert.equal(a.fork_design, true, 'fresh 必须允许派生设计侧');
    assert.equal(a.preserve_existing, false);
    assert.equal(a.safe_to_write, true);
    assert.equal(a.needs_human.length, 0);
  } finally {
    rm(root);
  }
});

test('P1-takeover · ② resume：册可读且历史形态一致（只有内联）⇒ 不派生、原样保留', () => {
  const root = mkRoot();
  try {
    // 用**语义完备**的条目（带 decision），否则册会被判成"读不出来"
    mkBook(root, 'bk', { inline: [dec('2026-10-01T00:00:00.000Z', '甲说法')] });
    const a = assessTakeover({ projectRoot: root, feature: 'bk' });
    if (a.scenario === 'conflict') {
      // 只有内联、没有侧车 ⇒ 不是冲突；若判成冲突就是回归
      assert.fail('只有内联历史不该判成 conflict：' + a.message);
    }
    assert.equal(a.scenario, 'resume', `实测 ${a.scenario}：${a.message}`);
    assert.equal(a.fork_design, false, 'resume 不许重新派生（会覆盖既有决策）');
    assert.equal(a.preserve_existing, true);
    assert.equal(a.safe_to_write, true);
  } finally {
    rm(root);
  }
});

test('P1-takeover · ③ conflict+auto：两侧时间差 >1h 且语义可相容 ⇒ 自动裁决取较新侧', () => {
  const root = mkRoot();
  try {
    mkBook(root, 'bk', {
      inline: [dec('2026-10-26T02:41:48.033Z', '① 出站一律 council-hub/1；② 入站 2.0 也认。')],
      sidecar: [dec('2026-11-09T12:53:22.124Z', '① 出站一律 council-hub/1；② 入站 2.0 也认；③ 交接包校验失败必须抛。')],
    });
    const a = assessTakeover({ projectRoot: root, feature: 'bk' });
    assert.equal(a.scenario, 'conflict', `实测 ${a.scenario}`);
    assert.equal(a.resolution, 'auto', `时间差 14 天 + 条款子集 ⇒ 应该自动裁决（实测 ${a.resolution}）`);
    assert.ok(a.auto_resolve, '必须给 auto_resolve');
    assert.equal(a.auto_resolve!.authoritative, 'sidecar', '较新侧是 sidecar');
    assert.equal(a.auto_resolve!.absorbed, 'inline', '被淘汰侧是 inline（不删除，记日志）');
    assert.ok(a.auto_resolve!.gap_hours > 1, `时间差应 >1h（实测 ${a.auto_resolve!.gap_hours}）`);
    assert.ok(a.auto_resolve!.basis.some((b) => b.includes('时间差')), '依据必须写时间差');
    assert.ok(a.auto_resolve!.basis.some((b) => b.includes('语义兼容')), '依据必须写兼容性');
    assert.equal(a.safe_to_write, false, '收敛前仍不许写（先跑 migrate）');
    assert.equal(a.needs_human.length, 0, '自动裁决不需要人');
  } finally {
    rm(root);
  }
});

test('P1-takeover · ④ conflict+human：acceptance 含义相反 ⇒ 必须上抛（不许自动选边）', () => {
  const root = mkRoot();
  try {
    mkBook(root, 'bk', {
      inline: [dec('2026-10-26T00:00:00.000Z', '协议必须先校验 payload 再校验 type')],
      sidecar: [dec('2026-11-09T00:00:00.000Z', '协议必须先校验 type 再校验 payload（顺序相反）')],
    });
    const a = assessTakeover({ projectRoot: root, feature: 'bk' });
    assert.equal(a.scenario, 'conflict');
    assert.equal(a.resolution, 'human', `语义矛盾必须上抛（实测 ${a.resolution}）`);
    assert.equal(a.auto_resolve, undefined, '上抛时不许给自动裁决结果');
    assert.ok(a.needs_human.length > 0, '必须点名需要人裁');
    assert.equal(a.safe_to_write, false);
  } finally {
    rm(root);
  }
});

test('P1-takeover · ⑤ 时间戳缺失 / 同轮（≤1h）⇒ 上抛，不许自动', () => {
  const root = mkRoot();
  try {
    // 同轮：差 10 分钟
    mkBook(root, 'bk', {
      inline: [dec('2026-11-09T00:00:00.000Z', '同一句话')],
      sidecar: [dec('2026-11-09T00:10:00.000Z', '同一句话')],
    });
    const a1 = assessTakeover({ projectRoot: root, feature: 'bk' });
    assert.equal(a1.resolution, 'human', `同轮双写不许自动（实测 ${a1.resolution}）`);
  } finally {
    rm(root);
  }
  const root2 = mkRoot();
  try {
    // 缺时间戳（条目里没有 at）
    mkBook(root2, 'bk', {
      inline: [{ decision: { summary: '甲', acceptance: '甲；乙' } }],
      sidecar: [{ decision: { summary: '甲', acceptance: '甲；乙；丙' } }],
    });
    const a2 = assessTakeover({ projectRoot: root2, feature: 'bk' });
    assert.equal(a2.resolution, 'human', `缺 at 不许自动（实测 ${a2.resolution}）`);
  } finally {
    rm(root2);
  }
});

test('P1-takeover · ⑥ supersedes 互指 ⇒ 上抛（谁是新的本身有矛盾）', () => {
  const root = mkRoot();
  try {
    mkBook(root, 'bk', {
      inline: [{ ...dec('2026-10-26T00:00:00.000Z', '同一句话'), supersedes: 'the-other-entry' }],
      sidecar: [{ ...dec('2026-11-09T00:00:00.000Z', '同一句话'), supersedes: 'the-other-entry' }],
    });
    const a = assessTakeover({ projectRoot: root, feature: 'bk' });
    assert.equal(a.scenario, 'conflict');
    assert.equal(a.resolution, 'human', `supersedes 互指必须上抛（实测 ${a.resolution}）`);
  } finally {
    rm(root);
  }
});

export { HOUR, at };
