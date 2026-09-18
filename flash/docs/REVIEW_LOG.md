# 审查日志（REVIEW LOG）

每阶段结束执行四项门禁（事实 / 代码 / 测试 / 风险），全绿才进入下一阶段。结论按阶段倒序追加在对应章节。

---

## M0 证据复核（2026-09-15）

**产出**：`web/docs/PROTOCOL.md`（P1–P18 + W1–W3）。

### 1) 事实审查 — ✅ 通过
- 用 grep 提取 PROTOCOL.md 全部协议数值（0x02/0x04/0x06/0x07/0x15/0x17/0x26/0x082000/0x08000000/0x08004000/0x08006000/1032/1031/4096/115200/各延时/VID 表），逐个确认落在带"文件:行号"出处的条目内，无"凭记忆发明"的常量。
- 关键证据经主会话亲自逐行复核（非仅转述子代理结论）：`/tmp/bw16-flasher.js` 1–186 行全部行号；`flash_tool.py:1606-1648`；`刷入.command`（260525 版）L9-26/48/52-65/206/241/265；`intercept_noreset.c:80-95,148`；`firmware_config.json` 全文。参考文件以 SHA-256 `071f2b73…` 固定证据版本。
- 发现并如实记录的证据缺口：
  1. 官方 Python 源码（Arduino15 ameba_d_tools）本机不存在 → PROTOCOL.md 第 0 节声明，证据链改为 E1 本地实测脚本 × E2 参考实现交叉 + E3/E4 官方二进制/插桩旁证。
  2. 官方 C++ 工具存在 SLIP 层（0xC0/0xDB）而参考实现为裸包 → P17 留档，作为实机联调第一排查点。
  3. 全片擦除命令无本地证据 → 不实现裸全片命令，高级选项改为 P14 命令的扩展覆盖擦除（待实机验证）。
  4. 进下载模式存在两套有时出处的时序（A: 500/200/500，B: CH340 实测）→ 实现为"先 A 后 B 再手动引导"，均已标出处。

### 2) 代码审查 — 本阶段无产品代码，N/A（文档数值准确性已在事实审查覆盖）。

### 3) 测试审查 — 本阶段无测试，N/A（M2 起生效；黄金 fixture 将以 P9/P10/P11 为断言基准）。

### 4) 风险审查 — 新引入风险及缓解
| 风险 | 等级 | 缓解 |
|---|---|---|
| 参考实现原文在 /tmp（易失），日后无法直接溯源 | 低 | 已以 SHA-256 固定版本 + PROTOCOL.md 全量转述行为要点；上游仓库可重新获取比对 |
| 裸包 vs SLIP 差异若为真（部分批次 flashloader 只认 SLIP），实机会拒包 | 中 | P17 留档为第一排查点；实机验收（M6）覆盖三镜像全流程 |
| 时序 A 在 CH340 类板卡成功率未知（E2 出自另一接线方案） | 中 | 自动回退时序 B（本机实测过），再回退手动引导（≤3 次） |
| 17 份 flashloader 副本理论可能不一致 | 低 | M1 构建脚本做 md5 一致性校验，不一致即告警并拒绝构建 |

**门禁结论：M0 全绿，进入 M1。**

---

## M1 静态骨架（2026-09-15）

**产出**：`tools/build_web_manifests.py`、`web/index.html`、`web/css/style.css`、`web/js/util.js`、`web/js/main.js`、构建产物 `web/manifests/{bw16,esp32c3}.json` + `web/firmware/`（58 个 bin）。

### 1) 事实审查 — ✅ 通过
- grep 本阶段全部新增代码（build 脚本 / index.html / css / util.js / main.js）：**无任何协议常量**（地址、命令字、时序均未出现），协议数值仅存在于 PROTOCOL.md；build 脚本中唯一数值表是颜色映射（出处 `flash_tool.py:343-345`，已在代码注释标注）。
- build 脚本对 ESP32 分区偏移的来源已内嵌注释：esptool 型解析自 flash_cmd 原文；platformio 型推断自同芯片 flash_cmd 布局并标注"待实机验证"。
- 实测结果：构建输出 17 个 BW16 固件 + flashloader 17 份 md5 一致（`db71809057ae…`）+ 2 个 ESP32-C3 分区表（0x0/0x8000/0x10000，解析自 config L92 原文）。

### 2) 代码审查 — ✅ 通过（自查清单）
- 中文路径编码：`util.js` 的 fetchJson/fetchBinary 统一 `encodeURI`；构建产物路径全 ASCII slug（bw16-01…），运行时不再触碰中文路径。✓
- UI 状态复位：切换设备时重置选中固件并隐藏刷写面板（`selectDevice` → `renderFlashTarget`）。✓
- 大文件 fetch：页面加载只拉 JSON 清单；bin 延迟到刷写时按需取（M3 实现）。✓
- 整体重读本阶段 diff：无遗留调试代码。✓

### 3) 测试审查 — ✅ 通过（浏览器实测，无单测义务）
- 本地 http.server 起服务，6 类资源（index / 双清单 / bin / EWT manifest / main.js）均 HTTP 200。
- 浏览器实测（IAB Chromium）：设备 tab 切换正常；BW16 列出 **17 个固件、中文名与 firmware_config.json 逐项一致**；颜色点渲染正确（G绿/C青/Y黄/H品红/R红/无color灰）；点选"戒网瘾最新版"后刷写面板显示名称/体积（808.7 KB，即三镜像之和）/来源路径；ESP32-C3 列出 2 个固件。全页截图存档于会话记录。

### 4) 风险审查 — 新引入风险及缓解
| 风险 | 等级 | 缓解 |
|---|---|---|
| platformio 型 BLE工具 的分区偏移是推断值 | 中 | 清单内 `offsetNote` 标注"待实机验证"；M4 实刷前页面显示该提示 |
| ESP Web Tools 依赖 unpkg CDN，离线不可用 | 低 | M4 接入时做加载失败降级提示；README 注明 |
| `web/firmware`、`web/manifests` 为纯构建产物，手改会被覆盖 | 低 | 构建脚本幂等重建；README 说明"改 firmware_config.json 后重跑构建" |

**门禁结论：M1 全绿，进入 M2。**

---

## M2 BW16 协议层（2026-09-15）

**产出**：`web/js/serial.js`、`web/js/ameba.js`（独立重写实现）、`web/test/`（4 个测试文件 + 模拟设备状态机 + 黄金 fixture）、`tools/gen_packet_fixtures.py`、`web/package.json`。**测试 33/33 全绿**（`node --test --test-force-exit test/`）。

### 1) 事实审查 — ✅ 通过（发现 2 处协议差异，已回写 PROTOCOL.md）
- grep `web/js/*.js` 全部协议数值：ameba.js 46 处 `[Pn]` 出处标注，全部常量集中在 `PROTOCOL` 冻结表；serial.js 仅 115200 [P1]、0x15/0x06 [P2]、5000ms [P3]。无出处不明常量。
- **差异 ①（P14 擦除线上字节）**：测试断言抓到——参考实现在 6 字节缓冲上 `setUint32(1,addr)` 后 `setUint16(4,sectors)`，**地址最高字节（恒 0x08）被扇区数低字节覆盖**，实际线上格式为 `[0x17, addr 低3字节 LE, sectors u16 LE]`（6 字节），与任务书 1.2"addr32+u16"的 7 字节记法不符。按铁律以实机验证过的参考实现线上字节为准，PROTOCOL.md P14 已加修正注，**待 M6 实机复核**。
- **差异 ②（P16 复位前就绪信号）**：XMODEM 数据阶段结束后设备是否恢复 NAK 流无本地证据。实现采用稳健路径：复位前等 NAK 给 2s 宽限，超时直接发 RESET（固件已写入完毕）。PROTOCOL.md P16 已加修正注，**待 M6 实机复核**。

### 2) 代码审查 — ✅ 通过（整体重读本阶段 diff）
- 锁与关闭：`SerialSession.close()` 幂等，reader.cancel → 双 releaseLock → port.close 顺序释放；disconnect 监听器移除。单测覆盖（关闭后 write 抛错、二次 close 无害）。
- 快速失败：读流致命错误记录 `_fatalError`，后续等待立即失败而非挂满超时（测试曾抓到该缺陷，已修）。
- 超时与重试：等待默认 5000ms [P3]；进模式方案 A→B→手动×3 [P5/P6/P7/F4]；最终复位 2s 宽限。
- 进度按真实数据字节计（不含块补齐 padding，测试曾抓到按 padded 计数，已修）。
- 异常路径 UI 状态复位：属 M3 UI 接线范围，此处 driver 保证 `finally` 必然关串口。

### 3) 测试审查 — ✅ 通过（33/33，全部断言到具体字节/序列）
- 黄金对照：`tools/gen_packet_fixtures.py` 以 Python **独立实现** P9/P10 生成 3 组 1032 字节全量向量，JS 输出逐字节 deepEqual；另有手算 checksum 常数（全零块 seq=1 → 0x28；Python 向量 seq=129 → 0x48）与"零初值必不相同"回归断言（坑 A）。
- 全流程（模拟设备状态机）：15 包序号全会话连续 [P11]、镜像/SRAM 字节逐个落位、RESET×2 / FLASH_MODE×1 / XMODEM 恰好 1 次 [P12/P15]、逐镜像擦除 3 条 [P14]、结束 RTS 脉冲 [P16]、进度终态 written==total。
- 失败路径：设备拒包（NAK）不挂死、A 拦截后回落 B、手动引导恰好 3 次且引导阶段零信号操作、3 次失败后报错关串口、中途拔线立即失败且 finally 关闭。
- 过程中修复的测试侧问题（如实记录）：测试会话漏调 `open()`；断言串笔误（'RT'→'Rd'）；mock flash 写入按包地址建键导致多块镜像丢失（改为按已知基址归并）。

### 4) 风险审查 — 新引入风险及缓解
| 风险 | 等级 | 缓解 |
|---|---|---|
| P14 线上字节修正若理解有误（真机要求 7 字节） | 中 | M6 实机刷写为最终裁决；若失败仅影响擦除步，可快速回滚为 7 字节布局 |
| 时序 B 的 10ms DTR 窗口在浏览器 setSignals 延迟下可能超窗（本地 pyserial 实测 <1ms，浏览器延迟未知） | 中 | B 失败自动落手动引导（≤3 次）；M6 实机记录真实成功率 |
| 模拟设备"NAK 流常开"为建模假设 | 低 | driver 对两种设备模型（静默/常开）均兼容（P16 宽限策略） |
| XMODEM 数据期杂散 NAK 积压队列 | 低 | 队列上限 8192 字节自动裁剪 [P3]，不参与匹配歧义 |

**门禁结论：M2 全绿，进入 M3。**

---

## M3 BW16 端到端 UI（2026-09-15）

**产出**：`web/js/log.js`（.log/.json 导出，字段兼容 flash_log/ 与 flash_stats.json [W3]）、`web/js/ui.js`（进度/结果/手动引导/忙碌锁）、`web/js/main.js` 重写（完整刷写链路 + `?mock=1` 演练模式）、`tools/webserver.py`（no-store 静态服务器）、构建脚本补 sha256 字段（浏览器 WebCrypto 不支持 MD5，运行时改用 SHA-256 校验）。

### 1) 事实审查 — ✅ 通过
- grep main.js/ui.js/log.js：无协议常量；唯一数值表 `BW16_VIDS = [0x0bda, 0x1a86]` 带注释指向 PROTOCOL.md P18。
- 界面上的地址/扇区数均来自驱动返回值（如日志中的 0x082000、200 扇区），非 UI 硬编码。

### 2) 代码审查 — ✅ 通过
- 超时与重试：F4 手动引导 ≤3 次由驱动实现，UI 仅呈现；忙碌锁 `state.busy` 防并发点击。
- 异常路径 UI 复位：catch → 错误提示；finally → 隐藏进度 + setBusy(false) + 统计记录。浏览器断线演练验证：进度条隐藏、按钮恢复、失败信息含建议。
- 中文路径编码：导出文件名剥离非法字符；fetch encodeURI 沿用。
- 发现并修复：main.js 漏导入 `$` 导致 init 静默失败（被新增的早期错误钩子 `window.__errs` 抓到）；为避免开发期模块缓存掩盖问题，新增 no-store 服务器。

### 3) 测试审查 — ✅ 通过（浏览器实测三条路径 + 单测回归）
- **成功路径**（?mock=1，真实固件字节）：戒网瘾最新版 832844/832844 字节精确一致，7.8s 完成；日志含模式机全过程（方案 A 进入 → flashloader → 逐镜像擦除 2/2/200 扇区 → 三镜像写入 → 复位）；统计 localStorage 记录 {total:1, success:1, ...} 字段与 flash_stats.json 一致。
- **手动引导路径**（?mock=1&blockauto=1）：自动时序失败后引导出现（剩余 3 次）→ 模拟 BURN+RST → 点重试 → 12.7s 刷写成功，引导面板正确隐藏。
- **断线路径**：flashloader 写完后模拟拔线 → 立即失败，提示"串口已断开，请重新插拔设备后重试"，UI 状态完全复位。
- 单测回归：33/33 保持全绿。

### 4) 风险审查 — 新引入风险及缓解
| 风险 | 等级 | 缓解 |
|---|---|---|
| 浏览器 setSignals 往返延迟可能超过时序 B 的 10ms 窗口 | 中 | 待实机验证（M6）；失败自动落手动引导 |
| 4 个 bin 并行 fetch 峰值内存约 3.3MB | 低 | 移动端可承受；如遇问题可改顺序加载 |
| 模块/HTTP 缓存可能让旧版 js 生效 | 低 | webserver.py 全响应 no-store；README 注明用启动脚本 |
| mock 演练路径（?mock=1）暴露 __mockDevice 钩子 | 低 | 仅演练参数下存在，正常页面无注入 |

**门禁结论：M3 全绿，进入 M4。**

---

## M4 ESP32-C3（2026-09-15）

**产出**：`web/js/espweb.js`（ESP Web Tools v10 懒加载 + 降级提示 + 状态桥接日志）、index.html 新增 `#esp-web-slot` 与偏移说明区、CSS 按钮主题变量。EWT manifest ×2 已由构建脚本生成（M1 起）。

### 1) 事实审查 — ✅ 通过
- EWT CDN 地址与 `<esp-web-install-button>` 元素行为：2026-09-15 WebFetch 实测 unpkg 可用（W2 已记）。
- WiFi渗透工具分区表（0x0/0x10000/0x8000）解析自 firmware_config.json L92 flash_cmd 原文；BLE工具偏移推断并标注"待实机验证"。运行时无新协议常量。

### 2) 代码审查 — ✅ 通过
- F1 防呆（双向实测）：ESP32-C3 固件下 BW16 按钮隐藏、仅 EWT 按钮；切回 BW16 后 EWT 卸载、BW16 按钮恢复。
- 库加载失败降级：slot 内显示告警并建议本地工具路径，不阻塞页面。
- 清单用站内绝对路径 `/firmware/<slug>/manifest.json`（启动脚本以 web/ 为根，路径稳定）。

### 3) 测试审查 — ✅ 通过（浏览器实测）
- 选择 WiFi渗透工具：EWT 按钮挂载成功（custom element 已注册、manifest 属性正确、日志桥接就绪、0 页面错误）。
- 选择 BLE工具：按钮挂载 + "待实机验证"偏移说明正确显示。
- 真机刷写：**待实机验证**（M6 执行；需插 ESP32-C3 并在浏览器弹窗中授权串口）。

### 4) 风险审查 — 新引入风险及缓解
| 风险 | 等级 | 缓解 |
|---|---|---|
| unpkg CDN 不可达时 EWT 不可用 | 中 | 已做降级提示；README 提供离线方案说明 |
| BLE工具偏移为推断值 | 中 | 页面明示"待实机验证"；M6 实刷裁决 |
| EWT 自管串口选择，无法注入 VID 过滤 | 低 | F1 在固件/设备选择层强隔离；README 注明 |

**门禁结论：M4 全绿，进入 M5。**

---

## M5 安全与救砖（2026-09-15）

**产出**：`web/js/guard.js`（VID 判级纯函数）+ `web/test/guard.test.js`（8 项单测）、`web/js/rescue.js` + index.html 救砖视图（三镜像上传/SDK 备份填充/AT 固件入口）、构建脚本新增 `_sdk_backup` 归档、main.js 接入 VID 校验与视图切换。

### 1) 事实审查 — ✅ 通过
- VID 判据表集中在 `guard.js DEVICE_VIDS`：BW16 强判 0x0BDA、ESP 强判 0x303A/0x10C4、CH340 0x1A86 双方警告级——逐项对应 PROTOCOL.md P18（出处 flash_tool/com_ports.py:12-15 与 刷入.command 的 wchusbserial 注记）。
- 救砖镜像地址不新增常量，复用驱动内 P13 地址表。

### 2) 代码审查 — ✅ 通过
- 强拦截逻辑：跨类强判 VID → `block`（抛错终止）；CH340/未知/无 VID → `warn`（confirm 确认后可继续）；mock 串口上报 0x0BDA → 静默放行。
- 断线保护：M3 已验证（浏览器断线演练 + 单测），救砖路径复用同一驱动与 finally 关闭逻辑。
- ESP Web Tools 侧无法注入 VID 过滤（其自管串口选择），已在 REVIEW_LOG M4 风险表与 README 说明；固件/设备选择层的强隔离（F1）覆盖主要误刷场景。

### 3) 测试审查 — ✅ 通过
- 单测 41/41（原 33 + guard 8），guard 断言含"跨类拦截/警告级/未知 VID/表冻结"。
- 浏览器实测：救砖视图切换正常；`?mock=1&rescuebins=bw16-01` 演练三槽自动填充 → 点"连接并恢复" → 1.8s 恢复成功、日志完整、统计记成功；SDK 备份填充按钮（km4 → 4456 字节 ✓）；AT 固件区在无本地 AT 包时如实显示获取渠道指引（无编造链接）。
- 过程修复（如实记录）：initRescue 传参错误（传整体 manifests 应传 bw16 清单）；救砖镜像键名映射错误（文件名 → km0/km4/image2）。

### 4) 风险审查 — 新引入风险及缓解
| 风险 | 等级 | 缓解 |
|---|---|---|
| 救砖写入固定地址，用户上传错误 bin 可能写坏 boot | 中 | 界面明示地址表与用途；扩展擦除默认勾选；文档强调仅刷配套三件套 |
| 文件上传无法自动化验证（浏览器限制） | 低 | 演练参数 rescuebins 覆盖同一代码路径；真实文件选择路径留待用户实机验证 |
| AT 固件获取渠道文案可能随官网变动 | 低 | 仅给出站点级指引，未给深层链接 |

**门禁结论：M5 全绿，进入 M6。**

---

## M6 验收与文档（2026-09-15）

**产出**：`启动网页版.command`（一键起服+开浏览器，端口占用自动顺延）、`README-web.md`（快速开始/兼容矩阵/使用/演练模式/开发/许可/免责）、`web/docs/ACCEPTANCE.md`（自动化验收 A1–A11 全绿 + 实机清单 R1–R10 如实标"待实机验证"）、`tools/webserver.py`。

### 1) 事实审查 — ✅ 通过
- 三份文档中出现的协议数值（832844 字节、0x08000000 三地址、VID 表、扇区数）全部带 PROTOCOL.md 编号或直接引用；无新常量。
- README 的 EWT/浏览器兼容声明沿用 W1/W2 已核实来源；AT 固件获取渠道仅给站点级指引，无编造深层链接。

### 2) 代码审查 — ✅ 通过
- `bash -n` 启动脚本语法通过；端口占用自动顺延（nc 探测）；trap 确保 Ctrl-C 回收服务进程。
- 调试探针（web/js/__probe.js、main.js 临时标记）已清理；早期错误钩子 window.__errs 保留为诊断特性。
- 最终浏览器巡检：徽章 ✓、双设备卡、双视图切换、免责声明在位、0 页面错误。

### 3) 测试审查 — ✅ 通过（最终回归）
- 单测 41/41（协议 33 + VID 防呆 8）。
- 构建幂等性：连续两次构建，清单除 generatedAt 外完全一致，17 固件 + SDK 备份 + flashloader 校验稳定。
- 浏览器巡检与演练路径（成功/手动引导/断线/救砖/EWT 挂载）全部复测通过。

### 4) 风险审查 — 遗留风险（均已显式标注"待实机验证"并汇总于 ACCEPTANCE.md R1–R10）
| 风险 | 等级 | 归属验收项 |
|---|---|---|
| 真机 BW16 全流程（两套时序真实成功率、P14/P16 修正复核） | 中 | R1–R5、R8 |
| ESP32-C3 真刷（EWT 链路 + BLE工具推断偏移） | 中 | R9–R10 |
| 真实文件选择器路径（浏览器无法自动化上传） | 低 | R6（人工执行即覆盖） |

**门禁结论：M6 自动化范围全绿；实机验收项（ACCEPTANCE.md R1–R10）待真机执行，已给出逐步脚本。任务书范围内可自动化工作全部完成。**

---

## 首次真机联调反馈修正（2026-09-15，M6 补充）

用户接上 BW16-Kit 后两次刷写失败，原样记录与处置：

1. **`No port selected by the user`（第一次）**：`requestPort` 按 VID 过滤（[0x0BDA, 0x1A86]）可能把 CP210x/FTDI 桥接的 BW16-Kit 端口从弹窗中隐藏 → **改为弹窗列全部串口，选择后由 guard.js 判级兜底**；CP210x(0x10C4) 从 ESP 强判据降为警告级（通用桥接芯片，与 P18 表同步修正，guard 单测更新，41/41 回归通过）。
2. **`No port selected by the user`（第二次，内嵌预览窗）**：实测确认 IDE 内嵌预览为 **Electron 壳**（UA 含 ZCode/Electron）——`navigator.serial` 存在、徽章曾误报"可用"，但弹不出 macOS 真实串口选择器，任何选择都会得到"未选择端口"。**页面新增 `isEmbeddedBrowser()` 识别**：徽章改显"⚠ 内嵌预览：真机刷写请用独立 Chrome"；在该环境下刷写失败时提示语直接给出"复制地址到独立 Chrome"的处置。README 兼容矩阵同步改为"❌ 真机不可用（实测）"。

**结论**：真机刷写必须在独立 Chrome/Edge 中执行（badge 显示"✓ Web Serial 可用"）；内嵌预览保留用于界面预览与 mock 演练。ACCEPTANCE.md R1–R10 待用户在独立 Chrome 中执行。

**补充处置（同日）**：用户导出的 .log 头部 UA（ZCode/Electron）证实两次尝试均在预览窗内。检查发现本机无任何独立 Chromium 浏览器（仅 Safari），已用 Homebrew 安装 Google Chrome 153 并直接打开工具页；内嵌环境下"连接并刷写"改为**硬提示**（不再调用 requestPort，直接给出"复制地址到独立 Chrome"指引，浏览器实测生效）。

**真机第一次刷写实测记录（Chrome，15:23）**：CH340 端口选中并通过警告确认 → 115200 打开 → **方案 A 时序 2 秒进入 ROM 下载模式（P5 真机验证通过，NAK 流正常）** → flashloader 首包发出后等待 ACK 超时（5s）失败。正中 P17 预留排查点（裸包 vs SLIP）。已实现诊断工具：`?debug=1`（RX 字节示踪 + 失败自动输出 ACK/NAK 计数与末 40 字节时间线）与 `?slip=1`（SLIP 帧实验，`slipEncode` 单测覆盖）。待用户按 debug→slip 顺序实验，以"NAK=拒收 / 沉默=不认帧"判据裁决，结果记录于此。

## P15/P17 协议裁决：官方写入工具反汇编（2026-09-16）

### 证据链
1. **slip=1 实验结果（用户 2026-09-15 日志 `webflash_断网_1789457658649.log`）**：SLIP 帧下 flashloader 首包同样 ACK 超时 → "简单换帧可解"假设被证伪。
2. macOS 官方 `upload_image_tool_macos` strings：SLIP 函数串 + "Enter Uart Download Mode"/"Handshake fail!"/"Flashloader download fail" + `serialport_set_baudrate`（该 x86_64 二进制因本机无 Rosetta 无法运行；且 Arduino15 下 1.1.3 目录已于 2026-09-16 00:25 前被清空，strings 证据系删除前提取）。
3. **Windows 一键刷入包使用双工具**（`刷入.bat` 实证）：擦除 = `upload_image_tool_windows.exe … 1500000`；**写入 = `flash/upload_image.exe .\a COM3`（默认 115200）**。
4. **E4 反汇编**：`bw16/一键刷入捕获握手包厂商检测260517/flash/upload_image.exe`（MinGW x86-64 PE，未 strip，SHA256 `0dc86f3c3dd32075c088810fd81ac475fdc4e0fc425f4bf1c2619ede25d8859d`）。关键函数（llvm-objdump，VA）：
   - `wait_sync_char(0x41dab0)`=等 n 个 NAK；`wait_response_char(0x41dba0)`=等 0x06，NAK 容忍；`send_cmd(0x401b4f)`=0x07 之外先 1 NAK；
   - `set_max_speed(0x41d980)`=可选 `[0x05,code]` 切波特率（表 @0x4a4040：115200=0x0C…1500000=0x18），**结尾固定 send_cmd([0x07],1)+1 NAK**；
   - `write_block(0x4020a5)`=发包前 1 NAK，裸 1032B 包，每包等 ACK，seq 全局连续；`uint8_checksum(0x401d57)`=0xFF 初值 8 位累加；
   - `program_spi_flash(0x4023e5)`=2NAK→0x07→flashloader→[0x04]→重配115200→2NAK→[0x26,1,1,0]→erase×3→1NAK→write×3→[0x27]×3 校验→[0x04]；
   - `erase_block(0x402348)`=[0x17]+u32 addr+u32 sectors（byte4 重叠覆盖，P14 官方级实证）；
   - `flash_image(0x4029be)`=load_file(flashloader,**0x82000**)；`write_rs232(0x401878)`=WriteFile 直写，**无 SLIP**。

### 根因裁定
真机首包 ACK 超时 = **驱动序列缺 [0x07]**（ROM 收到 0x07 才进入 SRAM 接收态），且参考实现 E2 把 0x07 放在镜像阶段（官方在 flashloader 前）——位置同样错误。与帧格式（SLIP）无关。

### 代码修正（本次门禁范围）
- `ameba.js`：flashloader 前插入 `sendCommand([0x07])+1 NAK`；镜像阶段改为"擦除后 1 NAK + 每镜像 writeImage(waitForStart:true)"，不再发 0x07；slipEncode 注释改记"已否决实验"。
- `mock-device.js`：0x07 仅在 download-rom 态接受一次；0x07 前的数据包 NAK 拒绝并记 `packet-before-xmodem` 事件。
- 测试：flow.test.js 增加 0x07 位置断言与 mock 契约回归；**43/43 通过**（原 42 + 新增 1）。
- PROTOCOL.md：P15 重写（E4 逐函数证据）、P17 裁决、P14 升级官方级证据、P16 补充官方尾部序列兼容性。

### 风险与待验证
- E4 为"写入工具"证据；擦除工具（1500000+SLIP）网页版不复刻（[0x17] 路径已覆盖擦除需求）。
- [0x27] 读回校验步骤未实现（CRC 算法未逆向），不影响刷写成功，列为后续可选。
- **最终裁决仍需真机确认**：用户在独立 Chrome 重测，预期首包 ACK 正常（修复逻辑完全按 E4 序列）。R1–R10 待执行。

## 线上部署后修正：端口弹窗不出现（2026-09-17，线上实测）

### 现象与证据
用户导出的线上会话日志（`webflash_断网_1789578523029.log`）：

```
[01:08:27] 加载固件文件…
[01:08:32] 固件加载完成：flashloader 4.6 KB + 三镜像 820.7 KB
[01:08:32] 请在浏览器弹窗中选择 BW16 对应串口（列出全部串口，选完自动校验）…
[01:08:32] 刷写失败：Failed to execute 'requestPort' on 'Serial': Must be handling a user gesture to show a permission request.
```

### 根因
Chrome 的用户激活是**瞬时激活（约 5 秒）**；`main.js` 的 `onFlashClick` 先 `await loadBw16Images(fw)` 再调 `requestPort()`。
本机 localhost 下载 <1s 从未暴露，**公网部署后**下载 5.2s → 手势过期被拒。典型的"部署才暴露的时序问题"。

### 代码修正
- `serial.js`：新增 `beginPortRequest()` —— 同步调用 `requestPort()`、立即挂空 catch（防 unhandledrejection），返回原 promise（错误在 await 时照常抛出）。
- `main.js`：点击后先 `beginPortRequest()`，再并行 `loadBw16Images()`，最后 `await portPromise`（顺带把提示语改为"选择已确认，继续刷写…"）。
- `rescue.js`：新增 `startPortRequest()`（`?mock=1` 返回 null）；`restoreAt()`/`onRescueClick()` 均在**任何 `fetchBinary` 之前**发起；`runRescueFlash(images, extendedErase, portPromise)` 复用该 promise（未传时兜底发起）。

### 测试审查
- 新增 `web/test/gesture-order.test.js`：3 项**源码顺序断言**（main.js 的 `beginPortRequest` 早于 `await loadBw16Images`；rescue.js 两条管线早于 `await fetchBinary` 且传入 portPromise；serial.js 立即挂 catch 并返回原 promise）。仓库无 DOM 测试环境，故用顺序断言兜住该类回归，并在文件头写明理由。
- `npm test`：**50/50 通过**（原 47 + 新增 3）。
- 线上验收：`deploy/publish-local.sh` 重新发布；`https://flash.peipeidev.cn/js/main.js` md5 与本地副本一致（`b461c4118c2c016ea0c405e2e014ddc4`），三个文件线上均含新逻辑；401/200 鉴权行为不变。

### 风险与待验证
- `?mock=1` 演练路径不受影响（mock 模式不发端口请求）。
- **真实浏览器复测待用户执行**：预期点击"连接并刷写"后**立即**弹出串口列表（不再先等固件下载）。
- 同类风险点已排查：`espweb.js`（ESP32 侧）由 esp-web-tools 自身按钮触发 requestPort，不受影响；`serial.js` 的 `reopenAt()` 不涉及权限手势。

## M0 基线与决策（2026-09-17，后端开发开工前）

### 基线实测（全部命令可复跑）
| 项 | 命令 | 结果 |
|---|---|---|
| 备份 | `tar -czf backups/baseline-pre-backend-20260917_012432.tar.gz …` | 11MB，含 web/deploy/docs/tools/TUI |
| 协议单测 | `cd web && npm test` | **50/50 通过**（13.5s） |
| 常驻服务 | `launchctl list \| grep bw16` | `bw16-site`、`bw16-tunnel` 均 exit 0（pid 98307/98689） |
| 公网鉴权 | `curl https://flash.peipeidev.cn/` | 无口令 **401**，带口令 **200**（首页/main.js/ameba.js/清单） |
| 固件一致性 | 下载 `bw16-17/km0_km4_image2.bin`（1,171,456B，2.7s） | md5 `9e7e0471…` 下载=本地=清单 三者一致 |
| 真机冒烟 | `python3 tools/hw-tests/full_flash.py /dev/cu.wchusbserial10 bw16-01` | 写入 101.5s 全成功；**修复两处脚本缺陷后**退出码 0，复位重试 2 次后固件启动（抓到 `[rltk_wlan_control]` 启动文本） |

### 冒烟发现并修复的两个脚本缺陷（不影响协议与网页版）
1. `full_flash.py` 的 `Dev` 类没有 `close()` 方法 —— 成功路径最后 `finally: dev.close()` 抛 `AttributeError`，成功也返回非零退出码。已补 `close()`。
2. `full_flash.py` 收尾复位仍是**旧序列**（BOOT 全程按住 + RTS 长脉冲 + 事后才放 DTR），复位释放瞬间 BOOT 有效 → 芯片落回下载模式（真机复现：串口持续吐 0x15）。已按 P16 对齐 `ameba.js` 修正版：**先抬 BOOT → 0x04 → （BOOT 高）RST 低 150ms → 释放**，复位后验证 NAK，仍吐 NAK 自动再试（≤3 次）。修复后真机第三次尝试启动成功、有固件启动文本为证。`reset_new_sequence.py` 原本就是新序列，未动。

### 1.4 待验证项复核结论
- **固件 flash 空闲区（水印落点）—— 部分核实，落点维持待验证**：
  - 提示词所称「`flash_log/` 里的 `_dct_init_valid_module` 日志、固件用到 `0x001F6000` 一带」**在仓库内找不到出处**（flash_log/、docs/、全仓库 grep 均无该字符串），按铁律记为**未证实**，不得作为选址依据。
  - 已核实（有出处）：三镜像写入范围 `0x0/0x4000/0x6000(+size)`（`tools/amebad_tool_src/upload_image_tool.cpp:166-168,1031-1033` 与 PROTOCOL.md P13）；板卡包 SDK `platform_opts.h:52-62` 给出两组运行期数据扇区——Arduino 默认分支 `UART_SETTING 0xFC000 / AP_SETTING 0xFE000 / FTL_PHY 0x102000 / FAST_RECONNECT 0x105000`，特殊配置分支 `0x1FA000/0x1FB000/0x1FC000/0x1FF000`；`rtl8721d.h:137-142` 另有 `FLASH_SYSTEM_DATA_ADDR 0x3000`、`FLASH_BT_PARA_ADDR 0x5FF0`。
  - **推论与风险**：bw16-17 的 image2（止于 flash 0x123800）已越过默认分支的 0xFC000-0x105000 且 17 个固件实测均正常 ⇒ 这些固件并未使用默认分支那些扇区，运行期数据大概率在 flash 末段（与 0x1F6000 的传闻方向一致，但无直接证据）。**结论：0xFC000-0x110000 与 0x1F0000-0x1FFFFF 都按"可能被占用"对待；候选区为最大镜像结束后的首个扇区（0x124000 起），F17 动工前必须用"写入标记→复位→固件正常跑→（配合固件侧读回）"的实机流程逐固件验证后再定**。
- **公网端到端刷写**：✅ 已完成（0.5/ACCEPTANCE.md），仅剩用户补导出会话 `.log`。
- **Android Chrome 兼容**：仍待用户真机验证（README-web 兼容矩阵已有 β 版可用线索）。
- **VPS 迁移复验**：阻塞于用户购机；脚本与操作卡片已就绪（§4.1）。

### M0 决策表（按附录 A 默认值执行，用户未另行拍板）
1. 服务器：现状=本机+隧道；有付费用户即购香港轻量按卡片迁移。2. 域名：自有（已就绪）。3. 后台访问：IP 白名单 + 仅 HTTPS（默认）。4. 支付：先卡密，`order` 表预留。5. 试用额度：3 次/账号。6. 反馈需登录，公告公开。7. 水印落点：待 F17 实机核对（上文结论）。

### 本阶段无新对外接口，安全/代码/测试审查项顺延至 M2

## M2 固件分发服务（2026-09-17 完成并通过门禁）

### 交付内容
- **后端** `server/`（FastAPI 0.115 + SQLModel 0.0.22 + SQLite，venv 固定版本，全部自托管无第三方数据外流）：
  - `POST /api/session`：httpOnly+SameSite=Lax 匿名会话（M3 挂账号）；库里只存 token 哈希。
  - `GET /api/catalog`：仅出 online+visibility 的固件；无会话 401；结构与静态清单同形（含 colorCss，映射自 `tools/build_web_manifests.py` COLOR_MAP）。
  - `POST /api/flash/begin`：建 `flash_session` + 为四件套各签**一次性 HMAC 票据**（TTL=45s≤60s，绑定 session+指纹哈希+IP 段 /24·/48）。
  - `GET /api/fw/{file_id}`：校验签名/一次性/过期/会话/指纹/IP 段 → 私有随机目录流式发字节；**一次性核销用 `UPDATE…WHERE used_at IS NULL` 原子判定**（SQLite/PG 行为一致，并发重放只有一个成功）。
  - `POST /api/flash/end`：结果/耗时/失败阶段回传（控制字符消毒、限长），校验会话归属。
  - `GET /api/health`；生产关闭 docs/openapi；审计全量落 `auditlog`（append-only，服务层无 update/delete）。
  - `server/ingest.py`：`web/manifests/bw16.json` → 私有随机目录（`data/firmware/<rand12>/`）+ 入库，幂等（按 sha256 判重）；`--online/--offline/--list` 运维开关。
- **客户端双模式** `web/js/backend.js`：`?local=1` 强制本地 / `?api=<base>` 强制 API / 自动探测同源 `/api/health`；API 模式 `loadBw16Images` 改走 begin→并行签名取件→flashSessionId 随 `flash/end` 回传；sha256 校验逻辑不变；`backendReportFlashEnd` 尽力而为不阻塞 UI。**W1 手势顺序未动**（beginPortRequest 仍同步先行）。
- pytest **16 项**（会话门禁/目录隐藏下线固件/全链路取件/伪造签名/过期/重放/指纹不符/伪造参数/越权 end/审计落库/核销原子性）；web 单测 **52 项**（50 原有 + backend 映射 2 项）。

### 实测证据（命令+数字）
| 项 | 结果 |
|---|---|
| `cd web && npm test` | **52/52**（13.5s） |
| `server/.venv/bin/python -m pytest tests/` | **16/16**（1.2s） |
| 真机冒烟（M0 已跑） | `full_flash.py` 全绿 101.4s，exit 0 |
| API 模式演练（?mock=1，浏览器实测） | begin→4 次签名取件→模拟刷写成功 19.9s→end(success) |
| **API 模式真机实刷（用户操作，本机 Chrome+CH340 真板）** | `bw16-03` 戒网瘾：flash.begin 02:01:59 → 4×取件（一次性全核销）→ flash.end **success 48.6s**；审计与 flashsession 记录齐备（DB 查证） |
| 重放/无指纹 | 重放 403；缺 fp 403（curl 实测） |

### M2 范围决定（记档）
1. **线上暂不切 API**：`flash.peipeidev.cn` 仍为静态+Basic（M3 有账号后统一切换）；API 目前仅本机 8002。发布脚本不动。
2. **救砖页暂走静态 path**：API 目录里保留静态 path 供 rescue.js；API-only 部署时再迁移（已知限制）。
3. **协议常量仍内置客户端**（与本地模式同源同值）；"服务端下发常量"归 M7 F12（避免动 ameba.js 引入回归）。
4. **baud 暂不回传**（ameba.js 不外露，不为取值改协议层）；flashsession.baud 留 0，M3/M4 顺带补。
5. ESP32-C3（EWT 自取固件）维持静态清单，不纳入签名分发。

### §8 门禁五项
1. **事实**：未动任何协议常量/时序；colorCss 映射出处 `build_web_manifests.py:37-44`；镜像地址未变（P13）。
2. **代码**：异常路径——begin 404/401/422 分类、取件 deny 全走审计、end 归属校验；一次性核销原子化（本次审查发现并修复：原"读-判-写"在并发下可双重取件）；FileResponse 流式；DB 会话全部上下文管理。
3. **测试**：pytest 16/16、npm 52/52、真机 full_flash 冒烟绿。
4. **安全**（新增对外接口逐类）：未授权→catalog/begin/end 无会话 401 ✅；越权→end 校验会话归属、fetch 校验 cookie 会话+指纹+IP 段 ✅；重放→一次性原子核销+过期校验 ✅；枚举→fileId 虽顺序但无签名/jti 不可用；未知与下线固件 begin 同为 404 不泄露 ✅；注入→SQLModel 参数化+fail_stage 消毒 ✅。
5. **风险**：`server/data/` 含固件明文，权限应 0700（M8 部署编排落实）；SECRET_KEY 未设时随机生成=重启失效（宁拒不工作不弱密钥）；回滚=删除 `server/` 目录与 `web/js/backend.js` 引用（web 单测兜底）。

## M3 账户、指纹与配额（2026-09-17 完成并通过门禁）

### 交付内容
- **账户（F1）**：`/api/auth/register|login|logout|me`；登录标识=邮箱或 11 位手机号（正则校验+小写规范化）；密码 **Argon2id**（argon2-cffi 23.1.0）；登录失败同 login_id+IP 15 分钟内 5 次 → 锁定（`loginattempt` 表）；错误话术统一（不存在/错密码同响应，防枚举）。
- **配额（F8-M3）**：注册送 3 次（BW16_TRIAL_QUOTA，附录 A 默认）；扣减在 begin（`UPDATE user SET quota=quota-1 WHERE quota>0` 原子，失败 402）；**failed/aborted 自动返还且仅一次**（`flashsession.refunded` 原子占位 + `quota_ledger` 流水）；`quota_ledger` 与 `user.quota_balance` 可对平（测试断言）。
- **并发限流（F2）**：同账号 pending 会话 ≥1 → 429；超过 15 分钟的 pending 会话在下次 begin 时自动回收（aborted+返还）。
- **指纹绑定（F2）**：begin 时上报指纹哈希（客户端已先哈希），落 `device_fingerprint`（user+hash 唯一行，更新 last_seen）；取件校验沿用 M2（指纹+IP 段）。
- **迁移机制**：`db.py` 增 `_ensure_columns()`（PRAGMA 检查 + ALTER TABLE ADD COLUMN）——首个用例就是修复老库缺 `flashsession.refunded` 列的线上问题。
- **客户端**：顶栏登录框/用户余额徽章（点击退出）；登录/注册对话框（错误内联显示）；begin 401 自动弹登录框；用户取消刷写按 `aborted` 回传→返还；**`?mock=1` 强制本地模式**（演练不建会话、不耗额度，`shouldForceLocal()` 有单测）。

### 实测证据
| 项 | 结果 |
|---|---|
| pytest | **28/28**（新增 12 项：注册验证/重复 409/错密码话术/锁定/argon2 存储/额度扣减/用尽 402/失败返还幂等/中止返还成功不返/并发 429/超时回收返还/越权 end 404/指纹落库） |
| npm test | **53/53**（+shouldForceLocal） |
| 真机 curl 全流程（8002 实服） | 注册 quota=3 → begin→2 → 取件 200 → 并发第二场 **429** → 失败 end → `refunded:true` → quota=3 |
| 浏览器 UI（IAB） | 登录按钮显示 → 对话框注册 → 顶栏「uitest@test.dev · 剩余 3 次（点击退出）」；?mock=1 无需登录 |

### §8 门禁
1. **事实**：Argon2id 参数取 argon2-cffi 默认（官方推荐）；额度=3 出自附录 A 默认决策；无协议改动。
2. **代码**：扣减/返还/结束态全部原子 SQL 判 rowcount；单事务提交；stale 回收先于扣减且独立提交；取件五重校验未动。
3. **测试**：如上，全绿。
4. **安全**：未授权 401 ✅；越权（end 归属双校验、fetch 会话+指纹+IP）✅；重放（票据一次性/end 一次/返还一次）✅；枚举（登录统一话术 ✅；注册重复 409 为必要 UX，已记录）；注入（参数化+正则白名单）✅。
5. **风险与已知项**：①并发 begin 的计数检查非原子，极端下可能同时 2 场 pending（仍受额度约束，M7 加 UNIQUE 部分索引或串行化）；②未知用户登录跳过 verify 有微小时序差（M7 补 dummy verify）；③注册无验证码通道（当前无 SMTP，M8 部署手册记为运营边界）。

## M4 反馈与公告（2026-09-17 完成并通过门禁）

### 交付内容
- **公告（F5）**：`announcement` 表（置顶/生效期/适用设备）；`GET /api/announcements` 公开可读（附录 A 决策"公告公开"），返回公告列表 + 生效中的 `client_version_policy`。
- **强制刷新（F5）**：客户端 `backend.version=1.1.0`；`isVersionBelow()` 语义化比较（单测覆盖）；低于 min_version 弹全屏"站点已更新"遮罩，一键刷新。
- **前端轮询**：API 模式每 10s 拉公告（init 立即一次），公告条置顶优先、可关闭（按 id 记住已读）。DoD"10s 内可见"实测达成（后台插入→页面不刷新→1s 后自动出现）。
- **反馈（F6）**：`feedback` 表（类型/正文/关联刷写会话/脱敏摘要 extra/状态 open→processing→resolved/处理人+备注）；`POST /api/feedback` 需登录、限频 5 条/小时、1-2000 字校验、关联会话校验归属（他人会话 404）；`GET /api/feedback/my` 给用户看进度。
- **客户端**：顶栏"反馈"按钮（API 模式显示）+ 对话框；提交时可附带最近一次刷写摘要（固件名/结果/耗时/失败阶段——不含串口原始数据，脱敏）。
- **运维 CLI** `server/ops.py`：公告增删查、最低版本策略设置、反馈查看/流转、用户列表/额度调整（记 ledger reason=admin）。M5 后台就绪前是运营入口，之后保留为应急通道。

### 过程中发现并修复的问题
1. **公告条内联 `display:flex` 压过 `hidden` 属性**——关闭按钮"关不掉"、初始渲染前有空条。修复：显示样式移入 style.css，`#announce-bar[hidden]{display:none}`（类级教训：带内联 display 的元素不能用 hidden 属性控制显隐）。
2. **uvicorn StaticFiles 无 no-store**——改版后浏览器拿旧 main.js/style.css 造成"改了没生效"假象（tools/webserver.py 本来就带 no-store）。修复：`NoStoreStaticFiles` 子类统一响应头（与线上发布行为一致）。
3. `db.py` 增加 `_ensure_columns()` 轻量迁移（M3 引入，本次亦受益）。

### 实测证据
| 项 | 结果 |
|---|---|
| pytest | **38/38**（+10：公告公开性/置顶排序/过期隐藏/设备过滤/策略返回/反馈登录门/创建+my 列表/校验/越权会话 404/限频 429） |
| npm test | **53/53** |
| 公告 10s 可见（DoD） | ops 发公告→页面不刷新→轮询 1s 后出现 ✅（IAB 后台标签页会被浏览器节流为 ~1min/次；前台真实用户无此问题，已在 REVIEW_LOG 记录） |
| 强制刷新（DoD） | min=99.0.0 → 轮询后全屏遮罩"测试：请刷新页面" ✅；恢复 0.0.1 |
| 反馈闭环（DoD） | UI 注册 fbui@test.dev → 提交 bug 反馈 → `ops.py feedback list` 可见 → `handle --status processing --note` 流转 ✅ |

### §8 门禁
1. **事实**：公开/需登录边界出自附录 A 决策 6；限频 5/h 与字数限制为保守默认（记录可调）。
2. **代码**：反馈限频用 COUNT 查询（非原子，极端并发可略超 5 条——低危，M7 收紧为原子计数）；公告排序服务端完成；摘要 JSON 长度截断。
3. **测试**：如上，全绿。
4. **安全**：未授权（反馈 401 / 公告公开=决策）✅；越权（关联他人会话 404，my 列表只出本人）✅；枚举（无新增可枚举面）✅；注入（参数化+长度截断）✅；限频（429）✅。
5. **风险**：公告/策略当前仅 ops CLI 可发（M5 收进后台并加 TOTP）；`ops.py` 无鉴权、能改库——**只能在服务器本机运行**，部署手册（M8）明确写入。

## M5 管理后台（2026-09-17 完成并通过门禁）

### 交付内容
- **`/admin`（F10）**：Jinja2 全服务端渲染（关键逻辑不下发浏览器），无前端构建依赖。
  - **登录三因子**：用户名 + 密码（Argon2id）+ **TOTP**（pyotp，强制）；失败 5 次/15min 锁定（按用户名+IP，进程内存，有 TOTP 兜底）；会话 30 分钟短时（cookie `path=/admin` + SameSite=Strict，库中只存 token 哈希）。
  - **IP 白名单**：`BW16_ADMIN_IPS` 默认 `127.0.0.1,::1`（安全默认），非白名单一律 403（先于登录判定，pytest 断言）。生产值写入部署手册（M8）。
  - **CSRF**：每个管理会话绑定 csrf 令牌；全部写操作 POST 校验（`secrets.compare_digest`），错误令牌 403（curl+pytest 双验证）。
  - 页面：看板（用户数/24h 刷写/成功率/在线固件/未结反馈 + 最近 10 场）、固件上下线与可见性、公告发布/删除+版本策略下发、反馈流转（状态+备注）、用户列表（加额/封禁，记 ledger）、审计（append-only 只读+动作过滤）。
  - 全部写操作落 audit_log（actor_kind=admin）。
- **运维入口**：`ops.py admin create <name>` 生成管理员（打印密码一次 + otpauth 链接）；`admin list`。

### 实测证据
| 项 | 结果 |
|---|---|
| pytest | **46/46**（+8：匿名 303、白名单 403、三因子错误/锁定、CSRF 403、**下线→目录立刻消失→恢复**、审计落库） |
| 浏览器实测 | /admin 匿名→跳登录页；密码+TOTP 登录成功；看板显示真实数据（4 用户 / 24h 5 场 / 40% / 17-17 / 1 反馈） |
| curl 全链路（DoD） | 下线 bw16-01 → **目录立即 0**；错误 CSRF → **403**；恢复上线 → 目录恢复 1 ✅ |

### §8 门禁
1. **事实**：TOTP=RFC 6238（pyotp 实现，valid_window=1）；Argon2id 沿用 M3；白名单默认出自任务书"默认仅内网"。
2. **代码**：所有写操作先守卫（白名单→会话→CSRF）再动库；会话过期/删除即时失效；模板无任何 JS。
3. **测试**：46/46 全绿。
4. **安全**：未授权（匿名 303→登录）✅；越权（非白名单 403、CSRF 403）✅；枚举（登录错误统一话术）✅；重放（会话 30min 短时+CSRF 单会话绑定）✅；注入（ORM 参数化+Jinja2 自动转义）✅。
5. **风险**：登录锁定为进程内存（重启清零）——TOTP 兜底，M7 评估入库；`/admin` 与站点同源同端口，部署时必须保持白名单为本机+跳板（M8 强调）；演示管理员 `admin` 为本机演示账号，上线前应删除或改密（记入部署手册）。

## M6 卡密与付费地基（2026-09-17 完成并通过门禁）

### 交付内容
- **卡密（F8）**：`redeemcode` 表（XXXX-XXXX-XXXX-XXXX，Crockford 字母表防混淆）；管理端批量生成（1-1000 张/批，面额 1-100）、CSV 导出、停用；`POST /api/redeem` 登录后核销——**原子核销**（`UPDATE…WHERE status='unused'` 行级占位）+ 每用户 10 次/分钟限速；核销即到账并记 ledger（reason=redeem，关联引用=卡密）。
- **订单与支付回调占位（D 块）**：`order` 表 + `POST /api/order/create`（占位渠道 manual）+ `POST /api/payment/callback`：签名=HMAC-SHA256(BW16_PAYMENT_SECRET, id.amount.status)，**幂等到账**（credited 行级占位，重放返回 credited:false 不重复加额度），回调留档脱敏；`POST /admin/orders/mark-paid` 手动补单与回调共用同一到账函数。
- **客户端**：登录后顶栏"兑换码"入口 + 对话框，到账即刷新余额徽章。
- **运维**：`ops.py redeem gen <count> <value> [--batch] [--out file]` / `redeem list`。

### 过程中发现并修复的问题（门禁价值）
1. **CSRF 判断写反（严重，已修复）**：M6 新增管理路由误写 `if not _check_csrf(...)` —— **令牌正确反被拒、错误反放行**。M5 路由写法正确。已修复 3 处并新增回归测试（错误令牌必须 403）。
2. **卡密形态不一致（已修复）**：生成存带连字符形态、核销按去连字符查库 → 永远 404。现统一归一化到带连字符形态后再查库。

### 实测证据
| 项 | 结果 |
|---|---|
| pytest | **54/54**（+8：DoD 全链路/停用卡密/未登录/回调到账+重放幂等/坏签名 403/非 paid 忽略/手动补单+重复补单/M6 路由坏 CSRF 回归守卫） |
| npm test | **53/53** |
| 实机 DoD（curl，8002 实服） | 管理端生成 100 张（303）→ 核销 1 张（200，quota 3→4）→ 重复核销 409 → **账本合计 4 == 余额 4 对平** → CSV 导出 101 行 |

### §8 门禁
1. **事实**：无外部 API 依赖（无真实支付渠道，禁止编造——回调为标准 HMAC 占位，接渠道时替换验签部分）。
2. **代码**：核销/到账/补单全部原子 UPDATE 判 rowcount；幂等三处（核销一次性、回调 credited、补单 credited）；限速 redeem 10/min/用户。
3. **测试**：54/54 全绿。
4. **安全**：未授权（redeem 401）✅；越权（无管理员面）✅；重放（卡密一次性/回调幂等）✅；枚举（卡密空间 16^12 + 核销限速 + 错误不区分状态泄露有限）✅；注入（参数化）✅。
5. **风险**：BW16_PAYMENT_SECRET 缺省回退 SECRET_KEY（.env.example 已要求生产单独设置）；订单创建无登录限速（量小，M7 一并看）；卡密明文入库（丢失库=丢卡密——与 §6.1 同边界：内部系统可接受，M8 备份策略覆盖）。

## M7 加固与渗透自检（2026-09-17 完成并通过门禁）

### 交付内容
1. **修复历史已知项**：① 并发 begin 计数非原子 → 部分唯一索引 `uq_flash_pending_per_user`（DB 层强制 1 pending/用户）+ IntegrityError→429 兜底；② 登录时序侧信道 → 不存在账号执行等价 Argon2 验证（DUMMY hash）。
2. **会话签发限速**：POST /api/session 15 次/分/IP（防匿名会话表刷爆）。
3. **F12 前端产物加固**：`tools/build_web_dist.py` + `npm run build:dist`（terser 压缩+mangle，JS 88,932→46,683 字节，-48%；无 source map——构建内自检断言）；dist 产物经服务端加载（200）+ Node 断言（与源码行为一致）验证。**偏差声明**：协议常量/地址表不下发（公开事实值非机密，改动触碰不可回归清单），已写入自检报告 §3.4 供用户复核。
4. **渗透自检报告**：`docs/安全自检报告.md`——13 个对外接口 × 五类（未授权/越权/重放/枚举/注入）逐项结论 + §6.2 九条措施逐条证据 + 已修复漏洞清单（含 M6 CSRF 写反）+ 已知风险表。
5. 客户端敏感信息扫描：无 source map 引用、无客户端密钥（grep 证据入报告）。

### 实测证据
| 项 | 结果 |
|---|---|
| pytest | **54/54**（含 M7 新兜底：索引拒绝并发 pending → 429） |
| npm test | **53/53** |
| `npm run build:dist` | 10 个 JS 全部压缩成功，断言无 source map；dist 由实服加载 200；Node 跑 dist 版 backend 断言通过 |

### §8 门禁
1. **事实**：全部加固项对应任务书 §6.2 编号；偏差（协议常量）已声明。
2. **代码**：索引兜底不改变 API 语义（仍 429）；dummy hash 模块加载时生成一次；dist 构建不影响源码与单测（源码仍为可回归基线）。
3. **测试**：54 + 53 全绿。
4. **安全**：自检报告成文，五类 × 全接口有结论；无未记录的新风险。
5. **风险**：dist 尚未切换为线上发布形态（发布切换在 M8 部署编排中作为可选步骤，默认仍发布源码形态+Basic；切换前需用户确认）；M8 未完成前运维项（备份/监控/容器）保持待验证标注。

## M8 运维交付（2026-09-17 完成并通过门禁）—— M0-M8 全任务收官

### 交付内容
- **`deploy/` 新增**：`deploy.sh`（应用层一键部署：venv→.env 随机密钥→入库→systemd→自检）、`backup.sh`/`restore.sh`（SQLite 在线备份+固件存储+配置，保留 14 天；**已实测**：备份 372K+18MB，恢复到临时目录 count(firmware)=17）、`docker-compose.yml`+`nginx.conf`+`server/Dockerfile`（⚠️待验证：本机无 Docker，交付为模板，首次 VPS 使用后回填）。
- **`docs/部署手册.md`**：三种形态（本机隧道/VPS 裸机/compose）、VPS 从零部署（隧道层 bootstrap-vps.sh + 应用层 deploy.sh，含待回填验证表）、管理后台初始化、M1b 迁移操作卡片、回滚矩阵、**干净目录部署演练记录（G 节，本机实测）**。
- **`docs/运维手册.md`**：拓扑与进程、日常操作速查、监控告警最小集、备份恢复演练表（首行已填本机实测）、五类应急预案（固件泄露/被刷爆/被打/密钥泄露/库损坏）、容量费用（≈¥30-60/月）、**Basic→账号体系上线切换检查单**。
- **既有脚本保留并同步**：`bootstrap-vps.sh`/`sync-site.sh`/`publish-local.sh`/`run-site.sh`/`README-线上部署.md` 全部在位并在文首挂接新文档。

### 干净目录部署演练（本机等价"干净机器"，实测输出）
| 步骤 | 结果 |
|---|---|
| mktemp 隔离目录 + rsync 源码（无 venv/无数据） | ✅ |
| 新 venv + requirements.txt 安装 | ✅（无系统级依赖） |
| 全新数据目录 ingest | ✅ 17 固件 × 7 文件 |
| 随机密钥启动 8003 | ✅ health 200 |
| 验收四连 | ✅ 无会话 401 / 注册后目录 17 条 / 签名取件 200+831,488B / md5 `bfae06c1…` 与源一致 |
| backup.sh + 恢复演练 | ✅ 372K+18MB；恢复后 count=17 |

### M8 DoD 核对
「按手册在干净机器上从零部署成功一次」：本机已完成隔离目录演练（上表）。**严格意义的"干净机器"= VPS 首次部署**，与 M1b 同步执行（等用户购机），手册命令即演练命令，预期无额外步骤。

### §8 门禁（收官）
1. **事实**：手册中所有命令在本机可复跑；compose/Dockerfile/首次 VPS 结果三处显式标"待验证"。
2. **代码**：backup 用 SQLite `.backup` 在线 API（不锁业务）；restore 先停服+挪旧数据（不覆盖）；deploy.sh 幂等（venv/入库跳过已有）。
3. **测试**：pytest 54/54、npm 53/53（收官复跑全绿）。
4. **安全**：上线切换检查单覆盖 Basic→账号体系、演示账号清理、白名单复核。
5. **风险**：线上公网形态切换（移除 Basic、API 对公网开放）是**下一次需要用户在场的操作**，不在本次自动执行范围。

## 线上修复：版本刷新遮罩死循环（2026-09-17，用户实测报告）

### 现象
页面持续显示「站点已更新…立即刷新」，点击刷新后依旧。

### 三层根因
1. M4 测试曾把 `client_version_policy` 设为 99.0.0（测完已复位，但被困页面已亮遮罩）。
2. `renderAnnouncements` 遮罩**只亮不灭**：策略恢复正常后从不清除。
3. 被困标签页跑的是 M4 之前缓存的旧 `backend.js`（无 `version` 字段）→ `isVersionBelow(undefined,…)` 把 undefined 当 0 版本 → 即使策略 0.0.1 也判过低 → 刷新又拿到旧缓存 JS → 死循环。

### 修复
- `renderAnnouncements` 双向判定：策略正常/缺失时收起遮罩。
- 无版本号字段的客户端不做版本判定（`backend.version` 存在才比较）。
- 服务端清空 `client_version_policy` 行（`versionPolicy: null`），所有被困客户端刷新一次即永久解除；策略功能保留，今后仅用于真实发版。
- dist 产物重建（terser），npm 53/53 复跑通过。
