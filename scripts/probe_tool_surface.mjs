/**
 * probe_tool_surface —— **工具面契约指纹**（对 LLM 的契约：`name` / `title` / `description` / 入参键）。
 *
 * ## 与「MCP 工具签名」那道门**意图不同**（别混，也别互相替代）
 *   · 门 `scripts/mcp/mcp_scan.mjs`：验**当下**这些签名**合法/能跑**，输出写 `.inspect/mcp_scan.json`
 *     —— 而 `.inspect/` 被 gitignore ⇒ **它不是基线**，**没有"跟上次比"的能力**。
 *   · 本探针：记**契约文本的指纹**，供 `snap:diff` **与上次比** ⇒ 回答"工具面有没有被悄悄改过"。
 * ★ 实测过这个缺口的痛：早先我改过 `get_dsl` 的 description（那是 LLM 看到的**全部**），
 *   而**没有任何东西会因此变红** —— 门只看合法性，不看"变了没有"。
 *
 * `--json`：吐 `{ count, tools: [{name,title,description,inputKeys}] }`（按 name 排序 ⇒ 确定）。
 */
const REPO = 'D:/project_develop/design-canvas';
const { TOOL_DEFS } = await import('file://' + REPO + '/dist/src/application/tool_registry.js');

const tools = TOOL_DEFS.map((t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputKeys: Object.keys(t.inputSchema ?? {}),
})).sort((a, b) => a.name.localeCompare(b.name));

const payload = { count: tools.length, tools };
if (process.argv.includes('--json')) { console.log(JSON.stringify(payload)); process.exit(0); }

console.log(`工具面契约：${tools.length} 个工具\n`);
const byLane = {}; // 只做概览
for (const t of tools) (byLane[t.name.split('_')[0]] ??= []).push(t.name);
for (const [k, v] of Object.entries(byLane).sort((a, b) => b[1].length - a[1].length).slice(0, 8)) console.log(`  ${k}_*  ${v.length} 个`);
console.log('\n描述最长的 5 个（LLM 看到最多字的地方）：');
for (const t of [...tools].sort((a, b) => b.description.length - a.description.length).slice(0, 5))
  console.log(`  ${t.name.padEnd(20)} ${t.description.length} 字 · 入参 ${t.inputKeys.length} 个`);
