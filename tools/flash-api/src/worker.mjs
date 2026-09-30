// peipei-flash-api — peipeidev.cn 在线烧录后台 API（Cloudflare Worker + D1）
// 能力：刷写统计 / 用户反馈 / 公告 / 激活码（M5）/ 付费固件签名取件（M6）
// 部署：cd tools/flash-api && HTTPS_PROXY=… npx wrangler deploy
// 管理：Header Authorization: Bearer <ADMIN_TOKEN secret>

import { adminPage } from "./admin.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "POST")
      return json({ error: "method" }, 405, cors);

    try {
      if (path === "/api/health") return json({ ok: true, service: "peipei-flash-api", ts: Date.now() }, 200, cors);
      if (path === "/admin") return adminPage();
      // 公开：激活码核销（设备端 Web 后台调用）——M5
      if (path === "/api/redeem" && request.method === "POST") return await redeemCode(request, env, cors);
      if (path === "/api/event" && request.method === "POST") return await reportEvent(request, env, cors);
      if (path === "/api/feedback" && request.method === "POST") return await postFeedback(request, env, cors);
      if (path === "/api/announcements") return await listAnnouncements(env, cors);

      // ---- 管理接口（Bearer ADMIN_TOKEN）----
      if (path.startsWith("/api/admin/")) {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401, cors);
        if (path === "/api/admin/stats") return await stats(env, url, cors);
        if (path === "/api/admin/feedback" && request.method === "GET") return await listFeedback(env, url, cors);
        if (path === "/api/admin/feedback/handle" && request.method === "POST") return await handleFeedback(request, env, cors);
        if (path === "/api/admin/announcements" && request.method === "GET") return await listAnnouncements(env, cors, true);
        if (path === "/api/admin/announcements" && request.method === "POST") return await upsertAnnouncement(request, env, cors);
        if (path === "/api/admin/codes" && request.method === "POST") return await genCodes(request, env, cors);
        if (path === "/api/admin/codes" && request.method === "GET") return await listCodes(env, url, cors);
        return json({ error: "not_found" }, 404, cors);
      }
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      return json({ error: "server", message: String(e && e.message || e) }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}
function isAdmin(req, env) {
  const h = req.headers.get("Authorization") || "";
  return env.ADMIN_TOKEN && h === "Bearer " + env.ADMIN_TOKEN;
}
async function body(request) {
  try { return await request.json() || {}; } catch { return {}; }
}
const clean = (s, n = 300) => (typeof s === "string" ? s.slice(0, n) : null);

/* ---------- 公开：刷写统计上报 ---------- */
async function reportEvent(request, env, cors) {
  const b = await body(request);
  const device = clean(b.device, 40), firmware = clean(b.firmware, 120);
  if (!device || !firmware) return json({ error: "bad_request" }, 400, cors);
  await env.DB.prepare(
    "INSERT INTO flash_events (ts, device, firmware, success, duration_s, err) VALUES (?,?,?,?,?,?)"
  ).bind(Date.now(), device, firmware, b.success ? 1 : 0, Number(b.durationS) || null, clean(b.err, 200)).run();
  return json({ ok: true }, 200, cors);
}

/* ---------- 公开：用户反馈 ---------- */
async function postFeedback(request, env, cors) {
  const b = await body(request);
  const message = clean(b.message, 2000);
  if (!message || message.length < 5) return json({ error: "bad_request" }, 400, cors);
  await env.DB.prepare(
    "INSERT INTO feedback (ts, contact, message, log) VALUES (?,?,?,?)"
  ).bind(Date.now(), clean(b.contact, 120), message, clean(b.log, 4000)).run();
  return json({ ok: true }, 200, cors);
}

/* ---------- 公开/管理：公告 ---------- */
async function listAnnouncements(env, cors, all = false) {
  const { results } = await env.DB.prepare(
    all ? "SELECT * FROM announcements ORDER BY sort DESC, ts DESC LIMIT 50"
        : "SELECT id, ts, title, body FROM announcements WHERE active=1 ORDER BY sort DESC, ts DESC LIMIT 5"
  ).all();
  return json({ announcements: results || [] }, 200, cors);
}
async function upsertAnnouncement(request, env, cors) {
  const b = await body(request);
  const title = clean(b.title, 120);
  if (!title) return json({ error: "bad_request" }, 400, cors);
  if (b.id) {
    await env.DB.prepare(
      "UPDATE announcements SET title=?, body=?, active=?, sort=? WHERE id=?"
    ).bind(title, clean(b.body, 2000), b.active ? 1 : 0, Number(b.sort) || 0, b.id).run();
    return json({ ok: true, id: b.id }, 200, cors);
  }
  const r = await env.DB.prepare(
    "INSERT INTO announcements (ts, title, body, active, sort) VALUES (?,?,?,?,?)"
  ).bind(Date.now(), title, clean(b.body, 2000), b.active === false ? 0 : 1, Number(b.sort) || 0).run();
  return json({ ok: true, id: r.meta.last_row_id }, 200, cors);
}

/* ---------- 管理：统计 ---------- */
async function stats(env, url, cors) {
  const days = Math.min(Number(url.searchParams.get("days")) || 30, 90);
  const since = Date.now() - days * 86400000;
  const q = async (sql, ...p) => (await env.DB.prepare(sql).bind(...p).all()).results;
  const [total, byFw, byDay, topErr, fb] = await Promise.all([
    q("SELECT COUNT(*) n, SUM(success) ok FROM flash_events WHERE ts>=?", since),
    q("SELECT firmware, COUNT(*) n, SUM(success) ok FROM flash_events WHERE ts>=? GROUP BY firmware ORDER BY n DESC LIMIT 30", since),
    q("SELECT date(ts/1000,'unixepoch','localtime') d, COUNT(*) n, SUM(success) ok FROM flash_events WHERE ts>=? GROUP BY d ORDER BY d", since),
    q("SELECT err, COUNT(*) n FROM flash_events WHERE ts>=? AND success=0 AND err IS NOT NULL GROUP BY err ORDER BY n DESC LIMIT 10", since),
    q("SELECT COUNT(*) n, SUM(handled) handled FROM feedback WHERE ts>=?", since),
  ]);
  return json({
    days,
    total: total[0] || { n: 0 },
    byFirmware: byFw, byDay, topErrors: topErr,
    feedback: fb[0] || { n: 0 },
  }, 200, cors);
}

/* ---------- 管理：反馈 ---------- */
async function listFeedback(env, url, cors) {
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const { results } = await env.DB.prepare(
    "SELECT * FROM feedback ORDER BY ts DESC LIMIT ?"
  ).bind(limit).all();
  return json({ feedback: results || [] }, 200, cors);
}
async function handleFeedback(request, env, cors) {
  const b = await body(request);
  if (!b.id) return json({ error: "bad_request" }, 400, cors);
  await env.DB.prepare("UPDATE feedback SET handled=? WHERE id=?").bind(b.handled === false ? 0 : 1, b.id).run();
  return json({ ok: true }, 200, cors);
}

/* ---------- 管理：激活码 ---------- */
function genCode() {
  // XXXX-XXXX-XXXX-XXXX（去易混字符）
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seg = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}
async function genCodes(request, env, cors) {
  const b = await body(request);
  const slug = clean(b.slug, 60) || "*";
  const count = Math.min(Number(b.count) || 1, 100);
  const note = clean(b.note, 200);
  const out = [];
  for (let i = 0; i < count; i++) {
    const code = genCode();
    await env.DB.prepare("INSERT INTO codes (code, slug, note, created_ts) VALUES (?,?,?,?)")
      .bind(code, slug, note, Date.now()).run();
    out.push(code);
  }
  return json({ ok: true, codes: out }, 200, cors);
}
/* ---------- 公开：激活码核销 ---------- */
async function redeemCode(request, env, cors) {
  const b = await body(request);
  const code = clean(b.code, 32);
  const slug = clean(b.slug, 60);
  if (!code) return json({ error: "bad_request" }, 400, cors);
  const row = await env.DB.prepare("SELECT * FROM codes WHERE code=?").bind(code).first();
  if (!row || row.status === "disabled") return json({ ok: false, error: "invalid_code" }, 200, cors);
  if (row.status === "redeemed") return json({ ok: false, error: "already_redeemed", redeemedTs: row.redeemed_ts }, 200, cors);
  if (row.slug !== "*" && slug && row.slug !== slug) return json({ ok: false, error: "slug_mismatch" }, 200, cors);
  await env.DB.prepare("UPDATE codes SET status='redeemed', redeemed_ts=? WHERE id=?").bind(Date.now(), row.id).run();
  return json({ ok: true, slug: row.slug, redeemedTs: Date.now() }, 200, cors);
}

async function listCodes(env, url, cors) {
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
  const { results } = await env.DB.prepare(
    "SELECT * FROM codes ORDER BY id DESC LIMIT ?"
  ).bind(limit).all();
  return json({ codes: results || [] }, 200, cors);
}
