/**
 * case_program 类型（domain 层，零依赖）—— 契约"程序形态"的**形状权威**。
 *
 * ★ 为什么住 domain：`domain/expectation.ts` 的 behavior-cases 联合成员引用了
 *   `CaseProgram`（2026-11-09 形态扩展）。domain 不得向上 import（application/…），
 *   而 purity 判据按 import 语句判（`import type` 也算）⇒ 形状必须住在本层，
 *   application 层的执行核（`application/design/intent/case_program.ts`）反过来引这里。
 *   —— 单一形状权威只是**搬家**，不是第二份（执行核是唯一**实现**，这里只有**类型**）。
 */

export type CaseFake = {
  module: string;
  exports?: Record<string, string>;
  file?: string;
};

export type CaseProgramStep = { method?: string; args?: unknown[]; expect?: unknown };

export type CaseEffect =
  | { writes?: string; mustContain?: string; absent?: boolean }
  | { handles?: string; equals?: unknown };

export type CaseProgram = {
  name?: string;
  ctor?: unknown[] | false;
  steps?: CaseProgramStep[];
  effects?: CaseEffect[];
  throws?: { messageContains: string };
  budget?: { ms: number };
  /** 显式声明的整模块替身（声明了 ⇒ 走子进程 + resolve hook；不声明 ⇒ 依赖照常解析） */
  fakes?: CaseFake[];
};
