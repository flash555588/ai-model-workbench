# 使用指南

这份指南说明 AI Model Workbench 的日常工作流。需要复制即用的 Markdown
片段时，请看 [常见用法语法](common-usage-syntax.zh-CN.md)。

## 选择预览入口

| 入口 | 适合场景 | 渲染契约 |
|------|----------|----------|
| Wikilink 嵌入 | 在笔记里快速预览模型 | `GLB/GLTF/STL/PLY/OBJ` 默认走 Three.js |
| `3d` 代码块 | 单模型预览，并自定义相机、灯光、场景 | 直读单模型格式走 Three.js |
| `3dgrid` 代码块 | 多模型对比或预设布局 | 保留 Babylon.js grid 后端 |
| 直接文件视图 | 检查、标注、测量、截图、生成知识笔记 | 直读格式走 Three.js；转换和保守 workbench 路线保留 fallback |

优先使用直读格式：`GLB`、`GLTF`、`STL`、`PLY`、`OBJ`。桌面端安装对应工具后，可以把
`STEP`、`STP`、`IGES`、`IGS`、`BREP`、`SLDPRT`、`3MF`、`DAE`、`FBX`
转换为本地 GLB 预览资产。

## 直接文件视图工作流

在 Obsidian 文件列表中点击受支持的模型文件即可打开直接查看页。它是单模型审阅的主入口。

推荐流程：

1. 从 vault 中直接打开模型文件。
2. 查看 route/status 和模型摘要。
3. 旋转、平移、缩放、聚焦部件，按需切换线框和包围盒。
4. 添加标注或测量记录。
5. 复制模型/部件信息，或保存当前视口截图。
6. 证据足够后生成知识笔记。

默认情况下，`GLB/GLTF/STL/PLY/OBJ` 直接文件视图走 Three.js。转换格式和保守
workbench 路线保留 Babylon.js fallback，除非显式启用实验性 Three workbench 路径。

## 标注

标注是按模型保存的持久化书签。直接文件视图中：

1. 点击工具栏的标签图标。
2. 点击模型表面放置标注点。
3. 输入标签并选择颜色。
4. 点击已有标注可编辑或删除。
5. 按 `Esc` 退出标注模式。

保存后的标注会在笔记预览中以只读叠层显示。被几何遮挡的标注会变暗和模糊，减少标签和模型空间位置脱节的问题。

## 测量

当当前渲染器支持测量契约时，可以使用测量工具记录距离。测量支持单位校准、各轴差值，并可复制为 Markdown。

建议：

- 模型难以取点时先重置视图。
- 重复测量优先使用直接文件视图。
- 清空测量前先把需要的记录复制到分析笔记。
- 对极小零件，依赖当前 Three.js 的相机和标记尺寸自适应，不要手动放大模型数据。

## 截图和 Markdown 导出

| 操作 | 输出 |
|------|------|
| 复制模型信息 | 网格数、三角面、顶点、材质和包围盒等 Markdown 摘要 |
| 复制选中部件信息 | 选中 mesh/候选部件后的部件摘要 |
| 复制/保存/下载截图 | 当前视口 PNG |
| 复制测量 | Markdown 测量记录 |

截图默认保存到 `Media/3D Previews`。

## 知识笔记

`Generate note` 会写入一组基于证据的知识资产：

- `Analysis/3D Reports` 下的模型报告。
- JSON analysis sidecar，包含预览摘要、部件候选、警告和 pipeline 元数据。
- 知识索引，集中链接报告、sidecar、截图、标注和部件笔记。
- `Parts/3D Components` 下最多 8 个第一版部件笔记草稿。
- `Media/3D Previews` 下的当前视口证据截图。
- 基于证据、标注和 profile notes 的本地可编辑草稿。

知识生成默认完全本地。可选远程草稿只会向你配置的 `POST /draft-note` 发送经过裁剪的
drafting input；原始模型上传会被阻止。

## 部件证据和小零件

部件候选来自渲染器证据，而不是自由猜测。

- 命名的 `GLB/GLTF` 节点、group 和 `extras.ai3d` 组件元数据会成为更高置信度的候选部件。
- STEP 转换会尽量保留 XDE 组件标签，方便 PCB reference designator 和 CAD 装配子件继续保留身份。
- 螺丝、针脚、连接器、电子元件等语义明确的小零件会尽量保留为独立候选。
- 大量无语义的极小碎片会合并为低置信度 detail cluster，避免切得过碎。
- 报告、sidecar、draft input、部件笔记和注册 profile 会保留格式血缘，例如 `STEP -> GLB (convert)`，但不会把转换后的绝对文件路径写进笔记。

从其它建模软件导出时，尽量保留对象名、组件层级、材质名和装配标签。不要把所有 mesh 合并成一个匿名对象，否则小零件证据会明显变弱。

## 转换工作流

直读格式不需要外部工具。桌面端转换格式依赖本地命令：

| 格式族 | 工具 |
|--------|------|
| `STEP/STP`、`IGES/IGS`、`BREP` | Python + CadQuery/OCCT |
| `SLDPRT` | FreeCAD |
| `3MF`、`DAE` | Python + trimesh |
| `FBX` | FBX2glTF |
| 可选 OBJ 标准化 | obj2gltf |

转换失败时，优先打开插件设置里的 converter diagnostics。诊断会区分命令缺失、转换器未启用、不安全路径、超时、缓存陈旧、输出缺失等状态，并在复制诊断报告时隐藏敏感本地路径。

## 性能建议

- 丰富材质、层级和重复查看优先用 `GLB/GLTF`。
- 避免在同一篇笔记里堆太多互不相关的预览。
- 多模型对比优先用 `3dgrid`，而不是堆很多单模型代码块。
- 弱 GPU 上降低渲染质量或 render scale。
- 转换重格式优先用桌面端 Obsidian。
- 移动端建议使用直读格式，并接受为了流畅度降低分辨率。

## 排查入口

| 现象 | 优先检查 |
|------|----------|
| 模型加载失败 | 文件是否在 vault 内、扩展名是否受支持 |
| GLTF 缺资源 | `.bin` 和纹理是否在 `.gltf` 旁边或相对引用目录内 |
| OBJ 缺纹理 | `.mtl` 和贴图是否与 OBJ 同目录 |
| CAD 转换失败 | converter diagnostics 中的 Python/FreeCAD 是否可启动 |
| 渲染路线不符合预期 | 将日志级别设为 `info` 或 `debug`，查看 `backend`、`reason`、`rendererRollout` |
| 预览卡顿 | 降低渲染质量/比例，或减少同时显示的预览数量 |

渲染路由细节见 [Preview Routing Matrix](preview-routing-matrix.md)。
