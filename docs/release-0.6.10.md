# PDFSandwich 0.6.10

修复受限安装目录下的文献导入问题。

- 默认文献库没有写入权限时，自动使用当前用户的数据目录，无需以管理员身份运行。
- 保留旧文献、译文和批注的位置；更改存储目录仅影响后续导入，并在保存设置前检查写入权限。
- 未使用的默认 Markdown 笔记目录增加相同的权限回退，已有笔记和自选 Obsidian Vault 保持原位。

在软件设置中检查更新，或下载 `PDFSandwich-Setup-0.6.10.exe`（Windows 10 / 11 x64）。更新后重新导入此前失败的 PDF 即可。

[使用说明](https://github.com/ASOAT/PDFSandwich#使用) · [介绍页](https://asoat.github.io/PDFSandwich/)
