/**
 * unit —— trans_unit「待译契约」协议层
 *
 * 核心思想（对标三段式落地的"契约层"）：
 *   翻译的锚点不是"一棵要 round-trip 的公共 AST"，而是一条自包含的
 *   `TransUnit`（待译契约）。它既喂给机械骨架生成机，也直接作为 LLM
 *   单孔填充的 prompt 输入与验证闸的检查对象。
 *
 *   关键设计：`skeleton`（已生成的确定性产物）与 `bodyHole`（待 LLM 填的
 *   孔）分离。骨架是"锁定外壳"，LLM 只能在签名/导出/返回类型被焊死的
 *   框架里代换函数体——这比让 LLM 自由翻译整个包要简单且可控。
 *
 * 兼容性：本文件只放协议与纯常量，不 import 任何解析/生成实现（避免
 * 循环依赖），与 src/tools/refactor_langs.ts 的契约层定位一致。
 */

/** 一条待译契约的类型类别 */
export type TranslateKind = 'func' | 'type' | 'const';

/**
 * ★★★ 2026-10-28（T-#TYPE-AST）：**结构化类型树** —— 由 Go AST **直接映射**而来。
 *
 * ## 为什么需要它（取代"拍平成字符串 + 下游正则猜结构"）
 * 原来 `go_extractor` 在 `const type = typeNode2.text` 这一步把 tree-sitter 的类型节点**拍成文本**，
 * 下游 `ts_codegen.mapGoType` 再用 15 处正则把结构**猜回来**（struct 体 / interface 体 / 分组形参 /
 * 泛型实参 / struct tag / 嵌套结构）—— 猜测必然出错（实测：5/55 文件语法错、8 处假签名）。
 *
 * ⇒ 现在 extractor 直接把 AST 映成这棵树，codegen 只做**渲染**（渲染输出文本是必然的，但输入不需要解析）。
 * ★ `type`（原文）保留不删：人读、日志、以及"手上只有字符串"的老调用方仍用它；
 *   `typeRef` 是**权威**，`type` 是**投影**——两者由同一棵树产生，不会分叉。
 */
export type TypeRef =
  | { kind: 'ident'; name: string }
  | { kind: 'qualified'; pkg: string; name: string }
  | { kind: 'pointer'; elem: TypeRef }
  | { kind: 'slice'; elem: TypeRef }
  | { kind: 'array'; length: string | null; elem: TypeRef }
  | { kind: 'map'; key: TypeRef; value: TypeRef }
  | { kind: 'chan'; dir: 'both' | 'send' | 'recv'; elem: TypeRef }
  | { kind: 'func'; params: Array<{ name?: string; type: TypeRef }>; results: TypeRef[] }
  | {
      kind: 'struct';
      fields: Array<{ name?: string; type: TypeRef; tag?: string }>;
    }
  | {
      kind: 'interface';
      methods: Array<{ name: string; params: Array<{ name?: string; type: TypeRef }>; results: TypeRef[] }>;
      embeds: TypeRef[];
    }
  | { kind: 'generic'; base: TypeRef; args: TypeRef[] }
  | { kind: 'variadic'; elem: TypeRef }
  | { kind: 'tuple'; items: TypeRef[] }
  /** 兜底：解析不了就**如实记原文**（不猜） */
  | { kind: 'unknown'; text: string };

/** 参数/字段的最小结构化描述 */
export interface TranslateParam {
  /** 本地名（Go 参数名 / struct 字段名） */
  name: string;
  /** 源语言类型原文（如 'int' / '[]byte' / '*User'）—— ★ 投影，不是权威 */
  type: string;
  /** ★ 权威：结构化类型树（由 AST 直出；缺失时才回退到 `type` 字符串） */
  typeRef?: TypeRef;
}

/** 接口的方法签名（用于 type→interface 单元） */
export interface TranslateMethod {
  name: string;
  params: TranslateParam[];
  result?: string | null;
  /** ★ 权威：返回类型的结构化树（多返回值时是 tuple） */
  resultRef?: TypeRef;
}

/**
 * 一条待译契约。携带"源证据 + 目标骨架 + 待填孔 + 约束"四件套，
 * 让下游（骨架生成机 / LLM prompt / 验证闸 / 语言适配器）各自只认自己
 * 需要的字段，无需再回源文件。
 */
export interface TransUnit {
  /** 稳定标识：源语言限定名（如顶层函数名 'Add' / 类型名 'User'） */
  id: string;
  /** 'func' | 'type' */
  kind: TranslateKind;
  /** 目标语言（本切片恒 'ts'；协议为多目标预留） */
  dstLang: string;
  /** 符号名 */
  name: string;

  // —— func 用 ——
  /** 参数表（Go 展开成单参数单类型） */
  params?: TranslateParam[];
  /** 返回类型原文；null / undefined = 无返回值 —— ★ 投影 */
  result?: string | null;
  /**
   * ★★★ 2026-10-29（T-#SHIM-VALUE）：**函数体里出现的「包名.成员」**（值位置，如 `filepath.Join` / `os.OpenFile`）。
   * 为什么单独一栏：类型位置的 `pkg.Type` 走 `TypeRef` 就能收；而**值位置**（调用、常量）在函数体里，
   * 类型树看不到 ⇒ 垫片收不到 ⇒ tsc 报 TS2304 ×789。
   * 判定方式**不用猜**：只认本文件 `import` 里声明过的包名（Go 的语义事实），不是"小写就可能是包"。
   */
  usedQualified?: string[];
  /** ★ 权威：返回类型结构化树（多返回值是 tuple；无返回值缺省） */
  resultRef?: TypeRef;
  /**
   * ★★★ 2026-10-29（T-#MECH-BODY）：**机械翻出来的函数体**（AST 同构改写，零 LLM）。
   * 有值 ⇒ 上层直接用，**不必送 LLM**；undefined ⇒ 翻不动（有 defer/select/通道/类型断言 等），走 LLM。
   */
  mechBody?: string;
  /** Go 类型参数名（泛型），如 ['T']；渲染为 TS `<T, ...>` */
  typeParams?: string[];
  /** 各类型参数 → Go 约束原文（如 comparable/any/Ordered）；TS 无等价约束，仅传递提示 */
  typeParamConstraints?: Record<string, string>;
  /** 各类型参数 → 能表达成 TS 的 `extends` 约束（如 'number' / 'number | string' / 'Uint8Array'）；空串=不设 bound */
  typeParamBounds?: string[];
  /** A3 决策表：函数体为 switch-on-expression 时，锁定分支结构（判别式 + case 标签 + default），LLM 只填分支内动作 */
  decision?: DecisionShape;

  // —— const 用 ——
  /** 直译后的 TS 字面量源码（标量 const/var 常量表达式），如 '100' / '"hi"' / 'true' */
  value?: string;
  /** var（可变）→ 渲成 export let；const（不可变）→ export const。缺省 const */
  isVar?: boolean;

  // —— type 用 ——
  /** 具体形态：struct → interface；interface → interface(方法签名)；alias → type 别名 */
  typeKind?: 'struct' | 'interface' | 'alias';
  /** struct 字段表（`type` 是投影，`typeRef` 是权威） */
  fields?: { name: string; type: string; typeRef?: TypeRef; tag?: string }[];
  /** interface 方法签名表（typeKind='interface'） */
  methods?: TranslateMethod[];
  /** alias 的底层类型原文（typeKind='alias'） */
  aliasType?: string;
  /** ★ 权威：alias 底层类型的结构化树 */
  aliasTypeRef?: TypeRef;

  // —— 证据与目标 ——
  /** 源文件里该单元的完整原文（给 LLM 做翻译上下文；type 非孔则省略） */
  srcSnippet: string;
  /** 源 Go 中该单元起始行（1-based，用于失败清单一键定位） */
  srcLine?: number;
  /** 目标语言骨架：func = 签名外壳（body 留空为孔）；type = 完整 interface */
  skeleton: string;
  /** true = 该单元有孔待 LLM 填（func 恒 true；type 恒 false） */
  bodyHole: boolean;
  /** 本单元翻译约束（骨架生成时并入 typeMap 语义 note） */
  constraints: string[];
  /**
   * ★ I3（2026-10-25）：翻译 DB 投影事实 + 术语表命中项（`book.ts#attachBookFacts` 注入，
   * `prompts.ts#buildHolePrompt` 渲染进 prompt）—— 与设计侧同构的"往下写"一步：
   * 按图索骥的"图"（翻译册投影）进 prompt，LLM 不再对着裸 Go 源脑补术语与对应物。
   * 缺省不注入（没册子是常态）。
   */
  bookFacts?: string[];
}

/** 一条决策分支（A3）：一组 case 标签属同一分支（`case a, b:`），或 default */
export interface DecisionCase {
  labels: string[];
  branchId: string;
}

/** A3 决策表形状：switch-on-expression 的锁定分支结构 */
export interface DecisionShape {
  /** 判别式（Go 原文，如 cfg.Kind / msg.Type；`switch {}` 为 'true'） */
  discriminant: string;
  /** 顺序分支（每个一个 TS case 组） */
  cases: DecisionCase[];
  hasDefault: boolean;
}

/** 所有单元共享的硬约束（LLM 不得越界） */
export const DEFAULT_CONSTRAINTS: string[] = [
  '不得新增或删除顶层导出（export）',
  '不得改动函数签名、参数名与返回类型',
  '不得引入除目标函数体外的副作用',
  '不翻译 srcSnippet 里未提供的语义，保留易译近似并加 TODO 注释',
];

/** 合并约束（去重、保序），返回新数组（不改变入参） */
export function withConstraints(existing: string[], more: string[]): string[] {
  const set = new Set(existing);
  for (const c of more) set.add(c);
  return [...set];
}