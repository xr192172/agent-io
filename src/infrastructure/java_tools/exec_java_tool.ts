/**
 * execJavaTool —— Java 开发工具的**执行辅助**（第⑬项任务 A 调整形态）。
 *
 * ★ 能力状态（2026-11-12 审计 D4-1）：**实验性 —— 未接入产品面**。唯一的消费者是
 *   `src/application/java_tools/mybatis_contracts.ts#mapperConsistency`，而它本身也没有产品入口
 *   （见该文件头）。接线候选与验收口径写在那边，别在这里各写一份。
 *
 * 用途：调夹具/子项目 `tools/` 下的 Java 工具类（如 MyBatisMapperDump）——
 *   编译（javac -cp，m2 jar）+ 运行（java -cp）+ stdout JSON 解析。
 * 与 maven runner 同款模式（spawnSync + stdout 解析），但**不经过 mvn**（单文件 javac 更快）。
 *
 * 失败语义：编译/运行失败 ⇒ {ok:false, stderr}（调用方降级/如实报——不静默）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ExecJavaToolResult {
  ok: boolean;
  /** 工具的 stdout（JSON 字符串原样；调用方自行 JSON.parse） */
  stdout: string;
  stderr: string;
  /** 编译产物缓存目录（跨调用复用） */
  classesDir: string;
}

/** javac/java 的 Windows 形态（.cmd 不需要——javac/java 是 exe） */
const JAVAC = process.platform === 'win32' ? 'javac.exe' : 'javac';
const JAVA = process.platform === 'win32' ? 'java.exe' : 'java';

/**
 * Maven 本地仓库的**候选清单**（按优先级）—— 唯一实现，别处不许再拼 `~/.m2`。
 *
 * ★ 2026-11-16（恢复事故实测）：本机的 maven 本地仓库**不在** `~/.m2`，而在项目级
 *   `D:\agentio\.m2repo`（`%USERPROFILE%\.m2` 根本不存在）⇒ 硬编码 `os.homedir()/.m2`
 *   会让"mybatis jar 找不到"被误判成「本机没装」：`p1_mybatis_consistency` 于是 `t.skip()`，
 *   而**测试门禁止 skip** ⇒ 门直接红（红在环境假设，不在判据）。
 *
 * 所以：**问环境，不要假设环境**。顺序：
 *   ① `AGENT_IO_M2_REPO`（显式覆盖，最权威）
 *   ② `MAVEN_OPTS` / `MAVEN_ARGS` 里的 `-Dmaven.repo.local=…`
 *   ③ `~/.m2/settings.xml` 的 `<localRepository>`
 *   ④ `~/.m2/repository`（Maven 默认）
 *   ⑤ 从项目根向上每一级的 `.m2repo`（本机的形态；仓库内自带的本地仓）
 */
export function mavenLocalRepoCandidates(projectRoot: string): string[] {
  const out: string[] = [];
  const push = (p?: string | null) => {
    if (!p) return;
    const v = String(p).trim();
    if (v && !out.includes(v)) out.push(v);
  };
  push(process.env.AGENT_IO_M2_REPO);
  for (const v of [process.env.MAVEN_OPTS, process.env.MAVEN_ARGS]) {
    const m = /-Dmaven\.repo\.local=("?)([^"\s]+)\1/.exec(v ?? '');
    if (m) push(m[2]);
  }
  const home = os.homedir();
  try {
    const xml = fs.readFileSync(path.join(home, '.m2', 'settings.xml'), 'utf8');
    const m = /<localRepository>\s*([^<]+?)\s*<\/localRepository>/.exec(xml);
    if (m) push(m[1]);
  } catch {
    /* 没有 settings.xml 是常态 */
  }
  push(path.join(home, '.m2', 'repository'));
  // ★ 逐级向上找 `.m2repo`：**两个锚点都走** —— 被分析项目根（可能是个临时目录/别处的仓）
  //   以及当前工作目录（本项目仓）。只走前者时，夹具在 tmp 下就永远看不到仓自带的 `.m2repo`。
  for (const anchor of [path.resolve(projectRoot), process.cwd()]) {
    let dir = path.resolve(anchor);
    for (;;) {
      push(path.join(dir, '.m2repo'));
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return out;
}

/**
 * 在候选仓库里定位 mybatis jar（版本探测：取 `org/mybatis/mybatis` 下最新目录）。
 * ★ 返回命中的**仓库根**，让调用方能说明"用的是哪个仓库"（不静默假设）。
 */
export function findMybatisJar(projectRoot: string): { jar: string; repo: string } | null {
  for (const repo of mavenLocalRepoCandidates(projectRoot)) {
    const base = path.join(repo, 'org', 'mybatis', 'mybatis');
    try {
      const versions = fs.readdirSync(base).filter((d) => /^\d+\.\d+/.test(d)).sort().reverse();
      for (const v of versions) {
        const jar = path.join(base, v, `mybatis-${v}.jar`);
        if (fs.existsSync(jar)) return { jar, repo };
      }
    } catch {
      /* 该候选没有这个坐标 —— 继续下一个 */
    }
  }
  return null;
}

/**
 * 执行 Java 工具：编译（首次）+ 运行。
 * @param toolSrc    工具类源文件（绝对路径）
 * @param className  全限定类名（如 tools.MyBatisMapperDump）
 * @param cp         运行 classpath 附加项（mybatis jar 等；自动含工具 classes 目录）
 * @param toolArgs   工具的 main 参数
 */
export function execJavaTool(
  projectRoot: string,
  toolSrc: string,
  className: string,
  cp: readonly string[],
  toolArgs: readonly string[],
): ExecJavaToolResult {
  const classesDir = path.join(projectRoot, 'target', 'engine-tools-classes');
  const jar = findMybatisJar(projectRoot)?.jar ?? null;
  const fullCp = [classesDir, ...cp, ...(jar ? [jar] : [])].join(path.delimiter);

  // ① 编译（工具类 .class 缺失时；缓存跨调用）
  const marker = path.join(classesDir, className.replace(/\./g, '/') + '.class');
  if (!fs.existsSync(marker)) {
    fs.mkdirSync(classesDir, { recursive: true });
    const c = spawnSync(JAVAC, ['-encoding', 'UTF-8', '-cp', fullCp, '-d', classesDir, toolSrc], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    if (c.status !== 0) {
      return { ok: false, stdout: '', stderr: `javac 编译失败：${String(c.stderr ?? c.stdout ?? '').slice(0, 400)}`, classesDir };
    }
  }

  // ② 运行
  const r = spawnSync(JAVA, ['-cp', fullCp, className, ...toolArgs], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 << 20,
    timeout: 60_000,
  });
  const stdout = String(r.stdout ?? '');
  if (r.status !== 0) {
    return { ok: false, stdout, stderr: `工具运行失败（exit=${r.status}）：${String(r.stderr ?? '').slice(0, 400)}`, classesDir };
  }
  return { ok: true, stdout, stderr: String(r.stderr ?? ''), classesDir };
}
