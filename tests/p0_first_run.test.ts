/**
 * P0 · **首跑墙**（2026-11-01 · 两轮外部审计都指到同一处：新用户第一小时撞墙）
 *
 * ## 它钉住的四件事（每件都对应一条可判读数）
 * ① **基线**：按 README 原样走「导入 → 看结构 → 改一行」，**没开首跑模式**时必须被拒
 *    —— 而且拒的是**任务闸**（`E-TASK-001`），不是画布闸：README 原来那个"救命开关"
 *    `AGENT_IO_REQUIRE_PLAN=0` 只管画布闸，改了它照样改不动（壁 ①）；
 * ② **首跑模式**（`AGENT_IO_FIRST_RUN=1`）：同一串调用**零被拒**，且那一次改动**真的落盘**
 *    （不是"没报错但也没改"）；
 * ③ **那一行**：开了首跑模式，**每一次回执**都带「本次是首跑模式…」（含写回执）；
 *    unset 之后**两道闸各自恢复**（各一条断言，不许只测一道）；
 * ④ **同数**：`preparing` 回执说"要补 N 条" ⇒ 补 **N-1** 条 `start` **失败**、补到 **N** 才过。
 * ⑤ README 里那串首屏命令在**空 home** 上逐条不报错。
 *
 * ## 为什么"改前基线"要留在测试里（而不是只写在派工单上）
 * 派工单里的数字会漂，而这条墙的判据就是"两次调用的**被拒次数**"：把基线钉成断言，
 * 以后谁把首跑模式做成默认开 / 谁让任务闸又在首跑模式下拦，这条会当场红。
 * ★ 改前实测（2026-11-01，空 home + 6 文件演示项目，`dist` CLI，README「第一次用」档 `AGENT_IO_REQUIRE_PLAN=0`）：
 *   `调用 3 次 / 被拒 1 次`（第 3 次 `edit_code` ⇒ `拒绝落盘（任务闸）`）。
 *   默认档（不设任何 env）更贵：`调用 10 次 / 被拒 2 次`（先 `E-TASK-001`，补卡后 `E-PLAN-023`）。
 *
 * ## 边界（诚实清单）
 * · 只写**仓外**临时 home / 临时项目（`makeTempHome`）⇒ 真数据仓与 `.agent-io/` 一个字节都不碰；
 * · 不证明 MCP 进程内的**启动路径**（本文件走 `invokeTool` = MCP 面与 CLI 面共用的唯一咽喉）；
 * · 首跑模式**只降级两道闸**：A7「卡不是你领的」/ 租约代际 / 前置未 done 仍拦 —— 本文件不测那三条
 *   （它们由 `p0_task_write_locked` / `p0_gate_exemption` 一族覆盖）。
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TOOL_DEFS } from '../src/application/tool_registry.js';
import { invokeTool } from '../src/presentation/mcp/server_registry.js';
import { rmRf } from './helpers/i1_fixture.js';

const OWNER = 'subagent:first-run';
/** 首跑提示的**可判片段**（★ 不在本文件抄整句：整句住 `write_gate#FIRST_RUN_BANNER`，这里只钉"它确实被印出来了"） */
const BANNER_HEAD = '本次是首跑模式';
const BANNER_TAIL = 'AGENT_IO_FIRST_RUN';
/** 演示项目的 4 个文件：`a.js` 被改，`b.js` 调 `a.js`（让"现在就该绿/现在还红"两档样例都有事实可用） */
const DEMO_FILES: Record<string, string> = {
  'src/a.js': `export function total(items) {\n  return items.reduce((s, x) => s + x, 0);\n}\n\nexport const label = 'a';\n`,
  'src/b.js': `import { total } from './a.js';\n\nexport function avg(items) {\n  return items.length ? total(items) / items.length : 0;\n}\n`,
  'src/c.js': `export function mul(a, b) {\n  return a * b;\n}\n`,
  'src/d.js': `import { mul } from './c.js';\n\nexport const area = (w, h) => mul(w, h);\n`,
};

const TMP_ROOTS: string[] = [];
after(() => {
  for (const r of TMP_ROOTS) rmRf(r);
});

/** 一套隔离现场：临时 home（册/库/注册表都在这）+ 临时演示项目 */
interface Case {
  root: string;
  home: string;
  proj: string;
  feature: string;
}
let caseSeq = 0;
function mkCase(): Case {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-firstrun-'));
  TMP_ROOTS.push(root);
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  for (const [rel, body] of Object.entries(DEMO_FILES)) fs.writeFileSync(path.join(proj, rel), body, 'utf8');
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'demo', type: 'module' }, null, 2), 'utf8');
  caseSeq += 1;
  return { root, home, proj, feature: `firstrun${caseSeq}` };
}

/**
 * 切到这套现场，并按档位设开关。
 * ★ `AGENT_IO_DATA_ROOT` 必须**清掉**：它优先级高于 `HOME`（`storage#getStorageRoot`），
 *   不清就把现场切回测试门注入的那个根 ⇒ 断言会对着**别的项目**的册跑。
 */
function useCase(c: Case, opts: { firstRun?: boolean; planEnv?: string } = {}): void {
  delete process.env.AGENT_IO_DATA_ROOT;
  process.env.AGENT_IO_HOME = c.home;
  if (opts.firstRun) process.env.AGENT_IO_FIRST_RUN = '1';
  else delete process.env.AGENT_IO_FIRST_RUN;
  if (opts.planEnv === undefined) delete process.env.AGENT_IO_REQUIRE_PLAN;
  else process.env.AGENT_IO_REQUIRE_PLAN = opts.planEnv;
}

interface Receipt {
  tool: string;
  text: string;
  rejected: boolean;
}
/** 一次调用 = 一次**回执**（走唯一咽喉 `invokeTool`，与 MCP / CLI 同一个面） */
async function call(tool: string, args: Record<string, unknown>): Promise<Receipt> {
  const def = TOOL_DEFS.find((d) => d.name === tool);
  assert.ok(def, `没有注册工具 "${tool}"（测试写错了名字？）`);
  const r = await invokeTool(def, args, 'cert');
  return { tool, text: String(r.text ?? ''), rejected: r.isError === true };
}

const sheetFile = (c: Case): string => path.join(c.proj, '.agent-io', 'design', `${c.feature}.dsl.json`);
/** 项目里某个相对路径对应的**文件节点 id**（从册里现取，不猜命名规则） */
function nodeIdOfFile(c: Case, rel: string): string {
  const dsl = JSON.parse(fs.readFileSync(sheetFile(c), 'utf8')) as {
    geometry?: { nodes?: Array<{ id: string; path?: string }> };
    semantic?: { files?: Array<{ id: string; path?: string }> };
  };
  const byNode = (dsl.geometry?.nodes ?? []).find((n) => n.path === rel)?.id;
  const bySem = (dsl.semantic?.files ?? []).find((f) => f.path === rel)?.id;
  const id = byNode ?? bySem;
  assert.ok(id, `册里找不到 ${rel} 的节点（导入没成功？）`);
  return id;
}
const taskStateOf = (c: Case, nodeId: string): string | null => {
  const dsl = JSON.parse(fs.readFileSync(sheetFile(c), 'utf8')) as {
    geometry?: { nodes?: Array<{ id: string; task?: { state?: string } }> };
  };
  return (dsl.geometry?.nodes ?? []).find((n) => n.id === nodeId)?.task?.state ?? null;
};

/** README 首屏那串命令（row 1..3 是"导入 → 看结构 → 改一行"；只剩最后一步要参数） */
const editArgs = (c: Case) => ({
  project_dir: c.proj,
  actor: OWNER,
  file: 'src/a.js',
  op: 'replace_text',
  old_text: "export const label = 'a';",
  new_text: "export const label = 'a1';",
});

/**
 * 立卡并**拒领**一次，返回 N（claim 说"要补 N 条"）。
 * ★ T-35：T-28 砍掉 preparing 之后，这一步不再是"领进 preparing"，而是「判据不够 ⇒ 原子拒领」
 * （回执非 error、state 仍 candidate、一个字节不落盘）。
 */
async function claimUntilBlocked(c: Case, nodeId: string): Promise<number> {
  const pub = await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `从决策卡立卡 ${nodeId}（feature=${c.feature}）`,
    operations: [{ type: 'task', op: 'publish', id: nodeId }],
  });
  assert.equal(pub.rejected, false, `publish 不该被拒：${pub.text.slice(0, 300)}`);
  const cl = await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `领取 ${nodeId} 的写权，用来改 src/a.js 的 label 常量`,
    operations: [{ type: 'task', op: 'claim', id: nodeId, data: { owner: OWNER } }],
  });
  assert.equal(cl.rejected, false, `claim 不该被拒（"判据不够"是预期内结果，不是程序错误）：${cl.text.slice(0, 300)}`);
  assert.match(cl.text, /未领取/, `拒领回执必须点名「未领取」：${cl.text.slice(0, 300)}`);
  // ★ 2026-11-09 迁移（门槛：条数 → **证据族**）：回执必须点名缺的是**行为族**，
  //   而不是"要补 N 条"。返回"还缺几族"（当前规则下最多 1 族）。
  assert.match(cl.text, /没有行为族证据/, `拒领回执必须点名缺的那一族（实测：${cl.text.slice(0, 400)}）`);
  assert.match(cl.text, /行为族/, `拒领回执必须说清补什么（行为族）：${cl.text.slice(0, 400)}`);
  return 1;
}

const runCriteria = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'run',
    expect: `fs.existsSync(path.join(root, 'src/a.js'))`,
    why: `第 ${i + 1} 条：src/a.js 必须仍然存在（首跑夹具，当场可判）`,
  }));

// ════════════════════════════════════════════════════════════════════
// ① 改前基线：README 原样（`AGENT_IO_REQUIRE_PLAN=0`）**仍然改不动**
// ════════════════════════════════════════════════════════════════════
test('① 基线：按 README 走「导入 → 看结构 → 改一行」，任务闸仍然拒（E-TASK-001），文件一个字节没变', async () => {
  const c = mkCase();
  useCase(c, { planEnv: '0' }); // = README「第一次用」推荐的那一档
  const calls: Receipt[] = [];
  calls.push(await call('import_project', { project_dir: c.proj, feature: c.feature }));
  calls.push(await call('get_dsl', { feature: c.feature, query: 'files' }));
  calls.push(await call('edit_code', editArgs(c)));

  const rejected = calls.filter((x) => x.rejected);
  assert.equal(
    rejected.length,
    1,
    `改前基线必须是"多次调用里有被拒"：实测 ${calls.length} 次调用 / ${rejected.length} 次被拒；` +
      `被拒的工具=${JSON.stringify(rejected.map((x) => x.tool))}`,
  );
  const last = calls[2];
  assert.ok(last.rejected, `第三条（edit_code）必须被拒 —— 实测：${last.text.slice(0, 200)}`);
  assert.match(last.text, /拒绝落盘（任务闸）/, `被拒的理由必须是**任务闸**（README 一直没说这一道）：${last.text.slice(0, 200)}`);
  assert.match(last.text, /E-TASK-001/, `拒绝文案必须带可分流的外层码 E-TASK-001：${last.text.slice(0, 200)}`);
  // ★ 真没落盘（不是"报错了但其实改了"）
  assert.equal(
    fs.readFileSync(path.join(c.proj, 'src/a.js'), 'utf8'),
    DEMO_FILES['src/a.js'],
    '被拒之后文件必须**一个字节都没变**',
  );
});

// ════════════════════════════════════════════════════════════════════
// ② 首跑模式：同一串调用**零被拒**，而且真的改了
// ════════════════════════════════════════════════════════════════════
test('② 首跑模式：同一条 README 路径零被拒（两道闸都只点名），且改动真的落盘', async () => {
  const c = mkCase();
  useCase(c, { firstRun: true }); // ★ 不设 REQUIRE_PLAN ⇒ 画布闸是**严格档**（默认开）⇒ 这一条同时证明画布闸也降级了
  const calls: Receipt[] = [];
  calls.push(await call('import_project', { project_dir: c.proj, feature: c.feature }));
  calls.push(await call('get_dsl', { feature: c.feature, query: 'files' }));
  calls.push(await call('edit_code', editArgs(c)));

  const rejected = calls.filter((x) => x.rejected);
  assert.deepEqual(
    rejected.map((x) => x.tool),
    [],
    `首跑模式下必须零被拒：实测 ${calls.length} 次调用 / ${rejected.length} 次被拒 —— ` +
      rejected.map((x) => `${x.tool}: ${x.text.slice(0, 160)}`).join(' | '),
  );
  // ★ "零被拒"不等于"改了"：必须看盘
  assert.notEqual(
    fs.readFileSync(path.join(c.proj, 'src/a.js'), 'utf8'),
    DEMO_FILES['src/a.js'],
    '首跑模式下那一次改动必须**真的落盘**（只数"没报错"会把空跑当成功）',
  );
  // ★ "只点名"必须有名字：任务闸没卡这件事要逐文件点名（不许静默放行）
  assert.match(
    calls[2].text,
    /没有 claimed 的任务卡/,
    `首跑模式的写回执必须**点名**"哪个文件的节点没有 claimed 卡"：${calls[2].text.slice(0, 400)}`,
  );
});

// ════════════════════════════════════════════════════════════════════
// ③ 那一行：每次回执都带（含写回执）
// ════════════════════════════════════════════════════════════════════
test('③ 首跑模式：每一次回执都打印那一行（不是启动日志一行）', async () => {
  const c = mkCase();
  useCase(c, { firstRun: true });
  const calls: Receipt[] = [];
  calls.push(await call('import_project', { project_dir: c.proj, feature: c.feature }));
  calls.push(await call('get_dsl', { feature: c.feature, query: 'files' }));
  calls.push(await call('edit_code', editArgs(c)));
  for (const r of calls) {
    assert.ok(
      r.text.includes(BANNER_HEAD) && r.text.includes(BANNER_TAIL),
      `首跑模式下**每一次回执**都要带那一行（缺了用户会以为自己在受保护）—— 实测 "${r.tool}" 回执里没有：` +
        `${r.text.slice(0, 200)}`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ unset 之后两道闸各自恢复（★ 两道各一条，不许只测一道）
// ════════════════════════════════════════════════════════════════════
test('④a unset 之后任务闸恢复拦截（E-TASK-001）', async () => {
  const c = mkCase();
  useCase(c, {}); // 什么都不设 = 受保护是默认
  await call('import_project', { project_dir: c.proj, feature: c.feature });
  const w = await call('edit_code', editArgs(c));
  assert.ok(w.rejected, `默认档下没领卡就改必须被拒 —— 实测：${w.text.slice(0, 200)}`);
  assert.match(w.text, /E-TASK-001/, `必须是任务闸那一族：${w.text.slice(0, 200)}`);
  assert.ok(!w.text.includes(BANNER_HEAD), '默认档（受保护）**不许**印首跑提示 —— 印了就等于骗人');
});

test('④b unset 之后画布闸恢复拦截（E-PLAN-023）', async () => {
  const c = mkCase();
  useCase(c, {});
  await call('import_project', { project_dir: c.proj, feature: c.feature });
  const node = nodeIdOfFile(c, 'src/a.js');
  const n = await claimUntilBlocked(c, node);
  await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `给 ${node}（src/a.js）补 ${n} 条 run 判据（当场可判）`,
    operations: [{ type: 'decision', op: 'update', id: node, data: { summary: 'a.js 负责求和与导出标签', expectations: runCriteria(n) } }],
  });
  const st = await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `判据已补齐，再 claim 一次改 src/a.js 的 label 常量（判据全绿 ⇒ intent:modify 取写权）`,
    operations: [{ type: 'task', op: 'claim', id: node, data: { owner: OWNER, intent: 'modify' } }],
  });
  assert.equal(st.rejected, false, `补到 N 条之后**再 claim** 必须过（这是 ④b 的前提）：${st.text.slice(0, 300)}`);
  // 卡已领到 ⇒ 任务闸过了；但**没有画布** ⇒ 画布闸必须拦
  const w = await call('edit_code', editArgs(c));
  assert.ok(w.rejected, `默认档下没有画布就写必须被拒 —— 实测：${w.text.slice(0, 200)}`);
  assert.match(w.text, /拒绝落盘（重写计划闸）/, `必须是画布闸那一族：${w.text.slice(0, 300)}`);
  assert.match(w.text, /E-PLAN-023/, `拒绝文案必须带可分流的外层码 E-PLAN-023：${w.text.slice(0, 300)}`);
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 同数：「要补 N 条」就是 start 的门槛（补 N-1 条必须失败）
// ════════════════════════════════════════════════════════════════════
test('⑤ 证据族：补**存在类**仍拒领（多条存在类凑不出证据），补一条**行为族**才过', async () => {
  const c = mkCase();
  useCase(c, {});
  await call('import_project', { project_dir: c.proj, feature: c.feature });
  const node = nodeIdOfFile(c, 'src/b.js');
  await claimUntilBlocked(c, node);

  // ① 补 **3 条存在类**（source-has / file-exists / symbol-exists）—— 旧规则下"凑够条数"就能领，
  //    新规则下它们**不属于任何族** ⇒ 必须仍然拒领（这就是"不能靠多条弱判据补齐"的反例）
  await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `先给 ${node}（src/b.js）补 3 条存在类判据 —— 新规则下应当仍然领不到`,
    operations: [
      {
        type: 'decision',
        op: 'update',
        id: node,
        data: {
          summary: 'b.js 负责求平均',
          expectations: [
            { kind: 'file-exists', path: 'src/b.js', why: '存在类：文件在（不算任何族）' },
            { kind: 'source-has', path: 'src/b.js', must: ['average'], why: '存在类：有这个词（不算任何族）' },
            { kind: 'symbol-exists', path: 'src/b.js', symbol: 'average', why: '存在类：符号在（不算任何族）' },
          ],
        },
      },
    ],
  });
  const weak = await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `3 条存在类已补（${node} / src/b.js），试一次 claim —— 应当仍未领取`,
    operations: [{ type: 'task', op: 'claim', id: node, data: { owner: OWNER } }],
  });
  assert.equal(weak.rejected, false, `"证据不足"是预期内结果，不是程序错误：${weak.text.slice(0, 300)}`);
  assert.match(weak.text, /未领取/, `三条存在类**不能**凑成领取资格：${weak.text.slice(0, 300)}`);
  assert.match(weak.text, /行为族/, `拒领文案必须继续点名缺行为族：${weak.text.slice(0, 300)}`);
  assert.equal(taskStateOf(c, node), 'candidate', '拒领之后卡必须原地不动');

  // ② 补 **1 条行为族**（run）⇒ 立刻可领
  await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `给 ${node}（src/b.js）补 1 条 run（行为族），准备开工`,
    operations: [{ type: 'decision', op: 'update', id: node, data: { summary: 'b.js 负责求平均', expectations: runCriteria(1) } }],
  });
  const ok = await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `行为族已覆盖（1 条 run，已绿 ⇒ 取写权用 intent:modify），再 claim 一次改 src/b.js`,
    operations: [{ type: 'task', op: 'claim', id: node, data: { owner: OWNER, intent: 'modify' } }],
  });
  assert.equal(ok.rejected, false, `1 条行为族之后 claim 必须过 —— 实测：${ok.text.slice(0, 300)}`);
  assert.equal(taskStateOf(c, node), 'claimed', 'claim 成功之后卡必须进 claimed（这时才有写权）');
});

// ════════════════════════════════════════════════════════════════════
// ⑥ preparing 的模板：现取该文件的真实符号，标清"现在就该绿 / 现在还红"
// ════════════════════════════════════════════════════════════════════
test('⑥ 模板现取真实判据：带该文件的真实路径/符号，且标清哪条现在就该绿、哪条现在还红', async () => {
  const c = mkCase();
  useCase(c, {});
  await call('import_project', { project_dir: c.proj, feature: c.feature });
  const node = nodeIdOfFile(c, 'src/a.js');
  const cl = await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `立卡并领取 ${node}（src/a.js），看回执给的判据样例是不是现取的`,
    operations: [{ type: 'task', op: 'publish', id: node }],
  });
  assert.equal(cl.rejected, false, `publish 不该被拒：${cl.text.slice(0, 200)}`);
  const claim = await call('edit_dsl', {
    feature: c.feature,
    agent: OWNER,
    reason: `领取 ${node} 的写权，用来改 src/a.js 的 label 常量`,
    operations: [{ type: 'task', op: 'claim', id: node, data: { owner: OWNER } }],
  });
  const t = claim.text;
  // ① 真实路径（不是 `<该节点 path>` 占位符）
  assert.ok(t.includes('src/a.js'), `样例里必须是**该文件的真实路径** —— 实测：${t.slice(0, 500)}`);
  // ② 真实符号（a.js 的导出名，现取自节点的 semantic.files）
  assert.ok(/total|label/.test(t), `样例里必须是**该文件真实的符号名**（不许写 <symbol> 占位符）：${t.slice(0, 500)}`);
  // ③ 两档标注：现在就该绿 / 现在还红
  assert.ok(t.includes('现在就该绿'), `必须给一条"现在就该绿"的样例（标清哪条是哪个）：${t.slice(0, 600)}`);
  assert.ok(t.includes('现在还红'), `必须给一条"现在还红"的样例（标清哪条是哪个）：${t.slice(0, 600)}`);
  // ④ 每个 kind 的必填字段与类型要写进提示（不许让人从报错里反推）
  // ★ 2026-11-09 迁移（门槛=证据族）：回执现在只要**行为族** ⇒ 断言它要的那两个 kind
  //   的字段规格确实印出来了（原断言写的是 call-exists —— 那是旧规则要的那一族）。
  assert.ok(
    /behavior-cases[^\n]*cases\*/.test(t),
    `behavior-cases 的必填字段与类型必须写进提示（cases 是数组）—— 实测：${t.slice(0, 800)}`,
  );
  assert.ok(/run[^\n]*expect\*: string/.test(t), `run 的必填字段与类型必须写进提示（expect 是 string）：${t.slice(0, 800)}`);
});

// ════════════════════════════════════════════════════════════════════
// ⑦ README 首屏那串命令：空 home 上逐条不报错
// ════════════════════════════════════════════════════════════════════
test('⑦ README 首屏命令序列在空 home 上逐条不报错（首跑模式下）', async () => {
  const c = mkCase();
  useCase(c, { firstRun: true });
  const steps: Receipt[] = [];
  steps.push(await call('import_project', { project_dir: c.proj, feature: c.feature }));
  steps.push(await call('get_dsl', { feature: c.feature, query: 'files' }));
  steps.push(await call('get_dsl', { feature: c.feature, query: 'functions', project_dir: c.proj }));
  steps.push(await call('contract_page', { symbol: 'total', project_dir: c.proj }));
  steps.push(await call('get_dsl', { query: 'overview' }));
  for (const r of steps) {
    assert.equal(
      r.rejected,
      false,
      `README 第一屏的 ${r.tool} 不许报错（新用户照抄就该跑得通）—— 实测：${r.text.slice(0, 300)}`,
    );
  }
});
