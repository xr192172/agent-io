/**
 * agent-io 符号缓存 schema（v2）
 *
 * 以 vendor/codegraph/src/db/schema.sql 为底裁剪改造：
 *   - 保留：nodes / edges / files / unresolved_refs / schema_versions / project_metadata
 *   - 保留：FTS5 全文索引 + 三触发器（ai/ad/au）——索引可随时 rebuild，
 *     但 docstring/signature 等被索引列必须第一天占住（后补列 = 全量重跑提取）
 *   - 改造：分词器 unicode61 → trigram。unicode61 把整段中文当一个 token
 *     （中文搜索全废）且不拆 camelCase；trigram 中文子串 + 标识符子串通吃，
 *     千级文件规模索引体积可接受
 *   - 暂缓：name_segment_vocab（序号 8 语义搜索再加；它是派生物化表，随时可重建）
 *   - v2：+imports 表（原始 import 记录，import_project 缓存路径的数据源）
 *   - v3：nodes.sym_hash（符号 span 归一化 hash）+ symbol_diffs 表（sync 时新旧对比，
 *     记录每个文件"真正改动了哪些符号"——符号级影响分析的数据源）
 *   - v4：files.norm_hash + symbol_diffs.norm_from/norm_to（文件级归一化全文 hash）。
 *     符号提取不含顶层 const/赋值表达式——常量值变更（FLAG=true→false）符号级零差异，
 *     曾被误判"无实质变更"漏掉 import 层波及。norm_hash 补第二道判定：符号无差异
 *     且全文归一化无差异才是纯注释/格式；norm 变了 → 符号外实质变更，按文件级波及
 *   - v14：nodes.return_type / type_params / modifiers（返回类型原文 / 泛型参数 / 修饰符+装饰器）。
 *     三者此前都只能从 signature 里拆（consistency 的 returnTypeOf、mind_map 的 outs）——
 *     与 v13 的 params 同一个病根；结构化事实落库后消费方读同一份
 *   - v15：nodes.body_text / body_hash（**函数体原文** + 它的 sha1）。
 *     v14 之前 DB 知道「这个函数长什么样」（签名/形参/返回类型/修饰符/成员），**不知道它做了什么** ⇒
 *     重写时仍必须打开源文件（那正是"看着 DB 重写不安全"的来源）。判据：**要不要打开源文件**
 *     —— 打不开就说明 DB 不全。★ `NULL` 的语义与 `files.content_hash` 的用法**写死在列注释里**（见下）
 *   - v16（2026-10-21）：**file_path → files.id 外键**（这是**规范化**，不是压缩）。
 *     `identifiers` 316,446 行里，每行都重抄一遍完整路径：`file_path` 合计 **13.33 MB**（平均 44 字节），
 *     连带 `sqlite_autoindex_identifiers_1`（主键含 file_path）一起膨胀到 **17.25 MB**。
 *     ⇒ 病根不是"存太多信息"，是**同一事实在 31.6 万行里各存一份**。
 *     v16：`files.id INTEGER PRIMARY KEY`，identifiers / imports / unresolved_refs / symbol_diffs 改存 `file_id`；
 *     读方走 `v_*` 视图（列名仍是 `file_path`）。★ 视图被 SQLite flatten 成与 JOIN **完全相同的计划**
 *     （实测：`SEARCH f USING COVERING INDEX autoindex_files_1 (path=?) → SEARCH i USING INDEX …`），
 *     且耗时与 JOIN 一致 ⇒ 视图不是"多一层"。
 *     ★ `idx_identifiers_name` **必须**跟着改成 `(name, file_id)`：只按 name 建索引时
 *     `WHERE file_id=? AND name=?` 用不上 file 维度 ⇒ 先扫该文件全部行再过滤，实测 0.095 ms → 1.362 ms（14 倍）；
 *       带上 file_id 后 0.006 ms（比 v15 快 15 倍）。
 *     ★ `nodes.file_path` **不换**（理由写在 nodes 表的列注释里，别重新解释）。
 *
 * 节点 id 约定：
 *   - 文件节点：id = 相对项目根的 posix 路径（如 "src/tools/serve.ts"），kind='file'
 *   - 符号节点：id = "<file>#<qualified_name>"（文件内重名时追加 ":L<start_line>"）
 *
 * 生命周期约定（symbols.ts 依赖，勿破坏）：
 *   - 文件节点【只 UPSERT 不 DELETE】（INSERT OR IGNORE 建桩 / ON CONFLICT 更新），
 *     保证指向它的 import 边不因重同步被 ON DELETE CASCADE 带走；
 *     仅当文件从项目删除时才经 removeFile 删除（此时级联清边是期望行为）
 *   - 符号节点：按 file_path 整批删除重插（其上的调用边由序号 3 重新推导，级联可接受）
 *   - import 边：按 source 文件整批删除重插（出边跟随源文件同步）
 */

export const SCHEMA_SQL = `
-- schema 版本追踪（迁移机制从第一版就占位）
CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

-- 节点：文件节点 + 符号节点（函数/类/接口/类型/方法）
-- ★ 2026-10-20（v11）：**标识符位置**表。
--   消费者：find_references / field_refs / rename_symbols / remove_dead_imports。
--   它们现在都用正则扫源码 —— 会漏（别名/解构/动态访问）也会误报（注释/字符串）。
--   ★ 只记【出现位置】，不记语义：同名多义、作用域遮蔽，要靠调用方结合 nodes 自己判。
-- ★ v16（2026-10-21）：file_path TEXT → file_id INTEGER（files.id 外键）。
--   316,446 行 × 平均 44 字节的完整路径 = 13.33 MB，全是**同一份事实的各行副本** ⇒ 规范化。
--   读方走 v_identifiers（列名仍叫 file_path，读方一行不用改）；写入直接写本表的 file_id。
CREATE TABLE IF NOT EXISTS identifiers (
    file_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,   -- identifier / property / type / shorthand
    line        INTEGER NOT NULL,
    col         INTEGER NOT NULL,
    start_index INTEGER NOT NULL,
    end_index   INTEGER NOT NULL,
    PRIMARY KEY (file_id, start_index),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
-- ★ 索引列序是 (name, file_id)，**不是** (name)：
--   field_refs 的主查询是 WHERE file_id = ? AND name = ?。只按 name 建索引时
--   SQLite 用不上 file 维度 ⇒ 先取该文件全部行再过滤（实测 24,055 行的文件：0.095 ms → 1.362 ms，14 倍）；
--   带上 file_id 后两列都是等值 ⇒ 0.006 ms。**别改回去。**
CREATE INDEX IF NOT EXISTS idx_identifiers_name ON identifiers(name, file_id);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    -- ★★ v16 决定：**nodes.file_path 保持 TEXT，不换 file_id**。理由（写死，别重新解释）：
    --   ① 它是**符号 id 的一部分**（id = relPath 或 relPath#qn），换列不换 id 就是两套身份并存；
    --   ② 本表要为"**import 目标但还没索引**的文件"建**桩节点**（symbols.ts 的 ensureStub）——
    --      这些路径**不在 files 表里**（实测本库 22 行，全是 dist/*.js）。挂 FK 就得给它们
    --      **伪造 files 行**（编 content_hash/size），而 files 是"哪些文件被索引过"的**唯一权威**，
    --      伪造会让 index_integrity 把没索引的文件算成已索引 —— 比省 0.9 MB 严重得多；
    --   ③ 收益只有 0.35 MB（+ 两个索引约 0.9 MB），消费方（function_outline / derive_mind_map /
    --      candidate_locator / semantic_search）全在本列上做 LIKE 与前缀分组。
    --   ⇒ 边界：**file 归属的事实表**（identifiers/imports/unresolved_refs/symbol_diffs）用 file_id；
    --      nodes 是"符号 id 里带路径"的图结构，路径属于 id，不参与这条规范化。
    file_path TEXT NOT NULL,
    language TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    parent TEXT,
    signature TEXT,
    docstring TEXT,          -- ★ 2026-10-21：文档注释**原文**（列早已存在，这一天起才真写值）（含 /** */ 、/// 、Python 的三引号；不剥标记）。
                             --   NULL 有两种，**都写 NULL 是对的**：
                             --     ① 该符号**确实没有文档**（紧邻的 // 与 # 普通注释**不算**文档）；
                             --     ② 该语言**没登记规则**（c / cpp / ruby / bash …）⇒ 「没抽」，不是「没有」。
                             --   取法唯一出处 = parse/symbol_docstring.ts 的规则表（含「紧邻」判据）。
                             --   ★ 不剥注释标记：剥了这段文本在源码里就搜不到（消费方没法回源核对）。
    members TEXT,            -- 2026-10-20：类型成员 JSON（name/type/optional）——
                             --   type/interface 的定义本来就没有地方落（signature 只有 Name()）
    params TEXT,             -- ★ v13（2026-10-20）：函数/方法形参 JSON（name/type/optional/variadic）——
                             --   signature 只有一根字符串，消费方各拆一次 ⇒ 假差异；此处是结构化事实。
    -- ★★ v14（2026-10-21）：三块「以前只能从 signature 里拆」的事实。
    --   判据（与 params 同一把尺，**写死**，不要重新解释）：
    --     · '[]'  = **抽到了、此处确实没有**（没有泛型 / 没有修饰符）；
    --     · NULL  = **没抽到**（该语言没有这条语法 / 该符号不是这一类 / 解析器没给）。
    --   ★ 这两个值**不可互换**：把 NULL 写成 '[]' 等于对调用方说「确实没有」，
    --     而那是我们不知道的事（params v13 已立此规矩）。
    return_type TEXT,        -- v14：返回值**原文**（int / Promise<X> / Go 多返回值 (bool, int) /
                             --   PHP ?array）。★ 标量：NULL = 没抽到或无返回类型注解，**没有 '[]' 语义**。
    type_params TEXT,        -- v14：泛型参数 JSON 数组 [{name, constraint?, default?}]。
                             --   '[]' = 抽到了、此处没泛型；NULL = 该语言没有泛型语法（php / js）。
    modifiers TEXT,          -- v14：修饰符 + 装饰器 JSON 数组（export/async/static/readonly/abstract/
                             --   public/protected… + @dec / #[Attr] / [Obsolete] / #[inline]）。
                             --   '[]' = 抽到了、确实没有；NULL = 该语言不抽（go：无修饰符关键字）。
    -- ★★ v15（2026-10-21）：**函数体原文**。NULL 的语义（与 params v13 / 三列 v14 同一把尺，**写死**）：
    --     · NULL = **这个节点没有体**（type / interface / class / 纯值 const 声明），
    --              或**该语言的体不是单一 AST 节点**（bodyIsSelf：julia / fish / crystal —— 见 kernel.ts 的 LANG_ADAPTERS）
    --              ⇒ 我们**不知道**它做了什么；
    --     · 非空串 = 原文：**从 AST 的 body 节点取 text**，不做任何格式化（不重排缩进、不去注释、
    --              不归一化空白）—— 消费方要把它当**源码字节**用。
    --     · 【禁止】空串 '' —— 空串会被下游读成"体确实是空的"，而我们不知道的事不许写成知道。
    --   ★ 是否含外层花括号 = **照语法树原样**（这决定消费方怎么拼回去）：
    --     · ts/js/go/java/kotlin/php/c#/rust：体节点是 statement_block / block / function_body /
    --       compound_statement ⇒ **含** 花括号；
    --     · python：block = **缩进语句块**，不含 def 行、**没有花括号**；
    --     · ts/js 箭头函数简写（x => x+1）的 body 字段是**表达式** ⇒ 不含花括号；
    --     · kotlin 的 function_body 在 = expr 形态下也是一段表达式。
    --   ★★ 与 files.content_hash 的关系（**读 body 之前必读这一段**）：
    --     两列都是**索引那一刻**的快照，与 files.content_hash **同一代**。
    --     body_hash 只证明"这段文本没被本表的写入路径篡改过"，**不证明文件与索引还同源**。
    --     ⇒ 每个消费方读完 body 必须自己过两道：
    --       ① 库内自洽：sha1(body_text) === body_hash；
    --       ② 库与源码同源：contentHash(当前源码) === files.content_hash（contentHash 见 index/symbols.ts）。
    --     任一道不过 ⇒ 报"**索引过期**"并**拒绝返回旧 body** —— 旧 body 正是"照旧代码重写新代码"的直接来源。
    --     手里没有源码内容时退一步：至少用 size + mtimeMs 与 files 行比对（detectStaleIndex 同一把尺），
    --     并在回执里明标"只做了 stat 级校验"，不许当成"已同源"。
    body_text TEXT,
    body_hash TEXT,          -- v15：**原文**的 sha1（不做归一化 —— 归一化会把"改了注释/格式"伪装成"没变"）
    sym_hash TEXT,           -- v3：符号 span 归一化 hash（去注释/空白）——符号级 diff 依据
    is_closure INTEGER NOT NULL DEFAULT 0,  -- v8: 局部闭包/辅助函数标记——不进 DSL 契约面，但仍保留供搜索/引用
    updated_at INTEGER NOT NULL
);

-- 边：节点间关系（import / call / contains ...）
CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    kind TEXT NOT NULL,
    line INTEGER,
    col INTEGER,
    metadata TEXT,           -- JSON object
    provenance TEXT DEFAULT NULL,  -- 预留：序号 3 合成边标记
    FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 文件：索引状态与内容 hash（增量跳过的依据）
-- ★ v16：加 id INTEGER PRIMARY KEY，其余表用它当外键 ⇒ 完整路径只在这一张表里存一份。
--   path 仍是**唯一业务键**（所有调用方按路径找人，不改），UNIQUE 保证 1:1。
--   ★ 写入必须用 ON CONFLICT(path) DO UPDATE（UPSERT）：
--     原来的 INSERT OR REPLACE = DELETE+INSERT，会让 ON DELETE CASCADE 把该文件的
--     identifiers / imports / symbol_diffs / unresolved_refs 一起带走（静默清空）。
--   ★ AUTOINCREMENT 是为了 id 永不复用——文件删了再加回来是**新 id**，
--     任何跨删除缓存的 file_id 只会失效、不会指到别的文件。
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    language TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    node_count INTEGER DEFAULT 0,
    errors TEXT,             -- JSON array
    norm_hash TEXT           -- v4：全文归一化 hash（剔注释行+去空白）——符号外变更判定依据
);

-- 原始 import 记录（v2）：import_project 缓存读取路径的数据源。
-- edges 表只存【已解析的相对导入】边；Go 包路径 / Python 点分模块的原始
-- source 串只留在这里，缺了它缓存路径会静默丢包导入依赖边。
-- 生命周期：随 syncFile 按 file_id 整批重插；removeFile 时随 files 行 CASCADE 清除。
-- ★ v16 起挂 FK（file_id → files.id ON DELETE CASCADE）。
--   v16 前"故意不挂 FK"的唯一理由是：files 行用 INSERT OR REPLACE 重写（REPLACE = DELETE+INSERT），
--   ON DELETE CASCADE 会在同事务内把刚写入的 imports 带走 —— 该理由已随 files 改写为
--   ON CONFLICT(path) DO UPDATE（不删行）而失效。
CREATE TABLE IF NOT EXISTS imports (
    file_id INTEGER NOT NULL,
    line INTEGER NOT NULL,
    source TEXT NOT NULL,
    kind TEXT NOT NULL,      -- 'relative' | 'package'（与 ts_kernel ParsedImport.kind 一致）
    type_only INTEGER NOT NULL DEFAULT 0, -- v5：TS "import type" 整条运行时擦除——依赖图/闭包
    -- ★ v9：该 import 绑定的【本地可用名】（JSON 数组，如 ["readdirSync","statSync"]）
    --   用途：给定使用点裸名（readdirSync）判断它来自哪个模块
    --   ⇒ resolveCrossFileCalls 能把它判 external 而不是 failed
    --   ★ NULL = v9 之前写的旧行（版本升级清库重建时一并填上）
    bindings TEXT,
    -- ★ 2026-10-20（v12）：整条 import 语句的字符 span（删整句用；NULL = 解析器没给偏移）
    start_index INTEGER,
    end_index INTEGER,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_id);

-- 向量缓存（持久层）：model:sha256(文本) → 向量。跨进程重启存活，
-- 符号文本+模型不变直接查表，重启后首个语义查询不再全量 embed。
-- 纯新增派生数据，不参与 schema_versions 清库迁移（旧库 IF NOT EXISTS 自动补建）。
CREATE TABLE IF NOT EXISTS embedding_cache (
    cache_key TEXT PRIMARY KEY,   -- model:dim:sha256(symbolText)
    dim INTEGER NOT NULL,
    vector BLOB NOT NULL,         -- float32 little-endian
    created_at INTEGER NOT NULL
);

-- 符号级变更记录（v3）：syncFile 重插符号前对比新旧 sym_hash，把"这个文件真正
-- 改动了哪些符号"落成一行（按 file_path 最新一份，链式合并——同一文件连续多次
-- 编辑未消费时累积成 vA→vNow 的净差异）。diffImpact 据此把波及源从"整文件所有
-- 符号"收敛到"真正改动的符号"，改注释/格式不再虚报波及。
-- 首次导入不写行（无旧版可比），diffImpact 对该文件回退文件级。
-- ★ v16：file_path TEXT PRIMARY KEY → file_id INTEGER PRIMARY KEY（files.id）。
--   本表只有 0 行且同为"按文件"的事实表 —— 不换就是"一半用 id、一半用路径"，
--   下次谁都得重新判一次该用哪套；统一到 file_id 后判据只有一条：file 归属 ⇒ file_id。
CREATE TABLE IF NOT EXISTS symbol_diffs (
    file_id INTEGER PRIMARY KEY,
    from_hash TEXT NOT NULL,       -- 对比起点文件 content_hash
    to_hash TEXT NOT NULL,         -- 对比终点文件 content_hash（= 当前 files.content_hash）
    added TEXT NOT NULL,           -- JSON array：新增符号 qualified_name
    removed TEXT NOT NULL,         -- JSON array：删除符号 qualified_name
    changed TEXT NOT NULL,         -- JSON array：实质变更符号 qualified_name（span hash 变）
    norm_from TEXT NOT NULL DEFAULT '',  -- v4：起点全文归一化 hash（''=未知，保守视为已变）
    norm_to TEXT NOT NULL DEFAULT '',    -- v4：终点全文归一化 hash；norm_from≠norm_to = 符号外实质变更
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- 未决引用：序号 3 调用边提取的解析暂存（先占位，生命周期见 CodeGraph 同名表注释）
CREATE TABLE IF NOT EXISTS unresolved_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node_id TEXT NOT NULL,
    reference_name TEXT NOT NULL,
    reference_kind TEXT NOT NULL,
    line INTEGER NOT NULL,
    col INTEGER NOT NULL,
    candidates TEXT,
    -- ★ v16：file_path TEXT NOT NULL DEFAULT '' → file_id INTEGER NOT NULL（1.43 MB 的路径副本）。
    --   NOT NULL：本表每一行都是某个已索引文件解析出来的引用，没有"无主"行
    --   （迁移实测 32,932 行全部能对上 files.path，孤儿 0）。
    file_id INTEGER NOT NULL,
    language TEXT NOT NULL DEFAULT 'unknown',
    status TEXT NOT NULL DEFAULT 'pending',
    name_tail TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
CREATE INDEX IF NOT EXISTS idx_nodes_file_line ON nodes(file_path, start_line);

-- FTS5 全文索引（trigram：中文子串 + camelCase 子串）+ 触发器同步
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id,
    name,
    qualified_name,
    docstring,
    signature,
    content='nodes',
    content_rowid='rowid',
    tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;

CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind);

-- 边身份唯一：(source,target,kind,line,col)；IFNULL 折叠 NULL，否则 INSERT OR IGNORE
-- 对 NULL 不生效会产生重复边（CodeGraph #1034 踩过的坑，直接继承修复）
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_identity
  ON edges(source, target, kind, IFNULL(line, -1), IFNULL(col, -1));

CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at);
CREATE INDEX IF NOT EXISTS idx_unresolved_from_node ON unresolved_refs(from_node_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_name ON unresolved_refs(reference_name);
CREATE INDEX IF NOT EXISTS idx_unresolved_status ON unresolved_refs(status);
CREATE INDEX IF NOT EXISTS idx_unresolved_failed_tail ON unresolved_refs(name_tail) WHERE status = 'failed';

-- ─────────────────────────────────────────────────────────────
-- v16 读方出口：**视图把 file_id 还原成 path，列名仍是 file_path**
--
-- 为什么是视图而不是"每个读方自己写 JOIN"：读方 SQL 一个字都不用改结构
-- （只把 FROM identifiers 换成 FROM v_identifiers），"路径在哪张表"这件事只有一个出处。
-- ★ 代价已实测（2026-10-21，31.6 万行真实库）：视图被 SQLite **flatten**，计划与手写 JOIN
--   逐字相同 —— SEARCH f USING COVERING INDEX autoindex_files_1 (path=?) → SEARCH i USING INDEX …；
--   耗时同一水平（identifiers 按文件计数 0.602 ms → 0.405 ms；imports 按文件取 0.044 → 0.034 ms）。
--   唯一变慢的是 imports DISTINCT by source（0.189 → 0.295 ms，2445 行规模，不值得为它加索引）。
-- ★ 视图**只读**：INSERT/UPDATE/DELETE 必须写基表（视图没有 INSTEAD OF 触发器，
--   写视图会报 "cannot modify … because it is a view"，这是**故意的**：写路径必须显式给 file_id，
--   免得有人在视图上写路径、再让某个触发器去猜 id）。
CREATE VIEW IF NOT EXISTS v_identifiers AS
SELECT f.path AS file_path, i.name, i.kind, i.line, i.col, i.start_index, i.end_index
FROM identifiers i JOIN files f ON f.id = i.file_id;

CREATE VIEW IF NOT EXISTS v_imports AS
SELECT f.path AS file_path, i.line, i.source, i.kind, i.type_only, i.bindings, i.start_index, i.end_index
FROM imports i JOIN files f ON f.id = i.file_id;

CREATE VIEW IF NOT EXISTS v_unresolved_refs AS
SELECT u.id, u.from_node_id, u.reference_name, u.reference_kind, u.line, u.col, u.candidates,
       f.path AS file_path, u.language, u.status, u.name_tail
FROM unresolved_refs u JOIN files f ON f.id = u.file_id;

CREATE VIEW IF NOT EXISTS v_symbol_diffs AS
SELECT f.path AS file_path, s.from_hash, s.to_hash, s.added, s.removed, s.changed,
       s.norm_from, s.norm_to, s.updated_at
FROM symbol_diffs s JOIN files f ON f.id = s.file_id;
`;
