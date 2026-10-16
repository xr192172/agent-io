#!/usr/bin/env node
/**
 * check-receipt —— ★ 回执**五栏完整性**检查器（`docs/preflight-checklist.md` C0 的可执行版）。
 *
 * ## 为什么要有它（对应 `docs/frictions.jsonl` 滞涩 #3）
 * C0 早就定了"派活必须要求五栏回执"（① 做了什么 ② 判据读数 ③ `[未核]` ④ 行为改变 ⑤ 滞涩报告），
 * 但**它只是一段文字约定，没人检查** ⇒ ★ 子代理照旧只回一句"已修好"，主代理只能自己重跑核验
 * （实测：其中 1 次抓到"报真绿而实际 `unsupported=2`"）。
 * ⇒ 本脚本把 C0 从"文字"变成"**可判的读数**"：**缺栏 ⇒ 退出码 1**。
 *
 * ## ★★ 判定用**纯规则**，不用 LLM（可复现）
 * 规则逐条写在这里（★ 按"若必须宽松匹配，把规则写出来"的要求）：
 *
 *   | # | 栏名        | 命中规则（命中**任一**即算"该栏在"） |
 *   |---|---|---|
 *   | ① | 做了什么    | JSON 行输入：`what` 字段是非空字符串；文本输入：`/(做了什么|改动|交付|回执)\s*[:：]/` |
 *   | ② | 判据读数    | 标签 `/(判据读数|读数|验收读数|evidence)\s*[:：]/i`，**或**读数令牌 `/(exit\s*[=:：]?\s*-?\d)|(PASS\s*=\s*\d)|(FAIL\s*=\s*\d)|(md5)|(mtime)/i` |
 *   | ③ | `[未核]`    | 字面量 `/\[未核\]/`，**或** `/(未核项|未核)\s*[:：]/` |
 *   | ④ | 行为改变    | `/行为(改变\|变化)/` |
 *   | ⑤ | 滞涩报告    | `/(滞涩报告\|滞涩)\s*[:：]/` |
 *
 *   ★ 三条要点（否则规则会被读成"凭感觉"）：
 *   1. **标签要**写出来**，写"无"也算** —— ③④⑤**即使没有内容也必须显式写**（如 `[未核] 无` / `滞涩报告：无`）。
 *      理由：C0 要的是"**如实说**"，而"没写"与"写了没有"在回执里**长得一样** ⇒ 只能要求显式写。
 *   2. ②的"读数令牌"是**兜底**（让那些直接贴 `exit=0` / `PASS=10 FAIL=0` / `md5 …` 的回执也能过），
 *      它**不**放行散文式描述（"已修好"既无标签也无令牌 ⇒ 仍判缺）。
 *   3. **JSON 行输入**（`docs/accounting.jsonl` 的一行）里，①直接取 `what` 字段
 *      （该格式本来就有"做了什么"这个独立字段）⇒ 不必在 `note` 里重复写标签；②③④⑤ 在 `note` 里查。
 *
 * ## 用法
 * ```
 * node scripts/check-receipt.mjs <文件>      # 纯文本回执 / 一份 .jsonl（逐行判）/ 一个 JSON 对象
 * node scripts/check-receipt.mjs -           # 从 stdin 读
 * ```
 * ★ 退出码：**0 = 五栏齐；1 = 缺栏**。★ 多行文件：**任一行缺栏 ⇒ 1**（逐行给读数）。
 */
import fs from 'node:fs';

const NL = String.fromCharCode(10);

/** ★ 五栏规则（唯一派生处：下面的判定与说明都从这里取，不再各写一遍谓词）。 */
const COLUMNS = [
  { n: '①', name: '做了什么', rule: 'JSON: what 字段非空 · 文本: /(做了什么|改动|交付|回执)\\s*[:：]/' },
  { n: '②', name: '判据读数', rule: '标签 /(判据读数|读数|验收读数|evidence)\\s*[:：]/i 或读数令牌 /(exit\\s*[=:：]?\\s*-?\\d)|(PASS\\s*=\\s*\\d)|(FAIL\\s*=\\s*\\d)|(md5)|(mtime)/i' },
  { n: '③', name: '[未核]', rule: '字面量 /\\[未核\\]/ 或 /(未核项|未核)\\s*[:：]/' },
  { n: '④', name: '行为改变', rule: '/行为(改变|变化)/' },
  { n: '⑤', name: '滞涩报告', rule: '/(滞涩报告|滞涩)\\s*[:：]/' },
];

const LABEL_DID = /(做了什么|改动|交付|回执)\s*[:：]/;
const LABEL_EVIDENCE = /(判据读数|读数|验收读数|evidence)\s*[:：]/i;
const TOKEN_EVIDENCE = /(exit\s*[=:：]?\s*-?\d)|(PASS\s*=\s*\d)|(FAIL\s*=\s*\d)|(md5)|(mtime)/i;
const LABEL_UNCHECKED = /\[未核\]|(未核项|未核)\s*[:：]/;
const LABEL_BEHAVIOR = /行为(改变|变化)/;
const LABEL_FRICTION = /(滞涩报告|滞涩)\s*[:：]/;

/**
 * 判一份回执的五栏。
 * @param {string} text 回执正文（JSON 行输入时 = `note`，且 `what` 单独给）
 * @param {string|null} what JSON 行输入的 `what` 字段（文本输入传 null）
 * @returns {{present: boolean[], missing: string[]}}
 */
function judge(text, what) {
  const s = String(text ?? '');
  const present = [
    what != null ? String(what).trim() !== '' : LABEL_DID.test(s), // ①
    LABEL_EVIDENCE.test(s) || TOKEN_EVIDENCE.test(s), // ②
    LABEL_UNCHECKED.test(s), // ③
    LABEL_BEHAVIOR.test(s), // ④
    LABEL_FRICTION.test(s), // ⑤
  ];
  return { present, missing: COLUMNS.filter((_, i) => !present[i]).map((c) => `${c.n}${c.name}`) };
}

// ── 读输入 ──
const arg = process.argv[2];
if (!arg) {
  console.error('用法：node scripts/check-receipt.mjs <文件|-（stdin）>');
  process.exit(2);
}
const raw = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');

// ★ 统一成"回执行"：JSONL 逐行 / 单个 JSON 对象 / 纯文本
/** @type {{label:string, text:string, what:string|null}[]} */
let receipts = [];
const tryJson = (t) => {
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};
const whole = tryJson(raw.trim());
if (whole) {
  receipts = [{ label: 'JSON 对象', text: whole.note ?? whole.text ?? '', what: whole.what ?? null }];
} else {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isJsonl = lines.length > 0 && lines.every((l) => tryJson(l));
  if (isJsonl) {
    receipts = lines.map((l, i) => {
      const o = tryJson(l);
      return { label: `第 ${i + 1} 行（jsonl）`, text: o.note ?? o.text ?? '', what: o.what ?? null };
    });
  } else {
    receipts = [{ label: '纯文本', text: raw, what: null }];
  }
}

console.log(`回执完整性检查（五栏）—— ${arg === '-' ? 'stdin' : arg}   ★ 纯规则，无 LLM`);
let anyFail = false;
for (const r of receipts) {
  const { present, missing } = judge(r.text, r.what);
  const ok = missing.length === 0;
  anyFail = anyFail || !ok;
  console.log(`${NL}  [${r.label}] ${ok ? '✓ 5/5 栏齐' : `★ 缺 ${missing.length} 栏`}`);
  COLUMNS.forEach((c, i) => {
    console.log(`    ${present[i] ? '✓' : '✗'} ${c.n} ${c.name}${present[i] ? '' : '   ← 缺'}`);
  });
  if (!ok) {
    console.log(`    ⇒ 缺栏：${missing.join(' · ')}`);
    // ★ 缺失时把该栏的判定规则打出来（"可判依据"要能自足，读者不必翻文件头）
    for (const c of COLUMNS.filter((c) => missing.includes(`${c.n}${c.name}`))) {
      console.log(`       ${c.n}${c.name} 规则：${c.rule}`);
    }
  }
}
const total = receipts.length;
const pass = receipts.filter((r) => judge(r.text, r.what).missing.length === 0).length;
console.log(`${NL}完整性：${pass}/${total} 份回执五栏齐`);
console.log(anyFail ? '★ 有回执缺栏 ⇒ 退出码 1' : '✓ 五栏齐 ⇒ 退出码 0');
process.exit(anyFail ? 1 : 0);
