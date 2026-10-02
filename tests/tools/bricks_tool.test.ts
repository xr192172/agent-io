/**
 * `bricks` 单入口的工具层测试（search / assemble / slim / reconcile）
 *
 * ★ 2026-09-29（**面收敛第二批**）：原「检索积木盒」+「拼装」+「瘦身」+「盒内对账」四个**注册入口**
 *   收敛为 **1 个入口 `bricks` + action 枚举**。
 *   判据（`docs/tool-convergence.md` §2.0）：**按「操作对象」聚合** —— 四者操作的是**同一个对象**
 *   「积木盒 `<box_dir>/`」，共用同一锚点参数 `box_dir`，动作互补成一条价值链
 *   **找 → 拼 → 剪 → 验**（原检索入口的 description 本来就写着"我要 X 功能 → 找到积木 → 拎取拼装"）。
 *   **不属 `camera_*` 那类反面教训**（那不是"几个动作"，是**不同抽象层**）。
 *
 * 为什么这层测试值得单写（判据要落成机器可判的）：
 *   ① 新入口自己的**前置校验**：缺/非法 action、assemble 缺 `bricks`、缺 `target_dir`、
 *      slim 缺 `brick_name` ⇒ 明确报错（否则 `path.resolve(undefined)` 会抛给人看不懂的 TypeError）；
 *   ② ★ 本笔**没有**给写 action 加 dry_run（`write` 缺省 true = 默认落盘，与旧语义逐字相同）——
 *      这条"没改"必须被钉在 description 与 schema 上，否则 agent 会以为默认只预演；
 *   ③ 四个 action 的能力**逐项保留**（search 的三种模式 / assemble 的"绝不在原项目上抽取"/
 *      slim 的"原积木永不覆盖"）都要在 description 里有落点。
 *
 * 造法：本文件只测**工具层**（入口/schema/前置校验/只读路径），不重造积木盒夹具 ——
 *   盒内数据的造法与全链断言在 `tests/tools/{search,assemble,slim,reconcile}_brick.test.ts`
 *   （那些测的是 [B]，本笔一行未动，故它们仍直接调 [B]）。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_DEFS } from '../../src/application/tool_registry.js';

const def = (name: string) => {
  const d = TOOL_DEFS.find((t) => t.name === name);
  if (!d) throw new Error(`工具 ${name} 未注册`);
  return d as unknown as {
    handler: (a: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
    description: string;
    inputSchema: Record<string, unknown>;
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

describe('bricks 单入口', () => {
  it('bricks 已注册；原 4 个注册入口必须已消失（不许留双入口）—— 由 TOOL_DEFS 结构断言', () => {
    expect(TOOL_DEFS.some((t) => t.name === 'bricks')).toBe(true);
    // ★ 旧名不出现在本文件里（`contract_docs_gate` 会把旧名的任何字符串/注释判成"改名残留"）。
    //   "旧入口已消失"由 **G1 快照基线**的 `removed` 差集机器证明（tests/fixtures/tool_set_snapshot.json）。
    //   ★ 2026-10-02 删掉了原先这里的 `expect(TOOL_DEFS).toHaveLength(58)`（同一判据的第三份副本，
    //     且数字会过期）。理由见 facade_batch3.test.ts 同处。
  });

  it('description 写明 4 个 action + 「write 缺省 true = 默认落盘」+ 「target 拒绝覆盖」+ 「原积木永不覆盖」', () => {
    const desc = def('bricks').description;
    expect(desc.length).toBeGreaterThan(200);
    for (const k of [
      'action=search',
      'action=assemble',
      'action=slim',
      'action=reconcile',
      '缺省 true ⇒ 默认会落盘',
      '偷偷改成 dry-run',
      '拒绝覆盖',
      '原积木永不覆盖',
    ]) {
      expect(desc, `description 少了「${k}」`).toContain(k);
    }
  });

  it('★ schema：action 枚举 + 共用锚点 box_dir + write 的默认值写在 describe 里', () => {
    const schema = def('bricks').inputSchema as Record<string, { description?: string; _def?: { values?: unknown } }>;
    expect(Object.keys(schema).sort()).toEqual(
      [
        'action',
        'box_dir',
        'brick_dir',
        'brick_name',
        'bricks',
        'events_files',
        'gap_notes',
        'go_version',
        'has_invariants',
        'known_blind_spots',
        'language',
        'method',
        'module',
        'name',
        'query',
        'target_dir',
        'verified',
        'verify_build',
        'verify_dir',
        'write',
        'zero_third_party',
      ].sort(),
    );
    expect(String(schema.write?.description)).toContain('缺省 **true = 会落盘**');
    expect(String(schema.box_dir?.description)).toContain('4 个 action 共用锚点');
    // ★ search / slim 两义：同一个 name 参数必须写明"按 action 读"
    expect(String(schema.name?.description)).toContain('按 action 读');
  });

  it('★ 前置校验：缺/非法 action ⇒ 明确报错（而不是掉进某个 action 分支）', async () => {
    const none = await call('bricks', {});
    expect(none.isError).toBe(true);
    expect(none.message).toContain('缺参数或非法 "action"');

    const bad = await call('bricks', { action: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.message).toContain('search / assemble / slim / reconcile');
  });

  it('★ 前置校验：assemble 缺 bricks / 缺 target_dir、slim 缺 brick_name ⇒ 明确报错', async () => {
    const noList = await call('bricks', { action: 'assemble', target_dir: 'D:/tmp/x' });
    expect(noList.isError).toBe(true);
    expect(noList.message).toContain('bricks');

    const emptyList = await call('bricks', { action: 'assemble', bricks: [] });
    expect(emptyList.isError).toBe(true);
    expect(emptyList.message).toContain('bricks');

    const noTarget = await call('bricks', { action: 'assemble', bricks: ['b'] });
    expect(noTarget.isError).toBe(true);
    expect(noTarget.message).toContain('target_dir');

    const noBrick = await call('bricks', { action: 'slim' });
    expect(noBrick.isError).toBe(true);
    expect(noBrick.message).toContain('brick_name');
  });

  it('search（只读）：盒不存在时如实报错（不报假成功）', async () => {
    // 缺省盒 = <dataHome>/.agent-io/bricks；测试的 AGENT_IO_HOME 是临时目录 ⇒ 盒不存在
    const r = await call('bricks', { action: 'search' });
    expect(r.isError).toBe(true);
    expect(r.message).toContain('积木盒不存在');
  });

  it('★ search 的盒根必须在回执里点出来（[B] 的 message 不含盒路径，只有 data.box_dir 有）', async () => {
    // 空盒（存在但无积木）→ 走 browse 分支：这是**成功路径**，才看得到回执编排
    const box = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-bricks-box-'));
    try {
      const r = await call('bricks', { action: 'search', box_dir: box });
      expect(r.isError).toBe(false);
      // 空盒 = "盒为空或 manifest 全损坏"这条**如实说明**（不报假成功）
      expect(r.message).toContain('积木盒为空或全部 manifest 损坏');
      expect(r.data.box_dir).toBe(path.resolve(box));
      // ★ 编排点：把 [B] 解析出的盒根显式点出来（否则 agent 不知道刚才查的是哪个盒）
      expect(r.message).toContain(`盒：${path.resolve(box)}`);
      expect(r.data.mode).toBe('browse');
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});
