/**
 * 网络路由探测 + push —— **一个入口，先探再决定走代理还是直连**。
 *
 * ## 为什么需要它（2026-11-02 实测）
 * 全局 git 配置里有 `http.https://github.com.proxy = http://127.0.0.1:7890`（**按 URL 的代理**）。
 * 代理没开时：`git push` 报 `Failed to connect to 127.0.0.1 port 7890`，**而 HTTPS 直连是通的**（实测 200）。
 * git 的 config 没有条件求值 ⇒ 无法在 git 内部"看情况选路"，只能在外层做一次探测。
 *
 * ## 口径（不变量）
 * - 探测用 **TCP connect + 显式超时**，不用 `Test-NetConnection`（对关闭端口会等到系统超时，实测 2780 ms）。
 * - **两条都不通 ⇒ 报错并说明，不许猜**（0.12：读不到不许回落到默认值）。
 * - 代理可达 ⇒ 用它；代理不可达而直连可达 ⇒ **显式清空该 URL 的 proxy 走直连**（不改任何持久配置）。
 *
 * ## 用法
 * ```
 * node scripts/git-net.mjs                 # 只探测并打印决定
 * node scripts/git-net.mjs --json          # 机器可读
 * node scripts/git-net.mjs --push          # 探测后按决定推当前分支到 origin
 * node scripts/git-net.mjs --push --remote https://github.com/xr192172/agent-io.git --branch main
 * ```
 */
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const PROXY = { host: '127.0.0.1', port: 7890, label: 'proxy' };
const DIRECT = { host: 'github.com', port: 443, label: 'direct' };
const PROXY_URL = `http://${PROXY.host}:${PROXY.port}`;
const DEFAULT_REMOTE = 'https://github.com/xr192172/agent-io.git';

/** TCP 连通性探测；**显式超时**，超时即判不可达。 */
function probe({ host, port }, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let settled = false;
    const finish = (ok, why) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ ok, ms: Date.now() - t0, why });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true, 'connect'));
    sock.once('timeout', () => finish(false, `timeout ${timeoutMs}ms`));
    sock.once('error', (e) => finish(false, e.code || e.message));
    sock.connect(port, host);
  });
}

/** 探两次（代理、直连）并给出**唯一**决定；两条都不通时 route=null（不猜）。 */
async function decide() {
  const proxy = await probe(PROXY, 300);
  if (proxy.ok) return { route: 'proxy', proxy, direct: null };
  const direct = await probe(DIRECT, 1500);
  return { route: direct.ok ? 'direct' : null, proxy, direct };
}

/** 把决定翻成 git 的 `-c` 参数：走代理就显式给，走直连就**显式清空**。 */
function gitConfigArgs(route) {
  const key = `http.${DEFAULT_REMOTE}.proxy`;
  return route === 'proxy' ? ['-c', `${key}=${PROXY_URL}`] : ['-c', `${key}=`];
}

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const doPush = argv.includes('--push');
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const remote = argOf('--remote', DEFAULT_REMOTE);
const branch = argOf('--branch', 'main');

const d = await decide();
const decision = {
  route: d.route,
  proxy: d.proxy,
  direct: d.direct,
  gitArgs: d.route ? gitConfigArgs(d.route) : null,
};

if (!doPush) {
  if (asJson) {
    console.log(JSON.stringify(decision, null, 2));
  } else {
    console.log(`  代理 ${PROXY.host}:${PROXY.port}  ${d.proxy.ok ? '✓ 可达' : '✗ 不可达'}  (${d.proxy.ms}ms ${d.proxy.why})`);
    if (d.direct) console.log(`  直连 ${DIRECT.host}:${DIRECT.port}      ${d.direct.ok ? '✓ 可达' : '✗ 不可达'}  (${d.direct.ms}ms ${d.direct.why})`);
    if (d.route === null) {
      console.error('  ✗ 两条路都不通 ⇒ 不猜：请检查代理是否启动 / 网络是否可用');
      process.exit(2);
    }
    console.log(`  ⇒ 决定：${d.route === 'proxy' ? '走代理' : '走直连（显式清空该 URL 的 proxy）'}`);
    console.log(`  ⇒ git 参数：${decision.gitArgs.join(' ')}`);
  }
  process.exit(d.route === null ? 2 : 0);
}

if (d.route === null) {
  console.error('  ✗ 两条路都不通 ⇒ 不推，也不猜');
  process.exit(2);
}

const res = spawnSync('git', [...decision.gitArgs, 'push', remote, branch], {
  stdio: 'inherit',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
});
if (res.status !== 0) {
  console.error(`  ✗ push 失败（route=${d.route}, exit=${res.status}）`);
  process.exit(res.status ?? 1);
}
console.log(`  ✓ 已推送（route=${d.route}）—— ★ 但"push 说成功"不算：再从远端读回来对账`);
