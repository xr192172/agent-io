/**
 * data_uniqueness.ts —— **同项目、同数据只留一份**（判据 + 处理），watch 兼任这个守卫。
 *
 * ## 为什么要有它（用户 2026-10-27 口径）
 * 「watch 虽然是增量的，但也要保证同项目同数据独一性」。
 * 增量正是"第二份"的温床：换 feature 时旧 `live/` 留在数据仓、把子目录误当项目根时冒出
 * `<pkg>/src/application/.agent-io`、迁移期数据仓里还躺着同名的 `design/` `tasks.db`……
 * 而**同一份数据两处落点**是本仓的头号病（T-#98 的病史），所以必须有**一处**专门盯它。
 *
 * ## 判据（三条，别合并）
 *   ① **canonical** = `rootsOf(projectRoot)[role].path`（唯一解析器，不在这里再拼路径）；
 *   ② **能删的只有"可证明冗余"的派生数据**：
 *        · 与 canonical **逐字节相同** ⇒ 冗余（删）；
 *        · 位于 stray `.agent-io` 里且**内容全是派生角色** ⇒ 可重建（删）；
 *      **意图数据**（design / tasks / history）**永不自动删**，只报告；
 *   ③ 默认 **dry-run**（`apply:true` 才删），每一条都带 `action` 与 `reason`，方便人复核。
 *
 * ## 谁在调它
 * `watch_project_tool` 的 `doWork`（节流：首次 + 每 10 分钟一次）—— 增量跑着跑着就顺手把
 * "第二份"清掉/报出来。也允许手动调（`certs/t374` 就是这么验的）。
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DATA_DIR_NAME } from './data_dir.js';
import { findStrayDataDirs, rootsOf, type RootRole } from './roots.js';
import { getStorageRoot } from './storage.js';

/** 一条发现 */
export interface UniquenessFinding {
  kind: 'duplicate_of_canonical' | 'stray_data_dir' | 'duplicate_in_data_root';
  /** 绝对路径（stray 目录是相对项目根的 posix 路径，便于人看） */
  path: string;
  role?: RootRole;
  /** 与 canonical 是否逐字节相同（目录 = 文件集合 + 每个文件哈希） */
  identical: boolean;
  action: 'deleted' | 'reported' | 'skipped_intent';
  reason: string;
}

export interface UniquenessReport {
  project_root: string;
  findings: UniquenessFinding[];
  deleted: number;
  reported: number;
  applied: boolean;
}

/** 与 `roots.ts#ROLE_SUBDIR` 同名的常量，只为在 stray 里认角色（避免 import 内部表） */
const ROLE_SUBDIR_OF = { design: 'design', tasks: 'tasks.db' } as const;

/** 意图角色：可以报，**永远不自动删** */
const INTENT_ROLES: ReadonlySet<RootRole> = new Set<RootRole>(['design', 'tasks', 'history']);

/** 目录/文件的"内容指纹"：目录 = 相对路径 + 文件哈希的有序串；文件 = 自身哈希 */
function fingerprint(target: string): string | null {
  try {
    const st = fs.statSync(target);
    if (st.isFile()) return `f:${st.size}:${fs.readFileSync(target).toString('base64').length}:${hashOf(target)}`;
    const parts: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) parts.push(`${path.relative(target, p).replace(/\\/g, '/')}:${hashOf(p)}`);
      }
    };
    walk(target);
    return `d:${parts.join('|')}`;
  } catch {
    return null;
  }
}

function hashOf(file: string): string {
  // ★ sha256（与 storage 的 contentHash 同一种哈希）
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 检查/修正一个项目的"数据独一性"。
 * @param apply true 才真删（默认 dry-run）
 */
export function ensureProjectDataUniqueness(
  projectRoot: string,
  opts: { apply?: boolean; maxDepth?: number } = {},
): UniquenessReport {
  const apply = opts.apply === true;
  const root = path.resolve(projectRoot);
  const specs = rootsOf(root);
  const findings: UniquenessFinding[] = [];

  // ── ① 数据仓里还躺着同名角色（迁移期最常见的"第二份"）───────────
  const dataRoot = getStorageRoot();
  for (const role of Object.keys(specs) as RootRole[]) {
    const spec = specs[role];
    const name = path.basename(spec.path);
    const twin = path.join(dataRoot, name);
    if (path.resolve(twin) === path.resolve(spec.path)) continue; // 本仓自己就是数据仓（同路径）⇒ 不是重复
    if (!fs.existsSync(twin)) continue;
    if (!fs.existsSync(spec.path)) {
      findings.push({
        kind: 'duplicate_in_data_root',
        path: twin,
        role,
        identical: false,
        action: 'reported',
        reason: `数据仓里有一份 ${role}（canonical 还没有）—— 先由调用方决定要不要搬，不猜`,
      });
      continue;
    }
    const same = fingerprint(twin) === fingerprint(spec.path);
    if (INTENT_ROLES.has(role)) {
      findings.push({
        kind: 'duplicate_in_data_root',
        path: twin,
        role,
        identical: same,
        action: 'skipped_intent',
        reason: `${role} 是**意图数据** ⇒ 永不自动删（人工确认后再清）`,
      });
      continue;
    }
    if (!same) {
      findings.push({
        kind: 'duplicate_in_data_root',
        path: twin,
        role,
        identical: false,
        action: 'reported',
        reason: `数据仓那份与 canonical **不一致** ⇒ 不删（可能是旧代数据，要人看一眼）`,
      });
      continue;
    }
    if (apply) {
      fs.rmSync(twin, { recursive: true, force: true });
      findings.push({ kind: 'duplicate_in_data_root', path: twin, role, identical: true, action: 'deleted', reason: '与 canonical 逐字节相同 ⇒ 冗余，已删' });
    } else {
      findings.push({ kind: 'duplicate_in_data_root', path: twin, role, identical: true, action: 'reported', reason: '与 canonical 逐字节相同 ⇒ 可删（dry-run）' });
    }
  }

  // ── ② 项目内多出来的 `.agent-io`（stray：把子目录误当项目根）──────
  for (const rel of findStrayDataDirs(root, opts.maxDepth ?? 4)) {
    const abs = path.join(root, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true }).map((e) => e.name);
    const intentInside = entries.filter(
      (n) => n === ROLE_SUBDIR_OF.design || n === ROLE_SUBDIR_OF.tasks || n.startsWith('task-history'),
    );
    if (intentInside.length) {
      findings.push({
        kind: 'stray_data_dir',
        path: rel,
        identical: false,
        action: 'skipped_intent',
        reason: `里面有意图数据（${intentInside.join(' / ')}）⇒ 永不自动删，只报告`,
      });
      continue;
    }
    if (apply) {
      fs.rmSync(abs, { recursive: true, force: true });
      findings.push({ kind: 'stray_data_dir', path: rel, identical: false, action: 'deleted', reason: '内容全是派生角色 ⇒ 可重建，已删' });
    } else {
      findings.push({ kind: 'stray_data_dir', path: rel, identical: false, action: 'reported', reason: '内容全是派生角色 ⇒ 可重建（dry-run）' });
    }
  }

  return {
    project_root: root,
    findings,
    deleted: findings.filter((f) => f.action === 'deleted').length,
    reported: findings.filter((f) => f.action !== 'deleted').length,
    applied: apply,
  };
}


/** 一行摘要（watch 的 alert / 回执用） */
export function renderUniquenessLine(r: UniquenessReport): string {
  if (!r.findings.length) return `数据独一性：✓ 无第二份（${r.project_root}）`;
  const del = r.findings.filter((f) => f.action === 'deleted').length;
  const rep = r.findings.filter((f) => f.action !== 'deleted').length;
  const head = r.findings
    .slice(0, 3)
    .map((f) => `${f.path}（${f.action}）`)
    .join(' · ');
  return `数据独一性：发现 ${r.findings.length} 处第二份（删 ${del} · 待看 ${rep}）—— ${head}${r.findings.length > 3 ? ' …' : ''}`;
}
