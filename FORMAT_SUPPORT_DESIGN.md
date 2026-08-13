# AI 3D Model Workbench 格式扩展设计稿（GitHub 方案调研版）

## 1. 目标与边界

### 1.1 目标
- 在不显著增加插件包体和运行内存的前提下，增加更多 3D 格式支持。
- 保持现有 Babylon 渲染主链稳定，避免将 CAD 内核直接塞进插件。
- 同时覆盖桌面端与移动端的可用策略。

### 1.2 关键边界
- 插件内优先支持网格格式（可直接渲染）。
- CAD 重格式优先通过外部转换到 glb，再进入现有渲染链。
- 许可证优先选择 MIT/Apache-2.0/BSD；避免将强约束或争议许可直接并入主运行时。

---

## 2. GitHub 方案调研结论

## 2.1 occt-import-js
- 仓库: https://github.com/kovacsv/occt-import-js
- 许可证: LGPL-2.1
- 核心思路: 浏览器内 OpenCascade wasm 直接读 STEP/IGES/BREP，输出三角网格 JSON。
- 优点:
  - 前端可直接处理 STEP/IGES。
  - 能保留一定层级和拓扑信息。
- 风险与代价:
  - 需要引入 wasm 资产，包体和内存压力显著上升。
  - 解析峰值内存高，复杂模型在 Electron/移动端风险较大。
  - 许可证与分发策略要严格评估。
- 启发:
  - 适合实验模式或可选能力，不适合作为默认主链。

## 2.2 ts-3d-model-viewer
- 仓库: https://github.com/wx-chevalier/ts-3d-model-viewer
- 关键特征: 组合了多套 viewer + wasm worker + CAD 解析支路。
- 风险点:
  - README 包含 CC BY-NC-ND 4.0 文字声明，直接复用其表达内容和实现细节存在合规风险。
- 启发:
  - 可借鉴架构思想（多通道路由），不应复用其代码与文档表达。

## 2.3 xeokit-sdk
- 仓库: https://github.com/xeokit/xeokit-sdk
- 许可证: AGPL-3.0（另有商业授权）
- 核心思路: 通过预转换（如 IFC -> XKT）再高性能加载。
- 启发:
  - 强烈证明“预转换优于前端硬解析”的工程可行性。
- 风险:
  - AGPL 不适合作为当前插件直接集成依赖。

## 2.4 google/model-viewer
- 仓库: https://github.com/google/model-viewer
- 许可证: Apache-2.0
- 核心思路: 围绕 glTF/glb 的统一交付，避免在运行时支持复杂 CAD 解析。
- 启发:
  - 统一到 glb 是最稳妥的运行时策略。

## 2.5 glTF-Transform
- 仓库: https://github.com/donmccurdy/glTF-Transform
- 许可证: MIT
- 核心思路: glTF 后处理与优化（dedup/prune/draco/meshopt/纹理压缩）。
- 启发:
  - 作为“转换后优化”工具非常适合插件离线管线。

## 2.6 assimp
- 仓库: https://github.com/assimp/assimp
- 许可证: BSD-3-Clause
- 核心思路: 40+ 格式导入到统一内存结构，配合后处理。
- 启发:
  - 非常适合做桌面离线转换层，不建议直接进前端运行时。

## 2.7 obj2gltf
- 仓库: https://github.com/CesiumGS/obj2gltf
- 许可证: Apache-2.0
- 核心思路: OBJ/MTL 到 glTF/glb，可作为 CLI 或库。
- 启发:
  - 可作为轻量转换器接入转换通道。

## 2.8 FBX2glTF
- 仓库: https://github.com/facebookincubator/FBX2glTF
- 许可证: BSD-3-Clause
- 核心思路: FBX 到 glTF/glb，支持 Draco 和多参数控制。
- 风险:
  - 项目更新较慢，需要评估维护状态。
- 启发:
  - 适合作为可选转换器，不宜作为唯一关键路径。

---

## 3. 推荐总体架构（低风险主线）

### 3.1 双通道
- 直读通道（Direct）:
  - glb, gltf, stl, obj, ply, splat
  - 后续可扩: 3mf, dae
- 转换通道（Convert）:
  - step, stp, iges, igs, brep, fbx, x_t, x_b, catpart 等
  - 统一转换为 glb 后进入现有 Babylon 渲染

### 3.2 统一渲染输入
- Babylon 仅接收:
  - 原生可读网格
  - 或转换后的 glb
- 渲染层不直接承载 CAD 内核逻辑。

### 3.3 核心收益
- 包体可控。
- 运行时内存可控。
- 多端策略清晰。
- 法务风险可控。

---

## 4. 模块设计（建议新增）

- src/io/formats/types.ts
  - 格式能力类型定义。
- src/io/formats/registry.ts
  - 扩展名 -> 处理策略映射。
- src/io/model-pipeline.ts
  - 总编排入口（探测、路由、错误归一）。
- src/io/direct/direct-load-service.ts
  - 直读格式加载服务。
- src/io/convert/converter.ts
  - 转换器抽象接口。
- src/io/convert/conversion-service.ts
  - 转换器选择、执行、日志聚合。
- src/io/convert/adapters/freecad-converter.ts
  - STEP/IGES/BREP 适配（桌面优先）。
- src/io/convert/adapters/obj2gltf-converter.ts
  - OBJ -> GLB。
- src/io/convert/adapters/fbx2gltf-converter.ts
  - FBX -> GLB（可选）。
- src/io/cache/converted-asset-cache.ts
  - 转换产物缓存与失效。
- src/io/preview/preview-source.ts
  - 将 pipeline 输出适配为现有 Babylon 输入。

---

## 5. 格式支持矩阵（建议）

| 格式 | 第一阶段策略 | 桌面 | 移动 | 备注 |
|---|---|---|---|---|
| glb/gltf | 直读 | 支持 | 支持 | 主格式 |
| stl/obj/ply/splat | 直读 | 支持 | 支持（限大小） | 现有能力 |
| 3mf/dae | 转换到 glb | 支持 | 默认不支持 | 依赖 Python/trimesh（Babylon.js 不支持直读） |
| step/stp | 转换到 glb | 支持 | 默认不支持 | 依赖 Python/CadQuery(OCCT) |
| iges/igs/brep | 转换到 glb | 支持 | 默认不支持 | 依赖 Python/CadQuery(OCCT) |
| fbx | 转换到 glb | 支持 | 默认不支持 | 可选 FBX2glTF |

---

## 6. 资源占用估算

### 6.1 推荐方案（不内置 CAD wasm）
- 插件包体增量:
  - 第一阶段（仅架构与转换接口）: +0.1 MB ~ +0.4 MB
  - 第二阶段（增加部分轻 loader）: 额外 +0.3 MB ~ +1.5 MB
- 预期总量:
  - 约 8.2 MB ~ 10 MB

### 6.2 不推荐方案（内置 CAD wasm）
- 典型额外 wasm 资产约 7 MB 级别。
- 总包体易到 15 MB+，并带来高峰内存问题。

### 6.3 运行时内存
- 推荐方案中，CAD 解析峰值在外部转换器进程，不在 Obsidian 插件进程。
- 插件进程主要承担 glb 渲染成本，稳定性显著更好。

---

## 7. 多端策略

### 7.1 桌面端
- 启用双通道全能力。
- 启用转换缓存。
- 支持复杂格式转换。

### 7.2 移动端
- 只保留轻格式直读。
- 默认禁用转换通道。
- 增加大小阈值、分辨率和特效降级策略。

---

## 8. 许可证与合规策略

- 运行时优先依赖: MIT / Apache-2.0 / BSD。
- 避免直接引入:
  - CC BY-NC-ND 来源代码/文档表达。
  - AGPL 依赖进入主运行时。
- 对外部转换器:
  - 采用“用户本地安装，插件只调用”模式。
  - 在文档中明确第三方工具许可归属与责任边界。

---

## 9. 分阶段落地计划

### Phase 1（最小可行）
- 新增 registry + pipeline + conversion-service 抽象。
- 现有格式全部迁移到统一入口，但行为不变。

### Phase 2（桌面转换）
- 接入 FreeCAD 转换适配器。
- 支持 step/stp/iges/igs 到 glb。
- 上线转换缓存与失败可观测日志。

### Phase 3（轻格式扩展 — 修订）
- **修订**: Babylon.js 9.6 不支持 3MF 导入和 DAE/Collada，无法直读。
- 改走转换通道：实现 assimp CLI 适配器（BSD-3-Clause），将 3MF/DAE 转为 GLB。
- 注册 assimp 到转换器工厂、命令发现、格式注册表。
- 添加 `assimpCommand` 设置项和设置页 UI。

### Phase 4（优化与治理）
- 引入 glTF-Transform 做转换后优化（prune/dedup/压缩）。
- 增加模型质量与资源预算阈值策略。

---

## 10. 风险清单

- 技术风险:
  - 外部转换器在不同平台安装路径差异大。
  - 大模型转换耗时长，需异步状态与取消机制。
- 产品风险:
  - 移动端用户对复杂格式预期需提前提示。
- 法务风险:
  - 不应复用受限许可证项目的实现表达。

---

## 11. 最终建议

- 采用“直读 + 转换”双通道作为长期架构。
- 统一以 glb 作为渲染交付格式。
- 把重格式解析能力前移到外部转换层。
- 第一阶段先做架构，不急于一次性加所有格式。

该路线在工程稳定性、内存占用、包体控制与许可证可控性上，综合收益最高。

---

## 12. 当前落地状态（2026-05-08）

### 12.1 已完成（架构与功能实装）
- 已落地统一格式注册与能力映射：
  - `src/io/formats/types.ts`
  - `src/io/formats/registry.ts`
- 已落地统一 pipeline 编排入口，并接入主要预览入口：
  - `src/io/model-pipeline.ts`
- 已落地直读与转换服务：
  - `src/io/direct/direct-load-service.ts`
  - `src/io/conversion/conversion-service.ts`
- 已落地转换器管理、工厂与共享命令探测：
  - `src/io/conversion/manager.ts`
  - `src/io/conversion/factory.ts`
  - `src/io/conversion/command-discovery.ts`
- 已落地 CAD/mesh 转换器（基于 Python/CadQuery/trimesh）：
  - `src/io/conversion/adapters/freecad-converter.ts` — STEP/IGES/BREP → GLB (CadQuery + trimesh)
  - `src/io/conversion/adapters/assimp-converter.ts` — 3MF/DAE → GLB (trimesh)
  - `src/io/conversion/adapters/obj2gltf-converter.ts` — OBJ → GLB
  - `src/io/conversion/adapters/fbx2gltf-converter.ts` — FBX → GLB
- 已落地转换缓存与预览输入适配：
  - `src/io/cache/converted-asset-cache.ts`
  - `src/io/preview/preview-source.ts`
- 已将工作台与相关加载入口接入 pipeline + conversion manager + cache + preview source。

### 12.2 已完成（配置、诊断与策略）
- 已增加转换器启用配置与命令路径配置：
  - `settings.enabledConverterIds`
  - `settings.freecadCommand`
  - `settings.obj2gltfCommand`
  - `settings.fbx2gltfCommand`
  - `settings.assimpCommand`
- 已增加 OBJ 的 direct-first 偏好配置：
  - `settings.preferObj2gltfForObj`
- 已增加日志级别配置与统一 logger：
  - `settings.logLevel`
  - `src/utils/log.ts`
- 已在 pipeline / conversion / workbench 关键路径加入结构化日志。
- 已在设置页增加 Converter command diagnostics 与手动检查入口。
- 已在命令面板增加 `Check Converter Commands` 命令。
- FBX 长期默认策略已明确：通过 FBX2glTF 转换到 GLB，避免绑定与 Babylon.js 9 不兼容的社区 FBX loader。

### 12.3 本机联调结论（Windows）
- 已通过本机 harness 验证 OBJ 偏好切换行为：
  - 默认偏好关闭时走 direct。
  - 偏好打开时走 convert。
- 已通过本机 harness 验证转换缓存行为：
  - 同一 converter identity 下二次请求命中缓存。
  - 命令路径或 converter identity 变化时触发重新转换。
- 已验证 Python 环境可用性：
  - Python 3.13 + trimesh 4.12.2 + numpy 2.4.4 + networkx + pycollada + cadquery 2.7.0 + cadquery-ocp 7.8.1.1
- 已完成端到端转换验证：
  - 3MF → GLB：trimesh 直接转换，8 顶点 12 三角面 ✓
  - DAE → GLB：trimesh 直接转换，8 顶点 12 三角面 ✓
  - STEP → GLB：CadQuery 读取 → STL → trimesh → GLB ✓
- 外部 CLI 状态：
  - obj2gltf：unavailable
  - FBX2glTF：unavailable

### 12.4 已完成（Phase 3 — assimp 转换通道）
- 已实现 assimp CLI 转换适配器：`src/io/conversion/adapters/assimp-converter.ts`
- 已注册 assimp 到转换器工厂：`src/io/conversion/factory.ts`
- 已添加 assimp 命令发现（4 层解析）：`src/io/conversion/command-discovery.ts`
- 已更新格式注册表：3MF/DAE 走 convert 通道（`src/io/formats/registry.ts`）
- 已添加 `settings.assimpCommand` 设置项与设置页 UI
- **关键修订**: Babylon.js 9.6 不支持 3MF 导入和 DAE/Collada，Phase 3 从"直读"改为"转换通道"

### 12.5 仍待推进（后续实现）
- 在已安装 FreeCAD / obj2gltf / FBX2glTF / assimp 的机器上完成端到端 CLI 转换联调。
- 在 Obsidian 桌面 UI 中手动 smoke test 设置页 diagnostics 呈现与交互。
- 转换任务状态机（开始/进度/取消/失败恢复）与 UI 呈现。
- 转换后 glTF-Transform 优化链（prune / dedup / 压缩）。

### 12.6 验证状态
- 当前工程已通过 TypeScript 编译校验：`node .\\node_modules\\typescript\\lib\\tsc.js --noEmit --skipLibCheck`。
- 编辑器错误扫描结果为 0。
- 现有直读行为与入口兼容保持不变。

### 12.7 运行时格式注册与直读分派（2026-08）
- 格式注册表已支持运行时扩展：`registerFormatCapability` / `unregisterFormatCapability` /
  `resetFormatCapabilities` / `getFormatCapabilities`，可在不改内置列表的前提下新增或覆盖格式。
- `directLoader` 放宽为任意字符串，允许自定义加载器标识；`FormatCapability` 新增 `displayName` 可读名。
- 直读分派已改为注册表驱动：`getDirectLoaderKind(ext)` 返回 `gltf` / `obj` / `stl` / `ply` 等
  渲染器无关的 loader 标识，Three 与 Babylon 的 `loadModel` 均按该标识分派，不再各自硬编码扩展名分支。
- 转换工厂已支持运行时注册：`createConversionManager` 接受 `extraConverters` 自定义转换器，
  与 `registerFormatCapability` 配合即可端到端接入一个新 `convert` 格式。
- 边界说明：注册表扩展是"路由元数据"级扩展，并非新格式开箱即用——新 `convert` 格式仍需在
  `conversion/factory.ts` 注册对应转换器，新 `direct` 格式仍需在渲染层增加对应 loader 实现。

### 12.8 新增 trimesh 可转换格式（2026-08）
- 新增两种可转换源格式：OFF（`off`）、Gmsh（`msh`），均为 `trimesh.load()` 核心格式，
  无需额外依赖（`xaml` 需可选依赖 `lxml`、`xyz` 为点云无法经当前 trimesh 网格桥输出 GLB，
  故暂未纳入）。
- 两者均路由至 assimp（Python/trimesh）转换桥，输出为 `glb`，归属 `mesh` 族。

### 12.9 新增 FreeCAD 原生 CAD 格式（2026-08）
- 将原 SLDPRT 转换器泛化为 FreeCAD 原生 CAD 转换器，新增 Parasolid（`x_t`、`x_b`）与
  CATIA（`catpart`、`catproduct`）支持，与 `sldprt` 共用 FreeCADCmd + ImportGui 导入脚本。
- 这些格式依赖 FreeCAD 原生导入器（非 CadQuery/OCCT），转换失败时按现有错误通道提示。
- 转换器 id 保持 `sldprt` 以兼容已保存的 `enabledConverterIds` 设置。

---

## 13. 设计完成判定（Final）

当且仅当满足以下条件，视为“设计完成”：

1. 架构层：
- 双通道架构（直读 + 转换）边界清晰。
- 统一渲染输入约束清晰（Babylon 只接直读 mesh 或转换后 glb）。

2. 模块层：
- 目标模块清单已定义并在代码中具备可编译骨架。
- 入口编排关系已明确（registry -> pipeline -> direct/convert -> preview source）。

3. 配置层：
- 转换器启用策略可配置（默认关闭）。
- 日志级别可配置且可在运行期生效。

4. 验证层：
- 设计相关骨架接入后可通过类型检查。
- 现有直读路径行为无破坏性变更。

基于当前状态，上述条件均已满足，因此本设计稿已达到“设计完成”状态。

---

## 14. 验收清单（Design Acceptance Checklist）

- [x] 已定义格式能力模型与扩展名路由。
- [x] 已定义并落地 pipeline 统一入口。
- [x] 已定义并落地 direct service。
- [x] 已定义并落地 conversion service。
- [x] 已定义并落地 conversion manager + factory。
- [x] 已定义并落地转换适配器接口骨架（freecad/obj2gltf/fbx2gltf）。
- [x] 已定义并落地转换缓存接口（运行期缓存）。
- [x] 已定义并落地 preview source 适配层。
- [x] 已接入设置项：enabledConverterIds。
- [x] 已接入设置项：logLevel。
- [x] 已在关键链路加入结构化日志。
- [x] 已更新设计文档状态说明。

---

## 15. 设计与实现边界说明

以下事项属于“实现深化”，不影响“设计已完成”的判定：

1. 真实转换执行器实现：
- FreeCAD CLI 桥接。
- obj2gltf / fbx2gltf CLI 桥接。

2. 运行时能力增强：
- 转换任务状态机（进度、取消、失败恢复）。
- 持久化转换缓存（跨会话复用）。

3. 能力扩展：
- 3mf / dae 的第二批直读接入。
- glTF-Transform 优化链接入。

上述内容建议作为 Phase 2+ 实施计划执行。
