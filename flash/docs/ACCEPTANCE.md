# 验收清单（ACCEPTANCE）

生成：2026-09-15 · 对应任务书第 6 节实机验收脚本
标注约定：✅ 已自动化验证 · ⏳ **待实机验证**（本文件 2026-09-17 增补线上环境实机记录，见第二节末）（需要真机 BW16-Kit / ESP32-C3 + 浏览器授权串口，无法在本环境自动化）

## 一、已自动化验证项（本环境，2026-09-15 实测）

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| A1 | 协议单测（握手/包结构/校验和 0xFF 初值/seq 连续/擦除包/连续写/复位全路径） | ✅ 41/41 通过 | `node --test --test-force-exit test/`（web/ 下） |
| A2 | 黄金字节对照：JS 写包 vs 独立 Python 实现（tools/gen_packet_fixtures.py，3 组 1032 字节全量向量） | ✅ 逐字节一致 | web/test/packet.test.js |
| A3 | 构建脚本：17 个 BW16 固件四件套齐备；flashloader 17 份 md5 一致（db71809057ae…）；ESP32-C3 分区表解析正确 | ✅ | web/manifests/bw16.json、esp32c3.json |
| A4 | 静态服务与资源可达（index/清单/bin/EWT manifest/js） | ✅ 全 200 | curl 实测 |
| A5 | 浏览器全流程（mock 演练，真实固件字节）：选 BW16 → 选"戒网瘾最新版" → 刷写 → 832844/832844 字节 → 成功复位 | ✅ 7.8s 完成 | 浏览器 E2E + 截图（会话存档） |
| A6 | 手动引导路径：自动时序失败 → 图文引导（剩余 3 次）→ 模拟 BURN+RST → 重试 → 成功 | ✅ | 浏览器 E2E（?mock=1&blockauto=1） |
| A7 | 断线保护：写入中途模拟拔线 → 立即失败提示、进度隐藏、UI 复位、统计记失败 | ✅ | 浏览器 E2E |
| A8 | 救砖页：镜像填充（演练/SDK 备份）→ 恢复刷写 → 成功；AT 固件无本地包时如实显示获取渠道 | ✅ | 浏览器 E2E（?mock=1&rescuebins=bw16-01） |
| A9 | ESP32-C3 网页呈现：EWT 按钮挂载、manifest 路径、偏移说明（BLE工具标"待实机验证"）、设备切换防呆 | ✅ | 浏览器 E2E |
| A10 | VID 防呆判据：跨类拦截 / CH340 警告 / 未知 VID 警告 | ✅ 8/8 单测 | web/test/guard.test.js |
| A11 | 日志导出与统计字段兼容 flash_stats.json（total/success/fail/history[{time,device,firmware,port,success,duration}]） | ✅ | web/js/log.js + 演练记录核对 |

## 二、实机验收脚本（⏳ 待实机执行，逐项记录）

前置：BW16-Kit 插 USB；Chrome 打开 `http://127.0.0.1:8000/`（用 启动网页版.command）。

- [ ] R1 选 BW16 → 选"戒网瘾最新版" → 连接串口（授权弹窗选对应口）
- [ ] R2 观察自动进下载模式日志（方案 A / 方案 B；若失败按引导手动 BURN+RST）
- [ ] R3 flashloader 进度 → 三段镜像写入进度 → "刷写成功"
- [ ] R4 板子自动复位、新固件按预期启动（以该固件实际行为为准）
- [ ] R5 重复刷写第二个固件，验证序号连续性无跨会话残留（每次刷新页面即可复位序号）
- [ ] R6 救砖流程：刷回官方 AT 固件（放入 _at_firmware 后的一键恢复，或手动三件套）
- [ ] R7 全程导出 .log / 统计 .json 存档
- [ ] R8 （可选）勾选"扩展擦除"复刷一次，验证 P14 备注的线上字节行为
- [ ] R9 ESP32-C3：选 WiFi渗透工具 → EWT 连接 → 实刷 → 设备启动验证
- [ ] R10 ESP32-C3：BLE工具 实刷（验证推断偏移 0x0/0x8000/0x10000）

任何一步失败：原样记录现象与串口日志到本文件"实机记录"小节，进入修复循环，禁止标记通过。

### 实机记录

#### 线上环境（公网 HTTPS + Cloudflare 隧道）— 2026-09-17

部署形态：`https://flash.peipeidev.cn`（源站=本机 Mac + `cloudflared` 隧道；HTTP Basic 过渡鉴权）。用户在独立 Chrome 中经公网完成刷写。

| 项 | 结果 | 证据 |
|---|---|---|
| 端口选择弹窗可用 | ✅ | 首次公网尝试失败：`Must be handling a user gesture`（下载 5.2s 耗尽瞬时激活）→ 修复（`beginPortRequest()` 同步发起、下载与选端口并行）后用户确认弹窗正常，见 REVIEW_LOG「线上部署后修正」 |
| R1 选设备 → 选固件 → 连接串口 | ✅ | 用户实操（公网 HTTPS + Chrome 153） |
| R2 自动进下载模式 | ✅ | 同上（未出现需手动 BURN+RST 的提示） |
| R3 三段镜像写入 → 刷写成功 | ✅ | 用户确认"已经刷成功了" |
| R4 复位后新固件启动 | ✅（先例证据） | 2026-09-16 真机实测 `tools/hw-tests/reset_new_sequence.py`：复位成功后串口输出固件启动日志（`#calibration_ok` → `===== 握手包捕获系统启动 =====` → WIFI 初始化 → AP 就绪） |
| 公网侧资源与鉴权 | ✅ | 无口令 401 / 带口令 200；固件 831KB 下载后 md5 与本地一致（`bfae06c1…`）；隧道断开=530+1033 |
| 具体耗时 / 会话日志存档 | ⏳ 待补 | 用户下次刷写时导出 `.log` 附到本表（网页版 921600 档本机基准 56.8s） |

未完成（仍需真机）：R5 跨会话序号无残留、R6 救砖刷回 AT、R8 扩展擦除、R9/R10 ESP32-C3 实刷。

#### 本机 localhost（开发环境）— 2026-09-16

- TUI 与网页版均在真机验证通过（921600 档：`app has been sent successfully` → `verifying km0 km4 and app blocks....ok` → `[bw16-boot] 已复位回正常运行`）；协议四条修正（P11/P15/P16/P19）的实机依据见 `tools/hw-tests/README.md` 与 REVIEW_LOG。

#### 本机 API 模式（M2 签名分发链路首刷）— 2026-09-17

形态：`http://127.0.0.1:8002/`（FastAPI 同源托管 + 一次性签名取件）。用户在独立 Chrome 153（macOS）实操，固件 `bw16-03` 戒网瘾，CH340（VID 0x1a86）。日志存档：`~/Downloads/webflash_戒网瘾_1789581774809.log`。

| 项 | 结果 | 证据（日志行 ↔ 服务端记录） |
|---|---|---|
| 签名取件链路（F4） | ✅ | 日志 `已取得一次性取件链接（60s 内有效），并行下载四件套` ↔ `flash.begin files=4` + 4×`firmware.fetch`（jti 全部一次性核销） |
| 字节完整性 | ✅ | 客户端 sha256 逐件校验通过 ↔ 服务端审计记录 sha256（flashloader `930712…` / km0 `453c88…` / km4 `05fbf8…` / image2 `ca6224…`） |
| R1-R3 选设备 → 进模式 → 三镜像写入 | ✅ | 方案 B（CH340）自动进模式；两次切速 921600（P19）；擦除 197 扇区；写入 02:02:13→18 |
| R4 收尾复位（P16） | ✅ | 首次复位后仍吐 NAK → 自动第 2 次复位 → 捕获启动文本 `#calibration_ok` / `RTL8720DN Deauther Star`（新固件真跑） |
| 结果回传（F7） | ✅ | 日志 `成功（48.6s）` ↔ `flashsession.result=success, duration_s=48.6`（02:01:59 → 02:02:48） |
| 耗时基准 | ✅ | flashloader 4.6KB + 三镜像 796.7KB 全程 48.6s，落在 921600 档已知区间（46-57s） |

> 注：此场为 M2 新链路的真机验证；「线上环境」表中待补的 `.log` 指 flash.peipeidev.cn 的 01:08 公网会话，仍待用户下次公网刷写时导出。

## 三、关联说明

- 实施中对任务书 1.2 的两处证据修正（P14 擦除线上字节、P16 复位前 NAK 宽限）见 PROTOCOL.md 对应条目与 REVIEW_LOG M2；R3/R8 即其实机复核点。
- 待实机风险清单见 REVIEW_LOG 各阶段"风险审查"表。
