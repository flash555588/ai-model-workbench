# Three.js 迁移目标路线

## 1. 背景

当前插件处于双渲染栈阶段：

- Three.js：用于简单 `GLB` 预览。
- Babylon.js：用于标注、工作台、`3dgrid`、直接文件视图，以及更重的交互能力。

这种分流在短期内降低了迁移风险，但长期会带来三类成本：

- 渲染能力分散，行为差异越来越难维护。
- 新功能要在两套运行时之间反复判断归属。
- 调试、性能优化、缺陷修复的成本被放大。

因此需要明确一条目标路线：在不打断现有用户工作流的前提下，逐步提升 Three.js 的覆盖面，并在每个阶段保留中途止损或保持混合架构的选择权。

---

## 1.1 当前状态

- 阶段 0：已完成
- 阶段 1：已完成
- 阶段 2：已完成
- 阶段 3：已完成 — 评估结论：workbench 保留 Babylon.js
- 阶段 4：已完成 — 评估结论：3dgrid 保留 Babylon.js
- 阶段 5：已完成 — Three.js 支持 GLB/GLTF/STL/PLY/OBJ 五种格式
- SPLAT：保留 Babylon.js

---

## 2. 目标

### 2.1 总目标

将 Three.js 提升为网格模型预览的主渲染栈，优先覆盖最常用、最稳定、最能直接降低维护成本的路径。

### 2.2 阶段目标

1. 保持现有简单 `GLB` 预览稳定运行在 Three.js。
2. 让单模型 `GLB` 的只读标注预览也可运行在 Three.js。
3. 让直接文件视图在 `GLB` 场景下可以切换到 Three.js。
4. 评估工作台和 `3dgrid` 是否值得继续迁移，或保留 Babylon 作为专项能力后端。

### 2.3 非目标

以下内容不作为第一阶段必须完成项：

- 一次性移除 Babylon.js。
- 立即将 `OBJ`、`PLY`、`STL`、CAD 转换链全部并入 Three.js。
- 在没有等价交互能力前强行把工作台迁到 Three.js。
- 为追求统一而牺牲现有标注、分解、聚焦、导出等关键工作流。

---

## 3. 目标终态

推荐将“目标终态”定义为分层终态，而不是预设“完全替换 Babylon”：

### 终态 A：Three.js 成为主链

- 简单 `GLB` embed
- 单模型只读标注预览
- 单模型直接文件视图
- 常用工具栏能力（聚焦、线框、包围盒、方向轴、快照）

### 终态 B：Babylon.js 保留专项能力

- `3dgrid`
- 工作台编辑态标注
- 爆炸/分解
- 更复杂的相机驱动与未来高级交互

### 终态 C：仅在收益明确时继续统一

只有当 Three.js 已经具备稳定的标注投影、遮挡判断、编辑链路和多视口编排后，才进入“工作台 / `3dgrid` 统一”议题。

这个定义的核心是：先把大部分高频路径收敛，再决定是否继续追求单栈。

---

## 4. 分阶段路线

## 阶段 0：收紧边界与观测

### 目标

先把“哪些路径必须留在 Babylon，哪些路径应该优先迁移”说清楚，并补齐最基础的观测。

### 交付项

- 明确渲染路径矩阵：
  - 简单 `3d`
  - 只读标注 `3d`
  - Live Preview
  - direct view
  - workbench
  - `3dgrid`
- 给 Three / Babylon 分流增加更清晰的调试日志。
- 为迁移路径准备最小测试样例：
  - 无标注 `GLB`
  - 有只读标注 `GLB`
  - 编辑态标注 `GLB`
  - `3dgrid compare`
  - `3dgrid gallery`

### 验收标准

- 能快速判断一次预览实际走的是哪条渲染链。
- 有稳定的测试 vault 和测试文档可复现每条路径。

### 预计投入

- 0.5 到 1 天

---

## 阶段 1：Three.js 支持单模型只读标注

### 目标

把“单模型 `GLB` + readonly annotations”从 Babylon 迁到 Three.js。

### 为什么先做这一层

- 用户价值高：这条路径已经覆盖阅读态的大部分场景。
- 技术边界清晰：只需要只读标注，不需要完整编辑工作台。
- 对整体架构收益大：能明显缩小 Babylon 在普通笔记阅读场景中的存在范围。

### 关键能力

- `getAnnotationProvider()`
- 世界坐标到屏幕坐标投影
- 标注点遮挡判断
- 相机状态 key 输出
- 与 `AnnotationManager` 现有接口对齐

### 建议实现顺序

1. 在 Three 预览中补齐 annotation provider。
2. 接通只读 pin overlay。
3. 验证滚动、缩放、旋转时 pin 跟随是否稳定。
4. 验证遮挡策略在多角度下没有明显闪烁。
5. 将 `GLB + readonly` 分流改到 Three.js。

### 验收标准

- `3d` 代码块内的有 pin `GLB` 走 Three.js。
- 保存的 pin 能在 Reading / Live Preview 中稳定显示。
- 遮挡行为和 Babylon 路径相比没有明显退化。
- 工具栏现有功能不回退。

### 预计投入

- 2 到 4 天

---

## 阶段 2：Three.js 接管单模型 direct view

### 目标

让直接点击 `GLB` 文件打开的单模型视图优先走 Three.js。

### 原因

direct view 比 workbench 更轻，但又比 embed 更接近完整使用场景，是迁移后的第二个高价值节点。

### 关键能力

- 编辑态标注创建
- pick 结果稳定回传
- 标注编辑框锚定
- 只在单模型 `GLB` 上开启 Three.js 路径

### 约束

如果编辑态标注体验明显差于 Babylon，则 direct view 不应强行切换。

### 验收标准

- `GLB` direct view 默认走 Three.js。
- 添加、编辑、删除 pin 全链路可用。
- 快照、聚焦、线框、包围盒、方向轴正常。
- 交互时无明显卡顿或 pin 偏移。

### 预计投入

- 3 到 5 天

---

## 阶段 3：评估 workbench 迁移可行性

### 目标

不是立刻迁移工作台，而是先做可行性判断。

### 工作台要求

workbench 当前依赖的不只是“显示模型”，还包括：

- 编辑态标注
- `focusWorldPoint`
- explode / reset
- 动画控制
- 更完整的模型摘要和面板联动

### 关键问题

需要先回答三个问题：

1. Three.js 是否值得承载 explode / disassembly 这类高交互能力？
2. Three.js 工作台如果实现，只覆盖 `GLB` 是否足够？
3. 如果 `3dgrid` 仍保留 Babylon，工作台统一带来的真实收益还有多大？

### 决策门

若以下任一结论成立，则 workbench 可以继续保留 Babylon：

- Three 的标注编辑态仍显著弱于 Babylon。
- explode / disassembly 的实现复杂度过高。
- 统一栈的收益不足以覆盖维护成本。

### 交付项

- workbench 迁移 feasibility note
- 剩余迁移缺口列表
- 原型验证结果

### 评估结论

- 当前不建议继续迁移 workbench。
- workbench 继续保留 Babylon.js 作为专项能力后端。
- Three workbench 保留为隐藏能力探针，等真实工作流验证完成后再决定是否开放生产路由。
- 结论详见 `docs/workbench-3dgrid-feasibility-note.md`。

### 预计投入

- 2 到 3 天评估
- 若继续实现，再额外 1 到 2 周

---

## 阶段 4：决定 `3dgrid` 去留

### 目标

明确 `3dgrid` 是否需要迁到 Three.js。

### 判断原则

优先看产品价值，不预设答案。

如果 `3dgrid` 满足以下任一情况，可以继续保留 Babylon：

- 多视口布局在 Babylon 中已经稳定。
- Three 迁移只能换来“技术统一”，但用户收益不明显。
- 迁移会显著拉高复杂度或回退性能。

### 只有在以下条件同时满足时再迁移

- 单模型 Three 路径已经稳定上线。
- 标注和 direct view 已经通过真实使用验证。
- 团队确认长期要减少 Babylon 依赖面。
- 已有清晰的 Three 多视口编排方案。

### 评估结论

- 当前不建议迁移 `3dgrid`。
- `3dgrid` 继续保留 Babylon.js 作为 grid 专项后端。
- 结论详见 `docs/workbench-3dgrid-feasibility-note.md`。

### 预计投入

- 评估：1 到 2 天
- 实施：1 到 2 周以上

---

## 5. 发布策略

### 5.1 路径开关

所有迁移都应走可回退分流，而不是一次性硬切。

建议保留以下控制方式之一：

- 内部 feature flag
- 按场景分流
- 按文件类型和能力分流

当前实现采用插件设置中的“预览兼容模式”：

- `Compatibility mode`（内部值：`babylon-safe`）
- `Reading surfaces only`（内部值：`three-readonly-glb`）
- `Reading + file view (Recommended)`（内部值：`three-direct-glb`）

默认档位为 `Reading + file view (Recommended)`，对应当前阶段 2 已完成后的推荐发布状态。

### 5.2 发布节奏

建议按阶段发布：

1. 阶段 1 发布：Three readonly annotations
2. 阶段 2 发布：Three direct view for `GLB`
3. 阶段 3 后再决定是否推进 workbench

当前设置档位与发布节奏一一对应：

- `Compatibility mode`（`babylon-safe`）：完整回退到 Babylon 单模型主链
- `Reading surfaces only`（`three-readonly-glb`）：对应阶段 1
- `Reading + file view (Recommended)`（`three-direct-glb`）：对应阶段 2

### 5.3 回退原则

只要出现以下任一问题，立即回退到 Babylon 路径：

- pin 投影明显错位
- 遮挡逻辑频繁闪烁
- 编辑态 pin 不稳定
- 快照、聚焦或工具栏行为回退

当前回退动作：

- 将插件设置中的“预览兼容模式”切回 `Compatibility mode`
- 重新加载受影响的预览或重新打开笔记/文件视图

---

## 6. 成功标准

迁移成功不应只看“有没有换库”，而要看以下结果：

- 高频阅读场景默认使用 Three.js。
- 用户不需要知道当前走的是哪套引擎。
- 标注和工具栏体验没有明显回退。
- 代码里的渲染分流更少、更清楚。
- 新功能开发不再频繁跨两套渲染栈重复实现。

当前落地检查方式：

- 默认发布档位下运行 `npm run verify:preview:success`
- 自动化覆盖 simple preview、readonly saved-pin overlay、direct view、工具栏交互，以及阶段 1 / 完整回退两种档位
- 使用 [test-annotation.md](../test-annotation.md) 手动检查 workbench、`3dgrid`
- 观察统一 route log，确认分流只通过共享 preview selection 入口完成

---

## 7. 粗略排期

以下排期按单人主导、边开发边验证估算：

| 阶段 | 目标 | 预计时间 |
|------|------|----------|
| 0 | 收紧边界与观测 | 0.5 - 1 天 |
| 1 | 单模型只读标注迁到 Three | 2 - 4 天 |
| 2 | 单模型 direct view 迁到 Three | 3 - 5 天 |
| 3 | workbench 可行性评估 | 2 - 3 天 |
| 4 | `3dgrid` 评估 | 1 - 2 天 |

如果阶段 3 和阶段 4 都决定继续实现，则完整周期会延长到按周计算；如果目标是“让 Three 成为高频主链”，阶段 1 到阶段 2 完成后就已经达成主要收益。

---

## 8. 推荐决策

推荐采用以下路线：

1. 先完成阶段 0 到阶段 2。
2. 将“Three.js 成为单模型 `GLB` 主链”作为近期目标。
3. 将“是否继续迁移 workbench / `3dgrid`”改为阶段性决策，而不是预设承诺。

这条路线的好处是：

- 目标明确
- 风险可控
- 用户收益出现得更早
- 不会为了统一而过早推翻已经稳定的 Babylon 专项能力

简而言之：

先把 Three.js 做成主干，再决定 Babylon 要缩到多小，而不是一开始就要求它彻底消失。
## 2026-06 Three.js Fidelity Update

The next Three.js step is visual-fidelity parity for the existing direct-format
path, not a broad Babylon.js replacement. Three.js remains the primary
single-model path for GLB/GLTF/STL/PLY/OBJ, while Babylon.js remains the
capability backend for `3dgrid`, conservative workbench routes, SPLAT, and
rollback behavior.

Current focus:

- expose a route capability profile and Three.js quality snapshot;
- preserve color intent for direct formats, including STL/PLY vertex colors and
  OBJ color textures;
- improve tiny-model camera precision and small-part visibility;
- track smoothness with rendered-frame counts, idle skips, frame timing, and
  adaptive pixel-ratio changes;
- add color-fidelity and small-parts preview fixtures to regression checks.

Tracked as `REQ-015` in `docs/requirements-tracker.md`.
