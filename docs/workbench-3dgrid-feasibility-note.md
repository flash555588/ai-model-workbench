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
- focusWorldPoint
- explode / reset
- render quality / render scale
- focus selection / wireframe / bounding box / orientation gizmo
- snapshot / model info / selected part info

这说明 Three.js 作为“单模型主链”已经成立，并且关键交互能力已经开始对齐 workbench 契约；是否切换 workbench 的核心问题已经从“能力完全缺失”转为“路由、格式覆盖、验证面和 `3dgrid` 统一收益是否足够”。

### 3.3 阻塞缺口

当前不建议立刻把 workbench 切到 Three.js，原因不是“还没试”，而是迁移缺口已经转移到工作流级别：

1. workbench 入口仍通过 `requireWorkbenchFeatures=true` 固定回落到 Babylon，尚未开放 Three 路由。
2. Three 的 workbench 级关键接口已经进入隐藏能力探针，但这个探针仍是验证模式，不等于生产 workbench 路由已经开放。
3. workbench 仍承接转换链输入；即使 Three 支持直接 `GLB` / `GLTF` / `STL` / `PLY` / `OBJ`，也需要确认转换后路径、缓存路径、贴图资源和错误反馈在工作台内一致。
4. `3dgrid` 仍是独立 Babylon 多视口 renderer；如果 workbench 单独切到 Three，统一栈收益仍然有限。

换句话说，direct view 已经能切到 Three，是因为它的验证面更窄；workbench 下一步不再是补一个单点接口，而是要把完整工作流验证、转换链和回退策略一起纳入。

### 3.4 决策

结论：**workbench 暂不迁移到 Three.js，继续保留 Babylon.js 作为专项能力后端。**

主要理由：

- direct view 已经覆盖更高频的单模型编辑场景。
- workbench 保留下来的价值，正集中在转换链、explode / focusWorldPoint 等更重交互组合，以及知识面板联动。
- 如果只做“GLB-only 的 Three workbench”，会把 workbench 自己再切成两种体验，收益不够高。
- 即使 workbench 迁过去，只要 `3dgrid` 还在 Babylon，统一栈收益也会被明显打折。

### 3.5 重开条件

只有在以下条件满足后，才建议重新打开 workbench 迁移议题：

- Three 的 `focusWorldPoint`、explode / reset、标注和工具栏联动通过真实 workbench UI、转换链和错误反馈验证
- 团队确认 workbench 可以接受 Three 直接格式覆盖范围，或转换链输出统一进入 Three 可承载的路径
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

## 5. 剩余迁移缺口

如果未来要继续推进统一栈，当前剩余缺口已经不再是单个 `ModelPreview` 接口，而是生产路径与工作流验证：

- 决定是否开放 workbench 到 Three 的生产路由，以及失败时的回退策略
- 用真实 workbench UI 覆盖标注、聚焦、explode、工具栏和知识面板联动
- 验证转换链输出、缓存路径、贴图资源和错误反馈
- 明确 workbench 是否继续支持非 `GLB` 输入，或者统一转成 Three 可承载的资源路径
- 新的 Three grid renderer（多视口 / preset / snapshot / export）

这份缺口列表说明 workbench 迁移已经进入产品工作流层面，也说明了为什么 `3dgrid` 现在不该继续迁。

---

## 6. 原型验证结果

本次没有把 “Three workbench” 或 “Three `3dgrid`” 接入生产主路径。workbench 已经有隐藏 Three 能力探针，用来确认关键契约是否可承载；`3dgrid` 仍未接入 Three 原型，因为它不是 `ModelPreview`，而是独立 grid renderer 体系。

- workbench 生产路径仍要求更完整的转换链、知识面板和错误反馈验证
- Three 能力探针只证明关键接口可用，不代表要立即改变默认路由
- `3dgrid` 路径仍需要新的 Three grid renderer 才能迁移

因此本次评估采取的验证标准是：

1. 确认 Three 单模型主链已稳定成立。
2. 确认 workbench 缺口已经从接口补齐转为工作流验证与生产路由决策。
3. 在此基础上给出是否继续迁移的决定。

最终结论：

- Three.js 负责单模型主链
- Babylon.js 保留 production workbench 和 `3dgrid` 专项能力
- Three workbench 保留为受验证的候选路径，等真实工作流验证完成后再决定是否开放

这与路线图中的“终态 A + 终态 B”一致，也是当前收益最高、风险最低的落点。
