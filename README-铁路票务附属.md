# 机械动力:铁路增强 · Create Railway Plus + 网页端

适用：Minecraft **1.21.1 / NeoForge 21.1.233**  
交付由两个**互相独立**的部分组成：

| 目录 | 说明 |
| --- | --- |
| `railway-addon` | 独立附属模组（mod id `railway_plus`），有自己的 gradle 工程，售票机与闸机均为本模组自带方块 |
| `web` | 独立网页端 + 管理后台，Node.js 进程，不打包进模组 |

售票机、两类闸机、车票、身份证和报销凭证均注册在 `railway_plus` 命名空间内，不依赖 HeXie / CRH 模组。

`create`、`createrailwaysnavigator`（CRN）、`simurail` 均为可选兼容前置：未安装时附属仍可启动；安装后后端兼容桥可预留车站、车次、列车位置与检票口状态的双向联动位。

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

产物：`build\libs\CreateRailwayPlus-1.21.1-1.0.6.jar`。
每次执行 `build` 会自动调整版本号并写回 `gradle.properties`：稳定版补丁号 +1；`BETA.1` → `BETA.2` → `BETA.3` → `BETA.4` → `BETA.5`，到 `BETA.5` 后再构建自动回到下一稳定补丁号（如 `1.0.6-BETA.5` → `1.0.7`）。需要临时关闭时加 `-PnoVersionBump`。
放进 `mods` 即可运行；客户端想用内嵌网页，再放 MCEF（NeoForge 1.21.1，2.1.x）。

### 2. 启动网页端

```powershell
cd "E:\新建文件夹\railway\web\ticket"
$env:PORT = "3000"
node server.js
```

`http://127.0.0.1:3000` 购票，`http://127.0.0.1:8001` 人工后台（账号 `admin / 123456`）。  
8001 是后台前端端口，可由 `web\admin` 的 dev 服务提供；若未启动，可在 `web\admin` 执行 `npm run dev`。

### 3. 配置附属

首次启动生成 `config/railway_plus-common.toml`（公共配置）：

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
- `adminBaseUrl` 是电脑/人工检票机在游戏内 MCEF 打开的 8001 后台地址。
- `adminToken` 与后台“系统设置 → 铁路品牌 → 模组管理令牌”一致。
- `fallbackCheckinMinutes` 只在网页端暂时不可用时兜底；正常情况下开检时间由后台设置自动同步。
- `currencyItem` / `currencyName` / `currencyPerFareUnit` 决定游戏内扣款物品与提示名称，例如改成 `minecraft:diamond`、`钻石`。
- `gateOpenTicks` 是闸机开门保持时间，默认 15 tick（0.75 秒），调小可减少尾随，调大方便通行。

---

## 二、身份证（自动填写身份信息）

```mcfunction
/give @s railway_plus:id_card
```

身份证第一次进入玩家背包时，`inventoryTick` 自动写入：

- 姓名：玩家游戏名
- 证件号：由 UUID 稳定生成的 18 位游戏内证件号（非真实证件）

所以 `/give`、创造模式物品栏、复制物品拿到的身份证，捡到后都会自动带信息，不需要手动登记。

> 已放入售票机的身份证会保存在附属自己的世界数据里；潜行 + 空手右键售票机可取回。

### 新增人工设备

| 物品 | 注册名 | 用法 |
| --- | --- | --- |
| 铁路售票机 | `railway_plus:ticket_vendor` | 玩家右键打开内嵌购票网页；放入身份证后可读取身份信息，潜行 + 空手右键可取回 |
| 闸机 | `railway_plus:gate_a` | 模组自带进站闸机外观；持机械动力扳手可在进站 / 检票 / 出站三种模式间切换 |
| 国铁闸机 | `railway_plus:gate_b` | 模组自带出站闸机外观；持机械动力扳手可在进站 / 检票 / 出站三种模式间切换 |
| 铁路电脑方块 | `railway_plus:computer` | 管理员右击在游戏内打开 `http://localhost:8001/` 后台；普通玩家右击发起现金支付，聊天栏显示未支付车票信息 |
| 人工检票机 | `railway_plus:manual_checker` | 管理员右击打开 `http://localhost:8001/checkin/index`（检票管理），并让面前 6 格内的模组闸机开门 |
| 管理员闸机卡 | `railway_plus:admin_card` | 右键任意闸机直接放行，不校验车票、身份证、储值卡或闸机停用状态 |
| 车站引导屏 | `railway_plus:guide_screen` | 无右键交互，放置后自动显示所在车站的 `guide.html`；相邻同朝向的屏自动拼成一条长屏；管理员可用 `/railway admin screen scale <x y z> <0.5~1.5>` 调整单屏缩放 |

电脑/人工检票机、管理员闸机卡都要求权限等级 2（OP / 工作人员）；普通玩家使用电脑只会发起现金支付请求，管理员旁路物品会被拒绝。

车站引导屏说明：

- 放置时按玩家朝向决定屏幕正面，可用普通方块方式旋转（如结构方块/命令 `setblock` 时指定 `facing`）。
- 自动读取放置位置所属车站的网页后台 ID；屏幕会显示该站的检票口引导。
- **拼屏**：相邻、同朝向、同车站的引导屏自动组成矩形屏幕，最大 **16 宽 × 16 高**；每个方块显示整页对应的一块切片。
- 屏幕较小时按单块比例显示；达到 6×6 以上会随方块数量自动放大字号，16×16 时字号约为单块的 2.4 倍，远处也能看清。
- 网页端以 `?embed=1&cols=<宽>&rows=<高>` 打开，按整屏比例渲染并自动缩放；未安装 MCEF 时只显示深色屏体，不会崩溃。

---

## 三、售票机流程

### 1. 放入身份证

手持身份证右键模组自带售票机方块：

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
- 车次列表来自 `/railway/tvm/bootstrap`；
- 下单 `source=machine`，与普通网页订单分开统计；
- **内部售票机订单自动支付**，下单后直接是 `paid`，不再要求 `/railway pay`；
- 购票弹窗支持：席别、单程/往返、返程车次、最多 5 位乘客（可后台调上限）、每位乘客姓名/身份证/成人·儿童·学生票种、指定座位或系统分配；合计按成人/儿童/学生折扣实时计算。
- 座位下拉来自 `/railway/tvm/seats`；换席别会重新拉取空座，已被占用的座位不会重复出现。
- 点“打印车票” → `#print=订单号` → 附属代执行 `/railway print`，**直接给玩家车票物品**；
- 点“报销凭证 / 行程信息单” → 附属代执行 `/railway voucher`、`/railway itinerary`，**直接给玩家对应凭证**；
- 订单卡片支持退票、改签；改签先按新路线报价，再由游戏内扣差价或退差价。
- 工具栏“订单服务 / 补打”：输入已支付订单号查询后，可分别补打车票、报销凭证、行程信息单，或办理退票、改签；普通浏览器生成对应打印预览。
- 空报销凭证的 tooltip 显示“空的报销凭证”，有数据时显示 `G1145 南京南站->清江南站` 这类车次区间。

未安装 MCEF 时，售票机显示引导面板（持证人、公告、网页地址），不会崩溃。

### 3. 手动命令

```mcfunction
/railway pay                # 支付全部未支付车票；余额不足会提示“支付失败：余额不足”
/railway pay <订单号>       # 支付指定订单（输入后按 TAB 补全未支付订单号）
/railway print <订单号>     # 打印车票并直接放入背包，同时镜像进身份证
/railway reprint <订单号>   # 补打已打印过的车票（网页售票机补打按钮会调用它）
/railway voucher <订单号>   # 打印报销凭证并放入背包
/railway itinerary <订单号> # 打印行程信息单并放入背包
/railway refund <订单号>    # 按发车时间收取手续费后退票，退款放入背包
/railway change <订单号> <新车次> <日期> <席别>  # 改签，先报价再扣/退差价
/railway status             # 所在车站、已购车票、未支付车票
```

`/railway admin buy <玩家> <车次> <起点> <终点>` 可由管理员直接为玩家购票并出票。
车票使用本模组自带的 `railway_plus:railway_ticket`。  
两者都在 `minecraft:custom_data` 写入订单号、车次、起终站、日期、开检时间、票价、席别、座位号、票种、乘车人 NBT。  
多乘客订单会按乘客逐张生成车票/报销凭证/行程信息单，每张车票镜像对应乘客身份证。  
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
- 用户要求取消闸机上方悬浮字，世界空间文字已停用；闸机放行时会直接让模组闸机的门打开并自动关闭。
- 同一张票**只能进站一次**；第二次刷进站闸机会提示“该票已进站”。如确需重新进站，在后台“检票管理 → 取消检票”取消该乘车人检票，再刷即可重新进站。
- 持 `railway_plus:admin_card` 右键闸机直接放行；这是管理员旁路，不写入进站 / 检票记录。

修改闸机（OP / 权限等级 2，手持机械动力扳手 `create:wrench`）：

- 扳手右键闸机：循环切换 进站 → 检票 → 出站；
- 潜行 + 扳手右键：切换停用/启用。

---

## 五、手持平板、电视与管理员旁路物品

- **平板**：与世界电视一致，手持状态下右键打开可交互网页；管理员潜行右键打开配置框，可填写完整地址（`https://…`）或站内路径；选择“恢复默认”或留空则打开百度首页。
- **电视**：相邻、同朝向连成一面墙的电视自动拼成一块大屏（最大 32×32），共享一张整页纹理按行列切片；修改其中一台的网址时，**整组连通电视一并同步**为新网址（命令配置同样整组生效）。普通右键打开可交互网页界面，点击链接 / 按钮、输入文字均可响应，点击后浏览器自动获得焦点；关闭界面后世界内电视画面继续保留；管理员潜行右键打开配置框修改网页。
- 电视也支持命令配置：

```mcfunction
/railway admin tv <x y z> <url>
```

- 地址留空会回落到百度首页 `https://www.baidu.com`；相对路径自动拼到网页后端地址，完整 `http://` / `https://` 地址按原地址打开。

### 管理员旁路物品

```mcfunction
/give @s railway_plus:admin_card
```

- **管理员闸机卡**：右键进站 / 检票 / 出站闸机直接开门，不校验车票、身份证、储值卡，也不受闸机停用状态影响；不写入乘车检票记录。

---

## 六、车站划定与同步

```mcfunction
/railway admin station "南京南" POS1
/railway admin station "南京南" POS2
```

- 车站名用可带引号的字符串参数，中文名可直接写，也可加引号；站名含空格时必须加引号；
- 车站名补全会列出网页后台已建车站，添加后可直接选择；
- 不写坐标取准星指向的方块（48 格内），指空则取脚下；
- 也可显式写坐标：`POS1 100 64 200`；
- POS2 后自动：
  1. 划定车站长方体范围；
  2. 扫描范围内注册名为 `railway_plus:ticket_vendor` / `railway_plus:gate_a` / `railway_plus:gate_b` 的方块；
  3. 计算中心点；
  4. POST `/railway/admin/station` 同步后台；
  5. 后台按相邻停靠站自动生成每一段票价；售票时按车次经停顺序累加，A→C 经由 B 时票价 = A-B 段价 + B-C 段价。
  6. 席别以二等座为基准换算：一等座 = 二等座 × 1.5，商务座 = 二等座 × 2，结果四舍五入取整。

其他：

```mcfunction
/railway admin stations   # 列出本地车站、中心、闸机/售票机数量
/railway admin pull       # 从网页后台拉取车站台账并回填本地记录
/railway admin devices    # 拉取并列出闸机/购票机后台台账绑定状态
/railway admin gate bind "QJ-01"  # 把看向的闸机绑定到后台检票机编号
/railway admin sync       # 先拉取后台台账，再把本地车站推送到网页端
/railway admin station delete "南京南"   # 删除车站：本地范围/闸机/售票机 + 网页后台记录与该站票价
/railway admin station "南京南" delete   # 同上，两种写法都可用
```

数据保存在 `<世界存档>/railway_plus_addon.json`，与其他模组的世界文件分开。

---

## 七、网页后台

### 票价管理 `/fares`

- 站点对坐标距离、自动票价、更新时间。
- 新增自动票价、按坐标重算；**后台不提供手填价格或手填距离**，两站都必须有中心点坐标。
- 下方显示模组车站中心点、维度、铁路局、闸机/售票机数。

```
分段票价 = clamp(round(两站中心点距离 × farePerBlock), minFare, maxFare)
全程二等座 = 各相邻停靠站分段票价之和
二等座基准 = round(全程二等座)
一等座 = round(二等座基准 × 1.5)　商务座 = round(二等座基准 × 2)
儿童票 = round(票价 × childDiscount)　学生票 = round(票价 × studentDiscount)
```

**只按坐标计价**：票价由车站中心点距离自动生成，后台已移除手填价格、手填距离和“手动/自动”来源切换。  
**倍率先取整再乘**：二等座基准先四舍五入成整数，再乘 1.5/2，最后对结果四舍五入；二等 10 → 一等 15、商务 20。  
窗口代客购票与售票机走同一套 `railwayRouteFare`；成交价始终由服务端重算。

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

## 八、后端接口

后端路由、鉴权头、请求体和返回口径统一记录在根目录 [`API.md`](API.md)；本文件只说明游戏内物品、方块和命令如何与网页端交互，不在此重复维护接口表。

---

## 八点五、内置调度台（无需独立安装）

原第三方 `PyRailDispatch` 调度能力已整体内置进本模组，玩家**不再需要单独安装 py 调度模组**；调度服务、网页、信号/目的地指令、联机快照同步与时刻表自动行驶全部随 `railway_plus` Jar 发布。

### 访问方式

- 调度台为模组内置 HTTP 服务，默认监听 `127.0.0.1:2217`（端口被占用时自动顺延），外部浏览器打开 `http://127.0.0.1:2217/`；也可在电视 / 平板等自定义网页设备里填入该地址。
- 调度配置落盘到 `config/railway_plus/dispatch.json`（不再使用旧的 `config/pyrail_dispatch.json`）。

### 手动调度（先选车站，再选站台）

- 一个车站可包含多个站台；车站按本模组票务车站的方块范围自动把范围内的 Create 站台归为该车站的站台，范围外的站台归入“未分配”。
- 列车卡片先在**车站**下拉选择所属车站，再在**站台**下拉选择具体站台，点击发车/改派后列车自动前往所选站台。

### 时刻表自动行驶

- 时刻表面板按“列车 + 车站 + 站台 + 时刻（HH:MM:SS）”两级配置；到点后调度器自动把对应列车改派到该站台。
- 计划时刻当日只触发一次，跨天自动重新可触发；列车脱轨或已在目标站时跳过改派。

### 其余内置功能

- 实时快照：玩家、列车、车站/站台、信号机、线路图、ETA、早晚点、TPS；
- 信号机强制红灯 / 释放、目的地改派；
- 联机 GZIP 快照订阅与指令回传；
- 反射读取 Create，编译期不硬依赖 Create，未装 Create 时调度台提示“未检测到 Create”。

---

## 九、工程结构

```
railway-addon/
  build.gradle / settings.gradle / gradle.properties / gradlew
  src/main/java/qingjiang/railway/
    RailwayAddon.java          入口与 mod id
    RailwayConfig.java         config/railway_plus-common.toml
    RailwayWeb.java            HTTP 客户端与内部令牌
    RailwayStore.java          车站/闸机/售票机身份证的世界数据
    RailwaySettings.java       后台设置缓存
    TicketNbt.java / MetroNbt.java  车票、身份证、地铁票卡 NBT
    GateLogic.java             进站/检票/出站规则
    RailwayEvents.java         右键售票机/闸机、管理员配置、定时同步
    RailwayCommands.java       /railway、/metro 命令
    CrhCompat.java / RailwayCompat.java  模组自带方块物品识别与可选兼容探测
    ModItems.java / ModBlocks.java / ModBlockEntities.java 注册
    StaffTerminal.java         工作人员网页终端入口
    block/…                    售票机、闸机、电脑、引导屏、电视、车载屏、调度屏
    item/…                     身份证、票据、平板、管理员闸机卡等
    menu/…                     终端与售票机菜单
    network/…                  模组网络包
    dispatch/…                 内置调度台：配置、Create 反射桥、两级快照、HTTP 服务、时刻表调度、联机同步
    client/…                   MCEF 桥、终端界面、世界内屏幕渲染
  src/main/resources/…         mods.toml、模型、贴图、语言、战利品表、dispatch-web/ 调度台页面

web/
  ticket/server.js, db.js, public/…  Node 购票后端与公开页面
  admin/                             Vue3 + naive-ui 后台
```

---

## 十、当前待复测与未闭环项

1. **世界内屏幕复测**：引导屏拼接、缩放、朝向、多车次翻页，以及电视网页纹理仍需在安装 MCEF 的真实 NeoForge 客户端中复测。
2. **设备配置复测**：后台购票机 / 闸机台账已可由模组拉取绑定；真实后台停用 / 维修状态、坐标匹配和心跳在线状态仍需进游戏复测。
3. **地铁模式闭环**：储值卡已可在地铁站售票机面板充值；储值卡扣费乘车、地铁票卡闸机检票、后台地铁票卡管理页面待补。
4. **车载与调度**：车辆走字屏动态文字、调度状态联动和身份权限待接。
5. MCEF 首次运行需联网下载 Chromium 内核；下载失败时模组回退原生提示面板，公开网页仍可在外部浏览器访问。
6. 车票使用本模组自带物品，tooltip 显示附属写入的票号、车次、起终站与乘车人信息。
7. 验票只认身份证 / 车票物品，不做人脸；旧版独立检票端 3001 已不在当前主流程内。
8. **内置调度台复测**：进世界后确认 `127.0.0.1:2217` 可打开、车站→站台两级选择与改派生效、时刻表到点自动改派、信号强制红/释放、线路图采样与联机快照同步正常；旧 py 调度 Jar 已移出 mods，避免两套服务争用 2217 端口。
9. **电视整组同步与点击复测**：改一台电视网址后整面连通拼屏一并更新；右键打开的大屏窗口内点击链接 / 按钮、输入文字可正常响应（浏览器焦点已补齐）。
