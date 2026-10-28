#!/usr/bin/env node
/**
 * ★★★ cert T431 —— **`suggest_renames` + `find_similar_names` → `rename_symbols`；`read_project_docs` → `explore_code`**（2026-10-28）
 *
 * ## 为什么这么并
 * - 旧 `rename_symbols` 的描述里自己写着：「**suggest_renames / find_similar_names 是它的上游只读分析层**」
 *   ⇒ 同一件事分了三处。「这几个名字容易看错 / 该改成什么」本来就是**改名工具自己该会说的话**。
 *   ⇒ 收成一个入口的 `analyze=similar|suggest` 形态（只读、不需要 `renames`）。
 * - `read_project_docs` 与 `read`（读源码）/ `facts`（读索引事实）同属「读」这条线
 *   ⇒ 进 `explore_code` 的 `action=docs`。
 *
 * ## 判据（每条亲手跑）
 *   ① 三个旧工具**都不在注册表**；工具面 **48 → 45**；
 *   ② `rename_symbols analyze=suggest` **真出候选**（结构含 candidates 或 items）；
 *   ③ `rename_symbols analyze=similar` **真出聚类**（含 clusters / items）；
 *   ④ **只读**：两种 analyze 形态跑完，目标文件 **sha256 不变**（分析不许改文件）；
 *   ⑤ `explore_code action=docs` 出**文档清单**（篇数 > 0，含目录）；
 *   ⑥ 执行核仍在（`suggestRenamesInFile` / `suggestDisambiguationsInFile` / `listProjectDocs`）；
 *   ⑦ 缺参**响亮报错**（analyze 缺 file / docs 缺 feature）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · LLM 路径**未核**（本机未配 LLM ⇒ 走的是"未启用/降级"分支）；只证降级路径可用；
 *   · `analyze` 的"建议名是否真的好"不作判据（那是模型能力，不是本仓的能力）；
 *   · **[未核]** `docs` 的 `targets` 匹配分支（需按目录分组/步骤/文件构造目标集）。
 *
 * ## 用法
 *   node certs/t431-suggest-docs-merge-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
process.env.AGENT_IO_REQUIRE_PLAN = '0';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const rs = TOOL_DEFS.find((t) => t.name === 'rename_symbols');
const ec = TOOL_DEFS.find((t) => t.name === 'explore_code');

function unwrap(r) {
  const t = String(r?.text ?? '');
  const i = t.lastIndexOf('---DATA---');
  if (i < 0) return { msg: t.trim(), data: undefined };
  let data;
  try {
    data = JSON.parse(t.slice(i + 10).trim());
  } catch {
    data = undefined;
  }
  return { msg: t.slice(0, i).trim(), data };
}

const target = path.join(ROOT, 'src/application/refactor/index.ts');
const sha0 = sha(target);

// ── ① 三个旧工具都不在 ────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  for (const old of ['suggest_renames', 'find_similar_names', 'read_project_docs']) {
    chk(!names.includes(old), `① \`${old}\` **不在注册表**`);
  }
  chk(names.length <= 45, '①-d 工具面 **48 → 45**（只降不升）', `实际 ${names.length}`);
}

// ── ② analyze=suggest ────────────────────────────────
{
  const { msg, data } = unwrap(await rs.handler({ analyze: 'suggest', project_dir: ROOT, file: 'src/application/refactor/index.ts', use_llm: false }));
  chk((data?.candidates?.length ?? 0) > 0, '② `analyze=suggest` **真出候选**（candidates > 0）', `候选 ${data?.candidates?.length} 个 · 「${msg.slice(0, 70)}」`);
  chk(/rename_symbols|renames/.test(msg), '②-b 回执点明"建议名可直接作为本工具 scope=local 的 renames 条目"（闭环说清）');
}

// ── ③ analyze=similar ────────────────────────────────
{
  const { data } = unwrap(await rs.handler({ analyze: 'similar', project_dir: ROOT, file: 'src/application/refactor/index.ts', use_llm: false }));
  chk(Array.isArray(data?.clusters), '③ `analyze=similar` **真出聚类**（clusters 数组）', `聚类 ${data?.clusters?.length} 个 · items ${data?.items?.length} 条`);
}

// ── ④ 只读性 ─────────────────────────────────────────
chk(sha(target) === sha0, '④ 两种 analyze 形态**只读**：目标文件 sha256 **不变**', sha0.slice(0, 12));

// ── ⑤ action=docs ────────────────────────────────────
{
  const { msg, data } = unwrap(await ec.handler({ action: 'docs', feature: 'agent-io', project_dir: ROOT }));
  const total = data?.docs?.length ?? data?.total ?? 0;
  chk(total > 0, '⑤ `explore_code action=docs` 出**文档清单**（篇数 > 0）', `${total} 篇 · 「${msg.slice(0, 70)}」`);
  chk(!!data?.dir, '⑤-b 清单带**目录**（读数可追溯）', String(data?.dir ?? ''));
}

// ── ⑥ 执行核仍在 ─────────────────────────────────────
{
  const idx = fs.readFileSync(path.join(ROOT, 'src/application/refactor/index.ts'), 'utf8');
  chk(/suggestRenamesInFile/.test(idx) && /suggestDisambiguationsInFile/.test(idx), '⑥ 改名建议执行核**仍在**（拆注册不拆执行核）');
  const exp = fs.readFileSync(path.join(ROOT, 'src/application/meta/explore/explore_code.ts'), 'utf8');
  chk(/listProjectDocs/.test(exp) && /readProjectDoc/.test(exp), '⑥-b 文档执行核 `listProjectDocs` / `readProjectDoc` **仍在**');
}

// ── ⑦ 缺参响亮报错 ───────────────────────────────────
{
  const grab = async (fn) => {
    try {
      const r = await fn();
      return String(r?.text ?? r?.message ?? JSON.stringify(r));
    } catch (e) {
      return String((e && e.message) || e);
    }
  };
  const a = await grab(() => rs.handler({ analyze: 'suggest', project_dir: ROOT }));
  chk(/file/.test(a), '⑦ `analyze` 缺 `file` ⇒ **报错点名**', a.slice(0, 110));
  const b = await grab(() => ec.handler({ action: 'docs', project_dir: ROOT }));
  chk(/feature/.test(b), '⑦-b `action=docs` 缺 `feature` ⇒ **报错点名**', b.slice(0, 110));
}

console.log(`\n═══ T431 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
