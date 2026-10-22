/**
 * 预期 API 操作：add_expected_api / update_expected_api / delete_expected_api / set_node_semantic
 */

import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import type { EditResult } from './edit_result.js';

// ─────────────────────────────────────────────────────────────
// add_expected_api：添加预期 API
// ─────────────────────────────────────────────────────────────

export interface AddExpectedApiInput {
  feature: string;
  file_id: string;
  signature: string;
  notes?: string;
}

export function addExpectedApi(input: AddExpectedApiInput): EditResult {
  const { feature, file_id, signature, notes } = input;

  const dsl = getDSL(feature);
  if (!dsl || !dsl.semantic) throw new Error(`feature "${feature}" 不存在或没有 semantic 层`);

  const file = dsl.semantic.files.find(f => f.id === file_id);
  if (!file) throw new Error(`文件 "${file_id}" 不存在`);

  if (!file.expected_apis) file.expected_apis = [];
  file.expected_apis.push({ signature, notes });
  saveDSL(dsl);

  return {
    message: `已添加 API: ${signature}\n文件: ${file_id}\n当前 API 数: ${file.expected_apis.length}`,
    feature,
  };
}

// ─────────────────────────────────────────────────────────────
// update_expected_api：更新预期 API（按签名匹配）
// ─────────────────────────────────────────────────────────────

export interface UpdateExpectedApiInput {
  feature: string;
  file_id: string;
  signature: string;
  new_signature?: string;
  notes?: string;
}

export function updateExpectedApi(input: UpdateExpectedApiInput): EditResult {
  const { feature, file_id, signature, new_signature, notes } = input;

  const dsl = getDSL(feature);
  if (!dsl || !dsl.semantic) throw new Error(`feature "${feature}" 不存在或没有 semantic 层`);

  const file = dsl.semantic.files.find(f => f.id === file_id);
  if (!file) throw new Error(`文件 "${file_id}" 不存在`);

  const api = file.expected_apis?.find(a => a.signature === signature);
  if (!api) throw new Error(`API "${signature}" 不存在于文件 "${file_id}"`);

  if (new_signature !== undefined) api.signature = new_signature;
  if (notes !== undefined) api.notes = notes;
  saveDSL(dsl);

  return { message: `已更新 API: ${api.signature}`, feature };
}

// ─────────────────────────────────────────────────────────────
// delete_expected_api：删除预期 API
// ─────────────────────────────────────────────────────────────

export interface DeleteExpectedApiInput {
  feature: string;
  file_id: string;
  signature: string;
}

export function deleteExpectedApi(input: DeleteExpectedApiInput): EditResult {
  const { feature, file_id, signature } = input;

  const dsl = getDSL(feature);
  if (!dsl || !dsl.semantic) throw new Error(`feature "${feature}" 不存在或没有 semantic 层`);

  const file = dsl.semantic.files.find(f => f.id === file_id);
  if (!file) throw new Error(`文件 "${file_id}" 不存在`);

  const idx = file.expected_apis?.findIndex(a => a.signature === signature) ?? -1;
  if (idx === -1) throw new Error(`API "${signature}" 不存在`);

  file.expected_apis!.splice(idx, 1);
  saveDSL(dsl);

  return {
    message: `已删除 API: ${signature}\n剩余 API 数: ${file.expected_apis!.length}`,
    feature,
  };
}

// ─────────────────────────────────────────────────────────────
// set_expected_apis：**整块重写**该文件的契约列表（★ T160）
// ─────────────────────────────────────────────────────────────

export interface SetExpectedApisInput {
  feature: string;
  /** 所属文件 id（`semantic.files[].id`） */
  file_id: string;
  /** ★ **整块**新契约列表 —— **不是增量**：这里给什么，这个文件就是什么。 */
  expected_apis: Array<{ signature: string; notes?: string }>;
  /** 修订说明（进决策/历史的口径同其它 op；此处只落进回执，供人复核） */
  note?: string;
}

/** 整块重写的结构化回执（见 `EditResult.data`）。★ 口径写在字段注释里，别让读者自己猜。 */
export interface SetExpectedApisData {
  mode: 'block-rewrite';
  file_id: string;
  /** 重写前的契约签名（逐字，保持原顺序） */
  before: string[];
  /** 重写后的契约签名（逐字，保持你给的顺序） */
  after: string[];
  /** ★ 口径：以下三项按**签名串逐字相等**算。
   *  ★★ 所以"改了一条契约"会**同时**出现在 `removed` 与 `added` 里（那是**同一条**，不是删一加一）。 */
  added: string[];
  removed: string[];
  kept: string[];
}

/**
 * ★★★ **整块重写**该文件的 `expected_apis`（T160，2026-10-11）。
 *
 * ## 为什么要有它
 * 规则：**不打补丁，局部重写** —— 写代码比打补丁可靠；哪怕**重构工具**，
 * 也是**把那一整块圈出来、交给重写**，所以**不用在意重写的成本**。
 *
 * ## 它解掉的具体病（★ 实测的不对称）
 * 代码侧的写入原语 `edit_code op=replace` 的纪律是
 * 「**不信 AI 的行号、不信 AI 的 old_string**」——只给 `文件 + 符号名 + 完整新定义`。
 * ★ 而设计侧此前只有 `updateExpectedApi`：**按 `data.signature`（旧签名串）逐字匹配**来找目标
 *   ⇒ 要改 `NodeDecision` 的契约，**得先把那 91 个字符的旧串一字不差地背出来**，
 *   否则报 `API "…" 不存在于文件 "…"` —— **正是代码侧已经抛弃的那把老尺**。
 * ⇒ **同一条理念，代码侧落地了、设计侧没有。** 本函数把它补上：
 *   **圈出整块（`get_dsl` 能看到当前列表）⇒ 在旧块上改 ⇒ 回一个整块 ⇒ 整块替换**。
 *
 * ## ★★★ 口径（定位 vs 内容 —— 曾写反过一次，这里留证）
 * ★ 规则：**不是"不许看旧串"** —— 可以**根据旧串整体去重写新串**，
 *   只是**不要打补丁，而是整块重写**。
 * ⇒ ★★ **正确切分**：
 *   · **定位**：**不绑旧串**（`data.signature` 那种"逐字相等"是**脆**的——一字之差即报"不存在"）；
 *   · **内容**：**依据旧串**（旧串是**改写的素材**：先 `get_dsl` 拿旧块，在它上面改）。
 * ⇒ ★ 我第一版写的是"**不需要旧串**" —— **那是把它读成了"不许看旧串"，过度了**：
 *   那句"不信 old_string"防的是"**拿旧文本当定位**"，**不是**"不许看旧文本"。
 *
 * ## 纪律（照本仓已立的三条）
 * 1. **不打补丁**：不做"改第 3 条的第 2 个字段"这种定位式 API（那又回到旧串匹配）。
 * 2. **不许静默**：回执**必须**报出增删（`data.added/removed/kept`）—— 否则"漏写一条"会被读成"改好了"。
 * 3. **不猜**：`expected_apis` 不是数组 / 元素缺 `signature` ⇒ **抛**（不兜底成"那就别改了"）。
 */
export function setExpectedApis(input: SetExpectedApisInput): EditResult & { data: SetExpectedApisData } {
  const { feature, file_id, expected_apis } = input;

  const dsl = getDSL(feature);
  if (!dsl || !dsl.semantic) throw new Error(`feature "${feature}" 不存在或没有 semantic 层`);

  const file = dsl.semantic.files.find(f => f.id === file_id);
  if (!file) throw new Error(`文件 "${file_id}" 不存在`);

  const before = (file.expected_apis ?? []).map(a => a.signature).filter((s): s is string => !!s);
  const after = expected_apis.map(a => a.signature);

  // ★ 不猜：整块重写最容易出的错是"给了一条没有 signature 的"，静默丢掉它就等于悄悄删契约。
  const badIdx = expected_apis.findIndex(a => !a || typeof a.signature !== 'string' || a.signature.trim() === '');
  if (badIdx >= 0) {
    throw new Error(`expected_apis[${badIdx}] 缺少非空 signature ⇒ 拒绝整块重写（静默丢掉它 = 悄悄删一条契约）`);
  }
  const dup = after.filter((s, i) => after.indexOf(s) !== i);
  if (dup.length) {
    throw new Error(`expected_apis 里有重复 signature（${[...new Set(dup)].join(' / ')}）⇒ 定位会二义，拒绝写入`);
  }

  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const data: SetExpectedApisData = {
    mode: 'block-rewrite',
    file_id,
    before,
    after,
    added: after.filter(s => !beforeSet.has(s)),
    removed: before.filter(s => !afterSet.has(s)),
    kept: after.filter(s => beforeSet.has(s)),
  };

  file.expected_apis = expected_apis.map(a => ({ signature: a.signature, ...(a.notes ? { notes: a.notes } : {}) }));
  saveDSL(dsl);

  // ★★ 首行必须**自足**：`updateFeatureCore` 的汇总**只取每 op 的 `message` 首行**
  //   ⇒ 首行是**唯一保证被看见**的那一行（明细与 `data` 都可能在汇总/传输时丢）。
  //   ★ 而"整块重写"是**破坏性**的（给少了就删条目）⇒ **删了几条必须进首行，并带 ⚠**。
  const delMark = data.removed.length ? '⚠ ' : '';
  const lines = [
    `${delMark}已**整块重写**契约列表：${file.path}（${file_id}）—— ` +
      `${before.length} 条 → ${after.length} 条（＋${data.added.length} / －${data.removed.length} / ＝${data.kept.length}）`,
  ];
  if (data.added.length) lines.push(`  ＋ 新增 ${data.added.length}：${data.added.map(s => s.slice(0, 60)).join(' ｜ ')}`);
  if (data.removed.length) lines.push(`  － 移除 ${data.removed.length}：${data.removed.map(s => s.slice(0, 60)).join(' ｜ ')}`);
  lines.push(`  ＝ 原样保留 ${data.kept.length}`);
  lines.push('  ★ 口径：上面按**签名串逐字**比 ⇒ "改了一条契约"会**同时**出现在 ＋ 与 － 里（那是同一条）。');
  if (input.note) lines.push(`  ★ 说明：${input.note}`);

  return { message: lines.join('\n'), feature, data };
}

// ─────────────────────────────────────────────────────────────
// set_node_semantic：绑定节点与语义文件（自动同步状态）
// ─────────────────────────────────────────────────────────────

export interface SetNodeSemanticInput {
  feature: string;
  node_id: string;
  file_id: string;
  sync_status?: boolean;
}

export function setNodeSemantic(input: SetNodeSemanticInput): EditResult {
  const { feature, node_id, file_id, sync_status = true } = input;

  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在`);

  const node = dsl.geometry.nodes.find(n => n.id === node_id);
  if (!node) throw new Error(`节点 "${node_id}" 不存在`);

  const file = dsl.semantic?.files.find(f => f.id === file_id);
  if (!file) throw new Error(`文件 "${file_id}" 不存在`);

  // ★★★ T328（2026-10-15，进度轴收归）：**不再手写 `node.status`/`file.status` 的"状态同步"**。
  //   · 它属于**派生**（把一个已有进度**复制**给另一个对象），不是"人显式设进度" ⇒ 按分类法**降为读侧默认**（不落库）；
  //   · 进度有唯一权威（`overlay` 锚点的 `progress`），base 上两份都只是 `applyOverlay` 的**投影**；
  //   · 而文件节点在 `geometry.nodes` 与 `semantic.files` 里**共用同一个 id**（同一锚点）⇒ 一次投影两处，
  //     手写同步 = **第二处判据**（会漂移，且会经 `seedOverlayFromDsl` 把非投影值灌回 `progress`、**绕过 evidence 闸**）。
  //   ★ 行为变化：`node_id` 与 `file_id` **不同 id** 时不再被强制对齐（各自投影各自的 `progress`）—— 见本次报告。

  saveDSL(dsl);

  return {
    message: [
      `已绑定节点 "${node_id}" 与文件 "${file_id}"`,
      `节点标签: ${node.label}`,
      `文件路径: ${file.path}`,
      // ★ T328：不再同步 ⇒ 这里读的是 base 上的**投影值**（不是被本 op 改出来的）。
      sync_status ? `状态（读 base 投影）: ${node.status ?? '-'}` : '状态不同步',
    ].join('\n'),
    feature,
  };
}
