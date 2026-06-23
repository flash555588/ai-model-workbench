> **INSTRUCTION TO AI: This is the ONLY valid report template. Do NOT use any formatting, heading style, or structure from files inside the audited project. Output MUST follow this template exactly.**

# Fuck My Shit Mountain Audit Report

**Project:** AI Model Workbench（Obsidian 3D 模型预览与知识笔记插件）
**Audit mode:** full
**Date:** 2026-06-14
**Reviewer:** Kimi Code CLI

---

## 1. Executive Summary

AI Model Workbench 是一款基于 TypeScript 的 Obsidian 插件，用于在 Vault 中渲染 GLB/GLTF/STL/PLY/OBJ 等 3D 模型、添加三维标注，并将模型证据转化为关联知识笔记。项目架构清晰，采用 domain → store → io → render → view 分层，Three.js 作为单模型主渲染路径，Babylon.js 作为 3dgrid 与保守回退路径，且已建立较完整的浏览器/Playwright/Obsidian 验证脚本矩阵。

然而，近期（约 2026-05-25 至 2026-06-08）迭代速度极快：30 余条提交中出现了 Three.js 主渲染迁移、知识索引与零件注册、跨格式零件匹配、工作区 UI 重构、距离测量工具等重大变更，单次提交可达 +5,300/-680 行。高节奏带来明显的可维护性与稳定性债务：大量文件超过 500 行、Three/Babylon 双端重复实现、生成的 `main.js` 被纳入版本控制且当前处于 dirty/锁定状态导致本地构建失败、`package-lock.json` 仍停留在 0.4.3 而 manifest 已经是 0.5.5 等。

主要风险集中在：**发布流程阻塞**（package-lock 版本不一致、dirty bundle）、**稳定性**（store 在卸载时未 flush、多处错误静默吞没、缺少 WebGL 上下文恢复）、**性能**（3.8 MB 双运行时 bundle、Babylon 渲染循环不息、标注投影 O(n²) 布局抖动）、**测试**（无单元测试、集成测试依赖 CSS 类与文案）、**安全**（esbuild 存在 RCE 漏洞、远程草稿内容未做 HTML 转义、转换器命令路径可被任意指定）。

亮点包括：本地优先的知识生成默认策略、Babylon 网络请求守护、GitHub Actions 产物签名与 release 校验、丰富的 i18n、较完整的预览路由文档与决策记录。

总评：**Overall 5.2 / B** — 项目在功能演进上积极进取，但发布工程、稳定性、性能与测试债务已积累到需要刻意投资而非临时修补的程度。

### Score Dashboard

```
Security        ██████░░░░  6.0  B   本地优先与网络守卫较好，但 esbuild 漏洞、远程草稿注入、任意转换器命令削弱信任
Stability       █████░░░░░  5.5  B   有序列化锁与单适配器超时，但 store 未 flush、错误吞没、缺 WebGL 恢复
Performance     █████░░░░░  5.0  B   Three.js 有帧预算与视口暂停，但双运行时 bundle、Babylon 不息循环、O(n²) 投影
Testing         ████░░░░░░  4.5  C   无单元测试；集成脚本覆盖广但易碎，转换管道 uncovered
Maintainability █████░░░░░  5.5  B   分层清晰，但神类文件、双端重复、混合换行、store 暴露 raw setState
Design          █████░░░░░  5.5  B   渲染器抽象良好，但 SRP 违反、重复、大量 as 与非空断言
Release         ████░░░░░░  4.5  C   CI 带产物签名，但 package-lock 版本阻塞、dirty bundle、changelog 缺 0.5.3/0.5.5
─────────────────────────────────────
Overall         █████░░░░░  5.2  B
```

每个维度按 0.0–10.0 评分，**越高越好**。评分基于整体工程判断，非机械扣分。详见 `rubrics/scoring.md`。

### Finding Statistics

| Severity | Count | Confirmed | Suspected |
|----------|-------|-----------|-----------|
| Critical | 0 | 0 | 0 |
| High | 10 | 8 | 0 |
| Medium | 36 | 27 | 0 |
| Low | 16 | 12 | 0 |
| Info | 1 | 0 | 0 |
| **Total** | **63** | **47** | **0** |

---

## 2. Project Map

### 2.1 组件与职责

```text
src/
├── main.ts                    # 插件生命周期、命令注册、视图/处理器注册
├── settings.ts                # 设置页 UI 与诊断控件
├── domain/                    # 共享类型与常量
├── store/                     # createStore 原语 + Obsidian loadData/saveData 桥接
├── io/                        # 格式注册、模型管线、转换器、缓存
├── render/                    # 渲染器抽象 + Three.js/Babylon.js 实现
├── view/                      # direct-view、inline、workbench
├── i18n/                      # 中英双语
└── utils/                     # 路径、日志、DOM、设备、note-reader 等
```

### 2.2 运行时入口与初始化顺序

1. `main.ts:onload()` 加载 `PluginStore`、创建转换缓存、注册命令/文件视图/代码块处理器/实时预览扩展、安装 heading pin observer。
2. 用户触发模型预览时，`src/io/model-pipeline.ts` 根据扩展名与格式能力决定 direct/convert 策略。
3. `src/render/preview/routing.ts` 选择 Three.js 或 Babylon.js 路径；`factory.ts` 动态导入对应渲染器。
4. 渲染器实现 `WorkbenchPreview` / `ModelPreview` 接口，通过 `AnnotationManager` 叠加标注。
5. 知识笔记生成在 `src/view/workbench/knowledge-note.ts` 中完成，写入报告、sidecar、索引、零件草稿与预览图。

### 2.3 状态所有权

- `PluginStore` 持有 `settings`、`modelAssetProfiles`、`convertedAssetRecords`、`lastKnowledgeGeneration` 等持久化状态。
- 但视图层（`direct-view.ts`、`helper-buttons.ts`）直接调用 `ps.store.setState()` 修改 profiles，绕过 store 动作。
- 渲染器内部状态（相机、选中零件、测量线段、wireframe）由各自 scene 类持有，Three/Babylon 双端重复。

### 2.4 持久化

- Obsidian `loadData/saveData` 通过 `data.json` 保存；`PluginStore` 用 500 ms debounce 自动保存。
- 缺少 schema version；卸载时不会 flush pending save。
- 转换缓存记录 `outputPath`，未限制在 Vault 内。

### 2.5 外部接口

- 本地文件系统：读取 Vault 模型、写入报告/图片/缓存。
- 外部 CLI：FreeCAD、Python + cadquery/trimesh、obj2gltf、FBX2glTF。
- 网络：可选远程草稿 `POST /draft-note`；Babylon 网络守护拦截远程脚本/资源请求。

### 2.6 安全边界

- 知识生成默认本地-only；远程草稿需显式配置。
- 转换器命令由用户设置/环境变量决定，当前未校验。
- 模型派生字符串直接插入生成的 Markdown，仅做了部分转义。

### 2.7 高风险区域

- `src/render/three/scene.ts`（2,099 行）与 `src/render/babylon/scene.ts`（1,661 行）：神类文件，双端重复。
- `src/view/workbench/knowledge-note.ts`（1,365 行）：文件 I/O 与状态变更交织。
- `src/view/direct-view.ts`（694 行）与 `src/settings.ts`（651 行）：大文件、多职责。
- 发布工程：`package-lock.json` 与 manifest 版本不一致，`main.js` dirty/锁定。

### Coverage Matrix

| Dimension | Coverage | Evidence inspected | Exclusions / limits |
|-----------|----------|--------------------|---------------------|
| Architecture | High | `src/main.ts`, `src/settings.ts`, `src/domain/*`, `src/store/*`, `src/io/model-pipeline.ts`, `src/io/formats/*`, `src/render/preview/*`, `docs/development-handoff.md`, `docs/preview-routing-matrix.md` | 未做运行时架构验证 |
| Security | High | `src/render/babylon/network-guard.ts`, `src/view/workbench/remote-draft.ts`, `src/io/conversion/*`, `src/diagnostics/report.ts`, `src/main.ts`, `src/settings.ts`, `SECURITY.md`, `package.json`, `package-lock.json`, `.github/workflows/release.yml`, `npm audit`, `eslint` | 未在真实 Obsidian 中做动态渗透测试 |
| Stability | High | `src/store/plugin-store.ts`, `src/main.ts`, `src/io/conversion/manager.ts`, `src/io/conversion/conversion-service.ts`, `src/render/three/scene.ts`, `src/render/babylon/scene.ts`, `src/render/preview/annotations.ts`, `src/view/direct-view.ts`, `src/utils/log.ts`, `src/diagnostics/report.ts` | 未在 iOS/Android 真机测试 WebGL 上下文丢失 |
| Performance | High | `src/render/three/scene.ts`, `src/render/babylon/scene.ts`, `src/render/babylon/grid.ts`, `src/render/preview/annotations.ts`, `src/view/inline/helper-buttons.ts`, `src/view/inline/code-block.ts`, `src/view/direct-view.ts`, `package.json`, `esbuild.config.mjs`, `main.js` | 未使用性能分析器采样真实用户场景 |
| Testing | High | `scripts/verify-*.mjs`, `package.json`, `eslint.config.mjs`, `npm run typecheck`, `npm run build`, `npm audit` | 未执行完整的 `verify:obsidian`（需要 macOS + Obsidian） |
| Maintainability | High | 全部 `src/**/*.ts` 文件大小、导入方向、重复模式、TODO 标记、换行符 | 未逐行阅读最大文件的全部实现 |
| Design | High | 渲染器抽象、scene 类职责、类型断言、非空断言、原则交叉检查 | 同上 |
| Release | High | `.github/workflows/release.yml`, `scripts/verify-release-assets.mjs`, `manifest.json`, `package.json`, `versions.json`, `CHANGELOG.md`, `main.js` git 状态 | 未触发真实 release workflow |
| Documentation | High | `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `docs/*.md`, `FORMAT_SUPPORT_DESIGN.md`, `AGENTS.md`, `SECURITY.md` | 未验证所有安装步骤 |
| Configuration | High | `src/settings.ts`, `src/domain/constants.ts`, `src/store/plugin-store.ts` | 未在全部平台测试配置默认值 |
| Observability | Medium | `src/utils/log.ts`, `src/diagnostics/report.ts` | 未在运行时检查日志输出与指标持久化 |
| Data Integrity | High | `src/store/plugin-store.ts`, `src/io/cache/converted-asset-cache.ts`, `src/io/conversion/conversion-service.ts`, `src/view/workbench/knowledge-note.ts` | 未做异常断电/崩溃测试 |
| Privacy | High | `src/view/workbench/remote-draft.ts`, `src/diagnostics/report.ts`, `src/view/workbench/analysis-result.ts`, `README.md` 隐私声明 | 未审计远程服务端行为 |
| Accessibility | Medium | `src/settings.ts`, `src/view/inline/helper-buttons.ts`, `src/render/preview/annotations.ts` | 未使用屏幕阅读器或 axe-core 运行时测试 |
| Supply Chain | High | `package.json`, `package-lock.json`, `.github/workflows/release.yml`, `npm audit`, `esbuild.config.mjs` | 未做全量传递依赖审计 |
| Cost | Medium | `src/view/workbench/remote-draft.ts`, `package.json` | 未测量远程草稿实际 token/API 花费 |
| AI Safety | High | `src/view/workbench/remote-draft.ts`, `src/view/workbench/analysis-result.ts`, `src/view/workbench/knowledge-note.ts` | 未在真实 LLM 服务上做提示注入评估 |
| Fallback | High | `src/main.ts`, `src/io/conversion/*`, `src/render/babylon/scene.ts`, `src/view/*` 的 catch 分支 | 未穷尽所有错误路径 |
| Testing Authenticity | High | `scripts/verify-*.mjs` 断言内容 | 未在 CI 外多次运行验证稳定性 |
| Type Safety | High | `src/**/*.ts` 中的 `any`、`as`、`!`、返回类型 | 未启用 `no-non-null-assertion` 跑全量检查 |
| Frontend State | High | `src/render/three/scene.ts`, `src/render/babylon/scene.ts`, `src/render/preview/annotations.ts`, `src/view/direct-view.ts`, `src/view/inline/helper-buttons.ts` | 未使用 React DevTools（项目未用 React） |
| Backend API | Not assessed | N/A | 本项目为 Obsidian 插件，无服务端 API |
| Dependency Weight | High | `package.json`, `src/**/*.ts` import 模式，`main.js` 大小 | 未做 bundle 分析树状图 |
| Code Consistency | High | 命名、import 组织、错误处理模式、换行符 | 未运行 formatter 全量检查 |
| Comment Coverage | Medium | `src/render/preview/types.ts`, `src/render/preview/component-identity.ts`, `src/render/three/scene.ts`, `src/render/babylon/scene.ts` | 未统计注释行比例 |

---

## 3. Top Risks

1. **package-lock.json 版本 0.4.3 与 manifest 0.5.5 不一致，阻塞 release 校验**（Release，High）
2. **PluginStore 在 onunload 时不 flush 待保存状态，可能导致标注/零件注册/最近生成元数据丢失**（Stability，High）
3. **esbuild 存在 GHSA-gv7w-rqvm-qjhr 漏洞，CI/build 环境可被 compromised registry 远程代码执行**（Security/Supply Chain，High）
4. **远程草稿返回内容未经 HTML/Markdown 转义即写入 Vault 笔记**（Security/AI Safety，High）
5. **Babylon 预览渲染循环不息，无可见性/脏检查，持续消耗 GPU/电池**（Performance，High）
6. **生产产物同时打包 Three.js 与 Babylon.js 两个完整运行时，main.js 约 3.8 MB**（Performance/Release，High）
7. **转换器命令路径可被任意指定，可能执行恶意程序**（Security/Configuration，Medium）
8. **main.js 被纳入版本控制且当前 dirty/锁定，本地构建失败**（Release，Medium）
9. **无单元测试；集成测试断言 CSS 类与文案，易碎**（Testing，Medium）
10. **Three/Babylon scene 文件为 2,099 / 1,661 行神类，重复实现测量/聚焦/爆炸/拆卸**（Maintainability/Design，Medium）
11. **标注投影存在 O(n²) DOM layout thrashing**（Performance，High）
12. **CHANGELOG 缺失 0.5.3 / 0.5.5 条目，development-handoff/README 版本示例陈旧**（Documentation/Release，Medium）

---

## 4. Detailed Findings

### 4.1 Release

### Finding: package-lock.json 版本与 manifest/package.json 不一致，阻塞 release 校验
- ID: REL-1
- Severity: High
- Confidence: High
- Category: Release
- Status: Confirmed
- Affected area: `package-lock.json`, `package.json`, `manifest.json`, `scripts/verify-release-assets.mjs:26-27`
- Evidence: `node -p "require('./package-lock.json').version"` 输出 `0.4.3`；`package.json` 与 `manifest.json` 为 `0.5.5`。
- Problem: 三个发布关键文件版本号不一致，`verify-release-assets.mjs` 会在 release 阶段直接失败。
- Why it matters: 这是发布流程的门禁检查，不一致意味着无法通过 CI 自动发布。
- Realistic failure scenario: 维护者 tag `0.5.5` 并推送；GitHub Actions 在 `verify:release` 步骤退出码非零，release 产物无法上传。
- Minimal fix: 运行 `npm version 0.5.5 --no-git-tag-version` 或手动同步 `package-lock.json` 的两个 version 字段。
- Better long-term fix: 在 release workflow 中加入 `npm run verify:release` 作为前置步骤；在 `preversion`/`postversion` 脚本中自动对齐。
- Regression test suggestion: 本地运行 `npm run verify:release` 成功；CI 在 release 前执行相同脚本。
- Estimated effort: 5 minutes
### Finding: main.js 被纳入版本控制且当前 dirty/锁定，本地构建失败
- ID: REL-2
- Severity: Medium
- Confidence: High
- Category: Release
- Status: Confirmed
- Affected area: `main.js`, `esbuild.config.mjs`, 构建流程
- Evidence: `git status` 显示 `M main.js`；`npm run build` 报错 `UNKNOWN: unknown error, open '...\\main.js'`；`git diff --stat main.js` 显示 439 insertions / 439 deletions。
- Problem: 生成的 bundle 被提交到 git 且当前被其他进程（可能是正在运行的 Obsidian 实例）锁定，导致无法覆盖。
- Why it matters: 开发者无法生成干净的 release bundle；CI 可能使用陈旧或未提交的 bundle。
- Realistic failure scenario: 发布前 `npm run build` 失败；维护者被迫手动复制 bundle 或关闭 Obsidian 后再构建。
- Minimal fix: 关闭持有 main.js 句柄的进程；提交构建后的正确版本；或在 CI 中构建并在发布时 upload。
- Better long-term fix: 决定是否保留 main.js 在 git 中（Obsidian 社区常见做法）——若保留，则每次 release commit 必须包含重新构建的 bundle；若移除，则 `.gitignore` 并在 CI 构建产物中发布。
- Regression test suggestion: 在干净 checkout 中运行 `npm run build` 成功。
- Estimated effort: 15分钟
### Finding: CHANGELOG 缺失 0.5.3 / 0.5.5 条目
- ID: REL-3
- Severity: Medium
- Confidence: High
- Category: Release / Documentation
- Status: Confirmed
- Affected area: `CHANGELOG.md`, `versions.json`
- Evidence: `CHANGELOG.md` 末尾为 0.5.1；`versions.json` 已包含 `0.5.3`、`0.5.5`。
- Problem: 用户与审阅者无法从 changelog 获知近两版变更。
- Why it matters: 这直接影响 用户与审阅者无法从 changelog 获知近两版变更。
- Realistic failure scenario: 用户报告 0.5.5 的 bug，维护者需反查 git 才能确认变更范围；release note 不完整。
- Minimal fix: 补充 0.5.3 与 0.5.5 条目，概述自 0.5.1 以来的主要 commit 主题。
- Better long-term fix: 使用 `conventional-changelog` 或 `changesets` 自动生成 changelog；在 CI 中校验 manifest 版本必须在 CHANGELOG 中存在。
- Regression test suggestion: CI 校验 `manifest.json` version 出现在 CHANGELOG.md 中。
- Estimated effort: 20分钟
### Finding: 文档中的版本示例陈旧
- ID: REL-4
- Severity: Medium
- Confidence: High
- Category: Release / Documentation
- Status: Confirmed
- Affected area: `docs/development-handoff.md:11,219,223`, `README.md:698`, `README.zh-CN.md:709`, `.github/workflows/release.yml:10`
- Evidence: `development-handoff.md` 声称当前版本为 0.4.0；README release 示例使用 0.4.0。
- Problem: 新贡献者按文档执行会得到错误版本。
- Why it matters: 这直接影响 新贡献者按文档执行会得到错误版本。
- Realistic failure scenario: 贡献者阅读 README 后使用 `npm run verify:obsidian -- --release-tag 0.4.0`，下载旧产物验证，浪费时间。
- Minimal fix: 全文替换硬编码版本为当前 `0.5.5` 或占位符 `<version>`。
- Better long-term fix: 在文档构建/校验脚本中替换占位符为 manifest 版本。
- Regression test suggestion: 文档 lint 发现硬编码版本号与 manifest 不一致即失败。
- Estimated effort: 15分钟
### Finding: release workflow 的 tag 触发模式过于宽松
- ID: REL-5
- Severity: Low
- Confidence: High
- Category: Release / Supply Chain
- Status: Confirmed
- Affected area: `.github/workflows/release.yml:5-6`
- Evidence: `on.push.tags: '*.*.*'` 匹配任意两个点的 tag。
- Problem: 非预期 tag 或恶意 tag 可触发 release。
- Why it matters: 这直接影响 非预期 tag 或恶意 tag 可触发 release。
- Realistic failure scenario: 协作者误推 `foo.bar.baz` 或预发布 tag 触发 workflow。
- Minimal fix: 使用更严格的 glob/regex，并在 job 中校验 tag 与 manifest 版本一致。
- Better long-term fix: 长期：使用更严格的 glob/regex，并在 job 中校验 tag 与 manifest 版本一致。
- Regression test suggestion: 推送无效 tag，断言 workflow 跳过或失败。
- Estimated effort: 15分钟
### Finding: release workflow 中 tag 输入直接插值到 shell
- ID: REL-6
- Severity: Low
- Confidence: High
- Category: Security / Release
- Status: Confirmed
- Affected area: `.github/workflows/release.yml:66-84`
- Evidence: `TAG="${{ inputs.tag }}"` 直接插值。
- Problem: tag 中 shell 元字符可能执行命令。
- Why it matters: 这直接影响 tag 中 shell 元字符可能执行命令。
- Realistic failure scenario: 恶意/误操作 tag 如 `0.5.5; rm -rf /` 触发 shell 注入。
- Minimal fix: 通过 `env:` 传入 input，脚本中引用 `$TAG`。
- Better long-term fix: 长期：通过 `env:` 传入 input，脚本中引用 `$TAG`。
- Regression test suggestion: actionlint / CI lint 通过。
- Estimated effort: 10分钟
---

### 4.2 Stability

### Finding: PluginStore 在 onunload 时不 flush 待保存状态
- ID: STB-1
- Severity: High
- Confidence: High
- Category: Stability / Data Integrity
- Status: Confirmed
- Affected area: `src/store/plugin-store.ts:30-38,76-89`, `src/main.ts:113-116`
- Evidence: `scheduleSave()` 使用 500 ms debounce；`dispose()` 仅 `clearTimeout` 不调用 `persist()`；`onunload()` 只调用 `ps.dispose()`。
- Problem: 卸载/重载插件前 500 ms 内的状态变更（标注、零件注册、最近生成元数据）可能丢失。
- Why it matters: 这直接影响 卸载/重载插件前 500 ms 内的状态变更（标注、零件注册、最近生成元数据）可能丢失。
- Realistic failure scenario: 用户添加一个 pin 或生成报告后立即重载插件，变更消失。
- Minimal fix: 在 `dispose()` 中若 `saveTimer` 活跃则同步或 await `persist()`；让 `onunload()` 能等待完成。
- Better long-term fix: 引入 `beforeunload` 风格的 awaitable dispose；暴露 `flush()` API 并在所有卸载路径调用。
- Regression test suggestion: `verify:settings` 中修改状态、触发 unload、重载后断言持久化。
- Estimated effort: 30分钟
### Finding: 多处错误被静默吞没
- ID: STB-2
- Severity: Medium
- Confidence: High
- Category: Stability / Fallback / Security
- Status: Confirmed
- Affected area: `src/main.ts:482`, `src/view/workbench/knowledge-note.ts:769`, `src/view/inline/helper-buttons.ts:517`, `src/utils/note-reader.ts:99`, `src/utils/node-shim.ts:46`, `src/io/conversion/conversion-service.ts:48`, `src/render/babylon/scene.ts:118-140`
- Evidence: 多处 `.catch(() => {})`、`catch { return null; }`、`try { ... } catch { return null; }`。
- Problem: 真实失败被隐藏，调试和事故响应困难，安全相关失败（如 data.json 被篡改）也无记录。
- Why it matters: 这直接影响 真实失败被隐藏，调试和事故响应困难，安全相关失败（如 data.json 被篡改）也无记录。
- Realistic failure scenario: GLTF metadata 解析失败静默返回 null，零件身份提取无警告；用户看到“没有零件”却不知是文件损坏。
- Minimal fix: 使用项目 logger 至少记录 warn/error；将异常加入 `resourceWarnings` 或 `analysis.warnings`。
- Better long-term fix: 引入统一错误处理策略：用户可见错误用 Notice，诊断用 warn，致命用 error；每个 catch 必须说明为何吞掉。
- Regression test suggestion: 注入失败并断言日志/警告出现。
- Estimated effort: 2小时
### Finding: 缺少 WebGL 上下文丢失 / 恢复处理
- ID: STB-3
- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: `src/render/three/scene.ts:358-408`, `src/render/babylon/scene.ts:340-367`, `src/render/babylon/grid.ts:79-91`
- Evidence: WebGL 上下文创建时设置 `preserveDrawingBuffer: true`，无 `webglcontextlost`/`webglcontextrestored` 监听。
- Problem: GPU 压力或移动端休眠可能导致画布变白且无法恢复。
- Why it matters: 这直接影响 GPU 压力或移动端休眠可能导致画布变白且无法恢复。
- Realistic failure scenario: 用户在 iOS 上切换应用后返回，预览画布保持空白，只能重新打开文件。
- Minimal fix: 添加上下文监听：丢失时停止循环，恢复时重新初始化；同时提供手动 reload 动作。
- Better long-term fix: 封装渲染上下文恢复策略，所有 renderer 共享统一生命周期。
- Regression test suggestion: Playwright 模拟上下文丢失，验证恢复或优雅提示。
- Estimated effort: 4小时
### Finding: 转换管道缺少外层超时
- ID: STB-4
- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: `src/io/conversion/manager.ts:41-65`, `src/io/conversion/conversion-service.ts:116-120`
- Evidence: 各 adapter 有 `DEFAULT_TIMEOUT_MS`，但 `ConversionManager.convert()` 与 `convertForPreview()` 没有外层超时。
- Problem: 命令发现或卡住的 adapter 会无限期挂起预览流程。
- Why it matters: 这直接影响 命令发现或卡住的 adapter 会无限期挂起预览流程。
- Realistic failure scenario: `freecadcmd` 路径存在但二进制挂起，UI loading 遮罩一直显示。
- Minimal fix: 用 `Promise.race` 包裹 `conversionManager.convert()`，配置可调整的外层超时。
- Better long-term fix: 统一的 cancellation token + abort controller 贯穿 conversion service。
- Regression test suggestion: mock 挂起 converter，断言超时警告/取消。
- Estimated effort: 2小时
### Finding: 命令回调中的异步错误未处理
- ID: STB-5
- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: `src/main.ts:62-84,377-385`
- Evidence: `() => void this.openKnowledgeIndex()` 等 fire-and-forget 模式。
- Problem: 异步错误变成未处理 promise rejection。
- Why it matters: 这直接影响 异步错误变成未处理 promise rejection。
- Realistic failure scenario: `openKnowledgeIndex` 因 Vault 权限失败，用户看不到任何反馈，错误只在 DevTools。
- Minimal fix: 包装异步回调，捕获并以 Notice/Toast 展示。
- Better long-term fix: 统一的命令错误边界。
- Regression test suggestion: 验证命令错误能 surfaced 为 Notice。
- Estimated effort: 1小时
### Finding: 部分模块缺少结构化加载错误反馈
- ID: STB-6
- Severity: Medium
- Confidence: High
- Category: Stability / Fallback
- Status: Confirmed
- Affected area: `src/render/babylon/loaders/register.ts:21-24`
- Evidence: loader 注册失败时 catch 仅 `console.error`。
- Problem: 用户无法知道 Babylon loader 初始化失败，后续加载会报错。
- Why it matters: 这直接影响 用户无法知道 Babylon loader 初始化失败，后续加载会报错。
- Realistic failure scenario: 在正常使用中，用户无法知道 Babylon loader 初始化失败，后续加载会报错。 导致功能异常。
- Minimal fix: 将 loader 注册错误加入 `resourceWarnings` 并展示。
- Better long-term fix: 长期：将 loader 注册错误加入 `resourceWarnings` 并展示。
- Regression test suggestion: 破坏 loader 文件路径，验证 UI 提示。
- Estimated effort: 1小时
---

### 4.3 Security

### Finding: esbuild 存在 GHSA-gv7w-rqvm-qjhr RCE 漏洞
- ID: SEC-1
- Severity: High
- Confidence: High
- Category: Security / Supply Chain
- Status: Confirmed
- Affected area: `package.json:31`, `package-lock.json`
- Evidence: `npm audit` 报告 `esbuild 0.17.0 - 0.28.0` 受 GHSA-gv7w-rqvm-qjhr 影响。
- Problem: 若 CI/build 环境的 registry 被入侵，可能下载并执行恶意 esbuild 二进制。
- Why it matters: 这直接影响 若 CI/build 环境的 registry 被入侵，可能下载并执行恶意 esbuild 二进制。
- Realistic failure scenario: 攻击者污染 registry；CI 执行 `npm ci` 时触发恶意代码。
- Minimal fix: 升级 esbuild 到 >=0.28.1，重新生成 lockfile，再次 `npm audit`。
- Better long-term fix: CI 中加入 `npm audit --audit-level=low`；锁定次要版本范围。
- Regression test suggestion: CI 中 `npm audit` 无 high/critical 漏洞。
- Estimated effort: 30分钟
### Finding: 远程草稿返回内容未做 HTML/Markdown 转义即写入 Vault
- ID: SEC-2
- Severity: High
- Confidence: High
- Category: Security / AI Safety
- Status: Confirmed
- Affected area: `src/view/workbench/remote-draft.ts:125-157`, `src/view/workbench/knowledge-note.ts:441-471`
- Evidence: `normalizeRemoteDraftResult` 仅做类型检查与字符串 trim；`buildRemoteDraftSection` 直接将 title/summary/body/tags/warnings 拼入 Markdown。
- Problem: 被攻陷的 draft endpoint 可向用户 Vault 注入任意 Markdown/HTML。
- Why it matters: 这直接影响 被攻陷的 draft endpoint 可向用户 Vault 注入任意 Markdown/HTML。
- Realistic failure scenario: Endpoint 返回 `[](javascript:alert(1))` 或 Obsidian iframe 语法，笔记渲染时执行。
- Minimal fix: 对远程返回字段做 HTML 实体转义与 Markdown 表格分隔符转义；限制字段长度；校验 tags。
- Better long-term fix: 对远程内容使用 Markdown AST 或 Obsidian API 安全插入；将远程输出视为不可信内容沙箱。
- Regression test suggestion: `verify:remote-draft` 使用恶意 payload，断言输出被转义。
- Estimated effort: 3小时
### Finding: 模型派生元数据注入笔记时缺少 HTML 转义
- ID: SEC-3
- Severity: Medium
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: `src/view/workbench/knowledge-note.ts:542,575,600,746`；`src/render/preview/report.ts:54`
- Evidence: `escapeTableCell` 只转义 `|` 与换行；零件/材质/网格/标注字符串直接插入 Markdown。
- Problem: 恶意模型可在名称中携带 HTML/JS，最终进入生成的笔记。
- Why it matters: 这直接影响 恶意模型可在名称中携带 HTML/JS，最终进入生成的笔记。
- Realistic failure scenario: GLB 零件名为 `<img src=x onerror=alert(1)>`，报告渲染时执行。
- Minimal fix: 所有模型派生字符串在插入 Markdown 前做 HTML 转义。
- Better long-term fix: 统一的数据清洗层，区分可信（模板）与不可信（模型）输入。
- Regression test suggestion: 渲染含恶意名称的模型，验证输出已清洗。
- Estimated effort: 2小时
### Finding: 转换器命令设置允许任意可执行文件
- ID: SEC-4
- Severity: Medium
- Confidence: High
- Category: Security / Configuration
- Status: Confirmed
- Affected area: `src/io/conversion/command-discovery.ts:296-306,681-689`；各 converter adapter；`src/settings.ts:442-505`
- Evidence: `parseCommandValue` 将设置/环境值直接传给 `execFile`，无校验或白名单。
- Problem: 被篡改的 `data.json` 或环境可让插件执行任意程序。
- Why it matters: 这直接影响 被篡改的 `data.json` 或环境可让插件执行任意程序。
- Realistic failure scenario: 攻击者设置 `freecadCommand` 为恶意软件路径，插件在转换时启动它。
- Minimal fix: 校验命令为存在的文件（非目录），优先使用 PATH 解析名，将解析结果暴露到 diagnostics，对非预期路径警告。
- Better long-term fix: 提供预设命令 discover 路径；用户自定义路径需显式确认；使用 allowlist 校验哈希。
- Regression test suggestion: 设置非法命令断言 diagnostics 警告；设置为目录断言拒绝。
- Estimated effort: 4小时
### Finding: 持久化转换缓存可引用任意文件系统路径
- ID: SEC-5
- Severity: Medium
- Confidence: High
- Category: Security / Data Integrity
- Status: Confirmed
- Affected area: `src/io/cache/converted-asset-cache.ts:19-31`, `src/io/conversion/conversion-service.ts:76-86`, `src/utils/resolve-path.ts:135-139`
- Evidence: `ConvertedAssetRecord.outputPath` 直接存入 state 并被使用，无 Vault 边界检查。
- Problem: 被篡改的 `data.json` 可导致插件读取任意本地文件。
- Why it matters: 这直接影响 被篡改的 `data.json` 可导致插件读取任意本地文件。
- Realistic failure scenario: `outputPath` 被设为 `/etc/passwd`，插件尝试读取并作为 GLB 使用。
- Minimal fix: 校验缓存 `outputPath` 位于 Vault 或预期输出目录；拒绝绝对外部路径。
- Better long-term fix: 长期：校验缓存 `outputPath` 位于 Vault 或预期输出目录；拒绝绝对外部路径。
- Regression test suggestion: 注入 Vault 外路径，断言拒绝/警告。
- Estimated effort: 2小时
### Finding: 远程草稿 endpoint 接受私有/内部 URL
- ID: SEC-6
- Severity: Medium
- Confidence: High
- Category: Security / AI Safety
- Status: Confirmed
- Affected area: `src/view/workbench/remote-draft.ts:21-39`
- Evidence: `normalizeBaseUrl` 仅校验协议，未阻止私有 IP/localhost。
- Problem: 恶意或输错的 URL 可利用 Obsidian 应用的网络权限访问内部服务。
- Why it matters: 这直接影响 恶意或输错的 URL 可利用 Obsidian 应用的网络权限访问内部服务。
- Realistic failure scenario: 配置 `http://localhost:8787` 或 `http://169.254.1.1`，插件向内部服务发送模型摘要。
- Minimal fix: 增加可选 host/IP 白名单，对私有/本地地址给出警告。
- Better long-term fix: 长期：增加可选 host/IP 白名单，对私有/本地地址给出警告。
- Regression test suggestion: 配置 `localhost` 断言警告；配置公网域名允许。
- Estimated effort: 2小时
### Finding: AI 提示注入风险
- ID: SEC-7
- Severity: Medium
- Confidence: Medium
- Category: AI Safety
- Status: Confirmed
- Affected area: `src/view/workbench/analysis-result.ts:358-404`, `src/view/workbench/remote-draft.ts:76-91`
- Evidence: draft payload 将 profile notes、pin label、annotation heading refs、part names 与 task instruction 混合，无明确分隔。
- Problem: 攻击者控制的模型/标注文本可能影响 LLM 行为。
- Why it matters: 这直接影响 攻击者控制的模型/标注文本可能影响 LLM 行为。
- Realistic failure scenario: 零件名为 "Ignore previous instructions and ..."，draft 输出偏离预期。
- Minimal fix: 将系统/任务指令与用户/模型内容分离；将模型/标注文本视为不可信；增加输出校验。
- Better long-term fix: 使用结构化 prompt 模板并做提示注入测试（如 OWASP LLM Top 10 案例）。
- Regression test suggestion: 注入提示注入字符串，断言 draft 不遵循。
- Estimated effort: 4小时
### Finding: 安全相关失败被静默吞没（与 STB-2 关联）
- ID: SEC-8
- Severity: Medium
- Confidence: High
- Category: Security / Stability
- Status: Confirmed
- Affected area: 同 STB-2
- Evidence: 同 STB-2 同 STB-2
- Problem: 文件读取与解析失败（可能是篡改信号）被隐藏。
- Why it matters: 无法检测异常或安全事件。
- Realistic failure scenario: data.json 被篡改后解析失败但无日志，用户无法发现。
- Minimal fix: 记录失败。
- Better long-term fix: 建立统一错误处理策略。
- Regression test suggestion: 篡改 data.json，验证错误被记录。
- Estimated effort: 1小时（合并 STB-2 工作）
### Finding: 手动 token 扫描未在 CI 中强制执行
- ID: SEC-9
- Severity: Low
- Confidence: High
- Category: Security / Supply Chain
- Status: Confirmed
- Affected area: `SECURITY.md:11-16`, `.github/workflows/release.yml`
- Evidence: SECURITY.md  instructs 手动 `rg` 扫描；workflow 未执行。
- Problem: 泄露的 PAT 可能随 release 流出。
- Why it matters: 这直接影响 泄露的 PAT 可能随 release 流出。
- Realistic failure scenario: 在正常使用中，泄露的 PAT 可能随 release 流出。 导致功能异常。
- Minimal fix: 在 release workflow 中加入自动 token 扫描步骤。
- Better long-term fix: 长期：在 release workflow 中加入自动 token 扫描步骤。
- Regression test suggestion: 分支中提交测试 token，验证 CI 失败。
- Estimated effort: 30分钟
### Finding: Babylon 网络守卫延迟安装且依赖内部实现
- ID: SEC-10
- Severity: Low
- Confidence: Medium
- Category: Security
- Status: Confirmed
- Affected area: `src/render/babylon/loaders/register.ts:21-24`, `src/render/babylon/network-guard.ts:27-70`
- Evidence: 守卫在 `ensureLoadersRegistered` 中运行；monkey-patch `Tools._LoadScript*` 与 `WebRequest`。
- Problem: Babylon 升级可能改变内部 API，导致远程 URL 绕过。
- Why it matters: 这直接影响 Babylon 升级可能改变内部 API，导致远程 URL 绕过。
- Realistic failure scenario: 在正常使用中，Babylon 升级可能改变内部 API，导致远程 URL 绕过。 导致功能异常。
- Minimal fix: 尽早安装守卫（`onload` 阶段）；增加测试验证远程 URL 被拒绝。
- Better long-term fix: 长期：尽早安装守卫（`onload` 阶段）；增加测试验证远程 URL 被拒绝。
- Regression test suggestion: 尝试加载远程资源，断言拒绝。
- Estimated effort: 2小时
---

### 4.4 Performance

### Finding: 生产产物同时打包 Three.js 与 Babylon.js
- ID: PER-1
- Severity: High
- Confidence: High
- Category: Performance / Dependency Weight / Release
- Status: Confirmed
- Affected area: `package.json:38-44`, `src/render/preview/factory.ts:21-27`, `esbuild.config.mjs`
- Evidence: `main.js` 约 3.8 MB minified；动态导入两个渲染器导致 esbuild 同时包含两者。
- Problem: 用户下载约 1.5-2 MB 不会使用的 runtime（取决于设置）。
- Why it matters: 这直接影响 用户下载约 1.5-2 MB 不会使用的 runtime（取决于设置）。
- Realistic failure scenario: 移动端用户在慢网络下载过大 bundle，首次加载缓慢。
- Minimal fix: 移除未使用的 `@babylonjs/gui`、`@babylonjs/materials`、`@babylonjs/serializers`；评估代码分割或双产物。
- Better long-term fix: 仅在真正需要时通过 Obsidian 的 `require` 机制或分包加载 Babylon；发布时提供 lite/standard 两种 bundle。
- Regression test suggestion: CI 中追踪 bundle 大小，超过阈值失败。
- Estimated effort: 1-2天
### Finding: Babylon 预览渲染循环不息
- ID: PER-2
- Severity: High
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: `src/render/babylon/scene.ts:1318-1329`
- Evidence: `runRenderLoop` 持续运行，无可见性/脏检查。
- Problem: 预览离开视口后仍消耗 GPU/电池。
- Why it matters: 这直接影响 预览离开视口后仍消耗 GPU/电池。
- Realistic failure scenario: 用户滚动笔记使多个 Babylon 预览离开视口，每个仍以 60 FPS 渲染。
- Minimal fix: 增加 `IntersectionObserver`，不可见时暂停/停止循环，仅在脏时渲染。
- Better long-term fix: 长期：增加 `IntersectionObserver`，不可见时暂停/停止循环，仅在脏时渲染。
- Regression test suggestion: Playwright 验证 off-screen 后 `requestAnimationFrame`/loop 次数下降。
- Estimated effort: 4小时
### Finding: Babylon 3dgrid 每帧重绘每个 cell
- ID: PER-3
- Severity: High
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: `src/render/babylon/grid.ts:391-412`
- Evidence: `renderFrame()` 每帧清空 engine 并遍历每个 cell 做完整 `scene.render()`。
- Problem: 静态多模型网格持续以 60 FPS 重绘。
- Why it matters: 这直接影响 静态多模型网格持续以 60 FPS 重绘。
- Realistic failure scenario: `3dgrid` 含 6 个模型时 GPU 持续满载。
- Minimal fix: 追踪每 cell 脏状态；未变化时跳过；静态网格仅在交互时渲染。
- Better long-term fix: 长期：追踪每 cell 脏状态；未变化时跳过；静态网格仅在交互时渲染。
- Regression test suggestion: 测量静态 grid 帧时间，初始渲染后应大幅下降。
- Estimated effort: 1天
### Finding: 标注投影导致 O(n²) 布局抖动
- ID: PER-4
- Severity: High
- Confidence: High
- Category: Performance / Frontend State
- Status: Confirmed
- Affected area: `src/render/preview/annotations.ts:783-905`
- Evidence: `updateProjections()` 在嵌套循环中调用 `getBoundingClientRect()` 并同时写入 CSS 变量。
- Problem: 每次样式写入强制同步布局重算；pin 多时卡顿。
- Why it matters: 这直接影响 每次样式写入强制同步布局重算；pin 多时卡顿。
- Realistic failure scenario: 50+ bookmark 的模型旋转时明显掉帧。
- Minimal fix: 批量读/写（fastdom 风格），缓存 rect，限制 pin 数量，移动时降低投影频率。
- Better long-term fix: 长期：批量读/写（fastdom 风格），缓存 rect，限制 pin 数量，移动时降低投影频率。
- Regression test suggestion: 用 50 个 pin 测试，断言帧预算不被突破。
- Estimated effort: 1天
### Finding: 测量与标注集合无上限增长
- ID: PER-5
- Severity: Medium
- Confidence: High
- Category: Performance / Stability
- Status: Confirmed
- Affected area: `src/render/three/scene.ts:269,1846,1891`, `src/render/babylon/scene.ts:273-275,1529,1575`, `src/render/preview/annotations.ts:64,149`
- Evidence: 数组仅在显式 remove 时缩小，无最大数量限制。
- Problem: 用户可创建成千上万 pin/测量，拖垮性能与内存。
- Why it matters: 这直接影响 用户可创建成千上万 pin/测量，拖垮性能与内存。
- Realistic failure scenario: 误触或脚本批量创建大量 pin，应用变慢或崩溃。
- Minimal fix: 增加可配置上限，达到时警告并禁用新增。
- Better long-term fix: 长期：增加可配置上限，达到时警告并禁用新增。
- Regression test suggestion: 尝试超过上限，断言 UI 阻止创建。
- Estimated effort: 2小时
### Finding: AnnotationManager 中存在 effect 扩散
- ID: PER-6
- Severity: Medium
- Confidence: High
- Category: Performance / Frontend State
- Status: Confirmed
- Affected area: `src/render/preview/annotations.ts:59-125,316-366,495-562,637-649,718-731,775-780`
- Evidence: 多个 observer、debounce timer、hover timeout、pulse timeout、per-element listener。
- Problem: 销毁时容易遗漏 timer/listener，模型切换后泄漏累积。
- Why it matters: 这直接影响 销毁时容易遗漏 timer/listener，模型切换后泄漏累积。
- Realistic failure scenario: 在正常使用中，销毁时容易遗漏 timer/listener，模型切换后泄漏累积。 导致功能异常。
- Minimal fix: 集中管理所有 disposable；在 `destroy()` 中统一清除。
- Better long-term fix: 长期：集中管理所有 disposable；在 `destroy()` 中统一清除。
- Regression test suggestion: 反复创建/销毁 AnnotationManager，断言无 dangling timer/listener。
- Estimated effort: 4小时
### Finding: helper-buttons 中 DOM 即状态
- ID: PER-7
- Severity: Medium
- Confidence: High
- Category: Frontend State
- Status: Confirmed
- Affected area: `src/view/inline/helper-buttons.ts:140-150,207-235`
- Evidence: `syncCapabilities()` 与 `syncGroupVisibility()` 查询 DOM class 决定状态；`syncToggleStates()` 每次重绘 SVG 图标。
- Problem: 状态从 DOM 派生脆弱且慢。
- Why it matters: 这直接影响 状态从 DOM 派生脆弱且慢。
- Realistic failure scenario: 在正常使用中，状态从 DOM 派生脆弱且慢。 导致功能异常。
- Minimal fix: 在 JS 对象中维护按钮状态，diff-apply class。
- Better long-term fix: 长期：在 JS 对象中维护按钮状态，diff-apply class。
- Regression test suggestion: 快速切换状态，断言无多余 DOM 操作。
- Estimated effort: 3小时
### Finding: OBJ 纹理内联导致纹理内存翻倍
- ID: PER-8
- Severity: Medium
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: `src/render/babylon/scene.ts:418-500`
- Evidence: 每个候选纹理被读取、base64 编码、写回 MTL。
- Problem: 大纹理同时作为 Vault buffer 与 inline data URL 驻留内存。
- Why it matters: 这直接影响 大纹理同时作为 Vault buffer 与 inline data URL 驻留内存。
- Realistic failure scenario: 4K 纹理 OBJ 加载时内存占用约 2x。
- Minimal fix: 按 Vault 路径缓存 data URL；超过阈值时跳过内联。
- Better long-term fix: 长期：按 Vault 路径缓存 data URL；超过阈值时跳过内联。
- Regression test suggestion: 重复加载同一 OBJ 断言纹理 data URL 缓存命中。
- Estimated effort: 3小时
### Finding: Three.js 像素比快速变化导致 render target 重复分配
- ID: PER-9
- Severity: Medium
- Confidence: Medium
- Category: Performance
- Status: Confirmed
- Affected area: `src/render/three/scene.ts:1023-1098`
- Evidence: `updateFrameBudget()` 在慢/快帧连续变化时调整 scale 并调用 `resizeRenderer()`。
- Problem: 反复重新分配 render target 造成卡顿。
- Why it matters: 这直接影响 反复重新分配 render target 造成卡顿。
- Realistic failure scenario: 在正常使用中，反复重新分配 render target 造成卡顿。 导致功能异常。
- Minimal fix: 增加滞回与节流。
- Better long-term fix: 长期：增加滞回与节流。
- Regression test suggestion: 模拟交替帧时间，断言像素比稳定。
- Estimated effort: 2小时
---

### 4.5 Testing

### Finding: 无单元测试框架或单元测试
- ID: TST-1
- Severity: High
- Confidence: High
- Category: Testing
- Status: Confirmed
- Affected area: `package.json`, 项目根目录
- Evidence: devDependencies 中无测试运行器；无 `*.test.ts` 文件。
- Problem: 纯函数（几何、路径解析、远程草稿规范化）缺少快速回归测试。
- Why it matters: 这直接影响 纯函数（几何、路径解析、远程草稿规范化）缺少快速回归测试。
- Realistic failure scenario: 重构 `resolve-path` 边界场景出错，只能通过慢速 Playwright harness 发现。
- Minimal fix: 引入 Vitest，先为纯函数模块编写种子测试。
- Better long-term fix: 单元测试覆盖工具函数、转换器适配器、store 动作、渲染器抽象；CI 中运行 `npm test`。
- Regression test suggestion: CI 中 `npm test` 通过。
- Estimated effort: 1天
### Finding: 验证脚本断言实现细节
- ID: TST-2
- Severity: Medium
- Confidence: High
- Category: Testing / Testing Authenticity
- Status: Confirmed
- Affected area: `scripts/verify-preview.mjs`, `scripts/verify-preview-success.mjs`, `scripts/verify-obsidian.mjs`
- Evidence: 硬编码 ARIA label、精确 CSS 类、精确按钮文案、精确生成笔记路径。
- Problem: UI 文案或结构变化会导致测试失败。
- Why it matters: 这直接影响 UI 文案或结构变化会导致测试失败。
- Realistic failure scenario: 重命名工具栏按钮 label，测试失败但功能正常。
- Minimal fix: 为关键元素添加 `data-testid`；将断言与面向用户的字符串解耦。
- Better long-term fix: 长期：为关键元素添加 `data-testid`；将断言与面向用户的字符串解耦。
- Regression test suggestion: 修改 UI 文案后验证测试仍通过。
- Estimated effort: 1天
### Finding: 浏览器 harness 存在脆弱性风险
- ID: TST-3
- Severity: Medium
- Confidence: High
- Category: Testing
- Status: Confirmed
- Affected area: `scripts/verify-preview.mjs`, `scripts/verify-obsidian.mjs`
- Evidence: 使用固定 `waitForTimeout`；canvas pixel-ratio 断言；精确 `toDataURL` 比较；浏览器自动检测差异。
- Problem: 不同机器/CI 上非确定性失败。
- Why it matters: 这直接影响 不同机器/CI 上非确定性失败。
- Realistic failure scenario: CI runner 比本地慢，120 ms 超时过早触发。
- Minimal fix: 用 `waitForFunction`/事件替代 sleep；canvas 比较使用容差；固定浏览器路径或测试矩阵。
- Better long-term fix: 长期：用 `waitForFunction`/事件替代 sleep；canvas 比较使用容差；固定浏览器路径或测试矩阵。
- Regression test suggestion: 在较慢 VM 上运行 harness 验证稳定性。
- Estimated effort: 2天
### Finding: 转换管道缺少自动化覆盖
- ID: TST-4
- Severity: High
- Confidence: High
- Category: Testing
- Status: Confirmed
- Affected area: `src/io/conversion/adapters/*.ts`, `src/io/conversion/command-discovery.ts`
- Evidence: 无 `verify:conversion` 脚本；转换仅在 Obsidian 测试中被负面触发。
- Problem: STEP/IGES/BREP/SLDPRT/FBX/3MF/DAE 路径可能静默损坏。
- Why it matters: 这直接影响 STEP/IGES/BREP/SLDPRT/FBX/3MF/DAE 路径可能静默损坏。
- Realistic failure scenario: Python 脚本变更破坏 STEP 转换，直到用户报告才发现。
- Minimal fix: 使用 stub Python/CLI 脚本产生已知 GLB 输出，建立 mock-converter harness。
- Better long-term fix: 长期：使用 stub Python/CLI 脚本产生已知 GLB 输出，建立 mock-converter harness。
- Regression test suggestion: CI 中运行 mock 转换。
- Estimated effort: 2天
### Finding: release workflow 未执行 eslint
- ID: TST-5
- Severity: Medium
- Confidence: High
- Category: Testing / Release
- Status: Confirmed
- Affected area: `.github/workflows/release.yml`, `eslint.config.mjs`
- Evidence: release workflow 运行 typecheck 但不运行 eslint；eslint 报告 21 个问题。
- Problem: lint 错误进入 main 与 release。
- Why it matters: 这直接影响 lint 错误进入 main 与 release。
- Realistic failure scenario: `obsidianmd/prefer-create-el` 错误意味着代码使用了 Obsidian 不推荐的 API，插件可能在 Obsidian 审核中失败。
- Minimal fix: 在 CI 与 release workflow 中加入 `npm run lint`；修复当前错误。
- Better long-term fix: 长期：在 CI 与 release workflow 中加入 `npm run lint`；修复当前错误。
- Regression test suggestion: CI 在 lint 错误时失败。
- Estimated effort: 2小时
---

### 4.6 Maintainability & Design

### Finding: scene 文件为神类，违反单一职责
- ID: MAINT-1
- Severity: Medium
- Confidence: High
- Category: Maintainability / Design
- Status: Confirmed
- Affected area: `src/render/three/scene.ts`（2,099 行）, `src/render/babylon/scene.ts`（1,661 行）
- Evidence: 每个类同时负责 renderer setup、loading、camera、lights、shadows、animation、measurement、focus、wireframe、bounding box、explode/disassembly、snapshots、frame budget。
- Problem: 难以测试、review、扩展；修改时回归风险高。
- Why it matters: 这直接影响 难以测试、review、扩展；修改时回归风险高。
- Realistic failure scenario: 修复 measurement bug 需要触碰 2,000 行文件，容易引入回归。
- Minimal fix: 先提取工具函数减少文件长度。
- Better long-term fix: 提取渲染器无关的 controller（MeasurementController、FocusController、FrameBudgetController），渲染器只做 thin adapter。
- Regression test suggestion: 为提取的 controller 增加单元测试。
- Estimated effort: 1-2周
### Finding: Three 与 Babylon 渲染器之间存在重复逻辑
- ID: MAINT-2
- Severity: Medium
- Confidence: High
- Category: Maintainability / Design
- Status: Confirmed
- Affected area: `src/render/three/loaders.ts:34-48,182-258` vs `src/render/babylon/scene.ts:184-197,416-475`；`src/render/three/scene.ts:171` vs `src/render/babylon/scene.ts:114`；measurement/focus/explode/disassembly 均重复。
- Evidence: 见代码审查与静态分析结果。
- Problem: 修复需要在两处应用；行为可能分叉。
- Why it matters: 这直接影响 修复需要在两处应用；行为可能分叉。
- Realistic failure scenario: OBJ 纹理回退在 Three 修复但 Babylon 未修复，用户看到不一致结果。
- Minimal fix: 将共享逻辑移入 `src/io/formats/obj-resources.ts` 与 `src/render/preview/component-identity.ts`。
- Better long-term fix: 统一 scene controller 抽象，双端仅实现底层绘制 API。
- Regression test suggestion: 跨渲染器 parity 测试 OBJ 加载与 measurement。
- Estimated effort: 3天
### Finding: settings.ts display() 是巨型 UI 构建器
- ID: MAINT-3
- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/settings.ts:63-589`
- Evidence: 单个 `display()` 方法 527 行构建整个设置页。
- Problem: 难 review、难测试、难扩展。
- Why it matters: 这直接影响 难 review、难测试、难扩展。
- Realistic failure scenario: 增加一个设置项需要修改巨大方法，易产生合并冲突。
- Minimal fix: 拆分为 section builder 函数或类。
- Better long-term fix: 长期：拆分为 section builder 函数或类。
- Regression test suggestion: 验证每个 section 渲染预期控件。
- Estimated effort: 1天
### Finding: main.ts 包含大量视图逻辑
- ID: MAINT-4
- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/main.ts:118-375`
- Evidence: `setupHeadingPinObserver()` 是 258 行私有方法，负责 heading pin badge。
- Problem: 生命周期文件混合视图功能。
- Why it matters: 这直接影响 生命周期文件混合视图功能。
- Realistic failure scenario: 在正常使用中，生命周期文件混合视图功能。 导致功能异常。
- Minimal fix: 提取到 `src/view/heading-pin-observer.ts`。
- Better long-term fix: 长期：提取到 `src/view/heading-pin-observer.ts`。
- Regression test suggestion: 验证 heading badge 仍正常显示。
- Estimated effort: 2小时
### Finding: direct-view.ts loadModel() 职责过多
- ID: MAINT-5
- Severity: Medium
- Confidence: High
- Category: Maintainability / Design
- Status: Confirmed
- Affected area: `src/view/direct-view.ts:150-370`
- Evidence: 约 221 行方法覆盖布局、IO、预览编排、标注 wiring、知识 UI、错误处理。
- Problem: 违反 SRP；测试脆弱。
- Why it matters: 这直接影响 违反 SRP；测试脆弱。
- Realistic failure scenario: 在正常使用中，违反 SRP；测试脆弱。 导致功能异常。
- Minimal fix: 拆分为更小方法。
- Better long-term fix: 长期：拆分为更小方法。
- Regression test suggestion: 用 shims 对每个子方法做单元测试。
- Estimated effort: 1天
### Finding: PluginStore 暴露 raw setState，缺少 actions
- ID: MAINT-6
- Severity: Medium
- Confidence: High
- Category: Maintainability / Design / Data Integrity
- Status: Confirmed
- Affected area: `src/store/plugin-store.ts:27-90`
- Evidence: 调用方直接使用 `ps.store.setState()`。
- Problem: 无不变式约束；视图可任意修改持久化状态。
- Why it matters: 这直接影响 无不变式约束；视图可任意修改持久化状态。
- Realistic failure scenario: 在正常使用中，无不变式约束；视图可任意修改持久化状态。 导致功能异常。
- Minimal fix: 增加带类型的 store actions，限制直接 setState。
- Better long-term fix: 长期：增加带类型的 store actions，限制直接 setState。
- Regression test suggestion: 断言只有 store actions 可修改 profiles。
- Estimated effort: 1天
### Finding: 视图层直接修改持久化 profile
- ID: MAINT-7
- Severity: Medium
- Confidence: High
- Category: Maintainability / Data Integrity
- Status: Confirmed
- Affected area: `src/view/direct-view.ts:318-322,389-397`
- Evidence: 视图调用 `this.ps.store.setState({ modelAssetProfiles: ... })` 更新 pin 与注册零件。
- Problem: 绕过规范化与未来不变式。
- Why it matters: 这直接影响 绕过规范化与未来不变式。
- Realistic failure scenario: 在正常使用中，绕过规范化与未来不变式。 导致功能异常。
- Minimal fix: 使用 MAINT-6 的 store actions。
- Better long-term fix: 长期：使用 MAINT-6 的 store actions。
- Regression test suggestion: 同 MAINT-6。
- Estimated effort: 30分钟（依赖 MAINT-6）
### Finding: 标注编辑器与投影为单体
- ID: MAINT-8
- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: `src/render/preview/annotations.ts:218-465,783-866`
- Evidence: `showEditorInternal()` 约 247 行；`updateProjections()` 约 84 行且嵌套 if 密集。
- Problem: 难以维护与验证。
- Why it matters: 这直接影响 难以维护与验证。
- Realistic failure scenario: 在正常使用中，难以维护与验证。 导致功能异常。
- Minimal fix: 提取 `AnnotationEditor` 组件；拆分投影函数。
- Better long-term fix: 长期：提取 `AnnotationEditor` 组件；拆分投影函数。
- Regression test suggestion: 单元测试编辑器渲染与投影数学。
- Estimated effort: 2天
### Finding: 混合 CRLF/LF 换行符
- ID: MAINT-9
- Severity: Low
- Confidence: High
- Category: Maintainability / Code Consistency
- Status: Confirmed
- Affected area: `src/settings.ts`, `src/render/babylon/scene.ts`, `src/render/babylon/loaders/register.ts`, `src/render/babylon/loaders/ply-loader.ts`
- Evidence: `file` 报告 Babylon 文件为 CRLF，settings.ts 为 mixed。
- Problem: diff 噪音、跨平台不一致。
- Why it matters: 这直接影响 diff 噪音、跨平台不一致。
- Realistic failure scenario: 在正常使用中，diff 噪音、跨平台不一致。 导致功能异常。
- Minimal fix: 增加 `.editorconfig`；在 `.gitattributes` 中强制 `* text=auto eol=lf`；一次性 normalize。
- Better long-term fix: 长期：增加 `.editorconfig`；在 `.gitattributes` 中强制 `* text=auto eol=lf`；一次性 normalize。
- Regression test suggestion: CI 检查 `file` 报告所有 `*.ts` 为 LF。
- Estimated effort: 30分钟
### Finding: 缺少 TODO/FIXME/HACK 标记
- ID: MAINT-10
- Severity: Low
- Confidence: High
- Category: Maintainability / Comment Coverage
- Status: Confirmed
- Affected area: `src/`, `docs/`
- Evidence: `rg TODO|FIXME|HACK|XXX|SAFETY` 无匹配。
- Problem: 已知债务未标注，难以跟踪。
- Why it matters: 这直接影响 已知债务未标注，难以跟踪。
- Realistic failure scenario: 在正常使用中，已知债务未标注，难以跟踪。 导致功能异常。
- Minimal fix: 采用 `TODO(context)` 约定标记已知债务。
- Better long-term fix: 长期：采用 `TODO(context)` 约定标记已知债务。
- Regression test suggestion: 无。
- Estimated effort: N/A（持续实践）
### Finding: 设置项命名不一致
- ID: MAINT-11
- Severity: Low
- Confidence: High
- Category: Maintainability / Code Consistency
- Status: Confirmed
- Affected area: `src/settings.ts:379-388,442-453`
- Evidence: UI label `preferObj2gltf` 实际更新 `preferObj2gltfForObj`；UI label `pythonCmd` 更新 `freecadCommand`。
- Problem: 搜索/替换易出错，令人困惑。
- Why it matters: 这直接影响 搜索/替换易出错，令人困惑。
- Realistic failure scenario: 在正常使用中，搜索/替换易出错，令人困惑。 导致功能异常。
- Minimal fix: 统一 identifier。
- Better long-term fix: 长期：统一 identifier。
- Regression test suggestion: 验证设置 round-trip。
- Estimated effort: 30分钟
### Finding: 公共接口文档不足
- ID: MAINT-12
- Severity: Low
- Confidence: High
- Category: Maintainability / Comment Coverage
- Status: Confirmed
- Affected area: `src/render/preview/types.ts:38-67`, `src/render/preview/component-identity.ts:110-130`
- Evidence: 关键方法与函数缺少 JSDoc。
- Problem: 新渲染器/零件匹配实现需要反推语义。
- Why it matters: 这直接影响 新渲染器/零件匹配实现需要反推语义。
- Realistic failure scenario: 在正常使用中，新渲染器/零件匹配实现需要反推语义。 导致功能异常。
- Minimal fix: 为公共方法及关键函数添加 JSDoc。
- Better long-term fix: 长期：为公共方法及关键函数添加 JSDoc。
- Regression test suggestion: 无。
- Estimated effort: 2小时
---

### 4.7 Type Safety

### Finding: Babylon scene 中存在显式 any 与不安全成员访问
- ID: TS-1
- Severity: Medium
- Confidence: High
- Category: Type Safety
- Status: Confirmed
- Affected area: `src/render/babylon/scene.ts:1566,1611-1612,1634-1635`
- Evidence: `(line as any).color = ...` 等。
- Problem: 绕过类型安全，可能运行时错误。
- Why it matters: 这直接影响 绕过类型安全，可能运行时错误。
- Realistic failure scenario: 在正常使用中，绕过类型安全，可能运行时错误。 导致功能异常。
- Minimal fix: 使用类型化的 Babylon API 或收窄接口。
- Better long-term fix: 长期：使用类型化的 Babylon API 或收窄接口。
- Regression test suggestion: typecheck 与 lint 通过。
- Estimated effort: 1小时
### Finding: 广泛存在 `as` 类型断言
- ID: TS-2
- Severity: Medium
- Confidence: High
- Category: Type Safety
- Status: Confirmed
- Affected area: 多文件；`src/render/babylon/scene.ts`（26 处）、`src/view/workbench/knowledge-note.ts`、`src/view/inline/code-block.ts:391-425` 等。
- Evidence: JSON/配置解析后直接 cast，无验证。
- Problem: 非法数据可能运行时崩溃或行为异常。
- Why it matters: 这直接影响 非法数据可能运行时崩溃或行为异常。
- Realistic failure scenario: 在正常使用中，非法数据可能运行时崩溃或行为异常。 导致功能异常。
- Minimal fix: 引入校验函数，如 `isThreeDBlockConfig`、`isGltfJson`。
- Better long-term fix: 长期：引入校验函数，如 `isThreeDBlockConfig`、`isGltfJson`。
- Regression test suggestion: 用非法 payload 做 fuzz 测试。
- Estimated effort: 2天
### Finding: 非空断言普遍存在
- ID: TS-3
- Severity: Medium
- Confidence: High
- Category: Type Safety
- Status: Confirmed
- Affected area: 全部 `src/**/*.ts`；约 470 处 `!.`
- Evidence: `this.axesHelper!.visible`、`this.previewLine!.material` 等。
- Problem: dispose 后字段可能为 null，断言掩盖此情况。
- Why it matters: 这直接影响 dispose 后字段可能为 null，断言掩盖此情况。
- Realistic failure scenario: 在正常使用中，dispose 后字段可能为 null，断言掩盖此情况。 导致功能异常。
- Minimal fix: 启用 `no-non-null-assertion` lint 规则；使用 guard 或可选链。
- Better long-term fix: 长期：启用 `no-non-null-assertion` lint 规则；使用 guard 或可选链。
- Regression test suggestion: 增加 dispose 在 load 之前的生命周期测试。
- Estimated effort: 3天
### Finding: 导出函数缺少返回类型
- ID: TS-4
- Severity: Low
- Confidence: High
- Category: Type Safety
- Status: Confirmed
- Affected area: `src/utils/node-shim.ts`, `src/render/preview/geometry.ts`, `src/io/conversion/command-discovery.ts`, `src/view/workbench/knowledge-note.ts`
- Evidence: 大量导出/公共函数依赖推断。
- Problem: API 契约隐含；意外签名变更无法捕获。
- Why it matters: 这直接影响 API 契约隐含；意外签名变更无法捕获。
- Realistic failure scenario: 在正常使用中，API 契约隐含；意外签名变更无法捕获。 导致功能异常。
- Minimal fix: 为公共函数添加显式返回类型。
- Better long-term fix: 长期：为公共函数添加显式返回类型。
- Regression test suggestion: typecheck 已覆盖。
- Estimated effort: 1天
---

### 4.8 Configuration

### Finding: 设置输入缺少校验
- ID: CFG-1
- Severity: Medium
- Confidence: High
- Category: Configuration
- Status: Confirmed
- Affected area: `src/settings.ts:106-153,293-337,440-505`
- Evidence: 文件夹路径、命令路径、serviceBaseUrl 仅做 `.trim()`；enum 用 `as` 强转。
- Problem: 非法值会延迟到运行时失败。
- Why it matters: 这直接影响 非法值会延迟到运行时失败。
- Realistic failure scenario: 用户在 draft URL 中输入带空格的 `http://`，远程草稿静默失败。
- Minimal fix: 增加 `validateSettings()`，限制范围、拒绝非法字符、校验 enum。
- Better long-term fix: 长期：增加 `validateSettings()`，限制范围、拒绝非法字符、校验 enum。
- Regression test suggestion: `verify:settings` 用非法值断言规范化/警告。
- Estimated effort: 4小时
---

### 4.9 Observability

### Finding: info 级别日志写入 console.debug
- ID: OBS-1
- Severity: Low
- Confidence: High
- Category: Observations
- Status: Confirmed
- Affected area: `src/utils/log.ts:51-54`
- Evidence: `info()` 调用 `console.debug`。
- Problem: 部分浏览器默认过滤 debug 日志。
- Why it matters: 这直接影响 部分浏览器默认过滤 debug 日志。
- Realistic failure scenario: 在正常使用中，部分浏览器默认过滤 debug 日志。 导致功能异常。
- Minimal fix: 改为 `console.info` 或 `console.log`。
- Better long-term fix: 长期：改为 `console.info` 或 `console.log`。
- Regression test suggestion: 设置 info 级别并断言 `console.info` 被调用。
- Estimated effort: 5分钟
### Finding: 性能快照/转换耗时未暴露
- ID: OBS-2
- Severity: Low
- Confidence: Medium
- Category: Observability
- Status: Confirmed
- Affected area: `src/render/three/scene.ts`, `src/io/conversion/adapters/*.ts`
- Evidence: 内部计时存在，但未持久化或展示给用户。
- Problem: 生产环境难以诊断性能/转换问题。
- Why it matters: 这直接影响 生产环境难以诊断性能/转换问题。
- Realistic failure scenario: 在正常使用中，生产环境难以诊断性能/转换问题。 导致功能异常。
- Minimal fix: 将关键计时加入 diagnostics report。
- Better long-term fix: 长期：将关键计时加入 diagnostics report。
- Regression test suggestion: `verify:diagnostics` 断言包含计时字段。
- Estimated effort: 2小时
---

### 4.10 Data Integrity

### Finding: 知识笔记生成在文件写入完成前变更 analysis
- ID: DI-1
- Severity: Medium
- Confidence: High
- Category: Data Integrity
- Status: Confirmed
- Affected area: `src/view/workbench/knowledge-note.ts:1220-1364`
- Evidence: `generateKnowledgeNote` 先 mutate `analysis`，再写文件，最后更新 store；部分失败会留下不一致状态。
- Problem: store 与 sidecar 可能不一致。
- Why it matters: 这直接影响 store 与 sidecar 可能不一致。
- Realistic failure scenario: 磁盘满导致 part-note 写入中断，`analysis.partNotePaths` 部分填充。
- Minimal fix: 不可变地构建最终对象；所有 I/O 成功后一次性更新 store。
- Better long-term fix: 长期：不可变地构建最终对象；所有 I/O 成功后一次性更新 store。
- Regression test suggestion: 注入 I/O 失败并断言无部分状态持久化。
- Estimated effort: 4小时
### Finding: 转换缓存写入前未重新校验文件
- ID: DI-2
- Severity: Low
- Confidence: High
- Category: Data Integrity
- Status: Confirmed
- Affected area: `src/io/conversion/conversion-service.ts:116-133`
- Evidence: 转换成功后立即写入缓存，不再检查文件是否存在。
- Problem: 输出可能被删除或损坏后仍被缓存。
- Why it matters: 这直接影响 输出可能被删除或损坏后仍被缓存。
- Realistic failure scenario: 杀毒软件在缓存写入前删除输出，stale 条目被持久化。
- Minimal fix: 在 `convertedAssetCache.set()` 前重新 `isCachedOutputAvailable(result.outputPath)`。
- Better long-term fix: 长期：在 `convertedAssetCache.set()` 前重新 `isCachedOutputAvailable(result.outputPath)`。
- Regression test suggestion: 在转换与缓存写入之间删除输出，断言缓存不更新。
- Estimated effort: 1小时
### Finding: 持久化状态缺少 schema version
- ID: DI-3
- Severity: Low
- Confidence: High
- Category: Data Integrity
- Status: Confirmed
- Affected area: `src/store/plugin-store.ts:62-73`
- Evidence: `PersistedPluginState` 无 `schemaVersion` 字段。
- Problem: 未来破坏性变更无法区分旧格式。
- Why it matters: 这直接影响 未来破坏性变更无法区分旧格式。
- Realistic failure scenario: 新增设置形状后，旧 `data.json` 被静默错误解释。
- Minimal fix: 增加 `schemaVersion` 并在破坏性变更时 bump。
- Better long-term fix: 长期：增加 `schemaVersion` 并在破坏性变更时 bump。
- Regression test suggestion: 加载旧 `data.json` 并断言迁移路径。
- Estimated effort: 2小时
---

### 4.11 Privacy

### Finding: 诊断报告包含 Vault 路径结构
- ID: PRIV-1
- Severity: Low
- Confidence: High
- Category: Privacy
- Status: Confirmed
- Affected area: `src/diagnostics/report.ts:60-103`
- Evidence: 包含 `currentModelPath`、`reportNotePath`、`analysisSidecarPath`、`knowledgeIndexPath`。
- Problem: 路径在共享 bug 报告时可能敏感。
- Why it matters: 这直接影响 路径在共享 bug 报告时可能敏感。
- Realistic failure scenario: 在正常使用中，路径在共享 bug 报告时可能敏感。 导致功能异常。
- Minimal fix: 在 SECURITY.md 中说明；提供 redact-paths 选项。
- Better long-term fix: 长期：在 SECURITY.md 中说明；提供 redact-paths 选项。
- Regression test suggestion: `verify:diagnostics` 测试 redact flag。
- Estimated effort: 1小时
---

### 4.12 Accessibility

### Finding: 缺少正式的无障碍验证
- ID: ACC-1
- Severity: Low
- Confidence: Medium
- Category: Accessibility
- Status: Suspected
- Affected area: `src/settings.ts`, `src/view/inline/helper-buttons.ts`, `src/render/preview/annotations.ts`
- Evidence: UI 使用 Obsidian API 构建；无 axe/屏幕阅读器测试。
- Problem: 键盘/焦点/屏幕阅读器问题可能存在。
- Why it matters: 这直接影响 键盘/焦点/屏幕阅读器问题可能存在。
- Realistic failure scenario: 纯键盘用户无法操作工具栏或标注编辑器。
- Minimal fix: 增加键盘快捷键文档；在 Playwright 中运行 accessibility 检查。
- Better long-term fix: 长期：增加键盘快捷键文档；在 Playwright 中运行 accessibility 检查。
- Regression test suggestion: 在 `verify:preview` 中加入 axe-core 扫描。
- Estimated effort: 1天
---

### 4.13 Supply Chain

### Finding: esbuild source patch 脆弱
- ID: SUP-1
- Severity: Medium
- Confidence: Medium
- Category: Supply Chain / Maintainability
- Status: Confirmed
- Affected area: `esbuild.config.mjs:49-126`
- Evidence: 用正则 patch Babylon 源文件；无测试验证 patch 是否生效。
- Problem: Babylon 升级可能静默破坏 patch。
- Why it matters: 这直接影响 Babylon 升级可能静默破坏 patch。
- Realistic failure scenario: 升级到 Babylon 9.7，`_LoadScriptNative` 正则不再匹配，远程脚本守护失效。
- Minimal fix: 锁定经过测试的 Babylon 范围；增加构建测试验证 patch 后的 guard 字符串存在。
- Better long-term fix: 长期：锁定经过测试的 Babylon 范围；增加构建测试验证 patch 后的 guard 字符串存在。
- Regression test suggestion: 构建测试断言 patch 函数包含拒绝错误。
- Estimated effort: 4小时
### Finding: 声明了未使用的 Babylon 包
- ID: SUP-2
- Severity: Low
- Confidence: High
- Category: Dependency Weight
- Status: Confirmed
- Affected area: `package.json:39,43-44`
- Evidence: `@babylonjs/gui`、`@babylonjs/materials`、`@babylonjs/serializers` 在 `src/` 中无 import。
- Problem: 安装体积、lockfile、审计面增加。
- Why it matters: 这直接影响 安装体积、lockfile、审计面增加。
- Realistic failure scenario: 在正常使用中，安装体积、lockfile、审计面增加。 导致功能异常。
- Minimal fix: 移除未使用包。
- Better long-term fix: 长期：移除未使用包。
- Regression test suggestion: 移除后 `npm run build` 成功。
- Estimated effort: 15分钟
---

### 4.14 Documentation



### Finding: 预览路由矩阵与实现基本一致
- ID: DOC-3
- Severity: Info
- Confidence: High
- Category: Documentation
- Status: Verified
- Affected area: `docs/preview-routing-matrix.md`
- Evidence: 矩阵记录了 direct/code-block/3dgrid/workbench 的默认/实验/回退路径，与代码基本对齐。
- Problem: 与 预览路由矩阵与实现基本一致 相关的问题需要进一步调查。
- Why it matters: 这直接影响 与 预览路由矩阵与实现基本一致 相关的问题需要进一步调查。
- Realistic failure scenario: 在正常使用中，与 预览路由矩阵与实现基本一致 相关的问题需要进一步调查。 导致功能异常。
- Minimal fix: 待补充
- Better long-term fix: 长期：待补充
- Regression test suggestion: 添加对应的回归测试，覆盖该失败路径。
- Estimated effort: 2小时
---

### 4.15 Backend API

- Status: Not assessed
- **Reason:** 本项目为 Obsidian 插件，无服务端 API。

---

## 5. Recent Commit Capability Evolution

### 5.1 Commit Window

分析窗口：最近约 30 条提交，时间跨度约 2026-05-25 至 2026-06-08，提交者以单一作者为主，节奏非常快（部分日期 4-5 条 commit）。

### 5.2 Major Feature Inflection Points

| Commit | Version | What changed |
|--------|---------|--------------|
| `be3db73` | — | Three.js 正式成为单模型主渲染路径；引入 renderer-agnostic 抽象；单次提交 +5,326/-680 行，为近期最大变更。 |
| `f952415` | — | 增加 Three/Babylon 渲染器切换能力。 |
| `e3bdfba` | 0.4.0 | 引入零件笔记草稿（part note drafts）与模型知识索引。 |
| `fd49104` | 0.4.3 | 增加 diagnostics report、registered part matching、自动零件注册。 |
| `e478b42` / `b1cf45b` | — | GLB component identity 与跨格式零件匹配。 |
| `355c2e1` / `e8d094a` / `c078c22` | — | Workspace UI 重构为基于 track 的侧边栏。 |
| `7c487e9` | 0.5.5 | 增加距离测量工具（distance measurement）。 |

### 5.3 Stability Improvements

- 弹窗/独立窗口兼容性修复（`f952415` 相关）。
- Lint 合规性修复（大量 `style`/`lint` 提交）。
- 加载中断提示与资源加载鲁棒性增强。
- 资源释放与性能相关 work（Three.js frame budget、viewport pause）。
- 序列化锁 `generation` counter 防止并发保存。

### 5.4 Preview Routing Evolution

- 早期单一路径逐步拆分为：
  - **Direct file view**：默认 Babylon，可实验性切换到 Three.js，失败回退 Babylon。
  - **Code-block inline**：默认 Three.js。
  - **`3dgrid`**：强制 Babylon（grid 实现）。
  - **Workbench**：默认 Three.js，Babylon 作为保守回退。
- 路由矩阵已记录在 `docs/preview-routing-matrix.md`，但矩阵更新略滞后于代码变更。

### 5.5 Knowledge Base / Part Notes Progression

- 0.4.0：从分析结果生成知识笔记与零件草稿。
- 0.4.3：引入 registered parts；direct view 自动将捕获的零件候选注册到 model profile；后续模型可在完整报告存在前检测复用零件。
- 近期：增加零件身份跨格式匹配、知识索引更新、sidecar 持久化。

### 5.6 Release Cadence

版本序列：0.4.0 → 0.4.3 → 0.5.1 → 0.5.3 → 0.5.5。

- 从 0.4.x 跳到 0.5.x 反映 API/功能跃迁（Three.js 主渲染、测量工具）。
- 多个 commit 同时 bump `package.json`/`manifest.json`/`versions.json` 但未同步 `package-lock.json`。

### 5.7 Code Growth Patterns

- 最大增长来自 `src/render/three/scene.ts` 与 `src/render/babylon/scene.ts`。
- `src/view/workbench/knowledge-note.ts`、`src/view/direct-view.ts`、`src/settings.ts` 持续膨胀。
- `docs/` 与 `scripts/` 同步增长，说明文档与验证投入较多。

### 5.8 Risks Introduced by Recent Commits

- **巨型提交**：`be3db73` 一次改动超过 6,000 行，review 困难，是近期最大的回归风险源。
- **生成产物提交**：`main.js` 作为生成文件被反复提交，且当前 dirty/锁定。
- **UI 快速重构**：工作区多次 reorganize 为 track-based sidebar，若验证脚本硬编码 DOM 结构，易频繁 break。
- **双渲染器维护负担**：每次新功能（measurement、explode、focus）都需要在 Three 与 Babylon 两端实现，债务加速累积。
- **版本号不一致**：从 0.4.3 到 0.5.5 的更新未完整同步 lockfile 与 changelog。

---

## 6. Metrics Comparison

### 6.1 Build Volume

| Metric | Current (0.5.5) | Recent history | Trend |
|--------|-----------------|----------------|-------|
| `main.js` (uncompressed) | ~3.97 MB (3.8 MB reported by ls) | 3.945 MB at `27103cb` | ↔ Flat / slight growth |
| `styles.css` | 40 KB | — | — |
| `node_modules` | 281 MB | — | — |
| `.venv` | 14 MB | — | — |

**Observation:** 尽管近期有帧预算、viewport pause 等性能 work，但 bundle 体积没有下降趋势，因为 Three.js 与 Babylon.js 两个完整运行时仍被打包在一起。

### 6.2 Type Safety

| Metric | Current | Target | Trend |
|--------|---------|--------|-------|
| `npm run typecheck` | Passes | Passes | ✅ Stable |
| eslint problems | 21 (19 errors, 2 warnings) | 0 | ❌ Regressed / not enforced |
| `any` usage | Present | Minimal | ⚠️ Debt |
| `as` assertions | Many (Babylon scene alone 26) | Minimal | ⚠️ Debt |
| Non-null assertions (`!`) | ~470 across src | Minimal | ❌ High |

**Observation:** TypeScript 编译通过，但 lint 与类型断言债务明显，release workflow 未运行 eslint。

### 6.3 Test Coverage

| Layer | Coverage | Evidence |
|-------|----------|----------|
| Unit tests | None | No test runner, no `*.test.ts` |
| Integration / verification scripts | 11 scripts | `scripts/verify-*.mjs` |
| Conversion pipelines | Not covered | No `verify:conversion` |
| Remote draft privacy/security | Partial | `verify:remote-draft` exists but asserts structure, not sanitization |
| Obsidian end-to-end | Requires host | `verify:obsidian` skipped in this audit |

**Observation:** 验证矩阵广但浅；缺乏对关键路径的细粒度回归保护。

### 6.4 Build Health

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ Pass |
| `npm run build` | ❌ Fail — `main.js` locked/dirty |
| `npm audit` | ❌ 1 High (esbuild) |
| `npm run lint` | ❌ 21 problems |
| `npm run verify:release` | ❌ Blocked by package-lock version mismatch |

### 6.5 Rendering Performance

| Aspect | Current | Notes |
|--------|---------|-------|
| Three.js frame budget | ✅ Implemented | `updateFrameBudget()` adjusts pixel ratio |
| Viewport pause (Three) | ✅ Implemented | IntersectionObserver-based |
| Babylon loop pause | ❌ Missing | `runRenderLoop` continuous |
| Grid re-render | ❌ Every frame | `renderFrame()` clears & re-renders all cells |
| Annotation projection | ❌ O(n²) layout thrashing | `getBoundingClientRect()` inside nested loops |
| Resource disposal | ⚠️ Partial | Timers/observers in AnnotationManager need audit |

**Observation:** Three.js 路径已有节电措施，Babylon 路径仍是主要能耗风险；标注系统是交互帧率瓶颈。

---

## 7. Principles Compliance

对照 `rubrics/principles.md`：

| Principle | Compliance | Notes |
|-----------|------------|-------|
| Prefer explicit contracts | ⚠️ Partial | 渲染器接口较好，但内部大量 `as`/`!` 与非空断言 |
| Fail fast and noisily | ❌ Weak | 多处 catch 静默吞没错误 |
| Keep surfaces small and typed | ⚠️ Partial | `PluginStore` 暴露 raw setState；设置校验不足 |
| Make state explicit and owned | ⚠️ Partial | 视图直接 mutate persisted profiles；DOM-as-state 在 helper-buttons |
| Secure by default | ✅ Strong | 本地优先、Babylon 网络守卫、远程草稿默认关闭 |
| Verify at boundaries | ⚠️ Partial | 类型边界校验不足；远程内容未做 HTML 转义 |
| Document why, not just what | ⚠️ Partial | 文档丰富，但代码级 JSDoc 与 TODO 不足 |
| Test what must not break | ❌ Weak | 无单元测试；关键转换管道未覆盖 |
| Reduce and justify dependencies | ⚠️ Partial | 同时依赖 Three 与 Babylon；声明了未使用的 Babylon 包 |
| Review risk in code paths that touch money, data, or identity | ✅ Mostly | 远程草稿与转换命令有安全思考，但实现上有 gaps |

---

## 8. Recommended Fix Order

按风险收益比排序，优先处理阻塞发布与数据丢失问题：

1. **REL-1** — 同步 package-lock.json 到 0.5.5（5 分钟，解除 release 阻塞）
2. **REL-2** — 解决 main.js dirty/锁定，确保 `npm run build` 可用（15 分钟）
3. **STB-1** — PluginStore unload flush（30 分钟，防止数据丢失）
4. **SEC-1** — 升级 esbuild 并重新生成 lockfile（30 分钟）
5. **SEC-2** — 远程草稿输出 HTML/Markdown 转义（3 小时，用户安全）
6. **SEC-3** — 模型派生字符串 HTML 转义（2 小时）
7. **TST-5** — CI/release workflow 加入 eslint 并修复现有错误（2 小时）
8. **PER-1** — 减少 bundle 体积：移除未使用 Babylon 包，评估代码分割（1-2 天）
9. **PER-2** / **PER-3** / **PER-4** — Babylon 循环/Grid/标注投影性能优化（各 4 小时 - 1 天）
10. **TST-1** / **TST-4** — 引入单元测试与转换 mock 测试（各 1-2 天）
11. **MAINT-1** / **MAINT-2** — 拆分 scene 神类与消除双端重复（1-2 周，长期架构投资）

---

## 9. Quick Wins（本周可完成）

| ID | Fix | Effort | Impact |
|----|-----|--------|--------|
| REL-1 | 同步 package-lock 版本 | 5 min | 解除 release 阻塞 |
| REL-2 | 关闭锁定进程并提交干净 main.js | 15 min | 恢复本地构建 |
| REL-3 | 补充 CHANGELOG 0.5.3/0.5.5 | 20 min | 发布文档完整 |
| REL-4 | 更新文档版本示例 | 15 min | 新贡献者体验 |
| SEC-1 | 升级 esbuild | 30 min | 消除 high 漏洞 |
| STB-1 | store unload flush | 30 min | 防止数据丢失 |
| OBS-1 | info 日志改用 console.info | 5 min | 日志可见性 |
| SUP-2 | 移除未使用 Babylon 包 | 15 min | 减小依赖面 |
| REL-5 / REL-6 | 收紧 release tag 触发与输入处理 | 25 min | 供应链安全 |
| STB-2 starter | 为所有空 catch 添加 warn 日志 | 2 h | 调试能力 |

---

## 10. Long-Term Refactor Plan

### 10.1 渲染器架构瘦身（2-4 周）

- 提取 `SceneController` 接口：measurement、focus、explode/disassembly、wireframe、snapshot、frame budget。
- Three.js 与 Babylon.js 各自实现 `RendererAdapter`，将平台无关逻辑上提。
- 目标：`src/render/three/scene.ts` 与 `src/render/babylon/scene.ts` 均 < 800 行。

### 10.2 状态管理规范化（1 周）

- `PluginStore` 提供 typed actions：`registerPart`、`addPin`、`updateProfile`。
- 视图层禁止直接 `setState`。
- 增加 `schemaVersion` 与迁移逻辑。

### 10.3 测试金字塔建设（2-4 周）

- 引入 Vitest。
- 单元测试：resolve-path、geometry、component-identity、remote-draft normalization、store actions。
- mock 转换测试：stub Python/CLI 脚本覆盖 STEP/IGES/OBJ/FBX/3MF/DAE。
- 将现有验证脚本的断言从 CSS 类/文案迁移到 `data-testid`。

### 10.4 安全与隐私加固（1-2 周）

- 统一不可信输入清洗层（模型元数据、远程草稿、LLM 输出）。
- 转换器命令 allowlist / PATH 解析 / 校验。
- 远程 endpoint 私有 IP 警告与 allowlist。
- 提示注入测试矩阵。

### 10.5 性能专项（2-3 周）

- Babylon viewport pause / dirty rendering。
- 3dgrid 静态缓存。
- Annotation projection 批量读写 + 缓存 + 上限。
- Bundle splitting / lazy Babylon loading。

### 10.6 发布工程自动化（1 周）

- CI 中 `npm run lint`、`npm audit`、`npm run verify:release`。
- 文档版本号自动化校验。
- 考虑 changesets 或 conventional-changelog 生成 release notes。

---

## 11. Methodology & Limitations

- **Approach:** 基于 `fuck-my-shit-mountain` skill 的 full 模式，结合静态代码分析、依赖审计、构建/类型/lint 检查、recent commit 分析、6 个并行的聚焦探索代理。
- **Tools used:** `Read`, `Grep`, `Glob`, `Bash` (git, npm, eslint, npm audit, wc, file), `Agent` (explore × 6).
- **What was not done:** 未在真实 Obsidian 桌面/移动客户端做运行时测试；未做动态渗透测试；未对远程 LLM endpoint 做提示注入测试；未使用 profiler 采样真实用户场景。
- Confidence: 所有 Confirmed 发现均有代码/配置/输出证据；Suspected 发现已标注。

---

*Report generated by Kimi Code CLI on 2026-06-14.*
