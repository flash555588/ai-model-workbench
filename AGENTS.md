# Agent Development Guide

This file is the model-agnostic handoff for coding agents working on AI Model Workbench.
Read it before changing code. For deeper product/spec context, use
`docs/development-handoff.md`.

## First Steps

1. Run `git status --short` and treat existing changes as user work unless you made them.
2. Read `docs/development-handoff.md` for the current architecture, routing decisions,
   verification matrix, and active product direction.
3. Check `CHANGELOG.md` before planning a release-facing change.
4. Use `rg` / `rg --files` for repository search.
5. Use focused edits and keep generated bundle changes intentional.

## Current Product Contract

- This is an Obsidian plugin for rendering 3D assets and turning model evidence into
  linked knowledge notes.
- Single-model GLB/GLTF/STL/PLY/OBJ preview paths use Three.js by default.
- Babylon.js remains the production capability backend for `3dgrid`, conservative
  fallback behavior, and any future local-only SPLAT restoration.
- Direct file view can opt into Experimental Three workbench for direct GLB/GLTF and
  falls back to Babylon on failure.
- Knowledge generation is local-first. Remote draft support is optional and sends only
  sanitized evidence when explicitly configured.
- Named GLB/GLTF groups are treated as higher-confidence part candidates. Direct file
  view auto-registers captured part candidates into the model profile so later models
  can detect likely reused parts before a full report exists.

## Tool Usage Setup

Prefer these commands from the repository root:

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

Use `npm run verify:obsidian` only when Obsidian is installed and the host can launch it.
Use `npm run verify:obsidian -- --clean` to remove the temporary verification vault.
After a release, use `npm run verify:obsidian -- --release-tag <version>` to install
assets downloaded from GitHub.

For preview harness failures, inspect `.tmp/preview-failures/`.
For a custom browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Change-To-Test Mapping

| Change area | Minimum useful checks |
|-------------|-----------------------|
| Type/domain/store/settings migration | `npm run typecheck`, `npm run verify:settings` |
| Three/Babylon route, preview UI, annotation overlay | `npm run verify:preview`, often `npm run verify:preview:success` |
| Three performance, frame budget, visibility/disposal | `npm run verify:preview` plus route-specific harness flags |
| Knowledge notes, reports, indexes, part notes, registered part reuse | `npm run verify:knowledge-index` |
| Remote draft client/privacy | `npm run verify:remote-draft` |
| Diagnostics output | `npm run verify:diagnostics` |
| Conversion, external resources, Obsidian integration | `npm run verify:obsidian` when available |
| Release assets/version/hash workflow | `npm run build`, `npm run verify:release` |

## Editing Rules

- Keep vault paths and filesystem paths separate. Vault paths use `/`; filesystem paths
  are OS-native and should pass through existing helpers.
- Reuse `src/utils/resolve-path.ts` and `src/io/conversion/python-path.ts` instead of
  ad hoc path parsing.
- Reuse renderer-agnostic preview interfaces in `src/render/preview/types.ts` before
  adding renderer-specific hooks.
- Do not broaden workbench or `3dgrid` routing without updating
  `docs/preview-routing-matrix.md` and verification coverage.
- Do not copy GPL code. See `docs/mit-upstream-guidelines.md`.
- Never paste or preserve PATs/tokens. See `SECURITY.md`.
- If you change generated docs or behavior, update `CHANGELOG.md`.
- Mark intentional shortcuts and known debt with `TODO(P<n>): <message>` or
  `TODO: <message> (debt: <area>)`. Use `P0` only for urgent safety/correctness
  follow-ups, `P1` for reliability/performance debt, and `P2` for maintainability
  debt. Prefer `// TODO` comments for code and `<!-- TODO -->` for Markdown.

## Important Specs

- `docs/development-handoff.md` - canonical model handoff and spec map.
- `docs/preview-routing-matrix.md` - renderer routing contract.
- `docs/workbench-3dgrid-feasibility-note.md` - why production workbench and `3dgrid`
  remain conservative.
- `docs/threejs-migration-roadmap.md` - historical and future Three.js migration logic.
- `FORMAT_SUPPORT_DESIGN.md` - format/conversion strategy.
- `docs/cross-platform-development.md` - portability rules for path and converter work.
- `SECURITY.md` - release token safety and leak response.
