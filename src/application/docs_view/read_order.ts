/**
 * 取数顺序模型（企划 §5.1 · Main 验收追加 5③）。
 *
 * 顺序：`capability_map → index_integrity → get_dsl → design_line → ledger → capability_audit`。
 * · 内核新鲜度 / 状态模型本批即支撑：每条读数带来源视图与新鲜度标注；
 * · **取数侧接线施工留批 2**；本文件只冻结顺序、职责与新鲜度口径，不实现各视图调用。
 * · 上游视图缺读数 ⇒ 按 §2.3 降级两路：非语义路可降级但须可见化（非绿）；语义路缺模型 blocked/unsupported。
 */

export interface ReadOrderStep {
  key: string;
  role: string;
  freshnessNote: string;
}

export const READ_ORDER: readonly ReadOrderStep[] = [
  {
    key: 'capability_map',
    role: '工具/能力目录与归属（注册表派生）',
    freshnessNote: '注册表现算；归属由 LANE_SOURCES 派生，不存第二份清单。',
  },
  {
    key: 'index_integrity',
    role: '源码/符号/调用事实与索引新鲜度裁决',
    freshnessNote: '三态 verdict；索引陈旧必须显式标注，不拿陈旧索引当新鲜事实。',
  },
  {
    key: 'get_dsl',
    role: '设计册意图/决策/判据/节点卡（内部权威读端）',
    freshnessNote: '读内部权威；读数带册版本/快照指纹，供投影 stale 比对。',
  },
  {
    key: 'design_line',
    role: '设计主线与节点链路',
    freshnessNote: '随 get_dsl 同册新鲜度；链路断裂单列，不补空叙事。',
  },
  {
    key: 'ledger',
    role: '任务/事件/裁定/销账台账（只读）',
    freshnessNote: '历史 append-only 证据不挂 fresh 门；当前态读数须区分 active 与历史。',
  },
  {
    key: 'capability_audit',
    role: '语言/能力档位现算',
    freshnessNote: '现算不写死语言数；能力不足降级为 syntax-only/unsupported，不猜。',
  },
] as const;

export const READ_ORDER_KEYS: readonly string[] = READ_ORDER.map((s) => s.key);

/** 读数新鲜度标注（投影块头/对账结果携带；取数侧批 2 填充实际指纹） */
export interface FreshnessTag {
  view: string;
  rev: string;
  readable: boolean;
  reason?: string;
}
