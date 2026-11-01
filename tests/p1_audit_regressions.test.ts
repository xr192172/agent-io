/**
 * P1 · 外部审计三个 P1 的永久守卫（2026-11-01）。
 *
 * 三条都是"回执/读数在撒谎"，且都**不是**靠再读一遍代码能守住的（必须有反例读数）：
 *   ⑤ `rename_file` 中途失败只删目标拷贝 ⇒ b.ts 留下悬空 import，回执却说"已回滚"；
 *   ⑥ `expect:'absent'` 在 `verdicts.length === 0` 时判 pass（探针名写错 / 没插桩就假绿），
 *      而同文件非 absent 分支对**同一情形**判 unsupported；
 *   ⑦ `openDb` 每次打开都无条件写 `schema_versions` ⇒ 第二个进程（常驻 server 持着 cache.db/-wal）
 *      整体失败，且抛的是裸 SQLite 原文。
 *
 * ★ 每条用例的形状都是"**同一输入，改前改后必须能分开读**"（见各 case 的「改前」注释）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { renameFile } from '../src/application/refactor/rename/rename_file.js';
import { judgeExpectations } from '../src/application/design/intent/expectations.js';
import { openDb } from '../src/infrastructure/index/db.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** 在临时数据根里跑一段（`AGENT_IO_HOME` 是判据读取的落点，见 storage 的 getDataHome） */
function withHome(fn: () => Promise<void> | void): Promise<void> {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  return (async () => {
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.AGENT_IO_HOME;
      else process.env.AGENT_IO_HOME = prev;
      rmRf(home);
    }
  })();
}

// ════════════════════════════════════════════════════════════════════
// ⑤ rename_file 中途失败 ⇒ importer 逐字节还原（改前：只删目标拷贝，b.ts 留悬空 import）
// ════════════════════════════════════════════════════════════════════
test('⑤ rename_file 中途失败 ⇒ importer 逐字节还原、目标不残留、回执如实报还原条数（改前只说"已回滚拷贝"）', async () => {
  await withHome(async () => {
    const prevPlan = process.env.AGENT_IO_REQUIRE_PLAN;
    process.env.AGENT_IO_REQUIRE_PLAN = '0'; // 夹具项目没有画布；本证测的是回滚，不是闸
    const proj = makeTempHome();
    const srcDir = path.join(proj, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const A = "export const A = 1;\nexport function fa() { return A; }\n";
    const B = "import { A } from './a.js';\nexport const B = A + 1;\n";
    const C = "import { fa } from './a.js';\nexport const C = fa();\n";
    fs.writeFileSync(path.join(srcDir, 'a.ts'), A, 'utf-8');
    fs.writeFileSync(path.join(srcDir, 'b.ts'), B, 'utf-8');
    fs.writeFileSync(path.join(srcDir, 'c.ts'), C, 'utf-8');

    // 造"第二个 importer 被占用"：让写 c.ts 抛 EPERM（这是 Windows 上最真实的形态）
    const orig = fs.writeFileSync;
    const patched = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(p).endsWith('c.ts')) {
        throw Object.assign(new Error('EPERM: operation not permitted (模拟第二个 importer 被占用)'), { code: 'EPERM' });
      }
      return (orig as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.writeFileSync;
    fs.writeFileSync = patched;
    let r: Awaited<ReturnType<typeof renameFile>>;
    try {
      r = await renameFile({ project_dir: proj, from: 'src/a.ts', to: 'src/z.ts', actor: 'subagent:p1-batch' });
    } finally {
      fs.writeFileSync = orig;
      if (prevPlan === undefined) delete process.env.AGENT_IO_REQUIRE_PLAN;
      else process.env.AGENT_IO_REQUIRE_PLAN = prevPlan;
    }

    // ① 回执：失败、且**不许**再出现"已回滚拷贝"这种不全的读法
    assert.equal(r.ok, false, '中途失败必须 ok:false');
    assert.equal(r.moved, false);
    const said = (r.blocked ?? []).join('\n');
    assert.doesNotMatch(said, /已回滚拷贝/, `回执不许再说"已回滚拷贝"（它把只删目标拷贝说成已回滚）：\n${said}`);

    // ② ★ 红线：importer 逐字节还原（改前 b.ts 会变成 `from './z.js'` ⇒ 悬空）
    assert.equal(fs.readFileSync(path.join(srcDir, 'b.ts'), 'utf-8'), B, 'b.ts 必须逐字节回到调用前（改前是悬空的 ./z.js）');
    assert.equal(fs.readFileSync(path.join(srcDir, 'c.ts'), 'utf-8'), C, 'c.ts 没被写成新内容 ⇒ 也必须还是原字节');

    // ③ 源文件还在、目标不残留（改前 a.ts 在、z.ts 不在，但 b.ts 已经坏了）
    assert.equal(fs.existsSync(path.join(srcDir, 'a.ts')), true, '源文件必须还在');
    assert.equal(fs.existsSync(path.join(srcDir, 'z.ts')), false, '本次新建的目标文件必须被删掉');

    // ④ 0.12 ③：回执带分母（还原了几个 / 未还原几个），不是一句"已回滚"
    assert.match(said, /已还原 \d+ 个 importer/, `回执必须给还原条数，实际：\n${said}`);
    assert.match(said, /未能还原 \d+ 个 importer/, `回执必须给未还原条数（分母的另一半），实际：\n${said}`);
    rmRf(proj);
  });
});

// ════════════════════════════════════════════════════════════════════
// ⑥ expect:'absent' 在 0 条 verdict 时 ⇒ unsupported（改前 pass = 探针名写错就假绿）
// ════════════════════════════════════════════════════════════════════
test("⑥ expect:'absent' 且 verdicts 为空 ⇒ unsupported，与同情形下的非 absent 口径一致（改前 absent 判 pass）", async () => {
  await withHome(async () => {
    const project = makeTempHome();
    const dir = path.join(project, '.agent', 'observe');
    fs.mkdirSync(dir, { recursive: true });
    // 事件文件里有事件，但**目标探针/规则一条都没有**（探针名写错 / 没插桩的现场）
    fs.writeFileSync(
      path.join(dir, 'events-x.jsonl'),
      JSON.stringify({ probe: 'other.mod.enter', rule: 'r-other', result: 'ok', ts: Date.now(), trace_id: 't1' }) + '\n',
      'utf-8',
    );
    const items = [
      {
        node_id: 'absent_probe',
        node_label: 'absent 假绿守卫',
        expectation: { kind: 'runtime', probe: 'want.absent.typo', expect: 'absent', why: '造一个 expect:absent 但 verdicts:[] 的用例' },
      },
      {
        node_id: 'ok_probe',
        node_label: '同情形非 absent（对照）',
        expectation: { kind: 'runtime', probe: 'want.absent.typo', expect: 'ok', why: '同一情形的另一条路径，口径必须一致' },
      },
    ] as never;
    const rep = await judgeExpectations(project, items);
    const byId = new Map(rep.items.map((x) => [x.node_id, x]));
    const absent = byId.get('absent_probe');
    const okOne = byId.get('ok_probe');

    // ★ 红线：改前这里是 pass（detail 还写着"符合预期：不许出现"）
    assert.equal(absent?.verdict, 'unsupported', `没有 verdict = 没有证据 ⇒ 必须 unsupported（改前 pass），实际：${absent?.verdict} / ${absent?.detail}`);
    assert.match(String(absent?.detail), /没有 verdict/, 'detail 必须点名"没有 verdict ⇒ 没有证据"');
    assert.doesNotMatch(String(absent?.detail), /符合预期/, '不许把"空"写成"符合预期"');

    // 两条路径口径一致（这才是"一处权威"）
    assert.equal(okOne?.verdict, 'unsupported', '同一情形的非 absent 分支也必须是 unsupported（改前就是 unsupported）');
    assert.equal(okOne?.verdict, absent?.verdict, 'absent 与非 absent 对同一情形不许再判出两种结果');
    rmRf(project);
  });
});

// ════════════════════════════════════════════════════════════════════
// ⑦ openDb：已是最新 schema ⇒ 一个字节都不写（只读库也能开）；
//    确实要写而写不进 ⇒ 抛人话（"另一个进程正持有 cache.db"），不是裸 SQLite 原文
// ════════════════════════════════════════════════════════════════════
test('⑦ openDb：只读 cache.db（第二个进程写不进的形态）不写就能开；确实要写时抛出人话', async () => {
  await withHome(async () => {
    const home = makeTempHome();
    const dbFile = path.join(home, 'cache.db');
    // ① 正常路径：建库 + 关掉（先证明"不持有时的正常路径仍绿"）
    const first = openDb(dbFile);
    const v1 = first.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v?: number };
    assert.ok((v1.v ?? 0) > 0, '首次打开必须真把 schema 落盘（这是"要对齐"那条路）');
    first.close();

    const setReadOnly = (on: boolean): void => {
      // ★ Windows 上 chmod 只认"写位"：0o444 = 只读文件（SQLite 于是拿到 SQLITE_READONLY）
      fs.chmodSync(dbFile, on ? 0o444 : 0o666);
    };

    // ② 已是最新 + 只读 ⇒ **不写就能开**（改前：抛 attempt to write a readonly database）
    setReadOnly(true);
    try {
      const ro = openDb(dbFile);
      const v2 = ro.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v?: number };
      assert.equal(v2.v, v1.v, '只读打开后版本不变（没有写）');
      const rows = ro.prepare('SELECT COUNT(*) AS c FROM files').get() as { c?: number };
      assert.equal(typeof rows.c, 'number', '只读打开后必须**能读**（不是打开了个空壳）');
      ro.close();
    } finally {
      setReadOnly(false);
    }

    // ③ 需要对齐（版本行被清掉）+ 只读 ⇒ 必须抛人话：指出"另一个进程正持有 cache.db"，并附原文
    const wipe = openDb(dbFile);
    wipe.exec('DELETE FROM schema_versions');
    wipe.close();
    setReadOnly(true);
    try {
      assert.throws(
        () => openDb(dbFile),
        (err: Error) => {
          assert.match(err.message, /另一个进程（可能是常驻 MCP server）/, `必须点名真正的持有者（改前是裸 SQLite 原文），实际：${err.message}`);
          assert.match(err.message, /AGENT_IO_HOME/, '必须给出路（换一个数据根）');
          assert.match(err.message, /SQLite 原文：attempt to write a readonly database/, '要保留原文供排查');
          return true;
        },
      );
    } finally {
      setReadOnly(false);
    }

    // ④ 反方向：可写 + 需对齐 ⇒ 正常补齐（守卫不许把正常路径也染红）
    const fixed = openDb(dbFile);
    const v3 = fixed.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v?: number };
    assert.equal(v3.v, v1.v, '可写时应把版本行补回来');
    fixed.close();
    rmRf(home);
  });
});
