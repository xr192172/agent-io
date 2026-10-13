#!/usr/bin/env bash
# T182b 出生证：**同步 overlay 时的"清除"必须被报出来**（此前返回值被整个丢掉 ⇒ 没人看得到）。
#
# 判据（先问"凭什么变红"）：造出"base 上已无、overlay 里还有"的状态 ⇒
#   ① overlay 里那份**必须被清**（不留僵尸）；
#   ② 而这次清除**必须出现在 `edit_dsl` 的回执里**（改之前：一个字都没有）。
# ★ 反例：没有可清的东西时，回执**不该**出现那句（否则就是"永远在喊"= 装饰）。
# 用法: bash certs/t182b-cert.sh
set -u
cd "$(dirname "$0")/.."

FEATURE=run82
FID=file_dogfood_build_cache_mjs
FPATH=dogfood/build_cache.mjs
LIVE=agent-io.json

reset() { node certs/t181-reset.mjs >/dev/null 2>&1; }

edit() { # $1 = data 片段
  node scripts/mcp/mcp_call.mjs edit_dsl \
    "{\"feature\":\"$FEATURE\",\"reason\":\"T182b 出生证：对 $FPATH 操作\",\"weight\":\"routine\",\"evidence\":[{\"type\":\"diff\",\"ref\":\"$FPATH\"}],\"operations\":[{\"type\":\"file\",\"op\":\"update\",\"id\":\"$FID\",\"data\":$1}]}" 2>/dev/null
}
overlayLc() { node -e '
const o=JSON.parse(require("fs").readFileSync(".agent-io/features/run82.overlay.json","utf8"));
console.log(JSON.stringify(o.anchors?.file_dogfood_build_cache_mjs?.lifecycle ?? null));
'; }

P=0; F=0
chk() { if [ "$2" = "$3" ]; then echo "✓ $1"; P=$((P+1)); else echo "✗ $1（期望 $3，实际 $2）"; F=$((F+1)); fi; }

echo "════ ⓪ 基线：先写一笔标记（两层都有）"
reset
edit '{"lifecycle":{"status":"deprecated","retire_reason":"T182b 出生证"}}' >/dev/null
chk "overlay 先拿到了标记" "$(overlayLc)" '{"status":"deprecated","retire_reason":"T182b 出生证"}'

echo
echo "════ ① 造出「base 上已无、overlay 里还有」——模拟"真相侧真的没了""
node -e '
const fs=require("fs");
const P="'"$LIVE"'";
const d=JSON.parse(fs.readFileSync(P,"utf8"));
const f=d.semantic.files.find(x=>x.id==="'"$FID"'");
delete f.lifecycle;
fs.writeFileSync(P, JSON.stringify(d,null,2), "utf8");
console.log("   （已从 base 删掉 lifecycle）");
'

echo
echo "════ ② 跑一次无关的 edit_dsl ⇒ 收口会清掉僵尸标记，并【必须报出来】"
OUT=$(edit '{"responsibility":"T182b 出生证：触发一次收口"}')
echo "$OUT" | grep -q '同步 overlay 时清除了' && R1=HIT || R1=MISS
echo "$OUT" | grep -q '文件生命周期标记 1 个' && R2=HIT || R2=MISS
chk "回执里有「同步 overlay 时清除了」" "$R1" "HIT"
chk "回执点名了是【待删标记】1 个" "$R2" "HIT"
echo "   ── 回执相关片段 ──"
echo "$OUT" | grep -A2 '同步 overlay 时清除了' | sed 's/^/   /'

echo
echo "════ ③ 僵尸确实被清了（不能只报不清）"
chk "overlay 里的标记已被清除" "$(overlayLc)" "null"

echo
echo "════ ④ 反例：没有可清的东西时，回执【不该】喊"
OUT2=$(edit '{"responsibility":"T182b 出生证：第二次（此时本来就干净）"}')
echo "$OUT2" | grep -q '同步 overlay 时清除了' && R3=HIT || R3=MISS
chk "干净时【不】出现那句（不是"永远在喊"）" "$R3" "MISS"

echo
echo "════ 汇总：PASS=$P  FAIL=$F"
reset
echo "（已还原）"
