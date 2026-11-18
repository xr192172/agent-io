/**
 * P1 · **T-#EXCLUDED-EMPTY-PATH：`excluded` 的形状守卫**（结构门假绿根治）。
 *
 * ## 它治哪个洞（实测两次，不是设想）
 * `agent-io.dsl.json` 的 `excluded` 曾被手写成**字符串数组** `["tests/fixtures/java-proj/**"]`，
 * 而唯一读端 `gen_design_db#excludedPathsOf` 按 `{path, reason}` 取值 ⇒ `path` 得 `''` ⇒
 * `isExcludedPath` 的 `p.startsWith('')` **恒真** ⇒ 盘上所有无节点的源文件都被算进「已声明排除」、
 * 结构门的 `gaps` 恒 0。
 * 实测同一条命令：形状修好前 `source 585 / with_node 525 / excluded 60 / gaps 0`（假绿，吞掉 19 个
 * 真无节点源文件）→ 修好后 `excluded 41 / gaps 19`（真红，逐个点名）→ triage 后 `with_node 538 /
 * excluded 47 / gaps 0`（真绿）。
 *
 * ## 判据（0.14 双向 · 0.25① 鉴别力 · 0.25② 消融）
 * ① **形状漂移必红**：字符串条目 / 对象空 path / 非数组 —— 三种形态都抛，且报文点名「哪册 · 第几条」；
 * ② **合法形状必绿**：`[{path, reason}]` 不红；且**真册**（`.agent-io/design/agent-io.dsl.json`）的形状过检
 *    （这条钉的是"册又漂回去了"—— 写端 `applyExcludedOp` 只是第一道，手改 JSON 能绕开它）；
 * ③ **病征可复现（鉴别力的另一半）**：`isExcludedPath([{path:''}], '任意文件')` 恒真 ——
 *    这正是假绿的机理；而 `excludedPathsOf` **拒绝**产出这种条目（不让它流到匹配器里）；
 * ④ **端到端**：漂移的册喂给 `silentGapsOf` ⇒ 抛（结构门因此退出码 2 = 判不了，而不是 0 = 假绿）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertionExcludedShape,
  excludedPathsOf,
  isExcludedPath,
  type DesignSheetLike,
} from '../src/application/design/db/gen_design_db.js';
import { silentGapsOf } from '../src/application/design/line/design_line.js';

/** 一份最小册（只有 `feature` + `excluded`；形状故意放成 `unknown` —— 夹具要能造出坏形状） */
const sheetWith = (feature: string, excluded: unknown): DesignSheetLike =>
  ({ feature, excluded } as unknown as DesignSheetLike);

/** 临时项目根（`.agent-io/design/*.dsl.json` 住这里）；`AGENT_IO_HOME` 指到空数据家，免得把本仓的册并进来 */
function makeProject(sheets: Array<{ feature: string; dsl: unknown }>): { root: string; prevHome: string | undefined } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-excl-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-excl-proj-'));
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  const dir = path.join(root, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of sheets) {
    fs.writeFileSync(path.join(dir, `${s.feature}.dsl.json`), JSON.stringify(s.dsl, null, 2), 'utf8');
  }
  return { root, prevHome };
}

function cleanUp(root: string, prevHome: string | undefined): void {
  if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
  else process.env.AGENT_IO_HOME = prevHome;
  fs.rmSync(root, { recursive: true, force: true });
}

test('① excluded 形状漂移（字符串条目 / 空 path / 非数组）必红，且点名「哪册 · 第几条」', () => {
  const cases: Array<{ excluded: unknown; want: RegExp; why: string }> = [
    {
      excluded: ['tests/fixtures/java-proj/**'],
      want: /sheet-a 册第 1 条/,
      why: '字符串条目就是本 bug 的原形（x.path → undefined → \'\' ⇒ startsWith(\'\') 恒真）',
    },
    { excluded: [{ path: '', reason: 'x' }], want: /sheet-a 册第 1 条/, why: '空 path 与字符串条目等价（都会让匹配恒真）' },
    { excluded: [{ path: 'a/', reason: '' }], want: /sheet-a 册第 1 条/, why: 'reason 为空 ⇒ 排除不可追溯（与写端 applyExcludedOp 同口径）' },
    { excluded: { path: 'a/', reason: 'x' }, want: /sheet-a 册 excluded 不是数组/, why: '整个 excluded 不是数组' },
  ];
  for (const c of cases) {
    assert.throws(() => assertionExcludedShape([sheetWith('sheet-a', c.excluded)]), c.want, c.why);
    // 同一份坏输入走读端入口也必须红 —— 守卫挂在 `excludedPathsOf` 的最前面，不是只挂在测试里
    assert.throws(() => excludedPathsOf([sheetWith('sheet-a', c.excluded)]), c.want, `读端入口也必红：${c.why}`);
  }
});

test('② 合法 [{path,reason}] 绿（含缺省 / null），且**真册**形状过检', () => {
  assert.doesNotThrow(() => assertionExcludedShape([sheetWith('a', [{ path: 'fixtures/', reason: '夹具不进册' }])]));
  // ★ 缺省 / null = 没有声明管辖边界 ⇒ 合法（不是"读不到"，是"真没有"）
  assert.doesNotThrow(() => assertionExcludedShape([sheetWith('a', undefined)]));
  assert.doesNotThrow(() => assertionExcludedShape([sheetWith('a', null)]));
  assert.equal(excludedPathsOf([sheetWith('a', undefined)]).length, 0);

  // ★ 真册：本仓 `agent-io` 册的 excluded 必须是 [{path, reason}]（T-#EXCLUDED-EMPTY-PATH 回归锚点）
  const real = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.agent-io', 'design', 'agent-io.dsl.json'), 'utf8'));
  assert.ok(Array.isArray(real.excluded) && real.excluded.length > 0, 'agent-io 册必须有 excluded 声明（至少那条 Java 夹具）');
  assert.doesNotThrow(
    () => assertionExcludedShape([{ feature: 'agent-io', excluded: real.excluded } as unknown as DesignSheetLike]),
    'agent-io 册的 excluded 形状必须合法 —— 漂回字符串形态会让结构门 gaps 恒 0（假绿）',
  );
  // 且每一条都带非空 reason（排除是管辖范围声明，要说清为什么不管）
  for (const e of real.excluded) {
    assert.ok(String(e.reason ?? '').trim(), `excluded 条目 ${JSON.stringify(e)} 缺 reason`);
  }
});

test('③ 病征可复现：空 path 的前缀匹配恒真；读端拒绝把这种条目交出去', () => {
  const everyFile = ['src/a.ts', 'tests/b.ts', 'docs/c.md'];
  assert.deepEqual(
    everyFile.filter((p) => isExcludedPath([{ path: '' }], p)),
    everyFile,
    '★ 这就是本 bug 的机理：startsWith(\'\') 恒真 ⇒ 全仓文件都被算成「已声明排除」',
  );
  // 修法不是改匹配器（那是 R49 的判据），而是**不让空 path 流进来**：
  assert.throws(() => excludedPathsOf([sheetWith('agent-io', [{ path: '', reason: 'x' }])]), /path 为空/);
  assert.throws(() => excludedPathsOf([sheetWith('agent-io', ['x/**'])]), /不是 \{path, reason\} 对象/);
  // 合法条目照常命中（同一把尺、只多了入口那道形状闸）
  assert.ok(isExcludedPath([{ path: 'tests/fixtures/' }], 'tests/fixtures/java-proj/tools/A.java'));
});

test('④ 端到端：漂移的册喂给 silentGapsOf（结构门的文件级判据）⇒ 抛，不是 gaps 0', () => {
  const drifted = {
    feature: 'sheet-drift',
    title: 'drift',
    geometry: { nodes: [], edges: [] },
    semantic: { files: [] },
    excluded: ['tests/fixtures/java-proj/**'],
  };
  const { root, prevHome } = makeProject([{ feature: 'sheet-drift', dsl: drifted }]);
  try {
    // 盘上放一个源文件（`.ts` 在 walkFiles 的代码后缀里）；它既无节点、也没被"合法地"排除
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    assert.throws(
      () => silentGapsOf(root),
      /excluded 形状非法（T-#EXCLUDED-EMPTY-PATH/,
      '★ 形状漂移必须在结构门那一步就炸（退出码 2 = 判不了），否则 gaps 恒 0 把整仓文件静默吞掉',
    );
  } finally {
    cleanUp(root, prevHome);
  }
});

test('⑤ triage 的读数是可复算的：合法声明 ⇒ 无节点且未声明的文件**逐条点名**，不被吞', () => {
  const paths = ['src/application/design/unsettled_hint.ts', 'src/domain/review_gate.ts'];
  const sheets = [
    sheetWith('agent-io', [
      { path: 'tests/fixtures/java-proj/**', reason: 'Java 测试夹具（非本仓源码）' },
      { path: 'tests/fixtures/java-proj/tools/MyBatisMapperDump.java', reason: 'Java 测试夹具工具类' },
    ]),
  ];
  const excluded = excludedPathsOf(sheets);
  assert.equal(excluded.length, 2, '两条合法声明都读得出来（不是 0 条，也不是 1 条空 path）');
  const surviving = paths.filter((p) => !isExcludedPath(excluded, p));
  assert.deepEqual(surviving, paths, '两个源码文件不被夹具声明误伤（前缀匹配不许溢出到 src/）');
});
