/**
 * P1（audit P1-②）：`documented` 档缺引源**计数棘轮**的纯逻辑 + 基线 I/O。
 *
 * 由 `scripts/judge-all.mjs` 的报告聚合段调用；**不进退出码**（与
 * `scripts/mutate.mjs#compareExistenceRatchet` 同款裁定：只产出报告行文本，
 * 不把 verdict 交给 `process.exit`）。
 *
 * ## 口径（写死在这里，别让读的人猜）
 * · 计数 = `items[]` 中 `evidence.tier === 'documented' && !evidence.cited` 的条数；
 *   `community_practice` 缺 cited 仍由 judge-all 的 `badMarks` 警告，但**不进本棘轮的分母**
 *   （本卡名字就叫 documented_missing_citation，不偷换主语）。
 * · 与 `judge-all.mjs#evidenceOfItems` 同源：读不到 / 非法 tier 按最弱档 assumption 算 ⇒
 *   绝不会落进 documented（0.12：读不到 ≠ 二手档）。
 * · 只拦「涨」不拦「掉」：掉 = 有人补了引源或把判据改了档，是好事。
 * · 基线**只许显式** `--write-baseline` 写；本模块除该函数外从不写盘（与
 *   `mutate-survivors-baseline` 同款：新增/改动要人确认，不自动入账）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 基线文件相对路径（形态仿 `scripts/mutate-existence-baseline.json`） */
export const EVIDENCE_BASELINE_REL = 'scripts/evidence-baseline.json';

/**
 * `items[]` → documented 档缺引源计数 + 逐条 node_id（供报告点名）。
 * 这是本卡**唯一**的计数口径；judge-all 的 `evidenceOfItems` 直接调它，不另写第二把尺。
 */
export function countDocumentedMissingCitation(items) {
  const ids = [];
  for (const it of items ?? []) {
    const ev = it?.evidence;
    // ★ 与 evidenceOfItems 同口径：只有显式 documented 才算；null / 非法 tier 落 assumption
    if (ev?.tier !== 'documented') continue;
    if (!ev?.cited) ids.push(it?.node_id);
  }
  return { documented_missing_citation: ids.length, documented_missing_ids: ids };
}

/** 报告点名格式：前 n 条 + "…另有 N 条"；空清单打"（无）"（不假装缺）。 */
export function rollCall(ids, n = 10) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return '（无）';
  const head = list.slice(0, n).join(', ');
  return head + (list.length > n ? ` …另有 ${list.length - n} 条` : '');
}

/**
 * 读基线：缺文件 ⇒ null（绿 + 响亮说"无基线"，同 `readExistenceBaseline`）；
 * 坏文件 / 缺计数字段 ⇒ 抛（读不到 ≠ 没涨；judge-all 捕获成红报告行，但**不改退出码**）。
 */
export function readEvidenceBaseline(root) {
  const file = path.join(path.resolve(root), EVIDENCE_BASELINE_REL);
  if (!fs.existsSync(file)) return null;
  let b;
  try {
    b = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`★ ${EVIDENCE_BASELINE_REL} 解析失败（${e?.message ?? String(e)}）—— 不许当空基线`);
  }
  if (typeof b?.documented_missing_citation !== 'number' || !Number.isFinite(b.documented_missing_citation)) {
    throw new Error(`★ ${EVIDENCE_BASELINE_REL} 缺数值 documented_missing_citation —— 拒绝把"读不懂"当"没涨"`);
  }
  return b;
}

/**
 * 纯比较：**只拦涨**（current > baseline ⇒ red），掉 / 平 ⇒ green。
 * 不返回退出码、不调 process.exit —— 调用方只拿 `note` 印报告行。
 */
export function compareEvidenceRatchet(baseline, current) {
  if (!baseline) {
    return {
      ok: true, state: 'no-baseline', regressed: false,
      baselineCount: null, current, delta: 0,
      note: `无基线（本次只读数 ${current} 条；跑 \`node scripts/judge-all.mjs --write-baseline\` 建账，不是"没涨"）`,
    };
  }
  const b = baseline.documented_missing_citation;
  const delta = current - b;
  return {
    ok: delta <= 0,
    state: delta > 0 ? 'regressed' : delta < 0 ? 'improved' : 'flat',
    regressed: delta > 0,
    baselineCount: b,
    current,
    delta,
    note:
      delta > 0
        ? `documented 缺引源**涨了 ${delta} 条**：本次 ${current} / 基线 ${b} —— 新增的 documented 判据没写 cited（或有人删了引源）；只拦涨不拦掉`
        : delta < 0
          ? `本次 ${current} / 基线 ${b}（降了 ${-delta} 条 —— 补了引源或改了档，是好事，不拦）`
          : `本次 ${current} / 基线 ${b}（持平）`,
  };
}

/** 显式写基线（`--write-baseline`；评审里现形，脚本不自动写）。 */
export function writeEvidenceBaseline(root, count, ids = []) {
  const file = path.join(path.resolve(root), EVIDENCE_BASELINE_REL);
  const body = {
    '//': 'documented 档缺引源计数棘轮（只拦涨不拦掉）。由 judge-all.mjs --write-baseline 显式更新；不进退出码 / 不进 verify GATES。只许人工增/改。',
    format: 1,
    documented_missing_citation: count,
    capturedAt: new Date().toISOString().slice(0, 10),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return body;
}
