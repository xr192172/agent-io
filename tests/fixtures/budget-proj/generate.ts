/**
 * budget-proj —— 载荷预算判据的**合成夹具生成器**（不拿本仓当输入）。
 *
 * ★ 为什么必须是合成夹具（AGENTS-RULES 0.12 第 2 条：门与判据的输入不许是环境态）：
 *   本仓自己的 `code_health` 实测要 **80 s**、文件数会随提交漂 ⇒ 拿它当输入等于让 CI 每次
 *   跑一份"今天恰好长这样"的样本。这里现场生成、规模**显式钉死**（A=50 文件 / B=200 文件 = 4×）。
 *
 * ★ 夹具刻意设计成"三个维度都有货"：
 *   · 每个文件 `fnsPerFile` 个**导出且项目内无消费者**的函数 ⇒ `unused_export`（条数随文件数线性增长）；
 *   · 其中第 0 个函数有 11 个分支 ⇒ 圈复杂度 > 阈值 10 ⇒ `high_complexity`；
 *   · 第 1..n 个函数调用第 0 个 ⇒ `calls` / `called_by` 非空（改前占载荷 60.8% 的那两个字段）。
 * ★ 目录数**两组相同**（默认 10）：这样 A/B 的载荷差异只可能来自"按函数/文件铺开的明细"，
 *   而不是"目录多了一倍"（后者会让聚合层本身线性增长，掩盖我们真正要抓的东西）。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface BudgetProjSpec {
  /** 文件数（A=50 / B=200：4×） */
  files: number;
  /** 每文件函数数（默认 8） */
  fnsPerFile?: number;
  /** 目录数（默认 10；★ 两组夹具必须有同一个值，见头注） */
  dirs?: number;
}

/** 现场写出一个夹具项目（幂等覆盖写；父目录不存在则建）。 */
export function writeBudgetProject(root: string, spec: BudgetProjSpec): void {
  const fns = spec.fnsPerFile ?? 8;
  const dirs = spec.dirs ?? 10;
  for (let i = 0; i < spec.files; i++) {
    const relDir = `src/mod${i % dirs}`;
    fs.mkdirSync(path.join(root, relDir), { recursive: true });
    const lines: string[] = [];
    // ① 高复杂度：11 个分支 + 1 个 for ⇒ 圈复杂度 ≈ 13 > 默认阈值 10
    lines.push(`export function fn${i}_0(xs: number[]): number {`);
    lines.push('  let total = 0;');
    lines.push('  for (const x of xs) {');
    for (let k = 1; k <= 11; k++) {
      lines.push(`    ${k === 1 ? 'if' : '} else if'} (x === ${k}) total += ${k};`);
    }
    lines.push('  }');
    lines.push('  return total;');
    lines.push('}');
    // ② 其余函数：短小、但**调用了**第 0 个 ⇒ calls/called_by 有内容
    for (let k = 1; k < fns; k++) {
      lines.push('');
      lines.push(`export function fn${i}_${k}(): number {`);
      lines.push(`  return fn${i}_0([${k}, ${k + 1}]);`);
      lines.push('}');
    }
    fs.writeFileSync(path.join(root, relDir, `file${i}.ts`), `${lines.join('\n')}\n`, 'utf8');
  }
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'budget-proj', private: true, type: 'module' }, null, 2)}\n`,
    'utf8',
  );
}
