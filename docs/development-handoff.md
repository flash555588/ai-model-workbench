# Development Handoff

This document prepares a new coding model or developer to continue AI Model Workbench
without rediscovering the project contract. Use it as the alignment layer between the
README, implementation, verification scripts, and release/security docs.

## Repository Snapshot

AI Model Workbench is an Obsidian plugin that renders 3D model files inside a vault,
adds 3D annotations/bookmarks, and generates linked knowledge notes from model evidence.
The current package version is `0.6.0`.

Important runtime files:

- `main.js`, `manifest.json`, `styles.css` are the shipped Obsidian plugin assets.
- `src/main.ts` registers commands, direct file views, code block processors, live
  preview widgets, settings, and diagnostics.
- `src/domain/models.ts` is the shared type contract. Keep runtime code out of it.
- `src/store/plugin-store.ts` normalizes persisted `data.json` state and must preserve
  backward compatibility.

## Current Strategic Decisions

### Renderer Split

Three.js is the main single-model mesh preview path:

- inline `3d`
- Live Preview embeds
- direct file view
- GLB/GLTF/STL/PLY/OBJ direct formats
- readonly and edit annotation overlays on supported single-model routes

Babylon.js remains the capability and fallback path:

- `3dgrid`
- conservative workbench/fallback routes
- legacy fallback when Three is disabled or rollout requires Babylon
- paths outside Three direct support

The route contract lives in `src/render/preview/routing.ts` and
`docs/preview-routing-matrix.md`. If route behavior changes, update both code and docs.

### Experimental Three Workbench

Direct file view can enable an Experimental Three workbench route for direct GLB/GLTF
resources when settings allow it. It falls back to Babylon if Three loading fails.
This is not the same as changing all production workbench behavior.

Use `docs/workbench-3dgrid-feasibility-note.md` before reopening broader workbench or
`3dgrid` migration decisions.

### Knowledge Notes And Part Registration

Knowledge generation is local-first. The workbench/direct view evidence pipeline writes:

- a model report
- a JSON analysis sidecar
- a model knowledge index
- evidence snapshots
- up to 8 generated part note drafts
- local editable draft sections

Named GLB/GLTF model groups are promoted to higher-confidence part candidates while
ungrouped meshes remain candidates. Direct file view auto-registers captured part
candidates into each model profile after successful load. This lets later imported
models detect likely reused parts before a full report/sidecar exists. Full report
generation upgrades those candidates with sidecar and part-note links.

Core files:

- `src/view/workbench/analysis-result.ts`
- `src/view/workbench/knowledge-note.ts`
- `src/view/direct-view.ts`
- `scripts/verify-knowledge-index.mjs`

### Conversion Strategy

The plugin keeps heavy CAD and uncommon mesh conversion out of the browser runtime.
Conversion-capable formats route to local desktop converters and produce GLB assets.
Mobile keeps direct lightweight formats.

Core files:

- `src/io/formats/registry.ts`
- `src/io/model-pipeline.ts`
- `src/io/conversion/*`
- `src/io/cache/converted-asset-cache.ts`

Spec docs:

- `FORMAT_SUPPORT_DESIGN.md`
- `docs/cross-platform-development.md`

## Spec Alignment Map

| Spec / doc | Use when |
|------------|----------|
| `README.md` / `README.zh-CN.md` | User-facing capability, install, verification, release overview |
| `CHANGELOG.md` | Release-facing behavior changes and current unreleased work |
| `AGENTS.md` | Agent tool setup and repository working rules |
| `docs/0.6.0-plus-upgrade-plan.md` | `0.6.0+` reliability, workflow, maintainability, and release sequencing |
| `docs/requirements-tracker.md` | Stable product requirements, acceptance criteria, and verification mapping |
| `docs/preview-routing-matrix.md` | Any renderer route or rollout change |
| `docs/workbench-3dgrid-feasibility-note.md` | Workbench or `3dgrid` migration decisions |
| `docs/threejs-migration-roadmap.md` | Historical Three migration rationale and reopen conditions |
| `FORMAT_SUPPORT_DESIGN.md` | Format support, conversion strategy, external tool boundaries |
| `docs/cross-platform-development.md` | Paths, converter discovery, Python scripts, platform copy |
| `docs/mit-upstream-guidelines.md` | External code/license decisions |
| `SECURITY.md` | Release token handling and leak response |
| `.github/workflows/release.yml` | Release asset publishing behavior |

## Architecture Map

```text
src/
├── main.ts                    # Obsidian lifecycle, commands, views, processors
├── settings.ts                # Plugin settings UI and diagnostics controls
├── domain/
│   ├── models.ts              # Shared interfaces and persisted state types
│   └── constants.ts           # Defaults and supported extension set
├── store/
│   ├── create-store.ts        # Small store primitive
│   └── plugin-store.ts        # Obsidian loadData/saveData bridge
├── render/
│   ├── preview/               # Renderer-agnostic interfaces, routing, annotations
│   ├── three/                 # ThreeModelPreview and Three loaders/adapters
│   └── babylon/               # Babylon preview, grid renderer, custom loaders
├── io/
│   ├── formats/               # Format capability registry
│   ├── conversion/            # Converter discovery, manager, adapters
│   ├── cache/                 # Converted asset cache
│   └── model-pipeline.ts      # Direct/convert preparation
└── view/
    ├── direct-view.ts         # Direct file view and direct workbench panel
    ├── inline/                # `3d`, `3dgrid`, Live Preview, helper toolbar
    └── workbench/             # Analysis result, knowledge note, remote draft helpers
```

## Verification Matrix

Run only the checks that match the risk, but do not ship route, state, knowledge, or
release changes without their matching verification.

| Command | Purpose |
|---------|---------|
| `npm run build` | Production esbuild bundle |
| `npm run typecheck` | TypeScript contract check |
| `npm run verify:preview` | Focused browser preview smoke test |
| `npm run verify:preview:success` | Full preview route and interaction suite |
| `npm run verify:settings` | Legacy `data.json` migration/defaults check |
| `npm run verify:knowledge-index` | Report/index/part-note/registered part regression |
| `npm run verify:remote-draft` | Remote draft privacy and request shaping |
| `npm run verify:diagnostics` | Sanitized diagnostics output |
| `npm run verify:release` | Release asset version/hash/size check |
| `npm run verify:obsidian` | Real Obsidian smoke test when available |

Preview harness notes:

- The harness auto-detects Chrome/Edge/Chromium/Brave.
- Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` only for a custom browser.
- Failure screenshots and logs are written under `.tmp/preview-failures/`.

Useful focused preview examples:

```bash
npm run verify:preview -- --mode workbench --allow-workbench-three
npm run verify:preview -- --rollout babylon-safe
npm run verify:preview -- --model "models/resource-fixtures/grouped-parts/grouped parts.gltf" --expect-group-parts
```

## Tool And Environment Notes

- Node/npm are used for all builds and verification scripts.
- Obsidian app verification supports the local host platform when Obsidian can launch.
  It uses a temporary vault under the OS temp directory and `--clean` removes it after
  the run.
- Converter features depend on local desktop tools and Python environments. Do not assume
  a converter exists because a command name is common.
- Release publishing should rely on GitHub Actions `GITHUB_TOKEN`, not pasted PATs.

## Common Development Workflows

### Preview Or Renderer Change

1. Read `docs/preview-routing-matrix.md`.
2. Change the renderer or route code.
3. Update route docs if behavior changed.
4. Run `npm run typecheck`.
5. Run `npm run verify:preview` or `npm run verify:preview:success`.

### Knowledge Generation Change

1. Read the Knowledge Notes section in `README.md`.
2. Inspect `src/view/workbench/analysis-result.ts` and `knowledge-note.ts`.
3. Preserve user-written index content outside managed markers.
4. Run `npm run verify:knowledge-index`.
5. Update `CHANGELOG.md` if behavior changed.

### Persisted State Or Settings Change

1. Update `src/domain/models.ts` and `src/store/plugin-store.ts` together.
2. Normalize missing legacy fields safely.
3. Run `npm run typecheck` and `npm run verify:settings`.
4. Update diagnostics if the new state helps support/debugging.

### Converter Or Path Handling Change

1. Read `docs/cross-platform-development.md`.
2. Keep vault paths and filesystem paths separate.
3. Preserve user setting/env override priority.
4. Add or update diagnostics before expecting users to debug in DevTools.
5. Prefer Obsidian app verification when the change touches real file access.

### Release Preparation

1. Ensure `package.json`, `manifest.json`, and `versions.json` align.
2. Run `npm run build`.
3. Run `npm run verify:release`.
4. Scan for tokens as described in `SECURITY.md`.
5. Publish through GitHub Actions with a tag such as `0.5.8` (no `v` prefix).

## Current Follow-Up Direction

Short-term product direction after `0.6.0`:

- Keep tightening auto part registration and cross-model part reuse feedback.
- Keep improving direct workbench UX without prematurely moving all workbench routes.
- Maintain Three.js as the single-model main path.
- Keep `3dgrid` and production workbench conservative until workflow-level evidence says
  migration is worth it.
- Continue improving release safety, diagnostics, and real Obsidian verification.

## Handoff Checklist For A New Model

Before doing implementation work, confirm:

- You know which renderer route the target surface should use.
- You know whether the change touches persisted data.
- You know which verification command proves the change.
- You have checked existing uncommitted files with `git status --short`.
- You have read the relevant spec doc from the alignment map above.
