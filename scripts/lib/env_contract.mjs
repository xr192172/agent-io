#!/usr/bin/env node
/**
 * env_contract.mjs —— 仓根 `env-contract.json` 的读取 + 结构校验一处权威。
 *
 * ## 它是什么
 * CI-fix C3：工具链契约（命令 / 版本下限 / 平台子集 / 派生库归属）只在仓根
 * `env-contract.json` 登记一份；本地 harness 与 CI workflow 共读这里，不在脚本里私补阈值。
 *
 * ## fail-closed 纪律
 * · 契约文件读不到 / JSON 坏 / 结构不符 ⇒ `loadContract` 抛错（调用方按环境未就绪处置），
 *   不回退到内置硬编码默认值（那会制造第二处权威）。
 * · `validateContract` 只判结构形状与交叉引用（平台子集引用的工具必须在 tools 里），
 *   不判"本机装没装"——那是 env-check 的实测读数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTRACT_REL = 'env-contract.json';

const TOOL_KEYS = ['node', 'npm', 'git', 'java', 'maven', 'go'];
const PLATFORM_KEYS = ['windows', 'linux'];
const DERIVED_KEYS = ['design_db', 'cache_db', 'tasks_db'];
const DERIVED_CI = new Set(['in-repo', 'bootstrap', 'unsupported']);

/** 读仓根契约；文件缺失 / JSON 坏 / 结构不符都抛错（fail-closed，不回退内置默认）。 */
export function loadContract(root = ROOT) {
  const abs = path.join(root, CONTRACT_REL);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new Error(`env-contract 读不到（${CONTRACT_REL}）：${e?.code ?? e?.message ?? e}`);
  }
  let contract;
  try {
    contract = JSON.parse(raw);
  } catch (e) {
    throw new Error(`env-contract JSON 坏（${CONTRACT_REL}）：${e?.message ?? e}`);
  }
  const problems = validateContract(contract);
  if (problems.length) throw new Error(`env-contract 结构不符：${problems.join('；')}`);
  return contract;
}

/**
 * 纯函数：校验契约结构。返回问题串数组（空 = 合规）。
 * @param {any} contract
 * @returns {string[]}
 */
export function validateContract(contract) {
  const problems = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return ['契约必须是 JSON 对象'];
  }
  if (typeof contract.schema !== 'string' || !contract.schema.startsWith('env-contract/')) {
    problems.push('schema 必须是 env-contract/<版本>');
  }

  const tools = contract.tools;
  if (!tools || typeof tools !== 'object') {
    problems.push('缺 tools 段');
    return problems;
  }
  for (const k of TOOL_KEYS) {
    const t = tools[k];
    if (!t || typeof t !== 'object') {
      problems.push(`tools.${k} 缺登记`);
      continue;
    }
    if (typeof t.command !== 'string' || t.command === '') problems.push(`tools.${k}.command 必须是非空字符串`);
    if (typeof t.required !== 'boolean') problems.push(`tools.${k}.required 必须是布尔`);
    if (!t.ci || typeof t.ci !== 'object') problems.push(`tools.${k}.ci 缺登记`);
    const v = t.version;
    if (v !== null && v !== undefined) {
      if (typeof v !== 'object') problems.push(`tools.${k}.version 必须是 null 或对象`);
      else {
        if (!Number.isFinite(v.major_min)) problems.push(`tools.${k}.version.major_min 必须是数字`);
        if (v.minor_min !== undefined && !Number.isFinite(v.minor_min)) problems.push(`tools.${k}.version.minor_min 必须是数字`);
      }
    }
  }
  for (const k of Object.keys(tools)) {
    if (!TOOL_KEYS.includes(k)) problems.push(`tools.${k} 是未登记的工具键`);
  }

  const platforms = contract.platforms;
  if (!platforms || typeof platforms !== 'object') {
    problems.push('缺 platforms 段');
  } else {
    for (const k of PLATFORM_KEYS) {
      const p = platforms[k];
      if (!p || typeof p !== 'object') {
        problems.push(`platforms.${k} 缺登记`);
        continue;
      }
      if (typeof p.runs_on !== 'string' || p.runs_on === '') problems.push(`platforms.${k}.runs_on 必须是非空字符串`);
      if (!Array.isArray(p.tools)) problems.push(`platforms.${k}.tools 必须是数组`);
      else {
        for (const t of p.tools) {
          if (!TOOL_KEYS.includes(t)) problems.push(`platforms.${k}.tools 引用了未登记工具 ${t}`);
        }
      }
    }
    for (const k of Object.keys(platforms)) {
      if (!PLATFORM_KEYS.includes(k)) problems.push(`platforms.${k} 是未登记平台键`);
    }
  }

  const derived = contract.derived;
  if (!derived || typeof derived !== 'object') {
    problems.push('缺 derived 段');
  } else {
    for (const k of DERIVED_KEYS) {
      const d = derived[k];
      if (!d || typeof d !== 'object') {
        problems.push(`derived.${k} 缺登记`);
        continue;
      }
      if (!DERIVED_CI.has(d.ci)) problems.push(`derived.${k}.ci 必须是 ${[...DERIVED_CI].join('/')}`);
      if (typeof d.in_repo !== 'boolean') problems.push(`derived.${k}.in_repo 必须是布尔`);
    }
  }
  return problems;
}

/** 取某工具的契约登记（未登记返回 null，调用方按 fail-closed 处置）。 */
export function toolSpec(contract, name) {
  return contract?.tools?.[name] ?? null;
}
