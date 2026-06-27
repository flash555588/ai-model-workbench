# Preview Routing Matrix

## Purpose

This document is the routing reference for the current mixed renderer setup.
Use it to answer two questions quickly:

1. Which renderer should a surface use right now?
2. What smoke test should confirm that route?

---

## Current Routing

The table below assumes the default rollout setting: `Compatibility mode` (`babylon-safe`).

| Surface | Input / capability | Renderer | Current rule |
|---------|--------------------|----------|--------------|
| Inline `3d` | `GLB/GLTF/STL/PLY/OBJ` with no annotations | Babylon.js | default `rendererRollout=babylon-safe` |
| Inline `3d` | `GLB/GLTF/STL/PLY/OBJ` with readonly annotations | Babylon.js | default `rendererRollout=babylon-safe` |
| Inline `3d` | `SPLAT` or other unsupported formats | Babylon.js | formats not in `THREE_FORMATS` route to Babylon |
| Live Preview embed | `GLB/GLTF/STL/PLY/OBJ` with no annotations | Babylon.js | default `rendererRollout=babylon-safe` |
| Live Preview embed | readonly annotations present | Babylon.js | default `rendererRollout=babylon-safe` |
| Direct file view | `GLB/GLTF/STL/PLY/OBJ` single-model edit view | Babylon.js | default `rendererRollout=babylon-safe` |
| Direct file view | `SPLAT` or other unsupported formats | Babylon.js | formats not in `THREE_FORMATS` direct view still routes to Babylon |
| Direct file view | conversion-backed single-model output (`STEP`, `FBX`, `3MF`, `DAE`, etc. converted to `GLB`) | Three.js, Babylon fallback | generated GLB outputs take the Direct View fast path when `Converted GLB Three fast path` is enabled; load failure falls back to Babylon |
| Workbench | any current model | Babylon.js | `requireWorkbenchFeatures=true`; retained on Babylon after phase-3 evaluation |
| `3dgrid` | compare / gallery / compose / preset layouts | Babylon.js | retained on Babylon after phase-4 decision |

`THREE_FORMATS` = `{glb, gltf, stl, ply, obj}` — defined in `src/render/preview/routing.ts`.

---

## Route Reasons

The runtime route decision is intentionally conservative:

- Babylon.js is the default path for preview surfaces unless the user explicitly enables a Three.js rollout or Direct View is opening a generated converted GLB fast-path asset with the fast-path setting enabled.
- Three.js remains the opt-in fast path for common single-model formats (GLB, GLTF, STL, PLY, OBJ) across reading surfaces and direct view, including annotation overlays.
- Three.js is automatically used for Direct View conversion-backed GLB outputs when `Converted GLB Three fast path` is enabled because those assets are local generated intermediates; Babylon remains the silent fallback when Three loading fails.
- Babylon.js remains the intentional capability path for:
  - full workbench features outside the direct file edit-preview path
  - grid layouts
  - SPLAT format
  - conversion-backed formats when the effective output is not a Three-supported single-model asset or when the fast path fails

The shared route helper lives in `src/render/preview/routing.ts`.
The phase-3 / phase-4 decision note lives in `docs/workbench-3dgrid-feasibility-note.md`.

## Rollout Control

The plugin exposes a `Preview compatibility mode` setting:

- `Compatibility mode` (`babylon-safe`) - default
  - inline `3d` -> Babylon.js
  - Live Preview embed -> Babylon.js
  - direct file view -> Babylon.js, except generated converted GLB outputs use Three.js with Babylon fallback when `Converted GLB Three fast path` is enabled
- `Reading surfaces only` (`three-readonly-glb`)
  - inline `3d` -> Three.js
  - Live Preview embed -> Three.js
  - direct file view -> Babylon.js
- `Reading + file view` (`three-direct-glb`)
  - inline `3d` -> Three.js
  - Live Preview embed -> Three.js
  - direct file view -> Three.js

The separate `Converted GLB Three fast path` switch controls whether converted
Direct View GLB outputs may override compatibility mode for the Three.js fast
path. Turn it off to make STEP/FBX/3MF/DAE/etc. converted outputs follow the
normal renderer settings, which means Babylon.js in default compatibility mode.

Workbench and `3dgrid` remain on Babylon.js regardless of these settings. The verification harness also has a hidden Three.js workbench capability probe, but production routing still keeps workbench on Babylon.

---

## Smoke Tests

Automated subset:

- `npm run verify:preview:success`

This automation covers:

- simple single-model `GLB`
- readonly saved-pin overlay
- direct file edit preview
- helper toolbar interactions
- focus blank-click, moving-pin occlusion, and performance snapshot checks
- stage-1 reading-surface rollout for direct view rollback
- compatibility-mode rollback for all single-model paths
- workbench Babylon fallback and hidden Three.js capability probe
- direct `STL`, `PLY`, and `OBJ` routes

Manual checks remain required for:

- `3dgrid`
- real conversion-chain inputs and full knowledge-panel workflow
- `GLTF` assets with external resources

The Three.js smoke examples below assume the setting is switched to
`Reading + file view` (`three-direct-glb`). The exception is Direct View
conversion-backed GLB output, which uses the Three.js fast path in default
compatibility mode only when `Converted GLB Three fast path` is enabled and
falls back to Babylon.js on load failure.

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
