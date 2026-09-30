# peipeidev.cn

佩佩队长（B站：闲鱼ID无敌佩佩队长）的个人网站 —— BW16 (RTL8720DN) / ESP32 嵌入式开发：
技术视频、固件**在线烧录**、设备 OTA，全站深色极客风，托管于 GitHub Pages。

| 入口 | 地址 |
|------|------|
| 主页 | https://peipeidev.cn |
| 在线烧录 | https://peipeidev.cn/flash/ |
| 设备 OTA 清单 | https://peipeidev.cn/fw/firmware.json |

支持的开发板（Web Serial 直刷）：**BW16（RTL8720DN）/ ESP8266 / ESP32 / ESP32-S3 / ESP32-C3**。

线上固件清单（15 项，署名与来源见 `tools/esp-firmware/SOURCES.md`）：
BW16：WiFi安全测试固件「2026」/ 远程版「20261001」（需激活码） / **双频断网固件「英文版」（2.4G/5G，本地编译 RTL8720dn-Deauther GPL-3.0）** / 官方 AT（救砖）；
ESP8266：Deauther v2 / Tasmota / MicroPython / WLED / 钓鱼门户演示；
ESP32：Bruce（CYD）/ MicroPython / **ESP32-DIV 多频工具箱（MIT）** / **Ghost（CYD）**；
ESP32-S3：Bruce / **Ghost（Cardputer ADV）**；ESP32-C3：WiFi渗透工具 / BLE 工具。
ESP 系官方固件发行规格在 `tools/update-flash.py` 的 `ESP_FIRMWARES`（bin 存于 `tools/esp-firmware/`，
来源/许可证/默认热点存证见 `tools/esp-firmware/SOURCES.md`）；署名统一为
「原项目 © 作者（许可证）· 打包发行 无敌佩佩队长 · peipeidev.cn」（清单+界面呈现，不改二进制）。

## 站点结构

```
├── index.html            主页（单文件：内嵌全部 CSS/JS，深色极客风，无外部依赖）
├── flash/                在线烧录工具（自包含子站，Chrome/Edge Web Serial）
│   ├── index.html
│   ├── css/              style.css（原工具样式）+ theme-home.css（线上主题层，构建生成）
│   ├── js/               刷写协议与界面（terser 压缩版；pickup.js 为付费固件取件模块）
│   ├── manifests/        bw16.json / esp32c3.json（固件清单，相对路径 + 净化后）
│   ├── firmware/         固件 bin（仅白名单固件 + _common 引导程序 + _sdk_backup 救砖镜像；
│   │                     付费固件 bin 不在此发布，经后台 R2 取件）
│   ├── test/helpers/     mock-device.js（?mock=1 演练模式依赖）
│   └── （不含 docs/ —— 协议文档只在本地项目，不随站点发布）
├── fw/                   设备端 OTA 通道（设备自主检查 firmware.json 下载升级）
│   ├── firmware.json     版本清单 + 公告
│   ├── version.txt       当前版本号
│   └── fw_*.bin          各版本 OTA 镜像
├── tools/
│   ├── update-flash.py   一键构建：本地工具 → 线上净化版（见下文）
│   ├── flash-pickup/     付费固件取件模块源码（构建时附加到 flash/js/）
│   ├── flash-api/        烧录站后台 Worker（统计/反馈/公告/激活码/付费固件 R2 取件）
│   └── esp-firmware/     ESP 系官方固件存证与 bin
├── .nojekyll             禁用 GitHub Pages 的 Jekyll（否则下划线目录 _common/_sdk_backup 会 404）
└── CNAME                 peipeidev.cn
```

## 在线烧录（/flash/）

纯前端 Web Serial 刷写工具，浏览器直刷开发板，免装驱动（要求独立 Chrome/Edge 89+；
Safari / iOS / 微信内置浏览器不支持，页面会显示提示徽章）。

- **BW16**：自研协议 JS 实现，高速档 921600 自动回退、救砖恢复、扩展擦除
- **ESP 系（8266/32/S3/C3）**：esptool-js 本地打包（不依赖 CDN）直刷，官方固件清单见文首
- **付费固件**：需取件码（选中后页面出现取件面板，见下文「付费固件取件」）
- **无硬件演练**：`https://peipeidev.cn/flash/?mock=1` 跑完整模拟刷写流程
- **用户视角净化**：默认界面与日志不含地址/指令/协议细节，协议文档不出网

线上只发布白名单内的固件（当前：**WiFi安全测试固件「2026」** 与 **…-远程版「2026」**），
未上线的 bin 文件一并从站点移除，知道地址也无法下载。

### 自定义固件刷写（/flash/ 第三个页签）

用户刷**自己的** bin 文件（本地选择，不上传任何服务器）：

- **BW16**：三镜像槽位（km0/km4 可一键填 SDK 默认镜像），复用生产 flashBw16 引擎
  （flashloader 内置并强制 SHA-256 校验、高速档自动回退、手动引导、?mock 演练）
- **一键救砖恢复（免上传）**：救砖页勾选覆盖声明后一键刷写**安信可原厂官方 AT
  固件**（ComboAT），把设备恢复到原厂状态，全程免上传；三槽位手动模式保留给
  高级用户（km0/km4 支持官方引导填充、image2 支持「用出厂镜像」填充）
- **官方 AT 固件来源**：安信可官方文档站的 ComboAT 整片镜像（16Mbit v4.9.2，
  2MB/4MB 模块通吃），按分区布局切分为三件套（km0/km4/image2，已规避 FTL/
  校准区）；换新版 ComboAT 时下载后重新切分覆盖 `bw16/_at_firmware/flash/a/`
  重跑构建即可
- **ESP32-C3**：多 bin + 可编辑烧录地址（如 0x0 引导 / 0x10000 应用），esptool-js
  官方库 esbuild 单文件**本地打包**（`flash/js/vendor/`，v0.7.0），不依赖 CDN
- **ESP8266（实验性）**：设备卡片已上线（引导至自定义刷写）；自定义固件页 ESP8266
  子页签支持多 bin + 可编辑地址（一体化固件 0x0 / 分段 boot 0x0 + app 0x10000），
  基于 esptool-js 0.7.0 的 ESP8266 目标（ROM 直刷，无压缩），需真机验证；
  刷写时让板子进下载模式（按住 BOOT/FLASH → 短按 RST）
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
| `PATCHES` | 源码文案补丁表：界面/日志净化、品牌化（标题、主页链接、设备卡片文案等） |
| `FIRMWARE_WHITELIST` | 线上固件白名单（slug），未列出的固件清单与 bin 均不发布 |
| `PAID_FIRMWARE` | 付费固件 slug（如 bw16-19）：保留清单卡片但 **bin 不发布**，烧录页经取件码换一次性链接（M6） |
| `FIRMWARE_NAME_MAP` | 线上显示名映射（本地保留原名） |
| `DEFAULT_CONNECT_NOTE` / `FIRMWARE_CONNECT_NOTES_OVERRIDE` | 选中固件后的连接提示（热点名/密码），默认统一文案、可按 slug 覆盖 |
| `FORBIDDEN` | 自检黑名单：敏感串零命中才算构建成功 |

## 设备 OTA（/fw/）

已刷入本站固件的设备通过 `fw/firmware.json` 检查更新并自行下载对应 `fw_*.bin`。
发布新版本：把新 bin 放入 `fw/`，更新 `firmware.json` 的 `versions` 顶部条目、`notice`
公告与 `version.txt`，推送即可。

## 烧录站后台（admin.peipeidev.cn，Cloudflare Worker + D1 + KV，零月费）

- **管理后台**：https://admin.peipeidev.cn/admin （ADMIN_TOKEN 登录，凭据见 `~/Desktop/AI-Accounts/api-keys.md`；
  「激活码」= 真实 keygen 一机一码体系（api.peipeidev.cn，MAC→绑定码，固件端离线验证））
- 能力：刷写统计看板（30 天量/成功率/失败 Top）/ 用户反馈收件箱 / 公告编辑
  （烧录页实时显示）/ 激活码生成与核销（公开核销接口 `POST /api/redeem`，可绑定固件 slug）/
  **付费固件取件（M6）**：付费固件注册、bin 上传到 R2、取件码生成与禁用、取件记录
- 前端接入：烧录页每次刷写结束匿名上报统计（`tools/flash-telemetry/telemetry.js`，
  仅生产域名生效）；顶栏「反馈」按钮直投后台
- 源码：`tools/flash-api/`（Worker + admin 页面 + D1 schema + test/ 本地测试与开发服务器）；
  部署 `cd tools/flash-api && HTTPS_PROXY=… npx wrangler deploy`
- 待做批次：M7 固件投稿审核

### 付费固件取件（M6）

付费固件（当前 `bw16-19`）的 **bin 不发布在公开仓库**（构建时由 `PAID_FIRMWARE` 排除，
知道地址也下载不到），改存后台 KV（`PICKUP` 绑定；账户开通 R2 后可在 wrangler.toml 一行切换，
取件适配器双兼容）。买家流程：

1. 购买获得**取件码**（后台「付费固件」页签生成，绑定固件 slug，与设备端激活码相互独立）
2. 烧录页选中付费固件 → 输入取件码 → `POST /api/pickup/begin` 校验并签发**一次性下载链接**
   （10 分钟有效、单次核销、绑定浏览器指纹；核销后 24h 内可重试，应对刷写失败重下）
3. 浏览器并行下载三镜像并做 SHA-256 校验 → 点「连接并刷写」正常刷写

本地验证（无需 Cloudflare 账号）：

```bash
node tools/flash-api/test/worker.test.mjs      # Worker 逻辑测试（30 项断言）
node tools/flash-api/test/devserver.mjs        # 本地后台 :8787，预置 bw16-19 + 测试取件码
python3 -m http.server 8765                    # 烧录页 :8765
# 联调地址：http://127.0.0.1:8765/flash/?api=http://127.0.0.1:8787
# 无硬件演练：http://127.0.0.1:8765/flash/?mock=1（付费固件用模拟数据走全流程）
```

**上线状态（2026-10-01）**：已部署并冒烟通过（D1 两表 + KV 存储 + Worker + 后台上传 +
一次性链接取件全链路）。换固件版本直接在后台上传覆盖三镜像即可（前端以服务端登记的
SHA-256 校验），无需重跑构建。若未来账户开通 R2，切换方法见仓库 ops/runbook（枢纽）。

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
