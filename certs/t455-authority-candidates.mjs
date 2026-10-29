#!/usr/bin/env node
/**
 * ★★★ cert T455 —— **一处权威 · P0 只读原型**（2026-10-30）
 *
 * ## 判什么（两条独立的"嫌疑"信号，不是你像不像，是"吃进去/吐出来"重合）
 *   ① **dispatch 标签重合**：两个函数都在按同一套判别标签分派
 *      （`case 'range_clause'` / `c.type === 'range'` / `fname === 'append'`）
 *      ⇒ 它们是同一个行为的两个实现（今天实测：range/switch/append/delete/len 各有两份）；
 *   ② **I/O 足迹重合**（用户提的算法）：把函数体里**读到的名字/成员**、**写到的名字/成员**、
 *      **返回的形状**各收成集合，两个函数足迹的 Jaccard 高 ⇒ 怀疑在做同一件事。
 *      ★ 这条能抓到"标签不同但吃吐相同"的实现（标签法抓不到的那半）。
 *
 * ## 名单（用户提的三态）
 *   · **白名单**（`whitelist`）：确认是合理并存 ⇒ 直接放行，不再检查；
 *   · **灰名单**（`graylist`）：暂时放行，**带 `until` 到期日**；到期后**自动重新告警**；
 *   · 其余：新嫌疑 ⇒ 报警（证书红）。
 *
 * ## 边界（诚实）
 *   · 只读：**不改任何代码**，只出清单；
 *   · 只做**同目录**比较（跨目录/跨域 `[未核]`，先解决同域）；
 *   · 启发式，必有假阳性 —— **精度靠人工判**（P0 的出口判据就是精度 ≥ 50%）；
 *   · 「同一行为」最终是设计意图，本证只负责**把嫌疑列出来**，不宣判。
 *
 * ## 用法
 *   npm run build && node certs/t455-authority-candidates.mjs [目录]
 *   名单文件：certs/authority-allowlist.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('D:/agentio/dev/agent-io/node_modules/typescript');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'src/infrastructure/authoring/translate');
const ALLOW = path.join(HERE, 'authority-allowlist.json');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 判别标签：这个函数在按哪些"输入构造"分派 */
const isDispatchSubject = (t) => /^(c|n|node|s|stmt|e|expr|fname|fn|kind|type|mm|p|u|fd|c2|x)$/.test(t);
const tagsOf = (sf, fn) => {
  const out = new Set();
  const add = (v) => {
    if (typeof v === 'string' && /^[a-z_]+$/i.test(v) && v.length <= 32) out.add(v);
  };
  const visit = (node) => {
    if (ts.isCaseClause(node)) {
      const e = node.expression;
      if (ts.isStringLiteral(e)) add(e.text);
    }
    if (ts.isBinaryExpression(node) && ['===', '==', '!==', '!=='].includes(node.operatorToken.getText(sf))) {
      const l = node.left.getText(sf);
      const r = node.right;
      if (ts.isStringLiteral(r) && isDispatchSubject(l.split('.').pop())) add(r.text);
      if (ts.isStringLiteral(node.left) && isDispatchSubject(node.right.getText(sf).split('.').pop())) add(node.left.text);
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return out;
};

/** I/O 足迹：读到的成员/名字、写到的成员/名字、返回形状 */
const ioOf = (sf, fn) => {
  const reads = new Set();
  const writes = new Set();
  const retShape = [];
  const addRead = (t) => {
    if (t && t.length <= 40 && /^[A-Za-z_$][\w$.]*$/.test(t)) reads.add(t);
  };
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) addRead(node.getText(sf));
    if (ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node.parent)) addRead(node.text);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = node.left.getText(sf);
      if (/^[A-Za-z_$][\w$.]*$/.test(l)) writes.add(l);
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const t = node.operand.getText(sf);
      if (/^[A-Za-z_$][\w$.]*$/.test(t)) writes.add(t);
    }
    if (ts.isReturnStatement(node) && node.expression) {
      retShape.push(node.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 60));
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return { reads, writes, retShape };
};

const jaccard = (a, b) => {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** 收集同目录下的顶层函数（含内部嵌套的一层，便于比较纯函数） */
const fns = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.ts')).sort()) {
  const abs = path.join(DIR, f);
  const text = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.ES2022, true);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      fns.push({ file: f, name: st.name.text, node: st, sf, text, tags: tagsOf(sf, st), io: ioOf(sf, st) });
    }
  }
}

/** 两函数之间有没有调用关系（粗判：一方的名字出现在对方体里） */
const calls = (a, b) =>
  new RegExp(`\\b${b.name}\\s*\\(`).test(a.node.getText(a.sf)) || new RegExp(`\\b${a.name}\\s*\\(`).test(b.node.getText(b.sf));

const allow = fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, 'utf8')) : { whitelist: [], graylist: [] };
const keyOf = (a, b) => [a, b].sort().join('  <>  ');
const wl = new Set((allow.whitelist ?? []).map((x) => keyOf(x.a, x.b)));
const gray = new Map((allow.graylist ?? []).map((x) => [keyOf(x.a, x.b), x]));
const today = new Date().toISOString().slice(0, 10);

const suspects = [];
for (let i = 0; i < fns.length; i++) {
  for (let j = i + 1; j < fns.length; j++) {
    const a = fns[i];
    const b = fns[j];
    if (calls(a, b)) continue; // 有调用关系 ⇒ 已经是"一处实现 + 委托"，不是双权威
    const tagJ = jaccard(a.tags, b.tags);
    const ioJ = jaccard(new Set([...a.io.reads, ...a.io.writes]), new Set([...b.io.reads, ...b.io.writes]));
    // ★ 规模门槛（第一版假阳性 128/246 对，全是"两个小函数读了同一个变量"）：
    //   · 标签信号：共用标签 ≥3 个（1 个标签重合太常见）
    //   · I/O 信号：两边读数都 ≥8 个已标识符，且两边都 ≥15 行（小函数不判）
    const linesA = a.sf.getLineAndCharacterOfPosition(a.node.getEnd()).line - a.sf.getLineAndCharacterOfPosition(a.node.getStart()).line;
    const linesB = b.sf.getLineAndCharacterOfPosition(b.node.getEnd()).line - b.sf.getLineAndCharacterOfPosition(b.node.getStart()).line;
    const sharedTags = [...a.tags].filter((x) => b.tags.has(x)).length;
    const bigEnough = Math.min(a.io.reads.size, b.io.reads.size) >= 8 && Math.min(linesA, linesB) >= 15;
    const byTag = sharedTags >= 4 && tagJ >= 0.5 && ioJ >= 0.25;
    const byIo = bigEnough && ioJ >= 0.5;
    if (!byTag && !byIo) continue;
    suspects.push({
      k: keyOf(`${a.file}#${a.name}`, `${b.file}#${b.name}`),
      a: `${a.file}#${a.name}`,
      b: `${b.file}#${b.name}`,
      tagJ: Number(tagJ.toFixed(2)),
      ioJ: Number(ioJ.toFixed(2)),
      tags: [...a.tags].filter((x) => b.tags.has(x)).slice(0, 8),
      why: byTag ? 'tag' : 'io',
      lines: Math.min(linesA, linesB),
    });
  }
}
suspects.sort((x, y) => Math.max(y.tagJ, y.ioJ) - Math.max(x.tagJ, x.ioJ));

const known = new Set([...wl, ...gray.keys()]);
const fresh = suspects.filter((s) => !known.has(s.k));
const expired = [...gray.values()].filter((x) => String(x.until ?? '') <= today);
const stillGray = [...gray.values()].filter((x) => String(x.until ?? '') > today);

console.log(`扫描 ${fns.length} 个顶层函数 · 嫌疑对 ${suspects.length} · 白 ${wl.size} · 灰 ${gray.size}（在期内 ${stillGray.length}）`);
for (const s of suspects.slice(0, 12)) {
  console.log(
    `  [tag ${s.tagJ} / io ${s.ioJ}] ${s.a}  <>  ${s.b}${s.tags.length ? `\n      共同标签: ${s.tags.join(', ')}` : ''}`,
  );
}

chk(fresh.length === 0, '① **新嫌疑 = 0**（未进白/灰名单的重复权威嫌疑）', fresh.length ? fresh.slice(0, 5).map((s) => `未登记：${s.a} <> ${s.b}（tag ${s.tagJ} / io ${s.ioJ}）`).join('\n     ') : `嫌疑 ${suspects.length} 对全部已在名单内`);

chk(expired.length === 0, '② **灰名单过期 = 0**（到期自动重新告警）', expired.length ? expired.slice(0, 5).map((x) => `已过期：${keyOf(x.a, x.b)}（until ${x.until}）`).join('\n     ') : `灰名单均在期内（最晚 ${stillGray.map((x) => x.until).sort().pop() ?? '-'}）`);

chk(true, '③ **读数**（P0 出口判据：人工判 20 条，真·双权威 ≥ 10 条才算精度 ≥ 50%）', `候选 ${suspects.length} 对（tag/io 双信号）· 白名单 ${wl.size} · 灰名单 ${gray.size}`);

console.log(`\n═══ T455 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
