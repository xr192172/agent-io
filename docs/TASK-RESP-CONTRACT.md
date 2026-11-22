# 任务卡 T-#RESP-CONTRACT · 数据契约边（交远端执行）

> 发布：lead（配合端）2026-11-22 · 接收：托管机引擎队 · 优先级：P1（防御性能力，不阻塞二开功能）
> 背景：布料店改造批 2 前端实测暴露的能力缺口——**跨语言数据契约无边可查**。

## 一、事故（判据锚·反例入册）

`fuintAdmin/src/views/deposit/index.vue` 的 getList 读幽灵键：

```js
// 前端（deposit/index.vue:383-385）消费键：
const data = response.data.dataList;
this.list = data.paginationResponse.content;   // ← paginationResponse 是幽灵键
```

```java
// 后端（BackendDepositController.java:90-97）响应键：
Map<String, Object> result = new HashMap<>();
result.put("dataList", paginationResponse);    // ← dataList 的值就是 PaginationResponse 本体（无嵌套 paginationResponse 键）
result.put("depositStatusList", ...); result.put("depositTypeList", ...); result.put("storeList", ...);
```

**后果**：页面永久"暂无数据"（库里有 2 行、API 返回 totalElements:2）——**静态无红、运行时静默空**（直到 F 系行为判据 F2a 实战抓到）。

## 二、能力缺口

引擎边体系（call/type_ref/import/api_endpoint/mapper/response）全是**结构层**——"谁调用谁"可查，但 **Controller 响应 JSON 键 ↔ 前端消费 JSON 键** 的形状匹配无从判定。此事故=该层缺失的实证。

## 三、卡设计（api_endpoint_edges 的姊妹卡——同款方法论）

1. **Java 侧提取**：Controller 方法体内的响应键集合——静态模式：`result.put("key", ...)` / `Map<String,Object> result` 的键 / 返回 DTO 的字段名（DTO 字段经 getter 反射或源码解析）；
2. **前端侧提取**：api 消费点的消费键集合——`response.data.X.Y` 的静态模式（X=响应根键，Y=嵌套消费键）；
3. **建边**：`response_contract` 边——Controller 方法 ↔ 前端消费点，metadata 记两侧键集合；
4. **判据（有牙）**：前端消费键 ⊆ 后端响应键——**幽灵键 = 红**（反例即第一节的事故：消费键 paginationResponse 不在后端响应键集合 {dataList, depositStatusList, depositTypeList, storeList, imagePath} 内 → 红）。

## 四、验收

1. 反例回归：deposit/index.vue 的幽灵键被判据红（当前代码态直接跑）；
2. 正例：至少 3 个健康端点（如 member/order/goods 的既有配对）判据绿；
3. mutation：改后端响应键名（模拟契约漂移）→ 对应前端消费点红；
4. 边数据入库（cache.db edges 表 kind='response_contract'）+ capability_map 可查。

## 五、参考与边界

- 方法论姊妹：`src/infrastructure/analysis/api_endpoint_edges.ts`（Controller 端点↔前端 url 的跨语言建边先例——键提取的解析器形状可参照其 normApiUrl/segJoin 的"唯一归一处"纪律）；
- 测试参照：`tests/p1_api_edges.test.ts`（mutation 逐条红的写法）；
- **边界**：只做 agent-io 引擎能力 + 判据；不动布料店项目仓（fuintFoodSystem_v2.2——lead 独立负责）；
- 前提：父仓索引已刷新（deposit/equipment 域 264+420 边在册——提取的输入面就绪）。
