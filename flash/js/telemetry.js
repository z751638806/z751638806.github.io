// 遥测与反馈模块（peipeidev.cn 后台 API：api.peipeidev.cn）
// - reportFlashResult：刷写结果匿名上报（由 log.js 的 recordResult 触发，仅生产域名）
// - 公告条：轮询 /api/announcements 展示（复用现有 announce-bar DOM）
// - 反馈面板：顶部按钮 + 弹窗（可附最近刷写摘要）
const API = "https://api.peipeidev.cn";

const enabled = () => location.hostname.endsWith("peipeidev.cn");

export function reportFlashResult(rec) {
  if (!enabled() || !rec) return;
  try {
    fetch(API + "/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        device: rec.device || "?",
        firmware: rec.firmware || "?",
        success: !!rec.success,
        durationS: Number(rec.duration) || 0,
      }),
    }).catch(() => {});
  } catch { /* 静默：统计失败不影响使用 */ }
}

let lastFlashSummary = null;
export function setLastFlashSummary(s) { lastFlashSummary = s; }

/* ---------- 公告条 ---------- */
let dismissed = new Set(JSON.parse(localStorage.getItem("dismissed_ann") || "[]"));
async function pollAnnouncements() {
  if (!enabled()) return;
  try {
    const r = await fetch(API + "/api/announcements", { cache: "no-store" });
    const d = await r.json();
    const bar = document.getElementById("announce-bar");
    if (!bar) return;
    const a = (d.announcements || []).find((x) => !dismissed.has(x.id));
    if (a) {
      document.getElementById("announce-title").textContent = `📢 ${a.title}`;
      document.getElementById("announce-body").textContent = a.body || "";
      bar.dataset.announceId = String(a.id);
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  } catch { /* 静默 */ }
}

/* ---------- 反馈面板 ---------- */
function injectFeedbackUI() {
  const slot = document.querySelector(".topbar-status");
  if (!slot || document.getElementById("btn-feedback2")) return;
  const btn = document.createElement("button");
  btn.id = "btn-feedback2"; btn.type = "button"; btn.className = "btn";
  btn.style.cssText = "padding:2px 10px;font-size:12px;";
  btn.textContent = "反馈";
  slot.prepend(btn);

  const ov = document.createElement("div");
  ov.id = "fb2-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:60;display:none;align-items:center;justify-content:center;";
  ov.innerHTML = `
    <div role="dialog" aria-modal="true" style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:22px 24px;width:min(92vw,420px);color:#e2e8f0;">
      <h3 style="margin:0 0 6px;font-size:17px;">问题反馈</h3>
      <p class="dim" style="margin:0 0 14px;font-size:12px;color:#8b97a7;">刷写失败 / 页面异常 / 功能建议——留下联系方式（可选），我们会尽快处理。</p>
      <label style="display:block;margin-bottom:10px;font-size:13px;">问题描述（必填）
        <textarea id="fb2-msg" rows="4" maxlength="2000" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;resize:vertical;"></textarea>
      </label>
      <label style="display:block;margin-bottom:10px;font-size:13px;">联系方式（可选：QQ / 邮箱 / 闲鱼号）
        <input id="fb2-contact" type="text" maxlength="120" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;">
      </label>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-size:13px;">
        <input id="fb2-attach" type="checkbox" checked> 附带最近一次刷写摘要（固件名/成败/耗时，不含串口数据）
      </label>
      <p id="fb2-err" class="alert alert-err" style="margin:0 0 12px;" hidden></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="fb2-cancel" class="btn" type="button">取消</button>
        <button id="fb2-submit" class="btn btn-primary" type="button">提交</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const close = () => { ov.style.display = "none"; };
  btn.onclick = () => { ov.style.display = "flex"; document.getElementById("fb2-msg").focus(); };
  document.getElementById("fb2-cancel").onclick = close;
  document.getElementById("fb2-submit").onclick = async () => {
    const err = document.getElementById("fb2-err");
    const msg = document.getElementById("fb2-msg").value.trim();
    err.hidden = true;
    if (msg.length < 5) { err.textContent = "请至少描述 5 个字"; err.hidden = false; return; }
    const attach = document.getElementById("fb2-attach").checked && lastFlashSummary;
    try {
      const r = await fetch(API + "/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          contact: document.getElementById("fb2-contact").value.trim() || null,
          log: attach ? JSON.stringify(lastFlashSummary) : null,
        }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      close();
      document.getElementById("fb2-msg").value = "";
      btn.textContent = "✓ 已收到";
      setTimeout(() => (btn.textContent = "反馈"), 3000);
    } catch (e) {
      err.textContent = "提交失败（网络原因）：可直接在 peipeidev.cn 首页找到联系方式联系我们。" + e.message;
      err.hidden = false;
    }
  };
}

/* ---------- 入口 ---------- */
export function initTelemetry(getSummary) {
  if (getSummary) setLastFlashSummary(getSummary());
  injectFeedbackUI();
  pollAnnouncements();
  setInterval(pollAnnouncements, 60000);
  // 复用现有公告条关闭按钮逻辑（若未绑定）
  const closeBtn = document.getElementById("announce-close");
  const bar = document.getElementById("announce-bar");
  if (closeBtn && bar && !closeBtn.dataset.telemetry) {
    closeBtn.dataset.telemetry = "1";
    closeBtn.addEventListener("click", () => {
      const id = Number(bar.dataset.announceId || 0);
      if (id) { dismissed.add(id); localStorage.setItem("dismissed_ann", JSON.stringify([...dismissed])); }
    });
  }
}

// 聚合导出（log.js / main.js 引用）
export const telemetry = { reportFlashResult, initTelemetry, setLastFlashSummary };
