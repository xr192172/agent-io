/**
 * req_baseline —— 「派生条目无要求权」的**判定核**（AGENTS 0.29⑥ · 0.25 · 2026-11-04）
 *
 * ## 它治哪个病（0.28 命名）
 * **Moving Baseline / 追着实现改期望** —— 同族：golden-master 的 *self-fulfilling baseline*、
 * 测试棘轮的「更新一下快照就绿了」。本仓的具体形态（0.29⑥ 条文里的可判形态）：
 *
 * ```
 * 1. expected_apis 里有一条派生条目（notes 带 from:cache.db@<rev>）
 * 2. 有人重构把形参改名（源码 f(enabled) ← 册 f(flag)）⇒ drift 变红
 * 3. 最省事的操作：把册改回 (enabled)，源码不动 ⇒ 门变绿
 * 4. 后果：该条目与源码永远同源 ⇒ 再也报不出"这里被改过" ⇒ 设计册退化成纯镜像，而它的绿是伪造的
 * ```
 *
 * ## 标准解法与取舍（0.28 ②③）
 * | 解法 | 本仓 |
 * |---|---|
 * | ① 冻结基线 + provenance（golden master 只读） | **已有**（`project_actual_fields`：只填空值 + `notes: from:cache.db@<rev>`）—— 它管"机器别覆盖人"，**不管"人能不能改回来"** |
 * | ② 双轨授权：改期望必须凭证 | **本模块补的就是这一档**（A/B/C 三分） |
 * | ③ 单向棘轮（期望只许收紧） | **排除**：设计线本来就要提升期望（派生 → 要求），棘轮会把它锁死 ⇒ 门永远亮（0.16） |
 * | ④ 每次变更人工审批 | **排除**：改期望本就是正常设计线动作，逐个审批 = 一次往返换零鉴别力 |
 *
 * ## 判定顺序（★ 顺序即优先级，改顺序会改变结论）
 * 一条**被改动**的派生条目（两侧签名不同，或派生标志变了）：
 * ```
 * 1. 只有一侧（新增 / 删除）        ⇒ skip-added / skip-deleted   ← 不判（见"边界"）
 * 2. 两侧都非派生                   ⇒ pass-not-derived            ← 人写契约 / 其它来源的派生
 * 3. 情形 C：同窗口内源码文件也改了 ⇒ pass-source-changed         ← 设计线的正常顺序
 * 4. 情形 A：改后签名 == cache.db   ⇒ fail-baseline-reset         ← 手改字面量冒充基线
 * 5. 情形 B：改后签名 != cache.db   ⇒ pass-credentialed / fail-no-credential
 * ```
 *
 * ★ **情形 C 必须在 A/B 之前**：设计线本来就要"先改册、再改码"（甚至分两个 commit）。
 *   若把"册变了码没变"一律判红，这个门会**永远亮**（0.16：一条永远会亮的告警 = 一条被关掉的告警）。
 *
 * ## 签名比较口径 = **逐字**（归一由调用方做，本文件不做）
 * 派生是**逐字复制** `nodes.signature` 的 ⇒ 归一后逐字相等才叫"改回源码当前值"。
 * 而签名规范化在本仓只有**一处权威**（`domain/expectation.ts#normSignature`）——
 * 在这里再造一份就是 0.9.1（一处权威）违例。
 * ★ 因此本文件**零值 import**（`behavior-cases` 的 harness 会把目标文件单独转译再 load）：
 *   归一后的两侧都是裸串，本文件只做相等判断。
 *
 * ## 边界（0.17①，如实写）
 * · 判的是「**改**一条派生条目的签名」，**不判**「删掉它」：删基线同样能让 drift 变绿，但那是另一个判定点
 *   —— 删条目不产生"伪造的绿"（drift 会从 `clean` 退化成 `no_comparison`，即"没有可比"而不是"比过了"）。
 *   而「删 + 重派生」是 0.29⑥ 点名的**合法**基线更新路径（派生只填空值 ⇒ 要更新就先删）⇒ 把它们判红
 *   会误杀唯一合法的操作，故单列进读数、不判红。
 * · cache.db 里查不到该符号的签名 ⇒ 走情形 B（要求凭证）。★ 这一档**只严不松**：索引陈旧时
 *   "实际签名"可能是旧值 ⇒ A 判不出来 ⇒ 落到 B ⇒ 仍要凭证 ⇒ 不会假绿（0.12：判不了要单独成态，不许冒充通过）。
 * · 判的是**签名**，不是"意图有没有变" —— 人真要提高要求（情形 B）时由凭证承载，与 0.29⑥ 的
 *   「提升只有两条路：① 人编辑过 ② 补了 why/判据」一致（② 就是这里的凭证）。
 */

/** 一条 `expected_apis` 条目在被判门眼里只需要两样：签名，以及"它是不是派生来的"。 */
export interface ReqBaselineEntry {
  /** 归一后的签名（调用方用 `normSignature` 处理过） */
  signature: string;
  /**
   * 是否派生自 `cache.db`。
   * ★ **不由本文件从 `notes` 里猜**：前缀的唯一权威是
   *   `application/meta/registry/project_actual_fields.ts#DERIVED_NOTES_PREFIX`，
   *   由调用方判好再传进来（本文件零 import，见文件头）。
   */
  derived: boolean;
}

/** 凭证种类：一条**指名该符号**的判据。`none` = 没有。 */
export type ReqBaselineCredential = 'signature-matches' | 'behavior-cases' | 'none';

export interface ReqBaselineJudgementInput {
  /** 改前的条目；`null` = 该条目是新增的 */
  oldEntry: ReqBaselineEntry | null;
  /** 改后的条目；`null` = 该条目被删了 */
  newEntry: ReqBaselineEntry | null;
  /** `cache.db` 此刻该符号的签名（归一后）；`null` = 索引里查不到（不是"没有签名"） */
  actualSignature: string | null;
  /** 同一窗口（同一 commit / 同一工作区变更）里，该条目对应的**源码文件**是否也被改过 */
  sourceChanged: boolean;
  /** 是否存在一条**指名**（path + symbol）且签名与 `newEntry` 一致的 `signature-matches`，或 `behavior-cases` */
  credential: ReqBaselineCredential;
}

/** 结局名（★ 三组：`pass-*` / `fail-*` / `skip-*` —— 字符串本身说明它算不算红） */
export type ReqBaselineVerdict =
  | 'skip-added'
  | 'skip-deleted'
  | 'skip-unchanged'
  | 'pass-not-derived'
  | 'pass-source-changed'
  | 'pass-credentialed'
  | 'fail-baseline-reset'
  | 'fail-no-credential';

/** 0.29⑥ 条文里的情形名（`none` = 不进三情形） */
export type ReqBaselineCaseName = 'A' | 'B' | 'C' | 'none';

export interface ReqBaselineJudgement {
  /** `true` = 本门**不判红**（含 `skip-*`） */
  ok: boolean;
  verdict: ReqBaselineVerdict;
  case: ReqBaselineCaseName;
  /** 一句话结论（★ 失败时必须可定位：带上情形名 + 该怎么办） */
  why: string;
}

/** 一条摊平后的条目（`path` = 仓库相对路径，`symbol` = 从签名的名字前缀取） */
export interface ReqBaselineFlatEntry extends ReqBaselineEntry {
  path: string;
  symbol: string;
}

/** 一次「条目改动」（配对结果） */
export interface ReqBaselineEntryChange {
  path: string;
  symbol: string;
  /** `changed` = 两侧都在且签名/派生标志不同；`added` / `deleted` = 只有一侧 */
  kind: 'changed' | 'added' | 'deleted';
  oldEntry: ReqBaselineEntry | null;
  newEntry: ReqBaselineEntry | null;
}

/**
 * 从签名的**名字前缀**取符号名 —— `expected_apis` 的条目**没有 name 字段**（只有 `signature` + `notes`），
 * 所以配对键只能从签名里取，口径只有这一处（别在门脚本里再写一份）：
 * ```
 * PackageFilter(probes []ContractProbe) map[string]bool   ⇒ PackageFilter
 * intentMarker = (path, desc): string =>                  ⇒ intentMarker   （const 的函数表达式形态）
 * (s *Server) Handle(ctx) error                           ⇒ Handle         （Go 方法：名字在接收者之后）
 * DEFAULT_LANGS                                           ⇒ DEFAULT_LANGS  （无括号：整串）
 * ```
 */
export function symbolOfSignature(signature: string): string {
  const s = String(signature ?? '').trim();
  if (!s) return '';
  // Go 方法：`(recv *T) Name(...)` —— 名字在接收者之后（先剥一层接收者）
  const recv = /^\([^()]*\)\s*([A-Za-z_$][\w$]*)/.exec(s);
  if (recv) return recv[1];
  const at = s.indexOf('(');
  const head = (at >= 0 ? s.slice(0, at) : s).trim();
  // const 的函数表达式形态：`name = (a) => …` ⇒ 去掉赋值号
  return head.replace(/\s*=\s*$/, '').trim();
}

/**
 * 把两版「摊平条目表」配成「改动清单」。
 *
 * 配对键 = `(path, symbol)`。同键多条的（重载 / 同名）按**出现顺序**逐条配对，多出来的分别算
 * `deleted` / `added` —— 不猜、不跨键配对（跨键配对照样会产出"看起来像改动"的假变更）。
 *
 * ★ 这是本门的**唯一**配对实现：门脚本只负责把 DSL 摊平成 {@link ReqBaselineFlatEntry}[]。
 */
export function diffDerivedEntries(
  oldEntries: readonly ReqBaselineFlatEntry[],
  newEntries: readonly ReqBaselineFlatEntry[],
): ReqBaselineEntryChange[] {
  const keyOf = (e: ReqBaselineFlatEntry): string => `${String(e.path)}\u0000${String(e.symbol)}`;
  const bucket = (list: readonly ReqBaselineFlatEntry[]) => {
    const m = new Map<string, ReqBaselineFlatEntry[]>();
    for (const e of list) {
      const k = keyOf(e);
      const arr = m.get(k);
      if (arr) arr.push(e);
      else m.set(k, [e]);
    }
    return m;
  };
  const oldBy = bucket(oldEntries);
  const newBy = bucket(newEntries);
  /** 键的外层顺序：先按改前顺序，再补改后新出现的键（★ 输出顺序必须确定，否则读数会抖） */
  const keys: string[] = [];
  for (const k of oldBy.keys()) keys.push(k);
  for (const k of newBy.keys()) if (!oldBy.has(k)) keys.push(k);

  const out: ReqBaselineEntryChange[] = [];
  for (const k of keys) {
    const olds = oldBy.get(k) ?? [];
    const news = newBy.get(k) ?? [];
    const n = Math.min(olds.length, news.length);
    for (let i = 0; i < n; i++) {
      const o = olds[i];
      const w = news[i];
      if (o.signature === w.signature && o.derived === w.derived) continue; // 没动 ⇒ 不进清单
      out.push({
        path: String(w.path),
        symbol: String(w.symbol),
        kind: 'changed',
        oldEntry: { signature: o.signature, derived: o.derived },
        newEntry: { signature: w.signature, derived: w.derived },
      });
    }
    for (let i = n; i < olds.length; i++) {
      const o = olds[i];
      out.push({
        path: String(o.path),
        symbol: String(o.symbol),
        kind: 'deleted',
        oldEntry: { signature: o.signature, derived: o.derived },
        newEntry: null,
      });
    }
    for (let i = n; i < news.length; i++) {
      const w = news[i];
      out.push({
        path: String(w.path),
        symbol: String(w.symbol),
        kind: 'added',
        oldEntry: null,
        newEntry: { signature: w.signature, derived: w.derived },
      });
    }
  }
  return out;
}

/** 情形名 → 一句话（读数与失败明细共用，别在门脚本里再拼一份） */
function caseLabel(c: ReqBaselineCaseName): string {
  if (c === 'A') return '情形 A（手改字面量冒充基线）';
  if (c === 'B') return '情形 B（提升派生条目）';
  if (c === 'C') return '情形 C（册与码同窗改动）';
  return '非三情形';
}

/**
 * **本门唯一的判定核**：给一条条目的改前/改后 + 实际签名 + 窗口内源码是否也改了 + 凭证 ⇒ 结局。
 *
 * ★ 纯函数：没有 I/O、没有环境态（0.12②：门的输入不许是 mtime / cwd / 可被覆盖的缓存）。
 */
export function judgeDerivedEntryChange(input: ReqBaselineJudgementInput): ReqBaselineJudgement {
  const { oldEntry, newEntry, actualSignature, sourceChanged, credential } = input;

  // ── 1. 只有一侧：新增 / 删除 —— 不判（合法路径：删 + 重派生 = 一删一增；见文件头"边界"）
  if (!newEntry) {
    return {
      ok: true,
      verdict: 'skip-deleted',
      case: 'none',
      why: '条目被删除 ⇒ 不判（删基线不产生"伪造的绿"；drift 会退化成 no_comparison，而不是 clean）',
    };
  }
  if (!oldEntry) {
    return {
      ok: true,
      verdict: 'skip-added',
      case: 'none',
      why: '条目新增 ⇒ 不判（重派生走"先删再派生"，落在这里；派生值必须等于源码，判它等于判重派生本身）',
    };
  }
  if (oldEntry.signature === newEntry.signature && oldEntry.derived === newEntry.derived) {
    return { ok: true, verdict: 'skip-unchanged', case: 'none', why: '条目没变 ⇒ 不判' };
  }

  // ── 2. 两侧都不是派生条目 ⇒ 人写的契约 / 其它来源的派生：**一概跳过**（0.29⑥ ②）
  if (!oldEntry.derived && !newEntry.derived) {
    return {
      ok: true,
      verdict: 'pass-not-derived',
      case: 'none',
      why: '两侧都不是 `from:cache.db@` 派生条目 ⇒ 不是派生基线，本门不管',
    };
  }

  // ── 3. 情形 C：同窗口内源码也改了 ⇒ 设计线正常顺序，不判
  if (sourceChanged) {
    return {
      ok: true,
      verdict: 'pass-source-changed',
      case: 'C',
      why: `${caseLabel('C')}：该条目对应的源码文件在同一窗口内也被改过 ⇒ 放行（否则本门永远亮）`,
    };
  }

  // ── 4. 情形 A：改后签名 == cache.db 此刻 ⇒ 把册改回源码 = 手改字面量冒充基线
  if (actualSignature !== null && newEntry.signature === actualSignature) {
    return {
      ok: false,
      verdict: 'fail-baseline-reset',
      case: 'A',
      why:
        `${caseLabel('A')}：改后签名与 cache.db 此刻**逐字相同**，而源码本次没动 ⇒ 这条派生条目与源码永远同源，` +
        '再也报不出"这里被改过"。修法二选一：① 要更新基线 ⇒ 删掉该条后重派生（落成 add，本门不判）；' +
        '② 要提升它 ⇒ 补齐凭证（一条指名的 signature-matches / behavior-cases）',
    };
  }

  // ── 5. 情形 B：真提升 ⇒ 必须有凭证
  const actualNote =
    actualSignature === null
      ? '（cache.db 里查不到该符号的签名 ⇒ 判不了 A，按 B 处理：只严不松）'
      : `（cache.db 此刻是 \`${actualSignature}\`）`;
  if (credential !== 'none') {
    return {
      ok: true,
      verdict: 'pass-credentialed',
      case: 'B',
      why: `${caseLabel('B')}${actualNote}，且有一条 \`${credential}\` 判据指名它 ⇒ 提升有凭证，放行`,
    };
  }
  return {
    ok: false,
    verdict: 'fail-no-credential',
    case: 'B',
    why:
      `${caseLabel('B')}：改后签名与 cache.db 不同（= 真提升）${actualNote}，但**没有任何判据指名它** ⇒ ` +
      '提升必须留下要求：补一条 `signature-matches { path, symbol, signature: 与这条一致 }` 或 `behavior-cases { path, symbol }`',
  };
}

/** 一条改动的**紧凑渲染**（行为判据的 `expect` 要对得上 ⇒ 必须是一条稳定短串，不是整对象） */
export function renderEntryChange(c: ReqBaselineEntryChange): string {
  const oldS = c.oldEntry ? c.oldEntry.signature : '-';
  const newS = c.newEntry ? c.newEntry.signature : '-';
  return c.kind + '|' + c.path + '#' + c.symbol + '|' + oldS + ' -> ' + newS;
}

/** 改动清单的人读渲染；空清单 = `-`（★ 不用空串：空串与"渲染失败"读起来一样，0.12） */
export function renderEntryChanges(list: readonly ReqBaselineEntryChange[]): string {
  return list.length ? list.map(renderEntryChange).join(' ; ') : '-';
}

/** 判定的**紧凑渲染**：`ok|B|pass-credentialed` / `red|A|fail-baseline-reset`（行为判据的 expect 形态） */
export function renderJudgement(j: ReqBaselineJudgement): string {
  return (j.ok ? 'ok' : 'red') + '|' + j.case + '|' + j.verdict;
}


/**
 * 判定 → **一行结论**（`red|A|fail-baseline-reset`）。
 *
 * ★ 这是「执行核 + 渲染」的**唯一组合点**：门的失败明细打的就是这一行；
 * 而 `behavior-cases` 也钉它 —— 判定返回的对象里带一段长 `why`（诊断文案，会随措辞演化），
 * 只有渲染结果才是稳定可比的 repr。
 */
export function judgeLine(input: ReqBaselineJudgementInput): string {
  return renderJudgement(judgeDerivedEntryChange(input));
}
