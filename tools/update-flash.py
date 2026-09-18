#!/usr/bin/env python3
"""上线净化构建：把本地 BW16-ESP32-tool 网页版发布为 peipeidev.cn/flash/。

本地源项目保持原样（协议文档、调试日志照旧），本脚本在临时副本上打"用户视角"补丁：
  1. 移除协议出处/审查记录等开发向内容（docs/ 不随站点发布）
  2. 日志与界面文案通俗化（地址/指令/波特率等技术细节不再出现在默认视图）
  3. manifest 改相对路径（站点部署在 /flash/ 子目录）
之后再 terser 压缩、组装、自检。

用法：
  python3 tools/update-flash.py [本地项目web目录]
默认源目录：~/Downloads/归档/BW16-ESP32-tool/web
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
OUT = SITE / "flash"
DEFAULT_SRC = Path.home() / "Downloads/归档/BW16-ESP32-tool/web"

# ---------------------------------------------------------------------------
# 补丁表：{相对路径: [(旧, 新, 预期次数), ...]}。旧串必须与源码逐字节一致。
# ---------------------------------------------------------------------------
PATCHES = {
    "index.html": [
        ("<title>BW16 / ESP32-C3 网页刷写工具</title>",
         "<title>在线烧录 · BW16 / ESP32-C3 网页刷写工具 — peipeidev.cn</title>", 1),
        ('    <div class="topbar-status">\n      <button id="btn-feedback"',
         '    <div class="topbar-status">\n      <a class="btn" href="/" style="padding:2px 10px;font-size:12px;text-decoration:none;">← peipeidev.cn</a>\n      <button id="btn-feedback"', 1),
        ("扩展擦除（覆盖全部镜像区，较慢；出处 PROTOCOL.md P14 备注）",
         "全片擦除（更彻底但较慢；普通刷写无需勾选）", 1),
        ("高速档 921600（快约 3 倍；失败自动回退 115200；出处 PROTOCOL.md P19）",
         "高速模式（约快 3 倍；连不上会自动改用标准速度）", 1),
        ("适用于设备\"变砖\"或需要恢复已知固件的场景：把三段镜像按固定地址写入\n          （km0@0x08000000 / km4@0x08004000 / 应用@0x08006000，出处 PROTOCOL.md P13）。\n          flashloader 自动使用内置副本，无需提供。",
         "适用于设备\"变砖\"或需要恢复已知固件的场景：选择三个镜像文件（或点\"用 SDK 默认镜像\"自动填充），再点\"连接并恢复\"，工具会自动完成清理与写入。引导程序已内置，无需额外提供。", 1),
        ("扩展擦除（变砖恢复建议勾选；出处 PROTOCOL.md P14 备注）",
         "全片擦除（变砖恢复建议勾选，较慢）", 1),
        ("<span class=\"device-desc\">安信可 Ai-Thinker BW16（RTL8720DN）<br>Web Serial 直刷 · 17 个固件</span>",
         "<span class=\"device-desc\">安信可 Ai-Thinker BW16（RTL8720DN）<br>Web Serial 直刷 · 2 个固件</span>", 1),
        ("<span class=\"device-desc\">乐鑫 ESP32-C3 开发板<br>ESP Web Tools · 2 个固件</span>",
         "<span class=\"device-desc\">乐鑫 ESP32-C3 开发板<br>固件即将上线</span>", 1),
        ('<p class="dim small">协议出处：<a href="docs/PROTOCOL.md">web/docs/PROTOCOL.md</a> ·\n      审查记录：<a href="docs/REVIEW_LOG.md">web/docs/REVIEW_LOG.md</a></p>',
         '<p class="dim small">使用遇到问题？观看 B 站视频教程，或通过 <a href="/">peipeidev.cn</a> 首页的联系方式联系我。</p>', 1),
    ],
    "js/ameba.js": [
        ("log(`已切到 ${baud} 8N1`);",
         "log('已切换到高速写入模式');", 1),
        ("log(`× ${PROTOCOL.HIGH_SPEED_BAUD} 高速档不通（${err.message}），改用 115200`);",
         "log('高速模式连接不上，自动改用标准模式');", 1),
        ("log(`× 115200 也没通（${err.message}）`);",
         "log('标准模式也未连通，再试一次高速模式');", 1),
        ("log(`尝试自动进入下载模式（${step.label}）…`);",
         "log('正在自动连接设备…');", 1),
        ("log(`✓ 已进入 ROM 下载模式（0x07 已 ACK，${baudRate} 8N1）`);",
         "log('✓ 已连接芯片，准备写入');", 1),
        ("log(`× ${step.kind === 'timing' ? step.label : '手动重试'}失败：${err.message}`);",
         "log('× 这一步没成功，自动换个方式再试…');", 1),
        ("throw new AmebaProtocolError(`无法进入下载模式：自动时序与 ${PROTOCOL.MANUAL_RETRIES} 次手动重试均失败`);",
         "throw new AmebaProtocolError('连接设备失败：自动与手动方式都未成功。请检查 USB 数据线，并按页面提示操作 BURN/RST 按键');", 1),
        ("log('下发 flashloader 到 SRAM 0x082000…');",
         "log('写入启动引导程序…');", 1),
        ("text: `flashloader ${done}/${blocks} 块`,",
         "text: `写入引导程序 ${done}/${blocks}`,", 1),
        ("log('已随 flashloader 复位把主机降回 115200 8N1');",
         "log('准备写入固件镜像…');", 1),
        ("log('✓ flashloader 就绪，已进入 NOR flash 写模式');",
         "log('✓ 设备已进入写入模式');", 1),
        ("log(`✓ 扩展擦除完成（0x${spanStart.toString(16)} 起 ${sectors} 扇区，待实机验证项）`);",
         "log('✓ 全片擦除完成');", 1),
        ("log(`✓ 擦除 ${image.name}（0x${image.address.toString(16)}，${sectors} 扇区）`);",
         "log('✓ 已清理写入区域');", 1),
        ("log(`写入 ${image.name} → 0x${image.address.toString(16)}…`);",
         "log('写入固件镜像…');", 1),
        ("text: `${image.name} ${done}/${blocks} 块`,",
         "text: `写入固件 ${done}/${blocks}`,", 1),
        ("log('× 复位前未收到就绪信号（传输后设备可能不再发 NAK），直接发 RESET');",
         "log('正在完成写入…');", 1),
        ("log(`⚠ 复位后设备仍在下载模式，第 ${i + 2} 次尝试复位…`);",
         "log(`⚠ 设备没有自动重启，正在尝试重启（第 ${i + 2} 次）…`);", 1),
        ("log('⚠ 三次复位后设备仍在下载模式：请在板子上按一下 RST，或重新插拔一次供电，然后手动确认固件是否运行');",
         "log('⚠ 设备没有自动重启：请在板子上按一下 RST 键，或重新插拔 USB 供电');", 1),
        ("log(`设备启动输出：${txt}`);",
         "log('✓ 固件已启动');", 1),
        ("report('enter', '正在进入下载模式…');",
         "report('enter', '正在连接设备…');", 1),
        ("report('flashloader', '写入 flashloader…');",
         "report('flashloader', '写入引导程序…');", 1),
        ("report('reset', '重启进入 flashloader…');",
         "report('reset', '准备写入固件…');", 1),
    ],
    "js/main.js": [
        ("'已启用扩展擦除（覆盖三镜像连续区，PROTOCOL.md P14 备注，待实机验证）'",
         "'已勾选全片擦除（更彻底但较慢）'", 1),
        ("  unmountEwtButton();\n  note.hidden = true;\n  if (!fw) {",
         "  unmountEwtButton();\n  note.hidden = true;\n  if (fw && fw.connectNote) {\n    note.textContent = fw.connectNote;\n    note.hidden = false;\n  }\n  if (!fw) {", 1),
        ("'已关闭高速档（全程 115200，约慢 3 倍）'",
         "'已使用标准速度（约慢 3 倍）'", 1),
        (" · 来源 ${fw.sourcePath}", "", 1),
        ("flasherLog.append(`固件加载完成：flashloader ${fmtBytes(fl.length)} + 三镜像 ${fmtBytes(km0.length + km4.length + image2.length)}`, 'ok');",
         "flasherLog.append('固件文件校验完成，可以开始写入', 'ok');", 1),
        ("flasherLog.append(`固件加载完成：flashloader ${fmtBytes(got.flashloader.length)} + 三镜像 ${fmtBytes(got.km0.length + got.km4.length + got.image2.length)}`, 'ok');",
         "flasherLog.append('固件文件校验完成，可以开始写入', 'ok');", 1),
        ("portLabel = `vid=0x${(usbVendorId ?? 0).toString(16).padStart(4, '0')}`;",
         "portLabel = 'USB 串口';", 1),
        ("flasherLog.append(`串口已打开（${portLabel}，115200 8N1）`, 'ok');",
         "flasherLog.append('串口已连接', 'ok');", 1),
        ("flasherLog.append('请在浏览器弹窗中选择 BW16 对应串口（列出全部串口，选完自动校验）…', 'sys');",
         "flasherLog.append('请在弹出的窗口中选择你的开发板串口…', 'sys');", 1),
    ],
    "js/serial.js": [
        ("label = '指定字节'", "label = '设备应答'", 1),
        ("'NAK 0x15 就绪信号'", "'设备应答'", 1),
        ("'ACK 0x06 应答'", "'设备应答'", 1),
    ],
    "js/espweb.js": [
        ("log(`ESP Web Tools 就绪，点击\"连接\"按钮并选择 ESP32-C3 串口（清单 ${fw.manifest}）`, 'sys');",
         "log('ESP32-C3 刷写组件已就绪，点击下方\"连接\"按钮并选择串口', 'sys');", 1),
    ],
    "js/rescue.js": [
        ("<p>本仓库未内置官方 AT 固件（不编造下载地址）。</p>\n    <p class=\"small dim\">\n      获取渠道：安信可官方资料中心（docs.ai-thinker.com）的 BW16 板资料，或 Realtek Ameba-D SDK\n      发布包中的 AT 固件镜像。拿到后把三件套（km0_boot_all.bin / km4_boot_all.bin /\n      km0_km4_image2.bin）放到 <code>bw16/_at_firmware/flash/a/</code> 并重新运行构建脚本，\n      这里会出现\"一键恢复\"按钮；也可以直接用上方上传槽手动刷入。\n    </p>",
         "<p>未内置官方 AT 固件。</p>\n    <p class=\"small dim\">\n      如需恢复官方 AT 固件：可从安信可官方资料中心的 BW16 板资料获取三个镜像文件\n      （km0_boot_all.bin / km4_boot_all.bin / km0_km4_image2.bin），用上方上传槽手动刷入。\n    </p>", 1),
        ("<p>检测到本地官方 AT 固件（${atEntry.sourcePath}）。</p>",
         "<p>已内置官方 AT 固件。</p>", 1),
    ],
}

# 部署清单净化：sourcePath / offsetNote 换成用户视角文案
MANIFEST_FIELD_PATCH = {
    "sourcePath": "佩佩队长固件库",
    "offsetNote": {
        "分区表/偏移解析自 firmware_config.json 该固件 flash_cmd 原文":
            "使用该固件的标准写入布局",
        "偏移推断自 firmware_config.json 同为 esp32c3 的 flash_cmd 布局 (0x0/0x8000/0x10000) —— 待实机验证":
            "使用标准布局写入（如刷写失败请通过首页联系方式反馈）",
    },
}

# 线上固件白名单：只发布这些 slug（清单 + bin 文件都以此为准；本地项目不受影响）。
# 空 list = 该设备暂不上线固件。
FIRMWARE_WHITELIST = {
    "bw16": ["bw16-01", "bw16-02"],
    "esp32c3": [],
}

# 线上显示名映射（本地项目保留原名；slug 不变，只改清单里的 name 字段）
FIRMWARE_NAME_MAP = {
    "断网": "WiFi安全测试固件「2026」",
    "断网远程版": "WiFi安全测试固件-远程版「2026」",
}

# 线上固件连接提示（选中固件后显示在刷写面板；本地项目无此字段）
# DEFAULT_CONNECT_NOTE 应用到所有上线固件；如某固件需要单独文案，加进下面的 override 表
DEFAULT_CONNECT_NOTE = "刷写完成后，设备会释放 WiFi 热点「CMCC」，连接密码：12345678.（注意：末尾有一个英文句点）"
FIRMWARE_CONNECT_NOTES_OVERRIDE = {}

# 上线产物中禁止出现的字符串（自检用）
FORBIDDEN = [
    "PROTOCOL.md", "REVIEW_LOG", "ACCEPTANCE", "0x0800", "0x082000",
    "SRAM", "NAK 0x", "ACK 0x", "vid=0x", "来源 ", "firmware_config",
    "_at_firmware", "flash_cmd", "协议出处", "审查记录", "待实机验证",
    '"/firmware/',
]


def apply_patches(root: Path) -> None:
    for rel, rules in PATCHES.items():
        f = root / rel
        text = f.read_text(encoding="utf-8")
        for old, new, expected in rules:
            n = text.count(old)
            if n != expected:
                sys.exit(f"✗ 补丁失配 {rel}: {old[:60]!r} 期望 {expected} 次，实际 {n} 次")
            text = text.replace(old, new)
        f.write_text(text, encoding="utf-8")
        print(f"  ✓ 补丁 {rel}（{len(rules)} 条）")


def sanitize_manifest(path: Path) -> None:
    d = json.loads(path.read_text(encoding="utf-8"))

    def walk(obj):
        if isinstance(obj, dict):
            obj.pop("protocolRef", None)   # 指向协议文档的字段，不随站点发布
            for k, v in obj.items():
                if k in ("path", "manifest") and isinstance(v, str) and v.startswith("/firmware/"):
                    obj[k] = v[1:]         # 绝对路径 → 相对路径（/flash/ 子目录部署）
                elif k == "name" and isinstance(v, str) and v in FIRMWARE_NAME_MAP:
                    obj[k] = FIRMWARE_NAME_MAP[v]
                elif k == "sourcePath" and isinstance(v, str):
                    obj[k] = MANIFEST_FIELD_PATCH["sourcePath"]
                elif k == "offsetNote" and isinstance(v, str) and v in MANIFEST_FIELD_PATCH["offsetNote"]:
                    obj[k] = MANIFEST_FIELD_PATCH["offsetNote"][v]
                else:
                    walk(v)
        elif isinstance(obj, list):
            for x in obj:
                walk(x)

    walk(d)
    # 固件白名单：只保留线上发布的条目
    allow = FIRMWARE_WHITELIST.get(d.get("device", ""))
    if allow is not None and "firmware" in d:
        before = len(d["firmware"])
        d["firmware"] = [f for f in d["firmware"] if f.get("slug") in allow]
        # 线上专属连接提示：默认统一文案，override 表可按 slug 单独覆盖
        for f in d["firmware"]:
            note = FIRMWARE_CONNECT_NOTES_OVERRIDE.get(f.get("slug"), DEFAULT_CONNECT_NOTE)
            if note:
                f["connectNote"] = note
        print(f"  · {path.name} 固件 {before} → {len(d['firmware'])}（白名单）")
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    src = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.is_dir():
        sys.exit(f"✗ 源目录不存在：{src}")
    terser = src / "node_modules" / ".bin" / "terser"
    if not terser.exists():
        sys.exit(f"✗ 找不到 terser：{terser}（先在本地项目 web/ 里 npm install）")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        work = tmp / "web"
        shutil.copytree(src, work, ignore=shutil.ignore_patterns("node_modules", "dist"))
        print(f"① 源副本：{src} → {work}")
        apply_patches(work)

        dist = tmp / "dist"
        (dist / "js").mkdir(parents=True)
        for d in ["css", "manifests", "test/helpers"]:
            shutil.copytree(work / d, dist / d)
        # 固件目录按白名单选择：_common/_sdk_backup 公共件 + 白名单 slug（未上线的 bin 不发布）
        fw_src = work / "firmware"
        fw_dst = dist / "firmware"
        fw_dst.mkdir(parents=True)
        allowed = {"_common", "_sdk_backup"}
        for device, slugs in FIRMWARE_WHITELIST.items():
            allowed.update(slugs)
        for entry in fw_src.iterdir():
            if entry.is_dir() and entry.name in allowed:
                shutil.copytree(entry, fw_dst / entry.name)
        shutil.copy(work / "index.html", dist / "index.html")
        for js in sorted((work / "js").glob("*.js")):
            out = dist / "js" / js.name
            r = subprocess.run([str(terser), str(js), "-c", "-m", "--module", "-o", str(out)],
                               capture_output=True, text=True)
            if r.returncode != 0:
                sys.exit(f"✗ terser 失败 {js.name}: {r.stderr}")
        for m in dist.glob("manifests/*.json"):
            sanitize_manifest(m)
        print("② 压缩 + 清单净化完成")

        # 组装到站点（清空旧 flash/，docs/ 永不发布）
        if OUT.exists():
            shutil.rmtree(OUT)
        shutil.copytree(dist, OUT)

    # 自检：上线文件不得包含开发向字符串
    bad = []
    for f in list(OUT.glob("js/*.js")) + [OUT / "index.html"] + list(OUT.glob("manifests/*.json")):
        text = f.read_text(encoding="utf-8", errors="ignore")
        for s in FORBIDDEN:
            if s in text:
                bad.append(f"{f.relative_to(OUT)} 含 {s!r}")
    if bad:
        sys.exit("✗ 自检失败：\n  " + "\n  ".join(bad))
    # 自检：线上固件目录必须与白名单一致，多一个 bin 都不行
    allowed_dirs = {"_common", "_sdk_backup"} | {s for slugs in FIRMWARE_WHITELIST.values() for s in slugs}
    actual = {p.name for p in (OUT / "firmware").iterdir() if p.is_dir()}
    extra = actual - allowed_dirs
    if extra:
        sys.exit(f"✗ 自检失败：firmware/ 存在白名单外的目录：{sorted(extra)}")
    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"③ 自检通过（{len(FORBIDDEN)} 项敏感串 + 固件白名单 {sorted(allowed_dirs)}）")
    print(f"✓ 上线产物就绪：{OUT}（{size / 1e6:.1f} MB）")


if __name__ == "__main__":
    main()
