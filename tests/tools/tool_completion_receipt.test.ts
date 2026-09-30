/**
 * G11 · 回执产物门 —— 「完成 ⇒ 可验证产物」通则（P-E，规划书 §16.5 / §16.8）
 *
 * ★ 为什么**另立一扇门**，而不是把 G7 直接横向扩到全部工具（这是 P-E 的原话，必须说清）：
 *   G7（`tests/tools/explore_action_wiring.test.ts`）的**判据**是"`case '<action>':` 派发块里必须调用
 *   登记表声明的、从别处 import 的实现符号" —— 它读的是 `src/application/meta/explore_code.ts` 的 **switch 结构**。
 *   绝大多数工具**没有** action 派发表（一个 handler 对一个工具）⇒ 这套判据**结构上套不上去**。
 *   硬扩只能得到两种坏结果之一：① 对无 action 的工具恒真（空门）；② 靠猜去认"实现"（误伤 + 维护地狱）。
 *   但 G7 背后的**纪律**（"宣传 / 宣称完成 ⇒ 必须有真东西"）是**工具面通则** ⇒
 *   换一条**对全部工具都可机械判定**的判据来承载它：**回执通道**。
 *
 * ★ 判据（本门的"机械档"）：每个**注册工具**的回执通道必须是 `wrapData`。
 *   依据（可验证，非意见）——`src/registry/plumbing.ts`：
 *     · `wrapData()` → `message` + `---DATA---` + `JSON.stringify(data)`　⇒ 结构化产物**可达** agent；
 *     · `wrap()`     → `return { text: r.message }`　⇒ **只取 message，静默丢弃 data**。
 *   ⇒ 落在 `wrap` 上的工具**结构上无法**满足「完成 ⇒ 可验证产物」：
 *     它的 diff / 文件清单 / 产物 id 即使被 handler 算出来了，也在**通道层**被丢掉。
 *     （这不是文案问题，是**产物在传输途中蒸发**。）
 *   ⇒ 第三态 `unresolved`：handler 既不是 `wrap`/`wrapData`，也不是能在 `handlers.ts` 里解析到包装器的
 *     具名 handler（工厂 / 裸 arrow）——通道**无法机械判定**，同样**不许新增**。
 *
 * ★ 棘轮纪律（本仓惯例，与 G4 `single_source_registry.json` / 品牌门同款）：**存量不拦、新增即红**。
 *   现有 `wrap`（34 个）与 `unresolved`（2 个）登记为**基线**
 *   （`tests/fixtures/tool_completion_receipt.json`）；基线**只许减不许增**。
 *   谁新增工具落在 `wrap` 上 ⇒ 门红 ⇒ 要么改 `wrapData`，要么**显式**写进基线（一次落笔 = 一次判断）。
 *   收紧基线：UPDATE_RECEIPT_BASELINE=1 ./node_modules/.bin/vitest run tests/tools/tool_completion_receipt.test.ts
 *
 * ★ 与 P-A 门（`tests/registry/receipt_channel.test.ts`）的分工（同根因，不同判据，互补不重复）：
 *   · P-A 门：**正向棘轮** —— "声明为回执类的工具（`RECEIPT_TOOLS`，只许增）**必须**已迁到 `wrapData`"。
 *     它管"该迁的要迁到"，但**不阻止**一个**新**工具又用 `wrap`。
 *   · 本门（G11）：**反向棘轮** —— 覆盖**全部**注册工具，"**任何**工具不得**新增**落进丢数据的通道"。
 *     它管的正是 P-A 留下的横向缺口。两门判据不同、基线不同，合并只会让两边语义都变糊，故不合并。
 *
 * ★ 诚实边界（本门**不验**什么）：
 *   1. 它验的是"**通道能携带结构化产物**"（**必要条件**），**不验**"指纹字段内容对不对 / 真的出现了没有"
 *      ——那要**真调工具看 `---DATA---` 内容**（行为级），属 G8 行为快照域；本门是静态门，刻意不假装能判它。
 *   2. 它**不区分文案质量**：某个 `wrap` 工具的 message 里其实已把 diff 当散文写全，本门也不豁免
 *      （判的是**通道**，不是**文案**）。
 *   3. 它按**源码文本**判（`name:` ↔ `handler:` 绑定），靠"与 `TOOL_DEFS` 交叉核对"防静默错配；
 *      若将来某工具的 `handler:` 写在 `name:` 之前，交叉核对会报"未判定"而不是悄悄错配。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFS } from '../../src/application/tool_registry.js';
// ★ 出生证走共享 helper（`tests/helpers/gate_probe.ts`）：注入 → 跑门真正用的判定 → 断言红 → **必定还原**。
import { expectGateGoesRed, expectGateStaysGreen } from '../helpers/gate_probe.js';
import { laneTexts } from '../helpers/lane_files.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');

const HANDLERS = path.join(REPO, 'src', 'application', 'handlers.ts');
const BASELINE = path.join(here, '..', 'fixtures', 'tool_completion_receipt.json');

/** 回执通道：`wrapData` = 可携带结构化产物；`dropData` = `wrap` 丢弃 data；`unresolved` = 无法机械判定 */
export type Channel = 'wrapData' | 'dropData' | 'unresolved';

export interface LaneSource {
  file: string;
  text: string;
}

export interface Baseline {
  note: string;
  /** 走 `wrap`（通道丢弃 data）的存量工具 */
  dropData: string[];
  /** handler 形态无法机械判定的存量工具（工厂 / 裸 arrow） */
  unresolved: string[];
}

export interface Verdict {
  /** 不在基线里的"不达标"工具 ⇒ 红（新增即红） */
  newNonConforming: Array<{ tool: string; channel: Channel; file: string }>;
  /** 基线里登记、但当下已判定不到的工具名（被删/改名）⇒ 红（强制同步基线） */
  stale: string[];
}

/** 具名 handler → 包装器：`src/registry/handlers.ts` 的 `export const X = wrap|wrapData(` */
export function handlerChannels(handlersText: string): Map<string, Channel> {
  const out = new Map<string, Channel>();
  for (const m of handlersText.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(wrapData|wrap)\s*\(/g)) {
    out.set(m[1], m[2] === 'wrapData' ? 'wrapData' : 'dropData');
  }
  return out;
}

/** 把 `handler:` 之后的表达式头判成通道（有界取头 120 字符，不做长跨度惰性匹配——那会跨进下一个工具） */
function channelOfHandlerExpr(head: string, named: Map<string, Channel>): Channel {
  const h = head.trimStart();
  if (/^handler:\s*wrapData\s*\(/.test(h)) return 'wrapData';
  if (/^handler:\s*wrap\s*\(/.test(h)) return 'dropData';
  const id = h.match(/^handler:\s*([A-Za-z_$][\w$]*)\s*[,)]/);
  if (id && named.has(id[1])) return named.get(id[1])!;
  return 'unresolved';
}

/**
 * 逐工具判回执通道。工具 ↔ handler 的绑定规则：**每个 `handler:` 归给它前面最近的那个 `name:`**
 * （与对象字面量里 `name` 在前的既有写法一致）。绑定是否完整/无错配，由调用方与 `TOOL_DEFS` 交叉核对。
 */
export function classifyChannels(sources: LaneSource[], named: Map<string, Channel>): Map<string, { channel: Channel; file: string }> {
  const out = new Map<string, { channel: Channel; file: string }>();
  for (const { file, text } of sources) {
    const names = [...text.matchAll(/\n\s*name:\s*'([a-z0-9_]+)'\s*,/g)].map((m) => ({ name: m[1], at: m.index! }));
    // ★ 用 lookbehind 让下标**落在 `handler:` 上**（含 `\n` 的话 head 会以换行开头，`^handler:` 永不匹配 ⇒ 全判 unresolved）
    const handlers = [...text.matchAll(/(?<=\n\s*)handler:/g)].map((m) => m.index!);
    for (const hAt of handlers) {
      let owner: string | null = null;
      for (const n of names) {
        if (n.at < hAt) owner = n.name;
        else break;
      }
      if (!owner) continue;
      out.set(owner, { channel: channelOfHandlerExpr(text.slice(hAt, hAt + 120), named), file: path.basename(file) });
    }
  }
  return out;
}

/** 门判定（纯函数）：把"当前通道"与"基线"比出（新增不达标 / 基线腐坏） */
export function judge(channels: Map<string, { channel: Channel; file: string }>, baseline: Baseline): Verdict {
  const known = new Set([...baseline.dropData, ...baseline.unresolved]);
  const newNonConforming = [...channels.entries()]
    .filter(([name, v]) => v.channel !== 'wrapData' && !known.has(name))
    .map(([tool, v]) => ({ tool, channel: v.channel, file: v.file }));
  const stale = [...known].filter((n) => !channels.has(n));
  return { newNonConforming, stale };
}

function readLaneSources(): LaneSource[] {
  return laneTexts().map((t) => ({ file: path.relative(REPO, t.file).split(path.sep).join('/'), text: t.text }));
}

function readBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline;
}

const REGISTERED = [...TOOL_DEFS.map((d) => d.name)].sort();

describe('G11 · 回执产物门（「完成 ⇒ 可验证产物」扩到全部工具）', () => {
  const sources = readLaneSources();
  const named = handlerChannels(fs.readFileSync(HANDLERS, 'utf8'));
  const channels = classifyChannels(sources, named);

  it('检测器自身有效（防"空转绿"）：解析覆盖全部注册工具，且三态都真出现过', () => {
    // ① 覆盖面：判出的工具数 == 注册工具数，且**名字集合逐字相同**（防错配/漏配）
    const parsed = [...channels.keys()].sort();
    expect(parsed, '解析出的工具集合 ≠ TOOL_DEFS —— 门的解析失效或错配了').toEqual(REGISTERED);
    // ② 具名 handler 真解析到了东西
    expect(named.size, '没从 handlers.ts 解析到具名 handler 包装器').toBeGreaterThan(5);
    // ③ ★ 反向：三态都真实存在 —— 证明判据能区分，而不是"见谁都判 wrapData"的哑门
    const byChannel = (c: Channel) => [...channels.values()].filter((v) => v.channel === c).length;
    expect(byChannel('wrapData'), '一个 wrapData 工具都没有？判据可疑').toBeGreaterThan(0);
    expect(byChannel('dropData'), '一个 wrap 工具都没有？判据可疑（wrap 会丢 data，应与 wrapData 区分）').toBeGreaterThan(0);
    expect(byChannel('unresolved'), '一个无法判定的都没有？三态判据可能退化成两态').toBeGreaterThan(0);
  });

  it('★ 棘轮：不得新增"回执拿不到结构化产物"的工具（存量不拦、新增即红）', () => {
    const baseline = readBaseline();
    if (process.env.UPDATE_RECEIPT_BASELINE === '1') {
      // 基线更新（照 G4 的做法）：只在确认债务已还清、或显式接受一笔新债时执行
      const nonConf = [...channels.entries()].filter(([, v]) => v.channel !== 'wrapData');
      const next: Baseline = {
        note: baseline.note,
        dropData: nonConf.filter(([, v]) => v.channel === 'dropData').map(([n]) => n).sort(),
        unresolved: nonConf.filter(([, v]) => v.channel === 'unresolved').map(([n]) => n).sort(),
      };
      fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n', 'utf8');
      // eslint-disable-next-line no-console
      console.log(`[G11] 基线已更新：dropData=${next.dropData.length} unresolved=${next.unresolved.length}`);
      return;
    }
    const v = judge(channels, baseline);
    expect(
      v.newNonConforming,
      `这些工具不在基线里、但回执通道拿不到结构化产物（违反「完成 ⇒ 可验证产物」）：\n` +
        v.newNonConforming.map((x) => `  · ${x.tool}（${x.channel}，${x.file}）`).join('\n') +
        '\n⇒ 改 `wrapData`（让 handler 返回 `data`，字段从**入参/实现结果**派生）；' +
        '\n   若属"handler 形态特殊"（工厂 / 裸 arrow）而无法机械判定 ⇒ 在 tests/fixtures/tool_completion_receipt.json 显式登记（一次落笔 = 一次判断）。',
    ).toEqual([]);
    expect(
      v.stale,
      `基线里登记的这些工具当下判不到（被删/改名？）—— 请同步基线：\n  ${v.stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('基线本身健康：不重名、不重叠、名字是**当下注册**的工具', () => {
    const baseline = readBaseline();
    const all = [...baseline.dropData, ...baseline.unresolved];
    expect(new Set(all).size, `基线里同一工具登记了两次：${all.filter((n, i) => all.indexOf(n) !== i).join(', ')}`).toBe(all.length);
    expect(baseline.note.trim().length, '基线 note 太短，写不清口径').toBeGreaterThan(10);
    const ghost = all.filter((n) => !REGISTERED.includes(n));
    expect(ghost, `基线登记了不存在的工具：${ghost.join(', ')}`).toEqual([]);
    // 基线**只反映不达标者**：不该把已达标的工具也登记进来（否则基线会变成"白名单橡皮图章"）
    const wronglyFrozen = all.filter((n) => channels.get(n)?.channel === 'wrapData');
    expect(wronglyFrozen, `这些工具已达 wrapData，不该留在基线里（请 UPDATE_RECEIPT_BASELINE=1 收紧）：${wronglyFrozen.join(', ')}`).toEqual([]);
  });

  it('债务减少时只提示、不让红（棘轮纪律：只在"新增"上 fail）', () => {
    const baseline = readBaseline();
    const shrunk = [...baseline.dropData, ...baseline.unresolved].filter((n) => channels.get(n)?.channel === 'wrapData');
    if (shrunk.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[G11] 这些工具已迁到 wrapData，请收紧基线（UPDATE_RECEIPT_BASELINE=1）：${shrunk.join(', ')}`);
    }
    // 读数健全性：本门判据应当确实把工具分出了"达标/不达标"两类（不是全绿也不是全红）
    const nonConf = [...channels.values()].filter((v) => v.channel !== 'wrapData').length;
    expect(nonConf).toBeGreaterThan(0);
    expect(nonConf).toBeLessThan(REGISTERED.length);
  });
});

describe('G11 · 出生证（注入一个"本门本该抓到"的工具 ⇒ 门变红；对照项 ⇒ 不放红）', () => {
  // 注入物是**内存里的合成 lane 源码**（不落盘）—— 本门真正用的判定是
  // `classifyChannels` + `judge`，注入合成文本即"跑门真正用的判定"。
  // ★ 刻意**不**往 `src/registry/lanes/` 写临时文件：`tests/registry/lane_sources.test.ts`
  //   会 `readdirSync` 那个目录并被本测试的并行 worker 看见 ⇒ 会造成**别人的门**假红。
  const injected: LaneSource[] = [];
  const syntheticLane = (tool: string, wrapper: 'wrap' | 'wrapData'): string =>
    `export const PROBE_TOOLS = [\n  {\n    name: '${tool}',\n    handler: ${wrapper}(async () => ({ message: 'probe' })),\n  },\n];\n`;

  const base = readBaseline();
  const run = (): Verdict =>
    judge(classifyChannels([...readLaneSources(), ...injected], handlerChannels(fs.readFileSync(HANDLERS, 'utf8'))), base);
  const isRed = (v: Verdict): boolean => v.newNonConforming.length > 0;
  const render = (v: Verdict): string => `newNonConforming=${JSON.stringify(v.newNonConforming.map((x) => x.tool))}`;

  it('注入一个用 `wrap`（丢 data）的新工具 ⇒ 门会红', () => {
    expectGateGoesRed({
      name: 'G11 回执产物门',
      mutate: () => injected.push({ file: '__g11_probe__.ts', text: syntheticLane('g11_probe_wrap_tool', 'wrap') }),
      run,
      isRed,
      render,
      restore: () => {
        injected.length = 0;
      },
    });
  });

  it('对照项：注入一个用 `wrapData` 的新工具 ⇒ 门不该红（证明判据不是"见新工具就红"）', () => {
    expectGateStaysGreen({
      name: 'G11 回执产物门（对照项）',
      mutate: () => injected.push({ file: '__g11_probe_ok__.ts', text: syntheticLane('g11_probe_wrapdata_tool', 'wrapData') }),
      run,
      isRed,
      render,
      restore: () => {
        injected.length = 0;
      },
    });
  });

  it('出生证过后判定回到原状（注入已被还原，且真实工具集不变）', () => {
    expect(injected.length, '注入物没被还原').toBe(0);
    expect([...classifyChannels(readLaneSources(), handlerChannels(fs.readFileSync(HANDLERS, 'utf8'))).keys()].sort()).toEqual(REGISTERED);
  });
});
