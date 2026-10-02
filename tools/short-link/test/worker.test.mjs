// peipei-short-link 逻辑测试（Node ≥22，直接驱动 worker.fetch，KV 用带过期的内存 Map 模拟）
// 运行：node tools/short-link/test/worker.test.mjs
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "shortlink-test-"));
const workerPath = join(tmp, "worker.mjs");
writeFileSync(workerPath, (await import("node:fs")).readFileSync(join(HERE, "..", "src", "worker.mjs"), "utf-8"));
const worker = (await import(pathToFileURL(workerPath).href)).default;

// KV 模拟：put 记录 expirationTtl（与线上一致：记录比链接时效多留 24h），get 检查记录死亡
function makeKV() {
  const store = new Map();
  return {
    store,
    async put(k, v, { expirationTtl } = {}) { store.set(k, { v, dieAt: Date.now() + (expirationTtl || 60) * 1000 }); },
    async get(k) { const e = store.get(k); if (!e || Date.now() > e.dieAt) return null; return e.v; },
  };
}
let passed = 0, failed = 0;
const ok = (c, n) => { c ? passed++ : failed++; console.log(`  ${c ? "✓" : "✗"} ${n}`); };
const req = (path, { method = "GET", body, token } = {}) =>
  new Request(`https://go.peipeidev.cn${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const env = { SLUGS: makeKV(), ADMIN_TOKEN: "test-token" };
const T = "test-token";

console.log("管理 API");
ok((await (await worker.fetch(req("/api/new", { method: "POST", body: { url: "https://peipeidev.cn/flash/" } }), env))).status === 401, "无 token 401");
ok((await (await worker.fetch(req("/api/new", { method: "POST", token: T, body: { url: "https://evil.example.com/" } }), env))).status === 400, "非 peipeidev 域名拒绝");
ok((await (await worker.fetch(req("/api/new", { method: "POST", token: T, body: { url: "http://peipeidev.cn/flash/" } }), env))).status === 400, "非 https 拒绝");
ok((await (await worker.fetch(req("/api/new", { method: "POST", token: T, body: { url: "https://peipeidev.cn/flash/", alias: "a b" } }), env))).status === 400, "非法别名拒绝");
ok((await (await worker.fetch(req("/api/new", { method: "POST", token: T, body: { url: "https://peipeidev.cn/flash/", alias: "flash" } }), env))).status === 200, "自定义别名成功");
ok((await (await worker.fetch(req("/api/new", { method: "POST", token: T, body: { url: "https://peipeidev.cn/flash/", alias: "flash" } }), env))).status === 409, "别名重复 409");

console.log("跳转与时效");
const created = await (await worker.fetch(req("/api/new", { method: "POST", token: T, body: { url: "https://peipeidev.cn/flash/", ttlMin: 10 } }), env)).json();
ok(created.ok && /^https:\/\/go\.peipeidev\.cn\/[A-Za-z0-9]{6}$/.test(created.url), "随机 6 位短链生成");
const r1 = await worker.fetch(req("/" + created.slug), env);
ok(r1.status === 302 && r1.headers.get("Location") === "https://peipeidev.cn/flash/", "有效期内 302 到目标");
const r1h = await worker.fetch(req("/" + created.slug, { method: "HEAD" }), env);
ok(r1h.status === 302 && r1h.headers.get("Location") === "https://peipeidev.cn/flash/", "HEAD 同样 302（链接预览探测）");
ok(r1.headers.get("Referrer-Policy") === "no-referrer", "no-referrer（匿名隐藏来源）");
// 过期路径：生成 ttl=1min 链接后，把存储里的 expTs 拨到过去（等价时间流逝；
// 线上 KV 记录仍存在 24h，worker 依据 expTs 判断返回 410）
const expKV = makeKV();
const expEnv = { SLUGS: expKV, ADMIN_TOKEN: T };
const gone = await (await worker.fetch(req("/api/new", { method: "POST", token: T, body: { url: "https://peipeidev.cn/flash/", ttlMin: 1 } }), expEnv)).json();
expKV.store.forEach((e) => {
  const v = JSON.parse(e.v);
  v.expTs = Date.now() - 1000;
  e.v = JSON.stringify(v);
});
const r2 = await worker.fetch(req("/" + gone.slug), expEnv);
ok(r2.status === 410 && (await r2.text()).includes("链接已失效"), "过期 410 提示页");
ok((await worker.fetch(req("/zzzzzz"), env)).status === 404, "随机 slug 404");

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed) process.exit(1);
