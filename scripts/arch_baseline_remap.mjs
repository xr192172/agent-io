/**
 * 架构基线**按映射重排**（不是全量重收！）。
 *
 * 用途：搬迁把文件挪了位置 ⇒ 同一批 `no-circular` 违规的 `from`/`cycle[].name` 路径变了
 * ⇒ 基线对不上 ⇒ 门把它们当"新增"报出来（假红）。
 *
 * ★ 判据（先证后改）：
 *   ① 对每条"现测违规"施加**逆映射**（新路径→旧路径）⇒ 必须能在基线里找到同规则同内容的条目；
 *   ② 找不到的 = **真新增违规** ⇒ 报出来，**不写进基线**；
 *   ③ 基线里文件已不存在的条目 = 陈旧 ⇒ 删掉。
 * ⇒ 只有 ① 全部解释得通 + ② 为 0 时，才允许 `--apply`。
 *
 * ★ 2026-09-30 进仓：搬迁（尤其改名/目录迁移）后必然撞上它 —— 基线里同一批违规的路径变了，
 *   门会把它们当"新增"报出来。★ 它内建了纪律：**先证明 0 条真新增，才允许重写基线**。
 *
 * 用法: node scripts/arch_baseline_remap.mjs <old>=<new> [...] [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const pairs = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return { old: a.slice(0, i), new: a.slice(i + 1) };
});
const toNew = new Map(pairs.map((p) => [p.old, p.new]));
const toOld = new Map(pairs.map((p) => [p.new, p.old]));

const BASE = '.dependency-cruiser-known-violations.json';
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const raw = execFileSync('npx', ['depcruise', 'src', '--config', '.dependency-cruiser.cjs', '--output-type', 'json', '--no-ignore-known'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true });
const now = JSON.parse(raw).summary?.violations ?? [];

const mapPath = (m, v) => m.get(v) ?? v;
/**
 * ★ 判等键。循环依赖**必须按"节点集合"归一化**：
 *   depcruise 报同一条环时 `from` 取的是**环上任一节点**（哪个都可能），
 *   搬迁后重新定基 ⇒ 同一条环的 `from` 会变、顺序会转 ⇒ 把 `from` 算进键就会判成"新增"（假红）。
 *   ★ 实测：搬 ⑥-2 后 7 条环**全被**判成"真新增"，逐条打印才发现节点集合完全一致。
 */
const key = (v, m) => {
  const name = v.rule?.name ?? String(v.rule);
  if (name === 'no-circular') {
    const nodes = (v.cycle ?? []).map((c) => (m ? mapPath(m, c.name) : c.name)).sort().join('>');
    return `${name}\t${nodes}`;
  }
  const f = m ? mapPath(m, v.from) : v.from;
  const t = m ? mapPath(m, v.to) : v.to; // ★ `to` 也要映射：不然 from 对上了、to 还对不上
  return `${name}\t${f}\t${t ?? ''}`;
};

const haveNow = new Set(now.map((v) => key(v)));
const baseKeys = base.map((v) => key(v));
const baseSet = new Set(baseKeys);

// ① 现测违规 → 逆映射回旧坐标 → 能否命中基线
const unexplained = [];
for (const v of now) {
  const back = key(v, toOld);
  const direct = key(v);
  if (baseSet.has(direct) || baseSet.has(back)) continue;
  unexplained.push({ v, back });
}

// ③ 基线里文件已不存在 ⇒ 陈旧
const staleIdx = [];
base.forEach((v, i) => {
  const fromNew = mapPath(toNew, v.from);
  if (!fs.existsSync(path.join(ROOT, fromNew))) staleIdx.push(i);
});

console.log(`基线 ${base.length} 条 ｜ 现测 ${now.length} 条`);
console.log(`\n[陈旧] 基线里文件已不存在：${staleIdx.length}`);
for (const i of staleIdx) console.log('  - ' + base[i].rule.name + '  ' + base[i].from);
console.log(`\n[真新增] 逆映射也解释不了的：${unexplained.length}`);
for (const u of unexplained) console.log('  !! ' + u.back);

if (unexplained.length > 0) {
  console.log('\n✗ 有真新增违规 ⇒ 拒绝写基线（那会把新问题冻成"允许的存量"）');
  process.exit(1);
}
if (!APPLY) { console.log('\n✓ 全部可用路径映射解释；加 --apply 才重排基线'); process.exit(0); }

const staleSet = new Set(staleIdx);
const remapped = [];
for (let i = 0; i < base.length; i++) {
  if (staleSet.has(i)) continue;
  const v = JSON.parse(JSON.stringify(base[i]));
  // 只把"文件被搬走的"路径改成新路径（依赖路径可能指向未搬文件，映射会自然 no-op）
  v.from = mapPath(toNew, v.from);
  v.to = mapPath(toNew, v.to);
  v.unresolvedTo = v.unresolvedTo; // 相对说明符，随文件位置变，交给 depcruise 兜住
  if (Array.isArray(v.cycle)) for (const c of v.cycle) c.name = mapPath(toNew, c.name);
  remapped.push(v);
}
// 补上"现测存在但基线没有、且能用映射解释"的（改名的后果）
for (const v of now) {
  if (remapped.some((b) => key(b) === key(v))) continue;
  remapped.push(v);
}
fs.writeFileSync(BASE, JSON.stringify(remapped, null, 2) + '\n');
console.log(`\n✓ 已重排：${base.length} → ${remapped.length} 条`);
