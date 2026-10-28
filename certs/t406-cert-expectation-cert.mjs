#!/usr/bin/env node
/**
 * ★★★ cert T406 —— **证判据 `cert`（吸收进设计侧的桥）**（T-#CERT-1）（2026-10-28）
 *
 * ## 用户之问
 * 「这部分内容可以吸收进设计侧吗」—— 先看读数：本仓 128 张证里 **100 张（78%）断言的是"盘上副作用"**
 * （指纹 / 存在性 / 文件列表），而现有判据种类**全是只读求值**（`run` 明文写着"只许读 + 判，不许副作用"）。
 * ⇒ 副作用类的安全律（"dry-run 不许落盘"）用现有 kind **表达不了**。
 *
 * ## 桥的做法（本证证明它是真的）
 * 新 kind `cert`：册里写「这条契约由哪张证兜底」（`certs/` 文件名前缀 + 可选用例标记），
 * 求值器**spawn 那张证**并读它的结论行。★ 副作用留在**证的进程**里（证自建临时夹具），
 * 判据侧仍然只读 ⇒ **不破坏 `run` 那条"不许副作用"的边界**。
 *
 * ## 判据（每条亲手跑）
 *   ① `cert: 't405', case: '①'` ⇒ **pass**（真跑 t405 并取第①条读数）；
 *   ② `cert: 't405'`（不给 case）⇒ 走**汇总行** `PASS=n FAIL=0` ⇒ pass；
 *   ③ 证不存在 ⇒ **unsupported**（判不了 ≠ 通过）；
 *   ④ 证里没有该用例 ⇒ **unsupported**；
 *   ⑤ `validateDSL` 接受 `cert`（schema 联合体两处都补了）；
 *   ⑥ `strengthOfKind('cert') === 'semantic'`；
 *   ⑦ **设计侧真吸收了**：三个破坏性工具的决策卡在册里带 `cert` 判据（可读性 = 打开册就能看见安全律）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 本证**不**证明"证一定代表真值"——证自己可能是错的；它只证明"册与证之间已接上、且不假绿"；
 *   · **[未核]** 并发：多台机器同时跑同一张证会不会互相踩临时目录（证各自 `mkdtemp`，理论上不会）。
 *
 * ## 用法
 *   node certs/t406-cert-expectation-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp406cert-'));
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

// ── ①②③④ 求值器四态（真跑证）────────────────────────────
{
  const rep = await judgeExpectations(ROOT, [
    { node_id: 'c1', node_label: '取用例①', expectation: { kind: 'cert', cert: 't405', case: '①', why: 'dry-run 不落盘' } },
    { node_id: 'c2', node_label: '走汇总行', expectation: { kind: 'cert', cert: 't405', why: '整张证' } },
    { node_id: 'c3', node_label: '证不存在', expectation: { kind: 'cert', cert: 'no-such-cert-406', why: 'x' } },
    { node_id: 'c4', node_label: '用例不存在', expectation: { kind: 'cert', cert: 't405', case: '⑨⑨', why: 'y' } },
  ]);
  const by = Object.fromEntries(rep.items.map((x) => [x.node_id, x]));
  chk(by.c1?.verdict === 'pass', '① `cert: t405#①` ⇒ **pass**（真跑证并取该条读数）', String(by.c1?.detail ?? '').slice(0, 120));
  chk(by.c2?.verdict === 'pass' && /PASS=\d+/.test(String(by.c2?.detail)), '② 不给 case ⇒ 走**汇总行**', String(by.c2?.detail ?? '').slice(0, 100));
  chk(by.c3?.verdict === 'unsupported', '③ 证不存在 ⇒ **unsupported**（判不了 ≠ 通过）', String(by.c3?.detail ?? '').slice(0, 110));
  chk(by.c4?.verdict === 'unsupported', '④ 证里没有该用例 ⇒ **unsupported**', String(by.c4?.detail ?? '').slice(0, 110));
}

// ── ⑤ schema 认它 ──────────────────────────────────────
{
  const dsl = {
    $schema: 'design_dsl',
    id: 't406',
    type: 'feature_diagram',
    feature: 't406',
    geometry: {
      nodes: [
        {
          id: 'file_demo',
          type: 'file',
          path: 'src/domain/batch_diff.ts',
          decision: { summary: 'x', expectations: [{ kind: 'cert', cert: 't405', case: '①', why: 'w' }] },
        },
      ],
    },
  };
  const r = validateDSL(dsl);
  chk(r.valid === true, '⑤ `validateDSL` **接受** `cert`（schema 两处联合体都补了）', JSON.stringify(r.errors ?? r).slice(0, 140));
}

// ── ⑥ 强度分类 ─────────────────────────────────────────
chk(strengthOfKind('cert') === 'semantic', '⑥ `strengthOfKind("cert") === "semantic"`', strengthOfKind('cert'));

// ── ⑦ 设计侧真吸收了 ───────────────────────────────────
{
  const dsl = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-io/design/agent-io.dsl.json'), 'utf8'));
  const want = ['symbol_move.ts', 'move_domain.ts', 'deprecate_offline.ts'];
  const found = want.filter((f) => {
    const n = (dsl.geometry?.nodes ?? []).find((x) => String(x.path ?? '').endsWith(f));
    return (n?.decision?.expectations ?? []).some((e) => e.kind === 'cert' && e.cert === 't405');
  });
  chk(found.length === want.length, '⑦ 三个破坏性工具的决策卡在册里带 `cert: t405` 判据（安全律进了设计侧）', `找到 ${found.length}/${want.length}：${found.join(', ')}`);
}

console.log(`\n═══ T406 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
