/**
 * G4 · 单一实现门（同族副本棘轮）—— 重构规划书 §5-G4
 *
 * 病根一句话：**同一意图有多份实现，修正只在原地落地、不横向传播。**
 * 2026-09-28 一天之内，同一把尺子量出三个家族：
 *   · 相对 import 解析：3 份（`579d7ad` 已收成一份）
 *   · type-only 模块语句判定：**5 处**（`c694471` 收了 2 处；`health` 2 处刚收成 1 份常量；
 *     `ts_slim` 1 处按策略差异有意保留）
 *   · "什么算源码扩展名"静态清单：**15 处**，彼此口径不一致
 * 所以这道门不是"一次修完"，而是**棘轮**（与仓内 `check_rules` 同款纪律）：
 *   **存量不拦、新增即红。** 谁再复制第 N+1 份，门立刻红 —— 债务不许增长，
 *   而收敛进度可以一步步来（`579d7ad`/`c694471` 就是这么走的）。
 *
 * ★ 这道门**不假装能自动发现重复**：它只按"登记在册的家族 + 字面模式"在**非注释行**上计数。
 *   声明式登记（`tests/fixtures/single_source_registry.json`）而不是智能检测，理由：
 *   自动发现"意图重复"是不可判定的；而可判定的部分（已知家族的副本数）恰好足够拦住复发。
 *   发现新家族 ⇒ 往登记表里加一条（`intent` 字段写清"同的是什么意图"）。
 *
 * ★ 为什么不扫注释：第一版按全文件裸扫，立刻在**自己的注释里**命中
 *   （`rename_symbol.ts:179` 逐字引用了被修掉的那条旧正则，`kernel.ts:735` 同）——
 *   而注释里引用旧代码是**好实践**，不该被门惩罚。故跳过注释行。
 *   已知限度：行尾注释（`code(); // …`）与字符串字面量里的命中仍会被计数 —— 宁严勿松，
 *   真被误伤时把该文件加进 `frozen` 并在 `intent` 里写明理由。
 *
 * ★ P2 会移动 200 个文件：搬迁后登记表里的路径会失效 ⇒ 会红。**这是有意的** ——
 *   逼你在搬迁时同步更新登记表，而不是让登记表悄悄腐成谎言。
 *
 * 基线的收紧方式（确认债务已还清时）：
 *   UPDATE_SINGLE_SOURCE=1 ./node_modules/.bin/vitest run tests/single_source.test.ts
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..');
const SRC = path.join(REPO, 'src');
const REGISTRY = path.join(here, 'fixtures', 'single_source_registry.json');

export interface Family {
  id: string;
  /** 同的是什么**意图**（不是"同的是一段代码"） */
  intent: string;
  /** 权威实现（仓根相对路径）；null = 权威尚未建立，则全部命中都是存量债务 */
  authority: string | null;
  /** 字面量模式（子串，**不是正则** —— 避免转义歧义；按非重叠出现计数） */
  pattern: string;
  /** 棘轮基线：文件 → 命中数。只允许减少，不允许新增或增长 */
  frozen: Record<string, number>;
}

export interface Registry {
  note: string;
  families: Family[];
}

const rel = (abs: string): string => path.relative(REPO, abs).split(path.sep).join('/');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(f, out);
    else if (e.name.endsWith('.ts')) out.push(f);
  }
  return out;
}

/** 注释行判定：`// …` / `* …`（JSDoc 中行）/ `/* …` —— 跳过，见文件头说明 */
export function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * 把源码里的注释行**置空**（不是删行 —— 保留换行，使跨行的模式仍能匹配），
 * 再统计模式出现次数。纯函数，可单测。
 */
export function countOccurrences(src: string, pattern: string): number {
  if (!pattern) return 0;
  const blanked = src
    .split('\n')
    .map((l) => (isCommentLine(l) ? '' : l))
    .join('\n');
  let n = 0;
  let i = 0;
  while ((i = blanked.indexOf(pattern, i)) >= 0) {
    n += 1;
    i += pattern.length;
  }
  return n;
}

/** 扫描全 src，返回 文件 → 命中数（仅非零；已排除权威文件） */
export function scanFamily(family: Family, srcDir = SRC, repoRoot = REPO): Record<string, number> {
  const hits: Record<string, number> = {};
  for (const abs of walkTs(srcDir)) {
    const r = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (family.authority && r === family.authority) continue;
    const n = countOccurrences(fs.readFileSync(abs, 'utf8'), family.pattern);
    if (n > 0) hits[r] = n;
  }
  return hits;
}

export interface RatchetDiff {
  /** 新增的副本文件（疑似又复制了一份） */
  added: string[];
  /** 已知副本里又多出的命中 */
  grown: Array<{ file: string; was: number; now: number }>;
  /** 债务已减少（好事，但应同步收紧基线） */
  shrunk: Array<{ file: string; was: number; now: number }>;
  /** 基线里的文件已经不再命中（同 shrunk 的极端情形） */
  cleared: string[];
  /** 基线里登记了但文件已不存在（P2 搬迁后必然出现） */
  missing: string[];
}

/** 纯函数：棘轮比较（只允许减少）。单独抽出来以便单测"这扇门会红"。 */
export function ratchetDiff(frozen: Record<string, number>, actual: Record<string, number>, exists = (): boolean => true): RatchetDiff {
  const added = Object.keys(actual).filter((f) => !(f in frozen)).sort();
  const grown: RatchetDiff['grown'] = [];
  const shrunk: RatchetDiff['shrunk'] = [];
  for (const f of Object.keys(frozen).sort()) {
    const was = frozen[f];
    const now = actual[f] ?? 0;
    if (now > was) grown.push({ file: f, was, now });
    else if (now > 0 && now < was) shrunk.push({ file: f, was, now });
  }
  return {
    added,
    grown,
    shrunk,
    cleared: Object.keys(frozen).filter((f) => (actual[f] ?? 0) === 0).sort(),
    missing: Object.keys(frozen).filter((f) => !exists(f)).sort(),
  };
}

function readRegistry(): Registry {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as Registry;
}

describe('G4 · 棘轮比较器自身有效（证明这道门会红）', () => {
  it('新增副本 ⇒ added（红）', () => {
    expect(ratchetDiff({}, { 'src/a.ts': 1 }).added).toEqual(['src/a.ts']);
  });
  it('已知副本又复制一份 ⇒ grown（红）', () => {
    expect(ratchetDiff({ 'src/a.ts': 1 }, { 'src/a.ts': 2 }).grown).toEqual([{ file: 'src/a.ts', was: 1, now: 2 }]);
  });
  it('债务减少 ⇒ 不红，但进 shrunk（提示收紧基线）', () => {
    const d = ratchetDiff({ 'src/a.ts': 2 }, { 'src/a.ts': 1 });
    expect(d.grown).toEqual([]);
    expect(d.shrunk).toEqual([{ file: 'src/a.ts', was: 2, now: 1 }]);
  });
  it('注释行不计、代码行计数（防"注释里引用旧代码"被误伤）', () => {
    const code = 'const t = /^\\s*import\\s+type\\b/.test(x);';
    const comment = '// 此前写的是 /^\\s*import\\s+type\\b/，已收敛';
    expect(countOccurrences(code, 'import\\s+type\\b')).toBe(1);
    expect(countOccurrences(comment, 'import\\s+type\\b')).toBe(0);
    // ★ 出生证：这正是 `rename_symbol.ts:178` 修好之前的那一行
    expect(countOccurrences('const typeOnly = /^\\s*import\\s+type\\b/.test(node.text);', 'import\\s+type\\b')).toBe(1);
  });
});

describe('G4 · 同族副本棘轮（存量不拦，新增即红）', () => {
  const reg = readRegistry();

  it('登记表本身健康（每条家族都有 id / intent / pattern）', () => {
    expect(reg.families.length).toBeGreaterThan(0);
    for (const f of reg.families) {
      expect(f.id, '家族缺 id').toBeTruthy();
      expect(f.pattern, `${f.id} 缺 pattern`).toBeTruthy();
      expect(f.intent.length, `${f.id} 的 intent 太短，写不清"同的是什么意图"`).toBeGreaterThan(10);
    }
    expect(new Set(reg.families.map((f) => f.id)).size).toBe(reg.families.length);
  });

  for (const family of readRegistry().families) {
    it(`[${family.id}] 副本数未增长（${family.intent}）`, () => {
      const actual = scanFamily(family);

      if (process.env.UPDATE_SINGLE_SOURCE === '1') {
        // ★ 必须**重读**登记表再写：逐家族写盘时，若沿用循环外捕获的 `reg`，
        //   后一个家族的写入会把前一个家族刚更新的 frozen 覆盖回旧值。
        const fresh = readRegistry();
        const next: Registry = {
          ...fresh,
          families: fresh.families.map((f) => (f.id === family.id ? { ...f, frozen: actual } : f)),
        };
        fs.writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + '\n', 'utf-8');
        // eslint-disable-next-line no-console
        console.log(`[G4] ${family.id} 基线已更新：${Object.keys(actual).length} 个文件`);
        return;
      }

      const d = ratchetDiff(family.frozen, actual, (f) => fs.existsSync(path.join(REPO, f)));

      expect(
        d.added,
        `[${family.id}] 出现**新的**同族副本（权威：${family.authority ?? '尚未建立'}）。\n` +
          `意图：${family.intent}\n` +
          `请改为复用权威实现；若确实必须保留，把它加进 tests/fixtures/single_source_registry.json 的 frozen 并在 intent 里写明理由。\n  ` +
          d.added.join('\n  '),
      ).toEqual([]);

      expect(
        d.grown.map((g) => `${g.file} ${g.was} → ${g.now}`),
        `[${family.id}] 已知副本里命中变多了（又复制了一段）：\n  ${d.grown.map((g) => `${g.file}: ${g.was} → ${g.now}`).join('\n  ')}`,
      ).toEqual([]);

      if (d.shrunk.length > 0 || d.cleared.length > 0) {
        // 债务还得比基线快 ⇒ 只是提示，不让红（棘轮纪律：只在"新增"上 fail）
        // eslint-disable-next-line no-console
        console.log(
          `[G4] ${family.id} 债务已减少，请收紧基线（UPDATE_SINGLE_SOURCE=1）：` +
            [
              ...d.shrunk.map((s) => `${s.file} ${s.was}→${s.now}`),
              ...d.cleared.map((f) => `${f} 已清零`),
            ].join(', '),
        );
      }
    });
  }

  it('登记表里不留已消失的文件（P2 搬迁后必须同步登记表）', () => {
    const stale: string[] = [];
    for (const f of readRegistry().families) {
      for (const file of Object.keys(f.frozen)) {
        if (!fs.existsSync(path.join(REPO, file))) stale.push(`${f.id}: ${file}`);
      }
    }
    expect(stale, `登记表引用了不存在的文件（搬迁后请更新登记表）：\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
