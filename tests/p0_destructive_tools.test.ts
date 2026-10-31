/**
 * P0 · 三个**破坏性工具**的「安全侧」—— 由原证 `certs/t405-destructive-safety-cert.mjs` 迁入。
 *
 * ## 为什么先守这三个
 * 会**搬/删别人的代码**的工具：`move_symbol`（跨文件搬符号）· `move_domain`（整块搬域）·
 * `deprecate_offline`（下线/物理删模块）。生成类工具错了是"白干"，这三个错了是"弄坏"。
 * 核心口径只有一条：**拒绝/干跑时，盘上一个字节都不许动**。
 *
 * ## 原证 10 条断言 → 本文件用例（一条不删）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ① `move_symbol dry_run:true` ⇒ 两个源文件内容 hash 全不变 | `① dry_run 零副作用` |
 * | ①-b 目标文件**没被创建** | 同上（第二个 assert） |
 * | ①-c 有结构化预览返回（不是静默成功） | 同上（第三个 assert，且**加强**为 `dryRun===true` / `filesWritten===0` / 预览里有被删的行） |
 * | ② 撞名（目标已有同名导出）⇒ 源/目标两个文件都没变 | `② 撞名 ⇒ 整体不动` |
 * | ②-b 明确说明**原因**（不静默失败） | 同上（第二个 assert） |
 * | ③ `move_domain`（域表没改）⇒ 文件未动 | `③ 域表没改 ⇒ 无事可做` |
 * | ③-b 明确报「没有待搬的域」（不猜、不静默） | 同上（第二个 assert） |
 * | ④ `deprecate_offline` 缺省 ⇒ 内容未变（缺省落在安全侧） | `④ 缺省 = dry_run` |
 * | ④-b **一个文件都没被删** | 同上（第二个 assert） |
 * | ⑤ `remove_file:true` 但 `dry_run` 未显式 false ⇒ 仍不删 | `⑤ 两个开关都要给` |
 *
 * ## 覆盖边界（诚实清单，与原证一致）
 * · 不证"成功搬/成功删"的正面行为（这里只证**安全侧**）；
 * · `move_domain` 的**正面搬迁**要改 `structure.domains.json` 再跑 —— 本文件**故意不碰**（碰了就动真仓）；
 * · **[未核]** `deprecate_offline` 的 `verify` 编译级验收（要真跑 tsc，夹具项目没装 TS 依赖）。
 *
 * ## 隔离
 * 临时 `AGENT_IO_HOME` + 临时夹具项目（`makeTempHome()`），**不写仓内任何文件**。
 * 写闸：夹具是"测试项目"不是本仓 ⇒ `AGENT_IO_REQUIRE_PLAN=0` + 两个夹具节点 `gate:'exempt'`
 * （与原证同一套放行口径，否则 ④⑤ 的读数会被闸的拒绝信息污染）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { importProject } from '../src/infrastructure/graph/import_project.js';
import { getDSL, saveDSL } from '../src/infrastructure/storage.js';
import { moveSymbol } from '../src/application/refactor/rename/symbol_move.js';
import { moveDomain } from '../src/application/refactor/rename/move_domain.js';
import { deprecateOffline } from '../src/application/refactor/deprecate_offline/deprecate_offline.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
const A = 'src/a.ts';
const B = 'src/b.ts';
const FEATURE = 'p0_destructive_tools';

/** 被断言的两个源文件的内容指纹（"一个字节都不许动"唯一可判的读数） */
function digest(rel: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(PROJ, rel))).digest('hex');
}
function snap(): { a: string; b: string } {
  return { a: digest(A), b: digest(B) };
}
function srcFiles(): string[] {
  return fs.readdirSync(path.join(PROJ, 'src')).sort();
}

let before = { a: '', b: '' };
let ready: Promise<void> | null = null;

/** 夹具只建一次（5 个用例共享同一个"未被污染"的项目：任一步真写了盘，后面的读数就会崩） */
function setup(): Promise<void> {
  ready ??= (async () => {
    // ★ 必须在**任何** storage 调用之前：`getDataHome()` 每次调用现读 env（见 helpers/i1_fixture 头注）
    process.env.AGENT_IO_HOME = HOME;
    process.env.AGENT_IO_REQUIRE_PLAN = '0';

    fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(path.join(PROJ, A), 'export function fa(): number {\n  return 1;\n}\n\nexport function fb(): number {\n  return 2;\n}\n');
    // B 里已有同名 `fb` ⇒ ② 的撞名场景
    fs.writeFileSync(path.join(PROJ, B), 'export function fb(): number {\n  return 999;\n}\n');
    fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));
    // 域表**声明了**但没有"待搬"（目录就是它声明的位置）⇒ ③ 该报"没有待搬的域"
    fs.writeFileSync(
      path.join(PROJ, 'structure.domains.json'),
      JSON.stringify({ domains: [{ id: 'src', layer: 'domain', role: 'engine', dir: 'src', note: '夹具域' }] }, null, 2),
    );
    before = snap();

    await importProject({ project_dir: PROJ, feature: FEATURE });
    const dsl = getDSL(FEATURE);
    for (const n of (dsl.geometry?.nodes ?? []) as Array<{ path?: string; gate?: string }>) {
      if (n.path === A || n.path === B) n.gate = 'exempt';
    }
    saveDSL(dsl, PROJ);
  })();
  return ready;
}

after(() => rmRf(TMP));

// ════════════════════════════════════════════════════════════════════
// ① move_symbol dry_run ⇒ 零副作用（原证 ①②... ①/①-b/①-c）
// ════════════════════════════════════════════════════════════════════
test('① move_symbol dry_run:true ⇒ 源文件未变 · 目标没被创建 · 有结构化预览', async () => {
  await setup();
  const r = await moveSymbol({ project_dir: PROJ, file: A, symbol: 'fb', to_file: 'src/c.ts', dry_run: true });
  const after = snap();

  // ① 两个源文件内容 hash 全不变（"预演就把人代码改了"= 最严重的那类错）
  assert.deepEqual(after, before, '`move_symbol dry_run:true` 不许改源文件内容');
  // ①-b dry-run 不产生**新的**文件
  assert.equal(fs.existsSync(path.join(PROJ, 'src/c.ts')), false, 'dry-run 不许创建目标文件 src/c.ts');
  // ①-c 不是静默成功：必须给出可复核的预览（比原证"是个对象"更强 —— 钉住它的三个实质字段）
  assert.equal(r.dryRun, true, '回执必须自报 dryRun:true');
  assert.equal(r.filesWritten, 0, 'dry-run 必须 filesWritten=0');
  assert.ok((r.source?.removed?.length ?? 0) > 0, '预览必须给出"会从源文件删掉哪几行"');
});

// ════════════════════════════════════════════════════════════════════
// ② move_symbol 撞名 ⇒ 整体不动 + 说明原因（原证 ②/②-b）
// ════════════════════════════════════════════════════════════════════
test('② move_symbol 撞名（目标已有同名导出）⇒ 两个文件都没变 · 明确说明原因', async () => {
  await setup();
  const r = await moveSymbol({ project_dir: PROJ, file: A, symbol: 'fb', to_file: B });
  const after = snap();

  assert.deepEqual(after, before, '撞名时必须整体拒绝：源/目标两个文件都不许变');
  // ②-b 原因必须说得出（拒绝 ≠ 静默失败）
  const why = `${(r.blocked ?? []).join(' / ')} ${JSON.stringify(r)}`;
  assert.equal(r.ok, false, '撞名必须 ok:false');
  assert.match(why, /同名|已存在|撞名|冲突/, `拒绝必须点名原因，实际：${why.slice(0, 200)}`);
});

// ════════════════════════════════════════════════════════════════════
// ③ move_domain（域表没改 ⇒ relocate_moves 为空）⇒ 无事可做且不动文件（原证 ③/③-b）
// ════════════════════════════════════════════════════════════════════
test('③ move_domain（域表没改）⇒ 文件未动 · 明确报「没有待搬的域」', async () => {
  await setup();
  const r = await moveDomain({ project_dir: PROJ });
  const after = snap();

  assert.deepEqual(after, before, '没有意图时不许动任何文件');
  // ③-b 「没有」与「搬完了」必须可区分（AGENTS-RULES 0.12）—— 本仓用 reason 文本区分
  assert.match(String(r.reason ?? ''), /没有待搬的域/, `必须点名"没有待搬的域"，实际：${String(r.reason).slice(0, 200)}`);
});

// ════════════════════════════════════════════════════════════════════
// ④ deprecate_offline 缺省 ⇒ dry_run（原证 ④/④-b）
// ════════════════════════════════════════════════════════════════════
test('④ deprecate_offline 缺省（不给 dry_run）⇒ 内容未变 · 一个文件都没被删', async () => {
  await setup();
  const filesBefore = srcFiles();
  const r = await deprecateOffline({ project_dir: PROJ });
  const after = snap();

  assert.equal(r.dry_run, true, '缺省必须落在安全侧：dry_run=true');
  assert.deepEqual(after, before, '缺省档不许改任何文件内容');
  assert.deepEqual(srcFiles(), filesBefore, '缺省档不许删任何文件');
});

// ════════════════════════════════════════════════════════════════════
// ⑤ remove_file:true 但 dry_run 未显式 false ⇒ 仍不删（原证 ⑤）
// ════════════════════════════════════════════════════════════════════
test('⑤ remove_file:true 但 dry_run 未显式 false ⇒ 仍不删（两个开关都要给）', async () => {
  await setup();
  const filesBefore = srcFiles();
  try {
    await deprecateOffline({ project_dir: PROJ, remove_file: true });
  } catch {
    // 抛错也算安全（只要没删文件）—— 见下面那条真正要判的读数
  }
  assert.deepEqual(srcFiles(), filesBefore, '`remove_file:true` 单独不足以删文件：必须同时给 `dry_run:false`');
  assert.deepEqual(snap(), before, '⑤ 这一路同样不许改内容');
});
