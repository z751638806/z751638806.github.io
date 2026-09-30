// peipei-flash-api — peipeidev.cn 在线烧录后台 API（Cloudflare Worker + D1 + R2）
// 能力：刷写统计 / 用户反馈 / 公告 / 激活码（M5）/ 付费固件签名取件（M6）
// 部署：cd tools/flash-api && HTTPS_PROXY=… npx wrangler deploy
// 管理：Header Authorization: Bearer <ADMIN_TOKEN secret>
// M6：bin 实体存 R2（PICKUP 绑定）；/api/pickup/begin 换一次性取件链接（10 分钟、单次核销、指纹绑定）

import { adminPage } from "./admin.mjs";

const PICKUP_TTL_MS = 10 * 60 * 1000;      // 取件链接有效期
const PICKUP_RETRY_MS = 24 * 60 * 60 * 1000; // 已核销取件码的重试窗口（刷写失败重下）

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "POST" && request.method !== "PUT")
      return json({ error: "method" }, 405, cors);

    try {
      if (path === "/api/health") return json({ ok: true, service: "peipei-flash-api", ts: Date.now() }, 200, cors);
      if (path === "/admin") return adminPage();
      // 公开：激活码核销（设备端 Web 后台调用）——M5
      if (path === "/api/redeem" && request.method === "POST") return await redeemCode(request, env, cors);
      if (path === "/api/event" && request.method === "POST") return await reportEvent(request, env, cors);
      if (path === "/api/feedback" && request.method === "POST") return await postFeedback(request, env, cors);
      if (path === "/api/announcements") return await listAnnouncements(env, cors);
      // 公开：付费固件取件——M6
      if (path === "/api/pickup/begin" && request.method === "POST") return await pickupBegin(request, env, cors);
      if (path.startsWith("/pickup/") && request.method === "GET") return await pickupFetch(path.slice("/pickup/".length), url, env, cors);

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
        if (path === "/api/admin/codes/disable" && request.method === "POST") return await disableCode(request, env, cors);
        if (path === "/api/admin/paid" && request.method === "GET") return await listPaid(env, cors);
        if (path === "/api/admin/paid" && request.method === "POST") return await upsertPaid(request, env, cors);
        if (path.startsWith("/api/admin/paid/upload/") && request.method === "PUT") {
          const rest = path.slice("/api/admin/paid/upload/".length);   // <slug>/<file>
          const slash = rest.indexOf("/");
          if (slash > 0 && slash < rest.length - 1)
            return await uploadPaidBin(decodeURIComponent(rest.slice(0, slash)), decodeURIComponent(rest.slice(slash + 1)), request, env, cors);
          return json({ error: "bad_request" }, 400, cors);
        }
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

async function disableCode(request, env, cors) {
  const b = await body(request);
  if (!b.id && !b.code) return json({ error: "bad_request" }, 400, cors);
  if (b.id) await env.DB.prepare("UPDATE codes SET status='disabled' WHERE id=?").bind(b.id).run();
  else await env.DB.prepare("UPDATE codes SET status='disabled' WHERE code=?").bind(b.code).run();
  return json({ ok: true }, 200, cors);
}

/* ---------- M6：付费固件（R2 取件） ---------- */
function randomHex(nBytes) {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function listPaid(env, cors) {
  const { results: paid } = await env.DB.prepare("SELECT * FROM paid_fw ORDER BY slug").all();
  const { results: grants } = await env.DB.prepare(
    "SELECT jti, slug, file, code_id, fp, created_ts, exp_ts, used_ts FROM pickup_grants ORDER BY created_ts DESC LIMIT 50"
  ).all();
  return json({ paid: paid || [], grants: grants || [] }, 200, cors);
}

async function upsertPaid(request, env, cors) {
  const b = await body(request);
  const slug = clean(b.slug, 60);
  if (!slug) return json({ error: "bad_request" }, 400, cors);
  await env.DB.prepare(
    `INSERT INTO paid_fw (slug, device, name, active, updated_ts) VALUES (?,?,?,?,?)
     ON CONFLICT(slug) DO UPDATE SET device=excluded.device, name=excluded.name,
       active=excluded.active, updated_ts=excluded.updated_ts`
  ).bind(slug, clean(b.device, 20) || "bw16", clean(b.name, 120), b.active === false ? 0 : 1, Date.now()).run();
  return json({ ok: true, slug }, 200, cors);
}

// 管理端上传 bin 到 R2（PUT 原始字节流），并回填注册表 size/sha256
async function uploadPaidBin(slug, file, request, env, cors) {
  if (!/^[a-z0-9][a-z0-9._-]{0,58}$/i.test(slug) || !/^[A-Za-z0-9._-]{1,80}$/.test(file))
    return json({ error: "bad_name" }, 400, cors);
  const reg = await env.DB.prepare("SELECT * FROM paid_fw WHERE slug=?").bind(slug).first();
  if (!reg) return json({ error: "slug_not_registered" }, 404, cors);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) return json({ error: "empty_body" }, 400, cors);
  await env.PICKUP.put(`${slug}/${file}`, buf);
  const files = JSON.parse(reg.files || "{}");
  files[file] = { size: buf.length, sha256: await sha256Hex(buf) };
  await env.DB.prepare("UPDATE paid_fw SET files=?, updated_ts=? WHERE slug=?")
    .bind(JSON.stringify(files), Date.now(), slug).run();
  return json({ ok: true, slug, file, size: buf.length, sha256: files[file].sha256 }, 200, cors);
}

// 公开：取件码 + slug → 一次性取件链接（每文件一条）
async function pickupBegin(request, env, cors) {
  const b = await body(request);
  const code = clean(b.code, 32);
  const slug = clean(b.slug, 60);
  const fp = clean(b.fp, 128);
  if (!code || !slug) return json({ error: "bad_request" }, 400, cors);

  const paid = await env.DB.prepare("SELECT * FROM paid_fw WHERE slug=? AND active=1").bind(slug).first();
  if (!paid) return json({ ok: false, error: "not_available" }, 200, cors);
  const files = JSON.parse(paid.files || "{}");
  const names = Object.keys(files);
  if (!names.length) return json({ ok: false, error: "not_uploaded" }, 200, cors);

  const row = await env.DB.prepare("SELECT * FROM codes WHERE code=?").bind(code).first();
  if (!row || row.status === "disabled") return json({ ok: false, error: "invalid_code" }, 200, cors);
  if (row.slug !== "*" && row.slug !== slug) return json({ ok: false, error: "slug_mismatch" }, 200, cors);
  if (row.status === "redeemed") {
    const withinRetry = row.redeemed_ts && Date.now() - row.redeemed_ts < PICKUP_RETRY_MS;
    if (!withinRetry) return json({ ok: false, error: "already_redeemed", redeemedTs: row.redeemed_ts }, 200, cors);
  } else {
    const r = await env.DB.prepare(
      "UPDATE codes SET status='redeemed', redeemed_ts=? WHERE id=? AND status='unused'"
    ).bind(Date.now(), row.id).run();
    if (!r.meta.changes) return json({ ok: false, error: "already_redeemed" }, 200, cors);
  }

  const expTs = Date.now() + PICKUP_TTL_MS;
  const out = [];
  for (const name of names) {
    const jti = randomHex(16);
    await env.DB.prepare(
      "INSERT INTO pickup_grants (jti, slug, file, code_id, fp, created_ts, exp_ts) VALUES (?,?,?,?,?,?,?)"
    ).bind(jti, slug, name, row.id, fp, Date.now(), expTs).run();
    out.push({ file: name, url: `/pickup/${jti}`, size: files[name].size, sha256: files[name].sha256 });
  }
  return json({ ok: true, slug, name: paid.name, files: out, expTs }, 200, cors);
}

// 公开：一次性核销取件链接，从 R2 回源 bin
async function pickupFetch(jti, url, env, cors) {
  if (!/^[0-9a-f]{32}$/.test(jti)) return json({ error: "bad_request" }, 400, cors);
  const g = await env.DB.prepare("SELECT * FROM pickup_grants WHERE jti=?").bind(jti).first();
  if (!g) return json({ error: "not_found" }, 404, cors);
  if (g.used_ts) return json({ error: "already_used" }, 403, cors);
  if (Date.now() > g.exp_ts) return json({ error: "expired" }, 403, cors);
  if (g.fp) {
    const fp = clean(url.searchParams.get("fp") || "", 128);
    if (fp !== g.fp) return json({ error: "fp_mismatch" }, 403, cors);
  }
  // 先回源后核销：R2 缺件不烧授权；并发取件由条件更新保证只成功一次
  const obj = await env.PICKUP.get(`${g.slug}/${g.file}`);
  if (!obj) return json({ error: "object_missing" }, 404, cors);
  const r = await env.DB.prepare("UPDATE pickup_grants SET used_ts=? WHERE jti=? AND used_ts IS NULL")
    .bind(Date.now(), jti).run();
  if (!r.meta.changes) return json({ error: "already_used" }, 403, cors);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      ...cors,
    },
  });
}
