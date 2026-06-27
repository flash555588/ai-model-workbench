# Common Usage Syntax

This page is a copy-paste reference for model embeds, `3d` blocks, `3dgrid`
blocks, and common scene options.

## Wikilink Embeds

Use Obsidian embeds for quick inline previews.

```markdown
![[model.glb]]
![[model.glb|400x300]]
![[Assets/3D/board.step]]
```

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
| Converted on desktop | `.step`, `.stp`, `.iges`, `.igs`, `.brep`, `.sldprt`, `.3mf`, `.dae`, `.fbx` |

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
| `Esc` | Exit annotation mode |
