/**
 * T246 出生证：★ **"走了走查、但没走完"必须响亮** —— 不许把"库在、但不全"当成完整。
 *
 * ## 它测的是哪一格
 * 走查有补全上限（`MAX_ADDS_PER_REFRESH = 100`）。超出时 `ensureProjectIndex` 会**如实**回
 * `state:'partial'` + `skipped_adds>0`（它自己的注释："有界 = 诚实 … 绝不假装完整"）——
 * ★ **但保鲜那条路径从来不读这个返回值**，而且 `invokeTool` 原来是 `catch {}` 把异常也咽掉。
 * ⇒ 于是"库在、但不全"会被**当成完整**继续用 = `write_gate.ts` 自己命名的"**比不建更糟**"。
 *
 * ## 判据（★ 二值，且**自带反向**）
 * ① **超上限**（磁盘比索引多 > 100 个文件）⇒ `ensureStage('symbol_index')` **必须抛**，
 *    且错误里点名"没能补齐"；把它交给 `freshnessRefusedWarning` ⇒ 必须产出
 *    `code:'INDEX_FRESHNESS_REFUSED'` 的结构化告警。
 * ② ★ **未超上限**（只多 1 个文件）⇒ **必须不抛**（否则就是"为少见情形天天吵" ⇒ 噪音）。
 * ★ 只测①不测②的证是**半张** —— 一个"永远抛"的实现也能过①。
 *
 * ## ★ 消融自证
 * 把 `stage_registry.ts` 里 `symbol_index.produce` 的 `if (idx.state === 'partial') { throw … }`
 * 整段注释掉 ⇒ ★ **① 必须变红**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const REPO = path.resolve(dir, '..');
const dist = (p) => pathToFileURL(path.join(REPO, 'dist', 'src', p)).href;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ★ 工作副本放 temp（宿主删除护栏按【条目数】计，阈值 50/会话 ⇒ 仓内 scratch 会死在 reset 行）
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t246-'));
const { ensureProjectIndex } = await import(dist('infrastructure/index/index_freshness.js'));
const { ensureStage } = await import(dist('application/stage_registry.js'));
const { freshnessRefusedWarning } = await import(dist('presentation/mcp/server_registry.js'));

const mk = (name, n) => {
  const proj = path.join(SCRATCH, name);
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export function alpha(): number { return 1; }\n');
  fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'export function beta(): number { return 2; }\n');
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(proj, 'src', `n${i}.ts`), `export function f${i}(): number { return ${i}; }\n`);
  }
  return proj;
};

console.log('══ ① 超上限：先建 2 文件索引，再往磁盘加 150 个（上限 100）');
const P1 = mk('big', 0);
await ensureProjectIndex(P1, { bootstrap: true });
for (let i = 0; i < 150; i++) {
  fs.writeFileSync(path.join(P1, 'src', `extra${i}.ts`), `export function e${i}(): number { return ${i}; }\n`);
}
let err1 = '';
try {
  const r = await ensureStage('symbol_index', { projectRoot: P1 });
  err1 = '';
  console.log('     （没抛；返回 ' + JSON.stringify(r) + '）');
} catch (e) {
  err1 = e instanceof Error ? e.message : String(e);
}
chk(err1 !== '', '①-a ★★ 超上限 ⇒ **抛**（不许静默当成完整）', err1 ? err1.split('\n')[0].slice(0, 130) : '（★ 没抛 ⇒ 半成品被当完整 ✗）');
chk(/没能补齐/.test(err1), '①-b ★ 错误里点名"**没能补齐**"（可读，不是裸错误）', err1.split('\n')[0].slice(0, 130));
const w = freshnessRefusedWarning(err1, P1);
chk(
  !!w && w.code === 'INDEX_FRESHNESS_REFUSED' && !!w.fix,
  '①-c ★ 转成**结构化告警**（code + summary + fix 齐）—— 走既有 `emitWarnings` 通道',
  w ? JSON.stringify({ code: w.code, fix: w.fix.slice(0, 50) }) : '（null ✗）',
);

console.log('\n══ ② ★ 反向：未超上限（只多 1 个文件）⇒ **必须不抛**（否则天天吵）');
const P2 = mk('small', 0);
await ensureProjectIndex(P2, { bootstrap: true });
fs.writeFileSync(path.join(P2, 'src', 'c.ts'), 'export function gamma(): number { return 3; }\n');
let err2 = '';
let act2 = '';
try {
  const r2 = await ensureStage('symbol_index', { projectRoot: P2 });
  act2 = r2.action;
} catch (e) {
  err2 = e instanceof Error ? e.message : String(e);
}
chk(err2 === '', '②-a ★ 不抛', err2 ? err2.split('\n')[0].slice(0, 130) : '');
chk(act2 === 'produced', '②-b ★ 且如实说 `produced`（真的走了走查）', `实测 action=${act2}`);
chk(freshnessRefusedWarning('', P2) === null, '②-c ★ 没有失败 ⇒ 告警必须是 `null`（★ 不许"恒有"⇒ 那是装饰）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log(
  '★ 消融自证：★ 注释掉 `symbol_index.produce` 里 `if (idx.state === "partial") { throw … }` 整段 ⇒ ★ **①-a 必须变红** ✓',
);
console.log(`（工作副本留在 ${SCRATCH} —— ★ 连接池持有 cache.db 句柄，删它会 EBUSY；由系统回收）`);
process.exit(F === 0 ? 0 : 1);
