/**
 * ★ P0（第二个）· **「这份册是不是本项目的册」只许有一把尺**。
 *
 * ## 病（改前实测）
 * 同一句判定散在四处、一字不差都是 `path.resolve(dsl.source_root) === absRoot`：
 *   `write_gate.ts:868`（写闸 `rootFeatureCount`）· `file_snapshot.ts:162`（快照归属）·
 *   `ledger_membership.ts:38`（台账成员）· `claim_conflict.ts:492`（读集冲突）。
 * 而 `source_root` 里存的是**写册那台机器的绝对路径**（本仓三册都是 `D:\…`）
 * ⇒ 换一台机器这个比较**恒 false** ⇒ `rootFeatureCount = 0` ⇒ `applicable:false`
 * ⇒ **任务闸对全仓静默放行**（不拦、不报、不响）。
 * ★ 本机的绿**不能证明任何事**：本机 `source_root` 与 `absRoot` 字符串恰好相等 —— 所以本证全部用夹具，
 *   而且夹具里的 `source_root` 故意写成**异机绝对路径**。
 *
 * ## ① 本证断言什么（册身份，三条）
 *   · 前提（= 改前读数）：异机 `source_root` 上，**旧口径** `path.resolve(source_root) === absRoot` 为 `false`
 *     —— 这就是"任务闸静默放行"的成因，不是猜测；
 *   · 改后：`isSameProject` 为 `true`，且写闸 `collectGateCoverage` 的 `rootFeatureCount=1` / `covering=[fake-book]`
 *     （判据 = **册住在谁家里** `<absRoot>/.agent-io/design/`，与册里记的是哪台机器无关）；
 *   · **反向对照**：另一份册住在**另一个 `AGENT_IO_HOME`**、另一个项目根下
 *     ⇒ 拿本项目 root 去问必须 `false`（不许变成"永远 true"），且写闸不许把它算进来。
 *
 * ## ② 本证断言什么（`refresh:true` 的**动手**路径）
 * `repairStaleResolvedRefs` 改前按 `reference_name` 挑行 ⇒ **别名行 / `recv.method` 行必然假阳性**
 * （`nodes.name` 只存裸名）。读数的口径早已是 id 口径，动手的路径却还是名字口径
 * ⇒ 本库实测会 reopen **13 个名字 / 18 行，全是假的**。本证两态：
 *   · `resolved_node_id` 指向**存在**节点的别名行（`import { applyMatch as applyOneMatch }`）
 *     与成员调用行（`reg.register`）⇒ **不许被 reopen**；
 *   · `resolved_node_id` 指向**已删**节点的行 ⇒ **必须被 reopen**。
 * ★ 反例必须断言"前提"（名字口径会挑出 2 条）—— 否则本用例挡不住"口径改回名字"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as storage from '../src/infrastructure/storage.js';
import { collectGateCoverage } from '../src/application/write_gate.js';
import { repairStaleResolvedRefs } from '../src/application/meta/integrity/index_integrity.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { rmRf } from './helpers/i1_fixture.js';

/** 「写册那台机器」的绝对路径（★ 在本机上它**恰好**等于真仓 —— 正是本证要绕开的东西） */
const FOREIGN = process.platform === 'win32' ? 'D:/some/other/machine/repo' : '/some/other/machine/repo';

const tmp = (tag: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `agentio-${tag}-`));

function writeJson(p: string, o: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}

/** 把一份册落到**这个项目自己的** `.agent-io/design/` 下（= 它住在谁家里），`source_root` 由调用方钉 */
function sheetAt(projectRoot: string, feature: string, sourceRoot: string): void {
  writeJson(path.join(projectRoot, '.agent-io', 'design', `${feature}.dsl.json`), {
    feature,
    source_root: sourceRoot,
    geometry: {
      nodes: [{ id: 'n0', label: 'n0', type: 'file', path: 'src/foo.ts' }],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  });
}

/** 注册表 = 「feature → 项目根」的唯一入口（`getDesignSheetFile` 就靠它定位册） */
function registryAt(home: string, map: Record<string, string>): void {
  const features = Object.fromEntries(
    Object.entries(map).map(([f, root]) => [
      f,
      { project_root: root.replace(/\\/g, '/'), registered_at: new Date().toISOString(), registered_by: 'fixture' },
    ]),
  );
  writeJson(path.join(home, '.agent-io', 'projects.json'), { version: 1, features });
}

/** 旧口径（= 改前四处那一句）：**只用来读"改前是多少"**，本证不靠它判绿 */
const oldRuler = (sheet: { source_root?: string }, absRoot: string): boolean =>
  !!sheet.source_root && path.resolve(sheet.source_root) === path.resolve(absRoot);

/** 新口径（唯一判据）：storage 必须导出它 —— 四处不许各留一份 */
function sameProject(): (sheet: { feature: string }, absRoot: string) => boolean {
  const fn = (storage as unknown as { isSameProject?: (s: { feature: string }, r: string) => boolean }).isSameProject;
  assert.equal(
    typeof fn,
    'function',
    'storage 必须导出唯一的身份判据 `isSameProject(designSheet, absRoot)` —— ' +
      '四处调用点（write_gate / file_snapshot / ledger_membership / claim_conflict）**不许**各留一份 ' +
      '`path.resolve(dsl.source_root) === absRoot`（0.9 一处权威）',
  );
  return fn as (s: { feature: string }, r: string) => boolean;
}

test('① 册身份：异机 source_root 不许左右「这册是不是本项目的」（前提 false / 改后 true / 反向对照 false）', () => {
  const homeA = tmp('ident-a'); // 本项目的数据家
  const homeB = tmp('ident-b'); // ★ 另一个数据家（反向对照用）
  const projA = tmp('ident-proj-a');
  const projB = tmp('ident-proj-b');
  try {
    // 册住在本项目 `design/` 下，但 source_root 写的是**异机绝对路径**（= 本仓三册的真实形态）
    sheetAt(projA, 'fake-book', FOREIGN);
    // 反向对照：另一份册，住在另一个 home + 另一个项目根下
    sheetAt(projB, 'other-book', projB.replace(/\\/g, '/'));
    registryAt(homeA, { 'fake-book': projA });
    registryAt(homeB, { 'other-book': projB });

    // ── 前提（改前读数）：旧口径在异机 source_root 上**必然 false**
    process.env.AGENT_IO_HOME = homeA;
    const sheetA = storage.listDesignSheets().find((d) => d.feature === 'fake-book');
    assert.ok(sheetA, '夹具册 fake-book 没被 listDesignSheets 读到（注册表 / 路径不对）');
    assert.equal(
      oldRuler(sheetA, projA),
      false,
      '夹具前提：旧口径（path.resolve(source_root) === absRoot）在异机 source_root 上必须为 false ' +
        '—— 这就是「rootFeatureCount=0 ⇒ 任务闸 applicable:false ⇒ 对全仓静默放行」的成因',
    );
    // ★ 把"改前的读数"直接算出来：旧口径下这份册**一条都进不了** covering
    //   （= 改前 `collectGateCoverage` 的 rootFeatureCount，闸据此 applicable:false 静默放行）
    assert.equal(
      storage.listDesignSheets().filter((d) => oldRuler(d, projA)).length,
      0,
      '改前读数：同一夹具在旧口径下 covering=0 ⇒ 任务闸对全仓静默放行（本条与下一条 rootFeatureCount=1 是同一件事的前后两张照片）',
    );

    // ── 改后：唯一判据 = 册住在谁家里
    const isSame = sameProject();
    assert.equal(
      isSame({ feature: 'fake-book' }, projA),
      true,
      '册住在 <absRoot>/.agent-io/design/ 下 ⇒ 就是本项目的册（与它 source_root 写的是哪台机器**无关**）',
    );
    const cov = collectGateCoverage(projA);
    assert.equal(cov.rootFeatureCount, 1, '写闸必须把这份册认成本项目的（改前 = 0 ⇒ applicable:false ⇒ 静默放行）');
    assert.deepEqual(
      cov.features.map((f) => f.feature),
      ['fake-book'],
      '闸的 covering 列表必须点名这份册（闸真的会去判它的节点，不是只有计数）',
    );

    // ── 反向对照：另一个 home 里的册，拿本项目 root 去问必须 false（不许"永远 true"）
    process.env.AGENT_IO_HOME = homeB;
    assert.equal(isSame({ feature: 'other-book' }, projA), false, '别的 home 里的册不许被认成本项目的');
    assert.equal(isSame({ feature: 'other-book' }, projB), true, '反向对照的自检：同一份册问它自己的根必须是 true（否则本判据只是"恒 false"的另一种坏法）');
    const covB = collectGateCoverage(projA);
    assert.equal(covB.rootFeatureCount, 0, '问 projA 时，另一个 home 的册不许算进来');
  } finally {
    delete process.env.AGENT_IO_HOME;
    for (const p of [homeA, homeB, projA, projB]) rmRf(p);
  }
});

// ── ② 修复路径：同一份 cache.db 上，不许拿名字当陈旧判据 ────────────────────────────

/** 建最小索引：一个 files 行 + 一个 file 节点（`hasLiveIndex` 要求 files>0） */
function seedIndex(root: string): number {
  const db = getProjectCacheDb(root);
  db.prepare('INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at) VALUES (?,?,?,?,?,?)').run(
    'src/a.ts',
    'h',
    'ts',
    1,
    0,
    0,
  );
  const fid = (db.prepare('SELECT id FROM files WHERE path = ?').get('src/a.ts') as { id: number }).id;
  db.prepare(
    'INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run('src/a.ts', 'file', 'a', 'a', 'src/a.ts', 'ts', 1, 1, 0);
  return fid;
}

/** 真实存在的目标节点（`resolved_node_id` 指向它 ⇒ 这条断言**不陈旧**） */
function addNode(root: string, id: string, name: string, qn: string): void {
  const db = getProjectCacheDb(root);
  db.prepare(
    'INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(id, 'method', name, qn, 'src/b.ts', 'ts', 1, 1, 0);
}

function addResolvedRef(root: string, fileId: number, name: string, resolvedNodeId: string | null): void {
  const db = getProjectCacheDb(root);
  db.prepare(
    'INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, file_id, language, status, name_tail, resolved_node_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run('src/a.ts', name, 'call', 1, 1, fileId, 'ts', 'resolved', '', resolvedNodeId);
}

/** 某条引用的当前 status（`null` = 行没了） */
function statusOf(root: string, name: string): string | null {
  const row = getProjectCacheDb(root).prepare('SELECT status FROM unresolved_refs WHERE reference_name = ?').get(name) as
    | { status: string }
    | undefined;
  return row?.status ?? null;
}

/** 前提自检：**只按名字**（= 改前那条 SQL）会挑出哪些名字 —— 保证本用例真的有鉴别力 */
function nameOnlyNames(root: string): string[] {
  const rows = getProjectCacheDb(root)
    .prepare(
      `SELECT DISTINCT u.reference_name AS nm FROM unresolved_refs u
       WHERE u.status = 'resolved'
         AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name = u.reference_name)
       ORDER BY u.reference_name`,
    )
    .all() as Array<{ nm: string }>;
  return rows.map((r) => r.nm);
}

test('② 修复路径：别名行 / 成员调用行不许被 reopen，真陈旧行必须被 reopen', () => {
  const home = tmp('repair-home');
  const project = tmp('repair-proj');
  try {
    process.env.AGENT_IO_HOME = home;
    // 真文件（`resolveCrossFileCalls` 会按引用方文件重解析 —— 盘上没有文件它做不了事）
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const x = ghost_fn();\n');
    fs.writeFileSync(
      path.join(project, 'src', 'b.ts'),
      'export function applyMatch() {}\nexport class Registry { static register() {} }\n',
    );

    const fid = seedIndex(project);
    addNode(project, 'src/b.ts#applyMatch', 'applyMatch', 'applyMatch');
    addNode(project, 'src/b.ts#Registry.register', 'register', 'Registry.register');
    // 假阳性两条（目标节点**真实存在** ⇒ 一条都不陈旧）
    addResolvedRef(project, fid, 'applyOneMatch', 'src/b.ts#applyMatch'); // import 别名
    addResolvedRef(project, fid, 'reg.register', 'src/b.ts#Registry.register'); // 成员调用
    // 真陈旧两条（目标节点已不在 / 压根不知道 ⇒ 断言不可验证）
    addResolvedRef(project, fid, 'ghost_fn', 'src/gone.ts#ghost_fn');
    addResolvedRef(project, fid, 'null_target', null);

    assert.deepEqual(
      nameOnlyNames(project),
      ['applyOneMatch', 'ghost_fn', 'null_target', 'reg.register'],
      '夹具前提：名字口径会把 **4 条全挑出来**（含 2 条假阳性）—— 改前 `repairStaleResolvedRefs` 就是这么挑的，' +
        '所以它必然把 applyOneMatch / reg.register 也 reopen 掉 ⇒ 本用例有鉴别力',
    );

    const r = repairStaleResolvedRefs(getProjectCacheDb(project), project);

    assert.equal(r.names, 2, `只许 reopen 那 2 个**真陈旧**的名字（ghost_fn / null_target），实际 ${r.names}：多出来的就是假阳性`);
    assert.equal(statusOf(project, 'applyOneMatch'), 'resolved', '★ import 别名行不许被 reopen（`nodes.name` 只存裸名 applyMatch ⇒ 名字口径必然把它当陈旧）');
    assert.equal(statusOf(project, 'reg.register'), 'resolved', '★ 成员调用行不许被 reopen（reference_name 是 `recv.method`）');
    assert.notEqual(statusOf(project, 'ghost_fn'), 'resolved', '目标节点已删的行必须被 reopen');
    assert.notEqual(statusOf(project, 'null_target'), 'resolved', 'resolved_node_id 为 NULL 的行必须被 reopen（断言不可验证）');
  } finally {
    delete process.env.AGENT_IO_HOME;
    rmRf(home);
    rmRf(project);
  }
});
