/**
 * dissent_spec.ts —— 「带异议领卡」（`supersedes`）的**判定内核**：三道门 + 合并后收口读数。★ 零 import。
 *
 * ## 它治什么病（用户 2026-10-30 原话，逐字）
 * > 「后一个人把前一个人这个的设计读完了，并且**结构化重写**了这个设计，然后并**告知前一个人**这个设计改了……
 * >  或者说是别人在动的时候你就不动弹，不能动弹，应该这样是更好的，因为**大家是在同一个设计上面去进行**，
 * >  而不是大家各做各的。」
 *
 * ⇒ 改集相交（`E-CLAIM-005` 一律拒）不再是**唯一出口**：能拿出「我读过它」的**机械证据** ⇒ 带异议领卡。
 *   ★ 拒的口径**不变**，只是多了一条**有条件的**出口（三道门任一不过 ⇒ 照旧拒）。
 *
 * ## 三道门（本文件唯一的判据）
 * 1. `against` 指向**同项目根下 `state=claimed`** 的卡 —— 异议必须点名到「那个正在办的人」；
 * 2. **「读全」的机械证据**：两卡改集交集的**每个文件**，我的画布必须**逐个顶层符号表态**
 *    （`untouched_default` 的紧凑声明也算，但冻结之后新增的符号仍会被抓）—— 没表态 = 没通读就动手；
 * 3. `judgements` **逐条覆盖对端卡上的全部判据**（对端节点 `decision.expectations` 每一条都要一条表态），
 *    且每条 `why` 必须带实体 —— 这是「我读过它」的硬证据，不是一句「我看过了」。
 *
 * ## ★★ `against` 的两种合法形态（2026-10-30 第二笔：卡级接管）
 * 本函数只判"这些事实成立吗"，不判"是哪一档"。调用方（`task_ops.ts#claimTask`）有两个入口喂它：
 * 1. **改集相交档**（`E-CLAIM-005` 那条路）：`against` = 撞上的**另一张** `state=claimed` 的卡；
 *    `coverage` = **两张卡改集的交集文件**。
 * 2. **卡级接管档**（同一次 `claim` 撞到"这张卡已经被别人领了"）：`against` = **正在被领的这张卡自己**
 *    —— 这一档没有"对端卡"，对端就是它（我在推翻**它现在的判据/做法**，然后由我接着办）；
 *    `coverage` = **这张卡自己的画布坍缩集**涉及的全部文件（改集只有一份 ⇒ 交集就是它自己）。
 * ⇒ 两档**共用同一套三道门**（同一处判据），差别只在"喂进去的事实从哪来"：
 *   ★ 所以 `against` 指向自己**不是**放宽 —— 门 3 照样要把它节点上的判据逐条表态。
 *
 * ## 错误一律用**码**，不用散文（归属口径写死在这里，别处不许再分一份）
 * | 情况 | 码 |
 * |---|---|
 * | 声明本身不成立（旧字符串形态 / 缺 against / against 不是活跃卡 / why 无实体） | `E-CLAIM-016` |
 * | 交集文件有顶层符号没表态（`planCoverageGaps` 非空） | `E-CLAIM-017` |
 * | judgements 不成立 / 漏覆盖对端判据 / verdict 非法 / why 无实体（点名缺哪几条） | `E-CLAIM-018` |
 * | 带异议的卡收口时缺「合并后整册 judge」读数 | `E-TASK-008` |
 *
 * ## 为什么零 import
 * `behavior-cases` 的 harness 会把目标文件**单独转译再 import** ⇒ 目标文件必须零依赖自含
 * （否则报「目标文件加载失败: Cannot find module …」）。类型自己也声明一份，不从 task_schema 取。
 */

/** 一条「对端判据」的表态（`ref` = `decision:<node>#<index>` 或判据一句话标识） */
export interface DissentJudgement {
  ref: string;
  /** ★ 闭集两个值：`仍成立` / `被推翻`（判不出第三态 —— "不确定"不是表态） */
  verdict: '仍成立' | '被推翻';
  /** ★ 必须带实体（路径 / 符号 / 数字 / 对端卡 id）—— 沿用 reason 的 L3 口径 */
  why: string;
}

/** `TaskDiscussion.supersedes` 的**对象形态**（字符串形态是它的前身；接活时向后兼容地保留） */
export interface DissentSupersedes {
  /** ★ 必须点名对端卡 id（同项目根、且 state=claimed） */
  against: string;
  /** ★ 为什么推翻它（必须带实体） */
  why: string;
  /** ★ 逐条对**对端卡上的判据**表态 */
  judgements: DissentJudgement[];
  /** 我会改掉 / 替换什么（可选，给人读；★ **租约"改写接管"档必填** —— 见 `validateSupersedes` 的口径表） */
  scope_change?: string;
  /**
   * ★★★ **引用"对端已明确废弃"**（2026-10-30 用户裁定）：`against` 是 **`void` 卡**时**必填**。
   *
   * ## 为什么 `void` 可以省 `judgements`（而 `done` 不行）
   * `void` 是**唯一的"明确废弃"信号** —— `task_schema.ts:43` 把它定义为"失效 / 被取代，与 done 是两种不同结局"，
   * `task_machine.ts:114` 逐字写着「**`void` 的判据已作废**」。而 `done` 的判据**仍然算数**
   * （它只说明"上一轮做完了"，不说明"这套设计作废了"）。
   *
   * ## 但它**不是免票**
   * 没有这一格，任何人都能声称"对端已废弃"来跳过读全 ⇒ 必须**点名引用**：
   * `{card: <void 卡 id>, reason: <它为什么被作废>}`。缺 ⇒ `E-CLAIM-016`（声明不完整）。
   */
  cites_voided?: { card: string; reason: string };
}

/** 对端卡的**事实**（由调用方现查：本文件不读册、不读盘） */
export interface DissentAgainstFacts {
  id: string;
  /** 现查到的 state（只有 `claimed` 才算占位） */
  state?: string;
  /** 与本次 claim 是否同一个项目根（跨项目根不比：别的仓与本仓并行不冲突） */
  same_root?: boolean;
}

/** 交集里某一个文件的**通读缺口**（`gaps` 就是 `rewrite_plan.ts#planCoverageGaps` 的返回） */
export interface DissentCoverageOfFile {
  file: string;
  gaps: readonly string[];
}

/** `validateSupersedes` 的入参：**全部事实由调用方现取**（零依赖：本文件不碰盘、不读册） */
export interface ValidateSupersedesInput {
  /** `data.supersedes` 的**原始值**（`undefined` / `null` = 没声明异议 ⇒ 不归本函数管） */
  raw?: unknown;
  /** 按 `raw.against` 现查到的对端卡（查不到 ⇒ 给 `null`，**不猜**） */
  against?: DissentAgainstFacts | null;
  /** 两卡改集交集的**每个文件**的通读缺口 */
  coverage?: readonly DissentCoverageOfFile[] | null;
  /** 对端卡上的**全部判据标识**（`decision:<node>#<index>`，顺序 = 册上顺序） */
  peer_judgements?: readonly string[] | null;
}

/** 判定结果：`errors` 里每一条都以码开头（`E-CLAIM-0xx · …`） */
export interface DissentVerdict {
  ok: boolean;
  errors: string[];
}

/** 收口读数的入参（`reading` 证据的 `command` + `observed` 原文） */
export interface MergedReadingInput {
  command?: string;
  observed?: string;
}

/** 四个码的唯一住处（渲染文案时别再手打字符串） */
export const DISSENT_CODES = {
  claimShape: 'E-CLAIM-016',
  coverage: 'E-CLAIM-017',
  judgements: 'E-CLAIM-018',
  merged: 'E-TASK-008',
} as const;

/** verdict 的闭集（只有两个值；第三个值不算表态） */
const VERDICTS: readonly string[] = ['仍成立', '被推翻'];

/** 数字指标（= 具体实体之一：`\d` 覆盖率极广，`3 处` / `169 条` 都算） */
const METRIC_RE = /\d/;
/** 文件路径 / 文件名（带扩展名）—— 另一种具体实体 */
const PATH_RE =
  /[A-Za-z0-9_\-/.]+\.(?:ts|tsx|js|jsx|mjs|cjs|go|py|java|json|md|vue|sql|html|css|txt|yml|yaml)\b/i;
/** judge 读数里的 `N pass` / `M fail` */
const PASS_RE = /(\d+)\s*pass/i;
const FAIL_RE = /(\d+)\s*fail/i;

/** 只认非空字符串（`null` / 数字 / 空白都算没给） */
function normText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 「这句话里有没有**具体实体**」—— 沿用 `reason_validator.ts` 的 L3 口径（数字指标 / 文件路径 / 点名 id）。
 * ★ 为什么必须有它：`why` 写成「我读过它的设计」是一句**谁都写得出的空话**；
 *   带一个符号名、一条路径、一个数字，才证明**真的看过那一份**。
 */
export function hasConcreteEntity(text: string, ids?: readonly string[]): boolean {
  const t = normText(text);
  if (!t) return false;
  if (METRIC_RE.test(t)) return true;
  if (PATH_RE.test(t)) return true;
  for (const id of ids ?? []) {
    if (id && t.includes(id)) return true;
  }
  return false;
}

/**
 * 把原始值收成 {@link DissentSupersedes}（形状不对 ⇒ `null`，**不猜、不补默认值**）。
 * ★ 只做收拢，不做判定：判定在 {@link validateSupersedes}。
 */
export function normalizeSupersedes(raw: unknown): DissentSupersedes | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const against = normText(o.against);
  const why = normText(o.why);
  // ★ 2026-10-30：`judgements` 可以**省**（只有对端是 `void` 卡才允许省 —— 它的判据已作废）。
  //   ★ 该不该省由 `validateSupersedes` 判（那里有对端 state 的事实），收拢这里**不替它判**。
  if (!against || !why) return null;
  if (o.judgements !== undefined && o.judgements !== null && !Array.isArray(o.judgements)) return null;
  const judgements: DissentJudgement[] = [];
  for (const x of Array.isArray(o.judgements) ? (o.judgements as unknown[]) : []) {
    const j = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    judgements.push({
      ref: normText(j.ref),
      verdict: normText(j.verdict) as DissentJudgement['verdict'],
      why: normText(j.why),
    });
  }
  const scope = normText(o.scope_change);
  const cite = (o.cites_voided && typeof o.cites_voided === 'object' ? o.cites_voided : {}) as Record<string, unknown>;
  const citeCard = normText(cite.card);
  const citeReason = normText(cite.reason);
  return {
    against,
    why,
    judgements,
    ...(scope ? { scope_change: scope } : {}),
    ...(citeCard && citeReason ? { cites_voided: { card: citeCard, reason: citeReason } } : {}),
  };
}

/**
 * **三道门**（本文件唯一的判定；claim 时改集相交才调）。
 *
 * @returns `{ok, errors}`；`errors` 每条以码开头（`E-CLAIM-016/017/018`），顺序 = 声明 → 读全 → 逐条。
 */
export function validateSupersedes(i: ValidateSupersedesInput): DissentVerdict {
  const errors: string[] = [];
  const raw = i?.raw;
  // ★ 没声明异议 ⇒ 不归本函数管（ok:true）：拒领仍由 `claim_conflict.ts#claimConflictMessage` 负责
  if (raw === undefined || raw === null) return { ok: true, errors: [] };

  // ── 门 0：形态。旧字符串形态**接不住**这道门（它点不到对端卡）⇒ 明确指路 ──
  if (typeof raw === 'string') {
    errors.push(
      DISSENT_CODES.claimShape +
        ' · `supersedes` 是**旧字符串形态**（' +
        JSON.stringify(raw) +
        '）⇒ 它点不到对端卡、也带不了逐条表态。请改成对象形态 ' +
        '{against:"<对端卡 id>", why, judgements:[{ref, verdict:"仍成立"|"被推翻", why}]}',
    );
    return { ok: false, errors };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(
      DISSENT_CODES.claimShape + ' · `supersedes` 必须是对象，收到 ' + JSON.stringify(raw) + '（旧字符串形态同样不接受）',
    );
    return { ok: false, errors };
  }
  const o = raw as Record<string, unknown>;
  const against = normText(o.against);
  const why = normText(o.why);
  /**
   * ★★★ **对端卡的每种状态，各有各的义务**（2026-10-30 用户裁定 · 本函数的语义说明书）
   *
   * | 对端卡状态 | 要求 |
   * |---|---|
   * | `claimed` · 租约**未**过期 | 只能等，或**带异议接管**（本函数三道门） |
   * | `claimed` · 租约**已**过期 | **接管 + 声明**：`judgements` 全"仍成立" = **兼容接管**；有"被推翻" = **改写接管**（须给 `scope_change`） |
   * | `done` | **必须逐条表态**（兼容或明改）—— 它的判据**没有**作废 |
   * | `void` | `judgements` **可省**，但必须 `cites_voided`（引用它**为什么**被作废） |
   * | （已 `delete`） | 已出册、不在册上 ⇒ 点不到它，也就无需表态（墓碑可查） |
   *
   * ## 为什么 `void` 能省、`done` 不能
   * `void` 是**唯一的'明确废弃'信号**：`task_schema.ts:43` 说它与 `done` 是"两种不同结局"，
   * `task_machine.ts:114` 逐字说「**`void` 的判据已作废**」。而 `done` 只是"上一轮做完了"——
   * 判据仍然算数 ⇒ 对 done 卡逐条表态**不能省**（省了就等于把"做完了"当成"设计没了"）。
   * ★ 用户原话：*「只要这套设计没有被明确废弃……你后面的东西就要兼容前面的东西」*。
   */
  const peerState = i?.against ? String(i.against.state ?? '') : '';
  const peerVoid = peerState === 'void';
  const peerJudged = peerState === 'claimed' || peerState === 'done';

  // ── 门 1：against 必须是**同项目根下 state=claimed | done | void** 的卡 ──
  if (!against) {
    errors.push(DISSENT_CODES.claimShape + ' · 缺 `against`（必须点名对端卡 id —— 异议是给"那个正在办的人"的）');
  } else if (!i?.against) {
    errors.push(
      DISSENT_CODES.claimShape +
        ' · `against:' +
        against +
        '` 不是同项目根下 state=claimed 的卡（找不到这张活跃卡 ⇒ 异议无处落地）',
    );
  } else if (i.against.same_root === false) {
    errors.push(
      DISSENT_CODES.claimShape + ' · `against:' + against + '` 在**别的项目根** ⇒ 跨项目根不参与冲突比对，异议也不成立',
    );
  } else if (peerVoid) {
    // ★ `void` = **明确废弃** ⇒ 判据已作废（`judgements` 可省），但**必须引用它为什么被作废**。
    const cites = (o.cites_voided && typeof o.cites_voided === 'object' ? o.cites_voided : {}) as Record<string, unknown>;
    const cCard = normText(cites.card);
    const cReason = normText(cites.reason);
    if (!cCard || !cReason) {
      errors.push(
        DISSENT_CODES.claimShape +
          ' · `against:' +
          against +
          '` 是 **void** 卡：`void` 卡的判据**已作废**（`task_machine.ts#114`）⇒ `judgements` 可以省，' +
          '但**必须引用它**（`cites_voided:{card:"' +
          against +
          '", reason:"<它为什么被作废>"}`）—— 否则"它作废了"就成了一张免票',
      );
    } else if (cCard !== against && cCard !== (i.against.id ?? '')) {
      errors.push(
        DISSENT_CODES.claimShape +
          ' · `cites_voided.card` 必须点**这张**被引用的 void 卡（收到 ' +
          JSON.stringify(cCard) +
          '，对端是 ' +
          against +
          '）—— 拿别人的废除当理由不算',
      );
    }
  } else if (!peerJudged) {
    errors.push(
      DISSENT_CODES.claimShape +
        ' · `against:' +
        against +
        '` 的 state=' +
        String(i.against.state ?? '(空)') +
        ' ⇒ 只有 claimed / done / void 的卡有意义（candidate 谁也不占位，也就不需要异议）',
    );
  }
  // ── 门 1'：顶层 why 必须带实体 ──
  if (!why) {
    errors.push(DISSENT_CODES.claimShape + ' · 缺 `why`（为什么推翻它 —— 空理由 = 没表态）');
  } else if (!hasConcreteEntity(why, [against, i?.against?.id ?? ''])) {
    errors.push(
      DISSENT_CODES.claimShape +
        ' · `why` 没点到任何具体实体（数字 / 文件路径 / 对端卡 id）：' +
        JSON.stringify(why),
    );
  }

  // ── 门 2：「读全」的机械证据（交集文件逐个顶层符号表态）──
  for (const c of i?.coverage ?? []) {
    if (!c || typeof c !== 'object') continue;
    const gaps = c.gaps ?? [];
    if (!gaps.length) continue;
    errors.push(
      DISSENT_CODES.coverage +
        ' · 交集文件 `' +
        String(c.file ?? '') +
        '` 还没通读（有顶层符号没在画布 `entries` / `untouched` 里表态）：' +
        gaps.join(' / '),
    );
  }

  // ── 门 3：judgements 逐条成立 + 覆盖对端卡全部判据 ──
  const listed = Array.isArray(o.judgements) ? (o.judgements as unknown[]) : null;
  /**
   * ★ 2026-10-30：**只有 `void` 卡**允许不表态（它的判据已作废，门 1 已经要了 `cites_voided`）。
   * ★ `done` 卡**不许**省 —— 它的判据仍然算数（"上一轮做完了" ≠ "这套设计作废了"）；
   *   省了就等于让"我懒得读 5 条"伪装成"它已经废弃"。
   */
  const voidSkipped = peerVoid && (!listed || listed.length === 0);
  if (voidSkipped) {
    // 门 1 已要求 `cites_voided`（引用即替代逐条表态）⇒ 这里不重复要求 judgements
  } else if (!listed) {
    errors.push(DISSENT_CODES.judgements + ' · `judgements` 必须是数组（逐条对**对端卡上的判据**表态）');
  } else if (!listed.length) {
    errors.push(DISSENT_CODES.judgements + ' · `judgements` 是空数组 ⇒ 一条对端判据都没表态');
  } else {
    listed.forEach((x, idx) => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) {
        errors.push(DISSENT_CODES.judgements + ' · judgements[' + String(idx) + '] 必须是 {ref, verdict, why}');
        return;
      }
      const j = x as Record<string, unknown>;
      const ref = normText(j.ref);
      const verdict = normText(j.verdict);
      const jwhy = normText(j.why);
      const at = 'judgements[' + String(idx) + ']';
      if (!ref) errors.push(DISSENT_CODES.judgements + ' · ' + at + ' 缺 `ref`（要指到对端卡的哪一条判据）');
      if (!VERDICTS.includes(verdict)) {
        errors.push(
          DISSENT_CODES.judgements +
            ' · ' +
            at +
            '.verdict = ' +
            JSON.stringify(j.verdict) +
            ' 非法（只认 `仍成立` / `被推翻` —— 判不出的东西不是表态）',
        );
      }
      if (!jwhy) {
        errors.push(DISSENT_CODES.judgements + ' · ' + at + ' 缺 `why`');
      } else if (!hasConcreteEntity(jwhy, [against])) {
        errors.push(
          DISSENT_CODES.judgements +
            ' · ' +
            at +
            '.why 没点到任何具体实体（数字 / 文件路径 / 对端卡 id）：' +
            JSON.stringify(jwhy),
        );
      }
    });
    const peer = (i?.peer_judgements ?? []).filter((r) => normText(r));
    if (peer.length) {
      const said = new Set<string>();
      for (const x of listed) {
        const ref = normText((x as Record<string, unknown> | null)?.ref);
        if (ref) said.add(ref);
      }
      const missing = peer.filter((r) => !said.has(r));
      if (missing.length) {
        errors.push(
          DISSENT_CODES.judgements +
            ' · 未覆盖 ' +
            String(missing.length) +
            ' 条对端判据（对端卡共 ' +
            String(peer.length) +
            ' 条）：' +
            missing.join('、'),
        );
      }
    }
  }
  return { ok: !errors.length, errors };
}

/**
 * **合并后整体重跑**（本卡的第二半：不是两张卡各自收口就完事）。
 *
 * 用户点名的失效模式：**「各自都对、合起来不对」** —— 两张卡各自红→绿，合起来编译不过 / 判据互相抵消。
 * ⇒ 带 `supersedes` 的卡 `complete` 时，`evidence` 必须包含**合并后整册读数**（`command` + `observed`），
 * 其中 `observed` 要含 `design_line action=judge` 的条数与 fail 数，**且 fail 必须只剩既有那一条**
 * （`gen_design_db.ts` 的陈旧 `source-has`，见 `docs/SUBAGENT-HANDBOOK.md §8`）。
 *
 * @returns `{ok, errors}`；不过 ⇒ `E-TASK-008`（收口被拒）
 */
export function validateMergedReading(r: MergedReadingInput | null | undefined): DissentVerdict {
  const errors: string[] = [];
  const command = normText(r?.command);
  const observed = normText(r?.observed);
  if (!command) {
    errors.push(DISSENT_CODES.merged + ' · 收口证据缺 `command`（合并后整册 judge 的**命令原文**）');
  } else if (!/design_line/i.test(command) || !/judge/i.test(command)) {
    errors.push(
      DISSENT_CODES.merged +
        ' · `command` 不含 `design_line … action=judge`：' +
        JSON.stringify(command) +
        '（要的是整册判据批，不是单条判据）',
    );
  }
  if (!observed) {
    errors.push(DISSENT_CODES.merged + ' · 收口证据缺 `observed`（**读数原文**：N pass / M fail）');
  } else {
    const pass = PASS_RE.exec(observed);
    const fail = FAIL_RE.exec(observed);
    if (!pass || !fail) {
      errors.push(
        DISSENT_CODES.merged +
          ' · `observed` 里读不到「N pass / M fail」⇒ 说不出合并后整册的红绿：' +
          JSON.stringify(observed),
      );
    } else {
      const nFail = Number(fail[1]);
      const nPass = Number(pass[1]);
      if (nPass + nFail <= 0) {
        errors.push(DISSENT_CODES.merged + ' · `observed` 的条数是 0 ⇒ 那不是一次读数');
      }
      // ★ 2026-11-03（卡 1.1 收口实测）：旧判据把「昨天 judge 的存量红（fail=1 且是
      //   gen_design_db.ts）」硬编码成永真假设 —— 存量红被修掉 ⇒ fail=0（更健康）反而被拒
      //   （0.16 的镜像：判据范围比健康范围小）。语义改准：「fail 不许比基线多」（不许有新红）；
      //   有 fail 时须点名 fail 的归属（谁红点谁），不再点名 gen_design_db 专属。
      if (nFail > 1) {
        errors.push(
          DISSENT_CODES.merged +
            ' · 合并后整册 judge 的 fail = ' +
            String(nFail) +
            ' 条 ⇒ 不许比基线多（新增红说明两张卡合起来坏了；fail=0/1 均可 —— 0 = 比基线更健康）',
        );
      }
      if (nFail >= 1 && !/gen_design_db\.ts/.test(observed) && !/fail[^\n]{0,80}(归属|点名|既有|存量)/.test(observed)) {
        errors.push(
          DISSENT_CODES.merged +
            ' · 有 fail 时必须在 observed 里点名 fail 的归属（哪条、属谁的存量红）—— 谁红点谁，不许无主红',
        );
      }
    }
  }
  return { ok: !errors.length, errors };
}

/**
 * 通过后的**回执行**（唯一住处：`claim` 与回执都读它，不许在 task_ops 再拼一份文案）。
 *
 * ★★ 两种形态（由 `from` 是否出现决定，**判据同一套**）：
 * · 不给 `from` ⇒ **改集相交**那一档：`；异议领卡 = 推翻 <对端卡> 的 N 条判据（改集相交 S 个符号 · 已通读 K 个文件）`
 * · 给了 `from` ⇒ **卡级接管**那一档（2026-10-30 本卡）：`against` 就是正在被领的这张卡自己，
 *   `；异议接管 = 从 <原 owner> 接过 <卡id>：推翻其 N 条判据（已通读 K 个文件）`
 *   —— 这一档没有"两个改集求交"，改集就是这张卡自己的画布坍缩集 ⇒ 不渲染符号数（渲染 0 个符号只会误导）。
 */
export function dissentReceiptLine(a: {
  against: string;
  judgements: number;
  symbols: number;
  files: number;
  /** ★ 卡级接管：**原 owner**（给了它 = 换手形态；`null` ⇒ 原来无主，照样如实渲染） */
  from?: string | null;
}): string {
  if (a.from !== undefined) {
    return (
      '；异议接管 = 从 ' +
      String(a.from ?? '（空）') +
      ' 接过 ' +
      String(a.against) +
      '：推翻其 ' +
      String(a.judgements) +
      ' 条判据（已通读 ' +
      String(a.files) +
      ' 个文件）'
    );
  }
  return (
    '；异议领卡 = 推翻 ' +
    String(a.against) +
    ' 的 ' +
    String(a.judgements) +
    ' 条判据（改集相交 ' +
    String(a.symbols) +
    ' 个符号 · 已通读 ' +
    String(a.files) +
    ' 个文件）'
  );
}

/**
 * ★★★ **租约接管的回执行**（唯一住处 · 2026-10-30）：`claim` 遇到"租约已过期的 claimed 卡"时读它。
 *
 * ★ 与 `dissentReceiptLine` **不是同一件事**：那个回答"我在推翻谁"，这个回答"**我接手了一份还算数的设计**"——
 *   区别在语义分档（用户裁定：租约过期只说明"没人握笔"，不说明"这套设计作废了"）：
 *   · `compatible`（兼容）：`judgements` **全部"仍成立"** ⇒ 我只是把它没做完的做完，不改它的任何结论；
 *   · `rewrite`（改写）：**有任意一条"被推翻"** ⇒ 我改了它的结论（`scope_change` 必填，见 `claimTask`）。
 *
 * @param a.heartbeat_min 上次心跳距今多少**分钟**（判不了 ⇒ `null`，如实写"判不了"，不编一个 0）
 * @param a.ttl_min TTL 的**分钟**读数（★ 只在这里渲染数字：TTL 的唯一取值处仍是 `task_machine.ts#LEASE_TTL_MS`）
 */
export function leaseTakeoverLine(a: {
  mode: 'compatible' | 'rewrite';
  from?: string | null;
  judgements: number;
  refuted: number;
  heartbeat_min: number | null;
  ttl_min: number;
}): string {
  const hb = a.heartbeat_min === null ? '上次心跳判不了' : '上次心跳 ' + String(a.heartbeat_min) + ' 分钟前';
  if (a.mode === 'compatible') {
    return '；租约接管（兼容）= 从 ' + String(a.from ?? '（空）') + ' 接过，其 ' + String(a.judgements) + ' 条判据全部仍成立（' + hb + '，TTL ' + String(a.ttl_min) + ' 分钟）';
  }
  return '；租约接管（改写）= 推翻其 ' + String(a.refuted) + ' / ' + String(a.judgements) + ' 条判据（' + hb + '，TTL ' + String(a.ttl_min) + ' 分钟）';
}
