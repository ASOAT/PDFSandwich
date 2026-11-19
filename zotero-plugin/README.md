# PDFSandwich for Zotero

在 Zotero 的“工具 → 插件”中选择“从文件安装插件”，打开 Release 中的 `PDFSandwich-Zotero-版本号.xpi`。

在 Zotero 设置 → 高级开启“允许此计算机上的其他应用程序与 Zotero 通信”。安装并启动一次 PDFSandwich 后，在 Zotero 右键 PDF 附件或论文条目，选择“用 PDFSandwich 打开”。一个条目有多个 PDF 时，右键具体附件可指定打开哪份。

PDFSandwich 的 Zotero 页签可浏览个人文库和群组文库，按分类筛选并搜索标题、作者、年份、标签。直接打开 Zotero 管理或链接的原 PDF，Ctrl+S 将批注写回该文件，备份保存在 PDFSandwich 用户数据目录。

中文译文及翻译记忆只在当前阅读会话使用，关闭文献、切换文献、退出或安装更新时清理，下次打开重新翻译。批注草稿、阅读位置及 Markdown 笔记持续保存。Zotero 内置批注存储于其数据库，导出至 PDF 后才会作为嵌入批注被外部阅读器读取。

使用 Zotero 官方本地 API、MenuManager 和外部协议接口。支持 Zotero 7、8、10，旧版菜单通过官方插件示例的窗口生命周期注册。源码遵循项目 AGPL-3.0-only 许可证。
