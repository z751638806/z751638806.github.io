# peipeidev.cn 个人主页

佩佩队长（B站：闲鱼ID无敌佩佩队长）的个人主页，托管于 GitHub Pages。

## 网址

- 默认：https://z751638806.github.io
- 自定义域名：https://peipeidev.cn
- 在线烧录：https://peipeidev.cn/flash/ （浏览器直刷 BW16 / ESP32-C3 固件）

## 在线烧录（/flash/）

`flash/` 目录是自包含的网页刷写工具（Chrome/Edge Web Serial，纯前端）：

- BW16：自研协议实现（17 个固件，支持高速档 921600、救砖恢复、扩展擦除）
- ESP32-C3：ESP Web Tools（2 个固件）
- 无硬件演练：`https://peipeidev.cn/flash/?mock=1` 跑完整模拟流程

### 更新刷写工具 / 固件（净化流水线）

线上版本是本地工具的"用户视角净化版"——**本地项目保持原样**（协议文档、调试日志照旧），
线上则剥离全部开发向内容（协议文档不发布、日志通俗化、界面无技术细节）。更新流程：

```bash
python3 tools/update-flash.py [本地项目web目录]   # 默认 ~/Downloads/归档/BW16-ESP32-tool/web
```

脚本自动完成：源码副本打净化补丁（文案替换表在脚本内）→ terser 压缩 → manifest
相对路径/字段净化 → 组装到 flash/（**不含 docs/**）→ 敏感串自检（17 项黑名单零命中）。
改完 push 即可；如本地工具新增了界面文案，往脚本的 PATCHES 表里补对应替换即可。

## 如何更新内容

直接编辑 `index.html` 即可，改动 push 到 main 分支后 1-2 分钟生效。

### 视频列表

`index.html` 中 `<ul id="vidlist">` 下添加：

```html
<li class="vid"><span><a href="https://www.bilibili.com/video/BV号">视频标题</a></span><span class="badge">2026-08</span></li>
```

### 固件列表

`<ul id="fwlist">` 下添加：

```html
<li><b>固件名</b> — 说明 <a href="下载链接">下载</a></li>
```

## 绑定 peipeidev.cn（域名实名通过后）

1. 阿里云域名控制台 → peipeidev.cn → 解析设置 → 添加记录：

| 记录类型 | 主机记录 | 记录值 |
|---------|---------|--------|
| CNAME | @ | z751638806.github.io |
| CNAME | www | z751638806.github.io |

2. GitHub 仓库 Settings → Pages → Custom domain 填 `peipeidev.cn`，勾选 Enforce HTTPS。

3. 等待 DNS 生效（几分钟到几小时），访问 https://peipeidev.cn 验证。

## 注意

- 自定义域名要求域名实名认证通过，否则解析会被暂停
- 国内访问 GitHub Pages 偶尔慢，可后续套 Cloudflare 加速
