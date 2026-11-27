# 铁路票务 API 说明

本文件只记录后端接口口径；安装、启动和整体架构见 `README.md`，版本变更见 `CHANGELOG.md`。

## 鉴权

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

返回摘要：品牌、日期、车站、车次列表；车次包含发车 / 到达时间、票价、席别、余票、开检状态。

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

## 设备与购票机台账

### GET `/devices`

后台 / 检票员查看所有闸机设备。

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

## 购票机台账

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
