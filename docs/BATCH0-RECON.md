# Batch-0 Recon Report (archived 2026-11-20 · scout-batch0 + lead rulings)

> Source: scout-batch0 full recon (2026-11-19 night) + lead rulings. Batch 0 = rider hide + table frontend-entry hide (device-domain migration deferred to batch 2) + restaurant-copy phase 1.

## Lead-verified conclusions

1. **rider is already naturally hidden**: uniapp riderPages (9 pages) are NOT registered in pages.json (dead files); fuintAdmin/Cashier/CashierWeb have zero rider references; menu seed has no rider items. Batch-0 rider side = ZERO code changes; acceptance = assert pages.json has no rider. riderPages/** + api/rider.js (9+1 files) stay until batch-2 migration (no diff now).
2. **Table hide = three mechanisms**:
   - fuintAdmin: menu served from DB (t_source, source_id=193 桌码管理, parent 84 商家管理) ⇒ **SQL migration script** (idempotent shape per update_for_20260910.sql; WHERE path+name, not id — live data may differ from seed).
   - fuintCashierWeb: hardcoded menuList (views/cashier/index.vue:274 桌台概览 item) ⇒ delete that one line + guard activeMenu.
   - fuintCashier (desktop): isomorphic pair (src/renderer/..., table item at :278) ⇒ **paired change** with Web.
   - fuintUniapp: no ClientTable/tableApi — table exists only as scan-qr + table-number display + tableId header ⇒ **deferred to batch 2** (backend clientApi/system/config still returns tableInfo; hiding frontend ≠ backend stops returning).
3. **Copy changes (164 hits, five classes)**: config-class 11 (manifest×2/config.js/.env×3/vite.config/package.json/custom-tab-bar/pages.json) + decorate defaults ~30 + cashier table UI ~70 + admin table-code ~14 + rider 6. Brand name 「fuint餐饮系统」exact hits: 3 (manifest:2,:113, config.js:3); the admin side uses 「fuint餐饮点餐营销管理系统」(5 places: .env×3, vite.config:13, package.json:4) — both must go to zero.
4. **Six residual risks**: R1 frontend still calls table endpoints (Admin 4 methods + cashierWeb 4 endpoints + fuintCashier 4 calls INVISIBLE to api_endpoint edges — known index blind spot); R2 TableService called by 12 non-table pages; R3 orders naturally carry tableInfo; R4 rider has no residual consumers (safe); R5 tableId header global fallback; R6 TableArea has no frontend (batch 2).
5. **Index blind spots (registered)**: api_endpoint edges do not cover fuintUniapp (0); pages.json/manifest.json not in files table; fuintCashier table calls invisible. ⇒ Batch-0 acceptance must read config files directly, not rely on index edges.

## Open items for batch-0 executor
1. table:index permission string vs t_source mapping (hasPermi data source unverified);
2. Live t_source data (SQL must WHERE path, not id);
3. deploy/web is a STALE build (rebuild after source changes or deploy dir still carries table pages);
4. unpackage old build artifacts vs source sync unverified.

## Batch-0 card shapes (as dispatched to exec-batch0)
- Card A: SQL migration (t_source 桌码管理 status='D', idempotent, path+name WHERE) + acceptance (admin menu tree has no 桌码管理).
- Card B: fuintCashierWeb + fuintCashier paired change (menuList delete table item + activeMenu guard) — isomorphic files changed identically.
- Card C: copy phase 1 (config-class: brand 「fuint餐饮系统」→「手作工坊」placeholder + VUE_APP_TITLE → fuint手作工坊管理系统 + tab text dual-sync: 点单→体验).
- Acceptance: ①pages.json no rider; ②admin menu tree no 桌码管理; ③both cashier menuList no 'table'; ④brand-name grep=0 (both 口径); ⑤**untouched**: riderPages files, table backend endpoints, uniapp scan entry, TableArea.
