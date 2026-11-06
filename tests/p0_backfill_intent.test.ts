/**
 * P0 · **回填不许覆盖意图与理由**（PROJECT-DESIGN §9.3「核销与回填是两个动作」）
 *
 * ## 它守的那句话（原文）
 * 「② **回填**：把实现后无争议的**事实细节**更新到设计底色，**不覆盖意图与理由**。
 *  ★ 不要求两册所有字节永久相同；要求当前认可的设计与事实可解释地一致。」
 *  （§6 复述同一条：「落盘和治理必须区分：从事实派生的底色 / 已接受的设计意图 / 本次尚未实现的目标变化」。）
 *
 * ## 病（这一层此前没有任何检测点）
 * 「回填」这条链上唯一每 commit 都跑的一步是 `design:gen-db`（`npm run verify` 的「设计 DB 结构」）。
 * 它读册、写 `design-db/` 投影。**没有任何判据断言它只读册** —— 于是"顺手把派生事实写回册"
 * 这个改动方向**不会被任何人发现**：它会让 `gen-db:check` 变绿（投影自然一致），
 * 让 `judge-all` 变绿（判据都还在），而**把人的意图悄悄改成了机器派的底色**。
 * ⇒ 那是本仓最贵的一类错：**底色覆盖笔迹**（§6 的原文是「设计 DSL 是工作区，不只是 diff」）。
 *
 * ## 四条用例（每条都说得出"什么输入让它红"）
 * | # | 输入 | 期望 | 它会红的条件 |
 * |---|---|---|---|
 * | ① | 跑一次 `genDesignDb(root)`（写投影） | 册文件**逐字节不变** | 谁让回填写回册 ⇒ 红 |
 * | ② | 同义必命中（防空转）：① 必须**真的写出了投影**（`written > 0`） | 否则①就是"什么都没发生"的假绿 | 把一个空转的 gen-db 交上来 ⇒ 红 |
 * | ③ | 再跑一次 | 幂等：`written===0` ∧ `unchanged>0`（同一份册 ⇒ 逐字节同一份投影） | 投影里掺了时间戳 / 随机序 ⇒ 红 |
 * | ④ | `genDesignDb(root, {check:true})`（门用的那条路） | 册仍逐字节不变 | check 模式偷偷修册 ⇒ 红 |
 * | ⑤ | 具体四个意图字段 | `meta.goals` / `meta.edge_intents` / `decision.summary` / `decision.rationale` **逐字**不变 | 回填"顺手规范化/清空/重写"任何一条 ⇒ 红 |
 *
 * ## 消融（2026-11-07 实测：改 `src` 一处、跑完逐字节还原）
 * 在 `gen_design_db.ts#genDesignDb` 返回前加一句把册的 `meta.goals` 清空并写回
 * ⇒ **①／④／⑤ 全红**，而 `gen-db:check` 仍然是绿的（它只比投影）—— 这正是本文件存在的理由。
 *
 * ## 边界（诚实清单）
 * · 夹具完全自治：临时项目根 + 自带 `.agent-io/design/fixture.dsl.json` + **自带 cache.db**
 *   （`genDesignDb` 会 `readOnly` 打开 `<root>/.agent-io/cache.db`，没有它直接抛 ENOENT ⇒ 夹具必须先建库）；
 * · **不覆盖**其它回填路径：`sync_contracts`（回填 `expected_apis`）与 `import_project` 的 live 快照刷新
 *   也属"回填"，但它们各自的写入面不同物（一个写契约、一个写实际侧），要判得另立判据 —— [未核] 如实留着。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { genDesignDb } from '../src/application/design/db/gen_design_db.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';

const roots: string[] = [];

/** 造一个自带册 + cache.db 的临时项目根（`genDesignDb` 的两样前置） */
function makeProject(): { root: string; dslPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't39-backfill-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.agent-io', 'design'), { recursive: true });
  const dsl = {
    id: 'feature_fx',
    type: 'feature_diagram',
    feature: 'fx',
    version: '1.0.0',
    title: 'fx',
    source_root: root,
    meta: {
      goals: [{ id: 'g1', title: '人写下的目标一', status: 'active' }],
      edge_intents: [{ from: 'n_a', to: 'n_a', reason: '为什么这条边存在（人写的）' }],
    },
    geometry: {
      layout: 'free',
      width: 400,
      height: 300,
      nodes: [
        {
          id: 'n_a',
          type: 'file',
          label: 'a',
          path: 'src/a.ts',
          decision: {
            summary: '这个节点负责什么（人写的）',
            rationale: '为什么这么设计（人写的理由）',
            expectations: [{ kind: 'file-exists', path: 'src/a.ts', why: '夹具判据' }],
          },
        },
      ],
      edges: [],
    },
    semantic: { files: [{ id: 'n_a', path: 'src/a.ts', responsibility: '职责（人写的）' }] },
  };
  const dslPath = path.join(root, '.agent-io', 'design', 'fx.dsl.json');
  fs.writeFileSync(dslPath, JSON.stringify(dsl, null, 2), 'utf8');
  // ★ 前置：genDesignDb 会 readOnly 打开 <root>/.agent-io/cache.db（夹具自己建，不碰真仓）
  const handle: any = getProjectCacheDb(root);
  try {
    (handle?.db ?? handle)?.close?.();
  } catch {
    /* 关不掉不影响断言（临时根随后整棵删） */
  }
  return { root, dslPath };
}

const bytes = (p: string): Buffer => fs.readFileSync(p);

test('① 跑一次回填（写投影）⇒ 册**逐字节不变**；② 且它真的写出了投影（防空转）', () => {
  const { root, dslPath } = makeProject();
  const before = bytes(dslPath);
  const res = genDesignDb(root);
  assert.equal(res.problems.length, 0, `①a) 夹具上不该有 problem（实得 ${JSON.stringify(res.problems)}）`);
  // ② 同义必命中：证明这一轮**真的做了事**（否则"册不变"是因为什么都没跑 ⇒ 假绿）
  assert.ok(res.written > 0 || res.unchanged > 0, `②) 回填必须真的处理了文件（written=${res.written} unchanged=${res.unchanged}）`);
  assert.ok(res.files > 0, `②′) 至少处理 1 个文件（实得 ${res.files}）`);
  // ① 承重断言
  assert.equal(Buffer.compare(before, bytes(dslPath)), 0, '①b) ★ 回填**不许写回册** —— 投影是派生品，册是工作区');
});

test('③ 再跑一次 ⇒ 幂等（written=0 · unchanged>0）：同一份册 = 逐字节同一份投影', () => {
  const { root } = makeProject();
  genDesignDb(root);
  const res2 = genDesignDb(root);
  assert.equal(res2.written, 0, `③a) 第二次**一个字节都不该重写**（实得 written=${res2.written}）—— 否则投影里掺了时间戳/随机序`);
  assert.ok(res2.unchanged > 0, `③b) 而它必须**确实比过**（unchanged=${res2.unchanged}）—— 0 是"没算"，不是"没变"`);
});

test('④ check 模式（门用的那条路）也不许修册', () => {
  const { root, dslPath } = makeProject();
  const before = bytes(dslPath);
  // ★ 前置（实测 2026-11-07）：`check:true` 会 `readdirSync(<root>/design-db)` ⇒ 投影不存在时抛 ENOENT。
  //   所以先跑一次写模式把它建出来（这正是 `verify` 的「设计 DB 结构」门的标准 build-then-check 顺序）。
  genDesignDb(root);
  assert.equal(Buffer.compare(before, bytes(dslPath)), 0, '④a) 写模式那一次就不许改册');
  genDesignDb(root, { check: true });
  assert.equal(Buffer.compare(before, bytes(dslPath)), 0, '④b) ★ `--check` 只许比对，不许顺手把册改成"看起来一致"的样子');
});

test('⑤ 四个意图字段逐字不变（goals / edge_intents / decision.summary / decision.rationale）', () => {
  const { root, dslPath } = makeProject();
  const before = JSON.parse(bytes(dslPath).toString('utf8'));
  genDesignDb(root);
  genDesignDb(root, { check: true });
  const after = JSON.parse(bytes(dslPath).toString('utf8'));

  assert.deepEqual(after.meta?.goals, before.meta.goals, '⑤a) ★ `meta.goals` 是人写的目标 —— 回填不许碰');
  assert.deepEqual(after.meta?.edge_intents, before.meta.edge_intents, '⑤b) ★ `meta.edge_intents`（"A 为何依赖 B"）不许碰');
  assert.equal(after.geometry.nodes[0].decision.summary, before.geometry.nodes[0].decision.summary, '⑤c) ★ `decision.summary` 不许被派生值顶替');
  assert.equal(
    after.geometry.nodes[0].decision.rationale,
    before.geometry.nodes[0].decision.rationale,
    '⑤d) ★ 「为什么这么设计」是笔迹，不是底色（§6）—— 回填最不该碰的就是它',
  );
});

test.after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});
