# 常见用法语法

这是一份复制即用的语法速查，覆盖 Wikilink、`3d`、`3dgrid`、常用字段和快捷键。

## 不写语法的一键插入

把光标放到笔记中，打开命令面板，运行 **在笔记中插入 3D 模型**。
也可在编辑模式下右键选择同名操作。选中文件后按 Enter 即可插入，默认规则如下：

| 位置 | 默认尺寸 | 操作规则 |
|------|----------|----------|
| 正文、列表或引用的文字中 | 240 × 180 | 插入图片式预览，保留两侧文字。 |
| 表格单元格 | 160 × 120 | 自动转义尺寸分隔符，保留表格列。 |
| 空白行、空列表项或空引用项 | 400 × 300 | 插入模型预览，也可选择已登记零件展示。 |

插入窗口顶部显示当前位置和实际尺寸。搜索支持文件名和完整路径；文件列表显示名称、路径和格式，便于区分同名模型。窄窗口下选项自动改为单列。

需要其他尺寸时，在选择窗口中选小、中、大预设。保存零件展示时，将光标放在
空行的引用或列表前缀之后；正文文字和表格中可用预览上的“零件”按钮切换。
生成的零件代码块会保留引用和列表层级。没有登记时，预览提供“打开模型登记零件”
入口；登记完成后自动刷新原笔记，完整代码块不额外弹出空状态窗口。

取消保持原文，一次撤销即可恢复插入前内容。选择过程中切换笔记、改变正文或光标，
需要在目标位置重新运行命令。代码示例、笔记属性和表格分隔行不能插入预览。
手写嵌入语法和高级配置仍然可用。

## 笔记中的已登记零件

先打开模型文件完成零件登记。图片式嵌入的“零件”按钮切换正文拆解展示；
“放大查看”提供选择零件和零件间距等控制，“查看零件”打开完整检查窗口。
嵌入保留原有尺寸和正文、列表、引用、表格位置。

需要重新打开笔记后仍展示拆解结果时，使用 `3d` 配置：

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/model.glb" }],
  "height": 300,
  "parts": { "display": "registered", "separation": 100 }
}
```
````

`"parts": true` 是全部零件展示的简写。`parts.part` 可指定已登记零件 ID
或唯一的完整名称；“复制嵌入内容”会使用稳定 ID。`separation` 取值 0–100，
0 为装配原位置，100 为零件网格；`showUnregistered: true` 显示未登记几何体。
指定零件缺失或名称冲突时显示提示并隐藏几何体，不会自动换成其他零件。
控制按钮不改写正文；将复制的代码块粘贴到笔记中即可保存新配置。
完整检查窗口使用临时状态，返回后恢复正文的零件选择和零件间距。

## Wikilink 嵌入

```markdown
![[model.glb]]
![[model.glb|400x300]]
![[model.glb|240]]
![[Assets/3D/board.step]]
```

普通嵌入可像图片一样放在正文、列表、引用和表格中。`宽x高` 指定像素尺寸；
只写宽度时按默认 4:3 视口计算高度，省略尺寸时使用 400x300。宽度受所在区域限制。
悬停或键盘聚焦时显示“重置视图”“放大查看”和“零件”。放大后使用完整检查工具，
模型不重新加载，笔记排版不变。聚焦画布按 Enter 也可放大；Esc 先退出工具，再关闭窗口。
需要改尺寸时切到源码模式。

```markdown
文字前 ![[Assets/3D/model.glb|240x180]] 文字后

- 列表项 ![[Assets/3D/model.glb|180x120]]

> 引用内容 ![[Assets/3D/model.glb|200x140]]

| 位置 | 模型 |
| --- | --- |
| 单元格 | ![[Assets/3D/model.glb\|160x120]] |
```

表格中的尺寸分隔符必须写成 `\|`，避免被 Markdown 当作下一列。行内代码、代码围栏
和笔记属性里的语法示例不会变成模型。短链接按当前笔记路径解析；普通图片不受影响。

移动端优先使用直读格式。转换格式需要桌面端安装对应工具，除非已经存在 `.ai3d-converted.glb`。新的转换产物默认写入当前 vault 的 Obsidian 配置目录，通常是 `.obsidian/ai-model-workbench/converted-assets`，避免模型目录被产物刷屏；也可以在插件设置的“辅助文件夹”里改到指定库文件夹。

## 最小 `3d` 代码块

推荐把模型路径写在代码块内容里：

````markdown
```3d
model.glb
```
````

带 vault 文件夹路径：

````markdown
```3d
Assets/3D/model.glb
```
````

## 带配置的 `3d` 代码块

需要相机、灯光、场景、尺寸或模型选项时使用 JSON：

````markdown
```3d
{
  "models": [
    { "path": "Assets/3D/model.glb" }
  ],
  "camera": {
    "mode": "perspective",
    "fov": 30,
    "position": [5, 5, 5],
    "lookAt": [0, 0, 0]
  },
  "scene": {
    "grid": true,
    "axis": true,
    "autoRotate": false
  },
  "width": "100%",
  "height": 500
}
```
````

`3d` 是单模型预览。如果 `models` 里写了多个模型，只会使用第一个，控制台会提示改用 `3dgrid`。

## 常用 `3d` 字段

| 配置段 | 字段 |
|--------|------|
| `models[]` | 必填 `path`，可选 `color`、`wireframe` |
| `camera` | `position`、`lookAt`、`fov`、`mode`、`zoom`、`near`、`far` |
| `lights[]` | `type`、`color`、`intensity`、`position`、`target`、`castShadow`、`angle`、`penumbra`、`decay`、`groundColor` |
| `scene` | `background`、`transparent`、`autoRotate`、`autoRotateSpeed`、`groundShadow`、`grid`、`axis` |
| `stl` | STL 默认 `color`、`wireframe` |
| 顶层 | `width`、`height` |

相机模式：

- `perspective`
- `orthographic`

灯光类型：

- `hemisphere`
- `directional`
- `point`
- `spot`
- `ambient`
- `attachToCam`

## 自动旋转和网格

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/model.glb" }],
  "scene": {
    "autoRotate": true,
    "autoRotateSpeed": 0.3,
    "grid": true,
    "axis": true,
    "groundShadow": true
  }
}
```
````

## 正交相机

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/part.stl" }],
  "camera": { "mode": "orthographic" },
  "scene": { "grid": true, "axis": true }
}
```
````

## STL 颜色覆盖

````markdown
```3d
{
  "models": [
    { "path": "Assets/3D/part.stl", "color": "#44aa88" }
  ],
  "scene": { "autoRotate": true }
}
```
````

## 线框预览

````markdown
```3d
{
  "models": [
    { "path": "Assets/3D/model.glb", "wireframe": true }
  ],
  "scene": { "background": "#000000" }
}
```
````

## `3dgrid` 对比

`3dgrid` 用于多模型布局，当前明确保留 Babylon.js 后端。

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/design-v1.step" },
    { "path": "Assets/3D/design-v2.step" }
  ],
  "preset": "compare",
  "rowHeight": 420
}
```
````

## `3dgrid` 图库

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/bolt-m6.glb" },
    { "path": "Assets/3D/bolt-m8.glb" },
    { "path": "Assets/3D/washer-m6.glb" },
    { "path": "Assets/3D/washer-m8.glb" }
  ],
  "preset": "gallery",
  "columns": 2,
  "rowHeight": 320
}
```
````

## `3dgrid` 自定义组合

````markdown
```3dgrid
{
  "models": [],
  "preset": "compose",
  "direction": "horizontal",
  "sections": [
    {
      "preset": "compare",
      "models": [
        { "path": "Assets/3D/housing.step" },
        { "path": "Assets/3D/lid.step" }
      ],
      "weight": 1
    },
    {
      "preset": "showcase",
      "models": [
        { "path": "Assets/3D/assembly.step" }
      ],
      "weight": 1
    }
  ]
}
```
````

## `3dgrid` 字段

| 字段 | 说明 |
|------|------|
| `models` | 模型路径或模型配置对象 |
| `preset` | `compare`、`showcase`、`explode`、`timeline`、`gallery`、`compose` |
| `params` | preset 专用参数 |
| `sections` | `compose` 自定义布局需要 |
| `direction` | `horizontal` 或 `vertical` |
| `columns` | gallery/grid 列数 |
| `rowHeight` | 像素高度或 `auto` |
| `gapX`、`gapY` | 横向/纵向间距 |
| `camera`、`lights`、`scene` | 与 `3d` 代码块相同 |

## 支持的扩展名

| 类型 | 扩展名 |
|------|--------|
| 直读 | `.glb`、`.gltf`、`.stl`、`.obj`、`.ply` |
| 显式启用 Three.js 后直读 | `.3mf`、`.dae`、`.off`、`.pcd`、`.xyz`；未注册转换器或移动端的 `.fbx` |
| 桌面端转换 | `.step`、`.stp`、`.iges`、`.igs`、`.brep`、`.sldprt`、`.3mf`、`.dae`、`.fbx` |

启用 Three.js 渲染器和“阅读 + 文件视图”后可使用新增直读格式；“仅阅读界面”只启用嵌入预览。
PCD/XYZ 必须使用 Three.js。OBJ 转换优先设置和桌面端已注册的 FBX 转换器仍然优先。
3MF/DAE/FBX 直读纹理必须嵌入模型，带外部纹理的模型请先转换为 GLB。

SPLAT 在社区发布包中暂时禁用，直到 loader 恢复为完全本地-only 实现。

## 预览快捷键

| 按键 | 操作 |
|------|------|
| `R` | 重置视图 |
| `W` | 切换线框 |
| `G` | 切换方向指示器 |
| `B` | 切换包围盒 |
| `Space` | 播放或暂停动画 |
| `M` | 切换测量模式 |
| `Esc` | 先取消未完成的测量端点，再退出当前模式；在“更多”上收起额外操作 |

预览快捷键在画布获得焦点时生效。Esc 也可用于工具栏；标注编辑器保留自己的 Esc 行为。
