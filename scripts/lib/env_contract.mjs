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
/** gates 节每门允许的子键；lanes/needs/derived 必须是数组 */
const GATE_KEYS = ['lanes', 'needs', 'derived', 'note', 'exclusion'];
/** offLane 排除登记三要素：原因 / 替代手段 / 到期 */
const EXCLUSION_KEYS = ['reason', 'alternative', 'expires'];

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

  const gates = contract.gates;
  if (!gates || typeof gates !== 'object') {
    problems.push('缺 gates 段');
  } else {
    for (const [gate, spec] of Object.entries(gates)) {
      if (!gate || typeof gate !== 'string') { problems.push('gates 键必须是非空字符串（门名）'); continue; }
      if (!spec || typeof spec !== 'object') { problems.push(`gates.${gate} 缺登记`); continue; }
      for (const k of Object.keys(spec)) {
        if (!GATE_KEYS.includes(k)) problems.push(`gates.${gate}.${k} 是未登记子键`);
      }
      if (!Array.isArray(spec.lanes)) problems.push(`gates.${gate}.lanes 必须是数组`);
      else for (const l of spec.lanes) {
        if (!PLATFORM_KEYS.includes(l)) problems.push(`gates.${gate}.lanes 引用未登记平台 ${l}`);
      }
      if (!Array.isArray(spec.needs)) problems.push(`gates.${gate}.needs 必须是数组`);
      else for (const t of spec.needs) {
        if (!TOOL_KEYS.includes(t)) problems.push(`gates.${gate}.needs 引用未登记工具 ${t}`);
      }
      if (!Array.isArray(spec.derived)) problems.push(`gates.${gate}.derived 必须是数组`);
      else for (const d of spec.derived) {
        if (!DERIVED_KEYS.includes(d)) problems.push(`gates.${gate}.derived 引用未登记派生库 ${d}`);
      }
      // H4 成员资格护栏：车道外门（lanes=[]）必须登记排除三要素（原因 / 替代 / 到期），
      // 不得静默移出车道；若给了 exclusion，三键必须齐全且非空字符串。
      const offLane = Array.isArray(spec.lanes) && spec.lanes.length === 0;
      if (offLane && spec.exclusion == null) {
        problems.push(`gates.${gate} 车道外（lanes=[]）缺 exclusion 排除登记（reason/alternative/expires）`);
      }
      if (spec.exclusion != null) {
        if (typeof spec.exclusion !== 'object' || Array.isArray(spec.exclusion)) {
          problems.push(`gates.${gate}.exclusion 必须是对象`);
        } else {
          for (const k of Object.keys(spec.exclusion)) {
            if (!EXCLUSION_KEYS.includes(k)) problems.push(`gates.${gate}.exclusion.${k} 是未登记排除键`);
          }
          for (const k of EXCLUSION_KEYS) {
            const v = spec.exclusion[k];
            if (typeof v !== 'string' || v.trim() === '') problems.push(`gates.${gate}.exclusion.${k} 必须是非空字符串`);
          }
        }
      }
    }
  }

  // H4 受保护门身份集：核心 / 语义门必须在 ≥1 车道 inLane，不得被静默移出凑绿。
  const protectedGates = contract.protected_gates;
  if (!Array.isArray(protectedGates)) {
    problems.push('protected_gates 必须是数组');
  } else {
    for (const name of protectedGates) {
      const spec = gates?.[name];
      if (!spec) { problems.push(`protected_gates 引用未登记门 ${name}`); continue; }
      if (!Array.isArray(spec.lanes) || spec.lanes.length === 0) {
        problems.push(`受保护门 ${name} 不得移出所有 CI 车道（lanes 不得为空）`);
      }
    }
  }
  return problems;
}

/** 取某工具的契约登记（未登记返回 null，调用方按 fail-closed 处置）。 */
export function toolSpec(contract, name) {
  return contract?.tools?.[name] ?? null;
}

/** 取某道门的车道/needs/derived 登记（未登记返回 null）。 */
export function gateSpec(contract, name) {
  return contract?.gates?.[name] ?? null;
}

/** 某车道应跑的门名集合；lanes 未登记 ⇒ 空集（fail-closed，不默认全量）。 */
export function gatesForLane(contract, lane) {
  const out = new Set();
  for (const [name, spec] of Object.entries(contract?.gates ?? {})) {
    if (Array.isArray(spec?.lanes) && spec.lanes.includes(lane)) out.add(name);
  }
  return out;
}

/**
 * 车道汇总退出码政策（CI-fix O-1 修法 a · 防稀释护栏）。
 *
 * ## 职责
 * 只改**车道聚合退出码**哪些门计入；逐门自身 PASS/FAIL/SKIP 三态判定（§13.5）不动。
 * · `laneSet === null`（未传 `--lane`，本地全量默认）：全部门计入，现状逐字不变。
 * · 车道模式：**仅 manifest gates 节声明的本车道门**计入 fail/skip；manifest 声明的车道外门
 *   从汇总退出码排除（预期排除，本车道不运行），单列 `offLane` 不折 PASS 也不计码。
 * · **防稀释护栏**：车道内任何 SKIP/unsupported 仍判红（退 2）——不得把车道内 unexpected SKIP
 *   也排除（防 SKIP 凑绿 loopholes）。
 *
 * ## 退出码
 * 车道内 FAIL ⇒ 1；车道内 SKIP/unsupported（无 FAIL）⇒ 2；车道内全 PASS ⇒ 0；车道外门不计。
 *
 * @param {Array<{name:string, state:'PASS'|'FAIL'|'SKIP'}>} done 逐门三态（与 verify.mjs done 同形）
 * @param {Set<string>|null} laneSet 本车道收录门名集合；null = 非车道全量模式
 */
export function aggregateLane(done, laneSet) {
  const inLane = [];
  const offLane = [];
  // H4 护栏：车道模式下 laneSet 为空集 ⇒ 无门可跑（契约把全部门移出本车道），fail-closed 拒绝，
  // 不许空车道凑 RC0。null（本地全量）不受此限。
  const emptyLane = laneSet !== null && laneSet.size === 0;
  for (const d of done ?? []) {
    const inside = laneSet === null || laneSet.has(d.name);
    (inside ? inLane : offLane).push(d);
  }
  const failNames = inLane.filter((d) => d.state === 'FAIL').map((d) => d.name);
  const skipNames = inLane.filter((d) => d.state === 'SKIP').map((d) => d.name);
  // 差集：本车道应跑（laneSet）里实际没出现在 done 的门 ⇒ 披露为 missing（防漏跑不响）。
  const doneNames = new Set((done ?? []).map((d) => d.name));
  const missingInRun = laneSet === null ? [] : [...laneSet].filter((n) => !doneNames.has(n));
  const code = emptyLane
    ? 2
    : failNames.length > 0
      ? 1
      : skipNames.length > 0 || missingInRun.length > 0
        ? 2
        : 0;
  return {
    code,
    fail: failNames.length,
    skip: skipNames.length,
    inLane: inLane.length,
    offLane: offLane.length,
    emptyLane,
    expected: laneSet === null ? null : [...laneSet],
    missingInRun,
    inLaneNames: inLane.map((d) => d.name),
    failNames,
    skipNames,
    offLaneNames: offLane.map((d) => d.name),
  };
}
