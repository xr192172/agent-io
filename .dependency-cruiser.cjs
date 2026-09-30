/**
 * dependency-cruiser 配置 —— 架构边界与依赖健康（契约见 docs/architecture-refactor-plan.md §4 / §41 / §43）
 *
 * ★★ 为什么用这个工具而不是自写门（用户裁定，2026-09-30）：
 *   自写门**会漂移**（本仓活证：43 条手抄"谁扫仓库"名单 / 20 条豁免名单 / INTERNAL_MODULES 三处腐烂）。
 *   本工具的规则是**声明式模式**（`from`/`to` 正则）—— **加文件不用改规则**，因此不会腐。
 *   ★ 纪律：**只用基础规则**。自定义规则写多了，这个工具就重新变成自写门，照样漂移。
 *
 * ★★ 当前阶段（2026-09-30，P2 搬迁尚未开始）：
 *   四层目录（`presentation/ application/ infrastructure/ domain/`）**还不存在** ⇒ 带层名的规则**暂为空转**（命中 0）。
 *   它们**故意先放进来**：等 P2 一族一族搬完，对应该族的 `from`/`to` 模式才**开始有对象**，
 *   于是"搬迁进度"就是"规则命中数"—— ★ **不需要再自写一个分类器**。
 *   ⇒ 因此本配置现在**真正生效的是"与目录无关"的那几条**：循环依赖、孤儿文件。
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循环依赖：难测、难改、初始化顺序玄学。★ 与目录结构无关，现在就有真实价值。',
      from: {},
      to: { circular: true },
    },
    {
      name: 'layer-downward-only',
      severity: 'error',
      comment:
        '四层只许向下：presentation → application → infrastructure → domain（§4）。★ P2 搬完一族后这条才开始有对象；' +
        '现在命中 0 是预期的，不是"没问题"。',
      from: { path: '^src/(application|infrastructure|domain)/' },
      to: { path: '^src/presentation/' },
    },
    {
      name: 'application-must-not-reach-infrastructure-internals',
      severity: 'error',
      comment: 'application 只能用 infrastructure 的公开面，不许深入其内部子目录（§44 的"铁律"列）。',
      from: { path: '^src/application/' },
      to: { path: '^src/infrastructure/[^/]+/internal/' },
    },
    {
      name: 'domain-is-self-contained',
      severity: 'error',
      comment: 'domain 是契约与数据模型，**自洽、不 import 实现**（§44）。',
      from: { path: '^src/domain/' },
      to: { path: '^src/(presentation|application|infrastructure)/' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        '没有被任何东西 import 的模块。★ 用 warn 而非 error：**入口点**（CLI/HTTP/daemon）本来就没人 import。' +
        '真正该报的"死模块"由 knip 单独判（那是它的职责，别在这里重复）。',
      from: { orphan: true, pathNot: ['^src/(presentation|daemon)/', '_cli\\.ts$', '^src/server\\.ts$'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|\\.inspect|\\.agent-io)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
