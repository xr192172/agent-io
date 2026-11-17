/**
 * ★★★ F1b —— **语义层事实填充**（fields / signatures / contracts）
 *
 * ## 为什么住在这里
 * 事实由 `import_project` 的索引内核触发就够，**不新增工具面**（AGENTS 收敛原则）。
 * 抽取器本身在 `./gofacts/`（仓内 Go 程序），因为它要 type checker；
 * 本文件只负责：**调它 → 降级判定 → 落库**（事务与表结构只在这一处）。
 *
 * ## 三层语义（不许越界）
 *   ① 本项目能 type-check  ⇒ 精确事实（字段账 / 签名账 / 接口契约账）
 *   ② 不能（缺依赖/无 go.mod）⇒ **不产出**，回执里写 `syntax-only` 与原因，**不猜**
 *   ③ 非 Go 语言          ⇒ 本步跳过（TS 侧未来用 tsc Checker 填同一批表）
 *
 * ## 幂等
 * 每次**全量刷新**这几张派生表（先 DELETE 再插）：这样"事实过期"不会累积；
 * 语义层失败时**不清空**已有行（失败路径根本走不到那几句 DELETE）。
 *
 * ## 已下线的表（v18 · R11）
 * `occurrences` 已删（建表 / 写入端 / 计数读数一起删）：它记的"某符号出现在哪"与 `identifiers` 表
 * **重复**，而列更少（只有 line/col，**没有** start_index/end_index）⇒ 填满它也帮不了 `edit_code`
 * （它要**精确偏移**）。同一事实的第二处住处、且比第一处更弱 ⇒ 删第二处（AGENTS 0.9.1 方向 A）。
 * 它原本独有的 `role` / `symbol_id` 属语义层，本仓 TS 侧不生产 ⇒ 挂账（docs/todo.md R11）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './db.js';
import { resolveJdkForProject } from './jfacts/jdk.js';
import { mavenLocalRepoCandidates } from '../java_tools/exec_java_tool.js';

/** ESM 下没有 __dirname ⇒ 用 import.meta.url 定位（本文件编译后位于 dist/src/infrastructure/index/） */
const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface SemanticFactsResult {
  ok: boolean;
  reason?: string;
  packages: number;
  files: number;
  typeErrors: number;
  fields: number;
  signatures: number;
  /** 二进制来源：缓存命中 / 本次构建 / go run 兜底 */
  via: 'cached' | 'built' | 'go-run' | 'none';
}
interface RawField {
  /** ★ 出处文件（相对路径）：build tag 互斥变体的同名结构体靠它区分，缺了就会并集 */
  file: string;
  structure: string;
  name: string;
  ordinal: number;
  type: string;
  jsonTag: string;
  embedded: boolean;
}
interface RawParam {
  name: string;
  type: string;
}
interface RawFunc {
  file: string;
  recv: string;
  name: string;
  params: RawParam[];
  results: string[];
}
interface RawIface {
  file: string;
  name: string;
  methods: string[];
  impls: string[];
}
/**
 * 抽取器的 JSON 形状。
 * ★ 2026-11-05（R11 · v18）：`occurrences` 字段**不再读**（表已删）。Go 侧 `gofacts/main.go`
 *   仍会 emit 它 —— 那是**跨语言契约的残留**：本仓今天**零读者**，本卡不动 Go 源码，只在此声明。
 *   要删它 = 改 `src/infrastructure/index/gofacts/main.go` 的 `Out.Occurrences` 字段与它的采集循环。
 */
interface RawOut {
  ok: boolean;
  reason?: string;
  packages: number;
  files: number;
  typeErrors: number;
  fields: RawField[];
  funcs: RawFunc[];
  ifaces?: RawIface[];
}

// ★ 抽取器是 **Go 源码**（dist 里没有 .go）⇒ 优先查找编译产物同级，回落仓库源码目录
const HELPER_DIR =
  [path.join(HERE, 'gofacts'), path.join(HERE, '../../../../src/infrastructure/index/gofacts')].find((p) => fs.existsSync(p)) ??
  path.join(HERE, 'gofacts');
const GO_TIMEOUT_MS = 120_000;

/**
 * jfacts（Java 抽取器）源码目录。
 *
 * ★★ 与 `HELPER_DIR` 的取法**不能照抄**（实测踩过）：`HELPER_DIR` 用 `existsSync(目录)` 判候选，
 *   那是因为 gofacts 目录里只有 `.go` 文件 —— dist 里**根本不会有** `gofacts/`，所以第一个候选自然落空。
 *   而 jfacts 目录里还有 `jdk.js`（TS 编译产物，**会**进 dist）⇒ `dist/.../jfacts` 目录**存在**，
 *   于是"目录存在"这个判据会把 dist 选中，而 `JFacts.java` 并不在 dist 里 ⇒ 抽取器源码"找不到"。
 *   ⇒ 判据必须是**目标文件存在**（`JFacts.java`），不是目录存在。
 */
const JFACTS_DIR =
  [
    path.join(HERE, 'jfacts'),
    path.join(HERE, '../../../../src/infrastructure/index/jfacts'),
  ].find((p) => fs.existsSync(path.join(p, 'JFacts.java'))) ?? path.join(HERE, 'jfacts');
/** Java 抽取的超时（全项目 attribution 实测 ≈8s；给足余量但**必须有上限**） */
const JAVA_TIMEOUT_MS = 300_000;
/** `mvn dependency:build-classpath` 的超时（首次可能要下载依赖） */
const MAVEN_TIMEOUT_MS = 900_000;

/** go 是否可用（不可用 ⇒ 直接降级，不去撞 exec 错误） */
function goAvailable(): boolean {
  try {
    execFileSync('go', ['version'], { timeout: 15_000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 拿到可执行的抽取器：优先用缓存二进制（`.agent-io/tools/gofacts.exe`），
 * 没有就 `go build` 一次；再不行退 `go run`（慢但能跑）。
 */
function helperBinary(projectRoot: string): { file: string; args: string[]; via: SemanticFactsResult['via'] } | null {
  const toolsDir = path.join(projectRoot, '.agent-io', 'tools');
  const exe = path.join(toolsDir, process.platform === 'win32' ? 'gofacts.exe' : 'gofacts');
  try {
    const src = path.join(HELPER_DIR, 'main.go');
    const needBuild = !fs.existsSync(exe) || fs.statSync(exe).mtimeMs < fs.statSync(src).mtimeMs;
    if (needBuild) {
      fs.mkdirSync(toolsDir, { recursive: true });
      execFileSync('go', ['build', '-o', exe, '.'], {
        cwd: HELPER_DIR,
        timeout: GO_TIMEOUT_MS,
        stdio: 'ignore',
        env: { ...process.env, GOFLAGS: '-mod=mod', GOPROXY: 'off', GOSUMDB: 'off' },
      });
      return { file: exe, args: [], via: 'built' };
    }
    return { file: exe, args: [], via: 'cached' };
  } catch {
    // 构建失败（如 x/tools 不在缓存）⇒ 退 go run
    return { file: 'go', args: ['run', '.'], via: 'go-run' };
  }
}

/** 抽取并落库；返回结构化读数（失败也返回读数，让调用方记账，不静默） */
export function fillSemanticFacts(db: Database, projectRoot: string): SemanticFactsResult {
  // ★★★ 卡3（jfacts）：**按项目形态分派**。
  //   判据 = 项目根有没有 `pom.xml`（Maven 项目）。为什么用它而不是"有没有 .java 文件"：
  //   `pom.xml` 同时给出**该用哪个 JDK**（`jdk.ts` 读 java.version），一个信号定两件事；
  //   而"有 .java 文件"在混编仓（Android/Gradle）里会误判成 Maven。
  //   ★ 两条分支**互不写同一张表**（见各自头注）：Go 走全量 DELETE 再插；Java **零写库**。
  //     因此"Java 抽取失败清空 Go 事实"这个风险不是靠顺序保证的，而是**结构上不存在**。
  if (isMavenProject(projectRoot)) return fillSemanticFactsJava(db, projectRoot);
  return fillSemanticFactsGo(db, projectRoot);
}

/** 项目形态判定：`<root>/pom.xml` 可读 ⇒ Maven（Java 抽取器）；否则按 Go 处理（既有行为逐字不变） */
function isMavenProject(projectRoot: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, 'pom.xml')).isFile();
  } catch {
    return false;
  }
}

/**
 * ★ Java 分支 —— **零写库**（裁定 1，卡3）。
 *
 * ## 为什么不写 fields / signatures / contracts
 * `fields` 的唯一读端 `authoring/translate/book.ts#generateBook` 只从 `language='go'` 的 nodes 出发建符号
 * （`book.ts:818` 的 `base` 常量），而 Java 项目的 nodes 全是 `language='java'`
 * ⇒ 写进去的行**一次都读不到**（死数据）；且 `ordinal`/`embedded`/`json_tag` 三列是 Go 概念。
 * 按「零**可用**读端的表不填」，本分支只回**结构化读数**。
 * 挂账 `T-#JFACTS-FIELDS-CONSUMER`：Java 结构事实的落库必须等真实消费者卡。
 *
 * ## 为什么这样也把「清空 Go 事实」的风险治死了
 * 本函数体内**没有任何 INSERT/DELETE**（判据 `run` 钉住这一点）⇒ 它与 Go 分支不共享事务，
 * 也不需要在事务里判"要不要 DELETE"。失配时返回 ok:false + reason，库**原样不动**。
 */
export function fillSemanticFactsJava(_db: Database, projectRoot: string): SemanticFactsResult {
  const empty: SemanticFactsResult = {
    ok: false,
    packages: 0,
    files: 0,
    typeErrors: 0,
    fields: 0,
    signatures: 0,
    via: 'none',
  };

  // ① JDK 决议：pom 声明的 major 必须与本机某个 JDK **相等**；不等/没声明 ⇒ 显式拒绝（不回落 PATH）
  const res = resolveJdkForProject(projectRoot);
  if (!res.ok) return { ...empty, reason: `JDK 决议失败：${res.detail}` };
  const jdkHome = res.jdkHome;
  const javacPath = path.join(jdkHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
  const javaPath = path.join(jdkHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!fs.existsSync(javaPath)) {
    return { ...empty, reason: `JDK 目录里没有 java 可执行文件：${javaPath}（声明 ${res.major}）` };
  }

  // ② classpath：mvn dependency:build-classpath 的结果缓存到 <project>/.agent-io/tools/
  const cp = resolveMavenClasspath(projectRoot, jdkHome);
  if (!cp.ok) {
    // ★ 裁定 3：拿不到 classpath ⇒ ok:false，**不**输出 best-effort 的假精确事实
    return { ...empty, reason: `classpath 不可得：${cp.reason}` };
  }

  // ③ 编抽取器（缓存到 .agent-io/tools/jfacts-classes/，源改动即重建）+ 跑
  const srcFile = path.join(JFACTS_DIR, 'JFacts.java');
  if (!fs.existsSync(srcFile)) return { ...empty, reason: `抽取器源码缺失：${srcFile}` };
  const classesDir = path.join(projectRoot, '.agent-io', 'tools', 'jfacts-classes');
  const marker = path.join(classesDir, 'JFacts.class');
  try {
    const needBuild =
      !fs.existsSync(marker) || fs.statSync(marker).mtimeMs < fs.statSync(srcFile).mtimeMs;
    if (needBuild) {
      fs.mkdirSync(classesDir, { recursive: true });
      const c = spawnSync(javacPath, ['-encoding', 'UTF-8', '-d', classesDir, srcFile], {
        encoding: 'utf8',
        timeout: JAVA_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (c.status !== 0) {
        return { ...empty, reason: `抽取器编译失败：${String(c.stderr ?? c.stdout ?? '').slice(0, 400)}` };
      }
    }
    const out = spawnSync(javaPath, ['-cp', classesDir, 'JFacts', projectRoot, '--classpath', cp.classpath], {
      encoding: 'utf8',
      timeout: JAVA_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (out.status !== 0) {
      return { ...empty, via: 'built', reason: `抽取器执行失败：${String(out.stderr ?? '').slice(0, 400)}` };
    }
    const line = String(out.stdout ?? '').trim().split('\n').pop() ?? '{}';
    const raw = JSON.parse(line) as RawOut;
    if (!raw.ok) return { ...empty, via: 'built', reason: raw.reason ?? '抽取器返回 ok=false' };
    // ★ 零写库：只回读数（fields/signatures 一律 0，让调用方不误以为写了库）
    return {
      ok: true,
      packages: raw.packages ?? 0,
      files: raw.files ?? 0,
      typeErrors: raw.typeErrors ?? 0,
      fields: 0,
      signatures: 0,
      via: 'built',
    };
  } catch (e) {
    return { ...empty, reason: `Java 抽取异常：${String((e as Error).message).slice(0, 200)}` };
  }
}

/**
 * 解析 Maven classpath：优先 `<project>/.agent-io/tools/maven-classpath.txt` 缓存（pom 未变则复用），
 * 否则调 `mvn dependency:build-classpath` 生成一次。
 *
 * ★ 仓库落点：`AGENT_IO_M2_REPO` 优先，其次 `mavenLocalRepoCandidates()`（复用既有五路候选，
 *   不在这里另写一套 `.m2repo` 口径）。与 `exec_java_tool.ts` 共用同一处权威。
 * ★ 失败一律返回 `{ok:false, reason}`（带 mvn 的 stderr 尾巴），不抛、不猜。
 */
function resolveMavenClasspath(
  projectRoot: string,
  jdkHome: string,
): { ok: true; classpath: string } | { ok: false; reason: string } {
  const toolsDir = path.join(projectRoot, '.agent-io', 'tools');
  const cpFile = path.join(toolsDir, 'maven-classpath.txt');
  const pomFile = path.join(projectRoot, 'pom.xml');
  try {
    if (fs.existsSync(cpFile) && fs.statSync(cpFile).mtimeMs >= fs.statSync(pomFile).mtimeMs) {
      const cached = fs.readFileSync(cpFile, 'utf8').trim();
      if (cached !== '') return { ok: true, classpath: cached };
    }
  } catch {
    /* 缓存不可用 ⇒ 往下重新生成 */
  }
  const repo = resolveMavenRepo(projectRoot);
  fs.mkdirSync(toolsDir, { recursive: true });
  // ★ 属性**必须在 goal 之前**：实测把 `-Dmaven.repo.local=…` 放到 `dependency:build-classpath` 之后，
  //   Maven 会把它读成"目标前缀" ⇒ `No plugin found for prefix '.repo.local=D'`。
  const mvn = resolveMavenBin();
  const r = spawnSync(
    mvn,
    ['-q', '-DincludeScope=compile', `-Dmdep.outputFile=${cpFile}`, `-Dmaven.repo.local=${repo}`, 'dependency:build-classpath'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: MAVEN_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, JAVA_HOME: jdkHome },
      // ★★ Windows 上 `.cmd` 是**批处理包装**：Node 从 v18.20.2 / v20.12.2 起（CVE-2024-27980 的修法）
      //   **禁止**不经 shell 直接 spawn `.cmd/.bat` ⇒ 报 `EINVAL`（实测：不设 shell 时
      //   `spawnSync ...mvn.cmd EINVAL`）。必须 `shell:true` 才能跑。
      //   ★ 安全面：这里的 `mvn` 与 `repo` 都**不是用户输入**（来自 env / settings.xml / 常量），
      //     参数里唯一的可变项是 `cpFile`（我们自己的 `.agent-io/tools/` 路径），且已用
      //     `spawnSync` 的实参数组传递、不经字符串拼接 ⇒ 无注入面。
      shell: process.platform === 'win32',
    },
  );
  if (r.error) {
    // ★ `spawnSync` 的 ENOENT 不会进 status（status=null）⇒ 必须单独判 error，
    //   否则回执里只剩一句 "exit=null"（实测踩过：mvn 不在 PATH 时读数完全不可读）。
    return {
      ok: false,
      reason:
        `找不到 mvn 可执行文件（${mvn}）：${String((r.error as Error).message).slice(0, 200)} ⇒ ` +
        `把 maven 的 bin 放进 PATH，或设 AGENT_IO_MVN_HOME 指向 maven 安装目录`,
    };
  }
  if (r.status !== 0) {
    const tail = String(r.stderr ?? r.stdout ?? '').slice(-500);
    return {
      ok: false,
      reason:
        `mvn dependency:build-classpath 失败（exit=${r.status}，repo=${repo}）⇒ ` +
        `先跑一次依赖解析（mvn -Dmaven.repo.local=${repo} dependency:resolve）再试。原始输出：${tail}`,
    };
  }
  try {
    const built = fs.readFileSync(cpFile, 'utf8').trim();
    if (built === '') return { ok: false, reason: 'mvn 成功但 classpath 文件为空（项目无 compile 依赖？）' };
    return { ok: true, classpath: built };
  } catch (e) {
    return { ok: false, reason: `读不到 mvn 产出的 classpath 文件：${(e as Error).message}` };
  }
}

/**
 * 解析**实际生效的 Maven 本地仓**。
 *
 * ★★ 为什么不直接用 `mavenLocalRepoCandidates()[0]`（实测踩过）：那个清单的第 0 项是
 *   `~/.m2/repository`（Maven **缺省**位置），而本机的真实仓是 `D:\dev_hzy\devkit\m2-repo`
 *   ——它在 **maven 的全局 settings.xml** 里由 `<localRepository>` 声明，那个清单**扫不到**
 *   （`mavenLocalRepoCandidates` 只认 `~/.m2/settings.xml`、`MAVEN_OPTS`、项目逐级 `.m2repo`）。
 *   ⇒ 用清单[0] 会指向一个**不存在**的目录：mvn 于是去那里重新下载整棵依赖树（几百 MB），
 *     而且回执里写的 repo 是错的（读的人以为"本机没有仓"）。
 *
 * 顺序（前面的赢）：
 *   ① `AGENT_IO_M2_REPO`（显式覆盖，最权威 —— 主控裁定三卡共用单仓时就用它）
 *   ② `MAVEN_HOME/conf/settings.xml`（或 `AGENT_IO_MVN_HOME/conf/settings.xml`）的 `<localRepository>`
 *      —— 本机的形态：devkit 的全局 settings.xml 声明了 m2-repo
 *   ③ `mavenLocalRepoCandidates()` 里**真实存在**的第一个候选
 *   ④ 都没有 ⇒ 回 `~/.m2/repository`（Maven 缺省；此时 mvn 会自己下载，行为与不设参数一致）
 */
function resolveMavenRepo(projectRoot: string): string {
  const explicit = process.env.AGENT_IO_M2_REPO?.trim();
  if (explicit) return explicit;

  // ② 全局 settings.xml（★ 这是本机能拿到 m2-repo 的唯一途径）
  for (const mvnHome of [process.env.AGENT_IO_MVN_HOME, mavenHomeFromPath()]) {
    if (!mvnHome) continue;
    try {
      const xml = fs.readFileSync(path.join(mvnHome, 'conf', 'settings.xml'), 'utf8');
      const m = /<localRepository>\s*([^<]+?)\s*<\/localRepository>/.exec(xml);
      if (m) {
        const p = m[1].trim();
        if (p !== '') return p.replace(/\//g, path.sep);
      }
    } catch {
      /* 没有这个 settings.xml ⇒ 下一个 */
    }
  }

  // ③ 候选里第一个**真实存在**的（"存在"才是"能用的仓"；不存在的目录只会让 mvn 去下载）
  for (const c of mavenLocalRepoCandidates(projectRoot)) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      /* 不存在 ⇒ 下一个 */
    }
  }

  // ④ 兜底：Maven 缺省（与不传 -Dmaven.repo.local 等价）
  return path.join(os.homedir(), '.m2', 'repository');
}

/** 从 PATH 里现有的 `mvn` 反推 MAVEN_HOME（找不到返回 null）—— 只为读 `<maven>/conf/settings.xml` */
function mavenHomeFromPath(): string | null {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const target = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  const r = spawnSync(finder, [target], { encoding: 'utf8', timeout: 10_000 });
  const first = String(r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (!first) return null;
  // `<maven>/bin/mvn.cmd` ⇒ `<maven>`
  const bin = path.dirname(first);
  return path.basename(bin).toLowerCase() === 'bin' ? path.dirname(bin) : null;
}

/**
 * 定位 `mvn` 可执行文件。
 * ★ 为什么不能只写 `'mvn.cmd'`：`spawnSync` 在 Windows 上对 `.cmd` **不经 shell 也能跑**，
 *   但它要求文件**真在 PATH 里**；而 agent-io 的 CLI 进程常常是在**没有 maven 的 PATH** 下起的
 *   ⇒ `status=null` + `error`（ENOENT），回执里只剩一句 "exit=null"（实测踩过，完全不可读）。
 * ⇒ 优先用 `AGENT_IO_MVN_HOME` / `MAVEN_HOME` 拼绝对路径，其次才交给 PATH。
 */
function resolveMavenBin(): string {
  const exe = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  for (const home of [process.env.AGENT_IO_MVN_HOME, process.env.MAVEN_HOME]) {
    if (!home) continue;
    const p = path.join(home, 'bin', exe);
    if (fs.existsSync(p)) return p;
  }
  const fromPath = mavenHomeFromPath();
  if (fromPath) {
    const p = path.join(fromPath, 'bin', exe);
    if (fs.existsSync(p)) return p;
  }
  return exe;
}

/** Go 分支（既有行为**逐字保留**）：goAvailable → helperBinary → 全量 DELETE 再插 */
export function fillSemanticFactsGo(db: Database, projectRoot: string): SemanticFactsResult {
  const empty: SemanticFactsResult = {
    ok: false,
    packages: 0,
    files: 0,
    typeErrors: 0,
    fields: 0,
    signatures: 0,
    via: 'none',
  };
  if (!goAvailable()) return { ...empty, reason: 'go 工具链不可用 ⇒ 事实标 syntax-only' };

  const bin = helperBinary(projectRoot);
  if (!bin) return { ...empty, reason: '抽取器构建失败 ⇒ 事实标 syntax-only' };

  let raw: RawOut;
  try {
    const out = execFileSync(bin.file, [...bin.args, projectRoot], {
      cwd: bin.via === 'go-run' ? HELPER_DIR : projectRoot,
      timeout: GO_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GOFLAGS: '-mod=mod', GOPROXY: 'off', GOSUMDB: 'off' },
    });
    raw = JSON.parse(String(out).trim().split('\n').pop() ?? '{}') as RawOut;
  } catch (e) {
    return { ...empty, via: bin.via, reason: `抽取器执行失败：${String((e as Error).message).slice(0, 200)}` };
  }
  if (!raw.ok) return { ...empty, via: bin.via, reason: raw.reason ?? '抽取器返回 ok=false' };

  const insField = db.prepare(
    'INSERT OR REPLACE INTO fields (file, structure, name, ordinal, type, json_tag, embedded) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insSig = db.prepare(
    'INSERT OR REPLACE INTO signatures (file, structure, name, kind, ordinal, param_name, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  let fieldN = 0;
  let sigN = 0;
  db.exec('BEGIN');
  try {
    // ★ **全量刷新**语义事实（fields / signatures / contracts 都是派生数据，一次 import 重算一遍）：
    //   只 INSERT OR REPLACE 会留下**已删除符号的陈旧行**（改名/删字段后越积越多）；
    //   走到这里说明语义层成功，全删再插是安全的（失败路径不会执行到这里，不会把精确事实清空）。
    //   代价：被 build tag 排除的文件其旧行也会消失 —— 这是**正确**的（它们不在本次构建里）。
    // ★★★ 2026-11-05（R11 · v18）：occurrences 表已删 ⇒ 这里不再清它、不再插它（见文件头「已下线的表」）。
    db.exec('DELETE FROM fields');
    db.exec('DELETE FROM signatures');
    db.exec('DELETE FROM contracts');
    for (const f of raw.fields ?? []) {
      insField.run(f.file ?? '', f.structure, f.name, f.ordinal, f.type ?? null, f.jsonTag ?? null, f.embedded ? 1 : 0);
      fieldN++;
    }
    // 签名账：形参与返回值逐位一行（结构体 receiver 的 4 段唯一键 ⇒ 天然幂等）
    for (const fn of raw.funcs ?? []) {
      const recv = fn.recv ?? '';
      (fn.params ?? []).forEach((p, i) => {
        insSig.run(fn.file ?? '', recv, fn.name, 'param', i, p.name ?? null, p.type ?? null);
        sigN++;
      });
      (fn.results ?? []).forEach((t, i) => {
        insSig.run(fn.file ?? '', recv, fn.name, 'result', i, null, t ?? null);
        sigN++;
      });
      // ★★★ 零形参 + 零返回值的函数必须留一行『存在』足迹（kind='decl'）。
      //   否则它**一行都不插** ⇒ 整个签名从库里消失 ⇒ 对拍报 missing-func。
      //   实测踩坑：`func (gw *GraphWriter) Stop()`、`func main()`、`func Vocabulary()` 全都“凭空消失”，
      //   而 gofacts 的 JSON 里明明有（633 个 funcs / 3 个 Stop）⇒ 问题在**落库**不在抽取。
      if ((fn.params ?? []).length === 0 && (fn.results ?? []).length === 0) {
        insSig.run(fn.file ?? '', recv, fn.name, 'decl', 0, null, null);
        sigN++;
      }
    }
    // 接口契约账（方法集 + 实现者）
    const insIface = db.prepare(
      'INSERT OR REPLACE INTO contracts (file, name, methods, impls) VALUES (?, ?, ?, ?)',
    );
    for (const it of raw.ifaces ?? []) {
      insIface.run(it.file ?? '', it.name, JSON.stringify(it.methods ?? []), JSON.stringify(it.impls ?? []));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { ...empty, via: bin.via, reason: `落库失败：${String((e as Error).message).slice(0, 200)}` };
  }

  return {
    ok: true,
    packages: raw.packages,
    files: raw.files,
    typeErrors: raw.typeErrors ?? 0,
    fields: fieldN,
    signatures: sigN,
    via: bin.via,
  };
}
