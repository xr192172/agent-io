/**
 * P1-7 工具层集成测试 —— `rules` 单入口的三个 action（export / apply / check）
 *
 * ★ 2026-09-29（**面收敛样板本笔**）：原「萃取 / 应用 / 检查」三个**注册入口**
 *   收敛为 **1 个入口 `rules` + action 枚举**。
 *   判据（`docs/tool-convergence.md` §2.0）：**按「操作对象」聚合** —— 三者操作的是
 *   **同一个对象**（规则库 `<project_dir>/.agent-io/rules/`），动作互补（沉淀 → 应用 → 校验）。
 *   本文件随之改成走新入口：**断言的行为逐条不变，只换寻址方式**；另加新入口自身的用例
 *   （缺 action / 缺 project_dir / export 缺 id|before|after ⇒ 明确报错，不再把 'undefined' 当值）。
 *
 * 为什么要单测工具层（而不只测库函数）：
 *   这些工具的**回执**是人/LLM 唯一能看到的诚实出口（是否落盘、泛化有没有降级、
 *   棘轮为什么 fail）。库函数对但回执撒谎，等于没有这套机制。
 *
 * 覆盖：
 *   1. export：dry_run 默认不写盘；三关不过时**即使 dry_run=false 也不写盘**；
 *      通过后写盘且 `.md` 落位正确、无 BOM；非法 id 报错。
 *   2. apply：dry_run 不写盘；dry_run=false 走写闸真落盘；三态计数与回执一致。
 *   3. check：无基线 ⇒ 存量算新增 ⇒ pass=false；update_baseline 后 pass=true；
 *      再引入新命中 ⇒ 只报新增。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_DEFS } from '../../src/application/tool_registry.js';
import { rulesDir } from '../../src/application/refactor/rf-rules/rule_library.js';

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

describe('P1-7 工具层：rules 单入口', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-p17-tool-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rules 已注册，且有中文描述（三个 action 都写在 description 里）', () => {
    const d = TOOL_DEFS.find((t) => t.name === 'rules');
    expect(d).toBeTruthy();
    const desc = (d as { description: string }).description;
    expect(desc.length).toBeGreaterThan(50);
    // ★ 能力不许丢：三个 action 的关键语义必须在对外描述里点到名
    for (const k of ['action=export', 'action=apply', 'action=check', '棘轮', '三态', 'dry_run']) {
      expect(desc, `description 少了「${k}」`).toContain(k);
    }
  });

  it('★ 前置校验：缺 action / 缺 project_dir / export 缺 id|before|after ⇒ 明确报错（不当成 undefined 用）', async () => {
    const noAction = await call('rules', { project_dir: root });
    expect(noAction.isError).toBe(true);
    expect(noAction.message).toContain('action');

    const noRoot = await call('rules', { action: 'check' });
    expect(noRoot.isError).toBe(true);
    expect(noRoot.message).toContain('project_dir');

    const noId = await call('rules', { action: 'export', project_dir: root, before: 'a();', after: 'b();' });
    expect(noId.isError).toBe(true);
    expect(noId.message).toContain('id');

    const noBefore = await call('rules', { action: 'export', project_dir: root, id: 'x-rule', after: 'b();' });
    expect(noBefore.isError).toBe(true);
    expect(noBefore.message).toContain('before');
  });

  it('export：dry_run 默认不写盘，但给出候选规则与三关结论', async () => {
    const r = await call('rules', {
      action: 'export',
      project_dir: root,
      id: 'prefer-profile-name',
      before: 'function f(x) {\n  return x.name;\n}',
      after: 'function f(x) {\n  return x.profile.name;\n}',
    });
    expect(fs.existsSync(rulesDir(root))).toBe(false);
    expect(r.message).toContain('dry_run：未写盘');
    expect(r.message).toMatch(/pattern/);
    expect(r.data.written).toBe(false);
    expect(r.data.ok).toBe(true);
    expect((r.data.rule as { id: string }).id).toBe('prefer-profile-name');
  });

  it('export：dry_run=false 且三关通过 ⇒ 写盘为 .md（无 BOM、可再读回）', async () => {
    const r = await call('rules', {
      action: 'export',
      project_dir: root,
      id: 'no-console-log',
      before: 'console.log(user.id);',
      after: 'logger.info(user.id);',
      tags: ['style'],
      level: 'error',
      dry_run: false,
    });
    const p = path.join(rulesDir(root), 'no-console-log.md');
    expect(fs.existsSync(p)).toBe(true);
    const raw = fs.readFileSync(p, 'utf8');
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(raw).toContain('```pattern');
    expect(raw).toContain('## 反例'); // ★ 反例夹具必须写进去
    expect(r.data.written).toBe(true);
  });

  it('★ export：三关不过时 dry_run=false 也**不写盘**（绝不先写了再说）', async () => {
    // before == after（"改了个寂寞"）：after 的反例夹具与 before 同一段文本，
    // pattern 必然命中它 ⇒ negative_hit ⇒ 三关不过 ⇒ 不许落盘。
    const r = await call('rules', {
      action: 'export',
      project_dir: root,
      id: 'noop-rule',
      before: 'alpha();',
      after: 'alpha();',
      dry_run: false,
    });
    expect(r.data.ok).toBe(false);
    expect(r.data.written).toBe(false);
    expect(fs.existsSync(path.join(rulesDir(root), 'noop-rule.md'))).toBe(false);
    expect(r.message).toContain('未写盘');
  });

  it('export：纯字面量改动仍能落盘（弱规则也是规则，但要标 no_hole）', async () => {
    const r = await call('rules', {
      action: 'export',
      project_dir: root,
      id: 'literal-swap',
      before: 'const LEVEL = 30;',
      after: 'const LEVEL = 60;',
      dry_run: false,
    });
    expect(r.data.ok).toBe(true);
    expect(r.data.written).toBe(true);
    expect(r.message).toContain('no_hole'); // 诚实标注泛化弱
  });

  it('export：非法 id 直接报错（id 就是文件名，必须安全）', async () => {
    const r = await call('rules', {
      action: 'export',
      project_dir: root,
      id: 'Bad/Name',
      before: 'a();',
      after: 'b();',
    });
    expect(r.isError).toBe(true);
    expect(r.message).toMatch(/非法规则 id/);
  });

  it('apply：dry_run 不写盘；dry_run=false 真落盘（走写闸）', async () => {
    const f = path.join(root, 'src', 'a.ts');
    fs.writeFileSync(f, 'const x = { id: 1 };\nconsole.log(x.id);\n', 'utf8');
    // 先用 export 造一条规则（针对 `.id` 访问）
    await call('rules', {
      action: 'export',
      project_dir: root,
      id: 'no-console-log',
      before: 'console.log(user.id);',
      after: 'logger.info(user.id);',
      dry_run: false,
    });

    const dry = await call('rules', { action: 'apply', project_dir: root });
    expect(fs.readFileSync(f, 'utf8')).toContain('console.log(x.id);'); // 没写
    expect(dry.message).toContain('dry_run：未写盘');
    expect(dry.data.applied).toBe(1);

    const wet = await call('rules', { action: 'apply', project_dir: root, dry_run: false });
    expect(wet.data.dryRun).toBe(false);
    expect(fs.readFileSync(f, 'utf8')).toContain('logger.info(x.id);');
    expect(wet.message).toContain('已写盘 1 个文件');
  });

  it('apply：规则库为空时如实说明，不报假成功', async () => {
    const r = await call('rules', { action: 'apply', project_dir: root });
    expect(r.message).toContain('规则库为空');
    expect(r.data.totalHits).toBe(0);
  });

  it('★ check 棘轮：无基线 ⇒ 存量算新增 ⇒ 不通过；记基线后 ⇒ 通过', async () => {
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'console.log(user.id);\nconsole.log(user.id);\n', 'utf8');
    await call('rules', {
      action: 'export',
      project_dir: root,
      id: 'no-console-log',
      before: 'console.log(user.id);',
      after: 'logger.info(user.id);',
      dry_run: false,
    });

    const before = await call('rules', { action: 'check', project_dir: root });
    expect(before.data.pass).toBe(false);
    expect((before.data.added as unknown[]).length).toBeGreaterThan(0);
    expect(before.message).toContain('新增命中');

    // 收紧棘轮
    const upd = await call('rules', { action: 'check', project_dir: root, update_baseline: true });
    expect(upd.message).toContain('棘轮基线');
    expect(fs.existsSync(path.join(rulesDir(root), 'baseline.json'))).toBe(true);

    const after = await call('rules', { action: 'check', project_dir: root });
    expect(after.data.pass).toBe(true);
    expect(after.message).toContain('通过');
  });

  it('★ check：记过基线后**新增**一处命中才 fail（存量不 fail）', async () => {
    const f = path.join(root, 'src', 'a.ts');
    fs.writeFileSync(f, 'console.log(user.id);\n', 'utf8');
    await call('rules', {
      action: 'export',
      project_dir: root,
      id: 'no-console-log',
      before: 'console.log(user.id);',
      after: 'logger.info(user.id);',
      dry_run: false,
    });
    await call('rules', { action: 'check', project_dir: root, update_baseline: true });

    fs.writeFileSync(f, 'console.log(user.id);\nconsole.log(user.id);\n', 'utf8');
    const r = await call('rules', { action: 'check', project_dir: root });
    const added = r.data.added as { added: number }[];
    expect(r.data.pass).toBe(false);
    expect(added.reduce((n, x) => n + x.added, 0)).toBe(1);
  });

  it('check：库里的坏规则（缺 pattern）不静默，回执点名', async () => {
    fs.mkdirSync(rulesDir(root), { recursive: true });
    fs.writeFileSync(path.join(rulesDir(root), 'broken.md'), '# 没有 pattern 块\n', 'utf8');
    const r = await call('rules', { action: 'check', project_dir: root });
    expect(r.message).toContain('规则读取失败');
    expect(r.message).toContain('broken.md');
  });

  it('check：规则自身夹具不过时单独点名（规则坏了先修规则）', async () => {
    fs.mkdirSync(rulesDir(root), { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir(root), 'self-broken.md'),
      [
        '```pattern', 'f($x);', '```', '', '```replace', 'g($x);', '```', '',
        // 正例写成 f(1) → 期望 g(2)：改写结果必然不符 ⇒ 夹具自检应报失败
        '## 正例', '```', 'f(1);', '```', '', '```', 'g(2);', '```', '',
        '## 反例', '```', 'g(1);', '```', '',
      ].join('\n'),
      'utf8',
    );
    const r = await call('rules', { action: 'check', project_dir: root });
    const ff = r.data.fixtureFailures as { ruleId: string }[];
    expect(ff.map((x) => x.ruleId)).toContain('self-broken');
    expect(r.data.pass).toBe(false);
    expect(r.message).toContain('夹具不过');
  });
});
