/**
 * ★★★ 2026-10-28（T-#KIND-1 · 用户："你写的这部分有没有补丁式的，要不要结构化重写"）：
 * **判据 kind 的注册表 —— 单一事实源**。
 *
 * ## 它解决什么（实测代价）
 * 加一个 kind 原来要动 **5 个文件**：`expectation.ts` 里 **8 处** + 求值器 + 强度分类 +
 * `schema/design_dsl.schema.json`（**2 处** anyOf）+ `docs/GUIDE-GATE.md` 判据表。
 * 2026-10-28 一天内加了 3 个 kind（`domain-independent` / `cert` / `runtime`）⇒ 同一套手工同步做了**三遍**，
 * 且**漏了一次文档**（判据表写 10 种，实际 12）。这就是本仓头号病"同一件事住多处"在判据体系自身的体现。
 *
 * ## 现在的事实源在这里
 * 每个 kind 一条声明：`phase` · `fields`（名字/类型/必填/约束/说明）· `render` · `subject` · `paths`。
 * 由它**派生**：
 * · `EXPECTATION_KINDS`（名字清单）
 * · `assertValidExpectations`（形状校验 —— 写入路径要响亮拒绝）
 * · `renderExpectation`（人读一行）
 * · `expectationSubjectPath` / `expectationPaths`（对账用）
 * · **JSON Schema 的 anyOf 分支**（`scripts/gen_dsl_schema.mjs` 从这里生成，不再手抄）
 *
 * ## 不从这里派生的两处（**故意的**，都是编译器兜底）
 * · **TS 类型联合**（`Expectation`）—— 留在 `expectation.ts`；
 *   忘了同步 ⇒ 求值器里访问字段会**编译不过**（比运行时才发现强）；
 * · **求值器 `switch`** —— 留在 `intent/expectations.ts`（要 fs/db，属 application 层）。
 *
 * ★ 本文件**零依赖**（domain 层不许引 zod / fs）—— 所以字段表是声明式数据，不是 zod schema。
 */

/** 字段类型：够表达现有 12 种判据；不要为了"通用"提前长成 ORM */
export type FieldType = 'string' | 'string[]' | 'number' | 'boolean' | 'object' | 'object[]';

export interface FieldSpec {
  name: string;
  type: FieldType;
  /** 必填（缺 / 空串 / 空数组 ⇒ 拒） */
  required?: boolean;
  /** 允许值（给了就是闭集） */
  values?: readonly string[];
  /** 数组最小长度（如 `must_not_import` 至少 1 个） */
  minItems?: number;
  /** 给 JSON Schema / 文档用的说明 */
  desc?: string;
  /** 数组元素的子字段（`behavior-cases` 的 cases 用） */
  items?: readonly FieldSpec[];
}

export interface KindSpec {
  kind: string;
  /** `pre` = 未施工时天然成立；`post` = 干完才有 */
  phase: 'pre' | 'post';
  fields: readonly FieldSpec[];
  /** 这些字段**至少给一个**（如 `source-has` 的 must / mustNot） */
  atLeastOneOf?: readonly string[];
  /** 人读一行（判据执行回执里就这样出现） */
  render: (e: Record<string, unknown>) => string;
  /** 主体是不是"某个文件"：不是则返回 `''`（别硬凑） */
  subject?: string;
  /** 判据判的"尺度"（对账/门用；便于人一眼看懂这条在管什么） */
  axis: 'file' | 'symbol' | 'edge' | 'call' | 'text' | 'behavior' | 'domain' | 'cert' | 'runtime';
}

const s = (name: string, o: Partial<FieldSpec> = {}): FieldSpec => ({ name, type: 'string', ...o });
const sArr = (name: string, o: Partial<FieldSpec> = {}): FieldSpec => ({ name, type: 'string[]', ...o });

const norm = (v: unknown): string => String(v ?? '').replace(/\\/g, '/');

/** ★ 12 种判据的唯一声明处 */
export const KIND_SPECS: Record<string, KindSpec> = {
  'file-exists': {
    kind: 'file-exists',
    phase: 'post',
    axis: 'file',
    fields: [s('path', { required: true, desc: '仓库相对路径' })],
    render: (e) => `file-exists  ${norm(e.path)}`,
  },
  'symbol-exists': {
    kind: 'symbol-exists',
    phase: 'post',
    axis: 'symbol',
    fields: [s('path', { required: true }), s('symbol', { required: true, desc: '按 AST 判导出' })],
    render: (e) => `symbol-exists  ${norm(e.path)} :: ${String(e.symbol)}`,
  },
  'signature-matches': {
    kind: 'signature-matches',
    phase: 'post',
    axis: 'symbol',
    fields: [s('path', { required: true }), s('symbol', { required: true }), s('signature', { required: true, desc: '比较前压空白' })],
    render: (e) => `signature-matches  ${norm(e.path)} :: ${String(e.symbol)}(${String(e.signature)})`,
  },
  'edge-exists': {
    kind: 'edge-exists',
    phase: 'post',
    axis: 'edge',
    fields: [s('from', { required: true }), s('to', { required: true })],
    render: (e) => `edge-exists  ${norm(e.from)} → ${norm(e.to)}`,
  },
  'edge-absent': {
    kind: 'edge-absent',
    phase: 'pre',
    axis: 'edge',
    fields: [s('from', { required: true }), s('to', { required: true })],
    render: (e) => `edge-absent  ${norm(e.from)} ⇸ ${norm(e.to)}`,
  },
  'call-exists': {
    kind: 'call-exists',
    phase: 'post',
    axis: 'call',
    fields: [s('path', { required: true }), s('symbol', { required: true }), s('target', { required: true, desc: '被调符号名' })],
    render: (e) => `call-exists  ${norm(e.path)} :: ${String(e.symbol)}() → ${String(e.target)}()`,
  },
  run: {
    kind: 'run',
    phase: 'post',
    axis: 'behavior',
    subject: '', // 跑起来验，不针对某个文件 ⇒ 不硬凑主体
    fields: [
      { name: 'input', type: 'object', desc: '传给 expect 的求值域' },
      s('input_ref'),
      s('expect', { required: true, desc: '表达式；求值域只有 input / root' }),
      s('blocked_by', { desc: '有值 ⇒ 判 pending，不跑 expect' }),
      sArr('mutants_ignore', { desc: '这些 input 字段不参与突变（避免等价突变体误判）' }),
    ],
    render: (e) => `run  ${String(e.expect).slice(0, 70)}`,
  },
  'source-has': {
    kind: 'source-has',
    phase: 'post',
    axis: 'text',
    fields: [s('path', { required: true }), sArr('must'), sArr('mustNot')],
    atLeastOneOf: ['must', 'mustNot'],
    render: (e) =>
      `source-has  ${norm(e.path)} :: must ${((e.must as unknown[]) ?? []).length} / mustNot ${((e.mustNot as unknown[]) ?? []).length}`,
  },
  'behavior-cases': {
    kind: 'behavior-cases',
    phase: 'post',
    axis: 'behavior',
    fields: [
      s('path', { required: true }),
      s('symbol', { required: true }),
      {
        name: 'cases',
        type: 'object[]',
        required: true,
        minItems: 1,
        desc: '说不出验收输入的判据不算判据',
        items: [sArr('given', { required: true, desc: '位置实参' }), s('expect', { required: true, desc: '期望输出（规范化后比较）' })],
      },
    ],
    render: (e) => `behavior-cases  ${norm(e.path)} :: ${String(e.symbol)}() × ${((e.cases as unknown[]) ?? []).length} case`,
  },
  'domain-independent': {
    kind: 'domain-independent',
    phase: 'pre',
    axis: 'domain',
    subject: '', // 主体是**域**（域表里的 id），不是文件
    fields: [
      s('domain', { required: true, desc: '域表 id（不是层级名、不是路径）' }),
      sArr('must_not_import', { required: true, minItems: 1, desc: '不许依赖的域 id；说不出"不许依赖谁"不算判据' }),
    ],
    render: (e) => `domain-independent  ${String(e.domain)} ⇸ ${((e.must_not_import as unknown[]) ?? []).join(' / ')}`,
  },
  cert: {
    kind: 'cert',
    phase: 'post',
    axis: 'cert',
    subject: '', // 主体是一张证（certs/<name>*.mjs），不是源文件
    fields: [
      s('cert', { required: true, desc: 'certs/ 下文件名前缀（如 t405）' }),
      s('case', { desc: '结论行里的用例标记，如 ①' }),
    ],
    render: (e) => `cert  ${String(e.cert)}${e.case ? `#${String(e.case)}` : ''}`,
  },
  runtime: {
    kind: 'runtime',
    phase: 'post',
    axis: 'runtime',
    subject: '', // 主体是事件流（events*.jsonl），不是源文件
    fields: [
      s('probe', { required: true, desc: '探针名（如 fn.exit / io.call）' }),
      s('expect', { values: ['ok', 'deviation', 'absent'], desc: 'ok=全 ok（默认）| deviation=至少一条偏差（反例用法）| absent=一条都不许出现' }),
      s('events', { desc: '事件文件；缺省自动找 <root>/.agent/observe/events*.jsonl' }),
    ],
    render: (e) => `runtime  ${String(e.probe)}  expect=${String(e.expect ?? 'ok')}`,
  },
};

/** ★ 由注册表派生的名字清单（不再手写数组） */
export const EXPECTATION_KINDS: readonly string[] = Object.keys(KIND_SPECS);

/** 阶段（由注册表派生） */
export function phaseOfKind(kind: string): 'pre' | 'post' | undefined {
  return KIND_SPECS[kind]?.phase;
}

/** 人读一行（由注册表派生） */
export function renderExpectation(e: { kind: string } & Record<string, unknown>): string {
  const spec = KIND_SPECS[e.kind];
  return spec ? spec.render(e as Record<string, unknown>) : String(e.kind);
}

/** 主体路径（不是文件主体的 kind 返回 ''，不硬凑） */
export function subjectPathOf(e: { kind: string } & Record<string, unknown>): string {
  const spec = KIND_SPECS[e.kind];
  if (!spec) return '';
  if (spec.axis === 'edge') return norm(e.from);
  if (spec.subject === '') return '';
  return norm(e.path);
}

/** 判据牵动到的全部路径（对账用） */
export function pathsOf(e: { kind: string } & Record<string, unknown>): string[] {
  const spec = KIND_SPECS[e.kind];
  if (!spec) return [];
  if (spec.axis === 'edge') return [norm(e.from), norm(e.to)];
  if (spec.subject === '') return [];
  return [norm(e.path)];
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/**
 * ★ 形状校验（由注册表派生）：写入路径用它**响亮拒绝**，而不是让坏数据进 DSL 后静默不判。
 * 报错必须带 `kind` 名 —— 用户才知道自己写坏的是哪一条。
 */
export function validateExpectation(e: unknown, at = 'expectation'): string | null {
  if (!e || typeof e !== 'object') return `${at} 必须是对象`;
  const o = e as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== 'string' || !KIND_SPECS[kind]) {
    return `${at}.kind 非法（"${String(kind)}"）⇒ 只能取 ${EXPECTATION_KINDS.join(' / ')}`;
  }
  const spec = KIND_SPECS[kind];
  if (typeof o.why !== 'string' || o.why.trim() === '') {
    return `${at}.why 必填（一条说不出理由的验收项，将来没人敢删）`;
  }
  for (const f of spec.fields) {
    const v = o[f.name];
    if (f.required && isEmpty(v)) return `${at}.${f.name} 必填且非空（kind=${kind}）`;
    if (v === undefined) continue;
    const isArr = f.type.endsWith('[]');
    if (isArr) {
      if (!Array.isArray(v)) return `${at}.${f.name} 必须是数组（kind=${kind}）`;
      if (f.minItems !== undefined && v.length < f.minItems) {
        return `${at}.${f.name} 至少 ${f.minItems} 项（kind=${kind}）—— 说不出内容的判据不算判据`;
      }
      if (f.type === 'object[]' && f.items) {
        v.forEach((x, i) => {
          if (!x || typeof x !== 'object') return;
          for (const sub of f.items!) {
            if (sub.required && isEmpty((x as Record<string, unknown>)[sub.name])) {
              return `${at}.${f.name}[${i}].${sub.name} 必填且非空（kind=${kind}）`;
            }
          }
        });
      }
    }
    if (f.values && typeof v === 'string' && !f.values.includes(v)) {
      return `${at}.${f.name} 只能是 ${f.values.join(' / ')}（kind=${kind}）`;
    }
  }
  if (spec.atLeastOneOf) {
    const ok = spec.atLeastOneOf.some((n) => !isEmpty(o[n]));
    if (!ok) return `${at} 必须给 ${spec.atLeastOneOf.join(' 或 ')} 至少一个（kind=${kind}）`;
  }
  return null;
}
