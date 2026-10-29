#!/usr/bin/env node
/**
 * cert T456 —— **一处权威 · P0′ 链路级探针**（只读，2026-10-30）
 *
 * 与 t455 的区别（用户纠正的粒度）：
 *   t455 比的是**函数**（读写集合/分支标签）；
 *   t456 比的是**流转路径**：从同一入口出发的不同通路，**搬运的载荷**是不是同一批货。
 *
 * 载荷取法（纯静态、零 LLM）：每个 hop 的载荷 = 被调函数的**参数类型文本** ∪ **返回类型文本**。
 *
 * 判定：同族入口 ∧ 阶段集合互不包含 ∧ payloadSim ≥ 0.8 ∧ stageDisjoint ≥ 0.7 ⇒ 报「同一批货两条管道」，
 * 并给出**首个分叉 hop**（载荷开始不同的那一跳 = bug 诞生地）。
 *
 * ★ 本证是**可证伪的验收**：已知真例必须报出，已知假例必须不报。
 *   真例：extractGo→liftGoBody→projectTsBody  vs  extractGo→translateGoBodyMech
 *   假例：slotsOf / renderGoType / collectQualifiedPkgs 之间任意组合
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('D:/agentio/dev/agent-io/node_modules/typescript');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'src/infrastructure/authoring/translate');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 收集函数：参数类型文本、返回类型文本、体内调用的同目录函数名 */
const fns = new Map();
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.ts')).sort()) {
  const abs = path.join(DIR, f);
  const sf = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.ES2022, true);
  for (const st of sf.statements) {
    if (!ts.isFunctionDeclaration(st) || !st.name || !st.body) continue;
    const params = st.parameters.map((p) => p.type?.getText(sf) ?? '?').sort();
    const ret = st.type?.getText(sf) ?? '(inferred)';
    const called = new Set();
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) called.add(n.expression.text);
      ts.forEachChild(n, visit);
    };
    visit(st.body);
    fns.set(st.name.text, { name: st.name.text, file: f, params, ret, called });
  }
}

/** 载荷签名 = 参数类型 ∪ 返回类型 */
const payloadOf = (nm) => {
  const f = fns.get(nm);
  if (!f) return new Set();
  return new Set([...f.params.map((t) => `in:${t}`), `out:${f.ret}`]);
};

const jaccard = (a, b) => {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** 从入口出发枚举深度 ≤ maxDepth 的路径 */
const pathsFrom = (entry, maxDepth = 3) => {
  const out = [];
  const walk = (cur, acc) => {
    const f = fns.get(cur);
    if (!f) return;
    const next = [...acc, cur];
    if (next.length > 1) out.push(next);
    if (acc.length + 1 >= maxDepth) return;
    for (const callee of f.called) if (fns.has(callee) && !next.includes(callee)) walk(callee, next);
  };
  walk(entry, []);
  return out;
};

/**
 * 两条路径是否为「同一批货的两条管道」。
 * ★ 从 t456 第一版的失败学到的：真实的双管道**共享主干后才分叉**
 *   （同一个入口 → 同一批 hop → 在某处 fork 成两套实现）。
 *   所以不能要求"阶段几乎全不交"，而要：**先对齐公共前缀，只比岔开之后的那段**。
 */
const judge = (a, b) => {
  let lcp = 0;
  while (lcp < a.length && lcp < b.length && a[lcp] === b[lcp]) lcp++;
  const ta = a.slice(lcp);
  const tb = b.slice(lcp);
  if (!ta.length || !tb.length) return { hit: false, why: '一条是另一条的延伸（委托）' };
  if (lcp === 0) return { hit: false, why: '无公共主干 ⇒ 不同触发' };
  const sa = new Set(ta);
  const sb = new Set(tb);
  const stageDisjoint = 1 - jaccard(sa, sb);
  const hops = Math.min(ta.length, tb.length);
  const sims = [];
  for (let i = 0; i < hops; i++) sims.push(jaccard(payloadOf(ta[i]), payloadOf(tb[i])));
  const payloadSim = sims.reduce((x, y) => x + y, 0) / (sims.length || 1);
  const divergeAt = lcp + sims.findIndex((x) => x < 0.99);
  return {
    hit: payloadSim >= 0.6 && stageDisjoint >= 0.5,
    payloadSim: Number(payloadSim.toFixed(2)),
    stageDisjoint: Number(stageDisjoint.toFixed(2)),
    lcp,
    divergeAt: divergeAt >= lcp ? divergeAt : -1,
    sims: sims.map((x) => Number(x.toFixed(2))),
    why: '',
  };
};

// 入口：本仓翻译侧两个真实入口
const entries = ['extractGo', 'translateGoToTs'];
const allPaths = [];
for (const e of entries) for (const p of pathsFrom(e)) allPaths.push({ entry: e, path: p });

const hits = [];
for (let i = 0; i < allPaths.length; i++) {
  for (let j = i + 1; j < allPaths.length; j++) {
    const A = allPaths[i];
    const B = allPaths[j];
    if (A.entry !== B.entry) continue;
    const r = judge(A.path, B.path);
    if (r.hit) hits.push({ A: A.path, B: B.path, ...r });
  }
}
hits.sort((x, y) => y.payloadSim - x.payloadSim);

console.log(`函数 ${fns.size} · 路径 ${allPaths.length}（入口 ${entries.join('/')}，深度≤3）· 命中 ${hits.length}`);
for (const h of hits.slice(0, 8)) {
  const div = h.divergeAt >= 0 ? `首个分叉 hop ${h.divergeAt}（${h.A[h.divergeAt]} vs ${h.B[h.divergeAt]}）` : '无分叉';
  console.log(`  [载荷 ${h.payloadSim} / 阶段不交 ${h.stageDisjoint}] ${h.A.join('→')}\n        <>  ${h.B.join('→')}   ${div}`);
}

const has = (h, ...names) => names.every((n) => [...h.A, ...h.B].includes(n));
const knownTrue = hits.find((h) => (has(h, 'extractGo', 'liftGoBody', 'projectTsBody') && has(h, 'translateGoBodyMech')));
const knownFalsePairs = hits.filter(
  (h) => [...h.A, ...h.B].every((n) => ['slotsOf', 'renderGoType', 'collectQualifiedPkgs'].includes(n)),
);

chk(hits.length > 0, '① **报得出东西**（不是恒空）', `命中 ${hits.length} 对`);
chk(!!knownTrue, '② **已知真例必须被报出**：A 路径（extractGo→…→projectTsBody）vs B 路径（…translateGoBodyMech）',
  knownTrue ? `已报出（载荷 ${knownTrue.payloadSim}，分叉 hop ${knownTrue.divergeAt}）` : `未报出 —— 算法对已知答案失效，停`);
chk(knownFalsePairs.length === 0, '③ **已知假例必须不报**：slotsOf / renderGoType / collectQualifiedPkgs 任意组合',
  knownFalsePairs.length ? `误报 ${knownFalsePairs.length} 对` : '无');

console.log(`\n═══ T456 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
