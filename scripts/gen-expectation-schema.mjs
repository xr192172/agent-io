#!/usr/bin/env node
/**
 * ★★★ 2026-10-28（T-#KIND-1）：**从注册表生成 JSON Schema 的判据分支**。
 *
 * ## 为什么要有它
 * `schema/design_dsl.schema.json` 里的判据 `anyOf` 原来是**手抄的**，而且是**两处**
 * （节点 `decision.expectations` 与 task `prepared_snapshot.expectations`）——
 * 加 kind 忘一处 ⇒ 那个 kind 在某条路径上**静默不可用**（本仓踩过两次：`read_set.basis` / `domain-independent`）。
 * ⇒ 唯一事实源 = `src/domain/expectation_kinds.ts#KIND_SPECS`，本脚本把它渲染成 schema 分支。
 *
 * ★ 匹配范围要**收窄**：证据联合体（`expectations` / `reading` / `attestation`）**也有** `kind.const`，
 *   只换"分支里出现**判据** kind"的那几个联合体，否则会把证据 kind 覆掉（实测会静默改坏 evidence schema）。
 *
 * ## 用法（要 tsx：注册表是 TS）
 *   node --import tsx scripts/gen-expectation-schema.mjs           # 写盘
 *   node --import tsx scripts/gen-expectation-schema.mjs --check    # 只比对（证/CI 用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = path.join(ROOT, 'schema/design_dsl.schema.json');

// ★ Windows：动态 import 只认 file:// URL（绝对路径 ⇒ ERR_UNSUPPORTED_ESM_URL_SCHEME）
const { KIND_SPECS } = await import(pathToFileURL(path.join(ROOT, 'src/domain/expectation_kinds.ts')).href);
const KIND_NAMES = new Set(Object.keys(KIND_SPECS));

// ★ 2026-10-31（B1b）：7 个 type 分支的渲染核搬进 src/domain/expectation_branch.ts#jsonSchemaTypeOf
//   （零依赖纯函数 ⇒ 8 条 behavior-cases 现跑判）；本脚本只留 kind 联合体的整体装配（下面的 branchOf）。
//   ★ 加载方式与本文件引入 expectation_kinds.ts 同一条（tsx 直跑 .ts，不走 dist）。
const { jsonSchemaTypeOf } = await import(pathToFileURL(path.join(ROOT, 'src/domain/expectation_branch.ts')).href);

const branchOf = (spec) => {
  const properties = {
    kind: { const: spec.kind },
    why: { type: 'string' },
    ...Object.fromEntries(spec.fields.map((f) => [f.name, jsonSchemaTypeOf(f)])),
  };
  const required = ['kind', 'why', ...spec.fields.filter((f) => f.required).map((f) => f.name)].sort();
  const b = { type: 'object', properties, required };
  if (spec.atLeastOneOf) b.anyOf = spec.atLeastOneOf.map((n) => ({ required: [n] }));
  return b;
};

const branches = Object.values(KIND_SPECS).map(branchOf);

const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
let touched = 0;
const walk = (o) => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) return o.forEach(walk);
  if (Array.isArray(o.anyOf)) {
    const consts = o.anyOf.map((b) => b?.properties?.kind?.const).filter(Boolean);
    const isExpectationUnion = consts.length > 1 && consts.some((c) => KIND_NAMES.has(c));
    if (isExpectationUnion) {
      o.anyOf = JSON.parse(JSON.stringify(branches));
      touched++;
    }
  }
  for (const k of Object.keys(o)) walk(o[k]);
};
walk(schema);

const next = JSON.stringify(schema, null, 2) + '\n';
const prev = fs.readFileSync(SCHEMA, 'utf8');
const same = next === prev;

if (process.argv.includes('--check')) {
  console.log(
    same
      ? `✓ schema 与注册表一致（${branches.length} 个 kind × ${touched} 处联合体）`
      : `✗ schema 与注册表不一致（${branches.length} 个 kind）⇒ 跑 node --import tsx scripts/gen-expectation-schema.mjs`,
  );
  process.exit(same ? 0 : 1);
}

fs.writeFileSync(SCHEMA, next);
console.log(`已按注册表重写 ${touched} 处判据联合体（${branches.length} 个 kind）${same ? '（内容无变化）' : ''}`);
