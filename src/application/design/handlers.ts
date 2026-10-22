/**
 * design 线的工具入参适配层（handler）—— ★ 2026-10-05 从 `application/handlers.ts` 按线拆出。
 *
 * 为什么要拆：原来 15 个 handler 挤在一个跨 5 条线的文件里，而 5 个 lane 的 `index.ts` 都 import 它
 * ⇒ `application/` 与每个 lane **互为消费方**（目录级环：文件级无环，所以 code_health 报 0 是对的，
 *   但**目录**才是人导航的单位）。拆开后每条线自足：给这条线加工具只动这条线内的文件。
 *
 * 本文件由 `edit_code`（AST 取边界）从原文件逐符号搬入，**不是手抄**；tsc 是闸门。
 */

import { wrap, wrapData, requireStr } from '.././plumbing.js';
import { dispatchDslEdit } from '.././dispatch.js';
import { getDSLByView, getDesignSheet, getDesignSheetFile, getLiveFeatureResolved, getLiveDir, requireProjectRoot } from '../../infrastructure/storage.js';
import { checkConsistencyReport, retireMarksOf } from '.././design/intent/consistency.js';
import { deriveMindMap } from '.././meta/view/derive_mind_map.js';
import { detectDrift } from '.././design/intent/detect_drift.js';
import { exportMarkdown, exportSvg } from '../../infrastructure/render/export.js';
import { queryFeature } from '.././meta/explore/query_feature.js';
import { fileFacts } from '../../infrastructure/index/file_facts.js';
import { validateReason } from '.././observe/reconcile/reason_validator.js';
import type { ReasonEvidenceRef } from '.././observe/reconcile/reason_validator.js';
import { buildTraceResolver, loadObservedTraceRecords } from '.././observe/capture/trace_evidence.js';
import { updateFeature } from '.././design/dsl_ops/update_feature.js';
// ★★ 2026-10-09（T73）：差异块 —— 把 per-file 差异折成"可重写的区域块"。
//   `scope.ts` 是"圈定范围"的**文法与解析唯一落点**；`diff_blocks.ts` 是"归块"的纯函数。
import { resolveScopeText, formatScope } from '../../domain/scope.js';
import { buildDiffBlocks, hasDiff, type FileDiff } from '../../domain/diff_blocks.js';
// ★★ 2026-10-09（T74）：验收执行 —— 类型/格式化在 domain，判定器在 application（domain 不许 import infrastructure）
import { collectExpectations, describeExpectation, expectationSubjectPath, expectationPaths, normPath } from '../../domain/expectation.js';
import { judgeExpectations } from './intent/expectations.js';
// ★★ 2026-10-15：设计图（手写）vs 实际（扫描）的**只读对拍** —— 纯比对住 domain（无 IO）。
import { diffDesignSheet, diffDesignSheetLine, designSheetRef } from '../../domain/design_sheet.js';

/** consistency_check：一致性。★ wrapData（2026-09-29）：[B] 回 `ConsistencyResult`
 *   = `{ message, fileResults[], invariantResults[], summary{totals…} }` ——
 *   逐文件 API 匹配明细 + 不变式结果 + **计数摘要**原被 `wrap` 丢掉（agent 无从机器判定"过没过"）。 */
export const consistencyHandler = wrapData(async (a) => {
  const r = await checkConsistencyReport({
    feature: a.feature as string,
    code_dir: a.code_dir as string | undefined,
  });

  // ★★★ 2026-10-09（T74）：「**验收执行**」—— 决策卡上的 `expectations` 逐条判。
  //   为什么在这儿：本工具就是"设计 ↔ 代码"的对账；`expectations` 是人写的验收标准，
  //   两者同一个动作（拿设计去问代码）。**不另起一个工具**（少一个面、少一处登记）。
  //   ★ 判不了的单列 `unsupported`（既不算过也不算不过）—— 见 `intent/expectations.ts` 纪律 2。
  const feature = a.feature as string;
  const dsl = getDSLByView(feature, 'design');
  const expItems = dsl ? collectExpectations(dsl) : [];
  const expRoot = dsl?.source_root ?? (typeof a.code_dir === 'string' ? a.code_dir : '');
  const exp = expItems.length && expRoot && dsl ? await judgeExpectations(expRoot, expItems) : null;
  const expNotes: string[] = [];
  if (expItems.length && !expRoot) {
    expNotes.push('决策卡上有 `expectations`，但**拿不到项目根**（`dsl.source_root` 与 `code_dir` 都没有）⇒ **一条都没判**（不是"都通过"）');
  }
  if (dsl && expItems.length === 0) {
    const withAcceptance = (dsl.geometry?.nodes ?? []).filter((n) => n.decision?.acceptance?.trim()).length;
    if (withAcceptance) {
      expNotes.push(
        `有 **${withAcceptance} 个**决策卡写了 \`acceptance\`（一句话），但**没有一条可判定的 \`expectations\`** ` +
          `⇒ 验收**仍无人执行**。★ 这是允许的，但要知道：判不了的东西，重写完也验不了。`,
      );
    }
  }
  // ★ 阻断通路：**唯一的失败路径是抛错**（`cli.ts:297` 的 `r.isError ? 1 : 0` 只认它）。
  //   ★ 只对 `fail` 阻断，**不对 `unsupported` 阻断**（判不了 ≠ 不过；在 Go/Python 上阻断会让门没法用）
  //     —— 但 unsupported 的条数会同时出现在**报告**与**抛出的错误里**，不许它悄悄溜过。
  if (a.fail_on_violation === true && exp && exp.failed > 0) {
    throw new Error(
      `验收未通过（fail_on_violation=true）：${exp.failed} 条 expectations **判定为不满足**\n` +
        exp.items
          .filter((x) => x.verdict === 'fail')
          .map((x) => `  · [${x.node_id}] ${describeExpectation(x.expectation)} —— ${x.detail}`)
          .join('\n') +
        (exp.unsupported ? `\n★ 另有 ${exp.unsupported} 条**判不了（unsupported）**，未计入阻断 —— 但它们**不是通过**。` : ''),
    );
  }

  // ★★ 2026-10-09（T73）：「**差异块**」—— 把 per-file 差异折成"**可重写的区域块**"。
  //   ★ 不给 `scope` ⇒ **与改造前逐字等价**（原样返回三个字段，行为零变化）。
  //   ★ 给 `scope` ⇒ 只在框定范围内对账，并把差异按**可命名区域**聚成块（块名由 `formatScope` 生成，
  //     见 `domain/diff_blocks.ts` 纪律 1：块名必须稳定，才谈得上"这块我上轮改过了"）。
  const scopeText = typeof a.scope === 'string' && a.scope.trim() ? a.scope.trim() : '';
  if (!scopeText) {
    // ★ 不给 scope ⇒ **差异块那部分与改造前逐字等价**；只是多带一节「验收执行」（`expectation_results`）。
    const expSection = renderExpectationsSection(exp, expNotes);
    const data: Record<string, unknown> = {
      fileResults: r.fileResults,
      invariantResults: r.invariantResults,
      summary: r.summary,
      // ★ T85/D3：**线 1 也要进机器通道** —— 否则只有 message 里有、`---DATA---` 里没有
      //   ⇒ 调用方解析不到它（而"代码变了没"正是要给机器用的）。
      baselineDrift: r.baselineDrift,
      // ★★★ T184（2026-10-12）：**三步流的②** 也要进机器通道。
      //   ★ 这里 `data` 是**显式白名单**（不是 `...r` 展开）⇒ ★ **不加这一行，`retireFlow`
      //     就只活在 `message` 的散文里、机器一律解析不到** —— 而"哪些待删标记已经可以归档了"
      //     正是**下一步动作**（③）的输入，必须是结构化的（本仓 §5 纪律①）。
      retireFlow: r.retireFlow,
    };
    if (exp) data.expectation_results = { checked: exp.checked, passed: exp.passed, failed: exp.failed, unsupported: exp.unsupported, items: exp.items, notes: exp.notes, conflicts: exp.conflicts };
    else if (expNotes.length) data.expectation_results = { checked: 0, passed: 0, failed: 0, unsupported: 0, items: [], notes: expNotes, conflicts: [] };
    // ★★★ 2026-10-09（T81 续）：**全量这条路径也要产 `touched`**。
    //   ★ 我最初只改了「给 scope」那一条 ⇒ 实测才发现**默认那条根本不产 `touched`**（DATA 里连 `blocks` 都没有）
    //     —— 又一次"改的那处不在跑"。★ 两条路径**共用同一套判据**：`hasDiff`（有差异）+ `groupExpectationFails`（归类）。
    const failAll = groupExpectationFails(exp?.items ?? [], () => true).failByPath;
    // ★★★ T187：**待退役也进差异面**（判据一处 = `retireMarksOf` + `hasDiff`）。
    //   ★ 不这么做的后果是**链断**：`scope_files` 是链上唯一的"文件路径"锚点，
    //     而"设计说该删"的文件可以一条契约都不缺 ⇒ 它不在 `scope_files` 里
    //     ⇒ ③（`archive`，要 `file_path`）拿不到该归档的文件。
    const retireMarks = retireMarksOf(r.retireFlow);
    const diffFiles = r.fileResults
      .map((fr) => {
        const p = normPath(fr.file.path);
        return {
          path: p,
          missing: fr.apis.filter((x) => x.status === 'missing').length,
          mismatched: fr.apis.filter((x) => x.status === 'mismatched').length,
          unexpected: fr.apis.filter((x) => x.status === 'unexpected').length,
          expectation_failures: failAll.get(p) ?? 0,
          ...(retireMarks.has(p) ? { retire: retireMarks.get(p) } : {}),
        };
      })
      .filter(hasDiff)
      .map((x) => x.path);
    // ★★★ T184b（2026-10-12）：**兜底** —— 退役标记里那些**不在 `fileResults` 里的**也要进来。
    //   ★ 为什么会有这种：T184b 起，`retireFlow` 也收 **overlay 墓碑**（文件已从 base 消失），
    //     而 `fileResults` 是**按 `semantic.files` 生成的** ⇒ ★ 墓碑**不在里面**
    //     ⇒ 上面那次 `.map()` **根本覆盖不到它** ⇒ `scope_files` 漏掉 ⇒ ★ **②→③ 那条链又断了**
    //       （T187 修的是"退役算差异"，但它当时**默认了"退役的文件一定在 `fileResults` 里"** —— 那个前提现在不成立）。
    //   ★ 与 scope 分支里那段兜底**同一个形状**（那边也有：不在 `sel` 里的补一条）。
    for (const [p, mark] of retireMarks) {
      if (!diffFiles.includes(p)) {
        void mark;
        diffFiles.push(p);
      }
    }
    diffFiles.sort();
    const touchedAll: Record<string, unknown> = { feature };
    if (diffFiles.length) touchedAll.scope_files = diffFiles;
    data.touched = touchedAll;
    return { message: expSection ? `${r.message}\n${expSection}` : r.message, data };
  }

  // ★ scope 分支要 DSL：没有就拿不到"哪一片" ⇒ 响亮报错（不静默退化成"全量"）
  if (!dsl) throw new Error(`feature "${feature}" 不存在（视图: design）⇒ 无法解析 scope`);
  const sc = resolveScopeText(dsl, scopeText);

  const inScope = new Set(sc.paths);
  const sel = r.fileResults.filter((fr) => inScope.has(normPath(fr.file.path)));
  // ★★★ 2026-10-10：**本 scope 里"到底比了几条"** —— `expected_apis` 条数 + 命中该 scope 的验收条数。
  //   = 0 ⇒ **没得比**（scope 版）：**不许**把"范围内无差异"说成「已对齐」（那正是"没查=报好"）。
  const scopeCompared =
    sel.reduce((a, fr) => a + fr.apis.length, 0) +
    (exp?.items ?? []).filter((it) => inScope.has(expectationSubjectPath(it.expectation))).length;
  const scopeNoComparison = scopeCompared === 0;
  // ★ 不许静默：scope 命中、但对账结果里没有的文件（例如不在语义层）要说出来
  const seen = new Set(sel.map((fr) => normPath(fr.file.path)));
  const notChecked = sc.paths.filter((p) => !seen.has(p));

  // ★★★ 2026-10-09（T78）：**把"人写的验收"的失败并进同一份块**。
  //   为什么必须：块的输入原本只有 `expected_apis` 对账，而**设计 DSL 的结构是从扫描 fork 的**
  //   ⇒ 那一路对出来**永远干净** ⇒ **块永远是空的**，而"圈范围"正是这一步的产出。
  //   实测（2026-10-09 真跑）：验收报 `failed 1`，块报"有差异 0 个"，还把出问题的文件列进"已对齐" —— 两者矛盾。
  //   ★ 归属规则**只由 `domain/expectation.ts` 的 `expectationSubjectPath` 决定**（不在这里再推一遍）。
  const { failByPath, outsideScope, unsupportedInScope, unsupportedOutside } = groupExpectationFails(exp?.items ?? [], (p) => inScope.has(p));
  // ★★★ T187：**与"不给 scope"那条路共用同一个判据**（`retireMarksOf`）——
  //   ★ 本仓栽过「改的那处不在跑」（见下面 `diffFiles` 的注释）⇒ 两条路必须同一把尺。
  const retireMarks = retireMarksOf(r.retireFlow);
  const files: FileDiff[] = sel.map((fr) => {
    const p = normPath(fr.file.path);
    return {
      path: p,
      arch_layer: fr.file.layer,
      missing: fr.apis.filter((x) => x.status === 'missing').length,
      mismatched: fr.apis.filter((x) => x.status === 'mismatched').length,
      unexpected: fr.apis.filter((x) => x.status === 'unexpected').length,
      expectation_failures: failByPath.get(p) ?? 0,
      ...(retireMarks.has(p) ? { retire: retireMarks.get(p) } : {}),
    };
  });
  // ★ 兜底（不静默）：验收失败的**主体在范围内、但对账结果里没有这个文件** ⇒ 补一条，
  //   让它照旧能进块（否则这条失败会凭空消失）。
  const covered = new Set(files.map((f) => f.path));
  for (const [p, n] of failByPath) {
    if (!covered.has(p)) {
      files.push({ path: p, missing: 0, mismatched: 0, unexpected: 0, expectation_failures: n });
    }
  }
  // ★★★ T187：**同一个兜底，给"待退役"也来一遍** —— 退役文件若**不在本 scope 内**就不补；
  //   在 scope 内、却不在 `sel`（对账结果）里的，同样不许凭空消失（照上面那条的先例）。
  for (const [p, mark] of retireMarks) {
    if (inScope.has(p) && !covered.has(p)) {
      files.push({ path: p, missing: 0, mismatched: 0, unexpected: 0, expectation_failures: 0, retire: mark });
    }
  }
  // ★ scope 比 `arch_layer` 更窄时（files: / subtree: / nodes:），再按层切没有意义 ⇒ 整个 scope 作一块
  const narrower = sc.scope.kind === 'files' || sc.scope.kind === 'subtree' || sc.scope.kind === 'nodes';
  // ★★ 把"本 scope 真的比了几条"传进去 ⇒ 空块那句"无差异 ⇒ 好消息"在 `scopeCompared===0`（**没得比**）时**不成立**。
  const d = buildDiffBlocks(files, sc.scope, narrower ? 'scope' : 'arch_layer', scopeCompared);
  // ★★ T187：这里原先是**手写第二份**"什么算差异"（`missing+mismatched+unexpected+expectation_failures>0`）
  //   ⇒ ★ 与 `hasDiff` **同一判据住两处**（本仓头号病），而且它**不会知道**新加的 `retire`。
  //   ⇒ 改成就地复用 `hasDiff`：判据一处，`retire` 自动算进来。
  const nDiff = files.filter(hasDiff).length;

  const lines = [
    `══ 差异块 scope ${formatScope(sc.scope)} ══`,
    '',
    `  范围内文件 ${sel.length} 个 · **有差异 ${nDiff} 个** · 无差异 ${d.clean_files.length} 个 · 产出块 ${d.blocks.length} 个`,
  ];
  if (d.blocks.length) {
    lines.push('', '  块（★ 块名稳定 ⇒ 可直接当"分区域重写"的工作单元）：');
    for (const b of d.blocks) {
      const { missing, mismatched, unexpected, expectation_failures, retire_files } = b.counts;
      const total = missing + mismatched + unexpected + expectation_failures + retire_files;
      lines.push(`    [${b.region}]  差异 ${total} 条 · ${b.files.length} 个文件`);
      // ★ 分类只说**非零**的（免得一行里挂一串 0）；★ 明写"人写的验收"——那是设计最该被兑现的部分
      const parts: string[] = [];
      if (expectation_failures) parts.push(`**人写的验收 ${expectation_failures}**`);
      if (missing) parts.push(`缺实现 ${missing}`);
      if (mismatched) parts.push(`签名不符 ${mismatched}`);
      if (unexpected) parts.push(`代码新增 ${unexpected}`);
      // ★ T187：退役是**另一根轴**，单列 —— 并进上面任一项都会把读者引向错的方向
      //   （"该归档"被读成"契约没实现" ⇒ 去改代码，而那正是**反的**）。
      if (retire_files) parts.push(`**待退役 ${retire_files}**（设计说该删/该归档 ⇒ 走 archive，别去改实现）`);
      lines.push(`        （${parts.join(' / ')}）`);
      for (const f of b.files) lines.push(`        ${f}`);
    }
  }
  // ★★ 2026-10-10：`scopeNoComparison` 时**不说「已对齐」** —— 那是"没比就报好"的 scope 版。
  if (d.clean_files.length && !scopeNoComparison) {
    lines.push('', `  范围内已对齐（无差异）：${d.clean_files.join(', ')}`);
  } else if (d.clean_files.length) {
    lines.push('', `  范围内**无差异可报**的文件：${d.clean_files.join(', ')}（★ 见下：本 scope **没得比**，不是"已核对"）`);
  }
  const allNotes = [...sc.notes, ...d.notes];
  if (scopeNoComparison) {
    allNotes.push(
      `★★ **本 scope 没得比**：范围内"可比条目"共 **0 条**（\`expected_apis\` 与验收都没有命中）⇒ **线 2 实际比对了 0 条**；` +
        `上面「无差异」**不是"已核对"**、更**不能**读成"这片没问题" ⇒ **给不出结论**。` +
        `★ 出路：给这些文件写 \`expected_apis\`（\`import_project\` 或 \`edit_dsl\`）后再圈这片范围。`,
    );
  }
  if (notChecked.length) allNotes.push(`scope 命中但对账结果里没有（可能不在语义层）：${notChecked.join(', ')}`);
  // ★ T78：两类"不进块但必须说出来"的东西（**不许静默**）
  if (outsideScope.length) {
    allNotes.push(
      `**${outsideScope.length} 条验收失败的主体不在本 scope 内**（所以没进块）：${outsideScope.join('；')} —— ` +
        `要么把 scope 放宽到含它，要么这批差异归别的区域。`,
    );
  }
  if (unsupportedInScope) {
    allNotes.push(
      `另有 **${unsupportedInScope} 条判不了（unsupported）**，**没进块** —— ★ 它们**不是"要改的"、也不是"通过"**：` +
        `判不了多半是索引与源码不一致 ⇒ 跑一次 \`import_project\`（默认只刷新实际、不碰设计）保鲜后再对拍。`,
    );
  }
  if (unsupportedOutside) {
    allNotes.push(
      `另有 **${unsupportedOutside} 条判不了、且主体在本 scope 外** —— 这批**既没进块、也没在上面报过**，` +
        `★ 单列出来免得被当成"范围内没问题"。`,
    );
  }
  if (allNotes.length) {
    lines.push('', '  ★ 说明（**不许静默**）：');
    for (const n of allNotes) lines.push(`    · ${n}`);
  }
  lines.push(
    '',
    '  ★ 块的排序键只由稳定量构成（差异总数 ↓，同数按区域名字典序）⇒ 无关改动不会让块乱跳。',
    '  ★ 本工具**仍不改退出码**（差异再多也 exit 0）—— 它是**报告**；要"会红"是 T74（验收执行）的事。',
  );
  // ★★★ 2026-10-09（T81 续）：**让"对拍"也能交出对象** —— 它交的是「**要我关注的文件**」。
  //   为什么这里是**差异面**而不是"作用面"：对拍这个动作的产出**本来就是**「哪些文件不对」
  //   （「把**不对的范围**自动圈出来」正是指它）。而 `get_dsl query=scope` 交的是"作用面"
  //   ★ 来源枚举与口径见 `domain/b_terms.ts` 的 `scope_files.meaning`（**唯一住处**）—— 本处不再复述。
  //   ★ 口径照旧：**没差异 ⇒ 省略整个键**（不给空数组 —— 空数组会被读成"真的没有文件"）。
  const diffFiles = [...new Set(d.blocks.flatMap((b) => b.files))].sort();
  const touched: Record<string, unknown> = { feature };
  if (diffFiles.length) touched.scope_files = diffFiles;
  return {
    message: lines.join('\n'),
    data: {
      scope: sc,
      blocks: d.blocks,
      clean_files: d.clean_files,
      notes: allNotes,
      summary: r.summary,
      // ★ T85/D3：线 1 进机器通道（同早返回那条的说明）
      baselineDrift: r.baselineDrift,
      // ★★★ T184：三步流的② 也进机器通道 —— ★ **两条 return 都要带**（给 `scope` / 不给 `scope`）。
      //   ★ 只给一条 = **判据分叉**：调用方"能不能拿到待删清单"取决于它有没有传 `scope`
      //     —— 那与本轴（该不该删）毫无关系。
      retireFlow: r.retireFlow,
      touched,
      ...(exp
        ? { expectation_results: { checked: exp.checked, passed: exp.passed, failed: exp.failed, unsupported: exp.unsupported, items: exp.items, notes: exp.notes, conflicts: exp.conflicts } }
        : expNotes.length
          ? { expectation_results: { checked: 0, passed: 0, failed: 0, unsupported: 0, items: [], notes: expNotes, conflicts: [] } }
          : {}),
    },
  };
});

/**
 * 「验收执行」那一节的人话渲染（★ **唯一一处** —— 不许在两个 return 里各拼一遍，
 * 那正是本仓最忌的"同一格式住两处"）。返回空串 = 这一 feature 没有任何 expectations 相关的事。
 */
function renderExpectationsSection(
  // ★ 判定器是 async ⇒ 这里要 `Awaited<>`（否则拿到的是 Promise）
  exp: Awaited<ReturnType<typeof judgeExpectations>> | null,
  notes: readonly string[],
): string {
  if (!exp && !notes.length) return '';
  const L: string[] = ['', '── 验收执行（决策卡上的 expectations）──'];
  if (exp) {
    L.push(
      `  检查项 ${exp.checked} 条 · **通过 ${exp.passed}** · **不满足 ${exp.failed}** · **判不了 ${exp.unsupported}**`,
    );
    for (const it of exp.items) {
      const mark = it.verdict === 'pass' ? '✅' : it.verdict === 'fail' ? '❌' : '⚠';
      L.push(`    ${mark} [${it.node_id}] ${describeExpectation(it.expectation)}`);
      L.push(`        ${it.detail}`);
    }
    for (const n of exp.notes) L.push(`  ★ ${n}`);
  }
  for (const n of notes) L.push(`  ★ ${n}`);
  L.push(
    '  ★ 本工具**默认不改退出码**（上面"不满足"再多也 exit 0）；要它阻断请传 `fail_on_violation=true`' +
      '（★ 只对**不满足**阻断，`判不了` 不计入 —— 否则 Go/Python 上就没法用了）。',
  );
  return L.join('\n');
}

/** detect_drift：活文档↔代码漂移检测（代码变更 → 提示 DSL 过时/欠实现），持久化台账
 * ★★ 2026-10-10：**让 `DriftData` 真的进机器通道**。此前本 handler 直接 `return detectDrift(...)`
 *   —— 产物顶层只有 `message` + `touched`、**没有 `data` 键** ⇒ `wrapData` 的 `machinePayload`
 *   只回 `{touched}`，把 `status`/`summary`/`suggestions` **在出口静默丢光**。
 *   ⇒ 实测：`---DATA---` 里**读不到 `status`**，三态（没得比/一致/漂移）**无法机读区分**。
 *   ★ 处置：拆出 `data`（= DriftData + `touched`），与 `consistency_check` 同一形状（`{message, data}`）。
 *   ★ `message` **不进 data** —— 它已在正文里，塞进去只是逐字重复（同 import_project 的口径）。 */
export const detectDriftHandler = wrapData(async (a) => {
  const r = await detectDrift({
    feature: a.feature as string,
    code_dir: a.code_dir as string | undefined,
    scope: a.scope as 'changed' | 'all' | undefined,
    since_ref: a.since_ref as string | undefined,
    mode: a.mode as 'check' | 'status' | undefined,
  });
  const { message, ...data } = r;
  return { message, data };
});

/** edit_dsl：统一写操作（复用 updateFeature，Step A 扩展后覆盖更多写动作）
 * ★ 刻意保留 `wrap`（2026-09-29 逐处复核）：[B] 一路到 [C] 的结果类型 `EditResult`
 *   （`src/tools/edit_result.ts`）**结构上只有 `{ message, feature }`，没有 `data` 字段**——
 *   `dispatchDslEdit` 的两条路径（daemon / 本地 updateFeature）都只造这两个键
 *   ⇒ 这里没有任何结构化产物被通道丢掉，`wrap` 是**对的那一个**，不换。
 *   （若将 [B] 补出 `data`，本处再随之升级；那是动 [B] 的契约，不在本笔范围。） */
export const editDslHandler = wrap(async (a) => {
  // 视图写护栏：live 是代码快照，只能由 import/watch 重建，禁止手改
  if (a.view === 'live') {
    throw new Error(
      '实际视图（view=live）是代码快照，只读，请勿手改。要改请用 view=design（设计视图）；' +
        '要重建实际视图请用 import_project 工具（全量导入），增量监听用 explore_code action=watch。',
    );
  }
  // 活文档：变更原因校验（L1-L4）。weight=routine → 轻量写路径（level=3，仍有 L1/L2/L3，
  // 跳过 L4 证据回溯），给日常维护放行；默认 normal → 全链强闸。
  const reason = (a.reason as string | undefined) ?? '';
  const evidence = (a.evidence as ReasonEvidenceRef[] | undefined) ?? [];
  const level = a.weight === 'routine' ? 3 : 4;
  const dsl = getDSLByView(a.feature as string, 'design');
  const entityIds: string[] = [];
  if (dsl) {
    for (const n of dsl.geometry?.nodes ?? []) entityIds.push(n.id);
    for (const e of dsl.geometry?.edges ?? []) entityIds.push(e.id);
    for (const f of dsl.semantic?.files ?? []) {
      if (f.id) entityIds.push(f.id);
      if (f.path) entityIds.push(f.path);
    }
  }
  // ── ★★ T20 第 (4) 步（2026-10-05）：写「代码是什么」的断言前，必须**现取**该文件的事实 ──
  //   为什么：DSL 里的 `actual_apis` / `actual_deps` 镜像**已移除**（事实权威只剩 `cache.db`）
  //   ⇒ 那改 `semantic.files`（`path` / `responsibility` / `expected_apis`）就是在**写"代码是什么"的断言**
  //     ⇒ 必须先去读权威（`fileFacts`）；否则就是**凭想象写设计**（用户 2026-10-01：「编辑时强制读双编」）。
  //   触发面（**只有这两类**；逐条核过 `update_feature.ts` 的 `switch (op.type)`）：
  //     · `type=file`（增/改/删文件条目）· `type=api`（改 `file.expected_apis`）
  //   免触发（**逐条说清"为什么它不算"**）：`type=status` / `binding`（**流程态**，不断言代码）、
  //     `type=snapshot op=rollback`（**整份恢复**，没有"目标文件"可归因）、
  //     node / edge / annotation / approval / layout / simulation（本就不碰 `semantic.files`）。
  //   ★ 不兜底：DSL **有** `source_root`（= 有代码权威可读）却取不到事实 ⇒ **响亮抛**；
  //     DSL **没有** `source_root`（纯设计 / 新建 feature，代码侧还不存在）⇒ 这条**不适用**（没有权威可读）。
  //   ★ 与 `weight` 无关：routine 可以跳 L4 的"为什么改"回溯，但**跳不过**"改文件断言前先现取"。
  const FILE_ASSERT_OPS = new Set(['file', 'api']);
  const ops =
    (a.operations as Array<{ op?: string; type?: string; id?: string; data?: Record<string, unknown> }> | undefined) ??
    [];
  const sourceRoot = dsl?.source_root;
  const normRef = (s: string): string => s.replace(/\\/g, '/').replace(/^\.\//, '');
  /** ★「现取」= 真的从 `cache.db` 把这个文件的事实取到了（`matched_path` 非空） */
  const factsOf = (rel: string) => fileFacts(String(sourceRoot), rel, a.feature as string | undefined);
  const targetFiles: string[] = [];
  for (const op of ops) {
    if (!FILE_ASSERT_OPS.has(String(op.type ?? ''))) continue;
    /**
     * ★★ 2026-10-19：**`delete` 不需要"现状"**，不参与本闸。
     *
     * 三类 op 断言的东西不同：
     *   `add`    断言「它**该**存在」 ⇒ 依据 = 新建意图（见下面 `notIndexed`）
     *   `update` 断言「它的职责/API 是**什么**」 ⇒ 依据 = **必须看现状**
     *   `delete` 断言「它**不该**存在」 ⇒ **不需要看现状**（删一个从未索引的路径本来就是幂等的）
     * ★ 实测踩到：清理一个从未入库的探针节点时，本闸把 `delete` 也拦了，
     *   只能编一条 evidence 才过得去 —— 那是**为流程服务的假证据**。
     */
    if (String(op.op ?? '') === 'delete') continue;
    const byId = op.id ? dsl?.semantic?.files?.find((f) => f.id === op.id)?.path : undefined;
    const byData = typeof op.data?.['path'] === 'string' ? String(op.data['path']) : undefined;
    const p = byId ?? byData;
    if (p && !targetFiles.includes(p)) targetFiles.push(p);
  }
  /**
   * ★★★ 2026-10-19（T20 正式化）：**新建文件的依据 = 同一批里声明的 file-exists 期望**。
   *
   * 上午那版只是「库里没有 + 已声明 ⇒ 放行 + 回执点名」—— 那不叫依据，叫**豁免**。
   * 真正的依据是：你在**建它的那一刻**就写下了「它应该存在」这条期望。
   * ⇒ 要求：本批 node.add 的 data.decision.expectations 里有一条 file-exists 指向该路径。
   * ★ 为什么要求「同一批」：node.add 的 data 可以直接带 decision；若分成两批
   *   （先 node 后 decision），T20 跑的时候 DSL 里还没有那个节点 ⇒ 查不到期望。
   */
  const declaredNew = new Set<string>();
  for (const op of ops) {
    if (String(op.type ?? "") !== "node" || String(op.op ?? "") !== "add") continue;
    const np = typeof op.data?.["path"] === "string" ? normRef(String(op.data["path"])) : "";
    const exps = (op.data?.["decision"] as { expectations?: Array<{ kind?: string; path?: string }> } | undefined)?.expectations;
    if (!np || !Array.isArray(exps)) continue;
    if (exps.some((e) => e.kind === "file-exists" && normRef(String(e.path ?? "")) === np)) declaredNew.add(np);
  }
  /**
   * ★ 2026-10-19：`cache.db` 里**不存在**、但已在 `evidence` 声明的路径（= 新建文件）。
   * 放行，但记下来——回执必须点名（放行不是静默）。
   */
  const notIndexed: string[] = [];
  if (sourceRoot && targetFiles.length > 0) {
    const misses = targetFiles.filter((p) => {
      const seen = factsOf(p).matched_path !== null; // 现取到事实
      const claimed = evidence.some((ev) => normRef(String(ev.ref)) === normRef(p)); // 在 evidence 里声明
      /**
       * ★★★ 2026-10-19：**新建文件没有现状可读**。
       *
       * 根因：本闸把「库里有该文件」这个**充分条件**当成了**必要条件** ——
       *   「有该文件 ⇒ 有依据」成立；「有依据 ⇒ 有该文件」**不成立**
       *   （新建时依据是**期望**，而库里必然没有该文件）。
       * ⇒ 于是一个本该在实现**之前**发生的动作（设计一个新文件），被要求"文件先存在"，
       *   逼得人先造空壳文件骗过闸 —— **那是仪式，不是纪律**（2026-10-19 实测踩到）。
       *
       * ⇒ 处置：`库里没有 + 已声明` ⇒ **放行**（不是未知，是新建），并记进 `notIndexed`；
       *   回执里点名「已按【新建】处理」。★ 底线不放宽：**没声明的照样拒**，
       *   **改已有文件不读现状的照样拒**。
       */
      if (!seen && claimed && declaredNew.has(normRef(p))) {
        notIndexed.push(p);
        return false;
      }
      return !seen || !claimed;
    });
    if (misses.length > 0) {
      throw new Error(
        `改 semantic.files 前必须**现取**该文件的事实（T20 第 (4) 步）：${misses.join(' / ')} 缺「现取到事实 + 在 evidence 里声明」。` +
          `怎么做：先读它的事实（get_dsl(query:'file', file_id:…) 或 fileFacts(root, '${misses[0]}')），` +
          `再把该文件的**仓库相对路径**作为 evidence 的一条 ref 传进来（例：evidence=[{type:'node', ref:'${misses[0]}'}]）。` +
          `★ 为什么：DSL 已不存事实镜像（actual_apis / actual_deps 已移除）⇒ 事实只能**现取**。` +
          `\n★ 如果它是【新建】的：必须在**同一批** node.add 的 data.decision.expectations 里` +
          `带一条 { kind:"file-exists", path:"${misses[0]}" } —— 那是「它应该存在」的**依据**（不是豁免）。`,
      );
    }
  }

  // L4 证据回溯：源 = **observe 线真实录制的事件**（JSONL，`observe_instrument` 的探针落盘，
  // 候选项与 `observe_trace` 同源）。★ 2026-10-01：原先读 `<live_dir>/<feature>.trace.json`，
  // 而那份文件全仓只有一个产者 —— 已被撤掉的 `tools/trace_reasoning.ts`（零接触自动插桩），
  // 且它写的 token 是"行数"这个合成代理值。改读事件后，验的是**真实测量**（dur_ms），代价是
  // 证据不再与 feature 绑定（事件是会话级的）。
  // 没有录制事件 → 无法回溯 → evidence 一律打回（宁缺毋滥，杜绝编造证据进库）。
  // routine 轻量路径跳过此步（level=3，不加载事件）。
  let traceResolver:
    | { exists?: (ev: ReasonEvidenceRef) => boolean; traceRefs?: string[] }
    | undefined;
  if (level >= 4) {
    const { records } = loadObservedTraceRecords();
    traceResolver = records.length > 0 ? buildTraceResolver(records) : undefined;
  }
  /**
   * ★ 2026-10-05（T20 第 (4) 步）：`exists` **扩成两类可回溯证据** ——
   *   ① 运行事件（`trace`，既有）；② **仓库文件的事实**（新增：`ref` 归一后能被 `fileFacts` **现取**到）。
   *   ★ 为什么必须一起扩：否则调用方为满足上面那条前置而传的**文件证据**会被 L4 打回（`exists` 只认 `trace`），
   *     而且"有 evidence 却无 resolver"那条分支在**无录制事件**时会**误伤整个调用**。
   *   ★ 边界（只影响什么）：仅使 L4 **多接受一类可回溯证据** —— 既有判据一条不放宽、一条不删。
   */
  /**
   * ★★★ 2026-10-09（T88 下半）：**「证据」= 真实存在的实体** —— 而 **DSL 里的节点就是实体**。
   *
   * ## 为什么加这一条
   * ★ 规则：每一次改动**都必须有原因** —— 要么当场写一段，要么**挂一篇文档**。
   * ⇒ 「**挂一篇文档当理由**」的落点就在这儿：`evidence: [{type:'node', ref:'doc_docs_xxx_md'}]`。
   * ★ 而在加它之前，`existsFn` **只按"文件路径查索引事实"** ⇒ **节点 id 一律查不到** ⇒
   *   **L4（证据可回溯）会把文档引用打回** ⇒ **"挂文档"这条路走不通**（只能现场写一段话）。
   *
   * ## 语义（为什么这是对的，不是放宽）
   * ★ **文档节点是 DSL 里真实存在的实体**（T88 上半把它收成了 `type:'doc'`）⇒
   *   引用它**和引用一个文件路径一样可回溯**（甚至可以更硬：节点存在与否是**当场可查**的）。
   * ★ 而它**不等于**"文档参与对拍" —— ★ **对拍的两边只能是「设计 DSL」与「实际 DSL」**；
   *   文档的角色是**改动理由的挂点**。
   * ★ 反例仍在：`ref` 指向**不存在的**节点 ⇒ `nodeIds` 里没有 ⇒ **照旧打回** ✓（闸没放宽）。
   */
  const nodeIds = new Set(((dsl?.geometry?.nodes ?? []) as Array<{ id: string }>).map((n) => n.id));
  const existsFn = (ev: ReasonEvidenceRef): boolean =>
    nodeIds.has(String(ev.ref)) ||
    /**
     * ★★★ 2026-10-19：**本批已被 T20 判为「新建」的路径，也算可回溯证据**。
     *
     * 不加这条会怎样（实测）：新建文件的 evidence 被 L4 打回 ——
     * *「evidence 无法回溯：node "…/x.ts" 不存在或对不上」* ⇒ **T20 和 L4 是同一道墙的两段**。
     * 两条闸的隐含假设都是"文件必须已存在"，而新建文件恰恰不存在。
     * ⇒ 这里**不重新判一次**，直接吃 T20 已经判出的结论（`notIndexed`）——
     *   一处判断、两处消费，避免两个口径分叉。
     */
    notIndexed.includes(normRef(String(ev.ref))) ||
    (traceResolver?.exists?.(ev) ?? false) ||
    (sourceRoot ? factsOf(normRef(String(ev.ref))).matched_path !== null : false);
  const v = validateReason({
    reason,
    evidence,
    level,
    resolver: {
      entityIds,
      exists: existsFn,
      traceRefs: traceResolver?.traceRefs,
    },
  });
  if (!v.ok) {
    throw new Error(`变更原因校验未通过（L${v.layer}）：${v.error}`);
  }
  // 写收敛（方向 E）：daemon 可用则转发单写者队列执行（乐观锁 + 读改写互斥），
  // 否则本地 updateFeature（现状降级）。冲突时抛错，LLM 据此 rebase，绝不静默覆盖。
  const { result } = await dispatchDslEdit(a as unknown as Record<string, unknown>, (input) => updateFeature(input as never));
  if (notIndexed.length === 0) return result;
  // ★ 放行必须**说出来**：这些路径在 cache.db 里不存在，本闸按【新建】放行 ——
  //   但"没读过现状"这件事要说清，否则就是静默绕过。
  return {
    ...result,
    message:
      `⚠ 以下路径在 \`cache.db\` 里**不存在**，本次已按【新建】处理（T20 的"现取事实"对它们不适用）：\n` +
      notIndexed.map((p) => `  · ${p}`).join('\n') +
      '\n★ 这不代表"读过现状" —— 新建文件没有现状可读。请确认它们确实是要新建的（而不是路径写错）。\n\n' +
      result.message,
  };
});

// ─────────────────────────────────────────────────────────────
// 8 个主工具 handler
// ─────────────────────────────────────────────────────────────

/** get_dsl：只读查询（复用 queryFeature）。
 * ★ 用 wrapData：queryFeature 返回 `{ message, data? }` —— data 是查询的结构化产物
 *   （dsl / nodes / edges / files / functions …），wrap 会在通道层静默丢弃它。 */
export const getDslHandler = wrapData(async (a) => queryFeature(a as never));


/** render_design：渲染思维导图/HTML/SVG/Markdown（format 参数聚合导出；view 决定渲染设计或实际视图）
 * ★ 刻意保留 `wrap`（2026-09-29 逐处复核）：把四个分支的 [B] 结果逐字段拆开看过后，
 *   **换成 `wrapData` 的净收益为零，代价是回执被淹**：
 *     · 非重复字段 = 产物路径（`htmlFile` / `file` / `jsonFile`）+ `feature`
 *       —— 这些**已逐字出现在 message 里**（`已渲染：<path>` / `已导出 SVG：<path>` /
 *       `L3 结构骨架已生成：<jsonFile>`）⇒ 放进 `---DATA---` 只是第二遍；
 *     · [B] 的四个结果类型都**自带 `message` 字段**（与回执同一份文本）⇒ `data: r` 会逐字重复；
 *     · 唯一不冗余的字段是 `mind_map`（整棵树）—— 它是**超大对象**（节点数随项目规模线性增长），
 *       且 `deriveMindMap` 已经把它**落盘到 message 给出的 `jsonFile`**（agent 可按路径读）
 *       ⇒ 直接塞进回执是"淹掉回执"，正是 §2d 说的那种"为了好看而加的东西"。
 *   ⇒ 保留 `wrap`；**这不是漏迁，是逐字段算过后的判定**（不刷假账）。 */
export const renderDesignHandler = wrap(async (a) => {
  // 默认 mindmap：现行思维导图架构（root → 目录分组 → 文件）。
  // ★ 2026-09-30：原 `format=html`（自包含单文件设计画布·星图）**已删除** ——
  //   它是 lane 自己标注"仅调试用"的旧路径、渲染效果差；前端（dsl-workbench）自取数据渲染。
  //   详见 `lanes/design.ts` 的 tool description 与台账 §44.9。
  const format = typeof a.format === 'string' ? a.format : 'mindmap';
  const feature = a.feature as string;
  const output_path = typeof a.output_path === 'string' ? a.output_path : undefined;
  if (format === 'mindmap') {
    if (!feature) throw new Error('render_design mindmap 模式需要 feature（从存储读取设计 DSL 派生）');
    const r = await deriveMindMap({ feature, gen_descriptions: false });
    // 空导图：DSL 无 semantic.files 时导图就是空的。
    // ★ 原先这里会「降级渲染设计画布」把产物凑出来；那条路径已随自包含 HTML 一起删除
    //   ⇒ 改为**如实报告为空 + 给补数据的方向**。§2d：失败就说失败，不假装有产物。
    if ((r.mind_map.root.children ?? []).length === 0) {
      return {
        message:
          `⚠ 思维导图为空：DSL 的 semantic.files 还没有内容。\n${r.message}\n` +
          `提示：先 import_project 或 edit_dsl 补充 semantic.files 后再派生思维导图。`,
      };
    }
    // ★ 2026-10-13：这里原写「交互版：http://localhost:3000/mindmap/<feature>」——
    //   **那个路由已不存在**（随 2026-09-30 撤自包含前端一起没了，实测 404）。
    //   工具回执点名一个 404 的出口 = 把调用方直接引到坑里 ⇒ 如实改成"本仓不提供页面"。
    return {
      message:
        r.message +
        `\n★ 交互渲染：本仓**不提供页面** —— /mindmap/<feature> 已随旧自包含前端一并撤除（2026-09-30，实测 404）；` +
        `本仓 serve 只做数据/API 引擎，可视化由**独立前端仓库 dsl-workbench** 承担（它按上面的路径自取 JSON 渲染）。`,
    };
  }
  if (format === 'svg') {
    const r = exportSvg({ feature, output_path });
    return { message: r.message };
  }
  if (format === 'markdown') {
    const r = exportMarkdown({ feature, output_path });
    return { message: r.message };
  }
  // ★ 到不了这里：`format` 已被 lane 的 zod 枚举约束在 mindmap|svg|markdown 内。
  //   仍**显式抛错**而不是静默返回 —— 不写兜底（§3），真越界要响。
  throw new Error(`render_design 不支持的 format：${String(format)}（只支持 mindmap / svg / markdown）`);
});


/**
 * ★★ 把「人写的验收」的**失败按主体路径归到文件上** —— **两条返回路径共用，只此一处**（2026-10-09，T81 续）。
 *
 * ★ 为什么必须共用：`consistency_check` 有**两条返回路径**（给 scope / 不给 scope），
 *   两条都要算「哪些文件**要我关注**」⇒ 各写一遍就是本仓头号病（**同一判据住两处**）。
 *   ★ 我最初只改了给 scope 的那一条 ⇒ 实测发现**默认那条根本没产 `touched`**（且 DATA 里也没有 `blocks`）。
 * ★ 归属规则**只由 `domain/expectation.ts` 的 `expectationSubjectPath` 决定**（不在这里再推一遍）。
 * ★ `inScope` 为 `() => true` 时（全量那条路径）`outsideScope` / `unsupportedOutside` 恒空 —— 语义正确：没有"范围外"。
 */
function groupExpectationFails(
  items: readonly { verdict: string; expectation: Parameters<typeof expectationSubjectPath>[0] }[],
  inScope: (p: string) => boolean,
): { failByPath: Map<string, number>; outsideScope: string[]; unsupportedInScope: number; unsupportedOutside: number } {
  const failByPath = new Map<string, number>();
  const outsideScope: string[] = [];
  let unsupportedInScope = 0;
  let unsupportedOutside = 0;
  for (const it of items) {
    if (it.verdict === 'pass') continue;
    const subj = expectationSubjectPath(it.expectation);
    if (!inScope(subj)) {
      if (it.verdict === 'fail') outsideScope.push(expectationPaths(it.expectation).join(' → '));
      else unsupportedOutside++;
      continue;
    }
    if (it.verdict === 'fail') failByPath.set(subj, (failByPath.get(subj) ?? 0) + 1);
    else unsupportedInScope++;
  }
  return { failByPath, outsideScope, unsupportedInScope, unsupportedOutside };
}

/**
 * ★★★ 设计图（`design/<f>.dsl.json`，**手写**）vs 实际（`live/<f>.dsl.json`，**扫描**）的
 * **只读对拍入口**（2026-10-15）—— 「给设计那一侧一份独立的住处」的第 2 件。
 *
 * ## 读三份（**全是读**）
 *   ① `design/<f>.dsl.json` —— 手写设计图（★ 与 live 同 schema；`storage.ts#getDesignSheet`）
 *   ② `live/<f>.dsl.json`  —— 扫描产物（`getLiveFeatureResolved`，走候选链，与 diff_views 同款）
 *   ③ 现设计视图          —— `features/<f>.json`（= 扫描 ⊕ overlay 的合并结果，`getDSLByView(…,'design')`）
 *      ★ 第 ③ 份**只作上下文**（"这个『要实现』的点是否已记进现设计视图"），**不参与**三类差异的配对 ——
 *        配对永远是 ①②**两份同性质 DSL 按指代对齐**（★ 已实现的用扫描给的 `id`、**未实现的用名字/路径**，
 *        身份规则口径唯一住在 `domain/design_sheet.ts#designSheetRef`，本入口不改）。
 *
 * ## 输出四类差异（判据住在 `domain/design_sheet.ts`，此处只渲染 + 报账）
 *   · **指代相同但属性差** —— 两边都有、至少一个属性不同（逐字段给两边原值）
 *   · ★★ **已认亲 ⇒ 赋予同一个 ID** —— 设计侧**无 id** 的条目（如 `meta.goals` 里 `description:"…/thing.ts"`）
 *     按**路径/名字**在 live 里认出**已存在**的节点 ⇒ 带出它认到的 live `id`，**不再计入「要实现」**
 *     （= "要实现"**自己收口**：东西做好了它就不再挂着；认不到 ⇒ 仍留在下一类）
 *   · **只在设计里 ⇒ 「要实现」** ★ 这正是"挪建筑"出来的任务（列**指代**：id 或 名字/路径）
 *   · **只在 live 里 ⇒ 「未纳入设计」**（提示，未必是错）
 *
 * ## ★ 只读、不落盘（不许新增缓存/存储）
 *   三份都只 `readFileSync`；本入口**不写任何文件**、不碰 overlay、不碰 `edit_dsl` 的既有行为。
 *   ⇒ 它是 `diff_views`（三方：baseline/design/live，文件语义级）的**姊妹入口**，但配对不同：
 *     本入口配的是「**手写设计图** vs 扫描」，而不是「现设计视图（寄生在扫描上）vs 扫描」。
 */
export const diffDesignSheetHandler = wrapData(async (a) => {
  const feature = requireStr(a, 'feature');
  const liveDir = typeof a.live_dir === 'string' && a.live_dir ? a.live_dir : undefined;

  const designSheet = getDesignSheet(feature, liveDir);
  if (!designSheet) {
    throw new Error(
      `没有设计图：${getDesignSheetFile(feature, liveDir)} 不存在。\n` +
        `★ 本入口只读**已存在**的手写设计图 —— 先写一份 \`design/${feature}.dsl.json\`（schema 与 live/<f>.dsl.json 相同）再对拍。`,
    );
  }
  const live = getLiveFeatureResolved(feature, liveDir);
  if (!live) {
    throw new Error(`没有实际快照：live/${feature}.dsl.json 不存在（先 import_project 生成"实际"，或传 live_dir）。`);
  }

  const d = diffDesignSheet(designSheet, live);

  // ③ 现设计视图（**只作上下文**，不参与配对）
  const currentDesign = getDSLByView(feature, 'design');
  const currentIds = new Set((currentDesign?.geometry?.nodes ?? []).map((n) => n.id));
  // ★ 未实现的"要实现"点是**名字/路径**指代 ⇒ 上下文比对也要按同一口径（`designSheetRef`）取现设计视图的指代，
  //   否则一个已经在现设计视图里的路径点会被误报成"还没有"（判据不在此处，但**不许给错标签**）
  const currentRefs = new Set((currentDesign?.geometry?.nodes ?? []).map((n) => designSheetRef(n)));
  const designOnlyAlreadyInCurrent = d.design_only.filter((ref) => currentIds.has(ref) || currentRefs.has(ref));

  const lines: string[] = [
    `设计图 vs 实际 · 只读对拍（feature "${feature}"）`,
    `· ① 设计图（手写）: ${getDesignSheetFile(feature, liveDir)}`,
    `· ② 实际（扫描）  : live/${feature}.dsl.json`,
    `· ③ 现设计视图   : ${currentDesign ? `${currentIds.size} 节点（= 扫描 ⊕ overlay，仅作上下文）` : '**不存在**'}`,
    diffDesignSheetLine(d),
  ];
  if (d.same_id.length) {
    lines.push(`\n══ 同名属性差（${d.same_id.length} 个节点）══`);
    for (const s of d.same_id) {
      lines.push(`· ${s.id}`);
      for (const at of s.attrs) {
        lines.push(`    ${at.key}: 设计=${JSON.stringify(at.design)} · live=${JSON.stringify(at.live)}`);
      }
    }
  }
  if (d.resolved.length) {
    lines.push(`\n══ 已认亲 ⇒ **赋予同一个 ID**（${d.resolved.length}）══`);
    for (const r of d.resolved) {
      const by = r.matched_by === 'path' ? '路径' : '名字';
      lines.push(`· ${r.ref} ⇒ live id = ${r.id}（按${by}认亲；★ 不再计入「要实现」）`);
    }
  }
  if (d.design_only.length) {
    lines.push(`\n══ 只在设计里 ⇒ **要实现**（${d.design_only.length}）══`);
    for (const id of d.design_only) {
      const inCur = currentIds.has(id) || currentRefs.has(id) ? '（★ 现设计视图里已有它）' : '（★ 现设计视图里还没有）';
      lines.push(`· ${id} ${inCur}`);
    }
  }
  if (d.live_only.length) {
    lines.push(`\n══ 只在 live 里 ⇒ **未纳入设计**（${d.live_only.length}）══`);
    for (const id of d.live_only) lines.push(`· ${id}`);
  }

  return {
    message: lines.join('\n'),
    data: {
      feature,
      diff: d,
      current_design_view: {
        exists: !!currentDesign,
        nodes: currentIds.size,
        design_only_already_in_current: designOnlyAlreadyInCurrent,
      },
    },
  };
});