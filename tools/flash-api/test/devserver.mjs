// peipei-flash-api 本地开发服务器（Node ≥22.5，无需 wrangler / Cloudflare 账号）
// 用 node:sqlite 模拟 D1、内存 Map 模拟 R2，把 worker 跑在 http://127.0.0.1:8787。
// 用途：烧录页/主页联调完整后台 —— 页面加 ?api=http://127.0.0.1:8787（不带 mock）。
// 运行：node tools/flash-api/test/devserver.mjs
// 预置：bw16-19（付费占位镜像）+ 取件码、api 模式目录条目、演示账号 demo / demo12345（额度 3）、
//       一张额度卡密（打印在控制台）、主站 notice 示例。
// 真实固件批量接入：另开终端跑 node tools/flash-api/scripts/sync-catalog.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
// 本地 dev 直接伺服真实后台页（与线上 /admin 同源行为）
const ADMIN_HTML = readFileSync(join(HERE, "..", "src", "admin.html"), "utf-8");
const src = readFileSync(join(HERE, "..", "src", "worker.mjs"), "utf-8")
  .replace('import { adminPage } from "./admin.mjs";',
           'const adminPage = () => new Response(' + JSON.stringify(ADMIN_HTML) + ', { headers: { "Content-Type": "text/html; charset=utf-8" } });');
const tmp = mkdtempSync(join(tmpdir(), "flashapi-dev-"));
const workerPath = join(tmp, "worker.mjs");
writeFileSync(workerPath, src);
const worker = (await import(pathToFileURL(workerPath).href)).default;

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(join(HERE, "..", "schema.sql"), "utf-8"));
const DB = {
  prepare(sql) {
    let params = [];
    return {
      bind(...p) { params = p; return this; },
      async run() {
        const r = db.prepare(sql).run(...params);
        return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      async first() { return db.prepare(sql).get(...params) ?? null; },
      async all() { return { results: db.prepare(sql).all(...params) }; },
    };
  },
};
const store = new Map();
const PICKUP = {
  async put(key, value) { store.set(key, value instanceof Uint8Array ? value : new Uint8Array(value)); },
  async get(key) {
    const v = store.get(key);
    if (!v) return null;
    return { size: v.length, body: new Blob([v]).stream(), arrayBuffer: async () => v.slice().buffer };
  },
};
const env = { DB, PICKUP, ADMIN_TOKEN: process.env.ADMIN_TOKEN || "dev-admin-token" };
const BASE = "http://127.0.0.1:8787";
const AUTH = { Authorization: `Bearer ${env.ADMIN_TOKEN}`, "Content-Type": "application/json" };

// 预置测试数据
const call = async (path, opt = {}) => {
  const r = await worker.fetch(new Request(BASE + path, opt), env);
  return r.json();
};
// 1) M6 付费取件演示：注册 bw16-19 + 三个占位镜像 + 一张取件码
await call("/api/admin/paid", { method: "POST", headers: AUTH, body: JSON.stringify({ slug: "bw16-19", name: "远程版（本地 dev）", device: "bw16" }) });
for (const [file, size] of [["km0_boot_all.bin", 4500], ["km4_boot_all.bin", 4456], ["km0_km4_image2.bin", 942080]]) {
  await worker.fetch(new Request(`${BASE}/api/admin/paid/upload/bw16-19/${file}`, {
    method: "PUT", headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
    body: new Uint8Array(size).fill(file.length),
  }), env);
}
const seeded = await call("/api/admin/codes", { method: "POST", headers: AUTH, body: JSON.stringify({ slug: "bw16-19", count: 1, note: "本地 dev 预置" }) });

// 2) api 模式目录：注册同一 slug 到 catalog_fw（复用上面已上传的存储实体，只补 files 登记）
const reg = await call("/api/admin/paid", { method: "GET", headers: AUTH });
const paid19 = (reg.paid || []).find((p) => p.slug === "bw16-19");
await call("/api/admin/catalog", { method: "POST", headers: AUTH, body: JSON.stringify({
  slug: "bw16-19", device: "bw16", name: "远程版（本地 dev）", sort: 99, active: true,
  files: Object.fromEntries(Object.entries(JSON.parse(paid19?.files || "{}")).map(([f, m]) => [f, { size: m.size, sha256: m.sha256, md5: "", fileId: `bw16-19/${f}` }])),
}) });

// 3) 演示用户 + 额度卡密
const demo = await call("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loginId: "demo", password: "demo12345" }) });
const adj = await call("/api/admin/users/quota", { method: "POST", headers: AUTH, body: JSON.stringify({ id: 1, delta: 2, note: "dev 预置" }) });
const cc = await call("/api/admin/ccodes", { method: "POST", headers: AUTH, body: JSON.stringify({ count: 1, credits: 5, note: "本地 dev 预置" }) });

// 4) 主站内容示例（notice）
await call("/api/admin/site/content", { method: "POST", headers: AUTH, body: JSON.stringify({ key: "notice", data: { text: "本地 dev 预置公告：后台已就绪", href: "" } }) });

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(BASE + req.url, {
      method: req.method,
      headers: req.headers,
      ...(body ? { body: new Uint8Array(body), duplex: "half" } : {}),
    }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) for await (const c of r.body) res.write(c);
    res.end();
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "devserver", message: String(e && e.message || e) }));
  }
}).listen(8787, "127.0.0.1", () => {
  console.log("peipei-flash-api dev server → http://127.0.0.1:8787");
  console.log("  ADMIN_TOKEN:", env.ADMIN_TOKEN);
  console.log("  M6 取件码（bw16-19）:", seeded.codes.join(", "));
  console.log("  演示账号: demo / demo12345（额度 " + (adj.quota ?? demo.quota ?? "?") + "）");
  console.log("  额度卡密（+5 次）:", (cc.codes || []).join(", "));
  console.log("  烧录页联调：http://127.0.0.1:8765/flash/?api=http://127.0.0.1:8787");
  console.log("  真实固件批量接入：node tools/flash-api/scripts/sync-catalog.mjs");
});
