# Usage Guide

This guide explains the everyday workflows for AI Model Workbench. For copy-paste
Markdown snippets, see [Common Usage Syntax](common-usage-syntax.md).

## Insert Without Writing Syntax

Place the cursor in a note, open the command palette and run **Insert a 3D model
in note**, or use the same action in the editor's right-click menu. Choose a file
and press Enter. Default dimensions follow the location:

| Location | Default | Usage rule |
|----------|---------|------------|
| Inside text, lists or quotes | 240 × 180 | Insert an image-style preview without moving surrounding text. |
| Table cell | 160 × 120 | Escape the size separator automatically to retain the columns. |
| Blank line or empty list/quote item | 400 × 300 | Insert a preview, or choose Registered parts for a saved part display. |

The picker shows the location and actual dimensions at the top. Search by file name or full vault path; rows retain names, paths and format labels to distinguish duplicate files. Options stack in narrow windows.

The picker offers small, medium and large presets. For saved part display, place
the cursor after any quote/list prefix on an empty line. Inside text and table
cells, use the preview's Parts button instead. Generated blocks preserve quote
and list nesting. When registration is missing, the preview offers Open model to
register parts and refreshes after registration. No extra empty-state dialog is
opened for a full note block.

Cancel leaves the note unchanged. Undo once restores the previous text. If the
note, content or selection changes while the picker is open, reopen the command
at the intended position. Code examples, note properties and table divider rows
are excluded. Existing hand-written embeds and advanced JSON remain supported.

## Registered Parts In Notes

Open the model first to register parts. In image-style embeds, use **Parts** to
toggle the inline catalog, **Expand** for presentation controls, and **Inspect parts**
for full inspection. The preview keeps its size and note placement.

Use a `3d` block to retain the presentation after reopening the note:

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/model.glb" }],
  "height": 300,
  "parts": { "display": "registered", "separation": 100 }
}
```
````

`"parts": true` is a catalog shorthand. Set `parts.part` to a registered part ID
or a unique exact name for one part; **Copy embed** copies a block with
the stable ID. Part spacing ranges from 0 (assembled) to 100 (catalog). Set
`parts.showUnregistered` to true to include geometry outside registered parts.
Missing or ambiguous part selection reports a warning and hides geometry rather
than silently selecting a different part. Controls do not edit the note; paste
the copied block to persist changes. Full inspection has its own temporary state;
returning restores the inline selection and separation.

## Choose A Preview Surface

| Surface | Best for | Renderer contract |
|---------|----------|-------------------|
| Wikilink embed | Quick inline model previews in notes | Babylon.js for `GLB/GLTF/STL/PLY/OBJ`; Three.js opt-in |
| `3d` code block | A single model with explicit camera, lights, or scene options | Babylon.js for direct single-model formats; Three.js opt-in |
| `3dgrid` code block | Comparing multiple models or using layout presets | Babylon.js grid backend |
| Direct file view | Inspecting, annotating, measuring, snapshotting, and generating notes from one model | Babylon.js for direct formats; Three.js fast path for converted GLB with Babylon fallback |

Use direct formats when possible: `GLB`, `GLTF`, `STL`, `PLY`, and `OBJ`.
Desktop conversion can prepare `STEP`, `STP`, `IGES`, `IGS`, `BREP`,
`SLDPRT`, `3MF`, `DAE`, and `FBX` as local GLB preview assets when the matching
external tools are installed.

Three.js opt-in also enables direct 3MF/DAE/OFF/PCD/XYZ previews. Enable
**Use Three renderer** and select **Reading + file view** to include file views,
or **Reading surfaces only** for embeds. PCD/XYZ require Three.js. FBX keeps
registered desktop conversion first and uses Three directly on mobile or when
no converter is registered. Explicit OBJ conversion preferences remain in effect.
Direct 3MF/DAE/FBX external textures must be converted to an embedded GLB first.

## Inspect Registered Parts

Open a model file and choose **Show registered parts** in the right sidebar. The
window resolves this model's existing registered nodes and mesh references,
arranges parts in a catalog grid, and keeps each part's geometry together. Search
names, hide/show parts, view one alone, adjust separation, or open linked notes.
**Restore assembly** restores positions; Return to model or Escape also restores
the camera captured before inspection.

Partial, missing and conflicting registrations remain explicit. Similarity scores
never determine geometry ownership. Unregistered geometry has a separate checkbox.
Generate a knowledge note if no parts are registered; direct-file view also
registers models suitable for automatic evidence capture. This feature cannot
infer physical seams to cut a single monolithic mesh into parts.

## Controls Inside Notes

Normal `![[model.glb|240x180]]` embeds behave like images in paragraphs, lists,
quotes, and tables while retaining surrounding text. Width alone (`|240`) uses
a default 4:3 viewport. Escape the separator in tables (`\|240x180`). Controls
appear on hover or keyboard focus as Reset/Expand/Parts. Expand moves the same preview
into a responsive inspection dialog, retaining camera and completed rulers while
reserving its original note footprint. Return to note exits active tools and restores
keyboard focus. Enter opens the viewer; advanced canvas shortcuts open their
inspection context first. Escape leaves a tool before closing the dialog.
Switch to source mode to edit dimensions. Both reading and Live Preview support
these placements; image-style embeds hide the model header.

Reading `3d` blocks retain their model header and compact
toolbar. Common view controls, Focus, Measure, and Pins are available directly;
More reveals named View, Inspect, and Export groups. An active advanced tool
remains visible when More collapses. The toolbar wraps in narrow note panes.

Pins only shows or hides saved annotations; it does not enter annotation editing
or interrupt inspection. Exit mode or Escape returns to browsing and preserves
completed measurements. Opening measurement details leaves competing inspection
modes. Live Preview controls leave the Markdown intact and omit Remove preview;
edit the embed syntax in source mode to remove it. Snapshots use current settings.

## Direct File View Workflow

Click a supported model file in the Obsidian file explorer to open the direct
viewer. This is the main review surface for single-model work.

Recommended flow:

1. Open the model file directly from the vault.
2. Check route/status feedback and model summary.
3. Rotate, pan, zoom, focus parts, toggle wireframe, and inspect the bounding box.
4. Add annotations or measurements when needed.
5. Capture a snapshot or copy model/part information as Markdown.
6. Generate a knowledge note when the model evidence is ready.

The default direct route uses Babylon.js compatibility mode for
`GLB/GLTF/STL/PLY/OBJ`; enable a Three.js rollout in settings to opt in. Converted
GLB outputs take a Three.js fast path with silent Babylon.js fallback while the
Converted GLB Three fast path setting is enabled, and conservative workbench paths
stay on Babylon.js unless the experimental Three workbench path is enabled.

## Annotations

Annotations are persistent model bookmarks. In direct file view:

1. Click the tag icon in the toolbar.
2. Click a point on the model surface.
3. Enter a label and choose a color.
4. Click an existing pin to edit or delete it.
5. Press `Esc` to leave annotation mode.

Saved annotations also appear as readonly overlays in note previews. Pins behind
geometry are dimmed with depth-aware occlusion so labels remain grounded in the
current camera view.

## Measurements

Use the measurement tool when the selected renderer exposes the measurement
contract. Measurements are calibrated, include per-axis deltas, and can be copied
as Markdown for notes.

By default, measurement covers the entire model so endpoints can be placed on
different parts. To restrict measurement to one component, focus that component
before enabling measurement; the measurement tool captures the focused scope and
then exits focus mode. Hold `Alt`/`Option` while placing an endpoint to use the
free surface pick backup.

Completed measurements render as orthographic drawing-style dimension callouts:
thin offset dimension lines, extension lines from the measured feature points,
arrowheads, and compact drafting labels.

To calibrate imported model scale, measure a known feature first, open the model
scale details from the measurement strip, choose the real-world unit, enter the
known length for the latest ruler, and apply it. The preview scales the loaded
model uniformly from that reference so later measurements use the calibrated
physical size.

Useful habits:

- Reset the view before measuring if the model is hard to frame.
- Use direct file view for repeated measurement work.
- Copy completed measurements into your analysis note before clearing them.
- For very small parts, rely on the renderer's camera and marker scaling
  instead of manually enlarging the model.

## Snapshots And Markdown Exports

Preview toolbars can copy or save evidence:

| Action | Output |
|--------|--------|
| Copy model info | Markdown summary with mesh, triangle, vertex, material, and bounding-size evidence |
| Copy selected part info | Markdown part summary after selecting a mesh or candidate part |
| Copy/save/download snapshot | PNG of the current viewport |
| Copy measurement | Markdown measurement records |

Snapshots are saved to `Media/3D Previews` by default.

## Knowledge Notes

Direct file view places knowledge actions first in the sidebar. Choose Generate
knowledge note initially; live status describes output checks, analysis, and file
writes. A failed run shows its reason and Retry generation in place, while saved
notes remain available. After success, Open index becomes the primary action;
Update knowledge note regenerates the artifacts. A stale pending record after
restart does not block retry.

Focus, disassembly, measurement, and annotation have visible labels and persistent
mode guidance. Backend and route details are under collapsed Renderer diagnostics.
Leaves at or below 640 CSS px use a stacked workspace layout.

Hide knowledge at the top left expands the viewport; Show knowledge restores the
sidebar. Drag its divider or focus it and use arrow keys to resize, Shift for
larger steps, and Home or double-click for the default width. More reveals named
extra actions.

Exit mode returns to browsing and retains completed rulers. Escape cancels a
pending endpoint first, then exits measurement; other modes exit from the canvas
or toolbar. Measurement hints follow start/end picking and the next ruler. Mobile
Scroll exits active inspection tools. Note-opening errors stay in the knowledge
area without changing generation success. Open actions disable for missing or
renamed outputs and recover when files return to the saved path.

The `Generate note` action writes an evidence-backed model knowledge set:

- Model report in `Analysis/3D Reports`.
- JSON analysis sidecar with preview summary, part candidates, warnings, and
  pipeline metadata.
- Knowledge index that links reports, sidecars, preview evidence, annotations,
  and part notes.
- Up to 8 first-pass part note drafts in `Parts/3D Components`.
- Viewport evidence snapshot in `Media/3D Previews`.
- Local editable draft sections grounded in captured evidence and profile notes.

Knowledge generation is local-only by default. Optional remote drafting sends
only sanitized drafting input to the configured HTTPS `POST /draft-note`
endpoint (HTTP is allowed only for loopback development). Vault paths, user
notes, tags, and note references are always removed. Raw model upload is blocked.

Generated output names retain the model basename when available. Same-named models or
unrelated existing files receive a stable suffix across the report, analysis sidecar,
index, and part folder. Existing part drafts are reused only for the same source model
and part ID; their edits and the index user notes remain intact.

Generation captures the model evidence and screenshot before asynchronous vault
reads, preserving the starting model if you switch views. A screenshot failure is
recorded as a warning. Once the required files are saved, failure to open the report
does not change generation success; you can open the saved report from its path.

## Part Evidence And Small Details

Part candidates come from renderer evidence rather than free-form guessing.

- Named `GLB/GLTF` nodes, groups, and `extras.ai3d` component metadata become
  higher-confidence part candidates.
- STEP conversion preserves XDE component labels when available, which helps
  PCB reference designators and CAD assembly children survive conversion.
- Semantically named small details, such as screws, pins, connectors, and
  component details, remain separate when evidence supports them.
- Generic tiny fragments are merged into a lower-confidence detail cluster to
  avoid over-splitting renderer noise.
- Reports, sidecars, draft input, part notes, and registered profiles preserve
  format lineage such as `STEP -> GLB (convert)` without storing converted
  absolute filesystem paths in notes.
- The direct workbench lists likely cross-model part matches. Use **Confirm** when
  the parts represent the same reusable component, **Not same** to exclude a false
  match from generated knowledge, or **Undo** to return the suggestion to pending.
  The review decision persists across reloads and report regeneration. Reviewed
  relationships appear first; use **Show all** when more than 12 candidates exist.

For best results when exporting from other software, preserve object names,
component hierarchy, material names, and assembly labels. Avoid merging every
mesh into one anonymous object if you want reliable small-part evidence.

## Conversion Workflow

Direct formats work without external tools. Converted formats require local
desktop dependencies:

| Format family | Tool |
|---------------|------|
| `STEP/STP`, `IGES/IGS`, `BREP` | Python + CadQuery/OCCT |
| `SLDPRT` | FreeCAD |
| `3MF`, `DAE` | Python + trimesh |
| `FBX` | FBX2glTF |
| Optional `OBJ` normalization | obj2gltf |

If conversion fails, open plugin settings and run converter diagnostics first.
Diagnostics distinguish missing commands, disabled converters, unsafe command
paths, timeouts, stale cache, and missing output while redacting sensitive local
paths in copied reports.

## Performance Tips

- Prefer `GLB/GLTF` for rich materials, hierarchy, and repeated viewing.
- Keep many unrelated previews out of the same note when possible.
- Use `3dgrid` for deliberate comparisons instead of stacking many single-model
  blocks.
- Lower render quality or render scale on weak GPUs.
- Use desktop Obsidian for conversion-heavy files.
- On mobile, use direct formats and expect reduced render resolution for smoother
  interaction.

## Troubleshooting

| Symptom | First check |
|---------|-------------|
| Model does not load | Confirm the file is inside the vault and the extension is supported. |
| GLTF is missing resources | Keep `.bin` and textures beside the `.gltf` or in the referenced relative folders. |
| OBJ textures are missing | Keep `.mtl` and texture files beside the OBJ; missing textures produce non-blocking warnings. |
| CAD conversion fails | Run converter diagnostics and verify the selected Python can import CadQuery/OCP or FreeCAD can launch. |
| Route seems wrong | Set log level to `info` or `debug` and check `backend`, `reason`, and `rendererRollout`. |
| Preview is slow | Reduce render quality/scale or use fewer simultaneous previews. |

For renderer route details, see [Preview Routing Matrix](preview-routing-matrix.md).
