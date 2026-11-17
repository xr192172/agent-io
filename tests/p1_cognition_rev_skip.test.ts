/**
 * P1 · **COGNITION 按 `dsl_rev` 复用**（增量化第一批 · 项 3 的检测点）
 *
 * ## 它挡的事故
 * `npm run cognition` 对**每个 feature** spawn 一次 CLI（`get_dsl query=digest`）。一条册被改，
 * 其余几十条的正文逐字不变，却每次都要重新起进程 + 开 SQLite。加复用的风险是**把"省"变成"不查"**：
 * 一旦复用的判据比"正文真的没变"更宽，快照就会**静默停在旧内容**上（而文件看起来完好无损 —— 0.12 的最坏形态）。
 *
 * ## 判据
 * · R1 **注入面**：`computeSections(root, { prior })` —— rev 相等且 prior 段无 error ⇒ 复用（`hash`/`lines` 原样取回）；
 *   rev 不等 ⇒ 现算；**ERROR 段永不复用**
 * · R2 **读写对称**：`parseSnapshot(renderCognition(sections))` 必须还原出同一批 `{rev, hash, lines, error}`
 *   （解析器与渲染器是**同一份格式**的两个方向；不对称 = 复用会读到错的段）
 * · R3 **端到端**：盘上快照 rev 相同 ⇒ `npm run cognition` 那一路**真的沿用**旧段（夹具里没有 dist ⇒
 *   一旦现算就必然得到 ⚠ 段 ⇒ "有没有复用"从产物上可判，不需要看内部）
 * · R4 **rev 变了 ⇒ 现算且新内容落盘**（不许沿用旧正文）
 * · R5 **prior 段带 error ⇒ 不复用**（"上次没取到"不许被固化成"这次也不取"）
 * · R6 **保守闸门**：`cache.db` 比快照新 ⇒ 一律现算（digest 的 `R:` 段来自 `cache.db` ⇒ rev 相等不足以证明正文没变）
 * · R7 **cascade 恒现算**（`runCascade` 调 `computeSections(root)` 单参 ⇒ 不吃 prior）
 * · R8 **`--check` 恒现算**（`checkCognition` 判过期时拿的是真读数，不吃 prior ⇒ "跳过"的代价由它兜住）
 *
 * ## 消融口径（改坏实现时哪条红）
 * · 复用判据放宽成"有 prior 就复用"（不看 rev） ⇒ R4 红
 * · 把 ERROR 段也复用 ⇒ R5 红（旧 error 文本会留在文件里）
 * · 主分支把 prior 传给 cascade / `--check` ⇒ R7 / R8 红
 * · 去掉 cache.db 新鲜度闸门 ⇒ R6 红
 * · `parseSnapshot` 与 `renderCognition` 不同步（比如忘了空段/⚠ 段） ⇒ R2 红
 *
 * ## 夹具口径（★ 抄 `p1_cascade_root.test.ts` 的手法）
 * · 夹具是 `mkdtemp` 的临时项目；落盘按项目根开 cache.db（进程级缓存）⇒ 删前先 `closeAllProjectCacheDbs()`
 *   （Windows 句柄没关 ⇒ rmSync EBUSY）。
 * · 要**真跑**生成器 ⇒ 把 `scripts/gen_cognition.mjs` **连同它的 import 闭包**（整目录 `scripts/lib/`）
 *   整份拷进夹具（点名清单漏过依赖时，红在 ERR_MODULE_NOT_FOUND 而不是判据上）。
 * · 夹具里**没有 dist** ⇒ 生成器调 CLI 必然失败 ⇒ 现算的段一律是 ⚠ 段。这正是本文件的**鉴别力**：
 *   "复用"与"现算"在产物上是**两种不同形状**（旧正文 vs ⚠ 段），不靠内部计数器自证。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ★ 夹具项目里没有画布（tasks.db#plans）—— 本文件验的是"复用"，不是画布闸。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { runCascade } = await import('../src/application/design/cascade.js');
const { closeAllProjectCacheDbs } = await import('../src/infrastructure/index/db.js');

type Section = { feature: string; rev: number; hash: string; lines: string[]; error: string | null };
type CogModule = {
  computeSections: (projectDir: string, opts?: { prior?: Map<string, { rev: number; hash: string; lines: string[]; error: string | null }>; tally?: { reused?: number; computed?: number } }) => Section[];
  renderCognition: (sections: Section[]) => string;
  parseSnapshot: (text: string) => Map<string, { rev: number; hash: string; lines: string[]; error: string | null }>;
  checkCognition: (projectDir: string) => { ok: boolean; why: string; stale: string[]; missing: string[]; extra: string[]; failed?: string[] };
};

let cacheBust = 0;
/** 带 cache-buster 动态 import 一份 .mjs（同进程里多次 import 互不串味） */
async function importGenerator(absFile: string): Promise<CogModule> {
  const url = `${pathToFileURL(absFile).href}?case=${++cacheBust}`;
  return (await import(url)) as CogModule;
}

/** 仓库里那份**实现**（审计对象：不是拷进夹具的那份副本） */
const COG = await importGenerator(path.join(REPO, 'scripts', 'gen_cognition.mjs'));

function cleanup(proj: string): void {
  closeAllProjectCacheDbs();
  fs.rmSync(proj, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 });
}

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p1-cognition-rev-'));
}

/** 造夹具册：`.agent-io/design/<feature>.dsl.json`（生成器从它枚举 feature + 读 rev） */
function mkSheet(proj: string, feature: string, rev: number): void {
  const abs = path.join(proj, '.agent-io', 'design', `${feature}.dsl.json`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ rev, meta: { feature } }, null, 2), 'utf8');
}

/** 预置一份"已声明"的快照（模拟上一次生成的产物） */
function writeSnapshot(proj: string, blocks: string[]): void {
  const abs = path.join(proj, '.agent-io', 'COGNITION.txt');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, ['#AgentIO-COGNITION: 1', '#Format: agent-io/cognition-fras-v1', ...blocks, ''].join('\n'), 'utf8');
}

const readSnapshot = (proj: string): string => fs.readFileSync(path.join(proj, '.agent-io', 'COGNITION.txt'), 'utf8');

/** 把生成器 + 它的 import 闭包（整目录 `scripts/lib/`）拷进夹具 */
function copyGenerator(proj: string): void {
  const dst = path.join(proj, 'scripts');
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts', 'gen_cognition.mjs'), path.join(dst, 'gen_cognition.mjs'));
  fs.cpSync(path.join(REPO, 'scripts', 'lib'), path.join(dst, 'lib'), { recursive: true });
}

/** 真跑夹具里的生成器（= `npm run cognition` 那一路的等价物） */
function runCli(proj: string, extra: string[] = []): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [path.join(proj, 'scripts', 'gen_cognition.mjs'), '--project', proj, ...extra], {
    cwd: proj,
    encoding: 'utf8',
    shell: false,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const FAKE_BODY = 'src/a.ts: F:注入的复用正文';
const FAKE_SHA = 'deadbeefdeadbeef';

test('R1 注入面：rev 相等且无 error ⇒ 复用；rev 不等 / prior 带 error ⇒ 现算', () => {
  const proj = mkProject();
  try {
    mkSheet(proj, 'A', 7);
    const prior = new Map([['A', { rev: 7, hash: FAKE_SHA, lines: [FAKE_BODY], error: null }]]);

    const reused = COG.computeSections(proj, { prior });
    assert.equal(reused.length, 1);
    assert.equal(reused[0].hash, FAKE_SHA, 'rev 相等 + 无 error ⇒ 必须**原样复用** prior 的 hash（不重算）');
    assert.deepEqual(reused[0].lines, [FAKE_BODY], '复用段必须原样取回 prior 的正文行');
    assert.equal(reused[0].error, null, '复用段的 error 必须是 null');
    assert.equal(reused[0].rev, 7, '复用段仍要带上当前册的 rev');

    // ★ rev 不等 ⇒ 现算（夹具没有 dist ⇒ 现算必然是 error 段 ⇒ 一眼可辨）
    const stale = COG.computeSections(proj, { prior: new Map([['A', { rev: 6, hash: FAKE_SHA, lines: [FAKE_BODY], error: null }]]) });
    assert.notEqual(stale[0].hash, FAKE_SHA, 'rev 变了就必须现算（不许沿用旧正文）');
    assert.ok(stale[0].error, `rev 变了且 CLI 跑不起来 ⇒ 必须是响亮的 error 段：${JSON.stringify(stale[0])}`);

    // ★ prior 段带 error ⇒ 永不复用（"上次没取到"不许固化成"这次也不取"）
    const fromErr = COG.computeSections(proj, { prior: new Map([['A', { rev: 7, hash: 'x', lines: [], error: 'OLD-ERROR' }]]) });
    assert.notEqual(fromErr[0].hash, 'x', 'prior 段带 error ⇒ 不复用（hash 必须是本次现算的）');
    assert.ok(fromErr[0].error, 'prior 带 error 时现算的结果也应当是 error 段（夹具没有 dist）');

    // 没有 prior（cascade / --check / --stdout 的口径）⇒ 恒现算
    const fresh = COG.computeSections(proj);
    assert.notEqual(fresh[0].hash, FAKE_SHA, '不传 prior ⇒ 恒现算（cascade/--check 走的就是这一档）');
    assert.equal(fresh[0].hash, stale[0].hash, '同一份册的现算结果必须逐字可重复');
  } finally {
    cleanup(proj);
  }
});

test('R2 读写对称：parseSnapshot(renderCognition(sections)) 还原同一批段（含空段与 ⚠ 段）', () => {
  const sections: Section[] = [
    { feature: 'A', rev: 7, hash: 'aaaaaaaaaaaaaaaa', lines: ['src/a.ts: F:甲', 'src/b.ts[api]: F:乙'], error: null },
    { feature: 'B', rev: 3, hash: 'bbbbbbbbbbbbbbbb', lines: [], error: null }, // 空段
    { feature: 'C', rev: 9, hash: 'cccccccccccccccc', lines: [], error: 'boom：取不到 digest' }, // ⚠ 段
  ];
  const back = COG.parseSnapshot(COG.renderCognition(sections));
  assert.deepEqual([...back.keys()].sort(), ['A', 'B', 'C'], `段名必须还原：${[...back.keys()].join(',')}`);
  assert.deepEqual(back.get('A'), { rev: 7, hash: 'aaaaaaaaaaaaaaaa', lines: ['src/a.ts: F:甲', 'src/b.ts[api]: F:乙'], error: null });
  assert.deepEqual(back.get('B'), { rev: 3, hash: 'bbbbbbbbbbbbbbbb', lines: [], error: null }, '空段必须还原成 lines=[]（否则复用时会把占位句当正文）');
  const c = back.get('C')!;
  assert.ok(c.error, '⚠ 段必须被识别成 error（**永不复用**）');
  assert.match(c.error, /boom/, `error 文本要能取回：${c.error}`);
  assert.deepEqual(c.lines, [], '⚠ 段不许把错误行当正文');
});

test('R3/R4 端到端：快照 rev 相同 ⇒ 沿用旧段；册 rev 变了 ⇒ 现算并落盘新内容', () => {
  const proj = mkProject();
  try {
    mkSheet(proj, 'A', 7);
    copyGenerator(proj);
    writeSnapshot(proj, [`===feature A=== dsl_rev=7 sha256=${FAKE_SHA}`, FAKE_BODY]);

    const r1 = runCli(proj);
    assert.equal(r1.status, 0, `生成器应当成功：\n${r1.out}`);
    assert.match(r1.out, /复用 1 段/, `rev 未变 ⇒ 该复用的那一段不许再起 CLI：\n${r1.out}`);
    const t1 = readSnapshot(proj);
    assert.match(t1, new RegExp(`===feature A=== dsl_rev=7 sha256=${FAKE_SHA}`), `复用段的 sha 必须原样留在文件里：\n${t1}`);
    assert.match(t1, /注入的复用正文/, `复用段的正文必须原样留在文件里：\n${t1}`);
    assert.doesNotMatch(t1, /⚠ 生成失败/, `一旦复用，就不该出现 ⚠ 段（出现了说明它现算了）：\n${t1}`);

    // ★ 册 rev 变了 ⇒ 必须现算（夹具没有 dist ⇒ 新内容是 ⚠ 段）
    mkSheet(proj, 'A', 8);
    const r2 = runCli(proj);
    assert.equal(r2.status, 0, `生成器应当成功：\n${r2.out}`);
    assert.match(r2.out, /复用 0 段/, `rev 变了 ⇒ 一段都不许复用：\n${r2.out}`);
    assert.match(r2.out, /现算 1 段/, `rev 变了 ⇒ 该段必须现算：\n${r2.out}`);
    const t2 = readSnapshot(proj);
    assert.doesNotMatch(t2, new RegExp(FAKE_SHA), `旧 sha 不许留在文件里：\n${t2}`);
    assert.doesNotMatch(t2, /注入的复用正文/, `旧正文不许留在文件里（这才是"新内容落盘"）：\n${t2}`);
    assert.match(t2, /===feature A=== dsl_rev=8 /, `段头必须换成新 rev：\n${t2}`);
    assert.match(t2, /⚠ 生成失败（不静默）/, `夹具没有 dist ⇒ 现算必然是响亮的 ⚠ 段：\n${t2}`);
  } finally {
    cleanup(proj);
  }
});

test('R5 prior 段带 error ⇒ 不复用（旧 error 文本不许被留在文件里）', () => {
  const proj = mkProject();
  try {
    mkSheet(proj, 'A', 7);
    copyGenerator(proj);
    writeSnapshot(proj, [
      '===feature A=== dsl_rev=7 sha256=eeeeeeeeeeeeeeee',
      '  ⚠ 生成失败（不静默）：OLD-ERROR-TEXT-should-not-survive',
    ]);
    const r = runCli(proj);
    assert.match(r.out, /复用 0 段/, `带 ⚠ 的 prior 段**永不复用**：\n${r.out}`);
    const t = readSnapshot(proj);
    assert.doesNotMatch(t, /OLD-ERROR-TEXT-should-not-survive/, `旧的失败原因不许被固化下来（这就成"上次没取到"变"这次也不取"）：\n${t}`);
    assert.match(t, /⚠ 生成失败（不静默）/, '本次现算的 ⚠ 段仍要写在文件里（响亮，不静默）');
  } finally {
    cleanup(proj);
  }
});

test('R6 保守闸门：cache.db 比快照新 ⇒ 一律现算（rev 相等也不复用）', () => {
  const proj = mkProject();
  try {
    mkSheet(proj, 'A', 7);
    copyGenerator(proj);
    writeSnapshot(proj, [`===feature A=== dsl_rev=7 sha256=${FAKE_SHA}`, FAKE_BODY]);
    // ① 先确认"没有 cache.db 时"是复用的
    const r1 = runCli(proj);
    assert.match(r1.out, /复用 1 段/, `前提：这一档应当复用：\n${r1.out}`);
    // ② 造一个 **比快照新** 的 cache.db（索引重建过 ⇒ digest 的 R: 段可能变 ⇒ 保守起见全量现算）
    const db = path.join(proj, '.agent-io', 'cache.db');
    fs.writeFileSync(db, '', 'utf8');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(db, future, future);
    const r2 = runCli(proj);
    assert.match(r2.out, /复用 0 段/, `cache.db 比快照新 ⇒ 不许复用（rev 相等也不够）：\n${r2.out}`);
    assert.match(r2.out, /cache\.db 比 COGNITION\.txt 新/, `要如实说出为什么全量现算：\n${r2.out}`);
    // ③ --force 也必须全量（显式放弃复用）
    const r3 = runCli(proj, ['--force']);
    assert.match(r3.out, /复用 0 段/, `--force ⇒ 全量现算：\n${r3.out}`);
    assert.match(r3.out, /--force/, `--force 也要在读数里出声（不许静默地"就是慢一点"）：\n${r3.out}`);
  } finally {
    cleanup(proj);
  }
});

test('R7 cascade 恒现算（不吃 prior：刚改完册的那一刻最不该复用）', async () => {
  const proj = mkProject();
  try {
    mkSheet(proj, 'A', 7);
    copyGenerator(proj);
    // 预置一段"看起来可复用"的假正文（rev 相同、无 error）
    writeSnapshot(proj, [`===feature A=== dsl_rev=7 sha256=${FAKE_SHA}`, FAKE_BODY]);
    const r = await runCascade(proj, 'A', []);
    assert.ok(r.ran.includes('cognition'), `cognition 应当跑过（ran=${JSON.stringify(r.ran)}）`);
    const t = readSnapshot(proj);
    assert.doesNotMatch(t, /注入的复用正文/, `cascade 必须**现算**（假段不许被沿用）：\n${t}`);
    assert.match(t, /⚠ 生成失败（不静默）/, `cascade 现算的结果也要响亮落盘：\n${t}`);
  } finally {
    cleanup(proj);
  }
});

test('R8 --check 恒现算（有"可复用"的假段也照样判红：跳过的代价由它兜住）', () => {
  const proj = mkProject();
  try {
    mkSheet(proj, 'A', 7);
    // 文件里声明了一个"最新"的假段：若 check 也吃 prior，它会报"一致（最新）" ⇒ 假绿
    writeSnapshot(proj, [`===feature A=== dsl_rev=7 sha256=${FAKE_SHA}`, FAKE_BODY]);
    const c = COG.checkCognition(proj);
    assert.equal(c.ok, false, `--check 必须现算再对账（不许拿盘上的声明当读数）：${JSON.stringify(c)}`);
    assert.ok((c.failed ?? []).length > 0, '夹具没有 dist ⇒ 现算的段必然取不到 digest ⇒ 必须计入 failed（判不了 ≠ 通过）');
    assert.match(c.why, /取不到/, `要说清红在哪：${c.why}`);
  } finally {
    cleanup(proj);
  }
});
