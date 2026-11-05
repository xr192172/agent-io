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
 * `process.exitCode = 1`）∧ ③ 不是构建/安装/生成/演示类。
 * ★ ② 必须字面量：这是"它会用退出码判真假"的最小证据。放宽成"任意条件退出"实测得 28 而不是 17，
 *   两个口径数的是**两个人群**，所以口径本身是判据，写死在这里、不在调用方各写一份。
 *
 * ## 边界（0.17①，都是**声明**不是遗漏）
 * · 只数 `scripts/*.mjs` **顶层**；`scripts/mcp/`（`mcp_scan.mjs` 是 GATES 的一道门）与 `scripts/lib/` 不在分母里；
 * · `scripts/*.py` / `go` / `third_party/` 不在口径；
 * · 「跑过没人看」判不了（tier A 只保证跑）—— 那一档归 `verify.mjs#READOUT_ANCHORS` 与 AGENTS 0.16；
 * · 「最后一次被调用」**仓里没有账本**（`usage.jsonl` 记的是**工具**调用，不是脚本）⇒ 一律报「拿不到」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** ① 判定语汇：一个脚本"会判真假"的最小证据面（报告里逐条给命中的词）。 */
export const VERDICT_VOCAB_RE = /[✓✗]|通过|违例|不通过|\bpass\b|\bfail\b|untrusted|\btrusted\b|★红|★绿/;

/** ② 条件性非零退出：**字面量**形态（口径写死在这里，不在调用方各写一份）。 */
export const CONDITIONAL_EXIT_RE = /process\.exit\(\s*1\s*\)|process\.exitCode\s*=\s*1\b/;

/** ③ 构建 / 安装 / 生成 / 演示类：它们"退 1"不是判真假，是"生成失败"。 */
export const BUILD_CLASS_RE = /install|setup|demo|clean|^gen[-_]|grammar_shim|net_probe/i;

/** 登记表（"我声明它故意没有消费者 / 这道门验的是什么"的唯一住处）。 */
export const REGISTRY_REL = 'scripts/script-tiers.registry.json';

/**
 * 一个脚本的三条判据命中情况（**逐条给**，好让人复核口径，而不是相信结论）。
 * @returns {{file:string, verdictVocab:boolean, conditionalExit:boolean, buildClass:boolean,
 *   isReading:boolean, vocabHits:string[], exitHits:string[]}}
 */
export function classifyReading(file, text) {
  const src = String(text ?? '');
  const verdictVocab = VERDICT_VOCAB_RE.test(src);
  const conditionalExit = CONDITIONAL_EXIT_RE.test(src);
  const buildClass = BUILD_CLASS_RE.test(String(file ?? ''));
  return {
    file,
    verdictVocab,
    conditionalExit,
    buildClass,
    isReading: verdictVocab && conditionalExit && !buildClass,
    vocabHits: [...new Set(src.match(new RegExp(VERDICT_VOCAB_RE.source, 'g')) ?? [])].slice(0, 4),
    exitHits: [...new Set(src.match(new RegExp(CONDITIONAL_EXIT_RE.source, 'g')) ?? [])].slice(0, 3),
  };
}

/**
 * 纯函数：把一份"仓的事实快照"分成三档 + 给问题清单。
 *
 * ★ 做成纯函数是为了让**鉴别力能被合成输入证明**（`tests/p0_script_tiers.test.ts` 造一个假 tier C
 *   喂进来，不必往真仓里写文件）。真仓那一趟由 {@link collect} 现取。
 *
 * @param {{files:string[], texts:Record<string,string>, npmScripts:Record<string,string[]>,
 *   auto:Record<string,string[]>, other:Record<string,string[]>,
 *   gates:Array<Record<string,any>>, gateNotes:Record<string,{verifies?:string,false_green?:string}>,
 *   readoutGates:string[], declarations:Record<string,{status?:string,reason?:string,evidence?:string}>}} input
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

  const rows = [];
  for (const file of files) {
    const cls = classifyReading(file, input.texts?.[file]);
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
  const closure = byTier.A + byTier.B + byTier.C;
  if (closure !== rows.length) {
    problems.push({ code: 'CLOSURE', file: 'scripts/', msg: `分母不闭合：A+B+C = ${closure} ≠ 总数 ${rows.length} ⇒ 三个数里必有一个是错的` });
  }

  return {
    total: rows.length,
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
    gateRows,
    rows,
    problems,
  };
}

/** 读 package.json 的 scripts，反解出每个 `scripts/X.mjs` 有哪些 npm 别名。 */
export function npmAliasesOf(root) {
  const out = {};
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch (e) {
    return { aliases: out, error: `读不到 package.json（${e instanceof Error ? e.message : String(e)}）` };
  }
  for (const [name, body] of Object.entries(pkg.scripts ?? {})) {
    const m = /scripts[\\/]([\w.\-]+\.mjs)/.exec(String(body));
    if (m) (out[m[1]] ??= []).push(name);
  }
  return { aliases: out, error: '' };
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
  const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs')).sort();
  const texts = {};
  for (const f of files) texts[f] = fs.readFileSync(path.join(scriptsDir, f), 'utf8');

  const { aliases, error: npmError } = npmAliasesOf(root);
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

  const report = analyze({ files, texts, npmScripts: aliases, auto, other, gates, gateNotes, declarations, readoutGates });
  return { ...report, gates, gatesError, npmError, registryError: regError, ciScanned, warnings };
}
