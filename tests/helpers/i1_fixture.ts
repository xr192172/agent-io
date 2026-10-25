/**
 * I1 测试夹具 —— 临时 AGENT_IO_HOME + 最小设计 DSL。
 *
 * ★ 用法：`withTempHome(t, fn)` 在临时目录里跑，退出时清理；
 *   storage 的 `getDataHome()` **每次调用**都读 `AGENT_IO_HOME` ⇒ 运行期改 env 即可隔离，无需提前 import。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DesignDSL } from '../../src/domain/types.js';

export function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-i1-'));
}

/** 在临时 home 里落一份最小设计 DSL（一个 service 节点；validateDSL 判它自洽） */
export function writeMinimalFeature(home: string, feature: string, opts?: { source_root?: string; nodeType?: string; nodeId?: string }): string {
  const dsl: DesignDSL = {
    feature,
    title: feature,
    source_root: opts?.source_root,
    geometry: {
      nodes: [
        {
          id: opts?.nodeId ?? 'svc_1',
          label: 'svc',
          type: opts?.nodeType ?? 'service',
          x: 0,
          y: 0,
        },
      ],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${feature}.dsl.json`);
  fs.writeFileSync(file, JSON.stringify(dsl, null, 2), 'utf-8');
  return file;
}

/** 读回设计 DSL（测试断言用） */
export function readFeature(home: string, feature: string): DesignDSL {
  const file = path.join(home, '.agent-io', 'design', `${feature}.dsl.json`);
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as DesignDSL;
}

export function rmRf(p: string): void {
  // ★ Windows：better-sqlite3 的 cache.db 句柄可能晚于测试释放 ⇒ EBUSY。
  //   清理是卫生不是断言：重试几次，仍锁着就留给 OS（临时目录），不让它把已通过的测试染红。
  for (let i = 0; i < 3; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'EBUSY' && code !== 'EPERM') throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* 句柄仍被占用 ⇒ 放弃清理（tmp 目录，无害） */
  }
}
