#!/usr/bin/env node
/**
 * ★★★ cert T416 —— **律由框架提供，判据只声明"它在本项目生效"**（2026-10-28）
 *
 * ## 用户之问（这是本证存在的理由）
 * 「这个律我们不是 ast 或者框架自动提供的吗」
 * ——**对的**。`judge.ts` 的 `OBSERVE_RULE_TABLE` 已经提供：
 *   · `design:silent-error-discard`（静默错误丢弃）
 *   · `design:impact-blast-radius`（波及半径）
 * 稳定 id 清单 = `OBSERVE_RULE_IDS`。所以**不该再写一条律** ——
 * 该写的是「**这条律在本项目、这批代码上必须成立**」，也就是**声明适用范围**。
 *
 * ## 这也暴露并修掉了 `runtime` 判据设计上的一处错
 * 原来它**按 `probe` 选**（`fn.exit` 这类**实现侧易变名**，插桩器改了名判据就废）。
 * 现在**按 `rule` 选**（设计侧稳定 id），`probe` 降为**可选过滤**（支持尾部 `*`）。
 *
 * ## 判据（每条亲手跑）
 *   ① 按 `rule` 选：夹具里有一条**被静默吞掉的错** ⇒ `rule=design:silent-error-discard,
 *      expect='deviation'` 判 **pass**（真的抓到了）；
 *   ② 同一条规则 `expect='ok'` ⇒ 判 **fail**（有偏差）；
 *   ③ 规则**没出现**（换一条本项目没有事件的规则 id）⇒ **unsupported**（判不了 ≠ 通过）；
 *   ④ `probe` 仍可用（精确 / 尾部 `*` 前缀）—— 但**不是主选法**；
 *   ⑤ `rule` 与 `probe` 都不给 ⇒ `unsupported`（说不出选什么就判不了）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 本证用夹具事件（手写 JSONL），**不**跑真进程 —— 真进程那条链由 `t411`/`t412` 覆盖；
 *   · **[未核]** `design:impact-blast-radius` 这条规则没逐条证（只证了 silent-error-discard 路径）；
 *   · **[未核]** 规则表**版本**：规则改了之后旧事件的判定结果会变（跨版本可比性仍未解，见 todo）。
 *
 * ## 用法
 *   node certs/t416-runtime-by-rule-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp416rule-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { judgeExpectations } = await import(D + 'application/design/intent/expectations.js');
const { OBSERVE_RULE_IDS } = await import(D + 'infrastructure/analysis/observe/judge.js');

// 夹具项目：一条事件 = 一个被静默吞掉的 non-benign 错误（框架规则会判 deviation）
const proj = path.join(TMP, 'proj');
fs.mkdirSync(path.join(proj, '.agent/observe'), { recursive: true });
const evs = [
  { probe: 'demo.risky.catch', fields: { err: 'boom', op: '' }, time: '2026-10-28T00:00:00Z' },
  { probe: 'demo.ok.catch', fields: { err: null }, time: '2026-10-28T00:00:01Z' },
];
fs.writeFileSync(path.join(proj, '.agent/observe/events-416.jsonl'), evs.map((e) => JSON.stringify(e)).join('\n') + '\n');

const mk = (id, label, exp) => ({ node_id: id, node_label: label, expectation: { kind: 'runtime', why: 'x', ...exp } });

// ── 框架确实提供了律（先证前提）────────────────────────
chk(OBSERVE_RULE_IDS.includes('design:silent-error-discard'), '⓪ 律由**框架**提供：`OBSERVE_RULE_IDS` 里有 `design:silent-error-discard`', OBSERVE_RULE_IDS.join(', '));

const rep = await judgeExpectations(proj, [
  mk('dev', '反例：必须抓到那条吞错', { rule: 'design:silent-error-discard', expect: 'deviation' }),
  mk('ok', '同一规则要求全 ok', { rule: 'design:silent-error-discard', expect: 'ok' }),
  mk('none', '规则没出现', { rule: 'design:no-such-rule-416', expect: 'ok' }),
  mk('prefix', 'probe 前缀过滤仍可用', { probe: 'demo.risky.*', expect: 'deviation' }),
  mk('neither', 'rule 与 probe 都不给', {}),
]);
const by = Object.fromEntries(rep.items.map((i) => [i.node_id, i]));

// ── ① 按 rule 选：反例成立 ─────────────────────────────
chk(by.dev?.verdict === 'pass' && /deviation|偏差/.test(String(by.dev?.detail)), '① `rule=design:silent-error-discard, expect=deviation` ⇒ **pass**（真抓到了吞错）', String(by.dev?.detail ?? '').slice(0, 150));

// ── ② 同一规则要求 ok ⇒ fail ───────────────────────────
chk(by.ok?.verdict === 'fail', '② 同一规则 `expect=ok` ⇒ **fail**（有偏差）', String(by.ok?.detail ?? '').slice(0, 140));

// ── ③ 规则没出现 ⇒ unsupported ─────────────────────────
chk(by.none?.verdict === 'unsupported', '③ 规则**没出现** ⇒ **unsupported**（判不了 ≠ 通过）', String(by.none?.detail ?? '').slice(0, 140));

// ── ④ probe 仍可用（前缀）──────────────────────────────
chk(by.prefix?.verdict === 'pass', '④ `probe` 支持尾部 `*` 前缀匹配（调试用，但**不是主选法**）', String(by.prefix?.detail ?? '').slice(0, 120));

// ── ⑤ 两个都不给 ⇒ unsupported ─────────────────────────
chk(by.neither?.verdict === 'unsupported', '⑤ `rule` 与 `probe` 都不给 ⇒ **unsupported**（说不出选什么就判不了）', String(by.neither?.detail ?? '').slice(0, 120));

console.log(`\n═══ T416 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
