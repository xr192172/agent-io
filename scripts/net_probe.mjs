/**
 * net_probe —— 「这台机器现在该走哪条路连 GitHub / npm」的探针（**只读，不改任何配置**）。
 *
 * ★ 为什么要有它（2026-10-08 一天内撞了两次，结论**正好相反**）：
 *   · 上午：`~/.gitconfig` 的 `http.proxy=127.0.0.1:12450` 那条**死了**，而**直连是通的**
 *           ⇒ 推送报 `schannel: failed to receive handshake`，得用 `git -c http.proxy= …` **绕开**代理。
 *   · 下午：换节点后**反转** —— 代理通、**直连 000** ⇒ 反而**必须走代理**。
 *   ⇒ 所以**不能把"绕过代理"写死成经验**；每次网络一变，先跑这个探针。
 *   （用户原话：*「你写个探针吧，方便以后使用。」*）
 *
 * 判据：对每个目标依次试 **直连** 与 **走代理** 两条路，报 http 码 + 耗时；
 *       最后给「哪条路通」的结论，并打印**该用哪条命令**（推送 / clone）。
 *
 * 用法：
 *   npm run net:probe                # 人读
 *   npm run net:probe -- --json      # 机器读
 *   npm run net:probe -- --proxy http://127.0.0.1:12450   # 指定候选代理（默认读 git 配置）
 *
 * ★ 它**只探测、不改配置**：不会替你写 `http.proxy`，也不会改 npm registry。
 */
import { execFile } from 'node:child_process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const proxyArg = args.includes('--proxy') ? args[args.indexOf('--proxy') + 1] : null;

// ★ Windows 上 `git` / `npm` 是 .cmd ⇒ 需要 shell；而 **`curl` 不能走 shell** ——
//   cmd 会把 `-w '%{http_code}'` 里的 `%` 当变量展开吃掉（实测：输出变成 `000{  NaNs`、
//   而且 `-o NUL` 失效、响应体泄到 stdout）。⇒ 只有非 .exe 的才加 shell。
const run = (cmd, cmdArgs, timeoutMs = 25000, useShell = process.platform === 'win32') =>
  new Promise((res) => {
    execFile(cmd, cmdArgs, { timeout: timeoutMs, shell: useShell, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => res({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() }));
  });

/** curl 一次：返回 http 码与耗时（`%{http_code}` / `%{time_total}`） */
const curlHead = async (url, proxy) => {
  const a = ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-L', '--max-time', '20',
             '-w', '%{http_code} %{time_total}', url];
  if (proxy) a.unshift('-x', proxy);
  const r = await run('curl', a, 25000, false /* ★ 不要 shell，理由见 run 的注释 */);
  if (!r.ok && !r.out) return { code: '000(timeout/err)', sec: null };
  const [code, sec] = r.out.split(/\s+/);
  return { code: code || '000', sec: sec ? Number(sec) : null };
};

// ── 读现有配置（只读） ────────────────────────────────────────────
const gitProxy = (await run('git', ['config', '--global', '--get', 'http.proxy'])).out || null;
const npmRegistry = (await run('npm', ['config', 'get', 'registry'])).out || null;
const candidates = [...new Set([proxyArg, gitProxy, process.env.HTTPS_PROXY, process.env.HTTP_PROXY].filter(Boolean))];

const TARGETS = [
  { name: 'GitHub API', url: 'https://api.github.com' },
  { name: 'GitHub 网页/git 宿主', url: 'https://github.com' },
  { name: 'codeload（tarball 下载）', url: 'https://codeload.github.com/uyha/tree-sitter-cmake/tar.gz/HEAD' },
  ...(npmRegistry ? [{ name: `npm registry（${npmRegistry}）`, url: npmRegistry }] : []),
  { name: 'registry.npmjs.org', url: 'https://registry.npmjs.org/' },
];

const routes = [{ label: '直连', proxy: null }, ...candidates.map((p) => ({ label: `代理 ${p}`, proxy: p }))];

const table = [];
for (const t of TARGETS) {
  const row = { target: t.name, url: t.url, routes: {} };
  for (const r of routes) row.routes[r.label] = await curlHead(t.url, r.proxy);
  table.push(row);
}

// git 传输层单独试（http 通 ≠ git 通：走的是不同的路径/证书）
const gitUrl = 'https://github.com/uyha/tree-sitter-cmake';
const gitRoutes = {};
for (const r of routes) {
  const a = r.proxy ? ['-c', `http.proxy=${r.proxy}`, 'ls-remote', gitUrl, 'HEAD'] : ['-c', 'http.proxy=', 'ls-remote', gitUrl, 'HEAD'];
  const t0 = Date.now();
  const res = await run('git', a, 30000);
  gitRoutes[r.label] = { ok: res.ok && /^[0-9a-f]{7,}/.test(res.out), sec: (Date.now() - t0) / 1000, err: res.ok ? '' : res.err.split('\n').pop()?.slice(0, 80) };
}

// ── 结论 ─────────────────────────────────────────────────────────
const score = (label) => table.filter((t) => String(t.routes[label].code).startsWith('2')).length
  + (gitRoutes[label].ok ? 1 : 0);
const ranked = routes.map((r) => ({ ...r, score: score(r.label) })).sort((a, b) => b.score - a.score);
const best = ranked[0];
const total = TARGETS.length + 1;
const tied = ranked.filter((r) => r.score === best.score);
// ★ 平局要说"两条都通"，不能说"只有一条路全通" —— 判决词说不准，就等于探针在撒谎。
const verdict =
  best.score === 0 ? '❌ **没有一条路通** —— 先连梯子/换节点，别改 git 配置'
  : tied.length > 1 && best.score === total ? `✅ **两条路都全通**（${tied.map((r) => r.label).join(' / ')}）—— 随便挑`
  : tied.length > 1 ? `⚠ 最高分并列（${tied.map((r) => r.label).join(' / ')}，各 ${best.score}/${total}）`
  : best.score === total ? `✅ 只有一条路全通：**${best.label}**`
  : `⚠ 部分通：**${best.label}**（${best.score}/${total}）—— 另一条路有目标不通`;

if (asJson) {
  console.log(JSON.stringify({ gitProxy, npmRegistry, candidates, table, gitRoutes, best: { label: best.label, score: best.score }, total }, null, 1));
} else {
  console.log(`git http.proxy = ${gitProxy ?? '（未配置）'}    npm registry = ${npmRegistry ?? '?'}`);
  console.log(`候选路：${routes.map((r) => r.label).join(' / ')}\n`);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('目标', 26) + routes.map((r) => pad(r.label, 22)).join(''));
  for (const t of table) console.log(pad(t.target, 26) + routes.map((r) => pad(`${t.routes[r.label].code}  ${t.routes[r.label].sec ?? '-'}s`, 22)).join(''));
  console.log(pad('git ls-remote', 26) + routes.map((r) => pad(gitRoutes[r.label].ok ? `ok ${gitRoutes[r.label].sec.toFixed(1)}s` : `✗ ${gitRoutes[r.label].err ?? ''}`, 22)).join(''));
  console.log(`\n⇒ ${verdict}`);
  if (best.proxy) {
    console.log(`  推送 / clone 用：git -c http.proxy=${best.proxy} …（或把它写进 ~/.gitconfig 的 http.proxy）`);
  } else {
    console.log('  推送 / clone 用：git -c http.proxy= -c https.proxy= …（**绕开**配置里的代理）');
  }
}
process.exitCode = best.score === 0 ? 1 : 0;
