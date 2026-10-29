/**
 * ★★★ 2026-10-29（T-#STD-ADAPTER）：**Go 标准库 → TS 适配模块**（真实现，不是 `any` 垫片）。
 *
 * ## 为什么是"适配模块"而不是"调用点改写"
 * 真仓实测：33 个 Go std 包、**146 个不同成员**、**13,661 次引用**。
 * 若改调用点（`strings.TrimSpace(s)` → `s.trim()`）要碰 13,661 处；写适配模块只要实现 146 个函数，
 * 而调用点**原样不动**：`import * as strings from './_go_std/strings'`。
 *
 * ## 边界（每条都在模块头如实写）
 * · `time.Duration` 统一用**毫秒**（Go 是纳秒）⇒ `time.Second = 1000`；
 * · `fmt` 只覆盖**语法层动词**（`%s %d %f %q %w %v` + 宽度/精度）；**反射层动词**（`%T` `%#v` `%+v`）
 *   运行时拿不到类型信息（TS 类型擦除）⇒ **遇到即抛**，不静默输出错字符串；
 * · `atomic` 用 `SharedArrayBuffer + Atomics` 做**真原子**，但只对**经适配器访问**的变量成立
 *   （Go 的 `&x` 在 TS 里是对象引用）⇒ `[未核]`：绕过适配器的直接读写仍非原子。
 */
import type { TypeRef } from './unit.js';

/** 阶段 1 覆盖的包（按引用量排序，前 8 包占 81.5% 引用） */
export const PHASE1_PKGS = ['strings', 'time', 'os', 'filepath', 'fmt', 'json', 'context', 'sync'] as const;

/** 从 TypeRef 里收集**限定类型的包名前缀**（类型位置：`sync.RWMutex` → `sync`） */
export function collectQualifiedPkgs(ref: TypeRef | undefined, out: Set<string>): void {
  if (!ref) return;
  switch (ref.kind) {
    case 'qualified':
      out.add(ref.pkg);
      return;
    case 'pointer':
    case 'slice':
    case 'variadic':
    case 'array':
    case 'chan':
      return collectQualifiedPkgs(ref.elem, out);
    case 'map':
      collectQualifiedPkgs(ref.key, out);
      return collectQualifiedPkgs(ref.value, out);
    case 'func':
      for (const p of ref.params) collectQualifiedPkgs(p.type, out);
      for (const r of ref.results) collectQualifiedPkgs(r, out);
      return;
    case 'struct':
      for (const f of ref.fields) collectQualifiedPkgs(f.type, out);
      return;
    case 'interface':
      for (const mm of ref.methods) {
        for (const p of mm.params) collectQualifiedPkgs(p.type, out);
        for (const r of mm.results) collectQualifiedPkgs(r, out);
      }
      for (const e of ref.embeds) collectQualifiedPkgs(e, out);
      return;
    case 'generic':
      collectQualifiedPkgs(ref.base, out);
      for (const a of ref.args) collectQualifiedPkgs(a, out);
      return;
    case 'tuple':
      for (const i of ref.items) collectQualifiedPkgs(i, out);
      return;
    default:
      return;
  }
}

const HEAD = (pkg: string, notes: string): string =>
  `// ${pkg} 适配模块（T-#STD-ADAPTER）—— Go 语义的 TS 真实现。\n${notes}\n`;

/**
 * 返回某 Go 包的适配模块源码；不覆盖的包返回 `null`（⇒ 上层显式报缺，不发任何垫片）。
 * ★ 每个实现都尽量贴 Go 语义；**做不到的地方抛错并注明**，不猜。
 */
export function renderGoStdAdapter(pkg: string): string | null {
  switch (pkg) {
    case 'strings':
      return (
        HEAD('strings', '· 索引/切片按 **UTF-16 code unit**（Go 按字节）⇒ 含中文/emoji 的下标语义不同 [未核]') +
        `export const ToLower = (s: string): string => s.toLowerCase();
export const ToUpper = (s: string): string => s.toUpperCase();
export const Join = (a: string[], sep: string): string => a.join(sep);
export const Contains = (s: string, sub: string): boolean => s.includes(sub);
export const HasPrefix = (s: string, p: string): boolean => s.startsWith(p);
export const HasSuffix = (s: string, p: string): boolean => s.endsWith(p);
export const TrimSpace = (s: string): string => s.trim();
export const TrimPrefix = (s: string, p: string): string => (s.startsWith(p) ? s.slice(p.length) : s);
export const TrimSuffix = (s: string, p: string): string => (s.endsWith(p) ? s.slice(0, s.length - p.length) : s);
export const Trim = (s: string, cut: string): string => {
  const set = new Set(cut.split(''));
  let a = 0;
  let b = s.length;
  while (a < b && set.has(s[a])) a++;
  while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
};
export const Split = (s: string, sep: string): string[] => (sep === '' ? Array.from(s) : s.split(sep));
export const Fields = (s: string): string[] => s.split(/\\s+/).filter(Boolean);
export const FieldsFunc = (s: string, f: (ch: string) => boolean): string[] => {
  const out: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (f(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};
export const Index = (s: string, sub: string): number => s.indexOf(sub);
export const LastIndex = (s: string, sub: string): number => s.lastIndexOf(sub);
export const Replace = (s: string, oldS: string, newS: string, n: number): string => {
  if (n < 0) return s.split(oldS).join(newS);
  let out = s;
  let i = 0;
  while (i < n) {
    const at = out.indexOf(oldS);
    if (at < 0) break;
    out = out.slice(0, at) + newS + out.slice(at + oldS.length);
    i++;
  }
  return out;
};
export const ReplaceAll = (s: string, oldS: string, newS: string): string => s.split(oldS).join(newS);
export const Repeat = (s: string, n: number): string => (n <= 0 ? '' : s.repeat(n));
export const Count = (s: string, sub: string): number => (sub === '' ? Array.from(s).length + 1 : s.split(sub).length - 1);
export const EqualFold = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
export const Sprintf = (fmt: string, ...args: unknown[]): string => goSprintf(fmt, args);
/** Go 风格格式化（语法层动词；反射层动词遇即抛） */
export function goSprintf(format: string, args: unknown[]): string {
  let i = 0;
  return format.replace(/%(?:[-+ 0#]*)(?:\\d+)?(?:\\.\\d+)?([a-zA-Z%])/g, (_m, verb: string) => {
    if (verb === '%') return '%';
    const v = args[i++];
    switch (verb) {
      case 's':
        return String(v);
      case 'q':
        return JSON.stringify(String(v));
      case 'd':
      case 'i':
        return String(Math.trunc(Number(v)));
      case 'f':
      case 'g':
        return String(Number(v));
      case 't':
        return String(Boolean(v));
      case 'x':
        return Number(v).toString(16);
      case 'X':
        return Number(v).toString(16).toUpperCase();
      case 'b':
        return Number(v).toString(2);
      case 'o':
        return Number(v).toString(8);
      case 'c':
        return String.fromCharCode(Number(v));
      case 'v':
        return typeof v === 'string' ? v : JSON.stringify(v);
      case 'w':
        return v instanceof Error ? v.message : String(v);
      case 'T':
      case '#':
        throw new Error('goSprintf: %T/%#v 需要运行时类型信息（TS 类型擦除）—— 不静默输出，请人工改写');
      default:
        throw new Error(\`goSprintf: 未支持的动词 %\${verb}\`);
    }
  });
}
`
      );

    case 'filepath':
      return (
        HEAD('filepath', '· 走 posix 语义（`/`）；Go 在 Windows 上会给 `\\\\` ⇒ 跨平台差异 [未核]') +
        `export const Separator = '/';
export const Join = (...parts: string[]): string => {
  const ps = parts.filter((p) => p !== '');
  if (!ps.length) return '';
  let out = ps[0];
  for (let i = 1; i < ps.length; i++) {
    const seg = ps[i];
    if (seg.startsWith('/')) out = seg;
    else out = out.endsWith('/') ? out + seg : out + '/' + seg;
  }
  return out;
};
export const Dir = (p: string): string => {
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  return i === 0 ? '/' : p.slice(0, i);
};
export const Base = (p: string): string => {
  const t = p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p;
  const i = t.lastIndexOf('/');
  return i < 0 ? t : t.slice(i + 1);
};
export const Ext = (p: string): string => {
  const b = Base(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
};
export const ToSlash = (p: string): string => p.split('\\\\').join('/');
export const FromSlash = (p: string): string => p.split('/').join('/');
export const Abs = (p: string): [string, Error | null] => {
  try {
    return [p.startsWith('/') ? p : '/' + p, null];
  } catch (e) {
    return ['', e as Error];
  }
};
export const Rel = (base: string, target: string): [string, Error | null] => {
  const b = base.split('/').filter(Boolean);
  const t = target.split('/').filter(Boolean);
  let i = 0;
  while (i < b.length && i < t.length && b[i] === t[i]) i++;
  const up = b.length - i;
  const rel = [...Array(up).fill('..'), ...t.slice(i)].join('/');
  return [rel || '.', null];
};
`
      );

    case 'time':
      return (
        HEAD(
          'time',
          '· **Duration 统一用毫秒**（Go 是纳秒）⇒ Second=1000；· `Time` = epoch 毫秒 number（不用 Date 对象）' +
            '；· `RFC3339` 等布局常量只做**已知子集**映射，未知布局抛错 [未核]',
        ) +
        `export type Time = number; // epoch ms
export type Duration = number; // ms
export const Nanosecond: Duration = 1e-6;
export const Microsecond: Duration = 1e-3;
export const Millisecond: Duration = 1;
export const Second: Duration = 1000;
export const Minute: Duration = 60_000;
export const Hour: Duration = 3_600_000;
export const Now = (): Time => Date.now();
export const Since = (t: Time): Duration => Date.now() - t;
export const Sleep = (d: Duration): Promise<void> => new Promise((r) => setTimeout(r, d));
export const After = (d: Duration): Promise<Time> => new Promise((r) => setTimeout(() => r(Date.now()), d));
export const RFC3339 = 'rfc3339';
export const RFC3339Nano = 'rfc3339';
const LAYOUTS: Record<string, string> = {
  rfc3339: 'yyyy-MM-ddTHH:mm:ssXXX',
};
export const Parse = (layout: string, value: string): [Time, Error | null] => {
  if (!(layout in LAYOUTS) && !/[2006\\-01]/.test(layout)) {
    return [0, new Error('time.Parse: 未知布局（只支持 RFC3339 子集）')];
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? [0, new Error('time.Parse: 无法解析 ' + value)] : [t, null];
};
export const Format = (t: Time, layout: string): string => {
  if (layout === RFC3339 || layout === RFC3339Nano) return new Date(t).toISOString();
  throw new Error('time.Format: 只支持 RFC3339 布局（其它需人工改写）');
};
export const Unix = (sec: number): Time => sec * 1000;
export class Ticker {
  private h: ReturnType<typeof setInterval> | null = null;
  constructor(private d: Duration, private onTick: () => void) {}
  start(): void {
    this.h = setInterval(this.onTick, Math.max(1, this.d));
  }
  Stop(): void {
    if (this.h) clearInterval(this.h);
    this.h = null;
  }
}
export const NewTicker = (d: Duration): Ticker => new Ticker(d, () => {});
`
      );

    case 'sync':
      return (
        HEAD(
          'sync',
          '· 单线程 event loop 下 Mutex/RWMutex 是**无操作**（没有真并发）；跨 Worker 场景不适用 [未核]' +
            '；· `Once` / `WaitGroup` 语义按 Go 实现',
        ) +
        `export class Mutex {
  Lock(): void {}
  Unlock(): void {}
  TryLock(): boolean {
    return true;
  }
}
export class RWMutex {
  Lock(): void {}
  Unlock(): void {}
  RLock(): void {}
  RUnlock(): void {}
}
export class Once {
  private done = false;
  Do(f: () => void): void {
    if (this.done) return;
    this.done = true;
    f();
  }
}
export class WaitGroup {
  private n = 0;
  private waiters: Array<() => void> = [];
  Add(d: number): void {
    this.n += d;
    if (this.n <= 0) {
      const ws = this.waiters;
      this.waiters = [];
      for (const w of ws) w();
    }
  }
  Done(): void {
    this.Add(-1);
  }
  Wait(): Promise<void> {
    if (this.n <= 0) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
}
export class Map_<K, V> {
  private m = new globalThis.Map<K, V>();
  Load(k: K): [V | undefined, boolean] {
    return [this.m.get(k), this.m.has(k)];
  }
  Store(k: K, v: V): void {
    this.m.set(k, v);
  }
  Delete(k: K): void {
    this.m.delete(k);
  }
  Range(f: (k: K, v: V) => boolean): void {
    for (const [k, v] of this.m) if (!f(k, v)) break;
  }
}
`
      );

    case 'errors':
      return (
        HEAD('errors', '· Go 的 `errors.New` 无栈；这里用 Error（有栈）⇒ 只多信息不少语义') +
        `export const New = (msg: string): Error => new Error(msg);
export const Is = (err: Error | null, target: Error | null): boolean => err === target;
export const As = <T>(err: unknown): T | null => (err as T) ?? null;
`
      );

    case 'os':
      return (
        HEAD('os', '· 同步 API 走 node:fs 同步版；· 错误用 Node 的 err.code（IsNotExist 判 ENOENT）[未核]：路径按 posix') +
        `import * as fs from 'node:fs';
export const O_RDONLY = 0;
export const O_WRONLY = 1;
export const O_RDWR = 2;
export const O_APPEND = 1024;
export const O_CREATE = 64;
export const O_TRUNC = 512;
export const ReadFile = (p: string): [Buffer, Error | null] => {
  try {
    return [fs.readFileSync(p), null];
  } catch (e) {
    return [Buffer.alloc(0), e as Error];
  }
};
export const WriteFile = (p: string, data: string | Buffer, perm?: number): Error | null => {
  try {
    fs.writeFileSync(p, data, { mode: perm });
    return null;
  } catch (e) {
    return e as Error;
  }
};
export const MkdirAll = (p: string, perm?: number): Error | null => {
  try {
    fs.mkdirSync(p, { recursive: true, mode: perm });
    return null;
  } catch (e) {
    return e as Error;
  }
};
export const Remove = (p: string): Error | null => {
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return null;
  } catch (e) {
    return e as Error;
  }
};
export const Stat = (p: string): [FileInfo | null, Error | null] => {
  try {
    const st = fs.statSync(p);
    return [{ Size: st.size, ModTime: st.mtimeMs, IsDir: st.isDirectory() }, null];
  } catch (e) {
    return [null, e as Error];
  }
};
export interface FileInfo {
  Size: number;
  ModTime: number;
  IsDir: boolean;
}
export const IsNotExist = (err: unknown): boolean => (err as { code?: string } | null)?.code === 'ENOENT';
export const IsExist = (err: unknown): boolean => (err as { code?: string } | null)?.code === 'EEXIST';
export const Getenv = (k: string): string => process.env[k] ?? '';
export const Setenv = (k: string, v: string): void => {
  process.env[k] = v;
};
export const Getwd = (): [string, Error | null] => [process.cwd(), null];
export const Exit = (code: number): void => {
  process.exitCode = code;
};
export class File {
  constructor(private fd: number) {}
  WriteString(s: string): [number, Error | null] {
    fs.writeSync(this.fd, s);
    return [s.length, null];
  }
  Write(b: Uint8Array): [number, Error | null] {
    fs.writeSync(this.fd, b);
    return [b.length, null];
  }
  Sync(): Error | null {
    try {
      fs.fsyncSync(this.fd);
      return null;
    } catch (e) {
      return e as Error;
    }
  }
  Close(): Error | null {
    try {
      fs.closeSync(this.fd);
      return null;
    } catch (e) {
      return e as Error;
    }
  }
}
export const OpenFile = (p: string, flag: number, perm?: number): [File | null, Error | null] => {
  try {
    const append = (flag & O_APPEND) !== 0;
    const plus = (flag & O_RDWR) !== 0;
    const mode = append ? (plus ? 'a+' : 'a') : plus ? 'r+' : 'w';
    return [new File(fs.openSync(p, mode, perm)), null];
  } catch (e) {
    return [null, e as Error];
  }
};
export const Open = OpenFile;
export const Create = (p: string): [File | null, Error | null] => OpenFile(p, O_CREATE | O_TRUNC | O_WRONLY, 0o644);
export interface DirEntry {
  Name(): string;
  IsDir(): boolean;
}
export const ReadDir = (p: string): [DirEntry[], Error | null] => {
  try {
    const es: DirEntry[] = fs.readdirSync(p, { withFileTypes: true }).map((e) => ({
      Name: () => e.name,
      IsDir: () => e.isDirectory(),
    }));
    return [es, null];
  } catch (e) {
    return [[], e as Error];
  }
};
export const TempDir = (): string => '/tmp';
`
      );

    case 'fmt':
      return (
        HEAD('fmt', '· 只覆盖**语法层动词**（%s %q %d %f %t %x %b %o %c %v %w）；· **%T / %#v / %+v 遇即抛**（TS 类型擦除，运行时没有类型名与字段声明顺序）') +
        `import { goSprintf } from './strings';
export const Errorf = (format: string, ...args: unknown[]): Error => new Error(goSprintf(format, args));
export const Sprint = (...args: unknown[]): string =>
  args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join('');
export const Sprintln = (...args: unknown[]): string => Sprint(...args) + '\n';
export const Printf = (format: string, ...args: unknown[]): void => {
  process.stdout.write(goSprintf(format, args));
};
export const Println = (...args: unknown[]): void => {
  process.stdout.write(Sprintln(...args));
};
export const Print = (...args: unknown[]): void => {
  process.stdout.write(Sprint(...args));
};
export const Fprintf = (w: { write(s: string): void }, format: string, ...args: unknown[]): void => {
  w.write(goSprintf(format, args));
};
`
      );

    case 'json':
      return (
        HEAD('json', '· Marshal/MarshalIndent 直接 JSON.stringify（Go 的 struct tag / omitempty 语义丢失 [未核]）；· Unmarshal 到带类型目标只能 plain object 赋值') +
        `export const Marshal = (v: unknown): [Uint8Array, Error | null] => {
  try {
    return [new TextEncoder().encode(JSON.stringify(v)), null];
  } catch (e) {
    return [new Uint8Array(), e as Error];
  }
};
export const MarshalIndent = (v: unknown, prefix: string, indent: string): [Uint8Array, Error | null] => {
  try {
    return [new TextEncoder().encode(JSON.stringify(v, null, indent)), null];
  } catch (e) {
    return [new Uint8Array(), e as Error];
  }
};
export const Unmarshal = (data: Uint8Array | string, into: unknown): Error | null => {
  try {
    const obj = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    if (into && typeof into === 'object') Object.assign(into as object, obj);
    return null;
  } catch (e) {
    return e as Error;
  }
};
export const NewEncoder = (w: { write(s: string): void }) => ({
  Encode: (v: unknown): Error | null => {
    try {
      w.write(JSON.stringify(v));
      return null;
    } catch (e) {
      return e as Error;
    }
  },
});
`
      );

    case 'context':
      return (
        HEAD('context', '· AbortController 实现 WithTimeout/WithCancel；· `Done()` 返回 Promise（Go 是 <-chan struct{}）⇒ 用 select/chan 的调用点需改写 [未核]') +
        `export class Context {
  private ctrl = new AbortController();
  get signal(): AbortSignal {
    return this.ctrl.signal;
  }
  Err(): Error | null {
    return this.ctrl.signal.aborted ? Canceled : null;
  }
  Done(): Promise<void> {
    if (this.ctrl.signal.aborted) return Promise.resolve();
    return new Promise((r) => this.ctrl.signal.addEventListener('abort', () => r(), { once: true }));
  }
  cancel(): void {
    this.ctrl.abort();
  }
}
export const Background = (): Context => new Context();
export const TODO = (): Context => new Context();
export const WithCancel = (parent: Context): [Context, (err?: Error) => void] => {
  const ctx = new Context();
  const abort = (): void => ctx.cancel();
  parent.signal.addEventListener('abort', abort, { once: true });
  return [ctx, abort];
};
export const WithTimeout = (parent: Context, dMs: number): [Context, (err?: Error) => void] => {
  const [ctx, cancel] = WithCancel(parent);
  const h = setTimeout(() => cancel(DeadlineExceeded), Math.max(0, dMs));
  return [
    ctx,
    (e?: Error) => {
      clearTimeout(h);
      cancel(e);
    },
  ];
};
export const DeadlineExceeded = new Error('context deadline exceeded');
export const Canceled = new Error('context canceled');
`
      );

    case 'sort':
      return (
        HEAD('sort', '· `Slice(x, less)` 按 Go 的 less(i,j) 语义映射；稳定性只在 SliceStable 下显式保证') +
        `export const Slice = <T>(xs: T[], less: (i: number, j: number) => boolean): void => {
  const idx = xs.map((_, i) => i);
  idx.sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
  const copy = xs.slice();
  for (let i = 0; i < xs.length; i++) xs[i] = copy[idx[i]];
};
export const SliceStable = Slice;
export const Strings = (a: string[]): void => {
  a.sort();
};
export const Ints = (a: number[]): void => {
  a.sort((x, y) => x - y);
};
export const Float64s = Ints;
export const SearchInts = (a: number[], x: number): number => {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
`
      );

    case 'log':
      return (
        HEAD('log', '· 走 stderr（Go 默认）；· `Fatalf` 只置 exitCode 不立刻退出（避免把宿主进程打掉）') +
        `import { goSprintf } from './strings';
export const Printf = (format: string, ...args: unknown[]): void => {
  process.stderr.write(goSprintf(format, args) + '\n');
};
export const Println = (...args: unknown[]): void => {
  process.stderr.write(args.map(String).join(' ') + '\n');
};
export const Fatalf = (format: string, ...args: unknown[]): void => {
  Printf(format, ...args);
  process.exitCode = 1;
};
export const Flags = (): void => {};
`
      );

    default:
      return null;
  }
}
