/**
 * observe · java 插桩语言包 —— 由 `npm run new-observe-lang java` 生成的**填空题**。
 *
 * ─────────────────────────────────────────────────────────────
 * ★★ 为什么是「填空题」而不是"抄一大坨"
 * 骨架（`instrument_skeleton.ts`）已经把**语言无关**的那几格全包了：
 *   ③ 应用模型（分段拼接）· ④ sink 契约 · ⑤ 错误传播 · 主流程（读盘/幂等/解析/应用/备份/写盘）·
 *   项目级四件（收文件 / 数函数 / 向上找根 / 逐文件循环）。
 * ⇒ 一门新语言要决定的**只剩这三件事**，各对应**一个具名函数**：
 *
 *   ① **命名规则** `probeNameOf(fn, mod)`  —— 这个函数叫什么探针名
 *   ② **遍历模型** `scanFunctions(root)`   —— 函数在哪、它的 body 是哪一段
 *   ⑥ **取值时机** `returnValueOf(ret)`    —— `return` 的返回值是哪个节点（没有则 null）
 *
 * 外加**两个语句渲染件**（`probeCall` / `buildImport`）与一份**语法小抄** `SYNTAX`
 *   —— 它们是字符串与数据，照邻语改写即可，不是逻辑。
 *
 * ★★★ **没填的格子会当场抛错**，并告诉你"该填哪个文件的哪个函数" ——
 *   不会静默产出跑不起来的代码（ARC-7）。⇒ 想让它从红变绿，照报错填就行。
 *
 * ★ 填空的判据（T263/T277/T298/T303 四次踩出来的）：
 *   **合成名必须含「所属」与「位置」** —— 只给函数名会撞
 *   （同名方法 / 两个匿名块 / get-set / 重载 / 实例方法与类方法同名）。
 * ─────────────────────────────────────────────────────────────
 */

import path from 'node:path';
import {
  collectSourceFiles,
  instrumentFileWithHooks,
  instrumentProjectWithHooks,
  isBracelessBodyReturn,
  matchesContract,
  type AstNode,
  type CollectSitesCtx,
  type InstrumentHooks,
} from './instrument_skeleton.js';
import type { InstrumentFileResult, InstrumentOptions } from './instrument.js';

/**
 * 控制语句节点类型表（判「return 是无花括号单语句体」用，判据住骨架 `isBracelessBodyReturn`）。
 * ★ tree-sitter-java **没有** `else_clause` 节点（TS 有）—— else 体是 `if_statement` 的直接子节点
 *   ⇒ 父类型一并覆盖（`if (c) return 1; else return 2;` 两个分支的 return 父节点都是 if_statement）。
 */
const JAVA_GUARD_TYPES = new Set([
  'if_statement',
  'for_statement',
  'enhanced_for_statement',
  'while_statement',
  'do_statement',
  'labeled_statement',
]);

/** 探针运行时在被插桩工程里的落点（相对 agent-io 仓库根的 posix 路径）。 */
const PROBE_DIR_REL = 'observe-lang-java';
const PROBE_MODULE = 'Camprobe';
const LANG_ID = 'java';
const MARKER = 'observe:instrumented';
const DEEP_MARKER = 'observe:deep';

/** ② 遍历模型：一个「函数」槽位。① ⑥ 都从它出发表。 */
export interface JavaFnSlot {
  node: AstNode;
  /** 「函数」节点的类型原文（同名去重 / 诊断用） */
  kind: string;
  /** 所属链（类 / 模块 / 外层函数），由 ② 的遍历随层级累积；空串 = 顶层 */
  owner: string;
  /** 该语言的「函数名」原文（① 用它拼最终探针名） */
  name: string;
  /** 形参名（已跳过 self/cls 之类） */
  params: string[];
  /** 函数体节点（enter/exit 往这里注入）；null = 没有可注入的体 ⇒ 记 0 探针 */
  body: AstNode | null;
}

// ═════════════════════════════════════════════════════════════
// ① 填空：**命名规则**
// ═════════════════════════════════════════════════════════════

/**
 * ① 探针最终名（**完整**，含模块前缀）。
 * ★ `mod` = 文件名去扩展名（骨架给出）；`owner` 已在 ② 里按"文件作用域以下"的层级攒好。
 */
/**
 * ① Java：`<文件作用域>.<owner 链>.<函数名>`。
 * ★ **顶层类名不进 owner** —— 它等于 `mod`（文件名去 .java），再拼一次就成了 `Box.Box.get`
 *   （本证第一次跑就撞到的真 bug）；**嵌套类**才进（`Box.Inner.m`）。
 * ★ 构造器与类同名 ⇒ 用 `<init>` 与实例方法分开（否则与 `new Box()` 撞语义）。
 */
export function probeNameOf(fn: JavaFnSlot, mod: string): string {
  const nm = fn.kind === 'constructor_declaration' ? '<init>' : fn.name;
  return [mod, fn.owner, nm].filter(Boolean).join('.');
}

// ═════════════════════════════════════════════════════════════
// ② 填空：**遍历模型**
// ═════════════════════════════════════════════════════════════

/**
 * ② 扫出文件里所有「函数」槽位（含嵌套 / 方法 / 构造器 / 匿名块）。
 * ★ `owner` 要随层级传递（进类 ⇒ 类名，进函数 ⇒ 函数名），① 才能拼出带所属的名字。
 * ★ 同名去重建议在这一步做（一个 owner 下同名 ⇒ 追加 `@L<行>C<列>`）——
 *   Java 重载 / Ruby 实例与类方法同名 / get-set 都会撞（T303）。
 */
export function scanFunctions(root: AstNode): JavaFnSlot[] {
  // ★ 根节点的**直接子节点** = 顶层声明 ⇒ 这些类/接口/枚举就是**文件作用域**：
  //   它们的名字已由 `mod`（文件名去 .java）承载，再进 owner 就会变成 `Box.Box.get`
  //   （本证第一次跑就撞到的真 bug）。**嵌套**的才进 owner。
  const topLevel = new Set<AstNode>();
  for (let i = 0; i < root.childCount; i++) {
    const c = root.child(i);
    if (c) topLevel.add(c);
  }
  const out: JavaFnSlot[] = [];
  const walkChildren = (n: AstNode, owner: string): void => {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c, owner);
    }
  };
  const walk = (n: AstNode, owner: string): void => {
    switch (n.type) {
      case 'class_declaration':
      case 'interface_declaration':
      case 'enum_declaration':
      case 'record_declaration': {
        const nm = n.childForFieldName?.('name')?.text ?? '';
        const qual = topLevel.has(n) ? '' : nm ? (owner ? `${owner}.${nm}` : nm) : owner;
        const body = bodyOf(n);
        if (body) walkChildren(body, qual);
        return;
      }
      case 'method_declaration':
      case 'constructor_declaration': {
        const nm = n.childForFieldName?.('name')?.text ?? '';
        out.push({
          node: n, kind: n.type, owner, name: nm,
          params: paramNames(n.childForFieldName?.('parameters') ?? null),
          body: bodyOf(n),
        });
        return;
      }
      default: {
        walkChildren(n, owner);
      }
    }
  };
  walk(root, '');

  // ★ Java **重载**天生同名（`show(int)` / `show(String)`）—— 与 get/set 撞名同族（T303）。
  //   ⇒ 同一 owner + kind + name 出现多次时，追加 `@L<行>C<列>` 保证唯一。
  const seen = new Map<string, number>();
  for (const f of out) {
    const key = `${f.owner}|${f.kind}|${f.name}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1 && f.name) f.name = `${f.name}@L${f.node.startPosition.row + 1}C${f.node.startPosition.column + 1}`;
  }
  return out;
}

function findFirstChild(n: AstNode, types: string[]): AstNode | null {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c && types.includes(c.type)) return c;
  }
  return null;
}

/**
 * 取「体」节点。★ Java 各声明用的字段名不统一：`method_declaration` 的 `body` 是 `block`、
 * `constructor_declaration` 是 `constructor_body`、类/接口/枚举是 `*body` ⇒ 兜一层再找。
 * ★ **没有体**（接口方法 / 抽象方法）⇒ 返回 null ⇒ 骨架记 0 探针（台账判据③会说话）。
 */
function bodyOf(n: AstNode): AstNode | null {
  return (
    n.childForFieldName?.('body') ??
    findFirstChild(n, ['block', 'constructor_body', 'class_body', 'interface_body', 'enum_body', 'record_body']) ??
    null
  );
}

/** 形参名：只取**直接**的 identifier（跳过 `(`/`,`/`)` 与类型节点）。 */
function paramNames(node: AstNode | null): string[] {
  if (!node) return [];
  const out: string[] = [];
  const walk = (n: AstNode): void => {
    if (n.type === 'identifier' && !out.includes(n.text)) out.push(n.text);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(node);
  return out;
}

// ═════════════════════════════════════════════════════════════
// ⑥ 填空：**取值时机**
// ═════════════════════════════════════════════════════════════

/**
 * ⑥ 从 `return` 节点里取出「返回值表达式」；裸 return ⇒ 返回 null。
 * ★ 骨架的改写是 **`T = <expr>` + `<探针>; return T`**（两段法）⇒ 本函数决定 `<expr>` 取哪一段。
 *   取错 = 读出错的值，或打断宿主。
 */
export function returnValueOf(ret: AstNode): AstNode | null {
  // `return_statement` 的子节点：[return, <值>?, ;] ⇒ 裸 return 时中间那个不存在。
  if (ret.childCount < 2) return null;
  const v = ret.child(1);
  return v && v.type !== ';' ? v : null;
}

// ═════════════════════════════════════════════════════════════
// 语法小抄（数据，不是逻辑）—— 换语言通常只改这一块
// ═════════════════════════════════════════════════════════════

export const Java_SYNTAX = {
  /** 注释前缀（幂等标记行用它拼） */
  comment: '//',
  /** 「函数」节点类型集合 —— 同时是台账判据③的口径（hooks.fnTypes） */
  fnTypes: new Set<string>(['method_declaration', 'constructor_declaration']),
  /** 项目根路标（相对根、posix）：从文件向上找含它的目录 */
  rootMarker: 'observe-lang-java/Camprobe.java',
  /** **隐式返回**：函数体最后一个表达式就是返回值（Ruby / Python 的多数函数）
   *  ⇒ 没有显式 return 时骨架会在函数体末尾补一条出口探针，否则这类函数只剩 enter。 */
  implicitReturn: false,
  /**
   * ★★ **函数体形态**（2026-10-15 加 —— 加 Java 时踩出来的第 4 个轴，前 3 个是 ① ② ⑥）：
   *   · `'braces'`：体有花括号分隔（Java / C / Go / JS）⇒ enter 必须插在 `{` **之后**、
   *     语句以 `;` 结尾；插在 `{` 之前会**打断宿主**（本证实测：javac 报一串「需要 ';'」）。
   *   · `'indent'`：体就是语句列表（Python / Ruby）⇒ enter 插在第一个语句前、换行分隔。
   */
  bodyStyle: 'braces' as 'braces' | 'indent',
  /** 缩进单位（braces 风格下给体内语句用的） */
  indentUnit: '    ',
  /** 探针运行时文件名 —— ★ **必须从「收哪些文件」里排除**，否则会把探针打进探针自己。 */
  probeFile: 'Camprobe.java',
};

/** 是否可插桩的 java 源文件 */
export function isInstrumentableJavaFile(rel: string): boolean {
  if (!rel.endsWith('.java')) return false;
  if (rel.includes(`${PROBE_DIR_REL}/`)) return false;
  // ★ 探针运行时本身**不能**被插桩（拷进被测工程的那种，如 Java 的 Camprobe.java）
  //   —— 否则会把探针打进探针自己（Go 侧靠 `--exclude-dirs` 解决同一件事）。
  return path.basename(rel) !== Java_SYNTAX.probeFile;
}

/** 递归收集项目下所有可插桩的 .java（遍历与跳过表在骨架里，这里只交谓词） */
export function collectJavaFiles(root: string): string[] {
  return collectSourceFiles(root, isInstrumentableJavaFile);
}

/** 插桩整个项目（收文件 + 逐文件主流程 + backupRoot 口径，全在骨架里） */
export async function instrumentJavaProject(
  root: string,
  opts: InstrumentOptions = {},
): Promise<InstrumentFileResult[]> {
  return instrumentProjectWithHooks(root, javaInstrumentHooks, isInstrumentableJavaFile, opts);
}

// ═════════════════════════════════════════════════════════════
// 固定装配（不是填空 —— 照抄即可）
// ═════════════════════════════════════════════════════════════

export const javaInstrumentHooks: InstrumentHooks = {
  lang: LANG_ID,
  markers: { core: MARKER, deep: DEEP_MARKER },
  comment: Java_SYNTAX.comment,
  rootMarker: Java_SYNTAX.rootMarker,
  fnTypes: Java_SYNTAX.fnTypes,
  probeImport: (file, projectRoot) =>
    path.relative(path.dirname(file), path.join(projectRoot, PROBE_DIR_REL)).replaceAll('\\', '/') || '.',
  buildImportStmt: (spec) => buildImport(spec),
  collectSites: (ctx) => collectSitesImpl(ctx),
};

/** 一条探针要带的字段（语言无关的结构；容器长什么样由 `probeCall` 决定）。 */
export interface ProbeFields {
  /** 被插桩文件相对项目根的 posix 路径 */
  fileRel: string;
  /** 形参名 → 取该参数的源码表达式 */
  args: Array<[string, string]>;
  /** 返回值表达式；null = 裸 return / 隐式返回 */
  ret: string | null;
  /** core / event */
  level: string;
}

/**
 * 语句渲染 ①：一条探针调用语句。★ 换语言时这里几乎一定要改（各语言字面量语法不同）。
 * ★ 骨架负责"在哪注入 / 怎么重写 return / 幂等 / 备份"，本函数只回答"这句话长什么样"。
 */
/**
 * 探针调用：`Camprobe.capture("name", "file", f, "args", "a", a, "b", b, "ret", t, "level", l)`。
 * ★ 用 **flat key/value varargs** 而不是 `Map.of(...)`：`Map.of` 不收 null 值且最多 10 对，
 *   而方法的参数本来就可以是 null。⇒ 由运行时自己拼 map（见 observe-lang-java/Camprobe.java）。
 */
function probeCall(name: string, f: ProbeFields): string {
  const kv: string[] = [str('file'), str(f.fileRel)];
  if (f.args.length > 0) {
    kv.push(str('args'));
    for (const [k, v] of f.args) kv.push(str(k), v);
  }
  if (f.ret !== null) kv.push(str('ret'), f.ret);
  kv.push(str('level'), str(f.level));
  return `Camprobe.capture(${str(name)}${kv.length ? ', ' + kv.join(', ') : ''})`;
}

/** 同包同目录 ⇒ **不需要 import**（探针类与被插桩代码都在 default package）。 */
function buildImport(_spec: string): string {
  return '';
}

// ═════════════════════════════════════════════════════════════
// 收集编辑（通用流程：① ② ⑥ + 骨架应用层；填空之外不用改）
// ═════════════════════════════════════════════════════════════

function collectSitesImpl(ctx: CollectSitesCtx): void {
  const { root, file, content, fileRel, probes, insertions, fail } = ctx;

  // ★★★ 打包文件（`package com.foo;`）【硬失败】—— Java 禁止从默认包 import，而探针类 Camprobe
  //   就在默认包 ⇒ 注入的 `Camprobe.capture(...)` 在打包文件里永远解析不了。
  //   ⇒ 与 T315（跨盘 import 表达不出来）同族：只能响亮失败，不静默产出编译不过的代码（ARC-7）。
  //   ★ 用 `fail`（不是 throw）：throw 会中断整个运行，而**之前的文件已经写盘** ⇒ 留下半插桩项目。
  for (let i = 0; i < root.childCount; i++) {
    const c = root.child(i);
    if (c && c.type === 'package_declaration') {
      const pkg = c.text.replace(/;[\s\S]*$/, '').replace(/^package\s+/, '').trim();
      fail?.(
        `Java 打包文件暂不支持插桩：本文件声明了 package ${pkg}，而探针类 Camprobe 在【默认包】。\n` +
          `  Java 禁止从默认包 import ⇒ 注入的探针调用在这里永远解析不了（javac "找不到符号"）。\n` +
          `  ⇒ 现状只支持【默认包】的 .java 文件（探针与被插桩代码同包、零 import）。\n` +
          `  ⇒ 要支持打包项目：探针类放进真实包 + 按文件生成 import（已记 T321，设计升级项）。`,
      );
      return;
    }
  }

  const mod = path.basename(file).replace(new RegExp(`\\.java$`), '');
  const S = Java_SYNTAX.bodyStyle === 'braces';
  const sep = S ? ';' : ''; // 语句终止符（braces 语言必须补回来，否则语法错）
  for (const fn of scanFunctions(root)) {
    if (!fn.body) continue; // 没有可注入的体 ⇒ 记 0 探针（台账判据③会说话）
    const base = probeNameOf(fn, mod);
    const line = fn.node.startPosition.row + 1;

    // ── enter：落点与缩进按体形态分叉；单行体（`int get() { return 42; }`）保持单行 ──
    const enterAt = S ? braceInner(content, fn.body.startIndex) : fn.body.startIndex;
    const enterInline = S && /\S/.test(content.slice(enterAt, lineEnd(content, enterAt)));
    const pad = S
      ? lineIndent(content, fn.body.startIndex) + Java_SYNTAX.indentUnit
      : indentOf(content, fn.body.startIndex);
    if (matchesContract(`${base}.enter`, probes)) {
      const enterCall = probeCall(`${base}.enter`, {
        fileRel, args: fn.params.map((p) => [p, p]), ret: null, level: 'core',
      });
      insertions.push({
        index: enterAt,
        site: {
          probe: `${base}.enter`, file, line, kind: 'enter', level: 'core',
          injected: enterInline
            ? `${enterCall}${sep} `
            : `${S ? '\n' : ''}${pad}${enterCall}${sep}\n${pad}`,
        },
      });
    }

    const returns = collectReturns(fn.body);
    // ★ 隐式返回的语言：一个显式 return 都没有 ⇒ 末尾补出口探针（否则观测侧只剩 enter）
    if (returns.length === 0 && Java_SYNTAX.implicitReturn && matchesContract(`${base}.exit`, probes)) {
      insertions.push({
        index: fn.body.endIndex,
        site: {
          probe: `${base}.exit`, file, line, kind: 'exit', level: 'core',
          injected: `\n${pad}${probeCall(`${base}.exit`, {
            fileRel, args: [], ret: 'null', level: 'core',
          })}${sep}\n${pad}`,
        },
      });
    }

    for (const { node: ret, parent } of returns) {
      if (!matchesContract(`${base}.exit`, probes)) continue;
      const v = returnValueOf(ret);
      const rline = ret.startPosition.row + 1;
      const tv = `__cam_ret_${rline}_${ret.startPosition.column + 1}`;
      const exitCall = (retExpr: string | null) =>
        probeCall(`${base}.exit`, { fileRel, args: [], ret: retExpr, level: 'core' });

      // ── 形态一：return 是控制语句的【无花括号单语句体】（`if (n > 0) return 1;` / `else return 2;`）──
      // ★★★ T273/T276 同族：必须【包成块】——
      //   ① 三句改写（声明 + 探针 + return）不能当控制语句的单语句体（`if (c) int t = 1;` 语法错）；
      //   ② 不包的话探针与 return **逃逸成无条件执行** ⇒ 静默改宿主行为（T273 实测过）。
      // ★ Java 无 ASI ⇒ 临时变量必须带【类型声明】与分号（TS 的 `const` / Python 的无声明在这里都不成立）。
      if (isBracelessBodyReturn(parent, JAVA_GUARD_TYPES)) {
        const injected = v
          ? `{ ${declTypeOf(fn)} ${tv} = ${content.slice(v.startIndex, v.endIndex)}; ${exitCall(tv)}${sep} return ${tv}${sep} }`
          : `{ ${exitCall(null)}${sep} return${sep} }`;
        insertions.push({
          index: ret.startIndex, removeTo: ret.endIndex,
          site: { probe: `${base}.exit`, file, line: rline, kind: 'exit', level: 'core', injected },
        });
        continue;
      }

      // ── 形态二：裸 return（块内）⇒ 探针 + return 原样（无值可捕获）──
      if (!v) {
        const { indent, inline } = lineInfo(content, ret.startIndex);
        insertions.push({
          index: ret.startIndex, removeTo: ret.endIndex,
          site: {
            probe: `${base}.exit`, file, line: rline, kind: 'exit', level: 'core',
            injected: inline
              ? `${exitCall(null)}${sep} return${sep}`
              : `${exitCall(null)}${sep}\n${indent}return${sep}`,
          },
        });
        continue;
      }

      // ── 形态三：块内带值 return ⇒ 两段法（TS T270/T300、Python 同族）：单次求值 ──
      //   `return <expr>;` ⇒ `<类型> <tv> = <expr>;` + `<探针>; return <tv>;`
      // ★★ 与 TS 的两处必要差异：① 无 ASI ⇒ stage-2 必须以 `;` 开头收尾 stage-1 的赋值
      //    （TS 靠 ASI 蒙混，Java 里 `t = 1\nprobe()` 是语法错 —— 本包出生证第一次跑就撞到）；
      //    ② 临时变量名带【行+列】（T300：同一行多个 return 只带行号会撞名）。
      const { indent, inline } = lineInfo(content, ret.startIndex);
      insertions.push({
        index: ret.startIndex, removeTo: v.startIndex,
        site: { probe: `${base}.exit`, file, line: rline, kind: 'exit', level: 'core', injected: `${declTypeOf(fn)} ${tv} = ` },
      });
      insertions.push({
        index: v.endIndex, removeTo: ret.endIndex,
        site: {
          probe: `${base}.exit`, file, line: rline, kind: 'exit', level: 'core',
          injected: inline
            ? `${sep} ${exitCall(tv)}${sep} return ${tv}${sep}`
            : `${sep}\n${indent}${exitCall(tv)}${sep}\n${indent}return ${tv}${sep}`,
        },
      });
    }
  }
}

/**
 * 外层方法的【声明返回类型】原文（临时变量声明用）。
 * ★ 为什么不用 `var`：`var` 会丢掉菱形推断的目标类型 —— `return new ArrayList<>();`
 *   在方法返回 `List<String>` 时靠**目标类型**推断，换成 `var tv = new ArrayList<>();`
 *   会钉成 `ArrayList<Object>` ⇒ `return tv;` 编译不过。用声明类型则与原 return 推断完全一致。
 * ★ 取不到 ⇒ 抛：AST 形态意外 = 本包的 bug，不静默降级成 `ret: undefined`（那是"没报错的错"）。
 */
function declTypeOf(fn: JavaFnSlot): string {
  const t = fn.node.childForFieldName?.('type')?.text;
  if (!t) {
    throw new Error(
      `instrument_java：方法 ${fn.name || '<匿名>'}（${fn.kind}）有带值 return 但取不到声明返回类型 ⇒ 无法声明临时变量。` +
        ` 这是 tree-sitter-java 的 AST 形态意外（本包 bug），请记入 docs/todo.md。`,
    );
  }
  return t;
}

/**
 * 函数体内所有 return（**不进嵌套函数/lambda/类**）—— 各带【直接父节点】（判无花括号控制体用）。
 * ★ 为什么记父节点：`if (c) return 1;` 的 return 父节点是 if_statement（块内的父节点是 block）
 *   ⇒ 父类型就能区分"包块改写"与"两段法改写"两种形态。
 */
function collectReturns(body: AstNode): Array<{ node: AstNode; parent: AstNode }> {
  const out: Array<{ node: AstNode; parent: AstNode }> = [];
  const walk = (n: AstNode, parent: AstNode): void => {
    if (n.type === 'return_statement') { out.push({ node: n, parent }); return; }
    // ★ 以下容器里的 return **不属于本函数**：嵌套方法（含匿名类的）、lambda 体、局部/匿名类体
    //   ⇒ 不停会把它们的 return 记成【本方法】的 exit 探针 —— 误记比不观测更坏（ limitations 已声明不观测）。
    if (
      Java_SYNTAX.fnTypes.has(n.type) ||
      n.type === 'lambda_expression' ||
      n.type === 'class_body' ||
      n.type === 'enum_body' ||
      n.type === 'interface_body' ||
      n.type === 'record_body'
    ) return;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c, n);
    }
  };
  for (let i = 0; i < body.childCount; i++) {
    const c = body.child(i);
    if (c) walk(c, body);
  }
  return out;
}

// ── 语句管道小件（一般不用改） ──

const str = (s: string): string => JSON.stringify(s);
/** braces 体：返回 `{` 之后的偏移（enter 要插在这里，不能插在 `{` 之前）。 */
function braceInner(content: string, bodyStart: number): number {
  const i = content.indexOf('{', bodyStart);
  return i >= 0 ? i + 1 : bodyStart;
}
/** 含 `index` 那一行的行首缩进。 */
function lineIndent(content: string, index: number): string {
  const ls = content.lastIndexOf('\n', index - 1) + 1;
  return /^[ \t]*/.exec(content.slice(ls))?.[0] ?? '';
}
/** 某偏移所在行的行尾偏移（换行符前；无换行 ⇒ 文末）。 */
function lineEnd(content: string, index: number): number {
  const nl = content.indexOf('\n', index);
  return nl < 0 ? content.length : nl;
}
/**
 * 某偏移所在行的缩进；★ 本行在它之前**已有代码**（单行体，如 `int get() { return 42; }`）
 *   ⇒ `inline=true` ⇒ 注入走 `; ` 分隔**不换行**（Python 侧 `indentInfo` 的同款判据）。
 */
function lineInfo(content: string, index: number): { indent: string; inline: boolean } {
  const ls = content.lastIndexOf('\n', index - 1) + 1;
  const pre = content.slice(ls, index);
  if (/^[ \t]*$/.test(pre)) return { indent: pre, inline: false };
  return { indent: (/^[ \t]*/.exec(content.slice(ls))?.[0] ?? '') + Java_SYNTAX.indentUnit, inline: true };
}
/** 某偏移所在行的缩进（该行它之前是否已有代码 ⇒ 单行语句要退回 `;`）。 */
function indentOf(content: string, index: number): string {
  const ls = content.lastIndexOf('\n', index - 1) + 1;
  const pre = content.slice(ls, index);
  if (/^[ \t]*$/.test(pre)) return pre;
  return (/^[ \t]*/.exec(content.slice(ls))?.[0] ?? '') + '  ';
}
