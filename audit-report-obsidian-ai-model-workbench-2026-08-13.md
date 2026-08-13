# Fuck My Shit Mountain Audit Report

**Project:** obsidian-ai-model-workbench (AI Model Workbench)
**Audit mode:** architecture + stability + performance + maintainability + documentation
**Date:** 2026-08-13
**Reviewer:** opencode (deepseek-v4-pro)

---

## 1. Executive Summary

AI Model Workbench 是一个成熟的 Obsidian 插件（v0.7.6），渲染 3D 资产并生成链接型知识笔记。它的领域层、持久化层和 IO 层质量很高：`domain/models.ts` 是纯净的类型契约，`store/plugin-store.ts` 有完整的 `data.json` 规范化与防抖保存循环，转换缓存有 200 条/30 天的边界，且整个 `src` 目录**零个 `any`**、测试与 lint 全绿。这些是真正的亮点。

问题几乎全部集中在**渲染层和视图层**：两个渲染后端各有一个 3000–4200 行的"上帝对象"（`three/scene.ts` 4215 行、`babylon/scene.ts` 3473 行，文件头各自都挂了 `TODO(P2)` 承认这一债务），彼此之间还有约 35 个签名相同的方法形成大规模平行重复。视图层的 `helper-buttons.ts`（单个 ~1140 行函数）、`knowledge-note.ts`（1504 行）、`direct-view.ts`（1042 行）是第二梯队的问题。此外还有几处真实的 GPU/内存泄漏（Babylon 的 ground/grid/axis/bbox 材质从不 dispose、Three 的 BoxHelper 从不 dispose）、一个跨模型状态"双主"（store 与 `DirectModelView.workbenchSummary` 各存一份当前模型摘要），以及远程草稿在隐私开关全关时仍外发 vault 路径与用户笔记的数据最小化缺口。

结论：这是一个"结构很好、但渲染/视图层积累了明显维护债务"的项目。核心骨架不需要重写，需要的是按 `preview/*` 接口把两个上帝对象和视图层单调函数拆开，以及几处小而明确的泄漏/错误处理修复。

### Score Dashboard

```
Security        ░░░░░░░░░░   —    not assessed (范围外；仅顺带发现 1 处隐私最小化缺口)
Stability       ██████░░░░  6.0  B   3 处 GPU/材质泄漏 + 原型覆写未还原 + 错误上下文丢失
Performance     ███████░░░  7.5  A   空闲跳帧+自适应预算好；slice 覆盖层每帧重建、冗余 render
Maintainability ████░░░░░░  4.5  C   两个 3000+ 行上帝对象 + 视图层 3 个巨型模块 + 平行重复
Design          █████░░░░░  5.5  B   类型纪律/分层好；SRP 与 DRY 系统性违反
Testing         ░░░░░░░░░░   —    not assessed (范围外)
Release         ░░░░░░░░░░   —    not assessed (范围外)
─────────────────────────────────────
Overall         ██████░░░░  5.9  B
```

每个维度 0.0–10.0 分，**越高越好（10 = 干净，0 = 屎山）**。分数是基于证据的判断，不是机械扣分。见 `rubrics/scoring.md`。

### Finding Statistics

| Severity | Count | Confirmed | Suspected |
|----------|-------|-----------|-----------|
| Critical | 0 | 0 | 0 |
| High | 6 | 6 | 0 |
| Medium | 11 | 11 | 0 |
| Low | 6 | 6 | 0 |
| Info | 0 | 0 | 0 |
| **Total** | **23** | **23** | **0** |

## 2. Project Map

```
src/
├── main.ts                    # Obsidian 生命周期、命令、视图、处理器注册（323 行）
├── settings.ts                # 设置 UI + 诊断控制（630 行，TODO(P2) 承认超 500 行）
├── domain/models.ts           # 纯类型契约，无运行时代码 ✓
├── domain/constants.ts        # 默认设置与扩展名集合
├── store/                     # 单一持久化/状态所有者（create-store + plugin-store）
├── render/
│   ├── preview/               # 渲染器无关的纯数学接口（bounds/camera-fit/measurement/slice/…）✓
│   ├── three/                 # ThreeModelPreview（scene.ts 4215 行）+ loaders/mesh-preview
│   └── babylon/               # BabylonModelPreview（scene.ts 3473 行）+ grid/environment/loaders
├── io/
│   ├── formats/               # 格式能力注册表
│   ├── conversion/            # 转换器发现/管理器/适配器（本地桌面工具）
│   ├── cache/                 # 转换资产缓存（200 条 / 30 天边界）✓
│   └── model-pipeline.ts      # 直接/转换准备
└── view/
    ├── direct-view.ts         # 直接文件视图 + 直接 workbench 面板（1042 行）
    ├── inline/                # 3d/3dgrid/Live Preview/helper-buttons（1297 行）
    └── workbench/             # analysis-result/knowledge-note（1504 行）/remote-draft
```

数据流清晰：`view → store`、`view → io`，`io` 从不反向依赖 `view`。渲染层通过 `preview/types.ts` 的 `WorkbenchPreview` 接口向视图暴露能力，路由决策集中在 `preview/routing.ts`。**高风险区域**：两个渲染后端的 scene 类、`view/inline/helper-buttons.ts`、`view/workbench/knowledge-note.ts`、`view/direct-view.ts`，以及跨模块的平行重复（排名函数、规范化函数、OBJ 纹理解析、网络守卫、base64 解码各有多份拷贝）。

### Coverage Matrix

| Dimension | Coverage | Evidence inspected | Exclusions / limits |
|-----------|----------|--------------------|---------------------|
| Architecture | High | `domain/models.ts`、`store/plugin-store.ts`、`render/preview/routing.ts`、`render/preview/types.ts`、`three/scene.ts`、`babylon/scene.ts`、`view/*` 全部读毕；子代理交叉核对 | 未逐行追踪 `main.ts` 的命令注册到视图的每个调用点 |
| Stability | High | 全仓 grep 空 catch / setTimeout / dispose；读毕 `three/scene.ts` destroy 路径、`babylon/scene.ts` destroy 路径、`loaders.ts`、`remote-draft.ts`、`note-reader.ts`、`heading-pin-observer.ts` | WebGL 上下文丢失/恢复的实际运行行为未在真实浏览器验证 |
| Performance | High | `three/scene.ts` 渲染循环/帧预算、`babylon/scene.ts` 渲染循环/slice 拖拽、`preview/smoothness.ts`、`converted-asset-cache.ts` | 未做真实设备上的帧率 profiling；结论基于代码路径 |
| Maintainability | High | 行数统计（全部 src 文件）、`rg --files` 清单、子代理对每个大文件的方法级分析 | 未对 2504 行的 `scripts/verify-preview.mjs` 做同等粒度分析 |
| Documentation | Medium | `README.md`、`CLAUDE.md`、`AGENTS.md`、`docs/development-handoff.md`、`docs/preview-routing-matrix.md`、`docs/*.md` 与代码/`CHANGELOG.md` 交叉比对 | 未逐一核对 `docs/usage-guide*.md`、`docs/common-usage-syntax*.md` 的每个语法示例 |

## 3. Top Risks

1. **[High] Babylon helper 材质从不 dispose（GPU/内存泄漏）** — ground/grid/axis/bbox 每次开关或标定缩放都新建 `StandardMaterial`，`Mesh.dispose()` 无参调用不释放材质。
2. **[High] Three.js `BoxHelper` 几何与材质从不 dispose** — 每次选择/聚焦/bbox 切换都新建 helper，旧的 GPU buffer 累计。
3. **[High] Three 与 Babylon 两个 scene 类的大规模平行重复** — 约 35 个签名相同的方法，行为漂移是必然风险。
4. **[High] 渲染层上帝对象** — `three/scene.ts` 4215 行、`babylon/scene.ts` 3473 行，各自打包 15+ 项职责。
5. **[High] 视图层巨型模块** — `helper-buttons.ts` 单个 1140 行函数、`knowledge-note.ts` 1504 行。
6. **[Medium] 远程草稿数据最小化缺口** — 隐私开关全关时仍外发 vault 路径、用户笔记、标签与注解 heading。
7. **[Medium] 当前模型摘要"双主"** — `PluginStore.modelPreview` 与 `DirectModelView.workbenchSummary` 各存一份。
8. **[Medium] Babylon OBJ `_loadMTL` 原型覆写在错误路径未还原** — 后续 OBJ 加载可能继承过期闭包。
9. **[Medium] 模型加载管线重复 3 份** — direct-view / code-block / live-preview 各自实现，回退逻辑只在 direct-view。
10. **[Medium] Babylon slice 覆盖层每帧 dispose + 重建 ~11 个 mesh** — 拖拽时无谓的顶点缓冲 churn。

## 4. Detailed Findings

### Finding: Three.js scene.ts 是 4215 行的上帝对象（15+ 项职责）

- Severity: High
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/render/three/`
- Evidence:
  - File: `src/render/three/scene.ts:343-344`
  - Function / Module: `ThreeModelPreview`（`scene.ts:345`）
  - Relevant behavior: 类自身注释写着 `// TODO(P2): decompose this class into loader/camera/light/annotation modules.` 和 `// Scene class is >2,000 lines and mixes rendering, interaction, and knowledge capture (debt: renderer-three).`
- Problem: 加载、相机、灯光、环境、注解、选择、测量、slice、gizmo、disassembly、自动旋转、配置应用、帧预算、证据采集、渲染循环全部挤在一个类里，约 60 个私有状态字段（346–489 行）。
- Why it matters: 任何单一特性改动都要触碰整个文件，无法隔离测试，dispose 顺序与状态耦合难以推理。
- Realistic failure scenario: 修复测量系统的 bug 时误改共享状态字段，导致 slice 或 gizmo 出现回归，且无单元测试能隔离定位。
- Minimal fix: 按已有 `disassembly.ts`/`explode.ts` 的模式，把测量、slice、灯光等提取为独立 controller，保留瘦门面。
- Better long-term fix: 以 `preview/*` 接口为边界，把交互编排下沉到渲染器无关层，两个后端共用。
- Regression test suggestion: 现有 `three/mesh-preview.test.ts` 已覆盖部分；为每个提取出的 controller 补独立的 vitest 用例。
- Estimated effort: 数天（分阶段）

### Finding: Babylon scene.ts 是 3473 行的上帝对象

- Severity: High
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/render/babylon/`
- Evidence:
  - File: `src/render/babylon/scene.ts:374-375`
  - Function / Module: `BabylonModelPreview`（`scene.ts:376`）
  - Relevant behavior: 注释 `// TODO(P2): split this class into loader/camera/light/annotation helpers.` 且自述 ">1,700 lines"，实际文件 3473 行，注释已过时。
- Problem: 六类子系统（loader、camera/zoom、lights、environment、measurement、slice、focus/picking）+ 约 30 个事件处理器 + 三个 observer 集合塞在一个类里。
- Why it matters: 与 Three 侧同样的问题；`loadModel`（630–926 行，约 297 行）是唯一 >100 行的方法且 >10 分支。
- Realistic failure scenario: 改 slice 交互时影响 loader 的 MTL 原型覆写逻辑（见 Finding 12），二者在同一作用域耦合。
- Minimal fix: 至少提取 `BabylonSliceController`、`BabylonMeasurementController`，各自持有 mesh/observer 并暴露 `dispose()`。
- Better long-term fix: 与 Three 侧共用 `preview/*` 编排层，两个后端只保留渲染差异。
- Regression test suggestion: 现有 `babylon/mesh-preview.test.ts`；为 slice/measurement controller 补独立测试。
- Estimated effort: 数天（分阶段）

### Finding: Three 与 Babylon 两个 scene 类大规模平行重复

- Severity: High
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/render/three/` + `src/render/babylon/`
- Evidence:
  - File: `src/render/babylon/scene.ts:930-2185` 与 `src/render/three/scene.ts`
  - Function / Module: `toggleMeasurement`、`setSlicePlane`、`setSliceOffset`、`setSliceRotation`、`resetSlicePlane`、`toggleFocusSelection`、`toggleDisassembly`、`setExplode`、`resetView`、`exportModelInfo`、`getModelEvidence`、`getSelectedPartInfo`、`destroy` 等约 35 个方法
  - Relevant behavior: 两文件各有一份相同签名的编排/事件/指针/质量胶水代码，`preview/*` 只抽走了纯数学。
- Problem: 两份 ~3000+ 行的 scene 各自重写同样的交互编排，靠注释手工同步魔数（`FRAME_BUDGET_SLOW_MS = 28`、`BABYLON_ENVIRONMENT_INTENSITY = 0.48`、`FOCUS_WORLD_POINT_ANIMATION_MS = 320`）。
- Why it matters: 行为漂移已在 `getCameraZoomRange` 上出现（Three 返回 `{mode:"distance"|"zoom"}`，Babylon 语义不同）；一个后端的修复不会自动落到另一个。
- Realistic failure scenario: 修复测量吸附后 Three 正常、Babylon 仍吸附到错误顶点，用户在直接视图（Babylon 默认）中看到未修复行为。
- Minimal fix: 把交互编排、marker 颜色、循环/质量控制下沉到 `preview/*` 共享 helper，两个后端消费。
- Better long-term fix: 建立单一渲染编排层，后端只实现 `WorkbenchPreview` 的渲染差异部分。
- Regression test suggestion: 对每个下沉的纯函数补参数化测试，覆盖两个后端的调用点。
- Estimated effort: 数天（分阶段）

### Finding: helper-buttons.ts 是单个 ~1140 行函数

- Severity: High
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/view/inline/`
- Evidence:
  - File: `src/view/inline/helper-buttons.ts:147-1286`
  - Function / Module: `createHelperButtons`
  - Relevant behavior: 单个函数包含约 15 个按钮处理器、完整的测量标定 UI、slice UI、三个嵌套 `sync*` 函数、两个 preview observer。
- Problem: 所有状态（`boundMeasurementPreview`、`releaseSliceObserver`、`lastSyncedPreview`、`activeTooltips`）捕获在一个闭包作用域，生命周期/清理难以推理、无法单测。
- Why it matters: 这是视图层最深的复杂度热点，任何改动都有高回归风险。
- Realistic failure scenario: 修复某个按钮的解绑逻辑时漏掉一个 observer，导致切走视图后内存泄漏或重复渲染。
- Minimal fix: 拆成 `MeasurementPanel`、`SlicePanel`、`Toolbar` 三个控制器，各自带显式 `destroy()`。
- Better long-term fix: 与 direct-view 的测量/slice 面板共享组件实现。
- Regression test suggestion: 用 jsdom 级测试覆盖各面板的 mount/destroy 对称性。
- Estimated effort: 数小时到 1 天

### Finding: knowledge-note.ts 是职责混杂的 1504 行模块

- Severity: High
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/view/workbench/`
- Evidence:
  - File: `src/view/workbench/knowledge-note.ts:1-1504`
  - Function / Module: `generateKnowledgeNote`（1321 行起约 183 行）+ 约 30 个 `build*Section` helper + `normalizePartSource`/`normalizeModelAssetFormat`/`normalizeModelLoadStrategy`/`normalizeStringArray`（875-940 行）
  - Relevant behavior: markdown 生成、part-note 起草、knowledge-index 写入、remote-draft 编排、sidecar JSON 序列化、持久化规范化全在一个文件。
- Problem: 纯格式化、IO、规范化交错；875–940 行的规范化 helper 是 `plugin-store.ts` 中同一校验逻辑的第二份实现。
- Why it matters: 持久化校验在加载时（store）和读取时（collectRegisteredPartsFromProfiles）会漂移。
- Realistic failure scenario: 修改字段校验规则只改了 store，knowledge-note 读旧数据时仍按旧规则放行非法字段。
- Minimal fix: 把规范化移到已存在的 `registered-part-persistence.ts`；内容构建与编排分离。
- Better long-term fix: 把 knowledge-note 拆成 content-builder / index-writer / note-orchestrator。
- Regression test suggestion: 现有 `knowledge-note.test.ts`（510 行）已有覆盖；为共享规范化函数补单一实现测试。
- Estimated effort: 数小时

### Finding: Babylon helper 材质（ground/grid/axis/bbox）从不 dispose

- Severity: High
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: `src/render/babylon/scene.ts`
- Evidence:
  - File: `src/render/babylon/scene.ts:1134-1152`、`1675-1692`、`1481-1507`
  - Function / Module: `removeGround` / `removeGrid` / `removeAxis` / `toggleBoundingBox` / `rebuildScaledSceneHelpers`
  - Relevant behavior: `this.groundMesh.dispose()`（1136）、`this.gridMesh.dispose()`（1142）、`mesh.dispose()`（1149）、`this.bboxMesh?.dispose()`（1691）均无参调用；而 `createGround` 里 `new StandardMaterial("ground-mat", this.scene)`（1163）每次新建材质。
- Problem: Babylon `Mesh.dispose(doNotRecurse?, disposeMaterialAndTextures?)` 两个参数默认 `false`，所以每次 toggle/标定缩放新建的 `StandardMaterial` 残留在 `scene.materials` 中。
- Why it matters: 每次 ground/grid/axis/bbox 开关或 `setMeasurementScale`（触发 `rebuildScaledSceneHelpers`）都泄漏一个材质；session 存活期内无界增长。
- Realistic failure scenario: 用户反复开关网格或多次标定缩放后 GPU 内存上升、预览变慢。
- Minimal fix: 在 `mesh.dispose()` 前显式 `mesh.material?.dispose()`，或改用 `dispose(false, true)`，或按名字复用缓存材质。
- Better long-term fix: helper 材质改为单例缓存，toggle 只切换可见性而非重建。
- Regression test suggestion: 单元级很难覆盖 GPU 释放；用 dispose 审计（`lastDisposalAudit` 类似机制）断言 helper 材质数不增长。
- Estimated effort: 分钟级

### Finding: direct-view.ts 是 1042 行的上帝对象

- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/view/direct-view.ts`
- Evidence:
  - File: `src/view/direct-view.ts:243-1042`
  - Function / Module: `DirectModelView`
  - Relevant behavior: `loadModel`（317-496）、注解设置（498-559）、延迟证据注册（561-649）、布局（692-735）、知识控制（736-797）、registered-match 预览 UI（799-926）、Three→Babylon 回退（928-1028）。
- Problem: 单一 `FileView` 适配器承载整个 direct-view 特性面；多个文件私有 helper 无法隔离测试。
- Why it matters: 回退与证据注册逻辑与视图胶水耦合，是最容易出错又最难测的部分。
- Realistic failure scenario: 改回退逻辑时引入 bug，只在特定格式加载失败时才暴露，常规测试覆盖不到。
- Minimal fix: 把证据/registered-part 管线（561-649）与 match 侧栏（799-926）提取为独立 controller/component。
- Better long-term fix: 抽共享 `loadPreparedModel()` 编排（见 Finding 9），视图只保留 FileView 适配。
- Regression test suggestion: 现有 `direct-workbench-panel.test.ts`；为证据注册管线补单测。
- Estimated effort: 数小时

### Finding: 当前模型摘要"双主"（store 与视图各存一份）

- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/view/direct-view.ts` + `src/store/plugin-store.ts`
- Evidence:
  - File: `src/view/direct-view.ts:254-259, 345, 452-457, 685-691`
  - Function / Module: `DirectModelView.loadModel` / `refreshWorkbenchPanel`
  - Relevant behavior: `loadModel` 既调 `this.ps.setCurrentModel(file.path, summary)`（457）又赋值 `this.workbenchSummary = summary` / `this.workbenchModelPath = file.path`（452-454）；`refreshWorkbenchPanel` 读视图字段而非 store。
- Problem: "当前模型摘要"有两份拷贝：诊断与 knowledge-note 读 store，workbench 读视图字段，二者可能漂移。
- Why it matters: 状态单一来源是架构契约（AGENTS.md 明确 store 是持久化所有者），此处违反。
- Realistic failure scenario: 某路径调用 `clearModelPreview`（486-488）后 store 已清空而视图字段仍残留，workbench 显示过期模型。
- Minimal fix: store 为唯一来源，`refreshWorkbenchPanel` 改从 `store.getState().modelPreview`/`currentModelPath` 派生。
- Better long-term fix: 统一所有视图读取 store，移除 `workbenchSummary`/`workbenchModelPath` 字段。
- Regression test suggestion: 断言 clearModelPreview 后 workbench 面板同步清空。
- Estimated effort: 分钟到小时级

### Finding: 模型加载管线在 3 处重复实现

- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/view/direct-view.ts` + `src/view/inline/code-block.ts` + `src/view/inline/live-preview.ts`
- Evidence:
  - File: `src/view/direct-view.ts:407-456`、`src/view/inline/code-block.ts:313-353`、`src/view/inline/live-preview.ts:213-300`
  - Function / Module: 三处 `prepareModelInput → toPreviewSource → resolveConversionOutputRoot → listPreferredConversionExts → readBinaryPath → getPreviewPathRenderBudget → setRenderQuality → loadModel`
  - Relevant behavior: 三处各自实现同一加载编排，含同样的 `void dataPromise.catch(() => undefined)` 模式；Three→Babylon 回退只存在于 direct-view。
- Problem: 路由/加载修复必须在 3 个文件里重复应用，回退行为因此发散。
- Realistic failure scenario: 在某格式上 Three 加载失败时，direct-view 能回退 Babylon，但 inline code-block 直接报错。
- Minimal fix: 提取共享 `loadPreparedModel()` 编排 helper 到 io/render。
- Better long-term fix: 统一由 `preview/factory.ts` 提供带回退的加载入口。
- Regression test suggestion: 参数化测试覆盖三个入口在同一失败场景下的一致行为。
- Estimated effort: 小时级

### Finding: findEmbeds 有 17 个参数

- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/view/inline/live-preview.ts`
- Evidence:
  - File: `src/view/inline/live-preview.ts:403-423`
  - Function / Module: `findEmbeds`
  - Relevant behavior: 形参从 `viewOrState` 到 `getAnnotations?` 共 17 个，多为从 settings 逐个拆出的标量。
- Problem: 远超 >7 参数的 High 阈值，是缺参数对象的明确信号。
- Why it matters: 每新增一个设置项都要改这个签名和两处调用点（537、566），易错。
- Realistic failure scenario: 新增设置项时只改了一处调用点，导致某视图沿用旧值。
- Minimal fix: 传入 `PluginSettings` + 一个 context 对象（含 cache、app、annotations resolver）。
- Better long-term fix: 见 Finding 9 的共享加载上下文。
- Regression test suggestion: 现有 `live-preview.test.ts`；签名收敛后保持测试绿即可。
- Estimated effort: 分钟到小时级

### Finding: Three.js BoxHelper 几何与材质从不 dispose

- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: `src/render/three/scene.ts`
- Evidence:
  - File: `src/render/three/scene.ts:2700-2701, 3572-3593`
  - Function / Module: `clearLoadedModel` / `ensureBoundingBoxHelper` / `updateSelectionHighlight`
  - Relevant behavior: `this.bboxHelper?.removeFromParent(); this.bboxHelper = null;`（2700-2701）无 dispose；`new BoxHelper(object, 0xfacc15)`（3575、3589）每次新建。
- Problem: `BoxHelper` 是 `LineSegments`，每次新建都持有一个新 `BufferGeometry` + `LineBasicMaterial`，移除时不 dispose，GPU buffer 累积。
- Why it matters: 每次选择/聚焦/bbox 切换/测量目标变化都泄漏一对 geometry+material。
- Realistic failure scenario: 长时间高频切换选中对象后 GPU 内存持续上升。
- Minimal fix: 新增 `disposeBoxHelper()`，在移除前 dispose geometry 和 material。
- Better long-term fix: 复用单个 BoxHelper，只更新其 `setFromObject`，避免反复分配。
- Regression test suggestion: 复用 `lastDisposalAudit` 断言 helper 资源被计入释放。
- Estimated effort: 分钟级

### Finding: Babylon OBJ `_loadMTL` 原型覆写在错误路径未还原

- Severity: Medium
- Confidence: Medium
- Category: Stability
- Status: Confirmed
- Affected area: `src/render/babylon/scene.ts`
- Evidence:
  - File: `src/render/babylon/scene.ts:711-802`
  - Function / Module: `loadModel` 内的 OBJ/MTL 处理
  - Relevant behavior: `proto._loadMTL = originalLoadMTL;`（792）只在成功 `ImportMeshAsync`（788）后执行；`catch`（793-798）和 `finally`（799-802）只还原 `objMtlLock`。
- Problem: OBJ 加载抛错（中断或解析失败）时，共享的 `OBJFileLoader.prototype._loadMTL` 残留过期闭包（持有失败加载的 `mtlContent`）。
- Why it matters: 后续走 `grid.ts importMesh` 等不重新覆写 `_loadMTL` 的 OBJ 加载会继承过期闭包，解析错误。
- Realistic failure scenario: 一个损坏的 OBJ 加载失败后，grid 视图里的正常 OBJ 材质解析错乱。
- Minimal fix: 在 `catch`/`finally` 中同样执行 `proto._loadMTL = originalLoadMTL`。
- Better long-term fix: 用传入回调而非覆写原型的方式注入 MTL 内容，避免共享原型污染。
- Regression test suggestion: 模拟 OBJ 加载抛错后断言 `OBJFileLoader.prototype._loadMTL` 已还原。
- Estimated effort: 分钟级

### Finding: destroy() 无 try/finally，异常时 WebGL 上下文泄漏

- Severity: Medium
- Confidence: Medium
- Category: Stability
- Status: Confirmed
- Affected area: `src/render/babylon/scene.ts`
- Evidence:
  - File: `src/render/babylon/scene.ts:2122-2185`
  - Function / Module: `destroy`
  - Relevant behavior: `this.scene.dispose(); this.engine.dispose();`（2183-2184）是方法最后语句；`this.loadedMeshes = []`（2169）不 dispose，靠 `scene.dispose()` 兜底。
- Problem: 若 `destroy()` 早段任一步骤抛错（如 `this.gizmo?.dispose()` 2133、`this.disassembly?.dispose()` 2135），`scene.dispose()`/`engine.dispose()` 不执行，WebGL 上下文与全部场景资源泄漏。
- Why it matters: 模型 mesh/材质/纹理仅靠最终 `scene.dispose()` 释放，一旦被跳过即整体泄漏。
- Realistic failure scenario: 某个 controller 的 dispose 因状态不一致抛错，切换/关闭视图后 WebGL 上下文不释放。
- Minimal fix: `try { ... } finally { this.scene.dispose(); this.engine.dispose(); }`。
- Better long-term fix: 拆分后的各 controller 各自 dispose 失败不阻断场景级释放。
- Regression test suggestion: 构造某 controller dispose 抛错的场景，断言 scene/engine 仍被调用。
- Estimated effort: 分钟级

### Finding: 远程草稿在隐私开关全关时仍外发 vault 路径与用户笔记

- Severity: Medium
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: `src/view/workbench/remote-draft.ts`
- Evidence:
  - File: `src/view/workbench/remote-draft.ts:55-105, 175`
  - Function / Module: `sanitizeDraftingInput` / `stripGeometrySummary`
  - Relevant behavior: `stripGeometrySummary` 剥掉 `summary`、`previewImages`、`partCandidates`，并把 `annotationLinks` 的 `notePath`/`position`/`nearestPart*`/`distance` 置空、`confidence` 降为 0.25；但 `model.path`（vault 完整路径）、`model.notes`（用户自由文本）、`model.tags`、`model.title`、`annotationLinks[].label`/`headingRef` 始终被 `JSON.stringify(decision.request)`（175）外发。
- Problem: 即使 `sendPreviewImagesToRemote` 与 `sendGeometrySummaryToRemote` 都关闭，远程服务仍收到 vault 路径、用户笔记、标签与标题，属数据最小化缺口。
- Why it matters: 与产品"local-first、远程可选且仅发送脱敏证据"的契约不符。
- Realistic failure scenario: 用户关闭全部隐私开关后开启远程草稿，其 vault 绝对路径与手写笔记被发送到第三方服务。
- Minimal fix: 当 `sendGeometrySummaryToRemote` 关闭时，同样剥掉 `model.path`（或降为 basename）、`model.notes`、`model.tags`，并剥掉 `annotationLinks` 的 `label`/`headingRef`。
- Better long-term fix: 定义显式的"远程出站最小字段白名单"，默认只发 sanitize 后的字段。
- Regression test suggestion: 现有 `verify:remote-draft` 覆盖；补断言隐私开关关闭时序列化 payload 不含 `model.path`/`notes`/`headingRef`。
- Estimated effort: 分钟到小时级

### Finding: OBJ 材质/纹理错误被吞且上下文丢失

- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: `src/render/three/loaders.ts`
- Evidence:
  - File: `src/render/three/loaders.ts:382-392, 406-411, 211-215`
  - Function / Module: OBJ 纹理候选解析 / MTL 解析 / `readRelativeResource`
  - Relevant behavior: `catch { /* try next candidate */ }`（389）丢弃每个候选的 readFile 错误；`catch { warnings.push("OBJ material library not found") }`（409-410）把解析失败误报为文件不存在；`catch { throw new Error("Missing external model resource") }`（213-214）丢弃原始错误 cause。
- Problem: 真实的 I/O 错误（权限、路径 bug）与"纹理不存在"不可区分，底层原因全部丢失。
- Why it matters: 用户看到"material library not found"，无法诊断是路径问题还是解析 bug。
- Realistic failure scenario: 一个 MTL 因解析错误失败，用户误以为是文件缺失，反复排查文件路径。
- Minimal fix: 捕获最后的错误加入 `warnings`；read 与 parse 分开 catch；rethrow 用 `{ cause: error }`。
- Better long-term fix: 定义结构化加载错误类型，携带阶段与 cause。
- Regression test suggestion: 现有 `three/loaders.test.ts`；补断言 parse 失败时 warning 含错误信息。
- Estimated effort: 分钟级

### Finding: Babylon slice 覆盖层每帧 dispose + 重建 ~11 个 mesh

- Severity: Medium
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: `src/render/babylon/scene.ts`
- Evidence:
  - File: `src/render/babylon/scene.ts:2493-2551, 2702-2766`
  - Function / Module: `flushSliceDragUpdate` → `syncSliceClipping` → `syncSliceOverlay`
  - Relevant behavior: `syncSliceOverlay` 开头 `this.disposeSliceOverlay(false, true)`（2703）后重建 plane、frame、normalGuide、3 个环、3 组刻度、moveGuide、arc、箭头。
- Problem: CHANGELOG 声称"拖拽时原地更新 clip 平面、避免每帧重编译材质"对材质成立，但视觉覆盖层仍每指针帧整体拆除重建。
- Why it matters: 大模型 + 64 段 gizmo 时产生可避免的顶点缓冲 churn。
- Realistic failure scenario: 拖拽 slice 板时在大模型上掉帧。
- Minimal fix: 覆盖层 mesh 存活复用，用 `CreateLineSystem(..., { instance })` 原位更新顶点（测量线已在 1562-1565 这么做）。
- Better long-term fix: 把 slice 覆盖层抽成独立 controller，持有并更新自身 mesh。
- Regression test suggestion: 性能 harness 断言拖拽期间 mesh 数量不增长。
- Estimated effort: 小时级

### Finding: settings.ts 超过 500 行

- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/settings.ts`
- Evidence:
  - File: `src/settings.ts:15`
  - Function / Module: `display()`
  - Relevant behavior: `// TODO(P2): split display() into section-builder methods; currently >500 lines (debt: settings-ui).`
- Problem: 设置 UI 构建函数过大，分节逻辑未抽取。
- Why it matters: 新增设置项时需在巨型函数里定位分节。
- Realistic failure scenario: 在错误分节插入设置项，UI 归类混乱。
- Minimal fix: 按设置分组抽取 section-builder 方法。
- Better long-term fix: 声明式设置 schema + 自动渲染。
- Regression test suggestion: `verify:settings` 覆盖迁移；补 UI 分节快照测试。
- Estimated effort: 小时级

### Finding: 多处小工具函数重复（排名/规范化/纹理解析/网络守卫/base64）

- Severity: Low
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: 跨 `direct-view.ts` / `knowledge-note.ts` / `plugin-store.ts` / `three/loaders.ts` / `babylon/scene.ts` / `helper-buttons.ts`
- Evidence:
  - File: `src/view/direct-view.ts:90-96`、`src/view/workbench/knowledge-note.ts:948-954`、`src/store/plugin-store.ts:385-391`（`getAutoRegisteredPartRank` 三份）；`knowledge-note.ts:875-902` 与 `plugin-store.ts:266-319`（规范化函数）；`three/loaders.ts:190-238` 与 `babylon/scene.ts:329-371`（OBJ 纹理候选）；`three/network-guard.ts:12` 与 `babylon/network-guard.ts:9`（且 Three 拦 `ftp:`，Babylon 不拦）；`helper-buttons.ts:69-76` 与 `knowledge-note.ts:790-798`（base64 解码）
  - Function / Module: 上述各 helper
  - Relevant behavior: 同一逻辑多份拷贝，部分已出现行为分歧（网络守卫正则不一致）。
- Problem: 一处修复不会自动落到其他拷贝；网络守卫的 `ftp:` 分歧是真实安全边界不一致。
- Why it matters: 漂移与不一致风险。
- Realistic failure scenario: 未来新增材质扩展名只改了一处 OBJ 解析，另一后端不识别。
- Minimal fix: 各逻辑收敛到 `registered-part-persistence.ts` / `preview/*` / `utils/base64.ts` 的单一导出。
- Better long-term fix: 统一网络守卫为一个正则 + 两个 create*Error 工厂。
- Regression test suggestion: 对共享函数补单一实现测试。
- Estimated effort: 小时级

### Finding: note-reader.ts 宽泛 catch 吞掉所有错误

- Severity: Low
- Confidence: Medium
- Category: Stability
- Status: Confirmed
- Affected area: `src/utils/note-reader.ts`
- Evidence:
  - File: `src/utils/note-reader.ts:87`
  - Function / Module: `readHeadingSection`
  - Relevant behavior: 整个函数体包在 `try { … } catch { return null; }`，吞掉 vault 读取、格式错误、编程错误，一律返回 null。
- Problem: 调用方（hover popover、pin snippet）把 null 解释为"空 section"，真实失败与"无内容"不可区分。
- Why it matters: 掩盖潜在 bug。
- Realistic failure scenario: vault 读取因权限失败被当作"无内容"，用户静默看不到注解摘要。
- Minimal fix: 缩小 catch 范围到 `cachedRead`，非"未找到"错误加 `console.warn`。
- Better long-term fix: 返回 `{ status: "missing" | "error" | "ok", content }`。
- Regression test suggestion: 补断言读取失败时能区分 missing 与 error。
- Estimated effort: 分钟级

### Finding: heading-pin-observer 停止时未清除 scanTimer

- Severity: Low
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: `src/view/heading-pin-observer.ts`
- Evidence:
  - File: `src/view/heading-pin-observer.ts:302-320`
  - Function / Module: `stopMutationObserver` / `registerCleanup`
  - Relevant behavior: `registerCleanup` 清 `scanTimer` + `debounceTimer`；`stopMutationObserver` 只清 `debounceTimer`。
- Problem: 一次性 `scanTimer` 在 observer 进入 idle 后仍可能触发一次多余的 `scanAll()`。
- Why it matters: 无害但产生额外 `querySelectorAll` 噪音。
- Realistic failure scenario: 大量标题时多跑一次全文档扫描，轻微性能浪费。
- Minimal fix: `stopMutationObserver` 里也清 `scanTimer`。
- Better long-term fix: 无需。
- Regression test suggestion: 现有 `heading-pin-observer.test.ts` 补停止后无扫描断言。
- Estimated effort: 分钟级

### Finding: Babylon 存在冗余 scene.render 与未 rAF 合并的 pick

- Severity: Low
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: `src/render/babylon/scene.ts`
- Evidence:
  - File: `src/render/babylon/scene.ts:1590, 3019, 3261, 476-506`
  - Function / Module: `captureSnapshot` / `setMeasurementTargetNode` / `cancelPendingMeasurement` / `handlePointerMove`
  - Relevant behavior: 三处同步 `this.scene.render()` 可能与 `engine.runRenderLoop` 叠加成双帧；`handlePointerMove` 每次 pointermove 调 `this.scene.pick(...)`（489）未按 rAF 合并。
- Problem: 冗余渲染与高频同步射线检测。
- Why it matters: 测量标记存在时 mousemove 触发高频 pick，marker 多时成本无界。
- Realistic failure scenario: 大量测量标记下移动鼠标导致卡顿。
- Minimal fix: 仅当 `!this.rendering` 时手动 render；hover pick 用 rAF 合并（slice 拖拽已这么做）。
- Better long-term fix: 统一 hover 拾取的调度策略。
- Regression test suggestion: 性能 harness 断言测量时无每帧双渲染。
- Estimated effort: 小时级

### Finding: Three slice 拖拽每事件分配多个 Vector3

- Severity: Low
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: `src/render/three/scene.ts`
- Evidence:
  - File: `src/render/three/scene.ts:3130-3142, 3242-3244`
  - Function / Module: `getSlicePointerPolar` / `updateSliceDrag`
  - Relevant behavior: `new Vector3(...)` 在 pointer-move 路径上每事件多次分配。
- Problem: slice 旋转/移动时 GC churn，pointer-event 频率下可接受但可避免。
- Why it matters: 大模型 + 高频移动时轻微掉帧。
- Realistic failure scenario: 拖拽 slice 时偶发 GC 停顿。
- Minimal fix: 加 scratch `Vector3` 字段（`disassembly.ts:106-115` 已有此模式）。
- Better long-term fix: 与 Babylon slice 一起下沉共享数学层。
- Regression test suggestion: 无需专门测试，保持现有 slice 测试绿。
- Estimated effort: 分钟级

### Finding: 文档 0.6.0-plus-upgrade-plan.md 仍称 Three.js 为默认渲染器

- Severity: Low
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: 文档
- Evidence:
  - File: `docs/0.6.0-plus-upgrade-plan.md:12`
  - Code / config source: `src/render/preview/routing.ts:20`（`DEFAULT_RENDERER_ROLLOUT = "babylon-safe"`）
  - Relevant mismatch or omission: 文档仍写 "Three.js is the default single-model preview backend."，与 0.7.0 起 Babylon 为默认的现状矛盾（CHANGELOG 已修正 CLAUDE.md、usage-guide、REQ-001，但漏了此文件）。
- Problem: 开发者在 spec 对齐表中把该文件列为"可靠性/工作流/维护"参考，会读到过时结论。
- Realistic failure scenario: 新成员据此以为 Three 是默认，做出错误的路由判断。
- Minimal fix: 更新该行，或加注"仅 0.6.0 时代的历史决策"。
- Better long-term fix: 在 spec 对齐表中标注历史文档只读。
- Regression test suggestion: 无需；文档核对即可。
- Estimated effort: 分钟级

## 5. Architecture Concerns

- Coverage: High
- Inspected evidence: `domain/models.ts`、`store/plugin-store.ts`、`render/preview/routing.ts`、`render/preview/types.ts`、两个 scene 类、`view/*`；`rg --files` 全量清单
- Exclusions / limits: `main.ts` 命令注册到视图的每个调用点未逐行追踪

本维度核心问题是**边界清晰但内聚失衡**：分层（domain/store/io/render/view）和依赖方向（view→store、view→io、io 不反向依赖 view）都是对的，渲染器无关接口（`preview/*`）也建立得早。失衡在"每个模块内部的职责边界"——两个 scene 类、三个视图模块各自成了单体。相关发现：Finding 1、2、3、4、5、7、8、9、10、17。

### Architecture Summary

| Subtype | Count | Affected Areas | Recommended Action |
|---------|-------|----------------|-------------------|
| ModuleBoundary | 4 | three/scene.ts, babylon/scene.ts, helper-buttons.ts, knowledge-note.ts | 提取 controller/component，保留瘦门面 |
| DependencyDirection | 1 | view 重复实现 io 加载编排 | 共享 loadPreparedModel 入口 |
| StateOwnership | 1 | modelPreview/workbenchSummary 双主 | store 为唯一来源 |
| BoundaryContract | 1 | 网络守卫正则分歧 | 统一单一实现 |
| EvolutionRisk | 2 | findEmbeds 17 参、加载管线 3 份 | 参数对象 + 共享编排 |

## 6. Stability Concerns

- Coverage: High
- Inspected evidence: 全仓 grep 空 catch/setTimeout/dispose；读毕两个后端 destroy 路径、loaders.ts、remote-draft.ts、note-reader.ts、heading-pin-observer.ts
- Exclusions / limits: WebGL 上下文丢失/恢复未在真实浏览器验证

相关发现：Finding 6、11、12、13、14、15、19、20。**好消息**：Three 侧的 `destroy()` 与 RAF/定时器清理是完整的（三个 RAF handle + 环境 setTimeout + ResizeObserver/IntersectionObserver 全部释放），OBJ 无泄漏路径；direct-view 的两个定时器清理正确。**问题**集中在 Babylon 的材质释放（Finding 6）、原型覆写还原（Finding 12）、destroy 无 finally（Finding 13），以及错误上下文丢失（Finding 15）和远程出站数据最小化（Finding 14）。

## 7. Performance Concerns

- Coverage: High
- Inspected evidence: 两个后端渲染循环、帧预算、`preview/smoothness.ts`、转换缓存边界
- Exclusions / limits: 未做真实设备帧率 profiling

**亮点**：Three 侧有成熟的自适应像素比帧预算（慢帧计数→动态缩放 pixel ratio）+ 空闲跳帧；Babylon 侧也有空闲停止 + 视口可见性门控；转换缓存与 profile 的 part 数都有边界。**问题**：Babylon slice 覆盖层每帧重建（Finding 16）、冗余 `scene.render()` 与未合并的 hover pick（Finding 21）、Three slice 每事件 Vector3 分配（Finding 22）。这些都不是系统性瓶颈，属于拖拽路径上的可优化点。

## 8. Maintainability Concerns

- Coverage: High
- Inspected evidence: 全量行数统计、方法级分析、跨文件重复比对
- Exclusions / limits: `scripts/verify-preview.mjs`（2504 行）未做同粒度分析

核心风险即 Finding 1–5（两个上帝对象 + 视图层三个巨型模块 + 平行重复）。此外 `docs/0.6.0-plus-upgrade-plan.md` 的过时结论（Finding 23）和 settings.ts（Finding 17）是次要项。整体判断：**结构是对的，但渲染/视图层已积累需要投入的维护债务**——这不是靠局部补丁能消化的，需要按接口分阶段拆解。

## 9. Documentation Analysis

- Coverage: Medium
- Inspected evidence: README、CLAUDE.md、AGENTS.md、development-handoff.md、preview-routing-matrix.md 与代码/CHANGELOG 交叉比对
- Exclusions / limits: usage-guide、common-usage-syntax 的每个语法示例未逐一核对

**整体良好**：README 与 CLAUDE.md 已正确描述 Babylon 为默认（0.7.0 的修正到位），CHANGELOG 详实，development-handoff.md 的 spec 对齐表和验证矩阵质量高。唯一遗漏是 `docs/0.6.0-plus-upgrade-plan.md:12` 的过时结论（Finding 23）。

### Documentation Summary

| Subtype | Count | Affected Docs | Recommended Action |
|---------|-------|---------------|-------------------|
| StaleDocs | 1 | docs/0.6.0-plus-upgrade-plan.md | 更新或标注历史只读 |
| UserDocs | 0 | — | — |
| DeveloperDocs | 0 | — | — |
| DecisionRecord | 0 | — | — |

---

## 10. Principles Compliance

### Principles Violated

| Principle | Violations | Severity | Affected Areas |
|-----------|------------|----------|----------------|
| Single Responsibility (SRP) | 5 | High | three/scene.ts, babylon/scene.ts, helper-buttons.ts, knowledge-note.ts, direct-view.ts |
| File Size Limit (>500/1000) | 4 | Medium | scene.ts ×2, knowledge-note.ts, helper-buttons.ts, settings.ts |
| DRY | 4 | Medium | 排名函数、规范化、OBJ 纹理解析、加载管线、网络守卫 |
| Command-Query Separation | 1 | Medium | 双主状态（setCurrentModel 与视图字段并存） |
| 4.6 Least Privilege | 1 | Medium | remote-draft 出站最小化 |
| Parameter Count (>7) | 1 | Medium | findEmbeds 17 参 |
| Fail-Fast | 2 | Medium | loaders.ts 错误吞没、note-reader 宽泛 catch |

### Principles Respected

- **类型纪律**：`src` 目录零个 `any`/`as any`，`domain/models.ts` 是纯类型契约，持久化规范化函数有完整类型守卫。
- **边界设计**：渲染器无关的 `preview/*` 接口建立得早且正确；路由决策集中在 `routing.ts`。
- **有界资源**：转换缓存（200 条/30 天）、profile part（256）、live-preview path cache（512）都有边界。
- **本地优先/隐私默认关闭**：`sendRawModelToRemote` 启用时直接禁用远程草稿（fail-closed）。
- **文档纪律**：`TODO(P<n>)` 债务标记规范，CHANGELOG 详尽，spec 对齐表清晰。

---

## 11. Recommended Fix Order

### Fix Immediately

- Finding 6（Babylon helper 材质泄漏）、Finding 11（Three BoxHelper 泄漏）— 真实 GPU/内存泄漏，修复成本分钟级。
- Finding 12（`_loadMTL` 原型未还原）— 会污染后续加载的正确性。
- Finding 13（destroy 无 try/finally）— WebGL 上下文泄漏风险。
- Finding 14（远程出站数据最小化）— 隐私契约违反。

### Fix Before Stable Release

- Finding 15（错误上下文丢失）、Finding 19（note-reader 宽泛 catch）、Finding 20（scanTimer 未清）— 可诊断性。
- Finding 21、22（渲染冗余/分配）— 拖拽路径性能。
- Finding 23（过时文档）— 一行修正。

### Schedule Later

- Finding 7、8、9、10（视图层共享编排与状态收敛）— 小时级重构。
- Finding 16（slice 覆盖层复用）— 性能优化。
- Finding 17（settings.ts 分节）。

### Ignore for Now

- 无真正可忽略的项；Finding 18 中 `materialList` 4 份拷贝这类纯重复可在任一批次顺手收敛。

## 12. Quick Wins

以下均为 1–2 小时内的低风险高价值修复：

1. **Finding 6 + 11**：helper/BoxHelper 材质 dispose（合计 < 30 分钟，消除两处真实泄漏）。
2. **Finding 12 + 13**：`_loadMTL` 还原 + destroy try/finally（< 30 分钟，消除正确性/上下文泄漏风险）。
3. **Finding 15 + 19**：loaders 错误上下文 + note-reader 收窄 catch（< 1 小时，可诊断性）。
4. **Finding 23 + 18（网络守卫）**：文档一行 + 统一网络守卫正则（消除 `ftp:` 安全边界分歧）。
5. **Finding 20**：scanTimer 清理（5 分钟）。
6. **Finding 14**：远程出站字段白名单（1 小时内，隐私）。

## 13. Long-term Refactor Plan

**动机**：两个 3000+ 行的 scene 类 + 三个视图巨型模块是当前最深的债务，且彼此平行重复。类型纪律与分层正确意味着拆解是"顺理成章"而非"推倒重来"。

1. **提取渲染器无关的交互编排层**（最高杠杆）：把测量/slice/disassembly 的指针数学、marker 颜色、循环/质量控制从两个 scene 下沉到 `preview/*`，两个后端只保留渲染差异。风险：中，需保持 `WorkbenchPreview` 接口稳定。测试策略：为每个下沉纯函数补参数化测试，两个后端行为断言一致。
2. **拆分两个 scene 类**：按 `TODO(P2)` 的方向提取 loader/camera/light/annotation/slice/measurement controller，各自 `dispose()`。风险：中高，分阶段、每次提取后用 `verify:preview` + `verify:preview:success` 守门。
3. **收敛视图层**：抽取共享 `loadPreparedModel()`（消 Finding 9）、store 单主（消 Finding 8）、`helper-buttons.ts` 拆面板。风险：中，用 `verify:settings`/`verify:knowledge-index`/`verify:preview` 守门。
4. **单一来源的共享工具**：`registered-part-persistence.ts`、`utils/base64.ts`、统一网络守卫，消除 Finding 18 的漂移。风险：低。

**测试策略**：每阶段遵循 `AGENTS.md` 的 change-to-test 映射；渲染改动跑 `verify:preview`/`verify:preview:success`，状态改动跑 `verify:settings`，知识改动跑 `verify:knowledge-index`，远程跑 `verify:remote-draft`。
