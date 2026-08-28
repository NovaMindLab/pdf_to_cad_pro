你是一个精通 Electron 桌面端开发与 Python 跨平台工程设计的资深系统架构师。

我现在需要开发一个桌面客户端，功能是：【将直接导出的矢量 PDF 图纸，高精度、离线地转换为标准的、兼容性极佳的 CAD DXF 文件】。
技术方案已定：使用 Electron 作为前端外壳与控制层，Python (ezdxf + pdfplumber) 作为计算核心，并通过 PyInstaller 将 Python 脚本打包为二进制可执行文件（作为 Sidecar 旁侧程序），供 Electron 主进程以子进程形式调用。

请为我编写一套完整的、生产环境可用的项目实现方案。具体要求如下：

### 1. 核心 Python 转换引擎 (converter.py)
利用 ezdxf 和 pdfplumber 编写高兼容性、高表现力的转换逻辑，必须处理好以下细节：
- 坐标系转换：PDF 默认 y 轴向下，CAD 默认 y 轴向上。请实现高精度的垂直镜像转换，并保留原图的长宽比。
- 图层划分 (Layers)：在 DXF 中初始化并自动划分标准图层：
  * "LINES" (线条，白色/黑色)
  * "RECTS" (矩形框)
  * "TEXTS" (文本层，绿色)
  * "POLYLINES" (多段线/曲线，青色)
- 字体处理：PDF 中的文本字符需要转换为 DXF 的 Text 或 MText 实体，保留原始字符、基准坐标位置和相对字体大小。
- 几何图元转换：
  * 直线：映射到 msp.add_line
  * 矩形：映射到 msp.add_lwpolyline（闭合多段线）
  * 曲线/多段线：合理使用 msp.add_lwpolyline 保留连续线条。
- 命令行接口 (CLI)：支持接收命令行参数 `--input <pdf_path>` 和 `--output <dxf_path>`，并在转换成功时输出标准 JSON 格式结果：`{"status": "success", "saved_to": "..."}`。若失败，输出：`{"status": "error", "message": "..."}`。

### 2. PyInstaller 打包配置
- 提供在 Windows (PowerShell) 和 macOS/Linux (Bash) 下将 converter.py 打包为单文件（--onefile）、无黑窗口控制台（--noconsole）可执行程序的命令行。
- 说明如何将打包产物命名为 `pdf-converter`（在 Windows 下为 `pdf-converter.exe`）。

### 3. Electron 主进程桥接 (main.js / ipcMain)
- 实现一个安全的 IPC 通信通道，监听 `convert-pdf-to-dxf` 事件。
- 编写子进程调用逻辑（使用 child_process.execFile），动态获取打包后的 Sidecar 路径（必须考虑生产环境 `app.isPackaged` / `process.resourcesPath` 路径和开发环境路径的自适应切换）。
- 解析 Python 进程输出的 JSON，将转换状态优雅地返回给渲染进程。
- 包含鲁棒的错误捕获，避免子进程崩溃导致主进程挂掉。

### 4. Electron 渲染进程与 UI 示例
- 提供一个精美的 HTML 极简拖拽上传界面（可以使用 CSS flex/grid 进行简单美化，带进度加载提示状态）。
- 编写 `preload.js` 暴露安全的 `contextBridge` API，以及渲染进程调用转换服务的事件处理脚本。

请直接输出所有文件的完整、无冗余、生产级代码，并附带简要的步骤配置指南，以便我能直接复制、运行并打包。