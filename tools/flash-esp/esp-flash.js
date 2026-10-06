// ESP 系官方固件直刷（esptool-js）：ESP8266 ROM 直刷（无压缩）/ ESP32 家族压缩多段。
// 由 main.js 的 onFlashClick 对非 BW16 固件委托调用；镜像地址/校验来自部署清单。
import { $, fetchBinary } from "./util.js";
import { beginPortRequest } from "./serial.js";
import {
  showProgress, setProgressBar, finishProgressBar, hideProgress,
  showResult, hideResult, setBusy,
} from "./ui.js";
import { isEmbeddedBrowser } from "./main.js";
import { FlashLog } from "./log.js";

let busy = false;

export async function flashEspFirmware(fw, log) {
  if (busy) return;
  const params = new URLSearchParams(location.search);
  if (params.has("mock")) {
    log.append("ESP 系固件直刷需要真实设备，演练模式暂不支持", "warn");
    showResult("warn", "ESP 系固件需要连接真实开发板刷写（演练模式不支持）。");
    return;
  }
  if (!("serial" in navigator)) {
    showResult("err", "当前浏览器不支持 Web Serial，请使用 Chrome/Edge 打开本页面。");
    return;
  }
  if (isEmbeddedBrowser()) {
    showResult("err", "内嵌预览窗无法弹出串口列表，请复制页面地址到独立 Chrome/Edge 打开后再刷写。");
    return;
  }

  busy = true;
  setBusy(true);
  hideResult();
  const t0 = Date.now();
  let ok = false;
  let transport = null;
  log.beginSession({ device: String(fw.device).toUpperCase(), firmware: fw.name, port: "Web Serial" });
  showProgress();
  // 串口授权必须在点击的用户手势窗口内（约 5s）发起：先请求端口、再并行加载固件。
  // 若先加载后请求，慢加载（首次访问/大文件）会让 requestPort 被浏览器以
  // "Must be handling a user gesture" 拒绝（与 BW16 流程的先请求串口保持一致）。
  log.append("请在弹出的窗口中选择你的开发板串口…", "sys");
  const portPromise = beginPortRequest();
  try {
    log.append("加载固件文件…", "sys");
    const parts = fw.files ?? fw.parts ?? [];
    const fileArray = [];
    for (const p of parts) {
      const path = p.path.includes("/") ? p.path : `firmware/${fw.slug}/${p.path}`;
      const data = await fetchBinary(path);
      if (p.sha256) {
        const digest = await crypto.subtle.digest("SHA-256", data);
        const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
        if (hex !== p.sha256) throw new Error(`${p.path} 校验失败（SHA-256 不符），请刷新页面重试`);
      }
      fileArray.push({ data, address: p.offset });
    }
    const sizes = fileArray.map((f) => f.data.length);
    const total = sizes.reduce((a, b) => a + b, 0);
    log.append(`固件就绪（${parts.length} 段，共 ${total} 字节）`, "ok");

    const port = await portPromise;
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
    log.append("正在连接设备…", "sys");
    await loader.main();
    log.append("设备已就绪，开始写入固件…", "ok");

    await loader.writeFlash({
      fileArray,
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: fw.device !== "esp8266",   // ESP8266 ROM 写闪不支持压缩
      reportProgress: (fileIndex, written, fileTotal) => {
        let before = 0;
        for (let i = 0; i < fileIndex; i += 1) before += sizes[i];
        const done = before + Math.min(written, fileTotal);
        setProgressBar(done, total, `第 ${fileIndex + 1}/${fileArray.length} 段`);
      },
    });

    log.append("写入完成，正在复位设备…", "sys");
    // 复位后原生 USB（USB-Serial-JTAG）会重新枚举，复位/断开的 await 可能永远等不到
    // 端口回包 → 页面卡死在收尾（固件其实已写入成功）。加超时兜底，收尾失败不影响结果。
    const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    await withTimeout(loader.after("hard_reset"), 3000);
    try { await withTimeout(transport.disconnect(), 2000); } catch { /* ignore */ }
    transport = null;

    finishProgressBar(true);
    ok = true;
    const sec = ((Date.now() - t0) / 1e3).toFixed(1);
    log.endSession(true, sec);
    showResult("ok", `✓ ${fw.name} 刷写成功（${sec}s），设备已复位运行新固件。`);
  } catch (e) {
    finishProgressBar(false);
    const sec = ((Date.now() - t0) / 1e3).toFixed(1);
    log.append(`刷写失败：${e.message}`, "err");
    log.endSession(false, sec);
    try { await transport?.disconnect(); } catch { /* ignore */ }
    const advice = /NotFoundError|No port|cancel/i.test(e.message)
      ? "串口选择已取消，请重试并在弹窗中选中设备。"
      : /Failed to (connect|open)|sync|timestamp/i.test(e.message)
        ? "连接失败：让板子进入下载模式（按住 BOOT/FLASH → 短按 RST → 松开）后重试。"
        : "建议：1) 换 USB 数据线；2) 关闭占用串口的其它程序；3) 确认板子与固件芯片匹配。";
    showResult("err", `✗ ${fw.name} 刷写失败（${sec}s）：${e.message}。${advice}`);
  } finally {
    hideProgress();
    busy = false;
    setBusy(false);
    FlashLog.recordResult({
      device: String(fw.device).toUpperCase(),
      firmware: fw.name,
      port: "Web Serial",
      success: ok,
      duration: Number(((Date.now() - t0) / 1e3).toFixed(1)),
    });
  }
}
