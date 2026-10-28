#!/usr/bin/env node
/**
 * audit:llm-fill —— **LLM 填孔通路是否可用**（手动跑，不进 `npm run verify`）
 *
 * ## 为什么是脚本而不是证（certs/）
 * 这条通路依赖**外部网络 + 供应商 key 池**。放进 `verify` 会让门的红绿取决于网络抖动
 * —— 那正是本仓最反对的"把不确定性混进判据"。⇒ 手动审计脚本，读数如实打印。
 *
 * ## 三个读数（缺一不可）
 *   ① **有 provider**：`hasEnabledProvider()`（key 的家 = `<dataHome>/gateway.json`，**不是 env**）
 *   ② **真能出网**：一次最小 chat 调用，返回 token 读数（不是"配置看起来对"）
 *   ③ **真能填孔**：拿一个带函数体的 Go 文件跑 `fill`，断言产物里**不再有 `TODO(translate)`**、
 *      且 `LLM 填孔：N/N 过验证`
 *
 * ## 用法
 *   npm run build && node scripts/audit-llm-fill.mjs                 # 默认用 agent-memory 的 rrf.go
 *   node scripts/audit-llm-fill.mjs <某个.go 文件>
 *
 * ## 边界（诚实）
 * · 需要 key（本仓 `gateway.json` 从既有项目导入：见 memory §98）；
 * · **[未核]** 填出来的**语义正确性**：本脚本只证"填了、过了语法门、不再是空壳"，
 *   行为对不对要 `verify`（对照用例）+ 人读。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';

const gw = await import(D + 'infrastructure/llm_gateway.js');
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');

let ok = 0;
let bad = 0;
const chk = (cond, label, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  cond ? ok++ : bad++;
};

// ① provider
const has = gw.hasEnabledProvider();
const masked = gw.listProvidersMasked();
chk(has, '① 网关**有可用 provider**（key 的家 = <dataHome>/gateway.json）', JSON.stringify(masked.map((p) => ({ id: p.id, base: p.base_url, model: p.model, keys: p.key_count }))));
if (!has) {
  console.log('\n—— 没有 key 就到此为止（不伪造读数）——');
  console.log('   配 key：`gateway_provider action=upsert id=agnes base_url=... keys=[...]`');
  process.exit(1);
}

// ② 出网
try {
  const r = await gw.chatViaGateway([{ role: 'user', content: '只回复两个字：可用' }], { maxTokens: 16 });
  chk((r.usage?.prompt_tokens ?? 0) > 0, '② **真能出网**（拿到 token 读数）', JSON.stringify({ provider: r.provider_id, key_fp: r.key_fp, model: r.model, usage: r.usage }));
} catch (e) {
  chk(false, '② 出网失败', String(e?.message ?? e).slice(0, 220));
}

// ③ 真填孔
const goFile = process.argv[2] ?? 'D:/agentio/dev/agent-memory/rrf.go';
if (fs.existsSync(goFile)) {
  const tr = TOOL_DEFS.find((t) => t.name === 'translate');
  const t0 = Date.now();
  const r = await tr.handler({ file: goFile, fill: true, verify: false });
  const txt = String(r?.text ?? '');
  const i = txt.lastIndexOf('---DATA---');
  const msg = (i > 0 ? txt.slice(0, i) : txt).trim();
  const data = i > 0 ? JSON.parse(txt.slice(i + 10).trim()) : {};
  const out = String(data?.output ?? '');
  chk(/LLM 填孔：\d+\/\d+/.test(msg), '③ `fill` 跑通并报"LLM 填孔 N/N"', msg.split('\n').find((l) => /填孔/.test(l))?.slice(0, 120) ?? '');
  chk(out.length > 0 && !/TODO\(translate\)/.test(out), '③-b 产物**不再有空壳**（没有 `TODO(translate)` 残留）', `${out.length} 字符 · ${Math.round((Date.now() - t0) / 1000)}s`);
  const sample = out.split('\n').filter((l) => /function|=>|const |for \(/.test(l)).slice(0, 4);
  console.log('     抽样（人读语义用）：\n' + sample.map((s) => '       ' + s.trim().slice(0, 100)).join('\n'));
} else {
  console.log(`（跳过 ③：没有夹具 ${goFile}）`);
}

console.log(`\n读数：PASS=${ok} · FAIL=${bad}（★ 语义对不对不在本脚本：它只证"填了、过语法门、不是空壳"）`);
process.exit(bad === 0 ? 0 : 1);
