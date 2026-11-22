# 清江铁路 · CRH 独立票务附属 + 网页端

适用：Minecraft **1.21.1 / NeoForge 21.1.233**  
交付由两个**互相独立**的部分组成：

| 目录 | 说明 |
| --- | --- |
| `railway-addon` | 独立附属模组（mod id `hexie_railway`），有自己的 gradle 工程，**不修改 CRH 源码** |
| `web` | 独立网页端 + 管理后台，Node.js 进程，不打包进模组 |

CRH（mod id `hexie`）只作为**可选前置**：附属通过方块/物品注册名联动，没装 CRH 时身份证、报销凭证、车票仍存在，但售票机/闸机逻辑不会触发。

> CRH 源码保持原版：此前直接写进 CRH 的票务原型已从源码中撤回，票务逻辑全部只存在于 `railway-addon`。安装时只需把附属 jar 与 CRH jar 一起放进 `mods`。

---

## 一、快速开始

### 1. 构建附属

```powershell
cd "E:\新建文件夹\railway\railway-addon"
.\gradlew.bat build
```

已内置国内镜像：

- Gradle 发行包：腾讯云 `mirrors.cloud.tencent.com/gradle/`
- NeoForge / Minecraft 依赖：BMCLAPI `bmclapi2.bangbang93.com/maven`
- 公共 Maven：阿里云、华为云、腾讯云
- Gradle 插件：阿里云 `gradle-plugin`
- 后台 npm：`web/admin/.npmrc` 已指向 `registry.npmmirror.com`

产物：`build\libs\HexieRailwayAddon-1.21.1-1.0.3.jar`。  
每次执行 `build` 会自动把补丁号 +1（写入 `gradle.properties`），需要临时关闭时加 `-PnoVersionBump`。
放进 `mods`，与 `CRH-HeXie-*.jar` 同目录即可。客户端想用内嵌网页，再放 MCEF（NeoForge 1.21.1，2.1.x）。

### 2. 启动网页端

```powershell
cd "E:\新建文件夹\railway\web\ticket"
$env:PORT = "3000"
node server.js
```

`http://127.0.0.1:3000` 购票，`http://127.0.0.1:8001` 人工后台（账号 `admin / 123456`）。  
8001 是后台前端端口，可由 `web\admin` 的 dev 服务提供；若未启动，可在 `web\admin` 执行 `npm run dev`。

### 3. 配置附属

首次启动生成 `config/hexie_railway-common.toml`（公共配置）：

```toml
[web]
    baseUrl = "http://127.0.0.1:3000"
    adminBaseUrl = "http://localhost:8001"
    adminToken = "qingjiang-railway-mod"
    fallbackCheckinMinutes = 30
    emeraldsPerFareUnit = 1
    currencyItem = "minecraft:emerald"
    currencyName = "绿宝石"
    currencyPerFareUnit = 1
    gateOpenTicks = 15
```

- `baseUrl` 必须能被**游戏服务端**访问。
- `adminBaseUrl` 是 POS/电脑/人工检票机在游戏内 MCEF 打开的 8001 后台地址。
- `adminToken` 与后台“系统设置 → 铁路品牌 → 模组管理令牌”一致。
- `fallbackCheckinMinutes` 只在网页端暂时不可用时兜底；正常情况下开检时间由后台设置自动同步。
- `currencyItem` / `currencyName` / `currencyPerFareUnit` 决定游戏内扣款物品与提示名称，例如改成 `minecraft:diamond`、`钻石`。
- `gateOpenTicks` 是闸机开门保持时间，默认 15 tick（0.75 秒），调小可减少尾随，调大方便通行。

---

## 二、身份证（自动填写身份信息）

```mcfunction
/give @s hexie_railway:id_card
```

身份证第一次进入玩家背包时，`inventoryTick` 自动写入：

- 姓名：玩家游戏名
- 证件号：由 UUID 稳定生成的 18 位游戏内证件号（非真实证件）

所以 `/give`、创造模式物品栏、复制物品拿到的身份证，捡到后都会自动带信息，不需要手动登记。

> 已放入售票机的身份证会保存在附属自己的世界数据里；潜行 + 空手右键售票机可取回。

### 新增人工设备

| 物品 | 注册名 | 用法 |
| --- | --- | --- |
| 铁路电脑方块 | `hexie_railway:computer` | 管理员右击在游戏内打开 `http://localhost:8001/` 后台；普通玩家右击发起现金支付，聊天栏显示未支付车票信息 |
| 手持 POS | `hexie_railway:pos` | 管理员右击在游戏内直接打开 `http://localhost:8001/sales/index`（售票窗口） |
| 人工检票机 | `hexie_railway:manual_checker` | 管理员右击打开 `http://localhost:8001/checkin/index`（检票管理），并让面前 6 格内的 CRH 闸机开门 |
| 车站引导屏 | `hexie_railway:guide_screen` | 无右键交互，放置后自动显示所在车站的 `guide.html`；相邻同朝向的屏自动拼成一条长屏，网页按整条屏的宽高自适应缩放 |

电脑/POS/人工检票机都要求权限等级 2（OP）才能使用工作人员界面；普通玩家使用电脑只会发起现金支付请求。

车站引导屏说明：

- 放置时按玩家朝向决定屏幕正面，可用普通方块方式旋转（如结构方块/命令 `setblock` 时指定 `facing`）。
- 自动读取放置位置所属车站的网页后台 ID；屏幕会显示该站的检票口引导。
- **拼屏**：相邻、同朝向、同车站的引导屏自动组成矩形屏幕，最大 **16 宽 × 16 高**；每个方块显示整页对应的一块切片。
- 屏幕较小时按单块比例显示；达到 6×6 以上会随方块数量自动放大字号，16×16 时字号约为单块的 2.4 倍，远处也能看清。
- 网页端以 `?embed=1&cols=<宽>&rows=<高>` 打开，按整屏比例渲染并自动缩放；未安装 MCEF 时只显示深色屏体，不会崩溃。

---

## 三、售票机流程

### 1. 放入身份证

手持身份证右键 CRH 的售票机方块：

1. 身份证被放入售票机（玩家手上数量 -1）；
2. 自动打开售票界面；
3. 界面标题携带车站、姓名、证件号，网页据此自动选站、锁定乘车人。

没放身份证：

- 空手右键且售票机里没有身份证 → 提示“请先用身份证右键售票机”，不打开 UI；
- 手里拿别的东西 → 同样提示，不打开。

### 2. 内嵌网页购票

安装 MCEF 时，售票机界面直接加载：

```
http://127.0.0.1:3000/tvm.html?station=南京南&name=张三&idNo=...&embed=1
```

- 公告栏来自后台设置；
- 车次列表来自 `/api/railway/tvm/bootstrap`；
- 下单 `source=machine`，与普通网页订单分开统计；
- **内部售票机订单自动支付**，下单后直接是 `paid`，不再要求 `/railway pay`；
- 点“打印车票” → `#print=订单号` → 附属代执行 `/railway print`，**直接给玩家车票物品**；
- 点“打印报销凭证” → `#voucher=订单号` → 附属代执行 `/railway voucher`，**直接给玩家报销凭证**；
- 工具栏“补打车票 / 报销凭证”：输入已支付订单号查询后，内嵌页面重新生成车票或报销凭证物品；普通浏览器生成对应打印预览。
- 空报销凭证的 tooltip 显示“空的报销凭证”，有数据时显示 `G1145 南京南站->清江南站` 这类车次区间。

未安装 MCEF 时，售票机显示引导面板（持证人、公告、网页地址），不会崩溃。

### 3. 手动命令

```mcfunction
/railway pay                # 支付全部未支付车票；余额不足会提示“支付失败：余额不足”
/railway pay <订单号>       # 支付指定订单（输入后按 TAB 补全未支付订单号）
/railway print <订单号>     # 打印车票并直接放入背包，同时镜像进身份证
/railway reprint <订单号>   # 补打已打印过的车票（网页售票机补打按钮会调用它）
/railway voucher <订单号>   # 打印报销凭证并放入背包
/railway status             # 所在车站、已购车票、未支付车票
```

`/railway admin buy <玩家> <车次> <起点> <终点>` 可由管理员直接为玩家购票并出票。
车票优先使用 CRH 的 `hexie:red_ticket`；未安装 CRH 时使用附属的 `hexie_railway:railway_ticket`。  
两者都在 `minecraft:custom_data` 写入订单号、车次、起终站、日期、开检时间、票价、乘车人 NBT。  
背包里有身份证时，车票会自动镜像进身份证，之后可直接刷身份证检票。

---

## 四、闸机

| 类型 | 行为 |
| --- | --- |
| 进站（0） | 有有效车票/身份证即可放行，写入进站记录 |
| 检票（1） | 仅开检时间内放行；开检时间 = 发车时间 − 后台设置的提前分钟数 |
| 出站（2） | 必须有进站记录，否则提示“请联系工作人员（无进站记录）” |

- 开检提前分钟从网页后台 `checkinMinutes` **每 60 秒自动同步**，改后台立即影响之后所有刷卡；车票上的 `checkinStart` 仅作为无法读取发车时间时的兜底。
- 检票、进站、出站均**不验证人脸**。
- 报销凭证、已停用闸机、无票、超时、无进站记录都会在动作栏和聊天栏提示。
- 用户要求取消闸机上方悬浮字，世界空间文字已停用；闸机放行时会直接让 CRH 闸机的门打开并自动关闭。
- 同一张票**只能进站一次**；第二次刷进站闸机会提示“该票已进站”。如确需重新进站，在后台“检票管理 → 取消检票”取消该乘车人检票，再刷即可重新进站。

修改闸机：

- 手持 CRH 刷子（`hexie:*brush*`）右键：循环切换 进站 → 检票 → 出站；
- 潜行 + 右键：切换停用/启用。

---

## 五、车站划定与同步

```mcfunction
/railway admin station 南京南 POS1
/railway admin station 南京南 POS2
```

- 车站名用 `word` 参数，中文名直接写，**不需要引号**；
- 车站名补全会列出网页后台已建车站，添加后可直接选择；
- 不写坐标取准星指向的方块（48 格内），指空则取脚下；
- 也可显式写坐标：`POS1 100 64 200`；
- POS2 后自动：
  1. 划定车站长方体范围；
  2. 扫描范围内注册名为 `hexie:ticket_vendor` / `hexie:turns_a_block` / `hexie:turns_b_block` 的方块；
  3. 计算中心点；
  4. POST `/api/railway/admin/station` 同步后台；
  5. 后台按相邻停靠站自动生成每一段票价；售票时按车次经停顺序累加，A→C 经由 B 时票价 = A-B 段价 + B-C 段价。
  6. 席别以二等座为基准换算：一等座 = 二等座 × 1.5，商务座 = 二等座 × 2，结果四舍五入取整。

其他：

```mcfunction
/railway admin stations   # 列出本地车站、中心、闸机/售票机数量
/railway admin sync       # 重新同步全部车站
/railway admin station delete 南京南   # 删除车站：本地范围/闸机/售票机 + 网页后台记录与该站票价
/railway admin station 南京南 delete   # 同上，两种写法都可用
```

数据保存在 `<世界存档>/hexie_railway_addon.json`，与 CRH 的世界文件分开。

---

## 六、网页后台

### 票价管理 `/fares`

- 站点对距离、自动价、实际价、来源（自动/手动）。
- 新增、改价、恢复自动、删除、批量重算。
- 下方显示模组车站中心点、维度、铁路局、闸机/售票机数。

```
分段票价 = clamp(round(中心点距离 × farePerBlock), minFare, maxFare)
全程二等座票价 = 各相邻停靠站分段票价之和
一等座 = round(全程二等座 × 1.5)　商务座 = round(全程二等座 × 2)
```

售票机页面按席别显示票价与余票，下单时把席别一并提交；成交价由服务端重算，前端价格不参与结算。

默认 `0.02 / 1 / 64`，货币绿宝石。

### 铁路局 `/bureaus`

新建“清江铁路上海局”等，可设简称、主题色、备注；默认“清江铁路”。

### 系统设置 → 铁路品牌

- 铁路系统名称（默认“清江铁路”）、LOGO、默认铁路局；
- 每格票价系数、最低/最高票价；
- **开检提前分钟**（附属每分钟自动同步）；
- 模组管理令牌；
- 首页公告（售票机公告栏）。

### 车次管理 → 经停站

批量多选经停站、拖拽排序、填写里程、用出发/到达站快速填充；保存时随 `stops` 提交。

---

## 七、接口速查

前缀 `/api/railway`，附属请求头 `X-Railway-Token`。

| 方法 | 路径 |
| --- | --- |
| GET | `/railway/config` |
| GET | `/railway/stations` |
| GET | `/railway/tvm/bootstrap?station=` |
| POST | `/railway/orders` |
| GET | `/railway/orders?player=&keyword=&status=` |
| GET | `/railway/orders/:no` |
| POST | `/railway/orders/:no/pay` |
| POST | `/railway/orders/:no/print` |
| POST | `/railway/admin/station` |
| GET/POST/PUT/DELETE | `/railway/admin/fares` |
| POST | `/railway/admin/fares/recalculate` |
| GET/POST/PUT/DELETE | `/railway/admin/bureaus` |
| GET/PUT | `/railway/admin/settings` |

---

## 八、工程结构

```
railway-addon/
  build.gradle / settings.gradle / gradle.properties / gradlew
  src/main/java/qingjiang/railway/
    RailwayAddon.java          入口
    RailwayConfig.java         config/hexie_railway-common.toml
    RailwayWeb.java            HTTP 客户端
    RailwayStore.java          车站/闸机/售票机身份证的世界数据
    RailwaySettings.java       后台设置缓存（开检分钟/名称/公告/LOGO）
    TicketNbt.java             车票与身份证 NBT
    GateLogic.java             进站/检票/出站规则
    RailwayEvents.java         右键售票机/闸机、刷子、定时同步
    RailwayCommands.java       /railway 命令
    CrhCompat.java             按注册名识别 CRH 方块/物品
    ModItems.java              身份证/报销凭证/兜底车票
    ModMenus.java              售票机容器
    item/…                     物品实现
    network/…                  闸机提示包
    client/…                   MCEF 桥、售票机界面、闸机悬浮提示
  src/main/resources/…         mods.toml、模型、贴图、语言

web/
  ticket/server.js, db.js, public/tvm.html …
  admin/                        Vue3 + naive-ui 后台
```

---

## 九、构建状态与已知限制

1. **附属未在真实 NeoForge 环境编译**：本机 Gradle 访问 `maven.neoforged.net` 被网络拦截，源码已通过 `javac` 语法解析，但依赖/API 语义仍需在有网环境跑一次 `gradlew build` 验证。
2. 后台 `admin/node_modules` 缺 `vite/bin/vite.js`，未执行 `vite build`；先 `npm install` 再构建。
3. MCEF 首次运行需联网下载 Chromium 内核；下载失败会走原生引导面板，网页仍可外部访问。
4. 车票物品优先使用 CRH `red_ticket`，其原有 tooltip 可能不会显示附属写入的部分字段；闸机与附属命令读取 NBT 正常。
5. 验票只认身份证/车票物品，不做人脸；检票端 3001 已移除。
