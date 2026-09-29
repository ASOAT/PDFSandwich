# PDFSandwich

Windows 中英对照 PDF 阅读与批注工具。默认使用免费的本地 HY-MT 专用英译中模型，提供浅色和深色主题。

## 使用

本机构建的安装程序位于 `release/0.2.1/PDFSandwich Setup 0.2.1.exe`。也可以运行
`release/0.2.1/win-unpacked/PDFSandwich.exe`；免安装版本需保留整个 `win-unpacked` 文件夹。
安装版不需要安装 Python、Node.js 或配置 API Key。当前为未签名的个人使用版本。

1. 打开或拖入可选中文字的英文 PDF。
2. 左侧原文、右侧中文。默认优先翻译当前页与邻页；“翻译整本”也从当前页开始，再继续其余页面。
3. 在任一侧滚动，另一侧跟随同一页及页内位置；顶部“同步阅读”可解除联动。
4. 选择高亮、下划线、手绘或批注工具，在任一侧标记。文字批注内容保持原样。
5. 点击“保存原 PDF”或按 **Ctrl+S**，将真正的 PDF 批注写回英文原文件。
   保存前自动在原文件旁的 `.pdfsandwich-backups` 目录创建备份。
6. 完成整本翻译后，可导出中文 PDF 或中英交替页 PDF。

高质量引擎首次下载 HY-MT 1.5 1.8B Q4 模型约 1.1 GB、Vulkan 运行时约 33 MB，以及约 330 MiB 排版模型和字体。
支持断点续传和 SHA-256 校验，下载后可离线翻译。另用 Argos 语言包（约 67 MiB）对齐现成译文，不改写 HY-MT 的翻译；设置中也保留 Argos 轻量 CPU 翻译引擎。
翻译按页排队，速度取决于页面复杂度；不是瞬间生成整本译文。

右上角月亮/太阳按钮切换主题。设置中可选择高质量/轻量本地引擎、云端 API 或本机 Ollama。
Gemini 免费额度预设需在 Google AI Studio 获取自己的密钥，受服务商地区、额度和项目计费配置限制；本项目不代开账户，也不保证云端始终免费。
**本地模式不会调用已保存的云端密钥。** 云端模式会向所选服务发送待翻译文字，并产生该服务的费用。

## 阅读与批注

- 连续滚动、缩放、适合页宽、页码跳转、PDF 目录、英文全文搜索；重开文件恢复页码、页内纵向位置和缩放比例。
- 高亮与下划线按原文/译文词句对应：专业术语匹配、固定译文 attention 对齐和逐字坐标定位，支持双向、换行与重复词消歧。仍可能存在语义偏差；没有可靠匹配时仅保留原侧标记，不再误划整个段落。
- 点击标记或侧栏批注，选择“校正对应位置”，再在同页另一侧选择对应文字。支持撤销、重做和原 PDF 保存。重译页面后会重新自动对应，因为译文及位置可能改变。
- 两侧页面至少按 2 倍像素密度绘制（单页 1600 万像素上限），缩放后重新渲染；有大留白的教材可以用 Ctrl+滚轮放大正文。
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
- 所有模型仍可能误译、漏译或改变语义。内置计算机/机器人学术语和“英文 = 中文”自定义词表提供提示，不是正确率保证。
- 重复、异常膨胀、公式占位符缺失会触发原文回退并显示提示。目录逐条排版；“重译本页”会跳过该页文字缓存。修改引擎/术语自动更新缓存身份，旧版乱码缓存不再使用。
- HY-MT 是受 Tencent HY Community License 约束的开放权重，许可原文随包附带；不同于无地域限制的 OSI 开源许可。
- 排版尽量保持原位，复杂 PDF 不能保证逐像素一致。整本按单页翻译，跨页上下文不参与翻译。
- 已实测 1000 页、约 95 MiB 的合成文档。另已检查用户 474 页机器人学教材的目录、正文和公式样本页；没有翻译验收整本，不能保证所有页都具有相同性能。

## 从源码运行（Windows x64）

需要 Node.js 22.12+（本机验证为 24.15）、Python 3.12 和 Git。

```powershell
npm ci
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements-lock.txt
.venv/Scripts/python.exe scripts/patch-layout.py
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
node scripts/quality-ui.mjs
node scripts/precision-ui.mjs
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
构建会核验并应用 BabelDOC 0.6.2 的两处导入替换：用经等价测试的轻量运算完成字形聚类和灰度相似度检查，避免首次排版加载不需要的大型计算库。
构建输出在 `release/`，不提交二进制文件、模型、密钥或文档缓存。

## 设计与验证

- [需求与实现边界](docs/requirements.md)
- [开源选型与翻译方案](docs/research.md)
- [验收记录](docs/verification.md)
- [第三方组件与许可](THIRD_PARTY_NOTICES.md)

仓库目前为私有，应用源码未选定对外开源许可证。第三方组件保留各自许可证；当前构建用于个人测试。
