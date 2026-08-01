# peipeidev.cn 个人主页

佩佩队长（B站：闲鱼ID无敌佩佩队长）的个人主页，托管于 GitHub Pages。

## 网址

- 默认：https://z751638806.github.io
- 自定义域名：https://peipeidev.cn （需域名实名通过后配置 DNS，见下文）

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
