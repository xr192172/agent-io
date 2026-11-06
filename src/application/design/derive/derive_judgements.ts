/**
 * 零件契约 → 判据的**机械展开**（★ 框架承担复杂度，模型只填契约槽位）。
 *
 * ## 为什么要有这个文件（用户 2026-11-06 定下的终极目标）
 * > 「这个工具最后的终极目标就是**对任何一个软件进行重写或者说增加功能**：直接定位到它可以接入的地方，
 * >  然后在**设计上面对它进行重排**……设计层面我们拥有足够的判据去告诉他应该怎么改。」
 * > 「你要像一个**设计游戏的流程**一样，让模型用起来也很顺手，**那些计算都隐于幕后**，
 * >  模型只需要做表面上的东西。它只需要**像拼图那样拼过去**，设定好细节，**只设定参数，不需要自己从头编撰参数**。」
 *
 * ## 它接在哪条链上（这条链三处断过两处）
 * ```
 * BrickContract（src/domain/contract.ts:67，零件契约，已定义但 936/936 文件都是空的）
 *    ↓ ① 写入口      —— 本文件不负责（file_ops 尚不认 contract 键，另卡）
 *    ↓ ② ★ 本文件   —— 契约 → 判据（机械展开，零人工想例子）
 * Expectation[]
 *    ↓ ③ 判准不准    —— scripts/mutate.mjs 已有：把实现改坏 ⇒ 判据必须红
 * ```
 *
 * ## 设计上的三条硬纪律
 * 1. **不凭空造**：契约没宣告的东西**不派生**任何判据。造假据比没判据更坏 —— 它让"覆盖率"看起来上去了。
 * 2. **纯函数 + 幂等**：同一个契约派生两次必须逐字相同，否则「派生」这个词不成立。
 * 3. **返回短值**：`behavior-cases` 的 `expect` 是**返回值的 JSON 字符串**（要逐字推），
 *    所以判定函数一律返回**短字面量**（如 `'deny' | 'allow'`），而不是长对象 ——
 *    否则判据本身就变成"要模型手推"的东西，与终局目标相反。
 */
import type { BrickContract } from '../../../domain/contract.js';

/** 派生出来的判据（形状 = DSL 的 Expectation；这里只约束必需三格，其余原样透传） */
export interface DerivedExpectation {
  kind: string;
  why: string;
  [key: string]: unknown;
}

/**
 * 「这个零件该不该被禁止写盘」的三态判定 —— ★ 本文件的核心。
 *
 * - `'deny'`       契约**明确宣告** `effects.writes` 为空数组 ⇒ 它是纯零件 ⇒ 必须派生「不许写盘」
 * - `'allow'`      契约宣告了写的目标 ⇒ 它本来就该写盘 ⇒ **不派生**那条
 * - `'unspecified'` 契约没填 / 形状不对 ⇒ **不派生**（★ 不凭空造：没宣告 ≠ 不许）
 *
 * ★ 为什么 `[]` 和 `undefined` 必须分开：`[]` 是**一个断言**（"它不写盘"），
 *   `undefined` 是**没说话**。把没说话当成"不许"，就是凭空造判据。
 */
export type WriteDenial = 'deny' | 'allow' | 'unspecified';

/** 判为"写盘调用"的源码特征（用于生成否定式判据的 expect 源码） */
export const WRITE_CALL_PATTERN =
  '/(?:writeFileSync|writeFile|appendFile|appendFileSync|createWriteStream|mkdirSync|mkdir|rmSync|rmdirSync|unlinkSync|unlink|renameSync|copyFileSync|openSync)/';

/**
 * 契约 → 「该不该禁止写盘」的三态。
 *
 * @param contract 零件契约（`BrickContract`；可能是 `undefined` —— 那正是"没说话"）
 */
export function writeDenialOf(contract: BrickContract | undefined | null): WriteDenial {
  const writes = contract?.effects?.writes;
  // ★ 没填 / 形状不对 ⇒ 没说话（不派生），不是"不许"
  if (!Array.isArray(writes)) return 'unspecified';
  return writes.length === 0 ? 'deny' : 'allow';
}

/**
 * 契约 → 判据数组（机械展开；契约里有什么就派生什么）。
 *
 * 今天能机械展开的三面（对应侦察席给的「零件契约四个可判面」）：
 * - `effects.writes` 为空        ⇒ **否定式**判据「不许写盘」（run）
 * - `effects.reads_config` 非空  ⇒ 它宣称读这些 key ⇒ 源码里必须出现（source-has）
 * - `shapes.exposes` 非空        ⇒ 它宣称暴露这些形状 ⇒ 必须有对应签名（signature-matches）
 *
 * ★ 其余面（接线 / 组装 / 方向）**故意不在这里派生** —— 它们记在**边**上，
 *   不记在节点上（侦察席指出的根因：当节点属性写 ⇒ 两端要么重复写、要么都指望对方 ⇒ 谁都没写）。
 *
 * @param contract 零件契约
 * @param path     仓库相对路径（写进判据的 `path` 格）
 */
export function deriveJudgements(
  contract: BrickContract | undefined | null,
  path: string,
): DerivedExpectation[] {
  const out: DerivedExpectation[] = [];

  // ① 否定式：writes 为空 ⇒ 不许写盘
  if (writeDenialOf(contract) === 'deny') {
    out.push({
      kind: 'run',
      expect:
        `(() => { const s = fs.readFileSync(path.join(root, ${JSON.stringify(path)}), 'utf8'); ` +
        `return !${WRITE_CALL_PATTERN}.test(s); })()`,
      why:
        `不许写盘 —— 契约 effects.writes 为空数组（宣告了"它是纯零件"）⇒ 源码里不许出现任何写盘调用。` +
        `★ 改法：要么去掉写盘调用，要么在契约的 effects.writes 里如实声明它写什么（宣告就不拦）。`,
    });
  }

  // ② 配置读取：reads_config 非空 ⇒ 源码里必须出现这些 key
  const reads = contract?.effects?.reads_config;
  if (Array.isArray(reads) && reads.length > 0) {
    out.push({
      kind: 'source-has',
      path,
      must: reads.map((k) => String(k)),
      why:
        `契约 effects.reads_config 宣告它读这些配置项（${reads.join(' / ')}）⇒ 源码里必须真的出现；` +
        `少一个就是"契约说了但没做到"。`,
    });
  }

  // ③ 暴露的形状：**暂不派生** —— `ShapeSchema` 里没有 `signature` 这个字段（我猜错了，tsc 当场红）。
  //   ★ 这条边界是实测逼出来的：**不猜字段名**。要把它接回来，先读 `src/domain/contract.ts` 里
  //     `ShapeSchema` 到底有哪些格，再决定「形状」能机械展成哪种判据。

  return out;
}
