/**
 * 接线账的**事实探针**（现算，不缓存、不推断）。
 *
 * ★ 只用**已有权威**的产物，不另写扫描器：
 *   · 源码文本（声明点 / 写入口 / 消费者那一行）
 *   · 设计册 `.agent-io/design/*.dsl.json`（真实用法条数）
 *   · `.agent-io/judge-readings.json#by_kind`（**运行读数**，`judge-all` 每次覆盖写）
 *   · `.agent/observe/events*.jsonl`（运行时判据要的素材）
 *
 * ★ 所有 `notes` 都是一句可复核的原始事实（带数字），读端不必信这段代码。
 */
import fs from 'node:fs';
import path from 'node:path';

import type { WiringFacts, WiringProbe } from './wiring_ledger.js';

const read = (root: string, rel: string): string => {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return '';
  }
};

const count = (s: string, needle: string): number => s.split(needle).length - 1;

/** 设计册里某个字面量出现几次（跨所有册） */
function countInSheets(root: string, needle: string): number {
  const dir = path.join(root, '.agent-io', 'design');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.dsl.json')) continue;
    n += count(read(root, path.join('.agent-io', 'design', f)), needle);
  }
  return n;
}

/** `judge-readings.json` 的 per-kind 读数（运行证据的唯一来源） */
function judgeReadings(root: string): Record<string, { checked?: number }> {
  try {
    const j = JSON.parse(read(root, '.agent-io/judge-readings.json')) as { by_kind?: Record<string, { checked?: number }> };
    return j.by_kind ?? {};
  } catch {
    return {};
  }
}

/**
 * 递归数「提到某个标识符的文件数」（消费者分母；不数出现次数，避免同一文件多次提起被当多人用）。
 *
 * ★★ 必须排除**本模块自己**：`wiring_facts.ts` / `wiring_ledger.ts` 里写着被测对象的字面量，
 *    不排除就会**把自己算成消费者**（实测：`deriveJudgements` 被数成 3 个文件，其中 2 个是本账的声明表）
 *    —— 那会让"零消费者"永远报不出来，是这张账最容易出的假绿。
 */
function filesMentioning(root: string, needle: string): number {
  const SELF = /analysis[\\/]health[\\/]wiring_(facts|ledger)\.ts$/;
  const walk = (dir: string): string[] => {
    let out: string[] = [];
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(p));
      else if (/\.(ts|mjs|js)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  let n = 0;
  for (const d of ['src', 'tests', 'scripts']) {
    for (const f of walk(path.join(root, d))) {
      if (SELF.test(f)) continue; // ★ 本账自己的声明表不是消费者
      try {
        if (fs.readFileSync(f, 'utf8').includes(needle)) n += 1;
      } catch {
        /* 读不到就不数它 —— 不猜 */
      }
    }
  }
  return n;
}

function eventsFileCount(root: string): number {
  try {
    return fs.readdirSync(path.join(root, '.agent', 'observe')).filter((f) => /^events.*\.jsonl$/.test(f)).length;
  } catch {
    return 0;
  }
}

/**
 * 三个已知对象 + 一个真实预留对象（本轮只喂这四个；**不做全仓普查** ——
 * 普查要等这张账本身被证明有牙之后再做）。
 */
export function collectWiringProbes(root: string): WiringProbe[] {
  const kindsTs = read(root, 'src/domain/expectation_kinds.ts');
  const expTs = read(root, 'src/domain/expectation.ts');
  const judgeTs = read(root, 'src/application/design/intent/expectations.ts');
  const byKind = judgeReadings(root);

  return [
    // 正例：判据字段 includeComments（注释类断言的唯一口子）
    {
      declaration: {
        subject: 'src/application/design/intent/expectations.ts#includeComments',
        claimed_capability: 'source-has 能断注释里的标记（默认剥注释，includeComments:true 读原文）',
      },
      probe: (): WiringFacts => {
        const users = countInSheets(root, '"includeComments"');
        const srcHas = byKind['source-has']?.checked ?? 0;
        return {
          declared: expTs.includes('includeComments?'),
          input_present: true,
          handoff_connected: users > 0,
          consumed: judgeTs.includes('e.includeComments'),
          executed: srcHas > 0,
          notes: {
            declared: `expectation.ts 有 \`includeComments?\` 字段 = ${expTs.includes('includeComments?')}`,
            input: '该能力不需要外部素材（判据自带开关）',
            handoff: `设计册里带 includeComments 的判据 = ${users} 条`,
            consumer: `judgeExpectations 把 e.includeComments 传进 sourceHasTextOf = ${judgeTs.includes('e.includeComments')}`,
            execution: `judge-readings#by_kind["source-has"].checked = ${srcHas}`,
          },
        };
      },
    },

    // 反例 1：deriveJudgements —— 输入几乎为空、写口不接 contract
    {
      declaration: {
        subject: 'src/application/design/derive/derive_judgements.ts#deriveJudgements',
        claimed_capability: '零件契约 → 判据的机械展开（零人工）',
      },
      probe: (): WiringFacts => {
        const contracts = countInSheets(root, '"contract":');
        const mentioned = filesMentioning(root, 'deriveJudgements');
        return {
          declared: read(root, 'src/application/design/derive/derive_judgements.ts').includes('export function deriveJudgements'),
          input_present: contracts > 0,
          handoff_connected: judgeTs.includes('deriveJudgements('),
          consumed: mentioned > 1,
          executed: false,
          notes: {
            declared: `导出点存在；全仓提到 deriveJudgements 的文件 = ${mentioned}（含它自己）`,
            input: `设计册里 contract 实例 = ${contracts} 条`,
            handoff: `没有写口调用 deriveJudgements( = ${judgeTs.includes('deriveJudgements(')}`,
            consumer: `消费者文件数 = ${mentioned - 1}`,
            execution: '无运行读数（judge-readings 不含它自己的条目）',
          },
        };
      },
    },

    // 反例 2：runtime kind —— 定义与四态齐；本轮已把「交接」接到**可入库样例**上
    {
      declaration: {
        subject: 'judgement-kind:runtime',
        claimed_capability: 'L3 运行时判据（读探针事件流，判真链路 / 静默吞错 / 重试）',
      },
      probe: (): WiringFacts => {
        const inSheets = countInSheets(root, '"kind": "runtime"');
        const evFiles = eventsFileCount(root);
        const hasSample = fs.existsSync(path.join(root, 'tests/fixtures/observe/events-sample.jsonl'));
        const checked = byKind['runtime']?.checked ?? 0;
        return {
          declared: expTs.includes("kind: 'runtime'") || kindsTs.includes('runtime'),
          // ★ 输入取**可入库样例**（确定性），不用 `.agent/observe/` 的临时产物：
          //   那目录被 gitignore，干净检出后为 0 个文件 ⇒ 拿它当输入会让"可判"随环境漂。
          input_present: hasSample,
          handoff_connected: inSheets > 0,
          consumed: checked > 0,
          executed: checked > 0,
          notes: {
            declared: `类型联合体里有 kind 'runtime' = ${expTs.includes("kind: 'runtime'")}；注册表 phase=runtime = ${kindsTs.includes('runtime')}`,
            input: `可入库样例 tests/fixtures/observe/events-sample.jsonl = ${hasSample}；临时产物 .agent/observe/events*.jsonl = ${evFiles} 个（gitignore，不入库，只作旁证）`,
            handoff: `设计册里 runtime 判据 = ${inSheets} 条${inSheets > 0 ? '（已指向可入库样例 ⇒ 确定性可跑）' : '（事件流 → rule/probe 没有渲染器，需手接）'}`,
            consumer: `by_kind 里 runtime 条目 = ${byKind['runtime'] ? '有' : '无'}`,
            execution: `by_kind["runtime"].checked = ${checked}`,
          },
        };
      },
    },

    // 预留：BrickContract —— 公共契约类型，字段注释明确写"observe 补"
    {
      declaration: {
        subject: 'src/domain/contract.ts#BrickContract',
        claimed_capability: '零件契约（effects / shapes / runtime 证据）—— 为将来的契约驱动改写预留',
        reserved: '字段注释写明 effects 的 writes/holds/emits 与 runtime 由 observe 事件流补；静态提取阶段为空是设计如此',
      },
      probe: (): WiringFacts => {
        const contracts = countInSheets(root, '"contract":');
        const mentioned = filesMentioning(root, 'BrickContract');
        return {
          declared: read(root, 'src/domain/contract.ts').includes('export interface BrickContract'),
          input_present: true,
          handoff_connected: contracts > 0,
          consumed: mentioned > 1,
          executed: false,
          notes: {
            declared: `BrickContract 定义在 src/domain/contract.ts = ${read(root, 'src/domain/contract.ts').includes('export interface BrickContract')}`,
            input: '类型本身不需要外部素材',
            handoff: `设计册里填了 contract 的文件 = ${contracts}`,
            consumer: `提到 BrickContract 的文件数 = ${mentioned}`,
            execution: '无运行读数（尚无消费方）',
          },
        };
      },
    },
  ];
}
