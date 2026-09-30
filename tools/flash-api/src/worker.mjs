// peipei-flash-api — peipeidev.cn 网站后台 API（Cloudflare Worker + D1 + KV/R2）
// v2 完整后台：在 M5 统计/反馈/公告/激活码、M6 付费取件之上，新增 backend.js 契约全套：
//   用户注册/登录/额度（/api/auth/*，cookie 会话）/ 固件目录下发（/api/catalog）/
//   刷写会话与一次性镜像链接（/api/flash/begin|file|end，失败退额度）/ 额度卡密（/api/redeem v2）/
//   主站内容（/api/site/content，主页水合）；管理台新增 用户/卡密/固件目录/主站内容。
// 契约要点（与 flash/js/backend.js 逐字段对齐，勿随意改动）：
//   - /api/health 的 service 必须为 "bw16-flash-api"（前端握手判定 api 模式）
//   - 错误响应体为 {detail:"…"}（前端读 detail 展示）；未登录 401（前端转登录框）
//   - /api/flash/begin 返回 files 为 {文件名: 链接} 对象，链接必须自带 "?…"（前端追加 &fp=）
// 部署：cd tools/flash-api && HTTPS_PROXY=… npx wrangler deploy
//       wrangler d1 execute peipei-flash-db --remote --file schema.sql   （幂等，先建新表）
// 管理：Header Authorization: Bearer <ADMIN_TOKEN secret>

import { adminPage } from "./admin.mjs";

const PICKUP_TTL_MS = 10 * 60 * 1000;      // M6 取件链接有效期
const PICKUP_RETRY_MS = 24 * 60 * 60 * 1000; // 已核销取件码的重试窗口（刷写失败重下）
const FLASH_TTL_MS = 120 * 1000;           // api 模式镜像一次性链接有效期（前端提示 60s，取更长更安全）
const SESSION_TTL_SEC = 30 * 86400;        // 登录会话 cookie 有效期
const PBKDF2_ITER = 25000;                 // 密码哈希迭代（Workers 免费档 CPU 预算内；8 位以上密码 + 独立盐）
const REGISTER_BONUS = 1;                  // 注册赠送刷写额度

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    // 带 Origin 的请求回显 origin 并允许凭据（backend.js 全部 credentials:"include"；
    // 同源请求浏览器忽略这些头，跨域 ?api= 联调也能带上 cookie）
    const origin = request.headers.get("Origin");
    const cors = {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
      ...(origin ? { "Access-Control-Allow-Credentials": "true" } : {}),
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "POST" && request.method !== "PUT")
      return json({ error: "method" }, 405, cors);

    try {
      if (path === "/api/health")
        return json({ ok: true, service: "bw16-flash-api", legacyService: "peipei-flash-api", ts: Date.now() }, 200, cors);
      if (path === "/admin") return adminPage();
      // 公开：激活码核销（设备端 Web 后台调用）——M5
      if (path === "/api/redeem" && request.method === "POST") return await redeemCode(request, env, cors);
      if (path === "/api/event" && request.method === "POST") return await reportEvent(request, env, cors);
      if (path === "/api/feedback" && request.method === "POST") return await postFeedback(request, env, cors);
      if (path === "/api/announcements") return await listAnnouncements(env, cors);
      // 公开：付费固件取件——M6（备用机制，保留兼容）
      if (path === "/api/pickup/begin" && request.method === "POST") return await pickupBegin(request, env, cors);
      if (path.startsWith("/pickup/") && request.method === "GET") return await pickupFetch(path.slice("/pickup/".length), url, env, cors);
      // ---- v2 完整后台：backend.js 契约 ----
      if (path === "/api/session" && request.method === "POST") return json({ ok: true, mode: "api" }, 200, cors);
      if (path === "/api/auth/register" && request.method === "POST") return await authRegister(request, env, cors);
      if (path === "/api/auth/login" && request.method === "POST") return await authLogin(request, env, cors);
      if (path === "/api/auth/logout" && request.method === "POST") return await authLogout(request, env, cors);
      if (path === "/api/auth/me" && request.method === "GET") return await authMe(request, env, cors);
      if (path === "/api/catalog" && request.method === "GET") return await getCatalog(env, cors);
      if (path === "/api/flash/begin" && request.method === "POST") return await flashBegin(request, env, cors);
      if (path === "/api/flash/file" && request.method === "GET") return await flashFile(url, env, cors);
      if (path === "/api/flash/end" && request.method === "POST") return await flashEnd(request, env, cors);
      if (path === "/api/site/content" && request.method === "GET") return await getSiteContent(env, cors);

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
        // ---- v2：用户 / 卡密 / 固件目录 / 主站内容 ----
        if (path === "/api/admin/users" && request.method === "GET") return await listUsers(env, url, cors);
        if (path === "/api/admin/users/quota" && request.method === "POST") return await adjustUserQuota(request, env, cors);
        if (path === "/api/admin/users/status" && request.method === "POST") return await setUserStatus(request, env, cors);
        if (path === "/api/admin/users/reset-pw" && request.method === "POST") return await resetUserPw(request, env, cors);
        if (path === "/api/admin/ccodes" && request.method === "GET") return await listCreditCodes(env, url, cors);
        if (path === "/api/admin/ccodes" && request.method === "POST") return await genCreditCodes(request, env, cors);
        if (path === "/api/admin/ccodes/disable" && request.method === "POST") return await disableCreditCode(request, env, cors);
        if (path === "/api/admin/catalog" && request.method === "GET") return await listCatalogAdmin(env, cors);
        if (path === "/api/admin/catalog" && request.method === "POST") return await upsertCatalog(request, env, cors);
        if (path.startsWith("/api/admin/catalog/upload/") && request.method === "PUT") {
          const rest = path.slice("/api/admin/catalog/upload/".length);
          const slash = rest.indexOf("/");
          if (slash > 0 && slash < rest.length - 1)
            return await uploadCatalogBin(decodeURIComponent(rest.slice(0, slash)), decodeURIComponent(rest.slice(slash + 1)), request, env, cors);
          return json({ error: "bad_request" }, 400, cors);
        }
        if (path === "/api/admin/site/content" && request.method === "GET") return await getSiteContent(env, cors);
        if (path === "/api/admin/site/content" && request.method === "POST") return await saveSiteContent(request, env, cors);
        return json({ error: "not_found" }, 404, cors);
      }
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      return json({ error: "server", message: String(e && e.message || e) }, 500, cors);
    }
  },
};

function json(obj, status, cors, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extraHeaders },
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

/* ---------- 公开：用户反馈（v2 契约 {type,body,sessionPublicId,extra}；旧 {message,contact,log} 兼容） ---------- */
async function postFeedback(request, env, cors) {
  const b = await body(request);
  const message = clean(typeof b.body === "string" && b.body ? b.body : b.message, 2000);
  if (!message || message.length < 5) return json({ detail: "反馈内容太短（至少 5 字）" }, 400, cors);
  const user = await userFromCookie(request, env).catch(() => null);
  const type = clean(b.type, 20) || "feedback";
  const contact = clean(b.contact, 120) || (user ? `${user.login_id} · ${type}` : type);
  const meta = { ...(b.sessionPublicId ? { sessionPublicId: b.sessionPublicId } : {}), ...(b.extra && typeof b.extra === "object" ? b.extra : {}) };
  const log = clean(b.log, 4000) ?? (Object.keys(meta).length ? JSON.stringify(meta).slice(0, 4000) : null);
  await env.DB.prepare(
    "INSERT INTO feedback (ts, contact, message, log) VALUES (?,?,?,?)"
  ).bind(Date.now(), contact, message, log).run();
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
/* ---------- 公开：卡密核销（v2 额度卡密优先，M6 取件码回落原语义） ---------- */
async function redeemCode(request, env, cors) {
  const b = await body(request);
  const code = clean(b.code, 40);
  const slug = clean(b.slug, 60);
  if (!code) return json({ error: "bad_request" }, 400, cors);
  // 1) v2 额度卡密：需登录，核销后加刷写额度（契约：{credited, quota}；错误 {detail} + 非 200）
  const cc = await env.DB.prepare("SELECT * FROM credit_codes WHERE code=?").bind(code).first();
  if (cc) {
    const user = await userFromCookie(request, env);
    if (!user) return json({ detail: "请先登录后再兑换卡密" }, 401, cors);
    if (cc.status === "disabled") return json({ detail: "卡密已禁用" }, 400, cors);
    if (cc.status !== "unused") return json({ detail: "卡密已被使用" }, 400, cors);
    const r = await env.DB.prepare(
      "UPDATE credit_codes SET status='redeemed', redeemed_ts=?, redeemed_by=? WHERE id=? AND status='unused'"
    ).bind(Date.now(), user.id, cc.id).run();
    if (!r.meta.changes) return json({ detail: "卡密已被使用" }, 400, cors);
    const quota = await addQuota(env, user.id, cc.credits, `card:${code.slice(0, 6)}`);
    return json({ ok: true, credited: cc.credits, quota }, 200, cors);
  }
  // 2) M6 取件码（codes 表）：保持 M5 原语义（设备端 Web 后台调用，200 + {ok,error}）
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

// 管理端上传 bin 到存储（PUT 原始字节流），并回填注册表 size/sha256
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

// 兼容 KV 与 R2 两种存储的读取：KV get 返回值本身，R2 get 返回带 body 的对象
async function readPickupBlob(store, key) {
  const obj = await store.get(key, { type: "arrayBuffer" });
  if (!obj) return null;
  return typeof obj.arrayBuffer === "function" ? await obj.arrayBuffer() : obj;
}

// 公开：一次性核销取件链接，从存储回源 bin
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
  // 先回源后核销：存储缺件不烧授权；并发取件由条件更新保证只成功一次
  const data = await readPickupBlob(env.PICKUP, `${g.slug}/${g.file}`);
  if (!data) return json({ error: "object_missing" }, 404, cors);
  const r = await env.DB.prepare("UPDATE pickup_grants SET used_ts=? WHERE jti=? AND used_ts IS NULL")
    .bind(Date.now(), jti).run();
  if (!r.meta.changes) return json({ error: "already_used" }, 403, cors);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      ...cors,
    },
  });
}

/* ==================== v2 完整后台 ==================== */

/* ---------- 会话：HMAC 签名 cookie（无状态，密钥 SESSION_SECRET 或回落 ADMIN_TOKEN） ---------- */
const COOKIE = "peipei_s";
function hex(u8) { return [...u8].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function hmacKey(env) {
  const secret = env.SESSION_SECRET || env.ADMIN_TOKEN || "dev-insecure-secret";
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function signSession(env, uid) {
  const payload = `${uid}.${Date.now() + SESSION_TTL_SEC * 1000}`;
  const sig = hex(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(payload))));
  return `${payload}.${sig}`;
}
async function sessionUid(request, env) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 3) return null;
  const expect = hex(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))));
  if (!timingSafeEq(parts[2], expect)) return null;
  if (Date.now() > Number(parts[1])) return null;
  const uid = Number(parts[0]);
  return Number.isInteger(uid) && uid > 0 ? uid : null;
}
async function userFromCookie(request, env) {
  const uid = await sessionUid(request, env);
  if (!uid) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(uid).first();
  return u && u.status === "active" ? u : null;
}
function sessionCookieHeader(request, value, maxAgeSec) {
  const url = new URL(request.url);
  // https 或 localhost：SameSite=None; Secure（同源/跨域 ?api= 联调都能带上）；其余 http 内网：Lax
  const secureMode = url.protocol === "https:" || /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url.hostname);
  return `${COOKIE}=${value}; Path=/; HttpOnly; Max-Age=${maxAgeSec}; ${secureMode ? "SameSite=None; Secure" : "SameSite=Lax"}`;
}

/* ---------- 密码：PBKDF2-SHA256（格式 pbkdf2$iter$salt$hash，迭代数随行存储便于整体升级） ---------- */
async function pbkdf2Bits(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, key, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${hex(salt)}$${hex(await pbkdf2Bits(password, salt, PBKDF2_ITER))}`;
}
async function verifyPassword(password, stored) {
  const [alg, iterStr, saltHex, hashHex] = String(stored || "").split("$");
  if (alg !== "pbkdf2" || !iterStr || !saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const expect = new Uint8Array(hashHex.match(/../g).map((h) => parseInt(h, 16)));
  return timingSafeEq(await pbkdf2Bits(password, salt, Number(iterStr)), expect);
}

/* ---------- 额度：唯一改动入口，全部留痕 quota_log ---------- */
async function addQuota(env, userId, delta, reason) {
  if (delta >= 0) {
    await env.DB.prepare("UPDATE users SET quota=quota+? WHERE id=?").bind(delta, userId).run();
  } else {
    const r = await env.DB.prepare("UPDATE users SET quota=quota+? WHERE id=? AND quota+? >= 0").bind(delta, userId, delta).run();
    if (!r.meta.changes) throw new Error("quota_underflow");
  }
  await env.DB.prepare("INSERT INTO quota_log (user_id, delta, reason, ts) VALUES (?,?,?,?)").bind(userId, delta, reason, Date.now()).run();
  const u = await env.DB.prepare("SELECT quota FROM users WHERE id=?").bind(userId).first();
  return u ? u.quota : 0;
}

/* ---------- 认证四件套（契约：成功 {ok,loginId,quota}；失败 {detail} + 4xx；me 未登录 401） ---------- */
async function authRegister(request, env, cors) {
  const b = await body(request);
  const loginId = (clean(b.loginId, 40) || "").trim();
  const password = typeof b.password === "string" ? b.password : "";
  if (!loginId || !/^[A-Za-z0-9_.@-]{3,32}$/.test(loginId))
    return json({ detail: "登录标识需为 3-32 位字母/数字/_.@-" }, 400, cors);
  if (password.length < 8 || password.length > 72) return json({ detail: "密码需 8-72 位" }, 400, cors);
  const exists = await env.DB.prepare("SELECT id FROM users WHERE login_id=?").bind(loginId).first();
  if (exists) return json({ detail: "该登录标识已被注册" }, 409, cors);
  const r = await env.DB.prepare("INSERT INTO users (login_id, pw_hash, quota, created_ts, last_login_ts) VALUES (?,?,?,?,?)")
    .bind(loginId, await hashPassword(password), REGISTER_BONUS, Date.now(), Date.now()).run();
  await env.DB.prepare("INSERT INTO quota_log (user_id, delta, reason, ts) VALUES (?,?,?,?)")
    .bind(r.meta.last_row_id, REGISTER_BONUS, "register", Date.now()).run();
  return json({ ok: true, loginId, quota: REGISTER_BONUS }, 200, cors,
    { "Set-Cookie": sessionCookieHeader(request, await signSession(env, r.meta.last_row_id), SESSION_TTL_SEC) });
}
async function authLogin(request, env, cors) {
  const b = await body(request);
  const loginId = (clean(b.loginId, 40) || "").trim();
  const password = typeof b.password === "string" ? b.password : "";
  const u = loginId ? await env.DB.prepare("SELECT * FROM users WHERE login_id=?").bind(loginId).first() : null;
  if (!u || !(await verifyPassword(password, u.pw_hash)))
    return json({ detail: "登录标识或密码不正确" }, 401, cors);
  if (u.status !== "active") return json({ detail: "账号已被禁用" }, 403, cors);
  await env.DB.prepare("UPDATE users SET last_login_ts=? WHERE id=?").bind(Date.now(), u.id).run();
  return json({ ok: true, loginId: u.login_id, quota: u.quota }, 200, cors,
    { "Set-Cookie": sessionCookieHeader(request, await signSession(env, u.id), SESSION_TTL_SEC) });
}
async function authLogout(request, env, cors) {
  return json({ ok: true }, 200, cors, { "Set-Cookie": sessionCookieHeader(request, "", 0) });
}
async function authMe(request, env, cors) {
  const user = await userFromCookie(request, env);
  if (!user) return json({ detail: "未登录" }, 401, cors);
  return json({ ok: true, loginId: user.login_id, quota: user.quota, role: user.role }, 200, cors);
}

/* ---------- 固件目录（catalog_fw → backend.js apiCatalogToManifest 契约） ---------- */
function safeParseObj(s) { try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } }
async function getCatalog(env, cors) {
  const { results } = await env.DB.prepare("SELECT * FROM catalog_fw WHERE active=1 ORDER BY sort, slug").all();
  const firmware = (results || []).map((r) => ({
    slug: r.slug, name: r.name, color: r.color || "", colorLabel: r.color_label || "",
    colorCss: r.color_css || "", device: r.device || "bw16", version: r.version || "",
    sourcePath: r.source_path || "线上目录", attribution: r.attribution || "",
    files: safeParseObj(r.files),
  }));
  return json({ ok: true, generatedAt: new Date().toISOString(), device: "bw16", firmware }, 200, cors);
}

/* ---------- 刷写会话：登录 + 额度 → 一次性镜像链接（失败/中止退额度） ---------- */
async function flashBegin(request, env, cors) {
  const b = await body(request);
  const slug = clean(b.slug, 60);
  const fp = clean(b.fingerprint, 128);
  if (!slug) return json({ detail: "缺少固件 slug" }, 400, cors);
  const user = await userFromCookie(request, env);
  if (!user) return json({ detail: "请先登录后再刷写" }, 401, cors);
  const fw = await env.DB.prepare("SELECT * FROM catalog_fw WHERE slug=? AND active=1").bind(slug).first();
  if (!fw) return json({ detail: "固件不存在或未上架" }, 404, cors);
  const files = safeParseObj(fw.files);
  if (!Object.keys(files).length) return json({ detail: "固件镜像未上传" }, 404, cors);
  const charged = await env.DB.prepare("UPDATE users SET quota=quota-1 WHERE id=? AND quota>0").bind(user.id).run();
  if (!charged.meta.changes) return json({ detail: "额度不足，请兑换卡密或联系站长" }, 403, cors);
  await env.DB.prepare("INSERT INTO quota_log (user_id, delta, reason, ts) VALUES (?,?,?,?)")
    .bind(user.id, -1, `flash:${slug}`, Date.now()).run();
  const sessionId = randomHex(16);
  const expTs = Date.now() + FLASH_TTL_MS;
  await env.DB.prepare("INSERT INTO flash_sessions (session_id, user_id, slug, fp, quota_charged, created_ts) VALUES (?,?,?,?,1,?)")
    .bind(sessionId, user.id, slug, fp, Date.now()).run();
  const out = {};
  for (const name of Object.keys(files)) {
    const jti = randomHex(16);
    await env.DB.prepare("INSERT INTO flash_grants (jti, session_id, slug, file, user_id, fp, created_ts, exp_ts) VALUES (?,?,?,?,?,?,?,?)")
      .bind(jti, sessionId, slug, name, user.id, fp, Date.now(), expTs).run();
    out[name] = `/api/flash/file?g=${jti}`;   // 必须自带 ?，前端会追加 &fp=
  }
  return json({ ok: true, flashSessionId: sessionId, slug, name: fw.name, files: out, expTs }, 200, cors);
}
async function flashFile(url, env, cors) {
  const g = url.searchParams.get("g") || "";
  if (!/^[0-9a-f]{32}$/.test(g)) return json({ detail: "bad_request" }, 400, cors);
  const row = await env.DB.prepare("SELECT * FROM flash_grants WHERE jti=?").bind(g).first();
  if (!row) return json({ detail: "链接不存在" }, 404, cors);
  if (row.used_ts) return json({ detail: "链接已使用" }, 403, cors);
  if (Date.now() > row.exp_ts) return json({ detail: "链接已过期，请重新刷写" }, 403, cors);
  if (row.fp) {
    const fp = clean(url.searchParams.get("fp") || "", 128);
    if (fp !== row.fp) return json({ detail: "指纹不匹配" }, 403, cors);
  }
  const data = await readPickupBlob(env.PICKUP, `${row.slug}/${row.file}`);
  if (!data) return json({ detail: "镜像缺失" }, 404, cors);
  const r = await env.DB.prepare("UPDATE flash_grants SET used_ts=? WHERE jti=? AND used_ts IS NULL").bind(Date.now(), g).run();
  if (!r.meta.changes) return json({ detail: "链接已使用" }, 403, cors);
  return new Response(data, { status: 200, headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", ...cors } });
}
async function flashEnd(request, env, cors) {
  const b = await body(request);
  const sid = clean(b.flashSessionId, 64);
  if (!sid) return json({ detail: "缺少会话 id" }, 400, cors);
  const s = await env.DB.prepare("SELECT * FROM flash_sessions WHERE session_id=?").bind(sid).first();
  if (!s) return json({ detail: "会话不存在" }, 404, cors);
  const result = ["success", "failed", "aborted"].includes(b.result) ? b.result : "failed";
  const first = await env.DB.prepare("UPDATE flash_sessions SET ended_ts=?, result=? WHERE session_id=? AND ended_ts IS NULL")
    .bind(Date.now(), result, sid).run();
  if (first.meta.changes) {
    const fw = await env.DB.prepare("SELECT name, device FROM catalog_fw WHERE slug=?").bind(s.slug).first();
    await env.DB.prepare("INSERT INTO flash_events (ts, device, firmware, success, duration_s, err) VALUES (?,?,?,?,?,?)")
      .bind(Date.now(), fw?.device || "BW16", fw?.name || s.slug, result === "success" ? 1 : 0,
        Number(b.durationS) || null, result === "success" ? null : clean(b.failStage, 200)).run();
    // 失败/中止不白扣：退还本次额度
    if (result !== "success" && s.quota_charged > 0 && s.user_id)
      await addQuota(env, s.user_id, s.quota_charged, `refund:${s.slug}`).catch(() => {});
  }
  return json({ ok: true }, 200, cors);
}

/* ---------- 主站内容（key → JSON 块；主页水合脚本消费，静态内容兜底） ---------- */
async function getSiteContent(env, cors) {
  const { results } = await env.DB.prepare("SELECT key, data, updated_ts FROM site_content").all();
  const content = {}, updatedAt = {};
  for (const r of results || []) {
    try { content[r.key] = JSON.parse(r.data); } catch { content[r.key] = null; }
    updatedAt[r.key] = r.updated_ts;
  }
  return json({ ok: true, content, updatedAt }, 200, cors);
}
async function saveSiteContent(request, env, cors) {
  const b = await body(request);
  const key = clean(b.key, 40);
  if (!key || !/^[a-z_]{1,40}$/.test(key)) return json({ error: "bad_key" }, 400, cors);
  if (b.data === null) {
    await env.DB.prepare("DELETE FROM site_content WHERE key=?").bind(key).run();
    return json({ ok: true, key, deleted: true }, 200, cors);
  }
  const data = typeof b.data === "string" ? b.data : JSON.stringify(b.data);
  if (!data || data.length > 65536) return json({ error: "bad_data" }, 400, cors);
  JSON.parse(data);   // 必须是合法 JSON，否则 500 前先拒绝
  await env.DB.prepare(
    "INSERT INTO site_content (key, data, updated_ts) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_ts=excluded.updated_ts"
  ).bind(key, data, Date.now()).run();
  return json({ ok: true, key }, 200, cors);
}

/* ---------- 管理：用户 ---------- */
async function listUsers(env, url, cors) {
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
  const q = clean(url.searchParams.get("q"), 40);
  const rows = q
    ? await env.DB.prepare("SELECT id, login_id, quota, status, role, created_ts, last_login_ts FROM users WHERE login_id LIKE ? ORDER BY id DESC LIMIT ?").bind(`%${q}%`, limit).all()
    : await env.DB.prepare("SELECT id, login_id, quota, status, role, created_ts, last_login_ts FROM users ORDER BY id DESC LIMIT ?").bind(limit).all();
  const total = await env.DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(quota),0) q FROM users").first();
  return json({ users: rows.results || [], total: total || { n: 0, q: 0 } }, 200, cors);
}
async function adjustUserQuota(request, env, cors) {
  const b = await body(request);
  const id = Number(b.id), delta = Number(b.delta);
  if (!id || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10000)
    return json({ error: "bad_request" }, 400, cors);
  const u = await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(id).first();
  if (!u) return json({ error: "not_found" }, 404, cors);
  try {
    const quota = await addQuota(env, id, delta, `admin:${clean(b.note, 100) || "manual"}`);
    return json({ ok: true, id, quota }, 200, cors);
  } catch {
    return json({ error: "quota_underflow" }, 400, cors);
  }
}
async function setUserStatus(request, env, cors) {
  const b = await body(request);
  const id = Number(b.id), status = b.status === "disabled" ? "disabled" : "active";
  if (!id) return json({ error: "bad_request" }, 400, cors);
  const r = await env.DB.prepare("UPDATE users SET status=? WHERE id=?").bind(status, id).run();
  if (!r.meta.changes) return json({ error: "not_found" }, 404, cors);
  return json({ ok: true, id, status }, 200, cors);
}
async function resetUserPw(request, env, cors) {
  const b = await body(request);
  const id = Number(b.id), password = typeof b.password === "string" ? b.password : "";
  if (!id || password.length < 8 || password.length > 72) return json({ error: "bad_request" }, 400, cors);
  const r = await env.DB.prepare("UPDATE users SET pw_hash=? WHERE id=?").bind(await hashPassword(password), id).run();
  if (!r.meta.changes) return json({ error: "not_found" }, 404, cors);
  return json({ ok: true, id }, 200, cors);
}

/* ---------- 管理：额度卡密（credit_codes，与 M6 取件码独立） ---------- */
async function genCreditCodes(request, env, cors) {
  const b = await body(request);
  const count = Math.min(Number(b.count) || 1, 100);
  const credits = Math.min(Math.max(Number(b.credits) || 1, 1), 1000);
  const note = clean(b.note, 200);
  const out = [];
  for (let i = 0; i < count; i++) {
    const code = genCode();
    await env.DB.prepare("INSERT INTO credit_codes (code, credits, note, created_ts) VALUES (?,?,?,?)")
      .bind(code, credits, note, Date.now()).run();
    out.push(code);
  }
  return json({ ok: true, codes: out, credits }, 200, cors);
}
async function listCreditCodes(env, url, cors) {
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
  const { results } = await env.DB.prepare("SELECT * FROM credit_codes ORDER BY id DESC LIMIT ?").bind(limit).all();
  return json({ codes: results || [] }, 200, cors);
}
async function disableCreditCode(request, env, cors) {
  const b = await body(request);
  if (!b.id && !b.code) return json({ error: "bad_request" }, 400, cors);
  if (b.id) await env.DB.prepare("UPDATE credit_codes SET status='disabled' WHERE id=?").bind(b.id).run();
  else await env.DB.prepare("UPDATE credit_codes SET status='disabled' WHERE code=?").bind(b.code).run();
  return json({ ok: true }, 200, cors);
}

/* ---------- 管理：固件目录 ---------- */
async function listCatalogAdmin(env, cors) {
  const { results } = await env.DB.prepare("SELECT * FROM catalog_fw ORDER BY sort, slug").all();
  return json({ catalog: results || [] }, 200, cors);
}
async function upsertCatalog(request, env, cors) {
  const b = await body(request);
  const slug = clean(b.slug, 60);
  if (!slug || !/^[a-z0-9][a-z0-9._-]{0,58}$/i.test(slug)) return json({ error: "bad_slug" }, 400, cors);
  const prev = await env.DB.prepare("SELECT files FROM catalog_fw WHERE slug=?").bind(slug).first();
  // files 只在显式传入时整体替换，否则保留已上传登记（避免控制台改名清掉清单）
  const files = b.files !== undefined ? JSON.stringify(b.files) : (prev?.files || "{}");
  await env.DB.prepare(
    `INSERT INTO catalog_fw (slug, device, name, color, color_label, color_css, version, source_path, attribution, sort, files, active, updated_ts)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(slug) DO UPDATE SET device=excluded.device, name=excluded.name, color=excluded.color,
       color_label=excluded.color_label, color_css=excluded.color_css, version=excluded.version,
       source_path=excluded.source_path, attribution=excluded.attribution, sort=excluded.sort,
       files=excluded.files, active=excluded.active, updated_ts=excluded.updated_ts`
  ).bind(slug, clean(b.device, 20) || "bw16", clean(b.name, 120) || slug, clean(b.color, 20),
    clean(b.colorLabel, 40), clean(b.colorCss, 40), clean(b.version, 40), clean(b.sourcePath, 120),
    clean(b.attribution, 200), Number(b.sort) || 0, files, b.active === false ? 0 : 1, Date.now()).run();
  return json({ ok: true, slug }, 200, cors);
}
// 目录固件 bin 上传（与 paid 上传同款：存 PICKUP、回填 size/sha256）
async function uploadCatalogBin(slug, file, request, env, cors) {
  if (!/^[a-z0-9][a-z0-9._-]{0,58}$/i.test(slug) || !/^[A-Za-z0-9._-]{1,80}$/.test(file))
    return json({ error: "bad_name" }, 400, cors);
  const reg = await env.DB.prepare("SELECT * FROM catalog_fw WHERE slug=?").bind(slug).first();
  if (!reg) return json({ error: "slug_not_registered" }, 404, cors);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) return json({ error: "empty_body" }, 400, cors);
  await env.PICKUP.put(`${slug}/${file}`, buf);
  const files = safeParseObj(reg.files);
  files[file] = { size: buf.length, sha256: await sha256Hex(buf), md5: "", fileId: `${slug}/${file}` };
  await env.DB.prepare("UPDATE catalog_fw SET files=?, updated_ts=? WHERE slug=?")
    .bind(JSON.stringify(files), Date.now(), slug).run();
  return json({ ok: true, slug, file, size: buf.length, sha256: files[file].sha256 }, 200, cors);
}
