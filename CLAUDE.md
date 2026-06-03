# CLAUDE.md

This file is a Claude Code entry point. The canonical model-agnostic instructions live
in `AGENTS.md`, and the deeper specification handoff lives in
`docs/development-handoff.md`.

## Read First

1. `AGENTS.md`
2. `docs/development-handoff.md`
3. `docs/preview-routing-matrix.md`
4. `CHANGELOG.md`

## Current Project Summary

AI Model Workbench is an Obsidian plugin for rendering 3D model assets, annotating
model regions, and generating linked knowledge notes from local model evidence.

Current renderer contract:

- Three.js is the default single-model preview path for GLB/GLTF/STL/PLY/OBJ across
  inline previews, Live Preview, and direct file view.
- Babylon.js remains the production capability/fallback backend for `3dgrid` and
  conservative workbench behavior.
- Direct GLB/GLTF file view can use Experimental Three workbench with Babylon fallback.

Current knowledge contract:

- Generated knowledge notes are evidence-backed, local-first, and can create model
  reports, sidecars, indexes, evidence snapshots, and part-note drafts.
- Named GLB/GLTF groups are higher-confidence part candidates.
- Direct file view auto-registers captured part candidates into model profiles so
  later imported models can detect reused parts before a full report exists.

## Build And Verification

```bash
npm install
npm run build
npm run typecheck
npm run verify:preview
npm run verify:preview:success
npm run verify:settings
npm run verify:knowledge-index
npm run verify:diagnostics
npm run verify:remote-draft
npm run verify:release
npm run verify:obsidian
```

Choose checks based on the changed surface. See `AGENTS.md` for the change-to-test
mapping and `README.md` for longer verification notes.

## Claude-Specific Working Notes

- Use `rg` for repository search.
- Start by checking `git status --short`; this repository may already contain user or
  generated changes.
- Do not reset or discard existing changes unless explicitly asked.
- Keep edits focused and update `CHANGELOG.md` for release-facing behavior.
- Never paste or preserve tokens. Follow `SECURITY.md`.

