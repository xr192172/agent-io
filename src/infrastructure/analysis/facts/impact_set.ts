/**
 * **改动集的波及集合**（增量选择的锚点）。
 *
 * ## 它替换掉什么
 * 上一版把"每条证据的去向闭包"整个哈希进摘要（O(证据×文件×2)，还要算到饱和才敢下结论）。
 * 那形状是错的：锚点应该是**改动集**（O(改动数)），判据应该是**集合相交**而不是哈希相等。
 *
 * ## 口径
 * · 对每个改动文件调一次 `diffImpact(direction:'callers')` —— 复用现有波及实现，不建第二张图；
 * · 取 **`impacted_files`（含 `import` 文件级边，兜住 scripts/tests 的纯 import 引用）∪ `impacted_symbols`**；
 * · 调用次数 = 改动文件数（去重后）⇒ **证据再多也不重复遍历全图**。
 *
 * ## 什么时候**不许**下结论（如实返回 `ok:false`）
 * · 索引打不开 / 没有关系边（`has_call_edges=false` 且文件级也空）；
 * · **改动文件不在索引里**（新文件、未被解析）⇒ 不知道谁依赖它 ⇒ 影响关系不可信；
 * · `diffImpact` 抛错。
 * ⇒ 调用方必须**显式扩大范围或标不可判**，不许默认"没波及 ⇒ 安全"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { diffImpact } from '../impact/diff_impact.js';
import { getProjectCacheDb } from '../../index/db.js';

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

const CODE_RE = /\.(ts|tsx|js|mjs|cjs|jsx|go|py|java|rs|rb|php|cs|kt|swift|c|cc|cpp|h|hpp)$/;

export type ImpactSet =
  | {
      ok: true;
      /** 非代码改动（册 / 文档 / 生成物）—— 它们不参与索引校验，由上层当"公共底座"处理 */
      non_code: string[];
      /** 波及文件（仓库相对路径；含 `import` 文件级边带出的文件） */
      files: Set<string>;
      /** 波及符号（`file::qualified_name`） */
      symbols: Set<string>;
      /** 本次 `diffImpact` 调用次数（= 去重后的**代码**改动文件数） */
      calls: number;
    }
  | { ok: false; reason: string };

export type ImpactOptions = {
  /** 追溯深度（默认 6；只影响"漏不漏远端调用方"，不影响判定口径） */
  max_depth?: number;
  /** 测试注入点（默认用 `diffImpact`；测试里可数调用次数） */
  impactFn?: typeof diffImpact;
  /** 文件存在性判定（测试注入） */
  exists?: (rel: string) => boolean;
};

/** 改动文件在索引里有没有节点（用索引自己的 nodes.file_path 判，不猜） */
function indexedFiles(root: string): Set<string> {
  const out = new Set<string>();
  try {
    const db = getProjectCacheDb(root) as unknown as {
      prepare: (s: string) => { all: (...a: unknown[]) => Array<{ file_path?: string }> };
    };
    for (const r of db.prepare('SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL').all()) {
      if (typeof r.file_path === 'string') out.add(norm(r.file_path));
    }
  } catch {
    return out; // 打不开 ⇒ 空集 ⇒ 上层判 ok:false（不猜）
  }
  return out;
}

/**
 * 算改动集的波及集合。
 * ★ 复杂度 **O(改动文件数)**：`diffImpact` 只对每个改动文件各调一次。
 */
export function impactOfChanged(root: string, changed: readonly string[], opts: ImpactOptions = {}): ImpactSet {
  const impactFn = opts.impactFn ?? diffImpact;
  const maxDepth = opts.max_depth ?? 6;
  const all = [...new Set(changed.map(norm))].sort();
  // ★ 只有**代码文件**进波及计算：册/文档/生成物（`.agent-io/**`）不在索引里，
  //   拿它们做"索引校验"会导致**整份基线永远不可用**（实测：改了 COGNITION.txt ⇒ 全部 undetermined）。
  const files = all.filter((f) => CODE_RE.test(f));
  const non_code = all.filter((f) => !CODE_RE.test(f));
  if (files.length === 0) {
    return { ok: true, files: new Set(), symbols: new Set(), calls: 0, non_code };
  }

  const outFiles = new Set<string>();
  const outSymbols = new Set<string>();
  let calls = 0;

  for (const f of files) {
    let rep;
    try {
      rep = impactFn({ project_dir: root, changed: [f], direction: 'callers', max_depth: maxDepth });
    } catch (e) {
      return { ok: false, reason: `波及计算抛错（${f}）：${String(e && (e as Error).message ? (e as Error).message : e).slice(0, 120)}` };
    }
    calls += 1;
    if (!rep || typeof rep.has_call_edges !== 'boolean') {
      return { ok: false, reason: `波及结果形状不对（${f}）⇒ 影响关系不可信` };
    }
    const warnBad = (rep.warnings ?? []).some((w) => /无法打开|不存在|no such (column|table)|请确认/.test(String(w)));
    if (warnBad) {
      return { ok: false, reason: `索引不可用：${String((rep.warnings ?? [])[0] ?? '').slice(0, 120)}` };
    }
    if (rep.has_call_edges === false && (rep.impacted_files ?? []).length === 0) {
      return { ok: false, reason: '索引里既没有调用边也没有文件级关系 ⇒ 波及无从判断' };
    }
    // ★ `impacted_files[].path` 在**节点 id ≠ 路径**的工程（如临时夹具）里可能是节点 id
    //   （实测拿到 `nA` / `nB`）⇒ 只收**像路径**的值：必须含 `/`。真实仓里节点 id 本身就是路径，不受影响。
    const looksLikePath = (x: string): boolean => x.includes('/');
    for (const x of rep.impacted_files ?? []) {
      const p = norm(String(x.path ?? ''));
      if (looksLikePath(p)) outFiles.add(p);
    }
    for (const s of rep.impacted_symbols ?? []) {
      const file = norm(String(s.file_path ?? ''));
      if (looksLikePath(file)) outFiles.add(file);
      outSymbols.add(`${file}::${String(s.qualified_name ?? s.name ?? '')}`);
    }
  }

  // ★ 改动文件不在索引里 ⇒ 谁依赖它无从判断 ⇒ 不许当"没波及"。
  //   ★★ 但**只有 `src/**` 才该在索引里**：`tests/**` 按设计不建索引（改了测试只需要重跑它自己）。
  //      所以：`src/**` 缺失 ⇒ `ok:false`；`tests/**`、`scripts/**` ⇒ 直接算"自身波及"。
  const mustBeIndexed = files.filter((f) => f.startsWith('src/'));
  for (const f of files) if (!f.startsWith('src/')) outFiles.add(f); // 非 src 代码：只波及自己
  const indexed = indexedFiles(root);
  if (indexed.size > 0 && mustBeIndexed.length > 0) {
    const exists = opts.exists ?? ((rel: string) => fs.existsSync(path.join(root, rel)));
    const missing = mustBeIndexed.filter((f) => !indexed.has(f) && exists(f));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `src/ 里的改动文件不在索引里（${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}）⇒ 谁依赖它不可知`,
      };
    }
  }

  outFiles.delete('');

  // ★★ 符号 → 文件的**兜底解析**：`impacted_symbols[].file_path` 在部分工程里为空/非路径，
  //   只靠它会让"波及到的文件"漏掉（实测临时夹具里 files 只剩改动文件自己）。
  //   用**索引自己的 nodes 表**一次查完（一条 SQL，不随证据数增长）。
  if (outSymbols.size > 0) {
    try {
      const db = getProjectCacheDb(root) as unknown as {
        prepare: (s: string) => { all: (...a: unknown[]) => Array<{ qualified_name?: string; file_path?: string }> };
      };
      const rows = db.prepare('SELECT qualified_name, file_path FROM nodes WHERE file_path IS NOT NULL').all();
      const want = new Set<string>();
      for (const k of outSymbols) {
        const i = k.indexOf('::');
        if (i >= 0) want.add(k.slice(i + 2));
      }
      for (const r of rows) {
        const q = String(r.qualified_name ?? '');
        const f = norm(String(r.file_path ?? ''));
        if (q && want.has(q) && f.includes('/')) outFiles.add(f);
      }
    } catch {
      /* 查询失败不致命：files 里仍有 impacted_files 带出的部分 */
    }
  }

  return { ok: true, files: outFiles, symbols: outSymbols, calls, non_code };
}

/** 证据观察面是否落在波及集合里（文件级 ∪ 符号级） */
export function intersectsImpact(
  observes: readonly string[],
  symbols: readonly string[] | undefined,
  impact: Extract<ImpactSet, { ok: true }>,
): string | null {
  for (const f of observes ?? []) {
    const n = norm(f);
    if (impact.files.has(n)) return `文件 ${n} 在波及集合里`;
  }
  for (const s of symbols ?? []) {
    const key = String(s);
    // 允许 "qualified_name" 或 "file::qualified_name" 两种写法
    if (key.includes('::') && impact.symbols.has(norm(key))) return `符号 ${key} 在波及集合里`;
    for (const k of impact.symbols) if (k.endsWith(`::${key}`)) return `符号 ${key} 在波及集合里`;
  }
  return null;
}
