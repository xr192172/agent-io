/**
 * 接线账的**入口编排**：把"手写四个对象"换成"自动枚举出来的能力声明"。
 *
 * ## 两条纪律
 * ① **原有四对象不退化**：先跑 `wiring_facts.ts` 里那四个（`includeComments` / `deriveJudgements` /
 *    `runtime` / `BrickContract`）——它们的探针比通用探针更懂自己那几格；
 * ② **新增声明自动进账**：`wiring_claims.ts` 枚举出来的其余声明（判据 kind / 工具 / capability 域 /
 *    code_health 候选）用**通用探针**补齐，按 `subject` 去重 ⇒ **加一个新 kind 或新域不需要改本文件**。
 *
 * ★ 本模块不维护任何"能力清单"：清单住在四类权威里（`KIND_SPECS` / 工具注册 / `structure.domains.json` /
 *   code_health）。本文件只做去重与编排。
 */
import fs from 'node:fs';
import path from 'node:path';

import { collectWiringProbes } from './wiring_facts.js';
import { enumerateClaims, type CapabilityClaim, type SourceReport } from './wiring_claims.js';
import type { WiringFacts, WiringProbe } from './wiring_ledger.js';

const read = (root: string, rel: string): string => {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return '';
  }
};
const count = (s: string, n: string): number => s.split(n).length - 1;

function countInSheets(root: string, needle: string): number {
  const dir = path.join(root, '.agent-io', 'design');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.dsl.json')) continue;
    n += count(read(root, path.join('.agent-io', 'design', f)), needle);
  }
  return n;
}

function byKindOf(root: string): Record<string, { checked?: number }> {
  try {
    const j = JSON.parse(read(root, '.agent-io/judge-readings.json')) as { by_kind?: Record<string, { checked?: number }> };
    return j.by_kind ?? {};
  } catch {
    return {};
  }
}

/** 文件名级消费者数（排除测试与本账自身；不数出现次数） */
function importersOf(root: string, rel: string): number {
  const SELF = /analysis[\\/]health[\\/]wiring_(facts|ledger|claims|enumerate)\.ts$/;
  const base = path.basename(rel, '.ts');
  const walk = (dir: string): string[] => {
    let out: string[] = [];
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(p));
      else if (/\.(ts|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  let n = 0;
  for (const d of ['src', 'tests']) {
    for (const f of walk(path.join(root, d))) {
      if (SELF.test(f) || f.replace(/\\/g, '/').endsWith(rel)) continue;
      try {
        if (fs.readFileSync(f, 'utf8').includes(base)) n += 1;
      } catch {
        /* 读不到不数 */
      }
    }
  }
  return n;
}

/**
 * 通用探针：只按**证据引用**取事实，取不到就记 `null` ⇒ 交给判定核给 `unverifiable`
 * （而不是把"没引用"读成"没问题"）。
 */
function genericFacts(root: string, c: CapabilityClaim): WiringFacts {
  const byKind = byKindOf(root);
  const notes: WiringFacts['notes'] = {};
  // ★ declared 的口径按**来源**定，不是一律去读文件：
  //   · tool-registry：条目来自 TOOL_DEFS 本身 ⇒ 它就是声明（读到文件与否无关）
  //   · explicit-declaration（域）：读 structure.domains.json 里的 role='capability'
  //   · 其它：声明引用应当是一个真实文件路径
  let declared: boolean;
  if (c.source === 'tool-registry') {
    declared = true;
    notes.declared = `${c.evidence_refs.declared} ⇒ 来自 TOOL_DEFS（注册即声明）`;
  } else if (c.evidence_refs.declared.startsWith('structure.domains.json')) {
    declared = read(root, 'structure.domains.json').includes('"capability"');
    notes.declared = `${c.evidence_refs.declared} ⇒ ${declared}`;
  } else {
    declared = read(root, c.evidence_refs.declared.split('#')[0] ?? '') !== '';
    notes.declared = `${c.evidence_refs.declared} ⇒ ${declared}`;
  }

  // 输入格：没有引用 ⇒ 视为"该能力不需要外部素材"（不是缺）；有引用 ⇒ 引用所指文件必须存在
  let input = true;
  if (c.evidence_refs.input) {
    const p = (c.evidence_refs.input.match(/[\w./-]+\.(jsonl|json|ts)/) ?? [])[0];
    input = p ? fs.existsSync(path.join(root, p)) : true;
    notes.input = `${c.evidence_refs.input} ⇒ ${input}`;
  } else {
    notes.input = '无外部素材引用（判据自带/类型自带）';
  }

  // 交接格：kind ⇒ 册里该 kind 的判据数；其它 ⇒ 无交接物（视为已接）
  let handoff = true;
  if (c.source === 'kind-registry') {
    const k = c.subject.replace('judgement-kind:', '');
    const n = countInSheets(root, `"kind": "${k}"`);
    handoff = n > 0;
    notes.handoff = `设计册里 kind=${k} 的判据 = ${n} 条`;
  } else {
    notes.handoff = '该来源不声明交接物（或无交接物概念）';
  }

  // 消费格
  let consumed = false;
  if (c.source === 'kind-registry') {
    const k = c.subject.replace('judgement-kind:', '');
    consumed = Boolean(byKind[k]);
    notes.consumer = `by_kind["${k}"] = ${consumed ? '有' : '无'}`;
  } else if (c.source === 'tool-registry') {
    consumed = true;
    notes.consumer = '注册在 MCP 工具面上（调用方 = agent）';
  } else if (c.subject.startsWith('file:')) {
    const rel = c.subject.slice('file:'.length);
    const n = importersOf(root, rel);
    consumed = n > 0;
    notes.consumer = `该文件的 importer 数 = ${n}`;
  } else if (c.subject.startsWith('domain:')) {
    const dir = domainDirOf(root).get(c.subject);
    if (!dir) {
      notes.consumer = '域表里找不到该域的 dir ⇒ 判不了（不猜）';
    } else {
      const n = importersOfDir(root, dir);
      const entry = entryTargetDirs(root).includes(dir);
      const scriptEntry = scriptEntryFor(root, c.subject.slice('domain:'.length));
      consumed = n > 0 || entry || scriptEntry;
      notes.consumer =
        `域外 import 了 ${dir}/ 的文件数 = ${n}` +
        (entry ? '；package.json 的 bin/scripts 指向该域（**进程外入口**）' : '') +
        (scriptEntry ? '；同名入口脚本 scripts/<域id>.mjs 存在且被 npm scripts 引用（**动态加载，静态看不见**）' : '');
    }
  } else {
    notes.consumer = '无消费者引用 ⇒ 判不了';
  }

  // 执行格：只有运行读数算（静态调用不算）
  let executed = false;
  if (c.source === 'kind-registry') {
    const k = c.subject.replace('judgement-kind:', '');
    executed = (byKind[k]?.checked ?? 0) > 0;
    notes.execution = `by_kind["${k}"].checked = ${byKind[k]?.checked ?? 0}`;
  } else {
    notes.execution = '无运行读数（本仓没有工具/域级 usage 遥测）';
  }

  return { declared, input_present: input, handoff_connected: handoff, consumed, executed, notes };
}

/**
 * ★ 2026-11-09（接线账：接上缺的那一格）：**域级消费者** = 域**外**有多少文件 import 了域内的模块。
 *
 * 改前的判据是 `countInSheets(root, ''"path": "<dir>")` —— 那数的是"该域在**设计册里**有没有节点"，
 * 是"被登记"，不是"被消费"；而且路径串拼自 `declared` 文本里的 `dir=`，拼不到就是空串
 * ⇒ 一律计 0 ⇒ 本仓 37 条域声明被误判成 `missing-consumer`（实测：`domain:meta-registry` 有
 * 4 个域外真实 importer，却被判"没有消费者"）。
 *
 * ★ 只数**域外**文件（域内互相 import 不构成"有人消费这个能力"），并排除本账自身。
 */
function importersOfDir(root: string, dirRel: string): number {
  const SELF = /analysis[\\/]health[\\/]wiring_(facts|ledger|claims|enumerate)\.ts$/;
  const dirPosix = dirRel.replace(/\\/g, '/').replace(/\/$/, '');
  /** 该 spec 解析后是否落在这个域里（相对 specifier 才判；裸包名不算本仓内消费） */
  const hits = (fileRel: string, spec: string): boolean => {
    if (!spec.startsWith('.')) return false;
    // ★ 构建产物路径也要认：`scripts/patrol.mjs` 里写的是 `../dist/src/application/patrol/x.js`
    const resolved = path.posix
      .normalize(path.posix.join(path.posix.dirname(fileRel), spec))
      .replace(/^dist\//, '');
    const noExt = resolved.replace(/\.(ts|tsx|mjs|cjs|js)$/, '');
    return noExt === dirPosix || noExt.startsWith(dirPosix + '/');
  };
  const SPEC = /(?:from|import)\s+[\x27"]([^\x27"]+)[\x27"]/g;
  let n = 0;
  // ★ 2026-11-09：`scripts/` 也是真实调用点（CLI/常驻入口都从那里拉起），不能只看 src+tests
  for (const d of ['src', 'tests', 'scripts']) {
    const stack: string[] = [path.join(root, d)];
    while (stack.length) {
      const dir = stack.pop() as string;
      let ents: fs.Dirent[] = [];
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of ents) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!/\.(ts|tsx|mjs|cjs|js)$/.test(e.name)) continue;
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        if (SELF.test(rel)) continue;
        // 域**内**文件互相 import 不算"有人消费这个能力"
        if (rel === dirPosix + '/' || rel.startsWith(dirPosix + '/')) continue;
        let txt = '';
        try {
          txt = fs.readFileSync(abs, 'utf-8');
        } catch {
          continue;
        }
        let spec: RegExpExecArray | null;
        SPEC.lastIndex = 0;
        let any = false;
        while ((spec = SPEC.exec(txt)) !== null) {
          if (hits(rel, spec[1])) {
            any = true;
            break;
          }
        }
        if (any) n += 1;
      }
    }
  }
  return n;
}
/** subject(`domain:<id>`) → 该域目录（直接读域表；不解析 `declared` 文本） */
function domainDirOf(root: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'structure.domains.json'), 'utf-8')) as {
      domains?: Array<{ id?: string; dir?: string }>;
    };
    for (const d of j.domains ?? []) {
      if (typeof d.id === 'string' && typeof d.dir === 'string') out.set('domain:' + d.id, d.dir.replace(/\\/g, '/'));
    }
  } catch {
    // 读不到域表 ⇒ 空表（consumer 那格会如实说"判不了"，不猜）
  }
  return out;
}
/**
 * ★ 2026-11-09（第二格）：**同名入口脚本** —— `package.json` 的 scripts 里有 `scripts/<域id>.mjs` 且该文件真的存在。
 *
 * 为什么需要它：`patrol` 的加载是**动态**的 —— `scripts/patrol.mjs` 里写着
 * `await import(pathToFileURL(path.join(root,'dist','src','application','patrol',…)))`
 * ⇒ 路径被拆成字符串片段，**静态 import 正则永远看不见**。
 * 静态看不见 ≠ 没有消费者：可核查的事实是「`npm run patrol` 指向 `scripts/patrol.mjs`，而那个文件存在」。
 * ★ 只认**同名**（脚本名 = 域 id）且文件真存在；不按名字相近去猜。
 */
function scriptEntryFor(root: string, domainId: string): boolean {
  let pkg: { scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as typeof pkg;
  } catch {
    return false;
  }
  const want = `scripts/${domainId}.mjs`;
  const referenced = Object.values(pkg.scripts ?? {}).some((v) => typeof v === 'string' && v.includes(want));
  return referenced && fs.existsSync(path.join(root, want));
}
/**
 * ★ 2026-11-09（接线账：接上缺的那一格）：**进程外入口** = `package.json` 的 `bin` / `scripts`
 * 里指向的构建产物路径（`dist/src/...` / `src/...`），归一成**仓库相对目录**。
 *
 * 为什么要这一格：`patrol` / `daemon-server` 这两族是**入口型能力** —— 它们的消费者是**进程外**
 * （`npm run patrol` / `npm run daemon`），域内没有、也不该有 `src/` 里的 importer。
 * 只看相对 import ⇒ 会把"有人启动它"判成"没人消费它"（实测：两条都属于这一类）。
 * ★ 只认**真的写在 package.json 里**的路径，不猜名字相近的目录。
 */
function entryTargetDirs(root: string): string[] {
  const out = new Set<string>();
  let pkg: { bin?: unknown; scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as typeof pkg;
  } catch {
    return [];
  }
  const vals: string[] = [];
  if (typeof pkg.bin === 'string') vals.push(pkg.bin);
  else if (pkg.bin && typeof pkg.bin === 'object') {
    for (const v of Object.values(pkg.bin as Record<string, unknown>)) if (typeof v === 'string') vals.push(v);
  }
  for (const v of Object.values(pkg.scripts ?? {})) if (typeof v === 'string') vals.push(v);
  const PATHY = /(?:^|\s)((?:dist\/)?(?:src\/[A-Za-z0-9_\-./]+|scripts\/[A-Za-z0-9_\-]+))\.(?:js|mjs|cjs|ts)/g;
  for (const v of vals) {
    let m: RegExpExecArray | null;
    PATHY.lastIndex = 0;
    while ((m = PATHY.exec(v)) !== null) {
      const rel = m[1].replace(/^dist\//, '');
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (dir) out.add(dir);
    }
  }
  return [...out];
}
/** 全量探针 = 原有四对象（精细探针）+ 自动枚举的其余声明（通用探针，按 subject 去重） */
export function collectAllWiringProbes(
  root: string,
  flaggedFiles: readonly string[] = [],
): { probes: WiringProbe[]; sources: SourceReport[] } {
  const base = collectWiringProbes(root);
  const { claims, sources } = enumerateClaims(root, flaggedFiles);
  const seen = new Set(base.map((p) => p.declaration.subject));
  const extra: WiringProbe[] = claims
    .filter((c) => !seen.has(c.subject))
    .map((c) => ({
      declaration: {
        subject: c.subject,
        claimed_capability: c.purpose,
        ...(c.kind === 'production' ? {} : { reserved: c.disposition ?? `${c.kind}（显式声明）` }),
      },
      probe: () => genericFacts(root, c),
    }));
  return { probes: [...base, ...extra], sources };
}
