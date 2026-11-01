#!/usr/bin/env node
/**
 * 注册表清理 —— **默认 dry-run**，`--apply` 才删。
 *
 * ## 它修的是什么
 * `projects.json`（`feature → 项目根`）是**总任务视图与设计册位置的钥匙**。实测它会积累
 * **测试夹具根**：`import_project` 一个 temp 夹具项目 ⇒ 登记落进真数据仓 ⇒ 夹具跑完
 * 那个目录就没了（或留在 `os.tmpdir()` 里等系统清），从此总账 / 设计册指向一个随时消失的位置。
 * 真数据仓当前就有 5 条这样的登记（`iso / ds / sp / tp / t192flow`，root 全在
 * `%LOCALAPPDATA%\Temp\` 下）。
 *
 * ## 判据（两条**可复核的事实**，不按名字、不按时间猜）
 * ① **不可达** —— 登记的根现在不是盘上一个现存目录（`readRegistryChecked().suspects`，唯一判据住 src）；
 * ② **不是本项目根** —— 根落在**系统临时目录**之下（`classifyWriteSubject` 的 `temp` 那一格：
 *    临时目录按定义就是一次性副本，不是任何项目的长期归属）。
 *
 * ⇒ 两条任一成立 ⇒ 候选（打印理由）；两条都不成立 ⇒ **保留**（并打印"保留"那一行，读数带分母）。
 *
 * ## 跑法
 * ```
 * node scripts/registry_repair.mjs            # dry-run：只列候选 + 理由，一个字节都不写
 * node scripts/registry_repair.mjs --apply    # 真删（逐条走 unregisterFeature，理由落 projects.unregister.jsonl）
 * ```
 * ★ 判据与动作**都不住本文件**：读走 `src/infrastructure/project_registry.ts#readRegistryChecked`，
 *   写走 `unregisterFeature`（唯一删除出口）。本文件只做"列 + 调"，不另写一套判据（0.9 一处权威）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const APPLY = process.argv.includes('--apply');

/**
 * 载入 src 的判据实现。
 * ★ 源码是 TS ⇒ 需要 tsx loader，而 loader 只能在**进程启动时**注入
 *   ⇒ 直接 `node scripts/registry_repair.mjs` 时用**同一份参数**重启自己一次（不让调用方记参数）。
 */
async function loadSrc() {
  try {
    return await import('../src/infrastructure/project_registry.js');
  } catch (e) {
    const r = spawnSync(process.execPath, ['--import', 'tsx', SELF, ...process.argv.slice(2)], {
      cwd: ROOT,
      stdio: 'inherit', // ★ 不用 pipe：沙箱下管道会 EPERM（本仓已在 run-tests 记过这条）
    });
    process.exit(r.status ?? 1);
  }
}

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

/** 「这个根算不算本项目根」的判据 —— 不复述，直接问写闸的分类器（唯一住处） */
async function loadClassifier() {
  try {
    return (await import('../src/application/write_gate.js')).classifyWriteSubject;
  } catch {
    // 分类器读不到 ⇒ **不许**当成"都不是临时目录"（那会把唯一用途变成假阴）
    console.error(`${C.r}✗ 读不到判据 src/application/write_gate.ts#classifyWriteSubject ⇒ 拒跑（判不了 ≠ 没有候选）${C.x}`);
    process.exit(2);
  }
}

async function main() {
  const reg = await loadSrc();
  const classify = await loadClassifier();

  // ── 判据：读一次拿「登记 + 不可达清单」（读路径不写盘）
  const { reg: table, suspects } = reg.readRegistryChecked();
  const suspectReason = new Map(suspects.map((s) => [s.feature, s.reason]));

  const candidates = [];
  const kept = [];
  for (const [feature, entry] of Object.entries(table.features).sort(([a], [b]) => a.localeCompare(b))) {
    const root = reg.normRoot(String(entry?.project_root ?? ''));
    const unreachable = suspectReason.get(feature);
    // ★ 复用写闸的分类器：`temp` = 在系统临时目录下（临时副本，不是用户源码/不是项目根）
    const isTemp = !!root && classify(root, root).subject === 'temp';
    if (unreachable || isTemp) {
      const why = [
        unreachable ? `不可达（${unreachable}）` : '',
        isTemp ? '根在系统临时目录下（os.tmpdir 之下）⇒ 测试夹具的一次性根，不是本项目根' : '',
      ]
        .filter(Boolean)
        .join(' + ');
      candidates.push({ feature, root, why });
    } else {
      kept.push({ feature, root });
    }
  }

  const file = reg.registryFile();
  console.log(`${C.b}注册表清理${C.x}  ${APPLY ? `${C.r}--apply（真删）${C.x}` : `${C.g}dry-run（默认，不写盘）${C.x}`}`);
  console.log(`${C.d}册：${file}（${existsSync(file) ? '存在' : '不存在'}）· 登记 ${Object.keys(table.features).length} 条${C.x}`);
  console.log('');
  for (const c of candidates) console.log(`  ${C.y}候选${C.x} ${c.feature.padEnd(18)} ${c.root}\n       ${C.d}${c.why}${C.x}`);
  for (const k of kept) console.log(`  ${C.d}保留 ${k.feature.padEnd(18)} ${k.root}${C.x}`);
  console.log('');
  // ★ 0.12 ③：分子必须带分母（只报"删几条"看不出"看了几条"）
  console.log(`候选 ${candidates.length} 条 · 保留 ${kept.length} 条 · 合计 ${candidates.length + kept.length} 条`);

  if (!candidates.length) {
    console.log(`${C.g}⇒ 没有候选（登记表里每条都指向一个现存、且不在系统临时目录下的根）${C.x}`);
    return 0;
  }
  if (!APPLY) {
    console.log(`${C.g}⇒ dry-run 结束：一个字节都没写${C.x}（要真删：node scripts/registry_repair.mjs --apply）`);
    return 0;
  }

  let removed = 0;
  const failed = [];
  for (const c of candidates) {
    try {
      const r = reg.unregisterFeature(c.feature, c.why, 'scripts/registry_repair.mjs');
      if (r.removed) removed++;
      else failed.push(`${c.feature}：本来就没这条登记（removed:false）`);
    } catch (e) {
      failed.push(`${c.feature}：${String(e?.message ?? e).split('\n')[0]}`);
    }
  }
  console.log('');
  console.log(`已注销 ${removed} 条 · 失败 ${failed.length} 条`);
  for (const f of failed) console.log(`  ${C.r}✗ ${f}${C.x}`);
  return failed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`${C.r}✗ 注册表清理跑挂了：${String(e?.message ?? e)}${C.x}`);
    process.exit(2);
  },
);
