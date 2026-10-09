/**
 * expectation.ts —— 「**可判定的验收**」的类型与纯格式化（2026-10-09，`docs/todo.md` T74）。
 *
 * ## 为什么需要它（这是整条工作流的**命门**）
 * 用户口述的工作流：*"对比项目现状与设计，得到区别的地方，然后**分区域重写**。"*
 * 实测（2026-10-09）：这条链上 **别的环错了都看得见** ——
 * 读取看不清 ⇒ 读到奇怪输出；区域框错 ⇒ 改动落到意外文件；
 * **只有"重写完了对不对"这一环，错了看不见** —— `NodeDecision.acceptance`（`geometry.ts:164`）
 * 当时是**自由文本、无任何程序读它**，而 `consistency_check` / `detect_drift` **退出码恒 0**。
 * ⇒ 没有验收，"分区域重写"就变成**自信地改坏**。本模块只做一件事：把"验收"从**一句话**变成**能判的项**。
 *
 * ## 三条纪律
 * 1. ★★★ **判据必须已经在手边，不许新造解析**：五种 kind 全部落在**既有**入口上
 *    （`fileFacts` 给符号/签名/文件级依赖、`fs` 给存在性）。
 *    ⇒ 新造解析 = 新造一套"事实"，也就是本仓头号病（同一判据住两处）。
 * 2. ★★ **判不了要单独成一类（`unsupported`），既不算过、也不算不过**。
 *    ★ 依据：依赖事实 `fileFacts().deps` **只为 TS/JS 相对导入写**
 *      （`infrastructure/index/symbols.ts:388` `if (imp.kind !== 'relative') continue`）
 *      ⇒ 在 Go/Python 上判 `edge-*` 会**静默判错**（把"没查到"读成"不存在"）。
 *      所以本模块**只描述判据，不判**；判定器（在 `application/`）负责识别"语言不支持 ⇒ unsupported"。
 * 3. ★ **`acceptance` 与 `expectations` 不是替代关系**：前者是人读的一句话（保留，不动），
 *    后者是**其中可机器判定的那一部分**。一句话里判不了的（"代码要更清晰"）**不该进 expectations** ——
 *    硬塞进去只会造出"永远绿"的假项。
 *
 * ## 五种检查项（`from`/`to` 一律是**仓库相对路径**）
 *   · `file-exists`        文件在不在
 *   · `symbol-exists`      某文件里有没有这个符号
 *   · `signature-matches`  某符号的签名是否等于给定签名（比较前**规范化空白**）
 *   · `edge-exists`        A **依赖** B（★ **文件级**，不是符号级）
 *   · `edge-absent`        A **不许**依赖 B（"边界归属"最需要这条）
 */
import type { DesignDSL } from './types.js';

/** ★ 五种可判定的检查项。`why` 是**必填**：一条说不出理由的验收项，将来没人敢删。 */
export type Expectation =
  | { kind: 'file-exists'; path: string; why: string }
  | { kind: 'symbol-exists'; path: string; symbol: string; why: string }
  | { kind: 'signature-matches'; path: string; symbol: string; signature: string; why: string }
  | { kind: 'edge-exists'; from: string; to: string; why: string }
  | { kind: 'edge-absent'; from: string; to: string; why: string };

export const EXPECTATION_KINDS = ['file-exists', 'symbol-exists', 'signature-matches', 'edge-exists', 'edge-absent'] as const;

/** 规范化路径（`\`→`/`、去前导 `./`）—— ★ 与 `scope.ts` 同一个口径，别再造第三种写法 */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** 规范化签名（去掉空白）—— 比较用；**不改写**存储里的原文 */
export function normSignature(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 一行描述（用于报告；★ 展示层不许自己拼字符串 —— 那是第二份格式） */
export function describeExpectation(e: Expectation): string {
  switch (e.kind) {
    case 'file-exists': return `file-exists  ${normPath(e.path)}`;
    case 'symbol-exists': return `symbol-exists  ${normPath(e.path)} :: ${e.symbol}`;
    case 'signature-matches': return `signature-matches  ${normPath(e.path)} :: ${e.symbol}  =  ${e.signature}`;
    case 'edge-exists': return `edge-exists  ${normPath(e.from)} → ${normPath(e.to)}`;
    case 'edge-absent': return `edge-absent  ${normPath(e.from)} ⇸ ${normPath(e.to)}`;
  }
}

/** 校验一条检查项的形状（★ 写入路径要用它**响亮拒绝**，而不是让坏数据进 DSL 后静默不判） */
export function assertValidExpectations(v: unknown): asserts v is Expectation[] {
  if (!Array.isArray(v)) throw new Error(`expectations 必须是数组，收到 ${typeof v}`);
  v.forEach((x, i) => {
    const at = `expectations[${i}]`;
    if (!x || typeof x !== 'object') throw new Error(`${at} 必须是对象`);
    const o = x as Record<string, unknown>;
    const kind = o.kind;
    if (typeof kind !== 'string' || !(EXPECTATION_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`${at}.kind 非法（"${String(kind)}"）⇒ 只能取 ${EXPECTATION_KINDS.join(' / ')}`);
    }
    const need = (k: string): void => {
      if (typeof o[k] !== 'string' || (o[k] as string).trim() === '') throw new Error(`${at}.${k} 必填且非空（kind=${kind}）`);
    };
    if (typeof o.why !== 'string' || (o.why as string).trim() === '') {
      throw new Error(`${at}.why 必填（一条说不出理由的验收项，将来没人敢删）`);
    }
    if (kind === 'file-exists') need('path');
    else if (kind === 'symbol-exists') { need('path'); need('symbol'); }
    else if (kind === 'signature-matches') { need('path'); need('symbol'); need('signature'); }
    else { need('from'); need('to'); }
  });
}

/**
 * ★★ 一条检查项的**「主体路径」**—— 失败时**该改哪个文件**（2026-10-09，T78）。
 *
 * ## 为什么需要它
 * `consistency_check` 的对账结果里有**两个来源**的差异：
 *   ① `expected_apis` 对账（**扫描来的**契约 —— 而设计就是从扫描 fork 的 ⇒ 它对出来**永远干净**）；
 *   ② **人写的验收**（`expectations`）—— **只有它才会真的不一样**。
 * 而"差异块"当初只吃 ① ⇒ **块永远是空的**，"圈范围"那一步等于没做。
 * ⇒ 要让两者汇成同一份块，就得先回答：**这条失败的验收，该算到哪个文件头上？**
 *
 * ## 规则（一句话：**算在"欠了这件事"的那一端**）
 *   · `file-exists` / `symbol-exists` / `signature-matches` ⇒ **`path`** 本身（就是它欠着）；
 *   · `edge-exists`（该有的依赖没有）⇒ **`from`**（是它没去依赖 `to`）；
 *   · `edge-absent`（不该有的依赖有了）⇒ **`from`**（是它越权去依赖了 `to`）。
 * ⇒ 后两者**都算 `from`**，不是"两边都算" —— 两边都标会把"改哪端"这个判断推给读者，
 *   而这里能给的是**默认主体**：*依赖关系由"source 端"负责*。
 * ★ 只此一处算主体路径；别在展示层再推一遍（那是判据分叉）。
 */
export function expectationSubjectPath(e: Expectation): string {
  return normPath(e.kind === 'edge-exists' || e.kind === 'edge-absent' ? e.from : e.path);
}

/** 一条检查项**涉及的全部路径**（主体 + 对端）—— 报告里说清"牵动了谁"，但**不计入块的归属** */
export function expectationPaths(e: Expectation): string[] {
  return e.kind === 'edge-exists' || e.kind === 'edge-absent' ? [normPath(e.from), normPath(e.to)] : [normPath(e.path)];
}

/** 汇总某个 DSL 里所有决策卡上的 expectations（★ 只读、不改；供对账用） */
export function collectExpectations(dsl: DesignDSL): Array<{ node_id: string; node_label: string; expectation: Expectation }> {
  const out: Array<{ node_id: string; node_label: string; expectation: Expectation }> = [];
  for (const n of dsl.geometry?.nodes ?? []) {
    for (const e of n.decision?.expectations ?? []) {
      out.push({ node_id: n.id, node_label: n.label ?? n.id, expectation: e });
    }
  }
  return out;
}
