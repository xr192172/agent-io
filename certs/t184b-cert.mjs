/**
 * T184b 出生证：**显式重建之后，② 还看得见那个墓碑吗？**
 *
 * ## 判据（★ 技能 `guard-blindspot-diagnosis` §6 要求：证明【旧判据在同一个输入上会失败】）
 * · 态 A（未重建）⇒ 报，且 `origin === 'base_dsl'`
 * · ★★ 态 B（**真重建**）⇒ **必须仍报**，且 `origin === 'overlay_tombstone'`
 *   —— ★ **修前实测读数是 `retireFlow = []`**（见 `certs/t184b-probe.mjs` 的输出），
 *     所以"态 B 非空"这条断言**在旧代码上必红** ⇒ 它测的**就是那个盲区**。
 * · ★ 反例（不许矫枉过正）：
 *   ① 文件**在 base 里**时**不许重复报**（两个来源要合起来去重，不是各报一遍）；
 *   ② `exists` 必须**现取磁盘** —— "不在 base" **不等于** "不在磁盘"
 *      （实测：重建后 base 没有它，而文件**还在盘上** ⇒ 正确判成"待实现删"，而不是"可归档"）。
 * · ★ 合成检查：墓碑也要能走 T187 那条链（`scope_files` 带上它 ⇒ 可喂 `archive.file_path`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDSL, saveDSL } from '../dist/src/infrastructure/storage.js';
import { mergeDesignLayer, loadOverlay, syncLifecycleToOverlay } from '../dist/src/infrastructure/storage_overlay.js';
import { checkConsistencyReport } from '../dist/src/application/design/intent/consistency.js';

const FEATURE = 'run82';
const FEATFILE = `.agent-io/features/${FEATURE}.json`;
const OVERLAY = `.agent-io/features/${FEATURE}.overlay.json`;
const TARGET = 'dogfood/build_cache.mjs';
const TARGET_ID = 'file_dogfood_build_cache_mjs';
const REASON = 'T184b 出生证：验证重建后的可见性';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 真重建：调 `import_project.ts:1069` 那一行 + 同款 `saveDSL` */
const rebuildDropping = (id) => {
  const scanned = JSON.parse(JSON.stringify(getDSL(FEATURE)));
  scanned.semantic.files = scanned.semantic.files.filter((f) => f.id !== id);
  const merged = mergeDesignLayer(scanned);
  saveDSL(merged.dsl);
  return merged;
};
const mark = (status, reason) => {
  const d = getDSL(FEATURE);
  d.semantic.files.find((f) => f.id === TARGET_ID).lifecycle = { status, retire_reason: reason };
  saveDSL(d);
  syncLifecycleToOverlay(FEATURE, getDSL(FEATURE));
};
/** 把 TARGET 从 overlay 拿掉（为了"反例②"里造 exists 不同的情形不互相污染） */
const clears = () => {
  for (const p of [FEATFILE, OVERLAY]) {
    if (!fs.existsSync(p)) continue;
    if (p === OVERLAY) {
      const o = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (o.anchors?.[TARGET_ID]) { delete o.anchors[TARGET_ID].lifecycle; if (!Object.keys(o.anchors[TARGET_ID]).filter((k) => !['path', 'kind'].includes(k)).length) delete o.anchors[TARGET_ID]; }
      fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
    } else {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      const f = d.semantic.files?.find((x) => x.id === TARGET_ID);
      if (f) delete f.lifecycle;
      fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
    }
  }
};

console.log('════ ① 态 A（未重建）：报，且来源 = base');
clears();
mark('deprecated', REASON);
const a = await checkConsistencyReport({ feature: FEATURE });
const ea = (a.retireFlow ?? []).find((x) => x.file_path === TARGET);
chk(!!ea, '① 报出来了', JSON.stringify(ea));
chk(ea?.origin === 'base_dsl', '① 来源标成 base_dsl', String(ea?.origin));

console.log('\n════ ② ★★ 态 B（真重建）：必须【仍报】，且来源 = overlay 墓碑');
chk(!!(ea), '（前提）态 A 有它；下面把它从 base 里重建掉');
rebuildDropping(TARGET_ID);
chk(!getDSL(FEATURE).semantic.files.some((f) => f.id === TARGET_ID), '重建后它确实不在 base 了');
chk(!!loadOverlay(FEATURE)?.anchors?.[TARGET_ID]?.lifecycle, 'overlay 上的标记还在（数据没丢）');
const b = await checkConsistencyReport({ feature: FEATURE });
const eb = (b.retireFlow ?? []).find((x) => x.file_path === TARGET);
chk(!!eb, '★★ **仍能报出来**（★ 修前这里是空的 —— 这就是本条的出生证）', JSON.stringify(eb));
chk(eb?.origin === 'overlay_tombstone', '★★ 且**如实标注来源**（读端据此知道 get_dsl 查不到它）', String(eb?.origin));

console.log('\n════ ③ ★ 不许矫枉过正：反例两条');
chk(
  (b.retireFlow ?? []).filter((x) => x.file_path === TARGET).length === 1,
  '反例①：同一路径**只报一次**（两个来源是【合并去重】，不是各报一遍）',
  `次数=${(b.retireFlow ?? []).filter((x) => x.file_path === TARGET).length}`,
);
// ★ 反例②：`exists` 必须现取磁盘 —— 上面那次重建里，文件**仍在盘上** ⇒ 应当"待实现删"，不是"可归档"
chk(fs.existsSync(path.join(process.cwd(), TARGET)), '（前提）那个文件其实**还在磁盘上**');
chk(
  eb?.exists === true && eb?.stage === 'awaiting_implementation_delete',
  '反例②：★ "不在 base" **没有被当成**"不在磁盘" ⇒ 正确判成**待实现删**（想当然就会误报成可归档）',
  `exists=${eb?.exists} stage=${eb?.stage}`,
);

console.log('\n════ ④ ★ 合成：墓碑也要能走 T187 那条链（②→③）');
// ★ 走**工具**（不是直调 handler）：`consistencyHandler` 会**真跑**决策卡上的验收（run82 有 2 条会失败
//   ⇒ 直调会抛），而工具路会把那部分折成报告文字。★ 我只取 `touched` 与那句"来源"。
const { execFileSync } = await import('node:child_process');
const execFileSync2 = execFileSync; // ★ 收尾复用（同一次 import）
// ★★★ T251：**机器段的解析只走唯一入口**（本证原先自己写了一份 ⇒ 已删）
const { parseDataBlock } = await import(
  pathToFileURL(path.join(process.cwd(), 'dist', 'src', 'application', 'plumbing.js')).href,
);
let toolOut = '';
try {
  toolOut = execFileSync('node', ['scripts/mcp/mcp_call.mjs', 'consistency_check', JSON.stringify({ feature: FEATURE })], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024, // ★ 别用默认 1MB —— 这个工具的 DATA 有 178KB/工具多时更大
  });
} catch (e) {
  // ★ 失败要说出来（`guard-blindspot-diagnosis`：量具自己的失败不许被吞）
  console.log(`✗ ④ 取工具回执失败：${String(e.message).slice(0, 200)}`);
}
// ★★ 切到 `---DATA---` 之后**还要在 `--- stderr ---` 处截断** —— 否则把后随的 stderr 段也喂给
//   `JSON.parse` ⇒ `Unexpected non-whitespace character after JSON`（★ 我为此白折腾了两轮，
//   而且那个错误一直伪装成 `<anonymous_script>`，看着像子进程的问题 ⇒ **先看全产物再解析**）。
const i = toolOut.indexOf('---DATA---');
const jsonText = i < 0 ? '' : toolOut.slice(i + 10).split('\n--- stderr ---')[0];
let data = {};
// ★★★ T251：**改用唯一入口**（`plumbing.parseDataBlock`）—— ★ 本证原先自己写了一份解析，
//   而"每个消费方各写一份"正是本仓头号病 ⇒ 已删本地实现，改为共用。
const parsed = parseDataBlock(toolOut);
try {
  data = parsed ?? {};
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`✗ ④ JSON.parse 失败：${msg}`);
  console.log(`   ★ jsonText 前 240 字符：${jsonText.slice(0, 240).replace(/\n/g, '⏎')}`);
  console.log(`   ★ jsonText 尾部 160 字符：${jsonText.slice(-160).replace(/\n/g, '⏎')}`);
}
chk(
  (data.touched?.scope_files ?? []).includes(TARGET),
  '★ 墓碑进了 scope_files（T187 那条边因此也通了）',
  JSON.stringify(data.touched?.scope_files),
);
chk(toolOut.includes('overlay 墓碑'), '★ 报告里**写明了**来源（呈现不藏证据）');

console.log('\n════ ⑤ 反例③：磁盘上也没了的墓碑 ⇒ stage 应当变 ready_to_archive');
clears();
// 造一个"路径不存在"的墓碑：直接用 overlay 塞一个（不进 base）
{
  const o = JSON.parse(fs.readFileSync(OVERLAY, 'utf8'));
  o.anchors['file_nonexistent_probe'] = { path: 'src/__t184b_nonexistent__.ts', kind: 'file', lifecycle: { status: 'deprecated', retire_reason: 'T184b：磁盘上也没有' } };
  fs.writeFileSync(OVERLAY, JSON.stringify(o, null, 2), 'utf8');
}
const c = await checkConsistencyReport({ feature: FEATURE });
const ec = (c.retireFlow ?? []).find((x) => x.file_path === 'src/__t184b_nonexistent__.ts');
chk(ec?.stage === 'ready_to_archive', '★ 磁盘上也没有 ⇒ 判成**可归档**（判据一处 `retireStage` 生效）', JSON.stringify(ec));

// ★★★ 收尾：**必须还原** —— ★ 这条是本证第 6 个动作，而它的必要性是**被测出来的**：
//   我先前把这张证放在回归链的**最前面**跑了一次 ⇒ 它留下的假锚点 + 墓碑 **污染了后面每一个证**
//   （t181 读成 0/14、t182b-tombstone 直接崩）⇒ ★ **我一度以为"这一笔把前面的证打破了"**。
//   ⇒ 技能 §2 明令：自证**不许污染真实状态**，且要做**双向断言**（开头已知、结尾已还原）。
execFileSync2('node', ['certs/t185-reset.mjs']);
const restored = (() => {
  const o = JSON.parse(fs.readFileSync(OVERLAY, 'utf8'));
  const d = JSON.parse(fs.readFileSync(FEATFILE, 'utf8'));
  return {
    bogus: !o.anchors['file_nonexistent_probe'],
    tomb: !o.anchors[TARGET_ID]?.lifecycle,
    lc: !d.semantic.files?.find((x) => x.id === TARGET_ID)?.lifecycle,
  };
})();
console.log('\n════ ⑥ 收尾：**真实文件已还原**（★ 量具不许污染下一个证）');
chk(restored.bogus, '假锚点已清');
chk(restored.tomb, `overlay 上 ${TARGET_ID} 的标记已清`);
chk(restored.lc, 'base 里那个文件的 lifecycle 已清');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('★ 出生证：态 B 那条断言在【修前】必红（修前实测 retireFlow = []）⇒ 它测的就是那个盲区。');
