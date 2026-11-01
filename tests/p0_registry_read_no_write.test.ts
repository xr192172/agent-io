/**
 * ★ P0（T-#REG）· **注册表的四件事必须分得开**：读 / 写 / 坏 / 不可达。
 *
 * ## 病（改前实测，四条读数原样抄在这里 —— 本证后半段把它们逐条翻绿）
 * · **C1 读路径会写盘**：`readRegistry` 里挂着 `pruneStaleEntries`（剪掉并**写回文件**）⇒
 *   造 2 条登记（1 条指着不存在的目录）读一次后 `keys` 只剩 1 条，`projects.json` 的 mtime 与 sha256 **都变**。
 * · **C2 写端不 resolve**：`registerFeature('f_rel','.')` 把 `"."` 原样落盘 ⇒ 下一次读即判坏 ⇒ 条目被剪
 *   ⇒ `projectRootOf('f_rel') === null`（**登记等于没登记**）。
 * · **C3 同一个 null 背两种含义**：`projectRootOf` 既表示"没登记"也表示"登记了但目录不可达" ⇒
 *   总账（`countTaskHistory` / `queryTaskHistory`）对后者整屏抛「没有项目根登记」。
 * · **C4 坏文件冒充空表**：非法 JSON ⇒ 回 `{}` + 一行 warn ⇒ 「读失败」与「一条都没登记」同形。
 *
 * ## 本证断言什么（每条都双向）
 * 1. 读一次**不改盘**（mtime + sha256）且**不删**（keys 仍 2 条），但**要报**（stderr 一行含 feature 名）；
 * 2. `projectRootOf` 对"登记了但不可达"仍返回**登记里的根**，只有"没登记"才 `null`；
 * 3. `chdir` 到别处后 `registerFeature('.')` ⇒ 落盘是**绝对路径**、读回仍在、`projectRootOf` 非 null；
 * 4. 坏**文件** ⇒ **抛**（报文含绝对路径 + 形状 + 三条救法）；坏**条目** ⇒ 走 suspects（两者分得开）；
 * 5. 总账 / 历史查询对"不可达 / 没登记"**不抛、不建目录**，且按 0 条计并给诊断；
 * 6. `unregisterFeature(feature, reason)` 是唯一删除出口：空理由拒、删了留日志；
 * 7. `.tmp` 名带 pid（并发写同一本册不许互相踩）；
 * 8. `scripts/registry_repair.mjs` 默认 dry-run（不写盘）、`--apply` 才删，且判据是
 *    「不可达 / 在系统临时目录下」而**不是**按名字或时间猜。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  isReachableRoot,
  normRoot,
  projectRootOf,
  readRegistry,
  readRegistryChecked,
  registerFeature,
  registryFile,
  tmpPathFor,
  unregisterFeature,
  writeRegistry,
} from '../src/infrastructure/project_registry.js';
import { countTaskHistory, openTasksDb, queryTaskHistory } from '../src/infrastructure/task_history.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const tmp = (tag: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `agentio-reg-${tag}-`));

/** 换一个**独立**的数据仓（★ `AGENT_IO_DATA_ROOT` 优先级高于 `AGENT_IO_HOME` ⇒ 必须显式摘掉） */
function useHome(tag: string): string {
  delete process.env.AGENT_IO_DATA_ROOT;
  const home = tmp(tag);
  process.env.AGENT_IO_HOME = home;
  return home;
}

const sha = (f: string): string =>
  fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : '<absent>';
const mtime = (f: string): number => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);

/** 把 stderr 吞掉（本证只关心判据，不关心噪声；要看噪声的用 `captureStderr`） */
function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((s: unknown) => {
    chunks.push(String(s));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return chunks.join('');
}

test('C1 读路径不写盘也不删：keys=2 · 不可达进 suspects · mtime+sha256 前后一致', () => {
  useHome('c1');
  const live = tmp('c1-live');
  const gone = path.join(os.tmpdir(), 'agentio-reg-c1-gone-不存在');
  registerFeature('f_ok', live, 'test');
  registerFeature('f_gone', gone, 'test');
  assert.equal(fs.existsSync(gone), false, '前提：这条登记的根必须**不存在**（否则测的不是不可达）');
  const file = registryFile();
  const before = { sha: sha(file), mtime: mtime(file) };

  let keys: string[] = [];
  const err = captureStderr(() => {
    keys = Object.keys(readRegistry().features);
  });
  const after = { sha: sha(file), mtime: mtime(file) };

  assert.deepEqual(keys.sort(), ['f_gone', 'f_ok'], '读一次不许把不可达的条目**删掉**（改前只剩 f_ok）');
  assert.equal(after.sha, before.sha, '读路径**绝不写盘**：sha256 必须前后一致');
  assert.equal(after.mtime, before.mtime, '读路径**绝不写盘**：mtime 必须前后一致');
  assert.match(err, /f_gone/, '不许静默：诊断行要点名那条不可达的登记');
  assert.match(err, /registry_repair\.mjs/, '诊断要给出"该跑什么命令"');

  // ★ 同一个 null 不许再背两种含义
  const check = readRegistryChecked();
  assert.deepEqual(
    check.suspects.map((s) => [s.feature, s.reason]),
    [['f_gone', 'missing']],
    'suspects 是派生视图：只报不删，且 reason 是闭集里的 kind',
  );
  assert.equal(projectRootOf('f_gone'), normRoot(gone), '登记了但不可达 ⇒ **仍返回登记里的根**（可达性是另一件事）');
  assert.equal(projectRootOf('从来没登记过'), null, '只有"没登记"才是 null');
});

test('C2 写端只落一次 resolve：chdir 到别处后 registerFeature(".") 落盘是绝对路径且活着', () => {
  useHome('c2');
  const cwd = tmp('c2-cwd');
  const prev = process.cwd();
  try {
    process.chdir(cwd);
    const r = registerFeature('f_rel', '.', 'test');
    assert.equal(r.changed, true);
    assert.equal(path.isAbsolute(r.entry.project_root), true, `落盘必须是绝对路径，实际 ${r.entry.project_root}`);
    const raw = fs.readFileSync(registryFile(), 'utf8');
    assert.equal(/"project_root"\s*:\s*"\."/.test(raw), false, '原始的 "." 不许进册');
    assert.deepEqual(Object.keys(readRegistry().features), ['f_rel'], '下一次读不许把它判坏剪掉');
    assert.equal(projectRootOf('f_rel'), normRoot(cwd), '读回来必须是同一个绝对根');
  } finally {
    process.chdir(prev);
  }
});

test('C3 两 query 都不许整屏抛：不可达/没登记 ⇒ 不抛 · 不建目录 · 按 0 条计 + 一句诊断', () => {
  const home = useHome('c3');
  // ① 册在地（数据仓旧目录），但注册表里没有它的根 —— 改前 overview 走 queryTaskHistory 直接把整屏打挂
  const legacyDir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'f_legacy.dsl.json'),
    `${JSON.stringify({ feature: 'f_legacy', geometry: { nodes: [], edges: [] }, semantic: { files: [] }, todos: [] })}\n`,
  );
  let n = -1;
  let rows = -1;
  const err = captureStderr(() => {
    n = countTaskHistory('f_legacy');
    rows = queryTaskHistory({ feature: 'f_legacy' }).rows.length;
  });
  assert.equal(n, 0, '没登记 ⇒ 按 0 条计（不抛）');
  assert.equal(rows, 0);
  assert.match(err, /f_legacy/, '「读不到」与「真没有」必须可区分 ⇒ 要给诊断');

  // ② 登记了但根不可达 ⇒ 既不抛，也**不许**在死根上 mkdirSync(recursive) 重建目录树
  const ghost = path.join(os.tmpdir(), 'agentio-reg-c3-ghost-应当不被创建');
  registerFeature('f_ghost', ghost, 'test');
  assert.equal(fs.existsSync(ghost), false, '前提：根不存在');
  captureStderr(() => {
    countTaskHistory();
    queryTaskHistory({ feature: 'f_ghost' });
  });
  assert.equal(fs.existsSync(ghost), false, '总账/查询**不许**把幽灵目录建出来（改前靠"剪"才没建）');

  // ③ 写端（建库）仍然严格：不可达就抛，且说清是"目录不在"而不是"没有库"
  assert.throws(() => openTasksDb(ghost), /不可达/, '写端不许静默在死根上建库');
  assert.equal(fs.existsSync(ghost), false);
});

test('C4 坏**文件** ⇒ 抛（含绝对路径 + 形状 + 三条救法）；坏**条目** ⇒ 只进 suspects，两者分得开', () => {
  useHome('c4');
  const file = registryFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const [raw, why] of [
    ['{"version":1,"features":{  << 这不是 JSON', /JSON 解析失败/],
    ['[1,2,3]', /顶层必须是对象/],
    ['{"version":1,"features":[]}', /features 必须是对象/],
    ['{"version":"1","features":{}}', /version 必须是数字/],
  ] as const) {
    fs.writeFileSync(file, raw, 'utf8');
    assert.throws(
      () => readRegistry(),
      (e: Error) => {
        assert.match(e.message, why, '形状错在哪要说清');
        assert.ok(e.message.includes(file), '报文必须含文件**绝对路径**');
        assert.match(e.message, /git checkout/, '救法①');
        assert.match(e.message, /snapshots|\.bak-/, '救法②');
        assert.match(e.message, /"version":1,"features":\{\}/, '救法③：最小合法形状');
        return true;
      },
      '坏文件**不许**返回 {}（那会把"读失败"变成"没有"）',
    );
  }

  // ★ 对照：坏**条目**（project_root 不是绝对路径）**不抛**，只进 suspects
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, features: { f_bad: { project_root: './rel' } } })}\n`, 'utf8');
  const chk = captureStderr(() => readRegistryChecked());
  assert.equal(typeof chk, 'string', '坏条目不许抛错');
  assert.deepEqual(
    readRegistryChecked().suspects.map((s) => [s.feature, s.reason]),
    [['f_bad', 'relative']],
    '坏条目 ⇒ 走 suspect（relative），与"文件坏 ⇒ 抛"分得开',
  );
});

test('⑤ unregisterFeature 是唯一删除出口：空理由拒 · 删了留日志 · 没这条登记⇒幂等 false', () => {
  useHome('u5');
  const live = tmp('u5-live');
  registerFeature('f_del', live, 'test');
  assert.throws(() => unregisterFeature('f_del', '   '), /理由/, '说不出为什么的删除 = 猜 ⇒ 拒');
  assert.equal(Object.keys(readRegistry().features).includes('f_del'), true, '被拒时登记必须还在（原子性）');

  const r = unregisterFeature('f_del', '不可达 + 不是本项目根（测试夹具）', 'test');
  assert.equal(r.removed, true);
  assert.equal(Object.keys(readRegistry().features).includes('f_del'), false);
  const logFile = r.log_file ?? '';
  assert.ok(logFile && fs.existsSync(logFile), '注销必须留审计日志');
  const line = JSON.parse(fs.readFileSync(logFile, 'utf8').trim().split('\n').at(-1) ?? '{}');
  assert.equal(line.feature, 'f_del');
  assert.match(String(line.reason), /不是本项目根/, '理由要原样落库（可考古）');

  assert.equal(unregisterFeature('f_del', '再来一次').removed, false, '幂等：没这条登记 ⇒ removed:false，不是错误');
});

test('① .tmp 名带 pid：固定 `${file}.tmp` 不再存在（两进程并发写同一本册不许互相踩）', () => {
  useHome('c6');
  const target = registryFile();
  const seen: string[] = [];
  const orig = fs.writeFileSync;
  (fs as unknown as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    seen.push(String(p));
    return (orig as unknown as (...a: unknown[]) => void)(p, ...rest);
  }) as typeof fs.writeFileSync;
  try {
    writeRegistry({ version: 1, features: {} });
  } finally {
    (fs as unknown as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = orig;
  }
  assert.deepEqual(seen, [tmpPathFor(target)], 'tmp 路径必须经 tmpPathFor（唯一写法处）');
  assert.equal(seen[0], `${target}.tmp-${process.pid}`, 'tmp 名必须带 pid');
  assert.notEqual(seen[0], `${target}.tmp`, '固定 tmp 名两进程并发会撞（同族写法见 storage.ts 的 .tmp-<pid>）');
  assert.equal(fs.existsSync(`${target}.tmp`), false, '不许留下固定名的残留');
});

test('⑥ registry_repair.mjs：默认 dry-run 不写盘；判据是「不可达 / 在系统临时目录下」而不是名字或时间', () => {
  const home = useHome('r7');
  const fixture = tmp('r7-fixture'); // 在 os.tmpdir() 之下 ⇒ 临时夹具根（候选）
  const gone = path.join(os.tmpdir(), 'agentio-reg-r7-gone');
  registerFeature('fx_temp', fixture, 'test');
  registerFeature('fx_gone', gone, 'test');
  registerFeature('fx_real', ROOT, 'test'); // 真实项目根（存在且不在临时目录）⇒ 必须保留
  const file = registryFile();
  assert.equal(fs.existsSync(gone), false, '前提：fx_gone 的根不存在');

  const before = { sha: sha(file), mtime: mtime(file) };
  const run = (args: string[]) =>
    spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'registry_repair.mjs'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: false,
      env: { ...process.env },
    });

  const dry = run([]);
  assert.equal(dry.status, 0, `dry-run 必须成功退出：${dry.stdout}${dry.stderr}`);
  // ★ 剥 ANSI 再判：脚本给人读时带颜色，判据不该因此变成"看颜色字面量"
  const plain = `${dry.stdout}${dry.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, /候选 fx_temp/, '临时夹具根要进候选');
  assert.match(plain, /候选 fx_gone/, '不可达的要进候选');
  assert.match(plain, /保留 fx_real/, '真实项目根必须保留（不许按名字/时间乱删）');
  assert.equal(sha(file), before.sha, 'dry-run **一个字节都不许写**');
  assert.equal(mtime(file), before.mtime);

  // ★ --apply 才真删：两条候选消失、fx_real 留着、且理由落审计日志
  const applied = run(['--apply']);
  assert.equal(applied.status, 0, `--apply 必须成功退出：${applied.stdout}${applied.stderr}`);
  const keys = Object.keys(readRegistry().features);
  assert.deepEqual(keys, ['fx_real'], `候选应被注销、真实根应保留，实际 ${JSON.stringify(keys)}`);
  const logFile = path.join(home, '.agent-io', 'projects.unregister.jsonl');
  assert.ok(fs.existsSync(logFile), '删除必须留审计日志');
  assert.match(fs.readFileSync(logFile, 'utf8'), /不是本项目根|不可达/, '删除理由要能考古');
});
