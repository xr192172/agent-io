#!/usr/bin/env node
/**
 * gate_dag_view.mjs —— S-1 现役门 → 静态调度结构视图（§13.6 S-1 / §13.11；一期：结构接线，执行仍串行）。
 *
 * ## 它是什么
 * 把现役 verify.mjs GATES 门名登记进 dag_plan DAG，跑结构校验，产出**静态**调度视图：
 * 拓扑分层 / 只读并发候选名单 / 写面名单 / 重活排他名单 / 未登记保守串行名单 / 写面同层提示。
 * 本模块只做**静态枚举与对账**：不 spawn 子进程、不派发并发、不改现役门 verdict。
 *
 * ## 边界（一期，对齐 dag_plan.mjs:19-20）
 * · 现役编排暂保持串行 for 调用；本视图先就位结构与把守，门间真依赖边 / 并发执行器接线留后续批
 *   探针标定并发安全 + Main 冻结池容量后接入（A 待冻结项）。
 * · 现役 GATES 条目无显式 needs 边字段 ⇒ 节点 needs=[]；分层此时全在第 0 层，分层语义待边登记后生效。
 * · 写面同层提示（DAG_WRITE_SAME_LAYER）是「同窗不可并发须串行」的静态对账要点，不是结构致命错误；
 *   与环 / 未知依赖 / 重复 id 分开列。
 *
 * ## fail-closed
 * · 门未在 gate_caps 登记 ⇒ 进 unregistered 名单，保守按写面串行，不当只读并发。
 * · 视图只读消费 gate_caps 权威表，不从命令文本 / 脚本名反推能力。
 */
import { createDag, addNode, validateDag, NODE_KIND } from './dag_plan.mjs';
import { capOf, isWriteCap, isConcurrentRead, POOL } from './gate_caps.mjs';

/** 结构致命问题码（环 / 未知依赖 / 重复 id）；写面同层归并发提示，不在此列。 */
const STRUCTURAL_CODES = new Set(['DAG_DUP_ID', 'DAG_UNKNOWN_DEP', 'DAG_CYCLE']);

/**
 * 构建现役门静态调度视图。
 * @param {Array<{name:string}>} gates 已求值的现役门清单（函数门已调 ROOT 求值）。
 * @returns {{
 *   gateNames:string[], layers:string[][], order:string[],
 *   concurrentRead:string[], write:string[], heavy:string[], isolatedWrite:string[],
 *   unregistered:string[], structuralProblems:object[], writeContention:object[],
 *   dag: object,
 * }}
 */
export function buildGateView(gates) {
  const dag = createDag();
  for (const g of gates) {
    addNode(dag, { id: g.name, kind: NODE_KIND.VERIFY_FULL, gateName: g.name, label: g.name, needs: [] });
  }

  const { problems, layers, order } = validateDag(dag);
  const structuralProblems = problems.filter((p) => STRUCTURAL_CODES.has(p.code));
  const writeContention = problems.filter((p) => p.code === 'DAG_WRITE_SAME_LAYER');

  const concurrentRead = [];
  const write = [];
  const heavy = [];
  const isolatedWrite = [];
  const unregistered = [];

  for (const g of gates) {
    const cap = capOf(g.name);
    if (cap.unregistered) unregistered.push(g.name);
    if (cap.pool === POOL.HEAVY) heavy.push(g.name);
    if (isWriteCap(cap)) {
      write.push(g.name);
      // 隔离临时写（isolated-home，各写各的临时槽位）区别于共享写资源；静态留痕，不擅自判可并发。
      if (cap.pool === POOL.CPU) isolatedWrite.push(g.name);
    }
    if (isConcurrentRead(cap)) concurrentRead.push(g.name);
  }

  return {
    gateNames: gates.map((g) => g.name),
    layers,
    order,
    concurrentRead,
    write,
    heavy,
    isolatedWrite,
    unregistered,
    structuralProblems,
    writeContention,
    dag,
  };
}
