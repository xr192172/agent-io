/**
 * P1 · **`scripts/install_mcp.mjs` 认 WorkBuddy** —— 由原证 `certs/t362-install-mcp-workbuddy-cert.mjs` 整张迁入。
 *
 * ## 这张证存在的理由（实测量出来的）
 * `scripts/install_mcp.mjs` 的 `PLATFORMS` 有 9 个平台：claude / cursor / vscode / codex / copilot /
 * gemini / windsurf / cline / trae —— **没有 WorkBuddy**。而本机**真正在用的**恰恰是
 * `~/.workbuddy/mcp.json`（`AGENT_IO_AUTO_WATCH=1` 那两个 env 就在里面，才让 MCP 起来就自动保鲜）
 * ⇒ 那份配置**只能靠手改**：换项目 / 重装一次就漏，而漏了的表现是"索引不再自动保鲜"，**不报错**
 * （最贵的那种失效）。
 *
 * ## 原证断言 → 本文件用例（一条不删，7 条）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ① `--list` 里有 WorkBuddy，且平台总数 9 → **10** | `① 平台清单` |
 * | ② `--target workbuddy` **真的写进** `~/.workbuddy/mcp.json` 的 `mcpServers.agent-io` | `② 真写`（第 1 条 assert） |
 * | ②' `args[0]` 指向 `dist/src/presentation/mcp/server.js`（旧品牌入口从来不存在） | 同上（第 2 条） |
 * | ②'' 自动保鲜的两个 env 都在（AUTO_WATCH=1 / PROJECT_DIR=本仓 / WATCH_FEATURE） | 同上（第 3 条） |
 * | ③ 再跑一次 ⇒ `configured`、**写入 0**（幂等） | `③ 幂等` |
 * | ④ ★ 路径换成**正斜杠**（同一目录的另一种写法）⇒ `--check` 仍判 **configured** | `④ 正斜杠等价` |
 * | ⑤ 没装 ⇒ `not-installed`，且**不替它造** `~/.workbuddy/` | `⑤ 没装不造目录` |
 *
 * ## ★ 消融（本文件必须能红 —— 2026-10-31 迁移时实测）
 *   **改哪一行**：`scripts/install_mcp.mjs` 的路径等价判定（`norm` / `samePath` 那条归一化），
 *   把"正斜杠与反斜杠视为同一路径"这一格去掉 ⇒ 逐字比。
 *   ⇒ **红读数**：`④` 用例红（`--check` 把正斜杠写法判成 `stale`/待重写，而不是「已配置」）
 *      · `用例 1/5 失败` · exit 非 0。
 *   **还原后**（`git diff` 为空）⇒ **5/5 用例 · 7 条断言全绿** · exit 0。
 *
 * ## 为什么本文件可以 spawn 脚本而不必 build
 * `scripts/install_mcp.mjs` **不 import 任何编译产物**（它只把 `dist/src/presentation/mcp/server.js`
 * 当**字符串路径**写进 client 配置）⇒ 本文件不依赖 `dist/` 的实际内容，只依赖那个路径约定。
 *
 * ## 覆盖边界（诚实清单 · [未核]，与原证一致）
 *   · **没去动真 `~/.workbuddy/mcp.json`**：本文件只在假 home 里写；真仓那一份不碰；
 *   · **没验 client 端会不会加载**：写进去的是配置形状，WorkBuddy 何时读它是它的事；
 *   · **没验 TOML 那条路**：workbuddy 是 JSON（`mcpServers`），TOML 平台不受本次改动影响。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'scripts', 'install_mcp.mjs');
const TMP = makeTempHome();
after(() => rmRf(TMP));

/** 跑安装器：`home` 同时喂给 HOME 与 USERPROFILE（`os.homedir()` 在两个平台上分别读它们） */
function run(args: string[], home: string): { out: string; rc: number } {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    return { out: String(out), rc: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, rc: typeof err.status === 'number' ? err.status : -1 };
  }
}

const cfgOf = (home: string) => path.join(home, '.workbuddy', 'mcp.json');
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const slash = (s: unknown) => String(s).replace(/\\/g, '/');
const lineOf = (out: string, re: RegExp) => (out.split('\n').find((l) => re.test(l)) ?? '').trim();

const home1 = path.join(TMP, 'home1');
fs.mkdirSync(path.join(home1, '.workbuddy'), { recursive: true });

test('① `--list` 的平台清单里有 WorkBuddy，且平台总数 9 → 10', () => {
  const r = run(['--list'], home1);
  const line = lineOf(r.out, /WorkBuddy/);
  const total = (r.out.match(/共 (\d+) 个平台/) ?? [])[1];
  assert.ok(Boolean(line), `① \`--list\` 里必须**有** WorkBuddy（否则装不上 = 只能手改）：实测输出 ${JSON.stringify(r.out.slice(0, 200))}`);
  assert.equal(total, '10', `① 平台总数必须是 9 + 1 = 10：实测 total=${String(total)} line=${JSON.stringify(line)}`);
});

test("② 真写：块形状对（command / args 指 dist / 三个 env 齐）", () => {
  const r = run(['--target', 'workbuddy'], home1);
  const p = cfgOf(home1);
  const okFile = fs.existsSync(p);
  const j = okFile ? readJson(p) : null;
  const s = j?.mcpServers?.['agent-io'];
  assert.ok(okFile && Boolean(s), `② \`--target workbuddy\` 必须**真的写进** \`~/.workbuddy/mcp.json\` 的 \`mcpServers.agent-io\`：rc=${r.rc} file=${p}`);
  assert.ok(
    typeof s?.args?.[0] === 'string' && slash(s.args[0]).endsWith('dist/src/presentation/mcp/server.js'),
    `②' \`args[0]\` 必须指向 dist/src/presentation/mcp/server.js（旧品牌入口 dist/src/server.js 从来不存在）：实测 args=${JSON.stringify(s?.args)}`,
  );
  const env = s?.env ?? {};
  assert.ok(
    env.AGENT_IO_AUTO_WATCH === '1' &&
      typeof env.AGENT_IO_PROJECT_DIR === 'string' &&
      slash(env.AGENT_IO_PROJECT_DIR) === slash(REPO) &&
      env.AGENT_IO_WATCH_FEATURE === 'task-system-plan',
    `②'' **自动保鲜的两个 env 都必须在**（AUTO_WATCH=1 / PROJECT_DIR=本仓 / WATCH_FEATURE=task-system-plan）` +
      `—— 这才是「注册即保鲜」：实测 env=${JSON.stringify(env)}`,
  );
});

test('③ 幂等：再跑一次 ⇒ `configured`、写入 0（不是每次都重写用户配置）', () => {
  const r = run(['--target', 'workbuddy'], home1);
  assert.match(r.out, /写入 0 个/, `③ 再跑一次必须报"写入 0 个"：实测 tail=${JSON.stringify(r.out.trim().split('\n').slice(-2).join(' | '))}`);
  assert.match(r.out, /configured 1/, `③ 且必须把 workbuddy 记成 configured：实测 tail=${JSON.stringify(r.out.trim().split('\n').slice(-2).join(' | '))}`);
});

test('④ ★ 路径换成正斜杠（同一目录的另一种写法）⇒ `--check` 仍判 configured', () => {
  const p = cfgOf(home1);
  const j = readJson(p);
  const s = j.mcpServers['agent-io'];
  s.env.AGENT_IO_PROJECT_DIR = slash(REPO);
  s.args = s.args.map(slash);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  const r = run(['--target', 'workbuddy', '--check'], home1);
  const line = lineOf(r.out, /WorkBuddy/);
  assert.match(
    line,
    /已配置/,
    `④ 正斜杠写法必须仍判 **configured**（不重写用户配置）；旧的逐字比会判 stale：实测 line=${JSON.stringify(line)}`,
  );
});

test('⑤ 没装 ⇒ `not-installed`，且不替它造 `~/.workbuddy/`', () => {
  const home2 = path.join(TMP, 'home2');
  fs.mkdirSync(home2, { recursive: true });
  const r = run(['--list'], home2);
  const line = lineOf(r.out, /WorkBuddy/);
  assert.match(line, /未检测到该 client/, `⑤ 没装 ⇒ 必须报 not-installed：实测 line=${JSON.stringify(line)}`);
  assert.equal(fs.existsSync(path.join(home2, '.workbuddy')), false, '⑤ 且**不替它造** `~/.workbuddy/`（旧实现无脑 mkdir）');
});
