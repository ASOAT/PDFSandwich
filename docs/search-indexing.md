# 介绍页与搜索收录

正式地址为 https://asoat.github.io/PDFSandwich/ ，使用免费的 GitHub Pages 地址与 HTTPS。没有购买或绑定独立域名。

页面提供静态 HTML、标题与描述、规范网址、Open Graph/社交分享预览，以及描述软件实际功能的 JSON-LD。没有编造评分或评论，也不保证富媒体搜索结果。

网站地图：https://asoat.github.io/PDFSandwich/sitemap.xml 。更新页面主要内容时同步更新其中的 `lastmod`，不要把每次构建时间当成内容更新时间。

当前站点位于 `/PDFSandwich/` 子目录，不能用该目录下的 `robots.txt` 控制整个域名的抓取；没有添加无效的子目录 robots 文件。域名根目录 robots.txt 返回 404，页面本身没有禁止索引。

## 提交页面更新

发布到 GitHub Pages、确认页面与验证文件已上线后运行：

```powershell
.venv/Scripts/python.exe scripts/submit-site.py --submit
```

脚本验证线上规范网址、网站地图与 IndexNow 验证文件，然后仅提交正式首页。参与 IndexNow 的引擎会共享提交；HTTP 200 表示收到网址，202 表示验证待完成，均不等于已收录。只在内容实际变化后提交，不要反复提交同一内容。

`docs/indexnow-*.txt` 是该站点的公开所有权验证文件，须随页面部署。不要把云端翻译密钥或 GitHub 凭证放入这个文件。

## Google Search Console

需要网站所有者使用自己的 Google 账号登录 https://search.google.com/search-console/ ：

1. 添加“网址前缀”资源 `https://asoat.github.io/PDFSandwich/`，不要选择需要控制 github.io DNS 的“网域”方式。
2. 选择 HTML 标记验证，把 Google 提供的完整验证 meta 标签加入 `docs/index.html` 的 head 后发布，再完成验证。
3. 提交 `sitemap.xml`，并在网址检查中请求首页编入索引。

已部署 HTML 验证文件 `google8d612db7cef52c87.html`；网站所有者于 2026-09-30 确认 Google 验证已完成。验证文件须一直保留。网站地图提交和实际收录状态需在 Search Console 中查看，验证成功本身不代表已经收录。

验证标记可以交给项目维护者添加，不需要提供 Google 密码。网站公开可访问和搜索结果已收录是两件事；Google 说明抓取可能需要数天到数周，也可能不收录。

参考：[IndexNow 协议](https://www.indexnow.org/documentation)、[Google 请求重新抓取](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)、[robots.txt 放置规则](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt)。
