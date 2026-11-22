#!/usr/bin/env node
/**
 * gen_docs_view.mjs —— 文档投影块生成 / 对账（`npm run doc:render` / `npm run doc:check`）。
 *
 * ★ 本文件**不排版**：只做四件事 —— 调 application 纯函数、写盘、打印读数、给退出码；
 *   渲染逻辑只住 `src/application/docs_view/`，本文件不拼视图行。
 * 退出码三态：`0` 最新 / `3` 陈旧或缺失（去跑 render）/ `1` 判定或生成本身坏了（含自洽失败、降级未验）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ADAPTERS } from '../src/application/docs_view/registry.ts';
import { renderDocBlocks } from '../src/application/docs_view/render_doc_blocks.ts';
import { checkDocBlocks } from '../src/application/docs_view/check_doc_blocks.ts';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const wantCheck = argv.includes('--check');

function replaceOrInsert(docText, blockText, blockId) {
  const lines = docText.split(/\r?\n/);
  const beginRe = new RegExp(`^<!--\\s*DOC:GEN:${blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:BEGIN\\b`);
  const endRe = new RegExp(`^<!--\\s*DOC:GEN:${blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:END\\b`);
  let beginIdx = lines.findIndex((l) => beginRe.test(l));
  if (beginIdx < 0) {
    // 块不存在：追加到文末（块外手写散文逐字保留）
    const prefix = docText.trimEnd() ? `${docText.trimEnd()}\n\n` : '';
    return `${prefix}${blockText}\n`;
  }
  let endIdx = -1;
  for (let i = beginIdx + 1; i < lines.length; i += 1) {
    if (endRe.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    // 标记错配：不吞旧内容，响亮失败（由 check 判 missing/hand-edited）
    throw new Error(`块 \`${blockId}\` 缺 END 标记，拒绝覆盖写入`);
  }
  const next = [...lines.slice(0, beginIdx), ...blockText.split(/\r?\n/), ...lines.slice(endIdx + 1)];
  return `${next.join('\n').trimEnd()}\n`;
}

if (wantCheck) {
  const r = checkDocBlocks(ROOT, { adapters: ADAPTERS });
  const tag = {
    current: '✓ 最新',
    'degraded-current': '✓ 最新（降级：读端未验 · 非绿）',
    stale: '✗ 已过期',
    missing: '✗ 缺失',
    'hand-edited': '✗ 手改生成区',
    unjudgeable: '✗ 判不了',
    'render-failed': '✗ 渲染/自洽失败',
  };
  for (const b of r.blocks) {
    console.log(`  ${tag[b.state] ?? b.state} ${b.blockId}（state=${b.state} · exit=${b.exitCode}）`);
    for (const why of b.reasons) console.log(`       ${why}`);
  }
  console.log(`  —— 文档投影：${r.blocks.filter((b) => b.exitCode === 0).length}/${r.blocks.length} 最新（exit=${r.exitCode}）`);
  process.exit(r.exitCode);
}

const blocks = renderDocBlocks(ROOT, { adapters: ADAPTERS });
const byDoc = new Map();
for (const b of blocks) {
  const list = byDoc.get(b.docRel) ?? [];
  list.push(b);
  byDoc.set(b.docRel, list);
}
for (const [docRel, docBlocks] of byDoc) {
  const file = path.join(ROOT, docRel);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  let text = before;
  for (const b of docBlocks) text = replaceOrInsert(text, b.blockText, b.blockId);
  fs.writeFileSync(file, text, 'utf8');
  console.log(`✓ 已写入 ${docRel}：${docBlocks.map((b) => b.blockId).join(', ')}`);
}
process.exit(0);
