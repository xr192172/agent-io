#!/usr/bin/env node
/**
 * t357 验收（临时夹具，不进仓）：refactor_pipeline 落盘前的写闸
 *
 * 口径：**CLI 冷进程真跑**（每次 `spawnSync(node, cli.js refactor_pipeline --json …)`），
 *  夹具根 / AGENT_IO_HOME 每个用例各一份 ⇒ md5 对比与"有没有 rename"不被上个用例污染。
 *
 * 判据（对应用户给的五条）：
 *   ① 无 authorize、文件无卡 ⇒ 拒；磁盘 md5 前后一致；无 rename 发生
 *   ② 有 authorize 覆盖本批 + anchor 卡 owner=actor ⇒ 放行；note 点名 scope
 *   ③ 有 authorize 但本批 1 个文件不在 scope ⇒ 拒，且**只点名那一个**
 *   ④ moves 的**目标路径**也在判定集里（from 有卡、to 无卡 ⇒ 拒，点名 to）
 *   ⑤ 正常路径（卡 + authorize）⇒ 能写、能 rename、索引写穿仍在终态之后
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = 'D:/project_develop/design-canvas';
const CLI = path.join(REPO, 'dist/src/presentation/cli/cli.js');
const LABS = 'D:/project_develop/_design-canvas-labs';
const TMP = fs.mkdtempSync(path.join(LABS, '.tmp-t357-'));

const { saveDSL } = await import(pathToFileURL(path.join(REPO, 'dist/src/infrastructure/storage.js')).href);

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const NL = String.fromCharCode(10);

// ── 夹具：项目树 ─────────────────────────────────────────
const SRC = {
  'package.json': '{\n  "name": "t357fixture",\n  "version": "1.0.0"\n}\n',
  'go.mod': 'module example.com/fix\n\ngo 1.21\n',
  'src/a.ts': "import { x } from './x';\n\nexport const a = 1;\n",
  'src/x.ts': 'export const x = 1;\n',
  'src/b.ts': "import { x } from './x';\n\nexport const b = 2;\n",
  'internal/hub/v2/thing.go': 'package v2\n\nfunc Thing() int { return 1 }\n',
  'internal/use/use.go':
    'package use\n\nimport "example.com/fix/internal/hub/v2"\n\nfunc Use() int { return v2.Thing() }\n',
};

const card = (owner) => ({
  id: `card_${owner}`,
  summary: `t357 夹具：${owner} 领的卡`,
  expectations: [],
  state: 'claimed',
  owner,
  claimed_at: '2026-10-20T00:00:00.000Z',
});

function makeCase(name, nodes, semanticFiles, opts = {}) {
  const root = path.join(TMP, name, 'root');
  const home = path.join(TMP, name, 'home');
  fs.mkdirSync(home, { recursive: true });
  for (const [rel, body] of Object.entries(SRC)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf-8');
  }
  process.env.AGENT_IO_HOME = home; // ★ 每次用例换 home（storage 在调用时读 env）
  const feature = `t357${name.toLowerCase()}`;
  // ★ 可选：先真建一份索引（这样 `syncSelfWrites` 会真跑，`index_note` 才有读数可看）。
  //   ★ 顺序必须是「先 import_project 建索引 → 再 saveDSL 覆盖成夹具设计」：
  //     import_project 会**重写**该 feature 的设计 DSL ⇒ 反过来做会把夹具的卡冲掉。
  if (opts.index) {
    const imp = spawnSync(
      process.execPath,
      [CLI, 'import_project', '--json', JSON.stringify({ project_dir: root, feature })],
      { env: { ...process.env, AGENT_IO_HOME: home }, encoding: 'utf-8', cwd: root },
    );
    if (imp.status !== 0) throw new Error(`import_project 建夹具索引失败：${imp.stdout}${imp.stderr}`);
  }
  saveDSL({
    id: `feature_${feature}`,
    type: 'feature_diagram',
    feature,
    version: '1.0.0',
    title: feature,
    source_root: root,
    geometry: { layout: 'free', width: 400, height: 300, edges: [], nodes },
    semantic: { files: semanticFiles ?? [] },
    layers: {},
    annotations: [],
  });
  return { root, home, feature };
}

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const md5Of = (root, rels) =>
  Object.fromEntries(rels.map((r) => [r, fs.existsSync(path.join(root, r)) ? md5(path.join(root, r)) : '(absent)']));

function runPipeline(root, home, args) {
  const env = { ...process.env, AGENT_IO_HOME: home, AGENT_IO_PROJECT_DIR: root };
  delete env.AGENT_IO_ACTOR; // ★ 不许靠环境变量兜底身份（要的是"调用方没给"那一格）
  const r = spawnSync(
    process.execPath,
    [CLI, 'refactor_pipeline', '--json', JSON.stringify({ project_dir: root, ...args })],
    { env, encoding: 'utf-8', cwd: root },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  let data = null;
  const marker = '---DATA---';
  const i = out.indexOf(marker);
  if (i >= 0) {
    const tail = out.slice(i + marker.length).replace(/^\r?\n/, '');
    // ★ DATA 是**单行** JSON，其后还可能跟"下一棒 / WARNINGS"等文本块 ⇒ 只取第一行，别贪。
    const first = tail.split(NL).find((l) => l.trim().startsWith('{'));
    try {
      data = first ? JSON.parse(first.trim()) : null;
    } catch {
      data = null;
    }
  }
  return { code: r.status, out, data };
}
const activeStage = (r) => r.data?.stages?.filter((s) => s.outcome !== 'skipped').at(-1);

const MIGRATE = {
  enabled: true,
  moduleBase: 'example.com/fix',
  prefix: 'internal/hub/v2',
  to: 'internal/hub',
  packageRename: { from: 'v2', to: 'hub' },
};
const DEAD_IMPORTS = { enabled: true, dead: [{ source: './x', files: ['src/a.ts', 'src/b.ts'] }] };
// ★ 真跑一条**权威**验证命令（noop）：这样终态是 `applied` 而不是 `not_verifiable`，
//   回执里才同时有「改后验证通过 + 闸放行 + 索引写穿」三件事，能证明顺序。
const VERIFY = { commands: [{ label: 'noop', cmd: process.execPath, args: ['-e', '0'], timeoutMs: 60000 }] };
const MOVED = ['internal/use/use.go', 'internal/hub/thing.go', 'internal/hub/v2/thing.go'];

// ════════════════════════════════════════════════════════════
console.log('════ ① 无 authorize、文件无卡 ⇒ 拒；md5 不变；无 rename ════');
{
  const c = makeCase(
    'case1',
    [
      { id: 'n_use', type: 'file', label: 'use.go', path: 'internal/use/use.go' }, // 无 task
      { id: 'n_old', type: 'file', label: 'v2/thing.go', path: 'internal/hub/v2/thing.go' },
    ],
    [{ id: 'n_use', path: 'internal/use/use.go', responsibility: 'fixture' }],
  );
  const before = md5Of(c.root, MOVED);
  const r = runPipeline(c.root, c.home, { steps: { package_migration: MIGRATE } });
  const after = md5Of(c.root, MOVED);
  chk(
    r.code !== 0 && /拒绝落盘（任务闸）/.test(r.out),
    '①a 冷进程退非 0，回执是**拒绝落盘（任务闸）**',
    `exit=${r.code} · ${r.out.split(NL).filter((l) => /拒绝落盘/.test(l))[0] ?? ''}`,
  );
  chk(JSON.stringify(before) === JSON.stringify(after), '①b 磁盘 md5 **前后完全一致**', JSON.stringify(after));
  chk(
    fs.existsSync(path.join(c.root, 'internal/hub/v2/thing.go')) &&
      !fs.existsSync(path.join(c.root, 'internal/hub/thing.go')),
    '①c **没有发生 rename**（from 还在、to 不存在 —— 闸在 mkdir/rename 之前）',
    `v2/thing.go=${fs.existsSync(path.join(c.root, 'internal/hub/v2/thing.go'))} hub/thing.go=${fs.existsSync(
      path.join(c.root, 'internal/hub/thing.go'),
    )}`,
  );
  chk(
    /internal\/use\/use\.go/.test(r.out) && /没有挂到任何已领取的任务上/.test(r.out),
    '①d 拒绝信息点名了那个无卡文件',
    (r.out.match(/· .*use\.go.*/) ?? [''])[0],
  );
}

// ════════════════════════════════════════════════════════════
console.log(`${NL}════ ② authorize 覆盖本批 + anchor 卡 owner=actor ⇒ 放行；note 点名 scope ════`);
{
  const c = makeCase(
    'case2',
    [
      { id: 'n_use', type: 'file', label: 'use.go', path: 'internal/use/use.go', task: card('me') },
      { id: 'n_old', type: 'file', label: 'v2/thing.go', path: 'internal/hub/v2/thing.go' },
      { id: 'n_new', type: 'file', label: 'hub/thing.go', path: 'internal/hub/thing.go' },
    ],
    [{ id: 'n_use', path: 'internal/use/use.go', responsibility: 'fixture' }],
  );
  const scope = 'nodes:n_old,n_new,n_use';
  const r = runPipeline(c.root, c.home, {
    steps: { package_migration: MIGRATE },
    verify: VERIFY,
    actor: 'me',
    authorize: scope,
  });
  const stage = activeStage(r);
  chk(r.code === 0 && stage?.outcome === 'applied', '②a 放行并 applied', `exit=${r.code} outcome=${stage?.outcome}`);
  chk(
    /按 run 授权放行/.test(String(stage?.task_gate ?? '')),
    '②b `task_gate` 带出授权读数',
    String(stage?.task_gate ?? '').split(NL)[0],
  );
  chk(
    // ★ scope 文本被闸**规范化排序**过（n_new,n_old,n_use）⇒ 按节点逐个核，不押原串顺序
    /按 run 授权放行（`authorize='nodes:/.test(String(stage?.task_gate ?? '')) &&
      ['n_old', 'n_new', 'n_use'].every((id) => String(stage?.task_gate ?? '').includes(id)) &&
      /anchor 卡 = 节点 n_use/.test(String(stage?.task_gate ?? '')),
    '②c note **点名 scope 与 anchor 卡**',
    String(stage?.task_gate ?? '').split(NL)[0],
  );
  chk(/★ 任务闸：按 run 授权放行/.test(r.out), '②d 人读面（CLI 文本）也打印了这句话', (r.out.match(/★ 任务闸：.*/) ?? [''])[0]);
  chk(fs.existsSync(path.join(c.root, 'internal/hub/thing.go')), '②e 真 rename 到位（hub/thing.go 存在）');
}

// ════════════════════════════════════════════════════════════
console.log(`${NL}════ ③ authorize 覆盖但本批 1 个不在 scope ⇒ 拒，只点名那一个 ════`);
{
  const c = makeCase(
    'case3',
    [
      { id: 'n_a', type: 'file', label: 'a.ts', path: 'src/a.ts', task: card('me') },
      { id: 'n_b', type: 'file', label: 'b.ts', path: 'src/b.ts' }, // 无卡
    ],
    [
      { id: 'n_a', path: 'src/a.ts', responsibility: 'fixture' },
      { id: 'n_b', path: 'src/b.ts', responsibility: 'fixture' },
    ],
  );
  const before = md5Of(c.root, ['src/a.ts', 'src/b.ts']);
  const r = runPipeline(c.root, c.home, { steps: { dead_imports: DEAD_IMPORTS }, actor: 'me', authorize: 'nodes:n_a' });
  const after = md5Of(c.root, ['src/a.ts', 'src/b.ts']);
  chk(r.code !== 0 && /拒绝落盘（任务闸）/.test(r.out), '③a 拒（退非 0）', `exit=${r.code}`);
  chk(
    /没能覆盖本批/.test(r.out) && /不在 scope 内/.test(r.out) && /src\/b\.ts/.test(r.out),
    '③b 拒绝信息**点名了 scope 外的那一个**（src/b.ts）',
    (r.out.match(/本批有 .*不在 scope 内.*/) ?? [''])[0],
  );
  const named = (r.out.match(/^ {2}· (\S+)\s+⇒/gim) ?? []).map((s) => s.trim());
  chk(named.length === 1 && named[0].includes('src/b.ts'), '③c 逐文件判定里**只有 1 条**（a.ts 没被连坐）', JSON.stringify(named));
  chk(JSON.stringify(before) === JSON.stringify(after), '③d 两个文件都没被写（md5 一致）');
}

// ════════════════════════════════════════════════════════════
console.log(`${NL}════ ④ moves 的**目标路径**也在判定集：from 有卡、to 无卡 ⇒ 拒（点名 to）════`);
{
  const c = makeCase(
    'case4',
    [
      { id: 'n_old', type: 'file', label: 'v2/thing.go', path: 'internal/hub/v2/thing.go', task: card('me') },
      { id: 'n_use', type: 'file', label: 'use.go', path: 'internal/use/use.go', task: card('me') },
      { id: 'n_new', type: 'file', label: 'hub/thing.go', path: 'internal/hub/thing.go' }, // ★ 只有 to 没卡
    ],
    [
      { id: 'n_old', path: 'internal/hub/v2/thing.go', responsibility: 'fixture' },
      { id: 'n_use', path: 'internal/use/use.go', responsibility: 'fixture' },
      { id: 'n_new', path: 'internal/hub/thing.go', responsibility: 'fixture' },
    ],
  );
  const r = runPipeline(c.root, c.home, { steps: { package_migration: MIGRATE }, actor: 'me' });
  chk(r.code !== 0 && /拒绝落盘（任务闸）/.test(r.out), '④a 拒（不给 authorize ⇒ 逐文件判定）', `exit=${r.code}`);
  chk(
    /internal\/hub\/thing\.go/.test(r.out) && /都没有 claimed 的任务卡/.test(r.out),
    '④b 点名的是**目标路径** internal/hub/thing.go',
    (r.out.match(/· .*hub\/thing\.go.*/) ?? [''])[0],
  );
  const pointed = (r.out.match(/^ {2}· (\S+)\s+⇒/gim) ?? []).map((s) => s.trim().split(/\s+/)[1]);
  chk(
    pointed.includes('internal/hub/thing.go') &&
      !pointed.includes('internal/hub/v2/thing.go') &&
      !pointed.includes('internal/use/use.go'),
    '④c 只点 to（from / use.go 有卡，没被误伤）',
    JSON.stringify(pointed),
  );
  chk(!fs.existsSync(path.join(c.root, 'internal/hub/thing.go')), '④d 没 rename（to 仍不存在）');
}

// ════════════════════════════════════════════════════════════
console.log(`${NL}════ ⑤ 正常路径：卡 + authorize ⇒ 能写、能 rename、索引写穿仍在终态之后 ════`);
{
  const c = makeCase(
    'case5',
    [
      { id: 'n_old', type: 'file', label: 'v2/thing.go', path: 'internal/hub/v2/thing.go', task: card('me') },
      { id: 'n_use', type: 'file', label: 'use.go', path: 'internal/use/use.go', task: card('me') },
      { id: 'n_new', type: 'file', label: 'hub/thing.go', path: 'internal/hub/thing.go', task: card('me') },
    ],
    [
      { id: 'n_old', path: 'internal/hub/v2/thing.go', responsibility: 'fixture' },
      { id: 'n_use', path: 'internal/use/use.go', responsibility: 'fixture' },
      { id: 'n_new', path: 'internal/hub/thing.go', responsibility: 'fixture' },
    ],
    { index: true },
  );
  const r = runPipeline(c.root, c.home, {
    steps: { package_migration: MIGRATE },
    verify: VERIFY,
    actor: 'me',
    authorize: 'nodes:n_old,n_new,n_use',
  });
  const stage = activeStage(r);
  chk(r.code === 0 && stage?.outcome === 'applied', '⑤a applied（退 0）', `exit=${r.code} outcome=${stage?.outcome}`);
  chk(
    fs.existsSync(path.join(c.root, 'internal/hub/thing.go')) && !fs.existsSync(path.join(c.root, 'internal/hub/v2/thing.go')),
    '⑤b 真 rename：hub/thing.go 在、v2/thing.go 已不在',
  );
  const useGo = fs.readFileSync(path.join(c.root, 'internal/use/use.go'), 'utf-8');
  const thingGo = fs.readFileSync(path.join(c.root, 'internal/hub/thing.go'), 'utf-8');
  chk(
    /example\.com\/fix\/internal\/hub"/.test(useGo) && /^package hub$/m.test(thingGo),
    '⑤c 内容也真写了（import 前缀 + package 声明）',
    `${useGo.split(NL)[2] ?? ''} | ${thingGo.split(NL)[0]}`,
  );
  chk(
    /索引写穿：同步/.test(String(stage?.index_note ?? '')),
    '⑤d 索引写穿**真跑了**（stage.index_note = 同步 N 文件 —— 它在该步**终态**才执行）',
    String(stage?.index_note ?? '（无）'),
  );

  // ★ 顺序证据（静态）：`syncSelfWrites` 只许在 `finalize` 里调一次，且 finalize 在落盘之后
  const lines = fs.readFileSync(path.join(REPO, 'src/application/refactor/pipeline/refactor_pipeline.ts'), 'utf-8').split(NL);
  const callSites = lines.map((l, i) => ({ l, i: i + 1 })).filter((x) => /await syncSelfWrites\(/.test(x.l));
  const finalizeLine = lines.findIndex((l) => /const finalize = async/.test(l)) + 1;
  const firstWrite = lines.findIndex((l) => /fs\.renameSync\(m\.from, m\.to\)/.test(l)) + 1;
  const gateLine = lines.findIndex((l) => /assertSourceWriteRegisteredFor\(proj/.test(l)) + 1;
  chk(
    callSites.length === 1 && callSites[0].i > finalizeLine && finalizeLine > firstWrite,
    '⑤e `syncSelfWrites` **只有 1 处**，且在 `finalize`（终态）内、finalize 在写之后',
    `syncSelfWrites@${callSites.map((x) => x.i).join(',')} finalize@${finalizeLine} rename@${firstWrite}`,
  );
  chk(gateLine > 0 && gateLine < firstWrite, '⑤f 闸的调用行**在第一次 rename 之前**', `gate@${gateLine} rename@${firstWrite}`);
}

console.log(`${NL}════ 汇总：PASS ${P} · FAIL ${F} ════`);
console.log(`夹具目录：${TMP}`);
process.exit(F === 0 ? 0 : 1);
