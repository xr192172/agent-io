#!/usr/bin/env node
/**
 * agent-io MCP 分发安装器（路线图序号 12：多平台插件分发）
 *
 * 自动为各主流 MCP client 写入 agent-io 的 MCP server 配置，
 * 免去手工编辑 JSON/TOML 的繁琐与格式错误。
 *
 * 用法（在 agent-io 根目录）：
 *   node scripts/install_mcp.mjs                 # 补正确键 + 清旧品牌键 + 修陈旧条目（只碰"已安装"的 client）
 *   node scripts/install_mcp.mjs --list          # 列出各平台状态（六态），不写
 *   node scripts/install_mcp.mjs --dry-run       # 打印将写入的内容，不写
 *   node scripts/install_mcp.mjs --check         # 只检查状态（默认动作的预演），不写
 *   node scripts/install_mcp.mjs --target claude # 只处理指定平台
 *   node scripts/install_mcp.mjs --server <path> # 覆盖 server 入口（默认 <root>/dist/src/presentation/mcp/server.js）
 *
 * 平台支持：
 *   claude   ~/.claude.json                     (Claude Code / Claude Desktop 共用 user 级)
 *   cursor   ~/.cursor/mcp.json                 (Cursor 用户级)
 *   vscode   .vscode/mcp.json                   (VS Code workspace 级，相对项目根)
 *   codex    ~/.codex/config.toml               (Codex CLI，TOML 格式)
 *   copilot  ~/.github/copilot-mcp.json         (GitHub Copilot 用户级)
 *   gemini   ~/.gemini/settings.json            (Gemini CLI)
 *   windsurf ~/.codeium/windsurf/mcp_config.json(Windsurf 用户级)
 *   cline    ~/.cline/mcp_settings.json         (Cline 扩展)
 *   trae     <root>/.trae/mcp.json              (TRAE 项目级 MCP，需在设置中开启「启用项目级 MCP」)
 *
 * 安全：所有写入前备份原文件为 <file>.agent-io.bak；合并时保留已有其他 server；
 *      配置文件 JSON 解析失败时**不静默覆盖**。
 *
 * ★★ 2026-10-05 三处增强（起因：本仓自己的 `.trae/mcp.json` **静默失效** —— 旧品牌键 `design-canvas`
 *   + 入口 `dist/src/server.js`（★ **该路径不存在**，真实入口在 `dist/src/presentation/mcp/`））：
 *   ① **换名即清旧键**：`LEGACY_KEYS` 里的键从**同一层删除**（TOML 同理）。
 *      ★ 病根：旧实现只 `cur[serverKey] = …` —— **只加同名键、不删别的键** ⇒ 改一次名就留一个死键，
 *        而且它**不参与"已配置"判定** ⇒ **永远没人发现**（判据分叉的又一实例）。
 *   ② **只为"已安装"的 client 写入**：旧实现无条件 `mkdirSync` ⇒ 会给**没装**的 client
 *      在用户主目录**造目录**。新增 `probe`（探测点，任一存在即算已装）；`probe: null` =
 *      项目级配置（`.trae` / `.vscode`），恒可写。
 *   ③ **陈旧条目会被检出并修**：旧实现 `already ⇒ skip` ⇒ 一个**写错入口**的 `agent-io`
 *      永远不会被修。改为逐字段比对期望值（`${workspaceFolder}` 归一后比）⇒ 不同即 `stale` 并重写。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 定位项目根（脚本在 <root>/scripts/ 下） ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
/**
 * ★ 默认 server 入口 = `dist/src/presentation/mcp/server.js`（与 `package.json` 的 `bin` 同源）。
 *   ★ 旧值是 `dist/src/server.js` —— **该路径从来不存在** ⇒ 写进 client 配置后**静默失效**
 *     （本仓 `.trae/mcp.json` 就是这么坏的；属 T23「仓外引用没有判据」那一族）。
 */
const DEFAULT_SERVER = path.join(ROOT, 'dist', 'src', 'presentation', 'mcp', 'server.js');

// TRAE 专用：以字面字符串保留 ${workspaceFolder}，让 MCP 配置随项目根迁移（git worktree / 换目录）
const WF = '${workspaceFolder}';

// ── 命令行参数 ──
const args = process.argv.slice(2);
const parg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const LIST = args.includes('--list');
const DRY = args.includes('--dry-run');
const CHECK = args.includes('--check');
const TARGET = parg('--target');
const SERVER = parg('--server') ?? DEFAULT_SERVER;

// ── 平台定义 ──
// 每个平台：name=显示名, configPath=配置文件绝对路径, kind=json|toml,
//           keyPath=server 列表所在的对象路径（点分），serverKey=server 名,
//           legacyKeys=旧品牌键（写入时从**同一层删除**，见文件头 ①）,
//           probe=已安装探测点（数组：**任一存在**即算已装；`null` = 项目级配置，恒可写）
const HOME = os.homedir();

/** ★ 本仓的**旧品牌串**（AGENTS.md 明令不许新增）—— 换名时从各 client 配置里清掉，别留死键 */
const LEGACY_KEYS = ['design-canvas'];

/** 生成 JSON 型配置的写入块（保持已有 server） */
function jsonPatch(existing, keyPath, serverKey, serverValue) {
  const root = existing && typeof existing === 'object' ? existing : {};
  const segs = (keyPath || '').split('.').filter(Boolean);
  let cur = root;
  for (const s of segs) {
    if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {};
    cur = cur[s];
  }
  if (typeof cur[serverKey] !== 'object' || cur[serverKey] === null) cur[serverKey] = {};
  cur[serverKey] = { ...cur[serverKey], ...serverValue };
  return root;
}

// ── TOML：`[mcp_servers.<name>]` **表**风格（★ Codex 用的是这个，不是 `[[mcp_servers]]` 数组风格）──

/** 表格头行：`[xxx]` / `[[xxx]]`（独占一行即表头） */
const TOML_TABLE_LINE = /^\s*\[\[?[^\]\r\n]+\]\]?\s*$/;

/** 把 TOML 切成 `{ header, lines }` 段（首段 `header: null` = 文件头） */
function splitTomlSections(text) {
  const out = [];
  let cur = { header: null, lines: [] };
  for (const ln of String(text ?? '').split(/\r?\n/)) {
    if (TOML_TABLE_LINE.test(ln)) {
      out.push(cur);
      cur = { header: ln.trim(), lines: [] };
    } else {
      cur.lines.push(ln);
    }
  }
  out.push(cur);
  return out;
}

/** `[a.b]` → `a.b`（非表头返回 null） */
function tomlTableName(header) {
  if (!header) return null;
  return header.replace(/^\[+/, '').replace(/\]+$/, '').trim();
}

/** 该表名是不是「某个 mcp server 项」（含其子表，如 `.env`） */
function isMcpServersEntry(name, key) {
  if (!name) return false;
  return name === `mcp_servers.${key}` || name.startsWith(`mcp_servers.${key}.`);
}

/** 取某个表的正文（不存在返回 ''） */
function tomlSectionBody(text, name) {
  for (const sec of splitTomlSections(text)) {
    if (tomlTableName(sec.header) === name) return sec.lines.join('\n');
  }
  return '';
}

/** 极简 TOML 赋值解析（★ 只认本脚本自己会写的 `k = v` 单行形态，不做通用 TOML 解析） */
function parseTomlAssignments(body) {
  const out = {};
  for (const ln of body.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(ln);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** 去掉 TOML 标量两侧引号（★ 基本串 `"…"` 要**反转义**，字面串 `'…'` 原样） */
function tomlScalar(v) {
  const s = String(v ?? '').trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  if (s.startsWith('"') && s.endsWith('"')) return tomlUnescape(s.slice(1, -1));
  return s;
}

/** TOML 基本串的转义还原（只处理本脚本可能写出的那几个） */
function tomlUnescape(s) {
  return s.replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
}

/** 内联字符串数组 → 字符串数组（两种引号都吃） */
function tomlStringArray(v) {
  const out = [];
  for (const m of String(v ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)) {
    out.push(m[1] !== undefined ? m[1] : tomlUnescape(m[2] ?? ''));
  }
  return out;
}

/**
 * 把一个值写成 TOML 标量。
 * ★★ 为什么用**字面串**（`'…'`）而不 `JSON.stringify`（实测踩过）：Windows 路径经 JSON 转义后是
 *   `"D:\\project\\…"`，那是**合法的 TOML 基本串**（Codex 读出来是对的），但**比对侧必须反转义**才知道
 *   它等于 `D:\project\…` —— 我第一版没反转义 ⇒ **每次都判 stale、每次重写**（不幂等）。
 *   ⇒ 按该文件**自己的惯例**（`~/.codex/config.toml` 里 Windows 路径就是 `'…'`）写字面串：无需转义、
 *     也不会与"期望值"产生两种写法。★ 仅当值里含 `'`（路径里极罕见）才退回基本串。
 */
function tomlQuote(s) {
  const str = String(s);
  return str.includes("'") ? JSON.stringify(str) : `'${str}'`;
}

/** 现有 `[mcp_servers.<key>]` 与期望是否等价（陈旧判定的 TOML 侧） */
function sameTomlServer(text, p) {
  const kv = parseTomlAssignments(tomlSectionBody(text, `mcp_servers.${p.serverKey}`));
  const want = serverValueOf(p);
  if (!sameCommand(tomlScalar(kv.command), want.command)) return false;
  const got = tomlStringArray(kv.args);
  return got.length === want.args.length && got.every((x, i) => normForCompare(x) === normForCompare(want.args[i]));
}

/**
 * ★ TOML 补丁：**按"表段"增删**（不是旧那条"从 `[[mcp_servers]]` 吞到下一个"的正则）。
 *
 * ★★ 为什么必须换掉旧写法（2026-10-05 实测，两个独立的洞）：
 *   ㈠ `~/.codex/config.toml` 用的是 `[mcp_servers.node_repl]` **表**风格，**压根没有 `[[mcp_servers]]`**
 *      ⇒ 旧正则匹配 **0 段**，然后**原样追加**一个 `[[mcp_servers]]` 块 ⇒ 写进去的是
 *      **Codex 不认的形状**（旧注释自称"Codex：`[[mcp_servers]]` 数组风格" —— 与实测不符）。
 *   ㈡ 旧正则 `[\s\S]*?(?=…|$)` 会**从表头一直吞到 EOF** ⇒ 若该文件后面还有别的段，**一起吞掉**（改坏）。
 *   ⇒ 判据：**TOML 的段边界 = 行首的表头行**，按行切才是对的（结构问题按结构解，不用正则赌）。
 *   ★ 同时把 `LEGACY_KEYS` 的段一并剔掉 —— 与 JSON 侧 `stripLegacyKeys` 同一条纪律：**换名即清旧键**。
 */
function patchToml(content, serverKey, serverValue) {
  const shouldDrop = (name) =>
    isMcpServersEntry(name, serverKey) || LEGACY_KEYS.some((k) => isMcpServersEntry(name, k));
  const kept = splitTomlSections(content).filter((sec) => {
    const name = tomlTableName(sec.header);
    if (name === null) return sec.lines.some((l) => l.trim() !== ''); // 纯空文件头丢掉
    return !shouldDrop(name);
  });
  const body = kept
    .map((sec) => (sec.header === null ? sec.lines : [sec.header, ...sec.lines]).join('\n'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const block =
    `[mcp_servers.${serverKey}]\n` +
    `command = ${tomlQuote(serverValue.command)}\n` +
    `args = [${(serverValue.args ?? []).map(tomlQuote).join(', ')}]\n`;
  return body ? `${body}\n\n${block}` : block;
}

const PLATFORMS = [
  {
    name: 'claude',
    label: 'Claude Code / Desktop',
    configPath: path.join(HOME, '.claude.json'),
    kind: 'json',
    keyPath: 'mcpServers',
    serverKey: 'agent-io',
    probe: [path.join(HOME, '.claude'), path.join(HOME, '.claude.json')],
  },
  {
    name: 'cursor',
    label: 'Cursor',
    configPath: path.join(HOME, '.cursor', 'mcp.json'),
    kind: 'json',
    keyPath: 'mcpServers',
    serverKey: 'agent-io',
    probe: [path.join(HOME, '.cursor')],
  },
  {
    name: 'vscode',
    label: 'VS Code',
    configPath: path.join(ROOT, '.vscode', 'mcp.json'),
    kind: 'json',
    keyPath: 'servers',
    serverKey: 'agent-io',
    probe: [path.join(HOME, '.vscode'), path.join(HOME, '.vscode-cli')],
  },
  {
    name: 'codex',
    label: 'Codex CLI',
    configPath: path.join(HOME, '.codex', 'config.toml'),
    kind: 'toml',
    keyPath: '',
    serverKey: 'agent-io',
    probe: [path.join(HOME, '.codex')],
  },
  {
    name: 'copilot',
    label: 'GitHub Copilot',
    configPath: path.join(HOME, '.github', 'copilot-mcp.json'),
    kind: 'json',
    keyPath: 'mcpServers',
    serverKey: 'agent-io',
    probe: [path.join(HOME, '.github', 'copilot-mcp.json'), path.join(HOME, '.copilot')],
  },
  {
    name: 'gemini',
    label: 'Gemini CLI',
    configPath: path.join(HOME, '.gemini', 'settings.json'),
    kind: 'json',
    keyPath: 'mcpServers',
    serverKey: 'agent-io',
    probe: [path.join(HOME, '.gemini')],
  },
  {
    name: 'windsurf',
    label: 'Windsurf',
    configPath: path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
    kind: 'json',
    keyPath: 'mcpServers',
    serverKey: 'agent-io',
    probe: [path.join(HOME, '.codeium', 'windsurf'), path.join(HOME, '.codeium')],
  },
  {
    name: 'cline',
    label: 'Cline',
    configPath: path.join(HOME, '.cline', 'mcp_settings.json'),
    kind: 'json',
    keyPath: 'mcpServers',
    serverKey: 'agent-io',
    probe: [path.join(HOME, '.cline')],
  },
  {
    name: 'trae',
    label: 'TRAE（项目级）',
    configPath: path.join(ROOT, '.trae', 'mcp.json'),
    kind: 'json',
    keyPath: 'mcpServers',
    serverKey: 'agent-io',
    // ★ 项目级配置：`.trae/` 就在本仓里 ⇒ 不依赖"客户端装没装"，恒可写
    probe: null,
    // TRAE 要求 command 不含空格（Windows node 位于 C:\Program Files 下有空格），故用 PATH 内 node
    command: 'node',
    // 用 ${workspaceFolder} 相对项目根：git worktree / 目录迁移时仍指向当前项目 dist
    args: [`${WF}/dist/src/presentation/mcp/server.js`],
  },
];

const baseServerValue = {
  command: process.execPath || 'node',
  args: [SERVER],
};

/** 平台级 serverValue：部分平台（如 TRAE）要求 command 不含空格，可覆盖 command/args */
function serverValueOf(p) {
  return {
    ...baseServerValue,
    ...(p.command ? { command: p.command } : {}),
    ...(p.args ? { args: p.args } : {}),
  };
}

// ── 期望值 / 归一 / 比较（**纯函数**：`--dry-run` 与 `--check` 复用，无副作用） ──

/**
 * ★ 归一后再比：`${workspaceFolder}` 与"本仓绝对路径"是**同一语义的两种写法**
 *   （TRAE 用字面量以便随项目迁移；别的平台写绝对路径）⇒ 比"是否陈旧"时必须先折到同一形态，
 *   否则会**误报 stale 并每次重写**（这正是"判据分叉"最容易长出来的地方）。
 */
function normForCompare(v) {
  const s = v == null ? '' : String(v);
  return s
    .split('\\').join('/')
    .replace(/\$\{workspaceFolder\}/g, WF)
    .replace(ROOT.split('\\').join('/'), WF);
}

/** command 比较：`node` 与 `C:/…/node.exe` 视为**同一个可执行的不同写法**（避免无意义重写） */
function sameCommand(a, b) {
  const na = normForCompare(a);
  const nb = normForCompare(b);
  if (na === nb) return true;
  const base = (s) => s.split('/').pop().replace(/\.exe$/i, '').toLowerCase();
  return base(na) === base(nb);
}

/** 现有 server 块与期望值是否等价（只比 `command` + `args`；其余字段不动） */
function sameServer(cur, want) {
  if (!cur || typeof cur !== 'object') return false;
  if (!sameCommand(cur.command, want.command)) return false;
  const a = Array.isArray(cur.args) ? cur.args.map(normForCompare) : [];
  const b = Array.isArray(want.args) ? want.args.map(normForCompare) : [];
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 该 client 是否已安装（`probe == null` = 项目级配置 ⇒ 恒真） */
function isInstalled(p) {
  if (p.probe == null) return true;
  return p.probe.some((q) => fs.existsSync(q));
}

// ── 通用写入 ──
function writeConfig(p, outText) {
  const dir = path.dirname(p.configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(p.configPath)) {
    fs.copyFileSync(p.configPath, `${p.configPath}.agent-io.bak`);
  }
  fs.writeFileSync(p.configPath, outText, 'utf-8');
}

function present(v) {
  const s = v;
  if (typeof s === 'string') return s.length > 0;
  return s != null;
}

/** 取 `keyPath` 处的对象；不存在返回 null */
function atKeyPath(parsed, keyPath) {
  const segs = (keyPath || '').split('.').filter(Boolean);
  let cur = parsed;
  for (const s of segs) {
    cur = cur?.[s];
    if (typeof cur !== 'object' || cur === null) return null;
  }
  return typeof cur === 'object' && cur !== null ? cur : null;
}

/** ★ 从 `keyPath` 处**删除**旧品牌键（返回被删掉的键名）—— 见文件头 ① */
function stripLegacyKeys(parsed, keyPath) {
  const holder = atKeyPath(parsed, keyPath);
  if (!holder) return [];
  const removed = [];
  for (const k of LEGACY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(holder, k)) {
      delete holder[k];
      removed.push(k);
    }
  }
  return removed;
}

/**
 * 干跑用：**这次会删掉哪些旧键**（在一次性副本上算，不动原文件）。
 * ★ 为什么 `--dry-run` 不整份打印目标文件：`~/.claude.json` 之类可能有**数 MB** 历史 ⇒ 打印即刷屏。
 *   只有"将要写的 server 块 + 将要删的旧键"才是要人审的那部分。
 */
function removedLegacyOf(p, text) {
  if (!present(text ?? '')) return [];
  if (p.kind === 'toml') return LEGACY_KEYS.filter((k) => text.includes(`name = ${JSON.stringify(k)}`));
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    return stripLegacyKeys(parsed, p.keyPath);
  } catch {
    return [];
  }
}

function buildOutput(p, existingText) {
  const sv = serverValueOf(p);
  if (p.kind === 'toml') {
    return patchToml(existingText ?? '', p.serverKey, sv);
  }
  let parsed = null;
  const raw = (existingText ?? '').replace(/^\uFEFF/, ''); // 容忍 UTF-8 BOM（Windows 常见）
  if (present(raw)) {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // 损坏的 JSON 不静默覆盖——保留原文件，让用户手动修复
      console.error(`  ✗ ${p.label.padEnd(22)} 配置文件 JSON 解析失败，跳过写入（请手动修复 ${p.configPath}）`);
      return null;
    }
  }
  stripLegacyKeys(parsed, p.keyPath); // ★ 换名即清旧键（见文件头 ①）
  const patched = jsonPatch(parsed, p.keyPath, p.serverKey, sv);
  return JSON.stringify(patched, null, 2) + '\n';
}

/**
 * ★ 状态机（**六态**）—— 每一态的判定都要能解释"为什么它该/不该被写"：
 *   `not-installed` 没装该 client（`probe` 全不存在）⇒ **跳过，连目录都不建**（见文件头 ②）
 *   `corrupt`       配置在但解析不了 ⇒ **跳过**（不静默覆盖，既有行为）
 *   `missing`       配置不存在 ⇒ 待创建
 *   `present`       配置在、但**还没有** `agent-io` 键 ⇒ 待补
 *   `stale`         有 `agent-io` 键但**与期望不等**，或**残留旧品牌键** ⇒ 待重写（见文件头 ③）
 *   `configured`    有 `agent-io` 键、与期望等价、且无旧键 ⇒ 跳过
 */
function statusOf(p) {
  if (!isInstalled(p)) return { state: 'not-installed', text: '' };
  if (!fs.existsSync(p.configPath)) return { state: 'missing', text: '' };
  let text;
  try {
    text = fs.readFileSync(p.configPath, 'utf-8').replace(/^\uFEFF/, ''); // 容忍 UTF-8 BOM
  } catch {
    return { state: 'corrupt', text: '' };
  }
  if (p.kind === 'toml') {
    const names = new Set(splitTomlSections(text).map((s) => tomlTableName(s.header)).filter(Boolean));
    if (LEGACY_KEYS.some((k) => names.has(`mcp_servers.${k}`))) return { state: 'stale', text };
    if (!names.has(`mcp_servers.${p.serverKey}`)) return { state: 'present', text };
    return { state: sameTomlServer(text, p) ? 'configured' : 'stale', text };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'corrupt', text };
  }
  const holder = atKeyPath(parsed, p.keyPath);
  const hasLegacy = LEGACY_KEYS.some((k) => holder && Object.prototype.hasOwnProperty.call(holder, k));
  const cur = holder ? holder[p.serverKey] : undefined;
  if (!cur) return { state: hasLegacy ? 'stale' : 'present', text };
  if (hasLegacy || !sameServer(cur, serverValueOf(p))) return { state: 'stale', text };
  return { state: 'configured', text };
}

const STATE_MARK = {
  configured: '✓',
  present: '•',
  stale: '!',
  missing: '·',
  'not-installed': '–',
  corrupt: '⚠',
};
const STATE_LABEL = {
  configured: '已配置（与期望等价）',
  present: '待补 agent-io 键',
  stale: '★ 陈旧 / 残留旧品牌键 ⇒ 待重写',
  missing: '配置不存在 ⇒ 待创建',
  'not-installed': '未检测到该 client ⇒ 跳过',
  corrupt: '★ 配置解析失败 ⇒ 跳过（不覆盖）',
};

// ── 主流程 ──
const targets = TARGET
  ? PLATFORMS.filter((p) => p.name === TARGET)
  : PLATFORMS;
if (TARGET && targets.length === 0) {
  console.error(`未知平台 "${TARGET}"。可用：${PLATFORMS.map((p) => p.name).join(', ')}`);
  process.exit(1);
}

console.log(`agent-io MCP 分发（server: ${SERVER}）\n`);

const tally = { configured: 0, present: 0, stale: 0, missing: 0, 'not-installed': 0, corrupt: 0 };
let written = 0;
/** ★ 与 `written` 分开：`--dry-run` 时 `written` 恒 0，但"将写入几个"要如实报（旧实现在这里骗过一次） */
let wouldWrite = 0;

for (const p of targets) {
  const st = statusOf(p);
  tally[st.state] = (tally[st.state] ?? 0) + 1;

  if (LIST || CHECK) {
    console.log(`  ${STATE_MARK[st.state]} ${p.label.padEnd(22)} ${STATE_LABEL[st.state]}`);
    console.log(`      ${p.configPath}`);
    continue;
  }

  // 不写的两种：没装的、坏了的（前者连目录都不建，后者不静默覆盖）
  if (st.state === 'not-installed' || st.state === 'corrupt') {
    console.log(`  ${STATE_MARK[st.state]} ${p.label.padEnd(22)} ${STATE_LABEL[st.state]}`);
    continue;
  }

  if (st.state === 'configured') {
    console.log(`  ✓ ${p.label.padEnd(22)} 已配置（等价），跳过`);
    continue;
  }

  const out = buildOutput(p, st.text);
  if (!out) continue; // JSON 解析失败，buildOutput 已报错
  wouldWrite++;
  if (DRY) {
    const sv = serverValueOf(p);
    console.log(`  ! ${p.label.padEnd(22)} [dry-run] ${p.configPath}（${STATE_LABEL[st.state]}）`);
    console.log(`      将写 server 块: ${JSON.stringify({ command: sv.command, args: sv.args })}`);
    for (const k of removedLegacyOf(p, st.text)) console.log(`      将删旧品牌键: ${k}`);
    continue;
  }

  writeConfig(p, out);
  written++;
  console.log(`  ✓ ${p.label.padEnd(22)} 已写入 ${p.configPath}（${STATE_LABEL[st.state]}）`);
}

console.log('');
const summary = Object.entries(tally)
  .filter(([, n]) => n > 0)
  .map(([k, n]) => `${k} ${n}`)
  .join(' · ');
if (LIST || CHECK) {
  console.log(`共 ${targets.length} 个平台：${summary}${CHECK ? '（未写任何文件）' : ''}`);
} else if (DRY) {
  console.log(`dry-run 完成：将写入 ${wouldWrite} 个平台（未改动任何文件）｜${summary}`);
} else {
  console.log(`完成：写入 ${written} 个 ｜${summary}`);
  if (written > 0) {
    console.log('提示：原配置文件已备份为 <file>.agent-io.bak；重启对应 client 生效。');
  }
}
