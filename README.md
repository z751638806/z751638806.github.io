# peipeidev.cn

佩佩队长（B站：闲鱼ID无敌佩佩队长）的个人网站 —— BW16 (RTL8720DN) / ESP32 嵌入式开发：
技术视频、固件**在线烧录**、设备 OTA，全站深色极客风，托管于 GitHub Pages。

| 入口 | 地址 |
|------|------|
| 主页 | https://peipeidev.cn |
| 在线烧录 | https://peipeidev.cn/flash/ |
| 设备 OTA 清单 | https://peipeidev.cn/fw/firmware.json |

## 站点结构

```
├── index.html            主页（单文件：内嵌全部 CSS/JS，深色极客风，无外部依赖）
├── flash/                在线烧录工具（自包含子站，Chrome/Edge Web Serial）
│   ├── index.html
│   ├── css/              style.css（原工具样式）+ theme-home.css（线上主题层，构建生成）
│   ├── js/               刷写协议与界面（terser 压缩版）
│   ├── manifests/        bw16.json / esp32c3.json（固件清单，相对路径 + 净化后）
│   ├── firmware/         固件 bin（仅白名单固件 + _common 引导程序 + _sdk_backup 救砖镜像）
│   ├── test/helpers/     mock-device.js（?mock=1 演练模式依赖）
│   └── （不含 docs/ —— 协议文档只在本地项目，不随站点发布）
├── fw/                   设备端 OTA 通道（设备自主检查 firmware.json 下载升级）
│   ├── firmware.json     版本清单 + 公告
│   ├── version.txt       当前版本号
│   └── fw_*.bin          各版本 OTA 镜像
├── tools/
│   └── update-flash.py   一键构建：本地工具 → 线上净化版（见下文）
├── .nojekyll             禁用 GitHub Pages 的 Jekyll（否则下划线目录 _common/_sdk_backup 会 404）
└── CNAME                 peipeidev.cn
```

## 在线烧录（/flash/）

纯前端 Web Serial 刷写工具，浏览器直刷开发板，免装驱动（要求独立 Chrome/Edge 89+；
Safari / iOS / 微信内置浏览器不支持，页面会显示提示徽章）。

- **BW16**：自研协议 JS 实现，高速档 921600 自动回退、救砖恢复、扩展擦除
- **ESP32-C3**：ESP Web Tools（unpkg CDN）；当前固件未上线，通道保留
- **无硬件演练**：`https://peipeidev.cn/flash/?mock=1` 跑完整模拟刷写流程
- **用户视角净化**：默认界面与日志不含地址/指令/协议细节，协议文档不出网

线上只发布白名单内的固件（当前：**WiFi安全测试固件「2026」** 与 **…-远程版「2026」**），
未上线的 bin 文件一并从站点移除，知道地址也无法下载。

### 自定义固件刷写（/flash/ 第三个页签）

用户刷**自己的** bin 文件（本地选择，不上传任何服务器）：

- **BW16**：三镜像槽位（km0/km4 可一键填 SDK 默认镜像），复用生产 flashBw16 引擎
  （flashloader 内置并强制 SHA-256 校验、高速档自动回退、手动引导、?mock 演练）
- **一键救砖恢复（免上传）**：救砖页顶部面板**二选一**恢复目标，勾选覆盖声明后一键刷写，
  全程免上传——「出厂固件」（官方引导 + 出厂应用镜像，来自 `_sdk_backup/`）或
  「官方 AT 固件」（安信可 ComboAT）；三槽位手动模式保留给高级用户
- **一键恢复官方 AT 固件**：即上项的 AT 目标。AT 三件套源自安信可官方文档站的
  ComboAT 整片镜像（16Mbit v4.9.2，2MB/4MB 模块通吃），按分区布局切分
  （km0/km4/image2，已规避 FTL/校准区）；换新版 ComboAT 时下载后重新切分覆盖
  `bw16/_at_firmware/flash/a/` 重跑构建即可
- **ESP32-C3**：多 bin + 可编辑烧录地址（如 0x0 引导 / 0x10000 应用），esptool-js
  官方库 esbuild 单文件**本地打包**（`flash/js/vendor/`），不依赖 CDN
- 无硬件演练：`https://peipeidev.cn/flash/?mock=1` 全流程；救砖页加
  `&rescuebins=bw16-01` 用指定固件镜像演练；自定义页加 `&custombins` 自动填充
- 维护：功能源码在 `tools/flash-custom/`（custom.js + vendor），构建时附加到
  `flash/js/`，**改动要改 tools/ 下的源，不要直接改 flash/js/custom.js**（会被覆盖）

### 更新烧录工具 / 固件

改本地源项目后，一条命令重建线上产物（本地项目保持原样，本脚本在临时副本上打补丁）：

```bash
python3 tools/update-flash.py [本地项目web目录]
# 默认源：~/Downloads/归档/BW16-ESP32-tool/web（首次需在其 web/ 内 npm install 以获得 terser）
git add -A && git commit -m "..." && git push   # push 后 1-2 分钟 Pages 生效
```

脚本内置配置（改完重跑即可生效）：

| 配置 | 作用 |
|------|------|
| `PATCHES` | 源码文案补丁表：界面/日志净化、品牌化（标题、主页链接、设备卡片文案等 45 条） |
| `FIRMWARE_WHITELIST` | 线上固件白名单（slug），未列出的固件清单与 bin 均不发布 |
| `FIRMWARE_NAME_MAP` | 线上显示名映射（本地保留原名） |
| `DEFAULT_CONNECT_NOTE` / `FIRMWARE_CONNECT_NOTES_OVERRIDE` | 选中固件后的连接提示（热点名/密码），默认统一文案、可按 slug 覆盖 |
| `FORBIDDEN` | 自检黑名单：敏感串零命中才算构建成功 |

## 设备 OTA（/fw/）

已刷入本站固件的设备通过 `fw/firmware.json` 检查更新并自行下载对应 `fw_*.bin`。
发布新版本：把新 bin 放入 `fw/`，更新 `firmware.json` 的 `versions` 顶部条目、`notice`
公告与 `version.txt`，推送即可。

## 主页内容更新

直接编辑 `index.html`（单文件含全部样式与脚本）。常用位置：

- **视频卡片**：`#videos` 内复制一份 `<div class="card">`
- **固件行**：`#firmware` 内复制 `<div class="fw-row">`
- **时间线**：`#timeline` 内复制 `<div class="tl-item">`
- **统计数字**：Hero 区 `.stat b[data-count]`

## 本地预览

Web Serial 要求 HTTPS 或 localhost，本地改完先起服务验证：

```bash
python3 -m http.server 8765
# 主页   http://127.0.0.1:8765/
# 烧录页 http://127.0.0.1:8765/flash/        （真机刷写）
#        http://127.0.0.1:8765/flash/?mock=1 （无硬件演练）
```

## 部署与网络说明

- 推送到 main 后 GitHub Pages 自动构建，1-2 分钟生效；页面缓存约 10 分钟，
  改完看不到就 `Cmd+Shift+R` 强刷
- `.nojekyll` 必须保留：Jekyll 会忽略下划线开头的目录，导致 `_common/`（刷写引导程序）
  与 `_sdk_backup/`（救砖镜像）404
- 仓库已配置 GitHub 走本机 SOCKS5 代理（`http.https://github.com/.proxy`）。
  代理未开时直连推送：`git -c http.https://github.com/.proxy= push origin main`

## 免责声明

本站工具与固件仅限**授权环境下**的安全研究与教学用途，请遵守当地法律法规；
刷写有风险，操作前请阅读页面内说明。
