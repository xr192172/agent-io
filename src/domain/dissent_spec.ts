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
  /** 我会改掉 / 替换什么（可选，给人读） */
  scope_change?: string;
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
  if (!against || !why || !Array.isArray(o.judgements)) return null;
  const judgements: DissentJudgement[] = [];
  for (const x of o.judgements as unknown[]) {
    const j = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    judgements.push({
      ref: normText(j.ref),
      verdict: normText(j.verdict) as DissentJudgement['verdict'],
      why: normText(j.why),
    });
  }
  const scope = normText(o.scope_change);
  return { against, why, judgements, ...(scope ? { scope_change: scope } : {}) };
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

  // ── 门 1：against 必须是**同项目根下 state=claimed** 的卡 ──
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
  } else if (i.against.state !== 'claimed') {
    errors.push(
      DISSENT_CODES.claimShape +
        ' · `against:' +
        against +
        '` 的 state=' +
        String(i.against.state ?? '(空)') +
        ' ⇒ 只有 state=claimed 的卡才占位（done/void/candidate 不占位，也就不需要异议）',
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
  if (!listed) {
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
      if (nFail !== 1) {
        errors.push(
          DISSENT_CODES.merged +
            ' · 合并后整册 judge 的 fail = ' +
            String(nFail) +
            ' 条 ⇒ 必须**只剩既有那 1 条**（fail 不增是硬要求；新增红说明两张卡合起来坏了）',
        );
      }
      if (!/gen_design_db\.ts/.test(observed)) {
        errors.push(
          DISSENT_CODES.merged +
            ' · 那唯一一条 fail 必须点名 `gen_design_db.ts`（既有陈旧红）—— 换成了别的红说明合并引入了新问题',
        );
      }
    }
  }
  return { ok: !errors.length, errors };
}

/** 通过后的**回执行**（唯一住处：`claim` 与回执都读它，不许在 task_ops 再拼一份文案） */
export function dissentReceiptLine(a: {
  against: string;
  judgements: number;
  symbols: number;
  files: number;
}): string {
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
