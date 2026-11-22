<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
# CHANGELOG

本文件记录清江铁路12306 演示系统的重要变更。

格式参考 Keep a Changelog，版本号按日期记录。

---

## [2026-11-18] 按日期运行调整、检票口引导屏

### 新增

- 车次运行状态、晚点、临时检票口、临时站台和运行公告改为按日期保存，只影响所选日期；旧版全局状态首次启动迁移到当天。
- 新增检票口引导屏 `/guide.html`，固定车站大字号展示车次、终到站、开点、检票口、站台和状态，临时调整显示“临时调整”标记，10 秒刷新。
- 前台导航新增“检票口引导”入口。
- 前台购票默认日期改为当天。

### 验证

- G101 设置 2026-11-18 晚点 20 分钟、临时口 11A/11B、站台 3 后，当天车次/大屏显示调整值；2026-11-19 仍为 14:00、A 口、8 站台。
- 当天设置停运后，检票端不再出现该车次。

---

## [2026-11-17] 异常告警中心、运营报表与大屏、Windows 检票客户端

### 新增

- 异常告警中心：闸机离线、配置下发失败、配置超过 90 秒未确认、检票端 warn/error 事件、人工检票异常统一进入告警池。
- 告警支持确认、忽略、解决，保留历史；同一告警按“类型 + 车站 + 闸机”去重，未处理期间只累计次数，不重复刷屏。
- 后台 `/alerts` 页：未处理 / 严重 / 警告 / 已确认统计，关键字、级别、状态筛选，10 秒自动刷新，可选声音提醒。
- 运营报表 `/reports`：按乘车日期统计售票张数、有效票、退票、毛收入、有效收入、退票金额、净收入、检票完成率、客单价。
- 报表支持下钻车站、车次、席别、渠道，每日明细与 CSS 条形图，CSV 导出。
- 候车大屏 `/screen.html`：车站名/三字码、时钟、公告、列车开点、检票口、站台、地标色、候车/正在检票/已发车状态、已检人数、下一趟开检、车站切换。
- 大屏每 5 秒刷新，公开只读，不返回旅客姓名和证件，仅返回聚合人数。
- Windows 检票客户端：`QingjiangCheckClient.exe`，用 Edge/Chrome kiosk 全屏打开检票地址，浏览器退出自动重启，支持托盘退出和开机自启。
- 分发包根目录新增 `QingjiangCheckClient.exe` 与 `检票客户端使用说明.txt`。

### 修复

- 告警去重键从裸闸机编号改为 `车站ID::闸机号`，避免三个车站同叫 `QJ-01` 时互相确认/解决告警。
- 报表车次统计的乘车日期集合改为数组累加，避免第一次赋值后变成数字导致后续展开报错。

---

## [2026-11-17] 列车临时变更、晚点与停运

### 新增

- 车次运行状态：正常、晚点、停运、暂停检票。
- 晚点支持 1-240 分钟，前台显示实际预计开车时间，候车大屏显示晚点提示。
- 临时检票口、临时站台和运行公告，留空表示不修改。
- 停运/暂停检票车次在前台禁止购票，在检票端不进入可检列表并拒绝已读取车票。
- 候车大屏对晚点、停运列车使用独立状态样式；订单详情显示运行状态和公告。

### 数据

- 车次新增 `status`、`delayMinutes`、`tempGates`、`tempPlatform`、`runtimeNote`；原 `gates`/`gate` 保留为基础检票口。

---

## [2026-11-17] 车次支持多检票口

### 新增

- 车次 `gates` 数组字段，一个车次可配置最多 8 个检票口。
- 后台车次表单支持逗号、斜杠、顿号分隔多个检票口，保存时服务端统一去重、转大写、校验格式。
- 车次列表、前台订单详情、候车大屏、检票端统一显示多个检票口，格式为 `A12 / B06`。
- 批量导入车次的“检票口”单元格支持逗号分隔多个值。

### 兼容

- 旧数据只有单值 `gate` 时，加载时自动拆分为 `gates` 数组，并生成展示用 `gate` 文本。
- 旧前端和旧导入仍可只传单值 `gate`，服务端会规范化为一个检票口。

---

## [2026-11-17] 闸机心跳、远程配置、购票员权限与日志

### 新增

- 闸机心跳改为主服务内存登记，10 秒心跳、30 秒判离线；心跳不再逐次读写 `db.json`，每 30 秒批量落盘。
- 后台检票设备新增在线 / 离线、配置版本、配置确认时间、下发失败状态；WebSocket 只在线状态变化时推送。
- 远程配置支持检票模式、摄像头开关、扫码小窗、欢迎语、维修文案、进出站类型；每次修改生成新配置版本，闸机确认后显示“已生效”。
- 操作日志新增按操作人、动作、对象、关键字、级别筛选，支持导出 CSV；新增售票、退票、打印、设备配置审计记录。
- 购票员（`operator`）权限收紧为：总览、售票窗口、订单退票、车票打印；补票、发票、设备、设置、日志接口服务端同步拒绝。
- 前台订单详情新增“乘车提示”卡片，突出检票口、站台、地标颜色和开检时间。
- Android 5 检票页补充 `100vh` 回退；使用现代 Chrome 时页面保持原有布局。

---

## [2026-11-15] 项目源码统一版权文件头

### 变更

- 为三端手写源码、页面、样式、脚本、配置和文档统一添加「铁路横线 + 项目名」版权文件头。
- 文件头包含“清 江 铁 路 1 2 3 0 6 / QINGJIANG RAILWAY”和“版权所有，仿冒必究 / All Rights Reserved”。
- 后台、前台、检票端、共享模块、构建配置和说明文档共 230 个文件已添加。
- 第三方库、`node_modules`、`dist` 构建产物、JSON 数据、人脸模型和依赖清单未改动，避免破坏构建和数据格式。
- `manage.ps1` 保持 UTF-8 BOM；后台重新构建成功。

---

## [2026-11-15] Windows 单文件运行版

### 变更

- 新增 `dist/qingjiang-railway-12306-win64/QingjiangRailway12306.exe`，并生成 `dist/qingjiang-railway-12306-win64.zip`。
- 三端服务、页面、人脸模型和后台页面统一封装进单个 exe，运行电脑不再需要安装 Node.js，目录中不出现 `.js` 文件。
- 运行时自动在 exe 同目录创建 `data/db.json` 空演示库，不含真实旅客、订单或人脸数据。
- 配置读取 exe 同目录 `config.toml`；后台静态资源由内置服务托管，并将 `/api` 代理到主服务。
- 不内置 hCaptcha 密钥，改为 `config.toml` 的 `[hCaptcha]` 段或环境变量提供，避免密钥随公开产物泄露。
- 按用户要求不再启用前台卡密：`card-auth.js` 与 `crypto-js` 均已移除，首页打开即可使用；后台保持可直接登录。
- 修复后台构建产物缺少 `app.config.js` 导致 8001 一直转圈：补齐全局配置文件，后台登录页恢复渲染。
- hCaptcha 配置统一为 `config.toml` 的 `[hCaptcha]` 段（`enabled` / `siteKey` / `secret`），已删除旧 JSON 兼容读取。
- 修复 exe 内主服务配置路径，统一读取 `QJ_CONFIG_DIR` 下的 `config.toml`，端口与 hCaptcha 配置不会再读错目录。
- 源码统一收进 `source/`，根目录只保留 `一键打包.cmd`；构建产物只输出 `dist/qingjiang-railway-12306-win64.zip`。
- 已在 3300/3301/8300 临时端口、无 Node 的 PATH 环境下验证三端和后台静态资源、接口代理均返回 200。

---

## [2026-11-15] 支付倒计时、补票规则细化与发票闭环

### 变更

- 支付体验：新增 `paymentTimeoutMinutes` 设置（默认 15，范围 1~120），后台“系统设置”可配置；下单按该配置生成 `paymentDeadline`。
- 前台待支付弹窗增加实时倒计时（剩余 m:ss），归零后提示“支付时间已到，订单已取消，座位已释放”并禁用支付按钮。
- 补票规则：无座补票统一按二等座全价计价，订单写 `seatType=无座`、`fareSeatType=二等座`，不占座、不扣余票。
- 下车补票按所选席别全价加收 2 元手续费，订单写 `afterTravelFee=2`、`seatType=无座`，并登记为已完成行程。
- 挂失补办成功后，原订单写 `lostReported=true`、`lostReportedAt`、`lostReissueOrderNo`、`voided=true`、`voidedReason=挂失补办`；保留 `status=paid` 继续占座，避免原座位被重复卖出。
- 检票端增加拦截：已挂失/作废原票不能检票，需使用补办后的新车票。
- 发票闭环：前台可对已支付订单“申请开票”，记录发票号、抬头、开具时间；下载 PDF；退款时自动红冲，已红冲发票不能下载。
- 后台新增“发票管理”菜单，支持按状态查询已开具 / 已红冲发票，并对已退票订单手动红冲。
- 后台订单列表与详情显示“已挂失作废”和发票状态。

### 验证

- 支付超时设置通过 API 改为 30 分钟后恢复为 15，接口校验正常。
- 无座补票（G7001，提交商务座）：实际按二等座 ¥139.5 计价，`seatType=无座`、`seatHolding=false`。
- 下车补票（G7001，商务座）：¥439 + ¥2 = ¥441，`afterTravelFee=2`、`checkedIn=true`、`seatHolding=false`。
- 挂失补办：新票 ¥2、不占新座，原订单 `lostReported=true`、`voided=true`，仍为 `paid` 占座。
- 发票：生成 20KB PDF，退款后自动 `invoiceStatus=redFlushed`，红冲原因正确。
- 测试订单均已删除；后台重新构建成功，三端服务已重启并返回 200。

---

## [2026-11-15] 独立售票窗口与纸质票二维码

### 变更

- 后台新增独立“售票窗口”菜单与页面，不再把代客购票挤在订单管理的小按钮里。
- 窗口售票支持不填手机号，订单标记 `source=counter`、`counter=true`，不归属前台账号。
- 支持一次录入多位旅客、选择车次/日期/席别、实时计算应收金额。
- 出票成功后生成纸质票静态二维码，可下载 PNG；可直接打印 80mm 纸质车票。
- 新增纸质票二维码模式：`GET /api/qrcode/ticket?orderNo=...&mode=paper`，二维码长期有效，适用于打印车票。
- 后台订单来源增加“售票窗口”显示。

### 验证

- 无手机号窗口出票成功，订单无 `userId/userPhone`，座位正常分配。
- 纸质票二维码接口返回 `image/png`。
- 后台重新构建成功。

---

## [2026-11-15] 补票新增无座与下车场景

### 变更

- 补票原因新增“无座补票”和“下车补票”。
- 无座补票：按所选席别计价，生成 `无座` 票，不分配座位、不扣减余票、不占座位（2026-11-15 收尾调整为固定按二等座全价）。
- 下车补票：按所选席别全价计价，生成 `无座` 票，登记为已完成行程，不再用于进站检票（2026-11-15 收尾调整为加收 2 元手续费）。
- 两类补票订单均写 `noSeat=true`、`seatHolding=false`，座位位图与已售统计自动跳过。
- 后台补票表单的席别选择在无座/下车场景下改为“计价席别”，并显示规则说明。

### 验证

- 无座补票：G701 二等座，生成 `无座` 票、¥149，`seatHolding=false`。
- 下车补票：G701 二等座，生成 `无座` 票、¥149，`afterTravel=true`、`checkedIn=true`。
- 测试订单已删除，真实库未保留测试数据。

---

## [2026-11-14] 支付闭环与补票规则增强

### 变更

- 前台下单改为 `pending` 待支付，订单保留 15 分钟，超时自动取消并释放座位。
- 新增 `POST /api/public/orders/:orderNo/pay` 模拟支付回调；前台待支付弹窗和订单列表支持支付、取消。
- 待支付订单会计入座位占用；取消、超时或删除后释放，支付后转为已支付。
- 补票新增“挂失补办”：必须填原订单号，校验原票与旅客，沿用原座位，`seatHolding=false`，不占新座，只收 2 元补办费。
- 补票新增“越站补差”：选择原到站和越站到站，按线路里程比例自动计算区段票价。
- 新增 `GET /api/supplement/quote` 越站报价与 `GET /api/supplement/original` 原票载入。
- 后台补票表单增加原到站、越站到站、补差票价展示和原票载入按钮。

### 验证

- 越站报价：G2250 南京南→上海虹桥二等座，300/1323 公里，补差 ¥35.83。
- 越站补票成功生成订单并分座；挂失补办成功生成 2 元补票订单且不占新座；测试订单已删除。

---

## [2026-11-14] 端口配置自动同步

### 变更

- 新增 `GET /api/runtime-config`，返回 `ticket/check/admin` 三端端口与访问地址。
- 前台入口的“检票入口 / 管理后台”链接改为读取运行时配置，不再写死 3001/8001。
- 后台 Vite `/api` 代理目标改为读取 `config.toml` 的 `[ticket] port`。
- 后台总览、关于页的前台地址与打开按钮改为读取运行时配置。
- `manage.ps1` 启动、停止、状态检测与提示地址全部改为解析 `config.toml`。
- 实测将三端口临时改为 3100/3102/8100，前后台、检票端、代理与状态脚本均自动跟随；随后已恢复 3000/3001/8001。

---

## [2026-11-14] 检票闭环、实时监控与四目录重构

### 概述

本轮是一次较大的结构性升级，覆盖服务端、后台、前台、检票端、配置、启动脚本和项目目录。

核心目标：

- 异常处理与人工复核
- 后台实时检票监控
- 动态电子票二维码
- 车站大屏
- 检票管理独立菜单
- 日志管理
- 系统设置位置调整
- WebSocket 实时刷新
- 活体检测
- 购票免除账号人脸
- 人工停用检票机与维修文案
- 扫码画面默认全部隐藏，入站/出站不显示扫码小窗
- 全站版权备案页脚
- 前台与检票端横竖屏
- `config.toml` 自定义端口
- 项目拆分为 `admin` / `check` / `ticket` / `shared`
- 公告弹窗策略
- 车站字段与操作列改造

---

### Added

#### 服务端

- 新增 `shared/config.js`
  - 提供 `parseToml`、`loadConfig`
  - 根目录 `config.toml` 统一配置端口和二维码参数

- 新增 `shared/ticket-qr.js`
  - `sign()`：生成 HMAC-SHA256 签名
  - `makePayload()`：生成动态二维码内容
  - `parsePayload()`：校验格式、签名、有效期

- 新增 WebSocket
  - 使用 `ws`
  - 路径 `/ws`
  - 连接后立即发送 `hello` 与 `snapshot`
  - `fs.watch` 监听 `db.json`，去抖后广播

- 新增审计日志
  - `addLog()`
  - 最多保留 2000 条
  - 记录动作、操作人、角色、对象、详情、级别

- 新增实时快照
  - `liveSnapshot()`
  - 包含今日已支付订单、乘客核销、设备、事件、最近日志、`wsUrl`

- 新增接口：
  - `GET /api/monitor`
  - `GET /api/devices`
  - `POST /api/devices`
  - `PUT /api/devices/:id`
  - `POST /api/checkin_admin/review`
  - `GET /api/logs`
  - `POST /api/checkin_event/report`
  - `POST /api/admin/reset`
  - `GET /api/qrcode/ticket`
  - `GET /api/accounts/me`

- 新增设置项：
  - `announcementEnabled`
  - `announcementShowMode`
  - `announcementOnStart`
  - `announcementRepeat`
  - `footerCopyright`
  - `footerIcp`
  - `footerPolice`
  - `footerPoliceNo`
  - `maintenanceText`
  - `liveDetection`
  - `showScanPreview`
  - `ticketQrRefreshSeconds`

- 新增数据集合：
  - `devices`
  - `logs`
  - `checkinEvents`

- 车站新增字段：
  - `status`
  - `gateCount`
  - `platformCount`
  - `address`

- 权限新增：
  - `ticket_checkin`
  - `ticket_logs`

- 新增 `refreshDB()`
  - 文件被外部修改后可重新读取

#### 后台

- 新增「检票管理」页面
  - 实时监控
  - 人工复核
  - 检票设备
  - 车站大屏

- 新增「日志管理」页面
  - 分页
  - 关键字过滤
  - 级别过滤

- 菜单重排为 10 项：
  1. 总览
  2. 城市管理
  3. 车站管理
  4. 车次管理
  5. 车票管理
  6. 检票管理
  7. 订单管理
  8. 系统设置
  9. 日志管理
  10. 关于

- 新增图标：
  - `SafetyOutlined`
  - `FileTextOutlined`

- 车站页面新增：
  - 车站状态
  - 检票口数
  - 站台数
  - 地址
  - 操作列「编辑 / 更多」
  - 删除收进 `NDropdown`
  - 打开弹窗时刷新城市

- 系统设置新增：
  - 公告策略
  - 版权备案
  - 检票终端
  - 数据重置密码弹窗

- 检票管理设备页新增：
  - 开检提前时间编辑卡
  - 调用 `updateSettings`

- 后台 API 封装新增：
  - `MonitorData`
  - `DeviceItem`
  - `LogItem`
  - `Reviews`
  - `getMonitor`
  - `getDeviceList`
  - `createDevice`
  - `updateDevice`
  - `reviewCheckin`
  - `getLogList`
  - `resetDemoData`

- Vite 配置新增：
  - 从 `../config.toml` 读取 `[admin] port`
  - 覆盖 `VITE_PORT`

- 车站大屏
  - 车站选择
  - 实时时钟
  - 今日车次
  - 检票口
  - 站台
  - 已检人数
  - 全屏预览

#### 前台

- 购票人脸逻辑调整
  - 删除账号本人人脸强制校验
  - 提交不再携带 `faceToken`
  - `bookingFaceCard` 隐藏

- 动态二维码
  - `qrUrl` 改为 `/api/qrcode/ticket?orderNo=...&_=...`
  - 每 30 秒刷新所有可见 `img[data-order]`

- 查票
  - 改为新标签页打开
  - 新增 `applySearchQuery()`
  - 自动回填查询条件
  - 自动 `ensureCaptcha(searchNow)`

- 公告
  - 新增 `noticeMask`
  - 支持顶部/弹窗
  - 支持启动显示
  - 支持重复显示
  - `localStorage` 记录已看过

- 页脚
  - 动态版权
  - ICP 备案
  - 公安备案
  - 客服电话

- 样式
  - `.footer-copy`
  - `.footer-records`
  - 竖屏媒体查询

- 版本号
  - `app.js?v=20261114w`
  - `style.css?v=20261114p`

#### 检票端

- 设置页新增：
  - 显示扫码画面

- 本地键：
  - `qj_show_scan_preview`
  - `qj_device_disabled` 仅作为旧版本兼容键，启动时自动清零，不再参与状态判断

- 扫码画面
  - 默认 `display:none`
  - 开启后 `body.scan-preview-on`
  - 固定右下角小窗
  - 竖屏缩小

- 设备状态
  - 新增 `deviceBlocked` 遮罩
  - 每 5 秒查询 `/api/checkin/device`
  - 状态非 `normal` 时停摄像头
  - `disabled` 显示“本机已停用”
  - `maintenance` 显示后台维修文案
  - 停用和维修只能从后台修改

- 活体检测
  - 新增 `eyeOpenness()`
  - 新增 `checkLiveness()`
  - 低阈值 0.18
  - 高阈值 0.24
  - 15 秒兜底放行

- 页脚
  - 版权
  - ICP
  - 公安备案

- 版本号
  - `app.js?v=20261114ze`
  - `style.css?v=20261114c`

#### 工程

- 新增 `ticket/`
- 新增 `check/`
- 新增 `shared/`
- `admin/` 由 `naive-ui-admin-3.0.0` 改名
- 新增 `check/package.json`
- 新增 `manage.ps1`
- 新增 `manage.bat`
- 新增 `backup-20261114`
- 新增 `README.md`
- 新增 `CHANGELOG.md`
- 新增详细文档
  - README 扩展到 1700+ 行
  - 覆盖架构、目录、配置、账号权限、数据模型、前台、后台、检票端、二维码、WebSocket、全部 API、部署打包、常见问题、验收清单

---

### Changed

- 主服务从 `server/` 迁到 `ticket/`
- 检票服务从 `server/checkin-server.js` 迁到 `check/checkin-server.js`
- 检票端静态目录从 `server/public-checkin` 迁到 `check/public-checkin`
- 检票服务数据库路径改为 `../ticket/data/db.json`
- 主服务启动时读取 `config.toml`
- 检票服务启动时读取 `[check] port`
- 后台菜单顺序调整
- 系统设置移动到订单管理下方
- 日志管理放到系统设置下方
- 检票管理从系统设置中分离
- 车站操作列由单按钮改为「编辑 / 更多」
- 公告默认改为顶部显示
- 扫码画面默认全部隐藏，仅检票闸机可开启小窗
- 入站、出站闸机不显示扫码小窗
- 入站、出站页面隐藏扫码摄像头实时画面，仅保留验证提示和输入框
- 升级时自动把旧的 `qj_show_scan_preview=1` 重置为 0
- 检票端停用/维修改为只能由后台设备状态控制
- 后台设备 `disabled` 状态对应检票端“本机已停用”
- 后台登录后每次请求 `/accounts/me`
- 后台权限改为服务端刷新
- 后台服务端重启后自动回登录页
- `manage.ps1` admin 启动方式由 `.bin\vite.cmd` 改为 `pnpm run dev`
- `README` 路径批量替换为新目录
- 检票端事件上报补充字段支持
- 动态二维码默认刷新间隔 30 秒

### UI

- 检票端空状态改为车站大屏风格
  - 深蓝顶部状态栏
  - 中央白色圆环闸机图标
  - 蓝色渐变背景
  - 城市建筑剪影和列车轮廓
  - `无列车开检 / No ticket-checking in progress / 请等待 / Please wait`
  - 顶部显示检票机编号、版本号、实时时间
  - 无车开检时隐藏人脸摄像头区域
  - 页脚备案信息缩小展示
  - 仅检票闸机使用该大屏，入站/出站保持通行页
- 检票通过通行条
  - 底部绿色横幅
  - 黄色圆形行人图标
  - 显示「检票通过」、车次、「请快速通过闸机」
  - 显示检票口和站台

---

### Fixed

- 修复 `/api/devices` PUT 分支 `account is not defined` 的 500 错误
- 修复 `settings.vue` 缺失 `<n-card>` 闭合导致构建失败
- 修复 `useUserStore` 导入路径错误
- 修复 `admin` Vite pnpm junction 失效
- 修复 `manage.ps1` 无 UTF-8 BOM 导致中文乱码
- 修复检票端 `app.js` 多出一个 `}` 导致整页脚本语法错误
- 修复后台大屏时钟导致 iframe 每秒重载
- 修复后台旧 token 失效后停留在错误页
- 修复购票成功流程残留 `faceToken` 引用
- 修复数据重置接口密码校验
- 修复动态二维码缓存
- 修复车站弹窗城市列表不刷新
- 修复维修遮罩 `z-index=300` 高于设置弹窗 `z-index=200`，导致遮罩出现后无法打开设置
- 检票端删除本机「停用此检票机」开关，停用与维修统一由后台 `devices.status` 控制
- 修复本地停用键与远程维修状态混用，后台正常时仍显示“正在维修”
- 修复首次设置时“显示扫码画面”可能继承旧本地状态
- 后台设备状态 `disabled` 明确显示为“本机停用”，与 `maintenance` 维修文案区分

---

### Security

- 后台设置写操作仅 admin
- 设备新增/编辑仅 admin
- 人工复核仅 admin / inspector
- 日志仅 admin
- 数据重置仅 admin + 当前密码
- 旅客接口使用旅客 token
- 后台接口使用 `x-token`
- 动态二维码使用 HMAC 签名
- 数据库不存明文后台密码
- 二维码密钥不进入前端

---

### Breaking Changes

- 目录结构变化
  - `server` 不再存在
  - `naive-ui-admin-3.0.0` 不再存在
- 启动命令变化
  - 主服务改到 `ticket/`
  - 检票服务改到 `check/`
- 配置变化
  - 端口从代码常量改为 `config.toml`
- 后台登录态变化
  - 服务端重启后需要重新登录
- 购票流程变化
  - 不再需要账号本人人脸
  - 但仍需要乘车人本人人脸

---

### Migration Notes

从旧结构升级时：

1. 停止 3000 / 3001 / 8001。
2. 备份 `server` 与 `naive-ui-admin-3.0.0`。
3. 将 `server` 改名或复制为 `ticket`。
4. 将检票服务与 `public-checkin` 移到 `check`。
5. 将后台改名 `admin`。
6. 重新安装 `admin` 的 `node_modules`。
7. 修改 `checkin-server.js` 数据库路径为 `../ticket/data/db.json`。
8. 确认 `config.toml` 三个端口。
9. 确认 `qr_secret` 两端一致。
10. 启动三个服务。
11. 后台重新登录。

---

### Verification

本轮已实际验证：

- `node --check` 通过：
  - `ticket/server.js`
  - `ticket/db.js`
  - `check/checkin-server.js`
  - `shared/config.js`
  - `shared/ticket-qr.js`
  - `ticket/public/app.js`
  - `check/public-checkin/app.js`
- 后台 `vite build` 成功
- 3000 / 3001 / 8001 均 HTTP 200
- 后台登录成功
- `/api/monitor` 返回订单与设备
- `/api/accounts/me` 返回新权限
- 动态二维码返回 PNG
- `/api/logs` 可分页
- 检票端 `/api/checkin/config` 正常
- 检票端 `/api/checkin/device` 正常
- 后台修改设备为 maintenance 后检票端读到
- 恢复 normal 后检票端恢复
- `manage.ps1 status` 三个服务运行
- 检票端页面首次设置弹窗正常
- 前台页面公告与页脚正常

---

### Known Issues

- 动态二维码仍接受未签名旧格式 `QJ|订单号`
- 二维码接口未校验登录态
- 检票事件本地写入未带 `stationId` / `gateNo`
- `checkin-server.js` 的 `MAIN_PORT` 未使用
- 检票端心跳每 5 秒写 `db.json`
- `ticket` 与 `check` 共用一份数据库
- 后台 token 仅存在内存
- 活体检测为眨眼启发式，不是生产级活体
- 摄像头权限依赖浏览器
- `ticket.localhost` 在 PowerShell/.NET 中不可解析

---

## [历史基线] 购票与检票主流程

### Added

- 官方 hCaptcha
  - 仅支持官方 hCaptcha
  - 不再回退本地图形验证码

- 乘车人人脸
  - 前台录入
  - 128 维特征
  - 订单人脸快照

- 检票端两阶段
  - 车票
  - 人脸

- 一人一闸
- 按乘车人逐个核销
- 摄像头自动启停
- 开车前 1 小时购票提醒
- 后台角色权限差异
- 检票设备首次强制设置
- 电子发票
- 退票
- 改签
- 订单
- 乘车人
- 车票查询
- 后台城市/车站/车次/车票/订单/设置

### Notes

- 该阶段代码位于旧 `server/` 与 `naive-ui-admin-3.0.0/`
- 已备份到 `backup-20261114`

---

## 版本索引

| 日期 | 主题 |
| --- | --- |
| 2026-11-14 | 检票闭环、实时监控、四目录重构 |
| 历史基线 | 购票与检票主流程 |
