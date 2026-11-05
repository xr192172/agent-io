/**
 * 重活排他锁（`heavy.lock`）—— **唯一实现**（`scripts/mutate.mjs` / `scripts/judge-all.mjs` /
 * `scripts/verify.mjs` 都用这一份，不各写一套）。
 *
 * ## 为什么需要（实测，不是设想）
 * `verify` / `mutate` / `judge-all` **共享同一批可写资源**（`dist/` · `.agent-io/judge-cache.json` ·
 * `.agent-io/cache.db` · `design-db/`）。两个进程同时跑 ⇒ 拿到的读数是**不可归因**的：
 * 分不清"代码坏了"与"另一个人在改同一个目录"。实测三次：
 *   ① 写卡在飞时派只读复核卡跑全量 `verify` + `npm test` ⇒ **同一条命令两次结论不同、红的用例也不同**
 *   ② 我跑 `verify` 时另一张卡在跑它自己的 `verify` ⇒ 我这次「判据突变」门 **402ms 崩**，
 *      日志逐字 `已有 mutate 在跑（pid 13452，锁 .agent-io/mutate.lock）⇒ 不许并行`
 *   ③ 同一形态再现（记过教训但**没落检测点** ⇒ 第三次照样撞 —— 0.25① 说的"教训是散文"）
 *
 * ## 与旧实现（`mutate.mjs` 里那个 `acquireLock`）的两处差别
 * ① **范围**：那个只管 `mutate`；本模块给三个重活都用（它描述的"共享 dist/ · judge-cache · cache.db"
 *    **对 verify 与 judge-all 同样成立**，只是当时没接）。
 * ② **陈旧锁不再静默**：`mutate` 会**改 `dist/` 里的文件再还原**。进程被 SIGKILL / 断电时
 *    `restoreAll` **不会执行** ⇒ 树可能**停在改过的状态**。旧实现只在 pid 死了就静默接管 ⇒
 *    下一个人会在**一块不知道是什么的地**上量。现在会**响亮说出来**（但不阻断 —— 拦也不对，它可能没事）。
 *
 * ## 可重入：靠**环境变量传递祖先**，不靠查进程树
 * `verify` 拿到锁后设 `AGENT_IO_HEAVY_HOLDER=<自己的 pid>`，子进程继承该环境变量。
 * 本模块见到「锁文件的 pid == 环境里的 holder」⇒ 判定"我在这把锁的**里面**" ⇒ 直接放行、**不再加锁**。
 * ★ 为什么不用 `process.ppid` 往上走：Windows 上查 pid 的父进程要走 `wmic`/CIM，慢且脆；
 *   而**环境变量天然按进程树继承** ⇒ 判据落在"这是不是我的祖先"上，不需要知道祖先是谁。
 * ★ 它不会被兄弟进程误当成祖先：env 是**继承**的，不是全局的。
 *
 * ## 边界（0.17①）
 * - **不管**别的共享资源（如全局 npm 缓存）—— 只锁本仓的 `.agent-io/`。
 * - **不判"重活是否该并行"**：它只保证**同一时刻只有一个**；要真并行请用 worktree 隔离（各仓各锁）。
 * - **陈旧锁只在 pid 确实不存在时**才判陈旧；pkill 到但 pid 被复用 ⇒ 会误判"还在跑"（保守那侧，可接受）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 锁文件相对项目根的位置（`manifest:check` 需要在 `NON_VOLUME_ENTRIES` 里登记它） */
export const HEAVY_LOCK_REL = '.agent-io/heavy.lock';

/** 子进程用来判断"我在某把锁的里面" */
export const HOLDER_ENV = 'AGENT_IO_HEAVY_HOLDER';

function pidAlive(pid) {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 进程在、只是不归我管 ⇒ 算活着（保守那侧）
    return e && e.code === 'EPERM';
  }
}

function readLock(f) {
  try {
    const raw = fs.readFileSync(f, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j.pid === 'number') return j;
  } catch {
    /* 坏文件 / 空文件 ⇒ 当作没有，但下面会当作"脏"处理 */
  }
  return null;
}

/**
 * 拿重活锁。
 *
 * @param {string} root 项目根
 * @param {{name: string, shared?: string}} opts `name` = 调用者（写进锁，报错时点名"是谁在跑"）
 * @returns {() => void} release
 * @throws 当**另一个活着的**进程持有锁（且不是我、也不是我的祖先）时
 */
export function acquireHeavyLock(root, opts) {
  const name = String(opts?.name ?? 'unknown');
  const shared = String(opts?.shared ?? 'dist/ · judge-cache · cache.db · design-db');
  const f = path.join(root, HEAVY_LOCK_REL);
  const holderEnv = Number(process.env[HOLDER_ENV] ?? 0);

  const cur = readLock(f);

  // ── 可重入：我在这把锁的里面（某个祖先进程持有）⇒ 直接放行，不写锁 ──
  if (cur && holderEnv > 0 && cur.pid === holderEnv) return () => {};

  if (cur && cur.pid !== process.pid) {
    const alive = pidAlive(cur.pid);
    if (alive) {
      throw new Error(
        `已有重活在跑（${cur.name ?? 'unknown'} · pid ${cur.pid}，锁 ${f}）⇒ 不许并行：${shared}\n` +
          `  ⇒ 你在跑的是「${name}」。两条读数的差异**可能只是环境不同**，别把它当代码问题。\n` +
          `  ⇒ 等它跑完再来；要真并行请用 worktree 隔离（各仓各锁）。`,
      );
    }
    // ★ 陈旧锁：pid 已不存在 ⇒ **响亮提示后接管**（不静默、也不永久卡住）
    const at = cur.at ? `（它写在 ${cur.at}）` : '';
    console.warn(
      `⚠️ 陈旧重活锁${at}：上次「${cur.name ?? 'unknown'}」（pid ${cur.pid}）**没干净退出**，pid 已不存在 ⇒ 我接管。\n` +
        `  ★ 为什么必须说出来：\`mutate\` 会**改 \`dist/\` 里的文件再还原**，而 SIGKILL / 断电时那步**不会执行**\n` +
        `  ⇒ 源码树可能**停在改过的状态**。接管前建议先看一眼：\`git status --porcelain\`（源码）+ \`ls dist/\`。\n` +
        `  ★ 不阻断（拦也不对：它可能没事），但不许静默 —— 静默就在于你会以为地是干净的。`,
    );
  }

  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(
    f,
    JSON.stringify({ pid: process.pid, name, at: new Date().toISOString(), shared }, null, 0),
    'utf8',
  );
  // ★ 让子进程知道"我在锁里"（环境变量按进程树继承 ⇒ 天然只对子孙有效）
  process.env[HOLDER_ENV] = String(process.pid);

  return () => {
    try {
      const now = readLock(f);
      if (now && now.pid === process.pid) fs.unlinkSync(f);
    } catch {
      /* 已经没了就算 */
    }
  };
}
