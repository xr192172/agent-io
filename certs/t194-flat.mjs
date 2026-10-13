/**
 * T194 出生证：**`manage_feature` 入参扁平化** —— 并**给老形状一句迁移提示**（不静默丢值）。
 *
 * ## 判据（★ 三个方向都自证）
 * ① **新形状（扁）⇒ 五个 action 全通**：create / clone / template / list / delete
 * ② ★★ **老形状（`{action, args:{…}}`）⇒ 抛，且报错说清"提到顶层来"**
 *   —— ★ 不许"静默忽略 `args`"（那会让调用方以为传了、工具说没传）
 * ③ ★ **缺必填 ⇒ 报错点名键**（`requireStr` 的判据，一处）+ **形状错就抛**（`optionalStr`）
 *
 * ★ 隔离：临时 feature + `manage_feature action=delete` 收尾（★ 不 `rm` 数据目录）。
 */
import { execFileSync } from 'node:child_process';

const FEATURE = 't194flat';
let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', 'manage_feature', JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  return { err: out.includes('isError=true') || /MCP error/.test(out), text: out };
};
const head = (s) => s.split('\n')[0].slice(0, 150);

// ★ 预清：让本证**可重复跑**（★ 上一轮留下的 `t194flat` 会让 ①-a 撞"已存在" ⇒ 我为此吃过一次假红）。
for (const f of [FEATURE, FEATURE + 'x', FEATURE + 't', FEATURE + 'legacy']) call({ action: 'delete', feature: f });

console.log('══ ① 新形状（扁）：五个 action 全通');
const c = call({ action: 'create', feature: FEATURE, title: 'T194 扁平化验证' });
chk(!c.err, '①-a `{action:"create", feature:…, title:…}` ⇒ 通（★ 参数与 action 平级）', head(c.text));
const l1 = call({ action: 'list' });
chk(!l1.err && l1.text.includes(FEATURE), '①-b `{action:"list"}` ⇒ 通（且列出刚建的）', head(l1.text));
const cl = call({ action: 'clone', source_feature: FEATURE, target_feature: FEATURE + 'x' });
chk(!cl.err, '①-c `{action:"clone", source_feature, target_feature}` ⇒ 通', head(cl.text));
const tm = call({ action: 'template', template_id: '__nope__', feature: FEATURE + 't' });
console.log(`     [template 读数] ${head(tm.text)}`); // 模板 id 不存在 ⇒ 应拒；只作观察
const d1 = call({ action: 'delete', feature: FEATURE + 'x' });
chk(!d1.err, '①-d `{action:"delete", feature}` ⇒ 通', head(d1.text));

console.log('\n══ ② ★★ 老形状（`args` 子对象）⇒ 抛，且**说清怎么改**');
const legacy = call({ action: 'create', args: { feature: FEATURE + 'legacy' } });
chk(legacy.err, '②-a 老形状 ⇒ **拒**（★ 不静默忽略 —— 否则调用方以为传了）', head(legacy.text));
chk(legacy.text.includes('已改为扁平') && legacy.text.includes('提到顶层'), '②-b ★ 报错**说清新形状 + 怎么改**', head(legacy.text).slice(0, 130));
chk(!call({ action: 'delete', feature: FEATURE + 'legacy' }).err, '②-c （顺带证明它**没被建出来**）');

console.log('\n══ ③ 缺必填 / 形状错：点名 + 抛（判据在 plumbing 一处）');
const miss = call({ action: 'delete' });
chk(miss.err && /缺参数|missing|Invalid/.test(miss.text), '③-a `delete` 不给 feature ⇒ 拒', head(miss.text).slice(0, 120));
const badShape = call({ action: 'create', feature: 123 });
console.log(`     [形状错读数] ${head(badShape.text).slice(0, 120)}`);
chk(badShape.err, '③-b `feature:123`（数字）⇒ 拒（★ 不再静默当没给）');

console.log('\n══ ④ 收尾：用工具入口清掉（含 clone 出来的那个）');
for (const f of [FEATURE, FEATURE + 'x', FEATURE + 't', FEATURE + 'legacy']) call({ action: 'delete', feature: f });
const after = call({ action: 'list' });
chk(!after.text.includes(FEATURE), '④ 临时 feature 已清干净', head(after.text));

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
