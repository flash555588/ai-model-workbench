# Preview Routing Matrix

## Purpose

This document is the routing reference for the current mixed renderer setup.
Use it to answer two questions quickly:

1. Which renderer should a surface use right now?
2. What smoke test should confirm that route?

---

## Current Routing

The table below assumes the default rollout setting: `Reading + file view (Recommended)` (`three-direct-glb`).

| Surface | Input / capability | Renderer | Current rule |
|---------|--------------------|----------|--------------|
| Inline `3d` | `GLB/GLTF/STL/PLY/OBJ` with no annotations | Three.js | `ext ∈ THREE_FORMATS`, `annotationMode=none`, `requireWorkbenchFeatures=false` |
| Inline `3d` | `GLB/GLTF/STL/PLY/OBJ` with readonly annotations | Three.js | `ext ∈ THREE_FORMATS`, `annotationMode=readonly`, `requireWorkbenchFeatures=false` |
| Inline `3d` | `SPLAT` or other unsupported formats | Babylon.js | formats not in `THREE_FORMATS` route to Babylon |
| Live Preview embed | `GLB/GLTF/STL/PLY/OBJ` with no annotations | Three.js | same as inline simple preview |
| Live Preview embed | readonly annotations present | Three.js | readonly annotations use the Three annotation provider |
| Direct file view | `GLB/GLTF/STL/PLY/OBJ` single-model edit view | Three.js | `ext ∈ THREE_FORMATS`, `annotationMode=edit`, `allowEditModeOnThree=true` |
| Direct file view | `SPLAT` or other unsupported formats | Babylon.js | formats not in `THREE_FORMATS` direct view still routes to Babylon |
| Workbench | any current model | Babylon.js | `requireWorkbenchFeatures=true`; retained on Babylon after phase-3 evaluation |
| `3dgrid` | compare / gallery / compose / preset layouts | Babylon.js | retained on Babylon after phase-4 decision |

`THREE_FORMATS` = `{glb, gltf, stl, ply, obj}` — defined in `src/render/preview/routing.ts`.

---

## Route Reasons

The runtime route decision is intentionally conservative:

- Three.js is the fast path for all common single-model formats (GLB, GLTF, STL, PLY, OBJ) across reading surfaces and direct view, including annotation overlays.
- Babylon.js remains the intentional capability path for:
  - workbench edit annotations and features
  - grid layouts
  - SPLAT format
  - conversion-backed formats (via GLB pipeline)

The shared route helper lives in `src/render/preview/routing.ts`.
The phase-3 / phase-4 decision note lives in `docs/workbench-3dgrid-feasibility-note.md`.

## Rollout Control

The plugin exposes a `Preview compatibility mode` setting:

- `Compatibility mode` (`babylon-safe`)
  - inline `3d` -> Babylon.js
  - Live Preview embed -> Babylon.js
  - direct file view -> Babylon.js
- `Reading surfaces only` (`three-readonly-glb`)
  - inline `3d` -> Three.js
  - Live Preview embed -> Three.js
  - direct file view -> Babylon.js
- `Reading + file view (Recommended)` (`three-direct-glb`)
  - inline `3d` -> Three.js
  - Live Preview embed -> Three.js
  - direct file view -> Three.js

Workbench and `3dgrid` remain on Babylon.js regardless of this setting.

---

## Smoke Tests

Automated subset:

- `npm run verify:preview:success`

This automation covers:

- simple single-model `GLB`
- readonly saved-pin overlay
- direct file edit preview
- helper toolbar interactions
- stage-1 reading-surface rollout for direct view rollback
- compatibility-mode rollback for all single-model paths

Manual checks remain required for:

- workbench
- `3dgrid`
- non-GLB formats (STL, PLY, OBJ, GLTF)

### 1. Simple inline `GLB` -> Three.js

```3d
models/rubiks-cube-3x3.glb
```

Expected route log:

- scope: `inline-code-block`
- backend: `three`
- reason: `simple glb preview`

### 2. Inline `GLB` with saved pin -> Three.js

Precondition:

- the model profile already contains at least one saved annotation pin

Use the same block:

```3d
models/rubiks-cube-3x3.glb
```

Expected route log:

- scope: `inline-code-block`
- backend: `three`
- reason: `glb preview with readonly annotations`

### 3. Live Preview embed with no pin -> Three.js

```md
![[models/rubiks-cube-3x3.glb|420x320]]
```

Expected route log:

- scope: `inline-live-preview`
- backend: `three`

### 4. Direct file view -> Three.js

Open `models/rubiks-cube-3x3.glb` directly from the file explorer.

Expected route log:

- scope: `direct-view`
- backend: `three`
- reason: `glb direct view edit preview`

### 5. Non-GLB formats -> Three.js

Open STL, PLY, OBJ, or GLTF files via inline `3d` or direct view.

Expected route log:

- scope: `inline-code-block` or `direct-view`
- backend: `three`
- reason: `simple stl preview` / `simple ply preview` / etc.

### 6. Workbench -> Babylon.js

Open the workbench and load the same model.

Expected route log:

- scope: `workbench`
- backend: `babylon`
- reason includes `requireWorkbenchFeatures=true`

### 7. `3dgrid` -> Babylon.js

```3dgrid
{
  "models": [
    { "path": "models/rubiks-cube-3x3.glb" },
    { "path": "models/rubiks-cube-3x3.glb" }
  ],
  "preset": "compare",
  "height": 420
}
```

Expected route log:

- scope: `inline-code-block`
- surface: `3dgrid`
- backend: `babylon`

### 8. Rollback Smoke Test -> Babylon.js

Precondition:

- set plugin setting `Preview compatibility mode` to `Compatibility mode`

Use the same block:

```3d
models/rubiks-cube-3x3.glb
```

Expected route log:

- scope: `inline-code-block`
- backend: `babylon`
- reason includes `rendererRollout=babylon-safe`

---

## Logging

Set plugin log level to `info` or `debug`, then filter the developer console by:

- `[AI3D][inline-code-block]`
- `[AI3D][inline-live-preview]`
- `[AI3D][direct-view]`
- `[AI3D][workbench]`

Check `backend`, `reason`, and `rendererRollout` first.
These logs are the canonical route signal and should be checked before deeper rendering debugging.
