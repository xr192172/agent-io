/**
 * `snapshot` 单入口的工具层测试（list / rollback）
 *
 * ★ 2026-09-29（**面收敛样板本笔**）：原「列出快照」+「回滚快照」两个**注册入口**
 *   收敛为 **1 个入口 `snapshot` + action 枚举**。
 *   判据（`docs/tool-convergence.md` §2.0）：**按「操作对象」聚合** —— 两者操作的是**同一个对象**
 *   （代码文件快照库 `<project_dir>/.agent-io/code-snapshots/`），动作互补（列出撤回点 / 用它撤回），
 *   且原两个 description 本来就互相指名（"回滚走 …"）。
 *
 * 为什么这层测试值得单写（本笔是"样板"，判据要落成机器可判的）：
 *   ① 收敛**不许丢能力**：`省略 snapshot = 最近一份`、`file 只回滚单个文件`、
 *      "快照时还不存在的文件 ⇒ 回滚时删除" 三条都要有断言；
 *   ② 新入口自己的**前置校验**：缺 action / 缺 project_dir ⇒ 明确报错（而不是拿 'undefined' 当路径）；
 *   ③ ★ 本笔**没有**给 rollback 加 dry_run（语义与旧入口逐字相同），这条"没改"也要被钉住：
 *      回执里必须写明"回滚本身不可再撤回"——否则 agent 会以为还能再撤一次。
 *
 * 快照的造法：直接调 [B] 的 `createFileSnapshot`（测试可以直接下到 [B]），
 * 不靠 `edit_code` 之类的旁路 —— 那会把"快照怎么来的"和"快照怎么用"搅在一起。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_DEFS } from '../../src/presentation/mcp/server_registry.js';
import { createFileSnapshot } from '../../src/application/refactor/file_snapshot.js';

const def = (name: string) => {
  const d = TOOL_DEFS.find((t) => t.name === name);
  if (!d) throw new Error(`工具 ${name} 未注册`);
  return d as unknown as {
    handler: (a: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
  };
};

/** 调用工具并拆开 MCP 文本（`message\n---DATA---\n<json>`）——见 wrapData 契约 */
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ message: string; data: Record<string, unknown>; isError: boolean }> {
  const r = await def(name).handler(args);
  const [message, dataRaw] = r.text.split('\n---DATA---\n');
  return {
    message: message ?? '',
    data: dataRaw ? (JSON.parse(dataRaw) as Record<string, unknown>) : {},
    isError: r.isError === true,
  };
}

describe('snapshot 单入口', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-snapshot-tool-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('snapshot 已注册，description 写明两个 action + 「回滚不可再撤回」+ 与 DSL 快照的区别', () => {
    const d = TOOL_DEFS.find((t) => t.name === 'snapshot');
    expect(d).toBeTruthy();
    const desc = (d as { description: string }).description;
    expect(desc.length).toBeGreaterThan(50);
    for (const k of ['action=list', 'action=rollback', '不可再撤回', 'get_dsl']) {
      expect(desc, `description 少了「${k}」`).toContain(k);
    }
  });

  it('★ 前置校验：缺 action / 缺 project_dir ⇒ 明确报错（旧入口会把 undefined 当路径用）', async () => {
    const noAction = await call('snapshot', { project_dir: root });
    expect(noAction.isError).toBe(true);
    expect(noAction.message).toContain('action');

    const noRoot = await call('snapshot', { action: 'list' });
    expect(noRoot.isError).toBe(true);
    expect(noRoot.message).toContain('project_dir');
  });

  it('list：无快照时如实说明（不报假成功），data.snapshots 为空数组', async () => {
    const r = await call('snapshot', { action: 'list', project_dir: root });
    expect(r.isError).toBe(false);
    expect(r.message).toContain('暂无快照');
    expect(r.data.snapshots).toEqual([]);
  });

  it('list：有快照时给出 id / 时间 / 原因 / 涉及文件数', async () => {
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'A1\n', 'utf8');
    createFileSnapshot(root, { reason: 'edit_code:src/a.ts', files: ['src/a.ts'] });
    const r = await call('snapshot', { action: 'list', project_dir: root });
    const snaps = r.data.snapshots as { id: string; reason: string; files: unknown[] }[];
    expect(snaps).toHaveLength(1);
    expect(snaps[0].reason).toBe('edit_code:src/a.ts');
    expect(snaps[0].files).toHaveLength(1);
    expect(r.message).toContain('edit_code:src/a.ts');
  });

  it('★ rollback（省略 snapshot = 最近一份）：恢复被改文件 + 删除"那次改动新建"的文件', async () => {
    const a = path.join(root, 'src', 'a.ts');
    const created = path.join(root, 'src', 'new.ts');
    fs.writeFileSync(a, 'A1\n', 'utf8');
    // 快照时刻：a.ts 存在、new.ts 不存在（= 这次改动新建的）
    createFileSnapshot(root, { reason: 't', files: ['src/a.ts', 'src/new.ts'] });
    // 模拟"那次改动"：a.ts 被改，new.ts 被新建
    fs.writeFileSync(a, 'A2\n', 'utf8');
    fs.writeFileSync(created, 'NEW\n', 'utf8');

    const r = await call('snapshot', { action: 'rollback', project_dir: root });
    expect(r.isError).toBe(false);
    expect(fs.readFileSync(a, 'utf8')).toBe('A1\n');
    expect(fs.existsSync(created)).toBe(false);
    expect(r.data.restored).toEqual(['src/a.ts']);
    expect(r.data.removed).toEqual(['src/new.ts']);
    // ★ 不可逆事实必须在回执里（本笔刻意**没有**给 rollback 加 dry_run，见文件头③）
    expect(r.message).toContain('不可再撤回');
  });

  it('rollback：传 file 可只回滚单个文件（其余保持"改动后"）', async () => {
    const a = path.join(root, 'src', 'a.ts');
    const b = path.join(root, 'src', 'b.ts');
    fs.writeFileSync(a, 'A1\n', 'utf8');
    fs.writeFileSync(b, 'B1\n', 'utf8');
    createFileSnapshot(root, { reason: 't', files: ['src/a.ts', 'src/b.ts'] });
    fs.writeFileSync(a, 'A2\n', 'utf8');
    fs.writeFileSync(b, 'B2\n', 'utf8');

    const r = await call('snapshot', { action: 'rollback', project_dir: root, file: 'src/a.ts' });
    expect(fs.readFileSync(a, 'utf8')).toBe('A1\n');
    expect(fs.readFileSync(b, 'utf8')).toBe('B2\n'); // 没被碰
    expect(r.data.restored).toEqual(['src/a.ts']);
  });

  it('rollback：指定的快照不存在 ⇒ 如实报错（不静默什么都不做）', async () => {
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'A1\n', 'utf8');
    createFileSnapshot(root, { reason: 't', files: ['src/a.ts'] });
    const r = await call('snapshot', { action: 'rollback', project_dir: root, snapshot: 'no-such-id' });
    expect(r.data.ok).toBe(false);
    expect(r.message).toContain('代码快照不存在');
  });
});
