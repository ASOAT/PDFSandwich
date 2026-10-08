# 文献笔记与阅读集成（0.6.0）

## 模块边界

- `electron/library.cjs` 保留现有 PDF 索引和稳定文献 UUID；`library-migration.cjs` 仅迁移旧默认目录的名称及关联路径。
- `electron/notes.cjs` 管理普通 Markdown 文件、YAML、笔记 ID、摘录 ID、附件、历史、冲突和目录配置，不依赖 React 或 Obsidian。
- `electron/research.cjs` 负责受限 IPC、目录选择、弹出窗口、协议定位、笔记保存协调及与现有文献/翻译接口衔接。
- `backend/research.py` 重用 PyMuPDF 和已有 annotation alignment 输出按需封面、选区文字、截图及双语段落。现有翻译、PDF 批注保存流程不依赖笔记模块。
- `src/NotesPanel.tsx` 管理文献关联、列表和保存状态；`LiveMarkdown.tsx` 用 CodeMirror 的装饰层呈现实时 Markdown，不把 HTML 重新转换成源文；`MarkdownView.tsx` 提供只读 Markdown/KaTeX 视图。
- `obsidian-plugin/` 仅实现 Vault 设置和 URI 链接，直接共享 Markdown 文件，没有常驻本地服务器。独立模式无需安装 Obsidian。

## 标识与定位

每份入库 PDF 沿用已有文献 UUID。每份应用新建笔记的 YAML 有 `pdfsandwich_note_id`，文献笔记还有 `pdfsandwich_document_id`。摘录对文献 ID、页码、原始几何或批注 ID、文字和附件生成指纹，防止重复加入。

来源链接使用 `pdfsandwich://document/<uuid>?page=<1-based>&annotation=<id>&rect=x0,y0,x1,y1`。已安装程序接收 URI 并按库内 UUID 打开文献；启动第二个实例会把链接交给已有窗口。链接不包含私人绝对 PDF 路径。笔记移动分类后文献关联不变。

## 保存与冲突

Markdown 是文件事实来源。每次读取计算内容版本；保存比较基础版本，单纯追加与当前手写编辑可合并。重叠编辑不猜测替换，原文件保持外部版本，当前编辑落入 `.pdfsandwich/conflicts`。最近二十份普通保存快照放在 `.pdfsandwich/history`。编辑器额外保留未写盘草稿，在关闭、切换和更新安装前请求保存。

目录切换可直接使用目标文件夹，或显式复制迁移。复制前检查同名内容，保留源目录。重命名 / 移动 / 删除有确认；删除使用系统回收站，不删除 PDF 或共享附件。外部改动通过文件监听通知编辑器。Vault 的小型设置文件由插件定期读取。

## 默认目录

安装目录 `Library` 放 PDF；独立笔记默认安装目录 `Notes`，可由用户选择。Obsidian 模式指定 Vault 和普通子目录，默认 `Papers`。两者目录选择分开保存，模式切换不自动覆盖或删除旧笔记。共享插件设置位于 Vault 的 `.pdfsandwich/config.json`。

## 视觉方向

配色从作品中借鉴多种相邻色和冷暖比例，再调整成适合长时间阅读的界面颜色；不是逐像素采样或博物馆授权主题。阅读正文保持高对比度，装饰色用于导航、选中状态、卡片和轻微背景渐变。

- 莫奈：烟紫、水蓝、灰粉与奶油色。参考 [Met 的 Water Lilies](https://www.metmuseum.org/art/collection/search/438008)。
- 维米尔：群青、赭金、象牙白。参考 [Mauritshuis 的 Girl with a Pearl Earring](https://www.mauritshuis.nl/en/our-collection/artworks/670-girl-with-a-pearl-earring)。
- 莫兰迪：陶土、暖灰与鼠尾草。参考 [Thyssen 的 Still Life](https://www.museothyssen.org/en/collection/artists/morandi-giorgio/still-life)。

## 边界

笔记默认模板不推断研究方法或结论。常用 Markdown、YAML、KaTeX 和 wiki 链接可用；Obsidian 的 Dataview、插件脚本及复杂嵌入不会执行。段落重排视图以占位文字提示公式，精确公式布局保留在 PDF 中。本地公式识别是独立可选模型，结果可修订并与截图一起存储，不改变原始公式。

应用删除文库索引不会删除实际文件；如果移除后重新导入，可能分配新的文献 ID，应保留原库索引以维持旧笔记链接。外部非应用笔记没有稳定 YAML ID 时按路径索引。桌面 Obsidian 本体未纳入自动 UI 测试；插件 API 使用模拟宿主验证，Vault 文件共享由真实文件系统测试。


Obsidian 图片附件遵循 Vault 的 `.obsidian/app.json` 中 `attachmentFolderPath`，每次新增截图重新读取。支持 Vault 根目录、指定目录、笔记所在目录和其子目录。独立模式继续使用 Notes/assets。引用使用标准 Markdown 相对路径；复制迁移会检查并携带引用图片，目标 Obsidian Vault 的附件按其设置存放。参考 [Obsidian 附件位置说明](https://obsidian.md/help/attachments)。
