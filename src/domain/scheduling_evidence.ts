/**
 * 调度证据帧 —— **纯类型、形状判据与版本对齐**（本文件无 IO）。
 *
 * ## 它回答什么问题
 * 同一个目标下，各份证据（源码/设计/测试/能力/运行）**是不是在说同一件事**：
 * 版本对不对得上、范围有没有声明、结论是不是当前那次的。答不上就必须说"判不了"。
 *
 * ## 三条不许违反的词表约束
 * 1. **缺版本不是新鲜**：`versionAlignment()` 只在两侧都有版本且**相等**时给 `fresh`；
 *    缺任一侧 ⇒ `unavailable`（不可判），verdict 保持 `unknown`，不是 `pass`。
 * 2. **`scope=[]` 不是全项目**：空范围只表示"没声明范围"，消费方必须当不可判；
 *    `scopeOfSignal()` 的空值读数因此是 `undeclared`，不是 `whole-project`。
 * 3. **不同来源说不同结论 ⇒ 两边都留**：本文件只描述形状，不做投票、不做覆盖；
 *    冲突由 `evidence_frame` 原样收进 `conflicts`。
 *
 * ## 为什么这些是纯函数
 * 证据对齐的判据必须能在没有项目、没有索引、没有盘的情况下被反例钉住；
 * 一旦把 fs / db 混进来，"版本对不上"和"读不到"就会同形 —— 那正是本卡要治的病。
 */

/** 证据种类。`runtime` 是后续适配槽：本期没有可靠只读输入 ⇒ 不许为了填满字段造空证据。 */
export const EVIDENCE_KINDS = ['source', 'design', 'test', 'capability', 'runtime'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** 结论词表。`unknown` 是一等公民：它表示"没有可用的当前结论"，不许被读成 pass。 */
export const EVIDENCE_VERDICTS = ['pass', 'fail', 'unsupported', 'pending', 'unknown'] as const;
export type EvidenceVerdict = (typeof EVIDENCE_VERDICTS)[number];

/** 新鲜度词表。`conflicting` = 同一对象上有互不相容的当前读数（两边都要留）。 */
export const EVIDENCE_FRESHNESS = ['fresh', 'stale', 'unavailable', 'conflicting'] as const;
export type EvidenceFreshness = (typeof EVIDENCE_FRESHNESS)[number];

/** 对象身份：三条轴**同时**可表达，缺省表示"这条证据不谈那根轴"。 */
export interface EvidenceSubject {
  /** 仓库相对路径（正斜杠） */
  path?: string;
  /** `qualified_name` */
  symbol?: string;
  /** 判据引用：`decision:<node>#<i>` / `cert:<证>#<检查号>` */
  judgement_ref?: string;
}

/** 一条证据。字段缺失一律表示"没读到/没声明"，不表示"没问题"。 */
export interface EvidenceSignal {
  /** 稳定 id（同一来源同一对象重算应得到同一 id，便于重放比对） */
  id: string;
  kind: EvidenceKind;
  subject: EvidenceSubject;
  /** 哪个权威读出来的（人可回溯的位置，如 `verified-snapshot:.agent-io/verified-snapshot.json`） */
  source_ref: string;
  /** 该来源自己的版本（内容哈希 / 图版本 / 册 revision …）；缺失 = 未知，不是新鲜 */
  source_version?: string;
  /** 设计册版本：`<feature>#<_dsl_rev>` */
  design_revision?: string;
  /** ISO 时点（只有来源真的记了才填） */
  observed_at?: string;
  /** 这条证据覆盖了哪些对象（仓库相对路径或 `design:<feature>`）。
   *  ★ 空数组 = **没声明范围**，绝不能被读成"全项目有效"。 */
  scope: string[];
  verdict: EvidenceVerdict;
  freshness: EvidenceFreshness;
  /** 人读理由（缺版本/过期/冲突的具体原因） */
  reason?: string;
}

/** 缺口种类：七种必须互相区分（见 docs 里的 DS-1 卡）。 */
export const GAP_KINDS = [
  /** 没有对象 */
  'missing',
  /** 对象存在但没有证据 */
  'missing-evidence',
  /** 有证据但过期 */
  'stale',
  /** 证据冲突（两边都留着） */
  'conflicting',
  /** 读取失败 */
  'unavailable',
  /** 能力不支持 */
  'unsupported',
  /** 当前对象已 retired */
  'retired',
  /** 身份歧义（同路径多候选 / 多册争同一对象） */
  'ambiguous',
  /** 影响关系不可信（不许当"没影响"） */
  'impact-untrusted',
  /** 目标超出声明范围 */
  'out-of-scope',
  /** 还在等外部结果 */
  'pending',
] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export interface FrameGap {
  id: string;
  kind: GapKind;
  /** 人读对象名（路径 / 符号 / 册） */
  subject: string;
  reason: string;
  /** 支撑该缺口的证据 id（**可为空**：读不到的时候本来就一条证据都没有） */
  signals: string[];
}

/** 证据帧：一次诊断的**只读快照**，不含任何执行结果。 */
export interface EvidenceFrame {
  project: {
    /** 绝对路径（展示用） */
    root: string;
    /** 归一身份（`\`→`/`、win32 小写）；★ 只用于比较"是不是同一处"，不用于判权限 */
    identity: string;
  };
  goal: {
    /** 人给的目的一句话（可空：目标未声明本身就是一个缺口） */
    text: string;
    /** 声明的判据引用（`decision:…#i`） */
    judgement_refs: string[];
    /** 声明的作用范围（仓库相对路径前缀；空 = 未声明） */
    scope: string[];
  };
  content: {
    /** 当前源码内容版本（`contentVersion()` 现算）；null = 算不出来 */
    version: string | null;
    /** 逐文件指纹；null = 算不出来（不许当空集） */
    files: Record<string, string> | null;
    source_ref: string;
  };
  design_revisions: Array<{
    feature: string;
    /** `<feature>#<_dsl_rev>`；null = 册里没有 revision 字段 */
    revision: string | null;
    source_ref: string;
  }>;
  index: {
    state: 'usable' | 'partial' | 'unusable' | 'missing' | 'unavailable';
    schema_version: number | null;
    /** 落后于磁盘的已索引文件数（范围内口径）；null = 没测 */
    stale_files: number | null;
    /** 本次口径的分母（`freshnessScope` 范围内文件数）；null = 没测 */
    stale_total: number | null;
    /** 陈旧断言数（resolved 但目标名已不在索引）；null = 没测 */
    untrusted_refs: number | null;
    reason?: string;
  };
  capability: {
    /** 识别到的 runner 种类；null = 认不出/没测 */
    runner: string | null;
    /** 逐文件解析档位（`call` / `symbol` / `none`） */
    tiers: Array<{ path: string; tier: string }>;
    reason?: string;
  };
  signals: EvidenceSignal[];
  gaps: FrameGap[];
  /** 互不相容的当前读数（**两边都留**，不覆盖、不投票） */
  conflicts: FrameGap[];
  /** 当前判为不执行的对象（retired / node retired） */
  excluded: Array<{ id: string; reason: string }>;
  /** 明确的不可判（分母不删） */
  undetermined: Array<{ id: string; reason: string }>;
  /** 本期没接的数据源与已知边界（诚实清单，消费方必须读） */
  limitations: string[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isOneOf = <T extends readonly string[]>(vocab: T, v: unknown): v is T[number] =>
  typeof v === 'string' && (vocab as readonly string[]).includes(v);

/** 归一身份：`\`→`/`、去尾斜杠、win32 小写。★ 与 `impact_set` / `verified_snapshot` 的 `norm` 同口径（路径**相对**部分）。 */
export function identityOf(absPath: string, platform: string = process.platform): string {
  const posix = String(absPath).replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? posix.toLowerCase() : posix;
}

/** 相对路径归一（仓库相对、正斜杠、无 `./` 前缀）。 */
export function relativeKey(rel: string): string {
  return String(rel).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** 对象身份键：三轴拼一个稳定串（缺省轴用空串，不用 `*` —— `*` 会掩盖"没声明"）。 */
export function subjectKey(subject: EvidenceSubject | undefined | null): string {
  const s = subject ?? {};
  return `${relativeKey(s.path ?? '')}::${String(s.symbol ?? '')}::${String(s.judgement_ref ?? '')}`;
}

/**
 * 形状判据：**坏输入不许被当成"空证据"**。
 * 返回 `null` = 合格；否则返回可定位的人话原因（哪一字段、什么值）。
 */
export function signalShapeError(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'signal 不是对象';
  const s = v as Record<string, unknown>;
  if (!isStr(s.id) || s.id.trim() === '') return 'id 缺失或为空';
  if (!isOneOf(EVIDENCE_KINDS, s.kind)) return `kind 不在词表：${String(s.kind)}`;
  if (!s.subject || typeof s.subject !== 'object' || Array.isArray(s.subject)) return 'subject 不是对象';
  const subject = s.subject as Record<string, unknown>;
  for (const k of ['path', 'symbol', 'judgement_ref'] as const) {
    if (subject[k] !== undefined && !isStr(subject[k])) return `subject.${k} 不是字符串：${String(subject[k])}`;
  }
  if (!isStr(s.source_ref) || s.source_ref.trim() === '') return 'source_ref 缺失（**没有来源的证据不算证据**）';
  if (!Array.isArray(s.scope)) return 'scope 不是数组（★ 缺 scope 不许补成"全项目"）';
  if ((s.scope as unknown[]).some((x) => !isStr(x))) return 'scope 里有非字符串项';
  if (!isOneOf(EVIDENCE_VERDICTS, s.verdict)) return `verdict 不在词表：${String(s.verdict)}`;
  if (!isOneOf(EVIDENCE_FRESHNESS, s.freshness)) return `freshness 不在词表：${String(s.freshness)}`;
  for (const k of ['source_version', 'design_revision', 'observed_at', 'reason'] as const) {
    if (s[k] !== undefined && !isStr(s[k])) return `${k} 不是字符串：${String(s[k])}`;
  }
  return null;
}

/** 合格则原样返回，不合格**抛**（调用方必须把坏输入变成诊断，不许吞成空集）。 */
export function assertEvidenceSignal(v: unknown): EvidenceSignal {
  const err = signalShapeError(v);
  if (err) throw new Error(`证据帧形状不合法：${err}`);
  return v as EvidenceSignal;
}

/**
 * 版本对齐（本卡的核心判据之一）。
 *
 * | 产出侧 | 当前侧 | 结论 | 为什么 |
 * |---|---|---|---|
 * | 缺失 | 任意 | `unavailable` | 缺版本不是新鲜，是"判不了" |
 * | 有 | 缺失 | `unavailable` | 当前版本算不出来 ⇒ 无从对齐 |
 * | 有 | 有且相等 | `fresh` | 唯一可以宣称"这就是当前那次的"的情况 |
 * | 有 | 有但不等 | `stale` | 旧版本证据不许当当前证据 |
 */
export function versionAlignment(
  produced: string | null | undefined,
  current: string | null | undefined,
): { freshness: EvidenceFreshness; reason: string } {
  if (!isStr(produced) || produced === '') return { freshness: 'unavailable', reason: 'version-unknown:产出侧没有版本' };
  if (!isStr(current) || current === '') return { freshness: 'unavailable', reason: 'version-unknown:当前版本算不出来' };
  if (produced === current) return { freshness: 'fresh', reason: 'version-aligned' };
  return { freshness: 'stale', reason: `version-mismatch:${produced.slice(0, 12)}≠${current.slice(0, 12)}` };
}

/**
 * 逐文件对齐：一份证据记下的观察面指纹 vs 现在现算的指纹。
 *
 * ★ 只用**证据自己声明的观察面**参与对齐：`observes` 为空 ⇒ `unavailable`（判不了），
 *   不许退化成"整份基线版本相同 ⇒ 新鲜"（那会把"没观察"读成"观察过且没变"）。
 */
export function observesAlignment(input: {
  observes: readonly string[] | undefined;
  baselineFiles: Record<string, string> | null | undefined;
  currentFiles: Record<string, string> | null | undefined;
}): { freshness: EvidenceFreshness; reason: string; drifted: string[] } {
  const observes = [...new Set((input.observes ?? []).map(relativeKey).filter(Boolean))].sort();
  if (observes.length === 0) return { freshness: 'unavailable', reason: 'observes-empty:证据没声明观察面', drifted: [] };
  const base = input.baselineFiles ?? null;
  const cur = input.currentFiles ?? null;
  if (!base) return { freshness: 'unavailable', reason: 'baseline-files-missing:基线里没有逐文件指纹', drifted: [] };
  if (!cur) return { freshness: 'unavailable', reason: 'current-files-missing:当前指纹算不出来', drifted: [] };
  const drifted: string[] = [];
  for (const f of observes) {
    const b = base[f];
    const c = cur[f];
    if (b === undefined) return { freshness: 'unavailable', reason: `observes-not-in-baseline:${f}`, drifted };
    if (c === undefined) return { freshness: 'unavailable', reason: `observes-not-on-disk:${f}`, drifted };
    if (b !== c) drifted.push(f);
  }
  if (drifted.length > 0) {
    return { freshness: 'stale', reason: `version-mismatch:观察面已变（${drifted.slice(0, 3).join(', ')}）`, drifted };
  }
  return { freshness: 'fresh', reason: 'version-aligned', drifted: [] };
}

/** 范围读数：空范围是**未声明**，不是全项目。 */
export function scopeOfSignal(signal: Pick<EvidenceSignal, 'scope'>): 'declared' | 'undeclared' {
  return (signal.scope ?? []).length > 0 ? 'declared' : 'undeclared';
}

/** 判据侧对象的**身份 scheme（唯一一处）**：新增一类判据侧对象只改这里，不在策略里逐个加前缀。 */
export const JUDGEMENT_REF_SCHEMES = ['design', 'decision', 'cert'] as const;

/**
 * 判据侧对象身份（DS-1R3 T-02）：`design:` / `decision:` / `cert:` 都是**判据/设计侧**引用，
 * 不是源码文件路径 ⇒ 不该按文件 scope 越界处理；反过来 `src/a.ts` / `all-eligible` 不是判据侧对象。
 */
export function isJudgementRef(target: string): boolean {
  const t = String(target ?? '').trim();
  const i = t.indexOf(':');
  if (i <= 0) return false;
  const scheme = t.slice(0, i).toLowerCase();
  if (!(JUDGEMENT_REF_SCHEMES as readonly string[]).includes(scheme)) return false;
  // scheme 之后必须有内容（`cert:` 这种空引用不算）
  return t.slice(i + 1).trim() !== '';
}

/** 单个测试对象的形态（`tests/a.test.mjs`）；目录名（`tests`）不是对象 ⇒ 不许当 target。 */
export function isTestObjectPath(target: string): boolean {
  const t = relativeKey(target);
  return /\.[A-Za-z0-9]+$/.test(t) && !t.endsWith('/');
}

/**
 * 对象候选解析（DS-1R 重写）：**先把写法归一，再看身份**。
 *
 * · `src/a.ts` / `./src/a.ts` / `src\a.ts` ⇒ **同一个对象**（合并，原始写法保留以便回溯）；
 * · 只有同一归一键对应**多个不同稳定对象 id** 时才是歧义（`{raw, id}` 的 id 来自册/索引）；
 * · 没有任何 id 输入时**不许**仅凭"写法数量"制造歧义 —— 那会把正常输入报成异常。
 */
export function resolveSubjectCandidates(
  candidates: ReadonlyArray<{ raw: string; id?: string }>,
): {
  resolved: Array<{ key: string; raws: string[]; id?: string }>;
  ambiguous: Array<{ key: string; ids: string[]; raws: string[] }>;
} {
  const byKey = new Map<string, { raws: string[]; ids: string[] }>();
  for (const c of candidates) {
    const key = relativeKey(c.raw);
    if (!key) continue;
    const slot = byKey.get(key) ?? { raws: [], ids: [] };
    if (!slot.raws.includes(c.raw)) slot.raws.push(c.raw);
    if (typeof c.id === 'string' && c.id !== '' && !slot.ids.includes(c.id)) slot.ids.push(c.id);
    byKey.set(key, slot);
  }
  const resolved: Array<{ key: string; raws: string[]; id?: string }> = [];
  const ambiguous: Array<{ key: string; ids: string[]; raws: string[] }> = [];
  for (const key of [...byKey.keys()].sort()) {
    const slot = byKey.get(key) ?? { raws: [], ids: [] };
    const raws = [...slot.raws].sort();
    const ids = [...slot.ids].sort();
    if (ids.length > 1) ambiguous.push({ key, ids, raws });
    else resolved.push(ids.length === 1 ? { key, raws, id: ids[0] } : { key, raws });
  }
  return { resolved, ambiguous };
}

/** 范围相容：两侧都声明时必须相交；两侧都未声明视为"同一未声明范围"；一空一有 ⇒ 不可比。 */
export function scopeCompatible(a: readonly string[], b: readonly string[]): boolean {
  const left = (a ?? []).map(relativeKey).filter(Boolean);
  const right = (b ?? []).map(relativeKey).filter(Boolean);
  if (left.length === 0 && right.length === 0) return true;
  if (left.length === 0 || right.length === 0) return false;
  const hit = (x: string, y: string): boolean =>
    x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  return left.some((x) => right.some((y) => hit(x, y)));
}

/**
 * 冲突判定（DS-1R 重写）：**只在"当前有效且范围相容"的证据之间**判冲突。
 *
 * 不参与冲突的三类（它们是正常状态，不是异常）：
 * · 任一方的 `freshness !== 'fresh'`（旧证据是 `stale`，保留在自己状态里）；
 * · 范围不相容（先标范围不一致，不投票）；
 * · retired 对象上的历史 pass（对象退役后历史仍是历史，不回潮成当前冲突）。
 */
export function detectVerdictConflicts(
  signals: readonly EvidenceSignal[],
): Array<{ subject: string; left: string; right: string; reason: string }> {
  const bySubject = new Map<string, EvidenceSignal[]>();
  for (const s of signals) {
    if (s.freshness !== 'fresh') continue;
    const key = subjectKey(s.subject);
    const list = bySubject.get(key) ?? [];
    list.push(s);
    bySubject.set(key, list);
  }
  const out: Array<{ subject: string; left: string; right: string; reason: string }> = [];
  for (const key of [...bySubject.keys()].sort()) {
    const group = bySubject.get(key) ?? [];
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        if (a.id === b.id) continue;
        const passFail = (a.verdict === 'pass' && b.verdict === 'fail') || (a.verdict === 'fail' && b.verdict === 'pass');
        if (!passFail) continue;
        if (!scopeCompatible(a.scope, b.scope)) continue;
        out.push({
          subject: key,
          left: a.id,
          right: b.id,
          reason: `${a.source_ref} 说 ${a.verdict}，${b.source_ref} 说 ${b.verdict}（两边都是当前有效证据 ⇒ 两边都留，不投票）`,
        });
      }
    }
  }
  return out;
}

/** 快照条目 id → 精确对象身份（`test:tests/a.test.mjs` ⇒ `{kind:'test', path:'tests/a.test.mjs'}`）。 */
export function subjectOfEntryId(entryId: string): { kind: 'test' | 'contract' | 'other'; path?: string } {
  if (entryId.startsWith('test:')) return { kind: 'test', path: fileOfTestNodeId(entryId) ?? undefined };
  if (entryId.startsWith('contract:')) return { kind: 'contract' };
  return { kind: 'other' };
}

/**
 * ★ G4 单一 test 节点 id 构造：`test:` + 归一化仓库相对路径。
 * test / contract / Java 条目同源规则——写端只调本函数拼 id，不再各自手拼前缀字符串。
 * 归一化见 {@link relativeKey}（`\` → `/`、去 `./`、trim）；调用方负责传仓库相对路径。
 */
export function testNodeId(file: string): string {
  return `test:${relativeKey(file)}`;
}

/**
 * ★ G4 从 entry id 反解归一化 file；非 test 条目 ⇒ null。
 * 匹配侧按归一化 file 比对，不再对 id 做 `test:tests/` 前缀字符串切片。
 */
export function fileOfTestNodeId(entryId: string): string | null {
  if (!entryId.startsWith('test:')) return null;
  return relativeKey(entryId.slice('test:'.length));
}

/** 帧级形状判据：只有 `signals` 全部合格且必填段都在，才允许进策略层。 */
export function frameShapeError(frame: unknown): string | null {
  if (!frame || typeof frame !== 'object') return 'frame 不是对象';
  const f = frame as Record<string, unknown>;
  for (const k of ['project', 'goal', 'content', 'index', 'capability'] as const) {
    if (!f[k] || typeof f[k] !== 'object') return `缺 ${k}`;
  }
  for (const k of ['signals', 'gaps', 'conflicts', 'excluded', 'undetermined', 'limitations'] as const) {
    if (!Array.isArray(f[k])) return `${k} 不是数组`;
  }
  for (const s of f.signals as unknown[]) {
    const err = signalShapeError(s);
    if (err) return `signals 里有坏项：${err}`;
  }
  return null;
}
