#!/usr/bin/env node
/**
 * ★★★ cert T460 —— **extractor vs go/types 对拍**（F2，只读，2026-10-30）
 *
 * ## 为什么
 * 语义层现在是"事实的权威"，但**不能凭它更权威就删自己的代码**（AGENTS 0.4）。
 * 正确做法同 t454：**对拍 + 分叉账** —— 先证明我们错，再逐条修。
 *
 * ## 对拍什么（目前只比字段账，最小可信起点）
 *   左：`go/types`（经 `fillSemanticFacts` 落进 `fields` 表）—— 声明顺序 ordinal / 类型 / embedded
 *   右：我们 `extractGoFromFile` 的 `unit.fields` —— 名字 / 类型文本
 *   ⇒ 分三类分叉：`missing`（语义有我们没有）/ `extra`（我们有语义没有）/ `type-diff`（类型文本不一致）
 *
 * ## 分叉账（`--ledger`）
 *   · 未登记的分叉 ⇒ **红**；
 *   · 登记了但已经不存在的分叉 ⇒ **也红**（账要跟着现实走，否则账会变成"永久豁免"）。
 *
 * ## 用法
 *   node certs/t460-extractor-parity-cert.mjs [Go源目录]            # 报告 + 判定
 *   node certs/t460-extractor-parity-cert.mjs [dir] --write-ledger   # 用当前分叉重写账（登记用）
 *
 * ## 边界
 *   · 类型文本比较**先归一化**（去包路径、去空白）——只抓"实质不同"，不抓 `foo.Bar` vs `Bar` 这种写法差；
 *   · 只比结构体字段账（方法集/签名/返回值后续另证）；
 *   · 目标项目不能 type-check ⇒ 判 `unsupported`（不算通过）。
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
const WRITE_LEDGER = argv.includes('--write-ledger');
const LEDGER = path.join(ROOT, '.agent-io/extractor-divergences.json');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/**
 * 类型文本归一化：**只留标识符骨架**。
 * 理由：两边（我们的渲染器 vs go/types）排版必然不同（空白 / 分号 / tag 的引号转义），
 * 排版不算实质差异；但**标识符序列**必须一致 ——
 * 例：`func(pattern, brain string)` 骨架是 `func.pattern.brain.string`，
 *     而 `func(pattern string, brain string)` 是 `func.pattern.string.brain.string` ⇒ 差异保留。
 */
const norm = (t) =>
  String(t ?? '')
    .replace(/github\.com\/[^/]+\/[^./]+\./g, '')
    .replace(/[A-Za-z0-9_./-]+\/([A-Za-z_][A-Za-z0-9_]*)\./g, '$1.')
    .replace(/`[^`]*`/g, '')
    .replace(/"[^"]*"/g, '') // 去 tag 值（两边引号转义写法不同）
    .replace(/json:[^A-Za-z0-9_]+/g, '')
    .match(/[A-Za-z_][A-Za-z0-9_]*/g)
    ?.join('.') ?? '';

const { openDb } = await import(D + 'infrastructure/index/db.js');
const { fillSemanticFacts } = await import(D + 'infrastructure/index/semantic_facts.js');
const { extractGoFromFile } = await import(D + 'infrastructure/authoring/translate/go_extractor.js');

const tmp = path.join(os.tmpdir(), `t460-${process.pid}.db`);
const divergences = [];
const semanticByStruct = new Map();

try {
  const db = openDb(tmp);
  const insFile = db.prepare(
    'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors) VALUES (?,?,?,?,?,?,?,?)',
  );
  const goFiles = fs.readdirSync(GO_PROJ).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
  for (const f of goFiles) {
    const abs = path.join(GO_PROJ, f);
    insFile.run(f, 'h', 'go', fs.statSync(abs).size, 0, 0, 0, 0);
  }
  const sf = fillSemanticFacts(db, GO_PROJ);
  chk(sf.ok, '① 语义层可用（否则本证 unsupported，不算通过）', `via=${sf.via} packages=${sf.packages} files=${sf.files} typeErrors=${sf.typeErrors}${sf.reason ? ` · ${sf.reason}` : ''}`);

  if (sf.ok) {
    // ★ 按 **(file, structure)** 聚合，不是按结构体名 —— 否则 build tag 互斥变体（同名不同字段）
    //   会被并集，产生假分叉（实测：LocalEmbedder 的 cgo / !cgo 两个文件）。
    for (const row of db.prepare('SELECT file, structure, name, ordinal, type, embedded FROM fields ORDER BY structure, ordinal').all()) {
      const sk = `${row.file}::${row.structure}`;
      if (!semanticByStruct.has(sk)) semanticByStruct.set(sk, { structure: row.structure, fields: new Map() });
      semanticByStruct.get(sk).fields.set(row.name, { ordinal: row.ordinal, type: row.type, embedded: !!row.embedded });
    }

    // 右：我们的 extractor
    const ourByStruct = new Map();
    for (const f of goFiles) {
      let r;
      try {
        r = await extractGoFromFile(path.join(GO_PROJ, f));
      } catch {
        continue;
      }
      for (const u of r.units ?? []) {
        if (u.typeKind !== 'struct' || !u.fields?.length) continue;
        const sk = `${f}::${u.name}`;
        if (!ourByStruct.has(sk)) ourByStruct.set(sk, new Map());
        for (const fl of u.fields) ourByStruct.get(sk).set(fl.name, { type: fl.type });
      }
    }

    let compared = 0;
    for (const [sk, semPack] of semanticByStruct) {
      const struct = semPack.structure;
      const sem = semPack.fields;
      const ours = ourByStruct.get(sk);
      if (!ours) continue;
      compared++;
      for (const [name, s] of sem) {
        if (!ours.has(name)) {
          divergences.push({ kind: 'missing', struct, field: name, why: 'go/types 有该字段，我们的 extractor 没产出' });
          continue;
        }
        const o = ours.get(name);
        if (norm(o.type) !== norm(s.type)) {
          divergences.push({ kind: 'type-diff', struct, field: name, ours: o.type, theirs: s.type, why: '字段类型文本实质不一致' });
        }
      }
      for (const name of ours.keys()) {
        if (!sem.has(name)) divergences.push({ kind: 'extra', struct, field: name, why: '我们的 extractor 产出了 go/types 里没有的字段' });
      }
    }
    chk(compared > 0, '② **比得上东西**（不是恒空）', `可比 (file,structure) ${compared} 对 · 语义字段总数 ${[...semanticByStruct.values()].reduce((a, p) => a + p.fields.size, 0)}`);
  }
  db.close();
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch {}
}

// ③④ 分叉账
const key = (d) => `${d.struct}.${d.field}`;
const known = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { entries: [] };
const knownKeys = new Set((known.entries ?? []).map((e) => e.key));
const curKeys = new Set(divergences.map(key));

if (WRITE_LEDGER) {
  const entries = divergences.map((d) => ({
    key: key(d),
    kind: d.kind,
    why: d.why,
    ...(d.ours ? { ours: d.ours } : {}),
    ...(d.theirs ? { theirs: d.theirs } : {}),
    registered: new Date().toISOString().slice(0, 10),
  }));
  fs.writeFileSync(LEDGER, JSON.stringify({ note: 'extractor vs go/types 的已知分叉账：未登记=红；登记了但已消失=红', entries }, null, 2) + '\n');
  console.log(`账已重写：${path.relative(ROOT, LEDGER)}（${entries.length} 条）`);
}

const unregistered = divergences.filter((d) => !knownKeys.has(key(d)));
const stale = [...knownKeys].filter((k) => !curKeys.has(k));
const summary = (list) => list.slice(0, 6).map((x) => (typeof x === 'string' ? x : `${x.struct}.${x.field}（${x.kind}${x.ours ? ` ours=${x.ours}` : ''}${x.theirs ? ` theirs=${x.theirs}` : ''}）`)).join('\n     ');

chk(unregistered.length === 0, `③ **没有未登记的分叉**`, unregistered.length ? `${unregistered.length} 条：\n     ${summary(unregistered)}` : `分叉 ${divergences.length} 条，全部已登记`);
chk(stale.length === 0, '④ **账跟着现实走**（登记了但已消失的分叉也要删掉）', stale.length ? `${stale.length} 条已消失：${stale.slice(0, 6).join(', ')}` : '账与现实一致');

console.log(`\n分叉分布：${['missing', 'extra', 'type-diff'].map((k) => `${k}=${divergences.filter((d) => d.kind === k).length}`).join(' · ')}`);
console.log(`\n═══ T460 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
