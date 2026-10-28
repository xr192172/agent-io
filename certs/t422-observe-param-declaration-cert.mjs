#!/usr/bin/env node
/**
 * ★★★ cert T422 —— **observe 的参数声明只有一处**（2026-10-28）
 *
 * ## 修的是什么（一天踩两次的坑）
 * `observe` 单入口有**三处**在声明"这个 action 认哪些参数"：
 * 1. zod `inputSchema`（对外契约）；
 * 2. 入口里的 `SPEC` / `NEED` 两张手写表（守卫用）；
 * 3. 一条**魔法白名单** `['project_dir','feature','agent','dry_run','use_llm']`（对所有 action 放行）。
 * 实测代价：
 * · `contract_probes` 进了 schema 与 handler，却**没进 SPEC** ⇒ 被当"陌生人点名"**拒掉**；
 * · 那条魔法清单让 5 个字段"哪儿都能传"，等于**守卫形同虚设**。
 * ⇒ 现在只有一张 `ACTION_SPEC`（`fields` + `need`），`SPEC`/`NEED` 由它派生，魔法清单删除，
 *   只保留一个**显式声明**的 `COMMON_FIELDS = ['agent']`。
 *
 * ## 判据（每条亲手跑）
 *   ① **schema 字段都能到某个 action**：zod 里声明的每个参数，至少出现在一个 action 的 `fields` 里
 *      （否则该参数**永远传不进来** —— 就是 `contract_probes` 那个 bug）；
 *   ② **反向**：`fields` 里的每个名字都在 zod schema 里（防拼写漂移）；
 *   ③ `need ⊆ fields`（必填的必须是被认的）；
 *   ④ 未知 action ⇒ 报错并**列出全部 action**；
 *   ⑤ 传别的 action 的专属字段 ⇒ **点名归属**（保留既有行为，不倒退）；
 *   ⑥ 源码里**没有**那条魔法白名单（静态检查）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · ① 靠**读源码文本**提取 zod 键名（正则），不是从运行时 schema 反射 —— 若哪天 schema 写法变（如拆文件）需同步；
 *   · **[未核]** ④⑤ 用 CLI 调用验证，MCP 传输层未验；
 *   · **[未核]** 没证"`COMMON_FIELDS` 加错字段"的情形（它本身是显式的一行，靠 review）。
 *
 * ## 用法
 *   node certs/t422-observe-param-declaration-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp422param-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const SRC = fs.readFileSync(path.join(ROOT, 'src/application/observe/index.ts'), 'utf8');

// zod schema 里的键名（`  key: z.…` 形式，且带 `[action]` 描述）
// ★ 只取 `name: 'observe'` 那个工具自己的 inputSchema 块（同一文件里还有别的工具）
//   ★ 且容忍 `key: z` + 换行继续写（如 `contract_probes: z\n  .array(...)`）
const observeAt = SRC.indexOf("name: 'observe'");
const blockStart = SRC.indexOf('inputSchema: {', observeAt);
const blockEnd = SRC.indexOf('// ★ 拆注册不拆执行核', blockStart);
const schemaBlock = SRC.slice(blockStart, blockEnd > 0 ? blockEnd : SRC.length);
const schemaKeys = [...schemaBlock.matchAll(/^\s{6}([a-z_]+): z\b/gm)].map((m) => m[1]);

// ACTION_SPEC 表
const specBlock = SRC.slice(SRC.indexOf('const ACTION_SPEC'), SRC.indexOf('const SPEC: Record<string, string[]>'));
// ★ 容忍多行写法（`instrument` 是展开写的）：先按 action 名切片，再各自取 fields/need
const actions = [];
{
  const re = /^\s{8}([a-z_]+): \{/gm;
  const marks = [...specBlock.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
  for (let i = 0; i < marks.length; i++) {
    const seg = specBlock.slice(marks[i].at, marks[i + 1]?.at ?? specBlock.length);
    const f = seg.match(/fields: \[([\s\S]*?)\]/);
    const nd = seg.match(/need: \[([\s\S]*?)\]/);
    actions.push({
      action: marks[i].name,
      fields: [...(f?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]),
      need: [...(nd?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]),
    });
  }
}

chk(actions.length >= 8, `⓪ 解析出 ${actions.length} 个 action 的声明`, actions.map((a) => a.action).join(', '));

// ── ① schema → actions ─────────────────────────────────
{
  const known = new Set([...actions.flatMap((a) => a.fields), 'agent', 'action']);
  const unreachable = schemaKeys.filter((k) => !known.has(k));
  chk(unreachable.length === 0, '① zod 里声明的每个参数**都能到某个 action**（否则永远传不进来）', unreachable.length ? `不可达：${unreachable.join(', ')}` : `${schemaKeys.length} 个参数全部可达`);
}

// ── ② actions → schema ─────────────────────────────────
{
  const declared = new Set(schemaKeys);
  const ghosts = [...new Set(actions.flatMap((a) => a.fields))].filter((k) => !declared.has(k));
  chk(ghosts.length === 0, '② `fields` 里的每个名字都在 zod schema 里（防拼写漂移）', ghosts.length ? `幽灵字段：${ghosts.join(', ')}` : '无幽灵');
}

// ── ③ need ⊆ fields ────────────────────────────────────
{
  const bad = actions.filter((a) => a.need.some((n) => !a.fields.includes(n)));
  chk(bad.length === 0, '③ 每个 action 的 `need ⊆ fields`（必填的必须是被认的）', bad.map((b) => b.action).join(', ') || '全部成立');
}

// ── ⑥ 魔法白名单已删 ───────────────────────────────────
{
  const magic = /if \(\['project_dir', 'feature', 'agent', 'dry_run', 'use_llm'\]\.includes\(k\)\) return false;/;
  chk(!magic.test(SRC), '⑥ 源码里**没有**那条"对所有 action 放行 5 个字段"的魔法白名单');
}

// 工具级
const call = (obj) => {
  try {
    return execFileSync(process.execPath, ['dist/src/presentation/cli/cli.js', 'observe', '--json', JSON.stringify(obj)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, AGENT_IO_REQUIRE_PLAN: '0' },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
};

// ── ④ 未知 action（**直接调 handler**：schema 的 enum 会先拦住，那是另一层）──
{
  const { TOOL_DEFS } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/tool_registry.js');
  const def = TOOL_DEFS.find((t) => t.name === 'observe');
  let msg = '';
  try {
    await def.handler({ action: 'nope-422' });
  } catch (e) {
    msg = String((e && e.message) || e);
  }
  chk(/不认识 action/.test(msg) && /log/.test(msg) && /instrument/.test(msg), '④ 未知 action ⇒ 守卫报错并**列出全部 action**', msg.slice(0, 140));
}
// ── ④-b schema 层也拦（enum：不把非法 action 送进来）──
{
  const out = call({ action: 'nope-422' });
  chk(/schema 校验/.test(out) && /action/.test(out), '④-b zod enum **在入参层就拦住**非法 action（双保险）', out.split('\n').find((l) => /schema 校验/.test(l))?.slice(0, 100) ?? '');
}

// ── ⑤ 传别人的专属字段 ⇒ 点名归属 ──────────────────────
{
  const out = call({ action: 'log', events_path: 'x.jsonl' });
  chk(/不属于本动作|属于 trace/.test(out), '⑤ 传别的 action 的专属字段 ⇒ **点名归属**（不倒退成"缺字段"）', out.split('\n').find((l) => /不属于本动作/.test(l))?.slice(0, 160) ?? '');
}

console.log(`\n═══ T422 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
