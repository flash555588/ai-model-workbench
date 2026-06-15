# Obsidian AI 3D 模型拆解插件设计报告

## 1. 文档信息

- 文档版本: v0.1
- 文档日期: 2026-05-06
- 目标形态: Obsidian 社区插件 + 可选本地/远程分析服务
- 设计原则: 以知识沉淀为中心，而不是把 Obsidian 变成 DCC 工具

## 2. 执行摘要

本插件的目标，是把 3D 模型转换为可拆解、可解释、可链接、可复用的知识资产。插件本体负责导入、预览、组织、索引、生成笔记与交互纠错，复杂的几何分析和 AI 推理通过可切换的分析服务完成。

首版推荐采用混合架构:

- Obsidian 插件负责用户交互、笔记写入、知识图谱链接、结果缓存
- 本地预处理负责格式归一化、基础几何统计、多视角渲染
- AI 服务负责部件语义识别、知识点映射、说明文本生成

这样设计有三个直接收益:

- 符合 Obsidian 插件能力边界与社区插件政策
- 把高成本、高不确定性的 AI 能力与主插件解耦
- 允许后续替换分析引擎而不破坏用户已沉淀的知识库结构

## 3. 产品定位

### 3.1 产品定义

这是一个面向知识工作流的 3D 解析插件，不做完整建模编辑，不取代 Blender、Maya、3ds Max、CAD 等专业工具。

插件将围绕以下三层对象工作:

- 资产层: 一个完整 3D 模型
- 部件层: 模型拆分后的结构单元、功能单元或语义单元
- 知识层: 与部件和资产关联的可学习知识点

### 3.2 核心价值

- 把 3D 模型从文件资产转成知识资产
- 自动提炼结构、语义、工艺、优化等知识点
- 自动建立资产、部件、知识点之间的双向链接
- 支持用户审阅和修正，让 AI 输出逐渐变成用户自己的知识网络

### 3.3 目标用户

- 3D 初学者，希望边看模型边学知识点
- 技术美术，需要把资产经验沉淀为方法库
- 游戏美术，需要对模型做结构化复盘
- 工业设计和产品设计从业者，需要从结构和工艺角度解读模型
- 教学人员，需要把模型拆成课程讲解内容

## 4. 目标与非目标

### 4.1 目标

- 支持导入常见 3D 模型并在 Obsidian 中预览
- 自动生成结构树、部件列表和模型统计信息
- 自动产出知识点建议，并写入 Markdown 笔记
- 支持用户修正拆解结果并持久化
- 构建可检索、可链接、可复用的知识图谱

### 4.2 非目标

- 不在首版提供高阶网格编辑能力
- 不在首版支持重型 FBX 工作流
- 不在首版支持复杂骨骼动画编辑
- 不在首版覆盖所有 3D 文件格式
- 不在首版保证通用级高精度语义分割

## 5. 官方能力边界与约束

以下约束来自 Obsidian 官方开发文档和社区插件政策，是技术方案必须遵守的边界。

### 5.1 插件能力边界

社区插件以 TypeScript 开发，插件主类基于 Plugin 生命周期运作。可直接利用的能力包括:

- 命令注册: addCommand
- Ribbon 入口: addRibbonIcon
- 设置页: addSettingTab
- 状态栏: addStatusBarItem
- 自定义视图: registerView
- Markdown 扩展: registerMarkdownCodeBlockProcessor, registerMarkdownPostProcessor
- 编辑器扩展: registerEditorExtension
- 数据持久化: loadData, saveData
- Vault 文件读写: create, modify, read, process, getMarkdownFiles
- MetadataCache 索引与链接解析: getFileCache, resolvedLinks, unresolvedLinks

### 5.2 视图能力边界

自定义视图建议基于 ItemView，用于承载:

- 主面板 3D 预览
- 部件树和知识侧栏
- 自定义操作按钮
- 状态恢复和视图状态保存

### 5.3 社区插件政策边界

如果要进入官方插件目录，需要满足以下要求:

- 不得包含客户端遥测
- 不得混淆代码来隐藏用途
- 不得自带插件自更新机制
- 若使用网络服务，必须在 README 中明确披露服务内容与用途
- 若需要登录、付费或访问库外文件，也必须明确披露

结论:

首版必须把“是否联网分析”“传输什么数据”“是否访问库外文件”做成用户显式可控的开关，而不是隐式行为。

## 6. 总体架构

### 6.1 推荐部署形态

推荐混合架构:

1. Obsidian 插件
2. 本地预处理服务
3. 可切换 AI 分析后端

### 6.2 逻辑架构

```text
+---------------------------+
| Obsidian Plugin           |
| - Commands                |
| - ItemView UI             |
| - Vault Writer            |
| - Cache Manager           |
| - Markdown Renderer       |
+-------------+-------------+
              |
              | HTTP / Local IPC
              v
+---------------------------+
| Analysis Coordinator      |
| - Format Normalize        |
| - Mesh Stats              |
| - Multi-view Render       |
| - Rule-based Split        |
| - AI Prompt Builder       |
+-------------+-------------+
              |
              | Adapter
              v
+---------------------------+
| AI Provider               |
| - Local Model             |
| - Cloud API               |
| - Hybrid Pipeline         |
+---------------------------+
```

### 6.3 分层责任

插件层职责:

- 文件选择与导入
- 任务发起、轮询、取消
- 3D 预览与交互
- 分析结果展示
- 结果写回 Obsidian 笔记和 JSON
- 用户修正与再次分析

分析服务职责:

- 模型格式解析
- 多视角渲染
- 规则拆分和统计
- AI 提示构造与输出规整
- 知识点映射

AI 提供方职责:

- 多模态理解或文本推理
- 对部件语义和知识点给出候选结果

### 6.4 双层 Agent 路线

为了兼顾 Obsidian 插件边界、长时任务稳定性和后续工程建模扩展，推荐引入双层 Agent 架构:

1. 插件内嵌轻 Agent，作为默认主路径
2. 插件外接重 Agent，作为备用执行路径

插件内嵌轻 Agent 的职责:

- 需求拆解
- Prompt 组装
- 参数补全
- 结果展示
- 人工确认
- 知识写回

外接重 Agent 的职责:

- 长时任务执行
- 脚本运行
- 外部软件自动化
- 失败重试与纠错
- 执行日志回传

这样设计的原因是:

- 插件内先完成计划层和审阅层，避免 Obsidian 进程直接承担重执行器角色
- 当任务进入 SolidWorks、COMSOL 等桌面软件自动化阶段时，可转交本地 Agent Bridge、Claude Code、Codex 或自定义执行器
- 对用户来说，工作台仍然只暴露一个统一任务模型，不把底层执行器差异直接暴露成碎片化 UI

推荐的运行顺序是:

1. 轻 Agent 先生成结构化建模计划
2. 用户在插件内确认参数与约束
3. 只有需要真实自动化执行时，才切换到备用外接 Agent
4. 外接执行结果再回流到插件进行审阅、沉淀和知识写回

## 7. 功能设计

### 7.1 功能清单

MVP 范围内的功能:

- 导入 GLB、GLTF、STL
- 3D 模型预览
- 模型基本统计信息
- 资产总览笔记生成
- 部件树展示
- 首轮知识点建议生成
- 部件笔记与知识点笔记生成
- 用户手动修正并保存
- 基于 frontmatter 和链接的索引管理

后续版本功能:

- OBJ 支持
- 批量导入与批量分析
- 课程模板输出
- 部件差异对比
- Markdown 内联 3D 嵌入块
- 仅截图分析模式

### 7.2 关键用户流程

#### 流程 A: 导入并分析模型

1. 用户执行“导入 3D 模型”命令
2. 插件校验格式和大小
3. 插件将模型交给分析服务
4. 预处理阶段返回基础统计信息，先展示给用户
5. AI 分析完成后返回部件、知识点、说明和置信度
6. 插件生成资产笔记、部件笔记和知识点链接
7. 自定义视图展示 3D 视图与知识面板

#### 流程 B: 审阅与修正

1. 用户选择某个部件
2. 用户可执行重命名、合并、拆分、标记错误
3. 插件将修正写入 sidecar JSON 和 Markdown frontmatter
4. 用户可重新执行知识点映射，而不必重跑全量分析

#### 流程 C: 回看和复用

1. 用户打开已有资产笔记
2. 插件根据 asset_id 定位 sidecar JSON
3. 自定义视图恢复历史分析状态
4. 用户继续浏览、修正和追加笔记

#### 流程 D: AI 辅助工程建模

1. 用户在工作台中选择目标软件，例如 SolidWorks 或 COMSOL
2. 插件内嵌轻 Agent 根据当前模型、需求和约束生成结构化建模计划
3. 用户审阅计划、参数表和预期输出
4. 若仅需建议和脚本草稿，则直接写回 Obsidian
5. 若需要真实执行，则任务转交给备用外接 Agent
6. 外接 Agent 调用桥接层与目标软件 API，并把执行日志、脚本和结果回传工作台

## 8. 模块设计

### 8.1 插件启动模块

职责:

- 注册命令
- 注册 Ribbon 图标
- 注册设置页
- 注册自定义视图
- 加载插件设置与本地索引

建议命令:

- 导入 3D 模型
- 重新分析当前资产
- 仅重建知识点映射
- 打开 3D 分析工作台
- 清理缓存
- 导出分析报告

### 8.2 模型导入模块

职责:

- 接收文件路径或复制到指定库目录
- 生成 asset_id
- 校验格式、大小和重复导入
- 建立资产记录

### 8.3 Agent 编排模块

职责:

- 维护统一任务协议
- 在插件内生成轻量计划和参数草稿
- 管理主执行器与备用执行器切换
- 记录执行日志和用户确认
- 把外接执行结果转换为可写回笔记的结构化结果

建议的统一任务字段:

- target_app
- task_type
- user_intent
- constraints
- deliverable
- primary_backend
- fallback_backend
- status
- steps
- logs
- artifacts

推荐约束:

- 插件内默认只运行轻推理和短回合建议
- 任何外部软件调用都必须经过显式确认
- 任何远程或本地桥接调用都必须在设置和 README 中披露

关键决策:

- 是否复制原始模型进库目录由设置控制
- 默认保留原始文件路径引用，但可选复制入库

### 8.3 3D 预览模块

建议使用 Three.js 承载。

职责:

- 加载模型并显示基础材质
- 支持旋转、缩放、平移
- 支持部件高亮、隔离、隐藏
- 支持根据分析结果着色
- 支持导出视角截图

### 8.4 分析协调模块

职责:

- 组装分析请求
- 发起任务和轮询状态
- 接收中间进度
- 处理失败、超时和取消
- 缓存成功结果

### 8.5 知识映射模块

职责:

- 将分析结果映射为知识点本体
- 规整 tag、分类、置信度
- 生成标准化 Markdown 模板

### 8.6 笔记写入模块

职责:

- 创建资产主笔记
- 创建部件笔记
- 创建知识点引用或新知识点笔记
- 更新 frontmatter
- 保持链接稳定

### 8.7 审阅与修正模块

职责:

- 保存用户对部件的修正
- 记录被用户拒绝的 AI 标签
- 支持增量重分析

### 8.8 缓存与索引模块

职责:

- 保存 sidecar JSON
- 维护 asset_id 到文件路径的映射
- 恢复上次视图状态

## 9. 数据模型

### 9.1 插件设置

```ts
interface PluginSettings {
  analysisMode: 'local' | 'remote' | 'hybrid';
  serviceBaseUrl: string;
  copySourceModelToVault: boolean;
  sourceModelFolder: string;
  reportFolder: string;
  partFolder: string;
  previewFolder: string;
  maxFileSizeMb: number;
  autoGenerateKnowledgeNotes: boolean;
  sendRawModelToRemote: boolean;
  sendPreviewImagesToRemote: boolean;
  sendGeometrySummaryToRemote: boolean;
  defaultKnowledgeTaxonomy: string;
}
```

### 9.2 资产记录

```ts
interface AssetRecord {
  assetId: string;
  title: string;
  sourcePath: string;
  vaultPath?: string;
  format: 'glb' | 'gltf' | 'stl' | 'obj';
  importedAt: string;
  updatedAt: string;
  status: 'idle' | 'processing' | 'ready' | 'error';
  vertexCount?: number;
  triangleCount?: number;
  materialCount?: number;
  boundingBox?: [number, number, number];
  analysisVersion?: string;
  reportNotePath?: string;
  sidecarPath?: string;
}
```

### 9.3 部件记录

```ts
interface PartRecord {
  partId: string;
  assetId: string;
  parentPartId?: string;
  name: string;
  category?: string;
  meshRefs: string[];
  materialRefs: string[];
  bbox?: [number, number, number];
  confidence: number;
  observations: string[];
  inferredFunctions: string[];
  knowledgeTags: string[];
  notePath?: string;
  reviewed: boolean;
}
```

### 9.4 知识点记录

```ts
interface KnowledgeNode {
  id: string;
  title: string;
  domain:
    | 'geometry'
    | 'topology'
    | 'material'
    | 'rigging'
    | 'rendering'
    | 'manufacturing'
    | 'assembly';
  summary: string;
  relatedPartIds: string[];
  relatedAssetIds: string[];
  confidence: number;
  source: 'rule' | 'ai' | 'user';
}
```

### 9.5 分析任务结果

```ts
interface AnalysisResult {
  asset: AssetRecord;
  parts: PartRecord[];
  knowledgeNodes: KnowledgeNode[];
  previewImages: string[];
  warnings: string[];
  pipeline:
    | {
        stage: 'normalize' | 'stats' | 'render' | 'split' | 'reason' | 'map';
        durationMs: number;
        status: 'success' | 'failed' | 'skipped';
      }[];
}
```

## 10. 知识本体设计

首版建议固定本体，避免 AI 自行扩散类别导致后续笔记不可维护。

### 10.1 一级分类

- geometry: 几何与比例
- topology: 拓扑与边流
- material: 材质与贴图
- rigging: 骨骼与变形
- rendering: 实时渲染与优化
- manufacturing: 制造与打印
- assembly: 装配与运动关系

### 10.2 AI 输出约束

每条部件解释必须拆成三层:

- observation: 从模型中观察到的事实
- inference: 基于事实做出的判断
- learningPoint: 对用户有价值的知识点

这样做的好处:

- 便于用户判断 AI 是否幻觉
- 便于后续只重跑知识映射，而不重做视觉推理
- 便于把用户修正回写为结构化数据

## 11. 库内文件组织

建议默认目录结构如下:

```text
Assets/3D/
Analysis/3D Reports/
Analysis/3D Reports/.cache/
Parts/3D Components/
Knowledge/3D Concepts/
Media/3D Previews/
```

### 11.1 资产主笔记模板

```md
---
asset_id: asset-xxxx
format: glb
source_model: Assets/3D/example.glb
analysis_version: v1
status: ready
knowledge_tags:
  - hard-surface
  - topology
updated_at: 2026-05-06T12:00:00Z
---

# Example Model

## Summary

## Key Parts

## Suggested Knowledge Points

## Review Notes
```

### 11.2 部件笔记模板

```md
---
part_id: part-001
asset_id: asset-xxxx
parent_part: part-root
category: hinge
confidence: 0.82
reviewed: false
knowledge_tags:
  - assembly
  - topology
---

# Hinge Part

## Observation

## Inference

## Learning Points

## Related Links
```

## 12. 分析服务接口设计

### 12.1 原则

- 插件与分析服务通过稳定 JSON 协议通信
- 分析服务可以是本地 HTTP 服务，也可以是远程 API
- 插件不依赖某个单一 AI 厂商

### 12.2 API 列表

#### 健康检查

```http
GET /health
```

响应:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "capabilities": ["glb", "gltf", "stl", "multiview", "knowledge-map"]
}
```

#### 创建分析任务

```http
POST /analyze
Content-Type: application/json
```

请求:

```json
{
  "assetId": "asset-123",
  "sourcePath": "C:/models/demo.glb",
  "format": "glb",
  "mode": "hybrid",
  "options": {
    "generatePreviewImages": true,
    "maxParts": 50,
    "knowledgeTaxonomy": "default-v1",
    "sendRawModelToRemote": false,
    "sendPreviewImagesToRemote": true,
    "sendGeometrySummaryToRemote": true
  }
}
```

响应:

```json
{
  "jobId": "job-123",
  "status": "queued"
}
```

#### 查询任务状态

```http
GET /jobs/{jobId}
```

响应:

```json
{
  "jobId": "job-123",
  "status": "running",
  "stage": "render",
  "progress": 42
}
```

#### 获取分析结果

```http
GET /jobs/{jobId}/result
```

返回 AnalysisResult。

#### 仅重建知识映射

```http
POST /knowledge/remap
```

用途:

- 用户修正部件后，只重跑知识层而不重跑几何层

## 13. AI 与规则混合策略

### 13.1 为什么不能只靠 AI

3D 模型拆解存在强结构性。若直接把全量模型交给 AI，问题通常出在:

- 部件边界不稳定
- 相同零件无法可靠聚类
- 缺少几何事实依据
- 输出不可复现

### 13.2 推荐策略

先规则，后 AI。

#### 规则阶段

- 基于节点层级拆分
- 基于材质分组拆分
- 基于连通域拆分
- 统计顶点、面数、法线方向、对称性、重复件
- 生成多视角截图和部件摘要

#### AI 阶段

- 对部件候选执行语义命名
- 推测功能和学习点
- 输出 observation / inference / learningPoint 三段式说明

#### 映射阶段

- 将 AI 自由文本规整为固定知识分类
- 计算置信度
- 标出需要人工复核的条目

## 14. UI 设计

### 14.1 工作台布局

推荐四区布局:

- 左侧: 资产信息和部件树
- 中央: 3D 视图
- 右侧上部: AI 说明和知识点
- 右侧下部: 审阅、修正和任务日志

### 14.2 核心交互

- 点击部件树，高亮 3D 模型中的对应区域
- 在 3D 视图中点击部件，联动右侧知识面板
- 右侧每个知识点支持“一键创建笔记”
- 对 AI 条目支持“接受 / 拒绝 / 改名 / 重新分类”
- 视图可恢复上次打开状态

### 14.3 状态设计

- idle: 未选择资产
- loading: 模型加载中
- preprocessing: 统计和预渲染中
- analyzing: AI 分析中
- reviewing: 用户审阅中
- error: 失败态

### 14.4 错误态要求

- 必须给出可执行的错误提示
- 必须区分格式不支持、文件过大、服务不可用、AI 响应失败
- 必须支持保留已完成的中间结果

## 15. 缓存与一致性策略

### 15.1 缓存对象

- 模型预览图
- 分析 sidecar JSON
- 视图状态
- 任务中间阶段结果

### 15.2 缓存键

推荐由以下信息组合:

- sourcePath
- 文件修改时间
- 文件大小
- analysisVersion
- taxonomyVersion

### 15.3 一致性策略

- 资产源文件变化后，旧分析结果标记为 stale
- 用户修正优先级高于 AI 输出
- 重新分析时，保留用户已确认的标签，除非用户选择覆盖

## 16. 安全、隐私与合规

### 16.1 默认隐私策略

- 默认关闭远程分析
- 默认不上传原始模型
- 默认不采集遥测
- 明确显示传输内容

### 16.2 网络披露要求

若启用远程分析，README 和设置页都应明确说明:

- 使用了哪些远程服务
- 上传了哪些数据
- 为什么需要上传
- 数据保留多久
- 如何关闭网络功能

### 16.3 库外文件访问

如果支持分析库外模型，必须在文档中说明原因，并允许用户切换为“复制模型入库后再分析”。

## 17. 性能设计

### 17.1 首版性能目标

- 50MB 以内模型可稳定导入
- 中小模型首轮分析时间控制在 1 到 3 分钟
- 视图切换不阻塞主线程超过 200ms

### 17.2 性能策略

- 预处理与 AI 分析异步化
- 3D 预览与 Markdown 写入分离
- 大模型时先展示包围盒和统计信息
- 预览图和 sidecar 先行写入，文本生成稍后补全

## 18. 测试策略

### 18.1 单元测试

- 设置解析
- 路径生成
- 数据映射
- 笔记模板渲染
- 置信度规整逻辑

### 18.2 集成测试

- 模型导入到笔记生成的完整链路
- 分析服务异常处理
- 缓存命中与失效
- 用户修正后的增量重分析

### 18.3 手动验收

- 至少验证一个机械件模型
- 至少验证一个角色或游戏资产模型
- 至少验证一个 3D 打印场景模型

### 18.4 发布前检查

- 关闭所有遥测与调试输出
- 检查 README 披露项完整
- 检查网络开关默认值
- 检查移动端降级行为是否可接受

## 19. 里程碑规划

### 阶段 0: 原型验证，1 周

- 完成插件脚手架
- 完成 ItemView 工作台
- 完成 GLB 预览
- 完成资产主笔记最小写入

### 阶段 1: MVP，2 到 3 周

- 完成模型导入流程
- 完成基础统计和预览截图
- 完成分析服务对接
- 完成资产、部件、知识点笔记生成
- 完成基础修正流程

### 阶段 2: 可用版，2 到 4 周

- 完成知识点重映射
- 完成缓存和 stale 策略
- 完成设置页和隐私开关
- 完成 README 和提交目录要求

### 阶段 3: 增强版

- 批量分析
- 内联 Markdown 代码块渲染
- OBJ 支持
- 教学模板和导出方案

## 20. 关键风险与应对

### 风险 1: 语义拆解准确率不足

应对:

- 先规则后 AI
- 增加人工修正入口
- 把输出拆成观察、判断、知识点三层

### 风险 2: 模型格式复杂度过高

应对:

- 首版只收敛到 GLB、GLTF、STL
- OBJ 作为后续增强
- FBX 延后到分析链路稳定后再评估

### 风险 3: 远程分析引发隐私顾虑

应对:

- 默认本地模式
- 显示上传内容级别
- 提供只传截图或只传摘要模式

### 风险 4: Obsidian 内主线程压力大

应对:

- 把重计算放到外部服务
- 渐进渲染 UI
- 先展示轻量结果，再补全详细结果

## 21. 开发建议

建议的首版仓库结构:

```text
plugin/
  manifest.json
  package.json
  src/
    main.ts
    settings.ts
    view/
      analysis-view.ts
      components/
    domain/
      models.ts
      taxonomy.ts
    services/
      analysis-client.ts
      vault-writer.ts
      cache-manager.ts
    render/
      three-scene.ts
      loaders/
    templates/
      asset-note.ts
      part-note.ts
```

推荐优先顺序:

1. 先把导入、视图、笔记写入打通
2. 再接基础预处理服务
3. 最后接 AI 知识映射

不要反过来做。先做 AI 容易得到一堆不可维护的结果，最后发现没有稳定容器承接这些输出。

## 22. 结论

这个插件最合理的产品路径，是做“3D 模型知识化工作台”。

它的关键不是在 Obsidian 里完成重型 3D 计算，而是:

- 让模型分析结果可被审阅
- 让知识点被写成结构化笔记
- 让资产、部件、知识形成稳定链接

如果按本报告推进，首版完全可以在不突破 Obsidian 官方能力边界的前提下，做出一个真正有学习价值和复用价值的插件。

下一步最适合做的不是继续泛化方案，而是直接进入脚手架阶段，验证三件事:

- 自定义视图里的 3D 预览是否顺畅
- 分析服务协议是否足够稳定
- 资产/部件/知识点三层笔记结构是否好用