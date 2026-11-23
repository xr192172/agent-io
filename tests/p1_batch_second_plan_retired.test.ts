/**
 * touches: scripts/design-check.mjs, scripts/verify-changed.mjs
 *
 * P1 · 第二企划：退役门禁 `retired` 第三 verdict 全套（§6 T-P5）。
 *
 * 分类规则（三条件同时满足才 retired）：
 *   ① 退役册模式（FEATURE 缺省，读归档件）；
 *   ② expect 依赖 callReport / mutateReport，且对应报告为 null 或 {error}；
 *   ③ 求值 false 归因执行面随册退役消失（判不了），非断言真实不成立。
 *
 * 反例边界（不得洗白）：
 * · 活册（FEATURE 指定）一律不分类 retired —— mutateReport.error 是真实故障 ⇒ fail 仍红、仍抬 rc；
 * · debt 标记 alone 不够：D1-D5b 带 debt 但可执行 ⇒ 正常 pass；
 * · D9 无 debt 字段，靠报告依赖 clause 覆盖；
 * · retired 不计 pass、不抬 rc；债务/id/why 随输出可见，台账卡不销。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'design-check.mjs');

function runDesignCheck(cwd: string, feature: string | null, asJson = true): { rc: number; text: string; json: Record<string, unknown> | null } {
  let out = '';
  let rc = 0;
  const args = [SCRIPT, ...(feature ? ['--feature', feature] : []), ...(asJson ? ['--json'] : [])];
  try {
    out = execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    rc = typeof (e as { status?: number }).status === 'number' ? (e as { status: number }).status! : -1;
    out = String((e as { stdout?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? '');
  }
  let json: Record<string, unknown> | null = null;
  if (asJson) {
    const line = out.trim();
    if (line) {
      try { json = JSON.parse(line) as Record<string, unknown>; }
      catch {
        const last = line.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop() ?? '';
        if (last) { try { json = JSON.parse(last) as Record<string, unknown>; } catch { json = null; } }
      }
    }
  }
  return { rc, text: out, json };
}

const itemsOf = (j: Record<string, unknown> | null): Array<Record<string, unknown>> =>
  (j?.items as Array<Record<string, unknown>>) ?? [];

test('① 真归档件：D1-D5b 正常 pass，D6/D7/D9 retired，fail 0，rc 0（retired 不抬退出码）', () => {
  const { rc, json, text } = runDesignCheck(ROOT, null);
  assert.equal(rc, 0, '纯退役册 ⇒ rc 0（真实 fail=0）；读数：' + text.slice(-400));
  assert.ok(json, 'JSON 回执必须可解析');
  assert.equal(json!.failed, 0, '归档册真实 fail 必须为 0');
  assert.equal(json!.pending, 0);
  assert.equal(json!.retired_count, 3, 'D6/D7/D9 三条 retired');
  const byId = new Map(itemsOf(json).map((i) => [String(i.id), i]));
  for (const id of ['D6', 'D7', 'D9']) {
    assert.equal(byId.get(id)?.verdict, 'retired', `${id} 必须判 retired`);
  }
  // D1 带 debt 但可执行 ⇒ 正常 pass，不得因 debt 标记自动退役
  assert.equal(byId.get('D1')?.verdict, 'pass', 'debt alone 不够：D1 带 debt 仍正常求值 pass');
  // D9 无 debt 字段 ⇒ 靠报告依赖 clause 覆盖，仍 retired
  assert.equal(byId.get('D9')?.debt, undefined, 'D9 本就无 debt 字段（不得凭空补）');
  // 债务可见不核销：retired 条目 debt/why 随输出保留
  assert.ok(String(byId.get('D6')?.debt ?? '').length > 0, 'D6 debt 字符串可见');
  assert.ok(String(byId.get('D7')?.why ?? '').length > 0, 'D7 why 可见');
  assert.ok(String(byId.get('D9')?.why ?? '').length > 0, 'D9 why 可见');
});

test('② 文本五计数行 + retired 横幅点名 D6/D7/D9 与台账卡', () => {
  const { text } = runDesignCheck(ROOT, null, false);
  assert.match(text, /通过 7 · ★ 不通过 0 · 进行中 0 · 退役不可执行 3（共 10 条）/, '汇总行五计数形状（单尺定义在 design-check）');
  assert.match(text, /⚑ 退役不可执行 3 条（D6 \/ D7 \/ D9）/, '横幅点名三条 retired');
  assert.match(text, /T-#ARCHIVED-D6-D7-D9/, '横幅指向台账卡（债务不核销）');
});

test('③ 活册反例：FEATURE 指定 + mutateReport.error ⇒ fail 仍红，不洗成 retired，rc 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-check-live-'));
  try {
    fs.mkdirSync(path.join(dir, '.agent-io', 'design'), { recursive: true });
    // 真册 dist 链接：kind 权威期待 dist/src/domain/expectation.js 存在（拿不到会 exit 2，那是另一条守卫）
    try { fs.symlinkSync(path.join(ROOT, 'dist'), path.join(dir, 'dist'), 'junction'); } catch { /* 已存在 */ }
    const book = {
      task_plan: {
        design_completeness: {
          criteria: [
            {
              id: 'L1',
              name: '活册 mutate 依赖',
              expect: '(() => { if (!mutateReport) return false; if (mutateReport.error) return false; return mutateReport.survived === 0; })()',
            },
          ],
        },
      },
      geometry: { nodes: [] },
    };
    fs.writeFileSync(path.join(dir, '.agent-io', 'design', 'live-probe.dsl.json'), JSON.stringify(book, null, 2));
    const { rc, json, text } = runDesignCheck(dir, 'live-probe');
    assert.equal(rc, 1, '活册真实故障（mutateReport.error）必须抬 rc=1；读数：' + text.slice(-400));
    const l1 = itemsOf(json).find((i) => i.id === 'L1');
    assert.ok(l1, '活册条目必须在结果里');
    assert.notEqual(l1!.verdict, 'retired', '活册 error 不得洗成 retired');
    assert.equal(l1!.verdict, 'fail', '活册 error 判 fail 仍红');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录 */ }
  }
});

test('④ 五计数单尺对齐：design-check 模板 ↔ verify-changed 正则 / JSON 字段同序同位', () => {
  const dc = fs.readFileSync(path.join(ROOT, 'scripts', 'design-check.mjs'), 'utf8');
  const vc = fs.readFileSync(path.join(ROOT, 'scripts', 'verify-changed.mjs'), 'utf8');
  // design-check 汇总行模板：pass · fail · pending · retired · 共
  assert.ok(dc.includes("通过 ${count('pass')} · ★ 不通过 ${count('fail')} · 进行中 ${count('pending')} · 退役不可执行 ${count('retired')}（共 ${results.length} 条）"), 'design-check 汇总行五计数模板');
  // verify-changed 正则五组同序：pass fail pending retired checked
  assert.ok(vc.includes('通过 (\\d+) · ★ 不通过 (\\d+) · 进行中 (\\d+) · 退役不可执行 (\\d+)（共 (\\d+) 条）'), 'verify-changed 正则五计数对齐');
  assert.ok(vc.includes('retired: designCheckRun?.retired ?? null'), 'verify-changed JSON 增 retired 计数位');
  assert.ok(vc.includes("退役不可执行 ${designCheckRun.retired ?? '?'}"), 'verify-changed 文本增 retired 计数位');
  // JSON 侧：design-check 产出 retired_count
  assert.match(dc, /retired_count: count\('retired'\)/, 'design-check JSON 增 retired 计数');
});

test('⑤ gate 链退出码透传：design:check 直挂 node 脚本，链上 && 透传；rc 仅 fail 抬 1', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts['design:check'], /^node scripts\/design-check\.mjs$/, 'design:check 是直挂脚本，无包裹吞退出码');
  assert.match(pkg.scripts.gate, /npm run design:check &&/, 'gate 链经 && 透传 design:check 退出码');
  const dc = fs.readFileSync(path.join(ROOT, 'scripts', 'design-check.mjs'), 'utf8');
  assert.match(dc, /process\.exit\(count\('fail'\) \? 1 : 0\)/, '退出码仅 fail 抬 1；retired 不计 fail');
});

test('⑥ 分类守门静态锚：retired 只在退役册模式启用；活册 unsupported/error 不进 retired 桶', () => {
  const dc = fs.readFileSync(path.join(ROOT, 'scripts', 'design-check.mjs'), 'utf8');
  assert.match(dc, /else if \(!FEATURE && dependentReport && reportUnavailable\(dependentReport\.report\)\)/, 'retired 分支首道守门 = !FEATURE（退役册模式）');
  assert.match(dc, /const dependentReport = \(\(\) =>/, '报告依赖 clause 先判（callReport / mutateReport）');
  // 活册 D6 病史（G10）：unsupported>0 仍是 fail，本批不复活"只判 checked>=1∧failed===0"的假绿路径；
  // 病史口径留在归档册 expect 内，本批不改 expect、不删判据。
});
