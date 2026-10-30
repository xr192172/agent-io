#!/usr/bin/env node
/**
 * ★★★ cert T461 —— **函数/方法签名对拍**（F2 扩面，只读，2026-10-30）
 *
 * ## 为什么
 * `t460` 只比**字段账**。签名（形参名/顺序/类型、返回值个数与类型）没比过 ⇒ 那里的"清白"有边界。
 * 本证把那块边界补上：`go/types` 的签名 vs 我们 `extractGoFromFile` 的 `params` / `result`。
 *
 * ## 判什么
 *   ① 语义层可用（否则 unsupported，不算通过）
 *   ② 比得上东西（不是恒空）
 *   ③ 无未登记分叉（账口径同 t454/t460）
 *   ④ 账跟着现实走（登记了但已消失 = 红）
 *
 * ## 分叉种类
 *   missing-func / extra-func / param-count / param-name / param-type / result-count / result-type
 *
 * ## 归一化（与 t460 同口径）
 *   只比**标识符骨架**（排版/空白/tag 不算差异）+ Go 语法规范化（分组形参展开）。
 *
 * ## 用法
 *   node certs/t461-signature-parity-cert.mjs [Go源目录] [--write-ledger]
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
const LEDGER = path.join(ROOT, '.agent-io/signature-divergences.json');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

function expandGrouped(_m, names, type) {
  const list = names.split(',').map((s) => s.trim()).filter(Boolean);
  return '(' + list.map((n) => `${n} ${type}`).join(', ') + ')';
}

/** 只留标识符骨架（与 t460 同口径） */
const norm = (t) =>
  String(t ?? '')
    .replace(/github\.com\/[^/]+\/[^./]+\./g, '')
    // ★ 我们的类型文本用**包内短名**（`[]memory.Message`），go/types 用全路径 ⇒ 归一化掉包限定符
    // ★ 先剥**整条导入路径**（github.com/jifeng/agent-memory/logging.LogLevel → logging.LogLevel），
    //   再剥**小写包限定符**（logging.LogLevel → LogLevel）。上一版只剥到第一段仓库名 ⇒ 剩 3 条假分叉。
    .replace(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)+\//g, '')
    .replace(/\b[a-z][A-Za-z0-9_]*\./g, '')
    .replace(/[A-Za-z0-9_./-]+\/([A-Za-z_][A-Za-z0-9_]*)\./g, '$1.')
    .replace(/\\"/g, "'")
    .replace(/`[^`]*`/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/json\s*:[^A-Za-z0-9_]+/g, '')
    .replace(/\(\s*[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+\s+([A-Za-z_][\w.[\]*]*)/g, expandGrouped)
    .match(/[A-Za-z_][A-Za-z0-9_]*/g)
    ?.join('.') ?? '';

const { openDb } = await import(D + 'infrastructure/index/db.js');
const { fillSemanticFacts } = await import(D + 'infrastructure/index/semantic_facts.js');
const { extractGoFromFile } = await import(D + 'infrastructure/authoring/translate/go_extractor.js');

const tmp = path.join(os.tmpdir(), `t461-${process.pid}.db`);
const divergences = [];
let compared = 0;
/** ★ 模块级：`goFiles` 要在 try 之外也能用（分类函数需要它）—— 踩过 ReferenceError */
const goFiles = [];

try {
  const db = openDb(tmp);
  const insFile = db.prepare(
    'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors) VALUES (?,?,?,?,?,?,?,?)',
  );
  // ★ 递归扫描（原来只读顶层目录 ⇒ `cmd/memoryd/*.go` 全漏 ⇒ 86 条假 missing-func 里一大半来自此）
  const walkGo = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'vendor' || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walkGo(path.join(dir, e.name), r);
      else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) goFiles.push(r);
    }
  };
  walkGo(GO_PROJ, '');
  for (const f of goFiles) {
    const abs = path.join(GO_PROJ, f);
    insFile.run(f, 'h', 'go', fs.statSync(abs).size, 0, 0, 0, 0);
  }
  const sf = fillSemanticFacts(db, GO_PROJ);
  chk(sf.ok, '① 语义层可用（否则 unsupported）', `via=${sf.via} packages=${sf.packages} files=${sf.files} typeErrors=${sf.typeErrors} signatures=${sf.signatures ?? 0}${sf.reason ? ` · ${sf.reason}` : ''}`);

  if (sf.ok) {
    // 左：go/types 的签名（按 (file, recv, name) 归组成 {params:[], results:[]}）
    const sem = new Map();
    for (const r of db.prepare("SELECT file, structure, name, kind, ordinal, param_name, type FROM signatures ORDER BY file, structure, name, kind, ordinal").all()) {
      const k = `${r.file}::${r.structure}::${r.name}`;
      if (!sem.has(k)) sem.set(k, { params: [], results: [], struct: r.structure, name: r.name });
      const v = sem.get(k);
      (r.kind === 'param' ? v.params : v.results).push({ name: r.param_name ?? '', type: r.type ?? '' });
    }

    // 右：我们的 extractor
    const ours = new Map();
    for (const f of goFiles) {
      let res;
      try {
        res = await extractGoFromFile(path.join(GO_PROJ, f));
      } catch {
        continue;
      }
      for (const u of res.units ?? []) {
        if (u.kind !== 'func') continue;
        // ★ 我们的方法名是**下划线扁平化**的（`Builder_SubmitGraphNode` / `minPairHeap_Len`），
        //   且接收者大小写不定 ⇒ 不再用正则猜，**按原样存**，比较时按候选名回查（见下）。
        //   （第一版按 `.` 拆 ⇒ 429 假 extra；第二版正则限定大写开头 ⇒ 又漏掉小写接收者 79 条）
        const raw = String(u.result ?? '').trim();
        const rl =
          raw.startsWith('(') && raw.endsWith(')')
            ? raw.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean)
            : raw
              ? [raw]
              : [];
        ours.set(`${f}::${u.name}`, {
          params: (u.params ?? []).map((p) => ({ name: p.name ?? '', type: p.type ?? p.typeText ?? '' })),
          results: rl.map((t) => ({ type: t })),
        });
      }
    }
    const usedOurs = new Set();
    for (const [k, s] of sem) {
      // 候选名：普通函数 = 原名；方法 = `<Recv>_<Name>`（我们的扁平化命名）
      const fkey = k.split('::')[0];
      const oursKey = s.struct ? `${fkey}::${s.struct}_${s.name}` : `${fkey}::${s.name}`;
      const o = ours.get(oursKey);
      if (o) usedOurs.add(oursKey);
      if (!o) {
        divergences.push({ kind: 'missing-func', key: k });
        continue;
      }
      compared++;
      // ★ 我们的方法单元把 **receiver 当第一个形参**（`Builder_SubmitGraphNode` 的 params 是 ['b','node']），
      //   而 go/types 的 `sig.Params()` **不含 receiver** ⇒ 不做这一步会有 362 条假 param-count。
      if (s.struct && o.params.length === s.params.length + 1) o.params = o.params.slice(1);
      if (s.params.length !== o.params.length) {
        divergences.push({ kind: 'param-count', key: k, theirs: s.params.length, ours: o.params.length });
      } else {
        s.params.forEach((p, i) => {
          const q = o.params[i];
          if ((p.name ?? '') !== (q.name ?? '')) divergences.push({ kind: 'param-name', key: `${k}#${i}`, theirs: p.name, ours: q.name });
          if (norm(p.type) !== norm(q.type)) divergences.push({ kind: 'param-type', key: `${k}#${i}`, theirs: p.type, ours: q.type });
        });
      }
      if (s.results.length !== o.results.length) {
        divergences.push({ kind: 'result-count', key: k, theirs: s.results.length, ours: o.results.length });
      } else {
        s.results.forEach((r, i) => {
          if (norm(r.type) !== norm(o.results[i].type)) divergences.push({ kind: 'result-type', key: `${k}#${i}`, theirs: r.type, ours: o.results[i].type });
        });
      }
    }
    // ★ extra 必须用「已对上」集合判：ours 的键是**单元原名**（Builder_X），sem 的键是 (file,recv,name)，
    //   两者形态不同 ⇒ 直接 sem.has(unitKey) 会把 564 个签名全判成 extra（踩过：624 条假 extra）。
    for (const k of ours.keys()) if (!usedOurs.has(k)) divergences.push({ kind: 'extra-func', key: k });

    chk(compared > 0, '② **比得上东西**（不是恒空）', `可比签名 ${compared} 个 · 语义签名总数 ${sem.size}`);
  }
  db.close();
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch {}
}

/** 轻量分类：用 Go 源码文本判定分叉性质（只为**归类**，不参与判定） */
function classifySource(dir, files) {
  const typeNames = new Set();
  const varConst = new Set();
  const ifaceMethods = new Set();
  const buildTagFiles = new Set();
  for (const rel of files) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { continue; }
    // 单条声明
    for (const m of txt.matchAll(/^type\s+([A-Za-z_]\w*)/gm)) typeNames.add(m[1]);
    for (const m of txt.matchAll(/^(?:var|const)\s+([A-Za-z_]\w*)/gm)) varConst.add(m[1]);
    // ★ 分组声明 `type (` / `const (` / `var (` 里的成员（单条正则抓不到 ⇒ 假 unknown）
    for (const blk of txt.matchAll(/^(type|var|const)\s*\(([\s\S]*?)\n\)/gm)) {
      for (const m of blk[2].matchAll(/^\s*([A-Za-z_]\w*)/gm)) {
        (blk[1] === 'type' ? typeNames : varConst).add(m[1]);
      }
    }
    // interface 块里的方法（近似：接口体内 `Name(`）
    for (const blk of txt.matchAll(/interface\s*\{([\s\S]*?)\n\}/g)) {
      for (const m of blk[1].matchAll(/([A-Za-z_]\w*)\s*\(/g)) ifaceMethods.add(m[1]);
    }
    // build tag 变体文件（`//go:build ...` 或 _cgo/_nocgo 后缀）
    if (/^\/\/go:build\s/m.test(txt) || /_(cgo|nocgo)\.go$/.test(rel)) buildTagFiles.add(rel);
  }
  return { typeNames, varConst, ifaceMethods, buildTagFiles };
}
const srcIndex = classifySource(GO_PROJ, goFiles);
const categorize = (d) => {
  const name = d.key.split('::').pop()?.split('#')[0] ?? '';
  if (d.kind === 'result-type') return 'named-result-slot'; // 我们的 result 存的是**结果名**不是类型
  if (d.kind === 'missing-func') {
    if (srcIndex.buildTagFiles.has(d.key.split('::')[0])) return 'build-tag-variant';
    if (srcIndex.ifaceMethods.has(name)) return 'interface-method';
    return 'unknown-missing';
  }
  if (d.kind === 'extra-func') {
    if (srcIndex.buildTagFiles.has(d.key.split('::')[0])) return 'build-tag-variant';
    if (srcIndex.typeNames.has(name)) return 'non-func-decl(type)';
    if (srcIndex.varConst.has(name)) return 'non-func-decl(var/const)';
    return 'unknown-extra';
  }
  return d.kind;
};
for (const d of divergences) d.category = categorize(d);

const known = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { entries: [] };
const knownKeys = new Set((known.entries ?? []).map((e) => `${e.kind}|${e.key}`));
const curKeys = new Set(divergences.map((d) => `${d.kind}|${d.key}`));

if (WRITE_LEDGER) {
  const byKind = {};
  for (const d of divergences) {
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    byKind[`cat:${d.category}`] = (byKind[`cat:${d.category}`] ?? 0) + 1;
    (byKind.__ex = byKind.__ex ?? []).push(d);
  }
  const entries = divergences.map((d) => ({
    kind: d.kind,
    category: d.category,
    key: d.key,
    ...(d.theirs !== undefined ? { theirs: d.theirs } : {}),
    ...(d.ours !== undefined ? { ours: d.ours } : {}),
    registered: new Date().toISOString().slice(0, 10),
  }));
  delete byKind.__ex;
  fs.writeFileSync(
    LEDGER,
    JSON.stringify({ note: '函数/方法签名对拍账：未登记=红；登记了但已消失=红', byKind, entries }, null, 2) + '\n',
  );
  console.log(`账已重写：${path.relative(ROOT, LEDGER)}（${entries.length} 条）分布 ${JSON.stringify(byKind)}`);
}

const unregistered = divergences.filter((d) => !knownKeys.has(`${d.kind}|${d.key}`));
const stale = [...knownKeys].filter((k) => !curKeys.has(k));
const show = (list) =>
  list
    .slice(0, 8)
    .map((x) => (typeof x === 'string' ? x : `${x.kind} ${x.key}${x.theirs !== undefined ? ` theirs=${JSON.stringify(x.theirs)}` : ''}${x.ours !== undefined ? ` ours=${JSON.stringify(x.ours)}` : ''}`))
    .join('\n     ');

chk(unregistered.length === 0, '③ **没有未登记的分叉**', unregistered.length ? `${unregistered.length} 条：\n     ${show(unregistered)}` : `分叉 ${divergences.length} 条，全部已登记`);
chk(stale.length === 0, '④ **账跟着现实走**', stale.length ? `${stale.length} 条已消失：${stale.slice(0, 6).join(', ')}` : '账与现实一致');

const kinds = {};
for (const d of divergences) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
console.log(`\n分叉分布：${JSON.stringify(kinds)}`);
console.log(`\n═══ T461 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
