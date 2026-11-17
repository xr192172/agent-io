/**
 * P1 · **tsc 增量缓存的分键**（增量化第一批 · 项 2 的检测点）
 *
 * ## 它挡的事故（普查项 2）
 * `tsconfig.json` 里早有 `incremental: true` + `tsBuildInfoFile: ./node_modules/.cache/tsbuildinfo.json`，
 * 但那个缓存键**不含 tsconfig 内容、也不含 tsc 版本**，而且**主配置与契约配置共用同一个文件**
 * （`tsconfig.contract.json` 是 `extends` 关系 ⇒ 继承同一个路径）。
 * 后果：改了 tsconfig / 换了 tsc / 换了一份配置，都可能**复用别人的增量状态**；缓存还住在
 * `node_modules/.cache` 里（`npm install` / `prune` 顺手能清掉，位置也不受本仓的目录纪律管）。
 *
 * ## 判据（本文件判的是**可判的事实**：缓存键 + 命令行；★ 不 spawn tsc）
 * · R1 同一份配置连问两次 ⇒ 同一个路径；路径在 `.agent-io/scratch/tsbuildinfo/` 下、名字带 tsc 版本
 * · R2 配置**改一字节** ⇒ 文件名里的配置哈希变（跨 tsconfig 复用被掐断）
 * · R3 主配置与 `tsconfig.contract.json` ⇒ **不同文件**（同源风险：它们本是一家人，最容易共用）
 * · R4 `extends` 链也进哈希：改父配置 ⇒ **子配置**的键也变（否则"只改主 tsconfig"这一手会漏）
 * · R5 损坏的 tsbuildinfo ⇒ `tscIncrementalArgs` **先删再跑**（响应式，不假绿）
 * · R6 总门 `ts 类型` 的命令行**真的**带 `--incremental --tsBuildInfoFile <R1 那个路径>`，且
 *   `npm run typecheck` / `npm run contract` 走的是**同一个** `tsGate`（一处权威，两个入口）
 *
 * ## 为什么不 spawn tsc
 * 那是总门「ts 类型」的活；在本用例里再跑一遍（~7s 冷 / ~2.4s 热）只会让测试门变慢，且读数易抖。
 * 增量**命中率**是实测读数（见本卡自述：冷 7.4s → 热 2.4s；主/契约交替跑不再互相作废），
 * 本文件只钉"键与命令"这两处**结构性**事实 —— 如实标注，不冒充命中率断言。
 *
 * ## 消融口径（改坏实现时哪条红）
 * · 缓存名回退成固定串（`tsbuildinfo.json`） ⇒ R1/R2/R3/R4 全红
 * · 只哈希"本文件"、不跟 `extends` ⇒ R4 红
 * · 名字里去掉 tsc 版本 ⇒ R1 红（断言里点着版本）
 * · 损坏文件不删（或直接抛） ⇒ R5 红
 * · `tsGate` 又回退成裸 `['--noEmit']`，或 package.json 又绕开 verify.mjs 直接调 tsc ⇒ R6 红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type VerifyModule = {
  tscIncremental: (root?: string, configRel?: string) => { file: string; cfgHash: string; tscVersion: string };
  tscIncrementalArgs: (root?: string, configRel?: string) => string[];
  tsGate: (root?: string, configRel?: string) => { cmd?: string; args?: string[]; name: string; fail?: string };
  TS_BUILDINFO_DIR: string;
};
/** ★ `scripts/verify.mjs` 有入口守卫（`samePath(argv[1], import.meta.url)`）⇒ import 只拿导出、不跑门 */
const V = (await import('../scripts/verify.mjs')) as unknown as VerifyModule;

/** 装着 node_modules 的那棵树（`typescript` 要能被 `createRequire` 逐级上溯解析到） */
const TSC_VERSION = (
  JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules', 'typescript', 'package.json'), 'utf8')) as { version: string }
).version;

/** 夹具根：**必须在仓内**（`tscApiOf` 用 `createRequire(<root>/package.json)` 找 typescript） */
function makeRoot(tag: string): string {
  const root = path.join(REPO, '.agent-io', `gate-fixture-tsc-${tag}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  // 两份配置**原样**拷（内容即被测对象：哈希必须随它们变）
  for (const f of ['tsconfig.json', 'tsconfig.contract.json']) {
    fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  }
  return root;
}

function rmRf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 });
  } catch {
    /* 删不掉不影响判定 */
  }
}

test('R1 同一份配置连问两次 ⇒ 同一路径；落点/命名可读（scratch 下、带 tsc 版本）', () => {
  const root = makeRoot('shape');
  try {
    const a = V.tscIncremental(root, 'tsconfig.json');
    const b = V.tscIncremental(root, 'tsconfig.json');
    assert.equal(a.file, b.file, '同一份配置连问两次必须给出同一个 buildinfo 路径（否则每轮都冷跑）');
    const rel = path.relative(root, a.file).split(path.sep).join('/');
    assert.equal(
      path.posix.dirname(rel),
      V.TS_BUILDINFO_DIR,
      `buildinfo 必须落在 ${V.TS_BUILDINFO_DIR}/（.gitignore 的 .agent-io/* 已覆盖；不进 node_modules）`,
    );
    assert.match(path.basename(a.file), /^tsconfig\.[0-9a-f]{12}\.tsc-.+\.tsbuildinfo$/, `文件名形状不对：${path.basename(a.file)}`);
    assert.ok(
      path.basename(a.file).includes(`tsc-${TSC_VERSION}`),
      `文件名必须带 tsc 版本（跨版本复用 = 拿别人的脑内状态判今天的代码）：期望含 tsc-${TSC_VERSION}，实际 ${path.basename(a.file)}`,
    );
    assert.equal(a.tscVersion, TSC_VERSION, 'tscVersion 必须是**这棵树**里那份 typescript 的版本');
  } finally {
    rmRf(root);
  }
});

test('R2 配置改**一字节** ⇒ 配置哈希变（缓存键跟着换）', () => {
  const root = makeRoot('byte');
  try {
    const before = V.tscIncremental(root, 'tsconfig.json');
    const file = path.join(root, 'tsconfig.json');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\n`, 'utf8'); // 只多一个换行
    const after = V.tscIncremental(root, 'tsconfig.json');
    assert.notEqual(after.cfgHash, before.cfgHash, '改一字节后配置哈希必须变（否则改 tsconfig 会复用旧增量状态）');
    assert.notEqual(after.file, before.file, '哈希变了 ⇒ 文件名必须跟着变');
    assert.equal(after.file, V.tscIncremental(root, 'tsconfig.json').file, '新键自身仍必须稳定（两次一致）');
  } finally {
    rmRf(root);
  }
});

test('R3 主配置与契约配置的 tsbuildinfo **不同名**（同源风险最高的一对）', () => {
  const root = makeRoot('pair');
  try {
    const main = V.tscIncremental(root, 'tsconfig.json');
    const contract = V.tscIncremental(root, 'tsconfig.contract.json');
    assert.notEqual(contract.file, main.file, '主配置与契约配置**不许共用一个 buildinfo**（它们 extends 同源，最容易撞）');
    assert.notEqual(contract.cfgHash, main.cfgHash, '两份配置的内容不同 ⇒ 哈希也必须不同');
    assert.match(path.basename(contract.file), /^tsconfig\.contract\.[0-9a-f]{12}\.tsc-.+\.tsbuildinfo$/, '契约配置的文件名要能一眼认出');
  } finally {
    rmRf(root);
  }
});

test('R4 `extends` 链进哈希：改父配置 ⇒ 子配置的键也变', () => {
  const root = makeRoot('extends');
  try {
    const before = V.tscIncremental(root, 'tsconfig.contract.json');
    const parent = path.join(root, 'tsconfig.json');
    // ★ 只改**父**配置（契约配置自己一个字节不动）
    fs.writeFileSync(parent, fs.readFileSync(parent, 'utf8').replace('"strict": true', '"strict": true  '), 'utf8');
    const after = V.tscIncremental(root, 'tsconfig.contract.json');
    assert.notEqual(
      after.cfgHash,
      before.cfgHash,
      '契约配置 extends 主 tsconfig ⇒ 父配置变了它的增量状态也必须失效（只哈希"本文件"就会漏这一手）',
    );
  } finally {
    rmRf(root);
  }
});

test('R5 损坏的 tsbuildinfo ⇒ 先删再跑（响应式，不假绿）', () => {
  const root = makeRoot('corrupt');
  try {
    // 先建出目录（`tscIncrementalArgs` 会 mkdir）
    const args = V.tscIncrementalArgs(root, 'tsconfig.json');
    const flagAt = args.indexOf('--tsBuildInfoFile');
    assert.ok(flagAt >= 0, `命令行里必须有 --tsBuildInfoFile（实际：${JSON.stringify(args)}）`);
    assert.equal(args[flagAt - 1], '--incremental', '`--tsBuildInfoFile` 必须紧跟 `--incremental`（成对出现）');
    const bi = args[flagAt + 1];
    assert.ok(path.isAbsolute(bi), `--tsBuildInfoFile 必须是绝对路径（不受 cwd 影响）：${bi}`);

    // 写坏它（不是 JSON）⇒ 下一次必须删掉并重建键（而不是带着坏文件跑）
    fs.writeFileSync(bi, 'not-json-garbage', 'utf8');
    const args2 = V.tscIncrementalArgs(root, 'tsconfig.json');
    assert.deepEqual(args2, args, '键本身不该因为内容坏了而变化（坏文件是内容问题，不是键问题）');
    assert.ok(!fs.existsSync(bi), '★ 损坏的 buildinfo 必须被删掉（留着一个坏文件会让"这轮为什么慢"无从解释）');
  } finally {
    rmRf(root);
  }
});

test('R6 总门 `ts 类型` 的命令行带增量旗标，且 typecheck/contract 走同一个 tsGate（一处权威）', () => {
  const g = V.tsGate(REPO);
  assert.equal(g.name, 'ts 类型', '门名变了（READOUT_ANCHORS / GUIDE-GATE 的门表都认这个名字）');
  assert.equal(g.fail, undefined, `tsGate 不该在总门构造期就注定失败（本机 typescript 在）：${String(g.fail)}`);
  const args = g.args ?? [];
  assert.ok(args.includes('--noEmit'), `门语义不变的前提：诊断仍全量报（--noEmit 必须在）：${JSON.stringify(args)}`);
  assert.ok(args.includes('--incremental'), `ts 门没有开增量：${JSON.stringify(args)}`);
  const bi = args[args.indexOf('--tsBuildInfoFile') + 1];
  assert.equal(bi, V.tscIncremental(REPO, 'tsconfig.json').file, '门里的 buildinfo 路径必须就是 R1 那套现算出来的那个');
  // ★ `--project` 让"编的是哪份配置"在命令行里看得见（改前靠 cwd 默认值，读端只能猜）
  assert.ok(args.includes('--project'), `门命令行里没有 --project（配置来源不可见）：${JSON.stringify(args)}`);

  // 两个 npm 入口必须落在**同一个** tsGate 上（不然内环敲的那一行与门里跑的不是同一件事）
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.typecheck ?? '', /verify\.mjs --typecheck$/, `typecheck 必须走 verify.mjs --typecheck：${pkg.scripts.typecheck}`);
  assert.match(
    pkg.scripts.contract ?? '',
    /verify\.mjs --typecheck --project tsconfig\.contract\.json$/,
    `contract 必须走同一个入口（只是换了配置）：${pkg.scripts.contract}`,
  );
});
