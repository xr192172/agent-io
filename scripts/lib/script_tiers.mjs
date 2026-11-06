#!/usr/bin/env node
/**
 * 读数脚本的分层（A / B / C）—— **唯一实现**（`scripts/audit-script-tiers.mjs` 只渲染，
 * `scripts/lint-prose-as-structure.mjs` 的规则 G 只判红，两边都调这里）。
 *
 * ## 它治的病（0.9.4 推论③ 的形态）
 * 「`npm run <script>` 能跑」被**读成**「有人跑」。实测原型在 `scripts/contract-calls.mjs:97`：
 *   注释逐字「script ⇒ package.json 的 scripts 里必须有这个键（**有人跑**）」——
 *   于是"键在" ⇒ "有人跑" ⇒ 凭证消失在**人的自觉**上。
 * ⇒ 本模块把"谁在跑它"拆成**三档 + 分母**，让"靠自觉"那一档**显形**（不是把它们都变成自动门 ——
 *   那会让总门跑一小时以上；本模块的产物是**读数**，不是新门）。
 *
 * ## 三档（逐条都读现成的表，不 grep 源码文本）
 * · **A 自动门**：有一条「保证会被跑到」的边 —— `verify.mjs#GATES` 直接指它 · 或某道门的**内表**
 *   用 `npm run <键>` 再跑一层 · 或 CI workflow 直调。⇒ 真消费者。
 * · **B 有人会跑**：不在 A，但有 `package.json#scripts` 的人工入口（或被别的手动脚本 spawn）。
 *   ⇒ ★ **没有任何东西保证它跑过** —— 这就是本卡要显形的那一档。
 * · **C 纯装饰**：三者都没有。⇒ 要么给它一条边，要么在登记表里**声明**它是什么（见下）。
 *
 * ## ★ 排序（本卡的裁定，与"孤儿最危险"的直觉相反）
 * **tier A 里的假绿 > tier B 的假 assure > tier C 的纯孤儿**：
 *   假绿给人**最强**的 assuredness（"已经在自动跑了"），而本仓实测三例全在 A 里
 *   （`npx tsc` 取到占位包退 0 · 通过腿印 `用例 6/6` 而真值 422/422 · 结构门指向已删脚本永远红）。
 * ⇒ 所以 A 档**不许一句"自动门"带过**：每道门必须逐条给「它跑到的到底是什么 / 读数锚点有没有 /
 *   SKIP 条件 / 退出码几算通过 / 已知假绿形态」五列，缺一行即红（`GATE_NOTES_MISSING`）。
 *
 * ## 为什么"一条边都不许自己拼"（0.20）
 * 三张「谁跑谁」的声明表**都已经在册**：`verify.mjs#GATES`（已 `export`）· `docs-facts-check.mjs#CHECKS`
 * （值是 npm script 名，不是文件名 ⇒ 按文件名 grep **永远数不到它**）· DSL 的
 * `task_plan.invariant_checks[].cmd`。第四条边是 `.github/workflows/*.yml` 的 `node scripts/X.mjs`。
 * ⇒ 本模块**读这些表**，**不**扫 `npm run` 文本；读不到一律报"拿不到"，绝不回落成"没有"（0.9.4 第 1 行）。
 *
 * ## 口径（写死在代码里，改动即改变分母）
 * 读数脚本 = ① 有**判定语汇** ∧ ② 有**条件性非零退出**（**字面量** `process.exit(1)` /
 * `process.exitCode = 1`，且**语法树上真有这个节点**）∧ ③ 不是构建/安装/生成/演示类。
 *
 * ★★ ② **判在 AST 上，不判在文本上**（2026-11-06 复核 R73 那一族）。为什么必须换：
 *   文本级把**注释**也算命中 ⇒ `measure_b_contract.mjs` 里唯一一处匹配是第 683 行那句注释
 *   「`// ★ 不再 \`process.exitCode = 1\`（见上）。`」——它把「我们**不再**这么干」读成了「它这么干」。
 *   ⇒ 这条口径要问的是「**代码里**有没有这个语句」，那就只能在语法树上问（AGENTS 0.18①：
 *     同一事实在 AST 层可得，就不许再从文本里取一遍）。
 * ★★ 为什么不走"剥注释再判"：`src/domain/text_strip.ts#stripComments`（片段权威）在
 *   **模板串里嵌套模板串**上会失步 —— 实测 `measure_b_contract.mjs` 的 683 行**原样保留**
 *   （679-681 行是 `` `${…map((n) => \`…\`)}` `` 这种嵌套，字符扫描器在内层反引号处提前闭合外层）。
 *   ⇒ 若在这里剥注释，改完后读数**一动不动（17 → 17）**，而没人会怀疑它 —— 那就是一次静默的假绿。
 *   ⇒ 结论：这一腿的权威是 **AST**，不是任何文本剥离器。
 *
 * ★ ② 仍必须是**字面量 1**：放宽成"任意条件退出"实测得 28 而不是 17 —— 两个口径数的是**两个人群**
 *   （`gen_manifest` / `gen_cognition` / `gen_dsl_schema` 用 `process.exit(ok ? 0 : 1)`，不进这一档）。
 *
 * ★★ ③ **不是按名字一刀切**（2026-11-06 复核）：`gen-db-check.mjs`（GATES 第 7 道门「设计 DB 结构」的门本体）
 *   与 `gen-facts.mjs`（「文档与事实」的子检查、且 tier A）都被 `^gen[-_]` 误排除 ⇒ **数字对、人群错**。
 *   判据改成一条可判的特征：**这类名字里，若它存在「check 角色」的调用，退 1 就是判定、不是生成失败**。
 *   「check 角色」只从**已有的两张表现取**（不手写白名单）：① package.json 里指向它的某个 script 体含
 *   `--check`；② 它直接是 `verify.mjs#GATES` 的靶。
 *
 * ## 三份"代码 / 注释"判别的分工（0.9.1④：按输入形状选，不按名字选）
 * · **本文件的 AST 腿**：输入是**代码文本**、要问"这段是语句还是注释/字符串" ⇒ 语法树说了算；
 * · **`src/domain/text_strip.ts#stripComments`**：输入是**片段**（没有 filePath）⇒ 片段权威；本文件**不用**它；
 * · **`src/infrastructure/parse/comments.ts#stripCommentsSync`**：有 filePath 的整文件场景 ⇒ 整文件权威。
 * ★ 第三份存在的理由 + **欠账**：前两份在 `.mjs`（模板串嵌套）上都不够用（见上），而 `scripts/` 要跑在
 *   `npm run build` **之前** ⇒ 用不了需要 dist 的那一份。⇒ 已报主控，并进 **R6**（剥注释统一）那条台账。
 *
 * ## 边界（0.17①，都是**声明**不是遗漏）
 * · 只数 `scripts/*.mjs` **顶层**；`scripts/mcp/`（`mcp_scan.mjs` 是 GATES 的一道门）与 `scripts/lib/` 不在分母里；
 *   ★ package.json 的反向查（`NPM_ENTRY_DEAD`）同口径：正则只认平层 `scripts/X.mjs`，子目录入口**不查**；
 * · `scripts/*.py` / `go` / `third_party/` 不在口径；
 * · ① 判定语汇仍是**文本**判（它要问的正是"文件里有没有判真假的措辞"，措辞天然住在字符串与注释里）；
 *   但只靠注释里的「✓/✗」**不足以**入选 —— ② 已在 AST 上把"只是写在注释里"挡掉；
 * · 「跑过没人看」判不了（tier A 只保证跑）—— 那一档归 `verify.mjs#READOUT_ANCHORS` 与 AGENTS 0.16；
 * · 「最后一次被调用」**仓里没有账本**（`usage.jsonl` 记的是**工具**调用，不是脚本）⇒ 一律报「拿不到」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** ① 判定语汇：一个脚本"会判真假"的最小证据面（报告里逐条给命中的词）。 */
export const VERDICT_VOCAB_RE = /[✓✗]|通过|违例|不通过|\bpass\b|\bfail\b|untrusted|\btrusted\b|★红|★绿/;

/**
 * ② 的**文本形态** —— ★ 只用于**诊断**（"文本命中 / AST 命中"不一致 ⇒ 命中的是注释），**不参与判定**。
 * 判定走 {@link conditionalExitOf}（AST）。留着它是因为"文本说有一处、AST 说没有"正是这类事故的现场。
 */
export const CONDITIONAL_EXIT_RE = /process\.exit\(\s*1\s*\)|process\.exitCode\s*=\s*1\b/;

/** ③ 构建 / 安装 / 生成 / 演示类的**名字**类：只在这一类**缺 check 角色**时才排除（见 {@link classifyReading}）。 */
export const BUILD_CLASS_RE = /install|setup|demo|clean|^gen[-_]|grammar_shim|net_probe/i;

/** "check 角色"的 npm 侧判据：script 体里带 `--check`（如 `node scripts/gen-facts.mjs --check`）。 */
export const CHECK_FLAG_RE = /(?:^|\s)--check\b/;

/** 登记表（"我声明它故意没有消费者 / 这道门验的是什么"的唯一住处）。 */
export const REGISTRY_REL = 'scripts/script-tiers.registry.json';

/** 一个 AST 节点所在的行（1-based）。 */
function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * ② 的**判定核**：语法树上有没有一处 **字面量 1** 的 `process.exit(1)` / `process.exitCode = 1`。
 *
 * ★ 为什么是 AST 而不是正则（口径见文件头）：正则会把**注释**里的同一串也算命中。
 * ★ 返回 `null` = **这文件里没有**（注释里的不算）；返回 `{parseErrors}` = 语法树有解析错
 *   ⇒ 调用方必须把它**算进分母并显形**，不许当成"没有"（0.9.4 第 1 行）。
 * @returns {{found: {line:number, form:string}|null, parseErrors:number}}
 */
export function conditionalExitOf(file, text) {
  const src = String(text ?? '');
  const sf = ts.createSourceFile(String(file ?? 'x.mjs'), src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const parseErrors = (sf.parseDiagnostics ?? []).length;
  const isOne = (n) => Boolean(n) && ts.isNumericLiteral(n) && n.text === '1';
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const e = n.expression;
      if (
        ts.isIdentifier(e.expression) &&
        e.expression.text === 'process' &&
        e.name.text === 'exit' &&
        n.arguments.length >= 1 &&
        isOne(n.arguments[0])
      ) {
        found = { line: lineOf(sf, n), form: 'process.exit(1)' };
        return;
      }
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      ts.isIdentifier(n.left.expression) &&
      n.left.expression.text === 'process' &&
      n.left.name.text === 'exitCode' &&
      isOne(n.right)
    ) {
      found = { line: lineOf(sf, n), form: 'process.exitCode = 1' };
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { found, parseErrors };
}

/**
 * 一个脚本的三条判据命中情况（**逐条给**，好让人复核口径，而不是相信结论）。
 *
 * @param {string} file 文件名（相对 `scripts/`；③ 的名字类与 check 角色都按它判）
 * @param {string} text 文件全文
 * @param {{checkRole?: boolean}} [opts] `checkRole` = 这个文件有没有「check 角色」的调用
 *   （由 {@link npmCheckRoleFilesOf} + `verify.mjs#GATES` 现取，调用方算好传进来 —— 本函数是纯函数）
 * @returns {{file:string, verdictVocab:boolean, conditionalExit:boolean, buildClassName:boolean,
 *   buildClass:boolean, checkRole:boolean, isReading:boolean, vocabHits:string[], exitHits:string[],
 *   exitAt:{line:number,form:string}|null, textOnlyExit:boolean}}
 */
export function classifyReading(file, text, opts = {}) {
  const src = String(text ?? '');
  const checkRole = Boolean(opts.checkRole);
  const verdictVocab = VERDICT_VOCAB_RE.test(src);
  const { found, parseErrors } = conditionalExitOf(file, src);
  const conditionalExit = Boolean(found);
  // ★ 文本命中而 AST 没命中 ⇒ 那句只写在注释里（读数里点名，别让它悄悄变成一个"差一点就入选"）
  const textOnlyExit = CONDITIONAL_EXIT_RE.test(src) && !conditionalExit;
  const buildClassName = BUILD_CLASS_RE.test(String(file ?? ''));
  const buildClass = buildClassName && !checkRole;
  return {
    file,
    verdictVocab,
    conditionalExit,
    buildClassName,
    buildClass,
    checkRole,
    isReading: verdictVocab && conditionalExit && !buildClass,
    vocabHits: [...new Set(src.match(new RegExp(VERDICT_VOCAB_RE.source, 'g')) ?? [])].slice(0, 4),
    exitHits: [...new Set(src.match(new RegExp(CONDITIONAL_EXIT_RE.source, 'g')) ?? [])].slice(0, 3),
    exitAt: found,
    textOnlyExit,
    parseErrors,
  };
}

/**
 * 纯函数：把一份"仓的事实快照"分成三档 + 给问题清单。
 *
 * ★ 做成纯函数是为了让**鉴别力能被合成输入证明**（`tests/p0_script_tiers.test.ts` 造一个假 tier C
 *   喂进来，不必往真仓里写文件）。真仓那一趟由 {@link collect} 现取。
 *
 * @param {{files:string[], texts:Record<string,string>, npmScripts:Record<string,string[]>,
 *   diskFiles:string[], checkRoleFiles:string[],
 *   auto:Record<string,string[]>, other:Record<string,string[]>,
 *   gates:Array<Record<string,any>>, gateNotes:Record<string,{verifies?:string,false_green?:string}>,
 *   readoutGates:string[], declarations:Record<string,{status?:string,reason?:string,evidence?:string}>}} input
 *   ★ `diskFiles` = **磁盘上现有哪些 `.mjs`**（独立于 `files` 的第二次观测：`files` 是"要逐项分析哪些"，
 *     `diskFiles` 是"盘上到底有几个"）。**不给 ⇒ 闭合计为"判不了"并判红**（0.9.4 第 1 行），不许静默跳过。
 */
export function analyze(input) {
  const files = [...(input.files ?? [])].sort();
  const npmScripts = input.npmScripts ?? {};
  const auto = input.auto ?? {};
  const other = input.other ?? {};
  const decls = input.declarations ?? {};
  const gateNotes = input.gateNotes ?? {};
  const gates = input.gates ?? [];
  const readoutGates = input.readoutGates ?? [];
  const diskFiles = Array.isArray(input.diskFiles) ? [...input.diskFiles].sort() : null;
  const checkRoleFiles = new Set(input.checkRoleFiles ?? []);

  const rows = [];
  for (const file of files) {
    const cls = classifyReading(file, input.texts?.[file], { checkRole: checkRoleFiles.has(file) });
    const autoEdges = auto[file] ?? [];
    const otherEdges = other[file] ?? [];
    const npm = npmScripts[file] ?? [];
    const decl = decls[file] ?? null;
    // ★ 分层取**最强的那条边**（一个脚本可以同时是 A 又给人手动跑 ⇒ 不许单选，consumer 是**数组**）
    const tier = autoEdges.length ? 'A' : npm.length || otherEdges.length ? 'B' : 'C';
    rows.push({
      file,
      reading: cls.isReading,
      classify: cls,
      tier,
      /** 保证会被跑到的边（tier A 的凭证，**逐条**写清是哪一张表的哪一行） */
      auto: autoEdges,
      /** 人工入口（npm script 名）—— 「有入口」**不**等于「有人跑」 */
      npm,
      /** 被别的手动脚本 spawn（证据，不是声明） */
      other: otherEdges,
      declared: decl && decl.status ? { status: decl.status, reason: decl.reason ?? '' } : null,
    });
  }

  const byTier = { A: 0, B: 0, C: 0 };
  for (const r of rows) byTier[r.tier] += 1;
  const readings = rows.filter((r) => r.reading);

  // ── 问题（只有"该红"的才红；tier B 缺理由**不红**，只显形 —— 否则就是 0.16 的永远会亮的灯）──
  const problems = [];

  // ★ A 档逐门逐列：缺口不许用"自动门"一句带过 —— 那句本身就是这条检查自己的假 assure
  const gateRows = [];
  for (const g of gates) {
    const note = gateNotes[g.name] ?? null;
    const col = {
      name: g.name,
      consumer: g.consumer ?? '',
      tier: g.tier ?? '',
      /** 它跑到的到底是什么（命令现取，不抄散文） */
      runs: [g.cmd, ...(g.args ?? [])].filter(Boolean).join(' '),
      targets: gateScriptTargetsOf(g),
      /** 读数锚点：通过时能不能印出一个可核的数（`verify.mjs#READOUT_ANCHORS` 是唯一权威） */
      anchorable: readoutGates.includes(g.name),
      /** SKIP 条件（退出码 2；判不了 ≠ 通过） */
      skip: g.fail ? `构造期就 FAIL：${String(g.fail).slice(0, 60)}…` : g.need ? `缺 ${g.need} 工具链 ⇒ SKIP` : '',
      /** 通过 = 退出码 0；2 是"判不了"，别折成 0 */
      passCode: 0,
      verifies: note?.verifies ?? '',
      falseGreen: note && 'false_green' in note ? note.false_green : null,
    };
    gateRows.push(col);
    if (!g.consumer) problems.push({ code: 'GATE_FIELD_MISSING', file: 'scripts/verify.mjs', msg: `GATES 的门「${g.name}」缺 consumer（谁在跑它）—— 缺它，读者只能猜` });
    if (!g.tier) problems.push({ code: 'GATE_FIELD_MISSING', file: 'scripts/verify.mjs', msg: `GATES 的门「${g.name}」缺 tier（A = 自动门）` });
    if (!note || !String(note.verifies ?? '').trim() || col.falseGreen === null) {
      problems.push({
        code: 'GATE_NOTES_MISSING',
        file: REGISTRY_REL,
        msg: `门「${g.name}」在登记表里没写全「它跑到的到底是什么（verifies）」或「已知假绿形态（false_green，没有就写空串）」⇒ A 档不许只有名字 —— 假绿全在 A 里，一句"自动门"就是这条检查自己的假 assure`,
      });
    }
  }

  for (const r of readings) {
    if (r.tier === 'C' && !r.declared) {
      problems.push({
        code: 'TIER_C_READING',
        file: r.file,
        msg: `读数脚本「${r.file}」一条消费者都没有（不在四条边任一 / 无 npm script / 没人 spawn / 未声明）⇒ 它判真假，而没有任何东西保证它跑过。三条出路：接进 GATES · 加一个 npm script · 在 ${REGISTRY_REL} 里声明它是什么`,
      });
    }
  }
  for (const [file, d] of Object.entries(decls)) {
    if (!files.includes(file) && !gates.some((g) => g.name === file)) {
      problems.push({ code: 'STALE_DECLARATION', file, msg: `登记表里声明了「${file}」，但 scripts/ 下没有这个文件（改名 / 删了？）⇒ 声明已过期，别让它悄悄留着` });
    }
    if (!d || !String(d.reason ?? '').trim()) {
      problems.push({ code: 'STALE_DECLARATION', file, msg: `登记表里「${file}」的 reason 是空的 —— 没有理由的声明等于没有声明` });
    }
  }
  // ── F（2026-11-06 复核）：**package.json 的入口必须指向磁盘上存在的文件** ──
  // 病：`lang:check` / `diff` / `fork` 三个入口指向早已搬走或删掉的脚本（`scripts/check_lang_pkgs.mjs`
  //   · `scripts/design-diff.mjs` · `scripts/fork-design.mjs`），而**这条读数只从磁盘往 package.json 查、
  //   从不反向查** ⇒ 死入口在读数里完全不可见（"npm run <键> 能跑"这件事从来没有被验过）。
  // ★ 挂**已有的**退出码（本模块的 problems ⇒ audit 退 1 ⇒ lint 规则 G ⇒ 「文档与事实」门），不新增门。
  const onDisk = new Set(diskFiles ?? files);
  for (const [file, names] of Object.entries(npmScripts)) {
    if (onDisk.has(file)) continue;
    problems.push({
      code: 'NPM_ENTRY_DEAD',
      file,
      msg: `package.json 的 ${names.map((n) => `\`npm run ${n}\``).join(' / ')} 指向 \`scripts/${file}\`，而**磁盘上没有这个文件** ⇒ 按这个入口跑只会拿到 Cannot find module（"能跑"从来没被验过）。两条出路：删掉这个 script（功能已搬进工具面就删），或者把它指回真实现`,
    });
  }

  // ── A（2026-11-06 复核）：**闭合必须是"分母 == 磁盘现数"这件事本身**，不是"三个数加起来等于行数" ──
  // 病：原来只断 `A+B+C === rows.length`，而 tier 由一句三元表达式赋出（值域恰 {A,B,C}）、byTier 由
  //   **同一批 rows** 自增 ⇒ 该等式**恒真**，它验的是"加法没做错"，不是"分母对不对"。
  // ⇒ 现在的判据是**集合级双向 + 无重复**，右值是**独立入参** diskFiles（不是构造 rows 的那个数组）。
  const closure = byTier.A + byTier.B + byTier.C;
  if (closure !== rows.length) {
    // ★ 绊线：tier 若被改成第四个值 ⇒ byTier[x] 变 NaN ⇒ 求和 ≠ 行数（今天不可达，但它是值域的第二道锁）
    problems.push({ code: 'CLOSURE', file: 'scripts/', msg: `分母不闭合：A+B+C = ${closure} ≠ 总数 ${rows.length} ⇒ 三个数里必有一个是错的` });
  }
  if (!diskFiles) {
    problems.push({
      code: 'CLOSURE',
      file: 'scripts/',
      msg: '磁盘清单（`diskFiles`）**没给** ⇒ 「分母 == 磁盘现数」**判不了**（判不了 ≠ 通过，0.9.4 第 1 行）—— analyze 的调用方必须传它；不传就等于把这条不变量关掉',
    });
  } else {
    const rowFiles = rows.map((r) => r.file);
    const missing = diskFiles.filter((f) => !rowFiles.includes(f));
    const extra = rowFiles.filter((f) => !diskFiles.includes(f));
    const dup = [...new Set(rowFiles.filter((f, i) => rowFiles.indexOf(f) !== i))];
    if (missing.length) {
      problems.push({ code: 'CLOSURE', file: 'scripts/', msg: `磁盘上有 ${missing.length} 个 .mjs **没进 rows**：${missing.join('、')} ⇒ 分母漏算（"分析过的"比"盘上的"少）` });
    }
    if (extra.length) {
      problems.push({ code: 'CLOSURE', file: 'scripts/', msg: `rows 里有 ${extra.length} 个条目**磁盘上没有**：${extra.join('、')} ⇒ 分母虚高（"分析过的"比"盘上的"多）` });
    }
    if (dup.length) {
      problems.push({ code: 'CLOSURE', file: 'scripts/', msg: `有 ${dup.length} 个文件各占了不止一行：${dup.join('、')} ⇒ 分母虚高（同一条边被数了两遍）` });
    }
  }

  return {
    total: rows.length,
    /** ★ 分母的第二条腿（0.12③）：磁盘上现数 —— 与 `total` 必须相等（不等就是 CLOSURE 那条红） */
    diskCount: diskFiles ? diskFiles.length : null,
    readingCount: readings.length,
    tiers: byTier,
    /** 已声明（informational / manual-only）的条目数 —— 是 C 档的**减法**，不是第四档 */
    declared: rows.filter((r) => r.declared).length,
    /** 读数脚本自己的三档（卡片的关注面就在这一层） */
    readingTiers: {
      A: readings.filter((r) => r.tier === 'A').length,
      B: readings.filter((r) => r.tier === 'B').length,
      C: readings.filter((r) => r.tier === 'C').length,
    },
    /** ★ 显形项：B 档里**没声明理由**的（不红，但要数出来 —— 这个数只该降） */
    tierBUnreasoned: rows.filter((r) => r.tier === 'B' && !r.declared).length,
    /**
     * ★ 显形项（2026-11-06）：**只写在注释里**的「条件性退出」（文本命中 ∧ AST 没命中）。
     * 它们**不是**读数脚本，但读数里必须看得见 —— 那正是"口径换层"当场生效的证据
     * （实测原型：`measure_b_contract.mjs` 第 683 行那句「不再 `process.exitCode = 1`」）。
     */
    textOnlyExit: rows.filter((r) => r.classify.textOnlyExit).map((r) => ({ file: r.file, hits: r.classify.exitHits })),
    /** ★ 显形项：带 check 角色而被名字类放行的（口径 ③ 的现取凭证） */
    checkRoleFiles: [...checkRoleFiles].sort(),
    gateRows,
    rows,
    problems,
  };
}

/**
 * 读 package.json 的 scripts，反解出每个 `scripts/X.mjs` 有哪些 npm 别名 + 哪些别名是**check 角色**。
 *
 * ★ `checkRoles` 就是口径 ③ 的 npm 侧判据：script 体含 `--check`（`node scripts/gen-facts.mjs --check`）。
 *   它是"这个文件的退 1 是判定还是生成失败"的**可判特征**，不是手写白名单。
 */
export function npmAliasesOf(root) {
  const out = {};
  const checkRoles = {};
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch (e) {
    return { aliases: out, checkRoles, error: `读不到 package.json（${e instanceof Error ? e.message : String(e)}）` };
  }
  for (const [name, body] of Object.entries(pkg.scripts ?? {})) {
    const m = /scripts[\\/]([\w.\-]+\.mjs)/.exec(String(body));
    if (!m) continue;
    (out[m[1]] ??= []).push(name);
    if (CHECK_FLAG_RE.test(String(body))) (checkRoles[m[1]] ??= []).push(name);
  }
  return { aliases: out, checkRoles, error: '' };
}

/** GATES 里一道门直接指到的 `scripts/*.mjs`（只认整串；`scripts/mcp/x.mjs` 不在口径内）。 */
export function gateScriptTargetsOf(gate) {
  const out = [];
  for (const a of gate.args ?? []) {
    const m = /^scripts[\\/]([\w.\-]+\.mjs)$/.exec(String(a));
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * 一个门脚本的**内表**：它 spawn `npm run <变量>` 时，被跑的是它自己表里的那些 npm script 名。
 * ★ 三条同时成立才算（缺一就是猜）：① 文件里 spawn `npm run` ② 该名是 package.json 的键
 *   ③ 它出现在某个 `[...]` 字面量里（= 一张表）。这一层正是 GATES 看不见的那一段：
 * `docs-facts-check.mjs#CHECKS` 就在这里（几个 npm script 名被 verify 自动跑到，名字却不在 GATES 里）。
 */
export function npmSubScriptsOf(text, pkgScriptNames) {
  const src = String(text ?? '');
  if (!/['"]npm['"]\s*,\s*\[\s*['"]run['"]/.test(src)) return [];
  const names = new Set(pkgScriptNames);
  const found = new Set();
  for (const blk of src.matchAll(/\[[^[\]]*(?:\[[^[\]]*\][^[\]]*)*\]/g)) {
    for (const q of blk[0].matchAll(/'([\w:.\-]+)'/g)) if (names.has(q[1])) found.add(q[1]);
  }
  return [...found];
}

/** 扫 `scripts/*.mjs` 里的真 spawn 边（**证据**：同一行既有 spawn/exec 又有 `scripts/X.mjs` 字面量）。 */
export function spawnEdgesOf(files, readText) {
  const out = {};
  const SPAWN_RE = /spawnSync|spawn\(|execFileSync|execFile\(|execSync|child_process/;
  for (const f of files) {
    const lines = String(readText(f) ?? '').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!SPAWN_RE.test(line)) return;
      for (const m of line.matchAll(/scripts[\\/]([\w.\-]+\.mjs)/g)) {
        if (m[1] === f) return;
        (out[m[1]] ??= []).push(`${f}:${i + 1}`);
      }
    });
  }
  return out;
}

/** 登记表（缺文件 ⇒ 空表 + 空 error；读坏 ⇒ 空表 + error，**不静默**）。 */
export function readRegistry(root) {
  const abs = path.join(root, REGISTRY_REL);
  try {
    const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return { gates: doc.gates ?? {}, declarations: doc.declarations ?? {}, error: '' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { gates: {}, declarations: {}, error: /ENOENT/.test(msg) ? '' : `读不到登记表 ${REGISTRY_REL}（${msg}）` };
  }
}

/** CI workflow 里 `node scripts/X.mjs` 的直调 —— 第四条边（`judge-gate.yml` 就是这么跑 judge-all 的）。 */
export function ciEdgesOf(root) {
  const dir = path.join(root, '.github', 'workflows');
  const out = {};
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n));
  } catch {
    return { edges: out, scanned: 0 };
  }
  for (const n of names) {
    const text = fs.readFileSync(path.join(dir, n), 'utf8');
    for (const m of text.matchAll(/node\s+scripts[\\/]([\w.\-]+\.mjs)/g)) (out[m[1]] ??= []).push(`ci:.github/workflows/${n}`);
  }
  return { edges: out, scanned: names.length };
}

/**
 * 现取整份快照（唯一 I/O 入口）。
 * ★ GATES 走 **import**（它已 `export`）—— 不 grep 源码文本（0.20 / 0.18①）。
 */
export async function collect(root) {
  const scriptsDir = path.join(root, 'scripts');
  // ★★ 两次**独立** readdir（2026-11-06 复核 A）：一个是"要逐项分析哪些"（files / rows 的来源），
  //   另一个是"盘上到底有几个"（diskFiles / 闭合的右值）。同一个调用里算出来的两个数**必然相等** ——
  //   那不是不变量，那是恒真。分开取一次，才是"分母对得上盘"这件事本身。
  const diskFiles = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs')).sort();
  const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs')).sort();
  const texts = {};
  for (const f of files) texts[f] = fs.readFileSync(path.join(scriptsDir, f), 'utf8');

  const { aliases, checkRoles, error: npmError } = npmAliasesOf(root);
  const pkgNames = Object.values(aliases).flat();

  const warnings = [];
  if (npmError) warnings.push(npmError);

  let gates = [];
  let readoutGates = [];
  let gatesError = '';
  try {
    const mod = await import(pathToFileURL(path.join(scriptsDir, 'verify.mjs')).href);
    const raw = mod.GATES ?? [];
    gates = raw.map((g) => (typeof g === 'function' ? g(root) : g));
    readoutGates = (mod.READOUT_ANCHORS ?? []).map((e) => e.gate);
  } catch (e) {
    gatesError = `读不到 verify.mjs#GATES（${e instanceof Error ? e.message : String(e)}）⇒ 「自动门」这一档**拿不到**，不是「没有」`;
    warnings.push(gatesError);
  }

  // 边 1：GATES 直指
  const auto = {};
  for (const g of gates) for (const f of gateScriptTargetsOf(g)) (auto[f] ??= []).push(`verify.mjs#GATES:${g.name}`);
  // 边 2：门脚本自己的内表（GATES 看不见的那一段）
  for (const g of gates) {
    for (const f of gateScriptTargetsOf(g)) {
      for (const sub of npmSubScriptsOf(texts[f], pkgNames)) {
        const target = Object.entries(aliases).find(([, names]) => names.includes(sub))?.[0];
        if (target) (auto[target] ??= []).push(`npm run ${sub}（由门「${g.name}」的内表跑）`);
      }
    }
  }
  // 边 3：CI 直调
  const { edges: ciEdges, scanned: ciScanned } = ciEdgesOf(root);
  for (const [f, v] of Object.entries(ciEdges)) for (const e of v) (auto[f] ??= []).push(e);

  // 证据边：被别的手动脚本 spawn
  const other = spawnEdgesOf(files, (f) => texts[f]);

  const { gates: gateNotes, declarations, error: regError } = readRegistry(root);
  if (regError) warnings.push(regError);

  // ★ 口径 ③ 的「check 角色」= **两张现成的表**取并集：npm 体含 `--check` ∪ 是 GATES 的靶。
  //   不手写白名单（0.9.1 方向A）；也不按名字猜（`gen-db-check.mjs` 的 npm 体里没有 `--check`，
  //   它是靠"GATES 第 7 道门直接指它"进来的）。
  const gateTargets = new Set();
  for (const g of gates) for (const f of gateScriptTargetsOf(g)) gateTargets.add(f);
  const checkRoleFiles = [...new Set([...Object.keys(checkRoles), ...gateTargets])].sort();

  const report = analyze({ files, texts, npmScripts: aliases, diskFiles, checkRoleFiles, auto, other, gates, gateNotes, declarations, readoutGates });
  const parseErrors = report.rows.filter((r) => r.classify.parseErrors > 0).map((r) => `${r.file}（${r.classify.parseErrors} 处）`);
  if (parseErrors.length) warnings.push(`有 ${parseErrors.length} 个文件的语法树带解析错 ⇒ 它们的「② 条件性退出」可能少判：${parseErrors.join('、')}`);
  return { ...report, gates, gatesError, npmError, registryError: regError, ciScanned, npmCheckRoles: checkRoles, warnings };
}
