/**
 * 既有裸奔对账（批 3 · C6）：卡 ↔ 册**结案投影**只读点名。
 *
 * ## 口径（M6 一期：点名优先于强制）
 * 一张已结案（`closed` = done/void）的卡，凭据按 `cardLivesOf` 三来源合一：
 * · `live_cards(<feature>)=<state>` —— 库里活卡册有凭据；
 * · `task_history(<feature>)` —— 库里历史表有凭据；
 * · `册(<feature>)=<state>` —— 仅设计册投影自报结案。
 *
 * 本点名器列出：**life=closed 且凭据里既无 `live_cards` 也无 `task_history`** 的册单侧结案投影
 * （册上说已了结，库两侧都查不到这张卡的下落）。
 *
 * ★ 一期边界（0.17①，显式登记，不假红）：
 * · 按设计，done/void 的 task 卡**留在册里、从不迁出**（见 `rewrite_plan.ts#cardLivesOf` 注释），
 *   册单侧结案投影在存量里是一大类；本批只做**只读点名可见化**，不挂强制红门、不建基线棘轮。
 *   是否收窄子集（如再核 `read_set` 文件是否仍在盘上）/ 二期转强制门，留 Main 裁。
 * · 判卡下落的唯一权威仍是 `cardLivesOf`；本文件只对它产出的 `lives` / `why` 做归类格式化，
 *   不重查三处来源（0.9.1 第二把尺禁令）。
 * · 读册失败（`sheets_ok=false`）⇒ 点名不可信，报告带原因，不回落成"没有"。
 */
import { cardLivesOf, type CardLife } from '../../design/db/rewrite_plan.js';

/** 一条册单侧结案投影点名 */
export interface ClosedOnlyHit {
  cardId: string;
  feature: string;
  state: string;
  /** 原始凭据句（cardLivesOf 产出，只格式化不重查） */
  why: string;
}

export interface StaleProjectionReport {
  /** 册读是否成功；`false` ⇒ 本报告不可信 */
  sheetsOk: boolean;
  /** 读册失败原因（原样可贴回执） */
  reason?: string;
  /** 全部结案投影数（closed 档总量，分母） */
  closedTotal: number;
  /** 册单侧结案投影（库两侧无凭据）点名清单 */
  closedOnly: ClosedOnlyHit[];
}

const LIVE_CARDS_MARK = 'live_cards(';
const HISTORY_MARK = 'task_history(';

/**
 * 纯归类：从 `cardLivesOf` 的 `lives` / `why` 挑出库两侧无凭据的结案投影。
 * 纯函数，便于隔离夹具直喂合成数据；适配器层 {@link nameClosedOnlyProjections} 才读真册。
 */
export function classifyClosedOnly(lives: Map<string, CardLife>, why: Map<string, string>): ClosedOnlyHit[] {
  const hits: ClosedOnlyHit[] = [];
  for (const [id, life] of lives) {
    if (life !== 'closed') continue;
    const whyText = why.get(id) ?? '';
    if (whyText.includes(LIVE_CARDS_MARK) || whyText.includes(HISTORY_MARK)) continue;
    const m = whyText.match(/册\(([^)]+)\)=([^+]+)/);
    hits.push({
      cardId: id,
      feature: m?.[1] ?? '',
      state: (m?.[2] ?? '').trim(),
      why: whyText,
    });
  }
  return hits.sort((a, b) => a.cardId.localeCompare(b.cardId));
}

/** 读真册现算点名（只读；复用 cardLivesOf 唯一权威） */
export function nameClosedOnlyProjections(projectRoot: string): StaleProjectionReport {
  const { lives, why, sheets_ok, sheets_error } = cardLivesOf(projectRoot);
  const closedTotal = [...lives.values()].filter((l) => l === 'closed').length;
  const closedOnly = classifyClosedOnly(lives, why);
  return {
    sheetsOk: sheets_ok,
    ...(sheets_error ? { reason: sheets_error } : {}),
    closedTotal,
    closedOnly,
  };
}
