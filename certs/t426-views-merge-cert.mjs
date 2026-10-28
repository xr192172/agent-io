#!/usr/bin/env node
/**
 * ★★★ cert T426 —— **`render_design` → `get_dsl`；`feature_line` → `observe action=line`**（T-#CERT-1 步 1 第 2/3 笔）（2026-10-28）
 *
 * ## 为什么这么并（不是随便塞）
 * · `render_design` 与 `get_dsl` 都是**设计侧的只读查询**，差别只是产出形态（JSON vs 图/文档）
 *   ⇒ 同一入口 `query=render` + `format`；
 * · `feature_line` 是**观测侧读数**（从索引里推功能主链，供沿线单步/投屏），与 `trace` 同族
 *   ⇒ 进 `observe`（`action=line`）。★ 这里吃到了今天那张 `ACTION_SPEC` 单表的红利：
 *     加一个 action = **加一条声明**，参数守卫/归属报错自动生效。
 *
 * ## 判据（每条亲手跑 · 基线 `certs/baselines/design-views-baseline.json`）
 *   ① 两个旧工具**都不在注册表**；工具面 **54 → 52**；
 *   ② **渲染等价**：`get_dsl query=render` 的三种格式 ⇒ 人读回执 sha **与基线逐字相同**；
 *      markdown / svg 的**产物文件 sha** 也与基线相同（渲染结果不能变）；
 *   ③ **功能线等价**：`observe action=line` 的总览与单功能 ⇒ `data` sha **与基线相同**、回执首行相同；
 *   ④ `get_dsl` 的**原有查询不受影响**（`query=features` 仍正常返回）；
 *   ⑤ `observe` 的**其它 action 不受影响**（`action=ledger` 仍正常）—— 合并不能把邻居弄坏；
 *   ⑥ **参数守卫对新增 action 生效**：`action=line` 缺 `feature` ⇒ 报错点名。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · `render` 的 `output_path` 分支未单独证（结构与原实现同一函数，风险低）；
 *   · **[未核]** 大项目下 `svg`/`markdown` 的耗时未量（本证用本仓真实册，236KB / 470KB 产物）。
 *
 * ## 用法
 *   node certs/t426-views-merge-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp426views-'));
// ★ 不覆盖 AGENT_IO_HOME：基线是在**默认 HOME** 下录的，这里必须同环境才可比
process.env.AGENT_IO_REQUIRE_PLAN = '0';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const getDsl = TOOL_DEFS.find((t) => t.name === 'get_dsl');
const observe = TOOL_DEFS.find((t) => t.name === 'observe');

function split(r) {
  const t = String(r?.text ?? '');
  const i = t.lastIndexOf('---DATA---');
  return i < 0 ? { msg: t.trim(), dataText: '' } : { msg: t.slice(0, i).trim(), dataText: t.slice(i + 10).trim() };
}
const tryJson = (x) => {
  try {
    return JSON.parse(x);
  } catch {
    return undefined;
  }
};

const baseline = JSON.parse(fs.readFileSync(path.join(HERE, 'baselines/design-views-baseline.json'), 'utf8'));

// ── ① 旧工具都不在 ────────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!names.includes('render_design'), '① `render_design` **不在注册表**');
  chk(!names.includes('feature_line'), '①-b `feature_line` **不在注册表**');
  chk(names.length <= 52, '①-c 工具面 **≤ 52**（合并只降不升；写死数字会随后续合并假红）', `实际 ${names.length}`);
}

// ── ② 渲染等价 ────────────────────────────────────────
for (const format of ['mindmap', 'markdown', 'svg']) {
  const b = baseline.render[format];
  const { msg } = split(await getDsl.handler({ query: 'render', feature: baseline.feature, format }));
  chk(sha(msg) === b.msg_sha, `② query=render format=${format}：**人读回执与基线逐字相同**`, `${sha(msg).slice(0, 10)} vs ${b.msg_sha.slice(0, 10)}`);
  if (b.out_sha) {
    const m = msg.match(/已导出[^：]*：(.+)/);
    const f = m ? m[1].trim() : '';
    const got = f && fs.existsSync(f) ? sha(fs.readFileSync(f, 'utf8')) : '';
    chk(got === b.out_sha, `②-b format=${format}：**产物文件 sha 与基线相同**（渲染结果不变）`, got ? `${got.slice(0, 10)} vs ${b.out_sha.slice(0, 10)}` : '没生成产物');
  }
}

// ── ③ 功能线等价 ──────────────────────────────────────
for (const [tag, args] of [
  ['overview', { action: 'line', feature: baseline.feature, project_dir: baseline.project_dir }],
  ['single', { action: 'line', feature: baseline.feature, project_dir: baseline.project_dir, target: baseline.feature }],
]) {
  const b = baseline.line[tag];
  const { msg, dataText } = split(await observe.handler(args));
  const data = tryJson(dataText);
  chk(data ? sha(JSON.stringify(data)) === b.data_sha : false, `③ action=line ${tag}：**data 与基线逐字段相同**`, data ? `${sha(JSON.stringify(data)).slice(0, 10)} vs ${b.data_sha.slice(0, 10)}` : 'no data');
  chk(msg.split('\n')[0] === String(b.msg_head[0] ?? ''), `③-b ${tag}：回执首行与基线相同`, `「${msg.split('\n')[0]?.slice(0, 60)}」`);
}

// ── ④ get_dsl 原有查询不受影响 ─────────────────────────
{
  const { dataText } = split(await getDsl.handler({ query: 'features' }));
  const data = tryJson(dataText);
  chk(!!data, '④ `get_dsl query=features` **仍正常**（合并没把邻居弄坏）', JSON.stringify(data).slice(0, 90));
}

// ── ⑤ observe 其它 action 不受影响 ─────────────────────
{
  let ok = false;
  let detail = '';
  try {
    const { msg } = split(await observe.handler({ action: 'ledger', target: ROOT }));
    ok = msg.length > 0;
    detail = msg.split('\n')[0]?.slice(0, 80) ?? '';
  } catch (e) {
    detail = String((e && e.message) || e);
  }
  chk(ok, '⑤ `observe action=ledger` **仍正常**（其它 action 未被 line 分支挤掉）', detail);
}

// ── ⑥ 参数守卫对新增 action 生效 ───────────────────────
{
  let msg = '';
  try {
    const r = await observe.handler({ action: 'line' });
    msg = String(r?.text ?? r?.message ?? JSON.stringify(r));
  } catch (e) {
    msg = String((e && e.message) || e);
  }
  chk(/feature/.test(msg) && /line/.test(msg), '⑥ `action=line` 缺 `feature` ⇒ **报错点名**（ACTION_SPEC 单表自动生效）', msg.slice(0, 130));
}

console.log(`\n═══ T426 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
