# Workbench 与 3dgrid 迁移评估

## 1. 评估范围

本文完成路线图中的两个评估目标：

1. 阶段 3：评估 workbench 是否值得继续迁到 Three.js。
2. 阶段 4：决定 `3dgrid` 是否需要迁到 Three.js。

本次评估基于当前代码状态，而不是基于“理论上能否实现”。

---

## 2. 已验证的 Three.js 覆盖面

当前已经稳定并通过验证的 Three.js 路径：

- 简单单模型 `GLB` 预览
- 单模型 `GLB` 的 readonly annotations
- direct file view 的单模型 `GLB` edit annotations

已执行的验证：

- `npm run verify:preview`
- `node scripts/verify-preview.mjs --mode direct-edit`

这意味着 Three.js 已经覆盖“高频阅读态”和“轻量单模型编辑态”的核心路径。

---

## 3. Workbench 评估结论

### 3.1 当前 workbench 真实依赖

workbench 不是单纯的“打开一个模型”，它当前还依赖：

- 编辑态标注
- 点击 pin 后将相机聚焦到世界坐标
- explode slider / reset
- 动画播放控制
- 更完整的摘要、选中部件、标签、模板插入联动
- 非 `GLB` 输入链路（通过 `prepareModelInput()` 进入转换流程）

这些依赖在代码里的入口很明确：

- `focusPin()` 调用 `preview.focusWorldPoint(...)`
- 分解面板调用 `preview.setExplode(...)` / `preview.resetExplode()`
- workbench 加载模型时固定传入 `requireWorkbenchFeatures=true`
- workbench 模型准备流程仍允许转换后的非 `GLB` 输入

### 3.2 Three.js 当前已经具备的部分

Three 预览当前已经具备：

- annotation provider
- pick world point
- readonly / direct-view edit annotation overlay 支持
- 动画播放开关
- render quality / render scale
- focus selection / wireframe / bounding box / orientation gizmo
- snapshot / model info / selected part info

这说明 Three.js 作为“单模型主链”已经成立，但还没有形成完整的 workbench 能力面。

### 3.3 阻塞缺口

当前不建议把 workbench 切到 Three.js，原因不是“还没试”，而是已经能明确看到以下缺口：

1. `ThreeModelPreview` 还没有 `focusWorldPoint(point)`。
2. `ThreeModelPreview` 还没有 `setExplode(factor, axis)`。
3. `ThreeModelPreview` 还没有 `resetExplode()`。
4. Three 当前只接受 `GLB`；而 workbench 仍然承接 `GLTF` / `STL` / 转换链输入。
5. `WorkbenchPreview` 类型本身就要求 `setExplode`、`resetExplode`、`focusWorldPoint`，这不是简单改路由就能过去的缺口。

换句话说，direct view 能切到 Three，是因为它只需要 edit annotations；workbench 不能照搬这条路，因为它额外依赖的正是 Three 目前还缺的那部分能力。

### 3.4 决策

结论：**workbench 暂不迁移到 Three.js，继续保留 Babylon.js 作为专项能力后端。**

主要理由：

- direct view 已经覆盖更高频的单模型编辑场景。
- workbench 保留下来的价值，正集中在 explode / focusWorldPoint / 更重交互能力。
- 如果只做“GLB-only 的 Three workbench”，会把 workbench 自己再切成两种体验，收益不够高。
- 即使 workbench 迁过去，只要 `3dgrid` 还在 Babylon，统一栈收益也会被明显打折。

### 3.5 重开条件

只有在以下条件满足后，才建议重新打开 workbench 迁移议题：

- Three 具备稳定的 `focusWorldPoint`
- Three 具备 explode / reset 等价实现
- 团队确认 workbench 可以接受 `GLB-only`，或 Three 获得更宽的格式支持
- `3dgrid` 的后端策略也发生变化

---

## 4. `3dgrid` 评估结论

### 4.1 当前 `3dgrid` 的技术形态

`3dgrid` 不是 workbench 的“简化版”，而是一套独立渲染器契约：

- `PreviewGridRenderer` 是独立接口，不是 `ModelPreview`
- `createGridRenderer()` 当前直接返回 Babylon grid renderer
- Babylon grid 使用一个 Scene + 多个 Camera + 多个 viewport
- 每个 cell 通过 `layerMask` 隔离，可支持 preset 布局和单 canvas 多视口渲染
- `compare` / `gallery` / `compose` / `timeline` 等 preset 已经围绕这套模型组织

这说明 `3dgrid` 迁移不是“把路由改成 Three.js”，而是要新写一套 Three grid renderer。

### 4.2 迁移成本与收益判断

如果把 `3dgrid` 迁到 Three.js，至少要重建：

- 多视口 camera 编排
- placement / cell layout 映射
- 多模型共享场景与快照导出
- 现有 preset 结果到 Three renderer 的装配逻辑
- wireframe / reset / export info 等辅助能力

而当前 `3dgrid` 已经：

- 行为稳定
- 能承载现有 preset
- 没有因为 Babylon 而阻塞单模型主链迁移

因此它带来的主要收益会是“技术统一”，而不是用户体验跃迁。

### 4.3 决策

结论：**`3dgrid` 暂不迁移到 Three.js，继续保留 Babylon.js 作为 grid 专项后端。**

### 4.4 重开条件

只有在以下条件同时更明确时，才建议重新评估：

- 团队明确要继续缩小 Babylon 依赖面
- 已有清晰的 Three 多视口编排方案
- Babylon grid 的维护成本已经高于重写成本
- `3dgrid` 本身获得新的产品诉求，要求与单模型 Three 路径深度统一

---

## 5. 必需接口缺口列表

如果未来要继续推进统一栈，至少需要补齐这些缺口：

- `focusWorldPoint(point)`
- `setExplode(factor, axis)`
- `resetExplode()`
- 必要时补齐与 explode 对应的交互/状态管理
- 明确 workbench 是否继续支持非 `GLB` 输入
- 新的 Three grid renderer（多视口 / preset / snapshot / export）

这份缺口列表既适用于 workbench，也说明了为什么 `3dgrid` 现在不该继续迁。

---

## 6. 原型验证结果

本次没有把 “Three workbench” 或 “Three `3dgrid`” 原型接入主代码路径，原因是当前阻塞点已经出现在接口边界本身：

- workbench 路径要求 `WorkbenchPreview`
- Three 预览当前并不满足 `WorkbenchPreview` 的必需方法
- `3dgrid` 路径甚至不是 `ModelPreview`，而是独立的 grid renderer 体系

因此本次评估采取的验证标准是：

1. 确认 Three 单模型主链已稳定成立。
2. 确认 workbench / `3dgrid` 缺口不是“只差路由开关”，而是独立能力缺口。
3. 在此基础上给出是否继续迁移的决定。

最终结论：

- Three.js 负责单模型主链
- Babylon.js 保留 workbench 和 `3dgrid` 专项能力

这与路线图中的“终态 A + 终态 B”一致，也是当前收益最高、风险最低的落点。
