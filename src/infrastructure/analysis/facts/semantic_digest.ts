/**
 * **语义摘要**：从"这条证据实际观察的源码/符号/关系"算出一个**稳定指纹**。
 *
 * ## 它替换掉什么（本轮的核心修正）
 * 旧口径用 **`.agent-io/cache.db` 的字节哈希**当"事实图版本" ⇒
 * **索引只要重算一次（DB 换个字节），基线就整体失效**（实测：`judge-all` 跑完 graph 从
 * `2e8c91a1…` 变 `f0f50892…`，8 条本来有效的证据全部被迫重跑）。
 * 那是**把"重新取了一次事实"误当成"事实变了"**。
 *
 * ## 现在怎么算
 * 只看**这条证据自己的观察面**：
 *   · 观察的文件 → 内容 sha256（源码不变 ⇒ 摘要不变，与 DB 是否重算无关）；
 *   · 观察的符号 → `signature` / `params` / `return_type` / `body_hash`（**不含 `updated_at`、不含行号 id**）；
 *   · 观察文件内的关系 → `(source.qualified_name, kind, target)` 三元组，按名字而非行 id
 *     （★ 行 id 在重建后会变 ⇒ 用 id 会让摘要随重建抖动，正是要避免的那类假失效）。
 *
 * ## 拿不到事实时
 * 返回 `null` —— 调用方据此判 **`undetermined`（不继承）**，绝不当作"没变"。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { diffImpact } from '../impact/diff_impact.js';
import { getProjectCacheDb } from '../../index/db.js';


export type ObserveTargets = {
  /** 观察的文件（仓库相对路径） */
  files: readonly string[];
  /** 观察的符号（`qualified_name`，如 `Calc.reset` 或模块级裸名） */
  symbols?: readonly string[];
  /**
   * **跨文件传递依赖闭包**（默认开）。复用的是 `diffImpact(direction:'callees')` ——
   * 现有索引的反向闭包口径，不新建第二套影响图。
   *
   * 为什么必须有它：A 调 B、B 调 C 时，只改 C 的签名/行为，**观察 A 的证据也必须失效**；
   * 只看直接观察面（文件内容）的话，C 变了 A 的摘要不会动 ⇒ 那条证据会被错误继承（假绿）。
   *
   * ★ 上限：闭包符号数超过 `max_symbols`（默认 2000）或追溯抛错 ⇒ 返回 `null`（判不了 ⇒ undetermined），
   *   而不是"截断后当没变"。
   *
   * ## 参数是**量出来的**，不是拍的（2026-11-08 对真实基线 17 个观察文件实测）
   * | 深度 | 闭包符号合计 | 相对上一档 | 单文件耗时 |
   * |---|---|---|---|
   * | 1 | 770 | — | — |
   * | 2 | 1212 | +442 | — |
   * | 3 | 1705 | +493 | — |
   * | 4 | 2180 | +475 | 32ms |
   * | **6** | **2933** | **+753**（9/17 文件仍有新增） | 33ms |
   * | 8 | 3194 | +261（7/17，明显收敛） | — |
   * ⇒ 取 **6**：4 还没饱和（会漏真依赖），8 的增量已收敛而代价只增不减；**耗时不是约束**（32→33ms）。
   *
   * ## 方向为什么只用 `callees`（不取 `both`）
   * 同一次实测：把 callers 也纳进来，每个观察文件多出 **1806 ~ 3529** 个符号
   * （`symbols.ts` 3529、`kernel.ts` 3538、`expectations.ts` 2869）—— 摘要会退化成"大半个仓"，
   * 于是**任何一处改动都让所有证据失效**，继承归零，整个基线失去意义。
   * ⇒ 只用 `callees`（"我依赖谁"）：改一个被间接依赖的下游 ⇒ 观察方失效（这正是要抓的）；
   *   改"谁调用我"不改变我的行为，不该牵连我。
   */
  closure?: { enabled?: boolean; max_depth?: number; max_symbols?: number };
};

const sha256 = (s: string | Buffer): string => crypto.createHash('sha256').update(s).digest('hex');
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

type Row = Record<string, unknown>;

/**
 * 只读打开事实库 —— **走仓库现有的缓存池**（`getProjectCacheDb`），不自己 new 一个驱动。
 *
 * ★ 为什么（本轮踩过）：原先本文件用 `node:sqlite` 直连，而 `diffImpact` 走的是
 *   `src/infrastructure/index/db.ts` 的池（better-sqlite3 + WAL）。两个驱动同时开同一个文件
 *   ⇒ 写侧直接 `database disk image is malformed`。统一走池是唯一稳的路，也符合"复用现有索引"。
 * ★ 拿不到就返回 `null`（调用方判 `undetermined`）。
 */
function openFactsDb(root: string): { all: (sql: string, ...p: unknown[]) => Row[]; } | null {
  try {
    const db = getProjectCacheDb(root) as unknown as { prepare: (sql: string) => { all: (...p: unknown[]) => Row[] } };
    return { all: (sql, ...params) => db.prepare(sql).all(...params) };
  } catch {
    return null;
  }
}

/**
 * 算一条证据的**语义摘要**。
 * · `null` = **算不出来**（无 DB / 查询失败 / 观察面为空）⇒ 调用方判 `undetermined`；
 * · 字符串 = 稳定指纹（同一份源码 + 同一套符号签名与关系 ⇒ 逐字相同，与 DB 何时重算无关）。
 */
export function semanticDigest(root: string, targets: ObserveTargets): string | null {
  const files = [...new Set((targets.files ?? []).map(norm))].sort();
  const symbols = [...new Set((targets.symbols ?? []).map((s) => String(s).trim()).filter(Boolean))].sort();
  if (files.length === 0 && symbols.length === 0) return null;

  // ① 文件内容（**不查 DB**：源码没变就一样，索引重算不影响）
  const fileHashes: Record<string, string> = {};
  for (const f of files) {
    try {
      fileHashes[f] = sha256(fs.readFileSync(path.join(root, f)));
    } catch {
      fileHashes[f] = '<missing>'; // 文件没了 ⇒ 摘要必然变 ⇒ 该证据失效（正确方向）
    }
  }

  // ② + ③ 符号签名 与 关系（要查 DB；查不到 ⇒ null，**不是**空摘要）
  const db = openFactsDb(root);
  if (!db) return null;
  try {
    const symFacts: Array<Record<string, unknown>> = [];
    for (const name of symbols) {
      const rows = db.all(
        `SELECT file_path, kind, name, qualified_name, signature, params, return_type, body_hash
           FROM nodes WHERE qualified_name = ? OR name = ? ORDER BY file_path, qualified_name LIMIT 5`,
        name,
        name,
      );
      if (rows.length === 0) {
        symFacts.push({ name, missing: true }); // 符号不存在 ⇒ 记住"不存在"这个事实
        continue;
      }
      for (const r of rows) {
        // ★ 只取**语义字段**：不取 id / updated_at / start_line / end_line（重建后会变）
        symFacts.push({
          n: String(r.qualified_name ?? r.name),
          f: norm(String(r.file_path ?? '')),
          k: String(r.kind ?? ''),
          sig: String(r.signature ?? ''),
          p: String(r.params ?? ''),
          ret: String(r.return_type ?? ''),
          bh: String(r.body_hash ?? ''),
        });
      }
    }

    // ★★ 2026-11-08：**观察文件里的符号也算观察面** —— 否则"改了签名"不会让摘要变，
    //   而签名的调用方（= 观察这个文件的测试）恰恰最该被重验。只取语义字段（不含行 id / updated_at）。
    const fileSymFacts: Array<Record<string, unknown>> = [];
    if (files.length > 0) {
      const inClause2 = files.map(() => '?').join(',');
      const rows2 = db.all(
        `SELECT qualified_name, kind, name, signature, params, return_type, body_hash
           FROM nodes WHERE file_path IN (${inClause2})
          ORDER BY qualified_name`,
        ...files,
      );
      for (const r of rows2) {
        fileSymFacts.push({
          n: String(r.qualified_name ?? r.name),
          k: String(r.kind ?? ''),
          sig: String(r.signature ?? ''),
          p: String(r.params ?? ''),
          ret: String(r.return_type ?? ''),
          bh: String(r.body_hash ?? ''),
        });
      }
    }

    // 关系：只取**观察文件内**的边，按名字记录（不用行 id）
    const relFacts: Array<Record<string, unknown>> = [];
    if (files.length > 0) {
      const inClause = files.map(() => '?').join(',');
      const rows = db.all(
        `SELECT se.kind AS kind,
                sn.qualified_name AS s_name, sn.file_path AS s_file,
                tn.qualified_name AS t_name, tn.name AS t_raw
           FROM edges se
           JOIN nodes sn ON sn.id = se.source
           LEFT JOIN nodes tn ON tn.id = se.target
          WHERE sn.file_path IN (${inClause})
          ORDER BY s_name, kind, t_name`,
        ...files,
      );
      for (const r of rows) {
        relFacts.push({
          k: String(r.kind ?? ''),
          s: String(r.s_name ?? ''),
          t: String(r.t_name ?? r.t_raw ?? ''),
        });
      }
    }

    // ④ **跨文件传递依赖**（复用 diffImpact 的波及口径；本文件不建图）
    //   ★ 参数是量出来的（见上「参数是量出来的」表）：depth=6（4 未饱和、8 已收敛）、cap=2000。
    //
    //   ★★ 方向**固定 callees**：实测 both 会让每个观察文件多出 1806~3529 个符号
    //      ⇒ 摘要退化成"大半个仓" ⇒ 任何改动都让全部证据失效 ⇒ 继承归零。
    //      只取"我依赖谁"：改下游 ⇒ 观察方失效（要抓的）；改上游调用者 ⇒ 不牵连我（对）。
    const closureCfg = { enabled: true, max_depth: 10, max_symbols: 2000, ...(targets.closure ?? {}) };
    const closureFacts: Array<Record<string, unknown>> = [];
    let closureNodes = 0;
    if (closureCfg.enabled !== false && files.length > 0) {
      const seen = new Set<string>();
      for (const f of files) {
        let rep;
        try {
          rep = diffImpact({ project_dir: root, changed: [f], direction: 'callees', max_depth: closureCfg.max_depth });
        } catch {
          return null; // ★ 闭包算不出来 ⇒ 判不了（不继承），绝不"当没变"
        }
        if (!rep || typeof rep.has_call_edges !== 'boolean') return null;
        // ★★ 闭包**不可用**必须判 `null`（⇒ undetermined），不许降级成"空闭包=没变"：
        //   · `has_call_edges=false`：索引里没有调用边 ⇒ 传递依赖无从判断；
        //   · warnings 里点名"打不开/缺列"：索引文件本身不可用。
        if (rep.has_call_edges === false) return null;
        if ((rep.warnings ?? []).some((w) => /无法打开|不存在|no such (column|table)|请确认/.test(String(w)))) return null;
        // ★★ 2026-11-08（完整性边界）：**深度截断不许当完整**。
        //   判据：把同一文件在 depth+1 上再取一次 —— 规模**还变** ⇒ 说明我们在 max_depth 处
        //   就把依赖链切断了 ⇒ 链尾的事实根本没进摘要 ⇒ 那条证据**不能声称"没变"** ⇒ 返回 null（undetermined）。
        //   实测依据（本仓 17 个观察文件）：多数在 d4–d10 饱和，`task_ops.ts` 到 d10 才饱和，
        //   `semantic_digest.ts` 到 d16 仍在长（+7/档）⇒ 那种文件永远判不了，这是**如实**的代价，
        //   而不是"截断后假装完整"。
        let deeper;
        try {
          deeper = diffImpact({ project_dir: root, changed: [f], direction: 'callees', max_depth: closureCfg.max_depth + 1 });
        } catch {
          return null;
        }
        const nHere = (rep.impacted_symbols ?? []).length;
        const nDeep = (deeper.impacted_symbols ?? []).length;
        if (nDeep !== nHere) return null; // 还在长 ⇒ 被截断 ⇒ 判不了
        for (const sym of rep.impacted_symbols ?? []) {
          const key = `${norm(String(sym.file_path ?? ''))}::${String(sym.qualified_name ?? sym.name ?? '')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          closureNodes += 1;
          if (closureNodes > closureCfg.max_symbols) return null; // 超上限 ⇒ 判不了
          const rowsC = db.all(
            `SELECT qualified_name, kind, name, signature, params, return_type, body_hash
               FROM nodes WHERE id = ?`,
            String(sym.id),
          );
          const r0 = rowsC[0];
          closureFacts.push({
            n: String(r0?.qualified_name ?? sym.qualified_name ?? sym.name ?? ''),
            f: norm(String(r0?.file_path ?? sym.file_path ?? '')),
            k: String(r0?.kind ?? ''),
            d: sym.depth,
            sig: String(r0?.signature ?? ''),
            ret: String(r0?.return_type ?? ''),
            bh: String(r0?.body_hash ?? ''),
          });
        }
      }
      closureFacts.sort((a, b) => String(a.n).localeCompare(String(b.n)));
    }

    return sha256(JSON.stringify({ files: fileHashes, symbols: symFacts, file_symbols: fileSymFacts, relations: relFacts, closure: closureFacts }));
  } catch {
    return null;
  }
}

/** 供报告用：观察面的人读摘要 */
export function describeTargets(t: ObserveTargets): string {
  const f = (t.files ?? []).length;
  const s = (t.symbols ?? []).length;
  return `文件 ${f} · 符号 ${s}`;
}
