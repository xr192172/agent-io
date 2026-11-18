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
 * F. **文档结构守卫**（2026-11-05 新增，依据 AGENTS.md **0.2** 的「判据 / 证据 / 守卫」三分表）：
 *    由下面这张 `DOC_STRUCTURE_GUARDS` 声明表驱动，逐行判 `mustHave` / `mustNot` / `minCount` / `columns`。
 *    ★ **为什么住 lint、不占判据位**：它红了以后**该改的是文档**（文件结构退化了），不是源码
 *      ⇒ 按 0.2 的分界它是**守卫**。放进 `decision.expectations` 会让它被下游当成
 *      「规则被执行了」的凭证 —— 那正是 0.2 第 ④ 步要避免的。
 *    ★ **表驱动，不许一段 if 一个文件**：加一个被守卫的文件 = 加一行（0.25②③）。
 *    ★ **下限要软、上限才硬**：`minCount` 只给**下限**（删空 / 截断才红），
 *      合法合并（0.25② 要求的事）不误红；`mustHave` 只钉**节号前缀 / 结构串**，不钉标题措辞。
 *    ★ `columns` 走**唯一**的 md 表格解析器 `scripts/lib/md-table.mjs`（0.18④：结构载体不许就地 split）。
 *
 * G. **读数脚本的分层守卫**（2026-11-06 R73 新增）：读数脚本有没有消费者、每道自动门验的是什么，
 *    由 `scripts/lib/script_tiers.mjs` 现算（唯一实现），本文件的 `checkScriptTierGuards` 只把它的
 *    `problems` 收进同一条退出码。★ 为什么它是守卫不是判据：红了改的是**声明**（接线 / 登记表条目），
 *    不是源码逻辑（AGENTS 0.2 的分界）。详见该函数上方注释。
 *
 * H. **自指度量污染**（2026-11-06 R74 新增）：**计数型判据的载体包含了它自己数的那串文本** ⇒
 *    判据把自己抬高一格，而读数照样是绿的。
 *    ★★ 边界（0.17①，2026-11-06 复核后**逐字改准**）：本条的判别域是「**仓内代码里的文本计数**」
 *    （`COUNT_POINT_FORMS` 那六条形态：split / match / matchAll / filter-includes）。
 *    **不覆盖** R73 那次事故的真实形态 —— 那是**手工在 shell 里 `grep -c` 数一个字面串**
 *    （载体是 `.agent-io/scratch/` 下的一次性探针，不进仓、仓内没有载体）⇒ 静态扫 `scripts/` + `src/`
 *    原理上判不了；而全仓 `execSync('grep -c …')` 这种形态实测 **0 处**，为它扩判别域只会得到一条
 *    永久 0 分母的规则（0.16 / 0.25③：那不算检测点）。
 *    ⇒ R73 那类事故的防线**不是本条**，是 **0.20**（同一事实有结构化权威就用权威）：
 *      门数的权威是 `GATES.filter((g) => g.kind === 'gate').length`，**不是**文本 grep。
 *      ★ 实测这正好解释 R73：文本 `kind: 'gate'` 数出来是 **15**，结构化真值是 **14**
 *      （`tsGate` 的两个分支各带一行 `kind: 'gate'`）⇒ **那把量具本来就是错的**，15→16 只是它自己的抖动。
 *      ⇒ R73 的真正教训不是"注释抬高了计数"，是「**用文本数结构化事实本来就是错的**」。
 *    ⇒ 本条的正当职责 = 抓**回归**：谁把结构化计数改回文本计数，谁就撞上本条
 *      （六条形态真能红，`tests/p0_self_referential_count.test.ts` ①② 有正向 + 消融证明）。
 *    判据与其余边界逐条写在 `checkSelfPollutingCounts` 上方；**只治计数型**，不做「注释里不许出现代码」那种普遍规则。
 *
 * I. **悬空文档引用**（2026-11-17 · P0-3，审计 `ea-func-ds-1` §1.1 第 3 条）：
 *    **文案里出现的 `docs/*.md` 必须真的存在**。
 *    ★ 事故：三处"照它做"的指引都指 `docs/adding-a-language.md`，而该文件早在 `6f02c75b` 就被删了
 *      （`git ls-tree HEAD` 0 命中）⇒ 读的人照做时拿不到任何下一步，而**门里没有任何东西会发现**。
 *      这正是本仓最贵的一类故障：**指路的路不存在，而且没人喊**。
 *    ★ 判别域 = **代码里的字符串**（`stripComments` 之后还剩的），**不含注释**（0.17①）：
 *      注释里的 `docs/xxx.md` 是**历史引述**（"当时那篇文档怎么写的"），删了文件也不该判红 ——
 *      那与本仓"病史留痕"的文化正面冲突（实测全仓注释里这类引述数十条，判它们 = 一条永远亮的灯）。
 *      而**文案**（报错 / fix / 回执）是**要人照着做**的，指错就是把人送进死路。
 *    ★ 基线（`DOC_REF_ALLOW`）只许变小：某条基线引用**不再出现**时本规则会红，逼着把条目删掉，
 *      免得这份账烂在原地（与 `RETIRED_ROW_BASELINE` / `scripts/write-log-baseline.json` 同一形状）。
 *
 * 用法：node scripts/lint-prose-as-structure.mjs [--json] [--count-only]
 * 退出码：0 = 无问题；1 = 有问题（可当门）；`--count-only` 恒退 0（只量噪音，用于调口径）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findTableByHeader } from './lib/md-table.mjs';
import { collect as collectScriptTiers } from './lib/script_tiers.mjs';
// ★ 2026-11-17（T-#JUNCTION-SCRIPT-NOOP）：入口守卫的物理路径归一权威（junction 下 argv[1] 与 import.meta.url 形态不同 ⇒ 裸比恒 false ⇒ main 静默不执行 = 假绿 exit 0）。
import { samePath } from './lib/path_identity.mjs';
// ★ H 的剥注释权威：`src/domain/text_strip.ts#stripComments`（**片段权威**，零 import ⇒ 本脚本直接 import 得到；
//   靠 Node ≥22.18 的**默认类型擦除**，`.ts` 扩展名必须写全）。为什么不用整文件权威
//   `parse/comments.ts#commentRangesSync`：它 import 的 `./kernel.js` **只在 dist 里** ⇒ 用它等于让本 lint
//   依赖「先 build」，而 `npm run gate` 里 lint 排在 build **之前** ⇒ 那会变成「判不了」（0.9.1④）。
import { stripComments } from '../src/domain/text_strip.ts';

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
 *
 * ★★ 已声明边界（0.17①，2026-11-06 复核后逐字写明）：这是**邻近启发式**（±{@link WINDOW} 行窗口），
 *   不是"这个词在修饰这个数"。它的已知失守形态是这个：`verify.mjs` 里「本仓的 N 道门」陈述的是**此刻的
 *   事实**，而同一窗口里另有一句「实测三次拿到假红」⇒ 被「实测」放行。
 *   **为什么不把窗口收紧**（实测代价，别重犯）：收窄到"同一行" ⇒ 14 条命中，收窄到"同一子句" ⇒ 31 条，
 *   只把「实测」从词表摘掉 ⇒ 19 条 / 9 文件 —— 而这些**没有一条是真漂移**（全是合法历史读数：
 *   「108 张证已整体删除」「写 65 条码实为 72」「我只跑了自己挑的 4 道门」……），且**多数在 `docs/`**。
 *   ⇒ 收紧 = 让门常红 = 0.16 反条款（永远会亮的灯 = 被关掉的灯）。
 * ★ 所以本条的处置是**两条**，都不是收紧：①**删掉该删的数字**（数字的权威是 `GATES`，散文里不重复它）；
 *   ②被窗口放行的命中**必须显形**（`suppressed` ⇒ 「本次丢弃 N 条窗口豁免（其中 docs/ M 条）」）。
 *   ★ 判据（可判）：输出里必须出现那两个带分母的数；某条被放行的命中不许"连一行记录都没有"。
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
  // ★ 2026-11-17（T-#N1 三方对账当天的 7 处误报全在这类文件）：文件名带日期 = 快照件（普查/评审/侦察报告——存在理由就是「记下当时的样子」，同 RETIRED/DECISIONS 的豁免判据）。
  /^docs[\\/][^\\/]*\d{4}-\d{2}-\d{2}[^\\/]*\.md$/i,
];
const isExempt = (rel) => EXEMPT_FILES.some((re) => re.test(rel));

/**
 * 注释行抽取：`.ts` / `.mjs` / `.js` 只取**注释**（`//` 行与块注释内部），`.md` 整篇都是散文。
 * ★ 只扫注释的理由：代码行里的数字由代码自己用（不是"给读者看的读数"）。
 *
 * ## ★★★ 同一个文件里两把尺 —— 这是**分工声明**，不是遗留（R6 · 0.9.1④）
 * 2026-11-06 复核发现本文件有两条"注释 vs 代码"的判别腿，它们**对象不同**，所以不收归同一条：
 *
 * | 腿 | 谁用 | 要的事实 | 输出形状 |
 * |---|---|---|---|
 * | **本函数（逐行启发式）** | 规则 E（注释里写死计数） | 「**哪几行**是注释行」 | 行清单 `[{line,text}]` |
 * | `src/domain/text_strip.ts#stripComments`（片段权威） | 规则 H（自指度量污染） | 「剥完的**整份文本**，且**行号守恒**」 | 字符串 |
 *
 * 判据（可判）：**把本函数换成权威，规则 E 就要先产出一份剥后文本再拿它反推"哪几行变空了"** ——
 * 那一步依赖"剥完行数守恒"，而**行数不守恒的行法**（例如块注释里含被吞掉的行）会让 E 整条腿静默变瞎；
 * 反过来，把规则 H 换成逐行启发式，就失去"同一针在 raw 与 code 各出现几次"的**差分**能力。
 * ⇒ 两条腿各自要的事实不同 ⇒ **不合并**；但"为什么这里有两把尺"必须写在**这一处**（就是本段），
 * 否则下一个人会在同一个文件里再长第三把（0.9.1 方向 A 的失守形态）。
 *
 * ★ 已声明的边界（守卫，不是判据）：本函数是**启发式**（行首看 `//` / `/*` / `*` + `inBlock` 状态位），
 * 它**不建模字符串字面量里的 `//`**，也**不建模 `${}` 里带引号的正则** —— 对规则 E 的用途（找注释里的散文计数）
 * 方向是**多扫几行**（可能把一行代码当注释读 ⇒ 只会多报不算漏报），不改变"有没有问题"的判定方向。
 * ★ 另一个必须挂账的事实（报给主控 R6，不在本卡作用面）：规则 H 的 `plainPoints` 实测 **0**
 * （25 个计数点里纯字面针 0 个）⇒ H 这条腿今天**零鉴别力**（0.16 的"永远绿的灯"），
 * 修 `stripComments` 不会改变这一点。
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

/**
 * 扫一个文件 ⇒ `{ hits, suppressed }`（hits = 判红的，suppressed = 被**窗口限定词**放行的）。
 *
 * ★★ 2026-11-06（复核 D）：被窗口放行的命中**不再静默丢弃**。丢弃本身是允许的（那是误报控制，
 *   见 `QUALIFIERS` 的判据），**看不见**不允许 —— 实测病：`verify.mjs` 那句「本仓的 N 道门」因为
 *   ±3 行外有一句「实测三次拿到假红」而被放行，于是"这里有一个数被我放行了"这件事**在输出里一个字都没有**。
 *   ⇒ 它们进 `suppressed`（带**是哪个词**放行的），主流程打印「本次丢弃 N 条窗口豁免（其中 docs/ M 条）」。
 */
export function scanHardcodedCounts(rel, abs) {
  const ext = path.extname(rel).toLowerCase();
  const comments = commentLinesOf(abs, ext);
  const isMd = ext === '.md';
  const allLines = isMd ? null : fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const hits = [];
  const suppressed = [];
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
    const qualifier = QUALIFIERS.find((w) => win.includes(w));
    if (qualifier) {
      suppressed.push({ line, hit: m[0], qualifier, text: text.trim().slice(0, 140) });
      continue;
    }
    hits.push({ line, hit: m[0], text: text.trim().slice(0, 140) });
  }
  return { hits, suppressed };
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

/**
 * 「本次丢弃 N 条窗口豁免（其中 docs/ M 条）」—— **唯一实现**（输出与用例都调它，不许两处各拼一遍）。
 *
 * ★ 为什么这是一条**判据**而不是一句 log（2026-11-06 复核 D）：被窗口放行的命中此前是**静默丢弃**的 ——
 *   输出里连"这里有一个数被我放行了"都看不到，于是「门是绿的」被读成「没有写死计数」。
 *   现在要求两个**带分母**的数同时在输出里；0 也要印（0 是分母，不是噪音 —— 0.12③）。
 * @param {Array<{file:string}>} suppressions
 */
export function suppressionSummary(suppressions) {
  const list = suppressions ?? [];
  const docs = list.filter((s) => /^docs[\\/]/.test(String(s.file ?? ''))).length;
  return `本次丢弃 ${list.length} 条窗口豁免（其中 docs/ ${docs} 条）`;
}

/**
 * E 的整趟跑：扫待扫范围 ⇒ 写死计数命中清单 + **被窗口放行的清单**。
 * ★ **抽成函数是为了让本文件可被 import**（`tests/p0_doc_structure_guards.test.ts` 要拿
 *   `DOC_STRUCTURE_GUARDS` / `checkDocStructureGuards` 做双向 + 消融用例）：import 一个"一进就
 *   扫盘 + 打印 + `process.exit`"的脚本是拿不到的。变的是**调用时机**，判的东西一字未改。
 */
function scanHardcodedCountsAside() {
  const scanned = targets();
  const countProblems = [];
  const suppressions = [];
  for (const rel of scanned) {
    if (isExempt(rel)) continue;
    const { hits, suppressed } = scanHardcodedCounts(rel, path.join(ROOT, rel));
    for (const h of hits) {
      countProblems.push({
        rule: 'E',
        file: rel,
        line: h.line,
        msg: `写死计数「${h.hit}」⇒ 改成"现算"或指向产出它的命令/脚本（原文：${h.text}）`,
      });
    }
    for (const s of suppressed) suppressions.push({ file: rel, ...s });
  }
  return { scanned, countProblems, suppressions };
}

// ════════════════════════════════════════════════════════════════════
// F. 文档结构守卫（`DOC_STRUCTURE_GUARDS` —— 声明表 = AGENTS.md 0.2 指名的那张）
// ════════════════════════════════════════════════════════════════════
/**
 * 文档结构守卫的声明表。**这是它唯一的住处** —— 任何"防某个文档退化"的需求都加一行到这里，
 * 不许在别的脚本里另开一段 if（0.25②③：一道门挂例外清单 = 碎片）。
 *
 * 五个判据键的分工（AGENTS.md 0.2 逐字要求）：
 *   `mustHave` / `mustNot`        = 字符串**在场 / 不在场**
 *   `minCount: [{pattern, atLeast}]` = 计数**软下限**（只防删空 / 截断）
 *   `maxBytes: number`            = 字节**硬上限**（超了 = 宿主的指令预算截断 ⇒ 后半部分对 agent **不可见**）
 *   `columns: {headerStartsWith, expect}` = 某张 md 表格的**列数**（走 `lib/md-table.mjs`）
 *
 * ★ `minCount` 是软下限、`maxBytes` 是硬上限 —— 这就是 0.2 那句「下限要软、上限才硬」的两个具体键：
 *   下限软 = 合法合并（0.25② 要求的事）不误红；上限硬 = 超一个字节就是"有人看不见了"，没有"稍长一点"这一档。
 *
 * ★ 新增一行的自查问句（0.2）：**拿它做一次合法重构**（改标题措辞 / 重排小节 / 合并同类），
 *   它会误红吗？会 ⇒ 你钉错东西了（该钉节号 / 结构串，不该钉标题全称）。
 */
/**
 * `docs/RETIRED.md` 逐行规则的**存量账**（PROJECT-DESIGN §14.3 的判据，2026-11-07 立）。
 *
 * ## 它为什么存在（而不是把 11 行一次补齐）
 * §14.3 要求每条删除记录都写「回炉条件」。实测（2026-11-07）：台账 34 条数据行里 **11 条**性质标
 * ②/④ 却没有点名任何 `### R<n>` 回炉登记。补齐这 11 行有两种做法：
 *   ① 替历史**编**回炉条件 —— 那是伪造记录（P29 / 台账纪律「不写觉得没用了」）；
 *   ② **记账**：这一条今天不合规、为什么，然后**只对新行执法**（棘轮只许收紧）。
 * ⇒ 选 ②。★ 棘轮的方向：基线**只能变小** —— 某一行补齐了 / 被删了，它的条目就必须从这里删掉，
 *   否则下面 (4) 那条会红（「基线里这一条已经没有违规了」）⇒ 这份账不会烂在原地。
 * ★ 与 `scripts/write-log-baseline.json` 同一形状：**只许不增**、每条带 `why`、事后补不改。
 */
export const RETIRED_ROW_BASELINE = [
  { row: '2026-11-03|「什么文件该跳过」的第二份清单（src/infrastruc', why: '② 与权威分叉：该笔的「回炉条件」未逐行写（设计约束在正文里，未登记成 ### R 条目）；补它要重述当时的分叉细节，本轮不替历史编条件。' },
  { row: '2026-11-02|工具面上的死枚举：get_dsl 的 4 个 query（a', why: '④ 死代码：该行「代价」栏已写遗留项，但没有 ### R 回炉登记；性质 ④ 按规矩要写「什么情况下值得重做」，属需要人裁定的语义，未代填。' },
  { row: '2026-10-31|整张证 certs/t380-plan-gate-cert.', why: '② 做得不够好：行内已写回炉条件与设计约束，但未挂 ### R 编号（当时 §14.3 尚未作为判据存在）。' },
  { row: '2026-10-31|整张证 certs/t383-edit-receipt-ex', why: '② 做得不够好：同上 —— 条件写在该行「代价」栏末尾，未挂 ### R 编号。' },
  { row: '2026-10-28|code_workbench.ts（代码变更提案 + pen', why: '② 做得不够好 + ④ 死代码：回炉需求对应 ### R1，但该行没有点名 R1（本判据要求的正是这条点名）。' },
  { row: '2026-10-22|design_intent action=propose（分', why: '② 做得不够好：回炉需求对应 ### R2，行内未点名 R2。' },
  { row: '2026-10-28|consistency_check（能力搬进 design_', why: '② 宿主搬错：行内写了「逐个能力核对」的教训，但没有 ### R 回炉登记（该行未主张要回炉）。' },
  { row: '2026-10-28|tool_usage（迁出为 npm run dogfood', why: '④ 宿主搬错（能力真实、家放错）：无 ### R 登记 —— 它没有被退役，只是换了住处，回炉条件不适用；★ 这一条是**基线豁免**，不是违规，等 §14.3 的口径细化后应删掉。' },
  { row: '2026-10-28|工具名 translate_go_ts → translat', why: '③ 重复发明：行内写了别名退场，但没有 ### R 回炉登记。' },
  { row: '2026-10-30|5 个零 import 死文件：src/applicatio', why: '④ 死代码：行内未写回炉条件（需求是否存在当时未裁定）。' },
  { row: '2026-10-30|证里写死计数的断言 5 条：t195「门数 5→4」+「[报', why: '② 做得不够好：该行「代价」栏写了改法，但没有 ### R 回炉登记。' },
];

export const DOC_STRUCTURE_GUARDS = [
  {
    // 原判据 #2（`run` 解析 AGENTS.md 标题集）⇒ 守卫。断的东西一字未改。
    file: 'AGENTS.md',
    // ★★ 2026-11-06（用户裁定）：「我需要的是**能力判据**，不是读数判据…读数不能指代功能是否正确，
    //   也不能指代实际问题出现在哪」「你只要简洁明了的应该做什么、应该怎么做即可」。
    //   ⇒ 原来这里钉的是「`### 0.x` 节号在场 + 节数 ≥ 20」—— **那是读数判据**：
    //     它数不到"哪一步被删了"，却会在**合法重写**（合并节 / 改标题 / 把一节拆成两节）时误红。
    //   ⇒ 换成**能力判据**：这份手册必须覆盖【必做动作】。判据 = 每一个必做动作都能在手册里找到落点。
    //     ★ 不数节数、不钉标题措辞、不钉编号 —— 那些都会随写法变，而"手册里还有没有这一步"不会。
    mustHave: [
      'edit_dsl', // 设计线：写判据 / claim / complete
      'design_line',
      'edit_code', // 设计线：落盘
      'npm run build', // 必跑清单
      'npm run design:gen-db',
      'npm run cognition',
      'npm test',
      'heavy.lock', // 会咬人的环境坑
      'STALE_BUILD',
      'send_message', // 派卡两段式
      // ★★★ 2026-11-16（销账三层机制 · L3）：**收尾三问**必须还在手册里（三问各一个锚点）。
      //   ★ 为什么是"能力判据"而不是读数：三问断的是【收尾时必须被回答的三件事】——
      //     假绿 / 卡的销账 / 欠账留字。它们**不随写法变**（重排措辞、改标题、改写示例都照样命中），
      //     而**任何一问被删**都会让对应那一类静默回归（2026-11-06 实测：检查对象退出检查范围 ⇒ 假绿）。
      //   ★ 不数节数、不钉标题全称、不钉编号 —— 与上面十条同一把尺（0.2 的自查问句）。
      '收尾三问',
      '修好了哪盏灯', // 问 ①：修好了，还是它退出了检查范围
      '涉及哪张卡', // 问 ②：改动落地 ⇒ 卡的状态变化要点名
    ],
    // ★★ 2026-11-06（用户裁定）：指令预算是**硬边界**，超了宿主静默截断 ⇒ 后半部分对 agent 等于没写。
    maxBytes: 65536,
    why: '能力判据：这份手册必须覆盖【必做动作】—— 设计线五步 / 改完必跑五样 / 会咬人的环境坑 / 派子的两段式。★ 不数节数、不钉标题、不钉编号：合法重写（合并 / 拆节 / 改标题 / 去编号）不该误红，而「哪一步被删了」必须红。另加 `maxBytes` 硬上限：超了宿主会静默截断，后半部分对 agent 等于没写（实测 2026-11-06：截掉的那 38 行里正好有「派子代理」一节）。',
  },
  {
    // 原判据 #3（`source-has mustNot` on AGENTS.md）⇒ 守卫。
    file: 'AGENTS.md',
    mustNot: ['## 一、动作 → 工具', '| 开发动作'],
    why: '反回归：那张「动作 → 工具」表是 `ToolDef.description` 的第二份拷贝（0.9.1），2026-11-04 已随生成器一起退役（docs/RETIRED.md）⇒ 不许加回来。断的是**节标记**与**表格形状**（`| 开发动作` 是那张表首列的表头），不是散文句子。',
  },
  {
    // 原判据 #5（`source-has` on docs/RETIRED.md）⇒ 守卫。
    file: 'docs/RETIRED.md',
    mustHave: ['| 日期 | 退役对象 | 性质 |', '## 回炉登记'],
    columns: { headerStartsWith: '| 日期 |', expect: 6 },
    rowRules: {
      headerStartsWith: '| 日期 |',
      /** 每一格都非空 —— 六列各是「凭什么删」的一部分（日期/对象/性质/判据/现在用什么/代价） */
      nonEmpty: [0, 1, 2, 3, 4, 5],
      /** 性质格必须点明是哪一种退役（①-⑤）。★ 不钉具体哪一种（那是人的判断），只钉「说了没有」 */
      natureCell: 2,
      naturePattern: /[①②③④⑤]/,
      /**
       * ②/④ 的行必须点名一条**存在的** `### R<n>` 回炉登记。
       * ★ 为什么「点名」而不是「语义上有没有写回炉条件」：后者判不了（散文），而**编号**是机械的，
       *   且它把两节**联动**起来 —— 只写正文不登记 ⇒ 红；登记了但编号写错 ⇒ 红。
       */
      reworkRef: { whenNature: /[②④]/, pattern: /R(\d+)/, minEntries: 1 },
      baseline: RETIRED_ROW_BASELINE,
    },
    why: '六列台账的两个结构锚点：表头在 ⇒ 新行有地方落（列语义不会被改写成散文）；回炉节在 ⇒ 性质 ②/④ 的退役还留着「重做时的设计约束」。表头只钉**前三列**（后三列措辞可变）。`columns` 断「这张表每行都是 6 列」—— 少了它，表被切成 5 列 / 7 列也照样绿：实测（2026-11-05）台账里有一行的格内**逐字引用**了判据串 `\'| 开发动作\'`，竖线未转义 ⇒ 那一行实际 7 列，而当时没有任何检查点发现它。★ `rowRules`（2026-11-07，PROJECT-DESIGN §14.3「退役必须记代价」）断**逐行**：六格非空 + 性质格点明 ①-⑤ + 性质 ②/④ 的行必须点名一条**存在的** `### R<n>`。实测（2026-11-07）它只对新行执法：存量 11 行不合规，逐条记在 `RETIRED_ROW_BASELINE`（带 why），账**只许变小**。',
  },
  {
    // ★★★ 2026-11-07（PROJECT-DESIGN §4/§7/§9/§14 装判据的第一步）：这份文档此前**0 条机器检查**
    //   （`rg PROJECT-DESIGN` 在 src/tests/scripts 与三册 DSL 里全 0 命中）。
    //   而它第 0 节自称是"目标设计、被别处引用" ⇒ 最先该有判据的恰恰是**它有多少个节、节号是否唯一**。
    file: 'docs/PROJECT-DESIGN.md',
    uniqueHeadingNumbers: { levels: [2, 3] },
    why:
      '节号不许出现两次：这份文档的节号**被别处引用**（本仓的工作卡写「§4 / §7 / §9 / §14」）。' +
      '实测 2026-11-07：`## 3.` 出现两次（「用户、场景与价值判据」/「总体架构」），且前者的子节编号是 `### 2.1 / 2.2` ' +
      '⇒ 引用「§3」指向两个不同的节，而当时没有任何判据在看节号。已按最小改法修好（只改后出现的那一节与它的子节，' +
      '**不动任何既有节号** —— 那会让别处引用全错）。★ 只钉"重复"、不钉"连续"：跳号是合法写法。' +
      '★ 这一条挡的是"加节 / 复制节"时最常犯的错，而不是这份文档的具体内容 —— 内容的可判断言挂在代码侧判据上' +
      '（tests/p0_contract_origin.test.ts · tests/p0_backfill_intent.test.ts · 设计册 schema.ts 节点）。',
  },
  {
    // 原判据 #8b（`run` 读 docs/todo.md 找这两个串）⇒ 守卫。
    file: 'docs/todo.md',
    mustHave: ['scripts/probe-gate-cov.mjs', 'scripts/probe-ratio-nesting.mjs'],
    why: '2.5「每个数自带可复算命令」：这两个是**文件路径**（合法改写不会变 ⇒ 过 0.2 的自查问句），不是措辞。原判据是 `run` 读 docs/todo.md 找这两个串 —— 文档当主体不许占要求位 ⇒ 搬进守卫表。★ 「这两个路径**真在盘上**」那一半是**代码侧**判据（`file-exists` 挂在两个探针节点 `file_scripts_probe-gate-cov_mjs` / `file_scripts_probe-ratio-nesting_mjs` 上）：两半合起来才是原判据的语义（**引用的复算命令必须真能跑**），只留任一半都会假绿。',
  },
  {
    // 原判据（`source-has` on docs/GUIDE-GATE.md）⇒ 守卫。规格漏了这一条，按 R7 的同一把尺补上（见回执）。
    file: 'docs/GUIDE-GATE.md',
    mustHave: ['## 三、判据'],
    mustNot: ['| `cert` |'],
    columns: { headerStartsWith: '| kind |', expect: 4 },
    why: '门的账本（§三 判据 kind 表）不许退化成散文：节在（只钉前缀不钉「11 kind」这个数）+ kind 表每行 4 列 + **已退役的 `cert` 行不许加回来**（2026-10-31 退役 cert 后该表还留着它 ⇒ 文档在教一个已经写不进去的 kind）。★ 为什么**不**钉死「种数 = 注册表」：那要读 `src/domain/expectation_kinds.ts`，是**跨源**不变式，守卫表只读单个文档做不到；钉一个写死的数只会让合法新增 kind 误红（写死计数正是本 lint 规则 E 治的病）。那一半仍归代码侧管。',
  },
];

/** 串在文件里的行号（1-based；找不到 ⇒ 0）。只用于把红**定位**到行（0.12 第 4 条）。 */
function lineOf(text, needle) {
  const at = text.indexOf(needle);
  if (at < 0) return 0;
  return text.slice(0, at).split(/\r?\n/).length;
}

/**
 * 跑 `DOC_STRUCTURE_GUARDS` ⇒ 问题清单（**只读**：只读文件，不写盘、不改状态）。
 * @param {string} [root] 仓库根（缺省 = 当前工作目录，与脚本其余部分同一口径）
 * @param {readonly object[]} [guards] 守卫表（测试要换一份时传）
 * @returns {{rule: string, file: string, line: number, guard: number, msg: string}[]}
 */
export function checkDocStructureGuards(root = ROOT, guards = DOC_STRUCTURE_GUARDS) {
  const problems = [];
  guards.forEach((g, gi) => {
    const push = (line, msg) => problems.push({ rule: 'F', file: g.file, line, guard: gi + 1, msg });
    const abs = path.join(root, g.file);
    if (!fs.existsSync(abs)) {
      push(0, `守卫对象不存在（${g.file}）—— 文件被改名 / 删了？先改这张表（why：${String(g.why).slice(0, 48)}…）`);
      return;
    }
    const text = fs.readFileSync(abs, 'utf8');
    for (const s of g.mustHave ?? []) {
      if (!text.includes(s)) push(0, `mustHave 缺失：${JSON.stringify(s)}（这条断的是结构，不是措辞 ⇒ 真丢了才红）`);
    }
    for (const s of g.mustNot ?? []) {
      if (text.includes(s)) push(lineOf(text, s), `mustNot 命中：${JSON.stringify(s)} —— 被退役 / 被禁止的形态回来了`);
    }
    for (const mc of g.minCount ?? []) {
      const n = (text.match(new RegExp(mc.pattern, 'gm')) ?? []).length;
      if (n < mc.atLeast) push(0, `minCount 不足：/ ${mc.pattern} / 命中 ${n} < 下限 ${mc.atLeast}（下限是软值：只防删空 / 截断）`);
    }
    // ★★ 2026-11-06（用户裁定）：「设这个上限干嘛？说明它**是有用的写进去**，没用的东西你写进去又要干嘛呢」
    //    ⇒ 上限不是"建议"，是**宿主按指令预算截断**的硬边界：**超出部分对 agent 完全不可见**。
    //    实测：AGENTS.md 68282 字节 > 65536 ⇒ 宿主回执逐字「truncated from 68182 to 65218」
    //    ⇒ 而截掉的那 38 行里正好有「§六 派子代理」—— 我当晚正在用它，而它那时对我是不可见的。
    //    ⇒ 这是 0.25 意义上的真检测点：**它今天就是红的**（有鉴别力），且取值域与异常域重叠。
    if (typeof g.maxBytes === 'number') {
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > g.maxBytes) {
        push(
          0,
          `maxBytes 超出：${bytes} > 上限 ${g.maxBytes}（超 ${bytes - g.maxBytes} 字节）—— ` +
            `★ 超出部分**对 agent 不可见**（宿主按指令预算截断），这不是"有点长"，是"后半部分等于没写"。` +
            `出路：把「用户原话 / 实测实证 / 举例」搬去 docs/AGENTS-RATIONALE.md —— 本文件第 3 行与 0.10 都要求它们住那儿；` +
            `只留规则本身与判据表（0.10：AGENTS 不写举例式叙述）。`,
        );
      }
    }
    // ★★★ 2026-11-07（PROJECT-DESIGN §4/§7/§9/§14 装判据时查出来的真缺陷）：**节号不许出现两次**。
    //   病（实测 2026-11-07）：`docs/PROJECT-DESIGN.md` 里 `## 3.` 出现两次（「用户、场景与价值判据」与
    //   「总体架构」），而 `## 3.` 的第一节下面挂的是 `### 2.1 / 2.2`（编号错到别的节去了）。
    //   ⇒ 别处引用「§3」时**指向两个不同的节**，而没有任何判据在看节号（该文档此前 0 条机器检查）。
    //   ★ 判据只钉"重复"，不钉"连续/从 1 开始"：跳号（本文件本来就没有 §11/§16 的 H3）是合法写法，
    //     钉它会在每次合法增删小节时误红（0.2 的自查问句）。
    //   ★ 围栏内的行不算（``` 之间的内容可能是别人文档的示例 —— 那不是说这份文档的节号）。
    if (g.uniqueHeadingNumbers) {
      const levels = g.uniqueHeadingNumbers.levels ?? [2];
      const lines = text.split(/\r?\n/);
      let fenced = false;
      const seen = new Map(); // `${level}|${num}` → 首次出现的行号
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
          fenced = !fenced;
          continue;
        }
        if (fenced) continue;
        for (const lv of levels) {
          // ★ 两种写法都要认：`## 3. 标题`（号后带点）与 `### 17.1 标题`（不带点）。
          //   贪婪捕获 + 可选点 + 空白 —— 否则 `### 17.1` 会被截成 `17`（实测 2026-11-07，第一版就是这样误报的）。
          const re = new RegExp(`^#{${lv}} (\\d+(?:\\.\\d+)*)\\.?\\s`);
          const m = line.match(re);
          if (!m) continue;
          const key = `${lv}|${m[1]}`;
          if (seen.has(key)) {
            push(
              i + 1,
              `节号重复：\`${'#'.repeat(lv)} ${m[1]}\` 第 ${i + 1} 行与第 ${seen.get(key)} 行同号 —— ` +
                `引用的「§${m[1]}」因此指向两个不同的节（★ 修法：改后出现的那一节的编号，或给它摘掉编号；**不要**全局重编号，那会让所有既有引用全错）`,
            );
          } else {
            seen.set(key, i + 1);
          }
        }
      }
    }
    if (g.columns) {
      const { headerStartsWith, expect } = g.columns;
      let table = null;
      try {
        table = findTableByHeader(text, headerStartsWith);
      } catch (e) {
        push(0, `columns 解析失败：${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!table) {
        push(0, `columns 找不到表头以 ${JSON.stringify(headerStartsWith)} 开头的表格（表在 ⇒ 新行有地方落）`);
        return;
      }
      if (table.header.length !== expect) {
        push(table.rows[0].line, `表头 ${table.header.length} 列 ≠ 期望 ${expect} 列`);
      }
      for (const r of table.rows.slice(1)) {
        if (r.cells.length !== expect) {
          push(r.line, `表格第 ${r.line} 行 ${r.cells.length} 列 ≠ ${expect} 列（格里有未转义的 \`|\`，或漏了收尾 \`|\`，或一格换了行）`);
        }
      }
    }
    // ★★★ 2026-11-07（PROJECT-DESIGN §14.3「退役必须记代价」）：**逐行**规则。
    //   为什么它不是「又一条文档文本判据」：它判的是**记录行为**（这一行写全了没有、点名了没有），
    //   主体是台账本身；改代码**变绿不了**它，改文档**必须真的补记**才变绿。两只方向都不是自指。
    if (g.rowRules) {
      const rr = g.rowRules;
      let table = null;
      try {
        table = findTableByHeader(text, rr.headerStartsWith);
      } catch (e) {
        push(0, `rowRules 解析失败：${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!table) {
        push(0, `rowRules 找不到表头以 ${JSON.stringify(rr.headerStartsWith)} 开头的表格（表在 ⇒ 新行有地方落）`);
        return;
      }
      // 数据行 = 第 1 格是 ISO 日期。★ 用日期当行身份是有意的：表头 / 分隔行 / 说明行都不长这样 ⇒ 不会误算。
      const dataRows = table.rows.filter((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r.cells[0] ?? '').trim()));
      if (dataRows.length === 0) {
        // ★ 0 行 = 判不了，不是通过（否则把表拆成散文就自动绿了）
        push(0, `rowRules 一条数据行都没解析到（表的行首不再是日期？）—— 判不了 ≠ 通过`);
        return;
      }
      const reworkIds = new Set([...text.matchAll(/^### R(\d+)/gm)].map((m) => m[1]));
      if (rr.reworkRef && reworkIds.size < (rr.reworkRef.minEntries ?? 1)) {
        push(0, `rowRules 要求「## 回炉登记」里至少有 ${rr.reworkRef.minEntries ?? 1} 条 \`### R<n>\`，实测 ${reworkIds.size} 条 —— 性质 ②/④ 的行就无处可点名了`);
      }
      const keyOf = (cells) =>
        String(cells[0] ?? '').trim() +
        '|' +
        String(cells[1] ?? '')
          .replace(/\*\*/g, '')
          .replace(/`/g, '')
          .trim()
          .slice(0, 30);
      const baseline = rr.baseline ?? [];
      const baselineKeys = new Set(baseline.map((b) => b.row));
      const consumed = new Set();
      for (const b of baseline) {
        if (!b.why || String(b.why).trim().length < 10) {
          push(0, `rowRules 基线条目缺 why（${JSON.stringify(b.row)}）—— 豁免必须有理由，否则它就是一块静音垫`);
        }
      }
      for (const r of dataRows) {
        const cells = r.cells;
        const key = keyOf(cells);
        const bad = [];
        for (const ci of rr.nonEmpty ?? []) {
          if (String(cells[ci] ?? '').trim() === '') {
            bad.push(`${ci + 1} 列是空的`);
          }
        }
        const nat = String(cells[rr.natureCell] ?? '');
        if (rr.naturePattern && !rr.naturePattern.test(nat)) {
          bad.push(`性质格没点明是 ①-⑤ 哪一种（实得 ${JSON.stringify(nat.trim().slice(0, 16))}）`);
        } else if (rr.reworkRef && rr.reworkRef.whenNature.test(nat)) {
          const m = rr.reworkRef.pattern.exec(cells.join(' '));
          if (!m) bad.push(`性质含 ②/④ 但没点名任何 \`### R<n>\` 回炉登记`);
          else if (!reworkIds.has(m[1])) bad.push(`点名的 \`R${m[1]}\` 在「## 回炉登记」里不存在（现有：${[...reworkIds].map((x) => 'R' + x).join(' / ') || '一条都没有'}）`);
        }
        if (bad.length === 0) {
          if (baselineKeys.has(key)) consumed.add(key); // 已补齐 ⇒ 基线条目该删
          continue;
        }
        if (baselineKeys.has(key)) {
          consumed.add(key); // 存量：记账豁免（why 已在上面单独校验）
          continue;
        }
        push(r.line, `退役台账第 ${r.line} 行不合 §14.3（退役必须记代价）：${bad.join('；')}`);
      }
      for (const b of baseline) {
        if (!consumed.has(b.row)) {
          push(
            0,
            `rowRules 基线里这一条**已经不违规了**（或那一行被删 / 改了名）⇒ 请把 ${JSON.stringify(b.row)} 从 RETIRED_ROW_BASELINE 删掉。` +
              `★ 棘轮只能收紧（与 write-log-baseline 同规矩），留着它会变成一块永久的静音垫。`,
          );
        }
      }
    }
  });
  return problems;
}

// ════════════════════════════════════════════════════════════════════
// G. **读数脚本的分层守卫**（实现只有一处：`scripts/lib/script_tiers.mjs`；本函数只判红）
// ════════════════════════════════════════════════════════════════════
/**
 * 为什么它是**守卫**而不是判据（AGENTS 0.2 的分界）：它红了以后**改的是声明**——
 * 要么把那道边接上（`verify.mjs#GATES` / package.json 的 scripts），要么在
 * `scripts/script-tiers.registry.json` 里声明它是什么；**从不改源码逻辑** ⇒ 不占要求位。
 *
 * 为什么住在 lint（而不是新开一道门）：0.25② 要求"新增前先问现有的哪一条能吸收它"，
 * 而 lint 已经是总门的一个子检查（`docs-facts-check` → `npm run lint:prose`）⇒ 放这儿
 * **入口数不增**、又真的会被跑到；另开一道门才是叠加。
 *
 * 判红的条件（都能说出"什么情况下红"）：
 *  · `TIER_C_READING`   —— 出现一个**会判真假**的脚本，却四条边一条都不沾、也没声明（新增即红，点名）；
 *  · `GATE_FIELD_MISSING`—— `GATES` 里某道门缺 `consumer` / `tier`（新增门忘了写就红）；
 *  · `GATE_NOTES_MISSING`—— 某道门在登记表里没有「它跑到的到底是什么 / 已知假绿形态」⇒ A 档不许只有名字；
 *  · `STALE_DECLARATION`—— 登记表里声明了已不存在的文件 / reason 是空的；
 *  · `CLOSURE`         —— 三档之和不等于总数（分母不闭合 ⇒ 三个数里必有一个是错的）。
 * ★ **tier B 缺理由不红**（只由读数标 ⚠）：判红它 = 让门天天亮 = 0.16 的永远会亮的灯。
 *
 * @returns {Promise<Array<{rule:string,file:string,line:number,msg:string}>>}
 */
export async function checkScriptTierGuards(root = ROOT) {
  let report;
  try {
    report = await collectScriptTiers(root);
  } catch (e) {
    return [{ rule: 'G', file: 'scripts/', line: 0, msg: `读数脚本分层**判不了**（${e instanceof Error ? e.message : String(e)}）—— 判不了 ≠ 通过` }];
  }
  if (report.gatesError) {
    return [{ rule: 'G', file: 'scripts/verify.mjs', line: 0, msg: `${report.gatesError}（⇒ 自动门这一档判不了，不许当通过）` }];
  }
  return report.problems.map((p) => ({ rule: 'G', file: p.file, line: 0, msg: `[${p.code}] ${p.msg}` }));
}


// ════════════════════════════════════════════════════════════════════
// H. **自指度量污染**（self-referential measurement pollution）
// ════════════════════════════════════════════════════════════════════
/**
 * H 治的缺陷：**计数型判据的载体包含了它自己数的那串文本** ⇒ 判据把自己抬高一格，
 * **而读数照样是绿的**（它数出了一个"合理的"数 —— 这正是这类缺陷只能靠复算发现的原因）。
 *
 * ## ★★ 它援引的那次事故与它的判别域**不是同一个东西**（2026-11-06 复核，逐字改准）
 * R73（2026-11-05 · `scripts/verify.mjs`）的现场：typedef 注释里写下「本表条数不变（`kind: 'gate'`
 * 的计数前后一致）」，而**量具是手工在 shell 里跑的 `grep -c`** ⇒ 同一个 grep 从 15 变 16。
 * ⇒ **本条不覆盖那次事故**，理由是原理性的：
 *   · 那个量具的载体是 `.agent-io/scratch/` 下的一次性探针（**不进仓**）；仓内**没有**它的对应物 ——
 *     静态扫 `scripts/` + `src/` 判不了"某人在某次 shell 里敲了 grep"；
 *   · 唯一能硬塞进来的形态是 `execSync('grep -c …')`，而全仓实测 **0 处** ⇒ 为它扩判别域只会得到
 *     一条永久 0 分母的规则（0.16：永远不亮的灯 / 0.25③：取值域与异常域不重叠 ⇒ 不算检测点）。
 * ⇒ **那类事故的防线是 0.20**（同一事实有结构化权威就用权威），不是本条。门数的权威是
 *   `GATES.filter((g) => g.kind === 'gate').length`；文本 `kind: 'gate'` 数出来是 **15**、
 *   结构化真值是 **14**（`tsGate` 两分支各带一行）⇒ **R73 那把量具本来就是错的**，15→16 只是它自己的抖动。
 *   ★ 结论（要防的是它，不是"注释里出现了这个串"）：**用文本数结构化事实，本来就是错的。**
 * ⇒ 本条的正当职责 = 抓**回归**（谁把结构化计数改回文本计数）+ 抓仓内**新出现**的自污染。
 *
 * ## 判据（可判）
 * 对 `scripts/` 递归 `.mjs` + `src/` 递归 `.ts` 里的每个**计数型判据点**（形态见 `COUNT_POINT_FORMS`），
 * 若它的 needle 是**纯字面串**（见 `isPlainNeedle`）且也出现在**同一文件**的**注释**里 ⇒ 红，并点名两个行号。
 *
 * ## 为什么不是「注释里不许出现代码」（0.16）
 * 那条会误红一片（注释里引用代码是本仓常态）⇒ 一条永远会亮的灯 = 一条被关掉的灯。
 * 本条只判**计数型**判据，且只判**同一文件**（载体与被数的文本同属一份文件时，多写一个字就会让计数 +1）。
 *
 * ## 边界（0.17①：逐条是声明，不是遗漏）
 * · **只管注释**：判「这段是注释吗」用 `src/domain/text_strip.ts#stripComments`（**片段权威**，零 import
 *   ⇒ 本脚本直接 import 得到）。**不用**整文件权威 `parse/comments.ts#commentRangesSync`：它的
 *   `./kernel.js` 只在 dist 里 ⇒ 用它等于让本 lint 依赖先 build（`gate` 里 lint 在 build 之前 ⇒ 判不了）。
 * · **不管字符串字面量**：needle 落在**提示串 / 字符串**里同样会把计数抬高，但仓里**没有**「这段字符串
 *   是散文还是数据」的权威（`text_strip.ts#maskStringBodies` 私有、且只掩码不分档）⇒ 靠启发式判会把
 *   "数据里本来就有这个串"全判红（0.16）⇒ 这一档**显式不判**。★ **欠账**：要治它得先有一份
 *   「这段字符串是散文还是数据」的权威（0.9.1④）+ 一条 behavior 用例；本卡的作用面是 `scripts/` + 一个 test，
 *   动不了 `src/` 与 `docs/` ⇒ **在这里声明，不假装已挂账**（0.9.4 第 1 行：做不到 ≠ 已闭环）。
 * · **只认纯字面针**：含正则元字符的 needle（`\n` / `\r?\n` / `\d+`）数的是**一类**而不是**一串**，
 *   注释里写不成同一串 ⇒ 不在本条判据里（本仓现有计数点全是这一类 ⇒ 当前 0 命中，**分母会打印出来**，
 *   别抄数字）。
 * · **行数不守恒 ⇒ 判不了**：剥完注释行数变了就**跳过并计数**（`skipped`），不当通过（0.9.4 第 1 行）。
 * · **量具自己的形态表不是样本**：`COUNT_POINT_FORMS` 的声明区间里那些 `why` 串写的就是"计数长什么样"
 *   ⇒ 它们会被自己的形态腿命中（纯假货）⇒ 该区间**整块跳过**（`formsTableRange`）。
 *   ★ 这是**排除自身**（本类问题的标准解法之一），不是为了让读数好看：不跳，分母就会被自己的说明文字抬高
 *   —— 那正是本条要治的病，只不过换了个人犯。
 */

/**
 * 计数型判据的**形态腿**（0.9.1② 的第二条腿：不看名字，看"做这件事的代码长什么样"）。
 * ★ 每条都说清它为什么算「数一串文本出现几次」；数数组元素 / 数行数 / 数结构量的**不在**此列
 *   （它们不吃散文，注释怎么写都不影响它们的值）。增删一条 = 改变本规则的分母，写清 why。
 */
const COUNT_POINT_FORMS = [
  {
    name: 'split-length',
    why: '`EXPR.split(X).length` ⇒ 数 X 在 EXPR 里出现几次（本仓最常见的计数形态）',
    re: /\.split\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|\/((?:\\.|[^/\\\n])+)\/[gimsuy]*)\s*\)\s*(?:\?\?)?\.length/g,
  },
  {
    name: 'matchAll-length',
    why: '`[...EXPR.matchAll(X)].length` ⇒ 同一次计数，只是走 matchAll（含 `new RegExp(\'…\')` 这一形态）',
    re: /\[\s*\.\.\.[^\]\n]{0,80}?\.matchAll\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|\/((?:\\.|[^/\\\n])+)\/[gimsuy]*|new RegExp\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*(?:,[^)]*)?\))\s*\)\s*\]\s*\.length/g,
  },
  {
    name: 'match-g-length',
    why: '`EXPR.match(/X/g).length` ⇒ 同上（只认 `g` 标志：没有 g 只能拿到第一处，不是计数）',
    re: /\.match\(\s*\/((?:\\.|[^/\\\n])+)\/g[imsuy]*\s*\)\s*\??\.length/g,
  },
  {
    name: 'split-variable',
    why: 'EXPR.split(VAR).length ⇒ 同一次计数，但针是运行期给的值（工具名 / 编辑的 from 串）⇒ 本规则判不了它（静态拿不到那个串），只进分母 —— 见文件头「边界」第 3 条',
    re: /\.split\(\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+|\[[^\]]{0,40}\])*\s*\)\s*(?:\?\?)?\.length/g,
  },
  {
    name: 'matchAll-variable',
    why: '[...EXPR.matchAll(VAR)].length ⇒ 同上（动态针，只进分母）',
    re: /\[\s*\.\.\.[^\]\n]{0,80}?\.matchAll\(\s*[A-Za-z_$][\w$.]*\s*\)\s*\]\s*\.length/g,
  },
  {
    name: 'filter-includes-length',
    why: '`LINES.filter(l => l.includes("X")).length` ⇒ 数**命中行数**，与数串等价（差一个"每行只算一次"）',
    re: /\.filter\([^)\n]*\.includes\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*\)[^)\n]*\)\s*\.length/g,
  },
];

/**
 * 这根针是不是**纯字面串** —— 三条件缺一不判：
 * ① 长度 ≥ 3（更短的针在本仓天然到处都有，判了就是噪音）；② 不含正则元字符与转义（含了就是"一类"而非"一串"）；
 * ③ 至少一个词字符或汉字（纯标点的针分不开"数据"与"措辞"）。
 */
const PLAIN_NEEDLE_RE = /^[^.*+?()[\]{}|^$\\\n\r\t]+$/;

/** 见上：纯字面针 = 只可能被**同一串**抬高一次 */
function isPlainNeedle(needle) {
  const s = String(needle ?? '');
  return s.length >= 3 && PLAIN_NEEDLE_RE.test(s) && /[\w\u4e00-\u9fff]/.test(s);
}

/**
 * **量具自己的形态表区间**（`COUNT_POINT_FORMS = [ … ];` 的字符区间）。
 * ★ 为什么要它：那张表里的 `why` 串写的就是"计数长什么样"（例如 `EXPR.split(VAR).length`），
 *   于是会被自己的形态腿命中 ⇒ 分母被自己的说明文字抬高（**就是本条要治的病**）⇒ 整块跳过。
 * ★ 找不到（有人改了声明形态）⇒ 返回 `null` 并**不静默**：分母里会多出那几个假点，读数看得见。
 */
function formsTableRange(code) {
  const start = code.indexOf('const COUNT_POINT_FORMS = [');
  if (start < 0) return null;
  const end = code.indexOf('\n];', start);
  if (end < 0) return null;
  return { start, end: end + 3 };
}

/** H 的待扫范围：`scripts/` 递归 `.mjs` + `src/` 递归 `.ts`（口径写在这里一处，调用方不另写） */
function countScanTargets(root) {
  const out = [];
  const walk = (abs, relBase, keep) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const rel = relBase + '/' + e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), rel, keep);
      else if (keep(e.name)) out.push(rel);
    }
  };
  walk(path.join(root, 'scripts'), 'scripts', (n) => n.endsWith('.mjs'));
  walk(path.join(root, 'src'), 'src', (n) => n.endsWith('.ts'));
  return out;
}

/**
 * 规则 H 的判定核（导出是为了让测试拿临时根做双向 + 消融用例 —— 与 `checkDocStructureGuards` 同一形态）。
 *
 * @returns {{scanned:number, skipped:number, points:Array<{file:string,line:number,needle:string,form:string,plain:boolean}>,
 *            plainPoints:Array, filesWithPoints:number,
 *            problems:Array<{rule:'H',file:string,line:number,msg:string}>}}
 *   ★ 四个分母都要（0.12③）：扫了几个文件 / 几个计数点 / 其中几个纯字面针 / 几个文件真有计数点。
 */
export function checkSelfPollutingCounts(root = ROOT) {
  const files = countScanTargets(root);
  const points = [];
  const plainPoints = [];
  const problems = [];
  const filesWithPoints = new Set();
  let scanned = 0;
  let skipped = 0;
  for (const rel of files) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      skipped += 1; // 读不到 ≠ 没有（0.9.4 第 1 行）
      continue;
    }
    const codeText = stripComments(raw);
    const rawLines = raw.split('\n');
    const codeLines = codeText.split('\n');
    if (rawLines.length !== codeLines.length) {
      skipped += 1; // 剥完行号对不上 ⇒ 判不了，别当通过
      continue;
    }
    scanned += 1;
    // ★ 量具自己的形态表整块跳过（否则它自己的 why 说明文字会被自己的形态腿当成"计数点"）
    const selfTable = formsTableRange(codeText);
    for (const form of COUNT_POINT_FORMS) {
      form.re.lastIndex = 0;
      let m;
      while ((m = form.re.exec(codeText)) !== null) {
        if (selfTable && m.index >= selfTable.start && m.index < selfTable.end) continue;
        const needle = m.slice(1).find((x) => x !== undefined) ?? '';
        const line = codeText.slice(0, m.index).split('\n').length;
        filesWithPoints.add(rel);
        const point = { file: rel, line, needle, form: form.name, plain: isPlainNeedle(needle) };
        points.push(point);
        if (!point.plain) continue;
        plainPoints.push(point);
        // 同一个针还在**本文件的哪些注释行**上：逐行比（剥注释后行数守恒 ⇒ 行号一一对应）
        const commentLines = [];
        for (let i = 0; i < rawLines.length; i += 1) {
          const inRaw = rawLines[i].split(needle).length - 1;
          const inCode = codeLines[i].split(needle).length - 1;
          if (inRaw > inCode) commentLines.push(i + 1);
        }
        if (commentLines.length === 0) continue;
        problems.push({
          rule: 'H',
          file: rel,
          line,
          msg:
            '判据数的串 `' + needle + '` 也出现在 ' + commentLines.join('、') +
            ' 行的**注释**里 ⇒ 它会把自己抬高（第 ' + line + ' 行的 ' + form.name + ' 形态数的就是这个串）',
        });
      }
    }
  }
  return { scanned, skipped, points, plainPoints, filesWithPoints: filesWithPoints.size, problems };
}

// ════════════════════════════════════════════════════════════════════
// I. 悬空文档引用（文案里的 `docs/*.md` 必须存在）—— P0-3
// ════════════════════════════════════════════════════════════════════
/**
 * **基线**：这些引用在代码（文案）里出现、但文件**按设计不存在** —— 每条都要写清"为什么可以不存在"。
 * ★ 只许变小：某条不再出现在文案里 / 那个文件后来真的建出来了 ⇒ 本规则会红，要求删条目（棘轮）。
 */
export const DOC_REF_ALLOW = [
  {
    ref: 'docs/xxx.md',
    why: '**占位符**（`harvest_decisions` 的"出处就是 `docs/xxx.md:行号`"是句式示范，不是真指某篇）——按设计不存在。',
  },
];

/** 文案里的仓库相对文档引用（`docs/<path>.md`）—— 唯一形态（别处不许再写一条自己的正则） */
const DOC_REF_RE = /docs\/[A-Za-z0-9._\-/]*\.md/g;

/**
 * 规则 I 的判定核（导出是为了让测试拿临时根做双向 + 消融用例 —— 与 `checkDocStructureGuards` 同一形态）。
 *
 * @returns {{scanned:number, skipped:number, refs:number, problems:Array<{rule:'I',file:string,line:number,msg:string}>}}
 *   ★ 分母都要（0.12③）：扫了几个文件 / 几条引用 / 判不了跳过几个。
 */
export function checkDanglingDocRefs(root = ROOT) {
  const allow = new Map(DOC_REF_ALLOW.map((a) => [a.ref, a.why]));
  /** 这份基线里**真的还用得着**的条目（文件仍不存在且仍被文案引用） */
  const stillNeeded = new Set();
  const docProblems = [];
  let scanned = 0;
  let skipped = 0;
  let refCount = 0;
  for (const rel of countScanTargets(root)) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      skipped += 1; // 读不到 ≠ 没有（0.9.4 第 1 行）
      continue;
    }
    // ★ 剥注释：只判**文案**（字符串里剩下的引用），注释里的历史引述不归本条管（见文件头 I）
    const code = stripComments(raw);
    if (code.split('\n').length !== raw.split('\n').length) {
      skipped += 1; // 剥完行号对不上 ⇒ 判不了，别当通过
      continue;
    }
    scanned += 1;
    const re = new RegExp(DOC_REF_RE.source, 'g');
    let m;
    while ((m = re.exec(code)) !== null) {
      const ref = m[0];
      refCount += 1;
      const line = code.slice(0, m.index).split('\n').length;
      if (fs.existsSync(path.join(root, ref))) continue;
      if (allow.has(ref)) {
        stillNeeded.add(ref);
        continue;
      }
      docProblems.push({
        rule: 'I',
        file: rel,
        line,
        msg: `文案指向 \`${ref}\`，但该文件**不存在** ⇒ 改成现存的文档，或删掉这句指引（指路指到空处 = 把人送进死路）`,
      });
    }
  }
  // ★ 棘轮：基线里"已经不需要"的条目必须删掉，否则这份账会烂在原地
  for (const ref of allow.keys()) {
    if (stillNeeded.has(ref)) continue;
    docProblems.push({
      rule: 'I',
      file: 'DOC_REF_ALLOW',
      line: 0,
      msg: `基线里的 \`${ref}\` 已不再需要（文件已存在，或文案里已不再引用）⇒ 从 \`DOC_REF_ALLOW\` 删掉这一条`,
    });
  }
  return { scanned, skipped, refs: refCount, problems: docProblems };
}

// ════════════════════════════════════════════════════════════════════
// A–D. 设计册里的散文当结构 ＋ 汇总输出（**只在被当脚本跑时执行** —— 可 import 是测试的前提）
// ════════════════════════════════════════════════════════════════════
async function main() {
const { scanned, countProblems, suppressions } = scanHardcodedCountsAside();
// ★★ 窗口豁免必须**带分母显形**（2026-11-06 复核 D）：丢弃允许，看不见不允许（0.12 可诊断性）。
const exemptLine = suppressionSummary(suppressions);
// ★ H：计数型判据的**自指污染**（与 E/G 同一条退出码 ⇒ 检测点入口数 +0，0.25②）
const selfPollution = checkSelfPollutingCounts(ROOT);
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

const guardProblems = checkDocStructureGuards(ROOT);
const tierProblems = await checkScriptTierGuards(ROOT);
// ★ I（P0-3）：文案里的 `docs/*.md` 必须存在（与 E/G/H 同一条退出码 ⇒ 检测点入口数 +0，0.25②）
const docRefs = checkDanglingDocRefs(ROOT);
const all = [...problems, ...countProblems, ...guardProblems, ...tierProblems, ...selfPollution.problems, ...docRefs.problems];

if (JSON_OUT) {
  const nFeatures = fs.existsSync(DESIGN_DIR) ? fs.readdirSync(DESIGN_DIR).filter((x) => x.endsWith('.dsl.json')).length : 0;
  console.log(
    JSON.stringify(
      {
        checked_features: nFeatures,
        checked_files: scanned.length,
        checked_doc_guards: DOC_STRUCTURE_GUARDS.length,
        problems,
        hardcoded_counts: countProblems,
        /** ★ 被窗口限定词放行的命中（带分母）—— 丢弃允许，看不见不允许 */
        hardcoded_counts_suppressed: { summary: exemptLine, items: suppressions },
        doc_structure_guards: guardProblems,
        script_tier_guards: tierProblems,
        self_referential_counts: {
          scanned_files: selfPollution.scanned,
          skipped_files: selfPollution.skipped,
          count_points: selfPollution.points.length,
          plain_needle_points: selfPollution.plainPoints.length,
          files_with_points: selfPollution.filesWithPoints,
          problems: selfPollution.problems,
        },
        dangling_doc_refs: {
          scanned_files: docRefs.scanned,
          skipped_files: docRefs.skipped,
          refs: docRefs.refs,
          allow: DOC_REF_ALLOW.length,
          problems: docRefs.problems,
        },
      },
      null,
      2,
    ),
  );
} else if (COUNT_ONLY) {
  console.log(`[lint:prose-as-structure] 写死计数：${countProblems.length} 处（只报不判，扫了 ${scanned.length} 个文件）· ${exemptLine}`);
  for (const p of countProblems) console.log(`  · ${p.file}:${p.line}  ${p.msg}`);
} else if (all.length === 0) {
  console.log(
    `[lint:prose-as-structure] ✓ 无问题（散文没有当结构用；注释/文档里没有**未豁免**的写死计数 · ${exemptLine}；文档结构守卫 ${DOC_STRUCTURE_GUARDS.length} 条全绿；读数脚本分层守卫无问题；自指度量污染 ${selfPollution.problems.length} 处 —— 扫 ${selfPollution.scanned} 个文件 / 计数型判据点 ${selfPollution.points.length} 个（其中纯字面针 ${selfPollution.plainPoints.length} 个）/ 真有计数点的文件 ${selfPollution.filesWithPoints} 个 / 判不了跳过 ${selfPollution.skipped} 个；悬空文档引用 ${docRefs.problems.length} 处 —— 扫 ${docRefs.scanned} 个文件 / 文案引用 ${docRefs.refs} 条 / 基线 ${DOC_REF_ALLOW.length} 条 / 判不了跳过 ${docRefs.skipped} 个）`,
  );
} else {
  console.log(
    `[lint:prose-as-structure] ✗ ${all.length} 处：散文当结构 ${problems.length} 处 · 写死计数 ${countProblems.length} 处（${exemptLine}） · 文档结构守卫 ${guardProblems.length} 处（守卫共 ${DOC_STRUCTURE_GUARDS.length} 条） · 读数脚本分层守卫 ${tierProblems.length} 处 · 自指度量污染 ${selfPollution.problems.length} 处（计数型判据点 ${selfPollution.points.length} 个，纯字面针 ${selfPollution.plainPoints.length} 个） · 悬空文档引用 ${docRefs.problems.length} 处（扫 ${docRefs.scanned} 个文件 / 文案引用 ${docRefs.refs} 条）`,
  );
  for (const p of all.slice(0, 40)) {
    if (p.rule === 'E') console.log(`  · [E] ${p.file}:${p.line}\n      ${p.msg}`);
    else if (p.rule === 'F') console.log(`  · [F] 守卫#${p.guard} ${p.file}${p.line ? ':' + p.line : ''}\n      ${p.msg}`);
    else if (p.rule === 'G') console.log(`  · [G] 读数脚本分层 ${p.file}\n      ${p.msg}`);
    else if (p.rule === 'H') console.log(`  · [H] 自指度量污染 ${p.file}:${p.line}\n      ${p.msg}`);
    else if (p.rule === 'I') console.log(`  · [I] 悬空文档引用 ${p.file}${p.line ? ':' + p.line : ''}\n      ${p.msg}`);
    else console.log(`  · [${p.rule}] ${p.feature}/${p.id}\n      ${p.msg}`);
  }
  if (all.length > 40) console.log(`  …另有 ${all.length - 40} 处`);
}
// ★ `--count-only` 只报不拦（调口径期用）；上线形态 = 有命中即退 1
return COUNT_ONLY ? 0 : all.length ? 1 : 0;
}

/** 本文件是被**当脚本跑**（而不是被 import）吗？—— 决定要不要执行 `main()` */
// ★ 2026-11-17（T-#JUNCTION-SCRIPT-NOOP）：裸比在 junction 下恒 false（argv[1] 软链形态 vs import.meta.url 已 realpath）⇒ main 静默不执行、exit 0 假绿。
//   改用物理路径归一的唯一实现 scripts/lib/path_identity.mjs#samePath（verify.mjs 先例）。
function isMain() {
  return Boolean(process.argv[1]) && samePath(process.argv[1], import.meta.url);
}

if (isMain()) process.exit(await main());
