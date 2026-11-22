/**
 * 适配器：门表（源 = `scripts/verify.mjs#GATES` 静态解析）。
 *
 * ★ 不 import 门执行器（main() 有 argv 守卫，import 会跑全部门）；口径对齐
 *   `tests/p0_gate_table.test.ts#gateNames`：找 `const GATES = [` 到 `\n];`，惰性 tsGate 补 `['ts 类型']`，
 *   其余 `name: '...'` 正则提取。纯清单/指针段（M8），不投影散文纪律。
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha16Hex } from '../markers.js';
import type { AdapterSource, DocBlockAdapter, SourceItem } from '../types.js';

const GATES_REL = 'scripts/verify.mjs';

function parseGateNames(src: string): string[] {
  const start = src.indexOf('const GATES = [');
  if (start < 0) throw new Error('verify.mjs 里找不到 `const GATES = [`');
  const end = src.indexOf('\n];', start);
  if (end < 0) throw new Error('GATES 数组没有闭合的 `];`');
  const body = src.slice(start, end);
  const lazy = /\btsGate\b/.test(body) ? ['ts 类型'] : [];
  const names = [...body.matchAll(/\bname:\s*'([^']+)'/g)].map((m) => m[1]);
  return [...lazy, ...names];
}

function readGates(root: string): AdapterSource {
  const file = path.join(root, GATES_REL);
  if (!fs.existsSync(file)) {
    return {
      adapterId: 'guide.gates',
      rev: '',
      items: [],
      labelSets: {},
      availability: { readable: false, reason: `门清单源缺失：${GATES_REL}` },
    };
  }
  const src = fs.readFileSync(file, 'utf8');
  const names = parseGateNames(src);
  const items: SourceItem[] = names.map((name) => ({
    id: name,
    labels: { source: GATES_REL },
  }));
  return {
    adapterId: 'guide.gates',
    rev: sha16Hex(JSON.stringify(names)),
    items,
    labelSets: { source: [GATES_REL] },
    availability: { readable: true },
    snapshot: sha16Hex(src),
  };
}

function renderGates(source: AdapterSource): string {
  const rows = source.items.map((it) => `| ${it.id} | \`${GATES_REL}#GATES\` |`);
  return ['| 门名 | 来源 |', '|---|---|', ...rows].join('\n');
}

export const gatesAdapter: DocBlockAdapter = {
  id: 'guide.gates',
  docRel: 'docs/GUIDE-GATE.md',
  title: '门清单（投影自 verify.mjs#GATES）',
  lifecycleStage: 'committed',
  read: readGates,
  render: renderGates,
};
