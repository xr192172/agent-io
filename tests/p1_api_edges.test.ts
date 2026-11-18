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
 * | ⑤ | 参数端点 `{id}` **不建边但计数可见**（T-#API-PARAM-EDGES） | 参数类静默 ⇒ ② 的读数会谎报 |
 * | ⑥ | opt-in：不传 `include_api_edges` ⇒ 回执无 `api_reconcile`、无边（不改既有行为） | 恒真判断 ⇒ ⑥ 红 |
 * | ⑦ | 未注册语言 / 无 `src/api` 目录的项目不被误伤（端点照扫、url 0 条、不抛） | reconcile 无端点时乱写 ⇒ ⑦ 红 |
 * | ⑧ | 双层类（内部类）各自取自己的类级 mapping，内层不继承外层 base | 回落外层 ⇒ ⑧ 红 |
 *
 * ## 夹具为什么这么摆
 * 预检闸取 `walkFiles` 排序后**前 3 个**代码文件试解析、合计 0 符号就拒导入
 * （`import_project.ts` 约 954 行；fuintCashier 就是栽在这）。⇒ 夹具里 `src/api/order.js`
 * （字典序 `src/api/…` < `src/…`）与 `OrderController.java` 都在前 3 个，且都出符号。
 *
 * touches: src/infrastructure/analysis/api_endpoint_edges.ts, src/infrastructure/graph/import_project.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { importProject } from '../src/infrastructure/graph/import_project.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { normApiUrl, segJoin, reconcileApiEndpoints } from '../src/infrastructure/analysis/api_endpoint_edges.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
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

const UTIL_TS = `export function noop(): void {
  return;
}
`;

function makeProj(dir: string, opts: { withApi?: boolean; withNested?: boolean } = {}): string {
  const withApi = opts.withApi !== false;
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  // 预检前 3 个：src/api/order.js（有符号）→ src/util.ts（有符号）→ 根上的 Controller.java
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
    skipped.some((s) => s.includes(`精确匹配 ${rec.matched}/${rec.urls}`)),
    '对账行必须带分母（matched/urls）',
  );
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
// ⑤ 参数端点：不建边但计数可见（挂账 T-#API-PARAM-EDGES）
// ════════════════════════════════════════════════════════════════════
test('api-edges · ⑤ `{id}` 参数端点不建边，但 paramPathUnmatched 里点名可见', async () => {
  const PROJ = makeProj(path.join(TMP, 'p1_param'));
  const rec = apiRecOf(await importFixture(PROJ, { include_api_edges: true }));

  // ★ 按**行首的 url** 过滤（别用 `includes(...)`：两行里都会出现 `info/{orderId}` 字样）
  const paramHit = rec.paramPathUnmatched.filter((x) => x.startsWith('backendApi/order/info/ '));
  assert.equal(paramHit.length, 1, `参数路径必须计数可见（不许静默），实得 ${JSON.stringify(rec.paramPathUnmatched)}`);
  assert.match(paramHit[0], /src\/api\/order\.js:\d+/, '参数类条目也要带出处');
  // ★ 夹具里另有一条 `url: '/backendApi/order/'`（尾斜杠截断在段边界）—— 它同时前缀命中
  //   三个端点，天然归参数类（拼接/截断 ⇒ 尾部段对不上）。这里只要求它**不被静默吞掉**。
  assert.ok(
    rec.paramPathUnmatched.some((x) => x.includes("'/backendApi/order/'") || x.includes('/backendApi/order/ (POST)')),
    '被截断在段边界的 url 也必须进 param 类（不许掉进孤儿、也不许静默）',
  );

  // ★ 本轮不猜 ⇒ 不许建边（建了就是把猜测当事实）
  const rows = apiEdges(PROJ);
  assert.ok(
    !rows.some((x) => JSON.parse(x.metadata).url.includes('/info/')),
    '参数端点两端**不建边**（T-#API-PARAM-EDGES 未决）',
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
