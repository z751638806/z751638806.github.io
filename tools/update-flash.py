#!/usr/bin/env python3
# -*- coding: utf-8 -*-
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
        ("<link rel=\"stylesheet\" href=\"css/style.css\">",
         "<link rel=\"stylesheet\" href=\"css/style.css\">\n  <link rel=\"stylesheet\" href=\"css/theme-home.css\">", 1),
        ("<h1>⚡ BW16 / ESP32-C3 网页刷写工具</h1>",
         "<h1 class=\"logo\"><a href=\"/\">peipei<span>.</span>dev</a><span class=\"topbar-title\">在线烧录</span></h1>", 1),
        ('    <div class="topbar-status">\n      <button id="btn-feedback"',
         '    <div class="topbar-status">\n      <nav class="site-nav" aria-label="站点导航"><a href="/#videos">视频</a><a href="/#firmware">固件</a><a href="/#projects">项目</a><a href="/#about">关于</a></nav>\n      <button id="btn-feedback"', 1),
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
        # M7：自定义固件视图（导航页签 + 视图区块；custom.js 由 tools/flash-custom/ 附加）
        ('<nav class="view-nav" aria-label="视图切换">\n      <button id="nav-flash" class="view-tab selected" type="button">刷固件</button>\n      <button id="nav-rescue" class="view-tab" type="button">救砖恢复</button>\n    </nav>',
         '<nav class="view-nav" aria-label="视图切换">\n      <button id="nav-flash" class="view-tab selected" type="button">刷固件</button>\n      <button id="nav-rescue" class="view-tab" type="button">救砖恢复</button>\n      <button id="nav-custom" class="view-tab" type="button">自定义固件</button>\n    </nav>', 1),
        ('  <div id="view-rescue" hidden>',
         '  <div id="view-custom" hidden>\n    <!-- 自定义固件刷写 (M7) -->\n    <section aria-label="自定义固件刷写">\n      <h2>自定义固件刷写</h2>\n      <div class="flash-panel">\n        <p class="small dim">\n          刷写自己的固件文件（本地选择，不会上传到任何服务器）。选设备类型后按提示操作：\n          BW16 需要三个镜像（可一键填充官方引导镜像）；ESP32-C3 支持一个或多个 .bin（可改烧录地址）。\n        </p>\n        <div class="auth-tabs" style="display:flex;gap:8px;margin:14px 0;">\n          <button class="view-tab selected" data-cdev="bw16" type="button">BW16</button>\n          <button class="view-tab" data-cdev="esp32c3" type="button">ESP32-C3</button>\n            <button class="view-tab" data-cdev="esp8266" type="button">ESP8266</button>\n        </div>\n\n        <div id="custom-bw16">\n          <div class="rescue-slot">\n            <span class="rescue-label">km0_boot_all.bin</span>\n            <input type="file" id="custom-km0" accept=".bin">\n            <button class="btn btn-small" type="button" data-cfill="km0_boot_all.bin">用 SDK 默认镜像</button>\n            <span class="small dim" data-state="km0_boot_all.bin"></span>\n          </div>\n          <div class="rescue-slot">\n            <span class="rescue-label">km4_boot_all.bin</span>\n            <input type="file" id="custom-km4" accept=".bin">\n            <button class="btn btn-small" type="button" data-cfill="km4_boot_all.bin">用 SDK 默认镜像</button>\n            <span class="small dim" data-state="km4_boot_all.bin"></span>\n          </div>\n          <div class="rescue-slot">\n            <span class="rescue-label">km0_km4_image2.bin（应用）</span>\n            <input type="file" id="custom-image2" accept=".bin">\n            <span class="small dim" data-state="km0_km4_image2.bin"></span>\n          </div>\n          <label class="advanced-row">\n            <input type="checkbox" id="custom-high-speed" checked>\n            高速模式（约快 3 倍；连不上会自动改用标准速度）\n          </label>\n          <label class="advanced-row">\n            <input type="checkbox" id="custom-extended-erase">\n            全片擦除（会清空板上全部数据，较慢；一般无需勾选）\n          </label>\n          <div class="flash-actions">\n            <button id="btn-custom-flash" class="btn btn-primary" type="button">连接并刷写</button>\n          </div>\n          <div id="custom-progress-wrap" hidden>\n            <div class="progress-track"><div id="custom-progress-bar" class="progress-bar"></div></div>\n            <div id="custom-progress-text" class="small dim">0%</div>\n          </div>\n          <div id="custom-result" class="alert" hidden></div>\n        </div>\n\n        <div id="custom-esp" hidden>\n          <div class="rescue-slot">\n            <span class="rescue-label">添加固件文件（.bin，可多选）</span>\n            <input type="file" id="custom-esp-add" accept=".bin" multiple>\n          </div>\n          <div id="custom-esp-files"></div>\n          <p class="small dim">\n            烧录地址默认 0x0（单个应用镜像直刷）；多个文件时请按固件说明填写各自地址（如 0x0 引导 / 0x10000 应用）。\n          </p>\n          <div class="flash-actions">\n            <button id="btn-custom-esp-flash" class="btn btn-primary" type="button">连接并刷写</button>\n          </div>\n          <div id="custom-esp-progress-wrap" hidden>\n            <div class="progress-track"><div id="custom-esp-progress-bar" class="progress-bar"></div></div>\n            <div id="custom-esp-progress-text" class="small dim">0%</div>\n          </div>\n          <div id="custom-esp-result" class="alert" hidden></div>\n        </div>\n\n        <div id="custom-esp8266" hidden>\n          <div class="rescue-slot">\n            <span class="rescue-label">添加固件文件（.bin，可多选）</span>\n            <input type="file" id="custom-esp8266-add" accept=".bin" multiple>\n          </div>\n          <div id="custom-esp8266-files"></div>\n          <p class="small dim">\n            实验性支持：ESP8266 / ESP8285（NodeMCU、ESP-12 等）。烧录地址按固件说明填写：一体化固件一般为 0x0；带引导的分段固件为 boot 0x0 + 应用 0x10000。刷写时按提示让板子进入下载模式（按住 BOOT/FLASH → 短按 RST → 松开）。\n          </p>\n          <div class="flash-actions">\n            <button id="btn-custom-esp8266-flash" class="btn btn-primary" type="button">连接并刷写</button>\n          </div>\n          <div id="custom-esp8266-progress-wrap" hidden>\n            <div class="progress-track"><div id="custom-esp8266-progress-bar" class="progress-bar"></div></div>\n            <div id="custom-esp8266-progress-text" class="small dim">0%</div>\n          </div>\n          <div id="custom-esp8266-result" class="alert" hidden></div>\n        </div>\n      </div>\n    </section>\n  </div>\n\n  <div id="view-rescue" hidden>', 1),
        # 一键救砖面板（免上传）：官方 AT 固件一键恢复 + 覆盖声明
        ("引导程序已内置，无需额外提供。\n        </p>",
         "引导程序已内置，无需额外提供。\n        </p>\n        <div class=\"alert alert-info\" style=\"margin:2px 0 10px;\">\n          <strong>⚡ 一键救砖（免上传）</strong>\n          <p class=\"small dim\" style=\"margin:4px 0;\">自动写入安信可原厂官方 AT 固件（ComboAT），把设备恢复到原厂状态，全程无需上传任何文件。</p>\n          <label class=\"advanced-row\" style=\"margin:8px 0;\">\n            <input type=\"checkbox\" id=\"oneclick-agree\">\n            我已了解：刷写将<b>擦除并覆盖</b>板上现有固件数据（不可撤销）\n          </label>\n          <button id=\"btn-oneclick-rescue\" class=\"btn btn-primary\" type=\"button\">⚡ 一键恢复官方 AT 固件</button>\n        </div>", 1),
        # 旧「官方 AT 固件恢复」独立区块并入一键面板，隐藏原区块
        ("      <h2>官方 AT 固件恢复</h2>\n      <div class=\"flash-panel\" id=\"rescue-at\">\n        <!-- rescue.js 按清单内容填充 -->\n      </div>",
         "      <div id=\"rescue-at\" hidden></div>", 1),
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
        # M7：内嵌浏览器提示修正（127.0.0.1:8000 是本地开发地址，线上用户不可用）
        ("'当前是 IDE 内嵌预览窗，弹不出系统串口列表。请复制 http://127.0.0.1:8000/ 到独立 Chrome/Edge 打开后再刷写（本窗口仍可用于 ?mock=1 演练）。'",
         "'当前是 IDE 内嵌预览窗，弹不出系统串口列表。请复制当前页面地址，到独立的 Chrome / Edge 标签页打开后再刷写（本窗口仍可用于 ?mock=1 演练）。'", 1),
        ("'当前是 IDE 内嵌预览窗（Electron），弹不出系统串口列表。请复制地址 http://127.0.0.1:8000/ 到独立 Chrome/Edge 打开后再刷写。'",
         "'当前是 IDE 内嵌预览窗（Electron），弹不出系统串口列表。请复制当前页面地址，到独立的 Chrome / Edge 标签页打开后再刷写。'", 1),
        # M7：初始化自定义固件模块（custom.js 由 tools/flash-custom/ 附加，随站点发布）
        ("  await initRescue(bw16, flasherLog);\n}",
         "  await initRescue(bw16, flasherLog);\n  try {\n    const custom = await import('./custom.js');\n    await custom.initCustom(state.manifests, flasherLog);\n  } catch (e) {\n    flasherLog.append('自定义固件模块加载失败：' + e.message, 'err');\n  }\n}", 1),
        # M7 修复：switchView 同步第三个视图/页签，否则从「自定义固件」切回时旧页签保持高亮且视图叠加
        ("  $('view-rescue').hidden = view !== 'rescue';\n  $('nav-flash').classList.toggle('selected', view === 'flash');\n  $('nav-rescue').classList.toggle('selected', view === 'rescue');",
         "  $('view-rescue').hidden = view !== 'rescue';\n  $('view-custom').hidden = view !== 'custom';\n  $('nav-flash').classList.toggle('selected', view === 'flash');\n  $('nav-rescue').classList.toggle('selected', view === 'rescue');\n  $('nav-custom').classList.toggle('selected', view === 'custom');", 1),
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
        # 一键救砖：勾选声明 → 从内置 sdkBackup 填充三镜像 → 复用现有恢复流程
        ("  $('btn-rescue-flash').addEventListener('click', onRescueClick);",
         "  $('btn-rescue-flash').addEventListener('click', onRescueClick);\n  $('btn-oneclick-rescue').addEventListener('click', async () => {\n    if (!$('oneclick-agree').checked) {\n      showResult('warn', '请先勾选「我已了解将覆盖板上固件」后再开始一键恢复。');\n      return;\n    }\n    setBusy(true);\n    try {\n      const at = state.manifests.firmware.find((f) => f.slug === 'bw16-at');\n      if (!at) throw new Error('官方 AT 固件未内置');\n      for (const name of Object.keys(SLOTS)) {\n        const meta = at.files[name];\n        if (!meta) throw new Error(`内置镜像缺失：${name}`);\n        markImage(name, await fetchBinary(meta.path), '官方 AT 固件');\n      }\n    } catch (e) {\n      setBusy(false);\n      showResult('err', `× 内置镜像加载失败：${e.message}`);\n      return;\n    }\n    setBusy(false);\n    await onRescueClick();\n  });", 1),
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

# 线上固件白名单：只发布这些 slug（清单 + bin 文件都以此为准；本地项目不受影响）。
# 空 list = 该设备暂不上线固件。
FIRMWARE_WHITELIST = {
    "bw16": ["bw16-01", "bw16-02", "bw16-at"],
    "esp32c3": [],
}

# 线上显示名映射（本地项目保留原名；slug 不变，只改清单里的 name 字段）
FIRMWARE_NAME_MAP = {
    "断网": "WiFi安全测试固件「2026」",
    "断网远程版": "WiFi安全测试固件-远程版「2026」",
    "官方AT固件(本地)": "官方 AT 固件（救砖）",
}

# 线上固件连接提示（选中固件后显示在刷写面板；本地项目无此字段）
# DEFAULT_CONNECT_NOTE 应用到所有上线固件；如某固件需要单独文案，加进下面的 override 表
DEFAULT_CONNECT_NOTE = "刷写完成后，设备会释放 WiFi 热点「CMCC」，连接密码：12345678.（注意：末尾有一个英文句点）"
FIRMWARE_CONNECT_NOTES_OVERRIDE = {
    "bw16-at": "",   # AT 固件不释放热点，不显示连接提示
}

# 上线产物中禁止出现的字符串（自检用）
FORBIDDEN = [
    "PROTOCOL.md", "REVIEW_LOG", "ACCEPTANCE", "0x0800", "0x082000",
    "SRAM", "NAK 0x", "ACK 0x", "vid=0x", "来源 ", "firmware_config",
    "_at_firmware", "flash_cmd", "协议出处", "审查记录", "待实机验证",
    '"/firmware/',
]

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
            if f.get("slug") == "bw16-at":
                f["hideInList"] = True   # AT 固件仅供救砖页一键恢复，不进普通刷写列表
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
        (dist / "css" / "theme-home.css").write_text(THEME_CSS, encoding="utf-8")
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
        # M7：自定义固件模块（按上线口径编写，直接附加；vendor 已是单文件压缩产物，不再 terser）
        custom_dir = SITE / "tools" / "flash-custom"
        if (custom_dir / "custom.js").exists():
            shutil.copy(custom_dir / "custom.js", dist / "js" / "custom.js")
            (dist / "js" / "vendor").mkdir(parents=True, exist_ok=True)
            shutil.copy(custom_dir / "vendor" / "esptool-js.esm.js", dist / "js" / "vendor" / "esptool-js.esm.js")
            print("  ✓ 自定义固件模块已附加（custom.js + esptool-js vendor）")
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
