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

const NL = String.fromCharCode(10);
const HEAD = (pkg: string, notes: string): string =>
  `// ${pkg} 适配模块（T-#STD-ADAPTER）—— Go 语义的 TS 真实现。${NL}` +
  // ★ 2026-10-29（tsc 抓到的两处）：① 注释必须**逐行**加 `//`（否则生成文件第 2 行是散文 ⇒ TS1127）；
  //   ② 这里的换行必须用 `String.fromCharCode(10)`，不能写 `'\n'` —— 后者会被后续"把生成源码里的
  //   `'\n'` 转义成 `'\\n'`"的替换连带改掉，导致注释与正文粘成一行。
  notes
    .split(NL)
    .map((l) => '// ' + l)
    .join(NL) +
  NL;

/**
 * 返回某 Go 包的适配模块源码；不覆盖的包返回 `null`（⇒ 上层显式报缺，不发任何垫片）。
 * ★ 每个实现都尽量贴 Go 语义；**做不到的地方抛错并注明**，不猜。
 */
/**
 * ★★★ T-#ADAPTER-GAPS：**按实测补齐的导出**（不预铺，缺哪个补哪个）。
 *
 * 为什么单独一块：`tsc_fix` 的槽位方法表里出现的名字，适配器**必须真有导出**，
 * 否则改写会被静默跳过（实测 `number` 上 6 条：Sub/UTC/String/UnixNano）。
 * 同理 `os.Rename`(×多) / `os.UserHomeDir` / `strings.TrimRight` / `time.ParseDuration`
 * 报 `does not exist on type 'typeof import(…)'` —— 都是 package 级函数缺导出。
 *
 * ★ 只补实测缺的：不把 Go 标准库整面墙铺出来（铺面=成本且没人验）。
 */
function extraExportsFor(pkg: string): string {
  if (pkg === 'time') {
    return `\nexport const UTC = (t: Time): Time => t; // Time 已是 epoch ms（UTC 语义天然成立）\nexport const Sub = (a: Time, b: Time): Duration => a - b;\nexport const String = (t: Time): string => new Date(t).toISOString();\nexport const UnixNano = (t: Time): number => t * 1e6;\nexport const ParseDuration = (s: string): [Duration, Error | null] => {\n  const m = /^(-?\\d+(?:\\.\\d+)?)(ns|us|µs|ms|s|m|h)$/.exec(s.trim());\n  if (!m) return [0, new Error('time.ParseDuration: 不支持的时长 ' + s)];\n  const v = Number(m[1]);\n  const u = m[2];\n  const ms = u === 'h' ? 3_600_000 : u === 'm' ? 60_000 : u === 's' ? 1000 : u === 'ms' ? 1 : u === 'us' || u === 'µs' ? 1e-3 : 1e-6;\n  return [v * ms, null];\n};\n`;
  }
  if (pkg === 'os') {
    return `\nexport const Rename = (a: string, b: string): Error | null => {\n  try {\n    fs.renameSync(a, b);\n    return null;\n  } catch (e) {\n    return e as Error;\n  }\n};\nexport const UserHomeDir = (): [string, Error | null] => {\n  const h = process.env.HOME ?? process.env.USERPROFILE ?? '';\n  return h ? [h, null] : ['', new Error('os.UserHomeDir: 无法确定 HOME')];\n};\n`;
  }
  if (pkg === 'strings') {
    return `\nexport const TrimRight = (s: string, cut: string): string => {\n  let out = s;\n  while (cut && out.endsWith(cut)) out = out.slice(0, -cut.length);\n  return out;\n};\nexport const TrimLeft = (s: string, cut: string): string => {\n  let out = s;\n  while (cut && out.startsWith(cut)) out = out.slice(cut.length);\n  return out;\n};\n`;
  }
  return '';
}

/**
 * ★ T-#ADAPTER-GAPS：包装一层 —— 原始模板原样产出，末尾追加 `extraExportsFor(pkg)`。
 *   抽成包装（而不是改 20 处模板串）是为了**只改一处、可判（call-exists）**。
 */
export function renderGoStdAdapter(pkg: string): string | null {
  const base = renderGoStdAdapterRaw(pkg);
  return base === null ? null : base + extraExportsFor(pkg);
}

function renderGoStdAdapterRaw(pkg: string): string | null {
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
// 2026-10-29：fmt 模板原先缺 Sprintf（TS2339 "Property 'Sprintf' does not exist" ×21）
export const Sprintf = (format: string, ...args: unknown[]): string => goSprintf(format, args);
export const Sprint = (...args: unknown[]): string =>
  args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join('');
export const Sprintln = (...args: unknown[]): string => Sprint(...args) + '\\n';
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
        `/** \`json.RawMessage\` ⇒ 原始字节（不做二次编解码） */
export type RawMessage = Uint8Array;
export const Marshal = (v: unknown): [Uint8Array, Error | null] => {
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
  process.stderr.write(goSprintf(format, args) + '\\n');
};
export const Println = (...args: unknown[]): void => {
  process.stderr.write(args.map(String).join(' ') + '\\n');
};
export const Fatalf = (format: string, ...args: unknown[]): void => {
  Printf(format, ...args);
  process.exitCode = 1;
};
export const Flags = (): void => {};
`
      );

    case 'slices':
      return (
        HEAD('slices', '· 泛型切片工具；Index/SortFunc 等按 Go 语义') +
        `export const Contains = <T>(xs: T[], v: T): boolean => xs.includes(v);
export const Index = <T>(xs: T[], v: T): number => xs.indexOf(v);
export const Sort = <T>(xs: T[], cmp: (a: T, b: T) => number): void => {
  xs.sort(cmp);
};
export const SortFunc = Sort;
export const Reverse = <T>(xs: T[]): void => {
  xs.reverse();
};
export const Clone = <T>(xs: T[]): T[] => xs.slice();
export const Equal = <T>(a: T[], b: T[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
`
      );

    case 'signal':
      return (
        HEAD('signal', '· 映射到 process.on；Go 的 chan 语义由回调替代（`[未核]`：调用点若 select 该 chan 需改写）') +
        `export const Notify = (ch: { send(sig: string): void }, ...sigs: string[]): void => {
  for (const s of sigs) process.on(s as NodeJS.Signals, () => ch.send(s));
};
export const Stop = (ch: unknown): void => {};
export const SIGTERM = 'SIGTERM';
export const SIGINT = 'SIGINT';
export const SIGHUP = 'SIGHUP';
`
      );

    case 'syscall':
      return (
        HEAD('syscall', '· 只提供常量与极少数调用；Go 的 errno/结构体语义不做 [未核]') +
        `export const SIGTERM = 15;
export const SIGINT = 2;
export const SIGKILL = 9;
export const SIGHUP = 1;
export const Getpid = (): number => process.pid;
export const Getenv = (k: string): string => process.env[k] ?? '';
`
      );

    case 'atomic':
      return (
        HEAD(
          'atomic',
          '· 用 SharedArrayBuffer + Atomics 实现**真原子**；· Go 的 `&x` 在 TS 里是对象引用 ⇒ ' +
            '只对**经本模块访问**的变量成立；`[未核]`：绕过本模块的直接读写仍非原子',
        ) +
        `const store = new WeakMap<object, Int32Array>();
function cell(p: object): Int32Array {
  let a = store.get(p);
  if (!a) {
    a = new Int32Array(new SharedArrayBuffer(4));
    store.set(p, a);
  }
  return a;
}
export const LoadInt32 = (p: object): number => Atomics.load(cell(p), 0);
export const StoreInt32 = (p: object, v: number): void => {
  Atomics.store(cell(p), 0, v | 0);
};
export const AddInt32 = (p: object, d: number): number => Atomics.add(cell(p), 0, d | 0) + (d | 0);
export const SwapInt32 = (p: object, v: number): number => Atomics.exchange(cell(p), 0, v | 0);
export const CompareAndSwapInt32 = (p: object, oldV: number, newV: number): boolean =>
  Atomics.compareExchange(cell(p), 0, oldV | 0, newV | 0) === (oldV | 0);
export const LoadInt64 = LoadInt32;
export const StoreInt64 = StoreInt32;
export const AddInt64 = AddInt32;
export const LoadUint32 = (p: object): number => Atomics.load(cell(p), 0) >>> 0;
export const StoreUint32 = StoreInt32;
export const AddUint32 = AddInt32;
`
      );

    case 'heap':
      return (
        HEAD('heap', '· 实现 Go 的 container/heap 接口（Len/Less/Swap/Push/Pop）+ sift 上浮下沉') +
        `export interface Interface {
  Len(): number;
  Less(i: number, j: number): boolean;
  Swap(i: number, j: number): void;
  Push(x: unknown): void;
  Pop(): unknown;
}
function up(h: Interface, j: number): void {
  for (;;) {
    const i = (j - 1) >> 1;
    if (i === j || !h.Less(j, i)) break;
    h.Swap(i, j);
    j = i;
  }
}
function down(h: Interface, i0: number, n: number): boolean {
  let i = i0;
  for (;;) {
    let j1 = 2 * i + 1;
    if (j1 >= n || j1 < 0) break;
    const j2 = j1 + 1;
    let j = j1;
    if (j2 < n && h.Less(j2, j1)) j = j2;
    if (!h.Less(j, i)) break;
    h.Swap(i, j);
    i = j;
  }
  return i > i0;
}
export const Init = (h: Interface): void => {
  const n = h.Len();
  for (let i = (n >> 1) - 1; i >= 0; i--) down(h, i, n);
};
export const Push = (h: Interface, x: unknown): void => {
  h.Push(x);
  up(h, h.Len() - 1);
};
export const Pop = (h: Interface): unknown => {
  const n = h.Len() - 1;
  h.Swap(0, n);
  down(h, 0, n);
  return h.Pop();
};
export const Fix = (h: Interface, i: number): void => {
  if (!down(h, i, h.Len())) up(h, i);
};
`
      );

    case 'unicode':
      return (
        HEAD('unicode', '· 属性判定走 Unicode Property Escapes（`\\p{…}`）；类别名大小写不同 ⇒ 只映射常用几类 [未核]') +
        `export const IsSpace = (r: number): boolean => /^\\s$/u.test(String.fromCodePoint(r));
export const IsDigit = (r: number): boolean => /^[0-9]$/.test(String.fromCodePoint(r));
export const IsLetter = (r: number): boolean => /^\\p{L}$/u.test(String.fromCodePoint(r));
export const IsUpper = (r: number): boolean => /^\\p{Lu}$/u.test(String.fromCodePoint(r));
export const IsLower = (r: number): boolean => /^\\p{Ll}$/u.test(String.fromCodePoint(r));
export const IsPunct = (r: number): boolean => /^\\p{P}$/u.test(String.fromCodePoint(r));
export const ToLower = (r: number): number => String.fromCodePoint(r).toLowerCase().codePointAt(0) ?? r;
export const ToUpper = (r: number): number => String.fromCodePoint(r).toUpperCase().codePointAt(0) ?? r;
export const Mn = 0;
export const Cc = 0;
export const Cf = 0;
export const Zs = 0;
export const P = 0;
export const S = 0;
export const Is = (rangeTab: number, r: number): boolean => false;
`
      );

    case 'strconv':
      return (
        HEAD('strconv', '· Go 返回 `(T, error)` ⇒ 这里返回 `[T, Error|null]`（与本仓多返回值约定一致）') +
        `export const Atoi = (s: string): [number, Error | null] => {
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? [0, new Error('strconv.Atoi: invalid syntax')] : [n, null];
};
export const Itoa = (n: number): string => String(Math.trunc(n));
export const ParseFloat = (s: string, bits: number): [number, Error | null] => {
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? [0, new Error('strconv.ParseFloat: invalid syntax')] : [n, null];
};
export const ParseInt = (s: string, base: number, bits: number): [number, Error | null] => {
  const n = Number.parseInt(s, base);
  return Number.isNaN(n) ? [0, new Error('strconv.ParseInt: invalid syntax')] : [n, null];
};
export const FormatInt = (n: number, base: number): string => Math.trunc(n).toString(base);
export const FormatFloat = (n: number, fmt: string, prec: number, bits: number): string => String(n);
export const Quote = (s: string): string => JSON.stringify(s);
export const Unquote = (s: string): [string, Error | null] => {
  try {
    return [JSON.parse(s), null];
  } catch (e) {
    return ['', e as Error];
  }
};
`
      );

    case 'math':
      return (
        HEAD('math', '· `Float32bits/frombits` 用 DataView 真实现（Go 是 IEEE-754 位模式）') +
        `export const Sqrt = Math.sqrt;
export const Abs = Math.abs;
export const Floor = Math.floor;
export const Ceil = Math.ceil;
export const Round = Math.round;
export const Trunc = Math.trunc;
export const Pow = Math.pow;
export const Log = Math.log;
export const Max = Math.max;
export const Min = Math.min;
export const Inf = (sign: number): number => (sign >= 0 ? Infinity : -Infinity);
export const IsNaN = Number.isNaN;
const buf = new ArrayBuffer(4);
const f32 = new Float32Array(buf);
const u32 = new Uint32Array(buf);
export const Float32bits = (f: number): number => {
  f32[0] = f;
  return u32[0];
};
export const Float32frombits = (b: number): number => {
  u32[0] = b >>> 0;
  return f32[0];
};
export const MaxInt64 = Number.MAX_SAFE_INTEGER;
export const MaxInt32 = 2147483647;
export const MinInt64 = Number.MIN_SAFE_INTEGER;
`
      );

    case 'sha256':
      return (
        HEAD('sha256', '· 走 node:crypto；Go 的 `Sum256([]byte) [32]byte` 返回 Uint8Array') +
        `import { createHash } from 'node:crypto';
export const Sum256 = (data: Uint8Array): Uint8Array => createHash('sha256').update(data).digest();
export const New = () => createHash('sha256');
`
      );

    case 'hex':
      return (
        HEAD('hex', '· 走 Buffer 的 hex 编解码（Go 是小写十六进制，一致）') +
        `export const EncodeToString = (b: Uint8Array): string => Buffer.from(b).toString('hex');
export const DecodeString = (s: string): [Uint8Array, Error | null] => {
  try {
    return [new Uint8Array(Buffer.from(s, 'hex')), null];
  } catch (e) {
    return [new Uint8Array(), e as Error];
  }
};
`
      );

    case 'fnv':
      return (
        HEAD('fnv', '· FNV-1a 64 位手写实现（node:crypto 没有 fnv）；Go 用 uint64 溢出 ⇒ 这里用 BigInt 保精度') +
        `const MASK64 = (1n << 64n) - 1n;
const OFFSET = 14695981039346656037n;
const PRIME = 1099511628211n;
export class Hash64a {
  private h = OFFSET;
  Write(b: Uint8Array): void {
    for (const byte of b) {
      this.h ^= BigInt(byte);
      this.h = (this.h * PRIME) & MASK64;
    }
  }
  Sum64(): bigint {
    return this.h;
  }
}
export const New64a = (): Hash64a => new Hash64a();
`
      );

    case 'bytes':
      return (
        HEAD('bytes', '· `NewReader` 返回可 Read 的包装；Go 的 io.Reader 语义用方法近似（`[未核]`：部分读/EOF 语义）') +
        `export class Reader {
  private pos = 0;
  constructor(private b: Uint8Array) {}
  Read(p: Uint8Array): [number, Error | null] {
    const n = Math.min(p.length, this.b.length - this.pos);
    p.set(this.b.subarray(this.pos, this.pos + n));
    this.pos += n;
    return [n, null];
  }
  Bytes(): Uint8Array {
    return this.b.subarray(this.pos);
  }
}
export const NewReader = (b: Uint8Array): Reader => new Reader(b);
export const NewBuffer = (b: Uint8Array) => ({
  Bytes: () => b,
  Write: (x: Uint8Array) => {
    const out = new Uint8Array(b.length + x.length);
    out.set(b);
    out.set(x, b.length);
    return [x.length, null] as [number, Error | null];
  },
});
export const Contains = (b: Uint8Array, sub: Uint8Array): boolean =>
  Buffer.from(b).includes(Buffer.from(sub));
export const TrimSpace = (b: Uint8Array): Uint8Array => new TextEncoder().encode(new TextDecoder().decode(b).trim());
export const Fields = (b: Uint8Array): Uint8Array[] =>
  new TextDecoder()
    .decode(b)
    .split(/\\s+/)
    .filter(Boolean)
    .map((s) => new TextEncoder().encode(s));
`
      );

    case 'bufio':
      return (
        HEAD('bufio', '· `NewScanner` 提供 Scan/Text 行迭代（Go 默认按行切）；`Scan()` 返回 boolean') +
        `export class Scanner {
  private lines: string[];
  private i = -1;
  constructor(input: string | { read(): string }) {
    const text = typeof input === 'string' ? input : input.read();
    this.lines = text.split(/\\r?\\n/);
  }
  Scan(): boolean {
    this.i++;
    return this.i < this.lines.length;
  }
  Text(): string {
    return this.lines[this.i] ?? '';
  }
  Err(): Error | null {
    return null;
  }
}
export const NewScanner = (input: string | { read(): string }): Scanner => new Scanner(input);
`
      );

    case 'runtime':
      return (
        HEAD('runtime', '· `GOOS/GOARCH` 走 process.platform/arch 映射；`GC`/`NumGoroutine` 无对应（返回近似）[未核]') +
        `export const GOOS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
export const GOARCH = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : process.arch;
export const NumCPU = (): number => 1;
export const NumGoroutine = (): number => 1;
export const GC = (): void => {};
export const Caller = (skip: number): [number, string, number, boolean] => [0, '', 0, false];
`
      );

    case 'norm':
      return (
        HEAD('norm', '· 走 String.prototype.normalize（NFD/NFC/NFKC/NFKD 都有原生支持）') +
        `export class Form {
  constructor(private f: 'NFC' | 'NFD' | 'NFKC' | 'NFKD') {}
  String(s: string): string {
    return s.normalize(this.f);
  }
  IsNormalString(s: string): boolean {
    return s === s.normalize(this.f);
  }
  Bytes(b: Uint8Array): Uint8Array {
    return new TextEncoder().encode(new TextDecoder().decode(b).normalize(this.f));
  }
}
export const NFC = new Form('NFC');
export const NFD = new Form('NFD');
export const NFKC = new Form('NFKC');
export const NFKD = new Form('NFKD');
`
      );

    case 'exec':
      return (
        HEAD('exec', '· 走 node:child_process 同步执行；`Command` 返回可链式对象（Go 的 Cmd 链式 API 只做子集）') +
        `import { execFileSync } from 'node:child_process';
export class Cmd {
  private args: string[] = [];
  constructor(private name: string) {}
  Arg(...a: string[]): Cmd {
    this.args.push(...a);
    return this;
  }
  Output(): [Uint8Array, Error | null] {
    try {
      return [new Uint8Array(execFileSync(this.name, this.args)), null];
    } catch (e) {
      return [new Uint8Array(), e as Error];
    }
  }
  Run(): Error | null {
    try {
      execFileSync(this.name, this.args, { stdio: 'ignore' });
      return null;
    } catch (e) {
      return e as Error;
    }
  }
}
export const Command = (name: string, ...args: string[]): Cmd => {
  const c = new Cmd(name);
  if (args.length) c.Arg(...args);
  return c;
};
export const CommandContext = (_ctx: unknown, name: string, ...args: string[]): Cmd => Command(name, ...args);
`
      );

    case 'io':
      return (
        HEAD('io', '· `ReadAll` 读出全部字节；`LimitReader` 返回截断包装') +
        `export const ReadAll = (r: { read(): string | Uint8Array }): [Uint8Array, Error | null] => {
  try {
    const v = r.read();
    return [typeof v === 'string' ? new TextEncoder().encode(v) : v, null];
  } catch (e) {
    return [new Uint8Array(), e as Error];
  }
};
export const LimitReader = (r: { read(n?: number): string | Uint8Array }, n: number) => ({
  read: (): string | Uint8Array => {
    const v = r.read(n);
    return typeof v === 'string' ? v.slice(0, n) : v.subarray(0, n);
  },
});
export const EOF = new Error('EOF');
export const Writer = class {};
export const Reader = class {};
`
      );

    case 'sql':
      return (
        HEAD('sql', '· 走 node:sqlite（本仓已在用）；`Open` 返回库句柄；`ErrNoRows` 是哨兵错误 [未核]：驱动差异') +
        `import { DatabaseSync } from 'node:sqlite';
export interface DB {
  Exec(q: string, ...args: unknown[]): [unknown, Error | null];
  Query(q: string, ...args: unknown[]): [unknown[], Error | null];
  Close(): Error | null;
}
export const Open = (driver: string, dsn: string): [DB | null, Error | null] => {
  try {
    const db = new DatabaseSync(dsn);
    return [
      {
        Exec: (q: string, ...args: unknown[]) => {
          try {
            db.exec(q);
            return [null, null];
          } catch (e) {
            return [null, e as Error];
          }
        },
        Query: (q: string, ...args: unknown[]) => {
          try {
            return [db.prepare(q).all(...(args as never[])), null];
          } catch (e) {
            return [[], e as Error];
          }
        },
        Close: () => {
          try {
            db.close();
            return null;
          } catch (e) {
            return e as Error;
          }
        },
      },
      null,
    ];
  } catch (e) {
    return [null, e as Error];
  }
};
export const ErrNoRows = new Error('sql: no rows in result set');
`
      );

    case 'http':
      return (
        HEAD('http', '· 服务端走 node:http（只覆盖本仓用到的 HandlerFunc/常量子集）；客户端方法未实现 ⇒ 显式抛 [未核]') +
        `import * as nodeHttp from 'node:http';
export const StatusOK = 200;
export const StatusBadRequest = 400;
export const StatusUnauthorized = 401;
export const StatusForbidden = 403;
export const StatusNotFound = 404;
export const StatusMethodNotAllowed = 405;
export const StatusInternalServerError = 500;
export const StatusBadGateway = 502;
export const StatusServiceUnavailable = 503;
export const MethodGet = 'GET';
export const MethodPost = 'POST';
export const MethodPut = 'PUT';
export const MethodDelete = 'DELETE';
export type HandlerFunc = (w: ResponseWriter, r: Request) => void;
export type Handler = HandlerFunc;
export interface ResponseWriter {
  Header(): { Set(k: string, v: string): void };
  Write(b: Uint8Array): [number, Error | null];
  WriteHeader(code: number): void;
}
export interface Request {
  Method: string;
  URL: string;
  Body: unknown;
}
export const Error = (w: ResponseWriter, msg: string, code: number): void => {
  w.WriteHeader(code);
  w.Write(new TextEncoder().encode(msg));
};
export class ServeMux {
  private routes = new Map<string, HandlerFunc>();
  HandleFunc(pattern: string, h: HandlerFunc): void {
    this.routes.set(pattern, h);
  }
  Serve(port: number): void {
    nodeHttp
      .createServer((req, res) => {
        const h = this.routes.get(req.url ?? '/');
        if (!h) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const w: ResponseWriter = {
          Header: () => ({ Set: (k, v) => res.setHeader(k, v) }),
          Write: (b) => {
            res.write(Buffer.from(b));
            return [b.length, null];
          },
          WriteHeader: (c) => {
            res.statusCode = c;
          },
        };
        h(w, { Method: req.method ?? 'GET', URL: req.url ?? '/', Body: req });
        res.end();
      })
      .listen(port);
  }
}
export const NewServeMux = (): ServeMux => new ServeMux();
export const ListenAndServe = (addr: string, h: { Serve(port: number): void }): Error | null => {
  const port = Number(addr.split(':').pop() ?? '0');
  h.Serve(port);
  return null;
};
`
      );

    case 'mem':
      return (
        HEAD('mem', '· cgo 专用包（C 内存 API）⇒ TS 侧**无等价物**，全部显式抛 [未核]，由册子里的外部依赖策略决定替代品') +
        `const fail = (name: string) => (): never => {
  throw new Error('mem.' + name + ': cgo 内存 API 在 TS 无等价物（见册子 external_deps 策略）');
};
export const Pointer = fail('Pointer');
export const NewServer = fail('NewServer');
export const NewLocalEmbedder = fail('NewLocalEmbedder');
`
      );

    case 'ort':
      return (
        HEAD('ort', '· ONNX Runtime（Go 绑定）⇒ 册子决定 npm_equiv = `onnxruntime-node`；此处只做接口占位并显式抛 [未核]') +
        `const fail = (name: string) => (): never => {
  throw new Error('ort.' + name + ': 需接 onnxruntime-node（册子 external_deps 已定 npm_equiv）');
};
export const SetSharedLibraryPath = fail('SetSharedLibraryPath');
export const InitializeEnvironment = fail('InitializeEnvironment');
export const NewDynamicAdvancedSession = fail('NewDynamicAdvancedSession');
export const NewShape = fail('NewShape');
export const NewTensor = fail('NewTensor');
`
      );

    default:
      return null;
  }
}
