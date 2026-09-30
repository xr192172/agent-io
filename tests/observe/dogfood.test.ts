/**
 * Observe 狗食插桩测试。
 *
 * 早期这里通过手动埋进 storage.ts 的探针验证 saveDSL/saveLiveFeature 写盘路径。
 * 全自动插桩（instrument）就绪后，手写探针已删除，扩插桩只走一条命令：
 *   node dist/src/presentation/cli/instrument_cli.js <project> [--dry-run]
 * 本测试改为验证：
 *   1. 全自动插桩能覆盖 agent-io 自身写盘源文件（storage.ts 应被注入
 *      enter/exit/io 探针点，dry-run 不写盘）；
 *      ★ 并断言**探针 import 说明符真的指到一个存在的编译产物** —— 该路径由
 *      `relativeProbeImport` **拼字符串**得出（不是 import），
 *      `src/tools/rename_files` 搬目录时**管不到它** ⇒ 2026-09-30 搬 `src/infrastructure/analysis/observe/` 后补此断言。
 *   2. captureProbe 在无 sink 时是无害 no-op（插桩零侵入）。
 *   3. 跨模块实例共享同一份全局 sink（真实插桩场景：被插桩代码与哨兵从不同
 *      specifier 加载同一 probe 实现）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { instrumentFile, PROBE_DIR_REL } from '../../src/infrastructure/analysis/observe/instrument.js';
import {
  TSProbeCapture,
  setGlobalProbeSink,
  captureProbe,
  loadTSEvents,
} from '../../src/infrastructure/analysis/observe/probe.js';
import { getDataHome } from '../../src/storage.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('Observe 狗食插桩 · 全自动插桩覆盖自身写盘路径', () => {
  it('storage.ts 被全自动插桩注入 enter/io 探针点（dry-run）', async () => {
    const file = path.join(PROJECT_ROOT, 'src', 'storage.ts');
    expect(fs.existsSync(file)).toBe(true);
    const res = await instrumentFile(file, { projectRoot: PROJECT_ROOT, write: false });
    expect(res.error).toBeUndefined();
    // 写盘路径 saveDSL/saveLiveFeature 走 fs.writeFileSync → 必然命中 io 探针
    expect(res.sites.some((s) => s.kind === 'io')).toBe(true);
    // 函数出入口也应被插桩
    expect(res.sites.some((s) => s.kind === 'enter')).toBe(true);
    expect(res.sites.some((s) => s.kind === 'exit')).toBe(true);
    // 探针事件带 file 字段（相对项目根），供日志按文件过滤
    for (const s of res.sites) {
      expect(s.injected).toContain('file:');
    }
  });

  it('★ 探针 import 说明符指向真实存在的编译产物（防「搬目录后静默指错」）', async () => {
    const file = path.join(PROJECT_ROOT, 'src', 'storage.ts');
    const res = await instrumentFile(file, { projectRoot: PROJECT_ROOT, write: false });
    expect(res.probeImport, 'instrumentFile 应回报本次用的探针 import').toBeTruthy();

    // ① 说明符必须落在 PROBE_DIR_REL 下 —— 常量与实际拼出来的路径一致
    expect(res.probeImport).toContain(`dist/${PROBE_DIR_REL}/probe.js`);

    // ② ★ 这才是真判据：该常量必须指向**本仓真实存在**的探针目录。
    //   （`inferProjectRoot` / `inferRoot` 用的正是这同一个路标文件。）
    //   ★ 只做 ① 是不够的 —— 常量本身被改错时，字符串两边一起错、照样自洽（实测：把它改成
    //   `src/observe` 后 ① 仍然通过）。
    const marker = path.join(PROJECT_ROOT, ...PROBE_DIR_REL.split('/'), 'probe.ts');
    expect(fs.existsSync(marker), `PROBE_DIR_REL=${PROBE_DIR_REL} 下没有 probe.ts：${marker}`).toBe(true);

    // ③ 把它解析成绝对路径，编译产物必须真的存在。
    //   ⚠ 这一条**单独不足**：`tsc` 不清除"源文件已删除"的旧产物，陈旧 dist 会让它假绿。
    const abs = path.resolve(path.dirname(file), res.probeImport);
    expect(fs.existsSync(abs), `探针 import 解析为 ${abs}，但该文件不存在`).toBe(true);

    // ④ 且它导出的正是插桩注入代码所调用的那个符号
    expect(fs.readFileSync(abs, 'utf-8')).toContain('captureProbe');
  });

  it('dry-run 不写盘：源文件保持原样', async () => {
    const file = path.join(PROJECT_ROOT, 'src', 'storage.ts');
    const before = fs.readFileSync(file, 'utf-8');
    await instrumentFile(file, { projectRoot: PROJECT_ROOT, write: false });
    const after = fs.readFileSync(file, 'utf-8');
    expect(after).toBe(before);
    expect(after).not.toContain('observe:instrumented');
  });
});

describe('Observe 狗食插桩 · 零侵入', () => {
  it('captureProbe 在无 sink 时是无害 no-op', () => {
    expect(() => captureProbe('whatever', { x: 1 })).not.toThrow();
  });
});

describe('Observe 狗食插桩 · 跨模块实例共享 sink（回归）', () => {
  it('不同 specifier 加载的 probe 实例共享同一份全局 sink', async () => {
    const modA = await import('../../dist/src/infrastructure/analysis/observe/probe.js');
    // 用 /C:/ 前置斜杠形式加载同一 dist 模块（file:// + %20 在 vitest 加载器会失败）
    const probePosix = path.resolve('dist/src/infrastructure/analysis/observe/probe.js').replace(/\\/g, '/');
    const modB = await import(/^[A-Za-z]:\//.test(probePosix) ? '/' + probePosix : probePosix);

    const eventsPath = path.join(getDataHome(), 'observe-shared');
    const sink = new TSProbeCapture(TSProbeCapture.pathFor(eventsPath));
    // 用实例 A 设置 sink
    modA.setGlobalProbeSink(sink);

    // 用实例 B 的 captureProbe 采集（应命中 A 设置的全局 sink）
    modB.captureProbe('shared.test', { via: 'modB' });
    const { events } = loadTSEvents(TSProbeCapture.pathFor(eventsPath));
    expect(events).toHaveLength(1);
    expect(events[0].probe).toBe('shared.test');
    expect(events[0].fields['via']).toBe('modB');
  });
});