/**
 * complete_canvas_gate.ts —— **收口前的画布停止条件**（`docs/PROJECT-DESIGN.md` §7.3 四件输入里的**前两件**）。
 *
 * ## 它是什么（一段话）
 * §7.3（`docs/PROJECT-DESIGN.md:493` 逐字；§9.5.5 第 2 条「接入计划与核销」见 `:623`）要求 `complete` 的输入必须齐：① `checkRewriteExit` 的结构与计划外改动、
 * ② 每个 `judgement_ref` 的真实判定、③ 当前事实可信性、④ 未决决定清单。本模块只把 ① ② 变成**可判的结论**：
 * 吃一张卡名下全部画布的读数（判据现判 + 出口闭环），逐条判「能不能收口」，产出两类结论 ——
 * **拒的理由**（`refusals`，每条点名到 `文件#符号 [verdict] ref —— detail`）与
 * **为什么这一条不拒**（`notes`，报白）。
 *
 * ## 为什么判定是纯核、取数是胶水
 * 取数住 `application/design/dsl_ops/task_ops.ts#completeTask`（`plansOfCard` → `runPlanJudgements` →
 * `checkRewriteExit(root, file, {cardId})`），判定住这里。分开的理由：判定要能被 `behavior-cases`
 * **直接喂输入比输出**（`AGENTS.md` §二：读数是日志，判据只回答通过/不通过）；混在一起就只能"改源码看看红不红"。
 *
 * ## ★★ 三分判据（每一分都能单独红 —— `tests/p0_complete_canvas_gate.test.ts` 逐条钉住）
 *
 * **拒（refusal）—— 只有三种正读**：
 *   · **J**：某条 `judgement_ref` 的现判 ≠ `pass`（`fail` / `unsupported` / `pending` / `unresolved` 全算）——
 *     §7.3 原话「任一输入缺失或含 fail/unsupported/pending/未解释计划外改动，结论为不可核销」；
 *     `unresolved` 是"这条引用根本没有执行核" ⇒ **判不了 ≠ 通过**。
 *   · **E1**：`stale_anchor` **且** 该符号在画布的 `fps_at_freeze` 里 —— 冻结时它真是顶层符号，
 *     现在索引里没有了 ⇒ 计划过期（符号被改名 / 删除 / 拼错），先核对再改。
 *   · **E2**：`kind:'delete'` 的条目没被 `realized` —— 计划要删的符号还在。
 *   · **E3**：`changed_unplanned` 非空 —— 改了、但计划里没有（§7.3「有本次计划外改动未解释」）。
 *
 * **报白（note，不拒）—— 每一类都必须说清"为什么它不构成本闸的拒"**：
 *   · `not_yet`：`write_gate#finishWriteThrough`（`src/application/write_gate.ts:452-458`）**每次写盘后把
 *     `base.content_hash` 挪到写后** ⇒ 收口那一刻「自冻结以来变过吗」恒为 false。★ 按它拒 = 几乎无卡能收口
 *     （2026-11-07 实测：全库 240 份画布 491 条 entry 里 **366 条**是 not_yet）。
 *   · **标签锚的 `stale_anchor`**：`fps_at_freeze` 里没有它 ⇒ 冻结时它**不是**顶层符号（画布允许
 *     `anchor.symbol` 写"JSON 键 / 测试里的段落标签"，如 `scripts/write-log-baseline.json#rows`、
 *     `tests/p0_shell_injection.test.ts#CI-A5`）⇒ 本闸不判它。
 *     ★ 2026-11-07 实测：全库 45 条 stale 里 **44 条是标签锚**，只有 1 条冻结时真是符号（且已消解）
 *     ⇒ 「凡 stale 就拒」会把一张正在 claimed 的卡**永远关在可收口范围之外**（那是"假绿"的镜像形态）。
 *   · `unplanned`：它是"没表态"（`untouched` 没写），不是"动了却没计划"（实测 52/240 份画布非空）。
 *   · `unjudgeable` / `error`（索引不可用 / 文件不存在而条目全是 delete）：**判不了 ⇒ 不拒**，但逐条点名。
 *
 * **异常（判不了 ≠ 通过）**：取数阶段任何异常由调用方包成 `collect_error` ⇒ **拒**（不静默放行）。
 *
 * ## ★ 边界（诚实清单 —— 不许在交付里含糊）
 * · 本闸**只碰有画布的卡**：2026-11-07 实测本仓 86 张活卡里**只有 14 张有画布** ⇒ 它天然只审这 14 张。
 *   这是它的**护栏**，也是它的**边界** —— 别以为它管了 86 张（`plansOfCard` 对没画布的卡返回空数组，本闸如实放行）。
 * · `runPlanJudgements` 此前只在 `design/index.ts:836`（`action=plan` 的**只读**分支，`if (!given && …)`）跑，
 *   **写模式缺省不跑** ⇒ 「只读路径跑过」**不等于**「真实交付跑过」。本闸把它接进收口这条路。
 */

/**
 * ★★★ **`complete` 的输入覆盖率**（`docs/PROJECT-DESIGN.md:488` 的四件输入）。
 *
 * ★ 逐字保留编号，且**每条都指名"接通 / 未接通"** —— 这张卡只接通前两件，
 *   `tests/p0_complete_canvas_gate.test.ts` 断言这份清单非空且逐条关键词都在（**删一条会红**）。
 * ★ 为什么它是常量而不是散文：散文会腐，而"今天到底接通了几件"是**下一张卡的前提**。
 */
export const COMPLETE_CANVAS_GATE_SCOPE: readonly string[] = [
  '① 已接通 · `checkRewriteExit` 的结构与计划外改动（锚点过期 / delete 未落地 / 改了却没计划）',
  '② 已接通 · 每个 `judgement_ref` 的真实判定（`runPlanJudgements` 现跑；不是读缓存、不是看 `status`）',
  '③ 未接通 · 当前事实可信性（今天只在 L2 卡上经 `cardStanding` 的 `unsupported ⇒ unknowable` **间接**成立；' +
    'L1 / todo 卡没有判据 ⇒ 无闸）',
  '④ 未接通 · 未决决定清单（`dissent` / 开放决定没有读端）',
];

/** 一条 `judgement_ref` 的现判事实（来自 `application/design/db/judgement_run.ts#runPlanJudgements`） */
export interface CanvasGateJudgementFact {
  /** 条目锚点符号；没有锚点（文件级工作项）⇒ `null` */
  symbol?: string | null;
  judgement_ref: string;
  /** `pass` / `fail` / `unsupported` / `pending` / `unresolved`（四态 + "没有执行核"） */
  verdict: string;
  detail?: string | null;
}

/** 出口闭环的一条 entry 读数（来自 `application/design/db/plan_exit_check.ts#checkRewriteExit`） */
export interface CanvasGateExitEntryFact {
  kind?: string | null;
  symbol?: string | null;
  /** `realized` / `not_yet` / `stale_anchor` / `unjudgeable` */
  verdict: string;
}

/** 一份画布的出口闭环读数 */
export interface CanvasGateExitFact {
  file: string;
  /** `checkRewriteExit` 自己如实标的"判不了"原因（索引不可用 / 文件不存在 / 没有画布） */
  error?: string | null;
  entries: CanvasGateExitEntryFact[];
  /** 改了、但计划里没有的符号（`fps_at_freeze` 记过、现在 `body_hash` 变了、且不在 plannedAnchors 里） */
  changed_unplanned: string[];
  /** 计划之外、**没表态**的符号（没写进 entries / untouched / untouched_default）—— 报白用 */
  unplanned?: string[];
  /** 冻结时每个顶层符号的 `body_hash`（判"冻结时它到底是不是符号"的唯一依据） */
  fps_at_freeze?: Record<string, string> | null;
}

/** 一张卡名下**一份**画布的全部读数 */
export interface CanvasGateRowFact {
  file: string;
  /** 已软消解 ⇒ 这一段已落地，不参与收口判定（与 `changeSetOfCard` 的 judgements 口径一致） */
  dissolved_at?: string | null;
  judgements: CanvasGateJudgementFact[];
  exit: CanvasGateExitFact | null;
  /** 取数阶段就炸了（册读不了 / 判据跑不了 / 出口闭环炸了）⇒ 判不了（≠ 通过） */
  collect_error?: string | null;
}

/** 判定结论：拒什么、报白什么、看过了多少 */
export interface CanvasGateVerdict {
  /** 拒的理由（每条自足：文件#符号 [verdict] ref —— detail） */
  refusals: string[];
  /** 报白（每条都带"为什么它不拒"） */
  notes: string[];
  checked: {
    /** 参与判定的画布行数（已消解的不算） */
    rows: number;
    /** 现判过的 `judgement_ref` 条数 */
    judgements: number;
    /** 有出口读数的文件数 */
    exit_files: number;
    /** 跳过的已消解画布行数 */
    dissolved: number;
  };
}

/** 一条判据"不拒"的理由：`stale_anchor` 是不是"冻结时真是符号" */
function staleIsRealSymbol(exit: CanvasGateExitFact, symbol: string): boolean {
  const fps = exit.fps_at_freeze ?? null;
  if (!fps) return false; // 没记冻结指纹 ⇒ 判不出它当初是不是符号 ⇒ 不算"真过期"
  return Object.prototype.hasOwnProperty.call(fps, symbol);
}

/** 一行判据读数（回执用：`文件#符号 [verdict]`） */
function who(file: string, symbol: string | null | undefined): string {
  const s = String(symbol ?? '').trim();
  return s ? `${file}#${s}` : `${file}#(文件级工作项)`;
}

/**
 * ★★★ **判「这张卡能不能收口」**（纯函数：同一输入两次结果逐字相同，无 IO、无时间、无随机）。
 *
 * @param rows 该卡名下**全部**画布行的读数（`plansOfCard` 的顺序；已消解行会被跳过并计入 `checked.dissolved`）
 * @returns `refusals` 非空 ⇒ **不能收口**（调用方必须拒，并把每条理由原样点名）
 */
export function evaluateCompleteCanvasGate(rows: readonly CanvasGateRowFact[]): CanvasGateVerdict {
  const refusals: string[] = [];
  const notes: string[] = [];
  const checked: CanvasGateVerdict['checked'] = { rows: 0, judgements: 0, exit_files: 0, dissolved: 0 };

  for (const row of rows) {
    if (row.dissolved_at) {
      checked.dissolved++;
      notes.push(`${row.file}：画布已软消解（${row.dissolved_at}）⇒ 这一段已落地，不参与收口判定`);
      continue;
    }
    checked.rows++;

    // ── 取数阶段炸了 ⇒ 判不了（≠ 通过），**不许放行** ───────────────────────
    if (row.collect_error) {
      refusals.push(`${row.file}：判不了（≠ 通过）—— ${row.collect_error}`);
      continue;
    }

    // ── J：每条 judgement_ref 的**真实判定**（不是缓存、不是 status）────────────
    for (const j of row.judgements) {
      checked.judgements++;
      if (j.verdict === 'pass') continue;
      const d = String(j.detail ?? '').replace(/\n/g, ' ').slice(0, 180);
      refusals.push(
        `${who(row.file, j.symbol)} [${j.verdict}] ${j.judgement_ref} —— ${d || '(判据器没给明细)'}`,
      );
    }

    // ── E：出口闭环（结构与计划外）──────────────────────────────────────
    const exit = row.exit;
    if (!exit) {
      notes.push(`${row.file}：没有出口读数 ⇒ 本闸不拒（★ 不等于通过：这一格今天没判）`);
      continue;
    }
    checked.exit_files++;

    const err = String(exit.error ?? '');
    if (err) {
      if (err.includes('索引不可用')) {
        notes.push(`${row.file}：出口闭环判不了（${err}）⇒ 本闸不拒（★ 不等于通过；先 \`index_integrity refresh:true\`）`);
      } else if (err.includes('没有画布')) {
        notes.push(`${row.file}：出口闭环说没有画布（${err}）⇒ 本闸不拒（画布行是本闸自己枚举出来的，此条自相矛盾，如实报）`);
      } else if (err.includes('源码文件不存在')) {
        const nonDelete = exit.entries.filter((e) => e.kind !== 'delete');
        if (nonDelete.length) {
          refusals.push(
            `${row.file}：源码文件不存在，而计划里有 ${nonDelete.length} 条非 delete 条目` +
              `（${nonDelete.slice(0, 4).map((e) => e.symbol ?? '(无 anchor)').join(', ')}）⇒ 结构与计划对不上`,
          );
        } else {
          notes.push(`${row.file}：源码文件不存在，计划条目全是 delete ⇒ 本闸不拒（${err}）`);
        }
      } else {
        refusals.push(`${row.file}：出口闭环判不了（${err}）⇒ 判不了 ≠ 通过`);
      }
    }

    for (const e of exit.entries) {
      const sym = String(e.symbol ?? '').trim();
      if (e.kind === 'delete') {
        if (e.verdict !== 'realized') {
          refusals.push(`${who(row.file, sym)} [${e.verdict}] 计划要删的符号还在（delete 未落地）`);
        }
        continue;
      }
      if (e.verdict === 'stale_anchor') {
        if (staleIsRealSymbol(exit, sym)) {
          refusals.push(
            `${who(row.file, sym)} [stale_anchor] 冻结时它**是**顶层符号（在 \`fps_at_freeze\` 里），现在索引里没有了` +
              ` ⇒ 计划过期（符号被改名 / 删除 / 拼错），先核对再改`,
          );
        } else {
          notes.push(
            `${who(row.file, sym)} [stale_anchor] 冻结时它**不是**顶层符号（标签锚：\`fps_at_freeze\` 里没有它）` +
              ` ⇒ 本闸不判它（索引只收可解析源文件的顶层符号）`,
          );
        }
        continue;
      }
      if (e.verdict === 'not_yet') {
        notes.push(
          `${who(row.file, sym)} [not_yet] 文件自「最后一次写穿」以来没变（\`finishWriteThrough\` 会把基线挪到写后）` +
            ` ⇒ 本闸不拒（★ 不等于通过：这条只说明哈希没动）`,
        );
        continue;
      }
      if (e.verdict === 'unjudgeable') {
        notes.push(`${who(row.file, sym)} [unjudgeable] 锚点存在性判不了 ⇒ 本闸不拒（★ 不等于通过）`);
      }
    }

    if (exit.changed_unplanned.length) {
      refusals.push(
        `${row.file}：计划外改动 ${exit.changed_unplanned.length} 个（改了却没计划）：` +
          `${exit.changed_unplanned.slice(0, 8).join(', ')}${exit.changed_unplanned.length > 8 ? ' …' : ''}`,
      );
    }
    const unplanned = exit.unplanned ?? [];
    if (unplanned.length) {
      notes.push(
        `${row.file}：${unplanned.length} 个符号没表态（\`unplanned\` = 没写进 entries / untouched，**不是**"动了却没计划"）` +
          ` ⇒ 本闸不拒`,
      );
    }
  }

  return { refusals, notes, checked };
}

/**
 * 一行回执（★ 拒的时候**点名到判据/文件**，不许只说"不能 complete" —— `docs/PITFALLS.md` P35）。
 * @param maxNotes 报白最多印几条（缺省 6；其余折叠成"另有 N 条"，**不静默丢弃**）
 */
export function renderCanvasGate(v: CanvasGateVerdict, maxNotes = 6): string {
  const c =
    `画布停止条件：${v.checked.rows} 份未消解画布 · ${v.checked.judgements} 条 judgement_ref 现判 · ` +
    `${v.checked.exit_files} 个文件有出口读数` +
    (v.checked.dissolved ? ` · 跳过已消解 ${v.checked.dissolved} 份` : '');
  if (!v.refusals.length) return `${c} · 无拒（报白 ${v.notes.length} 条）`;
  const head = `${c} · ★ 拒 ${v.refusals.length} 条：`;
  const body = v.refusals.slice(0, 8).map((r) => `   ✗ ${r}`).join('\n');
  const more = v.refusals.length > 8 ? `\n   …另有 ${v.refusals.length - 8} 条` : '';
  const white = v.notes.length
    ? `\n   报白 ${v.notes.length} 条（**不构成本闸的拒**）：` +
      v.notes.slice(0, maxNotes).map((n) => `\n   · ${n}`).join('') +
      (v.notes.length > maxNotes ? `\n   …另有 ${v.notes.length - maxNotes} 条` : '')
    : '';
  return `${head}\n${body}${more}${white}`;
}
