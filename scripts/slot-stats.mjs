#!/usr/bin/env node
/**
 * slot-stats —— 「人工必填槽（F）」的**读数命令**（本仓唯一读端）
 *
 * ## 它回答的问题
 * `edit_dsl` 的 `OP_SPECS` 一共要求多少个 `data` 槽？其中**多少个只能由人/模型给**（`model`）？
 * 一次**完整取卡链**实际用到其中几个？⇒ 那就是 `F`（人工必填槽数）的量级。
 *
 * ## 它**不是**判据（这个区分是本卡最要紧的一条）
 * `F` 是**读数**：它说明量级、进日志、供人和工具去发掘。
 * 真正的判据是「**每个 `model` 槽的每个实例，必须有 provider 或显式署名**」——
 * 它住在 `src/application/design/dsl_ops/slot_source.ts#checkSlotSources` 与
 * `tests/p0_slot_source.test.ts`（`--check` 模式就是同一条判据的命令行投影）。
 * ★ 为什么必须分开：「某处数 == N」当门 ⇒ 换个数继续绿（今晚治的就是这个病）。
 *
 * ## 口径只有一个来源
 * 所有数都从 `dist/src/application/design/dsl_ops/slot_source.js` 与 `op_data_spec.js` **现取**
 * （`slotReading(OP_SPECS)`），本命令**不自带**任何键清单、也不手抄 33/39。
 *
 * ## 用法
 *   node scripts/slot-stats.mjs              # 读数（人读）
 *   node scripts/slot-stats.mjs --json       # 机器可读
 *   node scripts/slot-stats.mjs --check      # 判据模式：有违规 ⇒ exit 1
 *
 * ## 退出码
 *   0 = 读数正常 / check 无违规；1 = check 有违规（逐条点名槽）；2 = 读不了（dist 没建）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 从本文件向上找到 `package.json` 且 `name === 'agent-io'` 的目录（包根） */
function packageRootFrom(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        if (JSON.parse(fs.readFileSync(pj, 'utf-8')).name === 'agent-io') return dir;
      } catch {
        /* 坏 package.json ⇒ 继续上溯 */
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(start);
}

const PKG_ROOT = packageRootFrom(HERE);

const SLOT_MODULE = path.join(PKG_ROOT, 'dist/src/application/design/dsl_ops/slot_source.js');
const SPEC_MODULE = path.join(PKG_ROOT, 'dist/src/application/design/dsl_ops/op_data_spec.js');

/**
 * ★ **一次完整取卡链**用到的 `(type, op)` —— 出处不是猜：
 * `AGENTS.md §一`（写判据 → plan → claim → edit_code → judge → complete）+ `docs/PITFALLS.md P5`，
 * 真实批次见 `.agentio-data/dogfood/usage.jsonl`（2026-10-26T04:56:20 一次 `edit_dsl` 5 个操作里含
 * `claim`(被拒：需 data.reason) + `publish`(被拒：判据逐字相同)，04:56:44 同批次转绿）。
 * ★ `task/publish` 不收 data（0 槽）⇒ 只列有槽的那几组。
 */
const CARD_CHAIN = [
  { group: 'decision/update', why: '写判据（AGENTS §一 第一步）' },
  { group: 'task/claim', why: '领卡（唯一咽喉，owner ← actor）' },
  { group: 'task/complete', why: '收口（evidence ← 判据批回执）' },
];

/** 建新文件时才多走一步（`docs/PITFALLS.md P22`：新文件必须先入册再写）。 */
const NEW_FILE_CHAIN = [{ group: 'file/add', why: 'P22 入册新文件（path + responsibility）' }];

function fail(msg) {
  console.error(msg);
  return 2;
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const asCheck = argv.includes('--check');

  for (const f of [SLOT_MODULE, SPEC_MODULE]) {
    if (!fs.existsSync(f)) {
      return fail(
        `✗ 找不到 ${f}\n  ⇒ 先构建：cmd /c "npm run build"（本命令**不许**自带一份键清单，否则就是两处权威）`,
      );
    }
  }
  const slot = await import(pathToFileURL(SLOT_MODULE).href);
  const spec = await import(pathToFileURL(SPEC_MODULE).href);

  const reading = slot.slotReading(spec.OP_SPECS);
  const violations = slot.checkSlotSources(spec.OP_SPECS);
  const chainManual = (chain) =>
    chain.reduce((a, c) => {
      const [type, op] = c.group.split('/');
      return a + slot.manualSlotsOf(spec.OP_SPECS, type, op).length;
    }, 0);
  const chainSlots = (chain) =>
    chain.reduce((a, c) => {
      const [type, op] = c.group.split('/');
      return a + slot.requiredKeysOf(spec.OP_SPECS, type, op).length;
    }, 0);

  const chainF = chainManual(CARD_CHAIN);
  const chainWithFileF = chainManual([...CARD_CHAIN, ...NEW_FILE_CHAIN]);

  if (asJson) {
    console.log(
      JSON.stringify(
        { reading, violations, chain: { groups: CARD_CHAIN.map((c) => c.group), slots: chainSlots(CARD_CHAIN), manual: chainF }, chainWithNewFile: { slots: chainSlots([...CARD_CHAIN, ...NEW_FILE_CHAIN]), manual: chainWithFileF } },
        null,
        1,
      ),
    );
    return asCheck && violations.length ? 1 : 0;
  }

  const L = [];
  L.push('══ 人工必填槽读数（slot-stats）══');
  L.push('');
  L.push(`① 逐 (type, op)：required 键数 / 其中 model 数（来源表 = slot_source.ts#SLOT_SOURCES）`);
  for (const g of reading.perGroup) {
    const keys = g.manualKeys.length ? `  ⟵ ${g.manualKeys.join(', ')}` : '';
    L.push(`  ${(g.type + '/' + g.op).padEnd(26)} ${String(g.required).padStart(2)} / ${String(g.manual).padStart(2)}${keys}`);
  }
  L.push('');
  L.push('② 合计（★ 这是 F 的**理论分母**，不是一次调用的成本）');
  L.push(`  (type,op) 组数（required 非空）  ${reading.groups}`);
  L.push(`  required 键槽                    ${reading.slots}`);
  L.push(`  其中 model（要人/模型给）        ${reading.manualSlots}`);
  L.push(
    `  四档分布                         actual-db ${reading.bySource['actual-db']} · design ${reading.bySource.design} · rule ${reading.bySource.rule} · model ${reading.bySource.model}`,
  );
  L.push('');
  L.push('③ 一次完整取卡链实际用到的组（★ 不是全部 39 槽 —— 拿全表当"一次调用成本"必失真）');
  for (const c of CARD_CHAIN) {
    const [type, op] = c.group.split('/');
    L.push(`  ${c.group.padEnd(18)} 槽 ${slot.requiredKeysOf(spec.OP_SPECS, type, op).length} · model ${slot.manualSlotsOf(spec.OP_SPECS, type, op).length}   ← ${c.why}`);
  }
  L.push(`  —— 小计：${chainSlots(CARD_CHAIN)} 槽 · **F_B(链) = ${chainF}**`);
  for (const c of NEW_FILE_CHAIN) {
    const [type, op] = c.group.split('/');
    L.push(`  ${c.group.padEnd(18)} 槽 ${slot.requiredKeysOf(spec.OP_SPECS, type, op).length} · model ${slot.manualSlotsOf(spec.OP_SPECS, type, op).length}   ← ${c.why}（只在建新文件时走）`);
  }
  L.push(`  —— 带建文件：**F_B(链+新文件) = ${chainWithFileF}**`);
  L.push('');
  L.push('  ★ 为什么目标里那条 `F_C ≤ F_B/3` 是坏判据（本卡实测，别再复用）：');
  L.push(`    最小链 F_B = ${chainF} ⇒ F_B/3 = ${(chainF / 3).toFixed(2)} ⇒ 要么恒真（0≤0，一条没量到）要么永远红（槽数是整数）。`);
  L.push('    根因是结构性的：F 只数 **required** 键，而链上最贵的人工内容（decision.expectations 判据文本 /');
  L.push('    rationale）全是**可选**键 ⇒ F 量的是"填表头"，不是"填内容"。');
  L.push('');
  L.push('④ 判据（不是读数）：每个非 model 槽都必须有取法，每个 model 槽都不许有取法');
  if (violations.length === 0) {
    L.push('  ✅ 0 违规（无漏声明 / 无幽灵声明 / 无未兑现 / 无虚报 / 无取法循环）');
  } else {
    L.push(`  ❌ ${violations.length} 条违规：`);
    for (const v of violations) L.push(`     · ${v.code}  ${v.slot}`);
  }
  console.log(L.join('\n'));
  return asCheck && violations.length ? 1 : 0;
}

process.exitCode = await main();
