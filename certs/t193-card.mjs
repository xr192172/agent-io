/**
 * T193 出生证：**"挂决策卡"这一步真跑**（用户澄清：他说的"角色卡"= **决策卡**，语音识别谐音）。
 *
 * ★ 用户原话：*"那是语音识别的问题……你多去想谐音。就是你想的那个决策卡，不是角色卡。"*
 *   ⇒ 已立成一条**方法**（用户级记忆 §8）：读不通的词先想谐音，别当新概念去设计。
 *
 * ## ★ 我上一轮为何判它"失败" —— **是我探针的错，不是仓库的**
 * 我写了 `type:'decision', op:'add'` —— 而 `decision` 的 ops **只有 `['update']`**，且 **`id` 必填**
 * （`id` = 文件/文档节点 id **或**仓库相对路径）。
 * ★ `op_data_spec.ts` 的 `note` 里逐个写明了每个字段的形状 —— ★ **"口径住一处"做对了的样子**。
 *
 * ## 顺序也是**量出来的**（★ A/B 对照）
 * · **只 `import_project`**（让它自己 fork 设计）⇒ `get_dsl` 读回「文件总数: 1」 ✓
 * · **先 create 再 import** ⇒ 读出**空** —— ★ 但那**不是缺陷**：回执逐字写着
 *   *"★ 本次**只刷新了"实际"**：设计 DSL 未被触碰 —— 这就是"**有设计就不动、只对比**""*
 *   （实现：`import_project.ts:1027` 的 `wantsDesign = !designExists`）。
 *   ★★ 而**我一开始只抓了回执第 3 行**就判它"假绿灯" ⇒ ★ **看全产物再下结论**（今天第三次同款）。
 *
 * ★ 2026-10-12 T194 更新：`manage_feature` **入参已扁平** ⇒ 本证同步用新形状（★ 老形状会被明确拒绝）。
 * ★ 隔离：临时 feature + 用**工具入口**清（`manage_feature action=delete`），不 `rm` 数据目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseDataBlock } from '../dist/src/application/plumbing.js';

const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t193-'));  /* ★ T224：草稿放 os.tmpdir() —— 宿主护栏对 temp 整体绕过（T223 实测），且 temp 在仓外 ⇒ 不受 .gitignore 影响（否则 import_project 会把这些文件过滤掉）*/
const FEATURE = 't193card';
const REASON = 'T193：量"挂决策卡"这一步能不能走通（临时 feature，含真文件）';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (tool, args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  // ★★★ T251：机器段解析只走唯一入口 `parseDataBlock`（原先这里自己 indexOf+slice+JSON.parse 一份）
  const data = parseDataBlock(out);
  return { err: out.includes('isError=true') || /MCP error/.test(out), text: out, data };
};

fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(path.join(EXT, 'src'), { recursive: true });
fs.writeFileSync(path.join(EXT, 'src/a.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
fs.writeFileSync(path.join(EXT, 'package.json'), JSON.stringify({ name: 't193ext', version: '1.0.0' }, null, 2));

try {
  // ★ 预清：让本证**可重复跑**（上一轮没删掉的 feature 会让下面撞"已存在"）。
  call('manage_feature', { action: 'delete', feature: FEATURE });

  console.log('══ ① 已有项目 ⇒ **直接 import**（★ 别先 create —— 顺序有讲究，见文件头 A/B）');
  const imp = call('import_project', { project_dir: EXT, feature: FEATURE });
  chk(!imp.err, '① 直接 `import_project` ⇒ 通', imp.text.split('\n')[0].slice(0, 110));
  chk(imp.text.includes('fork') || imp.text.includes('只刷新了'), '①-b ★ 回执**说清了它做了什么**（"只刷新实际" / "fork 一份设计"）');

  console.log('\n══ ② 找到可挂的节点');
  const files = call('get_dsl', { feature: FEATURE, query: 'files' });
  const firstPath = (files.text.match(/src\/a\.ts/) ?? [])[0];
  chk(!!firstPath, '② `get_dsl query=files` 里找到 `src/a.ts`', String(firstPath));

  console.log('\n══ ③ ★ 挂决策卡（本证的靶子）');
  const card = call('edit_dsl', {
    feature: FEATURE,
    agent: 't193',
    reason: REASON,
    operations: [
      {
        type: 'decision',
        op: 'update', // ★ 不是 `add`（`decision` 的 ops 只有 update）· ★ `id` 必填
        id: firstPath,
        data: {
          summary: '为什么把 add 放在 a.ts',
          rationale: 'T193：量"挂决策卡"能不能走通（★ 字段形状照 op_data_spec 的 note：字符串不是数组）',
          consequences: '后续改动这个文件时，对拍会带上这条决策的上下文',
          status: 'active',
          author: 'llm',
          tags: ['t193'],
        },
      },
    ],
  });
  chk(!card.err, '③ **挂决策卡 ⇒ 通**', card.text.split('\n')[0].slice(0, 130));

  console.log('\n══ ④ 读回来（★ 别只看回执）');
  const back = call('get_dsl', { feature: FEATURE, query: 'decisions' });
  chk(back.text.includes('为什么把 add 放在 a.ts'), '④ 卡**读得回来**（`get_dsl query=decisions`）', (back.text.split('\n').find((l) => l.includes('add 放在')) ?? '').slice(0, 120));
} finally {
  console.log('\n══ ⑤ 收尾：用**工具入口**删掉临时 feature（不 `rm` 数据目录）');
  const del = call('manage_feature', { action: 'delete', feature: FEATURE });
  chk(!del.err, '⑤ 临时 feature 已清', del.text.split('\n')[0].slice(0, 110));
  fs.rmSync(EXT, { recursive: true, force: true });
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
