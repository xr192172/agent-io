/**
 * 项目内 import 路径解析 —— 【唯一实现】
 *
 * ★ 为什么有这个文件（2026-09-28）：这段逻辑曾被复制成 3 份
 *   （`db/symbols.ts`、`health/index.ts`、`impact/index.ts`），其中只有一份处理了
 *   "NodeNext ESM 用 `.js` 引 `.ts`"，另两份漏了 ⇒ 相对 import 解析恒返回 null
 *   ⇒ import 边整条丢失。后果分两层：
 *     ① 量具双向失真：orphan_file 284（92% 假阳）+ layer_violation 0（空转）
 *     ② 产品漏报：impact_analysis（改代码前必查的影响面）少算引用方
 *
 * ★ 设计边界（重要，别把策略塞进来）：
 *   本模块是**纯函数**，只做两件事：
 *     · 生成「项目内路径候选」的有序表（含 `.js`→`.ts` 重试、目录 index 回退、逃逸根剔除）
 *     · 按调用方给的 `exists` 谓词取第一个命中
 *   **不判断**"该不该解析"（相对 import？包导入？）—— 那是调用方的**策略**：
 *     · `db`     ：调用点已用 `imp.kind !== 'relative'` 过滤，且 `import type` 不建边
 *     · `impact` ：额外有包路径回退 `resolvePackageImportDir`
 *     · `health` ：额外有 `!source.startsWith('.')` 早退
 *   ⇒ 策略留在原地，才能保证 `db.resolveImportTarget` 被
 *     `tools/rename_file.ts` 当"路径字面量 → 项目内文件"通用工具复用时行为不变。
 *
 * ★ 与 `resolveProjectImport` 的分工：
 *   `resolveImportPath` = **纯相对路径**候选生成（`.js`→`.ts` 剥扩展名 + index 回退），
 *   被 `db.resolveImportTarget` / `tools/rename_file.ts` 复用，行为不许变。
 *   `resolveProjectImport` = **工程内 import 边**的多层口径（relative / python-dot /
 *   dotted / bare-name / package-dir），是 health/impact 的唯一入口。
 *
 * ★ 两处待统一（本笔不做）：
 *   · `import_project.resolveImport` 仍持一份**多目标（0..n）**版本 —— 下一步统一
 *   · `health` 缺 `impact` 的「裸名全局唯一保底」调用边（分叉 D）—— 待判定是否有意
 */
import path from 'node:path';

/**
 * 可被 import 直接指向的源码扩展名（按优先级）。
 *
 * ★ 与 `TS_JS_EXTS`（`source_exts.ts`）的关系：**本集合是其子集** —— 即「TS/JS 家族里
 *   可被 import 指向的那部分」。**不是另一套同名清单**（过去漏了 `.mts/.cts` 没回填，
 *   2026-10-05 T36 补齐）。改本表前先看 `TS_JS_EXTS`：家族新增扩展名时须同步评估本表。
 *
 * ★ `.mts`/`.cts` **追加在末尾**（非插中间）：现有 6 项的**相对优先级一字不动**，
 *   只让"原本补不到的现在能补到"。代价（如实记）：当 `./x`（无扩展名）且同目录
 *   `x.mts` 与 `x.mjs` **同时存在**时 `.mjs` 先命中；今天该歧义**不存在**
 *   （`.mts` 根本不在候选里）⇒ 选末尾是最小改动。
 */
export const IMPORT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'] as const;

/** 目录级 import（`./foo` → `./foo/index.ts`）的候选文件名。 */
export const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'] as const;

const IMPORT_EXT_SET = new Set<string>(IMPORT_EXTS);

export interface ResolvePathOptions {
  /**
   * 覆盖候选源码扩展名（默认 `IMPORT_EXTS`）。
   * health/impact 传内核的 `codeSourceExts(listSupportedExtensions())`（可解析 ∩ 代码语言，2026-09-29 口径）。
   */
  exts?: readonly string[];
  /** 覆盖目录 index 候选（默认 `INDEX_FILES`）。 */
  indexFiles?: readonly string[];
  /**
   * 候选表里**先放 `base` 自身**。
   *
   * 默认：`base` 带 import 级扩展名时为 `true`，否则 `false` —— 与原三份实现一致
   * （它们对无扩展名的 `base` 只试补全，不试原样；`base` 无扩展名时"原样"本来也不可能是源码文件）。
   *
   * 传 `true` 的场合：调用方面对的是**已经拼好的路径**（绝对路径 / 路径字面量），
   * "原样命中"必须排第一 —— 见 `project_root.resolveToFile`。
   */
  bareBaseFirst?: boolean;
}

/**
 * 给定**已拼好**的路径 `base`，生成补全候选（纯函数，只看字符串，不碰文件系统）。
 *
 * ★ 公开它是为了让**另一族**（绝对路径 + 多语言扩展名，见 `project_root.resolveToFile`）
 *   不必再手写一遍候选生成 —— 那一族的旧实现漏了"剥扩展名重试"，在本仓（961/971 条相对
 *   import 带 `.js`）等于**基本解析不动**，而它正是 `expandClosure` 无索引回退路径的底座。
 *
 * 顺序即优先级：
 *   `base` 带 import 级扩展名（判定集合 = `IMPORT_EXTS`，现含 `.mts/.cts` —— T36 已定，
 *     见 `IMPORT_EXTS` 注释；★ 该判定**不**被 `options.exts` 覆盖，`exts` 只影响补全）：
 *     `base` 原样 → `bare + exts…`（**剥扩展名重试**：NodeNext ESM 源码写 `.js` 指向产物）→ `bare/index…`
 *   否则（无扩展名 / 非 import 级扩展名）：
 *     `exts…` 补全 → `base/index…`
 *   `bareBaseFirst: true` 时在最前面额外插入 `base` 原样（上面第一种情形本就含它，不会重复插入）。
 *
 * 逃逸项目根（结果以 `..` 开头）的候选一律剔除，调用方无需再判。
 *
 * ⚠️ 兼容性怪癖（**故意保留，勿"顺手修正"**）：`join(dirname(fromRel), source)` 之后会先
 *   经 `path.posix.normalize`，所以 `'../../z'`（fromRel 在 `src/a/`）会被**折叠回根**成为 `'z'`，
 *   而不是残留 `..` ⇒ 此时剔除逻辑**不触发**，照样按项目根解析 `z.ts`。
 *   旧的三份实现都是这个行为（守卫条件同为 `startsWith('..')`）。改成"拒绝"会让
 *   `resolveImportTarget` 的既有调用方（含 `tools/rename_file.ts`）行为漂移。
 *   该怪癖已由 `tests/tools/import_resolve.test.ts` 钉住。
 */
export function completionCandidates(base: string, options: ResolvePathOptions = {}): string[] {
  const exts = options.exts ?? IMPORT_EXTS;
  const indexFiles = options.indexFiles ?? INDEX_FILES;
  const baseExt = path.posix.extname(base);
  // ★ T36 已定（2026-10-05）：判定集合 = `IMPORT_EXTS`（`.mts/.cts` 已纳入，**不**在 `exts` 里补）。
  //   曾试过放宽为 `IMPORT_EXTS ∪ exts` —— **否决**：那会让 `exts` 里的一切（`.go/.py`…）翻进
  //   "剥扩展名重试"，实测 `resolveToFile` 出现**跨语言**同名回退（`util.go` → 命中 `util.ts`）= 新错。
  //   ⇒ 正确修法是"把 `.mts/.cts` 补进 `IMPORT_EXTS`"，影响面仅这两者（见 `IMPORT_EXTS` 注释）。
  const isImportExt = IMPORT_EXT_SET.has(baseExt);
  const out: string[] = [];
  if (isImportExt) {
    out.push(base);
    const bare = base.slice(0, -baseExt.length);
    for (const e of exts) out.push(bare + e);
    for (const f of indexFiles) out.push(`${bare}/${f}`);
  } else {
    if (options.bareBaseFirst) out.push(base);
    // ★ 非 import 级扩展名（如显式 `.go`/`.rs`）**不剥** —— 与旧三份实现逐字一致；
    //   需要"剥任意扩展名重试"是另一个策略，别顺手加进来（会让 health/impact 行为漂移）。
    for (const e of exts) out.push(base + e);
    for (const f of indexFiles) out.push(`${base}/${f}`);
  }
  return out.filter((c) => !c.startsWith('..'));
}

/**
 * 生成「项目内相对路径候选」有序表 —— `completionCandidates` 的 import 视角包装。
 * 见 `completionCandidates` 的说明与兼容性怪癖。
 */
export function importPathCandidates(
  fromRel: string,
  source: string,
  options: ResolvePathOptions = {},
): string[] {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), source));
  return completionCandidates(base, options);
}

/** 按 `exists` 谓词取第一个命中的候选；全不命中返回 null。 */
export function resolveImportPath(
  fromRel: string,
  source: string,
  exists: (relPath: string) => boolean,
  options: ResolvePathOptions = {},
): string | null {
  for (const c of importPathCandidates(fromRel, source, options)) {
    if (exists(c)) return c;
  }
  return null;
}

/**
 * 按 `exists` 谓词取第一个命中的候选；全不命中返回 null。
 * 与 `resolveImportPath` 的差别只在**入参形态**：本函数收已经拼好的 `base`
 * （绝对路径 / 路径字面量均可），不自己做 dirname+join —— 供 `project_root.resolveToFile` 等复用。
 */
export function resolveExistingPath(
  base: string,
  exists: (candidate: string) => boolean,
  options: ResolvePathOptions = {},
): string | null {
  for (const c of completionCandidates(base, options)) {
    if (exists(c)) return c;
  }
  return null;
}

// ── resolveProjectImport：工程内 import 边的唯一实现（2026-09-30） ──────────────────────

/** 命中的**层**：这条边是哪条口径建起来的（回执可见性用） */
export type ProjectImportLayer = 'relative' | 'python-dot' | 'dotted' | 'bare-name' | 'package-dir';

export interface ProjectImportHit {
  /** 命中项目内文件（相对项目根、posix）；null = 指向项目外 / 无法唯一定位 */
  rel: string | null;
  /** 命中的层；rel 为 null 时为 null */
  layer: ProjectImportLayer | null;
  /** 试过的候选（按序，含各层的 completionCandidates 展开）—— 让"为什么没建边"可查证 */
  tried: readonly string[];
}

/**
 * `resolveProjectImport` 的选项 —— 与 `ResolvePathOptions` 同形。
 *
 * ★ 2026-10-04：原 `goModules` 字段（及它驱动的 `go-module` 层）已删除。
 *   取证：全仓三处调用点 `import_project.ts:461` / `impact/index.ts:128` / `health/index.ts:631`
 *   都只传 `{ exts }`，**无一传 `goModules`** ⇒ 该分支恒不进入（静态取证：grep 全仓
 *   `resolveProjectImport` 调用点 + `goModules` 赋值点，无测试传它）。
 *   且语义与消费者不符：`go-module` 层取目录内**首个**文件，而 Go 包是**多文件**——
 *   `import_project` 因此**自持**多目标 Go 解析（`import_project.ts:450` 取全部文件）；
 *   health/impact 若接上只会把包内其余文件误报成孤儿 ⇒ 单目标代表对谁都不对。
 *   与 `package-dir` 层「恰好一个」的**不对称**（前者取首个、后者要唯一）也是同一病根：
 *   该层从未被真实消费者校准过。删掉它**不可能改变任何可观测行为**（分支恒不进入）。
 */
export type ProjectImportOptions = ResolvePathOptions;

/**
 * 把一条 import source 解析到**项目内文件** —— 【唯一实现】。
 * `rels` = 项目内源码文件相对路径全集（posix）。
 *
 * ★ 分派规则按 source 字面量形状（非 `ParsedImport.kind`）：
 *   1. `relative`     : `^\.\.?/`  → 复用 `resolveImportPath`（**含** `.js`→`.ts` 剥扩展名重试 + index 回退）
 *   2. `python-dot`   : `^\.+$` 或 `^\.+[^./]`  → Python 包相对：dots 跳级 + 点分转路径
 *   3. `dotted`       : `^[\w][\w.]*$` 且含 `.`  → 点分模块 → `/` 路径，试**每个可能的包根**
 *                        （项目根 + 导入者上方逐层 ⇒ Maven 布局 `src/main/java/` 也能命中）
 *   4. `bare-name`    : `^[\w]+$`  → 先导入者同目录，再项目根
 *   5. `package-dir`  : 其余（含 `a/b` 形式）→ 照抄 impact 的 resolvePackageImportDir 语义（宁漏不错）
 *
 * ★ 2026-10-04：原第 5 层 `go-module` 已删除（无任何调用方传 `goModules` ⇒ 恒不进入；
 *   且"取目录内首个文件"与 Go 多文件包语义不符，见 `ProjectImportOptions` 注释）。
 *
 * ★★ 层间是**串行假设**，不是互斥分类（`2`~`4` 未命中**继续往下试**，只 `1` 早退）：
 *   这五层是"这条串**可能**用的是哪种语言约定"的**假设表** —— 我们并不知道它属于哪种，
 *   所以某一层没命中**不等于**"它指向项目外"，只是"这个假设不成立"。旧 `impact` 就是这么做的
 *   （`resolveImportFile` 失败后串行回退 `resolvePackageImportDir`），串行是**既定语义**。
 *   ★ 为什么 `relative` 例外：`./x` 是一个**已知缺失**的文件（语法上就写明按路径找），
 *   不是"未知约定" ⇒ 再拿它去撞目录式尾段匹配只会造出假边。
 */
export function resolveProjectImport(
  fromRel: string,
  source: string,
  rels: ReadonlySet<string>,
  options?: ProjectImportOptions,
): ProjectImportHit {
  // ★ 只有**显式传了** exts 才覆盖：`{ exts: options?.exts ?? [] }` 会让"未传"变成"空表"，
  //   而 `completionCandidates` 的 `options.exts ?? IMPORT_EXTS` 对空数组**不**兜底
  //   ⇒ 补全候选整条消失（实测：`{exts:[]}` 只剩 4 个 index 候选，`{}` 有 10 个），
  //   且**不报错**。调用方漏传时静默失能 ⇒ 这里必须区分 undefined 与 []。
  const opts: ResolvePathOptions = options?.exts ? { exts: options.exts } : {};
  const tried: string[] = [];

  // 1. relative
  if (/^\.\.?\//.test(source)) {
    for (const c of importPathCandidates(fromRel, source, opts)) {
      tried.push(c);
      if (rels.has(c)) return { rel: c, layer: 'relative', tried };
    }
    return { rel: null, layer: null, tried };
  }

  // 2. python-dot：前导点 = 包相对（Python `from .helper import twice`）
  if (/^\.+$/.test(source) || /^\.+[^./]/.test(source)) {
    const dots = source.match(/^\.+/)?.[0].length ?? 0;
    const rest = source.slice(dots);
    // 从 dirname(fromRel) 向上跳 (dots.length - 1) 级（`.helper` = 当前包，不跳）
    const jump = Math.max(0, dots - 1);
    let base = path.posix.dirname(fromRel);
    for (let i = 0; i < jump; i++) base = path.posix.dirname(base);
    // 点分模块 → 路径
    const asPath = rest.replace(/\./g, '/');
    const target = asPath ? path.posix.join(base, asPath) : base;
    for (const c of completionCandidates(target, opts)) {
      tried.push(c);
      if (rels.has(c)) return { rel: c, layer: 'python-dot', tried };
    }
    // 未命中 ⇒ **继续往下试**（层间是串行假设，见函数头注）
  }

  // 3. dotted：点分模块名（如 `app.Helper` → `app/Helper`）
  if (/^[\w][\w.]*$/.test(source) && source.includes('.')) {
    const asPath = source.replace(/\./g, '/');
    // ★ 试**每一个可能的包根**：先项目根，再导入者上方逐层（浅 → 深）。
    //   为什么要逐层（这一条是**本笔新增的能力**，不是对旧实现的移植）：旧实现只试
    //   `['', importer.dir]` 两个根，而真实的 Java/Scala/Groovy 工程是 Maven 布局
    //   （`src/main/java/app/Use.java` 里写 `import app.Helper`）—— 包根是 `src/main/java`，
    //   既不是项目根（`app/Helper` 落空）也不是导入者同层（`src/main/java/app/app/Helper` 落空）
    //   ⇒ 这层在真实工程上会**静默恒 null**，只在"仓库根恰好等于包根"的夹具上成立。
    //   逐层试是对旧串行假设的**单调放宽**（只增候选，不改既有顺序）⇒ 不会让已能解析的变解析不到。
    const dir = path.posix.dirname(fromRel);
    const ancestors: string[] = [];
    for (let d = dir; d && d !== '.' && d !== '/'; d = path.posix.dirname(d)) ancestors.push(d);
    const bases = ['', ...ancestors.reverse()]; // 浅 → 深（项目根优先，与旧实现同序）
    for (const base of bases) {
      const target = base ? path.posix.join(base, asPath) : asPath;
      for (const c of completionCandidates(target, opts)) {
        tried.push(c);
        if (rels.has(c)) return { rel: c, layer: 'dotted', tried };
      }
    }
    // 未命中 ⇒ **继续往下试**（层间是串行假设，见函数头注）
  }

  // 4. bare-name：单段裸名（如 `Helper`、`Lib`）
  if (/^[\w]+$/.test(source)) {
    for (const base of [path.posix.join(path.posix.dirname(fromRel), source), source]) {
      for (const c of completionCandidates(base, opts)) {
        tried.push(c);
        if (rels.has(c)) return { rel: c, layer: 'bare-name', tried };
      }
    }
    // 未命中 ⇒ **继续往下试**（层间是串行假设，见函数头注）
  }

  // 5. package-dir：照抄 impact/index.ts resolvePackageImportDir（宁漏不错）
  {
    const seg = source.split('/').filter(Boolean);
    if (seg.length > 0) {
      const direct = path.posix.join(...seg);
      const directCand = [...rels].filter((r) => r === direct || path.posix.dirname(r) === direct);
      if (directCand.length === 1) {
        tried.push(...directCand);
        return { rel: directCand[0], layer: 'package-dir', tried };
      }
      const tail = seg[seg.length - 1];
      const tailCand = [...rels].filter((r) => path.posix.basename(path.posix.dirname(r)) === tail);
      if (tailCand.length === 1) {
        tried.push(...tailCand);
        return { rel: tailCand[0], layer: 'package-dir', tried };
      }
      // 两种都不满足唯一性，宁漏不错
    }
  }

  return { rel: null, layer: null, tried };
}
