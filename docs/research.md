# 开源方案调研

调研日期：2026-09-28，实施更新于 2026-09-29。候选能力来自官方资料；本项目的实际验收结果另见 verification.md。

## 候选项目

| 项目 | 官方资料说明的能力 | 对本项目的价值与尚需验证之处 |
| --- | --- | --- |
| [BabelDOC](https://github.com/funstory-ai/BabelDOC) | 科学 PDF 翻译；指定页码、分批翻译、单语/双语输出、缓存、兼容云端和本地模型端点；AGPL-3.0 | 保版面翻译候选；需要验证句段映射的提取、公式保持和千页文件内存 |
| [PDFMathTranslate-next](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next) | 基于 BabelDOC，多翻译服务、Windows 使用方式和 Python 事件流；AGPL-3.0 | 适合封装翻译任务和供应商配置；不是已完成本需求的阅读器 |
| [Mozilla PDF.js](https://github.com/mozilla/pdf.js) | PDF 解析与渲染，支持部分批注类型；Apache-2.0 | 阅读内核候选；双语联动与统一批注数据需要在应用层实现 |
| [Zoro](https://github.com/ruihanglix/zoro) | Windows 桌面版、原文/译文左右展示、同步滚动、两侧批注、译文缓存；AGPL-3.0 | 与使用场景接近，适合研究阅读交互；README 没有证明跨语言批注双向对应或千页性能 |
| [PDF Scholar](https://github.com/emilmsh/pdf-scholar) | Windows 阅读、分栏、标记与批注、保存；项目标识 MIT | 阅读器交互和批注保存可参考；同一 PDF 多视图同步不能等同于两个语言版本之间的同步 |

## 翻译接口的重要边界

BabelDOC 的当前 README 将其直接 Python API 视作内部接口，建议通过 PDFMathTranslate-next 的 `do_translate_async_stream` 集成。应优先验证该入口并固定依赖版本。

[Python API 文档](https://github.com/PDFMathTranslate/PDFMathTranslate-next/blob/main/docs/en/advanced/API/python.md) 描述了进度、失败、完成事件及取消传播。进度事件本身并不保证已经生成可显示的页面文件；要实现边看边译，需要按页或小批任务产出结果并缓存。

PDFMathTranslate 组织内也有 [同名仓库](https://github.com/PDFMathTranslate/PDFMathTranslate-next)，页面标记为上述 PDFMathTranslate-next 组织仓库的 fork。选定实现时要记录实际源码来源和锁定版本，不能混用接口假设。

## 大文件策略

[PDF.js 官方 FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions) 建议只渲染可见页，并说明按范围读取文档的条件。不能在前端同时创建全部页面的高分辨率画布。

已采用：本地按需读取、可见页渲染、离开页面时释放渲染资源、有界译文缓存、逐页翻译。已验证 1000 页 / 95 MiB 合成样本；页数不等于文件体积或单页复杂度，仍需真实教材样本测量。

## 跨语言批注策略

英文和中文的行长、词序不同，复制像素坐标不能保证高亮对应译文。已实现统一标记 ID 和两侧独立几何。本地翻译保存模型 attention 对应信息，再在目标 PDF 的相邻文本块内定位短语；无法匹配时回退到整段并在界面标注。手绘与便笺按位置同步。

## 当前采用的架构

- Windows 桌面壳与阅读 UI：Electron + TypeScript + PDF.js。
- 翻译：独立 Python 工作进程，PDFMathTranslate-next 2.9.0 / BabelDOC 0.6.2。
- 数据：本地保存阅读状态、标记、译文缓存和任务队列。
- 引擎：默认 Argos en→zh 1.9 语言包，以 CTranslate2 CPU int8 运行；保留云端兼容 API 和 Ollama 端点。

## 免费本地翻译

[Argos Translate](https://github.com/argosopentech/argos-translate) 提供可下载的离线语言包。
本项目采用 [官方语言包目录](https://data.argosopentech.com/argospm/v1/) 中的 en→zh 1.9（约 67 MiB），固定 SHA-256 校验。
推理直接调用 CTranslate2 与 SentencePiece，不依赖公共免费翻译站点，也不需要注册账户。

语言包与 BabelDOC 模型/字体完成下载后，已通过阻断外网的整页翻译测试。小模型质量有限，复杂学术内容仍应参考原文。
Ollama 兼容端点可选用用户自行安装的大模型；本项目没有自动安装 Ollama 或额外多 GB 大模型。

## 集成注意事项

采用官方推荐的 `do_translate_async_stream` 门面。固定版本中用于选择进程执行方式的 debug 选项
也会影响 PDF 输出，因此本项目在独立翻译进程内创建关闭绘制调试框的布局配置，保持正式 PDF 干净。
未修改已安装的第三方源码。升级 pdf2zh-next 或 BabelDOC 时，必须重跑真实 PDF 与打包测试。

发布与依赖许可见仓库根目录 THIRD_PARTY_NOTICES.md。
