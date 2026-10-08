# PDFSandwich Companion

Optional desktop Obsidian plugin for PDFSandwich. Markdown notes also work without this plugin or without Obsidian.

1. Copy this directory's `manifest.json`, `main.js` and `styles.css` into your Vault's `.obsidian/plugins/pdfsandwich-companion/` directory.
2. In Obsidian, reload community plugins and enable **PDFSandwich Companion**.
3. Select the same Vault in PDFSandwich's **阅读与笔记** settings. Choose the literature notes subfolder from either app; the setting is shared via `.pdfsandwich/config.json`.
4. Create a literature note or add an excerpt in PDFSandwich. Edit the same Markdown file in either app. Click an excerpt's page reference to return to the PDF; use **Open associated PDF in PDFSandwich** from the command palette or the note's file menu.

Changing the configured folder does not move or replace files. To copy existing notes and attachments, use PDFSandwich's explicit migration option. Original files stay in the old directory. PDFSandwich retains conflicting edits in `.pdfsandwich/conflicts` and previous saves in `.pdfsandwich/history`; it does not regenerate handwritten note bodies.

The installed PDFSandwich application registers the `pdfsandwich://` protocol. Links identify documents by their stable library UUID, not by a computer-specific file path. That document must be present in this computer's library. Moving Markdown notes between standalone and Vault modes retains those identifiers.

License: AGPL-3.0-only, the same as PDFSandwich.


图片位置沿用 Obsidian 自身的“设置 → 文件与链接 → 新附件的默认位置”。PDFSandwich 新增截图和公式图片时读取这一设置；文献笔记目录与附件目录可以分开。修改此设置只影响新附件，已有链接和文件保持原位。


## Templates and note associations (0.6.2)

In Obsidian → Settings → PDFSandwich → Template, select a Markdown file in this Vault. Clear the selection to create empty notes. Existing notes are never regenerated from a template. Supported variables: `{{title}}`, `{{authors}}`, `{{year}}`, `{{doi}}`, `{{abstract}}`, `{{url}}`, `{{date}}`, `{{time}}`; date/time formats support `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`. Templater scripts are not executed.

Document and note IDs now live in the Vault's `.pdfsandwich/notes-index.json`. Keep this hidden folder when backing up or moving notes. The reader backs up old notes before removing only the two legacy ID properties. The plugin accepts both the old properties and the new index, and tracks note/folder renames.
