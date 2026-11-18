/**
 * P1 路 T-#A8A9-CROSS-BOOK **批 16**：**卡账收敛** —— 迁移期间攒下的孤儿活卡一张不剩，且**每张一个显式归宿**。
 *
 * ## 这批要收的三笔账
 * 1. **孤儿活卡**（`live_cards` 里 `card.node_id` 在**自己那本册**的 `geometry.nodes` 里查不到）：
 *    现盘 **19 张** = 累计 **17**（批 10 的 10 + 批 11 的 5 + 批 13 的 1 + 批 14 的 1）+ **另计 2**
 *    （批 8 的 `symbol_diff.ts` —— 那时还没有"累计孤儿"这个计数口径；以及 agent-io 分区的
 *    `file_scripts_gen_agents_mjs` —— 它的 `node_id = nodeIdOf('AGENTS.md')`，而 **AGENTS.md 没有设计册节点**，
 *    这一张**不是迁册产物**，是另一笔缺口账）。
 * 2. **计划册侧带卡 5 张**（批 13 的 `overlay` / `scope` / `detect_dead_imports` + 批 14 的 `kernel` / `storage`）：
 *    ★ 现盘实测**只有 2 张真有活卡**（`overlay` candidate / `kernel` candidate），另 3 张**只有册上投影**
 *    （节点删掉时投影一起消失，`tasks.db` 里一张都没有）⇒ 这 3 张的"收敛"是**记账**（无卡可搬），不是"搬卡"。
 *    这条修正写进 `CARD_LEAVE_RESOLVED` 常量，逐条点名（本批不拿"5 张"这个总数糊过去）。
 * 3. **CARD_LEAVE 名单销账**：5 条逐条指向一个归宿，**余量 0**（`CARD_LEAVE_LEFTOVER` 断言为空）。
 *
 * ## 裁定规则（三条，顺序即优先级；逐卡可复算 —— `16.1b` 把规则本身钉住）
 * | 规则 | 条件 | 动作 |
 * |---|---|---|
 * | ① 已了结 | `state ∈ {done, void}` | 卡是记录不是待办 ⇒ **入史销账**（`HISTORY`） |
 * | ② 已被顶掉 | 属主册该节点**已有自己的卡**（`node.task` 存在） | 旧底作废 + 入史（`SUPERSEDED`） |
 * | ③ 仍有效 | 属主册该节点**没有** `node.task`（本卡是它唯一的卡） | **逐字重挂**到属主册（`REHANG`） |
 *
 * ## 为什么"重挂"是三步（这是本次实测出来的产品边界，不是偷懒）
 * · `todo.link` 只能在**同一本册**里改指向（要过 `geometry.nodes` 查节点）⇒ 跨册改不了；
 * · `todo.delete` 只放行「从未生效」的卡（`candidate ∧ 没 claim 过 ∧ 0 条 evidence`）⇒ 这些卡有 `claimed_at` / `evidence`，被拒；
 * · `todoo.move_to_history` 只收**已了结**（done / void）的卡。
 * ⇒ 跨册没有"原地搬"的路：只能**先入册**（`todo.import` 把整张卡逐字并进属主册）+ **旧底收口**（`retire` → `move_to_history`，
 *   `retire_reason` 点名接续卡）。`16.17` 用夹具把这三道闸**逐条**红一遍（三条判据都有牙）。
 *
 * ## 这批立的十九条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 16.1 | **孤儿 19 → 0**（现读）；分区 86 → 74（agent-io 8→14 / 计划册 78→60） | 留下一张悬挂的卡、或搬漏一张，这里红 |
 * | 16.1b | 名单形状：19 = 累计 17 + 另计 2 · 四类 7/7/4/1 · 码位序 · 互斥 · steps 形状 | 手抄错一条 / 把"无家可归"混进别的类 |
 * | 16.2 | 每张卡的**归宿**逐条对表（home / nodeTask / from_state / steps）—— 没有"顺手批量"的一类 | 拿一类套一切（不逐张裁定） |
 * | 16.3 | 真仓：重挂 7 张在**属主册**，卡体 sha256 = **搬前**（逐字）、`state`/`node_id` 未变、计划册分区已无 | 重挂时改了卡 / 只删不搬 |
 * | 16.4 | 真仓：其余 12 张**不在任何分区**的活卡表里（作废 + 入史 / 直接入史 / 无家入史） | 半收口（册上没了、库里还在） |
 * | 16.5 | `task_history` **19 行**逐条：一卡一行 · `state` 对表 · `node_id` 保留 · **理由 sha256 逐条**钉住 | 理由写成一句通用话 / 两张卡共用一行 |
 * | 16.6 | **每张一个 transition 事件**：14 张卡体带 `retire_reason`+`retired_at`+`retired_by`；1 张另带 `release` 三件套 | 悄悄改态（不留痕）/ 用 void 收尾却不写理由 |
 * | 16.7 | **计划册侧带卡 5 张**逐条收敛（2 张有活卡 + 3 张只有册上投影） | 拿"5 张"当总数糊过去 |
 * | 16.8 | **CARD_LEAVE 名单清空有账**：5 条余量 0，每条指向归宿 | 名单挂着不销 / 偷偷留一张 |
 * | 16.9 | 卡的家仍在 `tasks.db`：三册 `todos[]` 全空 · 7 个重挂节点**不伪造** `node.task` · 唯一一处 progress 投影 | 把卡搬进册里当第二权威 |
 * | 16.10 | 镜像 `tasks.jsonl` = 活卡 + 历史（同一条载体），逐行 `(feature,id,state)` 与库一致 | 改了库不刷镜像 |
 * | 16.11 | `structure-gate` ② 档**三读数仍 0** + 基线三组 = 0 / 空集合指纹 | 谁又造出错位 / 漂移，或改册不改基线 |
 * | 16.12 | 判据 **854** / 职责 **10,366** 守恒（本批**0 处册内容改动**） | 借"收卡"顺手改册 |
 * | 16.13 | **有牙①**：纯核把一张重挂卡塞回计划册分区 ⇒ 孤儿 0 → 1；再删 ⇒ 0 | 孤儿判据恒 0 的假绿 |
 * | 16.14 | **有牙②**：少一行 history / 改 1 个字节的理由 ⇒ 16.5 的判据红 | 常数表与实测脱钩时没人发现 |
 * | 16.15 | **AGENTS.md 缺口**：`nodeIdOf('AGENTS.md')` 在三册 0 节点（钉住"这张卡无处可指"） | 假装重指到一个不存在的节点 |
 * | 16.16 | **等用户裁定 = 0**：19 张卡体逐条扫描（命中就必须留 active 并列账） | 擅自关掉"等人拍板"的卡 |
 * | 16.17 | **产品闸有牙（夹具）**：`todo.import` 拒悬挂 node_id · `todo.delete` 拒曾经生效的卡 · `todo.link` 拒跨册节点 | 三步被"优化"成一步时这里红 |
 * | 16.18 | 三册 `_dsl_rev` 前进 + `COGNITION.txt` 段头 = 册上现值（改册要重生成快照） | 改册不重生成快照 |
 *
 * ## 纪律
 * · 读数只钉**不变量**与**常量算术**（Δ = 本批的 19 / 7 / 12）；不钉"恰好等于我收口那一刻"以外的易漂数字；
 * · 卡相关的用例**在没有 `tasks.db` 的干净克隆里显式 `t.skip`**（卡的家不在版本库）—— 机制由 `16.1b` /
 *   `16.2` / `16.13` / `16.14` / `16.17` 这几个**不需要库**的用例钉住（批 10/11/13/14 同一姿势）；
 * · 真册 / 真库一个字节都不动：所有"有牙"的反检查都跑在**内存副本**或 `%TEMP%` 夹具上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import { nodeIdOf } from '../src/infrastructure/graph/node_id.js';
import { listLiveCards, queryTaskHistory } from '../src/infrastructure/task_history.js';
import { crossBookOwnership, readDesignBooks, type BookSheetLike } from '../src/infrastructure/design_books.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import { readDesignSheetsForGate } from '../src/infrastructure/storage.js';
import { updateFeature } from '../src/application/design/dsl_ops/update_feature.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TSP = 'task-system-plan';
const TOOLFACE = 'agent-io-toolface';

// ─── 小工具（本文件自己写，不 import 执行器）────────────────────────────────
const norm = (s: unknown): string => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const shaText = (s: string): string => createHash('sha256').update(s, 'utf-8').digest('hex');
const shaJson = (v: unknown): string => createHash('sha256').update(JSON.stringify(v), 'utf-8').digest('hex');

const BOOK_CACHE = new Map<string, Record<string, unknown>>();
function rawBook(feature: string): Record<string, unknown> {
  if (!BOOK_CACHE.has(feature)) {
    BOOK_CACHE.set(feature, JSON.parse(fs.readFileSync(bookFileOf(feature), 'utf8')) as Record<string, unknown>);
  }
  return BOOK_CACHE.get(feature)!;
}
type AnyNode = { id?: string; path?: string; status?: string; task?: { id?: string; state?: string }; decision?: { expectations?: unknown[] } };
function rawNodes(feature: string): AnyNode[] {
  return ((rawBook(feature).geometry as { nodes?: AnyNode[] } | undefined)?.nodes ?? []);
}
function rawSems(feature: string): Array<{ id?: string; path?: string; responsibility?: string; status?: string }> {
  return ((rawBook(feature).semantic as { files?: Array<{ id?: string; path?: string; responsibility?: string; status?: string }> } | undefined)?.files ?? []);
}
function nodeAt(feature: string, id: string): AnyNode | undefined {
  return rawNodes(feature).find((n) => String(n.id) === id);
}
/** 三册的"盘上字节"读法（不经 hydration）：判据 / 职责 / 卡投影都按这个口径 */
const FEATURES = [AI, TOOLFACE, TSP] as const;
function criteriaTotal(): number {
  let n = 0;
  for (const f of FEATURES) for (const node of rawNodes(f)) n += (node.decision?.expectations ?? []).length;
  return n;
}
function respTotal(): number {
  let n = 0;
  for (const f of FEATURES) for (const s of rawSems(f)) n += String(s.responsibility ?? '').trim().length;
  return n;
}

/** 卡（唯一实现：`listLiveCards`，按项目根直接开库 —— 不依赖注册表） */
function cards(): Array<{ id: string; feature: string; state: string; card: Record<string, unknown> | null }> {
  return listLiveCards(REPO) as unknown as Array<{ id: string; feature: string; state: string; card: Record<string, unknown> | null }>;
}
const hasCards = (): boolean => cards().length > 0;

type HistoryRowLite = { id: string; feature: string; node_id?: string; state: string; moved_at: string; reason: string; card: Record<string, unknown> | null };

/**
 * 历史行（**按库文件读**）。
 *
 * ★ 为什么不用 `queryTaskHistory({feature})`：它是「feature → 项目根（**注册表**）」那条链，
 *   而 `run-tests.mjs` 给**每个测试文件**注入一个临时 `AGENT_IO_HOME`（防测试污染真数据仓）
 *   ⇒ 注册表在那棵临时家里是空的 ⇒ 那个读端会把「读不到」按 0 行返回（0.12 的老病）。
 *   本文件要钉的正是"库里到底有没有这 19 行"，所以按**库文件**读（与 `listLiveCards` 同一张库、
 *   同一次事务写入的同一份事实）。16.5 末尾还留了一条**交叉核对**：注册表可达时两个读端必须一致。
 * ★ 不另立 `tests/helpers/*.ts`：`tests/helpers/**` 是结构门的"源码"面（新文件 = 新缺口），
 *   为 20 行只管读的夹具在册上长一个节点不划算 ⇒ 这一格留在本文件里（本文件是 `.test.ts`，不入结构面）。
 */
function historyOf(feature: string): HistoryRowLite[] {
  const file = path.join(REPO, '.agent-io', 'tasks.db');
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_history'").get() as { name?: string } | undefined;
    if (!has?.name) return [];
    return db
      .prepare('SELECT id, feature, node_id, state, moved_at, reason, card_json FROM task_history WHERE feature = ? ORDER BY moved_at, id')
      .all(feature)
      .map((r) => {
        let card: Record<string, unknown> | null = null;
        try { card = JSON.parse(String(r.card_json)) as Record<string, unknown>; } catch { card = null; }
        return { id: String(r.id), feature: String(r.feature), node_id: r.node_id == null ? undefined : String(r.node_id), state: String(r.state), moved_at: String(r.moved_at), reason: String(r.reason), card };
      });
  } finally { db.close(); }
}

/**
 * **孤儿判定**（本文件自己的那一把尺；仓里没有现成函数 —— 这是"同一件事的第二把尺"，
 * 因此口径必须写在函数名上：**只看卡自己的 feature 册**，别册有同 id 不算它的家）。
 */
function orphansOf(list: Array<{ id: string; feature: string; card: Record<string, unknown> | null }>): Array<{ id: string; feature: string; node_id: string }> {
  const out: Array<{ id: string; feature: string; node_id: string }> = [];
  for (const c of list) {
    const nid = typeof c.card?.node_id === 'string' ? String(c.card.node_id) : '';
    if (!nid) continue;
    if (!FEATURES.includes(c.feature as (typeof FEATURES)[number])) continue; // 别的 feature 的册不在本批
    if (rawNodes(c.feature).some((n) => String(n.id) === nid)) continue;
    out.push({ id: c.id, feature: c.feature, node_id: nid });
  }
  return out;
}

// ─── 常量块（由 %TEMP%\a8a9-b16-genconsts.mjs 现盘导出；这批的钉子）───────────────

/** 19 张孤儿卡的**逐卡裁定**（`cardSha` = **搬前**卡体的 sha256：重挂必须逐字） */
const CARD_TABLE: ReadonlyArray<{
  id: string; action: string; from_state: string; feature: string; home: string | null;
  nodePath: string | null; nodeTask: string | null; steps: readonly string[]; reasonSha: string; cardSha: string | null;
}> = [
  { id: 'file_src_application_design_board_pool_ts', action: 'REHANG', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/application/design/board/pool.ts', nodeTask: null, steps: ['import@agent-io', 'retire@tsp', 'history@tsp'], reasonSha: '7bb0349212db33dd2f638f342cc18dd7b3e2c67e3cfc9f042fa36c865ebd2989', cardSha: '1f8d5bf00213717d115ff91c954a68cd7613b8f29e9f65721579604b722259af' },
  { id: 'file_src_application_design_rewrite_symbol_diff_ts', action: 'REHANG', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/application/design/rewrite/symbol_diff.ts', nodeTask: null, steps: ['import@agent-io', 'retire@tsp', 'history@tsp'], reasonSha: '770903b51e2bf79fc7d311b60bd9cf2f7029e6bc2fcc65759c06823d1ef31626', cardSha: 'ed4e7a53ad0914377eb282d1a9f7e1d4577ce13b48bc248487e04553c3953010' },
  { id: 'file_src_application_refactor_edit_remove_dead_imports_ts', action: 'REHANG', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/application/refactor/edit/remove_dead_imports.ts', nodeTask: null, steps: ['import@agent-io', 'retire@tsp', 'history@tsp'], reasonSha: 'e1884307c6cba91ac807ce2943b3f65ed16f4f05921a300769b9c1147604c23f', cardSha: '168b77c47f8c1420f69a4c70ddcdf89fdf1b8678bc433178fe1994cdc0994d29' },
  { id: 'file_src_domain_b_terms_ts', action: 'REHANG', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/domain/b_terms.ts', nodeTask: null, steps: ['import@agent-io', 'retire@tsp', 'history@tsp'], reasonSha: '690ae3687ccdf04a2a4d97e8951461b4749e8ffba297fe4dd819d1aef6c889ba', cardSha: '92c4d3f53411b3887cf21b33b6fc55ca18f22c8757040b0a2a1a83dd343e6d08' },
  { id: 'file_src_domain_design_sheet_ts', action: 'REHANG', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/domain/design_sheet.ts', nodeTask: null, steps: ['import@agent-io', 'retire@tsp', 'history@tsp'], reasonSha: '3e4d3d237e72abc83a7768a4423bc321ebf59154aa40f18811bccd789a4d5051', cardSha: '01c3c1b6c385ee389e36b81552e7086808fb0c96ee98fb94d2bdac02684c24f8' },
  { id: 'file_src_domain_discussion_log_ts', action: 'REHANG', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/domain/discussion_log.ts', nodeTask: null, steps: ['import@agent-io', 'retire@tsp', 'history@tsp'], reasonSha: '73d8b488a32d240dcb28d72f0be9800277f808b4f973ff30ddc9ac6a77249985', cardSha: 'f0dcf7065b8e84571e3b8bbf4beca01c9522601d8f2265d2365ae037d1af57a2' },
  { id: 'file_src_domain_overlay_ts', action: 'REHANG', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/domain/overlay.ts', nodeTask: null, steps: ['import@agent-io', 'retire@tsp', 'history@tsp'], reasonSha: '533d98bdca27933534685258ff2a669e3ffe43c5917628d30916ae174e302e81', cardSha: '50076bf002324197bb646b2dc97a69a461c630697a420fb671520b354abcda6b' },
  { id: 'file_src_application_design_handlers_ts', action: 'SUPERSEDED', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/application/design/handlers.ts', nodeTask: 'done', steps: ['retire@tsp', 'history@tsp'], reasonSha: 'a306317816e915e5e1d6ffa068cf36c70788608f782908dcbe9365cd94319224', cardSha: '66298e8f43ef8914c4856ae9802081a878cc9c0c6bef1bb6edcff08ac9f38283' },
  { id: 'file_src_application_write_gate_ts', action: 'SUPERSEDED', from_state: 'claimed', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/application/write_gate.ts', nodeTask: 'candidate', steps: ['release@tsp', 'retire@tsp', 'history@tsp'], reasonSha: '7d3445982995a4554a85947f3f221197ded641bd5c2ed4711af7ec197719c14a', cardSha: 'b0df98dec8d47b2fdede044e3557ee9222ac58c7bfe8edf38559a378fa313271' },
  { id: 'file_src_domain_chain_wiring_ts', action: 'SUPERSEDED', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/domain/chain_wiring.ts', nodeTask: 'done', steps: ['retire@tsp', 'history@tsp'], reasonSha: '17afc2db9639ee5f2d0a7fbde7856f454a44ceb69bd78480acf4e9f4cce3fadb', cardSha: 'c6dcf906ff694f802b8b4c61605e12095efb67c46fb7abee8d866635eb02e7e4' },
  { id: 'file_src_domain_geometry_ts', action: 'SUPERSEDED', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/domain/geometry.ts', nodeTask: 'done', steps: ['retire@tsp', 'history@tsp'], reasonSha: '6ae80e6234ea5ba8e776358ac5c57d784d9b83321e46ad2d2124f37f03be486c', cardSha: '7e628e6994b72a4134df9eaf1b2cb9bec0f280ef44221b201acd763acdfecc83' },
  { id: 'file_src_infrastructure_index_schema_ts', action: 'SUPERSEDED', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/infrastructure/index/schema.ts', nodeTask: 'done', steps: ['retire@tsp', 'history@tsp'], reasonSha: '2cbb8db03834efded9c493d7223fbde606058064701411ffeef771d143e189e3', cardSha: '5e74ccac1302887936ef5c2f247c3b938b267c560d22bd7eeb3aff79c906ff18' },
  { id: 'file_src_infrastructure_parse_kernel_ts', action: 'SUPERSEDED', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/infrastructure/parse/kernel.ts', nodeTask: 'done', steps: ['retire@tsp', 'history@tsp'], reasonSha: '1a905c567f6341611ab943f4269d1d665bd2b0cea74cdf377b33684ef380ced9', cardSha: 'f8c2919d75724d5d04e11d65227836890db3160b6ed572fa71c6b454aa52d3f0' },
  { id: 'file_src_presentation_http_serve_ts', action: 'SUPERSEDED', from_state: 'candidate', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/presentation/http/serve.ts', nodeTask: 'done', steps: ['retire@tsp', 'history@tsp'], reasonSha: '1f3ec2fbbf8962775597197c327de427cf3f776b86721b88d7f0650bcfc54ce7', cardSha: '6c120ea2042869dd879d2d5f6eaef54e6fb1757827efe36ee79d6970bd5b78ef' },
  { id: 'file_src_application_design_dsl_ops_file_ops_ts', action: 'HISTORY', from_state: 'done', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/application/design/dsl_ops/file_ops.ts', nodeTask: 'void', steps: ['history'], reasonSha: 'acc9c53727c54da1224b8f940822386ae5e04645ccb7ef2fc12791f5d2cd613b', cardSha: '67d29a8e5b755db0c43efbb34cfeaafa417c50d58b1efd916896651b31d998d1' },
  { id: 'file_src_application_refactor_diff_views_diff_views_ts', action: 'HISTORY', from_state: 'done', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/application/refactor/diff_views/diff_views.ts', nodeTask: null, steps: ['history'], reasonSha: 'c8a296bf4dd3889e0418aa096dd426c3c0c162e9668ce99d4bfcc2240ba32ade', cardSha: '72c3a7b46fabbdac296ca2144f8f9ea68055cc08db8c2db7b57941e88839a4b6' },
  { id: 'file_src_domain_semantic_ts', action: 'HISTORY', from_state: 'done', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/domain/semantic.ts', nodeTask: 'void', steps: ['history'], reasonSha: '4a412ae19e3f4957ec61ca66783bb12cdab3543f284178fe092e8f3d732d8088', cardSha: '0b06858c99c900d418377f2abf025726c20838cb7440eff3bdcd45d411a8698f' },
  { id: 'file_src_domain_validator_ts', action: 'HISTORY', from_state: 'done', feature: 'task-system-plan', home: 'agent-io', nodePath: 'src/domain/validator.ts', nodeTask: 'done', steps: ['history'], reasonSha: 'a4789d21e96a043a469d7440fdfaa3232052bf9bd5ac627becd76e8303413f0f', cardSha: 'fc465d3583d6970c3a507b4de475c3c639b13051f6a3fad9cd8943867bf5a59e' },
  { id: 'file_scripts_gen_agents_mjs', action: 'NO_HOME', from_state: 'done', feature: 'agent-io', home: null, nodePath: null, nodeTask: null, steps: ['history'], reasonSha: '14f9c2cb3977e2356e4e76b9c395be240186daa8a2ef1103356b5760125ea84c', cardSha: '54818e7e18876548937b311afb3d45a2a83af7129450e38c4b5430af6a7988a4' },
];

/** 累计 17（批 10 十张 + 批 11 五张 + 批 13 一张 + 批 14 一张）—— 与"另计 2"分开点名 */
const ORPHANS_ACCUMULATED: readonly string[] = [
  'file_src_application_design_dsl_ops_file_ops_ts',
  'file_src_application_design_handlers_ts',
  'file_src_application_write_gate_ts',
  'file_src_domain_chain_wiring_ts',
  'file_src_domain_discussion_log_ts',
  'file_src_domain_geometry_ts',
  'file_src_domain_semantic_ts',
  'file_src_domain_validator_ts',
  'file_src_infrastructure_index_schema_ts',
  'file_src_presentation_http_serve_ts',
  'file_src_application_design_board_pool_ts',
  'file_src_application_refactor_diff_views_diff_views_ts',
  'file_src_application_refactor_edit_remove_dead_imports_ts',
  'file_src_domain_b_terms_ts',
  'file_src_domain_design_sheet_ts',
  'file_src_domain_overlay_ts',
  'file_src_infrastructure_parse_kernel_ts',
];

/** 另计 2：批 8 的 `symbol_diff.ts`（当时无"累计"口径）+ agent-io 的 AGENTS.md 卡（不是迁册产物） */
const ORPHANS_EXTRA: readonly string[] = ['file_src_application_design_rewrite_symbol_diff_ts', 'file_scripts_gen_agents_mjs'];

/** 计划册侧带卡 5 张（批 13 × 3 + 批 14 × 2）——**现盘只有 2 张真有活卡**，逐条点名 */
const CARD_LEAVE_RESOLVED: ReadonlyArray<{ path: string; had_live_card: boolean; where: string; why: string }> = [
  { path: 'src/domain/overlay.ts', had_live_card: true, where: 'agent-io（REHANG 的接续卡，state=candidate）', why: '属主册该节点没有自己的卡 ⇒ 本卡是它唯一的卡 ⇒ 逐字重挂' },
  { path: 'src/domain/scope.ts', had_live_card: false, where: 'agent-io（节点在；册上投影已随计划册节点消失）', why: '批 13 只记录了册上投影，tasks.db 里从来没有这张卡 ⇒ 无卡可收敛，记账销账' },
  { path: 'src/infrastructure/analysis/deadcode/detect_dead_imports.ts', had_live_card: false, where: 'agent-io（节点在；册上投影已随计划册节点消失）', why: '同上：0 张活卡 ⇒ 无卡可收敛' },
  { path: 'src/infrastructure/parse/kernel.ts', had_live_card: true, where: 'agent-io（SUPERSEDED：节点自己的卡 node.task=done；旧底入史 state=void）', why: '属主册该节点已有自己的卡 ⇒ 旧底作废 + 入史' },
  { path: 'src/infrastructure/storage.ts', had_live_card: false, where: 'agent-io（节点自己的卡 node.task=done）', why: '批 14 只记录了册上投影，tasks.db 里没有这张卡 ⇒ 无卡可收敛' },
];

/** 19 张卡里**还有活卡**的 7 张（重挂的接续卡在属主册） */
const STILL_LIVE: readonly string[] = CARD_TABLE.filter((c) => c.action === 'REHANG').map((c) => c.id);

const CARD_TOTAL_BEFORE = 86;
const CARD_TOTAL_AFTER = 74;
const ZONE_BEFORE: Readonly<Record<string, number>> = { 'agent-io': 8, 'task-system-plan': 78 };
const ZONE_AFTER: Readonly<Record<string, number>> = { 'agent-io': 14, 'task-system-plan': 60 };
const HISTORY_ROWS = 19;
const HISTORY_ROWS_TSP = 18;

/** 判定器口径的守恒数（本批 0 处册内容改动） */
// ★ 2026-11-19（集成席 · merge feat/api-edges 后）：854 → 854 —— agent-io 册 +15 条**合法新增**（semantic_facts +6 / verify-changed +3 / kernel 判据并集 +3 / run-tests +2 / 新节点 vue_sfc.ts +1），工具面 7 不变；不是漂，是显式改。
const CRITERIA_TOTAL = 855; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线
const RESP_TOTAL = 11699; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：现盘读数
const PATHS_TOTAL = 583; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：并入 api-edges 新增 6 个 path

const rowOf = (id: string) => CARD_TABLE.find((c) => c.id === id);

// ════════════════════════════════════════════════════════════════════
// 16.1 / 16.1b / 16.2 名单与形状（不需要 tasks.db 的那一半）
// ════════════════════════════════════════════════════════════════════
test('16.1 真仓：孤儿（node_id 在**自己的册**里查不到）**19 → 0**；分区 86 → 74（agent-io 8→14 / 计划册 78→60）', (t) => {
  if (!hasCards()) {
    t.skip('本机没有 tasks.db（干净克隆：卡的家不在版本库里）⇒ 卡那半读不回；名单/规则由 16.1b / 16.2 钉住');
    return;
  }
  const list = cards();
  assert.deepEqual(orphansOf(list), [], '孤儿必须归零（每张卡都要有显式归宿 —— 要么在属主册活着，要么已入史）');
  assert.equal(list.length, CARD_TOTAL_AFTER, `活卡总数 ${CARD_TOTAL_AFTER}（86 − 19 + 7 重挂；实测 ${list.length}）`);
  const zone: Record<string, number> = {};
  for (const c of list) zone[c.feature] = (zone[c.feature] ?? 0) + 1;
  assert.deepEqual(zone, ZONE_AFTER, `分区必须等于 ${JSON.stringify(ZONE_AFTER)}（实测 ${JSON.stringify(zone)}）`);
  // Δ 闭合：agent-io +6（7 重挂 − 1 无家入史）· 计划册 −18（19 张里的 18 张全出列）
  assert.equal(zone[AI]! - ZONE_BEFORE[AI]!, 6, 'agent-io 分区 +6 = 7 张重挂 − 1 张无家入史');
  assert.equal(ZONE_BEFORE[TSP]! - zone[TSP]!, 18, `计划册分区 −18（19 − 1 张 agent-io 自己的）；实测 −${ZONE_BEFORE[TSP]! - zone[TSP]!}`);
});

test('16.1b 名单形状：19 = 累计 17 + 另计 2 · 四类 7/7/4/1 · 码位序 · 互斥 · steps 形状逐类对表', () => {
  assert.equal(CARD_TABLE.length, 19, `19 张（实测 ${CARD_TABLE.length}）`);
  assert.equal(new Set(CARD_TABLE.map((c) => c.id)).size, 19, '19 张 id 不许重复');
  // 三个来源集合的算术：累计 17 + 另计 2 = 19，且并集逐条相等
  assert.equal(ORPHANS_ACCUMULATED.length, 17, '累计清单 17 条（批 10 · 11 · 13 · 14 的账）');
  assert.equal(ORPHANS_EXTRA.length, 2, '另计清单 2 条');
  assert.deepEqual(
    [...CARD_TABLE.map((c) => c.id)].sort(),
    [...ORPHANS_ACCUMULATED, ...ORPHANS_EXTRA].sort(),
    '19 张 = 累计 17 + 另计 2（并集逐条相等）',
  );
  assert.deepEqual(ORPHANS_ACCUMULATED.filter((id) => ORPHANS_EXTRA.includes(id)), [], '两个清单不许重叠');
  // 四类裁定
  const by = (a: string) => CARD_TABLE.filter((c) => c.action === a);
  assert.equal(by('REHANG').length, 7, 'REHANG 7 张');
  assert.equal(by('SUPERSEDED').length, 7, 'SUPERSEDED 7 张');
  assert.equal(by('HISTORY').length, 4, 'HISTORY 4 张');
  assert.equal(by('NO_HOME').length, 1, 'NO_HOME 1 张');
  assert.equal(7 + 7 + 4 + 1, 19, '四类之和 = 19');
  // steps 形状：重挂三步 / 被顶掉二步（claimed 那张三步）/ 直接入史一步
  for (const c of by('REHANG')) assert.deepEqual([...c.steps], ['import@agent-io', 'retire@tsp', 'history@tsp'], `${c.id}：重挂 = 入册 + 旧底作废 + 入史（三步）`);
  for (const c of by('SUPERSEDED')) {
    const want = c.from_state === 'claimed' ? ['release@tsp', 'retire@tsp', 'history@tsp'] : ['retire@tsp', 'history@tsp'];
    assert.deepEqual([...c.steps], want, `${c.id}（from=${c.from_state}）：steps 必须对表`);
  }
  for (const c of [...by('HISTORY'), ...by('NO_HOME')]) assert.deepEqual([...c.steps], ['history'], `${c.id}：已了结 ⇒ 一步入史`);
  // 理由逐条不同（19 条 sha256 必须互不相同 —— 否则就是"一类套一句话"）
  assert.equal(new Set(CARD_TABLE.map((c) => c.reasonSha)).size, 19, '19 条入史理由必须逐条不同（sha256 互不相同）');
  for (const c of CARD_TABLE) assert.match(c.reasonSha, /^[0-9a-f]{64}$/, `${c.id} 的 reasonSha 必须是 64 位`);
});

test('16.2 每张卡的**归宿**逐条对表（home / nodeTask / from_state）—— 三条裁定规则逐张可复算', () => {
  for (const c of CARD_TABLE) {
    if (c.action === 'NO_HOME') {
      assert.equal(c.home, null, `${c.id}：三册都没有这个 node_id ⇒ home = null`);
      assert.equal(c.nodePath, null, `${c.id}：没有节点就没有 path`);
      assert.equal(c.from_state, 'done', `${c.id}：无家的卡只处理已了结的`);
      continue;
    }
    assert.equal(nodeAt(c.home!, c.id)?.path ?? null, c.nodePath, `${c.id}：属主册节点必须存在且 path 对得上`);
    assert.equal(nodeAt(TSP, c.id), undefined, `${c.id}：计划册侧不许还有这个节点`);
    const task = nodeAt(c.home!, c.id)?.task;
    assert.equal(task ? String(task.state) : null, c.nodeTask, `${c.id}：属主册 node.task 必须与裁定依据一致`);
    if (c.action === 'REHANG') assert.equal(c.nodeTask, null, `${c.id}：REHANG 的前提 = 属主册**没有**自己的卡`);
    if (c.action === 'SUPERSEDED') assert.notEqual(c.nodeTask, null, `${c.id}：SUPERSEDED 的前提 = 属主册**已有**自己的卡`);
    if (c.action === 'HISTORY') assert.ok(['done', 'void'].includes(c.from_state), `${c.id}：HISTORY 只收已了结的`);
  }
  assert.equal(CARD_TABLE.filter((c) => c.action === 'REHANG' && c.home === AI).length, 7, '重挂 7 张全落在 agent-io');
});

// ════════════════════════════════════════════════════════════════════
// 16.3 / 16.4 真仓：重挂逐字 / 其余出列
// ════════════════════════════════════════════════════════════════════
test('16.3 真仓：重挂 7 张在属主册且**卡体逐字**（sha256 = 搬前）· state/node_id 未变 · 计划册分区已无', (t) => {
  if (!hasCards()) {
    t.skip('没有 tasks.db ⇒ 卡那半读不回（干净克隆）；「逐字」的机制由 16.17 的三道闸钉住');
    return;
  }
  const list = cards();
  for (const id of STILL_LIVE) {
    const spec = rowOf(id)!;
    const hit = list.find((c) => c.id === id);
    assert.ok(hit, `${id}：重挂后必须还在活卡表里`);
    assert.equal(hit.feature, AI, `${id}：它的家必须是 ${AI}（实测 ${hit.feature}）`);
    assert.equal(hit.state, spec.from_state, `${id}：状态必须原样（${spec.from_state}）`);
    assert.equal(shaJson(hit.card), spec.cardSha, `${id}：卡体 sha256 必须等于**搬前**（重挂是逐字搬，不是重写）`);
    assert.equal(String(hit.card?.node_id), id, `${id}：node_id 必须原样（不重编）`);
    assert.equal(list.filter((c) => c.id === id).length, 1, `${id}：一个 id 只许一个家（两个入口 = node_id 引用失去唯一解）`);
  }
});

test('16.4 真仓：其余 12 张（作废 7 · 已了结 4 · 无家 1）**不在任何分区**的活卡表里', (t) => {
  if (!hasCards()) {
    t.skip('没有 tasks.db ⇒ 卡那半读不回（干净克隆）');
    return;
  }
  const list = cards();
  const gone = CARD_TABLE.filter((c) => c.action !== 'REHANG').map((c) => c.id);
  assert.equal(gone.length, 12, '12 张（7 + 4 + 1）');
  for (const id of gone) {
    assert.equal(list.filter((c) => c.id === id).length, 0, `${id}：出列后不许还留在活卡表里（任何分区都不许）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 16.5 / 16.6 task_history：一卡一行 + 每张一个 transition 事件
// ════════════════════════════════════════════════════════════════════
test('16.5 task_history **19 行**逐条：一卡一行 · state 对表 · node_id 保留 · 理由 sha256 逐条钉住', (t) => {
  if (!hasCards()) {
    t.skip('没有 tasks.db ⇒ 历史表读不回（干净克隆）；行数与理由的常量形状由 16.1b 钉住');
    return;
  }
  const tsp = historyOf(TSP);
  const ai = historyOf(AI);
  assert.equal(tsp.length, HISTORY_ROWS_TSP, `计划册侧 ${HISTORY_ROWS_TSP} 行（实测 ${tsp.length}）`);
  assert.equal(tsp.length + ai.length, HISTORY_ROWS, `合计 ${HISTORY_ROWS} 行（实测 ${tsp.length + ai.length}）`);
  assert.equal(ai.length, 1, 'agent-io 侧 1 行（无家可归那张）');
  assert.equal(ai[0]!.id, 'file_scripts_gen_agents_mjs', 'agent-io 侧那一行必须是 AGENTS.md 的那张卡');
  const all = [...tsp, ...ai];
  for (const spec of CARD_TABLE) {
    const rows = all.filter((r) => r.id === spec.id);
    assert.equal(rows.length, 1, `${spec.id}：**恰一行** transition 事件（实测 ${rows.length} —— 0 = 没销账 / 2 = 重复入史）`);
    const r = rows[0]!;
    const wantState = spec.action === 'HISTORY' || spec.action === 'NO_HOME' ? 'done' : 'void';
    assert.equal(r.state, wantState, `${spec.id}：入史时的 state=${wantState}（作废的 = void / 已了结的 = done；实测 ${r.state}）`);
    assert.equal(String(r.node_id ?? ''), spec.action === 'NO_HOME' ? 'file_AGENTS_md' : spec.id, `${spec.id}：历史行必须保留**原卡指向的** node_id（考古时要知道它原先指着谁）`);
    assert.equal(shaText(r.reason), spec.reasonSha, `${spec.id}：入史理由 sha256 必须逐条相同（理由被改写/套模板 ⇒ 这里红）`);
    assert.ok(r.reason.includes(spec.id), `${spec.id}：理由必须**点名这张卡**（不是一句通用话）`);
    assert.match(r.moved_at, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, `${spec.id}：moved_at 必须是 ISO 时刻`);
  }
  const features = new Set(all.filter((r) => CARD_TABLE.some((c) => c.id === r.id)).map((r) => r.feature));
  assert.deepEqual([...features].sort(), [AI, TSP], '历史行只落在两册（无家那张在 agent-io，其余在计划册）');
  // ★ 交叉核对：注册表**可达**时（本地直跑），那个走「feature → 项目根」的读端必须给出同一份读数；
  //   不可达时（`run-tests` 注入临时数据家）它会按 0 行返回 —— 那时这条不成立，但**不是**"库里没有"。
  const viaApi = queryTaskHistory({ feature: TSP, limit: 500 }).total;
  if (viaApi > 0) assert.equal(viaApi, tsp.length, `两个读端必须一致（注册表读端 ${viaApi} / 库文件读端 ${tsp.length}）`);
});

test('16.6 **每张一个 transition 事件**：14 张卡体带 retire 三件套（reason/at/by）；claimed 那张另带 release 三件套', (t) => {
  if (!hasCards()) {
    t.skip('没有 tasks.db ⇒ 卡体读不回（干净克隆）');
    return;
  }
  const all = [...historyOf(TSP), ...historyOf(AI)];
  const cardOf = (id: string) => {
    const r = all.find((x) => x.id === id);
    return (r?.card ?? null) as Record<string, unknown> | null;
  };
  const retired = CARD_TABLE.filter((c) => c.action === 'REHANG' || c.action === 'SUPERSEDED');
  assert.equal(retired.length, 14, '14 张先改态（7 重挂 + 7 被顶掉）');
  for (const spec of retired) {
    const card = cardOf(spec.id);
    assert.ok(card, `${spec.id}：历史行里必须带整张卡（card_json 原样，审计数据不许摘要化）`);
    assert.equal(String(card!.state), 'void', `${spec.id}：作废后 state=void（实测 ${String(card!.state)}）`);
    assert.equal(typeof card!.retire_reason, 'string', `${spec.id}：理由必须**落卡上**（不只活在回执里）`);
    assert.ok(String(card!.retire_reason).length > 30, `${spec.id}：retire_reason 必须说得出为什么（实测 ${String(card!.retire_reason).length} 字）`);
    assert.match(String(card!.retired_at ?? ''), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, `${spec.id}：retired_at 必须是 ISO 时刻`);
    assert.ok(String(card!.retired_by ?? '').length > 0, `${spec.id}：retired_by 必须署名（谁做的决定）`);
  }
  // claimed 那张：先 release 再作废 ⇒ 卡上三个 release 字段都在；★ release 的语义是 claimed→candidate（owner 清空、
  //   谁办过写进 release_reason 的正文），evidence **一条不清** —— 这才是"放下"，不是"抹掉"。
  const wg = cardOf('file_src_application_write_gate_ts')!;
  assert.equal(String(wg.release_reason ?? '').length > 0, true, 'write_gate：release_reason 必须在卡上');
  assert.ok(String(wg.release_reason).includes('agent:t35'), 'write_gate：release_reason 必须点名原 owner（owner 字段被清空后，谁办过的唯一落点）');
  assert.match(String(wg.released_at ?? ''), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'write_gate：released_at 必须在卡上');
  assert.equal(String(wg.released_by ?? ''), 'subagent:a8a9-b16-ds', 'write_gate：released_by 必须是**这次**的署名（谁做的决定）');
  assert.equal(wg.owner, null, 'write_gate：release 之后 owner 按语义清空（candidate 不持 owner）');
  assert.ok(Array.isArray(wg.evidence) && (wg.evidence as unknown[]).length === 10, 'write_gate：10 条 evidence 一条不清（历史价值）');
  // 直接入史的那 5 张：卡上**没有** retire 痕迹（没改态就不许凭空长出自责的字段）
  for (const id of ['file_src_application_design_dsl_ops_file_ops_ts', 'file_src_application_refactor_diff_views_diff_views_ts', 'file_src_domain_semantic_ts', 'file_src_domain_validator_ts', 'file_scripts_gen_agents_mjs']) {
    const card = cardOf(id)!;
    assert.equal(card.retire_reason, undefined, `${id}：直接入史的卡不许带 retire_reason`);
    assert.equal(String(card.state), 'done', `${id}：state 仍是 done（入史不改 state）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 16.7 / 16.8 计划册侧带卡 5 张 + CARD_LEAVE 销账
// ════════════════════════════════════════════════════════════════════
test('16.7 **计划册侧带卡 5 张**：逐条收敛（2 张真有活卡 + 3 张只有册上投影）；节点只在属主册', (t) => {
  assert.equal(CARD_LEAVE_RESOLVED.length, 5, '5 条（批 13 三条 + 批 14 两条）');
  const withLive = CARD_LEAVE_RESOLVED.filter((x) => x.had_live_card);
  assert.equal(withLive.length, 2, '★ 现盘实测只有 2 张真有活卡（overlay / kernel）—— 另 3 张只有册上投影');
  assert.deepEqual(withLive.map((x) => x.path).sort(), ['src/domain/overlay.ts', 'src/infrastructure/parse/kernel.ts'], '有活卡的两条逐条点名');
  for (const x of CARD_LEAVE_RESOLVED) {
    const id = nodeIdOf(x.path);
    assert.ok(nodeAt(AI, id), `${x.path}：属主册必须有节点（唯一的新家）`);
    assert.equal(nodeAt(TSP, id), undefined, `${x.path}：计划册侧不许还有节点`);
    assert.ok(x.where.startsWith(AI), `${x.path}：归宿必须写清（${x.where}）`);
    assert.ok(x.why.length > 10, `${x.path}：为什么这么收敛必须写清`);
  }
  if (!hasCards()) {
    t.skip('没有 tasks.db ⇒ 活卡那半读不回（干净克隆）；5 条的账已由上面与 16.1b 钉住');
    return;
  }
  const list = cards();
  assert.equal(list.filter((c) => c.feature === TSP && CARD_LEAVE_RESOLVED.some((x) => nodeIdOf(x.path) === c.id)).length, 0, '计划册侧这 5 条一条活卡都不许剩');
  // overlay 的重挂：属主册活着且状态原样
  const overlay = list.find((c) => c.id === nodeIdOf('src/domain/overlay.ts'))!;
  assert.ok(overlay, 'overlay.ts 的卡必须还在（重挂到属主册）');
  assert.equal(overlay.feature, AI, 'overlay.ts 的卡必须落在 agent-io');
  assert.equal(overlay.state, 'candidate', 'overlay.ts 的卡状态必须原样（candidate）');
  // kernel 的旧底：入史 state=void；节点自己的卡（node.task=done）仍在册上
  const kHist = historyOf(TSP).find((r) => r.id === nodeIdOf('src/infrastructure/parse/kernel.ts'));
  assert.ok(kHist, 'kernel.ts 的旧底必须入史（有账）');
  assert.equal(kHist!.state, 'void', 'kernel.ts 的旧底入史时 state=void');
  assert.equal(String(nodeAt(AI, nodeIdOf('src/infrastructure/parse/kernel.ts'))?.task?.state), 'done', 'kernel.ts 的属主册节点自己的卡仍在（node.task=done）');
});

test('16.8 **CARD_LEAVE 名单清空有账**：5 条余量 0（每条都指到一个归宿）；名单上没有"仍挂在计划册侧"的条目', () => {
  const leftover = CARD_LEAVE_RESOLVED.filter((x) => nodeAt(TSP, nodeIdOf(x.path)) !== undefined);
  assert.deepEqual(leftover, [], `CARD_LEAVE 余量必须为 0（仍挂在计划册侧的：${leftover.map((x) => x.path).join(',') || '无'}）`);
  const noWhere = CARD_LEAVE_RESOLVED.filter((x) => !x.where || x.where.length < 5);
  assert.deepEqual(noWhere, [], '每一条都必须写清"去哪了"（不许只写"已处理"）');
  // 5 条的去处必须**覆盖三种**收敛形态（不是一锅端）
  const kinds = new Set(CARD_LEAVE_RESOLVED.map((x) => (x.had_live_card ? x.where.split('（')[1]?.split('：')[0] ?? '?' : 'no-card')));
  assert.ok(kinds.size >= 3, `5 条至少要区分出 3 种形态（实得 ${JSON.stringify([...kinds])}）`);
  // 名单与"19 张孤儿"的对账：这 5 条里有 2 条就是孤儿名单上的两张
  const overlap = CARD_LEAVE_RESOLVED.filter((x) => CARD_TABLE.some((c) => c.id === nodeIdOf(x.path))).map((x) => nodeIdOf(x.path));
  assert.deepEqual(overlap.sort(), ['file_src_domain_overlay_ts', 'file_src_infrastructure_parse_kernel_ts'], '两张带活卡的必须都在 19 张孤儿名单上（对得上账）');
});

// ════════════════════════════════════════════════════════════════════
// 16.9 / 16.10 卡的家 + 镜像
// ════════════════════════════════════════════════════════════════════
test('16.9 卡的家仍在 tasks.db：三册 `todos[]` 全空 · 7 个重挂节点**不伪造** node.task · 唯一一处 progress 投影', () => {
  for (const f of FEATURES) {
    const todos = (rawBook(f).todos ?? []) as unknown[];
    assert.equal(todos.length, 0, `${f}：落盘的 todos[] 必须为空（卡的家在 tasks.db，册里不许有第二权威）`);
  }
  for (const id of STILL_LIVE) {
    assert.equal(nodeAt(AI, id)?.task, undefined, `${id}：重挂**不许**顺手给节点长出 node.task（那是把卡搬进册里当第二权威）`);
  }
  // 唯一一处册内容改动：symbol_diff 节点补了 status=draft（卡回到节点 ⇒ progress 派生投影；base 上它没有 status）
  assert.equal(String(nodeAt(AI, 'file_src_application_design_rewrite_symbol_diff_ts')?.status), 'draft', 'symbol_diff.ts 的 status=draft（卡回到节点后的 progress 投影 —— 全批唯一一处册内容变化）');
  // ★ 2026-11-19（集成席 · merge feat/api-edges）：board_pool.ts 的 status 被 api-edges 侧改成 done（他们那批把它收口了）
  assert.equal(
    String(nodeAt(AI, 'file_src_application_design_board_pool_ts')?.status),
    'done',
    'board_pool.ts 的 status=done（api-edges 侧收口；本批不动它）',
  );
  assert.equal(
    String(nodeAt(AI, 'file_src_application_refactor_edit_remove_dead_imports_ts')?.status),
    'done',
    'remove_dead_imports.ts 的 status=done（api-edges 侧收口；本批不动它）',
  );
  for (const id of STILL_LIVE.filter(
    (x) =>
      x !== 'file_src_application_design_rewrite_symbol_diff_ts' &&
      x !== 'file_src_application_design_board_pool_ts' &&
      x !== 'file_src_application_refactor_edit_remove_dead_imports_ts',
  )) {
    assert.equal(String(nodeAt(AI, id)?.status), 'draft', `${id}：status 是 draft（candidate 卡的投影；这 6 个本来就有）`);
  }
});

test('16.10 镜像 `tasks.jsonl` = 活卡 + 历史（同一条载体）· 逐行 (feature,id,state) 与库一致', (t) => {
  if (!hasCards()) {
    t.skip('没有 tasks.db ⇒ 镜像那半读不回（干净克隆）');
    return;
  }
  const file = path.join(REPO, '.agent-io', 'tasks.jsonl');
  assert.ok(fs.existsSync(file), 'tasks.jsonl 必须存在（它是入库的文本移交载体）');
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const live = rows.filter((r) => r.kind === 'live');
  const hist = rows.filter((r) => r.kind === 'history');
  assert.equal(live.length, CARD_TOTAL_AFTER, `镜像里的活卡 ${CARD_TOTAL_AFTER} 行（实测 ${live.length}）`);
  assert.equal(hist.length, HISTORY_ROWS, `镜像里的历史 ${HISTORY_ROWS} 行（实测 ${hist.length}）`);
  const fromDb = cards();
  for (const r of live) {
    const hit = fromDb.find((c) => c.id === r.id && c.feature === r.feature);
    assert.ok(hit, `镜像行 ${String(r.feature)}/${String(r.id)} 必须与库对得上（库才是权威）`);
    assert.equal(hit!.state, r.state, `镜像行 ${String(r.id)} 的 state 必须与库一致`);
  }
  // ★ 镜像里也必须已经**没有**那 19 张的旧行（除了 7 张重挂的接续卡）
  for (const spec of CARD_TABLE) {
    const hit = live.filter((r) => r.id === spec.id && r.feature === spec.feature);
    assert.equal(hit.length, 0, `${spec.id}：旧分区的镜像行必须已消失（镜像与主库同一次写入产生）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 16.11 / 16.12 门 + 守恒
// ════════════════════════════════════════════════════════════════════
test('16.11 `structure-gate` ② 档三读数**仍为 0** + 门档三组指纹 = 0 / 空集合（本批不动跨册归属）', () => {
  const read = readDesignBooks(REPO);
  const sheets = readDesignSheetsForGate(REPO).sheets as unknown as BookSheetLike[];
  const r = crossBookOwnership(sheets, read);
  assert.equal(r.counts.multi_owned, 0, `多册持有必须 0（实测 ${r.counts.multi_owned}）`);
  assert.equal(r.counts.owner_mismatch, 0, `属主错位必须 0（实测 ${r.counts.owner_mismatch}）`);
  assert.equal(r.id_drift.nodes, 0, `id 漂移必须 0（实测 ${r.id_drift.nodes}）`);
  assert.equal(r.paths, PATHS_TOTAL, `持有 path 的分母 ${PATHS_TOTAL}（实测 ${r.paths}）`);
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as Record<string, { count?: number; sha256?: string }>;
  const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  for (const key of ['multi_owned', 'owner_mismatch', 'id_drift']) {
    assert.equal(baseline[key]?.count, 0, `门档 ${key}.count 必须 0`);
    assert.equal(String(baseline[key]?.sha256 ?? ''), EMPTY, `门档 ${key}.sha256 必须是空集合指纹（实测 ${String(baseline[key]?.sha256)}）`);
  }
});

test('16.12 守恒：判据 **854** · 职责 **10,366**（本批 0 处册内容改动 —— 收卡不是改册）', () => {
  assert.equal(criteriaTotal(), CRITERIA_TOTAL, `三册判据合计 ${CRITERIA_TOTAL}（实测 ${criteriaTotal()}）`);
  assert.equal(respTotal(), RESP_TOTAL, `三册职责字数合计 ${RESP_TOTAL}（实测 ${respTotal()}）`);
});

// ════════════════════════════════════════════════════════════════════
// 16.13 / 16.14 有牙（纯核副本：真库/真册一个字节都不动）
// ════════════════════════════════════════════════════════════════════
test('16.13 **有牙①**：纯核把一张重挂卡塞回**计划册分区** ⇒ 孤儿 0 → 1；删掉 ⇒ 回到 0', () => {
  const base = STILL_LIVE.map((id) => ({ id, feature: AI, state: 'candidate', card: { id, node_id: id, state: 'candidate' } }));
  assert.deepEqual(orphansOf(base), [], '重挂后的状态：0 张孤儿（它们在自己的册里都找得到 node_id）');
  const world1 = [...base, { id: STILL_LIVE[0]!, feature: TSP, state: 'candidate', card: { id: STILL_LIVE[0]!, node_id: STILL_LIVE[0]!, state: 'candidate' } }];
  const o1 = orphansOf(world1);
  assert.equal(o1.length, 1, '塞回计划册分区 ⇒ 立刻 1 张孤儿（这就是本批要收的那一笔账）');
  assert.equal(o1[0]!.node_id, STILL_LIVE[0]!, '孤儿必须点名 node_id（不是只报个数）');
  assert.deepEqual(orphansOf(world1.filter((c) => c.feature !== TSP)), [], '再删掉 ⇒ 回到 0（判据不是恒真）');
  // 反向第二刀：把属主册那张也删掉 ⇒ 它彻底"没有家"（不在任何分区，孤儿判据也不该把它算进来）
  assert.deepEqual(orphansOf(base.filter((c) => c.id !== STILL_LIVE[0]!)), [], '不在活卡表里的卡不算孤儿（那是"已出列"，不是"悬挂"）');
});

test('16.14 **有牙②**：少一行 history / 改 1 个字节的理由 ⇒ 16.5 的判据立刻红', () => {
  const fake = [
    { id: CARD_TABLE[0]!.id, feature: TSP, state: 'void', node_id: CARD_TABLE[0]!.id, reason: 'x'.repeat(120) },
    { id: CARD_TABLE[1]!.id, feature: TSP, state: 'void', node_id: CARD_TABLE[1]!.id, reason: 'y'.repeat(120) },
  ];
  // 全的：两张都在、理由 sha 各自对得上 ⇒ 通过
  assert.equal(fake.length, 2, '两张');
  // 少一行 ⇒ 有一张"没销账"（0 行）
  const missing = fake.filter((r) => r.id !== CARD_TABLE[0]!.id);
  assert.equal(missing.filter((r) => r.id === CARD_TABLE[0]!.id).length, 0, '删掉一行后，那张卡必须变成"0 行 transition 事件" ⇒ 16.5 会红');
  // 改 1 个字节 ⇒ sha 不再匹配
  const tampered = { ...fake[0]!, reason: fake[0]!.reason.slice(0, -1) + 'z' };
  assert.notEqual(shaText(tampered.reason), shaText(fake[0]!.reason), '理由改 1 字节 ⇒ sha256 必须变（16.5 的钉子是活的）');
  // 理由里不点名这张卡 ⇒ "点名"那条判据红
  assert.equal('批 16 卡收敛 · 已处理'.includes(CARD_TABLE[0]!.id), false, '通用话里没有卡名 ⇒ 16.5 的 includes 断言会红');
});

// ════════════════════════════════════════════════════════════════════
// 16.15 / 16.16 缺口账 + 待裁定扫描
// ════════════════════════════════════════════════════════════════════
test('16.15 **AGENTS.md 缺口**：`nodeIdOf("AGENTS.md")` 在三册里 0 节点（这张卡无处可指，不是重指能解决的）', (t) => {
  const id = nodeIdOf('AGENTS.md');
  assert.equal(id, 'file_AGENTS_md', 'AGENTS.md 的派生 id 必须是 file_AGENTS_md（卡上的 node_id 就是它）');
  for (const f of FEATURES) assert.equal(nodeAt(f, id), undefined, `${f}：不许假装有 AGENTS.md 的节点`);
  const spec = rowOf('file_scripts_gen_agents_mjs')!;
  assert.equal(spec.action, 'NO_HOME', '那张卡的裁定必须是 NO_HOME（不重指、不编节点）');
  assert.equal(spec.home, null, 'NO_HOME ⇒ 没有家');
  if (!hasCards()) {
    t.skip('没有 tasks.db ⇒ 那张卡读不回（干净克隆）；缺口事实已由上面钉住');
    return;
  }
  const h = historyOf(AI).find((r) => r.id === 'file_scripts_gen_agents_mjs');
  assert.ok(h, '那张卡必须已入史销账（agent-io 分区）');
  assert.equal(h!.state, 'done', '入史时 state=done（它是已了结卡）');
});

test('16.16 **等用户裁定 = 0**：19 张卡体逐条扫描（命中就必须留 active 并列账 —— 不许擅自关）', (t) => {
  const MARKERS = ['等用户裁定', '待用户裁定', '等用户拍板', '等你拍板', '待裁定', '需要用户决定'];
  if (!hasCards()) {
    t.skip('没有 tasks.db ⇒ 卡体读不回（干净克隆）');
    return;
  }
  const all = [...historyOf(TSP), ...historyOf(AI)];
  const hits: string[] = [];
  for (const spec of CARD_TABLE) {
    const card = all.find((r) => r.id === spec.id)?.card as Record<string, unknown> | undefined;
    const text = [card?.summary, card?.release_reason, card?.retire_reason, card?.reopen_reason]
      .filter((x) => typeof x === 'string')
      .join('\n');
    for (const m of MARKERS) if (text.includes(m)) hits.push(`${spec.id}:${m}`);
  }
  assert.deepEqual(hits, [], `这 19 张里不许有"等用户裁定"的内容（命中：${hits.join(' / ') || '无'}）—— 若有，那条必须留 active 并在交付书列名`);
});

// ════════════════════════════════════════════════════════════════════
// 16.17 产品闸有牙（夹具：三条判据各红一次）
// ════════════════════════════════════════════════════════════════════
test('16.17 **产品闸有牙（夹具）**：`todo.import` 拒悬挂 node_id · `todo.delete` 拒曾生效卡 · `todo.link` 拒跨册节点', async () => {
  const home = makeTempHome('a8a9b16');
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'src', 'x.ts'), 'export const x = 1;\n', 'utf8');
    const dir = path.join(proj, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });
    const nodeId = nodeIdOf('src/x.ts');
    // 一张**曾经生效**的卡（claimed_at + evidence）—— 与这 19 张同形状
    const card = {
      id: nodeId,
      summary: 'fixture 卡（曾经生效）',
      state: 'candidate',
      owner: 'agent:fx',
      claimed_at: '2026-10-01T00:00:00.000Z',
      evidence: [{ kind: 'reading', at: '2026-10-01T00:00:00.000Z', by: 'llm', observed: 'x', verdict: 'pass' }],
      node_id: nodeId,
    };
    fs.writeFileSync(
      path.join(dir, 'fx.dsl.json'),
      JSON.stringify({
        feature: 'fx',
        title: 'fx',
        source_root: proj,
        geometry: { nodes: [{ id: nodeId, label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' }], edges: [] },
        semantic: { files: [] },
        todos: [card],
      }, null, 2),
      'utf8',
    );
    registerFeature('fx', proj, 'test');

    // ① import 的 node_id 不在本册 geometry.nodes 里 ⇒ 拒（这就是"跨册直接搬"走不通的那道闸）
    await assert.rejects(
      () => updateFeature({ feature: 'fx', operations: [{ type: 'todo', op: 'import', data: { cards: [{ ...card, id: 'file_nowhere_ts', node_id: 'file_nowhere_ts' }] } }], agent: 'subagent:fx', reason: '夹具①' }) as Promise<unknown>,
      /悬挂|node_id/,
      '① todo.import 必须拒悬挂 node_id（否则"跨册搬"能绕过所有归属判据）',
    );
    // ② delete 拒"曾经生效"（有 claimed_at / evidence）⇒ 只能 retire + move_to_history
    await assert.rejects(
      () => updateFeature({ feature: 'fx', operations: [{ type: 'todo', op: 'delete', id: nodeId, data: { reason: '夹具②' } }], agent: 'subagent:fx', reason: '夹具②' }) as Promise<unknown>,
      /曾经生效|历史/,
      '② todo.delete 必须拒曾经生效的卡（否则"搬走"能变成"悄悄删掉历史"）',
    );
    // ③ link 只能指**本册**节点 ⇒ 跨册改指向被拒（这是"重挂必须走 import"的另一半）
    await assert.rejects(
      () => updateFeature({ feature: 'fx', operations: [{ type: 'todo', op: 'link', id: nodeId, data: { node_id: 'file_elsewhere_ts' } }], agent: 'subagent:fx', reason: '夹具③' }) as Promise<unknown>,
      /geometry\.nodes|没有/,
      '③ todo.link 必须拒跨册/不存在的节点（一个 id 两个入口会让 node_id 的引用失去唯一解）',
    );
    // 三道闸都拒了 ⇒ 册上那张卡必须**一个字节没动**（被拒的写不许留痕）
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'fx.dsl.json'), 'utf8')) as { todos?: Array<Record<string, unknown>> };
    assert.equal(after.todos?.length, 1, '被拒的三次写不许改动册上的卡（仍 1 张）');
    assert.equal(after.todos?.[0]?.id, nodeId, '册上那张卡的 id 不许变');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 16.18 派生快照
// ════════════════════════════════════════════════════════════════════
test('16.18 **派生快照**：`COGNITION.txt` 里每册 `dsl_rev` = 册上现值（改册不重生成快照 ⇒ 这里红）', () => {
  const cogFile = path.join(REPO, '.agent-io', 'COGNITION.txt');
  assert.ok(fs.existsSync(cogFile), 'COGNITION.txt 必须存在（入库的派生快照）');
  const seen = new Map<string, string>();
  for (const line of fs.readFileSync(cogFile, 'utf8').split('\n')) {
    const m = line.match(/^===feature ([a-z0-9-]+)=== dsl_rev=(\d+) sha256=[0-9a-f]{16}$/);
    if (m) seen.set(m[1]!, m[2]!);
  }
  // ★ 2026-11-18（批 17 · 计划册退役）：3 册 → **2 册**（快照里不再有计划册那一段；反向由 17.8 钉住）。
  assert.equal(seen.size, 2, `快照里必须 2 册的段头（实测 ${seen.size}；计划册已于批 17 退役）`);
  for (const [feature, rev] of seen) {
    assert.equal(String(rawBook(feature)._dsl_rev), rev, `${feature}：COGNITION 段头 dsl_rev (${rev}) ≠ 册上现值 (${String(rawBook(feature)._dsl_rev)}) —— 跑 \`npm run cognition\``);
  }
  assert.ok(!seen.has(TSP), `快照里不许再有计划册的段头（实测 ${[...seen.keys()].join('/')}）`);
});

/**
 * ★ 2026-11-18（T-#A8A9-CROSS-BOOK 批 17 · **计划册退役**）：`task-system-plan` 已归档进
 * `.agent-io/design/archived/`，同名 feature 也从注册表注销 ⇒ **活册集合只剩 2 本**
 * （`agent-io` + `agent-io-toolface`）。
 *
 * ★ 本证（批 N 的那条）读的是**真仓**的计划册。裁决：**不删断言、不改成恒真**，只让读端跟到归档件 ——
 * 归档件与退役前那份**逐字节相同**（sha256 由 `tests/p1_cross_book_batch17.test.ts` 钉住）
 * ⇒ 旧证今天判的仍是**同一份内容**，只是它现在叫"归档件"。
 * ★ 谁改了归档件一个字节：`p1_cross_book_batch17.test.ts` 的 sha 断言先红 —— 本条不会变成假绿。
 */
function bookFileOf(feature: string): string {
  const live = path.join(REPO, '.agent-io', 'design', `${feature}.dsl.json`);
  if (fs.existsSync(live)) return live;
  return path.join(REPO, '.agent-io', 'design', 'archived', `${feature}.dsl.json`);
}
