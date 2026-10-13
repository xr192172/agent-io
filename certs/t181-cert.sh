#!/usr/bin/env bash
# T181 出生证：FileLifecycle 唯一校验器（assertLifecycle）是否真的【能红、能绿、能拦】
#
# 判据（★ 先问"凭什么变红"）：
#   注入非法 => 必须【显式报错】+ 命中**指定报文**（不是"因为别的原因红"）
#   合法值   => 必须【绿】且【真落盘】（不是写着支持其实没写进去）
#
# ★★ 两条教训（都保留在此，因为它们各骗过我一次）：
#   ① 初版用 `d1` 的 `src/a.ts` —— 那文件**磁盘上不存在** ⇒ 每条都在 **T20 facts 层**
#     就先红了（"缺现取到事实"），**根本没走到 assertLifecycle** ⇒ 表面"9 条全红"像通过，
#      其实是**因为别的原因红**。⇒ 现在：换 `run82`（400 个真实文件）+ **每条必须命中报文**。
#   ② 二版**不在用例间重置状态** ⇒ 上一例写进去的 `deprecated`+`retire_reason`
#      被**合并写**继承 ⇒ "缺 retire_reason"那例**反而绿了**（缺的字段从旧值补上了）。
#      ⇒ 那是**我的量具错**，不是产品错。现在：**每例先还原**（run82.json + overlay）。
#   ★ 而恰恰是这套"重置后重跑"逼出了**真缺陷**：裸字符串被展开成 {0:'d',…} 却**静默通过**
#     （status 从旧值继承、仍合法）⇒ 于是本仓多了 `LIFECYCLE_KEYS` 键集合校验。
# 用法: bash certs/t181-cert.sh
set -u
cd "$(dirname "$0")/.."

FEATURE=run82
FID=file_dogfood_build_cache_mjs
FPATH=dogfood/build_cache.mjs

# ★★ 还原必须覆盖【全部三层】（活态 agent-io.json / 存档 features / overlay）——
#   只还原一层会被 `getDSL` 的"优先活态"和"合并写继承旧值"双重骗过（见 certs/t181-reset.mjs 的注释）。
reset() { node certs/t181-reset.mjs >/dev/null 2>&1; }

PASS=0; FAIL=0
run() { # $1=标签  $2=期望(green|red)  $3=期望报文子串（- = 不查）
  local label="$1" want="$2" needle="$3"
  reset
  local json; json=$(op "$4")
  local out; out=$(node scripts/mcp/mcp_call.mjs edit_dsl "$json" 2>/dev/null)
  local got="green"
  if printf '%s' "$out" | grep -q 'isError=true'; then got="red"; fi
  local hit="MISS"
  if [ "$needle" = "-" ]; then hit="SKIP"; else
    if printf '%s' "$out" | grep -q -- "$needle"; then hit="HIT"; fi
  fi
  local verdict="✗"; local code=1
  if [ "$want" = "$got" ] && { [ "$hit" = "HIT" ] || [ "$hit" = "SKIP" ]; }; then verdict="✓"; code=0; fi
  if [ $code -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  printf '%s %-40s 期望=%-5s 实际=%-5s 报文=%s\n' "$verdict" "$label" "$want" "$got" "$hit"
  if [ $code -ne 0 ]; then printf '     └ 回执: %s\n' "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; fi
}

R='T181 出生证：对 dogfood/build_cache.mjs 做注入'
E='"evidence":[{"type":"diff","ref":"'"$FPATH"'"}],'
op() { printf '{"feature":"%s","reason":"%s","weight":"routine",%s"operations":[{"type":"file","op":"update","id":"%s","data":%s}]}' "$FEATURE" "$R" "$E" "$FID" "$1"; }

echo "════ ⓪ 正对照：合法值必须绿（量具自身先证明"能绿"）"
run "deprecated + retire_reason（带事实证据）" green "-" '{"lifecycle":{"status":"deprecated","retire_reason":"T181 出生证：实验用标记，稍后还原"}}'
run "active（撤回标记）"                      green "-" '{"lifecycle":{"status":"active"}}'

echo
echo "════ ① 形状错 ⇐ 必须红（第一版量具漏掉的那类：静默落垃圾）"
run "lifecycle 是裸字符串"                    red "不被认的键"   '{"lifecycle":"deprecated"}'
run "lifecycle 是数组"                        red "传成了数组"    '{"lifecycle":[{"status":"deprecated"}]}'
run "status 是数组（值形状错）"               red "status 非法"   '{"lifecycle":{"status":["deprecated"]}}'
run "混进一个不存在的键"                      red "不被认的键"   '{"lifecycle":{"status":"deprecated","retire_reason":"x","foo":1}}'

echo
echo "════ ② 非法枚举值 ⇐ 必须红（此前无校验时它会静默写进去）"
run "status=gone（枚举外）"                   red "status 非法"   '{"lifecycle":{"status":"gone"}}'
run "status=DELETE（大小写/拼写错）"          red "status 非法"   '{"lifecycle":{"status":"DELETE"}}'

echo
echo "════ ③ 旁路伪造归档 ⇐ 必须红（归档只有 archive 工具能做）"
# ★ T183 改了这里：`archive_id` 已从已知键里删掉 ⇒ 带它的载荷会**先**撞"不被认的键"
#   ⇒ 本行只测"旁路写 archived 被拒且**指路 archive**"这一件事（`archive_id` 那件事归 T183 的证）
run "status=archived（旁路，不带 archive_id）" red "不是设计 DSL 里的一种状态" '{"lifecycle":{"status":"archived"}}'
run "status=archived + archive_id"          red "不被认的键" '{"lifecycle":{"status":"archived","archive_id":"fake"}}'

echo
echo "════ ④ 必填字段缺失 ⇐ 必须红（在【无旧值可继承】的干净状态下判）"
run "deprecated 缺 retire_reason"             red "必须带 retire_reason" '{"lifecycle":{"status":"deprecated"}}'
run "deprecated 空串 retire_reason"           red "必须带 retire_reason" '{"lifecycle":{"status":"deprecated","retire_reason":"   "}}'
run "merged 缺 merged_into"                   red "必须带 merged_into"   '{"lifecycle":{"status":"merged"}}'
run "archived 缺 archive_id（旁路 + 缺字段）" red "不是设计 DSL 里的一种状态"       '{"lifecycle":{"status":"archived","retire_reason":"x"}}'

echo
echo "════ ⑤ 合并写语义（只在【已有旧值】时才有意义 ⇒ 本组特例：不重置）"
reset
node scripts/mcp/mcp_call.mjs edit_dsl "$(op '{"lifecycle":{"status":"deprecated","retire_reason":"第一笔"}}')" >/dev/null 2>&1
node scripts/mcp/mcp_call.mjs edit_dsl "$(op '{"lifecycle":{"retire_reason":"第二笔（不该把 status 弄丢）"}}')" >/dev/null 2>&1
node --input-type=module -e '
import { getDSL } from "./dist/src/infrastructure/storage.js";
const lc=(getDSL("run82").semantic.files||[]).find(x=>x.id==="file_dogfood_build_cache_mjs").lifecycle;
const ok = lc && lc.status==="deprecated" && lc.retire_reason==="第二笔（不该把 status 弄丢）";
console.log((ok?"✓":"✗")+" 合并写：只给 retire_reason ⇒ status 仍是 deprecated（增量保留）");
console.log("     getDSL 实读 =", JSON.stringify(lc));
'

echo
echo "════ ⑥ 落盘对拍：走一条合法写，再**经 getDSL 复读**（不信回执，信读到的东西）"
reset
node scripts/mcp/mcp_call.mjs edit_dsl "$(op '{"lifecycle":{"status":"deprecated","retire_reason":"T181 落盘对拍"}}')" >/dev/null 2>&1
node --input-type=module -e '
import { getDSL } from "./dist/src/infrastructure/storage.js";
const lc=(getDSL("run82").semantic.files||[]).find(x=>x.id==="file_dogfood_build_cache_mjs").lifecycle;
const keys=lc?Object.keys(lc):[];
const ok = lc && lc.status==="deprecated" && keys.every(k=>["status","retire_reason"].includes(k));
console.log((ok?"✓":"✗")+" 落盘：status=deprecated 且【没有垃圾键】 keys=["+keys.join(",")+"]");
console.log("     getDSL 实读 =", JSON.stringify(lc));
'
node -e '
// ★ 真正的落点检查：overlay（设计意图层）是否也记到了？—— 没有它，deprecated 活不过 rebuild
const fs=require("fs");
const s=fs.readFileSync(".agent-io/features/run82.overlay.json","utf8");
const has = s.includes("T181 落盘对拍");
console.log((has?"✓":"✗")+" overlay（设计意图层）里也留下了这笔标记 —— 有它才活得过 rebuild");
if(!has) console.log("     ⚠ 印证 docs/todo.md T182：overlay 不保留 lifecycle ⇒ 重建即丢");
'

echo
echo "════ 汇总：PASS=$PASS  FAIL=$FAIL"
reset
echo "（已还原 run82 / run82.overlay 到测试前状态）"
