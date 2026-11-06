# 测量：三段对照实验（T-28 任务）· 2026-11-07

> 这份文件存在的理由：**P29** —— 「引用任何数之前先问：它在仓里有落点吗？」
> 下面每个数都带**复算命令**。**不许在别处引用这里的数而不指向这里。**
>
> ★ 这份文件**只报测到的**，不报"推论"。凡推出来的都标 `[推论]`。

---

## 一、这是什么

问一个问题：**「帮 AI 在已有项目里定位、理解、按设计改造」这套框架，值不值得？**

做法：**同一个真实任务（T-28「卡生命周期砍掉 preparing」）× 三种工作流**，
用**同一份 8 条 hold-out** 判分，量五个数（M 漏改 / W 写事件 / R 返工 / F 人工槽 / D 被拒）。

---

## 二、已测到的（两段）

| 段 | 工作流 | M（8 条里红的） | W（写事件） |
|---|---|---|---|
| **A** | **无框架**：树里删掉 `AGENTS.md` / `docs/` / `TASKS.md` / `.agent-io/`，只给四条要求，纯读代码 | **0 / 8** | ≈ **89**（自报） |
| **B** | **有框架 + 手工填槽** = 就是 T-28 那次（`post/` 树） | **0 / 8** | ≈ **11**（来自写账） |
| **C** | 有框架 + 自动填槽 + `derive` | — | — **段不存在，未测** |

### hold-out 8 条（`holdout/t28_corners.test.ts`，T-32 建，鉴别力被 `naive` 变异证明过）

```
K1 TASK_STATES 收成四态（不多不少）              K4 ★ 存量 preparing 的进度不许静默掉成 undefined
K2 写端守卫不认 preparing                        K5 ★★ 存量 preparing 且租约过期 ⇒ releaseIfExpired 必须产出事件
K3 存量态仍可读                                  R1/R2/R3 回归守卫
```

★ **A 段 8 条全过，包括 K4 / K5 那两个陷阱。**
★ 而 K4/K5 是「照题面把 TASK_STATES 收成四态」最自然的错法（`naive` 树就栽在这两条）。
⇒ **一个不知道框架存在、只读代码的模型，自己做对了这两条。**

---

## 三、这两个数意味着什么

```
① 「漏改」这一列：**A = 0，B = 0 ⇒ 平。**
   框架**没有**在"做得对"这一列上赢。

② 「动作量」这一列：**A ≈ 89，B ≈ 11 ⇒ 框架省 8 倍的手。**
   ★ 这与本项目自己的叙事**不一样**：它一直讲"防假绿 / 防漏改 / 防回归"，
     而实测说：一个会读代码的模型**不漏改**；框架赢的是**它少动 8 倍的手**。
```

`[推论]` 所以框架的价值可能不在「正确性」，在「**动作量**」——
`[推论]` 而那正好回答"填槽/过闸损耗值不值"：**它省 89→11，付的是那些闸的成本。**

---

## 四、★★ 这份测量**不能**说什么（防止被误用）

```
✗ 不能说「框架有用」—— C 段不存在，判据（M_C ≤ M_A 且 F_C ≤ F_B/3 且 W_C ≤ 1.5·W_A）**无法评估**。
✗ 不能说「框架没用」—— 同上。
✗ 不能外推：**n = 1**，同一模型，一个任务。
✗ 不能把 89 与 11 当严格可比：**口径不同**——
   89 是 A 段**自报**（"我自己数的，含改错的"）；11 来自 T-28 的真实写账。
   ⇒ 只能说**量级**，不能说"精确 8.09 倍"。
✗ 不能说 A 段「很容易」：它的树里没有 `docs/` `AGENTS.md` `.agent-io/design/`
   ⇒ 9 个测试文件因缺文件本来就会红（**环境原因，不是漏改**）。M 不受影响（hold-out 独立），
   但"它有多难"这件事受影响。
```

---

## 五、复算命令

```powershell
# 1) 建 A 段树（仓外，路径不能含 .agent-io —— 否则泄漏框架存在）
$src='D:\agentio\dev\agent-io\.agent-io\scratch\t32\pre'; $dst='D:\agentio\armA'
robocopy $src $dst /E /XD node_modules /NFL /NDL /NJH /NJS /NP
foreach ($x in @('AGENTS.md','docs','TASKS.md','.agent-io')) { Remove-Item (Join-Path $dst $x) -Recurse -Force -EA SilentlyContinue }
cmd /c "mklink /J `"$dst\node_modules`" `"D:\agentio\dev\agent-io\node_modules`""

# 2) 判分（★ 必须用 --import tsx：hold-out 从 ../src/*.ts 导入，.js 后缀指向 TS 源）
#    ★ 且必须放在 <tree>\tests\ 下 —— 放树根会让 ../src 解析到错的目录
Copy-Item '.agent-io\scratch\t32\holdout\t28_corners.test.ts' "$dst\tests\__corners.test.ts"
Push-Location "$dst\tests"; node --import tsx --test __corners.test.ts; Pop-Location

# 3) B 段（post = T-28 改完的树）
$p='D:\agentio\dev\agent-io\.agent-io\scratch\t32\post'
Copy-Item '.agent-io\scratch\t32\holdout\t28_corners.test.ts' "$p\tests\__corners.test.ts"
Push-Location "$p\tests"; node --import tsx --test __corners.test.ts; Pop-Location
```

---

## 六、下一步（C 段）

```
C 段 = 有框架 + 自动填槽 + `derive`。它**还不存在**。
T-32 给的验收门槛（先冻结，再由 `seat_acceptance` 盲判）：
  K1 草案器复用 `tasks.db#plans`，**不新建盘上文件**
  K2 每个自动填的值带 `source∈{actual-db,design,rule,model}` + `evidence[]` + `confidence` + `needsReview`
     ，`source≠model` 必须**重放可验**
  K3 抽掉 actual-db 源 ⇒ `source==='model'` 点数**必须上升**（消融）
  K4 收益可**离线复算**
★ 因为 **M_A = 0**，判据「M_C > M_A 哪怕只多 1 条 ⇒ 框架反而更差」意味着：
  **C 段只要漏 1 条就输。** 所以 C 段要做的是"不减 M 的前提下压 F"。
```

---

## 七、★ 判据三项的评估状态（2026-11-07 补）

目标里写死的判据是三项与：

```
载体成立 = M_C ≤ M_A  且  F_C ≤ F_B/3  且  W_C ≤ 1.5·W_A
```

**逐项核过能不能评估：**

| 项 | 状态 | 为什么 |
|---|---|---|
| `M_C ≤ M_A` | ✗ **无法评估** | C 段不存在 ⇒ 没有 `M_C` |
| `F_C ≤ F_B/3` | ✗ **无法评估**（**双重**） | `F_C` 缺 C 段；★ **`F_B` 也没有仪表** |
| `W_C ≤ 1.5·W_A` | ✗ **无法评估** | C 段不存在 ⇒ 没有 `W_C` |

### `F_B` 为什么量不出来（实测）

```
`F` 的定义（T-32 §4）：一次调用里该 `(type,op)` 的 `required` 键中，
                       来源 ∉ {actual-db, design, rule} 的键数 —— 即"必须人工填的槽"。

⇒ 要量它，账本里必须记**这次调用带了哪些 data 键**。

实测两本账本的字段：
  .agentio-data/dogfood/usage.jsonl   keys: ts, tool, via, ok, ms, nextHops   ← **没有 data**
  .agent-io/dogfood/usage.jsonl       同上
  .agent-io/self-writes.json          143 B，records_data_payload = false
  .agent-io/rejections.jsonl          ★ **文件不存在**（①的仪表至今没写过一条 —— 因为没有真实拒绝发生过）
```

**⇒ 结论：「一个人工填了几个槽」这件事，仓里没有任何账本记录过。**
**⇒ 而 `①` 装的仪表只覆盖 `D`（被拒次数），**不覆盖 `F`（人工槽数）**。**

★ 所以 ① 与 ② 的关系要修正：**① 不是 ② 的全部前置，只是 `D` 列的前置。**
`F` 列需要**第二台仪表** —— 记录每次 dsl op 调用的 `data` 键集与其中"来源 ∉ {actual-db, design, rule}"的个数。

### 分位数参考（不是 F_B，别当依据）

```
OP_SPECS: (type,op) 组里带 required 键的 = 33 组 · required 键槽总计 = 39
★ 这是**全表**的分母，不是"一次运行要填多少"。一次完整取卡链只用到其中 3–5 个 (type,op)。
```

---

## 八、这次实验本身踩到的两个坑（下次别踩）

```
① hold-out 用 `../src/*.js` 指向 TS 源 ⇒ 裸 `node --test` 报 ERR_MODULE_NOT_FOUND。
   ★ 必须 `node --import tsx`（`scripts/run-tests.mjs:40` 逐字写着这条）。
② hold-out 放进树根 ⇒ `../src` 解析到树的**父目录**（我第一次跑出 8/8 全红，是脚本位置错了，
   不是 A 段做错了）。⇒ 必须放 `<tree>/tests/`。
★ 两次都是**我的操作失误被读成"被测对象失败"** —— 而这正好是今晚那七种假绿的第八种：
  **判分脚本放错位置，看起来像被测对象全错。**
```
