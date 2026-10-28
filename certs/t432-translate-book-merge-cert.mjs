#!/usr/bin/env node
/**
 * ★★★ cert T432 —— **`translate_book` 并入 `translate_go_ts book=true`**（2026-10-28）
 *
 * ## 依据（测量，不是感觉）
 * `scripts/audit-tool-reach.mjs` 三口径读数：
 *   · 真调用 **0**（`usage.jsonl` 里 17 次全是 `via=sweep|gate`，扫射/门跑不算用过）
 *   · 代码引用 **0**（除注册点外无人提它）
 *   · 文档提及 1（只在 AGENTS 触发行里被"宣传"）
 * ⇒ 它是全仓**唯一**"被宣传但没人用"的工具。而它本身是 `translate_go_ts` 的**第一步**
 * （册子都没有，骨架/填孔/对拍无从谈起；两者操作同一个 `.translate.json`）
 * ⇒ 合成一个入口：`translate_go_ts book=true`。
 *
 * ## 判据（每条亲手跑）
 *   ① `translate_book` **不在注册表**；工具面 **45 → 44**；
 *   ② `book=true` 缺 `feature` ⇒ **报错点名**；
 *   ③ `book=true` 对**没有底册**的 feature ⇒ **响亮报错并解释**（"没有底册就没有可重建的账"），
 *      ★ 绝不返回空账 —— 这是它原来的纪律，合并后必须还在；
 *   ④ 执行核 `rebuildBook` **仍在**且仍被 `cross/index.ts` 引用（拆注册不拆核）；
 *   ⑤ **口径守卫**：`audit-tool-reach` 现在报"需要判断 = **0**"（以后新增工具若零真调用又零引用，会被它抓出来）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **[未核] 真实重建路径**：本仓没有 `<feature>.translate.json` 底册 ⇒ 只证了"缺册时报错正确"，
 *     没证"有册时能重算出一本账"（那需要一份真册子）；
 *   · `target_language` 与册子 `meta.target_language` 不一致时的抛错未单独证。
 *
 * ## 用法
 *   node certs/t432-translate-book-merge-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
process.env.AGENT_IO_REQUIRE_PLAN = '0';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const tg = TOOL_DEFS.find((t) => t.name === 'translate_go_ts');

const text = async (args) => {
  try {
    const r = await tg.handler(args);
    return String(r?.text ?? r?.message ?? JSON.stringify(r));
  } catch (e) {
    return String((e && e.message) || e);
  }
};

// ── ① 旧工具已不在 ────────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!names.includes('translate_book'), '① `translate_book` **不在注册表**');
  chk(names.length <= 44, '①-b 工具面 **45 → 44**（只降不升）', `实际 ${names.length}`);
}

// ── ② 缺参响亮报错 ────────────────────────────────────
{
  const msg = await text({ book: true, project_dir: ROOT });
  chk(/feature/.test(msg), '② `book=true` 缺 `feature` ⇒ **报错点名**', msg.slice(0, 110));
}

// ── ③ 没底册 ⇒ 响亮报错 + 解释（不返回空账）─────────────
{
  const msg = await text({ book: true, project_dir: ROOT, feature: 'agent-io', dry_run: true });
  chk(/翻译册不存在/.test(msg), '③ 没有底册时**响亮报错**（不是返回一份空账）', msg.split('\n')[0]?.slice(0, 120));
  chk(/没有底册就没有可重建的账/.test(msg), '③-b 报错**带解释**（说明"册子是人写的 + 生成器重算"这个结构）', msg.split('\n')[1]?.slice(0, 120));
}

// ── ④ 执行核仍在 ─────────────────────────────────────
{
  const core = fs.readFileSync(path.join(ROOT, 'src/infrastructure/authoring/translate/book.ts'), 'utf8');
  chk(/export function rebuildBook|rebuildBook/.test(core), '④ 执行核 `rebuildBook` **仍在**');
  const idx = fs.readFileSync(path.join(ROOT, 'src/application/cross/index.ts'), 'utf8');
  chk(/rebuildBook\(\{/.test(idx), '④-b `cross/index.ts` **仍在调用 `rebuildBook`**（从独立工具变成 translate_go_ts 的一个形态）');
}

// ── ⑤ 口径守卫：无"被宣传但没人用"的工具 ────────────────
{
  let out = '';
  try {
    out = execFileSync(process.execPath, ['scripts/audit-tool-reach.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32e6 });
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  const m = out.match(/其中\*\*需要判断\*\*的\s*(\d+)\s*个/);
  chk(m && Number(m[1]) === 0, '⑤ `audit-tool-reach` 报**"需要判断 = 0"**（没有孤立/被宣传但没人用的工具）', m ? `需要判断 ${m[1]} 个` : out.slice(-200));
}

console.log(`\n═══ T432 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
