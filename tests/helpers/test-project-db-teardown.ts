/**
 * ★★★ 2026-11-26（#188 测试隔离 · 连接生命周期兜底）：测试 worker 退出前关闭本进程全部项目库连接。
 *
 * ## 为什么需要它
 * 项目库连接走 `projectCachePool` 池化，进程退出时 OS 回收句柄；但 Windows 上池化连接若不显式
 * close + checkpoint，会留下 `-wal` / `-shm` 残留句柄 / 文件，下一轮冷启走 WAL recovery 竞态窗口。
 * 本 helper 由 `scripts/run-tests.mjs` 以 `--import` 预加载：worker 事件循环排空（`beforeExit`）时
 * 统一 `closeAllProjectCacheDbs()`（先 `wal_checkpoint(TRUNCATE)` 再 close），释放句柄。
 *
 * ★ 只在测试 worker 内生效；生产进程不加载本 helper，退出由 OS 回收（与既有口径一致）。
 * ★ 钩子吞掉一切关闭异常——已关闭 / 被持锁都不阻塞退出。
 */
const { closeAllProjectCacheDbs } = await import('../../src/infrastructure/index/db.js');

process.on('beforeExit', () => {
  try {
    closeAllProjectCacheDbs();
  } catch {
    /* 库已关 / 无残留连接：忽略 */
  }
});
