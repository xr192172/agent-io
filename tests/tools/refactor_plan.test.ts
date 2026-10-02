/**
 * plan_refactor / apply_refactor_plan（P-C，规划书 §16.3）—— 「先算清单 → 预览 → 批量落盘」成对。
 *
 * 判据（§16.8 P-C）：清单**可审、可复跑**；**重复 apply 幂等**。测试四条正对应：
 *   ① 算清单 → 落盘 → 结果正确（且清单**只读**、经 `---DATA---` 到达消费者）
 *   ② 重复 apply 幂等（第二次不重复改：written=false / 字节不变）
 *   ③ 清单被篡改 ⇒ 检出/报错（plan_id 指纹）
 *   ④ 空清单（显式空清单 = 合法 no-op，不是静默降级）
 * 另加两条自我保护：⑤ 算不出来就抛（不产半成品清单）⑥ plan_id 可复跑（同输入同源 ⇒ 同 id）
 *
 * ★ 走**注册后的 handler** 调用（不是直接调 [B]）：顺带证明清单确实经 wrapData 的
 *   `---DATA---` 通道到达消费者（G11 只静态判"通道是 wrapData"，本条是行为级补证）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_DEFS } from '../../src/application/tool_registry.js';
import { closeAllProjectCacheDbs } from '../../src/infrastructure/index/db.js';
import type { ApplyPlanResult, RefactorPlan } from '../../src/application/refactor/rf-pipeline/refactor_plan.js';

let dir: string;

function write(rel: string, content: string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

/** 每文件一份可唯一替换的样本：OLD_TOKEN 只出现一次 */
function sample(name: string): string {
  return `export const NAME = '${name}';\n\nexport function use(): string {\n  return 'OLD_TOKEN';\n}\n`;
}

function handlerOf(name: string): (args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }> {
  const d = TOOL_DEFS.find((x) => x.name === name);
  if (!d) throw new Error(`工具未注册: ${name}`);
  return d.handler;
}

/** 从 wrapData 回执里取结构化产物（`---DATA---` 之后是一行 JSON） */
function dataOf(text: string): unknown {
  const idx = text.indexOf('---DATA---');
  if (idx < 0) throw new Error(`回执里没有 ---DATA---（结构化产物没到达消费者）：\n${text.slice(0, 300)}`);
  return JSON.parse(text.slice(idx + '---DATA---'.length).trim());
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-plan-'));
});

afterEach(() => {
  closeAllProjectCacheDbs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('P-C · plan_refactor / apply_refactor_plan', () => {
  it('① 算清单（只读、data 可达）→ 落盘 → 结果正确', async () => {
    write('src/a.ts', sample('a'));
    write('src/b.ts', sample('b'));

    const planR = await handlerOf('plan_refactor')({
      project_dir: dir,
      targets: [
        { file: 'src/a.ts', old_text: "'OLD_TOKEN'", new_text: "'A_NEW'" },
        { file: 'src/b.ts', old_text: "'OLD_TOKEN'", new_text: "'B_NEW'" },
      ],
    });
    expect(planR.isError).toBeUndefined();
    const plan = dataOf(planR.text) as RefactorPlan;

    expect(plan.schema).toBe('refactor_plan/1');
    expect(plan.plan_id).toMatch(/^[0-9a-f]{16}$/);
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0].file).toBe('src/a.ts');
    expect(plan.items[0].old).toBe("'OLD_TOKEN'");
    expect(plan.items[0].new).toBe("'A_NEW'");
    expect(plan.items[0].hit.level).toBe(1); // 逐字命中
    expect(plan.items[0].preview).toContain('A_NEW'); // 预览带新内容
    expect(plan.files.map((f) => f.file).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(plan.files[0].base_fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(plan.summary).toMatchObject({ items: 2, files: 2 });
    expect(plan.summary.by_level['1']).toBe(2);

    // ★ 只读：算完清单，源码一个字节都没动
    expect(read('src/a.ts')).toContain("'OLD_TOKEN'");
    expect(read('src/b.ts')).toContain("'OLD_TOKEN'");

    const applyR = await handlerOf('apply_refactor_plan')({ project_dir: dir, plan });
    expect(applyR.isError).toBeUndefined();
    const res = dataOf(applyR.text) as ApplyPlanResult;

    expect(res.ok).toBe(true);
    expect(res.written).toBe(true);
    expect(res.total).toBe(2);
    expect(res.applied).toBe(2);
    expect(res.already_applied).toBe(0);
    expect(res.failed).toBe(0);
    for (const it of res.items) {
      expect(it.status).toBe('applied');
      expect(it.index_synced).toBeTruthy(); // ★ 证明走的是 edit_code 的落地路径（索引写穿）
    }
    expect(read('src/a.ts')).toContain("'A_NEW'");
    expect(read('src/b.ts')).toContain("'B_NEW'");
    expect(read('src/a.ts')).not.toContain("'OLD_TOKEN'");
  });

  it('② 重复 apply 幂等：第二次全部 already_applied、不写盘、字节不变', async () => {
    write('src/a.ts', sample('a'));
    write('src/b.ts', sample('b'));
    const plan = dataOf(
      (
        await handlerOf('plan_refactor')({
          project_dir: dir,
          targets: [
            { file: 'src/a.ts', old_text: "'OLD_TOKEN'", new_text: "'A_NEW'" },
            { file: 'src/b.ts', old_text: "'OLD_TOKEN'", new_text: "'B_NEW'" },
          ],
        })
      ).text,
    ) as RefactorPlan;

    const first = dataOf((await handlerOf('apply_refactor_plan')({ project_dir: dir, plan })).text) as ApplyPlanResult;
    expect(first.applied).toBe(2);
    expect(first.written).toBe(true);
    const afterFirst = read('src/a.ts');

    const second = dataOf((await handlerOf('apply_refactor_plan')({ project_dir: dir, plan })).text) as ApplyPlanResult;
    expect(second.ok).toBe(true);
    expect(second.written).toBe(false); // ★ 判据：第二次不重复改
    expect(second.applied).toBe(0);
    expect(second.already_applied).toBe(2);
    expect(second.failed).toBe(0);
    expect(second.items.every((i) => i.status === 'already_applied')).toBe(true);
    expect(read('src/a.ts')).toBe(afterFirst); // 字节不变
  });

  it('③ 清单被篡改 ⇒ 检出/报错（plan_id 指纹不符），且不落盘', async () => {
    write('src/a.ts', sample('a'));
    const plan = dataOf(
      (
        await handlerOf('plan_refactor')({
          project_dir: dir,
          targets: [{ file: 'src/a.ts', old_text: "'OLD_TOKEN'", new_text: "'A_NEW'" }],
        })
      ).text,
    ) as RefactorPlan;

    // 篡改 1：改 new
    const tamperedNew = JSON.parse(JSON.stringify(plan)) as RefactorPlan;
    tamperedNew.items[0].new = "'TAMPERED'";
    const r1 = await handlerOf('apply_refactor_plan')({ project_dir: dir, plan: tamperedNew });
    expect(r1.isError).toBe(true);
    expect(r1.text).toMatch(/指纹不符/);

    // 篡改 2：改源文件基线指纹
    const tamperedFp = JSON.parse(JSON.stringify(plan)) as RefactorPlan;
    tamperedFp.files[0].base_fingerprint = 'deadbeefdeadbeef';
    const r2 = await handlerOf('apply_refactor_plan')({ project_dir: dir, plan: tamperedFp });
    expect(r2.isError).toBe(true);
    expect(r2.text).toMatch(/指纹不符/);

    // 篡改 3：删一项（重排/增删都应变指纹）
    const tamperedDrop = JSON.parse(JSON.stringify(plan)) as RefactorPlan;
    tamperedDrop.items = [];
    const r3 = await handlerOf('apply_refactor_plan')({ project_dir: dir, plan: tamperedDrop });
    expect(r3.isError).toBe(true);
    expect(r3.text).toMatch(/指纹不符/);

    // 三次都被拦下 ⇒ 源码仍未被改动
    expect(read('src/a.ts')).toContain("'OLD_TOKEN'");
  });

  it('④ 空清单：显式空清单（items=[]）+ apply 合法 no-op', async () => {
    const planR = await handlerOf('plan_refactor')({ project_dir: dir, targets: [] });
    expect(planR.isError).toBeUndefined();
    const plan = dataOf(planR.text) as RefactorPlan;
    expect(plan.items).toEqual([]);
    expect(plan.files).toEqual([]);
    expect(plan.summary.items).toBe(0);
    expect(plan.plan_id).toMatch(/^[0-9a-f]{16}$/);
    expect(planR.text).toContain('空清单'); // 不是静默降级：明确说"没东西可做"

    const applyR = await handlerOf('apply_refactor_plan')({ project_dir: dir, plan });
    expect(applyR.isError).toBeUndefined();
    const res = dataOf(applyR.text) as ApplyPlanResult;
    expect(res.ok).toBe(true);
    expect(res.written).toBe(false);
    expect(res.total).toBe(0);
    expect(res.applied).toBe(0);
    expect(res.failed).toBe(0);
  });

  it('⑤ 算不出来就抛（不产半成品清单）', async () => {
    write('src/a.ts', sample('a'));
    const r = await handlerOf('plan_refactor')({
      project_dir: dir,
      targets: [{ file: 'src/a.ts', old_text: "'NOT_PRESENT_ANYWHERE'", new_text: "'X'" }],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/无法规划/);
    expect(r.text).toMatch(/未找到 old_text|四级均未命中/);
  });

  it('⑥ plan_id 可复跑：同输入 + 同源 ⇒ 同 id（不依赖运行时临时状态）', async () => {
    write('src/a.ts', sample('a'));
    const args = {
      project_dir: dir,
      targets: [{ file: 'src/a.ts', old_text: "'OLD_TOKEN'", new_text: "'A_NEW'" }],
    };
    const p1 = dataOf((await handlerOf('plan_refactor')(args)).text) as RefactorPlan;
    const p2 = dataOf((await handlerOf('plan_refactor')(args)).text) as RefactorPlan;
    expect(p2.plan_id).toBe(p1.plan_id);

    // 同文件两项：按序叠加（第二项基于第一项应用后的内容规划），两次 apply 仍幂等
    const plan = dataOf(
      (
        await handlerOf('plan_refactor')({
          project_dir: dir,
          targets: [
            { file: 'src/a.ts', old_text: "'OLD_TOKEN'", new_text: "'FIRST'" },
            { file: 'src/a.ts', old_text: "'FIRST'", new_text: "'SECOND'" },
          ],
        })
      ).text,
    ) as RefactorPlan;
    expect(plan.items).toHaveLength(2);
    const r1 = dataOf((await handlerOf('apply_refactor_plan')({ project_dir: dir, plan })).text) as ApplyPlanResult;
    expect(r1.applied).toBe(2);
    expect(read('src/a.ts')).toContain("'SECOND'");
    const r2 = dataOf((await handlerOf('apply_refactor_plan')({ project_dir: dir, plan })).text) as ApplyPlanResult;
    expect(r2.already_applied).toBe(2);
    expect(r2.written).toBe(false);
  });

  it('⑦ atomic：一项与"清单 vs 实际"冲突 ⇒ atomic=true 整批不落盘；atomic=false 逐项独立', async () => {
    write('src/a.ts', sample('a'));
    write('src/b.ts', sample('b'));
    const plan = dataOf(
      (
        await handlerOf('plan_refactor')({
          project_dir: dir,
          targets: [
            { file: 'src/a.ts', old_text: "'OLD_TOKEN'", new_text: "'A_NEW'" },
            { file: 'src/b.ts', old_text: "'OLD_TOKEN'", new_text: "'B_NEW'" },
          ],
        })
      ).text,
    ) as RefactorPlan;

    // 规划之后把 b.ts 改成"既非 base 也非 post"的状态（OLD_TOKEN 没了、B_NEW 也没有）⇒ 该项冲突。
    write('src/b.ts', sample('b').replace("'OLD_TOKEN'", "'SOMETHING_ELSE'"));

    const atomicR = dataOf(
      (await handlerOf('apply_refactor_plan')({ project_dir: dir, plan, atomic: true })).text,
    ) as ApplyPlanResult;
    expect(atomicR.ok).toBe(false);
    expect(atomicR.written).toBe(false); // ★ 全成或全不成
    expect(atomicR.applied).toBe(0);
    expect(atomicR.failed).toBe(2); // a 被原子性拦住，b 真冲突
    expect(read('src/a.ts')).toContain("'OLD_TOKEN'"); // a 未落盘

    // 缺省（非原子）：逐项独立 —— a 落盘、b 报失败
    const looseR = dataOf((await handlerOf('apply_refactor_plan')({ project_dir: dir, plan })).text) as ApplyPlanResult;
    expect(looseR.ok).toBe(false);
    expect(looseR.applied).toBe(1);
    expect(looseR.failed).toBe(1);
    expect(looseR.written).toBe(true);
    expect(read('src/a.ts')).toContain("'A_NEW'");
    expect(read('src/b.ts')).toContain("'SOMETHING_ELSE'");
  });
});
