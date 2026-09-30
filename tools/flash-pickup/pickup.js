// 付费固件取件模块（M6）—— peipeidev.cn 后台 API
// 付费固件的 bin 不发布在站点仓库；选中付费固件后输入取件码，
// 由 /api/pickup/begin 换取一次性下载链接（10 分钟内有效、单次核销、绑定浏览器指纹），
// 下载并完成 SHA-256 校验后交给正常刷写流程。?mock=1 演练模式用模拟数据跑完整流程。
const API = "https://admin.peipeidev.cn";

const isMock = () => new URLSearchParams(location.search).has("mock");
const apiBase = () => {
  const p = new URLSearchParams(location.search);
  return p.has("api") ? (p.get("api") || API) : API;
};

// slug → { flashloader, km0, km4, image2 }（已校验的镜像字节）
const cache = new Map();
let panel = null;

export function isPaid(fw) { return !!(fw && fw.paid); }

/* ---------- 浏览器指纹（begin 与每次取件保持一致即可，无需跨会话稳定） ---------- */
function fnv1a(str) {
  let a = 2166136261, b = 16777619;
  for (let i = 0; i < str.length; i++) {
    a = (a ^ str.charCodeAt(i)) >>> 0; a = (a * 16777619) >>> 0;
    b = (b ^ str.charCodeAt(str.length - 1 - i)) >>> 0; b = (b * 16777619) >>> 0;
  }
  return `fnv${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
function fingerprint() {
  return fnv1a([
    navigator.userAgent, navigator.language || "",
    `${screen.width}x${screen.height}x${screen.devicePixelRatio || 1}`,
    String(new Date().getTimezoneOffset()),
  ].join("|"));
}

/* ---------- 取件面板 ---------- */
function mountPanel() {
  if (panel) return panel;
  const note = document.getElementById("flash-note");
  if (!note) return null;
  const el = document.createElement("div");
  el.id = "pickup-panel";
  el.hidden = true;
  el.className = "alert alert-info";
  el.style.margin = "10px 0";
  el.innerHTML = `
    <b>🔒 付费固件 · 取件验证</b>
    <p class="small dim" style="margin:4px 0 8px;">此固件需要激活码。输入购买时获得的取件码，验证通过后自动下载固件文件，然后点下方「连接并刷写」完成刷写。</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input id="pickup-code" type="text" autocomplete="off" spellcheck="false"
        placeholder="取件码（如 XXXX-XXXX-XXXX-XXXX）"
        style="flex:1;min-width:200px;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-panel-2);color:var(--text);font-family:monospace;">
      <button id="pickup-go" class="btn btn-primary" type="button">验证并取件</button>
    </div>
    <p id="pickup-status" class="small dim" style="margin:6px 0 0;"></p>`;
  note.after(el);
  panel = el;

  const input = el.querySelector("#pickup-code");
  const btn = el.querySelector("#pickup-go");
  const go = () => doPickup(input, btn, el.querySelector("#pickup-status"));
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  return el;
}

function setStatus(el, text, cls) {
  const p = el.querySelector("#pickup-status");
  p.textContent = text;
  p.style.color = cls === "err" ? "var(--err,#f87171)" : cls === "ok" ? "var(--ok,#4ade80)" : "";
}

async function doPickup(input, btn) {
  const fw = currentFw;
  if (!fw) return;
  const code = input.value.trim().toUpperCase();
  if (!code) { setStatus(panel, "请先输入取件码", "err"); return; }
  btn.disabled = true;
  setStatus(panel, "正在验证取件码…", "");
  try {
    const r = await fetch(`${apiBase()}/api/pickup/begin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, slug: fw.slug, fp: fingerprint() }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(pickupErrorText(d));
    setStatus(panel, "验证通过，正在下载固件文件（一次性链接）…", "");
    const images = await downloadImages(fw, d.files);
    cache.set(fw.slug, images);
    const total = d.files.reduce((n, f) => n + (f.size || 0), 0);
    setStatus(panel, "✓ 取件完成，文件校验通过。点下方「连接并刷写」开始。", "ok");
    log && log.append(`付费固件取件完成（${d.files.length} 个文件，共 ${fmtKB(total)}），已通过 SHA-256 校验`, "ok");
    btn.textContent = "✓ 已取件";
  } catch (e) {
    setStatus(panel, `× ${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
}

function pickupErrorText(d) {
  const map = {
    invalid_code: "取件码无效，请核对后重试",
    already_redeemed: "取件码已被使用（如刷写失败需重下，请联系开发者）",
    slug_mismatch: "取件码与当前固件不匹配",
    not_available: "该固件暂未开放取件",
    not_uploaded: "固件文件尚未就绪，请稍后再试",
    bad_request: "请求不完整",
  };
  return map[d && d.error] || "验证失败（网络原因），请稍后重试";
}

/* ---------- 主流程挂钩（main.js 构建补丁调用） ---------- */
let currentFw = null;
let log = null;
const fmtKB = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");

// 固件选中/切换时调用：控制取件面板显隐
export function onFirmwareSelected(fw) {
  currentFw = fw || null;
  if (!isPaid(fw)) { if (panel) panel.hidden = true; return; }
  const el = mountPanel();
  if (!el) return;
  el.hidden = false;
  const btn = el.querySelector("#pickup-go");
  if (fw && cache.has(fw.slug)) {
    btn.textContent = "✓ 已取件";
    setStatus(el, "✓ 已取件，可直接「连接并刷写」。", "ok");
  } else {
    btn.textContent = "验证并取件";
    setStatus(el, "", "");
  }
}

// 「连接并刷写」入口闸门：付费固件未取件时不进入串口流程（避免弹端口选择器）
export async function ensurePaidReady(fw, log_) {
  if (!isPaid(fw)) return true;
  log = log_ || log;
  if (isMock()) {
    log.append("【演练模式】付费固件跳过取件，将使用模拟固件数据", "warn");
    return true;
  }
  if (cache.has(fw.slug)) return true;
  const el = mountPanel();
  if (el) {
    el.hidden = false;
    el.querySelector("#pickup-code").focus();
  }
  log.append("此固件需要取件码：请先在上方输入取件码完成验证，再开始刷写", "warn");
  return false;
}

// loadBw16Images 付费分支：返回 { flashloader, km0, km4, image2 }
export async function pickupPaidImages(fw, flashloaderMeta, fetchBinary, log_) {
  log = log_ || log;
  if (isMock()) return await fabricateMockImages(fw, flashloaderMeta, fetchBinary);
  const hit = cache.get(fw.slug);
  if (!hit) throw new Error("付费固件尚未取件：请先输入取件码完成验证");
  if (!hit.flashloader) hit.flashloader = await fetchBinary(flashloaderMeta.path);
  return hit;
}

/* ---------- 下载与校验 ---------- */
async function downloadImages(fw, files) {
  const fp = fingerprint();
  const out = {};
  await Promise.all(files.map(async (f) => {
    const r = await fetch(`${apiBase()}${f.url}?fp=${encodeURIComponent(fp)}`, { cache: "no-store" });
    if (!r.ok) {
      let why = `HTTP ${r.status}`;
      try { why = (await r.json()).error || why; } catch {}
      throw new Error(`固件文件下载失败（${why}）。一次性链接已失效的话，请重新输入取件码取件`);
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (f.sha256) {
      const hex = await sha256Hex(buf);
      if (hex !== f.sha256) throw new Error(`固件文件校验失败（${f.file}），请重新取件`);
    }
    out[f.file] = buf;
  }));
  // 回填清单校验值：main.js 的 SHA-256 复核以服务端登记值为准（后台更新 bin 无需重新构建站点）
  for (const f of files) {
    if (fw.files[f.file] && f.sha256) fw.files[f.file].sha256 = f.sha256;
  }
  return { km0: out["km0_boot_all.bin"], km4: out["km4_boot_all.bin"], image2: out["km0_km4_image2.bin"] };
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- 演练模式：确定性伪随机固件数据 ---------- */
// flashloader 用站点真实发布的 _common 引导文件（与免费固件共用，不改动共享清单元数据）；
// 只伪造三个镜像，并把付费固件自身的清单校验值同步为演练数据（仅影响该固件对象）。
async function fabricateMockImages(fw, flashloaderMeta, fetchBinary) {
  const make = (seed, size) => {
    const data = new Uint8Array(size);
    let s = seed >>> 0;
    for (let i = 0; i < size; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      data[i] = s >>> 24;
    }
    return data;
  };
  const seedOf = (str) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const pick = (name) => (fw.files && fw.files[name]) || {};
  const images = { km0: make(seedOf(fw.slug + "km0"), pick("km0_boot_all.bin").size || 262144) };
  images.km4 = make(seedOf(fw.slug + "km4"), pick("km4_boot_all.bin").size || 262144);
  images.image2 = make(seedOf(fw.slug + "image2"), pick("km0_km4_image2.bin").size || 524288);
  images.flashloader = await fetchBinary(flashloaderMeta.path);
  try {
    if (fw.files) {
      for (const [name, data] of [["km0_boot_all.bin", images.km0], ["km4_boot_all.bin", images.km4], ["km0_km4_image2.bin", images.image2]]) {
        if (fw.files[name]) fw.files[name].sha256 = await sha256Hex(data);
      }
    }
  } catch { /* 演练环境无 crypto 时跳过 */ }
  log && log.append("【演练模式】已生成模拟固件数据（?mock=1，不访问后台）", "sys");
  return images;
}

// 聚合导出（main.js 构建补丁引用）
export const pickup = { onFirmwareSelected, ensurePaidReady, pickupPaidImages, isPaid };
