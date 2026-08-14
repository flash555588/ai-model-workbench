# Changelog

## Unreleased

- Format: load 3MF, COLLADA (DAE), OFF, PCD, and XYZ directly in the Three.js renderer without external converters. The pipeline opts into the direct path when the resolved route uses Three.js; the Babylon path keeps the existing converter bridge for 3MF/DAE/OFF, and PCD/XYZ are Three-only.
- Settings: implement the Obsidian 1.13+ declarative settings API (`getSettingDefinitions`, `getControlValue`, `setControlValue`) so plugin settings appear in the Obsidian settings search; the imperative UI remains the fallback for Obsidian < 1.13.
- Maintainability: upgrade the `obsidian` API typings to 1.13.1 and enable the type-checked `no-unsafe-*` lint rules so local `npm run lint` matches the Obsidian review's linting.

## 0.7.8 - 2026-08-13

- Fix: sync `package-lock.json` transitive dependency resolution so the release passes the Obsidian review lockfile check.
- Docs: add the `0.7.7` release notes file that was published after the 0.7.7 tag.

## 0.7.7 - 2026-08-13

- Format: add OFF and Gmsh (msh) sources via the local Python/trimesh conversion bridge.
- Format: add Parasolid (x_t, x_b) and CATIA (catpart, catproduct) sources via the FreeCADCmd native-import bridge, generalizing the existing SolidWorks (sldprt) converter.
- Extensibility: make the format registry runtime-extensible with `registerFormatCapability`, `unregisterFormatCapability`, `resetFormatCapabilities`, and `getFormatCapabilities`. Custom formats can be added (or built-ins overridden) without editing the built-in list, and `directLoader` now accepts arbitrary loader identifiers.
- Extensibility: let `createConversionManager` accept `extraConverters` so custom converters can be registered at runtime alongside the opt-in built-ins.
- Extensibility: route direct-format loading through the registry. Both renderers now dispatch `loadModel` on `getDirectLoaderKind()` (`gltf`/`obj`/`stl`/`ply`) instead of duplicating per-extension switches, so the registry is the single source of truth for which loader handles which format.
- Cross-platform: add Linux FreeCAD AppImage discovery (scanning `~/Applications` and `~/Downloads` for `FreeCAD*.AppImage`) and a `freecad` console-binary fallback so the FreeCADCmd-based CAD converters are discoverable on more Linux installs; settings/env overrides remain highest priority.
- UI: show a one-time "drag to rotate · scroll to zoom · right-drag to pan" hint on inline `3d` previews, dismissed on the first interaction or after a few seconds.
- UI: show a floating filename + format badge on inline `3d` and `3dgrid` previews, hide it while an interaction mode is active, and expose the full vault path as its tooltip.
- Accessibility: mark the preview loading overlay with `role="status"`/`aria-live` and toggle `aria-busy` on the host, and add a keyboard focus ring to the tabbable preview canvas.
- UI: add a `grab`/`grabbing` cursor to inline `3d`, `3dgrid`, and Live Preview canvases so orbiting is obvious without entering a dedicated mode.
- Maintainability: deduplicate the registered-part rank function and the part field normalizers (`normalizePartSource`, `normalizeModelAssetFormat`, `normalizeModelLoadStrategy`) into `utils/registered-part-persistence.ts`, and deduplicate base64 data-URL decoding into `utils/base64.ts`.
- UI: smooth the interaction-mode highlight transition on the preview host.
- Fix: dispose Babylon helper materials (ground, grid, axis, bounding box) when their meshes are removed. These used `Mesh.dispose()` with default flags, so every toggle and measurement-scale rebuild leaked a fresh `StandardMaterial` into `scene.materials` for the lifetime of the preview.
- Fix: dispose Three.js `BoxHelper` geometry and material on selection/focus/bounding-box/measurement-target changes. `removeFromParent()` alone leaked a fresh `BufferGeometry` + `LineBasicMaterial` per change.
- Fix: restore the Babylon `OBJFileLoader.prototype._loadMTL` override in the `finally` block so a failed OBJ load no longer leaves a stale closure on the shared prototype for later loads.
- Fix: guard Babylon `destroy()` scene/engine disposal in `finally` so a throw from any controller's `dispose()` cannot strand the WebGL context.
- Privacy: stop the remote draft from sending the vault path, user notes, user tags, annotation labels, and heading references when geometry sharing is disabled; the model path is reduced to its basename.
- Fix: preserve the underlying read/parse error in Three.js OBJ material-library warnings instead of collapsing them into "not found".
- Fix: narrow `readHeadingSection`'s catch to the vault read so genuine failures are logged instead of silently returning the same value as an empty section.
- Fix: clear the heading-pin observer's scan timer when the mutation observer stops.
- Fix: align the Babylon network guard with the Three.js guard by refusing `ftp:` URLs, closing a security-boundary divergence.
- Maintainability: move the hand-synced renderer tuning constants (`FRAME_BUDGET_SLOW_MS`, focus animation duration, environment intensity) into a shared `src/render/preview/tuning.ts` so the two backends stop drifting via comments.
- Performance: keep the Babylon Slice overlay line systems alive and update their vertices in place via `MeshBuilder`'s `instance` option instead of disposing and reallocating ~11 line systems (rings, ticks, frame, guides) on every pointer-move frame. The variable-length rotation arc and arrowheads are still recreated since Babylon only allows position changes on a line instance.
- Performance: coalesce the Babylon measurement hover raycast to one per animation frame instead of running a synchronous `scene.pick` on every pointer-move event.
- Performance: reuse scratch `Vector3` buffers in the Three.js Slice drag delta calculation instead of allocating three vectors per pointer event.
- Knowledge: let users confirm, reject, or clear cross-model registered-part matches in the direct workbench. Review decisions persist separately from the transient match cache; confirmed reuse is promoted in reports and indexes, while rejected candidates are excluded from generated notes and drafting input without losing the ability to undo the decision.
- Knowledge: show cross-model part reuse as a reviewed-first multi-candidate queue instead of exposing only the top candidate for each part. The first 12 rows stay compact, a Show all action reveals the remaining suggestions, and lower confirmed or rejected relationships remain inspectable and undoable even when a higher-scoring pending candidate exists.
- Fix: frame Three.js models against the viewport aspect ratio instead of the vertical axis alone. On a pane narrower than it is tall the horizontal field of view is the limiting one, so a model fitted only vertically was clipped left and right — common in Obsidian split panes and sidebars.
- Fix: re-frame the Three.js default camera pose when the viewport aspect changes materially. Resizing a pane previously kept the original framing, so a model framed in a wide pane no longer fit after the pane was dragged narrow. The live camera is only moved when it is still at the previous default pose, so this never overrides a user who has orbited or zoomed, nor an explicit `camera:` block config. Reset View now restores the fitted clip range, authored near/far remain authoritative, and automatic poses refit after FOV or zoom config changes.
- Fix: keep `attachToCam` lights attached when the Three.js camera switches between perspective and orthographic. The old camera was discarded along with its children, so a camera-attached light went dark on the first mode switch and never came back.
- Fix: stop detaching Three.js `attachToCam` lights from the camera in `applyLightConfig()`. The light was parented to the camera at creation and then immediately re-added to the scene, which reset it to the camera's pose at that instant and left it frozen there.
- Fix: fit the Three.js orthographic frustum to the limiting viewport axis using a rotation-safe bounding-sphere span. The half-extents were derived from height alone, so a portrait viewport clipped the model horizontally — the same defect as the perspective path.
- Fix: set the Three.js camera clip planes before the first frame of a newly loaded model. The camera fit rendered a frame through `resetView()` while the previous model's near/far were still in place, so the opening frame could be clipped whenever the two models differed in scale.
- Fix: drive Three.js auto-rotation from the real frame delta instead of `OrbitControls`' implicit 60fps assumption, so rotation speed no longer varies with display refresh rate or scene load.
- Verification: cover Three.js portrait/landscape framing, user-moved camera preservation, Reset View clip restoration, orthographic bounds containment, camera-attached lights, and auto-rotation in the browser suite; dismiss Obsidian 1.13's external-link confirmation during the real-app verifier.
- Verification: read `scene.axis`, `stl.wireframe`, and `stl.color` back off a live Three.js scene in the browser suite, covering the gizmo/config arbitration in all four combinations, late axis-helper scaling, wireframe stand-in recoloring, and a GLB remaining unchanged when given an STL-only block. These block-config defects originally escaped because no automated check inspected style state on a running Three.js preview.
- Fix: apply `scene.autoRotate` on the Three.js preview. `OrbitControls` only advances auto-rotation from inside `controls.update()`, which the idle branch of the render loop skips, so an auto-rotating model sat still until the user dragged it and stopped again as soon as they let go.
- Fix: route Three.js `stl.wireframe` through `setWireframe()` instead of writing the material flag directly. The toolbar toggle previously read "off" while the model rendered as wireframe, and the next toggle layered override materials on top of the already-wireframed original.
- Fix: scope Three.js `stl:` block options to actual STL models, matching the Babylon path. A `stl:` section previously recolored and wireframed a GLB that happened to share the block config.
- Fix: recolor Three.js wireframe stand-ins when `setSTLColor()` runs while wireframe is active. The stand-in copied the color at creation time, so a color change only appeared after wireframe was turned off.
- Fix: stop the Three.js orientation-gizmo toggle and the `scene.axis` config from overwriting each other. They shared one visibility flag, so turning the gizmo off also hid an axis the block config had requested.
- Fix: dispose the Three.js axis helper on `destroy()`. Its geometry and material were never released.
- Fix: scale the Three.js axis helper to the model when it is created after the initial camera fit. Only `fitCameraToObject` resized the helper, but `applyConfig` runs after `loadModel`, so an `axis: true` block config — and the orientation-gizmo toggle — produced a fixed 1.2-unit helper that was invisible next to a large model and engulfed a small one.

- Security: refuse remote `http(s)`, `ws(s)`, and protocol-relative URLs on the Three.js glTF loader path, matching the existing Babylon network guard. Previously a `.gltf` referencing an external URI fell through to the default loader and triggered a real network request.
- Fix: dispose Three.js wireframe stand-in materials when wireframe is turned off, and restore original materials before model disposal. Toggling wireframe repeatedly leaked GPU materials, and switching models with wireframe active leaked the original materials and their textures permanently.
- Rendering: give the Babylon preview local image-based lighting and a fixed color pipeline so PBR materials show real specular reflection instead of rendering flat and grey. The environment is generated in memory, so it adds no network access. This affects the default preview path.
- Fix: make Babylon scene config reversible — toggling `grid`, `groundShadow`, or `axis` back to `false` now removes the helper instead of leaving it on screen, and clearing a custom light config restores default lighting instead of leaving the scene permanently unlit.
- Fix: expose `setSTLColor()` on the Three.js preview. STL color from an inline `3d` block was silently ignored whenever the Three.js renderer was active.
- Fix: stop advertising `splat` as a Babylon capability format. SPLAT/SPZ/SOG are disabled in packaged builds, so the diagnostics report claimed support that no route could deliver.
- Diagnostics: report frame timing, slow-frame counts, and viewport visibility from the Babylon preview instead of only render scale and mesh count, so the default backend has the same performance observability as Three.js.
- Consistency: align focus-point camera animation duration across both renderers (320 ms).
- Docs: correct the renderer contract in `CLAUDE.md`, `docs/usage-guide.md`, `docs/usage-guide.zh-CN.md`, and `REQ-001`, which still described Three.js as the default single-model preview path after `0.7.0` moved the default to Babylon.js compatibility mode with Three.js as an opt-in rollout.

## 0.7.6 - 2026-07-12

- Review: use `window.requestAnimationFrame()` and `window.cancelAnimationFrame()` for Babylon preview frame scheduling so Obsidian source review accepts the timer calls.

## 0.7.5 - 2026-07-12

- Stability: gate conversion-backed direct file views behind an explicit Load model action even when Obsidian restores them through `onLoadFile`, preventing STEP/STP workspace restore loops from freezing the vault.
- Stability: make the direct-view load gate settings-aware for preferred OBJ conversion and keep mobile direct-format reads on Obsidian vault APIs instead of desktop Node path helpers.
- UI: upgrade measurement calibration so users can scale the loaded model uniformly from the latest ruler distance, keep overlays anchored in model space, apply locked model-size scaling from one known axis, and verify the workflow through preview automation.
- UI: make distance measurement cover the entire model by default while allowing a previously focused component to limit the measurement scope, and snap endpoints to mesh vertices or visible crease/perimeter triangle edges with Alt/Option-click preserving the free surface pick backup.
- UI: restrict normal measurement picks and hover previews to the locked measurement target so clicks on neighboring geometry no longer seed selected-object snap endpoints.
- UI: require the locked measurement target to be the frontmost normal pick before snapping, preventing hidden target geometry behind another part from receiving ruler endpoints.
- UI: clear stale measurement snap status after cancelling a pending endpoint so the selected-object ruler returns to a neutral ready state.
- UI: keep the measurement strip in Free pick status while Alt/Option previewing the backup free ruler path, even when the pointer is over empty canvas space.
- UI: cap selected-object corner snapping by target edge scale so large grouped selections do not over-prioritize distant vertices when the pointer is closer to an edge.
- UI: reset snap status when measurements are cleared so the ruler strip does not report stale snapping after returning to an empty ready state.
- UI: refresh the measurement preview when Alt/Option is pressed or released so the backup free-pick path updates without requiring a mouse move.
- UI: refactor the Slice tool for Three.js and Babylon previews around a visible transparent cutting board with an adaptive red/green/blue rotation gizmo, a normal-axis move arrow, separate touch-capable move and rotate modes, world-horizontal centered reset, single-plane clipping, and a compact board status panel instead of X/Y/Z axis sliders.
- UI: keep camera orbit available while slicing by capturing pointer drags only near the center handle, move arrow, or colored rotation rings, with Alt/Option drag always reserved for the camera.
- UI: keep the Slice ruler, movable angle handle, cutting board, and pointer hit regions in one plane-local coordinate frame; compute rotation from mouse-ray intersection around the board center, preserve that center as the pivot, and provide coarse 45-degree plus fine 5-degree snapping.
- Performance: update Slice clipping planes in place while dragging and avoid rebinding or recompiling every model material on each pointer frame, preventing model flicker during cutting-board movement.
- Stability: freeze the Slice rotation ring's starting coordinate frame and pivot for the full pointer gesture so the already-rotated board cannot feed back into mouse-angle calculation and cause rotational twitching.
- Stability: stabilize Babylon Slice rotation by pausing camera inertia and auto-rotation during gizmo drags, falling back to screen-space rotation for edge-on rings, adding snap-zone hysteresis, coalescing pointer updates to animation frames, and reusing the angle label texture.
- UI: define Slice 0 degrees as the world-horizontal XZ plane, and make reset restore that plane through the placed model's world-bounds center at 50 percent instead of aligning it to the current camera.
- UI: add editable Slice position and X/Y/Z rotation fields modeled after plane controls, keep 0/0/0 as the world-horizontal pose, and synchronize numeric edits with the in-scene rotation rings in both renderers.
- UI: size the visible Slice cutting board from every model bounding-box corner projected into the board's local frame, with a minimum 10 percent margin so the board always extends beyond the model at any angle or offset.
- UI: unify annotation, focus, disassembly, measurement, and Slice as linked exclusive preview modes, synchronize toolbar and canvas mode feedback, preserve camera orbit and view overlays, and refresh Slice plus selection helpers after measurement calibration rescales the model.
- UI: make the Slice normal-axis rotation ring rotate the cutting board's local ruler and handle frame without moving the clipping plane, and reset displaced disassembly parts whenever focus, measurement, or Slice takes control.
- Compatibility: align Babylon focus blank-click preservation and direct disassembly shutdown with the existing Three.js interaction behavior.
- Performance: cache selected-target measurement snap candidates while measuring so hover previews do not repeatedly rebuild vertex and edge lists for the same object.
- Performance: validate selected-target measurement snap caches against target mesh signatures so transformed or updated geometry rebuilds snap candidates instead of reusing stale vertex and edge lists.
- UI: restyle distance measurements as orthographic drawing-style dimension callouts with extension lines, arrowheads, and compact drafting labels instead of thick freehand ruler lines.
- UI: remove the preview canvas native hover tooltip while preserving keyboard shortcut metadata for accessibility.
- UI: clarify render scale versus measurement scale by showing render resolution as percentages, syncing the toolbar to the active renderer budget, and applying the configured scale to `3dgrid`.
- UI: redesign the measurement tool around explicit ready, pick-end, and review states with a grouped inspector and Esc cancellation for pending endpoints.
- UI: keep measurement, focus selection, and disassembly pick modes mutually exclusive across Three.js and Babylon.js previews so toolbar state does not imply competing click actions.
- UI: improve in-scene ruler readability with larger contrast-backed measurement labels, brighter overlay geometry, and suppressed Babylon pick highlights while measuring.
- UI: trigger a blue focus aggregation pulse on the preview canvas when the measurement tool is activated.
- Settings: keep language selection as a native Obsidian dropdown while preserving immediate vault-local switching.
- Diagnostics: split the STEP/STP CAD converter self-check into granular CadQuery, trimesh, OCP STEP reader, and OCCT GLB writer probes, and document the recommended dedicated CadQuery environment setup.

## 0.7.1 - 2026-06-28

- Review: remove the disallowed `obsidianmd/prefer-create-el` disable directive, keep staged DOM creation detached without native `createElement`, tighten typed path-cache/buffer helpers, and replace the direct-view `!important` CSS override with a higher-specificity selector.
- Release: publish the Obsidian source-review cleanup as `0.7.1` without changing the `0.7.0` renderer routing, conversion behavior, STEP/CAD warnings, or generated-side-file contract.

## 0.7.0 - 2026-06-28

- Docs: expand README warnings for STEP/CAD conversion, external tools, large-model performance, generated side files, renderer-route differences, mobile limits, and optional remote drafting.
- Warning: STEP/STP, IGES, BREP, FBX, 3MF, DAE, and similar CAD/uncommon mesh assets remain conversion-backed workflows, not guaranteed direct-render formats; desktop converter setup and source-file complexity can still block preview.
- Warning: large converted GLB and PCB/assembly files can consume significant CPU, GPU, RAM, and disk I/O, so restored heavy direct views now require an explicit Load model action to reduce startup lockups.
- Warning: generated conversion side files, reports, JSON sidecars, snapshots, part IDs, dimensions, and model names can be large or sensitive; use the Auxiliary file folder intentionally and exclude those outputs from sync or Git when needed.
- Warning: external converters and optional remote drafting remain trust boundaries; converter commands should be verified locally, and remote draft requests should be enabled only when sanitized model evidence is acceptable.
- Settings: add a Converted GLB Three fast path toggle so conversion-backed direct file views can follow normal Babylon compatibility routing when users disable the fast path.
- Settings: add an Auxiliary file folder option so users can choose where generated conversion side files are stored, while the empty default keeps them under the Obsidian config folder.
- Performance: reuse relocated converted-asset cache records for moved STEP/FBX/etc. sources and route direct-file converted GLB outputs through a silent Three.js fast path with Babylon fallback.
- Performance: cancel stale direct-file preview load sessions during rapid model switches and dispose interrupted Three.js/Babylon.js GLB results before they can keep competing with the newest load.
- Routing: default all single-model preview surfaces to Babylon.js compatibility mode while keeping Three.js available as an explicit opt-in rollout.
- Stability: pause restored direct-file previews for large or conversion-backed models until the user clicks Load model, preventing workspace restore from locking the vault on startup.
- UI: redesign distance measurement as an inspector-toolbar readout with synced records, transparent in-scene dimension text, crosshair cursor feedback, and copy/clear/calibration actions folded into an internal toolbar details row.
- UI: add a draggable right-side camera zoom control to model previews and make wheel zoom less jumpy across Three.js, Babylon.js, and `3dgrid` views.
- Compatibility: write converted GLB outputs under the active Obsidian `Vault#configDir` instead of assuming the config folder is named `.obsidian`.
- Testing: add a multi-block `3dgrid` preview verification path that checks nonblank pixels and WebGL context-loss warnings.
- Stability: keep Babylon `3dgrid` warmup frames dirty briefly after model load so shader compilation cannot leave the first visible grid blank.
- Performance: release offscreen `3dgrid` Babylon engines and give grid canvases a stable default height so long demo notes avoid WebGL context loss and blank previews.
- UI: keep direct file view model canvases full-height by turning the workbench metrics panel into a compact overlay and marking the live Obsidian leaf so its file-view height chain fills the pane.
- Performance: overlap pre-parse render-budget checks with model file reads for direct, inline, and Live Preview single-model loads, shortening visible large-model loading waits without changing renderer routing.
- Performance: scale Three.js texture anisotropy by render quality so heavy textured models avoid max GPU sampling cost on low and medium budgets.
- Performance: resolve parent-directory GLTF/OBJ resource paths consistently across Windows, macOS, and Linux so external buffers/textures do not trigger wasted lookup work or under-budgeting.
- Performance: include external `.gltf` buffers and textures in pre-parse render budgeting so large resource-backed scenes start with safer quality settings.
- Performance: defer reading-mode `3d` and `3dgrid` code block runtime imports until the rendered block approaches the viewport, reducing workspace restore work for long notes with offscreen model blocks.
- Performance: deduplicate and limit concurrent Three.js `.gltf` external buffer/texture reads, reducing I/O and memory spikes for large resource-heavy models.
- Performance: reuse cached Three.js renderable indexes while disposing switched or closed models, reducing repeated scene-tree walks for large assemblies.
- Performance: cache Live Preview embed path resolution across editor scans and clear it on vault file changes, reducing workspace-open work for notes with many model embeds.
- Performance: lazy-load converter command discovery and conversion factory setup so direct GLB/GLTF/STL/PLY previews do not initialize converter adapters during plugin startup or direct-format preparation.
- Performance: reuse fresh converted GLB outputs before creating conversion managers so already-converted STEP/FBX/etc. models open without initializing converter adapters.
- Performance: load the conversion route service only when a model actually needs conversion, keeping direct GLB/GLTF/STL/PLY/OBJ preparation lighter.
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
- Performance: reuse cached Three.js renderable bounds across quality snapshots and part evidence, reducing repeated bounding-box walks on large assemblies.
- Performance: skip unused Three.js explode/disassembly reset work during model load and translate disassembly selection boxes during move drags, reducing large-assembly load and part-move stalls.
- Performance: reuse shared Three.js focus-dim materials across meshes with the same source material, reducing material churn when focusing parts in large assemblies.
- Performance: coalesce disassembly drag updates to animation frames and flush the final pointer position on release, reducing high-frequency transform work while moving parts in large assemblies.
- Performance: apply inline and Live Preview render quality before model loading so visible large embeds do not start their first frames at default high resolution.
- Performance: pre-budget direct, inline, and Live Preview render quality from model file size before parsing so very large GLB outputs avoid expensive first-frame resolution settings.
- Performance: avoid loading desktop Node path/file shims when render-budgeting normal vault-relative model paths, keeping direct preview preparation lighter across Windows, macOS, and Linux.
- Performance: make desktop Node filesystem/path/process shims require their backing modules lazily, reducing incidental startup work for vault-relative direct previews.
- Performance: defer Three.js geometry quality snapshots and direct-view registered-part match previews so large models become interactive before diagnostic and cross-model matching work runs.
- Performance: capture disassembly original transforms only for dragged parts and cache repeated Live Preview embed path resolution, reducing large-assembly interaction and workspace editor setup work.
- Performance: update Three.js focus selection incrementally so switching selected parts in large assemblies no longer restores and re-dims every mesh.
- Performance: prepare each unique Three.js material once during model load, avoiding repeated texture audit and anisotropy updates on shared-material large models.
- Performance: skip repeated Three.js texture scans when disposing shared materials during model switches, reducing large-model close/reload stalls.
- Performance: defer Three.js PMREM environment setup until after a model is visible and skip it for low-quality previews, reducing first-load GPU work for large models and multi-embed notes.
- Performance: avoid forcing an unchanged plugin `data.json` rewrite during unload; only pending dirty state is flushed.
- Performance: load inline preview modules in parallel and defer heading-pin DOM observers until the workspace layout is ready, reducing plugin startup work.
- Performance: add a short settle window between queued inline and Live Preview model loads so notes with multiple large visible embeds give Obsidian time to paint and process input between loads.
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
- Performance: keep conversion-backed GLB direct file views configurable with a Converted GLB Three fast-path toggle while preserving Babylon.js fallback and avoiding extra full-buffer copies during GLB parsing.
- Performance: cap automatic registered-part writes for highly fragmented models so large imports do not keep growing the plugin state file with low-value surface shards.
- Performance: normalize oversized saved registered-part lists on load, strip transient registered-match caches, and quickly persist the compact state so future workspace startup parses less data.
- Performance: avoid rewriting unchanged plugin state during startup or unload, reducing extra `data.json` disk I/O in large vaults.
- Performance: make direct-view registered-part match previews skip sidecar reads, cap current/candidate part samples, and reuse indexed match tokens to reduce large-model UI stalls.
- Performance: apply direct-file render quality settings immediately and automatically lower resolution/shadow cost for heavy and extreme model previews.
- Conversion: write new converted GLB outputs to the vault's Obsidian config folder under `ai-model-workbench/converted-assets` while continuing to reuse existing side-by-side `.ai3d-converted.glb` files.
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
