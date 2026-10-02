// peipei-short-link — go.peipeidev.cn 时效短链（Cloudflare Worker + KV，零月费）
// 生成：POST /api/new（Bearer ADMIN_TOKEN）{url, ttlMin=10, alias?} → {ok, slug, url, expTs}
// 跳转：GET /<slug> → 302 目标（Referrer-Policy: no-referrer，Cache-Control: no-store）
//       过期 → 410「链接已失效」；不存在 → 404。KV 按过期时间判断，记录过期 24h 后自动清理。
// 安全：只允许缩短 https://peipeidev.cn 与 www 子域链接（防开放跳转滥用）；生成需 Bearer 认证。
// 部署：cd tools/short-link && npx wrangler deploy（custom_domain 自动建 DNS）

const ALLOWED = /^https:\/\/(www\.)?peipeidev\.cn(\/|$)/;
const SLUG_RE = /^[A-Za-z0-9]{4,16}$/;
const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      // 管理：生成时效短链
      if (path === "/api/new" && request.method === "POST") {
        const h = request.headers.get("Authorization") || "";
        if (!env.ADMIN_TOKEN || h !== "Bearer " + env.ADMIN_TOKEN)
          return json({ error: "unauthorized" }, 401, cors);
        const b = await request.json().catch(() => ({}));
        const target = String(b.url || "");
        if (!ALLOWED.test(target)) return json({ error: "url_not_allowed" }, 400, cors);
        const ttlMin = Math.min(Math.max(Number(b.ttlMin) || 10, 1), 1440);
        const ttlSec = Math.round(ttlMin * 60);
        let slug = String(b.alias || "").trim();
        if (slug) {
          if (!SLUG_RE.test(slug)) return json({ error: "bad_alias" }, 400, cors);
          if (await env.SLUGS.get(`s:${slug}`)) return json({ error: "alias_taken" }, 409, cors);
        } else {
          do { slug = randomSlug(6); } while (await env.SLUGS.get(`s:${slug}`));
        }
        const expTs = Date.now() + ttlSec * 1000;
        await env.SLUGS.put(`s:${slug}`, JSON.stringify({ u: target, expTs }), { expirationTtl: ttlSec + 86400 });
        return json({ ok: true, slug, url: `https://go.peipeidev.cn/${slug}`, expTs, ttlSec }, 200, cors);
      }

      // 跳转（GET/HEAD；302 无响应体，HEAD 同样拿到 Location）
      if ((request.method === "GET" || request.method === "HEAD") && SLUG_RE.test(path.slice(1))) {
        const raw = await env.SLUGS.get(`s:${path.slice(1)}`);
        if (raw) {
          let v;
          try { v = JSON.parse(raw); } catch { v = null; }
          if (v && v.u && Date.now() <= (v.expTs || 0))
            return new Response(null, { status: 302, headers: {
              Location: v.u, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } });
          return gonePage();
        }
        return new Response(notFoundPage(), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response("not found\n", { status: 404 });
    } catch (e) {
      return json({ error: "server", message: String(e && e.message || e) }, 500, cors);
    }
  },
};

function randomSlug(n) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return [...a].map((b) => B62[b % 62]).join("");
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });
}
const shell = (title, msg) => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0e1116;color:#d7dfe8;font:15px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;margin:0}div{text-align:center}b{color:#FB7299;font-size:18px}p{color:#8b97a7;margin-top:8px}</style></head><body><div><b>${title}</b><p>${msg}</p></div></body></html>`;
function gonePage() {
  return new Response(shell("🔗 链接已失效", "该短链已过期或已被使用完毕。请联系分享者重新获取。"),
    { status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
function notFoundPage() {
  return shell("🔗 链接不存在", "短链无效。请核对后重试。");
}
