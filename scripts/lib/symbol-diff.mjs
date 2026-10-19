#!/usr/bin/env node
/**
 * symbol-diff.mjs —— 「设计 DB vs 源码」的**唯一**符号级判据（⑥ 结构重写的地基）
 *
 * ## 为什么要抽成一个模块（2026-10-19）
 * 这条判据此前**住了两处、各持一份**：
 *   · `design-diff.mjs --signature`：按 `kind` 决定可比性 + 按 (name, line 最近) 配对  ← 正确
 *   · `rewrite.mjs`：按 `name` 配对 + 只比存在性                                ← 坑 #6（同名多义被并成一个）
 * ⇒ 同一条规则两处实现，是最容易"改一处漏一处"的形态。这里只留一份，两边都消费它。
 *
 * ## 判据的三条纪律（都是踩出来的）
 * ① **一个符号是否可比，由它的 `kind` 决定**，而不是"一律比 signature"
 * ```
 * kind       可比字段     依据
 * function   signature    两侧都完整（AST 抽的是原文片段）
 * class      ✗           实测两侧都是 `Name()`
 * type       ✗           两侧都没有成员列表
 * interface  ✗           同上
 * const      ✗           实际侧被截断到 60 字符（假阳性来源）
 * ```
 * ② **`uncompared` 必须显式报数** —— 把它算进"一致"是最坏的一种谎
 * ③ **配对键不能只用 `name`** —— `server.ts` 里两处 `const resources` 是【两个符号】
 *    ⇒ 先按 name 分桶，桶内按 `line 距离最近`配对；配不上的进 `unpaired`，不判 same/differ
 *
 * ## 为什么不用 `cache.db.nodes.signature`
 * 它被格式化成 `name()`（实测 `CardStanding()`），丢了参数 ⇒ 拿它比必然假阳性。
 * 实际侧一律**现场 `parseFileFull`**。
 *
 * ## 数据源
 * 设计侧：`certs/design-db/<a-b>.calls.json` 的 `symbols[]`
 *         （源码路径藏在 `//` 的说明里；`//source` 是设计 DSL 的路径，不是源码路径）
 * 实际侧：对源码现场 `parseFileFull`
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BS = String.fromCharCode(92);
const norm = (s) => String(s ?? '').split(BS).join('/');

/** kind → 用哪个字段比；null = 不可比（见头注 ①） */
export const COMPARABLE = {
  function: 'signature',
  class: null,
  type: null,
  interface: null,
  const: null,
};

/**
 * ★ 设计 DB **会收录的 kind**（决定 `sourceOnly` 该数什么）。
 *
 * 实测（2026-10-19）：`design-db` 的 `symbols[]` 只收**顶层符号**——
 * `simulation_engine.ts` 设计侧 4 条（interface 2 / class 1 / function 1），
 * 现场 `parseFileFull` 19 条（多出 15 个 `method`）。
 *
 * ⇒ 若把 `method` 也算进 `sourceOnly`，就会报出 82 条"设计漏了"的**假差异**
 *   （设计 DB 从来没有、也不打算收方法）。
 * ⇒ 这是"先问我要数的是哪个问题"：`sourceOnly` 数的是
 *   **"现行设计 DB 口径下，本该有却没有的符号"**，不是"源码里的一切符号"。
 * ⇒ 口径外的 kind 一律进 `uncompared`，**显式报数**（不假装它是差异，也不假装它一致）。
 */
export const DESIGN_DB_KINDS = new Set(['function', 'class', 'type', 'interface', 'const']);

const inDesignScope = (kind) => DESIGN_DB_KINDS.has(kind);

/**
 * ★ 设计 DB 只收**顶层**符号 ⇒ `sourceOnly` 也必须只数顶层。
 *
 * 实测（2026-10-19）：报出 12 条"设计漏了"的 interface，逐个查全是**函数体内的局部类型**
 * （`live_render.ts` 的 `DirNode` 其 `parent = renderLiveFromDb`）。
 * ⇒ 非顶层的一律进 `uncompared`，不冒充"设计漏了"。
 */
const isTopLevel = (sym) => sym.parent == null;

/** 从设计 DB 的 `//` 说明里取源码相对路径 */
function sourceRelOf(dd) {
  const m = String(dd['//'] ?? '').match(/(src\/[^\s（(]+)/);
  return m ? norm(m[1]) : '';
}

/** 按 name 分桶（同名多义 = 桶里多个） */
function byName(syms) {
  const map = new Map();
  for (const s of syms) {
    if (!map.has(s.name)) map.set(s.name, []);
    map.get(s.name).push(s);
  }
  return map;
}

/**
 * 算差异（**只读**，不写任何文件）。
 *
 * @param {object} args
 * @param {string} args.projectDir            仓库根（绝对路径）
 * @param {string} [args.designDbDir]         `certs/design-db`
 * @param {(abs:string, content:string)=>Promise<any>} [args.parseFileFull]  默认从 dist 动态载入
 * @param {string} [args.onlyFile]            只算一个文件（相对 projectDir）
 * @param {string} [args.prefix]              只算某个前缀
 * @returns {Promise<{
 *   scanned:number,
 *   same:Array<{file:string,name:string,kind:string}>,
 *   differ:Array<{file:string,name:string,kind:string,dLine:number,aLine:number,old_text:string,new_text:string}>,
 *   uncompared:Map<string,number>,
 *   unpaired:Array<{file:string,name:string,why:string}>,
 *   designOnly:Array<{file:string,name:string,kind:string,line:number}>,
 *   sourceOnly:Array<{file:string,name:string,kind:string,line:number}>,
 * }>}
 */
export async function diffSymbols(args) {
  const projectDir = path.resolve(args.projectDir);
  const designDbDir = args.designDbDir ?? path.join(projectDir, 'certs', 'design-db');

  let parseFileFull = args.parseFileFull;
  if (!parseFileFull) {
    const kernel = pathToFileURL(path.join(projectDir, 'dist/src/infrastructure/parse/kernel.js')).href;
    parseFileFull = (await import(kernel)).parseFileFull;
  }

  const same = [];
  const differ = [];
  const uncompared = new Map();
  const unpaired = [];
  const designOnly = [];
  const sourceOnly = [];
  let scanned = 0;

  if (!fs.existsSync(designDbDir)) {
    return { scanned, same, differ, uncompared, unpaired, designOnly, sourceOnly };
  }

  const want = (rel) =>
    (!args.onlyFile || rel === norm(args.onlyFile)) &&
    (!args.prefix || rel.startsWith(args.prefix.replace(/^\.?\//, '')));

  for (const f of fs.readdirSync(designDbDir).filter((x) => x.endsWith('.calls.json')).sort()) {
    const dd = JSON.parse(fs.readFileSync(path.join(designDbDir, f), 'utf8'));
    const rel = sourceRelOf(dd);
    if (!rel.startsWith('src/')) continue;
    if (!want(rel)) continue;

    const abs = path.join(projectDir, rel);
    if (!fs.existsSync(abs)) {
      // 设计 DB 有、源码文件没了 ⇒ 整份都是"设计领先"
      for (const d of dd.symbols ?? []) {
        designOnly.push({ file: rel, name: d.name, kind: d.kind ?? 'unknown', line: d.line ?? -1 });
      }
      continue;
    }
    scanned++;

    const parsed = await parseFileFull(abs, fs.readFileSync(abs, 'utf8'));
    const dByName = byName(dd.symbols ?? []);
    const aByName = byName(parsed.symbols ?? []);

    for (const [name, ds] of dByName) {
      const as = aByName.get(name);
      if (!as) {
        for (const d of ds) designOnly.push({ file: rel, name, kind: d.kind ?? 'unknown', line: d.line ?? -1 });
        continue;
      }

      // 桶内配对：按 line 距离最近（同名多义时唯一可靠的消歧）
      const usedA = new Set();
      for (const d of ds) {
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < as.length; i++) {
          if (usedA.has(i)) continue;
          const dist = Math.abs((as[i].start_line ?? 0) - (d.line ?? 0));
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        }
        if (best < 0) {
          unpaired.push({ file: rel, name, why: '设计侧多出 1 处' });
          continue;
        }
        usedA.add(best);
        const a = as[best];

        const field = COMPARABLE[d.kind] ?? null;
        if (!field) {
          const key = d.kind ?? 'unknown';
          uncompared.set(key, (uncompared.get(key) ?? 0) + 1);
          continue;
        }
        const dv = String(d[field] ?? '').trim();
        const av = String(a[field] ?? '').trim();
        if (!dv || !av) {
          const key = `${d.kind}(空值)`;
          uncompared.set(key, (uncompared.get(key) ?? 0) + 1);
          continue;
        }
        if (dv === av) same.push({ file: rel, name, kind: d.kind });
        else
          differ.push({
            file: rel,
            name,
            kind: d.kind,
            dLine: d.line ?? -1,
            aLine: a.start_line ?? -1,
            old_text: av,
            new_text: dv,
          });
      }

      // 实际侧多出来的同名符号 ⇒ 设计漏了（进 sourceOnly，不是 unpaired 的职责）
      // ★ 只数"设计 DB 口径内且顶层"的：method 之类设计从不收录、局部类型不是顶层 ⇒ 都进 uncompared
      for (let i = 0; i < as.length; i++) {
        if (usedA.has(i)) continue;
        const kind = as[i].kind ?? 'unknown';
        if (inDesignScope(kind) && isTopLevel(as[i])) sourceOnly.push({ file: rel, name, kind, line: as[i].start_line ?? -1 });
        else if (!inDesignScope(kind))
          uncompared.set(`${kind}(设计DB不收录)`, (uncompared.get(`${kind}(设计DB不收录)`) ?? 0) + 1);
        else uncompared.set(`${kind}(局部声明)`, (uncompared.get(`${kind}(局部声明)`) ?? 0) + 1);
      }
    }

    // 实际侧有、设计侧压根没这个名字
    for (const [name, as] of aByName) {
      if (dByName.has(name)) continue;
      for (const a of as) {
        const kind = a.kind ?? 'unknown';
        if (inDesignScope(kind) && isTopLevel(a)) sourceOnly.push({ file: rel, name, kind, line: a.start_line ?? -1 });
        else if (!inDesignScope(kind))
          uncompared.set(`${kind}(设计DB不收录)`, (uncompared.get(`${kind}(设计DB不收录)`) ?? 0) + 1);
        else uncompared.set(`${kind}(局部声明)`, (uncompared.get(`${kind}(局部声明)`) ?? 0) + 1);
      }
    }
  }

  return { scanned, same, differ, uncompared, unpaired, designOnly, sourceOnly };
}

/** `uncompared`（Map）→ 总数 */
export function uncomparedTotal(uncompared) {
  let n = 0;
  for (const v of uncompared.values()) n += v;
  return n;
}
