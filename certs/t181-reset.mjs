/**
 * T181 出生证的「还原」步骤 —— ★ 它本身也是一条判据（"我的量具能不能回到已知状态"）。
 *
 * ★★ 为什么要写成脚本（而不是 `cp` 备份）—— 教训三次，每次都是我：
 *   ① 用 `d1` 的 `src/a.ts`：**文件不存在** ⇒ 每条都在 T20 facts 层先红，**没走到被测代码**。
 *   ② 只在用例间还原 `features/<f>.json`：上一例的 `deprecated`+`retire_reason` 被
 *      **合并写**继承 ⇒ "缺 retire_reason"那例**假绿**。
 *   ③ ★ `getDSL` **优先读活态文件**（`getLiveDslFile()`），而 `dataHome` 默认 = **仓库根**
 *      ⇒ 活态文件是 `<repo>/agent-io.json`，**不在 `.agent-io/` 下**！
 *      ⇒ 我 restore 了 `features/` 却**没 restore 它** ⇒ 垃圾一直在，**每条都因同一个原因红**。
 *      ★ 这一条最贵：表面"全红"看着像严格，其实**全都在测同一个被污染的状态**。
 *
 * ⇒ 判据：**一个 feature 的状态住在哪几个文件里？还原要把它们【全】列出来。**
 *   实测三个：`<repo>/agent-io.json`（活态，getDSL 优先）·
 *            `.agent-io/features/<f>.json`（存档）· `.agent-io/features/<f>.overlay.json`（意图）
 *
 * 做法：**外科式**只删目标文件条目上的 `lifecycle` 键 —— 不整file覆盖，
 *   免得把不属于本次实验的其它改动一起回退掉。
 */
import fs from 'node:fs';

const FEATURE = 'run82';
const FILE_ID = 'file_dogfood_build_cache_mjs';

const targets = [
  'agent-io.json', // ★ 活态（getDSL 优先读它；dataHome 默认 = 仓库根）
  `.agent-io/features/${FEATURE}.json`, // 存档
];

let changed = 0;
for (const p of targets) {
  if (!fs.existsSync(p)) {
    console.log(`  · ${p} 不存在（跳过）`);
    continue;
  }
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const f = (d.semantic?.files ?? []).find((x) => x.id === FILE_ID);
  if (!f) {
    console.log(`  · ${p} 里没有 ${FILE_ID}（跳过）`);
    continue;
  }
  if (f.lifecycle === undefined) {
    console.log(`  · ${p} 已是干净（无 lifecycle）`);
    continue;
  }
  delete f.lifecycle;
  fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
  console.log(`  · ${p} 已清除 lifecycle`);
  changed++;
}

// ★★★ overlay（第三层）：T182 之前它**不**存 lifecycle；T182 之后它**存**
//   ⇒ ★ 教训又一次重演：**"状态住在哪几层"会随代码变** —— 还原脚本必须跟着改。
//   （第一次我漏了活态文件；这次差点漏了 overlay。）
const op = `.agent-io/features/${FEATURE}.overlay.json`;
if (fs.existsSync(op)) {
  const o = JSON.parse(fs.readFileSync(op, 'utf8'));
  const a = o.anchors?.[FILE_ID];
  if (!a?.lifecycle) {
    console.log(`  · ${op} 已是干净（锚点无 lifecycle）`);
  } else {
    delete a.lifecycle;
    // 纪律同 `hasAnchorPayload`：只删 lifecycle 后若只剩 path/kind ⇒ 这个锚点就是空壳，prune 掉
    const rest = Object.keys(a).filter((k) => !['path', 'kind'].includes(k));
    if (rest.length === 0) delete o.anchors[FILE_ID];
    fs.writeFileSync(op, JSON.stringify(o, null, 2), 'utf8');
    console.log(`  · ${op} 已清除锚点 lifecycle${rest.length === 0 ? '（并 prune 掉空锚点）' : ''}`);
    changed++;
  }
}
console.log(`  ⇒ 还原完成（改动 ${changed} 个文件）`);
