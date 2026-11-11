/**
 * mybatis_contracts —— **Mapper↔XML 一致性契约**（第⑬项任务 A 调整形态 b 步）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ★★ **能力状态：实验性（experimental）—— 未接入产品面**（2026-11-12 审计 D4-1/D4-2 如实标注）
 *
 * 这不是"忘了接线"，是**当前没有入口**：域 `java-tools` 已登记（`structure.domains.json`），
 * 但本模块在产品代码里**零消费者**（唯一调用方是 `tests/p1_mybatis_consistency.test.ts`）。
 * 因此**不许**把它的输出当成卡片验收证据 —— 没有入口 = 没有卡能拿到它。
 *
 * 接线的两个候选（都还没做，做之前要单独立卡）：
 * ① MCP 工具面：新增一个 `mapper_consistency` 工具（要注册 schema + 进工具目录 + 判据）；
 * ② Java 卡的验收链：`edit_dsl` 卡 complete 时对 Java 项目自动跑（要给"没有 tools/MyBatisMapperDump.java
 *    就跳过"的降级口径 + 一条有鉴别力的判据）。
 * 二者都要求：**先证明打断本模块的产品入口会红**（否则接的是"永远不亮的灯"）。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 数据源：execJavaTool(MyBatisMapperDump) 的 JSON（官方 XMLMapperBuilder 语义解析 + 接口反射）。
 * 交叉（双向）：
 *   · 接口方法有而 XML id 无 ⇒ `xml-missing-statement`（mapper 调了但 XML 没写 ⇒ 运行时 BindingException）
 *   · XML id 有而接口方法无 ⇒ `xml-extra-statement`（XML 写了但接口没声明 ⇒ 死语句或动态 SQL）
 * 注入面：`dollarBrace > 0` ⇒ `dollar-injection`（定位到**具体语句 id**——与 source-has 的文件级红旗互补）。
 *
 * 降级：工具跑失败 / 接口类不在 classpath（`__CLASS_NOT_FOUND__`）⇒ 如实报，一致性判定跳过（不假装）。
 *
 * ★ 判定逻辑**只此一份**：`mapperConsistency` 就是判定核。它接受可注入的执行器（`deps.exec`，
 *   默认 `execJavaTool`）—— 单测因此可以**真调本函数**（喂假 dump JSON）而不是复写一遍交叉规则；
 *   复写版本曾存在（审计 D4-2：改坏本实现测试照样绿）。
 */
import path from 'node:path';
import { execJavaTool } from '../../infrastructure/java_tools/exec_java_tool.js';

export interface MapperConsistencyIssue {
  kind: 'xml-missing-statement' | 'xml-extra-statement' | 'dollar-injection';
  /** 语句 id 或接口方法名 */
  target: string;
  detail: string;
}

export interface MapperConsistencyResult {
  ok: boolean;
  /** 工具跑成功且接口侧可用（false = 降级，如实报） */
  interfaceSide: boolean;
  namespace: string;
  statements: Array<{ id: string; kind: string; dollarBrace: number; hashBrace: number }>;
  interfaces: string[];
  issues: MapperConsistencyIssue[];
  /** 工具自报的口径缺口（如 `<include refid>` 展开不了 ⇒ 那段 SQL 没计入统计）——**必须渲染出来** */
  warnings: string[];
  rendered: string;
}

/** `execJavaTool` 的**形状**（注入点：单测喂假 dump，生产用默认实现——判定核不因此分叉） */
export type JavaToolExec = (
  projectRoot: string,
  toolSrc: string,
  className: string,
  cp: readonly string[],
  toolArgs: readonly string[],
) => { ok: boolean; stdout: string; stderr: string };

/** MyBatisMapperDump.java 相对夹具根的位置 */
export const DUMP_TOOL_REL = 'tools/MyBatisMapperDump.java';
const DUMP_CLASS = 'tools.MyBatisMapperDump';

/** 单 mapper XML 的一致性判定（`deps.exec` 只替换"怎么跑工具"，交叉规则始终是下面这一份） */
export function mapperConsistency(
  projectRoot: string,
  mapperXmlRel: string,
  interfaceQn: string | null,
  deps: { exec?: JavaToolExec } = {},
): MapperConsistencyResult {
  const exec = deps.exec ?? execJavaTool;
  const toolSrc = path.join(projectRoot, DUMP_TOOL_REL);
  const xmlAbs = path.join(projectRoot, mapperXmlRel);
  const args = [xmlAbs, ...(interfaceQn ? [interfaceQn] : [])];
  const r = exec(projectRoot, toolSrc, DUMP_CLASS, [path.join(projectRoot, 'target', 'classes')], args);
  if (!r.ok) {
    const rendered = `\n── MyBatis 契约 ──\n  ⚠ 工具执行失败（一致性判定跳过）：${r.stderr.slice(0, 200)}`;
    return { ok: false, interfaceSide: false, namespace: '', statements: [], interfaces: [], issues: [], warnings: [], rendered };
  }
  let dump: { namespace: string; statements: Array<{ id: string; kind: string; dollarBrace: number; hashBrace: number }>; interfaces: string[] };
  try {
    const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{'))[0] ?? '{}';
    dump = JSON.parse(line);
  } catch (e) {
    const rendered = `\n── MyBatis 契约 ──\n  ⚠ 工具输出不是 JSON：${String((e as Error).message).slice(0, 150)}`;
    return { ok: false, interfaceSide: false, namespace: '', statements: [], interfaces: [], issues: [], warnings: [], rendered };
  }
  // ★ 2026-11-12（审计 D4-2 重写测试时实测抓到的崩溃）：**形状校验**必须在这里做。
  //   原实现直接 `dump.interfaces.includes(...)` ⇒ 工具打印了合法 JSON 但形状不对（如 `{}`）时
  //   抛 `Cannot read properties of undefined` —— 那是**崩溃**，不是"降级"。
  //   形状不合约等于"拿不到 dump" ⇒ ok=false、issues 空、如实说明（绝不当判过）。
  const shapeOk =
    !!dump &&
    typeof dump === 'object' &&
    Array.isArray((dump as { statements?: unknown }).statements) &&
    Array.isArray((dump as { interfaces?: unknown }).interfaces) &&
    typeof (dump as { namespace?: unknown }).namespace === 'string';
  if (!shapeOk) {
    const rendered = `\n── MyBatis 契约 ──\n  ⚠ 工具输出的 JSON 形状不对（要 {namespace:string, statements:[], interfaces:[]}）：${String(r.stdout)
      .slice(0, 200)
      .replace(/\s+/g, ' ')}`;
    return { ok: false, interfaceSide: false, namespace: '', statements: [], interfaces: [], issues: [], warnings: [], rendered };
  }

  const issues: MapperConsistencyIssue[] = [];
  const classNotFound = dump.interfaces.includes('__CLASS_NOT_FOUND__');
  const interfaces = dump.interfaces.filter((i) => i !== '__CLASS_NOT_FOUND__');
  const interfaceSide = !classNotFound && interfaces.length > 0;
  // ★ 工具自报的口径缺口（`<include refid>` 展开不了 ⇒ 那段 SQL 没计入注入面统计）：
  //   不渲染出来 = 少算的地方静默变绿 ⇒ 必须进 rendered。
  const warnings = Array.isArray((dump as unknown as { warnings?: unknown }).warnings)
    ? (dump as unknown as { warnings: string[] }).warnings
    : [];

  // 交叉（接口侧可用才做；否则降级——不假装）
  const ids = new Set(dump.statements.map((s) => s.id));
  if (interfaceSide) {
    for (const m of interfaces) {
      if (!ids.has(m)) issues.push({ kind: 'xml-missing-statement', target: m, detail: `接口方法 ${dump.namespace}.${m} 在 XML 里没有对应 id（运行时 BindingException）` });
    }
    for (const s of dump.statements) {
      if (!interfaces.includes(s.id)) issues.push({ kind: 'xml-extra-statement', target: s.id, detail: `XML id ${dump.namespace}.${s.id} 在接口里没有对应方法（死语句或动态 SQL——人工核）` });
    }
  }
  for (const s of dump.statements) {
    if (s.dollarBrace > 0) issues.push({ kind: 'dollar-injection', target: s.id, detail: `${dump.namespace}.${s.id} 有 ${s.dollarBrace} 处 \${}（SQL 注入面——参数化改 #{}）` });
  }

  const lines: string[] = [`\n── MyBatis 契约 ── ${mapperXmlRel}（namespace=${dump.namespace}）`];
  lines.push(`  语句 ${dump.statements.length} · 接口方法 ${interfaceSide ? interfaces.length : '（不可用）'}`);
  if (issues.length === 0) lines.push('  ✓ 一致性 ✓（无注入面）');
  for (const i of issues) lines.push(`  ✗ [${i.kind}] ${i.target} — ${i.detail}`);
  if (!interfaceSide) lines.push('  · 接口侧不可用（类不在 classpath）⇒ 一致性判定降级为仅注入面');
  for (const w of warnings) lines.push(`  ⚠ 口径缺口：${w}`);

  return { ok: true, interfaceSide, namespace: dump.namespace, statements: dump.statements, interfaces, issues, warnings, rendered: lines.join('\n') };
}
