#!/usr/bin/env node
/**
 * gen_agents —— 自愈生成 AGENTS.md 的「触发点总表」（方案A，2026-09）
 *
 * 背景：AGENTS.md 反复被一个外部持久进程用它的旧快照盖写（重排整表 + 把某行盖回旧值），
 * 且 IDE 打开/重启、git hook、仓库代码、GitHub Actions 都已证伪为写手。鉴别后确认是
 * 仓库之外、触发时机在 commit/agent 行动附近、持旧缓存的东西。
 *
 * 止损方案：把 AGENTS.md 变成「生成产物」。触发点总表由本文件里的 TRIGGER_ROWS 单一事实源
 * 渲染；任何外部把表盖写成什么样，下一次执行本脚本（npm run build / pre-commit）都会重建回
 * 正确版——外部想还原也还原不成。
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
// 唯一事实源：触发点总表（按开发动作分组）
// ─────────────────────────────────────────────────────────────
const TRIGGER_ROWS = [
  ['不确定用哪个工具？先分层定位', '`capability_map`', '输出完整能力线地图（6线×工具清单），agent 先看线再选工具；高频工具可直接用'],
  ['开发前先看 / 画活文档', '`get_dsl` / `render_design` / `edit_dsl` / `manage_feature`', '开工前对齐设计，避免方向性错误'],
  ['记录结构化目标/方向，或解释「A 为何依赖 B」', '`design_intent`（action=set）', '写 goals（目标/方向）+ edge_intents（边级意图 + 边界归属）到设计意图 overlay，落进 base 的 meta.goals / edge.intent 供 LLM 与读端消费'],
  ['日常维护（补节点/改描述/加标注）', '`edit_dsl weight=routine`', '轻量写路径：跳过 L4 证据回溯，仍留 L1-L3 防空话；改架构/契约等重改用 normal 全链'],
  ['改一个模块级符号名', '`rename_symbols`（scope=module，缺省）', '单条或批量统一入口（renames=[…]），自动定根+闭包+跨语言，先 dry_run 看 diff'],
  ['批量改多个模块级符号', '`rename_symbols`（scope=module）', '先整体 dry-run，全部可落盘才落'],
  ['改文件内局部变量/形参（可跨多文件）', '`rename_symbols scope=local`', '作用域隔离：同作用域不撞名、不同函数/块的同名绑定互不误伤；逐项独立，跳过项逐条可见'],
  ['改**对外契约名 / MCP 工具名**', '`rename_symbols report_literals=true`', '扫旧名 snake 字面量清单，按 kind 分治(契约/历史/文档/测试/代码)；契约变更才跟文档'],
  ['改文件名并联动全仓 import', '`rename_files`', '单条或批量统一入口（renames=[…]），防文件悬空'],
  ['批量改多个文件名', '`rename_files`', '整体先 dry-run，全部可落盘才落'],
  ['单文件/文件内局部变量/形参批量改名', '`rename_symbols scope=local`', '作用域隔离；逐项独立（一项跳过不影响其余），跳过项逐条可见'],
  ['改一段代码（函数体/range）', '`edit_code`', '按符号/行号定位改写'],
  ['理解一串代码/结构', '`explore_code`', '只读、即时答案'],
  ['清理无效 import', '`remove_dead_imports`', '剪刀剪 dead_deps'],
  ['给函数补/维护语义化注释（缺失补、body 变了重注）', '`annotate_functions`', 'TS/JS + Go 函数语义注释：扫覆盖→LLM 补→@fnhash body 指纹同步过期；mode=scan/dry_run/apply；也可开 refactor_pipeline 的 function_annotation 步'],
  ['把一个功能搭成一条主链 / 沿线看这功能怎么走', '`feature_line`', '功能线：每功能挑入口函数→沿功能内调用边走成主链；target 留空返回全功能 入口+链长 总览；沿线单步运行用 trace-exec'],
  ['要改设计意图(why)前先请人批', '`design_intent`（action=propose）', 'LLM 代拟「意图改写」审批卡：propose 只算前后 intent diff 不写盘；人在工作台「代码审批」approve 后才真写 DSL（reject 则丢弃）'],
  ['看「谁引用了 X / 谁调用了 X」', '`find_references`', '只读引用查询；mode=field 报字段读取/构造点（加字段/改签名前必查，勿回退 grep）'],
  ['加字段/改接口签名前查波及面', '`find_references mode=field`/`mode=type field=<字段>/symbol=<类型>`', '读/构/解/声明四类 AST 分类＋行内上下文；type 模式找形如某类型的对象字面量构造候选'],
  ['跑测试/提交前回归', '`run_tests`', '结构化失败定位（filter 定向 or 全量）'],
  ['改完代码看设计是否过时/欠实现', '`detect_drift`', '一次性核对：代码变更→提示 DSL 需同步，mode=status 复读台账'],
  ['常驻盯项目漂移（安全网）', '`explore_code action=watch feature=... drift_on_change=true`', '后台监听：文件一变自动 rebuild+过时判定+主动 pushAlert'],
  ['提交前健康检查', '`consistency_check` / `sync_contracts`', '契约/一致性'],
  ['改前看影响面', '`diff_views` / `reconcile_chain`', '波及方向'],
  ['改前**量化风险**/找最易炸的文件', '`impact_analysis`（hubs=true 热区盘点）', '改前风险闭包：变更点→反向可达闭包，输出受影响文件+风险排序'],
  ['两项目要合并/迁移，先查撞名', '`cross_repo_symbol_index`', '符号冲突/双胞胎/迁移范围'],
  ['把 Go 项目/文件翻成 TS', '`translate_go_ts`', '机械骨架+验证闸（默认）；fill 用 AGNES key 池 LLM 逐孔填函数体；verify 对纯函数跑 Go↔TS 行为对拍'],
  ['改完一个函数，验证"跑得对不对"', '`behavior_baseline`', '金丝雀 harness：样例输入跑一次 capture 快照，改后 verify 对比'],
  ['选材/体检，评估项目健康度', '`code_health`', '死代码/圈复杂度/分层违规 → 健康分 + 问题清单'],
  // ★ T15 切片（2026-10-05）：把原先 CLI-only 的「混合文件解耦」与「能力矩阵自检」接进 MCP 面。
  ['把一个混合文件拆成独立文件（解耦）', '`signal_review` → `split_stage`', '`signal_review` 先 LLM 复核出「采纳簇」（LLM 不可用时**诚实降级**、不伪造结论），`split_stage` 再按簇切文件（**默认 dry-run**，`apply=true` 才落盘，带编译/测试级验收 + 失败回滚）'],
  ['查语言支持度 / 该补哪个功能或哪门语言', '`capability_audit`', '语言 × 功能的 AST 覆盖缺口清单（只读纯计算）；★ 与 `capability_map`（**工具导航**）不是一回事'],
];

// 改名场景表（静态，不随 build 频率变）
const RENAME_ROWS = [
  ['改一个模块级符号（函数/const/class/interface/type/enum）', '`rename_symbols`'],
  ['批量改多个模块级符号', '`rename_symbols`'],
  ['改文件名并联动全仓 import 引用', '`rename_files`'],
  ['批量改多个文件路径', '`rename_files`'],
  ['文件内局部变量/形参批量改名（可跨多文件）', '`rename_symbols scope=local`'],
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
  const sep = (i) => `| ${widths.map((w) => '-'.repeat(Math.max(w, 3))).join(' | ')} |`;
  const lines = head ? [fmt(head), sep(), ...rows.map(fmt)] : rows.map(fmt);
  return lines.join('\n');
}

function buildAgents() {
  const triggerTable = renderTable(['开发动作', '必用工具', '说明'], TRIGGER_ROWS);
  const renameTable = renderTable(['场景', '必用工具'], RENAME_ROWS);

  return `# AGENTS.md — agent-io 开发约定（为 AI agent 编写）

> 本文件约束在此仓库内进行开发时，agent（Trae/Claude 等）应遵循的规则。
> 核心目标：让日常开发动作（改名/编辑/理解/清理/引用/测试/漂移）走项目自带 MCP 工具，
> 而不是用 grep+脚本手动硬改——那是「工具被想起」的最大障碍。

> 注意：本文件的「触发点总表」由 \`scripts/gen_agents.mjs\` 从 TRIGGER_ROWS 单一事实源生成。
> 外部进程若把它盖成旧版，下一次 \`npm run build\` / pre-commit 会自动重建回正确版。
> 改工具映射请改 TRIGGER_ROWS，不要手改本表。

## 触发点总表（按开发动作）

${triggerTable}

## 改名约定（强制优先用工具）

当任务涉及**重命名**（符号、函数、类、文件、变量、作用域内局部名）时，优先使用本仓库 MCP 暴露的
\`rename_*\` 工具，而非 \`grep + 正则\` 手动替换。

${renameTable}

**硬性流程（每次改名都执行）：**

1. 先传 \`dry_run=true\` 看结构化 diff（返回每个受影响文件的 \`ops[{old,new}]\`）。
2. 核对 diff 符合预期后，再去掉 \`dry_run\` 落盘。
3. 改名面向「文件主导出」时（文件名 = 符号名），\`rename_symbols\` 的条目加
   \`rename_file_if_matching=true\` 联动改名文件。
4. 符号/文件改名统一走 \`rename_symbols\` / \`rename_files\`（单条或批量皆可；先整体 dry-run 校验，全部可落盘才落盘）。

**例外（可绕过工具直接手改）：**

- 目标不是模块级符号（局部变量畅通走 \`rename_symbols scope=local\`，而不是手改）。

- 非 TS/JS/Go/Python 文件的改名，且本仓库工具不支持时。

## ★ 判「这段代码是什么」：先 AST，正则只用于本来就该正则的场合

本仓 ts_kernel（tree-sitter）是**符号 / import / 调用边 / 类型引用**的唯一权威来源。

**默认走 AST**：判语法结构（这是什么节点、谁调用了谁、实参长什么样）一律用内核解析，不手写正则。
**正则只留给「文本形状本身就是答案」的场合**（扫一段 log、匹配用户输入、找注释里的一句话…），
且**注释里写明为什么这里该用正则**。

★ 为什么（本仓实测，不是口号）：同一件事 AST 4/4 正确、正则 2/4 —— 错的两次**都是静默漏报**：
「vi . mock」（点号两侧带空格）、换行 + 制表符的跨行写法，正则**没匹配到且不报错**。
**正则的失败模式是「悄悄少做一点事」，正是本仓最反对的那种。**

判定顺序（用下一级必须写明为什么上一级不行）：
1. 事实**能表示成数据**吗？能 ⇒ 用运行时数据 / 结构化 API（零解析、不可能漂移）
2. 不能，但它**是语法结构**？⇒ AST（ts_kernel / parseFileFull / ParsedFile）
3. 只有**文本形状本身就是答案**时，才用正则

## ★★★ 数据流转：能现取就别存副本（2026-10-05 立）

**一句话判据**：**能表示成数据就不解析；能引用就不复制；只有「加工贵 **且** 下游重算贵」的才落盘。**

三问（按顺序问，前一问能答就不再往下问）：
1. **能现取吗？**（AST / 运行时数据 / 结构化 API）⇒ 能 ⇒ **只转发，不落第二份**；
2. **必须留吗？**⇒ 必须留 ⇒ **必须挂进 \`stage_registry.STAGES\`**（带 \`owner\` / \`inputs\` / \`fresh\` / \`produce\`），**且只留一处**；
3. **已有结构能承载吗？**⇒ 有 ⇒ **用已有的，不新造字段 / 表**。

★ 为什么（本仓头号病根）：**同一份知识两处落点 ⇒ 判据分叉**。实测反例：\`expected_apis\`（意图，权威在 DSL）
与 \`actual_apis\` / \`actual_deps\`（**代码的权威，却镜像进意图册**）—— 第二份可写副本。
★ 跨 [B] 的中间数据另有**同族**判据：**下游若不用它，是不是得从头重算一遍？**
重算贵 ⇒ **出参**（进 \`Touched\`）；下游自己轻松能得到 ⇒ **剪贴板 / 变量**（原样传下去，**不占「链的接口」**那一格）。

**「项目中已有相似结构」= 这四个载体（新数据先问能不能挂上去）：**

| 数据形态 | 已有载体（路径 / 符号） | 怎么用 |
|---|---|---|
| 可直接取用的 AST 事实 | ts_kernel（\`parseFileFull\` / \`analyzeModuleSource\`） | **现取**；不许再镜像一份 |
| 加工 / 解析后的数据 | \`cache.db\`（\`files\` / \`edges\` / \`imports\` / \`symbol_index\`）+ \`src/application/stage_registry.ts\` 的 \`STAGES\` + \`ensureStage()\` | 留**且唯一**，带 \`owner\` 与 \`fresh()\`；缺了**往上溯源上游工序** |
| 跨 [B] 的中间数据 | \`src/domain/b_terms.ts\` 的 \`B_TERMS\`（受控词表）+ \`Touched\` | 字段名**从词表选**；只有"下游重算贵"的才进 \`Touched\` |
| 「上一步 → 下一步」的接法 | \`src/domain/chain_wiring.ts\` | 新链接法**写进表**，别只活在对话里 |

★ 落地时**不要**为它建"副本登记表 / 棘轮 / 基线" —— 那本身就是**第二份副本**（见下一节「不养门」）。

## ★★★ 不养「门」（2026-10-05 用户裁定）—— 本文件里最上位的一条

**重构的意义只有两条**（用户原话）：
1. **组件的形状** —— 依赖是否合理？找它的各个部件是否方便合理？**一眼能看出现在是什么层级、
   应该去哪个位置找另一个层级、而且不会和别人混淆**；
2. **达成目标功能**。

> 「**其他的所有的门什么的，都是你自己演化出来的，非常无用的，过度工程化的工具。**」

**为什么不要门**：
> 「你能自己在**摸到这套代码的时候，就很容易发现**，根本不需要再经过门再去提示一遍。
>  虽然门提示是很方便，但是**门的维护非常的难受**。这个方便只为你节省了几次查看文件的 Token，
>  但是为了得到这份方便，你要**数以十计的去维护这个门**……**非常影响你的心智**。」

⇒ 算式：**省几次读文件的 token** 换 **数以十计的维护 + 长期占心智** ⇒ **划不来**。

**因此**：
- **不加新门**：不写「拦截型脚本」、不立「对账判据」、不建「棘轮 / 基线 / 豁免清单」；
- ★ **发现问题的正解是「修形状」，不是「加检测」** —— 形状对了，问题就不存在（不必靠检测提醒）；
- 要判断某件事，**用已有工具或直接读代码**；**不要为了「让它自动被提示」而留一个脚本**；
- ★ 判据一句话：**如果一个脚本的产出只是「提示你去看某个文件」，那它就该删。**

**★ 但先把「生成器」和「检测器」分开**（2026-10-05 由一次误删换来的）：

| 类 | 它做什么 | 例 | 判定 |
|---|---|---|---|
| 检测器 | 只提示你去看某个文件 | contract_docs_gate / capability_scan / readme_tools_gate | 删 |
| 生成器 | 产出实际的东西 | measure_b_contract（生成 2 份文档）/ gen_agents / gen_endpoints_schema | 留 |
| 干活器 | 真的改东西 | relink_specifiers / clean_dist | 留 |
| 读取器 | 读现状给你看 | structure_gap | 留（天天用）|

⇒ **先看它有没有产出物**：有产出物的是**功能**；只有"提示"的才是**门**。

★ 实测教训：measure_b_contract.mjs 头注自称"进展量具"，曾据此外貌被删 ——
  而它其实是 docs/glossary.md 与 docs/b-field-dictionary.md 的**唯一生成器**，
  删掉它 ⇒ **那两份文档再也无法从代码重新生成 ⇒ 文档与代码脱钩**（判据分叉的另一种形态）。**已恢复。**
  ⇒ 一句话：**"看它长什么样"会骗人，"看它有没有产出物"才准。**

## ★★ 清单纪律：做完一项 ⇒ 立刻写回执 + 销行（不许攒）

**顺序是「做完 → 写回执 → 从清单删掉那一行」，不是「做完 → 攒着 → 以后一起补」。**

- 回执 = **commit message + 项目记忆**（\`.workbuddy/memory/YYYY-MM-DD.md\`）
- 清单文件：**docs/todo.md（唯一一份）** —— 它只放**还没做的**
- **不留划线、不留「已完成」专区** —— 回执在 commit 历史里，清单不是台账
- 新发现的事 ⇒ 补在**同一个文件的下面**；★ 但**只做清单上的**，清单外的事先讨论要不要上清单
- **全表清空 ⇒ 整个文件删掉**（清单结页即销毁）
- ★★ 用户 2026-10-04 再次强调，说明我一直在欠这条：
  「第一步难道不应该是每次写完项目之后就直接开始写回执了吗？我不是强调过很多遍吗？
  你做完一项就勾一项呢？」⇒ **「勾」= 把它从清单上消掉**，不是标记完成。

## 验证约定（★ 2026-10-04：本项目已无测试套件）

- **不设单元测试套件**（2026-10-04 框架整体移除）。验证 = 先 build（tsc 是第一道闸门）→ 再用 npm run tool -- 「工具名」**真调一遍**；顺着链走，哪里有 bug 就修哪里，**不要回头补测试**。
- ★★ **并行作业时：「不许写共享产物」≠「不许运行验证」**（2026-10-04 立）。
  多个执行者并行时，**别让任何人跑 \`npm run build\`** —— 它会重写共享的 \`dist/\`，**一个执行者的中间态
  会让另一个人的 build 报错**（实测踩过：8 条 \`no exported member\`）。
  **但"禁止 build"只禁"写公共产物"，不禁"跑真验证"**：
  · 可以写**库外的**自定义 loader 直跑 \`src/\`（\`.js\`→\`.ts\` 解析 + \`typescript.transpileModule\` 擦类型），
    **只读源码、不碰 dist** ⇒ 完全合规；
  · 可以跑**真实对照**（改前/改后各出一份结果，**对 sha256 或逐条比对**）——
    这比"只跑 \`tsc\`"强得多：**\`tsc\` 只证明类型对，证明不了行为没变**。
  · 用完**必须清掉探针产物**（临时 feature / cache.db / 生成目录），别污染仓库。
  ★ 判据一句话：**验证要真跑、要能复算；但要保证"别人在同一个工作树上干活不受你影响"。**

## ★★ 子代理协作：什么时候派、怎么派、怎么收（2026-10-05 立）

★★ **2026-10-05 放宽（用户裁定：「子代理的策略可以更激进一些」）—— 从"可以派"改成"默认派"：**

- **默认并行投**：一条线里**互不重叠**的子问题，**一次投多个**子代理（别串行等），也别等主线程 grep 完才派。
- **独立核验强制化**：改动落地后**必须**派一个「**不给它看结论**」的子代理，从源码自己清点一遍
  （本仓实测：一次清出 ≈18 项漏登记 + 3 处"同一份数据两个根"）。
- **波及面量化 / 长尾静默失效排查默认派**，主线程不自己 grep 全仓。
- **团队模式**：两条线**互不重叠**时可各起一个 named teammate 并行
  （例：T54 只碰 \`b_terms\` / \`chain_wiring\` / \`find_references\`；T20(4) 只碰 \`handlers.ts\` + 只读 \`file_facts\`）。
- ★★ **放宽 ≠ 解除硬边界**（尤其：**不许并行 \`npm run build\`** / **派活先写判据** / **落盘与提交串行**）
  —— 它们是用真金白银换来的。

**该派的环节**（代价高 / 面铺得开 / 需要"第二个视角"）：
1. **大范围侦察与定位**（跨多目录、多命名约定）；
2. ★ **独立核验** —— **不给它看结论**，让它从源码自己清点（本仓实测：一次清出 ≈18 项漏登记 + 3 处"同一份数据两个根"）；
3. **迁移 / 改名前的波及面量化**；
4. **长尾静默失效排查**（散文里的旧路径、仓外引用、**仓外 client 配置**）。

**不该派的**：单文件小改；需要连续上下文的设计决策；**任何会写共享产物的动作**。

**分工与协作**：
- **读 / 写分离**：侦察者**只读**；改由主执行者做（避免两个执行者改同一处）。
- ★★ **同一工作树上不许并行 \`npm run build\`** —— 它会重写共享 \`dist/\`，
  **一个执行者的中间态会让另一个人的 build 报错**（实测：8 条 \`no exported member\`）。
  ★ 但**「不许写共享产物」≠「不许运行验证」**：可以写**库外**自定义 loader 直跑 \`src/\`；
  可以跑**改前/改后对照**（对 sha256 或逐条比对）—— 比"只跑 \`tsc\`"强得多（\`tsc\` 只证类型、不证行为）；
  **用完必须清掉探针产物**。
- ★ **落盘 / 提交串行**：改文件与 \`git commit\` 由**主线程**做（避免同分支并发写）；子代理**只读**
  （除非明确划给它独占文件）。
- **派活格式（硬性）**：**先写清判据 + 要求「先回报再动手」**。
  ★ 依据：本仓实测**子代理三次推翻派活方的假设**（"这条是死路"其实有活的生产者 / "这个修法"会引入跨语言误解析 /
  "影响面是闭包"实测 0 变化）⇒ **不许只信任务单里的假设**。回报必须含「**我核了什么、读数是什么**」。
- **验收（四步）**：① \`tsc\` 与 \`build\` **分别**跑通；② **关键结论换一种口径再数一遍**
  （防「量具量到影子」—— 实测 \`read_files\` 报 10/31、**实为 5**，因为它的扫描把注释也数了进去）；
  ③ **展示层不许 filter 关键字段再下判断**；④ 结论回**原始数据**（\`--json\`）复核一次。

## 文档同步纪律（契约变更才跟）

- **契约变更**（工具名 / API 签名 / 对外行为 / MCP 注册名）→ 文档**必须**同步（README / AGENTS / skill / 测试断言 / 错误提示字符串），否则文档在说谎。
- **实现变更**（只改内部逻辑，对外名与行为不变）→ **不碰文档**，碰了就是制造噪音。
- 改文档 ≠ 改写历史：\`docs/tool-convergence\` 的历史决策/核验记录是事实，保留原貌，变更用**追加记录**表达，不要把旧记录改成新名。
- 改生成物先改源头：AGENTS.md 由 \`scripts/gen_agents.mjs\` 从 \`TRIGGER_ROWS\` 生成，改工具名要改源头而非生成物本体。

## 品牌串约定（旧名不许新增）

本仓已从 \`DesignCanvas\` 改名为 \`AgentIO\`（包名 \`agent-io\`）。
**新增的代码 / 注释 / 文档里不许出现旧品牌串**：\`design-canvas\` / \`DESIGN_CANVAS\` / \`design_canvas\` / \`DesignCanvas\`。

★ **例外（历史记录，必须保留原貌）**：\`docs/architecture-refactor-plan.md\`、\`docs/tool-convergence.md\`、
\`docs/refactor-playbook.md\` —— 它们记的是"**在那个名字下发生的事**"，改掉即**篡改历史**
（与上一节「改文档 ≠ 改写历史」同一条）。

★ **怎么查——现算，不要养登记表**：需要时用 \`explore_code action=search\`，或直接

\`\`\`bash
grep -rn "design-canvas\\|DESIGN_CANVAS\\|design_canvas\\|DesignCanvas" src/ tests/ docs/
\`\`\`

**不要**再为它建"登记表 + 棘轮 + 门"：那类**存下来的结论会过期**（2026-10-03 实测同类清单
过期率 44%），而**这一节就是那份约定本身**。

## 工具自检（强约束）

- 本仓库 MCP 工具依赖 \`dist/\` 构建产物。改了 \`src/\` 下的代码，**必须**先
  \`npm run build\` 再调用工具，否则跑的是旧逻辑（STALE BUILD）。

## 决策记录

- 工具收敛 / 命名 / 使用摩擦的决策记录在 \`docs/tool-convergence.md\`。

- 本文件由生成器维护，外部还原会被 \`npm run build\` / pre-commit 自动修复；以 git 提交历史为准。
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
  if (!args.includes('--silent')) console.log('[gen_agents] AGENTS.md 已重建（触发点总表自愈）。');
} else if (!args.includes('--silent')) {
  console.log('[gen_agents] AGENTS.md 已是最新，无需重建。');
}