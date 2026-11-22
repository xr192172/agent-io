/**
 * 取数侧注入标注（企划 §5.2 / §5.3 · 批 2）。
 *
 * 投影是人读缓冲层，**不是取数权威**：注入提示词前先把文档切成「人写段 / 投影块」，
 * 投影块附对账状态与 rev；非绿块正文剔除、不得引用其中数字与结论（转内部视图现取）。
 *
 * 状态口径（与批 1 七态一致，M1 降级非绿）：
 * · `current`：可作辅助缓冲；
 * · `degraded-current`：可作辅助，但必须带「没验引擎」明示；
 * · `stale` / `hand-edited` / `missing` / `unjudgeable` / `render-failed`：**非绿**，正文剔除 + 告警；
 * · 块未注册对账适配器（注入侧查不到 check 记录）⇒ `unregistered`（= 未对账，非绿，不冒充 current）。
 *
 * 本模块是纯函数：只切分与标注，不读盘、不跑对账；check 地图由调用方用 `checkDocBlocks` 现算后传入。
 */
import { parseBegin, parseEnd, type ParsedHeader } from './markers.js';
import type { BlockCheck, ReconState } from './types.js';

/** 可作辅助缓冲的绿/降级态（degraded-current 非绿但允许带警示保留，M1） */
const AUX_OK_STATES: ReadonlySet<ReconState> = new Set(['current', 'degraded-current']);

/** 注入侧未注册适配器的块状态（区别于对账七态：根本没进对账） */
export type InjectState = ReconState | 'unregistered';

export interface DocSegment {
  kind: 'prose' | 'block';
  blockId?: string;
  header?: ParsedHeader;
  /** 块正文；BEGIN 缺 END 时为 null（落 missing） */
  body?: string | null;
  /** 原始段文本（prose 逐字；block = 头 + 正文 + 尾） */
  text: string;
}

/** 标注后的块读数（注入回执 / 测试断言用） */
export interface AnnotatedBlock {
  blockId: string;
  state: InjectState;
  rev: string;
  /** 正文是否保留进注入提示词（非绿 ⇒ false） */
  retained: boolean;
  reasons: string[];
}

/** 把一篇 markdown 切成人写段 / 投影块（标记缺失/错配 ⇒ 块段 body=null，落 missing） */
export function segmentDoc(docText: string): DocSegment[] {
  const lines = docText.split(/\r?\n/);
  const segments: DocSegment[] = [];
  let prose: string[] = [];
  let i = 0;
  const flushProse = () => {
    if (prose.length > 0) {
      segments.push({ kind: 'prose', text: prose.join('\n') });
      prose = [];
    }
  };
  while (i < lines.length) {
    const header = parseBegin(lines[i]);
    if (!header) {
      prose.push(lines[i]);
      i += 1;
      continue;
    }
    flushProse();
    let endIdx = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const end = parseEnd(lines[j]);
      if (end && end.blockId === header.blockId) {
        endIdx = j;
        break;
      }
      if (parseBegin(lines[j])) break; // 嵌套/错配：当前块无合法尾
    }
    if (endIdx < 0) {
      segments.push({
        kind: 'block',
        blockId: header.blockId,
        header,
        body: null,
        text: lines.slice(i).join('\n'),
      });
      i = lines.length;
      break;
    }
    segments.push({
      kind: 'block',
      blockId: header.blockId,
      header,
      body: lines.slice(i + 1, endIdx).join('\n'),
      text: lines.slice(i, endIdx + 1).join('\n'),
    });
    i = endIdx + 1;
  }
  flushProse();
  return segments;
}

function blockAnnotation(seg: DocSegment, check: BlockCheck | undefined): { state: InjectState; rev: string; reasons: string[]; retained: boolean } {
  if (!check) {
    return { state: 'unregistered', rev: seg.header?.rev ?? '', reasons: ['无注册对账适配器（未对账，非绿）'], retained: false };
  }
  const retained = AUX_OK_STATES.has(check.state);
  return { state: check.state, rev: check.rev, reasons: check.reasons, retained };
}

function renderBlockSegment(seg: DocSegment, ann: AnnotatedBlock): string {
  const source = seg.header?.source ?? '?';
  const head = `[投影块 \`${ann.blockId}\` · source=${source}@${ann.rev || '（空）'} · 状态=${ann.state}]`;
  if (!ann.retained) {
    const why = ann.reasons.length > 0 ? `：${ann.reasons.join('；')}` : '';
    return `${head}\n⚠ 该块非绿（${ann.state}），正文已剔除；**不得引用其中数字与结论**，请转内部视图现取${why}。`;
  }
  const degradedNote = ann.state === 'degraded-current' ? '（★ 降级未验引擎，读数仅作辅助）' : '';
  const body = seg.body ?? '';
  return `${head}${degradedNote}\n${body}`;
}

export interface AnnotatedDoc {
  /** 注入提示词用的标注后正文 */
  text: string;
  blocks: AnnotatedBlock[];
}

/**
 * 标注一篇文档：人写段逐字保留并分区说明；投影块附状态/rev，非绿剔除正文。
 * @param docText 文档原文
 * @param checks  blockId → 对账读数（`checkDocBlocks` 现算结果；缺省空地图 ⇒ 全部块未对账）
 */
export function annotateDocForInjection(docText: string, checks: Map<string, BlockCheck> = new Map()): AnnotatedDoc {
  const segments = segmentDoc(docText);
  const blocks: AnnotatedBlock[] = [];
  const out: string[] = [];
  let prosePending = false;
  for (const seg of segments) {
    if (seg.kind === 'prose') {
      if (seg.text.trim()) {
        if (!prosePending) {
          out.push('## 人写段（非投影；权威以内部视图为准，不据此下结论）');
          prosePending = true;
        }
        out.push(seg.text);
      }
      continue;
    }
    const check = seg.blockId ? checks.get(seg.blockId) : undefined;
    const ann: AnnotatedBlock = {
      blockId: seg.blockId ?? '(unknown)',
      ...blockAnnotation(seg, check),
    };
    blocks.push(ann);
    out.push(renderBlockSegment(seg, ann));
  }
  return { text: out.join('\n\n'), blocks };
}
