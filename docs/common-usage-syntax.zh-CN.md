# 常见用法语法

这是一份复制即用的语法速查，覆盖 Wikilink、`3d`、`3dgrid`、常用字段和快捷键。

## Wikilink 嵌入

```markdown
![[model.glb]]
![[model.glb|400x300]]
![[Assets/3D/board.step]]
```

移动端优先使用直读格式。转换格式需要桌面端安装对应工具，除非已经存在 `.ai3d-converted.glb`。新的转换产物会写入 `.obsidian/ai-model-workbench/converted-assets`，避免模型目录被产物刷屏。

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
| 桌面端转换 | `.step`、`.stp`、`.iges`、`.igs`、`.brep`、`.sldprt`、`.3mf`、`.dae`、`.fbx` |

SPLAT 在社区发布包中暂时禁用，直到 loader 恢复为完全本地-only 实现。

## 预览快捷键

| 按键 | 操作 |
|------|------|
| `R` | 重置视图 |
| `W` | 切换线框 |
| `G` | 切换方向指示器 |
| `B` | 切换包围盒 |
| `Space` | 播放或暂停动画 |
| `Esc` | 退出标注模式 |
