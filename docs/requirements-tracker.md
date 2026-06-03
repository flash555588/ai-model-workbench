# Requirements Tracker

Use this file to track AI Model Workbench requirements that affect product scope,
verification, and handoff. Keep IDs stable once created so changelog entries, tests, and
future agent notes can refer to the same requirement over time.

## Status Key

| Status | Meaning |
|--------|---------|
| `Accepted` | In scope and ready for implementation or ongoing refinement |
| `In Progress` | Currently being changed |
| `Verified` | Implemented and covered by the listed verification |
| `Deferred` | Valid, but intentionally postponed |
| `Dropped` | No longer in scope |

## Priority Key

| Priority | Meaning |
|----------|---------|
| `P0` | Required for safe plugin operation |
| `P1` | Important for the next release-quality build |
| `P2` | Useful improvement |
| `P3` | Nice-to-have or exploratory |

## Requirement Index

| ID | Requirement | Priority | Status | Verification |
|----|-------------|----------|--------|--------------|
| REQ-001 | Single-model previews use Three.js by default while Babylon remains fallback/capability backend | P0 | Verified | `npm run verify:preview`, `npm run verify:preview:success` |
| REQ-002 | `3dgrid` and conservative workbench routes remain on Babylon until workflow evidence justifies migration | P0 | Accepted | `docs/preview-routing-matrix.md`, `npm run verify:preview` |
| REQ-003 | Knowledge generation remains local-first and records report, sidecar, index, preview evidence, and part notes | P0 | Verified | `npm run verify:knowledge-index` |
| REQ-004 | Direct file view auto-registers captured part candidates for later cross-model reuse matching | P1 | Verified | `npm run verify:knowledge-index`, `node scripts/verify-preview.mjs --model "models/resource-fixtures/grouped-parts/grouped parts.gltf" --expect-group-parts` |
| REQ-005 | Registered part reuse feedback is visible in generated notes and direct workbench UI | P1 | Verified | `npm run verify:knowledge-index`, `npm run typecheck`, `node scripts/verify-preview.mjs --mode workbench --allow-workbench-three` |
| REQ-006 | Diagnostics reports expose support context without leaking draft service URLs or converter command paths | P1 | Verified | `npm run verify:diagnostics` |
| REQ-007 | Release assets keep `manifest.json`, `package.json`, `versions.json`, `main.js`, and `styles.css` aligned | P0 | Verified | `npm run build`, `npm run verify:release` |
| REQ-008 | Real Obsidian smoke verification covers install, rendering, knowledge generation, and diagnostics when the host can launch Obsidian | P1 | Accepted | `npm run verify:obsidian` |

## Active Requirement Details

### REQ-004: Auto Part Registration

- Status: Verified
- Priority: P1
- User value: Named groups and assemblies in GLB/GLTF files should become reusable part candidates without requiring a full report first.
- Current behavior:
  - Named model groups are promoted to higher-confidence part candidates.
  - Ungrouped mesh parts remain available as lower-confidence candidates.
  - The grouped-parts browser fixture verifies that group and mesh evidence are both preserved.
- Verification:
  - `npm run verify:knowledge-index`
  - `node scripts/verify-preview.mjs --model "models/resource-fixtures/grouped-parts/grouped parts.gltf" --expect-group-parts`

### REQ-005: Registered Part Reuse Feedback

- Status: Verified
- Priority: P1
- User value: When a newly loaded model contains parts that resemble parts from another model, users should see where the match came from and have an immediate action to inspect the existing evidence.
- Current behavior:
  - Knowledge reports, sidecars, draft input, index entries, and part notes preserve registered matches.
  - Direct workbench shows the strongest cross-model matches.
  - Direct workbench now includes the source model label, explains what the action opens, and opens the matched part note, falling back to the source model file if no part note exists yet.
- Acceptance criteria:
  - Match rows show the current part, matched registered part, match reasons, score, and source model.
  - The action label distinguishes opening a part note from opening a source model fallback.
  - The action is enabled when either a part note or source model path is available.
  - Generated analysis preserves `sourceModelPath` for matched registered parts.
  - The UI stays compact on narrow panes.
- Verification:
  - `npm run typecheck`
  - `npm run verify:knowledge-index`
  - `node scripts/verify-preview.mjs --mode workbench --allow-workbench-three`
  - `npm run verify:preview:success` for full route coverage when changing broader preview behavior.

## New Requirement Template

```md
### REQ-000: Requirement Name

- Status: Accepted
- Priority: P2
- User value:
- Scope:
- Out of scope:
- Acceptance criteria:
  - 
- Verification:
  - 
- Related files:
  - 
```

## Review Rules

- Update this tracker when product scope, route policy, release gates, or acceptance
  criteria change.
- Keep implementation details in source/docs; keep this file focused on what must remain
  true and how to verify it.
- Before release, every P0 requirement should be `Verified` or intentionally documented
  as `Deferred`/`Dropped`.
