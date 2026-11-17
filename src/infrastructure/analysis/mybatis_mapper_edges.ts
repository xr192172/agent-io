/**
 * MyBatis mapper_statement 边 + 索引期对账（card-mybatis）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ★ 消费者钉死 = **建边时立即对账**：本模块在 import_project 建图收尾处调用。
 *   建边与对账是同一次动作 ⇒ 边一落库就有读端（对账读数进 import 回执），
 *   不会出现"建了一条没人读的边 = 永远不亮的灯"。
 *
 * 边形状：edges(kind='mapper_statement', metadata=JSON)
 *   source = XML statement 节点 id（<xml文件rel>#<namespace>.<stmt id>）
 *   target = Java 接口同名方法节点 id（<java文件rel>#<接口FQN>.<method>）
 *   metadata = { namespace, statement_id, interface_fqn, method, parser }
 *
 * 对账（双向、不假装）：
 *   · XML statement 无同名 Java 方法 ⇒ xmlStatementUnmatched[]（warning，不建边）
 *   · Java mapper 方法无同名 XML statement ⇒ javaMethodUnmatched[]（warning）
 *   匹配上的才建边。namespace 找不到接口 ⇒ 整张 mapper 记 unmatched（如实报）。
 *
 * 打断即红：砍本模块的调用 ⇒ 边消失 + 对账读数消失；造"接口方法与 XML id 不匹配"
 *   反例 ⇒ unmatched 非空 ⇒ 判据红。
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Database } from '../index/db.js';

export interface MapperReconcileResult {
  /** 建成的 mapper_statement 边数 */
  edges: number;
  /** 参与对账的 mapper XML 数（有 namespace 的） */
  mappers: number;
  /** XML statement 找不到同名 Java 方法 */
  xmlStatementUnmatched: string[];
  /** Java mapper 方法找不到同名 XML statement */
  javaMethodUnmatched: string[];
  /** namespace 找不到对应 Java 接口 */
  interfaceNotFound: string[];
  /** namespace 简单名撞了多个 Java 接口（不同包同名）—— 不假装精确 */
  interfaceAmbiguous: string[];
  /** 解析口径（降级/原生）—— 如实地带进回执 */
  parsers: string[];
}

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  signature: string | null;
  parent: string | null;
}

/**
 * 对账 + 建边。幂等：先删旧的 mapper_statement 边再按当前索引重建（与 symbols.ts 的 call/import 边同款）。
 */
export function reconcileMapperStatements(db: Database): MapperReconcileResult {
  const result: MapperReconcileResult = {
    edges: 0, mappers: 0, xmlStatementUnmatched: [], javaMethodUnmatched: [], interfaceNotFound: [], interfaceAmbiguous: [], parsers: [],
  };
  // 1. 找出所有 mapper XML 的 namespace（type 节点：name=FQN，file_path 以 .xml 结尾）
  const allNodes = db.prepare("SELECT id, kind, name, qualified_name, file_path, signature, parent FROM nodes WHERE file_path LIKE '%.xml' OR file_path LIKE '%.java'").all() as unknown as NodeRow[];
  const isFallback = (s: string | null) => !!s && s.includes('[ts-fallback]');

  // XML namespace 节点：kind=type 且 signature 含 'namespace'（降级）或 name 含点（原生 create_statement 兜底不造这个，故主要是降级）
  const nsNodes = allNodes.filter(
    (n) => n.file_path.endsWith('.xml') && n.kind === 'type' && (n.signature?.includes('namespace') || n.name.includes('.')),
  );
  // statement 节点：xml 文件里的 method（降级提取的 select/insert/update/delete）
  const stmtNodes = allNodes.filter((n) => n.file_path.endsWith('.xml') && n.kind === 'method');

  // Java 接口声明（name 结尾 Mapper 的 interface/type）—— namespace 通过 FQN 或简单名桥接过去。
  // ★ tree-sitter-java 不把 package 拼进 qualified_name（实测节点 qn='UserMapper.findById'），
  //   而 MyBatis namespace 是 FQN（'com.x.UserMapper'）⇒ 用最后一段简单名匹配（诚实：可能同名撞包，
  //   撞了就记 interfaceAmbiguous warning，不假装精确）。
  const javaIfaces = allNodes.filter(
    (n) => n.file_path.endsWith('.java') && (n.kind === 'interface' || n.kind === 'type') && /Mapper$/.test(n.name),
  );
  const ifaceBySimple = new Map<string, NodeRow[]>();
  for (const iface of javaIfaces) {
    const arr = ifaceBySimple.get(iface.name) ?? [];
    arr.push(iface);
    ifaceBySimple.set(iface.name, arr);
  }

  // Java 方法节点：key = <接口简单名>#<方法名>（parent 就是接口简单名）
  const javaMethods = new Map<string, NodeRow[]>();
  for (const n of allNodes) {
    if (!n.file_path.endsWith('.java') || n.kind !== 'method') continue;
    const owner = n.parent ?? n.qualified_name.slice(0, n.qualified_name.lastIndexOf('.'));
    const key = `${owner}#${n.name}`;
    const arr = javaMethods.get(key) ?? [];
    arr.push(n);
    javaMethods.set(key, arr);
  }

  // 清理旧边（幂等）
  db.prepare("DELETE FROM edges WHERE kind = 'mapper_statement'").run();
  const insEdge = db.prepare(
    "INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, 'mapper_statement', $ln, NULL, $md)",
  );
  const matchedJavaKeys = new Set<string>();

  for (const ns of nsNodes) {
    result.mappers++;
    const fqn = ns.name; // namespace = mapper 接口 FQN
    const simple = fqn.split('.').pop() ?? fqn; // 末段简单名 = Java 接口名
    const parser = isFallback(ns.signature) ? 'ts-fallback' : 'tree-sitter';
    if (!result.parsers.includes(parser)) result.parsers.push(parser);

    // 这条 namespace 下的 statement（parent = fqn）
    const stmts = stmtNodes.filter((s) => s.parent === fqn || s.qualified_name.startsWith(`${fqn}.`));
    if (stmts.length === 0) continue;

    const ifaces = ifaceBySimple.get(simple) ?? [];
    if (ifaces.length === 0) {
      result.interfaceNotFound.push(fqn);
      for (const s of stmts) result.xmlStatementUnmatched.push(`${fqn}.${s.name}`);
      continue;
    }
    if (ifaces.length > 1) result.interfaceAmbiguous.push(`${fqn} → ${ifaces.length} 个同名接口（按简单名对账，不保证唯一）`);
    const iface = ifaces[0];
    const owner = iface.name;
    const ifaceFqn = iface.qualified_name.includes('.') ? iface.qualified_name : fqn;

    for (const s of stmts) {
      const key = `${owner}#${s.name}`;
      const targets = javaMethods.get(key);
      if (!targets || targets.length === 0) {
        result.xmlStatementUnmatched.push(`${fqn}.${s.name}`);
        continue;
      }
      const target = targets[0];
      const metadata = JSON.stringify({
        namespace: fqn,
        statement_id: s.name,
        interface_fqn: ifaceFqn,
        method: s.name,
        parser,
      });
      insEdge.run({ src: s.id, tgt: target.id, ln: 0, md: metadata });
      result.edges++;
      matchedJavaKeys.add(`${ifaceFqn}#${s.name}`);
      matchedJavaKeys.add(`${key}`);
    }
  }

  // 反向：Java mapper 接口的方法没有同名 XML statement。
  for (const iface of javaIfaces) {
    const fqn = iface.qualified_name.includes('.') ? iface.qualified_name : iface.name;
    // 只有该接口确实有对应 mapper XML（namespace 末段 = iface.name）时，才把缺 statement 的方法当 issue
    if (!nsNodes.some((ns) => (ns.name.split('.').pop() ?? ns.name) === iface.name)) continue;
    for (const [key, methods] of javaMethods) {
      if (!key.startsWith(`${iface.name}#`)) continue;
      if (matchedJavaKeys.has(key)) continue;
      for (const m of methods) result.javaMethodUnmatched.push(`${fqn}.${m.name}`);
    }
  }

  return result;
}

/** 把对账结果渲染成回执里的一段（不假装、带分母） */
export function renderMapperReconcile(r: MapperReconcileResult): string {
  const lines: string[] = [
    `── MyBatis mapper 对账 ── mapper ${r.mappers} · 建边 ${r.edges} · 解析口径 ${r.parsers.join('/') || '（无）'}`,
  ];
  if (r.edges > 0 && r.xmlStatementUnmatched.length === 0 && r.javaMethodUnmatched.length === 0 && r.interfaceNotFound.length === 0) {
    lines.push('  ✓ namespace↔接口、statement↔方法 双向对账一致');
  }
  for (const x of r.xmlStatementUnmatched) lines.push(`  ⚠ XML statement 无同名接口方法: ${x}（未建边）`);
  for (const x of r.javaMethodUnmatched) lines.push(`  ⚠ 接口方法无同名 XML statement: ${x}`);
  for (const x of r.interfaceNotFound) lines.push(`  ⚠ namespace 找不到 Java 接口: ${x}（对账降级，不代表一致）`);
  for (const x of r.interfaceAmbiguous) lines.push(`  ⚠ ${x}`);
  return lines.join('\n');
}
