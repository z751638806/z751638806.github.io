#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上线净化构建：把本地 BW16-ESP32-tool 网页版发布为 peipeidev.cn **根路径**应用。

2026-10-21 落位变更（主页深度重构第②步「应用上根」）：
  · 应用本体（index.html / css / js / manifests / firmware）发布到站点根，`/flash/` 只留薄壳跳转页；
  · 固件静态目录随之从 /flash/firmware/ 移到 /firmware/ —— 清单与 backend.js 用的都是相对页面的
    `firmware/<slug>/<name>`，上根后天然解析到 /firmware/，所以路径字符串一行都不用改；
  · 站内与枢纽档案都没发行过 /flash/firmware/... 静态直链（买家拿的是后台 /pickup/... 一次性签名链接），
    故本次移动不影响既有交付。

本地源项目保持原样（协议文档、调试日志照旧），本脚本在临时副本上打"用户视角"补丁：
  1. 移除协议出处/审查记录等开发向内容（docs/ 不随站点发布）
  2. 日志与界面文案通俗化（地址/指令/波特率等技术细节不再出现在默认视图）
  3. manifest 改相对路径（相对页面解析，根落位与旧 /flash/ 落位都能用）
  4. 注入首屏信任区、手机引导区与 /flash/ 薄壳跳转页
之后再 terser 压缩、组装、自检。

用法：
  python3 tools/update-flash.py [本地项目web目录]
默认源目录：~/Downloads/归档/BW16-ESP32-tool/web
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
OUT = SITE                      # 应用上根：产物发布到站点根
FW_OUT = SITE / "firmware"      # 固件实体目录
LEGACY_DIR = SITE / "flash"     # 旧落位：只保留跳转薄壳
# 组装时允许整体替换的"应用自有路径"。绝不含 SITE 本身——防误删整站
APP_OWNED = ["index.html", "css", "js", "manifests", "firmware", "test"]
DEFAULT_SRC = Path.home() / "Downloads/归档/BW16-ESP32-tool/web"
# JS 资产内容哈希版本化：GitHub Pages 的 HTML 与 module 各自缓存 10 分钟，
# 一次发布若同时删 DOM 元素和监听，旧 JS + 新 HTML 会初始化失败。HTML 改指
# js/v<hash>/main.js 后，任何一次内容变化都会换一整棵模块树的 URL。
# 旧版本保留两代，避免缓存中的旧 HTML 指向已被删除的版本目录而 404。
JS_VERSION_RE = re.compile(r"^v[0-9a-f]{12}$")
KEEP_JS_VERSIONS = 2

# ---------------------------------------------------------------------------
# 补丁表：{相对路径: [(旧, 新, 预期次数), ...]}。旧串必须与源码逐字节一致。
# ---------------------------------------------------------------------------
PATCHES = {
    "index.html": [
        ("<title>BW16 / ESP32-C3 网页刷写工具</title>",
         "<title>在线烧录 · BW16 / ESP32 / ESP8266 网页直刷 — peipeidev.cn</title>\n"
         "  <meta name=\"description\" content=\"浏览器里直接给 BW16（RTL8720DN）、ESP32、ESP32-C3/S3、ESP8266 刷固件，"
         "无需装驱动。固件免费公开下载，付费固件一机一码激活。\">", 1),
        ("<link rel=\"stylesheet\" href=\"css/style.css\">",
         "<link rel=\"stylesheet\" href=\"css/style.css\">\n  <link rel=\"stylesheet\" href=\"css/theme-home.css\">", 1),
        ("<h1>⚡ BW16 / ESP32-C3 网页刷写工具</h1>",
         "<h1 class=\"logo\"><a href=\"/\">peipei<span>.</span>dev</a><span class=\"topbar-title\">在线烧录</span></h1>", 1),
        # 站点导航放在登录区左侧：顶栏最左的「反馈」由遥测模块运行时注入，别夹在两个反馈中间
        ('      <span id="user-box"',
         '      <nav class="site-nav" aria-label="站点导航"><a href="#contact">联系</a></nav>\n      <span id="user-box"', 1),
        # 主页重构第②步：应用上根后，首屏给手机访客一条出路（信任区已按站长要求 2026-10-21 移除）
        ('  <main>\n  <div id="view-flash">',
         '  <main>\n'
         '  <section id="mobile-guide" class="mobile-guide" hidden aria-label="手机访客指引">\n'
         '    <b>你在手机上打开本站？</b>\n'
         '    <p>浏览器直刷需要<b>电脑上的 Chrome 或 Edge</b>——手机浏览器没有串口访问权限（Web Serial API）。</p>\n'
         '    <ol>\n'
         '      <li>把 <code>peipeidev.cn</code> 复制到电脑浏览器打开，固件与额度都不绑设备，换浏览器不影响。'
         '<button class="btn btn-small" type="button" onclick="try{navigator.clipboard.writeText(\'https://peipeidev.cn/\')}catch(e){}">复制本页地址</button></li>\n'
         '      <li>手边没电脑：写信到 <a href="mailto:0XT@tutamail.com">0XT@tutamail.com</a>，写清板子型号（BW16 / ESP32-C3 / ESP8266…）'
         '和想要的固件，站长把接线与刷写步骤发给你。</li>\n'
         '      <li>已买激活码：激活在设备端完成，与本页刷写互不影响；卡在哪一步就把设备码一起发来。</li>\n'
         '    </ol>\n'
         '  </section>\n'
         '  <script>if (!("serial" in navigator)) { document.getElementById("mobile-guide").hidden = false; }</script>\n'
         '  <div id="view-flash">', 1),
        ("扩展擦除（覆盖全部镜像区，较慢；出处 PROTOCOL.md P14 备注）",
         "全片擦除（更彻底但较慢；普通刷写无需勾选）", 1),
        ("高速档 921600（快约 3 倍；失败自动回退 115200；出处 PROTOCOL.md P19）",
         "高速模式（约快 3 倍；连不上会自动改用标准速度）", 1),
        ("适用于设备\"变砖\"或需要恢复已知固件的场景：把三段镜像按固定地址写入\n          （km0@0x08000000 / km4@0x08004000 / 应用@0x08006000，出处 PROTOCOL.md P13）。\n          flashloader 自动使用内置副本，无需提供。",
         "适用于设备\"变砖\"或需要恢复已知固件的场景：选择三个镜像文件（或点\"用 SDK 默认镜像\"自动填充），再点\"连接并恢复\"，工具会自动完成清理与写入。引导程序已内置，无需额外提供。", 1),
        ("扩展擦除（变砖恢复建议勾选；出处 PROTOCOL.md P14 备注）",
         "全片擦除（变砖恢复建议勾选，较慢）", 1),
        ("<span class=\"device-desc\">安信可 Ai-Thinker BW16（RTL8720DN）<br>Web Serial 直刷 · 17 个固件</span>",
         "<span class=\"device-desc\">安信可 Ai-Thinker BW16（RTL8720DN）<br>Web Serial 直刷 · 3 个固件</span>", 1),
        ("<span class=\"device-desc\">乐鑫 ESP32-C3 开发板<br>ESP Web Tools · 2 个固件</span>",
         "<span class=\"device-desc\">乐鑫 ESP32-C3 开发板<br>固件即将上线</span>", 1),
        # M2：ESP8266 设备卡片（第三张，实验性）
        ("乐鑫 ESP32-C3 开发板<br>固件即将上线</span>\n        </button>",
         "乐鑫 ESP32-C3 开发板<br>Web Serial 直刷 · 3 个固件</span>\n        </button>\n        <button class=\"device-card\" data-device=\"esp8266\" type=\"button\">\n          <span class=\"device-icon\">📶</span>\n          <span class=\"device-name\">ESP8266</span>\n          <span class=\"device-desc\">乐鑫 ESP8266 / ESP8285<br>Web Serial 直刷 · 5 个固件</span>\n        </button>\n        <button class=\"device-card\" data-device=\"esp32\" type=\"button\">\n          <span class=\"device-icon\">🔲</span>\n          <span class=\"device-name\">ESP32</span>\n          <span class=\"device-desc\">乐鑫 ESP32（经典款）<br>Web Serial 直刷 · 4 个固件</span>\n        </button>\n        <button class=\"device-card\" data-device=\"esp32s3\" type=\"button\">\n          <span class=\"device-icon\">🧩</span>\n          <span class=\"device-name\">ESP32-S3</span>\n          <span class=\"device-desc\">乐鑫 ESP32-S3<br>Web Serial 直刷 · 2 个固件</span>\n        </button>", 1),
        ('<p class="dim small">协议出处：<a href="docs/PROTOCOL.md">web/docs/PROTOCOL.md</a> ·\n      审查记录：<a href="docs/REVIEW_LOG.md">web/docs/REVIEW_LOG.md</a></p>',
         '<p class="dim small" id="contact">联系站长：<a href="mailto:0XT@tutamail.com">0XT@tutamail.com</a> · '
         '<a href="https://github.com/z751638806" rel="me noopener">GitHub</a> · 固件与激活码购买渠道：闲鱼「无敌佩佩队长」 · '
         '本页开源实现见 <a href="https://github.com/z751638806/z751638806.github.io">仓库</a>。</p>', 1),
        # M7：自定义固件视图（导航页签 + 视图区块；custom.js 由 tools/flash-custom/ 附加）
        ('<nav class="view-nav" aria-label="视图切换">\n      <button id="nav-flash" class="view-tab selected" type="button">刷固件</button>\n      <button id="nav-rescue" class="view-tab" type="button">救砖恢复</button>\n    </nav>',
         '<nav class="view-nav" aria-label="视图切换">\n      <button id="nav-flash" class="view-tab selected" type="button">刷固件</button>\n      <button id="nav-rescue" class="view-tab" type="button">救砖恢复</button>\n      <button id="nav-custom" class="view-tab" type="button">自定义固件</button>\n    </nav>', 1),
        ('  <div id="view-rescue" hidden>',
         '  <div id="view-custom" hidden>\n    <!-- 自定义固件刷写 (M7) -->\n    <section aria-label="自定义固件刷写">\n      <h2>自定义固件刷写</h2>\n      <div class="flash-panel">\n        <p class="small dim">\n          刷写自己的固件文件（本地选择，不会上传到任何服务器）。选设备类型后按提示操作：\n          BW16 需要三个镜像（可一键填充官方引导镜像）；ESP32-C3 支持一个或多个 .bin（可改烧录地址）。\n        </p>\n        <div class="auth-tabs" style="display:flex;gap:8px;margin:14px 0;">\n          <button class="view-tab selected" data-cdev="bw16" type="button">BW16</button>\n          <button class="view-tab" data-cdev="esp32c3" type="button">ESP32-C3</button>\n            <button class="view-tab" data-cdev="esp8266" type="button">ESP8266</button>\n        </div>\n\n        <div id="custom-bw16">\n          <div class="rescue-slot">\n            <span class="rescue-label">km0_boot_all.bin</span>\n            <input type="file" id="custom-km0" accept=".bin">\n            <button class="btn btn-small" type="button" data-cfill="km0_boot_all.bin">用 SDK 默认镜像</button>\n            <span class="small dim" data-state="km0_boot_all.bin"></span>\n          </div>\n          <div class="rescue-slot">\n            <span class="rescue-label">km4_boot_all.bin</span>\n            <input type="file" id="custom-km4" accept=".bin">\n            <button class="btn btn-small" type="button" data-cfill="km4_boot_all.bin">用 SDK 默认镜像</button>\n            <span class="small dim" data-state="km4_boot_all.bin"></span>\n          </div>\n          <div class="rescue-slot">\n            <span class="rescue-label">km0_km4_image2.bin（应用）</span>\n            <input type="file" id="custom-image2" accept=".bin">\n            <span class="small dim" data-state="km0_km4_image2.bin"></span>\n          </div>\n          <label class="advanced-row">\n            <input type="checkbox" id="custom-high-speed" checked>\n            高速模式（约快 3 倍；连不上会自动改用标准速度）\n          </label>\n          <label class="advanced-row">\n            <input type="checkbox" id="custom-extended-erase">\n            全片擦除（会清空板上全部数据，较慢；一般无需勾选）\n          </label>\n          <div class="flash-actions">\n            <button id="btn-custom-flash" class="btn btn-primary" type="button">连接并刷写</button>\n          </div>\n          <div id="custom-progress-wrap" hidden>\n            <div class="progress-track"><div id="custom-progress-bar" class="progress-bar"></div></div>\n            <div id="custom-progress-text" class="small dim">0%</div>\n          </div>\n          <div id="custom-result" class="alert" hidden></div>\n        </div>\n\n        <div id="custom-esp" hidden>\n          <div class="rescue-slot">\n            <span class="rescue-label">添加固件文件（.bin，可多选）</span>\n            <input type="file" id="custom-esp-add" accept=".bin" multiple>\n          </div>\n          <div id="custom-esp-files"></div>\n          <p class="small dim">\n            烧录地址默认 0x0（单个应用镜像直刷）；多个文件时请按固件说明填写各自地址（如 0x0 引导 / 0x10000 应用）。\n          </p>\n          <div class="flash-actions">\n            <button id="btn-custom-esp-flash" class="btn btn-primary" type="button">连接并刷写</button>\n          </div>\n          <div id="custom-esp-progress-wrap" hidden>\n            <div class="progress-track"><div id="custom-esp-progress-bar" class="progress-bar"></div></div>\n            <div id="custom-esp-progress-text" class="small dim">0%</div>\n          </div>\n          <div id="custom-esp-result" class="alert" hidden></div>\n        </div>\n\n        <div id="custom-esp8266" hidden>\n          <div class="rescue-slot">\n            <span class="rescue-label">添加固件文件（.bin，可多选）</span>\n            <input type="file" id="custom-esp8266-add" accept=".bin" multiple>\n          </div>\n          <div id="custom-esp8266-files"></div>\n          <p class="small dim">\n            实验性支持：ESP8266 / ESP8285（NodeMCU、ESP-12 等）。烧录地址按固件说明填写：一体化固件一般为 0x0；带引导的分段固件为 boot 0x0 + 应用 0x10000。刷写时按提示让板子进入下载模式（按住 BOOT/FLASH → 短按 RST → 松开）。\n          </p>\n          <div class="flash-actions">\n            <button id="btn-custom-esp8266-flash" class="btn btn-primary" type="button">连接并刷写</button>\n          </div>\n          <div id="custom-esp8266-progress-wrap" hidden>\n            <div class="progress-track"><div id="custom-esp8266-progress-bar" class="progress-bar"></div></div>\n            <div id="custom-esp8266-progress-text" class="small dim">0%</div>\n          </div>\n          <div id="custom-esp8266-result" class="alert" hidden></div>\n        </div>\n      </div>\n    </section>\n  </div>\n\n  <div id="view-rescue" hidden>', 1),
        ("<input type=\"file\" id=\"rescue-image2\" accept=\".bin\">\n          <span class=\"small dim\" data-state=\"km0_km4_image2.bin\"></span>",
         "<input type=\"file\" id=\"rescue-image2\" accept=\".bin\">\n          <button class=\"btn btn-small\" type=\"button\" data-fill=\"km0_km4_image2.bin\">用出厂镜像</button>\n          <span class=\"small dim\" data-state=\"km0_km4_image2.bin\"></span>", 1),
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
        ("  const list = state.manifests[state.device]?.firmware ?? [];",
         "  const list = (state.manifests[state.device]?.firmware ?? []).filter((f) => !f.hideInList);", 1),
        ("  $('firmware-count').textContent = `（${list.length} 个）`;\n  section.hidden = list.length === 0;",
         "  $('firmware-count').textContent = `（${list.length} 个）`;\n  if (state.device === 'esp8266' && list.length === 0) {\n    section.hidden = false;\n    grid.innerHTML = '<div class=\"alert alert-info\" style=\"grid-column:1/-1;margin:0\">ESP8266 官方固件即将上线。现在就可以在「自定义固件」页刷写自己的固件（多 bin + 烧录地址编辑，实验性）。<br><button id=\"btn-go-custom\" class=\"btn btn-primary\" type=\"button\" style=\"margin-top:10px\">前往自定义固件刷写 →</button></div>';\n    document.getElementById('btn-go-custom').addEventListener('click', () => { document.getElementById('nav-custom').click(); document.querySelector('[data-cdev=\"esp8266\"]').click(); });\n  } else {\n    section.hidden = list.length === 0;\n  }", 1),
        # 连接提示注入（M6 取件面板钩子由 _PICKUP_PATCHES 条件注入，见文件后部）
        ("  unmountEwtButton();\n  note.hidden = true;\n  if (!fw) {",
         "  unmountEwtButton();\n  note.hidden = true;\n  if (fw && fw.connectNote) {\n    note.textContent = fw.connectNote;\n    note.hidden = false;\n  }\n  if (!fw) {", 1),
        ("'已关闭高速档（全程 115200，约慢 3 倍）'",
         "'已使用标准速度（约慢 3 倍）'", 1),
        ("  $('flash-target-meta').textContent =\n    `${fw.device === 'bw16' ? 'BW16' : 'ESP32-C3'} · ${fmtBytes(sizes)} · 来源 ${fw.sourcePath}`;",
         "  $('flash-target-meta').textContent =\n    `${({ bw16: 'BW16', esp32c3: 'ESP32-C3', esp8266: 'ESP8266', esp32: 'ESP32', esp32s3: 'ESP32-S3' })[fw.device] ?? fw.device} · ${fmtBytes(sizes)} · 来源 ${fw.sourcePath}`;\n  if (fw.attribution) $('flash-target-meta').textContent += ' · ' + fw.attribution;\n  if (fw.date) $('flash-target-meta').textContent += ' · 更新 ' + fw.date;", 1),
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
        # M7：内嵌浏览器提示修正（127.0.0.1:8000 是本地开发地址，线上用户不可用）
        ("'当前是 IDE 内嵌预览窗，弹不出系统串口列表。请复制 http://127.0.0.1:8000/ 到独立 Chrome/Edge 打开后再刷写（本窗口仍可用于 ?mock=1 演练）。'",
         "'当前是 IDE 内嵌预览窗，弹不出系统串口列表。请复制当前页面地址，到独立的 Chrome / Edge 标签页打开后再刷写（本窗口仍可用于 ?mock=1 演练）。'", 1),
        ("'当前是 IDE 内嵌预览窗（Electron），弹不出系统串口列表。请复制地址 http://127.0.0.1:8000/ 到独立 Chrome/Edge 打开后再刷写。'",
         "'当前是 IDE 内嵌预览窗（Electron），弹不出系统串口列表。请复制当前页面地址，到独立的 Chrome / Edge 标签页打开后再刷写。'", 1),
        # M7：初始化自定义固件模块（custom.js 由 tools/flash-custom/ 附加，随站点发布）
        ("  await initRescue(bw16, flasherLog);\n}",
         "  await initRescue(bw16, flasherLog);\n  try {\n    const custom = await import('./custom.js');\n    await custom.initCustom(state.manifests, flasherLog);\n  } catch (e) {\n    flasherLog.append('自定义固件模块加载失败：' + e.message, 'err');\n  }\n\n  try {\n    const { initTelemetry } = await import('./telemetry.js');\n    initTelemetry(() => lastFlashSummary);\n  } catch { /* 遥测失败不影响使用 */ }\n}", 1),
        # M7 修复：switchView 同步第三个视图/页签，否则从「自定义固件」切回时旧页签保持高亮且视图叠加
        ("  $('view-rescue').hidden = view !== 'rescue';\n  $('nav-flash').classList.toggle('selected', view === 'flash');\n  $('nav-rescue').classList.toggle('selected', view === 'rescue');",
         "  $('view-rescue').hidden = view !== 'rescue';\n  $('view-custom').hidden = view !== 'custom';\n  $('nav-flash').classList.toggle('selected', view === 'flash');\n  $('nav-rescue').classList.toggle('selected', view === 'rescue');\n  $('nav-custom').classList.toggle('selected', view === 'custom');", 1),
        ("  if (fw.device === 'esp32c3') {\n    // F1 防呆：ESP32-C3 固件只能经 ESP Web Tools 刷写，BW16 按钮不可用\n    btn.hidden = true;\n    $('advanced-row').hidden = true;\n    const speedRow = $('speed-row');\n    if (speedRow) speedRow.hidden = true;\n    if (fw.offsetNote) {\n      note.textContent = '偏移说明：' + fw.offsetNote;\n      note.hidden = false;\n    }\n    mountEwtButton(fw, (m, level) => {\n      $('log-section').hidden = false;\n      flasherLog.append(m, level ?? 'sys');\n    }).catch((err) => {\n      flasherLog.append(`ESP Web Tools 挂载失败：${err.message}`, 'err');\n    });\n  } else {",
         "  if (fw.device === 'esp32c3') {\n    btn.hidden = false;\n    btn.disabled = false;\n    $('advanced-row').hidden = true;\n    const speedRow = $('speed-row');\n    if (speedRow) speedRow.hidden = true;\n    if (fw.offsetNote) {\n      note.textContent = '偏移说明：' + fw.offsetNote;\n      note.hidden = false;\n    }\n  } else {", 1),
        ("  const fw = state.firmware;\n  if (fw.device !== 'bw16') return;   // ESP32-C3 由 espweb.js 的按钮处理（M4）",
         "  const fw = state.firmware;\n  if (fw.device !== 'bw16') {\n    const esp = await import('./esp-flash.js');\n    $('log-section').hidden = false;\n    await esp.flashEspFirmware(fw, flasherLog);\n    return;\n  }", 1),
        ("  const [bw16, esp32c3] = await Promise.all([\n    backendLoadCatalog(),\n    fetchJson('manifests/esp32c3.json'),\n  ]);\n  state.manifests.bw16 = bw16;\n  state.manifests.esp32c3 = esp32c3;",
         "  const [bw16, esp32c3, esp8266, esp32, esp32s3] = await Promise.all([\n    backendLoadCatalog(),\n    fetchJson('manifests/esp32c3.json'),\n    fetchJson('manifests/esp8266.json'),\n    fetchJson('manifests/esp32.json'),\n    fetchJson('manifests/esp32s3.json'),\n  ]);\n  state.manifests.bw16 = bw16;\n  state.manifests.esp32c3 = esp32c3;\n  state.manifests.esp8266 = esp8266;\n  state.manifests.esp32 = esp32;\n  state.manifests.esp32s3 = esp32s3;", 1),
    ],
    "js/log.js": [
        # M2：刷写结果匿名上报（仅生产域名；telemetry 模块随构建附加）
        ("    localStorage.setItem(STATS_KEY, JSON.stringify(stats));\n    return stats;\n  }",
         "    localStorage.setItem(STATS_KEY, JSON.stringify(stats));\n    try { telemetry.reportFlashResult({ device, firmware, success, duration }); } catch {}\n    return stats;\n  }", 1),
        ("import { timestamp, timestampShort, downloadText, $ } from './util.js';",
         "import { timestamp, timestampShort, downloadText, $ } from './util.js';\nimport { telemetry } from './telemetry.js';", 1),
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
        # M7 关联修复：setState 限定 #view-rescue 作用域（自定义视图引入同名槽位后，
        #  无作用域 querySelector 会把救砖页的填充反馈写进隐藏的自定义视图槽位）
        ("function setState(name, text) {\n  document.querySelector(`[data-state=\"${name}\"]`).textContent = text;\n}",
         "function setState(name, text) {\n  const el = document.querySelector(`#view-rescue [data-state=\"${name}\"]`);\n  if (el) el.textContent = text;\n}", 1),
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

# 固件更新日期（烧录页信息行展示「更新 YYYY-MM-DD」）：
# 语义 = 该固件 bin 内容最后一次变化（git 历史考证；换 bin 时同步更新此表）。
# 考证基准 commit —— bw16-01: 82521e8 / bw16-18: 9655827 / bw16-19: d01a23d /
# bw16-20: 20261026 替换 image2 / 原基准 7cb3a13 / esp32c3-1,2 与全部 ESP 系: e72fb6b / esp32c3-nat: 65cd4c4
FIRMWARE_DATES = {
    "bw16-01": "2026-09-19",
    "bw16-18": "2026-09-28",
    "bw16-19": "2026-10-01",
    "bw16-20": "2026-10-26",
    "esp32c3-1": "2026-09-28",
    "esp32c3-2": "2026-09-28",
    "esp32c3-nat": "2026-10-26",
    "esp8266-deauther": "2026-09-28",
    "esp8266-tasmota": "2026-09-28",
    "esp8266-micropython": "2026-09-28",
    "esp8266-wled": "2026-09-28",
    "esp8266-captive-portal": "2026-09-28",
    "esp32-bruce-cyd": "2026-09-28",
    "esp32-micropython": "2026-09-28",
    "esp32-div-cyd": "2026-09-28",
    "esp32-ghost-cyd": "2026-09-28",
    "esp32s3-bruce-devkit": "2026-09-28",
    "esp32s3-ghost-cardputeradv": "2026-09-28",
}

# 线上固件白名单：只发布这些 slug（清单 + bin 文件都以此为准；本地项目不受影响）。
# 空 list = 该设备暂不上线固件。
FIRMWARE_WHITELIST = {
    "bw16": ["bw16-01", "bw16-18", "bw16-19", "bw16-20"],
    "esp32c3": ["esp32c3-1", "esp32c3-2", "esp32c3-nat"],
    "esp8266": ["esp8266-deauther", "esp8266-tasmota", "esp8266-micropython", "esp8266-wled", "esp8266-captive-portal"],
    "esp32": ["esp32-bruce-cyd", "esp32-micropython", "esp32-div-cyd", "esp32-ghost-cyd"],
    "esp32s3": ["esp32s3-bruce-devkit", "esp32s3-ghost-cardputeradv"],
}

# 付费固件下载门槛（M6 备用机制，当前未启用）：
# 第一性原理——付费保护在设备端激活（keygen 一机一码、MAC 绑定、固件离线验证），
# bin 保密不增加保护强度（合法买家手里本就有完整 bin），取件码只增加双方摩擦。
# 故此表留空：付费固件 bin 正常发布，烧录页无取件面板。
# 若将来某固件确需下载门槛：填入 slug（如 "bw16": ["bw16-19"]）重跑构建即自动恢复
# 「清单 paid 标记 + bin 不发布 + pickup.js 附加 + 取件面板」；后台取件体系保持可用。
PAID_FIRMWARE = {}


# M6 取件钩子（备用机制）：仅当 PAID_FIRMWARE 非空时追加到 PATCHES 并附加 pickup.js。
# 注意条目 1 的锚点是基础补丁（纯 connectNote 版）应用后的文本。
_PICKUP_PATCHES = {
    "js/main.js": [
        ("  if (fw && fw.connectNote) {\n    note.textContent = fw.connectNote;\n    note.hidden = false;\n  }\n  if (!fw) {",
         "  if (fw && fw.connectNote) {\n    note.textContent = fw.connectNote;\n    note.hidden = false;\n  }\n  try { import('./pickup.js').then((m) => m.onFirmwareSelected(fw)).catch(() => {}); } catch {}\n  if (!fw) {", 1),
        # 取件闸门：未取件不进串口流程（先弹端口选择器会浪费一次用户手势）
        ("  state.busy = true;\n  setBusy(true);\n  hideResult();",
         "  state.busy = true;\n  setBusy(true);\n  hideResult();\n  if (fw.paid) {\n    const pk = await import('./pickup.js');\n    if (!(await pk.ensurePaidReady(fw, flasherLog))) {\n      state.busy = false;\n      setBusy(false);\n      return;\n    }\n  }", 1),
        # 付费固件三镜像改走后台一次性取件（flashloader 仍在站点发布，_common）
        ("  const [fl, km0, km4, image2] = await Promise.all([\n    fetchBinary(flashloader.path),\n    fetchBinary(pick('km0_boot_all.bin').path),\n    fetchBinary(pick('km4_boot_all.bin').path),\n    fetchBinary(pick('km0_km4_image2.bin').path),\n  ]);",
         "  let fl, km0, km4, image2;\n  if (fw.paid) {\n    const pk = await import('./pickup.js');\n    ({ flashloader: fl, km0, km4, image2 } = await pk.pickupPaidImages(fw, flashloader, fetchBinary, flasherLog));\n  } else {\n    [fl, km0, km4, image2] = await Promise.all([\n      fetchBinary(flashloader.path),\n      fetchBinary(pick('km0_boot_all.bin').path),\n      fetchBinary(pick('km4_boot_all.bin').path),\n      fetchBinary(pick('km0_km4_image2.bin').path),\n    ]);\n  }", 1),
    ],
}
if any(PAID_FIRMWARE.values()):
    for _rel, _rules in _PICKUP_PATCHES.items():
        PATCHES[_rel].extend(_rules)


# 线上显示名映射（本地项目保留原名；slug 不变，只改清单里的 name 字段）
FIRMWARE_NAME_MAP = {
    "断网": "WiFi安全测试固件「2026」",
    "断网远程版": "WiFi安全测试固件-远程版「2026」",
    "双频断网Deauther": "双频断网固件「英文版」",
}

# 线上固件连接提示（选中固件后显示在刷写面板；本地项目无此字段）
# DEFAULT_CONNECT_NOTE 应用到所有上线固件；如某固件需要单独文案，加进下面的 override 表
DEFAULT_CONNECT_NOTE = "刷写完成后，设备会释放 WiFi 热点「CMCC」，连接密码：12345678.（注意：末尾有一个英文句点）"
FIRMWARE_CONNECT_NOTES_OVERRIDE = {
    "esp32c3-1": "刷写后热点：ManagementAP（密码 mgmtadmin）· 管理后台 http://192.168.4.1",
    "esp32c3-2": "设备端操作（配套 Flipper 蓝牙工具使用）",
    "bw16-18": "刷写后热点：RTL8720dn-Deauther（密码 0123456789）· 管理后台 http://192.168.1.1 · 支持双频 2.4G/5G",
    "bw16-19": "刷写后热点：CMCC（密码 12345678.，末尾为英文句点）· 固件需激活后才能使用：刷写完成 → 打开固件界面复制设备码 → 通过 peipeidev.cn 首页联系方式发给开发者 → 获取激活码完成激活",
    "bw16-20": "刷写后热点：CMCC（密码 12345678.，末尾为英文句点）· 默认信道 6 · 管理后台 http://192.168.1.1 · 需激活后才能使用：刷写完成 → 打开固件界面复制设备码 → 通过 peipeidev.cn 首页联系方式发给开发者 → 获取激活码完成激活（一机一码）· 仅供学习研究，请勿用于非法用途",
}

# 署名表（按 slug 注入清单；ESP 系固件在 ESP_FIRMWARES 内自带）
ATTRIBUTION_OVERRIDE = {
    "esp32c3-1": "原项目 © risinek（MIT）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    "esp32c3-2": "来源：佩佩队长固件库 · 打包发行 无敌佩佩队长 · peipeidev.cn",
}

# 上线产物中禁止出现的字符串（自检用）
FORBIDDEN = [
    "PROTOCOL.md", "REVIEW_LOG", "ACCEPTANCE", "0x0800", "0x082000",
    "SRAM", "NAK 0x", "ACK 0x", "vid=0x", "来源 ", "firmware_config",
    "_at_firmware", "flash_cmd", "协议出处", "审查记录", "待实机验证",
    '"/firmware/',
    # 主页重构第②步：这些是旧简历主页留下的死引用与第三方计数，一次都不该回到线上
    "busuanzi", "space.bilibili.com", "/#videos", "/#projects", "/#about", "/#firmware",
]

# 旧落位 /flash/ 的薄壳跳转页（书签、闲鱼话术、时效短链都还能用）
SHELL_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>在线烧录 · peipeidev.cn</title>
  <link rel="canonical" href="https://peipeidev.cn/">
  <meta http-equiv="refresh" content="0; url=/">
  <meta name="robots" content="noindex">
</head>
<body style="font:15px/1.7 system-ui,-apple-system,'PingFang SC',sans-serif;background:#0e1116;color:#d7dfe8;padding:24px">
  <p>在线烧录台已移到本站根目录 <strong>peipeidev.cn</strong>，正在跳转……</p>
  <p><a href="/" style="color:#FB7299">没自动跳？点这里前往烧录台 →</a></p>
  <script>location.replace("/");</script>
</body>
</html>
"""

# 主题覆盖层：深色极客风（深灰黑底 + 品牌粉点缀，与日志终端融为一体）
THEME_CSS = """/* theme-home.css · 深色极客风主题层（构建时生成） */
:root {
  --bg: #0e1116;
  --bg-panel: #151a21;
  --bg-panel-2: #1b2129;
  --border: #262e39;
  --text: #d7dfe8;
  --text-dim: #8b97a7;
  --accent: #FB7299;
  --accent-dark: #e05a85;
  --radius: 8px;
}
body { font: 15px/1.7 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--text); }
html { background: var(--bg); }

/* ---- 背景特效：虚化渐变光斑 + 网格（与主页一致） ---- */
body { background: transparent; }
body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(560px 560px at -60px -80px, rgba(251, 114, 153, .16), transparent 70%),
    radial-gradient(520px 520px at 110% 30%, rgba(139, 157, 252, .13), transparent 70%),
    radial-gradient(500px 500px at 40% 110%, rgba(95, 212, 245, .09), transparent 70%);
}
body::after { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background-image: linear-gradient(rgba(255, 255, 255, .028) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255, 255, 255, .028) 1px, transparent 1px);
  background-size: 44px 44px;
  -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, #000 40%, transparent 100%);
          mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, #000 40%, transparent 100%);
}

/* ---- 顶栏：毛玻璃吸顶（与主页导航一致） ---- */
.topbar { position: sticky; top: 0; z-index: 50; background: rgba(11, 14, 18, .72);
  -webkit-backdrop-filter: blur(14px) saturate(150%); backdrop-filter: blur(14px) saturate(150%);
  border-bottom: 1px solid #1c232c; padding: 10px 20px; }
.topbar h1.logo { font-size: 15px; margin: 0; display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .3px; }
.topbar h1.logo a { color: #fff; text-decoration: none; }
.topbar h1.logo a span { color: #FB7299; }
.topbar-title { color: #FB7299; font-size: 12px; font-weight: 600; padding: 2px 10px; border: 1px solid #FB7299; border-radius: 999px; }
.view-tab { color: var(--text-dim); border-color: #262e39; background: transparent; }
.view-tab:hover { color: var(--text); }
.view-tab.selected { color: #fff; border-color: #FB7299; background: rgba(251, 114, 153, .16); }
.topbar-status { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.site-nav { display: flex; gap: 14px; }
.site-nav a { color: var(--text-dim); font-size: 13px; text-decoration: none; }
.site-nav a:hover { color: #fff; }
.topbar .badge { background: #12161c; border-color: #262e39; }
.topbar .badge-ok { color: #4ade80; border-color: #2c5c38; }
.topbar .badge-warn { color: #facc15; border-color: #6b5416; }
.topbar .badge-err { color: #f87171; border-color: #6b2b2b; }
.topbar .badge-dim { color: #8b97a7; }

/* ---- 小节标题：粉色菱形 + 渐隐细线（与主页一致） ---- */
h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: var(--text-dim); display: flex; align-items: center; gap: 10px; }
h2::before { content: ""; width: 8px; height: 8px; border-radius: 2px; background: var(--accent); transform: rotate(45deg); box-shadow: 0 0 10px rgba(251, 114, 153, .8); }
h2::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--border), transparent); }
h2 small { letter-spacing: 0; text-transform: none; }

/* ---- 按钮 ---- */
.btn { background: var(--bg-panel-2); color: var(--text); }
.btn:hover { border-color: #FB7299; }
.btn-primary { background: #FB7299; border-color: #FB7299; color: #fff; font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: #ff86ab; border-color: #ff86ab; }

/* ---- 卡片选中态：粉色描边 + 微光 ---- */
.device-card.selected, .fw-card.selected { box-shadow: 0 0 0 1px #FB7299, 0 0 18px rgba(251, 114, 153, .22); }

/* ---- 玻璃拟态 + 悬停上浮光晕（与主页卡片一致） ---- */
.device-card, .fw-card, .flash-panel, .fw { background: rgba(21, 26, 33, .66);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.device-card, .fw-card { transition: transform .22s, border-color .22s, box-shadow .22s; }
.device-card:hover, .fw-card:hover { transform: translateY(-3px); border-color: rgba(251, 114, 153, .55);
  box-shadow: 0 14px 38px rgba(0, 0, 0, .42); }

/* ---- 提示块 ---- */
.alert-info { border-color: var(--accent); background: rgba(251, 114, 153, 0.1); }
.alert-ok { background: rgba(34, 197, 94, 0.1); }
.alert-warn { background: rgba(234, 179, 8, 0.1); }
.alert-err { background: rgba(239, 68, 68, 0.1); }

/* ---- 日志：终端风与页面融为一体 ---- */
.log-panel { background: #0b0e12; border-color: #1c232c; color: #9ca3af; }
.log-line-sys { color: #c6cfda; }

/* ---- 进度条微光 ---- */
.progress-track { box-shadow: inset 0 0 0 1px #262e39; }
.progress-bar { background: linear-gradient(90deg, #e05a85, #FB7299); }

/* ---- 徽章：品牌粉调（与主页一致；顶栏徽章另有深色规则） ---- */
main .badge, .flash-panel .badge { background: rgba(251, 114, 153, .12); border-color: rgba(251, 114, 153, .4); color: #ffb3ca; }

/* ---- 页脚 ---- */
.footer { max-width: none; background: #0b0e12; color: var(--text-dim); border-top: none; margin-top: 40px; padding: 26px 20px 34px; text-align: center; position: relative; }
.footer::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(251, 114, 153, .55), transparent); }
.footer a { color: #FB7299; text-decoration: none; }
.footer a:hover { text-decoration: underline; }
.footer .dim { color: #5d6874; }

/* ---- 手机引导区（Web Serial 不可用时才显示） ---- */
.mobile-guide { background: rgba(251, 114, 153, .08); border: 1px solid rgba(251, 114, 153, .35);
  border-radius: var(--radius); padding: 14px 16px; margin: 4px 0 22px; }
.mobile-guide b { color: #ffb3ca; }
.mobile-guide p, .mobile-guide li { color: var(--text-dim); font-size: 14px; line-height: 1.75; }
.mobile-guide ol { margin: 8px 0 0; padding-left: 22px; }
.mobile-guide code { background: #0b0e12; padding: 1px 6px; border-radius: 4px; color: #d7dfe8; }
.mobile-guide a { color: #FB7299; }
"""


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


# ESP 系官方固件发行规格（来源与许可证存证见 tools/esp-firmware/SOURCES.md）
ESP_FIRMWARES = [
    {
        "slug": "esp8266-deauther", "device": "esp8266",
        "name": "WiFi安全测试固件（Deauther v2）",
        "file": "esp8266/deauther-2.6.1-nodemcu.bin", "offset": 0x0,
        "colorCss": "#FB7299",
        "connectNote": "刷写后热点：pwned（密码 deauther）· 管理后台 http://192.168.4.1 · 需 1MB 以上 flash（NodeMCU/D1 mini）",
        "attribution": "原项目 © Spacehuhn Technologies（MIT）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp8266-tasmota", "device": "esp8266",
        "name": "智能家居固件（Tasmota）",
        "file": "esp8266/tasmota-15.6.0.bin", "offset": 0x0,
        "colorCss": "#38bdf8",
        "connectNote": "刷写后热点：tasmota-XXXXXX（开放网络）· 管理后台 http://192.168.4.1",
        "attribution": "原项目 © Theo Arendst 与 Tasmota 贡献者（GPL-3.0）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp8266-micropython", "device": "esp8266",
        "name": "MicroPython 教学固件",
        "file": "esp8266/micropython-v1.23.0.bin", "offset": 0x0,
        "colorCss": "#4ade80",
        "connectNote": "刷写后热点：MicroPython-xxxxxx（密码 micropythn）· WebREPL 地址 ws://192.168.4.1:8266",
        "attribution": "原项目 © MicroPython 贡献者（MIT）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp8266-wled", "device": "esp8266",
        "name": "灯效固件（WLED）",
        "file": "esp8266/wled-16.0.1.bin", "offset": 0x0,
        "colorCss": "#a78bfa",
        "connectNote": "刷写后热点：WLED-AP（密码 wled1234）· 管理后台 http://192.168.4.1 · 需 1MB 以上 flash",
        "attribution": "原项目 © WLED 项目与贡献者（EUPL-1.2）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp32-bruce-cyd", "device": "esp32",
        "name": "Bruce 多功能固件（CYD 屏版）",
        "file": "esp32/bruce-cyd-2432s028.bin", "offset": 0x0,
        "colorCss": "#FB7299",
        "connectNote": "设备端触摸屏操作 · 含 WiFi 测试/门户/文件管理等功能",
        "attribution": "原项目 © Bruce 项目贡献者（AGPL-3.0）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp32-micropython", "device": "esp32",
        "name": "MicroPython 教学固件（ESP32）",
        "file": "esp32/micropython-esp32-v1.23.0.bin", "offset": 0x1000,
        "colorCss": "#4ade80",
        "connectNote": "刷写后热点：MicroPython-xxxxxx（密码 micropythn）· WebREPL 地址 ws://192.168.4.1:8266",
        "attribution": "原项目 © MicroPython 贡献者（MIT）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp32s3-bruce-devkit", "device": "esp32s3",
        "name": "Bruce 多功能固件（ESP32-S3 DevKit）",
        "file": "esp32s3/bruce-s3-devkitc.bin", "offset": 0x0,
        "colorCss": "#FB7299",
        "connectNote": "设备端操作 · 含 WiFi 测试/门户/文件管理等功能",
        "attribution": "原项目 © Bruce 项目贡献者（AGPL-3.0）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp32-div-cyd", "device": "esp32",
        "name": "多频无线工具箱（ESP32-DIV）",
        "file": "esp32/esp32div-cyd-1.7.2.bin", "offset": 0x0,
        "colorCss": "#FB7299",
        "connectNote": "设备端触摸屏操作 · WiFi断网/泛洪/包监视/断网检测 + BLE/SubGHz/RFID/IR · CYD 触摸屏",
        "attribution": "原项目 © cifertech（MIT）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp32-ghost-cyd", "device": "esp32",
        "name": "Ghost 无线研究平台（CYD 版）",
        "file": "esp32/ghost-cyd-2.2.bin", "offset": 0x0,
        "colorCss": "#a78bfa",
        "connectNote": "设备端触摸屏操作 · WiFi/BLE 攻防与探针 · 可配 Flipper/Ghost App 联动",
        "attribution": "原项目 © GhostESP-Revival 贡献者（GPL-3.0）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp32s3-ghost-cardputeradv", "device": "esp32s3",
        "name": "Ghost 无线研究平台（Cardputer ADV）",
        "file": "esp32s3/ghost-cardputeradv-2.2.bin", "offset": 0x0,
        "colorCss": "#a78bfa",
        "connectNote": "设备端键盘操作 · WiFi/BLE 攻防与探针 · 可配 Flipper/Ghost App 联动",
        "attribution": "原项目 © GhostESP-Revival 贡献者（GPL-3.0）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        "slug": "esp8266-captive-portal", "device": "esp8266",
        "name": "钓鱼门户演示（Captive Portal）",
        "file": "esp8266/captive-portal-1.1.bin", "offset": 0x0,
        "colorCss": "#eab308",
        "connectNote": "刷写后开放一个开放的演示热点 · 管理地址 172.0.0.1（/pass 查看记录 · /ssid 改热点名）",
        "attribution": "原项目 © adamff-dev（MIT）· 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
    {
        # 多文件条目：files = [[esp-firmware 相对路径, 烧录 offset], ...]（ESP Web Tools 分件刷写）
        "slug": "esp32c3-nat", "device": "esp32c3",
        "name": "Wifi模拟中继",
        "files": [
            ["esp32c3/nat/bootloader.bin", 0x0],
            ["esp32c3/nat/partition-table.bin", 0x8000],
            ["esp32c3/nat/esp32_nat_router.bin", 0x10000],
        ],
        "colorCss": "#5fd4f5",
        "connectNote": "刷写后热点：CMCC（密码 12345678.，注意末尾有英文句点）· 浏览器打开 http://192.168.4.1 进入后台（克隆/中继/网速/打卡）",
        "attribution": "基于 esp32-nat-router 开源项目 · Nomad 定制版 · 打包发行 无敌佩佩队长 · peipeidev.cn",
    },
]

def build_esp_manifests(dist: Path) -> None:
    """ESP 系官方固件：从 tools/esp-firmware 生成各设备清单（含署名/热点提示/SHA-256）。

    条目两种形态：
      单文件  file + offset          → 清单 files: [单条]，bin 发布为 <slug>.bin
      多文件  files: [[路径, offset]] → 清单 files: [多条]（按各 offset）+ EWT manifest.json
              （ESP32-C3 走 ESP Web Tools，消费 manifest 字段，格式对齐线上 esp32c3-1）
    """
    import hashlib
    from datetime import datetime
    groups = {}
    for e in ESP_FIRMWARES:
        if e["slug"] not in FIRMWARE_WHITELIST.get(e["device"], []):
            continue
        slug = e["slug"]
        out_dir = dist / "firmware" / slug
        out_dir.mkdir(parents=True, exist_ok=True)
        if "files" in e:
            specs = [(SITE / "tools" / "esp-firmware" / p, off, Path(p).name) for p, off in e["files"]]
        else:
            data = (SITE / "tools" / "esp-firmware" / e["file"]).read_bytes()
            (out_dir / (slug + ".bin")).write_bytes(data)
            specs = [(SITE / "tools" / "esp-firmware" / e["file"], e["offset"], slug + ".bin")]
        entries, ewt_parts = [], []
        for src, off, name in specs:
            data = src.read_bytes()
            (out_dir / name).write_bytes(data)
            entries.append({"path": f"firmware/{slug}/{name}", "offset": off,
                            "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            ewt_parts.append({"path": name, "offset": off})
        groups.setdefault(e["device"], []).append({
            "slug": slug, "device": e["device"], "name": e["name"],
            "color": "B", "colorCss": e["colorCss"],
            "files": entries,
            **({"type": "esptool", "manifest": f"firmware/{slug}/manifest.json",
                "parts": [{"path": p["path"], "offset": p["offset"], "size": n["size"]}
                          for p, n in zip(ewt_parts, entries)],
                "version": e.get("version", "local")} if "files" in e else {}),
            "connectNote": e["connectNote"], "attribution": e["attribution"],
        })
        if "files" in e:
            (out_dir / "manifest.json").write_text(json.dumps({
                "name": e["name"], "version": e.get("version", "local"),
                "new_install_prompt_erase": False,
                "builds": [{"chipFamily": "ESP32-C3", "improv": False, "parts": ewt_parts}],
            }, ensure_ascii=False, indent=2), encoding="utf-8")
    for device, items in groups.items():
        # 与本地项目清单按 slug 合并（本地条目保留，ESP_FIRMWARES 同 slug 覆盖），
        # 否则直接重写会把本地生成的固件（如 esp32c3-1/2）清掉
        out_path = dist / "manifests" / (device + ".json")
        merged = list(items)
        if out_path.exists():
            existing = json.loads(out_path.read_text(encoding="utf-8")).get("firmware", [])
            new_slugs = {i["slug"] for i in items}
            merged = items + [f for f in existing if f.get("slug") not in new_slugs]
        out_path.write_text(
            json.dumps({"generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "device": device, "firmware": merged}, ensure_ascii=False, indent=2),
            encoding="utf-8")
        print(f"  · {device}.json：+{len(items)} 个固件（ESP 系官方直刷，合并后 {len(merged)} 个）")

def sanitize_manifest(path: Path) -> None:
    d = json.loads(path.read_text(encoding="utf-8"))

    def walk(obj):
        if isinstance(obj, dict):
            obj.pop("protocolRef", None)   # 指向协议文档的字段，不随站点发布
            if obj.get("slug") in FIRMWARE_DATES:   # 更新日期注入（迭代前设置，避免遍历中改键）
                obj["date"] = FIRMWARE_DATES[obj["slug"]]
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
        paid_slugs = set(PAID_FIRMWARE.get(d.get("device", ""), []))
        # 线上专属连接提示：默认统一文案，override 表可按 slug 单独覆盖
        for f in d["firmware"]:
            default_note = DEFAULT_CONNECT_NOTE if d.get("device") == "bw16" else ""
            note = FIRMWARE_CONNECT_NOTES_OVERRIDE.get(f.get("slug"), default_note)
            if note:
                f["connectNote"] = note
            if f.get("slug") in ATTRIBUTION_OVERRIDE:
                f["attribution"] = ATTRIBUTION_OVERRIDE[f["slug"]]
            if f.get("slug") in paid_slugs:
                # M6 备用机制（PAID_FIRMWARE 非空时）：保留卡片与元数据，移除下载路径
                f["paid"] = True
                files = f.get("files")
                for meta in (files.values() if isinstance(files, dict) else (files or [])):
                    if isinstance(meta, dict):
                        meta.pop("path", None)
        print(f"  · {path.name} 固件 {before} → {len(d['firmware'])}（白名单）")
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def version_js_assets(dist: Path) -> str:
    """把 dist/js 打成内容哈希目录，并让 index.html 指向它。

    哈希覆盖全部 JS（含 vendor 与 mock helper）和 index.html：HTML 或任一模块变化
    都会产生新目录名，从而让浏览器与 CDN 拿到整套一致的资产。模块内的
    ../test/helpers 改为目录内相对路径，整个版本目录自包含。
    """
    js_dir = dist / "js"
    app_js = sorted(js_dir.glob("*.js"))
    if not app_js:
        sys.exit("✗ 版本化失败：构建产物里没有 js/*.js")
    h = hashlib.sha256()
    inputs = app_js + sorted((js_dir / "vendor").rglob("*.js")) \
        + sorted((dist / "test" / "helpers").rglob("*.js"))
    for p in inputs:
        h.update(p.relative_to(dist).as_posix().encode())
        h.update(p.read_bytes())
    h.update((dist / "index.html").read_bytes())
    h.update(Path(__file__).read_bytes())   # 构建逻辑变化也必须换版本目录
    stamp = "v" + h.hexdigest()[:12]

    out = js_dir / stamp
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    for p in app_js:
        text = (p.read_text(encoding="utf-8")
                .replace('"../test/helpers/', '"./test/helpers/')
                .replace("'../test/helpers/", "'./test/helpers/"))
        (out / p.name).write_text(text, encoding="utf-8")
    shutil.copytree(js_dir / "vendor", out / "vendor")
    shutil.copytree(dist / "test" / "helpers", out / "test" / "helpers")

    html_path = dist / "index.html"
    html = html_path.read_text(encoding="utf-8")
    needle = '<script type="module" src="js/main.js"></script>'
    if html.count(needle) != 1:
        sys.exit(f"✗ 版本化失败：index.html 应恰有一处 {needle}")
    html_path.write_text(
        html.replace(needle, f'<script type="module" src="js/{stamp}/main.js"></script>'),
        encoding="utf-8",
    )

    for p in out.glob("*.js"):
        text = p.read_text(encoding="utf-8")
        if "../test/helpers/" in text:
            sys.exit(f"✗ 版本化失败：{p.name} 仍引用版本目录外的 test/helpers")
        for ref in re.findall(r'''(?:from|import)\s*\(?\s*["'](\.[^"']+)["']''', text):
            if not (p.parent / ref).is_file():
                sys.exit(f"✗ 版本化失败：{p.name} 引用了不存在的 {ref}")
    print(f"  ✓ JS 版本化目录：js/{stamp}/（模块树自包含）")
    return stamp


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
        (dist / "css" / "theme-home.css").write_text(THEME_CSS, encoding="utf-8")
        # 固件目录按白名单选择：_common/_sdk_backup 公共件 + 白名单 slug（未上线的 bin 不发布；
        # PAID_FIRMWARE 非空时付费固件的 bin 不发布——取件走后台）
        fw_src = work / "firmware"
        fw_dst = dist / "firmware"
        fw_dst.mkdir(parents=True)
        paid_slugs = {s for slugs in PAID_FIRMWARE.values() for s in slugs}
        allowed = {"_common", "_sdk_backup"}
        for device, slugs in FIRMWARE_WHITELIST.items():
            allowed.update(s for s in slugs if s not in paid_slugs)
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
        # M7：自定义固件模块（按上线口径编写，直接附加；vendor 已是单文件压缩产物，不再 terser）
        custom_dir = SITE / "tools" / "flash-custom"
        if (custom_dir / "custom.js").exists():
            shutil.copy(custom_dir / "custom.js", dist / "js" / "custom.js")
            (dist / "js" / "vendor").mkdir(parents=True, exist_ok=True)
            shutil.copy(custom_dir / "vendor" / "esptool-js.esm.js", dist / "js" / "vendor" / "esptool-js.esm.js")
            print("  ✓ 自定义固件模块已附加（custom.js + esptool-js vendor）")
        tel_dir = SITE / "tools" / "flash-telemetry"
        if (tel_dir / "telemetry.js").exists():
            shutil.copy(tel_dir / "telemetry.js", dist / "js" / "telemetry.js")
            print("  ✓ 遥测模块已附加（telemetry.js）")
        pk_dir = SITE / "tools" / "flash-pickup"
        if (pk_dir / "pickup.js").exists() and any(PAID_FIRMWARE.values()):
            shutil.copy(pk_dir / "pickup.js", dist / "js" / "pickup.js")
            print("  ✓ 付费固件取件模块已附加（pickup.js）")
        build_esp_manifests(dist)
        esp_dir = SITE / "tools" / "flash-esp"
        if (esp_dir / "esp-flash.js").exists():
            shutil.copy(esp_dir / "esp-flash.js", dist / "js" / "esp-flash.js")
            print("  ✓ ESP 系直刷模块已附加（esp-flash.js）")
        for m in dist.glob("manifests/*.json"):
            sanitize_manifest(m)
        version_js_assets(dist)
        print("② 压缩 + 清单净化 + JS 版本化完成")

        # 组装到站点根（应用上根）：只替换"应用自有路径"，绝不对站点根做 rmtree
        for rel in APP_OWNED:
            target = (SITE / rel).resolve()
            if target == SITE.resolve():
                sys.exit(f"✗ APP_OWNED 解析到站点根本身，拒绝替换：{rel}")
            if rel == "js" and target.is_dir():
                # 只清当前代与旧版扁平文件，保留历史版本目录供缓存中的旧 HTML 使用
                for child in target.iterdir():
                    if child.is_dir() and JS_VERSION_RE.fullmatch(child.name):
                        continue
                    shutil.rmtree(child) if child.is_dir() else child.unlink()
                continue
            if target.is_dir():
                shutil.rmtree(target)
            elif target.is_file():
                target.unlink()
        shutil.copytree(dist, SITE, dirs_exist_ok=True)
        versions = sorted(
            (p for p in (SITE / "js").iterdir() if p.is_dir() and JS_VERSION_RE.fullmatch(p.name)),
            key=lambda p: p.stat().st_mtime, reverse=True)
        for old in versions[KEEP_JS_VERSIONS:]:
            shutil.rmtree(old)
            print(f"  · 清理过期 JS 版本目录：js/{old.name}/")
        # 旧落位 /flash/ 只留跳转薄壳（书签与短链继续可达），docs/ 永不发布
        for stale in ("css", "js", "manifests", "firmware", "test", "index.html"):
            p = LEGACY_DIR / stale
            if p.is_dir():
                shutil.rmtree(p)
            elif p.is_file():
                p.unlink()
        LEGACY_DIR.mkdir(exist_ok=True)
        (LEGACY_DIR / "index.html").write_text(SHELL_HTML, encoding="utf-8")
        print("  ✓ 应用已上根；flash/ 只留薄壳跳转页")

    # 自检：上线文件不得包含开发向字符串
    bad = []
    # 只扫应用模块（扁平代 + 各版本目录顶层）；vendor/ 与 test/helpers 沿用原有豁免
    scanned = list(OUT.glob("js/*.js"))
    for vd in (OUT / "js").iterdir():
        if vd.is_dir() and JS_VERSION_RE.fullmatch(vd.name):
            scanned += list(vd.glob("*.js"))
    scanned += [OUT / "index.html", LEGACY_DIR / "index.html"] + list(OUT.glob("manifests/*.json"))
    for f in scanned:
        text = f.read_text(encoding="utf-8", errors="ignore")
        for s in FORBIDDEN:
            if s in text:
                bad.append(f"{f.relative_to(OUT)} 含 {s!r}")
    if bad:
        sys.exit("✗ 自检失败：\n  " + "\n  ".join(bad))
    # 自检：应用上根的落位三件事——应用本体在、手机引导区在、联系锚点 in；旧落位只剩薄壳
    home = (OUT / "index.html").read_text(encoding="utf-8")
    for need, why in [('<main>', "烧录应用本体"), ('id="mobile-guide"', "手机引导区"),
                      ('id="contact"', "联系锚点")]:
        if need not in home:
            sys.exit(f"✗ 自检失败：根 index.html 缺少{why}（{need}）——主页重构第②步未落地")
    # 自检：入口必须指向一个存在的版本目录，且目录内含完整模块树
    vm = re.search(r'<script type="module" src="js/(v[0-9a-f]{12})/main\.js"></script>', home)
    if not vm:
        sys.exit("✗ 自检失败：index.html 未指向 js/v<hash>/main.js（JS 版本化未生效）")
    current_js = OUT / "js" / vm.group(1)
    for need in ("main.js", "rescue.js", "vendor/esptool-js.esm.js", "test/helpers/mock-device.js"):
        if not (current_js / need).is_file():
            sys.exit(f"✗ 自检失败：当前 JS 版本目录缺少 {need}")
    live_versions = [p for p in (OUT / "js").iterdir()
                     if p.is_dir() and JS_VERSION_RE.fullmatch(p.name)]
    if len(live_versions) > KEEP_JS_VERSIONS:
        sys.exit(f"✗ 自检失败：JS 版本目录未按上限清理（{len(live_versions)} > {KEEP_JS_VERSIONS}）")
    shell = (LEGACY_DIR / "index.html").read_text(encoding="utf-8")
    if 'rel="canonical" href="https://peipeidev.cn/"' not in shell or "http-equiv=\"refresh\"" not in shell:
        sys.exit("✗ 自检失败：flash/index.html 薄壳缺少 canonical 或 meta refresh")
    if (LEGACY_DIR / "firmware").exists():
        sys.exit("✗ 自检失败：旧落位 flash/firmware 未清（固件应只在站点根 /firmware）")
    # 自检：线上固件目录必须与白名单一致，多一个 bin 都不行
    allowed_dirs = {"_common", "_sdk_backup"} | {s for slugs in FIRMWARE_WHITELIST.values() for s in slugs}
    actual = {p.name for p in (OUT / "firmware").iterdir() if p.is_dir()}
    extra = actual - allowed_dirs
    if extra:
        sys.exit(f"✗ 自检失败：firmware/ 存在白名单外的目录：{sorted(extra)}")
    # M6 自检：付费固件 bin 不得发布；清单条目必须带 paid 标记且无下载路径
    for device, slugs in PAID_FIRMWARE.items():
        for s in slugs:
            if (OUT / "firmware" / s).exists():
                sys.exit(f"✗ 自检失败：付费固件 {s} 的 bin 目录不得发布到站点")
            mf = OUT / "manifests" / (device + ".json")
            ent = next((x for x in json.loads(mf.read_text(encoding="utf-8")).get("firmware", []) if x.get("slug") == s), None)
            if not (ent and ent.get("paid")):
                sys.exit(f"✗ 自检失败：付费固件 {s} 清单缺少 paid 标记")

            def _has_path(o):
                if isinstance(o, dict):
                    return "path" in o or any(_has_path(v) for v in o.values())
                return isinstance(o, list) and any(_has_path(v) for v in o)

            if _has_path(ent.get("files")):
                sys.exit(f"✗ 自检失败：付费固件 {s} 清单仍残留下载路径")
    # 体积只统计应用自有路径（OUT 现在是站点根，含 tools/ 与 .git，不能再 rglob 全站）
    size = sum(p.stat().st_size for rel in APP_OWNED for p in [SITE / rel]
               for p in (p.rglob("*") if p.is_dir() else [p]) if p.is_file())
    print(f"③ 自检通过（{len(FORBIDDEN)} 项敏感串 + 固件白名单 {sorted(allowed_dirs)}）")
    print(f"✓ 上线产物就绪：应用已发布到站点根 {OUT}（{size / 1e6:.1f} MB，另有 {LEGACY_DIR.name}/ 薄壳）")


if __name__ == "__main__":
    main()
