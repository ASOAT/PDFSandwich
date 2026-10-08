# PDFSandwich 0.6.0

新增实时 Markdown 文献笔记、可选 Obsidian 联动和文献管理视图。

- **实时 Markdown**：标题、粗体、引用、表格、链接、图片与公式随输入呈现。当前编辑行显示源文，其余内容直接排版；独立模式和 Obsidian 模式使用同一编辑器。保留源码与只读视图。
- **文献笔记工作流**：每份 PDF 默认关联一篇带 YAML 的 Markdown 笔记；支持搜索、分类、重命名、自动保存和浮动窗口。双语摘录包含页码、位置、个人想法和返回 PDF 的链接，重复摘录自动检测。
- **本地文件**：独立模式默认安装目录 `Notes`，可自行选择；Obsidian 模式使用所选 Vault 的子目录。监视外部编辑，重叠冲突保留双方副本。移动分类后更新附件路径；目录迁移保留原文件。
- **Obsidian Companion**：可选插件共享笔记目录设置、打开关联 PDF 和定位笔记。下载 `PDFSandwich-Obsidian-0.6.0.zip`，解压到 Vault 的 `.obsidian/plugins/` 后启用。未上架社区插件市场，软件本身不依赖插件。
- **文献库**：默认文件夹改为英文 `Library`；支持封面网格 / 列表切换、拖入 PDF、右键位置查看 / 分类 / 笔记 / BibTeX；DOI、arXiv 与标题检索元数据，可预览并选择应用字段。
- **阅读**：新增逐段原文译文对照、可调宽度的 PDF + 笔记布局，以及选区右键高亮、下划线、复制和摘录。
- **公式与截图**：框选图片或公式保存到笔记附件。公式可在本机识别为可编辑 LaTeX 并复制 Markdown；Obsidian 模式下图片自动存入 Vault 设置的附件目录。首次下载约 180 MB 额外模型。识别仍可能有误，请对照原图核对。
- **外观**：莫奈、维米尔、莫兰迪三套多色搭配，各有明暗版本；修正左上角图标背景。
- 退出浮动窗口和准备安装更新前先保存笔记；安装程序继续保留 `Library`、`Notes` 和已有中文文献库目录。

0.4.0 及以上可在“翻译与应用设置 → 软件更新”升级。增量可用时下载变化部分，必要时回退完整包。手动安装请选择 `PDFSandwich-Setup-0.6.0.exe`（Windows 10 / 11 x64）。

源码与对应依赖源代码见 `PDFSandwich-0.6.0-source.zip`；校验值见 `SHA256SUMS.txt`。安装包未签名，`.exe.blockmap` 和 `latest.yml` 用于应用内更新。

文献笔记模板不自动生成研究结论；元数据匹配、机器翻译和公式识别需要核对。Markdown 常用语法和双向链接可共享，Obsidian 特有插件语法不保证渲染。段落视图中的公式用占位提示，精确版式请看原 PDF。

[使用说明](https://github.com/ASOAT/PDFSandwich#使用) · [介绍页](https://asoat.github.io/PDFSandwich/) · [反馈问题](https://github.com/ASOAT/PDFSandwich/issues)
