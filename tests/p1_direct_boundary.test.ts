/**
 * P1 · `edit_code` direct 直通车的**结构边界**机器判据（审计 D4-12 修复的检测点）
 *
 * ## 它挡的事故
 * direct 的边界一直只有闸 note 里的散文（「改类型签名 / 新文件 / 接口 ⇒ 不许 direct——模型自判」），
 * 零机器判据 ⇒ 滥用结构性不可发现（审计原话：有留痕、无守门）。
 *
 * ## 判据（实现住 edit_code.ts 的 openSourceWrite 之前的守卫块）
 * · R1 新文件：`!fileExists && op==='insert'` ⇒ 硬拒绝（新建结构 = 设计变更）
 * · R2 接口/类型目标：op ∈ {replace,delete} 且命中符号 kind ∈ {interface,type} ⇒ 硬拒绝（设计面）
 * · R3 签名风险（警告级）：replace 整符号（sub!=='body'）目标 function/method ⇒ 放行 + 回执 warning
 *
 * ## 消融口径（文件头钉死，改坏实现时哪条红）
 * · 删掉守卫块（恢复无条件放行）⇒ 用例 ①②③ 红（该拒绝的没拒绝）
 * · 把 R3 从"放行+warning"改成"拒绝" ⇒ 用例 ④⑥ 红（误伤合法直通）
 * · 把 R2 的 kind 判断放宽到含 class/function ⇒ 用例 ④⑤ 红（误伤函数替换）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ★ 临时夹具项目里没有画布（tasks.db#plans）—— 本文件验的是结构判据，不是画布闸。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const { editCode } = await import('../src/application/refactor/edit/edit_code.js');
// ★ 落盘按项目根开 cache.db（进程级缓存）；Windows 句柄没关 ⇒ 删目录 EBUSY ⇒ 先关再删。
const { closeAllProjectCacheDbs } = await import('../src/infrastructure/index/db.js');

function cleanup(proj: string): void {
  closeAllProjectCacheDbs();
  fs.rmSync(proj, { recursive: true, force: true });
}

/** 造一个夹具项目（不建 .agent-io/ —— 闸按"本项目不用任务系统"放行） */
function mkProject(files: Record<string, string>): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-direct-boundary-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(proj, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return proj;
}

const INTERFACE_FILE = 'src/types.ts';
const INTERFACE_SRC = 'export interface Greeter {\n  greet(name: string): string;\n}\n';
const TYPE_FILE = 'src/kinds.ts';
const TYPE_SRC = 'export type Handler = (x: number) => string;\n';
const FN_FILE = 'src/math.ts';
const FN_SRC = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';

test('① R1 新文件：direct + insert 不存在的文件 ⇒ 拒绝且消息含「新文件」', async () => {
  const proj = mkProject({});
  try {
    await assert.rejects(
      editCode({
        project_dir: proj,
        file: 'src/newmod.ts',
        op: 'insert',
        code: 'export const X = 1;\n',
        actor: 'test:direct-boundary',
        direct: true,
      }),
      (e: Error) => /新文件/.test(e.message) && /direct 结构判据拒绝/.test(e.message),
      'R1 必须拒绝 insert 新文件（消息含「新文件」+「direct 结构判据拒绝」）',
    );
    assert.ok(!fs.existsSync(path.join(proj, 'src/newmod.ts')), '拒绝 ⇒ 文件不许被创建');
  } finally {
    cleanup(proj);
  }
});

test('② R2 接口目标：direct + replace 一个 interface ⇒ 拒绝且消息含「接口」', async () => {
  const proj = mkProject({ [INTERFACE_FILE]: INTERFACE_SRC });
  try {
    await assert.rejects(
      editCode({
        project_dir: proj,
        file: INTERFACE_FILE,
        op: 'replace',
        symbol: 'Greeter',
        code: 'export interface Greeter {\n  greet(name: string, loud: boolean): string;\n}\n',
        actor: 'test:direct-boundary',
        direct: true,
      }),
      (e: Error) => /接口/.test(e.message) && /direct 结构判据拒绝/.test(e.message),
      'R2 必须拒绝 interface 整体替换',
    );
    assert.ok(fs.readFileSync(path.join(proj, INTERFACE_FILE), 'utf8').includes('greet(name: string)'), '拒绝 ⇒ 原文件不许被改');
  } finally {
    cleanup(proj);
  }
});

test('③ R2 类型目标：direct + replace 一个 type 别名 ⇒ 拒绝（R2 覆盖 kind=type）', async () => {
  const proj = mkProject({ [TYPE_FILE]: TYPE_SRC });
  try {
    await assert.rejects(
      editCode({
        project_dir: proj,
        file: TYPE_FILE,
        op: 'replace',
        symbol: 'Handler',
        code: 'export type Handler = (x: number, y: string) => string;\n',
        actor: 'test:direct-boundary',
        direct: true,
      }),
      (e: Error) => /direct 结构判据拒绝/.test(e.message),
      'R2 必须拒绝 type 别名替换（设计面）',
    );
  } finally {
    cleanup(proj);
  }
});

test('④ 对照（放行）：direct + replace sub=body 普通函数 ⇒ 成功写盘（R3 不误伤 body 小改）', async () => {
  const proj = mkProject({ [FN_FILE]: FN_SRC });
  try {
    // ★ 回执形态注：editCode 公共回执是 {message,data,touched}（gate warnings 走 MCP 层的 gateOut，
    //   不在公共回执里）⇒ 放行的判据 = 不抛 + 文件内容真的变了（读盘验，不信回执字段）。
    await editCode({
      project_dir: proj,
      file: FN_FILE,
      op: 'replace',
      symbol: 'add',
      sub: 'body',
      code: '{\n  return a + b + 0;\n}',
      actor: 'test:direct-boundary',
      direct: true,
    });
    assert.ok(fs.readFileSync(path.join(proj, FN_FILE), 'utf8').includes('a + b + 0'), 'body 小改真的落盘');
  } finally {
    cleanup(proj);
  }
});

test('⑤ 对照（放行）：direct + replace_text 已存在文件 ⇒ 成功（replace_text 是文本级，结构判据不适用）', async () => {
  const proj = mkProject({ [FN_FILE]: FN_SRC });
  try {
    await editCode({
      project_dir: proj,
      file: FN_FILE,
      op: 'replace_text',
      old_text: 'return a + b;',
      new_text: 'return a + b; // tweaked',
      actor: 'test:direct-boundary',
      direct: true,
    });
    assert.ok(fs.readFileSync(path.join(proj, FN_FILE), 'utf8').includes('// tweaked'), 'replace_text 真的落盘（old_text 必须已存在 ⇒ 新文件判据天然不适用）');
  } finally {
    cleanup(proj);
  }
});

test('⑥ R3 签名风险：direct + 整符号替换普通函数 ⇒ 放行（新签名落盘；警告在 MCP 层回执）', async () => {
  const proj = mkProject({ [FN_FILE]: FN_SRC });
  try {
    // ★ R3 是警告级：放行 + 遥测 signatureRisk + gate 层 warning（txn.warnings）。
    //   公共回执不暴露 gate warnings（同 ④ 注）⇒ 这里验"放行且新签名真落盘"；
    //   警告文本的可见性由 MCP 回执层（gateOut.warnings = txn.warnings 同一数组引用）保证。
    await editCode({
      project_dir: proj,
      file: FN_FILE,
      op: 'replace',
      symbol: 'add',
      code: 'export function add(a: number, b: number, c: number): number {\n  return a + b + c;\n}\n',
      actor: 'test:direct-boundary',
      direct: true,
    });
    assert.ok(fs.readFileSync(path.join(proj, FN_FILE), 'utf8').includes('c: number'), '整符号替换放行且新签名落盘');
  } finally {
    cleanup(proj);
  }
});
