/**
 * ★★★ T197（2026-10-12）：`explore_code` 的 **per-action 合法 `args` 键表** + 校验器。
 *
 * ## 为什么要有它（★ 实测出来的病，不是推想）
 * `explore_code` 的入参是 `{action, args}` —— 而 `args` 在 schema 里是
 * **`z.record(z.string(), z.unknown())`（一个自由袋子）** ⇒ ★ **zod 对它一个字都不校验**。
 * 实测（T197）：
 * ```
 * explore_code {action:"guided_tour", args:{feature:"run82", feture:"run82"}}
 *   ⇒ ★ **照样成功**，一个字都不提那个多出来的 `feture` —— **静默吞掉拼写错误**
 * explore_code {action:"guided_tour", args:{feture:"run82"}}
 *   ⇒ `缺参数 "feature"` —— ★ 响亮，但**不告诉你"是不是想写 `feature`"**
 * ```
 * ★ 后果不是"少报一条"：调用方**以为自己的参数生效了**，而工具按默认值跑完并返回一份"正常"结果
 *   —— ★ 与 T191（形状错被静默当没给）**同一族**，这里补的是**另一维：键名**。
 *
 * ## ★ 表的来源与防漂移（★ 别手抄）
 * 本表**机械派生**自 `explore_code.ts` 里各 action 的取值调用
 * （`optionalStr/Num/Bool/Arr(args,'k')` + `args['k']` 直读）。
 * ★★ **验证方式必须是【行为】而不是【文本】** —— 否则"用同一个正则生成、又用同一个正则核对"是**恒真**的
 *   （本仓 §2.4「判据恒真=装饰」）。⇒ 见 `.inspect/t197-args.mjs`：**逐个 action 真跑两次**
 *   （① 只给合法键 ⇒ **不许出现"不认识的键"错**；② 塞一个假键 ⇒ **必须出现**）。
 *
 * ## ★ 与 T191 的分工（两把尺，别混）
 * · `plumbing.optionalStr/Num/Bool` 管 **值形状**（给了就必须是对的类型）；
 * · 本文件管 **键名**（这个 action 认不认这个名字）。
 */

/** action ⇒ 该 action 认的 `args` 键（★ 顺序无意义，别当成优先级） */
export const EXPLORE_ARGS: Record<string, readonly string[]> = {
  search: ['min_score', 'project_dir', 'query', 'top_k'],
  read: ['context', 'end', 'file', 'parent', 'project_dir', 'start', 'symbol', 'symbols', 'symbols_limit'],
  // ★ facts（2026-10-21）：**选择性读 DB** —— `fields` 是它的核心参数（白名单在
  //   `explore_code.ts#FACTS_COLUMNS`，那里是唯一住处）；`project_dir` 与 read 同口径（缺省 cwd）。
  facts: ['fields', 'file', 'limit', 'name', 'project_dir'],
  arch_layer: ['check_violations', 'feature', 'layers', 'no_cache', 'persist'],
  guided_tour: ['feature'],
  check_monolith: [
    'base_dir', 'crit_lines', 'feature', 'files', 'flag_cohesive', 'max_files', 'no_cache',
    'preview_feature', 'project_dir', 'save_preview', 'warn_lines',
  ],
  derive_mind_map: ['feature', 'gen_descriptions', 'max_files_per_community', 'output_path'],
  run_simulation: ['events', 'feature'],
  reset_simulation: ['feature'],
  // ★ 注意 `watch` 的 `args` 里**自带一个 `action`**（那是 watch 自己的子动作，不是本工具的 action）——
  //   它是**合法键** ✓，别当成"重名错误"删掉。
  watch: [
    'action', 'debounce_ms', 'diff_on_change', 'drift_on_change', 'feature', 'files',
    'impact_on_change', 'ledger_status', 'project_dir', 'reason', 'rebuild_on_change',
    'rebuild_window_ms', 'reconcile_interval_ms', 'resolve_id', 'reviewer', 'seq',
  ],
};

/** 编辑距离（只用来提"是不是想写 X"—— ★ 不做别的判断，别拿它当模糊匹配去自动改值） */
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * 校验 `args` 的**键名**：出现该 action 不认识的键 ⇒ **抛**（★ 绝不静默忽略）。
 *
 * @param action 当前 action（不在表里 ⇒ **不拦**：★ 那种情况会有"未知 action"的报错，别在这儿抢戏）
 */
export function assertExploreArgKeys(action: string, args: Record<string, unknown>): void {
  const allowed = EXPLORE_ARGS[action];
  if (!allowed) return; // ★ 未知 action 由分发器自己报（这里不越权）
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k));
  if (unknown.length === 0) return;
  const hints = unknown.map((k) => {
    const near = allowed
      .map((c) => ({ c, d: editDistance(k, c) }))
      .filter((x) => x.d <= 2)
      .sort((x, y) => x.d - y.d)
      .slice(0, 2);
    return near.length ? `\`${k}\`（★ 是不是想写 \`${near.map((n) => n.c).join('` / `')}\`？）` : `\`${k}\``;
  });
  throw new Error(
    `explore_code action="${action}" 的 args 里有**不认识的键**：${hints.join('、')}。\n` +
      `  ★ 该 action 认这些键：${allowed.map((k) => `\`${k}\``).join(' · ')}\n` +
      '  ★ 为什么必须拒（而不是忽略）：★ 不认识的键过去会被**静默丢掉** —— ' +
      '调用方**以为自己的参数生效了**，而工具按默认值跑完、还回一份"正常"结果。',
  );
}

/**
 * ★★★ T215（2026-10-13）：**哪些 action 的哪些键是【硬必填】** —— ★ 缺了必须在【入口】就拒 ✓
 *
 * ## 为什么加它（★ 外部评测的 ③）
 * 评测原话：*"**入口合并了，不代表使用复杂度消失了；它可能只是搬进了参数和说明里**。
 *   对 Agent 来说，这也会增加**选错动作、漏参数、漏读限制**的机会。"* ✓
 * ★★ 实测：★ **必填要求【确实只写在长描述里】** —— 如 *"`run_simulation`（**硬必填** feature）"* ✓
 *   ⇒ ★ 而**机器可判的表里没有** ✗ ⇒ ★ **"漏参数"只能靠人/LLM【读长描述】** ✓
 *   ⇒ ★★ **本表就是把那些"硬必填"【从说明搬回参数】** ✓ —— ★ 正是评测要的方向 ✓
 *
 * ## 口径（★ 严格照描述读，★ 不猜）
 * ★ 只有描述里**明说"必填 / 缺省报错"**的才收进来 ✓
 * ★★ 反例：★ `search` 的 `query` —— ★ 描述写 *"（**空则返回『查询为空』提示**）"* ✓
 *   ⇒ ★ **那是"空有专门提示"、不是"缺就抛"** ✗ ⇒ ★ **不收** ✓（★ 收了会误拒 ✓）
 *
 * ## 边界（★ 如实标）
 * ★ **只列【描述里点了名的】那 7 个 action** ✓ —— ★ 其余 action 的必填**没逐条读** ✗ ⇒ **不在这里**
 *   ⇒ ★★ **"没列" ≠ "没有必填"**（★ 与"没圈到就省略"同：★ **本表是【已知】，不是【穷举】** ✓）
 */
export const EXPLORE_REQUIRED: Record<string, readonly string[]> = {
  // ★ facts（2026-10-21）：描述里点名"**硬必填 file**" ⇒ 收进来（缺了在【入口】就拒，
  //   而不是往下跑到"读不到库"那一步才报）。
  facts: ['file'],
  run_simulation: ['feature'],
  reset_simulation: ['feature'],
  search: ['project_dir'],
  arch_layer: ['feature'],
};

/**
 * ★★★ T215：校验 `args` 的**硬必填**：缺了 ⇒ **抛**（★ 绝不带着缺参往下跑）。
 *
 * @param action 当前 action（**不在表里 ⇒ 不拦**：★ 本表只覆盖"描述里点名过必填"的那些 ⇒
 *   ★ 对没读过的 action **不越权** ✓）
 */
export function assertExploreRequired(action: string, args: Record<string, unknown>): void {
  const required = EXPLORE_REQUIRED[action];
  if (!required) return; // ★ 本表只覆盖已知的那些 ⇒ 其余不拦（★ 不越权 ✓）
  const missing = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
  if (missing.length === 0) return;
  throw new Error(
    `explore_code action="${action}" 缺**必填**参数：${missing.map((k) => `\`${k}\``).join('、')}。\n` +
      `  ★ 该 action 的必填：${required.map((k) => `\`${k}\``).join(' · ')}\n` +
      '  ★ 为什么必须拒（而不是跑默认值）：★ 缺参时"默默按默认跑完"会给出**看起来正常、其实不对**的结果 —— ' +
      '★ 而调用方**以为自己的意图被接受了**。',
  );
}
