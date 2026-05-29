# AI 3D Model Workbench — Demo & Examples

This page walks through every feature of the plugin with copy-paste examples. Create a test vault, install the plugin, and follow along.

---

## Prerequisites

- Obsidian 1.5.0+ (desktop or mobile)
- Plugin installed and enabled
- At least one 3D model file in your vault

For the full demo, grab some test files:

| File | Format | Source |
|------|--------|--------|
| `DamagedHelmet.glb` | GLB | [KhronosGroup/glTF-Sample-Models](https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0/DamagedHelmet) |
| `StanfordBunny.stl` | STL | [Stanford 3D Scanning Repository](http://graphics.stanford.edu/data/3Dscanrep/) |
| `teapot.obj` | OBJ | [Utah Teapot](https://www.something.com) (any OBJ with MTL) |
| `cube.step` | STEP | Any CAD software export |

Place them in a folder like `Assets/3D/` in your vault.

---

## 1. Live Preview Embed

The simplest way to display a 3D model. Type a wiki-link with the `!` prefix:

```markdown
![[Assets/3D/DamagedHelmet.glb]]
```

The model renders inline in Live Preview mode (not Reading mode — use code blocks for Reading mode).

### Custom Size

```markdown
![[Assets/3D/DamagedHelmet.glb|400x300]]
![[Assets/3D/DamagedHelmet.glb|800x600]]
![[Assets/3D/StanfordBunny.stl|300x300]]
```

### Supported Extensions for Live Preview

All supported formats work: `.glb`, `.gltf`, `.stl`, `.obj`, `.ply`, `.splat`, `.fbx`, `.step`, `.stp`, `.iges`, `.igs`, `.brep`, `.sldprt`, `.3mf`, `.dae`. Formats such as `.fbx`, `.step`, `.iges`, `.brep`, `.sldprt`, `.3mf`, and `.dae` require their matching converter to be installed and enabled.

---

## 2. 3d Code Block

### Minimal — Just a Path

````markdown
```3d
Assets/3D/DamagedHelmet.glb
```
````

### With Custom Camera

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/DamagedHelmet.glb" }],
  "camera": { "mode": "perspective", "fov": 30 }
}
```
````

### With Auto-Rotate and Grid

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/DamagedHelmet.glb" }],
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

### Orthographic Camera

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/StanfordBunny.stl" }],
  "camera": { "mode": "orthographic" },
  "scene": { "grid": true, "axis": true }
}
```
````

### Custom Lights

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/DamagedHelmet.glb" }],
  "lights": [
    { "type": "point", "position": [10, 10, 10], "intensity": 1.5, "color": "#ffffff" },
    { "type": "point", "position": [-10, 5, -10], "intensity": 0.5, "color": "#8888ff" }
  ],
  "scene": { "background": "#0a0a1a" }
}
```
````

### STL with Color Override

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/StanfordBunny.stl", "color": "#44aa88" }],
  "scene": { "autoRotate": true }
}
```
````

### Wireframe Overlay

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/DamagedHelmet.glb", "wireframe": true }],
  "scene": { "background": "#000000" }
}
```
````

---

## 3. 3dgrid Code Block — Multi-Model Comparison

### Compare (Side-by-Side)

The most common preset. Shows two models next to each other:

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/design_v1.step" },
    { "path": "Assets/3D/design_v2.step" }
  ],
  "preset": "compare",
  "camera": { "mode": "perspective" }
}
```
````

### Showcase (Multi-Angle)

One model from multiple viewing angles:

````markdown
```3dgrid
{
  "models": [{ "path": "Assets/3D/DamagedHelmet.glb" }],
  "preset": "showcase",
  "camera": { "mode": "perspective" }
}
```
````

### Explode (Ring Arrangement)

Models arranged in a circle:

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/part1.glb" },
    { "path": "Assets/3D/part2.glb" },
    { "path": "Assets/3D/part3.glb" },
    { "path": "Assets/3D/part4.glb" }
  ],
  "preset": "explode"
}
```
````

### Timeline (Horizontal Strip)

Models displayed in chronological order:

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/iteration_2024_01.step" },
    { "path": "Assets/3D/iteration_2024_06.step" },
    { "path": "Assets/3D/iteration_2025_01.step" }
  ],
  "preset": "timeline",
  "camera": { "mode": "perspective" }
}
```
````

### Gallery (All in One Scene)

All models share one camera. No cell limit:

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/bolt_m6.glb" },
    { "path": "Assets/3D/bolt_m8.glb" },
    { "path": "Assets/3D/nut_m6.glb" },
    { "path": "Assets/3D/nut_m8.glb" },
    { "path": "Assets/3D/washer_m6.glb" },
    { "path": "Assets/3D/washer_m8.glb" }
  ],
  "preset": "gallery",
  "camera": { "mode": "perspective" }
}
```
````

### Compose (Custom Layout)

Combine multiple presets into sections:

````markdown
```3dgrid
{
  "models": [
    { "path": "Assets/3D/housing.step" },
    { "path": "Assets/3D/lid.step" },
    { "path": "Assets/3D/assembly.step" }
  ],
  "sections": [
    { "preset": "compare", "models": [0, 1], "region": { "x": 0, "y": 0, "w": 0.5, "h": 1 } },
    { "preset": "showcase", "models": [2], "region": { "x": 0.5, "y": 0, "w": 0.5, "h": 1 } }
  ]
}
```
````

---

## 4. CAD File Workflow

### STEP/STP (Mechanical Parts)

STEP files from any CAD software (SolidWorks, Fusion 360, FreeCAD, Siemens NX, CATIA) are supported:

```markdown
![[Assets/3D/engine_block.step]]
```

The plugin:
1. Reads the STEP file via CadQuery/OpenCASCADE
2. Extracts per-face colors via XDE (if present)
3. Triangulates all faces
4. Exports to GLB
5. Caches the result for subsequent loads

### IGES/IGS

```markdown
![[Assets/3D/turbine_blade.iges]]
```

IGES files are converted to GLB. No color extraction (geometry only, default gray).

### BREP (OpenCASCADE Native)

```markdown
![[Assets/3D/part.brep]]
```

BREP files are OpenCASCADE's native boundary representation format.

### SLDPRT (SolidWorks)

Requires FreeCAD installed. See [Third-Party Software Setup](../README.md#third-party-software-setup).

```markdown
![[Assets/3D/bracket.sldprt]]
```

The conversion pipeline:
1. FreeCAD imports the SLDPRT file
2. Exports to STEP as intermediate format
3. OpenCASCADE triangulates the geometry
4. trimesh exports to GLB

Timeout: 10 minutes (complex assemblies may take longer).

---

## 5. Direct File View

Click any supported 3D file in the file explorer sidebar. It opens in a dedicated viewer tab with full toolbar (rotate, zoom, pan, snapshots).

Supported for direct click: `.glb`, `.gltf`, `.stl`. All other formats open via the conversion pipeline.

---

## 6. Knowledge Notes

### Generate a Note

1. Load a model in the workbench (via code block or direct view)
2. Click the "Generate Note" button in the toolbar
3. A Markdown file is created in `Analysis/3D Reports/` (configurable)

### Example Output

```markdown
---
source_path: "Assets/3D/DamagedHelmet.glb"
format: "GLB"
file_size: "3.2 MB"
generated_at: "2025-05-08T12:00:00Z"
---

# DamagedHelmet — Model Info

| Property | Value |
|----------|-------|
| Meshes | 1 |
| Triangles | 32,584 |
| Materials | 1 |
| Bounding Box | 2.4 x 2.4 x 1.8 |

## Notes

Add your analysis notes here.
```

### Duplicate Detection

If a note with the same name already exists, the plugin skips creation to avoid overwriting your notes. Delete the existing note first if you want to regenerate.

---

## 7. Snapshots

### Copy to Clipboard

Click the copy button below any preview. The snapshot is copied as PNG. Paste into:
- Other Obsidian notes
- Discord, Slack, email
- Image editors

### Save to Vault

Click the save button. The PNG is saved to `Media/3D Previews/` (configurable in settings). Naming options:
- `model-name` → `DamagedHelmet_snapshot_1715123456789.png`
- `timestamp` → `snapshot_1715123456789.png`

### Download

Click the download button. The PNG downloads to your browser's download folder.

---

## 8. STL Color Rendering

Binary STL files with per-face colors (VisCAM/SolidView 15-bit encoding) are automatically detected:

```markdown
![[colored_scan.stl]]
```

The 2-byte attribute field is decoded: bit 15 = flag, bits 10-14 = blue, bits 5-9 = green, bits 0-4 = red (5 bits each, 0-31 scale → normalized to 0-1).

---

## 9. OBJ with MTL Textures

OBJ files with MTL material libraries render with textures resolved from the vault:

```markdown
![[Assets/3D/model.obj]]
```

The plugin:
1. Reads the MTL file referenced by `mtllib` in the OBJ
2. Resolves texture paths relative to the OBJ location
3. Searches multiple candidates (full path, basename, common names)
4. Loads textures from the vault

---

## 10. Performance Tips

### Resolution Scale

Lower the resolution for better performance on weak GPUs:

````markdown
```3d
{
  "models": [{ "path": "Assets/3D/heavy_model.glb" }],
  "scene": { "renderScale": 0.5 }
}
```
````

### Render Quality

Set quality in Settings or per-block:

- **high** — full resolution, shadow blur 32
- **medium** — 0.75x resolution, shadow blur 16
- **low** — 0.5x resolution, no shadow blur

### Mobile

On mobile devices, the plugin automatically lowers render resolution to preserve interaction smoothness. The Three.js path also applies a temporary pixel-ratio cap while the camera is moving, then restores quality after interaction settles.

### Large CAD Files

For STEP files > 50 MB, increase the timeout in settings and ensure sufficient RAM. CadQuery triangulation is CPU-intensive.

---

## 11. Troubleshooting

### "No mesh found in model file"

The file is empty, corrupted, or contains no renderable geometry. Verify the file opens in another 3D viewer.

### "ASCII STL detected — only binary STL is supported"

Convert your ASCII STL to binary using:
- FreeCAD: Import → Export as Binary STL
- MeshLab: File → Export Mesh As → STL (Binary)
- Online converters

### "CAD conversion failed — ensure Python with cadquery is installed"

Run `py -c "import cadquery"` to verify. If it fails:
```bash
py -m pip install cadquery trimesh
```

### "SLDPRT conversion failed — ensure FreeCAD is installed"

Download FreeCAD from [freecad.org/downloads](https://www.freecad.org/downloads.php). The plugin looks for `FreeCADCmd.exe`. If auto-discovery fails, set the path in Settings.

### Models appear black

Some CAD-converted models have inconsistent face normals. The plugin sets `backFaceCulling = false` on all materials to prevent invisible faces. If the model still appears black, check that lights are configured (the default hemisphere light should provide basic illumination).

### WebGL context limit

Browsers limit WebGL contexts to ~8-16. If you have many embeds on one page, the plugin reuses one engine per `3dgrid` block. For pages with many `3d` blocks, consider reducing the number of concurrent previews.
