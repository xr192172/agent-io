/**
 * ★★★ 卡3 子项：**JDK 版本自适应**（Java 语义事实抽取器的 JDK 解析，零第三方依赖）
 *
 * ## 为什么要有这个文件（实测病）
 * `exec_java_tool.ts:29-30` 原来把 `JAVAC` / `JAVA` 写成裸 `'javac.exe'` / `'java.exe'`
 * ⇒ 「用哪个 JDK」由调用者的 PATH 决定，而**代码里没有任何一处知道这件事**。
 * 后果有两面，两面都静默：
 *   · 机器上 PATH 里是 JDK 21 而 `pom.xml` 声明 17 ⇒ 抽出来的其实是 21 的语义，**没人报错**；
 *   · PATH 里根本没有 JDK ⇒ `spawnSync` 抛 ENOENT，回执只写"执行失败"，**不知道是缺 JDK**。
 * ⇒ 所以本文件的一句话职责：**把"该用哪个 JDK"从 PATH 里拿出来，变成一个可判定的、会拒绝的显式决议**。
 *
 * ## 三层语义（与 `semantic_facts.ts` 头注的三层一致：不许越界）
 *   ① 项目声明了 major（`pom.xml` 的 `java.version` / `maven.compiler.*` / compiler 插件的 `source`/`target`/`release`）
 *      ∧ 本机有该 major 的 JDK ⇒ **匹配**，返回它的绝对路径；
 *   ② 项目声明了 ∧ 本机**没有**该 major ⇒ **`ok:false` 并点名"本机有哪些"**，**绝不回落 PATH**；
 *   ③ 项目没声明 ⇒ **`ok:false`**，原因写"未声明"，同样**不回落 PATH**（不猜）。
 *
 * ★ 第 ③ 条为什么也拒绝而不是"没有声明就用 PATH 里那个"：本仓的纪律是
 *   「**不猜**」（`semantic_facts.ts:11` 的三层语义②逐字如此）。PATH 里那个 JDK 是哪一版
 *   是**环境事实**，不是项目事实；用它产出的事实会被读成"项目的事实"⇒ 就是本仓反复治的
 *   「结论不携带前提」。要放宽只能由调用方**显式**传 `jdkHome`（见 `exec_java_tool.ts`）。
 *
 * ## 纯函数与副作用分开（为了让判据有牙）
 * `parsePomJavaVersion` / `pickJdk` / `resolveJdkForProject` 里**前两个是纯函数**
 * （喂字符串 + 数组，比输出），所以册里能用 `behavior-cases` 给它们写输入对拍 ——
 * 而不是只能写「某处出现了某个串」那种发现不了逻辑错的判据。
 * 唯一的副作用函数 `enumerateJdks` / `readEnvManifest` / `writeEnvManifest` 刻意做薄。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 一次 JDK 决议的结果（三态：匹配 / 不匹配 / 没声明 —— 后两者必须能区分，不许混成同一个 false） */
export type JdkResolution =
  | {
      /** 匹配：该 JDK 的绝对根目录（含 bin/java.exe）与 major */
      ok: true;
      jdkHome: string;
      major: number;
      /** 证据：这句解释"为什么是它/为什么是这个 major"，进回执用 */
      why: string;
      /** 项目声明的 major（匹配时必有） */
      declaredBy: string;
    }
  | {
      ok: false;
      /** 机器可读的原因分档（判据与回执都读这一列，不解析人话） */
      reason: 'no-pom' | 'no-java-version-declared' | 'jdk-not-installed' | 'no-candidate-dirs';
      /** 人读解释：必须点名缺什么 / 本机有什么 */
      detail: string;
    };

/** 本机能看到的候选 JDK（`JAVA_HOME` + 枚举到的其它 JDK 根） */
export interface JdkCandidate {
  /** JDK 根目录绝对路径 */
  home: string;
  /** 从 `release` 文件或目录名解析出的 major；解析不出为 null（不算候选） */
  major: number;
}

/**
 * 从 `pom.xml` 文本里解析**项目声明的 Java major**。
 *
 * ★ 为什么用正则而不是 XML 解析器：本仓零第三方依赖是硬约束（`gofacts` 同理），
 *   而这里要取的只有 5 个已知标签的一层文本 ⇒ 用手写解析器是为了 xml 命名空间而引入 800 行，
 *   换来的是"能处理任意 XML"这个本项目**不需要**的能力（0.17① 边界）。
 *
 * ★ 取值优先级（前面的赢）：`java.version` > `maven.compiler.{release,source,target}` >
 *   compiler 插件的 `<release>` > `<source>` > `<target>`。
 *   与 Maven 的实际优先级不完全等同（Maven 是 plugin 覆盖 property），但**差距只在两者都写且冲突时**，
 *   而那种 pom 本身就有歧义；这里选"取更显式的 java.version"并把它写进 `why`，**不静默**。
 *
 * ★ 版本号写法：`17` / `1.8` / `17.0.2` / `21.0.1+12` 都要认；`1.8` 必须归一到 `8`（Maven 的老写法）。
 */
export function parsePomJavaVersion(pomXml: string): { major: number; tag: string } | null {
  const text = String(pomXml ?? '');
  if (text.trim() === '') return null;
  /**
   * ★ 取 `<tag>...</tag>` 的首个出现。`(?:\s[^>]*)?` 允许 `<java.version scope="x">` 这类带属性的写法。
   * ★ `[^<]*` 而不是 `.*`：值里不该有子元素；`.*` 会在跨元素时把两段拼起来（实测坑）。
   */
  const tagValue = (tag: string): string | null => {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</${tag}>`, 'i');
    const m = re.exec(text);
    return m ? m[1] : null;
  };
  /** 归一：`1.8` → 8；`17` / `17.0.2` / `21.0.1+12` → 17 / 21；非数字 ⇒ null */
  const toMajor = (raw: string | null): number | null => {
    if (raw === null) return null;
    const v = raw.trim();
    if (v === '') return null;
    // 老写法 `1.8` / `1.7`：Maven 里这是 major 8 / 7（不是 1）
    const legacy = /^1\.(\d+)(?:[.\-_+].*)?$/.exec(v);
    if (legacy) return Number(legacy[1]);
    const m = /^(\d+)(?:[.\-_+].*)?$/.exec(v);
    return m ? Number(m[1]) : null;
  };

  for (const tag of ['java.version', 'maven.compiler.release', 'maven.compiler.source', 'maven.compiler.target']) {
    const raw = tagValue(tag);
    const major = toMajor(raw);
    if (major !== null) return { major, tag };
  }
  // compiler 插件里的 <release> / <source> / <target>（裸标签名，pom 里常见且不在 properties 里）
  for (const tag of ['release', 'source', 'target']) {
    const raw = tagValue(tag);
    const major = toMajor(raw);
    if (major !== null) return { major, tag: `build.plugins.maven-compiler-plugin#${tag}` };
  }
  return null;
}

/**
 * 在候选 JDK 里挑**恰好匹配** `requiredMajor` 的那个。
 *
 * ★ 为什么不取"最近的版本"：项目声明 17 而本机只有 21 时，用 21 去 type-check 会产出
 *   **另一个语言版本的事实**（`--release 17` 能缓解但 `JavacTask` 的符号集仍按该 JDK 的 rt 来）
 *   ⇒ 那正是本文件头注说的"结论不携带前提"。所以**只接受 major 相等**。
 *
 * ★ 多条同 major（如 17.0.21 与 17.0.9 并存）⇒ 取路径字典序最大者（确定性；同一台机器上结论稳定）。
 *   为什么不用"枚举顺序"：目录枚举顺序由文件系统决定 ⇒ 判据会随机器变（本仓 `ENV_STATE_TOKENS` 的 `readdir` 一条）。
 */
export function pickJdk(
  candidates: readonly JdkCandidate[],
  requiredMajor: number,
): { ok: true; jdkHome: string; major: number } | { ok: false; installed: number[] } {
  // ① 丢掉解析不出 major 的候选（它们不算"本机有"，也不许拿来猜）
  const usable = candidates.filter((c) => Number.isFinite(c.major) && c.major > 0 && String(c.home).trim() !== '');
  const hit = usable.filter((c) => c.major === requiredMajor);
  if (hit.length > 0) {
    const sorted = [...hit].sort((a, b) => (a.home < b.home ? 1 : a.home > b.home ? -1 : 0));
    return { ok: true, jdkHome: sorted[0].home, major: requiredMajor };
  }
  // ② 没匹配：把"本机到底有哪些"原样带出去 —— 让报错可执行
  const installed = [...new Set(usable.map((c) => c.major))].sort((a, b) => a - b);
  return { ok: false, installed };
}

/**
 * 决议：项目根 → 该用哪个 JDK。**唯一的对外入口**（调用方只调它）。
 *
 * ★ `env.json` 的读写为什么住在这里而不是 `exec_java_tool.ts`：
 *   「哪个 JDK 被选定」是**抽取器的事实**，不是执行器的实现细节；`exec_java_tool` 只是消费者。
 *   声明落 `<project>/.agent-io/env.json`（卡裁定：不放 MANIFEST.txt、不放 projects.json）——
 *   那两处分别是"项目清单"与"注册表"，塞环境声明会让它们的语义漂移。
 */
export function resolveJdkForProject(
  projectRoot: string,
  opts: {
    /** 注入的 pom 文本（缺省读 `<root>/pom.xml`）；`null` = 明确"没有 pom" */
    pomXml?: string | null;
    /** 注入的候选 JDK（缺省调 `enumerateJdks()`）；判据用注入，避免依赖本机装了什么 */
    candidates?: readonly JdkCandidate[];
  } = {},
): JdkResolution {
  const pom = opts.pomXml !== undefined ? opts.pomXml : safeRead(path.join(projectRoot, 'pom.xml'));
  if (pom === null || String(pom).trim() === '') {
    return {
      ok: false,
      reason: 'no-pom',
      detail: `项目根没有可读的 pom.xml（${path.join(projectRoot, 'pom.xml')}）⇒ 无从得知该用哪个 JDK；` +
        `**不回落 PATH**（PATH 里的版本是环境事实，不是项目事实）`,
    };
  }
  const declared = parsePomJavaVersion(pom);
  if (declared === null) {
    return {
      ok: false,
      reason: 'no-java-version-declared',
      detail:
        'pom.xml 里没有 java.version / maven.compiler.{release,source,target} / compiler 插件的 source|target|release ⇒ ' +
        '项目没声明语言版本，**不回落 PATH**（猜出来的版本会伪装成项目的事实）',
    };
  }
  const cands = opts.candidates ?? enumerateJdks();
  const pick = pickJdk(cands, declared.major);
  if (!pick.ok) {
    const have = pick.installed.length > 0 ? pick.installed.join(' / ') : '（一个都没枚举到）';
    // 两档必须分开：「一个都没枚举到」= 机器/注入侧的问题；「枚举到了但 major 不对」= 项目与环境不匹配。
    // 混成一个 false ⇒ 读回执的人得靠解析人话才知道该装 JDK 还是该查候选目录。
    const reason: 'jdk-not-installed' | 'no-candidate-dirs' =
      pick.installed.length === 0 ? 'no-candidate-dirs' : 'jdk-not-installed';
    return {
      ok: false,
      reason,
      detail:
        `pom.xml 声明 Java ${declared.major}（读自 <${declared.tag}>），而本机可用的 JDK major 是 ${have} ⇒ ` +
        `**不匹配就不跑**（用别的 major 抽出来的事实不属于这个项目）。` +
        `修法：装一个 JDK ${declared.major}（或改 pom 的声明），**不要**靠调 PATH 顺序掩盖`,
    };
  }
  return {
    ok: true,
    jdkHome: pick.jdkHome,
    major: pick.major,
    why: `pom.xml 声明 Java ${declared.major}（读自 <${declared.tag}>）· 本机命中 ${pick.jdkHome}`,
    declaredBy: declared.tag,
  };
}

/**
 * 候选 JDK 根目录列表（纯函数，可喂假 env/平台对拍）。
 *
 * ★ 2026-11-25（CI-fix C2）：原先硬编码 `D:/dev_hzy/devkit`、`C:/dev_hzy/devkit` 两个
 *   本机私有布局 ⇒ Linux/其它机器上枚举不到任何标准位置。根治为三层：
 *   ① 显式环境 `AGENT_IO_JDK_HOME` / `JAVA_HOME`（最强信号，仍要过 major 校验）；
 *   ② `AGENT_IO_JDK_ROOTS` 补充根（`;` / `:` 分隔，机器私有 devkit 走这里注入，不写死在代码里）；
 *   ③ 按平台枚举标准安装位置。
 *
 * @param env 环境变量（可注入假值）
 * @param platform 进程平台（默认 process.platform）
 */
export function jdkCandidateRoots(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): string[] {
  const roots: string[] = [];
  const push = (r: string | null | undefined): void => {
    const h = String(r ?? '').trim();
    if (h !== '' && !roots.includes(h)) roots.push(h);
  };
  push(env.AGENT_IO_JDK_HOME);
  push(env.JAVA_HOME);
  for (const r of String(env.AGENT_IO_JDK_ROOTS ?? '').split(/[;:]/)) push(r);

  if (platform === 'win32') {
    for (const base of [
      'C:/Program Files/Java',
      'C:/Program Files/Eclipse Adoptium',
      'C:/Program Files/Microsoft',
      'C:/Program Files/Amazon Corretto',
      'C:/Program Files/Zulu',
    ]) push(base);
  } else if (platform === 'darwin') {
    for (const base of [
      '/Library/Java/JavaVirtualMachines',
      '/opt/homebrew/opt/openjdk',
      '/usr/local/opt/openjdk',
    ]) push(base);
  } else {
    // Linux 及其它 POSIX：发行版标准 JDK 根
    for (const base of ['/usr/lib/jvm', '/opt/java/openjdk', '/opt']) push(base);
  }
  return roots;
}

/**
 * 枚举本机可用的 JDK 根。
 *
 * ★ 为什么只看这几个位置而不是全盘找：全盘 `find` 一次要几十秒且会撞权限，
 *   而"本机 JDK 装在哪"由 `jdkCandidateRoots` 按环境变量 + 平台标准位置给出。
 * ★ 顺序不是优先级（真正挑谁由 `pickJdk` 的 major 相等 + 字典序决定）：
 *   这里只负责"把候选凑齐"，凑不齐时 `resolveJdkForProject` 会报 `no-candidate-dirs`。
 * ★ 副作用薄到可以一眼看完：读 `JAVA_HOME`、扫候选根下名为 `jdk*`/`java*` 的子目录。
 */
export function enumerateJdks(env: Record<string, string | undefined> = process.env): JdkCandidate[] {
  const out: JdkCandidate[] = [];
  const push = (home: string | null | undefined): void => {
    if (!home) return;
    const h = String(home).trim();
    if (h === '') return;
    const major = readJdkMajorAt(h);
    if (major === null) return;
    if (out.some((c) => c.home === h)) return;
    out.push({ home: h, major });
  };
  for (const root of jdkCandidateRoots(env)) {
    // 根本身可能就是 JDK home（release 文件在根下）；再向下扫一层 `jdk*`/`java*` 子目录
    push(root);
    for (const sub of safeReaddir(root)) {
      if (!/^(jdk|java)/i.test(sub)) continue;
      const subPath = path.join(root, sub);
      push(subPath);
      for (const inner of safeReaddir(subPath)) push(path.join(subPath, inner));
    }
  }
  return out;
}

/**
 * 读一个 JDK 根的真实 major。
 *
 * ★ 为什么读 `release` 文件而不是跑 `java -version`：跑子进程解析英文输出是脆的
 *   （本机实测 `java -version` 的输出在 PowerShell 里走 stderr + 中文 locale 乱码），
 *   而 `<JDK>/release` 是 JDK 自带的 key=value 文本，`JAVA_VERSION="17.0.21"` 一行就够。
 *   判据侧也因此不需要 JDK 在场就能验。
 */
export function readJdkMajorAt(jdkHome: string): number | null {
  const rel = safeRead(path.join(jdkHome, 'release'));
  if (rel !== null) {
    const m = /^\s*JAVA_VERSION\s*=\s*"([^"]+)"/m.exec(rel);
    if (m) {
      const v = m[1].trim();
      const legacy = /^1\.(\d+)/.exec(v);
      if (legacy) return Number(legacy[1]);
      const mm = /^(\d+)/.exec(v);
      if (mm) return Number(mm[1]);
    }
  }
  // ② 回落目录名（`jdk-17.0.21+9` / `jdk1.8.0_301`）：只在 release 读不到时用
  const base = path.basename(String(jdkHome));
  const legacy = /^jdk1\.(\d+)/i.exec(base);
  if (legacy) return Number(legacy[1]);
  const m = /^jdk-?(\d+)/i.exec(base);
  return m ? Number(m[1]) : null;
}

/** `<project>/.agent-io/env.json` 的形状（只增不改既有语义：新消费者要加列就在这里加，别另起文件） */
export interface EnvManifest {
  /** 谁写的（工具名 + 卡 id，便于追责） */
  written_by: string;
  written_at: string;
  java?: {
    /** pom 声明的 major */
    declared_major: number;
    declared_by: string;
    /** 实际选定的 JDK 根；`null` = 没选出来（见 reason） */
    jdk_home: string | null;
    /** 没选出来时的原因分档 */
    reason?: string;
  };
}

/** 读 env.json（不存在 / 坏 JSON ⇒ null，**不抛**：它是缓存性质，坏了应当重建而不是让导入失败） */
export function readEnvManifest(projectRoot: string): EnvManifest | null {
  const p = envManifestPath(projectRoot);
  const raw = safeRead(p);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as EnvManifest;
  } catch {
    return null;
  }
}

/** env.json 的**唯一**路径口径（别处不许再拼 `.agent-io/env.json`） */
export function envManifestPath(projectRoot: string): string {
  return path.join(projectRoot, '.agent-io', 'env.json');
}

/** 写 env.json（目录不存在就建；写失败抛 —— 环境声明写不上必须响亮，不许静默） */
export function writeEnvManifest(projectRoot: string, m: EnvManifest): string {
  const p = envManifestPath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
  return p;
}

// ── 副作用原语（薄到不用判） ────────────────────────────────────────────

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function safeReaddir(p: string): string[] {
  try {
    return fs.readdirSync(p).sort();
  } catch {
    return [];
  }
}
