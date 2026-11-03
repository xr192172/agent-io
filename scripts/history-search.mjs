#!/usr/bin/env node
/**
 * 历史检索（**只读**）：把「我以前的判断/约定/被推翻的结论」变成可 grep 的东西。
 *
 * 为什么需要它（docs/todo.md `T-#HISTORY-STORE-UNUSED`）：
 *   会话被压缩后，我唯一的记忆是摘要 ⇒ 当天被实测推翻 8 次、反复忘掉前面定的规矩。
 *   而仓里**早就有**两个可检索的库，只是没人（包括主控）去查：
 *     ① `.workbuddy/memory/*.md`  —— 人写的历史库（纯 markdown，grep 即可）
 *     ② `~/.dsh/sessions/<cwd>/session-<id>/session.v4.jsonl.zstd` —— **原始会话全文**
 *
 * ②的技术坑（实测）：那些 .zstd 是**多帧拼接**（单个会话多达 5860 帧），
 *   而 node 的 `zstdDecompressSync` / `createZstdDecompress` **都只解第一帧**
 *   ⇒ 必须按 zstd 帧魔数切分后逐帧解；遇到"切错"（魔数恰好出现在压缩体内部）就并到下一帧重试。
 *
 * 用法（全部只读，不写盘）：
 *   node scripts/history-search.mjs --q 夹具
 *   node scripts/history-search.mjs --q "expected_deps" --sessions        # 连原始会话一起搜
 *   node scripts/history-search.mjs --q 坍缩集 --since 2026-11-02
 *   node scripts/history-search.mjs --session 7c526d0a --q drift
 *   node scripts/history-search.mjs --list                                # 列出有哪些会话
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SKIP_MAGIC_LO = 0x184d2a50;
const SKIP_MAGIC_HI = 0x184d2a5f;

function parseArgs(argv) {
  const a = { q: null, since: null, session: null, sessions: false, list: false, limit: 40, context: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--q') a.q = argv[++i];
    else if (k === '--since') a.since = argv[++i];
    else if (k === '--session') a.session = argv[++i];
    else if (k === '--sessions') a.sessions = true;
    else if (k === '--list') a.list = true;
    else if (k === '--limit') a.limit = Number(argv[++i]) || 40;
    else if (k === '--context') a.context = Number(argv[++i]) || 0;
    else if (k === '-h' || k === '--help') a.help = true;
  }
  return a;
}

/** 按 zstd 帧魔数切分；返回候选帧（可能含"假魔数"造成的碎块）。 */
function splitFrames(buf) {
  const offs = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offs.push(i);
    else if (buf.length - i >= 4) {
      const m = buf.readUInt32LE(i);
      if (m >= SKIP_MAGIC_LO && m <= SKIP_MAGIC_HI) offs.push(i);
    }
  }
  if (offs[0] !== undefined && offs[0] !== 0) offs.unshift(0);
  const out = [];
  for (let k = 0; k < offs.length; k++) out.push(buf.subarray(offs[k], k + 1 < offs.length ? offs[k + 1] : buf.length));
  return out;
}

/** 逐帧解压；解不出来的块并到下一块重试（处理"魔数出现在压缩体内部"）。 */
export function decodeAllFrames(buf) {
  const parts = [];
  let pending = Buffer.alloc(0);
  for (const piece of splitFrames(buf)) {
    pending = pending.length ? Buffer.concat([pending, piece]) : piece;
    try {
      const out = zlib.zstdDecompressSync(pending);
      parts.push(out);
      pending = Buffer.alloc(0);
    } catch {
      /* 留给下一轮拼接 */
    }
  }
  return Buffer.concat(parts);
}

function readSession(file) {
  const raw = fs.readFileSync(file);
  const text = decodeAllFrames(raw).toString('utf8');
  const lines = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      lines.push(JSON.parse(t));
    } catch {
      lines.push({ type: 'raw', text: t });
    }
  }
  return lines;
}

/** 会话/消息的可读摘要（不猜结构：只取认识的字面键）。 */
function describe(ev) {
  const role = ev.role || ev.author || (ev.message && ev.message.role) || null;
  const ts = ev.ts || ev.time || ev.at || ev.createdAt || null;
  let text = '';
  if (typeof ev.text === 'string') text = ev.text;
  else if (typeof ev.content === 'string') text = ev.content;
  else if (Array.isArray(ev.content)) text = ev.content.map((c) => (typeof c === 'string' ? c : c && (c.text || c.content || ''))).join(' ');
  else if (ev.message) text = typeof ev.message === 'string' ? ev.message : JSON.stringify(ev.message);
  else text = JSON.stringify(ev);
  return `[${ev.type || 'ev'}${role ? '/' + role : ''}${ts ? ' @' + ts : ''}] ${text}`;
}

function listSessions() {
  const root = path.join(os.homedir(), '.dsh', 'sessions');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const cwdDir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!cwdDir.isDirectory()) continue;
    const dir = path.join(root, cwdDir.name);
    for (const s of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const f = path.join(dir, s.name, 'session.v4.jsonl.zstd');
      if (fs.existsSync(f)) {
        const st = fs.statSync(f);
        out.push({ id: s.name, cwd: cwdDir.name, file: f, bytes: st.size, mtime: st.mtime });
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function snippet(text, q, width = 150) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return text.slice(0, width).replace(/\s+/g, ' ');
  const s = Math.max(0, i - Math.floor(width / 3));
  return (s > 0 ? '…' : '') + text.slice(s, s + width).replace(/\s+/g, ' ') + '…';
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log(`用法（只读）：
  node scripts/history-search.mjs --q <关键词> [--since YYYY-MM-DD] [--sessions] [--session <id前缀>] [--limit N]
  node scripts/history-search.mjs --list`);
    return;
  }

  const sessions = listSessions();
  if (a.list) {
    console.log(`会话 ${sessions.length} 个（按时间倒序，最近 20）：`);
    for (const s of sessions.slice(0, 20)) {
      console.log(`  ${s.id}  ${(s.bytes / 1024 / 1024).toFixed(2)} MB  ${s.mtime.toISOString().slice(0, 16).replace('T', ' ')}  ${s.cwd}`);
    }
    return;
  }
  if (!a.q) {
    console.error('需要 --q <关键词>（或 --list）');
    process.exit(2);
  }

  const q = a.q;
  let hits = 0;
  const since = a.since ? new Date(a.since) : null;

  // ① 人写的历史库
  const memDir = path.join(process.cwd(), '.workbuddy', 'memory');
  if (fs.existsSync(memDir)) {
    const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md')).sort();
    console.log(`\n=== ① .workbuddy/memory（${files.length} 个文件）===`);
    for (const f of files) {
      if (since && new Date(f.replace('.md', '')) < since) continue;
      const lines = fs.readFileSync(path.join(memDir, f), 'utf8').split('\n');
      const got = [];
      lines.forEach((l, i) => {
        if (l.toLowerCase().includes(q.toLowerCase())) got.push({ i: i + 1, l });
      });
      if (!got.length) continue;
      console.log(`\n  ${f} —— ${got.length} 处`);
      for (const g of got.slice(0, a.limit)) {
        console.log(`    L${g.i}: ${g.l.trim().slice(0, 200)}`);
        hits++;
      }
    }
    if (!hits) console.log('  （无命中）');
  }

  // ③ 会话投影缓存（**纯 JSON，不用解压** —— 三个源里最省事，优先用它）
  const projDir = path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions');
  if (fs.existsSync(projDir)) {
    const files = fs.readdirSync(projDir).filter((f) => f.endsWith('.json'));
    const pool = a.session ? files.filter((f) => f.includes(a.session)) : files;
    console.log(`\n=== ③ 会话投影缓存 session_projcache（纯 JSON · 扫 ${pool.length} 个）===`);
    let projHits = 0;
    for (const f of pool) {
      const full = path.join(projDir, f);
      const st = fs.statSync(full);
      if (since && st.mtime < since) continue;
      let text;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      // 该文件可能是单行 JSON（按 \n 切没用）⇒ 同时按 \n 与 JSON 结构分隔符切段，保证片段可读
      const segs = text
        .split(/\n/)
        .flatMap((s) => s.split(/","|":\{|"\},\{/))
        .filter((s) => s.trim().length > 0);
      const got = segs.filter((s) => s.toLowerCase().includes(q.toLowerCase()));
      if (!got.length) continue;
      console.log(`\n  ${f}（${(st.size / 1024).toFixed(0)} KB）—— ${got.length} 处`);
      for (const g of got.slice(0, a.limit)) {
        console.log(`    ${snippet(g, q)}`);
        projHits++;
      }
    }
    hits += projHits;
    if (!projHits) console.log('  （无命中）');
  }

  // ② 原始会话（逐帧解）
  if (a.sessions || a.session) {
    const pool = a.session ? sessions.filter((s) => s.id.startsWith(a.session)) : sessions;
    console.log(`\n=== ② 原始会话（扫 ${pool.length} 个）===`);
    for (const s of pool) {
      if (since && s.mtime < since) continue;
      let evs;
      try {
        evs = readSession(s.file);
      } catch (e) {
        console.log(`  ${s.id} —— 解压失败：${e.message}`);
        continue;
      }
      const got = evs.filter((ev) => describe(ev).toLowerCase().includes(q.toLowerCase()));
      if (!got.length) continue;
      console.log(`\n  ${s.id}（${(s.bytes / 1024 / 1024).toFixed(2)} MB · ${evs.length} 条事件）—— ${got.length} 处`);
      for (const ev of got.slice(0, a.limit)) {
        console.log(`    ${snippet(describe(ev), q)}`);
        hits++;
      }
    }
    if (hits === 0) console.log('  （无命中）');
  }

  if (!a.sessions && !a.session) {
    console.log('\n（只搜了 ①；要连原始会话一起搜加 --sessions）');
  }
  console.log(`\n合计命中 ${hits} 处`);
}

main();
