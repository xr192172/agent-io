/**
 * review_gate —— **「未消项未清零 ⇒ 不许收口」**：`ledger_review_queue` 的**接线判据**（纯核，零 import）。
 *
 * ## 这条闸为什么存在（硬证据，不是设计口味）
 * `ledger_review_queue` 从 L2 起就有写端（`importer` 每发现一条"机器判不了"就 `queueReview`）
 * 和读端（`ledger.ts#listReviewQueue`），但**读端在全仓 `src/` 里零消费点**（2026-11-17 市场审计实测：
 * grep 只有它自己的定义）⇒ 「未消项」只是一张**事后清理面**，`claim` / `complete` 都不把它当前置条件。
 * 于是"机器判不了"这件事在**收口那一刻是隐形的**：卡照样 done，队列项照样亮着。
 *
 * ## 为什么装在 `complete`（不是 `claim`）
 * 队列项说的是「**结论不可核销**」，不是「**过程不许开始**」。`claim` 是过程的开始（占座 + 取写权），
 * `complete` 是结论的核销点 ⇒ 闸的语义位置就是收口。
 * ★ 装到 `claim` 上还有一笔实测账：装得越早，"有未消项就没法开工"的压力越大 ⇒ 逼出**批量 resolve**
 *   （L2 迁移刚灌进来的 17 条存量会被当天吹灭），而 `claim` 已有 4 道闸（可领性 / 读集冲突 /
 *   A7 授权 / 判据门），再加一道是**扩入口**而不是修出口。
 * ⇒ 只装收口。★ **也不做"领卡回执预告"**：预告没有牙，却要占第二条调用路径的回执位
 *   （且要为它再写一条测试）；真要提前知会，那是一张独立的卡（见 `p1rv-ds-1.md` D3 的代价/收益）。
 *
 * ## 它守的不变量（打断即红，见 `tests/p1_review_gate.test.ts`）
 * I1 **不查全局**：只查**与本卡相交**的未消项（`subject_path` 相交 / `ref_id` 相同）。
 *    全局未消项**不该挡无关卡** —— 否则存量 17 条会挡死一切（L2 迁移当天就是这个形状）。
 * I2 **判不了 ≠ 通过**：队列读不出来（库打不开 / 查询抛）⇒ **拒**，报文点名"判不了"。
 * I3 **「没有」要能证，且要说清是哪种「没有」**：
 *    · `no-db` / `no-table` ⇒ 队列项**无处可住** ⇒ 0 条是**可证**的（这是「不可能有」，不是「没查」）；
 *    · `unreachable` ⇒ **看不见那块地方** ⇒ 本闸**不适用**（不拦），但回执必须响亮说出来 ——
 *      ★ 实测：本仓 `agent-io` 册的 `source_root` 指向一棵**已消失的 worktree**（`D:\dev_hzy\…`），
 *        若在这里 fail-closed，那 140 张卡会**永远收不了口**；而那不是"这张卡有问题"。
 * I4 **纯函数**：本文件不读盘、不开库（取数住 `task_ops#completeTask`，与
 *    `domain/complete_canvas_gate.ts#evaluateCompleteCanvasGate` 同一分工：application 取数、domain 判）。
 * I5 **点名**：命中的未消项**逐条**写出（id / reason / 锚点 / detail 摘要）；超过
 *    `REVIEW_GATE_MAX_LISTED` 才折叠，且折叠时**说出"另有 N 条"**（被裁掉的东西必须点名）。
 *
 * ## 边界（★ 如实写明，别让读端以为它管得更宽）
 * · 它**不判**队列项本身该不该消（那是人的裁定）：我不替你裁，也不许拿"我读过了"顶。
 * · 它**不消**矛盾：`resolve` 只记「人已裁」，真正的矛盾还得靠 supersede / 销账 / 改 MD 格式消掉。
 * · 它**不查** `ledger_rows` 的活跃矛盾（那是 `subjectConflicts` 的读数面，已有入口）。
 * · 它**不碰**半转义的 importer 读数（`reason='half-escaped'` 且无 subject 的项）：那是
 *   `docs/todo.md` 的**格式债**，把它挡到所有碰 `docs/todo.md` 的代码卡上是把账本格式债转嫁给卡。
 */

/** 报文首句（★ 固定前缀：将来入册 `GATE_RULES` 时用 `messageStartsWith` 反查即可自动接上） */
export const REVIEW_GATE_REFUSAL_HEAD = 'complete 被拒（未消项未清零）';

/** 逐条点名的上限（超过 ⇒ 折叠成一句"另有 N 条"，**不许**静默丢） */
export const REVIEW_GATE_MAX_LISTED = 10;

/** detail 在报文里的截断长度（队列项的 detail 是给**人**读的原文，回执只放摘要，全文留在库里） */
const DETAIL_CLIP = 180;

/**
 * 队列读数的五态（★ 「ok」以外**四种都不是「0 条未消项」**）。
 * `error` = 库在、但打不开/查询抛（损坏 / 被锁 / 权限）—— 那是**判不了**。
 */
export type ReviewGateReading = 'ok' | 'unreachable' | 'no-db' | 'no-table' | 'error';

/** 一条未消项的**判据所需字段**（`ledger.ts#ReviewItem` 的子集；本文件不 import application） */
export interface ReviewGateItemFact {
  id: number;
  ref_id: string | null;
  subject_path: string | null;
  subject_symbol: string | null;
  reason: string;
  detail: string;
}

export interface ReviewGateFacts {
  /** 队列读数（★ 调用方**必须**先 try/catch 再传 `'error'`：打不开 ≠ 空） */
  reading: ReviewGateReading;
  /** `reading === 'ok'` 时的**未消项**（全局；过滤在本函数内做，调用方不许先筛） */
  items: readonly ReviewGateItemFact[];
  /** `reading === 'error'` 时必填：打不开/查询失败的原话 */
  read_error?: string | null;
  /** 这张卡的 ref 身份候选（卡 id / 台账 ref_id —— 同空间时直接命中） */
  ref_ids: readonly string[];
  /** 这张卡的 subject 候选（**仓库相对路径**，调用方已用 `normalizeSubject` 归一化） */
  subject_paths: readonly string[];
  /** 被查的项目根（写进"怎么过"的粘贴命令） */
  root: string;
  /** 队列库文件绝对路径（判不了时人要知道看的是哪个文件） */
  queue_file: string;
}

export interface ReviewGateVerdict {
  ok: boolean;
  /** 命中的未消项 id（机器可读：测试与后续对账用，不必再解析报文） */
  matched: readonly number[];
  /** 拒绝理由（人读；已含"怎么办"）。`ok:true` 时为空 */
  refusals: readonly string[];
  /** 读数备注（**ok:true 时也要打**：放行不等于"查过了"） */
  note: string;
}

function clip(text: string, n: number): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : `${s.slice(0, n)}…（全文见该队列项的 detail）`;
}

/** 一条未消项的**锚点读法**（subject 优先；没有 subject 才退回 ref；两样都没有 ⇒ 只报 id） */
function anchorOf(it: ReviewGateItemFact): string {
  if (it.subject_path) return `${it.subject_path}${it.subject_symbol ? '#' + it.subject_symbol : ''}`;
  if (it.ref_id) return `ref=${it.ref_id}`;
  return '（无锚点）';
}

/**
 * 判：这张卡能不能带着这些未消项收口。
 *
 * @returns `ok:false` + `refusals`（已带"怎么过"）时调用方**直接拒**；
 *          `ok:true` + `note`（**必须**拼进回执：放行时也要说出你查过什么）。
 */
export function evaluateReviewGate(f: ReviewGateFacts): ReviewGateVerdict {
  // ── ① 判不了 ⇒ 拒（I2）────────────────────────────────────────────
  if (f.reading === 'error') {
    const why = String(f.read_error ?? '').trim() || '（没有留下错误原文）';
    return {
      ok: false,
      matched: [],
      note: '',
      refusals: [
        `${REVIEW_GATE_REFUSAL_HEAD} · **判不了（≠ 通过）**：队列库打不开/查询失败 —— ${f.queue_file}\n` +
          `  原话：${clip(why, DETAIL_CLIP)}\n` +
          '★ 为什么不是"放行"：队列里可能存在**与本卡相交**的未消项，而"打不开"不等于"没有"\n' +
          '  （本仓 0.12 的老病：把「读不到」读成「0 条」）。收口是最后一次可操作的机会，\n' +
          '  在这上面赌"大概没有"就是拿闸换运气。\n' +
          '★ 怎么办（按可能性排）：① 另一个进程正持写锁 ⇒ 等它结束再重试（读端等锁 5s 后才会抛）；\n' +
          '  ② 库文件损坏 ⇒ `sqlite3 <file> "PRAGMA integrity_check"` 确认，再从 `.agent-io/snapshots/` 恢复；\n' +
          `  ③ 路径不对 ⇒ 确认该 feature 的 \`source_root\`（当前 ${f.root}）。`,
      ],
    };
  }

  // ── ② 库不在场 / 根不可达 ⇒ 分两种说法（I3）────────────────────────
  if (f.reading !== 'ok') {
    if (f.reading === 'unreachable') {
      return {
        ok: true,
        matched: [],
        refusals: [],
        note:
          `\n★ 未消项闸：**本闸对本卡不适用** —— 项目根不可达（${f.root}）⇒ 队列库看不见（${f.queue_file}）。\n` +
          '  ★ 这不是"0 条未消项"，是**那块地方看不见**；若把它做成 fail-closed，`source_root` 指向已消失 worktree 的册\n' +
          '    会**永远收不了口**（实测：本仓 `agent-io` 册正是这个形状，140 张卡）。\n' +
          '  ★ 但"看不见"必须留痕：这条备注就是它 —— 不是静默放行。',
      };
    }
    return {
      ok: true,
      matched: [],
      refusals: [],
      note:
        `\n★ 未消项闸：队列库/表不在场（${f.queue_file}）⇒ **0 条未消项是可证的**` +
        '（队列项只住 `ledger_review_queue` 一张表；表不在 ⇒ 无处可住）。\n' +
        '  ★ 这是「库里不可能有」，**不是**「查过以后没有」——两种"没有"在回执上不许长得一样。',
    };
  }

  // ── ③ 相交（I1）───────────────────────────────────────────────────
  const refs = new Set(f.ref_ids.map((r) => String(r ?? '').trim()).filter(Boolean));
  const subs = new Set(f.subject_paths.map((p) => String(p ?? '').trim()).filter(Boolean));
  const matched = f.items.filter(
    (it) => (it.ref_id !== null && refs.has(it.ref_id)) || (it.subject_path !== null && subs.has(it.subject_path)),
  );

  const scopeLine =
    `★ 匹配口径：本卡 ref = ${refs.size ? [...refs].join(' / ') : '（无）'}；` +
    `subject = ${subs.size ? [...subs].join(' / ') : '（无）'} ⇒ ` +
    `**相交 ${matched.length} 条 / 全局未消项 ${f.items.length} 条**。\n` +
    '  ★ 全局未消项**只挡相交的卡**（这是范围声明，不是"漏查"）：不查全局，是因为全局一挡\n' +
    '    就等于"任何一条存量脏行都让全仓收不了口"——那是把账本债变成停摆。';

  const scopeInline =
    `★ 未消项闸：与本卡相交 0 条（全局未消项 ${f.items.length} 条）⇒ 放行` +
    `（ref=${refs.size ? [...refs].join('/') : '（无）'}；subject=${subs.size ? [...subs].join('/') : '（无）'}；` +
    '★ 只挡相交的卡，不查全局）。';

  if (!matched.length) {
    return { ok: true, matched: [], refusals: [], note: `\n${scopeInline}` };
  }

  // ── ④ 拒（I5：点名 + 怎么过）──────────────────────────────────────
  const shown = matched.slice(0, REVIEW_GATE_MAX_LISTED);
  const lines = shown.map(
    (it) => `  ✗ #${it.id} [${it.reason}] ${anchorOf(it)} —— ${clip(it.detail, DETAIL_CLIP)}`,
  );
  if (matched.length > shown.length) {
    lines.push(`  ✗ ……另有 ${matched.length - shown.length} 条未列出（★ 不是没有：${matched.slice(shown.length).map((x) => '#' + x.id).join(' · ')}）`);
  }
  const refusals = [
    `${REVIEW_GATE_REFUSAL_HEAD}：这张卡名下有 ${matched.length} 条「机器判不了」的账还没人裁 ⇒ 不许收口。`,
    ...lines,
    scopeLine,
    '★ 为什么拦：队列里的每一条都是一句**人还没表态**的悬空意见；在悬空意见上盖 done = 把\n' +
      '  「机器判不了」当成「机器判过了」（本仓头号病）。而收口是**最后一次**可操作的机会\n' +
      '  （`todo archive` 只许已了结的卡归档 ⇒ 收口之后这条意见就再也没人会回来看了）。',
    '★ 怎么过（唯一写入口 = `src/application/ledger/ledger.ts#resolveReview`；**没有批量口**）：',
    '  ① 先**人读**：上面每条 ✗ 的 detail 原文就是「为什么机器判不了 + 人该裁什么」；裁定是人的事 ——',
    '     本工具不替你裁，也不接受"我读过了"当裁定。',
    '  ② 再**逐条消项**（`by` 是署名，会落 `resolved_by`）：',
    '     node --import tsx -e "import(\'./src/application/ledger/ledger.ts\').then(m=>m.resolveReview(' +
      `'${f.root}','<id>','<by>'))"`,
    '  ③ ★ `resolve` 只记「人已裁」，矛盾本身还要**真的消**（supersede / 销账 / 改 MD 格式）——',
    '     `importer` 每轮都会按现状重算 `subjectConflicts` ⇒ 没真消的会**重新点亮**（这是设计，不是 bug）。',
  ];
  return { ok: false, matched: matched.map((it) => it.id), note: '', refusals };
}
