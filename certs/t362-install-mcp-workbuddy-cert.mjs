#!/usr/bin/env node
/**
 * cert T362 —— **install_mcp 认 WorkBuddy**（2026-10-22 · 卡 `install-mcp-no-workbuddy`）
 *
 * ## 这张证存在的理由（实测量出来的）
 * `scripts/install_mcp.mjs` 的 `PLATFORMS` 有 9 个平台：claude / cursor / vscode / codex / copilot /
 * gemini / windsurf / cline / trae —— **没有 WorkBuddy**。
 * 而本机**真正在用的**恰恰是 `~/.workbuddy/mcp.json`（`AGENT_IO_AUTO_WATCH=1` 那两个 env 就在里面，
 * 才让 MCP 起来就自动保鲜）⇒ 那份配置**只能靠手改**：换项目 / 重装一次就漏，
 * 而漏了的表现是"索引不再自动保鲜"，**不报错**（最贵的那种失效）。
 *
 * ## 判据（全部实跑；每条都在**假 home** 里做，真 `~/.workbuddy` 一个字节不碰）
 *   ① `--list` 的平台清单里**有** workbuddy，且总数 = 10（9 + 1）
 *   ② 空 home（只建 `~/.workbuddy/`）⇒ `--target workbuddy` **真写**，写出的块里有
 *      `command` / `args`（指向 `dist/src/presentation/mcp/server.js`）/ **三个 env**
 *   ③ 再跑一次 ⇒ `configured`、写入 0（幂等；否则每次安装都会重写用户的配置）
 *   ④ ★★ **路径两种写法等价**：把 env 与 args 里的路径改成**正斜杠**（本机手改版就是这个形状）⇒
 *      `--check` 仍判 `configured`（旧的逐字比会判 `stale` 并重写 ⇒ 归一步就是这一条的判据）
 *   ⑤ 没装（home 里**没有** `.workbuddy/`）⇒ `not-installed`，且**不替它造目录**
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **没去动真 `~/.workbuddy/mcp.json`**：本证只在假 home 里写；真仓那一份只用 `--check`（只读）核过；
 *   · **没验 client 端会不会加载**：写进去的是配置形状，WorkBuddy 何时读它是它的事；
 *   · **没验 TOML 那条路**：workbuddy 是 JSON（`mcpServers`），TOML 平台不受本次改动影响。
 *
 * ## 用法
 *   node certs/t362-install-mcp-workbuddy-cert.mjs      # 只写 `certs/.work/tmp362-*`
 *
 * touches: scripts/install_mcp.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SCRIPT = path.join(REPO, 'scripts', 'install_mcp.mjs');
const TMP = fs.mkdtempSync(path.join(HERE, '.work', 'tmp362-'));

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 跑安装器：`home` 同时喂给 HOME 与 USERPROFILE（`os.homedir()` 在两个平台上分别读它们） */
function run(args, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
    return { out, rc: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, rc: typeof e.status === 'number' ? e.status : -1 };
  }
}
const cfgOf = (home) => path.join(home, '.workbuddy', 'mcp.json');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const slash = (s) => String(s).replace(/\\/g, '/');
const lineOf = (out, re) => (out.split('\n').find((l) => re.test(l)) ?? '').trim();

console.log('══ T362 · install_mcp 认 WorkBuddy（假 home 里做，真 ~/.workbuddy 不碰）══');

// ── ① 平台清单里有 workbuddy
const home1 = path.join(TMP, 'home1');
fs.mkdirSync(path.join(home1, '.workbuddy'), { recursive: true });
{
  const r = run(['--list'], home1);
  const line = lineOf(r.out, /WorkBuddy/);
  const total = (r.out.match(/共 (\d+) 个平台/) ?? [])[1];
  chk(Boolean(line) && total === '10', '① `--list` 里有 WorkBuddy，且平台总数 9 → **10**', `total=${total} line=${JSON.stringify(line)}`);
}

// ── ② 真写：块形状对（command / args 指 dist / 三个 env）
{
  const r = run(['--target', 'workbuddy'], home1);
  const p = cfgOf(home1);
  const ok = fs.existsSync(p);
  const j = ok ? readJson(p) : null;
  const s = j?.mcpServers?.['agent-io'];
  chk(ok && Boolean(s), '② `--target workbuddy` **真的写进** `~/.workbuddy/mcp.json` 的 `mcpServers.agent-io`', `rc=${r.rc} file=${p}`);
  chk(
    typeof s?.args?.[0] === 'string' && slash(s.args[0]).endsWith('dist/src/presentation/mcp/server.js'),
    "②' `args[0]` 指向 **dist/src/presentation/mcp/server.js**（旧品牌入口 `dist/src/server.js` 从来不存在）",
    `args=${JSON.stringify(s?.args)}`,
  );
  const env = s?.env ?? {};
  chk(
    env.AGENT_IO_AUTO_WATCH === '1' &&
      typeof env.AGENT_IO_PROJECT_DIR === 'string' &&
      slash(env.AGENT_IO_PROJECT_DIR) === slash(REPO) &&
      env.AGENT_IO_WATCH_FEATURE === 'task-system-plan',
    "②'' **自动保鲜的两个 env 都在**（AUTO_WATCH=1 / PROJECT_DIR=本仓 / WATCH_FEATURE=task-system-plan）—— 这才是「注册即保鲜」",
    `env=${JSON.stringify(env)}`,
  );
}

// ── ③ 幂等
{
  const r = run(['--target', 'workbuddy'], home1);
  chk(/写入 0 个/.test(r.out) && /configured 1/.test(r.out), '③ 再跑一次 ⇒ `configured`、**写入 0**（不是每次都重写用户配置）', `tail=${JSON.stringify(r.out.trim().split('\n').slice(-2).join(' | '))}`);
}

// ── ④ 正斜杠 vs 反斜杠：不该被判 stale（本机手改版就是正斜杠）
{
  const p = cfgOf(home1);
  const j = readJson(p);
  const s = j.mcpServers['agent-io'];
  s.env.AGENT_IO_PROJECT_DIR = slash(REPO);
  s.args = s.args.map(slash);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  const r = run(['--target', 'workbuddy', '--check'], home1);
  const line = lineOf(r.out, /WorkBuddy/);
  chk(/已配置/.test(line), '④ ★ 路径换成**正斜杠**（同一目录的另一种写法）⇒ `--check` 仍判 **configured**（不重写）', `line=${JSON.stringify(line)}`);
}

// ── ⑤ 没装 ⇒ 不造目录
{
  const home2 = path.join(TMP, 'home2');
  fs.mkdirSync(home2, { recursive: true });
  const r = run(['--list'], home2);
  const line = lineOf(r.out, /WorkBuddy/);
  chk(
    /未检测到该 client/.test(line) && !fs.existsSync(path.join(home2, '.workbuddy')),
    '⑤ 没装 ⇒ `not-installed`，且**不替它造** `~/.workbuddy/`（旧实现无脑 mkdir）',
    `line=${JSON.stringify(line)} dir=${fs.existsSync(path.join(home2, '.workbuddy'))}`,
  );
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
