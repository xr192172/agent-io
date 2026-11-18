/**
 * P0 · **三处「门能绿但判不了对错」的护栏**（2026-10-31，独立复核实测，三条都是真的）。
 *
 * ## ① 一条自证判据（恒绿）
 * `file_scripts_run-tests_mjs` 上曾有一条 `kind:'run'` 判据：`input.summary` 是**写死的字面量**
 * 「文件 11 / 用例 42 / 通过 40 / 失败 2 / 跳过 0」，`expect` 只判 `files>=11 && tests>=11`。
 * 而真实是 **19 文件 / 72 用例**。
 * ★ 根因：`run` **不执行命令**，只对 `input` 字面量求值（`expectations.ts` 的 `case 'run'` 用
 *   `new Function('input', …)` 求 `e.expect`，`input.command` 从头到尾没人读）⇒ 它对着一个
 *   **手抄的旧读数**求值 ⇒ **恒绿**，文件怎么变都绿。
 * ⇒ 已删除该判据（测试门 `scripts/run-tests.mjs` 本来就真跑那 19 个文件），
 *   见 `docs/RETIRED.md`。本证锁两件事：**机制**（run 不读命令输出）+ **它没被重新发明**。
 *
 * ## ② D2 的 `p &&` 让无 path 的节点豁免
 * `task-system-plan` 册的 D2（节点完整）曾写成 `const p = norm(n.path); return p && SCOPE…`
 * —— 无 path 的节点被**静默过滤**掉而不是判红，而它自己的 `rule` 写着「每个节点有 path」。
 * 实测本册 623 个节点里 107 个无 path（106 个 `type=module` 目录节点 + 1 个 `type=doc` 册根）；
 * 三册合计 205。
 * ⇒ 改成：path 完整性对**全部 `type='file'` 节点**判（不看 SCOPE），豁免（module/doc）**写进 rule**。
 *
 * ## ③ judge 缓存 key 里没有判定内核版本
 * `judge_cache.ts` 的 `CACHE_VERSION = 1`，key = `{kind,path,symbol,signature,must,mustNot,pattern}`
 * ‖ diskHash —— **不含判定内核版本** ⇒ 改判定逻辑（剥注释 / 符号解析）后旧 `pass` 继续命中
 * （2026-10-31 已因此出过一次假绿）。
 * ⇒ 选 **(b) 自动**：把判定内核源码的内容哈希并入 key（`judgeKernelFingerprint`），
 *   不靠人记得 bump；**内容不变 ⇒ 指纹不变 ⇒ key 不变**（缓存不被废）。
 *
 * ★ 每条 case 的「改前」都写在断言旁的注释里 —— 它们是"先红后绿"的那条红线。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { judgeExpectations } from '../src/application/design/intent/expectations.js';
import {
  judgeCacheKey,
  judgeKernelFingerprint,
  loadJudgeCache,
  saveJudgeCache,
} from '../src/application/design/intent/judge_cache.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { Expectation } from '../src/domain/expectation.js';
import type { JudgeItem } from '../src/domain/judge_port.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * ★ 2026-11-18（T-#A8A9-CROSS-BOOK 批 17 · **计划册退役**）：`task-system-plan` 已归档进
 * `.agent-io/design/archived/`（逐字节未改，sha256 由 `p1_cross_book_batch17.test.ts` 钉住）。
 *
 * ★ 本文件**不是**"读活册"的证，是"读**某一份册的内容**问它自不自证"的证：
 * ②/②b/②c 三条问的正是 `task_plan.design_completeness.criteria`（D2/D1），而那一段**只住计划册**
 * ⇒ 读端跟到归档件。**断言一条没改**：判的仍是同一份字节，只是它现在叫"归档件"。
 */
const DESIGN = (feature: string): string => {
  const live = path.join(ROOT, '.agent-io', 'design', `${feature}.dsl.json`);
  if (fs.existsSync(live)) return live;
  return path.join(ROOT, '.agent-io', 'design', 'archived', `${feature}.dsl.json`);
};
/** 两本**活册** + 一本**退役归档件**（`task-system-plan` 由 `DESIGN` 解析到 `archived/`）—— 见上方说明 */
const BOOKS = ['agent-io', 'task-system-plan', 'agent-io-toolface'] as const;

function loadBook(feature: string): {
  geometry: { nodes: Array<Record<string, unknown>> };
  task_plan?: { design_completeness?: { criteria?: Array<Record<string, unknown>> } };
} {
  return JSON.parse(fs.readFileSync(DESIGN(feature), 'utf-8'));
}

// ═══════════════════════════════════════════════════════════════════════════
// ① run 不求值命令 —— 自证的机制本身
// ═══════════════════════════════════════════════════════════════════════════

test('P0-selfcert ① · run 判据**不执行** input.command：命令的真实输出与断言无关（这就是自证的机制）', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-selfcert-run-'));
  try {
    process.env.AGENT_IO_HOME = home;
    // ★ 命令若真被执行，它的输出「文件 1 / 用例 1 / 通过 1 / 失败 0 / 跳过 0」会让 files>=11 不成立 ⇒ fail。
    //   而 input.summary 是写死的「文件 11 / 用例 42 …」⇒ pass。
    //   ⇒ **pass 就是"命令没被读"的证明**（若哪天 run 改成真跑，这条会变 fail —— 那时本证应当被重写）。
    const selfCert: Expectation = {
      kind: 'run',
      input: {
        command: `node -e "console.log('测试门：文件 1 / 用例 1 / 通过 1 / 失败 0 / 跳过 0')"`,
        summary: '测试门：文件 11 / 用例 42 / 通过 40 / 失败 2 / 跳过 0',
      },
      expect:
        '(() => {\n' +
        '  const m = String(input.summary).match(/测试门：文件 (\\d+) \\/ 用例 (\\d+) \\/ 通过 (\\d+) \\/ 失败 (\\d+) \\/ 跳过 (\\d+)/);\n' +
        '  if (!m) return false;\n' +
        '  const [files, tests, pass, fail, skipped] = m.slice(1).map(Number);\n' +
        '  return files >= 11 && tests >= 11 && pass + fail === tests && skipped === 0;\n' +
        '})()',
      why: '复刻被删掉的那条自证判据（字面量与断言逐字同形）',
    } as unknown as Expectation;
    const items: JudgeItem[] = [{ node_id: 'self_cert_probe', node_label: '自证探针', expectation: selfCert }];

    const rep = await judgeExpectations(project, items);
    assert.equal(rep.items[0].verdict, 'pass', 'run 只对 input 字面量求值 ⇒ 命令真输出再离谱也绿');
    assert.doesNotMatch(rep.items[0].detail, /用例 1/, 'run 的 detail 里不该出现命令的真实输出（它没被执行）');

    // ★ 反证：把字面量换成命令的真实读数 ⇒ 同一条 expect 立刻 fail。
    //   说明 verdict 完全由 input 决定，与"世界上真跑了多少"无关 —— 这正是"自证"。
    const literalFails: Expectation = { ...selfCert, input: { command: 'node scripts/run-tests.mjs', summary: '测试门：文件 1 / 用例 1 / 通过 1 / 失败 0 / 跳过 0' } } as unknown as Expectation;
    const rep2 = await judgeExpectations(project, [{ node_id: 'self_cert_probe', node_label: '自证探针', expectation: literalFails }]);
    assert.equal(rep2.items[0].verdict, 'fail', '同一个命令、只改 input 字面量 ⇒ 结论翻转 ⇒ 断言只认字面量');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-selfcert ①b · 那条自证判据**已从设计册删除**，且三册里没有「测试门读数」被写死成 run 的 input', () => {
  // ★ 改前红：agent-io 册的 file_scripts_run-tests_mjs 上就挂着这样一条（input.summary 写死「文件 11 / 用例 42」）。
  const book = loadBook('agent-io');
  const node = book.geometry.nodes.find((n) => n.id === 'file_scripts_run-tests_mjs');
  assert.ok(node, 'run-tests.mjs 的节点必须还在（删的是判据，不是节点）');
  const exps = ((node.decision as { expectations?: Array<{ kind?: string }> })?.expectations ?? []) as Array<{
    kind?: string;
  }>;
  assert.deepEqual(
    exps.map((e) => e.kind),
    ['call-exists', 'source-has', 'source-has', 'run'],
    '★ 2026-11-19（集成席 · merge feat/api-edges）：本节点多了 2 条（run-tests-reporter-tap 卡的 source-has + run，run 只查 spawn 参数形态、无 input.summary）' +
      ' —— 改前的自证 run（input.summary 写死「文件 11 / 用例 42」）仍在下面那条全册扫描里被钉死为不许出现。',
  );

  // ★ 更一般的一刀：任何册里都不许把「测试门读数」写成 run 的 input（那是把读数抄进判据 = 自证）
  const offenders: string[] = [];
  for (const f of BOOKS) {
    const b = loadBook(f);
    for (const n of b.geometry.nodes) {
      for (const e of ((n.decision as { expectations?: Array<Record<string, unknown>> })?.expectations ?? [])) {
        if (e.kind !== 'run') continue;
        const input = e.input as { summary?: unknown } | undefined;
        if (typeof input?.summary === 'string' && /测试门：文件\s*\d+/.test(input.summary)) {
          offenders.push(`${f}:${String(n.id)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], '测试规模不许被手抄进 run 判据（真读数唯一持有者 = scripts/run-tests.mjs 的 TAP 输出）');
});

// ═══════════════════════════════════════════════════════════════════════════
// ② D2 无 path 判红（口径写清，不靠 `p &&` 静默过滤）
// ═══════════════════════════════════════════════════════════════════════════

/** 用 design-check.mjs **同一个求值域**跑某条项目级判据的 `expect` */
function evalCriterion(expect: string, nodes: unknown[]): boolean {
  const dsl = loadBook('task-system-plan');
  const fn = new Function(
    'dsl',
    'nodes',
    'paths',
    'fs',
    'path',
    'root',
    'mutateReport',
    'callReport',
    'results',
    'KINDS',
    `"use strict"; return (${expect});`,
  );
  return Boolean(
    fn(dsl, nodes, (nodes as Array<{ description?: string }>).map((n) => String(n?.description ?? '')), fs, path, ROOT, null, null, [], []),
  );
}

test('P0-selfcert ② · D2：造一个无 path 的 `type=file` 节点 ⇒ 必须判红（改前被 `p &&` 过滤掉）', () => {
  const book = loadBook('task-system-plan');
  const d2 = (book.task_plan?.design_completeness?.criteria ?? []).find((c) => c.id === 'D2');
  assert.ok(d2, 'D2 必须还在册上');
  const expect = String(d2.expect ?? '');
  assert.ok(expect.trim(), 'D2 必须有可执行 expect');

  const real = book.geometry.nodes as Array<Record<string, unknown>>;
  // 真册：绿
  assert.equal(evalCriterion(expect, real), true, '真册当前应当绿（516 个 file 节点都有 path、范围内 34 个都有 summary+acceptance）');

  // ★ 改前红：无 path 的 file 节点被 `p &&` 划出分母 ⇒ 仍返回 true（假绿）
  const withFileNoPath = [...real, { id: 'fabricated_file_no_path', type: 'file', decision: { summary: 's', acceptance: 'a' } }];
  assert.equal(
    evalCriterion(expect, withFileNoPath),
    false,
    'rule 写着「每个 type=file 节点有 path」⇒ 少一个 path 就必须判红，不许静默过滤',
  );

  // 豁免口径写清（不靠表达式静默过滤）：module（目录节点）/ doc（册根）本来就没有 path
  const withModuleNoPath = [...real, { id: 'fabricated_module_no_path', type: 'module', decision: { summary: 's', acceptance: 'a' } }];
  assert.equal(evalCriterion(expect, withModuleNoPath), true, 'type=module 是目录节点，无 path 是正常的（豁免写在 rule 里）');

  // 职责那一半仍然生效：范围内节点缺 summary ⇒ 红
  const withScopeNoSummary = [
    ...real,
    { id: 'fabricated_scope', type: 'file', path: 'src/domain/__probe__.ts', decision: { summary: '  ', acceptance: 'a' } },
  ];
  assert.equal(evalCriterion(expect, withScopeNoSummary), false, 'SCOPE 内节点缺 summary 必须红');
});

test('P0-selfcert ②b · D2 的 rule 把豁免口径写明（module / doc），判据与 rule 不再对不上', () => {
  const book = loadBook('task-system-plan');
  const d2 = (book.task_plan?.design_completeness?.criteria ?? []).find((c) => c.id === 'D2');
  const rule = String(d2?.rule ?? '');
  assert.match(rule, /type=file/, 'rule 必须点明「必须 has path」的对象是 type=file');
  assert.match(rule, /type=module/, 'rule 必须写明 module（目录节点）豁免');
  assert.match(rule, /type=doc/, 'rule 必须写明 doc（册根 / 无单一文件的文档节点）豁免');
});

// ═══════════════════════════════════════════════════════════════════════════
// ③ 判定内核指纹进缓存 key
// ═══════════════════════════════════════════════════════════════════════════

test('P0-selfcert ③ · 判定内核指纹稳定且参与 key（内容不变 ⇒ 指纹不变 ⇒ 缓存不被废）', () => {
  const a = judgeKernelFingerprint();
  const b = judgeKernelFingerprint();
  assert.match(a, /^[0-9a-f]{16}$/, '内核指纹是 16 位 hex');
  assert.equal(a, b, '同一进程内两次取值必须相同（否则每次运行 key 都变 = 缓存全废）');

  const e = { kind: 'source-has', path: 'src/x.ts', must: ['A'], why: 'probe' } as unknown as Expectation;
  const base = judgeCacheKey(e, 'diskhash');
  assert.equal(judgeCacheKey(e, 'diskhash', a), base, '显式给同一指纹 ⇒ 与缺省逐字相同（缓存不被废）');
  assert.notEqual(
    judgeCacheKey(e, 'diskhash', 'deadbeefdeadbeef'),
    base,
    '★ 改前红：旧 key = 判据内容 ‖ diskHash，**没有第三个分量** ⇒ 内核换了 key 也不变 ⇒ 旧 pass 继续命中',
  );
});

test('P0-selfcert ③b · 旧内核写下的缓存文件必须**不命中**（读端按 kernel 指纹作废）', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-selfcert-kernel-'));
  const cacheFile = path.join(project, '.agent-io', 'judge-cache.json');
  try {
    process.env.AGENT_IO_HOME = home;
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });

    const write = (kernel: unknown): void =>
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({ version: 1, kernel, saved_at: new Date().toISOString(), entries: { k1: { verdict: 'pass', detail: '旧内核的结论' } } }),
        'utf-8',
      );

    // ★ 改前红：旧实现只比 `version`，`kernel` 字段**根本不看** ⇒ 这里会拿到 1 条旧条目。
    write('deadbeefdeadbeef');
    assert.equal(loadJudgeCache(project).size, 0, '内核指纹不符 ⇒ 当空缓存用（旧 pass 不许继续命中）');

    // 内核指纹缺失（更早的缓存文件）同样作废
    write(undefined);
    assert.equal(loadJudgeCache(project).size, 0, '没有 kernel 字段的老缓存一律作废（一次性重算，不许静默沿用）');

    // 同版本内核 ⇒ 正常命中（缓存没被废）
    write(judgeKernelFingerprint());
    assert.equal(loadJudgeCache(project).size, 1, '同一版判定内核写的缓存必须照常命中');

    // 落盘时确实写下当前内核指纹（读端才比得了）
    saveJudgeCache(project, new Map([['k2', { verdict: 'fail', detail: 'x' }]]));
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as { kernel?: string };
    assert.equal(saved.kernel, judgeKernelFingerprint(), 'saveJudgeCache 必须写下当前内核指纹');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
