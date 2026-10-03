# Development Handoff

This document prepares a new coding model or developer to continue AI Model Workbench
without rediscovering the project contract. Use it as the alignment layer between the
README, implementation, verification scripts, and release/security docs.

## Repository Snapshot

AI Model Workbench is an Obsidian plugin that renders 3D model files inside a vault,
adds 3D annotations/bookmarks, and generates linked knowledge notes from model evidence.
The current package version is `0.9.11`.

Important runtime files:

- `main.js`, `manifest.json`, `styles.css` are the shipped Obsidian plugin assets.
- `src/main.ts` registers commands, direct file views, code block processors, live
  preview widgets, settings, and diagnostics.
- `src/domain/models.ts` is the shared type contract. Keep runtime code out of it.
- `src/store/plugin-store.ts` normalizes persisted `data.json` state and must preserve
  backward compatibility.

## 0.9.1 Data Isolation Contract

Knowledge generation checks existing artifact ownership before selecting output paths.
Free paths and artifacts generated for the same source retain their names; conflicting
models or user files get deterministic suffixes, including a numeric collision fallback.
Part drafts must match both source path and part ID before reuse.

Conversion reuse requires the exact source path. Do not restore the same-basename
relocation heuristic or reuse untracked legacy adjacent outputs. Persisted exact-source
records retain compatibility; source moves may require another converter run.

GLTF resource workers stop scheduling after the first failure and drain in-flight reads
before revoking Blob URLs. Preserve bounded concurrency and the original failure.

## 0.9.2 Knowledge Generation Lifecycle

Record pending before reading existing artifact ownership. Pending records initially
identify the model; final success/failure records include output paths once resolved.
Capture live model evidence and the screenshot synchronously before the first vault
await so later model switches cannot mix evidence into the original report.

Screenshot failures are optional evidence warnings. Successful report/sidecar/index
writes commit generation success before opening the report. Failure to open a saved
report must not change persisted success or overwrite a newer generation record.

## 0.9.3 Direct-view Knowledge Workflow

Knowledge actions precede summary metrics. Runtime progress is held in
`knowledge-generation-progress.ts`, never persisted: a pending marker from an
interrupted prior session remains retryable. Progress observers cannot abort writes,
and stale phase/finish notifications cannot clear a newer run.

File-view generation explicitly binds the model path, summary, evidence, and
screenshot before its lazy import, so another leaf becoming current cannot mix
models. Success releases live progress before opening the report. Renderer
diagnostics remain available in a collapsed disclosure; route data attributes
and the existing renderer selection contract are preserved. The workspace uses
a named container query for leaves at or below 640 CSS px.

## 0.9.4 Interaction Comfort

Mode exit and Escape are scoped to their preview/toolbar. Escape cancels an
unfinished ruler first; explicit Exit mode deactivates the mode and retains
completed measurements. Annotation editors can consume Escape before the mode
handler. Keyboard measurement leaves annotation before activating the renderer.

The knowledge sidebar can collapse without unloading the model. Divider resizing
uses pointer capture, keyboard controls, width bounds, and a disposer released on
model switches/close. Open-note errors are separate from generation errors; vault
create/delete/rename events refresh artifact availability without changing the
persisted generation record.

## 0.9.5 In-note Controls

Reading code blocks and Live Preview widgets share the note frame and helper
toolbar. Readonly pin visibility is an independent view feature, not annotation
editing: its initial pressed state follows the initially visible overlay, and
inspection or Escape must not toggle it. Keep active advanced tools visible when
More collapses. Inspectors share the note task context; completed ruler records
remain available when switching modes.

Toolbar destruction releases measurement/slice/zoom observers and keyboard
listeners. Live Preview forwards the current snapshot settings through the lazy
widget wrapper. Keep embed canvas height explicit to avoid intrinsic drawing-buffer
height affecting editor layout. Keep the lazy widget's returned root owned by
CodeMirror and mount the runtime inside it; replacing that root can turn toolbar
DOM into Markdown edits. More must never reveal capability-hidden buttons.
The showcase reuses the real controls and embeds
its GLB; vault-save/remove actions are disabled outside Obsidian.

## 0.9.6 Image-style Embeds

Normal wikilinks keep their paragraph/list/quote/table position. Reading postprocessing
uses Obsidian render-child ownership; Live Preview uses inline decorations except
standalone lines, which must match Obsidian's block attachment layer. Keep the CM
root stable. Source mode disables the custom decorations. Both surfaces share the
size parser and lazy widget; widths are bounded by their container, and controls
float without changing the embed footprint. Resolve links using the source note
and isolate cached resolutions by source path. Code examples and frontmatter must
remain text; fence/property delimiter changes invalidate the scan.

## 0.9.7 Compact Image Controls

Compact wikilinks now expose Reset/Expand/Parts; full helpers belong in the responsive
inspection dialog. Move the existing frame with a same-height placeholder instead
of creating another renderer. Restore it before disposal, exit active modes on
return, and retain completed records. Gate helper/shortcut access on model readiness.
Advanced canvas shortcuts open their inspection context first. Obsidian modal key
scopes handle Escape before DOM listeners, so route it through helper dismissal
before closing. Widget destruction must close the dialog.
CodeMirror may reuse a disposed decoration's WidgetType after viewport removal.
Reset its DOM lifetime on toDOM and reject pending mounts from earlier generations;
otherwise returning lines can remain blank.

## 0.9.11 Note UI and Language

Insertion guidance separates location and live dimension output from primary and
secondary instructions. Keep mode/size controls native and retain action data
attributes. Model picker rows show names, full vault paths and format labels;
getItemText remains the full path, and renderMatches preserves fuzzy highlights.
Copy embed writes to the clipboard only; pasting remains an explicit user action.
Part spacing and other geometry labels describe user operations without changing
stored keys or matching rules. Isolate buttons show their next action when pressed.
Styles use host theme variables, narrow option grids and visible focus outlines.
Native --note-insert-only verifies light/dark/narrow layouts, duplicate names,
path search, keyboard selection and live size summary alongside insertion safety.

## 0.9.10 Note Insertion Rules

The note-only insertion command and editor context menu reuse the model picker
and Editor.replaceSelection.
Resolve placement through the shared embed scanner; reject code, properties and
table divider rows. Default inline/table/standalone dimensions are 240x180,
160x120 and 400x300. Escape table size pipes. Saved part blocks require an empty
position after quote/list prefixes, with every generated line retaining nesting.
Validate the captured editor, file, document and selection before inserting;
never redirect a delayed choice into another note or rebuild the document.
Presets do not add persisted settings. Empty registration stays in the note with
the existing registration action; store updates activate mounted part previews.
Native --note-insert-only covers placement, undo, cancellation and stale choices.

## 0.9.9 Note Part Presentation

Notes consume current-profile registration through NotePartsAccess. Both code
blocks and image embeds expose an inline catalog and the same full inspection
window as direct views. Parts configuration stays in the fenced block; controls
only copy config and never mutate editor text. Exact IDs precede unique names.
Suspending inline display before opening inspection restores the assembly; on
return, recreate the inline selection/separation. Close inspection before image
dialogs and GPU disposal. MarkdownRenderChild owns code-block unload cleanup.
Normalize only the generated __root__/ import wrapper for node path matching.
Hide original assembly measurements/bounding boxes while parts are separated.
Use --note-parts-only in native verification to cover both renderers and surfaces.

## 0.9.8 Registered-Part Inspection

The direct-file sidebar opens a single-model registered-part catalog. Resolve only
current-profile records through exact node paths/occurrence IDs/component IDs and
unique mesh references; reject conflicting ownership and report partial coverage.
Do not use cross-model similarity matches as geometry identity. Reuse the loaded
canvas in a modal, stop active tools/animations, keep part meshes rigid, and restore
positions, visibility, layers, animation state and camera on close/model change.
Both Babylon and opt-in Three implement the renderer-neutral display contract.
World-space translation must compensate for scaled/rotated parents and renderable
ancestors. Three hides individual draws through layers to retain visible children.
This does not change routing or alter the asset/registration records.

## Current Strategic Decisions

### Renderer Split

Babylon.js compatibility mode is the default single-model mesh preview path:

- inline `3d`
- Live Preview embeds
- direct file view
- GLB/GLTF/STL/PLY/OBJ direct formats
- readonly and edit annotation overlays on supported single-model routes

Direct file view has one configurable fast-path exception: when the Converted
GLB Three fast path setting is enabled, generated converted GLB outputs from
STEP/FBX/3MF/DAE/etc. are opened with Three.js first, then silently fall back
to Babylon.js if Three loading fails. Disabling the setting makes converted
direct file views follow the normal renderer compatibility controls. This keeps
repeated CAD opens fast without broadening `3dgrid` or workbench production
routing.

Three.js remains available as an explicit opt-in rollout for supported
single-model routes:

- reading-surface `3d` embeds
- Live Preview embeds
- direct file view
- Experimental Three workbench probes for direct GLB/GLTF resources

Babylon.js remains the default capability and fallback path:

- default GLB/GLTF/STL/PLY/OBJ single-model previews
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

### Measurement Architecture

Short-distance measurement has renderer-neutral state and overlay ownership:

- `src/render/preview/measurement-session.ts` owns active mode, locked target,
  pending endpoint, snap status, endpoint pairing, and observers.
- `src/render/preview/measurement-overlay.ts` owns endpoint markers, completed
  segments, hover/pending visual state, preview-line lifecycle, endpoint reuse,
  calibration refresh dispatch, and disposal.
- `src/render/preview/measurement-markers.ts` is an internal atomic point/marker
  collection used by the overlay controller. Renderer classes must not maintain
  parallel marker and point arrays.
- `src/render/three/scene.ts` and `src/render/babylon/scene.ts` provide only native
  drawing adapters for marker creation/style/position, line geometry, labels,
  preview lines, and resource disposal.

Keep completed endpoint coordinates in base-model space. Calibration transforms are
applied only when adapters position or redraw overlays. New render backends should
implement `MeasurementOverlayDrawingAdapter` instead of copying measurement state flow.

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
generation upgrades those candidates with sidecar and part-note links. Direct workbench
match rows let users confirm, reject, or undo each suggested relationship. Those review
decisions persist separately from derived match data: confirmed reuse is preferred in
generated knowledge, while rejected reuse stays undoable but is excluded from reports,
indexes, part notes, and drafting input. The review surface is a multi-candidate queue:
reviewed relationships appear first, the initial view is capped for sidebar readability,
and Show all exposes the remaining candidates.

Core files:

- `src/view/workbench/analysis-result.ts`
- `src/view/workbench/knowledge-note.ts`
- `src/view/direct-view.ts`
- `scripts/verify-knowledge-index.mjs`

### Conversion Strategy

The plugin keeps heavy CAD and uncommon mesh conversion out of the browser runtime.
Conversion-capable formats route to local desktop converters and produce GLB assets.
Mobile keeps direct lightweight formats.

In 0.9.0, renderer support is derived from the registry's enabled loader kinds
through `src/io/formats/renderer-support.ts`. The opted-in Three path also loads
3MF/DAE/OFF/PCD/XYZ. File-view source preparation uses the same rollout policy as
rendering. Registered desktop FBX conversion and explicit OBJ conversion preferences
retain priority. Mobile FBX never initializes desktop tools. PCD/XYZ fail early
with renderer-setting feedback in compatibility mode. Babylon fallback applies
only to formats its direct loaders implement. 3MF/DAE/FBX texture managers accept
only embedded blob/data resources; pre-convert external textures to GLB.

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
| `docs/preview-interaction-matrix.md` | Preview tool mutual exclusion, picking, camera, overlay, and transform linkage |
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

Short-term product direction after `0.8.0`:

- Keep tightening auto part registration and cross-model part reuse feedback.
- Keep improving direct workbench UX without prematurely moving all workbench routes.
- Maintain Babylon.js compatibility mode as the default single-model path while
  keeping Three.js as an explicit rollout and converted-GLB fast path.
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
