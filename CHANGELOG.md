# Changelog

## Unreleased

- Performance: lazy-load converter command discovery and conversion factory setup so direct GLB/GLTF/STL/PLY previews do not initialize converter adapters during plugin startup or direct-format preparation.
- Performance: reuse fresh converted GLB outputs before creating conversion managers so already-converted STEP/FBX/etc. models open without initializing converter adapters.
- Performance: defer Live Preview model initialization until embeds approach the viewport, preventing hidden large models from reading files during workspace startup.
- Performance: keep current-preview UI state out of automatic persistence so opening or clearing a model no longer queues a full `data.json` save.
- Performance: skip direct-view auto part-registration writes when regenerated part candidates match the saved profile.
- Performance: avoid full Live Preview embed rescans for ordinary note edits that do not touch model embed lines.
- Performance: throttle Three.js measurement preview-line raycasts to animation frames so large models do less work during pointer movement.
- Performance: register direct file views through a lightweight lazy proxy so Direct View renderer/workbench modules load only when a model file is opened.
- Performance: register reading-mode `3d`/`3dgrid` code blocks through lightweight lazy handlers so heavy inline preview modules load only when a rendered block needs them.
- Performance: serialize Live Preview and reading-mode model loads through an inline preview queue and defer `3dgrid` model preparation until the grid enters the viewport, reducing startup and multi-model I/O spikes.
- Performance: defer Live Preview runtime imports for preview backends, annotation managers, conversion preparation, and load feedback until a visible embed actually starts loading.
- Performance: defer reading-mode annotation runtime setup until after inline model canvases are visible, reducing first-frame delay for annotated previews.
- Performance: load external `.gltf` buffers and textures through temporary Blob URLs instead of base64-rewriting the JSON, reducing large-model memory spikes and parse overhead.
- Performance: register Live Preview embeds through a lightweight lazy widget so workspace startup no longer imports the full embed runtime before a model embed approaches the viewport.
- Performance: defer Live Preview editor-extension registration until the workspace layout is ready, keeping CodeMirror model-embed setup off the plugin startup critical path.
- Performance: schedule Live Preview extension setup after the initial layout settles and lazy-load heading-pin observer runtime only when heading-linked annotations exist.
- Performance: skip full Live Preview line parsing for editor documents that do not contain model embed markers, reducing startup work for large ordinary notes.
- Performance: defer Three.js mesh shadow flag setup and shadow-map updates until ground shadows or shadow-casting lights are active, reducing large-model load work on the default route.
- Performance: keep the heading-pin DOM observer disabled until at least one annotation is bound to a note heading, avoiding startup-wide heading scans in vaults without heading-linked model pins.
- Performance: cache heading-linked annotation detection by model-profile table identity so unrelated store updates do not rescan every saved profile before the observer starts.
- Performance: compact saved registered-part mesh references to representative samples, reducing `data.json` size and startup parsing work for large converted assemblies while preserving component identity fields.
- Performance: compact persisted registered-part bounding boxes and centers to stable significant digits, removing floating-point tails from `data.json` without dropping tiny-part scale precision.
- Performance: strip derived automatic registered-part observation text from persisted profiles while preserving structured component, format-lineage, material, count, and reviewed-note fields.
- Performance: stamp compact plugin state with a schema marker so future workspace startup can skip repeated deep registered-part compatibility scans.
- Performance: lazy-load the full settings tab UI and model import modal so normal workspace startup only registers lightweight entry points.
- Performance: keep direct-view workbench analysis modules off the first model-open path until deferred part registration or registered-match previews actually need them.
- Performance: load direct-view annotation and note-heading helpers after the model is visible so large previews do not wait for annotation runtime setup.
- Performance: combine model profile normalization and compact-state change detection into one pass, reducing startup work for large `data.json` registered-part lists.
- Performance: reuse already-normalized registered part arrays while loading model profiles, avoiding repeated object allocation for compact `data.json` state.
- Performance: normalize schema-marked but oversized registered-part lists on load so anomalous large `data.json` profiles are compacted back under the startup budget.
- Performance: cache Three.js root bounds and pre-index grouped part descendants so large converted models do less repeated scene traversal after loading.
- Performance: reuse Three.js child-mesh descendant indexes for picking, evidence grouping, and disassembly setup so large assemblies avoid repeated subtree scans during selection.
- Performance: reuse shared Three.js focus-dim materials across meshes with the same source material, reducing material churn when focusing parts in large assemblies.
- Performance: coalesce disassembly drag updates to animation frames and flush the final pointer position on release, reducing high-frequency transform work while moving parts in large assemblies.
- Performance: defer Three.js geometry quality snapshots and direct-view registered-part match previews so large models become interactive before diagnostic and cross-model matching work runs.
- Performance: capture disassembly original transforms only for dragged parts and cache repeated Live Preview embed path resolution, reducing large-assembly interaction and workspace editor setup work.
- Performance: update Three.js focus selection incrementally so switching selected parts in large assemblies no longer restores and re-dims every mesh.
- Performance: prepare each unique Three.js material once during model load, avoiding repeated texture audit and anisotropy updates on shared-material large models.
- Performance: skip repeated Three.js texture scans when disposing shared materials during model switches, reducing large-model close/reload stalls.
- Performance: avoid forcing an unchanged plugin `data.json` rewrite during unload; only pending dirty state is flushed.
- Performance: load inline preview modules in parallel and defer heading-pin DOM observers until the workspace layout is ready, reducing plugin startup work.
- Performance: read absolute-path model files without an extra full-buffer copy when Node returns a whole file buffer, reducing memory spikes for large converted GLB assets.
- Performance: overlap direct-view model file reads with preview backend creation so large files spend less time in the loading phase before parsing starts.
- Performance: reuse source file stats across conversion-cache checks, reducing repeated filesystem metadata reads on slow or synced storage.
- Performance: reuse already-normalized converted-asset cache records during plugin startup, avoiding unnecessary cache cleanup work on healthy state.
- Performance: cache Three.js and Babylon renderable geometry stats so large-model performance/quality snapshots do not repeatedly traverse the full scene.
- Performance: skip automatic direct-view evidence registration for heavy/extreme models and delay medium-model registration to reduce post-load UI stalls.
- Performance: avoid rescanning heading-pin metadata on unrelated store updates, reducing workspace startup and state-change work in large vaults.
- Rendering: include Three.js PLY point clouds in summary, part evidence, picking, measurement, material audit, and disposal paths without faking triangle counts.
- Rendering: keep Three.js orthographic camera, shadow, and grid helper scales tied to real tiny-model bounds instead of a one-unit floor.
- Rendering: promote Three.js and Babylon picks on converted component child meshes to their parent registered component/group so selection, focus, and disassembly dragging do not collapse to a single surface fragment.
- Rendering: preserve Three.js component world transforms when entering disassembly drag so nested converted GLB parts no longer jump to the scene origin or change orientation.
- Performance: open large converted models faster by reusing fresh `.ai3d-converted.glb` outputs before probing converter identity and by deferring direct-view evidence registration until after the preview is visible.
- Performance: route conversion-backed GLB direct file views through Three.js and avoid extra full-buffer copies during GLB parsing.
- Performance: cap automatic registered-part writes for highly fragmented models so large imports do not keep growing the plugin state file with low-value surface shards.
- Performance: normalize oversized saved registered-part lists on load, strip transient registered-match caches, and quickly persist the compact state so future workspace startup parses less data.
- Performance: avoid rewriting unchanged plugin state during startup or unload, reducing extra `data.json` disk I/O in large vaults.
- Performance: make direct-view registered-part match previews skip sidecar reads, cap current/candidate part samples, and reuse indexed match tokens to reduce large-model UI stalls.
- Performance: apply direct-file render quality settings immediately and automatically lower resolution/shadow cost for heavy and extreme model previews.
- Conversion: write new converted GLB outputs to `.obsidian/ai-model-workbench/converted-assets` while continuing to reuse existing side-by-side `.ai3d-converted.glb` files.
- UI: always dismiss direct-view and Live Preview loading overlays when a preview load is interrupted, avoiding stale dark shields during rapid reloads or verification runs.
- Knowledge: merge generic tiny mesh fragments into a lower-confidence detail cluster so imported models keep meaningful small parts without over-splitting renderer noise.
- Knowledge: preserve part-splitting format lineage across direct and converted formats, including source format, rendered format, and direct/convert strategy in reports, sidecars, draft input, and registered part profiles.
- Docs: trim redundant English and Chinese README quick-start, install, and platform-support copy, and split detailed usage/workflow syntax into dedicated docs.
- Docs: add a user-facing `0.6.0+` update log covering Three.js fidelity, smoothness, small-part evidence, knowledge workflow, conversion diagnostics, and release gates.

## 0.6.1 - 2026-06-25

- Review: use `window.setTimeout()` and `window.clearTimeout()` in timeout helpers and preview verification to satisfy Obsidian source review guidance.

## 0.6.0 - 2026-06-25

- Rendering: add a Three.js capability profile and quality snapshot for direct-format visual fidelity diagnostics.
- Rendering: improve Three.js STL/PLY/OBJ color handling, adaptive PLY point-cloud sizing, and tiny-model camera precision.
- Performance: add Three.js smoothness metrics and enter interactive pixel-ratio throttling on pointer, wheel, and orbit input before the next frame renders.
- Performance: let settled Three.js previews sleep their render loop until interaction, animation, or observer work resumes.
- Docs: align README import pipeline diagrams with the Three.js default route and Babylon fallback paths.
- Testing: add Three.js color-fidelity and small-parts fixtures to the preview success suite.
- Testing: cover preview routing policy so conservative workbench and `3dgrid` paths stay on Babylon.js.
- Testing: make Obsidian smoke verification scroll each inline preview canvas into view before sampling pixels so offscreen render pausing does not cause false failures.
- Performance: preserve original STEP/OCCT material colors while reducing GLB size by trying the OCCT glTF writer before the existing XDE component fallback.
- Performance: reuse existing `.ai3d-converted.*` files only when they are newer than the source model, avoiding stale geometry while skipping unnecessary conversions.
- Refactor: move FreeCAD/CadQuery conversion Python into bundled script templates while keeping TypeScript responsible for invocation and output validation.
- Refactor: extract direct-view layout and workbench overview helpers from `DirectModelView` without changing route behavior.
- Refactor: extract Three.js mesh, part, and model summary helpers from the scene coordinator without changing renderer routing.
- Refactor: extract Babylon.js metadata, part grouping, and mesh summary helpers from the scene coordinator without changing fallback routing.
- Routing: align production direct file view with the default Three.js edit-preview path while keeping converted workbench inputs on the conservative Babylon.js route.
- UI: improve ruler measurements with calibrated units, per-axis deltas, Markdown copy export, and shared Three.js/Babylon.js formatting.
- UI: keep completed ruler measurements visible when leaving measurement mode, cancel unfinished endpoints cleanly, and verify copy/clear/export behavior in the preview harness.
- Stability: increase default conversion timeout from 120s to 300s so large STEP models can complete without timing out.
- Security: sanitize remote draft output and model-derived metadata before writing generated notes.
- Security: redact vault-relative model, report, index, and folder paths from copied diagnostics reports by default.
- Security: validate converter command paths and reject shell metacharacters.
- Security: reject unsafe configured converter command invocations before adapter execution while allowing normal quoted Windows paths.
- Diagnostics: surface whether the last knowledge generation needs attention for pending, failed, or warning-completed runs.
- Diagnostics: summarize converter enabled/configured/unsafe status and conversion cache policy without exposing local command paths.
- Docs: synchronize the `0.6.0+` upgrade plan with the verified requirements baseline.
- Stability: flush pending plugin store state on unload and log previously swallowed folder-creation errors.
- Stability: mark knowledge-note generation as pending before vault writes, then success or failed after required artifacts finish.
- Stability: bound optional remote draft requests with a timeout so local knowledge-note generation can continue when a draft service hangs.
- Stability: handle WebGL context loss/restoration in Three.js, Babylon.js, and 3dgrid previews.
- Stability: add outer timeout to conversion manager to prevent hung converters from blocking previews.
- Performance: pause Babylon.js preview render loops when the canvas leaves the viewport.
- Performance: skip unchanged cells in Babylon.js 3dgrid rendering.
- Performance: cap annotation pins and batch DOM reads/writes in label avoidance.
- Testing: add Vitest with unit tests for escape-html, remote-draft sanitization, and conversion manager timeout/deduplication.
- Testing: cover knowledge-note generation markers for success, partial-write failure, and stale pending recovery warnings.
- Testing: verify remote-draft timeout behavior in unit tests and the remote-draft verification script.
- Testing: cover converted asset cache normalization and FreeCAD converter script generation/output validation.
- Testing: cover renderer capability guards so toolbar controls only appear for callable preview methods.
- Build: remove unused `@babylonjs/gui`, `@babylonjs/materials`, and `@babylonjs/serializers` dependencies.

## 0.5.8

- Re-release of 0.5.7 with signed release artifacts (GitHub artifact attestations).
- CI: switch release workflow to `npm install` to avoid cross-platform lockfile mismatches.

## 0.5.7

- UI: promote the measurement tool to a primary toolbar button.
- UI: reorganize the inline preview toolbar into primary (always visible) and secondary (expandable) action groups.
- UI: remove text labels from toolbar buttons to keep the toolbar compact.
- UI: highlight active toggle buttons with a filled accent background so enabled features are obvious.

## 0.5.5

- Align release version metadata.

## 0.5.3

- Address Obsidian review warnings.

## 0.5.1

- Add annotation bookmark display modes for full snippets, compact surfaces, and dots; keep bookmark popovers open while hovered and hide occluded bookmarks fully.
- Register GLB/GLTF component metadata from `extras.ai3d` as individual parts, preserving component IDs, occurrence IDs, part numbers, and component paths through reports and part notes.
- Preserve STEP XDE component labels during CAD conversion, exporting PCB/CAD components as individual GLB component meshes with `extras.ai3d` identity metadata.
- Remove the direct-workbench explode controls and reorganize the panel around model status, knowledge actions, and registered part matches.
- Preserve source extensions such as STEP, FBX, 3MF, and DAE in analysis records so registered part matching can link reused components across converted model formats.

## 0.4.3

- Add a command-palette diagnostics report that copies sanitized runtime, renderer, model, knowledge-generation, and conversion status for bug reports.
- Preserve generated `knowledgeIndexPath` and the last knowledge-generation summary across Obsidian restarts.
- Let the `Open knowledge index` command fall back to the latest generated index when no model file is currently focused.
- Add `npm run verify:diagnostics` to confirm diagnostics include useful support context without leaking draft service URLs or local converter command paths.
- Register named model groups/assemblies as higher-confidence part candidates, while preserving ungrouped meshes as standalone parts.
- Auto-register captured part candidates into each model profile as soon as a direct file view loads, so later imported models can match reused parts before a report has been generated.
- Match current part candidates against previously registered parts from other analyzed models, linking likely reused parts in the report, sidecar, draft input, index, and part notes.
- Show the source model for direct-workbench registered part matches and let the Open action fall back to that source model when no part note exists yet.

## 0.4.0

- Generate first-pass part note drafts for the strongest captured part candidates and link them from the main knowledge report and analysis sidecar.
- Generate a model knowledge index that collects the report, analysis sidecar, evidence images, annotations, and generated part notes in one Obsidian entry point.
- Add command-palette and direct-workbench actions to open the generated model knowledge index.
- Make `verify:obsidian -- --clean` close Obsidian and unregister the temporary test vault before deleting it, avoiding stale console `ENOENT` noise after diagnostics.
- Add a configurable part notes folder so generated component drafts can live separately from model reports.
- Add `npm run verify:knowledge-index` to regression-test generated index links, managed-section refreshes, and preservation of user-written notes without launching Obsidian.

## 0.3.1

- Add release-asset Obsidian verification mode so the packaged `main.js`, `manifest.json`, and `styles.css` can be downloaded from a GitHub release and installed into the test vault.
- Harden legacy `data.json` settings loading by merging saved settings with current defaults and verifying old partial settings still boot the plugin.
- Add `SECURITY.md` with a release-token safety checklist and PAT leak response.
- Upgrade generated knowledge notes from a template-only report into a local evidence pass with model evidence, part candidates, knowledge nodes, a JSON sidecar, and a captured preview image.
- Add an editable local knowledge draft generated from captured evidence, annotations, tags, and profile notes, so note generation is useful even without a remote draft service.
- Add an optional remote-draft client for knowledge notes. It is local-only by default, posts only sanitized evidence to `POST /draft-note` when configured, and refuses raw model upload.
- Improve direct GLTF resource loading for `.gltf + .bin + textures`, including URL-encoded paths, spaces, Chinese filenames, and case-insensitive vault lookup.
- Improve OBJ/MTL direct loading with same-directory MTL lookup, texture filename case fallback, non-blocking missing-texture warnings, and clearer missing-resource feedback.

## 0.3.0

- Add a guarded `Experimental Three workbench` setting for direct GLB/GLTF file-view workbench surfaces.
- Keep production workbench routing conservative by default, and automatically fall back to Babylon.js if the experimental Three workbench load fails.
- Limit experimental workbench Three routing to direct GLB/GLTF resources; converted assets and non-GLTF formats remain on Babylon.js.
- Add a direct file-view workbench panel with backend/route status, model metrics, explode controls, and knowledge-note actions.
- Expand verification with real Obsidian file-view workbench coverage for Three backend selection, focus/disassembly controls, panel explode, annotation mode, knowledge-note generation, and conversion-chain error feedback.

## 0.2.5

- Add a Three.js frame budget that lowers interactive pixel ratio, reduces annotation observer refreshes, and defers shadow refreshes when rotate/zoom frames get expensive.
- Pause Three.js rendering when previews leave the viewport, then resume with a dirty frame and refreshed shadows when they return.
- Add Three.js disposal audit counters for model switches and teardown so geometry, material, and texture cleanup is visible in performance snapshots.
- Classify loaded models by performance tier and show large-model feedback with triangle/splat and material counts.
- Add early 0.2.6 annotation foundations: label overlap avoidance and near-pin visual priority while rotating.

## 0.2.4

- Add `npm run verify:obsidian` for an end-to-end Obsidian smoke test that installs the plugin into a test vault, opens a verification note, and checks that GLB/STL WebGL canvases render non-empty pixels.
- Add `npm run verify:release` to validate manifest/package/versions consistency and print release asset sizes plus SHA-256 hashes.
- Update the release workflow to run asset verification and publish release notes with asset hashes.
- Document release-token hygiene so publishing does not rely on long-lived or over-scoped personal access tokens.

## 0.2.3

- Improve Three.js preview performance while zooming and rotating models with an interactive pixel-ratio cap, finite idle observer settling, and more conservative shadow-map updates.
- Refresh annotation occlusion in small batches while the camera moves, reducing delayed bookmark visibility changes on tagged models.
- Align focus-mode behavior between Three.js and the main engine path, including blank-click handling and dim material behavior.
- Add hidden workbench verification coverage for the Three.js capability probe while keeping production workbench routing on Babylon.js.
- Expand preview verification with workbench fallback, direct STL/PLY/OBJ routing, performance snapshots, moving-pin occlusion checks, and browser auto-detection.
- Verify the packaged plugin in Obsidian 1.12.7 with real GLB/STL code blocks, loaded plugin state, helper toolbars, and non-empty WebGL canvases.
