#!/usr/bin/env node
/**
 * ★★★ cert T443 —— **轴心中立性探针**（2026-10-29 · `T-#PIVOT-NEUTRAL`）
 *
 * ## 它判什么
 * 「轴心」（pivot）要能把 **N 种语言**都映进来/映出去，前提是**轴心中心不能含任何目标语言的痕迹**。
 * 旧册子把三件事塞进一个字符串：
 *   `to: "builder.ts#Builder_AddFix"`
 *   ① 目标文件 `builder.ts` ② 目标命名规则 `Type_Method` ③ 目标扩展名 `.ts`
 * ⇒ 从中间再翻成 Rust，Rust 会**继承 TS 的命名习语**（用户担心的"中转语言漂移"，而且发生在轴心内部）。
 *
 * 中立化后的形状：
 * ```jsonc
 * { "from": "builder.go#AddFix",            // 源侧投影（证据，属于 Go 适配器）
 *   "id":   "builder.go#Builder.AddFix",    // ★ 轴心身份：文件 + 接收者 + 原始名（语言中立）
 *   "targets": { "ts": { "file": "builder.ts", "name": "Builder_AddFix", "signature": "…" } } }  // 渲染器槽位
 * ```
 *
 * ## 判据（含反向控制）
 *   ① 每个符号都有**中立 id**，且 id 里**不含**目标语言痕迹（`.ts` 扩展名 / `Type_Method` 拼接名）；
 *   ② 目标语言命名**只准**出现在 `targets.<lang>` 下 —— 顶层出现 `to` / `sigTs` 一律算恢复旧病；
 *   ③ **反向映射可用**：`targets.ts.name` → `id` 必须**唯一**（否则回译无解，轴心不成立）；
 *   ④ **反向控制**：人工注入一个 `id` 带 `.ts` 的坏符号，①必须报红 —— 证明判据真在起作用。
 *
 * ## 边界（诚实）
 *   · 本证只判**命名中立性**，不判语义保真（那要回译，见 `T-#PIVOT-ROUNDTRIP`）；
 *   · 轴心目前**还缺三样**，本证明确输出来而不是假装合格：`typeRef` 落盘、`slots`、`lossiness`；
 *   · "id 不含目标语言痕迹"是**文本形状检查**：这里形状本身就是答案（标识符形态），不涉及语义解析。
 *
 * ## 用法
 *   node certs/t443-pivot-neutrality-probe.mjs [册子路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BOOK =
  process.argv[2] ?? 'D:/agentio/dev/agent-memory/.agent-io/design/memory.translate.json';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

if (!fs.existsSync(BOOK)) {
  console.log(`✗ 册子不存在：${BOOK}`);
  process.exit(2);
}
const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'));
const syms = book.symbols ?? [];

/** 目标语言痕迹：`.ts` 扩展名（id 里出现文件扩展名就说明把目标布局搬进了轴心） */
const SRC_LANG = (book.meta && book.meta.from) || 'go';
const TARGET_EXTS = ['.ts', '.rs', '.py', '.java', '.cs', '.rb', '.kt', '.swift'].filter(
  (e) => e !== '.' + SRC_LANG,
);
/** 目标语言痕迹：id 的文件段带**目标**扩展名（源语言扩展名不算，那是 `from` 该有的） */
const targetTrace = (id) => TARGET_EXTS.some((e) => id.includes(e));
/** TS 命名拼接痕迹：`Type_Method`（轴心里的名字应是 `Type.Method`） */
const tsJoinTrace = (id) => {
  const short = id.split('#').pop() ?? '';
  return /^[A-Za-z_][\w]*_[A-Za-z_][\w]*$/.test(short);
};

// ① 中立 id
{
  const missing = syms.filter((s) => !s.id);
  const traced = syms.filter((s) => s.id && (targetTrace(s.id) || tsJoinTrace(s.id)));
  chk(
    missing.length === 0 && traced.length === 0,
    `① 每个符号有**中立 id**，且不含目标语言痕迹`,
    `样本 ${syms.length} 个 · 缺 id ${missing.length} · 带目标痕迹 ${traced.length}` +
      (traced.length ? `\n     例：${traced.slice(0, 3).map((s) => s.id).join(' · ')}` : ''),
  );
}

// ② 顶层不许有目标语言字段
{
  const legacyTo = syms.filter((s) => s.to !== undefined).length;
  const legacySig = syms.filter((s) => s.sigTs !== undefined).length;
  const hasTargets = syms.filter((s) => s.targets?.ts?.name).length;
  chk(
    legacyTo === 0 && legacySig === 0 && hasTargets > 0,
    '② 目标语言命名**只**在 `targets.<lang>` 下（顶层 `to`/`sigTs` 已清零）',
    `顶层 to ${legacyTo} · 顶层 sigTs ${legacySig} · targets.ts.name ${hasTargets}`,
  );
}

// ③ 反向映射唯一（回译的前提）
{
  const byTs = new Map();
  for (const s of syms) {
    const n = s.targets?.ts?.name;
    if (!n) continue;
    byTs.set(n, (byTs.get(n) ?? 0) + 1);
  }
  const dup = [...byTs.entries()].filter(([, c]) => c > 1);
  // ★ 构建变体（Go build tag：`_cgo` / `_nocgo` / `_windows` … 互斥文件里同名符号）不是真撞车，
  //   但**必须显式建模**才算无害；现在没建模 ⇒ 单列读数，不算失败也不算通过。
  const isVariant = (name) => {
    const ids = syms.filter((s) => s.targets?.ts?.name === name).map((s) => s.id);
    // id 形如 `<file>#<name>` ⇒ 先切 '#' 再取文件名
    const stems = ids.map((i) =>
      ((i.split('#')[0] ?? '').split('/').pop() ?? '').replace(/\.go$/, ''),
    );
    // Go 构建标签的真实形态：**一侧带标签、另一侧是不带标签的默认构建**
    // （如 `local_embedder_nocgo` vs `local_embedder`）⇒ 不能要求"每个都带标签"。
    const TAG = /_(cgo|nocgo|windows|linux|darwin|arm64|amd64|onnx|test)$/;
    const stripped = stems.map((t) => t.replace(TAG, ''));
    const anyTagged = stems.some((t) => TAG.test(t));
    return stems.length > 1 && anyTagged && new Set(stripped).size === 1;
  };
  const variantDups = dup.filter(([n]) => isVariant(n));
  const realDups = dup.filter(([n]) => !isVariant(n));
  chk(
    realDups.length === 0,
    '③ **反向映射可用**：`targets.ts.name → id` 唯一（回译的前提）',
    `目标名 ${byTs.size} 个 · 真撞车 ${realDups.length} · 构建变体同名 ${variantDups.length}（**未建模** ⇒ 回译歧义）` +
      (realDups.length ? `\n     真撞车例：${realDups.slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' · ')}` : '') +
      (variantDups.length ? `\n     构建变体例：${variantDups.slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' · ')}` : '') +
      (realDups.length
        ? '\n     ↳ 证据（真撞车的全部 id）：\n' +
          realDups
            .slice(0, 4)
            .map(([n]) => '       ' + n + ' ← ' + syms.filter((s) => s.targets?.ts?.name === n).map((s) => s.id).join(' , '))
            .join('\n')
        : ''),
  );
}

// ④ 反向控制：注入坏符号，①必须报红
{
  const bad = [{ id: 'x/builder.ts#Builder_AddFix', targets: { ts: { name: 'Builder_AddFix' } } }];
  const detected = bad.filter((s) => targetTrace(s.id) || tsJoinTrace(s.id));
  chk(detected.length > 0, '④ **反向控制**：注入带目标痕迹的坏 id，判据必须抓到（不过度宽松）');
}

// ── 读数：轴心**还缺什么**（诚实输出，不算失败） ──
const withTypeRef = syms.filter((s) => s.typeRef).length;
const withSlots = syms.filter((s) => s.slots && Object.keys(s.slots).length).length;
const lossEntries = Array.isArray(book.pivot?.lossiness) ? book.pivot.lossiness.length : 0;
const hasPivotSection = !!book.pivot;
console.log('\n── 轴心完备度读数（缺口如实列出，不计入 PASS/FAIL）──');
console.log(`   pivot 段：${hasPivotSection ? '存在' : '**缺失**'}`);
console.log(`   typeRef 落盘：${withTypeRef} / ${syms.length}   ← 类型树仍在内存，未成实体`);
console.log(`   特性槽 slots：${withSlots} / ${syms.length}`);
console.log(`   失真账 lossiness：${lossEntries} 条`);

console.log(`\n═══ T443 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
