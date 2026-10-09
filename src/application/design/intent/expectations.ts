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
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { getRawImportsOfFile, contentHash } from '../../../infrastructure/index/symbols.js';
import { parseFileSymbols, isSupportedFile } from '../../../infrastructure/parse/ast_parser.js';
// ★ T79：调用边读取**复用现成那一处**（别在这再写一份 SQL）
import { queryFileCalls } from '../../meta/explore/query_feature.js';
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
 * 索引是否**与源码一致**。
 *
 * ★★★ 2026-10-09 **判据换过一次，这次是换掉一个错判据** —— 起因是"真跑一遍试用"：
 *   在真夹具上把 `format.ts` 改对之后，`fileFacts('src/format.ts').deps` **已经是 `['src/math.ts']`**
 *   （索引确实更新了、设计确实满足了），而旧判据仍报「**索引比源码旧 ⇒ 判不了**」⇒ **假红**。
 *   根因两条：① 旧判据比的是 **mtime**，而索引库是 **WAL** 模式 ⇒ **写的是 `cache.db-wal`/`-shm`，
 *   主库 `cache.db` 的 mtime 根本不更新**（实测：主库停在 10-08 21:58，而源文件是 10-09 10:55）；
 *   ② 即使不是 WAL，"谁的 mtime 大"也只是**代理**，而 `files.content_hash` 是**事实**。
 *   ⇒ 换成**按内容比对**：读源文件算 `contentHash`（**复用 `index/symbols.ts` 那一份，不另写 sha1**），
 *     与索引里该文件的 `content_hash` 比。**这才叫"索引是否反映此刻的代码"。**
 * ★ 为什么假红也危险：它会让**干对了的人以为没干对** —— 比假绿更难察（假绿是"不该绿却绿"，
 *   假红是"该绿却红"，而人会先把活儿重做一遍再说）。
 * ★ 附：提示里必须给**可执行的修复动作**（下面那句就是）—— 只说"判不了"等于把问题丢回给用户。
 */
function indexStaleFor(root: string, rels: readonly string[]): string | null {
  const db = getProjectCacheDb(root);
  for (const relInput of rels) {
    const rel = normPath(relInput);
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue; // 文件不存在 ⇒ 由调用方去判"失败"，不是这里的事
    const facts = fileFacts(root, rel);
    const key = facts.matched_path ?? rel;
    const row = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: key }) as { content_hash?: string } | undefined;
    if (!row?.content_hash) {
      return `索引里查不到该文件（\`${key}\`）⇒ 依赖事实取不到，判不了`;
    }
    const now = contentHash(fs.readFileSync(abs, 'utf-8'));
    if (row.content_hash !== now) {
      return (
        `**索引与源码不一致**：\`${rel}\` 的内容已改过，但索引还是旧的 ⇒ 依赖边可能没反映这次改动。` +
        `★ 依赖边只能取自索引（符号能现解析，依赖不能）⇒ **宁可说"判不了"，不拿旧事实说"通过"**。` +
        `\n     修复动作：跑一次 \`import_project\`（**默认只刷新"实际"、不碰设计**）即可保鲜，然后再对拍。`
      );
    }
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
      case 'call-exists': {
        // ★★ T79：**调用级**判据 —— 边/符号/签名三档表达不了"必须用哪个符号"，
        //   而"用错符号"恰恰是最常见的偏差（实测：设计说必须用 add，实现换成 mul，边判据照样绿）。
        const p = normPath(e.path);
        const bad = indexStaleFor(root, [p]);
        if (bad) {
          push(it, 'unsupported', bad);
          break;
        }
        const fileId = p;
        let outgoing: Array<{ caller: string; callee: string; line: number }> = [];
        try {
          outgoing = queryFileCalls(getProjectCacheDb(root), p, p).outgoing;
        } catch (err) {
          push(it, 'unsupported', `读调用边失败（${(err as Error).message}）⇒ 判不了`);
          break;
        }
        // ★★★ 2026-10-09：id 约定**实测定证**（别按 DSL 的节点 id 猜）——
        //   索引 `nodes` / `edges` 里符号 id 是 **`<仓库相对路径>#<符号名>`**
        //   （实测：`src/format.ts#total → src/math.ts#add`），
        //   **不是** DSL 的 `file_src_format_ts#total`。
        //   ★ 我初版按 DSL 的 file id 拼 ⇒ 查不到 ⇒ 把"已实现"判成 fail（**假红**）。
        //   ★★ 顺带：`get_dsl query=calls`（`queryFileCalls`）拼的正是 DSL 的 file id
        //     ⇒ **那条路一直是查不到东西的**（独立缺陷，已单独记账）。
        const callerId = `${p}#${e.symbol}`;
        const mine = outgoing.filter((x) => x.caller === callerId);
        // ★★ 守卫（防**假绿**，但不能变成假红）：只有当**整个索引里一条调用边都没有**时，
        //   才说"判不了"（那时是"调用抽取没产出"，不是"这个符号没调用"）。
        //   ★ 初版守卫写的是"该文件一条出调用都没有 ⇒ 判不了" —— **太保守**：
        //     文件本来就不做任何项目内调用是完全正常的状态（实测夹具里 `total` 只调用 `Array.reduce`），
        //     那应当判 **fail**，判"判不了"等于给一个"没实现"的设计开脱。
        if (mine.length === 0) {
          let totalCalls = 0;
          try {
            const row = getProjectCacheDb(root).prepare("SELECT COUNT(*) AS c FROM edges WHERE kind = 'call'").get() as { c?: number } | undefined;
            totalCalls = row?.c ?? 0;
          } catch {
            totalCalls = 0;
          }
          if (totalCalls === 0) {
            push(it, 'unsupported', `本项目索引里**一条调用边都没有**（该语言的调用抽取没产出）⇒ 判不了`);
            break;
          }
        }
        const shortName = (id: string): string => id.slice(id.lastIndexOf('#') + 1);
        const callees = mine.map((x) => shortName(x.callee));
        const hit = mine.find((x) => shortName(x.callee) === e.target);
        push(
          it,
          hit ? 'pass' : 'fail',
          hit
            ? `${p} 的 \`${e.symbol}()\` **调用了** \`${e.target}()\`（L${hit.line}）`
            : `${p} 的 \`${e.symbol}()\` **没有**调用 \`${e.target}()\`` +
              (callees.length ? `；它实际调用的是：${[...new Set(callees)].join(', ')}` : '（该符号没有任何出调用）'),
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
