# 铁路票务 API 说明

本文件只记录后端接口口径；安装、启动和整体架构见 `README.md`，版本变更见 `CHANGELOG.md`。

## 路由与鉴权

- 当前铁路模组主接口前缀为 `/railway`；后台铁路管理子接口为 `/railway/admin/...`。
- 旧版检票监控设备接口仍保留在根路径 `/devices`，由后台登录态校验。
- 前台售票 / 查询接口：无需令牌。
- 模组内部写接口（支付、打印、退改等）：请求头 `x-railway-token`，值与后台 `railwayAdminToken` 一致。
- 后台管理接口：后台登录态；铁路模组管理接口同时校验 `x-railway-token`。

## 铁路售票机数据

### GET `/railway/tvm/bootstrap`

查询车站可售车次、席别余票、开检状态和品牌设置。

查询参数：

| 参数 | 说明 |
| --- | --- |
| `station` | 车站名称 |
| `date` | 乘车日期，`YYYY-MM-DD` |

返回摘要：品牌、日期、`metroEnabled`、`metroStation`、车站、车次列表；车次包含发车 / 到达时间、票价、席别、余票、开检状态。`metroStation=true` 表示当前车站出现在地铁线路经停表中，售票机可开放储值卡充值。

### GET `/railway/tvm/seats`

查询某车次、日期、席别的可选座位。

查询参数：`trainId` 或 `trainNo`、`seatType`、`date`。

### POST `/railway/orders`

创建订单。服务端不信任前端传入票价；成交价按车站坐标和车次经停段自动计算。

请求体核心字段：

```json
{
  "trainId": "t_xxx",
  "stationName": "南京南",
  "toStationName": "上海虹桥",
  "date": "2026-11-27",
  "seatType": "二等座",
  "passengers": [{ "name": "张三", "idNo": "xxx", "type": "成人" }],
  "seatIndexes": [2]
}
```

拦截规则：

- 乘客命中高铁黑名单时禁止购票。
- 单笔乘客数受系统设置 `maxPassengersPerOrder` 限制。
- 证件号不能重复。

### POST `/railway/orders/:orderNo/pay`

模组内部支付回调。需要 `x-railway-token`。

### POST `/railway/orders/:orderNo/print`

回写车票打印状态。需要 `x-railway-token`。

### POST `/railway/orders/:orderNo/reprint`

补打车票 / 报销凭证 / 行程信息单。请求体 `kind=ticket|voucher|itinerary`。

### POST `/railway/orders/:orderNo/refund`

退票。手续费由后端按规则计算；实际货币发放由模组在游戏内完成。

### POST `/railway/orders/:orderNo/change`

改签。后端按新车次 / 日期 / 席别计算补退差额和改签手续费。

## 检票设备（旧版监控链路）与购票机台账

### GET `/devices`

后台 / 检票员查看旧版监控链路中的所有闸机设备。

### POST `/devices`

新增检票闸机设备。

```json
{
  "stationId": "s_xxx",
  "gateNo": "A01",
  "name": "进站闸机",
  "gateType": "entry",
  "status": "normal"
}
```

### PUT `/devices/:id`

更新闸机状态、欢迎语、摄像头 / 预览等远程配置；配置变更会递增 `configVersion` 并广播。

## 黑名单

### GET `/railway/admin/blacklist?mode=highspeed|metro`

查询高铁或地铁乘车人黑名单。

### POST `/railway/admin/blacklist`

新增黑名单记录。

```json
{
  "mode": "highspeed",
  "name": "张三",
  "idNo": "xxx",
  "reason": "管理员手动封禁",
  "minutes": 0
}
```

`minutes=0` 表示永久；大于 0 表示封禁时长。

### DELETE `/railway/admin/blacklist/:id?mode=highspeed|metro`

解除黑名单。

## 模组设备配置

### GET `/railway/admin/devices`

模组内部或管理员读取检票机台账。返回每台设备的 `id`、`stationId`、`stationName`、`gateNo`、`gateType`、`status`、`maintenanceText`、`configVersion` 与 `remoteConfig`；模组按车站 + 闸机编号绑定到实际方块，并应用类型、停用/维修状态和远程配置。

### GET `/railway/admin/tvms`

查询后台登记的购票机 / 售票机台账。

### POST `/railway/admin/tvms`

登记购票机。

```json
{
  "stationId": "s_xxx",
  "name": "1 号购票机",
  "kind": "ticket-machine",
  "pos": { "x": 0, "y": 64, "z": 0 },
  "status": "normal"
}
```

### PUT `/railway/admin/tvms/:id`

更新购票机名称、状态、位置和配置版本。

### DELETE `/railway/admin/tvms/:id`

删除购票机台账。

## Create 时刻表批量导入

### POST `/railway/admin/timetable/import`

按车次批量 upsert 完整经停序列、时刻、站台、检票口、地标颜色和席别；车次号已存在时更新，不存在时新增。单次最多 200 条。

请求体：

```json
{
  "trains": [
    {
      "trainNo": "G7501",
      "type": "高速动车",
      "departTime": "08:00",
      "arriveTime": "09:30",
      "platform": "5",
      "gates": ["B12"],
      "landmarkColor": "蓝色",
      "seats": [
        { "type": "商务座", "price": 439, "total": 8 },
        { "type": "二等座", "price": 139.5, "total": 320 }
      ],
      "stops": [
        { "stationName": "杭州东", "departTime": "08:00", "km": 0 },
        { "stationName": "苏州北", "arriveTime": "09:30", "km": 1323 }
      ]
    }
  ]
}
```

`stops` 至少两个车站，顺序即列车运行方向；首站为出发站，末站为到达站。返回 `{ total, imported, failed, messages }`，逐条记录成功或失败原因。

## Create / CRN / Simurail 兼容桥

兼容桥默认关闭，用于在 12306 后台、模组与 Create、Create Railways Navigator（CRN）、Simurail 之间预留车站、车次、列车位置与检票口状态的双向联动位。当前版本先落地状态读取、外部快照拉取和 12306 快照回写；游戏内 Create 调度事件直接订阅仍需后续按模组 API 接入。

### GET `/railway/admin/compat`

返回兼容桥开关、外部接口地址、各来源最近同步状态与已缓存的车站/列车快照。

### POST `/railway/admin/compat/pull?source=create|crn|simurail`

手动拉取外部模组快照：

- `crn`：读取配置中的 `crnApiBase`，拉取 `/trains`、`/stations` 并归一化为车次与车站快照。
- `simurail`：读取配置中的 `simurailApiBase`，按相同结构归一化。
- `create`：Create 调度时刻表主要走游戏内本地事件；Web 接口先写入桥接状态占位，后续再接本地事件桥。

### POST `/railway/admin/compat/push`

把 12306 当前车站、车次、经停、站台和检票口整理为兼容快照并写入兼容桥，供外部导航模组或显示屏订阅。

### GET `/railway/compat`

模组内部接口，需携带 `x-railway-token`；返回兼容桥状态和各来源快照，供模组客户端判断是否显示 Create/CRN/Simurail 联动信息。

## 地铁模式

地铁接口由 `settings.metroEnabled` 开关控制；关闭时相关内部接口返回“地铁模式未开启”。车票、储值卡数据独立保存在 `metroTickets`、`metroCards` 桶，并接入 `blacklists.metro` 黑名单。

### GET `/railway/metro/arrivals?station=<车站名>`

查询指定车站后续两班地铁预报。返回车次、线路、终到站、下一站、发车时刻和预计等待分钟数。预报时刻读取车次 `stops` 经停序列；未配置经停序列时回退车次起终点时刻。

### GET `/railway/metro/estimate?from=<出发站>&to=<到达站>`

自动试算地铁票价。计价规则：起步价 `metroBaseFare` + 每经过一个额外站加价 `metroFarePerStop`，并受 `minFare` / `maxFare` 限制。

### GET `/railway/metro/cards?cardNo=<卡号>`

查询储值卡列表；传入 `cardNo` 时只返回该卡。

### POST `/railway/metro/cards`

创建储值卡。请求体：`playerName`；可选 `idNo` 用于地铁黑名单校验。返回 `cardNo`、`playerName`、`balance`、`deposit`。

### POST `/railway/metro/cards`

储值卡充值。请求体：`action="recharge"`、`cardNo`、`amount`。

### GET `/railway/metro/tickets`

查询地铁单程票记录。

### POST `/railway/metro/tickets`

购买单程票。请求体：`playerName`、`from`、`to`；可选 `idNo` 用于地铁黑名单校验。票价由后端按地铁规则自动计算，不接受前端传价。

## 系统设置

### GET `/settings`

返回完整系统设置。

### PUT `/settings`

后台修改系统设置。当前铁路相关字段包括：

| 字段 | 说明 |
| --- | --- |
| `systemName` | 铁路系统名称 |
| `logoUrl` | Logo 地址 |
| `railwayBureau` | 铁路局名称 |
| `railwayCurrency` | 游戏内货币标识 |
| `farePerBlock` | 每格距离票价系数 |
| `minFare` / `maxFare` | 最低 / 最高票价 |
| `checkinMinutes` | 发车前多少分钟开检 |
| `supplementFeeRate` | 补票费率 |
| `quickBoardingMinutes` | 临发车提示分钟数 |
| `gateScreenEnabled` | 闸机屏幕提示开关 |
| `versionStage` | 版本阶段标识，如 `BETA` |
| `metroEnabled` | 地铁模式开关 |
| `metroBaseFare` | 地铁起步价 |
| `metroFarePerStop` | 地铁每站加价 |
| `metroCardDeposit` | 储值卡押金 |
| `createCompatEnabled` | Create / CRN / Simurail 兼容桥总开关 |
| `crnApiBase` | CRN Web API 地址前缀 |
| `simurailApiBase` | Simurail 外部接口地址前缀 |
| `compatPullIntervalSeconds` | 兼容桥快照刷新间隔（秒） |
