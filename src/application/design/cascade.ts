/**
 * cascade —— **文档级联内化**（第⑬项第一刀，用户拍板）。
 *
 * ## 它做什么
 * `edit_dsl` 成功落盘后，自动跑受影响的文档产物（cognition / design-db / FACTS）——
 * 模型不用记得手动跑，改完册三产物自动新鲜 ⇒ 文档与事实门不再红。
 *
 * ## 级联范围判定（按 operations[].type）
 * · **任何 type** ⇒ cognition（COGNITION.txt 是一行式认知索引，任何册改动都影响）
 * · `geometry` / `edge` / `node` / `goal` / `edge_intent` ⇒ design-db（投影受几何/拓扑影响）
 * · `file` / `api` ⇒ gen-facts（FACTS.json 的工具面/契约面数据源是 semantic.files）
 * · schema:gen **不进此级联**——它是 src 类型演进的级联，归第二刀 edit_code 侧。
 *
 * ## 实现方式（lead 裁定：import 而非 spawnSync）
 * 三个产物的核心函数都可直接 import（进程内调函数，零 spawn 开销、零沙箱 EPERM）：
 * · cognition：`scripts/gen_cognition.mjs` 的 `computeSections` + `renderCognition` —— 但 scripts/ 是 .mjs
 *   不是编译产物 ⇒ 改为把**核心逻辑抽到 dist 可导入的位置**，或直接 import .mjs（Node ESM 可以 import .mjs 文件）。
 *   ★ 实测：`.mjs` 可以直接 `import()`（纯 ESM，无 TS 依赖）⇒ 走动态 import 脚本文件本身。
 * · design-db：`dist/src/application/design/db/gen_design_db.js` 的 `genDesignDb(root, {feature})` —— 已有可导入入口。
 * · gen-facts：`scripts/gen-facts.mjs` **import 了 TS 文件**（capability_matrix.ts）⇒ 不能直接 import
 *   （需要 tsx）⇒ dist 里没有这个模块 ⇒ **降级为响亮警告**（or 把 buildFacts 抽到 src/ 编译——**本卡不做**，另卡）。
 *
 * ## 失败语义
 * 级联失败**响亮警告但不阻断主操作**（同 judge-all snapshot 写失败语义）——
 * 主操作（edit_dsl 落盘）已成功；级联产物可以下一轮重跑（"没跑成"≠"内容坏了"）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CascadeResult {
  ran: string[];
  skipped: string[];
  errors: Array<{ step: string; message: string }>;
}

/** 哪些 op type 触发 design-db 重投影（几何/拓扑类改动） */
const GEOMETRY_TYPES = new Set(['node', 'edge', 'geometry', 'goal', 'edge_intent', 'layout', 'snapshot', 'simulation']);
/** 哪些 op type 触发 FACTS 重生成（契约面改动：semantic.files 的 expected_apis / expected_deps） */
const FACTS_TYPES = new Set(['file', 'api', 'binding']);

/** 级联入口：edit_dsl 落盘成功后调用（handlers.ts editDslHandler 的成功路径） */
export async function runCascade(
  root: string,
  feature: string,
  ops: ReadonlyArray<{ type?: string }>,
): Promise<CascadeResult> {
  const result: CascadeResult = { ran: [], skipped: [], errors: [] };
  const types = new Set(ops.map((o) => String(o.type ?? '')));

  // ── ① cognition（任何册改动都影响 ⇒ 恒跑）──
  try {
    const cogPath = path.join(root, 'scripts', 'gen_cognition.mjs');
    if (fs.existsSync(cogPath)) {
      const cog = await import(pathToFileURL(cogPath).href);
      const sections = cog.computeSections();
      const text = cog.renderCognition(sections);
      const dataDir = path.join(root, '.agent-io');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'COGNITION.txt'), text, 'utf-8');
      result.ran.push('cognition');
    } else {
      result.skipped.push('cognition（scripts/gen_cognition.mjs 不存在）');
    }
  } catch (e) {
    result.errors.push({ step: 'cognition', message: (e as Error).message });
  }

  // ── ② design-db（几何/拓扑类改动才跑；按 feature 过滤省算力）──
  if ([...types].some((t) => GEOMETRY_TYPES.has(t))) {
    try {
      const dbPath = path.join(root, 'dist', 'src', 'application', 'design', 'db', 'gen_design_db.js');
      if (fs.existsSync(dbPath)) {
        const mod = await import(pathToFileURL(dbPath).href);
        mod.genDesignDb(root, { feature });
        result.ran.push('design-db');
      } else {
        result.skipped.push('design-db（dist 产物不存在）');
      }
    } catch (e) {
      result.errors.push({ step: 'design-db', message: (e as Error).message });
    }
  } else {
    result.skipped.push('design-db（本次改动不涉及几何/拓扑）');
  }

  // ── ③ gen-facts（契约面改动才跑）──
  //   ★ gen-facts.mjs import 了 TS 文件（capability_matrix.ts）⇒ 不能直接 import .mjs
  //   （Node ESM 不认 .ts）⇒ **降级为响亮警告**（抽 buildFacts 到 src/ 编译是另卡，见头注释）。
  if ([...types].some((t) => FACTS_TYPES.has(t))) {
    result.errors.push({
      step: 'gen-facts',
      message: 'gen-facts.mjs import 了 TS 文件（capability_matrix.ts）⇒ 进程内 import 需 tsx；' +
        '抽 buildFacts 到 src/ 编译后再接入（另卡）。本轮请手动跑 `npm run gen-facts`。',
    });
  } else {
    result.skipped.push('gen-facts（本次改动不涉及契约面）');
  }

  return result;
}

/** 级联结果 → edit_dsl 回执追加行（人读） */
export function renderCascade(r: CascadeResult): string {
  const lines: string[] = [];
  if (r.ran.length) lines.push(`  ✓ 级联：${r.ran.join(' · ')}`);
  if (r.skipped.length) lines.push(`  · 级联跳过：${r.skipped.join(' · ')}`);
  if (r.errors.length) {
    lines.push(`  ⚠ 级联失败 ${r.errors.length} 步（不阻断主操作，可手动补跑）：`);
    for (const e of r.errors) lines.push(`    · ${e.step}: ${e.message.slice(0, 120)}`);
  }
  return lines.length ? '\n── 文档级联 ──\n' + lines.join('\n') : '';
}
