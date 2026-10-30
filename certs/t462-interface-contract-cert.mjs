#!/usr/bin/env node
/**
 * ★★★ cert T462 —— **接口契约审计**（只读，2026-10-30）
 *
 * ## 为什么
 * Go 是**隐式实现**：编译器不会提醒"这个接口没人实现"，也不会提醒"两个接口方法集完全相同"。
 * 这两类病只能靠事实层查，而且都属于我们自己的原则：
 *   · **0 实现的接口** = 死契约（语料实测：`SessionRepository` / `MemorySource`）
 *   · **方法集完全相同的两个接口** = 同一行为两处权威（语料实测：`sender` ≡ `LLMClient`）
 *
 * ## 判什么
 *   ① 事实层可用且有数据（否则 unsupported）
 *   ② **0 实现的接口**必须登记（allowlist 带 reason + until）
 *   ③ **方法集指纹相同**的接口对必须登记（one-authority 重复）
 *   ④ 账跟着现实走（登记了但已消失 = 红）
 *
 * ## 边界
 *   · 实现者枚举只在**同一包 scope 内**（跨包实现者不计入 ⇒ 会多报 no-impl，需登记说明）；
 *   · 只比**方法名集合**（不比签名）⇒ 同名单签名不同的接口会被误报为"相同"，需登记；
 *   · 不含 build-tag 变体的合并（cgo 特有的实现者可能缺席）。
 *
 * 用法：node certs/t462-interface-contract-cert.mjs [Go源目录] [--write-ledger]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const argv = process.argv.slice(2);
const GO_PROJ = argv.find((a) => !a.startsWith('--')) ?? 'D:/agentio/dev/agent-memory';
const WRITE = argv.includes('--write-ledger');
const LEDGER = path.join(ROOT, '.agent-io/contract-audit.json');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { openDb } = await import(D + 'infrastructure/index/db.js');
const { fillSemanticFacts } = await import(D + 'infrastructure/index/semantic_facts.js');

const tmp = path.join(os.tmpdir(), `t462-${process.pid}.db`);
const findings = [];
let ifaceCount = 0;

try {
  const db = openDb(tmp);
  const ins = db.prepare(
    'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors) VALUES (?,?,?,?,?,?,?,?)',
  );
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'vendor' || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) {
        const abs = path.join(dir, e.name);
        ins.run(r, 'h', 'go', fs.statSync(abs).size, 0, 0, 0, 0);
      }
    }
  };
  walk(GO_PROJ, '');

  const sf = fillSemanticFacts(db, GO_PROJ);
  const rows = db.prepare('SELECT file, name, methods, impls FROM contracts ORDER BY name').all();
  ifaceCount = rows.length;
  chk(sf.ok && rows.length > 0, '① 事实层可用且有接口契约数据', `via=${sf.via} typeErrors=${sf.typeErrors} 接口 ${rows.length} 个${sf.reason ? ` · ${sf.reason}` : ''}`);

  // ② 0 实现
  for (const r of rows) {
    const impls = JSON.parse(r.impls || '[]');
    if (impls.length === 0) findings.push({ kind: 'no-impl', key: `${r.name}`, file: r.file, methods: JSON.parse(r.methods || '[]') });
  }
  // ③ 方法集指纹相同
  const byFp = new Map();
  for (const r of rows) {
    const ms = JSON.parse(r.methods || '[]');
    if (!ms.length) continue; // 空接口不谈"重复权威"
    const fp = ms.join(',');
    if (!byFp.has(fp)) byFp.set(fp, []);
    byFp.get(fp).push(r.name);
  }
  for (const [, names] of byFp) {
    if (names.length < 2) continue;
    findings.push({ kind: 'duplicate-methodset', key: names.sort().join(' ≡ '), methods: names });
  }

  db.close();
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch {}
}

const known = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { entries: [] };
const kk = (f) => `${f.kind}|${f.key}`;
const knownKeys = new Set((known.entries ?? []).map(kk));
const curKeys = new Set(findings.map(kk));

if (WRITE) {
  fs.writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note: '接口契约审计账：未登记=红；登记了但已消失=红。口径同 t454/t460/t461。',
        entries: findings.map((f) => ({ kind: f.kind, key: f.key, registered: new Date().toISOString().slice(0, 10) })),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`账已重写：${path.relative(ROOT, LEDGER)}（${findings.length} 条）`);
}

const unreg = findings.filter((f) => !knownKeys.has(kk(f)));
const stale = [...knownKeys].filter((k) => !curKeys.has(k));
const show = (l) => l.slice(0, 8).map((x) => (typeof x === 'string' ? x : `${x.kind} · ${x.key}`)).join('\n     ');

chk(unreg.length === 0, '②③ **没有未登记的契约问题**（0 实现 / 方法集重复）', unreg.length ? `${unreg.length} 条：\n     ${show(unreg)}` : `问题 ${findings.length} 条，全部已登记`);
chk(stale.length === 0, '④ **账跟着现实走**', stale.length ? `${stale.length} 条已消失：${stale.slice(0, 6).join(', ')}` : '账与现实一致');

const kinds = {};
for (const f of findings) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
console.log(`\n接口 ${ifaceCount} 个 · 问题分布：${JSON.stringify(kinds)}`);
console.log(`\n═══ T462 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
