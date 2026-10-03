# Common Usage Syntax

This page is a copy-paste reference for model embeds, `3d` blocks, `3dgrid`
blocks, and common scene options.

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

## Wikilink Embeds

Use Obsidian embeds for quick inline previews.

```markdown
![[model.glb]]
![[model.glb|400x300]]
![[model.glb|240]]
![[Assets/3D/board.step]]
```

Normal embeds can sit inside paragraphs, lists, quotes, and table cells.
`widthxheight` sets pixel dimensions; width alone uses a default 4:3 viewport.
Omitted sizes use 400x300, with width constrained by the parent. Controls appear
on hover or keyboard focus as Reset, Expand and Parts. Expand opens the full inspection
tools without reloading the model or shifting the note. Enter on the canvas also
opens it; Escape leaves a tool first, then closes the viewer. Edit sizes in source mode.

```markdown
Before ![[Assets/3D/model.glb|240x180]] after

- List item ![[Assets/3D/model.glb|180x120]]

> Quoted content ![[Assets/3D/model.glb|200x140]]

| Position | Model |
| --- | --- |
| Cell | ![[Assets/3D/model.glb\|160x120]] |
```

Escape the separator as `\|` in tables so Markdown does not create another
column. Code examples and frontmatter stay text. Short links resolve from the
source note, and ordinary image embeds are unchanged.

Use direct formats on mobile. Conversion-backed formats need desktop converter
tools unless an already converted `.ai3d-converted.glb` asset exists. New
converted outputs are stored under the vault's Obsidian config folder, typically
`.obsidian/ai-model-workbench/converted-assets`, so model folders stay clean.
Set Auxiliary file folder in plugin settings to choose a different vault folder.

## Minimal `3d` Block

Use one model path inside the code block.

````markdown
```3d
model.glb
```
````

With a vault folder:

````markdown
```3d
Assets/3D/model.glb
```
````

## `3d` Block With Options

Use JSON when you need camera, light, scene, size, or per-model options.

````markdown
```3d
{
  "models": [
    { "path": "Assets/3D/model.glb" }
  ],
  "camera": {
    "mode": "perspective",
    "fov": 30,
    "position": [5, 5, 5],
    "lookAt": [0, 0, 0]
  },
  "scene": {
    "grid": true,
    "axis": true,
    "autoRotate": false
  },
  "width": "100%",
  "height": 500
}
```
````

`3d` blocks are single-model previews. If `models` contains more than one
entry, only the first model is used and the console warns you to use `3dgrid`.

## Common `3d` Fields

| Section | Fields |
|---------|--------|
| `models[]` | `path` required, plus `color`, `wireframe` |
| `camera` | `position`, `lookAt`, `fov`, `mode`, `zoom`, `near`, `far` |
| `lights[]` | `type`, `color`, `intensity`, `position`, `target`, `castShadow`, `angle`, `penumbra`, `decay`, `groundColor` |
| `scene` | `background`, `transparent`, `autoRotate`, `autoRotateSpeed`, `groundShadow`, `grid`, `axis` |
| `stl` | `color`, `wireframe` defaults for STL files |
| top level | `width`, `height` |

Camera modes:

- `perspective`
- `orthographic`

Light types:

- `hemisphere`
- `directional`
- `point`
- `spot`
- `ambient`
- `attachToCam`

## Auto-Rotate And Grid

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/model.glb" }],
  "scene": {
    "autoRotate": true,
    "autoRotateSpeed": 0.3,
    "grid": true,
    "axis": true,
    "groundShadow": true
  }
}
```
````

## Orthographic Preview

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/part.stl" }],
  "camera": { "mode": "orthographic" },
  "scene": { "grid": true, "axis": true }
}
```
````

## STL Color Override

````markdown
```3d
{
  "models": [
    { "path": "Assets/3D/part.stl", "color": "#44aa88" }
  ],
  "scene": { "autoRotate": true }
}
```
````

## Wireframe Preview

````markdown
```3d
{
  "models": [
    { "path": "Assets/3D/model.glb", "wireframe": true }
  ],
  "scene": { "background": "#000000" }
}
```
````

## `3dgrid` Compare

Use `3dgrid` for multi-model layouts. It is intentionally backed by Babylon.js.

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/design-v1.step" },
    { "path": "Assets/3D/design-v2.step" }
  ],
  "preset": "compare",
  "rowHeight": 420
}
```
````

## `3dgrid` Gallery

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/bolt-m6.glb" },
    { "path": "Assets/3D/bolt-m8.glb" },
    { "path": "Assets/3D/washer-m6.glb" },
    { "path": "Assets/3D/washer-m8.glb" }
  ],
  "preset": "gallery",
  "columns": 2,
  "rowHeight": 320
}
```
````

## `3dgrid` Compose

````markdown
```3dgrid
{
  "models": [],
  "preset": "compose",
  "direction": "horizontal",
  "sections": [
    {
      "preset": "compare",
      "models": [
        { "path": "Assets/3D/housing.step" },
        { "path": "Assets/3D/lid.step" }
      ],
      "weight": 1
    },
    {
      "preset": "showcase",
      "models": [
        { "path": "Assets/3D/assembly.step" }
      ],
      "weight": 1
    }
  ]
}
```
````

## `3dgrid` Fields

| Field | Purpose |
|-------|---------|
| `models` | Model paths or model config objects |
| `preset` | `compare`, `showcase`, `explode`, `timeline`, `gallery`, or `compose` |
| `params` | Preset-specific numeric/string/boolean options |
| `sections` | Required for custom `compose` layouts |
| `direction` | `horizontal` or `vertical` compose layout |
| `columns` | Gallery/grid column count |
| `rowHeight` | Cell height in pixels or `auto` |
| `gapX`, `gapY` | Horizontal and vertical spacing |
| `camera`, `lights`, `scene` | Same shape as `3d` blocks |

## Supported Extensions

| Type | Extensions |
|------|------------|
| Direct | `.glb`, `.gltf`, `.stl`, `.obj`, `.ply` |
| Three.js opt-in direct | `.3mf`, `.dae`, `.off`, `.pcd`, `.xyz`; `.fbx` without a registered converter or on mobile |
| Converted on desktop | `.step`, `.stp`, `.iges`, `.igs`, `.brep`, `.sldprt`, `.3mf`, `.dae`, `.fbx` |

Enable **Use Three renderer** and **Reading + file view** for the additional
direct formats; **Reading surfaces only** enables embeds. PCD/XYZ require Three.
Explicit OBJ conversion and registered desktop FBX conversion retain priority.
Direct 3MF/DAE/FBX textures must be embedded; convert external textures to GLB.

SPLAT preview is disabled in packaged community builds until its loader can be
restored as a local-only implementation.

## Preview Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Reset view |
| `W` | Toggle wireframe |
| `G` | Toggle orientation gizmo |
| `B` | Toggle bounding box |
| `Space` | Play or pause animation |
| `M` | Toggle measurement |
| `Esc` | Cancel a pending measurement point, then exit the active mode; on More, collapse extra actions |

Preview shortcuts apply when the canvas has focus. Escape also works in its
toolbar; annotation editors keep their own Escape behavior.
