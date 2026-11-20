/**
 * card: api-edges —— 跨语言 API↔调用 影响边 + 索引期对账（机器回归）。
 *
 * ## 判据（每条都能证红）
 * | # | 断言 | 改坏之后 |
 * |---|---|---|
 * | ① | 合成项目（1 Controller.java + 1 src/api/order.js + 1 view.vue + 1 util.ts）跑
 *       `import_project({include_api_edges:true})` ⇒ `edges.kind='api_endpoint'` 存在，
 *       `metadata` 四字段完整（url / method / controller / api_function）且**值对得上** |
 *       砍接线 ⇒ 边 0 条 |
 * | ② | 前端 url 无后端 base（`/system/config/list`）⇒ 进 `frontendOrphan` **逐条点名**（url + 文件 + 行） |
 *       砍孤儿上报 ⇒ 清单里一个字都没有 |
 * | ③ | 幂等：连跑两次边数不变（先删后建） | 删 DELETE 那行 ⇒ 边翻倍 |
 * | ④ | URL 归一：无反斜杠 / 尾斜杠 / 查询串 / 拼接 `'…' + id` 全要匹配上 | 破坏 norm ⇒ 全掉进孤儿 |
 * | ⑤ | 参数端点 `{id}` ↔ 拼接调用 `'…/info/' + id` **建边**，metadata 带 `param_template:true` + `params`
 *       （T-#API-PARAM-EDGES 已修）；且该 url **不再**进 `paramPathUnmatched` |
 *       砍模板匹配分支 ⇒ 边 0 条 + paramPathUnmatched 有它 |
 * | ⑨ | 反例三条（段数不等 / 字面段不同 / 方法不一致）**都不建边** | `{x}` 跨段通配 ⇒ 第一二条红；不判方法 ⇒ 第三条红 |
 * | ⑫ | 非拼接字面 url 不得省略末尾参数段 | 无 concat 也放行 missingTail ⇒ 错建参数边 |
 * | ⑬ | 同方法精确端点与等长模板碰撞时精确先赢 | 模板先 continue ⇒ save 被错指向 byId |
 * | ⑩ | 混合场景：一条 url 精确命中、另一条模板命中，**互不干扰**（精确优先，模板不顶掉精确） | 模板抢在精确前 ⇒ controller 字段错位 |
 * | ⑪ | 后端无对应模板的真孤儿（`'…/refund/delete/' + id`）**必须进 `frontendOrphan`**，不许被模板吞掉 | 模板匹配过宽 ⇒ 它从孤儿清单消失 |
 * | ⑥ | opt-in：不传 `include_api_edges` ⇒ 回执无 `api_reconcile`、无边（不改既有行为） | 恒真判断 ⇒ ⑥ 红 |
 * | ⑦ | 未注册语言 / 无 `src/api` 目录的项目不被误伤（端点照扫、url 0 条、不抛） | reconcile 无端点时乱写 ⇒ ⑦ 红 |
 * | ⑧ | 双层类（内部类）各自取自己的类级 mapping，内层不继承外层 base | 回落外层 ⇒ ⑧ 红 |
 *
 * ## 夹具为什么这么摆
 * 预检闸按后缀轮转取样，分别检查符号、声明结构、缺树与空子树，避免固定前缀样本误判。
 * 夹具的 `src/api/order.js` 与 `OrderController.java` 都有真实符号，正常解析时必须通过。
 *
 * touches: src/infrastructure/analysis/api_endpoint_edges.ts, src/infrastructure/graph/import_project.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { importProject } from '../src/infrastructure/graph/import_project.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import {
  normApiUrl,
  segJoin,
  reconcileApiEndpoints,
  matchParamTemplate,
} from '../src/infrastructure/analysis/api_endpoint_edges.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
// ★★ 2026-11-19（集成席 · merge feat/api-edges 时发现）：本文件的 `importProject({project_dir, feature})`
//   会**注册 feature** —— 而 `makeTempHome()` 只建目录、**不设** `AGENT_IO_HOME`（设 env 的是 `withTempHome`）。
//   ⇒ 不显式设的话，每跑一次就往**真** `.agentio-data/projects.json` 写进 8 条 `p1_api_edges_<pid>_<n>`
//   幽灵条目，产者护栏当场红（实测 PID 10084 那一轮写了 8 条）。数据家 ⇒ 落到本文件的临时目录。
process.env.AGENT_IO_HOME = TMP;
after(() => rmRf(TMP));

// ════════════════════════════════════════════════════════════════════
// 夹具：合成迷你项目（Java Controller + 前端 api 层 + vue 视图 + 一个普通 ts）
// ════════════════════════════════════════════════════════════════════

const CONTROLLER = `package com.acme.web;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/backendApi/order")
public class OrderController {

    @RequestMapping(value = "/list", method = RequestMethod.POST)
    public Object list() {
        return null;
    }

    @RequestMapping(value = "/info/{orderId}", method = RequestMethod.GET)
    public Object info() {
        return null;
    }

    // ★ 方法路径不以 / 开头（真语料 BackendRefundController 就是这么写的）
    @RequestMapping(value = "save", method = RequestMethod.POST)
    public Object save() {
        return null;
    }
}
`;

/**
 * ⑩ 混合场景专用 Controller：**字面端点 `/order/save`（POST）与模板端点 `/order/{id}`（GET）同处一个 base**。
 * 精确必须先赢；模板只接收"拼接出来、精确对不上"的那些。
 * ★ 单独一个类、不并进 CONTROLLER：并进去会让 ①②⑦⑧ 的端点分母读数全部漂移。
 */
const MIX_CONTROLLER = `package com.acme.web;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/backendApi/order")
public class MixController {

    @RequestMapping(value = "save", method = RequestMethod.POST)
    public Object save() {
        return null;
    }

    @RequestMapping(value = "/{id}", method = RequestMethod.GET)
    public Object byId() {
        return null;
    }
}
`;

/** ⑬ 同方法碰撞：精确 save 与模板 {id} 都是 GET，精确必须真的先赢。 */
const EXACT_COLLISION_CONTROLLER = `package com.acme.web;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/backendApi/exact")
public class ExactCollisionController {
    @RequestMapping(value = "save", method = RequestMethod.GET)
    public Object save() { return null; }

    @RequestMapping(value = "/{id}", method = RequestMethod.GET)
    public Object byId() { return null; }
}
`;

const API_JS_EXACT_COLLISION = `
export function getExactSave() {
  return request({
    url: 'backendApi/exact/save',
    method: 'get',
  })
}
`;

/** 内层类有自己的类级 mapping —— 内层 base 不许继承外层 */
const NESTED_CONTROLLER = `package com.acme.web;

import org.springframework.web.bind.annotation.*;

public class OuterController {

    @RestController
    @RequestMapping(value = "/backendApi/inner")
    public static class Inner {

        @RequestMapping(value = "/ping", method = RequestMethod.GET)
        public Object ping() {
            return null;
        }
    }
}
`;

/** 真语料形态：单引号 url、尾斜杠、拼接、查询串、无反斜杠 */
const API_JS = `import request from '@/utils/request'

export function getOrderList(data) {
  return request({
    url: 'backendApi/order/list',
    method: 'post',
    data: data,
  })
}

export function saveOrder(data) {
  return request({
    url: 'backendApi/order/save',
    method: 'post',
    data: data,
  })
}

export function getSystemConfig() {
  return request({
    url: '/system/config/list',
    method: 'get',
  })
}
`;

const API_JS_TAIL = `
export function getOrderInfo(orderId) {
  return request({
    url: 'backendApi/order/info/' + orderId,
    method: 'get',
  })
}

export function queryOrders(params) {
  return request({
    url: '/backendApi/order/',
    method: 'post',
    params: params,
  })
}
`;

/**
 * ⑤ 正例夹具：**只放那两条拼接到 /info/** 的 url。
 * ★ 必须与 `API_JS + API_JS_TAIL` 用到的函数名区分（`importFixture` 的进程内缓存按符号内容算），
 *   否则 ①② 的 app.js 会与这里的 app.js 同摘要 ⇒ 缓存命中 ⇒ 拿不到 getOrderInfo 的符号 ⇒ 边建不出来。
 */
const API_JS_PARAM = `
export function fetchOneOrderInfo(orderId) {
  return request({
    url: 'backendApi/order/info/' + orderId,
    method: 'get',
  })
}

export function queryOrderPage(params) {
  return request({
    url: '/backendApi/order/',
    method: 'post',
    params: params,
  })
}
`;

/**
 * ⑨ 反例夹具：段数不等 / 字面段不同 / 方法不一致 —— 三条都不许建边。
 * ★ 「段数不等」用的是**值已写死的字面量**（`'…/info/42/sub'`）而不是 `'…/info/' + a + '/' + b`：
 *   后者的**字面段只有 `…/info/`**（`extractFrontCalls` 取的是单引号之间的内容），归一后段数与
 *   `'/info/'` 那条**一模一样** ⇒ 在"字面量 + 拼接"这层语义下它们本来就该同等对待（不是 bug）。
 *   ⇒ 要测"段数不等"，必须让**字面部分本身**段数不等。
 */
const API_JS_NEG = `
export function getOrderInfoTwoSegs() {
  return request({
    url: 'backendApi/order/info/42/sub',
    method: 'get',
  })
}

export function getOrderInfoCase(orderId) {
  return request({
    url: 'BackendApi/order/info/' + orderId,
    method: 'get',
  })
}

export function postOrderInfo(orderId) {
  return request({
    url: 'backendApi/order/info/' + orderId,
    method: 'post',
  })
}

export function postOrderInfoExact(orderId) {
  return request({
    url: '/backendApi/order/save',
    method: 'get',
  })
}
`;

/**
 * ⑩ 混合夹具：一条走精确（`/order/save` 字面量），一条走模板（`/order/detail/' + id` ⇒ `/order/{id}`）。
 * ★ 前置必须核实过：**字面端点**只有不带前导 `/` 的字面量才能精确命中（`extractFrontCalls` 取字面内容，
 *   归一后补 `/`）⇒ `url: '/backendApi/order/save'` 归一后与原样相等、**精确命中**；
 *   而 `/order/{id}` 在 `{x}` 段上对 `save` 也成立 ⇒ 精确若被模板抢在前面，下面 `param_template === undefined` 会红。
 */
const API_JS_MIX = `
export function saveOrder(data) {
  return request({
    url: '/backendApi/order/save',
    method: 'post',
    data: data,
  })
}

export function getOrderDetail(id) {
  return request({
    url: '/backendApi/order/detail/' + id,
    method: 'get',
  })
}

export function getOrderById(id) {
  return request({
    url: '/backendApi/order/' + id,
    method: 'get',
  })
}
`;

/**
 * ⑪ 真孤儿夹具：`'backendApi/refund/delete/' + refundId` 的后端**没有** delete 端点
 * （真语料 BackendRefundController 只有 /list /preCheck /info/{refundId} save doRefund）。
 * ★ 这里的 base 故意写成 `/backendApi/order`：若 `{x}` 能跨段通配，它会撞上别的模板 —— 正是要防的。
 */
const REFUND_CONTROLLER = `package com.acme.web;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/backendApi/order")
public class RefundController {

    @RequestMapping(value = "/info/{refundId}", method = RequestMethod.GET)
    public Object info() {
        return null;
    }
}
`;

const API_JS_ORPHAN = `
export function deleteRefund(refundId) {
  return request({
    url: 'backendApi/refund/delete/' + refundId,
    method: 'get',
  })
}
`;

/** ⑫ 非拼接反例：字面量自己少了末尾 {orderId}，不得借用 concat 的缺尾段例外。 */
const API_JS_LITERAL_MISSING_PARAM = `
export function getOrderInfoWithoutId() {
  return request({
    url: 'backendApi/order/info',
    method: 'get',
  })
}
`;

const UTIL_TS = `export function noop(): void {
  return;
}
`;

function makeProj(dir: string, opts: { withApi?: boolean; withNested?: boolean } = {}): string {
  const withApi = opts.withApi !== false;
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  // 预检按后缀轮转取样：API JS、工具 TS 与 Controller.java 都有真实符号。
  if (withApi) fs.mkdirSync(path.join(dir, 'src', 'api'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'util.ts'), UTIL_TS);
  if (withApi) fs.writeFileSync(path.join(dir, 'src', 'api', 'order.js'), API_JS + API_JS_TAIL);
  fs.mkdirSync(path.join(dir, 'src', 'views'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'views', 'OrderView.vue'),
    `<template><div>{{ rows }}</div></template>\n<script>\nimport { getOrderList } from '@/api/order'\nexport default {\n  methods: {\n    load() {\n      return getOrderList({})\n    },\n  },\n}\n</script>\n`,
  );
  fs.writeFileSync(path.join(dir, 'OrderController.java'), CONTROLLER);
  if (opts.withNested) fs.writeFileSync(path.join(dir, 'OuterController.java'), NESTED_CONTROLLER);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));
  return dir;
}

/**
 * ★ 反例夹具（⑨⑩⑪）：**只放要判的那几条 url**，不像 makeProj 那样带一整套正例
 * —— 否则 `matched` / `paramEdges` 的读数会被正例污染，断言就失去鉴别力。
 */
function makeProjWith(
  dir: string,
  opts: { apiFile?: string; apiJs?: string; controllerName?: string; controllerSrc?: string } = {},
): string {
  fs.mkdirSync(path.join(dir, 'src', 'api'), { recursive: true });
  // 预检按后缀轮转取样：API JS、工具 TS 与根上的 Controller.java 都有真实符号。
  fs.writeFileSync(path.join(dir, 'src', 'util.ts'), UTIL_TS);
  fs.writeFileSync(path.join(dir, 'src', 'api', opts.apiFile ?? 'neg.js'), opts.apiJs ?? '');
  fs.writeFileSync(path.join(dir, opts.controllerName ?? 'OrderController.java'), opts.controllerSrc ?? CONTROLLER);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));
  return dir;
}

let featureSeq = 0;
async function importFixture(proj: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  featureSeq += 1;
  const feature = `p1_api_edges_${process.pid}_${featureSeq}`;
  const r = (await importProject({ project_dir: proj, feature, ...extra } as never)) as Record<string, unknown>;
  return { ...r, __feature: feature };
}

function dbOf(proj: string) {
  return getProjectCacheDb(proj);
}

type ApiEdge = { source: string; target: string; metadata: string };

function apiEdges(proj: string): ApiEdge[] {
  const db = dbOf(proj);
  return db.prepare("SELECT source, target, metadata FROM edges WHERE kind = 'api_endpoint'").all() as unknown as ApiEdge[];
}

type ApiRec = {
  edges: number;
  endpoints: number;
  urls: number;
  matched: number;
  backendNoApi: string[];
  frontendOrphan: string[];
  ambiguous: string[];
  paramPathUnmatched: string[];
  paramEdges: number;
  methodMismatch: string[];
  concatUrls: number;
  nodeMissing: number;
  controllersWithoutEndpoints: string[];
  backendNoApiTruncated: boolean;
};

function apiRecOf(r: Record<string, unknown>): ApiRec {
  const rec = r.api_reconcile as ApiRec | undefined;
  assert.ok(rec, `回执必须带 api_reconcile，实得键：${Object.keys(r).join(', ')}`);
  return rec;
}

// ════════════════════════════════════════════════════════════════════
// ① 端点边存在 + metadata 完整（端到端，经 import_project）
// ════════════════════════════════════════════════════════════════════
test('api-edges · ① 端到端：建 api_endpoint 边，metadata 四字段齐全且值对得上', async () => {
  const PROJ = makeProj(path.join(TMP, 'p1_edges'));
  const r = await importFixture(PROJ, { include_api_edges: true });
  const rec = apiRecOf(r);

  assert.equal(rec.endpoints, 3, `Controller 里 3 个方法级 mapping，实得 ${rec.endpoints}`);
  assert.ok(rec.urls >= 5, `前端 url 至少 5 条（list/save/system-config/info 拼接/尾斜杠），实得 ${rec.urls}`);

  const rows = apiEdges(PROJ);
  assert.ok(rows.length > 0, '必须建出 api_endpoint 边（砍接线 ⇒ 这里为 0）');

  const byUrl = new Map<string, ApiEdge>();
  for (const row of rows) {
    const md = JSON.parse(row.metadata) as { url: string; method: string; controller: string; api_function: string };
    assert.equal(typeof md.url, 'string', 'metadata.url 必须存在');
    assert.equal(typeof md.method, 'string', 'metadata.method 必须存在');
    assert.equal(typeof md.controller, 'string', 'metadata.controller 必须存在');
    assert.equal(typeof md.api_function, 'string', 'metadata.api_function 必须存在');
    // 两端必须是 graph 里真实存在的节点 id（悬空边 = 假绿）
    const src = dbOf(PROJ).prepare('SELECT id FROM nodes WHERE id = ?').get(row.source);
    const tgt = dbOf(PROJ).prepare('SELECT id FROM nodes WHERE id = ?').get(row.target);
    assert.ok(src, `边的 source 必须是真实节点：${row.source}`);
    assert.ok(tgt, `边的 target 必须是真实节点：${row.target}`);
    byUrl.set(md.url, row);
  }

  // 逐个点名：这三条必须对上，且 controller / api_function 指到**正确的那个**方法
  const list = byUrl.get('backendApi/order/list');
  assert.ok(list, 'backendApi/order/list 必须建边');
  const mdList = JSON.parse(list.metadata);
  assert.equal(mdList.method, 'POST');
  assert.equal(mdList.controller, 'OrderController.list', `controller 必须是 list 方法本身，实得 ${mdList.controller}`);
  assert.equal(mdList.api_function, 'getOrderList', `api_function 必须是 getOrderList，实得 ${mdList.api_function}`);

  // ★ 方法路径不以 / 开头（`value = "save"`）也必须拼对
  const save = [...byUrl.values()].map((x) => JSON.parse(x.metadata)).find((m) => m.url === 'backendApi/order/save');
  assert.ok(save, 'backendApi/order/save 必须建边（拼接口径：base + 不以 / 开头的方法路径）');
  assert.equal(save.controller, 'OrderController.save');

  // 回执里必须有渲染行（读数进 skipped，学 renderMapperReconcile）
  const skipped = (r.skipped as string[]) ?? [];
  assert.ok(
    skipped.some((s) => s.includes('── API 端点对账 ──')),
    `回执 skipped 里必须有对账段，实得：${skipped.filter((s) => s.includes('API')).join(' | ') || '（无）'}`,
  );
  assert.ok(
    // 对账行现在把"精确"与"参数模板"分列：`精确匹配 X/urls · 参数模板 N`
    skipped.some((s) => new RegExp(`精确匹配 \\d+/${rec.urls}`).test(s) && s.includes('参数模板')),
    '对账行必须带分母（匹配数/urls）并分列参数模板读数',
  );
  assert.equal(rec.matched, rows.length + rec.nodeMissing, 'matched 必须等于建成边数 + 节点缺失数（诚实口径）');
});

// ════════════════════════════════════════════════════════════════════
// ② 孤儿逐条点名
// ════════════════════════════════════════════════════════════════════
test('api-edges · ② 前端 url 无后端 base ⇒ frontendOrphan 逐条点名（url + 文件 + 行）', async () => {
  const PROJ = makeProj(path.join(TMP, 'p1_orphan'));
  const rec = apiRecOf(await importFixture(PROJ, { include_api_edges: true }));

  const orphanHit = rec.frontendOrphan.filter((x) => x.includes('/system/config/list'));
  assert.equal(orphanHit.length, 1, `真孤儿必须逐条点名一次，实得 ${JSON.stringify(rec.frontendOrphan)}`);
  assert.match(orphanHit[0], /src\/api\/order\.js:\d+/, '孤儿条目必须带出处（文件:行），否则下一个人没法回源');

  // 反例：能对上的 url 不许混进孤儿（否则孤儿清单没有鉴别力）
  assert.ok(!rec.frontendOrphan.some((x) => x.includes('backendApi/order/list')), 'backendApi/order/list 能对上，不该进孤儿');
  assert.ok(!rec.frontendOrphan.some((x) => x.includes('backendApi/order/save')), 'backendApi/order/save 能对上，不该进孤儿');
});

// ════════════════════════════════════════════════════════════════════
// ③ 幂等
// ════════════════════════════════════════════════════════════════════
test('api-edges · ③ 幂等：连跑两次边数不变（先删后建）', async () => {
  const PROJ = makeProj(path.join(TMP, 'p1_idem'));
  await importFixture(PROJ, { include_api_edges: true });
  const n1 = apiEdges(PROJ).length;
  assert.ok(n1 > 0, '首跑必须建出边');
  await importFixture(PROJ, { include_api_edges: true });
  const n2 = apiEdges(PROJ).length;
  assert.equal(n2, n1, `重复导入边数必须稳定（改前：先删后建；删掉 DELETE ⇒ 翻倍），首跑 ${n1} 二跑 ${n2}`);
});

// ════════════════════════════════════════════════════════════════════
// ④ URL 归一（单测：不依赖 import_project 的慢路径）
// ════════════════════════════════════════════════════════════════════
test('api-edges · ④ URL 归一：反斜杠缺失 / 尾斜杠 / 查询串 / 拼接 都对得上', () => {
  // ① 补前导斜杠
  assert.equal(normApiUrl('backendApi/order/list'), '/backendApi/order/list');
  // ② 去尾斜杠（79 条真语料形态）
  assert.equal(normApiUrl('backendApi/order/'), '/backendApi/order');
  assert.equal(normApiUrl('/system/config/'), '/system/config');
  // ③ 查询串
  assert.equal(normApiUrl('backendApi/give/giveItem?giveId='), '/backendApi/give/giveItem');
  // ④ 拼接：字面部分参与匹配，尾部变量不猜
  assert.equal(normApiUrl('backendApi/order/info/'), '/backendApi/order/info');
  // ⑤ 重复斜杠折叠 + 根路径不被吃掉
  assert.equal(normApiUrl('//a///b//'), '/a/b');
  assert.equal(normApiUrl('/'), '/');
  // ⑥ 大小写**不**折叠（折叠会把两个真端点混成一个）
  assert.equal(normApiUrl('/backendApi/Order/list'), '/backendApi/Order/list');
  assertEqualsOrder();
  function assertEqualsOrder() {
    // ⑦ 方法路径不以 / 开头：拼接时必须补斜杠（真语料 `value = "save"`）
    assert.equal(segJoin('/backendApi/refund', 'save'), '/backendApi/refund/save');
    assert.equal(segJoin('/backendApi/refund/', '/save'), '/backendApi/refund/save');
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 参数端点：模板匹配 ⇒ 建边（T-#API-PARAM-EDGES 已修）
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑤ `{id}` 参数端点 ↔ 拼接调用建边，metadata 带 param_template + params', async () => {
  const PROJ = makeProjWith(path.join(TMP, 'p1_param'), { apiFile: 'param.js', apiJs: API_JS_PARAM });
  const rec = apiRecOf(await importFixture(PROJ, { include_api_edges: true }));

  // ★ 边必须存在，且 metadata 说清楚"这是模板边、参数名是什么"
  const rows = apiEdges(PROJ);
  const infoEdge = rows.map((x) => ({ row: x, md: JSON.parse(x.metadata) })).find((x) => x.md.url === 'backendApi/order/info/');
  assert.ok(infoEdge, `拼接 url 'backendApi/order/info/' + orderId 必须建边（砍模板匹配分支 ⇒ 这里 undefined），实得 url：${rows.map((x) => JSON.parse(x.metadata).url).join(' | ')}`);
  assert.equal(infoEdge.md.param_template, true, '模板建的边必须标 param_template:true（否则下游分不清结构边与字面边）');
  assert.deepEqual(infoEdge.md.params, ['orderId'], `params 必须是模板里的参数名清单，实得 ${JSON.stringify(infoEdge.md.params)}`);
  assert.equal(infoEdge.md.controller, 'OrderController.info', `必须指到 info 方法本身，实得 ${infoEdge.md.controller}`);
  assert.equal(infoEdge.md.api_function, 'fetchOneOrderInfo', `api_function 必须是调它的那个函数，实得 ${infoEdge.md.api_function}`);
  // ★ 边不绑定值：值是读数，不进判定。★ 字面量里那段**没写出来**（是拼接上去的）⇒ 记空串，不编造
  assert.deepEqual(infoEdge.md.param_values, [''], 'param_values 只是读数：拼接上去的那段字面量里不存在 ⇒ 空串');

  // ★ 精确匹配的边**不许**带 param_template（否则下游把所有边都当模板边）。
  //   夹具里另有一条 `url: '/backendApi/order/'`（POST，字面，裸 base）—— 它与端点 `/backendApi/order` 无，
  //   故用本夹具内的另一条**字面** url 做反证：`API_JS_PARAM` 里没有；这条反证放在 ⑩（字面 /order/save）判。

  // ★ 建过边 ⇒ 不再进 paramPathUnmatched（读数归零；只剩"段边界截断"那类残余）
  assert.ok(
    !rec.paramPathUnmatched.some((x) => x.startsWith('backendApi/order/info/ ')),
    `模板建了边还把它留在 paramPathUnmatched 里 = 读数谎报，实得 ${JSON.stringify(rec.paramPathUnmatched)}`,
  );
  assert.ok(rec.paramEdges >= 1, `回执要带参数模板边数（读数），实得 ${rec.paramEdges}`);

  // ★ 夹具里 `url: '/backendApi/order/'`（尾斜杠截断在段边界）**没有**任何模板能整段对上
  //   （段数不等）⇒ 它仍归 param 残余，必须点名——不许静默。
  assert.ok(
    rec.paramPathUnmatched.some((x) => x.includes('/backendApi/order/ (POST)')),
    `被截断在段边界的 url 也必须点名（不许掉进孤儿、也不许静默），实得 ${JSON.stringify(rec.paramPathUnmatched)}`,
  );
});

// ════════════════════════════════════════════════════════════════════
// ⑨ 反例三条：段数不等 / 字面段不同 / 方法不一致 —— 都不建边
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑨ 模板匹配反例：段数不等 / 字面段不同 / 方法不一致 都不建边', async () => {
  const PROJ = makeProjWith(path.join(TMP, 'p1_param_neg'), { apiFile: 'neg.js', apiJs: API_JS_NEG });
  const rec = apiRecOf(await importFixture(PROJ, { include_api_edges: true }));
  const rows = apiEdges(PROJ);
  const mdOf = (u: string) => rows.map((x) => JSON.parse(x.metadata)).find((m) => m.url === u);

  // ① 段数不等：字面部分多一段（`/info/42/sub` vs 模板 `/info/{orderId}`）⇒ 不许被吞
  assert.equal(
    mdOf('backendApi/order/info/42/sub'),
    undefined,
    `段数不等（多一段）不许建边 —— {x} 只能匹配一整段，实得 ${JSON.stringify(mdOf('backendApi/order/info/42/sub'))}`,
  );
  //   同一夹具里**方法不一致**那条（`'…/info/' + orderId` + POST）反过来是"该不建、但要分对栏"的对照：
  //   它证明这里是"段数"在拦，不是"什么都没建出来"（否则本条反例恒真、没有鉴别力）。
  assert.ok(
    rec.paramPathUnmatched.some((x) => x.startsWith('backendApi/order/info/ (POST)')),
    `同夹具的对照组（模板路径 + 方法不一致）必须落在 paramPathUnmatched（段数相等的模板路径被方法过滤挡下），实得 ${JSON.stringify(rec.paramPathUnmatched)}`,
  );
  // ② 字面段不同：大小写不同 ⇒ 不许建边（前缀相等/近似不算相等）
  assert.equal(mdOf('BackendApi/order/info/'), undefined, '字面段大小写不同不许建边（norm 口径不折叠大小写）');
  // ③ 方法不一致：路径对上 /info/{orderId}（GET），但调用写 POST ⇒ 不许建边，且要归 methodMismatch
  assert.equal(mdOf('backendApi/order/info/'), undefined, '方法不一致不许建边');
  //   ★ 用**路径能精确对上**的那条（/order/save 是 POST，这里 GET）：if/else 结构里字面路径的方法不一致
  //     走的是 methodMismatch 分支（模板路径的方法不一致只会"找不到"，因为模板分支自带方法过滤）。
  const badVerb = rec.methodMismatch.filter((x) => x.startsWith('/backendApi/order/save (GET)'));
  assert.equal(
    badVerb.length,
    1,
    `路径对上但方法不一致必须进 methodMismatch（不建边），实得 ${JSON.stringify(rec.methodMismatch)}`,
  );
  assert.equal(mdOf('/backendApi/order/save'), undefined, '方法不一致不许建边');
  //   ★ 模板路径 + 方法不一致：不建边，且**不许冒充**成模板边
  assert.equal(mdOf('backendApi/order/info/'), undefined, '模板路径 + 方法不一致不许建边');

  // ★ 纯函数层的同三条（更快、更直白，且直接钉住约束本身）
  //   ★ 反例必须是"末尾参数**之外**的段数差"：末尾 `{x}` 缺一段正是拼接 url 的合法形态（如 `'…/info/' + id`）。
  assert.equal(matchParamTemplate('/a/{x}/list', '/a/list'), null, '段数不等（缺的不是末尾参数）⇒ null');
  assert.equal(matchParamTemplate('/a/info/{id}', '/a/info/1/2'), null, '段数不等（多段）⇒ null');
  assert.equal(
    matchParamTemplate('/a/{id}/list', '/a/1/list2'),
    null,
    '段数相等但末尾字面段不同 ⇒ null（字面段必须逐字相等）',
  );
  assert.equal(matchParamTemplate('/a/{id}', '/a/1/list'), null, '末尾参数已填、模板却更短 ⇒ null（{x} 只匹配一整段）');
  // ★ 对照组：末尾参数**缺段**是拼接 url 的合法形态（`'…/info/' + id`），必须命中
  assert.deepEqual(matchParamTemplate('/a/info/{orderId}', '/a/info', true), { params: ['orderId'], values: [''] });
  assert.deepEqual(matchParamTemplate('/a/{x}/{y}', '/a', true), { params: ['x', 'y'], values: ['', ''] });
  assert.equal(matchParamTemplate('/a/info/{id}', '/a/infoOne/1'), null, '字面段不同 ⇒ null');
  assert.equal(matchParamTemplate('/a/{x}/list', '/a//list'), null, '{x} 段为空 ⇒ null');
  assert.equal(matchParamTemplate('/a/list', '/a/list'), null, '无 {x} 的路径不是模板边（那是精确匹配的事）');
  assert.deepEqual(matchParamTemplate('/a/info/{orderId}', '/a/info/42'), { params: ['orderId'], values: ['42'] });
  // ★ 末尾 `{x}` 段在**等长**情形下必须真的参与比较（写成 Math.min(epEnd,len) 就会整段跳过 ⇒ 这里 null ⇒ 红）
  assert.deepEqual(matchParamTemplate('/backendApi/order/{id}', '/backendApi/order/detail'), {
    params: ['id'],
    values: ['detail'],
  });
});

// ════════════════════════════════════════════════════════════════════
// ⑫ 纯字面 url 缺末尾参数段：没有 concat，不许使用拼接调用的例外
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑫ 非拼接字面 URL 不得吞掉末尾参数段', async () => {
  const PROJ = makeProjWith(path.join(TMP, 'p1_literal_missing_param'), {
    apiFile: 'literal.js',
    apiJs: API_JS_LITERAL_MISSING_PARAM,
  });
  const rec = apiRecOf(await importFixture(PROJ, { include_api_edges: true }));
  const rows = apiEdges(PROJ);
  assert.equal(rec.concatUrls, 0, '夹具必须真的是非拼接调用');
  assert.equal(rec.paramEdges, 0, '纯字面 /info 不得建成 /info/{orderId} 的参数模板边');
  assert.equal(rows.length, 0, '没有精确端点，也没有拼接表达式 ⇒ 不得建任何 API 边');
  assert.ok(
    rec.paramPathUnmatched.some((x) => x.startsWith('backendApi/order/info ')),
    `缺尾段的字面调用必须留作参数路径未匹配，实得 ${JSON.stringify(rec.paramPathUnmatched)}`,
  );
  assert.equal(
    matchParamTemplate('/a/info/{id}', '/a/info', false),
    null,
    '匹配器在未允许缺尾段时必须拒绝；只有 concat 调用方才传入 true',
  );
});

// ════════════════════════════════════════════════════════════════════
// ⑬ 同方法碰撞：模板不得抢在已命中的精确端点之前 continue
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑬ 同 HTTP 方法下精确端点优先于等长模板', async () => {
  const PROJ = makeProjWith(path.join(TMP, 'p1_exact_collision'), {
    apiFile: 'exact.js',
    apiJs: API_JS_EXACT_COLLISION,
    controllerName: 'ExactCollisionController.java',
    controllerSrc: EXACT_COLLISION_CONTROLLER,
  });
  const rec = apiRecOf(await importFixture(PROJ, { include_api_edges: true }));
  const rows = apiEdges(PROJ);
  assert.equal(rows.length, 1, '精确 save 与模板 {id} 不得同时建边');
  const md = JSON.parse(rows[0].metadata);
  assert.equal(md.controller, 'ExactCollisionController.save', `必须指向精确 save，实得 ${JSON.stringify(md)}`);
  assert.equal(md.param_template, undefined, '精确命中不得伪装成参数模板边');
  assert.equal(rec.paramEdges, 0);
  assert.equal(rec.matched, 1);
});

// ════════════════════════════════════════════════════════════════════
// ⑩ 混合场景：精确命中一个 + 模板命中另一个，互不干扰（精确优先）
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑩ 混合：精确命中与模板命中互不顶替（精确优先、controller 各指各的）', async () => {
  // ★ 必须**换掉**默认的 OrderController：它自带的 /order/info/{orderId} 会抢先命中 —— 那测的就不是本用例了
  const PROJ = makeProjWith(path.join(TMP, 'p1_param_mix'), {
    apiFile: 'mix.js',
    apiJs: API_JS_MIX,
    controllerName: 'MixController.java',
    controllerSrc: MIX_CONTROLLER,
  });
  const rec = apiRecOf(await importFixture(PROJ, { include_api_edges: true }));
  const rows = apiEdges(PROJ);
  const mdOf = (u: string) => rows.map((x) => JSON.parse(x.metadata)).find((m) => m.url === u);

  // 精确那条：/backendApi/order/save 是**字面**端点；同文件另有一个端点 /backendApi/order/{id}
  //   —— 模板也能"对上"它（一段），但精确必须先赢。
  const save = mdOf('/backendApi/order/save');
  assert.ok(save, `字面端点 /backendApi/order/save 必须建边，实得 url：${rows.map((x) => JSON.parse(x.metadata).url).join(' | ')}`);
  assert.equal(save.param_template, undefined, '精确优先：save 必须走精确分支（不许被 /backendApi/order/{id} 当成模板边抢走）');
  assert.equal(save.controller, 'MixController.save', `精确边的 controller 必须是自己，实得 ${save.controller}`);

  // 模板那条：/backendApi/order/detail/ + id ⇒ 命中 /backendApi/order/{id}
  //   ★ 用 `'/backendApi/order/detail/' + id`（数字后缀无关，①② 才有 id 字面量）—— 见下 API_JS_MIX
  const detail = mdOf('/backendApi/order/detail/');
  assert.ok(detail, `模板边必须建（detail + id ⇒ /backendApi/order/{id}），实得 url：${rows.map((x) => JSON.parse(x.metadata).url).join(' | ')}`);
  assert.equal(detail.param_template, true);
  assert.deepEqual(detail.params, ['id']);
  assert.equal(detail.controller, 'MixController.byId', `模板边的 controller 必须指到 {id} 那个方法，实得 ${detail.controller}`);

  // 两条边互不干扰：各自 api_function 正确
  assert.equal(save.api_function, 'saveOrder');
  assert.equal(detail.api_function, 'getOrderDetail');

  // ★★ 顺序判据的**唯一牙口**（M6）：同一 url `/backendApi/order/save` 在字面端点 `save`（POST）
  //   与模板端点 `{id}`（GET）**两边都成立** ⇒ 只有"精确先试"才留得下精确边；
  //   把模板挪到精确之前，这条 url 会被 GET 模板抢走（方法也不一致）⇒ 下面两行一起红。
  assert.ok(
    rows.some((x) => JSON.parse(x.metadata).api_function === 'saveOrder'),
    `saveOrder 那条必须留在边上（模板抢到前面会把它顶掉），实得 api_function：${rows.map((x) => JSON.parse(x.metadata).api_function).join(' | ')}`,
  );
  const byId = mdOf('/backendApi/order/7');
  assert.equal(byId, undefined, '模板边只按字面量认，按值替换出来的 url 不在图上（夹具一致性）');
  assert.ok(rec.paramEdges >= 1, `paramEdges 读数必须 ≥1，实得 ${rec.paramEdges}`);
});

// ════════════════════════════════════════════════════════════════════
// ⑪ 真孤儿：后端没有对应模板 ⇒ 必须进 frontendOrphan，不许被模板吞掉
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑪ 后端无对应模板的真孤儿必须进 frontendOrphan（模板不许吞孤儿）', async () => {
  const PROJ = makeProjWith(path.join(TMP, 'p1_param_orphan'), {
    apiFile: 'orphan.js',
    apiJs: API_JS_ORPHAN,
  });
  const rec = apiRecOf(await importFixture(PROJ, { include_api_edges: true }));

  // ★ 真语料形态：`'backendApi/refund/delete/' + refundId` —— 后端 BackendRefundController
  //   只有 /list /preCheck /info/{refundId} save doRefund，**没有 delete** ⇒ 这是真缺口。
  assert.ok(
    rec.frontendOrphan.some((x) => x.startsWith('backendApi/refund/delete/ ')),
    `后端无对应端点的拼接 url 必须进 frontendOrphan（模板匹配过宽就会把它吞掉 —— 这是本卡最贵的反例），实得 ${JSON.stringify(rec.frontendOrphan)}`,
  );
  const rows = apiEdges(PROJ);
  assert.ok(
    !rows.some((x) => JSON.parse(x.metadata).url === 'backendApi/refund/delete/'),
    '不许给真孤儿建边（建了 = 把缺口伪装成影响面）',
  );
});

// ════════════════════════════════════════════════════════════════════
// ⑥ opt-in：默认不改既有行为
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑥ 不传 include_api_edges ⇒ 回执无 api_reconcile、无边（默认行为不变）', async () => {
  const PROJ = makeProj(path.join(TMP, 'p1_optin'));
  const r = await importFixture(PROJ); // 不传 opt-in
  assert.equal(r.api_reconcile, undefined, '默认不许出现 api_reconcile（否则既有回执契约被悄悄改了）');
  assert.equal(apiEdges(PROJ).length, 0, '默认不许建 api_endpoint 边');
  assert.ok(
    !((r.skipped as string[]) ?? []).some((s) => s.includes('── API 端点对账 ──')),
    '默认回执里不许出现对账段',
  );
});

// ════════════════════════════════════════════════════════════════════
// ⑦ 不被误伤：无 src/api 目录的项目
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑦ 无 src/api 目录的项目：端点照扫、url 0 条、不抛、不建边', async () => {
  const PROJ = makeProj(path.join(TMP, 'p1_no_api'), { withApi: false });
  const r = await importFixture(PROJ, { include_api_edges: true });
  const rec = apiRecOf(r);
  assert.equal(rec.urls, 0, `没有 src/api 目录 ⇒ url 0 条，实得 ${rec.urls}`);
  assert.equal(rec.edges, 0, '没有前端 url ⇒ 不许建边');
  assert.equal(rec.frontendOrphan.length, 0, '没有前端 url ⇒ 孤儿必须为空（不许编）');
  assert.equal(rec.endpoints, 3, `后端端点仍要扫出来（读数带分母），实得 ${rec.endpoints}`);
  assert.equal(apiEdges(PROJ).length, 0);
});

// ════════════════════════════════════════════════════════════════════
// ⑧ 双层类：内层 base 不继承外层
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑧ 内部类：取内层自己的类级 mapping 作 base（不回落外层）', async () => {
  const PROJ = makeProj(path.join(TMP, 'p1_nested'), { withNested: true });
  const r = await importFixture(PROJ, { include_api_edges: true });
  const rec = apiRecOf(r);
  assert.equal(rec.endpoints, 4, `3（OrderController）+ 1（Inner.ping）= 4，实得 ${rec.endpoints}`);
  // 端点路径必须带内层 base；判据 = 它出现在后端端点全集里（backendNoApi 是端点全集的投影，只截 50 条，
  //   所以这里直接用模块级 reconcile 复核一条干净读数）
  const db = dbOf(PROJ);
  const rec2 = reconcileApiEndpoints(db as never, PROJ);
  // /backendApi/inner/ping 不在前端调用里 ⇒ 必然出现在「后端端点无前端调用」清单里；
  //   ★ 反向证据更强：若外层 base 被误用（'' 或别的），这条就不会出现。
  const all = [...rec2.backendNoApi];
  assert.ok(
    all.some((x) => x.includes('/backendApi/inner/ping')),
    `内层类必须用内层 base /backendApi/inner；实测后端无前端调用的端点为：${all.join(' | ') || '（空）'}`,
  );
  void rec;
});
