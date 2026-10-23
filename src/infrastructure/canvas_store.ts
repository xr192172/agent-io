/**
 * 画布层存储 —— `annotations` / `user_nodes` / `canvas_notes` 的**唯一住家**。
 *
 * ## 为什么它必须独立（用户 2026-10-23 裁定）
 * 原话：「**我们本身是要和那个做切割的呀**」—— 和**前端**切割。
 *
 * 背景（实测，不是推测）：`storage.ts#assertDslWriteAllowed` 是设计 DSL 写端的唯一闸，
 * 它有四条放行路径，其中第三条是
 *   ③ 画布补丁：与磁盘比只动了 `annotations` / `user_nodes` / `canvas_notes` ⇒ 放行
 * ★ 那一条是**为了让浏览器画布不断而开的洞** —— 昨天那位 subagent 的原话就是
 *   「serve.ts 那 5 个画布写点靠 ③ 兜住，只靠工具面授权会把画布打断」。
 * ⇒ 现在把这三格**整体搬出设计 DSL**：画布写不再经过 `saveDSL`，
 *   于是 `assertDslWriteAllowed` **不需要**为它开洞（③ 已删）。
 *
 * ## 结构：**逐字照抄原字段，一个新 schema 都没造**
 *   {
 *     "feature": "<feature>",
 *     "annotations": Annotation[],   // ← 原 `DesignDSL.annotations`
 *     "user_nodes":  UserNode[],     // ← 原 `DesignDSL.user_nodes`
 *     "canvas_notes": CanvasNote[],  // ← 原 `DesignDSL.canvas_notes`
 *     "saved_at": "<iso>"            // 与 `_sync.saved_at` 同一口径（只前进）
 *   }
 * ★ 三格内部**一个字段都没动**（连 `author:'human'` / `pos` / `groupId` 这些细节都原样）——
 *   行为不变是这条搬迁的硬约束；读端只是换了一个"从哪读"的来源。
 *
 * ## 落点
 *   `<dataHome>/.agent-io/canvas/<feature>.json`
 *   （`getCanvasDir()`，与 `design/` `features/` `live/` 同级 —— 画布是**第四个**数据面，不是设计的一部分）
 *
 * ## 为什么不留"读不到就退回 DSL 旧字段"的兜底
 * 那会让同一个字段**住两处**（本仓最贵的病）。实测 2026-10-23：本仓两份真设计册的
 * `annotations` 都是 `[]`、`user_nodes` / `canvas_notes` **字段都不存在**；
 * `features/*.overlay.json` 里三格也全是 0 条 ⇒ **没有数据要搬**（这条写在回报里，不是猜的）。
 * ⇒ 没做"读时迁移"（那是**读操作偷偷写盘**，比不做更坏）。若别的安装里有数据，
 *   属于一次性的数据搬运，必须显式做，不许藏在读路径里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDataHome } from './storage.js';
import type { Annotation } from '../domain/annotation.js';
import type { CanvasNote } from '../domain/canvas_note.js';
import type { UserNode } from '../domain/types.js';

/**
 * 一份画布文档（**字段名与顺序都照抄设计 DSL 原字段**）。
 * ★ 加字段前先问：它是不是**设计内容**？是 ⇒ 它不该在这里（回设计 DSL，走 `edit_dsl`）。
 */
export interface CanvasDoc {
  feature: string;
  annotations: Annotation[];
  user_nodes: UserNode[];
  canvas_notes: CanvasNote[];
  /** 最后一次落盘时刻（ISO）——只前进，与 `_sync.saved_at` 同款口径 */
  saved_at?: string;
}

/** 画布目录：`<dataHome>/.agent-io/canvas` */
export function getCanvasDir(baseDir?: string): string {
  return path.join(baseDir ?? getDataHome(), '.agent-io', 'canvas');
}

/**
 * 画布文件：`<dataHome>/.agent-io/canvas/<feature>.json`
 * ★ feature 来自 HTTP 请求体（`/api/canvas-notes` 等）⇒ 这是**系统边界**，必须挡住路径穿越。
 */
export function getCanvasFile(feature: string, baseDir?: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(feature) || feature === '.' || feature === '..') {
    throw new Error(`非法的 feature 名 "${feature}"（只允许字母/数字/._-，且不许是 . 或 ..）`);
  }
  return path.join(getCanvasDir(baseDir), `${feature}.json`);
}

/** 空画布（与"设计 DSL 里这三格缺省"逐字等价：全是空数组） */
function emptyDoc(feature: string): CanvasDoc {
  return { feature, annotations: [], user_nodes: [], canvas_notes: [], saved_at: undefined };
}

/** 画布变更回调（serve 注册后广播 SSE） */
type CanvasChangeCallback = (feature: string, source: string) => void;
let canvasChangeCallback: CanvasChangeCallback | null = null;

/** 注册画布变更回调（serve.ts 调用） */
export function onCanvasChange(cb: CanvasChangeCallback): void {
  canvasChangeCallback = cb;
}

/**
 * 读画布。**不存在 ⇒ 空画布**（不是 null）：
 * `GET /api/annotations?feature=X` 原本对"没有标注"返回 `[]`，行为必须不变。
 * ★ 文件存在但**解析不了** ⇒ **抛**（不许静默降级成空 —— 那会把"画布丢了"显示成"画布是空的"）。
 */
export function readCanvas(feature: string, baseDir?: string): CanvasDoc {
  const file = getCanvasFile(feature, baseDir);
  if (!fs.existsSync(file)) return emptyDoc(feature);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    throw new Error(`读画布失败（${file}）：${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `画布文件解析失败（${file}）：${(e as Error).message}\n` +
        `★ 这里**不退回空画布** —— 那会把"文件坏了"显示成"没有批注"。请先修/备份该文件。`,
    );
  }
  const d = parsed as Partial<CanvasDoc>;
  return {
    feature,
    annotations: Array.isArray(d.annotations) ? d.annotations : [],
    user_nodes: Array.isArray(d.user_nodes) ? d.user_nodes : [],
    canvas_notes: Array.isArray(d.canvas_notes) ? d.canvas_notes : [],
    saved_at: typeof d.saved_at === 'string' ? d.saved_at : undefined,
  };
}

/**
 * 写画布（**局部补丁**：只覆盖传进来的那几格，其余原样保留）。
 *
 * ★ 为什么是"补丁"而不是"整份写回"：三个端点各自只改一格
 *   （`/api/annotations` 改 annotations、`/api/user_nodes` 改 user_nodes、`/api/canvas-notes*` 改 canvas_notes）。
 *   若各自"读-改-整份写回"，两个端点并发就会互相覆盖（正是 `/api/save` 的病）。
 *   补丁 = 谁改谁写，谁也踩不到别人那格。
 *
 * ★ 原子写（临时文件 + rename）：与 `storage.ts#saveDSL` 同一手法、同一理由
 *   （并发的读不许读到半截 JSON）。
 *
 * ★ **不经过 `saveDSL` / `assertDslWriteAllowed`** —— 这正是本次切割的目的：
 *   画布写不该被"设计 DSL 写授权"管，因为它写的**不是设计**。
 */
export function writeCanvas(
  feature: string,
  patch: Partial<Pick<CanvasDoc, 'annotations' | 'user_nodes' | 'canvas_notes'>>,
  source = 'canvas',
  baseDir?: string,
): { file: string; doc: CanvasDoc } {
  const cur = readCanvas(feature, baseDir);
  const next: CanvasDoc = {
    feature,
    annotations: patch.annotations ?? cur.annotations,
    user_nodes: patch.user_nodes ?? cur.user_nodes,
    canvas_notes: patch.canvas_notes ?? cur.canvas_notes,
    saved_at: new Date().toISOString(),
  };
  const file = getCanvasFile(feature, baseDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
  if (canvasChangeCallback) {
    try {
      canvasChangeCallback(feature, source);
    } catch {
      /* 广播失败不许反过来堵住写盘（与 saveDSL 同款） */
    }
  }
  return { file, doc: next };
}

/** 该 feature 有没有画布数据（`MCP Resource` 列表用：只看有没有，不读全量） */
export function hasCanvas(feature: string, baseDir?: string): boolean {
  const f = getCanvasFile(feature, baseDir);
  if (!fs.existsSync(f)) return false;
  try {
    const d = readCanvas(feature, baseDir);
    return d.annotations.length > 0 || d.user_nodes.length > 0 || d.canvas_notes.length > 0;
  } catch {
    // 文件坏了：**当作有**（列表里要能看见它，别让它从视野里消失）
    return true;
  }
}
