/**
 * expectations.ts —— 「**可判定的验收**」的判定器（2026-10-09，`docs/todo.md` T74）。
 * 类型与格式化在 `domain/expectation.ts`（那边不许 import infrastructure，所以判定器住这儿）。
 *
 * ## 四条纪律
 * 1. ★★★ **只看"此刻的代码"，不许拿索引冒充代码**。★ 这条是**出生证当场抓出来的**：
 *    初版用 `fileFacts`（读 `cache.db`）判 `symbol-exists` —— 我把源码里的 `mul` 删掉后，
 *    `consistency_check` 自己（**现解析**）已经报了 `missing: 1`，而我的判定器**仍报"✅ 有 mul"**
 *    ⇒ **拿"索引里的代码"判"此刻的代码" = 假绿**。
 *    ⇒ 修法：`symbol-exists` / `signature-matches` 一律**现读文件 + 现解析**
 *      （`fs.readFileSync` + `parseFileSymbols`；与 `intent/consistency.ts:281-283` 同一套入口）。
 * 2. ★★★ **判不了 ⇒ `unsupported`，既不算过也不算不过**。三类必须显式识别：
 *    · 扩展名不走 TS/JS 解析器 ⇒ 符号事实取不到；
 *    · 依赖边表**按设计只记 `relative` 且非 `type_only`**（`infrastructure/index/symbols.ts:388-390`）
 *      ⇒ 含包导入（Go/Python）的文件，"依赖事实"**不完整**；`import type` 的边**按设计不存在**；
 *    · 依赖边**只能取自索引**（符号能现解析，依赖不能）⇒ 源文件**比索引新**时，事实可能过期。
 *    ★ 三条都是"**没查到 ≠ 不存在**"的形态 —— 判成 fail 是假红，判成 pass 是假绿，所以**单列一类**。
 * 3. ★ **`unsupported` 不许混进"通过"**：那等于用"判不了"冒充"没问题"（本仓最忌的那类绿）。
 * 4. ★ **不新造解析**：符号走 `parseFileSymbols`，依赖走 `fileFacts.deps` + `getRawImportsOfFile`，
 *    全是既有入口；本文件只把它们按"五种检查项"编排一遍。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
import { getProjectCacheDb, projectCacheDbPath } from '../../../infrastructure/index/db.js';
import { getRawImportsOfFile } from '../../../infrastructure/index/symbols.js';
import { parseFileSymbols, isSupportedFile } from '../../../infrastructure/parse/ast_parser.js';
import { type Expectation, normPath, normSignature } from '../../../domain/expectation.js';

export type Verdict = 'pass' | 'fail' | 'unsupported';

export interface ExpectationItem {
  node_id: string;
  node_label: string;
  expectation: Expectation;
  verdict: Verdict;
  /** 人话说明（为什么过 / 为什么不过 / 为什么判不了） */
  detail: string;
}

export interface ExpectationsReport {
  checked: number;
  passed: number;
  failed: number;
  unsupported: number;
  items: ExpectationItem[];
  notes: string[];
}

/**
 * 索引是否**比源码旧**。
 * ★ 为什么需要它：依赖边**只能从索引取**（符号能现解析，依赖不能）⇒ 索引旧了就不敢判。
 * ⇒ 宁可说"判不了"，也**不拿旧事实说"通过"**（假绿）；同样也不说"不存在"（假红）。
 */
function indexStaleFor(root: string, rels: readonly string[]): string | null {
  let dbM = 0;
  try {
    const p = projectCacheDbPath(root);
    if (!fs.existsSync(p)) return `本项目**没有索引**（${p} 不存在）⇒ 依赖事实取不到，判不了`;
    dbM = fs.statSync(p).mtimeMs;
  } catch (e) {
    return `读索引时间戳失败（${(e as Error).message}）⇒ 判不了`;
  }
  const newer = rels.filter((r) => {
    const abs = path.join(root, normPath(r));
    return fs.existsSync(abs) && fs.statSync(abs).mtimeMs > dbM;
  });
  if (newer.length) {
    return (
      `**索引比源码旧**（${newer.join(', ')} 的 mtime 晚于 cache.db）⇒ 依赖边可能还没反映这次改动。` +
      `★ 依赖边只能取自索引（符号能现解析，依赖不能）⇒ **宁可说"判不了"，不拿旧事实说"通过"**`
    );
  }
  return null;
}

/** 该文件的**依赖事实是否完整**（不完整 ⇒ 与依赖有关的检查一律判不了） */
function depFactsIncomplete(root: string, relPath: string): string | null {
  const facts = fileFacts(root, relPath);
  if (facts.source === null) return `该文件在本项目的符号索引里读不到（无 cache.db 命中）⇒ 事实取不到，判不了`;
  let raw: Array<{ kind: string; type_only: boolean }> = [];
  try {
    raw = getRawImportsOfFile(getProjectCacheDb(root), relPath);
  } catch (e) {
    return `读原始 import 记录失败（${(e as Error).message}）⇒ 判不了`;
  }
  const pkg = raw.filter((r) => r.kind !== 'relative' && !r.type_only);
  if (pkg.length) {
    return (
      `该文件含 **${pkg.length} 条非相对导入**（Go/Python 的包导入等），而依赖边表按设计**只记 relative**` +
      `（\`infrastructure/index/symbols.ts:388\`）⇒ **依赖事实不完整，判不了**（不拿"没查到"冒充"不存在"）`
    );
  }
  return null;
}

/** 逐条判定（★ `async`：符号走**现解析**；不写盘） ★ 见文件头纪律 1 —— 不许用索引冒充代码 */
export async function judgeExpectations(
  root: string,
  items: ReadonlyArray<{ node_id: string; node_label: string; expectation: Expectation }>,
): Promise<ExpectationsReport> {
  const out: ExpectationItem[] = [];
  const push = (it: { node_id: string; node_label: string; expectation: Expectation }, verdict: Verdict, detail: string): void => {
    out.push({ ...it, verdict, detail });
  };

  for (const it of items) {
    const e = it.expectation;
    switch (e.kind) {
      case 'file-exists': {
        const p = normPath(e.path);
        const abs = path.join(root, p);
        const ok = fs.existsSync(abs);
        push(it, ok ? 'pass' : 'fail', ok ? `${p} 存在` : `${p} **不存在**（查的是 ${abs}）`);
        break;
      }
      case 'symbol-exists':
      case 'signature-matches': {
        const p = normPath(e.path);
        const abs = path.join(root, p);
        if (!fs.existsSync(abs)) {
          push(it, 'fail', `${p} **不存在**（查的是 ${abs}）`);
          break;
        }
        if (!isSupportedFile(p)) {
          push(it, 'unsupported', `${p} 的扩展名不走 TS/JS 解析器 ⇒ **符号事实取不到，判不了**（不拿"取不到"冒充"没有"）`);
          break;
        }
        // ★★★ 现读现解析：**不许**用 `fileFacts`（索引）—— 出生证证明过它会假绿。
        //   证据：把源码里的 mul 删掉后，`consistency_check`（现解析）已报 missing:1，
        //   而用 fileFacts 的初版仍报"✅ 有 mul" ⇒ **拿索引冒充代码**。
        const content = fs.readFileSync(abs, 'utf-8');
        const syms = await parseFileSymbols(p, content);
        const hit = syms.find(
          (s) => (s.kind === 'function' || s.kind === 'method') && (s.name === e.symbol || s.qualified_name === e.symbol),
        );
        if (!hit) {
          const names = syms.filter((s) => s.kind === 'function' || s.kind === 'method').map((s) => s.name);
          push(
            it,
            'fail',
            `${p}（**现解析**）里**没有符号** \`${e.symbol}\`；现取到 ${names.length} 个：` +
              `${names.slice(0, 6).join(', ')}${names.length > 6 ? ' …' : ''}`,
          );
          break;
        }
        if (e.kind === 'symbol-exists') {
          push(it, 'pass', `${p}（现解析）有 \`${hit.name}\`（L${hit.start_line}-${hit.end_line}）`);
          break;
        }
        const got = hit.signature ?? '';
        const ok = normSignature(got) === normSignature(e.signature);
        push(
          it,
          ok ? 'pass' : 'fail',
          ok
            ? `${p} 的 \`${hit.name}\` 签名与期望一致`
            : `${p} 的 \`${hit.name}\` **签名不符**：期望 \`${e.signature}\`，实取 \`${got || '（无签名）'}\``,
        );
        break;
      }
      case 'edge-exists':
      case 'edge-absent': {
        const from = normPath(e.from);
        const to = normPath(e.to);
        const bad = depFactsIncomplete(root, from) ?? indexStaleFor(root, [from]);
        if (bad) {
          push(it, 'unsupported', bad);
          break;
        }
        const deps = fileFacts(root, from).deps.map(normPath);
        const has = deps.includes(to);
        // ★ 若"期望存在但没找到"，再排一次 **type-only 的冤案**：
        //   `import type` 运行时擦除 ⇒ 按设计**不建边**（`symbols.ts:390`）⇒ 这是"判不了"，不是"不存在"
        if (e.kind === 'edge-exists' && !has) {
          const raw = getRawImportsOfFile(getProjectCacheDb(root), from);
          const rawHit = raw.find((r) => to.startsWith(normPath(r.source).replace(/^\.\//, '')) || r.source.includes(to.split('/').pop() ?? ''));
          if (rawHit?.type_only) {
            push(it, 'unsupported', `${from} 对 ${to} 的导入是 **type-only**（\`import type\`），按设计**不建依赖边** ⇒ 判不了（不是"不存在"）`);
            break;
          }
        }
        if (e.kind === 'edge-exists') {
          push(
            it,
            has ? 'pass' : 'fail',
            has ? `${from} → ${to} 存在` : `${from} **没有**依赖 ${to}（现取到 ${deps.length} 条依赖：${deps.slice(0, 5).join(', ') || '（无）'}${deps.length > 5 ? ' …' : ''}）`,
          );
        } else {
          push(
            it,
            has ? 'fail' : 'pass',
            has
              ? `${from} **不该**依赖 ${to}，但它确实依赖（边界越权）`
              : `${from} 未依赖 ${to}（符合预期：不许依赖）`,
          );
        }
        break;
      }
    }
  }

  const notes: string[] = [];
  const unsupported = out.filter((x) => x.verdict === 'unsupported').length;
  if (unsupported > 0) {
    notes.push(
      `★★ 有 **${unsupported} 条判不了（unsupported）** —— ★ **这不是"通过"**：` +
        `把它们并进"通过"就等于用"判不了"冒充"没问题"。请先把判据补全（多半是索引没建，或该语言不走相对导入）。`,
    );
  }
  return {
    checked: out.length,
    passed: out.filter((x) => x.verdict === 'pass').length,
    failed: out.filter((x) => x.verdict === 'fail').length,
    unsupported,
    items: out,
    notes,
  };
}
