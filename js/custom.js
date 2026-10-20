// 自定义固件刷写视图（M7）：BW16 三镜像（复用生产 flashBw16 引擎）/ ESP32-C3 自定义 bin（esptool-js）
// 独立模块，风格对齐 rescue.js：自己的进度条 / 结果框 / busy 状态，日志走全局 FlashLog。
import { $, fetchBinary, fmtBytes } from "./util.js";
import { SerialSession, beginPortRequest } from "./serial.js";
import { flashBw16 } from "./ameba.js";
import { FlashLog } from "./log.js";
import { classifyDeviceMatch } from "./guard.js";
import { showManualGuide } from "./ui.js";
import { isEmbeddedBrowser } from "./main.js";

let manifests = null;
let log = null;
let switchView = null;
let busy = false;
let device = "bw16"; // bw16 | esp32c3

const IMAGES = [
  { key: "km0", file: "km0_boot_all.bin", label: "km0_boot_all.bin", fill: true },
  { key: "km4", file: "km4_boot_all.bin", label: "km4_boot_all.bin", fill: true },
  { key: "image2", file: "km0_km4_image2.bin", label: "km0_km4_image2.bin（应用）", fill: false },
];

/* ESP32-C3 文件行：[{ name, bytes, offset }] */
let espFiles = [];

/* ESP8266 文件行：[{ name, bytes, offset }] */
let esp8266Files = [];

function setState(file, text, cls = "") {
  // 作用域限定在本视图内（救砖页有同名 data-state 槽位）
  const el = document.querySelector(`#view-custom [data-state="${file}"]`);
  if (el) {
    el.textContent = text;
    el.className = `small dim ${cls}`;
  }
}

function loadImage(file, bytes, sourceLabel) {
  IMAGES.find((x) => x.file === file).bytes = bytes;
  setState(file, `✓ 已就绪（${fmtBytes(bytes.length)}，${sourceLabel}）`, "ok");
}

async function readFile(input) {
  const f = input.files?.[0];
  return f ? new Uint8Array(await f.arrayBuffer()) : null;
}

function view(name) {
  // 与主视图切换同款语义：三个视图互斥
  $("view-flash").hidden = name !== "flash";
  $("view-rescue").hidden = name !== "rescue";
  $("view-custom").hidden = name !== "custom";
  $("nav-flash").classList.toggle("selected", name === "flash");
  $("nav-rescue").classList.toggle("selected", name === "rescue");
  $("nav-custom").classList.toggle("selected", name === "custom");
}

function setDevice(d) {
  device = d;
  document.querySelectorAll("[data-cdev]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.cdev === d);
  });
  $("custom-bw16").hidden = d !== "bw16";
  $("custom-esp").hidden = d !== "esp32c3";
  $("custom-esp8266").hidden = d !== "esp8266";
  $("custom-result").hidden = true;
  $("custom-esp-result").hidden = true;
  $("custom-esp8266-result").hidden = true;
}

/* ---------------- BW16：复用生产引擎 ---------------- */

async function flashCustomBw16() {
  if (busy) return;
  const missing = IMAGES.filter((x) => !x.bytes).map((x) => x.file);
  if (missing.length) {
    const r = $("custom-result");
    r.hidden = false;
    r.className = "alert alert-warn";
    r.textContent = `还缺少镜像：${missing.join("、")}。请上传，或用 SDK 默认镜像填充。`;
    return;
  }

  busy = true;
  setCustomBusy(true);
  const params = new URLSearchParams(location.search);
  const mock = params.has("mock");
  const debug = params.has("debug");
  const t0 = Date.now();
  let ok = false;
  let portLabel = mock ? "mock://bw16" : "Web Serial";

  log.beginSession({ device: "BW16", firmware: "自定义固件（本地上传）", port: portLabel });
  $("custom-progress-wrap").hidden = false;
  $("custom-result").hidden = true;

  try {
    // flashloader 始终用内置官方文件（含 SHA-256 校验）
    const { flashloader } = manifests.bw16;
    const loaderBytes = await fetchBinary(flashloader.path);
    const digest = await crypto.subtle.digest("SHA-256", loaderBytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (flashloader.sha256 && hex !== flashloader.sha256) {
      throw new Error("内置引导程序校验失败，请刷新页面重试");
    }

    let port = null;
    if (mock) {
      const { MockBw16Device } = await import("../test/helpers/mock-device.js");
      const dev = new MockBw16Device({ nakIntervalMs: 5 });
      window.__mockDevice = dev;
      port = dev.port;
      log.append("【演练模式】使用模拟设备（?mock=1），不会写真实硬件", "warn");
    } else {
      if (isEmbeddedBrowser()) {
        throw new Error("内嵌预览窗无法弹出串口列表，请复制页面地址到独立 Chrome/Edge 打开");
      }
      log.append("请在弹出的窗口中选择你的开发板串口…", "sys");
      port = await beginPortRequest();
    }

    const session = new SerialSession(port, (s) => log.append(s, "sys"));
    await session.open();
    if (!mock) {
      const { usbVendorId } = session.getInfo();
      portLabel = "USB 串口";
      const g = classifyDeviceMatch(usbVendorId, "bw16");
      if (g.level === "block") throw new Error(g.reason);
      if (g.level === "warn" && !confirm(`${g.reason}。仍要继续刷写吗？`)) throw new Error("用户取消");
      log.append(`串口校验：${g.reason}`, g.level === "match" ? "ok" : "warn");
      log.append("串口已连接", "ok");
    }
    if (debug) {
      session.enableRxTrace();
      log.append("[诊断] RX 字节示踪已开启（?debug）", "warn");
    }

    const extendedErase = $("custom-extended-erase").checked;
    await flashBw16({
      session,
      images: {
        flashloader: loaderBytes,
        km0: IMAGES.find((x) => x.key === "km0").bytes,
        km4: IMAGES.find((x) => x.key === "km4").bytes,
        image2: IMAGES.find((x) => x.key === "image2").bytes,
      },
      log: (s) => log.append(s),
      onProgress: ({ writtenBytes, totalBytes, text }) => {
        const pct = totalBytes ? Math.round((writtenBytes / totalBytes) * 100) : 0;
        $("custom-progress-bar").style.width = `${pct}%`;
        $("custom-progress-text").textContent = `${pct}% · ${text}（${writtenBytes}/${totalBytes} 字节）`;
      },
      onNeedManual: async (n) => {
        log.append(`等待手动操作（剩余重试 ${n} 次）…`, "warn");
        await showManualGuide(n);
        log.append("用户已完成手动操作，重试…", "sys");
      },
      extendedErase,
      highSpeed: $("custom-high-speed")?.checked ?? true,
    });
    $("custom-progress-bar").classList.add("done");
    ok = true;
    const sec = ((Date.now() - t0) / 1e3).toFixed(1);
    log.endSession(true, sec);
    showCustomResult("ok", `✓ 自定义固件刷写成功（${sec}s），设备已复位运行新固件。`);
  } catch (e) {
    $("custom-progress-bar").classList.add("fail");
    const sec = ((Date.now() - t0) / 1e3).toFixed(1);
    log.append(`自定义固件刷写失败：${e.message}`, "err");
    log.endSession(false, sec);
    const advice = /NotFoundError|No port/.test(e.message)
      ? "串口选择已取消，请重试并在弹窗中选中设备。"
      : /断开|中断/.test(e.message)
        ? "串口已断开，请重新插拔设备后重试。"
        : "建议：1) 关闭占用串口的其它程序；2) 按住 BURN + 短按 RST 后重试；3) 检查镜像文件是否正确。";
    showCustomResult("err", `✗ 刷写失败（${sec}s）：${e.message}。${advice}`);
  } finally {
    $("custom-progress-wrap").hidden = true;
    $("custom-progress-bar").className = "progress-bar";
    $("custom-progress-bar").style.width = "0%";
    busy = false;
    setCustomBusy(false);
    FlashLog.recordResult({
      device: "BW16",
      firmware: "自定义固件",
      port: portLabel,
      success: ok,
      duration: Number(((Date.now() - t0) / 1e3).toFixed(1)),
    });
  }
}

function setCustomBusy(v) {
  const b = $("btn-custom-flash");
  b.disabled = v;
  b.textContent = v ? "刷写中…" : "连接并刷写";
  document.querySelectorAll("#view-custom input, #view-custom button").forEach((el) => {
    if (el.id !== "btn-custom-flash") el.disabled = v;
  });
}

function showCustomResult(kind, text) {
  const r = $("custom-result");
  r.hidden = false;
  r.className = `alert alert-${kind}`;
  r.textContent = text;
}

/* ---------------- ESP32-C3：esptool-js ---------------- */

function renderEspRows() {
  const box = $("custom-esp-files");
  box.innerHTML = "";
  espFiles.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "rescue-slot";
    row.innerHTML = `
      <span class="rescue-label" style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.name}">${f.name}（${fmtBytes(f.bytes.length)}）</span>
      <input type="text" class="esp-offset" data-idx="${i}" value="${f.offset}" spellcheck="false"
             style="width:90px;padding:6px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#7dd3fc;font-family:monospace;">
      <button class="btn btn-small" type="button" data-rm="${i}">×</button>`;
    box.appendChild(row);
  });
  box.querySelectorAll("[data-rm]").forEach((b) => {
    b.addEventListener("click", () => {
      espFiles.splice(Number(b.dataset.rm), 1);
      renderEspRows();
    });
  });
  box.querySelectorAll(".esp-offset").forEach((input) => {
    input.addEventListener("change", () => {
      const v = parseOffset(input.value);
      input.style.borderColor = v === null ? "#ef4444" : "#334155";
      if (v !== null) espFiles[Number(input.dataset.idx)].offset = v;
    });
  });
}

function parseOffset(s) {
  const t = String(s).trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  return null;
}

async function flashCustomEsp() {
  if (busy) return;
  if (!espFiles.length || espFiles.some((f) => parseOffset(f.offset) === null)) {
    const r = $("custom-esp-result");
    r.hidden = false;
    r.className = "alert alert-warn";
    r.textContent = "请先添加固件文件，并填写正确的烧录地址（如 0x0）。";
    return;
  }
  busy = true;
  const t0 = Date.now();
  let ok = false;
  $("btn-custom-esp-flash").disabled = true;
  $("custom-esp-progress-wrap").hidden = false;
  $("custom-esp-result").hidden = true;
  log.beginSession({ device: "ESP32-C3", firmware: "自定义固件（本地上传）", port: "Web Serial" });

  let transport = null;
  try {
    if (!("serial" in navigator)) throw new Error("当前浏览器不支持 Web Serial，请使用 Chrome/Edge");
    if (isEmbeddedBrowser()) throw new Error("内嵌预览窗无法弹出串口列表，请复制页面地址到独立 Chrome/Edge 打开");
    log.append("请在弹出的窗口中选择你的开发板串口…", "sys");
    const port = await beginPortRequest();

    const { ESPLoader, Transport } = await import("./vendor/esptool-js.esm.js");
    transport = new Transport(port, false);
    const loader = new ESPLoader({
      transport,
      port,
      baudrate: 921600,
      terminal: {
        clean: () => {},
        writeLine: (s) => log.append(String(s).trim(), "sys"),
        write: () => {}, // 协议级细节不打进用户日志
      },
    });
    log.append("正在连接设备…", "sys");
    await loader.main();
    log.append("设备已就绪，开始写入自定义固件…", "ok");

    const total = espFiles.reduce((s, f) => s + f.bytes.length, 0);
    await loader.writeFlash({
      fileArray: espFiles.map((f) => ({ data: f.bytes, address: parseOffset(f.offset) })),
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, fileTotal) => {
        const before = espFiles.slice(0, fileIndex).reduce((s, f) => s + f.bytes.length, 0);
        const done = before + Math.min(written, fileTotal);
        const pct = total ? Math.round((done / total) * 100) : 0;
        $("custom-esp-progress-bar").style.width = `${pct}%`;
        $("custom-esp-progress-text").textContent = `${pct}% · ${espFiles[fileIndex]?.name ?? ""}（${fileIndex + 1}/${espFiles.length}）`;
      },
    });
    log.append("写入完成，正在校验复位…", "sys");
    await loader.after("hard_reset");
    await transport.disconnect();
    transport = null;

    $("custom-esp-progress-bar").classList.add("done");
    ok = true;
    const sec = ((Date.now() - t0) / 1e3).toFixed(1);
    log.endSession(true, sec);
    const r = $("custom-esp-result");
    r.hidden = false;
    r.className = "alert alert-ok";
    r.textContent = `✓ 自定义固件刷写成功（${sec}s），设备已复位。`;
  } catch (e) {
    $("custom-esp-progress-bar").classList.add("fail");
    const sec = ((Date.now() - t0) / 1e3).toFixed(1);
    log.append(`ESP32-C3 自定义固件刷写失败：${e.message}`, "err");
    log.endSession(false, sec);
    try {
      await transport?.disconnect();
    } catch { /* ignore */ }
    const advice = /NotFoundError|No port|cancelled/i.test(e.message)
      ? "串口选择已取消，请重试并在弹窗中选中设备。"
      : /Failed to (connect|open)|sync/i.test(e.message)
        ? "连接失败：请确认板子已进入下载模式（按住 BOOT → 短按 RST → 松开），再重试。"
        : "建议：换 USB 线 / 关闭占用串口的程序后重试。";
    const r = $("custom-esp-result");
    r.hidden = false;
    r.className = "alert alert-err";
    r.textContent = `✗ 刷写失败（${sec}s）：${e.message}。${advice}`;
  } finally {
    $("custom-esp-progress-wrap").hidden = true;
    $("custom-esp-progress-bar").className = "progress-bar";
    $("custom-esp-progress-bar").style.width = "0%";
    $("btn-custom-esp-flash").disabled = false;
    busy = false;
    FlashLog.recordResult({
      device: "ESP32-C3",
      firmware: "自定义固件",
      port: "Web Serial",
      success: ok,
      duration: Number(((Date.now() - t0) / 1e3).toFixed(1)),
    });
  }
}

/* ---------------- ESP8266：esptool-js（实验性） ---------------- */

function renderEsp8266Rows() {
  const box = $("custom-esp8266-files");
  box.innerHTML = "";
  esp8266Files.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "rescue-slot";
    row.innerHTML = `
      <span class="rescue-label" style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.name}">${f.name}（${fmtBytes(f.bytes.length)}）</span>
      <input type="text" class="esp-offset8266" data-idx8266="${i}" value="${f.offset}" spellcheck="false"
             style="width:90px;padding:6px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#7dd3fc;font-family:monospace;">
      <button class="btn btn-small" type="button" data-rm8266="${i}">×</button>`;
    box.appendChild(row);
  });
  box.querySelectorAll("[data-rm8266]").forEach((b) => {
    b.addEventListener("click", () => {
      esp8266Files.splice(Number(b.dataset.rm8266), 1);
      renderEsp8266Rows();
    });
  });
  box.querySelectorAll(".esp-offset8266").forEach((input) => {
    input.addEventListener("change", () => {
      const v = parseOffset(input.value);
      input.style.borderColor = v === null ? "#ef4444" : "#334155";
      if (v !== null) esp8266Files[Number(input.dataset.idx8266)].offset = v;
    });
  });
}

async function flashCustomEsp8266() {
  if (busy) return;
  if (!esp8266Files.length || esp8266Files.some((f) => parseOffset(f.offset) === null)) {
    const r = $("custom-esp8266-result");
    r.hidden = false;
    r.className = "alert alert-warn";
    r.textContent = "请先添加固件文件，并填写正确的烧录地址（如 0x0）。";
    return;
  }
  busy = true;
  const t0 = Date.now();
  let ok = false;
  $("btn-custom-esp8266-flash").disabled = true;
  $("custom-esp8266-progress-wrap").hidden = false;
  $("custom-esp8266-result").hidden = true;
  log.beginSession({ device: "ESP8266", firmware: "自定义固件（本地上传）", port: "Web Serial" });
  let transport = null;
  try {
    if (!("serial" in navigator)) throw new Error("当前浏览器不支持 Web Serial，请使用 Chrome/Edge");
    if (isEmbeddedBrowser()) throw new Error("内嵌预览窗无法弹出串口列表，请复制页面地址到独立 Chrome/Edge 打开");
    log.append("请在弹出的窗口中选择你的开发板串口…", "sys");
    const port = await beginPortRequest();
    const { ESPLoader, Transport } = await import("./vendor/esptool-js.esm.js");
    transport = new Transport(port, false);
    const loader = new ESPLoader({
      transport,
      port,
      baudrate: 115200,
      terminal: {
        clean: () => {},
        writeLine: (s) => log.append(String(s).trim(), "sys"),
        write: () => {},
      },
    });
    log.append("正在连接设备…（ESP8266 支持：实验性）", "sys");
    await loader.main();
    log.append("设备已就绪，开始写入自定义固件…", "ok");
    const total = esp8266Files.reduce((s, f) => s + f.bytes.length, 0);
    await loader.writeFlash({
      fileArray: esp8266Files.map((f) => ({ data: f.bytes, address: parseOffset(f.offset) })),
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: false,   // ESP8266 ROM 写闪不支持压缩
      reportProgress: (fileIndex, written, fileTotal) => {
        const before = esp8266Files.slice(0, fileIndex).reduce((s, f) => s + f.bytes.length, 0);
        const done = before + Math.min(written, fileTotal);
        const pct = total ? Math.round((done / total) * 100) : 0;
        $("custom-esp8266-progress-bar").style.width = `${pct}%`;
        $("custom-esp8266-progress-text").textContent = `${pct}% · ${esp8266Files[fileIndex]?.name ?? ""}（${fileIndex + 1}/${esp8266Files.length}）`;
      },
    });
    log.append("写入完成，正在复位…", "sys");
    await loader.after("hard_reset");
    await transport.disconnect();
    transport = null;
    $("custom-esp8266-progress-bar").classList.add("done");
    ok = true;
    const sec = ((Date.now() - t0) / 1e3).toFixed(1);
    log.endSession(true, sec);
    const r = $("custom-esp8266-result");
    r.hidden = false;
    r.className = "alert alert-ok";
    r.textContent = `✓ 自定义固件刷写成功（${sec}s），设备已复位。`;
  } catch (e) {
    $("custom-esp8266-progress-bar").classList.add("fail");
    const sec = ((Date.now() - t0) / 1e3).toFixed(1);
    log.append(`ESP8266 自定义固件刷写失败：${e.message}`, "err");
    log.endSession(false, sec);
    try { await transport?.disconnect(); } catch { /* ignore */ }
    const advice = /NotFoundError|No port|cancelled/i.test(e.message)
      ? "串口选择已取消，请重试并在弹窗中选中设备。"
      : /Failed to (connect|open)|sync|timestamp/i.test(e.message)
        ? "连接失败：请让板子进入下载模式（按住 BOOT/FLASH → 短按 RST → 松开），再重试。"
        : "建议：换 USB 线 / 关闭占用串口的程序后重试。";
    const r = $("custom-esp8266-result");
    r.hidden = false;
    r.className = "alert alert-err";
    r.textContent = `✗ 刷写失败（${sec}s）：${e.message}。${advice}`;
  } finally {
    $("custom-esp8266-progress-wrap").hidden = true;
    $("custom-esp8266-progress-bar").className = "progress-bar";
    $("custom-esp8266-progress-bar").style.width = "0%";
    $("btn-custom-esp8266-flash").disabled = false;
    busy = false;
    FlashLog.recordResult({
      device: "ESP8266",
      firmware: "自定义固件",
      port: "Web Serial",
      success: ok,
      duration: Number(((Date.now() - t0) / 1e3).toFixed(1)),
    });
  }
}

/* ---------------- 初始化 ---------------- */

export async function initCustom(m, l, z) {
  manifests = m;
  log = l;
  switchView = z;

  $("nav-custom").addEventListener("click", () => view("custom"));
  // 主导航不知道本视图，切走时帮它隐藏
  $("nav-flash").addEventListener("click", () => ($("view-custom").hidden = true));
  $("nav-rescue").addEventListener("click", () => ($("view-custom").hidden = true));

  document.querySelectorAll("[data-cdev]").forEach((b) => {
    b.addEventListener("click", () => setDevice(b.dataset.cdev));
  });

  // BW16 上传槽 + SDK 默认镜像
  const slotId = { km0: "custom-km0", km4: "custom-km4", image2: "custom-image2" };
  for (const img of IMAGES) {
    const input = $(slotId[img.key]);
    input.addEventListener("change", async () => {
      const bytes = await readFile(input);
      if (bytes) loadImage(img.file, bytes, input.files[0].name);
    });
  }
  document.querySelectorAll("#view-custom [data-cfill]").forEach((b) => {
    b.addEventListener("click", async () => {
      const file = b.dataset.cfill;
      const backup = manifests.bw16?.sdkBackup?.[file];
      if (!backup) return void setState(file, "× SDK 备份不存在", "err");
      try {
        loadImage(file, await fetchBinary(backup.path), "SDK 默认镜像");
      } catch (e) {
        setState(file, `× 加载失败：${e.message}`, "err");
      }
    });
  });

  $("btn-custom-flash").addEventListener("click", () => void flashCustomBw16());

  // ESP32-C3 文件管理
  $("custom-esp-add").addEventListener("change", async () => {
    const input = $("custom-esp-add");
    for (const f of Array.from(input.files ?? [])) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      espFiles.push({ name: f.name, bytes, offset: 0 });
    }
    input.value = "";
    renderEspRows();
  });
  $("btn-custom-esp-flash").addEventListener("click", () => void flashCustomEsp());
  renderEspRows();

  // ESP8266 文件管理（实验性）
  $("custom-esp8266-add").addEventListener("change", async () => {
    const input = $("custom-esp8266-add");
    for (const f of Array.from(input.files ?? [])) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      esp8266Files.push({ name: f.name, bytes, offset: 0 });
    }
    input.value = "";
    renderEsp8266Rows();
  });
  $("btn-custom-esp8266-flash").addEventListener("click", () => void flashCustomEsp8266());
  renderEsp8266Rows();

  // mock 演练：自动用假镜像填充 BW16 槽位
  if (new URLSearchParams(location.search).has("mock") && new URLSearchParams(location.search).has("custombins")) {
    const fake = (n) => new Uint8Array(n).fill(0x5a);
    loadImage("km0_boot_all.bin", fake(4500), "演练");
    loadImage("km4_boot_all.bin", fake(4456), "演练");
    loadImage("km0_km4_image2.bin", fake(8192), "演练");
    log.append("【演练模式】自定义固件槽位已用模拟数据填充", "warn");
  }
}
