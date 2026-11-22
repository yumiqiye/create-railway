# 清江铁路 · Create Railway

Minecraft NeoForge 1.21.1 铁路票务附属与配套网页系统。

## 目录

| 路径 | 内容 |
| --- | --- |
| `railway-addon/` | NeoForge 附属（mod id `hexie_railway`）：身份证、售票机、闸机、人工终端、车站引导屏 |
| `web/ticket/` | Node.js 购票网站、静态售票页、引导屏与铁路 API |
| `web/admin/` | Vue 3 + naive-ui-admin 网页后台 |
| `web/shared/`、`web/check/` | 共享模块与检票端代码 |
| `README-铁路票务附属.md` | 附属安装、命令、设备与闸机详细说明 |

> 上游 HeXie / CRH 模组源码不包含在本仓库中；附属通过注册名识别 CRH 方块与物品，未安装 CRH 时会自动回退。

## 构建附属

```bat
cd railway-addon
gradlew.bat build
```

产物：`railway-addon/build/libs/HexieRailwayAddon-1.21.1-1.0.1.jar`。

网页端安装 MCEF（`mcef-neoforge`）后，售票机与车站引导屏可在游戏内直接渲染网页；未安装时回退为普通界面/深色屏体。

## 启动网页端

```bat
cd web/ticket
npm install
copy ..\config.example.toml ..\config.toml
npm start
```

网页购票：`http://127.0.0.1:3000/`  
引导屏：`http://127.0.0.1:3000/guide.html`

后台：

```bat
cd web/admin
pnpm install
pnpm dev
```

后台默认监听 `8001`。首次运行前请复制 `web/config.example.toml` 为 `web/config.toml`，并按需修改端口、令牌、二维码密钥与 hCaptcha 配置。

## 相关文档

- [附属详细说明](README-铁路票务附属.md)
- [网页系统说明](web/README.md)
