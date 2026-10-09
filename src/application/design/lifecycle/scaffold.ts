/**
 * scaffold 工具实现（增强版）
 *
 * 从 DSL 的 semantic 层生成代码骨架。
 *
 * 新增能力：
 *   1. 多语言模板：go / ts / py / js / vue / react
 *   2. 可配置模板系统：通过 DSL semantic.scaffold.templates 自定义模板
 *   3. 从节点内容生成 UI 骨架：将 color_block/text/image 映射为 UI 组件
 *   4. 注释标记：生成 <!-- agent-io:node_id --> 锚点，支持 backfill 定位
 *   5. 模板占位符：{{package}}, {{imports}}, {{apis}}, {{behavior}}, {{node_id}}, {{node_label}}, {{ui_skeleton}}
 *
 * 工作原理：
 *   1. 读取已保存的 DSL
 *   2. 遍历 semantic.files，为每个文件生成骨架代码
 *   3. 根据文件扩展名推断语言（.go / .ts / .py / .js / .vue / .tsx）
 *   4. 生成内容：文件头注释 + API 签名（TODO body） + 依赖 import + 注释标记
 *   5. 如启用 generate_ui_skeleton，从对应节点的 content.blocks 生成 UI 骨架
 *   6. 额外生成 INVARIANTS.md 记录跨文件不变式
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DesignDSL, SemanticFile, CodeTemplate, Node, ContentBlock } from '../../../domain/types.js';
import { getDSL } from '../../../infrastructure/storage.js';
import { snapshotAndRecordSelfWrite, syncSelfWritesSync, toRelPosix } from '../../write_gate.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

export interface ScaffoldInput {
  /** feature 名 */
  feature: string;
  /** 输出根目录，默认 <cwd>/scaffold/<feature> */
  output_dir?: string;
  /** 是否覆盖已存在的文件，默认 false */
  overwrite?: boolean;
  /** UI 骨架类型（覆盖 DSL 配置） */
  ui_framework?: 'vue' | 'react' | 'html';
  /** 项目根（索引归属）：提供时生成物登记为自写（读路径优先同步索引）；缺省不登记 */
  project_dir?: string;
}

export interface ScaffoldResult {
  message: string;
  /** 生成落盘的文件路径表（★ 新名：旧 `files` 一名 6 义；路径表统一 `written_files`） */
  written_files: string[];
  dir: string;
}

// ─────────────────────────────────────────────────────────────
// 语言推断
// ─────────────────────────────────────────────────────────────

type Lang = 'go' | 'ts' | 'py' | 'js' | 'vue' | 'react' | 'unknown';

function detectLang(filePath: string): Lang {
  if (filePath.endsWith('.go')) return 'go';
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return filePath.endsWith('.tsx') ? 'react' : 'ts';
  if (filePath.endsWith('.py')) return 'py';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return filePath.endsWith('.jsx') ? 'react' : 'js';
  if (filePath.endsWith('.vue')) return 'vue';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────
// 注释标记
// ─────────────────────────────────────────────────────────────

function makeMarker(nodeId: string, label?: string): string {
  return `<!-- agent-io:${nodeId}${label ? ' ' + label : ''} -->`;
}

function makeMarkerComment(nodeId: string, lang: Lang, label?: string): string {
  const marker = makeMarker(nodeId, label);
  switch (lang) {
    case 'go':
    case 'ts':
    case 'js':
    case 'react':
      return `// ${marker}`;
    case 'py':
      return `# ${marker}`;
    case 'vue':
      return `<!-- agent-io:${nodeId}${label ? ' ' + label : ''} -->`;
    default:
      return `// ${marker}`;
  }
}

// ─────────────────────────────────────────────────────────────
// 从 API 签名中提取函数名
// ─────────────────────────────────────────────────────────────

function extractFuncName(signature: string): string {
  const match = signature.match(/(?:func\s+)?(\w+)\s*[\(\<]/);
  return match ? match[1] : signature.split(/\s*\(/)[0];
}

function goPackageName(filePath: string): string {
  const dir = path.dirname(filePath);
  const pkg = path.basename(dir);
  return pkg || 'main';
}

function goReturnStmt(ret: string): string {
  if (!ret) return '';
  const parts = ret.split(',').map(s => s.trim());
  const zeros = parts.map(p => {
    if (p.includes('error')) return 'nil';
    if (p.includes('string')) return '""';
    if (p.includes('bool')) return 'false';
    if (p.includes('int') || p.includes('float')) return '0';
    return 'nil';
  });
  return `\treturn ${zeros.join(', ')}  // TODO`;
}

// ─────────────────────────────────────────────────────────────
// 通用：按 receiver/class 分组方法
// ─────────────────────────────────────────────────────────────

function groupByClass(
  apis: { signature: string; notes?: string }[]
): { classes: Map<string, { name: string; args: string; ret: string; notes?: string }[]>; freeFns: { name: string; args: string; ret: string; notes?: string }[] } {
  const classes = new Map<string, { name: string; args: string; ret: string; notes?: string }[]>();
  const freeFns: { name: string; args: string; ret: string; notes?: string }[] = [];

  for (const api of apis) {
    const sig = api.signature.trim();
    const methodMatch = sig.match(/^(\w+)\.(\w+)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/);
    if (methodMatch) {
      const [, className, methodName, args, ret] = methodMatch;
      if (!classes.has(className)) classes.set(className, []);
      classes.get(className)!.push({ name: methodName, args, ret: ret || '', notes: api.notes });
    } else {
      const funcMatch = sig.match(/^(\w+)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/);
      if (funcMatch) {
        const [, funcName, args, ret] = funcMatch;
        freeFns.push({ name: funcName, args, ret: ret || '', notes: api.notes });
      }
    }
  }
  return { classes, freeFns };
}

// ─────────────────────────────────────────────────────────────
// UI 骨架生成：从 ContentBlock 树生成 UI 代码
// ─────────────────────────────────────────────────────────────

function generateUiSkeleton(blocks: ContentBlock[], framework: 'vue' | 'react' | 'html', indent: number = 2): string {
  const spaces = ' '.repeat(indent);
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.visible === false) continue;

    switch (block.type) {
      case 'text': {
        const tag = block.style?.bold ? 'strong' : 'span';
        const cls = block.style ? buildStyleClass(block.style) : '';
        lines.push(`${spaces}<${tag}${cls}>${escapeXml(block.value || '')}</${tag}>`);
        break;
      }
      case 'image': {
        const alt = escapeXml(block.value || '');
        lines.push(`${spaces}<img src="${block.src || ''}" alt="${alt}"${block.width ? ` width="${block.width}"` : ''}${block.height ? ` height="${block.height}"` : ''} />`);
        break;
      }
      case 'color_block': {
        const style = buildInlineStyle(block);
        const children = block.children && block.children.length > 0
          ? '\n' + generateUiSkeleton(block.children, framework, indent + 2) + '\n' + spaces
          : '';
        lines.push(`${spaces}<div${style}>${children}</div>`);
        break;
      }
      case 'spacer': {
        lines.push(`${spaces}<div style="height:${block.spacerHeight ?? 8}px"></div>`);
        break;
      }
    }
  }

  return lines.join('\n');
}

function buildStyleClass(style: { fontSize?: number; bold?: boolean; italic?: boolean; color?: string; align?: string }): string {
  const classes: string[] = [];
  if (style.bold) classes.push('font-bold');
  if (style.italic) classes.push('italic');
  if (classes.length === 0) return '';
  return ` class="${classes.join(' ') + (style.color ? ` text-[${style.color}]` : '')}"`;
}

function buildInlineStyle(block: ContentBlock): string {
  const styles: string[] = [];
  if (block.bg) styles.push(`background:${block.bg}`);
  if (block.width) styles.push(`width:${block.width}px`);
  if (block.height) styles.push(`height:${block.height}px`);
  if (block.border) styles.push(`border:${block.border}`);
  if (block.borderRadius) styles.push(`border-radius:${block.borderRadius}px`);
  if (block.padding) styles.push(`padding:${block.padding}px`);
  if (styles.length === 0) return '';
  return ` style="${styles.join('; ')}"`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * ★★★ 2026-10-09（T93）：摘要文本的取法 —— **先读节点 `title`，无 title 再回退语义层 `responsibility`**。
 *   · `geometry.ts:124`：「人话主标题：LLM 生成的职责摘要…**渲染端优先展示**，label 兜底」——这是写明的优先级，非兜底补丁。
 *   · `semantic.files` 现在**只放文件**（契约 `semantic.ts:67`）：聚合体摘要已移住节点 `title`，不再进语义层。
 */
function responsibilityOf(file: SemanticFile, node: Node | undefined): string {
  return node?.title?.trim() || file.responsibility;
}

// ─────────────────────────────────────────────────────────────
// 各语言骨架生成
// ─────────────────────────────────────────────────────────────

function generateGo(file: SemanticFile, node: Node | undefined, marker: string): string {
  const pkg = goPackageName(file.path);
  const lines: string[] = [];

  lines.push(`// Package ${pkg}`);
  lines.push(`// ${responsibilityOf(file, node)}`);
  lines.push(marker);
  lines.push(`package ${pkg}`);
  lines.push('');

  if (file.expected_deps && file.expected_deps.length > 0) {
    lines.push('import (');
    for (const dep of file.expected_deps) {
      lines.push(`\t// "${dep}"  // TODO: 调整为正确的 module path`);
    }
    lines.push(')');
    lines.push('');
  }

  if (file.expected_apis && file.expected_apis.length > 0) {
    const receiverMethods = new Map<string, { name: string; args: string; ret: string; notes?: string }[]>();
    const freeFunctions: { name: string; args: string; ret: string; notes?: string }[] = [];

    for (const api of file.expected_apis) {
      const sig = api.signature.trim();
      if (sig.includes('.')) {
        const [receiver, methodPart] = sig.split('.', 2);
        const methodMatch = methodPart.match(/^(\w+)\s*\(([^)]*)\)\s*(.*)$/);
        if (methodMatch) {
          const [, methodName, args, ret] = methodMatch;
          if (!receiverMethods.has(receiver)) receiverMethods.set(receiver, []);
          receiverMethods.get(receiver)!.push({ name: methodName, args, ret: ret || '', notes: api.notes });
        }
      } else {
        const funcMatch = sig.match(/^(\w+)\s*\(([^)]*)\)\s*(.*)$/);
        if (funcMatch) {
          const [, funcName, args, ret] = funcMatch;
          freeFunctions.push({ name: funcName, args, ret: ret || '', notes: api.notes });
        }
      }
    }

    for (const [receiver, methods] of receiverMethods) {
      lines.push(`type ${receiver} struct {`);
      lines.push(`\t// TODO: 定义 ${receiver} 字段`);
      lines.push('}');
      lines.push('');

      for (const m of methods) {
        if (m.notes) lines.push(`// ${m.notes}`);
        const retPart = m.ret ? ` ${m.ret}` : '';
        lines.push(`func (r *${receiver}) ${m.name}(${m.args})${retPart} {`);
        lines.push('\t// TODO: 实现');
        if (m.ret) lines.push(goReturnStmt(m.ret));
        lines.push('}');
        lines.push('');
      }
    }

    for (const f of freeFunctions) {
      if (f.notes) lines.push(`// ${f.notes}`);
      const retPart = f.ret ? ` ${f.ret}` : '';
      lines.push(`func ${f.name}(${f.args})${retPart} {`);
      lines.push('\t// TODO: 实现');
      if (f.ret) lines.push(goReturnStmt(f.ret));
      lines.push('}');
      lines.push('');
    }
  }

  if (file.expected_behavior) {
    lines.push(`// 行为约束：${file.expected_behavior}`);
  }

  return lines.join('\n');
}

function generateTs(file: SemanticFile, node: Node | undefined, marker: string): string {
  const lines: string[] = [];

  lines.push('/**');
  lines.push(` * ${responsibilityOf(file, node)}`);
  if (file.expected_behavior) {
    lines.push(` * 行为约束：${file.expected_behavior}`);
  }
  lines.push(' */');
  lines.push(marker);
  lines.push('');

  if (file.expected_deps && file.expected_deps.length > 0) {
    for (const dep of file.expected_deps) {
      const importName = path.basename(dep, path.extname(dep));
      lines.push(`import { ${importName} } from './${importName}';  // ${dep}`);
    }
    lines.push('');
  }

  if (file.expected_apis && file.expected_apis.length > 0) {
    const { classes, freeFns } = groupByClass(file.expected_apis);

    for (const [className, methods] of classes) {
      lines.push(`export class ${className} {`);
      for (const m of methods) {
        if (m.notes) lines.push(`  // ${m.notes}`);
        const retPart = m.ret ? `: ${m.ret}` : '';
        lines.push(`  ${m.name}(${m.args})${retPart} {`);
        lines.push('    // TODO: 实现');
        lines.push("    throw new Error('Not implemented');");
        lines.push('  }');
      }
      lines.push('}');
      lines.push('');
    }

    for (const f of freeFns) {
      if (f.notes) lines.push(`// ${f.notes}`);
      const retPart = f.ret ? `: ${f.ret}` : '';
      lines.push(`export function ${f.name}(${f.args})${retPart} {`);
      lines.push('  // TODO: 实现');
      lines.push("  throw new Error('Not implemented');");
      lines.push('}');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generatePy(file: SemanticFile, node: Node | undefined, marker: string): string {
  const lines: string[] = [];

  lines.push('"""');
  lines.push(responsibilityOf(file, node));
  if (file.expected_behavior) {
    lines.push(`行为约束：${file.expected_behavior}`);
  }
  lines.push('"""');
  lines.push(marker);
  lines.push('');

  if (file.expected_deps && file.expected_deps.length > 0) {
    for (const dep of file.expected_deps) {
      const importName = path.basename(dep, '.py');
      lines.push(`from .${importName} import *  # ${dep}`);
    }
    lines.push('');
  }

  if (file.expected_apis && file.expected_apis.length > 0) {
    const { classes, freeFns } = groupByClass(file.expected_apis);

    for (const [className, methods] of classes) {
      lines.push(`class ${className}:`);
      lines.push('    """TODO: 定义字段"""');
      lines.push('');
      for (const m of methods) {
        if (m.notes) lines.push(`    # ${m.notes}`);
        const retPart = m.ret ? ` -> ${m.ret}` : '';
        lines.push(`    def ${m.name}(self, ${m.args})${retPart}:`);
        lines.push('        # TODO: 实现');
        lines.push('        raise NotImplementedError');
        lines.push('');
      }
    }

    for (const f of freeFns) {
      if (f.notes) lines.push(`# ${f.notes}`);
      const retPart = f.ret ? ` -> ${f.ret}` : '';
      lines.push(`def ${f.name}(${f.args})${retPart}:`);
      lines.push('    # TODO: 实现');
      lines.push('    raise NotImplementedError');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateJs(file: SemanticFile, node: Node | undefined, marker: string): string {
  const lines: string[] = [];

  lines.push('/**');
  lines.push(` * ${responsibilityOf(file, node)}`);
  if (file.expected_behavior) {
    lines.push(` * 行为约束：${file.expected_behavior}`);
  }
  lines.push(' */');
  lines.push(marker);
  lines.push('');

  if (file.expected_deps && file.expected_deps.length > 0) {
    for (const dep of file.expected_deps) {
      const importName = path.basename(dep, path.extname(dep));
      lines.push(`const ${importName} = require('./${importName}');  // ${dep}`);
    }
    lines.push('');
  }

  if (file.expected_apis && file.expected_apis.length > 0) {
    const { classes, freeFns } = groupByClass(file.expected_apis);

    for (const [className, methods] of classes) {
      lines.push(`class ${className} {`);
      for (const m of methods) {
        if (m.notes) lines.push(`  // ${m.notes}`);
        lines.push(`  ${m.name}(${m.args}) {`);
        lines.push('    // TODO: 实现');
        lines.push("    throw new Error('Not implemented');");
        lines.push('  }');
      }
      lines.push('}');
      lines.push('');
    }

    for (const f of freeFns) {
      if (f.notes) lines.push(`// ${f.notes}`);
      lines.push(`function ${f.name}(${f.args}) {`);
      lines.push('  // TODO: 实现');
      lines.push("  throw new Error('Not implemented');");
      lines.push('}');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Vue 模板生成
// ─────────────────────────────────────────────────────────────

function generateVue(file: SemanticFile, node: Node | undefined, marker: string): string {
  const lines: string[] = [];

  lines.push(`<!--`);
  lines.push(`  ${responsibilityOf(file, node)}`);
  if (file.expected_behavior) {
    lines.push(`  行为约束：${file.expected_behavior}`);
  }
  lines.push(`-->`);
  lines.push(marker);
  lines.push('');

  lines.push('<template>');

  // UI 骨架
  if (node?.content?.blocks && node.content.blocks.length > 0) {
    lines.push(generateUiSkeleton(node.content.blocks, 'vue', 2));
  } else {
    lines.push('  <div class="container">');
    lines.push('    <!-- TODO: 实现 UI -->');
    lines.push('  </div>');
  }

  lines.push('</template>');
  lines.push('');

  lines.push('<script setup>');
  if (file.expected_deps && file.expected_deps.length > 0) {
    for (const dep of file.expected_deps) {
      const importName = path.basename(dep, path.extname(dep));
      lines.push(`import { ${importName} } from './${importName}';  // ${dep}`);
    }
    lines.push('');
  }

  // 从 API 签名生成方法
  if (file.expected_apis && file.expected_apis.length > 0) {
    for (const api of file.expected_apis) {
      const name = extractFuncName(api.signature);
      lines.push(`// ${api.signature}`);
      if (api.notes) lines.push(`// ${api.notes}`);
      lines.push(`async function ${name}() {`);
      lines.push('  // TODO: 实现');
      lines.push('}');
      lines.push('');
    }
  }
  lines.push('</script>');
  lines.push('');

  lines.push('<style scoped>');
  lines.push('/* TODO: 添加样式 */');
  lines.push('</style>');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// React 模板生成
// ─────────────────────────────────────────────────────────────

function generateReact(file: SemanticFile, node: Node | undefined, marker: string): string {
  const lines: string[] = [];
  const componentName = path.basename(file.path, path.extname(file.path));
  const componentNamePascal = componentName.charAt(0).toUpperCase() + componentName.slice(1);

  lines.push('/**');
  lines.push(` * ${responsibilityOf(file, node)}`);
  if (file.expected_behavior) {
    lines.push(` * 行为约束：${file.expected_behavior}`);
  }
  lines.push(' */');
  lines.push(marker);
  lines.push('');

  if (file.expected_deps && file.expected_deps.length > 0) {
    for (const dep of file.expected_deps) {
      const importName = path.basename(dep, path.extname(dep));
      lines.push(`import { ${importName} } from './${importName}';  // ${dep}`);
    }
    lines.push('');
  }

  lines.push(`export default function ${componentNamePascal}() {`);
  lines.push('  // TODO: 添加 state 和 hooks');
  lines.push('');

  // 从 API 签名生成方法
  if (file.expected_apis && file.expected_apis.length > 0) {
    for (const api of file.expected_apis) {
      const name = extractFuncName(api.signature);
      lines.push(`  // ${api.signature}`);
      if (api.notes) lines.push(`  // ${api.notes}`);
      lines.push(`  const ${name} = async () => {`);
      lines.push('    // TODO: 实现');
      lines.push('  };');
      lines.push('');
    }
  }

  lines.push('  return (');

  // UI 骨架
  if (node?.content?.blocks && node.content.blocks.length > 0) {
    const ui = generateUiSkeleton(node.content.blocks, 'react', 4);
    lines.push(ui);
  } else {
    lines.push('    <div className="container">');
    lines.push('      {/* TODO: 实现 UI */}');
    lines.push('    </div>');
  }

  lines.push('  );');
  lines.push('}');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// HTML 模板生成（纯 UI 骨架）
// ─────────────────────────────────────────────────────────────

function generateHtml(file: SemanticFile, node: Node | undefined, marker: string): string {
  const lines: string[] = [];

  lines.push(`<!-- ${responsibilityOf(file, node)} -->`);
  lines.push(marker);
  lines.push('');

  if (node?.content?.blocks && node.content.blocks.length > 0) {
    lines.push(generateUiSkeleton(node.content.blocks, 'html', 0));
  } else {
    lines.push('<div class="container">');
    lines.push('  <!-- TODO: 实现 UI -->');
    lines.push('</div>');
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// 自定义模板渲染
// ─────────────────────────────────────────────────────────────

function renderCustomTemplate(
  template: CodeTemplate,
  file: SemanticFile,
  node: Node | undefined,
  marker: string
): string {
  let content = template.template;

  const pkg = goPackageName(file.path);
  content = content.replace(/\{\{package\}\}/g, pkg);
  content = content.replace(/\{\{node_id\}\}/g, file.id);
  content = content.replace(/\{\{node_label\}\}/g, node?.label || file.id);
  content = content.replace(/\{\{marker\}\}/g, marker);

  // imports
  let imports = '';
  if (file.expected_deps && file.expected_deps.length > 0) {
    imports = file.expected_deps.map(d => `// import from "${d}"`).join('\n');
  }
  content = content.replace(/\{\{imports\}\}/g, imports);

  // behavior
  const behavior = file.expected_behavior || '';
  content = content.replace(/\{\{behavior\}\}/g, behavior);

  // apis
  let apis = '';
  if (file.expected_apis && file.expected_apis.length > 0) {
    apis = file.expected_apis.map(a => `// ${a.signature}${a.notes ? ' - ' + a.notes : ''}`).join('\n');
  }
  content = content.replace(/\{\{apis\}\}/g, apis);

  // ui_skeleton
  let uiSkeleton = '';
  if (node?.content?.blocks && node.content.blocks.length > 0) {
    const fw = template.lang === 'vue' ? 'vue' : template.lang === 'react' ? 'react' : 'html';
    uiSkeleton = generateUiSkeleton(node.content.blocks, fw, 2);
  }
  content = content.replace(/\{\{ui_skeleton\}\}/g, uiSkeleton);

  return content;
}

// ─────────────────────────────────────────────────────────────
// 生成不变式文件
// ─────────────────────────────────────────────────────────────

function generateInvariants(dsl: DesignDSL): string {
  const lines: string[] = [];
  lines.push(`# ${dsl.feature} - 不变式与约束`);
  lines.push('');

  if (dsl.semantic?.multi_file_invariants && dsl.semantic.multi_file_invariants.length > 0) {
    lines.push('## 跨文件不变式');
    lines.push('');
    for (const inv of dsl.semantic.multi_file_invariants) {
      lines.push(`- ${inv}`);
    }
    lines.push('');
  }

  if (dsl.semantic?.expected_global_behavior && dsl.semantic.expected_global_behavior.length > 0) {
    lines.push('## 全局行为约束');
    lines.push('');
    for (const b of dsl.semantic.expected_global_behavior) {
      lines.push(`- ${b}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────────────────────

function scaffoldCore(input: ScaffoldInput): ScaffoldResult {
  const { feature, output_dir, overwrite, ui_framework: inputUiFramework } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在，请先使用 create_feature 或 render_design 创建`);
  }

  if (!dsl.semantic || !dsl.semantic.files || dsl.semantic.files.length === 0) {
    throw new Error(`feature "${feature}" 没有 semantic.files，无法生成代码骨架`);
  }

  const scaffoldConfig = dsl.semantic.scaffold;
  const useMarkers = scaffoldConfig?.markers !== false;
  const generateUi = scaffoldConfig?.generate_ui_skeleton || false;
  const uiFramework = inputUiFramework || scaffoldConfig?.ui_framework || 'html';

  const outDir = output_dir
    ? path.resolve(output_dir)
    : path.join(process.cwd(), 'scaffold', feature);

  // 写闸收编（L1b）：本工具是同步签名 ⇒ **写前**快照 + 自写登记（不做写穿——syncFile
  // 是异步的，同步调用者 await 不了），读路径（ensureFreshIndex）会优先消费这份清单
  // 把生成的新文件同步进索引。登记的是"计划写入集"（含最终被跳过的：消费方按内容
  // hash 判定，未变的同步是 no-op，无害）；生成物在项目根外 / 该项目还没有索引
  // ⇒ 各自安静跳过（纪律：绝不凭空建索引）。
  const plannedFiles = dsl.semantic.files.map((f) => path.join(outDir, f.path));
  const invariantsPath = path.join(outDir, 'INVARIANTS.md');
  plannedFiles.push(invariantsPath);
  let indexNote: string | null = null;
  // ⑤ 同步写穿（2026-09-15）：inRoot 提到写循环外 —— 写完所有文件后要用同一批路径做同步写穿尝试
  const inRoot = input.project_dir ? plannedFiles.filter((f) => toRelPosix(input.project_dir!, f)) : [];
  if (input.project_dir) {
    try {
      if (inRoot.length === 0) {
        indexNote = '索引：未登记 —— 生成物在项目根之外';
      } else {
        const gate = snapshotAndRecordSelfWrite(input.project_dir, inRoot, { label: `scaffold:${feature}` });
        indexNote = gate.mode === 'deferred'
          ? `索引：已登记 ${inRoot.length} 个文件进自写清单（读路径优先同步）`
          : '索引：未登记 —— 该项目还没有索引（只真写，不建索引）';
      }
    } catch (e) {
      indexNote = `⚠️ 索引登记失败（不影响生成结果）：${(e as Error).message}`;
    }
  }

  const generatedFiles: string[] = [];

  // 为每个 semantic file 生成骨架
  for (const file of dsl.semantic.files) {
    const lang = detectLang(file.path);
    const node = dsl.geometry.nodes.find(n => n.id === file.id);
    const label = node?.label || file.id;
    const marker = useMarkers ? makeMarkerComment(file.id, lang, label) : '';

    // 检查是否有自定义模板匹配
    let content: string;
    const customTemplate = scaffoldConfig?.templates?.find(
      t => t.lang === lang || (t.ext && file.path.endsWith(t.ext))
    );

    if (customTemplate) {
      content = renderCustomTemplate(customTemplate, file, node, marker);
    } else {
      switch (lang) {
        case 'go':
          content = generateGo(file, node, marker);
          break;
        case 'ts':
          content = generateTs(file, node, marker);
          break;
        case 'py':
          content = generatePy(file, node, marker);
          break;
        case 'js':
          content = generateJs(file, node, marker);
          break;
        case 'vue':
          content = generateVue(file, node, marker);
          break;
        case 'react':
          content = generateReact(file, node, marker);
          break;
        default:
          if (generateUi && node?.content?.blocks) {
            content = generateHtml(file, node, marker);
          } else {
            content = [
              `// ${responsibilityOf(file, node)}`,
              marker,
              '// TODO: 以下 API 待实现：',
              ...(file.expected_apis || []).map(a => `//   - ${a.signature}`),
              ...(file.expected_behavior ? [`// 行为约束：${file.expected_behavior}`] : []),
            ].join('\n');
          }
      }
    }

    const fullPath = path.join(outDir, file.path);

    // 检查是否覆盖
    if (fs.existsSync(fullPath) && !overwrite) {
      generatedFiles.push(`${fullPath} (跳过，已存在)`);
      continue;
    }

    // 确保目录存在
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    generatedFiles.push(fullPath);
  }

  // 生成不变式文件（路径已在写闸登记段算好）
  fs.writeFileSync(invariantsPath, generateInvariants(dsl), 'utf-8');
  generatedFiles.push(invariantsPath);

  // ⑤ 同步写穿（2026-09-15）：所有文件落盘后尝试直连 L1a。解析器已预热（进程启动
  //    prewarmKernel）⇒ 当场同步进索引，indexNote 升级为"同步写穿"；未预热 ⇒ 预热闸
  //    整批落回 L1b（写前的登记仍在，幂等无害），indexNote 保持"已登记"。
  if (input.project_dir && inRoot.length > 0) {
    try {
      const idxSync = syncSelfWritesSync(input.project_dir, inRoot);
      if (idxSync?.mode === 'synced') {
        indexNote = idxSync.error
          ? `索引：写穿部分失败（写前登记已兜底）：${idxSync.error}`
          : `索引：同步写穿 ${idxSync.synced ?? 0} 个文件进索引（重开引用 ${idxSync.refsReopened ?? 0} 条，${idxSync.ms ?? 0}ms）`;
      }
    } catch {
      /* 同步写穿异常：保持写前登记的 indexNote（L1b → L3 读路径兜底） */
    }
  }

  const message = [
    `已为 feature "${feature}" 生成 ${generatedFiles.length} 个文件`,
    `输出目录：${outDir}`,
    useMarkers ? '已生成注释标记（<!-- agent-io:node_id -->）' : '未生成注释标记',
    ...(indexNote ? [indexNote] : []),
    generateUi ? `UI 骨架：${uiFramework}` : '',
    '',
    '生成的文件：',
    ...generatedFiles.map((f, i) => `  ${i + 1}. ${f}`),
    '',
    '每个文件包含：',
    '  - 文件头注释（职责描述）',
    '  - API 签名（函数/方法，body 为 TODO）',
    '  - 依赖 import（注释形式）',
    '  - 行为约束注释',
    useMarkers ? '  - 注释标记（用于 backfill 定位）' : '',
    generateUi ? '  - UI 骨架（从节点 content.blocks 生成）' : '',
    '',
    'INVARIANTS.md 记录了跨文件不变式和全局行为约束。',
  ].join('\n');

  return { message, written_files: generatedFiles, dir: outDir };
}

/** ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去 */
function touchedOf(input: ScaffoldInput, r: ScaffoldResult): Touched {
  const touched: Touched = {};
  // 作用域类（⇒ 随时可给）：feature 必填入参；
  //   project_dir 只认入参 project_dir（= 索引归属的项目根）—— ★ **不拿 output_dir 冒充**
  //   （output_dir 是产物输出目录，可能就是 `<cwd>/scaffold/<feature>`，不是被分析的项目根）。
  touched.feature = input.feature;
  if (input.project_dir) touched.project_dir = path.resolve(input.project_dir);
  // 对象类 written_files：**只列真落盘的**（r.written_files 里带 "(跳过，已存在)" 的项未写 ⇒ 剔除）。
  //   契约要求**仓库相对路径** ⇒ 以 project_dir 为基换算（复用本文件已用的 toRelPosix）。★ 没给
  //   project_dir 时省略整个字段——不把绝对路径塞进"仓库相对"槽位（那是换口径，不是更弱的答案）。
  if (input.project_dir) {
    const written = new Set<string>();
    for (const f of r.written_files) {
      if (f.endsWith(' (跳过，已存在)')) continue;
      const rel = toRelPosix(input.project_dir, f);
      if (rel) written.add(rel);
    }
    if (written.size > 0) touched.written_files = [...written];
  }
  return touched;
}

export function scaffold(input: ScaffoldInput): TouchedProduct<ScaffoldResult> {
  const r = scaffoldCore(input);
  return withTouched(r, touchedOf(input, r));
}
