/**
 * 三向对账（§4.4 · M1 · M12）：引擎现算 vs 盘上 vs git HEAD。
 *
 * 七态：current / stale / hand-edited / missing / unjudgeable / render-failed / degraded-current。
 * 退出码：`0` 最新 / `3` 陈旧或缺失 / `1` 判定或生成本身坏了（含自洽失败、降级未验）。
 * ★ 聚合门不得把 exit 0 当通过：degraded-current / 未验一律非绿单列（M1）。
 * check 恒全量现算，不读缓存结论。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractBlock, sha16Hex } from './markers.js';
import { renderBlock } from './render_doc_blocks.js';
import type { BlockCheck, DocBlockAdapter, DocsCheckResult, ReconState, RenderedBlock } from './types.js';

function gitShowHead(root: string, rel: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null; // 不在 git 里 / 新文件 —— 按"分不清"处理，不冒充 HEAD 一致
  }
}

function exitFor(state: ReconState): 0 | 1 | 3 {
  switch (state) {
    case 'current':
      return 0;
    case 'stale':
    case 'missing':
      return 3;
    default:
      return 1;
  }
}

function checkOne(adapter: DocBlockAdapter, root: string): BlockCheck {
  const fresh: RenderedBlock = renderBlock(adapter, root);
  const reasons: string[] = [];
  const docPath = path.join(root, adapter.docRel);

  if (!fs.existsSync(docPath)) {
    return { blockId: adapter.id, docRel: adapter.docRel, state: 'missing', rev: fresh.source.rev, reasons: ['目标文档不存在'], exitCode: 3 };
  }
  const disk = fs.readFileSync(docPath, 'utf8');
  const extracted = extractBlock(disk, adapter.id);
  if (!extracted) {
    return { blockId: adapter.id, docRel: adapter.docRel, state: 'missing', rev: fresh.source.rev, reasons: ['缺 BEGIN/END 标记或块错配'], exitCode: 3 };
  }

  // ★ 可用性闸先于自洽断言（终局序）：源不可用时读数本身不成立，占位正文不参与计数/标签校验，
  //   不应落 render-failed；后续规范源适配器同样适用此序。engineAbsent ⇒ degraded-current（降级未验，非绿）；
  //   其余读不到 ⇒ unjudgeable。
  if (!fresh.source.availability.readable) {
    const state: ReconState = fresh.source.availability.engineAbsent ? 'degraded-current' : 'unjudgeable';
    return {
      blockId: adapter.id,
      docRel: adapter.docRel,
      state,
      rev: fresh.source.rev,
      reasons: [fresh.source.availability.reason ?? '读端不可用'],
      exitCode: 1,
    };
  }

  // 源可用后再跑自洽断言；失败 ⇒ 生成本身坏了（与 stale/hand-edited 同列非绿，M12）
  if (!fresh.selfCheck.ok) {
    return {
      blockId: adapter.id,
      docRel: adapter.docRel,
      state: 'render-failed',
      rev: fresh.source.rev,
      reasons: fresh.selfCheck.violations,
      exitCode: 1,
    };
  }

  // 权威前进未重生成：rev 不一致 ⇒ stale
  if (extracted.header.rev !== fresh.source.rev) {
    reasons.push(`rev 不一致：盘上 ${extracted.header.rev || '（空）'} ≠ 现算 ${fresh.source.rev}`);
    return { blockId: adapter.id, docRel: adapter.docRel, state: 'stale', rev: fresh.source.rev, reasons, exitCode: 3 };
  }

  // 生成区被手改：正文指纹 ≠ 块头记录指纹 ⇒ hand-edited
  const diskBodySha = sha16Hex(extracted.body);
  if (diskBodySha !== extracted.header.bodySha16) {
    reasons.push(`正文指纹不符：盘上 ${diskBodySha} ≠ 块头记录 ${extracted.header.bodySha16} ⇒ 生成区被手改`);
    return { blockId: adapter.id, docRel: adapter.docRel, state: 'hand-edited', rev: fresh.source.rev, reasons, exitCode: 1 };
  }
  if (extracted.endSha16 && extracted.endSha16 !== extracted.header.bodySha16) {
    reasons.push(`END 标记指纹与 BEGIN 记录不符 ⇒ 标记被手改`);
    return { blockId: adapter.id, docRel: adapter.docRel, state: 'hand-edited', rev: fresh.source.rev, reasons, exitCode: 1 };
  }

  // 正文与现算不一致（rev 同但内容漂）⇒ stale
  if (extracted.body !== fresh.body) {
    reasons.push('正文与引擎现算不一致（rev 同但内容漂移）⇒ 需重生成');
    return { blockId: adapter.id, docRel: adapter.docRel, state: 'stale', rev: fresh.source.rev, reasons, exitCode: 3 };
  }

  // 第三向：git HEAD（O3 预期行为：HEAD 旁证只记 reason、不改态；HEAD 无此块不判。
  //   新块首次提交前 HEAD 侧为空属正常；提交后三向 active，旁证才参与比对）
  const headText = gitShowHead(root, adapter.docRel);
  const headBlock = headText ? extractBlock(headText, adapter.id) : null;
  if (headBlock && headBlock.body !== fresh.body) {
    reasons.push('git HEAD 仍旧版（旁证：权威前进未提交重生成）');
  }
  return { blockId: adapter.id, docRel: adapter.docRel, state: 'current', rev: fresh.source.rev, reasons, exitCode: 0 };
}

export interface CheckOptions {
  adapters?: readonly DocBlockAdapter[];
}

export function checkDocBlocks(root: string, opts: CheckOptions = {}): DocsCheckResult {
  const adapters = opts.adapters ?? [];
  const blocks = adapters.map((a) => checkOne(a, root));
  const worst = blocks.reduce<0 | 1 | 3>((acc, b) => (b.exitCode > acc ? b.exitCode : acc), 0);
  const degraded = blocks.filter((b) => b.state === 'degraded-current');
  return {
    blocks,
    exitCode: worst,
    green: worst === 0 && degraded.length === 0,
    degraded,
  };
}
