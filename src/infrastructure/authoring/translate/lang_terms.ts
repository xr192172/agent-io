/**
 * ★★★ 2026-10-29（T-#LANG-TERMS）：**语言层名词表**（随工具走，不随项目走）。
 *
 * ## 为什么必须有这一层
 * 用户问："名词层和语言有关还是和项目有关？和项目有关的话每个项目都要重填？"
 * —— 当时的 `types[]` **把三种东西混在一张表里**：
 *
 * | 层 | 例子 | 复用范围 | 谁定 |
 * |---|---|---|---|
 * | **语言层**（本文件） | `Context` `http` `Request` `Cmd` `Time` … | **跨项目 100% 复用** | 工具内置 |
 * | 项目层（册子 `types[]`） | `fix` `principle` `promoted` | 项目相关 | 人定 |
 * | 同形直译 | `Builder` `SkillTree` | 不需要决定 | 机器自动 |
 *
 * 实测：某项目 40 个"待定名字"里 **11 个是语言层**——它们出现在 `blocked` 里
 * **是工具没接上，不是用户该填**。这就是"每项目重填"的根源。
 *
 * ## 数据从哪来（不靠手写）
 * 语言层的名字**已经在 `_go_std/*` 适配模块里存在**（我们导出 `Context`/`Request`/`Cmd`…）。
 * 所以理想形态是：**从适配模块的导出自动生成这张表**（`T-#STD-TERMS-AUTO`）。
 * 现在先用显式表 + 一条对账（`t450` 会检查"表里的名字适配模块是否真的导出"），
 * 避免"表说支持、实现却没有"的假绿。
 *
 * ## 规则（判据，不是注释）
 * · 值为字符串 ⇒ 目标侧用这个名字（通常是同名）；
 * · 值为 `null` ⇒ **明确没有对应**（如 cgo `mem`），仍算"已决定"，不阻塞；
 * · 不在表里 ⇒ 语言层没有决策，回落项目层 `types[]`，再没有才 `blocked`。
 */
export const GO_TS_LANG_TERMS: Record<string, string | null> = {
  // —— Go 标准库包名（映射到 `_go_std/<pkg>`，名字保持一致最可追溯）——
  context: 'context',
  http: 'http',
  time: 'time',
  exec: 'exec',
  sql: 'sql',
  json: 'json',
  fmt: 'fmt',
  log: 'log',
  os: 'os',
  io: 'io',
  sync: 'sync',
  sort: 'sort',
  math: 'math',
  strings: 'strings',
  strconv: 'strconv',
  filepath: 'filepath',
  unicode: 'unicode',
  sha256: 'sha256',
  hex: 'hex',
  fnv: 'fnv',
  slices: 'slices',
  bytes: 'bytes',
  bufio: 'bufio',
  runtime: 'runtime',
  signal: 'signal',
  syscall: 'syscall',
  atomic: 'atomic',
  heap: 'heap',
  norm: 'norm',
  errors: 'errors',

  // —— Go 标准库/生态里的**类型名**（适配模块里已有同名实现）——
  Context: 'Context',
  Request: 'Request',
  ResponseWriter: 'ResponseWriter',
  Cmd: 'Cmd',
  File: 'File',
  FileInfo: 'FileInfo',
  DirEntry: 'DirEntry',
  Scanner: 'Scanner',
  Reader: 'Reader',
  Writer: 'Writer',

  // —— 语义不同、需要换名的（**语言层决策，与项目无关**）——
  // `time.Time` 在 TS 侧我们用 epoch 毫秒 number（见 `_go_std/time` 的声明）
  Time: 'number',

  // —— 明确"没有对应"的（cgo/平台专用）——
  mem: null,
  syscall_unsafe: null,
  Pointer: null,
};

/** 语言层已决定的名字数（供对账与回执） */
export function langTermCount(): number {
  return Object.keys(GO_TS_LANG_TERMS).length;
}
