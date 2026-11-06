/**
 * judge_facts.ts —— `run` 判据的**只读事实门面**（T-19，2026-11-06）
 *
 * ## 它为什么存在（用户裁定：**读数判据 → 能力判据**）
 * 能力判据要问的是「**册里的东西与实际符不符**」。而 `run` 的求值域只有
 * `input / root / validateDSL / fs / path` ⇒ 判据**拿不到"实际侧的符号事实"**，
 * 于是只能退回去数数字（`n >= 3068`）。实测那条数字判据的两种失效方向都是真的：
 *   · **误报**：有人**正确地**删掉一个空壳文件（`T-04-16b`）⇒ 它红；
 *   · **漏报**：5 个文件从没被派生（`cache.db` 有导出、册里 `expected_apis` 为空）⇒ 它绿。
 * ⇒ 读数既不能指代功能是否正确，也不能指代问题在哪。本门面把"实际侧的事实"变成判据可用的**同步只读方法**。
 *
 * ## ★★★ 它问的**不是**「此刻代码有什么」—— 那句话必须现解析
 * 本仓有一条出生证事故（`expectations.ts` 文件头纪律 1）：`symbol-exists` 初版用 `fileFacts`
 * （读 `cache.db`）判「此刻的代码」，于是源码里符号删了它仍报「有」⇒ **假绿**。
 * **本门面不是那一类**，因为它回答的是另一句话：
 *
 *   「**派生把它看见的东西写进册了吗**」 —— 对拍对象就是**派生源本身**（`cache.db`）。
 *
 * 派生写端（`meta/registry/project_actual_fields.ts`）读的就是 `cache.db`，所以
 * "派生有没有漏"只能对着**它读的那份事实**问。拿现解析去问会得到另一个问题
 * （"代码此刻有什么" —— 那由 `symbol-exists` / `signature-matches` / `drift` 负责），
 * 而且代价差 **1600×**（实测 496 个在册文件：`cache.db` 一次查询 **37ms** vs
 * `parseFileFullSync` **59.5s**）—— 判据要在 `npm run verify` 里每次跑，所以走索引。
 * ★ 而"索引可不可信"**不许静默**：由 {@link JudgeFacts.stalenessOf} 与
 * `exportedApisOf` 的 `ok:false` 显式暴露（陈旧 ⇒ 判不了，不是通过）。
 *
 * ## 边界（**它不该带什么** —— 与"它能带什么"同等重要）
 * · ❌ **签名逐字比对**：已有 `signature-matches` / `drift` / `req-baseline` 门，
 *   再给一份就是**第二把尺**（0.9.1）；且人写契约本就允许**超出**代码。
 * · ❌ **「代码有的必须都在册」**：那是 T85/D1b **已废**的 `unexpected`
 *   （期望侧=实现侧 ⇒ 自己测自己）。★★ **新口子最容易把已废掉的东西请回来，所以这里明写不许**。
 * · ❌ **任意 `query(sql)`**：口径会散进几百条判据，且等于把整个索引暴露给判据作者 ——
 *   门面只回答**一个问题**（"这个文件此刻有哪些导出 API"）。
 * · ❌ 写 / 目录枚举 / 时钟 / 随机 / 进程 / 网络：见 {@link READ_ONLY_FS} 与词表闸。
 *
 * ## 口径只许一处
 * 「什么算一条导出 API」= `isApiSymbol`（`meta/registry/project_actual_fields.ts`，与**派生写端同一把尺**）；
 * 「索引是否陈旧」= `indexStaleFor`（`expectations.ts`，唯一住处，**注入进来**以免本模块反向依赖执行核）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../../../infrastructure/index/db.js';
import { isApiSymbol } from '../../meta/registry/project_actual_fields.js';
import { normPath } from '../../../domain/expectation.js';

/** 一条「导出 API」的最小事实（判据只需要"有没有 / 叫什么"，签名只作留痕） */
export interface ExportedApi {
  name: string;
  signature: string | null;
}

/**
 * 「这个文件的导出 API」三态结果。
 *
 * ★ 为什么 `ok:false` 必须与 `ok:true + symbols:[]` **分开**：
 * 前者是「**没查成**」（文件不在盘上 / 索引里没有它 / 索引陈旧），后者是
 * 「**查成了，确实一条导出都没有**」。混成一个空数组 ⇒ 判据会把"判不了"读成"没问题"（0.12）。
 */
export type ExportedApisResult =
  | { ok: true; language: string | null; symbols: ExportedApi[] }
  | { ok: false; why: string };

/** 逐文件陈旧/未知分类（判据据此把结论写成"判不了"而不是"通过"） */
export interface StalenessReport {
  /** 索引与磁盘不一致（内容哈希比过） */
  stale: string[];
  /** 盘上没有这个文件（或读不出） */
  unknown: string[];
}

/** 门面的依赖（注入 ⇒ 本模块不反向依赖执行核；也让单测能用 `:memory:` 库） */
export interface JudgeFactsDeps {
  /**
   * 该项目符号索引的**已开连接**；`null` = **该项目还没有索引**。
   *
   * ★★ 为什么允许 `null`，而不是"调用方保证有库"：`getProjectCacheDb` 会在**无索引的项目里
   *   造出一个空 `cache.db`** 并持有句柄 ⇒ Windows 上临时目录测试的 `rmSync` 直接 EBUSY
   *   （`infrastructure/index/db.ts:129-131` 记着这笔账）。判据不该因为"判了一下"就给项目建库，
   *   更不该把临时目录锁住。
   */
  db: Database | null;
  /** 唯一权威 = `expectations.ts#indexStaleFor`：非 null = "索引与源码不一致"的人话原因 */
  staleOf(relPath: string): string | null;
}

/**
 * `run` 判据能用的**全部**事实能力 —— 就这两个方法。
 *
 * ★★ 面必须**窄且可锁死**：册里有一条判据断言的恰是这张面
 * （`Object.keys(facts)` 逐字为 `['exportedApisOf','stalenessOf']`）——
 * 以后谁往门面加第三个方法，那条判据当场红。**新口子必须有人看着。**
 */
export interface JudgeFacts {
  /** 该文件此刻**索引里**的导出 API（口径 = `isApiSymbol`，与派生写端同一把尺） */
  exportedApisOf(relPath: string): ExportedApisResult;
  /** 这些文件的索引可不可信（`stale` = 与磁盘不一致；`unknown` = 盘上没有） */
  stalenessOf(paths: readonly string[]): StalenessReport;
}

const norm = normPath;

/**
 * 构造门面（**纯函数式、同步、只读**：不写盘、不枚举目录、不读时钟/随机/进程）。
 *
 * @param root 被判定项目的根（与 `judgeExpectations(root, …)` 同一个 `root`）
 * @param deps 库与陈旧探测（都注入，便于单测与"唯一权威"复用）
 */
export function createJudgeFacts(root: string, deps: JudgeFactsDeps): JudgeFacts {
  const { db } = deps;

  /** 该文件在索引 `files` 表里有没有行（没有 ⇒ 它从没被走查过，不是"没有导出"） */
  // ★ 连接显式传参（而不是闭包捕获 `db`）：`db` 可以是 `null`（无索引）⇒ 传参让"必须先过 null 闸"
  //   这件事由**类型**保证，而不是靠调用方记得先判。
  const indexedHashOf = (conn: Database, rel: string): string | null => {
    const row = conn.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: rel }) as
      | { content_hash?: string }
      | undefined;
    return row?.content_hash ?? null;
  };

  const symbolsOf = (
    conn: Database,
    rel: string,
  ): Array<{ name: string; signature: string | null } & Record<string, unknown>> => {
    const rows = conn
      .prepare(
        'SELECT name, kind, signature, modifiers, language, is_closure FROM nodes WHERE file_path = $p ' +
          'ORDER BY start_line, name',
      )
      .all({ p: rel }) as Array<Record<string, unknown>>;
    return rows
      .filter((r) => !r.is_closure)
      .filter((r) =>
        isApiSymbol({
          name: r.name as string | null,
          kind: r.kind as string | null,
          signature: r.signature as string | null,
          modifiers: (r.modifiers as string | null) ?? null,
          language: (r.language as string | null) ?? null,
        }),
      )
      .map((r) => ({ ...r, name: String(r.name), signature: (r.signature as string | null) ?? null }));
  };

  return {
    exportedApisOf(relPath: string): ExportedApisResult {
      const rel = norm(relPath);
      /** ★ 四者都返回 `ok:false`（= 判不了），绝不冒充"没有导出" */
      if (!db) {
        return {
          ok: false,
          why: '该项目还没有符号索引（`.agent-io/cache.db` 不存在）⇒ 判不了；' +
            '修法：跑一次 `import_project`（默认只刷新"实际"、不碰设计）',
        };
      }
      if (!rel) return { ok: false, why: '路径为空 ⇒ 判不了' };
      if (!fs.existsSync(path.join(root, rel))) {
        return { ok: false, why: `盘上没有 \`${rel}\`（册里有、代码没有）⇒ 判不了` };
      }
      const stale = deps.staleOf(rel);
      if (stale) return { ok: false, why: stale };
      if (indexedHashOf(db, rel) === null) {
        return {
          ok: false,
          why:
            `索引里没有 \`${rel}\`（从没被走查过）⇒ 它的符号事实取不到，判不了。` +
            `\n     修复动作：跑一次 \`import_project\`（默认只刷新"实际"、不碰设计）`,
        };
      }
      const syms = symbolsOf(db, rel);
      const language = syms.length ? String((syms[0] as { language?: unknown }).language ?? '') || null : null;
      return { ok: true, language, symbols: syms.map((s) => ({ name: s.name, signature: s.signature })) };
    },

    stalenessOf(paths: readonly string[]): StalenessReport {
      const stale: string[] = [];
      const unknown: string[] = [];
      for (const p of paths) {
        const rel = norm(p);
        if (!rel) continue;
        if (!fs.existsSync(path.join(root, rel))) {
          unknown.push(rel);
          continue;
        }
        try {
          if (deps.staleOf(rel) !== null) stale.push(rel);
        } catch {
          // 探测本身出错 ⇒ 记成"未知"（判据会判不了，绝不静默当通过）
          unknown.push(rel);
        }
      }
      return { stale, unknown };
    },
  };
}

/**
 * `run` 判据拿到的 `fs` —— **只读白名单**（T-19，2026-11-06）。
 *
 * ## 为什么不给真的 `node:fs`
 * `run` 的纪律一直是「**只许读 + 判**，不许有副作用」（见 `expectations.ts` 的 `case 'run'`），
 * 但那只是**文档纪律** —— 判据作者写 `fs.writeFileSync(...)` 照样能跑。门面一进门，
 * 「只读」就该从**纪律**变成**结构**：注入的 `fs` 上**没有**写函数 ⇒ 写调用在运行期直接不可达。
 *
 * ★ 为什么不用「词表里加写原语」那条更省事的路（实测否掉了）：本仓**已经有一条真判据**
 *   在文本里出现 `fs.writeFileSync(` —— 它断的是**源码文件的内容**
 *   （`file_src_application_design_dsl_ops_update_feature_ts#4`：
 *   `s.includes('fs.writeFileSync(designFile, rawBackup')`）。词表法分不清
 *   「判据自己要写」与「判据在读别人写的字」⇒ **误伤真判据**（0.12：误伤比漏防更坏）。
 *   结构法从构造上就没有这个问题：字符串里的字一个都拦不到，而**任何**写调用都不可达
 *   （含 `fs['write'+'FileSync']` 这种绕写法）。
 *
 * ★ 白名单按**存量实测**取（209 条 `run` 判据里真实用到的只有 `readFileSync` / `existsSync`），
 *   另外补三个纯读的元信息函数供将来用；**目录枚举不给**（`readdir` 已被词表闸判为环境态）。
 */
export const READ_ONLY_FS: Readonly<Record<string, unknown>> = Object.freeze({
  readFileSync: fs.readFileSync.bind(fs),
  existsSync: fs.existsSync.bind(fs),
  statSync: fs.statSync.bind(fs),
  lstatSync: fs.lstatSync.bind(fs),
  realpathSync: fs.realpathSync.bind(fs),
});
