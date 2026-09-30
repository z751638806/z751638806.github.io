// peipei-flash-api 本地开发服务器（Node ≥22.5，无需 wrangler / Cloudflare 账号）
// 用 node:sqlite 模拟 D1、内存 Map 模拟 R2，把 worker 跑在 http://127.0.0.1:8787。
// 用途：烧录页联调取件链路 —— 页面加 ?api=http://127.0.0.1:8787（不带 mock）。
// 运行：node tools/flash-api/test/devserver.mjs   （同时预置 bw16-19 测试数据与一张取件码）
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "..", "src", "worker.mjs"), "utf-8")
  .replace('import { adminPage } from "./admin.mjs";',
           'const adminPage = () => new Response("<admin>（本地 dev 服务器无后台页）", { headers: { "Content-Type": "text/html; charset=utf-8" } });');
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

// 预置测试数据：注册 bw16-19 + 三个占位镜像 + 一张取件码（打印在控制台）
const call = async (path, opt = {}) => {
  const r = await worker.fetch(new Request(BASE + path, opt), env);
  return r.json();
};
await call("/api/admin/paid", {
  method: "POST", headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ slug: "bw16-19", name: "远程版（本地 dev）", device: "bw16" }),
});
for (const [file, size] of [["km0_boot_all.bin", 4500], ["km4_boot_all.bin", 4456], ["km0_km4_image2.bin", 942080]]) {
  await worker.fetch(new Request(`${BASE}/api/admin/paid/upload/bw16-19/${file}`, {
    method: "PUT", headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
    body: new Uint8Array(size).fill(file.length),
  }), env);
}
const seeded = await call("/api/admin/codes", {
  method: "POST", headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ slug: "bw16-19", count: 1, note: "本地 dev 预置" }),
});

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
  console.log("  预置取件码（bw16-19）:", seeded.codes.join(", "));
  console.log("  烧录页联调：http://127.0.0.1:8765/flash/?api=http://127.0.0.1:8787");
});
