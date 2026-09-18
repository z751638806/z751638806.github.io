# BW16 (RTL8720DN / Ameba D) 串口下载协议 · 证据对照表

版本：M0（2026-09-15）
用途：网页刷写工具全部协议常量/地址/时序的唯一事实来源。代码中出现的一切协议数值必须能对应到本文编号（P1–P18），本文每条必须附证据（文件 + 行号）。

## 0. 证据源清单与可用性声明

| 级别 | 来源 | 说明 |
|---|---|---|
| E1 | 本地实测脚本：`flash_tool.py`（根目录，v3.2）与 `bw16/*/刷入.command`（15 份同构脚本，本文以 `bw16/刷入戒网瘾DEV2小范围版260525/刷入.command` 为引用底本） | 本机实测验证过的进下载模式时序与官方工具调用参数，含 2026-07-05 实测注记 |
| E2 | 参考实现 `/tmp/bw16-flasher.js`（TikolonDev/tkl-novax-installer 的 bw16-flasher.js，186 行） | 上游仓库**无 LICENSE**（2026-09-15 经 WebFetch 复核确认），仅作协议行为参考，本项目实现为重写，不复制其代码文本。证据版本以 SHA-256 固定：`071f2b732379e03be6ba7e88e5c6a9adab8faf50b36dba286967bab17d8d4fdb`（原文存于 /tmp，易失；行为要点已在本文件转述，复核可从上游仓库获取后比对哈希） |
| E3 | 官方工具二进制旁证：`/Users/mac/Downloads/BW16-ESP32-tool/bw16/_tools/Erase/upload_image_tool_windows.exe`（官方 Realtek ameba_d_tools 1.1.x Windows 包，MinGW C++ 编译，无源码）的 strings 输出 | 佐证 checksum/sequence 校验分支与 SLIP 层的存在 |
| E4 | `intercept_noreset.c`（仓库根，DYLD 插桩库源码） | 旁证官方工具以 read 首字节 0x15 判定"已进下载模式" |
| E5 | 官方 flashloader 资产：`/Users/mac/Downloads/BW16-ESP32-tool/bw16/_tools/Erase/tools/windows/image_tool/imgtool_flashloader_amebad.bin`（4688 字节，2023-05-10） | 与本仓库 17 份固件目录内同名文件大小全部一致（构建脚本另做 md5 一致性校验） |
| E6 | `docs/history/Arduino IDE 烧录日志.txt:146-151` | 官方 mac 工具 1.1.3 的真实调用行与输出（"Uploading……"、"All images are sent successfully!"） |

**诚实声明（与原任务书的差异）**：任务书预期的第一证据源 `~/Library/Arduino15/packages/realtek/tools/ameba_d_tools/*/upload_image_tool_macos`（官方 Python 源码）**在本机不存在**（Arduino15 目录整体缺失；归档仓库内 `bw16/_tools/` 也不存在）。E2 逐行核对结论：任务书 1.2 的 10 项协议预期中 9 项在 E2 中逐条成立（见下）；E1 提供了另一套本机实测有效的进下载模式时序。本表以"E1（本地实测）与 E2（参考实现）交叉 + E3/E4 旁证"构成证据链，缺失官方 Python 源码一项如实标注。

---

## P1 串口参数

**115200 波特，8 数据位，1 停止位，无校验，无流控。**
- E2 `bw16-flasher.js:22`：`port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' })`
- E1 `flash_tool.py:1624`、`刷入.command:48`：`serial.Serial(port, 115200, timeout=0.1)`
- 备注：官方 exe 内部初始 9600、非法值回落 115200（E3 strings：`unsupported baud rate: %d, using 115200`）；官方工具对板子实际烧录时被以 1500000 调用（E6），但那是其内部二阶段行为，网页版全程 115200（E1/E2 一致）。

## P2 ACK / NAK

**ACK = 0x06，NAK = 0x15。NAK 是 ROM bootloader / flashloader 的"就绪"信号：握手靠等 NAK，不是先发探测命令。**
- E2 `bw16-flasher.js:1-2`：`const ACK = 0x06; const NAK = 0x15;`
- E1 `刷入.command:12`（头部注释，实测）："Boot ROM 检测 BOOT=Low, 进入下载模式, 持续发 NAK (0x15)"；`刷入.command:62-65`：读 256 字节判 `b"\x15" in data`
- E4 `intercept_noreset.c:80-95`：插桩库拦截官方工具的 `read()`，首字节 `0x15` 即判定"[NAK! DOWNLOAD MODE!]"并锁定下载模式 —— 官方工具同样以 0x15 为就绪判据。

## P3 字节等待与命令封装语义

- 等待函数：单字节匹配，默认超时 5000ms（E2 `bw16-flasher.js:51-63`）；`waitForNak`/`waitForAck` 各等一次 NAK/ACK，超时 5000ms（E2:65-66）。
- 命令封装：除 CMD_XMODEM 外，每条命令 = **先等 1 次 NAK → 写命令字节 → 等 1 次 ACK**（E2:78-82）。CMD_XMODEM 的握手特殊，见 P15。
- 就绪流：ROM 下载模式下设备**持续**发 NAK，因此"等 NAK"只是从字节流中取走一个 0x15，不必担心错过（E1 `刷入.command:12`）。

## P4 命令字

| 命令 | 值 | 用途 | 证据 |
|---|---|---|---|
| CMD_WRITE | 0x02 | SRAM/flash 写包包头 | E2:3（定义）、94（使用） |
| CMD_RESET | 0x04 | 复位设备（进 flashloader / 运行固件） | E2:4、146、177 |
| CMD_XMODEM | 0x07 | 进入 XMODEM 批量传输模式 | E2:5、165 |
| CMD_ERASE | 0x17 | 按扇区擦除 flash | E2:6、159 |
| CMD_FLASH_MODE | 0x26 | 进入 NOR flash 写模式 | E2:7、149 |

（本地 E1 脚本不裸发这些命令——它调用官方 exe；命令字证据链仅 E2，与 E3 strings 的错误分支 `unslip sequence wrong`、`Err:checksum error` 行为相容。）

## P5 进下载模式 · 时序 A（网页版首选，源自参考实现）

```
setSignals({ requestToSend: true,  dataTerminalReady: false })   // RTS=High
delay 500ms
setSignals({ requestToSend: false, dataTerminalReady: true  })   // RTS=Low + DTR=High
delay 200ms
setSignals({ requestToSend: false, dataTerminalReady: false })   // 全部 Low
delay 500ms
```
- E2 `bw16-flasher.js:69-76`（逐行核对成立）。
- 之后等 NAK ×2 确认 ROM bootloader 就绪（E2:133-134）。
- 局限：依赖板载 USB 转串口芯片的 DTR/RTS 接线，不保证 100% 成功 → 超时走 P6 / P7。

## P6 进下载模式 · 时序 B（本机 CH340 实测，时序 A 失败后自动重试）

```
DTR=False; sleep 50ms
RTS=True ; sleep 100ms        # RST=Low
RTS=False                     # RST=High，释放复位
sleep 1ms                     # 必须 <10ms 内：
DTR=True                      # BOOT=Low
sleep 300ms
读 256 字节，含 0x15 即成功
```
- E1 `flash_tool.py:1606-1648`（`_enter_download_mode`，注释含实测日期 2026-07-05 与"延时窗口: 0-10ms 成功, 20ms+ 失败"，L1617）；`刷入.command:52-65` 同一逻辑。
- CH340 特性注记：DTR 与 RTS 同时设置会阻止 RTS 复位，必须分两步（E1 `flash_tool.py:1615-1616`；旁证 E4 `intercept_noreset.c:148`）。
- 采用理由：任务书 1.2 只给时序 A；F4 允许"自动时序失败 → 重试"。两套时序都有本地证据（E2/E1），按"先 A 后 B 再手动"排序可显著提高自动成功率，不发明任何新时序。差异记录于 REVIEW_LOG M0。

## P7 手动进下载模式（自动时序均失败后的图文引导）

**按住 BURN 键 → 短按 RST 键 → 松开 BURN 键**，设备复位且 BOOT=Low，ROM 进入下载模式并持续发 NAK。
- 证据：E1 `刷入.command:265`（失败提示原文"如自动进下载模式失败, 可手动按 BOOT+RST 后重试"；BW16-Kit 的 BOOT 键即 BURN 键）；原理同 P2/P6（BOOT=Low 复位 → 下载模式）。
- 网页版行为：引导用户操作后点"重试"，等待 NAK ×2；重试上限 3 次（F4）。

## P8 flashloader 与 SRAM 写入地址

**imgtool_flashloader_amebad.bin（4688 字节）写入 SRAM 地址 0x082000。**
- E2 `bw16-flasher.js:8`：`const FLASHLOADER_ADDRESS = 0x082000;`（使用于 :145）
- E5：flashloader 文件本体（官方包与本仓库 17 份副本尺寸一致；构建脚本做 md5 校验后归档到 `web/firmware/_common/`）。

## P9 写包格式（1032 字节）

```
偏移 0     : 0x02 (CMD_WRITE)
偏移 1     : seq & 0xFF
偏移 2     : (~seq) & 0xFF
偏移 3..6  : 目标地址 + block*1024，u32 小端
偏移 7..1030: 1024 字节数据（源数据不足一块时先整块填 0xFF 再覆盖）
偏移 1031  : 校验和（见 P10）
```
- E2 `bw16-flasher.js:92-104`；0xFF 填充：:85-87（`new Uint8Array(blocks*1024).fill(0xff)` 后 `image.set(source)`）。

## P10 校验和（坑 A）

**8-bit 累加和，初值 0xFF（不是 0x00），对 packet[0..1030] 共 1031 字节累加，取低 8 位。初值为 0 会被 flashloader NAK 拒包。**
- E2 `bw16-flasher.js:99-103`：
  `let checksum = 0xff; for (let index = 0; index < 1031; index += 1) checksum = (checksum + packet[index]) & 0xff;`
  （:99-100 注释原文说明初值 0 会被拒。）
- 旁证：E3 strings `Err:checksum error`、`checksum each=%x`（官方工具存在逐包校验分支）。

## P11 序号 seq（坑 B）

**seq 由调用方维护，在"每个程序阶段"内部从 1 开始连续递增；进入镜像阶段前必须复位为 1。**

> **修正（2026-09-16，真机证伪旧结论）**：旧版写的是"全会话连续、跨阶段不复位"，依据是 E2 参考实现（`bw16-flasher.js:143` 只创建一次 sequence 对象）。
> 官方实现不是这样：`program_spi_flash()` 在 flashloader 前有 `uint8_t id=1;`，在写完 erase、准备写三段镜像前**又有一句 `id=1;`**
> （C 源码 `tools/amebad_tool_src/upload_image_tool.cpp:835` 与 `:879`）。即 ROM 阶段（flashloader）与 flashloader 阶段（三镜像）**各自从 1 开始计数**。
> 真机判定（本机 CH340）：补发了镜像阶段的 [0x07] 后，首包 seq=1 → **0.1s 内 ACK**；seq=6（沿用 flashloader 阶段的计数）→ **永远无 ACK**。
> 旧实现正是因此卡死在"写入 km0_boot_all 首包 → 等 ACK 超时"。

- E2 `bw16-flasher.js:143`：`const sequence = { value: 1 }`（整个 flashBw16 只创建一次）；:106 每包 `+= 1`；flashloader 写入（:145）与三段镜像写入（:172）共用同一对象 —— **此参考实现的行为与官方不符，不再作为依据**。
- 旁证：E3 strings `unslip sequence wrong`（官方工具校验序号连续性）。

## P12 flashloader 就绪后进入 flash 写模式

**CMD_RESET [0x04]（封装内：等 NAK → 写 → 等 ACK）→ 额外等 NAK ×2 → CMD_FLASH_MODE [0x26, 0x01, 0x01, 0x00]（封装内再等 NAK + 等 ACK）。**
- E2 `bw16-flasher.js:146-149`（逐行核对：RESET 后 `waitForNak()` 两次，然后 4 字节 FLASH_MODE 命令）。

## P13 三段镜像地址表

| 镜像文件 | 地址 |
|---|---|
| km0_boot_all.bin | 0x08000000 |
| km4_boot_all.bin | 0x08004000 |
| km0_km4_image2.bin | 0x08006000 |

- E2 `bw16-flasher.js:151-155`。
- 本仓库固件资产同构性：17 个固件目录均为 `flash/a/` 四件套（文件名逐一对应；部分固件多出的 km0/km4_image2_all.bin 不在本表 → **不参与网页刷写流程**）。

## P14 擦除（默认策略：逐镜像按扇区）

**每镜像一条 6 字节命令，扇区 4KB，sectors = ceil(镜像长度/4096)。**
- E2 `bw16-flasher.js:156-163`（循环三镜像各发一条；`Math.ceil(data.length/4096)`、`setUint32(1, addr, true)`、`setUint16(4, sectors, true)`）。
- **线上字节修正注（M2 发现）**：E2 在 6 字节缓冲上先写 addr u32 LE（byte1–4）再写扇区数 u16 LE（byte4–5），**byte4（地址最高字节，对 0x08000000+ 恒为 0x08）被扇区数低字节覆盖**。因此实际线上格式为 `[0x17, addr 低 3 字节 LE, sectors u16 LE]`，而非任务书 1.2 所记"addr32+u16"的 7 字节读法。E2 经实机验证有效，实现按 E2 的线上字节原样复现；**待 M6 实机复核**。
- 全片擦除：**本地无任何证据**（E2 无此命令；官方 exe 内部不可见）→ 不发明。网页版"高级选项"实现为**扩展擦除**：用 P14 命令覆盖 0x08000000 起至 km0_km4_image2 末尾（按 4KB 向上取整）的连续区，标注"待实机验证"。

## P15 XMODEM 握手与三镜像连续写（2026-09-16 按官方二进制反汇编全面修正）

**CMD_XMODEM [0x07] 在两个阶段各出现一次**：flashloader 下发前一次，三段镜像写入前**再一次**（后者 2026-09-16 修正）。

- 阶段 1（RAM）：2 NAK 同步 → 写 [0x07]（该命令跳过前导 NAK 等待）→ 等 ACK → 等 1 NAK（set_max_speed 尾部）→ 等 1 NAK（write_block 头部）→ flashloader 裸包流。
- 阶段 2（flash）：erase ×3 → 等 1 NAK → **再写 [0x07] → 等 ACK → 等 1 NAK**（同样是 set_max_speed 尾部）→ 逐镜像 writeBlock（每块等 1 NAK + 等 ACK）。

修正证据（2026-09-16，真机逐字节实测 + 官方调用序）：
- 官方 `set_max_speed()`（0x41d980）**无论是否切波特率，结尾固定 `send_cmd([0x07],1)` → wait_sync_char(1)**（本文件 P15 证据段已记录）。
- `program_spi_flash()` 在擦除后、写三段镜像前**又调用了一次 set_max_speed** → 因此镜像阶段也会发出一次 [0x07]。
  对应的 C 源码：`upload_image_tool.cpp` `program_spi_flash()` 里 erase 之后那句 `printf("set baudrate to %d.\n"); set_max_speed(fd,s);`（原版 x86 工具运行时也会再打印一遍 set baudrate，可复现）。
- 真机判定（本机 CH340，Python 逐字节复现官方序列）：
  | 是否补发 0x07 | 首个 km0 包（seq=1） | 首个 km0 包（seq=6） |
  |---|---|---|
  | 不补 | ❌ 4s 无 ACK | ❌ 无 ACK |
  | 补发（0x07 立即 ACK → NAK） | ✅ 0.1s 内 ACK | ❌ 无 ACK |
- 结论：镜像阶段**既要补发 [0x07]，也要把序号复位为 1**（见 P11 修正）。缺任何一条，真机首包都拿不到 ACK —— 与网页版 2026-09-16 15:30 的故障日志完全一致。

证据升级（E4：官方 Windows 写入工具 `upload_image.exe` 反汇编，未 strip 符号表， MinGW x86-64；副本 `bw16/一键刷入捕获握手包厂商检测260517/flash/upload_image.exe`，SHA256 见 REVIEW_LOG 2026-09-16 条目；E2 参考实现将 0x07 放在镜像阶段前，**位置错误**，真机 2026-09-15/16 联调已证伪）：
- `wait_sync_char(h,n)`（0x41dab0）：**等待收到 n 个 NAK**；期间收到任何非 NAK 字节即失败。ROM 下载模式的持续 NAK 流即同步信号。
- `send_cmd(h,buf,len)`（0x401b4f）：`buf[0]!=0x07` 时先 wait_sync_char(1)，再写命令，随后 wait_response_char 等待 0x06（期间 NAK 容忍继续等，其他字节判失败）。
- `set_max_speed(h,baud)`（0x41d980）：查波特率表（VA 0x4a4040，13 项 {baud, code}：115200=0x0C、1500000=0x18…）；若 baud≠115200 先 `send_cmd([0x05,code],2)` 再本地重配串口；**无论是否切波特率，结尾固定 `send_cmd([0x07],1)` → wait_sync_char(1)**。
- `write_block(...)`（0x4020a5）：发包前 wait_sync_char(1)；裸 1032 字节包 `[0x02,seq,~seq,addr u32 LE(base+i×1024),1024B data,checksum(前1031B,0xFF初值)]`（uint8_checksum 0x401d57 实证 P10）；每包 write_rs232 后 wait_response_char 等 0x06；seq 由调用方维护、阶段内连续递增 —— 官方在进入镜像阶段前把 id 复位为 1（P11 修正）。
- `program_spi_flash(h,mode)`（0x4023e5）完整序列：flush → wait_sync_char(2) → set_max_speed（含 [0x07]+1 NAK）→ write_block(flashloader@0x82000) → send_cmd([0x04],1) → 本地重配 115200 → wait_sync_char(2) → send_cmd([0x26,01,01,00],4) → erase_block×3（0x08000000/0x08004000/0x08006000）→ wait_sync_char(1)（0x4026a8）→ write_block×3（km0/km4/app）→ "verifying km0 km4 and app blocks" → 逐镜像 verify_cmd。
- `erase_block(h,addr,len)`（0x402348）：`cmd=[0x17]`，u32@+1=addr、u32@+4=ceil(len/4096) —— **字节 4 重叠覆盖实证**（P14 修正注升级为官方级证据）。
- `verify_cmd`/[0x27] 校验命令（0x4021c1b 调用处 0x4028d8）：`[0x27,(addr&0xF7FFFFFF) u32 LE,len u32 LE]` 共 9 字节，收集 5 字节应答与 flash_map 内 CRC 比对。**网页版暂未实现该校验步骤**（CRC 算法未逆向确认），不影响刷写成功，列为后续可选项。
- `flash_image(dir)`（0x4029be）：`load_file(&flashloader,"imgtool_flashloader_amebad.bin",0x82000,…)` —— **0x08200 实证**（P8）。
- P16 补充：结束 `[0x04]` 同样经 send_cmd（含前导 NAK 等待），随后 change_rs232_speed(115200)+wait_sync_char——设备在写入完成后仍维持 NAK 流（与 P16 修正注的宽容实现兼容）。

## P16 结束复位

**CMD_RESET [0x04]（封装内等 NAK+ACK）→ 追加 RTS 脉冲：setSignals({RTS:true, DTR:false}) → delay 500ms → setSignals({RTS:false, DTR:false})，确保干净复位运行新固件。**
- E2 `bw16-flasher.js:177-180`。
- 对应任务书 1.2 第 7 步"可选再做一次 RTS 脉冲"。
- **修正注（2026-09-16，真机复现）收尾复位失败的两个原因**：
  1. 进模式时 DTR 被拉低（BOOT 低）后一直没抬起来 → 收尾那句 `[0x04]` 会让 ROM **又落回下载模式**
     （真机：flash 模式下直接发 0x04 → 串口继续吐 0x15，固件不跑）。**必须先把 BOOT 抬起来再发 0x04。**
  2. 收尾硬件复位若一次 `setSignals` 同时翻 DTR+RTS（Web Serial 就是一次请求设两根线），本机 CH340 上不可靠；
     官方 `generate_reset_to_boot` 是逐根改的。改为「BOOT 高 → RST 低 150ms → 释放」，逐根改线并留 settle 时间。
  真机验证：从"刷写刚结束（flashloader 在 flash 模式，BOOT 低）"出发，按新序列 → 固件正常启动
  （`#calibration_ok` → `=== 握手包捕获系统启动 ===` → WIFI → AP）；旧序列则停在下载模式。
  收尾还会**验证**（仍吐 NAK 就再复位，最多 3 次）并把设备启动输出打进日志。
- **修正注（M2）**：传输结束后 flashloader 是否恢复就绪 NAK 流，本地无直接证据（P15 注明"整个传输只发一个 NAK"是 driver 侧视角）。实现采用稳健路径：复位前等 NAK 给 2s 宽限，超时则视为设备已静默、直接发 RESET（此时固件已全部写入，不影响结果）——两种设备行为均兼容，**待实机验证**。

## P17 已知差异：官方工具的 SLIP 层（2026-09-16 裁决：SLIP 属擦除工具，数据面为裸包）

E3 strings 显示官方 C++ 工具（upload_image_tool_windows/macos）使用 SLIP 帧（`failed sending 0xC0`、`failed substituting 0xC0/0xDB`、`unslip sequence wrong`、`serialport_receive_C0: %02X instead of C0`）。E2 参考实现为**裸 1032 字节包、无 SLIP**。

**裁决（2026-09-16，E4 反汇编）**：Windows 一键刷入包实际使用**两个**官方工具——
1. `upload_image_tool_windows.exe`（macOS 同名工具）：仅负责**擦除**步骤，以 1500000 波特运行，内部含 SLIP 层（E3 字符串）与 "Enter Uart Download Mode" 流程串。用户机器上 Arduino15 的 1.1.3 副本已于 2026-09-16 00:25 前后被移除，无法反汇编复核；因擦除功能已由 flashloader 的 [0x17] 路径覆盖，本工具不再追查。
2. `upload_image.exe`（写入工具，E4）：**全程 115200、裸 1032 字节包、无 SLIP**（write_rs232 = 直接 WriteFile，0x401878）。真正在这批 BW16-Kit 上反复刷写成功的是它（一键刷入包实测 63-68s）。

**结论**：数据面采用裸包（E4 为准），SLIP 实验开关 `?slip=1` 保留作回归、默认不用。此前真机首包 ACK 超时的根因不是帧格式，而是**序列缺 [0x07]**（见 P15 修正）。1500000 波特属擦除工具路径，网页版不采用（flashloader [0x17] 擦除已够用；若未来对齐官方擦除工具再加 [0x05,code] 切波特率，证据同 P15 波特率表）。

## P18 USB VID 防呆表（M5 用）

| 设备 | VID | 级别 | 证据 |
|---|---|---|---|
| BW16 (Realtek) | 0x0BDA | 强匹配 | `flash_tool/com_ports.py:12-15`（KNOWN 表） |
| ESP32-C3 (乐鑫自属) | 0x303A | 强匹配 | 同上 |
| CP210x | 0x10C4 | 警告级 | 同上原归 ESP 侧；**P18 修正注（2026-09-15 实机反馈）**：CP210x 与 CH340 同为通用 USB-UART 桥接芯片，BW16-Kit 亦可能采用，不得作跨类强判据 |
| CH340 | 0x1A86 | 警告级 | `刷入.command:25,136,141`（wchusbserial / CH340 驱动注记） |

**弹窗策略修正注（2026-09-15）**：`requestPort` 不按 VID 过滤列表（首装机联调中 VID 过滤导致弹窗找不到端口、用户无法选择）；选择完成后由本表判级兜底——跨类强判拦截、通用桥接警告确认。

---

## W 网页侧技术事实（非串口协议，实施依赖）

- W1 Web Serial API：桌面 Chrome/Edge 89+、Opera 76+、Firefox 151+、Android Chrome 148β+；Safari 不支持；页面须 HTTPS 或 localhost；`navigator.serial.requestPort()` 须用户手势触发。（任务书 1.4，Realtek 官方工具页声明；2026-09-15 未重新独立核实浏览器版本号。）
  - **补充（2026-09-17 线上实测，必守）**：手势是**瞬时激活**（约 5s），且 `requestPort()` 必须在该窗口内**同步**调用。原实现先 `await` 下载固件（公网 5.2s）再调 `requestPort()` → 被拒 `Must be handling a user gesture to show a permission request`（弹不出串口选择器）。正确写法：点击后立刻 `beginPortRequest()`（`serial.js`，内部同步调用并挂 catch），把耗时下载与"用户选端口"并行，最后再 `await`。回归守卫 `web/test/gesture-order.test.js`（源码顺序断言）。
- W2 ESP Web Tools v10：CDN `https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module`（2026-09-15 WebFetch 实测可用），注册 `<esp-web-install-button>` 自定义元素，Apache-2.0 许可。
- W4 主机侧设备识别能力（2026-09-17 核实，用于 F21 板卡认证）：Web Serial `SerialPort.getInfo()` 仅返回 `usbVendorId`/`usbProductId`，**无 USB 序列号**（MDN）；CH340 亦不上报序列号 ⇒ **刷写前无法识别具体板卡**。已验命令集（`0x02/0x04/0x05/0x07/0x17/0x26/0x27`）**无读 flash / 读芯片 ID 命令**，`0x27` 只回校验结果 ⇒ 也不能"刷前读标记"识别。板卡唯一身份只能来自**固件运行后上报**（RTL8720DN Wi‑Fi MAC / efuse）。例外：ESP32-C3 的 esptool 协议可读 MAC（需自写命令，esp-web-tools 不暴露）⇒ ESP32 侧可做刷前识别。
- W3 flash_stats.json 兼容字段（F8）：`{total, success, fail, history:[{time, device, firmware, port, success, duration}]}`（本仓库 `flash_stats.json` 实测结构）。

## P19 高速档：两次 [0x05] 切波特率（2026-09-16 真机实测）

**`set_max_speed()` 里"不切波特率"的那一半只管主机；真正让设备换档的是 `[0x05, code]`。**
`program_spi_flash` 会调用它**两次**：① 下发 flashloader 之前（ROM 阶段）② 擦除之后、写三镜像之前（flashloader 阶段）。

线上时序（真机逐字节确认）：
1. `wait_sync_char(1)`（等 1 NAK）→ 写 `[0x05, code]` → **设备回 ACK**（官方代码不检查这个 ACK）
2. 主机侧切到目标波特率 —— Web Serial 不能在打开状态下改速率，必须 close → open（`SerialSession.reopenAt`）；真机实测重开不会让设备退出下载模式
3. `0x07` → ACK → 1 NAK —— 这同时就是"设备确实在新波特率上活着"的证明

⚠ **顺序硬约束：先切速、后 0x07。** 真机实测：先发 0x07 让 ROM 进入接收态之后再发 `[0x05]` 不再有 ACK，之后两档都联系不上（只能重新进模式）。
⚠ **复位进 flashloader 后设备回到默认 115200**，必须把主机降回来（官方 `change_rs232_speed(115200)`，原版工具输出里的 `re-init and set baudrate to 115200`），否则读不到 flashloader 的 NAK。

波特率码表（`rs232_port[]`，2026-09-16 从 C 源码抄录）：

| baud | code | baud | code |
|---|---|---|---|
| 1500000 | 0x18 | 460800 | 0x12 |
| 1444400 | 0x17 | 380400 | 0x11 |
| 1382400 | 0x16 | 230400 | 0x10 |
| 1000000 | 0x15 | 153600 | 0x0F |
| **921600** | **0x14** | 115200 | 0x0C |

实测收益（本机 CH340，934,652 B 固件，Python 逐字节复现官方序列）：

| 模式 | 三镜像写入 | 全程 |
|---|---|---|
| 115200 | ~105s（网页版历史日志 111s / 147s） | ~115s |
| **921600** | **32.4s（28.2 KB/s）** | **40.5s** |

上限说明：本机 CH340 上 `1000000`(0x15) / `1500000`(0x18) 会**静默挂死**，921600 是上限；且有效速率受"每 1KB 一个 ACK"的往返延迟限制（28 KB/s 远低于 921600 的 92 KB/s 线速）。
