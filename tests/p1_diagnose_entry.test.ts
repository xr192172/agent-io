/**
 * P1 · 统一诊断入口（`diagnose`）与版本兼容别名（`diagnose_loop`）的机器回归
 *
 * touches: src/application/meta/index.ts, src/application/meta/registry/capability_map.ts
 *
 * 钉住 2026-11-09 收敛试点的四条契约：
 *   ① **只读路径不写盘、不产出 `touched`**（`apply` 缺省或显式 false）；
 *   ② `apply:true` 走**原闭环**（出补丁 → 应用 → 验证 → 不过自动回退），**失败不报修复成功**；
 *   ③ **两入口参数解析与失败语义一致**（同一份 schema 键、同一份 handler）；★ 唯一允许的差异是
 *      **模型生成的自然语言段**（诊断结论含 LLM 成分，逐字不可比 —— 故只比确定性部分）；
 *   ④ `apply:false` 与旧 `diagnose_loop(apply:false)` 的差异 = **迁移边界**：旧版会顺带出补丁+diff，
 *      现在是**只诊断**；本测试把这条边界写成断言，防止有人以为"补丁预演还在"。
 *
 * ★ 为什么用**本仓 root** 当 project_dir：诊断会在项目下建 `.agent-io/cache.db` 并把 feature 登记进
 *   共享 `project_registry`；用临时目录会在注册表里留下"不可达登记"（实测污染过 16 条，用
 *   `scripts/registry_repair.mjs` 才清掉）。用真根 ⇒ 零新增登记。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { META_TOOLS } from '../src/application/meta/index.js';

const ROOT = process.cwd();
const SYMPTOM = "TypeError: Cannot read properties of undefined (reading 'touched') at src/application/meta/index.ts:310";

type Env = { text: string; isError?: boolean; touched?: unknown };
const entry = (name: string) => {
  const d = META_TOOLS.find((t) => t.name === name);
  assert.ok(d, `注册表里必须有 ${name}`);
  return d;
};
const call = async (name: string, args: Record<string, unknown>): Promise<Env> =>
  (await entry(name).handler({ project_dir: ROOT, symptom: SYMPTOM, ...args } as never)) as unknown as Env;

/** 取几个**必须不被改动**的源文件的哈希（只读路径与失败闭环都不许动它们） */
const PROBE_FILES = [
  'src/application/meta/index.ts',
  'src/application/meta/diagnosis/diagnose_loop.ts',
  'src/infrastructure/analysis/diagnosis/diagnose.ts',
];
const hashes = (): string =>
  PROBE_FILES.map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')).join(':');

test('P1-diagnose-entry · ① 只读路径：不产出 touched、不改任何源文件（apply 缺省与显式 false 都算）', async () => {
  const before = hashes();
  const r1 = await call('diagnose', {});
  const r2 = await call('diagnose', { apply: false });
  assert.equal(r1.touched, undefined, '只读路径不许带 touched（那是闭环落盘才有的产物）');
  assert.equal(r2.touched, undefined, 'apply:false 同样不许带 touched');
  assert.ok(String(r1.text ?? '').length > 0, '只读诊断必须有回执正文');
  assert.ok(String(r2.text ?? '').length > 0, 'apply:false 也必须有回执正文');
  assert.equal(hashes(), before, '只读路径**一个源文件都不许改**');
});

test('P1-diagnose-entry · ② apply:true 走原闭环：失败时不报修复成功，且同样不改源码', async () => {
  const before = hashes();
  const r = await call('diagnose', { apply: true });
  const txt = String(r.text ?? '');
  assert.ok(txt.length > 0, '闭环必须有回执（失败也要说清停在哪）');
  // ★ 失败/不可判不得报成功：不许出现"已修复/修复成功/verified"这类收口词
  assert.ok(!/修复成功|已修复|已通过验证|\bverified\b/i.test(txt), `失败时不许报修复成功：${txt.slice(0, 200)}`);
  // ★ 本仓写闸在场 ⇒ 这条闭环必然在"落盘"或"出补丁"阶段止步（isError 或明确点名拒绝/失败）
  assert.ok(
    r.isError === true || /拒绝落盘|停|失败|无法/.test(txt),
    `闭环要么 isError，要么明确点名止步阶段（实测：${txt.slice(0, 200)}）`,
  );
  assert.equal(hashes(), before, '闭环没通过 ⇒ 源码必须原样');
});

test('P1-diagnose-entry · ③ 两入口：schema 与参数解析同一份；只读失败语义一致（不比模型措辞）', async () => {
  const d = entry('diagnose');
  const a = entry('diagnose_loop');
  assert.deepEqual(
    Object.keys(a.inputSchema).sort(),
    Object.keys(d.inputSchema).sort(),
    '两个名字的入参键集合必须一致（别名 = 同一份 schema）',
  );
  assert.equal(d.writes, a.writes, 'writes 声明必须一致');

  const r1 = await call('diagnose', {});
  const r2 = await call('diagnose_loop', {});
  assert.equal(r1.touched, undefined, 'diagnose 只读不带 touched');
  assert.equal(r2.touched, undefined, '别名只读同样不带 touched');
  assert.equal(
    r1.isError ?? false,
    r2.isError ?? false,
    '同一症状下两入口的成败语义必须一致（错也一样错）',
  );
  // ★ 确定性部分可比：**症状那一行**逐字相同（同一输入 ⇒ 同一解析结果）。
  //   ★ 不拿"引擎档位"或根因/建议段比：那些含 LLM 成分，同一症状两次调用就会不同（实测 flaky）。
  const symptomLine = (s: string): string =>
    String(s)
      .split('\n')
      .filter((l) => /症状[:：]/.test(l))
      .join('\n');
  assert.ok(symptomLine(r1.text).length > 0, `回执里必须有"症状"那一行：${String(r1.text).slice(0, 160)}`);
  assert.equal(
    symptomLine(r1.text),
    symptomLine(r2.text),
    `同一症状下两入口的症状行必须逐字一致（实测：${symptomLine(r1.text)} vs ${symptomLine(r2.text)}）`,
  );
});

test('P1-diagnose-entry · ④ 迁移边界：apply:false = 只诊断（旧版"补丁预演"已不在），且两入口一致', async () => {
  const r1 = await call('diagnose', { apply: false });
  const r2 = await call('diagnose_loop', { apply: false });
  const t1 = String(r1.text ?? '');
  const t2 = String(r2.text ?? '');
  // 旧 diagnose_loop(apply:false) 会给补丁 + diff；收敛后**不再有**补丁段
  assert.ok(!/^\+{3} |^\s*\d+\s+\|[-+]/m.test(t1), `apply:false 不许再出 diff 段（迁移边界）：${t1.slice(0, 200)}`);
  assert.ok(!/补丁\s*\d+\s*个/.test(t1), `apply:false 不许报"补丁 N 个"：${t1.slice(0, 200)}`);
  // 两入口在 apply:false 下都不带 touched（都以"只读"收尾）
  assert.equal(r1.touched, undefined);
  assert.equal(r2.touched, undefined);
  // ★ 不比总行数：报告含 LLM 生成的根因/建议段，行数随模型输出浮动（实测 flaky）。
  //   确定性判据 = **两边都没有"补丁/diff"这类闭环产物**（那正是被收敛掉的能力）。
  assert.ok(!/^\+{3} |^\s*\d+\s+\|[-+]/m.test(t2), `别名 apply:false 同样不许出 diff 段：${t2.slice(0, 200)}`);
  assert.ok(!/补丁\s*\d+\s*个/.test(t2), `别名 apply:false 同样不许报"补丁 N 个"：${t2.slice(0, 200)}`);
});
