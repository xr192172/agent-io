# 测量：写入成本 / 过闸损耗 —— 2026-11-06

> 这份文件存在的唯一理由：**P29**（`docs/PITFALLS.md`）。
> 「写进卡/目标/commit message 之前先问：这个数在仓里有落点吗？没有就当场落盘。」
>
> 所以下面每个数都带**复算命令**。**不许在别处引用一个这里的数而不指向这里。**

---

## 结论（一句话）

**「写进去太贵」这个诊断，在本仓现在没有任何落点能证实或证伪 —— 因为业务拒绝不进任何一本账。**

---

## 一、`usage.jsonl` 里到底有什么

```
文件：.agent-io/dogfood/usage.jsonl
规模：26,187 行（2026-10-27 .. 2026-11-06）
字段：ts, tool, via, ok, ms, err, nextHops, action

ok=false 共 114 次（0.4%）
  ├── 84 次 = 固定模式「坏签名[paths[0]]」/「坏签名[The "path"]」/「坏签名[Cannot read propert…]」
  │           ⇒ 同一秒内**每个工具各记一遍 × 数批** = **健康探测，不是真实使用**
  │             （★ 此处不写死批数与工具数：它们是某一刻的读数，写进散文就会过第二次期。
  │               要现算就重跑下面第四节 ② 那条命令，按同一秒分组数一遍。）
  └── 30 次 = 看起来像真拒绝
```

## 二、那 30 次「像真拒绝」的，逐条查下来是测试夹具

```
task-gate   14
plan-gate    7
rollback     7
other        2   （缺参数）
```

**但看时间戳与对象：**

```
2026-11-02T13:37:51 .. 14:02:44
全部指向 **src/a.js** / 节点 **file_src_b_js**
同一组三步（task-gate → plan-gate → rollback）**重复了 7 遍**

⇒ 那是**一组测试夹具跑了 7 次**，不是真实使用。
⇒ 剩下 2 次是「缺参数」。
⇒ **这份日志里，真实使用中的业务拒绝 = 0。**
```

## 三、为什么量不到（机制）

```
`usage.jsonl` 的 `ok:false` **只在工具有抛异常时置位**。
而业务拒绝（任务闸 / 重写计划闸 / 「判据不够」）是 **`isError: true` 的正常返回**
⇒ 被记成 `ok:true`。
```

**三个独立来源确认同一个盲区：**

| 来源 | 原话 |
|---|---|
| T-32（只读侦察） | 「`write_log` 的 `kind` **只有 `commit`**（492 行），**无被拒记录**」 |
| T-31 卡（自承） | 「测试文件结构性开不了画布 ⇒ 死锁 ⇒ 只能走 Write/Edit 直写 ⇒ **不入写账**」 |
| 本文件 | `usage.jsonl` 的 `ok` 只记"有没有抛异常"，不记"业务是否拒绝" |

⇒ **「过闸损耗」这个数，仓里三个账本都没有它。**

## 四、复算命令

```bash
# ① 总数 / ok=false / 按工具
node -e "const fs=require('fs');const L=fs.readFileSync('.agent-io/dogfood/usage.jsonl','utf8').split('\n').filter(x=>x.trim());const r=L.map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);const bad=r.filter(x=>x.ok===false);console.log('total='+r.length+' bad='+bad.length)"

# ② 剔掉探测（"坏签名"）后还剩多少
node -e "const fs=require('fs');const L=fs.readFileSync('.agent-io/dogfood/usage.jsonl','utf8').split('\n').filter(x=>x.trim());const r=L.map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);const bad=r.filter(x=>x.ok===false&&!/坏签名/.test(String(x.err||'')));console.log('real='+bad.length)"

# ③ 那批是不是夹具：看时间与对象
node -e "const fs=require('fs');const L=fs.readFileSync('.agent-io/dogfood/usage.jsonl','utf8').split('\n').filter(x=>x.trim());const r=L.map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);for(const x of r.filter(y=>y.ok===false&&/src\/a\.js/.test(String(y.err||''))))console.log(x.ts+' '+x.tool)"
```

## 五、这份测量**不能**说明什么（说清楚，防止被误用）

```
✗ 不能说明「过闸很贵」—— 没有数。
✗ 不能说明「过闸不贵」—— 也没有数。
✗ 不能说明 `verify` 的**全量门**与"写一条判据时挡你的闸"是同一批 ——
  （前者是**提交前**跑的全量检查，后者是**写入口**的准入规则，**两回事，不许混成一个数**。
    ★ 门的总数**不写死** —— 它由 `scripts/verify.mjs` 现算。）
```

## 六、要量它，必须先做什么

```
让业务拒绝进账：`isError: true` 的正常返回要有一个**可累计的 rejected 标记**，
并且能被一个聚合读数取出来。

⇒ 在那之前，「写进去太贵」只能是一个**假设**，不能是一个**依据**。
```

## 七、与 T-21 那个数的关系（重要）

```
会话里曾引用「T-21 量出 立卡:判据1:判据2 = 2:1:1，收尾 = 5 次调用」。
★ 全仓 grep `2:1:1` = **0 命中**；`T-21` = **0 命中**。
⇒ 那个数**没有落点**，本文件**不采用**它，也不复制它。
⇒ 若将来要恢复那个结论，必须用可复算的方式重测（例如上面第六节那个标记做出来之后）。
```
