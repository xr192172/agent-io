/**
 * `tool_reach` —— **「一个工具有没有下游信号」的唯一口径**（三档：真调用 / 代码引用 / 文档提及）
 *
 * ## 为什么它存在（0.9.1 一处权威）
 * 这个口径原先**只住** `scripts/audit-tool-reach.mjs`（一个只报告、退出码恒 0 的审计脚本）。
 * 2026-11-07 要把它接成**棘轮**（PROJECT-DESIGN §14.1「没有下游消费者…不进主干」）⇒ 第二个消费者出现。
 * ⇒ 若在 `scripts/mcp/mcp_scan.mjs` 里就地再写一遍，同一件事就有了两把尺（本仓头号病）。
 * 所以：**口径抽到这里**，`audit-tool-reach`（人读报告）与 `mcp_scan` 棘轮 ⑤ 共用。
 *
 * ## 三档是什么、各自能回答什么
 * | 档 | 取法 | 能回答 | **不能**回答 |
 * |---|---|---|---|
 * | `real` / `sweep` | `.agentio-data/dogfood/usage.jsonl`（`via=sweep|gate` 记为扫射，不作真调用） | 模型在会话里**真调过**没有 | 未来会不会用（样本随开发期走） |
 * | `codeHits` | 工具名在 `src/**` 里出现次数，**排除"含 `name: '<tool>'` 的注册文件"** | 有没有代码/测试/脚本在指望它 | 是不是"强耦合"（一个注释里的名字也算一次） |
 * | `docHits` | 工具名在 `docs/` + `tests/` + `scripts/` + 四个 README/AGENTS 里的出现次数 | 有没有人在宣传/说明它 | 提了 ≠ 用 |
 *
 * ★ **诚实边界（实测 2026-11-07）**：`codeHits` 在 43 个工具上**全部 ≥ 3**（工具名会出现在彼此的
 *   description 里）⇒ 这一档**没有区分度高的绝对值**。所以它只适合做**棘轮**（"明天不比今天多"），
 *   不适合做"读数阈值"（`≥N` 那种 —— §9.4 明禁）。★ 棘轮与读数型判据不是一回事：
 *   读数型要求"现在是几"；棘轮只要求"别比昨天差"。
 *
 * ## 纯函数边界
 * 本模块**只读**（`fs.readdirSync` / `readFileSync`），不写盘、不改状态、不 process.exit。
 * 判读结论由调用方决定（人读报告 vs 棘轮），本模块只给**计数**与**判读词**。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 索引哪些后缀算"代码引用"（`.md` 不算 —— 文档提及是另一档） */
const CODE_EXTS = /\.(ts|mjs|js)$/;
/** 递归时跳过的目录（`dist` 是产物，`node_modules` 是三方，`.git` 是历史） */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/**
 * 递归列文件（只收 `CODE_EXTS`）。
 * @param {string} dir 起始目录（不存在 ⇒ 空数组，不抛 —— 审计不该因为少个目录就崩）
 * @param {string[]} [out] 累加器
 * @returns {string[]} 绝对路径
 */
export function walkFiles(dir, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(p, out);
    } else if (CODE_EXTS.test(e.name)) out.push(p);
  }
  return out;
}

/** 档位措辞（★ 与 `docs/GUIDE-GATE.md` 同口径：这里**只是判读词**，不是判据本身） */
export function reachVerdict(real, code, doc) {
  if (real > 0) return '有真实使用 ⇒ 补证即可';
  if (code === 0 && doc === 0) return '★ 孤立 ⇒ 退役候选';
  if (code === 0 && doc > 0) return '★ 被宣传但没人用 ⇒ 要么补证、要么删（前提是否成立）';
  return '有内部耦合 ⇒ 保留 + 补证';
}

/**
 * 读 dogfood 使用日志 ⇒ `Map<tool, {real, sweep}>`。
 * 日志不存在 ⇒ 空 Map（**不是错误**：新检出的工作区还没跑过工具）。
 */
export function readUsage(usageLogPath) {
  const usage = new Map();
  if (!fs.existsSync(usageLogPath)) return usage;
  for (const line of fs.readFileSync(usageLogPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const t = o.tool ?? '';
    if (!t) continue;
    const cur = usage.get(t) ?? { real: 0, sweep: 0 };
    if (o.via === 'sweep' || o.via === 'gate') cur.sweep++;
    else cur.real++;
    usage.set(t, cur);
  }
  return usage;
}

/**
 * 现算全部工具的到达面。
 *
 * @param {{root: string, toolNames?: string[], usageLogPath?: string}} opts
 *   · `toolNames` 省略 ⇒ **不猜**：返回空数组 + `note`（调用方必须自己把它们从 `TOOL_DEFS` 取来）
 * @returns {{rows: Array<{tool:string, real:number, sweep:number, codeHits:number, docHits:number, verdict:string}>, note?: string, scannedFiles: {code:number, doc:number}}}
 */
export function collectReach(opts) {
  const root = opts.root;
  const toolNames = opts.toolNames ?? [];
  const codeFiles = walkFiles(path.join(root, 'src'));
  const docFiles = [
    ...walkFiles(path.join(root, 'docs')),
    ...walkFiles(path.join(root, 'tests')),
    ...walkFiles(path.join(root, 'scripts')),
    ...['README.md', 'README.en.md', 'AGENTS.md', 'CONTRIBUTING.md']
      .map((f) => path.join(root, f))
      .filter((f) => fs.existsSync(f)),
  ];
  // ★ 一次读进内存：43 个工具 × 400+ 文件 逐次读盘会慢一个量级（实测口径不变、只是 IO 编排）
  const codeTexts = codeFiles.map((f) => fs.readFileSync(f, 'utf8'));
  const docTexts = docFiles.map((f) => fs.readFileSync(f, 'utf8'));
  const usage = readUsage(opts.usageLogPath ?? path.join(root, '.agentio-data/dogfood/usage.jsonl'));

  const rows = toolNames.map((t) => {
    let codeHits = 0;
    for (const s of codeTexts) {
      if (!s.includes(t)) continue;
      if (s.includes(`name: '${t}'`)) continue; // ★ 注册点不算"有人用它"
      codeHits += s.split(t).length - 1;
    }
    let docHits = 0;
    for (const s of docTexts) docHits += s.split(t).length - 1;
    const u = usage.get(t) ?? { real: 0, sweep: 0 };
    return { tool: t, real: u.real, sweep: u.sweep, codeHits, docHits, verdict: reachVerdict(u.real, codeHits, docHits) };
  });

  return {
    rows,
    note: toolNames.length ? undefined : 'toolNames 为空 ⇒ 什么都没算（本模块不猜工具名，由调用方从 TOOL_DEFS 取）',
    scannedFiles: { code: codeFiles.length, doc: docFiles.length },
  };
}

/**
 * **孤立集** = 没有任何下游信号的工具：`real === 0`（没人真调）∧ `codeHits === 0`（没有代码/测试/脚本在用）。
 *
 * ★ 为什么把「只有文档提及」也算进来：§14.1 的失效形态正是「**被宣传但没人用**」——
 *   文档里写着它 ⇒ 下一个人以为它活着 ⇒ 那比彻底孤立更难发现。
 * @param {Array<{tool:string, real:number, codeHits:number}>} rows
 * @returns {string[]} 工具名（**按字典序**，好比对/好入基线）
 */
export function isolatedTools(rows) {
  return rows
    .filter((r) => r.real === 0 && r.codeHits === 0)
    .map((r) => r.tool)
    .sort();
}
