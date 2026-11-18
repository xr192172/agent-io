/**
 * P0 · ast_parser 兼容层已下线：能力**搬走了**（T-04-16）且空壳**删掉了**（T-04-16b）
 *
 * ## 它挡的事故
 * 那份 32 行兼容层是 `parse/index.ts` 的同步转手层：几条导出里**只有 `isSupportedFile` 是自有能力**，
 * 其余是 `parseFile` 的换名/转调，以及 `index.ts` 早已有的同名重复再导出。台账判它与 `parse/index.ts`
 * 「相同」⇒ 动作分两段：**搬**（已随 T-04-16 落地，本文件 ① 守）与 **删**（已随 T-04-16b 落地，本文件 ③④ 守）。
 *
 * ## 为什么两半都要判（缺一半就是假绿）
 * 只判「没人 import 了」的话，「兼容层退场」与「能力一起消失」长得一模一样：把 `isSupportedFile` 连同
 * 两个调用点一起删掉，负半照样全绿。所以本文件同时判：
 *   ① 正半 —— `parse/index.ts` 的公开面够得着 `isSupportedFile`，且**行为**与旧实现一致（给输入看输出）；
 *   ② 负半 —— 全仓没有文件再从那份兼容层**取东西**（只匹配模块说明符，带分母）；
 *   ③ 负半 —— 兼容层文件本体**已不在盘上**（`existsSync === false`）；
 *   ④ 负半 —— **全仓**（src · tests · scripts · docs · dogfood · 根级 *.md · structure.domains.json）
 *      **不再指名**那个已删的兼容层；白名单只剩 2 处过去式历史注记（+ 1 处台账未决的追踪器），
 *      按「文件集合 + 每文件命中行数 + 每行必须含的字样」比（**不比行号**；带分母、扫描面自证、针自校验）；
 *   ⑤ 负半 —— 译文册里没有「指向已不存在文件」的**新增**悬空单元（`parse/` 名下 0 + 全册棘轮，带分母）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSupportedFile, parseFile } from '../src/infrastructure/parse/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 兼容层的模块说明符（拆开拼：这个字符串本身不该被负半扫成命中） */
const LEGACY_SPECIFIER = ['parse', 'ast_parser'].join('/');
/** 已下线兼容层的**仓库相对路径**（同样拆开拼：本文件自己不含该串 ⇒ ④ 能扫到自己而不自指） */
const RETIRED_FILE = ['src', 'infrastructure', 'parse', 'ast_parser.ts'].join('/');
/**
 * ④ 的字面针 = 那个已删兼容层的**名字**。
 * ★ 2026-11-06 修：上一版针是 `parse/ast_parser`（带目录前缀）⇒ 散文里只写裸名 `ast_parser`
 *   的命中**不会红**，而这次要防的 5 处里有 3 处只写裸名 ⇒ 针必须认裸名。
 */
const RETIRED_NAME = 'ast_parser';
/**
 * ★ 判据自己的**名字主干**里就含这个名字（`p0_ast_parser_retired`）。它指向一个**存在**的测试文件，
 *   所以它出现在任何地方都**不是**"指向已删模块的指针"（`scripts/test-baseline.json` 明令不许改 ⇒
 *   文件名必须保持；`docs/PITFALLS.md` 的 P18 行也会引它）。
 *   ⇒ 比对前先把这段名字主干从行里剥掉。
 * ★ 剥的是**这个名字主干**，不是把裸名一律放过：只写裸名 `ast_parser` 的行照样命中。
 */
const SELF_STEM = ['p0', 'ast_parser', 'retired'].join('_');
/**
 * ⑤ 全册悬空单元的**存量棘轮**（T-04-16b 实测读数）。
 * ★ 142 是**本卡之前就有的历史存量**（文件被搬走/删除后册里没跟上），它们属于另一张卡；
 *   本卡的责任只有一条：**我删的东西不许留下新悬空** ⇒ 所以是「== 基线（只许降不许升）」，
 *   不是「== 0」。写成 0 会让这张卡的判据天生就红，那等于把别人的债算成自己的失败。
 */
const BOOK_DANGLING_BASELINE = 142;
/** 负半跳过本文件自己：它的注释必须能谈论那个路径，否则说明文字与被判的东西打架 */
const SELF = 'p0_ast_parser_retired.test.ts';

function collectSources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') || e.name.endsWith('.mts') || e.name.endsWith('.mjs')) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

test('① 正半：公开面够得着 isSupportedFile，且行为与旧实现一致', async () => {
  assert.equal(typeof isSupportedFile, 'function', 'parse/index.ts 的公开面没有再导出 isSupportedFile');
  // 旧实现的语义：`'.' + 路径末段` → isSupported()。搬歪了（比如换成 path.extname）这几条就会红。
  assert.equal(isSupportedFile('a.ts'), true, 'a.ts 应当被支持');
  assert.equal(isSupportedFile('nested/dir/b.mts'), true, '嵌套路径的 .mts 应当被支持');
  assert.equal(isSupportedFile('a.nolanguage'), false, '未注册的扩展名不应当被支持');
  // 能力还在：内核真能解析出符号名（整个内核被"搬空"时这条会红，而不只是少一个名字）
  const syms = await parseFile('x.ts', 'export function movedCapabilityProbe() { return 1; }');
  assert.ok(
    syms.some((s) => s.name === 'movedCapabilityProbe'),
    `parseFile 没解析出 movedCapabilityProbe，现取到：${syms.map((s) => s.name).join(',') || '（空）'}`,
  );
});

test('② 负半：全仓没有文件再从那份兼容层取东西（只匹配模块说明符，带分母）', () => {
  const files = [
    ...collectSources(path.join(REPO, 'src')),
    ...collectSources(path.join(REPO, 'tests')),
    ...collectSources(path.join(REPO, 'scripts')),
  ];
  assert.ok(files.length > 0, '一个源文件都没扫到 ⇒ 这个判据是空转（分母为 0 时不许算绿）');
  // ★ 只匹配**模块说明符**（引号包住的那个串）—— 不匹配散文：注释里谈"那个文件"是允许的，
  //   判据问的是"谁 import 它"。裸文本扫会把说明性注释也算成消费者（本判据第一版就栽在这：
  //   实测两条误报都来自本轮新写的注释，而不是任何真实 import）。
  const specifier = new RegExp(`['"][^'"\\n]*${LEGACY_SPECIFIER.replace(/[/\\]/g, '[/\\\\]')}(?:\\.js)?['"]`);
  const hits: string[] = [];
  for (const f of files) {
    if (path.basename(f) === SELF) continue;
    if (specifier.test(fs.readFileSync(f, 'utf-8'))) hits.push(path.relative(REPO, f));
  }
  assert.deepEqual(
    hits,
    [],
    `扫了 ${files.length} 个文件，仍有 ${hits.length} 个在 import ${LEGACY_SPECIFIER}：${hits.join(', ')}`,
  );
});

test('③ 负半：兼容层文件本体已不在盘上', () => {
  assert.equal(
    fs.existsSync(path.join(REPO, RETIRED_FILE)),
    false,
    `${RETIRED_FILE} 仍在盘上 —— 「删」那一半没落地（能力搬走了、空壳还留着，与台账 merge_into 的说法不符）`,
  );
});

/**
 * ④ 的扫描面：**不是"源码树"**，而是"任何会被下一个人读到、并照着去找那个文件的地方"。
 *
 * ★★ 2026-11-06 修（上一版为什么是一台恒绿的机器）：它只扫 src+tests+scripts，而 `collectSources`
 *   还跳过所有 `.` 开头的目录 ⇒ `docs/` · `dogfood/` · 根级 `*.md` · `structure.domains.json`
 *   **自始不在视野**；针又只认 `parse/ast_parser`（裸名命中看不见）。
 *   结果：**视野内那 2 条命中恰好等于白名单那 2 条** ⇒ 等式两边同源 ⇒ 它唯一能红的方式是
 *   "有人在 src/tests/scripts 里新写那条路径"，而这次要防的 5 处没有一处在那 3 棵树里。
 *   **它绿，恰恰证明它扫不到该扫的地方。**
 */
const SCAN_ROOTS = ['src', 'tests', 'scripts', 'docs', 'dogfood'] as const;
/** 根级还要扫的固定文件（人看方位图的第一站） */
const SCAN_ROOT_FILES = ['structure.domains.json'] as const;
/** 文本类扩展名：`.json` / `.md` 与 `.ts` 一样，都会把下一个人引到一个不存在的文件 */
const TEXT_EXTS = ['.ts', '.mts', '.mjs', '.md', '.json'] as const;

/** 仓库相对路径（统一正斜杠：判据比的是"哪几处"，路径写法不能因平台而异） */
function relRepo(p: string): string {
  return path.relative(REPO, p).split(path.sep).join('/');
}

/** 扫全部面：5 个根 + 根级 *.md + SCAN_ROOT_FILES */
function collectAll(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (TEXT_EXTS.some((x) => e.name.endsWith(x))) out.push(p);
    }
  };
  for (const r of SCAN_ROOTS) {
    const d = path.join(REPO, r);
    assert.ok(fs.existsSync(d), `扫描面配错了：${r}/ 不存在（配置错 ≠ 干净）`);
    walk(d);
  }
  for (const f of fs.readdirSync(REPO)) if (f.endsWith('.md')) out.push(path.join(REPO, f));
  for (const f of SCAN_ROOT_FILES) out.push(path.join(REPO, f));
  return out;
}

/**
 * ④ 的命中核（纯）：含该名字的行 ⇒ 1-based 行号；比对前先把**判据自己的文件名**剥掉。
 * ★ 与 ② 是**两条不同判据**，都要留：② 问"谁还 import 它"（模块说明符），
 *   ④ 问"全仓还有任何地方**提到**它吗"（字面，连散文/注释/JSON 值也算）。
 */
function hitLines(text: string): number[] {
  const out: number[] = [];
  text.split('\n').forEach((line, i) => {
    if (line.split(SELF_STEM).join('').includes(RETIRED_NAME)) out.push(i + 1);
  });
  return out;
}

/**
 * 针的自校验样本：★ **字面量必须硬写**，不许从 `RETIRED_NAME` 拼出来 ——
 * 从常量拼出来的样本会跟着常量一起错，于是永远自证成功（同源等式，本卡要消灭的正是这一类）。
 */
const NEEDLE_CANARY = 'import { parseFileSymbols } from "../../src/infrastructure/parse/ast_parser.js";';

/**
 * ④ 的白名单：全仓指名那个已删兼容层时**唯一允许**的位置。
 * 比的是「文件集合 + 每文件命中行数 + 每行必须含的字样」，**不比行号**（双向，三门都能红）。
 *
 * ★★ 为什么不再逐字比行号：上一版把"人必须再看一眼"这个**意图**实现成了"数字必须逐字相等"
 *   这个**代理**。后果：任何人在 `kernel.ts`（4000 行）顶部加一行 import（那里最常见的事），
 *   判据就红，而要防的事一件没发生 ⇒ 红得没信息量 ⇒ 训练人去改数字 ⇒ **真红被淹**。
 *   现在：行号漂了不影响（只比文件 / 行数 / 字样）；而"那一行被改写成别的东西"照样红。
 */
const LITERAL_ALLOWED = [
  {
    file: 'src/application/design/intent/consistency.ts',
    count: 1,
    mustContain: ['原来它们经'],
    why: '过去式历史注记（"原来它们经兼容层转手"）—— 语义正确，本卡明令不动',
  },
  {
    file: 'src/infrastructure/parse/kernel.ts',
    count: 1,
    mustContain: ['原样搬来'],
    why: '过去式历史注记（isSupportedFile 的函数体"从兼容层原样搬来"）—— 语义正确，本卡明令不动',
  },
  // ★★ 2026-11-18（T-#A8A9-CROSS-BOOK 批 10）：台账派生视图曾含**迁移存档的历史叙事**（甲′口径：
  //   败方原文逐字进台账、渲染进视图供人核对）—— 其指名是历史记录非活引用；活性散文的负半保证
  //   仍由其余全部文件承担。
  // ★★ 2026-11-18（**批 11** 渲染细化）：`renderEventLines` 把「迁移存档」类 annotate **收敛为一行摘要**
  //   （`> ↳ 迁移存档 N 条（逐字见引擎，查询 ref=…）`）⇒ 那 1 行历史指名随存档全文一起离开视图
  //   ⇒ **本白名单的 `docs/todo.md` 条目退场**（计数 1 → 0）。原文仍逐字在 `tasks.db` 的 `ledger_events`
  //   里 —— 判据问的是"视图里还有没有人被引到一个不存在的文件"，不是"库里有没有历史记录"。
  //   ★ 这正是批 10 那条 why 预告的动作（"数会随后续批的存档涨 ⇒ 涨了就显式改这里"）：方向反过来也一样，
  //     少了就必须**删条目**，不许留着一条永远亮不起来的灯。
  {
    file: 'dogfood/inventory/src-infrastructure-parse-ts.json',
    count: 2,
    mustContain: ['"with"', '「相同」判决'],
    why:
      '★ **已知未决（不是历史注记）**：parse 台账里 index.ts 表单的 overlap 仍指向那个已删文件 —— ' +
      '这是**判断**（该不该重写那张表单），另立卡；它的红灯在 ' +
      '`node scripts/inventory-sweep.mjs --dir src/infrastructure/parse --ext .ts --validate-only`（unknown_with）。' +
      '本条目是那条债的**追踪器**：另一张卡做完 ⇒ 这两行消失 ⇒ 本白名单必须收紧（别让它变成永远亮着的灯）。',
  },
] as const;

/**
 * ④ 的**声明式排除**：这 2 个文件里出现该名是应当的，且出现频率不受本卡控制。
 * ★ 每条必须写清"为什么这个文件可以有这个名字"—— 否则排除就是白名单的后门。
 * ★ 排除项也要自检（见 test 内）：写错路径的排除等于没排除，而"已经不需要排除"的条目是又一场假绿。
 */
const LITERAL_EXCLUDED = [
  { file: 'TASKS.md', why: '主控的活台账，本卡明令不改；它的主题就是这次下线 ⇒ 必然反复出现' },
  {
    file: 'tests/p0_ast_parser_retired.test.ts',
    why: '本判据自身必须能构造针、能自称（RETIRED_NAME / NEEDLE_CANARY）—— 判据不能因为自己存在而红',
  },
] as const;

test('④ 负半：全仓不再指名已删的兼容层（比文件集合+行数+字样，不比行号；带分母与自证）', () => {
  const files = collectAll();
  const paths = files.map(relRepo);
  assert.ok(files.length > 0, '一个文件都没扫到 ⇒ 空转（分母为 0 时不许算绿）');

  // ── 扫描面自证：每个根都必须真的贡献文件 ──
  // ★ 少了这一步，"忘了把 docs 加回来"会静默退回成上一版那台恒绿机（它就是这么缩回三棵树的）。
  for (const r of SCAN_ROOTS) {
    const n = paths.filter((p) => p.startsWith(`${r}/`)).length;
    assert.ok(n > 0, `扫描面自证红：根目录 ${r}/ 一个文件都没贡献 ⇒ 该根已被静默移出视野（不是"那里很干净"）`);
  }
  for (const f of SCAN_ROOT_FILES) {
    assert.ok(paths.includes(f), `扫描面自证红：根级 ${f} 不在扫描面里`);
  }
  assert.ok(
    paths.some((p) => p.startsWith('docs/') && p.endsWith('.md')),
    '扫描面自证红：docs/ 下一个 .md 都没进扫描面',
  );

  // ── 针的自校验 ──
  // ★ 没有它，"全仓干净"与"针坏了"长得一模一样（同一台假绿机的另一半死因）。
  assert.deepEqual(
    hitLines(NEEDLE_CANARY),
    [1],
    `针自校验红：命中核对一段明明含「${RETIRED_NAME}」的人造文本返回了空 ⇒ 针坏了，后面那句"全仓干净"不算数`,
  );

  // ── 排除项自检：排除只能排除"真的在扫描面里、且真的还有命中"的东西 ──
  const hitMap = new Map<string, number[]>();
  for (const f of files) hitMap.set(relRepo(f), hitLines(fs.readFileSync(f, 'utf-8')));
  const excluded = new Set(LITERAL_EXCLUDED.map((e) => e.file));
  for (const e of LITERAL_EXCLUDED) {
    assert.ok(paths.includes(e.file), `排除名单陈旧：${e.file} 不在扫描面里 ⇒ 这条排除什么也没排除`);
    assert.ok(
      (hitMap.get(e.file) ?? []).length > 0,
      `排除名单过期：${e.file} 现在一次都不出现了 ⇒ 删掉这条排除（别留一盏永远亮不了的灯）`,
    );
  }

  // ── ① 文件集合 ──
  const actual = [...hitMap.entries()]
    .filter(([f, ls]) => ls.length > 0 && !excluded.has(f))
    .map(([f]) => f)
    .sort();
  const expected = LITERAL_ALLOWED.map((a) => a.file).sort();
  assert.deepEqual(
    actual,
    expected,
    `扫了 ${files.length} 个文件（${SCAN_ROOTS.join('/')}/* + 根级 *.md + ${SCAN_ROOT_FILES.join(',')}），` +
      `指名「${RETIRED_NAME}」的**文件集合**与白名单不相等。` +
      `\n  实得（${actual.length}）：${actual.join(', ') || '（一处都没有）'}` +
      `\n  白名单（${expected.length}）：${expected.join(', ')}` +
      `\n★ 多出来 ⇒ 有人又在散文/注释/JSON 里指名了那个已删文件（下一个人会照它去找）—— 改成不指名，` +
      `或**显式**加进白名单并写理由。` +
      `\n★ 少了 ⇒ 白名单过期（那几行被改/被删）—— 收紧名单，别让它继续替你保证一件已经没人做的事。`,
  );

  // ── ② 每文件命中行数 + ③ 每行必须含指定字样 ──
  for (const a of LITERAL_ALLOWED) {
    const lines = hitMap.get(a.file) ?? [];
    assert.equal(
      lines.length,
      a.count,
      `${a.file} 的命中行数 ${lines.length}，白名单声明 ${a.count}（多一行/少一行都算白名单过期）。` +
        `现命中行号：${lines.join(',') || '（无）'}`,
    );
    const src = fs.readFileSync(path.join(REPO, a.file), 'utf-8').split('\n');
    for (const ln of lines) {
      const text = src[ln - 1] ?? '';
      assert.ok(
        a.mustContain.some((m) => text.includes(m)),
        `${a.file}:${ln} 的命中行里没有 ${JSON.stringify(a.mustContain)} 任何一个` +
          ` ⇒ 那一行被改写成别的东西了（行还在、意思变了）。实得：${text.trim().slice(0, 160)}`,
      );
    }
  }

  // ── ④ 不脆的自证（**常驻**，每次跑都证明一次）──
  // 把每个文件的文本整体前置 7 行 = 等价于「在 kernel.ts（4000 行）顶部加一行 import」：
  // 命中行号因此全部漂 7，这一版的判决必须**一模一样**。
  // ★ 上一版就死在这里：白名单写死 `文件:行号` ⇒ 那种最常见的小改会把它判红，而它要防的事一件没发生
  //   ⇒ 红得没信息量 ⇒ 训练人去改数字 ⇒ 真红被淹。这条自证让"不脆"变成**每次跑都验一次**的读数。
  const shiftedHits = new Map<string, number[]>();
  for (const f of files) shiftedHits.set(relRepo(f), hitLines(`${'\n'.repeat(7)}${fs.readFileSync(f, 'utf-8')}`));
  const actualShifted = [...shiftedHits.entries()]
    .filter(([f, ls]) => ls.length > 0 && !excluded.has(f))
    .map(([f]) => f)
    .sort();
  assert.deepEqual(
    actualShifted,
    actual,
    '所有文件整体下移 7 行后，命中的**文件集合**变了 ⇒ 判据又跟行号/顺序挂钩了（那是上一版那条脆判据）。' +
      `\n  位移前：${actual.join(', ') || '（无）'}` +
      `\n  位移后：${actualShifted.join(', ') || '（无）'}`,
  );
  for (const a of LITERAL_ALLOWED) {
    assert.equal(
      (shiftedHits.get(a.file) ?? []).length,
      a.count,
      `${a.file} 整体下移 7 行后命中行数变了 ⇒ 判据跟行号挂钩了（行号漂移不该改变计数）`,
    );
  }
});

test('⑤ 负半：译文册没有「指向已不存在文件」的新增悬空单元（parse/ 名下 0 + 全册棘轮，带分母）', () => {
  const designDir = path.join(REPO, '.agent-io', 'design');
  const books = fs.readdirSync(designDir).filter((n) => n.endsWith('.translate.json'));
  assert.ok(
    books.length > 0,
    `在 ${designDir} 下没找到任何译文册 ⇒ 这条判据是空转（一本册都没扫到时不作数）`,
  );
  const dangling: string[] = [];
  let units = 0;
  let parseUnits = 0;
  for (const b of books) {
    const j = JSON.parse(fs.readFileSync(path.join(designDir, b), 'utf-8')) as {
      symbols?: Array<{ from?: string | null }>;
    };
    for (const u of j.symbols ?? []) {
      const from = typeof u.from === 'string' ? u.from : '';
      const file = from.split('#')[0];
      if (!file) continue; // origin=added（from 为空）本来就不指向任何文件，不算悬空
      units += 1;
      if (file.startsWith('src/infrastructure/parse/')) parseUnits += 1;
      if (!fs.existsSync(path.join(REPO, file))) dangling.push(`${b}: ${from}`);
    }
  }
  const parseDangling = dangling.filter((d) => d.includes('src/infrastructure/parse/'));
  assert.deepEqual(
    parseDangling,
    [],
    `扫了 ${books.length} 本册 / ${units} 个单元（其中 parse/ 名下 ${parseUnits} 个），parse/ 下仍有 ${parseDangling.length} 个悬空单元：${parseDangling.join(', ')}` +
      `\n★ 本次删掉的是 parse/ 下唯一的那个空壳 ⇒ 这一档的空间只有 0，没有"可容忍的几个"。`,
  );
  assert.equal(
    dangling.length,
    BOOK_DANGLING_BASELINE,
    `全册悬空单元 ${dangling.length} 个，棘轮基线 ${BOOK_DANGLING_BASELINE}（只许降不许升）。` +
      `\n★ 变多 ⇒ 本次改动在册里留下了新悬空（要么补单元、要么把已有的清掉）；` +
      `\n★ 变少 ⇒ 有人真清了存量 —— 好事，把 BOOK_DANGLING_BASELINE 下调即可（棘轮只许收紧）。`,
  );
});
