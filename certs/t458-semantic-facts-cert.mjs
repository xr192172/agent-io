#!/usr/bin/env node
/**
 * ★★★ cert T458 —— **F1 语义层事实表**（只读、自建临时库，2026-10-30）
 *
 * ## 为什么需要这张证
 * `schema.ts` 的改动用 `source-has` 判不了对错（存在类判据发现不了逻辑错）。
 * 真判据只能是：**在全新库里跑一遍建表，表真的在、列真的齐、能写能查**。
 *
 * ## 判什么
 *   ① `occurrences` 表存在，且列齐（file_id/line/col/symbol_id/role/structure/member）
 *   ② `fields` 表存在，且列齐（structure/name/ordinal/type/json_tag/embedded）
 *   ③ 两张表**能写能查**（插入一行再读回，验证主键/外键/索引真的可用）
 *   ④ **既有表不受影响**（nodes/edges/files/identifiers/imports 仍在）
 *
 * ## 边界
 *   · 只验"表结构可用"，**不验填充正确性**（填充属 F1b，由语义层落地后再判）；
 *   · 用临时库文件，跑完即删 —— 不碰真实 cache.db。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { openDb } = await import(D + 'infrastructure/index/db.js');

const tmp = path.join(os.tmpdir(), `t458-${process.pid}.db`);
try {
  const db = openDb(tmp); // 全新库 ⇒ 走 SCHEMA_SQL 建表
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  const colsOf = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));

  const occCols = colsOf('occurrences');
  const occWant = ['file_id', 'line', 'col', 'symbol_id', 'role', 'structure', 'member'];
  const occMissing = occWant.filter((c) => !occCols.has(c));
  chk(tables.has('occurrences') && occMissing.length === 0, '① occurrences 表存在且列齐', occMissing.length ? `缺列：${occMissing.join(', ')}` : `列：${[...occCols].join(', ')}`);

  const fCols = colsOf('fields');
  const fWant = ['file', 'structure', 'name', 'ordinal', 'type', 'json_tag', 'embedded']; // ★ file = 出处（build tag 变体靠它区分）
  const fMissing = fWant.filter((c) => !fCols.has(c));
  chk(tables.has('fields') && fMissing.length === 0, '② fields 表存在且列齐', fMissing.length ? `缺列：${fMissing.join(', ')}` : `列：${[...fCols].join(', ')}`);

  // ③ 能写能查（含主键冲突必须报错）
  let rwOk = false;
  let pkOk = false;
  let detail = '';
  try {
    db.prepare("INSERT INTO files (id, path, content_hash, language, size, modified_at, indexed_at, node_count, errors) VALUES (1,'x.ts','h','ts',1,0,0,0,0)").run();
    db.prepare("INSERT INTO occurrences (file_id, line, col, symbol_id, role, structure, member) VALUES (1, 3, 7, 'sym_a', 'selection', 'CachedNode', 'graphNode')").run();
    const back = db.prepare('SELECT symbol_id, role, member FROM occurrences WHERE file_id=1').get();
    rwOk = back?.symbol_id === 'sym_a' && back?.role === 'selection' && back?.member === 'graphNode';
    detail = JSON.stringify(back);
    db.prepare("INSERT INTO fields (file, structure, name, ordinal, type, json_tag, embedded) VALUES ('graph_cache.go','CachedNode','graphNode',0,'graphNode',null,1)").run();
    try {
      // 同 (file, structure, name) 再插一次 ⇒ 主键必须拒绝；**不同 file 允许同名**（build tag 变体）
      db.prepare("INSERT INTO fields (file, structure, name, ordinal) VALUES ('graph_cache.go','CachedNode','graphNode',9)").run();
      pkOk = false; // 主键没生效
    } catch {
      pkOk = true;
    }
  } catch (e) {
    detail = String(e);
  }
  chk(rwOk && pkOk, '③ 两张表**能写能查**，且 fields 主键生效', detail);

  const keep = ['nodes', 'edges', 'files', 'identifiers', 'imports'];
  const lost = keep.filter((t) => !tables.has(t));
  chk(lost.length === 0, '④ **既有表不受影响**', lost.length ? `丢表：${lost.join(', ')}` : `仍在：${keep.join(', ')}`);

  db.close();
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch {}
}

console.log(`\n═══ T458 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
