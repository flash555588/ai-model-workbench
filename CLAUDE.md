# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**AI 3D Model Workbench** - An Obsidian plugin that renders 3D models (GLB/GLTF/STL/OBJ/SPLAT/PLY) in a Babylon.js viewport and links them to Obsidian knowledge notes. Targets Obsidian >= 1.5.0, desktop and mobile.

## Build Commands

```bash
npm install           # install deps
npm run dev           # dev build with watch (esbuild)
npm run build         # production build → main.js (~1.7 MB minified)
npm run typecheck     # tsc --noEmit --skipLibCheck
```

No test runner is configured. The only verification gate is `typecheck`.

## Architecture

Entry point: `src/main.ts` → esbuild bundles to `main.js` (CJS, ES2018). `main.js` + `manifest.json` + `styles.css` are deployed to the Obsidian vault's `.obsidian/plugins/ai-model-workbench/`.

### Layer Layout

| Layer | Directory | Responsibility |
|-------|-----------|---------------|
| Plugin shell | `src/main.ts` | Obsidian Plugin lifecycle, commands, state persistence |
| Domain types | `src/domain/models.ts` | All shared interfaces — no runtime code |
| Constants | `src/domain/constants.ts` | `SUPPORTED_MODEL_EXTENSIONS`, `DEFAULT_SETTINGS`, default camera/light/scene configs |
| Store | `src/store/create-store.ts` | ~30-line custom store primitive (getState/setState/subscribe) |
| Store bridge | `src/store/plugin-store.ts` | Obsidian `loadData`/`saveData` bridge with 500ms debounce |
| Babylon facade | `src/render/babylon/scene.ts` | `BabylonModelPreview` class: Engine/Scene/Camera lifecycle, model loading, config application (lights/camera/scene), snapshot export |
| Grid renderer | `src/render/babylon/grid.ts` | `GridRenderer` class: single Engine/Scene with per-cell viewports, LayerMask isolation, `loadWithPreset()` for preset layouts |
| Presets | `src/render/babylon/presets/` | Preset template system: `compare` (A/B), `showcase` (multi-angle), `explode` (ring), `timeline` (strip) |
| STL loader | `src/render/babylon/loaders/stl-loader.ts` | Self-written binary STL parser registered as Babylon SceneLoader plugin |
| PLY loader | `src/render/babylon/loaders/ply-loader.ts` | Self-written ASCII/binary PLY parser (triangulated mesh + point cloud + vertex color) |
| Loader registry | `src/render/babylon/loaders/register.ts` | Side-effect imports registering GLTF, OBJ, SPLAT loaders with Babylon SceneLoader |
| Explode | `src/render/babylon/explode.ts` | Explosion view (world-space displacement) |
| Picking | `src/render/babylon/picking.ts` | Click-to-highlight (clones material to avoid shared-material mutation) |
| Knowledge notes | `src/view/workbench/knowledge-note.ts` | Builds and writes local model report notes from current store state |
| File picker | `src/view/model-file-suggest-modal.ts` | `FuzzySuggestModal` filtered to `SUPPORTED_MODEL_EXTENSIONS` |
| Code block | `src/view/inline/code-block.ts` | ```` ```3d path ```` or JSON config processor with config application and helper buttons; ```` ```3dgrid ```` multi-model grid processor |
| Live Preview | `src/view/inline/live-preview.ts` | CM6 StateField + Widget for `![[model.ext]]` embed rendering in Live Preview |
| Helper buttons | `src/view/inline/helper-buttons.ts` | Remove, Copy snapshot, Export snapshot toolbar; `SnapshotProvider` interface for both `BabylonModelPreview` and `GridRenderer` |
| Direct view | `src/view/direct-view.ts` | `FileView` for opening .glb/.gltf/.stl files directly in a viewer tab |
| Live Preview | `src/view/inline/live-preview.ts` | CM6 StateField + Widget for `![[model.ext]]` embed rendering in Live Preview |
| Settings | `src/settings.ts` | `PluginSettingTab` with 3 fields (folders + auto-generate toggle) |
| Utilities | `src/utils/format.ts` | `formatFileSize`, `escapeObsidianMarkup`, `normalizeTagList` |
| Device | `src/utils/device.ts` | `isMobile()`, `hardwareScale()` — mobile detection and Babylon resolution tuning |

### Key Data Flow

1. **State persistence**: `PluginState` (settings, currentModelPath, modelAssetProfiles, agentDraft/Plan) saved via Obsidian's `saveData`/`loadData` through the store bridge with 500ms debounce.

2. **Model loading**: `BabylonModelPreview.loadModel(data, ext)` parses with Babylon's GLTF/OBJ/SPLAT loaders or self-written STL loader. Returns `ModelPreviewSummary` with mesh/triangle/material/bounding counts.

3. **Knowledge notes**: `generateKnowledgeNote()` in `src/view/workbench/knowledge-note.ts` builds Markdown with frontmatter + summary table + sections. It updates an existing report note or creates one in the configured report folder.


### Bundle Size

Babylon.js core is the dominant cost (~98% of 1.7 MB minified). Subpath imports (`@babylonjs/core/Engines/engine.js` etc.) are mandatory — barrel imports pull in Physics/WebGPU/XR and inflate to 7 MB. All Babylon imports in `src/render/babylon/` use subpath imports.

### Build Configuration

esbuild config externalizes `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`. No Vue aliases or feature flags. Tree-shaking is enabled.

## Conventions

- All state mutations go through `ps.store.setState()` — views subscribe and re-render.
- `BabylonModelPreview` owns its render loop (`requestAnimationFrame`) and must be `destroy()`-ed by the view that created it.
- `SUPPORTED_MODEL_EXTENSIONS` is defined once in `src/domain/constants.ts` — both `main.ts` and `model-file-suggest-modal.ts` import from there.
- Tags are capped at 12 per field (`normalizeTagList`).
- STL loader validates buffer bounds before parsing (84-byte header, triangle count × 50 bytes).
- Picking clones material before modifying emissive color to avoid shared-material side effects.
- Explode uses world-space coordinates (`getAbsolutePosition` / `setAbsolutePosition`).
- The `3d` code block supports both simple path (` ```3d model.glb `) and JSON config format with models, camera, lights, scene, stl fields.
- The `3dgrid` code block renders multiple models in a single Babylon Scene using per-cell viewports (`GridRenderer`). One Engine/one WebGL context regardless of grid size. `scene.autoClear = false` + manual viewport + scissor per cell.
- `3dgrid` supports `preset` field: `"compare"` (side-by-side), `"showcase"` (multi-angle single model), `"explode"` (ring arrangement), `"timeline"` (horizontal strip), `"gallery"` (all models in one scene, single camera, no cell limit), `"compose"` (combine multiple presets). Presets are pure functions in `src/render/babylon/presets/` that return `{ placements, cells }`.
- Preset cameras use `PresetCameraDef` (alpha, beta, radiusMultiplier, target, fov). Named presets: `iso`, `front`, `side`, `top`, `back`, `3/4`.
- Model path resolution uses `metadataCache.getFirstLinkpathDest` for link-style paths, falling back to exact vault path.
- Direct file opening registers `.glb/.gltf/.stl` extensions via `registerExtensions` and opens `DirectModelView`.
- Helper buttons (remove/copy/export) are always visible below preview (`.ai3d-helper-toolbar`). They use `SnapshotProvider.captureSnapshot()` which both `BabylonModelPreview` and `GridRenderer` implement.
