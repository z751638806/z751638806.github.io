// 遥测模块（admin.peipeidev.cn 后台 API）
// - reportFlashResult：刷写结果匿名上报（由 log.js 的 recordResult 触发，仅生产域名）
// - setLastFlashSummary：暂存最近一次刷写摘要，供反馈弹窗附带
// 2026-10-27：移除本模块自带的反馈弹窗与公告轮询。它们与 main.js 的反馈弹窗、
// 公告条（10s 轮询）双轨重复：api 模式顶栏出现两个「反馈」按钮，公告关闭状态
// 两套互不知情（内存 Set vs localStorage dismissed_ann）导致关闭后刷新即复活。
// 现在公告与反馈统一由 main.js 负责，关闭状态持久化键沿用 'dismissed_ann'。
const API = "https://admin.peipeidev.cn";

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

/* ---------- 入口 ---------- */
export function initTelemetry(getSummary) {
  if (getSummary) setLastFlashSummary(getSummary());
}

// 聚合导出（log.js / main.js 引用）
export const telemetry = { reportFlashResult, initTelemetry, setLastFlashSummary };
