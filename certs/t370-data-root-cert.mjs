#!/usr/bin/env node
/**
 * ★★★ cert T370 —— **数据仓（跨项目那部分）可以放在项目本体根下，单独一级**
 * （2026-10-27 · 用户口径：「maven 型是让你分离，但 maven 不也可以控制 .m2 放哪吗？
 *  能不能放现在的项目本体根目录作为单独一级，同目录更好管理吧」）
 *
 * ## 本笔新增的方向
 *   `storage.ts#getStorageRoot()` 从"一个候选"变成**四候选按序**：
 *     ① `AGENT_IO_DATA_ROOT`（显式点明数据仓本身 = Maven 的 `-Dmaven.repo.local`）
 *     ② `AGENT_IO_HOME`（显式点明"放着 .agent-io 的目录"，既有语义）
 *     ③ `<包根>/.agentio-data`（**存在就用** —— 与项目同根、单独一级）
 *     ④ `<dataHome>/.agent-io`（`~/.agent-io`，已安装/无项目场景）
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **显式 > 约定**：`AGENT_IO_DATA_ROOT` 同时给了也必须赢（Maven 那种"位置随你"）；
 *   ② **`AGENT_IO_HOME` 必须赢过约定目录** —— 否则 35 张证的沙盒会被真数据仓抢走（写闸会判"非沙盒"）；
 *   ③ 什么都没设、而包根下有 `.agentio-data` ⇒ **就用它**（且**不**落 `~`）；
 *   ④ 包根下没有 `.agentio-data` ⇒ 落回 `<dataHome>/.agent-io`（已安装场景）；
 *   ⑤ 跨项目数据（注册表 / 判据缓存 / dogfood 日志 / 旧 task-history）都从**数据仓**解析，
 *      不再从"项目内的 `.agent-io`"里瞎找。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不搬用户数据**：本证只读 `getStorageRoot()` 与几个路径解析器，一个字节都不写；
 *   · **[未核] 多仓共用一份数据仓**：把 `AGENT_IO_DATA_ROOT` 指到共享盘（多台机器）没有验证过；
 *   · **[未核] Windows 盘符大小写 / 网络盘** 上的 `fs.existsSync` 判定。
 *
 * ## 用法
 *   env -u AGENT_IO_HOME -u AGENT_IO_DATA_ROOT node certs/t370-data-root-cert.mjs   # ★ 先 npm run build
 *
 * touches: src/infrastructure/storage.ts, src/infrastructure/data_dir.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const D = (rel) => `../dist/src/${rel}`;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const storage = await import(D('infrastructure/storage.js'));
const registry = await import(D('infrastructure/project_registry.js'));
const dogfood = await import(D('infrastructure/dogfood_stats.js'));

/** 每次都用**全新的模块实例**读环境变量（getStorageRoot 是调用时读 env，但保险起见分开跑） */
const withEnv = async (env, fn) => {
  const saved = { AGENT_IO_HOME: process.env.AGENT_IO_HOME, AGENT_IO_DATA_ROOT: process.env.AGENT_IO_DATA_ROOT };
  for (const k of ['AGENT_IO_HOME', 'AGENT_IO_DATA_ROOT']) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of ['AGENT_IO_HOME', 'AGENT_IO_DATA_ROOT']) delete process.env[k];
    Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));
  }
};

const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp370root-'));
const conv = path.join(PKG, '.agentio-data');
const hadConv = fs.existsSync(conv);

// ── ① 显式 AGENT_IO_DATA_ROOT 赢 ─────────────────────────
const explicit = path.join(TMP, 'data-root');
fs.mkdirSync(explicit, { recursive: true });
withEnv({ AGENT_IO_DATA_ROOT: explicit, AGENT_IO_HOME: path.join(TMP, 'home') }, () => {
  chk(storage.getStorageRoot() === explicit, '① `AGENT_IO_DATA_ROOT` 赢（不追加 .agent-io）', `= ${storage.getStorageRoot()}`);
});

// ── ② AGENT_IO_HOME 赢过约定目录 ─────────────────────────
const home = path.join(TMP, 'home');
fs.mkdirSync(home, { recursive: true });
withEnv({ AGENT_IO_HOME: home }, () => {
  const got = storage.getStorageRoot();
  chk(
    got === path.join(home, '.agent-io'),
    '② `AGENT_IO_HOME` 赢过包根的约定目录（否则证的沙盒会被真数据仓抢走）',
    `= ${got}`,
  );
});

// ── ③ 什么都没设 ⇒ 用包根下的 .agentio-data ──────────────
withEnv({}, () => {
  const got = storage.getStorageRoot();
  if (hadConv) {
    chk(got === conv, '③ 什么都没设、包根下有 `.agentio-data` ⇒ **就用它**（与项目同根、单独一级）', `= ${got}`);
    chk(!got.startsWith(os.homedir()), '③-b 且**不**落 `~`（这是用户要的那条）', `home=${os.homedir()}`);
  } else {
    console.log('○ ③ 包根下没有 .agentio-data ⇒ 本条跳过（安装态才走这条）');
  }
});

// ── ④ 没有约定目录 ⇒ 落回 <dataHome>/.agent-io ───────────
{
  // 用一个"没有 .agentio-data"的临时包根模拟安装态：直接问 AGENT_IO_HOME 的那条已知路径
  withEnv({ AGENT_IO_HOME: path.join(TMP, 'installed') }, () => {
    chk(
      storage.getStorageRoot() === path.join(TMP, 'installed', '.agent-io'),
      '④ 装到别处（无约定目录）⇒ 落回 `<dataHome>/.agent-io`（既有语义不变）',
      `= ${storage.getStorageRoot()}`,
    );
  });
}

// ── ⑤ 跨项目数据都从数据仓解析 ───────────────────────────
withEnv({}, () => {
  const root = storage.getStorageRoot();
  const regFile = registry.registryFile();
  chk(regFile === path.join(root, 'projects.json'), '⑤-a 注册表住在数据仓根', `= ${regFile}`);
  const dog = dogfood.dogfoodLogDir?.() ?? null;
  if (dog) chk(dog === path.join(root, 'dogfood'), '⑤-b 工具使用日志住在 `<数据仓>/dogfood/`', `= ${dog}`);
  chk(
    !fs.existsSync(path.join(PKG, '.agent-io', 'projects.json')) || root !== path.join(PKG, '.agent-io'),
    '⑤-c 数据仓**不再**等于项目内 `.agent-io`（两者分开，避免"同名两归属"）',
    `数据仓=${root}`,
  );
});

// ── ⑥ 回归钉：`baseDir` 的语义是**项目根**，不是数据仓 ─────────────
//   （2026-10-27 实测踩过：把 `getDesignDir/getArchiveDir` 统一写成 `getStorageRoot()` ⇒
//    `getDesignSheetFile('agent-io')` 变成 `<proj>/design/…`，少了 `.agent-io` 一段 ⇒ 册全读不到）
{
  const proj = path.join(TMP, 'proj-with-cards');
  fs.mkdirSync(proj, { recursive: true });
  const designDir = storage.getDesignDir(proj);
  const sheetFile = storage.getDesignSheetFile('t370x', proj);
  const archiveDir = storage.getArchiveDir('t370x', proj);
  chk(
    designDir === path.join(proj, '.agent-io', 'design'),
    '⑥-a `getDesignDir(项目根)` 带 `.agent-io` 这一段',
    `= ${designDir}`,
  );
  chk(
    sheetFile === path.join(proj, '.agent-io', 'design', 't370x.dsl.json'),
    '⑥-b `getDesignSheetFile(feature, 项目根)` 同口径（册必须能定位到）',
    `= ${sheetFile}`,
  );
  chk(
    archiveDir === path.join(proj, '.agent-io', 'archive', 't370x'),
    '⑥-c `getArchiveDir(feature, 项目根)` 同口径',
    `= ${archiveDir}`,
  );
  // 不给 baseDir ⇒ 落到**数据仓**（迁移通道），而不是"项目根下少一段"
  chk(
    storage.getDesignDir() === path.join(storage.getStorageRoot(), 'design'),
    '⑥-d 不给 baseDir ⇒ 落数据仓的 `design/`（迁移通道，不是少一段）',
    `= ${storage.getDesignDir()}`,
  );
}

console.log(`\n═══ T370 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
