// touches: src/infrastructure/graph/import_project.ts, src/infrastructure/storage.ts, src/infrastructure/index/db.ts
/**
 * P 批 · **O1 落盘根根治：importProject 内部 baseline/live/cache/takeover/scratch 落盘归属仓根**
 * （G-1 登记层分离之后，钉住**内部落盘点**）。
 *
 * ## 病史（改前实测）
 * G-1 已把注册表登记层的 `project_root`（册归属根）与 `source_root`（扫描目录）分开，
 * 但 `importProject` **内部**落盘仍拿扫描根 `root = resolve(project_dir)`：
 *   · `saveLiveFeature(layered, root)` / `rebuildBaseline(layered, root)`
 *   · 缺省 `getProjectCacheDb(root)`
 *   · `assessTakeover({ projectRoot: root })`
 *   · scratch 清单 `path.join(root, '.agent-io', 'scratch', …)`
 * rebuild_feature 把 `src/` 子树传进 `project_dir`、`project_root=pkgRoot` ⇒ 上述派生副本
 * 落进 `src/.agent-io/`（实测旧债：`src/application/meta/registry/.agent-io/` 残留 cache.db + judge-cache.json），
 * 每批被迫 backup-move-out workaround。
 *
 * ## 根治口径（本证钉住）
 * 内部一切**落盘归属根**一律取 `projectRootAbs`（= 入参 `project_root`，缺省同根向后兼容）；
 * 扫描根 `root`（= `project_dir`）只用于 walk / 读源码 / 算 rel / 填语义事实，不拿来落盘。
 *
 * ## 反向牙（fail-closed 突变点）
 * 把任一落盘点改回 `root`（misroot 突变）⇒ 对应产物落进 `<srcRoot>/.agent-io/`，
 * 本证「子树无 `.agent-io` 错位副本」断言红（证明有牙，不是假绿）。
 *
 * ## 排队债务（本证不钉）
 * `tools/` 抽取器缓存目录与扫描根同参（semantic_facts 根耦合，未拆）。
 * baseline **facts**（`*.facts.json`）落盘根已在 P2-R2 根治：第 2 参改传归属根
 * `projectRootAbs`，与 live/baseline-DSL/design/cache 同根；读方 `consistency.ts` 按
 * `dsl.source_root` 直取、无根候选链的迁移另立切片（本证只钉写根，读端口径不动）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import { importProject } from '../src/infrastructure/graph/import_project.js';
import {
  getLiveFeatureFile,
  getBaselineFeatureFile,
  getDesignSheetFile,
  getBaselineFactsFile,
} from '../src/infrastructure/storage.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';

const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
after(() => rmRf(TMP));

let seq = 0;
function featureOf(): string {
  seq += 1;
  return `p_persist_root_${process.pid}_${seq}`;
}

/** 在扫描子树里放一个必出符号的 JS 文件。 */
function makeSplitProj(tag: string): { pkgRoot: string; srcRoot: string } {
  const pkgRoot = path.join(TMP, tag, 'pkg');
  const srcRoot = path.join(pkgRoot, 'src');
  fs.mkdirSync(srcRoot, { recursive: true });
  fs.writeFileSync(
    path.join(srcRoot, 'greet.js'),
    `export function greet(name) {\n  return \`hi \${name}\`;\n}\n`,
    'utf-8',
  );
  return { pkgRoot, srcRoot };
}

/** 递归收集目录下所有文件相对路径（posix），供错位分类断言。 */
function walkRel(dir: string, base: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (e.isDirectory()) walkRel(full, base, out);
    else out.push(rel);
  }
  return out;
}

test('① 分离根导入：live/baseline-DSL/design/cache 落仓根，扫描子树不产生归属根错位副本', async () => {
  const { pkgRoot, srcRoot } = makeSplitProj('split');
  const feature = featureOf();

  const r = (await importProject({
    project_dir: srcRoot,
    project_root: pkgRoot,
    feature,
  } as never)) as Record<string, unknown>;

  assert.ok((r.files_parsed as number) > 0, `必须真的扫到子树文件，实得 ${r.files_parsed}`);
  assert.ok((r.symbols_found as number) > 0, `必须出符号，实得 ${r.symbols_found}`);

  // ★ 落盘归属根 = 仓根（project_root）：live / baseline DSL / design / cache.db 都在 pkgRoot/.agent-io 下。
  const liveFile = getLiveFeatureFile(feature, pkgRoot);
  const baselineFile = getBaselineFeatureFile(feature, pkgRoot);
  const designFile = getDesignSheetFile(feature);
  const cacheDb = path.join(pkgRoot, '.agent-io', 'cache.db');

  assert.ok(fs.existsSync(liveFile), `live 快照必须落仓根：${liveFile}`);
  assert.ok(fs.existsSync(baselineFile), `baseline DSL 必须落仓根：${baselineFile}`);
  assert.ok(designFile.startsWith(path.join(pkgRoot, '.agent-io', 'design')), `册必须落仓根：${designFile}`);
  assert.ok(fs.existsSync(cacheDb), `cache.db 必须落仓根：${cacheDb}`);

  // ★ P2-R2：baseline facts 也落归属根（仓根），不再随扫描子树错位。
  const factsFile = getBaselineFactsFile(feature, pkgRoot);
  assert.ok(fs.existsSync(factsFile), `baseline facts 必须落仓根：${factsFile}`);

  // 同一批索引库在仓根下真的查到那个符号（证明库就是归属根这份，不是子树副本）。
  const db = getProjectCacheDb(pkgRoot);
  const hit = db.prepare("SELECT name FROM nodes WHERE name = 'greet'").all() as Array<{ name: string }>;
  assert.equal(hit.length, 1, `仓根 cache.db 必须含 greet 符号，实得 ${JSON.stringify(hit)}`);

  // ★ 反向牙：扫描子树下**不许**出现归属根派生副本（live/baseline-DSL/design/cache/facts/self-writes/scratch）。
  //   排队债务（本证放行、另立切片）：tools/ 抽取器缓存目录与扫描根同参（semantic_facts 根耦合，未拆）。
  const srcIo = path.join(srcRoot, '.agent-io');
  const rels = fs.existsSync(srcIo) ? walkRel(srcIo, srcIo) : [];
  const forbidden = rels.filter((rel) => {
    if (rel.startsWith('tools/')) return false; // 排队债务：抽取器缓存目录
    return true;
  });
  assert.deepEqual(
    forbidden,
    [],
    `子树不得落归属根派生副本（错位到 src/.agent-io）；放行 facts/tools，发现：${forbidden.join('; ')}`,
  );
});

test('② 同根向后兼容：只传 project_dir（缺省 project_root）⇒ 落该根，行为与历史一致', async () => {
  const { pkgRoot, srcRoot } = makeSplitProj('same');
  // 同根形态：扫描目录就是仓根本身（不分子树）。
  fs.rmSync(srcRoot, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(pkgRoot, 'greet.js'),
    `export function greet(name) { return name; }\n`,
    'utf-8',
  );
  const feature = featureOf();

  const r = (await importProject({ project_dir: pkgRoot, feature } as never)) as Record<string, unknown>;
  assert.ok((r.symbols_found as number) > 0, `同根导入必须出符号，实得 ${r.symbols_found}`);

  const liveFile = getLiveFeatureFile(feature, pkgRoot);
  assert.ok(fs.existsSync(liveFile), `同根形态 live 仍落传入根：${liveFile}`);
  const cacheDb = path.join(pkgRoot, '.agent-io', 'cache.db');
  assert.ok(fs.existsSync(cacheDb), `同根形态 cache.db 仍落传入根：${cacheDb}`);
});
