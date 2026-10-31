/**
 * P0 · **完全没有节点的文件**怎么合法取卡（2026-10-31 实测走通；有节点但 0 判据那半见 `p0_zero_criteria_claim`）。
 *
 * ## 病
 * `docs/SUBAGENT-HANDBOOK.md` 在设计册里**一个节点都没有** ⇒ `publish` 连立卡的前提都不成立
 * （卡要挂在节点上），画布也没有可挂的 `judgement_ref` ⇒ `edit_code` 被计划闸拒
 * ⇒ 当天第 6 次被迫绕开 `edit_code` 用文件工具落盘。
 *
 * ## 本证锁三件事（都是**真状态机 + 真落盘**，不是文本）
 * ① **先建节点**：`edit_dsl {type:'node', op:'add', id, data:{type, label, path}}` 把文件入册
 *    （★ 不是 `type:'file'` 那个 op —— 它改的是 `semantic.files` 的契约条目，不是几何节点）。
 * ② **再走五步**：publish（L1）→ claim（preparing）→ decision.update 补 1 条**语义类**判据
 *    → start（claimed）→ 画布 → `edit_code` 真落盘。
 * ③ **两处"工具在教人做错事"已修**（改前红）：
 *    · `claim` 的补判据模板给的是**存在类**（`signature-matches` + `source-has` / `file-exists` + `source-has`）
 *      ⇒ 当画布 `judgement_ref` 必被 `planJudgementGaps` 挡 ⇒ 模板现在只给 `call-exists` / `run`；
 *    · `expectation.add` 在"节点还没有 decision"时只报「缺 summary」，不指路
 *      ⇒ 现在报文里点名 `decision.update`（唯一能同时落 summary + expectations 的入口）。
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

const OWNER = 'subagent:p0-nonode';
const FEATURE = 'p0nonode';
/** 建节点后的 id（约定 `<file_…>`：`src/nonode.ts` → `file_src_nonode_ts`） */
const NODE = 'file_src_nonode_ts';
const REL = 'src/nonode.ts';

/** 目标文件：两个顶层符号，`nonode()` 调 `helper()`（给 call-exists 判据当锚点） */
const NONODE_TS =
  'export function helper(): number {\n  return 1;\n}\nexport function nonode(): number {\n  return helper();\n}\n';

/** 真项目根（edit_code 要一个能建索引、能落盘的根） */
function writeProject(): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p0nonode-proj-'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, REL), NONODE_TS, 'utf-8');
  return project;
}

/**
 * 设计册：**几何节点为空**（= "该文件在设计册里没有节点"的真实形态）。
 * ★ 不许在这里预先放节点：放了就不是本证要验的那个洞。
 */
function writeSheet(home: string, project: string): void {
  const dsl: DesignDSL = {
    feature: FEATURE,
    title: FEATURE,
    source_root: project,
    geometry: { nodes: [], edges: [] },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${FEATURE}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

/** 画布：一条 rewrite，判据锚在 decision 的 `#0`（语义类 call-exists） */
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
            anchor: { symbol: 'nonode' },
            kind: 'rewrite',
            detail: '建节点 + 五步取卡走通后由 edit_code 落盘：给 nonode.ts 追加一个导出函数',
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

/** 该文件在设计册里有没有节点（= 闸的 `path → node_id` 表里有没有它） */
function nodeOfPath(home: string): Record<string, unknown> | undefined {
  const dsl = readFeature(home, FEATURE) as unknown as { geometry: { nodes: Array<Record<string, unknown>> } };
  return dsl.geometry.nodes.find((n) => n.path === REL);
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

/** 建节点：**唯一的"无节点 ⇒ 有节点"入口**（`type:'node'` + `op:'add'`，不是 `type:'file'`） */
function addNode() {
  return edit(
    [{ op: 'add', type: 'node', id: NODE, data: { type: 'file', label: 'nonode.ts', path: REL } }],
    `给 ${REL} 建设计节点 ${NODE}：该文件在设计册里没有节点，闸的 path → node_id 表里没有它`,
  );
}

// ★ 这条**不是**"改前红"：无节点这条路本来就走得通（`node.add` 一直是合法写操作），
//   缺的是**知道该这么走**（claim 模板教人抄存在类 + 手册没写无节点那一半）—— 那两件由下面两条钉。
test('P0-nonode · ① 无节点 ⇒ 落不了盘；建节点 + 五步 ⇒ edit_code 真落盘', async () => {
  const home = makeTempHome();
  const project = writeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, project);

    // 前置：设计册里确实没有这个文件的节点
    assert.equal(nodeOfPath(home), undefined, '夹具前提：该文件在设计册里**没有**节点');

    // ★ 无节点 ⇒ 没有画布可挂（`judgement_ref` 无处指）⇒ 写被拦（这就是"无路可走"）
    await assert.rejects(
      () => editCode({ project_dir: project, file: REL, op: 'insert', code: 'export function added(): number {\n  return 2;\n}\n', actor: OWNER }),
      (err: Error) => {
        assert.match(err.message, /重写计划闸|没有重写计划/, '无节点的文件落不了盘（画布无处挂判据）');
        return true;
      },
    );
    assert.equal(fs.readFileSync(path.join(project, REL), 'utf-8'), NONODE_TS, '被拒 ⇒ 一个字节都没落盘');

    // ⓪ 建节点：让该文件第一次进闸的 `path → node_id` 表
    await addNode();
    assert.equal(nodeOfPath(home)?.id, NODE, 'node.add 之后该路径必须指向新节点');

    // ① 立卡：无 decision ⇒ **L1 建构卡（0 条期望）**，不是拒绝
    const pub = await edit([{ op: 'publish', type: 'task', id: NODE }], `给节点 ${NODE}（${REL}）立卡`);
    assert.equal((pub.data as { level?: string }).level, 'L1');
    assert.equal(cardOf(home)?.state, 'candidate');

    // ② 领卡：后态判据 0 条 ⇒ preparing（领了但**没有写权**）
    await edit([{ op: 'claim', type: 'task', id: NODE, data: { owner: OWNER } }], `领取节点 ${NODE} 的卡（${REL}）`);
    assert.equal(cardOf(home)?.state, 'preparing');

    // ③ 补判据：首版 decision（summary + 1 条**语义类** call-exists）
    await edit(
      [
        {
          op: 'update',
          type: 'decision',
          id: NODE,
          data: {
            summary: `${REL}：无节点文件的取卡实测落点（nonode() 转调 helper()）。`,
            expectations: [
              {
                kind: 'call-exists',
                path: REL,
                symbol: 'nonode',
                target: 'helper',
                why: '语义类判据（能发现逻辑错）：nonode() 必须转调 helper() —— 这条同时是画布 judgement_ref 的锚点（存在类解不开画布）',
              },
            ],
          },
        },
      ],
      `给节点 ${NODE} 写首版决策卡 + 1 条 call-exists 判据（${REL}）`,
    );

    // ④ 开工：preparing → claimed（**这时才有写权**）
    await edit([{ op: 'start', type: 'task', id: NODE, data: { owner: OWNER } }], `判据已就位，开工节点 ${NODE}（${REL}）`);
    assert.equal(cardOf(home)?.state, 'claimed');

    // ⑤ 落盘：画布 + edit_code
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

test('P0-nonode · claim 的补判据模板只给语义类（不再教人抄存在类 · 改前红）', async () => {
  const home = makeTempHome();
  const project = writeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, project);
    await addNode();
    await edit([{ op: 'publish', type: 'task', id: NODE }], `给节点 ${NODE}（${REL}）立卡`);
    const claim = await edit([{ op: 'claim', type: 'task', id: NODE, data: { owner: OWNER } }], `领取节点 ${NODE} 的卡（${REL}）`);

    const msg = String(claim.message);
    const missing = (claim.data as { missing?: { kinds?: string[]; templates?: string[]; lines?: string[] } }).missing;
    assert.ok(missing, 'claim 进 preparing 必须给出"补哪几条"的照做清单');
    /** ★ 照做清单住 `data.missing.lines`（不在顶层 message 里）⇒ 三处合起来看才是人真正读到的全部 */
    const full = [msg, ...(missing.lines ?? []), ...(missing.templates ?? [])].join('\n');

    // ★ 改前红：旧模板给的是存在类（`signature-matches` + `source-has` / `file-exists` + `source-has`）
    //   ⇒ 照抄 = 第 5 步必被计划闸挡。现在：**推荐的 kinds** 与**模板 JSON** 里都不许再有存在类
    //   （回执里可以**点名它们以劝阻** —— 那不是推荐，所以判的是 kinds 与 templates，不是全文）。
    const EXISTENCE = ['file-exists', 'symbol-exists', 'signature-matches', 'source-has'];
    for (const k of missing.kinds ?? []) {
      assert.ok(!EXISTENCE.includes(k), `claim 不许推荐存在类判据（收到 ${k}）`);
    }
    assert.match(full, /要补 \*\*\d+ 条\*\*：run/, '无符号节点只该推荐 run（存在类当不了 judgement_ref）');
    for (const t of missing.templates ?? []) {
      assert.doesNotMatch(t, /"kind":"(signature-matches|source-has|file-exists|symbol-exists)"/, '模板 JSON 不许给存在类');
    }

    // ★ 必须给的是语义类（该节点没有 semantic.files 符号 ⇒ 只给 run）
    assert.deepEqual(missing.kinds, ['run'], '无符号节点只该推荐 run（求值域有 fs / path / root，可写内容契约）');
    assert.ok(
      (missing.templates ?? []).some((t) => t.includes('"kind":"run"')),
      '模板里必须有一条可直接粘的 run 判据',
    );
    assert.match(full, /别用存在类/, '回执必须说清"为什么存在类当不了 judgement_ref"');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-nonode · expectation.add 首版被拒时，报文必须指路 decision.update（改前红）', async () => {
  const home = makeTempHome();
  const project = writeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, project);
    await addNode();

    // 节点**还没有 decision** ⇒ expectation.add 只加单条、带不了 summary
    await assert.rejects(
      () =>
        edit(
          [
            {
              op: 'expectation.add',
              type: 'decision',
              id: NODE,
              data: { expectation: { kind: 'call-exists', path: REL, symbol: 'nonode', target: 'helper', why: '先试 expectation.add' } },
            },
          ],
          `给 ${NODE} 补判据（先试 expectation.add）`,
        ),
      (err: Error) => {
        assert.match(err.message, /缺 `summary`/, '仍然要说清缺什么');
        assert.match(err.message, /decision\.update/, '★ 必须指路 decision.update（改前只说"缺 summary"，不说该改走哪条路）');
        return true;
      },
    );
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
