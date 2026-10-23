// 模拟 BW16 设备端状态机（ROM bootloader + flashloader），实现 Web Serial Port 接口。
// 行为模型全部对应 web/docs/PROTOCOL.md：NAK 持续流 [P2]、命令应答 [P3]、
// 包校验 [P9/P10]、序号连续 [P11]、RESET→flashloader [P12]、
// CMD_XMODEM 在 flashloader 下发前恰好一次（官方 upload_image.exe 反汇编序列）[P15/P17]。
// 本文件只用于 node:test，绝不进入浏览器产物。

const CMD_WRITE = 0x02;      // [P4]
const CMD_RESET = 0x04;
const CMD_BAUD = 0x05;       // [P19]
const CMD_XMODEM = 0x07;
const CMD_ERASE = 0x17;
const CMD_FLASH_MODE = 0x26;
const ACK = 0x06;            // [P2]
const NAK = 0x15;

export class MockBw16Device {
  constructor(options = {}) {
    this.options = options;
    this.mode = 'running';            // running → download-rom → download-flashloader → running-new
    this.flashMode = false;           // [P12]
    this.dataMode = false;            // [P15] XMODEM 握手后
    this.closed = false;
    this.expectedSeq = 1;             // [P11]
    this.nakIntervalMs = options.nakIntervalMs ?? 10;
    this.blockAutoEnter = options.blockAutoEnter ?? false;
    this.blockSchemeA = options.blockSchemeA ?? false;   // 只拦截时序 A 形态（RTS 下降沿时 DTR 已高）
    this.rejectPacketCount = options.rejectPacketCount ?? 0;
    this.disconnectAfterBytes = options.disconnectAfterBytes ?? Infinity;

    this.events = [];                 // {type, ...}
    this.openHistory = [];            // [P19] 每次 open 的 baudRate（含切速重开）
    this.targetBaud = null;           // [P19] 最近一次 [0x05,code] 的目标波特率码
    this.signalHistory = [];          // [{t, requestToSend, dataTerminalReady}]
    this.erases = [];                 // [{address, sectors}]
    this.sramBytes = [];              // SRAM 写入累积（flashloader）
    this.flashImages = new Map();     // 基地址 → number[]（flash 镜像累积）
    this.packetCount = 0;
    this.openOptions = null;
    this.receivedByteCount = 0;
    this._buf = [];
    this._signals = { requestToSend: false, dataTerminalReady: false };
    this._disconnectListeners = [];

    // host → device：TransformStream 供宿主写、设备读
    this._hostToDev = new TransformStream();
    // device → host：手动 ReadableStream，可主动 error 模拟拔线
    this._devToHost = new ReadableStream({
      start: (controller) => { this._devController = controller; },
    });

    this.port = {
      readable: this._devToHost,
      writable: this._hostToDev.writable,
      open: async (options) => {
        this.openOptions = options;
        this.openHistory.push(options?.baudRate);
        if (this.closed) {
          // [P19] 主机切速是 close → open 重开：真机上设备保持下载模式不变（真机实测），
          // 这里重建流并复位"连接级"状态（序号/接收态），模式与 flash 内容保留。
          this.closed = false;
          this.expectedSeq = 1;
          this.dataMode = false;
          this._buf = [];
          this._hostToDev = new TransformStream();
          this._devToHost = new ReadableStream({
            start: (controller) => { this._devController = controller; },
          });
          this.port.readable = this._devToHost;
          this.port.writable = this._hostToDev.writable;
          this._deviceReadLoop();
          if (this.mode === 'download-rom' || this.mode === 'download-flashloader') this._startNak();
        }
      },
      close: async () => {
        if (this.closed) return;
        this.closed = true;
        this._stopNak();
        try { this._devController.close(); } catch { /* 已关 */ }
        try { await this._devSideReader?.cancel(); } catch { /* 已关 */ }
      },
      setSignals: async (signals) => { this._handleSignals(signals); },
      getInfo: () => ({ usbVendorId: options.vid ?? 0x0bda, usbProductId: options.pid ?? 0x8720 }),
      addEventListener: (type, fn) => { if (type === 'disconnect') this._disconnectListeners.push(fn); },
      removeEventListener: (type, fn) => {
        const i = this._disconnectListeners.indexOf(fn);
        if (i !== -1) this._disconnectListeners.splice(i, 1);
      },
    };

    this._deviceReadLoop();
  }

  /* ---------- 设备内部 ---------- */

  async _deviceReadLoop() {
    const reader = this._hostToDev.readable.getReader();
    this._devSideReader = reader;
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const b of value) {
          this.receivedByteCount += 1;
          if (this.receivedByteCount >= this.disconnectAfterBytes) {
            this.simulateDisconnect();
            return;
          }
        }
        this._buf.push(...value);
        this._parseBuffer();
      }
    } catch { /* 端口关闭 */ }
  }

  _parseBuffer() {
    for (;;) {
      if (this._buf.length < 1) return;
      const cmd = this._buf[0];
      const need = cmd === CMD_WRITE ? 1032
        : cmd === CMD_ERASE ? 6
          : cmd === CMD_FLASH_MODE ? 4
            : cmd === CMD_BAUD ? 2 : 1;
      if (this._buf.length < need) return;
      const chunk = this._buf.splice(0, need);
      this._handle(chunk);
    }
  }

  _handle(chunk) {
    const cmd = chunk[0];
    if (cmd === CMD_WRITE) return this._handleWritePacket(chunk);
    if (cmd === CMD_RESET) return this._handleReset();
    if (cmd === CMD_BAUD) return this._handleBaudSwitch(chunk[1]);
    if (cmd === CMD_XMODEM) return this._handleXmodem();
    if (cmd === CMD_ERASE) {
      // [P14 修正注] 线上 6 字节：byte1-3 = 地址低 24 位 LE（高字节恒 0x08 被覆盖），
      // byte4-5 = 扇区数 u16 LE。
      const addr24 = (chunk[1] | (chunk[2] << 8) | (chunk[3] << 16)) >>> 0;
      const sectors = chunk[4] | (chunk[5] << 8);
      this.erases.push({ address: (0x08000000 + addr24) >>> 0, sectors });
      this.events.push({ type: 'erase', ...this.erases[this.erases.length - 1] });
      return this._send(ACK);
    }
    if (cmd === CMD_FLASH_MODE) {
      const ok = this.mode === 'download-flashloader' && chunk[1] === 0x01 && chunk[2] === 0x01 && chunk[3] === 0x00;
      this.events.push({ type: 'flash-mode', accepted: ok });
      if (!ok) return this._send(NAK);
      this.flashMode = true;
      return this._send(ACK);
    }
    this.events.push({ type: 'unknown-cmd', cmd });
    this._send(NAK);
  }

  _handleWritePacket(packet) {
    this.packetCount += 1;
    if (!this.dataMode) {
      // [P15 官方序列] ROM 收到 0x07 前不处于接收态：数据包被 NAK 拒绝。
      this.events.push({ type: 'packet-before-xmodem', index: this.packetCount });
      return this._send(NAK);
    }
    if (this.rejectPacketCount > 0) {
      this.rejectPacketCount -= 1;
      this.events.push({ type: 'packet-rejected', index: this.packetCount });
      return this._send(NAK);
    }
    const seq = packet[1];
    const inv = packet[2];
    const view = new DataView(Uint8Array.from(packet.slice(0, 7)).buffer);
    const address = view.getUint32(3, true);
    // [P10] 初值 0xFF 的 8-bit 累加和
    let sum = 0xff;
    for (let i = 0; i < 1031; i += 1) sum = (sum + packet[i]) & 0xff;
    if (sum !== packet[1031]) {
      this.events.push({ type: 'checksum-error', index: this.packetCount, expected: sum, got: packet[1031] });
      return this._send(NAK);
    }
    if (seq !== (this.expectedSeq & 0xff) || inv !== ((~this.expectedSeq) & 0xff)) {
      this.events.push({ type: 'seq-error', index: this.packetCount, expected: this.expectedSeq, got: seq });
      return this._send(NAK);
    }
    this.expectedSeq += 1;   // [P11] 全会话连续
    const data = packet.slice(7, 7 + 1024);
    if (address < 0x100000) {
      this.sramBytes.push(...data);
    } else {
      // 按已知镜像基址（P8/P13）归并连续写入；块间空缺补 0xFF（P9）
      const KNOWN_BASES = [0x082000, 0x08000000, 0x08004000, 0x08006000];
      const base = Math.max(...KNOWN_BASES.filter((b) => address >= b && address < b + 4 * 1024 * 1024));
      if (!this.flashImages.has(base)) this.flashImages.set(base, []);
      const entry = this.flashImages.get(base);
      const offset = address - base;
      while (entry.length < offset) entry.push(0xff);
      entry.push(...data);
    }
    this.events.push({ type: 'packet', seq, address, index: this.packetCount });
    this._send(ACK);
  }

  _handleReset() {
    this.events.push({ type: 'reset', from: this.mode });
    if (this.mode === 'download-rom' && this.sramBytes.length > 0) {
      this._setMode('download-flashloader');   // [P12] 复位进 flashloader
      // [P15 修正] flashloader 是另一个程序：它自己还要收一次 0x07 才进入接收态
      this.dataMode = false;
    } else if (this.dataMode) {
      this._setMode('running-new');            // [P16] 最终复位
    }
    this._send(ACK);
  }

  /** [P19] 切波特率：只有**还没进入接收态**（未收 0x07）时才接受 —— 与真机一致。
   * 真机实测：先 0x07 再 [0x05] → 无 ACK，之后两档都联系不上，只能重新进模式。 */
  _handleBaudSwitch(code) {
    const ok = !this.dataMode;
    this.events.push({ type: 'baud', code, accepted: ok });
    if (!ok) return this._send(NAK);
    this.targetBaud = code;
    return this._send(ACK);
  }

  _handleXmodem() {
    // [P15 修正 2026-09-16] ROM 与 flashloader 各自需要一次"0x07 → ACK"进入接收态：
    // 官方 set_max_speed() 尾部无条件发 0x07，flashloader 前与镜像前各调用一次。
    // 旧模型只允许 ROM 阶段一次，掩盖了"镜像阶段漏发 0x07"这个真机故障。
    const ok = this.mode === 'download-rom' || this.mode === 'download-flashloader';
    this.events.push({ type: 'xmodem', accepted: ok, mode: this.mode });
    if (!ok) return this._send(NAK);
    this.dataMode = true;
    this._send(ACK);
  }

  _handleSignals(signals) {
    const prev = { ...this._signals };
    this._signals = { ...this._signals, ...signals };
    this.signalHistory.push({ t: Date.now(), ...this._signals });
    const rtsFell = prev.requestToSend === true && this._signals.requestToSend === false;
    if (!rtsFell || this.blockAutoEnter) return;
    if (this._signals.dataTerminalReady) {
      // [P5] 方案 A 形态：RTS 下降沿时 DTR 已为高
      if (this.blockSchemeA) {
        this.events.push({ type: 'scheme-a-blocked' });
        return;
      }
      this._enterDownload();
    } else {
      // [P6] 方案 B 形态：下降沿后 DTR 须在 10ms 窗口内拉低
      setTimeout(() => {
        if (this._signals.dataTerminalReady) this._enterDownload();
        else this.events.push({ type: 'auto-enter-missed-window' });
      }, 10);
    }
  }

  _enterDownload() {
    if (this.mode !== 'running') return;
    this._setMode('download-rom');
  }

  _setMode(mode) {
    this.mode = mode;
    this.events.push({ type: 'mode', mode });
    if (mode === 'download-rom' || mode === 'download-flashloader') {
      // [P11 修正] ROM 与 flashloader 是两个独立程序，各自从 seq=1 开始收包
      this.expectedSeq = 1;
      this._startNak();
    } else this._stopNak();
  }

  _startNak() {
    if (this._nakTimer) return;
    this._nakTimer = setInterval(() => this._send(NAK), this.nakIntervalMs);   // [P2] 持续 NAK 流
  }

  _stopNak() {
    if (this._nakTimer) { clearInterval(this._nakTimer); this._nakTimer = null; }
  }

  _send(byte) {
    if (this.closed) return;
    try { this._devController.enqueue(new Uint8Array([byte])); } catch { /* 已关闭 */ }
  }

  /* ---------- 测试辅助 ---------- */

  /** 模拟用户手动 BURN+RST 成功（[P7]） */
  manualResetToDownload() {
    this.events.push({ type: 'manual-reset' });
    this._setMode('download-rom');
  }

  /** 模拟设备中途拔线 */
  simulateDisconnect() {
    if (this.closed) return;
    this.closed = true;
    this._stopNak();
    try { this._devController.error(new Error('Device disconnected')); } catch { /* 已关 */ }
    try { this._devSideReader?.cancel(); } catch { /* 已关 */ }
    for (const fn of this._disconnectListeners.splice(0)) fn({});
  }

  /** 等待设备进入指定状态（轮询 events） */
  async waitFor(predicate, timeoutMs = 2000, intervalMs = 5) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate(this)) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  imageBytes(address) {
    return this.flashImages.get(address) ?? [];
  }
}
