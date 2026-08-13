# Three.js Style And Scene-Config Parity Log

Working log for the Three.js style/config parity pass on branch
`codex/measurement-snap-tooltip-main`. Extends `REQ-015` (Three.js capability
tree and visual fidelity) into the block-config surface: `scene:` and `stl:`
options that Babylon.js honored but Three.js dropped or mis-applied.

A later session extended the same pass to camera framing and viewport handling;
see [Camera and viewport pass](#camera-and-viewport-pass).

> **Status: verified on 2026-08-04.** Unit, static, browser-harness, build, release-asset, and
> real-Obsidian checks now cover this pass. See
> [Verification status](#verification-status) for the exact matrix.

## Motivation

`REQ-015` measured Three.js fidelity for geometry, color pipeline, and frame
budget, but not for the declarative `3d` block config. Comparing
`ThreeModelPreview.applyConfig()` against `BabylonModelPreview.applyConfig()`
surfaced seven defects where the same block config produced different — or no —
results depending on the active backend. Because Babylon.js is the default route
and Three.js is opt-in, these only appeared for users who enabled the rollout.

## Changes

All changes are in `src/render/three/scene.ts` unless noted.

### 1. `scene.autoRotate` never rotated

`applySceneConfig()` set `controls.autoRotate = true`, but `OrbitControls` only
advances the rotation inside `controls.update()`, which the idle branch of
`renderNow()` skips when nothing is dirty. The model stayed still until the user
dragged it and stopped again as soon as they released.

Both inline surfaces feed this config (`view/inline/code-block.ts:359`,
`view/inline/live-preview.ts:313`), and the plugin exposes an `autoRotateDefault`
setting — so that setting silently did nothing on the Three.js path. Enabling
auto-rotate now marks the scene dirty to start the loop; `cameraMoved` stays true
while rotating, so `shouldContinueThreeRenderLoop()` keeps it alive.

### 2. `stl.wireframe` desynced the toolbar

`applySTLConfig()` wrote `stlMaterial.wireframe` directly, bypassing the
`wireframeEnabled` field. The toolbar toggle read "off" while the model rendered
as wireframe, and the next toggle built override materials on top of the
already-wireframed original. Now routed through `setWireframe()`.

### 3. `stl:` options applied to non-STL models

Babylon.js guards this with `loadedExt === "stl"` (`babylon/scene.ts:934`);
Three.js had no guard, so a `stl:` section recolored and wireframed a GLB that
happened to share the block config. Now matched.

### 4. `setSTLColor()` was invisible under wireframe

Wireframe stand-ins copy the material color when they are built, so a later color
change only appeared once wireframe was switched off. `setSTLColor()` now rebuilds
the stand-ins while wireframe is active.

### 5. Orientation gizmo and `scene.axis` overwrote each other

Both drove a single `axesHelper.visible` flag, and `isOrientationGizmoEnabled()`
read that same flag back. Turning the gizmo off also hid an axis the block config
had requested, and an `axis: false` config made the toolbar button report the
wrong state.

The gizmo request now lives in its own `orientationGizmoEnabled` field, and the
two inputs are resolved by `resolveAxisVisibility()` in the new
`src/render/preview/axis-visibility.ts`. That module is pure logic with no WebGL
dependency, so it is unit-testable in the existing node environment — unlike
`scene.ts` itself.

Babylon.js does not share this defect: its gizmo is a separate `OrientationGizmo`
overlay, not the axis meshes. The fix is Three-specific by design.

### 6. Axis helper leaked on `destroy()`

It was added to the scene but never released — no `geometry.dispose()`, no
material disposal. Added `disposeAxisHelper()`.

### 7. Axis helper was never scaled when created late

Found while auditing change 5. The helper is built at a fixed 1.2 units and only
`fitCameraToObject()` ever rescaled it — but `applyConfig()` runs *after*
`loadModel()`, so an `axis: true` block config created the helper after the camera
fit and left it at 1.2 units: invisible beside a large model, engulfing a small
one. The gizmo toggle had the same problem, since it can fire at any time.

`syncAxisHelper()` now scales on creation. The duplicated math moved into
`scaleAxisHelperToModel(rootBounds?)`, which takes the bounds so the camera-fit
path keeps using the explicit bounds it was passed rather than the cache.

## Files

| File | Change |
|------|--------|
| `src/render/three/scene.ts` | All seven fixes |
| `src/render/preview/axis-visibility.ts` | New — axis visibility arbitration |
| `src/render/preview/axis-visibility.test.ts` | New — covers both directions of the gizmo/config conflict |
| `CHANGELOG.md` | Seven `Unreleased` entries |

## Camera and viewport pass

A follow-up session audited camera framing and viewport handling on the same
branch. Seven further defects, all in `src/render/three/scene.ts` unless noted.

### 8. Framing ignored the viewport aspect ratio

`createPreviewPerspectiveCameraFit()` placed the camera at `modelSpan * 1.8`
regardless of viewport shape. That is only safe while the pane is wider than it
is tall: below an aspect of 1 the *horizontal* field of view is the narrower one,
so the model was clipped left and right. Obsidian panes are routinely dragged
into tall, narrow shapes, so this was a common case rather than an edge case.

The fit now solves `distance = radius / sin(limitingFov / 2)` against whichever
of the two frustum angles is tighter. The `aspect` option is opt-in — omitting it
preserves the old span-based framing, so the Babylon orbit-fit callers and the
`3dgrid` path are untouched.

### 9. Resizing a pane never re-framed the model

The camera was fitted once at load. Dragging a wide pane narrow afterwards left
the original framing, reproducing defect 8 without a reload.

`refitCameraForAspect()` now recomputes the default pose from `resizeRenderer()`.
Three guards keep it from fighting the user: it is skipped when a `camera:` block
config pinned the pose, skipped for orthographic cameras (whose framing lives
entirely in the frustum half-extents), and it only moves the *live* camera when
that camera is still sitting on the previous default. A user who has orbited or
zoomed keeps their view; only the reset pose is updated.

`shouldRefitForAspect()` gates on a 2% relative change, so the pixel-ratio and
render-scale paths that also call `resizeRenderer()` are no-ops here.

The stored reset pose now carries its fitted near/far range as well. Reset View
therefore restores one coherent fit instead of combining a reset position with
clip planes left over from a later camera state. Authored near/far values remain
authoritative, and automatic poses are force-refitted when a block changes FOV
or zoom even if the viewport aspect itself did not change.

### 10. `attachToCam` lights died on camera mode switch

`switchCameraMode()` builds a replacement camera and discards the old one. Lights
created by `attachToCam` are *children* of the camera, so they were discarded with
it — the light went dark on the first perspective/orthographic switch and never
returned. The children are now re-parented onto the replacement.

### 11. `attachToCam` lights were detached at creation

`createConfiguredLight()` parents the light to the camera, but `applyLightConfig()`
then re-added it to the scene whenever `light.parent !== this.camera`. Because
`Object3D.add()` removes the object from its previous parent, this silently undid
the attachment and froze the light at the camera's pose at that instant. The guard
is now `!light.parent`, which leaves already-parented lights alone.

Babylon has no equivalent defect: it assigns `l.parent = this.camera` and never
adds the light to the scene separately (`babylon/scene.ts:1047`).

### 12. Orthographic frustum had the same aspect blindness

`updateOrthographicFrustum()` derived `halfWidth` from `halfHeight * aspect`, so a
portrait viewport clipped the model horizontally — defect 8 in the other
projection. The height is now widened on portrait viewports so the span stays
visible on both axes. It uses the bounding-sphere diameter plus the shared fit
margin, so the fit remains valid while the model rotates. The two near-duplicate
frustum functions were also merged.

### 13. Auto-rotation speed tracked frame rate, not wall clock

`controls.update()` was called with no argument. `OrbitControls` then falls back to
`_twoPI / 60 / 60 * autoRotateSpeed` per *frame*, which assumes exactly 60fps — so
auto-rotation ran fast on a 144Hz display and slow on a heavy scene. The real
frame delta is now passed, clamped to `1/15`s so a backgrounded tab cannot jump
the model on return. At 60fps the behavior is identical to before.

This is adjacent to defect 1: that fix made auto-rotation *happen*, this one makes
it happen at the right speed.

### 14. First frame after a fit used the previous model's clip planes

Found while reordering `fitCameraToObject()` for defect 8. That function called
`resetView()` — which renders a frame synchronously — and only afterwards assigned
`camera.near`/`camera.far`. So the first frame of every newly loaded model was
drawn with the *previous* model's clip planes, which clipped the model whenever the
two differed in scale. The assignment now happens before `resetView()`.

`switchCameraMode()` carries `near` and `far` onto the replacement camera
(`scene.ts:2062`), so moving the assignment earlier is safe even when `resetView()`
swaps the projection.

The fitted clip planes are also saved as part of the initial camera state, while
explicit block-config near/far values are tracked separately and never replaced
by an automatic aspect refit.

### Files (camera and viewport pass)

| File | Change |
|------|--------|
| `src/render/three/scene.ts` | Defects 8-14 |
| `src/render/preview/camera-fit.ts` | Optional aspect-aware perspective fit |
| `src/render/preview/camera-fit.test.ts` | Aspect framing coverage |
| `src/render/preview/viewport-fit.ts` | New — pure aspect/frustum math |
| `src/render/preview/viewport-fit.test.ts` | New — covers both projections |
| `scripts/verify-preview.mjs` | Live camera, light, resize, reset, auto-rotation, and style-config assertions |
| `scripts/verify-preview-success.mjs` | Dedicated Three.js camera/viewport and style-config success cases |
| `scripts/verify-obsidian.mjs` | Obsidian 1.13 external-link confirmation handling |
| `CHANGELOG.md` | Seven further `Unreleased` entries |
The math lives in `viewport-fit.ts` rather than `scene.ts` for the same reason as
`axis-visibility.ts`: it is pure, so it is unit-testable without a GL context.

### Verification status (camera and viewport pass)

Verified in the browser harness on the live Three.js preview. The dedicated
`--verify-camera-viewport` case covers:

- portrait perspective fitting and movement of the untouched default camera;
- landscape resize updating Reset View without moving a user-adjusted camera;
- preservation of an explicitly authored position and look target during resize;
- restoration of the stored fitted near/far range by Reset View;
- portrait orthographic frustum containment for all eight model-bounds corners;
- camera-attached lights across perspective/orthographic switches; and
- wall-clock-driven auto-rotation advancing the camera.

The case is part of `npm run verify:preview:success`, not an optional local-only
probe. The pure fit math is also covered by `camera-fit.test.ts` and
`viewport-fit.test.ts`.

### Style-config live coverage

Defects 2-5 and 7 (the `scene.axis` / `stl.wireframe` / `stl.color` group) were
originally covered only by unit tests plus the broad render checks, because no
harness case read block-config state back off a live Three.js scene — which is why
they survived in the first place. A `--verify-style-config` case now closes that
gap on the STL fixture, since `stl:` options are format-scoped:

- `scene.axis` and the orientation-gizmo toggle in all four combinations, so
  neither input can erase the other's request (defect 5);
- the axis helper being scaled to the model when created after the camera fit,
  rather than left at its fixed 1.2-unit build size (defect 7);
- `stl.wireframe` driving both the rendered materials and the toolbar's reported
  state together, in both directions (defect 2);
- `stl.color` reaching the wireframe stand-ins while wireframe is active, and the
  underlying material keeping that color across the round trip (defect 4).

A separate `--verify-stl-config-scope` probe uses the GLB fixture to cover defect
3. It snapshots material identity, color, wireframe flags, the reported toolbar
state, and the STL-material reference before and after applying an `stl:` block;
the complete state must remain unchanged.

Both focused probes passed on 2026-08-04. The style case used the 91-unit STL
fixture, so its late-helper assertion distinguishes the scaled helper from the
old fixed 1.2-unit construction. Both cases are registered in
`verify:preview:success`, whose full matrix also passed after the additions.

## Verification status

Verified through 2026-08-04 with the repository's full relevant matrix:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run verify:diagnostics
npm run verify:preview
npm run verify:preview:success
npm run verify:release
npm run verify:obsidian -- --clean
```

Results: 46 unit-test files and 281 tests passed; lint, typecheck, build, release assets,
diagnostics, the base preview harness, and the complete preview-success matrix
passed. The focused Three.js camera/viewport case also passed independently after
adding the authored-pose resize assertion. The focused STL live-style and GLB
STL-scope probes passed independently as well.

The clean real-app smoke test passed on Obsidian 1.13.4 with the Three.js direct
GLB route active: the plugin loaded, preview canvases rendered nonblank content,
direct-view controls worked, 27 parts were discovered, and annotation,
measurement/interaction, knowledge, index, and diagnostics actions remained
available. The verifier now dismisses Obsidian's external-link confirmation so
the URI used to open the temporary vault cannot intercept later UI checks.

The four former manual framing/light checks are now executable browser assertions.
Manual visual review remains useful for subjective composition, but is no longer
the only evidence for camera containment or control preservation.

## Ongoing guardrail

- Keep the widened `REQ-015` block-config and camera acceptance criteria tied to
  `verify:preview:success` so future renderer changes cannot leave them green
  without exercising the Three.js route.
