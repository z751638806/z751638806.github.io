// peipei-flash-api Worker 逻辑测试（Node ≥22.5，无需网络与 Cloudflare 账号）
// 用 node:sqlite 模拟 D1、内存 Map 模拟 R2，直接驱动 worker 的 fetch 处理器。
// 运行：node tools/flash-api/test/worker.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

// worker.mjs 通过 wrangler 的 Text rule import admin.html，Node 不支持 → 打临时副本替换掉
const src = readFileSync(join(SRC, "worker.mjs"), "utf-8")
  .replace('import { adminPage } from "./admin.mjs";',
           'const adminPage = () => new Response("<admin>", { headers: { "Content-Type": "text/html" } });');
const tmp = mkdtempSync(join(tmpdir(), "flashapi-test-"));
const workerPath = join(tmp, "worker.mjs");
writeFileSync(workerPath, src);
const worker = (await import(pathToFileURL(workerPath).href)).default;

/* ---------- D1 模拟（node:sqlite） ---------- */
function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(HERE, "..", "schema.sql"), "utf-8"));
  return {
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
}

/* ---------- R2 模拟 ---------- */
function makeR2() {
  const store = new Map();
  return {
    async put(key, value) { store.set(key, value instanceof Uint8Array ? value : new Uint8Array(value)); },
    async get(key) {
      const v = store.get(key);
      if (!v) return null;
      return { size: v.length, body: new Blob([v]).stream(), arrayBuffer: async () => v.slice().buffer };
    },
  };
}

/* ---------- 断言小工具 ---------- */
let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
const req = (path, { method = "GET", body, token, headers = {} } = {}) =>
  new Request(`https://admin.peipeidev.cn${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
const j = (r) => r.json();

async function main() {
  const env = { DB: makeD1(), PICKUP: makeR2(), ADMIN_TOKEN: "test-token" };
  const T = "test-token";

  console.log("基础路由");
  ok((await j(await worker.fetch(req("/api/health"), env))).ok === true, "health 正常");
  ok((await worker.fetch(req("/admin"), env)).status === 200, "/admin 页面可达");
  ok((await j(await worker.fetch(req("/api/admin/stats"), env))).error === "unauthorized", "管理接口无 token 拒绝");

  console.log("M6 管理面：注册 / 上传 / 取件码");
  ok((await j(await worker.fetch(req("/api/admin/paid", { method: "POST", token: T, body: { slug: "bw16-19", name: "远程版", device: "bw16" } }), env))).ok, "注册付费固件");
  const binA = new Uint8Array(1024).map((_, i) => i & 0xff);
  const up = await worker.fetch(req("/api/admin/paid/upload/bw16-19/km0_boot_all.bin", { method: "PUT", token: T }), env);
  ok(up.status === 400, "空 body 上传被拒绝");
  const up1 = await worker.fetch(new Request("https://admin.peipeidev.cn/api/admin/paid/upload/bw16-19/km0_boot_all.bin",
    { method: "PUT", headers: { Authorization: `Bearer ${T}` }, body: binA }), env);
  const up1d = await j(up1);
  ok(up1d.ok && up1d.size === 1024, "上传 bin 到 R2 成功（size 回填）");
  const binB = new Uint8Array(2048).fill(7);
  const up2 = await j(await worker.fetch(new Request("https://admin.peipeidev.cn/api/admin/paid/upload/bw16-19/km4_boot_all.bin",
    { method: "PUT", headers: { Authorization: `Bearer ${T}` }, body: binB }), env));
  ok(up2.ok, "上传第二个 bin 成功");
  const upOther = await worker.fetch(req("/api/admin/paid/upload/other-slug/x.bin", { method: "PUT", token: T }), env);
  console.log("    [debug] unregistered →", upOther.status, await upOther.text());
  ok(upOther.status === 404, "未注册 slug 拒绝上传");
  const upTrav = await worker.fetch(req("/api/admin/paid/upload/bw16-19/../etc.bin", { method: "PUT", token: T }), env);
  console.log("    [debug] traversal →", upTrav.status, await upTrav.text());
  ok(upTrav.status === 400, "路径穿越文件名被拒");

  const gc = await j(await worker.fetch(req("/api/admin/codes", { method: "POST", token: T, body: { slug: "bw16-19", count: 2, note: "测试" } }), env));
  ok(gc.codes?.length === 2 && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(gc.codes[0]), "批量生成取件码");
  const CODE = gc.codes[0], CODE2 = gc.codes[1];

  console.log("M6 取件：begin / fetch / 一次性 / 时效 / 绑定");
  const bad1 = await j(await worker.fetch(req("/api/pickup/begin", { method: "POST", body: { code: "XXXX-XXXX-XXXX-XXXX", slug: "bw16-19", fp: "fp-test" } }), env));
  ok(bad1.ok === false && bad1.error === "invalid_code", "无效取件码拒绝");
  // slug 校验只对已注册的付费 slug 生效（未注册 slug 先返回 not_available，不泄漏取件码有效性）
  await worker.fetch(req("/api/admin/paid", { method: "POST", token: T, body: { slug: "bw16-20", name: "另一付费固件", device: "bw16" } }), env);
  await worker.fetch(new Request("https://admin.peipeidev.cn/api/admin/paid/upload/bw16-20/km0_boot_all.bin",
    { method: "PUT", headers: { Authorization: `Bearer ${T}` }, body: new Uint8Array(8).fill(1) }), env);
  const bad2 = await j(await worker.fetch(req("/api/pickup/begin", { method: "POST", body: { code: CODE, slug: "bw16-20", fp: "fp-test" } }), env));
  ok(bad2.error === "slug_mismatch", "slug 不匹配拒绝");
  const bad3 = await j(await worker.fetch(req("/api/pickup/begin", { method: "POST", body: { code: CODE, slug: "bw16-99", fp: "fp-test" } }), env));
  ok(bad3.error === "not_available", "未注册付费 slug 返回 not_available");
  const begin = await j(await worker.fetch(req("/api/pickup/begin", { method: "POST", body: { code: CODE, slug: "bw16-19", fp: "fp-test" } }), env));
  ok(begin.ok && begin.files.length === 2 && begin.files[0].url.startsWith("/pickup/"), "取件码换一次性链接");
  ok(begin.files[0].size === 1024 && /^[0-9a-f]{64}$/.test(begin.files[0].sha256), "清单元数据（size/sha256）回填正确");

  const grantUrl = begin.files[0].url;
  const fpMiss = await j(await worker.fetch(req(`${grantUrl}?fp=wrong-fp`), env));
  ok(fpMiss.error === "fp_mismatch", "指纹不匹配拒绝");
  const got = await worker.fetch(req(`${grantUrl}?fp=fp-test`), env);
  ok(got.status === 200 && got.headers.get("content-type") === "application/octet-stream", "取件下载 200 / octet-stream");
  const gotBytes = new Uint8Array(await got.arrayBuffer());
  ok(gotBytes.length === 1024 && gotBytes[0] === 0 && gotBytes[1] === 1, "R2 回源字节正确");
  const again = await j(await worker.fetch(req(`${grantUrl}?fp=fp-test`), env));
  ok(again.error === "already_used", "一次性：同一链接第二次拒绝");
  const other = await worker.fetch(req(`${begin.files[1].url}?fp=fp-test`), env);
  const otherBytes = new Uint8Array(await other.arrayBuffer());
  ok(other.status === 200 && otherBytes.length === 2048, "第二文件链接独立有效（独立字节流）");
  ok((await j(await worker.fetch(req("/pickup/" + "0".repeat(32) + "?fp=x"), env))).error === "not_found", "随机 jti 404");

  // 时效：手工把授权改成已过期
  const db2 = env.DB;
  ok((await j(await worker.fetch(req("/api/pickup/begin", { method: "POST", body: { code: CODE, slug: "bw16-19", fp: "fp2" } }), env))).ok, "已核销取件码 24h 内可重试（重下）");
  const old = await db2.prepare("SELECT jti FROM pickup_grants ORDER BY created_ts DESC LIMIT 1").first();
  await db2.prepare("UPDATE pickup_grants SET exp_ts=? WHERE jti=?").bind(Date.now() - 1000, old.jti).run();
  ok((await j(await worker.fetch(req(`/pickup/${old.jti}?fp=fp2`), env))).error === "expired", "过期链接拒绝");

  console.log("M6 取件码生命周期");
  const dis = await j(await worker.fetch(req("/api/admin/codes/disable", { method: "POST", token: T, body: { code: CODE2 } }), env));
  ok(dis.ok, "禁用取件码");
  ok((await j(await worker.fetch(req("/api/pickup/begin", { method: "POST", body: { code: CODE2, slug: "bw16-19", fp: "fp" } }), env))).error === "invalid_code", "已禁用取件码拒绝");

  // 重试窗口外拒绝：把 CODE 的 redeemed_ts 拨回 25h 前
  await db2.prepare("UPDATE codes SET redeemed_ts=? WHERE code=?").bind(Date.now() - 25 * 3600e3, CODE).run();
  ok((await j(await worker.fetch(req("/api/pickup/begin", { method: "POST", body: { code: CODE, slug: "bw16-19", fp: "fp" } }), env))).error === "already_redeemed", "重试窗口外拒绝");

  console.log("既有能力回归（M5 遥测/反馈/公告/redeem）");
  ok((await j(await worker.fetch(req("/api/event", { method: "POST", body: { device: "BW16", firmware: "f", success: true } }), env))).ok, "刷写上报");
  ok((await j(await worker.fetch(req("/api/feedback", { method: "POST", body: { message: "测试反馈内容" } }), env))).ok, "反馈提交");
  const an = await j(await worker.fetch(req("/api/admin/announcements", { method: "POST", token: T, body: { title: "公告", body: "内容" } }), env));
  ok(an.ok && ((await j(await worker.fetch(req("/api/announcements"), env))).announcements?.length === 1), "公告编辑与展示");
  const rc = (await j(await worker.fetch(req("/api/admin/codes", { method: "POST", token: T, body: { slug: "*", count: 1 } }), env))).codes[0];
  ok((await j(await worker.fetch(req("/api/redeem", { method: "POST", body: { code: rc, slug: "anything" } }), env))).ok, "M5 redeem 仍可用");

  console.log("KV 形状存储回归（PICKUP.get 直接返回 ArrayBuffer）");
  {
    const kvStore = new Map();
    const envKV = {
      DB: env.DB,
      ADMIN_TOKEN: T,
      PICKUP: {
        async put(k, v) { kvStore.set(k, v instanceof Uint8Array ? v.slice().buffer : v); },
        async get(k) { return kvStore.get(k) ?? null; },   // KV：直接返回值（无 .arrayBuffer 方法）
      },
    };
    await worker.fetch(req("/api/admin/paid", { method: "POST", token: T, body: { slug: "kv-fw", name: "KV 测试", device: "bw16" } }), envKV);
    const kvBin = new Uint8Array([9, 8, 7, 6]);
    await worker.fetch(new Request("https://admin.peipeidev.cn/api/admin/paid/upload/kv-fw/km0_boot_all.bin",
      { method: "PUT", headers: { Authorization: `Bearer ${T}` }, body: kvBin }), envKV);
    const kvBegin = await j(await worker.fetch(req("/api/pickup/begin", { method: "POST", body: { code: rc, slug: "kv-fw", fp: "fp-kv" } }), envKV));
    ok(kvBegin.ok, "KV 存储：取件码换链接");
    const kvGot = await worker.fetch(req(`${kvBegin.files[0].url}?fp=fp-kv`), envKV);
    const kvBytes = new Uint8Array(await kvGot.arrayBuffer());
    ok(kvGot.status === 200 && kvBytes.length === 4 && kvBytes[0] === 9, "KV 存储：回源字节正确（适配器双兼容）");
  }

  console.log("v2 完整后台：health 握手 / 注册 / 登录 / 会话");
  {
    const h = await j(await worker.fetch(req("/api/health"), env));
    ok(h.service === "bw16-flash-api", "health service=bw16-flash-api（backend.js 握手契约）");
    const sess = await worker.fetch(req("/api/session", { method: "POST" }), env);
    ok(sess.status === 200, "/api/session 200（api 模式激活检查）");

    const badPw = await worker.fetch(req("/api/auth/register", { method: "POST", body: { loginId: "alice", password: "short" } }), env);
    ok(badPw.status === 400 && (await badPw.json()).detail, "弱密码 400 + detail 契约");
    const reg = await worker.fetch(req("/api/auth/register", { method: "POST", body: { loginId: "alice", password: "password8" } }), env);
    const regD = await j(reg);
    ok(regD.ok && regD.quota === 1, "注册成功赠 1 次额度");
    const cookie = (reg.headers.get("Set-Cookie") || "").split(";")[0];
    ok(cookie.startsWith("peipei_s=") && /HttpOnly/.test(reg.headers.get("Set-Cookie")), "注册下发会话 cookie（HttpOnly）");
    const dup = await worker.fetch(req("/api/auth/register", { method: "POST", body: { loginId: "alice", password: "password8" } }), env);
    ok(dup.status === 409, "重复注册 409");
    const badLogin = await j(await worker.fetch(req("/api/auth/login", { method: "POST", body: { loginId: "alice", password: "wrong-pass" } }), env));
    ok(badLogin.detail && !badLogin.ok, "错误密码 401 + detail");
    const me1 = await worker.fetch(req("/api/auth/me", { headers: { Cookie: cookie } }), env);
    ok(me1.status === 200 && (await me1.json()).loginId === "alice", "me 带 cookie 返回用户");
    ok((await worker.fetch(req("/api/auth/me"), env)).status === 401, "me 无 cookie 401（前端判定未登录）");
    const login = await worker.fetch(req("/api/auth/login", { method: "POST", body: { loginId: "alice", password: "password8" } }), env);
    ok((await j(login)).ok, "登录成功");

    console.log("v2 固件目录 + 一次性镜像取件 + 额度闭环");
    await worker.fetch(req("/api/admin/catalog", { method: "POST", token: T, body: { slug: "bw16-01", name: "WiFi安全测试固件「2026」", device: "bw16", sort: 10, colorCss: "#FB7299" } }), env);
    const catUp = await j(await worker.fetch(new Request("https://admin.peipeidev.cn/api/admin/catalog/upload/bw16-01/imgtool_flashloader_amebad.bin",
      { method: "PUT", headers: { Authorization: `Bearer ${T}` }, body: new Uint8Array(2048).fill(3) }), env));
    ok(catUp.ok && /^[0-9a-f]{64}$/.test(catUp.sha256), "目录固件上传回填 sha256");
    const cat = await j(await worker.fetch(req("/api/catalog"), env));
    const entry = (cat.firmware || []).find((f) => f.slug === "bw16-01");
    ok(entry && entry.files["imgtool_flashloader_amebad.bin"]?.size === 2048 && entry.sourcePath === "线上目录", "/api/catalog 契约（firmware[].files 元数据）");

    const anon401 = await worker.fetch(req("/api/flash/begin", { method: "POST", body: { slug: "bw16-01", fingerprint: "fpA" } }), env);
    ok(anon401.status === 401 && (await anon401.json()).detail, "未登录 flash/begin 401");
    await worker.fetch(req("/api/admin/catalog/upload/bw16-01/km0_boot_all.bin", { method: "PUT", token: T }), env); // 空 body → 400，占位不生效
    await worker.fetch(new Request("https://admin.peipeidev.cn/api/admin/catalog/upload/bw16-01/km0_boot_all.bin",
      { method: "PUT", headers: { Authorization: `Bearer ${T}` }, body: new Uint8Array(512).fill(4) }), env);
    const begin = await worker.fetch(req("/api/flash/begin", { method: "POST", body: { slug: "bw16-01", fingerprint: "fpA" }, headers: { Cookie: cookie } }), env);
    const beginD = await j(begin);
    ok(beginD.ok && beginD.flashSessionId && beginD.files["km0_boot_all.bin"]?.includes("?g="), "flash/begin 换一次性链接（files 对象 + ?g= 契约）");
    const me2 = await j(await worker.fetch(req("/api/auth/me", { headers: { Cookie: cookie } }), env));
    ok(me2.quota === 0, "刷写扣减额度 1→0");
    const again403 = await j(await worker.fetch(req("/api/flash/begin", { method: "POST", body: { slug: "bw16-01", fingerprint: "fpA" }, headers: { Cookie: cookie } }), env));
    ok(again403.detail && again403.detail.includes("额度不足"), "额度不足 403");

    const fileUrl = beginD.files["km0_boot_all.bin"];
    const fpMiss = await j(await worker.fetch(req(`${fileUrl}&fp=wrong`), env));
    ok(fpMiss.detail === "指纹不匹配", "镜像链接指纹不匹配拒绝");
    const got2 = await worker.fetch(req(`${fileUrl}&fp=fpA`), env);
    const got2Bytes = new Uint8Array(await got2.arrayBuffer());
    ok(got2.status === 200 && got2Bytes.length === 512 && got2Bytes[0] === 4, "镜像回源字节正确");
    const reuse = await j(await worker.fetch(req(`${fileUrl}&fp=fpA`), env));
    ok(reuse.detail === "链接已使用", "镜像链接一次性");

    const endFail = await j(await worker.fetch(req("/api/flash/end", { method: "POST", body: { flashSessionId: beginD.flashSessionId, result: "failed", durationS: 3.2, failStage: "下载阶段" } }), env));
    ok(endFail.ok, "flash/end 失败上报");
    const me3 = await j(await worker.fetch(req("/api/auth/me", { headers: { Cookie: cookie } }), env));
    ok(me3.quota === 1, "失败退还额度 0→1");
    const st = await j(await worker.fetch(req("/api/admin/stats?days=1", { token: T }), env));
    ok((st.byFirmware || []).some((f) => f.firmware === "WiFi安全测试固件「2026」"), "flash/end 落统计看板（与 M5 同表）");

    console.log("v2 额度卡密 / 用户管理 / 主站内容 / 反馈新契约");
    const fb2 = await j(await worker.fetch(req("/api/feedback", { method: "POST", body: { type: "flash_fail", body: "刷写失败反馈内容", sessionPublicId: "s1", extra: { stage: "x" } } }), env));
    ok(fb2.ok, "反馈 v2 契约（type/body/extra）");
    const fbShort = await worker.fetch(req("/api/feedback", { method: "POST", body: { type: "t", body: "短" } }), env);
    ok(fbShort.status === 400 && (await fbShort.json()).detail, "反馈过短 400 + detail");

    const noLogin = await j(await worker.fetch(req("/api/redeem", { method: "POST", body: { code: "AAAA-BBBB-CCCC-DDDD" } }), env));
    ok(noLogin.ok === false && noLogin.error === "invalid_code", "未知卡密不误伤：走 M6 回落返回 invalid_code");
    const cc = (await j(await worker.fetch(req("/api/admin/ccodes", { method: "POST", token: T, body: { count: 2, credits: 5, note: "测试卡密" } }), env)));
    ok(cc.codes?.length === 2 && cc.credits === 5, "批量生成额度卡密");
    const rdNoUser = await worker.fetch(req("/api/redeem", { method: "POST", body: { code: cc.codes[0] } }), env);
    ok(rdNoUser.status === 401 && (await rdNoUser.json()).detail, "未登录兑换卡密 401（前端转登录）");
    const rd = await j(await worker.fetch(req("/api/redeem", { method: "POST", body: { code: cc.codes[0] }, headers: { Cookie: cookie } }), env));
    ok(rd.ok && rd.credited === 5 && rd.quota === 6, "兑换卡密 +5 额度（契约 {credited,quota}）");
    const rd2 = await j(await worker.fetch(req("/api/redeem", { method: "POST", body: { code: cc.codes[0] }, headers: { Cookie: cookie } }), env));
    ok(rd2.detail === "卡密已被使用", "卡密一次性");

    const ul = await j(await worker.fetch(req("/api/admin/users", { token: T }), env));
    ok(ul.users?.length >= 1 && ul.total.n >= 1, "用户列表 + 总数");
    const uid = ul.users[0].id;
    const adj = await j(await worker.fetch(req("/api/admin/users/quota", { method: "POST", token: T, body: { id: uid, delta: -100 } }), env));
    ok(adj.error === "quota_underflow", "额度扣到负数被拒");
    const adj2 = await j(await worker.fetch(req("/api/admin/users/quota", { method: "POST", token: T, body: { id: uid, delta: 2, note: "补偿" } }), env));
    ok(adj2.ok && adj2.quota === 8, "管理员调整额度 6→8");
    const dis2 = await j(await worker.fetch(req("/api/admin/users/status", { method: "POST", token: T, body: { id: uid, status: "disabled" } }), env));
    ok(dis2.ok, "禁用用户");
    ok((await worker.fetch(req("/api/auth/me", { headers: { Cookie: cookie } }), env)).status === 401, "禁用后会话立即失效");
    await worker.fetch(req("/api/admin/users/status", { method: "POST", token: T, body: { id: uid, status: "active" } }), env);
    const rp = await j(await worker.fetch(req("/api/admin/users/reset-pw", { method: "POST", token: T, body: { id: uid, password: "newpassword9" } }), env));
    ok(rp.ok && (await j(await worker.fetch(req("/api/auth/login", { method: "POST", body: { loginId: "alice", password: "newpassword9" } }), env))).ok, "重置密码后新密码可登录");

    const scSave = await j(await worker.fetch(req("/api/admin/site/content", { method: "POST", token: T, body: { key: "videos", data: [{ title: "新视频", bvid: "BV1" }] } }), env));
    ok(scSave.ok, "保存主站内容块");
    const scPub = await j(await worker.fetch(req("/api/site/content"), env));
    ok(scPub.content?.videos?.[0]?.title === "新视频", "公开主站内容接口（主页水合数据源）");
    const corsRes = await worker.fetch(req("/api/site/content", { headers: { Origin: "https://peipeidev.cn" } }), env);
    ok(corsRes.headers.get("Access-Control-Allow-Origin") === "https://peipeidev.cn" && corsRes.headers.get("Access-Control-Allow-Credentials") === "true", "CORS 回显 Origin + 凭据（credentials:include 契约）");
    await worker.fetch(req("/api/admin/site/content", { method: "POST", token: T, body: { key: "tmp", data: { a: 1 } } }), env);
    const scDel = await j(await worker.fetch(req("/api/admin/site/content", { method: "POST", token: T, body: { key: "tmp", data: null } }), env));
    ok(scDel.deleted && !((await j(await worker.fetch(req("/api/site/content"), env))).content ?? {}).hasOwnProperty?.("tmp"), "删除内容块");
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error("harness 异常：", e); process.exit(1); });
