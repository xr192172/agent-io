/**
 * lane 无 IO 门 —— ★ [C] 层（`src/registry/lanes/*.ts`）**只管路由，不许自己读写文件**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它（用户 2026-09-29 的诊断）
 * ─────────────────────────────────────────────────────────────
 *   > 「他曾经已经做过好几次收敛了，但是收敛不起来。不过那可能是因为**当时其实是接口性的收敛**。」
 * 本仓实证：`rename_symbols` 的 [C] 是**薄转发**（落盘在 [B] `rename_symbol.ts` 里），
 * 而**另一支局部改名入口**的 [C] **自己 readFileSync + writeFileSync**（该支已于 2026-09-29 并入
 * `rename_symbols`，见 `src/registry/lanes/refactor.ts` 头注释）—— 于是它同样的"落盘"少了三样：
 *   · 没有 `dry_run`（不能先看后写）
 *   · 没有写前快照（**不可撤回**）
 *   · 没有索引写穿（改完立刻读，可能读到旧索引）
 * ⇒ "收敛"只做到了**接口**层面（工具名/参数一样），**内核**层面各写各的 ⇒ 收敛不起来。
 *
 * 这道门守的就是内核那一半：**IO 只能在 [B]，[C] 只能路由**。
 * 判据可 grep、可判红、与文件位置无关 —— 新增一个 lane 只要自己碰了文件，门立刻红。
 *
 * ─────────────────────────────────────────────────────────────
 * 与既有门的分工（别重复）
 * ─────────────────────────────────────────────────────────────
 *   - G1（`server_registry.tool_snapshot.test.ts`）：对外契约（name/title/description/inputSchema）。
 *   - G8（`tool_behavior_snapshot.test.ts`）：逐工具行为不退化（真跑起来看输出）。
 *   - G4（`single_source.test.ts`）：同族**副本**棘轮。本门管的是"**IO 出现在哪一层**"，
 *     不是"同一段代码被抄了几份"—— 一个 lane 里独一份的 `writeFileSync`，G4 抓不到，本门抓。
 *   - lane 来源门（`lane_sources.test.ts`）：工具**归属**的唯一来源。与本门无交集。
 *
 * ─────────────────────────────────────────────────────────────
 * 出生证（§4.11：新门必须逐个制造它能抓的错，确认会红）
 * ─────────────────────────────────────────────────────────────
 *   正面：往一个 lane 里注入一处 `readFileSync` ⇒ 门变红。
 *   对照①：注入一个**干净** lane ⇒ 不该红（证明不是「见文件就红」）。
 *   对照②：IO 字样**只出现在注释里** ⇒ 不该红（证明判据是"代码行" ——
 *          否则本门会因为**记录历史的注释**而假红；本仓 G4 第一版正是这么翻的车）。
 *   ★ 注入物落在**临时目录**而不是真 `src/registry/lanes/`：真目录同时被
 *     `lane_sources.test.ts` 盯着（它断言该目录里的 `.ts` 文件名 == 六条线 id）。
 *     探针文件若在进程被强杀时残留（`gate_probe` 的残留自清只扫 `src/`、`tests/` 的**顶层**），
 *     下一次跑就会让**另一扇门**带着一个看不懂的原因假红 —— 本门不该给别人制造这种耦合。
 *     探针跑的是本门**真正用的** `scanLaneIo` + `ratchetDiff`，只换了扫描根；
 *     "扫的是真目录且非空"由 §① 单独兜。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ratchetDiff, type RatchetDiff } from '../helpers/ratchet.js';
import { findCodeMatches } from '../helpers/source_scan.js';
import { expectGateGoesRed, expectGateStaysGreen } from '../helpers/gate_probe.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');
const LANES_DIR = path.join(REPO, 'src', 'registry', 'lanes');
const REGISTRY = path.join(here, '..', 'fixtures', 'lane_no_io.json');

export interface LaneNoIoRegistry {
  note: string;
  /** 「什么算文件 IO」的正则源码 —— ★ 判据的唯一来源（门直接拿它 `new RegExp`，不另存一份） */
  pattern: string;
  /** 棘轮基线：文件 → IO 命中**行数**（只允许减少） */
  frozen: Record<string, number>;
  /** ★ 带理由的逐文件豁免（命中了 pattern 但**不是**该内化的 IO 时用；理由须非空） */
  allow?: Record<string, string>;
}

function readRegistry(): LaneNoIoRegistry {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as LaneNoIoRegistry;
}

/** 目录里的 `.ts` 文件（真去读磁盘，不用代码里的记忆 —— §4.3） */
export function laneFilesIn(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
}

/**
 * 扫一个目录下的 `.ts` 文件 → 文件（相对 `repoRoot` 的 posix 路径）→ **IO 命中行数**（仅非零；allow 已排除）。
 * 计**行数**而非出现次数：同一行里写两次 IO 与写一次，是同一处"这里在做 IO"。
 */
export function scanLaneIo(dir: string, reg: LaneNoIoRegistry, repoRoot: string = REPO): Record<string, number> {
  const re = new RegExp(reg.pattern);
  const hits: Record<string, number> = {};
  for (const f of laneFilesIn(dir)) {
    const abs = path.join(dir, f);
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (reg.allow && rel in reg.allow) continue; // ★ 带理由的豁免（见登记表 allow）
    const n = findCodeMatches(fs.readFileSync(abs, 'utf8'), re).length;
    if (n > 0) hits[rel] = n;
  }
  return hits;
}

const isRed = (d: RatchetDiff): boolean => d.added.length > 0 || d.grown.length > 0;
const render = (d: RatchetDiff): string => `added=${JSON.stringify(d.added)} grown=${JSON.stringify(d.grown)}`;

/** 出生证用的合成登记表：基线空（任何命中都算"新增"），豁免空 —— 不读真登记表，出生证才不随它漂移 */
function synthReg(pattern: string): LaneNoIoRegistry {
  return { note: '（合成，仅出生证用）', pattern, frozen: {}, allow: {} };
}

describe('lane 无 IO 门 · 门自身有效（证明它不哑、也不误伤）', () => {
  it('① 门读到的目录非空、且真读到了内容（防"门读到空 ⇒ 空过"，§4.3）', () => {
    expect(fs.existsSync(LANES_DIR), `lane 目录不存在：${LANES_DIR}`).toBe(true);
    const files = laneFilesIn(LANES_DIR);
    expect(files.length, 'lane 目录里一个 .ts 都没读到 —— 门会静默全绿').toBeGreaterThan(0);
    for (const f of files) {
      expect(fs.readFileSync(path.join(LANES_DIR, f), 'utf8').length, `${f} 是空的？`).toBeGreaterThan(0);
    }
  });

  it('② 判据不是哑的：真 IO 代码行会被判命中（拿门真正用的 scanLaneIo 跑）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-no-io-self-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), "const s = fs.readFileSync(p, 'utf8');\n", 'utf8');
      const hits = scanLaneIo(dir, synthReg(readRegistry().pattern), dir);
      expect(hits['a.ts'], '含 readFileSync 的行没被判命中 ⇒ 判据是哑的').toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('③ 棘轮比较器本身：新增/增长即红、减少不红（复用 tests/helpers/ratchet.ts，不另写一套）', () => {
    expect(isRed(ratchetDiff({}, { 'x.ts': 1 }))).toBe(true);
    expect(isRed(ratchetDiff({ 'x.ts': 1 }, { 'x.ts': 2 }))).toBe(true);
    expect(isRed(ratchetDiff({ 'x.ts': 2 }, { 'x.ts': 1 }))).toBe(false);
  });
});

describe('lane 无 IO 门 · 出生证（注入 ⇒ 变红；对照项 ⇒ 不放红）', () => {
  const pattern = readRegistry().pattern;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-no-io-probe-'));
  /** 每个探针一个子目录（子目录里放一个 lane 文件）；还原 = 删掉整个探针根 */
  const mkProbe = (name: string, content: string): string => {
    const dir = path.join(tmpRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lane.ts'), content, 'utf8');
    return dir;
  };
  const run = (dir: string): RatchetDiff => ratchetDiff(synthReg(pattern).frozen, scanLaneIo(dir, synthReg(pattern), dir));

  it('注入一处 IO（readFileSync）⇒ 门变红', () => {
    const dir = path.join(tmpRoot, 'probe-io');
    expectGateGoesRed({
      name: 'lane 无 IO 门',
      mutate: () => mkProbe('probe-io', "import fs from 'node:fs';\nconst s = fs.readFileSync('a', 'utf8');\n"),
      run: () => run(dir),
      isRed,
      render,
      restore: () => fs.rmSync(dir, { recursive: true, force: true }),
    });
  });

  it('对照①：注入一个**干净** lane ⇒ 门不该红', () => {
    const dir = path.join(tmpRoot, 'control-clean');
    expectGateStaysGreen({
      name: 'lane 无 IO 门（对照项：干净 lane）',
      mutate: () => mkProbe('control-clean', 'export const x = 1;\n'),
      run: () => run(dir),
      isRed,
      render,
      restore: () => fs.rmSync(dir, { recursive: true, force: true }),
    });
  });

  it('对照②：IO 字样**只在注释里** ⇒ 门不该红（判据是代码行，不惩罚记录历史的注释）', () => {
    const dir = path.join(tmpRoot, 'control-comment');
    expectGateStaysGreen({
      name: 'lane 无 IO 门（对照项：注释里的 IO 字样）',
      mutate: () =>
        mkProbe('control-comment', '// 以前这里是 readFileSync/writeFileSync\n/** rmSync 同理 */\nexport const x = 1;\n'),
      run: () => run(dir),
      isRed,
      render,
      restore: () => fs.rmSync(dir, { recursive: true, force: true }),
    });
  });

  it('出生证过后注入物已还原（三个探针子目录都不在）', () => {
    for (const name of ['probe-io', 'control-clean', 'control-comment']) {
      expect(fs.existsSync(path.join(tmpRoot, name)), `探针没被还原：${name}`).toBe(false);
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});

describe('lane 无 IO 门 · 判据（存量不拦，新增即红）', () => {
  const reg = readRegistry();

  it('登记表本身健康（note / pattern 非空；allow 必须带非空理由且文件存在）', () => {
    expect(reg.note.length, 'note 太短，写不清判据的由来').toBeGreaterThan(20);
    expect(reg.pattern.length, 'pattern 为空 ⇒ 门会静默全绿').toBeGreaterThan(10);
    for (const [file, why] of Object.entries(reg.allow ?? {})) {
      expect(why?.trim().length ?? 0, `对 ${file} 的豁免没写理由（不许用豁免掩盖分叉）`).toBeGreaterThan(10);
      expect(fs.existsSync(path.join(REPO, file)), `豁免了一个不存在的文件：${file}`).toBe(true);
    }
  });

  it('lane 文件不 import node:fs（连"引用 fs"都不许 —— IO 只能在 [B]）', () => {
    const offenders: string[] = [];
    for (const f of laneFilesIn(LANES_DIR)) {
      const src = fs.readFileSync(path.join(LANES_DIR, f), 'utf8');
      if (findCodeMatches(src, /from\s+['"]node:fs['"]/).length > 0) offenders.push(f);
    }
    expect(offenders, `这些 lane 仍直接依赖 node:fs：${offenders.join(', ')}（请把 IO 下沉到 [B]）`).toEqual([]);
  });

  it('★ src/registry/lanes/*.ts 里不出现文件 IO（存量不拦、新增即红）', () => {
    const actual = scanLaneIo(LANES_DIR, reg);
    const d = ratchetDiff(reg.frozen, actual, (f) => fs.existsSync(path.join(REPO, f)));

    expect(
      d.added,
      '这些 lane 文件**新增了**文件 IO（[C] 只该路由，不该读写文件）：\n' +
        `判据 pattern：${reg.pattern}\n` +
        '请把"读 → 算 → 写"整段下沉到 [B]，落盘走 tools/apply_writes.ts 的 applyWrites；\n' +
        '若确实不该内化（如本质是 [A] 层的合法读），写进 tests/fixtures/lane_no_io.json 的 allow 并写明理由。\n  ' +
        d.added.join('\n  '),
    ).toEqual([]);

    expect(
      d.grown.map((g) => `${g.file} ${g.was} → ${g.now}`),
      `已知的 lane IO 又多出来了：\n  ${d.grown.map((g) => `${g.file}: ${g.was} → ${g.now}`).join('\n  ')}`,
    ).toEqual([]);
  });

  it('登记表里不留已消失的文件（lane 搬迁后必须同步登记表）', () => {
    const stale = Object.keys(reg.frozen).filter((f) => !fs.existsSync(path.join(REPO, f)));
    expect(stale, `登记表引用了不存在的文件：\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('★ 零容忍哨兵：当前 frozen 为空 —— 任何 lane IO 都该改，而不是登记', () => {
    // 这条不是"防回退"，是**把本笔的结论钉住**：起点是 refactor.ts 6 / cross.ts 1（另有 existsSync 各 1），
    // 本笔已逐处内化 ⇒ 基线为空。它红了只有两种可能：① 有人在 lane 里新写了 IO（那本就该红，见上一条）；
    // ② 有人把新 IO 塞进 frozen 当豁免 —— 那是把棘轮当逃逸口，这里当场戳穿。
    expect(
      Object.keys(reg.frozen),
      'frozen 不为空 —— 若确属"存量"请在本哨兵里写明理由并经人审；否则请内化掉它',
    ).toEqual([]);
  });
});
