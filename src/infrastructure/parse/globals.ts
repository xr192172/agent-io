/**
 * ★★★ 2026-10-27（T-#96）：**内置名 / 宿主全局名的唯一住处**（结构性重写，原先是 9 张散表）
 *
 * ## 病史（为什么要合）
 * 这些名字原先散在 `index/symbols.ts` 里，各自一张 `Set`，靠**调用点的 `if (isXxxFile)`** 决定生效范围：
 *   `BUILTIN_CALLEES` · `BUILTIN_TYPES` · `BUILTIN_NAMESPACES` · `BUILTIN_PREFIXES`（**声明了但没人用**）
 *   `GO_BUILTIN_CALLEES` · `GO_BUILTIN_TYPES` · `JAVA_LANG_TYPES` · `SHELL_CALLEES`
 *   `JS_HOST_GLOBALS` · `PY_BUILTINS`
 * ⇒ 加一门语言要改**两处**（适配器表 + 这里再加一张表 + 调用点再加一个 `isXxxFile`），
 *   和 `AGENTS.md` 写的「加语言 = 加一行」不符，而且「**哪门语言没声明全局来源**」不可查。
 * ⇒ 现在：**每门语言的全局名 = 适配器上的 `globals` 字段**（`LANG_ADAPTERS[lang].globals`），
 *   本文件只放**数据**，`kernel.ts` 只放引用位置。判据见 kernel.ts 的 §4（已有）。
 *
 * ## 三档语义（顺序有意义，不能合并）
 * · `callees`     —— 裸调用名，**在"局部绑定"判定之前**查（语言内置：Go `len` / Python `reversed`）。
 * · `hostCallees` —— 裸调用名，**在"局部绑定"判定之后**查（宿主注入：测试框架 `it`、浏览器 `addEventListener`；
 *   局部绑定会 shadow 它们 ⇒ 必须排在后面）。
 * · `types`       —— `type_ref` 名（TS lib / Go 内置类型 / `java.lang`）。
 * · `namespaces`  —— 带点调用的**接收者根**（只用于细分 `why` 标签，不参与建边决策）。
 *
 * ## `COMMON` 是什么
 * 跨语言共用的那批（`String`/`Object`/`Array`… 这类"哪门语言都当内置看"的名字）。
 * ★ 它里面**混着 Python 与 Node 的条目**（历史遗留：`print`/`len`/`setTimeout`/`fetch` 都在）。
 *   本轮**不拆**：拆它会改变判定结果，而判定结果要逐项对得上（见提交读数）。
 *   ⇒ 拆它 = 后续单独一刀，判据是"读数的迁移量"（`.agent-io/scratch/probe-many.mjs` 全跑一遍对比）。
 */
import type { LanguageEntry } from './languages.js';

/** 一门语言（或 COMMON）的全局名表 */
export interface GlobalsBucket {
  /** 裸调用名：在 local-binding 判定**之前**查 */
  callees?: readonly string[];
  /** 裸调用名：在 local-binding 判定**之后**查（宿主注入，可被局部绑定 shadow） */
  hostCallees?: readonly string[];
  /** `type_ref` 名 */
  types?: readonly string[];
  /** 带点调用的接收者根（只影响 `why` 标签） */
  namespaces?: readonly string[];
}

/**
 * 跨语言共用（不属于某门语言的事实）。
 *
 * `callees` 的来源沿革（都写在原表里，搬过来不删）：
 * · 语言无关构造器/工具：`String` `Number` `Object` `Array` `Promise` `Set` `Map` `Date` `Math` `Error` …
 * · ★ T-#44：Node / 浏览器全局函数（`setTimeout` … —— 源码里不 import，`packageBindingsByFile` 看不到）
 * · ★ T-#50：`import` 是**关键字**不是函数（`await import(spec)` 被抽成 call）
 * · ★ T-#58：`super` 是关键字；Python 内置异常（`raise SystemExit(...)`）
 * · ★ T-#60：JS 全局函数（`decodeURIComponent` …）
 * · ★ T-#94：`Function` 也是全局构造器（lodash `template.js:259` 实测落 failed）
 * · Python 内置的一小撮（`print` `len` `range` …）—— 见上面"不拆"的说明
 */
export const COMMON_GLOBALS: GlobalsBucket = {
  callees: [
    'String', 'Number', 'Boolean', 'Object', 'Array', 'Promise', 'Set', 'Map', 'Date', 'Math',
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'RegExp', 'Symbol',
    'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'typeof', 'instanceof',
    // Python 内置（历史遗留，见文件头）
    'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'bool',
    'type', 'isinstance', 'sum', 'min', 'max', 'sorted', 'enumerate', 'zip', 'map', 'filter',
    'open', 'repr', 'abs', 'round', 'any', 'all', 'next', 'iter', 'hasattr', 'getattr',
    'ValueError', 'KeyError', 'Exception',
    // Node / 浏览器全局函数
    'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
    'queueMicrotask', 'structuredClone', 'fetch', 'atob', 'btoa', 'require',
    // 关键字（`import(spec)` / `super(...)` 被抽成 call 引用）
    'import', 'super',
    // Python 内置异常
    'SystemExit', 'BaseException', 'StopIteration', 'AssertionError', 'NotImplementedError',
    'RuntimeError', 'ImportError', 'OSError', 'IOError', 'AttributeError',
    // JS 全局函数
    'decodeURIComponent', 'encodeURIComponent', 'decodeURI', 'encodeURI', 'escape', 'unescape',
    // 全局构造器
    'Function',
  ],
  /**
   * `type_ref` 的共用表（TS lib 内置 + `@types/node` 全局 + 少量跨语言基础类型）。
   *
   * ★ T-#78 的教训（原文保留）：这里曾堆过一批「补偿性表项」（`ServerResponse` / `Dirent` / …），
   *   它们是在**掩盖 `type_ref` 丢 receiver** 的 bug。T-#77 修好真因后已删 —— 留着会掩盖真问题，
   *   而且**换个项目就漏**。⇒ 往这张表加名字之前先问：**这条是真全局，还是在掩盖某个判定缺陷？**
   */
  types: [
    'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint',
    'null', 'undefined', 'readonly', 'Array', 'Record', 'Partial', 'Required', 'Readonly', 'Pick',
    'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters', 'Awaited', 'Promise',
    'Function', 'Error', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Iterable',
    'IterableIterator', 'Generator', 'AsyncGenerator', 'HTMLElement', 'Event', 'Node',
    'RegExpExecArray', 'RegExpMatchArray', 'PropertyKey', 'ThisType', 'ThisParameterType',
    'OmitThisParameter', 'TemplateStringsArray', 'Uppercase', 'Lowercase', 'Capitalize',
    'Uncapitalize', 'InstanceType', 'ConstructorParameters', 'WeakRef', 'FinalizationRegistry',
    'ReadonlySet', 'ReadonlyMap', 'ReadonlyArray', 'ArrayLike', 'PromiseLike', 'AsyncIterable',
    'AsyncIterableIterator', 'Iterator', 'IteratorResult', 'Disposable', 'AsyncDisposable',
    'Buffer', 'NodeJS', 'NodeRequire', 'Timer', 'NodeJS.Timeout',
    'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'SharedArrayBuffer',
    'DataView', 'PromiseRejectedResult', 'PromiseFulfilledResult', 'PromiseSettledResult',
    // `NodeJS.X` 的尾名：源码里常以裸名出现（`import type { Timeout } from 'node:timers'` 之后）
    'Timeout', 'ErrnoException',
  ],
  /**
   * ★ T-#56：**已知全局命名空间** —— 带点调用的接收者根如果在这里，就不是"判不了"而是"本来就外部"。
   * 用途：把 `dotted-unprovable` 那个 13953 条的大桶拆成 `builtin-namespace` / `local-receiver-untyped`。
   * ★ 只用于**细分 `why`**，不参与建边决策 ⇒ 宁可多列，不误伤。
   */
  namespaces: [
    'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Promise',
    'Reflect', 'Symbol', 'Intl', 'Map', 'Set', 'WeakMap', 'WeakSet', 'ArrayBuffer', 'DataView',
    'console', 'process', 'global', 'globalThis', 'Buffer', 'structuredClone',
    'fs', 'path', 'os', 'url', 'util', 'crypto', 'http', 'https', 'net', 'tls', 'stream', 'events',
    'child_process', 'zlib', 'readline', 'assert', 'querystring', 'worker_threads', 'sqlite',
  ],
};

/**
 * ★ T-#93：JS 系的**宿主注入全局**（Node / 浏览器 / 测试运行器）。
 *
 * 为什么不是"补偿性表项"：这些名字在源码里**根本没有声明处** ——
 *   TS 的全局来源是 `lib.*.d.ts` / `@types/*`，Go 是 `builtin` 包，**JS 就是宿主注入**。
 * 实测：express 4.21.2 `failed` 14 条里 9 条是 `it`/`describe`（测试运行器）；
 *       socket.io 4 的 bundle 里 `addEventListener` 写成裸名，且源码自己用
 *       `typeof addEventListener === "function"` 当环境判据。
 * ★ 放在 `hostCallees`（局部绑定之后查）：`const it = …` 这类局部绑定必须能 shadow 它。
 */
export const JS_GLOBALS: GlobalsBucket = {
  hostCallees: [
    // 测试框架 DSL（mocha / jest / vitest / tap / node:test 的注入形态）
    'it', 'xit', 'fit', 'test', 'xtest', 'specify', 'describe', 'xdescribe', 'fdescribe',
    'context', 'xcontext', 'suite', 'bench',
    'before', 'after', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
    // 浏览器宿主的裸函数
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'requestAnimationFrame', 'cancelAnimationFrame',
  ],
};

/**
 * ★ T-#44 / T-#78：**Go 的内置类型 + 内置可调用**。
 *
 * 为什么不并进 `COMMON`：`int` / `max` / `min` / `new` / `close` / `copy` 在 TS 里
 * **完全可能是本仓的真函数名**（本仓就有 `max`/`close`）⇒ 混一张表会把真符号判成 external ⇒ 丢边。
 * ★ T-#78 的教训（原文保留）：这里曾堆过 Go 标准库类型名的 tail（`Ident`/`Object`/`Scope`…），
 *   它们是在**掩盖 `type_ref` 丢 receiver**。T-#77 修好真因后已删。
 *   ⇒ 加名字之前先问：这是真内置，还是在掩盖判定缺陷？
 */
export const GO_GLOBALS: GlobalsBucket = {
  callees: [
    'len', 'cap', 'make', 'new', 'append', 'copy', 'delete', 'close',
    'panic', 'recover', 'print', 'println', 'complex', 'real', 'imag', 'min', 'max', 'clear',
    // ★ T-#44：类型转换也是 call 形态（`int64(x)` / `float64(x)`）
    'bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64',
    'int', 'int8', 'int16', 'int32', 'int64', 'rune', 'string',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr', 'any', 'comparable',
  ],
  types: [
    'bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64',
    'int', 'int8', 'int16', 'int32', 'int64', 'rune', 'string',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr', 'any', 'comparable',
  ],
};

/**
 * ★ T-#80 / T-#84：**`java.lang` 的真全局** —— 只对 `.java` 启用。
 * ★ T-#84 的教训（原文保留）：整张表曾被当"化石"删掉，结果把 `java.lang` 的真全局（`String`/`Object`/
 *   `Integer` …）也一起删了 ⇒ 换真 Java 项目会大面积 failed。⇒ 真全局要留，掩盖缺陷的 tail 要删。
 */
export const JAVA_GLOBALS: GlobalsBucket = {
  types: [
    // 基本类型的包装类 + 字符串
    'String', 'Object', 'Integer', 'Long', 'Short', 'Byte', 'Character', 'Boolean', 'Double', 'Float',
    'Number', 'Void', 'CharSequence', 'StringBuilder', 'StringBuffer',
    // 异常体系
    'Exception', 'RuntimeException', 'Error', 'Throwable', 'StackTraceElement',
    // 工具 / 系统
    'Math', 'StrictMath', 'System', 'Runtime', 'Process', 'Class', 'Package', 'Module',
    // 类型体系 / 常用接口
    'Enum', 'Record', 'Override', 'Runnable', 'Thread', 'ThreadLocal', 'Iterable', 'Iterator',
    'Comparable', 'Comparator', 'AutoCloseable', 'Cloneable', 'Appendable', 'Readable',
  ],
};

/**
 * ★ T-#95：**Python 的内置名**（`builtins` 模块的公开面）。
 * 实测（flask 3.0）：`reversed` / `callable` / `__import__` / `compile` / `issubclass` … 源码里没有声明处。
 * ★ 只收 builtins 里**确定的**名字；不收可能被本地 shadow 的常见变量名。
 */
export const PY_GLOBALS: GlobalsBucket = {
  callees: [
    // 内建函数
    'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray', 'bytes',
    'callable', 'chr', 'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod',
    'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals',
    'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len',
    'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow',
    'print', 'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted',
    'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip',
    '__import__', '__build_class__',
    // 内建常量
    'Ellipsis', 'NotImplemented', 'True', 'False', 'None',
    // 内建异常
    'BaseException', 'Exception', 'ArithmeticError', 'AssertionError', 'AttributeError', 'BufferError',
    'EOFError', 'GeneratorExit', 'ImportError', 'ImportWarning', 'IndexError', 'KeyError',
    'KeyboardInterrupt', 'LookupError', 'MemoryError', 'NameError', 'NotImplementedError', 'OSError',
    'OverflowError', 'RecursionError', 'ReferenceError', 'RuntimeError', 'StopIteration', 'StopAsyncIteration',
    'SyntaxError', 'SystemError', 'SystemExit', 'TypeError', 'UnboundLocalError', 'UnicodeDecodeError',
    'UnicodeEncodeError', 'UnicodeError', 'UnicodeTranslateError', 'ValueError', 'ZeroDivisionError',
    'FileNotFoundError', 'FileExistsError', 'PermissionError', 'IsADirectoryError', 'NotADirectoryError',
    'TimeoutError', 'ConnectionError', 'ModuleNotFoundError', 'DeprecationWarning', 'UserWarning',
  ],
};

/**
 * ★ T-#51：**Shell 的外部命令 / 内建** —— 只对 `.sh`/`.bash`/`.zsh` 启用。
 * 实测 `printf` 6 · `node` 5 · `grep` 2 · `echo` 2 落 failed。
 * ★ 为什么不能不分语言：`node` / `printf` / `echo` 在 TS 里可能是真函数名。
 */
export const SHELL_GLOBALS: GlobalsBucket = {
  callees: [
    'printf', 'echo', 'node', 'npx', 'npm', 'pnpm', 'yarn', 'grep', 'egrep', 'sed', 'awk', 'cut',
    'tr', 'sort', 'uniq', 'wc', 'head', 'tail', 'cat', 'tee', 'find', 'xargs', 'dirname', 'basename',
    'read', 'local', 'export', 'source', 'eval', 'exec', 'test', 'true', 'false', 'exit', 'cd',
    'pushd', 'popd', 'pwd', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'ln', 'chmod', 'chown', 'touch',
    'git', 'curl', 'wget', 'jq', 'sleep', 'kill', 'wait', 'shift', 'set', 'unset', 'trap', 'date',
    'python', 'python3', 'pip', 'go', 'cargo', 'make', 'cmake', 'docker', 'ssh', 'scp', 'rsync',
  ],
};

/** 合并：`COMMON` 打底 + 语言自己的追加（语言为准） */
export function mergeGlobalsWithCommon(base: GlobalsBucket, extra: GlobalsBucket | undefined): {
  callees: Set<string>;
  hostCallees: Set<string>;
  types: Set<string>;
  namespaces: Set<string>;
} {
  return {
    callees: new Set([...(base.callees ?? []), ...(extra?.callees ?? [])]),
    hostCallees: new Set([...(base.hostCallees ?? []), ...(extra?.hostCallees ?? [])]),
    types: new Set([...(base.types ?? []), ...(extra?.types ?? [])]),
    namespaces: new Set([...(base.namespaces ?? []), ...(extra?.namespaces ?? [])]),
  };
}

/**
 * ★ T-#96：**覆盖率读数** —— 哪些语言适配器还没声明 `globals`。
 * 用途（读数不是门）：`capability_audit` 报这一行；判据是"这份清单应该只剩**没有全局概念**的语言"。
 * ★ 不写成拦截脚本：内核纪律「不加新门」—— 读数进已有工具，缺了看得见即可。
 */
export function languagesWithoutGlobals(
  adapters: Record<string, { globals?: GlobalsBucket }>,
  languages: readonly LanguageEntry[],
): string[] {
  return languages.filter((l) => adapters[l.name] && !adapters[l.name].globals).map((l) => l.name);
}
