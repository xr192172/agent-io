#!/usr/bin/env node
/**
 * ★★★ cert T409 —— **运行时判据 `runtime`（L3 层）**（T-#OBSERVE-1）（2026-10-28）
 *
 * ## 它在自动化测试框架里的位置
 * | 层 | 测什么 | 判据 |
 * |---|---|---|
 * | L1 静态 | 存在 / 签名 / 依赖边 / 调用 / 文本 | `file-exists` 等 7 种 |
 * | L2 行为 | 同进程跑函数、比输出 | `behavior-cases` |
 * | **L3 运行时** | **真链路 / 静默吞错 / 重试**（只存在于探针事件里） | **`runtime`（本证）** |
 *
 * ## 判据（每条亲手跑）
 *   ① 零配置：只给 `probe`，自动找到 `<root>/.agent/observe/events*.jsonl`；
 *   ② `expect:'ok'` + 有偏差事件 ⇒ **fail**，且 detail 带**规则名 + 原因**；
 *   ③ `expect:'deviation'` ⇒ **pass**（反例用法：证明规则真抓得到）；★ 若无偏差 ⇒ **fail**（"没在测东西"）
 *   ④ `expect:'absent'`：出现了 ⇒ fail；没出现 ⇒ pass；
 *   ⑤ 事件文件里没有该 probe ⇒ **unsupported**（**判不了 ≠ 通过**：可能是没跑到/没插桩）；
 *   ⑥ 没有事件文件 ⇒ **unsupported**（不是"没问题"）；
 *   ⑦ `validateDSL` 接受 `runtime`（schema 两处联合体）；`strengthOfKind('runtime') === 'semantic'`。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只读**已有**事件文件，本判据**不负责产生事件**（插桩是 `observe action=instrument` 的事）；
 *   · **[未核]** 多份 events 文件时的取值范围（本证只造 1 份；实现取 mtime 最新一份）；
 *   · **[未核]** `decls`（链路契约）这一半仍要 `observe action=judge` 手工带 —— 本判据 v1 只做**逐事件规则判定**。
 *
 * ## 用法
 *   node certs/t409-runtime-judgement-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp409rt-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const ROOT = 'D:/agentio/dev/agent-io';
const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { judgeExpectations } = await import(D + 'application/design/intent/expectations.js');
const { strengthOfKind } = await import(D + 'application/design/db/rewrite_plan.js');
const { validateDSL } = await import(D + 'domain/validator.js');

// 夹具项目：一条 ok 事件 + 一条偏差事件（catch 吞错 ⇒ silent-error-discard）
const proj = path.join(TMP, 'proj');
fs.mkdirSync(path.join(proj, '.agent/observe'), { recursive: true });
const okEv = { probe: 'fn.exit', fields: { err: null } };
const badEv = { probe: 'fn.exit', fields: { err: 'boom' } };
fs.writeFileSync(path.join(proj, '.agent/observe/events-1.jsonl'), [JSON.stringify(okEv), JSON.stringify(badEv)].join('\n') + '\n');

const mk = (id, label, exp) => ({ node_id: id, node_label: label, expectation: { kind: 'runtime', why: 'x', ...exp } });

// ── ②③④⑤ 三态 + 判不了 ─────────────────────────────────
{
  const rep = await judgeExpectations(proj, [
    mk('ok', 'expect=ok 但有偏差', { probe: 'fn.exit', expect: 'ok' }),
    mk('dev', 'expect=deviation', { probe: 'fn.exit', expect: 'deviation' }),
    mk('abs-bad', 'expect=absent 但出现了', { probe: 'fn.exit', expect: 'absent' }),
    mk('abs-ok', 'expect=absent 且没出现', { probe: 'io.call', expect: 'absent' }),
    mk('unknown', '事件里没有这个 probe', { probe: 'nope' }),
  ]);
  const by = Object.fromEntries(rep.items.map((i) => [i.node_id, i]));
  chk(by.ok?.verdict === 'fail' && /silent-error-discard/.test(String(by.ok?.detail)), '② `expect=ok` + 有偏差 ⇒ **fail**，detail 带**规则名 + 原因**', String(by.ok?.detail ?? '').slice(0, 150));
  chk(by.dev?.verdict === 'pass', '③ `expect=deviation` ⇒ **pass**（反例用法）', String(by.dev?.detail ?? '').slice(0, 120));
  chk(by['abs-bad']?.verdict === 'fail', '④ `expect=absent` 但出现了 ⇒ **fail**', String(by['abs-bad']?.detail ?? '').slice(0, 110));
  chk(by['abs-ok']?.verdict === 'pass', '④-b `expect=absent` 且没出现 ⇒ **pass**');
  chk(by.unknown?.verdict === 'unsupported', '⑤ 事件里没有该 probe ⇒ **unsupported**（判不了 ≠ 通过）', String(by.unknown?.detail ?? '').slice(0, 120));
}

// ── ⑥ 没有事件文件 ⇒ unsupported ─────────────────────────
{
  const bare = path.join(TMP, 'bare');
  fs.mkdirSync(bare, { recursive: true });
  const rep = await judgeExpectations(bare, [mk('x', '无事件文件', { probe: 'fn.exit' })]);
  chk(rep.items[0]?.verdict === 'unsupported', '⑥ 没有事件文件 ⇒ **unsupported**（不是"没问题"）', String(rep.items[0]?.detail ?? '').slice(0, 120));
}

// ── ⑦ schema + 强度 ─────────────────────────────────────
{
  const dsl = {
    $schema: 'design_dsl',
    id: 't409',
    type: 'feature_diagram',
    feature: 't409',
    geometry: {
      nodes: [
        {
          id: 'file_demo',
          type: 'file',
          path: 'src/domain/batch_diff.ts',
          decision: { summary: 'x', expectations: [{ kind: 'runtime', probe: 'fn.exit', expect: 'ok', why: 'w' }] },
        },
      ],
    },
  };
  const r = validateDSL(dsl);
  chk(r.valid === true, '⑦ `validateDSL` **接受** `runtime`', JSON.stringify(r.errors ?? r).slice(0, 140));
  chk(strengthOfKind('runtime') === 'semantic', '⑦-b `strengthOfKind("runtime") === "semantic"`', strengthOfKind('runtime'));
}

// ── ① 零配置：不给 events 也能找到（上面 ②-⑤ 其实已经证明了；这里显式再钉一次）──
{
  const rep = await judgeExpectations(proj, [mk('zero', '零配置自动发现', { probe: 'fn.exit', expect: 'deviation' })]);
  chk(rep.items[0]?.verdict === 'pass' && !String(rep.items[0]?.detail).includes('unsupported'), '① **零配置**：只给 `probe` 即自动找到 `<root>/.agent/observe/events*.jsonl`');
}

console.log(`\n═══ T409 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
