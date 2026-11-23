/**
 * candidates.ts —— 批 4 候选受闸吸收登记（Main 2026-11-23 裁决口径）。
 *
 * ## 口径
 * · 一期采纳：候选 1 / 2 / 5 / 6 —— 走 `ingested → parsed → translated → adjudicated → committed`，
 *   adjudication 证据 = Main 2026-11-23 裁决口径 + 一手来源 URL，逐条落 provenance；
 * · 二期观察：候选 3 / 4 / 7a / 7b —— 仅登记 blocked 观察条目（含一手源与 blocked 点），不施工；
 * · 候选 8 —— 移出批 4（归动作级权限企划），不在本池登记为记录。
 *
 * ## 纪律
 * · 本登记册是受控表格 / 状态机产物；候选翻译为吸收口径记录，不自动立施工卡、不改仓外事实；
 * · 简报失实数字 / 无据翻译假设逐条进 `boundary_notes` 或 `blocked_points`，不升级为事实；
 * · 现役冲突对账未决项留在 blocked，不自行设计字段、不另立第二事实源。
 */
import { IngestionStore } from './store.js';
import type { AbsorbedPayload, RecordCategory } from './record.js';
import type { Provenance, Adjudication } from './provenance.js';

/** 批 4 封写者（单写者署名）。 */
export const BATCH4_WRITER = 'engine:batch4-ingestion';

/**
 * 候选 2 吸收的失败归因内部枚举（受闸口径登记，不接线现役 verdict / ledger，不另立第二套失败分类）。
 * · `agent` / `infra`：一手原文口径（stet.sh 原文仅两类）；
 * · `harness` / `unknown`：AgentIO 扩展值（原文没有，provenance 注明；与现役 unsupported/pending 边界待裁）。
 * ★ 本闭集是吸收口径登记；真正落 ledger 字段 / 挂现役 verdict 属后续对账批次。
 */
export const FAILURE_ORIGINS = ['agent', 'infra', 'harness', 'unknown'] as const;

/** `FAILURE_ORIGINS` 中属 AgentIO 扩展的取值（非一手原文）。 */
export const FAILURE_ORIGIN_EXTENSIONS = ['harness', 'unknown'] as const;

/** 候选 5 门名：内容上线前安慰剂消融（与现役选择漏选消融严格区分，不共用 ablation 口径）。 */
export const CONTENT_PLACEBO_ABLATION = 'content_placebo_ablation';

/** 现役消融核名（对照锚点；见 src/infrastructure/analysis/facts/incsel_ablation.ts）。 */
export const INCSEL_ABLATION = 'incsel_ablation';

/** 裁决回执公共段（Main 2026-11-23 裁决口径）。 */
const MAIN_RULING: Omit<Adjudication, 'basis' | 'note'> = {
  ruling_at: '2026-11-23T00:00:00.000Z',
  ruling_by: 'Main',
  ruling_ref: 'Main 2026-11-23 裁决口径（批 4 C+ 候选口径）',
};

interface SeedAdopted {
  id: string;
  category: RecordCategory;
  payload: AbsorbedPayload;
  source_kind: Provenance['source_kind'];
  source_ref: string;
  raw: string;
  basis: readonly string[];
  adjudication_note: string;
}

interface SeedObservation {
  id: string;
  category: RecordCategory;
  claim: string;
  source_kind: Provenance['source_kind'];
  source_ref: string;
  raw: string;
  basis: readonly string[];
  blocked_points: readonly string[];
  boundary_notes: readonly string[];
}

/** 一期采纳候选 id。 */
export const ADOPTED_IDS = ['batch4-cand-1', 'batch4-cand-2', 'batch4-cand-5', 'batch4-cand-6'] as const;

/** 二期观察候选 id（blocked，不施工）。 */
export const OBSERVATION_IDS = ['batch4-cand-3', 'batch4-cand-4', 'batch4-cand-7a', 'batch4-cand-7b'] as const;

/** 移出批 4 的候选（不登记为 ingestion 记录）。 */
export const EXCLUDED_CANDIDATES = [
  {
    id: 'batch4-cand-8',
    reason: '同意单元四元组键归动作级权限企划（P0–P3 待 Main 裁决）；批 4 文档闭环不施工、不翻译入候选。',
    source_ref: 'GHSA-ffp3-3562-8cv3 / CVE-2026-56074（本轮未抓一手复核）',
  },
] as const;

const ADOPTED: readonly SeedAdopted[] = [
  {
    id: 'batch4-cand-1',
    category: 'intent',
    source_kind: '外部散文',
    source_ref: 'https://dev.to/pvgomes/specs-are-not-agent-memory-5a9n',
    raw:
      '规格是有保质期的计划：交付后规格不再是现实的最佳描述，运行中的系统才是现实，代码是证据；' +
      '规格应离开运行路径——归档、挂到对应 issue、或压成更小制品；历史应是可检索证据，而非常驻指导。' +
      'ADR append-only、带状态与 supersession；决策变化时旧记录指向取代记录，而不是被改写成虚构。',
    basis: ['https://dev.to/pvgomes/specs-are-not-agent-memory-5a9n'],
    adjudication_note:
      '吸收为「取代关系 + 归档墓碑 + active 投影过滤」；对齐现役 superseded_by 关系列 / supersede 事件；' +
      '不恢复已退役 superseded 状态（2026-10-22 退役裁决：取代是关系，不是状态，状态词表不得新增同义状态）。',
    payload: {
      claim:
        '交付后规格 / 原始提案属可检索证据，不参与现行上下文注入；取代以关系表达，归档留墓碑，' +
        'active 投影过滤已归档节点；归档≠删除，历史仍须可检索发现。',
      absorbed_as:
        '取代关系 + 归档墓碑 + active 投影过滤；对齐现役 superseded_by 关系列 / supersede 事件；' +
        'superseded_by 字段名是翻译，语义以现役关系为准。',
      alignment_anchors: [
        'src/domain/semantic.ts#SymbolLifecycle.superseded_by（现役关系列）',
        'docs/RETIRED.md（2026-10-22 退役裁决：取代是关系不是状态）',
        '.agent-io/design/archived/（归档册 overlay 墓碑：文件离开 semantic.files，属墓碑而非数据错）',
      ],
      boundary_notes: [
        'active/archived 分层与四类文本职责（guidelines / skills-playbooks / decision-records / specs-raw-history）' +
          '是模型翻译层，非原文术语。',
        '四类职责到 DSL 节点类型的映射须挂现役节点类型 / 册归属，不得另立一套权威登记。',
      ],
      blocked_points: [
        '归档读端过滤口径（哪些节点不参与判据与上下文注入）须与现役归档册 + 墓碑机制对账后定；不自行设计字段。',
      ],
    },
  },
  {
    id: 'batch4-cand-2',
    category: 'expectation',
    source_kind: '外部散文',
    source_ref: 'https://www.stet.sh/blog/benchmark-agreed-with-frontier-code',
    raw:
      '必须把 agent 失败与基础设施失败分开：容器超时、网络流中断、缺二进制、实现坏掉都会塌成 0；' +
      '基础设施坏时 runner 必须就地恢复该失败，否则数据被污染。评审者是带误差模式的仪器：' +
      '同一补丁重判约 10% 清单项翻转；调高 reasoning effort 更严；混用评审模型可反转一对排名。',
    basis: ['https://www.stet.sh/blog/benchmark-agreed-with-frontier-code'],
    adjudication_note:
      'failure_origin 内部枚举可采用 agent/infra/harness/unknown；provenance 注明原文仅 agent/infra，' +
      'harness/unknown 为 AgentIO 扩展；judge_noise / 翻转率作新增判据校准信号，不得与模型能力分混算。',
    payload: {
      claim:
        '评审者是带误差模式的仪器：judge_noise / 翻转率作为判据校准信号记录，不与模型能力分混算；' +
        '失败归因隔离 agent / infra；harness / unknown 为 AgentIO 扩展枚举值。',
      absorbed_as:
        'failure_origin 内部枚举 {agent, infra, harness, unknown}；评审噪声 / 翻转率校准信号位。',
      alignment_anchors: [
        'src/domain/judge_port.ts#Verdict 四值（pass/fail/unsupported/pending）',
        'judgeExpectations / judge_cache / criteria_worker_supervisor（现役判定链）',
      ],
      boundary_notes: [
        '原文失败区分仅 agent vs infrastructure 两类；harness、unknown 两值原文没有，属 AgentIO 扩展，provenance 注明。',
        '噪声信号只喂校准，不做一票否决、不进模型能力分；机器证据无一票否决，裁决权在系统 / 主控。',
        'unknown 兜底值与现役 unsupported/pending 的语义边界待裁。',
      ],
      blocked_points: [
        '翻转率阈值、双评审重判成本、归因枚举取值对账需 Main 裁决 + 实验定标；24 题小样本外推有限。',
      ],
    },
  },
  {
    id: 'batch4-cand-5',
    category: 'expectation',
    source_kind: '外部散文',
    source_ref: 'https://github.com/simonether/skill-placebo',
    raw:
      '三臂对照：no skill / placebo / skill；placebo 是与 skill 常驻 token 足迹等长（±10% 内实测）的中性文本，' +
      '经同一安装机制装入；仅加等长中性文本即可吃掉大部分表面收益，“有用”须相对等量噪声证明，而非相对“不加”证明。' +
      '方法：首跑前预注册；Holm 校正 + 置信区间，不挑好看的均值。',
    basis: [
      'https://github.com/simonether/skill-placebo',
      'https://ainews.leverageai.com.au/case/skill-placebo-benchmark',
    ],
    adjudication_note:
      '门范围 = DSL / 判据 / 提示注入「内容上线前安慰剂消融」；命名 content_placebo_ablation，' +
      '与现役 incsel_ablation（测试选择漏选消融）严格区分，不替代不混淆。',
    payload: {
      claim:
        'DSL 段落 / 判据 / 提示注入上线前跑等长中性文本安慰剂对照臂；A 相对等量噪声的差值跨过 CI 下界' +
        '才允许进强制段，否则 pending。',
      absorbed_as:
        'content_placebo_ablation（内容上线前安慰剂消融门）；与现役 incsel_ablation 严格区分，不共用 ablation 口径。',
      alignment_anchors: [
        'src/infrastructure/analysis/facts/incsel_ablation.ts（测试选择漏选消融：全量 verdict vs 增量选中集合逐文件对照）',
      ],
      boundary_notes: [
        '不吸收其 450 trials / 15 任务等外部实验数字为内部阈值；单模型、多数近天花板，长会话收益未测。',
        '现役 incsel_ablation 是「选择自身的判据」元判据，与等长中性文本安慰剂臂不同构。',
      ],
      blocked_points: [
        '消融任务集、模型对照、CI 成本是否入一期范围待 Main 裁；短任务测不出长会话收益，门设计须承认该边界。',
      ],
    },
  },
  {
    id: 'batch4-cand-6',
    category: 'fact',
    source_kind: '外部散文',
    source_ref: 'https://stripe.dev/blog/stripe-integration-evals-methodology',
    raw:
      '双口径：头条指标 = mean criteria success rate（MUST 与 SHOULD 都计入）；strict pass rate = 所有 MUST 判据全过，' +
      '按场景二元判定；同一批判据下均分从 78.1% 掉到 29.4%。宽松聚合分数系统性掩盖“几乎全勾、但勾不满”，' +
      '须并列平均通过率与全条件严格通过率。',
    basis: ['https://stripe.dev/blog/stripe-integration-evals-methodology'],
    adjudication_note:
      '剔除简报失实数字（11 套环境 / Opus 92% / GPT-5.2 73% / 63 轮均不吸收）；只吸收双口径 ' +
      'criteria_pass_rate / all_criteria_pass + 失败判据 id 一等清单；走现役 rateOf question 注册表，不另造统计权威。',
    payload: {
      claim:
        '双口径并列：criteria_pass_rate（宽松均分口径）+ all_criteria_pass（全条件严格二元口径）；' +
        '失败判据 id 作为一等清单；报表不得只用加权平均，须附全绿场景占比。',
      absorbed_as:
        '双口径字段名 + 失败判据 id 一等清单；走现役 rateOf question 注册表（分子⊆分母、双数同印、禁自造问题）。',
      alignment_anchors: [
        'src/domain/rate.ts#rateOf / RATE_QUESTIONS（率的唯一产出点；自造问题 = 第二处权威即抛）',
      ],
      boundary_notes: [
        '简报失实数字（11 套可复现环境 / Opus 4.5 全栈 92% / GPT-5.2 gym 集 73% / 最佳运行平均 63 轮工具调用）' +
          '原文不支持，一律不吸收。',
        'MUST/SHOULD 分层与现役判据类型对账；strict 布尔与现役 verdict 四值对齐。',
        '新 rateOf question 待报表调用点落地时注册；本批不造无调用点的死枚举。',
      ],
      blocked_points: [
        '双口径字段是否入一期 ledger 由 Main 裁决；Stripe 域偏置，69 场景不代表通用仓库。',
      ],
    },
  },
];

const OBSERVATIONS: readonly SeedObservation[] = [
  {
    id: 'batch4-cand-3',
    category: 'fact',
    source_kind: '外部散文',
    source_ref: 'https://modelcontextprotocol.io/extensions/events/overview',
    raw:
      '订阅/恢复：null cursor 表示“从现在开始”；投递含 {eventId, name, timestamp, data, cursor}；' +
      '服务端无法从该位置服务时以 truncated: true 告知事件被跳过。payload 是不可信外部数据，按 tool results 对待；' +
      '收到事件从不授权 agent 行动，后续工具调用走正常 MCP 授权。',
    basis: [
      'https://modelcontextprotocol.io/extensions/events/overview',
      'https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415',
      'https://news.sulat.com/2026/11/21/mcp-events-extension/',
    ],
    claim: 'MCP Events：游标 + truncated 显式截断；payload 不可信；收到事件不授权行动。',
    boundary_notes: [
      'authorizes_action=false 字段名是模型翻译；规范原文表述为 “Receiving an event never authorizes the agent to act”。',
    ],
    blocked_points: [
      '扩展 Beta，规范仍可能改；SDK 支持矩阵多为 partial/webhook-only。',
      '现役观测线 / 事件源接入方式未对账；一期不纳入事件吸收管线设计，待 Main 另裁。',
    ],
  },
  {
    id: 'batch4-cand-4',
    category: 'fact',
    source_kind: '外部散文',
    source_ref: 'https://github.com/coleam00/Archon/releases/tag/v0.14.0',
    raw:
      'A run can hold a lease on a state document (archon state put|patch --lease, --release-lease). ' +
      'Reads report whether the lease is live from the holder run’s status, and the engine never ends a lease on age. ' +
      'The SDLC pack’s claims use it.',
    basis: [
      'https://github.com/coleam00/Archon/releases/tag/v0.14.0',
      'https://undercodenews.com/archon-cli-v0140-just-changed-how-ai-software-factories-build-and-ship-code-video/',
    ],
    claim: '租约活性依据 holder run 状态读取；引擎不因存在时长（age）自动终止租约。',
    boundary_notes: [
      'holder_run_id + heartbeat_seq、“心跳超 N 周期 ⇒ 租约失效”官方 changelog 未出现；heartbeat 方案属模型翻译假设，' +
      '不得写成 Archon 已实现字段。',
      '同名 fork 镜像多，登记以 coleam00/Archon 为准。',
    ],
    blocked_points: [
      '需补上游源码租约状态判定实现；网络分区下 holder 死亡误判口径未展开。',
      '与现役 claim 闸 / 读集冲突机制对账后再议。',
    ],
  },
  {
    id: 'batch4-cand-7a',
    category: 'fact',
    source_kind: '外部散文',
    source_ref: 'https://datatracker.ietf.org/doc/draft-zambo-aer1/',
    raw:
      'Producer MUST 为收到的每个工具调用出收据，包括执行前被拒的调用；拒绝收据记录被请求的工具、收到时的参数、' +
      '返回的错误；拒绝收据 MUST NOT 记为已完成执行；不留收据的调用是一致性失败。收据链成 hash-chained job timeline。',
    basis: [
      'https://datatracker.ietf.org/doc/draft-zambo-aer1/',
      'https://www.ietf.org/archive/id/draft-zambo-aer1-25.html',
      'https://www.ietf.org/archive/id/draft-zambo-aer1-audit-data-model-00.txt',
      'https://dev.to/rambozambo/is-there-an-mcp-server-that-records-every-tool-call-my-agent-makes-3pn3',
    ],
    claim: 'AER-1 可验证执行收据：被拒调用也出收据，拒绝留证不记为完成执行。',
    boundary_notes: [
      '草案自陈边界：收据证明记录已签发且之后未被篡改；不证明答案正确、不证明输入为真、不证明世界按记录变化。',
    ],
    blocked_points: [
      'draft-zambo-aer1-26 为 WIP 草案、非 RFC，未生效；引用须标 WIP。',
      '拒绝留证字段与现役 ledger 记录类型对账留二期。',
    ],
  },
  {
    id: 'batch4-cand-7b',
    category: 'fact',
    source_kind: '外部散文',
    source_ref: 'https://www.moltbook.com/post/0dd1daec-ec48-4bc6-b320-ef6945a2dec3',
    raw:
      'Runner 把已提交审批的 event ID 与它实际发出的请求一起记录；ID 缺失时，即使时间戳完美对齐，' +
      '审计也应输出 approval unproven；墙钟时间不能证明审批先后（各有时钟，小偏移即可把迟到审批排成先发生）。',
    basis: ['https://www.moltbook.com/post/0dd1daec-ec48-4bc6-b320-ef6945a2dec3'],
    claim: '审批事件 ID 写入请求；ID 缺失 ⇒ approval unproven；时钟证明不了先后。',
    boundary_notes: ['个人工程随笔，无规范地位、无实现或复核；契约形态未一手核实。'],
    blocked_points: ['待规范 / 实现级来源出现后再升级等级；provenance 强度低。'],
  },
];

/**
 * 构建批 4 登记册：四采纳候选 committed，四观察条目 blocked。
 * 写者与时钟可注入（测试用固定时钟；生产入口封 BATCH4_WRITER）。
 */
export function buildBatch4Store(opts?: { writer?: string; now?: () => string }): IngestionStore {
  const writer = opts?.writer ?? BATCH4_WRITER;
  const store = new IngestionStore(writer, { now: opts?.now });

  for (const seed of ADOPTED) {
    const provenance: Provenance = {
      source_kind: seed.source_kind,
      source_ref: seed.source_ref,
      captured_at: '2026-11-23T00:00:00.000Z',
      writer,
      raw: seed.raw,
      // 翻译席位 / 版本未在本批留痕 ⇒ model 留空（不编版本）；后续 model-in-the-loop 实跑时补登。
      model: null,
    };
    let rec = store.register({ id: seed.id, category: seed.category, payload: seed.payload, provenance });
    rec = store.parse(rec.id, '系统结构校验：锚点 / 类型 / 字段完整性 / 冲突初筛通过', writer);
    rec = store.transition(
      rec.id,
      'translated',
      '候选翻译来自批 4 研究子代理（候选非权威；模型席位 / 版本未留痕）',
      writer,
    );
    rec = store.adjudicate(
      rec.id,
      { ...MAIN_RULING, basis: seed.basis, note: seed.adjudication_note },
      writer,
    );
    store.commit(rec.id, writer);
  }

  for (const seed of OBSERVATIONS) {
    const provenance: Provenance = {
      source_kind: seed.source_kind,
      source_ref: seed.source_ref,
      captured_at: '2026-11-23T00:00:00.000Z',
      writer,
      raw: seed.raw,
      model: null,
    };
    let rec = store.register({
      id: seed.id,
      category: seed.category,
      payload: {
        claim: seed.claim,
        absorbed_as: '二期观察条目：本批不施工、不翻译入候选',
        alignment_anchors: [],
        boundary_notes: seed.boundary_notes,
        blocked_points: seed.blocked_points,
      },
      provenance,
    });
    rec = store.parse(rec.id, '系统结构校验完成；待补源 / 对账 / 规范稳定后再议', writer);
    store.transition(rec.id, 'blocked', seed.blocked_points.join('；'), writer);
  }

  return store;
}
