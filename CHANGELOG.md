# Changelog

## Unreleased

- Rendering: add a Three.js capability profile and quality snapshot for direct-format visual fidelity diagnostics.
- Rendering: improve Three.js STL/PLY/OBJ color handling, adaptive PLY point-cloud sizing, and tiny-model camera precision.
- Performance: add Three.js smoothness metrics and enter interactive pixel-ratio throttling on pointer, wheel, and orbit input before the next frame renders.
- Testing: add Three.js color-fidelity and small-parts fixtures to the preview success suite.
- Performance: preserve original STEP/OCCT material colors while reducing GLB size by trying the OCCT glTF writer before the existing XDE component fallback.
- Performance: reuse existing `.ai3d-converted.*` files only when they are newer than the source model, avoiding stale geometry while skipping unnecessary conversions.
- Refactor: move FreeCAD/CadQuery conversion Python into bundled script templates while keeping TypeScript responsible for invocation and output validation.
- Routing: align production direct file view with the default Three.js edit-preview path while keeping converted workbench inputs on the conservative Babylon.js route.
- UI: improve ruler measurements with calibrated units, per-axis deltas, Markdown copy export, and shared Three.js/Babylon.js formatting.
- UI: keep completed ruler measurements visible when leaving measurement mode, cancel unfinished endpoints cleanly, and verify copy/clear/export behavior in the preview harness.
- Stability: increase default conversion timeout from 120s to 300s so large STEP models can complete without timing out.
- Security: sanitize remote draft output and model-derived metadata before writing generated notes.
- Security: redact vault-relative model, report, index, and folder paths from copied diagnostics reports by default.
- Security: validate converter command paths and reject shell metacharacters.
- Diagnostics: surface whether the last knowledge generation needs attention for pending, failed, or warning-completed runs.
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
