// touches: scripts/rejection-stats.mjs, src/domain/rejection_kind.ts
/**
 * P0 · `scripts/rejection-stats.mjs` 的**行为**判据（T-37）。
 *
 * ## 为什么这条判据必须住在这里，而不是册上的一条 `run`
 * `run` 的求值域是 `new Function('input','root','validateDSL','fs','path','facts')`
 * （`src/application/design/intent/expectations.ts:621-629`）——
 *   · **没有 `child_process`** ⇒ 执行不了这个脚本；
 *   · **没有 `import` / `require`** ⇒ import 不了它的 `candidateLedgers`；
 *   · `fs` 还是**只读白名单**（`judge_facts.ts:216-222`），**连 `readdir` 都没有**。
 * ⇒ 册上只能写「读源文本 + 正则」那种 `source-has` 弱档（P15：针能被注释/import 行单独满足）。
 * 本文件用 **spawn** 真跑脚本 + 造账本，断言的是**读端的行为**，不是它的措辞。
 *
 * ## 它在挡什么（实测过的那个故障）
 * 账本按 `AGENT_IO_HOME` 分裂成两本：`.agent-io/dogfood/usage.jsonl` 26,211 行而 `via:"mcp"` **零条**，
 * `.agentio-data/dogfood/usage.jsonl` 10,633 行而 `via:"mcp"` 3,720 条。
 * ⇒ 读端**拿任意一本当"全部"**，量出来的每个数都可能是**另一本**的事实
 * （「业务拒绝 = 0」就是这么量出来的）。所以本文件的头号断言是：**每一本候选账本都必须被逐个点名**，
 * 且**多于一本就响亮报警**（不静默合并、不假装统一）。
 *
 * ## 隔离手法（★ 不是把脚本塞进真仓跑）
 * `rejection-stats.mjs` 用 `packageRootFrom()` 从**自己的位置**向上找 `package.json`（`name === 'agent-io'`）
 * ⇒ 只要把脚本 + `dist/src/domain/rejection_kind.js`（**零依赖**，故只需这一个产物）复制进一个临时"包根"，
 * 它的 5 个候选账本就全部落在临时目录里 —— 真仓那两本（26k / 10k 行）**一条都不参与**，
 * 于是守恒式可以按构造算准，而不是"跑一遍看看现在是多少"。
 *
 * ## 五条用例（每条都是"改前红 / 改后绿"的鉴别器）
 *   ① **两本都被点名**：`AGENT_IO_HOME` 造出第二本 ⇒ 两本路径都出现在输出里（漏点任何一本 ⇒ 红）
 *   ② **多于一本要响亮报警**：输出含「账本分裂」（静默合并 ⇒ 红）
 *   ③ **守恒式不平 ⇒ exit 1 且点名差多少**：usage 2 条 ok=false / sidecar 1 条 ⇒ 差 1（折成 0 ⇒ 红）
 *   ④ **守恒式平 ⇒ exit 0**：1 对 1（恒返回 1 ⇒ 红；这是 ③ 的反例，防止"永远报不平"）
 *   ⑤ **构建产物缺失 ⇒ exit 2 且明说"先构建"**（"读不了"不许折成 0）——
 *      只在真仓 `dist/` 缺失时生效，但**不是 skip**：那一步也断言了一个真契约。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'rejection-stats.mjs');
const DOMAIN_JS = path.join(ROOT, 'dist', 'src', 'domain', 'rejection_kind.js');

/** 一行 usage 记录（字段与 `dogfood_stats#usageLogFile` 写出去的一致，只留读端要用的那几个） */
function uRow(ts, ok, via = 'mcp') {
  return { ts, tool: 'probe_tool', via, ok, ms: 1 };
}

/** 一行 sidecar（拒绝事件）记录：只存**事实**，不存 verdict（复算 = 拿事实现跑 classifyRejection） */
function sRow(ts, message = '拒绝落盘（任务闸）：没有挂到任何已领取的任务上') {
  return {
    ts,
    tool: 'edit_code',
    via: 'mcp',
    isError: true,
    threw: true,
    errorName: 'GateError',
    gateCodes: ['E-TASK-001'],
    gateRejection: true,
    message,
  };
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

/**
 * 造一个临时"包根"：脚本 + 分类核产物 + （可选）账本。
 *
 * @returns {{ root: string, ledgerA: string, ledgerB: string, dataHome: string }}
 */
function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't37-rejection-stats-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'rejection-stats.mjs'));
  // `packageRootFrom()` 只认 name==='agent-io' 的 package.json
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'agent-io', version: '0.0.0' }), 'utf8');
  // 分类核是**零依赖纯函数** ⇒ 只拷这一个产物就够（E-CRIT-006 的同一条理由）
  const domainDir = path.join(root, 'dist', 'src', 'domain');
  fs.mkdirSync(domainDir, { recursive: true });
  fs.copyFileSync(DOMAIN_JS, path.join(domainDir, 'rejection_kind.js'));

  // 候选 ② = <包根>/.agent-io/dogfood/usage.jsonl
  const ledgerA = path.join(root, '.agent-io', 'dogfood', 'usage.jsonl');
  // 候选 ③ = <dataHome>/.agent-io/dogfood/usage.jsonl（dataHome = AGENT_IO_HOME）
  const dataHome = path.join(root, 'datahome');
  const ledgerB = path.join(dataHome, '.agent-io', 'dogfood', 'usage.jsonl');
  return { root, ledgerA, ledgerB, dataHome };
}

function runScript(root, dataHome) {
  const env = { ...process.env };
  delete env.AGENT_IO_DOGFOOD_FILE; // 让它走 ②/③ 两条候选，而不是被显式覆写盖住
  env.AGENT_IO_HOME = dataHome;
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'rejection-stats.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('① ② 两本候选账本都被**逐个点名**，且多于一本时响亮报警（不静默合并）', () => {
  const box = makeSandbox();
  writeJsonl(box.ledgerA, [uRow('2026-11-07T00:00:00.000Z', true)]);
  writeJsonl(box.ledgerB, [uRow('2026-11-07T00:00:00.000Z', true)]);
  const r = runScript(box.root, box.dataHome);

  // 漏点任何一本 ⇒ 红（"拿一本当全部"正是它要挡的故障）
  assert.ok(r.out.includes(box.ledgerA), `第一本账本必须被点名（实得输出：\n${r.out}）`);
  assert.ok(r.out.includes(box.ledgerB), `第二本账本必须被点名（实得输出：\n${r.out}）`);
  // 多于一本必须**响亮报警**；静默合并 = 红
  assert.ok(r.out.includes('账本分裂'), `多于一本必须报「账本分裂」（实得输出：\n${r.out}）`);
  // 两本都只有 ok:true ⇒ sidecar 没有非探测记录 ⇒ 窗口未开始，守恒式**无判据对象**（不假装平）
  assert.equal(r.status, 0, `窗口未开始时应退 0（实得 ${r.status}）：\n${r.out}`);
  assert.ok(r.out.includes('窗口：**未开始**'), `没有 sidecar 时必须明说窗口未开始（实得输出：\n${r.out}）`);

  fs.rmSync(box.root, { recursive: true, force: true });
});

test('③ 守恒式不平 ⇒ exit 1，并点名差多少（失败不许折成 0）', () => {
  const box = makeSandbox();
  writeJsonl(box.ledgerA, [uRow('2026-11-07T00:00:09.000Z', false), uRow('2026-11-07T00:00:10.000Z', false)]);
  writeJsonl(path.join(path.dirname(box.ledgerA), 'rejections.jsonl'), [sRow('2026-11-07T00:00:01.000Z')]);
  const r = runScript(box.root, box.dataHome);

  assert.equal(r.status, 1, `守恒式不平必须退 1（实得 ${r.status}）：\n${r.out}`);
  assert.ok(r.out.includes('不平：差 1'), `必须点名差多少（实得输出：\n${r.out}）`);
  assert.ok(r.out.includes('没进 sidecar'), `必须说清哪个方向不平（实得输出：\n${r.out}）`);

  fs.rmSync(box.root, { recursive: true, force: true });
});

test('④ 守恒式平 ⇒ exit 0（③ 的反例：防止"永远报不平"）', () => {
  const box = makeSandbox();
  writeJsonl(box.ledgerA, [uRow('2026-11-07T00:00:09.000Z', false), uRow('2026-11-07T00:00:10.000Z', true)]);
  writeJsonl(path.join(path.dirname(box.ledgerA), 'rejections.jsonl'), [sRow('2026-11-07T00:00:01.000Z')]);
  const r = runScript(box.root, box.dataHome);

  assert.equal(r.status, 0, `守恒式平必须退 0（实得 ${r.status}）：\n${r.out}`);
  assert.ok(r.out.includes('✅ 平：1 = 1'), `必须点明相等（实得输出：\n${r.out}）`);
  // 分类**现算**：sidecar 里只有**事实**，五类由 domain/rejection_kind.js#classifyRejection 现判
  assert.ok(r.out.includes('A 业务拒绝'), `必须按五类报（实得输出：\n${r.out}）`);

  fs.rmSync(box.root, { recursive: true, force: true });
});

test('⑤ 构建产物缺失 ⇒ exit 2 且明说"先构建"（读不了 ≠ 0）', () => {
  if (fs.existsSync(DOMAIN_JS)) {
    // 产物在 ⇒ 上三条已经覆盖了"读得到"那一侧；这里仍**不断言"跳过"**，只复核产物是零依赖单文件
    // （它一旦开始 import 别的东西，沙箱里的单文件拷贝就会 load 失败 ⇒ 本测试的隔离手法失效）
    const src = fs.readFileSync(path.join(ROOT, 'src', 'domain', 'rejection_kind.ts'), 'utf8');
    const valueImports = [...src.matchAll(/^\s*import\s+(?!type\b)/gmu)].length;
    assert.equal(valueImports, 0, 'src/domain/rejection_kind.ts 必须零 import（E-CRIT-006 / 沙箱单文件拷贝的前提）');
    return;
  }
  // 产物缺 ⇒ 脚本必须**响亮地说"读不了"并退 2**，不许折成 0（"0 次拒绝"与"读不了"是两件事）
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 2, `dist 缺失时必须退 2（实得 ${r.status}）`);
  assert.ok(`${r.stdout}${r.stderr}`.includes('先构建'), '必须明说修法（cmd /c "npm run build"）');
});
