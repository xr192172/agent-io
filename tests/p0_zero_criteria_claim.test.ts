/**
 * P0 · **零判据节点怎么合法取卡**（2026-10-31 实测走通的那条路，逐步回执见当日 memory）。
 *
 * ## 病
 * 写闸要求「该文件有节点 ∧ 节点上有 state=claimed 的卡」，而**节点存在但没有判据**时
 * （`task.state=null` / `decision.expectations=[]`）取卡路径不通 ⇒ 人只能**绕开 `edit_code`**
 * 用文件工具落盘（2026-10-31 当天被迫绕 5 次）。退役 574 条判据后 27 个节点降到 0 判据
 * ⇒ 这个洞从"偶尔"变成"常见"。
 *
 * ## 本证锁三件事（都是**状态机 + 真落盘**，不是文本）
 * ① **拒绝必须指路**：`edit_code` 在"无卡"时被任务闸拒，且拒绝文案**逐字给出五步**
 *    （① 立卡 ② 领卡 ③ 补判据 ④ 开工 ⑤ 落盘）+ 一句"为什么不能跳过"。
 *    ★ **改前红**：改前那段只写 `publish + claim` 两步，`③ 补判据` / `④ 开工` / `⑤ 落盘` 一条都没有。
 * ② **五步真能走通**：publish（L1 建构卡）→ claim（**preparing**，领了但不能开工）
 *    → decision.update 补 1 条**语义类**判据 → start（claimed）→ edit_code 落盘。
 * ③ **两个坑写进证里**（都是 2026-10-31 实测撞到的，不是推测）：
 *    · 节点**还没有 decision** 时 `expectation.add` 会被拒（它不带 summary ⇒ 决策卡缺 summary）；
 *    · 计划闸只认**语义类**判据当 `judgement_ref`（存在类解不开画布）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { updateFeature } from '../src/application/design/dsl_ops/update_feature.js';
import { editCode } from '../src/application/refactor/edit/edit_code.js';
import { makeTempHome, readFeature, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

const OWNER = 'subagent:p0-zero';
const FEATURE = 'p0zero';
const NODE = 'zero_node';
const REL = 'src/zero.ts';

/** 目标文件：两个顶层符号，`zero()` 调 `helper()`（给 call-exists 判据当锚点） */
const ZERO_TS =
  'export function helper(): number {\n  return 1;\n}\nexport function zero(): number {\n  return helper();\n}\n';

/** 真项目根（edit_code 要一个能建索引、能落盘的根） */
function writeProject(): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p0zero-proj-'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, REL), ZERO_TS, 'utf-8');
  return project;
}

/**
 * 设计册：**一个文件节点，没有 decision、没有 task**（= 零判据节点的真实形态）。
 * ★ 不许在这里预先塞 decision：塞了就不是本证要验的那个洞。
 */
function writeSheet(home: string, project: string): void {
  const dsl: DesignDSL = {
    feature: FEATURE,
    title: FEATURE,
    source_root: project,
    geometry: {
      nodes: [{ id: NODE, label: 'zero.ts', type: 'file', path: REL, x: 0, y: 0 }],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${FEATURE}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

/** 画布：一条 rewrite，判据锚在本证第③步写进去的那条 call-exists（`#0`，语义类） */
function writePlan(project: string): void {
  const p = path.join(project, '.agent-io', 'plan', `${REL}.plan.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        path: REL,
        entries: [
          {
            anchor: { symbol: 'zero' },
            kind: 'rewrite',
            detail: '五步取卡走通后由 edit_code 落盘：给 zero.ts 追加一个导出函数',
            judgement_ref: `decision:${NODE}#0`,
            status: 'open',
          },
        ],
      },
      null,
      2,
    ),
    'utf-8',
  );
}

/** 卡在哪（`todos[]` 优先 —— 读端只认它；`geometry.nodes[].task` 是派生投影） */
function cardOf(home: string): Record<string, unknown> | undefined {
  const dsl = readFeature(home, FEATURE) as unknown as {
    geometry: { nodes: Array<Record<string, unknown>> };
    todos?: Array<Record<string, unknown>>;
  };
  const fromTodo = (dsl.todos ?? []).find((t) => t.id === NODE);
  if (fromTodo) return fromTodo;
  return dsl.geometry.nodes.find((n) => n.id === NODE)?.task as Record<string, unknown> | undefined;
}

/** edit_dsl 的唯一写入口（真入口：op spec / L3 reason 实体校验 / 原子回滚都在里面） */
function edit(operations: Array<Record<string, unknown>>, reason: string) {
  return updateFeature({
    feature: FEATURE,
    operations: operations as never,
    agent: OWNER,
    reason,
    weight: 'routine',
  } as never);
}

test('P0-zero · ① 拒绝必须指路：任务闸的文案逐字给出五步 + 为什么不能跳过（改前红）', async () => {
  const home = makeTempHome();
  const project = writeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, project);

    await assert.rejects(
      () => editCode({ project_dir: project, file: REL, op: 'replace_text', old_text: 'return 1;', new_text: 'return 1;', actor: OWNER }),
      (err: Error) => {
        assert.match(err.message, /拒绝落盘（任务闸）/, '零判据节点必须被任务闸拦下（这就是那个洞）');
        // ★ 五步必须逐字在（改前只有 publish + claim 两步 ⇒ 这三条断言就是"先红"）
        assert.match(err.message, /① 立卡/, '第①步（publish 立 L1 建构卡）必须在拒绝文案里');
        assert.match(err.message, /② 领卡/, '第②步（claim 进 preparing）必须在拒绝文案里');
        assert.match(err.message, /③ 补判据/, '第③步（decision.update 补语义类判据）必须在拒绝文案里');
        assert.match(err.message, /④ 开工/, '第④步（start 才进 claimed）必须在拒绝文案里');
        assert.match(err.message, /⑤ 落盘/, '第⑤步（edit_code）必须在拒绝文案里');
        assert.match(err.message, /为什么不能跳过/, '必须说清"不领卡就改 = 没人对这笔改动负责"');
        assert.match(err.message, /expectation\.add/, '第③步必须点名首版不能用 expectation.add（它不带 summary）');
        assert.match(err.message, /语义类/, '第③步必须点名"语义类"（存在类当不了 judgement_ref）');
        return true;
      },
    );
    // 拒绝 ⇒ 一个字节都没落盘
    assert.equal(fs.readFileSync(path.join(project, REL), 'utf-8'), ZERO_TS);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-zero · ②③④⑤ 五步走通：candidate → preparing → claimed → edit_code 落盘', async () => {
  const home = makeTempHome();
  const project = writeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, project);

    // ① 立卡：零判据节点 ⇒ **L1 建构卡（0 条期望）**，不是拒绝
    const pub = await edit([{ op: 'publish', type: 'task', id: NODE }], `给节点 ${NODE}（${REL}）立卡`);
    assert.equal((pub.data as { level?: string }).level, 'L1');
    assert.equal(cardOf(home)?.state, 'candidate');

    // ② 领卡：后态判据 0 条 ⇒ preparing（领了但**没有写权**）
    await edit([{ op: 'claim', type: 'task', id: NODE, data: { owner: OWNER } }], `领取节点 ${NODE} 的卡（${REL}）`);
    assert.equal(cardOf(home)?.state, 'preparing');
    assert.ok(cardOf(home)?.prepared_snapshot, 'preparing 必须留事务快照（放弃/超时的还原依据）');

    // ★ 坑 A（实测）：节点**还没有 decision** ⇒ expectation.add 被拒（它不带 summary）
    await assert.rejects(
      () =>
        edit(
          [
            {
              op: 'expectation.add',
              type: 'decision',
              id: NODE,
              data: { expectation: { kind: 'call-exists', path: REL, symbol: 'zero', target: 'helper', why: '先试 expectation.add' } },
            },
          ],
          `给 ${NODE} 补判据（先试 expectation.add）`,
        ),
      (err: Error) => {
        assert.match(err.message, /缺 `summary`/, '首版判据必须走 decision.update（一次给 summary + expectations）');
        return true;
      },
    );

    // ③ 补判据：首版 decision（summary + 1 条**语义类** call-exists）
    await edit(
      [
        {
          op: 'update',
          type: 'decision',
          id: NODE,
          data: {
            summary: `${REL}：零判据节点的取卡实测落点（zero() 转调 helper()）。`,
            expectations: [
              {
                kind: 'call-exists',
                path: REL,
                symbol: 'zero',
                target: 'helper',
                why: '语义类判据（能发现逻辑错）：zero() 必须转调 helper() —— 这条同时是画布 judgement_ref 的锚点（存在类解不开画布）',
              },
            ],
          },
        },
      ],
      `给节点 ${NODE} 写首版决策卡 + 1 条 call-exists 判据（${REL}）`,
    );

    // ④ 开工：preparing → claimed（删快照 + 改态一次落盘；**这时才有写权**）
    await edit([{ op: 'start', type: 'task', id: NODE, data: { owner: OWNER } }], `判据已就位，开工节点 ${NODE}（${REL}）`);
    assert.equal(cardOf(home)?.state, 'claimed');
    assert.equal(cardOf(home)?.prepared_snapshot, null, 'start 必须把快照用掉（它不是历史）');

    // ⑤ 落盘：画布 + edit_code（任务闸这一关现在过了）
    writePlan(project);
    const r = await editCode({
      project_dir: project,
      file: REL,
      op: 'insert',
      code: 'export function added(): number {\n  return 2;\n}\n',
      actor: OWNER,
    });
    assert.match(r.message, /已创建|已插入|insert/i);
    const after = fs.readFileSync(path.join(project, REL), 'utf-8');
    assert.match(after, /export function added\(\): number/, 'edit_code 必须真的把新函数写进盘');
    assert.match(after, /export function helper\(\): number/, '原内容不许被破坏');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
