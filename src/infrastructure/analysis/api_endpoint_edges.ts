/**
 * 跨语言 API↔调用 影响边 + 索引期对账（card: api-edges）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ★ 消费者钉死 = **建边时立即对账**（学 mapper_reconcile）：本模块在
 *   `import_project` 建图收尾处、**仅 `include_api_edges === true`** 时调用
 *   （默认 false ⇒ 不改变既有行为；分步建索引 `staged:true` 时**不跑**——节点 id 还没建出来，
 *   跑了只会把"还没解析"说成"全孤儿"）。
 *
 * 边形状：edges(kind='api_endpoint', metadata=JSON)
 *   source = 后端 Controller 方法节点 id（`<java 相对路径>#<Class>.<method>`）
 *   target = 前端 api 函数节点 id（`<js 相对路径>#<fn>`）
 *   metadata = { url, method, controller, api_function }
 *
 * ★★ 缓存里**没有 URL 数据** —— 端点与 url 一律**扫源文件**正则提取，db 只用来
 *   「把某个已解析的符号换成节点 id」。**不许**去 `nodes` 里猜 url。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ★★★ 口径（写死，别重新解释）
 *
 * 【后端端点】扫 `*Controller*.java` 全文，认 5 种注解：
 *   `@RequestMapping` / `@GetMapping` / `@PostMapping` / `@PutMapping` / `@DeleteMapping`。
 *   真语料（fuintBackend 实测 111 个 `*Controller*.java`）：**别名注解 0 处**，
 *   全部是 `@RequestMapping(value = "…", method = RequestMethod.GET|POST)`（类级 110 + 方法级 424）。
 *   ⇒ 别名必须认（测试覆盖），但真项目的主路径是 `method = RequestMethod.X`。
 *
 * 【base / method 归属 = 向上回溯，不是「首个 @RequestMapping」】
 *   病史：base 若按「该文件第一个 @RequestMapping」判，遇到**两个类级 mapping**
 *   （合法 Java：非完全限定名，`package foo; class X { @RequestMapping(...) } class Y { @RequestMapping(...) }`）
 *   就会把第二个类级注解当 base。⇒ 规则：
 *     · 方法级 = 注解串里含 `method =`，或注解是 Get/Post/Put/DeleteMapping；
 *     · 对每个方法级候选，从它的行**向上回溯**：
 *         - 净花括号（`{` 计数 − `}` 计数）< 0 ⇒ 已越过类体起点，断链；
 *         - 行首是 `class|interface|enum` 声明 ⇒ 这是宿主类型，取**它自己的**类级 mapping 作 base；
 *           找不到 ⇒ base = ''（不猜、不回落到外层——见下「内部类」）。
 *     · 方法归属锚 = `nodes(kind='method')` 的 `start_line`（确定性，不靠缩进猜）。
 *   **嵌套内部类**：内层类自己的类级 mapping 优先（Spring 语义：内层 mapping 不继承外层），
 *   内层没有则 base = ''（**不继承外层**）。测试用双层类夹具覆盖这一点。
 *
 * 【方法路径拼接】
 *   方法路径**可以不以 `/` 开头** —— 实测 `/backendApi/refund` 下 `value = "save"` / `"doRefund"`，
 *   硬拼会得到假端点 `/backendApi/refundsave`。⇒ `segJoin(base, p) = trimEnd(base,'/') + (p 以 / 开头 ? p : '/'+p)`；
 *   `p` 为空（类级 `@RequestMapping("/x")` 本身也可能是端点）⇒ 端点 = base。
 *
 * 【前端 url】扫 `<项目>/…/src/api/**\/*.js`，认 `url: '<字面量>'`（可跟在 `return request({` 里）。
 *   · 实测形态：单引号 302/302、双引号 0、反引号 0、**拼接（`'…' + id`）77 处**、查询串 1 处；
 *   · `method:` 取**同一个 `request({…})` 对象里**的那一个（同一文件/行窗口内首次命中）；
 *   · 函数归属锚 = `nodes(kind='function')` 中 `start_line <= 该 url 行` 的**最近一个**。
 *
 * 【URL 归一 norm(u)】（这是本卡**唯一**的归一，别在别处再写一份）
 *   ① 去 `?` 之后、`#` 之后；② 不以 `/` 开头则补一个；③ `/` 折叠成一个；④ 末尾 `/` 去掉（根 `/` 除外）；
 *   ⑤ **大小写不折叠**（实测 279 条含大写字母；折叠会把两个真实不同的端点混成一个 —— 宁可漏配不可错配）。
 *   ★ 前端 77 条拼接 url 按**字面**参与匹配（`'…/info/' + id` 归一后是 `…/info`，不影响）；
 *     拼接产生的**尾部变量**不猜、不求值。
 *
 * 【匹配（★ 顺序即判据：精确优先于模板；逐条如实分类，不合并）】
 *   · **精确相等**：`norm(segJoin(base, path)) === norm(url)` 且 HTTP 方法一致 ⇒ **建边**。
 *   · **参数模板**（T-#API-PARAM-EDGES，2026-11-19 修）：精确落空后，端点路径含 `{x}` 的按
 *     `matchParamTemplate` **三重约束**匹配 ⇒ **建边**，metadata 多带
 *     `param_template: true` + `params`（参数名清单）+ `param_values`（读数，边**不绑定值**）。
 *     ★ 口径：**边是结构性的**（这个 api 函数调这个端点模板），参数值属运行时 ⇒ 不求值、不猜；
 *       所以"同名不同值"（`/info/{id}` 被 `'…/info/'+orderId` 调）**不是歧义**。
 *     ★ 同一 url 对上 **>1 个**模板 ⇒ `ambiguous`（不建边，不挑第一个）。
 *     ★ 真语料反例（为什么约束里必须有"段数相等"）：`backendApi/refund/delete/' + refundId`
 *       后端根本没有 `delete` 端点 ⇒ 若 `{x}` 能跨段通配，它会被别的模板吞掉、真孤儿消失。
 *   · **最长前缀但还有残余段** ⇒ `ambiguous`（不建边；"prefix" 不是证据）。
 *   · **都没命中** ⇒ `frontendOrphan`（逐条点名 url + 文件）。
 *   HTTP 方法不一致单独记 `methodMismatch`（同样不建边 —— 路径对、方法错不是"调得到"）。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ★★ 旧口径作废（免得下一个人再困惑）
 *   侦察阶段曾报「270/270 URL 最长前缀命中」。那是 **fuintAdmin 单仓 302 条 url** 的样本集；
 *   本模块覆盖 **fuintAdmin + fuintCashierWeb 两者 = 383 条**（CashierWeb 81 条另有 74 条 backendApi）。
 *   同一批真语料的**新读数**（口径见上）：端点 424 · url 383 · 精确相等 243 ·
 *   参数模板 0（后端 69 个参数端点在前端全是拼接，字面上对不上）· 最长前缀 0 ·
 *   无命中 140（其中 `/system/config|dict|notice` = 25 条 / 17 种 url，是真孤儿：后端无 @RequestMapping base，
 *   只在 `ClientUserInterceptor` / `WebConfig` 的字符串里）。
 *   ⇒ 别再拿 270/270 当基线。
 *
 * ★ 打断即红：砍 `import_project` 里的调用 ⇒ 边消失 + 读数消失；破坏 norm ⇒ 带前导斜杠/尾斜杠/查询串/
 *   拼接的 url 全部掉进孤儿；砍孤儿上报 ⇒ 真孤儿一个字都不出现；
 *   砍模板匹配分支 ⇒ 带 `{x}` 的端点一条边都不建；把"段数相等"放宽成跨段通配 ⇒ 真孤儿被吞（反例红）。
 * ═══════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';

import type { Database } from '../index/db.js';

export interface ApiReconcileResult {
  /** 建成的 api_endpoint 边数 */
  edges: number;
  /** 后端端点总数（分母） */
  endpoints: number;
  /** 前端 url 总数（分母） */
  urls: number;
  /** 精确相等 + 方法一致（= 建边的条数；理论等于 edges，nodeMissing>0 时会少） */
  matched: number;
  /** 端点没有对应的前端调用（逐条点名，最多 50 条 + 总数在 truncated 里说明） */
  backendNoApi: string[];
  /** 前端 url 找不到任何端点前缀（逐条点名） */
  frontendOrphan: string[];
  /** 命中多个端点 / 最长前缀但仍有余段 —— 不假装精确 */
  ambiguous: string[];
  /**
   * ★ T-#API-PARAM-EDGES 修好后的语义：**模板匹配之后仍没对上的残余**（逐条点名）。
   * 历史：修之前这里是"只计数不建边"的参数端点（真语料 69 条）；
   * 现在模板整段对得上就**建边**，这里只剩"被截断在段边界 / 无模板可对"的那种。
   * 歧义（同一 url 对上 >1 个模板）与节点缺失**不塞进这里**，各归 ambiguous / nodeMissing。
   */
  paramPathUnmatched: string[];
  /** 靠**参数模板**建成的边数（读数，不参与判定；精确匹配见 matched - paramEdges） */
  paramEdges: number;
  /** 路径对得上但 HTTP 方法不一致（不建边） */
  methodMismatch: string[];
  /** 带拼接表达式（`'…' + expr`）的前端 url 条数（信息类读数，不参与判定） */
  concatUrls: number;
  /** 两边符号节点 id 都没找到、因而**没建成边**的条数（诚实：读 matched 与 edges 的差） */
  nodeMissing: number;
  /** 扫到的 Controller 文件里**一个端点都没提取出来**的（多半是正则没覆盖到，必须响亮） */
  controllersWithoutEndpoints: string[];
  /** backendNoApi 是否被截断（true = 只写了前 50 条） */
  backendNoApiTruncated: boolean;
}

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  start_line: number;
  parent: string | null;
}

/** 后端端点（扫源文件得到；nodeId 之后按 (file_path,start_line) 回填） */
interface Endpoint {
  fileRel: string;
  /** 类级 mapping 的路径（可能为空串） */
  base: string;
  /** 方法级 mapping 的路径 */
  path: string;
  /** 类级 mapping 出现在第几行（1-based；-1 = 无类级 mapping） */
  baseLine: number;
  /** 宿主类型名（class/interface/enum 声明里那个标识符） */
  typeName: string;
  /** 方法级 mapping 注解所在行（1-based） */
  annLine: number;
  /** 方法名（由注释树里最近的 method 节点回填；回填不到为空） */
  methodName: string;
  /** 方法节点 start_line（1-based；回填不到为 -1） */
  methodLine: number;
  /** 节点 id（回填不到为空） */
  nodeId: string;
  /** 允许的 HTTP 方法（大写） */
  verbs: string[];
  /** 拼接后的完整路径（未归一） */
  full: string;
}

/** 前端 url 调用点（扫源文件得到） */
interface FrontCall {
  fileRel: string;
  url: string;
  method: string;
  /** url 所在行（1-based） */
  line: number;
  /** 拼接表达式？ */
  concat: boolean;
  /** 所在导出函数名 */
  fnName: string;
  /** 函数节点 id（回填不到为空） */
  nodeId: string;
}

/**
 * ★ 唯一归一（见文件头：【URL 归一】）。任何地方都不许再写第二个。
 */
export function normApiUrl(u: string): string {
  let s = u.trim();
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  const h = s.indexOf('#');
  if (h >= 0) s = s.slice(0, h);
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

/** 方法路径可能不以 `/` 开头（实测 `value = "save"`）—— 拼接的唯一出处 */
export function segJoin(base: string, p: string): string {
  const b = base.replace(/\/+$/, '');
  if (!p) return b || '/';
  return p.startsWith('/') ? `${b}${p}` : `${b}/${p}`;
}

/** `{x}` 段（后端路径参数的唯一判定；别在别处再写一份） */
const PARAM_SEG_RE = /^\{([^}]+)\}$/;

export interface ParamTemplateHit {
  /** 模板里的参数名，按出现顺序 */
  params: string[];
  /** url 侧对上各参数名的段（**只作读数**：边不绑定值，见文件头【匹配】） */
  values: string[];
}

/**
 * 参数模板匹配（T-#API-PARAM-EDGES 的唯一判定处）。
 *
 * ★ 边是**结构性**的（这个 api 函数调这个端点模板），参数值属运行时 ⇒ 这里**只判形状、不求值**。
 * 三重约束，缺一不可（每一条都对应一条 mutation 的牙）：
 *   ① **段数相等**：`{x}` 只匹配**恰好一段**（放宽成 `.+` ⇒ 跨段通配 ⇒ 会把真孤儿吞掉，
 *      真语料反例 = `backendApi/refund/delete/' + refundId` 后端根本没有 `delete` 端点）；
 *   ② **字面段逐字相等**（大小写不折叠，与 normApiUrl 口径一致；前缀相等不算相等）；
 *   ③ `{x}` 段对应的 url 段必须**非空**且自身不是 `{…}`；
 * 且模板里**至少有一个** `{x}` 段 —— 纯字面相等是精确匹配的事，这里不重复判。
 *
 * @returns null = 不匹配；否则是命中的参数名清单
 */
export function matchParamTemplate(
  endpointNorm: string,
  urlNorm: string,
  /** 只有真实 concat 调用才允许字面部分省略末尾参数段；安全默认是不允许。 */
  allowMissingTail = false,
): ParamTemplateHit | null {
  const ep = endpointNorm.split('/');
  const u = urlNorm.split('/');
  // ★★ 本卡第二轮真跑撞的（模板匹配一条都建不出来）：**归一后 url 与模板段数不等**。
  //   真语料 `'backendApi/order/info/' + orderId` 的字面部分归一后是 `/backendApi/order/info`
  //   （3 段）而模板是 `/backendApi/order/info/{orderId}`（4 段）—— 少的那段正是拼接进去的那个参数。
  //   ⇒ 匹配前先把模板**对末尾连续的 `{x}` 段**从比较里去掉（只允许在**末尾**，不猜中间：
  //     中间缺段要判"后面几段分别是谁"，那就是猜了）。
  let epEnd = ep.length;
  const tailParams: string[] = [];
  while (epEnd > 1 && PARAM_SEG_RE.test(ep[epEnd - 1])) {
    tailParams.unshift(PARAM_SEG_RE.exec(ep[epEnd - 1])![1]);
    epEnd--;
  }
  // ★ 病史（本卡第二轮真跑撞的两次，别改回去）：
  //   ① 先写成「去掉末尾 `{x}` 段再比段数」⇒ `/order/{id}` 也会吃下 `/order/info/{id}` 的调用（过宽）；
  //   ② 再写成「按模板长度比」⇒ url 比模板**长**时也放行 ⇒ `/order/{id}` 吃下 `/order/{id}/list`（过宽）。
  //   现在的判据：**url 的段数只有两种合法值** —— `ep.length`（参数值在字面量里，如 `'…/info/42'`）
  //   或 `epEnd`（末尾参数是拼接上去的，字面量里没写，如 `'…/info/' + orderId`）；
  //   任何其它段数（多一段 / 少一段但缺的不是**末尾参数**）⇒ 不匹配。
  const missingTail = u.length === epEnd && epEnd !== ep.length;
  // 缺尾段不是通用通配：它只描述 `'…/info/' + id` 的字面部分。纯字面 `/info` 没有运行时参数证据。
  if (missingTail && !allowMissingTail) return null;
  if (u.length !== ep.length && u.length !== epEnd) return null; // ① 段数相等
  // ★ 逐段比的终点 = **url 的段数**（不是 epEnd！）：
  //   · 等长情形（u.length === ep.length）⇒ 比全部模板段，**末尾 `{x}` 段也要比**；
  //   · 末尾参数段缺的情形（u.length === epEnd）⇒ 只比到缺的那几段之前（缺的段记名不计值）。
  //   ★ 病史（第三次）：写成 `Math.min(epEnd, u.length)` ⇒ 等长时**末尾 `{x}` 段被整个跳过** ⇒
  //     `/order/{id}` 永远不命中 `/order/detail`（⑩ 的模板腿一条都建不出来）；且漏建的参数名
  //     让 `params` 变空 ⇒ 连"是不是模板边"都判不准。终点只能是 `u.length`。
  const params: string[] = [];
  const values: string[] = [];
  for (let i = 0; i < u.length; i++) {
    const m = PARAM_SEG_RE.exec(ep[i]);
    if (m) {
      const seg = u[i];
      if (seg === '' || PARAM_SEG_RE.test(seg)) return null; // ③ 非空、且不是另一个占位符
      params.push(m[1]);
      values.push(seg);
      continue;
    }
    if (ep[i] !== u[i]) return null; // ② 字面段逐字相等
  }
  if (missingTail) {
    // 末尾参数段在 url 里**没写出来**（那是拼接上去的，如 `'…/info/' + orderId`）⇒ 记名不计值
    for (const name of tailParams) {
      params.push(name);
      values.push('');
    }
  }
  return params.length > 0 ? { params, values } : null;
}

const MAPPING_ALIAS_VERB: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
};

/** 从注解参数串里抽出字符串字面量（第一个 `"…"`） */
function firstStringLiteral(args: string): string | null {
  const m = /"([^"]*)"/.exec(args);
  return m ? m[1] : null;
}

/** 从注解参数串里抽 HTTP 方法（`method = RequestMethod.X` 或 `{RequestMethod.A, RequestMethod.B}`） */
function verbsOf(annName: string, args: string): string[] {
  const alias = MAPPING_ALIAS_VERB[annName];
  if (alias) return [alias];
  const out: string[] = [];
  for (const m of args.matchAll(/RequestMethod\.([A-Za-z]+)/g)) {
    const v = m[1].toUpperCase();
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** 行是否"净开括号为负"（类体起点已越过）—— 只数花括号，去掉字符串字面量避免 `"{"` 干扰 */
function braceDelta(line: string): number {
  const cleaned = line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/, '');
  let d = 0;
  for (const ch of cleaned) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
  }
  return d;
}

/** 类声明行 → 类型名 */
function typeNameOf(line: string): string | null {
  const m = /^\s*(?:(?:public|private|protected|static|final|abstract|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/.exec(line);
  return m ? m[1] : null;
}

/** 走查：只收真正要用的两类文件（不重扫整棵树，也不碰 SKIP_DIR 之外的噪音） */
function walkApiSources(projectRoot: string): { controllers: string[]; apiJs: string[] } {
  const controllers: string[] = [];
  const apiJs: string[] = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'out', 'vendor', '.agent-io']);
  const stack: string[] = [projectRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile()) {
        const rel = path.posix.join(...path.relative(projectRoot, full).split(path.sep));
        if (rel.endsWith('.java') && /Controller[^/]*\.java$/.test(rel)) controllers.push(rel);
        // 前端 api 层：`…/src/api/**/*.js`（fuintAdmin 55 + fuintCashierWeb 14，实测）
        else if (/\.js$/.test(rel) && /(^|\/)src\/api\//.test(rel)) apiJs.push(rel);
      }
    }
  }
  controllers.sort();
  apiJs.sort();
  return { controllers, apiJs };
}

/**
 * 注解行之后**第一个方法签名行**（1-based）：跳过其它注解行、`@Xxx(...)`、空行、注释；
 * 第一个既不是注解也不是空行/注释的行 = 签名行（`public ResponseObject list(...)`）。
 * 算不出来回 -1（调用方兜底）。
 */
function findSignatureLine(lines: string[], annLine: number): number {
  for (let i = annLine; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    if (t.startsWith('@')) continue;
    return i + 1;
  }
  return -1;
}

/** 扫一个 Controller 源文件 → 端点清单（带 base/方法归属的向上回溯） */
function extractEndpoints(fileRel: string, src: string): Endpoint[] {
  const lines = src.split(/\r?\n/);
  interface Ann {
    line: number; // 1-based
    name: string;
    args: string;
    isMethodLevel: boolean;
    p: string;
    verbs: string[];
  }
  const anns: Ann[] = [];
  const RE = /@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping)\s*\(([^)]*)\)/g;
  for (let i = 0; i < lines.length; i++) {
    RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(lines[i])) !== null) {
      const name = m[1];
      const args = m[2];
      const p = firstStringLiteral(args);
      if (p === null) continue; // 无字符串参数（如 `@RequestMapping(method=…)`）—— 不是路径
      const verbs = verbsOf(name, args);
      const isMethodLevel = name !== 'RequestMapping' || /\bmethod\s*=/.test(args);
      anns.push({ line: i + 1, name, args, isMethodLevel, p, verbs });
    }
  }
  if (anns.length === 0) return [];

  // 类体结构：类型声明的行号（供回溯定宿主）
  const typeLines: Array<{ line: number; name: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const t = typeNameOf(lines[i]);
    if (t) typeLines.push({ line: i + 1, name: t });
  }

  const out: Endpoint[] = [];
  for (const a of anns) {
    if (!a.isMethodLevel) continue;
    // ★ 向上回溯：净花括号 < 0 断链；首个 class/interface/enum 行 = 宿主类型（最内层）
    let hostName = '';
    let hostLine = 0;
    let depth = 0;
    // 内层类自己的类级 mapping 优先（Spring：内层 mapping 不继承外层）
    let innerBase = '';
    let innerBaseLine = -1;
    for (let j = a.line - 2; j >= 0; j--) {
      // ★★ 顺序是判据：先把**这一行里的**类级注解收下，再问它是不是类型声明行。
      //   病史（本卡第一版真跑撞的）：先判 `if (depth < 0) break;` 再收注解 ⇒
      //   类声明行（`public class X {`）净 +1 不会触发 break，但**紧邻其上的** `@RequestMapping(...)`
      //   在到达之前就已经被「净花括号 < 0」断掉了 —— 因为类声明行**之前**那行若是上一段的 `}`，
      //   depth 变负先 break ⇒ base 永远取不到 ⇒ 424 个端点全部落成 `/list` 这种裸路径。
      //   ⇒ 现在是「先收本行注解 → 再判断链」。
      for (const cand of anns) {
        if (cand.isMethodLevel) continue;
        if (cand.line !== j + 1) continue;
        if (innerBaseLine < 0) {
          innerBaseLine = cand.line;
          innerBase = cand.p;
        }
      }
      // ★★ 断链判据 = **宿主类型的开括号**：`depth < 0` 意味着已经退到某个 `{` 作用域之外
      //   ⇒ 那一行的 `{` 属于宿主类型（真语料实测：第 2 个方法的上一个 `}` 会把 depth 打负，
      //   而它在到达 `public class X {` 之前就 break ⇒ 只有**第一个**方法能拿到 base）。
      //   收下本行注解之后再判，所以内层类自己的类级 mapping 仍然收得到。
      if (depth < 0) break;
      const t = typeNameOf(lines[j]);
      if (t) {
        hostName = t;
        hostLine = j + 1;
        break;
      }
      // 净花括号为负 ⇒ 本行的 `{` 就是（已越过的那个）类型体的开括号，不必再判类型名
      if (depth + braceDelta(lines[j]) < 0) {
        hostLine = j + 1;
        break;
      }
      depth += braceDelta(lines[j]);
    }
    // base = 内层类自己的类级 mapping；内层没有 ⇒ 看宿主类型行**之上**最近的类级注解
    //   （真语料 = 单个顶层类，注解紧贴类型行；这一支同时兜住"注解与类型之间隔了 @Tag/@CrossOrigin"）
    let base = innerBase;
    let baseLine = innerBaseLine;
    if (hostLine > 0 && baseLine < 0) {
      for (const cand of anns) {
        if (cand.isMethodLevel) continue;
        if (cand.line >= hostLine) continue;
        if (cand.line > baseLine) {
          baseLine = cand.line;
          base = cand.p;
        }
      }
    }
    out.push({
      fileRel,
      base,
      path: a.p,
      baseLine,
      typeName: hostName,
      annLine: a.line,
      methodName: '',
      methodLine: -1,
      nodeId: '',
      verbs: a.verbs,
      full: normApiUrl(segJoin(base, a.p)),
    });
  }
  return out;
}

/** 扫一个前端 api js → url 调用点清单 */
function extractFrontCalls(fileRel: string, src: string): FrontCall[] {
  const lines = src.split(/\r?\n/);
  const out: FrontCall[] = [];
  // `request({ … })` 对象体：从 url 行向上找最近的 `request(` 开括号，向下找收尾 `})`
  for (let i = 0; i < lines.length; i++) {
    const m = /url:\s*'([^']*)'/.exec(lines[i]);
    if (!m) continue;
    const url = m[1];
    // 拼接？同一行内 `url: '<…>' + …`，或跨行（下一行以 `+` 起头）
    const concat = /url:\s*'[^']*'\s*\+/.test(lines[i]) || /^\s*\+/.test(lines[i + 1] ?? '');
    // HTTP 方法：同一个 request({…}) 对象里的 method
    let method = '';
    let start = i;
    for (let j = i; j >= 0 && j >= i - 6; j--) {
      if (/request\s*\(\s*\{/.test(lines[j]) || /\{\s*$/.test(lines[j])) {
        start = j;
        break;
      }
      start = j;
    }
    let end = i;
    for (let j = i; j < lines.length && j <= i + 8; j++) {
      end = j;
      if (/^\s*\}\)/.test(lines[j]) || /\}\)\s*$/.test(lines[j])) break;
    }
    for (let j = start; j <= end; j++) {
      const mm = /method:\s*'([A-Za-z]+)'/.exec(lines[j]);
      if (mm) {
        method = mm[1].toUpperCase();
        break;
      }
    }
    out.push({ fileRel, url, method, line: i + 1, concat, fnName: '', nodeId: '' });
  }
  return out;
}

/** 把一个节点文件名 path/relPath 两套写法都试一遍（nodes.file_path 存的是相对 posix 路径） */
function nodesOfFile(allNodes: NodeRow[], rel: string): NodeRow[] {
  return allNodes.filter((n) => n.file_path === rel || n.file_path.endsWith(`/${rel}`));
}

/**
 * 对账 + 建边。幂等：先删旧的 `api_endpoint` 边再按当前索引重建（与 mapper_reconcile 同款）。
 *
 * @param db 项目 cache.db（**只用来把已解析符号换成节点 id**；URL/端点一律扫源文件）
 * @param projectRoot 项目根（绝对路径）
 */
export function reconcileApiEndpoints(db: Database, projectRoot: string): ApiReconcileResult {
  const result: ApiReconcileResult = {
    edges: 0,
    endpoints: 0,
    urls: 0,
    matched: 0,
    backendNoApi: [],
    frontendOrphan: [],
    ambiguous: [],
    paramPathUnmatched: [],
    paramEdges: 0,
    methodMismatch: [],
    concatUrls: 0,
    nodeMissing: 0,
    controllersWithoutEndpoints: [],
    backendNoApiTruncated: false,
  };

  const { controllers, apiJs } = walkApiSources(projectRoot);

  // 1. 端点（扫源文件）
  const endpoints: Endpoint[] = [];
  /** 每个端点的源文件行（判"注解下面第一个签名行"要原文；只存 Controller，量级 111 文件） */
  const srcLinesByFile = new Map<string, string[]>();
  for (const rel of controllers) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(projectRoot, ...rel.split('/')), 'utf8');
    } catch {
      result.controllersWithoutEndpoints.push(`${rel}（读不出来）`);
      continue;
    }
    srcLinesByFile.set(rel, src.split(/\r?\n/));
    const eps = extractEndpoints(rel, src);
    if (eps.length === 0) result.controllersWithoutEndpoints.push(rel);
    endpoints.push(...eps);
  }
  result.endpoints = endpoints.length;

  // 2. 前端 url（扫源文件）
  const calls: FrontCall[] = [];
  for (const rel of apiJs) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(projectRoot, ...rel.split('/')), 'utf8');
    } catch {
      continue;
    }
    calls.push(...extractFrontCalls(rel, src));
  }
  result.urls = calls.length;
  result.concatUrls = calls.filter((c) => c.concat).length;

  // 3. 节点 id 回填（唯一用途：把已解析符号换成 id；查不到就如实记 nodeMissing）
  const allNodes = db
    .prepare("SELECT id, kind, name, qualified_name, file_path, start_line, parent FROM nodes WHERE kind IN ('method','function','class','interface','type')")
    .all() as unknown as NodeRow[];

  const byFile = new Map<string, NodeRow[]>();
  for (const rel of new Set<string>([...controllers, ...apiJs])) byFile.set(rel, nodesOfFile(allNodes, rel));

  for (const ep of endpoints) {
    const fileNodes = byFile.get(ep.fileRel) ?? [];
    const methods = fileNodes.filter((n) => n.kind === 'method');
    // ★★ 方法归属锚 = 注解**下面第一个方法签名行**对应的 method 节点。
    //   病史（本卡真跑撞的）：直接用「注解行之下最近的 method 节点」⇒ 注解与签名行之间夹着
    //   `@PreAuthorize(...)` 等注解时，`nodes.method.start_line` 落在签名行 ⇒ 取到的是**下一个**方法
    //   （实测 241 条边里 controller 名字全部错位一格：`BackendArticleController.updateStatus`
    //    对应的是 `getArticleList`）。⇒ 先算注解之后第一个签名行，再按 start_line **精确**配。
    const sigLine = findSignatureLine(srcLinesByFile.get(ep.fileRel) ?? [], ep.annLine);
    // ★ tree-sitter-java 的方法 `start_line` 会**比签名行早一行**（实测 `list @57` 而签名在 58，
    //   锚点是签名的**前一个** token 行）⇒ 不能用 `=== sigLine` 等值配，要用「签名行之前最近的
    //   那个 method 节点」：`start_line <= sigLine` 里最大的。
    let best: NodeRow | null = null;
    if (sigLine > 0) {
      for (const n of methods) {
        if (n.start_line > sigLine) continue;
        if (!best || n.start_line > best.start_line) best = n;
      }
    }
    if (!best) {
      // 兜底：签名行算不出来（跨行签名等）⇒ 取「注解行之后、start_line 最小」的那个
      for (const n of methods) {
        if (n.start_line < ep.annLine) continue;
        if (!best || n.start_line < best.start_line) best = n;
      }
    }
    if (best) {
      ep.methodName = best.name;
      ep.methodLine = best.start_line;
      ep.nodeId = best.id;
      if (!ep.typeName) ep.typeName = best.parent ?? best.qualified_name.split('.')[0] ?? '';
    }
  }
  for (const c of calls) {
    const fileNodes = byFile.get(c.fileRel) ?? [];
    const fns = fileNodes.filter((n) => n.kind === 'function').sort((a, b) => a.start_line - b.start_line);
    let best: NodeRow | null = null;
    for (const n of fns) {
      if (n.start_line > c.line) break;
      best = n;
    }
    if (best) {
      c.fnName = best.name;
      c.nodeId = best.id;
    }
  }

  // 4. 匹配（精确 → 参数模板 → 字面前缀 → 无；★ 顺序即判据：精确优先）
  const paramEndpoints = endpoints.filter((e) => /\{[^}]+\}/.test(e.path));
  const matchedEps = new Set<Endpoint>();
  const paramHitEps = new Set<Endpoint>();
  const ambiguousEps = new Set<Endpoint>();
  const builtPairs = new Set<string>();
  /** 靠参数模板建成/命中过的边数（读数，不参与判定） */
  let paramEdges = 0;

  // 清理旧边（幂等）
  db.prepare("DELETE FROM edges WHERE kind = 'api_endpoint'").run();
  const insEdge = db.prepare(
    "INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, 'api_endpoint', $ln, NULL, $md)",
  );

  for (const c of calls) {
    const u = normApiUrl(c.url);
    const exactNoVerb = endpoints.filter((e) => e.full === u);
    const exact = exactNoVerb.filter((e) => e.verbs.length === 0 || e.verbs.includes(c.method));
    // ★★ 参数模板（T-#API-PARAM-EDGES）：**结构性建边**，不猜值。
    //   约束全在 matchParamTemplate 里（段数相等 + 字面逐段相等 + {x} 非空 + 至少一个 {x}）。
    //   方法一致性：verb 为空的端点（`@RequestMapping` 不带 method）视为任意方法（与精确匹配同口径）。
    //   ★★ 位置是判据（本卡第二轮真跑撞的）：模板判定必须在「字面路径但方法不一致 ⇒ methodMismatch」
    //     这条 else 之前 —— 否则 `/order/save`（POST）被 GET 调用时，url 归一后是 `/order/save`，
    //     也会拿去做模板匹配 ⇒ 被 `/order/{id}` 当成模板边建出来 ⇒ **方法不一致被静默洗成模板边**。
    //     ⇒ 现在的顺序：精确 → 模板（方法过滤）→ 字面方法不一致 → 前缀/孤儿。
    const tmplHits: Array<{ ep: Endpoint; hit: ParamTemplateHit }> = [];
    // 精确候选已经存在时，模板无权抢边；只有 exact 为空才进入模板匹配。
    if (exact.length === 0) for (const e of paramEndpoints) {
      if (!(e.verbs.length === 0 || e.verbs.includes(c.method))) continue;
      const hit = matchParamTemplate(e.full, u, c.concat);
      if (hit) tmplHits.push({ ep: e, hit });
    }
    if (tmplHits.length > 1) {
      // 同一 url 对上多个模板 ⇒ 不假装精确（与精确匹配的歧义同口径），也不许挑第一个
      for (const h of tmplHits) {
        ambiguousEps.add(h.ep);
        paramHitEps.add(h.ep);
      }
      result.ambiguous.push(
        `${c.url} @ ${c.fileRel}:${c.line} —— 参数模板同时命中 ${tmplHits.length} 个端点（${tmplHits.map((h) => `${h.ep.typeName}.${h.ep.methodName || '?'}(${h.ep.full})`).join(', ')}）`,
      );
      continue;
    }
    if (tmplHits.length === 1) {
      const { ep, hit } = tmplHits[0];
      result.matched++;
      matchedEps.add(ep);
      paramHitEps.add(ep);
      if (!ep.nodeId || !c.nodeId) {
        result.nodeMissing++;
        continue;
      }
      const key = `${ep.nodeId}|${c.nodeId}`;
      if (builtPairs.has(key)) continue;
      builtPairs.add(key);
      insEdge.run({
        src: ep.nodeId,
        tgt: c.nodeId,
        ln: c.line,
        md: JSON.stringify({
          url: c.url,
          method: c.method,
          controller: `${ep.typeName}.${ep.methodName || '?'}`,
          api_function: c.fnName || '?',
          // ★ 边是结构性的：这里记的是**模板形状**，不是运行时的值绑定
          param_template: true,
          params: hit.params,
          param_values: hit.values,
        }),
      });
      result.edges++;
      paramEdges++;
      continue;
    }
    if (exact.length === 0) {
      if (exactNoVerb.length > 0) {
        result.methodMismatch.push(`${c.url} (${c.method}) @ ${c.fileRel}:${c.line} —— 路径命中 ${exactNoVerb.map((e) => `${e.typeName}.${e.methodName || '?'}[${e.verbs.join('|')}]`).join(', ')}，HTTP 方法不一致`);
        for (const e of exactNoVerb) ambiguousEps.add(e);
        continue;
      }
      // ★ 字面**前缀匹配**（端点路径是 url 的头部，或 url 是端点路径的头部）。
      //   病史：第一版只判「url 比端点长」⇒ 71 条带字面尾部斜杠的拼接 url（`'…/info/' + orderId`
      //   归一后是 `…/info`，比端点 `…/info/{id}` **更短**）全部掉进 frontendOrphan，
      //   与真孤儿（`/system/*`）混在一个清单里 ⇒ 读数谎报。两侧都判。
      const pref = endpoints.filter((e) => {
        if (e.full.trim() === '' || e.full === '/') return false;
        return u === e.full || u.startsWith(`${e.full}/`) || e.full.startsWith(`${u}/`);
      });
      if (pref.length > 0) {
        for (const e of pref) ambiguousEps.add(e);
        // 路径参数（任一侧含 `{x}` 或 url 被截断在段边界）⇒ 归 param（挂账），否则归 ambiguous
        const paramLike = pref.some((e) => /\{[^}]+\}/.test(e.path) || c.concat);
        const line = `${c.url} (${c.method}) @ ${c.fileRel}:${c.line} —— 字面前缀命中 ${pref.map((e) => `${e.typeName}.${e.methodName || '?'}(${e.full})`).join(', ')}，尾部段对不上`;
        if (paramLike) result.paramPathUnmatched.push(line);
        else result.ambiguous.push(line);
        continue;
      }
      result.frontendOrphan.push(`${c.url} @ ${c.fileRel}:${c.line}`);
      continue;
    }
    if (exact.length > 1) {
      for (const e of exact) ambiguousEps.add(e);
      result.ambiguous.push(`${c.url} @ ${c.fileRel}:${c.line} —— 同时命中 ${exact.length} 个端点（${exact.map((e) => e.typeName).join(', ')}）`);
      continue;
    }
    const ep = exact[0];
    result.matched++;
    matchedEps.add(ep);
    // 建边：两端节点 id 都在才建（悬空边 = 假绿）
    if (!ep.nodeId || !c.nodeId) {
      result.nodeMissing++;
      continue;
    }
    const key = `${ep.nodeId}|${c.nodeId}`;
    if (builtPairs.has(key)) continue;
    builtPairs.add(key);
    insEdge.run({
      src: ep.nodeId,
      tgt: c.nodeId,
      ln: c.line,
      md: JSON.stringify({
        url: c.url,
        method: c.method,
        controller: `${ep.typeName}.${ep.methodName || '?'}`,
        api_function: c.fnName || '?',
      }),
    });
    result.edges++;
  }

  // 5. 反向：端点没有前端调用（逐条点名，最多 50）
  const noApi: string[] = [];
  for (const e of endpoints) {
    if (matchedEps.has(e) || paramHitEps.has(e) || ambiguousEps.has(e)) continue;
    noApi.push(`${e.fileRel}:${e.annLine} ${e.verbs.join('|') || 'ANY'} ${e.full} ⇒ ${e.typeName}.${e.methodName || '?'}`);
  }
  result.backendNoApiTruncated = noApi.length > 50;
  result.backendNoApi = noApi.slice(0, 50);

  // ★ paramPathUnmatched 的语义（T-#API-PARAM-EDGES 修好之后）：**只剩"没对上任何模板"的残余**
  //   —— 模板能整段对上却没建成边（歧义 / 节点缺失）的，已经在上面各分支里单列（ambiguous / nodeMissing）。
  //   ⇒ 这里不再额外塞一条汇总行（那会让"残余"看起来多一条，读数谎报）。
  result.paramEdges = paramEdges;

  return result;
}

/** 把对账结果渲染成回执里的一段（带分母；学 renderMapperReconcile 的形状） */
export function renderApiReconcile(r: ApiReconcileResult): string {
  const lines: string[] = [
    `── API 端点对账 ── 端点 ${r.endpoints} · 前端 url ${r.urls} · 建边 ${r.edges} · 精确匹配 ${r.matched - (r.paramEdges ?? 0)}/${r.urls}` +
      ` · 参数模板 ${r.paramEdges ?? 0} · 拼接 url ${r.concatUrls} · 节点缺失 ${r.nodeMissing}`,
  ];
  if (
    r.edges > 0 &&
    r.frontendOrphan.length === 0 &&
    r.ambiguous.length === 0 &&
    r.paramPathUnmatched.length === 0 &&
    r.methodMismatch.length === 0
  ) {
    lines.push(`  ✓ ${r.matched}/${r.urls} 个前端 url 对上后端端点（精确 + 参数模板，方法级）`);
  }
  for (const x of r.frontendOrphan) lines.push(`  ⚠ 前端 url 无后端端点: ${x}（未建边）`);
  for (const x of r.paramPathUnmatched) lines.push(`  ⚠ 参数模板对不上（段边界截断 / 无模板可对；未建边）: ${x}`);
  for (const x of r.methodMismatch) lines.push(`  ⚠ 路径命中但 HTTP 方法不一致: ${x}`);
  for (const x of r.ambiguous) lines.push(`  ⚠ 歧义（不假装精确）: ${x}`);
  for (const x of r.backendNoApi) lines.push(`  ⚠ 后端端点无前端调用: ${x}`);
  if (r.backendNoApiTruncated) lines.push(`  …后端无前端调用的端点只列了前 50 条（总共更多，见回执 api_reconcile.backendNoApi）`);
  for (const x of r.controllersWithoutEndpoints) lines.push(`  ⚠ 扫到 Controller 但一个端点都没提取到: ${x}`);
  return lines.join('\n');
}
