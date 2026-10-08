# PDFSandwich 0.6.2

修复 Obsidian 打开链接与部分正文译文重叠，并调整文献笔记的创建方式。

- **在 Obsidian 打开**：改用笔记的完整文件路径生成 URI，修复将 Vault 路径误当作仓库名称的问题；跳转前先保存编辑。
- **空白笔记与自选模板**：新笔记默认空文件，不再生成固定 YAML 和章节。在 Obsidian → 设置 → PDFSandwich → 文献笔记模板中，可选择 Vault 内的 Markdown 文件或清除选择。模板仅用于新笔记，已有笔记不重建。
- **模板变量**：支持 `{{title}}`、`{{authors}}`、`{{year}}`、`{{doi}}`、`{{abstract}}`、`{{url}}`、`{{date}}`、`{{time}}`。日期时间支持 YYYY / MM / DD / HH / mm / ss。不执行 Templater 脚本。
- **移除内部 YAML 编号**：文献与笔记的关联移至隐藏的 `.pdfsandwich/notes-index.json`。已有笔记打开时先备份，再仅删除 `pdfsandwich_note_id` 和 `pdfsandwich_document_id`；其他属性与正文保留。备份或迁移时请保留隐藏索引。
- **移除段落对照**：阅读布局保留双栏原文 / 译文与 PDF + Markdown 笔记，摘录与来源跳转继续可用。
- **排版修复**：修复正文单词被识别为多个独立段落后，译文挤在一起的问题；同一行的碎片重新组成完整段落，保留标题、分栏和公式。已有译文请点击“重译本页”应用修复。

从软件设置检查更新，或下载 `PDFSandwich-Setup-0.6.2.exe`（Windows 10 / 11 x64）。Obsidian 插件也需更新：将 `PDFSandwich-Obsidian-0.6.2.zip` 解压到 Vault 的 `.obsidian/plugins/`，覆盖同名插件后重新启用或重启 Obsidian。图片仍沿用 Vault 的附件设置。

安装包未签名。增量可用时下载变化部分，否则回退完整包。源代码、对应依赖源代码与校验文件随 Release 提供。

[使用说明](https://github.com/ASOAT/PDFSandwich#使用) · [介绍页](https://asoat.github.io/PDFSandwich/)
