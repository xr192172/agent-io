/**
 * ★★★ 2026-10-29（T-#BOOK-TS-SIG）：**册子阶段就把签名翻成 TS** —— 让"翻译"只发生一次。
 *
 * ## 为什么（用户的判断）
 * > 「生成翻译侧的时候，本身就有一道翻译过程，实际 db 里面的很多字段在这个阶段就应该翻译完」
 *
 * 现在册子 `sig` 存的是 **Go 原文**（`Builder.AddFix(skillID string, fix string)`），
 * 下游骨架再自己从 AST 推一遍 TS 类型 —— **同一份事实被解释两次**，两处都可能不同步。
 * 这里给每个符号补一个 **`sigTs`**：用 extractor 已经直出的 `TypeRef`（AST 事实）渲染，
 * 落到册子。下游骨架**直接取 `sigTs`**，不再自己推。
 *
 * ## 边界（诚实）
 * · 只覆盖能拿到 AST 的源文件（册子里 `from` 指向 `.go`）；拿不到就跳过并如实计数，**不猜**；
 * · 渲染不出来的类型位置（`degree === 'unsupported'`）在 `sigTsNote` 里留原话，不静默 `any`；
 * · 这一步**零 LLM**：纯渲染，输入是 AST 事实 + 阶段 1 的术语（后续接入 termMap）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractGoFromFile } from './go_extractor.js';
import { renderTsType } from './ts_codegen.js';
import type { TransUnit, TypeRef } from './unit.js';
import type { TranslateBook, BookSymbol } from './book.js';

/**
 * ★★★ 2026-10-29（T-#PIVOT-TYPEREF）：**把单元的结构化成 pivot 事实**（落盘进册子）。
 *
 * 为什么：`TypeRef` 原来只在内存里活一次就被丢掉 ⇒ 类型永远"每次重新推一遍"，
 * 这就是"同一份事实被解释两次"的根。落盘之后：
 *   · 类型成为**两种语言共同读写的实体**（Go 适配器写，任何目标渲染器读）；
 *   · `targets.ts.signature` 退化成**缓存**（能由 pivot 重算 ⇒ 不是第二处权威）。
 *
 * 中立性：存的是**结构化类型树 + 源侧名字**（`ident: Builder`），不含目标语言命名/语法。
 * `[未核]` 名字目前仍按源侧文本解析；改成"按轴心 id 解析"是 `T-#PIVOT-TYPEREF-IDS`。
 */
export interface PivotParam {
  name: string;
  ref: TypeRef;
}
export interface PivotUnit {
  kind: 'func' | 'method' | 'type' | 'const';
  typeKind?: string;
  params?: PivotParam[];
  result?: TypeRef;
  /** type 类符号的形状（struct/interface/alias） */
  shape?: TypeRef;
  typeParams?: string[];
  value?: string;
}

/** TransUnit → PivotUnit（结构化，落盘用） */
export function pivotOf(u: TransUnit): PivotUnit {
  const params: PivotParam[] = [];
  for (const p of u.params ?? []) {
    // 接收者是合成首参、没有 typeRef ⇒ 用类型文本造最小引用（文本形状即答案，去掉指针号）
    const ref: TypeRef =
      p.typeRef ?? { kind: 'ident', name: (p.type ?? 'unknown').replace(/^\*+/, '') || 'unknown' };
    params.push({ name: p.name, ref });
  }
  const out: PivotUnit = { kind: (u.kind as PivotUnit['kind']) ?? 'func' };
  if (u.typeKind) out.typeKind = u.typeKind;
  if (params.length) out.params = params;
  if (u.resultRef) out.result = u.resultRef;
  if (u.kind === 'type') out.shape = (u.aliasTypeRef ?? { kind: 'struct', fields: [] }) as TypeRef;
  if (u.typeParams?.length) out.typeParams = [...u.typeParams];
  if (u.kind === 'const' && u.value) out.value = u.value;
  return out;
}

/**
 * **签名只从 pivot 出**（单一权威）。`targets.ts.signature` 是本函数结果的缓存。
 * `name` 由目标渲染器给（轴心不管命名）——这里只是 TS 渲染器的一个实现。
 */
export function tsSignatureFromPivot(p: PivotUnit, name: string): { sig: string; unsupported: boolean } {
  let unsupported = false;
  const t = (ref: TypeRef | undefined): string => {
    if (!ref) return 'unknown';
    const m = renderTsType(ref);
    if (m.degree === 'unsupported') unsupported = true;
    return m.ts;
  };
  const ps = (p.params ?? []).map((x) => `${x.name}: ${t(x.ref)}`).join(', ');
  const ret = p.result ? t(p.result) : 'void';
  const tp = p.typeParams?.length ? `<${p.typeParams.join(', ')}>` : '';
  return { sig: `${name}${tp}(${ps}): ${ret}`, unsupported };
}

export interface BookTsSigStats {
  /** 册子里带 `from` 的符号数 */
  symbols: number;
  /** 成功写入 `sigTs` 的条数 */
  rendered: number;
  /** 源文件缺失 / 解析失败而跳过的条数（**不猜**） */
  skipped: number;
  /** 渲染里含 unsupported 度（语义需人审）的条数 */
  unsupported: number;
  /** ★ 落了结构化类型树（`pivot`）的符号数 */
  pivot: number;
}

/** 把一个 TransUnit 渲染成 TS 签名文本（不含 `export`；方法首参是 receiver） */
function renderUnitSig(u: TransUnit): { sig: string; unsupported: boolean } {
  let unsupported = false;
  /** 无 TypeRef 时的**文本兜底**：只做"去掉指针号"这种文本形状变换（`*Builder` → `Builder`），不猜结构 */
  const fromText = (goType: string | undefined): string => {
    const t = (goType ?? '').trim();
    if (!t) return 'unknown';
    if (/^(u?int(8|16|32|64)?|uintptr)$/.test(t)) return 'number';
    if (/^float(32|64)$/.test(t)) return 'number';
    if (t === 'string') return 'string';
    if (t === 'bool') return 'boolean';
    const noPtr = t.replace(/^\*+/, '');
    if (/^[A-Za-z_][\w]*(\.\w+)?(<[^>]*>)?(\[\])?$/.test(noPtr)) return noPtr.replace(/\./g, '_');
    return 'unknown';
  };
  const t = (ref: Parameters<typeof renderTsType>[0] | undefined, goTypeText?: string): string => {
    if (!ref) return fromText(goTypeText);
    const m = renderTsType(ref);
    if (m.degree === 'unsupported') unsupported = true;
    return m.ts;
  };

  if (u.kind === 'const') return { sig: `${u.name}: ${u.value ?? 'unknown'}`, unsupported };

  if (u.typeKind === 'struct') {
    const fields = (u.fields ?? []).map((f) => `  ${f.name}: ${t(f.typeRef)};`).join('\n');
    return { sig: `interface ${u.name} {\n${fields}\n}`, unsupported };
  }
  if (u.typeKind === 'interface') {
    const ms = (u.methods ?? [])
      .map((m) => {
        const ps = m.params.map((p) => `${p.name}: ${t(p.typeRef)}`).join(', ');
        return `  ${m.name}(${ps}): ${m.resultRef ? t(m.resultRef) : 'void'};`;
      })
      .join('\n');
    return { sig: `interface ${u.name} {\n${ms}\n}`, unsupported };
  }
  if (u.typeKind === 'alias') {
    return { sig: `type ${u.name} = ${t(u.aliasTypeRef)}`, unsupported };
  }

  // func / method
  const ps = (u.params ?? []).map((p) => `${p.name}: ${t(p.typeRef, p.type)}`).join(', ');
  const ret = u.resultRef ? t(u.resultRef) : 'void';
  const tp = u.typeParams?.length ? `<${u.typeParams.join(', ')}>` : '';
  return { sig: `${u.name}${tp}(${ps}): ${ret}`, unsupported };
}

/**
 * 读册子 → 按文件解析 Go 源码（复用 extractor 的 TypeRef）→ 渲染 `sigTs` → 写回。
 * ★ 幂等：重复跑只是重算同样的东西。
 */
export async function fillBookTsSignatures(projectDir: string, bookPath: string): Promise<BookTsSigStats> {
  const raw = fs.readFileSync(bookPath, 'utf8');
  const book = JSON.parse(raw) as TranslateBook;
  const stats: BookTsSigStats = { symbols: 0, rendered: 0, skipped: 0, unsupported: 0, pivot: 0 };

  // 按文件分组（`from` = `<repo相对路径>#<符号名>`）
  const byFile = new Map<string, BookSymbol[]>();
  for (const s of book.symbols ?? []) {
    if (!s.from) continue;
    stats.symbols++;
    const i = s.from.indexOf('#');
    if (i < 0) continue;
    const rel = s.from.slice(0, i);
    if (!rel.endsWith('.go')) continue;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel)!.push(s);
  }

  for (const [rel, syms] of byFile) {
    const abs = path.join(projectDir, rel);
    if (!fs.existsSync(abs)) {
      stats.skipped += syms.length;
      continue;
    }
    let units: TransUnit[] = [];
    try {
      const r = await extractGoFromFile(abs);
      units = r.units;
    } catch {
      stats.skipped += syms.length;
      continue;
    }
    const byName = new Map<string, TransUnit>();
    for (const u of units) {
      byName.set(u.id, u);
      byName.set(u.name, u);
    }
    for (const s of syms) {
      const name = s.from!.slice(s.from!.indexOf('#') + 1);
      // ★ 2026-10-29：**方法名对不上**是 299 条被跳过的真因 —— 册子记 `AddFix`，
      //   而 extractor 的单元 id 是 `Builder_AddFix`（接收者前缀）。按 kind 分派匹配，不靠猜：
      //   · method  → 找 `*_<name>` 结尾的单元；
      //   · 其它    → 精确 id / 去限定名后再试。
      let u = byName.get(name) ?? byName.get(name.split('.').pop() ?? name);
      if (!u && s.kind === 'method') {
        u = units.find((x) => x.id.endsWith('_' + name) || x.name.endsWith('_' + name));
      }
      if (!u && name.includes('.')) {
        const short = name.split('.').pop()!;
        u = units.find((x) => x.id.endsWith('_' + short) || x.name === short);
      }
      if (!u) {
        stats.skipped++;
        continue;
      }
      // ★ 先落 pivot（类型事实），再由 pivot 重算签名 —— 签名不再是独立写入的第二处权威
      const pivot = pivotOf(u);
      const tsName = (s.targets?.ts?.name ?? u.name) as string;
      const rendered =
        u.kind === 'type' || u.kind === 'const' ? renderUnitSig(u) : tsSignatureFromPivot(pivot, tsName);
      const sig = rendered.sig;
      const unsupported = rendered.unsupported;
      // ★ 轴心中立化后：TS 签名落在 `targets.ts.signature`（渲染器槽位），不是轴心事实
      const ts = (s.targets ??= {}).ts ?? (s.targets.ts = { file: '', name: '' });
      if (unsupported) {
        stats.unsupported++;
        ts.signatureNote = '含 unsupported 度类型（Go 语义无 TS 等价物，需人审）';
      }
      ts.signature = sig;
      if (!s.pivot) stats.pivot++;
      s.pivot = pivot;
      stats.rendered++;
    }
  }

  fs.writeFileSync(bookPath, JSON.stringify(book, null, 2), 'utf8');
  return stats;
}

/**
 * ★★★ 2026-10-29（T-#SKELETON-FROM-BOOK）：在册子里找某单元对应的符号。
 * 册子的 `from` 是 `<rel>#<Go 符号>`；**方法**在册里记 `AddFix`、在单元里记 `Builder_AddFix`
 * ⇒ 按 `kind==='method'` 做 `*_<name>` 后缀匹配（结构化分派，不靠猜）。
 */
export function findBookSymbol(books: TranslateBook[], rel: string, u: TransUnit): BookSymbol | null {
  const want = `${rel}#`;
  for (const b of books) {
    for (const s of b.symbols ?? []) {
      if (!s.from || !s.targets?.ts?.signature) continue;
      if (!s.from.startsWith(want)) continue;
      const name = s.from.slice(want.length);
      if (name === u.name || name === u.id) return s;
      if (s.kind === 'method' && (u.name.endsWith('_' + name) || u.id.endsWith('_' + name))) return s;
    }
  }
  return null;
}

/**
 * 把册子的 `sigTs` 排成骨架：**只排版，不推类型**。
 * · `interface …` / `type …` ⇒ 整行导出（无函数体）；
 * · const ⇒ `export const <sigTs>`；
 * · 其余按函数处理 ⇒ `export function <sigTs> { 孔 }`（孔体随后由机械翻/填孔替换）。
 */
export function skeletonFromSigTs(sigTs: string, u: TransUnit): string {
  // ★ 2026-10-29（tsc 抓到的最后一个错）：`sigTs` 里的**结构体返回类型是多行的**
  //   （`): {\n  ID: string; … }[]`），拼进 `export function <sig> {` 会把声明拆断（TS1005）。
  //   ⇒ 函数签名压成单行（类型本身不需要换行；interface/type 分支仍保留多行）。
  const raw = sigTs.trim();
  if (/^(interface|type)\b/.test(raw.replace(/\s+/g, ' '))) return `export ${raw}`;
  const sig = raw.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ');
  if (u.kind === 'const') return `export const ${sig}`;
  return `export function ${sig} {\n  throw new Error('TODO(translate): 待 LLM 翻译 Go 函数体');\n}`;
}
