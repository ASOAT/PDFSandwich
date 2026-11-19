# PDFSandwich v0.6.15

- 新增 Zotero 文库入口，支持个人及群组文库、分类筛选和元数据搜索，直接打开 Zotero 的本地 PDF 附件。
- 新增 Zotero 插件，可右键选择“用 PDFSandwich 打开”。在 Zotero“工具 → 插件 → 从文件安装插件”中安装本页的 PDFSandwich-Zotero-0.6.15.xpi。
- Zotero 阅读会话中的译文及翻译缓存关闭后清理，重新打开时重译。批注可手动写回原 PDF，阅读位置和 Markdown 笔记持续保存。

首次使用请启动 Zotero，在其设置 → 高级开启“允许此计算机上的其他应用程序与 Zotero 通信”。下载 Windows 安装包更新 PDFSandwich 后即可使用。

Zotero 内置批注存储于数据库，外部阅读器读取的是 PDF 文件内嵌的批注。Zotero 数据库批注可通过其导出 PDF 功能写入副本。

安装包、更新元数据和可选插件均提供 SHA256SUMS.txt 校验，源码包包含构建脚本与所封装 AGPL 依赖的对应源代码。
