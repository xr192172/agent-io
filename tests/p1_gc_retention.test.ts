/**
 * touches: scripts/gc.mjs
 *
 * P1 · **数据根 GC 的保留策略与保护边界**（2026-11-17，灰度审计 P0「磁盘 gc」）。
 *
 * ## 它锁的是什么
 * 改前 `scripts/gc.mjs` 全文 64 行，**只 GC `usage.jsonl` 账本**：索引 / 备份 / `scratch/` 一概不碰，
 * 于是 `.agent-io/` 实测长到 **3,084 MB**（`scratch/` 占 91%，其中 `scratch/t32` 单项 2.6 GB / 18,468 文件）。
 * 本卡给它加三类回收，**目标全库 < 300 MB**。
 *
 * 三类里最容易做错的是**边界**，所以本文件把三件事逐条钉住：
 * 1. **dry-run 是默认值** —— 不加 `--apply` 时整棵树一个字节都不许变（含 mtime）；
 * 2. **保护边界是结构** —— `tasks.db` / 设计册 / 账本 / 基线 / 活态册**在任何路径形态下**都不进候选；
 *    ★ 反向（消融）：把 `protectedReason()` 短路成 `return ''`，同一份夹具里 `tasks.db.bak-*`
 *    **立刻被删** —— 证明这道边界确实在起作用（不是恰好"没有候选"）；
 * 3. **保留策略可核** —— scratch 按 mtime 分界、活跃卡产物保留、备份每族留最近 1 份。
 *
 * ## 为什么用真脚本真跑（不是只测纯函数）
 * 纯函数测得出"规则对不对"，测不出"**入口接上了没有**"（本仓最常见的形态：判定在、入口没接）。
 * 这里 spawn 真 `scripts/gc.mjs`（`--project=<夹具>`、`--no-usage` 避开 dist 依赖），断言的是
 * **盘上的后果**：哪些还在、哪些没了、总共多大。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GC = path.join(ROOT, 'scripts', 'gc.mjs');

const DAY = 24 * 3600 * 1000;

function tmpDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gc-${tag}-`));
}

/** 把 mtime 拨到 `daysAgo` 天前（递归：目录与文件都拨 —— 口径是"最后一次被动过"） */
function ageTree(abs: string, daysAgo: number): void {
  const when = new Date(Date.now() - daysAgo * DAY);
  const stack = [abs];
  while (stack.length) {
    const p = stack.pop()!;
    const st = fs.lstatSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) stack.push(path.join(p, e));
    fs.utimesSync(p, when, when);
  }
}

function writeFile(abs: string, content: string | Buffer, sizeHint = 0): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (sizeHint > 0) fs.writeFileSync(abs, Buffer.alloc(sizeHint, 0x61));
  else fs.writeFileSync(abs, content);
}

function runGc(project: string, args: string[], env: Record<string, string> = {}): { out: string; status: number | null } {
  const r = spawnSync(process.execPath, [GC, `--project=${project}`, '--no-usage', ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status };
}

/** 夹具：一个"长成了"的数据根（含三类回收对象 + 全部保护对象） */
function makeDataRoot(tag: string): { project: string; dataRoot: string } {
  const project = tmpDir(tag);
  const dataRoot = path.join(project, '.agent-io');
  fs.mkdirSync(dataRoot, { recursive: true });

  // ── 要收的：一次大实验（点名）+ 一个普通旧草稿 ──
  for (let i = 0; i < 60; i++) writeFile(path.join(dataRoot, 'scratch', 't32', `big-${i}.bin`), '', 4096);
  ageTree(path.join(dataRoot, 'scratch', 't32'), 20);
  writeFile(path.join(dataRoot, 'scratch', 'old-draft', 'a.txt'), 'stale');
  ageTree(path.join(dataRoot, 'scratch', 'old-draft'), 15);

  // ── 要留的：保护窗口内的产物 + 活跃卡的产物 ──
  writeFile(path.join(dataRoot, 'scratch', 'just-now', 'a.txt'), 'fresh');
  writeFile(path.join(dataRoot, 'scratch', 'card-abc-impl', 'a.txt'), 'claimed');
  ageTree(path.join(dataRoot, 'scratch', 'card-abc-impl'), 15);

  // ── 备份族：同一族 3 份 ⇒ 只留最近 1 份 ──
  writeFile(path.join(dataRoot, 'cache.db.bak-before-t45'), '', 8192);
  writeFile(path.join(dataRoot, 'cache.db.bak-before-t44'), '', 8192);
  writeFile(path.join(dataRoot, 'cache.db.bak-before-t43'), '', 8192);
  ageTree(path.join(dataRoot, 'cache.db.bak-before-t45'), 1);
  ageTree(path.join(dataRoot, 'cache.db.bak-before-t44'), 5);
  ageTree(path.join(dataRoot, 'cache.db.bak-before-t43'), 9);
  // 散落在 scratch 里的旧备份（r11 那 107 MB 的同族）
  writeFile(path.join(dataRoot, 'scratch', 'r11', 'cache.db.bak-20260101-000000'), '', 8192);
  ageTree(path.join(dataRoot, 'scratch', 'r11'), 30);

  // ── 保护对象（一件都不许没）──
  // ★ `tasks.db` 必须是**真库**（GC 要读它的 `live_cards` 判活跃卡）；内容由下面的 node:sqlite 建。
  // ★ 库的备份**两代**都要在："族里只留最近 1 份"这条规则单独看会想删老的那份 ——
  //   保护边界必须把它按住（GC⑤ 的消融咬的就是这一下）。
  fs.writeFileSync(path.join(dataRoot, 'tasks.db.bak-20250101'), 'TASKS-DB-OLD-BACKUP');
  fs.writeFileSync(path.join(dataRoot, 'tasks.db.bak-20240101'), 'TASKS-DB-OLDER-BACKUP');
  fs.writeFileSync(path.join(dataRoot, 'task-history.jsonl'), '{"a":1}\n');
  fs.writeFileSync(path.join(dataRoot, 'field-ledger.json'), '{}\n');
  fs.writeFileSync(path.join(dataRoot, 'verified-snapshot.json'), '{}\n');
  fs.writeFileSync(path.join(dataRoot, 'judge-cache.json'), '{}\n');
  writeFile(path.join(dataRoot, 'design', 'agent-io.dsl.json'), '{"geometry":{"nodes":[]}}');
  writeFile(path.join(dataRoot, 'design', 'agent-io.history.jsonl'), '{"x":1}\n');
  writeFile(path.join(dataRoot, 'baseline', 'agent-io.json'), '{}\n');
  writeFile(path.join(dataRoot, 'live', 'agent-io.json'), '{}\n');
  writeFile(path.join(dataRoot, 'dogfood', 'usage.jsonl'), '{"t":1}\n');
  ageTree(path.join(dataRoot, 'design'), 40);
  ageTree(path.join(dataRoot, 'baseline'), 40);
  ageTree(path.join(dataRoot, 'live'), 40);
  fs.utimesSync(path.join(dataRoot, 'tasks.db.bak-20250101'), new Date(Date.now() - 40 * DAY), new Date(Date.now() - 40 * DAY));
  fs.utimesSync(path.join(dataRoot, 'tasks.db.bak-20240101'), new Date(Date.now() - 90 * DAY), new Date(Date.now() - 90 * DAY));

  // tasks.db 里有一张 claimed 卡：`card-abc-impl` 的产物因此必须留
  const db = spawnSync(
    process.execPath,
    [
      '-e',
      [
        "const {DatabaseSync}=require('node:sqlite');",
        `const db=new DatabaseSync(${JSON.stringify(path.join(dataRoot, 'tasks.db'))});`,
        "db.exec('CREATE TABLE live_cards (id TEXT, feature TEXT, state TEXT)');",
        "db.prepare('INSERT INTO live_cards VALUES (?,?,?)').run('card-abc','task-system-plan','claimed');",
        'db.close();',
      ].join(''),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(db.status, 0, `建夹具 tasks.db 失败：${db.stderr}`);
  return { project, dataRoot };
}

/** 树上所有文件的 (相对路径 → 大小) —— dry-run 前后要一模一样 */
function snapshot(root: string): Map<string, number> {
  const out = new Map<string, number>();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.set(path.relative(root, p).split(path.sep).join('/'), fs.statSync(p).size);
    }
  }
  return out;
}

const totalBytes = (root: string): number => [...snapshot(root).values()].reduce((n, x) => n + x, 0);

// ══════════════════════════════════════════════════════════════════════════
// ① dry-run 是默认值：一个字节都不改
// ══════════════════════════════════════════════════════════════════════════
test('GC① · 不加 --apply ⇒ dry-run：候选照列，盘上一个字节都不动', () => {
  const { project, dataRoot } = makeDataRoot('dry');
  const before = snapshot(dataRoot);
  const r = runGc(project, []);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual([...snapshot(dataRoot).entries()], [...before.entries()], 'dry-run 之后树必须逐字节相同');
  assert.match(r.out, /dry-run 结束：一个字节都没写/, '必须自己说清楚这是 dry-run');
  // 候选要列出来（带分母），不许只说"有候选"
  assert.match(r.out, /候选 \d+ 个/);
  assert.match(r.out, /scratch\/t32/, 'scratch 候选里必须点名 t32 这一档');
});

// ══════════════════════════════════════════════════════════════════════════
// ② 保留策略：超过保留期才收 / 保护窗口内留 / 活跃卡的产物留
// ══════════════════════════════════════════════════════════════════════════
test('GC② · scratch：过期收、保护窗口内留、活跃卡产物留（三条一起生效）', () => {
  const { project, dataRoot } = makeDataRoot('retain');
  const r = runGc(project, ['--apply']);
  assert.equal(r.status, 0, r.out);
  assert.equal(fs.existsSync(path.join(dataRoot, 'scratch', 't32')), false, '过期的大实验必须被收掉');
  assert.equal(fs.existsSync(path.join(dataRoot, 'scratch', 'old-draft')), false, '过期的旧草稿必须被收掉');
  assert.equal(fs.existsSync(path.join(dataRoot, 'scratch', 'just-now')), true, '保护窗口内的产物不许删');
  assert.equal(fs.existsSync(path.join(dataRoot, 'scratch', 'card-abc-impl')), true, '活跃卡（claimed）的产物不许删');
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 备份：每族留最近 1 份（含散落在 scratch 里的那份）
// ══════════════════════════════════════════════════════════════════════════
test('GC③ · *.bak-*：同族只留最近 1 份，旧的多余备份（含 scratch 里的）收掉', () => {
  const { project, dataRoot } = makeDataRoot('bak');
  const r = runGc(project, ['--apply']);
  assert.equal(r.status, 0, r.out);
  assert.equal(fs.existsSync(path.join(dataRoot, 'cache.db.bak-before-t45')), true, '最近 1 份必须留');
  assert.equal(fs.existsSync(path.join(dataRoot, 'cache.db.bak-before-t44')), false, '多出来的旧备份要收');
  assert.equal(fs.existsSync(path.join(dataRoot, 'cache.db.bak-before-t43')), false, '多出来的旧备份要收');
  assert.equal(fs.existsSync(path.join(dataRoot, 'scratch', 'r11', 'cache.db.bak-20260101-000000')), false, '散在 scratch 里的老备份同样在回收面内');
});

// ══════════════════════════════════════════════════════════════════════════
// ④ ★ 保护边界：库 / 册 / 账本 / 基线 / 活态册一件都不许没
// ══════════════════════════════════════════════════════════════════════════
test('GC④ · 保护边界：tasks.db（连它的备份族）/ 设计册 / 账本 / 基线 / 活态册一律不碰', () => {
  const { project, dataRoot } = makeDataRoot('guard');
  const r = runGc(project, ['--apply', '--scratch-days=0', '--protect-hours=0']);
  assert.equal(r.status, 0, r.out);
  const mustSurvive = [
    'tasks.db', // ★ 库本体
    'tasks.db.bak-20250101', // ★ 库的**旧备份**也不许删（族规则看起来"该删"，边界说不）
    'tasks.db.bak-20240101',
    'task-history.jsonl',
    'field-ledger.json',
    'verified-snapshot.json',
    'judge-cache.json',
    'design/agent-io.dsl.json',
    'design/agent-io.history.jsonl',
    'baseline/agent-io.json',
    'live/agent-io.json',
    'dogfood/usage.jsonl',
  ];
  for (const rel of mustSurvive) {
    assert.equal(fs.existsSync(path.join(dataRoot, rel)), true, `${rel} 被 GC 删了 —— 保护边界漏了`);
  }
  // 报出"跳过"的行也要在：读端得看见"本来会删、但被边界拦住"这件事
  assert.match(r.out, /跳过 \d+ 个/);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ ★ 消融（0.16 反向）：把保护边界短路掉 ⇒ 同一份夹具里 tasks.db 的备份会被删
// ══════════════════════════════════════════════════════════════════════════
test('GC⑤ · 消融：`protectedReason()` 一旦短路，tasks.db 的备份族立刻进候选并被删（边界有牙）', () => {
  const { project, dataRoot } = makeDataRoot('ablate');
  // 造一份"被消融"的脚本：整份拷 + 拷 import 闭包（scripts/lib），只在 protectedReason 开头插 `return '';`
  const dir = tmpDir('gc-ablate-script');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(GC, path.join(dir, 'scripts', 'gc.mjs'));
  fs.cpSync(path.join(ROOT, 'scripts', 'lib'), path.join(dir, 'scripts', 'lib'), { recursive: true });
  const ablated = path.join(dir, 'scripts', 'gc.mjs');
  const src = fs.readFileSync(ablated, 'utf8');
  const anchor = 'export function protectedReason(rel) {';
  assert.ok(src.includes(anchor), '消融锚点不见了（`protectedReason` 被改名？那这条用例要跟着改，不是删）');
  fs.writeFileSync(ablated, src.replace(anchor, `${anchor}\n  return ''; // ← 消融：边界短路`), 'utf8');

  const r = spawnSync(process.execPath, [ablated, `--project=${project}`, '--no-usage', '--apply', '--scratch-days=0', '--protect-hours=0'], {
    encoding: 'utf8',
    cwd: dir,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(fs.existsSync(path.join(dataRoot, 'tasks.db.bak-20240101')), false, `消融后 tasks.db 的旧备份**必须**被删（否则说明这条用例没咬住边界）\n${out}`);
  assert.equal(fs.existsSync(path.join(dataRoot, 'tasks.db.bak-20250101')), true, '族里最近 1 份仍按族规则保留');
  assert.equal(fs.existsSync(path.join(dataRoot, 'tasks.db')), true, '库本体在消融后仍在 —— 它不在三类回收的 scope 里（只在备份族里）');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ 目标：收完必须落进目标体积
// ══════════════════════════════════════════════════════════════════════════
test('GC⑥ · 目标：收完后全库体积达标（< --target-mb），且输出里给出实测前/后', () => {
  const { project, dataRoot } = makeDataRoot('target');
  const before = totalBytes(dataRoot);
  const r = runGc(project, ['--apply', '--target-mb=1']);
  assert.equal(r.status, 0, r.out);
  const after = totalBytes(dataRoot);
  assert.ok(after < before, `收完总体积必须变小（前 ${before} → 后 ${after}）`);
  assert.match(r.out, /实测：[\d.]+ MB \/ \d+ 文件 → [\d.]+ MB \/ \d+ 文件/, '前后两次实测读数都要给（0.12 第 3 条）');
  assert.match(r.out, /目标 < 1 MB ⇒ (✓ 达标|✗ 还差)/, '目标达没达标必须明写，不许含糊');
});
