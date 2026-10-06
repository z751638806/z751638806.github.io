# ESP 固件库 · 来源与署名存证

> 打包发行：**无敌佩佩队长 · peipeidev.cn**
> 本目录固件均为公开开源项目的官方发行物，逐文件 SHA-256 存证；UI 署名采用
> 「原项目 © 作者（许可证）· 打包发行 无敌佩佩队长 · peipeidev.cn」格式，保留原版权。

| 文件 | 原项目 | 版本 | 许可证 | 烧录地址 | 默认热点/后台 |
|------|--------|------|--------|---------|---------------|
| esp8266/deauther-2.6.1-nodemcu.bin | [SpacehuhnTech/esp8266_deauther](https://github.com/SpacehuhnTech/esp8266_deauther) | 2.6.1 | MIT（禁以 jammer 名义宣传） | 0x0（合并镜像，≥1MB flash） | pwned / deauther / 192.168.4.1 |
| esp8266/deauther-2.6.1-wemos-d1mini.bin | 同上（与 NODEMCU 同一通用镜像） | 2.6.1 | MIT | 0x0 | 同上 |
| esp8266/tasmota-15.6.0.bin | [arendst/Tasmota](https://github.com/arendst/Tasmota) | 15.6.0 | GPL-3.0 | 0x0 | tasmota-XXXXXX / 无密码 / 192.168.4.1 |
| esp8266/micropython-v1.23.0.bin | [MicroPython 官方](https://micropython.org/download/ESP8266_GENERIC/) | v1.23.0 | MIT | 0x0 | MicroPython-xxxxxx / micropythn / WebREPL :8266 |
| esp8266/wled-16.0.1.bin | [wled/WLED](https://github.com/wled/WLED) | 16.0.1 | EUPL-1.2 | 0x0（≥1MB flash） | WLED-AP / wled1234 / 192.168.4.1 |
| esp32/tasmota32-15.6.0.bin | Tasmota | 15.6.0 | GPL-3.0 | 接入时按镜像头解析 | 同 ESP8266 版 |
| esp32/micropython-esp32-v1.23.0.bin | MicroPython | v1.23.0 | MIT | 0x1000 | 同上 |
| esp32/wled-16.0.1-esp32.bin | WLED | 16.0.1 | EUPL-1.2 | 接入时解析 | 同上 |
| esp32/bruce-cyd-2432s028.bin | [BruceDevices/firmware](https://github.com/BruceDevices/firmware) | 1.16.1 | AGPL-3.0 | 0x0（合并镜像：boot@0x1000/pt@0x8000/app@0x10000） | 设备端 UI 操作 |
| esp32s3/bruce-s3-devkitc.bin | Bruce | 1.16.1 | AGPL-3.0 | 0x0（合并镜像） | 设备端 UI |
| esp32/marauder-kit-LOCAL-STUDY.bin | [justcallmekoko/ESP32Marauder](https://github.com/justcallmekoko/ESP32Marauder) | 1.17.0 | ⚠️ 无协议 | — | Marauder / justcallmekoko / 192.168.4.1 |
| esp32s3/marauder-mini-LOCAL-STUDY.bin | 同上 | 1.17.0 | ⚠️ 无协议 | — | 同上 |
| esp32/esp32div-cyd-1.7.2.bin | [cifertech/ESP32-DIV](https://github.com/cifertech/ESP32-DIV) | 1.7.2 | MIT | 0x0（合并镜像，官方 merged 版） | 设备端触摸屏 UI |
| esp32/ghost-cyd-2.2.bin | [GhostESP-Revival/GhostESP](https://github.com/GhostESP-Revival/GhostESP) | 2.2-pre4 | GPL-3.0 | 0x0（合并镜像） | 设备端触摸屏 UI |
| esp32s3/ghost-cardputeradv-2.2.bin | GhostESP-Revival/GhostESP | 2.2-pre4 | GPL-3.0 | 0x0（合并镜像） | 设备端键盘 UI |
| esp8266/captive-portal-1.1.bin | [adamff-dev/ESP8266-Captive-Portal](https://github.com/adamff-dev/ESP8266-Captive-Portal) | 1.1 | MIT | 0x0 | 开放热点 · 管理 172.0.0.1（/pass /ssid） |
| _repos/DeauthDetector/（含 DSTIKE v3 预编译 bin 261KB） | [SpacehuhnTech/DeauthDetector](https://github.com/SpacehuhnTech/DeauthDetector) | — | MIT | 0x0 | 无 AP（LED 报警） |

注：
- `LOCAL-STUDY` 后缀 = 无许可证固件，仅本地研究，**未经作者许可不对外分发**
- 本地项目另有 ESP32-C3 三件套两套（WiFi渗透工具 MIT / BLE工具），清单在 BW16-ESP32-tool
- ESP32/S3 镜像偏移以接入时解析镜像头（E9/分区表 0xAA）实测为准

## 本地编译产物

| 文件 | 来源项目 | 版本 | 许可证 | 说明 |
|------|---------|------|--------|------|
| （本地工具）bw16/双频断网Deauther/flash/a/ 三件套 → 线上 bw16-18 | [tesa-klebeband/RTL8720dn-Deauther](https://github.com/tesa-klebeband/RTL8720dn-Deauther) | main@8e722c7 | GPL-3.0 | arduino-cli 编译（realtek:AmebaD:Ai-Thinker_BW16, core 3.1.7），bootloader 用标准 SDK 件；热点 RTL8720dn-Deauther / 0123456789 / 后台 192.168.1.1 |

## 预编译多文件固件（tools/esp-firmware/esp32c3/nat/）

| 文件 | 来源项目 | 版本 | 许可证 | 烧录地址 | 默认热点/后台 |
|------|---------|------|--------|---------|---------------|
| nat/bootloader.bin + nat/partition-table.bin + nat/esp32_nat_router.bin | 基于 [martin-ger/esp32_nat_router](https://github.com/martin-ger/esp32_nat_router) 的 Nomad 定制构建（本地编译，来源存证同目录 刷机说明.txt：esp32_nat_router-master git 最新提交，导出 2026-10-06） | nomad-20261006 | 上游许可证（待与上游仓库核对，无逐文件 SHA 存证——用户提供的预编译产物） | 0x0 / 0x8000 / 0x10000（ESP32-C3，dio/80m/4MB） | CMCC / 12345678.（9位带句点）/ 192.168.4.1（或 192.168.1.1） |

- 功能：NAT 路由（WiFi 克隆向导、记录页、通电自动漫游、实时网速统计、恢复出厂：管理页底部 / 长按 BOOT 5s / 串口 factory_reset）
- 上架名「CMCC」为用户指定；与 BW16「WiFi安全测试固件」的 CMCC 热点为不同设备/固件
