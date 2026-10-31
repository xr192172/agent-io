#!/usr/bin/env node
/**
 * gen_agents —— 生成 AGENTS.md
 *
 * 唯一事实源 = 本文件的 TRIGGER_ROWS + buildAgents 模板；AGENTS.md 是产物。
 *
 * 用法：
 *   node scripts/gen_agents.mjs            # 重建 AGENTS.md（build 里自动执行）
 *   node scripts/gen_agents.mjs --check    # 只比对不写盘，不一致退出码 1（CI/pre-commit 用）
 *   node scripts/gen_agents.mjs --silent   # 不打印成功提示（pre-commit 内调用）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'AGENTS.md');

// ─────────────────────────────────────────────────────────────
// 唯一事实源：开发动作 → 必用工具
// ─────────────────────────────────────────────────────────────
const TRIGGER_ROWS = [
  ['不确定用哪个工具', '`capability_map`', '能力线 × 线内工具 × 何时用；`lane=<线>` 只看一条'],
  ['开工前看 / 改设计侧', '`get_dsl` / `edit_dsl`', '读、写、导出（mindmap / svg / markdown）设计侧'],
  ['读设计链 / 重生成设计 DB', '`design_line`', '`action=report` / `diff` / `rewrite`（只拉签名）/ `gen-db`'],
  ['记录目标 / 方向 / 边级意图', '`design_intent action=set`', '写 goals + edge_intents，落进 base 的 `meta.goals` / `edge.intent`'],
  ['日常维护（补节点 / 改描述 / 加标注）', '`edit_dsl weight=routine`', '跳过 L4 证据回溯，仍留 L1–L3；改架构 / 契约用缺省 `normal`'],
  ['改模块级符号名（单条或批量）', '`rename_symbols`（`scope=module`）', '自动定根 + 闭包 + 跨语言；先 `dry_run`'],
  ['改文件内局部变量 / 形参', '`rename_symbols scope=local`', '作用域隔离；逐项独立，跳过项逐条可见'],
  ['改对外契约名 / MCP 工具名', '`rename_symbols report_literals=true`', '扫旧名 snake 变体字面量，按 kind 分治；契约变更才跟文档'],
  ['改文件名并联动全仓 import（单条或批量）', '`rename_files`', '整体先 `dry_run`，全部可落盘才落'],
  ['整块搬一个域到新位置', '`move_domain`', '先改 `structure.domains.json` 的 `dir`，再一次搬完全部源码 + 改写 import；搬什么由 `structure_gap` 判'],
['把一个模块级符号搬到别的文件（文件不变）', '`move_symbol`', '搬的是**符号**不是文件（与 `move_domain` 不同生态位）：自动把「仅引入该符号」的 importer 目标改到 `to_file`；v1 只 TS/JS，撞名 / namespace / `export *` 一律整体不动'],
['看已记录的调用链 / 查运行时事件 / 判一批事件', '`observe`（`action=trace` / `log` / `judge`）', '只读三合一（2026-10-28 合并）：`trace` 重建调用树排查「走了哪条链」，`log` 查 events.jsonl，`judge` 逐事件偏差判定（可带 `decls` 做链路契约）。插桩/还原/台账用 `action=instrument/uninstrument/restore/ledger`，提案四层门用 `action=proposals`（`op=…`）'],
['建议 / 消歧易混名', '`rename_symbols analyze=similar\|suggest`', '前者给短名/无意义局部变量出建议（带理由），后者找孪生名（大小写 / 数字后缀 / 换位 typo）并按连通块聚类给 basis'],
['读项目文档（没有文档就写）', '`explore_code action=docs`', '不带 `name` 返清单（供挑）；带 `name` 返全文；带 `targets` 返命中该目标集的文档正文'],
['配 LLM 供应商 / Key 池 / 看用量', '`gateway_provider`', '单入口（原 `gateway_*` 4 个收敛成 1）；★ Key 的**家在这里**（`gateway.json`），环境变量只是导入源'],
['决定在哪打观测点（不做全量插桩）', '`recommend_observe_points` → `observe action=instrument`', '用索引/图 + AST 算「该在哪打日志」：高入度 / 最近真改 / 副作用边界 / 静默吞错 / 复杂度高地 / 文件热点；清单落 `.agent-io/observe-points.json` ⇒ 再 `observe action=instrument contract_from_points=true` **只插这些点**（推荐器与插桩器同源同命名，不漂移）'],
['重构后让 LLM 判一轮（拿不定的上抛给人）', '`refactor_judge`', '逐条裁 adopt / reject / uncertain（带置信度 + 理由）；uncertain 经 `alert_inbox` 入箱，下一次工具响应自动附带'],
['重算翻译册（Go→TS 全量符号账）', '`translate book=true`', '从事实库重算 `.agent-io/design/<f>.translate.json`（pending / blocked / judgments / external_deps 一次算清）；人写的 types / atoms / unknowns 原样保留。★ 2026-10-28 吸收 `translate_book`（它是本工具的第一步：没册子就没有骨架/填孔/对拍）'],
  ['改一段代码（函数体 / range）', '`edit_code`', '按符号 / 行号 / range 定位；走写闸 + 重建索引'],
['批量串替换（先算清单 → 再落盘）', '`apply_refactor_plan`', '单一入口两种形态：给 `targets` ⇒ **只算清单**（只读：plan id + 命中级别 + diff）；给回执里的 `plan` ⇒ **落盘**（幂等，plan_id 指纹不符即报错）。★ 2026-10-28 合并 `plan_refactor`'],
  ['回滚代码改动', '`snapshot action=rollback`', '落盘前自动存快照；回滚立即写盘、不回滚本身、不可再撤回'],
  ['理解代码 / 结构', '`explore_code`', '只读：语义搜索、分层、拆分建议、数据流'],
  ['清理无效 import', '`remove_dead_imports`', '删 dead_deps'],
  ['废弃 / 下线一个自研模块', '`deprecate_offline`', '判据：自研 + 无活跃消费（编译级验收，回归回滚）；缺省 `dry_run`，落盘给 `dry_run:false`，物理删再加 `remove_file:true`'],
  ['补 / 维护函数语义注释', '`annotate_functions`', '`mode=scan/dry_run/apply`；`@fnhash` 随 body 变而过期'],
  ['搭功能主链 / 沿线看流程', '`observe action=line`', '每功能挑入口沿调用边走成主链；`target` 留空返全功能总览'],
  ['改设计意图(why)', '`design_intent action=set`', '直接写 overlay（goals + edge_intents）并 apply 回 base。★ **`action=propose` 已退役**（2026-10-22 删分支，此前调它会**被当成 set 直接写盘**）⇒ 现在**响亮报错零副作用**；要「先请人批再落」走 `observe action=proposals`'],
    ['看待确认的 observe 提案', '`observe action=proposals`（`op=list/show/approve/reject`）', '★ 提案的唯一产者是 `run_loop`（累犯波及模式）；approve 过四层门（规则 / LLM 复核 / 覆盖 / 定稿），任一层不过即 `frozen`（DSL 不动）；`use_llm` 缺省 false'],
  ['查谁引用 / 调用了 X', '`find_references`', '只读；`mode=field` 报字段读取与构造点'],
  ['加字段 / 改签名前查波及面', '`find_references mode=type`', '读 / 构 / 解 / 声明四类 AST + 行内上下文'],
  ['跑测试 / 回归', '`run_tests`', '结构化失败定位；`filter` 定向或全量'],
  ['改完看设计是否过时 / 欠实现', '`design_line action=drift`', '对比 expected_apis 与真实代码，四态含 `no_comparison`（没得比≠对齐）；`drift_mode=status` 复读台账。★ 2026-10-28 吸收 `detect_drift`'],
  ['常驻盯漂移', '`explore_code action=watch drift_on_change=true`', '文件一变即 rebuild + 过时判定 + pushAlert'],
  ['提交前健康检查', '`design_line action=judge` / `sync_contracts`', '跑整册判据批（四态：unsupported=判不了≠通过）+ 契约同步。★ 2026-10-28 吸收 `consistency_check`（其对账报表已被判据覆盖）'],
  ['改前看影响面', '`explore_code action=impact`', '反向可达闭包 + 风险排序（`hubs=true` 切热区盘点）。★ 2026-10-28 吸收 `impact_analysis`；★ 写闸**自动**附带波及仍待做（T-#GATE-IMPACT）'],
  ['对账设计视图 / 实际视图', '`diff_views` / `reconcile_chain`', '波及方向'],
  ['两仓合并 / 迁移查撞名', '`cross_repo_symbol_index`', '顶层符号求交 = 冲突，求差 = 迁移范围'],
  ['跨语言翻译（骨架 / 填孔 / 对拍）', '`translate`（`from`/`to`）', '★ 语言对是**数据**：`from`/`to` 查 `TRANSLATE_PAIRS`（目前仅 `go-ts`）；不支持的对报错并列出已注册对。机械骨架 + 验证闸；`fill` 逐孔填函数体；`verify` 行为对拍；`book=true` 重算翻译册'],
  ['改完函数验证行为', '`edit_dsl`（decision expectation `behavior-cases`）', '行为基线已并入判据生态（I2b）：期望输出写在 behavior-cases 判据里（同一执行核 runHarness），不再用 capture/verify 快照工具'],
  ['项目体检', '`code_health`', '死代码 / 圈复杂度 / 分层违规 → 健康分 + 清单'],
  ['查语言支持度 / 缺口', '`capability_audit`', '语言 × 功能的 AST 覆盖缺口（只读）；与 `capability_map`（工具导航）不同'],
  ['查工具使用 / 死工具 / 过期记录', '`npm run dogfood:coverage`（脚本）', '★ 2026-10-28 从 `tool_usage` 迁出：烟测覆盖读数（死工具 / 过期记录）属开发期审计，不该占 MCP 工具位；口径未变（默认排除 via=sweep|gate）'],
  ['升级语言 / 工具链版本', '`upgrade`', '`scan` 只读报契约差（可选 `gate` / `dynamic`）；`apply` = 串替换 → 基线提交 → 验证 → 失败回退（需 git）'],
  ['一次修复沉淀成规则', '`rules action=export/apply/check`', 'export 过出生回归 / 反例 / 幂等三关才落盘；apply 三态 `applied` / `todo` / `clean`（缺省 dry-run）；check 只在新命中上 fail'],
  ['症状 → 根因 → 修复', '`diagnose` / `diagnose_loop`', '`diagnose_loop` 缺省 `apply=false`，不提交 git'],
];

/** 渲染对齐的 Markdown 表格：rows = 数组的数组；无表头时传 null head */
function renderTable(head, rows) {
  const widths = [];
  const all = head ? [head, ...rows] : rows;
  for (const r of all) {
    r.forEach((cell, i) => {
      // 中文字符按 2 列宽估，保证视觉对齐
      const w = [...cell].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
      widths[i] = Math.max(widths[i] ?? 0, w);
    });
  }
  const pad = (s, i) => {
    const w = [...s].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
    return s + ' '.repeat(widths[i] - w);
  };
  const fmt = (r) => `| ${r.map((c, i) => pad(c, i)).join(' | ')} |`;
  const sep = () => `| ${widths.map((w) => '-'.repeat(Math.max(w, 3))).join(' | ')} |`;
  const lines = head ? [fmt(head), sep(), ...rows.map(fmt)] : rows.map(fmt);
  return lines.join('\n');
}

/**
 * ★ 开发纪律的**唯一住处**是仓库根的 `AGENTS-RULES.md`（纯 markdown，可直接编辑）。
 *   生成器把它 include 进来 —— 为什么不直接写进模板字面量：
 *   模板是 JS 模板字符串，纪律正文里的反引号会**提前终止字符串**（实测踩过两次，
 *   一次在 schema.ts 的 SQL 注释、一次就在这里）。长文本一律放 .md。
 */
function readRules() {
  try {
    const p = fileURLToPath(new URL('../AGENTS-RULES.md', import.meta.url));
    const body = readFileSync(p, 'utf8').trim();
    // ★ 2026-10-31（第十二轮复核 B1）：「读到了但内容为空 / 被截断」与「没有规则」是同一件事的两条路径
    //   —— 只堵住 catch 那条不够（实测空文件 ⇒ 写出 116 行 vs 正常 278 行，EXIT 0、--check 自洽绿）。
    //   判据：正文必须够长；不够长就当作**没读到**（0.12：读到了却没内容 ≠ 有内容）。
    if (body.length < 1500) {
      throw new Error(
        `AGENTS-RULES.md 内容异常（仅 ${body.length} 字符，正常数千字符）⇒ 视为没读到，拒绝生成缺节的 AGENTS.md。`,
      );
    }
    return body + '\n\n';
  } catch (e) {
    // ★★★ 2026-10-31（第十一轮复核）：原来 `return ''` ⇒ 写出**少了整节「零、开发纪律」**的 AGENTS.md
    //   （实测 114 行 vs 251 行），打印「已重建」、EXIT 0，随后 `--check` 自洽绿 —— 而 pre-commit 就跑它。
    //   ⇒ 0.12：规则读不到 ≠ 没有规则 ⇒ 必须抛。
    throw new Error(
      `读不到 AGENTS-RULES.md（开发纪律的唯一住处）：${e?.message ?? e}\n` +
        '  ⇒ 拒绝生成一份「少了整节纪律」的 AGENTS.md（那比不生成更坏）。',
    );
  }
}

function buildAgents() {
  const triggerTable = renderTable(['开发动作', '必用工具', '说明'], TRIGGER_ROWS);

  return `# AGENTS.md — 开发动作 → 必用工具

> 由 \`scripts/gen_agents.mjs\` 从 \`TRIGGER_ROWS\` + 本文件模板生成。改映射改源头，不手改产物。
> \`npm run build\` / pre-commit 会重建；\`node scripts/gen_agents.mjs --check\` 只比对。

${readRules()}## 一、动作 → 工具

${triggerTable}

## 二、改名

一律走 \`rename_symbols\` / \`rename_files\`，不用 grep + 正则手改。

1. \`dry_run:true\` 先看结构化 diff（每文件 \`ops[{old,new}]\`）
2. diff 对得上再落盘
3. 文件名 = 符号名时，条目加 \`rename_file_if_matching:true\`
4. 局部名走 \`rename_symbols scope=local\`，不手改

例外：非 TS/JS/Go/Python 文件，且工具不支持时。

## 三、写代码前后

| 时点 | 做什么 |
|---|---|
| 改了 \`src/\`，调工具前 | \`npm run build\` —— 工具跑 \`dist/\`，不 build 就是旧逻辑 |
| 并行作业 | 不许并行 \`npm run build\`（共写 \`dist/\`）；验证可写库外 loader 直跑 \`src/\`，用完清探针产物 |
| 提交前 | \`npm run verify\`（门清单见 \`docs/GUIDE-GATE.md\`） |
| 改完只想跑受影响的证 | \`npm run verify:changed\` —— **增量入口**（按改动集挑证 + 契约；★ 它不是闸，是内环） |
| 想查陈旧租约 / 漏收口 | \`npm run patrol\` —— **只报告不改 state**（TTL 到期、claimed 超期、missed_close） |
| 调工具前查入参 | \`npm run tool -- <工具名> --schema\` |

## 四、判据与数据

- 判语法结构走 AST（\`ts_kernel\`）；正则只用于「文本形状本身就是答案」的场合，并在注释写明为什么
- 能现取（AST / 运行时数据 / 结构化 API）就不落第二份；必须留的进 \`stage_registry.STAGES\`，带 \`owner\` / \`inputs\` / \`fresh\` / \`produce\`，且只留一处
- 不新造字段 / 表：先挂进已有载体（\`cache.db\` / \`B_TERMS\` / \`chain_wiring\`）
- 不加新门：不写拦截脚本、对账判据、棘轮 / 基线 / 豁免清单；脚本只提示不产出 ⇒ 删
- **工具面收敛原则**：同一生态位出现更高级工具 ⇒ **吸收旧的**，全方面只留一个，最终吸收进设计侧（判据/DSL）——被吸收的工具拆注册不拆执行核，行为场景改用判据表达（例：\`behavior_baseline\` 已并入 \`behavior-cases\` 判据生态）
- 门 / 判据 / 读数四态的规矩只住 \`docs/GUIDE-GATE.md\`，本文件不复述

## 五、交付

- 做完一项 ⇒ 写回执（commit message + \`.workbuddy/memory/YYYY-MM-DD.md\`）+ 从 \`docs/todo.md\` 删掉那一行；清单清空即删文件
- **新增功能 ⇒ 在 \`docs/PITCH.md\` 追加一条卖点**（每条必须挂一张证 + 一个可复现读数；有边界就如实写 \`[未核]\`）——这份活文档就是收官材料，别等最后凭记忆补
- **退役任何能力（工具 / 文件 / 链路 / action）⇒ 在 \`docs/RETIRED.md\` 记一条**：判据 + 现在用什么 + 代价；★ 退役要连 **enum / 描述 / AGENTS 触发行** 一起改，否则"退役"会变成"改语义"
- 契约变更（工具名 / 签名 / 对外行为 / MCP 注册名）⇒ 同步 \`README.md\` / \`README.en.md\` / 本表；实现变更不碰文档
- 新增代码 / 注释 / 文档不出现旧品牌串：\`design-canvas\` / \`DESIGN_CANVAS\` / \`design_canvas\` / \`DesignCanvas\`
- 旧品牌串现查：\`grep -rn "design-canvas\\|DesignCanvas" src/ docs/\`

## 六、派子代理

| 环节 | 派法 |
|---|---|
| 大范围侦察 / 波及面量化 / 长尾静默失效 | 派；互不重叠则并行投 |
| 独立核验 | 派，且不给它看结论，让它从源码自己清点 |
| 单文件小改 / 需连续上下文的设计决策 / 会写共享产物 | 不派 |

- 派活先写判据，要求「先回报再动手」；回报含「核了什么、读数是什么」
- 关键结论换一种口径再数一遍，回到原始数据复核

## 七、文档

| 文件 | 是什么 |
|---|---|
| \`docs/INDEX.md\` | 唯一入口：目录 / 工具 / 状态 / 未完成 |
| \`docs/GUIDE-GATE.md\` | 门、证、判据、写门规矩 |
| \`CONTRIBUTING.md\` | 加 / 删工具要动哪几处 |
| \`README.md\` / \`README.en.md\` | 项目是什么 + 怎么跑 |
`;
}

// ─────────────────────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const generated = buildAgents();
const existing = (() => {
  try {
    return readFileSync(OUT, 'utf-8');
  } catch {
    return null;
  }
})();

const upToDate = existing === generated;

if (args.includes('--check')) {
  if (!upToDate) {
    console.error('[gen_agents] AGENTS.md 与生成版不一致，请运行 `node scripts/gen_agents.mjs`。');
    process.exit(1);
  }
  process.exit(0);
}

if (!upToDate) {
  writeFileSync(OUT, generated, 'utf-8');
  if (!args.includes('--silent')) console.log('[gen_agents] AGENTS.md 已重建。');
} else if (!args.includes('--silent')) {
  console.log('[gen_agents] AGENTS.md 已是最新，无需重建。');
}
