# 开源方案调研

调研日期：2026-09-28。以下能力来自项目官方 README、文档或许可证标识，尚未在本项目中实测。

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

拟采用：本地按需读取、可见页渲染、有界页面缓存、翻译分批与有限并发。页数不等于文件体积或单页复杂度，仍需真实教材样本测量。

## 跨语言批注策略

英文和中文的行长、词序不同，复制像素坐标不能保证高亮对应译文。需要统一标记 ID、原文与译文的文本锚点，以及两侧分别计算的几何位置。手绘可采用页面坐标映射；文字标记的对应粒度待用户确认。

## 初步架构候选

- Windows 桌面壳与阅读 UI：Electron + TypeScript + PDF.js。
- 翻译：独立 Python 工作进程，验证 PDFMathTranslate-next/BabelDOC 集成。
- 数据：本地保存阅读状态、标记、译文缓存和任务队列。
- 引擎：云端配置优先，同时保留本地模型端点；没有真实可用服务时不能宣称翻译验收通过。

以上为工程建议，尚未选定最终依赖或复制第三方代码。正式采用前确认发布方式和依赖许可，随后通过真实 PDF 验证排版、锚点、导出及性能。
