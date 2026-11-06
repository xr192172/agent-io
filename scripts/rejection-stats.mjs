#!/usr/bin/env node
/**
 * rejection-stats —— 「业务拒绝」的读数命令（本仓**第三本账**的唯一读端）
 *
 * ## 它回答的问题
 * 「该做、但被规则挡下」发生了多少次、分别是什么（任务闸 / 重写计划闸 / 判据不够 / 合理性校验…），
 * 与「代码错」（B）、「探测」（C）、「调用方用错」（D）、「判不了」（unknown）**分得开**吗？
 *
 * ## 为什么它必须读**所有**候选账本（本卡的本体就是拿错一本）
 * 实测（2026-11-07）：账本会按 `AGENT_IO_HOME` 分裂成两本 ——
 *   · `.agent-io/dogfood/usage.jsonl`          26,211 行，`via:"mcp"` **零条**（全是门/扫射/证/CLI）
 *   · `.agentio-data/dogfood/usage.jsonl`      10,633 行，`via:"mcp"` **3,720** 条
 * ⇒ 拿任意一本当"全部"，量出来的都可能是**另一本**的事实。
 * ⇒ 本命令**逐个点名**它读了哪几本、各多少行；**多于一本就响亮报警**（不静默合并、不假装统一）。
 *
 * ## 口径（三条，都能红）
 * ① `C 探测` = `via ∈ {sweep, gate}` —— 门与扫射不回答"业务有没有被挡"，**先排除并报出排除了多少**；
 * ② 拒绝事件的分类**现算**：拿 sidecar（`rejections.jsonl`）里的**事实**跑
 *    `dist/src/domain/rejection_kind.js#classifyRejection` —— 不读任何已冻结的 verdict
 *    ⇒ 改判定 ⇒ 本命令输出跟着变（这就是"口径可复算"的牙）；
 * ③ 守恒式：在 sidecar 覆盖窗口内，`(usage 里 ok=false 且非探测的行数)` 必须 **等于**
 *    `(sidecar 里非探测的行数)` —— 不等就**非零退出**并点名差多少。
 *    ★ 为什么用窗口：仪表上线**之前**的历史行没有 sidecar（那是"没装仪表"，不是"漏记"）。
 *      窗口起点 = sidecar 最早一条的 ts，读端把它**印出来**，不许藏在代码里。
 *
 * ## 退出码
 *   0 = 平且可分；1 = 守恒式不平（仪表漏记 / 多记）；2 = 读不了（dist 没建 / 没有账本）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 从本文件向上找到 `package.json` 且 `name === 'agent-io'` 的目录（包根） */
function packageRootFrom(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        if (JSON.parse(fs.readFileSync(pj, 'utf-8')).name === 'agent-io') return dir;
      } catch {
        /* 坏 package.json ⇒ 继续上溯 */
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(start);
}

const PKG_ROOT = packageRootFrom(HERE);

/**
 * 候选账本 —— **全部**列出来，逐个点名。
 * ★ 顺序 = 显式声明优先；★ 去重后**只保留存在的**，但"不存在"也印（避免把"没有"读成"零"）。
 */
function candidateLedgers() {
  const seen = new Set();
  const out = [];
  const add = (p, why) => {
    const abs = path.resolve(p);
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ file: abs, why });
  };
  if (process.env.AGENT_IO_DOGFOOD_FILE) add(process.env.AGENT_IO_DOGFOOD_FILE, 'AGENT_IO_DOGFOOD_FILE（显式覆写）');
  // ③ 跨项目数据仓（getStorageRoot 的第 ③ 支 —— 本仓默认落这里）
  add(path.join(PKG_ROOT, '.agentio-data', 'dogfood', 'usage.jsonl'), '<包根>/.agentio-data（getStorageRoot ③）');
  // ② AGENT_IO_HOME 在场时写端落这里
  add(path.join(PKG_ROOT, '.agent-io', 'dogfood', 'usage.jsonl'), '<包根>/.agent-io（getStorageRoot ② 的影子）');
  // ④ 已安装 / 无项目场景
  const dataHome = process.env.AGENT_IO_HOME || os.homedir();
  add(path.join(dataHome, '.agent-io', 'dogfood', 'usage.jsonl'), '<dataHome>/.agent-io（getStorageRoot ②/④）');
  return out;
}

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf-8').split('\n');
  const rows = [];
  let broken = 0;
  for (const line of raw) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      broken += 1;
    }
  }
  return { rows, broken };
}

const PROBE = new Set(['sweep', 'gate']);

function countBy(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const domainFile = path.join(PKG_ROOT, 'dist/src/domain/rejection_kind.js');
  if (!fs.existsSync(domainFile)) {
    console.error(
      `✗ 找不到分类核：${domainFile}\n  ⇒ 先构建：cmd /c "npm run build"（本命令**不许**自带一份判定，否则就是两处权威）`,
    );
    return 2;
  }
  const { classifyRejection, REJECTION_KIND_LABEL } = await import(pathToFileURL(domainFile).href);

  const ledgers = candidateLedgers();
  const present = ledgers.filter((l) => fs.existsSync(l.file));

  const lines = [];
  lines.push('══ 拒绝账读数（rejection-stats）══');
  lines.push('');
  lines.push('① 账本清单（★ 多于一本 ⇒ 读数必须两本都算，别拿一本当全部）');
  for (const l of ledgers) {
    if (!fs.existsSync(l.file)) {
      lines.push(`  · （不存在）${l.file}  ← ${l.why}`);
      continue;
    }
    const { rows, broken } = readJsonl(l.file);
    const via = countBy(rows, (r) => (r.via ?? '<无 via>')).map(([k, v]) => `${k} ${v}`).join(' / ');
    lines.push(`  · ${l.file}  ← ${l.why}`);
    lines.push(`      行数 ${rows.length}${broken ? `（坏行 ${broken}）` : ''} ｜ via：${via || '—'}`);
  }
  if (present.length === 0) {
    console.error('\n✗ 一本账本都不存在 ⇒ 读不了（不是"0 次拒绝"）');
    return 2;
  }
  if (present.length > 1) {
    lines.push('');
    lines.push(`  ⚠️ **账本分裂：${present.length} 本** —— 它们**不是**彼此的副本，`);
    lines.push('     任何"只读其中一本"的统计都只覆盖一部分调用（"业务拒绝 = 0"就是这么量出来的）。');
  }

  // ── 汇总 usage 行 ────────────────────────────────────────────
  const usageRows = [];
  const sidecarRows = [];
  for (const l of present) {
    const u = readJsonl(l.file);
    for (const r of u.rows) usageRows.push({ ...r, __ledger: l.file });
    const side = path.join(path.dirname(l.file), 'rejections.jsonl');
    if (fs.existsSync(side)) {
      const s = readJsonl(side);
      for (const r of s.rows) sidecarRows.push({ ...r, __ledger: side });
    }
  }

  const probeUsage = usageRows.filter((r) => PROBE.has(r.via));
  const realUsage = usageRows.filter((r) => !PROBE.has(r.via));
  const probeSide = sidecarRows.filter((r) => PROBE.has(r.via));
  const realSide = sidecarRows.filter((r) => !PROBE.has(r.via));

  lines.push('');
  lines.push('② 分桶（C = 探测，先排除再算）');
  lines.push(`  N（全部 usage 行）           ${usageRows.length}`);
  lines.push(`  C 探测（via ∈ {sweep,gate}）  ${probeUsage.length}   ← **排除**，不参与业务分母`);
  lines.push(`  非探测 usage 行               ${realUsage.length}`);
  lines.push(`     其中 ok=false              ${realUsage.filter((r) => r.ok === false).length}`);
  lines.push(`     其中 ok=true               ${realUsage.filter((r) => r.ok !== false).length}`);

  // ── 拒绝事件分类（现算）──────────────────────────────────────
  const kinds = new Map();
  for (const r of realSide) {
    const k = classifyRejection(r);
    if (!kinds.has(k)) kinds.set(k, []);
    kinds.get(k).push(r);
  }
  lines.push('');
  lines.push('③ 拒绝事件分类（★ 现算：拿 sidecar 里的**事实**跑 domain#classifyRejection）');
  if (realSide.length === 0) {
    lines.push('  （sidecar 还没有非探测记录 —— 仪表可能刚上线，或调用全部成功）');
  } else {
    for (const k of ['A', 'B', 'D', 'unknown']) {
      const list = kinds.get(k) ?? [];
      lines.push(`  ${REJECTION_KIND_LABEL[k] ?? k}：${list.length}`);
      const top = countBy(list, (r) => String(r.tool ?? '?')).slice(0, 3);
      if (top.length) lines.push(`      工具：${top.map(([t, n]) => `${t} ${n}`).join(' · ')}`);
      const heads = countBy(list, (r) => String(r.message ?? '').split('\n')[0].slice(0, 46)).slice(0, 3);
      for (const [h, n] of heads) lines.push(`      ×${n}  ${h}`);
    }
    if (probeSide.length) lines.push(`  C 探测（sidecar 里被排除的）：${probeSide.length}`);
    const accounted = ['A', 'B', 'D', 'unknown'].reduce((s, k) => s + (kinds.get(k)?.length ?? 0), 0);
    lines.push(`  —— 四类相加 ${accounted} ／ sidecar 非探测行 ${realSide.length}`);
  }

  // ── 守恒式（窗口内）─────────────────────────────────────────
  lines.push('');
  lines.push('④ 守恒式（窗口内）：C + ok + (A+B+D+unknown) == N');
  const windowStart = realSide.map((r) => String(r.ts ?? '')).filter(Boolean).sort()[0] ?? null;
  if (!windowStart) {
    lines.push('  窗口：**未开始**（sidecar 还没有非探测记录）⇒ 本式无判据对象（不假装平）');
    lines.push('  ⇒ 起一次会被规则挡的调用（例如未领卡就改源码 / 判据不够的 claim），本式就会有对象。');
    console.log(lines.join('\n'));
    return 0;
  }
  const inWindow = realUsage.filter((r) => String(r.ts ?? '') >= windowStart);
  const badInWindow = inWindow.filter((r) => r.ok === false).length;
  const okInWindow = inWindow.filter((r) => r.ok !== false).length;
  const accounted = ['A', 'B', 'D', 'unknown'].reduce((s, k) => s + (kinds.get(k)?.length ?? 0), 0);
  lines.push(`  窗口起点（sidecar 最早一条）：${windowStart}`);
  lines.push(`  窗口内：ok=false ${badInWindow} ｜ ok=true ${okInWindow} ｜ A+B+D+unknown ${accounted}`);
  const delta = badInWindow - accounted;
  if (delta === 0) {
    lines.push(`  ✅ 平：${badInWindow} = ${accounted}（每一条失败都有账，没有漏记也没有多记）`);
  } else {
    lines.push(
      `  ❌ **不平：差 ${delta}** —— ${delta > 0 ? `有 ${delta} 条失败**没进 sidecar**（漏记：通道没接上 / 记录失败）` : `sidecar 比失败多 ${-delta} 条（多记：同一次失败被记了多遍）`}`,
    );
  }

  console.log(lines.join('\n'));
  return delta === 0 ? 0 : 1;
}

process.exitCode = await main();
