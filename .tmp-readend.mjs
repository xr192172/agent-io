import fs from 'node:fs';
const p = 'src/application/patrol/task_drift.ts';
let s = fs.readFileSync(p, 'utf8');
const before = s;
const log = [];

// ① DriftReport 加 pending_design
s = s.replace(
  '  /** 判不了的原因（`null` = 判了） */\n  unavailable: string | null;\n}',
  `  /**
   * ★★★ 2026-10-18（todos 的读端）：**预决策待人设计** —— todo 有 \`node_id\`（指向某节点）
   * 但还 \`candidate\`（没人领）⇒ 那个节点的设计"该改还没改"。
   * ★ 它是 todo.link 写进 \`node_id\` 之后的**唯一读端** —— 没它，"指向"就没人看得见。
   */
  pending_design: { node_id: string; todos: string[] }[];
  /** 判不了的原因（\`null\` = 判了） */\n  unavailable: string | null;\n}`,
);
log.push('DriftReport 加 pending_design');

// ② 在正常返回前填（用 return report; 前的最后一处插入）
const marker = '  // ── 5. 租约：只产出事件（★ 不静默改 state） ──';
if (!s.includes(marker)) {
  console.error('★ 插入锚点不在');
  process.exit(2);
}
s = s.replace(
  marker,
  `  // ── 4b. 预决策待人设计（★ todos 的 node_id 读端）──
  //   判据：todo 有 node_id（指向某节点）且 state 还 candidate（没人领）⇒ 那个节点的设计该改还没改。
  //   ★ 只看 candidate：claimed 说明有人在做；done/void 是终态。
  const pendingByNode = new Map<string, string[]>();
  for (const t of (opts as { todos?: { id: string; node_id?: string; state: string }[] }).todos ?? []) {
    if (t.node_id && t.state === 'candidate') {
      if (!pendingByNode.has(t.node_id)) pendingByNode.set(t.node_id, []);
      pendingByNode.get(t.node_id)!.push(t.id);
    }
  }
  report.pending_design = [...pendingByNode.entries()].map(([node_id, todos]) => ({ node_id, todos }));

${marker}`,
);
log.push('patrolDrift 填 pending_design');

fs.writeFileSync(p, s);
console.log(before === s ? '★ 没变' : '✓ ' + log.join(' · '));
