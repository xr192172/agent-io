# 设计稿：slice 3 —— 设计侧变成**可编辑的 DB**（册退化为导出物）

> 立项理由（用户原话）：
> 「我一直强调说要让 DB 也变成可编辑的，就是设计侧的 DB，所以你一直都是全量重写吗？开什么玩笑。
> 你不能单项编辑，那你这个设计有什么设计可言。」
>
> 状态：**设计稿**（只读侦察产出，未施工）。作者：只读代理 `slice3-design` + 主线裁决。

---

## 0. 一句话

今天每个 `edit_dsl` op 都是「**2 次全册读 + 1 次全册写**」，改 1 个节点要重写 8.8 MB；
而要修的根因不是"写得慢"，是**写单元 = 整本册**。把写单元降到**节点**，四个补偿机制里至少两个可以退役。

---

## 1. 现状读数（全部实测）

| 项 | 读数 |
|---|---|
| 权威存储 | `.agent-io/design/*.dsl.json` — 4 本 tracked + journal = **12.44 MB**（最大 8,880,182 B） |
| 物理写入口 | **只有 1 个函数** `storage.ts#saveDSL`（`saveDesignSheet` 已是它的别名） |
| 代码调用点 | **46 处 / 20 文件**：`node_ops`×3 · `edge_ops`×2 · `file_ops`×3 · `api_ops`×5 · `update_feature`×3 · `saveOverlay`×4 · `task_ops`×15 · `import_project`×1 |
| 一个 op 的成本 | `getDesignSheet` 59.5–61.2 ms（readFileSync 37.2 + JSON.parse 22.0）+ stringify 27.7 + 原子写 11 ≈ **160 ms** |
| 对照：卡（已在 DB） | `listLiveCards`（74 张卡，tasks.db）= **3.66 ms** ⇒ **便宜 16 倍** |
| `design-db/` | 379 个 `*.calls.json`，6.81 MB，**纯派生、全仓无写路径** |
| diff 噪声 | 改 1 字段在 158,887 行里只 1 行变 ⇒ **噪声不是问题**；问题是 mtime 全文件失效 + 每次全本 parse + **冲突粒度 = 整本** |

★ **`design-db` 不是册的投影**：`symbols / imports / calls` 取自 `cache.db`（代码事实）；
设计侧只出 `//source` / `path` / `expected_symbols` / `requirements` / `requirements_calls`。
⇒ 按字节它只守住 `expectations` 的 **0.06MB / 8.88MB = 0.7%**。

---

## 2. 为"整本写"付的代价（今天全撞过）

| 补偿机制 | 存在理由 |
|---|---|
| `_dsl_rev` 乐观锁 | 整本覆盖会互相冲掉，才需要 CAS |
| tmp + rename 原子写 | 整本重写，读端可能读到半截 |
| 「只有一个写端」 | 写的是同一个文件，四处各写一份必炸（**这条是好设计，与粒度无关，保留**） |
| 同 feature 两卡必须串行 | 写单元是整本，不是节点 |

---

## 3. 形状裁决：**A · SQLite `design.db`**

| 判据 | A SQLite | B 目录分片 | C 只做局部写 |
|---|---|---|---|
| ① 写单元 = 节点 | ✓ | ✓ | ✗ |
| ② 同 feature 两卡并行 | ✓ | ✓ | ✗ |
| ③ 读端能按实体取 | ✓ | ? | ✗ |
| ④ 可分步回滚 | ✓ | ✓ | — |

**为什么不是 B**：① 一个 `edit_dsl` 的多 op 依赖**跨实体原子回滚**（`update_feature.ts:204` restoreRaw + T340 自洽闸；"add node 再 add edge" 同事务）—— 分片给不了，除非自建 journal = 自建一个更差的 DB；② 54 节点 + 973 边 + 434 文件 × 11 册 ≈ **2 万文件**，全册读要 540 次 open；③ 与 `design-db/`（已是"每路径一文件"）**撞形态**。

**为什么不是 C**：写单元仍是整本 ⇒ 两卡照样串行、读端取不到部分。它唯一真能做到的是「**N 个 op 合并成 1 次写**」（~20 行，成本 ÷N）—— 值得单独做，但回答不了"单项编辑"。

### A 的表形状（照 tasks 先例）
```
books(book_id PK, envelope_json, txid)
nodes(book_id, node_id, ord, json)          -- ord 保数组序
edges(book_id, edge_id, ord, json)
files(book_id, path, json)                  -- 语义文件节点
apis(book_id, file_id, ord, json)
decisions(book_id, node_id, json)
expectations(book_id, node_id, idx, json)
decision_history(book_id, node_id, idx, json)   ← ★ 独立表，见 §4
todos(...)                                      ← 已在 tasks.db
```
★ **每行存 `json` blob 而非列化**：实测 `JSON.parse → JSON.stringify` 与盘上文件**逐字节相同**（两本册 sha256 一致）
⇒ blob 保 key 序 + `ord` 保数组序 ⇒ `exportBook()` 能**逐字节重建**今天的册。这是 A 能过等值判据的根据。

---

## 4. ★ 最便宜的先行项：`decision_history` 占 55%

```
node.decision_history = 8.88MB 里的 **4.87MB（1050 条，追加型）**
agent-io 那本占 29.6%（0.97MB / 385 条）
```
⇒ 先把它拆成独立存储，**册 12.44MB → ~6.5MB**，几乎零风险（没有消费者要"整段 history"，`query=node` 是按节点取的）。
★ 但**必须记 `history_pos`**（拆出后要能放回原位置），否则字节等值破。

---

## 5. 三步（照 tasks 的 2a/2b/2c）

| 步 | 改什么 | 怎么验等价 | 怎么回滚 |
|---|---|---|---|
| **S1 影子库** | 册仍权威；`saveDSL` 落盘处加 `shadowSyncDesign(dsl)` + `parityDesign`。**读写路径 0 字节改** | 4 本册逐行 sha256 全绿 | `rm .agent-io/design.db`（无人读） |
| **S2 读按实体** | 新增 `readNodes / readExpectations / readOverlay / readPaths / readTasks`，切 9 个调用点（`write_gate:871` · `claim_conflict:492` · `task_drift:123` · `file_snapshot:165` · `cross/index:80` · `todo_journal:61` · `gen_design_db:261` · `design/index:518`(judge) · `detect_drift:132/296`） | 同参数新旧读者返回值 **deep-equal**（不看顺序），每点一条 | 调用点均一行替换，逐个 revert |
| **S3 写进库、册变导出物** | `applyOperation` 改事务内 upsert；`saveDSL` 退化为 `exportBook()`；**`_dsl_rev` 退役**；原子写只留 export 一处 | `exportBook(db)` 与今日册 **sha256 相等**（4 本） | `importBookToDb` 从册重建 + restore 导出 |

---

## 6. 两条**真**判据（design-db 那道门守不了册搬家）

```
(i)  内容：get_dsl 的每个 query（dsl/nodes/edges/node/decisions/files/file/digest/pool/todo）
          新旧两版 deep-equal ⇒ 覆盖 100% 内容
(ii) 字节：exportBook 的 sha256 == 今日册（4 本）⇒ 覆盖 100% 字节（已验可行）
```
design-db 那道门（今天 379 投影 / 753 文件节点 / 117 受断言路径 / 0/0/0/0/0）**留着**，
但它守的是"设计要求进没进投影"，**不是**"册搬没搬家"。它的输入必须继续是 **git 里的册（导出物）**，不是 db
—— 否则这道门变成"随机器索引红绿"。

### 另两条（今天必红的）
```
并行：同 feature 两个不同节点、两张 claimed 卡、**两个进程**同时 edit_dsl ⇒ 两笔都成功且两处都在
      （今天 CAS 会让其一抛 `DSL 冲突`）
增量：改 1 节点 ⇒ 册 mtime 不变 + 写入 ≤13KB（实测每节点 p100=12,692B / 中位 336B，对比今日 8,880,182B），用 page_count×page_size 差量
```

---

## 7. 权威问题（**待用户裁决**）

```
S1/S2：册权威（db 标记 derivable:true）
S3    ：写侧权威 = db ；持久权威 = 册（导出物进 git、人审载体），db 进 .gitignore 且**恒可从册重建**
```
代价：`导出 + 导入` 变成一对 ⇒ **本仓最恨的"两处真相"**。
钉死办法：上面的 `exportBook sha256` 门 + 一条 import 门（册 → 库 → 导出 == 原册）。

**不推荐** `.jsonl` 载体（tasks 那条路）：12MB 行式文件审阅比 JSON 更差，且无法与今日形态做字节等值。

---

## 8. 连带影响（逐条）

- `_dsl_rev` → **退役**（S3 行级事务取代；只给 export 留库版本判过期）。进 `docs/RETIRED.md` 性质①，替代 = `books.txid`。
- tmp+rename 原子写 → **只留 export 一处**；行级原子性由 SQLite journal 给。
- `gen-db-check` → 语义不变，输入仍是**册**；归属账读 `node.path + decision.expectations`。
- 读路径改造：`judge` → decisions/expectations 表 · `drift` → nodes+files · `translate book` → files 表取 symbols · `plan` 画布的 `decision:<node>#<i>` → decisions 表 · `export`(svg/mindmap/md) → nodes+edges+envelope（收益最大，81.6% 字节）。
- `[未核]` `judge-cache.json` 的失效键（feature + file hash）换存储后要不要跟；
  `write_gate` 每次 claim 走 `listDesignSheets()`（11 本含外项目），每项目一库后要开 11 库是否更快未测；
  daemon 的串行队列是全局互斥还是按 feature（并行判据须确认走两进程）。

---

## 9. 排期建议

```
Step 0（便宜，先做）  ① decision_history 拆独立存储（册 −55%）② N 个 op 合并成 1 次写（~20 行）
                      —— 不解决"单项编辑"，但先把"每次重写 8.8MB"砍掉一半
S1 影子库 → S2 读按实体 → S3 写进库 + 册变导出物 + _dsl_rev 退役
```
