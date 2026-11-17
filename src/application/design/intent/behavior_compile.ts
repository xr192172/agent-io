/**
 * behavior_compile —— `docs/PROJECT-DESIGN.md` §9.5.5 **第 1 条**（纯函数契约编译）的应用层：
 * 把一份 §9.5.2 的 `BehaviorContract` 编到**现有** `behavior-cases` 执行核上**真跑**，
 * 产出 `verdict` + 执行证据。
 *
 * ## 它**不**做什么（每条都有代价，别在别处偷偷加回来）
 * · **不新建测试体系**：结论由 `judgeExpectations`（`./expectations.js`，就是 `edit_dsl` 写进去的判据
 *   日常跑的那个执行核）给 —— 与决策卡上的 `behavior-cases` 走同一条路径、同一把比对尺
 *   （`src/domain/behavior_compare.ts#sameBehaviorRet`）。
 * · **不新建夹具**：第 5 步的最小夹具由 harness 自己建（仓库相对镜像 + 只拷**相对** import 闭包 +
 *   一条 `node_modules` junction，见 `src/infrastructure/authoring/behavior/index.ts#buildNodeFixture`）；
 *   本文件只**判定**它建不建得起来（依赖面零裸 import + 相对闭包可拷）。
 * · **不自动填 expect**：`cases` 为空、或 `expect` 非字符串 ⇒ 由 `planContractCompile` 在**交给核之前**
 *   挡成 `unsupported`。这是 §9.5.7 的永久边界：自动化消除的是测试的**机械写法**，不是独立语义预期。
 * · **不接入核销**：§9.5.5 **第 2 条**「接入计划与核销」——★ 2026-11-17（T-#N4）更正：它的**生成侧**
 *   已接线（`design_line action=compile`：把册上的 `behavior-cases` 适配成契约、走本文件八步真跑，
 *   `apply=true` 才经 `updateFeature` 落册）；**核销侧**仍由**既有**闸管（`src/application/write_gate.ts`：
 *   `complete` 必过 `isSatisfied` 且另需 `data.evidence`），本文件不重复实现 —— 所以本文件**不能**声称
 *   "闭环通了 / 已核销"，只能声称"**编译这一段通了**，核销由既有闸保证"。
 *
 * ## 分母纪律（判据③：不许把主体缺失的契约从分母里剔掉）
 * `input` 恒等于**入参条数**（一条都不剔）；`input === checked + skipped.length`；
 * 没拿到 `pass/fail` 的**全部具名**在 `skipped`（编译期挡下）或 `unverified`（进过核但没结论）里，带步号。
 */

import fs from 'node:fs';
import path from 'node:path';

import { contractPage } from '../../meta/explore/contract_page.js';
import { langOfFile } from '../../../infrastructure/authoring/behavior/index.js';
import { isCodeText, scanValueImports } from '../../../domain/text_strip.js';
import { assertValidExpectations, type Expectation } from '../../../domain/expectation.js';
import {
  attributeRunFailure,
  planContractCompile,
  stageName,
  type CompiledBehaviorCasesInput,
  type CompiledContractPlan,
  type ContractCapabilityFacts,
  type ContractSubjectFacts,
} from '../../../domain/behavior_contract.js';
import { judgeExpectations } from './expectations.js';

export interface BehaviorCompileOptions {
  /** 项目根（缺省 cwd）：主体反查与真跑都以它为锚 */
  project_dir?: string;
  /** 编译产物（现有 behavior-cases 输入）是否随结果回带；默认 true（判据 ④ 要能看见它长什么样） */
  include_expectation?: boolean;
}

/** 一条契约的编译结果（`verdict` 与执行核同一套词） */
export interface BehaviorCompileItem {
  contract_id: string;
  verdict: 'pass' | 'fail' | 'unsupported';
  /** 失败/判不了的**步名**（`pass` 时 null；`fail` 也 null —— 行为错不落在任何"编译步"上） */
  stage: string | null;
  stage_no: number | null;
  detail: string;
  expectation?: CompiledBehaviorCasesInput;
}

/** 一条**具名**的没拿到结论（跳过 / 进核但没结论都用它，`ran` 区分） */
export interface BehaviorCompileGap {
  contract_id: string;
  /** 是否进过执行核（false = 编译期就挡下了） */
  ran: boolean;
  stage: string;
  stage_no: number;
  gap: string;
}

export interface BehaviorCompileReport {
  project_dir: string;
  items: BehaviorCompileItem[];
  /** ★ 分母 = **入参条数**（恒成立，一条都不剔） */
  input: number;
  /** 进过执行核的条数（= pass + fail + unverified 全部） */
  checked: number;
  pass: number;
  fail: number;
  unsupported: number;
  /** ★ 编译期就挡下、**没进核**的（具名，带步号）—— `input === checked + skipped.length` */
  skipped: BehaviorCompileGap[];
  /** ★ 进了核但**没拿到 pass/fail** 的（具名，带步号）—— `checked === pass + fail + unverified.length` */
  unverified: BehaviorCompileGap[];
  note: string;
}

/** 契约主体反查（**只按 symbol 反查**，file 由 DB 给 —— 这才叫"自动得到 file/symbol"） */
async function subjectFactsOf(root: string, symbol: string): Promise<ContractSubjectFacts> {
  if (!symbol) return { resolution: 'not-found', note: '契约没给 subject.symbol ⇒ 无从反查（第 1 步会先拒它）' };
  try {
    const page = await contractPage({ symbol, project_dir: root });
    const def = page.definition;
    if (page.resolution === 'ok' && def) return { resolution: 'ok', file: def.file, signature: def.signature };
    if (page.resolution === 'ambiguous') {
      return {
        resolution: 'ambiguous',
        candidates: (page.candidates ?? []).map((c) => ({ file: c.file, line: c.line })),
      };
    }
    if (page.resolution === 'index-unavailable') {
      return { resolution: 'index-unavailable', note: page.resolution_note };
    }
    return { resolution: 'not-found', note: page.resolution_note };
  } catch (e) {
    // ★ 反查抛错 ⇒ "索引不可用"这一态（不是"符号不存在"）—— 两件事的处置完全不同
    return { resolution: 'index-unavailable', note: `主体反查抛错：${(e as Error).message}` };
  }
}

/**
 * 能力事实（第 3/5 步的输入）。
 *
 * ★ 两条**不许乐观**的口径：
 *  · `toolchain_ok` 只对 **node 家族**断言 true —— harness 的子进程就是本次跑编译的这个 node
 *    （`process.execPath`，恒可用）；**其他语言这里不探工具链**（探它要起子进程），
 *    给 `undefined` ⇒ 第 3 步判不了 ⇒ `unsupported`。缺事实**不许**写成"能跑"。
 *  · `bare_count` 读不到源码时给 `undefined`（不是 0）：缺事实 ≠ 零依赖。
 */
function capabilityFactsOf(root: string, file: string): ContractCapabilityFacts {
  if (!file) return {};
  let lang = '';
  let why = '';
  try {
    lang = langOfFile(file);
  } catch (e) {
    why = String((e as Error).message).split('\n')[0] ?? '';
  }
  let src: string | null = null;
  try {
    src = fs.readFileSync(path.join(root, file), 'utf-8');
  } catch {
    src = null;
  }
  const scan = src !== null && isCodeText(file) ? scanValueImports(src) : null;
  const isNode = lang === 'node';
  return {
    lang,
    toolchain_ok: isNode ? true : undefined,
    toolchain_reason: isNode
      ? undefined
      : why ||
        `本编译器目前只对 node 家族断言「能独立执行」；${lang || '该语言'} 的工具链**未探测**（未探测 ≠ 可用）`,
    bare_count: scan ? scan.bareCount : undefined,
    bare: scan ? scan.bare : undefined,
    relative_count: scan ? scan.relativeCount : undefined,
    builtin_count: scan ? scan.builtinCount : undefined,
    // 第 5 步：#buildNodeFixture 只拷**相对** import 闭包 + 一条 node_modules junction
    // ⇒ 零裸 import 时建得起来；有裸 import 时第 3 步已经挡了，这里保持一致口径。
    fixture_ok: scan && isNode ? scan.bareCount === 0 : undefined,
    fixture_reason: scan
      ? `相对 import 闭包由夹具按镜像路径递归拷入（${scan.relativeCount} 处）；真三方包 ${scan.bareCount} 处带不过去`
      : '读不到源码 / 不是代码文本 ⇒ 判不了夹具',
  };
}

/** 取该步的第一条缺口（报文要能定位，不能只说"有缺口"） */
function firstGapOf(plan: CompiledContractPlan, no: number): string {
  const s = plan.stages[no - 1];
  const g = s && s.gaps.length ? s.gaps[0] : '（该步没有给出具体缺口）';
  return g;
}

/**
 * 批量编译 + 真跑。
 *
 * 每条契约的流水线（§9.5.3 八步；第 1/2/3/4/5/6 步由 `planContractCompile` 判，第 7 步由核判）：
 * 取主体事实 → 取能力事实 → 八步判定 → 产物过现有形状规则 → 交 `judgeExpectations` 真跑 → 归因。
 */
export async function compileBehaviorContracts(
  contracts: readonly unknown[],
  opts: BehaviorCompileOptions = {},
): Promise<BehaviorCompileReport> {
  const root = path.resolve(opts.project_dir ?? process.cwd());
  const include = opts.include_expectation !== false;
  const items: BehaviorCompileItem[] = [];
  const skipped: BehaviorCompileGap[] = [];
  const unverified: BehaviorCompileGap[] = [];

  for (const raw of contracts) {
    const c = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = typeof c.id === 'string' && c.id.trim() ? c.id : '(缺 id)';
    const subject = (c.subject !== null && typeof c.subject === 'object' ? c.subject : {}) as Record<string, unknown>;
    const symbol = typeof subject.symbol === 'string' ? subject.symbol : '';

    const sf = await subjectFactsOf(root, symbol);
    const capability = capabilityFactsOf(root, sf.file ?? '');
    const plan = planContractCompile(c, { subject: sf, capability });

    // ── 第 1..6 步：编译期挡下（★ 一条都不剔分母，逐条具名进 skipped）──
    if (plan.verdict !== 'ready' || !plan.expectation) {
      const no = plan.failed_stage_no ?? 1;
      const stage = plan.failed_stage ?? stageName(no);
      const gap = firstGapOf(plan, no);
      items.push({
        contract_id: id,
        verdict: 'unsupported',
        stage,
        stage_no: no,
        detail: `第 ${no} 步失败 · ${stage}：${gap}`,
      });
      skipped.push({ contract_id: id, ran: false, stage, stage_no: no, gap });
      continue;
    }
    const expectation = plan.expectation;

    // ── 第 6 步自检：产物必须是**现有**写路径认的形状（不认 ⇒ 它就不是现有 behavior-cases 输入）──
    try {
      assertValidExpectations([expectation as unknown as Expectation], {
        readSource: (rel: string) => {
          try {
            return fs.readFileSync(path.join(root, rel), 'utf-8');
          } catch {
            return null;
          }
        },
      });
    } catch (e) {
      const stage = stageName(6);
      const gap = `产物没过现有写路径的形状校验：${(e as Error).message.split('\n')[0]}`;
      items.push({ contract_id: id, verdict: 'unsupported', stage, stage_no: 6, detail: `第 6 步失败 · ${stage}：${gap}` });
      skipped.push({ contract_id: id, ran: false, stage, stage_no: 6, gap });
      continue;
    }

    // ── 第 7 步：交**现有**执行核真跑（不另造 runner）──
    let judgedDetail = '';
    let judgedVerdict = 'unsupported' as 'pass' | 'fail' | 'unsupported' | 'pending';
    try {
      const rep = await judgeExpectations(root, [
        { node_id: id, node_label: `${expectation.path}#${expectation.symbol}`, expectation: expectation as unknown as Expectation },
      ]);
      const one = rep.items[0];
      if (one) {
        judgedVerdict = one.verdict;
        judgedDetail = one.detail;
      } else {
        judgedDetail = '执行核没有返回这一条结论（报告不完整）';
      }
    } catch (e) {
      judgedDetail = `执行核抛错：${(e as Error).message}`;
    }

    if (judgedVerdict === 'pass' || judgedVerdict === 'fail') {
      items.push({
        contract_id: id,
        verdict: judgedVerdict,
        stage: null,
        stage_no: null,
        detail: judgedDetail,
        ...(include ? { expectation } : {}),
      });
      continue;
    }

    // ── 跑不成 ⇒ **归因到某一步**（反向三：不许只说"判不了"）──
    const attr = attributeRunFailure(judgedDetail);
    const detail = `第 ${attr.stage_no} 步失败 · ${attr.stage}：${attr.why}\n执行核的话：${judgedDetail}`;
    items.push({
      contract_id: id,
      verdict: 'unsupported',
      stage: attr.stage,
      stage_no: attr.stage_no,
      detail,
      ...(include ? { expectation } : {}),
    });
    unverified.push({ contract_id: id, ran: true, stage: attr.stage, stage_no: attr.stage_no, gap: attr.why });
  }

  const pass = items.filter((x) => x.verdict === 'pass').length;
  const fail = items.filter((x) => x.verdict === 'fail').length;
  const unsupported = items.filter((x) => x.verdict === 'unsupported').length;
  const checked = pass + fail + unverified.length;

  return {
    project_dir: root,
    items,
    input: contracts.length,
    checked,
    pass,
    fail,
    unsupported,
    skipped,
    unverified,
    note:
      `验了 ${contracts.length} 条契约：pass ${pass} / fail ${fail} / unsupported ${unsupported}` +
      `（其中没进核 ${skipped.length} 条、进核但没结论 ${unverified.length} 条，均**具名**在 skipped[] / unverified[] 里）` +
      ` · 分母 = 入参数 ${contracts.length}，**一条都不剔**`,
  };
}
