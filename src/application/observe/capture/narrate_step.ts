/**
 * narrate_step —— 叙事砖（吸收 manim "声明式分镜叙事" 设计，落地到「单条产线工序」）
 *
 * 从一个吃进什么 / 吐出什么的生产工序，生成一段人有节奏可看懂的叙事分镜：
 *   「进料口 → 工序 → 出料口」，三段式，数据形态（input/output 针脚）由契约投影
 *   （actual_apis[0] 签名 → projectSignature）产生，是代码事实、非 LLM 编造。
 *
 * 使用自有 MCP 抽取、登记为「砖」：
 *   - DSL semantic 落一条 brick_narr_* 条目 → 思维导图「🧱 已验证积木」区自动出卡
 *     ★ 2026-10-05：原先还写一份**盒内** manifest.json（BrickManifest）；积木盒族已删
 *       ⇒ 那份产物**无消费者**，已停写（同一次还删掉了它的目录创建）。
 *
 * 忠实纪律：分镜的 facts 逐条引用真实针脚与签名；人话只做名词翻译，不发明类型/流程。
 */

import path from 'node:path';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
import { projectSignature } from '../../meta/view/derive_mind_map.js';
import { buildScenes, humanOf } from '../../../domain/narration.js';
import type { NarrScene } from '../../../domain/narration.js';
import type { TeachPin } from '../../../domain/mindmap.js';
import type { SemanticFile } from '../../../domain/types.js';

export interface NarrateStepInput {
  /** feature 名 */
  feature: string;
  /** 工序涉及文件（相对路径，语义层锚点）；从 actual_apis[0] 契约投影取针脚 */
  file: string;
  /** 工序名（缺省取该文件 responsibility） */
  title?: string;
  /** 工序人话（缺省取该文件 responsibility） */
  detail?: string;
  /** false 只预演不落盘（不写砖不登记，默认 true） */
  write?: boolean;
}

export interface NarrateStepResult {
  feature: string;
  file: string;
  title: string;
  /** 数据形态（== 代码事实：契约投影自签名） */
  pins: { inputs: TeachPin[]; outputs: TeachPin[] };
  /** 叙事分镜序列（manim 式：连续过渡，只推进一件事） */
  scenes: NarrScene[];
  mode: 'rule' | 'llm';
  /** 登记的叙事砖（write=true 时有） */
  brick?: {
    id: string;
    name: string;
    message: string;
  };
  message: string;
}

/** 取语义层文件（精确 path 优先，退化路径末端匹配），供契约投影 */
function resolveSemanticFile(dsl: { semantic?: { files?: SemanticFile[] } }, file: string): SemanticFile | undefined {
  const files = dsl.semantic?.files ?? [];
  return files.find((f) => f.path === file)
    ?? files.find((f) => (f.path ?? '').endsWith('/' + file) || (f.path ?? '').endsWith('/' + path.basename(file)));
}

/** 契约投影：工序文件的**事实签名** → 输入/输出针脚（★ T20：事实现取 cache.db，不再读 DSL 镜像） */
function factsig(root: string | undefined, sf: SemanticFile | undefined, feature: string): string | undefined {
  if (!root || !sf?.path) return undefined;
  return fileFacts(root, sf.path, feature).apis[0]?.signature ?? undefined;
}
function projectPins(sf: SemanticFile | undefined, sig?: string): { inputs: TeachPin[]; outputs: TeachPin[] } {
  if (!sf) return { inputs: [], outputs: [] };
  const use = sig ?? sf.expected_apis?.[0]?.signature;
  if (!use) return { inputs: [], outputs: [] };
  const shape = projectSignature(use);
  return shape ? { inputs: shape.ins, outputs: shape.outs } : { inputs: [], outputs: [] };
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'step';

export function narrateStep(input: NarrateStepInput): NarrateStepResult {
  const { feature, file } = input;
  const write = input.write !== false;
  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在`);

  const sf = resolveSemanticFile(dsl, file);
  const factSig = factsig(dsl.source_root, sf, feature);
  const pins = projectPins(sf, factSig);
  const responsibility = sf?.responsibility ?? '（该文件无可读职责）';
  const title = input.title || responsibility.split('（')[0] || path.basename(file);
  const detail = input.detail || responsibility;

  // ── 叙事分镜（manim 式：进料口→工序→出料口，facts 引真实契约投影数据）──
  const scenes: NarrScene[] = buildScenes(pins, title, detail, factSig ?? sf?.expected_apis?.[0]?.signature);

  // 钉死保证 + 显式宣告编造红线
  let message = `叙事砖已生成（${pins.inputs.length} 入 / ${pins.outputs.length} 出，模式=rule，数据形态=契约投影）`;
  let brick: NarrateStepResult['brick'];

  if (write) {
    // ★ 2026-10-05：**不再写 `<storage>/bricks/<name>/manifest.json`**。
    //   积木盒那一族（search / assemble / slim / reconcile）已删 ⇒ 那个盒内产物
    //   **已无任何消费者工具**，写了只会造一堆没人读的文件（且每次调用都建目录）。
    //   叙事砖**真正的消费口**是下面这条 DSL 条目（导图「🧱 已验证积木」区出卡）。
    const brickName = `${feature}-narr-${slug(file)}`;

    // ── 登记：DSL semantic 落 brick_narr_* 条目 → 导图「🧱 已验证积木」区出卡 ──
    const bid = `brick_narr_${slug(file)}`;
    dsl.semantic = dsl.semantic ?? { files: [] };
    const existed = dsl.semantic.files.some((f) => f.id === bid);
    if (!existed) {
      dsl.semantic.files.push({
        id: bid,
        path: `${title}-叙事`,
        responsibility: `${title}：把「${file}」讲成人话的叙事砖（积木黑盒：分镜 ${scenes.length} 镜）`,
        expected_apis: scenes.map((s) => ({ name: s.title, signature: `叙述「${s.title}」` })),
        status: 'done',
        layer: 'feature',
      });
      saveDSL(dsl, 'mcp');
    }
    brick = { id: bid, name: brickName, message: `DSL 条目 ${bid}（导图「🧱 已验证积木」区出卡）` };
    message += `，并已登记为叙事砖（${bid}），进思维导图积木区（${existed ? '已存在，复用' : '新增'}）`;
  }

  return { feature, file, title, pins, scenes, mode: 'rule', brick, message };
}