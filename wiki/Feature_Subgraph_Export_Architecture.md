# CAD 节点多选与局部子图导出 (Subgraph Export) 架构设计

本文档详细记录了在本项目中新增的**“CAD节点多选、框选、悬浮视口预览及局部图纸智能导出”**功能的全链路实现方案。

---

## 1. 业务需求与功能概述

在超大图幅的 CAD/PDF 解析重构场景中，用户往往只需提取某几个核心变电站（节点）及其关联网络进行二次编辑或分发。本模块实现了以下闭环能力：
- **无卡顿框选**：在复杂的 WebGL CAD 视口中，通过 `Shift + 左键拖拽` 瞬间框选并提取多个设备节点。
- **独立视口预览**：将选中的局部子图、拓扑连线，提取至独立的悬浮视口中实时预览（支持滚轮缩放与鼠标拖拽平移）。
- **智能底图捕获**：导出子图时，自动识别并捕捉原图纸的外边框、图例（Legend）及右下角表单（Title Block），使子图完美嵌回原有的标准图纸模板中。
- **底层 DXF 重建**：通过 Node.js IPC 联动底层 Python ezdxf 引擎，生成完全独立且原生兼容的局部 DXF 文件。

---

## 2. 前端高阶交互与 2D 空间检索 (Spatial Hashing)

传统的遍历方式在面对十万级图元时，会导致 `mousemove/mouseup` 框选事件严重掉帧卡顿。本功能深度复用了项目中既有的 `SpatialGrid` 空间哈希网格。

### 2.1 框选算法流程
1. **交互捕获**：拦截主画布的 `mousedown`，当检测到 `e.shiftKey` 时，屏蔽原有的画布平移逻辑，进入 `isBoxSelecting` 状态。
2. **可视反馈**：利用 THREE.js 注入半透明的蓝色平面 `selectionBoxMesh` 以及边框 `selectionBoxLine`，并在 `requestAnimationFrame` 中实时更新拉伸尺度。
3. **O(1) 数据捞取**：鼠标松开 `mouseup` 时，计算出实际 DXF 坐标域下的选择框 `bounds(minX, maxX, minY, maxY)`，直接调用 `_spatialGrid.queryBounds(bounds)`。引擎仅对落入框选覆盖的哈希网格单元进行检索，快速合并得到落在选区内的节点索引。

---

## 3. 图例与背景框架的智能捕捉算法 (Background Auto-Capture)

由于工程类 PDF/CAD 转换出来的节点都是离散的 `GROUP`、`LINE` 和 `TEXT`，为了避免用户导出的子图变成“光秃秃”的悬空线条，我们需要让系统**自动判断哪些元素属于静态图纸框架**并带入导出结果。

### 3.1 启发式检测算法
在 `renderer.js` 准备 `entitiesToExport` 导出集合时，执行以下自动捕获逻辑：

1. **关联连线**：对每个选中节点调用 `getConnectedExternalLines`（端点到节点轮廓距离 ≤ 8px），捞取外接光缆连线一并导出。
2. **节点旁描述文本**：在节点包围盒周围扩展搜索区（x ±20、y −30~+20），凡 `TEXT` 的**包围盒与搜索区相交**即视为该节点的描述。采用包围盒相交而非插入点判定，是因为光缆规格等文字常横跨节点边缘书写，插入点往往落在搜索区之外。
3. **连线旁描述文本**（`segToRectDist`）：对每条导出连线，计算线段到文本包围盒的最短距离（沿线段每 4px 采样点到矩形距离 + 矩形四角到线段距离），≤ 12px 即判定为该连线的规格描述（如 `A/24D/8.8km`），随子图导出。
4. **超大图框提取**：计算全图包围盒 `(gW, gH)`；若线条/矩形跨度超过全图尺寸的 `60%`，强制判定为最外层图纸外框并保留；未被选中的 `GROUP`（图纸中间的其他设备）一律忽略，确保不冗余。

---

## 4. 独立悬浮预览视口引擎 (Preview Viewport)

为了做到“所见即所得”，我们重用了基于 WebGL 的 `ThreeCadEngine` 架构。
1. **状态隔离**：在弹出层的 `<canvas id="preview-canvas">` 上实例化一个完全独立的 Engine，注入剥离出的 `entitiesToExport`。
2. **视角居中自适应**：通过对子图元重新计算局部 Bounding Box，利用相机的 `lookAt()` 与 `zoom` 矩阵运算，确保每次弹窗打开时图纸始终最大化铺满视口且居中。
3. **原生事件代理**：脱离了复杂的主编辑器状态机，为悬浮画布动态注入极简的原生 `mousedown/mousemove/wheel` 事件，更新 `camera.position` 与 `camera.zoom`，从而快速实现丝滑的图纸阅览。

---

## 5. IPC 通信与底层 Python 引擎集成

### 5.1 数据下发链路
- **Electron 前端**：用户点击“保存导出”，触发 `window.api.exportDxfSubgraph(jsonStr)`。
- **Electron 主进程**：由于截取的子图 JSON 字符串可能极大（轻易突破命令行长度限制），主进程采取“临时落盘”策略，将 JSON 写入操作系统 `Temp` 目录。
- **子进程唤起**：通过 `child_process.execFile`，携参数 `--mode export-subgraph --data temp.json --output user_selected.dxf` 拉起打包好的 `pdf-converter.exe` 二进制引擎。

### 5.2 Python 侧的 DXF 重建
在 `converter.py` 的新模式中：
1. 脱离 PyMuPDF 解析流，改为单纯的 JSON 解析流。
2. 实例化全新的 `ezdxf.new('R2010')` 文档。
3. 重建原有的标准图层（LINES、RECTS、TEXTS、POLYLINES）。
4. 递归遍历传入的 JSON 对象（处理 `LINE` 坐标系，将 `RECT`/闭合 `LWPOLYLINE` 转化为 AutoCAD 面域边界，将 `TEXT` 的插入点和高度映射回矢量模型空间）。
5. 持久化并安全返回 JSON 格式的执行结果给 Node 端。
