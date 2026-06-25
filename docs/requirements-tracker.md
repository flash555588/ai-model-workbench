# Requirements Tracker

Use this file to track AI Model Workbench requirements that affect product scope,
verification, and handoff. Keep IDs stable once created so changelog entries, tests, and
future agent notes can refer to the same requirement over time.

## Status Key

| Status | Meaning |
|--------|---------|
| `Accepted` | In scope and ready for implementation or ongoing refinement |
| `In Progress` | Currently being changed |
| `Verified` | Implemented and covered by the listed verification |
| `Deferred` | Valid, but intentionally postponed |
| `Dropped` | No longer in scope |

## Priority Key

| Priority | Meaning |
|----------|---------|
| `P0` | Required for safe plugin operation |
| `P1` | Important for the next release-quality build |
| `P2` | Useful improvement |
| `P3` | Nice-to-have or exploratory |

## Requirement Index

| ID | Requirement | Priority | Status | Verification |
|----|-------------|----------|--------|--------------|
| REQ-001 | Single-model previews use Three.js by default while Babylon remains fallback/capability backend | P0 | Verified | `npm run verify:preview`, `npm run verify:preview:success` |
| REQ-002 | `3dgrid` and conservative workbench routes remain on Babylon until workflow evidence justifies migration | P0 | Accepted | `docs/preview-routing-matrix.md`, `npm run verify:preview` |
| REQ-003 | Knowledge generation remains local-first and records report, sidecar, index, preview evidence, and part notes | P0 | Verified | `npm run verify:knowledge-index` |
| REQ-004 | Direct file view auto-registers captured part candidates for later cross-model reuse matching | P1 | Verified | `npm run verify:knowledge-index`, `node scripts/verify-preview.mjs --model "models/resource-fixtures/grouped-parts/grouped parts.gltf" --expect-group-parts`, AstroInk STEP component conversion probe |
| REQ-005 | Registered part reuse feedback is visible in generated notes and direct workbench UI | P1 | Verified | `npm run verify:knowledge-index`, `npm run typecheck`, `node scripts/verify-preview.mjs --mode workbench --allow-workbench-three` |
| REQ-006 | Diagnostics reports expose support context without leaking draft service URLs, converter command paths, or vault-relative model/note paths | P1 | Verified | `npm run verify:diagnostics` |
| REQ-007 | Release assets keep `manifest.json`, `package.json`, `versions.json`, `main.js`, and `styles.css` aligned | P0 | Verified | `npm run build`, `npm run verify:release` |
| REQ-008 | Real Obsidian smoke verification covers install, rendering, knowledge generation, and diagnostics when the host can launch Obsidian | P1 | Verified | `npm run verify:obsidian -- --clean` |
| REQ-009 | Direct view preserves preview, annotation, measurement, and knowledge actions across Three/Babylon routes | P0 | Verified | `npm run typecheck`, `npm test`, `npm run verify:preview`, `npm run verify:preview:success`, `npm run verify:obsidian -- --clean` |
| REQ-010 | Measurement records are calibrated, persistent during mode changes, copyable as Markdown, and covered in preview verification | P1 | Verified | `npm run typecheck`, `npm test -- --run src/render/preview/measurement.test.ts`, `npm run verify:preview`, `npm run verify:preview:success` |
| REQ-011 | Renderer capability contracts are tested for Three.js and Babylon.js so toolbar actions cannot silently drift | P1 | Verified | `npm test -- --run src/render/preview/types.test.ts`, `npm run typecheck`, `npm run verify:preview:success` |
| REQ-012 | Conversion diagnostics explain missing, disabled, stale, timed out, and unsafe converter paths without leaking local command details | P1 | Verified | `npm run typecheck`, `npm test -- --run src/io/conversion/command-discovery.test.ts src/io/conversion/manager.test.ts src/io/cache/converted-asset-cache.test.ts src/io/conversion/adapters/freecad-converter.test.ts src/io/conversion/adapters/freecad-script-builder.test.ts src/diagnostics/report.test.ts`, `npm run verify:diagnostics` |
| REQ-013 | Knowledge generation writes pending, failed, and success state consistently across partial artifact writes | P0 | Verified | `npm run typecheck`, `npm test -- --run src/view/workbench/knowledge-note.test.ts src/view/workbench/remote-draft.test.ts`, `npm run verify:knowledge-index`, `npm run verify:remote-draft` |
| REQ-014 | Large coordinator classes are split without changing route behavior | P2 | In Progress | `npm run typecheck`, `npm test`, `npm run verify:preview`, `npm run verify:preview:success` |
| REQ-015 | Three.js direct-format visual fidelity and smoothness are measurable for format support, color pipeline, precision, small parts, and frame budget | P1 | Verified | `npm run typecheck`, `npm test`, `npm run verify:preview`, `npm run verify:preview:success`, `npm run verify:diagnostics`, `npm run build`, `npm run verify:release` |

## Active Requirement Details

### REQ-004: Auto Part Registration

- Status: Verified
- Priority: P1
- User value: Named groups, assemblies, and converted source components should become reusable part candidates without requiring a full report first.
- Current behavior:
  - Named model groups are promoted to higher-confidence part candidates.
  - GLB/GLTF `extras.ai3d` component metadata is promoted to individual component parts with stable component/occurrence identifiers.
  - STEP XDE assembly/component labels are preserved during CAD conversion as individual GLB component meshes with `extras.ai3d` metadata.
  - Source formats such as STEP, FBX, 3MF, and DAE are preserved in analysis records so registered matches can connect reused parts across converted model types.
  - Ungrouped mesh parts remain available as lower-confidence candidates.
  - The grouped-parts browser fixture verifies that group and mesh evidence are both preserved.
- Verification:
  - `npm run verify:knowledge-index`
  - `node scripts/verify-preview.mjs --model "models/resource-fixtures/grouped-parts/grouped parts.gltf" --expect-group-parts`
  - `AstroInk_v1_1_3D模型.step` conversion probe exported 82 named component meshes and preview verification passed on the generated GLB.

### REQ-005: Registered Part Reuse Feedback

- Status: Verified
- Priority: P1
- User value: When a newly loaded model contains parts that resemble parts from another model, users should see where the match came from and have an immediate action to inspect the existing evidence.
- Current behavior:
  - Knowledge reports, sidecars, draft input, index entries, and part notes preserve registered matches.
  - Direct workbench shows the strongest cross-model matches.
  - Direct workbench now includes the source model label, explains what the action opens, and opens the matched part note, falling back to the source model file if no part note exists yet.
  - Direct workbench omits explode controls so reuse feedback and knowledge actions remain the primary panel controls.
- Acceptance criteria:
  - Match rows show the current part, matched registered part, match reasons, score, and source model.
  - The action label distinguishes opening a part note from opening a source model fallback.
  - The action is enabled when either a part note or source model path is available.
  - Generated analysis preserves `sourceModelPath` for matched registered parts.
  - The UI stays compact on narrow panes.
- Verification:
  - `npm run typecheck`
  - `npm run verify:knowledge-index`
  - `node scripts/verify-preview.mjs --mode workbench --allow-workbench-three`
  - `npm run verify:preview:success` for full route coverage when changing broader preview behavior.

### REQ-008: Real Obsidian Smoke Verification

- Status: Verified
- Priority: P1
- User value: Release candidates should be proven inside the real Obsidian app, not only browser or Node shims.
- Current behavior:
  - The verifier installs the packaged plugin assets into a temporary vault.
  - It opens a note with GLB, STL, and intentional FBX conversion-failure previews.
  - It verifies rendered preview canvases, converter feedback, direct file workbench routing, control interactions, diagnostics command availability, and knowledge-note generation.
  - `--clean` removes the temporary vault after the run.
- Verification:
  - `npm run verify:obsidian -- --clean`

### REQ-009: Direct View Workbench Reliability

- Status: Verified
- Priority: P0
- User value: Direct file view should be the dependable place to inspect a model, add annotations, take measurements, generate knowledge notes, and inspect registered part reuse without caring which renderer backend was selected.
- Scope:
  - Direct file view layout, loading, failure, fallback, and teardown behavior.
  - Direct view annotation mode and mobile scroll/interact mode.
  - Direct view measurement toolbar actions.
  - Direct workbench sidebar knowledge status and registered part match rows.
  - Route correctness for Three.js direct formats and Babylon.js conservative paths.
- Out of scope:
  - Removing Babylon.js.
  - Moving `3dgrid` to Three.js.
  - Broad production workbench migration beyond the guarded Experimental Three workbench route.
- Acceptance criteria:
  - Direct GLB/GLTF/STL/PLY/OBJ paths load through Three.js when settings allow.
  - Converted STEP/FBX/3MF/DAE paths keep conservative fallback behavior.
  - Failed converter paths show clear UI feedback and do not leave dead canvases.
  - Annotation add/edit/delete still updates `modelAssetProfiles`.
  - Registered matches refresh after knowledge note generation.
  - Mobile direct view keeps scroll/interact mode understandable and reversible.
- Verification:
  - `npm run typecheck`
  - `npm test`
  - `npm run verify:preview`
  - `npm run verify:preview:success`
  - `npm run verify:obsidian -- --clean`
- Related files:
  - `docs/0.6.0-plus-upgrade-plan.md`
  - `src/view/direct-view.ts`
  - `src/view/direct-view-routing.ts`
  - `src/render/preview/routing.ts`
  - `src/view/inline/helper-buttons.ts`

### REQ-010: Measurement Workflow Completion

- Status: Verified
- Priority: P1
- User value: Users should be able to measure model distances repeatedly, calibrate units, keep completed records visible, and copy measurements into Markdown notes.
- Scope:
  - Shared measurement math, unit normalization, labels, and Markdown export.
  - Three.js and Babylon.js measurement behavior.
  - Toolbar actions for measure, clear, copy, and calibration.
  - Preview harness coverage for completed and cancelled measurements.
- Out of scope:
  - Persisting measurements in `data.json`.
  - CAD-grade tolerancing or dimension constraints.
- Acceptance criteria:
  - `supportsMeasurementPreview()` returns true only when the full measurement contract is available.
  - Three.js and Babylon.js produce equivalent reading/export formats.
  - Completed measurements remain visible when measurement mode is turned off.
  - Unfinished endpoints cancel cleanly.
  - Copy/export behavior handles empty records without throwing.
  - Measurement labels update after camera movement and resize.
- Verification:
  - `npm run typecheck`
  - `npm test -- --run src/render/preview/measurement.test.ts`
  - `npm run verify:preview`
  - `npm run verify:preview:success`
- Related files:
  - `src/render/preview/measurement.ts`
  - `src/render/preview/types.ts`
  - `src/render/three/scene.ts`
  - `src/render/babylon/scene.ts`
  - `src/view/inline/helper-buttons.ts`

### REQ-011: Renderer Capability Contract Coverage

- Status: Verified
- Priority: P1
- User value: Toolbar actions should only appear when the selected renderer truly supports them, and Three.js/Babylon.js capability drift should be caught before release.
- Scope:
  - Capability guards in `src/render/preview/types.ts`.
  - Preview factory and route decisions that choose renderer backends.
  - Harness or unit coverage for toolbar-visible capabilities.
- Out of scope:
  - Changing route policy without updating `docs/preview-routing-matrix.md`.
  - Making every renderer implement every optional capability.
- Acceptance criteria:
  - Capability checks cover every toolbar action that can be shown.
  - Three.js and Babylon.js preview objects satisfy the expected direct-view capability set.
  - Missing optional methods hide their controls instead of throwing.
  - Route changes update both code and route docs.
- Verification:
  - `npm run typecheck`
  - `npm test`
  - `npm test -- --run src/render/preview/types.test.ts`
  - `npm run verify:preview:success`
- Related files:
  - `src/render/preview/types.ts`
  - `src/render/preview/factory.ts`
  - `src/render/preview/selection.ts`
  - `src/view/inline/helper-buttons.ts`
  - `docs/preview-routing-matrix.md`

### REQ-012: Converter Diagnostics And Safety

- Status: Verified
- Priority: P1
- User value: When conversion fails, users should see an actionable explanation without exposing private local command paths in copied diagnostics.
- Scope:
  - Converter discovery, error classification, timeout handling, and diagnostics.
  - Cache reuse decisions for existing `.ai3d-converted.glb` files.
  - Sanitized support reports.
- Out of scope:
  - Bundling heavy converter binaries.
  - Mobile conversion support.
- Acceptance criteria:
  - Missing converter UI tells the user which converter id is required.
  - Timeout does not block preview indefinitely.
  - Existing `.ai3d-converted.glb` is reused only when newer than source.
  - Unsafe converter command paths are rejected before execution.
  - Diagnostics omit draft service URL and converter command paths.
  - Diagnostics redact vault-relative paths unless explicitly requested.
- Verification:
  - `npm run typecheck`
  - `npm test -- --run src/io/conversion/command-discovery.test.ts`
  - `npm test -- --run src/io/conversion/manager.test.ts`
  - `npm test -- --run src/io/cache/converted-asset-cache.test.ts`
  - `npm test -- --run src/io/conversion/adapters/freecad-converter.test.ts`
  - `npm test -- --run src/io/conversion/adapters/freecad-script-builder.test.ts`
  - `npm test -- --run src/diagnostics/report.test.ts`
  - `npm run verify:diagnostics`
- Related files:
  - `src/io/conversion/errors.ts`
  - `src/io/conversion/command-discovery.ts`
  - `src/io/conversion/conversion-service.ts`
  - `src/io/cache/converted-asset-cache.ts`
  - `src/diagnostics/report.ts`

### REQ-013: Knowledge Generation State Consistency

- Status: Verified
- Priority: P0
- User value: Knowledge-note generation should leave understandable state whether it succeeds fully, partially writes artifacts, or fails.
- Scope:
  - Pending, failed, and success state transitions.
  - Report, analysis sidecar, knowledge index, preview snapshot, and part note writes.
  - Local draft and optional remote draft behavior.
  - Preservation of user-written index content outside managed markers.
- Out of scope:
  - Raw model upload to remote services.
  - Replacing Markdown artifacts with a database.
- Acceptance criteria:
  - `lastKnowledgeGeneration` is set to `pending` before artifact writes.
  - Failed sidecar/report/index writes set `failed` with warning count.
  - Success updates profile paths and registered parts from the final analysis object.
  - Stale pending generation is surfaced in the next run.
  - Remote draft cannot include raw model bytes.
  - Geometry and preview references are stripped unless explicitly enabled.
  - User-written index notes survive managed-section refreshes.
- Verification:
  - `npm run typecheck`
  - `npm test -- --run src/view/workbench/knowledge-note.test.ts`
  - `npm test -- --run src/view/workbench/remote-draft.test.ts`
  - `npm run verify:knowledge-index`
  - `npm run verify:remote-draft`
- Related files:
  - `src/view/workbench/knowledge-note.ts`
  - `src/view/workbench/analysis-result.ts`
  - `src/view/workbench/remote-draft.ts`
  - `src/store/plugin-store.ts`

### REQ-014: Coordinator Class Decomposition

- Status: In Progress
- Priority: P2
- User value: The project should become easier to change safely by shrinking the largest coordinator classes without changing behavior.
- Scope:
  - `DirectModelView` layout/sidebar/loading/annotation extraction.
  - Three.js scene facade extraction.
  - Babylon.js scene facade extraction.
  - Shared measurement, evidence, selection, and disposal helpers where practical.
- Out of scope:
  - Behavior changes hidden inside refactors.
  - Renderer route policy changes.
  - New frameworks or build systems.
- Acceptance criteria:
  - `createThreeModelPreview()` and `createBabylonModelPreview()` keep the same exported signatures.
  - `ModelPreview`, `AnnotationPreview`, and `WorkbenchPreview` behavior remains unchanged.
  - Direct view route behavior remains unchanged unless intentionally documented.
  - Disposal audit still reports model-switch and destroy cleanup.
  - Refactor commits are separated from feature commits.
- Verification:
  - `npm run typecheck`
  - `npm test`
  - `npm test -- --run src/view/direct-workbench-panel.test.ts`
  - `npm test -- --run src/render/three/mesh-preview.test.ts`
  - `npm run verify:preview`
  - `npm run verify:preview:success`
- Related files:
  - `src/view/direct-view.ts`
  - `src/view/direct-view-layout.ts`
  - `src/view/direct-workbench-panel.ts`
  - `src/render/three/scene.ts`
  - `src/render/three/mesh-preview.ts`
  - `src/render/babylon/scene.ts`
  - `src/render/preview/types.ts`

### REQ-015: Three.js Capability Tree And Visual Fidelity

- Status: Verified
- Priority: P1
- User value: Three.js should feel like the high-quality single-model viewing path, not just a lighter fallback, for common direct formats.
- Scope:
  - GLB/GLTF/STL/PLY/OBJ direct-format rendering quality.
  - Preview capability profiles and Three.js quality snapshots.
  - Color pipeline, texture color-space handling, point-cloud sizing, camera precision, small-part visibility, and interaction smoothness.
  - Diagnostics and preview verification for quality regressions.
- Out of scope:
  - Removing Babylon.js.
  - Moving `3dgrid` to Three.js.
  - Broad production workbench migration.
  - Remote model processing or upload.
- Acceptance criteria:
  - Three.js exposes a quality snapshot with supported formats, color pipeline, geometry/small-part stats, camera precision, and performance budget data.
  - Three.js exposes rendered frame count, idle skip count, average/p95/max render timings, slow-frame count, and adaptive scale changes.
  - Pointer, wheel, and orbit interactions enter the interactive pixel-ratio path before the next frame renders.
  - Diagnostics explain the active route capability profile.
  - STL and PLY vertex colors are preserved on the Three.js path.
  - PLY point clouds use model-scale-aware point sizes.
  - OBJ color textures use sRGB without forcing non-color maps into sRGB.
  - Tiny model camera fit uses the real model span instead of a unit-size floor.
  - Color, small-part, and smoothness snapshot checks are covered by the preview success suite.
- Verification:
  - `npm run typecheck`
  - `npm test`
  - `npm run verify:preview`
  - `npm run verify:preview:success`
  - `npm run verify:diagnostics`
  - `npm run build`
  - `npm run verify:release`
- Related files:
  - `src/render/preview/capabilities.ts`
  - `src/render/preview/types.ts`
  - `src/render/three/loaders.ts`
  - `src/render/three/scene.ts`
  - `scripts/verify-preview.mjs`

## New Requirement Template

```md
### REQ-000: Requirement Name

- Status: Accepted
- Priority: P2
- User value:
- Scope:
- Out of scope:
- Acceptance criteria:
  - 
- Verification:
  - 
- Related files:
  - 
```

## Review Rules

- Update this tracker when product scope, route policy, release gates, or acceptance
  criteria change.
- Keep implementation details in source/docs; keep this file focused on what must remain
  true and how to verify it.
- Before release, every P0 requirement should be `Verified` or intentionally documented
  as `Deferred`/`Dropped`.
