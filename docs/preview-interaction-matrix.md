# Preview Interaction Matrix

This document defines how preview tools cooperate across Three.js and Babylon.js.
Renderer implementations and helper-toolbar state must follow the same contract.

## Primary interaction modes

Only one primary interaction mode may be active at a time:

| Mode | Object click | Empty drag | Handle drag | Transition behavior |
|------|--------------|------------|-------------|---------------------|
| Idle | Select/highlight | Orbit camera | N/A | Default state |
| Annotation | Create/edit annotation | Orbit camera | Annotation UI | Exits focus, disassembly, measurement, and slice |
| Focus | Focus selected part; blank click clears focus | Orbit camera | N/A | Exits annotation, disassembly, measurement, and slice |
| Disassembly | Select/drag a part | Orbit camera | Move selected part | Exits annotation, focus, measurement, and slice |
| Measurement | Pick ruler endpoints across the model, or within a previously focused part | Orbit camera | Measurement pick | Captures focused scope, then exits annotation, focus, disassembly, and slice |
| Slice | No object selection | Orbit camera | Move arrow or rotation ring | Exits annotation, focus, disassembly, and measurement |

Switching modes cancels incomplete pointer work from the previous mode. Completed
measurement records remain visible because they are evidence overlays, not an active mode.

Primary inspection tools have visible short labels. Active modes show persistent
next-action guidance in a live status region; switching back to idle hides it.
Keep the existing tooltip-free contract and mutual exclusion when editing these
controls. Mobile tool hit areas are at least 40 CSS px.

Exit mode deactivates the active tool without clearing completed rulers. Escape
is scoped to the preview/toolbar: cancel a pending endpoint before exiting
measurement; editors can consume Escape first. Extra actions use visible labels
and wrap within the toolbar. Keyboard measurement must deactivate annotation
before the canvas shortcut runs. Switching mobile interaction back to scroll
exits active tools without deleting completed evidence.

## Coexisting view features

The registered-part catalog is a separate direct-file inspection window that
reuses the current single-model canvas. Entering exits primary tools and pauses
animations. Exact current-profile identities/references determine rigid part
groups. Search, visibility and single-part inspection are independent controls;
unregistered geometry has its own checkbox. The catalog captures/restores geometry
and camera on close or file changes. Its canvas only exposes Reset assembly and
Escape shortcuts, so measurement/animation shortcuts cannot alter the catalog.
Both default Babylon and opt-in Three implement this contract. The responsive
window refits its catalog when the preview area changes dimensions.

Image-style wikilinks expose only Reset and Expand in their compact action bar.
The expanded dialog hosts the same preview frame; reserve its original size and
restore it on close. Advanced canvas shortcuts open this dialog before activating
tools. Its Obsidian key scope routes Escape through toolbar dismissal first.
Closing exits interaction modes while retaining completed records; disposing the
owning widget closes the dialog and releases its preview resources.

The following features are not primary interaction modes and remain available:

- wireframe
- bounding box
- orientation axes
- render scale and camera zoom
- completed measurement records
- snapshots and model/part information export

Camera orbit remains available in every primary mode when the pointer is not captured by
that mode's handle or pick workflow.

Slice reset uses the shared world Y-up frame. It restores a 0-degree XZ cutting plane at
50 percent through the current model placement's world-bounds center.

## Model-transform linkage

Measurement calibration can rescale the loaded model. After a scale change, renderers must
refresh dependent model-space helpers:

- renderable bounds and camera framing
- slice clipping plane, ruler, board, and hit regions
- selection and focus helpers
- measurement snap caches and labels
- bounding box, ground, grid, and orientation helpers

## Slice rules preserved by linked updates

- The cutting-board center is an independent pivot and does not drift while rotating.
- Rotation uses a frozen starting coordinate frame for the full pointer gesture.
- The ruler, movable handle, board, and hit regions share one plane-local frame.
- Rotation supports coarse 45-degree and fine 5-degree snapping.
- Position and X/Y/Z rotation fields are bidirectionally synchronized with the cutting board; rotation 0/0/0 is the world-horizontal pose.
- The visible board projects all eight model bounding-box corners into its local frame and
  extends at least 10 percent beyond them.
- Clipping planes update in place during dragging so model materials are not recompiled or
  rebound on every pointer frame.
