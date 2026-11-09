/**
 * **验证器自证包**（Verifier Proof Pack，2026-11-09）
 *
 * ## 为什么需要
 * 改共享验证器（`verified_snapshot.ts` / `verify_project.ts` / `verify-changed.mjs`）时，
 * 旧证据可能整体失效。旧做法是"命中公共底座 ⇒ 无条件全跑 14 道门（≈14 分钟）"——
 * 于是每轮都在用全量证明验证器，把内环废掉。
 *
 * 正确做法：**验证器自己有判据**。这份包把"验证器必须成立的行为"钉成 8 个关注面，
 * 每个面指向**真实存在的测试文件 + 具体用例名**。改验证器时跑这份包：
 * · 全绿且覆盖没丢 ⇒ **不扩大**（继续按 impact 走增量）；
 * · 有红 / 覆盖不足 ⇒ 才扩大（全跑）。
 *
 * ## 两条诚实边界（写在结构里，不靠人记）
 * ① 覆盖检查是**廉检**：文件必须存在、声明的用例名必须真的出现在该文件里。
 *    它挡的是"用例被删/被改名而包还在"；它**不**证明用例跑得过 —— 那是 `run` 的活。
 * ② 这 8 个面**不是**"验证器已完备"的证明，只是"已知必须成立的最小集"。
 *    新发现的行为缺口要加进包里（面数会增），而不是靠某次全量绿去代替。
 */

/** 哪些文件属于"共享验证器"（改它们才触发自证包；其它公共底座仍无条件扩大） */
export const VERIFIER_FILES = [
  'src/application/design/verified_snapshot.ts',
  'src/application/verify/verify_project.ts',
  'scripts/verify-changed.mjs',
  // ★ 自证包自己也是验证器的一部分：改它同样需要自证（否则改包就自动扩大）
  'src/application/design/verifier_proof_pack.ts',
] as const;

export type ProofCase = {
  /** 测试文件（仓库相对路径） */
  file: string;
  /** 该文件里必须存在的用例名片段（廉检用；空 = 只要求文件在） */
  cases: string[];
};

export type ProofArea = {
  id: string;
  /** 关注面（人读） */
  area: string;
  /** 为什么这条面必须成立 */
  why: string;
  tests: ProofCase[];
};

export const VERIFIER_PROOF_PACK: ProofArea[] = [
  {
    id: 'impact',
    area: '受影响测试：观察面 ∩ 波及集合 ⇒ 重验；否则继承',
    why: '增量可信的全部前提就是这条交集判定；它错了，一切"跳过"都是假绿',
    tests: [
      { file: 'tests/p1_impact_selection.test.ts', cases: ['观察面 ∩ 波及集合', '无关改动不触发重验', '符号级观察也能命中', 'intersectsImpact 只看文件与符号'] },
      { file: 'tests/p1_incremental_positive.test.ts', cases: ['干净树 + 单文件变更'] },
    ],
  },
  {
    id: 'lifecycle',
    area: '生命周期六步：建账 → 继承 → 小改 → 改坏 → 修复 → 恢复',
    why: '这是"无需手工维护基线"的唯一端到端证据（含真跑、撤销、恢复）',
    tests: [{ file: 'tests/p1_verify_project_lifecycle.test.ts', cases: ['建账 → 无改动继承'] }],
  },
  {
    id: 'no-evidence',
    area: '无证据 / 无观察面：不继承、显式扩大、点名',
    why: '没有证据与没有问题长得一模一样；这两态必须分开且都不得报通过',
    tests: [
      { file: 'tests/p1_no_evidence.test.ts', cases: ['对象存在但证据为空', '证据都在但观察面全空', '真的没有对象', '真没改动 + 有效基线'] },
      { file: 'tests/p1_verified_snapshot.test.ts', cases: ['观察面为空 / 摘要缺失或算不出', '缺 observes', '真实观察面（自带或事实推导）'] },
    ],
  },
  {
    id: 'untrusted-changeset',
    area: '改动集不可信（读不到 / 伪造 / 漏漂移）⇒ 不得继承',
    why: '空交集不许当安全；改动集不完整等于不知道自己改了什么',
    tests: [
      { file: 'tests/p1_impact_selection.test.ts', cases: ['影响关系不可信', '改动集读不到', '伪造 changed=[]', '声明了改动集但漏了漂移文件', '真实无改动'] },
      { file: 'tests/p0_change_set_truth.test.ts', cases: ['改动集来源自报'] },
    ],
  },
  {
    id: 'depth-limits',
    area: '超深 / 超限：闭包没算到饱和就判 null ⇒ undetermined',
    why: '把截断当完整是"证明不了却看起来通过"的经典形态',
    tests: [{ file: 'tests/p1_verified_snapshot.test.ts', cases: ['max_symbols 越界', '依赖链超过 max_depth', '深度足够时链尾变了'] }],
  },
  {
    id: 'new-objects',
    area: '新对象（基线里没有的测试对象）⇒ 必须跑',
    why: '新出现的测试不跑就继承 = 凭空给分；首次建账也必须走这条路',
    tests: [
      { file: 'tests/p1_verify_project_lifecycle.test.ts', cases: ['建账'] },
      { file: 'tests/p1_no_evidence.test.ts', cases: ['基准取**运行器枚举**', '索引只看得到一部分'] },
    ],
  },
  {
    id: 'revoke-stale-pass',
    area: '失败撤销旧通过（旧 pass 不得留用）',
    why: '基线侵蚀：一次红之后仍留着上次的 pass，等于把失败洗成成功',
    tests: [
      { file: 'tests/p1_verify_project_lifecycle.test.ts', cases: ['改坏不推进'] },
      { file: 'tests/p1_incremental_positive.test.ts', cases: ['变更行为错误'] },
    ],
  },
  {
    id: 'restore-reverify',
    area: '恢复后重验（改回正确 ⇒ 允许通过，且证据重新记）',
    why: '撤销要能收回来；否则一次误红就永久失去该对象的证据面',
    tests: [
      { file: 'tests/p1_verify_project_lifecycle.test.ts', cases: ['修复恢复'] },
      { file: 'tests/p1_incremental_positive.test.ts', cases: ['恢复后允许通过'] },
    ],
  },
];

export type ProofCoverage = {
  ok: boolean;
  areas: number;
  /** 文件级：声明了但盘上没有 */
  missing_files: Array<{ area: string; file: string }>;
  /** 用例级：声明的用例名在该文件里找不到（多半被改名/删掉了） */
  missing_cases: Array<{ area: string; file: string; case: string }>;
};

/**
 * 覆盖廉检（只读盘，不执行）：文件在不在、用例名在不在。
 * ★ 它**不**证明用例跑得过 —— 那是 `runVerifierProofPack` 的活。
 */
export function proofPackCoverage(read: (rel: string) => string | null): ProofCoverage {
  const missing_files: ProofCoverage['missing_files'] = [];
  const missing_cases: ProofCoverage['missing_cases'] = [];
  for (const a of VERIFIER_PROOF_PACK) {
    for (const t of a.tests) {
      const src = read(t.file);
      if (src === null) {
        missing_files.push({ area: a.area, file: t.file });
        continue;
      }
      for (const c of t.cases) if (!src.includes(c)) missing_cases.push({ area: a.area, file: t.file, case: c });
    }
  }
  return { ok: missing_files.length === 0 && missing_cases.length === 0, areas: VERIFIER_PROOF_PACK.length, missing_files, missing_cases };
}

/** 本批改动是否只碰了"共享验证器"（其它公共底座不在这张名单里） */
export function splitVerifierChange(changed: readonly string[]): { verifier: string[]; others: string[] } {
  const set = new Set(VERIFIER_FILES as readonly string[]);
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const verifier: string[] = [];
  const others: string[] = [];
  for (const c of changed) (set.has(norm(c)) ? verifier : others).push(norm(c));
  return { verifier, others };
}

export type ProofRun = {
  ok: boolean;
  areas: number;
  files: number;
  failed_files: Array<{ file: string; code: number; tail: string }>;
  note: string;
};

/**
 * 跑自证包（按**去重后的测试文件**跑，不是按面跑）。
 * `runFile(rel)` 由调用方注入（复用仓里已有的跑测器），返回退出码与输出尾巴。
 */
export function runVerifierProofPack(runFile: (rel: string) => { code: number; out: string }): ProofRun {
  const files = [...new Set(VERIFIER_PROOF_PACK.flatMap((a) => a.tests.map((t) => t.file)))];
  const failed: ProofRun['failed_files'] = [];
  for (const f of files) {
    const r = runFile(f);
    if (r.code !== 0) failed.push({ file: f, code: r.code, tail: r.out.slice(-600) });
  }
  return {
    ok: failed.length === 0,
    areas: VERIFIER_PROOF_PACK.length,
    files: files.length,
    failed_files: failed,
    note:
      failed.length === 0
        ? `自证包 ${VERIFIER_PROOF_PACK.length} 个关注面 / ${files.length} 支测试全绿 ⇒ 验证器行为仍成立，**不扩大**`
        : `自证包有 ${failed.length} 支测试红 ⇒ 验证器可信度不足，**必须扩大**（全跑）`,
  };
}

/** 人读清单（`--proof-pack` 之类只需打印它） */
export function renderProofPack(): string[] {
  const lines = [`验证器自证包：${VERIFIER_PROOF_PACK.length} 个关注面`];
  for (const a of VERIFIER_PROOF_PACK) {
    lines.push(`  · [${a.id}] ${a.area}`);
    lines.push(`      why: ${a.why}`);
    for (const t of a.tests) lines.push(`      证据: ${t.file}${t.cases.length ? ' :: ' + t.cases.join(' / ') : ''}`);
  }
  return lines;
}
