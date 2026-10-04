import { defineConfig } from 'vitest/config';

export default defineConfig({
  // node:sqlite 是 Node 22.5+ 内建模块，Vite 5 的内建清单不认识它，
  // 会剥掉 node: 前缀当文件路径解析（Failed to load url sqlite）——SSR external 跳过转换
  ssr: {
    external: ['node:sqlite'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
    // 全局 setup：AGENT_IO_HOME 指向临时目录，隔离测试对活态 DSL 的写入
    setupFiles: ['tests/setup.ts'],
    // ★ 2026-10-04 删掉了 `globalSetup`（原用途：清上一轮「门出生证探针」的注入物残留）。
    //   它服务的 `tests/helpers/gate_probe.ts` 整套已删 —— 理由见该次提交。
    //   一句话：那个 helper 的存在前提是「门靠往盘上注入文件来证明自己会红」，
    //   而真正用到它的唯一一扇门，注入物只是**内存里的数组**，根本不需要文件级还原。
    // 共享 storage 目录（.agent-io/features/），多文件并行会相互清理
    // 改为单线程串行跑，避免测试间状态污染
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    // singleFork 下所有测试文件共用同一进程/globalThis：LLM 测试常用
    // vi.stubGlobal('fetch', mock) 注入假响应，若不复原（restoreAllMocks 只管
    // vi.fn/spyOn，管不到 stubGlobal）会全局劫持后续测试的真实 fetch——
    // chain_exec 等真 HTTP e2e 就被 mock 吞掉。此处让 vitest 每个用例后自动
    // vi.unstubAllGlobals()，杜绝跨文件全局桩泄漏（幂等：没打桩则无操作）。
    unstubGlobals: true,
  },
});
