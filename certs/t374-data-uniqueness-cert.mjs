#!/usr/bin/env node
/**
 * ★★★ cert T374 —— **同项目、同数据只留一份**（watch 兼任的守卫）
 * （2026-10-27 · 用户口径：「watch 虽然是增量的，但也要保证同项目同数据独一性」）
 *
 * ## 本笔新增的方向
 *   · `infrastructure/data_uniqueness.ts#ensureProjectDataUniqueness` —— 判据 + 处理；
 *   · `watch_project_tool` 的 `doWork` 顶部**节流**调用它（首次必跑，之后每 10 分钟一次）。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① 干净项目 ⇒ **0 条**发现；
 *   ② 数据仓里有同名的**派生**角色（`live/`）且与 canonical **逐字节相同** ⇒ dry-run 报"可删"、apply 真删；
 *   ③ 数据仓那份**不一致** ⇒ **不删**、只报（可能是旧代数据，要人看一眼）；
 *   ④ 数据仓那份是**意图数据**（`design/`）⇒ `skipped_intent`，**永不自动删**；
 *   ⑤ 项目内 stray `.agent-io`：内容全是派生 ⇒ apply 删；含 `design/` ⇒ 只报。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **watch 里的接线**只核到"函数被调用、失败只记 error"（本证直接调函数，不起真实 watcher）；
 *   · **[未核] 指针对齐**：canonical 与副本的比对是"文件集合 + 每个文件 sha256"，不比 mtime；
 *   · **[未核] 大目录**：canonical 是 200MB 级时每次全量哈希的开销没量过（节流 10 分钟）。
 *
 * ## 用法
 *   node certs/t374-data-uniqueness-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/infrastructure/data_uniqueness.ts, src/application/observe/runtime/watch_project_tool.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp374uniq-'));
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });
process.env.AGENT_IO_HOME = HOME; // 数据仓 = <home>/.agent-io

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { ensureProjectDataUniqueness, renderUniquenessLine } = await import(
  '../dist/src/infrastructure/data_uniqueness.js'
);

const w = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf-8');
};
const DATA = path.join(HOME, '.agent-io'); // 数据仓（本证里 AGENT_IO_HOME 的 .agent-io）
const CANON = path.join(PROJ, '.agent-io');

// 造 canonical：design（意图）+ live（派生）
w(path.join(CANON, 'design', 'p.dsl.json'), '{"feature":"p","nodes":[]}');
w(path.join(CANON, 'live', 'p.dsl.json'), '{"feature":"p","live":1}');

// ── ① 干净项目 ⇒ 0 条发现 ────────────────────────────────
{
  const rep = ensureProjectDataUniqueness(PROJ, { apply: false });
  chk(rep.findings.length === 0, '① 干净项目 ⇒ **0 条**发现', renderUniquenessLine(rep));
}

// ── ② 数据仓里有逐字节相同的 live/ ⇒ dry-run 报、apply 删 ──
w(path.join(DATA, 'live', 'p.dsl.json'), '{"feature":"p","live":1}'); // 与 canonical 相同
{
  const dry = ensureProjectDataUniqueness(PROJ, { apply: false });
  const hit = dry.findings.find((f) => f.path.endsWith(path.join('live', 'p.dsl.json')) || f.path.endsWith('live'));
  chk(
    dry.findings.length >= 1 && dry.deleted === 0 && !!hit && hit.identical === true && hit.action === 'reported',
    '②-a dry-run：逐字节相同的那份**只报不删**',
    hit ? `${hit.path} · identical=${hit.identical} · action=${hit.action}` : JSON.stringify(dry.findings),
  );
  const app = ensureProjectDataUniqueness(PROJ, { apply: true });
  chk(
    app.deleted >= 1 && !fs.existsSync(path.join(DATA, 'live')),
    '②-b apply：逐字节相同的派生副本**真删**',
    `deleted=${app.deleted} 数据仓 live 还在=${fs.existsSync(path.join(DATA, 'live'))}`,
  );
}

// ── ③ 数据仓那份**不一致** ⇒ 不删、只报 ────────────────────
w(path.join(DATA, 'live', 'p.dsl.json'), '{"feature":"p","live":999}'); // 与 canonical 不同
{
  const app = ensureProjectDataUniqueness(PROJ, { apply: true });
  const hit = app.findings.find((f) => f.path.includes('live'));
  chk(
    !!hit && hit.action === 'reported' && hit.identical === false && fs.existsSync(path.join(DATA, 'live')),
    '③ 内容**不一致** ⇒ 不删、只报（可能是旧代数据）',
    hit ? `identical=${hit.identical} action=${hit.action}` : '没发现这一条',
  );
}

// ── ④ 意图数据（design）副本 ⇒ skipped_intent，永不删 ───────
w(path.join(DATA, 'design', 'p.dsl.json'), '{"feature":"p","nodes":[]}'); // 与 canonical 相同
{
  const app = ensureProjectDataUniqueness(PROJ, { apply: true });
  const hit = app.findings.find((f) => f.path.includes(path.join('design')));
  chk(
    !!hit && hit.action === 'skipped_intent' && fs.existsSync(path.join(DATA, 'design')),
    '④ 意图数据（design）⇒ `skipped_intent`，**永不自动删**（哪怕逐字节相同）',
    hit ? `action=${hit.action} 数据仓 design 还在=${fs.existsSync(path.join(DATA, 'design'))}` : '没发现',
  );
}

// ── ⑤ 项目内 stray `.agent-io` ────────────────────────────
w(path.join(PROJ, 'src', 'application', '.agent-io', 'cache.db'), 'fake-index'); // 全是派生
w(path.join(PROJ, 'lib', '.agent-io', 'design', 'q.dsl.json'), '{"feature":"q"}'); // 里面有意图数据
{
  const app = ensureProjectDataUniqueness(PROJ, { apply: true });
  const strayDeriv = app.findings.find((f) => f.kind === 'stray_data_dir' && f.path.includes('src/application'));
  const strayIntent = app.findings.find((f) => f.kind === 'stray_data_dir' && f.path.includes('lib'));
  chk(
    !!strayDeriv && strayDeriv.action === 'deleted' && !fs.existsSync(path.join(PROJ, 'src', 'application', '.agent-io')),
    '⑤-a 项目内 stray `.agent-io`（内容全是派生）⇒ apply 删',
    strayDeriv ? `action=${strayDeriv.action}` : '没发现',
  );
  chk(
    !!strayIntent && strayIntent.action === 'skipped_intent' && fs.existsSync(path.join(PROJ, 'lib', '.agent-io')),
    '⑤-b stray 里含 `design/` ⇒ 只报、不删',
    strayIntent ? `action=${strayIntent.action}` : '没发现',
  );
}

console.log(`\n═══ T374 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
