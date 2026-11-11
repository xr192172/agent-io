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

/** m2 仓库里 mybatis jar 的定位（版本探测：取 org/mybatis/mybatis 下最新目录） */
function mybatisJar(): string | null {
  const m2 = path.join(os.homedir(), '.m2', 'repository', 'org', 'mybatis', 'mybatis');
  try {
    const versions = fs.readdirSync(m2).filter((d) => /^\d+\.\d+/.test(d)).sort().reverse();
    if (versions.length === 0) return null;
    const jar = path.join(m2, versions[0], `mybatis-${versions[0]}.jar`);
    return fs.existsSync(jar) ? jar : null;
  } catch {
    return null;
  }
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
  const jar = mybatisJar();
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
