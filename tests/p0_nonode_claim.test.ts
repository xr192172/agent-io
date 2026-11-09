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
 * ② **再走五步**：publish（L1）→ claim（preparing）→ decision.update 补**到门槛 N 条**语义类判据
 *    → start（claimed）→ 画布 → `edit_code` 真落盘。
 *    ★ 2026-11-01（首跑墙 ②）：「要补 N 条」与 `start` 的放行条件是**同一个数** ⇒ 本证补到 **N-1** 条时
 *      断言 `start` **被拒**，补到 **N** 条才过（改前 N=2 而补 1 条就过，"要补 N 条"于是没人信）。
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
import { writeRewritePlan, type RewritePlan } from '../src/application/design/db/rewrite_plan.js';
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
  // ★ 2026-11-02（subagent:canvas-db）：画布已入库（`tasks.db#plans`）—— 不再有盘上的 `.plan.json`
  writeRewritePlan(project, {
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
    // ★ 2026-11-05（R12② 迁移）：`E-PLAN-010` 真拦后画布要逐个顶层符号表态（本证只改 `nonode`）
    untouched: [{ symbol: 'helper', why: '本证只给 nonode 追加导出，helper 原样不动' }],
  } as RewritePlan);
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
// ★★ 2026-11-01（首跑墙 ②）：**"无节点 ⇒ 落不了盘"单独一条**（独立现场）——
//   它必须在"还没有节点"的前提下判，而后面那条要建节点；混在一条里就得在同一个现场先撞一次 `edit_code`，
//   那一次撞会顺手把索引建起来，让 `criteriaGap` 的 `need` 从 1 变成 2，把五步那条的读数搅浑。
test('P0-nonode · ⓪ 无节点 ⇒ 落不了盘（画布无处挂判据），且一个字节都没落', async () => {
  const home = makeTempHome();
  const project = writeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, project);
    assert.equal(nodeOfPath(home), undefined, '夹具前提：该文件在设计册里**没有**节点');
    await assert.rejects(
      () => editCode({ project_dir: project, file: REL, op: 'insert', code: 'export function added(): number {\n  return 2;\n}\n', actor: OWNER }),
      (err: Error) => {
        assert.match(err.message, /重写计划闸|没有重写计划/, '无节点的文件落不了盘（画布无处挂判据）');
        return true;
      },
    );
    assert.equal(fs.readFileSync(path.join(project, REL), 'utf-8'), NONODE_TS, '被拒 ⇒ 一个字节都没落盘');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-nonode · ① 建节点 + 五步 ⇒ edit_code 真落盘', async () => {
  const home = makeTempHome();
  const project = writeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, project);
    assert.equal(nodeOfPath(home), undefined, '夹具前提：该文件在设计册里**没有**节点');

    // ⓪ 建节点：让该文件第一次进闸的 `path → node_id` 表
    await addNode();
    assert.equal(nodeOfPath(home)?.id, NODE, 'node.add 之后该路径必须指向新节点');

    // ① 立卡：无 decision ⇒ **L1 建构卡（0 条期望）**，不是拒绝
    const pub = await edit([{ op: 'publish', type: 'task', id: NODE }], `给节点 ${NODE}（${REL}）立卡`);
    assert.equal((pub.data as { level?: string }).level, 'L1');
    assert.equal(cardOf(home)?.state, 'candidate');

    // ② 领卡：判据不够 ⇒ **原子拒领**（T-28 后没有"领了不能干"的中间态）
    const claim = await edit([{ op: 'claim', type: 'task', id: NODE, data: { owner: OWNER } }], `领取节点 ${NODE} 的卡（${REL}）`);
    assert.match(String(claim.message), /未领取/, '回执必须点名"未领取"');
    assert.equal(cardOf(home)?.state, 'candidate', '拒领 ⇒ state 仍 candidate');
    assert.equal(cardOf(home)?.owner ?? null, null, '拒领 ⇒ owner 仍为空');
    /** ★ T-35：claim 说"要补 N 条" ⇒ N **就是** claim 放行的门槛（同一个数，唯一住处 = criteriaNeedOf().need）。 */
    const need = Number((claim.data as { missing?: { need?: number } }).missing?.need ?? 0);
    assert.ok(need >= 1, `claim 必须给出"要补几条"这个门槛（实测 need=${need}）`);

    // ③ 补判据：首版 decision（summary + **到门槛 need 条**语义类判据）
    //   ★ 2026-11-01（首跑墙 ②）：门槛是 `need`（claim 回执里那个数）⇒ 本证一次补到 N 条。
    //   ★ 为什么**不**在这里插一次"补 N-1 条 ⇒ start 被拒"：那条判据由 `tests/p0_first_run.test.ts`
    //     （同数判据）单独钉 —— 那里的夹具没有走过 `edit_code` 拒绝，读数干净；本证只负责"无节点也能走通五步"。
    const exps = [
      {
        kind: 'call-exists',
        path: REL,
        symbol: 'nonode',
        target: 'helper',
        why: '语义类判据（能发现逻辑错）：nonode() 必须转调 helper() —— 这条同时是画布 judgement_ref 的锚点（存在类解不开画布）',
      },
      ...Array.from({ length: Math.max(0, need - 1) }, (_, i) => ({
        kind: 'run',
        expect: `fs.existsSync(path.join(root, '${REL}'))`,
        why: `${REL} 这次改动后必须仍然存在（当场可判；第 ${i + 2} 条，补到门槛 ${need} 条）`,
      })),
    ];
    await edit(
      [
        {
          op: 'update',
          type: 'decision',
          id: NODE,
          data: { summary: `${REL}：无节点文件的取卡实测落点（nonode() 转调 helper()）。`, expectations: exps },
        },
      ],
      `给节点 ${NODE} 写首版决策卡 + ${exps.length} 条语义类判据（${REL}，门槛 ${need} 条）`,
    );

    // ④ 再 claim（补够门槛后才进 claimed —— **这时才有写权**；判据全绿 ⇒ 带 intent:'modify'）
    const expsBeforeStart = (readFeature(home, FEATURE) as unknown as { geometry: { nodes: Array<Record<string, unknown>> } })
      .geometry.nodes.find((n) => n.id === NODE) as { decision?: { expectations?: unknown[] } } | undefined;
    assert.equal(
      expsBeforeStart?.decision?.expectations?.length ?? -1,
      need,
      `③c 之后判据必须是 ${need} 条（实测 ${JSON.stringify(expsBeforeStart?.decision?.expectations ?? [])}）`,
    );
    await edit([{ op: 'claim', type: 'task', id: NODE, data: { owner: OWNER, intent: 'modify' } }], `判据已就位（${need} 条），再领一次节点 ${NODE}（${REL}）`);
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
    // ★ 2026-11-01（首跑墙 ③）：`要补 N 条`那一行现在**先说门槛、再说 kinds**（门槛与 kind 清单用同一个数）
    // ★ 2026-11-09 迁移：门槛 = 证据族 ⇒ 回执说"缺哪族"，不再说"要补 N 条"
  assert.match(full, /没有行为族证据|要补的族/, 'claim 必须说清缺的是哪一族（行为族）');
    for (const t of missing.templates ?? []) {
      assert.doesNotMatch(t, /"kind":"(signature-matches|source-has|file-exists|symbol-exists)"/, '模板 JSON 不许给存在类');
    }

    // ★ 必须给的是语义类。★ 2026-11-01 更新口径：`call-exists` 现在**只在文件里真有符号时**才推荐
    //   （符号从索引现取 —— 该节点的 case 里 `src/nonode.ts` 有两个真顶层符号）⇒ kinds 是 `call-exists + run`
    //   也合规；不许出现的是**存在类**。`run` 必须在（它描述"干完才成立"的内容契约）。
    assert.ok((missing.kinds ?? []).includes('run'), `推荐的 kinds 里必须有 run（实测 ${JSON.stringify(missing.kinds)}）`);
    for (const k of missing.kinds ?? []) {
      assert.ok(
        ['call-exists', 'run', 'behavior-cases'].includes(k),
        `推荐只许是语义类（call-exists / run / behavior-cases），收到 ${k}`,
      );
    }
    assert.ok(
      (missing.templates ?? []).some((t) => t.includes('"kind":"run"')),
      '模板里必须有一条可直接粘的 run 判据',
    );
    assert.match(full, /别用存在类/, '回执必须说清"为什么存在类当不了 judgement_ref"');
    // ★ 2026-11-01（首跑墙 ③）：每条样例都要**标清它现在是绿还是红**（用户不该靠猜）
    assert.ok(
      (missing.templates ?? []).some((t) => t.includes('现在就该绿')),
      `模板里必须有一条标着"现在就该绿"的样例（实测 templates=${JSON.stringify(missing.templates)}）`,
    );
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
