#!/usr/bin/env node
/**
 * env-check —— **开发环境体检**（唯一实现；`docs/ENVIRONMENT.md` 的"一键体检"就是它）。
 *
 * ## 它回答的问题
 *
 * "这台机器现在能不能跑本仓的活"——按 **必需 / 可选** 两档给结论，**每条都带修法**。
 *
 * ## 为什么要有它（2026-11-16 恢复事故）
 *
 * 换系统后 D 盘的程序都在（node/git/jdk/maven/go 全在 `D:\Program Files\*`），但**PATH 是空的**
 * ⇒ 报错是 `npm 不是内部或外部命令` / `缺 go 工具链` 这类**指向表象**的消息，人得逐个猜。
 * 更坏的一种：`node scripts/verify.mjs` 因为软链路径身份不一致**静默 exit 0**（假绿），
 * 光看退出码会以为"环境没问题"。
 * ⇒ 把"环境是否就绪"做成**一条命令、一张表、每条带修法**。
 *
 * ## 退出码（三态，与仓库纪律一致：判不了 ≠ 通过）
 *
 * · 0 = 必需项全绿（可选项缺失只 WARN）
 * · 1 = 有必需项 FAIL（环境未就绪）
 * · 2 = 体检本身没跑完（脚本异常——不是"环境没问题"）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

/** 跑一条命令拿首行（不抛：失败也要有读数）。Windows 下 .cmd 需要 shell。 */
function probe(cmd, args = [], { shell = false, timeout = 20000 } = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    shell: shell || process.platform === 'win32',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0, status: r.status, first: out.split('\n')[0]?.trim() ?? '', raw: out, error: r.error?.code ?? '' };
}

const rows = [];
const add = (level, item, detail, fix) => rows.push({ level, item, detail, fix });

// ── ① 运行时（必需）────────────────────────────────────────────────
const nodeV = process.version.replace(/^v/, '');
const [nMajor, nMinor] = nodeV.split('.').map(Number);
if (nMajor > 22 || (nMajor === 22 && nMinor >= 5)) {
  // ★ 版本匹配只报"能不能跑"，不判"该不该用这个版本"：node:sqlite 在 22.5 起可用。
  const note = nMajor === 22 ? '' : `${C.y}（本仓开发基线是 22.x；24+ 的 node:sqlite 有 API 差异，非必要不升级）${C.x}`;
  add('OK', 'node', `v${nodeV}${note}`);
} else {
  add('FAIL', 'node', `v${nodeV} 低于 22.5（缺 node:sqlite）`, '装 Node 22 LTS（>=22.5）并把它的目录放进 PATH');
}

const npmP = probe('npm', ['-v']);
add(npmP.ok ? 'OK' : 'FAIL', 'npm', npmP.ok ? `${npmP.first}` : '不可用', '随 Node 一起装（npm 与 node 同目录）');

// ── ② 版本控制（必需：变更集/提交/回滚全靠它）────────────────────────
const gitP = probe('git', ['--version']);
add(gitP.ok ? 'OK' : 'FAIL', 'git', gitP.ok ? gitP.first : '不可用', '装 Git for Windows；把 `<Git>\\cmd` 放进 PATH');

if (gitP.ok) {
  const inside = probe('git', ['rev-parse', '--is-inside-work-tree'], { shell: false });
  add(inside.ok && inside.first === 'true' ? 'OK' : 'FAIL', 'git 工作区', inside.ok ? '是本仓 git 工作区' : '不是 git 工作区（变更集读不出来）', '确认在仓根运行；或 `git init`（新克隆则 `git clone`）');
  const remote = probe('git', ['remote', 'get-url', 'origin'], { shell: false });
  add(remote.ok ? 'OK' : 'WARN', 'git 远端', remote.ok ? remote.first : '没有 origin（只能本地提交）', '`git remote add origin <url>`');
}

// ── ③ Java 工具链（Java LanguagePack 必需；纯 TS 开发可缺）─────────────
const javaP = probe('java', ['-version']);
const javaLine = `${javaP.raw}`.split('\n').find((l) => /version/i.test(l))?.trim() ?? javaP.first;
if (javaP.ok) {
  const m = /version "(\d+)/.exec(javaLine);
  const major = m ? Number(m[1]) : 0;
  add(major >= 17 ? 'OK' : 'WARN', 'java', `${javaLine}${major && major < 17 ? '（夹具 pom 要求 17+）' : ''}`, '装 JDK 17+，把 `<JDK>\\bin` 放进 PATH，并设 JAVA_HOME');
} else {
  add('WARN', 'java', '不可用（Java 夹具/MyBatis 契约会 SKIP）', '装 JDK 17+；PATH 加 `<JDK>\\bin`；设 JAVA_HOME');
}
const mvnP = probe('mvn', ['-v']);
add(mvnP.ok ? 'OK' : 'WARN', 'maven', mvnP.ok ? mvnP.first : '不可用（Java 测试对象跑不了）', '装 Maven；PATH 加 `<maven>\\bin`');
if (process.env.JAVA_HOME) add('OK', 'JAVA_HOME', process.env.JAVA_HOME);
else add('WARN', 'JAVA_HOME', '未设置', '设 `JAVA_HOME=<JDK 目录>`（mvn 依赖它）');

// ── ④ Go 工具链（「Go 编译 / Go 静态检查」两门需要）──────────────────
const goP = probe('go', ['version']);
add(goP.ok ? 'OK' : 'WARN', 'go', goP.ok ? goP.first : '不可用（Go 编译/静态检查两门会 SKIP）', '装 Go；PATH 加 `<Go>\\bin`；可选设 GOROOT');

// ── ⑤ 仓自身状态（必需）─────────────────────────────────────────────
const need = ['package.json', 'AGENTS.md', 'docs/PROJECT-DESIGN.md', 'tsconfig.json', 'scripts/verify.mjs'];
const missing = need.filter((f) => !fs.existsSync(path.join(ROOT, f)));
add(missing.length === 0 ? 'OK' : 'FAIL', '仓文件', missing.length ? `缺 ${missing.join(', ')}` : `${need.length}/${need.length} 在`, '确认目录选对（这不像本仓根）');

const nodeModules = fs.existsSync(path.join(ROOT, 'node_modules'));
add(nodeModules ? 'OK' : 'FAIL', 'node_modules', nodeModules ? '已装' : '未装', '`npm ci`（或 `npm install`）');

const distOk = fs.existsSync(path.join(ROOT, 'dist', 'src'));
add(distOk ? 'OK' : 'WARN', 'dist', distOk ? '已构建' : '未构建（工具/门跑的是 dist）', '`npm run build`');

const designDir = path.join(ROOT, '.agent-io', 'design');
const sheets = fs.existsSync(designDir) ? fs.readdirSync(designDir).filter((f) => f.endsWith('.dsl.json')) : [];
add(sheets.length ? 'OK' : 'WARN', '设计册', sheets.length ? `${sheets.length} 册：${sheets.map((s) => s.replace(/\.dsl\.json$/, '')).join(', ')}` : '一册都没有（判据门会判 0 条）', '`import_project`（或从备份恢复 `.agent-io/design/`）');

// ── ⑥ 路径身份（软链/真实形态）——**本节是 2026-11-16 事故的直接产物** ──
let realCwd = '';
try {
  realCwd = fs.realpathSync.native(process.cwd());
} catch {
  realCwd = process.cwd();
}
const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
if (norm(realCwd) !== norm(process.cwd())) {
  add(
    'WARN',
    '路径形态',
    `cwd 是软链形态：${process.cwd()} → 真实 ${realCwd}`,
    '引擎已按物理路径归一（scripts/lib/path_identity.mjs）；仍建议**固定用同一个形态**工作，别一会软链一会真实',
  );
} else {
  add('OK', '路径形态', 'cwd 即真实路径（无软链）');
}

// ── ⑦ 数据根可写（写账/基线/快照都落这里）────────────────────────────
const dataDir = path.join(ROOT, '.agent-io');
try {
  fs.mkdirSync(dataDir, { recursive: true });
  const probeFile = path.join(dataDir, '.env-check-write-probe');
  fs.writeFileSync(probeFile, 'ok');
  fs.rmSync(probeFile, { force: true });
  add('OK', '数据根可写', path.relative(ROOT, dataDir) || '.');
} catch (e) {
  add('FAIL', '数据根可写', `${dataDir}：${e?.code ?? e?.message}`, '检查 ACL/只读属性（见 skill diagnose-windows-sandbox-acl）');
}

// ── ⑧ 重活锁（残留锁会让门假红）──────────────────────────────────────
const lockFile = path.join(dataDir, 'heavy.lock');
if (fs.existsSync(lockFile)) {
  let info = '';
  try {
    const j = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    info = `pid=${j.pid}（${j.name ?? '?'}）at=${j.at ?? '?'}`;
    let alive = false;
    try {
      process.kill(Number(j.pid), 0);
      alive = true;
    } catch {
      alive = false;
    }
    add(alive ? 'WARN' : 'FAIL', '重活锁', `${alive ? '进程仍活着' : '★ 陈旧锁（持有进程已死）'}：${info}`, alive ? '等它跑完，别并行跑 verify/judge-all' : `删掉 ${path.relative(ROOT, lockFile)}（陈旧锁会让门假红）`);
  } catch {
    add('WARN', '重活锁', '存在但读不出内容', `看一眼 ${path.relative(ROOT, lockFile)}；确认没有活进程后删掉`);
  }
} else {
  add('OK', '重活锁', '无锁（可自由跑门）');
}

// ── 输出 ────────────────────────────────────────────────────────────
const badge = { OK: `${C.g}OK  ${C.x}`, WARN: `${C.y}WARN${C.x}`, FAIL: `${C.r}FAIL${C.x}` };
console.log(`\n${C.b}env-check —— 开发环境体检${C.x}  ${C.d}${ROOT}${C.x}`);
console.log(`${C.d}node ${nodeV} · ${process.platform}/${process.arch} · ${new Date().toISOString()}${C.x}\n`);
const w = Math.max(...rows.map((r) => r.item.length), 8);
for (const r of rows) {
  console.log(`  ${badge[r.level]}  ${r.item.padEnd(w)}  ${r.detail}`);
  // ★ 只给"没到位"的项打修法：全绿时刷 16 行修法是噪音（噪声会让人跳过整张表）
  if (r.fix && r.level !== 'OK') console.log(`        ${C.d}修法：${r.fix}${C.x}`);
}
const fails = rows.filter((r) => r.level === 'FAIL');
const warns = rows.filter((r) => r.level === 'WARN');
console.log('');
if (fails.length) {
  console.log(`${C.r}⇒ ${fails.length} 项必需未就绪${C.x}（另有 ${warns.length} 项可选缺失）⇒ 退出码 1：环境没准备好`);
  process.exit(1);
}
console.log(`${C.g}⇒ 必需项全绿${C.x}（可选缺失 ${warns.length} 项，见上方 WARN）⇒ 退出码 0`);
process.exit(0);
