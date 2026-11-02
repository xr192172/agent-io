/**
 * registry/plumbing.ts —— 工具 handler 的统一包装
 *
 * ★ P1a（2026-09-28）：从 `server_registry.ts`（3,586 行）抽出的**基础设施**。
 *   textOut / wrap / wrapData 三个包装器 + looseInputSchema（未知键保留，供参数纠错）。
 *
 * 为什么必须先抽这一层（而不是直接按 lane 切 TOOL_DEFS）：
 *   lane 文件要用到这里的东西，而它们原先都定义在 `server_registry.ts` 内部 ⇒
 *   lane 一 import 就成环（server_registry → lanes → server_registry）。
 *   拆出本模块后，lane 文件可以单向依赖它。
 */
import { z } from 'zod';
import { gateErrorsOf, gateRuleByMessage } from '../domain/gate_error.js';
import type { ToolDef } from './types.js';

/** MCP content 输出 */
export function textOut(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

/**
 * 合成**受控操作契约**（tool input contract，内部标记 `[B]`）产物的**机器可读载荷**（含 `touched` 小票）。
 *
 * ★★ 为什么两个包装器都必须走这里（2026-10-05，**实测的真缺陷**，不是风格问题）：
 *   `Touched`（"本次动了什么"）是**跨受控操作契约的统一契约**（`domain/b_terms.ts`），但它挂在受控操作契约产物的**顶层**；
 *   而 `wrap` 只回 `message`、`wrapData` 只序列化 `r.data` ⇒ 产物顶层的 `touched` 会在 **[C] 层静默丢掉**。
 *   **实测**：`detect_drift` / `edit_dsl` 用裸 `wrap` ⇒ 子代理刚给它们的受控操作契约接上的 `touched`
 *   **压根没出现在输出里**（同一批里用 `wrapData` + `data: r` 的工具则正常）。
 *   ⇒ 处置：**在两个出口处统一合成**（结构保证）——**不是**"要求每个 handler 记得 `data: r`"（那是自觉）。
 *
 * 规则（可预测、不改既有形状）：
 *   - 无 `data` 且无 `touched` ⇒ `undefined`（包装器退回"只回 message"，`wrap` 语义不变）。
 *   - 有 `data`、无 `touched` ⇒ **原样返回 `r.data`**（既有 DATA 形状逐字不变）。
 *   - 有 `touched` + `data` 是**普通对象** ⇒ `{...data, touched}`（**加法**，不动既有键）。
 *   - 有 `touched` + 其它（`data` 为数组/标量/缺失）⇒ `{data, touched}`（`JSON.stringify` 会丢掉
 *     值为 `undefined` 的键 ⇒ 于是自然退化成 `{"touched":…}`）。
 */
function machinePayload(r: { data?: unknown; touched?: unknown }): unknown {
  const hasTouched = r.touched !== undefined;
  if (r.data === undefined) return hasTouched ? { touched: r.touched } : undefined;
  if (!hasTouched) return r.data;
  const isPlainObject = typeof r.data === 'object' && r.data !== null && !Array.isArray(r.data);
  return isPlainObject
    ? { ...(r.data as Record<string, unknown>), touched: r.touched }
    : { data: r.data, touched: r.touched };
}

/** 包装一个同步/异步纯函数调用为 handler（统一 try/catch；陈旧构建警告由 registerAllTools 统一注入，避免重复） */
export function wrap(
  fn: (args: Record<string, unknown>) => { message: string; data?: unknown } | Promise<{ message: string; data?: unknown }>,
): ToolDef['handler'] {
  return async (args) => {
    try {
      const r = await fn(args);
      // ★ 产物带 `touched` 时**必须**让它出现在机器通道里（否则契约在 [C] 层静默丢失，见 machinePayload 头注）。
      const payload = machinePayload(r as { data?: unknown; touched?: unknown });
      if (payload === undefined) return { text: r.message };
      return { text: [r.message, DATA_MARKER, JSON.stringify(payload)].join('\n') };
    } catch (e) {
      // ★★ 结构化通道（本卡）：拒绝时除人读文案外还要带码。
      //   取码只走 `gateErrorsOf`（唯一入口，绝不抛）；取不到码（今天的普通 Error）⇒
      //   **逐字回到旧行为**：text 只有 message、isError:true，一个字段都不多。
      //   handler 返回值只有 text / isError ⇒ 机器段只能走 text（沿用 `---DATA---` 约定，
      //   `parseDataBlock` 取标记后第一行即可 `JSON.parse`）。
      let errs = gateErrorsOf(e);
      // ★★ 反查兜底（本卡）：取不到结构化码时，把**散文**按码表的 `where.messageStartsWith` 反查回码
      //   —— 60 多个拒绝点仍是 `throw new Error(散文)`、一处都不改 ⇒ 这是「码表对得上话」的唯一通路。
      //   ★ 仍取不到（前缀并列 / 空串 / 一码都不命中）⇒ **逐字**回到旧行为（text 只有 message，无 DATA 段）。
      if (errs.length === 0) {
        const byMsg = gateRuleByMessage((e as Error)?.message ?? '');
        if (byMsg) errs = [byMsg];
      }
      if (errs.length === 0) return { text: (e as Error).message, isError: true };
      return { text: [(e as Error).message, DATA_MARKER, JSON.stringify({ errors: errs })].join('\n'), isError: true };
    }
  };
}

/** 同 wrap，但 data 一并序列化进文本（---DATA--- 分隔），避免只回显 message 导致静默丢数据 */
/**
 * ★★ 机器载荷段的**唯一**标记（2026-10-06 单点化）。
 *
 * ★ 为什么立它：这个字面量原先**硬编码在两处**（`wrap` 与 `wrapData`），而
 *   `presentation` 侧（`invokeTool`）也要靠它做"插在机器段**之前**"的注入 ——
 *   再不单点化就会出现**第三份**（本仓头号病根：判据分叉）。
 * ★ 解析约定（既有，别破坏）：`text.split('---DATA---')[1]` 的头一段即 JSON；
 *   ⇒ 任何新增的注入都**插在它之前**，**不要**追加到它之后（那会污染 `JSON.parse`）。
 */
export const DATA_MARKER = '---DATA---';

/**
 * ★★★ T251（2026-10-13）：**解析 `---DATA---` 机器段的唯一入口** —— 别在别处再写一份切法。
 *
 * ## 它测的是哪一格（★ 实测的现场，不是理论）
 * 旧约定 = `text.split('---DATA---')[1]` **整段**当 JSON ⇒ ★ 它默认"**JSON 之后没有别的东西**"。
 * 而**产品自己就违反了那条约定**：`invokeTool` 组装回执时是
 *   `withNext + argHints + emission.text + firstContactNote + trustNote + alertNote + emission.block`
 * ⇒ **机器段之后**永远可能追加：告警文本 / 信任附注 / 首触标注 / `---WARNINGS---` 机器块。
 * ★ 实测（`capability_map` 真调用）逐字长这样：
 * ```
 * ---DATA---
 * {"lanes":[…],"domains":0,…}                                   ← 行 1：JSON
 * ⚠️ NO_PROJECT_ROOT：本次调用未解析到项目根 ⇒ 未做索引保鲜…      ← 行 2：被追加的告警
 *    本次入参里既没有约定的根参数名…                              ← 行 3：告警的细节行
 * ```
 * ⇒ ★★ 任何"整段 parse"的消费方在**告警非空时必炸**（平时恰好为空 ⇒ **看不出来**）。
 * ★ 实测炸过一次：`certs/t184b-cert.mjs` 报 `Unexpected non-whitespace character after JSON at position 442345`。
 *
 * ## 口径 = 仓里**既有**约定的可执行化：**取标记之后的【第一行】**
 * ★★ 为什么"第一行"就够（★ 这是**结构保证**，不是巧合）：载荷由 `wrapData` 用
 *   **`JSON.stringify(payload)`** 产出 ⇒ ★ `stringify` **不会产出裸换行**
 *   （串内的 `\n` 会被转义成 `\\n`）⇒ 载荷**必然是一行**。
 * ⇒ ★ 所以我**没有**去写"括号配平"那套（★ 我第一版写了，然后**量了一下**才发现是多余的复杂度 ——
 *   实测回执里载荷就是单行 ⇒ 配平那一层是**为不存在的情况付的复杂度**）。
 *
 * ★ 找不到标记 / 第一行不是 JSON ⇒ 返回 **`null`**（★ **这里不抛**：要不要响亮由调用方按语义定）。
 * ★ 注：**不改线上格式**（不给 JSON 段加结束标记）—— 那会让所有既有"切标记"的消费方在**同一次改动里全炸**。
 */
export function parseDataBlock(text: string): unknown | null {
  const i = text.indexOf(DATA_MARKER);
  if (i < 0) return null;
  const firstLine = text
    .slice(i + DATA_MARKER.length)
    .trim()
    .split('\n')[0]
    .trim();
  if (!firstLine) return null;
  try {
    return JSON.parse(firstLine);
  } catch {
    return null;
  }
}

export function wrapData(
  fn: (
    args: Record<string, unknown>,
  ) =>
    | { message: string; data?: unknown; isError?: boolean }
    | Promise<{ message: string; data?: unknown; isError?: boolean }>,
): ToolDef['handler'] {
  return async (args) => {
    try {
      const r = await fn(args);
      const parts: string[] = [];
      if (r.message) parts.push(r.message);
      const payload = machinePayload(r as { data?: unknown; touched?: unknown });
      if (payload !== undefined) {
        parts.push(DATA_MARKER);
        parts.push(JSON.stringify(payload));
      }
      // ★ 2026-10-20：handler 可**显式**声明 `isError`（不声明 ⇒ 行为逐字不变）。
      //   唯一的用途：**被闸拦截**的写操作既要给标准信封（表头 + `---DATA---` 供脚本判读），
      //   又要非零退出码 —— 否则「没写成」与「做成了」在脚本里长得一样。
      //   ★ 不把「报表说世界不好」（`ok:false`）自动升成 isError：那条纪律（调用失败 ≠ 世界不好）没变。
      return { text: parts.join('\n'), ...(r.isError ? { isError: true } : {}) };
    } catch (e) {
      // ★★ 与 `wrap` **同源取码**（两处 catch 一个契约，取码只走 `gateErrorsOf`）：
      //   空 ⇒ 逐字回到旧行为；非空 ⇒ 只在 text 里多一段 `---DATA---` + `{errors:[…]}`。
      let errs = gateErrorsOf(e);
      // ★★ 反查兜底（本卡）：取不到结构化码时，把**散文**按码表的 `where.messageStartsWith` 反查回码
      //   —— 60 多个拒绝点仍是 `throw new Error(散文)`、一处都不改 ⇒ 这是「码表对得上话」的唯一通路。
      //   ★ 仍取不到（前缀并列 / 空串 / 一码都不命中）⇒ **逐字**回到旧行为（text 只有 message，无 DATA 段）。
      if (errs.length === 0) {
        const byMsg = gateRuleByMessage((e as Error)?.message ?? '');
        if (byMsg) errs = [byMsg];
      }
      if (errs.length === 0) return { text: (e as Error).message, isError: true };
      return { text: [(e as Error).message, DATA_MARKER, JSON.stringify({ errors: errs })].join('\n'), isError: true };
    }
  };
}

// ─────────────────────────────────────────────────────────────
// [C] 层入参守卫
// ─────────────────────────────────────────────────────────────

/**
 * 缺必填字符串 ⇒ **当场报错**（绝不把 `undefined` 拼进路径 —— 规划书 §16.4 P-D）。
 *
 * ★ 2026-09-29（面收敛第二批）从 `lanes/refactor.ts` 的**文件内私有**函数上提到本模块：
 *   `lanes/harvest.ts` 的新入口 `bricks` 也要用同一把守卫，留在原地就会长出**第二份副本**
 *   —— 那正是「同一意图只有一份实现」要消灭的东西。
 *   ★ 2026-10-07：原写「G4（`tests/single_source.test.ts` 同族副本棘轮）」—— **该棘轮已不存在**
 *     （2026-10-03 有意删除：免疫系统无法自我修正、维护无休止 ⇒ 不要重建）。别再引用它当兜底。
 *   ⇒ 上提到**跨 lane 共用的基础设施**（本文件与 `types.ts` / `handlers.ts` 同层）。
 *   ★ 未收编的第三份：`src/application/meta/explore/explore_code.ts` 里有一个同名私有实现 —— 它在受控操作契约层，
 *     不在本笔（只改 `src/registry/**`）的边界内，**登记但不改**（见 commit message「没验什么」）。
 */
export function requireStr(a: Record<string, unknown>, key: string): string {
  const v = a[key];
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`缺参数 "${key}"`);
  return v;
}

/**
 * 缺必填**数组**参数 ⇒ **当场报错**（同 `requireStr` 的 P-D 纪律，只是这里守的是"是数组"）。
 *
 * ★ 2026-10-05：与 `requireStr` 同一个洞的另一半 —— `rename_symbols` / `rename_files` /
 *   `harvest_closure` 等直接 `a.renames.map(...)` / `a.files.map(...)`，缺参时抛的是
 *   `Cannot read properties of undefined (reading 'map')`（Node 原始异常，用户看不懂）。
 *   `hint` 用来在报错里给出该字段的**形状**（例：`[{file, symbol, to}]`），比只报名字有用。
 */
export function requireArr(a: Record<string, unknown>, key: string, hint: string): unknown[] {
  const v = a[key];
  if (!Array.isArray(v)) throw new Error(`缺参数 "${key}"：${hint}`);
  return v;
}

/**
 * ★★★ **可选**数组参数：**给了就必须是数组**；没给 ⇒ `undefined`（由调用方 `?? []`）。
 *
 * ## 为什么必须是它（T188 修 M5 —— 一个**真洞**，不是洁癖）
 * `explore_code` 这类工具的入参是 **`z.record(z.string(), z.unknown())` 一个自由袋子**
 * ⇒ ★ **zod 对这些键什么都不校验**（`unknown`），于是过去写的是
 *   `(args['changed'] as string[]) ?? []` —— ★ `as` 是**编译期**的断言，**运行期一个字都不查**：
 *   传 `changed: "abc"`（字符串）⇒ 它**不是 null/undefined** ⇒ `?? []` 也不生效
 *   ⇒ 下游按数组去遍历它 ⇒ **按字符遍历**（静默的垃圾）。
 * ★ 而**同一个调用点**上 `project_dir` 走 `requireStr` ⇒ 形状错**当场抛** ——
 *   ★ **同一处两种纪律**（本仓 §2.3「不报错的错」的一个标准形态）。
 * ⇒ 判据：**形状错就抛，与 `requireStr` 同款**；★ 这是 `requireArr` 的**可选版**，住在一起。
 */
export function optionalArr(a: Record<string, unknown>, key: string, hint: string): unknown[] | undefined {
  const v = a[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    throw new Error(
      `参数 "${key}" 必须是**数组**（${hint}）—— 收到的是 ${v === null ? 'null' : typeof v}。` +
        '★ 没给就省略这个键，别传别的形状（字符串会被当成"按字符遍历的数组"）。',
    );
  }
  return v;
}

/**
 * ★★★ **可选**标量参数：**给了就必须是对的类型**；没给 ⇒ `undefined`。
 *
 * ## 为什么要有它（T191 —— 与 `optionalArr` 同一条命，另两个类型）
 * `explore_code` 这类"action 分发"工具的入参是 **`z.record(z.string(), z.unknown())` 一个自由袋子**
 * ⇒ ★ **zod 对它一个字都不校验**；而受控操作契约里过去写的是**宽松**取值：
 *   `typeof v === 'string' ? v : undefined` ⇒ ★ **形状错 = 静默当没给**（§2.3「不报错的错」）。
 * ★ 后果不是"少报一条"：`{ max_depth: "3" }`（字符串）会被**当成没给**、于是用默认值 ——
 *   而调用方**以为自己的要求生效了**（他看到的是一份"正常"的结果）。
 * ⇒ 判据：**形状错就抛**（与 `requireStr` 同款）；★ 住这里（`plumbing`）—— **别各文件自带一套**。
 *
 * @param hint 该字段的**形状**（如 `'number'` / `'boolean'`），进报错里，比只报名字有用
 */
export function optionalStr(a: Record<string, unknown>, key: string, hint = 'string'): string | undefined {
  const v = a[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error(shapeErr(key, hint, v));
  return v;
}

export function optionalNum(a: Record<string, unknown>, key: string, hint = 'number'): number | undefined {
  const v = a[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(shapeErr(key, hint, v));
  return v;
}

export function optionalBool(a: Record<string, unknown>, key: string, hint = 'boolean'): boolean | undefined {
  const v = a[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new Error(shapeErr(key, hint, v));
  return v;
}

/** 形状错时的**统一**报错文本（★ 一处生成 —— 别在三个助手里各写一份） */
function shapeErr(key: string, hint: string, v: unknown): string {
  const got = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  return `参数 "${key}" 形状不对：要 **${hint}**，收到 **${got}**。★ 没给就省略这个键（别传别的形状 —— 它会被静默当成"没给"）。`;
}

// ─────────────────────────────────────────────────────────────
// 输入 schema 包装
// ─────────────────────────────────────────────────────────────

/**
 * 输入 schema 用 **loose object**：保留未知键，好让参数纠错（Did you mean）能看见写错的键。
 *
 * 为什么必须这样：SDK 会把 raw shape 包成**严格 object**（zod 4 mini / zod 3），
 * 而严格 object 解析时**静默丢弃**未知键 —— 参数写错就变成"结果莫名其妙"，
 * 参数纠错代码永远看不到那个错键（实测：不改这里，提示不出现）。
 * zod v4 → `z.looseObject`；zod v3 → `.passthrough()` 回退。
 */
export function looseInputSchema(shape: Record<string, unknown>): unknown {
  const anyZ = z as unknown as { looseObject?: (s: Record<string, unknown>) => unknown };
  if (typeof anyZ.looseObject === 'function') return anyZ.looseObject(shape);
  return (z.object(shape as never) as unknown as { passthrough: () => unknown }).passthrough();
}


// ─────────────────────────────────────────────────────────────
// 跨工具保留入参（`actor` / `authorize`）
// ─────────────────────────────────────────────────────────────

/**
 * ★★★ 跨工具保留入参 `actor`（调用方身份）与 `authorize`（按 run 的授权范围）：**唯一住处**。
 *
 * ★ 为什么两个字段都住这里：44 个工具的 schema 由 `server_registry#withCallFields` 统一注入，
 *   而 refactor 线那 5 个写源码工具还要**显式展开**它 —— application 层不能 import presentation，
 *   所以定义必须住在两层都够得着的 application/plumbing。
 *
 * ★★ 这两段 describe **是有预算的**：`tools/list` 每个请求重付一遍，而它们被注入 ×44
 *   ⇒ 多 1 字节，线缆上多付 44 字节（实测：旧的 720 B + 503 B ×44 = 57,728 B，占整份 tools/list 的四分之一）。
 *   ⇒ 这里只写「够判对错的语义 + 指向唯一详解」，长文只许出现在 `CALL_FIELDS_SPEC` 一处。
 *
 * ## 不变量（改这两段 describe 时不许丢 —— 判据在 tests/budget/payload_budget.test.ts）
 * · `actor` 仍要答出：是什么（调用方身份 `<kind>:<name>`）、干什么用（A7 写闸判「这张卡是不是你领的」）、
 *   与谁对齐（claim 时的 `data.owner`）、完整规则在哪。
 * · `authorize` 仍要答出：按 run 的 scope 授权、只有写工具认、`'all'` 被拒、完整规则在哪。
 *
 * ★ 边界（别包装）：两者都是**自报** —— stdio 侧拿不到宿主可信身份 ⇒ 能买到的是协作防撞，不是防冒充。
 * ★ 文法唯一定义：身份 = `domain/actor_spec.ts`；scope = `domain/scope.ts`。
 */
export const CALL_ACTOR_FIELD = {
  actor: z
    .string()
    .optional()
    .describe(
      '调用方身份 `<kind>:<name>`（如 `subagent:a7`），= claim 时的 `data.owner`；' +
        'A7 写闸靠它判「这张卡是不是你领的」。文法 / 归一化 / 严格档见 `capability_map`。',
    ),
};

/** 按 run 的授权范围（scope 文法唯一定义在 `domain/scope.ts`）—— 与 `CALL_ACTOR_FIELD` 同一处声明。 */
export const CALL_AUTHORIZE_FIELD = {
  authorize: z
    .string()
    .optional()
    .describe(
      '按 run 的授权范围：一个 scope 授权一批文件（`files:src/x/`、`nodes:<id>`…），' +
        "判据 = 本批文件全在 scope 内 ∧ scope 里有你领的卡。只有写工具认；`'all'` 被拒。详见 `capability_map`。",
    ),
};

/** 保留键全集（参数纠错要把它们当"已知键"，否则 `actor`/`authorize` 会被当成拼错的参数）。 */
export const CALL_RESERVED_KEYS = [...Object.keys(CALL_ACTOR_FIELD), ...Object.keys(CALL_AUTHORIZE_FIELD)];

/** 任何工具的 schema → 同一个（含 `actor` / `authorize` 的）schema。★ 一处拼装，别在调用点各写一遍。 */
export const withCallFields = (shape: Record<string, unknown>): Record<string, unknown> => ({
  ...shape,
  ...CALL_ACTOR_FIELD,
  ...CALL_AUTHORIZE_FIELD,
});

/**
 * `actor` / `authorize` 的**完整说明**（唯一一份长文）—— 只有 `capability_map` 的 description 渲染它。
 * ★ 44 个工具的 schema 只给一句语义 + 指向本节；**别把这段复制回每个工具**（那正是 25% 浪费的来源）。
 */
export const CALL_FIELDS_SPEC =
  '\n★ **跨工具保留入参 `actor` / `authorize`**（每个工具的 schema 都带这两个键，描述只给一句语义，完整规则就在这里）：' +
  '① `actor` = 调用方身份，文法 `<kind>:<name>`：kind ∈ {human, agent, subagent}，name 只许小写字母/数字/-/_、长度 1..40，' +
  '例 `human:admin` / `agent:workbuddy` / `subagent:a7`（唯一定义 `domain/actor_spec.ts`）。' +
  '无前缀的老格式（`workbuddy`）**归一化为 `agent:workbuddy` 并在回执里明说**；含空格/中文/大写/超长的**直接拒**。' +
  '不传 ⇒ 落回 `AGENT_IO_ACTOR` ⇒ 都没有就「提醒 + 放行」（要改拒绝：`AGENT_IO_ACTOR_STRICT=1`）。' +
  'A7 写闸把它与 claim 时的 `data.owner` 比；只读工具用它给读集分桶。' +
  '② `authorize` = 按 run 的授权范围，文法 = `domain/scope.ts`（`files:` / `nodes:` / `subtree:` / `layer:` / ' +
  '`swimlane:` / `arch_layer:`），如 `files:src/application/refactor/`。放行判据 = 本批要写的文件**全部**落在该 scope 内 ∧ ' +
  '该 scope 的节点里有**你领的** claimed 卡（A7 不放宽）。`authorize:\'all\'` **明令拒绝**（等于关闸）；' +
  '解不出来的 scope **当场报错**，不静默降级；不传 ⇒ 落回逐文件判定。';
