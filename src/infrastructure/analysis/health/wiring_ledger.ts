/**
 * **能力接线账**（`docs/PROJECT-DESIGN.md` §13.4「接线证明」的最小落地）。
 *
 * ## 它回答的唯一问题
 * 「一个**已声明**的能力，从真实入口到核销，链断在哪一环？」
 * —— 不是"有没有 importer"（那已有 `code_health` 的 `unused_export` / `orphan_file` 在答）。
 *
 * ## 为什么挂在 `code_health` 里
 * §13.4 末段点名让它落在既有读数入口：`code_health` 已经产 `issues` + `byKind` + `score`，
 * 接线账是给它**加一段读数**，不新建体系、不新建工具、不新建台账。
 *
 * ## 硬规则（每条都对应一个历史事故，写在判据里而不是注释里）
 * ① **零 import ≠ 死**：没有静态消费者只到 `missing-consumer`，永不输出 "dead/删掉"；
 * ② **静态调用 ≠ 真实执行**：只有运行读数（`judge-readings#by_kind` 等）才算 `executed`；
 * ③ **没有运行记录 ≠ 没有价值**：那是 `static-only`，不是 red；
 * ④ **证据不足 ⇒ `unverifiable`**：声明都读不到时不下任何结论，绝不猜；
 * ⑤ **显式预留/实验不得冒充已接入**：有 `reserved` 声明且未真接 ⇒ `reserved-experiment`；
 * ⑥ **本模块只读**：不删任何能力、不改任何文件。
 */

/** 七态（**只允许**这七个；新增要另开审议，不许就地加） */
export type WiringStatus =
  | 'connected'
  | 'static-only'
  | 'missing-input'
  | 'missing-consumer'
  | 'missing-handoff'
  | 'reserved-experiment'
  | 'unverifiable';

/** 一条接线账读数（**六字段固定**，顺序即输出顺序） */
export type WiringEntry = {
  /** 主体：文件#符号，或判据 kind */
  subject: string;
  /** 它声称服务哪个能力（来自设计册 decision.summary 或注册表 why） */
  claimed_capability: string;
  status: WiringStatus;
  /** 断在哪一环（`null` = 没断） */
  broken_at: 'declaration' | 'input' | 'handoff' | 'consumer' | 'execution' | null;
  /** 凭什么这么判（逐项列出探到的原始事实，读端可复核） */
  evidence: string[];
  /** 下一步该接哪一格（`null` = 不用接） */
  next_action: string | null;
};

/** 声明侧（能力自己声称的 + 显式预留） */
export type WiringDeclaration = {
  subject: string;
  claimed_capability: string;
  /** 显式预留 / 实验声明（写了它 ⇒ 未真接时不报问题，报 `reserved-experiment`） */
  reserved?: string;
};

/** 探到的事实（六格，全部**现算**，不做缓存推断） */
export type WiringFacts = {
  /** 声明点读得到（类型 / 注册表 / 导出） */
  declared: boolean;
  /** 能力需要的**素材**在不在（如 runtime 的事件流、deriveJudgements 的 contract 实例） */
  input_present: boolean;
  /** 上游产物能否**直接**成为它的输入（交接物形状匹配） */
  handoff_connected: boolean;
  /** 有真实消费者（调用 / 读该字段 / 册里真写了一条） */
  consumed: boolean;
  /** 有**运行**读数（判过、跑过），不是静态调用 */
  executed: boolean;
  /** 上述每格的原始依据（人可复核的一句话） */
  notes: Partial<Record<'declared' | 'input' | 'handoff' | 'consumer' | 'execution', string>>;
};

/**
 * **接线判定**（纯函数，唯一实现）。
 *
 * 判定顺序 = 链的物理顺序，**命中即停**（后面的环没意义了）：
 * 声明 → 输入 → 交接 → 消费 → 执行 → 连接。
 * 顺序不是偏好：链断在输入时，"有没有消费者"根本不是当下要回答的问题。
 */
export function assessWiring(d: WiringDeclaration, f: WiringFacts): WiringEntry {
  // ★ 2026-11-08：主体/能力名**归一化**（去首尾空白）—— 台账里一个多余空格就会把
  //   同一个对象拆成两条，且按名字找消费者时对不上。行为对现有数据等价。
  // 内部连续空白也归一（台账里 'a  b' 与 'a b' 应是同一个对象）
  const lab = (v: string): string => String(v ?? '').trim().replace(/\s+/g, ' ');
  const ev: string[] = [];
  const push = (k: keyof WiringFacts['notes'], ok: boolean): void => {
    if (f.notes[k]) ev.push(`${ok ? '✓' : '✗'} ${k}: ${f.notes[k]}`);
  };

  // ④ 证据不足（声明都读不到）⇒ 不下结论
  if (!f.declared) {
    push('declared', false);
    return {
      subject: lab(d.subject),
      claimed_capability: lab(d.claimed_capability),
      status: 'unverifiable',
      broken_at: 'declaration',
      // 证据里点名是**哪个对象**判不了（否则台账里一条 unverifiable 看不出主语）
      evidence: ev.length ? ev : [`✗ ${lab(d.subject)}：读到 0 条声明事实 ⇒ 判不了（不猜）`],
      next_action: '先把声明点找出来（类型 / 注册表 / 导出）再来判；在此之前不许标 connected，也不许标死',
    };
  }
  push('declared', true);

  // ⑤ 显式预留：**已经真接上了**就按实况报 connected，否则报 reserved-experiment（不报问题）
  const reallyConnected = f.consumed && f.executed;
  if (d.reserved && !reallyConnected) {
    push('consumer', f.consumed);
    push('execution', f.executed);
    ev.push(`◆ 显式预留：${d.reserved}`);
    return {
      subject: lab(d.subject),
      claimed_capability: lab(d.claimed_capability),
      status: 'reserved-experiment',
      broken_at: null,
      evidence: ev,
      next_action: '保持预留；等真实任务出现再接（**不判死、不删**）',
    };
  }

  // 输入
  if (!f.input_present) {
    push('input', false);
    return {
      subject: lab(d.subject),
      claimed_capability: lab(d.claimed_capability),
      status: 'missing-input',
      broken_at: 'input',
      evidence: ev,
      next_action: `先造出它要的输入（${f.notes.input ?? '见 evidence'}）；输入不存在时"有没有消费者"不是问题`,
    };
  }
  push('input', true);

  // 交接
  if (!f.handoff_connected) {
    push('handoff', false);
    return {
      subject: lab(d.subject),
      claimed_capability: lab(d.claimed_capability),
      status: 'missing-handoff',
      broken_at: 'handoff',
      evidence: ev,
      next_action: `把上游产物接到它的入参上（${f.notes.handoff ?? '见 evidence'}）—— 只接这一格，不动模块`,
    };
  }
  push('handoff', true);

  // 消费
  if (!f.consumed) {
    push('consumer', false);
    return {
      subject: lab(d.subject),
      claimed_capability: lab(d.claimed_capability),
      status: 'missing-consumer',
      broken_at: 'consumer',
      evidence: ev,
      next_action: '找一个真实任务来消费它；**不要因为没人用就删**（公共库/插件可合法等消费者）',
    };
  }
  push('consumer', true);

  // ③ 有消费者但没运行读数 ⇒ static-only（不是 red）
  if (!f.executed) {
    push('execution', false);
    return {
      subject: lab(d.subject),
      claimed_capability: lab(d.claimed_capability),
      status: 'static-only',
      broken_at: 'execution',
      evidence: ev,
      next_action: '让它在一次真实运行/判定里被跑到（**没有运行记录 ≠ 没有价值**）',
    };
  }
  push('execution', true);

  return {
    subject: lab(d.subject),
    claimed_capability: lab(d.claimed_capability),
    status: 'connected',
    broken_at: null,
    evidence: ev,
    next_action: null,
  };
}

/** 一条能力的最小声明 + 事实探针（探针返回 `WiringFacts`，由调用方现算） */
export type WiringProbe = {
  declaration: WiringDeclaration;
  probe: () => WiringFacts;
};

/**
 * 跑一批探针，产出接线账。
 * ★ 探针**抛错** ⇒ 该条 `unverifiable`（证据不足不下结论，更不冒领 connected）。
 */
export function buildWiringLedger(probes: readonly WiringProbe[]): WiringEntry[] {
  return probes.map((p) => {
    try {
      return assessWiring(p.declaration, p.probe());
    } catch (e) {
      return {
        subject: p.declaration.subject,
        claimed_capability: p.declaration.claimed_capability,
        status: 'unverifiable' as const,
        broken_at: 'declaration' as const,
        evidence: [`✗ 探针失败：${(e as Error).message}`],
        next_action: '先修探针（读不到事实 ≠ 能力有问题）',
      };
    }
  });
}
