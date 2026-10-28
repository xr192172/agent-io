#!/usr/bin/env node
/**
 * ★★★ cert T404 —— **域级边界判据 `domain-independent`**（T-#DOMAIN-2）（2026-10-28）
 *
 * ## 为什么需要它（实测撑起来的理由）
 * `edge-absent` 是**文件对级**：给目录前缀（`src/infrastructure/parse`）会判 `unsupported`
 * （索引里没有"目录"这个文件）。而本仓有 **167 个域对 / 1507 条跨域 import 边** ⇒ 逐文件枚举不现实。
 * ⇒ 分割 / 合并 / 废弃 / 删除这四件事的**必要条件**都需要**域级**判据。
 *
 * ## 判据（域对聚合，一次算清）
 * 域 `domain` 的任一文件 → `must_not_import` 里任一域的任一文件存在 import 边 ⇒ `fail`（给条数 + 样例）；
 * 零边 ⇒ `pass`；域表缺失 / 域 id 不认识 / 索引不可用 ⇒ `unsupported`（**判不了 ≠ 合格**）。
 *
 * ## 判据（本证每条亲手跑）
 *   ① 绿：`parse ⇸ meta-view`（真实分层律，"下层不许依赖上层"的一个具体域对）；
 *   ② 红：`observe-reconcile ⇸ observe`（**真有 11 条边**）⇒ fail，且 detail 给条数与样例；
 *   ③ 判不了：域表里没有的域 ⇒ `unsupported`（**不许当合格**）；
 *   ④ **schema 认它**：`validateDSL` 接受带 `domain-independent` 的 DSL（schema 的判据联合体是**手工维护**的，
 *      上次 `read_set.basis: 'canvas'` 就栽在这 —— 这次一并钉住）；
 *   ⑤ 强度分类认识它（`strengthOfKind` ≠ `unknown`）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只按**域表层**（`structure.domains.json` 的 `dir`）归域；域表里的陈旧项会让判定失真（`T-#DOMAIN-1`）；
 *   · **[未核]** 动态 import / `export *` 转发是否都在 `edges(kind='import')` 里（本证只吃索引事实）。
 *
 * ## 用法
 *   node certs/t404-domain-independent-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/domain/expectation.ts, application/design/intent/expectations.ts, schema/design_dsl.schema.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp404domain-'));
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

const mk = (id, domain, must, label) => ({
  node_id: id,
  node_label: label,
  expectation: { kind: 'domain-independent', domain, must_not_import: must, why: label },
});

// ── ①②③ 求值器三态 ─────────────────────────────────────
{
  const rep = await judgeExpectations(ROOT, [
    mk('g', 'parse', ['meta-view'], '下层不许依赖上层'),
    mk('r', 'observe-reconcile', ['observe'], '演示：真违规'),
    mk('u', 'no-such-domain', ['parse'], '域不存在'),
  ]);
  const by = Object.fromEntries(rep.items.map((x) => [x.node_id, x]));
  chk(by.g?.verdict === 'pass', '① 绿：`parse ⇸ meta-view` 判 **pass**', String(by.g?.detail ?? '').slice(0, 120));
  chk(by.r?.verdict === 'fail' && /\d+ 条 import/.test(String(by.r?.detail)), '② 红：`observe-reconcile ⇸ observe` 判 **fail** 且给条数', String(by.r?.detail ?? '').slice(0, 160));
  chk(by.r?.detail?.includes('→'), '②-b detail 里有**样例边**（能直接定位）');
  chk(by.u?.verdict === 'unsupported', '③ 域表里没有的域 ⇒ **unsupported**（判不了 ≠ 合格）', String(by.u?.detail ?? '').slice(0, 110));
}

// ── ④ schema 认它（手工维护的联合体，必须单独钉）────────
{
  const dsl = {
    $schema: 'design_dsl',
    id: 't404',
    type: 'feature_diagram',
    feature: 't404',
    geometry: {
      nodes: [
        {
          id: 'file_demo',
          type: 'file',
          path: 'src/domain/batch_diff.ts',
          decision: {
            summary: 'x',
            expectations: [
              { kind: 'domain-independent', domain: 'parse', must_not_import: ['meta-view'], why: '分层律' },
            ],
          },
        },
      ],
    },
  };
  const r = validateDSL(dsl);
  chk(r.valid === true, '④ `validateDSL` **接受** `domain-independent`（schema 联合体已补；它有两处：节点 decision 与 task prepared_snapshot）', JSON.stringify(r).slice(0, 200));
}

// ── ⑤ 强度分类 ─────────────────────────────────────────
{
  chk(strengthOfKind('domain-independent') === 'semantic', '⑤ 强度分类认识它（≠ unknown）', strengthOfKind('domain-independent'));
}

console.log(`\n═══ T404 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
