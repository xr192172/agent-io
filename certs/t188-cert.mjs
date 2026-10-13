/**
 * T188 出生证：**我把这道门的检测力要回来了吗**？
 *
 * ## 判据（`gate-authoring` §2 消融自证）
 * 逐个撤掉修复 ⇒ 对应断言**必须变红**。这里要证的"修复"是**扫描改成直调 handler**：
 *   · **撤掉 handler 的守卫**（消融） ⇒ ★ **新扫描必须变红**；
 *   · ★★ **同一时刻**，旧路（走 CLI ⇒ `invokeTool` ⇒ zod）**必须仍然绿** ——
 *     那个**反差**就是"旧版为什么瞎"的实证（它测的是 zod，不是守卫）。
 *
 * ## 消融怎么做的（★ 纪律：**绝不碰 `src/`**）
 * `gate-authoring` §2：消融**只允许改 gitignore 的产物**。
 * ⇒ 这里改的是 **`dist/src/application/plumbing.js`**（编译产物，`npm run build` 可再生）。
 *   把 `requireStr` 从"抛错"改成"返回空串" ⇒ 所有靠它守门的 handler **一起失去守卫**。
 *   ★ 用**一处**改动覆盖**全体**：这样才能同时观察"新扫描红 / 旧路绿"的反差。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUMBING = 'dist/src/application/plumbing.js';
const PROBE_TOOL = 'go_originals'; // 一个只靠 requireStr 守门的小工具

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 跑新扫描（直调 handler）⇒ 返回坏签名数 */
const newScanBad = () => {
  try {
    execFileSync('node', ['scripts/mcp/mcp_scan.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (e) {
    const m = String(e.stdout ?? '').match(/✗ 坏签名 = (\d+)/);
    return m ? Number(m[1]) : -1; // -1 = 连汇总都没打出来（那本身也是异常）
  }
};
/** 走旧路：CLI（经 invokeTool ⇒ zod）⇒ 拿回执首行 */
const cliProbe = () => {
  try {
    return execFileSync('node', ['dist/src/presentation/cli/cli.js', PROBE_TOOL, '--json', '{}'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\n')[0].trim();
  } catch (e) {
    return String((e.stdout ?? '') + (e.stderr ?? '')).split('\n')[0].trim();
  }
};

console.log('════ ① 基线（未消融）：两条路都应当正常');
const bad0 = newScanBad();
chk(bad0 === 0, '新扫描（直调 handler）无坏签名', `坏签名=${bad0}`);
const cli0 = cliProbe();
// ★ 断言写成"**是人话**（不命中 Node 原始异常）" —— ★ 第一版我按"缺参数"匹配 ⇒ **假红**：
//   实际回的是 **`入参未通过 schema 校验`**，而那句**恰好是更硬的证据**（拦下 `{}` 的是 zod）。
chk(!/Cannot read|paths\[0\]|The "path"|reading 'map'/.test(cli0), '旧路（CLI/zod）也是人话', cli0.slice(0, 90));
chk(cli0.includes('schema 校验'), '★ 且它**自报**是被 zod 拦下的（正是"它测的不是守卫"的铁证）', cli0.slice(0, 90));

console.log('\n════ ② 消融：把 `requireStr` 从"抛错"改成"返回空串"（★ 只改 dist 产物，不碰 src）');
const orig = fs.readFileSync(PLUMBING, 'utf8');
chk(orig.includes('throw new Error(`缺参数 "${key}"`)'), '（前置）找到 requireStr 的守卫实现');
fs.writeFileSync(
  PLUMBING,
  orig.replace('throw new Error(`缺参数 "${key}"`)', '/* ★消融：守卫被撤掉 */'),
  'utf8',
);
chk(!fs.readFileSync(PLUMBING, 'utf8').includes('throw new Error(`缺参数 "${key}"`)'), '守卫已确实撤掉（回读文件确认落盘）');

console.log('\n════ ③ 同一个被消融的状态下，两条路各报什么 —— ★★ 这就是全部证据');
const bad1 = newScanBad();
chk(bad1 > 0, '★★ **新扫描变红**（检测到了失去守卫的 handler）', `坏签名=${bad1}`);
const cli1 = cliProbe();
chk(
  !/Cannot read|paths\[0\]|The "path"/.test(cli1),
  '★★ **旧路（CLI/zod）仍然绿** —— ★ 因为 zod 先拦住了，它**根本看不到**守卫已经没了',
  cli1.slice(0, 90),
);

console.log('\n════ ④ 还原（重跑构建 ⇒ dist 再生，比我手工改回去更可信）');
fs.writeFileSync(PLUMBING, orig, 'utf8');
execFileSync('npm', ['run', 'build'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
const bad2 = newScanBad();
chk(bad2 === 0, '还原后新扫描重新变绿', `坏签名=${bad2}`);

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('★ 结论：这道门**现在测的是 handler 的守卫**；撤掉守卫它会红（此前它不会）。');
