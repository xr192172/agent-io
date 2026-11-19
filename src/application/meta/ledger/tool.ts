/**
 * ledger 工具 —— 台账引擎（`application/ledger/ledger.ts`）的**唯一工具面**：单工具 + `action` 枚举。
 *
 * ## 为什么是这一种形态（FACE-STABILITY 裁定，2026-11-17 ~ 11-18）
 * 台账引擎有 13 个导出、10 条能力动作。摊成 10 个工具 = 工具面 +10（每个请求把 10 段描述重付一遍）。
 * 裁定形态：**一个 `ledger` 工具 + `action` 枚举**，每个 action **直映一个引擎 API**
 * （纯透传 + 参数校验，一句业务判断都不写）。出处：`T-#FACE-STABILITY` §I（工具面原则：面该变就变，
 * 但变化走**有意识通道**）+ `¶§I#581`（读面 `get_dsl query=ledger`；**写面新 `ledger` 工具，meta lane，
 * +2-4KB，走有意识 `mcp_scan --update`** —— diff 在评审里现形）。
 *
 * ## 为什么这面必须存在（R53 族实证：引擎 API 有、工具面零）
 * `closeRow` / `reopenRow` 从 L1 就在（`ledger.ts:447 / :471`），而**全仓零工具面**
 * ⇒ 模型只能"在批注里说已落地"。实测后果（`T-#LEDGER-STATE-HYGIENE`，2026-11-18）：
 * 台账 task 行 **315 条全 active**，含已完成的 —— 销账一直用**批注**代替 `closeRow` 的**状态翻转**。
 * ⇒ 本工具的**核心动作是 `close`（销账 = 状态翻转）**，不是 `annotate`；这条语义写进
 * `description`（模型读的那一面），不只在注释里。
 *
 * ## `writes: false`（写闸口径，实测过 —— 不是抄来的）
 * 7 个写动作写的是 **`tasks.db` 的 `ledger_rows` / `ledger_events` / `ledger_review_queue`**，
 * **不是设计册**（`design/<f>.dsl.json`）⇒ 一次 `saveDSL` 都不调 ⇒ 写闸（`assertDslWriteAllowed`）
 * 根本不在这条路径上 ⇒ `ToolDef.writes` = **false**（口径：writes 只回答"是否经 saveDSL 写设计册"）。
 * ★ 反向也有牙：若有人让 `ledger` 拿 `via:'tool'` 去 `saveDSL`，闸会**点名拒绝**
 *   （`storage.ts:1316-1328`）—— `tests/p1_ledger_tool.test.ts` 有一条用例钉住这个方向
 *   （防止把 ledger 当洗白设计册的通道），并带**消融**（把声明改成 true ⇒ 同一次写就放行）。
 *
 * ## 不变量（改这个文件时不许丢）
 * ① **每个 action 只做三件事**：校验参数形状 → 调那一个引擎函数 → 翻成 `{message,data}`。
 *   语义判定（闭集 / 必填 / 活跃唯一 / append-only 触发器）**全部留在引擎**；本文件的 `as`
 *   只是把 zod 的窄类型接过去，不是新的判定（运行期仍由引擎 / DB 抛）。
 * ② 读动作**必须同时给 `availability`**：`rows: []` 同时表示"0 条"与"读不到"（0.12 老病）
 *   ⇒ `list` / `get` 带 `ledgerAvailability()`，`review_queue` 带 `readReviewQueue()` 的五态。
 * ③ 拒绝报文**逐字来自引擎**（「没有活跃挂账行」「已在活跃期挂账」「body 必填（不许空串）」…）
 *   —— 一旦本文件开始自己组织这些话，它就变成了"第二份判定"，测试里有一条反向用例会红。
 */
import { z } from 'zod';
import {
  annotateRow,
  closeRow,
  getRow,
  hangRow,
  ledgerAvailability,
  listActive,
  readReviewQueue,
  reopenRow,
  resolveReview,
  subjectConflicts,
  supersedeRow,
  writeVerdict,
  type LedgerRecordKind,
  type LedgerSubject,
  type ReviewReason,
} from '../../ledger/ledger.js';
// ★ 项目根**不兜底 cwd**（`requireProjectRoot` 的唯一口径：给了就用、没给就抛并说明为什么不用 cwd）。
import { requireProjectRoot } from '../../../infrastructure/storage.js';
import { optionalBool, optionalNum, optionalStr, requireStr } from '../../plumbing.js';

// ★ 2026-11-19（延迟簇 A）：工具面常量已搬到零依赖叶子 `tool_schema.ts`（元数据不许拖实现图）。
//   handler 仍要用的两个（动作闭集 / 行种类枚举）照旧 import；公开 API 经 re-export 不变。
import { LEDGER_ACTIONS, RECORD_KINDS, LEDGER_INPUT_SCHEMA, LEDGER_TOOL_DESCRIPTION, type LedgerAction } from './tool_schema.js';
export { LEDGER_ACTIONS, LEDGER_INPUT_SCHEMA, LEDGER_TOOL_DESCRIPTION, type LedgerAction };


/**
 * ★★★ 2026-11-18（二席驳斥 #1 · origin 后门）：**工具面只许造 `engine` 行**。
 * `origin='import'` 的行**只能由 importer 产生**（`ledger.ts#insertLedgerRow` 的导入侧）；
 * 让外部调用方也能声明 import ⇒ 它造出来的行**豁免 `ledger_rows_active_subject` 部分唯一索引**
 * ⇒ 同一个 subject 上可以并存无数条"活跃账"= 把「写入时打回」这道约束整条绕掉。
 * ⇒ ① schema **不再声明 `origin`**（调用方在 `tools/list` 上都看不见这个键）；
 *    ② handler 收到任何非 `engine` 的 `origin` ⇒ **当场抛**（绕过 zod / 直调 / CLI 都拦得住）。
 *    ★ 两条都要：只删 schema 不够 —— schema 是 loose object（未知键保留），键仍在 `handler` 的眼里。
 */
const ORIGIN_ENGINE_ONLY = 'engine';

/** 动作闭集校验（形状错 / 名字错 ⇒ 当场抛，并列出全部合法值） */
function actionOf(a: Record<string, unknown>): LedgerAction {
  const raw = requireStr(a, 'action');
  if (!(LEDGER_ACTIONS as readonly string[]).includes(raw)) {
    throw new Error(
      `未知 action "${raw}"：台账只有这 ${LEDGER_ACTIONS.length} 个动作 —— ${LEDGER_ACTIONS.join(' / ')}` +
        '（每个直映一个引擎 API；没有别的隐藏动作）。',
    );
  }
  return raw as LedgerAction;
}

/** 关系锚点：给了 `subject_path` 才算有锚点；`subject_symbol` 单给是**说错话**（不是"没给"） */
function subjectOf(a: Record<string, unknown>): LedgerSubject | null {
  const p = optionalStr(a, 'subject_path');
  const s = optionalStr(a, 'subject_symbol');
  if (p === undefined || p === '') {
    if (s !== undefined && s !== '') {
      throw new Error('参数 "subject_symbol" 必须与 "subject_path" 一起给（锚点 = 路径#符号；单给符号指不到东西）');
    }
    return null;
  }
  return { path: p, symbol: s === undefined || s === '' ? null : s };
}

/**
 * `origin` 的**唯一闸**（二席驳斥 #1）：只接受 `engine`（缺省 = engine），其余**当场抛**。
 * ★ 为什么不能"静默改写成 engine"：调用方给了 `origin:'import'` 却被当成没给 ——
 *   「说了不算」比报错更难查（本仓 2.3 的典型形态）。宁可拒，也不猜。
 */
function originGuardOf(a: Record<string, unknown>): 'engine' {
  const v = optionalStr(a, 'origin');
  if (v === undefined) return ORIGIN_ENGINE_ONLY;
  if (v !== ORIGIN_ENGINE_ONLY) {
    throw new Error(
      `参数 "origin" 只接受 engine（收到 "${v}"）—— 工具面**只能造 engine 行**。\n` +
        "★ 理由（不是洁癖）：`origin='import'` 的行**豁免** `ledger_rows_active_subject` 部分唯一索引，" +
        '只有 importer 该产生它；外部调用方能造 import 行 = 把「同一 subject 只许一条活跃账」整条绕掉。\n' +
        '★ 出路：要挂账就正常 `hang`（engine 行，受约束）；存量迁移请跑 importer（`application/ledger/importer.ts`）。',
    );
  }
  return ORIGIN_ENGINE_ONLY;
}

/**
 * `close` 的**非阻断 precheck**（二席驳斥 #4）：把"你可能销错东西"的两件事端上来，但**不拦**。
 * ★ 为什么不拦：被取代的旧账**确实可以**销（"旧账收口 + 由新账继续"是正常姿势）、留有待人工项的账
 *   也**确实可能**现在就销（项是"机器判不了"，不是"不能收口"）。拦下来就是替调用方做判断。
 * ★ 为什么要有：这两件事在**回执之外**看不见（`closeRow` 只回 event seq），而它们的代价都是"销错了"。
 * ★ 判不了时（队列读不到 / 行不存在）**如实说判不了**，不静默当"没问题"（0.12）。
 */
function closePrecheckOf(projectRoot: string, refId: string): string[] {
  const out: string[] = [];
  const row = getRow(projectRoot, refId);
  if (!row) return out; // 没这行 ⇒ 判定交给 `closeRow` 抛（引擎原文），precheck 不抢它的话
  if (row.superseded_by) {
    out.push(
      `这一行已被 **${row.superseded_by}** 取代（superseded_by）—— 销账照办，但请确认你要收的是**旧账**；` +
        `若该收的是新账，销的是 ${row.superseded_by}。`,
    );
  }
  const queue = readReviewQueue(projectRoot, { openOnly: true });
  if (queue.availability === 'ok') {
    const mine = queue.items.filter((x) => x.ref_id === refId);
    if (mine.length) {
      out.push(
        `这一行在待人工队列里还有 **${mine.length} 条未消项**（` +
          mine
            .slice(0, 5)
            .map((x) => `#${x.id}[${x.reason}]`)
            .join(' · ') +
          `）—— 销账**不消项**，队列项要单独 action=resolve_review。`,
      );
    }
  } else if (queue.availability === 'error') {
    out.push(`待人工队列**读不到**（error：${String(queue.error ?? '').slice(0, 80)}）⇒ 本次没做"未消项"检查（判不了 ≠ 没有）。`);
  }
  return out;
}

/** `record_kind` 的形状闸（`all` 只对 list 有意义 —— 挂账必须落到一个具体 kind） */
function recordKindOf(a: Record<string, unknown>, forList: boolean): LedgerRecordKind | 'all' | undefined {
  const v = optionalStr(a, 'record_kind');
  if (v === undefined) return undefined;
  const allowed: readonly string[] = forList ? [...RECORD_KINDS, 'all'] : [...RECORD_KINDS];
  if (!allowed.includes(v)) {
    throw new Error(
      `参数 "record_kind" 只接受 ${allowed.join(' / ')}（收到 "${v}"）` +
        (forList ? '；all = 不按 kind 过滤（重建视图用）。' : '；挂账必须落到一个具体 kind（all 只给 action=list 用）。'),
    );
  }
  return v as LedgerRecordKind | 'all';
}

/** 数字必填（`optionalNum` 只管形状；"没给"在这里升级成**带出路**的缺参报文） */
function requireInt(a: Record<string, unknown>, key: string, hint: string): number {
  const v = optionalNum(a, key, '整数');
  if (v === undefined) throw new Error(`缺参数 "${key}"：${hint}`);
  if (!Number.isInteger(v)) throw new Error(`参数 "${key}" 必须是整数（收到 ${String(v)}）：${hint}`);
  return v;
}

/**
 * 台账工具的**唯一 handler**：10 个 action 一路 switch，每支直映一个引擎函数。
 * ★ 不吞异常：引擎的报错原样上抛（`wrapData` 把它变成 `isError` 文本 + 码表反查）。
 */
export function ledgerHandler(a: Record<string, unknown>): { message: string; data: Record<string, unknown> } {
  const action = actionOf(a);
  const projectRoot = requireProjectRoot({ project_dir: a.project_dir });

  switch (action) {
    case 'hang': {
      const refId = requireStr(a, 'ref_id');
      const section = requireStr(a, 'section');
      const rowId = hangRow(projectRoot, {
        refId,
        section,
        title: requireStr(a, 'title'),
        problem: optionalStr(a, 'problem'),
        proposal: optionalStr(a, 'proposal'),
        by: requireStr(a, 'by'),
        subject: subjectOf(a),
        declareSupersedes: optionalStr(a, 'declare_supersedes'),
        recordKind: recordKindOf(a, false) as LedgerRecordKind | undefined,
        // ★ origin **不从这里过**：工具面只许造 engine 行（见 ORIGIN_ENGINE_ONLY 的注释）。
        //   给了别的值就当场拒 —— schema 是 loose object，删掉键并不等于拦得住。
        origin: originGuardOf(a),
      });
      return {
        message:
          `已挂账 ${refId}（row #${rowId} · ${section}）· state=active。\n` +
          '★ 挂账不是收口：办完要 `action=close`（状态翻转）；`annotate` 不会改 state。',
        data: { action, ref_id: refId, row_id: rowId, section, state: 'active' },
      };
    }

    case 'annotate': {
      const refId = requireStr(a, 'ref_id');
      // ★ body 只查**形状**、不查"空不空"：判空与"逐字保留"是引擎的 `bodyOf`（唯一住处）。
      //   工具这边一旦自己判空，就会多出一份口径（`缺参数` vs `body 必填`），那是第二份判定。
      const seq = annotateRow(projectRoot, refId, optionalStr(a, 'body') ?? '', requireStr(a, 'by'));
      return {
        message:
          `已批注 ${refId}（annotate 事件 seq=${seq}）· 只追加事件，行的列逐字未动。\n` +
          '★ 批注**不翻转 state**：这一行仍在活跃集里；办完了请用 `action=close`。',
        data: { action, ref_id: refId, event_seq: seq, note: 'annotate 不改任何列（含 state）' },
      };
    }

    case 'close': {
      const refId = requireStr(a, 'ref_id');
      // ★ 闭集判定**不在这里**：唯一判据是 `closeRow`（运行期就抛，报文列出 done/void）。
      //   本行 `as` 只是把 zod 的窄类型接过去，不是新的判定。
      const state = requireStr(a, 'state') as 'done' | 'void';
      const reason = requireStr(a, 'reason');
      const evidence = requireStr(a, 'evidence');
      const by = requireStr(a, 'by');
      // ★ 非阻断 precheck（被取代 / 有未消项）：**先取读数、再照常销账**。
      const warnings = closePrecheckOf(projectRoot, refId);
      const seq = closeRow(projectRoot, refId, state, reason, evidence, by);
      return {
        message: [
          `已销账 ${refId}：state=${state}（**状态已翻转**，不是批注）· close 事件 seq=${seq}。`,
          'reason / evidence 已逐字留在 close 事件体里（重开后仍可考古）。要收回 ⇒ `action=reopen`。',
          ...warnings,
        ].join('\n'),
        data: { action, ref_id: refId, state, event_seq: seq, warnings },
      };
    }

    case 'reopen': {
      const refId = requireStr(a, 'ref_id');
      const seq = reopenRow(projectRoot, refId, requireStr(a, 'by'));
      return {
        message:
          `已重开 ${refId}：state 回到 active（reopen 事件 seq=${seq}）· closed_* 列清空。\n` +
          '★ 上次销账的 reason / evidence 没丢：close 事件体里逐字留着。',
        data: { action, ref_id: refId, state: 'active', event_seq: seq },
      };
    }

    case 'supersede': {
      const refId = requireStr(a, 'ref_id');
      const supersededBy = requireStr(a, 'superseded_by');
      // ★ 声明的锚点**原样递进引擎**：跨 subject 的判定住在 `supersedeRow`（二席驳斥 #3）——
      //   工具这层不许自己判一遍（否则 CLI / importer / 直调三条路各持一把尺）。
      const seq = supersedeRow(projectRoot, refId, supersededBy, requireStr(a, 'by'), subjectOf(a));
      return {
        message:
          `已取代 ${refId} → ${supersededBy}（supersede 事件 seq=${seq}）。\n` +
          '★ state **仍是 active**：取代是**关系**不是结局（要收口还得 close）。',
        data: { action, ref_id: refId, superseded_by: supersededBy, state: 'active', event_seq: seq },
      };
    }

    case 'verdict': {
      const refId = requireStr(a, 'ref_id');
      const seq = writeVerdict(projectRoot, refId, requireStr(a, 'body'), requireStr(a, 'by'));
      return {
        message: `已写裁定 ${refId}（verdict 事件 seq=${seq}）· 只追加，不覆盖此前任何一条批注/裁定。`,
        data: { action, ref_id: refId, event_seq: seq },
      };
    }

    case 'list': {
      // ★ 读数先取：`rows:[]` 有"0 条"与"读不到"两种含义，混同就是 0.12 的老病。
      const availability = ledgerAvailability(projectRoot);
      const r = listActive(projectRoot, {
        section: optionalStr(a, 'section'),
        includeSuperseded: optionalBool(a, 'include_superseded'),
        includeClosed: optionalBool(a, 'include_closed'),
        recordKind: recordKindOf(a, true),
        subject: subjectOf(a) ?? undefined,
      });
      const lines = [
        `活跃 ${r.rows.length} 行${r.closed_count ? ` · 已销账 ${r.closed_count} 行` : ''} · 台账读数=${availability}`,
      ];
      if (r.rows.length) {
        lines.push(
          `  ${r.rows
            .slice(0, 10)
            .map((x) => `${x.ref_id}(${x.state})`)
            .join(' · ')}` + (r.rows.length > 10 ? ` …… 另 ${r.rows.length - 10} 行见 data.rows` : ''),
        );
      } else {
        lines.push('  （活跃集为空）');
      }
      if (availability !== 'ok') {
        lines.push(
          `★ 读数不是 ok（${availability}）：**这不是「0 条欠账」，是「读不到」**` +
            '（库 / 表不在场 ⇒ 按 0 行计；口径唯一出处 `ledgerAvailability`）。',
        );
      }
      return { message: lines.join('\n'), data: { action, availability, rows: r.rows, closed_count: r.closed_count } };
    }

    case 'get': {
      const refId = requireStr(a, 'ref_id');
      const availability = ledgerAvailability(projectRoot);
      const row = getRow(projectRoot, refId);
      const lines = row
        ? [
            `#${row.row_id} ${row.ref_id} · state=${row.state}` +
              `${row.superseded_by ? ` → 被 ${row.superseded_by} 取代` : ''} · ${row.section}` +
              ` · 事件 ${row.events.length} 条：${row.events.map((e) => e.kind).join(' → ')}`,
          ]
        : [`没有 ref_id="${refId}" 的行（台账读数=${availability}）`];
      if (!row && availability !== 'ok') {
        lines.push(`★ 读不到（${availability}）⇒ 不要把它读成「不存在」—— 库 / 表根本不在场。`);
      }
      return { message: lines.join('\n'), data: { action, availability, found: row !== null, row } };
    }

    case 'conflicts': {
      // ★ 二席驳斥 #2：收掉 origin 后门之后，**冲突可见性**要有配套出口 ——
      //   `subjectConflicts` 是引擎里"关系层矛盾的唯一读数"（现算，不落表）。
      const availability = ledgerAvailability(projectRoot);
      const groups = subjectConflicts(projectRoot);
      const lines = [`同 subject 的活跃行 ≥2 的组：${groups.length} 组 · 台账读数=${availability}`];
      for (const g of groups.slice(0, 10)) {
        lines.push(
          `  ${g.subject_path}${g.subject_symbol ? '#' + g.subject_symbol : ''}：` +
            g.members
              .map((m) => `${m.ref_id}(${m.origin}${m.superseded_by ? '→' + m.superseded_by : ''})`)
              .join(' · '),
        );
      }
      if (groups.length > 10) lines.push(`  …… 另 ${groups.length - 10} 组见 data.groups`);
      if (availability !== 'ok') {
        lines.push(
          `★ 读数不是 ok（${availability}）：**这不是「没有冲突」，是「读不到」**` +
            '（`subjectConflicts` 读不到时回 `[]`，与"无冲突"同形 —— 所以必须同时给读数）。',
        );
      }
      return { message: lines.join('\n'), data: { action, availability, groups } };
    }

    case 'review_queue': {
      // ★ 用 `readReviewQueue`（不是 `listReviewQueue`）：后者读不到时回 `[]`，与"0 条未消项"同形。
      const reading = readReviewQueue(projectRoot, {
        reason: optionalStr(a, 'review_reason') as ReviewReason | undefined,
        openOnly: optionalBool(a, 'open_only'),
      });
      const lines = [`待人工队列：${reading.items.length} 条 · 读数=${reading.availability} · 库 ${reading.file}`];
      if (reading.error) lines.push(`★ 读不到的原话：${reading.error}`);
      for (const it of reading.items.slice(0, 10)) {
        lines.push(`  #${it.id} [${it.reason}] ${it.ref_id ?? '—'}：${String(it.detail).slice(0, 90)}`);
      }
      if (reading.items.length > 10) lines.push(`  …… 另 ${reading.items.length - 10} 条见 data.items`);
      return { message: lines.join('\n'), data: { action, ...reading } };
    }

    case 'resolve_review': {
      const id = requireInt(a, 'review_id', '要消项的队列项 id（来自 action=review_queue 的 items[].id）');
      const by = requireStr(a, 'by');
      resolveReview(projectRoot, id, by);
      return {
        message:
          `已消项队列 #${id}（resolved_by=${by}）。\n` +
          '★ 可消的是**队列项**（needs_human 的"机器判不了"）；账本行的事件流 append-only，不可消。',
        data: { action, review_id: id, resolved: true },
      };
    }

    default: {
      // 到不了（actionOf 已收窄）；写出来是为了"加了 action 却忘了分支"时**当场红**而不是静默回 undefined。
      const never: never = action;
      throw new Error(`action "${String(never)}" 没有分支（分发器与 LEDGER_ACTIONS 漂了）`);
    }
  }
}


