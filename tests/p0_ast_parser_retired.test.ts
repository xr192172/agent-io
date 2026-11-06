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
 *   ④ 负半 —— 全仓（src+tests+scripts）字面提到那条路径的地方**恰好只剩白名单那 2 处**（双向，带分母）；
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
/** ④ 的字面针 = 上面那条路径里能认人的那一段（与 LEGACY_SPECIFIER 同源，不另写第二份拼法） */
const RETIRED_NEEDLE = ['parse', 'ast_parser'].join('/');
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
 * ④ 的白名单：全仓**字面**提到那条路径时**唯一允许**的位置（`仓库相对路径:行号`）。
 *
 * ★★ 这是**双向**判据，两个方向都能变红：
 *   · 多一处 ⇒ 红（又有人在散文/注释里指名一个已删的文件 ⇒ 下一个人会去找它）；
 *   · 少一处 ⇒ 也红（这一行被改/被删/行号漂了 ⇒ **白名单过期**，必须来把名单收紧 —— 否则它继续
 *     替你保证一件已经没人做的事，那就是假绿）。
 *
 * ★ 为什么是「这 2 处」而不是「0 处」：它们是**历史注记**（“这处能力是从那份兼容层搬来的”），
 *   本人/本卡**不改**它们 —— 改注释同样要过任务闸，而本卡的职责是“删东西不留新欠账”，不是“顺手
 *   把两个别的文件的注释也洗了”。
 * ★ 行号会把这条判据带到红：同文件上方一增删行就漂。**那是故意的** —— 白名单必须被人重新确认一次。
 */
const LITERAL_HITS_ALLOWED = [
  'src/application/design/intent/consistency.ts:56',
  'src/infrastructure/parse/kernel.ts:4151',
];

test('④ 负半：字面提到那条路径的地方**恰好**只剩白名单那 2 处（带分母，双向）', () => {
  const files = [
    ...collectSources(path.join(REPO, 'src')),
    ...collectSources(path.join(REPO, 'tests')),
    ...collectSources(path.join(REPO, 'scripts')),
  ];
  assert.ok(files.length > 0, '一个源文件都没扫到 ⇒ 这个判据是空转（分母为 0 时不许算绿）');
  // ★ 与 ② 是**两条不同判据**，都要留：② 问“谁还 import 它”（模块说明符），
  //   ④ 问“全仓还有任何地方**提到**它吗”（字面，连散文/注释也算）。
  const hits: string[] = [];
  for (const f of files) {
    const rel = path.relative(REPO, f).split(path.sep).join('/');
    const lines = fs.readFileSync(f, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(RETIRED_NEEDLE)) hits.push(`${rel}:${i + 1}`);
    });
  }
  // 排序后再比：判据问的是“哪几处”（集合），不是遍历顺序
  const got = [...hits].sort();
  const want = [...LITERAL_HITS_ALLOWED].sort();
  assert.deepEqual(
    got,
    want,
    `扫了 ${files.length} 个文件，字面提到 ${RETIRED_NEEDLE} 的位置与白名单**不相等**。` +
      `\n  实得（${got.length}）：${got.join(', ') || '（一处都没有）'}` +
      `\n  白名单（${want.length}）：${want.join(', ')}` +
      `\n★ 多出来 ⇒ 有人又在散文/注释里指名了那个已删文件（下一个人会去找它）—— 改成不指名，` +
      `或**明确**加进白名单并写理由。` +
      `\n★ 少了 ⇒ 白名单过期（那两行被改/被删/行号漂了）—— 来把名单收紧，` +
      `别让它继续替你保证一件已经没人做的事（那是假绿）。`,
  );
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
