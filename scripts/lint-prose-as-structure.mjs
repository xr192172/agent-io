#!/usr/bin/env node
/**
 * lint:prose-as-structure —— **散文不许当结构用**（一条 lint 治一个反复出现的根因）
 *
 * ## 为什么要它（2026-10-26，一天内抓到 5 处同源）
 * 同一个根因犯了五次：`description` / `summary` 是**散文**，却被当成**结构**读：
 *   ① `design-check` 拿 `node.description` 当 path（D1 误判手写节点）
 *   ② `write_gate#nodeFilePath` 回落 `description`（"path 优先"但一半节点没 path）
 *   ③ `node.update` 的 `responsibility` 优先级（旧值永远赢，更新分支失效）
 *   ④ `gen_design_db` 拿 `description` 当 design-db 的**文件名**（整句中文当文件名）
 *   ⑤ `project_task-system-plan` 的 `decision.summary` 里写死过期根路径（权威是 `source_root`）
 * ⇒ 逐个抓不是治法（第五处说明根还在）。**治法是让它一出现就红。**
 *
 * ## 可机器判的判据（只判能判的，判不了的不假装判）
 * A. `type:'file'` 的节点：`description` 像仓库相对路径，但 **`path` 缺失**
 *    ⇒ 错。消费者只能回落散文（②③④ 的温床）。
 * B. `type:'file'` 的节点：`path` **不像**仓库相对路径（含中文 / 盘符 / 反斜杠开头）
 *    ⇒ 错。它会变成 design-db 的**文件名**（④ 的实证）。
 * C. 任一节点的 `decision.summary` 里出现**绝对路径**（`D:/…` 或 `D:\…`）
 *    ⇒ 错。根路径的权威是册顶层 `source_root`；散文里再写一遍必分叉（⑤ 的实证）。
 * D. `title` 里塞了路径（说明位被当成路径用）。
 *
 * E. **写死计数**（2026-10-31 新增，治"读数不带已漂移的硬编码数字"）：
 *    注释 / 文档里出现 `数字 + 量词`（条码 / 个工具 / 道门 / 项 / 条判据 / 张证 / 个用例 / 个文件），
 *    且**附近 3 行内没有**限定词（现算 / 由…打印 / 见 GATES / 别抄数字 / 实测 / 退役 …）⇒ 错。
 *    ★ 判据（本仓已立）：**会随代码增长而变的计数不许写死**（工具数 / 门数 / 判据数 / 文件数 / 证数）；
 *      **闭集枚举**（kind 白名单、错误码家族名）可以写死 ⇒ 本规则只看上面那几种量词。
 *    ★ 为什么它必须存在（2026-10-31 复核实测，每一处都是"当时写对了、后来没跟着改"）：
 *      同一批文档里写 65 条码实为 72、写 55 个工具实为 44、写 8 道门实为 9、
 *      写 346→339 条判据实为 353、写 11 个测试文件实为 38。
 *      写死一次就漂一次 ⇒ 只能靠机器在**写入那一刻**拦住。
 *
 * ★ 判不了的一律**不判**（不假装）：比如"summary 里提到的相对路径是否过期"——那要人看。
 *
 * 用法：node scripts/lint-prose-as-structure.mjs [--json] [--count-only]
 * 退出码：0 = 无问题；1 = 有问题（可当门）；`--count-only` 恒退 0（只量噪音，用于调口径）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DESIGN_DIR = path.join(ROOT, '.agent-io', 'design');
const JSON_OUT = process.argv.includes('--json');
/** 只报命中数、不判红（调口径时用：先量噪音，再决定上线方式） */
const COUNT_ONLY = process.argv.includes('--count-only');

const norm = (s) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
/** 像仓库相对路径：至少一段目录 + 一个扩展名 */
/**
 * 「这个串像不像仓库相对路径」。
 * ★ 2026-11-04（G16）：原正则要求**至少一个目录段**（`^[\w.\-]+/`）⇒ **根目录文件全是误报**
 *   （`AGENTS.md` / `package.json` / `README.md` 都是合法的仓库相对路径，设计册里给它们建 file 节点
 *   却被判「path 不像仓库相对路径」）。误报会把门逼成"关掉它"，那才是真损失 ⇒ 改成"零个或多个目录段"。
 *   ★ 这不是放宽：仍然要求**整串**匹配（词字符 / 点 / 连字符 + 已知扩展名）⇒ 散文、中文、绝对路径照样红。
 */
const looksLikeRepoPath = (s) => /^[\w.\-]+(\/[\w.\-]+)*\.(ts|tsx|mjs|cjs|js|jsx|go|py|java|cs|c|cc|cpp|json|md|sh)$/.test(norm(s));
/** 含中文（文件名不该有） */
const hasCjk = (s) => /[\u4e00-\u9fff]/.test(String(s ?? ''));
/** 含绝对路径（盘符） */
const hasAbsPath = (s) => /[A-Za-z]:[\\/]/.test(String(s ?? ''));

// ════════════════════════════════════════════════════════════════════
// E. 写死计数（会随代码增长而漂的数）
// ════════════════════════════════════════════════════════════════════
/**
 * 会随代码增长而变的计数 + 量词（★ 闭集枚举类量词**不在**此表 —— 那是允许写死的）。
 * ★ 四处刻意收窄（都是**误报源**，不是放宽判据 —— 误报会让门被关掉，那才是真损失）：
 *   · `0` 不判 —— 「0 个用例被执行」这类是**语义零**（判红条件本身），不是"某事的规模读数"；
 *   · 前置 `第` / `≥ ≤ ~ - / 约` 不判 —— 那是**序号**（`T15 第 5 项`）或**阈值 / 区间**
 *     （`≥4 个工具` / `200~516 个文件`）：阈值是判据的一部分（写死才对），区间是量级陈述；
 *   · `项` 后紧跟 `目` 不判 —— `③.5 项目级检查` 里的"项"是"项目"的头一个字。
 */
const COUNT_RE = /(\d+)\s*(条码|个工具|道门|门(?![槛面])|项(?!目)|条判据|判据(?![的])|张证|证(?![明据实]))/g;
/**
 * 命中的数字前面（跳过空白）若是这些字符 ⇒ 不是"数量"，是序号 / 阈值 / 区间 / 编号：
 * `第`（第 6 道门）· `≥ ≤ ~ - / 约`（阈值 / 区间）· `.`（`4.7 门的输入` 这种小节号）
 * · 字母 / `_`（`L2 判据` / `t413` 之类的标识符前缀）· 别的数字（多位数已被正则吃掉）。
 */
const ORDINAL_PREFIX = /[第≥≤~\-/约\d._A-Za-z]\s*$/;
/**
 * 限定词：窗口里出现即说明这个数字**不是被当作现在的真值**（现算口径 / 历史读数 / 已退役对象）。
 * ★ 判据是"读者会不会拿它当此刻的事实" —— 有这些词就不是。
 */
const QUALIFIERS = [
  '现算', '现取', '现渲染', '现打印', '自己打印', '本脚本打印',
  '见 `GATES`', '见 GATES', '别抄数字', '不抄数字', '别在这里抄', '不写死',
  '实测', '退役', '已删', '回炉',
];
/** 窗口 = 命中行 ±3 行（同一文件内） */
const WINDOW = 3;
/**
 * 整份文件豁免：**它们的存在理由就是"记下当时的样子"**（台账 / 逐日读数 / 工作区笔记）。
 * ★ 判据 = 历史快照不叫漂移；只有"声称是现状"的散文才不许带死的计数。
 */
const EXEMPT_FILES = [
  /^docs[\\/]RETIRED\.md$/i,
  /^docs[\\/]DECISIONS\.md$/i,
  /(^|[\\/])memory[\\/][^\\/]*\.md$/i,
  /(^|[\\/])\.workbuddy[\\/]/i,
];
const isExempt = (rel) => EXEMPT_FILES.some((re) => re.test(rel));

/**
 * 注释行抽取：`.ts` / `.mjs` / `.js` 只取**注释**（`//` 行与块注释内部），`.md` 整篇都是散文。
 * ★ 只扫注释的理由：代码行里的数字由代码自己用（不是"给读者看的读数"）。
 */
function commentLinesOf(abs, ext) {
  const raw = fs.readFileSync(abs, 'utf8');
  const lines = raw.split(/\r?\n/);
  if (ext === '.md') return lines.map((text, i) => ({ line: i + 1, text }));
  const out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (inBlock) {
      out.push({ line: i + 1, text });
      if (text.includes('*/')) inBlock = false;
      continue;
    }
    const t = text.trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) {
      out.push({ line: i + 1, text });
      if (t.startsWith('/*') && !t.includes('*/')) inBlock = true;
    }
  }
  return out;
}

/** 扫一个文件 ⇒ 写死计数命中清单 */
function scanHardcodedCounts(rel, abs) {
  const ext = path.extname(rel).toLowerCase();
  const comments = commentLinesOf(abs, ext);
  const isMd = ext === '.md';
  const allLines = isMd ? null : fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const hits = [];
  for (const { line, text } of comments) {
    COUNT_RE.lastIndex = 0;
    const m = COUNT_RE.exec(text);
    if (!m) continue;
    if (m[1] === '0') continue; // 语义零（「0 个用例被执行」是判红条件，不是规模读数）
    if (ORDINAL_PREFIX.test(text.slice(0, m.index))) continue; // 序号 / 阈值 / 区间 / 小节号，不是数量
    // 行首的裸数字 + 量词 = **枚举条目的编号**（如步骤清单每行开头的序号），不是"有多少" ⇒ 不判
    const lead = text.length - text.replace(/^\s*(?:\/\/+|\/\*+|\*+)?\s*/, '').length;
    if (m.index === lead) continue;
    const lo = Math.max(1, line - WINDOW);
    const hi = line + WINDOW;
    const win = isMd
      ? comments.filter((l) => l.line >= lo && l.line <= hi).map((l) => l.text).join('\n')
      : allLines.slice(lo - 1, hi).join('\n');
    if (QUALIFIERS.some((w) => win.includes(w))) continue;
    hits.push({ line, hit: m[0], text: text.trim().slice(0, 140) });
  }
  return hits;
}

/**
 * 待扫范围（相对 ROOT 的 posix 路径）：`docs/*.md`（顶层）+ `scripts/*.mjs`（顶层）。
 *
 * ★ 为什么**不扫 `src/`**（2026-10-31 实测定的口径，不是漏了）：
 *   在 `src/**​/*.ts` 的**注释**上跑同一条规则，命中 41 处，其中绝大多数是**行为示例 / 历史叙事**：
 *   `satisfied/written_files[1]` 举例、"落盘 2 个文件"、"此前硬写在 130 个文件里"、
 *   "0 个文件 ⇒ N/A"（语义零）…… ⇒ 命中数远超可维护阈值，**门会因此被关掉**，那才是真损失。
 *   真正该治的那一类（各线头注 `X 线（N 个工具）`）确实在 `src/` 里，且**已经漂了**；
 *   但改 `src/` 必须走设计线（AGENTS-RULES 0.1），不属于本 lint 的管辖动作 ⇒
 *   当前口径 = **文档与脚本先治住**，`src/` 的线头注计数由「改那条线时顺手改成现算」处理。
 *   （复算：`node scripts/lint-prose-as-structure.mjs --count-only` 会打印两侧命中数。）
 *
 * ★ 刻意不下钻 `docs/`：子目录是计划稿 / 归档，属"当时的读数"。
 */
function targets() {
  const out = [];
  const walk = (abs, relBase, recursive, filter) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const rel = `${relBase}/${e.name}`.replace(/\\/g, '/');
      if (e.isDirectory()) {
        if (recursive) walk(path.join(abs, e.name), rel, recursive, filter);
        continue;
      }
      if (filter(e.name)) out.push(rel);
    }
  };
  const dir = (d, recursive, filter) => {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs, d, recursive, filter);
  };
  dir('docs', false, (n) => n.endsWith('.md'));
  dir('scripts', false, (n) => n.endsWith('.mjs'));
  return out;
}

const scanned = targets();
const countProblems = [];
for (const rel of scanned) {
  if (isExempt(rel)) continue;
  for (const h of scanHardcodedCounts(rel, path.join(ROOT, rel))) {
    countProblems.push({
      rule: 'E',
      file: rel,
      line: h.line,
      msg: `写死计数「${h.hit}」⇒ 改成"现算"或指向产出它的命令/脚本（原文：${h.text}）`,
    });
  }
}

// ════════════════════════════════════════════════════════════════════
// A–D. 设计册里的散文当结构
// ════════════════════════════════════════════════════════════════════
const problems = [];
if (fs.existsSync(DESIGN_DIR)) {
  for (const f of fs.readdirSync(DESIGN_DIR).filter((x) => x.endsWith('.dsl.json')).sort()) {
    const feature = f.replace(/\.dsl\.json$/, '');
    const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
    for (const n of dsl.geometry?.nodes ?? []) {
      const desc = norm(n.description);
      const p = norm(n.path);
      const isFile = n.type === 'file';

      // A：description 像路径、但 path 缺失
      if (isFile && !p && looksLikeRepoPath(desc)) {
        problems.push({ feature, id: n.id, rule: 'A', msg: `description 像路径（${desc}）但 path 缺失 ⇒ 消费者只能回落散文` });
      }
      // B：path 不像仓库相对路径
      if (isFile && p && (!looksLikeRepoPath(p) || hasCjk(p) || hasAbsPath(p))) {
        problems.push({ feature, id: n.id, rule: 'B', msg: `path 不像仓库相对路径（${p}）⇒ 会变成 design-db 文件名` });
      }
      // C：summary 里出现绝对路径
      const sum = String(n.decision?.summary ?? '');
      if (hasAbsPath(sum)) {
        const hit = (sum.match(/[A-Za-z]:[\\/][^\s，。）)]*/g) ?? []).slice(0, 2).join(' ');
        problems.push({ feature, id: n.id, rule: 'C', msg: `decision.summary 里写死绝对路径（${hit}）⇒ 权威是 source_root` });
      }
      // D：title 里塞了路径（说明位被当成路径用）
      // ★ 2026-10-27（T-#35 修正）：删 Node.description 时我一度把两处**路径值**改存 `title`
      //   （import_project 的 doc 节点、live_render 的 file 节点）—— 语义上错：title 是"人读标题"。
      //   ⇒ 加这条规则：说明位（title）里出现路径形状 ⇒ 红。**这就是"改错了怎么办"的结构答案**：
      //     不靠我逐处判对，靠门在下一轮当场指出来。
      const t = norm(n.title);
      if (t && looksLikeRepoPath(t)) {
        problems.push({ feature, id: n.id, rule: 'D', msg: `title 里是路径形状（${t}）⇒ 说明位被当成路径用；路径该住 path` });
      }
    }
  }
}

const all = [...problems, ...countProblems];

if (JSON_OUT) {
  const nFeatures = fs.existsSync(DESIGN_DIR) ? fs.readdirSync(DESIGN_DIR).filter((x) => x.endsWith('.dsl.json')).length : 0;
  console.log(JSON.stringify({ checked_features: nFeatures, checked_files: scanned.length, problems, hardcoded_counts: countProblems }, null, 2));
} else if (COUNT_ONLY) {
  console.log(`[lint:prose-as-structure] 写死计数：${countProblems.length} 处（只报不判，扫了 ${scanned.length} 个文件）`);
  for (const p of countProblems) console.log(`  · ${p.file}:${p.line}  ${p.msg}`);
} else if (all.length === 0) {
  console.log('[lint:prose-as-structure] ✓ 无问题（散文没有当结构用；注释/文档里也没有写死的计数）');
} else {
  console.log(`[lint:prose-as-structure] ✗ ${all.length} 处：散文当结构 ${problems.length} 处 · 写死计数 ${countProblems.length} 处`);
  for (const p of all.slice(0, 40)) {
    console.log(p.rule === 'E' ? `  · [E] ${p.file}:${p.line}\n      ${p.msg}` : `  · [${p.rule}] ${p.feature}/${p.id}\n      ${p.msg}`);
  }
  if (all.length > 40) console.log(`  …另有 ${all.length - 40} 处`);
}
// ★ `--count-only` 只报不拦（调口径期用）；上线形态 = 有命中即退 1
process.exit(COUNT_ONLY ? 0 : all.length ? 1 : 0);
