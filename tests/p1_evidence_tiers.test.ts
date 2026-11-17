/**
 * touches: src/domain/judge_port.ts, src/application/design/intent/expectations.ts, scripts/judge-all.mjs
 *
 * P1 · 判据证据分级（五态裁决**只读版**）。
 *
 * 守的是"报告层有分级、有假设点名、可消融"，不改四值 verdict 语义：
 * ① 映射表穷尽（新 kind 漏标编译期由 Record 钉死，运行期再断言一次键集不空）
 * ② 完整 kind ⇒ tier 映射（behavior/run ⇒ tested · runtime ⇒ measured · 文件/边类 ⇒ read_directly · source-has ⇒ documented）
 * ③ source-has 默认 documented（二手）需引源；checkEvidenceMark 无 cited ⇒ 报
 * ④ assumption 显式标注 + next_verify ⇒ 报告层 assumptionItems 点名 + 分布计数
 * ⑤ 五道自检（tier 非法 / 缺 cited / 缺 next_verify / 缺 basis）逐条可判
 * ⑥ 不填 evidence 的旧 JudgeItem ⇒ verdict / checked 与改动前逐值一致（向后兼容）
 * ⑦ judge-all 的 evidenceOfItems 报告层：分布 + assumption 点名；读不到 ⇒ 按最弱算
 * ⑧ 消融：把映射置空后，kind 默认落 assumption 且点名清单跟着变（红→绿可判性）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EVIDENCE_TIER_BY_KIND,
  EVIDENCE_TIERS,
  checkEvidenceMark,
  judgeExpectations,
} from '../src/application/design/intent/expectations.ts';
import { EXPECTATION_KINDS } from '../src/domain/expectation_kinds.ts';

// ── ① 映射表穷尽：注册表里每个 kind 都有一个 tier（类型层 Record 已钉死，这里防运行期退化）──
test('① kind ⇒ 默认 tier 映射覆盖全部注册 kind，且 tier 都在七档内', () => {
  assert.ok(EXPECTATION_KINDS.length > 0, '注册表不许为空（空表会让穷尽断言恒真）');
  for (const k of EXPECTATION_KINDS) {
    const tier = EVIDENCE_TIER_BY_KIND[k];
    assert.ok(EVIDENCE_TIERS.includes(tier), `kind ${k} 缺默认 tier 或 tier 非法：${String(tier)}`);
  }
  assert.deepEqual([...EVIDENCE_TIERS].sort(), [...new Set(EVIDENCE_TIERS)].sort(), '七档不许重复');
});

// ── ② 完整映射表逐项核定（写死期望，改错一处就红）──
test('② 12 个 kind 的默认 tier 与裁定表逐字一致', () => {
  assert.deepEqual({ ...EVIDENCE_TIER_BY_KIND }, {
    'behavior-cases': 'tested', 'journey-cases': 'tested', 'run': 'tested',
    'runtime': 'measured',
    'file-exists': 'read_directly', 'symbol-exists': 'read_directly', 'signature-matches': 'read_directly',
    'call-exists': 'read_directly', 'edge-exists': 'read_directly', 'edge-absent': 'read_directly',
    'domain-independent': 'read_directly',
    'source-has': 'documented',
  });
});

// ── ③ source-has 二手需引源 ──
test('③ documented / community_practice 缺 cited ⇒ checkEvidenceMark 报；assumption 缺 next_verify 同理', () => {
  assert.deepEqual(checkEvidenceMark({ tier: 'documented', basis: '文本含串' }), ['documented 必须引源（cited 缺失）']);
  assert.deepEqual(checkEvidenceMark({ tier: 'community_practice', basis: '惯例' }), ['community_practice 必须引源（cited 缺失）']);
  assert.deepEqual(checkEvidenceMark({ tier: 'assumption', basis: '猜' }), ['assumption 必须给下一步验证步骤（next_verify 缺失）']);
  assert.deepEqual(checkEvidenceMark({ tier: 'tested', basis: '' }), ['依据 basis 缺失']);
  assert.deepEqual(checkEvidenceMark({ tier: 'documented', basis: '文本含串', cited: 'docs/X.md' }), []);
  assert.deepEqual(checkEvidenceMark({ tier: 'assumption', basis: '猜', next_verify: '跑 X 量具' }), []);
});

// ── ④⑤⑥ 真判定器 smoke（file-exists 便宜且真实，不需要索引/解析器预热）──
function makeProj() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1ev-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const x = 1;\n', 'utf8');
  return dir;
}

test('④ 真判定器：每条 item 都带 evidence；file-exists ⇒ read_directly，source-has ⇒ documented', async () => {
  const root = makeProj();
  const rep = await judgeExpectations(root, [
    { node_id: 'n_fe', node_label: '文件', expectation: { kind: 'file-exists', path: 'src/a.ts', why: 'w' } },
    { node_id: 'n_sh', node_label: '文本', expectation: { kind: 'source-has', path: 'src/a.ts', must: ['x'], why: 'w' } },
    { node_id: 'n_run', node_label: '跑', expectation: { kind: 'run', expect: 'true', why: 'w' } },
  ]);
  const byId = Object.fromEntries(rep.items.map((i) => [i.node_id, i]));
  assert.equal(byId.n_fe.evidence.tier, 'read_directly');
  assert.equal(byId.n_sh.evidence.tier, 'documented');
  assert.equal(byId.n_run.evidence.tier, 'tested');
  // ★ D1：索引派生边的 basis 注明来源（这里断言 file-exists 的 basis 是 kind 默认、不含未定义）
  assert.match(byId.n_fe.evidence.basis, /kind 默认映射：file-exists/);
  assert.equal(byId.n_fe.evidence.derivedFrom, 'kind-default');
  assert.ok(rep.evidenceTierCounts, '报告层必须有分级分布');
  assert.equal(rep.evidenceTierCounts.tested, 1);
  assert.equal(rep.evidenceTierCounts.documented, 1);
  assert.equal(rep.evidenceTierCounts.read_directly, 1);
});

test('⑤ assumption 显式标注 + next_verify ⇒ 报告层逐条点名（下一步验证清单）', async () => {
  const root = makeProj();
  const rep = await judgeExpectations(root, [
    { node_id: 'n_ok', node_label: '实', expectation: { kind: 'file-exists', path: 'src/a.ts', why: 'w' } },
    {
      node_id: 'n_as', node_label: '假设',
      expectation: { kind: 'run', expect: 'true', why: 'w' },
      evidence: { tier: 'assumption', basis: '未验证的推断', next_verify: '跑一次 X 量具' },
    },
  ]);
  assert.deepEqual(rep.assumptionItems, ['n_as']);
  assert.equal(rep.evidenceTierCounts.assumption, 1);
  const as = rep.items.find((i) => i.node_id === 'n_as');
  assert.equal(as.evidence.derivedFrom, 'explicit', '显式标注不能被默认映射覆盖');
  assert.equal(as.evidence.next_verify, '跑一次 X 量具');
});

test('⑥ 不填 evidence 的旧 JudgeItem ⇒ verdict / checked 逐值不变（向后兼容）', async () => {
  const root = makeProj();
  const items = [
    { node_id: 'n1', node_label: 'a', expectation: { kind: 'file-exists', path: 'src/a.ts', why: 'w' } },
    { node_id: 'n2', node_label: 'b', expectation: { kind: 'file-exists', path: 'src/missing.ts', why: 'w' } },
  ];
  const rep = await judgeExpectations(root, items);
  assert.equal(rep.checked, items.length);
  assert.deepEqual(rep.items.map((i) => i.verdict), ['pass', 'fail']);
  assert.equal(rep.passed, 1);
  assert.equal(rep.failed, 1);
});

test('⑧ 消融：映射置空 ⇒ kind 默认落 assumption、点名清单跟着变（红→绿可判性）', async () => {
  const root = makeProj();
  const saved = { ...EVIDENCE_TIER_BY_KIND };
  try {
    for (const k of Object.keys(EVIDENCE_TIER_BY_KIND)) delete EVIDENCE_TIER_BY_KIND[k];
    const rep = await judgeExpectations(root, [
      { node_id: 'n_ablate', node_label: '消融', expectation: { kind: 'run', expect: 'true', why: 'w' } },
    ]);
    assert.equal(rep.evidenceTierCounts.assumption, 1);
    assert.equal(rep.evidenceTierCounts.tested, 0);
    assert.deepEqual(rep.assumptionItems, ['n_ablate'], '删映射 ⇒ 报告层红且点名可定位');
  } finally {
    Object.assign(EVIDENCE_TIER_BY_KIND, saved);
  }
});

// ── ⑦ judge-all 报告层（纯文本读脚本源，断言聚合函数存在且口径写死）──
test('⑦ judge-all 报告层：distribution + assumption 点名 + 缺引源警告，读不到按最弱档', () => {
  const src = fs.readFileSync(path.resolve('scripts/judge-all.mjs'), 'utf8');
  assert.match(src, /function evidenceOfItems\(items\)/, '报告聚合函数必须在 judge-all 一处');
  assert.match(src, /ev\?\.tier \?\? 'assumption'/, '读不到 ⇒ 按最弱算（0.12）');
  assert.match(src, /EVIDENCE_TIERS\.map/, '分布必须按七档顺序手算可复核');
  assert.match(src, /assumption 级判据（下一步验证清单/, '必须逐条点名 assumption');
  assert.match(src, /badMarks/, '五道自检未过必须响亮点名（首版只警告）');
  // D3：空清单打"（无）"，不假装缺
  assert.match(src, /: '（无）'/, 'assumption 空清单必须显式写"（无）"');
});
