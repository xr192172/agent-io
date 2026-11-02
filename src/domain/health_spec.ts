/**
 * health_spec —— 代码健康度的**纯规范**（零依赖）：问题种类 / 严重度 / 分层 / 文案渲染。
 *
 * ## 为什么这三件事必须住这里（而不是 `infrastructure/analysis/health/index.ts`）
 * 三者在改前都是"每个 push 点各写一份"的重复事实：
 *   ① `severity`：**每个 kind 只有一个值**（实测 547 文件 / 923 条 issue：7 个 kind × 1 个值 = 100% 冗余）
 *      ⇒ 逐条复制 = 同一事实 N 份，改一处不改另一处仍然"看起来正常"（AGENTS-RULES 0.9）；
 *   ② `message`：可由 `kind + file + line + symbol + evidence` 渲染（实测占 issues 载荷 37%）
 *      ⇒ 落盘成字符串就是第二份；
 *   ③ `classifyLayer`：分层判据的唯一实现（放在隔壁只为让 `layer_violation` 的文案渲染得到它）。
 * ★ 搬到零依赖的 domain 还多买到一样：这些口径**能被 `behavior-cases` 判住** —— harness 要求目标零
 *   import，而 `health/index.ts` import 了 5 个内核模块 ⇒ 住在那里就永远只能写"存在类"判据。
 */

/** 7 个问题种类。★ 顺序即聚合输出的行序（稳定：不吃 Map 迭代序）。 */
export const HEALTH_KINDS = [
  'unused_export',
  'unused_import',
  'orphan_file',
  'high_complexity',
  'layer_violation',
  'circular_dependency',
  'sibling_import',
] as const;

export type HealthKind = (typeof HEALTH_KINDS)[number];
export type HealthSeverity = 'error' | 'warn' | 'info';

/**
 * kind → severity 的**唯一表**。★ 每格只有一个值（实测 923 条 issue 无例外）⇒ 不必逐条复制到 issue 上；
 * `severity` 从此是**派生值**（要它就算，不存）。
 */
export const SEVERITY_OF_KIND: Record<HealthKind, HealthSeverity> = {
  layer_violation: 'error',
  circular_dependency: 'error',
  high_complexity: 'warn',
  sibling_import: 'warn',
  unused_import: 'warn',
  orphan_file: 'info',
  unused_export: 'info',
};

export function severityOfKind(kind: HealthKind): HealthSeverity {
  return SEVERITY_OF_KIND[kind];
}

/** kind 的人读短标签（聚合行的标题；别让每个调用方各自翻译一遍）。 */
export const KIND_LABEL: Record<HealthKind, string> = {
  unused_export: '未使用导出',
  unused_import: '未使用 import',
  orphan_file: '孤儿文件',
  high_complexity: '高复杂度',
  layer_violation: '分层违规',
  circular_dependency: '循环依赖',
  sibling_import: '同目录横向 import',
};

export function kindLabel(kind: HealthKind): string {
  return KIND_LABEL[kind];
}

// ── 分层：四层目录口径（唯一实现） ─────────────────────────────────

/** 四层；数字越大越靠上，只许「依赖 ≤ 自身」（向上 = 违规）。 */
export const LAYERS = ['domain', 'infrastructure', 'application', 'presentation'] as const;
export type Layer = (typeof LAYERS)[number];
export const LAYER_ORDER: Record<Layer, number> = {
  domain: 0,
  infrastructure: 1,
  application: 2,
  presentation: 3,
};

/**
 * 按**目录**判层 —— 只认 `src/<层>/…`；`null` = **不在四层里**（`tests/`、`scripts/`、仓库根散文件，
 * 以及 `tests/fixtures/…/src/domain/x.ts` 这类**夹具里的 src**）⇒ 不参与分层违规判定、如实计入
 * `layers.outside`。
 *
 * ★ `null` 不是"兜底归到某一层"：旧实现回落到 `brick` 让 95% 的文件落同一档 ⇒ 分级不携带信息。
 * ★ 用 `^src/` 锚定（不是"任意段之后出现 src/"）：夹具里的 `…/src/domain/x.ts` 不算本仓源码。
 *   实测代价：旧口径把 `tests/` 与夹具一起判 ⇒ 13 条违规里 10 条在测试/夹具。
 */
export function classifyLayer(rel: string): Layer | null {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const m = /^src\/(domain|infrastructure|application|presentation)\//.exec(p);
  return (m?.[1] as Layer) ?? null;
}

/** 渲染一条 issue 需要的**事实**（不含文案本身：文案是派生值）。 */
export interface IssueFacts {
  kind: HealthKind;
  /** 相对项目根 */
  file: string;
  line?: number;
  symbol?: string;
  /** 各维度的额外证据（复杂度分数 / 向上的目标文件 / import 的模块名…） */
  evidence?: string;
  /** ★ 只有 `sibling_import` 用它：该维**有意**不排除 `import type`，渲染要区分这一档。 */
  type_only?: boolean;
}

/**
 * issue 的**唯一渲染** —— `message` 字段从此不落盘（实测它占 issues 载荷的 37%）。
 * `opts.threshold` 只对 `high_complexity` 有用（阈值是那次分析的参数，不是 issue 的事实）。
 */
export function renderIssueMessage(f: IssueFacts, opts: { threshold?: number } = {}): string {
  switch (f.kind) {
    case 'unused_export':
      return `顶层符号 ${f.symbol} 项目内无引用（外部消费者不可见，删除前请确认非公共 API）`;
    case 'unused_import':
      return `import 了 ${f.evidence} 的 ${f.symbol} 但文件内未使用`;
    case 'orphan_file':
      return '整文件无项目内消费者（孤立模块，可能是待清理的 dead code）';
    case 'high_complexity':
      return `${f.symbol} 圈复杂度 ${f.evidence} 超过阈值 ${opts.threshold ?? 10}，建议拆分`;
    case 'layer_violation':
      return `分层违规：${f.file} 向上依赖更高层 ${f.evidence}（层次由路径的 src/<layer>/ 前缀给出）`;
    case 'circular_dependency': {
      const n = (f.evidence ?? '').split(' → ').length;
      return `循环依赖（${n} 个文件成环）：${f.evidence}`;
    }
    case 'sibling_import': {
      const slash = f.file.lastIndexOf('/');
      const dir = slash < 0 ? '' : f.file.slice(0, slash + 1);
      const self = slash < 0 ? f.file : f.file.slice(slash + 1);
      return (
        `同目录横向 import：「一个文件 = 一门语言」的载体目录（${dir}）里，` +
        `${self} 依赖了兄弟文件 ${f.evidence}` +
        (f.type_only ? '（`import type` —— 本维按"零件混装"计，类型依赖同样算）' : '')
      );
    }
  }
}
