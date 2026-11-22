/**
 * 块标记方案（§4.3 / M13 / M4）。
 *
 * 块标记：
 * ```
 * <!-- DOC:GEN:<block-id>:BEGIN source=<adapter>@<rev> cmd="…" format=<ver> generator=<renderer@version> body_sha256=<sha16> -->
 * <body>
 * <!-- DOC:GEN:<block-id>:END body_sha256=<sha16> -->
 * ```
 * · 块外手写散文逐字保留；缺 BEGIN/END ⇒ `missing`。
 * · 指纹沿用 sha16（sha256 截前 16），威胁模型 = 防意外漂移/手改，**不防恶意碰撞**（M4）。
 * · 生成字节不渗本机态/时区；日期 UTC。
 */
import { createHash } from 'node:crypto';

export const FORMAT_VERSION = 'docs-view-v1';
export const MARKER_PREFIX = 'DOC:GEN:';

export function sha16Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function beginLine(blockId: string): string {
  return `${MARKER_PREFIX}${blockId}:BEGIN`;
}
function endLine(blockId: string): string {
  return `${MARKER_PREFIX}${blockId}:END`;
}

export interface ParsedHeader {
  blockId: string;
  source: string;
  rev: string;
  cmd: string;
  format: string;
  generator: string;
  bodySha16: string;
}

const BEGIN_RE = /<!--\s*DOC:GEN:([A-Za-z0-9._-]+):BEGIN\s+(.*?)\s*-->/;
const END_RE = /<!--\s*DOC:GEN:([A-Za-z0-9._-]+):END\s+(.*?)\s*-->/;

function parseAttrs(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)=("([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    out[m[1]] = m[3] ?? m[4] ?? '';
  }
  return out;
}

export function parseBegin(line: string): ParsedHeader | null {
  const m = BEGIN_RE.exec(line);
  if (!m) return null;
  const attrs = parseAttrs(m[2]);
  const [source, rev] = (attrs.source ?? '').split('@');
  return {
    blockId: m[1],
    source: source ?? '',
    rev: rev ?? '',
    cmd: attrs.cmd ?? '',
    format: attrs.format ?? '',
    generator: attrs.generator ?? '',
    bodySha16: attrs.body_sha256 ?? '',
  };
}

export function parseEnd(line: string): { blockId: string; bodySha16: string } | null {
  const m = END_RE.exec(line);
  if (!m) return null;
  return { blockId: m[1], bodySha16: parseAttrs(m[2]).body_sha256 ?? '' };
}

export function buildHeader(opts: {
  blockId: string;
  source: string;
  rev: string;
  cmd: string;
  generator: string;
  bodySha16: string;
}): string {
  return `<!-- ${beginLine(opts.blockId)} source=${opts.source}@${opts.rev} cmd="${opts.cmd}" format=${FORMAT_VERSION} generator=${opts.generator} body_sha256=${opts.bodySha16} -->`;
}

export function buildFooter(blockId: string, bodySha16: string): string {
  return `<!-- ${endLine(blockId)} body_sha256=${bodySha16} -->`;
}

export interface ExtractedBlock {
  beginLine: string;
  header: ParsedHeader;
  body: string;
  endLine: string;
  endSha16: string;
}

/** 从盘上文档抽取指定块；标记缺失/错配 ⇒ null（由对账态落 missing） */
export function extractBlock(docText: string, blockId: string): ExtractedBlock | null {
  const lines = docText.split(/\r?\n/);
  let beginIdx = -1;
  let header: ParsedHeader | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const h = parseBegin(lines[i]);
    if (h && h.blockId === blockId) {
      beginIdx = i;
      header = h;
      break;
    }
  }
  if (beginIdx < 0 || !header) return null;
  let endIdx = -1;
  for (let i = beginIdx + 1; i < lines.length; i += 1) {
    const e = parseEnd(lines[i]);
    if (e && e.blockId === blockId) {
      endIdx = i;
      break;
    }
    if (parseBegin(lines[i])) return null; // 嵌套/错配
  }
  if (endIdx < 0) return null;
  const body = lines.slice(beginIdx + 1, endIdx).join('\n');
  const endLine = lines[endIdx];
  const endSha16 = parseEnd(endLine)?.bodySha16 ?? '';
  return { beginLine: lines[beginIdx], header, body, endLine, endSha16 };
}
