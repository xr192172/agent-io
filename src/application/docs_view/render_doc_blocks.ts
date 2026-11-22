/**
 * 渲染纯函数（§4.1 / §4.5 / M12 / M13）。
 *
 * · 纯函数：不渗本机态/时区；日期 UTC；同输入两次渲染逐字节相同。
 * · 自洽断言走独立注册表实体现算（不与生成函数同体重算）：
 *   渲染计数 == 源集合长度；每个条目 id 出现在正文；标签 ∈ 源闭集。
 * · 读端不可用 ⇒ 不固化空快照冒充可用；块核对账层落 unjudgeable / degraded-current（非绿）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildHeader, buildFooter, sha16Hex, FORMAT_VERSION } from './markers.js';
import type {
  AdapterSource,
  DocBlockAdapter,
  RenderedBlock,
  SelfCheckResult,
} from './types.js';

function readPackageVersion(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 通用自洽断言：计数 == 源集合长度；条目 id 在场；标签 ∈ 闭集。适配器可覆盖。 */
export function defaultSelfCheck(source: AdapterSource, body: string): SelfCheckResult {
  const violations: string[] = [];
  const dataRows = body
    .split(/\r?\n/)
    .filter((l) => l.trimStart().startsWith('|'))
    .slice(2); // 表头 + 分隔行
  const renderedCount = dataRows.length;
  const sourceCount = source.items.length;
  if (renderedCount !== sourceCount) {
    violations.push(`渲染行数 ${renderedCount} ≠ 源集合长度 ${sourceCount}`);
  }
  for (const item of source.items) {
    if (!body.includes(item.id)) violations.push(`条目 \`${item.id}\` 未出现在渲染正文`);
    for (const [key, raw] of Object.entries(item.labels)) {
      const allowed = source.labelSets[key];
      if (!allowed) continue;
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        if (!allowed.includes(v)) violations.push(`标签 ${key}=${String(v)} 不在闭集 [${allowed.join(', ')}]`);
      }
    }
  }
  return { ok: violations.length === 0, violations, renderedCount, sourceCount };
}

export function renderBlock(adapter: DocBlockAdapter, root: string): RenderedBlock {
  const source = adapter.read(root);
  const body = source.availability.readable
    ? adapter.render(source)
    : `（读端不可用：${source.availability.reason ?? '未知原因'}）`;
  const selfCheck = adapter.selfCheck ? adapter.selfCheck(source, body) : defaultSelfCheck(source, body);
  const bodySha16 = sha16Hex(body);
  const version = readPackageVersion(root);
  const header = buildHeader({
    blockId: adapter.id,
    source: adapter.id,
    rev: source.rev,
    cmd: 'npm run doc:render',
    generator: `docs-view.render@${version}`,
    bodySha16,
  });
  const footer = buildFooter(adapter.id, bodySha16);
  return {
    blockId: adapter.id,
    docRel: adapter.docRel,
    header,
    body,
    footer,
    blockText: `${header}\n${body}\n${footer}`,
    source,
    selfCheck,
  };
}

export interface RenderOptions {
  adapters?: DocBlockAdapter[];
}

/** 渲染全部注册适配器（纯函数；不写盘） */
export function renderDocBlocks(root: string, opts: RenderOptions = {}): RenderedBlock[] {
  const adapters = opts.adapters ?? [];
  return adapters.map((a) => renderBlock(a, root));
}

export { FORMAT_VERSION };
