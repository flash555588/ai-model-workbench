# Usage Guide

This guide explains the everyday workflows for AI Model Workbench. For copy-paste
Markdown snippets, see [Common Usage Syntax](common-usage-syntax.md).

## Choose A Preview Surface

| Surface | Best for | Renderer contract |
|---------|----------|-------------------|
| Wikilink embed | Quick inline model previews in notes | Three.js for `GLB/GLTF/STL/PLY/OBJ` |
| `3d` code block | A single model with explicit camera, lights, or scene options | Three.js for direct single-model formats |
| `3dgrid` code block | Comparing multiple models or using layout presets | Babylon.js grid backend |
| Direct file view | Inspecting, annotating, measuring, snapshotting, and generating notes from one model | Three.js for direct formats; conservative fallback for converted/workbench paths |

Use direct formats when possible: `GLB`, `GLTF`, `STL`, `PLY`, and `OBJ`.
Desktop conversion can prepare `STEP`, `STP`, `IGES`, `IGS`, `BREP`,
`SLDPRT`, `3MF`, `DAE`, and `FBX` as local GLB preview assets when the matching
external tools are installed.

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

The default direct route uses Three.js for `GLB/GLTF/STL/PLY/OBJ`. Converted
formats and conservative workbench paths keep Babylon.js fallback behavior unless
an explicit experimental Three workbench path is enabled.

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
- For very small parts, rely on the current Three.js camera and marker scaling
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
only sanitized drafting input to the configured `POST /draft-note` endpoint.
Raw model upload is blocked.

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
