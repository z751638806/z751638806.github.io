#!/usr/bin/env node
// 目录批量接入：站点清单（flash/manifests/bw16.json）+ 本地 bin → 后台 /api/admin/catalog
// 用途：把线上固件一次性同步进后台固件目录（api 模式下发 + 一次性镜像取件的数据源）。
// 运行（默认对本地 devserver）：
//   node tools/flash-api/scripts/sync-catalog.mjs
// 对生产（先拿 ADMIN_TOKEN，见枢纽 ops/runbook）：
//   ADMIN_TOKEN=… node tools/flash-api/scripts/sync-catalog.mjs --api https://admin.peipeidev.cn
// 可选：--only bw16-01,bw16-18  指定 slug；--manifest/--fw-root 换清单与 bin 根目录。
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const API = (arg("--api", "http://127.0.0.1:8787") || "").replace(/\/$/, "");
const TOKEN = process.env.ADMIN_TOKEN || "";
if (!TOKEN) { console.error("缺少 ADMIN_TOKEN（环境变量）"); process.exit(1); }

const FW_ROOT = resolve(HERE, "..", "..", "..", arg("--fw-root", "flash"));
const MANIFEST = resolve(FW_ROOT, arg("--manifest", "manifests/bw16.json"));
const ONLY = (arg("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const FLASHLOADER = "imgtool_flashloader_amebad.bin";

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
let items = manifest.firmware || [];
if (ONLY.length) items = items.filter((f) => ONLY.includes(f.slug));
if (!items.length) { console.error("清单为空或 --only 无匹配"); process.exit(1); }

const api = async (path, opt = {}) => {
  const r = await fetch(API + path, {
    ...opt,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(opt.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status} ${d.error || d.detail || ""}`);
  return d;
};
const upload = async (slug, file, buf) => {
  const r = await fetch(`${API}/api/admin/catalog/upload/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`, {
    method: "PUT", headers: { Authorization: `Bearer ${TOKEN}` }, body: buf,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`upload ${slug}/${file} → HTTP ${r.status} ${d.error || ""}`);
  return d;
};

let okN = 0, failN = 0;
for (let i = 0; i < items.length; i++) {
  const fw = items[i];
  try {
    // 目录 files = 四件套（flashloader + 各分段），元数据取自清单，path 换成 fileId
    const files = {};
    const fl = manifest.flashloader;
    if (fl) files[FLASHLOADER] = { size: fl.size, sha256: fl.sha256, md5: fl.md5 || "", fileId: `_common/${FLASHLOADER}` };
    for (const [name, m] of Object.entries(fw.files || {}))
      files[name] = { size: m.size, sha256: m.sha256, md5: m.md5 || "", fileId: `${fw.slug}/${name}` };
    await api("/api/admin/catalog", {
      method: "POST",
      body: JSON.stringify({
        slug: fw.slug, device: fw.device || "bw16", name: fw.name,
        color: fw.color, colorLabel: fw.colorLabel, colorCss: fw.colorCss,
        sourcePath: fw.sourcePath, attribution: fw.attribution, sort: items.length - i,
        active: true, files,
      }),
    });
    // 逐文件上传 bin 实体（后台存储键 slug/file）
    for (const [name, m] of Object.entries(fw.files || {})) {
      const buf = readFileSync(join(FW_ROOT, m.path));
      await upload(fw.slug, name, new Uint8Array(buf));
    }
    if (files[FLASHLOADER]) {
      const buf = readFileSync(join(FW_ROOT, manifest.flashloader.path));
      await upload(fw.slug, FLASHLOADER, new Uint8Array(buf));
    }
    console.log(`✓ ${fw.slug} ${fw.name}（${Object.keys(files).length} 文件）`);
    okN++;
  } catch (e) {
    console.error(`× ${fw.slug} ${fw.name}：${e.message}`);
    failN++;
  }
}
console.log(`\n完成：${okN} 成功，${failN} 失败 → ${API}/api/catalog`);
