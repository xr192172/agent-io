/**
 * P0 · 消费者三档计数的**唯一算法**（`src/domain/consumer_tally.ts#tallyConsumers`）
 *
 * ## 它挡的事故
 * `contract_page` 的 `consumers.count` 改前 = `consumerSites.length`，而 sites 的构造是
 * 「每个 importer **只取 `refs[0]` 一个点**」且**整块不读 `definition.refs`**
 * ⇒ **只被同文件使用的符号恒报 0**。实测 `classifyLayer`：`find_references` 报 4 处
 * （def@L199 + usage@L971/1075/1099），`contract_page` 报 **0**。
 *
 * ## 断言口径
 * 合计 ≡ `find_references` 的 `definition.refs.length + Σ importers[].refs.length`；
 * **三档各自的值都要钉住** —— 只钉合计时「全塞进合计、分项照样错」看不出来。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tallyConsumers, type ConsumerSiteRef } from '../src/domain/consumer_tally.js';

const same = (line: number, kind: string): ConsumerSiteRef => ({
  scope: 'same-file',
  file: 'src/x/index.ts',
  line,
  kind,
});
const cross = (file: string, line: number, kind: string): ConsumerSiteRef => ({ scope: 'cross-file', file, line, kind });

test('① 只被同文件使用（classifyLayer 形状）⇒ 合计 4，不是 0', () => {
  const sites = [same(199, 'definition'), same(971, 'usage'), same(1075, 'usage'), same(1099, 'usage')];
  assert.deepEqual(tallyConsumers(sites, 0), {
    cross_file_importer_files: 0,
    cross_file_sites: 0,
    same_file_usage: 3,
    same_file_definition: 1,
    total: 4,
  });
});

test('② 只有跨文件导入者（stripCommentsFor 形状）⇒ 1 个文件 / 2 处 + 定义点 = 3', () => {
  const sites = [cross('src/domain/expectation_kinds.ts', 30, 'import'), cross('src/domain/expectation_kinds.ts', 257, 'usage'), same(100, 'definition')];
  assert.deepEqual(tallyConsumers(sites, 1), {
    cross_file_importer_files: 1,
    cross_file_sites: 2,
    same_file_usage: 0,
    same_file_definition: 1,
    total: 3,
  });
});

test('③ export_list 归「同文件定义/导出点」档（它既不是 usage 也不是跨文件）', () => {
  const sites = [same(10, 'definition'), same(12, 'export_list'), same(40, 'usage')];
  assert.deepEqual(tallyConsumers(sites, 0), {
    cross_file_importer_files: 0,
    cross_file_sites: 0,
    same_file_usage: 1,
    same_file_definition: 2,
    total: 3,
  });
});

test('④ 空 ⇒ 全 0（读端仍能从分母看出来「一条都没数到」，而不是把 0 当「扫不到」）', () => {
  assert.deepEqual(tallyConsumers([], 0), {
    cross_file_importer_files: 0,
    cross_file_sites: 0,
    same_file_usage: 0,
    same_file_definition: 0,
    total: 0,
  });
});

test('⑤ 导入方文件数独立于站点数（有 importSources 但拿不到行号的 importer 也是导入方）', () => {
  const tally = tallyConsumers([cross('src/a.ts', 7, 'usage')], 2);
  assert.equal(tally.cross_file_importer_files, 2, '2 个 importer 里只有 1 个留下引用点 ⇒ 文件数仍是 2');
  assert.equal(tally.cross_file_sites, 1);
  assert.equal(tally.total, 1, '合计数的是**站点**，不是文件数（混着数会让口径不可复算）');
});
