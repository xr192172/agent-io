#!/usr/bin/env node
/**
 * migrate-decision-history —— 把 `decision_history` 从设计册**搬到** `<f>.history.jsonl`（一次性迁移，幂等）。
 *
 * ## 为什么是「两遍 + 幂等」而不是「整册原子替换」（这是本脚本的设计要害）
 * 一遍：读册 → 把每条 entry **append** 到侧车（同 `(node,index,sha256)` 跳过）→ 立刻算 C1/C2/C3。
 *       **不等就停**（并把侧车截回跑之前的字节长度）—— 此时**册一个字节都没动**。
 * 二遍：才把册里的 `decision_history` 删掉 + `saveDSL`。
 * ⇒ 失败时坏在「**两处都在**」（会被读端/门**响亮报出**），而不是「两处都没有」（**不可发现**）。
 *
 * ## 守恒判据（三条，全部机器判；★ 不写绝对数字 —— 同一次运行内前后自比）
 * C1 **条目多重集**：迁移前逐条 `sha256(JSON.stringify(entry))` 的多重集 === 迁移后侧车里的。
 *    ★ 为什么不是"条数相等"：`docs/todo.md` R59/R62 逐字是「**净增掩盖了一条旧的被换掉**」
 *      ⇒ 条数相等拦不住**替换**。hash 多重集 = 逐条同一 = 字节守恒。
 * C2 **判据总数 + kind 分布**：`∑ entry.decision.expectations.length` 与 kind 直方图逐项相等。
 *    （它是 C1 的推论，但**单独打印**：这是"事故记录"的分子，`docs/todo.md` 与人都用这个数。）
 * C3 **读端等价**：每个节点迁移前（内联）/迁移后（侧车）的**条目序列逐条 sha256 相等 + 条数相等**。
 *    它把"数据没丢"升级成"**读端没变**"（读端 = `resolveHistory` 的 union，唯一判据入口）。
 *
 * ## 用法
 *   node scripts/migrate-decision-history.mjs                  # dry-run：只算，不写
 *   node scripts/migrate-decision-history.mjs --apply          # 真迁
 *   node scripts/migrate-decision-history.mjs --book agent-io  # 只迁一册
 *
 * ★ 前置：`npm run build`（本脚本读 `dist/`）。
 * ★ 回滚：册侧用 `node scripts/design_txn.mjs begin/commit/cancel`（字节级）；侧车侧脚本自己截断。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'src');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * ★★ 2026-11-09：`--project <项目根>` —— 对**任意项目**的册做侧车化迁移。
 *
 * 为什么需要：迁移脚本原来只认 `ROOT = 脚本所在仓根`，而真正的册目录由 storage 的
 * `dataHome()` 决定（`AGENT_IO_HOME` → 包根 → cwd）。于是它对别的项目**扫不到册**
 * （实测：对 review-hub 跑，报"合计 0 条"）。现在：
 *   · 给 `--project` ⇒ **先**把 `AGENT_IO_HOME` 指到该项目根，**再**动态 import storage
 *     （`dataHome()` 是调用时读 env ⇒ 顺序必须如此，否则读到旧根）；
 *   · 不给 ⇒ 保持现状（AgentIO 自身）。
 * ★ 只处理**引擎数据**（`.agent-io/design/*.dsl.json` 与 `*.history.jsonl`），不碰项目源码。
 */
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const bookArg = (() => {
  const i = argv.indexOf('--book');
  return i >= 0 ? argv[i + 1] : undefined;
})();
const PROJECT = (() => {
  const i = argv.indexOf('--project');
  if (i < 0 || !argv[i + 1]) return ROOT;
  return path.resolve(argv[i + 1]);
})();
/**
 * ★★ 2026-11-09：`--authoritative <inline|sidecar>` —— **人工裁定后的收敛开关**。
 *
 * 为什么必须有它：两侧分叉时脚本**拒绝自动选边**（这是对的）。但裁定之后总得收敛，
 * 于是把"选边"做成一个**必须显式传入**的参数：
 *   · `sidecar` ⇒ 侧车为准：只删册里的内联（侧车一个字节不动）；
 *   · `inline`  ⇒ 册内联为准：**重写**侧车（先备份），再删内联。
 * 不给 ⇒ 维持旧行为（分叉即拒）。★ 引擎永远不自己给这个参数。
 */
const AUTHORITATIVE = (() => {
  const i = argv.indexOf('--authoritative');
  const v = i >= 0 ? String(argv[i + 1] ?? '') : '';
  if (v && v !== 'inline' && v !== 'sidecar') {
    console.error(`✗ --authoritative 只接受 inline | sidecar（收到 "${v}"）`);
    process.exit(2);
  }
  return v;
})();
/**
 * ★★ 2026-11-09：`--basis "<依据>"` —— 自动裁决时把**依据**（时间差 / 兼容性）写进接管日志。
 * 手动裁决可以不传；自动裁决必须传（否则日志只有"谁赢"，没有"凭什么"）。
 */
const BASIS = (() => {
  const i = argv.indexOf('--basis');
  return i >= 0 ? String(argv[i + 1] ?? '') : '';
})();

/** 接管日志：一行一条（append-only）。**被淘汰侧不删除**，只在这里留名与依据。 */
function appendTakeoverLog(entry) {
  try {
    fs.mkdirSync(DESIGN_DIR, { recursive: true });
    fs.appendFileSync(path.join(DESIGN_DIR, '.takeover-log.jsonl'), JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`  ⚠ 接管日志写不进去（不影响收敛，但**少了一条依据**）：${String(e)}`);
  }
}
if (PROJECT !== ROOT) process.env.AGENT_IO_HOME = PROJECT;

const { getDesignSheetFile } = await import(`file://${path.join(DIST, 'infrastructure/storage.js').replace(/\\/g, '/')}`);
const { saveDSL } = await import(`file://${path.join(DIST, 'infrastructure/storage.js').replace(/\\/g, '/')}`);
const { runDslWriteScope } = await import(`file://${path.join(DIST, 'infrastructure/dsl_write_scope.js').replace(/\\/g, '/')}`);
const hist = await import(`file://${path.join(DIST, 'infrastructure/decision_history.js').replace(/\\/g, '/')}`);

const DESIGN_DIR = path.join(PROJECT, '.agent-io', 'design');

/** 迁移前备份：把册与侧车原样拷到 `<design>/.migrate-bak/<时间戳>/`（可原样还原） */
function backupBook(feature) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(DESIGN_DIR, '.migrate-bak', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const copied = [];
  for (const f of [`${feature}.dsl.json`, `${feature}.history.jsonl`]) {
    const src = path.join(DESIGN_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, f));
      copied.push(f);
    }
  }
  return { dir, copied };
}

/**
 * 读某一册的**当前内容** —— 设计事务进行中时读**工作副本**。
 * ★ 为什么必须这样：`saveDSL` 在事务里会 `txnRedirect` 到 `.txn/work.dsl.json`
 *   （正式册在 commit 前一个字节都不动）⇒ 若这里读正式册，二遍回读永远看到"内联还在"
 *   ⇒ 迁移会**假失败**（实测：agent-io 第一次跑就报了"回读内联剩 669 条"）。
 */
function readBook(feature) {
  const manifest = path.join(DESIGN_DIR, '.txn', 'manifest.json');
  if (fs.existsSync(manifest)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
      if (m.book === feature) {
        const work = path.join(DESIGN_DIR, '.txn', 'work.dsl.json');
        if (fs.existsSync(work)) return { file: work, text: fs.readFileSync(work, 'utf-8'), viaTxn: true };
      }
    } catch {
      /* manifest 坏 ⇒ 回落正式册（下面 `existsSync` 会兜） */
    }
  }
  const file = getDesignSheetFile(feature);
  return { file, text: fs.readFileSync(file, 'utf-8'), viaTxn: false };
}

/** 一册的「迁移前快照」：每个节点的内联条目 + 它们的 hash 多重集 */
function snapshotInline(dsl) {
  const perNode = new Map();
  const hashMultiset = new Map();
  const kindHist = new Map();
  let expTotal = 0;
  for (const n of dsl?.geometry?.nodes ?? []) {
    const arr = Array.isArray(n.decision_history) ? n.decision_history : [];
    if (!arr.length) continue;
    perNode.set(n.id, arr);
    for (const e of arr) {
      const h = sha256(JSON.stringify(e));
      hashMultiset.set(h, (hashMultiset.get(h) ?? 0) + 1);
      for (const x of e?.decision?.expectations ?? []) {
        expTotal++;
        kindHist.set(x.kind, (kindHist.get(x.kind) ?? 0) + 1);
      }
    }
  }
  return { perNode, hashMultiset, kindHist, expTotal };
}

/** 哈希多重集比对：返回「第一个不等的 hash」+ 两侧计数（0.12④：拒绝必须可定位） */
function diffMultiset(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const bad = [];
  for (const k of keys) {
    const ca = a.get(k) ?? 0;
    const cb = b.get(k) ?? 0;
    if (ca !== cb) bad.push({ hash: k, pre: ca, post: cb });
  }
  return bad;
}

function hist2str(m) {
  return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
}

const books = fs
  .readdirSync(DESIGN_DIR)
  .filter((f) => f.endsWith('.dsl.json'))
  .map((f) => f.slice(0, -'.dsl.json'.length))
  .filter((f) => (bookArg ? f === bookArg : true))
  .sort();

if (!books.length) {
  console.error(`✗ 没有可迁的册（--book=${bookArg ?? '（未给）'}；目录 ${DESIGN_DIR}）`);
  process.exit(1);
}

console.log(`迁移 decision_history → <f>.history.jsonl · ${APPLY ? '【APPLY】真写盘' : '【DRY-RUN】不写盘'} · 册数 ${books.length}`);
let grandEntries = 0;
let grandExp = 0;
let failed = false;

for (const feature of books) {
  const official = getDesignSheetFile(feature);
  const sidecar = hist.historyLogFile(feature);
  if (!fs.existsSync(official)) {
    console.log(`  ✗ ${feature}: 册不存在（${official}）`);
    failed = true;
    continue;
  }
  const read1 = readBook(feature);
  const dsl = JSON.parse(read1.text);
  if (read1.viaTxn) console.log(`  · 事务进行中 ⇒ 读写工作副本 ${path.relative(ROOT, read1.file)}`);
  const pre = snapshotInline(dsl);
  const preEntries = [...pre.hashMultiset.values()].reduce((a, b) => a + b, 0);
  grandEntries += preEntries;
  grandExp += pre.expTotal;

  const sizeBefore = fs.existsSync(sidecar) ? fs.statSync(sidecar).size : -1;
  console.log(
    `\n── ${feature} · 节点 ${(dsl.geometry?.nodes ?? []).length} · 有史节点 ${pre.perNode.size} · 条目 ${preEntries} · 判据 ${pre.expTotal}`,
  );

  if (!preEntries) {
    console.log(`  · 没有内联历史 ⇒ 只需保证侧车存在（空文件也算）`);
    if (APPLY) hist.ensureHistoryLog(feature);
    continue;
  }

  if (APPLY) {
    const b = backupBook(feature);
    console.log(`  · 备份：${path.relative(PROJECT, b.dir)}（${b.copied.join(', ') || '无文件'}）→ 还原就把它拷回 ${path.relative(PROJECT, DESIGN_DIR)}`);
  }

  // ── 人工裁定后的收敛分支（只在 --authoritative 显式给出时走） ──
  if (AUTHORITATIVE) {
    const nodesWithInline = (dsl.geometry?.nodes ?? []).filter((n) => Array.isArray(n.decision_history) && n.decision_history.length);
    console.log(`  · 裁定：**${AUTHORITATIVE}** 为准 · 涉及节点 ${nodesWithInline.length} 个`);
    if (!APPLY) {
      console.log('  · dry-run：不写盘。真收敛加 --apply');
      continue;
    }
    if (AUTHORITATIVE === 'inline') {
      // 侧车按内联**重写**（覆盖），再删内联
      const linesToWrite = [];
      for (const n of nodesWithInline) {
        for (const e of n.decision_history) linesToWrite.push(JSON.stringify({ node_id: n.id, entry: e }));
      }
      fs.writeFileSync(sidecar, linesToWrite.length ? linesToWrite.join('\n') + '\n' : '');
      console.log(`  · 侧车已按内联重写：${linesToWrite.length} 行`);
    } else {
      console.log('  · 侧车为准：侧车不动，只删册内联');
    }
    let removedAuth = 0;
    for (const n of dsl.geometry?.nodes ?? []) {
      if (Array.isArray(n.decision_history) && n.decision_history.length) {
        removedAuth++;
        delete n.decision_history;
      }
    }
    runDslWriteScope({ via: 'derived', who: 'migrate_decision_history', feature }, () => {
      saveDSL(dsl, 'mcp');
    });
    const afterAuth = JSON.parse(readBook(feature).text);
    const leftAuth = (afterAuth.geometry?.nodes ?? []).reduce((a, n) => a + (Array.isArray(n.decision_history) ? n.decision_history.length : 0), 0);
    const idxAuth = hist.readHistoryLog(feature);
    const scAuth = [...idxAuth.byNode.values()].reduce((a, v) => a + v.length, 0);
    console.log(`  · 收敛结果：清了 ${removedAuth} 个节点的内联 · 剩内联 ${leftAuth}（须 0）· 侧车 ${scAuth} 条 · 坏行 ${idxAuth.bad_lines}（须 0）`);
    appendTakeoverLog({
      at: new Date().toISOString(),
      book: feature,
      authoritative: AUTHORITATIVE,
      absorbed: AUTHORITATIVE === 'inline' ? 'sidecar' : 'inline',
      absorbed_policy: '不删除，仅记录（被较新侧吸收）',
      nodes_touched: removedAuth,
      inline_left: leftAuth,
      sidecar_entries: scAuth,
      basis: BASIS || '（手动裁决：未给依据）',
    });
    console.log(`  · 接管日志：.agent-io/design/.takeover-log.jsonl（依据：${BASIS || '（未给）'}）`);
    if (leftAuth !== 0 || idxAuth.bad_lines !== 0) {
      console.error('  ✗ 收敛后仍不一致 ⇒ 停（备份在，可还原）');
      failed = true;
    }
    grandEntries += preEntries;
    grandExp += pre.expTotal;
    continue;
  }

  // ── 一遍：append（幂等：按 (node,index) 续写，已有同 hash 前缀则跳过） ──
  let appended = 0;
  for (const [nodeId, arr] of pre.perNode) {
    const idx = hist.readHistoryLog(feature);
    const existing = idx.byNode.get(nodeId) ?? [];
    // 已有条目的 hash 必须与内联的**同下标前缀**逐条相同；否则拒绝（源被别处改过，绝不猜）
    for (let i = 0; i < existing.length; i++) {
      if (sha256(JSON.stringify(existing[i])) !== sha256(JSON.stringify(arr[i]))) {
        console.error(
          `  ✗ ${feature}/${nodeId}: 侧车第 ${i} 条与册里内联的同下标条目**不同** ⇒ 拒绝迁移（不猜谁对）。` +
            `侧车=${sidecar}`,
        );
        failed = true;
        break;
      }
    }
    if (failed) break;
    const rest = arr.slice(existing.length);
    if (rest.length && APPLY) {
      hist.appendHistoryEntries(feature, nodeId, existing.length, rest);
      appended += rest.length;
    } else if (rest.length) {
      appended += rest.length; // dry-run：只报会写几条
    }
  }
  if (failed) continue;
  console.log(`  · 一遍：${APPLY ? '已追加' : '将追加'} ${appended} 条到 ${path.relative(ROOT, sidecar)}`);

  // ── C1/C2/C3（按**盘上真实内容**判；dry-run 时按"内联本身"判，等价于恒成立，故只印提示） ──
  if (!APPLY) {
    console.log(`  · C1/C2/C3 只有 --apply 才判（dry-run 没有"迁移后"这一侧）`);
    continue;
  }

  const postIndex = hist.readHistoryLog(feature);
  const postMultiset = new Map();
  const postKindHist = new Map();
  let postExp = 0;
  for (const [nodeId, arr] of postIndex.byNode) {
    // 只统计"本次涉及的节点"，避免把别的节点的旧条目算进来
    if (!pre.perNode.has(nodeId)) continue;
    for (const e of arr) {
      const h = sha256(JSON.stringify(e));
      postMultiset.set(h, (postMultiset.get(h) ?? 0) + 1);
      for (const x of e?.decision?.expectations ?? []) {
        postExp++;
        postKindHist.set(x.kind, (postKindHist.get(x.kind) ?? 0) + 1);
      }
    }
  }
  const c1 = diffMultiset(pre.hashMultiset, postMultiset);
  const c2exp = pre.expTotal === postExp;
  const c2kind = JSON.stringify(hist2str(pre.kindHist)) === JSON.stringify(hist2str(postKindHist));
  // C3：逐节点条目序列 sha256 相等
  const c3bad = [];
  for (const [nodeId, arr] of pre.perNode) {
    const after = postIndex.byNode.get(nodeId) ?? [];
    if (after.length !== arr.length) {
      c3bad.push(`节点 ${nodeId}: 迁移前 ${arr.length} 条 / 迁移后 ${after.length} 条`);
      continue;
    }
    for (let i = 0; i < arr.length; i++) {
      if (sha256(JSON.stringify(arr[i])) !== sha256(JSON.stringify(after[i]))) {
        c3bad.push(`节点 ${nodeId} 第 ${i} 条：hash 不等（迁移前后不是同一条）`);
        break;
      }
    }
  }
  console.log(
    `  · C1 条目多重集 ${c1.length === 0 ? '✓ 相等' : `✗ ${c1.length} 个 hash 不等`}（前 ${preEntries} / 后 ${[...postMultiset.values()].reduce((a, b) => a + b, 0)}）`,
  );
  console.log(`  · C2 判据总数 ${c2exp ? '✓' : '✗'}（前 ${pre.expTotal} / 后 ${postExp}）· kind 分布 ${c2kind ? '✓ 逐项相等' : '✗'}`);
  console.log(`  · C3 读端等价 ${c3bad.length === 0 ? '✓' : `✗ ${c3bad.length} 个节点不等`}`);
  if (c1.length || !c2exp || !c2kind || c3bad.length) {
    console.error(`  ✗ 守恒判据不过 ⇒ **回滚侧车**（截回 ${sizeBefore < 0 ? '删除（原本不存在）' : sizeBefore + ' 字节'}），册未动`);
    for (const x of c1.slice(0, 5)) console.error(`      第一个不等的 hash ${x.hash} · 前 ${x.pre} / 后 ${x.post}`);
    for (const x of c3bad.slice(0, 5)) console.error(`      ${x}`);
    if (sizeBefore < 0) fs.rmSync(sidecar, { force: true });
    else fs.truncateSync(sidecar, sizeBefore);
    failed = true;
    continue;
  }

  // ── 二遍：册里删字段（**不可逆方向，放最后**） ──
  let removed = 0;
  for (const n of dsl.geometry?.nodes ?? []) {
    if (Array.isArray(n.decision_history) && n.decision_history.length) {
      removed++;
      delete n.decision_history;
    }
  }
  runDslWriteScope({ via: 'derived', who: 'migrate_decision_history', feature }, () => {
    saveDSL(dsl, 'mcp');
  });
  // 回读：册里必须一条不剩，侧车仍在（★ 事务中读**工作副本**，见 `readBook`）
  const after = JSON.parse(readBook(feature).text);
  const leftover = (after.geometry?.nodes ?? []).reduce(
    (a, n) => a + (Array.isArray(n.decision_history) ? n.decision_history.length : 0),
    0,
  );
  const reread = hist.readHistoryLog(feature);
  const rereadCount = [...pre.perNode.keys()].reduce((a, k) => a + (reread.byNode.get(k)?.length ?? 0), 0);
  console.log(
    `  · 二遍：册里清了 ${removed} 个节点的内联字段 · 回读内联剩 ${leftover} 条（须 0）· 侧车 ${rereadCount} 条（须 ${preEntries}）· 坏行 ${reread.bad_lines}（须 0）`,
  );
  if (leftover !== 0 || rereadCount !== preEntries || reread.bad_lines !== 0) {
    console.error('  ✗ 二遍回读不符 ⇒ 立刻停下（侧车里还有完整数据，册内联也还在 ⇒ 是"两处都在"，可发现、可续跑）');
    failed = true;
  }
}

let leftoverTotal = 0;
for (const feature of books) {
  try {
    const t = JSON.parse(readBook(feature).text);
    leftoverTotal += (t.geometry?.nodes ?? []).reduce((a, n) => a + (Array.isArray(n.decision_history) ? n.decision_history.length : 0), 0);
  } catch {
    leftoverTotal += 0;
  }
}
console.log('\n迁移汇总：迁了 ' + grandEntries + ' 条 · 判据 ' + grandExp + ' 条 · 剩内联 ' + leftoverTotal + ' 条 · 失败 ' + (failed ? books.length : 0) + ' 册');
console.log(`\n合计：条目 ${grandEntries} · 判据 ${grandExp}`);
if (failed) {
  console.error('✗ 有失败项（见上）。侧车已按需截断；册的字节级回滚用 scripts/design_txn.mjs cancel。');
  process.exit(1);
}
if (!APPLY) console.log('★ 这是 dry-run：一个字节都没写。真迁加 --apply。');
else console.log('✓ 迁移完成。下一步：node scripts/gen-db-check.mjs（门会断言"册里内联必须为 0"）');
