/**
 * design 线的工具入参适配层（handler）—— ★ 2026-10-05 从 `application/handlers.ts` 按线拆出。
 *
 * 为什么要拆：原来 15 个 handler 挤在一个跨 5 条线的文件里，而 5 个 lane 的 `index.ts` 都 import 它
 * ⇒ `application/` 与每个 lane **互为消费方**（目录级环：文件级无环，所以 code_health 报 0 是对的，
 *   但**目录**才是人导航的单位）。拆开后每条线自足：给这条线加工具只动这条线内的文件。
 *
 * 本文件由 `edit_code`（AST 取边界）从原文件逐符号搬入，**不是手抄**；tsc 是闸门。
 */

import { wrap, wrapData } from '.././plumbing.js';
import { dispatchDslEdit } from '.././dispatch.js';
import { getDSLByView, getLiveDir, requireProjectRoot } from '../../infrastructure/storage.js';
import { checkConsistency } from '.././design/intent/consistency.js';
import { deriveMindMap } from '.././meta/view/derive_mind_map.js';
import { detectDrift } from '.././design/intent/detect_drift.js';
import { exportMarkdown, exportSvg } from '../../infrastructure/render/export.js';
import { manageFeature } from '.././design/lifecycle/manage_feature.js';
import { queryFeature } from '.././meta/explore/query_feature.js';
import { fileFacts } from '../../infrastructure/index/file_facts.js';
import { validateReason } from '.././observe/reconcile/reason_validator.js';
import type { ReasonEvidenceRef } from '.././observe/reconcile/reason_validator.js';
import { buildTraceResolver, loadObservedTraceRecords } from '.././observe/capture/trace_evidence.js';
import { updateFeature } from '.././design/dsl_ops/update_feature.js';
// ★★ 2026-10-09（T73）：差异块 —— 把 per-file 差异折成"可重写的区域块"。
//   `scope.ts` 是"圈定范围"的**文法与解析唯一落点**；`diff_blocks.ts` 是"归块"的纯函数。
import { resolveScopeText, formatScope } from '../../domain/scope.js';
import { buildDiffBlocks, type FileDiff } from '../../domain/diff_blocks.js';
// ★★ 2026-10-09（T74）：验收执行 —— 类型/格式化在 domain，判定器在 application（domain 不许 import infrastructure）
import { collectExpectations, describeExpectation, expectationSubjectPath, expectationPaths } from '../../domain/expectation.js';
import { judgeExpectations } from './intent/expectations.js';

/** consistency_check：一致性。★ wrapData（2026-09-29）：[B] 回 `ConsistencyResult`
 *   = `{ message, fileResults[], invariantResults[], summary{totals…} }` ——
 *   逐文件 API 匹配明细 + 不变式结果 + **计数摘要**原被 `wrap` 丢掉（agent 无从机器判定"过没过"）。 */
export const consistencyHandler = wrapData(async (a) => {
  const r = await checkConsistency({
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
    };
    if (exp) data.expectation_results = { checked: exp.checked, passed: exp.passed, failed: exp.failed, unsupported: exp.unsupported, items: exp.items, notes: exp.notes };
    else if (expNotes.length) data.expectation_results = { checked: 0, passed: 0, failed: 0, unsupported: 0, items: [], notes: expNotes };
    return { message: expSection ? `${r.message}\n${expSection}` : r.message, data };
  }

  // ★ scope 分支要 DSL：没有就拿不到"哪一片" ⇒ 响亮报错（不静默退化成"全量"）
  if (!dsl) throw new Error(`feature "${feature}" 不存在（视图: design）⇒ 无法解析 scope`);
  const sc = resolveScopeText(dsl, scopeText);

  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const inScope = new Set(sc.paths);
  const sel = r.fileResults.filter((fr) => inScope.has(norm(fr.file.path)));
  // ★ 不许静默：scope 命中、但对账结果里没有的文件（例如不在语义层）要说出来
  const seen = new Set(sel.map((fr) => norm(fr.file.path)));
  const notChecked = sc.paths.filter((p) => !seen.has(p));

  // ★★★ 2026-10-09（T78）：**把"人写的验收"的失败并进同一份块**。
  //   为什么必须：块的输入原本只有 `expected_apis` 对账，而**设计 DSL 的结构是从扫描 fork 的**
  //   ⇒ 那一路对出来**永远干净** ⇒ **块永远是空的**，而"圈范围"正是用户要的那一步。
  //   实测（2026-10-09 真跑）：验收报 `failed 1`，块报"有差异 0 个"，还把出问题的文件列进"已对齐" —— 两者矛盾。
  //   ★ 归属规则**只由 `domain/expectation.ts` 的 `expectationSubjectPath` 决定**（不在这里再推一遍）。
  const failByPath = new Map<string, number>();
  const outsideScope: string[] = [];
  let unsupportedInScope = 0;
  let unsupportedOutside = 0;
  for (const it of exp?.items ?? []) {
    if (it.verdict === 'pass') continue;
    const subj = expectationSubjectPath(it.expectation);
    if (!inScope.has(subj)) {
      // ★ 不静默：主体**不在你框的范围里**——要说出来（否则你会以为"这片没问题"）
      // ★★ 2026-10-09 自查补：`unsupported` 走到这条分支时**也被踢掉了**（初版只收 `fail`）
      //    ⇒ 于是"索引旧 + 主体在范围外"会**完全不吭声** —— 正是我最想防的那种静默。
      if (it.verdict === 'fail') outsideScope.push(`${expectationPaths(it.expectation).join(' → ')}`);
      else unsupportedOutside++;
      continue;
    }
    if (it.verdict === 'fail') failByPath.set(subj, (failByPath.get(subj) ?? 0) + 1);
    else unsupportedInScope++;
  }
  const files: FileDiff[] = sel.map((fr) => {
    const p = norm(fr.file.path);
    return {
      path: p,
      arch_layer: fr.file.layer,
      missing: fr.apis.filter((x) => x.status === 'missing').length,
      mismatched: fr.apis.filter((x) => x.status === 'mismatched').length,
      unexpected: fr.apis.filter((x) => x.status === 'unexpected').length,
      expectation_failures: failByPath.get(p) ?? 0,
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
  // ★ scope 比 `arch_layer` 更窄时（files: / subtree: / nodes:），再按层切没有意义 ⇒ 整个 scope 作一块
  const narrower = sc.scope.kind === 'files' || sc.scope.kind === 'subtree' || sc.scope.kind === 'nodes';
  const d = buildDiffBlocks(files, sc.scope, narrower ? 'scope' : 'arch_layer');
  const nDiff = files.filter((f) => f.missing + f.mismatched + f.unexpected + (f.expectation_failures ?? 0) > 0).length;

  const lines = [
    `══ 差异块 scope ${formatScope(sc.scope)} ══`,
    '',
    `  范围内文件 ${sel.length} 个 · **有差异 ${nDiff} 个** · 无差异 ${d.clean_files.length} 个 · 产出块 ${d.blocks.length} 个`,
  ];
  if (d.blocks.length) {
    lines.push('', '  块（★ 块名稳定 ⇒ 可直接当"分区域重写"的工作单元）：');
    for (const b of d.blocks) {
      const { missing, mismatched, unexpected, expectation_failures } = b.counts;
      const total = missing + mismatched + unexpected + expectation_failures;
      lines.push(`    [${b.region}]  差异 ${total} 条 · ${b.files.length} 个文件`);
      // ★ 分类只说**非零**的（免得一行里挂一串 0）；★ 明写"人写的验收"——那是设计最该被兑现的部分
      const parts: string[] = [];
      if (expectation_failures) parts.push(`**人写的验收 ${expectation_failures}**`);
      if (missing) parts.push(`缺实现 ${missing}`);
      if (mismatched) parts.push(`签名不符 ${mismatched}`);
      if (unexpected) parts.push(`代码新增 ${unexpected}`);
      lines.push(`        （${parts.join(' / ')}）`);
      for (const f of b.files) lines.push(`        ${f}`);
    }
  }
  if (d.clean_files.length) lines.push('', `  范围内已对齐（无差异）：${d.clean_files.join(', ')}`);
  const allNotes = [...sc.notes, ...d.notes];
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
  return {
    message: lines.join('\n'),
    data: {
      scope: sc,
      blocks: d.blocks,
      clean_files: d.clean_files,
      notes: allNotes,
      summary: r.summary,
      ...(exp
        ? { expectation_results: { checked: exp.checked, passed: exp.passed, failed: exp.failed, unsupported: exp.unsupported, items: exp.items, notes: exp.notes } }
        : expNotes.length
          ? { expectation_results: { checked: 0, passed: 0, failed: 0, unsupported: 0, items: [], notes: expNotes } }
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

/** detect_drift：活文档↔代码漂移检测（代码变更 → 提示 DSL 过时/欠实现），持久化台账 */
export const detectDriftHandler = wrapData(async (a) => {
  return detectDrift({
    feature: a.feature as string,
    code_dir: a.code_dir as string | undefined,
    scope: a.scope as 'changed' | 'all' | undefined,
    since_ref: a.since_ref as string | undefined,
    mode: a.mode as 'check' | 'status' | undefined,
  });
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
    const byId = op.id ? dsl?.semantic?.files?.find((f) => f.id === op.id)?.path : undefined;
    const byData = typeof op.data?.['path'] === 'string' ? String(op.data['path']) : undefined;
    const p = byId ?? byData;
    if (p && !targetFiles.includes(p)) targetFiles.push(p);
  }
  if (sourceRoot && targetFiles.length > 0) {
    const misses = targetFiles.filter((p) => {
      const seen = factsOf(p).matched_path !== null;                              // 现取到事实
      const claimed = evidence.some((ev) => normRef(String(ev.ref)) === normRef(p)); // 在 evidence 里声明
      return !seen || !claimed;
    });
    if (misses.length > 0) {
      throw new Error(
        `改 semantic.files 前必须**现取**该文件的事实（T20 第 (4) 步）：${misses.join(' / ')} 缺「现取到事实 + 在 evidence 里声明」。` +
          `怎么做：先读它的事实（get_dsl(query:'file', file_id:…) 或 fileFacts(root, '${misses[0]}')），` +
          `再把该文件的**仓库相对路径**作为 evidence 的一条 ref 传进来（例：evidence=[{type:'node', ref:'${misses[0]}'}]）。` +
          `★ 为什么：DSL 已不存事实镜像（actual_apis / actual_deps 已移除）⇒ 事实只能**现取**。`,
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
  const existsFn = (ev: ReasonEvidenceRef): boolean =>
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
  return result;
});

// ─────────────────────────────────────────────────────────────
// 8 个主工具 handler
// ─────────────────────────────────────────────────────────────

/** get_dsl：只读查询（复用 queryFeature）。
 * ★ 用 wrapData：queryFeature 返回 `{ message, data? }` —— data 是查询的结构化产物
 *   （dsl / nodes / edges / files / functions …），wrap 会在通道层静默丢弃它。 */
export const getDslHandler = wrapData(async (a) => queryFeature(a as never));

/** manage_feature：生命周期。★ wrapData：manageFeature 返回 `{ message, data? }`（create/list 等的结构化产物） */
export const manageFeatureHandler = wrapData(async (a) => manageFeature(a as never));

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
  // 默认 mindmap：现行思维导图架构（root → 功能分组 → 文件）。
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
    return {
      message:
        r.message +
        `\n交互版（人机共笔：⊕ 新增分支 / 双击批注 / 保存回写 DSL）：http://localhost:3000/mindmap/${feature}`,
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
