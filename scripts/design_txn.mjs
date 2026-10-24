#!/usr/bin/env node
/**
 * design_txn —— 设计册的「练手场」：begin / preview / commit / cancel
 *
 * ## 为什么是文件事务，不是数据库事务
 * 设计册（`design/<f>.dsl.json`）是**源**。按「可手写 / 可重建 / 高效查 三者选两个」：
 * 源必须可手写 ⇒ 必须是文件。而文件做事务反而更干净：
 *
 *   begin   = 复制一份工作副本（原文件按字节不动）
 *   edit    = 改工作副本
 *   preview = 在工作副本上求值（**不写任何文件**）
 *   commit  = 校验 base_sha 未变 → 原子 rename 到正式位置
 *   cancel  = 删工作副本 —— **原文件从没被碰过，字节级还原天然成立**
 *
 * ≥ 这不是"模拟事务"：`cancel` 之后正式文件的 sha256 必然等于 `begin` 时的读数，
 *   因为它根本没被写过。sqlite 的 ROLLBACK 保证"逻辑还原"，这里保证"物理没动"。
 *
 * ## 三条判据（对应 v2 §4.6）
 * 1. cancel 后 sha256 === begin 时的 sha256
 * 2. preview 期间 `design/<f>.dsl.json` 与 `cache.db` 的 mtime 不变
 * 3. commit 前打印 "会产生什么"（读数差），且 base_sha 不匹配则拒绝
 *
 * 用法：
 *   node scripts/design_txn.mjs begin <book>
 *   node scripts/design_txn.mjs status
 *   node scripts/design_txn.mjs preview
 *   node scripts/design_txn.mjs commit
 *   node scripts/design_txn.mjs cancel
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DESIGN = '.agent-io/design';
const TXN = path.join(DESIGN, '.txn');
const MANIFEST = path.join(TXN, 'manifest.json');
const WORK = path.join(TXN, 'work.dsl.json');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const readManifest = () => {
  if (!fs.existsSync(MANIFEST)) die('没有进行中的事务（先 `begin <book>`）');
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
};

/** 从 DSL 里数出"改了什么"的关键读数 —— 只读，不判语义 */
function readings(dsl) {
  const nodes = dsl.geometry?.nodes ?? [];
  const byIntent = {};
  const byKind = {};
  let expectations = 0;
  for (const n of nodes) {
    const i = n.intent || 'live';
    byIntent[i] = (byIntent[i] || 0) + 1;
    if (i === 'retired') continue;
    for (const e of n.decision?.expectations ?? []) {
      expectations++;
      byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    }
  }
  return { nodes: nodes.length, byIntent, expectations, byKind };
}

function begin(book) {
  if (!book) die('用法：begin <book>（如 task-system-plan）');
  if (fs.existsSync(MANIFEST)) die('已有进行中的事务，先 `commit` 或 `cancel`');
  const target = path.join(DESIGN, `${book}.dsl.json`);
  if (!fs.existsSync(target)) die(`找不到 ${target}`);
  const buf = fs.readFileSync(target);
  fs.mkdirSync(TXN, { recursive: true });
  fs.writeFileSync(WORK, buf);
  const m = {
    book,
    target,
    base_sha256: sha256(buf),
    started_at: new Date().toISOString(),
    work_file: WORK,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
  const r = readings(JSON.parse(buf.toString('utf-8')));
  console.log(`✔ 已开事务：${book}`);
  console.log(`  base_sha256 = ${m.base_sha256.slice(0, 16)}…`);
  console.log(`  工作副本    = ${WORK}`);
  console.log(`  基线读数    = 节点 ${r.nodes} ｜ 判据 ${r.expectations} ｜ ${JSON.stringify(r.byIntent)}`);
  console.log(`  ⇒ 现在改【工作副本】。原文件 ${target} 不会被碰，直到 commit。`);
}

function status() {
  const m = readManifest();
  const baseSha = sha256(fs.readFileSync(m.target));
  const workBuf = fs.readFileSync(WORK);
  const a = readings(JSON.parse(fs.readFileSync(m.target, 'utf-8')));
  const b = readings(JSON.parse(workBuf.toString('utf-8')));
  console.log(`事务：${m.book}（开始于 ${m.started_at}）`);
  console.log(`  正式文件当前 sha ${baseSha.slice(0, 16)}… ${baseSha === m.base_sha256 ? '= base ✔（未被外部改动）' : '≠ base ✗（练手期间被改过，commit 会拒绝）'}`);
  console.log(`  工作副本   sha ${sha256(workBuf).slice(0, 16)}… ${sha256(workBuf) === m.base_sha256 ? '（还没改）' : '（已改）'}`);
  console.log(`  读数  正式：节点 ${a.nodes} ｜ 判据 ${a.expectations}`);
  console.log(`        工作：节点 ${b.nodes} ｜ 判据 ${b.expectations}`);
  const dNode = b.nodes - a.nodes;
  const dExp = b.expectations - a.expectations;
  if (dNode || dExp) console.log(`  差  节点 ${dNode >= 0 ? '+' : ''}${dNode} ｜ 判据 ${dExp >= 0 ? '+' : ''}${dExp}`);
}

async function preview() {
  const m = readManifest();
  // ★ 只读工作副本；正式文件与 cache.db 一个字节都不写
  const workDsl = JSON.parse(fs.readFileSync(WORK, 'utf-8'));
  const { collectExpectations } = await import('../dist/src/domain/expectation.js');
  const { judgeExpectations } = await import('../dist/src/application/design/intent/expectations.js');
  const items = collectExpectations(workDsl);
  const rep = await judgeExpectations('.', items);
  const by = {};
  for (const it of rep.items) by[it.verdict] = (by[it.verdict] || 0) + 1;
  console.log(`preview（工作副本，未写盘）`);
  console.log(`  收集判据 ${items.length} 条 ｜ 求值 ${JSON.stringify(by)} ｜ checked=${rep.checked}`);
  if (rep.checked !== items.length) console.log(`  ⚠ 报告不完整：checked ${rep.checked} ≠ ${items.length}（残报）`);
  const bad = rep.items.filter((x) => x.verdict !== 'pass');
  for (const b of bad.slice(0, 15)) {
    console.log(`    ${b.verdict}  ${b.expectation.path || ''} :: ${b.expectation.symbol || b.expectation.kind}`);
  }
  if (bad.length > 15) console.log(`    …另有 ${bad.length - 15} 条`);
  console.log(bad.length === 0 ? '  ✅ 全 pass' : `  ⚠ ${bad.length} 条非 pass（commit 不因红而拒绝，由你判断）`);
}

function commit() {
  const m = readManifest();
  const nowSha = sha256(fs.readFileSync(m.target));
  if (nowSha !== m.base_sha256) {
    die(`正式文件在练手期间被改过（sha ${nowSha.slice(0, 16)}… ≠ base ${m.base_sha256.slice(0, 16)}…）⇒ 拒绝提交，请重新 begin`);
  }
  const workBuf = fs.readFileSync(WORK);
  if (sha256(workBuf) === m.base_sha256) {
    console.log('工作副本与正式文件一致 —— 没有改动，什么都不做。');
    fs.rmSync(TXN, { recursive: true, force: true });
    return;
  }
  const tmp = `${m.target}.committing`;
  fs.writeFileSync(tmp, workBuf);
  fs.renameSync(tmp, m.target);
  const after = sha256(fs.readFileSync(m.target));
  fs.rmSync(TXN, { recursive: true, force: true });
  console.log(`✔ 已提交：${m.target}`);
  console.log(`  sha ${m.base_sha256.slice(0, 16)}… → ${after.slice(0, 16)}…`);
}

function cancel() {
  const m = readManifest();
  fs.rmSync(TXN, { recursive: true, force: true });
  const sha = sha256(fs.readFileSync(m.target));
  const ok = sha === m.base_sha256;
  console.log(`✔ 已取消${ok ? '' : '（但正式文件已被外部改动）'}`);
  console.log(`  正式文件 sha ${sha.slice(0, 16)}… ${ok ? '= base ✔ 字节级还原' : '≠ base ✗'}`);
}

const [cmd, arg] = process.argv.slice(2);
const table = { begin: () => begin(arg), status, preview, commit, cancel };
if (!table[cmd]) die(`未知命令：${cmd || '(空)'}。可用：begin <book> / status / preview / commit / cancel`);
await table[cmd]();
