# PDFSandwich

Windows 中英对照 PDF 阅读与批注工具。默认使用免费的本地开源英译中模型，提供浅色和深色主题。

## 使用

本机构建的安装程序位于 `release/0.1.2/PDFSandwich Setup 0.1.2.exe`。也可以运行
`release/0.1.2/win-unpacked/PDFSandwich.exe`；免安装版本需保留整个 `win-unpacked` 文件夹。
安装版不需要安装 Python、Node.js 或配置 API Key。当前为未签名的个人使用版本。

1. 打开或拖入可选中文字的英文 PDF。
2. 左侧原文、右侧中文。默认优先翻译当前页与邻页；“翻译整本”也从当前页开始，再继续其余页面。
3. 在任一侧滚动，另一侧跟随同一页及页内位置；顶部“同步阅读”可解除联动。
4. 选择高亮、下划线、手绘或批注工具，在任一侧标记。文字批注内容保持原样。
5. 点击“保存原 PDF”或按 **Ctrl+S**，将真正的 PDF 批注写回英文原文件。
   保存前自动在原文件旁的 `.pdfsandwich-backups` 目录创建备份。
6. 完成整本翻译后，可导出中文 PDF 或中英交替页 PDF。

首次翻译会下载 Argos 英译中模型约 67 MiB，以及排版模型、字体等资源。
本机实测总资源约 400 MiB（具体依赖版本可能变化）。完成下载后可离线翻译。
翻译按页排队，速度取决于页面复杂度；不是瞬间生成整本译文。

右上角月亮/太阳按钮切换主题。设置中可切换云端 API 或本机 Ollama 兼容端点。
**本地模式不会调用已保存的云端密钥。** 云端模式会向所选服务发送待翻译文字，并产生该服务的费用。

## 阅读与批注

- 连续滚动、缩放、适合页宽、页码跳转、PDF 目录、英文全文搜索；重开文件恢复页码、页内纵向位置和缩放比例。
- 高亮与下划线优先尝试跨语言短语对应；无法匹配时退回整段，并显示对应精度。
- 手绘与便笺按相同页内坐标同步，不声称能识别手绘圈住的语义。
- 统一批注记录，支持修改文字、删除、撤销/重做。草稿即时保存在本机；**草稿保存不等于已写入原 PDF**。
- 保存采用备份、临时文件校验和原子替换。检测到外部修改会拒绝覆盖。
- 页面与译文按需加载，附近页才创建画布。原文使用范围读取；翻译一次只处理一页。
- 快速跳页会更新待翻译的邻页，已手动请求的页面或整本任务继续保留。翻译失败的页需点击重试，不会随滚动反复请求。

| 快捷键 | 功能 |
| --- | --- |
| Ctrl+O / Ctrl+S | 打开 / 保存原 PDF |
| Ctrl+F | 搜索英文原文 |
| Ctrl + 滚轮 | 鼠标指向处放大/缩小，左右两侧均可操作 |
| Ctrl++ / Ctrl+- / Ctrl+0 | 放大 / 缩小 / 适合页宽 |
| Ctrl+Z / Ctrl+Shift+Z | 撤销 / 重做 |
| 左右方向键 | 上一页 / 下一页 |
| Esc | 返回选择工具、关闭设置/批注编辑 |

## 数据与限制

- 草稿、译文、离线语言模型及设置：`%APPDATA%/pdfsandwich/`。
- BabelDOC 排版模型、字体与工作缓存：`%USERPROFILE%/.cache/babeldoc/`。
- 云端密钥使用 Windows 系统保护后保存在本机设置中，不进入仓库。
- 不支持扫描件 OCR、修改原文正文、数字签名编辑或密码解密。
- 原有高亮、下划线、手绘及便笺可导入；其他原生批注保留在文件中，但当前阅读界面可能不显示。
- 小型本地模型的学术术语、长句及复杂图注质量有限；短语对应也属于近似匹配。复杂双栏、表格和跨页句子需要与原文核对。
- 排版尽量保持原位，复杂 PDF 不能保证逐像素一致。整本按单页翻译，跨页上下文不参与翻译。
- 已实测 1000 页、约 95 MiB 的合成文档。尚未用用户的真实大教材做验收，不能保证所有大文件都具有相同性能。

## 从源码运行（Windows x64）

需要 Node.js 22.12+（本机验证为 24.15）、Python 3.12 和 Git。

```powershell
npm ci
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements-lock.txt
npm run dev
```

依赖版本在 `package-lock.json` 和 `backend/requirements-lock.txt` 中锁定。

```powershell
npm run build
npm test
npm run test:python
.venv/Scripts/python.exe scripts/fixtures.py
.venv/Scripts/python.exe scripts/stress-fixture.py
npm run test:ui
node scripts/zoom-smoke.mjs
node scripts/reading-smoke.mjs
node scripts/translation-smoke.mjs
node scripts/bidirectional-smoke.mjs
.venv/Scripts/python.exe scripts/offline-check.py
```

离线验收脚本须在资源下载完成后运行；它在测试进程阻断外网，并检查实际译文输出。
UI 测试只修改生成的测试 PDF，测试数据、缓存和截图均不提交。

## 构建安装包

```powershell
.venv/Scripts/python.exe scripts/create-icon.py
npm run build:backend
npm run build:licenses
npm run dist
```

后端通过 PyInstaller 打包，再由 Electron Builder 生成 NSIS 安装程序。
构建输出在 `release/`，不提交二进制文件、模型、密钥或文档缓存。

## 设计与验证

- [需求与实现边界](docs/requirements.md)
- [开源选型与翻译方案](docs/research.md)
- [验收记录](docs/verification.md)
- [第三方组件与许可](THIRD_PARTY_NOTICES.md)

仓库目前为私有，应用源码未选定对外开源许可证。第三方组件保留各自许可证；当前构建用于个人测试。
